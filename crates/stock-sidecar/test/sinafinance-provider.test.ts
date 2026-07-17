import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultProviders,
  createSinafinanceProvider,
  makeInstrument,
  ProviderRegistry,
} from "../src/index.ts";

const now = () => new Date("2026-07-15T08:00:00.000Z");

function gb18030Response(hex: string): Response {
  return new Response(Buffer.from(hex, "hex"), {
    headers: { "Content-Type": "application/javascript; charset=GB18030" },
  });
}

test("Sinafinance resolve decodes A-share and ETF suggestions", async () => {
  const provider = createSinafinanceProvider();
  let requestedUrl = "";
  const result = await provider.resolve!(
    { query: "茅台", market: "CN", limit: 2 },
    {
      fetch: async (url) => {
        requestedUrl = String(url);
        return gb18030Response(
          "766172207375676765737476616C75653D2273683630303531392C31312C3630303531392C73683630303531392CB9F3D6DDC3A9CCA82C2CB9F3D6DDC3A9CCA82C39392C312C4553472C2C3B73683531303330302C3230332C3531303330302C73683531303330302CBBA6C9EE333030455446BBAACCA9B0D8C8F02C2CBBA6C9EE333030455446BBAACCA9B0D8C8F02C39392C312C2C2C223B"
        );
      },
      now,
    }
  );

  assert.match(requestedUrl, /suggest3\.sinajs\.cn\/suggest/);
  assert.equal(new URL(requestedUrl).searchParams.get("key"), "茅台");
  assert.deepEqual(
    result.data?.map(({ symbol, name, exchange, assetType }) => ({
      symbol,
      name,
      exchange,
      assetType,
    })),
    [
      {
        symbol: "600519",
        name: "贵州茅台",
        exchange: "SSE",
        assetType: "stock",
      },
      {
        symbol: "510300",
        name: "沪深300ETF华泰柏瑞",
        exchange: "SSE",
        assetType: "etf",
      },
    ]
  );
  assert.equal(result.asOf, "2026-07-15T08:00:00.000Z");
});

test("Sinafinance resolve scopes free name suggestions to HK and US markets", async () => {
  const provider = createSinafinanceProvider();
  const requestedTypes: string[] = [];
  const context = {
    fetch: async (url: string | URL | Request) => {
      requestedTypes.push(new URL(String(url)).searchParams.get("type") ?? "");
      return new Response(
        'var suggestvalue="腾讯控股,31,00700,00700,腾讯控股,,腾讯控股,99,1,ESG,,;苹果,41,aapl,aapl,苹果,,苹果,99,1,ESG,,";',
        { headers: { "Content-Type": "application/javascript; charset=utf-8" } }
      );
    },
    now,
  };

  const hk = await provider.resolve!(
    { query: "腾讯控股", market: "HK" },
    context
  );
  const us = await provider.resolve!({ query: "Apple", market: "US" }, context);

  assert.deepEqual(requestedTypes, ["31", "41"]);
  assert.deepEqual(hk.data, [
    {
      id: "HK:00700",
      market: "HK",
      exchange: "HKEX",
      assetType: "stock",
      currency: "HKD",
      symbol: "00700",
      name: "腾讯控股",
    },
  ]);
  assert.deepEqual(us.data, [
    {
      id: "US:AAPL",
      market: "US",
      exchange: "US",
      assetType: "unknown",
      currency: "USD",
      symbol: "AAPL",
      name: "苹果",
    },
  ]);
  assert.match(hk.warnings?.join("\n") ?? "", /有限基础研究/);
  assert.match(us.warnings?.join("\n") ?? "", /交易所.*未验证/);
});

test("Sinafinance snapshot normalizes quote fields and market time", async () => {
  const provider = createSinafinanceProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const result = await provider.snapshot!(instrument, {
    fetch: async () =>
      gb18030Response(
        "7661722068715F7374725F73683630303531393D22B9F3D6DDC3A9CCA82C313230332E3636302C313231342E3838302C313235312E3036302C313235362E3630302C313139382E3636302C313235312E3036302C313235312E3039302C373139343337312C383932323836313336372E3030302C3432332C313235312E3036302C3230302C313235312E3035302C3730302C313235312E3033302C3730302C313235312E3032302C3430302C313235312E3031302C3230302C313235312E3039302C3630302C313235312E3130302C313930302C313235312E3230302C3130302C313235312E3238302C3330302C313235312E3331302C323032362D30372D31352C31353A33343A35392C30302C447C333330307C343132383439382E3030223B"
      ),
    now,
  });

  assert.equal(result.data?.instrument.name, "贵州茅台");
  assert.equal(result.data?.price, 1251.06);
  assert.equal(result.data?.previousClose, 1214.88);
  assert.equal(result.data?.open, 1203.66);
  assert.equal(result.data?.high, 1256.6);
  assert.equal(result.data?.low, 1198.66);
  assert.equal(result.data?.volume, 7_194_371);
  assert.equal(result.data?.change, 36.18);
  assert.equal(result.data?.changePercent, 2.98);
  assert.equal(result.data?.marketTime, "2026-07-15T15:34:59.000+08:00");
  assert.equal(result.asOf, "2026-07-15T15:34:59.000+08:00");
});

