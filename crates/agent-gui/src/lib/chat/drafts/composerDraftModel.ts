import type {
  MentionComposerDraft,
  MentionComposerDraftSegment,
} from "../../../components/chat/MentionComposer";
import type { PendingUploadedFile } from "../messages/uploadedFiles";

export type ChatComposerDraftInput = {
  conversationId: string;
  workdir: string;
  draftJson: string;
  uploadedFilesJson: string;
  preview: string;
  updatedAt: number;
};

export type ChatComposerDraftWireRecord = ChatComposerDraftInput & {
  createdAt: number;
};

export type ChatComposerDraft = {
  conversationId: string;
  workdir: string;
  draft: MentionComposerDraft;
  uploadedFiles: PendingUploadedFile[];
  preview: string;
  createdAt: number;
  updatedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDraftSegment(value: unknown): value is MentionComposerDraftSegment {
  return isRecord(value) && typeof value.type === "string";
}

function parseMentionComposerDraft(value: unknown): MentionComposerDraft | null {
  if (!isRecord(value) || !Array.isArray(value.segments) || !value.segments.every(isDraftSegment)) {
    return null;
  }
  if (
    typeof value.text !== "string" ||
    typeof value.textWithoutLargePastes !== "string" ||
    typeof value.isEmpty !== "boolean" ||
    !Array.isArray(value.largePastes) ||
    !Array.isArray(value.skillMentions) ||
    !Array.isArray(value.commitMentions) ||
    !Array.isArray(value.gitFileMentions)
  ) {
    return null;
  }
  return value as MentionComposerDraft;
}

function parseUploadedFiles(value: unknown): PendingUploadedFile[] | null {
  if (!Array.isArray(value)) return null;
  const files: PendingUploadedFile[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.relativePath !== "string" ||
      typeof item.fileName !== "string" ||
      typeof item.kind !== "string" ||
      typeof item.sizeBytes !== "number"
    ) {
      return null;
    }
    files.push(item as PendingUploadedFile);
  }
  return files;
}

export function buildChatComposerDraftPreview(text: string, maxLength = 80) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, Math.max(1, maxLength)).join("");
}

export function createChatComposerDraftInput(
  conversationId: string,
  workdir: string,
  draft: MentionComposerDraft,
  uploadedFiles: PendingUploadedFile[],
  updatedAt = Date.now(),
): ChatComposerDraftInput {
  return {
    conversationId: conversationId.trim(),
    workdir: workdir.trim(),
    draftJson: JSON.stringify(draft),
    uploadedFilesJson: JSON.stringify(uploadedFiles),
    preview: buildChatComposerDraftPreview(draft.text),
    updatedAt,
  };
}

export function parseChatComposerDraftRecord(input: unknown): ChatComposerDraft | null {
  if (!isRecord(input)) return null;
  const conversationId =
    typeof input.conversationId === "string" ? input.conversationId.trim() : "";
  if (
    !conversationId ||
    typeof input.draftJson !== "string" ||
    typeof input.uploadedFilesJson !== "string"
  ) {
    return null;
  }
  try {
    const draft = parseMentionComposerDraft(JSON.parse(input.draftJson));
    const uploadedFiles = parseUploadedFiles(JSON.parse(input.uploadedFilesJson));
    if (!draft || !uploadedFiles) return null;
    return {
      conversationId,
      workdir: typeof input.workdir === "string" ? input.workdir : "",
      draft,
      uploadedFiles,
      preview: typeof input.preview === "string" ? input.preview : "",
      createdAt: typeof input.createdAt === "number" ? input.createdAt : 0,
      updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : 0,
    };
  } catch {
    return null;
  }
}
