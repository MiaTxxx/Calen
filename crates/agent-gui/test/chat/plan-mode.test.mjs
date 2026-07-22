import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const planMode = loader.loadModule("src/lib/chat/planMode.ts");

function draft(text, segments) {
  const segs = segments ?? [{ type: "text", text }];
  return {
    segments: segs,
    text,
    textWithoutLargePastes: text,
    largePastes: [],
    skillMentions: [],
    commitMentions: [],
    gitFileMentions: [],
    isEmpty: text.trim() === "",
  };
}

test("parsePlanSlashCommand recognizes plan / execute / exit aliases", () => {
  assert.equal(planMode.parsePlanSlashCommand("hello"), null);
  assert.equal(planMode.parsePlanSlashCommand("/plan").command, "plan");
  assert.equal(
    planMode.parsePlanSlashCommand("/plan add auth").remainder,
    "add auth"
  );
  assert.equal(planMode.parsePlanSlashCommand("/execute").command, "execute");
  assert.equal(
    planMode.parsePlanSlashCommand("/exit-plan").command,
    "exit-plan"
  );
  assert.equal(planMode.parsePlanSlashCommand("/unplan").command, "exit-plan");
  assert.equal(planMode.parsePlanSlashCommand("/skills-creator"), null);
  assert.equal(planMode.isReservedPlanSlashToken("plan"), true);
  assert.equal(planMode.isReservedPlanSlashToken("execute"), true);
  assert.equal(planMode.isReservedPlanSlashToken("skills-creator"), false);
  assert.equal(planMode.isReservedPlanSlashToken("pla"), false);
});

test("resolvePlanComposerInput toggles session flag and strips command", () => {
  const enterOnly = planMode.resolvePlanComposerInput({
    draft: draft("/plan"),
    sessionPlanMode: false,
  });
  assert.equal(enterOnly.kind, "command_only");
  assert.equal(enterOnly.sessionPlanMode, true);
  assert.equal(enterOnly.notice, "entered");

  const planWithTask = planMode.resolvePlanComposerInput({
    draft: draft("/plan design the feature"),
    sessionPlanMode: false,
  });
  assert.equal(planWithTask.kind, "send");
  assert.equal(planWithTask.sessionPlanMode, true);
  assert.equal(planWithTask.turnPlanMode, true);
  assert.equal(planWithTask.draft.text, "design the feature");
  assert.equal(planWithTask.notice, "entered");

  const executeEmpty = planMode.resolvePlanComposerInput({
    draft: draft("/execute"),
    sessionPlanMode: true,
  });
  assert.equal(executeEmpty.kind, "send");
  assert.equal(executeEmpty.sessionPlanMode, false);
  assert.equal(executeEmpty.turnPlanMode, false);
  assert.equal(executeEmpty.draft.text, planMode.PLAN_EXECUTE_DEFAULT_PROMPT);
  assert.equal(executeEmpty.notice, "exited");

  const normalWhilePlanning = planMode.resolvePlanComposerInput({
    draft: draft("what about auth?"),
    sessionPlanMode: true,
  });
  assert.equal(normalWhilePlanning.kind, "normal");
  assert.equal(normalWhilePlanning.turnPlanMode, true);

  const skillMention = planMode.resolvePlanComposerInput({
    draft: draft("/skills-creator", [
      {
        type: "skillMention",
        skill: {
          name: "skills-creator",
          description: "x",
          skillFile: "SKILL.md",
          baseDir: "skills-creator",
        },
      },
    ]),
    sessionPlanMode: false,
  });
  assert.equal(skillMention.kind, "normal");
});

test("selectPlanModeTools keeps read-only tools and TodoWrite, drops Agent", () => {
  const tools = [
    { name: "Read" },
    { name: "Write" },
    { name: "TodoWrite" },
    { name: "Agent" },
    { name: "SendMessage" },
    { name: "mcp_foo_bar" },
  ];
  const metadataByName = new Map([
    ["Read", { isReadOnly: true, groupId: "fs" }],
    ["Write", { isReadOnly: false, groupId: "fs" }],
    ["TodoWrite", { isReadOnly: false, groupId: "system" }],
    ["Agent", { isReadOnly: false, groupId: "subagent" }],
    ["SendMessage", { isReadOnly: false, groupId: "subagent" }],
    // Dynamic MCP tools are not trusted as read-only by default.
    ["mcp_foo_bar", { isReadOnly: false, groupId: "mcp", kind: "mcp" }],
  ]);
  const selected = planMode.selectPlanModeTools({ tools, metadataByName });
  assert.deepEqual(
    selected.tools.map((tool) => tool.name).sort(),
    ["Read", "TodoWrite"].sort()
  );
  assert.equal(
    planMode.isPlanModeToolAllowed("Write", selected.allowedNames),
    false
  );
  assert.equal(
    planMode.isPlanModeToolAllowed("Read", selected.allowedNames),
    true
  );
  assert.match(
    planMode.buildPlanModeToolDeniedResult("Write"),
    /Plan mode is active/
  );
});

test("plan command chip enters plan mode like typed /plan", () => {
  const chipOnly = planMode.resolvePlanComposerInput({
    draft: {
      segments: [{ type: "planCommand", command: "plan" }],
      text: "/plan",
      textWithoutLargePastes: "/plan",
      largePastes: [],
      skillMentions: [],
      commitMentions: [],
      gitFileMentions: [],
      isEmpty: false,
    },
    sessionPlanMode: false,
  });
  assert.equal(chipOnly.kind, "command_only");
  assert.equal(chipOnly.sessionPlanMode, true);
  assert.equal(chipOnly.notice, "entered");

  const chipWithTask = planMode.resolvePlanComposerInput({
    draft: {
      segments: [
        { type: "planCommand", command: "plan" },
        { type: "text", text: " design auth" },
      ],
      text: "/plan design auth",
      textWithoutLargePastes: "/plan design auth",
      largePastes: [],
      skillMentions: [],
      commitMentions: [],
      gitFileMentions: [],
      isEmpty: false,
    },
    sessionPlanMode: false,
  });
  assert.equal(chipWithTask.kind, "send");
  assert.equal(chipWithTask.turnPlanMode, true);
  assert.equal(chipWithTask.draft.text.trim(), "design auth");
});

test("listPlanSlashMenuItems only exposes plan (exit/approve are banner actions)", () => {
  assert.deepEqual(
    planMode.listPlanSlashMenuItems("").map((item) => item.token),
    ["plan"]
  );
  assert.deepEqual(
    planMode.listPlanSlashMenuItems("pl").map((item) => item.token),
    ["plan"]
  );
  assert.deepEqual(
    planMode.listPlanSlashMenuItems("ex").map((item) => item.token),
    []
  );
});
