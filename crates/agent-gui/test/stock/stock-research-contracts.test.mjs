import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSparklinePath,
  formatStockError,
  isStockResultStatus,
  mapStockBacktestResult,
  mapStockMarketBriefResult,
  mapStockResearchResult,
  mapStockResolveEnvelope,
  mapStockServiceStatus,
  mapStockSnapshotResult,
  normalizeWarnings,
  parseFiniteNumber,
  sanitizeCsvFileName,
  toSidecarBacktestRequest,
  toSidecarResolveRequest,
  toSidecarSnapshotRequest,
} from "../../src/lib/stock-research/contracts.ts";
import { isExplicitStockPortfolioRequest } from "../../src/lib/tools/stockPortfolioAuthorization.ts";
import { toStockSidecarToolPayload } from "../../src/lib/tools/stockToolContracts.ts";

test("portfolio reads require an explicit request in the current user turn", () => {
  assert.equal(
    isExplicitStockPortfolioRequest("请分析我的持仓风险和行业暴露"),
    true
  );
  assert.equal(
    isExplicitStockPortfolioRequest("Show my portfolio exposure by market."),
    true
  );
  assert.equal(
    isExplicitStockPortfolioRequest("分析贵州茅台最近的财务与估值"),
    false
  );
  assert.equal(
    isExplicitStockPortfolioRequest("不要读取我的持仓，只分析沪深 300"),
    false
  );
  assert.equal(isExplicitStockPortfolioRequest("什么是交易记录？"), false);
  assert.equal(
    isExplicitStockPortfolioRequest("不要分析持仓，只解释这个术语"),
    false
  );
  assert.equal(isExplicitStockPortfolioRequest("分析持仓风险"), true);
});

test("stock result status only accepts the public evidence states", () => {
  assert.equal(isStockResultStatus("ok"), true);
  assert.equal(isStockResultStatus("partial"), true);
  assert.equal(isStockResultStatus("unavailable"), true);
  assert.equal(isStockResultStatus("loading"), false);
});

test("contract helpers reject invalid data instead of inventing values", () => {
  assert.deepEqual(normalizeWarnings(["限流", "", 3, null, "数据延迟"]), [
    "限流",
    "数据延迟",
  ]);
  assert.equal(parseFiniteNumber("20"), 20);
  assert.equal(parseFiniteNumber("Infinity"), null);
  assert.equal(parseFiniteNumber(""), null);
  assert.equal(formatStockError({}), "股票服务暂时不可用，请稍后重试。");
});

test("sparkline path is deterministic and rejects non-finite series", () => {
  assert.equal(
    buildSparklinePath([1, 2, 3], 100, 50),
    "M0.00,50.00 L50.00,25.00 L100.00,0.00"
  );
  assert.equal(buildSparklinePath([1, Number.NaN], 100, 50), "");
});

test("CSV export filenames cannot escape into a path", () => {
  assert.equal(sanitizeCsvFileName("组合/2026:Q3.csv"), "组合-2026-Q3.csv");
  assert.equal(sanitizeCsvFileName("***"), "---");
});

test("sidecar resolve envelope maps instruments and outbound market hint", () => {
  const instrument = {
    id: "CN:600519",
    symbol: "600519",
    name: "贵州茅台",
    market: "CN",
    exchange: "SSE",
    assetType: "stock",
    currency: "CNY",
  };
  assert.deepEqual(
    mapStockResolveEnvelope({ status: "ok", instruments: [instrument] }),
    [instrument]
  );
  assert.deepEqual(
    toSidecarResolveRequest({ query: "600519", markets: ["CN"], limit: 3 }),
    {
      query: "600519",
      market: "CN",
      limit: 3,
    }
  );
});

