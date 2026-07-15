import assert from "node:assert/strict";
import test from "node:test";

import {
  createStockResearchServiceFromEnvironment,
  loadStockRuntimeConfig,
} from "../src/index.ts";

test("runtime settings filter providers and never expose provider keys in status", async () => {
  const env = {
    CALEN_STOCK_SETTINGS: JSON.stringify({
      enabled: true,
      timeoutMs: 2500,
      cacheTtlMinutes: 12,
      providers: [
        { id: "tencent", enabled: false },
        { id: "eastmoney", enabled: true },
        { id: "sinafinance", enabled: true },
        { id: "baostock", enabled: false },
      ],
    }),
    CALEN_STOCK_PROVIDER_KEYS: JSON.stringify({
      tushare: "top-secret",
      zzshare: "also-secret",
    }),
  };
  const config = loadStockRuntimeConfig(env);
  assert.equal(config.timeoutMs, 2500);
  assert.equal(config.cacheTtlMs, 12 * 60_000);
  assert.deepEqual(config.enabledProviderIds, ["eastmoney", "sinafinance"]);
  assert.equal(config.providerKeys.tushare, "top-secret");

  const service = createStockResearchServiceFromEnvironment(env);
  const status = await service.status();
  const byId = Object.fromEntries(
    status.providers.map((provider) => [provider.id, provider])
  );
  assert.equal(byId.eastmoney?.state, "ready");
  assert.equal(byId.tencent?.state, "disabled");
  assert.equal(byId.sinafinance?.state, "ready");
  assert.equal(byId.sinafinance?.available, true);
  assert.doesNotMatch(JSON.stringify(status), /top-secret|also-secret/);
});

test("implemented Sinafinance remains disabled until explicitly enabled", () => {
  const config = loadStockRuntimeConfig({});
  assert.deepEqual(config.enabledProviderIds, ["tencent", "eastmoney"]);
  const sina = config.providerCatalog.find(
    (provider) => provider.id === "sinafinance"
  );
  assert.equal(sina?.state, "disabled");
  assert.equal(sina?.configured, true);
  assert.equal(sina?.available, false);
});

test("implemented BaoStock remains disabled until explicitly enabled", async () => {
  const defaults = loadStockRuntimeConfig({});
  assert.deepEqual(defaults.enabledProviderIds, ["tencent", "eastmoney"]);
  const disabled = defaults.providerCatalog.find(
    (provider) => provider.id === "baostock"
  );
  assert.equal(disabled?.state, "disabled");
  assert.equal(disabled?.configured, true);

  const env = {
    CALEN_STOCK_SETTINGS: JSON.stringify({
      providers: [{ id: "baostock", enabled: true }],
    }),
  };
  const enabled = loadStockRuntimeConfig(env);
  assert.deepEqual(enabled.enabledProviderIds, [
    "tencent",
    "eastmoney",
    "baostock",
  ]);
  const status = await createStockResearchServiceFromEnvironment(env).status();
  assert.equal(
    status.providers.find((provider) => provider.id === "baostock")?.state,
    "ready"
  );
});
