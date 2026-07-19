import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";

/** Default attempts for pre-content provider/transport failures (1 initial + retries). */
export const DEFAULT_STREAM_RETRY_MAX_ATTEMPTS = 5;

const STREAM_RETRY_BASE_DELAY_MS = 750;
const STREAM_RETRY_MAX_DELAY_MS = 12_000;

export type StreamRetryConfig = {
  maxAttempts?: number;
  disabled?: boolean;
  /**
   * Optional status hook fired before each retry attempt starts sleeping.
   * Useful for "Reconnecting…" UI without changing the event stream contract.
   */
  onRetry?: (info: StreamRetryAttemptInfo) => void;
};

export type StreamRetryAttemptInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage?: string;
};

export type StreamRetryOptions = StreamRetryConfig & {
  signal?: AbortSignal;
};

type TerminalEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

const COMMITTING_EVENT_TYPES = new Set<AssistantMessageEvent["type"]>([
  "text_delta",
  "thinking_delta",
  "toolcall_start",
]);

/**
 * Extra transport/network patterns that some gateways surface without matching
 * pi-ai's built-in classifier verbatim. Keep these conservative — auth / quota
 * / validation failures must still fail fast.
 */
const EXTRA_RETRYABLE_ERROR_PATTERN =
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR_|ERR_NETWORK|network request failed|failed to fetch|fetch error|temporarily unavailable|bad gateway|gateway timeout|cloudflare|cf-ray|connection reset|broken pipe|tls handshake|ssl handshake|proxy error|upstream request timeout|stream closed|incomplete chunked|unexpected eof|eof while reading|read econnreset|write econnreset|client network socket disconnected|request timed? ?out|aborted due to timeout|response closed|server disconnected/i;

const NON_RETRYABLE_ERROR_PATTERN =
  /insufficient_quota|quota|out of budget|billing|invalid.?api.?key|unauthorized|authentication|permission.?denied|forbidden|401|403/i;

function isTerminalEvent(event: AssistantMessageEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "error";
}

function terminalMessage(event: TerminalEvent) {
  return event.type === "done" ? event.message : event.error;
}

function extractErrorMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as { errorMessage?: unknown; message?: unknown };
  if (typeof record.errorMessage === "string" && record.errorMessage.trim()) {
    return record.errorMessage.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  return undefined;
}

function summarizeRetryableError(message: unknown): string | undefined {
  const raw = extractErrorMessage(message);
  if (!raw) return undefined;
  const httpStatus = /(?:^|\D)(408|409|425|429|500|502|503|504)(?:\D|$)/.exec(raw)?.[1];
  if (httpStatus) return `HTTP ${httpStatus}`;
  if (/timed? ?out|ETIMEDOUT|timeout/i.test(raw)) return "request timeout";
  if (/ECONNRESET|connection reset|broken pipe|unexpected eof|stream closed/i.test(raw)) {
    return "connection interrupted";
  }
  if (/failed to fetch|network request failed|ERR_NETWORK|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return "network unavailable";
  }
  return "temporary provider error";
}

/**
 * Whether a failed assistant turn looks transient enough to restart before any
 * content has been committed. Layers pi-ai's classifier with a small local set
 * of transport phrases that frequently appear from reverse proxies / raw fetch.
 */
export function isTransientStreamError(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const record = message as { stopReason?: unknown; errorMessage?: unknown };
  if (record.stopReason !== "error") return false;
  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage.trim() : "";
  if (!errorMessage) return false;
  // Hard fail-fast before the generic classifier: mixed messages such as
  // "429 RESOURCE_EXHAUSTED: exceeded current quota" must never reconnect.
  if (NON_RETRYABLE_ERROR_PATTERN.test(errorMessage)) return false;
  if (isRetryableAssistantError(message as AssistantMessage)) return true;
  return EXTRA_RETRYABLE_ERROR_PATTERN.test(errorMessage);
}

/** Full-jitter exponential backoff (AWS-style): uniform(0, min(cap, base * 2^(attempt-1))). */
export function computeStreamRetryBackoffMs(attempt: number): number {
  const cap = Math.min(STREAM_RETRY_MAX_DELAY_MS, STREAM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.random() * cap;
}

function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps a fresh-stream factory with attempt-scoped retry for transient
 * provider/transport failures.
 *
 * Events are buffered per attempt until the first content-bearing event
 * ("committed": text_delta / thinking_delta / toolcall_start) is observed. An
 * attempt that ends in error before committing, classified retryable by
 * `isTransientStreamError`, is discarded wholesale and replaced by a fresh
 * `factory()` call after a full-jitter backoff — the caller never sees the
 * failed attempt's events. Once committed, or once retries are
 * exhausted/disabled, events pass straight through untouched.
 *
 * The pump below runs eagerly (not gated on the returned stream being
 * iterated) because pi-ai's own stream factories start their network work as
 * soon as they're called, independent of consumer iteration — some callers
 * only await `.result()` without ever iterating events, and that pattern must
 * keep working through this wrapper.
 */
export function withStreamRetry(
  factory: () => AssistantMessageEventStream,
  options?: StreamRetryOptions,
): AssistantMessageEventStream {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_STREAM_RETRY_MAX_ATTEMPTS);
  const disabled = options?.disabled ?? false;
  const signal = options?.signal;
  const onRetry = options?.onRetry;

  const output = createAssistantMessageEventStream();
  const firstSource = factory();

  void (async () => {
    let attempt = 1;
    let source = firstSource;

    while (true) {
      let committed = false;
      const buffered: AssistantMessageEvent[] = [];
      let terminal: TerminalEvent | undefined;

      for await (const event of source) {
        if (!committed && COMMITTING_EVENT_TYPES.has(event.type)) {
          committed = true;
          for (const bufferedEvent of buffered.splice(0)) output.push(bufferedEvent);
        }
        if (committed) {
          output.push(event);
        } else {
          buffered.push(event);
        }
        if (isTerminalEvent(event)) terminal = event;
      }

      if (terminal?.type === "error" && !committed && !disabled && attempt < maxAttempts) {
        const failed = terminalMessage(terminal);
        if (isTransientStreamError(failed)) {
          const delayMs = computeStreamRetryBackoffMs(attempt);
          try {
            onRetry?.({
              attempt,
              maxAttempts,
              delayMs,
              // Status hooks may be forwarded to Gateway clients. Only emit
              // a bounded category, never the raw provider response.
              errorMessage: summarizeRetryableError(failed),
            });
            await sleepWithAbort(delayMs, signal);
            attempt += 1;
            source = factory();
            continue;
          } catch {
            // Aborted mid-backoff, or the next attempt failed to start —
            // surface the prior attempt's real failure below instead of
            // hanging the consumer on a retry that will never happen.
          }
        }
      }

      if (!committed) {
        for (const bufferedEvent of buffered) output.push(bufferedEvent);
      }
      // Some streams (notably minimal test doubles) never yield a terminal
      // done/error event through iteration and only expose the final message
      // via result(). output.end() is idempotent once a terminal event has
      // already been pushed above, so this also safety-nets that case.
      output.end(await source.result());
      return;
    }
  })();

  return output;
}