test("Sinafinance does not substitute retrieval time for a missing quote time", async () => {
  const provider = createSinafinanceProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const fields = Array.from({ length: 32 }, () => "");
  fields[0] = "贵州茅台";
  fields[3] = "1251.06";
  const result = await provider.snapshot!(instrument, {
    fetch: async () =>
      new Response(`var hq_str_sh600519="${fields.join(",")}";`, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      }),
    now,
  });

  assert.equal(result.data?.marketTime, "unknown");
  assert.equal(result.asOf, "unknown");
  assert.match(result.warnings?.join("\n") ?? "", /时间|asOf|unknown/i);
});

test("Sinafinance history bounds and filters daily bars", async () => {
  const provider = createSinafinanceProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  let requestedUrl = "";
  const result = await provider.history!(
    instrument,
    { limit: 2, start: "2026-07-14", end: "2026-07-15" },
    {
      fetch: async (url) => {
        requestedUrl = String(url);
        return Response.json([
          {
            day: "2026-07-13",
            open: "1197.120",
            high: "1215.000",
            low: "1190.190",
            close: "1210.990",
            volume: "4198257",
          },
          {
            day: "2026-07-14",
            open: "1208.990",
            high: "1226.870",
            low: "1205.000",
            close: "1214.880",
            volume: "4352726",
          },
          {
            day: "2026-07-15",
            open: "1203.660",
            high: "1256.600",
            low: "1198.660",
            close: "1251.060",
            volume: "7194371",
          },
        ]);
      },
      now,
    }
  );

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("symbol"), "sh600519");
  assert.equal(url.searchParams.get("scale"), "240");
  assert.equal(url.searchParams.get("datalen"), "2");
  assert.deepEqual(result.data, [
    {
      time: "2026-07-14",
      open: 1208.99,
      high: 1226.87,
      low: 1205,
      close: 1214.88,
      volume: 4_352_726,
    },
    {
      time: "2026-07-15",
      open: 1203.66,
      high: 1256.6,
      low: 1198.66,
      close: 1251.06,
      volume: 7_194_371,
    },
  ]);
  assert.equal(result.asOf, "2026-07-15");
  assert.match(result.warnings?.join("\n") ?? "", /复权/);
});

test("enabled providers order Sinafinance after Tencent and Eastmoney", () => {
  const providers = createDefaultProviders([
    "tencent",
    "eastmoney",
    "sinafinance",
  ]);
  const priorities = Object.fromEntries(
    providers.map((provider) => [provider.id, provider.priority])
  );
  assert.ok(priorities.tencent! < priorities.eastmoney!);
  assert.ok(priorities.eastmoney! < priorities.sinafinance!);
});

test("enabled history falls back through Tencent and Eastmoney to Sinafinance", async () => {
  const providers = createDefaultProviders([
    "tencent",
    "eastmoney",
    "sinafinance",
  ]);
  const registry = new ProviderRegistry(providers, {
    fetch: async (url) => {
      if (String(url).includes("gtimg.cn"))
        return new Response("denied", { status: 429 });
      if (String(url).includes("eastmoney.com"))
        return new Response("denied", { status: 503 });
      return Response.json([
        {
          day: "2026-07-15",
          open: "1203.660",
          high: "1256.600",
          low: "1198.660",
          close: "1251.060",
          volume: "7194371",
        },
      ]);
    },
    now,
  });
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const result = await registry.query(
    "history",
    instrument.id,
    (provider, context) => provider.history!(instrument, { limit: 1 }, context)
  );

  assert.equal(result.source?.provider, "sinafinance");
  assert.match(result.warnings.join("\n"), /tencent/);
  assert.match(result.warnings.join("\n"), /eastmoney/);
  assert.match(result.warnings.join("\n"), /复权/);
});
