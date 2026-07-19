import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mapStockBacktestResult,
  toSidecarBacktestRequest,
} from "../../src/lib/stock-research/contracts.ts";
import { toStockSidecarToolPayload } from "../../src/lib/tools/stockToolContracts.ts";
import { readStockHubSource } from "../helpers/stock-hub-source.mjs";

const instrument = {
  id: "CN:600519",
  symbol: "600519",
  name: "贵州茅台",
  market: "CN",
  exchange: "SSE",
  assetType: "stock",
  currency: "CNY",
};

test("backtest v2 preserves time split, execution evidence and timed equity points", () => {
  const result = mapStockBacktestResult({
    status: "partial",
    data: {
      instrument,
      algorithm: {
        id: "calen.sma-cross",
        version: "2.0.0",
        parameters: { feeRate: 0.0003, evaluationRatio: 0.3 },
      },
      sample: {
        start: "2025-01-01",
        end: "2025-12-31",
        bars: 200,
        coverage: 0.9,
        calibration: {
          start: "2025-01-01",
          end: "2025-09-30",
          bars: 140,
          coverage: 0.95,
        },
        evaluation: {
          start: "2025-10-01",
          end: "2025-12-31",
          bars: 60,
          coverage: 0.9,
        },
      },
      benchmark: { name: "buy-and-hold", returnPercent: 5 },
      metrics: { returnPercent: 8, maxDrawdownPercent: 3 },
      trades: [
        {
          side: "buy",
          signalTime: "2025-10-02",
          executionTime: "2025-10-03",
          price: 100,
          quantity: 10,
          fee: 0.3,
        },
      ],
      equityCurve: [
        { time: "2025-10-01", equity: 100_000 },
        { time: "2025-12-31", equity: 108_000 },
      ],
      limitations: ["research only"],
    },
    warnings: ["coverage is partial"],
  });

  assert.equal(result.status, "partial");
  assert.equal(result.data?.instrument?.id, "CN:600519");
  assert.equal(result.data?.sample.calibration.points, 140);
  assert.equal(result.data?.sample.evaluation.points, 60);
  assert.deepEqual(result.data?.trades[0], {
    side: "buy",
    signalTime: "2025-10-02",
    executionTime: "2025-10-03",
    price: 100,
    quantity: 10,
    fee: 0.3,
  });
  assert.deepEqual(result.data?.equityCurve, [
    { time: "2025-10-01", equity: 100_000 },
    { time: "2025-12-31", equity: 108_000 },
  ]);
});

test("unavailable backtests never expose zero-return placeholder data", () => {
  const result = mapStockBacktestResult({
    status: "unavailable",
    data: {
      metrics: { returnPercent: 0, maxDrawdownPercent: 0 },
      benchmark: { returnPercent: 0 },
      equityCurve: [],
    },
    warnings: ["coverage unavailable"],
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.data, null);
});

test("GUI and AI requests forward the evaluation ratio and use the fixed buy-and-hold benchmark", () => {
  const gui = toSidecarBacktestRequest({
    instrument,
    strategy: "fused",
    from: "2025-01-01",
    to: "2025-12-31",
    evaluationRatio: 0.4,
    benchmark: "market",
  });
  const ai = toStockSidecarToolPayload("backtest", {
    instrument,
    strategy: "fused",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    evaluationRatio: 0.45,
    benchmark: "market",
  });

  assert.equal(gui.evaluationRatio, 0.4);
  assert.equal(ai.evaluationRatio, 0.45);
  assert.equal("benchmark" in gui, false);
  assert.equal("benchmark" in ai, false);
});

test("Lab renders split windows, execution fees and a dated equity series", async () => {
  const hub = await readStockHubSource();
  const chart = await readFile(
    new URL("../../src/pages/stock-hub/StockChart.tsx", import.meta.url),
    "utf8"
  );
  const tools = await readFile(
    new URL("../../src/lib/tools/stockResearchTools.ts", import.meta.url),
    "utf8"
  );

  assert.match(hub, /样本外评估比例/);
  assert.match(hub, /data\.sample\.calibration/);
  assert.match(hub, /data\.sample\.evaluation/);
  assert.match(hub, /trade\.signalTime/);
  assert.match(hub, /trade\.executionTime/);
  assert.match(hub, /trade\.fee/);
  assert.match(hub, /points=\{data\.equityCurve\.map/);
  assert.match(chart, /LineSeries/);
  assert.match(chart, /point\.time as Time/);
  assert.match(tools, /evaluationRatio: Type\.Optional/);
  assert.doesNotMatch(tools, /benchmark: Type\.Optional/);
});
