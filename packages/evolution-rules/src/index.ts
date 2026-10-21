export const STAGE_THRESHOLDS = [
  { stage: "hatchling", minXp: 0 },
  { stage: "curious", minXp: 50 },
  { stage: "explorer", minXp: 150 },
  { stage: "veteran", minXp: 350 },
  { stage: "legend", minXp: 700 },
] as const;

export type EvolutionStage = (typeof STAGE_THRESHOLDS)[number]["stage"];

export const PROGRESSION_POLICY_VERSION = 3;
export const TRAIT_CATALOGUE_VERSION = 1;
export const TRAIT_CATALOGUE = [
  {
    id: "bright-eyes",
    name: "Bright eyes",
    slot: "eyes",
    minXp: 50,
    removable: false,
  },
  {
    id: "trail-scarf",
    name: "Trail scarf",
    slot: "accessory",
    minXp: 150,
    removable: true,
  },
  {
    id: "star-crown",
    name: "Star crown",
    slot: "accessory",
    minXp: 350,
    removable: true,
  },
  {
    id: "comet-glow",
    name: "Comet glow",
    slot: "aura",
    minXp: 700,
    removable: true,
  },
] as const;

export function earnedTraitsForXp(xp: number): string[] {
  stageForXp(xp);
  return TRAIT_CATALOGUE.filter((trait) => xp >= trait.minXp).map(
    (trait) => trait.id,
  );
}

/** Only optional, earned slots can be equipped. Body identity and eyes are stage features. */
export function validateEquipment(xp: number, value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 2 ||
    value.some((id) => typeof id !== "string") ||
    new Set(value).size !== value.length
  )
    throw new RangeError("Invalid equipped trait list");
  const earned = new Set(earnedTraitsForXp(xp));
  const slots = new Set<string>();
  for (const id of value) {
    const trait = TRAIT_CATALOGUE.find((item) => item.id === id);
    if (!trait || !trait.removable || !earned.has(id) || slots.has(trait.slot))
      throw new RangeError("Trait is locked or conflicts with its slot");
    slots.add(trait.slot);
  }
  return [...value].sort();
}

export function legacyEquipment(xp: number): string[] {
  return [
    ...(xp >= 350 ? ["star-crown"] : xp >= 150 ? ["trail-scarf"] : []),
    ...(xp >= 700 ? ["comet-glow"] : []),
  ];
}

export function contributionAllowance(
  previous: { amount: number; createdAt: Date }[],
  now: Date,
  requested = 75,
) {
  if (
    !Number.isSafeInteger(requested) ||
    requested < 0 ||
    requested > 75 ||
    !Number.isFinite(now.getTime())
  )
    throw new RangeError("Invalid reward inputs");
  const day = now.toISOString().slice(0, 10);
  const awarded = previous.filter((row) => row.amount > 0);
  const total = awarded
    .filter((row) => row.createdAt.toISOString().slice(0, 10) === day)
    .reduce((sum, row) => sum + row.amount, 0);
  const latest = Math.max(
    -Infinity,
    ...awarded.map((row) => row.createdAt.getTime()),
  );
  if (total > 0)
    return {
      amount: 0,
      reasonCode: "daily_cap",
      nextEligibleAt: new Date(
        Math.max(
          Date.parse(`${day}T00:00:00.000Z`) + 86400000,
          latest + 3600000,
        ),
      ).toISOString(),
    };
  if (now.getTime() - latest < 3600000)
    return {
      amount: 0,
      reasonCode: "cooldown",
      nextEligibleAt: new Date(latest + 3600000).toISOString(),
    };
  return {
    amount: Math.min(requested, 75 - total),
    reasonCode: "awarded",
    nextEligibleAt: null,
  };
}

export function stageForXp(xp: number): EvolutionStage {
  if (!Number.isSafeInteger(xp) || xp < 0)
    throw new RangeError("XP must be a non-negative safe integer");
  return [...STAGE_THRESHOLDS].reverse().find(({ minXp }) => xp >= minXp)!
    .stage;
}

export function validateXpAward(xp: number, questCap: number): boolean {
  return (
    Number.isSafeInteger(xp) &&
    xp > 0 &&
    Number.isSafeInteger(questCap) &&
    questCap > 0 &&
    xp <= questCap
  );
}

export type ProgressionResult = {
  previousXp: number;
  totalXp: number;
  previousStage: EvolutionStage;
  stage: EvolutionStage;
  unlockedStages: EvolutionStage[];
  nextStage: EvolutionStage | null;
  xpToNextStage: number;
};

export function applyProgression(
  currentXp: number,
  award: number,
  questCap: number,
): ProgressionResult {
  if (!Number.isSafeInteger(currentXp) || currentXp < 0)
    throw new RangeError("Current XP must be a non-negative safe integer");
  if (!validateXpAward(award, questCap))
    throw new RangeError("Award must be positive and within the quest cap");
  const totalXp = currentXp + award;
  if (!Number.isSafeInteger(totalXp))
    throw new RangeError("Total XP exceeds the safe integer range");
  const previousStage = stageForXp(currentXp);
  const stage = stageForXp(totalXp);
  const unlockedStages = STAGE_THRESHOLDS.filter(
    ({ minXp }) => minXp > currentXp && minXp <= totalXp,
  ).map(({ stage: unlocked }) => unlocked);
  const next = STAGE_THRESHOLDS.find(({ minXp }) => minXp > totalXp);
  return {
    previousXp: currentXp,
    totalXp,
    previousStage,
    stage,
    unlockedStages,
    nextStage: next?.stage ?? null,
    xpToNextStage: next ? next.minXp - totalXp : 0,
  };
}
