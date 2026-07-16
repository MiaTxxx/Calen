import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";
import type { PriceBar, StockProvider } from "../src/index.ts";

const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
const bars: PriceBar[] = Array.from({ length: 25 }, (_, index) => ({
  time: `2026-06-${String(index + 1).padStart(2, "0")}`,
  open: 10 + index,
  high: 11 + index,
  low: 9 + index,
  close: 10 + index,
}));

test("all evidence methods use only ok, partial, or unavailable", async () => {
  const provider: StockProvider = {
    id: "fixture",
    priority: 1,
    capabilities: ["snapshot", "history", "marketBrief"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 34, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
    async history() {
      return { data: bars, asOf: "2026-07-15" };
    },
    async marketBrief() {
      return { data: { market: "CN", movers: [] }, asOf: "2026-07-15" };
    },
  };
  const service = createStockResearchService({ providers: [provider] });
  const results = await Promise.all([
    service.resolve({ query: "600519" }),
    service.snapshot({ instrument }),
    service.research({ instrument, historyLimit: 25 }),
    service.marketBrief({ market: "CN" }),
    service.backtest({ bars, strategy: { shortWindow: 2, longWindow: 3 } }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["ok", "ok", "ok", "ok", "ok"]
  );
  assert.ok(
    results.every((result) =>
      ["ok", "partial", "unavailable"].includes(result.status)
    )
  );
});
