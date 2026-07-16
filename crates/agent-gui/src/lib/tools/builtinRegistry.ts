import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { homeDir } from "@tauri-apps/api/path";
import type { RuntimePlatform } from "../runtimePlatform";
import {
  type McpSettings,
  type McpSettingsOp,
  type ProviderId,
  type SshHostConfig,
  selectEnabledMcpServers,
} from "../settings";
import {
  createSendMessageTools,
  createSubagentTools,
  SUBAGENT_PARENT_ID,
  type SubagentRuntimeConfig,
} from "../subagents";
import type {
  BuiltinToolBundle,
  BuiltinToolExecutionContext,
  BuiltinToolMetadata,
} from "./builtinTypes";
import { createCronTools } from "./cronTools";
import { createCustomSystemTools } from "./customSystemTools";
import { createFileToolState, type FileToolState } from "./fileToolState";
import { createFsTools } from "./fsTools";
import { createMcpManagerTools } from "./mcpManagerTools";
import { createMcpTools } from "./mcpTools";
import { createMemoryTools } from "./memoryTools";
import { createShellTools } from "./shellTools";
import type { SkillAccessPolicy } from "./skillAccessPolicy";
import { createSkillTools } from "./skillTools";
import { createSSHManagerTools, type SshManagerSessionChange } from "./sshManagerTools";
import { createStockResearchTools } from "./stockResearchTools";
import type { SystemToolId, SystemToolRuntimeScope } from "./systemToolOptions";
import { createTerminalTools } from "./terminalTools";
import { createTodoTools, type TodoToolState } from "./todoTools";
import { createTunnelManagerTools, type TunnelManagerChange } from "./tunnelManagerTools";

export type BuiltinToolRegistry = {
  tools: BuiltinToolBundle["tools"];
  executeToolCall: (
    toolCall: ToolCall,
    signal?: AbortSignal,
    context?: BuiltinToolExecutionContext,
  ) => Promise<ToolResultMessage>;
  metadataByName: Map<string, BuiltinToolMetadata>;
  hasTool: (toolName: string) => boolean;
};

export type BuiltinToolRequestOrigin = "local" | "gateway";

function createBuiltinToolRegistry(bundles: BuiltinToolBundle[]): BuiltinToolRegistry {
  const tools: BuiltinToolBundle["tools"] = [];
  const metadataByName = new Map<string, BuiltinToolMetadata>();
  const executorsByName = new Map<string, BuiltinToolBundle["executeToolCall"]>();
  const canonicalToolNameByLookupKey = new Map<string, string | null>();

  const registerCanonicalToolName = (toolName: string) => {
    const key = toolName.trim().toLowerCase();
    if (!key) return;
    const existing = canonicalToolNameByLookupKey.get(key);
    if (existing === undefined) {
      canonicalToolNameByLookupKey.set(key, toolName);
    } else if (existing !== toolName) {
      canonicalToolNameByLookupKey.set(key, null);
    }
  };

  const resolveToolName = (toolName: string) => {
    if (executorsByName.has(toolName)) return toolName;
    const canonical = canonicalToolNameByLookupKey.get(toolName.trim().toLowerCase());
    return canonical && executorsByName.has(canonical) ? canonical : null;
  };

  for (const bundle of bundles) {
    for (const tool of bundle.tools) {
      if (executorsByName.has(tool.name)) {
        throw new Error(`Duplicate builtin tool name detected: ${tool.name}`);
      }
      tools.push(tool);
      executorsByName.set(tool.name, bundle.executeToolCall);
      registerCanonicalToolName(tool.name);
      const metadata = bundle.metadataByName.get(tool.name);
      if (metadata) {
        metadataByName.set(tool.name, metadata);
      }
    }
  }

  return {
    tools,
    metadataByName,
    hasTool: (toolName) => resolveToolName(toolName) !== null,
    async executeToolCall(toolCall, signal, context) {
      const resolvedToolName = resolveToolName(toolCall.name);
      if (!resolvedToolName) {
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
          details: {},
          isError: true,
          timestamp: Date.now(),
        };
      }
      const execute = executorsByName.get(resolvedToolName);
      if (!execute) {
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
          details: {},
          isError: true,
          timestamp: Date.now(),
        };
      }
      const effectiveToolCall =
        resolvedToolName === toolCall.name ? toolCall : { ...toolCall, name: resolvedToolName };
      return execute(effectiveToolCall, signal, context);
    },
  };
}

