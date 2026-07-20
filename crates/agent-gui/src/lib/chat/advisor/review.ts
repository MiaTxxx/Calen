import type { Context } from "@earendil-works/pi-ai";

import type { Locale } from "../../../i18n";
import {
  assistantMessageToText,
  completeAssistantMessage,
  type ProviderRuntimeConfig,
} from "../../providers/llm";
import {
  type AppSettings,
  findProviderModelConfig,
  getChatRuntimeReasoningLevelsForProvider,
  resolveAdvisorRoleModel,
} from "../../settings";

export type AdvisorReviewInput = {
  settings: Pick<AppSettings, "customProviders" | "customSettings">;
  locale: Locale;
  /** 用户原始问题（可含截图说明，不含 base64）。 */
  userText: string;
  /** 主模型给出的回答。 */
  assistantText: string;
  signal?: AbortSignal;
};

export type AdvisorReviewResult = {
  text: string;
  model: string;
  providerName: string;
};

function advisorSystemPrompt(locale: Locale): string {
  const language = locale === "en-US" ? "English" : "Simplified Chinese";
  return [
    "You are Calen Advisor, a careful second-opinion reviewer.",
    "You receive the user's question and a primary assistant answer.",
    "Review correctness, missing caveats, and risky claims.",
    "Start with a one-line verdict: OK / Needs correction / Incomplete.",
    "Then list at most 5 concrete notes. Prefer short bullets.",
    "Do not rewrite the whole answer unless a critical error requires a corrected version.",
    "Do not invent facts that are not supported by the given materials.",
    `Answer in ${language}.`,
  ].join("\n");
}

/**
 * 轻量顾问复审：用专用 advisorModel 对主回答做一次非流式点评。
 * 未配置模型时返回 null，由 UI 提示去设置。
 */
export async function runAdvisorReview(
  input: AdvisorReviewInput,
): Promise<AdvisorReviewResult | null> {
  const resolved = resolveAdvisorRoleModel(input.settings);
  if (!resolved) return null;

  const modelConfig = findProviderModelConfig(resolved.provider, resolved.model);
  const reasoningSupported =
    getChatRuntimeReasoningLevelsForProvider({
      providerId: resolved.providerId,
      requestFormat: resolved.provider.requestFormat,
      modelId: resolved.model,
      baseUrl: resolved.provider.baseUrl,
      modelConfig,
    }).length > 0;
  const runtime: ProviderRuntimeConfig = {
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.provider.apiKey,
    requestFormat: resolved.provider.requestFormat,
    reasoning: reasoningSupported ? "off" : undefined,
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
    modelConfig,
  };

  const userText = input.userText.trim() || "(empty user text)";
  const assistantText = input.assistantText.trim() || "(empty assistant text)";
  const context: Context = {
    systemPrompt: advisorSystemPrompt(input.locale),
    tools: [],
    messages: [
      {
        role: "user",
        content: [
          "User question:",
          userText,
          "",
          "Primary assistant answer:",
          assistantText,
          "",
          "Please review.",
        ].join("\n"),
        timestamp: Date.now(),
      },
    ],
  };

  const assistant = await completeAssistantMessage({
    providerId: resolved.providerId,
    model: resolved.model,
    runtime,
    context,
    signal: input.signal,
  });

  return {
    text: assistantMessageToText(assistant).trim(),
    model: resolved.model,
    providerName: resolved.provider.name,
  };
}
