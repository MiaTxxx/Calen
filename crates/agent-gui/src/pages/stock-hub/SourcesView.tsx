import { useCallback, useEffect, useState } from "react";
import { GlassPanel } from "../../components/hub/HubChrome";
import { AlertTriangle, Key, Loader2, RefreshCw, Server } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/shared/utils";
import {
  type AsyncResource,
  formatStockError,
  getStockServiceFailureMessage,
  STOCK_TIMEOUT_MAX_MS,
  STOCK_TIMEOUT_MIN_MS,
  type StockServiceStatus,
  type StockSettings,
  type StockSettingsSavePayload,
  stockResearch,
  validateStockTimeoutDraft,
} from "../../lib/stock-research";
import { Field, LoadingCard, ResourceError, StatusBadge } from "./shared";

export function SourcesView({
  resource,
  onRefresh,
  onRestarted,
}: {
  resource: AsyncResource<StockServiceStatus>;
  onRefresh: () => Promise<void>;
  onRestarted: (status: StockServiceStatus) => void;
}) {
  const [settings, setSettings] = useState<AsyncResource<StockSettings>>({
    state: "idle",
  });
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [clearKeys, setClearKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartSucceeded, setRestartSucceeded] = useState(false);
  const [timeoutDraft, setTimeoutDraft] = useState("");
  const [timeoutError, setTimeoutError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setSettings({ state: "loading" });
    try {
      const next = await stockResearch.settingsGet();
      setSettings({ state: "ready", data: next });
      setTimeoutDraft(String(next.timeoutMs));
      setTimeoutError(null);
    } catch (error) {
      setSettings({ state: "error", message: formatStockError(error) });
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateSettings(updater: (current: StockSettings) => StockSettings) {
    setSettings((current) =>
      current.state === "ready" ? { state: "ready", data: updater(current.data) } : current,
    );
    setSaved(false);
  }

  async function saveSettings() {
    if (settings.state !== "ready") return;
    const timeoutValidation = validateStockTimeoutDraft(timeoutDraft);
    if (!timeoutValidation.ok) {
      setTimeoutError(timeoutValidation.error);
      setSaved(false);
      return;
    }
    const providerKeyUpdates: StockSettingsSavePayload["providerKeyUpdates"] = {};
    for (const provider of keyedProviders) {
      const draft = keyDrafts[provider.id]?.trim();
      if (clearKeys[provider.id]) providerKeyUpdates[provider.id] = null;
      else if (draft) providerKeyUpdates[provider.id] = draft;
    }
    const payload: StockSettingsSavePayload = {
      ...settings.data,
      timeoutMs: timeoutValidation.value,
      ...(Object.keys(providerKeyUpdates).length ? { providerKeyUpdates } : {}),
    };
    setSaving(true);
    setSaved(false);
    try {
      const next = await stockResearch.settingsSave(payload);
      setSettings({ state: "ready", data: next });
      setTimeoutDraft(String(next.timeoutMs));
      setTimeoutError(null);
      setKeyDrafts({});
      setClearKeys({});
      setSaved(true);
      await onRefresh();
    } catch (error) {
      setSettings({ state: "error", message: formatStockError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function restartService() {
    setRestarting(true);
    setRestartError(null);
    setRestartSucceeded(false);
    try {
      const next = await stockResearch.restart();
      if (next.runtime?.running !== true) {
        throw new Error(getStockServiceFailureMessage(next) ?? "股票服务重启后仍未完成探活。");
      }
      onRestarted(next);
      setRestartSucceeded(true);
    } catch (error) {
      setRestartError(formatStockError(error));
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void restartService()}
          disabled={restarting || resource.state === "loading"}
          className="gap-2"
        >
          {restarting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Server className="h-3.5 w-3.5" />
          )}
          {restarting ? "正在重启股票服务…" : "重启股票服务"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void Promise.all([onRefresh(), loadSettings()])}
          disabled={resource.state === "loading"}
          className="gap-2"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", resource.state === "loading" && "animate-spin")}
          />
          刷新状态
        </Button>
      </div>
      {restartError ? (
        <GlassPanel tone="error">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>重启失败：{restartError}</span>
          </div>
        </GlassPanel>
      ) : null}
      {restartSucceeded ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          股票服务已重启并完成探活。
        </div>
      ) : null}
      {resource.state === "loading" ? <LoadingCard text="检查 sidecar 与 Provider…" /> : null}
      <ResourceError resource={resource} panel />
      <ResourceError resource={settings} panel />
      {settings.state === "loading" ? <LoadingCard text="正在读取本地股票设置…" /> : null}
      {settings.state === "ready" ? (
        <StockSettingsPanel
          settings={settings.data}
          keyDrafts={keyDrafts}
          clearKeys={clearKeys}
          saving={saving}
          saved={saved}
          timeoutDraft={timeoutDraft}
          timeoutError={timeoutError}
          onChange={updateSettings}
          onTimeoutDraft={(value) => {
            setTimeoutDraft(value);
            setTimeoutError(null);
            setSaved(false);
          }}
          onKeyDraft={(id, value) => {
            setKeyDrafts((current) => ({ ...current, [id]: value }));
            setClearKeys((current) => ({ ...current, [id]: false }));
            setSaved(false);
          }}
          onClearKey={(id) => {
            setClearKeys((current) => ({ ...current, [id]: !current[id] }));
            setKeyDrafts((current) => ({ ...current, [id]: "" }));
            setSaved(false);
          }}
          onSave={() => void saveSettings()}
        />
      ) : null}
      {resource.state === "ready" ? (
        <>
          <GlassPanel>
            <div className="flex items-start gap-3">
              <Server className="mt-0.5 h-5 w-5" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Stock Research Sidecar</h2>
                  <StatusBadge
                    status={
                      resource.data.state === "ready"
                        ? "ok"
                        : resource.data.state === "degraded"
                          ? "partial"
                          : "unavailable"
                    }
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getStockServiceFailureMessage(resource.data) ??
                    `状态：${resource.data.state}${resource.data.version ? ` · v${resource.data.version}` : ""}`}
                </p>
              </div>
            </div>
            <RuntimeDiagnostics status={resource.data} />
          </GlassPanel>
          <StockCapabilityMatrix />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {resource.data.providers.map((provider) => (
              <GlassPanel key={provider.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{provider.name}</span>
                  </div>
                  <StatusBadge
                    status={
                      provider.state === "ready"
                        ? "ok"
                        : provider.state === "unknown"
                          ? "partial"
                          : provider.state === "cooldown"
                            ? "partial"
                            : "unavailable"
                    }
                    label={
                      provider.state === "ready"
                        ? "可用"
                        : provider.state === "unknown"
                          ? "待探测"
                          : provider.state === "cooldown"
                            ? "冷却中"
                            : provider.state === "disabled"
                              ? "已禁用"
                              : provider.state === "unconfigured"
                                ? "未配置"
                                : "失败"
                    }
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {provider.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full bg-muted/55 px-2 py-1 text-[10px] text-muted-foreground"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[10.5px] text-muted-foreground">
                  {provider.lastSuccessAt
                    ? `最近成功：${provider.lastSuccessAt}`
                    : provider.state === "unknown"
                      ? "尚未执行真实上游请求；运行一次查询后更新状态。"
                      : "暂无成功请求时间。"}
                </p>
                {provider.message ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">{provider.message}</p>
                ) : null}
              </GlassPanel>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function RuntimeDiagnostics({ status }: { status: StockServiceStatus }) {
  const runtime = status.runtime;
  if (!runtime) return null;
  const failure = runtime.failure;
  const stderrTail = failure?.stderrTail.length ? failure.stderrTail : runtime.stderrTail;
  const sidecarRoot = failure?.sidecarRoot ?? runtime.sidecarRoot;

  return (
    <details className="mt-4 rounded-xl border border-border/40 bg-background/45 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
        运行诊断
      </summary>
      <div className="mt-3 grid gap-2 text-[10.5px] text-muted-foreground sm:grid-cols-2">
        <div>运行中：{runtime.running === undefined ? "未知" : runtime.running ? "是" : "否"}</div>
        <div>连续失败：{runtime.consecutiveFailures ?? "未知"}</div>
        {failure?.stage ? <div>故障阶段：{failure.stage}</div> : null}
        {failure?.occurredAt ? <div>发生时间：{failure.occurredAt}</div> : null}
        {failure?.processId !== undefined ? <div>进程 PID：{failure.processId}</div> : null}
        {failure?.exitCode !== undefined ? <div>退出码：{failure.exitCode}</div> : null}
        {sidecarRoot ? (
          <div className="break-all sm:col-span-2">Sidecar 路径：{sidecarRoot}</div>
        ) : null}
      </div>
      {failure?.firstError ? (
        <div className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-[10.5px] text-destructive">
          <span className="font-medium">首次错误：</span>
          <span className="break-words">{failure.firstError}</span>
        </div>
      ) : null}
      {failure?.restartError ? (
        <div className="mt-2 rounded-lg bg-destructive/5 px-3 py-2 text-[10.5px] text-destructive">
          <span className="font-medium">重启错误：</span>
          <span className="break-words">{failure.restartError}</span>
        </div>
      ) : null}
      {runtime.message ? (
        <div className="mt-2 break-words text-[10.5px] text-muted-foreground">
          Runtime：{runtime.message}
        </div>
      ) : null}
      {stderrTail.length ? (
        <div className="mt-3">
          <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">stderr 尾部</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/5 p-3 text-[10px] leading-4 text-muted-foreground dark:bg-white/5">
            {stderrTail.join("\n")}
          </pre>
        </div>
      ) : null}
    </details>
  );
}

const stockCapabilityMatrix = [
  {
    market: "A 股",
    basic: "搜索、实时行情、日 K、公司资料",
    research: "财务三表、股东、分红、资金流、新闻、公告正文",
    experimental: "技术指标、评分、策略、Evaluator、回测",
  },
  {
    market: "港股",
    basic: "搜索、行情、日 K、有限公司资料",
    research: "首版不保证深度财务、股东与公告正文",
    experimental: "依赖历史 K 线覆盖率，可能为 partial",
  },
  {
    market: "美股",
    basic: "搜索、行情、日 K、有限资料与收入分部",
    research: "首版不保证深度财务、股东与公告正文",
    experimental: "依赖历史 K 线覆盖率，可能为 partial",
  },
  {
    market: "ETF",
    basic: "统一标的、行情与日 K",
    research: "Provider 支持时展示净值、溢价和主要持仓",
    experimental: "可运行指标与回测，结果始终标记实验性",
  },
] as const;

function StockCapabilityMatrix() {
  return (
    <GlassPanel>
      <div>
        <h2 className="text-sm font-semibold">市场能力矩阵</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          能力边界按首版真实实现展示；Provider 不支持时返回 partial 或 unavailable。
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/40">
              <th className="px-2 py-2 font-medium">市场</th>
              <th className="px-2 py-2 font-medium">基础能力</th>
              <th className="px-2 py-2 font-medium">研究能力</th>
              <th className="px-2 py-2 font-medium">实验能力</th>
            </tr>
          </thead>
          <tbody>
            {stockCapabilityMatrix.map((row) => (
              <tr key={row.market} className="border-b border-border/25 align-top last:border-0">
                <td className="px-2 py-2 font-semibold">{row.market}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.basic}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.research}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.experimental}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

const keyedProviders = [
  { id: "zzshare", label: "ZZShare" },
  { id: "tushare", label: "Tushare" },
  { id: "tickflow", label: "TickFlow" },
  { id: "fuyao", label: "Fuyao" },
] as const;

function StockSettingsPanel(props: {
  settings: StockSettings;
  keyDrafts: Record<string, string>;
  clearKeys: Record<string, boolean>;
  saving: boolean;
  saved: boolean;
  timeoutDraft: string;
  timeoutError: string | null;
  onChange: (updater: (current: StockSettings) => StockSettings) => void;
  onTimeoutDraft: (value: string) => void;
  onKeyDraft: (id: string, value: string) => void;
  onClearKey: (id: string) => void;
  onSave: () => void;
}) {
  const {
    settings,
    keyDrafts,
    clearKeys,
    saving,
    saved,
    timeoutDraft,
    timeoutError,
    onChange,
    onTimeoutDraft,
    onKeyDraft,
    onClearKey,
    onSave,
  } = props;
  return (
    <GlassPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">股票服务设置</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            密钥保存在 Windows 凭据管理器；已保存的 Key 永不回显。
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            className="h-4 w-4 accent-foreground"
          />
          启用股票服务
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="默认市场">
          <select
            value={settings.defaultMarket}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                defaultMarket: event.target.value as StockSettings["defaultMarket"],
              }))
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="CN">A 股</option>
            <option value="HK">港股</option>
            <option value="US">美股</option>
          </select>
        </Field>
        <Field label="请求超时（毫秒）">
          <Input
            id="stock-request-timeout"
            type="number"
            min={STOCK_TIMEOUT_MIN_MS}
            max={STOCK_TIMEOUT_MAX_MS}
            step={1000}
            value={timeoutDraft}
            aria-invalid={Boolean(timeoutError)}
            aria-describedby={timeoutError ? "stock-request-timeout-error" : undefined}
            onChange={(event) => onTimeoutDraft(event.target.value)}
          />
          {timeoutError ? (
            <p
              id="stock-request-timeout-error"
              role="alert"
              className="mt-1.5 text-[10.5px] text-destructive"
            >
              {timeoutError}
            </p>
          ) : null}
        </Field>
        <Field label="缓存 TTL（分钟）">
          <Input
            type="number"
            min={0}
            max={1440}
            value={settings.cacheTtlMinutes}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                cacheTtlMinutes: Number(event.target.value),
              }))
            }
          />
        </Field>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {settings.providers.map((provider) => {
          const keyed = keyedProviders.find((item) => item.id === provider.id);
          return (
            <div
              key={provider.id}
              className="rounded-2xl border border-border/40 bg-background/45 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">{keyed?.label ?? provider.id}</span>
                  {provider.keyConfigured ? (
                    <StatusBadge status="ok" label="Key 已配置" />
                  ) : keyed ? (
                    <StatusBadge status="unavailable" label="未配置 Key" />
                  ) : null}
                </div>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        providers: current.providers.map((item) =>
                          item.id === provider.id
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      }))
                    }
                    className="h-3.5 w-3.5 accent-foreground"
                  />
                  启用
                </label>
              </div>
              {keyed ? (
                <div className="mt-3 flex gap-2">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={keyDrafts[provider.id] ?? ""}
                    disabled={Boolean(clearKeys[provider.id])}
                    onChange={(event) => onKeyDraft(provider.id, event.target.value)}
                    placeholder={provider.keyConfigured ? "输入新 Key 以替换" : "输入新 Key"}
                    aria-label={`${keyed.label} 新 Key`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "shrink-0",
                      clearKeys[provider.id] && "border-destructive/30 text-destructive",
                    )}
                    onClick={() => onClearKey(provider.id)}
                  >
                    {clearKeys[provider.id] ? "撤销清除" : "清除"}
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-[10.5px] text-muted-foreground">
                  免费数据源，无需配置 Key。
                </p>
              )}
              {clearKeys[provider.id] ? (
                <p className="mt-2 text-[10.5px] text-destructive">
                  保存后将从 Windows 凭据管理器删除该 Key。
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? (
          <span className="text-[11px] text-emerald-600">设置已保存，股票服务已重启</span>
        ) : null}
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          保存设置
        </Button>
      </div>
    </GlassPanel>
  );
}