type BuildBuiltinBaseToolRegistryParams = {
  workdir: string;
  providerId: ProviderId;
  runtimePlatform?: RuntimePlatform;
  fileState: FileToolState;
  skillsEnabled: boolean;
  skillsRootDir?: string;
  skillAccessPolicy?: SkillAccessPolicy;
  onManagedSkillsChanged?: (change: {
    action: "install" | "create";
    names: string[];
    baseDirs: string[];
  }) => void | Promise<void>;
  runtimeScope: SystemToolRuntimeScope;
  currentChatModel?: {
    customProviderId: string;
    model: string;
  };
  selectedSystemToolIds: SystemToolId[];
  /** Live read of the authoritative MCP settings (never a turn-level snapshot). */
  getMcpSettings: () => McpSettings;
  /** Id-keyed merge commit into the authoritative settings; absent in read-only scopes. */
  applyMcpOps?: (ops: McpSettingsOp[]) => void;
  onMcpLoadError?: (message: string) => void;
  mcpLoadFailureMode?: "continue" | "throw";
  memoryToolMode?: "rw" | "ro";
  remoteWebTunnelsEnabled?: boolean;
  tunnelProjectPathKey?: string;
  tunnelPublicBaseUrl?: string;
  sshHosts?: SshHostConfig[];
  associatedSshHostIds?: string[];
  sshManagerRemoteAllowed?: boolean;
  onSshSessionsChanged?: (change: SshManagerSessionChange) => void | Promise<void>;
  onTunnelsChanged?: (change: TunnelManagerChange) => void | Promise<void>;
  /** Gateway turns must not receive tools that can inspect or mutate the desktop host. */
  requestOrigin: BuiltinToolRequestOrigin;
  portfolioReadAuthorized?: boolean;
};

const resolveHomeDir = () => homeDir();

async function buildBaseBuiltinToolBundles(params: BuildBuiltinBaseToolRegistryParams) {
  // This is intentionally an allowlist boundary rather than per-tool
  // redaction. A Gateway-originated model turn must never receive a handle to
  // the desktop filesystem, shell, terminal, memory, MCP processes, cron,
  // tunnels, or other host-capability adapters in the first place.
  if (params.requestOrigin === "gateway") {
    return [];
  }

  const baseBundles: BuiltinToolBundle[] = [
    createFsTools({
      workdir: params.workdir,
      fileState: params.fileState,
      skillsRootEnabled: params.skillsEnabled,
      skillsRootDir: params.skillsRootDir,
      skillAccessPolicy: params.skillAccessPolicy,
      resolveHomeDir,
    }),
    createShellTools({
      workdir: params.workdir,
      providerId: params.providerId,
      runtimePlatform: params.runtimePlatform,
      skillsRootEnabled: params.skillsEnabled,
      skillsRootDir: params.skillsRootDir,
      skillAccessPolicy: params.skillAccessPolicy,
      managedProcessEnabled: params.runtimeScope === "chat",
      resolveHomeDir,
    }),
    ...(params.skillsEnabled
      ? [
          createSkillTools({
            workdir: params.workdir,
            skillAccessPolicy: params.skillAccessPolicy,
            onManagedSkillsChanged: params.onManagedSkillsChanged,
          }),
        ]
      : []),
    createCronTools({
      currentChatModel: params.currentChatModel,
    }),
    createMcpManagerTools({
      workdir: params.workdir,
      getMcpSettings: params.getMcpSettings,
      applyMcpOps: params.applyMcpOps,
      runtimeScope: params.runtimeScope,
      resolveHomeDir,
    }),
    createCustomSystemTools({
      selectedToolIds: params.selectedSystemToolIds,
      runtimeScope: params.runtimeScope,
      currentChatModel: params.currentChatModel,
    }),
    createMemoryTools({
      workdir: params.workdir,
      mode: params.memoryToolMode ?? "rw",
    }),
    createTunnelManagerTools({
      enabled: params.remoteWebTunnelsEnabled === true && params.runtimeScope === "chat",
      runtimeScope: params.runtimeScope,
      projectPathKey: params.tunnelProjectPathKey,
      publicBaseUrl: params.tunnelPublicBaseUrl,
      onTunnelsChanged: params.onTunnelsChanged,
    }),
    createSSHManagerTools({
      enabled:
        params.runtimeScope === "chat" &&
        params.sshManagerRemoteAllowed !== false &&
        (params.associatedSshHostIds?.length ?? 0) > 0,
      runtimeScope: params.runtimeScope,
      workdir: params.workdir,
      projectPathKey: params.tunnelProjectPathKey,
      hosts: params.sshHosts,
      associatedHostIds: params.associatedSshHostIds,
      resolveHomeDir,
      onSshSessionsChanged: params.onSshSessionsChanged,
    }),
    ...(params.runtimeScope === "chat"
      ? [
          createTerminalTools({
            workdir: params.workdir,
          }),
        ]
      : []),
  ];

  const enabledServers = selectEnabledMcpServers(params.getMcpSettings());
  if (enabledServers.length > 0) {
    baseBundles.push(
      await createMcpTools({
        servers: enabledServers,
        onLoadError: params.onMcpLoadError,
        loadFailureMode: params.mcpLoadFailureMode,
      }),
    );
  }

  return baseBundles;
}

