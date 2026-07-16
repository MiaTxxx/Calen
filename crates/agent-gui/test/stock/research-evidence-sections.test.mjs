import assert from "node:assert/strict";
import test from "node:test";

import {
  mapStockResearchResult,
  toSidecarResearchRequest,
} from "../../src/lib/stock-research/contracts.ts";

test("research mapping preserves structured financial and notice evidence for the Hub", () => {
  const mapped = mapStockResearchResult({
    status: "partial",
    instrument: {
      id: "CN:600519",
      symbol: "600519",
      name: "贵州茅台",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
    },
    data: {
      capabilities: {
        financials: {
          status: "ok",
          data: { statements: { income: { netProfit: 90_000_000_000 } } },
          warnings: [],
        },
        notices: {
          status: "partial",
          data: {
            items: [
              {
                title: "年度报告",
                pdfUrl: "https://example.com/report.pdf",
                content: "公告正文",
              },
            ],
          },
          warnings: ["附件正文仅提取前 100000 字符"],
        },
      },
    },
    sources: [],
    asOf: "2026-07-15",
    retrievedAt: "2026-07-15T10:00:00Z",
    cached: false,
    warnings: [],
  });

  assert.equal(mapped.data?.evidenceSections.length, 2);
  assert.deepEqual(mapped.data?.evidenceSections[0], {
    capability: "financials",
    status: "ok",
    data: { statements: { income: { netProfit: 90_000_000_000 } } },
    warnings: [],
  });
  assert.equal(mapped.data?.evidenceSections[1]?.capability, "notices");
  assert.equal(mapped.data?.evidenceSections[1]?.status, "partial");
});

test("research request preserves the selected quant strategy registry subset", () => {
  const request = toSidecarResearchRequest({
    instrument: {
      id: "CN:600519",
      symbol: "600519",
      name: "贵州茅台",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
    },
    capabilities: ["technical", "strategy", "evaluator"],
    strategyIds: ["trend", "breakout", "volume-price"],
  });
  assert.deepEqual(request.strategyIds, ["trend", "breakout", "volume-price"]);
});

test("research mapping keeps bounded multi-period financial coverage", () => {
  const mapped = mapStockResearchResult({
    status: "ok",
    instrument: {
      id: "CN:600519",
      symbol: "600519",
      name: "璐靛窞鑼呭彴",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
    },
    data: {
      capabilities: {
        financials: {
          status: "ok",
          data: {
            reportDate: "2025-12-31",
            currency: "CNY",
            statements: {
              income: { netProfit: 100 },
              balance: null,
              cashFlow: null,
            },
            periods: [
              {
                reportDate: "2025-12-31",
                income: { netProfit: 100 },
                balance: null,
                cashFlow: null,
              },
              {
                reportDate: "2025-09-30",
                income: { netProfit: 99 },
                balance: null,
                cashFlow: null,
              },
            ],
            coverage: {
              requestedPeriods: 4,
              returnedPeriods: 2,
              completePeriods: 0,
              oldestReportDate: "2025-09-30",
              newestReportDate: "2025-12-31",
            },
            missingStatements: ["balance", "cashFlow"],
          },
          warnings: [],
        },
      },
    },
    sources: [],
    asOf: "2025-12-31",
    retrievedAt: "2026-07-16T00:00:00Z",
    cached: false,
    warnings: [],
  });

  const financials = mapped.data?.evidenceSections[0]?.data;
  assert.equal(financials.periods.length, 2);
  assert.equal(financials.periods[1].reportDate, "2025-09-30");
  assert.equal(financials.coverage.requestedPeriods, 4);
});
