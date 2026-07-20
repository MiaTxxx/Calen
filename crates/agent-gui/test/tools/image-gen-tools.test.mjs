import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const imageGen = loader.loadModule("src/lib/tools/imageGenTools.ts");
const settings = loader.loadModule("src/lib/settings/index.ts");

function provider(overrides = {}) {
  return {
    id: overrides.id ?? "openai",
    name: overrides.name ?? "OpenAI",
    type: overrides.type ?? "codex",
    baseUrl: overrides.baseUrl ?? "https://api.openai.com/v1",
    apiKey: overrides.apiKey ?? "sk-test",
    models: overrides.models ?? [
      {
        id: "gpt-image-1",
        contextWindow: 128000,
        maxOutputToken: 4096,
        capabilities: ["image_gen", "text"],
      },
      { id: "gpt-5", contextWindow: 128000, maxOutputToken: 8192 },
    ],
    activeModels: overrides.activeModels ?? ["gpt-image-1", "gpt-5"],
    reasoning: "off",
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
    requestFormat: "openai-responses",
  };
}

test("shouldEnableImageGenTools when dedicated model is configured", () => {
  const app = settings.normalizeSettings({
    customProviders: [provider()],
    selectedModel: { customProviderId: "openai", model: "gpt-5" },
    customSettings: {
      imageGenModel: { customProviderId: "openai", model: "gpt-image-1" },
    },
  });
  assert.equal(imageGen.shouldEnableImageGenTools(app), true);
});

test("shouldEnableImageGenTools when chat model marks image_gen", () => {
  const app = settings.normalizeSettings({
    customProviders: [provider({ activeModels: ["gpt-image-1"] })],
    selectedModel: { customProviderId: "openai", model: "gpt-image-1" },
    customSettings: {},
  });
  assert.equal(imageGen.shouldEnableImageGenTools(app), true);
});

test("shouldEnableImageGenTools false without config", () => {
  const app = settings.normalizeSettings({
    customProviders: [provider()],
    selectedModel: { customProviderId: "openai", model: "gpt-5" },
    customSettings: {},
  });
  assert.equal(imageGen.shouldEnableImageGenTools(app), false);
});
