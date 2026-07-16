import type { Context } from "@earendil-works/pi-ai";
import {
  assistantMessageToText,
  completeAssistantMessage,
  type ProviderRuntimeConfig,
} from "../providers/llm";
import {
  type AppSettings,
  findProviderModelConfig,
  getChatRuntimeReasoningLevelsForProvider,
  normalizeChatRuntimeControlsForProvider,
  type ProviderId,
} from "../settings";
import type { ResearchBundle, StockEvidenceResult } from "./types";

export type StockResearchModelSettings = Pick<
  AppSettings,
  "selectedModel" | "customProviders" | "chatRuntimeControls"
>;

export interface StockAiResearchBrief {
  summary: string;
  facts: string[];
  supportingCases: string[];
  counterCases: string[];
  risks: string[];
  openQuestions: string[];
  generatedAt: string;
  model: {
    customProviderId: string;
    providerId: ProviderId;
    model: string;
  };
}

export interface StockResearchModelRequest {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
}

export type StockResearchModelClient = (request: StockResearchModelRequest) => Promise<string>;

const STOCK_RESEARCH_SYSTEM_PROMPT = `你是 Calen 的只读股票研究分析器。
只能使用用户消息中提供的证据包，禁止调用外部知识、补全缺失数字或猜测最新事实。
必须明确区分：可核验事实、支持论据、反面论据、风险、待验证事项。
Provider 缺失、partial/unavailable、过期或互相矛盾的数据必须进入风险或待验证事项，不能被写成确定事实。
技术指标、评分、策略和 Evaluator 只能作为“实验性研究”描述，不能和事实数据混写。
不得输出买卖指令、目标价、目标仓位、保证收益或个性化投资建议。
仅输出一个合法 JSON 对象，不要输出 Markdown。JSON 必须且只能使用以下字段：
{"summary":"string","facts":["string"],"supportingCases":["string"],"counterCases":["string"],"risks":["string"],"openQuestions":["string"]}`;

function compactEvidenceValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length <= 4_000 ? trimmed : `${trimmed.slice(0, 4_000)}…[内容已截断]`;
  }
  if (depth >= 6) return "[嵌套内容已截断]";
  if (Array.isArray(value)) {
    const items = value.slice(0, 24).map((item) => compactEvidenceValue(item, depth + 1));
    if (value.length > items.length) items.push(`[其余 ${value.length - items.length} 项已截断]`);
    return items;
  }
  if (!value || typeof value !== "object") return String(value ?? "");
  const entries = Object.entries(value as Record<string, unknown>);
  const compacted = Object.fromEntries(
    entries.slice(0, 48).map(([key, item]) => [key, compactEvidenceValue(item, depth + 1)]),
  );
  if (entries.length > 48) compacted.__truncatedFields = entries.length - 48;
  return compacted;
}

export function buildStockResearchBriefPrompt(
  evidence: StockEvidenceResult<ResearchBundle>,
): string {
  const payload = {
    evidenceMetadata: {
      status: evidence.status,
      asOf: evidence.asOf,
      retrievedAt: evidence.retrievedAt,
      cached: evidence.cached,
      warnings: evidence.warnings,
      sources: evidence.sources,
    },
    instrument: evidence.data?.instrument ?? null,
    providerFacts: evidence.data
      ? {
          snapshot: evidence.data.snapshot ?? null,
          facts: evidence.data.facts,
          risks: evidence.data.risks,
          openQuestions: evidence.data.openQuestions,
          evidenceSections: evidence.data.evidenceSections,
          experimentalAnalysis: evidence.data.experimentalAnalysis,
          analysisMetadata: evidence.data.analysisMetadata ?? null,
        }
      : null,
  };
  return [
    "请基于以下 Calen 股票证据包生成研究简报。所有事实陈述都必须能在证据包中找到依据；证据不足时保留为空数组或写入待验证事项。",
    "证据包：",
    JSON.stringify(compactEvidenceValue(payload), null, 2),
  ].join("\n\n");
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型返回的研究简报不是有效 JSON");
  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("模型返回的研究简报不是有效 JSON");
  }
}

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("模型返回的研究简报格式不完整");
  }
  return value.trim();
}

function requiredTextArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("模型返回的研究简报格式不完整");
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

