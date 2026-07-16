import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderRegistry,
  createDefaultProviders,
  createFuyaoProvider,
  loadStockRuntimeConfig,
  makeInstrument,
} from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

const now = () => new Date("2026-07-16T02:00:00.000Z");

test("Fuyao registers only when explicitly enabled with a non-empty API Key", () => {
  const withoutKey = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "fuyao", enabled: true }],
    }),
  });
  assert.doesNotMatch(withoutKey.enabledProviderIds.join(","), /fuyao/);
  assert.equal(
    withoutKey.providerCatalog.find((item) => item.id === "fuyao")?.state,
    "unconfigured"
  );
  assert.equal(createDefaultProviders(["fuyao"], {}).length, 0);

  const withKey = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "fuyao", enabled: true }],
    }),
    CALEN_STOCK_PROVIDER_KEYS: JSON.stringify({ fuyao: "fuyao-secret" }),
  });
  assert.match(withKey.enabledProviderIds.join(","), /fuyao/);
  const providers = createDefaultProviders(withKey.enabledProviderIds, {
    fuyao: "fuyao-secret",
  });
  assert.equal(providers.filter((item) => item.id === "fuyao").length, 1);
  assert.doesNotMatch(
    JSON.stringify(new ProviderRegistry(providers).status()),
    /fuyao-secret/
  );
});

test("Fuyao resolve sends scoped search parameters and normalizes thscode instruments", async () => {
  const provider = createFuyaoProvider("provider-key");
  let requestedUrl = "";
  let requestedKey = "";
  let requestedReferer = "";

  const result = await provider.resolve!(
    { query: "茅台", market: "CN", limit: 2 },
    {
      fetch: async (url, init) => {
        requestedUrl = String(url);
        const headers = new Headers(init?.headers);
        requestedKey = headers.get("X-api-key") ?? "";
        requestedReferer = headers.get("Referer") ?? "";
        return Response.json({
          code: 0,
          data: {
            item: [
              {
                thscode: "600519.SH",
                name: "贵州茅台",
                exchange: "SH",
                asset_type: "a-share",
              },
              {
                thscode: "159915.SZ",
                name: "创业板 ETF",
                exchange: "SZ",
                asset_type: "etf",
              },
            ],
          },
        });
      },
      now,
    }
  );

  const url = new URL(requestedUrl);
  assert.equal(
    url.origin + url.pathname,
    "https://fuyao.aicubes.cn/api/meta/tickers/search"
  );
  assert.equal(url.searchParams.get("q"), "茅台");
  assert.equal(url.searchParams.get("limit"), "2");
  assert.equal(url.searchParams.get("asset_type"), "a-share");
  assert.equal(requestedKey, "provider-key");
  assert.equal(requestedReferer, "https://fuyao.aicubes.cn/");
  assert.doesNotMatch(requestedUrl, /provider-key/);
  assert.deepEqual(
    result.data?.map((item) => ({
      id: item.id,
      exchange: item.exchange,
      assetType: item.assetType,
      name: item.name,
    })),
    [
      {
        id: "CN:600519",
        exchange: "SSE",
        assetType: "stock",
        name: "贵州茅台",
      },
      {
        id: "CN:159915",
        exchange: "SZSE",
        assetType: "etf",
        name: "创业板 ETF",
      },
    ]
  );
});

test("Fuyao snapshot sends thscode and normalizes quote fields", async () => {
  const provider = createFuyaoProvider("provider-key");
  const instrument = makeInstrument(
    "CN",
    "600519",
    "SSE",
    "EQUITY",
    "CNY",
    "贵州茅台"
  );
  let requestedUrl = "";
  const marketTime = Date.parse("2026-07-16T10:15:00+08:00");

  const result = await provider.snapshot!(instrument, {
    fetch: async (url) => {
      requestedUrl = String(url);
      return Response.json({
        code: 0,
        data: {
          item: [
            {
              thscode: "600519.SH",
              last_price: 1512,
              prev_price: 1500,
              open_price: 1501,
              high_price: 1520,
              low_price: 1499,
              volume: 23456,
              price_change: 12,
              price_change_ratio_pct: 0.8,
              date_ms: marketTime,
            },
          ],
        },
      });
    },
    now,
  });

  const url = new URL(requestedUrl);
  assert.equal(
    url.origin + url.pathname,
    "https://fuyao.aicubes.cn/api/a-share/prices/snapshot"
  );
  assert.equal(url.searchParams.get("thscodes"), "600519.SH");
  assert.equal(result.data?.price, 1512);
  assert.equal(result.data?.previousClose, 1500);
  assert.equal(result.data?.change, 12);
  assert.equal(result.data?.changePercent, 0.8);
  assert.equal(result.data?.open, 1501);
  assert.equal(result.data?.high, 1520);
  assert.equal(result.data?.low, 1499);
  assert.equal(result.data?.volume, 23456);
  assert.equal(result.data?.marketTime, new Date(marketTime).toISOString());
});

