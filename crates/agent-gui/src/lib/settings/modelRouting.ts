import type { CustomProvider, ProviderId, SelectedModel } from "./index";

/**
 * 系统任务角色模型路由（一期）。
 *
 * - chat：主对话当前模型（可被 Gateway override）
 * - conversationTitle / translation / compaction / quickAsk：可选专用模型，缺省跟随 chat
 * - memoryOrganizer：强制专用（无主模型回退，保持现有语义）
 * - memoryExtraction：可选专用，缺省表示关闭独立总结模型（由调用方决定是否再 fallback）
 */
export type ModelRole =
  | "chat"
  | "conversationTitle"
  | "translation"
  | "memoryOrganizer"
  | "memoryExtraction"
  | "compaction"
  | "quickAsk"
  | "subagent"
  | "vision";

export type ResolvedRoleModel = {
  selectedModel: SelectedModel;
  provider: CustomProvider;
  providerId: ProviderId;
  model: string;
  role: ModelRole;
  source: "role" | "fallback-chat" | "fallback-first-available" | "fallback-parent";
};

export type ChatModelFallback = {
  selectedModel: SelectedModel;
  provider: CustomProvider;
  providerId: ProviderId;
  model: string;
};

/** 校验 SelectedModel 是否对应已启用的 provider/model；失败返回 null。 */
export function resolveEnabledSelectedModel(
  selected: SelectedModel | undefined,
  customProviders: CustomProvider[],
): ChatModelFallback | null {
  if (!selected) return null;
  const provider = customProviders.find((item) => item.id === selected.customProviderId);
  if (!provider?.activeModels.includes(selected.model)) return null;
  return {
    selectedModel: selected,
    provider,
    providerId: provider.type,
    model: selected.model,
  };
}

/** 找第一个配置了 API Key 且有 activeModels 的 provider（Quick Ask 冷启动兜底）。 */
export function resolveFirstAvailableModel(
  customProviders: CustomProvider[],
): ChatModelFallback | null {
  const provider = customProviders.find(
    (item) => item.apiKey.trim().length > 0 && item.activeModels.length > 0,
  );
  const model = provider?.activeModels[0];
  if (!provider || !model) return null;
  return {
    selectedModel: { customProviderId: provider.id, model },
    provider,
    providerId: provider.type,
    model,
  };
}

/**
 * 专用模型 → 主对话模型。
 * 专用模型缺失或失效时静默回退到 fallback（与标题生成现有语义一致）。
 */
export function resolveFollowCurrentRoleModel(
  roleModel: SelectedModel | undefined,
  customProviders: CustomProvider[],
  fallback: ChatModelFallback,
  role: ModelRole,
): ResolvedRoleModel {
  const resolved = resolveEnabledSelectedModel(roleModel, customProviders);
  if (resolved) {
    return { ...resolved, role, source: "role" };
  }
  return { ...fallback, role, source: "fallback-chat" };
}

export function resolveConversationTitleRoleModel(
  settings: {
    customProviders: CustomProvider[];
    customSettings: { conversationTitleModel?: SelectedModel };
  },
  fallback: ChatModelFallback,
): ResolvedRoleModel {
  return resolveFollowCurrentRoleModel(
    settings.customSettings.conversationTitleModel,
    settings.customProviders,
    fallback,
    "conversationTitle",
  );
}

export function resolveCompactionRoleModel(
  settings: {
    customProviders: CustomProvider[];
    customSettings: { compactionModel?: SelectedModel };
  },
  fallback: ChatModelFallback,
): ResolvedRoleModel {
  return resolveFollowCurrentRoleModel(
    settings.customSettings.compactionModel,
    settings.customProviders,
    fallback,
    "compaction",
  );
}

/**
 * 翻译：专用 → 主对话。
 * 两者都不可用时返回 null，由调用方抛领域错误。
 */
export function resolveTranslationRoleModel(settings: {
  selectedModel?: SelectedModel;
  customProviders: CustomProvider[];
  customSettings: { translationModel?: SelectedModel };
}): ResolvedRoleModel | null {
  const role = resolveEnabledSelectedModel(
    settings.customSettings.translationModel,
    settings.customProviders,
  );
  if (role) {
    return { ...role, role: "translation", source: "role" };
  }
  const chat = resolveEnabledSelectedModel(settings.selectedModel, settings.customProviders);
  if (chat) {
    return { ...chat, role: "translation", source: "fallback-chat" };
  }
  return null;
}

