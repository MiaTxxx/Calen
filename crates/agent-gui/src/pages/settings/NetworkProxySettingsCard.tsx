import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Globe, Loader2, RefreshCw } from "../../components/icons";
import { useLocale } from "../../i18n";
import { AgentActivationSwitch } from "./shared";

type AppProxyMode = "direct" | "system" | "manualHttp";

type AppProxySettings = {
  mode: AppProxyMode;
  manualUrl: string;
  bypass: string[];
  applyToChildProcesses: boolean;
};

type AppProxyStatus = {
  effectiveMode: AppProxyMode;
  systemProxyDetected: boolean;
  pacDetected: boolean;
  pacSupported: boolean;
  proxyDisplay?: string | null;
  warnings: string[];
};

type ProxyTestResult = {
  ok: boolean;
  latencyMs?: number | null;
  message: string;
};

const DEFAULT_SETTINGS: AppProxySettings = {
  mode: "system",
  manualUrl: "",
  bypass: ["localhost", "127.0.0.1", "::1"],
  applyToChildProcesses: false,
};

function normalizeSettings(value: Partial<AppProxySettings> | null | undefined): AppProxySettings {
  const mode =
    value?.mode === "direct" || value?.mode === "manualHttp" || value?.mode === "system"
      ? value.mode
      : "system";
  const bypass = Array.isArray(value?.bypass)
    ? value.bypass.map((item) => String(item).trim()).filter(Boolean)
    : DEFAULT_SETTINGS.bypass;
  return {
    mode,
    manualUrl: typeof value?.manualUrl === "string" ? value.manualUrl : "",
    bypass,
    applyToChildProcesses: value?.applyToChildProcesses === true,
  };
}

export function NetworkProxySettingsCard() {
  const { t } = useLocale();
  const [settings, setSettings] = useState<AppProxySettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<AppProxyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);

  const bypassText = useMemo(() => settings.bypass.join(", "), [settings.bypass]);

  async function refreshStatus() {
    const next = await invoke<AppProxyStatus>("network_proxy_status");
    setStatus({ ...next, warnings: Array.isArray(next.warnings) ? next.warnings : [] });
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      invoke<AppProxySettings>("network_proxy_get"),
      invoke<AppProxyStatus>("network_proxy_status"),
    ])
      .then(([nextSettings, nextStatus]) => {
        if (!active) return;
        setSettings(normalizeSettings(nextSettings));
        setStatus({
          ...nextStatus,
          warnings: Array.isArray(nextStatus.warnings) ? nextStatus.warnings : [],
        });
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setTestResult(null);
    try {
      const saved = await invoke<AppProxySettings>("network_proxy_save", { payload: settings });
      setSettings(normalizeSettings(saved));
      await refreshStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError("");
    setTestResult(null);
    try {
      const saved = await invoke<AppProxySettings>("network_proxy_save", { payload: settings });
      setSettings(normalizeSettings(saved));
      const result = await invoke<ProxyTestResult>("network_proxy_test", {});
      setTestResult(result);
      await refreshStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTesting(false);
    }
  }

  const modes: Array<{
    id: AppProxyMode;
    label: string;
    description: string;
  }> = [
    {
      id: "system",
      label: t("settings.networkProxyModeSystem"),
      description: t("settings.networkProxyModeSystemDesc"),
    },
    {
      id: "direct",
      label: t("settings.networkProxyModeDirect"),
      description: t("settings.networkProxyModeDirectDesc"),
    },
    {
      id: "manualHttp",
      label: t("settings.networkProxyModeManual"),
      description: t("settings.networkProxyModeManualDesc"),
    },
  ];

  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Globe className="h-4 w-4 text-muted-foreground" />
            {t("settings.networkProxy")}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.networkProxyDesc")}
          </p>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {modes.map((mode) => {
          const selected = settings.mode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              disabled={loading || saving || testing}
              onClick={() => setSettings((current) => ({ ...current, mode: mode.id }))}
              className={`relative rounded-xl border px-3.5 py-3 text-left transition-all disabled:opacity-60 ${
                selected
                  ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                  : "border-border/60 bg-background/80 hover:border-border hover:bg-muted/35"
              }`}
            >
              <div className="pr-5 text-sm font-semibold text-foreground">{mode.label}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                {mode.description}
              </div>
              {selected ? (
                <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" />
              ) : null}
            </button>
          );
        })}
      </div>

      {settings.mode === "manualHttp" ? (
        <div className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-3.5 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("settings.networkProxyManualUrl")}
            </span>
            <input
              value={settings.manualUrl}
              onChange={(event) =>
                setSettings((current) => ({ ...current, manualUrl: event.target.value }))
              }
              placeholder="http://127.0.0.1:7890"
              className="h-9 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-hidden transition-colors focus:border-primary"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("settings.networkProxyBypass")}
            </span>
            <input
              value={bypassText}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  bypass: event.target.value
                    .split(/[;,\n]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="localhost, 127.0.0.1, ::1"
              className="h-9 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-hidden transition-colors focus:border-primary"
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            {t("settings.networkProxyChildProcesses")}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {t("settings.networkProxyChildProcessesDesc")}
          </p>
        </div>
        <AgentActivationSwitch
          checked={settings.applyToChildProcesses}
          title={t("settings.networkProxyChildProcesses")}
          onToggle={() =>
            setSettings((current) => ({
              ...current,
              applyToChildProcesses: !current.applyToChildProcesses,
            }))
          }
        />
      </div>

      {status ? (
        <div className="rounded-xl border border-border/60 bg-muted/25 px-3.5 py-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{t("settings.networkProxyStatus")}</span>
            <span>{status.proxyDisplay || t("settings.networkProxyNoProxyDetected")}</span>
            {status.pacDetected && !status.pacSupported ? (
              <span className="text-amber-600 dark:text-amber-400">
                {t("settings.networkProxyPacUnsupported")}
              </span>
            ) : null}
          </div>
          {status.warnings.length ? (
            <div className="mt-2 space-y-1 text-amber-600 dark:text-amber-400">
              {status.warnings.map((warning) => (
                <div key={warning} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {testResult ? (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs ${
            testResult.ok
              ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300"
              : "border-red-500/25 bg-red-500/[0.06] text-red-600 dark:text-red-400"
          }`}
        >
          {testResult.message}
          {typeof testResult.latencyMs === "number" ? ` · ${testResult.latencyMs} ms` : ""}
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-500 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={loading || saving || testing}
          onClick={() => void testConnection()}
          className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("settings.networkProxyTest")}
        </button>
        <button
          type="button"
          disabled={loading || saving || testing}
          onClick={() => void save()}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-60"
        >
          {saving ? t("settings.networkProxySaving") : t("settings.networkProxySave")}
        </button>
      </div>
    </section>
  );
}
