import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const validateModule = loader.loadModule("src/lib/chat/compaction/validate.ts");

const {
  validateCompactionSummary,
  parseCompactionSummaryXml,
  buildVerificationSignals,
} = validateModule;

function payloadWith(messages = [], nextUserMessage) {
  return {
    compaction_reason: { trigger: "t", context_tokens: 1, threshold: 1 },
    system_prompt: "p",
    previous_summary: null,
    active_segment_messages: messages,
    next_user_message: nextUserMessage,
  };
}

const EMPTY_PAYLOAD = payloadWith();

function summaryXml({
  task = "Fix the bug",
  artifacts = "- [file] src/app.ts | modified",
} = {}) {
  return `<summary>
<task>${task}</task>
<state>Bug located in parser, fix applied ${"detail ".repeat(60)}</state>
<artifacts>
${artifacts}
</artifacts>
<next_steps>
1. run the tests
</next_steps>
</summary>`;
}

test("a well-formed summary validates and is formatted into markdown sections", () => {
  const { summaryText } = validateCompactionSummary(
    summaryXml(),
    10_000,
    EMPTY_PAYLOAD
  );
  assert.ok(summaryText.startsWith("## Task\nFix the bug"));
  assert.ok(summaryText.includes("## Current State"));
  assert.ok(summaryText.includes("## Artifacts"));
  assert.ok(summaryText.includes("## Next Steps"));
});

test("markdown fences are stripped before parsing", () => {
  const fenced = "```xml\n" + summaryXml() + "\n```";
  const parsed = parseCompactionSummaryXml(fenced);
  assert.equal(parsed.task, "Fix the bug");
});

test("missing required tags fail validation", () => {
  assert.throws(
    () =>
      validateCompactionSummary(
        "<summary><task>t</task></summary>",
        10_000,
        EMPTY_PAYLOAD
      ),
    /missing <state>.*missing <next_steps>.*missing <artifacts>/
  );
});

test("artifact lines must follow the [kind] ref | status format", () => {
  assert.throws(
    () =>
      validateCompactionSummary(
        summaryXml({ artifacts: "- just some prose without the format" }),
        10_000,
        EMPTY_PAYLOAD
      ),
    /no valid artifact lines/
  );

  // 混有合法行时放行（宽收严教）。
  validateCompactionSummary(
    summaryXml({ artifacts: "- odd line\n- [file] src/app.ts | modified" }),
    10_000,
    EMPTY_PAYLOAD
  );
});

test("a large source must not produce a trivially short summary", () => {
  const short = `<summary><task>t</task><state>s</state><artifacts>
- [file] a.ts | read
</artifacts><next_steps>1. x</next_steps></summary>`;
  assert.throws(
    () => validateCompactionSummary(short, 10_000, EMPTY_PAYLOAD),
    /summary too short/
  );
  // 小会话不受最短长度约束。
  validateCompactionSummary(short, 200, EMPTY_PAYLOAD);
});

test("verification signals are extracted from recent payload messages", () => {
  const payload = payloadWith(
    [
      {
        index: 0,
        role: "toolResult",
        timestamp: null,
        toolName: "Bash",
        toolCallId: "t",
        isError: false,
        content: "compiled crates/agent-gui/src/lib/chat/compaction/policy.ts",
      },
    ],
    "please run cargo build --release next"
  );
  const signals = buildVerificationSignals(payload);
  assert.ok(signals.some((signal) => signal.includes("cargo build --release")));
  assert.ok(
    signals.some((signal) =>
      signal.includes("crates/agent-gui/src/lib/chat/compaction/policy.ts")
    )
  );
});

test("summaries that drop every recent technical reference fail the verification pass", () => {
  const payload = payloadWith([
    {
      index: 0,
      role: "user",
      timestamp: null,
      content: "please edit src/lib/chat/history/chatHistory.ts",
    },
  ]);

  assert.throws(
    () => validateCompactionSummary(summaryXml(), 10_000, payload),
    /verification pass missing recent technical refs/
  );

  validateCompactionSummary(
    summaryXml({
      artifacts: "- [file] src/lib/chat/history/chatHistory.ts | modified",
    }),
    10_000,
    payload
  );
});

test("the verification error names the refs the summary must quote", () => {
  const payload = payloadWith([
    {
      index: 0,
      role: "user",
      timestamp: null,
      content: "please edit src/lib/chat/history/chatHistory.ts",
    },
  ]);
  assert.throws(
    () => validateCompactionSummary(summaryXml(), 10_000, payload),
    /src\/lib\/chat\/history\/chatHistory\.ts/
  );
});

test("ref matching normalizes separators, case, and trailing slashes", () => {
  // 近期消息里的路径是 `D:\NDM\`（带尾分隔符），摘要写成 `D:\NDM` 也算保留。
  const payload = payloadWith([
    {
      index: 0,
      role: "user",
      timestamp: null,
      content: String.raw`clean up D:\NDM\ duplicates`,
    },
  ]);
  validateCompactionSummary(
    summaryXml({ artifacts: String.raw`- [file] D:\NDM | observed` }),
    10_000,
    payload
  );
});

test("a bare basename counts as preserving a path ref", () => {
  const payload = payloadWith([
    {
      index: 0,
      role: "user",
      timestamp: null,
      content: "please edit src/lib/chat/history/chatHistory.ts",
    },
  ]);
  validateCompactionSummary(
    summaryXml({ artifacts: "- [file] chatHistory.ts | modified" }),
    10_000,
    payload
  );
});

test("the command head counts as preserving a command ref", () => {
  const payload = payloadWith(
    [],
    "run cargo build --release --target x86_64-pc-windows-msvc --features full"
  );
  validateCompactionSummary(
    summaryXml({ artifacts: "- [command] cargo build | passed" }),
    10_000,
    payload
  );
});

test("lenient mode appends missing refs to breadcrumbs instead of failing", () => {
  const payload = payloadWith([
    {
      index: 0,
      role: "user",
      timestamp: null,
      content: "please edit src/lib/chat/history/chatHistory.ts",
    },
  ]);

  const { summaryText } = validateCompactionSummary(
    summaryXml(),
    10_000,
    payload,
    {
      mode: "lenient",
    }
  );
  assert.ok(summaryText.includes("## Breadcrumbs"));
  assert.ok(summaryText.includes("src/lib/chat/history/chatHistory.ts"));
});

test("lenient mode still fails on structural errors", () => {
  assert.throws(
    () =>
      validateCompactionSummary(
        "<summary><task>t</task></summary>",
        10_000,
        EMPTY_PAYLOAD,
        {
          mode: "lenient",
        }
      ),
    /missing <state>/
  );
});
