export const STAGE_THRESHOLDS = [
  { stage: "hatchling", minXp: 0 },
  { stage: "curious", minXp: 50 },
  { stage: "explorer", minXp: 150 },
  { stage: "veteran", minXp: 350 },
  { stage: "legend", minXp: 700 },
] as const;

export type EvolutionStage = (typeof STAGE_THRESHOLDS)[number]["stage"];

export function stageForXp(xp: number): EvolutionStage {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new RangeError("XP must be a non-negative safe integer");
  return [...STAGE_THRESHOLDS].reverse().find(({ minXp }) => xp >= minXp)!.stage;
}

export function validateXpAward(xp: number, questCap: number): boolean {
  return Number.isSafeInteger(xp) && xp > 0 && Number.isSafeInteger(questCap) && questCap > 0 && xp <= questCap;
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

export function applyProgression(currentXp: number, award: number, questCap: number): ProgressionResult {
  if (!Number.isSafeInteger(currentXp) || currentXp < 0) throw new RangeError("Current XP must be a non-negative safe integer");
  if (!validateXpAward(award, questCap)) throw new RangeError("Award must be positive and within the quest cap");
  const totalXp = currentXp + award;
  if (!Number.isSafeInteger(totalXp)) throw new RangeError("Total XP exceeds the safe integer range");
  const previousStage = stageForXp(currentXp);
  const stage = stageForXp(totalXp);
  const unlockedStages = STAGE_THRESHOLDS.filter(({ minXp }) => minXp > currentXp && minXp <= totalXp).map(({ stage: unlocked }) => unlocked);
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
