import {
  createStockResearchService,
  type CreateStockResearchServiceOptions,
} from "./service.ts";
import {
  createDefaultProviders,
  IMPLEMENTED_PROVIDER_IDS,
} from "./providers/defaults.ts";
import type { ProviderStatus, StockResearchPort } from "./types.ts";

const KNOWN_PROVIDERS = [
  "tencent",
  "eastmoney",
  "sinafinance",
  "baostock",
  "zzshare",
  "tushare",
  "tickflow",
  "fuyao",
] as const;

const KEY_PROVIDERS = new Set(["zzshare", "tushare", "tickflow", "fuyao"]);

type Environment = Record<string, string | undefined>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return record(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export interface StockRuntimeConfig {
  enabled: boolean;
  timeoutMs: number;
  cacheTtlMs: number;
  enabledProviderIds: string[];
  providerKeys: Record<string, string>;
  providerCatalog: ProviderStatus[];
}

export function loadStockRuntimeConfig(
  env: Environment = process.env
): StockRuntimeConfig {
  const settings = parseObject(env.CALEN_STOCK_SETTINGS);
  const keysPayload = parseObject(env.CALEN_STOCK_PROVIDER_KEYS);
  const providerKeys = Object.fromEntries(
    Object.entries(keysPayload).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0
    )
  );
  const enabled = settings.enabled !== false;
  const requestedProviders = Array.isArray(settings.providers)
    ? settings.providers.map(record).filter((item) => item !== undefined)
    : [];
  const providerEnabled = new Map<string, boolean>(
    KNOWN_PROVIDERS.map((id) => [id, id === "tencent" || id === "eastmoney"])
  );
  for (const item of requestedProviders) {
    if (
      typeof item.id === "string" &&
      KNOWN_PROVIDERS.includes(item.id as (typeof KNOWN_PROVIDERS)[number])
    ) {
      providerEnabled.set(item.id, item.enabled === true);
    }
  }
  const implemented = new Set<string>(IMPLEMENTED_PROVIDER_IDS);
  const enabledProviderIds = enabled
    ? [...providerEnabled]
        .filter(([id, isEnabled]) => isEnabled && implemented.has(id))
        .map(([id]) => id)
    : [];
  const providerCatalog: ProviderStatus[] = KNOWN_PROVIDERS.flatMap(
    (id, index) => {
      const isEnabled = enabled && providerEnabled.get(id) === true;
      if (isEnabled && implemented.has(id)) return [];
      const implementedProvider = implemented.has(id);
      const status: ProviderStatus = {
        id,
        capabilities: [],
        priority: 900 + index,
        state: isEnabled && !implementedProvider ? "unconfigured" : "disabled",
        enabled: isEnabled,
        configured:
          implementedProvider ||
          (KEY_PROVIDERS.has(id) && Boolean(providerKeys[id])),
        available: false,
        consecutiveFailures: 0,
      };
      if (isEnabled && !implementedProvider)
        status.warnings = [`Provider ${id} 尚未实现，未注册到运行时`];
      else if (!isEnabled) status.warnings = [`Provider ${id} 已禁用`];
      return [status];
    }
  );
  return {
    enabled,
    timeoutMs: boundedNumber(settings.timeoutMs, 15_000, 500, 120_000),
    cacheTtlMs: boundedNumber(settings.cacheTtlMinutes, 5, 0, 1_440) * 60_000,
    enabledProviderIds,
    providerKeys,
    providerCatalog,
  };
}

export function createStockResearchServiceFromEnvironment(
  env: Environment = process.env,
  overrides: Omit<
    CreateStockResearchServiceOptions,
    "providers" | "providerCatalog" | "timeoutMs" | "cacheTtlMs"
  > = {}
): StockResearchPort {
  const config = loadStockRuntimeConfig(env);
  return createStockResearchService({
    ...overrides,
    providers: createDefaultProviders(config.enabledProviderIds),
    providerCatalog: config.providerCatalog,
    timeoutMs: config.timeoutMs,
    cacheTtlMs: config.cacheTtlMs,
  });
}
