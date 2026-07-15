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
