const LEGACY_DEFAULT_OFFLINE_TRANSLATION_MODEL_ID = "qwen3-0.6b-q8-0";

export const DEFAULT_OFFLINE_TRANSLATION_MODEL_ID = "hy-mt1.5-1.8b-q4-k-m";
export const TRANSLATION_MODEL_CATALOG_VERSION = 2;
export const TRANSLATION_PROMPT_VERSION = "skills-store-v3";

export type TranslationMode = "remote-only" | "offline-preferred" | "offline-only";
export type TranslationBackend = "offline" | "remote";

export type TranslationPreferences = {
  mode: TranslationMode;
  localModelId: string;
  catalogVersion: number;
};

export type TranslationErrorCode =
  | "invalidArgument"
  | "notFound"
  | "alreadyRunning"
  | "notInstalled"
  | "downloadFailed"
  | "integrityMismatch"
  | "runtimeUnavailable"
  | "runtimeFailed"
  | "translationFailed"
  | "io"
  | "cancelled"
  | "aborted"
  | "unknown";

export type TranslationErrorLike = {
  code?: TranslationErrorCode | string;
  message?: string;
};

const TRANSLATION_MODES = new Set<TranslationMode>([
  "remote-only",
  "offline-preferred",
  "offline-only",
]);

const KNOWN_ERROR_CODES = new Set<TranslationErrorCode>([
  "invalidArgument",
  "notFound",
  "alreadyRunning",
  "notInstalled",
  "downloadFailed",
  "integrityMismatch",
  "runtimeUnavailable",
  "runtimeFailed",
  "translationFailed",
  "io",
  "cancelled",
  "aborted",
  "unknown",
]);

const RECOVERABLE_OFFLINE_ERROR_CODES = new Set<TranslationErrorCode>([
  "notFound",
  "notInstalled",
  "runtimeUnavailable",
  "runtimeFailed",
  "translationFailed",
  "io",
]);

export function normalizeTranslationPreferences(input: unknown): TranslationPreferences {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = TRANSLATION_MODES.has(obj.mode as TranslationMode)
    ? (obj.mode as TranslationMode)
    : "remote-only";
  const configuredModelId = typeof obj.localModelId === "string" ? obj.localModelId.trim() : "";
  const localModelId =
    obj.catalogVersion === undefined &&
    configuredModelId === LEGACY_DEFAULT_OFFLINE_TRANSLATION_MODEL_ID
      ? DEFAULT_OFFLINE_TRANSLATION_MODEL_ID
      : configuredModelId || DEFAULT_OFFLINE_TRANSLATION_MODEL_ID;
  return {
    mode,
    localModelId,
    catalogVersion: TRANSLATION_MODEL_CATALOG_VERSION,
  };
}

export function translationBackendOrder(mode: TranslationMode): readonly TranslationBackend[] {
  if (mode === "offline-only") return ["offline"];
  if (mode === "offline-preferred") return ["offline", "remote"];
  return ["remote"];
}

function readTranslationErrorCode(error: unknown): TranslationErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as TranslationErrorLike).code;
    if (typeof code === "string" && KNOWN_ERROR_CODES.has(code as TranslationErrorCode)) {
      return code as TranslationErrorCode;
    }
  }
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/abort|cancel/i.test(message)) return "aborted";
  for (const code of KNOWN_ERROR_CODES) {
    if (code !== "unknown" && message.includes(code)) return code;
  }
  return "unknown";
}

export function isRecoverableOfflineTranslationError(error: unknown): boolean {
  return RECOVERABLE_OFFLINE_ERROR_CODES.has(readTranslationErrorCode(error));
}

export function translationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as TranslationErrorLike).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const message = String(error ?? "").trim();
  return message || "Translation failed";
}

export function createTranslationFingerprint(input: {
  purpose: string;
  targetLocale: string;
  text: string;
  mode: TranslationMode;
  localModelId: string;
  remoteModelId: string;
}): string {
  return JSON.stringify([
    TRANSLATION_PROMPT_VERSION,
    input.purpose,
    input.targetLocale,
    input.text,
    input.mode,
    input.localModelId,
    input.remoteModelId,
  ]);
}
