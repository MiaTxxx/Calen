export type StockMarket = "CN" | "HK" | "US" | "UNKNOWN";
export type StockAssetType = "stock" | "etf" | "index" | "fund" | "unknown";
export type StockResultStatus = "ok" | "partial" | "unavailable";
export type StockQuantStrategyId =
  | "trend"
  | "mean-reversion"
  | "breakout"
  | "momentum"
  | "volume-price";
export type StockBacktestStrategyId = "sma-cross" | StockQuantStrategyId | "fused";

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
  | "evaluator"
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
  capability?: string;
  asOf?: string;
  retrievedAt?: string;
  cached?: boolean;
}

export interface StockEvidenceMetadata {
  status: StockResultStatus;
  sources: EvidenceSource[];
  asOf: string | null;
  retrievedAt: string;
  cached: boolean;
  warnings: string[];
}

export interface StockEvidenceResult<T = unknown> extends StockEvidenceMetadata {
  data: T | null;
}

export interface InstrumentSearchResult extends StockEvidenceMetadata {
  instruments: InstrumentRef[];
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

export type ResearchExperimentalCapability = "technical" | "score" | "strategy" | "evaluator";

export interface ResearchExperimentalAnalysis {
  capability: ResearchExperimentalCapability;
  status: StockResultStatus;
  summary: string | null;
  warnings: string[];
}

export interface ResearchAnalysisMetadata {
  algorithm: {
    id: string;
    version: string;
    parameters: Record<string, unknown>;
  };
  sample: {
    start: string | null;
    end: string | null;
    bars: number;
    coverage: number;
  };
  benchmark: {
    name: string;
    returnPercent: number | null;
  };
  limitations: string[];
}

export interface ResearchEvidenceSection {
  capability:
    | "profile"
    | "financials"
    | "shareholders"
    | "dividend"
    | "moneyFlow"
    | "news"
    | "notices"
    | "etf";
  status: StockResultStatus;
  data: unknown;
  warnings: string[];
}

export interface ResearchBundle {
  instrument: InstrumentRef;
  title: string;
  summary: string;
  facts: string[];
  positiveCases: string[];
  risks: string[];
  openQuestions: string[];
  evidenceSections: ResearchEvidenceSection[];
  experimentalAnalysis: ResearchExperimentalAnalysis[];
  analysisMetadata?: ResearchAnalysisMetadata;
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
  providerKeyUpdates?: Partial<Record<"zzshare" | "tushare" | "tickflow" | "fuyao", string | null>>;
}

export type StockBackupRestoreMode = "replaceAll" | "merge";
export type StockCurrency = "CNY" | "HKD" | "USD";
export type StockTransactionKind = "BUY" | "SELL" | "FEE" | "DIVIDEND" | "SPLIT" | "ADJUSTMENT";

export interface EncryptedStockBackupEnvelope {
  formatVersion: number;
  cipher: string;
  createdAt: string;
  payloadBase64: string;
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

export interface StockWatchlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface StockPortfolioInstrument {
  instrumentId: string;
  market: string;
  exchange?: string | null;
  symbol: string;
  assetType: string;
  currency: StockCurrency;
  displayName: string;
}

export interface StockWatchlistItem {
  watchlistId: string;
  instrument: StockPortfolioInstrument;
  note?: string | null;
  addedAt: number;
}

export interface StockWatchlistView extends StockWatchlist {
  items: StockWatchlistItem[];
}

export interface StockPortfolioRecord {
  id: string;
  name: string;
  baseCurrency: StockCurrency;
  createdAt: number;
  updatedAt: number;
}

export interface StockTransactionInput {
  id?: string;
  portfolioId: string;
  instrument: StockPortfolioInstrument;
  transactionType: StockTransactionKind;
  occurredAt: string;
  quantity?: number | null;
  price?: number | null;
  fee?: number | null;
  cashAmount?: number | null;
  splitRatio?: number | null;
  note?: string | null;
}

export interface StockTransactionRecord extends StockTransactionInput {
  id: string;
  createdAt: number;
}

export interface StockPriceInput {
  instrumentId: string;
  currency: StockCurrency;
  price: number;
  asOf: string;
}

export interface StockFxRateInput {
  fromCurrency: StockCurrency;
  toCurrency: StockCurrency;
  rate: number;
  asOf: string;
}

export interface StockPositionSnapshot {
  instrument: StockPortfolioInstrument;
  quantity: number;
  averageCost: number;
  costBasis: number;
  realizedPnl: number;
  currentPrice?: number | null;
  priceAsOf?: string | null;
  marketValue?: number | null;
  unrealizedPnl?: number | null;
}

export interface StockCurrencyTotals {
  currency: StockCurrency;
  costBasis: number;
  realizedPnl: number;
  marketValue?: number | null;
  unrealizedPnl?: number | null;
}

export interface StockBaseCurrencyTotals extends StockCurrencyTotals {
  fxAsOf?: string | null;
}

export interface StockPortfolioAnalysis {
  portfolio: StockPortfolioRecord;
  positions: StockPositionSnapshot[];
  totalsByCurrency: StockCurrencyTotals[];
  baseCurrencyTotals?: StockBaseCurrencyTotals | null;
  warnings: string[];
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
  strategyIds?: StockQuantStrategyId[];
}
export interface MarketBriefRequest {
  market: StockMarket;
  session?: "pre_open" | "close" | "on_demand";
}
export interface StockBacktestRequest {
  instrument: InstrumentRef;
  strategy: StockBacktestStrategyId | "moving_average";
  from: string;
  to: string;
  parameters?: Record<string, unknown>;
  benchmark?: string;
}

export interface StockResearchPort {
  resolve(request: StockResolveRequest): Promise<InstrumentSearchResult>;
  snapshot(request: StockSnapshotRequest): Promise<StockEvidenceResult<QuoteSnapshot>>;
  research(request: StockResearchRequest): Promise<StockEvidenceResult<ResearchBundle>>;
  marketBrief(request: MarketBriefRequest): Promise<StockEvidenceResult<MarketBrief>>;
  backtest(request: StockBacktestRequest): Promise<StockEvidenceResult<BacktestResult>>;
  status(): Promise<StockServiceStatus>;
  settingsGet(): Promise<StockSettings>;
  settingsSave(payload: StockSettingsSavePayload): Promise<StockSettings>;
  portfolioRead(): Promise<PortfolioSnapshot>;
  portfolioImportCsv(csv: string): Promise<PortfolioSnapshot>;
  portfolioExportCsv(portfolioId?: string): Promise<{ fileName: string; csv: string }>;
  portfolioExportEncryptedBackup(password: string): Promise<EncryptedStockBackupEnvelope>;
  portfolioRestoreEncryptedBackup(
    envelope: EncryptedStockBackupEnvelope,
    password: string,
    mode: StockBackupRestoreMode,
  ): Promise<void>;
  watchlistCreate(name: string): Promise<StockWatchlist>;
  watchlistList(): Promise<StockWatchlistView[]>;
  watchlistAddItem(
    watchlistId: string,
    instrument: StockPortfolioInstrument,
    note?: string,
  ): Promise<StockWatchlistItem>;
  watchlistRemoveItem(watchlistId: string, instrumentId: string): Promise<boolean>;
  portfolioCreate(name: string, baseCurrency: StockCurrency): Promise<StockPortfolioRecord>;
  portfolioList(): Promise<StockPortfolioRecord[]>;
  portfolioRecordTransaction(input: StockTransactionInput): Promise<StockTransactionRecord>;
  portfolioDeleteTransaction(transactionId: string): Promise<boolean>;
  portfolioListTransactions(portfolioId: string): Promise<StockTransactionRecord[]>;
  portfolioAnalyze(
    portfolioId: string,
    prices?: StockPriceInput[],
    fxRates?: StockFxRateInput[],
  ): Promise<StockPortfolioAnalysis>;
  portfolioImportCsvTo(portfolioId: string, document: string): Promise<{ imported: number }>;
  portfolioExportCsvOf(portfolioId: string): Promise<string>;
}
