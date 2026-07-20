import type { Model } from "@earendil-works/pi-ai";

import type {
  CustomProvider,
  ModelCapability,
  ProviderId,
  ProviderModelConfig,
  SelectedModel,
} from "../settings";
import { createModelFromConfig } from "./llm";

/** 从模型配置读取显式 capability；未声明时返回 null（表示未知，需启发式）。 */
export function getExplicitModelCapabilities(
  modelConfig?: ProviderModelConfig,
): ModelCapability[] | null {
  if (!modelConfig?.capabilities || modelConfig.capabilities.length === 0) return null;
  return modelConfig.capabilities;
}

export function modelConfigHasCapability(
  modelConfig: ProviderModelConfig | undefined,
  capability: ModelCapability,
): boolean | null {
  const caps = getExplicitModelCapabilities(modelConfig);
  if (!caps) return null;
  return caps.includes(capability);
}

export function modelSupportsImageInput(
  model: Pick<Model<any>, "input"> | null | undefined,
): boolean {
  return Array.isArray(model?.input) && model.input.includes("image");
}

/**
 * 判断 SelectedModel 是否支持 vision。
 * 显式 capabilities 优先；否则用 createModelFromConfig 启发式。
 */
export function selectedModelSupportsVision(params: {
  selected: SelectedModel;
  provider: CustomProvider;
  modelConfig?: ProviderModelConfig;
}): boolean {
  const explicit = modelConfigHasCapability(params.modelConfig, "vision");
  if (explicit !== null) return explicit;
  try {
    const model = createModelFromConfig(
      params.provider.type as ProviderId,
      params.selected.model,
      params.provider.baseUrl,
      params.provider.requestFormat,
      params.modelConfig,
    );
    return modelSupportsImageInput(model);
  } catch {
    return false;
  }
}
