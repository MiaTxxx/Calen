import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { intervalToCronExpression, parseIntervalFromCronExpression } =
  loader.loadModule("src/lib/automation/cronInterval.ts");

test("intervalToCronExpression maps minutes/hours/days to fixed-duration schedules", () => {
  assert.equal(
    intervalToCronExpression({ value: 15, unit: "minutes" }),
    "@every 15m"
  );
  assert.equal(
    intervalToCronExpression({ value: 2, unit: "hours" }),
    "@every 2h"
  );
  assert.equal(
    intervalToCronExpression({ value: 3, unit: "days" }),
    "@every 3d"
  );
});

test("parseIntervalFromCronExpression reverses generated expressions", () => {
  assert.deepEqual(parseIntervalFromCronExpression("@every 15m"), {
    value: 15,
    unit: "minutes",
  });
  assert.deepEqual(parseIntervalFromCronExpression("@every 2h"), {
    value: 2,
    unit: "hours",
  });
  assert.deepEqual(parseIntervalFromCronExpression("@every 3d"), {
    value: 3,
    unit: "days",
  });
});

test("parseIntervalFromCronExpression recognizes legacy generated cron", () => {
  assert.deepEqual(parseIntervalFromCronExpression("0 */90 * * * *"), {
    value: 90,
    unit: "minutes",
  });
  assert.deepEqual(parseIntervalFromCronExpression("0 0 */25 * * *"), {
    value: 25,
    unit: "hours",
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
  assert.throws(() => intervalToCronExpression({ value: 1000, unit: "days" }));
});
