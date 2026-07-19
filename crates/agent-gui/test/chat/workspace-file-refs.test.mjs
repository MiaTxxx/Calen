import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const {
  looksLikeWorkspaceFileRef,
  normalizeWorkspaceFileRef,
  extractWorkspaceFileRefAt,
} = loader.loadModule("src/lib/chat/messages/workspaceFileRefs.ts");

test("normalizeWorkspaceFileRef strips quotes and whitespace", () => {
  assert.equal(
    normalizeWorkspaceFileRef('  "weather-ios18.html"  '),
    "weather-ios18.html"
  );
  assert.equal(normalizeWorkspaceFileRef("`src/app.ts`"), "src/app.ts");
});

test("looksLikeWorkspaceFileRef accepts file names and paths", () => {
  assert.equal(looksLikeWorkspaceFileRef("weather-ios18.html"), true);
  assert.equal(looksLikeWorkspaceFileRef("src/pages/index.tsx"), true);
  assert.equal(looksLikeWorkspaceFileRef("D:\\repo\\a.ts"), true);
  assert.equal(looksLikeWorkspaceFileRef("./demo/weather-ios18.html"), true);
});

test("looksLikeWorkspaceFileRef rejects ordinary code tokens", () => {
  assert.equal(looksLikeWorkspaceFileRef("const"), false);
  assert.equal(looksLikeWorkspaceFileRef("npm"), false);
  assert.equal(looksLikeWorkspaceFileRef("v1.2.3"), false);
  assert.equal(looksLikeWorkspaceFileRef("https://example.com"), false);
  assert.equal(looksLikeWorkspaceFileRef("foo bar.ts"), false);
});

test("extractWorkspaceFileRefAt finds filename under caret in plain Chinese sentence", () => {
  const text = "直接双击 weather-ios18.html 即可在浏览器体验完整动画与交互。";
  const offset = text.indexOf("weather-ios18.html") + 3;
  assert.equal(extractWorkspaceFileRefAt(text, offset), "weather-ios18.html");
  assert.equal(extractWorkspaceFileRefAt(text, 0), null);
});
