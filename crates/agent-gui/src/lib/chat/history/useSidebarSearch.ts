// 侧栏对话搜索（仅 GUI 端）：即时标题过滤 + 后端 FTS 全文搜索的合并结果。
// 搜索态放在 store 之外，避免改动与网页端字节镜像的 lib/sidebar/*。

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryHistorySearchMatch } from "../../memory/api";
import type { SidebarConversation } from "../../sidebar/types";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_RESULT_LIMIT = 30;

export type SidebarSearchStatus = "idle" | "searching" | "ready" | "error";

export type SidebarSearchResult = {
  conversationId: string;
  title: string;
  matchKind: "title" | "content";
  snippet?: string;
  updatedAt: number;
};

export type SidebarSearchState = {
  query: string;
  setQuery: (value: string) => void;
  clear: () => void;
  results: SidebarSearchResult[];
  status: SidebarSearchStatus;
};

type ChatHistorySearchResponse = {
  matches: MemoryHistorySearchMatch[];
};

function titleMatches(title: string, normalizedQuery: string): boolean {
  return title.toLowerCase().includes(normalizedQuery);
}

/** 合并即时标题匹配与后端全文匹配：标题命中优先，其余按分数序附带片段。 */
function mergeResults(
  loadedItems: readonly SidebarConversation[],
  backendMatches: readonly MemoryHistorySearchMatch[],
  normalizedQuery: string,
): SidebarSearchResult[] {
  const results: SidebarSearchResult[] = [];
  const seen = new Set<string>();

  for (const item of loadedItems) {
    if (!titleMatches(item.title, normalizedQuery)) continue;
    seen.add(item.id);
    results.push({
      conversationId: item.id,
      title: item.title,
      matchKind: "title",
      updatedAt: item.updatedAt,
    });
  }

  // 后端结果按 conversationId 去重，保留分数最高的片段（响应已按分数降序）。
  for (const match of backendMatches) {
    if (seen.has(match.conversationId)) continue;
    seen.add(match.conversationId);
    results.push({
      conversationId: match.conversationId,
      title: match.title,
      matchKind: titleMatches(match.title, normalizedQuery) ? "title" : "content",
      snippet: match.snippet || undefined,
      updatedAt: match.updatedAt,
    });
  }

  return results.slice(0, SEARCH_RESULT_LIMIT);
}

export function useSidebarSearch(items: readonly SidebarConversation[]): SidebarSearchState {
  const [query, setQuery] = useState("");
  const [backendMatches, setBackendMatches] = useState<readonly MemoryHistorySearchMatch[]>([]);
  const [status, setStatus] = useState<SidebarSearchStatus>("idle");
  // 序号防陈旧响应：只接受最后一次发起的搜索结果。
  const searchSeqRef = useRef(0);

  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    const seq = ++searchSeqRef.current;
    if (!normalizedQuery) {
      setBackendMatches([]);
      setStatus("idle");
      return;
    }

    setStatus("searching");
    const timer = window.setTimeout(() => {
      void invoke<ChatHistorySearchResponse>("chat_history_search", {
        args: { query: normalizedQuery, limit: SEARCH_RESULT_LIMIT },
      })
        .then((response) => {
          if (searchSeqRef.current !== seq) return;
          setBackendMatches(response.matches ?? []);
          setStatus("ready");
        })
        .catch(() => {
          if (searchSeqRef.current !== seq) return;
          // 后端失败时保留即时标题匹配，仅标记错误。
          setBackendMatches([]);
          setStatus("error");
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [normalizedQuery]);

  const results = useMemo(
    () => (normalizedQuery ? mergeResults(items, backendMatches, normalizedQuery) : []),
    [items, backendMatches, normalizedQuery],
  );

  return useMemo(
    () => ({
      query,
      setQuery,
      clear: () => setQuery(""),
      results,
      status,
    }),
    [query, results, status],
  );
}
