import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("portfolio workspace wires the complete local ledger surface", async () => {
  const adapter = await readFile(
    new URL("../../src/lib/stock-research/tauri.ts", import.meta.url),
    "utf8"
  );
  const workspace = await readFile(
    new URL(
      "../../src/pages/stock-hub/PortfolioWorkspace.tsx",
      import.meta.url
    ),
    "utf8"
  );

  for (const command of [
    "ui_stock_watchlist_create",
    "ui_stock_watchlist_list",
    "ui_stock_watchlist_add_item",
    "ui_stock_watchlist_remove_item",
    "ui_stock_portfolio_create",
    "ui_stock_portfolio_record_transaction",
    "ui_stock_portfolio_delete_transaction",
    "ui_stock_portfolio_list_transactions",
    "ui_stock_portfolio_snapshot",
    "ui_stock_portfolio_import_csv",
    "ui_stock_portfolio_export_csv",
  ]) {
    assert.match(adapter, new RegExp(`"${command}"`));
  }

  for (const kind of [
    "BUY",
    "SELL",
    "FEE",
    "DIVIDEND",
    "SPLIT",
    "ADJUSTMENT",
  ]) {
    assert.match(workspace, new RegExp(`value: "${kind}"`));
  }
  assert.match(workspace, /stockResearch\.snapshot\(/);
  assert.match(
    workspace,
    /stockResearch[\s\S]*?\.fxRates\(\{ pairs: fxPairs \}\)/
  );
  assert.match(
    workspace,
    /mergePortfolioFxRates\(automaticFxRates, savedManualFxRates\)/
  );
  assert.match(workspace, /自动汇率不可用：[\s\S]*?原币分析仍然有效/);
  assert.match(workspace, /应用手工汇率（覆盖自动值）/);
  assert.match(
    workspace,
    /stockResearch\.portfolioAnalyze\(portfolioId, prices, fxRates\)/
  );
  assert.match(workspace, /fxAsOf/);
  assert.match(workspace, /自选分组/);
  assert.match(workspace, /完整交易流水/);
  assert.match(workspace, /密码保护的备份与恢复/);
});

test("portfolio CSV import always targets the selected portfolio", async () => {
  const workspace = await readFile(
    new URL(
      "../../src/pages/stock-hub/PortfolioWorkspace.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(workspace, /portfolioImportCsvTo\(portfolio\.id, csv\)/);
  assert.doesNotMatch(workspace, /portfolioImportCsv\(csv\)/);
});

test("watchlist search ignores stale responses", async () => {
  const workspace = await readFile(
    new URL(
      "../../src/pages/stock-hub/PortfolioWorkspace.tsx",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(workspace, /const watchSearchSequence = useRef\(0\)/);
  assert.match(workspace, /const sequence = \+\+watchSearchSequence\.current/);
  assert.match(
    workspace,
    /if \(sequence !== watchSearchSequence\.current\) return/
  );
});

test("portfolio actions synchronously reject duplicate CSV submissions", async () => {
  const workspace = await readFile(
    new URL(
      "../../src/pages/stock-hub/PortfolioWorkspace.tsx",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    workspace,
    /const busyActionRef = useRef<string \| null>\(null\)/
  );
  assert.match(workspace, /if \(busyActionRef\.current\) return/);
  assert.match(
    workspace,
    /disabled=\{!portfolio \|\| !csv\.trim\(\) \|\| busy !== null\}/
  );
});

test("portfolio instrument inference keeps Shanghai ETFs on SSE", async () => {
  const workspace = await readFile(
    new URL(
      "../../src/pages/stock-hub/PortfolioWorkspace.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(
    workspace,
    /symbol\.startsWith\("5"\) \|\| symbol\.startsWith\("6"\)/
  );
});
