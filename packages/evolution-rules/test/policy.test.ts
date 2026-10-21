import test from "node:test";
import assert from "node:assert/strict";
import {
  contributionAllowance,
  earnedTraitsForXp,
  validateEquipment,
} from "../src/index.js";

test("earned slots enforce thresholds, replacement and removal without changing identity", () => {
  assert.deepEqual(earnedTraitsForXp(149), ["bright-eyes"]);
  assert.deepEqual(validateEquipment(350, ["star-crown"]), ["star-crown"]);
  assert.deepEqual(validateEquipment(700, []), []);
  for (const ids of [
    ["star-crown"],
    ["unknown"],
    ["bright-eyes"],
    ["trail-scarf", "star-crown"],
    ["trail-scarf", "trail-scarf"],
  ])
    assert.throws(() => validateEquipment(150, ids));
  assert.throws(() => earnedTraitsForXp(-1));
});

test("daily contribution budget and midnight cooldown are independent of profile and timezone", () => {
  const previous = [
    { amount: 75, createdAt: new Date("2026-10-20T23:30:00Z") },
  ];
  assert.equal(
    contributionAllowance(previous, new Date("2026-10-20T23:59:59Z"))
      .reasonCode,
    "daily_cap",
  );
  assert.equal(
    contributionAllowance(previous, new Date("2026-10-21T00:29:59Z"))
      .reasonCode,
    "cooldown",
  );
  assert.equal(
    contributionAllowance(previous, new Date("2026-10-21T00:30:00Z")).amount,
    75,
  );
  assert.equal(
    contributionAllowance(
      [{ amount: 0, createdAt: new Date("2026-10-21T00:30:00Z") }],
      new Date("2026-10-21T00:30:01Z"),
    ).amount,
    75,
  );
  assert.throws(() => contributionAllowance([], new Date(), 76));
});
