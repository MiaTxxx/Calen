import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { ComposerDraftWriteQueue } = loader.loadModule(
  "src/lib/chat/drafts/composerDraftWriteQueue.ts"
);

test("composer draft writes stay ordered for the same conversation", async () => {
  const queue = new ComposerDraftWriteQueue();
  const operations = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue("conv-1", async () => {
    await firstGate;
    operations.push("upsert");
  });
  const second = queue.enqueue("conv-1", async () => {
    operations.push("delete");
  });

  await Promise.resolve();
  assert.deepEqual(operations, []);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(operations, ["upsert", "delete"]);
});

test("composer draft writes for different conversations do not block each other", async () => {
  const queue = new ComposerDraftWriteQueue();
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue("conv-1", () => firstGate);
  let secondCompleted = false;
  await queue.enqueue("conv-2", async () => {
    secondCompleted = true;
  });

  assert.equal(secondCompleted, true);
  releaseFirst();
  await first;
});
