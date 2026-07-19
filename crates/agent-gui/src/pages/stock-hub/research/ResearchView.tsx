import { type FormEvent, useEffect, useRef, useState } from "react";
import { GlassPanel } from "../../../components/hub/HubChrome";
import { History, Loader2, Search, Sparkles } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/shared/utils";
import {
  type AsyncResource,
  clearRecentInstruments,
  formatStockError,
  generateStockAiResearchBrief,
  type InstrumentRef,
  type InstrumentSearchResult,
  loadRecentInstruments,
  pushRecentInstrument,
  type QuoteSnapshot,
  type StockAiResearchBrief,
  type StockCapability,
  type StockEvidenceResult,
  type StockHistoryPeriod,
  type StockResearchModelSettings,
  type StockSettings,
  saveRecentInstruments,
  stockResearch,
} from "../../../lib/stock-research";
import { StockChart } from "../StockChart";
import { EmptyLine, EvidenceHeader, LoadingCard, ResourceError } from "../shared";
import { FinancialsTab } from "./FinancialsTab";
import { FlowNewsTab } from "./FlowNewsTab";
import { HoldersTab } from "./HoldersTab";
import { OverviewTab } from "./OverviewTab";
import { QuantTab } from "./QuantTab";
import type { ResearchTabResource } from "./TabScaffold";

// 研究子页签：每个页签只请求回答该问题所需的能力，按标的缓存，避免一次拉全量。
type ResearchTabKey = "overview" | "financials" | "holders" | "flow" | "quant";

const RESEARCH_TABS: Array<{ key: ResearchTabKey; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "financials", label: "财务" },
  { key: "holders", label: "股东与分红" },
  { key: "flow", label: "资金与消息" },
  { key: "quant", label: "量化实验" },
];

function tabCapabilities(tab: ResearchTabKey, instrument: InstrumentRef): StockCapability[] {
  switch (tab) {
    case "overview":
      return ["profile", ...(instrument.assetType === "etf" ? (["etf"] as const) : [])];
    case "financials":
      return ["financials"];
    case "holders":
      return ["shareholders", "dividends"];
    case "flow":
      return ["capital_flow", "news", "notices"];
    case "quant":
      return ["history", "technical", "score", "strategy", "evaluator"];
  }
}

// AI 简报使用的全量证据能力集，与旧版「生成深度研究」一致。
function briefCapabilities(instrument: InstrumentRef): StockCapability[] {
  return [
    "quote",
    "history",
    "profile",
    "financials",
    "shareholders",
    "dividends",
    "capital_flow",
    "news",
    "notices",
    ...(instrument.assetType === "etf" ? (["etf"] as const) : []),
    "technical",
    "score",
    "strategy",
    "evaluator",
  ];
}

const CHART_PERIOD_OPTIONS: Array<{ value: StockHistoryPeriod; label: string }> = [
  { value: "minute", label: "分时" },
  { value: "day", label: "日K" },
  { value: "week", label: "周K" },
  { value: "month", label: "月K" },
];

const IDLE: ResearchTabResource = { state: "idle" };

