import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService } from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

test("FX service deduplicates pairs and caches identical requests", async () => {
  let calls = 0;
  const provider: StockProvider = {
    id: "fx-test",
    priority: 1,
    capabilities: ["fxRates"],
    async fxRates(request) {
      calls += 1;
      return {
        data: request.pairs.map((pair) => ({
          ...pair,
          rate: 7.2,
          asOf: "2026-07-16T10:30:00+08:00",
        })),
        asOf: "2026-07-16T10:30:00+08:00",
      };
    },
  };
  const service = createStockResearchService({
    providers: [provider],
    now: () => new Date("2026-07-16T02:30:01.000Z"),
  });
  const request = {
    pairs: [
      { fromCurrency: "USD" as const, toCurrency: "CNY" as const },
      { fromCurrency: "USD" as const, toCurrency: "CNY" as const },
    ],
  };

  const first = await service.fxRates(request);
  const second = await service.fxRates(request);

  assert.equal(calls, 1);
  assert.equal(first.status, "ok");
  assert.equal(first.rates.length, 1);
  assert.deepEqual(second.rates, first.rates);
  assert.equal(second.cached, true);
  assert.equal(second.sources[0]?.cached, true);
  assert.equal(first.sources[0]?.provider, "fx-test");
  assert.equal(first.retrievedAt, "2026-07-16T02:30:01.000Z");
});

test("FX service reports partial and unavailable without inventing missing rates", async () => {
  const partialProvider: StockProvider = {
    id: "fx-partial",
    priority: 1,
    capabilities: ["fxRates"],
    async fxRates(request) {
      return {
        data: [{ ...request.pairs[0]!, rate: 7.2, asOf: "2026-07-16" }],
        asOf: "2026-07-16",
        warnings: ["second pair unavailable"],
      };
    },
  };
  const partial = await createStockResearchService({
    providers: [partialProvider],
  }).fxRates({
    pairs: [
      { fromCurrency: "USD", toCurrency: "CNY" },
      { fromCurrency: "HKD", toCurrency: "CNY" },
    ],
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.rates.length, 1);
  assert.match(partial.warnings.join("\n"), /second pair unavailable/);

  const unavailable = await createStockResearchService({
    providers: [],
  }).fxRates({
    pairs: [{ fromCurrency: "USD", toCurrency: "CNY" }],
  });
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(unavailable.rates, []);
  assert.equal(unavailable.sources.length, 0);
});
