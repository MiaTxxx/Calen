import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  File,
  Languages,
  LoaderCircle,
  Trash2,
  XCircle,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useLocale } from "../../i18n";
import { buildModelOptions } from "../../lib/chat/page/chatPageHelpers";
import { parseModelValue, toModelValue } from "../../lib/providers/llm";
import { type TranslationMode, updateCustomSettings } from "../../lib/settings";
import { DEFAULT_OFFLINE_TRANSLATION_MODEL_ID } from "../../lib/translation";
import {
  cancelOfflineTranslationDownload,
  deleteOfflineTranslationModel,
  getOfflineTranslationStatus,
  importOfflineTranslationModel,
  listOfflineTranslationModels,
  type OfflineTranslationDownload,
  type OfflineTranslationModel,
  type OfflineTranslationStatus,
  startOfflineTranslationDownload,
  stopOfflineTranslationRuntime,
} from "../../lib/translation/tauri";
import type { SettingsSectionProps } from "./types";

const REMOTE_MODEL_FOLLOW_CURRENT = "__translation_follow_current__";
const ACTIVE_DOWNLOAD_PHASES = new Set(["queued", "downloading", "verifying"]);

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

function downloadPercent(download: OfflineTranslationDownload | undefined) {
  if (!download || download.totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, (download.bytesDownloaded / download.totalBytes) * 100));
}