export function ResearchView({ modelSettings }: { modelSettings: StockResearchModelSettings }) {
  const searchSequence = useRef(0);
  const inspectSequence = useRef(0);
  const researchSequence = useRef(0);
  const tabSequence = useRef(0);
  const tabTokens = useRef(new Map<string, number>());
  const [query, setQuery] = useState("");
  const [searchMarket, setSearchMarket] = useState<StockSettings["defaultMarket"]>("CN");
  const [matches, setMatches] = useState<AsyncResource<InstrumentSearchResult>>({ state: "idle" });
  const [selected, setSelected] = useState<InstrumentRef | null>(null);
  // 最近查看的标的:本机持久化,重启后仍可一键回到上次研究的标的。
  const [recent, setRecent] = useState<InstrumentRef[]>(() => loadRecentInstruments());
  const [snapshot, setSnapshot] = useState<AsyncResource<StockEvidenceResult<QuoteSnapshot>>>({
    state: "idle",
  });
  const [chartPeriod, setChartPeriod] = useState<StockHistoryPeriod>("day");
  const [chartPeriodLoading, setChartPeriodLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ResearchTabKey>("overview");
  // 按 `${instrumentId}|${tab}` 缓存页签证据；切换标的不清空，回看零等待。
  const [tabData, setTabData] = useState<Record<string, ResearchTabResource>>({});
  const [aiBriefs, setAiBriefs] = useState<Record<string, AsyncResource<StockAiResearchBrief>>>({});

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

  async function inspect(instrument: InstrumentRef, period: StockHistoryPeriod = chartPeriod) {
    const sequence = ++inspectSequence.current;
    setSelected(instrument);
    setRecent((current) => {
      const next = pushRecentInstrument(current, instrument);
      saveRecentInstruments(next);
      return next;
    });
    setActiveTab("overview");
    setSnapshot({ state: "loading" });
    void loadTab(instrument, "overview");
    try {
      const data = await stockResearch.snapshot({
        instrument,
        includeHistory: true,
        historyPeriod: period,
      });
      if (sequence !== inspectSequence.current) return;
      setSnapshot({ state: "ready", data });
    } catch (error) {
      if (sequence !== inspectSequence.current) return;
      setSnapshot({ state: "error", message: formatStockError(error) });
    }
  }

  // 切换 K 线周期：仅刷新快照数据，加载期间保留旧图避免整卡闪烁。
  async function changeChartPeriod(period: StockHistoryPeriod) {
    if (period === chartPeriod && snapshot.state === "ready") return;
    setChartPeriod(period);
    if (!selected) return;
    const sequence = ++inspectSequence.current;
    setChartPeriodLoading(true);
    try {
      const data = await stockResearch.snapshot({
        instrument: selected,
        includeHistory: true,
        historyPeriod: period,
      });
      if (sequence !== inspectSequence.current) return;
      setSnapshot({ state: "ready", data });
    } catch (error) {
      if (sequence !== inspectSequence.current) return;
      setSnapshot({ state: "error", message: formatStockError(error) });
    } finally {
      if (sequence === inspectSequence.current) setChartPeriodLoading(false);
    }
  }

  async function loadTab(instrument: InstrumentRef, tab: ResearchTabKey, force = false) {
    const key = `${instrument.id}|${tab}`;
    const existing = tabData[key];
    if (!force && existing && existing.state !== "idle" && existing.state !== "error") return;
    const token = ++tabSequence.current;
    tabTokens.current.set(key, token);
    setTabData((current) => ({ ...current, [key]: { state: "loading" } }));
    try {
      const data = await stockResearch.research({
        instrument,
        capabilities: tabCapabilities(tab, instrument),
      });
      if (tabTokens.current.get(key) !== token) return;
      setTabData((current) => ({ ...current, [key]: { state: "ready", data } }));
    } catch (error) {
      if (tabTokens.current.get(key) !== token) return;
      setTabData((current) => ({
        ...current,
        [key]: { state: "error", message: formatStockError(error) },
      }));
    }
  }

  function switchTab(tab: ResearchTabKey) {
    setActiveTab(tab);
    if (selected) void loadTab(selected, tab);
  }

  // AI 简报：概览页手动触发；拉取全量证据包后调用所选模型，证据不足时如实失败。
  async function runAiBrief() {
    if (!selected) return;
    const instrument = selected;
    const sequence = ++researchSequence.current;
    setAiBriefs((current) => ({ ...current, [instrument.id]: { state: "loading" } }));
    try {
      const evidence = await stockResearch.research({
        instrument,
        capabilities: briefCapabilities(instrument),
      });
      if (sequence !== researchSequence.current) return;
      const data = await generateStockAiResearchBrief({
        settings: modelSettings,
        evidence,
      });
      if (sequence !== researchSequence.current) return;
      setAiBriefs((current) => ({ ...current, [instrument.id]: { state: "ready", data } }));
    } catch (error) {
      if (sequence !== researchSequence.current) return;
      setAiBriefs((current) => ({
        ...current,
        [instrument.id]: { state: "error", message: formatStockError(error) },
      }));
    }
  }

  const activeResource: ResearchTabResource = selected
    ? (tabData[`${selected.id}|${activeTab}`] ?? IDLE)
    : IDLE;
  const activeAiBrief: AsyncResource<StockAiResearchBrief> = selected
    ? (aiBriefs[selected.id] ?? { state: "idle" })
    : { state: "idle" };

  return (
    <div className="grid min-h-[480px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
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
                  <InstrumentButton
                    key={item.id}
                    item={item}
                    active={selected?.id === item.id}
                    onSelect={() => void inspect(item)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                最近查看
              </span>
              <button
                type="button"
                onClick={() => {
                  setRecent([]);
                  clearRecentInstruments();
                }}
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                清空
              </button>
            </div>
            <div className="space-y-1">
              {recent.map((item) => (
                <InstrumentButton
                  key={item.id}
                  item={item}
                  active={selected?.id === item.id}
                  onSelect={() => void inspect(item)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </GlassPanel>
      <div className="min-w-0 space-y-4">
        {snapshot.state === "idle" ? <WelcomeCard /> : null}
        {snapshot.state === "loading" ? <LoadingCard text="正在聚合行情与来源…" /> : null}
        <ResourceError resource={snapshot} panel />
        {snapshot.state === "ready" ? (
          <InstrumentHeader
            result={snapshot.data}
            chartPeriod={chartPeriod}
            chartPeriodLoading={chartPeriodLoading}
            onChartPeriodChange={(period) => void changeChartPeriod(period)}
          />
        ) : null}
        {selected && snapshot.state !== "idle" ? (
          <>
            <nav className="flex flex-wrap gap-1 rounded-2xl border border-border/40 bg-background/60 p-1 backdrop-blur-xl">
              {RESEARCH_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => switchTab(tab.key)}
                  className={cn(
                    "rounded-xl px-3.5 py-1.5 text-xs transition-all",
                    activeTab === tab.key
                      ? "bg-background/90 font-semibold text-foreground shadow-sm ring-1 ring-border/45 dark:bg-white/[0.08]"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            {activeTab === "overview" ? (
              <OverviewTab
                resource={activeResource}
                aiBrief={activeAiBrief}
                onGenerateBrief={() => void runAiBrief()}
              />
            ) : null}
            {activeTab === "financials" ? <FinancialsTab resource={activeResource} /> : null}
            {activeTab === "holders" ? <HoldersTab resource={activeResource} /> : null}
            {activeTab === "flow" ? <FlowNewsTab resource={activeResource} /> : null}
            {activeTab === "quant" ? <QuantTab resource={activeResource} /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// 搜索结果与「最近查看」共用的标的行,保证两处交互与视觉一致。
function InstrumentButton({
  item,
  active,
  onSelect,
}: {
  item: InstrumentRef;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-muted/55",
        active && "bg-muted/70 ring-1 ring-border/50",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{item.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {item.market} · {item.exchange}
        </span>
      </span>
      <span className="ml-3 font-mono text-xs">{item.symbol}</span>
    </button>
  );
}

function WelcomeCard() {
  return (
    <GlassPanel className="flex min-h-[330px] flex-col items-center justify-center text-center">
      <Sparkles className="h-8 w-8 text-foreground/45" />
      <h2 className="mt-4 text-base font-semibold">从一个标的开始研究</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
        Calen
        会先展示可核验的行情与来源，再按需加载财务、股东、资金与量化研究。缺失数据会明确标注，不会由模型补造。
      </p>
    </GlassPanel>
  );
}

function InstrumentHeader({
  result,
  chartPeriod,
  chartPeriodLoading,
  onChartPeriodChange,
}: {
  result: StockEvidenceResult<QuoteSnapshot>;
  chartPeriod: StockHistoryPeriod;
  chartPeriodLoading: boolean;
  onChartPeriodChange: (period: StockHistoryPeriod) => void;
}) {
  const data = result.data;
  if (!data) return null;
  const chart = data.chart?.map((point) => point.close) ?? [];
  const up = (data.changePercent ?? 0) >= 0;
  // 分时数据每点 OHLC 同价，画折线（时间轴按 UNIX 秒显示时刻）；其余周期画蜡烛。
  const intraday = (data.chartPeriod ?? chartPeriod) === "minute";
  const intradayPoints = intraday
    ? (data.chart ?? []).flatMap((point) => {
        const epochSeconds = Math.floor(Date.parse(point.time) / 1000);
        return Number.isFinite(epochSeconds) ? [{ time: epochSeconds, value: point.close }] : [];
      })
    : [];
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
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          {CHART_PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={chartPeriodLoading}
              onClick={() => onChartPeriodChange(option.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-all disabled:opacity-60",
                chartPeriod === option.value
                  ? "bg-background font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {chartPeriodLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {intraday ? (
        <StockChart
          points={intradayPoints}
          values={chart}
          positive={up}
          timeVisible
          className="mt-3"
        />
      ) : (
        <StockChart values={chart} bars={data.chart} positive={up} className="mt-3" />
      )}
      {data.facts?.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {data.facts.map((fact) => (
            <div key={fact.label} className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{fact.label}</div>
              <div className="mt-1 text-xs font-medium">{fact.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </GlassPanel>
  );
}
