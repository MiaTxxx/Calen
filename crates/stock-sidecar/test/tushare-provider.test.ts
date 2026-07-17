import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderRegistry,
  createDefaultProviders,
  createTushareProvider,
  loadStockRuntimeConfig,
  makeInstrument,
} from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

type TushareRequest = {
  api_name: string;
  token: string;
  params: Record<string, unknown>;
  fields: string;
};

function response(
  fields: string[],
  items: Array<Array<string | number | null>>,
  options: { code?: number; msg?: string } = {}
): Response {
  return Response.json({
    code: options.code ?? 0,
    msg: options.msg,
    data: { fields, items },
  });
}

test("Tushare is registered only when enabled with a non-empty token", async () => {
  const withoutToken = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "tushare", enabled: true }],
    }),
  });
  assert.doesNotMatch(withoutToken.enabledProviderIds.join(","), /tushare/);
  assert.equal(
    withoutToken.providerCatalog.find((item) => item.id === "tushare")?.state,
    "unconfigured"
  );
  assert.equal(createDefaultProviders(["tushare"], {}).length, 0);

  const withToken = loadStockRuntimeConfig({
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "tushare", enabled: true }],
    }),
    CALEN_STOCK_PROVIDER_KEYS: JSON.stringify({ tushare: "top-secret" }),
  });
  assert.match(withToken.enabledProviderIds.join(","), /tushare/);
  const providers = createDefaultProviders(withToken.enabledProviderIds, {
    tushare: "top-secret",
  });
  assert.equal(providers.filter((item) => item.id === "tushare").length, 1);
  const status = new ProviderRegistry(providers).status();
  assert.doesNotMatch(JSON.stringify(status), /top-secret/);
});

