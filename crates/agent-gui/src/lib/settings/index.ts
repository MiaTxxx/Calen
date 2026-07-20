import type { KnownProvider, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_LOCALE, type Locale, normalizeLocale } from "../../i18n/config";
import { getAvailableThinkingLevelsForModel } from "../providers/runtime/modelFactory";
import { mergeAlwaysEnabledSkillNames } from "../skills/builtin";
import { SYSTEM_TOOL_OPTIONS, type SystemToolId } from "../tools/systemToolOptions";
import {
  normalizeTranslationPreferences,
  type TranslationPreferences,
} from "../translation/policy";
import { normalizeApiKey, normalizeBaseUrl, normalizeModels } from "./normalize";

export type { SystemToolId } from "../tools/systemToolOptions";
export type { TranslationMode, TranslationPreferences } from "../translation/policy";

export type ProviderId = "codex" | "claude_code" | "gemini";

export type ExecutionMode = "text" | "tools" | "agent-dev";

/** Windows agent shell preference for Bash tool / ManagedProcess spawn chain. */
export type DefaultShellPreference = "auto" | "bash" | "powershell";

export type CodexRequestFormat = "openai-completions" | "openai-responses";

export type ReasoningLevel = ModelThinkingLevel;

export type McpTransport = "stdio" | "http" | "sse";

export type McpServerConfig = {
  id: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  args: string[];
  url: string;
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  messageUrl?: string;
};

export type McpSettings = {
  servers: McpServerConfig[];
  selected: string[];
};

export type SkillsSettings = {
  enabled: boolean;
  selected: string[];
};

export type MemoryOrganizerScope = "all" | "global" | "projects" | "current-project";
export type MemoryOrganizerMode = "conservative" | "standard" | "aggressive";
export type MemoryOrganizerFrequency = "none" | "daily" | "weekly";

export type MemoryOrganizerSchedule = {
  frequency: MemoryOrganizerFrequency;
  timeLocal: string;
  weekday?: number;
  timezone: string;
};

export type MemorySettings = {
  organizerModel?: SelectedModel;
  summaryModel?: SelectedModel;
  organizerEnabled: boolean;
  organizerSchedule: MemoryOrganizerSchedule;
  organizerScope: MemoryOrganizerScope;
  organizerMode: MemoryOrganizerMode;
  organizerLastRunAt?: number;
  organizerNextRunAt?: number;
};

export type ChatSidebarSettings = {
  projectsCollapsed: boolean;
  recentCollapsed: boolean;
};

export const RIGHT_DOCK_TOOL_KINDS = ["fileTree", "gitReview", "tunnel", "sshTunnel"] as const;

export type RightDockToolKind = (typeof RIGHT_DOCK_TOOL_KINDS)[number];

export type RightDockTabKind = RightDockToolKind | "terminal" | "backgroundTasks";

export type RightDockToolTab = {
  openedAt: number;
  uiState?: Record<string, unknown>;
};

// Persisted dock state is user intent only: terminal tab existence is derived
// from live sessions at render time, so tabOrder may contain session ids that
// are dead or not yet loaded — they are preserved here and lazily collected on
// user gestures once the session list is known.
export type RightDockProjectState = {
  activeTabId?: string;
  tabOrder: string[];
  tools: Partial<Record<RightDockToolKind, RightDockToolTab>>;
  openVersion: number;
  stateVersion: number;
  writerId: string;
  lastUsedAt: number;
};

export type RightDockSettings = {
  width: number;
  projects: Record<string, RightDockProjectState>;
};

export type RightDockFileTreeState = {
  query: string;
  selectedPath: string;
  expandedPaths: string[];
  // Reveal nonce: bumped (via bumpRevision) when another surface asks the
  // file tree to reveal selectedPath (expand ancestors + scroll into view).
  // Content refreshes are driven by workspace-activity invalidation, and
  // merge ordering is covered by the project-level stateVersion.
  revision: number;
};

export type RightDockFileTreeStatePatch = Partial<RightDockFileTreeState> & {
  bumpRevision?: boolean;
};

export type FontScaleSettings = {
  sidebar: number;
  chat: number;
  rightDock: number;
};

export type DraftPersistenceSettings = {
  enabled: boolean;
};
export type ProviderHistoryItem = {
  id: string;
  type: ProviderId;
  name: string;
  baseUrl: string;
  updatedAt: number;
  hidden: boolean;
};
export type ProviderHistorySettings = { enabled: boolean; items: ProviderHistoryItem[] };

export type ChatLayoutSettings = {
  contentWidth: number;
  composerHeight: number;
  fullWidth: boolean;
};

export const APPEARANCE_SURFACES = [
  "app",
  "titleBar",
  "sidebar",
  "chatCanvas",
  "composer",
  "rightDock",
  "card",
  "userBubble",
  "primaryText",
  "secondaryText",
  "border",
  "accent",
] as const;
export type AppearanceSurface = (typeof APPEARANCE_SURFACES)[number];
export type AppearancePalette = Record<AppearanceSurface, string>;
export type AppearanceFontFamily = "system" | "openai" | "cjk" | "serif" | "monospace" | "local";
export type AppearanceSettings = {
  version: 1;
  light: AppearancePalette;
  dark: AppearancePalette;
  fontFamily: AppearanceFontFamily;
  localFontName: string;
};

export const DEFAULT_CHAT_LAYOUT: ChatLayoutSettings = {
  contentWidth: 768,
  composerHeight: 70,
  fullWidth: false,
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  version: 1,
  light: {
    app: "#ffffff",
    titleBar: "#e4e7eb",
    sidebar: "#f5f6f8",
    chatCanvas: "#ffffff",
    composer: "#ffffff",
    rightDock: "#f7f8fa",
    card: "#ffffff",
    userBubble: "#edf1f5",
    primaryText: "#111827",
    secondaryText: "#667085",
    border: "#cfd5dd",
    accent: "#2563eb",
  },
  dark: {
    app: "#15171c",
    titleBar: "#20242b",
    sidebar: "#191c22",
    chatCanvas: "#15171c",
    composer: "#22262d",
    rightDock: "#191c22",
    card: "#20242b",
    userBubble: "#2b313a",
    primaryText: "#f4f6f8",
    secondaryText: "#aeb6c2",
    border: "#3a414c",
    accent: "#60a5fa",
  },
  fontFamily: "openai",
  localFontName: "",
};

// 主界面自定义背景：图片文件落盘在 ~/.calen/backgrounds（兼容 ~/.liveagent/backgrounds），这里只存路径与遮罩参数。
export type BackgroundSettings = {
  enabled: boolean;
  imagePath: string;
  // 遮罩不透明度（0.1-0.9），越大背景越暗淡、内容越可读。
  opacity: number;
  // 遮罩模糊半径（0-24px）。
  blur: number;
};

export type CustomSettings = {
  conversationTitleModel?: SelectedModel;
  conversationTitleEnabled: boolean;
  // 技能商店等处的描述翻译模型；未设置时回退到当前对话模型。
  translationModel?: SelectedModel;
  // 上下文压缩模型；未设置时回退到当前对话模型。
  compactionModel?: SelectedModel;
  // 截屏即问（Quick Ask）模型，适合 vision；未设置时回退主对话，再回退第一个可用模型。
  quickAskModel?: SelectedModel;
  // 主对话发图时的视觉模型；未设时可用 quickAskModel，再回退主模型（若支持 vision）。
  visionModel?: SelectedModel;
  /**
   * 主对话发图视觉路由：
   * - auto：主模型不支持 vision 时自动切换（默认）
   * - off：不切换；主模型不支持 vision 时直接报错
   */
  visionRoutingMode: "auto" | "off";
  // 生图模型；用于 GenerateImage 工具。需模型标记 image_gen 能力，或 OpenAI 兼容 images API。
  imageGenModel?: SelectedModel;
  // 顾问复审模型；未设时不可用顾问入口。
  advisorModel?: SelectedModel;
  // 子代理默认模型；未设置时跟随父对话 turn 模型。模板 selectedModel 优先于此。
  subagentDefaultModel?: SelectedModel;
  // 翻译路由与本地模型选择只在当前设备生效，不进入 Gateway 同步。
  translation: TranslationPreferences;
  chatSidebar: ChatSidebarSettings;
  rightDock: RightDockSettings;
  fontScale: FontScaleSettings;
  background: BackgroundSettings;
  draftPersistence: DraftPersistenceSettings;
  chatLayout: ChatLayoutSettings;
  appearance: AppearanceSettings;
  providerHistory: ProviderHistorySettings;
};

export type UpdateSettings = {
  includePrereleases: boolean;
};

export type SystemSettings = {
  executionMode: ExecutionMode;
  workdir: string;
  selectedSystemTools: SystemToolId[];
  /**
   * Windows agent shell preference for Bash / ManagedProcess.
   * - auto: platform default (Windows: pwsh → powershell → cmd)
   * - bash: prefer Git Bash / bash.exe, then fall back to PowerShell chain
   * - powershell: prefer PowerShell chain only
   */
  defaultShell: DefaultShellPreference;
  workspaceProjects: WorkspaceProject[];
  activeWorkspaceProjectId?: string;
  hiddenWorkspaceProjectPaths: string[];
  missingWorkspaceProjectPaths: string[];
  // 仅隐藏侧边栏里的 Default Project 行；兜底工作目录本身不受影响。
  hideDefaultWorkspaceProject: boolean;
  /**
   * 截屏即问（Quick Ask）全局快捷键。空字符串表示禁用；
   * 语法与 tauri-plugin-global-shortcut 一致（如 "CmdOrCtrl+Shift+A"）。
   */
  quickAskHotkey: string;
};

export const DEFAULT_QUICK_ASK_HOTKEY = "CmdOrCtrl+Shift+A";

export function normalizeQuickAskHotkey(input: unknown): string {
  // 缺失/类型不对 → 默认；显式空字符串 → 保留（禁用）。与 Rust 端归一化保持一致。
  if (typeof input !== "string") return DEFAULT_QUICK_ASK_HOTKEY;
  return input.trim();
}

/**
 * 把 Tauri 全局快捷键内部写法（CmdOrCtrl 等）转成面向用户的展示文本。
 * Windows/Linux 显示 Ctrl，macOS 显示 ⌘；存储值本身不改。
 */
export function formatQuickAskHotkeyForDisplay(
  hotkey: string,
  platform: "windows" | "macos" | "linux" = "windows",
): string {
  const primary = platform === "macos" ? "⌘" : "Ctrl";
  return hotkey
    .replace(/\bCmdOrCtrl\b/gi, primary)
    .replace(/\bCommandOrControl\b/gi, primary)
    .replace(/\bControl\b/gi, "Ctrl")
    .replace(/\bCommand\b/gi, platform === "macos" ? "⌘" : "Cmd")
    .replace(/\bOption\b/gi, platform === "macos" ? "⌥" : "Alt")
    .replace(/⇧/g, "Shift");
}

