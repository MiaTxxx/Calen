import assert from "node:assert/strict";
import test from "node:test";

import {
  createEastmoneyProvider,
  createStockResearchService,
  makeInstrument,
} from "../src/index.ts";

const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");

test("Eastmoney normalizes an A-share snapshot", async () => {
  const provider = createEastmoneyProvider();
  const result = await provider.snapshot!(instrument, {
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(
        url.origin + url.pathname,
        "https://push2.eastmoney.com/api/qt/stock/get"
      );
      assert.equal(url.searchParams.get("secid"), "1.600519");
      assert.equal(url.searchParams.get("fltt"), "2");
      return Response.json({
        data: {
          f43: 1500.5,
          f57: "600519",
          f58: "贵州茅台",
          f60: 1490,
          f46: 1495,
          f44: 1510,
          f45: 1488,
          f47: 12345,
          f169: 10.5,
          f170: 0.7,
          f86: "20260715103000",
        },
      });
    },
    now: () => new Date("2026-07-15T02:30:01.000Z"),
  });
  assert.equal(result.data?.price, 1500.5);
  assert.equal(result.data?.previousClose, 1490);
  assert.equal(result.data?.change, 10.5);
  assert.equal(result.data?.changePercent, 0.7);
  assert.equal(result.data?.instrument.name, "贵州茅台");
  assert.equal(result.asOf, "2026-07-15T10:30:00+08:00");
});

test("Eastmoney is a real default-compatible snapshot fallback", async () => {
  const result = await createStockResearchService({
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("qt.gtimg.cn"))
        return new Response("unavailable", { status: 503 });
      if (url.includes("stock/get"))
        return Response.json({
          data: { f43: 1500, f57: "600519", f58: "贵州茅台", f60: 1490 },
        });
      throw new Error("unexpected request");
    },
    throttleIntervalMs: 0,
  }).snapshot({ instrument });
  assert.equal(result.status, "partial");
  assert.equal(result.sources[0]?.provider, "eastmoney");
  assert.equal(result.data?.price, 1500);
  assert.match(result.warnings.join("\n"), /tencent.*HTTP 503/);
});
