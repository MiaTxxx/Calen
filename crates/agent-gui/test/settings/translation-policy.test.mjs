import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const policy = loader.loadModule("src/lib/translation/policy.ts");
const tauri = loader.loadModule("src/lib/translation/tauri.ts");
const settings = loader.loadModule("src/lib/settings/index.ts");
const sync = loader.loadModule("src/lib/settings/sync.ts");

test("translation preferences normalize mode and local model without enabling downloads", () => {
  assert.deepEqual(policy.normalizeTranslationPreferences(undefined), {
    mode: "remote-only",
    localModelId: policy.DEFAULT_OFFLINE_TRANSLATION_MODEL_ID,
  });
  assert.deepEqual(
    policy.normalizeTranslationPreferences({
      mode: "offline-only",
      localModelId: "  imported-hy-mt  ",
    }),
    {
      mode: "offline-only",
      localModelId: "imported-hy-mt",
    }
  );
  assert.deepEqual(
    policy.normalizeTranslationPreferences({
      mode: "unexpected",
      localModelId: "",
    }),
    {
      mode: "remote-only",
      localModelId: policy.DEFAULT_OFFLINE_TRANSLATION_MODEL_ID,
    }
  );
});

test("translation Tauri command names remain a small stable desktop contract", () => {
  assert.deepEqual(tauri.TRANSLATION_COMMANDS, {
    catalogList: "translation_catalog_list",
    status: "translation_status",
    downloadStart: "translation_download_start",
    downloadStatus: "translation_download_status",
    downloadCancel: "translation_download_cancel",
    importModel: "translation_import",
    deleteModel: "translation_delete",
    translate: "translation_translate",
    stop: "translation_stop",
  });
});

test("translation routing only falls back for recoverable offline failures", () => {
  assert.deepEqual(policy.translationBackendOrder("remote-only"), ["remote"]);
  assert.deepEqual(policy.translationBackendOrder("offline-preferred"), [
    "offline",
    "remote",
  ]);
  assert.deepEqual(policy.translationBackendOrder("offline-only"), ["offline"]);

  for (const code of [
    "notFound",
    "notInstalled",
    "runtimeUnavailable",
    "runtimeFailed",
    "translationFailed",
    "io",
  ]) {
    assert.equal(
      policy.isRecoverableOfflineTranslationError({ code }),
      true,
      code
    );
  }
  for (const code of [
    "invalidArgument",
    "cancelled",
    "aborted",
    "integrityMismatch",
  ]) {
    assert.equal(
      policy.isRecoverableOfflineTranslationError({ code }),
      false,
      code
    );
  }
});

test("translation cache fingerprint covers every routing input and prompt version", () => {
  const base = {
    purpose: "skills-store",
    targetLocale: "zh-CN",
    text: "Hello",
    mode: "offline-preferred",
    localModelId: "local-a",
    remoteModelId: "provider-a/model-a",
  };
  const fingerprint = policy.createTranslationFingerprint(base);
  assert.equal(fingerprint, policy.createTranslationFingerprint({ ...base }));
  for (const [field, value] of [
    ["purpose", "settings-preview"],
    ["targetLocale", "en-US"],
    ["text", "World"],
    ["mode", "remote-only"],
    ["localModelId", "local-b"],
    ["remoteModelId", "provider-b/model-b"],
  ]) {
    assert.notEqual(
      fingerprint,
      policy.createTranslationFingerprint({ ...base, [field]: value }),
      field
    );
  }
  assert.ok(fingerprint.includes(policy.TRANSLATION_PROMPT_VERSION));
});

test("offline translation settings stay local and gateway patches cannot erase desktop choices", () => {
  const customProviders = [
    {
      id: "provider-1",
      name: "Provider",
      type: "codex",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
      models: ["gpt-5"],
      activeModels: ["gpt-5"],
    },
  ];
  const current = settings.normalizeSettings({
    customProviders,
    customSettings: {
      translationModel: { customProviderId: "provider-1", model: "gpt-5" },
      translation: { mode: "offline-only", localModelId: "imported-hy-mt" },
    },
  });

  const outgoing = sync.buildGatewaySettingsSyncPayload(current);
  assert.equal(Object.hasOwn(outgoing.customSettings, "translation"), false);

  const merged = sync.applyGatewaySettingsSyncPayload(current, {
    customSettings: {
      conversationTitleModel: undefined,
    },
  });
  assert.deepEqual(
    merged.customSettings.translation,
    current.customSettings.translation
  );
  assert.deepEqual(
    merged.customSettings.translationModel,
    current.customSettings.translationModel
  );
});
