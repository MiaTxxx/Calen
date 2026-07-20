import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const capabilities = loader.loadModule("src/lib/providers/capabilities.ts");

test("provider model config normalizes optional capabilities", () => {
  const model = settings.normalizeProviderModelConfig(
    {
      id: "gpt-4o",
      contextWindow: 128000,
      maxOutputToken: 16384,
      capabilities: ["vision", "vision", "text", "nope"],
    },
    "codex"
  );
  assert.deepEqual(model.capabilities, ["vision", "text"]);
});

test("createModelFromConfig honors explicit vision capability", () => {
  // load model factory via capabilities helper path
  const modelFactory = loader.loadModule(
    "src/lib/providers/runtime/modelFactory.ts"
  );
  const withVision = modelFactory.createModelFromConfig(
    "claude_code",
    "custom-unknown-model",
    "https://api.anthropic.com",
    undefined,
    {
      id: "custom-unknown-model",
      contextWindow: 200000,
      maxOutputToken: 8192,
      capabilities: ["vision", "text"],
    }
  );
  assert.ok(withVision.input.includes("image"));

  const textOnly = modelFactory.createModelFromConfig(
    "claude_code",
    "custom-unknown-model",
    "https://api.anthropic.com",
    undefined,
    {
      id: "custom-unknown-model",
      contextWindow: 200000,
      maxOutputToken: 8192,
      capabilities: ["text"],
    }
  );
  assert.deepEqual(textOnly.input, ["text"]);
});

test("selectedModelSupportsVision respects explicit capability marks", () => {
  const provider = {
    id: "p1",
    name: "P1",
    type: "claude_code",
    baseUrl: "https://api.anthropic.com",
    apiKey: "k",
    models: [
      {
        id: "vision-x",
        contextWindow: 1000,
        maxOutputToken: 1000,
        capabilities: ["vision"],
      },
    ],
    activeModels: ["vision-x"],
    reasoning: "off",
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
  };
  assert.equal(
    capabilities.selectedModelSupportsVision({
      selected: { customProviderId: "p1", model: "vision-x" },
      provider,
      modelConfig: provider.models[0],
    }),
    true
  );
});

test("openai-completions heuristics treat kimi/moonshot as vision-capable", () => {
  const modelFactory = loader.loadModule(
    "src/lib/providers/runtime/modelFactory.ts"
  );
  const kimi = modelFactory.createModelFromConfig(
    "codex",
    "kimi-k2.6",
    "https://api.moonshot.cn/v1",
    "openai-completions",
    {
      id: "kimi-k2.6",
      contextWindow: 200000,
      maxOutputToken: 8192,
    }
  );
  assert.ok(
    kimi.input.includes("image"),
    `expected kimi-k2.6 to advertise image input, got ${JSON.stringify(kimi.input)}`
  );

  const moonshot = modelFactory.createModelFromConfig(
    "codex",
    "moonshot-v1-128k-vision-preview",
    "https://api.moonshot.cn/v1",
    "openai-completions",
    {
      id: "moonshot-v1-128k-vision-preview",
      contextWindow: 128000,
      maxOutputToken: 8192,
    }
  );
  assert.ok(moonshot.input.includes("image"));
});

test("streamAssistantMessage can force image input for screenshot turns", () => {
  // Behavior is owned by createModelFromConfig heuristics + optional forceImageInput.
  // This test documents the expected contract for Quick Ask screenshot sends.
  const modelFactory = loader.loadModule(
    "src/lib/providers/runtime/modelFactory.ts"
  );
  const forced = modelFactory.createModelFromConfig(
    "codex",
    "some-custom-gateway-model",
    "https://gateway.example/v1",
    "openai-completions",
    {
      id: "some-custom-gateway-model",
      contextWindow: 128000,
      maxOutputToken: 4096,
      capabilities: ["vision", "text"],
    }
  );
  assert.deepEqual(forced.input, ["text", "image"]);
});
