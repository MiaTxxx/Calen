import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { CheckCircle2, ChevronDown } from "../../../components/icons";
import { Markdown } from "../../../components/Markdown";
import { useLocale } from "../../../i18n";
import type {
  HistoryMessageRef,
  RenderSummaryCard,
  RenderTimelineItem,
} from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { getRoundText, type LiveRound, type UiRound } from "../../../lib/chat/messages/uiMessages";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import {
  buildGitHubCommitUrl,
  type CommitDetailsLoader,
  type CommitDisplayReference,
} from "../../../lib/chat/messages/userMessageContent";
import { normalizeLiveToolStatus } from "../../../lib/chat/page/chatPageHelpers";
import type { GitClient } from "../../../lib/git/types";
import { createEntranceRegistry } from "../../../lib/transcript-virtual/entranceOnce";
import { extractLiveRange } from "../../../lib/transcript-virtual/liveRangeExtractor";
import { AssistantRow } from "./AssistantRow";
import { createTranscriptRowModel } from "./rowModel";
import { type TranscriptNavEntry, TranscriptNavRail } from "./TranscriptNavRail";
import { UserMessageRow } from "./UserMessageRow";

const TRANSCRIPT_ROW_GAP = 24;
const TRANSCRIPT_ROW_OVERSCAN_COUNT = 5;
const NAV_EXCERPT_MAX_CHARS = 80;
// 跳转落点与视口顶部留一点呼吸空间。
const NAV_JUMP_TOP_PADDING_PX = 16;

function firstMeaningfulLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function truncateNavExcerpt(text: string): string {
  return text.length > NAV_EXCERPT_MAX_CHARS ? `${text.slice(0, NAV_EXCERPT_MAX_CHARS)}…` : text;
}

// 与 RoundContent 的 hasContent 判定保持一致：没有可见内容的 round 不会渲染
// （也就没有锚点），导航条也不该为它出条目。
function roundHasNavContent(round: UiRound | LiveRound): boolean {
  return round.blocks.some((block) => {
    if (block.kind === "tool" || block.kind === "hostedSearch") return true;
    return block.text.trim().length > 0;
  });
}

function roundNavExcerpt(round: UiRound | LiveRound): string {
  const line = firstMeaningfulLine(getRoundText(round));
  if (line) return line;
  for (const block of round.blocks) {
    if (block.kind === "tool") return block.item.toolCall.name;
  }
  return "";
}

