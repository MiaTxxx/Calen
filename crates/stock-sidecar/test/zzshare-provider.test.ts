import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderRegistry,
  createDefaultProviders,
  createZzshareProvider,
  loadStockRuntimeConfig,
  makeInstrument,
} from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

function json(data: unknown, code = 20000): Response {
  return Response.json({ code, message: "success", data });
}

test("ZZShare stays disabled by default and explicitly enabled instances use anonymous without a key", () => {
  assert.equal(
    createDefaultProviders().some((provider) => provider.id === "zzshare"),
    false
  );
  const config = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "zzshare", enabled: true }],
    }),
  });
  assert.match(config.enabledProviderIds.join(","), /zzshare/);
  const providers = createDefaultProviders(config.enabledProviderIds, {});
  assert.equal(
    providers.filter((provider) => provider.id === "zzshare").length,
    1
  );
});

test("ZZShare anonymous resolve sends the official header and normalizes A-share instruments", async () => {
  let requestUrl = "";
  let sdkKey = "";
  const provider = createZzshareProvider();
  const result = await provider.resolve!(
    { query: "600519", market: "CN", limit: 3 },
    {
      fetch: async (url, init) => {
        requestUrl = String(url);
        sdkKey = new Headers(init?.headers).get("sdk-key") ?? "";
        return json({
          exchange: "SS",
          list: [
            {
              code: "600519",
              name: "贵州茅台",
              type_code: "ESA.M",
              list_status: 1,
            },
          ],
        });
      },
      now: () => new Date("2026-07-16T01:00:00.000Z"),
    }
  );

  assert.equal(sdkKey, "anonymous");
  assert.equal(
    requestUrl,
    "https://api.zizizaizai.com/v3/open/stocks/list?exchange=SS&list_status=L&format=records&ts_code=600519"
  );
  assert.deepEqual(result.data, [
    {
      id: "CN:600519",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
      symbol: "600519",
      name: "贵州茅台",
    },
  ]);
});

test("ZZShare keyed daily requests preserve query parameters and normalize snapshot/history", async () => {
  const urls: string[] = [];
  const headers: string[] = [];
  const provider = createZzshareProvider("private-zzshare-key");
  const instrument = makeInstrument(
    "CN",
    "000001",
    "SZSE",
    "EQUITY",
    "CNY",
    "平安银行"
  );
  const context = {
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      headers.push(new Headers(init?.headers).get("sdk-key") ?? "");
      const parsed = new URL(String(url));
      const limit = parsed.searchParams.get("limit");
      return json({
        ts_code: "000001.SZ",
        list:
          limit === "1"
            ? [
                {
                  trade_date: "20260715",
                  open: 11,
                  high: 12,
                  low: 10,
                  close: 11.5,
                  prev_close: 10.5,
                  volume: 1234,
                  quote_rate: 9.5238,
                },
              ]
            : [
                {
                  trade_date: "20260715",
                  open: 11,
                  high: 12,
                  low: 10,
                  close: 11.5,
                  volume: 1234,
                },
                {
                  trade_date: "20260714",
                  open: 10,
                  high: 11,
                  low: 9,
                  close: 10.5,
                  volume: 1000,
                },
              ],
      });
    },
    now: () => new Date("2026-07-16T01:00:00.000Z"),
  };

  const snapshot = await provider.snapshot!(instrument, context);
  const history = await provider.history!(
    instrument,
    { limit: 2, start: "2026-07-01", end: "2026-07-15" },
    context
  );

  assert.deepEqual(headers, ["private-zzshare-key", "private-zzshare-key"]);
  assert.equal(
    urls[1],
    "https://api.zizizaizai.com/v3/market/kline/day/000001.SZ?get_type=range&candle_mode=0&start_date=20260701&end_date=20260715&limit=2"
  );
  assert.equal(snapshot.data?.price, 11.5);
  assert.equal(snapshot.data?.change, 1);
  assert.equal(snapshot.data?.changePercent, 9.5238);
  assert.match(snapshot.warnings?.join("\n") ?? "", /收盘|非实时/);
  assert.deepEqual(
    history.data?.map((bar) => bar.time),
    ["2026-07-14", "2026-07-15"]
  );
});

test("ZZShare profile combines open stock info with the listed-instrument record", async () => {
  const provider = createZzshareProvider();
  const instrument = makeInstrument(
    "CN",
    "600519",
    "SSE",
    "EQUITY",
    "CNY",
    "贵州茅台"
  );
  const result = await provider.profile!(instrument, {
    fetch: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/open/stock/info"))
        return json({
          list: [
            {
              stock_id: "600519",
              industry: "白酒",
              area: "贵州",
              main_business: "茅台酒生产与销售",
            },
          ],
        });
      return json({
        exchange: "SS",
        list: [{ code: "600519", name: "贵州茅台", type_code: "ESA.M" }],
      });
    },
    now: () => new Date("2026-07-16T01:00:00.000Z"),
  });

  assert.deepEqual(result.data, {
    name: "贵州茅台",
    symbol: "600519",
    exchange: "SSE",
    market: "主板",
    area: "贵州",
    industry: "白酒",
    mainBusiness: "茅台酒生产与销售",
  });
});

test("ZZShare 401 and 429 responses fall back without leaking configured keys", async () => {
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  for (const status of [401, 429]) {
    const zzshare = createZzshareProvider("never-log-zzshare-key");
    const fallback: StockProvider = {
      id: `fallback-${status}`,
      priority: 100,
      capabilities: ["snapshot"],
      async snapshot(ref) {
        return {
          data: { instrument: ref, price: 1500, marketTime: "2026-07-16" },
          asOf: "2026-07-16",
        };
      },
    };
    const registry = new ProviderRegistry([zzshare, fallback], {
      fetch: async () => {
        const init: ResponseInit = { status };
        if (status === 429) init.headers = { "Retry-After": "2" };
        return new Response("upstream failure", init);
      },
    });
    const result = await registry.query(
      "snapshot",
      `${instrument.id}:${status}`,
      (provider, context) => provider.snapshot!(instrument, context)
    );
    assert.equal(result.source?.provider, `fallback-${status}`);
    assert.match(result.warnings.join("\n"), new RegExp(String(status)));
    assert.doesNotMatch(
      JSON.stringify({ result, status: registry.status() }),
      /never-log-zzshare-key/
    );
  }
});
