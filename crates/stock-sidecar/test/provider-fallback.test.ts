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
    ["throttled:snapshot", 100],
    ["throttled:snapshot", 100],
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
