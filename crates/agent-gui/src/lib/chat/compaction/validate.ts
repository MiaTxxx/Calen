import type { CompactionPayload } from "./payload";

const MIN_SUMMARY_TOKENS = 80;

const SUMMARY_TAGS = [
  "task",
  "constraints",
  "state",
  "artifacts",
  "decisions",
  "dead_ends",
  "knowledge",
  "open_loops",
  "next_steps",
  "breadcrumbs",
] as const;

const REQUIRED_SUMMARY_TAGS: ReadonlyArray<(typeof SUMMARY_TAGS)[number]> = [
  "task",
  "state",
  "next_steps",
  "artifacts",
];

export type CompactionSummaryParsed = Record<(typeof SUMMARY_TAGS)[number], string>;

const ARTIFACT_LINE_RE = /^-\s*\[(\w+)]\s+(.+?)\s*\|\s*(\w+)/;

const COMMAND_SIGNAL_RE =
  /(?:^|[\s`])(pnpm|npm|yarn|bun|cargo|git|node|npx|uv|pytest|python|python3|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)\s+[^\n\r`]+/gi;
const POSIX_PATH_SIGNAL_RE =
  /(?:\/|\.{1,2}\/)[^\s"'`]+|(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?/g;
const WINDOWS_PATH_SIGNAL_RE =
  /(?:[A-Za-z]:\\[^\s"'`]+|\\\\[^\s"'`]+|(?:[A-Za-z0-9._-]+\\){1,}[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?)/g;

function extractTagContent(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export function parseCompactionSummaryXml(raw: string): CompactionSummaryParsed {
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const result = {} as CompactionSummaryParsed;
  for (const tag of SUMMARY_TAGS) {
    result[tag] = extractTagContent(cleaned, tag) ?? "";
  }
  return result;
}

export type VerificationSignal = {
  // 展示用（错误信息 / repair 提示 / breadcrumbs 追加），可能被截断。
  display: string;
  // 归一化匹配键：任意一个命中即视为该信号被摘要保留。
  matchKeys: string[];
};

// 匹配前的归一化：大小写、路径分隔符、空白都不应成为“摘要丢了技术引用”
// 的判定依据——摘要把 D:\NDM\ 写成 D:\NDM 或 d:/ndm 都算保留。
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\\/g, "/").replace(/\s+/g, " ").trim();
}

function buildMatchKeys(candidate: string): string[] {
  const keys: string[] = [];
  let full = normalizeForMatch(candidate);
  // 尾部的分隔符/标点是提取噪声（`D:\NDM\`、`policy.ts,`），不参与匹配。
  full = full.replace(/[/.,;:)\]}]+$/, "");
  if (full.length >= 4) keys.push(full);

  if (!full.includes(" ")) {
    // 路径类信号：末段（文件名/目录名）命中即可——摘要常写相对路径或裸文件名。
    const tail = full.split("/").filter(Boolean).pop() ?? "";
    if (tail.length >= 3 && tail !== full) keys.push(tail);
  } else {
    // 命令类信号：完整命令行几乎不会被逐字复述，命令头（前两个词）命中即可。
    const headTokens = full.split(" ").slice(0, 2).join(" ");
    if (headTokens.length >= 6 && headTokens !== full) keys.push(headTokens);
  }
  return keys;
}