/**
 * 记忆对话总结：仅在显式配置且合法时返回；否则 null（保持「可选能力」语义，不自动跟随主模型）。
 */
export function resolveMemoryExtractionRoleModel(settings: {
  customProviders: CustomProvider[];
  memory: { summaryModel?: SelectedModel };
}): ResolvedRoleModel | null {
  const resolved = resolveEnabledSelectedModel(
    settings.memory.summaryModel,
    settings.customProviders,
  );
  if (!resolved) return null;
  return { ...resolved, role: "memoryExtraction", source: "role" };
}

/**
 * 记忆整理：强制专用模型。无效时返回 null，由调用方报错引导用户去设置。
 */
export function resolveMemoryOrganizerRoleModel(
  settings: {
    customProviders: CustomProvider[];
    memory: { organizerModel?: SelectedModel };
  },
  runModel?: SelectedModel,
): ResolvedRoleModel | null {
  const resolved = resolveEnabledSelectedModel(
    runModel ?? settings.memory.organizerModel,
    settings.customProviders,
  );
  if (!resolved) return null;
  return { ...resolved, role: "memoryOrganizer", source: "role" };
}

/**
 * Quick Ask：专用 → 主对话 → 第一个可用 provider。
 */
export function resolveQuickAskRoleModel(settings: {
  selectedModel?: SelectedModel;
  customProviders: CustomProvider[];
  customSettings: { quickAskModel?: SelectedModel };
}): ResolvedRoleModel | null {
  const role = resolveEnabledSelectedModel(
    settings.customSettings.quickAskModel,
    settings.customProviders,
  );
  if (role) {
    return { ...role, role: "quickAsk", source: "role" };
  }
  const chat = resolveEnabledSelectedModel(settings.selectedModel, settings.customProviders);
  if (chat) {
    return { ...chat, role: "quickAsk", source: "fallback-chat" };
  }
  const first = resolveFirstAvailableModel(settings.customProviders);
  if (first) {
    return { ...first, role: "quickAsk", source: "fallback-first-available" };
  }
  return null;
}

/**
 * 子代理模型：模板 selectedModel → 全局 subagentDefault → 父 turn。
 * parent 是当前父对话 turn 的有效模型（可含 Gateway override）。
 */
export function resolveSubagentRoleModel(
  settings: {
    customProviders: CustomProvider[];
    customSettings: { subagentDefaultModel?: SelectedModel };
  },
  parent: ChatModelFallback,
  templateModel?: SelectedModel,
): ResolvedRoleModel {
  const fromTemplate = resolveEnabledSelectedModel(templateModel, settings.customProviders);
  if (fromTemplate) {
    return { ...fromTemplate, role: "subagent", source: "role" };
  }
  const fromDefault = resolveEnabledSelectedModel(
    settings.customSettings.subagentDefaultModel,
    settings.customProviders,
  );
  if (fromDefault) {
    return { ...fromDefault, role: "subagent", source: "role" };
  }
  return { ...parent, role: "subagent", source: "fallback-parent" };
}

/**
 * 视觉路由候选：visionModel → quickAskModel → chat（仅当 chat 有 vision）→ null。
 * 调用方负责用 selectedModelSupportsVision 判断 chat 是否真支持看图。
 */
export function resolveVisionRoleModelCandidates(settings: {
  selectedModel?: SelectedModel;
  customProviders: CustomProvider[];
  customSettings: {
    visionModel?: SelectedModel;
    quickAskModel?: SelectedModel;
  };
}): Array<{
  selected: SelectedModel;
  provider: CustomProvider;
  source: ResolvedRoleModel["source"];
}> {
  const out: Array<{
    selected: SelectedModel;
    provider: CustomProvider;
    source: ResolvedRoleModel["source"];
  }> = [];
  const push = (selected: SelectedModel | undefined, source: ResolvedRoleModel["source"]) => {
    const resolved = resolveEnabledSelectedModel(selected, settings.customProviders);
    if (!resolved) return;
    if (
      out.some(
        (item) =>
          item.selected.customProviderId === resolved.selectedModel.customProviderId &&
          item.selected.model === resolved.model,
      )
    ) {
      return;
    }
    out.push({ selected: resolved.selectedModel, provider: resolved.provider, source });
  };
  push(settings.customSettings.visionModel, "role");
  push(settings.customSettings.quickAskModel, "role");
  push(settings.selectedModel, "fallback-chat");
  return out;
}
