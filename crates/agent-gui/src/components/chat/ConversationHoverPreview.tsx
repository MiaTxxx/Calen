// 对话悬停快速预览（仅 GUI 端）：单实例浮层，portal 到 body 以避开
// 虚拟化列表的 DOM 与 overflow 裁剪。数据来自轻量的 chat_history_peek
// 命令（服务端已抽好纯文本尾部消息），带小型 LRU 缓存与请求去重。

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../i18n";
import { formatRelativeTime } from "../../lib/shared/relativeTime";

export type ChatHistoryPeekMessage = {
  role?: string | null;
  text: string;
};

export type ChatHistoryPeek = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  cwd?: string | null;
  totalMessageCount: number;
  updatedAt: number;
  messages: ChatHistoryPeekMessage[];
};

const PEEK_CACHE_LIMIT = 20;
const PEEK_MAX_MESSAGES = 4;
const PREVIEW_WIDTH = 320;
const PREVIEW_ESTIMATED_HEIGHT = 260;

// key: conversationId。updatedAt 不一致视为过期。Map 迭代序 = 插入序，用作 LRU。
const peekCache = new Map<string, ChatHistoryPeek>();
const inflight = new Map<string, Promise<ChatHistoryPeek>>();

function fetchPeek(conversationId: string, updatedAt: number): Promise<ChatHistoryPeek> {
  const cached = peekCache.get(conversationId);
  if (cached && cached.updatedAt === updatedAt) {
    return Promise.resolve(cached);
  }
  const pending = inflight.get(conversationId);
  if (pending) {
    return pending;
  }
  const request = invoke<ChatHistoryPeek>("chat_history_peek", {
    id: conversationId,
    maxMessages: PEEK_MAX_MESSAGES,
  })
    .then((peek) => {
      peekCache.delete(conversationId);
      peekCache.set(conversationId, peek);
      while (peekCache.size > PEEK_CACHE_LIMIT) {
        const oldest = peekCache.keys().next().value;
        if (oldest === undefined) break;
        peekCache.delete(oldest);
      }
      return peek;
    })
    .finally(() => {
      inflight.delete(conversationId);
    });
  inflight.set(conversationId, request);
  return request;
}

export type ConversationHoverPreviewTarget = {
  conversationId: string;
  title: string;
  updatedAt: number;
  anchorRect: DOMRect;
};

export function ConversationHoverPreview(props: { target: ConversationHoverPreviewTarget }) {
  const { target } = props;
  const { locale, t } = useLocale();
  const [peek, setPeek] = useState<ChatHistoryPeek | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeek(null);
    fetchPeek(target.conversationId, target.updatedAt)
      .then((result) => {
        if (!cancelled) setPeek(result);
      })
      .catch(() => {
        // 出错时静默：浮层保持仅标题，不打断悬停交互。
      });
    return () => {
      cancelled = true;
    };
  }, [target.conversationId, target.updatedAt]);

  const left = Math.min(target.anchorRect.right + 10, window.innerWidth - PREVIEW_WIDTH - 8);
  const top = Math.max(
    8,
    Math.min(target.anchorRect.top, window.innerHeight - PREVIEW_ESTIMATED_HEIGHT - 8),
  );

  function roleLabel(role: string | null | undefined): string {
    if (role === "user") return t("chat.previewRoleUser");
    if (role === "assistant") return t("chat.previewRoleAssistant");
    return role ?? "";
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] w-80 rounded-xl border border-border/70 bg-popover p-3 shadow-xl shadow-black/10"
      style={{ left, top }}
      role="tooltip"
    >
      <div className="truncate text-sm font-semibold text-foreground">
        {peek?.title ?? target.title}
      </div>
      {peek ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {[
            peek.model,
            t("chat.previewMessageCount").replace("{count}", String(peek.totalMessageCount)),
            formatRelativeTime(peek.updatedAt, locale),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{t("chat.loading")}</div>
      )}
      {peek && peek.messages.length > 0 ? (
        <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
          {peek.messages.map((message, index) => (
            <div key={`${peek.id}-${index}`} className="line-clamp-2 text-xs leading-[1.5]">
              {roleLabel(message.role) ? (
                <span
                  className={
                    message.role === "user"
                      ? "mr-1.5 font-medium text-primary/80"
                      : "mr-1.5 font-medium text-muted-foreground"
                  }
                >
                  {roleLabel(message.role)}
                </span>
              ) : null}
              <span className="text-foreground/80">{message.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
