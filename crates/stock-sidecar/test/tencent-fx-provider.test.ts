import assert from "node:assert/strict";
import test from "node:test";

import { createTencentFxProvider } from "../src/index.ts";

test("Tencent FX batches direct pairs and derives supported reverse rates", async () => {
  const provider = createTencentFxProvider();
  const requests: string[] = [];
  const result = await provider.fxRates!(
    {
      pairs: [
        { fromCurrency: "USD", toCurrency: "CNY" },
        { fromCurrency: "CNY", toCurrency: "USD" },
        { fromCurrency: "USD", toCurrency: "HKD" },
        { fromCurrency: "HKD", toCurrency: "CNY" },
        { fromCurrency: "USD", toCurrency: "CNY" },
      ],
    },
    {
      fetch: async (input) => {
        requests.push(String(input));
        return new Response(
          [
            'v_whUSDCNY="1~美元人民币~USDCNY~7.2000~0~20260716103000";',
            'v_whUSDHKD="1~美元港币~USDHKD~7.8000~0~20260716103001";',
            'v_whHKDCNY="1~港币人民币~HKDCNY~0.9200~0~20260716103002";',
          ].join("\n")
        );
      },
      now: () => new Date("2026-07-16T02:30:03.000Z"),
    }
  );

  assert.equal(requests.length, 1);
  assert.match(requests[0] ?? "", /whUSDCNY,whUSDHKD,whHKDCNY/);
  assert.equal(result.data?.length, 4);
  assert.equal(result.data?.[0]?.rate, 7.2);
  assert.equal(result.data?.[1]?.rate, 1 / 7.2);
  assert.equal(result.data?.[2]?.rate, 7.8);
  assert.equal(result.data?.[3]?.rate, 0.92);
  assert.equal(result.data?.[3]?.asOf, "2026-07-16T10:30:02.000+08:00");
  assert.equal(result.asOf, "2026-07-16T10:30:00.000+08:00");
  assert.deepEqual(result.warnings, undefined);
});

test("Tencent FX returns only observed rates and warns about missing pairs", async () => {
  const provider = createTencentFxProvider();
  const result = await provider.fxRates!(
    {
      pairs: [
        { fromCurrency: "USD", toCurrency: "CNY" },
        { fromCurrency: "USD", toCurrency: "HKD" },
      ],
    },
    {
      fetch: async () =>
        new Response('v_whUSDCNY="1~美元人民币~USDCNY~7.2~0~20260716103000";'),
      now: () => new Date("2026-07-16T02:30:03.000Z"),
    }
  );

  assert.deepEqual(
    result.data?.map(({ fromCurrency, toCurrency }) => [
      fromCurrency,
      toCurrency,
    ]),
    [["USD", "CNY"]]
  );
  assert.match(result.warnings?.join("\n") ?? "", /USD\/HKD/);
});

test("Tencent FX marks missing quote time as unknown", async () => {
  const result = await createTencentFxProvider().fxRates!(
    { pairs: [{ fromCurrency: "USD", toCurrency: "CNY" }] },
    {
      fetch: async () =>
        new Response('v_whUSDCNY="1~美元人民币~USDCNY~7.2~0~";'),
      now: () => new Date("2026-07-16T02:30:03.000Z"),
    }
  );

  assert.equal(result.data?.[0]?.asOf, "unknown");
  assert.equal(result.asOf, "unknown");
  assert.match(result.warnings?.join("\n") ?? "", /时间|unknown/i);
});
