import assert from "node:assert/strict";
import test from "node:test";

import { createTencentProvider, makeInstrument } from "../src/index.ts";

function asciiBytes(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

test("Tencent snapshot decodes GBK payloads without mojibake", async () => {
  const provider = createTencentProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  // “贵州茅台”的 GBK 字节；真实接口按 GBK 返回且不带 charset 头。
  const gbkName = [0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8];
  const bytes = Uint8Array.from([
    ...asciiBytes('v_sh600519="1~'),
    ...gbkName,
    ...asciiBytes('~600519~1500.00~1490.00~1495.00~12345"'),
  ]);

  const result = await provider.snapshot!(instrument, {
    fetch: async () =>
      new Response(bytes, { headers: { "content-type": "text/html" } }),
    now: () => new Date("2026-07-18T08:00:00.000Z"),
  });

  assert.equal(result.data?.instrument.name, "贵州茅台");
  assert.equal(result.data?.price, 1500);
});

test("Tencent snapshot keeps UTF-8 payloads intact when charset is declared", async () => {
  const provider = createTencentProvider();
  const instrument = makeInstrument("CN", "600519", "SSE", "EQUITY", "CNY");
  const body = 'v_sh600519="1~贵州茅台~600519~1500.00~1490.00~1495.00~12345"';

  const result = await provider.snapshot!(instrument, {
    fetch: async () =>
      new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    now: () => new Date("2026-07-18T08:00:00.000Z"),
  });

  assert.equal(result.data?.instrument.name, "贵州茅台");
});
