import assert from "node:assert/strict";
import test from "node:test";

import {
  createStockResearchService,
  createTencentProvider,
} from "../src/index.ts";

test("resolve normalizes an A-share code into a stable InstrumentRef", async () => {
  const service = createStockResearchService({ providers: [] });

  const result = await service.resolve({ query: "600519" });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.instruments, [
    {
      id: "CN:600519",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
      symbol: "600519",
      name: "600519",
    },
  ]);
  assert.equal(result.sources[0]?.provider, "calen-symbol-resolver");
  assert.equal(result.cached, false);
  assert.deepEqual(result.warnings, []);
});

test("resolve keeps Beijing Stock Exchange codes out of the Shanghai route", async () => {
  const service = createStockResearchService({ providers: [] });
  const result = await service.resolve({ query: "832000" });
  assert.equal(result.instruments[0]?.exchange, "BSE");
});

test("resolve canonicalizes Tencent-style HK and US symbols", async () => {
  const service = createStockResearchService({ providers: [] });

  const hk = await service.resolve({ query: "hk700" });
  const us = await service.resolve({ query: "usAAPL.OQ" });

  assert.deepEqual(hk.instruments[0], {
    id: "HK:00700",
    market: "HK",
    exchange: "HKEX",
    assetType: "stock",
    currency: "HKD",
    symbol: "00700",
    name: "00700",
  });
  assert.deepEqual(us.instruments[0], {
    id: "US:AAPL",
    market: "US",
    exchange: "NASDAQ",
    assetType: "stock",
    currency: "USD",
    symbol: "AAPL",
    name: "AAPL",
  });
});

test("resolve preserves US class-share dots that are not Tencent exchange suffixes", async () => {
  const service = createStockResearchService({ providers: [] });

  const result = await service.resolve({ query: "US:BRK.B" });

  assert.equal(result.instruments[0]?.id, "US:BRK.B");
  assert.equal(result.instruments[0]?.symbol, "BRK.B");
  assert.equal(result.instruments[0]?.exchange, "US");
});

test("resolve treats a mixed-case US company name as fuzzy search instead of a ticker", async () => {
  const service = createStockResearchService({
    providers: [createTencentProvider()],
    fetch: async () =>
      Response.json({
        stock: [
          { code: "usAAPL.OQ", name: "苹果(Apple)", type: "GP" },
          {
            code: "usAAPX.AM",
            name: "T-Rex 2X Long Apple Daily Target ETF",
            type: "GP-ETF",
          },
        ],
      }),
    now: () => new Date("2026-07-16T03:00:00.000Z"),
    throttleIntervalMs: 0,
  });

  const result = await service.resolve({
    query: "Apple",
    market: "US",
    limit: 2,
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(
    result.instruments.map(({ id, exchange, assetType, name }) => ({
      id,
      exchange,
      assetType,
      name,
    })),
    [
      {
        id: "US:AAPL",
        exchange: "NASDAQ",
        assetType: "stock",
        name: "苹果(Apple)",
      },
      {
        id: "US:AAPX",
        exchange: "NYSEAMERICAN",
        assetType: "etf",
        name: "T-Rex 2X Long Apple Daily Target ETF",
      },
    ]
  );
  assert.equal(result.sources[0]?.provider, "tencent");
  assert.match(result.warnings.join("\n"), /有限基础研究/);
});

test("resolve sends lowercase US company names through fuzzy search", async () => {
  const service = createStockResearchService({
    providers: [createTencentProvider()],
    fetch: async () =>
      Response.json({
        stock: [{ code: "usTSLA.OQ", name: "特斯拉(Tesla)", type: "GP" }],
      }),
    throttleIntervalMs: 0,
  });

  const result = await service.resolve({ query: "tesla", market: "US" });

  assert.equal(result.instruments[0]?.id, "US:TSLA");
  assert.equal(result.instruments[0]?.name, "特斯拉(Tesla)");
  assert.equal(result.sources[0]?.provider, "tencent");
});

test("resolve marks an offline ambiguous US ticker fallback as partial", async () => {
  const service = createStockResearchService({ providers: [] });

  const result = await service.resolve({ query: "AAPL", market: "US" });

  assert.equal(result.status, "partial");
  assert.equal(result.instruments[0]?.id, "US:AAPL");
  assert.match(result.warnings.join("\n"), /请核对证券身份/);
});
