import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeStrategies,
  computeQuantIndicators,
  evaluateResearchQuality,
  fuseSignals,
  listStrategies,
  makeInstrument,
} from "../src/index.ts";
import type { PriceBar, StockSnapshot } from "../src/index.ts";

function sampleBars(length = 90): PriceBar[] {
  return Array.from({ length }, (_, index) => {
    const close = 100 + index * 0.45 + Math.sin(index / 3) * 2;
    const open = close - Math.cos(index / 4);
    return {
      time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.1,
      close,
      volume: 100_000 + index * 1_500 + (index % 7) * 5_000,
    };
  });
}

test("quant indicators expose the migrated indicator families without future leakage", () => {
  const bars = sampleBars();
  const full = computeQuantIndicators(bars);
  const prefix = computeQuantIndicators(bars.slice(0, 60));
  assert.deepEqual(full[59], prefix.at(-1));
  const latest = full.at(-1)!;
  for (const key of [
    "bollingerUpper",
    "bollingerLower",
    "kdjK",
    "kdjD",
    "kdjJ",
    "cci20",
    "williamsR",
    "obv",
    "adx14",
    "plusDi14",
    "minusDi14",
    "volumeRatio",
  ] as const) {
    assert.equal(typeof latest[key], "number", key);
  }
});

test("strategy registry contains five deterministic strategies and fuses their signals", () => {
  const bars = sampleBars();
  const indicators = computeQuantIndicators(bars);
  assert.deepEqual(
    listStrategies().map((item) => item.id),
    ["trend", "mean-reversion", "breakout", "momentum", "volume-price"]
  );
  const context = { bars, indicators, index: bars.length - 1 };
  const firstSignals = analyzeStrategies(context);
  const secondSignals = analyzeStrategies(context);
  assert.deepEqual(secondSignals, firstSignals);
  assert.deepEqual(fuseSignals(secondSignals), fuseSignals(firstSignals));
  assert.match(fuseSignals(firstSignals).algorithm.id, /signal-fusion/);
});

test("evaluator reports quality and weighted dimensions instead of one threshold", () => {
  const bars = sampleBars();
  const indicators = computeQuantIndicators(bars);
  const signals = analyzeStrategies({
    bars,
    indicators,
    index: bars.length - 1,
  });
  const instrument = makeInstrument(
    "CN",
    "600519",
    "SSE",
    "EQUITY",
    "CNY",
    "贵州茅台"
  );
  const snapshot: StockSnapshot = {
    instrument,
    price: bars.at(-1)!.close,
    marketTime: "2026-07-16T10:00:00+08:00",
  };
  const input = {
    snapshot,
    bars,
    indicator: indicators.at(-1)!,
    signals,
    financials: {
      statements: {
        income: { netProfit: 10 },
        balance: { debtAssetRatio: 35 },
        cashFlow: { operatingCashFlow: 12 },
      },
    },
  };
  const first = evaluateResearchQuality(input);
  const second = evaluateResearchQuality(input);
  assert.deepEqual(second, first);
  assert.equal(first.id, "calen.multi-factor-evaluator");
  assert.equal(first.version, "2.0.0");
  assert.equal(first.quality.dimensionsPlanned, 5);
  assert.equal(first.quality.dimensionsActual, 5);
  assert.equal(first.quality.hasFinancials, true);
  assert.deepEqual(
    first.dimensions.map((item) => item.id),
    ["trend", "momentum", "volume", "risk", "fundamental"]
  );
  assert.ok(first.score >= 0 && first.score <= 100);
});