test("Fuyao history sends bounded epoch range and normalizes daily bars", async () => {
  const provider = createFuyaoProvider("provider-key");
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  let requestedUrl = "";

  const result = await provider.history!(
    instrument,
    { limit: 2, start: "2026-07-14", end: "2026-07-15" },
    {
      fetch: async (url) => {
        requestedUrl = String(url);
        return Response.json({
          code: 0,
          data: {
            item: [
              {
                date_ms: Date.parse("2026-07-15T00:00:00+08:00"),
                open_price: "1501",
                high_price: "1520",
                low_price: "1499",
                close_price: "1512",
                volume: "23456",
              },
              {
                date_ms: Date.parse("2026-07-14T00:00:00+08:00"),
                open_price: 1490,
                high_price: 1510,
                low_price: 1488,
                close_price: 1500,
                volume: 12345,
              },
            ],
          },
        });
      },
      now,
    }
  );

  const url = new URL(requestedUrl);
  assert.equal(
    url.origin + url.pathname,
    "https://fuyao.aicubes.cn/api/a-share/prices/historical"
  );
  assert.equal(url.searchParams.get("thscode"), "600519.SH");
  assert.equal(url.searchParams.get("interval"), "1d");
  assert.equal(url.searchParams.get("adjust"), "forward");
  assert.equal(url.searchParams.get("start"), String(Date.UTC(2026, 6, 14)));
  assert.equal(
    url.searchParams.get("end"),
    String(Date.UTC(2026, 6, 15, 23, 59, 59, 999))
  );
  assert.deepEqual(result.data, [
    {
      time: "2026-07-14",
      open: 1490,
      high: 1510,
      low: 1488,
      close: 1500,
      volume: 12345,
    },
    {
      time: "2026-07-15",
      open: 1501,
      high: 1520,
      low: 1499,
      close: 1512,
      volume: 23456,
    },
  ]);
  assert.equal(result.asOf, "2026-07-15");
});

test("Fuyao API code errors are explicit and never include the API Key", async () => {
  const provider = createFuyaoProvider("never-log-fuyao-key");
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");

  await assert.rejects(
    provider.snapshot!(instrument, {
      fetch: async () =>
        Response.json({
          code: 4001,
          message: "quota exceeded for never-log-fuyao-key",
          request_id: "request-123",
        }),
      now,
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(
        message,
        /Fuyao API code=4001.*quota exceeded.*\[REDACTED\].*request-123/i
      );
      assert.doesNotMatch(message, /never-log-fuyao-key/);
      return true;
    }
  );
});

test("Fuyao permission failures fall back without exposing the API Key", async () => {
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const fuyao = createFuyaoProvider("never-log-fuyao-key");
  const fallback: StockProvider = {
    id: "fallback",
    priority: 130,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 1500, marketTime: "2026-07-16" },
        asOf: "2026-07-16",
      };
    },
  };
  const registry = new ProviderRegistry([fuyao, fallback], {
    fetch: async () =>
      Response.json(
        {
          code: 3001,
          message: "permission denied for never-log-fuyao-key",
        },
        { status: 403 }
      ),
  });

  const result = await registry.query(
    "snapshot",
    instrument.id,
    (provider, context) => provider.snapshot!(instrument, context)
  );

  assert.equal(result.source?.provider, "fallback");
  assert.match(result.warnings.join("\n"), /fuyao.*permission denied/i);
  assert.doesNotMatch(
    JSON.stringify({ result, status: registry.status() }),
    /never-log-fuyao-key/
  );
});
