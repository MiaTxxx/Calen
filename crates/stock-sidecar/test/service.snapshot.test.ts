import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");

test("snapshot returns normalized Tencent evidence without requiring an API key", async () => {
  const body =
    'v_sh600519="1~贵州茅台~600519~1500.50~1490.00~1495.00~1000~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260715103000~10.50~0.70~1510.00~1488.00";';
  const service = createStockResearchService({
    fetch: async () => new Response(body, { status: 200 }),
    now: () => new Date("2026-07-15T02:30:01.000Z"),
  });

  const result = await service.snapshot({ instrument });

  assert.equal(result.status, "complete");
  assert.equal(result.data?.price, 1500.5);
  assert.equal(result.data?.instrument.name, "贵州茅台");
  assert.equal(result.data?.previousClose, 1490);
  assert.equal(result.data?.high, 1510);
  assert.equal(result.sources[0]?.provider, "tencent");
  assert.equal(result.asOf, "2026-07-15T10:30:00.000+08:00");
});

test("maxAgeMs zero bypasses an existing snapshot cache", async () => {
  let price = 10;
  const provider: StockProvider = {
    id: "changing",
    priority: 1,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: price++, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  };
  const service = createStockResearchService({ providers: [provider] });
  const first = await service.snapshot({ instrument, maxAgeMs: 60_000 });
  const second = await service.snapshot({ instrument, maxAgeMs: 0 });
  assert.equal(first.data?.price, 10);
  assert.equal(second.data?.price, 11);
  assert.equal(second.cached, false);
});

test("snapshot reports unavailable when every network provider fails", async () => {
  const service = createStockResearchService({
    fetch: async () => {
      throw new TypeError("offline");
    },
    now: () => new Date("2026-07-15T02:30:01.000Z"),
  });

  const result = await service.snapshot({ instrument });

  assert.equal(result.status, "unavailable");
  assert.equal(result.data, undefined);
  assert.match(result.warnings.join("\n"), /offline/);
  assert.equal(result.sources.length, 0);
});
