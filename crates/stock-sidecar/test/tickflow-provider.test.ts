import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderRegistry,
  createDefaultProviders,
  createTickflowProvider,
  loadStockRuntimeConfig,
  makeInstrument,
} from "../src/index.ts";
import type { InstrumentRef, StockProvider } from "../src/index.ts";

const now = () => new Date("2026-07-16T02:00:00.000Z");

test("TickFlow registers only when explicitly enabled with an API Key", () => {
  const withoutKey = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "tickflow", enabled: true }],
    }),
  });
  assert.doesNotMatch(withoutKey.enabledProviderIds.join(","), /tickflow/);
  assert.equal(
    withoutKey.providerCatalog.find((item) => item.id === "tickflow")?.state,
    "unconfigured"
  );
  assert.equal(createDefaultProviders(["tickflow"], {}).length, 0);

  const withKey = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "tickflow", enabled: true }],
    }),
    CALEN_STOCK_PROVIDER_KEYS: JSON.stringify({
      tickflow: "tickflow-secret",
    }),
  });
  assert.match(withKey.enabledProviderIds.join(","), /tickflow/);
  const providers = createDefaultProviders(withKey.enabledProviderIds, {
    tickflow: "tickflow-secret",
  });
  assert.equal(providers.filter((item) => item.id === "tickflow").length, 1);
  assert.doesNotMatch(
    JSON.stringify(new ProviderRegistry(providers).status()),
    /tickflow-secret/
  );
});

test("TickFlow snapshot sends x-api-key and normalizes CN, HK, and US quotes", async () => {
  const provider = createTickflowProvider("provider-key");
  const cases: Array<{
    instrument: InstrumentRef;
    expectedSymbol: string;
    name: string;
  }> = [
    {
      instrument: makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY"),
      expectedSymbol: "600519.SH",
      name: "贵州茅台",
    },
    {
      instrument: makeInstrument("HK", "00700", "HKEX", "EQUITY", "HKD"),
      expectedSymbol: "00700.HK",
      name: "腾讯控股",
    },
    {
      instrument: makeInstrument("US", "AAPL", "US", "EQUITY", "USD"),
      expectedSymbol: "AAPL.US",
      name: "Apple",
    },
  ];

  for (const item of cases) {
    let requestedUrl = "";
    let requestedKey = "";
    const result = await provider.snapshot!(item.instrument, {
      fetch: async (url, init) => {
        requestedUrl = String(url);
        requestedKey = new Headers(init?.headers).get("x-api-key") ?? "";
        return Response.json({
          data: [
            {
              symbol: item.expectedSymbol,
              last_price: 125.1,
              prev_close: 120,
              open: 121,
              high: 126,
              low: 119,
              volume: 123456,
              timestamp: "2026-07-16T09:35:00+08:00",
              ext: {
                name: item.name,
                change_pct: 0.0425,
                change_amount: 5.1,
              },
            },
          ],
        });
      },
      now,
    });

    const url = new URL(requestedUrl);
    assert.equal(
      url.origin + url.pathname,
      "https://api.tickflow.org/v1/quotes"
    );
    assert.equal(url.searchParams.get("symbols"), item.expectedSymbol);
    assert.equal(requestedKey, "provider-key");
    assert.doesNotMatch(requestedUrl, /provider-key/);
    assert.equal(result.data?.instrument.name, item.name);
    assert.equal(result.data?.price, 125.1);
    assert.equal(result.data?.previousClose, 120);
    assert.equal(result.data?.change, 5.1);
    assert.equal(result.data?.changePercent, 4.25);
    assert.equal(result.data?.marketTime, "2026-07-16T09:35:00+08:00");
  }
});

test("TickFlow preserves missing quote fields and reports unknown market time", async () => {
  const provider = createTickflowProvider("provider-key");
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const result = await provider.snapshot!(instrument, {
    fetch: async () =>
      Response.json({
        data: [
          {
            symbol: "600519.SH",
            last_price: 125.1,
            prev_close: null,
            open: "",
            high: null,
            low: " ",
            volume: null,
            timestamp: null,
            ext: { change_pct: null, change_amount: "" },
          },
        ],
      }),
    now,
  });

  assert.equal(result.data?.price, 125.1);
  for (const field of [
    "previousClose",
    "open",
    "high",
    "low",
    "volume",
    "change",
    "changePercent",
  ]) {
    assert.equal(field in (result.data ?? {}), false, field);
  }
  assert.equal(result.data?.marketTime, "unknown");
  assert.equal(result.asOf, "unknown");
  assert.match(result.warnings?.join("\n") ?? "", /时间|asOf|unknown/i);
});

test("TickFlow history sends bounded OpenAPI parameters and expands compact bars", async () => {
  const provider = createTickflowProvider("provider-key");
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  let requestedUrl = "";
  const result = await provider.history!(
    instrument,
    { limit: 2, start: "2026-07-14", end: "2026-07-15" },
    {
      fetch: async (url) => {
        requestedUrl = String(url);
        return Response.json({
          data: {
            timestamp: [
              Date.parse("2026-07-14T00:00:00+08:00"),
              Date.parse("2026-07-15T00:00:00+08:00"),
            ],
            open: [120, 125],
            high: [130, 132],
            low: [118, 123],
            close: [128, 130],
            volume: [1000, 1200],
          },
        });
      },
      now,
    }
  );

  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, "https://api.tickflow.org/v1/klines");
  assert.equal(url.searchParams.get("symbol"), "600519.SH");
  assert.equal(url.searchParams.get("period"), "1d");
  assert.equal(url.searchParams.get("count"), "2");
  assert.equal(url.searchParams.get("adjust"), "forward_additive");
  assert.equal(
    url.searchParams.get("start_time"),
    String(Date.UTC(2026, 6, 14))
  );
  assert.equal(
    url.searchParams.get("end_time"),
    String(Date.UTC(2026, 6, 15, 23, 59, 59, 999))
  );
  assert.deepEqual(result.data, [
    {
      time: "2026-07-14",
      open: 120,
      high: 130,
      low: 118,
      close: 128,
      volume: 1000,
    },
    {
      time: "2026-07-15",
      open: 125,
      high: 132,
      low: 123,
      close: 130,
      volume: 1200,
    },
  ]);
  assert.equal(result.asOf, "2026-07-15");
});

test("TickFlow permission failures fall back without exposing the API Key", async () => {
  const instrument = makeInstrument("US", "AAPL", "US", "EQUITY", "USD");
  const tickflow = createTickflowProvider("never-log-tickflow-key");
  const fallback: StockProvider = {
    id: "fallback",
    priority: 130,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 200, marketTime: "2026-07-16" },
        asOf: "2026-07-16",
      };
    },
  };
  const registry = new ProviderRegistry([tickflow, fallback], {
    fetch: async () =>
      Response.json(
        {
          message: "permission denied never-log-tickflow-key",
          code: "NO_QUOTE_PERMISSION",
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
  assert.match(result.warnings.join("\n"), /tickflow.*permission denied/i);
  assert.doesNotMatch(
    JSON.stringify({ result, status: registry.status() }),
    /never-log-tickflow-key/
  );
});
