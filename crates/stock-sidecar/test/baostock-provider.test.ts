import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  createBaostockProvider,
  makeInstrument,
  ProviderRegistry,
} from "../src/index.ts";
import type {
  BaostockTcpConnection,
  BaostockTcpFactory,
} from "../src/providers/baostock.ts";

const SPLIT = "\x01";
const END_SUFFIX = "<![CDATA[]]>\n";

function response(
  type: string,
  bodyParts: string[],
  compressed = false
): Buffer {
  const body = Buffer.from(bodyParts.join(SPLIT), "utf8");
  const payload = compressed ? deflateSync(body) : body;
  const header = Buffer.from(
    `00.9.20${SPLIT}${type}${SPLIT}${String(payload.length).padStart(10, "0")}`,
    "utf8"
  );
  return Buffer.concat([header, payload, Buffer.from(END_SUFFIX, "utf8")]);
}

function requestType(payload: string): string {
  return payload.slice(0, 21).split(SPLIT)[1] ?? "";
}

function requestBody(payload: string): string[] {
  const length = Number(payload.slice(0, 21).split(SPLIT)[2]);
  return payload.slice(21, 21 + length).split(SPLIT);
}

function scriptedFactory(
  handler: (payload: string, signal?: AbortSignal) => Promise<Buffer> | Buffer
): { factory: BaostockTcpFactory; requests: string[]; closed: () => boolean } {
  const requests: string[] = [];
  let isClosed = false;
  const connection: BaostockTcpConnection = {
    async request(payload, signal) {
      requests.push(payload);
      return await handler(payload, signal);
    },
    close() {
      isClosed = true;
    },
  };
  return {
    factory: async () => connection,
    requests,
    closed: () => isClosed,
  };
}

const instrument = makeInstrument(
  "CN",
  "600519",
  "SSE",
  "EQUITY",
  "CNY",
  "贵州茅台"
);

test("BaoStock provider logs in, queries daily bars, and exposes normalized registry evidence", async () => {
  const tcp = scriptedFactory((payload) => {
    if (requestType(payload) === "00") {
      return response("01", ["0", "success", "login", "anonymous"]);
    }
    assert.equal(requestType(payload), "95");
    const body = requestBody(payload);
    assert.deepEqual(body.slice(0, 5), [
      "query_history_k_data_plus",
      "anonymous",
      "1",
      "500",
      "sh.600519",
    ]);
    assert.match(body[5] ?? "", /^date,code,open,high,low,close,/);
    assert.equal(body[8], "d");
    assert.equal(body[9], "2");
    return response(
      "96",
      [
        "0",
        "success",
        "query_history_k_data_plus",
        "anonymous",
        "1",
        "500",
        JSON.stringify({
          record: [
            [
              "2026-07-14",
              "sh.600519",
              "1490",
              "1510",
              "1488",
              "1500",
              "1480",
              "12345",
              "18500000",
              "2",
              "0.42",
              "1",
              "1.3514",
            ],
            [
              "2026-07-15",
              "sh.600519",
              "1501",
              "1520",
              "1499",
              "1512",
              "1500",
              "23456",
              "35400000",
              "2",
              "0.51",
              "1",
              "0.8",
            ],
          ],
        }),
        "sh.600519",
        "date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg",
        body[6] ?? "",
        body[7] ?? "",
        "d",
        "2",
      ],
      true
    );
  });
  const provider = createBaostockProvider({ socketFactory: tcp.factory });
  const registry = new ProviderRegistry([provider], {
    now: () => new Date("2026-07-16T08:00:00.000Z"),
  });

  const result = await registry.query(
    "history",
    `${instrument.id}:2`,
    (candidate, context) =>
      candidate.history!(instrument, { limit: 2 }, context)
  );

  assert.deepEqual(result.data, [
    {
      time: "2026-07-14",
      open: 1490,
      high: 1510,
      low: 1488,
      close: 1500,
      volume: 12345,
    },
    {
      time: "2026-07-15",
      open: 1501,
      high: 1520,
      low: 1499,
      close: 1512,
      volume: 23456,
    },
  ]);
  assert.equal(result.source?.provider, "baostock");
  assert.equal(result.source?.capability, "history");
  assert.equal(result.source?.asOf, "2026-07-15");
  assert.deepEqual(tcp.requests.map(requestType), ["00", "95"]);
  assert.equal(tcp.closed(), true);
});

test("BaoStock snapshot is an explicitly delayed EOD view built from the latest daily bar", async () => {
  const tcp = scriptedFactory((payload) => {
    if (requestType(payload) === "00") {
      return response("01", ["0", "success", "login", "anonymous"]);
    }
    const body = requestBody(payload);
    return response(
      "96",
      [
        "0",
        "success",
        "query_history_k_data_plus",
        "anonymous",
        "1",
        "500",
        JSON.stringify({
          record: [
            [
              "2026-07-15",
              "sh.600519",
              "1501",
              "1520",
              "1499",
              "1512",
              "1500",
              "23456",
              "35400000",
              "2",
              "0.51",
              "1",
              "0.8",
            ],
          ],
        }),
        "sh.600519",
        "date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg",
        body[6] ?? "",
        body[7] ?? "",
        "d",
        "2",
      ],
      true
    );
  });
  const provider = createBaostockProvider({ socketFactory: tcp.factory });

  const result = await provider.snapshot!(instrument, {
    fetch: globalThis.fetch,
    now: () => new Date("2026-07-16T08:00:00.000Z"),
  });

  assert.equal(result.data?.price, 1512);
  assert.equal(result.data?.previousClose, 1500);
  assert.equal(result.data?.change, 12);
  assert.equal(result.data?.changePercent, 0.8);
  assert.equal(result.data?.marketTime, "2026-07-15T15:00:00.000+08:00");
  assert.equal(result.asOf, "2026-07-15T15:00:00.000+08:00");
  assert.match(result.warnings?.join("\n") ?? "", /最近交易日日 K|延迟/);
});

test("BaoStock protocol errors are surfaced instead of fabricating bars", async () => {
  const tcp = scriptedFactory((payload) =>
    requestType(payload) === "00"
      ? response("01", ["0", "success", "login", "anonymous"])
      : response("12", ["0", "wrong response type"])
  );
  const provider = createBaostockProvider({ socketFactory: tcp.factory });

  await assert.rejects(
    provider.history!(
      instrument,
      { limit: 1 },
      {
        fetch: globalThis.fetch,
        now: () => new Date("2026-07-16T08:00:00.000Z"),
      }
    ),
    /BaoStock.*响应类型|response type/i
  );
  assert.equal(tcp.closed(), true);
});

test("BaoStock cancellation reaches the TCP request and closes the connection", async () => {
  const tcp = scriptedFactory((payload, signal) => {
    if (requestType(payload) === "00") {
      return response("01", ["0", "success", "login", "anonymous"]);
    }
    return new Promise<Buffer>((_resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new Error("cancelled"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  });
  const provider = createBaostockProvider({ socketFactory: tcp.factory });
  const controller = new AbortController();
  const pending = provider.history!(
    instrument,
    { limit: 1 },
    {
      signal: controller.signal,
      fetch: globalThis.fetch,
      now: () => new Date("2026-07-16T08:00:00.000Z"),
    }
  );

  controller.abort(new Error("user cancelled"));

  await assert.rejects(pending, /user cancelled/);
  assert.equal(tcp.closed(), true);
});
