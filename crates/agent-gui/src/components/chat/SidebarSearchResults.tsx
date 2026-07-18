// 侧栏搜索结果面板（仅 GUI 端）：非虚拟化的小结果集（≤30 行），
// 分「标题匹配 / 内容匹配」两节，点击行打开对应对话。

import { useLocale } from "../../i18n";
import type {
  SidebarSearchResult,
  SidebarSearchStatus,
} from "../../lib/chat/history/useSidebarSearch";
import { formatRelativeTime } from "../../lib/shared/relativeTime";
import { cn } from "../../lib/shared/utils";
import { MessageSquareText } from "../icons";

type SidebarSearchResultsProps = {
  results: readonly SidebarSearchResult[];
  status: SidebarSearchStatus;
  currentConversationId: string;
  onSelect: (conversationId: string) => void;
};

function SearchResultRow(props: {
  result: SidebarSearchResult;
  active: boolean;
  locale: string;
  onSelect: (conversationId: string) => void;
}) {
  const { result, active, locale, onSelect } = props;
  return (
    <button
      type="button"
      onClick={() => onSelect(result.conversationId)}
      className={cn(
        "group flex w-full flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
        active
          ? "border-border/70 bg-background shadow-xs shadow-black/5"
          : "border-transparent bg-transparent hover:border-border/50 hover:bg-background/70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[calc(13px*var(--zone-font-scale,1))] text-foreground/90">
          {result.title}
        </span>
        <span className="shrink-0 text-[calc(10.5px*var(--zone-font-scale,1))] text-muted-foreground/70">
          {formatRelativeTime(result.updatedAt, locale)}
        </span>
      </div>
      {result.snippet ? (
        <div className="line-clamp-2 text-[calc(11.5px*var(--zone-font-scale,1))] leading-[1.5] text-muted-foreground/80">
          {result.snippet}
        </div>
      ) : null}
    </button>
  );
}

export function SidebarSearchResults(props: SidebarSearchResultsProps) {
  const { results, status, currentConversationId, onSelect } = props;
  const { locale, t } = useLocale();

  const titleResults = results.filter((result) => result.matchKind === "title");
  const contentResults = results.filter((result) => result.matchKind === "content");

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 pt-8 pb-6 text-center">
        <MessageSquareText className="h-[22px] w-[22px] text-foreground/35" strokeWidth={1.5} />
        <p className="mt-3 text-[calc(12.5px*var(--zone-font-scale,1))] font-medium tracking-tight text-foreground/70">
          {status === "searching"
            ? t("chat.searchSearching")
            : status === "error"
              ? t("chat.searchFailed")
              : t("chat.searchNoResults")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 pb-2">
      {titleResults.length > 0 ? (
        <div className="px-2 pb-0.5 pt-1 text-[calc(10.5px*var(--zone-font-scale,1))] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {t("chat.searchTitleMatches")}
        </div>
      ) : null}
      {titleResults.map((result) => (
        <SearchResultRow
          key={result.conversationId}
          result={result}
          active={result.conversationId === currentConversationId}
          locale={locale}
          onSelect={onSelect}
        />
      ))}
      {contentResults.length > 0 ? (
        <div className="px-2 pb-0.5 pt-1 text-[calc(10.5px*var(--zone-font-scale,1))] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {t("chat.searchContentMatches")}
        </div>
      ) : null}
      {contentResults.map((result) => (
        <SearchResultRow
          key={result.conversationId}
          result={result}
          active={result.conversationId === currentConversationId}
          locale={locale}
          onSelect={onSelect}
        />
      ))}
      {status === "searching" ? (
        <div className="px-2 pb-1 pt-1 text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground/70">
          {t("chat.searchSearching")}
        </div>
      ) : null}
    </div>
  );
}