test("Tushare resolve sends a scoped stock_basic request and normalizes A-share instruments", async () => {
  let request: TushareRequest | undefined;
  const provider = createTushareProvider("provider-token");
  const result = await provider.resolve!(
    { query: "600519", market: "CN", limit: 3 },
    {
      fetch: async (_url, init) => {
        request = JSON.parse(String(init?.body)) as TushareRequest;
        return response(
          ["ts_code", "symbol", "name", "exchange", "market", "list_status"],
          [["600519.SH", "600519", "贵州茅台", "SSE", "主板", "L"]]
        );
      },
      now: () => new Date("2026-07-16T01:00:00.000Z"),
    }
  );

  assert.equal(request?.api_name, "stock_basic");
  assert.equal(request?.token, "provider-token");
  assert.deepEqual(request?.params, {
    list_status: "L",
    ts_code: "600519.SH",
    limit: 3,
  });
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

test("Tushare snapshot and daily history normalize numeric fields and ascending dates", async () => {
  const requests: TushareRequest[] = [];
  const provider = createTushareProvider("provider-token");
  const instrument = makeInstrument(
    "CN",
    "000001",
    "SZSE",
    "EQUITY",
    "CNY",
    "平安银行"
  );
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as TushareRequest;
    requests.push(request);
    if (request.params.limit === 1)
      return response(
        [
          "ts_code",
          "trade_date",
          "open",
          "high",
          "low",
          "close",
          "pre_close",
          "vol",
          "pct_chg",
        ],
        [["000001.SZ", "20260715", 11, 12, 10, 11.5, 10.5, 1234, 9.5238]]
      );
    return response(
      ["ts_code", "trade_date", "open", "high", "low", "close", "vol"],
      [
        ["000001.SZ", "20260715", 11, 12, 10, 11.5, 1234],
        ["000001.SZ", "20260714", 10, 11, 9, 10.5, 1000],
      ]
    );
  };
  const context = {
    fetch: fetchImpl,
    now: () => new Date("2026-07-16T01:00:00.000Z"),
  };

  const snapshot = await provider.snapshot!(instrument, context);
  const history = await provider.history!(
    instrument,
    { limit: 2, start: "2026-07-01", end: "2026-07-15" },
    context
  );

  assert.deepEqual(requests[0]?.params, { ts_code: "000001.SZ", limit: 1 });
  assert.deepEqual(requests[1]?.params, {
    ts_code: "000001.SZ",
    start_date: "20260701",
    end_date: "20260715",
    limit: 2,
  });
  assert.equal(snapshot.data?.price, 11.5);
  assert.equal(snapshot.data?.change, 1);
  assert.equal(snapshot.data?.changePercent, 9.5238);
  assert.equal(snapshot.data?.marketTime, "2026-07-15");
  assert.match(snapshot.warnings?.join("\n") ?? "", /收盘|非实时/);
  assert.deepEqual(
    history.data?.map((bar) => bar.time),
    ["2026-07-14", "2026-07-15"]
  );
  assert.equal(history.data?.[1]?.volume, 1234);
});

test("Tushare leaves optional null and blank quote values absent", async () => {
  const provider = createTushareProvider("provider-token");
  const instrument = makeInstrument("CN", "000001", "SZSE", "EQUITY", "CNY");
  const result = await provider.snapshot!(instrument, {
    fetch: async () =>
      response(
        [
          "ts_code",
          "trade_date",
          "open",
          "high",
          "low",
          "close",
          "pre_close",
          "vol",
          "pct_chg",
        ],
        [["000001.SZ", "20260715", "", null, " ", 11.5, null, "", null]]
      ),
    now: () => new Date("2026-07-16T01:00:00.000Z"),
  });

  assert.equal(result.data?.price, 11.5);
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
});

test("Tushare profile combines stock_basic and stock_company without exposing provider fields", async () => {
  const provider = createTushareProvider("provider-token");
  const instrument = makeInstrument(
    "CN",
    "600519",
    "SSE",
    "EQUITY",
    "CNY",
    "贵州茅台"
  );
  const result = await provider.profile!(instrument, {
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as TushareRequest;
      if (request.api_name === "stock_basic")
        return response(
          [
            "ts_code",
            "name",
            "area",
            "industry",
            "market",
            "list_date",
            "exchange",
          ],
          [["600519.SH", "贵州茅台", "贵州", "白酒", "主板", "20010827", "SSE"]]
        );
      assert.equal(request.api_name, "stock_company");
      return response(
        [
          "ts_code",
          "chairman",
          "reg_capital",
          "setup_date",
          "main_business",
          "employees",
        ],
        [
          [
            "600519.SH",
            "丁雄军",
            125619.78,
            "19991120",
            "茅台酒生产与销售",
            31000,
          ],
        ]
      );
    },
    now: () => new Date("2026-07-16T01:00:00.000Z"),
  });

  assert.deepEqual(result.data, {
    name: "贵州茅台",
    area: "贵州",
    industry: "白酒",
    market: "主板",
    exchange: "SSE",
    listedAt: "2001-08-27",
    chairman: "丁雄军",
    manager: undefined,
    registeredCapital: 125619.78,
    establishedAt: "1999-11-20",
    province: undefined,
    city: undefined,
    introduction: undefined,
    mainBusiness: "茅台酒生产与销售",
    businessScope: undefined,
    employees: 31000,
  });
});

test("Tushare API errors fall back without exposing the token", async () => {
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const tushare = createTushareProvider("never-log-this-token");
  const fallback: StockProvider = {
    id: "fallback",
    priority: 120,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 1500, marketTime: "2026-07-16" },
        asOf: "2026-07-16",
      };
    },
  };
  const registry = new ProviderRegistry([tushare, fallback], {
    fetch: async () =>
      response([], [], {
        code: -2001,
        msg: "permission denied never-log-this-token",
      }),
  });

  const result = await registry.query(
    "snapshot",
    instrument.id,
    (provider, context) => provider.snapshot!(instrument, context)
  );

  assert.equal(result.source?.provider, "fallback");
  assert.match(result.warnings.join("\n"), /tushare.*permission denied/i);
  assert.doesNotMatch(
    JSON.stringify({ result, status: registry.status() }),
    /never-log-this-token/
  );
});
