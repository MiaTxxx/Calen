import assert from "node:assert/strict";
import test from "node:test";

import {
  createEastmoneyProvider,
  createTencentProvider,
  makeInstrument,
} from "../src/index.ts";

const NOW = () => new Date("2026-07-18T08:00:00.000Z");

test("Tencent provider requests weekly K lines and parses qfqweek rows", async () => {
  const provider = createTencentProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  let requestedUrl = "";
  const payload = {
    data: {
      sh600519: {
        qfqweek: [["2026-07-17", "1490", "1500", "1510", "1488", "12345"]],
      },
    },
  };

  const result = await provider.history!(
    instrument,
    { limit: 60, period: "week" },
    {
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json(payload);
      },
      now: NOW,
    }
  );

  assert.ok(requestedUrl.includes("fqkline"));
  assert.ok(decodeURIComponent(requestedUrl).includes("sh600519,week,"));
  assert.deepEqual(result.data, [
    {
      time: "2026-07-17",
      open: 1490,
      close: 1500,
      high: 1510,
      low: 1488,
      volume: 12345,
    },
  ]);
});

test("Tencent provider maps intraday minute data to ISO bars with delta volume", async () => {
  const provider = createTencentProvider();
  const instrument = makeInstrument("CN", "002081", "SZSE", "EQUITY", "CNY");
  let requestedUrl = "";
  const payload = {
    code: 0,
    data: {
      sz002081: {
        data: {
          date: "20260718",
          data: ["0930 3.58 100 35800", "0931 3.60 250 89800"],
        },
      },
    },
  };

  const result = await provider.history!(
    instrument,
    { limit: 240, period: "minute" },
    {
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json(payload);
      },
      now: NOW,
    }
  );

  assert.ok(requestedUrl.includes("minute/query"));
  assert.ok(requestedUrl.includes("code=sz002081"));
  assert.deepEqual(result.data, [
    {
      time: "2026-07-18T09:30:00+08:00",
      open: 3.58,
      close: 3.58,
      high: 3.58,
      low: 3.58,
      volume: 100,
    },
    {
      time: "2026-07-18T09:31:00+08:00",
      open: 3.6,
      close: 3.6,
      high: 3.6,
      low: 3.6,
      volume: 150,
    },
  ]);
});

test("Eastmoney provider maps periods to klt and normalizes minute timestamps", async () => {
  const provider = createEastmoneyProvider();
  const instrument = makeInstrument("CN", "002081", "SZSE", "EQUITY", "CNY");
  const requestedUrls: string[] = [];
  const payload = {
    data: {
      klines: ["2026-07-18 09:31,3.58,3.60,3.61,3.57,150"],
    },
  };

  const minuteResult = await provider.history!(
    instrument,
    { limit: 240, period: "minute" },
    {
      fetch: async (input) => {
        requestedUrls.push(String(input));
        return Response.json(payload);
      },
      now: NOW,
    }
  );
  await provider.history!(
    instrument,
    { limit: 60, period: "month" },
    {
      fetch: async (input) => {
        requestedUrls.push(String(input));
        return Response.json({ data: { klines: [] } });
      },
      now: NOW,
    }
  );

  assert.ok(requestedUrls[0]?.includes("klt=1&"));
  assert.ok(requestedUrls[1]?.includes("klt=103"));
  assert.deepEqual(minuteResult.data, [
    {
      time: "2026-07-18T09:31:00+08:00",
      open: 3.58,
      close: 3.6,
      high: 3.61,
      low: 3.57,
      volume: 150,
    },
  ]);
});
