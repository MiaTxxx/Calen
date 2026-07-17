import type { Context } from "@earendil-works/pi-ai";
import type { Locale } from "../i18n";
import {
  assistantMessageToText,
  completeAssistantMessage,
  type ProviderRuntimeConfig,
} from "./providers/llm";
import {
  type AppSettings,
  findProviderModelConfig,
  getChatRuntimeReasoningLevelsForProvider,
  type SelectedModel,
} from "./settings";

export type TranslationSettings = Pick<
  AppSettings,
  "selectedModel" | "customProviders" | "customSettings"
>;

const TARGET_LANGUAGE_NAMES: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

function translationSystemPrompt(targetLanguage: string) {
  return [
    `You are a translator. Translate the user's text into ${targetLanguage}.`,
    "Preserve the original Markdown structure, inline code, code blocks, URLs, and proper nouns such as product or tool names.",
    "Output ONLY the translated text with no preamble, notes, or quotation marks around it.",
  ].join("\n");
}

// 优先使用设置里的「翻译模型」，未配置或已失效时回退到当前对话模型。
function resolveTranslationModel(settings: TranslationSettings) {
  const candidates: Array<SelectedModel | undefined> = [
    settings.customSettings.translationModel,
    settings.selectedModel,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const provider = settings.customProviders.find(
      (item) => item.id === candidate.customProviderId,
    );
    if (!provider?.activeModels.includes(candidate.model)) continue;
    return { selected: candidate, provider };
  }
  throw new Error("没有可用的翻译模型：请先在主对话中选择模型，或在设置中指定翻译模型。");
}

export async function translateText(params: {
  settings: TranslationSettings;
  text: string;
  targetLocale: Locale;
  signal?: AbortSignal;
}): Promise<string> {
  const text = params.text.trim();
  if (!text) return "";

  const { selected, provider } = resolveTranslationModel(params.settings);
  const modelConfig = findProviderModelConfig(provider, selected.model);
  const reasoningParams = {
    providerId: provider.type,
    requestFormat: provider.requestFormat,
    modelId: selected.model,
    baseUrl: provider.baseUrl,
    modelConfig,
  };
  const reasoningSupported = getChatRuntimeReasoningLevelsForProvider(reasoningParams).length > 0;
  const runtime = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    requestFormat: provider.requestFormat,
    // 翻译是轻量任务，支持推理档位的模型统一关闭思考，降低延迟与消耗。
    reasoning: reasoningSupported ? "off" : undefined,
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
    modelConfig,
  } satisfies ProviderRuntimeConfig;

  const targetLanguage = TARGET_LANGUAGE_NAMES[params.targetLocale] ?? params.targetLocale;
  const context: Context = {
    systemPrompt: translationSystemPrompt(targetLanguage),
    messages: [{ role: "user", content: text, timestamp: Date.now() }],
    tools: [],
  };
  const assistant = await completeAssistantMessage({
    providerId: provider.type,
    model: selected.model,
    runtime,
    context,
    signal: params.signal,
  });
  const translated = assistantMessageToText(assistant).trim();
  if (!translated) {
    throw new Error("翻译模型没有返回内容");
  }
  return translated;
}
