import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const drafts = loader.loadModule("src/lib/chat/drafts/composerDraftModel.ts");

test("composer draft payload keeps rich text and attachment references", () => {
  const draft = {
    segments: [{ type: "text", text: "第一行\n第二行" }],
    text: "第一行\n第二行",
    textWithoutLargePastes: "第一行\n第二行",
    largePastes: [],
    skillMentions: [],
    commitMentions: [],
    gitFileMentions: [],
    isEmpty: false,
  };
  const files = [
    {
      relativePath: "notes.txt",
      fileName: "notes.txt",
      kind: "text",
      sizeBytes: 12,
    },
  ];
  const payload = drafts.createChatComposerDraftInput(
    "conv-1",
    "C:/work",
    draft,
    files,
    42
  );

  assert.equal(payload.conversationId, "conv-1");
  assert.equal(payload.preview, "第一行 第二行");
  assert.deepEqual(JSON.parse(payload.draftJson), draft);
  assert.deepEqual(JSON.parse(payload.uploadedFilesJson), files);
});

test("composer draft records reject invalid JSON and accept valid stored data", () => {
  assert.equal(
    drafts.parseChatComposerDraftRecord({
      conversationId: "conv-1",
      workdir: "",
      draftJson: "not-json",
      uploadedFilesJson: "[]",
      preview: "",
      createdAt: 1,
      updatedAt: 1,
    }),
    null
  );

  const parsed = drafts.parseChatComposerDraftRecord({
    conversationId: "conv-1",
    workdir: "C:/work",
    draftJson: JSON.stringify({
      segments: [],
      text: "hello",
      textWithoutLargePastes: "hello",
      largePastes: [],
      skillMentions: [],
      commitMentions: [],
      gitFileMentions: [],
      isEmpty: false,
    }),
    uploadedFilesJson: "[]",
    preview: "hello",
    createdAt: 1,
    updatedAt: 2,
  });
  assert.equal(parsed?.conversationId, "conv-1");
  assert.equal(parsed?.draft.text, "hello");
  assert.deepEqual(parsed?.uploadedFiles, []);
});
