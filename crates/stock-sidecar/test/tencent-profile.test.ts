import assert from "node:assert/strict";
import test from "node:test";

import {
  createTencentBasicProfileProvider,
  makeInstrument,
} from "../src/index.ts";

test("Tencent provides normalized company profile fields for US instruments", async () => {
  const provider = createTencentBasicProfileProvider();
  const instrument = makeInstrument(
    "US",
    "AAPL",
    "US",
    "EQUITY",
    "USD",
    "Apple"
  );
  const result = await provider.profile!(instrument, {
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/ifzqgtimg/appstock/us/introduce/brief");
      assert.equal(url.searchParams.get("symbol"), "usAAPL");
      return Response.json({
        code: 0,
        data: {
          jbxx: {
            gsmc: "Apple Inc.",
            ssrq: "1980-12-12",
            jys: "NASDAQ",
            website: "https://www.apple.com",
            industry: { code: "571060", name: "Technology Hardware" },
            jianjie: "Designs and sells consumer devices.",
            zgb: "15000000000",
          },
          srgc: [
            {
              date: "2025-09-30",
              currency: "USD",
              detail: [{ label: "iPhone", sales: "100", zb: "50%" }],
            },
          ],
        },
      });
    },
    now: () => new Date("2026-07-15T10:00:00.000Z"),
  });

  assert.equal((result.data as { symbol: string }).symbol, "AAPL");
  assert.equal((result.data as { name: string }).name, "Apple Inc.");
  assert.equal(
    (result.data as { coverage: string }).coverage,
    "company-profile"
  );
  assert.equal(
    (result.data as { industry: string }).industry,
    "Technology Hardware"
  );
  assert.equal(
    (result.data as { listingDate: string }).listingDate,
    "1980-12-12"
  );
  assert.equal(result.asOf, "unknown");
  assert.match(result.warnings?.[0] ?? "", /asOf 标记为 unknown/);
});

test("Tencent provides business and listing profile fields for HK instruments", async () => {
  const provider = createTencentBasicProfileProvider();
  const instrument = makeInstrument(
    "HK",
    "00700",
    "HKEX",
    "EQUITY",
    "HKD",
    "腾讯控股"
  );
  const result = await provider.profile!(instrument, {
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(
        url.pathname,
        "/ifzqgtimg/appstock/app/hkStockinfo/jiankuang"
      );
      assert.equal(url.searchParams.get("code"), "hk00700");
      return Response.json({
        code: 0,
        data: {
          basic: {
            ChiName: "腾讯控股",
            Website: "https://www.tencent.com",
            Business: "互联网增值服务",
            BriefIntroduction: "提供通信及数字内容服务。",
            Chairman: "示例主席",
            ListedDate: "2004-06-16",
            STOCK_SUM: "100",
            HK_STOCK_SUM: "99",
            plate: [{ name: "软件服务" }],
          },
        },
      });
    },
    now: () => new Date("2026-07-15T10:00:00.000Z"),
  });

  assert.equal(
    (result.data as { business: string }).business,
    "互联网增值服务"
  );
  assert.equal((result.data as { industry: string }).industry, "软件服务");
  assert.equal(
    (result.data as { listingDate: string }).listingDate,
    "2004-06-16"
  );
  assert.equal(result.asOf, "unknown");
});
