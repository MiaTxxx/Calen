import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const guiRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const llmModulePath = path.join(guiRoot, "src/lib/providers/llm.ts");

function createHarness({ offline, remoteText = "远程译文" }) {
  const calls = { offline: 0, remote: 0 };
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, payload) {
          if (command !== "translation_translate") {
            throw new Error(`unexpected command: ${command}`);
          }
          calls.offline += 1;
          return offline(payload);
        },
      },
      [llmModulePath]: {
        assistantMessageToText(message) {
          return message.text;
        },
        async completeAssistantMessage() {
          calls.remote += 1;
          return { text: remoteText };
        },
      },
    },
  });
  const settingsModule = loader.loadModule("src/lib/settings/index.ts");
  const translation = loader.loadModule("src/lib/translation.ts");
  const settings = settingsModule.normalizeSettings({
    customProviders: [
      {
        id: "provider-1",
        name: "Provider",
        type: "codex",
        baseUrl: "https://api.example.com/v1",
        apiKey: "key",
        models: ["remote-model"],
        activeModels: ["remote-model"],
      },
    ],
    selectedModel: { customProviderId: "provider-1", model: "remote-model" },
  });
  return { calls, settings, translation };
}

test("offline preferred returns local translation without calling the remote model", async () => {
  const harness = createHarness({
    offline: async () => ({
      text: "本地译文",
      modelId: "local-model",
      elapsedMs: 12,
    }),
  });
  harness.settings.customSettings.translation = {
    mode: "offline-preferred",
    localModelId: "local-model",
  };
  const port = harness.translation.createTranslationPort(harness.settings);

  const result = await port.translate({
    text: "Hello",
    targetLocale: "zh-CN",
    purpose: "skills-store",
  });
  assert.deepEqual(result, {
    text: "本地译文",
    backend: "offline",
    modelId: "local-model",
    cached: false,
    warnings: [],
  });
  assert.deepEqual(harness.calls, { offline: 1, remote: 0 });

  const cached = await port.translate({
    text: "Hello",
    targetLocale: "zh-CN",
    purpose: "skills-store",
  });
  assert.equal(cached.cached, true);
  assert.deepEqual(harness.calls, { offline: 1, remote: 0 });
});

test("offline preferred falls back only for a recoverable local error", async () => {
  const harness = createHarness({
    offline: async () => {
      throw Object.assign(new Error("model is missing"), {
        code: "notInstalled",
      });
    },
  });
  harness.settings.customSettings.translation = {
    mode: "offline-preferred",
    localModelId: "local-model",
  };
  const port = harness.translation.createTranslationPort(harness.settings);

  const result = await port.translate({
    text: "Hello",
    targetLocale: "zh-CN",
    purpose: "skills-store",
  });
  assert.equal(result.backend, "remote");
  assert.equal(result.text, "远程译文");
  assert.equal(result.modelId, "remote-model");
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(harness.calls, { offline: 1, remote: 1 });
});

test("placeholder-only offline output falls back instead of replacing the skill description", async () => {
  const harness = createHarness({
    offline: async () => ({
      text: "自动识别",
      modelId: "local-model",
      elapsedMs: 8,
    }),
    remoteText: "用于安装前审查技能安全风险。",
  });
  harness.settings.customSettings.translation = {
    mode: "offline-preferred",
    localModelId: "local-model",
  };
  const port = harness.translation.createTranslationPort(harness.settings);

  const result = await port.translate({
    text: "Security-first skill vetting for AI agents.",
    targetLocale: "zh-CN",
    purpose: "skills-store",
  });

  assert.equal(result.backend, "remote");
  assert.equal(result.text, "用于安装前审查技能安全风险。");
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(harness.calls, { offline: 1, remote: 1 });
});

test("placeholder-only remote output is rejected as an invalid translation", async () => {
  const harness = createHarness({
    offline: async () => ({
      text: "unused",
      modelId: "local-model",
      elapsedMs: 1,
    }),
    remoteText: "自动识别",
  });
  const port = harness.translation.createTranslationPort(harness.settings);

  await assert.rejects(
    port.translate({
      text: "Security-first skill vetting for AI agents.",
      targetLocale: "zh-CN",
      purpose: "skills-store",
    }),
    (error) => error.code === "translationFailed"
  );
  assert.deepEqual(harness.calls, { offline: 0, remote: 1 });
});

test("invalid input and cancellation never fall back to remote translation", async () => {
  const harness = createHarness({
    offline: async () => ({
      text: "unused",
      modelId: "local-model",
      elapsedMs: 1,
    }),
  });
  harness.settings.customSettings.translation = {
    mode: "offline-preferred",
    localModelId: "local-model",
  };
  const port = harness.translation.createTranslationPort(harness.settings);

  await assert.rejects(
    port.translate({
      text: "   ",
      targetLocale: "zh-CN",
      purpose: "skills-store",
    }),
    (error) => error.code === "invalidArgument"
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    port.translate({
      text: "Hello",
      targetLocale: "zh-CN",
      purpose: "skills-store",
      signal: controller.signal,
    }),
    (error) => error.name === "AbortError"
  );
  assert.deepEqual(harness.calls, { offline: 0, remote: 0 });
});

test("string errors from Tauri retain their code for Skills setup guidance", async () => {
  const harness = createHarness({
    offline: async () => {
      throw "notInstalled: local model is missing";
    },
  });
  harness.settings.customSettings.translation = {
    mode: "offline-only",
    localModelId: "local-model",
  };
  const port = harness.translation.createTranslationPort(harness.settings);

  await assert.rejects(
    port.translate({
      text: "Hello",
      targetLocale: "zh-CN",
      purpose: "skills-store",
    }),
    (error) =>
      error.code === "notInstalled" &&
      harness.translation.isTranslationSetupRequired(error) === true
  );
  assert.deepEqual(harness.calls, { offline: 1, remote: 0 });
});
