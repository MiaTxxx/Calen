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
