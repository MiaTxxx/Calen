import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, Send, Square, X } from "../../components/icons";
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
import { applyQuickAskTheme, readQuickAskLocale } from "./quickAskLocal";

const QUICK_ASK_NEW_SHOT_EVENT = "quick-ask:new-shot";

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
  const historyRef = useRef<Message[]>([]);
  const resolutionRef = useRef<QuickAskModelResolution | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imageRef = useRef<string | null>(null);
  const imageSentRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const closeWindow = useCallback(() => {
    abortRef.current?.abort();
    void invoke("quick_ask_close_window").catch(() => {});
  }, []);

  const resetWithShot = useCallback((shot: PendingShot) => {
    if (!shot) return;
    abortRef.current?.abort();
    abortRef.current = null;
    historyRef.current = [];
    imageRef.current = shot.imageDataUrl;
    imageSentRef.current = false;
    setImageDataUrl(shot.imageDataUrl);
    setTurns([]);
    setStreaming(false);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    applyQuickAskTheme();
    void invoke<PendingShot>("quick_ask_take_pending").then(resetWithShot);
    const unlisten = listen(QUICK_ASK_NEW_SHOT_EVENT, () => {
      void invoke<PendingShot>("quick_ask_take_pending").then(resetWithShot);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [resetWithShot]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次消息变化都滚到底部。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;

    let resolution = resolutionRef.current;
    if (!resolution) {
      try {
        resolution = resolveQuickAskModel(await loadPersistedSettings());
        resolutionRef.current = resolution;
      } catch (error) {
        if (error instanceof QuickAskModelError) {
          setFatalError("no-model");
          return;
        }
        throw error;
      }
    }

    const shotForThisTurn = imageSentRef.current ? undefined : (imageRef.current ?? undefined);
    const userMessage = buildQuickAskUserMessage(question, shotForThisTurn);
    imageSentRef.current = true;
    historyRef.current = [...historyRef.current, userMessage];
    setInput("");
    setStreaming(true);
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
  }, [input, streaming, locale]);

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"
      >
        <span data-tauri-drag-region className="flex-1 truncate text-sm font-medium">
          {t("quickAsk.title", locale)}
        </span>
        <button
          type="button"
          onClick={openMainWindow}
          title={t("quickAsk.openMain", locale)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={closeWindow}
          title={t("quickAsk.close", locale)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {imageDataUrl && turns.length === 0 ? (
          <div className="space-y-2">
            <img
              src={imageDataUrl}
              alt=""
              className="max-h-48 w-auto max-w-full rounded-md border border-border"
            />
            <p className="text-sm text-muted-foreground">{t("quickAsk.emptyHint", locale)}</p>
          </div>
        ) : null}
        {!imageDataUrl && turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("quickAsk.noShot", locale)}</p>
        ) : null}
        <div className="space-y-3">
          {turns.map((turn, index) =>
            turn.role === "user" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 轮次只追加不重排。
              <div key={index} className="flex justify-end">
                <div className="max-w-[85%] space-y-1.5 rounded-lg bg-primary/10 px-3 py-2">
                  {turn.imageDataUrl ? (
                    <img
                      src={turn.imageDataUrl}
                      alt=""
                      className="max-h-40 w-auto max-w-full rounded border border-border"
                    />
                  ) : null}
                  <div className="whitespace-pre-wrap break-words text-sm">{turn.text}</div>
                </div>
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: 轮次只追加不重排。
              <div key={index} className="text-sm">
                {turn.text ? (
                  <Markdown
                    content={turn.text}
                    renderMode="streaming"
                    showCaret={streaming && index === turns.length - 1}
                  />
                ) : turn.error ? null : (
                  <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {turn.error ? (
                  <p className="mt-1 text-xs text-destructive">
                    {t("quickAsk.requestFailed", locale)}: {turn.error}
                  </p>
                ) : null}
              </div>
            ),
          )}
        </div>
        {fatalError === "no-model" ? (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p>{t("quickAsk.noModel", locale)}</p>
            <button
              type="button"
              onClick={openMainWindow}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
            >
              {t("quickAsk.openMain", locale)}
            </button>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-border p-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            autoFocus
            rows={2}
            value={input}
            placeholder={t("quickAsk.placeholder", locale)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            className="max-h-32 min-h-[3.25rem] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              title={t("quickAsk.stop", locale)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim()}
              title={t("quickAsk.send", locale)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
