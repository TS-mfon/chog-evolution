/** Explicitly simulated repository contract used only by local walkthrough tests. */
export type ScenarioOutcome = "accepted" | "rejected" | "pending";
export type ScenarioRecord = {
  id: string;
  outcome: ScenarioOutcome;
  simulated: true;
  stateKind: "local_simulation";
  createdAt: string;
  profile: {
    id: string;
    xp: number;
    level: number;
    stage: string;
    version: number;
  };
  claim: { id: string; status: "accepted" | "rejected" | "verifying" };
  evolution: {
    status: "simulated" | "not_awarded" | "pending";
    xpAward: number;
  };
};

export interface ScenarioRepository {
  createOrGet(
    key: string,
    outcome: ScenarioOutcome,
  ): Promise<{ record: ScenarioRecord; duplicate: boolean }>;
  get(id: string): Promise<ScenarioRecord | undefined>;
}