export async function buildBuiltinToolRegistry(
  params: BuildBuiltinBaseToolRegistryParams & {
    subagentRuntime?: SubagentRuntimeConfig;
    todoState?: TodoToolState;
  },
) {
  const baseBundles = await buildBaseBuiltinToolBundles(params);
  const todoBundles =
    params.runtimeScope === "chat" && params.todoState
      ? [createTodoTools({ state: params.todoState })]
      : [];
  const stockBundles = [
    createStockResearchTools({
      runtimeScope: params.runtimeScope,
      portfolioReadAuthorized:
        params.requestOrigin !== "gateway" && params.portfolioReadAuthorized === true,
    }),
  ];

  // Subagents would otherwise become a second path back into the local host
  // tool registry, so they are not registered for remotely initiated turns.
  const subagentRuntime = params.requestOrigin === "gateway" ? undefined : params.subagentRuntime;
  if (!subagentRuntime) {
    return createBuiltinToolRegistry([...baseBundles, ...stockBundles, ...todoBundles]);
  }

  const baseRegistry = createBuiltinToolRegistry(baseBundles);
  // The Agent tool description embeds the roster, so the store must be
  // hydrated before the bundle is created. Roster load failures degrade to an
  // empty roster instead of blocking the whole registry.
  try {
    await subagentRuntime.store.ready();
  } catch (error) {
    console.warn("Failed to load subagent roster for the Agent tool", error);
  }
  const parentMessageBundle = subagentRuntime.store.conversationId
    ? createSendMessageTools({
        store: subagentRuntime.store,
        senderId: SUBAGENT_PARENT_ID,
        senderName: "Parent Agent",
      })
    : null;
  const parentBundles = parentMessageBundle
    ? [...baseBundles, ...stockBundles, parentMessageBundle]
    : [...baseBundles, ...stockBundles];
  return createBuiltinToolRegistry([
    ...parentBundles,
    ...todoBundles,
    createSubagentTools({
      providerId: subagentRuntime.providerId,
      model: subagentRuntime.model,
      runtime: subagentRuntime.runtime,
      runtimePlatform: params.runtimePlatform,
      workdir: params.workdir,
      resolveHomeDir,
      sessionId: subagentRuntime.sessionId,
      templates: subagentRuntime.templates,
      store: subagentRuntime.store,
      scheduler: subagentRuntime.scheduler,
      baseTools: baseRegistry.tools,
      executeToolCall: baseRegistry.executeToolCall,
      metadataByName: baseRegistry.metadataByName,
      createSubagentToolRegistry: async (workdir) =>
        createBuiltinToolRegistry(
          await buildBaseBuiltinToolBundles({
            ...params,
            workdir,
            fileState: createFileToolState(),
            skillsEnabled: false,
            applyMcpOps: undefined,
            selectedSystemToolIds: [],
            mcpLoadFailureMode: "continue",
            memoryToolMode: "ro",
          }),
        ),
    }),
  ]);
}
