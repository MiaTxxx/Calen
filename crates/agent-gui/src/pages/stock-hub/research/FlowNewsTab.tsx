import { cn } from "../../../lib/shared/utils";
import { Disclaimer, formatCompactAmount, StatusBadge } from "../shared";
import { type MoneyFlowPoint, parseMoneyFlow, parseNewsItems, sectionFor } from "./evidence";
import { ResearchTabPanel, type ResearchTabResource } from "./TabScaffold";

export function FlowNewsTab({ resource }: { resource: ResearchTabResource }) {
  return (
    <ResearchTabPanel
      resource={resource}
      title="资金与消息"
      loadingText="正在聚合资金流、新闻与公告…"
      auditSections={(bundle) => [
        { label: "moneyFlow", data: sectionFor(bundle, "moneyFlow")?.data },
        { label: "news", data: sectionFor(bundle, "news")?.data },
        { label: "notices", data: sectionFor(bundle, "notices")?.data },
      ]}
    >
      {(bundle) => {
        const flowSection = sectionFor(bundle, "moneyFlow");
        const newsSection = sectionFor(bundle, "news");
        const noticesSection = sectionFor(bundle, "notices");
        const flow = parseMoneyFlow(flowSection?.data);
        const news = parseNewsItems(newsSection?.data);
        const notices = parseNewsItems(noticesSection?.data);
        return (
          <>
            <section className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold">主力资金流（日）</h3>
                {flowSection ? <StatusBadge status={flowSection.status} /> : null}
              </div>
              {flow.length ? (
                <MoneyFlowChart series={flow} />
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {flowSection?.warnings.join("；") || "当前来源未返回资金流数据。"}
                </p>
              )}
            </section>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <NewsList
                title="相关新闻"
                status={flowStatus(newsSection)}
                items={news}
                emptyText={newsSection?.warnings.join("；") || "当前来源未返回新闻。"}
                warnings={newsSection?.warnings ?? []}
              />
              <NewsList
                title="公告"
                status={flowStatus(noticesSection)}
                items={notices}
                emptyText={noticesSection?.warnings.join("；") || "当前来源未返回公告。"}
                warnings={noticesSection?.warnings ?? []}
              />
            </div>
            <Disclaimer />
          </>
        );
      }}
    </ResearchTabPanel>
  );
}

function flowStatus(section: { status: "ok" | "partial" | "unavailable" } | null) {
  return section?.status ?? null;
}

// 逐日主力净流入：红入绿出的横向发散条形，近端汇总在顶部。
function MoneyFlowChart({ series }: { series: MoneyFlowPoint[] }) {
  const recent = series.slice(-20);
  const maxAbs = Math.max(...recent.map((point) => Math.abs(point.mainNetInflow ?? 0)), 1);
  const sumOf = (days: number) =>
    recent.slice(-days).reduce((total, point) => total + (point.mainNetInflow ?? 0), 0);
  const latest = recent.at(-1);
  const breakdown = latest
    ? ([
        ["超大单", latest.superLargeNetInflow],
        ["大单", latest.largeNetInflow],
        ["中单", latest.mediumNetInflow],
        ["小单", latest.smallNetInflow],
      ] as const)
    : [];
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <FlowSummary label="近 5 日主力净流入" value={sumOf(5)} />
        <FlowSummary label="近 20 日主力净流入" value={sumOf(20)} />
      </div>
      <div className="mt-3 space-y-1">
        {[...recent].reverse().map((point) => {
          const value = point.mainNetInflow;
          const inflow = (value ?? 0) >= 0;
          const width = value === null ? 0 : (Math.abs(value) / maxAbs) * 100;
          return (
            <div key={point.date} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 shrink-0 font-mono text-muted-foreground">{point.date}</span>
              <div className="flex h-3.5 flex-1">
                <div className="flex w-1/2 justify-end">
                  {!inflow && value !== null ? (
                    <div
                      className="h-full rounded-l-sm bg-emerald-500/60"
                      style={{ width: `${width / 2}%` }}
                    />
                  ) : null}
                </div>
                <div className="w-px bg-border/60" />
                <div className="flex w-1/2">
                  {inflow && value !== null ? (
                    <div
                      className="h-full rounded-r-sm bg-red-500/60"
                      style={{ width: `${width / 2}%` }}
                    />
                  ) : null}
                </div>
              </div>
              <span
                className={cn(
                  "w-24 shrink-0 text-right tabular-nums",
                  value === null
                    ? "text-muted-foreground"
                    : inflow
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {formatCompactAmount(value)}
              </span>
              <span className="hidden w-16 shrink-0 text-right tabular-nums text-muted-foreground sm:block">
                {point.changePercent === null ? "" : `${point.changePercent}%`}
              </span>
            </div>
          );
        })}
      </div>
      {breakdown.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {breakdown.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">最新日 · {label}</div>
              <div
                className={cn(
                  "mt-1 text-xs font-medium tabular-nums",
                  value === null
                    ? ""
                    : value >= 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {formatCompactAmount(value)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlowSummary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums",
          value >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {formatCompactAmount(value)}
      </div>
    </div>
  );
}

function NewsList({
  title,
  status,
  items,
  emptyText,
  warnings,
}: {
  title: string;
  status: "ok" | "partial" | "unavailable" | null;
  items: ReturnType<typeof parseNewsItems>;
  emptyText: string;
  warnings: string[];
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold">{title}</h3>
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {items.length ? (
        <div className="mt-3 space-y-2">
          {items.slice(0, 10).map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-border/35 bg-background/45 px-3 py-2.5"
            >
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs font-medium leading-5 hover:text-primary hover:underline"
                >
                  {item.title}
                </a>
              ) : (
                <div className="text-xs font-medium leading-5">{item.title}</div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] text-muted-foreground">
                {item.source ? <span>{item.source}</span> : null}
                {item.publishedAt ? <span>{item.publishedAt}</span> : null}
                {item.pdfUrl ? (
                  <a
                    href={item.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    附件 PDF
                  </a>
                ) : null}
              </div>
              {item.summary && item.summary !== item.title ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                  {item.summary}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{emptyText}</p>
      )}
      {items.length && warnings.length ? (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{warnings.join("；")}</p>
      ) : null}
    </section>
  );
}
