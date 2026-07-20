import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  ImageIcon,
  LoaderCircle,
  ScanText,
  Send,
  Square,
  X,
} from "../../components/icons";
import { Markdown } from "../../components/Markdown";
import { t } from "../../i18n";
import { streamAssistantMessage } from "../../lib/providers/llm";
import {
  buildQuickAskContext,
  buildQuickAskUserMessage,
  QuickAskModelError,
  type QuickAskModelResolution,
  resolveQuickAskModel,
} from "../../lib/quick-ask/model";
import { loadPersistedSettings } from "../../lib/settings/storage";
import { cn } from "../../lib/shared/utils";
import { applyQuickAskTheme, readQuickAskLocale } from "./quickAskLocal";

const QUICK_ASK_NEW_SHOT_EVENT = "quick-ask:new-shot";
const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 128;

type PendingShot = { imageDataUrl: string } | null;

type DisplayTurn = {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
  error?: string;
};

/**
 * 快捷提问小窗（label: quick-ask）：展示截图 + 输入问题 + 流式回答。
 * 模型调用完全复用主应用的 provider 流式管线（本地代理、凭据、模型选择），
 * 对话只存在内存里，不写入聊天历史。
 */
export function QuickAskApp() {
  const locale = readQuickAskLocale();
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [fatalError, setFatalError] = useState<"no-model" | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [shotExpanded, setShotExpanded] = useState(true);
  const historyRef = useRef<Message[]>([]);
  const resolutionRef = useRef<QuickAskModelResolution | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imageRef = useRef<string | null>(null);
  const imageSentRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
    el.style.height = `${next}px`;
  }, []);

  const closeWindow = useCallback(() => {
    abortRef.current?.abort();
    void invoke("quick_ask_close_window").catch(() => {});
  }, []);

  const ensureModel = useCallback(async (): Promise<QuickAskModelResolution | null> => {
    if (resolutionRef.current) return resolutionRef.current;
    try {
      const resolution = resolveQuickAskModel(await loadPersistedSettings());
      resolutionRef.current = resolution;
      setModelLabel(resolution.selected.model);
      setFatalError(null);
      return resolution;
    } catch (error) {
      if (error instanceof QuickAskModelError) {
        setFatalError("no-model");
        setModelLabel(null);
        return null;
      }
      throw error;
    }
  }, []);

  const resetWithShot = useCallback(
    (shot: PendingShot) => {
      if (!shot) return;
      abortRef.current?.abort();
      abortRef.current = null;
      historyRef.current = [];
      imageRef.current = shot.imageDataUrl;
      imageSentRef.current = false;
      setImageDataUrl(shot.imageDataUrl);
      setTurns([]);
      setStreaming(false);
      setShotExpanded(true);
      setCopiedIndex(null);
      void ensureModel();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        resizeTextarea();
      });
    },
    [ensureModel, resizeTextarea],
  );

  useEffect(() => {
    applyQuickAskTheme();
    void invoke<PendingShot>("quick_ask_take_pending").then(resetWithShot);
    void ensureModel();
    const unlisten = listen(QUICK_ASK_NEW_SHOT_EVENT, () => {
      void invoke<PendingShot>("quick_ask_take_pending").then(resetWithShot);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, [resetWithShot, ensureModel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次消息变化都滚到底部。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, streaming]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 输入变化时重算 textarea 高度。
  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;

    const resolution = await ensureModel();
    if (!resolution) return;

    const shotForThisTurn = imageSentRef.current ? undefined : (imageRef.current ?? undefined);
    const userMessage = buildQuickAskUserMessage(question, shotForThisTurn);
    imageSentRef.current = true;
    historyRef.current = [...historyRef.current, userMessage];
    setInput("");
    setStreaming(true);
    setShotExpanded(false);
    setTurns((prev) => [
      ...prev,
      { role: "user", text: question, imageDataUrl: shotForThisTurn },
      { role: "assistant", text: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const appendDelta = (delta: string) => {
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, text: last.text + delta };
        }
        return next;
      });
    };

    try {
      const assistant: AssistantMessage = await streamAssistantMessage({
        providerId: resolution.provider.type,
        model: resolution.selected.model,
        runtime: resolution.runtime,
        context: buildQuickAskContext(historyRef.current, locale),
        signal: controller.signal,
        cacheRetention: "none",
        nativeWebSearch: false,
        onTextDelta: appendDelta,
      });
      historyRef.current = [...historyRef.current, assistant];
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, error: message };
          }
          return next;
        });
        // 请求失败的轮次不进入历史，用户重发时不会带上半截回答。
        historyRef.current = historyRef.current.slice(0, -1);
        imageSentRef.current = historyRef.current.length > 0;
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [input, streaming, locale, ensureModel]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (abortRef.current) {
        stopStreaming();
      } else {
        closeWindow();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stopStreaming, closeWindow]);

  const openMainWindow = useCallback(() => {
    void invoke("quick_ask_open_main_window").catch(() => {});
  }, []);

  const copyAssistant = useCallback(async (text: string, index: number) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedIndex(null);
        copyTimerRef.current = null;
      }, 1600);
    } catch {
      // 剪贴板不可用时静默失败，不影响对话。
    }
  }, []);

  const canSend = Boolean(input.trim()) && !streaming && fatalError !== "no-model";
  const hasConversation = turns.length > 0;
  const showStickyShot = Boolean(imageDataUrl) && hasConversation;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[hsl(var(--background))] text-foreground">
      {/* 顶栏：拖拽区 + 品牌标题 + 模型徽章 + 操作 */}
      <header
        data-tauri-drag-region
        className="relative flex h-11 shrink-0 items-center gap-2 border-b border-border/70 bg-[hsl(var(--background))]/90 px-3 backdrop-blur-md"
      >
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ScanText className="h-3.5 w-3.5" />
          </span>
          <div data-tauri-drag-region className="min-w-0">
            <div
              data-tauri-drag-region
              className="truncate text-[13px] font-semibold tracking-tight"
            >
              {t("quickAsk.title", locale)}
            </div>
            {modelLabel ? (
              <div
                data-tauri-drag-region
                className="truncate text-[10.5px] text-muted-foreground"
                title={modelLabel}
              >
                {modelLabel}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={openMainWindow}
          title={t("quickAsk.openMain", locale)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={closeWindow}
          title={t("quickAsk.close", locale)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {/* 对话进行中：顶部粘性缩略截图，可展开回看 */}
        {showStickyShot && imageDataUrl ? (
          <div className="sticky top-0 z-10 border-b border-border/60 bg-[hsl(var(--background))]/92 px-3 py-2 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setShotExpanded((value) => !value)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-muted/30 p-1.5 text-left transition-colors hover:bg-muted/50"
            >
              <img
                src={imageDataUrl}
                alt=""
                className={cn(
                  "shrink-0 rounded-lg border border-border/60 object-cover shadow-sm",
                  shotExpanded ? "h-20 w-auto max-w-[55%]" : "h-9 w-12",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <ImageIcon className="h-3 w-3" />
                  {t("quickAsk.capturedRegion", locale)}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                  {shotExpanded
                    ? t("quickAsk.collapseShot", locale)
                    : t("quickAsk.expandShot", locale)}
                </div>
              </div>
            </button>
          </div>
        ) : null}

        <div className="space-y-3 px-3 py-3">
          {/* 空态：大图预览 + 引导 */}
          {imageDataUrl && !hasConversation ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20 shadow-[0_8px_28px_-18px_rgba(15,23,42,0.45)]">
                <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <ImageIcon className="h-3 w-3" />
                  {t("quickAsk.capturedRegion", locale)}
                </div>
                <div className="bg-[radial-gradient(circle_at_top,hsl(var(--muted)/0.55),transparent_70%)] p-2.5">
                  <img
                    src={imageDataUrl}
                    alt=""
                    className="mx-auto max-h-52 w-auto max-w-full rounded-xl border border-border/50 object-contain shadow-sm"
                  />
                </div>
              </div>
              <p className="px-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {t("quickAsk.emptyHint", locale)}
              </p>
            </div>
          ) : null}

          {!imageDataUrl && !hasConversation ? (
            <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ScanText className="h-5 w-5" />
              </span>
              <p className="max-w-[16rem] text-[12.5px] leading-relaxed text-muted-foreground">
                {t("quickAsk.noShot", locale)}
              </p>
            </div>
          ) : null}

          {turns.map((turn, index) =>
            turn.role === "user" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 轮次只追加不重排。
              <div key={index} className="flex justify-end">
                <div className="max-w-[88%] space-y-1.5 rounded-2xl rounded-br-md bg-[hsl(var(--chat-user-bg))] px-3.5 py-2.5 text-[hsl(var(--chat-user-fg))] shadow-sm">
                  {turn.imageDataUrl ? (
                    <img
                      src={turn.imageDataUrl}
                      alt=""
                      className="max-h-36 w-auto max-w-full rounded-lg border border-black/5 object-contain dark:border-white/10"
                    />
                  ) : null}
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {turn.text}
                  </div>
                </div>
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: 轮次只追加不重排。
              <div key={index} className="group/assistant space-y-1.5">
                <div className="rounded-2xl rounded-tl-md border border-border/60 bg-card/70 px-3.5 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset] dark:bg-card/40 dark:shadow-none">
                  {turn.text ? (
                    <div className="text-[13px] leading-relaxed [&_.prose]:text-[13px] [&_.prose]:leading-relaxed">
                      <Markdown
                        content={turn.text}
                        renderMode="streaming"
                        showCaret={streaming && index === turns.length - 1}
                      />
                    </div>
                  ) : turn.error ? null : (
                    <div className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      {t("quickAsk.thinking", locale)}
                    </div>
                  )}
                  {turn.error ? (
                    <p className="text-[12px] leading-relaxed text-destructive">
                      {t("quickAsk.requestFailed", locale)}: {turn.error}
                    </p>
                  ) : null}
                </div>
                {turn.text && !(streaming && index === turns.length - 1) ? (
                  <div className="flex justify-start opacity-0 transition-opacity group-hover/assistant:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => void copyAssistant(turn.text, index)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      title={t("quickAsk.copy", locale)}
                    >
                      {copiedIndex === index ? (
                        <>
                          <Check className="h-3 w-3" />
                          {t("quickAsk.copied", locale)}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          {t("quickAsk.copy", locale)}
                        </>
                      )}
                    </button>
                  </div>
                ) : null}
              </div>
            ),
          )}

          {fatalError === "no-model" ? (
            <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-3.5 text-[12.5px] leading-relaxed">
              <p>{t("quickAsk.noModel", locale)}</p>
              <button
                type="button"
                onClick={openMainWindow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("quickAsk.openMain", locale)}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* 底部输入区：对齐主聊天 composer 的玻璃卡片风格 */}
      <footer className="shrink-0 border-t border-border/60 bg-[hsl(var(--background))]/92 p-2.5 backdrop-blur-md">
        <div className="composer-glass-card relative overflow-hidden rounded-[18px] border border-black/[0.055] bg-white/75 shadow-[0_10px_28px_-16px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-xl dark:border-white/[0.10] dark:bg-white/[0.06] dark:shadow-[0_10px_28px_-16px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-4 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/15"
          />
          <div className="relative flex items-end gap-1.5 p-2">
            <textarea
              ref={inputRef}
              autoFocus
              rows={1}
              value={input}
              placeholder={t("quickAsk.placeholder", locale)}
              disabled={fatalError === "no-model"}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              className="max-h-32 min-h-[2.75rem] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                title={t("quickAsk.stop", locale)}
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                title={t("quickAsk.send", locale)}
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-center text-[10.5px] text-muted-foreground/70">
          {t("quickAsk.footerHint", locale)}
        </p>
      </footer>
    </div>
  );
}