test("AI stock tools normalize instruments and backtest fields to the sidecar wire contract", () => {
  const instrument = {
    canonicalId: "CN:600519",
    symbol: "600519",
    displayName: "贵州茅台",
    market: "CN",
    exchange: "SSE",
    assetType: "EQUITY",
    currency: "CNY",
  };
  const snapshot = toStockSidecarToolPayload("snapshot", {
    instrument,
    historyDays: 30,
  });
  assert.deepEqual(snapshot.instrument, {
    id: "CN:600519",
    symbol: "600519",
    name: "贵州茅台",
    market: "CN",
    exchange: "SSE",
    assetType: "stock",
    currency: "CNY",
  });
  assert.equal(snapshot.includeHistory, true);
  assert.equal(snapshot.includeProfile, true);
  assert.equal(snapshot.historyLimit, 30);
  const backtest = toStockSidecarToolPayload("backtest", {
    instrument,
    startDate: "2025-01-01",
    endDate: "2026-01-01",
    parameters: { shortWindow: 5, longWindow: 20, initialCash: 100_000 },
    feeRate: 0.001,
  });
  assert.equal(backtest.start, "2025-01-01");
  assert.equal(backtest.end, "2026-01-01");
  assert.deepEqual(backtest.strategy, {
    id: "sma-cross",
    shortWindow: 5,
    longWindow: 20,
  });
  assert.equal(backtest.initialCash, 100_000);
  assert.equal(backtest.feeRate, 0.001);
});

