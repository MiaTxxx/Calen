import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createGatewayBridgeEventController } = loader.loadModule(
  "src/lib/chat/conversation/run/gatewayBridgeEvents.ts"
);

function createController(options = {}) {
  const sent = [];
  const controller = createGatewayBridgeEventController({
    conversationId: options.conversationId ?? "conversation-1",
    requestId: options.requestId ?? "request-1",
    workerId: options.workerId,
    enabled: options.enabled ?? true,
    sendEvent: (requestId, event, sendOptions) => {
      const item = { requestId, event };
      if (sendOptions?.workerId) {
        item.options = sendOptions;
      }
      sent.push(item);
    },
    resolveErrorConversationId: options.resolveErrorConversationId,
  });
  return { controller, sent };
}

test("gateway bridge event controller emits nothing when disabled", () => {
  const { controller, sent } = createController({ enabled: false });

  controller.queueToken("hello", { round: 1 });
  controller.queueTitle("New title", true);
  controller.queueToolStatus("Running");
  controller.queueEvent({ type: "done", conversation_id: "conversation-1" });
  controller.emitError("failed");

  assert.deepEqual(sent, []);
  assert.equal(controller.hasForwardedText(), true);
});

test("gateway bridge token forwarding tracks non-empty text only", () => {
  const { controller, sent } = createController();

  controller.queueToken("");
  assert.deepEqual(sent, []);
  assert.equal(controller.hasForwardedText(), false);

  controller.queueToken("", { round: 1, usage: { totalTokens: 3 } });
  assert.equal(controller.hasForwardedText(), false);
  assert.deepEqual(sent, [
    {
      requestId: "request-1",
      event: {
        type: "token",
        text: "",
        conversation_id: "conversation-1",
        round: 1,
        usage: { totalTokens: 3 },
      },
    },
  ]);

  controller.queueToken("hello", { round: 1 });
  assert.equal(controller.hasForwardedText(), true);
  assert.deepEqual(sent[1], {
    requestId: "request-1",
    event: {
      type: "token",
      text: "hello",
      conversation_id: "conversation-1",
      round: 1,
    },
  });
});

test("gateway bridge started control is explicit and does not mark text forwarded", () => {
  const { controller, sent } = createController();

  controller.queueEvent({
    type: "started",
    conversation_id: "conversation-1",
  });

  assert.equal(controller.hasForwardedText(), false);
  assert.deepEqual(sent, [
    {
      requestId: "request-1",
      event: {
        type: "started",
        conversation_id: "conversation-1",
      },
    },
  ]);
});

test("gateway bridge events carry the remote worker lease owner", () => {
  const { controller, sent } = createController({ workerId: "worker-1" });

  controller.queueEvent({
    type: "started",
    conversation_id: "conversation-1",
  });

  assert.deepEqual(sent, [
    {
      requestId: "request-1",
      event: {
        type: "started",
        conversation_id: "conversation-1",
      },
      options: {
        workerId: "worker-1",
      },
    },
  ]);
});

test("gateway bridge tool status is normalized and de-duplicated", () => {
  const { controller, sent } = createController();

  controller.queueToolStatus(" Running ");
  controller.queueToolStatus("Running");
  controller.queueToolStatus("Running", true);
  controller.queueToolStatus("  ");

  assert.deepEqual(
    sent.map((item) => item.event),
    [
      {
        type: "tool_status",
        status: "Running",
        isCompaction: false,
        conversation_id: "conversation-1",
      },
      {
        type: "tool_status",
        status: "Running",
        isCompaction: true,
        conversation_id: "conversation-1",
      },
      {
        type: "tool_status",
        status: null,
        isCompaction: false,
        conversation_id: "conversation-1",
      },
    ]
  );
});

test("gateway bridge replaces local portfolio tool events with privacy placeholders", () => {
  const { controller, sent } = createController();
  const privateArguments = {
    action: "snapshot",
    portfolioId: "portfolio-secret-1",
  };
  const privateResult = {
    portfolios: [{ id: "portfolio-secret-1", name: "家庭资产" }],
    positions: [{ symbol: "600519", quantity: 100 }],
    transactions: [{ id: "trade-secret-1", price: 1500 }],
  };

  controller.queueEvent({
    type: "tool_call_delta",
    id: "stock-call-1",
    name: "StockPortfolioRead",
    arguments: privateArguments,
    conversation_id: "conversation-1",
  });
  controller.queueEvent({
    type: "tool_call",
    id: "stock-call-1",
    name: "StockPortfolioRead",
    arguments: privateArguments,
    conversation_id: "conversation-1",
  });
  controller.queueEvent({
    type: "tool_result",
    id: "stock-call-1",
    name: "StockPortfolioRead",
    arguments: privateArguments,
    content: [{ type: "text", text: JSON.stringify(privateResult) }],
    details: {
      kind: "stock_result",
      operation: "portfolio",
      result: privateResult,
    },
    conversation_id: "conversation-1",
  });

  assert.equal(sent.length, 3);
  for (const item of sent) {
    const serialized = JSON.stringify(item.event);
    assert.doesNotMatch(
      serialized,
      /portfolio-secret-1|trade-secret-1|600519|1500|家庭资产/
    );
    assert.deepEqual(item.event.arguments, {
      localOnly: true,
      redacted: true,
    });
  }
  assert.deepEqual(sent[2].event.content, [
    {
      type: "text",
      text: "Calen kept this local portfolio result on the desktop and did not send asset data to Gateway.",
    },
  ]);
  assert.deepEqual(sent[2].event.details, {
    kind: "stock_result",
    operation: "portfolio",
    status: "unavailable",
    localOnly: true,
    redacted: true,
    warnings: ["本地资产数据未发送到 Gateway。"],
    result: null,
  });

  assert.equal(privateArguments.portfolioId, "portfolio-secret-1");
  assert.equal(privateResult.positions[0].symbol, "600519");
});

