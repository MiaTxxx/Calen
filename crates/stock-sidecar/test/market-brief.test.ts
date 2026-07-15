import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService } from "../src/index.ts";

test("marketBrief normalizes Eastmoney movers with source and time metadata", async () => {
  const payload = {
    data: {
      diff: [
        {
          f12: "600519",
          f14: "贵州茅台",
          f2: 1500,
          f3: 2.5,
          f4: 36.59,
          f5: 12345,
          f6: 987654321,
        },
      ],
    },
  };
  const service = createStockResearchService({
    fetch: async () => Response.json(payload),
    now: () => new Date("2026-07-15T07:00:00.000Z"),
  });

  const result = await service.marketBrief({ market: "CN", limit: 5 });

  assert.equal(result.status, "complete");
  assert.equal(result.sources[0]?.provider, "eastmoney");
  assert.deepEqual(result.data, {
    market: "CN",
    movers: [
      {
        symbol: "600519",
        name: "贵州茅台",
        price: 1500,
        change: 36.59,
        changePercent: 2.5,
        volume: 12345,
        turnover: 987654321,
      },
    ],
  });
});
