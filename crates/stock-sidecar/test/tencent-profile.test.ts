import assert from "node:assert/strict";
import test from "node:test";

import {
  createTencentBasicProfileProvider,
  makeInstrument,
} from "../src/index.ts";

test("Tencent provides a clearly limited basic profile for HK and US instruments", async () => {
  const provider = createTencentBasicProfileProvider();
  const instrument = makeInstrument(
    "US",
    "AAPL",
    "US",
    "EQUITY",
    "USD",
    "Apple"
  );
  const result = await provider.profile!(instrument, {
    fetch: async () =>
      new Response('v_usAAPL="200~Apple Inc~AAPL~210~208~209~1~~~~"'),
    now: () => new Date("2026-07-15T10:00:00.000Z"),
  });

  assert.equal((result.data as { symbol: string }).symbol, "AAPL");
  assert.equal((result.data as { name: string }).name, "Apple Inc");
  assert.equal(
    (result.data as { coverage: string }).coverage,
    "basic-quote-identity"
  );
  assert.match(result.warnings?.[0] ?? "", /基础资料/);
});