/** 用户在设置页输入时，把展示用符号归一成 Tauri 可解析的修饰键写法。 */
export function normalizeQuickAskHotkeyInput(input: string): string {
  return input
    .trim()
    .replace(/⌘/g, "Cmd")
    .replace(/⌥/g, "Alt")
    .replace(/⇧/g, "Shift")
    .replace(/\bcontrol\b/gi, "Ctrl")
    .replace(/\bcommand\b/gi, "Cmd");
}

export type WorkspaceProjectKind = "managed" | "folder" | "history";

export type WorkspaceProject = {
  id: string;
  name: string;
  path: string;
  kind: WorkspaceProjectKind;
  createdAt: number;
  updatedAt: number;
  lastConversationAt?: number;
  isPinned?: boolean;
  pinnedAt?: number | null;
};

export type SelectedModel = {
  customProviderId: string;
  model: string;
};

export type ModelCapability = "text" | "vision" | "image_gen";

export type ProviderModelConfig = {
  id: string;
  contextWindow: number;
  maxOutputToken: number;
  /** 可选显式能力；缺省时由 createModelFromConfig 启发式推断。 */
  capabilities?: ModelCapability[];
};

export type ChatRuntimeControls = {
  thinkingEnabled: boolean;
  nativeWebSearchEnabled: boolean;
  reasoning: ReasoningLevel;
  reasoningByProvider: Partial<Record<ChatRuntimeReasoningProviderKey, ReasoningLevel>>;
};

export type ChatRuntimeReasoningProviderKey =
  | "claude_code"
  | "codex_openai_responses"
  | "codex_openai_completions"
  | "gemini";

export type AgentPromptTemplate = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  /** 该模板创建的子代理优先使用的模型；未设则走 subagentDefault → 父 turn。 */
  selectedModel?: SelectedModel;
};

export type SshAuthType = "password" | "privateKey" | "keyboardInteractive";
export type SshProxyType = "socks5" | "http";

export type SshProxyConfig = {
  type: SshProxyType;
  url: string;
  port: number;
  username: string;
  password: string;
  passwordConfigured?: boolean;
};

export type SshHostConfig = {
  id: string;
  name: string;
  description: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  password: string;
  passwordConfigured?: boolean;
  privateKey: string;
  privateKeyPath: string;
  privateKeyConfigured?: boolean;
  privateKeyPassphrase: string;
  privateKeyPassphraseConfigured?: boolean;
  proxy: SshProxyConfig;
};

export type SshSettings = {
  hosts: SshHostConfig[];
  projectHostAssociations: Record<string, string[]>;
};

export type CustomProvider = {
  id: string;
  name: string;
  type: ProviderId;
  baseUrl: string;
  apiKey: string;
  apiKeyConfigured?: boolean;
  models: ProviderModelConfig[];
  activeModels: string[];
  requestFormat?: CodexRequestFormat;
  reasoning: ReasoningLevel;
  promptCachingEnabled: boolean;
  nativeWebSearchEnabled: boolean;
};

export type EffectiveTheme = "light" | "dark";
export type Theme = EffectiveTheme | "system";

export const THEME_OPTIONS = ["light", "dark", "system"] as const satisfies readonly Theme[];

const SYSTEM_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type RemoteSettings = {
  enabled: boolean;
  gatewayUrl: string;
  grpcPort: number;
  grpcEndpoint: string;
  token: string;
  agentId: string;
  autoReconnect: boolean;
  heartbeatInterval: number;
  enableWebTerminal: boolean;
  enableWebSshTerminal: boolean;
  enableWebGit: boolean;
  enableWebTunnels: boolean;
};

export type AppSettings = {
  system: SystemSettings;
  customProviders: CustomProvider[];
  mcp: McpSettings;
  agents: AgentPromptTemplate[];
  ssh: SshSettings;
  remote: RemoteSettings;
  memory: MemorySettings;
  customSettings: CustomSettings;
  updates: UpdateSettings;
  skills: SkillsSettings;
  chatRuntimeControls: ChatRuntimeControls;
  selectedModel?: SelectedModel;
  theme: Theme;
  locale: Locale;
};

export const CODEX_REQUEST_FORMAT_LABELS: Record<CodexRequestFormat, string> = {
  "openai-completions": "OpenAI-Completions",
  "openai-responses": "Responses API",
};

const CODEX_RESPONSES_SUFFIX = "/responses";
const CODEX_RESPONSE_SUFFIX = "/response";
const CODEX_CHAT_COMPLETIONS_SUFFIX = "/chat/completions";
const DEFAULT_MCP_TIMEOUT_MS = 60_000;
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const DEFAULT_CLAUDE_MAX_OUTPUT_TOKEN = 32_000;
const DEFAULT_CODEX_CONTEXT_WINDOW = 258_000;
const DEFAULT_CODEX_MAX_OUTPUT_TOKEN = 142_000;
const DEFAULT_GEMINI_CONTEXT_WINDOW = 1_048_576;
const DEFAULT_GEMINI_MAX_OUTPUT_TOKEN = 65_536;
export const DEFAULT_CHAT_RUNTIME_CONTROLS: ChatRuntimeControls = {
  thinkingEnabled: true,
  nativeWebSearchEnabled: true,
  reasoning: "high",
  reasoningByProvider: {
    claude_code: "high",
    codex_openai_responses: "high",
    codex_openai_completions: "high",
    gemini: "high",
  },
};

export const DEFAULT_WORKSPACE_PROJECT_ID = "default-project";
export const DEFAULT_WORKSPACE_PROJECT_NAME = "Default Project";

function normalizeCodexRequestFormat(input: unknown): CodexRequestFormat | undefined {
  switch (input) {
    case "openai-completions":
    case "openai-responses":
      return input;
    default:
      return undefined;
  }
}

function normalizeCodexRouting(
  baseUrlInput: unknown,
  requestFormatInput: unknown,
): {
  baseUrl: string;
  requestFormat: CodexRequestFormat;
} {
  let baseUrl = normalizeBaseUrl(typeof baseUrlInput === "string" ? baseUrlInput : "");
  let requestFormat = normalizeCodexRequestFormat(requestFormatInput);
  const lower = baseUrl.toLowerCase();

  if (lower.endsWith(CODEX_CHAT_COMPLETIONS_SUFFIX)) {
    baseUrl = baseUrl.slice(0, -CODEX_CHAT_COMPLETIONS_SUFFIX.length);
    requestFormat ??= "openai-completions";
  } else if (lower.endsWith(CODEX_RESPONSES_SUFFIX)) {
    baseUrl = baseUrl.slice(0, -CODEX_RESPONSES_SUFFIX.length);
    requestFormat ??= "openai-responses";
  } else if (lower.endsWith(CODEX_RESPONSE_SUFFIX)) {
    baseUrl = baseUrl.slice(0, -CODEX_RESPONSE_SUFFIX.length);
    requestFormat ??= "openai-responses";
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    requestFormat: requestFormat ?? "openai-responses",
  };
}

export function getBuiltinCustomProviders(): CustomProvider[] {
  return [
    {
      id: "builtin-claude_code",
      name: "Anthropic",
      type: "claude_code",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      models: [],
      activeModels: [],
      reasoning: "off",
      promptCachingEnabled: true,
      nativeWebSearchEnabled: true,
    },
    {
      id: "builtin-codex",
      name: "OpenAI",
      type: "codex",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      models: [],
      activeModels: [],
      requestFormat: "openai-responses",
      reasoning: "off",
      promptCachingEnabled: false,
      nativeWebSearchEnabled: true,
    },
    {
      id: "builtin-gemini",
      name: "Gemini",
      type: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "",
      models: [],
      activeModels: [],
      reasoning: "off",
      promptCachingEnabled: false,
      nativeWebSearchEnabled: true,
    },
  ];
}

function normalizeExecutionMode(input: unknown): ExecutionMode {
  switch (input) {
    case "text":
    case "tools":
    case "agent-dev":
      return input;
    default:
      return "tools";
  }
}

function normalizeDefaultShellPreference(input: unknown): DefaultShellPreference {
  switch (input) {
    case "auto":
    case "bash":
    case "powershell":
      return input;
    default:
      return "auto";
  }
}

export function isAgentExecutionMode(mode: ExecutionMode): boolean {
  return mode !== "text";
}

export function isAgentDevMode(mode: ExecutionMode): boolean {
  return mode === "agent-dev";
}

function normalizeWorkdir(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

export function normalizeWorkspaceProjectPath(path: unknown): string {
  return typeof path === "string" ? path.trim() : "";
}

function isWindowsProjectPathLike(path: string): boolean {
  if (/^[\\/]{2}\?[\\/]/.test(path)) return true;
  if (/^[A-Za-z]:(?:[\\/]|$)/.test(path)) return true;
  return /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(path);
}

function trimTrailingWindowsProjectSlashes(path: string): string {
  let minLength = 1;
  if (/^[A-Za-z]:\//.test(path)) {
    minLength = 3;
  } else if (path.startsWith("//")) {
    const uncRoot = /^\/\/[^/]+\/[^/]+/.exec(path);
    minLength = uncRoot?.[0].length ?? 2;
  }
  let next = path;
  while (next.length > minLength && next.endsWith("/")) {
    next = next.slice(0, -1);
  }
  return next;
}

function normalizeWindowsProjectPathKey(path: string): string {
  const stripped = path.replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, "//").replace(/^[\\/]{2}\?[\\/]/, "");
  return trimTrailingWindowsProjectSlashes(stripped.replace(/\\/g, "/")).toLowerCase();
}

function normalizePosixProjectPathKey(path: string): string {
  let next = path;
  while (next.length > 1 && next.endsWith("/")) {
    next = next.slice(0, -1);
  }
  return next;
}

export function workspaceProjectPathKey(path: unknown): string {
  const normalizedPath = normalizeWorkspaceProjectPath(path);
  if (!normalizedPath) return "";
  return isWindowsProjectPathLike(normalizedPath)
    ? normalizeWindowsProjectPathKey(normalizedPath)
    : normalizePosixProjectPathKey(normalizedPath);
}

function assignNormalizedProjectKeyValue<T>(
  target: Record<string, T>,
  canonicalKeys: Set<string>,
  rawPathKey: string,
  value: T,
): void {
  const normalizedPathKey = workspaceProjectPathKey(rawPathKey);
  if (!normalizedPathKey) return;
  const isCanonicalKey = rawPathKey.trim() === normalizedPathKey;
  const existingIsCanonical = canonicalKeys.has(normalizedPathKey);
  if (isCanonicalKey || !existingIsCanonical) {
    target[normalizedPathKey] = value;
  }
  if (isCanonicalKey) {
    canonicalKeys.add(normalizedPathKey);
  }
}

