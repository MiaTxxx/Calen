import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const taskbar = loader.loadModule("src/lib/platform/windowsTaskbarActivity.ts");

test("taskbar activity only applies state edges and clears on dispose", async () => {
  const states = [];
  const controller = taskbar.createWindowsTaskbarActivityController({
    apply: async (active) => states.push(active),
  });

  controller.setActive(false);
  controller.setActive(true);
  controller.setActive(true);
  controller.setActive(false);
  controller.setActive(false);
  controller.setActive(true);
  controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(states, [true, false, true, false]);
});

test("taskbar activity reports API failures without rejecting later updates", async () => {
  const states = [];
  const errors = [];
  const controller = taskbar.createWindowsTaskbarActivityController({
    apply: async (active) => {
      states.push(active);
      if (active) throw new Error("unsupported");
    },
    onError: (error) => errors.push(error.message),
  });

  controller.setActive(true);
  controller.setActive(false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(states, [true, false]);
  assert.deepEqual(errors, ["unsupported"]);
});
