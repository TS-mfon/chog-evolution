import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyProgression, stageForXp, validateXpAward } from "../src/index.js";

test("matches the planned progression thresholds", () => {
  assert.equal(stageForXp(0), "hatchling");
  assert.equal(stageForXp(49), "hatchling");
  assert.equal(stageForXp(50), "curious");
  assert.equal(stageForXp(150), "explorer");
  assert.equal(stageForXp(350), "veteran");
  assert.equal(stageForXp(700), "legend");
});

test("awards progression once and returns newly crossed stages", () => {
  assert.deepEqual(applyProgression(45, 110, 150), {
    previousXp: 45,
    totalXp: 155,
    previousStage: "hatchling",
    stage: "explorer",
    unlockedStages: ["curious", "explorer"],
    nextStage: "veteran",
    xpToNextStage: 195,
  });
});

test("rejects XP beyond policy caps and unsafe totals", () => {
  assert.equal(validateXpAward(151, 150), false);
  assert.equal(validateXpAward(10, 0), false);
  assert.throws(() => applyProgression(Number.MAX_SAFE_INTEGER, 1, 1), RangeError);
  assert.throws(() => applyProgression(0, 0, 100), RangeError);
});
