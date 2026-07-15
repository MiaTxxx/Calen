import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  GlassPanel,
  HubBackdrop,
  HubHeader,
} from "../../components/hub/HubChrome";
import {
  AlertTriangle,
  Key,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Upload,
  Zap,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/shared/utils";
import {
  type AsyncResource,
  type BacktestResult,
  type EncryptedStockBackupEnvelope,
  formatStockError,
  type InstrumentRef,
  type InstrumentSearchResult,
  type MarketBrief,
  type PortfolioSnapshot,
  parseFiniteNumber,
  type QuoteSnapshot,
  type ResearchBundle,
  type StockBackupRestoreMode,
  type StockEvidenceMetadata,
  type StockEvidenceResult,
  type StockResultStatus,
  type StockServiceStatus,
  type StockSettings,
  type StockSettingsSavePayload,
  sanitizeCsvFileName,
  stockResearch,
} from "../../lib/stock-research";
import { StockChart } from "./StockChart";

export type StockHubView =
  "research" | "market" | "portfolio" | "lab" | "sources";

type Props = {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  initialView?: StockHubView;
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
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  )}
                >
                  <div className="text-[12.5px] font-semibold">
                    {item.label}
                  </div>
                  <div className="mt-0.5 hidden truncate text-[10.5px] opacity-75 lg:block">
                    {item.hint}
                  </div>
                </button>
              ))}
            </nav>
            {view === "research" ? <ResearchView /> : null}
            {view === "market" ? <MarketView /> : null}
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

function ServicePill({
  resource,
}: {
  resource: AsyncResource<StockServiceStatus>;
}) {
  const ready = resource.state === "ready" && resource.data.state === "ready";
  return (
    <div
      className={cn(
        "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] sm:flex",
        ready
          ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          : "border-border/45 bg-background/60 text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ready
            ? "bg-emerald-500"
            : resource.state === "loading"
              ? "animate-pulse bg-amber-500"
              : "bg-muted-foreground/50"
        )}
      />
      {ready
        ? "股票服务已就绪"
        : resource.state === "loading"
          ? "正在连接"
          : "服务未就绪"}
    </div>
  );
}

