import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  generateStockAiResearchBrief,
  getStockServiceFailureMessage,
  type InstrumentRef,
  type InstrumentSearchResult,
  type MarketBrief,
  parseFiniteNumber,
  type QuoteSnapshot,
  type ResearchBundle,
  type StockAiResearchBrief,
  type StockBacktestStrategyId,
  type StockEvidenceMetadata,
  type StockEvidenceResult,
  type StockResearchModelSettings,
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
  modelSettings: StockResearchModelSettings;
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
  modelSettings,
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
            {view === "research" || view === "market" ? (
              <ServiceFailureNotice resource={status} />
            ) : null}
            {view === "research" ? <ResearchView modelSettings={modelSettings} /> : null}
            {view === "market" ? <MarketView selectedModel={modelSettings.selectedModel} /> : null}
            {view === "portfolio" ? <PortfolioView /> : null}
            {view === "lab" ? <LabView /> : null}
            {view === "sources" ? (
              <SourcesView
                resource={status}
                onRefresh={refreshStatus}
                onRestarted={(next) => setStatus({ state: "ready", data: next })}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServicePill({ resource }: { resource: AsyncResource<StockServiceStatus> }) {
  const ready = resource.state === "ready" && resource.data.state === "ready";
  const partiallyAvailable =
    resource.state === "ready" && resource.data.runtime?.running === true && !ready;
  return (
    <div
      className={cn(
        "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] sm:flex",
        ready
          ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          : partiallyAvailable
            ? "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300"
            : "border-border/45 bg-background/60 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ready
            ? "bg-emerald-500"
            : partiallyAvailable
              ? "bg-amber-500"
              : resource.state === "loading"
                ? "animate-pulse bg-amber-500"
                : "bg-muted-foreground/50",
        )}
      />
      {ready
        ? "股票服务已就绪"
        : partiallyAvailable
          ? "股票服务部分可用"
          : resource.state === "loading"
            ? "正在连接"
            : "服务未就绪"}
    </div>
  );
}

function ServiceFailureNotice({ resource }: { resource: AsyncResource<StockServiceStatus> }) {
  if (resource.state === "idle" || resource.state === "loading") return null;
  if (
    resource.state === "ready" &&
    (resource.data.state === "ready" || resource.data.runtime?.running === true)
  )
    return null;

  const status = resource.state === "ready" ? resource.data : null;
  const specificMessage = status
    ? getStockServiceFailureMessage(status)
    : resource.state === "error"
      ? resource.message
      : undefined;
  const generalMessage = status?.message;

  return (
    <GlassPanel tone="error">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">股票服务异常</h2>
          <p className="mt-1 break-words text-xs text-destructive">
            {specificMessage ?? "股票服务当前不可用，请前往数据源页面查看诊断并重启服务。"}
          </p>
          {generalMessage && generalMessage !== specificMessage ? (
            <p className="mt-1 text-[10.5px] text-muted-foreground">服务状态：{generalMessage}</p>
          ) : null}
        </div>
      </div>
    </GlassPanel>
  );
}

function ResearchView({ modelSettings }: { modelSettings: StockResearchModelSettings }) {
  const searchSequence = useRef(0);
  const inspectSequence = useRef(0);
  const researchSequence = useRef(0);
  const [query, setQuery] = useState("");
  const [searchMarket, setSearchMarket] = useState<StockSettings["defaultMarket"]>("CN");
  const [matches, setMatches] = useState<AsyncResource<InstrumentSearchResult>>({ state: "idle" });
  const [selected, setSelected] = useState<InstrumentRef | null>(null);
  const [snapshot, setSnapshot] = useState<AsyncResource<StockEvidenceResult<QuoteSnapshot>>>({
    state: "idle",
  });
  const [research, setResearch] = useState<AsyncResource<StockEvidenceResult<ResearchBundle>>>({
    state: "idle",
  });
  const [aiBrief, setAiBrief] = useState<AsyncResource<StockAiResearchBrief>>({ state: "idle" });

  useEffect(() => {
    void stockResearch
      .settingsGet()
      .then((settings) => setSearchMarket(settings.defaultMarket))
      .catch(() => undefined);
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    const sequence = ++searchSequence.current;
    setMatches({ state: "loading" });
    try {
      const data = await stockResearch.resolve({
        query: query.trim(),
        markets: [searchMarket],
        limit: 8,
      });
      if (sequence !== searchSequence.current) return;
      setMatches({ state: "ready", data });
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      setMatches({ state: "error", message: formatStockError(error) });
    }
  }

  async function inspect(instrument: InstrumentRef) {
    const sequence = ++inspectSequence.current;
    researchSequence.current += 1;
    setSelected(instrument);
    setSnapshot({ state: "loading" });
    setResearch({ state: "idle" });
    setAiBrief({ state: "idle" });
    try {
      const data = await stockResearch.snapshot({
        instrument,
        includeHistory: true,
      });
      if (sequence !== inspectSequence.current) return;
      setSnapshot({ state: "ready", data });
    } catch (error) {
      if (sequence !== inspectSequence.current) return;
      setSnapshot({ state: "error", message: formatStockError(error) });
    }
  }

  async function runResearch() {
    if (!selected) return;
    const sequence = ++researchSequence.current;
    setResearch({ state: "loading" });
    setAiBrief({ state: "loading" });
    try {
      const evidence = await stockResearch.research({
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
      });
      if (sequence !== researchSequence.current) return;
      setResearch({ state: "ready", data: evidence });
      try {
        const data = await generateStockAiResearchBrief({
          settings: modelSettings,
          evidence,
        });
        if (sequence !== researchSequence.current) return;
        setAiBrief({ state: "ready", data });
      } catch (error) {
        if (sequence !== researchSequence.current) return;
        setAiBrief({ state: "error", message: formatStockError(error) });
      }
    } catch (error) {
      if (sequence !== researchSequence.current) return;
      setResearch({ state: "error", message: formatStockError(error) });
      setAiBrief({ state: "idle" });
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
          <select
            value={searchMarket}
            onChange={(event) =>
              setSearchMarket(event.target.value as StockSettings["defaultMarket"])
            }
            aria-label="搜索市场"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="CN">A 股</option>
            <option value="HK">港股</option>
            <option value="US">美股</option>
          </select>
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
          <LoadingCard text="正在聚合财务、公告与量化研究证据…" />
        ) : null}
        <ResourceError resource={research} panel />
        {research.state === "ready" ? (
          <ResearchCard result={research.data} aiBrief={aiBrief} />
        ) : null}
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

function ResearchCard({
  result,
  aiBrief,
}: {
  result: StockEvidenceResult<ResearchBundle>;
  aiBrief: AsyncResource<StockAiResearchBrief>;
}) {
  if (!result.data) return <UnavailableCard result={result} />;
  const data = result.data;
  return (
    <GlassPanel>
      <EvidenceHeader result={result} title={data.title} />
      <AiResearchBriefSection resource={aiBrief} />
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">事实与证据</h3>
          <span className="text-[10px] text-muted-foreground">
            仅展示 sidecar / Provider 返回内容
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <BulletSection title="Provider 关键事实" items={data.facts} />
          <BulletSection title="Provider 数据缺口" items={data.risks} warning />
          <BulletSection title="Provider 待验证事项" items={data.openQuestions} />
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

function AiResearchBriefSection({ resource }: { resource: AsyncResource<StockAiResearchBrief> }) {
  if (resource.state === "loading") {
    return (
      <section className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在调用所选模型生成 AI 研究简报…
        </div>
        <p className="mt-2 text-[10.5px] text-muted-foreground">
          模型只能读取下方证据包，不启用联网搜索，也不会修改持仓。
        </p>
      </section>
    );
  }
  if (resource.state === "error") {
    return (
      <section className="mt-4 rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
        <div className="text-xs font-semibold text-destructive">AI 研究简报生成失败</div>
        <p className="mt-2 text-[10.5px] leading-5 text-muted-foreground">{resource.message}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          下方 Provider 证据仍可核验；Calen 不会用 sidecar 空字段伪装成模型结论。
        </p>
      </section>
    );
  }
  if (resource.state !== "ready") return null;
  const brief = resource.data;
  return (
    <section className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <h3 className="text-xs font-semibold">AI 深度研究简报</h3>
        </div>
        <span className="text-[9.5px] text-muted-foreground">
          {brief.model.providerId} / {brief.model.model} · {brief.generatedAt}
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-6 text-foreground/85">{brief.summary}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <BulletSection title="可核验事实" items={brief.facts} />
        <BulletSection title="支持论据" items={brief.supportingCases} />
        <BulletSection title="反面论据" items={brief.counterCases} warning />
        <BulletSection title="主要风险" items={brief.risks} warning />
        <BulletSection title="待验证事项" items={brief.openQuestions} />
      </div>
    </section>
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

function financialPeriodDetail(period: Record<string, unknown>): string {
  const metrics = [
    ["income", "totalOperatingRevenue", "营业收入"],
    ["income", "netProfit", "净利润"],
    ["balance", "totalAssets", "总资产"],
    ["balance", "totalLiabilities", "总负债"],
    ["cashFlow", "operatingCashFlow", "经营现金流"],
  ] as const;
  const values = metrics.flatMap(([statement, field, label]) => {
    const rendered = evidenceValue(evidenceRecord(period[statement])[field]);
    return rendered ? [`${label} ${rendered}`] : [];
  });
  return values.length ? values.join("；") : "该报告期未返回可展示的标准化三表字段";
}

function sectionRows(
  capability: ResearchBundle["evidenceSections"][number]["capability"],
  data: unknown,
): EvidenceRow[] {
  const root = evidenceRecord(data);
  if (capability === "financials") {
    const coverage = evidenceRecord(root.coverage);
    const periods = evidenceItems(root.periods).slice(0, 4);
    const coverageRow: EvidenceRow[] = periods.length
      ? [
          {
            title: "报告期覆盖",
            detail: `返回 ${evidenceValue(coverage.returnedPeriods) ?? periods.length} / 请求 ${evidenceValue(coverage.requestedPeriods) ?? periods.length} 期；三表完整 ${evidenceValue(coverage.completePeriods) ?? 0} 期`,
          },
        ]
      : [];
    return [
      ...coverageRow,
      ...periods.map((period, index) => ({
        title: evidenceValue(period.reportDate) ?? `报告期 ${index + 1}`,
        detail: financialPeriodDetail(period),
      })),
    ];
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

function quantAnalysisRows(data: unknown): EvidenceRow[] {
  const root = evidenceRecord(data);
  const collection = evidenceItems(
    root.factors ?? root.dimensions ?? root.signals ?? root.registry ?? root.items,
  );
  if (collection.length) {
    return collection.slice(0, 12).map((item, index) => {
      const title =
        evidenceValue(item.name ?? item.id ?? item.strategyId ?? item.label) ??
        `第 ${index + 1} 项`;
      const detail = Object.entries(item)
        .flatMap(([key, value]) => {
          const rendered = evidenceValue(value);
          return rendered && key !== "name" && key !== "id" ? [`${key}: ${rendered}`] : [];
        })
        .join(" · ");
      return { title, detail: detail || "已返回结构化实验结果" };
    });
  }
  return Object.entries(root).flatMap(([key, value]) => {
    const direct = evidenceValue(value);
    if (direct) return [{ title: key, detail: direct }];
    const nested = evidenceRecord(value);
    const detail = Object.entries(nested)
      .flatMap(([nestedKey, nestedValue]) => {
        const rendered = evidenceValue(nestedValue);
        return rendered ? [`${nestedKey}: ${rendered}`] : [];
      })
      .join(" · ");
    return detail ? [{ title: key, detail }] : [];
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
              {quantAnalysisRows(analysis.data).length ? (
                <div className="mt-2 space-y-1.5">
                  {quantAnalysisRows(analysis.data).map((row) => (
                    <div
                      key={`${analysis.capability}-${row.title}`}
                      className="rounded-lg bg-muted/30 px-2 py-1.5"
                    >
                      <div className="text-[10px] font-medium">{row.title}</div>
                      <div className="mt-0.5 text-[9.5px] leading-4 text-muted-foreground">
                        {row.detail}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {analysis.warnings.length ? (
                <p className="mt-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                  {analysis.warnings.join("；")}
                </p>
              ) : null}
              <details className="mt-2 rounded-lg border border-violet-500/15 px-2 py-1.5">
                <summary className="cursor-pointer text-[10px] text-muted-foreground">
                  原始实验数据
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[9px] leading-4 text-muted-foreground">
                  {JSON.stringify(analysis.data, null, 2)}
                </pre>
              </details>
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

function MarketView({
  selectedModel,
}: {
  selectedModel?: StockResearchModelSettings["selectedModel"];
}) {
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
          <MarketBriefSections sections={brief.data.data.sections} />
          <Disclaimer />
        </GlassPanel>
      ) : null}
      {brief.state === "ready" && !brief.data.data ? <UnavailableCard result={brief.data} /> : null}
    </div>
  );
}

function MarketBriefSections({ sections }: { sections: MarketBrief["sections"] }) {
  if (!sections.length) return null;
  return (
    <section className="mt-5 space-y-3">
      <div>
        <h3 className="text-xs font-semibold">市场专题明细</h3>
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          涨跌停、板块、资金流、龙虎榜与异动均展示真实返回条目；缺失分项不会补造。
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((section) => (
          <div
            key={section.key}
            className="rounded-2xl border border-border/40 bg-background/50 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold">{section.label}</h4>
              <span className="text-[10px] text-muted-foreground">
                {section.total !== undefined
                  ? `共 ${section.total} 条`
                  : `${section.items.length} 条`}
              </span>
            </div>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {section.items.map((item, index) => (
                <div
                  key={`${section.key}-${item.title}-${index}`}
                  className="rounded-xl bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10.5px] font-medium">{item.title}</span>
                    {item.value ? (
                      <span className="shrink-0 text-[10.5px] font-semibold tabular-nums">
                        {item.value}
                      </span>
                    ) : null}
                  </div>
                  {item.detail ? (
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                  {item.fields.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.fields.slice(0, 10).map((field) => (
                        <span
                          key={`${field.label}-${field.value}`}
                          className="rounded-md bg-background/65 px-1.5 py-1 text-[9px] text-muted-foreground"
                        >
                          {field.label}: {field.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
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
  const [evaluationRatio, setEvaluationRatio] = useState("0.3");
  const [strategy, setStrategy] = useState<StockBacktestStrategyId>("fused");
  const [result, setResult] = useState<AsyncResource<StockEvidenceResult<BacktestResult>>>({
    state: "idle",
  });
  const [analysis, setAnalysis] = useState<AsyncResource<StockEvidenceResult<ResearchBundle>>>({
    state: "idle",
  });

  async function resolveLabInstrument() {
    const matches = await stockResearch.resolve({
      query: symbol.trim(),
      limit: 1,
    });
    const instrument = matches.instruments[0];
    if (!instrument) throw new Error("Lab instrument was not found");
    return instrument;
  }

  async function runAnalysis() {
    if (!symbol.trim()) return;
    setAnalysis({ state: "loading" });
    try {
      const instrument = await resolveLabInstrument();
      const selectedStrategy =
        strategy === "fused" || strategy === "sma-cross" ? undefined : [strategy];
      setAnalysis({
        state: "ready",
        data: await stockResearch.research({
          instrument,
          capabilities: ["history", "technical", "score", "strategy", "evaluator"],
          ...(selectedStrategy ? { strategyIds: selectedStrategy } : {}),
        }),
      });
    } catch (error) {
      setAnalysis({ state: "error", message: formatStockError(error) });
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    const parsedPeriod = parseFiniteNumber(period);
    const parsedEvaluationRatio = parseFiniteNumber(evaluationRatio);
    if (
      !symbol.trim() ||
      !from ||
      !to ||
      parsedEvaluationRatio === null ||
      parsedEvaluationRatio < 0.1 ||
      parsedEvaluationRatio > 0.8 ||
      (strategy === "sma-cross" && parsedPeriod === null)
    )
      return;
    setResult({ state: "loading" });
    try {
      const instrument = await resolveLabInstrument();
      setResult({
        state: "ready",
        data: await stockResearch.backtest({
          instrument,
          strategy,
          from,
          to,
          parameters: strategy === "sma-cross" ? { period: parsedPeriod } : {},
          evaluationRatio: parsedEvaluationRatio,
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
          <Field label="样本外评估比例">
            <Input
              type="number"
              min={0.1}
              max={0.8}
              step={0.05}
              inputMode="decimal"
              value={evaluationRatio}
              onChange={(event) => setEvaluationRatio(event.target.value)}
              placeholder="0.3"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={result.state === "loading"}>
            {result.state === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            运行回测
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void runAnalysis()}
            disabled={analysis.state === "loading"}
          >
            {analysis.state === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            运行指标、评分与 Evaluator
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
        {analysis.state === "loading" ? (
          <LoadingCard text="正在计算技术指标、评分卡、策略信号和 Evaluator…" />
        ) : null}
        <ResourceError resource={analysis} panel />
        {analysis.state === "ready" && analysis.data.data ? (
          <ExperimentalResearchSection data={analysis.data.data} />
        ) : null}
        {analysis.state === "ready" && !analysis.data.data ? (
          <UnavailableCard result={analysis.data} />
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
        <Metric
          label="数据覆盖"
          value={`${Math.round(data.coverage * 100)}%${result.status === "partial" ? "（部分）" : ""}`}
        />
      </div>
      <StockChart
        points={data.equityCurve.map((point) => ({ time: point.time, value: point.equity }))}
        positive={(data.returnPercent ?? 0) >= 0}
        className="mt-4"
        label="回测权益曲线"
      />
      <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3 text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground/80">
          {data.algorithmId} v{data.algorithmVersion} · 基准 {data.benchmark || "未知"}
        </div>
        <div className="mt-1">
          全部样本：{data.sample.from || "未知"} 至 {data.sample.to || "未知"} ·{" "}
          {data.sample.points} 根 · 覆盖率 {Math.round(data.sample.coverage * 100)}%
        </div>
        <div className="mt-1">
          校准区间：{data.sample.calibration.from || "未知"} 至{" "}
          {data.sample.calibration.to || "未知"} · {data.sample.calibration.points} 根 · 覆盖率{" "}
          {Math.round(data.sample.calibration.coverage * 100)}%
        </div>
        <div className="mt-1">
          样本外评估：{data.sample.evaluation.from || "未知"} 至{" "}
          {data.sample.evaluation.to || "未知"} · {data.sample.evaluation.points} 根 · 覆盖率{" "}
          {Math.round(data.sample.evaluation.coverage * 100)}%
        </div>
      </div>
      <BacktestParameters parameters={data.parameters} />
      <BacktestTrades trades={data.trades} />
      {data.limitations.length ? (
        <BulletSection title="限制说明" items={data.limitations} warning />
      ) : null}
      <Disclaimer />
    </GlassPanel>
  );
}

function BacktestParameters({ parameters }: { parameters: Record<string, unknown> }) {
  const entries = Object.entries(parameters);
  if (!entries.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3">
      <div className="text-xs font-semibold">算法参数与费用假设</div>
      <div className="mt-2 grid gap-1.5 text-[11px] text-muted-foreground sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <span>{key}</span>
            <span className="text-right font-mono text-foreground/80">
              {formatBacktestParameter(key, value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBacktestParameter(key: string, value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (key === "feeRate" || key === "evaluationRatio") {
      return `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`;
    }
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "—");
}

function BacktestTrades({ trades }: { trades: BacktestResult["trades"] }) {
  return (
    <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3">
      <div className="text-xs font-semibold">逐笔交易（信号 / 执行 / 费用）</div>
      {trades.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[11px] text-muted-foreground">
            <thead>
              <tr className="border-b border-border/35 text-[10px]">
                <th className="px-2 py-1.5 font-medium">方向</th>
                <th className="px-2 py-1.5 font-medium">信号时间</th>
                <th className="px-2 py-1.5 font-medium">执行时间</th>
                <th className="px-2 py-1.5 text-right font-medium">价格</th>
                <th className="px-2 py-1.5 text-right font-medium">数量</th>
                <th className="px-2 py-1.5 text-right font-medium">费用</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr
                  key={`${trade.signalTime}-${trade.executionTime}-${trade.side}`}
                  className="border-b border-border/20 last:border-0"
                >
                  <td
                    className={cn(
                      "px-2 py-1.5 font-medium",
                      trade.side === "buy" ? "text-red-600" : "text-emerald-600",
                    )}
                  >
                    {trade.side === "buy" ? "买入" : "卖出"}
                  </td>
                  <td className="px-2 py-1.5 font-mono">{trade.signalTime}</td>
                  <td className="px-2 py-1.5 font-mono">{trade.executionTime}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{trade.price}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{trade.quantity}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{trade.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-muted-foreground">评估区间内没有可记录的交易。</div>
      )}
    </div>
  );
}

function SourcesView({
  resource,
  onRefresh,
  onRestarted,
}: {
  resource: AsyncResource<StockServiceStatus>;
  onRefresh: () => Promise<void>;
  onRestarted: (status: StockServiceStatus) => void;
}) {
  const [settings, setSettings] = useState<AsyncResource<StockSettings>>({
    state: "idle",
  });
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [clearKeys, setClearKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartSucceeded, setRestartSucceeded] = useState(false);

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

  async function restartService() {
    setRestarting(true);
    setRestartError(null);
    setRestartSucceeded(false);
    try {
      const next = await stockResearch.restart();
      if (next.runtime?.running !== true) {
        throw new Error(getStockServiceFailureMessage(next) ?? "股票服务重启后仍未完成探活。");
      }
      onRestarted(next);
      setRestartSucceeded(true);
    } catch (error) {
      setRestartError(formatStockError(error));
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void restartService()}
          disabled={restarting || resource.state === "loading"}
          className="gap-2"
        >
          {restarting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Server className="h-3.5 w-3.5" />
          )}
          {restarting ? "正在重启股票服务…" : "重启股票服务"}
        </Button>
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
      {restartError ? (
        <GlassPanel tone="error">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>重启失败：{restartError}</span>
          </div>
        </GlassPanel>
      ) : null}
      {restartSucceeded ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          股票服务已重启并完成探活。
        </div>
      ) : null}
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
                  {getStockServiceFailureMessage(resource.data) ??
                    `状态：${resource.data.state}${resource.data.version ? ` · v${resource.data.version}` : ""}`}
                </p>
                {resource.data.message &&
                resource.data.message !== getStockServiceFailureMessage(resource.data) ? (
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    服务状态：{resource.data.message}
                  </p>
                ) : null}
              </div>
            </div>
            <RuntimeDiagnostics status={resource.data} />
          </GlassPanel>
          <StockCapabilityMatrix />
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
                        : provider.state === "unknown"
                          ? "partial"
                          : provider.state === "cooldown"
                            ? "partial"
                            : "unavailable"
                    }
                    label={
                      provider.state === "ready"
                        ? "可用"
                        : provider.state === "unknown"
                          ? "待探测"
                          : provider.state === "cooldown"
                            ? "冷却中"
                            : provider.state === "disabled"
                              ? "已禁用"
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
                <p className="mt-3 text-[10px] text-muted-foreground">
                  {provider.lastSuccessAt
                    ? `最近成功：${provider.lastSuccessAt}`
                    : provider.state === "unknown"
                      ? "尚未执行真实上游请求；运行一次查询后更新状态。"
                      : "暂无成功请求时间。"}
                </p>
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

function RuntimeDiagnostics({ status }: { status: StockServiceStatus }) {
  const runtime = status.runtime;
  if (!runtime) return null;
  const failure = runtime.failure;
  const stderrTail = failure?.stderrTail.length ? failure.stderrTail : runtime.stderrTail;
  const sidecarRoot = failure?.sidecarRoot ?? runtime.sidecarRoot;

  return (
    <details className="mt-4 rounded-xl border border-border/40 bg-background/45 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
        运行诊断
      </summary>
      <div className="mt-3 grid gap-2 text-[10.5px] text-muted-foreground sm:grid-cols-2">
        <div>运行中：{runtime.running === undefined ? "未知" : runtime.running ? "是" : "否"}</div>
        <div>连续失败：{runtime.consecutiveFailures ?? "未知"}</div>
        {failure?.stage ? <div>故障阶段：{failure.stage}</div> : null}
        {failure?.occurredAt ? <div>发生时间：{failure.occurredAt}</div> : null}
        {failure?.processId !== undefined ? <div>进程 PID：{failure.processId}</div> : null}
        {failure?.exitCode !== undefined ? <div>退出码：{failure.exitCode}</div> : null}
        {sidecarRoot ? (
          <div className="break-all sm:col-span-2">Sidecar 路径：{sidecarRoot}</div>
        ) : null}
      </div>
      {failure?.firstError ? (
        <div className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-[10.5px] text-destructive">
          <span className="font-medium">首次错误：</span>
          <span className="break-words">{failure.firstError}</span>
        </div>
      ) : null}
      {failure?.restartError ? (
        <div className="mt-2 rounded-lg bg-destructive/5 px-3 py-2 text-[10.5px] text-destructive">
          <span className="font-medium">重启错误：</span>
          <span className="break-words">{failure.restartError}</span>
        </div>
      ) : null}
      {runtime.message ? (
        <div className="mt-2 break-words text-[10.5px] text-muted-foreground">
          Runtime：{runtime.message}
        </div>
      ) : null}
      {stderrTail.length ? (
        <div className="mt-3">
          <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">stderr 尾部</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/5 p-3 text-[10px] leading-4 text-muted-foreground dark:bg-white/5">
            {stderrTail.join("\n")}
          </pre>
        </div>
      ) : null}
    </details>
  );
}

const stockCapabilityMatrix = [
  {
    market: "A 股",
    basic: "搜索、实时行情、日 K、公司资料",
    research: "财务三表、股东、分红、资金流、新闻、公告正文",
    experimental: "技术指标、评分、策略、Evaluator、回测",
  },
  {
    market: "港股",
    basic: "搜索、行情、日 K、有限公司资料",
    research: "首版不保证深度财务、股东与公告正文",
    experimental: "依赖历史 K 线覆盖率，可能为 partial",
  },
  {
    market: "美股",
    basic: "搜索、行情、日 K、有限资料与收入分部",
    research: "首版不保证深度财务、股东与公告正文",
    experimental: "依赖历史 K 线覆盖率，可能为 partial",
  },
  {
    market: "ETF",
    basic: "统一标的、行情与日 K",
    research: "Provider 支持时展示净值、溢价和主要持仓",
    experimental: "可运行指标与回测，结果始终标记实验性",
  },
] as const;

function StockCapabilityMatrix() {
  return (
    <GlassPanel>
      <div>
        <h2 className="text-sm font-semibold">市场能力矩阵</h2>
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          能力边界按首版真实实现展示；Provider 不支持时返回 partial 或 unavailable。
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[10px]">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/40">
              <th className="px-2 py-2 font-medium">市场</th>
              <th className="px-2 py-2 font-medium">基础能力</th>
              <th className="px-2 py-2 font-medium">研究能力</th>
              <th className="px-2 py-2 font-medium">实验能力</th>
            </tr>
          </thead>
          <tbody>
            {stockCapabilityMatrix.map((row) => (
              <tr key={row.market} className="border-b border-border/25 align-top last:border-0">
                <td className="px-2 py-2 font-semibold">{row.market}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.basic}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.research}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.experimental}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
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
          最早证据截至 {result.asOf ?? "未知"} · 获取于 {result.retrievedAt || "未知"}
          {result.cached ? " · 缓存" : ""}
        </div>
      </div>
      <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-[260px] sm:max-w-[56%]">
        {result.sources.map((source) => (
          <div
            key={source.id}
            title={source.url}
            className="rounded-xl border border-border/45 bg-background/60 px-2.5 py-1.5 text-[9.5px] text-muted-foreground"
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
            <div className="mt-0.5 text-[9px] text-muted-foreground/70">
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