export function normalizeRightDockFileTreePath(path: unknown): string {
  if (typeof path !== "string") return "";
  return path
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function normalizeWorkspaceProjectKind(input: unknown): WorkspaceProjectKind {
  switch (input) {
    case "managed":
    case "folder":
    case "history":
      return input;
    default:
      return "folder";
  }
}

function normalizeWorkspaceProject(input: unknown): WorkspaceProject | null {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const path = normalizeWorkspaceProjectPath(obj.path);
  if (!path) return null;
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : crypto.randomUUID();
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : path
          .split(/[\\/]+/)
          .filter(Boolean)
          .pop() || "Project";
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt) && obj.createdAt > 0
      ? obj.createdAt
      : Date.now();
  const updatedAt =
    typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt) && obj.updatedAt > 0
      ? obj.updatedAt
      : createdAt;
  const lastConversationAt =
    typeof obj.lastConversationAt === "number" &&
    Number.isFinite(obj.lastConversationAt) &&
    obj.lastConversationAt > 0
      ? obj.lastConversationAt
      : undefined;
  const isPinned = obj.isPinned === true;
  const pinnedAt =
    typeof obj.pinnedAt === "number" && Number.isFinite(obj.pinnedAt) && obj.pinnedAt > 0
      ? obj.pinnedAt
      : undefined;
  return {
    id,
    name,
    path,
    kind: normalizeWorkspaceProjectKind(obj.kind),
    createdAt,
    updatedAt,
    ...(lastConversationAt ? { lastConversationAt } : {}),
    ...(isPinned ? { isPinned: true, pinnedAt: pinnedAt ?? updatedAt } : {}),
  };
}

