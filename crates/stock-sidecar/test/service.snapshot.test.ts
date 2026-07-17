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

  assert.equal(result.status, "ok");
  assert.equal(result.data?.price, 1500.5);
  assert.equal(result.data?.instrument.name, "贵州茅台");
  assert.equal(result.data?.previousClose, 1490);
  assert.equal(result.data?.high, 1510);
  assert.equal(result.sources[0]?.provider, "tencent");
  assert.equal(result.asOf, "2026-07-15T10:30:00.000+08:00");
});

test("Tencent reports unknown freshness when the upstream quote time is missing", async () => {
  const body =
    'v_sh600519="1~贵州茅台~600519~1500.50~1490.00~1495.00~1000~~~~~~~~~~~~~~~~~~~~~~~10.50~0.70~1510.00~1488.00";';
  const service = createStockResearchService({
    fetch: async () => new Response(body, { status: 200 }),
    now: () => new Date("2026-07-15T02:30:01.000Z"),
  });

  const result = await service.snapshot({ instrument });

  assert.equal(result.status, "partial");
  assert.equal(result.data?.marketTime, "unknown");
  assert.equal(result.asOf, "unknown");
  assert.match(result.warnings.join("\n"), /时间|asOf|unknown/i);
});

test("maxAgeMs zero bypasses cache for the snapshot and requested supporting data", async () => {
  let price = 10;
  let historyReads = 0;
  let profileReads = 0;
  const provider: StockProvider = {
    id: "changing",
    priority: 1,
    capabilities: ["snapshot", "history", "profile"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: price++, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
    async history() {
      historyReads += 1;
      return {
        data: [
          {
            time: "2026-07-15",
            open: 10,
            high: 11,
            low: 9,
            close: 10,
          },
        ],
        asOf: "2026-07-15",
      };
    },
    async profile() {
      profileReads += 1;
      return {
        data: { industry: `sector-${profileReads}` },
        asOf: "2026-07-15",
      };
    },
  };
  const service = createStockResearchService({
    providers: [provider],
    throttleIntervalMs: 0,
  });
  const first = await service.snapshot({
    instrument,
    maxAgeMs: 60_000,
    includeHistory: true,
    includeProfile: true,
  });
  const second = await service.snapshot({
    instrument,
    maxAgeMs: 0,
    includeHistory: true,
    includeProfile: true,
  });
  assert.equal(first.data?.price, 10);
  assert.equal(second.data?.price, 11);
  assert.equal(historyReads, 2);
  assert.equal(profileReads, 2);
  assert.equal(
    (second.data?.profile as { industry: string }).industry,
    "sector-2"
  );
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

test("snapshot optionally merges bounded chart, profile, and derived metrics", async () => {
  const bars = Array.from({ length: 40 }, (_, index) => ({
    time: `2026-06-${String(index + 1).padStart(2, "0")}`,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
  }));
  const provider: StockProvider = {
    id: "bundle",
    priority: 1,
    capabilities: ["snapshot", "history", "profile"],
    async snapshot(ref) {
      return {
        data: {
          instrument: ref,
          price: 140,
          previousClose: 138,
          changePercent: 1.45,
          marketTime: "2026-07-15",
        },
        asOf: "2026-07-15",
      };
    },
    async history(_ref, request) {
      return { data: bars.slice(-(request.limit ?? 30)), asOf: "2026-06-30" };
    },
    async profile() {
      return {
        data: { industry: "白酒", marketCap: 1570000000000 },
        asOf: "2026-03-31",
      };
    },
  };
  const service = createStockResearchService({ providers: [provider] });

  const result = await service.snapshot({
    instrument,
    includeHistory: true,
    historyLimit: 30,
    includeProfile: true,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.data?.price, 140);
  assert.equal(result.data?.chart?.bars.length, 30);
  assert.equal((result.data?.profile as { industry: string }).industry, "白酒");
  assert.equal(result.data?.metrics?.periodReturnPercent, 26.13);
  assert.deepEqual(
    result.sources.map((source) => source.capability),
    ["snapshot", "history", "profile"]
  );
  assert.equal(
    result.asOf,
    "2026-03-31",
    "aggregate freshness must not hide an older profile behind a fresh quote"
  );
});
