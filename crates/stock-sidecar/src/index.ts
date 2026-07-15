export { createStockResearchService } from "./service.ts";
export { makeInstrument, normalizeInstrument } from "./instruments.ts";
export { ProviderError, ProviderRegistry } from "./providers/registry.ts";
export { createDefaultProviders } from "./providers/defaults.ts";
export { createTencentProvider } from "./providers/tencent.ts";
export { createEastmoneyProvider } from "./providers/eastmoney.ts";
export {
  analyzeTechnicals,
  evaluateResearch,
  relativeStrengthIndex,
  simpleMovingAverage,
} from "./analytics.ts";
export { runBacktest } from "./backtest.ts";
export { dispatchJsonRpc, runJsonRpcStdio } from "./json-rpc.ts";
export type * from "./types.ts";
