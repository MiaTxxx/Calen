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
  assert.deepEqual(config.enabledProviderIds, ["eastmoney"]);
  assert.equal(config.providerKeys.tushare, "top-secret");

  const service = createStockResearchServiceFromEnvironment(env);
  const status = await service.status();
  const byId = Object.fromEntries(
    status.providers.map((provider) => [provider.id, provider])
  );
  assert.equal(byId.eastmoney?.state, "ready");
  assert.equal(byId.tencent?.state, "disabled");
  assert.equal(byId.sinafinance?.state, "unconfigured");
  assert.equal(byId.sinafinance?.available, false);
  assert.match(byId.sinafinance?.warnings?.join("\n") ?? "", /尚未实现/);
  assert.doesNotMatch(JSON.stringify(status), /top-secret|also-secret/);
});
