import type { MentionComposerDraft } from "@/components/chat/MentionComposer";
import type { PendingUploadedFile } from "@/lib/chat/uploadedFiles";

export type WebComposerDraftRecord = {
  conversationId: string;
  workdir: string;
  draft: MentionComposerDraft;
  uploadedFiles: PendingUploadedFile[];
  preview: string;
  createdAt: number;
  updatedAt: number;
};

export type WebComposerDraftStore = {
  list(): Promise<WebComposerDraftRecord[]>;
  get(conversationId: string): Promise<WebComposerDraftRecord | null>;
  upsert(record: Omit<WebComposerDraftRecord, "createdAt">): Promise<WebComposerDraftRecord>;
  delete(conversationId: string): Promise<void>;
  clear(): Promise<void>;
};

const DATABASE_NAME = "calen-chat-drafts";
const STORE_NAME = "composerDrafts";

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "conversationId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open draft database"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft database request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Draft transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Draft transaction aborted"));
  });
}

export function normalizeWebComposerDraftRecord(value: unknown): WebComposerDraftRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WebComposerDraftRecord>;
  const conversationId =
    typeof record.conversationId === "string" ? record.conversationId.trim() : "";
  if (
    !conversationId ||
    !record.draft ||
    typeof record.draft !== "object" ||
    !Array.isArray(record.draft.segments) ||
    !Array.isArray(record.uploadedFiles)
  ) {
    return null;
  }
  return {
    conversationId,
    workdir: typeof record.workdir === "string" ? record.workdir : "",
    draft: record.draft,
    uploadedFiles: record.uploadedFiles,
    preview: typeof record.preview === "string" ? record.preview : "",
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

export function createIndexedDbComposerDraftStore(
  factory: IDBFactory = globalThis.indexedDB,
): WebComposerDraftStore {
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = () => (databasePromise ??= openDatabase(factory));

  return {
    async list() {
      const db = await database();
      const values = await requestResult(
        db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll(),
      );
      return values
        .map(normalizeWebComposerDraftRecord)
        .filter((item): item is WebComposerDraftRecord => item !== null)
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async get(conversationId) {
      const key = conversationId.trim();
      if (!key) return null;
      const db = await database();
      return normalizeWebComposerDraftRecord(
        await requestResult(
          db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
        ),
      );
    },
    async upsert(record) {
      const key = record.conversationId.trim();
      if (!key) throw new Error("conversationId is required");
      const db = await database();
      const existing = normalizeWebComposerDraftRecord(
        await requestResult(
          db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
        ),
      );
      const next: WebComposerDraftRecord = {
        ...record,
        conversationId: key,
        createdAt: existing?.createdAt || record.updatedAt,
      };
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(next);
      await transactionComplete(transaction);
      return next;
    },
    async delete(conversationId) {
      const key = conversationId.trim();
      if (!key) return;
      const db = await database();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      await transactionComplete(transaction);
    },
    async clear() {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      await transactionComplete(transaction);
    },
  };
}

export function buildWebComposerDraftPreview(text: string, maxLength = 80): string {
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, Math.max(1, maxLength)).join("");
}