function normalizeWorkspaceProjects(input: unknown): WorkspaceProject[] {
  if (!Array.isArray(input)) return [];
  const out: WorkspaceProject[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  for (const raw of input) {
    const project = normalizeWorkspaceProject(raw);
    if (!project) continue;
    const pathKey = workspaceProjectPathKey(project.path);
    if (!pathKey || seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    let id = project.id;
    if (seenIds.has(id)) {
      id = crypto.randomUUID();
    }
    seenIds.add(id);
    out.push({ ...project, id });
  }
  return out;
}

export function normalizeHiddenWorkspaceProjectPaths(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of normalizeStringArray(input)) {
    const key = workspaceProjectPathKey(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function normalizeMissingWorkspaceProjectPaths(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of normalizeStringArray(input)) {
    const key = workspaceProjectPathKey(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function resolveWorkspaceProjects(
  system: SystemSettings,
  defaultWorkdir: string,
): SystemSettings {
  const defaultPath = normalizeWorkspaceProjectPath(defaultWorkdir || system.workdir);
  if (!defaultPath) return system;

  const now = Date.now();
  const defaultKey = workspaceProjectPathKey(defaultPath);
  const configured = normalizeWorkspaceProjects(system.workspaceProjects);
  const defaultExisting = configured.find(
    (project) =>
      project.id === DEFAULT_WORKSPACE_PROJECT_ID ||
      workspaceProjectPathKey(project.path) === defaultKey,
  );
  const defaultProject: WorkspaceProject = {
    id: DEFAULT_WORKSPACE_PROJECT_ID,
    name: DEFAULT_WORKSPACE_PROJECT_NAME,
    path: defaultPath,
    kind: "managed",
    createdAt: defaultExisting?.createdAt ?? now,
    updatedAt: defaultExisting?.updatedAt ?? now,
    ...(defaultExisting?.lastConversationAt
      ? { lastConversationAt: defaultExisting.lastConversationAt }
      : {}),
    ...(defaultExisting?.isPinned
      ? { isPinned: true, pinnedAt: defaultExisting.pinnedAt ?? defaultExisting.updatedAt }
      : {}),
  };

  const projects: WorkspaceProject[] = [defaultProject];
  const seenPaths = new Set<string>([defaultKey]);
  const seenIds = new Set<string>([DEFAULT_WORKSPACE_PROJECT_ID]);
  for (const project of configured) {
    const pathKey = workspaceProjectPathKey(project.path);
    if (!pathKey || seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    let id = project.id;
    if (!id || id === DEFAULT_WORKSPACE_PROJECT_ID || seenIds.has(id)) {
      id = crypto.randomUUID();
    }
    seenIds.add(id);
    projects.push({
      ...project,
      id,
      name:
        project.name.trim() ||
        project.path
          .split(/[\\/]+/)
          .filter(Boolean)
          .pop() ||
        "Project",
      kind: project.kind,
    });
  }

  const hiddenWorkspaceProjectPaths = normalizeHiddenWorkspaceProjectPaths(
    system.hiddenWorkspaceProjectPaths,
  ).filter((path) => workspaceProjectPathKey(path) !== defaultKey);
  const hiddenWorkspaceProjectPathKeys = new Set(
    hiddenWorkspaceProjectPaths.map(workspaceProjectPathKey),
  );
  const missingWorkspaceProjectPaths = normalizeMissingWorkspaceProjectPaths(
    system.missingWorkspaceProjectPaths,
  ).filter((path) => !hiddenWorkspaceProjectPathKeys.has(workspaceProjectPathKey(path)));
  const activeProjectId = projects.some((project) => project.id === system.activeWorkspaceProjectId)
    ? system.activeWorkspaceProjectId
    : DEFAULT_WORKSPACE_PROJECT_ID;
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? defaultProject;
  const workdir = normalizeWorkdir(system.workdir) || defaultPath;

  return {
    ...system,
    workdir,
    workspaceProjects: projects,
    activeWorkspaceProjectId: activeProject.id,
    hiddenWorkspaceProjectPaths,
    missingWorkspaceProjectPaths,
  };
}

const REASONING_LEVELS: ReasoningLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

export function normalizeReasoningLevel(input: unknown): ReasoningLevel {
  return typeof input === "string" && (REASONING_LEVELS as string[]).includes(input)
    ? (input as ReasoningLevel)
    : "off";
}

export function normalizeChatRuntimeReasoning(input: unknown): ReasoningLevel {
  return typeof input === "string" && (REASONING_LEVELS as string[]).includes(input)
    ? (input as ReasoningLevel)
    : DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning;
}

const CHAT_RUNTIME_REASONING_PROVIDER_KEYS: ChatRuntimeReasoningProviderKey[] = [
  "claude_code",
  "codex_openai_responses",
  "codex_openai_completions",
  "gemini",
];

export function getChatRuntimeReasoningProviderKey(params: {
  providerId?: ProviderId;
  requestFormat?: CodexRequestFormat;
}): ChatRuntimeReasoningProviderKey {
  if (!params.providerId || params.providerId === "claude_code") {
    return "claude_code";
  }
  if (params.providerId === "gemini") {
    return "gemini";
  }
  if (params.providerId === "codex" && params.requestFormat === "openai-completions") {
    return "codex_openai_completions";
  }
  return "codex_openai_responses";
}

function normalizeChatRuntimeReasoningForLevels(
  input: unknown,
  levels: ReasoningLevel[],
): ReasoningLevel {
  if (levels.length === 0) {
    return DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning;
  }
  const reasoning = normalizeChatRuntimeReasoning(input);
  return levels.includes(reasoning) ? reasoning : DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning;
}

function normalizeChatRuntimeReasoningByProvider(
  input: unknown,
  fallbackReasoning: ReasoningLevel,
): Partial<Record<ChatRuntimeReasoningProviderKey, ReasoningLevel>> {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const normalized: Partial<Record<ChatRuntimeReasoningProviderKey, ReasoningLevel>> = {
    ...DEFAULT_CHAT_RUNTIME_CONTROLS.reasoningByProvider,
  };
  CHAT_RUNTIME_REASONING_PROVIDER_KEYS.forEach((key) => {
    normalized[key] = normalizeChatRuntimeReasoning(
      Object.hasOwn(obj, key) ? obj[key] : fallbackReasoning,
    );
  });
  return normalized;
}

export function normalizeChatRuntimeControls(input: unknown): ChatRuntimeControls {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const reasoning = normalizeChatRuntimeReasoning(obj.reasoning);
  return {
    thinkingEnabled: obj.thinkingEnabled !== false,
    nativeWebSearchEnabled: obj.nativeWebSearchEnabled !== false,
    reasoning,
    reasoningByProvider: normalizeChatRuntimeReasoningByProvider(
      obj.reasoningByProvider,
      reasoning,
    ),
  };
}

export function getChatRuntimeReasoningLevelsForProvider(params: {
  providerId?: ProviderId;
  requestFormat?: CodexRequestFormat;
  modelId?: string;
  baseUrl?: string;
  modelConfig?: ProviderModelConfig;
}): ReasoningLevel[] {
  const modelId = params.modelId?.trim();
  if (!modelId) return [];
  return getAvailableThinkingLevelsForModel(
    params.providerId ?? "claude_code",
    modelId,
    params.baseUrl ?? "",
    params.requestFormat,
    params.modelConfig,
  );
}

export function normalizeChatRuntimeControlsForProvider(
  input: unknown,
  params: {
    providerId?: ProviderId;
    requestFormat?: CodexRequestFormat;
    modelId?: string;
    baseUrl?: string;
    modelConfig?: ProviderModelConfig;
  },
): ChatRuntimeControls {
  const controls = normalizeChatRuntimeControls(input);
  const key = getChatRuntimeReasoningProviderKey(params);
  const levels = getChatRuntimeReasoningLevelsForProvider(params);
  const reasoningByProvider = {
    ...DEFAULT_CHAT_RUNTIME_CONTROLS.reasoningByProvider,
    ...controls.reasoningByProvider,
  };
  const reasoning = normalizeChatRuntimeReasoningForLevels(
    reasoningByProvider[key] ?? controls.reasoning,
    levels,
  );
  return {
    ...controls,
    reasoning,
    reasoningByProvider: {
      ...reasoningByProvider,
      [key]: reasoning,
    },
  };
}

export function updateChatRuntimeControlsForProvider(
  input: unknown,
  patch: Partial<ChatRuntimeControls>,
  params: {
    providerId?: ProviderId;
    requestFormat?: CodexRequestFormat;
    modelId?: string;
    baseUrl?: string;
    modelConfig?: ProviderModelConfig;
  },
): ChatRuntimeControls {
  const key = getChatRuntimeReasoningProviderKey(params);
  const levels = getChatRuntimeReasoningLevelsForProvider(params);
  const controls = normalizeChatRuntimeControls({
    ...normalizeChatRuntimeControls(input),
    ...patch,
  });
  const reasoningByProvider = {
    ...DEFAULT_CHAT_RUNTIME_CONTROLS.reasoningByProvider,
    ...controls.reasoningByProvider,
  };
  if (patch.reasoning !== undefined) {
    reasoningByProvider[key] = normalizeChatRuntimeReasoningForLevels(patch.reasoning, levels);
  }
  return normalizeChatRuntimeControlsForProvider(
    {
      ...controls,
      reasoningByProvider,
    },
    params,
  );
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeOptionalText(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeRecordStringString(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;

  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey).trim();
    const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "").trim();
    if (!key || !value) continue;
    out[key] = value;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeMcpTransport(input: unknown): McpTransport {
  if (input === "http" || input === "sse" || input === "stdio") return input;
  return "stdio";
}

export function normalizeSystemToolSelection(input: unknown): SystemToolId[] {
  const valid = new Set<SystemToolId>(SYSTEM_TOOL_OPTIONS.map((tool) => tool.id));
  const out: SystemToolId[] = [];

  for (const item of normalizeStringArray(input)) {
    const value = item as SystemToolId;
    if (!valid.has(value)) continue;
    if (out.includes(value)) continue;
    out.push(value);
  }

  return out;
}

function normalizeMcpSelection(input: unknown, servers: McpServerConfig[]): string[] {
  const valid = new Set(servers.map((server) => server.id).filter(Boolean));
  const out: string[] = [];

  for (const item of normalizeStringArray(input)) {
    if (!valid.has(item)) continue;
    if (out.includes(item)) continue;
    out.push(item);
  }

  return out;
}

function normalizeTimeoutMs(input: unknown): number {
  const numeric =
    typeof input === "number" ? input : typeof input === "string" ? Number(input) : NaN;
  const timeoutMs = Number.isFinite(numeric) ? Math.floor(numeric) : DEFAULT_MCP_TIMEOUT_MS;
  return timeoutMs > 0 ? timeoutMs : DEFAULT_MCP_TIMEOUT_MS;
}

function normalizePositiveInteger(input: unknown, fallback: number): number {
  const numeric =
    typeof input === "number" ? input : typeof input === "string" ? Number(input) : NaN;
  const value = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return value > 0 ? value : fallback;
}

function normalizeIntegerInRange(
  input: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = normalizePositiveInteger(input, fallback);
  return Math.min(max, Math.max(min, value));
}

function normalizeGrpcEndpoint(input: unknown): string {
  const value = normalizeOptionalText(input);
  if (!value) return "";
  if (/^https?:/i.test(value)) return normalizeBaseUrl(value);
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function normalizeRemoteSettings(input: unknown): RemoteSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
    gatewayUrl: normalizeBaseUrl(typeof obj.gatewayUrl === "string" ? obj.gatewayUrl : ""),
    grpcPort: normalizeIntegerInRange(obj.grpcPort, 1, 65_535, 50051),
    grpcEndpoint: normalizeGrpcEndpoint(obj.grpcEndpoint),
    token: normalizeApiKey(typeof obj.token === "string" ? obj.token : ""),
    agentId: normalizeOptionalText(obj.agentId),
    autoReconnect: obj.autoReconnect !== false,
    heartbeatInterval: normalizePositiveInteger(obj.heartbeatInterval, 30),
    enableWebTerminal: obj.enableWebTerminal === true,
    enableWebSshTerminal: obj.enableWebSshTerminal === true,
    enableWebGit: obj.enableWebGit === true,
    enableWebTunnels: obj.enableWebTunnels === true,
  };
}

function toKnownProvider(providerId: ProviderId): KnownProvider {
  if (providerId === "codex") return "openai";
  if (providerId === "gemini") return "google";
  return "anthropic";
}

function getKnownModelLimits(
  providerId: ProviderId,
  modelId: string | undefined,
): Pick<ProviderModelConfig, "contextWindow" | "maxOutputToken"> | undefined {
  const trimmedId = modelId?.trim();
  if (!trimmedId) return undefined;
  const known = getBuiltinModels(toKnownProvider(providerId)).find(
    (model) => model.id === trimmedId,
  );
  if (!known) return undefined;
  return { contextWindow: known.contextWindow, maxOutputToken: known.maxTokens };
}

export function getProviderModelDefaults(
  providerId: ProviderId,
  modelId?: string,
): Pick<ProviderModelConfig, "contextWindow" | "maxOutputToken"> {
  const known = getKnownModelLimits(providerId, modelId);
  if (known) return known;

  if (providerId === "codex") {
    return {
      contextWindow: DEFAULT_CODEX_CONTEXT_WINDOW,
      maxOutputToken: DEFAULT_CODEX_MAX_OUTPUT_TOKEN,
    };
  }

  if (providerId === "gemini") {
    return {
      contextWindow: DEFAULT_GEMINI_CONTEXT_WINDOW,
      maxOutputToken: DEFAULT_GEMINI_MAX_OUTPUT_TOKEN,
    };
  }

  return {
    contextWindow: DEFAULT_CLAUDE_CONTEXT_WINDOW,
    maxOutputToken: DEFAULT_CLAUDE_MAX_OUTPUT_TOKEN,
  };
}

export function createProviderModelConfig(
  providerId: ProviderId,
  modelId: string,
  capabilities?: ModelCapability[],
): ProviderModelConfig {
  const id = modelId.trim();
  const defaults = getProviderModelDefaults(providerId, id);
  return {
    id,
    contextWindow: defaults.contextWindow,
    maxOutputToken: defaults.maxOutputToken,
    ...(capabilities && capabilities.length > 0 ? { capabilities: [...capabilities] } : {}),
  };
}

function normalizeModelCapabilities(input: unknown): ModelCapability[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const allowed = new Set<ModelCapability>(["text", "vision", "image_gen"]);
  const seen = new Set<ModelCapability>();
  const result: ModelCapability[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const value = item.trim() as ModelCapability;
    if (!allowed.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result.length > 0 ? result : undefined;
}

export function normalizeProviderModelConfig(
  input: unknown,
  providerId: ProviderId,
): ProviderModelConfig | null {
  if (typeof input === "string") {
    const id = input.trim();
    return id ? createProviderModelConfig(providerId, id) : null;
  }

  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id =
    typeof obj.id === "string"
      ? obj.id.trim()
      : typeof obj.model === "string"
        ? obj.model.trim()
        : "";
  if (!id) return null;

  const defaults = getProviderModelDefaults(providerId, id);
  const capabilities = normalizeModelCapabilities(obj.capabilities);
  return {
    id,
    contextWindow: normalizePositiveInteger(obj.contextWindow, defaults.contextWindow),
    maxOutputToken: normalizePositiveInteger(
      obj.maxOutputToken ?? obj.maxTokens,
      defaults.maxOutputToken,
    ),
    ...(capabilities ? { capabilities } : {}),
  };
}

export function normalizeProviderModelConfigs(
  input: unknown,
  providerId: ProviderId,
): ProviderModelConfig[] {
  if (!Array.isArray(input)) return [];

  const out: ProviderModelConfig[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    const normalized = normalizeProviderModelConfig(item, providerId);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }

  return out;
}

export function findProviderModelConfig(
  provider: Pick<CustomProvider, "models" | "type">,
  modelId: string,
): ProviderModelConfig {
  const normalizedId = modelId.trim();
  const matched = provider.models.find((item) => item.id === normalizedId);
  return matched ?? createProviderModelConfig(provider.type, normalizedId);
}

function normalizeProviderId(input: unknown): ProviderId {
  switch (input) {
    case "codex":
    case "gemini":
      return input;
    default:
      return "claude_code";
  }
}

function normalizeProviderName(id: string, input: unknown): string {
  const name = typeof input === "string" && input.trim() ? input.trim() : "未命名供应商";
  if (id === "builtin-claude_code" && name === "Claude Code") return "Anthropic";
  if (id === "builtin-codex" && name === "Codex") return "OpenAI";
  return name;
}

export function normalizeCustomProvider(input: unknown): CustomProvider {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type = normalizeProviderId(obj.type);
  const codexRouting =
    type === "codex" ? normalizeCodexRouting(obj.baseUrl, obj.requestFormat) : undefined;
  const models = normalizeProviderModelConfigs(obj.models, type);
  const validModelIds = new Set(models.map((model) => model.id));
  const apiKey = normalizeApiKey(typeof obj.apiKey === "string" ? obj.apiKey : "");
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : crypto.randomUUID();

  return {
    id,
    name: normalizeProviderName(id, obj.name),
    type,
    baseUrl: codexRouting
      ? codexRouting.baseUrl
      : normalizeBaseUrl(typeof obj.baseUrl === "string" ? obj.baseUrl : ""),
    apiKey,
    apiKeyConfigured: apiKey.length > 0 || obj.apiKeyConfigured === true,
    models,
    activeModels: normalizeModels(normalizeStringArray(obj.activeModels)).filter((modelId) =>
      validModelIds.has(modelId),
    ),
    requestFormat: codexRouting?.requestFormat,
    reasoning: normalizeReasoningLevel(obj.reasoning),
    promptCachingEnabled: type === "claude_code" ? obj.promptCachingEnabled !== false : false,
    nativeWebSearchEnabled: obj.nativeWebSearchEnabled !== false,
  };
}

export function normalizeAgentPromptTemplate(
  input: unknown,
  customProviders: CustomProvider[] = [],
): AgentPromptTemplate {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : crypto.randomUUID(),
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "未命名模板",
    description: normalizeOptionalText(obj.description),
    prompt: normalizeOptionalText(obj.prompt),
    enabled: obj.enabled === true,
    selectedModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.selectedModel),
      customProviders,
    ),
  };
}

function normalizeSshAuthType(input: unknown): SshAuthType {
  switch (input) {
    case "privateKey":
    case "keyboardInteractive":
      return input;
    default:
      return "password";
  }
}

function normalizeSshPort(input: unknown): number {
  const value = typeof input === "number" || typeof input === "string" ? Number(input) : 22;
  if (!Number.isFinite(value)) return 22;
  const port = Math.floor(value);
  return port >= 1 && port <= 65535 ? port : 22;
}

function normalizeSshProxyPort(input: unknown): number {
  const value = typeof input === "number" || typeof input === "string" ? Number(input) : 0;
  if (!Number.isFinite(value)) return 0;
  const port = Math.floor(value);
  return port >= 1 && port <= 65535 ? port : 0;
}

function normalizeSshProxyType(input: unknown): SshProxyType {
  return input === "http" ? "http" : "socks5";
}

export function normalizeSshProxyConfig(input: unknown): SshProxyConfig {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const password = normalizeOptionalText(obj.password);
  return {
    type: normalizeSshProxyType(obj.type),
    url: normalizeOptionalText(obj.url),
    port: normalizeSshProxyPort(obj.port),
    username: typeof obj.username === "string" ? obj.username.trim() : "",
    password,
    passwordConfigured: password.length > 0 || obj.passwordConfigured === true,
  };
}

export function normalizeSshHostConfig(input: unknown): SshHostConfig {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const host = typeof obj.host === "string" ? obj.host.trim() : "";
  const name =
    typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : host || "未命名 SSH";
  const authType = normalizeSshAuthType(obj.authType);
  const password = authType === "keyboardInteractive" ? "" : normalizeOptionalText(obj.password);
  const privateKey =
    authType === "keyboardInteractive" ? "" : normalizeOptionalText(obj.privateKey);
  const privateKeyPath =
    authType === "keyboardInteractive" ? "" : normalizeOptionalText(obj.privateKeyPath);
  const privateKeyPassphrase =
    authType === "keyboardInteractive" ? "" : normalizeOptionalText(obj.privateKeyPassphrase);
  const passwordConfigured =
    authType !== "keyboardInteractive" && (password.length > 0 || obj.passwordConfigured === true);
  const privateKeyConfigured =
    authType !== "keyboardInteractive" &&
    (privateKey.length > 0 || privateKeyPath.length > 0 || obj.privateKeyConfigured === true);
  const privateKeyPassphraseConfigured =
    authType !== "keyboardInteractive" &&
    (privateKeyPassphrase.length > 0 || obj.privateKeyPassphraseConfigured === true);

  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : crypto.randomUUID(),
    name,
    description: normalizeOptionalText(obj.description),
    host,
    port: normalizeSshPort(obj.port),
    username: typeof obj.username === "string" ? obj.username.trim() : "",
    authType,
    password,
    passwordConfigured,
    privateKey,
    privateKeyPath,
    privateKeyConfigured,
    privateKeyPassphrase,
    privateKeyPassphraseConfigured,
    proxy: normalizeSshProxyConfig(obj.proxy),
  };
}

export function normalizeSshSettings(input: unknown): SshSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sourceHosts = Array.isArray(obj.hosts) ? obj.hosts : [];
  const seenIds = new Set<string>();
  const hosts = sourceHosts.map((host) => {
    const normalized = normalizeSshHostConfig(host);
    if (!seenIds.has(normalized.id)) {
      seenIds.add(normalized.id);
      return normalized;
    }
    const id = crypto.randomUUID();
    seenIds.add(id);
    return { ...normalized, id };
  });
  const hostIds = new Set(hosts.map((host) => host.id));

  return {
    hosts,
    projectHostAssociations: normalizeSshProjectHostAssociations(
      obj.projectHostAssociations,
      hostIds,
    ),
  };
}

function normalizeSshProjectHostAssociations(
  input: unknown,
  hostIds: ReadonlySet<string>,
): Record<string, string[]> {
  const rawAssociations = (
    input && typeof input === "object" && !Array.isArray(input) ? input : {}
  ) as Record<string, unknown>;
  const associations: Record<string, string[]> = {};
  const canonicalKeys = new Set<string>();
  for (const [pathKey, rawHostIds] of Object.entries(rawAssociations)) {
    if (!Array.isArray(rawHostIds)) continue;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const rawHostId of rawHostIds) {
      if (typeof rawHostId !== "string") continue;
      const hostId = rawHostId.trim();
      if (!hostId || !hostIds.has(hostId) || seen.has(hostId)) continue;
      seen.add(hostId);
      ids.push(hostId);
      if (ids.length >= 64) break;
    }
    if (ids.length === 0) continue;
    assignNormalizedProjectKeyValue(associations, canonicalKeys, pathKey, ids);
    if (Object.keys(associations).length >= 100) break;
  }
  return associations;
}

export function normalizeSystemSettings(input: unknown): SystemSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    executionMode: normalizeExecutionMode(obj.executionMode),
    workdir: normalizeWorkdir(obj.workdir),
    selectedSystemTools: normalizeSystemToolSelection(obj.selectedSystemTools),
    defaultShell: normalizeDefaultShellPreference(obj.defaultShell),
    workspaceProjects: normalizeWorkspaceProjects(obj.workspaceProjects),
    activeWorkspaceProjectId:
      typeof obj.activeWorkspaceProjectId === "string" && obj.activeWorkspaceProjectId.trim()
        ? obj.activeWorkspaceProjectId.trim()
        : undefined,
    hiddenWorkspaceProjectPaths: normalizeHiddenWorkspaceProjectPaths(
      obj.hiddenWorkspaceProjectPaths,
    ),
    missingWorkspaceProjectPaths: normalizeMissingWorkspaceProjectPaths(
      obj.missingWorkspaceProjectPaths,
    ),
    hideDefaultWorkspaceProject: obj.hideDefaultWorkspaceProject === true,
    quickAskHotkey: normalizeQuickAskHotkey(obj.quickAskHotkey),
  };
}

export function normalizeMcpServerConfig(input: unknown): McpServerConfig {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const cwd = typeof obj.cwd === "string" ? obj.cwd.trim() : "";
  const messageUrl = typeof obj.messageUrl === "string" ? obj.messageUrl.trim() : "";

  return {
    id,
    enabled: Boolean(obj.enabled),
    transport: normalizeMcpTransport(obj.transport),
    command: typeof obj.command === "string" ? obj.command.trim() : "",
    args: normalizeStringArray(obj.args),
    url: typeof obj.url === "string" ? obj.url.trim() : "",
    env: normalizeRecordStringString(obj.env),
    cwd: cwd || undefined,
    headers: normalizeRecordStringString(obj.headers),
    timeoutMs: normalizeTimeoutMs(obj.timeoutMs),
    messageUrl: messageUrl || undefined,
  };
}

export function normalizeMcpSettings(input: unknown): McpSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const servers = Array.isArray(obj.servers)
    ? obj.servers.map((server) => normalizeMcpServerConfig(server))
    : [];

  return {
    servers,
    selected: normalizeMcpSelection(obj.selected, servers),
  };
}

