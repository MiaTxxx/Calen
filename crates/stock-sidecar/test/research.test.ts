import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";
import type { PriceBar, StockProvider } from "../src/index.ts";

const instrument = makeInstrument(
  "CN",
  "600519",
  "SSE",
  "EQUITY",
  "CNY",
  "贵州茅台"
);
const bars: PriceBar[] = Array.from({ length: 30 }, (_, index) => {
  const close = 100 + index;
  return {
    time: `2026-06-${String(index + 1).padStart(2, "0")}`,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000 + index,
  };
});

test("research does not manufacture a score when history evidence is unavailable", async () => {
  const provider: StockProvider = {
    id: "quote-only",
    priority: 1,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 129, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  };
  const service = createStockResearchService({ providers: [provider] });
  const result = await service.research({ instrument });
  const data = result.data as {
    technical: unknown;
    score: unknown;
    evaluator: unknown;
  };
  assert.equal(result.status, "partial");
  assert.equal(data.technical, null);
  assert.equal(data.score, null);
  assert.equal(data.evaluator, null);
  assert.match(result.warnings.join("\n"), /历史行情不足/);
});

test("research combines facts with versioned technical score and evaluator output", async () => {
  const provider: StockProvider = {
    id: "fixture",
    priority: 1,
    capabilities: ["snapshot", "history"],
    async snapshot(ref) {
      return {
        data: {
          instrument: ref,
          price: 129,
          marketTime: "2026-07-15T07:00:00.000Z",
        },
        asOf: "2026-07-15T07:00:00.000Z",
      };
    },
    async history() {
      return { data: bars, asOf: "2026-06-30T00:00:00.000Z" };
    },
  };
  const service = createStockResearchService({
    providers: [provider],
    now: () => new Date("2026-07-15T07:00:01.000Z"),
  });

  const result = await service.research({ instrument, historyLimit: 30 });
  const data = result.data as {
    technical: { rsi14: number; trend: string };
    score: { value: number; algorithm: string };
    evaluator: { rating: string };
  };

  assert.equal(result.status, "complete");
  assert.equal(data.technical.rsi14, 100);
  assert.equal(data.technical.trend, "bullish");
  assert.equal(data.score.algorithm, "calen.technical-score@1.0.0");
  assert.ok(data.score.value >= 70);
  assert.equal(data.evaluator.rating, "positive");
  assert.deepEqual(
    result.sources.map((source) => source.capability),
    ["snapshot", "history"]
  );
});
