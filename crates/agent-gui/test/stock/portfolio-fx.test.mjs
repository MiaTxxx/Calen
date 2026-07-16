import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mapStockFxRatesResult } from "../../src/lib/stock-research/contracts.ts";
import {
  evidenceFxRates,
  mergePortfolioFxRates,
  requiredPortfolioFxPairs,
} from "../../src/pages/stock-hub/portfolioFx.ts";

test("portfolio FX requests only required currencies and manual rates override automatic rates", () => {
  const pairs = requiredPortfolioFxPairs(
    [
      { currency: "USD", costBasis: 1, realizedPnl: 0 },
      { currency: "USD", costBasis: 2, realizedPnl: 0 },
      { currency: "HKD", costBasis: 3, realizedPnl: 0 },
      { currency: "CNY", costBasis: 4, realizedPnl: 0 },
    ],
    "CNY"
  );
  assert.deepEqual(pairs, [
    { fromCurrency: "USD", toCurrency: "CNY" },
    { fromCurrency: "HKD", toCurrency: "CNY" },
  ]);

  const automatic = [
    { fromCurrency: "USD", toCurrency: "CNY", rate: 7.2, asOf: "auto" },
    { fromCurrency: "HKD", toCurrency: "CNY", rate: 0.92, asOf: "auto" },
  ];
  const manual = [
    { fromCurrency: "USD", toCurrency: "CNY", rate: 7.3, asOf: "manual" },
  ];
  assert.deepEqual(mergePortfolioFxRates(automatic, manual), [
    { fromCurrency: "USD", toCurrency: "CNY", rate: 7.3, asOf: "manual" },
    { fromCurrency: "HKD", toCurrency: "CNY", rate: 0.92, asOf: "auto" },
  ]);
});

test("FX contract preserves evidence and rejects invalid rates", () => {
  const result = mapStockFxRatesResult({
    status: "partial",
    rates: [
      { fromCurrency: "USD", toCurrency: "CNY", rate: 7.2, asOf: "2026-07-16" },
      { fromCurrency: "USD", toCurrency: "HKD", rate: -1, asOf: "2026-07-16" },
    ],
    sources: [
      {
        id: "tencent-fx",
        name: "tencent-fx",
        provider: "tencent-fx",
        asOf: "2026-07-16",
        retrievedAt: "2026-07-16T02:00:00Z",
        cached: true,
      },
    ],
    asOf: "2026-07-16",
    retrievedAt: "2026-07-16T02:00:00Z",
    cached: true,
    warnings: ["USD/HKD unavailable"],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.rates.length, 1);
  assert.equal(result.sources[0]?.provider, "tencent-fx");
  assert.equal(result.cached, true);
  assert.deepEqual(evidenceFxRates(result), [
    { fromCurrency: "USD", toCurrency: "CNY", rate: 7.2, asOf: "2026-07-16" },
  ]);
});

test("FX stays behind the StockResearchManager and is not exposed as an AI tool", async () => {
  const [adapter, rustCommands, rustLib, tools] = await Promise.all([
    readFile(
      new URL("../../src/lib/stock-research/tauri.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL(
        "../../src-tauri/src/commands/integration/stock.rs",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(
      new URL("../../src/lib/tools/stockResearchTools.ts", import.meta.url),
      "utf8"
    ),
  ]);
  assert.match(adapter, /"stock_research_fx_rates"/);
  assert.match(
    rustCommands,
    /invoke_stock_method\(app, state, "fxRates", request\)/
  );
  assert.match(rustLib, /commands::stock::stock_research_fx_rates/);
  assert.doesNotMatch(tools, /StockFxRates/);
});
