import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const model = loader.loadModule("src/lib/quick-ask/model.ts");

function provider(overrides = {}) {
  return {
    id: "p1",
    name: "P1",
    type: "claude_code",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-test",
    models: [],
    activeModels: ["claude-sonnet-5"],
    reasoning: "off",
    promptCachingEnabled: true,
    nativeWebSearchEnabled: false,
    ...overrides,
  };
}

test("resolveQuickAskModel uses the chat-selected model when valid", () => {
  const resolved = model.resolveQuickAskModel({
    selectedModel: { customProviderId: "p1", model: "claude-sonnet-5" },
    customProviders: [provider()],
  });
  assert.equal(resolved.selected.model, "claude-sonnet-5");
  assert.equal(resolved.provider.id, "p1");
  assert.equal(resolved.runtime.apiKey, "sk-test");
  // 快捷提问固定关闭思考、缓存与联网搜索。
  assert.equal(resolved.runtime.promptCachingEnabled, false);
  assert.equal(resolved.runtime.nativeWebSearchEnabled, false);
});

test("resolveQuickAskModel falls back to the first usable provider", () => {
  const resolved = model.resolveQuickAskModel({
    selectedModel: { customProviderId: "gone", model: "missing" },
    customProviders: [
      provider({ id: "empty", apiKey: "", activeModels: [] }),
      provider({ id: "p2", activeModels: ["gpt-6"] }),
    ],
  });
  assert.equal(resolved.provider.id, "p2");
  assert.equal(resolved.selected.model, "gpt-6");
});

test("resolveQuickAskModel throws QuickAskModelError when nothing is usable", () => {
  assert.throws(
    () =>
      model.resolveQuickAskModel({
        selectedModel: undefined,
        customProviders: [provider({ apiKey: "  ", activeModels: [] })],
      }),
    model.QuickAskModelError
  );
});

test("buildQuickAskUserMessage attaches the screenshot as a native image block", () => {
  const message = model.buildQuickAskUserMessage(
    "这是什么公式？",
    "data:image/png;base64,QUJD"
  );
  assert.equal(message.role, "user");
  assert.deepEqual(message.content[0], {
    type: "image",
    data: "QUJD",
    mimeType: "image/png",
  });
  assert.deepEqual(message.content[1], {
    type: "text",
    text: "这是什么公式？",
  });

  const plain = model.buildQuickAskUserMessage("追问", undefined);
  assert.equal(plain.content, "追问");
});

test("buildQuickAskContext carries system prompt and history", () => {
  const user = model.buildQuickAskUserMessage("你好", undefined);
  const context = model.buildQuickAskContext([user], "zh-CN");
  assert.ok(context.systemPrompt.includes("Simplified Chinese"));
  assert.equal(context.messages.length, 1);
  assert.deepEqual(context.tools, []);
});