export function normalizeAgentPromptTemplates(
  input: unknown,
  customProviders: CustomProvider[] = [],
): AgentPromptTemplate[] {
  if (!Array.isArray(input)) return [];
  let hasEnabled = false;
  return input.map((template) => {
    const normalized = normalizeAgentPromptTemplate(template, customProviders);
    if (!normalized.enabled) return normalized;
    if (hasEnabled) return { ...normalized, enabled: false };
    hasEnabled = true;
    return normalized;
  });
}

export function normalizeSkillsSettings(input: unknown): SkillsSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    enabled: obj.enabled === false ? false : true,
    selected: mergeAlwaysEnabledSkillNames(normalizeStringArray(obj.selected)),
  };
}

export function normalizeSelectedModel(input: unknown): SelectedModel | undefined {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const customProviderId =
    typeof obj.customProviderId === "string" ? obj.customProviderId.trim() : "";
  const model = typeof obj.model === "string" ? obj.model.trim() : "";

  if (!customProviderId || !model) return undefined;
  return { customProviderId, model };
}

export function normalizeTheme(input: unknown): Theme {
  if (input === "dark") return "dark";
  if (input === "system" || input === "auto") return "system";
  return "light";
}

export function resolveEffectiveTheme(theme: Theme): EffectiveTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

export function getNextTheme(theme: Theme): Theme {
  if (theme === "light") return "dark";
  if (theme === "dark") return "system";
  return "light";
}

export function subscribeToSystemThemePreference(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const query = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }

  query.addListener(listener);
  return () => query.removeListener(listener);
}

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

export function getDefaultMemoryOrganizerSchedule(): MemoryOrganizerSchedule {
  return {
    frequency: "none",
    timeLocal: "03:00",
    weekday: 1,
    timezone: localTimezone(),
  };
}

function normalizeMemoryOrganizerFrequency(input: unknown): MemoryOrganizerFrequency {
  if (input === "daily" || input === "weekly") return input;
  return "none";
}

function normalizeMemoryOrganizerTime(input: unknown) {
  const value = typeof input === "string" ? input.trim() : "";
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "03:00";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? value : "03:00";
}

function normalizeMemoryOrganizerWeekday(input: unknown) {
  const value = typeof input === "number" ? input : Number(input);
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
}

function normalizeMemoryOrganizerSchedule(input: unknown): MemoryOrganizerSchedule {
  const defaults = getDefaultMemoryOrganizerSchedule();
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    frequency: normalizeMemoryOrganizerFrequency(obj.frequency),
    timeLocal: normalizeMemoryOrganizerTime(obj.timeLocal),
    weekday: normalizeMemoryOrganizerWeekday(obj.weekday),
    timezone:
      typeof obj.timezone === "string" && obj.timezone.trim()
        ? obj.timezone.trim()
        : defaults.timezone,
  };
}

function normalizeMemoryOrganizerScope(input: unknown): MemoryOrganizerScope {
  switch (input) {
    case "global":
    case "projects":
    case "current-project":
      return input;
    default:
      return "all";
  }
}

function normalizeMemoryOrganizerMode(input: unknown): MemoryOrganizerMode {
  switch (input) {
    case "conservative":
    case "aggressive":
      return input;
    default:
      return "standard";
  }
}

function normalizeOptionalTimestamp(input: unknown): number | undefined {
  const value = typeof input === "number" ? input : Number(input);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function computeNextMemoryOrganizerRunAt(
  schedule: MemoryOrganizerSchedule,
  from = Date.now(),
): number | undefined {
  if (schedule.frequency === "none") {
    return undefined;
  }

  const [hourRaw, minuteRaw] = schedule.timeLocal.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const base = new Date(from);
  const candidate = new Date(base);
  candidate.setSeconds(0, 0);
  candidate.setHours(
    Number.isInteger(hour) ? hour : 3,
    Number.isInteger(minute) ? minute : 0,
    0,
    0,
  );

  if (schedule.frequency === "weekly") {
    const targetWeekday = normalizeMemoryOrganizerWeekday(schedule.weekday);
    const currentWeekday = candidate.getDay();
    let days = (targetWeekday - currentWeekday + 7) % 7;
    if (days === 0 && candidate.getTime() <= from) {
      days = 7;
    }
    candidate.setDate(candidate.getDate() + days);
    return candidate.getTime();
  }

  if (candidate.getTime() <= from) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
}

function normalizeSelectedModelForProviders(
  selectedModel: SelectedModel | undefined,
  customProviders: CustomProvider[],
): SelectedModel | undefined {
  if (!selectedModel) {
    return undefined;
  }

  const provider = customProviders.find((item) => item.id === selectedModel.customProviderId);
  if (!provider) {
    return undefined;
  }

  return provider.activeModels.includes(selectedModel.model) ? selectedModel : undefined;
}

export function normalizeMemorySettings(
  input: unknown,
  customProviders: CustomProvider[],
): MemorySettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const organizerModel = normalizeSelectedModelForProviders(
    normalizeSelectedModel(obj.organizerModel),
    customProviders,
  );
  const organizerSchedule = normalizeMemoryOrganizerSchedule(obj.organizerSchedule);
  const organizerEnabled =
    obj.organizerEnabled === true &&
    Boolean(organizerModel) &&
    organizerSchedule.frequency !== "none";
  const organizerNextRunAt = organizerEnabled
    ? (normalizeOptionalTimestamp(obj.organizerNextRunAt) ??
      computeNextMemoryOrganizerRunAt(organizerSchedule) ??
      undefined)
    : undefined;
  return {
    organizerModel,
    summaryModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.summaryModel),
      customProviders,
    ),
    organizerEnabled,
    organizerSchedule,
    organizerScope: normalizeMemoryOrganizerScope(obj.organizerScope),
    organizerMode: normalizeMemoryOrganizerMode(obj.organizerMode),
    organizerLastRunAt: normalizeOptionalTimestamp(obj.organizerLastRunAt),
    organizerNextRunAt,
  };
}

