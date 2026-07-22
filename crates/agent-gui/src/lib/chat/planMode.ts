import type { Tool } from "@earendil-works/pi-ai";

import type { MentionComposerDraft } from "../../components/chat/MentionComposer";
import { AGENT_TOOL_NAME, SEND_MESSAGE_TOOL_NAME } from "../subagents/types";

export type PlanSlashCommand = "plan" | "execute" | "exit-plan";

export type PlanSlashParseResult = {
  command: PlanSlashCommand;
  /** Original command token without leading slash (lowercased). */
  rawCommand: string;
  remainder: string;
};

/** Shown in the `/` composer popup alongside Skills. */
export type PlanSlashMenuItem = {
  command: PlanSlashCommand;
  /** Token after `/` (e.g. `plan`, `exit-plan`). */
  token: string;
  label: string;
  descriptionZh: string;
  descriptionEn: string;
};

/** Only `/plan` appears in the `/` palette. Exit / approve live on the plan banner. */
export const PLAN_SLASH_MENU_ITEMS: readonly PlanSlashMenuItem[] = [
  {
    command: "plan",
    token: "plan",
    label: "plan",
    descriptionZh: "进入规划模式（只读探索）",
    descriptionEn: "Enter plan mode (read-only)",
  },
];

export function formatPlanCommandToken(command: PlanSlashCommand) {
  return `/${command}`;
}

/** Filter plan slash items for the `/` autocomplete query (text after `/`). */
export function listPlanSlashMenuItems(query: string): PlanSlashMenuItem[] {
  const q = query.trim().toLowerCase().replace(/^\//, "");
  if (!q) return [...PLAN_SLASH_MENU_ITEMS];
  return PLAN_SLASH_MENU_ITEMS.filter(
    (item) => item.token.startsWith(q) || item.label.startsWith(q),
  );
}

export type ToolMetadataLike = {
  isReadOnly?: boolean;
  groupId?: string;
  kind?: string;
};

export type PlanModeToolSelection = {
  tools: Tool[];
  allowedNames: Set<string>;
};

/** Default user message when `/execute` is sent with no remainder. */
export const PLAN_EXECUTE_DEFAULT_PROMPT =
  "方案已批准。请退出规划约束，使用完整工具按已确认方案开始实现。实现前如有关键假设冲突请先说明。";

/**
 * Plan-mode system instructions. Appended only while the session-level plan
 * flag is on. Tool availability is the hard gate; this text steers behavior.
 */
/** Marker used to keep plan-mode system prompt injection idempotent. */
export const PLAN_MODE_PROMPT_MARKER = "# Plan Mode (read-only)";

export const PLAN_MODE_SYSTEM_PROMPT = [
  PLAN_MODE_PROMPT_MARKER,
  "",
  "You are in **Plan Mode**. Design an implementation plan; do **not** modify the system.",
  "",
  "## Hard constraints",
  "- Only read-only tools are available (plus TodoWrite for the checklist).",
  "- Do **not** write/edit/delete files, run mutating shell commands, change settings, install packages, commit, or spawn write-capable subagents.",
  "- If a needed step requires mutation, describe it in the plan instead of attempting it.",
  "",
  "## How to work",
  "1. Explore the codebase with Read / Glob / Grep / List (and other read-only tools) until the design is grounded.",
  "2. Prefer questions when requirements or architecture choices are genuinely ambiguous.",
  "3. Use TodoWrite for multi-step planning checklists when helpful.",
  "4. End with a concrete plan the user can approve.",
  "",
  "## Plan output shape",
  "- Goal and success criteria",
  "- Key files / modules to touch (paths)",
  "- Step-by-step implementation order",
  "- Risks, trade-offs, and open questions",
  "- How to verify (tests / commands / manual checks)",
  "",
  "When the plan is ready, ask the user to approve. They can send `/execute` (or use **批准执行**) to leave Plan Mode and implement.",
].join("\n");

const PLAN_COMMAND_ALIASES: Record<string, PlanSlashCommand> = {
  plan: "plan",
  execute: "execute",
  "exit-plan": "exit-plan",
  exit_plan: "exit-plan",
  unplan: "exit-plan",
  "plan-exit": "exit-plan",
};

/**
 * True when `token` (text after `/`, no spaces) is a reserved Plan Mode slash
 * command. Used by the composer so skill autocomplete does not swallow `/plan`.
 */
export function isReservedPlanSlashToken(token: string): boolean {
  const key = token.trim().toLowerCase();
  return Boolean(key) && Object.hasOwn(PLAN_COMMAND_ALIASES, key);
}

/**
 * Parse a leading plan slash command from free text.
 * Returns null when the text is not a supported plan command.
 */
export function parsePlanSlashCommand(text: string): PlanSlashParseResult | null {
  const source = typeof text === "string" ? text.replace(/^﻿/, "") : "";
  const match = source.match(/^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+|$)([\s\S]*)$/);
  if (!match) return null;
  const rawCommand = (match[1] ?? "").toLowerCase();
  const command = PLAN_COMMAND_ALIASES[rawCommand];
  if (!command) return null;
  return {
    command,
    rawCommand,
    remainder: (match[2] ?? "").replace(/^\s+/, ""),
  };
}

