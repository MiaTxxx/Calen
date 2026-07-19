import { GlassPanel } from "../../components/hub/HubChrome";
import { AlertTriangle, LayoutGrid, Loader2 } from "../../components/icons";
import { cn } from "../../lib/shared/utils";
import type {
  AsyncResource,
  StockEvidenceMetadata,
  StockEvidenceResult,
  StockResultStatus,
} from "../../lib/stock-research";

export function EvidenceHeader({
  result,
  title,
}: {
  result: StockEvidenceMetadata;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <StatusBadge status={result.status} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          最早证据截至 {result.asOf ?? "未知"} · 获取于 {result.retrievedAt || "未知"}
          {result.cached ? " · 缓存" : ""}
        </div>
      </div>
      <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-[260px] sm:max-w-[56%]">
        {result.sources.map((source) => (
          <div
            key={source.id}
            title={source.url}
            className="rounded-xl border border-border/45 bg-background/60 px-2.5 py-1.5 text-[10px] text-muted-foreground"
          >
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="font-medium text-foreground/80">{source.name}</span>
              {source.provider && source.provider !== source.name ? (
                <span className="text-muted-foreground/75">({source.provider})</span>
              ) : null}
              <span className="text-muted-foreground/55">
                · {source.capability ?? "能力未标注"}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground/70">
              证据截至 {source.asOf ?? "未知"}
            </div>
          </div>
        ))}
      </div>
      {result.warnings.length ? (
        <div className="w-full rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          {result.warnings.join("；")}
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: StockResultStatus; label?: string }) {
  const text = label ?? (status === "ok" ? "完整" : status === "partial" ? "部分可用" : "不可用");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        status === "ok"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "partial"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "bg-destructive/10 text-destructive",
      )}
    >
      {text}
    </span>
  );
}

export function UnavailableCard<T>({ result }: { result: StockEvidenceResult<T> }) {
  return (
    <GlassPanel tone="error">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
        <div>
          <h2 className="text-sm font-semibold">数据暂不可用</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.warnings.join("；") || "当前 Provider 未返回可靠数据。"}
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}

export function LoadingCard({ text }: { text: string }) {
  return (
    <GlassPanel className="flex min-h-36 items-center justify-center">
      <LoadingInline text={text} />
    </GlassPanel>
  );
}

export function LoadingInline({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

export function ResourceError<T>({
  resource,
  panel = false,
}: {
  resource: AsyncResource<T>;
  panel?: boolean;
}) {
  if (resource.state !== "error") return null;
  const content = (
    <div className="flex items-start gap-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{resource.message}</span>
    </div>
  );
  return panel ? (
    <GlassPanel tone="error">{content}</GlassPanel>
  ) : (
    <div className="mt-3 rounded-xl bg-destructive/5 p-3">{content}</div>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
      <LayoutGrid className="h-4 w-4" />
      {text}
    </div>
  );
}

export function BulletSection({
  title,
  items,
  warning = false,
}: {
  title: string;
  items: string[];
  warning?: boolean;
}) {
  return (
    <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3">
      <div className={cn("text-xs font-semibold", warning && "text-amber-700 dark:text-amber-300")}>
        {title}
      </div>
      {items.length ? (
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">暂无</div>
      )}
    </div>
  );
}

export function Disclaimer() {
  return (
    <div className="mt-4 flex items-start gap-2 border-t border-border/35 pt-3 text-[11px] leading-4 text-muted-foreground">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      仅供研究与信息整理，不构成投资建议、收益承诺或交易指令。
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/45 px-3 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// 金额（人民币等）按亿/万缩写；比率与小数值原样保留。
export function formatCompactAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e8)
    return `${(value / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 亿`;
  if (abs >= 1e4)
    return `${(value / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
