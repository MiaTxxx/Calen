import type { Context, Message, UserMessage } from "@earendil-works/pi-ai";
import type { Locale } from "../../i18n";
import type { ProviderRuntimeConfig } from "../providers/llm";
import {
  type AppSettings,
  type CustomProvider,
  findProviderModelConfig,
  getChatRuntimeReasoningLevelsForProvider,
  resolveQuickAskRoleModel,
  type SelectedModel,
} from "../settings";

export type QuickAskModelResolution = {
  selected: SelectedModel;
  provider: CustomProvider;
  runtime: ProviderRuntimeConfig;
};

export class QuickAskModelError extends Error {}

type QuickAskModelSettings = Pick<
  AppSettings,
  "selectedModel" | "customProviders" | "customSettings"
>;

/**
 * 快捷提问优先使用专用 quickAskModel（适合 vision）；
 * 否则主对话模型；再否则第一个配置了 API Key 且有可用模型的 provider。
 */
export function resolveQuickAskModel(settings: QuickAskModelSettings): QuickAskModelResolution {
  const resolved = resolveQuickAskRoleModel(settings);
  if (!resolved) {
    throw new QuickAskModelError("no-model");
  }

  const { selectedModel: selected, provider } = resolved;
  const modelConfig = findProviderModelConfig(provider, selected.model);
  const reasoningSupported =
    getChatRuntimeReasoningLevelsForProvider({
      providerId: provider.type,
      requestFormat: provider.requestFormat,
      modelId: selected.model,
      baseUrl: provider.baseUrl,
      modelConfig,
    }).length > 0;
  const runtime: ProviderRuntimeConfig = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    requestFormat: provider.requestFormat,
    // 快捷提问追求响应速度，思考等级固定关闭。
    reasoning: reasoningSupported ? "off" : undefined,
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
    modelConfig,
  };
  return { selected, provider, runtime };
}

export function quickAskSystemPrompt(locale: Locale): string {
  const language = locale === "en-US" ? "English" : "Simplified Chinese";
  return [
    "You are Calen Quick Ask, a lightweight screenshot assistant.",
    "The user captured a region of their screen (often a formula, error message, chart, or code) and wants a fast, clear explanation.",
    "Ground every answer in what is actually visible in the screenshot; say so plainly when something is unreadable or ambiguous.",
    "Prefer a short, direct answer first, then add brief supporting detail only when it helps.",
    `Answer in ${language} unless the user asks otherwise.`,
  ].join("\n");
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) return undefined;
  return { mimeType: match[1], data: match[2] };
}

/** 构造一条用户消息；截图作为 provider 原生 image 内容块随消息发送。 */
export function buildQuickAskUserMessage(text: string, imageDataUrl?: string): UserMessage {
  const image = imageDataUrl ? splitDataUrl(imageDataUrl) : undefined;
  return {
    role: "user",
    content: image
      ? [
          { type: "image", data: image.data, mimeType: image.mimeType },
          { type: "text", text },
        ]
      : text,
    timestamp: Date.now(),
  };
}

export function buildQuickAskContext(messages: Message[], locale: Locale): Context {
  return {
    systemPrompt: quickAskSystemPrompt(locale),
    tools: [],
    messages,
  };
}
