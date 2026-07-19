import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useLocale } from "../../../i18n";

// 消息导航条：贴在聊天区左缘的一列刻度，每个可跳转的消息段一格（用户消息、
// 助手回复段、检查点），当前视口位置高亮。悬停展开完整消息列表快速查看，
// 点击刻度或列表项跳转到对应位置。数据与跳转实现都由 TranscriptList 注入
// （它持有虚拟化器）；本组件只做展示与命中计算。

export type TranscriptNavEntry = {
  // rowKey 或 rowKey::roundKey，稳定即可。
  id: string;
  rowIndex: number;
  // round 级锚点对应 DOM 上的 data-nav-anchor；null 表示行首（scrollToIndex 足够）。
  anchor: string | null;
  // 行内偏移估算（0..1），锚点未挂载时用于刻度高亮的近似定位。
  fraction: number;
  kind: "user" | "assistant" | "summary";
  excerpt: string;
};

const MAX_TICKS = 44;
const MIN_ENTRIES = 3;
// 高亮判定线：视口顶部向下 35% 处，接近阅读焦点。
const ACTIVE_MARKER_RATIO = 0.35;

export type TranscriptNavRailProps = {
  entries: TranscriptNavEntry[];
  viewport: HTMLDivElement | null;
  // 返回 entry 在滚动内容中的绝对 top（px）；无法解析时返回 null。
  resolveEntryTop: (entry: TranscriptNavEntry) => number | null;
  onJump: (entry: TranscriptNavEntry) => void;
};

export const TranscriptNavRail = memo(function TranscriptNavRail(props: TranscriptNavRailProps) {
  const { entries, viewport, resolveEntryTop, onJump } = props;
  const { locale, t } = useLocale();
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  // 滚动/内容变化频繁，回调经 ref 透传，避免监听器随每帧重建。
  const latestRef = useRef({ entries, resolveEntryTop });
  latestRef.current = { entries, resolveEntryTop };
  const scheduleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!viewport) return;
    let raf: number | null = null;

    const recompute = () => {
      raf = null;
      const { entries: current, resolveEntryTop: resolve } = latestRef.current;
      if (current.length === 0) return;
      let next = 0;
      if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 4) {
        next = current.length - 1;
      } else {
        const marker = viewport.scrollTop + viewport.clientHeight * ACTIVE_MARKER_RATIO;
        for (let index = 0; index < current.length; index += 1) {
          const top = resolve(current[index]);
          if (top !== null && top <= marker) next = index;
        }
      }
      setActiveIndex(next);
    };
    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(recompute);
    };
    scheduleRef.current = schedule;
    schedule();

    viewport.addEventListener("scroll", schedule, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", schedule);
      resizeObserver?.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
      scheduleRef.current = null;
    };
  }, [viewport]);

  // 流式输出会持续追加条目；条目数变化时刷新高亮。
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries.length 是刻意的触发信号
  useEffect(() => {
    scheduleRef.current?.();
  }, [entries.length]);

  // 刻度最多 MAX_TICKS 个：超出时等距抽样（首尾保留），展开列表始终显示全部。
  const tickIndexes = useMemo(() => {
    if (entries.length <= MAX_TICKS) {
      return entries.map((_, index) => index);
    }
    const out: number[] = [];
    const stride = (entries.length - 1) / (MAX_TICKS - 1);
    for (let i = 0; i < MAX_TICKS; i += 1) {
      out.push(Math.round(i * stride));
    }
    return out;
  }, [entries]);

  const activeTickPosition = useMemo(() => {
    let position = 0;
    for (let i = 0; i < tickIndexes.length; i += 1) {
      if (tickIndexes[i] <= activeIndex) position = i;
    }
    return position;
  }, [activeIndex, tickIndexes]);

  useEffect(() => {
    if (expanded) {
      activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [expanded]);

  if (entries.length < MIN_ENTRIES) return null;

  const isEn = locale === "en-US";
  const railLabel = isEn ? "Message navigation" : "消息导航";
  const roleLabel = (kind: TranscriptNavEntry["kind"]) => {
    if (kind === "user") return t("chat.previewRoleUser");
    if (kind === "summary") return isEn ? "Checkpoint" : "检查点";
    return t("chat.previewRoleAssistant");
  };

  return (
    <nav
      className="pointer-events-auto relative"
      aria-label={railLabel}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex max-h-[60vh] flex-col items-start gap-[5px] py-2 pl-1 pr-2">
        {tickIndexes.map((entryIndex, tickPosition) => {
          const entry = entries[entryIndex];
          const isActive = tickPosition === activeTickPosition;
          const baseWidth = entry.kind === "user" ? "w-4" : "w-2.5";
          return (
            <button
              key={entry.id}
              type="button"
              aria-label={`${roleLabel(entry.kind)}: ${entry.excerpt}`}
              title={entry.excerpt}
              onClick={() => onJump(entry)}
              className={`h-[3px] rounded-full transition-all duration-150 ${
                isActive
                  ? "w-5 bg-foreground"
                  : `${baseWidth} ${
                      entry.kind === "summary" ? "bg-primary/50" : "bg-muted-foreground/35"
                    } hover:w-5 hover:bg-muted-foreground/70`
              }`}
            />
          );
        })}
      </div>
      {expanded ? (
        <div className="absolute left-full top-1/2 z-30 ml-1 w-72 -translate-y-1/2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl shadow-black/10">
          <div className="max-h-[min(60vh,480px)] overflow-y-auto p-1.5">
            {entries.map((entry, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={entry.id}
                  ref={isActive ? activeItemRef : null}
                  type="button"
                  onClick={() => onJump(entry)}
                  className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                  }`}
                >
                  <span
                    className={`shrink-0 text-[11px] font-medium ${
                      entry.kind === "user"
                        ? "text-primary/80"
                        : entry.kind === "summary"
                          ? "text-primary/60"
                          : "text-muted-foreground"
                    }`}
                  >
                    {roleLabel(entry.kind)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
                    {entry.excerpt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </nav>
  );
});
