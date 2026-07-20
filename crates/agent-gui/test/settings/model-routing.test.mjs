import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const routing = loader.loadModule("src/lib/settings/modelRouting.ts");
const quickAsk = loader.loadModule("src/lib/quick-ask/model.ts");

function provider(overrides = {}) {
  const id = overrides.id ?? "provider-1";
  const type = overrides.type ?? "codex";
  const models = overrides.models ?? ["gpt-5", "gpt-5-mini"];
  const activeModels = overrides.activeModels ?? models;
  return {
    id,
    name: id,
    type,
    baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
    apiKey: overrides.apiKey ?? "key",
    models,
    activeModels,
    requestFormat: type === "codex" ? "openai-responses" : undefined,
  };
}

function app(partial = {}) {
  return settings.normalizeSettings({
    customProviders: partial.customProviders ?? [
      provider({ id: "main", models: ["gpt-5", "gpt-5-mini"] }),
      provider({ id: "vision", models: ["gpt-4o"] }),
      provider({ id: "cheap", models: ["gpt-5-mini"] }),
    ],
    selectedModel: partial.selectedModel ?? {
      customProviderId: "main",
      model: "gpt-5",
    },
    customSettings: partial.customSettings ?? {},
    memory: partial.memory ?? {},
  });
}

function chatFallback(appSettings) {
  const selected = appSettings.selectedModel;
  const providerItem = appSettings.customProviders.find(
    (item) => item.id === selected.customProviderId
  );
  return {
    selectedModel: selected,
    provider: providerItem,
    providerId: providerItem.type,
    model: selected.model,
  };
}

test("title/compaction follow current when role model is unset", () => {
  const appSettings = app();
  const fallback = chatFallback(appSettings);

  const title = routing.resolveConversationTitleRoleModel(
    appSettings,
    fallback
  );
  assert.equal(title.source, "fallback-chat");
  assert.equal(title.model, "gpt-5");
  assert.equal(title.role, "conversationTitle");

  const compaction = routing.resolveCompactionRoleModel(appSettings, fallback);
  assert.equal(compaction.source, "fallback-chat");
  assert.equal(compaction.model, "gpt-5");
  assert.equal(compaction.role, "compaction");
});

test("title/compaction use dedicated model when valid", () => {
  const appSettings = app({
    customSettings: {
      conversationTitleModel: {
        customProviderId: "cheap",
        model: "gpt-5-mini",
      },
      compactionModel: { customProviderId: "cheap", model: "gpt-5-mini" },
    },
  });
  const fallback = chatFallback(appSettings);

  const title = routing.resolveConversationTitleRoleModel(
    appSettings,
    fallback
  );
  assert.equal(title.source, "role");
  assert.equal(title.provider.id, "cheap");
  assert.equal(title.model, "gpt-5-mini");

  const compaction = routing.resolveCompactionRoleModel(appSettings, fallback);
  assert.equal(compaction.source, "role");
  assert.equal(compaction.provider.id, "cheap");
});

test("invalid role model silently falls back to chat", () => {
  const appSettings = app({
    customSettings: {
      conversationTitleModel: { customProviderId: "missing", model: "x" },
      compactionModel: { customProviderId: "main", model: "disabled-model" },
    },
  });
  const fallback = chatFallback(appSettings);
  assert.equal(
    routing.resolveConversationTitleRoleModel(appSettings, fallback).source,
    "fallback-chat"
  );
  assert.equal(
    routing.resolveCompactionRoleModel(appSettings, fallback).source,
    "fallback-chat"
  );
});

test("translation role falls back to selected chat model", () => {
  const withRole = app({
    customSettings: {
      translationModel: { customProviderId: "cheap", model: "gpt-5-mini" },
    },
  });
  const role = routing.resolveTranslationRoleModel(withRole);
  assert.equal(role.source, "role");
  assert.equal(role.model, "gpt-5-mini");

  const follow = routing.resolveTranslationRoleModel(app());
  assert.equal(follow.source, "fallback-chat");
  assert.equal(follow.model, "gpt-5");
});

test("memory extraction stays optional and does not follow chat", () => {
  assert.equal(routing.resolveMemoryExtractionRoleModel(app()), null);
  const withSummary = app({
    memory: {
      summaryModel: { customProviderId: "cheap", model: "gpt-5-mini" },
    },
  });
  const resolved = routing.resolveMemoryExtractionRoleModel(withSummary);
  assert.equal(resolved?.source, "role");
  assert.equal(resolved?.model, "gpt-5-mini");
});

