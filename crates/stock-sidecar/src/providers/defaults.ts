import type { StockProvider } from "../types.ts";
import {
  createTencentBasicProfileProvider,
  createTencentProvider,
} from "./tencent.ts";
import { createEastmoneyProvider } from "./eastmoney.ts";

export const IMPLEMENTED_PROVIDER_IDS = ["tencent", "eastmoney"] as const;

export function createDefaultProviders(
  enabledIds: readonly string[] = IMPLEMENTED_PROVIDER_IDS
): StockProvider[] {
  const enabled = new Set(enabledIds);
  const providers: StockProvider[] = [];
  if (enabled.has("tencent")) {
    providers.push(
      createTencentProvider(),
      createTencentBasicProfileProvider()
    );
  }
  if (enabled.has("eastmoney")) providers.push(createEastmoneyProvider());
  return providers;
}
