export type Market = "CN" | "HK" | "US";
export type AssetClass = "EQUITY" | "ETF" | "INDEX";
export type AssetType = "stock" | "etf" | "index" | "fund" | "unknown";
export type Currency = "CNY" | "HKD" | "USD";

export type StockCapability =
  | "resolve"
  | "snapshot"
  | "history"
  | "profile"
  | "financials"
  | "shareholders"
  | "dividend"
  | "moneyFlow"
  | "news"
  | "notices"
  | "etf"
  | "technical"
  | "score"
  | "strategy"
  | "backtest"
  | "marketBrief";

export interface InstrumentRef {
  id: string;
  market: Market;
  exchange: string;
  assetType: AssetType;
  currency: Currency;
  symbol: string;
  name: string;
}

export type EvidenceStatus = "complete" | "partial" | "unavailable";

export interface EvidenceSource {
  id: string;
  name: string;
  provider: string;
  capability: StockCapability;
  asOf: string;
  retrievedAt: string;
  cached: boolean;
}

export interface EvidenceEnvelope {
  status: EvidenceStatus;
  sources: EvidenceSource[];
  asOf: string;
  retrievedAt: string;
  cached: boolean;
  warnings: string[];
}

export interface StockResolveRequest {
  query: string;
  market?: Market;
  limit?: number;
}
export interface InstrumentSearchResult extends EvidenceEnvelope {
  instruments: InstrumentRef[];
}

export interface StockSnapshot {
  instrument: InstrumentRef;
  price: number;
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  change?: number;
  changePercent?: number;
  marketTime: string;
}

export interface PriceBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface StockEvidenceResult<T = unknown> extends EvidenceEnvelope {
  instrument?: InstrumentRef;
  data?: T;
}

export interface StockSnapshotRequest {
  instrument: InstrumentRef;
  maxAgeMs?: number;
}
export interface StockResearchRequest {
  instrument: InstrumentRef;
  historyLimit?: number;
}
export interface MarketBriefRequest {
  market?: Market;
  limit?: number;
}

export interface StockBacktestRequest {
  instrument?: InstrumentRef;
  bars?: PriceBar[];
  start?: string;
  end?: string;
  initialCash?: number;
  feeRate?: number;
  strategy?: { id?: "sma-cross"; shortWindow?: number; longWindow?: number };
}

export interface BacktestTrade {
  side: "buy" | "sell";
  signalTime: string;
  executionTime: string;
  price: number;
  quantity: number;
  fee: number;
}

export interface StockBacktestResult extends EvidenceEnvelope {
  algorithm: {
    id: "calen.sma-cross";
    version: "1.0.0";
    parameters: Record<string, number>;
  };
  sample: { start: string; end: string; bars: number; coverage: number };
  benchmark: { name: "buy-and-hold"; returnPercent: number };
  metrics: {
    finalEquity: number;
    returnPercent: number;
    maxDrawdownPercent: number;
  };
  trades: BacktestTrade[];
  limitations: string[];
}

export interface ProviderStatus {
  id: string;
  capabilities: StockCapability[];
  priority: number;
  available: boolean;
  circuitOpenUntil?: string;
  cooldownUntil?: string;
  consecutiveFailures: number;
  averageLatencyMs?: number;
  lastError?: string;
}

export interface StockServiceStatus {
  state: "ready" | "degraded" | "unavailable";
  service: "calen-stock-sidecar";
  version: string;
  message?: string;
  providers: ProviderStatus[];
  retrievedAt: string;
}

export interface StockProvider {
  id: string;
  priority: number;
  free?: boolean;
  capabilities: readonly StockCapability[];
  resolve?(
    request: StockResolveRequest,
    context: ProviderContext
  ): Promise<ProviderEvidence<InstrumentRef[]>>;
  snapshot?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<StockSnapshot>>;
  history?(
    instrument: InstrumentRef,
    request: HistoryRequest,
    context: ProviderContext
  ): Promise<ProviderEvidence<PriceBar[]>>;
  marketBrief?(
    request: MarketBriefRequest,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
}

export interface HistoryRequest {
  limit?: number;
  start?: string;
  end?: string;
}

export interface ProviderEvidence<T> {
  data: T | null;
  asOf: string;
  warnings?: string[];
}

export interface ProviderContext {
  signal?: AbortSignal;
  fetch: typeof globalThis.fetch;
  now: () => Date;
}

export interface StockResearchPort {
  resolve(
    request: StockResolveRequest,
    signal?: AbortSignal
  ): Promise<InstrumentSearchResult>;
  snapshot(
    request: StockSnapshotRequest,
    signal?: AbortSignal
  ): Promise<StockEvidenceResult<StockSnapshot>>;
  research(
    request: StockResearchRequest,
    signal?: AbortSignal
  ): Promise<StockEvidenceResult>;
  marketBrief(
    request: MarketBriefRequest,
    signal?: AbortSignal
  ): Promise<StockEvidenceResult>;
  backtest(
    request: StockBacktestRequest,
    signal?: AbortSignal
  ): Promise<StockBacktestResult>;
  status(): Promise<StockServiceStatus>;
}
