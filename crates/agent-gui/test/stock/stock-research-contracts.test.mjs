import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSparklinePath,
  formatStockError,
  isStockResultStatus,
  normalizeWarnings,
  parseFiniteNumber,
  sanitizeCsvFileName,
} from "../../src/lib/stock-research/contracts.ts";

test("stock result status only accepts the public evidence states", () => {
  assert.equal(isStockResultStatus("ok"), true);
  assert.equal(isStockResultStatus("partial"), true);
  assert.equal(isStockResultStatus("unavailable"), true);
  assert.equal(isStockResultStatus("loading"), false);
});

test("contract helpers reject invalid data instead of inventing values", () => {
  assert.deepEqual(normalizeWarnings(["限流", "", 3, null, "数据延迟"]), [
    "限流",
    "数据延迟",
  ]);
  assert.equal(parseFiniteNumber("20"), 20);
  assert.equal(parseFiniteNumber("Infinity"), null);
  assert.equal(parseFiniteNumber(""), null);
  assert.equal(formatStockError({}), "股票服务暂时不可用，请稍后重试。");
});

test("sparkline path is deterministic and rejects non-finite series", () => {
  assert.equal(
    buildSparklinePath([1, 2, 3], 100, 50),
    "M0.00,50.00 L50.00,25.00 L100.00,0.00"
  );
  assert.equal(buildSparklinePath([1, Number.NaN], 100, 50), "");
});

test("CSV export filenames cannot escape into a path", () => {
  assert.equal(sanitizeCsvFileName("组合/2026:Q3.csv"), "组合-2026-Q3.csv");
  assert.equal(sanitizeCsvFileName("***"), "---");
});

test("Tauri adapter exposes only the agreed high-level commands", async () => {
  const source = await readFile(
    new URL("../../src/lib/stock-research/tauri.ts", import.meta.url),
    "utf8"
  );
  for (const command of [
    "stock_research_resolve",
    "stock_research_snapshot",
    "stock_research_run",
    "stock_research_market_brief",
    "stock_research_backtest",
    "stock_research_status",
    "stock_settings_get",
    "stock_settings_save",
    "stock_portfolio_read",
    "stock_portfolio_import_csv",
    "stock_portfolio_export_csv",
  ])
    assert.match(source, new RegExp(`"${command}"`));
  assert.doesNotMatch(source, /http:\/\/|https:\/\//);
});

test("stock hub keeps the five product views", async () => {
  const source = await readFile(
    new URL("../../src/pages/stock-hub/StockHubPage.tsx", import.meta.url),
    "utf8"
  );
  for (const view of ["research", "market", "portfolio", "lab", "sources"]) {
    assert.match(source, new RegExp(`value: "${view}"`));
  }
  assert.match(source, /不构成投资建议/);
  assert.match(source, /已保存的 Key 永不回显/);
  assert.match(source, /autoComplete="new-password"/);
  assert.doesNotMatch(source, /value=\{provider\.key/);
});
