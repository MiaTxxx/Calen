import { Disclaimer, formatCompactAmount, StatusBadge } from "../shared";
import { parseDividends, parseShareholders, sectionFor } from "./evidence";
import { ResearchTabPanel, type ResearchTabResource } from "./TabScaffold";

export function HoldersTab({ resource }: { resource: ResearchTabResource }) {
  return (
    <ResearchTabPanel
      resource={resource}
      title="股东与分红"
      loadingText="正在聚合股东与分红数据…"
      auditSections={(bundle) => [
        { label: "shareholders", data: sectionFor(bundle, "shareholders")?.data },
        { label: "dividend", data: sectionFor(bundle, "dividend")?.data },
      ]}
    >
      {(bundle) => {
        const holdersSection = sectionFor(bundle, "shareholders");
        const dividendSection = sectionFor(bundle, "dividend");
        const holders = parseShareholders(holdersSection?.data);
        const dividends = parseDividends(dividendSection?.data);
        return (
          <>
            <section className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold">十大流通股东</h3>
                {holdersSection ? <StatusBadge status={holdersSection.status} /> : null}
                {holders?.reportDate ? (
                  <span className="text-[11px] text-muted-foreground">
                    截至 {holders.reportDate}
                  </span>
                ) : null}
              </div>
              {holders ? (
                <HolderBars holders={holders.topHolders} />
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {holdersSection?.warnings.join("；") || "当前来源未返回股东数据。"}
                </p>
              )}
              {holdersSection?.warnings.length && holders ? (
                <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                  {holdersSection.warnings.join("；")}
                </p>
              ) : null}
            </section>
            <section className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold">分红送转历史</h3>
                {dividendSection ? <StatusBadge status={dividendSection.status} /> : null}
              </div>
              {dividends.length ? (
                <DividendTable rows={dividends} />
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {dividendSection?.warnings.join("；") || "当前来源未返回分红记录。"}
                </p>
              )}
            </section>
            <Disclaimer />
          </>
        );
      }}
    </ResearchTabPanel>
  );
}

function HolderBars({
  holders,
}: {
  holders: NonNullable<ReturnType<typeof parseShareholders>>["topHolders"];
}) {
  const maxRatio = Math.max(...holders.map((holder) => holder.ratioPercent ?? 0), 1);
  return (
    <div className="mt-3 space-y-2">
      {holders.map((holder) => (
        <div key={`${holder.rank ?? ""}-${holder.name}`} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {holder.rank ?? "—"}
          </span>
          <div className="w-44 min-w-0 shrink-0">
            <div className="truncate text-xs" title={holder.name}>
              {holder.name}
            </div>
            {holder.holderType || holder.change ? (
              <div className="truncate text-[10.5px] text-muted-foreground">
                {[holder.holderType, holder.change].filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${((holder.ratioPercent ?? 0) / maxRatio) * 100}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums">
            {holder.ratioPercent === null ? "—" : `${holder.ratioPercent}%`}
          </span>
          <span className="hidden w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground sm:block">
            {holder.marketValue === null ? "" : formatCompactAmount(holder.marketValue)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DividendTable({ rows }: { rows: ReturnType<typeof parseDividends> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-border/40">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-border/40 bg-muted/25 text-muted-foreground">
            <th className="px-3 py-2 font-medium">报告期</th>
            <th className="px-3 py-2 text-right font-medium">每10股派现（税前）</th>
            <th className="px-3 py-2 text-right font-medium">每10股送转</th>
            <th className="px-3 py-2 font-medium">股权登记日</th>
            <th className="px-3 py-2 font-medium">除权除息日</th>
            <th className="px-3 py-2 font-medium">进度</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row) => {
            const bonus = [
              row.bonusSharesPer10 !== null ? `送 ${row.bonusSharesPer10}` : null,
              row.capitalizationPer10 !== null ? `转 ${row.capitalizationPer10}` : null,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr
                key={`${row.reportDate}-${row.exDividendDate ?? ""}`}
                title={row.planSummary ?? undefined}
                className="border-b border-border/20 last:border-0"
              >
                <td className="px-3 py-2">{row.reportDate}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.cashDividendPer10Shares === null ? "—" : `${row.cashDividendPer10Shares} 元`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{bonus || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.recordDate ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.exDividendDate ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.progress ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