test("gateway bridge suppresses assistant text, titles, and summaries after a local portfolio read", () => {
  const { controller, sent } = createController();

  controller.queueEvent({
    type: "tool_call",
    id: "stock-call-1",
    name: "StockPortfolioRead",
    arguments: { portfolioId: "portfolio-secret-1" },
    conversation_id: "conversation-1",
  });
  controller.queueToken("600519 position value is 150000");
  controller.queueToken("trade-secret-1");
  controller.queueTitle("家庭资产 600519", true);
  controller.queueCheckpoint({
    activeSegmentIndex: 0,
    segments: [
      {
        segmentIndex: 0,
        segmentId: "segment-0",
        messages: [],
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        summary: {
          role: "summary",
          id: "summary-private",
          timestamp: 2,
          content: "portfolio-secret-1 has 150000 in 600519",
          summaryMeta: {
            format: "plain-text-v1",
            strategy: "cumulative-checkpoint",
            coversThroughMessageId: "message-1",
            coveredMessageCount: 1,
            generatedBy: {
              providerId: "codex",
              model: "gpt-test",
              promptVersion: "summary-v2",
            },
          },
        },
      },
    ],
    historyRenderItems: [],
    meta: {
      schemaVersion: 3,
      activeSegmentIndex: 0,
      totalSegmentCount: 1,
      totalMessageCount: 0,
    },
  });

  const serialized = JSON.stringify(sent);
  assert.doesNotMatch(
    serialized,
    /portfolio-secret-1|trade-secret-1|600519|150000|家庭资产/
  );
  assert.equal(
    sent.filter(
      (item) =>
        item.event.type === "token" &&
        item.event.text ===
          "Calen kept this local portfolio result on the desktop and did not send asset data to Gateway."
    ).length,
    2
  );
  assert.equal(sent[2].event.title, "本地组合分析");
});

test("gateway bridge redacts follow-up tool events derived from a local portfolio", () => {
  const { controller, sent } = createController();

  controller.queueEvent({
    type: "tool_call",
    id: "stock-call-1",
    name: "StockPortfolioRead",
    arguments: { portfolioId: "portfolio-secret-1" },
    conversation_id: "conversation-1",
  });
  controller.queueEvent({
    type: "tool_call",
    id: "research-call-1",
    name: "StockResearch",
    arguments: { symbol: "600519", reason: "held-position" },
    conversation_id: "conversation-1",
  });
  controller.queueEvent({
    type: "tool_result",
    id: "research-call-1",
    name: "StockResearch",
    arguments: { symbol: "600519" },
    content: [{ type: "text", text: "position-derived-result-150000" }],
    details: { symbol: "600519", quantity: 100 },
    conversation_id: "conversation-1",
  });

  const serialized = JSON.stringify(sent);
  assert.doesNotMatch(
    serialized,
    /portfolio-secret-1|held-position|position-derived-result|600519|150000/
  );
  assert.deepEqual(sent[1].event.arguments, {
    localOnly: true,
    redacted: true,
  });
  assert.equal(sent[2].event.details.localOnly, true);
});

test("gateway bridge close blocks normal events but allows forced title updates", () => {
  const { controller, sent } = createController();

  controller.queueToken("before");
  controller.close();
  controller.queueToken("after");
  controller.queueTitle("Final title", true);
  controller.queueEvent({ type: "done", conversation_id: "conversation-1" });

  assert.equal(controller.isClosed(), true);
  assert.deepEqual(
    sent.map((item) => item.event),
    [
      {
        type: "token",
        text: "before",
        conversation_id: "conversation-1",
      },
      {
        type: "token",
        text: "",
        title: "Final title",
        titleFinal: true,
        conversation_id: "conversation-1",
      },
    ]
  );
});

