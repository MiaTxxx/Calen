import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { buildStockResultCardModel, formatStockResultMetric } =
  loader.loadModule("src/lib/chat/messages/stockResultCard.ts");

test("stock result card extracts only finite quote metrics and bounded K-line closes", () => {
  const model = buildStockResultCardModel({
    operation: "snapshot",
    status: "partial",
    result: {
      status: "partial",
      data: {
        price: 1512.25,
        change: 12.25,
        changePercent: 0.8167,
        open: 1501,
        high: 1520,
        low: 1499,
        previousClose: 1500,
        volume: 123456,
        chart: {
          bars: [
            { time: "2026-07-14", close: 1490 },
            { time: "2026-07-15", close: "invalid" },
            { time: "2026-07-16", close: 1512.25 },
          ],
        },
      },
    },
  });

  assert.deepEqual(
    model.metrics.map(({ id, value }) => ({ id, value })),
    [
      { id: "price", value: 1512.25 },
      { id: "changePercent", value: 0.8167 },
      { id: "change", value: 12.25 },
      { id: "open", value: 1501 },
      { id: "high", value: 1520 },
      { id: "low", value: 1499 },
    ]
  );
  assert.deepEqual(model.trend, {
    label: "价格走势",
    values: [1490, 1512.25],
    tone: "up",
  });

  const changeOnlyModel = buildStockResultCardModel({
    operation: "snapshot",
    status: "ok",
    result: {
      data: {
        price: 1490,
        change: -10,
        chart: { bars: [{ close: 1500 }, { close: 1490 }] },
      },
    },
  });
  assert.equal(changeOnlyModel.trend?.tone, "down");
});

test("stock result card extracts backtest metrics and an existing equity curve without inventing data", () => {
  const model = buildStockResultCardModel({
    operation: "backtest",
    status: "ok",
    result: {
      algorithm: { id: "calen.sma-cross", version: "1.0.0" },
      sample: { bars: 240, coverage: 0.875 },
      benchmark: { name: "buy-and-hold", returnPercent: 8.5 },
      metrics: {
        finalEquity: 112000,
        returnPercent: 12,
        maxDrawdownPercent: 4.25,
      },
      trades: [{ side: "buy" }, { side: "sell" }],
      equityCurve: [
        { time: "2025-01-01", equity: 100000 },
        { time: "2025-06-01", value: 104000 },
        { time: "2026-01-01", equity: 112000 },
      ],
    },
  });

  assert.deepEqual(
    model.metrics.map(({ id, value }) => ({ id, value })),
    [
      { id: "returnPercent", value: 12 },
      { id: "benchmarkReturnPercent", value: 8.5 },
      { id: "maxDrawdownPercent", value: 4.25 },
      { id: "finalEquity", value: 112000 },
      { id: "sampleBars", value: 240 },
      { id: "coverage", value: 0.875 },
      { id: "tradeCount", value: 2 },
    ]
  );
  assert.deepEqual(model.trend, {
    label: "权益曲线",
    values: [100000, 104000, 112000],
    tone: "up",
  });
  assert.equal(
    model.metrics.find((metric) => metric.id === "maxDrawdownPercent")?.tone,
    undefined
  );
  assert.equal(formatStockResultMetric(model.metrics[0]), "+12.00%");
  assert.equal(formatStockResultMetric(model.metrics[5]), "87.50%");
});

test("unavailable or malformed stock results do not surface stale or inferred metrics", () => {
  assert.deepEqual(
    buildStockResultCardModel({
      operation: "snapshot",
      status: "unavailable",
      result: {
        data: {
          price: 1500,
          chart: { bars: [{ close: 1500 }, { close: 1510 }] },
        },
      },
    }),
    { metrics: [] }
  );
  assert.deepEqual(
    buildStockResultCardModel({
      operation: "backtest",
      status: "partial",
      result: {
        metrics: { returnPercent: "12", maxDrawdownPercent: Number.NaN },
        benchmark: { returnPercent: Number.POSITIVE_INFINITY },
        equityCurve: ["100", null, {}],
      },
    }),
    { metrics: [] }
  );
});
