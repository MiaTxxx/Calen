import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

import {
  buildSparklinePath,
  formatStockError,
  getStockServiceFailureMessage,
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
  summarizeStockServiceFailure,
  toSidecarBacktestRequest,
  toSidecarMarketBriefRequest,
  toSidecarResolveRequest,
  toSidecarSnapshotRequest,
  validateStockTimeoutDraft,
} from "../../src/lib/stock-research/contracts.ts";
import {
  isExplicitStockPortfolioRequest,
  isStockPortfolioReadAuthorized,
} from "../../src/lib/tools/stockPortfolioAuthorization.ts";
import { toStockSidecarToolPayload } from "../../src/lib/tools/stockToolContracts.ts";

const loader = createTsModuleLoader();
const { createStockResearchTools } = loader.loadModule(
  "src/lib/tools/stockResearchTools.ts"
);

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
  assert.equal(isExplicitStockPortfolioRequest("分析持仓风险"), false);
  assert.equal(isExplicitStockPortfolioRequest("请分析投资组合理论"), false);
  assert.equal(
    isExplicitStockPortfolioRequest("分析贵州茅台的机构持仓"),
    false
  );
  assert.equal(isExplicitStockPortfolioRequest("分析该公司的机构持仓"), false);
  assert.equal(
    isExplicitStockPortfolioRequest(
      "Review this company's institutional holdings"
    ),
    false
  );
  assert.equal(isExplicitStockPortfolioRequest("分析这个组合的风险"), true);
  assert.equal(isExplicitStockPortfolioRequest("分析我当前的持仓风险"), true);
  assert.equal(isExplicitStockPortfolioRequest("查看本地交易流水"), true);
});

test("gateway-originated turns can never authorize local portfolio reads", () => {
  const remoteAuthorized = isStockPortfolioReadAuthorized({
    latestUserText: "请分析我的持仓风险和行业暴露",
    origin: "gateway",
  });
  assert.equal(remoteAuthorized, false);
  const remoteTools = createStockResearchTools({
    runtimeScope: "chat",
    portfolioReadAuthorized: remoteAuthorized,
  }).tools;
  assert.equal(
    remoteTools.some((tool) => tool.name === "StockPortfolioRead"),
    false
  );
  assert.equal(
    isStockPortfolioReadAuthorized({
      latestUserText: "请分析我的持仓风险和行业暴露",
      origin: "local",
    }),
    true
  );
});

