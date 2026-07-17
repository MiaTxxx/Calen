import type {
  EvidenceSource,
  ProviderContext,
  ProviderEvidence,
  ProviderStatus,
  StockCapability,
  StockProvider,
} from "../types.ts";

export class ProviderError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "ProviderError";
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined)
      this.retryAfterMs = options.retryAfterMs;
  }
}

interface ProviderHealth {
  hasObservation: boolean;
  consecutiveFailures: number;
  circuitOpenUntilMs: number;
  cooldownUntilMs: number;
  cooldownLevel: number;
  averageLatencyMs?: number;
  lastSuccessAtMs?: number;
  lastError: string | undefined;
}

interface CacheEntry<T> {
  createdAt: number;
  expiresAt: number;
  value: ProviderQueryResult<T>;
}

export interface ProviderQueryResult<T> {
  data: T | null;
  source?: EvidenceSource;
  cached: boolean;
  warnings: string[];
}

export interface ProviderRegistryOptions {
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  cacheTtlMs?: number;
  timeoutMs?: number;
  /**
   * Minimum interval shared by all requests to one provider.
   * A value of zero disables proactive throttling while retaining cooldown.
   */
  throttleIntervalMs?: number;
  /** Optional per-provider/capability overrides, e.g. { "eastmoney:snapshot": 1000 }. */
  throttleIntervalsMs?: Readonly<Record<string, number>>;
  throttleStore?: ThrottleStore;
  failureThreshold?: number;
  circuitOpenMs?: number;
  cooldownBaseMs?: number;
  /** Failed upstream calls tolerated before one final recovery candidate. */
  maxAttempts?: number;
}

export interface ThrottleStore {
  acquire(
    key: string,
    minIntervalMs: number,
    signal?: AbortSignal
  ): Promise<void>;
  release(key: string): void;
}

interface ThrottleWaiter {
  intervalMs: number;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface ThrottleState {
  busy: boolean;
  lastReleasedAt: number;
  queue: ThrottleWaiter[];
}

/**
 * Process-local, per-key rate limiter. The interface is deliberately tiny so
 * Tauri can replace it with a persisted ThrottleStore without changing the
 * ProviderRegistry contract.
 */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly states = new Map<string, ThrottleState>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  acquire(
    key: string,
    minIntervalMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted)
      return Promise.reject(signal.reason ?? new Error("Request cancelled"));
    const state = this.states.get(key) ?? {
      busy: false,
      lastReleasedAt: 0,
      queue: [],
    };
    this.states.set(key, state);
    return new Promise<void>((resolve, reject) => {
      const waiter: ThrottleWaiter = {
        intervalMs: Math.max(0, minIntervalMs),
        resolve,
        reject,
        signal,
        onAbort: undefined,
        timer: undefined,
      };
      waiter.onAbort = () => {
        if (waiter.timer !== undefined) clearTimeout(waiter.timer);
        const queuedIndex = state.queue.indexOf(waiter);
        if (queuedIndex >= 0) state.queue.splice(queuedIndex, 1);
        if (state.busy && queuedIndex < 0) state.busy = false;
        reject(signal?.reason ?? new Error("Request cancelled"));
        this.pump(key, state);
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      state.queue.push(waiter);
      this.pump(key, state);
    });
  }

  release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    state.lastReleasedAt = this.now();
    state.busy = false;
    this.pump(key, state);
  }

  private pump(key: string, state: ThrottleState): void {
    if (state.busy || !state.queue.length) return;
    const waiter = state.queue.shift()!;
    if (waiter.signal?.aborted) {
      waiter.onAbort?.();
      return;
    }
    state.busy = true;
    const delay = Math.max(
      0,
      waiter.intervalMs - (this.now() - state.lastReleasedAt)
    );
    const grant = () => {
      waiter.timer = undefined;
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      if (waiter.signal?.aborted) {
        state.busy = false;
        waiter.reject(waiter.signal.reason ?? new Error("Request cancelled"));
        this.pump(key, state);
        return;
      }
      waiter.resolve();
    };
    if (delay > 0) waiter.timer = setTimeout(grant, delay);
    else grant();
  }
}

export class ProviderRegistry {
  private readonly providers: StockProvider[];
  private readonly health = new Map<string, ProviderHealth>();
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly now: () => Date;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly throttleIntervalMs: number;
  private readonly throttleIntervalsMs: Readonly<Record<string, number>>;
  private readonly throttleStore: ThrottleStore;
  private readonly failureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly cooldownBaseMs: number;
  private readonly maxFailedAttempts: number;

  constructor(
    providers: StockProvider[],
    options: ProviderRegistryOptions = {}
  ) {
    this.providers = [...providers];
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.throttleIntervalMs = Math.max(0, options.throttleIntervalMs ?? 1_000);
    this.throttleIntervalsMs = options.throttleIntervalsMs ?? {};
    this.throttleStore =
      options.throttleStore ??
      new MemoryThrottleStore(() => this.now().getTime());
    this.failureThreshold = options.failureThreshold ?? 3;
    this.circuitOpenMs = options.circuitOpenMs ?? 60_000;
    this.cooldownBaseMs = options.cooldownBaseMs ?? 60_000;
    this.maxFailedAttempts = Math.max(0, Math.trunc(options.maxAttempts ?? 3));
  }

