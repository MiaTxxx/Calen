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
    technical: {
      rsi14: number;
      trend: string;
      bollingerUpper: number;
      kdjK: number;
      cci20: number;
      adx14: number;
    };
    score: {
      value: number;
      algorithm: { id: string; version: string; parameters: unknown };
    };
    evaluator: {
      rating: string;
      parameters: unknown;
      quality: { dimensionsActual: number };
      dimensions: Array<{ id: string }>;
    };
    analysisMetadata: {
      algorithm: { id: string; version: string; parameters: unknown };
      sample: { bars: number; coverage: number };
      benchmark: { name: string; returnPercent: number | null };
      limitations: string[];
    };
  };

  assert.equal(result.status, "ok");
  assert.equal(data.technical.rsi14, 100);
  assert.equal(data.technical.trend, "bullish");
  assert.equal(data.score.algorithm.id, "calen.multi-factor-score");
  assert.equal(data.score.algorithm.version, "2.0.0");
  assert.ok(data.score.algorithm.parameters);
  assert.ok(data.score.value >= 0 && data.score.value <= 100);
  assert.equal(data.evaluator.rating, "positive");
  assert.ok(data.evaluator.parameters);
  assert.equal(data.evaluator.quality.dimensionsActual, 4);
  assert.ok(data.evaluator.dimensions.some((item) => item.id === "risk"));
  assert.equal(data.analysisMetadata.algorithm.id, "calen.research-analytics");
  assert.equal(data.analysisMetadata.algorithm.version, "2.0.0");
  assert.ok(data.analysisMetadata.algorithm.parameters);
  assert.equal(data.analysisMetadata.sample.bars, 30);
  assert.equal(data.analysisMetadata.sample.coverage, 1);
  assert.equal(data.analysisMetadata.benchmark.name, "buy-and-hold");
  assert.equal(typeof data.analysisMetadata.benchmark.returnPercent, "number");
  assert.ok(data.analysisMetadata.limitations.length >= 3);
  assert.deepEqual(
    result.sources.map((source) => source.capability),
    ["snapshot", "history"]
  );
});

test("research marks every requested but unavailable capability as partial", async () => {
  const provider: StockProvider = {
    id: "core-only",
    priority: 1,
    capabilities: ["snapshot", "history"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 129, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
    async history() {
      return { data: bars, asOf: "2026-07-15" };
    },
  };
  const service = createStockResearchService({ providers: [provider] });
  const result = await service.research({
    instrument,
    historyLimit: 30,
    capabilities: [
      "snapshot",
      "history",
      "financials",
      "notices",
      "technical",
      "score",
    ],
  });
  const data = result.data as {
    capabilities: Record<string, { status: string; data: unknown }>;
  };

  assert.equal(result.status, "partial");
  assert.equal(data.capabilities.snapshot!.status, "ok");
  assert.equal(data.capabilities.history!.status, "ok");
  assert.equal(data.capabilities.technical!.status, "ok");
  assert.equal(data.capabilities.score!.status, "ok");
  assert.equal(data.capabilities.financials!.status, "unavailable");
  assert.equal(data.capabilities.notices!.status, "unavailable");
  assert.equal(data.capabilities.financials!.data, null);
  assert.match(
    result.warnings.join("\n"),
    /financials.*没有可用 Provider|notices.*没有可用 Provider/
  );
});

test("local analytics include their implicit history evidence source", async () => {
  const provider: StockProvider = {
    id: "history-evidence",
    priority: 1,
    capabilities: ["history"],
    async history() {
      return { data: bars, asOf: "2026-07-15" };
    },
  };
  const service = createStockResearchService({ providers: [provider] });
  const result = await service.research({
    instrument,
    capabilities: ["technical", "score", "strategy", "evaluator"],
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.sources.map((source) => source.capability),
    ["history"]
  );
  assert.equal(result.cached, false);
});

test("research can select a subset of the strategy registry", async () => {
  const provider: StockProvider = {
    id: "strategy-selection",
    priority: 1,
    capabilities: ["history"],
    async history() {
      return { data: bars, asOf: "2026-07-15" };
    },
  };
  const result = await createStockResearchService({
    providers: [provider],
  }).research({
    instrument,
    capabilities: ["strategy"],
    strategyIds: ["breakout"],
  });
  const data = result.data as {
    strategy: { algorithm: { parameters: { selectedStrategies: string[] } } };
  };
  assert.equal(result.status, "ok");
  assert.deepEqual(data.strategy.algorithm.parameters.selectedStrategies, [
    "breakout",
  ]);
});
