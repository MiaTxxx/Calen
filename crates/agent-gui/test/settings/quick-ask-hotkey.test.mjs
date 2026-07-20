import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");

test("quickAskHotkey defaults when missing and preserves explicit empty (disabled)", () => {
  assert.equal(
    settings.normalizeSystemSettings({}).quickAskHotkey,
    settings.DEFAULT_QUICK_ASK_HOTKEY
  );
  // 显式空字符串表示用户禁用了快捷键，归一化不得改回默认值。
  assert.equal(
    settings.normalizeSystemSettings({ quickAskHotkey: "" }).quickAskHotkey,
    ""
  );
  assert.equal(
    settings.normalizeSystemSettings({ quickAskHotkey: "  Alt+Q  " })
      .quickAskHotkey,
    "Alt+Q"
  );
  assert.equal(
    settings.normalizeSystemSettings({ quickAskHotkey: 42 }).quickAskHotkey,
    settings.DEFAULT_QUICK_ASK_HOTKEY
  );
});
