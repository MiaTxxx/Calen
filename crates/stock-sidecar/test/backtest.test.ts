import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";
import type { PriceBar } from "../src/index.ts";

function weekdayBars(
  length: number,
  priceAt: (index: number) => { close: number; open?: number; volume?: number }
): PriceBar[] {
  const bars: PriceBar[] = [];
  let cursor = new Date("2026-01-05T00:00:00.000Z");
  while (bars.length < length) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      const index = bars.length;
      const price = priceAt(index);
      const open = price.open ?? price.close;
      bars.push({
        time: cursor.toISOString().slice(0, 10),
        open,
        high: Math.max(open, price.close) + 1,
        low: Math.min(open, price.close) - 1,
        close: price.close,
        volume: price.volume ?? 100_000 + index * 1_000,
      });
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return bars;
}

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
    instrument: makeInstrument(
      "CN",
      "600519",
      "SSE",
      "EQUITY",
      "CNY",
      "贵州茅台"
    ),
    bars,
    initialCash: 1_000,
    feeRate: 0,
    evaluationRatio: 0.5,
    strategy: { shortWindow: 2, longWindow: 3 },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.instrument?.id, "CN:600519");
  assert.equal(result.trades[0]?.side, "buy");
  assert.equal(result.trades[0]?.signalTime, "2026-07-04");
  assert.equal(result.trades[0]?.executionTime, "2026-07-05");
  assert.equal(result.trades[0]?.price, 20);
  assert.equal(result.algorithm.id, "calen.sma-cross");
  assert.equal(result.algorithm.version, "2.0.0");
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

test("backtest domain rejects malformed instruments and volumes", async () => {
  const service = createStockResearchService({ providers: [] });
  const bars = weekdayBars(30, (index) => ({ close: 100 + index }));
  const invalidInstrument = await service.backtest({
    instrument: { bad: true } as never,
    bars,
    strategy: { shortWindow: 2, longWindow: 3 },
  });
  const invalidVolume = await service.backtest({
    bars: bars.map((bar, index) =>
      index === 0 ? { ...bar, volume: "not-a-number" as never } : bar
    ),
    strategy: { shortWindow: 2, longWindow: 3 },
  });

  assert.equal(invalidInstrument.status, "unavailable");
  assert.match(invalidInstrument.warnings.join("\n"), /instrument|标的|证券/i);
  assert.equal(invalidVolume.status, "unavailable");
  assert.match(invalidVolume.warnings.join("\n"), /volume|成交量/i);
});

test("backtest reports benchmark and reproducible coverage for a complete sample", async () => {
  const bars = weekdayBars(10, (index) => ({ close: 10 + index }));
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });
  const request = {
    bars,
    initialCash: 1_000,
    feeRate: 0,
    evaluationRatio: 0.5,
    strategy: { shortWindow: 2, longWindow: 3 } as const,
  };
  const first = await service.backtest(request);
  const second = await service.backtest(request);
  assert.deepEqual(second, first);
  assert.equal(first.status, "ok");
  assert.equal(first.benchmark.name, "buy-and-hold");
  assert.equal(first.benchmark.returnPercent, 26.6667);
  assert.equal(first.sample.coverage, 1);
  assert.equal(first.sample.calibration.bars, 5);
  assert.equal(first.sample.evaluation.bars, 5);
});

test("backtest reports a warning and reduced coverage for missing weekdays", async () => {
  const bars = weekdayBars(10, (index) => ({ close: 10 + index }));
  bars.splice(4, 1);
  const result = await createStockResearchService({ providers: [] }).backtest({
    bars,
    start: "2026-01-05",
    end: "2026-01-16",
    strategy: { shortWindow: 2, longWindow: 3 },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.sample.coverage, 0.9);
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
  assert.equal(first.algorithm.version, "2.0.0");
  assert.equal(first.algorithm.parameters.evaluationRatio, 0.3);
  assert.equal(first.sample.calibration.bars, 56);
  assert.equal(first.sample.evaluation.bars, 24);
  assert.ok(first.trades.length >= 1);
  assert.ok(
    first.trades.every((trade) => trade.executionTime > trade.signalTime)
  );
});

test("backtest reports calibration and out-of-sample evaluation windows", async () => {
  const closes = [...Array.from({ length: 15 }, () => 10), 9, 8, 20, 21, 22];
  const bars = weekdayBars(closes.length, (index) => ({
    close: closes[index]!,
    open: index === 18 ? 19 : closes[index]!,
  }));
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });
  const request = {
    bars,
    initialCash: 1_000,
    feeRate: 0,
    evaluationRatio: 0.25,
    strategy: { shortWindow: 2, longWindow: 3 },
  };

  const first = await service.backtest(request);
  const second = await service.backtest(request);

  assert.deepEqual(second, first);
  assert.equal(first.status, "ok");
  assert.deepEqual(first.sample.calibration, {
    start: bars[0]!.time,
    end: bars[14]!.time,
    bars: 15,
    coverage: 1,
  });
  assert.deepEqual(first.sample.evaluation, {
    start: bars[15]!.time,
    end: bars[19]!.time,
    bars: 5,
    coverage: 1,
  });
  assert.equal(first.benchmark.returnPercent, 144.4444);
  assert.equal(first.equityCurve.length, 5);
  assert.deepEqual(first.equityCurve[0], {
    time: bars[15]!.time,
    equity: 1_000,
  });
  assert.equal(first.metrics.finalEquity, first.equityCurve.at(-1)!.equity);
  assert.ok(
    first.trades.every(
      (trade) =>
        trade.signalTime >= first.sample.evaluation.start &&
        trade.executionTime >= first.sample.evaluation.start
    )
  );
  const changedFuture = bars.map((bar, index) =>
    index === bars.length - 1
      ? {
          ...bar,
          close: bar.close * 5,
          high: Math.max(bar.high, bar.close * 5 + 1),
        }
      : bar
  );
  const changed = await service.backtest({ ...request, bars: changedFuture });
  assert.deepEqual(changed.trades, first.trades);
  assert.deepEqual(
    changed.equityCurve.slice(0, -1),
    first.equityCurve.slice(0, -1)
  );
});

