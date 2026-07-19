import { cn } from "../../../lib/shared/utils";
import { Disclaimer, formatCompactAmount, StatusBadge } from "../shared";
import { type FinancialPeriod, parseFinancials, reportPeriodLabel, sectionFor } from "./evidence";
import { ResearchTabPanel, type ResearchTabResource } from "./TabScaffold";

// 三表关键科目：分组 + 中文标签 + 值格式，缺失科目整行隐藏，绝不以 0 填充。
const STATEMENT_GROUPS: Array<{
  group: string;
  statement: keyof Pick<FinancialPeriod, "income" | "balance" | "cashFlow">;
  rows: Array<{ key: string; label: string; percent?: boolean }>;
}> = [
  {
    group: "利润表",
    statement: "income",
    rows: [
      { key: "totalOperatingRevenue", label: "营业总收入" },
      { key: "totalOperatingCost", label: "营业总成本" },
      { key: "operatingProfit", label: "营业利润" },
      { key: "totalProfit", label: "利润总额" },
      { key: "netProfit", label: "归母净利润" },
      { key: "deductedNetProfit", label: "扣非净利润" },
    ],
  },
  {
    group: "资产负债表",
    statement: "balance",
    rows: [
      { key: "totalAssets", label: "总资产" },
      { key: "totalLiabilities", label: "总负债" },
      { key: "totalEquity", label: "股东权益" },
      { key: "monetaryFunds", label: "货币资金" },
      { key: "inventory", label: "存货" },
      { key: "debtAssetRatio", label: "资产负债率", percent: true },
    ],
  },
  {
    group: "现金流量表",
    statement: "cashFlow",
    rows: [
      { key: "operatingCashFlow", label: "经营活动现金流" },
      { key: "investingCashFlow", label: "投资活动现金流" },
      { key: "financingCashFlow", label: "筹资活动现金流" },
      { key: "cashIncrease", label: "现金及等价物净增加" },
      { key: "endingCash", label: "期末现金及等价物" },
    ],
  },
];

export function FinancialsTab({ resource }: { resource: ResearchTabResource }) {
  return (
    <ResearchTabPanel
      resource={resource}
      title="财务"
      loadingText="正在聚合财务三表与来源…"
      auditSections={(bundle) => [
        { label: "financials", data: sectionFor(bundle, "financials")?.data },
      ]}
    >
      {(bundle) => {
        const section = sectionFor(bundle, "financials");
        const financials = parseFinancials(section?.data);
        if (!financials) {
          return (
            <p className="mt-4 text-xs text-muted-foreground">
              {section?.warnings.join("；") || "当前来源未返回标准化财务三表。"}
            </p>
          );
        }
        // Provider 返回最新在前；趋势图按时间从左到右展示。
        const chronological = [...financials.periods].reverse();
        return (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {section ? <StatusBadge status={section.status} /> : null}
              {financials.coverage ? (
                <span>
                  报告期覆盖：返回{" "}
                  {financials.coverage.returnedPeriods ?? financials.periods.length} / 请求{" "}
                  {financials.coverage.requestedPeriods ?? "—"} 期 · 三表完整{" "}
                  {financials.coverage.completePeriods ?? 0} 期
                </span>
              ) : (
                <span>报告期覆盖：返回 {financials.periods.length} 期</span>
              )}
              {financials.missingStatements.length ? (
                <span className="text-amber-700 dark:text-amber-300">
                  缺失报表：{financials.missingStatements.join("、")}
                </span>
              ) : null}
            </div>
            <TrendChart periods={chronological} />
            <StatementTable periods={financials.periods} />
            {section?.warnings.length ? (
              <p className="mt-3 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                {section.warnings.join("；")}
              </p>
            ) : null}
            <Disclaimer />
          </>
        );
      }}
    </ResearchTabPanel>
  );
}

// 营收与净利润的分组柱状图：CSS 实现，负值向下并变色，值标签常显。
function TrendChart({ periods }: { periods: FinancialPeriod[] }) {
  const series = periods.map((period) => ({
    label: reportPeriodLabel(period.reportDate),
    revenue: period.income.totalOperatingRevenue ?? null,
    netProfit: period.income.netProfit ?? null,
  }));
  const values = series.flatMap((entry) =>
    [entry.revenue, entry.netProfit].filter((value): value is number => value !== null),
  );
  if (!values.length) return null;
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  return (
    <section className="mt-4 rounded-2xl border border-border/40 bg-background/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">营收与净利润趋势</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary/70" />
            营业总收入
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-sky-500/70" />
            归母净利润
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-around gap-2">
        {series.map((entry) => (
          <div key={entry.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-32 items-end gap-1.5">
              <TrendBar value={entry.revenue} maxAbs={maxAbs} tone="revenue" />
              <TrendBar value={entry.netProfit} maxAbs={maxAbs} tone="profit" />
            </div>
            <div className="text-[11px] text-muted-foreground">{entry.label}</div>
            <div className="text-center text-[10.5px] leading-4 text-muted-foreground">
              <div className="tabular-nums">{formatCompactAmount(entry.revenue)}</div>
              <div className="tabular-nums">{formatCompactAmount(entry.netProfit)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrendBar({
  value,
  maxAbs,
  tone,
}: {
  value: number | null;
  maxAbs: number;
  tone: "revenue" | "profit";
}) {
  if (value === null) {
    return (
      <div
        className="w-5 rounded-t-sm border border-dashed border-border/50"
        style={{ height: 4 }}
      />
    );
  }
  const height = Math.max((Math.abs(value) / maxAbs) * 120, 3);
  return (
    <div
      title={value.toLocaleString("zh-CN")}
      className={cn(
        "w-5 rounded-t-sm",
        value < 0 ? "bg-emerald-500/65" : tone === "revenue" ? "bg-primary/70" : "bg-sky-500/70",
      )}
      style={{ height }}
    />
  );
}

function StatementTable({ periods }: { periods: FinancialPeriod[] }) {
  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold">三表关键科目</h3>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-border/40">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-muted/25 text-muted-foreground">
              <th className="px-3 py-2 font-medium">科目</th>
              {periods.map((period) => (
                <th key={period.reportDate} className="px-3 py-2 text-right font-medium">
                  {reportPeriodLabel(period.reportDate)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATEMENT_GROUPS.map((group) => {
              const rows = group.rows.filter((row) =>
                periods.some(
                  (period) =>
                    period[group.statement][row.key] !== null &&
                    period[group.statement][row.key] !== undefined,
                ),
              );
              if (!rows.length) return null;
              return (
                <FragmentGroup
                  key={group.group}
                  title={group.group}
                  columnCount={periods.length + 1}
                >
                  {rows.map((row) => (
                    <tr key={row.key} className="border-b border-border/20 last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                      {periods.map((period) => {
                        const value = period[group.statement][row.key] ?? null;
                        return (
                          <td key={period.reportDate} className="px-3 py-2 text-right tabular-nums">
                            {value === null
                              ? "—"
                              : row.percent
                                ? `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`
                                : formatCompactAmount(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </FragmentGroup>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        金额按亿/万缩写；缺失科目显示 — 而非补零。
      </p>
    </section>
  );
}

function FragmentGroup({
  title,
  columnCount,
  children,
}: {
  title: string;
  columnCount: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-b border-border/30 bg-muted/15">
        <td colSpan={columnCount} className="px-3 py-1.5 text-[11px] font-semibold">
          {title}
        </td>
      </tr>
      {children}
    </>
  );
}
