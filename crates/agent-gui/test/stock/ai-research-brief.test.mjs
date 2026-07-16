import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { generateStockAiResearchBrief } = loader.loadModule(
  "src/lib/stock-research/aiBrief.ts"
);

const settings = {
  selectedModel: { customProviderId: "provider-1", model: "gpt-research" },
  customProviders: [
    {
      id: "provider-1",
      name: "Research Provider",
      type: "codex",
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      models: [
        { id: "gpt-research", contextWindow: 128_000, maxOutputTokens: 8_000 },
      ],
      activeModels: ["gpt-research"],
      requestFormat: "openai-responses",
      reasoning: "high",
      promptCachingEnabled: true,
      nativeWebSearchEnabled: true,
    },
  ],
  chatRuntimeControls: {
    thinkingEnabled: true,
    nativeWebSearchEnabled: true,
    reasoning: "high",
    reasoningByProvider: {},
  },
};

const evidence = {
  status: "partial",
  data: {
    instrument: {
      id: "CN:600519",
      symbol: "600519",
      name: "贵州茅台",
      market: "CN",
      exchange: "SSE",
      assetType: "stock",
      currency: "CNY",
    },
    title: "贵州茅台",
    summary: "",
    facts: ["financials: 2025 年营业收入 1800 亿元"],
    positiveCases: [],
    risks: ["news: partial"],
    openQuestions: ["news: 部分新闻源不可用"],
    snapshot: {
      instrument: {
        id: "CN:600519",
        symbol: "600519",
        name: "贵州茅台",
        market: "CN",
        exchange: "SSE",
        assetType: "stock",
        currency: "CNY",
      },
      price: 1_588,
      change: 8,
      changePercent: 0.51,
    },
    evidenceSections: [
      {
        capability: "financials",
        status: "ok",
        data: { reportDate: "2025-12-31", revenue: 180_000_000_000 },
        warnings: [],
      },
    ],
    experimentalAnalysis: [],
  },
  sources: [
    {
      provider: "eastmoney",
      capability: "financials",
      asOf: "2025-12-31",
      retrievedAt: "2026-07-16T08:00:00Z",
      cached: false,
    },
  ],
  asOf: "2025-12-31",
  retrievedAt: "2026-07-16T08:00:00Z",
  cached: false,
  warnings: ["news: 部分新闻源不可用"],
};

test("stock Hub generates all research sections through the selected Calen model", async () => {
  let captured;
  const result = await generateStockAiResearchBrief({
    settings,
    evidence,
    now: () => new Date("2026-07-16T09:30:00Z"),
    modelClient: async (request) => {
      captured = request;
      return `\`\`\`json
{
  "summary": "收入规模可核验，但新闻覆盖不完整。",
  "facts": ["2025 年营业收入为 1800 亿元。"],
  "supportingCases": ["已返回年度财务数据。"],
  "counterCases": ["新闻数据并不完整，无法确认近期舆情全貌。"],
  "risks": ["新闻来源部分不可用。"],
  "openQuestions": ["需要补充核验近期公告与新闻。"]
}
\`\`\``;
    },
  });

  assert.equal(captured.providerId, "codex");
  assert.equal(captured.model, "gpt-research");
  assert.equal(captured.runtime.baseUrl, "https://api.example.com/v1");
  assert.equal(captured.runtime.apiKey, "secret-key");
  assert.equal(captured.runtime.nativeWebSearchEnabled, false);
  assert.match(captured.prompt, /CN:600519/);
  assert.match(captured.prompt, /2025-12-31/);
  assert.match(captured.prompt, /eastmoney/);
  assert.match(captured.prompt, /1588/);
  assert.match(captured.prompt, /部分新闻源不可用/);
  assert.deepEqual(result.counterCases, [
    "新闻数据并不完整，无法确认近期舆情全貌。",
  ]);
  assert.deepEqual(result.openQuestions, ["需要补充核验近期公告与新闻。"]);
  assert.deepEqual(result.model, {
    customProviderId: "provider-1",
    providerId: "codex",
    model: "gpt-research",
  });
  assert.equal(result.generatedAt, "2026-07-16T09:30:00.000Z");
});

test("stock Hub rejects incomplete model output instead of treating sidecar fields as AI prose", async () => {
  await assert.rejects(
    generateStockAiResearchBrief({
      settings,
      evidence,
      modelClient: async () => '{"summary":"只有摘要"}',
    }),
    /模型返回的研究简报格式不完整/
  );
});

test("stock Hub rejects model trading instructions before they reach the result card", async () => {
  await assert.rejects(
    generateStockAiResearchBrief({
      settings,
      evidence,
      modelClient: async () =>
        JSON.stringify({
          summary: "建议立即买入，并将目标价设为 2000 元。",
          facts: ["财务数据已返回。"],
          supportingCases: [],
          counterCases: [],
          risks: [],
          openQuestions: [],
        }),
    }),
    /包含禁止的买卖、目标价、仓位或收益指令/
  );
});
