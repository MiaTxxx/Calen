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

test("formatQuickAskHotkeyForDisplay localizes CmdOrCtrl for each platform", () => {
  assert.equal(
    settings.formatQuickAskHotkeyForDisplay("CmdOrCtrl+Shift+A", "windows"),
    "Ctrl+Shift+A"
  );
  assert.equal(
    settings.formatQuickAskHotkeyForDisplay("CmdOrCtrl+Shift+A", "linux"),
    "Ctrl+Shift+A"
  );
  assert.equal(
    settings.formatQuickAskHotkeyForDisplay("CmdOrCtrl+Shift+A", "macos"),
    "⌘+Shift+A"
  );
  assert.equal(
    settings.formatQuickAskHotkeyForDisplay("Control+Alt+Q", "windows"),
    "Ctrl+Alt+Q"
  );
});

test("normalizeQuickAskHotkeyInput maps display symbols back to parseable modifiers", () => {
  assert.equal(
    settings.normalizeQuickAskHotkeyInput("  ⌘+Shift+A  "),
    "Cmd+Shift+A"
  );
  assert.equal(
    settings.normalizeQuickAskHotkeyInput("Control+Shift+A"),
    "Ctrl+Shift+A"
  );
  assert.equal(settings.normalizeQuickAskHotkeyInput(""), "");
});
