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
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "unknown", params: {} }),
    ].join("\n")
  );
  await completed;

  const responses = Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(responses.length, 3);
  assert.equal(responses[0].jsonrpc, "2.0");
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.instruments[0].id, "CN:600519");
  assert.equal(responses[1].result.state, "ready");
  assert.deepEqual(responses[2], {
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
        id: 11,
        method: "marketBrief",
        params: { market: "CRYPTO", limit: 0 },
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
    [-32602, -32602, -32602]
  );
  assert.ok(
    responses.every((response) => /Invalid params/.test(response.error.message))
  );
});
