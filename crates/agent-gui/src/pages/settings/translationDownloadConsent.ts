import type { OfflineTranslationModel } from "../../lib/translation/tauri";

type TranslationDownloadConsentModel = Pick<
  OfflineTranslationModel,
  | "downloadLicenseAcceptanceRequired"
  | "downloadLicenseAcceptanceSatisfied"
  | "installed"
  | "source"
>;

export function requiresTranslationDownloadConsent(
  model: TranslationDownloadConsentModel,
): boolean {
  return (
    model.source === "builtIn" &&
    model.downloadLicenseAcceptanceRequired === true &&
    (!model.installed || model.downloadLicenseAcceptanceSatisfied !== true)
  );
}

const MODEL_COPY_KEYS: Record<string, { description: string; license: string }> = {
  "hy-mt1.5-1.8b-q4-k-m": {
    description: "settings.translationModelDescriptionHyMtQ4",
    license: "settings.translationModelLicenseHyMt",
  },
  "hy-mt1.5-1.8b-q8-0": {
    description: "settings.translationModelDescriptionHyMtQ8",
    license: "settings.translationModelLicenseHyMt",
  },
  "qwen3-0.6b-q8-0": {
    description: "settings.translationModelDescriptionQwen",
    license: "settings.translationModelLicenseQwen",
  },
};

export function translationModelDescriptionKey(
  modelId: string,
  source?: OfflineTranslationModel["source"],
): string | null {
  if (source === "userImport") return "settings.translationModelDescriptionUserImport";
  return MODEL_COPY_KEYS[modelId]?.description ?? null;
}

export function translationModelLicenseKey(
  modelId: string,
  source: OfflineTranslationModel["source"],
): string | null {
  if (source === "userImport") return "settings.translationModelLicenseUserImport";
  return MODEL_COPY_KEYS[modelId]?.license ?? null;
}

export function canStartLicensedTranslationDownload(
  accepted: boolean,
  busy: boolean,
  metadataReady = true,
): boolean {
  return accepted && !busy && metadataReady;
}

export function resolveDialogFocusWrap(
  focusableCount: number,
  activeIndex: number,
  backwards: boolean,
): number | null {
  if (focusableCount <= 0) return -1;
  if (activeIndex < 0) return backwards ? focusableCount - 1 : 0;
  if (backwards && activeIndex === 0) return focusableCount - 1;
  if (!backwards && activeIndex === focusableCount - 1) return 0;
  return null;
}

export function formatTranslationModelSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
  return `${Math.round(value / 1_000_000)} MB`;
}
