import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService } from "../src/index.ts";

test("marketBrief exposes explicit Eastmoney sections and a versioned derived sentiment", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("getTopicZTPool"))
      return Response.json({
        data: {
          tc: 1,
          qdate: 20260715,
          pool: [
            {
              c: "600001",
              n: "涨停股",
              p: 12340,
              zdp: 10.01,
              amount: 100000000,
              lbc: 2,
              hybk: "银行",
            },
          ],
        },
      });
    if (url.pathname.includes("getTopicDTPool"))
      return Response.json({
        data: {
          tc: 1,
          qdate: 20260715,
          pool: [
            {
              c: "600002",
              n: "跌停股",
              p: 8760,
              zdp: -9.98,
              amount: 50000000,
              hybk: "地产",
            },
          ],
        },
      });
    if (url.pathname.includes("getAllStockChanges"))
      return Response.json({
        data: {
          allstock: [
            {
              c: "600003",
              n: "异动股",
              tm: "14:30:00",
              t: "8201",
              m: "大笔买入",
            },
          ],
        },
      });
    if (url.hostname === "datacenter-web.eastmoney.com")
      return Response.json({
        result: {
          data: [
            {
              SECURITY_CODE: "600004",
              SECURITY_NAME_ABBR: "龙虎榜股",
              TRADE_DATE: "2026-07-15",
              EXPLANATION: "日涨幅偏离值达到7%",
              CLOSE_PRICE: 10,
              CHANGE_RATE: 8,
              NET_BUY_AMT: 1000000,
            },
          ],
        },
      });
    if (url.pathname.endsWith("/api/qt/clist/get")) {
      const fs = url.searchParams.get("fs") ?? "";
      const fid = url.searchParams.get("fid");
      if (fs.includes("m:90") && fid === "f62")
        return Response.json({
          data: {
            diff: [
              {
                f12: "BK0475",
                f14: "银行",
                f3: 1.2,
                f62: 800000000,
                f184: 3.5,
              },
            ],
          },
        });
      if (fs.includes("m:90"))
        return Response.json({
          data: {
            diff: [{ f12: "BK0890", f14: "白酒", f3: 2.8, f62: 600000000 }],
          },
        });
      return Response.json({
        data: {
          diff: [
            {
              f12: "600519",
              f14: "贵州茅台",
              f2: 1500,
              f3: 2.5,
              f4: 36.59,
              f5: 12345,
              f6: 987654321,
            },
          ],
        },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const service = createStockResearchService({
    fetch: fetchMock,
    now: () => new Date("2026-07-15T07:00:00.000Z"),
  });

  const result = await service.marketBrief({ market: "CN", limit: 5 });
  const data = result.data as any;

  assert.equal(result.status, "ok");
  assert.equal(result.sources[0]?.provider, "eastmoney");
  assert.equal(data.sections.limitUp.total, 1);
  assert.equal(data.sections.limitUp.items[0].price, 12.34);
  assert.equal(data.sections.limitDown.items[0].symbol, "600002");
  assert.equal(data.sections.hotSectors.items[0].name, "白酒");
  assert.equal(data.sections.moneyFlow.items[0].mainNetInflow, 800000000);
  assert.equal(data.sections.dragonTiger.items[0].symbol, "600004");
  assert.equal(data.sections.unusualMoves.items[0].symbol, "600003");
  assert.equal(data.sections.sentiment.method, "calen.market-sentiment.v1");
  assert.equal(data.sections.sentiment.components.limitUpCount, 1);
  assert.equal(data.movers[0].symbol, "600519");
});

test("marketBrief is partial when a required market section has no source", async () => {
  const service = createStockResearchService({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (
        url.pathname.includes("getTopicZTPool") ||
        url.pathname.includes("getTopicDTPool")
      ) {
        return Response.json({ data: { tc: 0 } });
      }
      if (url.pathname.includes("getAllStockChanges"))
        return Response.json({ data: { allstock: [] } });
      if (url.hostname === "datacenter-web.eastmoney.com")
        return Response.json({ result: { data: [] } });
      if (
        url.pathname.endsWith("/api/qt/clist/get") &&
        !(url.searchParams.get("fs") ?? "").includes("m:90")
      ) {
        return Response.json({
          data: {
            diff: [
              {
                f12: "600519",
                f14: "贵州茅台",
                f2: 1500,
                f3: 2.5,
                f4: 36.59,
                f5: 1,
                f6: 2,
              },
            ],
          },
        });
      }
      if (
        url.pathname.endsWith("/api/qt/clist/get") &&
        url.searchParams.get("fid") === "f62"
      ) {
        return Response.json({
          data: { diff: [{ f12: "BK1", f14: "行业", f3: 1, f62: 10 }] },
        });
      }
      if (url.pathname.endsWith("/api/qt/clist/get")) {
        return Response.json({
          data: { diff: [{ f12: "BK2", f14: "板块", f3: 2, f62: 5 }] },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  const result = await service.marketBrief({ market: "CN", limit: 5 });
  const sections = (result.data as any).sections;
  assert.equal(result.status, "partial");
  assert.equal(sections.limitUp, null);
  assert.notEqual(sections.hotSectors, null);
  assert.match(result.warnings.join("\n"), /limitUp/);
});