const SummaryCard = memo(function SummaryCard(props: { item: RenderSummaryCard }) {
  const { item } = props;
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const isEn = locale === "en-US";

  return (
    <div className="flex justify-center px-2">
      <div className="checkpoint-card w-full max-w-3xl overflow-hidden rounded-[14px] border border-black/[0.06] bg-white/[0.72] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] backdrop-blur-xl dark:border-white/[0.1] dark:bg-white/[0.06] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),0_4px_12px_rgba(0,0,0,0.15)]">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-black/[0.04] dark:bg-white/[0.08]">
            <CheckCircle2 size={16} strokeWidth={1.8} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground/90">
                {isEn ? "Context Checkpoint" : "上下文检查点"}
              </span>
              <span className="inline-flex items-center rounded-md bg-black/[0.05] px-1.5 py-[1px] text-[calc(11px*var(--zone-font-scale,1))] font-normal tabular-nums text-muted-foreground dark:bg-white/[0.08]">
                {item.coveredMessageCount} {isEn ? "msgs" : "条消息"}
              </span>
            </div>
            <div className="mt-[2px] text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground/70">
              {item.generatedBy.providerId} · {item.generatedBy.model}
            </div>
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${expanded ? "rotate-0" : "-rotate-90"}`}
          />
        </button>
        {expanded ? (
          <div className="checkpoint-expand border-t border-black/[0.05] px-3.5 py-3 dark:border-white/[0.06]">
            <Markdown content={item.content} className="font-openai-chat text-sm" />
          </div>
        ) : null}
      </div>
    </div>
  );
});

export type TranscriptListProps = {
  conversationId: string;
  historyItems: RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  scrollViewport: HTMLDivElement | null;
  isSending: boolean;
  isAgentMode: boolean;
  isCompactionRunning: boolean;
  showUsage: boolean;
  usageContextWindow?: number;
  workspaceRoot?: string;
  gitClient?: GitClient | null;
  // 消息导航条的挂载点（ChatTranscript 的左缘覆盖层）与跳转前的跟随解除。
  navOverlayEl?: HTMLDivElement | null;
  onDetachFollow?: () => void;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
};

// The whole transcript — committed history and the streaming reply — lives in
// one virtualized container with stable row keys, so a run settling into
// history is a pure data transition (no cross-container move, no remount).
// Rows at or after liveStartIndex are force-mounted; everything else
// virtualizes normally with per-row content-shaped height estimates.
export const TranscriptList = memo(function TranscriptList(props: TranscriptListProps) {
  const {
    conversationId,
    historyItems,
    liveTranscriptStore,
    scrollViewport,
    isSending,
    isAgentMode,
    isCompactionRunning,
    showUsage,
    usageContextWindow,
    workspaceRoot,
    gitClient,
    navOverlayEl,
    onDetachFollow,
    onResendFromEdit,
  } = props;

  const liveState = useSyncExternalStore(
    liveTranscriptStore.subscribe,
    liveTranscriptStore.getSnapshot,
    liveTranscriptStore.getSnapshot,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt per conversation by design
  const rowModel = useMemo(() => createTranscriptRowModel(), [conversationId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt per conversation by design
  const entranceRegistry = useMemo(() => createEntranceRegistry(), [conversationId]);

  const { rows, liveStartIndex } = useMemo(() => {
    const snapshot = rowModel.build(historyItems, { ...liveState, isSending });
    entranceRegistry.observeRowKeys(snapshot.rows.map((row) => row.key));
    return snapshot;
  }, [rowModel, entranceRegistry, historyItems, liveState, isSending]);

  const liveStartIndexRef = useRef(liveStartIndex);
  liveStartIndexRef.current = liveStartIndex;

  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(null);
  const commitDetailsCacheRef = useRef(new Map<string, CommitDisplayReference>());

  useEffect(() => {
    setEditingMessageKey(null);
    commitDetailsCacheRef.current.clear();
  }, [conversationId]);

  useEffect(() => {
    if (!editingMessageKey) {
      return;
    }
    const hasEditingMessage = historyItems.some(
      (item) => item.kind === "user" && item.key === editingMessageKey,
    );
    if (!hasEditingMessage) {
      setEditingMessageKey(null);
    }
  }, [editingMessageKey, historyItems]);

  const loadCommitDetails = useCallback<CommitDetailsLoader>(
    async (commit) => {
      const workdir = workspaceRoot?.trim() ?? "";
      const sha = commit.sha.trim();
      if (!gitClient || !workdir || !sha) return null;
      const cacheKey = `${workdir}\u0000${sha}`;
      const cached = commitDetailsCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const response = await gitClient.commitDetails(workdir, sha);
      const details = response.commit;
      const resolved: CommitDisplayReference = {
        sha: details.sha,
        shortSha: details.shortSha,
        subject: details.subject,
        body: details.body,
        authorName: details.authorName,
        authorEmail: details.authorEmail,
        authorDate: details.authorDate,
        fileCount: details.fileCount,
        filesChanged: details.filesChanged,
        insertions: details.insertions,
        deletions: details.deletions,
        stat: details.stat,
        remoteName: details.remoteName,
        remoteUrl: details.remoteUrl,
        githubUrl:
          commit.githubUrl ||
          buildGitHubCommitUrl(details.remoteUrl || response.state.remoteUrl, details.sha) ||
          undefined,
      };
      commitDetailsCacheRef.current.set(cacheKey, resolved);
      return resolved;
    },
    [gitClient, workspaceRoot],
  );

  const handleStartEdit = useCallback((key: string) => {
    setEditingMessageKey(key);
  }, []);
  const handleCancelEdit = useCallback(() => {
    setEditingMessageKey(null);
  }, []);

  const displayedToolStatus = normalizeLiveToolStatus(liveState.toolStatus);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollViewport,
    estimateSize: (index) => rows[index]?.estimate ?? 260,
    getItemKey: (index) => rows[index]?.key ?? index,
    gap: TRANSCRIPT_ROW_GAP,
    overscan: TRANSCRIPT_ROW_OVERSCAN_COUNT,
    enabled: scrollViewport !== null,
    rangeExtractor: (range) => extractLiveRange(range, liveStartIndexRef.current),
  });

  // 导航条目：用户消息与检查点按行，助手行按 round 拆分——agent 任务里一次
  // 运行往往只有一个巨大的助手行，按行跳转毫无导航价值。
  const navEntries = useMemo<TranscriptNavEntry[]>(() => {
    const out: TranscriptNavEntry[] = [];
    rows.forEach((row, rowIndex) => {
      if (row.kind === "user") {
        out.push({
          id: row.key,
          rowIndex,
          anchor: null,
          fraction: 0,
          kind: "user",
          excerpt: truncateNavExcerpt(firstMeaningfulLine(row.item.text)),
        });
        return;
      }
      if (row.kind === "summary") {
        out.push({
          id: row.key,
          rowIndex,
          anchor: null,
          fraction: 0,
          kind: "summary",
          excerpt: "",
        });
        return;
      }
      const rounds = row.rounds.filter(roundHasNavContent);
      rounds.forEach((round, ordinal) => {
        out.push({
          id: `${row.key}::${round.key}`,
          rowIndex,
          anchor: ordinal === 0 ? null : `${row.key}::${round.key}`,
          fraction: rounds.length > 1 ? ordinal / rounds.length : 0,
          kind: "assistant",
          excerpt: truncateNavExcerpt(roundNavExcerpt(round)),
        });
      });
    });
    return out;
  }, [rows]);

  const resolveNavEntryTop = useCallback(
    (entry: TranscriptNavEntry): number | null => {
      const measurement = virtualizer.measurementsCache[entry.rowIndex];
      const rowStart =
        measurement?.start ?? virtualizer.getOffsetForIndex(entry.rowIndex, "start")?.[0] ?? null;
      if (rowStart === null) return null;
      if (!entry.anchor) return rowStart;
      if (scrollViewport) {
        const el = scrollViewport.querySelector(`[data-nav-anchor="${CSS.escape(entry.anchor)}"]`);
        if (el instanceof HTMLElement) {
          const viewportRect = scrollViewport.getBoundingClientRect();
          return el.getBoundingClientRect().top - viewportRect.top + scrollViewport.scrollTop;
        }
      }
      // 行未挂载时按 round 序号在行内做线性估算——只影响刻度高亮的近似度。
      return rowStart + entry.fraction * (measurement?.size ?? 0);
    },
    [scrollViewport, virtualizer],
  );

  const handleNavJump = useCallback(
    (entry: TranscriptNavEntry) => {
      onDetachFollow?.();
      virtualizer.scrollToIndex(entry.rowIndex, { align: "start" });
      // 首跳按估算高度落位；行挂载测量后校正一次，round 锚点再按 DOM 精确对齐。
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(entry.rowIndex, { align: "start" });
        requestAnimationFrame(() => {
          if (!entry.anchor || !scrollViewport) return;
          const el = scrollViewport.querySelector(
            `[data-nav-anchor="${CSS.escape(entry.anchor)}"]`,
          );
          if (el instanceof HTMLElement) {
            const viewportRect = scrollViewport.getBoundingClientRect();
            const top =
              el.getBoundingClientRect().top -
              viewportRect.top +
              scrollViewport.scrollTop -
              NAV_JUMP_TOP_PADDING_PX;
            scrollViewport.scrollTo({ top: Math.max(0, top) });
          }
        });
      });
    },
    [onDetachFollow, scrollViewport, virtualizer],
  );

  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;

        let body: ReactNode;
        if (row.kind === "summary") {
          body = <SummaryCard item={row.item} />;
        } else if (row.kind === "user") {
          body = (
            <div className="flex justify-end">
              <UserMessageRow
                row={row}
                isEditing={editingMessageKey === row.key}
                isSending={isSending}
                animateEntrance={entranceRegistry.shouldAnimate(row.key)}
                workspaceRoot={workspaceRoot}
                loadCommitDetails={loadCommitDetails}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onResendFromEdit={onResendFromEdit}
              />
            </div>
          );
        } else {
          body = (
            <div className="flex justify-start">
              <AssistantRow
                row={row}
                isSending={isSending}
                showUsage={showUsage}
                usageContextWindow={usageContextWindow}
                isAgentMode={isAgentMode}
                isCompactionRunning={row.live ? isCompactionRunning : false}
                toolStatus={row.live ? displayedToolStatus : null}
                onResendFromEdit={onResendFromEdit}
              />
            </div>
          );
        }

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 right-0 top-0"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {body}
          </div>
        );
      })}
      {navOverlayEl
        ? createPortal(
            <TranscriptNavRail
              entries={navEntries}
              viewport={scrollViewport}
              resolveEntryTop={resolveNavEntryTop}
              onJump={handleNavJump}
            />,
            navOverlayEl,
          )
        : null}
    </div>
  );
});