  async query<T>(
    capability: StockCapability,
    cacheKey: string,
    operation: (
      provider: StockProvider,
      context: ProviderContext
    ) => Promise<ProviderEvidence<T>>,
    signal?: AbortSignal,
    maxAgeMs = this.cacheTtlMs
  ): Promise<ProviderQueryResult<T>> {
    const key = `${capability}:${cacheKey}`;
    const currentMs = this.now().getTime();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (
      cached &&
      maxAgeMs > 0 &&
      cached.expiresAt > currentMs &&
      currentMs - cached.createdAt <= maxAgeMs
    ) {
      const result: ProviderQueryResult<T> = {
        data: cached.value.data,
        cached: true,
        warnings: cached.value.warnings,
      };
      if (cached.value.source)
        result.source = { ...cached.value.source, cached: true };
      return result;
    }
    if (cached) this.cache.delete(key);

    const warnings: string[] = [];
    const market = this.marketScope(cacheKey);
    const candidates = this.providers
      .filter((provider) => provider.capabilities.includes(capability))
      .filter((provider) =>
        this.isAvailable(provider.id, capability, market, currentMs)
      )
      .sort((left, right) =>
        this.compareProviders(left, right, capability, market)
      );

    let failedAttempts = 0;
    for (const provider of candidates) {
      if (failedAttempts > this.maxFailedAttempts) break;
      if (signal?.aborted)
        throw signal.reason ?? new Error("Request cancelled");
      const startedAt = this.now().getTime();
      const throttleConfigKey = `${provider.id}:${capability}`;
      const throttleIntervalMs = Math.max(
        0,
        this.throttleIntervalsMs[throttleConfigKey] ??
          this.throttleIntervalsMs[provider.id] ??
          this.throttleIntervalMs
      );
      let throttled = false;
      let upstreamStarted = false;
      try {
        await this.withTimeout(
          (throttleSignal) =>
            this.throttleStore.acquire(
              provider.id,
              throttleIntervalMs,
              throttleSignal
            ),
          signal
        );
        throttled = true;
        upstreamStarted = true;
        const evidence = await this.withTimeout(
          (providerSignal) =>
            operation(provider, {
              signal: providerSignal,
              fetch: this.fetchImpl,
              now: this.now,
            }),
          signal
        );
        if (this.isEmptyEvidence(evidence.data)) {
          const reason = evidence.warnings?.length
            ? evidence.warnings.join("；")
            : "返回空数据";
          warnings.push(`${provider.id}: ${reason}`);
          continue;
        }
        const finishedAt = this.now().getTime();
        this.recordSuccess(
          provider.id,
          capability,
          market,
          Math.max(0, finishedAt - startedAt),
          finishedAt
        );
        const retrievedAt = this.now().toISOString();
        const result: ProviderQueryResult<T> = {
          data: evidence.data,
          source: {
            id: provider.id,
            name: provider.id,
            provider: provider.id,
            capability,
            asOf: evidence.asOf,
            retrievedAt,
            cached: false,
          },
          cached: false,
          warnings: [...warnings, ...(evidence.warnings ?? [])],
        };
        this.cache.set(key, {
          createdAt: finishedAt,
          expiresAt: finishedAt + this.cacheTtlMs,
          value: result,
        });
        return result;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${provider.id}: ${message}`);
        if (upstreamStarted) {
          failedAttempts += 1;
          this.recordFailure(provider, capability, market, error);
        }
      } finally {
        if (throttled) this.throttleStore.release(provider.id);
      }
    }
    if (!candidates.length)
      warnings.push(`没有可用 Provider 支持 ${capability}`);
    return { data: null, cached: false, warnings };
  }

  status(): ProviderStatus[] {
    const currentMs = this.now().getTime();
    return this.providers.map((provider) => {
      const states = this.providerHealth(provider.id);
      const observed = states.filter((state) => state.hasObservation);
      const availableStates = observed.filter(
        (state) =>
          state.circuitOpenUntilMs <= currentMs &&
          state.cooldownUntilMs <= currentMs
      );
      const circuitOpenUntilMs = Math.max(
        0,
        ...observed.map((state) => state.circuitOpenUntilMs)
      );
      const cooldownUntilMs = Math.max(
        0,
        ...observed.map((state) => state.cooldownUntilMs)
      );
      const lastSuccessAtMs = Math.max(
        0,
        ...observed.map((state) => state.lastSuccessAtMs ?? 0)
      );
      const latencies = observed
        .map((state) => state.averageLatencyMs)
        .filter((value): value is number => value !== undefined);
      const status: ProviderStatus = {
        id: provider.id,
        capabilities: [...provider.capabilities],
        priority: provider.priority,
        state: !observed.length
          ? "unknown"
          : availableStates.length
            ? "ready"
            : cooldownUntilMs > currentMs
              ? "cooldown"
              : "unavailable",
        enabled: true,
        configured: true,
        available: availableStates.length > 0,
        consecutiveFailures: Math.max(
          0,
          ...observed.map((state) => state.consecutiveFailures)
        ),
      };
      if (circuitOpenUntilMs > currentMs)
        status.circuitOpenUntil = new Date(circuitOpenUntilMs).toISOString();
      if (cooldownUntilMs > currentMs)
        status.cooldownUntil = new Date(cooldownUntilMs).toISOString();
      if (latencies.length)
        status.averageLatencyMs = Math.round(
          latencies.reduce((sum, value) => sum + value, 0) / latencies.length
        );
      if (lastSuccessAtMs > 0)
        status.lastSuccessAt = new Date(lastSuccessAtMs).toISOString();
      const lastError = observed.find((state) => state.lastError)?.lastError;
      if (lastError !== undefined) status.lastError = lastError;
      if (!observed.length) status.warnings = ["尚未完成首个真实上游探测"];
      return status;
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  private compareProviders(
    left: StockProvider,
    right: StockProvider,
    capability: StockCapability,
    market: string
  ): number {
    if (left.priority !== right.priority) return left.priority - right.priority;
    const leftLatency =
      this.health.get(this.healthKey(left.id, capability, market))
        ?.averageLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const rightLatency =
      this.health.get(this.healthKey(right.id, capability, market))
        ?.averageLatencyMs ?? Number.MAX_SAFE_INTEGER;
    return leftLatency - rightLatency;
  }

  private isAvailable(
    id: string,
    capability: StockCapability,
    market: string,
    currentMs: number
  ): boolean {
    const state = this.health.get(this.healthKey(id, capability, market));
    return (
      !state ||
      (state.circuitOpenUntilMs <= currentMs &&
        state.cooldownUntilMs <= currentMs)
    );
  }

  private recordSuccess(
    id: string,
    capability: StockCapability,
    market: string,
    latencyMs: number,
    finishedAtMs: number
  ): void {
    const key = this.healthKey(id, capability, market);
    const state = this.health.get(key) ?? this.newHealth();
    state.hasObservation = true;
    state.consecutiveFailures = 0;
    state.circuitOpenUntilMs = 0;
    state.cooldownLevel = 0;
    state.lastSuccessAtMs = finishedAtMs;
    state.lastError = undefined;
    state.averageLatencyMs =
      state.averageLatencyMs === undefined
        ? latencyMs
        : Math.round(state.averageLatencyMs * 0.7 + latencyMs * 0.3);
    this.health.set(key, state);
  }

  private recordFailure(
    provider: StockProvider,
    capability: StockCapability,
    market: string,
    error: unknown
  ): void {
    const key = this.healthKey(provider.id, capability, market);
    const state = this.health.get(key) ?? this.newHealth();
    state.hasObservation = true;
    const nowMs = this.now().getTime();
    state.consecutiveFailures += 1;
    state.lastError = error instanceof Error ? error.message : String(error);
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.circuitOpenUntilMs = nowMs + this.circuitOpenMs;
    }
    if (provider.free && this.isThrottleFailure(error)) {
      state.cooldownLevel = Math.min(state.cooldownLevel + 1, 8);
      const retryAfter =
        error instanceof ProviderError ? error.retryAfterMs : undefined;
      state.cooldownUntilMs =
        nowMs +
        (retryAfter ?? this.cooldownBaseMs * 2 ** (state.cooldownLevel - 1));
    }
    this.health.set(key, state);
  }

  private marketScope(cacheKey: string): string {
    const prefix = cacheKey.split(":", 1)[0]?.toUpperCase();
    return prefix === "CN" || prefix === "HK" || prefix === "US"
      ? prefix
      : "GLOBAL";
  }

  private healthKey(
    providerId: string,
    capability: StockCapability,
    market: string
  ): string {
    return `${providerId}\u0000${capability}\u0000${market}`;
  }

  private providerHealth(providerId: string): ProviderHealth[] {
    const prefix = `${providerId}\u0000`;
    return [...this.health.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, state]) => state);
  }

  private isEmptyEvidence(value: unknown): boolean {
    return value === null || (Array.isArray(value) && value.length === 0);
  }

  private isThrottleFailure(error: unknown): boolean {
    if (!(error instanceof ProviderError)) return false;
    return (
      error.status === 403 ||
      error.status === 429 ||
      (error.status !== undefined && error.status >= 500)
    );
  }

  private withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new ProviderError(`Provider timeout after ${this.timeoutMs}ms`)
        ),
      this.timeoutMs
    );
    const abortParent = () => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abortParent, { once: true });
    if (parentSignal?.aborted) abortParent();
    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectAbort = () =>
        reject(
          controller.signal.reason ??
            new ProviderError("Provider request aborted")
        );
      if (controller.signal.aborted) rejectAbort();
      else
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
    });
    return Promise.race([operation(controller.signal), aborted]).finally(() => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortParent);
    });
  }

  private newHealth(): ProviderHealth {
    return {
      hasObservation: false,
      consecutiveFailures: 0,
      circuitOpenUntilMs: 0,
      cooldownUntilMs: 0,
      cooldownLevel: 0,
      lastError: undefined,
    };
  }
}