export function emptyComposerDraft(): MentionComposerDraft {
  return {
    segments: [],
    text: "",
    textWithoutLargePastes: "",
    largePastes: [],
    skillMentions: [],
    commitMentions: [],
    gitFileMentions: [],
    isEmpty: true,
  };
}

export function composerDraftFromText(text: string): MentionComposerDraft {
  const normalized = typeof text === "string" ? text : "";
  if (!normalized.trim()) return emptyComposerDraft();
  return {
    segments: [{ type: "text", text: normalized }],
    text: normalized,
    textWithoutLargePastes: normalized,
    largePastes: [],
    skillMentions: [],
    commitMentions: [],
    gitFileMentions: [],
    isEmpty: false,
  };
}

function draftFromSegments(segments: MentionComposerDraft["segments"]): MentionComposerDraft {
  const textParts: string[] = [];
  const skillMentions: MentionComposerDraft["skillMentions"] = [];
  const commitMentions: MentionComposerDraft["commitMentions"] = [];
  const gitFileMentions: MentionComposerDraft["gitFileMentions"] = [];
  const largePastes: MentionComposerDraft["largePastes"] = [];

  for (const segment of segments) {
    switch (segment.type) {
      case "text":
        textParts.push(segment.text);
        break;
      case "planCommand":
        textParts.push(formatPlanCommandToken(segment.command));
        break;
      case "skillMention":
        skillMentions.push(segment.skill);
        textParts.push(`/${segment.skill.name}`);
        break;
      case "fileMention":
        textParts.push(segment.reference.path);
        break;
      case "commitMention":
        commitMentions.push(segment.commit);
        textParts.push(segment.commit.subject || segment.commit.shortSha || segment.commit.sha);
        break;
      case "gitFileMention":
        gitFileMentions.push(segment.file);
        textParts.push(segment.file.path);
        break;
      case "largePaste":
        largePastes.push(segment.paste);
        textParts.push(segment.paste.label);
        break;
    }
  }

  const text = textParts.join("");
  return {
    segments,
    text,
    textWithoutLargePastes: text,
    largePastes,
    skillMentions,
    commitMentions,
    gitFileMentions,
    isEmpty: text.trim() === "" && largePastes.length === 0,
  };
}

/**
 * Strip a leading `/plan` / `/execute` / `/exit-plan` token from a draft.
 * Supports colored plan-command chips as well as plain text.
 */
