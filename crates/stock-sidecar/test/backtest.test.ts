import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService } from "../src/index.ts";
import type { PriceBar } from "../src/index.ts";

test("backtest executes a close-derived signal only at the next bar open", async () => {
  const closes = [10, 9, 8, 12, 21, 22];
  const opens = [10, 9, 8, 12, 20, 22];
  const bars: PriceBar[] = closes.map((close, index) => ({
    time: `2026-07-0${index + 1}`,
    open: opens[index]!,
    high: Math.max(opens[index]!, close) + 1,
    low: Math.min(opens[index]!, close) - 1,
    close,
  }));
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-15T00:00:00.000Z"),
  });

  const result = await service.backtest({
    bars,
    initialCash: 1_000,
    feeRate: 0,
    strategy: { shortWindow: 2, longWindow: 3 },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.trades[0]?.side, "buy");
  assert.equal(result.trades[0]?.signalTime, "2026-07-04");
  assert.equal(result.trades[0]?.executionTime, "2026-07-05");
  assert.equal(result.trades[0]?.price, 20);
  assert.equal(result.algorithm.id, "calen.sma-cross");
  assert.equal(result.algorithm.version, "1.0.0");
  assert.match(result.limitations.join("\n"), /下一根 K 线开盘价/);
});

test("backtest rejects invalid money and OHLC inputs instead of emitting complete metrics", async () => {
  const service = createStockResearchService({ providers: [] });
  const result = await service.backtest({
    initialCash: -1,
    bars: Array.from({ length: 5 }, (_, index) => ({
      time: `2026-07-0${index + 1}`,
      open: 10,
      high: 9,
      low: 11,
      close: Number.NaN,
    })),
    strategy: { shortWindow: 1, longWindow: 2 },
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.warnings.join("\n"), /initialCash|K 线/);
});

test("backtest reports benchmark and reproducible coverage for a complete sample", async () => {
  const bars: PriceBar[] = [
    { time: "2026-07-01", open: 10, high: 11, low: 9, close: 10 },
    { time: "2026-07-02", open: 10, high: 12, low: 9, close: 11 },
    { time: "2026-07-03", open: 11, high: 13, low: 10, close: 12 },
    { time: "2026-07-06", open: 12, high: 14, low: 11, close: 13 },
  ];
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });
  const request = {
    bars,
    initialCash: 1_000,
    feeRate: 0,
    strategy: { shortWindow: 2, longWindow: 3 } as const,
  };
  const first = await service.backtest(request);
  const second = await service.backtest(request);
  assert.deepEqual(second, first);
  assert.equal(first.status, "ok");
  assert.equal(first.benchmark.name, "buy-and-hold");
  assert.equal(first.benchmark.returnPercent, 30);
  assert.equal(first.sample.coverage, 1);
});

test("backtest reports a warning and reduced coverage for missing weekdays", async () => {
  const bars: PriceBar[] = [
    { time: "2026-07-01", open: 10, high: 11, low: 9, close: 10 },
    { time: "2026-07-02", open: 10, high: 12, low: 9, close: 11 },
    { time: "2026-07-03", open: 11, high: 13, low: 10, close: 12 },
    { time: "2026-07-07", open: 12, high: 14, low: 11, close: 13 },
  ];
  const result = await createStockResearchService({ providers: [] }).backtest({
    bars,
    start: "2026-07-01",
    end: "2026-07-07",
    strategy: { shortWindow: 2, longWindow: 3 },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.sample.coverage, 0.8);
  assert.match(result.warnings.join("\n"), /缺少 1 个工作日/);
});

test("backtest supports a causal strategy-registry strategy", async () => {
  const bars: PriceBar[] = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index * 0.8;
    return {
      time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10_000 + index * 100,
    };
  });
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });
  const request = {
    bars,
    initialCash: 1_000,
    feeRate: 0,
    strategy: { id: "trend" as const },
  };
  const first = await service.backtest(request);
  const second = await service.backtest(request);
  assert.deepEqual(second, first);
  assert.equal(first.status, "ok");
  assert.equal(first.algorithm.id, "calen.strategy.trend");
  assert.equal(first.algorithm.version, "1.0.0");
  assert.ok(first.trades.length >= 1);
  assert.ok(
    first.trades.every((trade) => trade.executionTime > trade.signalTime)
  );
});
