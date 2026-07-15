export type StockMarket = "CN" | "HK" | "US" | "UNKNOWN";
export type StockAssetType = "stock" | "etf" | "index" | "fund" | "unknown";
export type StockResultStatus = "ok" | "partial" | "unavailable";

export type StockCapability =
  | "quote"
  | "history"
  | "profile"
  | "financials"
  | "shareholders"
  | "dividends"
  | "capital_flow"
  | "news"
  | "notices"
  | "etf"
  | "technical"
  | "score"
  | "strategy"
  | "backtest"
  | "market_topic";

export interface InstrumentRef {
  id: string;
  symbol: string;
  name: string;
  market: StockMarket;
  exchange: string;
  assetType: StockAssetType;
  currency: "CNY" | "HKD" | "USD" | string;
}

export interface EvidenceSource {
  id: string;
  name: string;
  url?: string;
  provider?: string;
}

export interface StockEvidenceResult<T = unknown> {
  status: StockResultStatus;
  data: T | null;
  sources: EvidenceSource[];
  asOf: string | null;
  retrievedAt: string;
  cached: boolean;
  warnings: string[];
}

export interface QuoteSnapshot {
  instrument: InstrumentRef;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previousClose?: number | null;
  volume?: number | null;
  chart?: Array<{
    time: string;
    open?: number;
    high?: number;
    low?: number;
    close: number;
  }>;
  facts?: Array<{ label: string; value: string; hint?: string }>;
}

export interface ResearchBundle {
  instrument: InstrumentRef;
  title: string;
  summary: string;
  facts: string[];
  positiveCases: string[];
  risks: string[];
  openQuestions: string[];
  snapshot?: QuoteSnapshot;
}

export interface MarketBrief {
  title: string;
  summary: string;
  highlights: Array<{
    title: string;
    value?: string;
    detail: string;
    tone?: "up" | "down" | "neutral";
  }>;
  generatedFor: "pre_open" | "close" | "on_demand";
}

export interface BacktestResult {
  algorithmId: string;
  algorithmVersion: string;
  parameters: Record<string, unknown>;
  sample: { from: string; to: string; points: number };
  benchmark: string;
  returnPercent: number | null;
  benchmarkReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  trades: Array<{
    time: string;
    side: "buy" | "sell";
    price: number;
    quantity: number;
  }>;
  coverage: number;
  limitations: string[];
  equityCurve?: number[];
}

export interface StockServiceStatus {
  state: "starting" | "ready" | "degraded" | "stopped" | "failed";
  version?: string;
  message?: string;
  providers: Array<{
    id: string;
    name: string;
    state: "ready" | "cooldown" | "unconfigured" | "failed";
    capabilities: StockCapability[];
    lastSuccessAt?: string;
    message?: string;
  }>;
}

export interface StockProviderSettings {
  id: string;
  enabled: boolean;
  keyConfigured: boolean;
}

export interface StockSettings {
  enabled: boolean;
  defaultMarket: "CN" | "HK" | "US";
  timeoutMs: number;
  cacheTtlMinutes: number;
  providers: StockProviderSettings[];
}

export interface StockSettingsSavePayload extends StockSettings {
  providerKeyUpdates?: Partial<
    Record<"zzshare" | "tushare" | "tickflow" | "fuyao", string | null>
  >;
}

export interface PortfolioSnapshot {
  portfolios: Array<{ id: string; name: string; baseCurrency: string }>;
  positions: Array<{
    portfolioId: string;
    instrument: InstrumentRef;
    quantity: number;
    averageCost: number;
    marketValue?: number | null;
    unrealizedPnl?: number | null;
  }>;
  transactions: Array<{
    id: string;
    portfolioId: string;
    instrument: InstrumentRef;
    type: "buy" | "sell" | "fee" | "dividend" | "split" | "adjustment";
    time: string;
    quantity?: number;
    price?: number;
    fee?: number;
    currency: string;
    note?: string;
  }>;
  asOf: string;
}

export interface StockResolveRequest {
  query: string;
  markets?: StockMarket[];
  limit?: number;
}
export interface StockSnapshotRequest {
  instrument: InstrumentRef;
  includeHistory?: boolean;
}
export interface StockResearchRequest {
  instrument: InstrumentRef;
  capabilities?: StockCapability[];
}
export interface MarketBriefRequest {
  market: StockMarket;
  session?: "pre_open" | "close" | "on_demand";
}
export interface StockBacktestRequest {
  instrument: InstrumentRef;
  strategy: string;
  from: string;
  to: string;
  parameters?: Record<string, unknown>;
  benchmark?: string;
}

export interface StockResearchPort {
  resolve(request: StockResolveRequest): Promise<InstrumentRef[]>;
  snapshot(
    request: StockSnapshotRequest
  ): Promise<StockEvidenceResult<QuoteSnapshot>>;
  research(
    request: StockResearchRequest
  ): Promise<StockEvidenceResult<ResearchBundle>>;
  marketBrief(
    request: MarketBriefRequest
  ): Promise<StockEvidenceResult<MarketBrief>>;
  backtest(
    request: StockBacktestRequest
  ): Promise<StockEvidenceResult<BacktestResult>>;
  status(): Promise<StockServiceStatus>;
  settingsGet(): Promise<StockSettings>;
  settingsSave(payload: StockSettingsSavePayload): Promise<StockSettings>;
  portfolioRead(): Promise<PortfolioSnapshot>;
  portfolioImportCsv(csv: string): Promise<PortfolioSnapshot>;
  portfolioExportCsv(
    portfolioId?: string
  ): Promise<{ fileName: string; csv: string }>;
}