export const RIGHT_DOCK_SINGLETON_TAB_IDS = {
  fileTree: "tool:fileTree",
  gitReview: "tool:gitReview",
  tunnel: "tool:tunnel",
  sshTunnel: "tool:sshTunnel",
} as const satisfies Record<RightDockToolKind, string>;

const RIGHT_DOCK_TOOL_KIND_BY_TAB_ID = new Map<string, RightDockToolKind>(
  RIGHT_DOCK_TOOL_KINDS.map((kind) => [RIGHT_DOCK_SINGLETON_TAB_IDS[kind], kind]),
);

export function rightDockToolKindForTabId(tabId: string): RightDockToolKind | undefined {
  return RIGHT_DOCK_TOOL_KIND_BY_TAB_ID.get(tabId);
}

// Empty buckets whose tools were closed act as tombstones so a stale snapshot
// cannot resurrect them through merge; they expire after this window.
const RIGHT_DOCK_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_RIGHT_DOCK_PROJECTS = 100;

export const DEFAULT_RIGHT_DOCK_FILE_TREE_STATE: RightDockFileTreeState = {
  query: "",
  selectedPath: "",
  expandedPaths: [""],
  revision: 0,
};

function normalizeRightDockFileTreeSearchQuery(query: unknown): string {
  return typeof query === "string" ? query.slice(0, 200) : "";
}

function normalizeRightDockFileTreeExpandedPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [""];
  const normalized = Array.from(
    new Set(
      paths
        .map((path) => normalizeRightDockFileTreePath(path))
        .filter((path) => path.length <= 1024),
    ),
  );
  return normalized.slice(0, 512);
}

export function normalizeRightDockFileTreeState(input: unknown): RightDockFileTreeState {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    query: normalizeRightDockFileTreeSearchQuery(obj.query),
    selectedPath: normalizeRightDockFileTreePath(obj.selectedPath),
    expandedPaths: normalizeRightDockFileTreeExpandedPaths(obj.expandedPaths),
    revision: normalizeIntegerInRange(obj.revision, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export function normalizeRightDockTabOrder(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || id.length > 160 || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    if (order.length >= 128) break;
  }
  return order;
}

function normalizeRightDockRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key.trim() || key.length > 80) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Array.isArray(value) ||
      (value && typeof value === "object")
    ) {
      output[key] = value;
    }
    if (Object.keys(output).length >= 64) break;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeRightDockToolUiState(
  kind: RightDockToolKind,
  input: unknown,
): Record<string, unknown> | undefined {
  if (kind === "fileTree") {
    return normalizeRightDockFileTreeState(input);
  }
  return normalizeRightDockRecord(input);
}