export function stripLeadingPlanSlashCommand(
  draft: MentionComposerDraft,
  parsed: PlanSlashParseResult,
): MentionComposerDraft {
  // Colored chip form: first meaningful segment is planCommand.
  let start = 0;
  while (
    start < draft.segments.length &&
    draft.segments[start]?.type === "text" &&
    !(draft.segments[start] as { text: string }).text.trim()
  ) {
    start += 1;
  }
  const first = draft.segments[start];
  if (first?.type === "planCommand" && first.command === parsed.command) {
    const rest = draft.segments.slice(start + 1).map((segment, index) => {
      if (index === 0 && segment.type === "text") {
        return { ...segment, text: segment.text.replace(/^\s+/, "") };
      }
      return segment;
    });
    return draftFromSegments(rest);
  }

  const re = new RegExp(`^/${escapeRegExp(parsed.rawCommand)}\\b\\s*`, "i");
  if (draft.segments.length === 1 && draft.segments[0]?.type === "text") {
    const nextText = draft.segments[0].text.replace(re, "");
    return composerDraftFromText(nextText);
  }
  if (draft.segments.every((segment) => segment.type === "text")) {
    const joined = draft.segments
      .map((segment) => ("text" in segment ? segment.text : ""))
      .join("");
    if (re.test(joined)) {
      return composerDraftFromText(joined.replace(re, ""));
    }
  }
  if (re.test(draft.text)) {
    return composerDraftFromText(draft.text.replace(re, ""));
  }
  return composerDraftFromText(parsed.remainder);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstMeaningfulSegment(draft: MentionComposerDraft) {
  for (const segment of draft.segments) {
    if (segment.type === "text" && !segment.text.trim()) continue;
    return segment;
  }
  return null;
}

export type PlanComposerResolution =
  | {
      kind: "normal";
      /** Session plan flag after this input (unchanged for normal messages). */
      sessionPlanMode: boolean;
      /** Plan mode for the model turn that will run. */
      turnPlanMode: boolean;
      draft: MentionComposerDraft;
    }
  | {
      kind: "command_only";
      sessionPlanMode: boolean;
      notice: "entered" | "exited" | "already_on" | "already_off";
    }
  | {
      kind: "send";
      sessionPlanMode: boolean;
      turnPlanMode: boolean;
      draft: MentionComposerDraft;
      notice?: "entered" | "exited";
    };

/**
 * Resolve composer input against session plan mode.
 * Leading skill chips (`/skill-name` mentions) are never treated as plan commands.
 * Leading plan-command chips (`/plan` orange chip) are treated like typed `/plan`.
 */
export function resolvePlanComposerInput(params: {
  draft: MentionComposerDraft;
  sessionPlanMode: boolean;
  hasUploads?: boolean;
}): PlanComposerResolution {
  const { draft, sessionPlanMode } = params;
  const first = firstMeaningfulSegment(draft);
  if (first?.type === "skillMention") {
    return {
      kind: "normal",
      sessionPlanMode,
      turnPlanMode: sessionPlanMode,
      draft,
    };
  }

  // Prefer the structured plan chip when present (more reliable than text parse).
  let parsed: PlanSlashParseResult | null = null;
  if (first?.type === "planCommand") {
    parsed = {
      command: first.command,
      rawCommand: first.command,
      remainder: "",
    };
  } else {
    parsed = parsePlanSlashCommand(draft.text);
  }
  if (!parsed) {
    return {
      kind: "normal",
      sessionPlanMode,
      turnPlanMode: sessionPlanMode,
      draft,
    };
  }

  const remainderDraft = stripLeadingPlanSlashCommand(draft, parsed);
  const hasRemainder = !remainderDraft.isEmpty && Boolean(remainderDraft.text.trim());
  const hasUploads = params.hasUploads === true;

  if (parsed.command === "plan") {
    if (!hasRemainder && !hasUploads) {
      return {
        kind: "command_only",
        sessionPlanMode: true,
        notice: sessionPlanMode ? "already_on" : "entered",
      };
    }
    return {
      kind: "send",
      sessionPlanMode: true,
      turnPlanMode: true,
      draft: remainderDraft,
      notice: sessionPlanMode ? undefined : "entered",
    };
  }

  if (parsed.command === "execute") {
    const executeDraft = hasRemainder
      ? remainderDraft
      : composerDraftFromText(PLAN_EXECUTE_DEFAULT_PROMPT);
    return {
      kind: "send",
      sessionPlanMode: false,
      turnPlanMode: false,
      draft: executeDraft,
      notice: sessionPlanMode ? "exited" : undefined,
    };
  }

  // exit-plan / unplan
  if (!hasRemainder && !hasUploads) {
    return {
      kind: "command_only",
      sessionPlanMode: false,
      notice: sessionPlanMode ? "exited" : "already_off",
    };
  }
  return {
    kind: "send",
    sessionPlanMode: false,
    turnPlanMode: false,
    draft: remainderDraft,
    notice: sessionPlanMode ? "exited" : undefined,
  };
}

/**
 * Plan-mode tool allowlist: metadata.isReadOnly tools + TodoWrite.
 * Agent / SendMessage are never exposed (even if marked read-only later).
 */
export function selectPlanModeTools(params: {
  tools: Tool[];
  metadataByName: Map<string, ToolMetadataLike>;
}): PlanModeToolSelection {
  const tools = params.tools.filter((tool) => {
    if (tool.name === AGENT_TOOL_NAME || tool.name === SEND_MESSAGE_TOOL_NAME) {
      return false;
    }
    if (tool.name === "TodoWrite") return true;
    const metadata = params.metadataByName.get(tool.name);
    return metadata?.isReadOnly === true;
  });
  return {
    tools,
    allowedNames: new Set(tools.map((tool) => tool.name)),
  };
}

export function isPlanModeToolAllowed(
  toolName: string,
  allowedNames: ReadonlySet<string>,
): boolean {
  const name = toolName.trim();
  if (!name) return false;
  if (allowedNames.has(name)) return true;
  const lower = name.toLowerCase();
  for (const allowed of allowedNames) {
    if (allowed.toLowerCase() === lower) return true;
  }
  return false;
}

export function buildPlanModeToolDeniedResult(toolName: string) {
  return [
    `Plan mode is active: \`${toolName}\` is not available.`,
    "Only read-only tools and TodoWrite can run while planning.",
    "Ask the user to approve the plan (`/execute` or 批准执行) before making changes.",
  ].join(" ");
}
