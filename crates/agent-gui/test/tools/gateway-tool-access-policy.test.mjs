import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createFakeStoreIpc } from "../subagents/harness.mjs";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function createHarness() {
  const invokes = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/path": {
        async homeDir() {
          return "C:/Users/test";
        },
      },
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invokes.push({ command, args });
          if (command === "mcp_list_tools") return [];
          throw new Error(`Unexpected invoke: ${command}`);
        },
      },
    },
  });
  return { loader, invokes };
}

async function buildRegistry({
  requestOrigin = "local",
  portfolioReadAuthorized = true,
  withSubagentRuntime = false,
} = {}) {
  const harness = createHarness();
  const { buildBuiltinToolRegistry } = harness.loader.loadModule(
    "src/lib/tools/builtinRegistry.ts"
  );
  const { createFileToolState } = harness.loader.loadModule(
    "src/lib/tools/fileToolState.ts"
  );
  const { createTodoToolState } = harness.loader.loadModule(
    "src/lib/tools/todoTools.ts"
  );

  const baseParams = {
    workdir: "C:/workspace/calen",
    providerId: "codex",
    fileState: createFileToolState(),
    todoState: createTodoToolState(),
    skillsEnabled: true,
    runtimeScope: "chat",
    requestOrigin,
    portfolioReadAuthorized,
    selectedSystemToolIds: [],
    getMcpSettings: () => ({
      selected: ["local-files"],
      servers: [
        {
          id: "local-files",
          enabled: true,
          transport: "stdio",
          command: "local-files-mcp",
          args: [],
          env: {},
        },
      ],
    }),
  };
  const subagentRuntime = withSubagentRuntime
    ? {
        providerId: "codex",
        model: "gpt-5",
        runtime: { baseUrl: "https://api.example.test/v1", apiKey: "test-key" },
        sessionId: "gateway-session",
        templates: [],
        store: harness.loader
          .loadModule("src/lib/subagents/store.ts")
          .createSubagentConversationStore({
            conversationId: "gateway-conversation",
            ipc: createFakeStoreIpc(),
          }),
        scheduler: harness.loader
          .loadModule("src/lib/subagents/scheduler.ts")
          .createSubagentScheduler(),
      }
    : undefined;
  const registry = await buildBuiltinToolRegistry({
    ...baseParams,
    subagentRuntime,
  });

  return { ...harness, registry };
}

test("gateway-originated turns expose only host-independent stock research and TodoWrite", async () => {
  const { registry, invokes } = await buildRegistry({
    requestOrigin: "gateway",
    withSubagentRuntime: true,
  });
  const names = registry.tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "StockBacktest",
    "StockMarketBrief",
    "StockResearch",
    "StockResolve",
    "StockSnapshot",
    "TodoWrite",
  ]);
  assert.equal(
    invokes.length,
    0,
    "Gateway turns must not even enumerate local MCP servers"
  );

  for (const forbidden of [
    "Read",
    "List",
    "Glob",
    "Grep",
    "Image",
    "Bash",
    "ManagedProcess",
    "ReadTerminal",
    "MemoryManager",
    "SkillsManager",
    "McpManager",
    "CronTaskManager",
    "SSHManager",
    "TunnelManager",
    "Agent",
    "SendMessage",
    "mcp_local-files_read",
    "StockPortfolioRead",
  ]) {
    assert.equal(
      registry.hasTool(forbidden),
      false,
      `${forbidden} must be unavailable`
    );
  }

  const result = await registry.executeToolCall({
    type: "toolCall",
    id: "gateway-shell-bypass",
    name: "Bash",
    arguments: {
      command: "type %USERPROFILE%\\.liveagent\\stock-portfolio.sqlite3",
    },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown tool: Bash/);
});

test("local turns keep the existing host tools and explicit portfolio authorization", async () => {
  const { registry, invokes } = await buildRegistry();
  const names = registry.tools.map((tool) => tool.name);

  assert.ok(names.includes("Read"));
  assert.ok(names.includes("Bash"));
  assert.ok(names.includes("MemoryManager"));
  assert.ok(names.includes("McpManager"));
  assert.ok(names.includes("StockPortfolioRead"));
  assert.deepEqual(
    invokes.map((entry) => entry.command),
    ["mcp_list_tools"],
    "Local turns continue loading enabled MCP tools"
  );
});

test("Gateway bridge origin is wired into the builtin registry policy", async () => {
  const chatPageSource = await readFile(
    path.join(rootDir, "src/pages/ChatPage.tsx"),
    "utf8"
  );
  const turnSource = await readFile(
    path.join(rootDir, "src/pages/chat/turns/runAgentConversationTurn.ts"),
    "utf8"
  );

  assert.match(
    chatPageSource,
    /stockPortfolioRequestOrigin:\s*gatewayBridgeRequest\s*\?\s*"gateway"\s*:\s*"local"/
  );
  assert.match(turnSource, /requestOrigin:\s*stockPortfolioRequestOrigin/);
});
