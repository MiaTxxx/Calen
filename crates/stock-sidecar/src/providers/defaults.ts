import type { StockProvider } from "../types.ts";
import { createTencentProvider } from "./tencent.ts";
import { createEastmoneyProvider } from "./eastmoney.ts";

export function createDefaultProviders(): StockProvider[] {
  return [createTencentProvider(), createEastmoneyProvider()];
}
