export type Market = "CN" | "HK" | "US";
export type AssetClass = "EQUITY" | "ETF" | "INDEX";
export type AssetType = "stock" | "etf" | "index" | "fund" | "unknown";
export type Currency = "CNY" | "HKD" | "USD";

export type QuantStrategyId =
  "trend" | "mean-reversion" | "breakout" | "momentum" | "volume-price";
export type StockBacktestStrategyId = "sma-cross" | QuantStrategyId | "fused";

export type StockCapability =
  | "resolve"
  | "fxRates"
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
  | "evaluator"
  | "backtest"
  | "marketBrief";

export type StockResearchCapability = Exclude<
  StockCapability,
  "resolve" | "fxRates" | "backtest" | "marketBrief"
>;

export interface InstrumentRef {
  id: string;
  market: Market;
  exchange: string;
  assetType: AssetType;
  currency: Currency;
  symbol: string;
  name: string;
}

export type EvidenceStatus = "ok" | "partial" | "unavailable";

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

export interface FxRatePairRequest {
  fromCurrency: Currency;
  toCurrency: Currency;
}

export interface StockFxRatesRequest {
  pairs: FxRatePairRequest[];
  maxAgeMs?: number;
}

export interface StockFxRateQuote extends FxRatePairRequest {
  rate: number;
  asOf: string;
}

export interface StockFxRatesResult extends EvidenceEnvelope {
  rates: StockFxRateQuote[];
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
  chart?: { bars: PriceBar[]; limit: number };
  profile?: unknown;
  metrics?: Record<string, number | string | null>;
}

export interface FinancialIncomeStatement {
  totalOperatingRevenue?: number | undefined;
  totalOperatingCost?: number | undefined;
  operatingProfit?: number | undefined;
  totalProfit?: number | undefined;
  netProfit?: number | undefined;
  deductedNetProfit?: number | undefined;
}

export interface FinancialBalanceStatement {
  totalAssets?: number | undefined;
  monetaryFunds?: number | undefined;
  inventory?: number | undefined;
  totalLiabilities?: number | undefined;
  totalEquity?: number | undefined;
  debtAssetRatio?: number | undefined;
}

export interface FinancialCashFlowStatement {
  operatingCashFlow?: number | undefined;
  investingCashFlow?: number | undefined;
  financingCashFlow?: number | undefined;
  cashIncrease?: number | undefined;
  endingCash?: number | undefined;
}

export interface FinancialStatementPeriod {
  reportDate: string;
  income: FinancialIncomeStatement | null;
  balance: FinancialBalanceStatement | null;
  cashFlow: FinancialCashFlowStatement | null;
}

export interface StockFinancials {
  reportDate: string;
  currency: string;
  statements: {
    income: FinancialIncomeStatement | null;
    balance: FinancialBalanceStatement | null;
    cashFlow: FinancialCashFlowStatement | null;
  };
  periods: FinancialStatementPeriod[];
  coverage: {
    requestedPeriods: number;
    returnedPeriods: number;
    completePeriods: number;
    oldestReportDate?: string;
    newestReportDate?: string;
  };
  missingStatements: string[];
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
  includeHistory?: boolean;
  historyLimit?: number;
  includeProfile?: boolean;
}
export interface StockResearchRequest {
  instrument: InstrumentRef;
  historyLimit?: number;
  capabilities?: StockResearchCapability[];
  strategyIds?: QuantStrategyId[];
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
  strategy?: {
    id?: StockBacktestStrategyId;
    shortWindow?: number;
    longWindow?: number;
  };
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
    id: string;
    version: string;
    parameters: Record<string, unknown>;
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
  state: "ready" | "disabled" | "unconfigured" | "cooldown" | "unavailable";
  enabled: boolean;
  configured: boolean;
  available: boolean;
  warnings?: string[];
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
  fxRates?(
    request: StockFxRatesRequest,
    context: ProviderContext
  ): Promise<ProviderEvidence<StockFxRateQuote[]>>;
  snapshot?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<StockSnapshot>>;
  history?(
    instrument: InstrumentRef,
    request: HistoryRequest,
    context: ProviderContext
  ): Promise<ProviderEvidence<PriceBar[]>>;
  profile?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
  financials?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<StockFinancials>>;
  shareholders?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
  dividend?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
  moneyFlow?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
  news?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
  notices?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
  etf?(
    instrument: InstrumentRef,
    context: ProviderContext
  ): Promise<ProviderEvidence<unknown>>;
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

export interface StockFxRatePort {
  fxRates(
    request: StockFxRatesRequest,
    signal?: AbortSignal
  ): Promise<StockFxRatesResult>;
}

export type StockSidecarPort = StockResearchPort & StockFxRatePort;