function normalizeRightDockToolTab(kind: RightDockToolKind, input: unknown): RightDockToolTab {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const uiState = normalizeRightDockToolUiState(kind, obj.uiState);
  return {
    openedAt: normalizeIntegerInRange(obj.openedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    ...(uiState ? { uiState } : {}),
  };
}

// Accepts both the current shape ({ tools }) and the legacy persisted shape
// ({ tabs } keyed by tab id, including now-derived terminal entries which are
// dropped). tabOrder keeps unknown ids: they are terminal session ids.
export function normalizeRightDockProjectState(input: unknown): RightDockProjectState {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawTools = (
    obj.tools && typeof obj.tools === "object" && !Array.isArray(obj.tools) ? obj.tools : {}
  ) as Record<string, unknown>;
  const legacyTabs = (
    obj.tabs && typeof obj.tabs === "object" && !Array.isArray(obj.tabs) ? obj.tabs : {}
  ) as Record<string, unknown>;
  const tools: Partial<Record<RightDockToolKind, RightDockToolTab>> = {};
  for (const kind of RIGHT_DOCK_TOOL_KINDS) {
    const raw = rawTools[kind] ?? legacyTabs[RIGHT_DOCK_SINGLETON_TAB_IDS[kind]];
    if (!raw || typeof raw !== "object") continue;
    const legacy = raw as Record<string, unknown>;
    tools[kind] = normalizeRightDockToolTab(
      kind,
      "openedAt" in legacy ? legacy : { ...legacy, openedAt: legacy.createdAt },
    );
  }
  const tabOrder = normalizeRightDockTabOrder(obj.tabOrder);
  for (const kind of RIGHT_DOCK_TOOL_KINDS) {
    const tabId = RIGHT_DOCK_SINGLETON_TAB_IDS[kind];
    if (tools[kind] && !tabOrder.includes(tabId)) tabOrder.push(tabId);
  }
  const rawActiveTabId = typeof obj.activeTabId === "string" ? obj.activeTabId.trim() : "";
  const activeTabId = rawActiveTabId && rawActiveTabId.length <= 160 ? rawActiveTabId : undefined;
  return {
    ...(activeTabId ? { activeTabId } : {}),
    tabOrder,
    tools,
    openVersion: normalizeIntegerInRange(obj.openVersion, 0, Number.MAX_SAFE_INTEGER, 0),
    stateVersion: normalizeIntegerInRange(obj.stateVersion, 0, Number.MAX_SAFE_INTEGER, 0),
    writerId: typeof obj.writerId === "string" ? obj.writerId.trim().slice(0, 32) : "",
    lastUsedAt: normalizeIntegerInRange(obj.lastUsedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export function normalizeRightDockSettings(input: unknown): RightDockSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawProjects = (
    obj.projects && typeof obj.projects === "object" && !Array.isArray(obj.projects)
      ? obj.projects
      : {}
  ) as Record<string, unknown>;
  const now = Date.now();
  const projects: Record<string, RightDockProjectState> = {};
  for (const [pathKey, projectState] of Object.entries(rawProjects)) {
    const normalizedPathKey = workspaceProjectPathKey(pathKey);
    if (!normalizedPathKey || projects[normalizedPathKey]) continue;
    const project = normalizeRightDockProjectState(projectState);
    const isEmpty = Object.keys(project.tools).length === 0;
    if (isEmpty && project.openVersion === 0 && project.stateVersion === 0) continue;
    if (isEmpty) {
      // Tombstone: start (or continue) the expiry clock, drop once elapsed.
      const tombstonedAt = project.lastUsedAt > 0 ? project.lastUsedAt : now;
      if (now - tombstonedAt > RIGHT_DOCK_TOMBSTONE_TTL_MS) continue;
      projects[normalizedPathKey] = { ...project, lastUsedAt: tombstonedAt };
      continue;
    }
    projects[normalizedPathKey] = project;
  }
  const keys = Object.keys(projects);
  if (keys.length > MAX_RIGHT_DOCK_PROJECTS) {
    // Keep the most recently used buckets instead of the first-inserted ones.
    keys.sort((a, b) => {
      const byRecency = (projects[b]?.lastUsedAt ?? 0) - (projects[a]?.lastUsedAt ?? 0);
      return byRecency !== 0 ? byRecency : a.localeCompare(b);
    });
    for (const key of keys.slice(MAX_RIGHT_DOCK_PROJECTS)) {
      delete projects[key];
    }
  }
  return {
    width: normalizeIntegerInRange(obj.width, 320, 1280, 420),
    projects,
  };
}

export function normalizeFontScale(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(1.4, Math.max(0.8, Math.round(num * 100) / 100));
}

export function normalizeFontScaleSettings(input: unknown): FontScaleSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    sidebar: normalizeFontScale(obj.sidebar),
    chat: normalizeFontScale(obj.chat),
    rightDock: normalizeFontScale(obj.rightDock),
  };
}

export function normalizeDraftPersistenceSettings(input: unknown): DraftPersistenceSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return { enabled: obj.enabled !== false };
}
export function normalizeProviderHistorySettings(input: unknown): ProviderHistorySettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  const normalized: ProviderHistoryItem[] = [];
  const seen = new Set<string>();
  for (const value of items) {
    const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const type = item.type === "claude_code" || item.type === "gemini" ? item.type : "codex";
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 120) : "";
    const baseUrl = typeof item.baseUrl === "string" ? normalizeBaseUrl(item.baseUrl) : "";
    if (!name && !baseUrl) continue;
    const id = `${type}:${name.toLowerCase()}:${baseUrl.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      type,
      name,
      baseUrl,
      updatedAt: normalizeIntegerInRange(item.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
      hidden: item.hidden === true,
    });
  }
  return {
    enabled: obj.enabled !== false,
    items: normalized.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60),
  };
}

export function recordProviderHistory(
  settings: ProviderHistorySettings,
  provider: Pick<CustomProvider, "type" | "name" | "baseUrl">,
  updatedAt = Date.now(),
): ProviderHistorySettings {
  const next = normalizeProviderHistorySettings({
    ...settings,
    items: [{ ...provider, updatedAt, hidden: false }, ...settings.items],
  });
  const kept: ProviderHistoryItem[] = [];
  const counts = new Map<ProviderId, number>();
  for (const item of next.items) {
    const count = counts.get(item.type) ?? 0;
    if (count >= 20) continue;
    counts.set(item.type, count + 1);
    kept.push(item);
  }
  return { ...next, items: kept };
}

export function setProviderHistoryItemHidden(
  settings: ProviderHistorySettings,
  id: string,
  hidden: boolean,
): ProviderHistorySettings {
  const targetId = id.trim();
  if (!targetId) return settings;
  return normalizeProviderHistorySettings({
    ...settings,
    items: settings.items.map((item) => (item.id === targetId ? { ...item, hidden } : item)),
  });
}

export function restoreHiddenProviderHistory(
  settings: ProviderHistorySettings,
  type?: ProviderId,
): ProviderHistorySettings {
  return normalizeProviderHistorySettings({
    ...settings,
    items: settings.items.map((item) =>
      !type || item.type === type ? { ...item, hidden: false } : item,
    ),
  });
}

export function clearProviderHistory(
  settings: ProviderHistorySettings,
  type?: ProviderId,
): ProviderHistorySettings {
  return normalizeProviderHistorySettings({
    ...settings,
    items: type ? settings.items.filter((item) => item.type !== type) : [],
  });
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

export function normalizeChatLayoutSettings(input: unknown): ChatLayoutSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    contentWidth: normalizeIntegerInRange(obj.contentWidth, 560, 1400, 768),
    composerHeight: normalizeIntegerInRange(obj.composerHeight, 70, 480, 70),
    fullWidth: obj.fullWidth === true,
  };
}

function normalizeAppearancePalette(
  input: unknown,
  fallback: AppearancePalette,
): AppearancePalette {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return Object.fromEntries(
    APPEARANCE_SURFACES.map((key) => [key, normalizeHexColor(obj[key], fallback[key])]),
  ) as AppearancePalette;
}

export function normalizeAppearanceSettings(input: unknown): AppearanceSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fontFamily = ["system", "openai", "cjk", "serif", "monospace", "local"].includes(
    String(obj.fontFamily),
  )
    ? (obj.fontFamily as AppearanceFontFamily)
    : DEFAULT_APPEARANCE_SETTINGS.fontFamily;
  const localFontName =
    typeof obj.localFontName === "string" && /^[\w -]{0,64}$/.test(obj.localFontName.trim())
      ? obj.localFontName.trim()
      : "";
  return {
    version: 1,
    light: normalizeAppearancePalette(obj.light, DEFAULT_APPEARANCE_SETTINGS.light),
    dark: normalizeAppearancePalette(obj.dark, DEFAULT_APPEARANCE_SETTINGS.dark),
    fontFamily,
    localFontName,
  };
}

export function parseAppearanceSettingsJson(json: string): AppearanceSettings {
  const value = JSON.parse(json) as Record<string, unknown>;
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("Unsupported appearance settings version");
  }
  for (const mode of ["light", "dark"] as const) {
    const palette = value[mode] as Record<string, unknown> | undefined;
    if (!palette || typeof palette !== "object") throw new Error(`Missing ${mode} palette`);
    for (const key of APPEARANCE_SURFACES) {
      if (typeof palette[key] !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(palette[key])) {
        throw new Error(`Invalid ${mode}.${key} color`);
      }
    }
  }
  return normalizeAppearanceSettings(value);
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  enabled: false,
  imagePath: "",
  opacity: 0.55,
  blur: 8,
};

export function normalizeBackgroundSettings(input: unknown): BackgroundSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const imagePath = typeof obj.imagePath === "string" ? obj.imagePath.trim() : "";
  const rawOpacity =
    typeof obj.opacity === "number" && Number.isFinite(obj.opacity)
      ? obj.opacity
      : DEFAULT_BACKGROUND_SETTINGS.opacity;
  const rawBlur =
    typeof obj.blur === "number" && Number.isFinite(obj.blur)
      ? obj.blur
      : DEFAULT_BACKGROUND_SETTINGS.blur;
  return {
    enabled: obj.enabled === true && imagePath.length > 0,
    imagePath,
    opacity: Math.min(0.9, Math.max(0.1, Math.round(rawOpacity * 100) / 100)),
    blur: Math.min(24, Math.max(0, Math.round(rawBlur))),
  };
}

export function normalizeCustomSettings(
  input: unknown,
  customProviders: CustomProvider[],
): CustomSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const chatSidebar = (
    obj.chatSidebar && typeof obj.chatSidebar === "object" ? obj.chatSidebar : {}
  ) as Record<string, unknown>;
  return {
    conversationTitleEnabled: obj.conversationTitleEnabled !== false,
    conversationTitleModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.conversationTitleModel),
      customProviders,
    ),
    translationModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.translationModel),
      customProviders,
    ),
    compactionModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.compactionModel),
      customProviders,
    ),
    quickAskModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.quickAskModel),
      customProviders,
    ),
    visionModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.visionModel),
      customProviders,
    ),
    visionRoutingMode: obj.visionRoutingMode === "off" ? "off" : "auto",
    imageGenModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.imageGenModel),
      customProviders,
    ),
    advisorModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.advisorModel),
      customProviders,
    ),
    subagentDefaultModel: normalizeSelectedModelForProviders(
      normalizeSelectedModel(obj.subagentDefaultModel),
      customProviders,
    ),
    translation: normalizeTranslationPreferences(obj.translation),
    chatSidebar: {
      projectsCollapsed: chatSidebar.projectsCollapsed === true,
      recentCollapsed: chatSidebar.recentCollapsed === true,
    },
    rightDock: normalizeRightDockSettings(obj.rightDock),
    fontScale: normalizeFontScaleSettings(obj.fontScale),
    background: normalizeBackgroundSettings(obj.background),
    draftPersistence: normalizeDraftPersistenceSettings(obj.draftPersistence),
    chatLayout: normalizeChatLayoutSettings(obj.chatLayout),
    appearance: normalizeAppearanceSettings(obj.appearance),
    providerHistory: normalizeProviderHistorySettings(obj.providerHistory),
  };
}

export function normalizeUpdateSettings(input: unknown): UpdateSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    includePrereleases: obj.includePrereleases === true,
  };
}

export function getDefaultSettings(): AppSettings {
  const customProviders = getBuiltinCustomProviders();
  return {
    system: {
      executionMode: "tools",
      workdir: "",
      selectedSystemTools: [],
      defaultShell: "auto",
      workspaceProjects: [],
      activeWorkspaceProjectId: undefined,
      hiddenWorkspaceProjectPaths: [],
      missingWorkspaceProjectPaths: [],
      hideDefaultWorkspaceProject: false,
      quickAskHotkey: DEFAULT_QUICK_ASK_HOTKEY,
    },
    customProviders,
    mcp: {
      servers: [],
      selected: [],
    },
    agents: [],
    ssh: {
      hosts: [],
      projectHostAssociations: {},
    },
    remote: {
      enabled: false,
      gatewayUrl: "",
      grpcPort: 50051,
      grpcEndpoint: "",
      token: "",
      agentId: "",
      autoReconnect: true,
      heartbeatInterval: 30,
      enableWebTerminal: false,
      enableWebSshTerminal: false,
      enableWebGit: false,
      enableWebTunnels: false,
    },
    memory: normalizeMemorySettings({}, customProviders),
    customSettings: normalizeCustomSettings({}, customProviders),
    updates: normalizeUpdateSettings({}),
    skills: {
      enabled: true,
      selected: mergeAlwaysEnabledSkillNames([]),
    },
    chatRuntimeControls: DEFAULT_CHAT_RUNTIME_CONTROLS,
    selectedModel: undefined,
    theme: "light",
    locale: DEFAULT_LOCALE,
  };
}

export function normalizeSettings(input?: Partial<AppSettings> | null): AppSettings {
  const defaults = getDefaultSettings();
  const obj = (input && typeof input === "object" ? input : {}) as Partial<AppSettings>;
  const customProviders = Array.isArray(obj.customProviders)
    ? obj.customProviders.map((provider) => normalizeCustomProvider(provider))
    : defaults.customProviders;
  const selectedModel = normalizeSelectedModelForProviders(
    normalizeSelectedModel(obj.selectedModel),
    customProviders,
  );

  return {
    system: normalizeSystemSettings(obj.system ?? defaults.system),
    customProviders,
    mcp: normalizeMcpSettings(obj.mcp ?? defaults.mcp),
    agents: normalizeAgentPromptTemplates(obj.agents ?? defaults.agents, customProviders),
    ssh: normalizeSshSettings(obj.ssh ?? defaults.ssh),
    remote: normalizeRemoteSettings(obj.remote ?? defaults.remote),
    memory: normalizeMemorySettings(obj.memory ?? defaults.memory, customProviders),
    customSettings: normalizeCustomSettings(
      obj.customSettings ?? defaults.customSettings,
      customProviders,
    ),
    updates: normalizeUpdateSettings(obj.updates ?? defaults.updates),
    skills: normalizeSkillsSettings(obj.skills ?? defaults.skills),
    chatRuntimeControls: normalizeChatRuntimeControls(
      obj.chatRuntimeControls ?? defaults.chatRuntimeControls,
    ),
    selectedModel,
    theme: normalizeTheme(obj.theme),
    locale: normalizeLocale(obj.locale),
  };
}

export function updateSystem(prev: AppSettings, patch: Partial<SystemSettings>): AppSettings {
  return normalizeSettings({
    ...prev,
    system: {
      ...prev.system,
      ...patch,
    },
  });
}

export function updateMcp(prev: AppSettings, patch: Partial<McpSettings>): AppSettings {
  return normalizeSettings({
    ...prev,
    mcp: {
      ...prev.mcp,
      ...patch,
    },
  });
}

export function updateAgents(prev: AppSettings, agents: AgentPromptTemplate[]): AppSettings {
  return normalizeSettings({
    ...prev,
    agents,
  });
}

export function updateSsh(prev: AppSettings, patch: Partial<SshSettings>): AppSettings {
  return normalizeSettings({
    ...prev,
    ssh: {
      ...prev.ssh,
      ...patch,
    },
  });
}

function normalizeSshProjectHostIdList(ssh: SshSettings, hostIds: readonly string[]): string[] {
  const availableHostIds = new Set(ssh.hosts.map((host) => host.id));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawHostId of hostIds) {
    const hostId = rawHostId.trim();
    if (!hostId || !availableHostIds.has(hostId) || seen.has(hostId)) continue;
    seen.add(hostId);
    ids.push(hostId);
    if (ids.length >= 64) break;
  }
  return ids;
}

export function getSshProjectHostIds(ssh: SshSettings, projectPathKey: string): string[] {
  const normalizedPathKey = workspaceProjectPathKey(projectPathKey);
  if (!normalizedPathKey) return [];
  return normalizeSshProjectHostIdList(ssh, ssh.projectHostAssociations[normalizedPathKey] ?? []);
}

export function updateSshProjectHostIds(
  prev: AppSettings,
  projectPathKey: string,
  hostIds: readonly string[],
): AppSettings {
  const normalizedPathKey = workspaceProjectPathKey(projectPathKey);
  if (!normalizedPathKey) return prev;
  const nextHostIds = normalizeSshProjectHostIdList(prev.ssh, hostIds);
  const currentHostIds = getSshProjectHostIds(prev.ssh, normalizedPathKey);
  if (
    currentHostIds.length === nextHostIds.length &&
    currentHostIds.every((hostId, index) => hostId === nextHostIds[index])
  ) {
    return prev;
  }
  const projectHostAssociations = { ...prev.ssh.projectHostAssociations };
  if (nextHostIds.length > 0) {
    projectHostAssociations[normalizedPathKey] = nextHostIds;
  } else {
    delete projectHostAssociations[normalizedPathKey];
  }
  return updateSsh(prev, { projectHostAssociations });
}

export function removeSshHostFromProjectAssociations(
  prev: AppSettings,
  hostId: string,
): AppSettings {
  const normalizedHostId = hostId.trim();
  if (!normalizedHostId) return prev;
  let changed = false;
  const projectHostAssociations: Record<string, string[]> = {};
  for (const [pathKey, hostIds] of Object.entries(prev.ssh.projectHostAssociations)) {
    const nextHostIds = hostIds.filter((item) => item !== normalizedHostId);
    if (nextHostIds.length !== hostIds.length) {
      changed = true;
    }
    if (nextHostIds.length > 0) {
      projectHostAssociations[pathKey] = nextHostIds;
    }
  }
  return changed ? updateSsh(prev, { projectHostAssociations }) : prev;
}

export function updateSkills(prev: AppSettings, patch: Partial<SkillsSettings>): AppSettings {
  return normalizeSettings({
    ...prev,
    skills: {
      ...prev.skills,
      ...patch,
    },
  });
}

export function updateMemorySettings(
  prev: AppSettings,
  patch: Partial<MemorySettings>,
): AppSettings {
  return normalizeSettings({
    ...prev,
    memory: {
      ...prev.memory,
      ...patch,
    },
  });
}

export function updateCustomSettings(
  prev: AppSettings,
  patch: Partial<CustomSettings>,
): AppSettings {
  return normalizeSettings({
    ...prev,
    customSettings: {
      ...prev.customSettings,
      ...patch,
    },
  });
}

const RIGHT_DOCK_WRITER_ID_STORAGE_KEY = "liveagent.client-id";

let cachedRightDockWriterId = "";

function generateRightDockWriterId(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return uuid.replace(/-/g, "").slice(0, 12);
}

// Stable per-client id used to break stateVersion ties deterministically in
// mergeSyncedRightDockSettings: both sides of a merge evaluate the same
// (stateVersion, writerId) order, so concurrent writers converge without the
// old "+2 beats the echo" version-bump tricks.
export function getRightDockWriterId(): string {
  if (cachedRightDockWriterId) return cachedRightDockWriterId;
  let stored = "";
  try {
    stored = globalThis.localStorage?.getItem(RIGHT_DOCK_WRITER_ID_STORAGE_KEY) ?? "";
  } catch {
    stored = "";
  }
  const normalized = stored.trim().slice(0, 32);
  if (normalized) {
    cachedRightDockWriterId = normalized;
    return normalized;
  }
  const generated = generateRightDockWriterId();
  try {
    globalThis.localStorage?.setItem(RIGHT_DOCK_WRITER_ID_STORAGE_KEY, generated);
  } catch {
    // Ephemeral id for environments without storage (e.g. tests).
  }
  cachedRightDockWriterId = generated;
  return generated;
}

// Version fields are stamped centrally by updateRightDockProjectState; content
// is everything a user can observe or reorder.
function rightDockProjectContentKey(state: RightDockProjectState): string {
  return JSON.stringify({
    activeTabId: state.activeTabId ?? "",
    tabOrder: state.tabOrder,
    tools: RIGHT_DOCK_TOOL_KINDS.map((kind) => [kind, state.tools[kind] ?? null]),
    openVersion: state.openVersion,
  });
}

function rightDockFileTreeStateEqual(
  left: RightDockFileTreeState,
  right: RightDockFileTreeState,
): boolean {
  return (
    left.query === right.query &&
    left.selectedPath === right.selectedPath &&
    left.revision === right.revision &&
    left.expandedPaths.length === right.expandedPaths.length &&
    left.expandedPaths.every((path, index) => path === right.expandedPaths[index])
  );
}

export function getRightDockProjectState(
  customSettings: CustomSettings,
  projectPathKey: string,
): RightDockProjectState {
  const normalizedPathKey = workspaceProjectPathKey(projectPathKey);
  return normalizeRightDockProjectState(
    normalizedPathKey ? customSettings.rightDock.projects[normalizedPathKey] : {},
  );
}

export function updateRightDockWidth(prev: AppSettings, width: number): AppSettings {
  const nextWidth = normalizeIntegerInRange(width, 320, 1280, 420);
  if (prev.customSettings.rightDock.width === nextWidth) return prev;
  return updateCustomSettings(prev, {
    rightDock: {
      ...prev.customSettings.rightDock,
      width: nextWidth,
    },
  });
}

// All persisted dock mutations funnel through here: the updater describes
// content only, and version stamping (stateVersion / writerId / lastUsedAt)
// happens centrally so no call site can get the merge bookkeeping wrong.
export function updateRightDockProjectState(
  prev: AppSettings,
  projectPathKey: string,
  updater: (current: RightDockProjectState) => RightDockProjectState,
): AppSettings {
  const normalizedPathKey = workspaceProjectPathKey(projectPathKey);
  if (!normalizedPathKey) return prev;
  const current = getRightDockProjectState(prev.customSettings, normalizedPathKey);
  const next = normalizeRightDockProjectState(updater(current));
  if (rightDockProjectContentKey(current) === rightDockProjectContentKey(next)) return prev;
  return updateCustomSettings(prev, {
    rightDock: {
      ...prev.customSettings.rightDock,
      projects: {
        ...prev.customSettings.rightDock.projects,
        [normalizedPathKey]: {
          ...next,
          stateVersion: current.stateVersion + 1,
          writerId: getRightDockWriterId(),
          lastUsedAt: Date.now(),
        },
      },
    },
  });
}

export function createRightDockToolTab(kind: RightDockToolKind): RightDockToolTab {
  return {
    openedAt: Date.now(),
    ...(kind === "fileTree" ? { uiState: DEFAULT_RIGHT_DOCK_FILE_TREE_STATE } : {}),
  };
}

export function openRightDockToolTabState(
  current: RightDockProjectState,
  kind: RightDockToolKind,
): RightDockProjectState {
  const tabId = RIGHT_DOCK_SINGLETON_TAB_IDS[kind];
  const alreadyOpen = Boolean(current.tools[kind]);
  if (alreadyOpen && current.activeTabId === tabId && current.tabOrder.includes(tabId)) {
    return current;
  }
  return {
    ...current,
    activeTabId: tabId,
    tabOrder: current.tabOrder.includes(tabId) ? current.tabOrder : [...current.tabOrder, tabId],
    tools: alreadyOpen ? current.tools : { ...current.tools, [kind]: createRightDockToolTab(kind) },
    openVersion: current.openVersion + (alreadyOpen ? 0 : 1),
  };
}

export function openRightDockSingletonTab(
  prev: AppSettings,
  projectPathKey: string,
  kind: RightDockToolKind,
): AppSettings {
  return updateRightDockProjectState(prev, projectPathKey, (current) =>
    openRightDockToolTabState(current, kind),
  );
}

export function isRightDockSingletonTabOpen(
  customSettings: CustomSettings,
  projectPathKey: string,
  kind: RightDockToolKind,
): boolean {
  const state = getRightDockProjectState(customSettings, projectPathKey);
  return Boolean(state.tools[kind]);
}

export function removeRightDockProjectState(
  prev: AppSettings,
  projectPathKey: string,
): AppSettings {
  const normalizedPathKey = workspaceProjectPathKey(projectPathKey);
  if (!normalizedPathKey) return prev;
  const hasRightDockProject = Object.hasOwn(
    prev.customSettings.rightDock.projects,
    normalizedPathKey,
  );
  const hasSshProjectAssociation = Object.hasOwn(
    prev.ssh.projectHostAssociations,
    normalizedPathKey,
  );
  if (!hasRightDockProject && !hasSshProjectAssociation) return prev;
  const currentRightDockProject = getRightDockProjectState(prev.customSettings, normalizedPathKey);
  const hasRightDockTools = Object.keys(currentRightDockProject.tools).length > 0;
  if (hasRightDockProject && !hasRightDockTools && !hasSshProjectAssociation) return prev;

  const projects = hasRightDockProject
    ? { ...prev.customSettings.rightDock.projects }
    : prev.customSettings.rightDock.projects;
  if (hasRightDockProject && hasRightDockTools) {
    projects[normalizedPathKey] = {
      tabOrder: [],
      tools: {},
      openVersion: currentRightDockProject.openVersion + 1,
      stateVersion: currentRightDockProject.stateVersion + 1,
      writerId: getRightDockWriterId(),
      lastUsedAt: Date.now(),
    };
  }
  const projectHostAssociations = hasSshProjectAssociation
    ? { ...prev.ssh.projectHostAssociations }
    : prev.ssh.projectHostAssociations;
  if (hasSshProjectAssociation) delete projectHostAssociations[normalizedPathKey];

  return normalizeSettings({
    ...prev,
    ssh: {
      ...prev.ssh,
      projectHostAssociations,
    },
    customSettings: {
      ...prev.customSettings,
      rightDock: {
        ...prev.customSettings.rightDock,
        projects,
      },
    },
  });
}

export function getRightDockFileTreeState(
  customSettings: CustomSettings,
  projectPathKey: string,
): RightDockFileTreeState {
  const projectState = getRightDockProjectState(customSettings, projectPathKey);
  const state = projectState.tools.fileTree?.uiState;
  return state ? normalizeRightDockFileTreeState(state) : DEFAULT_RIGHT_DOCK_FILE_TREE_STATE;
}

export function updateRightDockFileTreeState(
  prev: AppSettings,
  projectPathKey: string,
  patch: RightDockFileTreeStatePatch,
): AppSettings {
  const normalizedPathKey = workspaceProjectPathKey(projectPathKey);
  if (!normalizedPathKey) return prev;
  const current = getRightDockFileTreeState(prev.customSettings, normalizedPathKey);
  const next: RightDockFileTreeState = {
    query:
      patch.query !== undefined
        ? normalizeRightDockFileTreeSearchQuery(patch.query)
        : current.query,
    selectedPath:
      patch.selectedPath !== undefined
        ? normalizeRightDockFileTreePath(patch.selectedPath)
        : current.selectedPath,
    expandedPaths:
      patch.expandedPaths !== undefined
        ? normalizeRightDockFileTreeExpandedPaths(patch.expandedPaths)
        : current.expandedPaths,
    revision: patch.bumpRevision
      ? current.revision + 1
      : patch.revision !== undefined
        ? normalizeIntegerInRange(patch.revision, 0, Number.MAX_SAFE_INTEGER, 0)
        : current.revision,
  };
  if (rightDockFileTreeStateEqual(current, next)) return prev;
  return updateRightDockProjectState(prev, normalizedPathKey, (projectState) => {
    const tab = projectState.tools.fileTree ?? createRightDockToolTab("fileTree");
    return {
      ...projectState,
      tools: {
        ...projectState.tools,
        fileTree: { ...tab, uiState: next },
      },
    };
  });
}

export function updateUpdateSettings(
  prev: AppSettings,
  patch: Partial<UpdateSettings>,
): AppSettings {
  return normalizeSettings({
    ...prev,
    updates: {
      ...prev.updates,
      ...patch,
    },
  });
}

export function updateCustomProviders(
  prev: AppSettings,
  customProviders: CustomProvider[],
): AppSettings {
  return normalizeSettings({
    ...prev,
    customProviders,
  });
}

export function setSelectedModel(
  prev: AppSettings,
  selectedModel: SelectedModel | undefined,
): AppSettings {
  return normalizeSettings({
    ...prev,
    selectedModel,
  });
}

export {
  applyMcpOps,
  applyMcpOpsToAppSettings,
  type McpSettingsOp,
  selectEnabledMcpServers,
} from "./mcpOps";

export {
  type ChatModelFallback,
  type ModelRole,
  type ResolvedRoleModel,
  resolveAdvisorRoleModel,
  resolveCompactionRoleModel,
  resolveConversationTitleRoleModel,
  resolveEnabledSelectedModel,
  resolveFirstAvailableModel,
  resolveFollowCurrentRoleModel,
  resolveMemoryExtractionRoleModel,
  resolveMemoryOrganizerRoleModel,
  resolveQuickAskRoleModel,
  resolveSubagentRoleModel,
  resolveTranslationRoleModel,
  resolveVisionRoleModelCandidates,
} from "./modelRouting";
