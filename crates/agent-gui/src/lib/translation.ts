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
import {
  createTranslationFingerprint,
  isRecoverableOfflineTranslationError,
  TRANSLATION_PROMPT_VERSION,
  type TranslationBackend,
  translationBackendOrder,
  translationErrorMessage,
} from "./translation/policy";
import { stopOfflineTranslationRuntime, translateWithOfflineModel } from "./translation/tauri";

export type TranslationSettings = Pick<AppSettings, "selectedModel" | "customProviders"> & {
  customSettings: Pick<AppSettings["customSettings"], "translation" | "translationModel">;
};

export type TranslationResult = {
  text: string;
  backend: TranslationBackend;
  modelId: string;
  cached: boolean;
  warnings: string[];
};

export type TranslationPurpose = "skills-store";

export type TranslationRequest = {
  text: string;
  targetLocale: Locale;
  purpose: TranslationPurpose;
  signal?: AbortSignal;
};

export interface TranslationPort {
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

export {
  DEFAULT_OFFLINE_TRANSLATION_MODEL_ID,
  type TranslationMode,
} from "./translation/policy";
export { TRANSLATION_PROMPT_VERSION };

const TRANSLATION_CACHE_LIMIT = 256;
const translationCache = new Map<string, TranslationResult>();

const TARGET_LANGUAGE_NAMES: Record<Locale, string> = {
  "zh-CN": "Simplified Chinese",
  "en-US": "English",
};

type ConfiguredTranslationRequest = TranslationRequest & {
  settings: TranslationSettings;
};

function translationSystemPrompt(targetLanguage: string, purpose: TranslationPurpose) {
  const purposeInstruction =
    purpose === "skills-store"
      ? "The source is a Skills Store description or changelog. Preserve technical names and concise product wording."
      : "Preserve the source meaning and register.";
  return [
    `You are a translator. Translate the user's text into ${targetLanguage}.`,
    purposeInstruction,
    "Preserve the original Markdown structure, inline code, code blocks, URLs, and proper nouns such as product or tool names.",
    "Output ONLY the translated text with no preamble, notes, or quotation marks around it.",
  ].join("\n");
}

function createTranslationError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

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
  throw createTranslationError(
    "notFound",
    "没有可用的远程翻译模型：请先在主对话中选择模型，或在设置中指定远程翻译模型。",
  );
}

function resolveRemoteTranslationModelKey(settings: TranslationSettings): string {
  try {
    const { selected } = resolveTranslationModel(settings);
    return `${selected.customProviderId}/${selected.model}`;
  } catch {
    return "unavailable";
  }
}

async function translateRemote(request: ConfiguredTranslationRequest): Promise<TranslationResult> {
  const { selected, provider } = resolveTranslationModel(request.settings);
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
    reasoning: reasoningSupported ? "off" : undefined,
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
    modelConfig,
  } satisfies ProviderRuntimeConfig;

  const targetLanguage = TARGET_LANGUAGE_NAMES[request.targetLocale] ?? request.targetLocale;
  const context: Context = {
    systemPrompt: translationSystemPrompt(targetLanguage, request.purpose),
    messages: [{ role: "user", content: request.text, timestamp: Date.now() }],
    tools: [],
  };
  const assistant = await completeAssistantMessage({
    providerId: provider.type,
    model: selected.model,
    runtime,
    context,
    signal: request.signal,
  });
  const translated = assistantMessageToText(assistant).trim();
  if (!translated) throw new Error("翻译模型没有返回内容");
  return {
    text: translated,
    backend: "remote",
    modelId: selected.model,
    cached: false,
    warnings: [],
  };
}

function createAbortError() {
  return new DOMException("翻译已取消", "AbortError");
}

async function translateOffline(request: ConfiguredTranslationRequest): Promise<TranslationResult> {
  if (request.signal?.aborted) throw createAbortError();
  const modelId = request.settings.customSettings.translation.localModelId;
  let rejectOnAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => {
    void stopOfflineTranslationRuntime().catch(() => undefined);
    rejectOnAbort?.(createAbortError());
  };
  request.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const localRequest = translateWithOfflineModel({
      modelId,
      text: request.text,
      targetLanguage: TARGET_LANGUAGE_NAMES[request.targetLocale] ?? request.targetLocale,
    });
    const result = request.signal
      ? await Promise.race([localRequest, aborted])
      : await localRequest;
    const text = result.text.trim();
    if (!text) throw new Error("translationFailed: 离线模型没有返回内容");
    return {
      text,
      backend: "offline",
      modelId: result.modelId || modelId,
      cached: false,
      warnings: [],
    };
  } finally {
    request.signal?.removeEventListener("abort", onAbort);
  }
}

function createConfiguredTranslationPort(settings: TranslationSettings): TranslationPort {
  return {
    async translate(request) {
      const text = request.text.trim();
      if (!text) {
        throw createTranslationError("invalidArgument", "待翻译文本不能为空");
      }
      if (request.purpose !== "skills-store") {
        throw createTranslationError("invalidArgument", "不支持的翻译用途");
      }
      if (request.signal?.aborted) throw createAbortError();
      const normalizedRequest: ConfiguredTranslationRequest = { ...request, settings, text };
      const mode = settings.customSettings.translation.mode;
      const cacheKey = createTranslationFingerprint({
        purpose: request.purpose,
        targetLocale: request.targetLocale,
        text,
        mode,
        localModelId: settings.customSettings.translation.localModelId,
        remoteModelId: resolveRemoteTranslationModelKey(settings),
      });
      const cached = translationCache.get(cacheKey);
      if (cached) {
        translationCache.delete(cacheKey);
        translationCache.set(cacheKey, cached);
        return { ...cached, cached: true };
      }
      const backends = translationBackendOrder(mode);
      let result: TranslationResult;
      if (backends[0] === "remote") {
        result = await translateRemote(normalizedRequest);
      } else {
        try {
          result = await translateOffline(normalizedRequest);
        } catch (error) {
          if (backends[1] !== "remote" || !isRecoverableOfflineTranslationError(error)) throw error;
          const remoteResult = await translateRemote(normalizedRequest);
          result = {
            ...remoteResult,
            warnings: [
              `Offline translation was unavailable; used the remote model instead. ${translationErrorMessage(error)}`,
            ],
          };
        }
      }
      translationCache.set(cacheKey, result);
      while (translationCache.size > TRANSLATION_CACHE_LIMIT) {
        const oldestKey = translationCache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        translationCache.delete(oldestKey);
      }
      return result;
    },
  };
}

export function createTranslationPort(settings: TranslationSettings): TranslationPort {
  return createConfiguredTranslationPort(settings);
}

export function isTranslationSetupRequired(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === "notFound" ||
    code === "notInstalled" ||
    code === "integrityMismatch" ||
    code === "runtimeUnavailable"
  );
}
