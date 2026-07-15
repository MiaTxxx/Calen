export { createStockResearchService } from "./service.ts";
export { makeInstrument, normalizeInstrument } from "./instruments.ts";
export { ProviderError, ProviderRegistry } from "./providers/registry.ts";
export { createDefaultProviders } from "./providers/defaults.ts";
export {
  createTencentBasicProfileProvider,
  createTencentProvider,
} from "./providers/tencent.ts";
export { createEastmoneyProvider } from "./providers/eastmoney.ts";
export { createSinafinanceProvider } from "./providers/sinafinance.ts";
export { createBaostockProvider } from "./providers/baostock.ts";
export { createTushareProvider } from "./providers/tushare.ts";
export { createTickflowProvider } from "./providers/tickflow.ts";
export { createZzshareProvider } from "./providers/zzshare.ts";
export { createFuyaoProvider } from "./providers/fuyao.ts";
export {
  analyzeTechnicals,
  evaluateResearch,
  relativeStrengthIndex,
  simpleMovingAverage,
} from "./analytics.ts";
export { runBacktest } from "./backtest.ts";
export { dispatchJsonRpc, runJsonRpcStdio } from "./json-rpc.ts";
export {
  createStockResearchServiceFromEnvironment,
  loadStockRuntimeConfig,
} from "./config.ts";
export type * from "./types.ts";
