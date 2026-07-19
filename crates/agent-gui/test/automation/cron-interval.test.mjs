import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { intervalToCronExpression, parseIntervalFromCronExpression } =
  loader.loadModule("src/lib/automation/cronInterval.ts");

test("intervalToCronExpression maps minutes/hours/days to six-field cron", () => {
  assert.equal(
    intervalToCronExpression({ value: 15, unit: "minutes" }),
    "0 */15 * * * *"
  );
  assert.equal(
    intervalToCronExpression({ value: 2, unit: "hours" }),
    "0 0 */2 * * *"
  );
  assert.equal(
    intervalToCronExpression({ value: 3, unit: "days" }),
    "0 0 0 */3 * *"
  );
});

test("parseIntervalFromCronExpression reverses generated expressions", () => {
  assert.deepEqual(parseIntervalFromCronExpression("0 */15 * * * *"), {
    value: 15,
    unit: "minutes",
  });
  assert.deepEqual(parseIntervalFromCronExpression("0 0 */2 * * *"), {
    value: 2,
    unit: "hours",
  });
  assert.deepEqual(parseIntervalFromCronExpression("0 0 0 */3 * *"), {
    value: 3,
    unit: "days",
  });
});

test("parseIntervalFromCronExpression returns null for hand-written cron", () => {
  assert.equal(parseIntervalFromCronExpression("0 0 9 * * 1-5"), null);
  assert.equal(parseIntervalFromCronExpression("* * * * *"), null);
  assert.equal(parseIntervalFromCronExpression(""), null);
});

test("intervalToCronExpression rejects invalid values", () => {
  assert.throws(() => intervalToCronExpression({ value: 0, unit: "minutes" }));
  assert.throws(() => intervalToCronExpression({ value: 1.5, unit: "hours" }));
});
