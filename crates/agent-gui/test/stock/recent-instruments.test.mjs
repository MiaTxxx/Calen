import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { readStockHubSource } from "../helpers/stock-hub-source.mjs";

const loader = createTsModuleLoader();
const {
  RECENT_INSTRUMENTS_LIMIT,
  RECENT_INSTRUMENTS_STORAGE_KEY,
  clearRecentInstruments,
  loadRecentInstruments,
  parseRecentInstruments,
  pushRecentInstrument,
  saveRecentInstruments,
} = loader.loadModule("src/lib/stock-research/recentInstruments.ts");

function instrument(id, overrides = {}) {
  return {
    id,
    symbol: id.split(":")[1] ?? id,
    name: `标的 ${id}`,
    market: "CN",
    exchange: "SSE",
    assetType: "stock",
    currency: "CNY",
    ...overrides,
  };
}

test("parseRecentInstruments drops corrupted payloads and malformed entries", () => {
  assert.deepEqual(parseRecentInstruments(null), []);
  assert.deepEqual(parseRecentInstruments("not json"), []);
  assert.deepEqual(parseRecentInstruments('{"a":1}'), []);

  const parsed = parseRecentInstruments(
    JSON.stringify([
      instrument("CN:600519"),
      { id: "missing-fields" },
      instrument("CN:600519"),
      instrument("HK:00700", {
        market: "HK",
        exchange: "HKEX",
        currency: "HKD",
      }),
      instrument("BAD:market", { market: "MARS" }),
    ])
  );
  assert.deepEqual(
    parsed.map((item) => item.id),
    ["CN:600519", "HK:00700"]
  );
});

test("parseRecentInstruments enforces the history limit", () => {
  const raw = JSON.stringify(
    Array.from({ length: RECENT_INSTRUMENTS_LIMIT + 5 }, (_, index) =>
      instrument(`CN:${600000 + index}`)
    )
  );
  assert.equal(parseRecentInstruments(raw).length, RECENT_INSTRUMENTS_LIMIT);
});

test("pushRecentInstrument prepends, dedupes by id, and caps the list", () => {
  const first = instrument("CN:600519");
  const second = instrument("US:AAPL", {
    market: "US",
    exchange: "NASDAQ",
    currency: "USD",
  });

  let list = pushRecentInstrument([], first);
  list = pushRecentInstrument(list, second);
  assert.deepEqual(
    list.map((item) => item.id),
    ["US:AAPL", "CN:600519"]
  );

  // 重复查看同一标的:提升到最前,而不是产生重复条目。
  list = pushRecentInstrument(list, first);
  assert.deepEqual(
    list.map((item) => item.id),
    ["CN:600519", "US:AAPL"]
  );

  for (let index = 0; index < RECENT_INSTRUMENTS_LIMIT + 3; index += 1) {
    list = pushRecentInstrument(list, instrument(`CN:${700000 + index}`));
  }
  assert.equal(list.length, RECENT_INSTRUMENTS_LIMIT);

  const input = [first];
  pushRecentInstrument(input, second);
  assert.deepEqual(input, [first], "must not mutate the input list");
});

test("load/save/clear round-trip through localStorage and degrade without it", () => {
  const store = new Map();
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  });
  try {
    const list = [instrument("CN:600519")];
    saveRecentInstruments(list);
    assert.ok(store.has(RECENT_INSTRUMENTS_STORAGE_KEY));
    assert.deepEqual(loadRecentInstruments(), list);

    clearRecentInstruments();
    assert.deepEqual(loadRecentInstruments(), []);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }

  // 无 localStorage(如测试或受限环境)时静默降级,不抛错。
  assert.deepEqual(loadRecentInstruments(), []);
  saveRecentInstruments([instrument("CN:600519")]);
  clearRecentInstruments();
});

test("research view wires the recent-instrument history into the search panel", async () => {
  const source = await readStockHubSource();
  assert.match(source, /最近查看/);
  assert.match(source, /pushRecentInstrument/);
  assert.match(source, /loadRecentInstruments/);
  assert.match(source, /clearRecentInstruments/);
});