test("gateway bridge checkpoint emits compaction summary payload", () => {
  const { controller, sent } = createController();
  const state = {
    activeSegmentIndex: 1,
    segments: [
      {
        segmentIndex: 0,
        segmentId: "segment-0",
        messages: [],
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        segmentIndex: 1,
        segmentId: "segment-1",
        messages: [],
        messageCount: 0,
        createdAt: 2,
        updatedAt: 2,
        summary: {
          role: "summary",
          id: "summary-1",
          timestamp: 3,
          content: "Compacted facts",
          summaryMeta: {
            format: "plain-text-v1",
            strategy: "cumulative-checkpoint",
            coversThroughMessageId: "message-9",
            coveredMessageCount: 9,
            generatedBy: {
              providerId: "codex",
              model: "gpt-test",
              promptVersion: "summary-v2",
            },
          },
        },
      },
    ],
    historyRenderItems: [],
    meta: {
      schemaVersion: 3,
      activeSegmentIndex: 1,
      totalSegmentCount: 2,
      totalMessageCount: 0,
    },
  };

  controller.queueCheckpoint(state);

  assert.deepEqual(sent, [
    {
      requestId: "request-1",
      event: {
        type: "token",
        text: "Compacted facts",
        provider: "liveagent",
        model: "summary",
        api: "liveagent-compaction",
        conversation_id: "conversation-1",
        checkpoint: {
          summaryId: "summary-1",
          segmentIndex: 1,
          coveredMessageCount: 9,
          coversThroughMessageId: "message-9",
          timestamp: 3,
          generatedBy: {
            providerId: "codex",
            model: "gpt-test",
            promptVersion: "summary-v2",
          },
        },
      },
    },
  ]);
});

test("gateway bridge user message carries the edit-resend truncation base", () => {
  const { controller, sent } = createController();

  controller.queueUserMessage("edited prompt", [], {
    baseMessageRef: {
      segmentIndex: 0,
      messageIndex: 2,
      segmentId: "segment-1",
      messageId: "message-2",
      role: "user",
      contentHash: "hash-2",
    },
  });

  assert.deepEqual(sent, [
    {
      requestId: "request-1",
      event: {
        type: "user_message",
        message: "edited prompt",
        uploaded_files: [],
        conversation_id: "conversation-1",
        base_message_ref: {
          segment_index: 0,
          message_index: 2,
          segment_id: "segment-1",
          message_id: "message-2",
          role: "user",
          content_hash: "hash-2",
        },
        reason: "edit_resend",
      },
    },
  ]);
});

test("gateway bridge user message omits the truncation base for plain sends", () => {
  const { controller, sent } = createController();

  controller.queueUserMessage("plain prompt");

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].event, {
    type: "user_message",
    message: "plain prompt",
    uploaded_files: [],
    conversation_id: "conversation-1",
  });
  assert.equal("base_message_ref" in sent[0].event, false);
  assert.equal("reason" in sent[0].event, false);
});

test("gateway bridge redacts a local portfolio request before tool execution", () => {
  const { controller, sent } = createController();

  controller.activateStockPortfolioPrivacy();
  controller.queueUserMessage(
    "分析我的持仓：600519 100 股，组合 portfolio-secret-1",
    [
      {
        relativePath: "uploads/portfolio-secret.csv",
        absolutePath: "C:/private/portfolio-secret.csv",
        fileName: "portfolio-secret.csv",
        kind: "spreadsheet",
        sizeBytes: 1024,
      },
    ],
    {
      baseMessageRef: {
        segmentIndex: 0,
        messageIndex: 0,
        segmentId: "segment-private-1",
        messageId: "message-private-1",
        role: "user",
        contentHash: "fnv1a32:deadbeef",
      },
    }
  );
  controller.queueToken("家庭资产总值 150000");

  const serialized = JSON.stringify(sent);
  assert.doesNotMatch(
    serialized,
    /600519|100 股|portfolio-secret|C:\/private|家庭资产总值|150000|deadbeef/
  );
  assert.deepEqual(sent[0].event, {
    type: "user_message",
    message:
      "Calen kept this local portfolio result on the desktop and did not send asset data to Gateway.",
    uploaded_files: [],
    conversation_id: "conversation-1",
    base_message_ref: {
      segment_index: 0,
      message_index: 0,
      segment_id: "segment-private-1",
      message_id: "message-private-1",
      role: "user",
      content_hash: "local-only-redacted",
    },
    reason: "edit_resend",
    localOnly: true,
    redacted: true,
  });
  assert.equal(sent[1].event.localOnly, true);
  assert.equal(sent[1].event.redacted, true);
});

test("gateway bridge error can resolve the latest conversation id", () => {
  const { controller, sent } = createController({
    conversationId: "conversation-initial",
    resolveErrorConversationId: () => "conversation-current",
  });

  controller.emitError("failed");
  controller.emitError("failed again", "conversation-explicit");

  assert.deepEqual(
    sent.map((item) => item.event),
    [
      {
        type: "error",
        message: "failed",
        conversation_id: "conversation-current",
      },
      {
        type: "error",
        message: "failed again",
        conversation_id: "conversation-explicit",
      },
    ]
  );
});
