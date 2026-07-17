import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryThrottleStore,
  ProviderError,
  ProviderRegistry,
  makeInstrument,
} from "../src/index.ts";
import type { StockProvider } from "../src/index.ts";

const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");

test("snapshot falls back, caches the successful evidence, and exposes provider health", async () => {
  let nowMs = Date.parse("2026-07-15T01:00:00.000Z");
  let fallbackReads = 0;
  const primary: StockProvider = {
    id: "primary",
    priority: 10,
    free: true,
    capabilities: ["snapshot"],
    async snapshot() {
      throw new ProviderError("upstream denied", { status: 429 });
    },
  };
  const fallback: StockProvider = {
    id: "fallback",
    priority: 20,
    free: true,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      fallbackReads += 1;
      return {
        data: {
          instrument: ref,
          price: 1500,
          marketTime: "2026-07-15T01:00:00.000Z",
        },
        asOf: "2026-07-15T01:00:00.000Z",
      };
    },
  };
  const registry = new ProviderRegistry([primary, fallback], {
    now: () => new Date(nowMs),
    cacheTtlMs: 5_000,
    failureThreshold: 1,
    cooldownBaseMs: 60_000,
  });

  const first = await registry.query(
    "snapshot",
    instrument.id,
    (provider, context) => provider.snapshot!(instrument, context)
  );
  const second = await registry.query(
    "snapshot",
    instrument.id,
    (provider, context) => provider.snapshot!(instrument, context)
  );

  assert.equal(first.source?.provider, "fallback");
  assert.equal(first.cached, false);
  assert.match(first.warnings.join("\n"), /primary/);
  assert.equal(second.cached, true);
  assert.equal(fallbackReads, 1);
  assert.equal(
    registry.status().find((item) => item.id === "fallback")?.lastSuccessAt,
    "2026-07-15T01:00:00.000Z"
  );
  const primaryStatus = registry.status().find((item) => item.id === "primary");
  assert.equal(primaryStatus?.available, false);
  assert.equal(primaryStatus?.consecutiveFailures, 1);
  assert.equal(primaryStatus?.cooldownUntil, "2026-07-15T01:01:00.000Z");

  nowMs += 61_000;
  assert.equal(
    registry.status().find((item) => item.id === "primary")?.available,
    true
  );
});

test("provider timeout falls back even when the provider ignores AbortSignal", async () => {
  const stalled: StockProvider = {
    id: "stalled",
    priority: 1,
    capabilities: ["snapshot"],
    async snapshot() {
      return await new Promise(() => undefined);
    },
  };
  const fallback: StockProvider = {
    id: "fast",
    priority: 2,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 10, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  };
  const registry = new ProviderRegistry([stalled, fallback], { timeoutMs: 5 });

  const result = await registry.query(
    "snapshot",
    "timeout",
    (provider, context) => provider.snapshot!(instrument, context)
  );

  assert.equal(result.source?.provider, "fast");
  assert.match(result.warnings.join("\n"), /timeout/i);
});

test("capability misses do not consume the fallback budget before a fourth provider", async () => {
  const providers: StockProvider[] = [1, 2, 3].map((index) => ({
    id: `unsupported-${index}`,
    priority: index,
    capabilities: ["snapshot"],
    async snapshot() {
      return {
        data: null,
        asOf: "2026-07-15",
        warnings: ["当前市场不受支持"],
      };
    },
  }));
  providers.push({
    id: "fourth-provider",
    priority: 4,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 10, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  });
  const registry = new ProviderRegistry(providers, {
    maxAttempts: 3,
    throttleIntervalMs: 0,
  });

  const result = await registry.query(
    "snapshot",
    instrument.id,
    (provider, context) => provider.snapshot!(instrument, context)
  );

  assert.equal(result.source?.provider, "fourth-provider");
  assert.equal(
    registry.status().find((item) => item.id === "unsupported-1")
      ?.consecutiveFailures,
    0
  );
});

test("three failed providers still allow a fourth provider to recover the request", async () => {
  const providers: StockProvider[] = [1, 2, 3].map((index) => ({
    id: `failed-${index}`,
    priority: index,
    capabilities: ["snapshot"],
    async snapshot() {
      throw new Error(`failure-${index}`);
    },
  }));
  providers.push({
    id: "fourth-recovery",
    priority: 4,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 10, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  });
  const registry = new ProviderRegistry(providers, {
    maxAttempts: 3,
    throttleIntervalMs: 0,
  });

  const result = await registry.query(
    "snapshot",
    instrument.id,
    (provider, context) => provider.snapshot!(instrument, context)
  );

  assert.equal(result.source?.provider, "fourth-recovery");
  assert.match(result.warnings.join("\n"), /failure-1/);
  assert.match(result.warnings.join("\n"), /failure-3/);
});

