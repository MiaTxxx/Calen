import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { prepareProxyRequest } from "../providers/proxy";
import { buildProviderAuthHeaders } from "../providers/runtime/requestOptions";
import type { AppSettings, CustomProvider, SelectedModel } from "../settings";
import { findProviderModelConfig, resolveEnabledSelectedModel } from "../settings";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

export type ImageGenToolSettings = Pick<
  AppSettings,
  "selectedModel" | "customProviders" | "customSettings"
>;

type ImageGenResolution = {
  selected: SelectedModel;
  provider: CustomProvider;
};

function resolveImageGenModel(settings: ImageGenToolSettings): ImageGenResolution {
  const candidates: Array<SelectedModel | undefined> = [
    settings.customSettings.imageGenModel,
    settings.selectedModel,
  ];
  for (const candidate of candidates) {
    const resolved = resolveEnabledSelectedModel(candidate, settings.customProviders);
    if (!resolved) continue;
    const config = findProviderModelConfig(resolved.provider, resolved.model);
    const caps = config?.capabilities;
    if (candidate === settings.customSettings.imageGenModel) {
      return { selected: resolved.selectedModel, provider: resolved.provider };
    }
    if (caps?.includes("image_gen")) {
      return { selected: resolved.selectedModel, provider: resolved.provider };
    }
  }
  throw new Error(
    "没有可用的生图模型。请在设置 → 自定义设置中配置「生图模型」，并在模型设置中勾选「支持生图」。",
  );
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (base.endsWith("/v1") && suffix.startsWith("/v1/")) {
    return `${base}${suffix.slice(3)}`;
  }
  return `${base}${suffix}`;
}

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: { message?: string };
};

async function callOpenAICompatibleImages(params: {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  signal?: AbortSignal;
}): Promise<{ mimeType: string; dataBase64?: string; url?: string; revisedPrompt?: string }> {
  if (params.provider.type !== "codex") {
    throw new Error(
      `当前仅支持 OpenAI 兼容（codex）生图 API；所选 provider 类型为 ${params.provider.type}。`,
    );
  }
  const authHeaders = buildProviderAuthHeaders(params.provider.type, params.provider.apiKey);
  const proxy = await prepareProxyRequest(params.provider.type, params.provider.baseUrl, {
    ...authHeaders,
    "Content-Type": "application/json",
  });
  const url = joinUrl(proxy.baseUrl, "/images/generations");
  const response = await fetch(url, {
    method: "POST",
    headers: proxy.headers,
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      n: 1,
      response_format: "b64_json",
    }),
    signal: params.signal,
  });
  const raw = await response.text();
  let json: OpenAIImageResponse = {};
  try {
    json = raw ? (JSON.parse(raw) as OpenAIImageResponse) : {};
  } catch {
    throw new Error(`生图接口返回非 JSON：HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(json.error?.message?.trim() || `生图请求失败：HTTP ${response.status}`);
  }
  const first = json.data?.[0];
  if (!first) throw new Error("生图接口未返回图片数据");
  if (first.b64_json) {
    return {
      mimeType: "image/png",
      dataBase64: first.b64_json,
      revisedPrompt: first.revised_prompt,
    };
  }
  if (first.url) {
    return {
      mimeType: "image/png",
      url: first.url,
      revisedPrompt: first.revised_prompt,
    };
  }
  throw new Error("生图接口既无 b64_json 也无 url");
}

/** 是否应注册生图工具：配置了专用模型，或主模型显式声明 image_gen。 */
export function shouldEnableImageGenTools(settings: ImageGenToolSettings): boolean {
  if (settings.customSettings.imageGenModel) {
    return Boolean(
      resolveEnabledSelectedModel(settings.customSettings.imageGenModel, settings.customProviders),
    );
  }
  if (!settings.selectedModel) return false;
  const resolved = resolveEnabledSelectedModel(settings.selectedModel, settings.customProviders);
  if (!resolved) return false;
  const caps = findProviderModelConfig(resolved.provider, resolved.model)?.capabilities;
  return caps?.includes("image_gen") === true;
}

/**
 * GenerateImage：Agent 模式下可选的生图工具。
 * 配置了 imageGenModel（或主模型标了 image_gen）时注册。
 */
export function createImageGenTools(params: { settings: ImageGenToolSettings }): BuiltinToolBundle {
  const tool: Tool = {
    name: "GenerateImage",
    description: [
      "Generate an image from a text prompt using the user-configured image generation model.",
      "Use only when the user explicitly asks to generate/draw/create an image.",
      "Do not invent investment charts, fake financial screenshots, or misleading evidence images.",
      "Prefer a concise, concrete English prompt for better model quality unless the user requires another language.",
    ].join(" "),
    parameters: Type.Object({
      prompt: Type.String({
        minLength: 1,
        description: "Image generation prompt.",
      }),
      size: Type.Optional(
        Type.Union(
          [
            Type.Literal("1024x1024"),
            Type.Literal("1024x1792"),
            Type.Literal("1792x1024"),
            Type.Literal("512x512"),
            Type.Literal("256x256"),
          ],
          { description: "Output size. Default 1024x1024." },
        ),
      ),
    }),
  };

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    if (toolCall.name !== "GenerateImage") {
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
        isError: true,
        timestamp: Date.now(),
      };
    }
    try {
      const args = (toolCall.arguments ?? {}) as { prompt?: string; size?: string };
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("prompt 不能为空");
      const size = String(args.size ?? "1024x1024");
      const resolved = resolveImageGenModel(params.settings);
      const image = await callOpenAICompatibleImages({
        provider: resolved.provider,
        model: resolved.selected.model,
        prompt,
        size,
        signal,
      });
      const details = {
        kind: "image_generation" as const,
        model: resolved.selected.model,
        providerId: resolved.provider.id,
        prompt,
        size,
        mimeType: image.mimeType,
        revisedPrompt: image.revisedPrompt,
        url: image.url,
      };
      const content: ToolResultMessage["content"] = [];
      if (image.dataBase64) {
        content.push({
          type: "image",
          data: image.dataBase64,
          mimeType: image.mimeType,
        });
      }
      content.push({
        type: "text",
        text: [
          `Generated with ${resolved.provider.name} / ${resolved.selected.model} (${size}).`,
          image.revisedPrompt ? `Revised prompt: ${image.revisedPrompt}` : null,
          image.url ? `URL: ${image.url}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content,
        details,
        isError: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: message }],
        isError: true,
        timestamp: Date.now(),
      };
    }
  }

  return {
    groupId: "image_gen",
    tools: [tool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "GenerateImage",
        {
          groupId: "image_gen",
          kind: "image_generation",
          isReadOnly: false,
          displayCategory: "system",
        },
      ],
    ]),
  };
}