test("local portfolio turns activate Gateway privacy before persistence", async () => {
  const source = await readFile(
    new URL("../../src/pages/ChatPage.tsx", import.meta.url),
    "utf8"
  );
  const privacyActivation = source.indexOf(
    "gatewayBridgeEvents.activateStockPortfolioPrivacy();"
  );
  const titleJob = source.indexOf("startConversationTitleJob({");
  const initialPersist = source.indexOf(
    "const initialPersist = persistConversationWithHistorySync({"
  );

  assert.match(
    source,
    /const privateStockPortfolioRequest = isStockPortfolioReadAuthorized\([\s\S]*?const pendingUserMessage = privateStockPortfolioRequest[\s\S]*?markStockPortfolioPrivateUserMessage\(userMessage\)/
  );
  assert.ok(privacyActivation >= 0);
  assert.ok(titleJob > privacyActivation);
  assert.ok(initialPersist > privacyActivation);
  assert.match(source, /if \(isFirstTurn && !privateStockPortfolioRequest\)/);
  assert.match(
    source,
    /privateStockPortfolioRequest && isFirstTurn[\s\S]*?STOCK_PORTFOLIO_PRIVATE_TITLE/
  );
  assert.match(
    source,
    /buildGatewayRuntimeSnapshotToolStatus\(\{[\s\S]*?userMessage: run\.userMessage,[\s\S]*?liveTranscript/
  );
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

test("sidecar resolve envelope preserves evidence and outbound market hint", () => {
  const instrument = {
    id: "CN:600519",
    symbol: "600519",
    name: "贵州茅台",
    market: "CN",
    exchange: "SSE",
    assetType: "stock",
    currency: "CNY",
  };
  const source = {
    id: "eastmoney:resolve",
    name: "东方财富",
    provider: "eastmoney",
    capability: "resolve",
    asOf: "2026-07-16T01:00:00.000Z",
    retrievedAt: "2026-07-16T01:00:01.000Z",
    cached: true,
  };
  assert.deepEqual(
    mapStockResolveEnvelope({
      status: "partial",
      instruments: [instrument],
      sources: [source],
      asOf: "2026-07-16T01:00:00.000Z",
      retrievedAt: "2026-07-16T01:00:01.000Z",
      cached: true,
      warnings: ["备用数据源限流"],
    }),
    {
      status: "partial",
      instruments: [instrument],
      sources: [source],
      asOf: "2026-07-16T01:00:00.000Z",
      retrievedAt: "2026-07-16T01:00:01.000Z",
      cached: true,
      warnings: ["备用数据源限流"],
    }
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
    evaluationRatio: 0.4,
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
  assert.equal(backtest.evaluationRatio, 0.4);
  const fused = toStockSidecarToolPayload("backtest", {
    instrument,
    strategy: "fused",
    startDate: "2025-01-01",
    endDate: "2026-01-01",
  });
  assert.deepEqual(fused.strategy, { id: "fused" });
});

test("StockSnapshot historyDays matches the sidecar 120-day boundary", () => {
  const snapshotTool = createStockResearchTools({
    runtimeScope: "chat",
  }).tools.find((tool) => tool.name === "StockSnapshot");
  assert.ok(snapshotTool);
  assert.equal(snapshotTool.parameters.properties.historyDays.maximum, 120);

  const instrument = {
    canonicalId: "CN:600519",
    symbol: "600519",
    displayName: "贵州茅台",
    market: "CN",
  };
  assert.equal(
    toStockSidecarToolPayload("snapshot", {
      instrument,
      historyDays: 120,
    }).historyLimit,
    120
  );
  assert.equal(
    toStockSidecarToolPayload("snapshot", {
      instrument,
      historyDays: 121,
    }).historyLimit,
    120
  );
  const disabledHistory = toStockSidecarToolPayload("snapshot", {
    instrument,
    historyDays: -1,
  });
  assert.equal(disabledHistory.includeHistory, false);
  assert.equal(disabledHistory.historyLimit, 1);
});

test("stock timeout validation rejects invalid drafts without replacing them", () => {
  for (const draft of ["", "NaN", "Infinity", "-1", "999", "120001"]) {
    const result = validateStockTimeoutDraft(draft);
    assert.equal(result.ok, false, `expected ${JSON.stringify(draft)} to fail`);
    assert.equal(result.draft, draft);
    assert.ok(result.error);
  }

  assert.deepEqual(validateStockTimeoutDraft("1000"), {
    ok: true,
    draft: "1000",
    value: 1000,
  });
  assert.deepEqual(validateStockTimeoutDraft("120000"), {
    ok: true,
    draft: "120000",
    value: 120000,
  });
});

test("stock failure summaries remove stderr, paths, and stack frames", () => {
  const summary = summarizeStockServiceFailure(
    "sidecar launch failed at /opt/Calen/stock-sidecar/dist/stdio.mjs\nstderr: node: not found\n    at launch (node:child_process:1:1)"
  );

  assert.equal(summary, "sidecar launch failed at [路径见运行诊断]");
  assert.doesNotMatch(summary, /stderr|stdio\.mjs|at launch/i);
});

test("market brief requests preserve session, trade date, and selected sections", () => {
  assert.deepEqual(
    toSidecarMarketBriefRequest({
      market: "CN",
      session: "pre_open",
      tradeDate: "2026-07-15",
      sections: ["movers", "hotSectors", "dragonTiger"],
      limit: 8,
    }),
    {
      market: "CN",
      session: "pre_market",
      tradeDate: "2026-07-15",
      sections: ["movers", "hotSectors", "dragonTiger"],
      limit: 8,
    }
  );

  assert.deepEqual(
    toStockSidecarToolPayload("marketBrief", {
      session: "preMarket",
      tradeDate: "2026-07-15",
      sections: ["limitUp", "sentiment"],
      deadlineMs: 30_000,
    }),
    {
      market: "CN",
      session: "pre_market",
      tradeDate: "2026-07-15",
      sections: ["limitUp", "sentiment"],
      deadlineMs: 30_000,
    }
  );
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
      historyPeriod: "day",
      includeProfile: true,
    }
  );
  assert.deepEqual(
    toSidecarSnapshotRequest({
      instrument,
      includeHistory: true,
      historyPeriod: "minute",
    }),
    {
      instrument,
      includeHistory: true,
      historyLimit: 360,
      historyPeriod: "minute",
      includeProfile: true,
    }
  );
});

test("unknown source freshness is not replaced by a newer quote timestamp", () => {
  const result = mapStockSnapshotResult({
    status: "partial",
    asOf: "2026-07-15T07:00:00.000Z",
    retrievedAt: "2026-07-15T07:00:01.000Z",
    sources: [
      {
        id: "tencent:quote",
        name: "Tencent",
        asOf: "2026-07-15T07:00:00.000Z",
      },
      {
        id: "tencent:profile",
        name: "Tencent profile",
        asOf: "unknown",
      },
    ],
    warnings: [],
    data: { instrument: null, price: 1500 },
  });
  assert.equal(result.asOf, "unknown");
  assert.equal(result.sources[1]?.asOf, "unknown");
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
        score: {
          status: "ok",
          data: {
            value: 80,
            algorithm: { id: "calen.technical-score", version: "1.0.0" },
          },
        },
        strategy: {
          status: "partial",
          data: { bias: "bullish", action: "research-only" },
          warnings: ["仅覆盖当前样本"],
        },
        evaluator: {
          status: "ok",
          data: { id: "calen.rule-evaluator", rating: "positive" },
        },
        financials: {
          status: "unavailable",
          data: null,
          warnings: ["no source"],
        },
      },
      analysisMetadata: {
        algorithm: {
          id: "calen.research-analytics",
          version: "1.0.0",
          parameters: { smaWindows: [5, 20], rsiPeriod: 14 },
        },
        sample: {
          start: "2026-06-01",
          end: "2026-06-30",
          bars: 30,
          coverage: 1,
        },
        benchmark: { name: "buy-and-hold", returnPercent: 12.5 },
        limitations: ["实验性量化研究结果，不构成投资建议。"],
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
  assert.equal(
    research.data?.facts.some((item) => item.startsWith("technical:")),
    false
  );
  assert.deepEqual(
    research.data?.experimentalAnalysis.map((item) => item.capability),
    ["technical", "score", "strategy", "evaluator"]
  );
  assert.equal(research.data?.experimentalAnalysis[2]?.status, "partial");
  assert.deepEqual(research.data?.experimentalAnalysis[0]?.data, {
    trend: "bullish",
    rsi14: 64,
  });
  assert.deepEqual(research.data?.experimentalAnalysis[2]?.warnings, [
    "仅覆盖当前样本",
  ]);
  assert.deepEqual(research.data?.analysisMetadata, {
    algorithm: {
      id: "calen.research-analytics",
      version: "1.0.0",
      parameters: { smaWindows: [5, 20], rsiPeriod: 14 },
    },
    sample: {
      start: "2026-06-01",
      end: "2026-06-30",
      bars: 30,
      coverage: 1,
    },
    benchmark: { name: "buy-and-hold", returnPercent: 12.5 },
    limitations: ["实验性量化研究结果，不构成投资建议。"],
  });
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
  const researchWithoutMetadata = mapStockResearchResult({
    status: "ok",
    instrument,
    data: {
      capabilities: {},
      analysisMetadata: { algorithm: { id: "partial-only" } },
    },
    sources: [],
    asOf: "2026-07-15",
    retrievedAt: "2026-07-15T07:00:00.000Z",
    cached: false,
    warnings: [],
  });
  assert.equal(researchWithoutMetadata.data?.analysisMetadata, undefined);
  const brief = mapStockMarketBriefResult({
    status: "partial",
    data: {
      market: "CN",
      session: "pre_market",
      tradeDate: "2026-07-15",
      requestedSections: ["movers", "sentiment"],
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
  assert.equal(brief.data?.generatedFor, "pre_open");
  assert.equal(brief.data?.tradeDate, "2026-07-15");
  assert.deepEqual(brief.data?.requestedSections, ["movers", "sentiment"]);
  assert.equal(brief.data?.sections[0]?.key, "movers");
  assert.equal(brief.data?.sections[0]?.items[0]?.title, "贵州茅台");
  assert.equal(brief.data?.sections.at(-1)?.key, "sentiment");
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
        calibration: {
          start: "2025-01-01",
          end: "2025-10-01",
          bars: 180,
          coverage: 1,
        },
        evaluation: {
          start: "2025-10-02",
          end: "2026-01-01",
          bars: 60,
          coverage: 1,
        },
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
      equityCurve: [
        { time: "2025-10-02", equity: 100000 },
        { time: "2026-01-01", equity: 112000 },
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
  assert.equal(backtest.data?.sample.calibration.points, 180);
  assert.equal(backtest.data?.sample.evaluation.points, 60);
  assert.equal(backtest.data?.trades[0]?.signalTime, "2025-02-01");
  assert.equal(backtest.data?.trades[0]?.executionTime, "2025-02-02");
  assert.equal(backtest.data?.trades[0]?.fee, 1);
  assert.deepEqual(backtest.data?.equityCurve, [
    { time: "2025-10-02", equity: 100000 },
    { time: "2026-01-01", equity: 112000 },
  ]);
  const status = mapStockServiceStatus({
    state: "unavailable",
    version: "0.1.0",
    providers: [
      {
        id: "eastmoney",
        available: false,
        capabilities: ["snapshot", "moneyFlow"],
        cooldownUntil: "2026-07-15T08:00:00Z",
        lastSuccessAt: "2026-07-15T07:00:00Z",
      },
      {
        id: "baostock",
        state: "disabled",
        available: false,
        capabilities: [],
      },
    ],
  });
  assert.equal(status.state, "failed");
  assert.equal(status.providers[0]?.state, "cooldown");
  assert.equal(status.providers[0]?.lastSuccessAt, "2026-07-15T07:00:00Z");
  assert.equal(status.providers[1]?.state, "disabled");
  const backtestRequest = toSidecarBacktestRequest({
    instrument,
    strategy: "sma-cross",
    from: "2025-01-01",
    to: "2026-01-01",
    parameters: { shortWindow: 5, longWindow: 20, feeRate: 0.001 },
    evaluationRatio: 0.4,
  });
  assert.deepEqual(backtestRequest.strategy, {
    id: "sma-cross",
    shortWindow: 5,
    longWindow: 20,
  });
  assert.equal(backtestRequest.feeRate, 0.001);
  assert.equal(backtestRequest.evaluationRatio, 0.4);

  const unavailableBacktest = mapStockBacktestResult({
    status: "unavailable",
    data: {
      algorithm: { id: "calen.sma-cross", version: "2.0.0", parameters: {} },
      metrics: { returnPercent: 0, finalEquity: 0 },
      benchmark: { name: "buy-and-hold", returnPercent: 0 },
      sample: { start: "", end: "", bars: 0, coverage: 0 },
      equityCurve: [],
    },
    warnings: ["coverage unavailable"],
  });
  assert.equal(unavailableBacktest.status, "unavailable");
  assert.equal(unavailableBacktest.data, null);
});

test("Tauri adapter exposes only the agreed high-level commands", async () => {
  const source = await readFile(
    new URL("../../src/lib/stock-research/tauri.ts", import.meta.url),
    "utf8"
  );
  const backendSource = await readFile(
    new URL(
      "../../src-tauri/src/commands/integration/stock.rs",
      import.meta.url
    ),
    "utf8"
  );
  for (const command of [
    "stock_research_resolve",
    "stock_research_snapshot",
    "stock_research_run",
    "stock_research_market_brief",
    "stock_research_backtest",
    "stock_research_status",
    "stock_restart",
    "stock_settings_get",
    "stock_settings_save",
    "stock_portfolio_read",
    "stock_portfolio_import_csv",
    "stock_portfolio_export_csv",
    "ui_stock_portfolio_export_encrypted_backup",
    "ui_stock_portfolio_restore_encrypted_backup",
  ])
    assert.match(source, new RegExp(`"${command}"`));
  assert.match(
    backendSource,
    /pub async fn stock_market_brief[\s\S]*?invoke_stock_method\(app, state, "marketBrief", payload\)/
  );
  assert.match(
    backendSource,
    /pub async fn stock_research_market_brief[\s\S]*?invoke_stock_method\(app, state, "marketBrief", request\)/
  );
  assert.doesNotMatch(source, /http:\/\/|https:\/\//);
});

test("stock service status keeps safe runtime failure diagnostics", () => {
  const status = mapStockServiceStatus({
    state: "failed",
    message: "股票 sidecar 连续失败，已暂停自动重启",
    providers: [],
    runtime: {
      available: true,
      running: false,
      disabledAfterFailures: true,
      consecutiveFailures: 2,
      sidecarRoot: "D:\\Calen\\stock-sidecar",
      stderrTail: ["provider key=[REDACTED]", "node exited"],
      lastFailure: {
        stage: "write",
        occurredAt: "2026-07-17T08:00:00.000Z",
        processId: 4242,
        exitCode: 1,
        firstError: "管道正在被关闭。(os error 232)",
        restartError: "重启后的 sidecar 也提前退出",
        stderrTail: ["node exited"],
        sidecarRoot: "D:\\Calen\\stock-sidecar",
      },
    },
  });

  assert.equal(status.runtime?.failure?.stage, "write");
  assert.equal(status.runtime?.failure?.processId, 4242);
  assert.equal(status.runtime?.failure?.exitCode, 1);
  assert.equal(
    status.runtime?.failure?.firstError,
    "管道正在被关闭。(os error 232)"
  );
  assert.equal(
    status.runtime?.failure?.restartError,
    "重启后的 sidecar 也提前退出"
  );
  assert.deepEqual(status.runtime?.failure?.stderrTail, ["node exited"]);
  assert.equal(status.runtime?.consecutiveFailures, 2);
  assert.equal(status.runtime?.disabledAfterFailures, true);
});

test("stock service failure message keeps raw diagnostics out of the summary", () => {
  assert.equal(
    getStockServiceFailureMessage({
      state: "failed",
      message: "股票 sidecar 连续失败，已暂停自动重启",
      providers: [],
      runtime: {
        running: false,
        stderrTail: [],
        failure: {
          stage: "unexpected-exit",
          exitCode: 1,
          firstError:
            "首次启动时管道关闭\n    at writeFrame (node:internal/streams:1:1)",
          restartError:
            "自动重启后进程退出：EISDIR lstat 'D:\\Calen\\stock-sidecar\\dist\\stdio.mjs'\nstderr: provider key leaked\n    at lstat (node:fs:1:1)",
          stderrTail: ["provider key leaked"],
          sidecarRoot: "D:\\Calen\\stock-sidecar",
        },
      },
    }),
    "阶段：unexpected-exit · 退出码：1 · 自动重启后进程退出：EISDIR lstat '[路径见运行诊断]'"
  );
});

test("recovered stock service keeps historical failures in diagnostics only", () => {
  assert.equal(
    getStockServiceFailureMessage({
      state: "ready",
      providers: [],
      runtime: {
        running: true,
        stderrTail: [],
        failure: {
          stage: "write",
          firstError: "historical pipe failure",
          stderrTail: [],
        },
      },
    }),
    undefined
  );
});

test("Tauri adapter preserves a live degraded status after restart", () => {
  const calls = [];
  const adapterLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          return {
            state: "degraded",
            version: "1.1.0",
            providers: [],
            runtime: { running: true, consecutiveFailures: 0 },
          };
        },
      },
    },
  });
  const { TauriStockResearchAdapter } = adapterLoader.loadModule(
    "src/lib/stock-research/tauri.ts"
  );

  return new TauriStockResearchAdapter().restart().then((status) => {
    assert.deepEqual(calls, [{ command: "stock_restart", args: undefined }]);
    assert.equal(status.state, "degraded");
    assert.equal(status.runtime?.running, true);
  });
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
  const portfolioSource = await readFile(
    new URL(
      "../../src/pages/stock-hub/PortfolioWorkspace.tsx",
      import.meta.url
    ),
    "utf8"
  );
  const stockToolSource = await readFile(
    new URL("../../src/lib/tools/stockResearchTools.ts", import.meta.url),
    "utf8"
  );
  for (const view of ["research", "market", "portfolio", "lab", "sources"]) {
    assert.match(source, new RegExp(`value: "${view}"`));
  }
  assert.match(source, /不构成投资建议/);
  assert.match(source, /已保存的 Key 永不回显/);
  assert.match(source, /重启股票服务/);
  assert.match(source, /stockResearch\.restart\(\)/);
  assert.match(source, /next\.runtime\?\.running !== true/);
  assert.match(source, /股票服务部分可用/);
  assert.match(source, /resource\.data\.runtime\?\.running === true/);
  assert.match(source, /正在重启股票服务/);
  assert.match(source, /重启失败/);
  assert.match(source, /运行诊断/);
  assert.match(source, /首次错误/);
  assert.match(source, /重启错误/);
  assert.match(source, /stderr/);
  assert.match(source, /value=\{timeoutDraft\}/);
  assert.match(source, /aria-invalid=\{Boolean\(timeoutError\)\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /validateStockTimeoutDraft\(timeoutDraft\)/);
  assert.doesNotMatch(
    source,
    /const generalMessage = status\?\.message;[\s\S]*?服务状态：\{generalMessage\}/
  );
  assert.match(portfolioSource, /autoComplete="new-password"/);
  assert.doesNotMatch(source, /value=\{provider\.key/);
  assert.match(portfolioSource, /mode === "replaceAll"/);
  assert.match(source, /bars=\{data\.chart\}/);
  assert.match(source, /<EvidenceHeader result=\{matches\.data\}/);
  assert.match(source, /matches\.data\.instruments\.map/);
  assert.match(source, /实验性量化分析/);
  assert.match(source, /data\.analysisMetadata/);
  assert.match(source, /data\.experimentalAnalysis\.map/);
  assert.match(source, /MarketBriefSections/);
  assert.match(source, /StockCapabilityMatrix/);
  assert.match(source, /runAnalysis/);
  assert.match(
    source,
    /capabilities: \["history", "technical", "score", "strategy", "evaluator"\]/
  );
  assert.match(source, /原始实验数据/);
  assert.match(source, /evidenceItems\(root\.periods\)\.slice\(0, 4\)/);
  assert.match(source, /报告期覆盖/);
  assert.match(source, /financialPeriodDetail\(period\)/);
  assert.match(source, /算法与版本/);
  assert.match(source, /样本覆盖率/);
  assert.match(source, /样本外评估比例/);
  assert.match(source, /data\.sample\.calibration/);
  assert.match(source, /data\.sample\.evaluation/);
  assert.match(source, /trade\.signalTime/);
  assert.match(source, /trade\.executionTime/);
  assert.match(source, /trade\.fee/);
  assert.match(source, /data\.equityCurve\.map/);
  assert.match(source, /BacktestTrades/);
  assert.match(source, /基准/);
  assert.match(source, /限制说明/);
  assert.match(source, /calen-stock-pre-open/);
  assert.match(source, /calen-stock-close-review/);
  assert.match(source, /cron: "0 30 8 \* \* 1-5"/);
  assert.match(source, /cron: "0 30 15 \* \* 1-5"/);
  assert.match(source, /applyCronOps/);
  for (const strategy of [
    "fused",
    "trend",
    "mean-reversion",
    "breakout",
    "momentum",
    "volume-price",
    "sma-cross",
  ]) {
    assert.match(source, new RegExp(`value="${strategy}"`));
  }
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
  assert.match(chartSource, /LineSeries/);
  assert.match(chartSource, /TimeSeriesChart/);
  assert.match(portfolioSource, /setExportPassword\(""\)/);
  assert.match(portfolioSource, /setRestorePassword\(""\)/);
  assert.doesNotMatch(
    portfolioSource,
    /localStorage.*[Pp]assword|settings.*[Pp]assword/
  );
  assert.match(
    stockToolSource,
    /name: "StockResearch"[\s\S]*?scopes: \["chat", "cron_auto_prompt"\],[\s\S]*?name: "StockMarketBrief"/
  );
  assert.match(
    stockToolSource,
    /definition\.experimental === true \|\|\s*\(definition\.operation !== "research" && evidence\.experimental === true\)/
  );
  const researchDefinition = stockToolSource.match(
    /name: "StockResearch"[\s\S]*?name: "StockMarketBrief"/
  )?.[0];
  assert.ok(researchDefinition);
  assert.doesNotMatch(researchDefinition, /experimental:\s*true/);
  assert.match(stockToolSource, /experimentalCapabilities/);
  assert.match(stockToolSource, /enrichPortfolioSnapshot/);
  assert.match(stockToolSource, /stock_snapshot/);
  assert.match(stockToolSource, /stock_research_fx_rates/);
  assert.doesNotMatch(stockToolSource, /未加载受控行情或汇率/);
});
