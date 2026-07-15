import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";

const instrument = makeInstrument(
  "CN",
  "600519",
  "SSE",
  "EQUITY",
  "CNY",
  "贵州茅台"
);

test("Eastmoney research normalizes profile, three statements, money flow, news, and notices", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CompanySurvey/PageAjax")) {
      return Response.json({
        jbzl: [
          {
            SECURITY_CODE: "600519",
            SECURITY_NAME_ABBR: "贵州茅台",
            ORG_NAME: "贵州茅台酒股份有限公司",
            EM2016: "白酒",
            ORG_PROFILE: "白酒生产企业",
            ORG_WEB: "https://www.moutaichina.com",
            LISTING_DATE: "2001-08-27",
          },
        ],
      });
    }
    if (url.hostname.includes("datacenter")) {
      const reportName = url.searchParams.get("reportName");
      const rows: Record<string, unknown> = {
        SECURITY_CODE: "600519",
        REPORT_DATE: "2025-12-31",
      };
      if (reportName === "RPT_DMSK_FN_INCOME")
        Object.assign(rows, {
          TOTAL_OPERATE_INCOME: 180000000000,
          NETPROFIT: 90000000000,
        });
      if (reportName === "RPT_DMSK_FN_BALANCE")
        Object.assign(rows, {
          TOTAL_ASSETS: 320000000000,
          TOTAL_LIABILITIES: 48000000000,
        });
      if (reportName === "RPT_DMSK_FN_CASHFLOW")
        Object.assign(rows, {
          NETCASH_OPERATE: 95000000000,
          NETCASH_INVEST: -12000000000,
        });
      if (reportName === "RPT_F10_EH_FREEHOLDERS")
        Object.assign(rows, {
          END_DATE: "2026-03-31",
          HOLDER_NAME: "中国证券金融股份有限公司",
          HOLD_NUM: 8000000,
          HOLD_RATIO: 0.64,
          HOLDER_RANK: 1,
          HOLDER_TYPE: "机构",
        });
      if (reportName === "RPT_SHAREBONUS_DET")
        Object.assign(rows, {
          REPORT_DATE: "2025-12-31",
          PLAN_NOTICE_DATE: "2026-04-01",
          EX_DIVIDEND_DATE: "2026-06-20",
          PRETAX_BONUS_RMB: 30.876,
          TOTAL_SHARES: 1252270215,
          ASSIGN_PROGRESS: "实施方案",
        });
      const data =
        reportName === "RPT_F10_EH_FREEHOLDERS"
          ? Array.from({ length: 10 }, (_, index) => ({
              ...rows,
              HOLDER_RANK: index + 1,
              HOLDER_NAME: index === 0 ? rows.HOLDER_NAME : `股东${index + 1}`,
            }))
          : [rows];
      return Response.json({ result: { data } });
    }
    if (url.pathname.includes("/fflow/daykline/get")) {
      return Response.json({
        data: { klines: ["2026-07-15,100,40,20,10,30,10,5,2,3,1,0.5,0.2"] },
      });
    }
    if (url.hostname === "np-anotice-stock.eastmoney.com") {
      return Response.json({
        data: {
          list: [
            {
              title: "年度报告",
              notice_date: "2026-04-01",
              art_code: "AN202604010001",
              display_time: "2026-04-01 08:00:00",
            },
          ],
        },
      });
    }
    if (
      url.hostname === "data.eastmoney.com" &&
      url.pathname.includes("/notices/detail/")
    ) {
      return new Response(
        `<html><article>${"年度报告正文内容。".repeat(20)}</article></html>`
      );
    }
    if (url.hostname === "search-api-web.eastmoney.com") {
      const payload = {
        result: {
          cmsArticleWebOld: [
            {
              title: "贵州茅台发布经营数据",
              date: "2026-07-15 09:00:00",
              url: "https://finance.eastmoney.com/a/1.html",
              content: "公司披露主要经营数据。",
            },
          ],
        },
      };
      return new Response(`callback(${JSON.stringify(payload)})`);
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const service = createStockResearchService({
    fetch: fetchMock,
    now: () => new Date("2026-07-15T10:00:00.000Z"),
  });

  const result = await service.research({
    instrument,
    capabilities: [
      "profile",
      "financials",
      "shareholders",
      "dividend",
      "moneyFlow",
      "news",
      "notices",
    ],
  });
  const sections = (
    result.data as {
      capabilities: Record<string, { status: string; data: any }>;
    }
  ).capabilities;

  assert.equal(result.status, "partial");
  assert.equal(sections.profile!.status, "ok");
  assert.equal(sections.profile!.data.industry, "白酒");
  assert.equal(sections.financials!.status, "ok");
  assert.equal(
    sections.financials!.data.statements.income.netProfit,
    90000000000
  );
  assert.equal(
    sections.financials!.data.statements.balance.totalAssets,
    320000000000
  );
  assert.equal(
    sections.financials!.data.statements.cashFlow.operatingCashFlow,
    95000000000
  );
  assert.equal(sections.moneyFlow!.data.series[0].mainNetInflow, 100);
  assert.equal(sections.shareholders!.status, "ok");
  assert.equal(
    sections.shareholders!.data.topHolders[0].name,
    "中国证券金融股份有限公司"
  );
  assert.equal(sections.dividend!.status, "ok");
  assert.equal(
    sections.dividend!.data.history[0].cashDividendPer10Shares,
    30.876
  );
  assert.equal(
    sections.news!.data.items[0].url,
    "https://finance.eastmoney.com/a/1.html"
  );
  assert.equal(sections.notices!.status, "partial");
  assert.match(sections.notices!.data.items[0].pdfUrl, /AN202604010001/);
  assert.match(sections.notices!.data.items[0].content, /年度报告正文内容/);
  assert.equal(sections.notices!.data.items[0].contentStatus, "html-extracted");
  assert.match(result.warnings.join("\n"), /PDF 文本抽取尚不可用/);
});

test("financials preserve successful statements when one Eastmoney statement endpoint fails", async () => {
  const service = createStockResearchService({
    fetch: async (input) => {
      const url = new URL(String(input));
      const reportName = url.searchParams.get("reportName");
      if (reportName === "RPT_DMSK_FN_BALANCE")
        return new Response("failed", { status: 503 });
      if (reportName === "RPT_DMSK_FN_INCOME")
        return Response.json({
          result: { data: [{ REPORT_DATE: "2025-12-31", NETPROFIT: 10 }] },
        });
      if (reportName === "RPT_DMSK_FN_CASHFLOW")
        return Response.json({
          result: {
            data: [{ REPORT_DATE: "2025-12-31", NETCASH_OPERATE: 12 }],
          },
        });
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  const result = await service.research({
    instrument,
    capabilities: ["financials"],
  });
  const section = (
    result.data as {
      capabilities: Record<string, { status: string; data: any }>;
    }
  ).capabilities.financials!;
  assert.equal(result.status, "partial");
  assert.equal(section.status, "partial");
  assert.equal(section.data.statements.income.netProfit, 10);
  assert.equal(section.data.statements.balance, null);
  assert.equal(section.data.statements.cashFlow.operatingCashFlow, 12);
});
