import { type FormEvent, useCallback, useEffect, useState } from "react";
import { GlassPanel, HubBackdrop, HubHeader } from "../../components/hub/HubChrome";
import {
  AlertTriangle,
  Key,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Zap,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { applyCronOps, getAutomationState, initAutomation } from "../../lib/automation/store";
import { cn } from "../../lib/shared/utils";
import {
  type AsyncResource,
  type BacktestResult,
  formatStockError,
  type InstrumentRef,
  type InstrumentSearchResult,
  type MarketBrief,
  parseFiniteNumber,
  type QuoteSnapshot,
  type ResearchBundle,
  type StockBacktestStrategyId,
  type StockEvidenceMetadata,
  type StockEvidenceResult,
  type StockResultStatus,
  type StockServiceStatus,
  type StockSettings,
  type StockSettingsSavePayload,
  stockResearch,
} from "../../lib/stock-research";
import { PortfolioWorkspace } from "./PortfolioWorkspace";
import { StockChart } from "./StockChart";

export type StockHubView = "research" | "market" | "portfolio" | "lab" | "sources";

type Props = {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  initialView?: StockHubView;
  selectedModel?: { customProviderId: string; model: string };
};

const views: Array<{ value: StockHubView; label: string; hint: string }> = [
  { value: "research", label: "研究", hint: "行情、财务与证据化研究" },
  { value: "market", label: "市场", hint: "热点、资金流与复盘" },
  { value: "portfolio", label: "自选与持仓", hint: "流水与组合暴露" },
  { value: "lab", label: "实验室", hint: "策略评分与回测" },
  { value: "sources", label: "数据源", hint: "服务状态与能力" },
];

export function StockHubPage({
  sidebarOpen,
  onOpenSidebar,
  initialView = "research",
  selectedModel,
}: Props) {
  const [view, setView] = useState<StockHubView>(initialView);
  const [status, setStatus] = useState<AsyncResource<StockServiceStatus>>({
    state: "idle",
  });

  const refreshStatus = useCallback(async () => {
    setStatus({ state: "loading" });
    try {
      setStatus({ state: "ready", data: await stockResearch.status() });
    } catch (error) {
      setStatus({ state: "error", message: formatStockError(error) });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  return (
    <div className="hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <HubBackdrop tone="neutral" />
      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <HubHeader
          icon={<Zap className="h-5 w-5" />}
          title="股票研究"
          subtitle="基于来源、时效和不确定性的本地投研工作台"
          sidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
          actions={<ServicePill resource={status} />}
        />
        <div className="hub-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2 sm:px-6 lg:px-8 xl:px-10">
          <div className="hub-content-stage mx-auto flex w-full max-w-[1320px] flex-col gap-4">
            <nav className="hub-panel-enter grid grid-cols-2 gap-1 rounded-2xl border border-border/40 bg-background/60 p-1 backdrop-blur-xl sm:grid-cols-5">
              {views.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setView(item.value)}
                  className={cn(
                    "rounded-xl px-3 py-2 text-left transition-all",
                    view === item.value
                      ? "bg-background/90 text-foreground shadow-sm ring-1 ring-border/45 dark:bg-white/[0.08]"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                >
                  <div className="text-[12.5px] font-semibold">{item.label}</div>
                  <div className="mt-0.5 hidden truncate text-[10.5px] opacity-75 lg:block">
                    {item.hint}
                  </div>
                </button>
              ))}
            </nav>
            {view === "research" ? <ResearchView /> : null}
            {view === "market" ? <MarketView selectedModel={selectedModel} /> : null}
            {view === "portfolio" ? <PortfolioView /> : null}
            {view === "lab" ? <LabView /> : null}
            {view === "sources" ? (
              <SourcesView resource={status} onRefresh={refreshStatus} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServicePill({ resource }: { resource: AsyncResource<StockServiceStatus> }) {
  const ready = resource.state === "ready" && resource.data.state === "ready";
  return (
    <div
      className={cn(
        "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] sm:flex",
        ready
          ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          : "border-border/45 bg-background/60 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ready
            ? "bg-emerald-500"
            : resource.state === "loading"
              ? "animate-pulse bg-amber-500"
              : "bg-muted-foreground/50",
        )}
      />
      {ready ? "股票服务已就绪" : resource.state === "loading" ? "正在连接" : "服务未就绪"}
    </div>
  );
}

function ResearchView() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AsyncResource<InstrumentSearchResult>>({ state: "idle" });
  const [selected, setSelected] = useState<InstrumentRef | null>(null);
  const [snapshot, setSnapshot] = useState<AsyncResource<StockEvidenceResult<QuoteSnapshot>>>({
    state: "idle",
  });
  const [research, setResearch] = useState<AsyncResource<StockEvidenceResult<ResearchBundle>>>({
    state: "idle",
  });

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setMatches({ state: "loading" });
    try {
      setMatches({
        state: "ready",
        data: await stockResearch.resolve({ query: query.trim(), limit: 8 }),
      });
    } catch (error) {
      setMatches({ state: "error", message: formatStockError(error) });
    }
  }

  async function inspect(instrument: InstrumentRef) {
    setSelected(instrument);
    setSnapshot({ state: "loading" });
    setResearch({ state: "idle" });
    try {
      setSnapshot({
        state: "ready",
        data: await stockResearch.snapshot({
          instrument,
          includeHistory: true,
        }),
      });
    } catch (error) {
      setSnapshot({ state: "error", message: formatStockError(error) });
    }
  }

  async function runResearch() {
    if (!selected) return;
    setResearch({ state: "loading" });
    try {
      setResearch({
        state: "ready",
        data: await stockResearch.research({
          instrument: selected,
          capabilities: [
            "quote",
            "history",
            "profile",
            "financials",
            "shareholders",
            "dividends",
            "capital_flow",
            "news",
            "notices",
            ...(selected.assetType === "etf" ? (["etf"] as const) : []),
            "technical",
            "score",
            "strategy",
            "evaluator",
          ],
        }),
      });
    } catch (error) {
      setResearch({ state: "error", message: formatStockError(error) });
    }
  }

  return (
    <div className="grid min-h-[480px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <GlassPanel className="h-fit">
        <div className="mb-3 text-sm font-semibold">查找标的</div>
        <form onSubmit={search} className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="代码、公司名或 ETF"
            aria-label="股票搜索"
          />
          <Button type="submit" size="icon" disabled={matches.state === "loading"}>
            {matches.state === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>
        <ResourceError resource={matches} />
        {matches.state === "ready" ? (
          <div className="mt-3 space-y-3">
            <EvidenceHeader result={matches.data} title="搜索结果" />
            {matches.data.instruments.length === 0 ? (
              <EmptyLine text="没有找到匹配标的" />
            ) : (
              <div className="space-y-1">
                {matches.data.instruments.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void inspect(item)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-muted/55",
                      selected?.id === item.id && "bg-muted/70 ring-1 ring-border/50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{item.name}</span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {item.market} · {item.exchange}
                      </span>
                    </span>
                    <span className="ml-3 font-mono text-xs">{item.symbol}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </GlassPanel>
      <div className="space-y-4">
        {snapshot.state === "idle" ? <WelcomeCard /> : null}
        {snapshot.state === "loading" ? <LoadingCard text="正在聚合行情与来源…" /> : null}
        <ResourceError resource={snapshot} panel />
        {snapshot.state === "ready" ? (
          <SnapshotCard
            result={snapshot.data}
            onResearch={runResearch}
            researchLoading={research.state === "loading"}
          />
        ) : null}
        {research.state === "loading" ? (
          <LoadingCard text="正在整理事实、风险与待验证事项…" />
        ) : null}
        <ResourceError resource={research} panel />
        {research.state === "ready" ? <ResearchCard result={research.data} /> : null}
      </div>
    </div>
  );
}

function WelcomeCard() {
  return (
    <GlassPanel className="flex min-h-[330px] flex-col items-center justify-center text-center">
      <Sparkles className="h-8 w-8 text-foreground/45" />
      <h2 className="mt-4 text-base font-semibold">从一个标的开始研究</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
        Calen 会先展示可核验的行情与来源，再按需生成研究简报。缺失数据会明确标注，不会由模型补造。
      </p>
    </GlassPanel>
  );
}

function SnapshotCard({
  result,
  onResearch,
  researchLoading,
}: {
  result: StockEvidenceResult<QuoteSnapshot>;
  onResearch: () => void;
  researchLoading: boolean;
}) {
  const data = result.data;
  if (!data) return <UnavailableCard result={result} />;
  const chart = data.chart?.map((point) => point.close) ?? [];
  const up = (data.changePercent ?? 0) >= 0;
  return (
    <GlassPanel>
      <EvidenceHeader
        result={result}
        title={`${data.instrument.name} · ${data.instrument.symbol}`}
      />
      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <span className="text-3xl font-semibold tabular-nums">{data.price ?? "—"}</span>
        <span
          className={cn(
            "pb-1 text-sm font-medium",
            up ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {data.change === null ? "" : `${up ? "+" : ""}${data.change}`}{" "}
          {data.changePercent === null ? "" : `(${up ? "+" : ""}${data.changePercent}%)`}
        </span>
        <span className="pb-1 text-xs text-muted-foreground">{data.instrument.currency}</span>
      </div>
      <StockChart values={chart} bars={data.chart} positive={up} className="mt-4" />
      {data.facts?.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {data.facts.map((fact) => (
            <div key={fact.label} className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[10.5px] text-muted-foreground">{fact.label}</div>
              <div className="mt-1 text-xs font-medium">{fact.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button
          onClick={onResearch}
          disabled={researchLoading || result.status === "unavailable"}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          生成深度研究
        </Button>
      </div>
    </GlassPanel>
  );
}

function ResearchCard({ result }: { result: StockEvidenceResult<ResearchBundle> }) {
  if (!result.data) return <UnavailableCard result={result} />;
  const data = result.data;
  return (
    <GlassPanel>
      <EvidenceHeader result={result} title={data.title} />
      <p className="mt-3 text-[13px] leading-6 text-foreground/85">{data.summary}</p>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">事实与证据</h3>
          <span className="text-[10px] text-muted-foreground">Provider 返回的事实数据</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <BulletSection title="关键事实" items={data.facts} />
          <BulletSection title="支持论据" items={data.positiveCases} />
          <BulletSection title="主要风险" items={data.risks} warning />
          <BulletSection title="待验证事项" items={data.openQuestions} />
        </div>
      </div>
      {data.evidenceSections.length ? <ResearchEvidenceSections data={data} /> : null}
      {data.experimentalAnalysis.length || data.analysisMetadata ? (
        <ExperimentalResearchSection data={data} />
      ) : null}
      <Disclaimer />
    </GlassPanel>
  );
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function evidenceItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(evidenceRecord).filter((item) => Object.keys(item).length)
    : [];
}

function evidenceValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("zh-CN");
  return null;
}

type EvidenceRow = { title: string; detail: string; url?: string | null };

function sectionRows(
  capability: ResearchBundle["evidenceSections"][number]["capability"],
  data: unknown,
): EvidenceRow[] {
  const root = evidenceRecord(data);
  if (capability === "financials") {
    const statements = evidenceRecord(root.statements);
    return Object.entries(statements).flatMap(([statement, value]) => {
      const fields = evidenceRecord(value);
      return Object.entries(fields).flatMap(([key, field]) => {
        const rendered = evidenceValue(field);
        return rendered ? [{ title: `${statement}.${key}`, detail: rendered }] : [];
      });
    });
  }
  const collection =
    capability === "shareholders"
      ? evidenceItems(root.topHolders)
      : capability === "dividend"
        ? evidenceItems(root.history)
        : capability === "moneyFlow"
          ? evidenceItems(root.series)
          : capability === "news" || capability === "notices"
            ? evidenceItems(root.items)
            : capability === "etf"
              ? evidenceItems(root.holdings ?? root.topHoldings)
              : [];
  if (collection.length) {
    return collection.slice(0, 8).map((item, index) => ({
      title:
        evidenceValue(
          item.title ?? item.name ?? item.securityName ?? item.date ?? item.reportDate,
        ) ?? `第 ${index + 1} 项`,
      detail:
        evidenceValue(
          item.content ??
            item.summary ??
            item.ratio ??
            item.holdingRatio ??
            item.cashDividendPer10Shares ??
            item.mainNetInflow ??
            item.value,
        ) ?? "已返回结构化数据",
      url: evidenceValue(item.url ?? item.pdfUrl),
    }));
  }
  return Object.entries(root).flatMap(([key, value]) => {
    const rendered = evidenceValue(value);
    return rendered ? [{ title: key, detail: rendered }] : [];
  });
}

function ResearchEvidenceSections({ data }: { data: ResearchBundle }) {
  const labels = {
    profile: "公司资料",
    financials: "财务三表",
    shareholders: "主要股东",
    dividend: "分红记录",
    moneyFlow: "资金流",
    news: "相关新闻",
    notices: "公告与正文",
    etf: "ETF 净值与持仓",
  } as const;
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">结构化研究资料</h3>
        <span className="text-[10px] text-muted-foreground">
          财务、股东、公告与专题按来源原样展示
        </span>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {data.evidenceSections.map((section) => {
          const rows = sectionRows(section.capability, section.data);
          return (
            <div
              key={section.capability}
              className="rounded-2xl border border-border/40 bg-background/45 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11.5px] font-semibold">{labels[section.capability]}</h4>
                <StatusBadge status={section.status} />
              </div>
              {rows.length ? (
                <div className="mt-3 space-y-2">
                  {rows.map((row) => (
                    <div
                      key={`${row.title}-${row.detail.slice(0, 48)}-${row.url ?? ""}`}
                      className="rounded-xl bg-muted/35 px-3 py-2"
                    >
                      <div className="text-[10.5px] font-medium">{row.title}</div>
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-[10px] leading-4 text-muted-foreground">
                        {row.detail}
                      </p>
                      {row.url ? (
                        <a
                          className="mt-1 inline-block text-[10px] text-primary hover:underline"
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开来源或附件
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[10.5px] text-muted-foreground">
                  当前来源没有可展开的结构化字段。
                </p>
              )}
              {section.warnings.length ? (
                <p className="mt-3 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                  {section.warnings.join("；")}
                </p>
              ) : null}
              <details className="mt-3 rounded-xl border border-border/35 px-3 py-2">
                <summary className="cursor-pointer text-[10.5px] text-muted-foreground">
                  原始字段
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[9.5px] leading-4 text-muted-foreground">
                  {JSON.stringify(section.data, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExperimentalResearchSection({ data }: { data: ResearchBundle }) {
  const metadata = data.analysisMetadata;
  const capabilityLabels = {
    technical: "技术指标",
    score: "评分卡",
    strategy: "策略信号",
    evaluator: "Evaluator",
  } as const;
  return (
    <section className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold">实验性量化分析</h3>
            <StatusBadge status="partial" label="实验性" />
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            与事实数据分区展示，仅用于可复算的研究实验，不构成交易指令。
          </p>
        </div>
      </div>

      {metadata ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ResearchMetadataItem
              label="算法与版本"
              value={`${metadata.algorithm.id} @ ${metadata.algorithm.version}`}
            />
            <ResearchMetadataItem
              label="样本区间"
              value={`${metadata.sample.start ?? "未提供"} — ${metadata.sample.end ?? "未提供"} · ${metadata.sample.bars} 根`}
            />
            <ResearchMetadataItem
              label="样本覆盖率"
              value={`${(metadata.sample.coverage * 100).toFixed(1)}%`}
            />
            <ResearchMetadataItem
              label="基准"
              value={`${metadata.benchmark.name}${
                metadata.benchmark.returnPercent === null
                  ? " · 收益未提供"
                  : ` · ${metadata.benchmark.returnPercent.toFixed(2)}%`
              }`}
            />
          </div>
          <details className="mt-3 rounded-xl border border-violet-500/15 bg-background/45 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium">算法参数</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground">
              {JSON.stringify(metadata.algorithm.parameters, null, 2)}
            </pre>
          </details>
        </>
      ) : null}

      {data.experimentalAnalysis.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.experimentalAnalysis.map((analysis) => (
            <div
              key={analysis.capability}
              className="rounded-xl border border-violet-500/15 bg-background/55 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold">
                  {capabilityLabels[analysis.capability]}
                </span>
                <StatusBadge status={analysis.status} />
              </div>
              <p className="mt-2 break-words text-[10.5px] leading-5 text-muted-foreground">
                {analysis.summary ?? "当前样本未返回可展示结果。"}
              </p>
              {analysis.warnings.length ? (
                <p className="mt-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                  {analysis.warnings.join("；")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {metadata?.limitations.length ? (
        <BulletSection title="限制说明" items={metadata.limitations} warning />
      ) : null}
    </section>
  );
}

function ResearchMetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-violet-500/15 bg-background/55 p-3">
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-[11px] font-medium">{value}</div>
    </div>
  );
}

function MarketView({ selectedModel }: { selectedModel?: Props["selectedModel"] }) {
  const [brief, setBrief] = useState<AsyncResource<StockEvidenceResult<MarketBrief>>>({
    state: "idle",
  });
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBrief({ state: "loading" });
    try {
      setBrief({
        state: "ready",
        data: await stockResearch.marketBrief({
          market: "CN",
          session: "on_demand",
        }),
      });
    } catch (error) {
      setBrief({ state: "error", message: formatStockError(error) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function createMarketSchedule(kind: "pre-open" | "close") {
    setScheduleMessage(null);
    if (!selectedModel) {
      setScheduleMessage("请先在主对话中选择一个可用模型，再创建定时报告。");
      return;
    }
    try {
      await initAutomation();
      const preset =
        kind === "pre-open"
          ? {
              id: "calen-stock-pre-open",
              name: "股票盘前报告",
              description: "工作日盘前生成 A 股证据化市场报告",
              cron: "0 30 8 * * 1-5",
              prompt:
                "请调用 StockMarketBrief 生成 A 股盘前报告。必须展示数据来源、截至时间、获取时间和警告；缺失板块、资金流或情绪数据时明确标记 partial，不得补造，也不得输出买卖指令。",
            }
          : {
              id: "calen-stock-close-review",
              name: "股票收盘复盘",
              description: "工作日收盘后生成 A 股证据化复盘",
              cron: "0 30 15 * * 1-5",
              prompt:
                "请调用 StockMarketBrief 生成 A 股收盘复盘，覆盖涨跌停、热股、板块、资金流、龙虎榜、异动和市场情绪。必须展示来源和截至时间；任何缺失数据均标记 partial，不得补造或给出确定性交易建议。",
            };
      const existing = getAutomationState().cron.tasks.find((task) => task.id === preset.id);
      await applyCronOps([
        existing
          ? {
              op: "update",
              id: preset.id,
              patch: {
                ...preset,
                enabled: true,
                type: "prompt",
                selectedModel,
              },
            }
          : {
              op: "create",
              item: {
                ...preset,
                enabled: true,
                type: "prompt",
                selectedModel,
              },
            },
      ]);
      setScheduleMessage(
        kind === "pre-open"
          ? "盘前报告任务已保存：工作日 08:30 执行。"
          : "收盘复盘任务已保存：工作日 15:30 执行。",
      );
    } catch (error) {
      setScheduleMessage(`创建定时报告失败：${formatStockError(error)}`);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void createMarketSchedule("pre-open")}>
          创建盘前任务
        </Button>
        <Button variant="outline" size="sm" onClick={() => void createMarketSchedule("close")}>
          创建收盘复盘
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={brief.state === "loading"}
          className="gap-2"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", brief.state === "loading" && "animate-spin")} />
          刷新市场
        </Button>
      </div>
      {scheduleMessage ? (
        <div className="rounded-xl border border-border/40 bg-background/55 px-3 py-2 text-[11px] text-muted-foreground">
          {scheduleMessage}
        </div>
      ) : null}
      {brief.state === "loading" ? <LoadingCard text="正在生成 A 股市场概览…" /> : null}
      <ResourceError resource={brief} panel />
      {brief.state === "ready" && brief.data.data ? (
        <GlassPanel>
          <EvidenceHeader result={brief.data} title={brief.data.data.title} />
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{brief.data.data.summary}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {brief.data.data.highlights.map((item) => (
              <div
                key={`${item.title}-${item.value ?? ""}`}
                className="rounded-2xl border border-border/40 bg-background/55 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{item.title}</span>
                  {item.value ? (
                    <span
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        item.tone === "up"
                          ? "text-red-600"
                          : item.tone === "down"
                            ? "text-emerald-600"
                            : "",
                      )}
                    >
                      {item.value}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
          <Disclaimer />
        </GlassPanel>
      ) : null}
      {brief.state === "ready" && !brief.data.data ? <UnavailableCard result={brief.data} /> : null}
    </div>
  );
}

function PortfolioView() {
  return <PortfolioWorkspace />;
}
function LabView() {
  const [symbol, setSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [period, setPeriod] = useState("20");
  const [strategy, setStrategy] = useState<StockBacktestStrategyId>("fused");
  const [result, setResult] = useState<AsyncResource<StockEvidenceResult<BacktestResult>>>({
    state: "idle",
  });
  async function run(event: FormEvent) {
    event.preventDefault();
    const parsedPeriod = parseFiniteNumber(period);
    if (!symbol.trim() || !from || !to || (strategy === "sma-cross" && parsedPeriod === null))
      return;
    setResult({ state: "loading" });
    try {
      const matches = await stockResearch.resolve({
        query: symbol.trim(),
        limit: 1,
      });
      const instrument = matches.instruments[0];
      if (!instrument) throw new Error("未找到回测标的");
      setResult({
        state: "ready",
        data: await stockResearch.backtest({
          instrument,
          strategy,
          from,
          to,
          parameters: strategy === "sma-cross" ? { period: parsedPeriod } : {},
          benchmark: "market",
        }),
      });
    } catch (error) {
      setResult({ state: "error", message: formatStockError(error) });
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <GlassPanel className="h-fit">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <h2 className="text-sm font-semibold">策略回测</h2>
          <StatusBadge status="partial" label="实验性" />
        </div>
        <form onSubmit={run} className="mt-4 space-y-3">
          <Field label="标的">
            <Input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="例如 600519"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="开始日期">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="结束日期">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          <Field label="策略模型">
            <select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as StockBacktestStrategyId)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="fused">多策略融合</option>
              <option value="trend">趋势跟踪</option>
              <option value="mean-reversion">均值回归</option>
              <option value="breakout">区间突破</option>
              <option value="momentum">动量交叉</option>
              <option value="volume-price">量价确认</option>
              <option value="sma-cross">SMA 交叉</option>
            </select>
          </Field>
          <Field label="均线周期">
            <Input
              inputMode="numeric"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              disabled={strategy !== "sma-cross"}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={result.state === "loading"}>
            {result.state === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            运行回测
          </Button>
        </form>
        <Disclaimer />
      </GlassPanel>
      <div>
        {result.state === "idle" ? (
          <GlassPanel className="flex min-h-[350px] items-center justify-center text-center text-xs text-muted-foreground">
            回测结果会显示算法版本、样本覆盖、基准与限制。
          </GlassPanel>
        ) : null}
        {result.state === "loading" ? (
          <LoadingCard text="按时间切分加载历史数据并执行回测…" />
        ) : null}
        <ResourceError resource={result} panel />
        {result.state === "ready" && result.data.data ? (
          <BacktestCard result={result.data} />
        ) : null}
        {result.state === "ready" && !result.data.data ? (
          <UnavailableCard result={result.data} />
        ) : null}
      </div>
    </div>
  );
}

function BacktestCard({ result }: { result: StockEvidenceResult<BacktestResult> }) {
  const data = result.data;
  if (!data) return null;
  return (
    <GlassPanel>
      <EvidenceHeader result={result} title="回测结果" />
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric
          label="策略收益"
          value={data.returnPercent === null ? "—" : `${data.returnPercent}%`}
        />
        <Metric
          label="基准收益"
          value={data.benchmarkReturnPercent === null ? "—" : `${data.benchmarkReturnPercent}%`}
        />
        <Metric
          label="最大回撤"
          value={data.maxDrawdownPercent === null ? "—" : `${data.maxDrawdownPercent}%`}
        />
        <Metric label="数据覆盖" value={`${Math.round(data.coverage * 100)}%`} />
      </div>
      <StockChart
        values={data.equityCurve ?? []}
        positive={(data.returnPercent ?? 0) >= 0}
        className="mt-4"
        label="回测权益曲线"
      />
      <div className="mt-3 text-[11px] text-muted-foreground">
        {data.algorithmId} v{data.algorithmVersion} · {data.sample.from} 至 {data.sample.to} ·{" "}
        {data.sample.points} 个样本 · 基准 {data.benchmark}
      </div>
      {data.limitations.length ? (
        <BulletSection title="限制说明" items={data.limitations} warning />
      ) : null}
      <Disclaimer />
    </GlassPanel>
  );
}

function SourcesView({
  resource,
  onRefresh,
}: {
  resource: AsyncResource<StockServiceStatus>;
  onRefresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<AsyncResource<StockSettings>>({
    state: "idle",
  });
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [clearKeys, setClearKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettings({ state: "loading" });
    try {
      setSettings({ state: "ready", data: await stockResearch.settingsGet() });
    } catch (error) {
      setSettings({ state: "error", message: formatStockError(error) });
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateSettings(updater: (current: StockSettings) => StockSettings) {
    setSettings((current) =>
      current.state === "ready" ? { state: "ready", data: updater(current.data) } : current,
    );
    setSaved(false);
  }

  async function saveSettings() {
    if (settings.state !== "ready") return;
    const providerKeyUpdates: StockSettingsSavePayload["providerKeyUpdates"] = {};
    for (const provider of keyedProviders) {
      const draft = keyDrafts[provider.id]?.trim();
      if (clearKeys[provider.id]) providerKeyUpdates[provider.id] = null;
      else if (draft) providerKeyUpdates[provider.id] = draft;
    }
    const payload: StockSettingsSavePayload = {
      ...settings.data,
      ...(Object.keys(providerKeyUpdates).length ? { providerKeyUpdates } : {}),
    };
    setSaving(true);
    setSaved(false);
    try {
      const next = await stockResearch.settingsSave(payload);
      setSettings({ state: "ready", data: next });
      setKeyDrafts({});
      setClearKeys({});
      setSaved(true);
      await onRefresh();
    } catch (error) {
      setSettings({ state: "error", message: formatStockError(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void Promise.all([onRefresh(), loadSettings()])}
          disabled={resource.state === "loading"}
          className="gap-2"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", resource.state === "loading" && "animate-spin")}
          />
          刷新状态
        </Button>
      </div>
      {resource.state === "loading" ? <LoadingCard text="检查 sidecar 与 Provider…" /> : null}
      <ResourceError resource={resource} panel />
      <ResourceError resource={settings} panel />
      {settings.state === "loading" ? <LoadingCard text="正在读取本地股票设置…" /> : null}
      {settings.state === "ready" ? (
        <StockSettingsPanel
          settings={settings.data}
          keyDrafts={keyDrafts}
          clearKeys={clearKeys}
          saving={saving}
          saved={saved}
          onChange={updateSettings}
          onKeyDraft={(id, value) => {
            setKeyDrafts((current) => ({ ...current, [id]: value }));
            setClearKeys((current) => ({ ...current, [id]: false }));
            setSaved(false);
          }}
          onClearKey={(id) => {
            setClearKeys((current) => ({ ...current, [id]: !current[id] }));
            setKeyDrafts((current) => ({ ...current, [id]: "" }));
            setSaved(false);
          }}
          onSave={() => void saveSettings()}
        />
      ) : null}
      {resource.state === "ready" ? (
        <>
          <GlassPanel>
            <div className="flex items-start gap-3">
              <Server className="mt-0.5 h-5 w-5" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Stock Research Sidecar</h2>
                  <StatusBadge
                    status={
                      resource.data.state === "ready"
                        ? "ok"
                        : resource.data.state === "degraded"
                          ? "partial"
                          : "unavailable"
                    }
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resource.data.message ??
                    `状态：${resource.data.state}${resource.data.version ? ` · v${resource.data.version}` : ""}`}
                </p>
              </div>
            </div>
          </GlassPanel>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {resource.data.providers.map((provider) => (
              <GlassPanel key={provider.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{provider.name}</span>
                  </div>
                  <StatusBadge
                    status={
                      provider.state === "ready"
                        ? "ok"
                        : provider.state === "cooldown"
                          ? "partial"
                          : "unavailable"
                    }
                    label={
                      provider.state === "ready"
                        ? "可用"
                        : provider.state === "cooldown"
                          ? "冷却中"
                          : provider.state === "unconfigured"
                            ? "未配置"
                            : "失败"
                    }
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {provider.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full bg-muted/55 px-2 py-1 text-[9.5px] text-muted-foreground"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
                {provider.message ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">{provider.message}</p>
                ) : null}
              </GlassPanel>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const keyedProviders = [
  { id: "zzshare", label: "ZZShare" },
  { id: "tushare", label: "Tushare" },
  { id: "tickflow", label: "TickFlow" },
  { id: "fuyao", label: "Fuyao" },
] as const;

function StockSettingsPanel(props: {
  settings: StockSettings;
  keyDrafts: Record<string, string>;
  clearKeys: Record<string, boolean>;
  saving: boolean;
  saved: boolean;
  onChange: (updater: (current: StockSettings) => StockSettings) => void;
  onKeyDraft: (id: string, value: string) => void;
  onClearKey: (id: string) => void;
  onSave: () => void;
}) {
  const {
    settings,
    keyDrafts,
    clearKeys,
    saving,
    saved,
    onChange,
    onKeyDraft,
    onClearKey,
    onSave,
  } = props;
  return (
    <GlassPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">股票服务设置</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            密钥保存在 Windows 凭据管理器；已保存的 Key 永不回显。
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            className="h-4 w-4 accent-foreground"
          />
          启用股票服务
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="默认市场">
          <select
            value={settings.defaultMarket}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                defaultMarket: event.target.value as StockSettings["defaultMarket"],
              }))
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="CN">A 股</option>
            <option value="HK">港股</option>
            <option value="US">美股</option>
          </select>
        </Field>
        <Field label="请求超时（毫秒）">
          <Input
            type="number"
            min={1000}
            max={120000}
            step={1000}
            value={settings.timeoutMs}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                timeoutMs: Number(event.target.value),
              }))
            }
          />
        </Field>
        <Field label="缓存 TTL（分钟）">
          <Input
            type="number"
            min={0}
            max={1440}
            value={settings.cacheTtlMinutes}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                cacheTtlMinutes: Number(event.target.value),
              }))
            }
          />
        </Field>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {settings.providers.map((provider) => {
          const keyed = keyedProviders.find((item) => item.id === provider.id);
          return (
            <div
              key={provider.id}
              className="rounded-2xl border border-border/40 bg-background/45 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">{keyed?.label ?? provider.id}</span>
                  {provider.keyConfigured ? (
                    <StatusBadge status="ok" label="Key 已配置" />
                  ) : keyed ? (
                    <StatusBadge status="unavailable" label="未配置 Key" />
                  ) : null}
                </div>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        providers: current.providers.map((item) =>
                          item.id === provider.id
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      }))
                    }
                    className="h-3.5 w-3.5 accent-foreground"
                  />
                  启用
                </label>
              </div>
              {keyed ? (
                <div className="mt-3 flex gap-2">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={keyDrafts[provider.id] ?? ""}
                    disabled={Boolean(clearKeys[provider.id])}
                    onChange={(event) => onKeyDraft(provider.id, event.target.value)}
                    placeholder={provider.keyConfigured ? "输入新 Key 以替换" : "输入新 Key"}
                    aria-label={`${keyed.label} 新 Key`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "shrink-0",
                      clearKeys[provider.id] && "border-destructive/30 text-destructive",
                    )}
                    onClick={() => onClearKey(provider.id)}
                  >
                    {clearKeys[provider.id] ? "撤销清除" : "清除"}
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-[10.5px] text-muted-foreground">
                  免费数据源，无需配置 Key。
                </p>
              )}
              {clearKeys[provider.id] ? (
                <p className="mt-2 text-[10.5px] text-destructive">
                  保存后将从 Windows 凭据管理器删除该 Key。
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? (
          <span className="text-[11px] text-emerald-600">设置已保存，股票服务已重启</span>
        ) : null}
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          保存设置
        </Button>
      </div>
    </GlassPanel>
  );
}

function EvidenceHeader({ result, title }: { result: StockEvidenceMetadata; title: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <StatusBadge status={result.status} />
        </div>
        <div className="mt-1 text-[10.5px] text-muted-foreground">
          截至 {result.asOf ?? "未知"} · 获取于 {result.retrievedAt}
          {result.cached ? " · 缓存" : ""}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {result.sources.map((source) => (
          <span
            key={source.id}
            title={source.url}
            className="rounded-full border border-border/45 bg-background/60 px-2 py-1 text-[9.5px] text-muted-foreground"
          >
            {source.name}
          </span>
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
function StatusBadge({ status, label }: { status: StockResultStatus; label?: string }) {
  const text = label ?? (status === "ok" ? "完整" : status === "partial" ? "部分可用" : "不可用");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-medium",
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
function UnavailableCard<T>({ result }: { result: StockEvidenceResult<T> }) {
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
function LoadingCard({ text }: { text: string }) {
  return (
    <GlassPanel className="flex min-h-36 items-center justify-center">
      <LoadingInline text={text} />
    </GlassPanel>
  );
}
function LoadingInline({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}
function ResourceError<T>({
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
function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
      <LayoutGrid className="h-4 w-4" />
      {text}
    </div>
  );
}
function BulletSection({
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
        <ul className="mt-2 space-y-1.5 text-[11.5px] leading-5 text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-[11px] text-muted-foreground">暂无</div>
      )}
    </div>
  );
}
function Disclaimer() {
  return (
    <div className="mt-4 flex items-start gap-2 border-t border-border/35 pt-3 text-[10.5px] leading-4 text-muted-foreground">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      仅供研究与信息整理，不构成投资建议、收益承诺或交易指令。
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/45 px-3 py-3">
      <div className="text-[10.5px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