test("coverage below one is partial and severe coverage loss is unavailable", async () => {
  const partialBars = weekdayBars(10, (index) => ({ close: 10 + index }));
  partialBars.splice(4, 1);
  const service = createStockResearchService({ providers: [] });
  const partial = await service.backtest({
    bars: partialBars,
    start: "2026-01-05",
    end: "2026-01-16",
    strategy: { shortWindow: 2, longWindow: 3 },
  });
  assert.equal(partial.sample.coverage, 0.9);
  assert.equal(partial.status, "partial");

  const sparseBars = weekdayBars(25, (index) => ({ close: 100 + index }));
  const unavailable = await service.backtest({
    bars: sparseBars,
    start: "2026-01-05",
    end: "2026-04-03",
    evaluationRatio: 0.2,
    strategy: { id: "breakout" },
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.algorithm.id, "calen.strategy.breakout");
  assert.equal(unavailable.algorithm.parameters.strategyId, "breakout");
  assert.equal(unavailable.algorithm.parameters.evaluationRatio, 0.2);
  assert.equal(unavailable.sample.bars, 25);
  assert.equal(unavailable.equityCurve.length, 0);
});

test("all five registry strategies and fused stay deterministic and causal out of sample", async () => {
  const bars = weekdayBars(140, (index) => {
    const wave = Math.sin(index / 3) * 7 + Math.sin(index / 11) * 4;
    const breakout = index >= 98 ? (index - 97) * 0.65 : 0;
    const close = 100 + index * 0.12 + wave + breakout;
    return {
      close,
      open: close - Math.sin(index / 2) * 1.4,
      volume: 100_000 + (index % 12 === 0 ? 260_000 : 0) + index * 1_100,
    };
  });
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });
  const strategyIds = [
    "trend",
    "mean-reversion",
    "breakout",
    "momentum",
    "volume-price",
    "fused",
  ] as const;

  for (const id of strategyIds) {
    const request = {
      bars,
      initialCash: 50_000,
      feeRate: 0.0003,
      evaluationRatio: 0.4,
      strategy: { id },
    };
    const first = await service.backtest(request);
    const second = await service.backtest(request);
    assert.deepEqual(second, first, id);
    assert.equal(first.status, "ok", id);
    assert.equal(first.sample.calibration.bars, 84, id);
    assert.equal(first.sample.evaluation.bars, 56, id);
    assert.equal(first.equityCurve.length, 56, id);
    assert.equal(first.algorithm.parameters.evaluationRatio, 0.4, id);
    assert.ok(first.trades.length > 0, `${id} should exercise trade state`);
    for (const trade of first.trades) {
      const signalIndex = bars.findIndex(
        (bar) => bar.time === trade.signalTime
      );
      const executionIndex = bars.findIndex(
        (bar) => bar.time === trade.executionTime
      );
      assert.equal(executionIndex, signalIndex + 1, id);
      assert.equal(trade.price, bars[executionIndex]!.open, id);
      assert.ok(trade.signalTime >= first.sample.evaluation.start, id);
    }

    const changedFuture = bars.map((bar, index) =>
      index === bars.length - 1
        ? {
            ...bar,
            close: bar.close * 4,
            high: Math.max(bar.high, bar.close * 4 + 1),
          }
        : bar
    );
    const changed = await service.backtest({ ...request, bars: changedFuture });
    assert.deepEqual(changed.trades, first.trades, id);
    assert.deepEqual(
      changed.equityCurve.slice(0, -1),
      first.equityCurve.slice(0, -1),
      id
    );
  }
});

test("invalid evaluation ratios are unavailable without losing requested parameters", async () => {
  const result = await createStockResearchService({ providers: [] }).backtest({
    bars: weekdayBars(30, (index) => ({ close: 100 + index })),
    evaluationRatio: 0.05,
    strategy: { id: "momentum" },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.algorithm.id, "calen.strategy.momentum");
  assert.equal(result.algorithm.parameters.evaluationRatio, 0.05);
  assert.match(result.warnings.join("\n"), /evaluationRatio/);
});
