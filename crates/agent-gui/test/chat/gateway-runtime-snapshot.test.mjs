import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();

const {
  buildGatewayRuntimeSnapshotEntries,
  buildGatewayRuntimeSnapshotToolStatus,
} = loader.loadModule("src/pages/chat/gateway/chatRuntimeSnapshot.ts");
const { buildGatewayToolCallPreviewArguments } = loader.loadModule(
  "src/pages/chat/turns/gatewayToolPreview.ts"
);
const toolPreview = loader.loadModule("src/lib/chat/messages/toolPreview.ts");

test("gateway runtime snapshot projects live rounds into chat entries", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-1",
      content: "Run the checks",
    },
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: "Running shell",
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            { kind: "thinking", text: "I will inspect the repo." },
            { kind: "text", text: "I found the issue." },
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "tool-1",
                  name: "Shell",
                  arguments: { cmd: "pnpm test" },
                },
                toolResult: {
                  role: "toolResult",
                  toolCallId: "tool-1",
                  toolName: "Shell",
                  content: [{ type: "text", text: "ok" }],
                },
              },
            },
            { kind: "text", text: " Next step is ready." },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "thinking", "assistant", "tool_call", "tool_result", "assistant"]
  );
  assert.equal(entries[0].text, "Run the checks");
  assert.equal(entries[1].text, "I will inspect the repo.");
  assert.equal(entries[2].text, "I found the issue.");
  assert.equal(entries[3].toolCall.name, "Shell");
  assert.equal(entries[4].toolResult.toolCallId, "tool-1");
  assert.equal(entries[5].text, " Next step is ready.");
});

test("gateway runtime snapshot redacts a marked portfolio turn before tool execution", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-private-1",
      content:
        "分析我的持仓：600519 100 股\n\nSelected files: uploads/portfolio-secret.csv",
      liveAgentDisplayContent: "分析我的持仓：600519 100 股",
      liveAgentAttachments: [
        {
          relativePath: "uploads/portfolio-secret.csv",
          absolutePath: "C:/private/portfolio-secret.csv",
          fileName: "portfolio-secret.csv",
          kind: "spreadsheet",
          sizeBytes: 1024,
        },
      ],
      calenGatewayPrivacy: "stock_portfolio",
    },
    liveTranscript: {
      draftAssistantText: "家庭资产总值 150000",
      toolStatus: null,
      liveRounds: [],
    },
  });

  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(
    serialized,
    /600519|100 股|portfolio-secret|C:\/private|家庭资产总值|150000/
  );
  assert.deepEqual(entries[0], {
    id: "user-private-1",
    kind: "user",
    text: "Calen kept this local portfolio result on the desktop and did not send asset data to Gateway.",
    attachments: [],
  });
  assert.match(entries[1].text, /did not send asset data to Gateway/);
  assert.equal(
    buildGatewayRuntimeSnapshotToolStatus({
      userMessage: {
        role: "user",
        content: "分析我的持仓：600519 100 股",
        calenGatewayPrivacy: "stock_portfolio",
      },
      liveTranscript: {
        draftAssistantText: "",
        toolStatus: "Read uploads/portfolio-secret.csv",
        liveRounds: [],
      },
    }),
    "本地组合分析"
  );
});

test("gateway runtime snapshot carries the same tool preview shape as bridge deltas", () => {
  const content = "z".repeat(9000);
  const toolCall = {
    type: "toolCall",
    id: "tool-write",
    name: "Write",
    arguments: { path: "big.txt", content },
  };
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: null,
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: null,
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: ["tool-write"],
          thinkingOpen: false,
          blocks: [{ kind: "tool", item: { toolCall } }],
        },
      ],
    },
  });

  const entry = entries.find((candidate) => candidate.kind === "tool_call");
  assert.ok(entry, "expected a tool_call entry");
  assert.deepEqual(
    entry.toolCall.arguments,
    buildGatewayToolCallPreviewArguments(toolCall)
  );
  assert.ok(entry.toolCall.arguments.content.length <= 4000);
  const metadata =
    entry.toolCall.arguments[toolPreview.LIVE_TOOL_PREVIEW_META_KEY];
  assert.equal(metadata.progress, content.length);
  assert.equal(metadata.fields.content.chars, content.length);
});

test("gateway runtime snapshot redacts local portfolio tool calls and results", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: null,
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: null,
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "stock-call-1",
                  name: "StockPortfolioRead",
                  arguments: {
                    action: "transactions",
                    portfolioId: "portfolio-secret-1",
                  },
                },
                toolResult: {
                  role: "toolResult",
                  toolCallId: "stock-call-1",
                  toolName: "StockPortfolioRead",
                  content: [
                    {
                      type: "text",
                      text: "portfolio-secret-1 600519 trade-secret-1 1500 家庭资产",
                    },
                  ],
                  details: {
                    kind: "stock_result",
                    operation: "portfolio",
                    result: {
                      positions: [{ symbol: "600519", quantity: 100 }],
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  });

  assert.equal(entries.length, 2);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(
    serialized,
    /portfolio-secret-1|trade-secret-1|600519|1500|家庭资产/
  );
  assert.deepEqual(entries[0].toolCall.arguments, {
    localOnly: true,
    redacted: true,
  });
  assert.equal(entries[1].toolResult.details.localOnly, true);
  assert.equal(entries[1].toolResult.details.result, null);
});

test("gateway runtime snapshot suppresses assistant text after a local portfolio read", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: null,
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: null,
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            { kind: "text", text: "portfolio-secret-1 before tool" },
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "stock-call-1",
                  name: "StockPortfolioRead",
                  arguments: { portfolioId: "portfolio-secret-1" },
                },
              },
            },
          ],
        },
        {
          key: "round-2",
          round: 2,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            { kind: "thinking", text: "600519 quantity 100" },
            { kind: "text", text: "家庭资产 value 150000" },
          ],
        },
      ],
    },
  });

  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /portfolio-secret-1|600519|150000|家庭资产/);
  assert.match(serialized, /did not send asset data to Gateway/);
  assert.equal(
    entries.some((entry) => entry.kind === "thinking"),
    false
  );
});

test("gateway runtime snapshot redacts follow-up tools after a local portfolio read", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: null,
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: null,
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "stock-call-1",
                  name: "StockPortfolioRead",
                  arguments: { portfolioId: "portfolio-secret-1" },
                },
              },
            },
          ],
        },
        {
          key: "round-2",
          round: 2,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "research-call-1",
                  name: "StockResearch",
                  arguments: { symbol: "600519", reason: "held-position" },
                },
                toolResult: {
                  role: "toolResult",
                  toolCallId: "research-call-1",
                  toolName: "StockResearch",
                  content: [
                    { type: "text", text: "position-derived-result-150000" },
                  ],
                  details: { symbol: "600519", quantity: 100 },
                },
              },
            },
          ],
        },
      ],
    },
  });

  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(
    serialized,
    /portfolio-secret-1|held-position|position-derived-result|600519|150000/
  );
  const researchCall = entries.find(
    (entry) =>
      entry.kind === "tool_call" && entry.toolCall.name === "StockResearch"
  );
  assert.deepEqual(researchCall?.toolCall.arguments, {
    localOnly: true,
    redacted: true,
  });
});

test("gateway runtime snapshot falls back to draft assistant text", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-2",
      content: "Continue",
    },
    liveTranscript: {
      draftAssistantText: "streaming text",
      toolStatus: null,
      liveRounds: [],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "assistant"]
  );
  assert.equal(entries[1].text, "streaming text");
});