function mergeModels(catalog: OfflineTranslationModel[], statusModels: OfflineTranslationModel[]) {
  const merged = new Map(catalog.map((model) => [model.id, model]));
  for (const model of statusModels) merged.set(model.id, model);
  return [...merged.values()].sort((left, right) => {
    if (left.recommended !== right.recommended) return left.recommended ? -1 : 1;
    if (left.source !== right.source) return left.source === "builtIn" ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

export function TranslationSettingsForm({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [catalog, setCatalog] = useState<OfflineTranslationModel[]>([]);
  const [status, setStatus] = useState<OfflineTranslationStatus>({
    models: [],
    downloads: [],
    runtime: { available: false, running: false },
  });
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modelOptions = useMemo(() => buildModelOptions(settings), [settings]);
  const localModels = useMemo(() => mergeModels(catalog, status.models), [catalog, status.models]);
  const downloads = useMemo(
    () => new Map(status.downloads.map((download) => [download.modelId, download])),
    [status.downloads],
  );
  const translationSettings = settings.customSettings.translation;
  const selectedLocalModel = localModels.find(
    (model) => model.id === translationSettings.localModelId,
  );
  const remoteModel = settings.customSettings.translationModel;
  const remoteValue = remoteModel
    ? toModelValue(remoteModel.customProviderId, remoteModel.model)
    : REMOTE_MODEL_FOLLOW_CURRENT;
  const remoteOption = modelOptions.find((option) => option.value === remoteValue);
  const remoteLabel = remoteModel
    ? remoteOption
      ? `${remoteOption.providerName} / ${remoteOption.label}`
      : remoteModel.model
    : t("settings.translationRemoteFollowCurrent");

  const refreshStatus = useCallback(async () => {
    const next = await getOfflineTranslationStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([listOfflineTranslationModels(), getOfflineTranslationStatus()])
      .then(([nextCatalog, nextStatus]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setStatus(nextStatus);
        setError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hasActiveDownload = status.downloads.some((download) =>
    ACTIVE_DOWNLOAD_PHASES.has(download.phase),
  );
  useEffect(() => {
    if (!hasActiveDownload) return;
    const timer = window.setInterval(() => {
      void refreshStatus().catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [hasActiveDownload, refreshStatus]);

  function updateTranslation(patch: Partial<typeof translationSettings>) {
    setSettings((prev) =>
      updateCustomSettings(prev, {
        translation: { ...prev.customSettings.translation, ...patch },
      }),
    );
  }

  async function runAction(id: string, action: () => Promise<unknown>) {
    setActionId(id);
    setError(null);
    try {
      await action();
      await refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionId(null);
    }
  }

  const modeOptions: Array<{ value: TranslationMode; label: string; description: string }> = [
    {
      value: "remote-only",
      label: t("settings.translationModeRemoteOnly"),
      description: t("settings.translationModeRemoteOnlyDesc"),
    },
    {
      value: "offline-preferred",
      label: t("settings.translationModeOfflinePreferred"),
      description: t("settings.translationModeOfflinePreferredDesc"),
    },
    {
      value: "offline-only",
      label: t("settings.translationModeOfflineOnly"),
      description: t("settings.translationModeOfflineOnlyDesc"),
    },
  ];
  const selectedMode = modeOptions.find((option) => option.value === translationSettings.mode);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-8">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.translationTitle")}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t("settings.translationDescription")}
        </p>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Languages className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t("settings.translationServiceType")}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.translationServiceTypeHint")}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {modeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateTranslation({ mode: option.value })}
              className={`rounded-xl border p-3 text-left transition-colors ${
                translationSettings.mode === option.value
                  ? "border-primary/60 bg-primary/[0.06]"
                  : "border-border/70 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-sm font-medium">
                {option.label}
                {translationSettings.mode === option.value ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : null}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {option.description}
              </p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {selectedMode?.description ?? t("settings.translationModeRemoteOnlyDesc")}
        </p>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-medium">{t("settings.translationOfflineModels")}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.translationOfflineModelsHint")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actionId !== null}
            onClick={() => void runAction("import", () => importOfflineTranslationModel())}
          >
            {actionId === "import" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <File className="h-3.5 w-3.5" />
            )}
            {t("settings.translationImportGguf")}
          </Button>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("settings.translationSelectedLocalModel")}
          </div>
          <Select
            value={translationSettings.localModelId}
            onValueChange={(localModelId) => updateTranslation({ localModelId })}
          >
            <SelectTrigger>
              <SelectValue>
                {selectedLocalModel?.displayName ?? translationSettings.localModelId}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {localModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.displayName}{" "}
                  {model.installed ? "" : `· ${t("settings.translationNotInstalled")}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("settings.translationLoadingModels")}
          </div>
        ) : (
          <div className="mt-4 divide-y overflow-hidden rounded-xl border border-border/70">
            {localModels.map((model) => {
              const download = downloads.get(model.id);
              const activeDownload = download && ACTIVE_DOWNLOAD_PHASES.has(download.phase);
              const percent = downloadPercent(download);
              return (
                <div key={model.id} className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span>{model.displayName}</span>
                        {model.recommended ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                            {t("settings.translationRecommended")}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {model.source === "builtIn"
                            ? t("settings.translationBuiltInCatalog")
                            : t("settings.translationUserImport")}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatBytes(download?.totalBytes || model.sizeBytes)} · {model.fileName}
                        {model.licenseName ? ` · ${model.licenseName}` : ""}
                      </div>
                      {model.description ? (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {model.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      {activeDownload ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void runAction(`cancel:${model.id}`, () =>
                              cancelOfflineTranslationDownload(model.id),
                            )
                          }
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t("settings.translationCancelDownload")}
                        </Button>
                      ) : model.installed ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={actionId !== null || status.runtime.modelId === model.id}
                          onClick={() =>
                            void runAction(`delete:${model.id}`, async () => {
                              await deleteOfflineTranslationModel(model.id);
                              if (
                                model.source === "userImport" &&
                                translationSettings.localModelId === model.id
                              ) {
                                updateTranslation({
                                  localModelId: DEFAULT_OFFLINE_TRANSLATION_MODEL_ID,
                                });
                              }
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("settings.translationDeleteModel")}
                        </Button>
                      ) : model.downloadable ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={actionId !== null}
                          onClick={() =>
                            void runAction(`download:${model.id}`, () =>
                              startOfflineTranslationDownload(model.id),
                            )
                          }
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t("settings.translationDownload")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {activeDownload ? (
                    <div className="mt-3">
                      <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
                        <span>{t(`settings.translationDownloadPhase.${download.phase}`)}</span>
                        <span>{Math.round(percent)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  ) : download?.phase === "failed" ? (
                    <p className="mt-2 text-xs text-destructive">
                      {download.error || t("settings.translationDownloadFailed")}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {localModels.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                {t("settings.translationNoModels")}
              </div>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t("settings.translationImportHint")}
        </p>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm">
        <div className="font-medium">{t("settings.translationRemoteFallback")}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("settings.translationRemoteFallbackHint")}
        </p>
        <Select
          value={remoteValue}
          onValueChange={(value) =>
            setSettings((prev) =>
              updateCustomSettings(prev, {
                translationModel:
                  value === REMOTE_MODEL_FOLLOW_CURRENT
                    ? undefined
                    : (parseModelValue(value) ?? undefined),
              }),
            )
          }
        >
          <SelectTrigger className="mt-3">
            <SelectValue>{remoteLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={REMOTE_MODEL_FOLLOW_CURRENT}>
              {t("settings.translationRemoteFollowCurrent")}
            </SelectItem>
            {modelOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.providerName} / {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">{t("settings.translationRuntime")}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {!status.runtime.available
                ? status.runtime.message || t("settings.translationRuntimeUnavailable")
                : status.runtime.running
                  ? `${t("settings.translationRuntimeRunning")} · ${status.runtime.modelId ?? ""}`
                  : t("settings.translationRuntimeStopped")}
            </p>
          </div>
          {status.runtime.running ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runAction("stop", () => stopOfflineTranslationRuntime())}
            >
              {t("settings.translationStopRuntime")}
            </Button>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.05] px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