function ResearchView() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AsyncResource<InstrumentSearchResult>>(
    { state: "idle" }
  );
  const [selected, setSelected] = useState<InstrumentRef | null>(null);
  const [snapshot, setSnapshot] = useState<
    AsyncResource<StockEvidenceResult<QuoteSnapshot>>
  >({
    state: "idle",
  });
  const [research, setResearch] = useState<
    AsyncResource<StockEvidenceResult<ResearchBundle>>
  >({
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
          <Button
            type="submit"
            size="icon"
            disabled={matches.state === "loading"}
          >
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
                      selected?.id === item.id &&
                        "bg-muted/70 ring-1 ring-border/50"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {item.name}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {item.market} · {item.exchange}
                      </span>
                    </span>
                    <span className="ml-3 font-mono text-xs">
                      {item.symbol}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </GlassPanel>
      <div className="space-y-4">
        {snapshot.state === "idle" ? <WelcomeCard /> : null}
        {snapshot.state === "loading" ? (
          <LoadingCard text="正在聚合行情与来源…" />
        ) : null}
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
        {research.state === "ready" ? (
          <ResearchCard result={research.data} />
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
        Calen
        会先展示可核验的行情与来源，再按需生成研究简报。缺失数据会明确标注，不会由模型补造。
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
        <span className="text-3xl font-semibold tabular-nums">
          {data.price ?? "—"}
        </span>
        <span
          className={cn(
            "pb-1 text-sm font-medium",
            up
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {data.change === null ? "" : `${up ? "+" : ""}${data.change}`}{" "}
          {data.changePercent === null
            ? ""
            : `(${up ? "+" : ""}${data.changePercent}%)`}
        </span>
        <span className="pb-1 text-xs text-muted-foreground">
          {data.instrument.currency}
        </span>
      </div>
      <StockChart
        values={chart}
        bars={data.chart}
        positive={up}
        className="mt-4"
      />
      {data.facts?.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {data.facts.map((fact) => (
            <div key={fact.label} className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[10.5px] text-muted-foreground">
                {fact.label}
              </div>
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
}: {
  result: StockEvidenceResult<ResearchBundle>;
}) {
  if (!result.data) return <UnavailableCard result={result} />;
  const data = result.data;
  return (
    <GlassPanel>
      <EvidenceHeader result={result} title={data.title} />
      <p className="mt-3 text-[13px] leading-6 text-foreground/85">
        {data.summary}
      </p>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">事实与证据</h3>
          <span className="text-[10px] text-muted-foreground">
            Provider 返回的事实数据
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <BulletSection title="关键事实" items={data.facts} />
          <BulletSection title="支持论据" items={data.positiveCases} />
          <BulletSection title="主要风险" items={data.risks} warning />
          <BulletSection title="待验证事项" items={data.openQuestions} />
        </div>
      </div>
      {data.experimentalAnalysis.length || data.analysisMetadata ? (
        <ExperimentalResearchSection data={data} />
      ) : null}
      <Disclaimer />
    </GlassPanel>
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
            <summary className="cursor-pointer text-[11px] font-medium">
              算法参数
            </summary>
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

function ResearchMetadataItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-violet-500/15 bg-background/55 p-3">
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-[11px] font-medium">{value}</div>
    </div>
  );
}

function MarketView() {
  const [brief, setBrief] = useState<
    AsyncResource<StockEvidenceResult<MarketBrief>>
  >({
    state: "idle",
  });
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
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={brief.state === "loading"}
          className="gap-2"
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              brief.state === "loading" && "animate-spin"
            )}
          />
          刷新市场
        </Button>
      </div>
      {brief.state === "loading" ? (
        <LoadingCard text="正在生成 A 股市场概览…" />
      ) : null}
      <ResourceError resource={brief} panel />
      {brief.state === "ready" && brief.data.data ? (
        <GlassPanel>
          <EvidenceHeader result={brief.data} title={brief.data.data.title} />
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {brief.data.data.summary}
          </p>
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
                            : ""
                      )}
                    >
                      {item.value}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <Disclaimer />
        </GlassPanel>
      ) : null}
      {brief.state === "ready" && !brief.data.data ? (
        <UnavailableCard result={brief.data} />
      ) : null}
    </div>
  );
}

function PortfolioView() {
  const [portfolio, setPortfolio] = useState<AsyncResource<PortfolioSnapshot>>({
    state: "idle",
  });
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const load = useCallback(async () => {
    setPortfolio({ state: "loading" });
    try {
      setPortfolio({
        state: "ready",
        data: await stockResearch.portfolioRead(),
      });
    } catch (error) {
      setPortfolio({ state: "error", message: formatStockError(error) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function importCsv() {
    if (!csv.trim()) return;
    setImporting(true);
    try {
      setPortfolio({
        state: "ready",
        data: await stockResearch.portfolioImportCsv(csv),
      });
      setCsv("");
    } catch (error) {
      setPortfolio({ state: "error", message: formatStockError(error) });
    } finally {
      setImporting(false);
    }
  }
  async function exportCsv() {
    try {
      const result = await stockResearch.portfolioExportCsv();
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = sanitizeCsvFileName(result.fileName);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setPortfolio({ state: "error", message: formatStockError(error) });
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <GlassPanel>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">持仓概览</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportCsv()}
            >
              导出 CSV
            </Button>
          </div>
          {portfolio.state === "loading" ? (
            <div className="py-12">
              <LoadingInline text="读取本地资产数据…" />
            </div>
          ) : null}
          <ResourceError resource={portfolio} />
          {portfolio.state === "ready" ? (
            portfolio.data.positions.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-3 font-medium">标的</th>
                      <th className="pb-3 font-medium">数量</th>
                      <th className="pb-3 font-medium">平均成本</th>
                      <th className="pb-3 font-medium">市值</th>
                      <th className="pb-3 font-medium">浮动盈亏</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/35">
                    {portfolio.data.positions.map((position) => (
                      <tr
                        key={`${position.portfolioId}-${position.instrument.id}`}
                      >
                        <td className="py-3">
                          <div className="font-medium">
                            {position.instrument.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {position.instrument.symbol}
                          </div>
                        </td>
                        <td className="py-3 tabular-nums">
                          {position.quantity}
                        </td>
                        <td className="py-3 tabular-nums">
                          {position.averageCost}
                        </td>
                        <td className="py-3 tabular-nums">
                          {position.marketValue ?? "—"}
                        </td>
                        <td
                          className={cn(
                            "py-3 tabular-nums",
                            (position.unrealizedPnl ?? 0) >= 0
                              ? "text-red-600"
                              : "text-emerald-600"
                          )}
                        >
                          {position.unrealizedPnl ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12">
                <EmptyLine text="尚未导入持仓或交易流水" />
              </div>
            )
          ) : null}
        </GlassPanel>
        <GlassPanel className="h-fit">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            <h2 className="text-sm font-semibold">导入交易流水</h2>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            CSV
            字段：组合、市场、代码、交易类型、日期、数量、价格、费用、币种、备注。
          </p>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/55 bg-background/45 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground">
            <Upload className="h-3.5 w-3.5" />
            选择 CSV 文件
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => readCsvFile(event, setCsv)}
            />
          </label>
          <Textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            className="mt-3 min-h-44 font-mono text-[11px]"
            placeholder="或直接粘贴 CSV 内容…"
          />
          <Button
            className="mt-3 w-full"
            onClick={() => void importCsv()}
            disabled={!csv.trim() || importing}
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            校验并导入
          </Button>
          <p className="mt-3 text-[10.5px] text-muted-foreground">
            数据仅保存在本机；首版不连接券商、不执行交易。
          </p>
        </GlassPanel>
      </div>
      <EncryptedBackupPanel onRestored={load} />
    </div>
  );
}

function EncryptedBackupPanel({
  onRestored,
}: {
  onRestored: () => Promise<void>;
}) {
  const [exportPassword, setExportPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [envelopeText, setEnvelopeText] = useState("");
  const [mode, setMode] = useState<StockBackupRestoreMode>("merge");
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportBackup() {
    if (!exportPassword) return;
    setBusy("export");
    setError(null);
    setMessage(null);
    try {
      const envelope =
        await stockResearch.portfolioExportEncryptedBackup(exportPassword);
      const json = JSON.stringify(envelope, null, 2);
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `calen-stock-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("加密备份已导出，请妥善保管密码。Calen 无法找回遗失的密码。");
    } catch (nextError) {
      setError(formatStockError(nextError));
    } finally {
      setExportPassword("");
      setBusy(null);
    }
  }

  async function restoreBackup() {
    if (!restorePassword || !envelopeText.trim()) return;
    setBusy("restore");
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(
        envelopeText
      ) as Partial<EncryptedStockBackupEnvelope>;
      if (
        typeof parsed.formatVersion !== "number" ||
        typeof parsed.cipher !== "string" ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.payloadBase64 !== "string"
      )
        throw new Error("备份文件格式无效或字段不完整。");
      await stockResearch.portfolioRestoreEncryptedBackup(
        parsed as EncryptedStockBackupEnvelope,
        restorePassword,
        mode
      );
      await onRestored();
      setEnvelopeText("");
      setMessage(
        mode === "replaceAll"
          ? "备份已恢复，并替换现有股票资产数据。"
          : "备份已合并到现有股票资产数据。"
      );
    } catch (nextError) {
      setError(formatStockError(nextError));
    } finally {
      setRestorePassword("");
      setBusy(null);
    }
  }

  return (
    <GlassPanel>
      <div className="flex items-start gap-3">
        <Key className="mt-0.5 h-5 w-5" />
        <div>
          <h2 className="text-sm font-semibold">密码保护的备份与恢复</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            备份包含自选、组合和交易流水。密码仅用于本次操作，不会保存到设置或磁盘。
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/40 bg-background/45 p-4">
          <h3 className="text-xs font-semibold">导出加密备份</h3>
          <Field label="备份密码">
            <Input
              type="password"
              autoComplete="new-password"
              value={exportPassword}
              onChange={(event) => setExportPassword(event.target.value)}
              placeholder="输入一个强密码"
            />
          </Field>
          <Button
            className="mt-3 w-full"
            onClick={() => void exportBackup()}
            disabled={!exportPassword || busy !== null}
          >
            {busy === "export" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            下载加密 JSON
          </Button>
        </div>
        <div className="rounded-2xl border border-border/40 bg-background/45 p-4">
          <h3 className="text-xs font-semibold">恢复加密备份</h3>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/55 px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/45">
            <Upload className="h-3.5 w-3.5" />
            选择备份 JSON
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => readCsvFile(event, setEnvelopeText)}
            />
          </label>
          <Textarea
            value={envelopeText}
            onChange={(event) => setEnvelopeText(event.target.value)}
            className="mt-2 min-h-24 font-mono text-[10.5px]"
            placeholder="或粘贴加密备份 JSON…"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="恢复密码">
              <Input
                type="password"
                autoComplete="current-password"
                value={restorePassword}
                onChange={(event) => setRestorePassword(event.target.value)}
              />
            </Field>
            <Field label="恢复方式">
              <select
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as StockBackupRestoreMode)
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="merge">合并现有数据</option>
                <option value="replaceAll">全部替换</option>
              </select>
            </Field>
          </div>
          <Button
            variant={mode === "replaceAll" ? "destructive" : "default"}
            className="mt-3 w-full"
            onClick={() => void restoreBackup()}
            disabled={!restorePassword || !envelopeText.trim() || busy !== null}
          >
            {busy === "restore" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {mode === "replaceAll" ? "确认替换并恢复" : "合并并恢复"}
          </Button>
          {mode === "replaceAll" ? (
            <p className="mt-2 text-[10.5px] text-destructive">
              全部替换会清除现有自选、组合和流水后再恢复备份。
            </p>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="mt-3 rounded-xl bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-3 rounded-xl bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      ) : null}
    </GlassPanel>
  );
}

function LabView() {
  const [symbol, setSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [period, setPeriod] = useState("20");
  const [result, setResult] = useState<
    AsyncResource<StockEvidenceResult<BacktestResult>>
  >({
    state: "idle",
  });
  async function run(event: FormEvent) {
    event.preventDefault();
    const parsedPeriod = parseFiniteNumber(period);
    if (!symbol.trim() || !from || !to || parsedPeriod === null) return;
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
          strategy: "moving_average",
          from,
          to,
          parameters: { period: parsedPeriod },
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
              <Input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field label="结束日期">
              <Input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </div>
          <Field label="均线周期">
            <Input
              inputMode="numeric"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={result.state === "loading"}
          >
            {result.state === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
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

function BacktestCard({
  result,
}: {
  result: StockEvidenceResult<BacktestResult>;
}) {
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
          value={
            data.benchmarkReturnPercent === null
              ? "—"
              : `${data.benchmarkReturnPercent}%`
          }
        />
        <Metric
          label="最大回撤"
          value={
            data.maxDrawdownPercent === null
              ? "—"
              : `${data.maxDrawdownPercent}%`
          }
        />
        <Metric
          label="数据覆盖"
          value={`${Math.round(data.coverage * 100)}%`}
        />
      </div>
      <StockChart
        values={data.equityCurve ?? []}
        positive={(data.returnPercent ?? 0) >= 0}
        className="mt-4"
        label="回测权益曲线"
      />
      <div className="mt-3 text-[11px] text-muted-foreground">
        {data.algorithmId} v{data.algorithmVersion} · {data.sample.from} 至{" "}
        {data.sample.to} · {data.sample.points} 个样本 · 基准 {data.benchmark}
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
      current.state === "ready"
        ? { state: "ready", data: updater(current.data) }
        : current
    );
    setSaved(false);
  }

  async function saveSettings() {
    if (settings.state !== "ready") return;
    const providerKeyUpdates: StockSettingsSavePayload["providerKeyUpdates"] =
      {};
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
            className={cn(
              "h-3.5 w-3.5",
              resource.state === "loading" && "animate-spin"
            )}
          />
          刷新状态
        </Button>
      </div>
      {resource.state === "loading" ? (
        <LoadingCard text="检查 sidecar 与 Provider…" />
      ) : null}
      <ResourceError resource={resource} panel />
      <ResourceError resource={settings} panel />
      {settings.state === "loading" ? (
        <LoadingCard text="正在读取本地股票设置…" />
      ) : null}
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
                  <h2 className="text-sm font-semibold">
                    Stock Research Sidecar
                  </h2>
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
                    <span className="text-sm font-semibold">
                      {provider.name}
                    </span>
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
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {provider.message}
                  </p>
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
                defaultMarket: event.target
                  .value as StockSettings["defaultMarket"],
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
                  <span className="text-xs font-semibold">
                    {keyed?.label ?? provider.id}
                  </span>
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
                            : item
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
                    onChange={(event) =>
                      onKeyDraft(provider.id, event.target.value)
                    }
                    placeholder={
                      provider.keyConfigured
                        ? "输入新 Key 以替换"
                        : "输入新 Key"
                    }
                    aria-label={`${keyed.label} 新 Key`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "shrink-0",
                      clearKeys[provider.id] &&
                        "border-destructive/30 text-destructive"
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
          <span className="text-[11px] text-emerald-600">
            设置已保存，股票服务已重启
          </span>
        ) : null}
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          保存设置
        </Button>
      </div>
    </GlassPanel>
  );
}

function EvidenceHeader({
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
function StatusBadge({
  status,
  label,
}: {
  status: StockResultStatus;
  label?: string;
}) {
  const text =
    label ??
    (status === "ok" ? "完整" : status === "partial" ? "部分可用" : "不可用");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-medium",
        status === "ok"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "partial"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "bg-destructive/10 text-destructive"
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
      <div
        className={cn(
          "text-xs font-semibold",
          warning && "text-amber-700 dark:text-amber-300"
        )}
      >
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
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
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

export function readCsvFile(
  event: ChangeEvent<HTMLInputElement>,
  onRead: (text: string) => void
) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () =>
    onRead(typeof reader.result === "string" ? reader.result : "");
  reader.readAsText(file);
}
