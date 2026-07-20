import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const selection = loader.loadModule("src/lib/quick-ask/selection.ts");

test("normalizeSelectionRect handles drags in any direction", () => {
  assert.deepEqual(
    selection.normalizeSelectionRect({
      startX: 100,
      startY: 80,
      endX: 40,
      endY: 20,
    }),
    { x: 40, y: 20, width: 60, height: 60 }
  );
  assert.deepEqual(
    selection.normalizeSelectionRect({
      startX: 10,
      startY: 10,
      endX: 30,
      endY: 50,
    }),
    { x: 10, y: 10, width: 20, height: 40 }
  );
});

test("isSelectionMeaningful rejects click-sized boxes", () => {
  assert.equal(
    selection.isSelectionMeaningful({ x: 0, y: 0, width: 2, height: 30 }),
    false
  );
  assert.equal(
    selection.isSelectionMeaningful({ x: 0, y: 0, width: 8, height: 8 }),
    true
  );
});

test("toImageSelection scales viewport CSS px into image physical px", () => {
  // 2x DPI：视口 960x540，截图 1920x1080。
  assert.deepEqual(
    selection.toImageSelection(
      { x: 10, y: 20, width: 100, height: 50 },
      { width: 960, height: 540 },
      { width: 1920, height: 1080 }
    ),
    { x: 20, y: 40, width: 200, height: 100 }
  );
});

test("toImageSelection clamps to image bounds and keeps at least 1px", () => {
  const clamped = selection.toImageSelection(
    { x: 950, y: 530, width: 100, height: 100 },
    { width: 960, height: 540 },
    { width: 1920, height: 1080 }
  );
  assert.ok(clamped.x + clamped.width <= 1920);
  assert.ok(clamped.y + clamped.height <= 1080);
  assert.ok(clamped.width >= 1);
  assert.ok(clamped.height >= 1);
});
