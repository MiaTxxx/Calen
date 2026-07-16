import type { StockProvider } from "../types.ts";
import {
  createTencentBasicProfileProvider,
  createTencentProvider,
} from "./tencent.ts";
import { createTencentFxProvider } from "./tencent-fx.ts";
import { createEastmoneyProvider } from "./eastmoney.ts";
import { createSinafinanceProvider } from "./sinafinance.ts";
import { createBaostockProvider } from "./baostock.ts";
import { createTushareProvider } from "./tushare.ts";
import { createTickflowProvider } from "./tickflow.ts";
import { createZzshareProvider } from "./zzshare.ts";
import { createFuyaoProvider } from "./fuyao.ts";

export const IMPLEMENTED_PROVIDER_IDS = [
  "tencent",
  "eastmoney",
  "sinafinance",
  "baostock",
  "tushare",
  "tickflow",
  "zzshare",
  "fuyao",
] as const;
const DEFAULT_PROVIDER_IDS = ["tencent", "eastmoney"] as const;

export function createDefaultProviders(
  enabledIds: readonly string[] = DEFAULT_PROVIDER_IDS,
  providerKeys: Readonly<Record<string, string>> = {}
): StockProvider[] {
  const enabled = new Set(enabledIds);
  const providers: StockProvider[] = [];
  if (enabled.has("tencent")) {
    providers.push(
      createTencentProvider(),
      createTencentBasicProfileProvider(),
      createTencentFxProvider()
    );
  }
  if (enabled.has("eastmoney")) providers.push(createEastmoneyProvider());
  if (enabled.has("sinafinance")) providers.push(createSinafinanceProvider());
  if (enabled.has("baostock")) providers.push(createBaostockProvider());
  const tushareToken = providerKeys.tushare?.trim();
  if (enabled.has("tushare") && tushareToken)
    providers.push(createTushareProvider(tushareToken));
  const tickflowApiKey = providerKeys.tickflow?.trim();
  if (enabled.has("tickflow") && tickflowApiKey)
    providers.push(createTickflowProvider(tickflowApiKey));
  if (enabled.has("zzshare"))
    providers.push(createZzshareProvider(providerKeys.zzshare));
  const fuyaoApiKey = providerKeys.fuyao?.trim();
  if (enabled.has("fuyao") && fuyaoApiKey)
    providers.push(createFuyaoProvider(fuyaoApiKey));
  return providers;
}