function pushVerificationSignal(
  out: VerificationSignal[],
  seen: Set<string>,
  candidate: string,
  maxChars = 160,
) {
  const normalized = candidate.trim().replace(/\s+/g, " ");
  if (normalized.length < 4) return;
  if (!/[./_:\\-]/.test(normalized) && !/\s/.test(normalized)) return;

  const matchKeys = buildMatchKeys(normalized);
  if (matchKeys.length === 0) return;
  const key = matchKeys[0];
  if (seen.has(key)) return;
  seen.add(key);

  const display =
    normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3)}...` : normalized;
  out.push({ display, matchKeys });
}

function extractVerificationSignalsFromText(
  text: string,
  out: VerificationSignal[],
  seen: Set<string>,
) {
  if (!text.trim()) return;

  for (const match of text.matchAll(COMMAND_SIGNAL_RE)) {
    pushVerificationSignal(out, seen, match[0], 180);
    if (out.length >= 6) return;
  }

  for (const match of text.matchAll(POSIX_PATH_SIGNAL_RE)) {
    pushVerificationSignal(out, seen, match[0], 180);
    if (out.length >= 6) return;
  }

  for (const match of text.matchAll(WINDOWS_PATH_SIGNAL_RE)) {
    pushVerificationSignal(out, seen, match[0], 180);
    if (out.length >= 6) return;
  }
}

// 从 payload 的近期消息中抽取路径/命令等技术引用；摘要若一个都没保留，
// 视为幻觉性丢失，触发校验失败（self-repair 会带着具体缺失的引用重试）。
export function collectVerificationSignals(payload: CompactionPayload): VerificationSignal[] {
  const out: VerificationSignal[] = [];
  const seen = new Set<string>();
  const recentMessages = payload.active_segment_messages.slice(-6).reverse();

  if (typeof payload.next_user_message === "string") {
    extractVerificationSignalsFromText(payload.next_user_message, out, seen);
  }

  for (const message of recentMessages) {
    if ("content" in message && typeof message.content === "string") {
      extractVerificationSignalsFromText(message.content, out, seen);
    }
    if ("text" in message && typeof message.text === "string") {
      extractVerificationSignalsFromText(message.text, out, seen);
    }
    if ("details" in message && typeof message.details === "string") {
      extractVerificationSignalsFromText(message.details, out, seen);
    }
    if ("toolCalls" in message && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        if (typeof toolCall !== "string") continue;
        extractVerificationSignalsFromText(toolCall, out, seen);
        if (out.length >= 6) return out.slice(0, 6);
      }
    }
    if (out.length >= 6) break;
  }

  return out.slice(0, 6);
}

export function buildVerificationSignals(payload: CompactionPayload) {
  return collectVerificationSignals(payload).map((signal) => signal.display);
}

function collectSummarySearchCorpus(parsed: CompactionSummaryParsed) {
  const out: string[] = [];
  for (const tag of SUMMARY_TAGS) {
    const value = parsed[tag].trim();
    if (value) out.push(value.toLowerCase());
  }
  return out;
}

export function formatSummaryForContext(s: CompactionSummaryParsed): string {
  const sections: string[] = [`## Task\n${s.task}`];
  if (s.constraints) sections.push(`## Constraints\n${s.constraints}`);
  sections.push(`## Current State\n${s.state}`);
  if (s.artifacts) sections.push(`## Artifacts\n${s.artifacts}`);
  if (s.decisions) sections.push(`## Decisions\n${s.decisions}`);
  if (s.dead_ends) sections.push(`## Dead Ends\n${s.dead_ends}`);
  if (s.knowledge) sections.push(`## Key Knowledge\n${s.knowledge}`);
  if (s.open_loops) sections.push(`## Open Loops\n${s.open_loops}`);
  sections.push(`## Next Steps\n${s.next_steps}`);
  if (s.breadcrumbs) sections.push(`## Breadcrumbs\n${s.breadcrumbs}`);
  return sections.join("\n\n");
}

export type CompactionValidationOptions = {
  // lenient：self-repair 之后的最后一搏。此时若唯一的问题仍是"摘要没有
  // 逐字保留近期技术引用"，就把这些引用自动追加进 breadcrumbs 并放行——
  // 压缩整体失败（上下文继续膨胀）比摘要少几条引用的代价大得多。
  mode?: "strict" | "lenient";
};

export function validateCompactionSummary(
  raw: string,
  sourceTokens: number,
  payload: CompactionPayload,
  options?: CompactionValidationOptions,
) {
  const parsed = parseCompactionSummaryXml(raw);
  const errors: string[] = [];

  for (const tag of REQUIRED_SUMMARY_TAGS) {
    if (!parsed[tag]) errors.push(`missing <${tag}>`);
  }

  if (parsed.artifacts) {
    const artifactLines = parsed.artifacts.split("\n").filter((l) => l.trim().startsWith("-"));
    if (artifactLines.length === 0) {
      errors.push("no artifact entries found (expected bullet lines starting with -)");
    } else {
      const malformed = artifactLines.filter((l) => !ARTIFACT_LINE_RE.test(l.trim()));
      if (malformed.length === artifactLines.length) {
        errors.push("no valid artifact lines (expected: - [kind] ref | status)");
      }
    }
  }

  const totalChars = Object.values(parsed).join("").length;
  if (sourceTokens >= 400 && totalChars < MIN_SUMMARY_TOKENS * 4) {
    errors.push("summary too short");
  }

  const verificationSignals = collectVerificationSignals(payload);
  if (verificationSignals.length > 0) {
    const corpus = collectSummarySearchCorpus(parsed).map(normalizeForMatch);
    const matched = verificationSignals.some((signal) =>
      signal.matchKeys.some((key) => corpus.some((entry) => entry.includes(key))),
    );
    if (!matched) {
      if (options?.mode === "lenient" && errors.length === 0) {
        const appended = verificationSignals.map((signal) => `- ${signal.display}`).join("\n");
        parsed.breadcrumbs = parsed.breadcrumbs ? `${parsed.breadcrumbs}\n${appended}` : appended;
      } else {
        const expected = verificationSignals
          .slice(0, 3)
          .map((signal) => `"${signal.display}"`)
          .join(", ");
        errors.push(
          `verification pass missing recent technical refs — quote at least one of these verbatim (e.g. in <artifacts> or <breadcrumbs>): ${expected}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Compaction summary validation failed: ${errors.join(", ")}`);
  }

  return {
    summaryText: formatSummaryForContext(parsed),
  };
}