test("sidecar snapshot envelope maps quote and bounded history", () => {
  const instrument = {
    id: "CN:600519",
    symbol: "600519",
    name: "贵州茅台",
    market: "CN",
    exchange: "SSE",
    assetType: "stock",
    currency: "CNY",
  };
  const result = mapStockSnapshotResult({
    status: "ok",
    instrument,
    sources: [{ id: "tencent", name: "Tencent", provider: "tencent" }],
    asOf: "2026-07-15T07:00:00.000Z",
    retrievedAt: "2026-07-15T07:00:01.000Z",
    cached: false,
    warnings: [],
    data: {
      instrument,
      price: 1500,
      previousClose: 1490,
      change: 10,
      changePercent: 0.67,
      chart: {
        bars: [
          {
            time: "2026-07-14",
            open: 1490,
            high: 1510,
            low: 1480,
            close: 1500,
          },
        ],
      },
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data?.price, 1500);
  assert.equal(result.data?.chart?.[0]?.close, 1500);
  assert.deepEqual(
    toSidecarSnapshotRequest({ instrument, includeHistory: true }),
    {
      instrument,
      includeHistory: true,
      historyLimit: 120,
      includeProfile: true,
    }
  );
});

test("research, market brief, backtest and status tolerate sidecar raw shapes", () => {
  const instrument = {
    id: "CN:600519",
    symbol: "600519",
    name: "贵州茅台",
    market: "CN",
    exchange: "SSE",
    assetType: "stock",
    currency: "CNY",
  };
  const research = mapStockResearchResult({
    status: "partial",
    instrument,
    data: {
      facts: { snapshot: { instrument, price: 1500 }, historyBars: 30 },
      capabilities: {
        profile: { status: "ok", data: { industry: "白酒", employees: 3000 } },
        technical: { status: "ok", data: { trend: "bullish", rsi14: 64 } },
        financials: {
          status: "unavailable",
          data: null,
          warnings: ["no source"],
        },
      },
    },
    sources: [],
    asOf: "2026-07-15",
    retrievedAt: "2026-07-15T07:00:00.000Z",
    cached: false,
    warnings: ["financials: no source"],
  });
  assert.equal(research.data?.instrument.id, "CN:600519");
  assert.match(research.data?.facts[0] ?? "", /historyBars/);
  assert.ok(research.data?.facts.some((item) => item.startsWith("profile:")));
  assert.ok(research.data?.facts.some((item) => item.startsWith("technical:")));
  assert.ok(
    research.data?.risks.some((item) =>
      item.includes("financials: unavailable")
    )
  );
  assert.ok(
    research.data?.openQuestions.some((item) =>
      item.includes("financials: no source")
    )
  );
  assert.equal(research.data?.positiveCases.length, 0);
  const brief = mapStockMarketBriefResult({
    status: "partial",
    data: {
      market: "CN",
      sections: { sentiment: { score: 0.6 } },
      movers: [
        { symbol: "600519", name: "贵州茅台", price: 1500, changePercent: 2.5 },
      ],
    },
    sources: [],
    asOf: "2026-07-15",
    retrievedAt: "2026-07-15T07:00:00.000Z",
    cached: false,
    warnings: ["limitDown unavailable"],
  });
  assert.equal(brief.data?.highlights[0]?.title, "贵州茅台");
  const backtest = mapStockBacktestResult({
    status: "ok",
    data: {
      algorithm: {
        id: "calen.sma-cross",
        version: "1.0.0",
        parameters: { shortWindow: 5, longWindow: 20 },
      },
      sample: {
        start: "2025-01-01",
        end: "2026-01-01",
        bars: 240,
        coverage: 1,
      },
      benchmark: { name: "buy-and-hold", returnPercent: 8 },
      metrics: { returnPercent: 12, maxDrawdownPercent: 4 },
      trades: [
        {
          side: "buy",
          signalTime: "2025-02-01",
          executionTime: "2025-02-02",
          price: 100,
          quantity: 10,
          fee: 1,
        },
      ],
      limitations: ["research only"],
    },
    sources: [],
    asOf: "2026-01-01",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    cached: false,
    warnings: [],
  });
  assert.equal(backtest.data?.sample.points, 240);
  assert.equal(backtest.data?.trades[0]?.time, "2025-02-02");
  const status = mapStockServiceStatus({
    state: "unavailable",
    version: "0.1.0",
    providers: [
      {
        id: "eastmoney",
        available: false,
        capabilities: ["snapshot", "moneyFlow"],
        cooldownUntil: "2026-07-15T08:00:00Z",
      },
    ],
  });
  assert.equal(status.state, "failed");
  assert.equal(status.providers[0]?.state, "cooldown");
  const backtestRequest = toSidecarBacktestRequest({
    instrument,
    strategy: "sma-cross",
    from: "2025-01-01",
    to: "2026-01-01",
    parameters: { shortWindow: 5, longWindow: 20, feeRate: 0.001 },
  });
  assert.deepEqual(backtestRequest.strategy, {
    id: "sma-cross",
    shortWindow: 5,
    longWindow: 20,
  });
  assert.equal(backtestRequest.feeRate, 0.001);
});

test("Tauri adapter exposes only the agreed high-level commands", async () => {
  const source = await readFile(
    new URL("../../src/lib/stock-research/tauri.ts", import.meta.url),
    "utf8"
  );
  for (const command of [
    "stock_research_resolve",
    "stock_research_snapshot",
    "stock_research_run",
    "stock_research_market_brief",
    "stock_research_backtest",
    "stock_research_status",
    "stock_settings_get",
    "stock_settings_save",
    "stock_portfolio_read",
    "stock_portfolio_import_csv",
    "stock_portfolio_export_csv",
    "ui_stock_portfolio_export_encrypted_backup",
    "ui_stock_portfolio_restore_encrypted_backup",
  ])
    assert.match(source, new RegExp(`"${command}"`));
  assert.doesNotMatch(source, /http:\/\/|https:\/\//);
});

test("stock hub keeps the five product views", async () => {
  const source = await readFile(
    new URL("../../src/pages/stock-hub/StockHubPage.tsx", import.meta.url),
    "utf8"
  );
  const chartSource = await readFile(
    new URL("../../src/pages/stock-hub/StockChart.tsx", import.meta.url),
    "utf8"
  );
  for (const view of ["research", "market", "portfolio", "lab", "sources"]) {
    assert.match(source, new RegExp(`value: "${view}"`));
  }
  assert.match(source, /不构成投资建议/);
  assert.match(source, /已保存的 Key 永不回显/);
  assert.match(source, /autoComplete="new-password"/);
  assert.doesNotMatch(source, /value=\{provider\.key/);
  assert.match(source, /mode === "replaceAll"/);
  assert.match(source, /bars=\{data\.chart\}/);
  for (const capability of [
    "financials",
    "shareholders",
    "dividends",
    "capital_flow",
    "news",
    "notices",
    "evaluator",
  ]) {
    assert.match(source, new RegExp(`"${capability}"`));
  }
  assert.match(chartSource, /from "lightweight-charts"/);
  assert.match(chartSource, /CandlestickSeries/);
  assert.match(source, /setExportPassword\(""\)/);
  assert.match(source, /setRestorePassword\(""\)/);
  assert.doesNotMatch(
    source,
    /localStorage.*[Pp]assword|settings.*[Pp]assword/
  );
});
