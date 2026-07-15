import assert from "node:assert/strict";
import test from "node:test";

import { createTencentProvider, makeInstrument } from "../src/index.ts";

test("Tencent provider normalizes bounded daily K lines", async () => {
  const provider = createTencentProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const payload = {
    data: {
      sh600519: {
        qfqday: [
          ["2026-07-14", "1490", "1500", "1510", "1488", "12345"],
          ["2026-07-15", "1501", "1512", "1520", "1499", "23456"],
        ],
      },
    },
  };

  const result = await provider.history!(
    instrument,
    { limit: 2 },
    {
      fetch: async () => Response.json(payload),
      now: () => new Date("2026-07-15T08:00:00.000Z"),
    }
  );

  assert.deepEqual(result.data, [
    {
      time: "2026-07-14",
      open: 1490,
      close: 1500,
      high: 1510,
      low: 1488,
      volume: 12345,
    },
    {
      time: "2026-07-15",
      open: 1501,
      close: 1512,
      high: 1520,
      low: 1499,
      volume: 23456,
    },
  ]);
  assert.equal(result.asOf, "2026-07-15");
});
