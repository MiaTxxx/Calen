import assert from "node:assert/strict";
import test from "node:test";

import {
  createEastmoneyProvider,
  createTencentProvider,
  makeInstrument,
  normalizeInstrument,
} from "../src/index.ts";

test("current BSE 920-series symbols are not mistaken for Shanghai securities", () => {
  assert.equal(normalizeInstrument("920000")?.exchange, "BSE");
  assert.equal(normalizeInstrument("900901")?.exchange, "SSE");
});

test("Eastmoney resolve keeps 920-series symbols on the Beijing exchange", async () => {
  const provider = createEastmoneyProvider();
  const result = await provider.resolve!(
    { query: "920000", market: "CN", limit: 1 },
    {
      fetch: async () =>
        Response.json({
          QuotationCodeTable: {
            Data: [
              {
                Code: "920000",
                Name: "安徽凤凰",
                MktNum: "0",
                JYS: "81",
                Classify: "NEEQ",
                SecurityTypeName: "京A",
              },
            ],
          },
        }),
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    }
  );
  assert.equal(result.data?.[0]?.exchange, "BSE");
});

test("Eastmoney snapshot uses the Beijing secid for current BSE symbols", async () => {
  const provider = createEastmoneyProvider();
  const instrument = makeInstrument(
    "CN",
    "920000",
    "BSE",
    "EQUITY",
    "CNY",
    "安徽凤凰"
  );
  let requestedUrl = "";
  const result = await provider.snapshot!(instrument, {
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({
        data: {
          f43: 15.86,
          f57: "920000",
          f58: "安徽凤凰",
          f60: 15.58,
          f86: "20260715150000",
        },
      });
    },
    now: () => new Date("2026-07-15T07:00:00.000Z"),
  });

  assert.equal(new URL(requestedUrl).searchParams.get("secid"), "0.920000");
  assert.equal(result.data?.price, 15.86);
});

test("BSE symbols use Beijing routes across free quote providers", async () => {
  const instrument = makeInstrument("CN", "920000", "BSE", "EQUITY", "CNY");
  let requestedUrl = "";
  const tencent = createTencentProvider();
  await assert.rejects(() =>
    tencent.snapshot!(instrument, {
      fetch: async (url) => {
        requestedUrl = String(url);
        return new Response("", { status: 503 });
      },
      now: () => new Date(),
    })
  );
  assert.match(requestedUrl, /q=bj920000/);
  assert.doesNotMatch(requestedUrl, /sz920000/);

  const eastmoney = createEastmoneyProvider();
  const history = await eastmoney.history!(
    instrument,
    { limit: 5 },
    {
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json({
          data: {
            klines: ["2026-07-15,15.58,15.86,16.01,15.50,123456"],
          },
        });
      },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    }
  );
  assert.equal(new URL(requestedUrl).searchParams.get("secid"), "0.920000");
  assert.equal(history.data?.[0]?.close, 15.86);
});

test("Eastmoney profile addresses BSE companies with the BJ code", async () => {
  const provider = createEastmoneyProvider();
  const instrument = makeInstrument(
    "CN",
    "920000",
    "BSE",
    "EQUITY",
    "CNY",
    "安徽凤凰"
  );
  let requestedUrl = "";
  const result = await provider.profile!(instrument, {
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({
        jbzl: [
          {
            SECUCODE: "920000.BJ",
            SECURITY_CODE: "920000",
            SECURITY_NAME_ABBR: "安徽凤凰",
            ORG_NAME: "安徽凤凰滤清器股份有限公司",
            TRADE_MARKET: "北京证券交易所",
          },
        ],
      });
    },
    now: () => new Date("2026-07-15T00:00:00.000Z"),
  });

  assert.equal(new URL(requestedUrl).searchParams.get("code"), "BJ920000");
  assert.equal(
    (result.data as { companyName?: string } | null)?.companyName,
    "安徽凤凰滤清器股份有限公司"
  );
});

test("Eastmoney financial statements query the BSE security suffix", async () => {
  const provider = createEastmoneyProvider();
  const instrument = makeInstrument(
    "CN",
    "920000",
    "BSE",
    "EQUITY",
    "CNY",
    "安徽凤凰"
  );
  const filters: string[] = [];
  const result = await provider.financials!(instrument, {
    fetch: async (input) => {
      const url = new URL(String(input));
      filters.push(url.searchParams.get("filter") ?? "");
      const reportName = url.searchParams.get("reportName");
      const row: Record<string, unknown> = {
        SECUCODE: "920000.BJ",
        REPORT_DATE: "2026-03-31",
      };
      if (reportName === "RPT_DMSK_FN_INCOME")
        row.PARENT_NETPROFIT = 13_002_262.53;
      if (reportName === "RPT_DMSK_FN_BALANCE") row.TOTAL_ASSETS = 500_000_000;
      if (reportName === "RPT_DMSK_FN_CASHFLOW")
        row.NETCASH_OPERATE = 8_000_000;
      return Response.json({ result: { data: [row] } });
    },
    now: () => new Date("2026-07-15T00:00:00.000Z"),
  });

  assert.deepEqual(filters, [
    '(SECUCODE="920000.BJ")',
    '(SECUCODE="920000.BJ")',
    '(SECUCODE="920000.BJ")',
  ]);
  assert.equal(
    (
      result.data as {
        statements?: { income?: { netProfit?: number } | null };
      } | null
    )?.statements?.income?.netProfit,
    13_002_262.53
  );
});

test("Eastmoney returns BSE shareholders instead of silently skipping them", async () => {
  const provider = createEastmoneyProvider();
  const instrument = makeInstrument(
    "CN",
    "920000",
    "BSE",
    "EQUITY",
    "CNY",
    "安徽凤凰"
  );
  let filter = "";
  const result = await provider.shareholders!(instrument, {
    fetch: async (input) => {
      const url = new URL(String(input));
      filter = url.searchParams.get("filter") ?? "";
      return Response.json({
        result: {
          data: [
            {
              SECUCODE: "920000.BJ",
              END_DATE: "2026-03-31",
              HOLDER_RANK: 1,
              HOLDER_NAME: "第一大流通股东",
              HOLD_NUM: 1_000_000,
              HOLD_RATIO: 10.5,
            },
          ],
        },
      });
    },
    now: () => new Date("2026-07-15T00:00:00.000Z"),
  });

  assert.equal(filter, '(SECUCODE="920000.BJ")');
  assert.equal(
    (result.data as { topHolders?: Array<{ name?: string }> } | null)
      ?.topHolders?.[0]?.name,
    "第一大流通股东"
  );
});

test("Eastmoney money flow uses the BSE market id", async () => {
  const provider = createEastmoneyProvider();
  const instrument = makeInstrument(
    "CN",
    "920000",
    "BSE",
    "EQUITY",
    "CNY",
    "安徽凤凰"
  );
  let requestedUrl = "";
  const result = await provider.moneyFlow!(instrument, {
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({
        data: {
          klines: ["2026-07-15,100,40,20,10,30,10,5,2,3,1,15.86,1.8"],
        },
      });
    },
    now: () => new Date("2026-07-15T00:00:00.000Z"),
  });

  assert.equal(new URL(requestedUrl).searchParams.get("secid"), "0.920000");
  assert.equal(
    (result.data as { series?: Array<{ mainNetInflow?: number }> } | null)
      ?.series?.[0]?.mainNetInflow,
    100
  );
});
