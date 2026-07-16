import assert from "node:assert/strict";
import test from "node:test";

import { createTencentProvider } from "../src/index.ts";

const now = () => new Date("2026-07-16T03:00:00.000Z");

test("Tencent fuzzy search respects an HK market hint and filters unsupported products", async () => {
  const provider = createTencentProvider();
  let requestedUrl = "";

  const result = await provider.resolve!(
    { query: "腾讯", market: "HK", limit: 3 },
    {
      fetch: async (url) => {
        requestedUrl = String(url);
        return Response.json({
          stock: [
            { code: "hk00700", name: "腾讯控股", type: "GP" },
            { code: "usTCEHY.PS", name: "腾讯控股(ADR)", type: "GP" },
            { code: "hk28000", name: "腾讯摩通六十购B", type: "QZ" },
          ],
        });
      },
      now,
    }
  );

  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://proxy.finance.qq.com");
  assert.equal(url.pathname, "/cgi/cgi-bin/smartbox/search");
  assert.equal(url.searchParams.get("query"), "腾讯");
  assert.deepEqual(result.data, [
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
  assert.equal(result.asOf, "2026-07-16T03:00:00.000Z");
  assert.match(result.warnings?.join("\n") ?? "", /港美股.*基础研究/);
});
