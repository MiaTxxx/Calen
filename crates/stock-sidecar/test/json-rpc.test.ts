import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createStockResearchService, runJsonRpcStdio } from "../src/index.ts";

test("stdio serves one JSON-RPC response per input line with fixed method names", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const service = createStockResearchService({
    providers: [],
    now: () => new Date("2026-07-15T00:00:00.000Z"),
  });
  const completed = runJsonRpcStdio({ input, output, service });

  input.end(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resolve",
        params: { query: "600519" },
      }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "status", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "fxRates",
        params: { pairs: [{ fromCurrency: "USD", toCurrency: "CNY" }] },
      }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "unknown", params: {} }),
    ].join("\n")
  );
  await completed;

  const responses = Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(responses.length, 4);
  assert.equal(responses[0].jsonrpc, "2.0");
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.instruments[0].id, "CN:600519");
  assert.equal(responses[1].result.state, "ready");
  assert.equal(responses[2].result.status, "unavailable");
  assert.deepEqual(responses[3], {
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32601, message: "Method not found: unknown" },
  });
});

test("JSON-RPC rejects invalid method params with -32602", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = runJsonRpcStdio({
    input,
    output,
    service: createStockResearchService({ providers: [] }),
  });
  input.end(
    [
      JSON.stringify({ jsonrpc: "2.0", id: 9, method: "snapshot", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "snapshot",
        params: {
          instrument: {
            id: "XX:X",
            symbol: "X",
            name: "X",
            market: "XX",
            exchange: "X",
            assetType: "coin",
            currency: "BTC",
          },
          maxAgeMs: -1,
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 14,
        method: "fxRates",
        params: { pairs: [{ fromCurrency: "USD", toCurrency: "USD" }] },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "marketBrief",
        params: { market: "CRYPTO", limit: 0 },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "research",
        params: {
          instrument: {
            id: "CN:600519",
            symbol: "600519",
            name: "贵州茅台",
            market: "CN",
            exchange: "SSE",
            assetType: "stock",
            currency: "CNY",
          },
          capabilities: ["resolve", "madeUp"],
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 13,
        method: "snapshot",
        params: {
          instrument: {
            id: "CN:600519",
            symbol: "600519",
            name: "贵州茅台",
            market: "CN",
            exchange: "SSE",
            assetType: "stock",
            currency: "CNY",
          },
          includeHistory: true,
          historyLimit: 1000,
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 15,
        method: "marketBrief",
        params: {
          market: "CN",
          session: "opening_bell",
          tradeDate: "2026-7-15",
          sections: ["limitUp", "madeUp"],
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 16,
        method: "marketBrief",
        params: {
          market: "CN",
          session: "close",
          tradeDate: "2026-02-30",
          sections: ["limitUp"],
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 17,
        method: "marketBrief",
        params: {
          market: "CN",
          session: "general",
          tradeDate: "2026-07-15",
          sections: ["limitUp", "limitUp"],
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 18,
        method: "backtest",
        params: {
          bars: [],
          evaluationRatio: 0.05,
        },
      }),
    ].join("\n")
  );
  await completed;
  const responses = Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    responses.map((response) => response.error.code),
    [
      -32602, -32602, -32602, -32602, -32602, -32602, -32602, -32602, -32602,
      -32602,
    ]
  );
  assert.ok(
    responses.every((response) => /Invalid params/.test(response.error.message))
  );
});

test("JSON-RPC validates backtest instrument and volume even when bars are supplied", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = runJsonRpcStdio({
    input,
    output,
    service: createStockResearchService({ providers: [] }),
  });
  const bar = {
    time: "2026-07-15",
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
  };
  input.end(
    [
      {
        jsonrpc: "2.0",
        id: "invalid-instrument",
        method: "backtest",
        params: { instrument: { bad: true }, bars: [bar] },
      },
      {
        jsonrpc: "2.0",
        id: "invalid-volume",
        method: "backtest",
        params: { bars: [{ ...bar, volume: "not-a-number" }] },
      },
    ]
      .map((request) => JSON.stringify(request))
      .join("\n")
  );
  await completed;

  const responses = Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    responses.map((response) => response.error?.code),
    [-32602, -32602]
  );
  assert.match(responses[0].error.message, /instrument|标的|证券/i);
  assert.match(responses[1].error.message, /volume|成交量/i);
});
