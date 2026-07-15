import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService } from "../src/index.ts";

test("resolve normalizes an A-share code into a stable InstrumentRef", async () => {
  const service = createStockResearchService({ providers: [] });

  const result = await service.resolve({ query: "600519" });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.instruments, [
    {
      id: "CN:600519",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
      symbol: "600519",
      name: "600519",
    },
  ]);
  assert.equal(result.sources[0]?.provider, "calen-symbol-resolver");
  assert.equal(result.cached, false);
  assert.deepEqual(result.warnings, []);
});

test("resolve keeps Beijing Stock Exchange codes out of the Shanghai route", async () => {
  const service = createStockResearchService({ providers: [] });
  const result = await service.resolve({ query: "832000" });
  assert.equal(result.instruments[0]?.exchange, "BSE");
});
