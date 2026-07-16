import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { mapStockResearchResult } = loader.loadModule(
  "src/lib/stock-research/contracts.ts"
);

test("research evidence keeps per-source freshness and reports the oldest evidence timestamp", () => {
  const mapped = mapStockResearchResult({
    status: "partial",
    instrument: {
      id: "CN:600519",
      symbol: "600519",
      name: "贵州茅台",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
    },
    data: {
      capabilities: {
        financials: {
          status: "ok",
          data: { reportDate: "2025-12-31" },
          warnings: [],
        },
        notices: { status: "ok", data: { items: [] }, warnings: [] },
        technical: { status: "ok", data: { rsi14: 62 }, warnings: [] },
      },
    },
    sources: [
      {
        id: "quote:tencent",
        name: "腾讯行情",
        provider: "tencent",
        capability: "quote",
        asOf: "2026-07-16T07:00:00.000Z",
      },
      {
        id: "financials:eastmoney",
        name: "东方财富财务",
        provider: "eastmoney",
        capability: "financials",
        asOf: "2025-12-31",
      },
    ],
    // This aggregate value is newer than the filing and must not hide it.
    asOf: "2026-07-16T07:00:00.000Z",
    retrievedAt: "2026-07-16T07:00:03.000Z",
    cached: false,
    warnings: [],
  });

  assert.equal(mapped.asOf, "2025-12-31");
  assert.equal(mapped.retrievedAt, "2026-07-16T07:00:03.000Z");
  assert.deepEqual(
    mapped.sources.map(({ name, provider, capability, asOf }) => ({
      name,
      provider,
      capability,
      asOf,
    })),
    [
      {
        name: "腾讯行情",
        provider: "tencent",
        capability: "quote",
        asOf: "2026-07-16T07:00:00.000Z",
      },
      {
        name: "东方财富财务",
        provider: "eastmoney",
        capability: "financials",
        asOf: "2025-12-31",
      },
    ]
  );
  assert.equal(mapped.data?.experimentalAnalysis[0]?.capability, "technical");
  assert.equal(mapped.data?.evidenceSections[0]?.capability, "financials");
  assert.equal(mapped.data?.evidenceSections[1]?.capability, "notices");
});

test("Hub and chat result cards render source-level freshness and split factual evidence from experiments", async () => {
  const hubSource = await readFile(
    new URL("../../src/pages/stock-hub/StockHubPage.tsx", import.meta.url),
    "utf8"
  );
  const chatSource = await readFile(
    new URL(
      "../../src/pages/chat/components/assistant-bubble/ToolResultDisplay.tsx",
      import.meta.url
    ),
    "utf8"
  );
  const toolSource = await readFile(
    new URL("../../src/lib/tools/stockResearchTools.ts", import.meta.url),
    "utf8"
  );

  assert.match(hubSource, /最早证据截至/);
  assert.match(hubSource, /source\.provider/);
  assert.match(hubSource, /source\.capability/);
  assert.match(hubSource, /source\.asOf/);
  assert.match(chatSource, /StockResultSources/);
  assert.match(chatSource, /earliest as of/);
  assert.match(chatSource, /source\.capability/);
  assert.match(chatSource, /source\.asOf/);
  assert.match(chatSource, /experimentalCapabilities/);

  const researchBlock = toolSource.match(
    /name: "StockResearch"[\s\S]*?name: "StockMarketBrief"/
  )?.[0];
  assert.ok(researchBlock);
  assert.doesNotMatch(researchBlock, /experimental:\s*true/);
  assert.match(toolSource, /experimentalCapabilities/);
});

test("research view ignores stale search, snapshot, evidence, and AI responses", async () => {
  const hubSource = await readFile(
    new URL("../../src/pages/stock-hub/StockHubPage.tsx", import.meta.url),
    "utf8"
  );

  assert.match(hubSource, /const searchSequence = useRef\(0\)/);
  assert.match(hubSource, /const inspectSequence = useRef\(0\)/);
  assert.match(hubSource, /const researchSequence = useRef\(0\)/);
  assert.match(hubSource, /sequence !== searchSequence\.current/);
  assert.match(hubSource, /sequence !== inspectSequence\.current/);
  assert.match(hubSource, /sequence !== researchSequence\.current/);
  assert.match(hubSource, /researchSequence\.current \+= 1/);
});
