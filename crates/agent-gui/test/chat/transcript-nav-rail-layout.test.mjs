import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const guiRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function reactMock(stateValues = []) {
  let stateIndex = 0;
  return {
    memo(component) {
      return component;
    },
    useCallback(callback) {
      return callback;
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      return factory();
    },
    useRef(value) {
      return { current: value };
    },
    useState(initialValue) {
      const value =
        stateIndex < stateValues.length
          ? stateValues[stateIndex]
          : initialValue;
      stateIndex += 1;
      return [value, () => {}];
    },
  };
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    walk(child, visit);
  }
}

test("message navigation renders on the left and expands into the chat surface", () => {
  const i18nPath = path.join(guiRoot, "src/i18n/index.ts");
  const navLoader = createTsModuleLoader({
    mocks: {
      react: reactMock([0, true]),
      [i18nPath]: {
        useLocale() {
          return { locale: "zh-CN", t: (key) => key };
        },
      },
    },
  });
  const { TranscriptNavRail } = navLoader.loadModule(
    "src/pages/chat/transcript/TranscriptNavRail.tsx"
  );
  const rail = TranscriptNavRail({
    entries: [
      {
        id: "u1",
        rowIndex: 0,
        anchor: null,
        fraction: 0,
        kind: "user",
        excerpt: "一",
      },
      {
        id: "a1",
        rowIndex: 1,
        anchor: null,
        fraction: 0,
        kind: "assistant",
        excerpt: "二",
      },
      {
        id: "u2",
        rowIndex: 2,
        anchor: null,
        fraction: 0,
        kind: "user",
        excerpt: "三",
      },
    ],
    viewport: null,
    resolveEntryTop: () => null,
    onJump() {},
  });

  let tickClass = "";
  let flyoutClass = "";
  walk(rail, (node) => {
    const className =
      typeof node.props?.className === "string" ? node.props.className : "";
    if (className.includes("max-h-[60vh]")) tickClass = className;
    if (className.includes("w-72")) flyoutClass = className;
  });
  assert.match(tickClass, /items-start/);
  assert.doesNotMatch(tickClass, /items-end/);
  assert.match(flyoutClass, /left-full/);
  assert.match(flyoutClass, /ml-1/);
  assert.doesNotMatch(flyoutClass, /right-full|mr-1/);

  const chatTranscriptPath = path.join(
    guiRoot,
    "src/pages/chat/transcript/ChatTranscript.tsx"
  );
  const chatLoader = createTsModuleLoader({
    mocks: {
      react: reactMock(),
      [i18nPath]: { useLocale: () => ({ locale: "zh-CN" }) },
      [path.join(guiRoot, "src/components/icons.tsx")]: {
        ChevronDown() {},
        Copy() {},
      },
      [path.join(guiRoot, "src/components/ui/scroll-area.tsx")]: {
        ScrollArea() {},
      },
      [path.join(guiRoot, "src/lib/chat-scroll/scrollFollowCore.ts")]: {
        BOTTOM_REATTACH_ZONE_PX: 96,
      },
      [path.join(guiRoot, "src/lib/chat-scroll/useScrollFollow.ts")]: {
        useScrollFollow() {
          return {
            following: true,
            handle: {
              detachForNavigation() {},
              jumpToBottom() {},
              stickToBottom() {},
            },
          };
        },
      },
      [path.join(guiRoot, "src/pages/chat/transcript/ChatEmptyState.tsx")]: {
        ChatEmptyState() {},
      },
      [path.join(guiRoot, "src/pages/chat/transcript/TranscriptList.tsx")]: {
        TranscriptList() {},
      },
      [path.join(
        guiRoot,
        "src/pages/chat/transcript/TranscriptLoadingStates.tsx"
      )]: {
        HistorySwitchLoadingOverlay() {},
      },
      [path.join(guiRoot, "src/pages/chat/transcript/transcriptUtils.ts")]: {
        clampTranscriptContextMenuPosition() {
          return null;
        },
        resolveTranscriptSelectionText() {
          return "";
        },
        writeTextToClipboard() {},
      },
    },
  });
  const { ChatTranscript } = chatLoader.loadModule(chatTranscriptPath);
  const transcript = ChatTranscript({
    conversationId: "conversation",
    workspaceRoot: "C:/workspace",
    gitClient: null,
    followRef: { current: null },
    hasModels: true,
    historyItems: [],
    isHistorySwitching: false,
    isSending: false,
    isAgentMode: false,
    showUsage: false,
    liveTranscriptStore: {},
    isCompactionRunning: false,
    onResendFromEdit() {},
    onOpenSettings() {},
    onSuggestionSelect() {},
  });

  let overlayClass = "";
  walk(transcript, (node) => {
    const className =
      typeof node.props?.className === "string" ? node.props.className : "";
    if (className.includes("pointer-events-none absolute inset-y-0")) {
      overlayClass = className;
    }
  });
  assert.match(overlayClass, /left-2\.5/);
  assert.match(overlayClass, /items-start/);
  assert.doesNotMatch(overlayClass, /right-2\.5|items-end/);
});
