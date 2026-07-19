import { invoke } from "@tauri-apps/api/core";
import type { PendingUploadedFile } from "../messages/uploadedFiles";

import type { ChatComposerDraftInput, ChatComposerDraftWireRecord } from "./composerDraftModel";

export function listChatComposerDrafts() {
  return invoke<ChatComposerDraftWireRecord[]>("chat_composer_draft_list");
}

export function getChatComposerDraft(conversationId: string) {
  return invoke<ChatComposerDraftWireRecord | null>("chat_composer_draft_get", {
    conversationId,
  });
}

export function upsertChatComposerDraft(input: ChatComposerDraftInput) {
  return invoke<ChatComposerDraftWireRecord>("chat_composer_draft_upsert", { input });
}

export function deleteChatComposerDraft(conversationId: string) {
  return invoke<void>("chat_composer_draft_delete", { conversationId });
}

export function clearChatComposerDrafts() {
  return invoke<void>("chat_composer_draft_clear");
}

export async function filterExistingChatComposerDraftAttachments(
  workdir: string,
  files: PendingUploadedFile[],
): Promise<PendingUploadedFile[]> {
  if (!workdir.trim() || files.length === 0) return files;
  const validIndexes = await invoke<number[]>("system_validate_uploaded_file_references", {
    workdir,
    files: files.map((file) => ({
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
    })),
  });
  const valid = new Set(validIndexes);
  return files.filter((_, index) => valid.has(index));
}