test("quick ask prefers dedicated model then chat then first available", () => {
  const dedicated = app({
    customSettings: {
      quickAskModel: { customProviderId: "vision", model: "gpt-4o" },
    },
  });
  assert.equal(routing.resolveQuickAskRoleModel(dedicated).source, "role");
  assert.equal(routing.resolveQuickAskRoleModel(dedicated).model, "gpt-4o");

  const followChat = app();
  assert.equal(
    routing.resolveQuickAskRoleModel(followChat).source,
    "fallback-chat"
  );

  const coldStart = app({
    selectedModel: undefined,
    customProviders: [
      provider({ id: "empty", models: [], activeModels: [], apiKey: "" }),
      provider({ id: "usable", models: ["gpt-4o"], apiKey: "k" }),
    ],
  });
  const cold = routing.resolveQuickAskRoleModel(coldStart);
  assert.equal(cold.source, "fallback-first-available");
  assert.equal(cold.provider.id, "usable");
});

test("resolveQuickAskModel builds runtime from role routing", () => {
  const appSettings = app({
    customSettings: {
      quickAskModel: { customProviderId: "vision", model: "gpt-4o" },
    },
  });
  const resolved = quickAsk.resolveQuickAskModel(appSettings);
  assert.equal(resolved.selected.model, "gpt-4o");
  assert.equal(resolved.provider.id, "vision");
  assert.equal(resolved.runtime.promptCachingEnabled, false);
  assert.equal(resolved.runtime.nativeWebSearchEnabled, false);
});

test("normalizeCustomSettings keeps and cleans compaction/quickAsk models", () => {
  const providers = [
    provider({ id: "main", models: ["gpt-5"] }),
    provider({ id: "vision", models: ["gpt-4o"] }),
  ];
  const normalized = settings.normalizeCustomSettings(
    {
      compactionModel: { customProviderId: "main", model: "gpt-5" },
      quickAskModel: { customProviderId: "vision", model: "gpt-4o" },
      subagentDefaultModel: { customProviderId: "main", model: "gpt-5" },
    },
    providers
  );
  assert.deepEqual(normalized.compactionModel, {
    customProviderId: "main",
    model: "gpt-5",
  });
  assert.deepEqual(normalized.quickAskModel, {
    customProviderId: "vision",
    model: "gpt-4o",
  });
  assert.deepEqual(normalized.subagentDefaultModel, {
    customProviderId: "main",
    model: "gpt-5",
  });

  const stale = settings.normalizeCustomSettings(
    {
      compactionModel: { customProviderId: "gone", model: "x" },
      quickAskModel: { customProviderId: "vision", model: "missing" },
      subagentDefaultModel: { customProviderId: "gone", model: "x" },
    },
    providers
  );
  assert.equal(stale.compactionModel, undefined);
  assert.equal(stale.quickAskModel, undefined);
  assert.equal(stale.subagentDefaultModel, undefined);
});

test("subagent role resolves template then default then parent", () => {
  const appSettings = app({
    customSettings: {
      subagentDefaultModel: { customProviderId: "cheap", model: "gpt-5-mini" },
    },
  });
  const parent = chatFallback(appSettings);

  const fromTemplate = routing.resolveSubagentRoleModel(appSettings, parent, {
    customProviderId: "vision",
    model: "gpt-4o",
  });
  assert.equal(fromTemplate.source, "role");
  assert.equal(fromTemplate.model, "gpt-4o");

  const fromDefault = routing.resolveSubagentRoleModel(appSettings, parent);
  assert.equal(fromDefault.source, "role");
  assert.equal(fromDefault.model, "gpt-5-mini");

  const fromParent = routing.resolveSubagentRoleModel(
    app({ customSettings: {} }),
    parent
  );
  assert.equal(fromParent.source, "fallback-parent");
  assert.equal(fromParent.model, "gpt-5");
});

test("agent template selectedModel is normalized against active models", () => {
  const providers = [
    provider({ id: "main", models: ["gpt-5"], activeModels: ["gpt-5"] }),
  ];
  const kept = settings.normalizeAgentPromptTemplate(
    {
      name: "Review",
      prompt: "review code",
      selectedModel: { customProviderId: "main", model: "gpt-5" },
    },
    providers
  );
  assert.deepEqual(kept.selectedModel, {
    customProviderId: "main",
    model: "gpt-5",
  });

  const dropped = settings.normalizeAgentPromptTemplate(
    {
      name: "Review",
      prompt: "review code",
      selectedModel: { customProviderId: "main", model: "missing" },
    },
    providers
  );
  assert.equal(dropped.selectedModel, undefined);
});
