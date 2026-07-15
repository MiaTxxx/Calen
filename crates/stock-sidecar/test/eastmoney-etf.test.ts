import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

const etf = makeInstrument("CN", "510300", "SSE", "ETF", "CNY", "沪深300ETF");

test("Eastmoney ETF research combines profile, NAV, and holdings without overstating missing sections", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("jbgk_510300.html")) {
      return new Response(
        "<table><tr><th>基金全称</th><td>华泰柏瑞沪深300交易型开放式指数证券投资基金</td></tr><tr><th>基金管理人</th><td>华泰柏瑞基金</td></tr><tr><th>跟踪标的</th><td>沪深300指数</td></tr></table>"
      );
    }
    if (url.pathname.endsWith("/f10/lsjz")) {
      return Response.json({
        Data: {
          LSJZList: [
            {
              FSRQ: "2026-07-15",
              DWJZ: "4.1234",
              LJJZ: "4.1234",
              JZZZL: "0.56",
            },
          ],
        },
      });
    }
    if (url.pathname.endsWith("/FundArchivesDatas.aspx")) {
      const html =
        "<table><tr><td>1</td><td>600519</td><td>贵州茅台</td><td>5.25%</td><td>100.00</td><td>150000.00</td></tr></table>";
      return new Response(`var apidata=${JSON.stringify({ content: html })};`);
    }
    if (url.pathname.endsWith("/api/qt/stock/get")) {
      return Response.json({
        data: {
          f43: 4.2,
          f57: "510300",
          f58: "沪深300ETF",
          f60: 4.1,
          f86: "20260716093000",
        },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const service = createStockResearchService({
    fetch: fetchMock,
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });

  const result = await service.research({
    instrument: etf,
    capabilities: ["etf"],
  });
  const section = (
    result.data as {
      capabilities: Record<string, { status: string; data: any }>;
    }
  ).capabilities.etf!;

  assert.equal(result.status, "ok");
  assert.equal(section.status, "ok");
  assert.equal(section.data.profile.manager, "华泰柏瑞基金");
  assert.equal(section.data.nav[0].nav, 4.1234);
  assert.equal(section.data.holdings[0].symbol, "600519");
  assert.equal(section.data.holdings[0].weightPercent, 5.25);
  assert.equal(section.data.holdings[0].shares, 1000000);
  assert.equal(section.data.holdings[0].marketValueCny, 1500000000);
  assert.equal(section.data.marketPrice, 4.2);
  assert.equal(section.data.premiumPercent, 1.86);
});

test("ETF research marks premium unavailable when no market price is available", async () => {
  const provider: StockProvider = {
    id: "etf-only",
    priority: 1,
    capabilities: ["etf"],
    async etf() {
      return {
        data: { nav: [{ date: "2026-07-15", nav: 1.25 }] },
        asOf: "2026-07-15",
      };
    },
  };
  const result = await createStockResearchService({
    providers: [provider],
  }).research({
    instrument: etf,
    capabilities: ["etf"],
  });
  const section = (result.data as { capabilities: Record<string, any> })
    .capabilities.etf;
  assert.equal(result.status, "partial");
  assert.equal(section.status, "partial");
  assert.equal(section.data.premiumPercent, null);
  assert.match(section.warnings.join("\n"), /无法计算溢价率/);
});