test("provider health is isolated by capability and market", async () => {
  let snapshotReads = 0;
  const provider: StockProvider = {
    id: "scoped-provider",
    priority: 1,
    capabilities: ["snapshot", "history"],
    async snapshot(ref) {
      snapshotReads += 1;
      if (ref.market === "HK") throw new ProviderError("HK route failed");
      return {
        data: { instrument: ref, price: 10, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
    async history() {
      throw new ProviderError("history route failed");
    },
  };
  const registry = new ProviderRegistry([provider], {
    failureThreshold: 1,
    throttleIntervalMs: 0,
  });
  await registry.query("history", instrument.id, (candidate, context) =>
    candidate.history!(instrument, { limit: 20 }, context)
  );
  const afterCapabilityFailure = await registry.query(
    "snapshot",
    instrument.id,
    (candidate, context) => candidate.snapshot!(instrument, context)
  );
  const hkInstrument = makeInstrument("HK", "00700", "HKEX", "EQUITY", "HKD");
  await registry.query("snapshot", hkInstrument.id, (candidate, context) =>
    candidate.snapshot!(hkInstrument, context)
  );
  const afterMarketFailure = await registry.query(
    "snapshot",
    "CN:000001",
    (candidate, context) =>
      candidate.snapshot!(
        makeInstrument("CN", "000001", "SZSE", "EQUITY", "CNY"),
        context
      )
  );

  assert.equal(afterCapabilityFailure.source?.provider, "scoped-provider");
  assert.equal(afterMarketFailure.source?.provider, "scoped-provider");
  assert.equal(snapshotReads, 3);
});

test("different capabilities from one provider share upstream concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const read = async <T>(data: T) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { data, asOf: "2026-07-15" };
  };
  const provider: StockProvider = {
    id: "shared-upstream",
    priority: 1,
    capabilities: ["snapshot", "history"],
    snapshot: async (ref) =>
      read({ instrument: ref, price: 10, marketTime: "2026-07-15" }),
    history: async () => read([]),
  };
  const registry = new ProviderRegistry([provider], {
    throttleIntervalMs: 0,
  });

  await Promise.all([
    registry.query("snapshot", instrument.id, (candidate, context) =>
      candidate.snapshot!(instrument, context)
    ),
    registry.query("history", instrument.id, (candidate, context) =>
      candidate.history!(instrument, { limit: 20 }, context)
    ),
  ]);

  assert.equal(maximumActive, 1);
});

test("provider throttle is injectable and aborts while waiting", async () => {
  const calls: Array<[string, number]> = [];
  const store = new MemoryThrottleStore();
  const provider: StockProvider = {
    id: "throttled",
    priority: 1,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      return {
        data: { instrument: ref, price: 10, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  };
  const registry = new ProviderRegistry([provider], {
    throttleStore: {
      acquire(key, intervalMs, signal) {
        calls.push([key, intervalMs]);
        return store.acquire(key, intervalMs, signal);
      },
      release(key) {
        store.release(key);
      },
    },
    throttleIntervalMs: 100,
  });
  await registry.query("snapshot", "first", (candidate, context) =>
    candidate.snapshot!(instrument, context)
  );
  const controller = new AbortController();
  const pending = registry.query(
    "snapshot",
    "second",
    (candidate, context) => candidate.snapshot!(instrument, context),
    controller.signal
  );
  setTimeout(
    () => controller.abort(new Error("cancelled while throttled")),
    10
  );
  await assert.rejects(pending, /cancelled while throttled/);
  assert.deepEqual(calls, [
    ["throttled", 100],
    ["throttled", 100],
  ]);
});

test("provider timeout interrupts a throttle wait before another upstream call", async () => {
  let upstreamCalls = 0;
  const provider: StockProvider = {
    id: "paced",
    priority: 1,
    capabilities: ["snapshot"],
    async snapshot(ref) {
      upstreamCalls += 1;
      return {
        data: { instrument: ref, price: 10, marketTime: "2026-07-15" },
        asOf: "2026-07-15",
      };
    },
  };
  const registry = new ProviderRegistry([provider], {
    throttleIntervalMs: 100,
    timeoutMs: 5,
  });
  await registry.query("snapshot", "first", (candidate, context) =>
    candidate.snapshot!(instrument, context)
  );
  const result = await registry.query(
    "snapshot",
    "second",
    (candidate, context) => candidate.snapshot!(instrument, context)
  );
  assert.equal(result.data, null);
  assert.equal(upstreamCalls, 1);
  assert.match(result.warnings.join("\n"), /timeout/i);
  assert.equal(registry.status()[0]?.consecutiveFailures, 0);
});