const PROHIBITED_TRADING_DIRECTIVES = [
  /(?:建议|应当|应该|宜|可以|可考虑|立即|现在)[^。；;！!\n]{0,16}(?:买入|卖出|加仓|减仓|建仓|清仓)/i,
  /(?:^|[。；;！!\n])\s*(?:立即|现在)?\s*(?:买入|卖出|加仓|减仓|建仓|清仓)/i,
  /目标价(?:格)?|目标仓位|建议仓位|保证收益|确定性收益|稳赚|必涨|必跌/i,
  /\b(?:recommend|should|must)\b[^.!?\n]{0,24}\b(?:buy|sell)\b/i,
  /\btarget price\b|\btarget position\b|\bposition size\b|\bguaranteed returns?\b/i,
] as const;

function rejectTradingDirectives(brief: Omit<StockAiResearchBrief, "generatedAt" | "model">) {
  const output = [
    brief.summary,
    ...brief.facts,
    ...brief.supportingCases,
    ...brief.counterCases,
    ...brief.risks,
    ...brief.openQuestions,
  ].join("\n");
  if (PROHIBITED_TRADING_DIRECTIVES.some((pattern) => pattern.test(output))) {
    throw new Error("模型返回的研究简报包含禁止的买卖、目标价、仓位或收益指令");
  }
}

export function parseStockAiResearchBrief(
  text: string,
): Omit<StockAiResearchBrief, "generatedAt" | "model"> {
  const record = extractJsonObject(text);
  const brief = {
    summary: requiredText(record, "summary"),
    facts: requiredTextArray(record, "facts"),
    supportingCases: requiredTextArray(record, "supportingCases"),
    counterCases: requiredTextArray(record, "counterCases"),
    risks: requiredTextArray(record, "risks"),
    openQuestions: requiredTextArray(record, "openQuestions"),
  };
  rejectTradingDirectives(brief);
  return brief;
}

async function callCalenResearchModel(request: StockResearchModelRequest): Promise<string> {
  const context: Context = {
    systemPrompt: request.systemPrompt,
    messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
    tools: [],
  };
  const assistant = await completeAssistantMessage({
    providerId: request.providerId,
    model: request.model,
    runtime: request.runtime,
    context,
    signal: request.signal,
    allowJsonOutput: true,
  });
  return assistantMessageToText(assistant).trim();
}

function resolveModel(settings: StockResearchModelSettings) {
  const selected = settings.selectedModel;
  if (!selected) throw new Error("请先在主对话中选择一个可用模型，再生成 AI 深度研究。");
  const provider = settings.customProviders.find((item) => item.id === selected.customProviderId);
  if (!provider) throw new Error("所选模型对应的供应商不存在，请重新选择模型。");
  if (!provider.activeModels.includes(selected.model)) {
    throw new Error("所选模型未启用，请重新选择模型。");
  }
  const modelConfig = findProviderModelConfig(provider, selected.model);
  const reasoningParams = {
    providerId: provider.type,
    requestFormat: provider.requestFormat,
    modelId: selected.model,
    baseUrl: provider.baseUrl,
    modelConfig,
  };
  const controls = normalizeChatRuntimeControlsForProvider(
    settings.chatRuntimeControls,
    reasoningParams,
  );
  const reasoningSupported = getChatRuntimeReasoningLevelsForProvider(reasoningParams).length > 0;
  return {
    selected,
    provider,
    runtime: {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      requestFormat: provider.requestFormat,
      reasoning: reasoningSupported
        ? controls.thinkingEnabled
          ? controls.reasoning
          : "off"
        : undefined,
      promptCachingEnabled: true,
      // Hub research must stay bounded by the sidecar evidence package.
      nativeWebSearchEnabled: false,
      modelConfig,
    } satisfies ProviderRuntimeConfig,
  };
}

export async function generateStockAiResearchBrief(params: {
  settings: StockResearchModelSettings;
  evidence: StockEvidenceResult<ResearchBundle>;
  signal?: AbortSignal;
  modelClient?: StockResearchModelClient;
  now?: () => Date;
}): Promise<StockAiResearchBrief> {
  if (!params.evidence.data) throw new Error("股票证据包不可用，无法生成 AI 深度研究。");
  const { selected, provider, runtime } = resolveModel(params.settings);
  const raw = await (params.modelClient ?? callCalenResearchModel)({
    providerId: provider.type,
    model: selected.model,
    runtime,
    systemPrompt: STOCK_RESEARCH_SYSTEM_PROMPT,
    prompt: buildStockResearchBriefPrompt(params.evidence),
    signal: params.signal,
  });
  return {
    ...parseStockAiResearchBrief(raw),
    generatedAt: (params.now ?? (() => new Date()))().toISOString(),
    model: {
      customProviderId: selected.customProviderId,
      providerId: provider.type,
      model: selected.model,
    },
  };
}
