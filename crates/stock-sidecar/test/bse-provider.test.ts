import assert from "node:assert/strict";
import test from "node:test";

import {
  createEastmoneyProvider,
  createTencentProvider,
  makeInstrument,
} from "../src/index.ts";

test("BSE symbols never fall through to a Shenzhen provider symbol", async () => {
  const instrument = makeInstrument("CN", "832000", "BSE", "EQUITY", "CNY");
  let requestedUrl = "";
  const tencent = createTencentProvider();
  await assert.rejects(() =>
    tencent.snapshot!(instrument, {
      fetch: async (url) => {
        requestedUrl = String(url);
        return new Response("", { status: 503 });
      },
      now: () => new Date(),
    })
  );
  assert.match(requestedUrl, /q=bj832000/);
  assert.doesNotMatch(requestedUrl, /sz832000/);

  const eastmoney = createEastmoneyProvider();
  const history = await eastmoney.history!(
    instrument,
    { limit: 5 },
    {
      fetch: async () => {
        throw new Error("BSE should not call unsupported Eastmoney history");
      },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    }
  );
  assert.equal(history.data, null);
  assert.match(history.warnings?.join("\n") ?? "", /北交所/);
});
