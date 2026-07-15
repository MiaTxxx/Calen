import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portsSource = await readFile(
  new URL(
    "../../src-tauri/src/commands/stock_portfolio/ports.rs",
    import.meta.url
  ),
  "utf8"
);

function traitBody(name) {
  const match = portsSource.match(
    new RegExp(`pub trait ${name}[^\\{]*\\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(match, `missing Rust trait ${name}`);
  return match[1];
}

test("future broker seam is read-only and cannot place orders or mutate the ledger", () => {
  const body = traitBody("BrokerPortfolioImportPort");
  assert.match(body, /read_import_batch/);
  assert.doesNotMatch(
    body,
    /order|trade|transfer|record_transaction|restore/iu
  );
  assert.doesNotMatch(portsSource, /#\[tauri::command\]/);
});

test("future Gateway sync seam transports ciphertext envelopes only", () => {
  const body = traitBody("EncryptedPortfolioSyncTransportPort");
  assert.match(body, /EncryptedPortfolioSyncEnvelope/);
  assert.doesNotMatch(
    body,
    /PortfolioSyncPlaintext|PortfolioSyncKeyRef|StockPortfolioBackup/
  );
  assert.match(
    portsSource,
    /intentionally has no Serde implementation[\s\S]*pub struct BrokerCredentialRef/
  );
  assert.match(
    portsSource,
    /has no Serde implementation[\s\S]*pub struct PortfolioSyncKeyRef/
  );
});
