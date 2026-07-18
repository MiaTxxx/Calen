import { invoke } from "@tauri-apps/api/core";

export const TRANSLATION_COMMANDS = {
  catalogList: "translation_catalog_list",
  status: "translation_status",
  downloadStart: "translation_download_start",
  downloadStatus: "translation_download_status",
  downloadCancel: "translation_download_cancel",
  importModel: "translation_import",
  deleteModel: "translation_delete",
  translate: "translation_translate",
  stop: "translation_stop",
} as const;

export type OfflineTranslationModelSource = "builtIn" | "userImport";

export type OfflineTranslationModel = {
  id: string;
  displayName: string;
  description?: string;
  source: OfflineTranslationModelSource;
  inferenceProfile?: "qwen3" | "hy-mt" | "generic";
  licenseName?: string;
  licenseUrl?: string;
  sourceUrl?: string;
  revision?: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  installed: boolean;
  recommended: boolean;
  downloadable: boolean;
};

export type OfflineTranslationDownloadPhase =
  | "queued"
  | "downloading"
  | "verifying"
  | "completed"
  | "cancelled"
  | "failed";

export type OfflineTranslationDownload = {
  modelId: string;
  phase: OfflineTranslationDownloadPhase;
  bytesDownloaded: number;
  totalBytes: number;
  resumed: boolean;
  error?: string;
};

export type OfflineTranslationRuntime = {
  available: boolean;
  running: boolean;
  modelId?: string;
  message?: string;
};

export type OfflineTranslationStatus = {
  models: OfflineTranslationModel[];
  downloads: OfflineTranslationDownload[];
  runtime: OfflineTranslationRuntime;
};

export type OfflineTranslationResult = {
  text: string;
  modelId: string;
  elapsedMs: number;
};

function normalizeTranslationInvokeError(error: unknown): Error & { code?: string } {
  if (error instanceof Error) return error;
  if (typeof error === "string") {
    const matched = /^([a-z][A-Za-z]+):\s*(.*)$/.exec(error.trim());
    if (matched) {
      return Object.assign(new Error(matched[2] || error), { code: matched[1] });
    }
    return new Error(error);
  }
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    const message = typeof value.message === "string" ? value.message : String(error);
    const normalized = new Error(message);
    if (typeof value.code === "string") Object.assign(normalized, { code: value.code });
    return normalized;
  }
  return new Error(String(error ?? "Offline translation failed"));
}

export async function listOfflineTranslationModels(): Promise<OfflineTranslationModel[]> {
  const catalog = await invoke<{ models: OfflineTranslationModel[] }>(
    TRANSLATION_COMMANDS.catalogList,
  );
  return Array.isArray(catalog?.models) ? catalog.models : [];
}

export async function getOfflineTranslationStatus(): Promise<OfflineTranslationStatus> {
  const status = await invoke<OfflineTranslationStatus>(TRANSLATION_COMMANDS.status);
  return {
    models: Array.isArray(status?.models) ? status.models : [],
    downloads: Array.isArray(status?.downloads) ? status.downloads : [],
    runtime: status?.runtime ?? { available: false, running: false },
  };
}

export function startOfflineTranslationDownload(
  modelId: string,
): Promise<OfflineTranslationDownload> {
  return invoke(TRANSLATION_COMMANDS.downloadStart, { modelId });
}

export function getOfflineTranslationDownload(
  modelId: string,
): Promise<OfflineTranslationDownload> {
  return invoke(TRANSLATION_COMMANDS.downloadStatus, { modelId });
}

export function cancelOfflineTranslationDownload(
  modelId: string,
): Promise<OfflineTranslationDownload> {
  return invoke(TRANSLATION_COMMANDS.downloadCancel, { modelId });
}

export function importOfflineTranslationModel(
  displayName?: string,
): Promise<OfflineTranslationModel> {
  return invoke(TRANSLATION_COMMANDS.importModel, { displayName });
}

export function deleteOfflineTranslationModel(modelId: string): Promise<void> {
  return invoke(TRANSLATION_COMMANDS.deleteModel, { modelId });
}

export function stopOfflineTranslationRuntime(): Promise<OfflineTranslationRuntime> {
  return invoke(TRANSLATION_COMMANDS.stop);
}

export async function translateWithOfflineModel(input: {
  modelId: string;
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  timeoutMs?: number;
}): Promise<OfflineTranslationResult> {
  try {
    return await invoke(TRANSLATION_COMMANDS.translate, input);
  } catch (error) {
    throw normalizeTranslationInvokeError(error);
  }
}
