export type NftIdentity = {
  mode: "demo" | "original_companion";
  chainId: number;
  collectionAddress: `0x${string}`;
  tokenId: string;
};

export type ClaimStatus =
  | "submitted"
  | "verifying"
  | "awaiting_genlayer"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "source_unavailable"
  | "unresolved";

export type DecisionOutcome = "accepted" | "rejected" | "needs_review" | "source_unavailable";

export type EvidenceReference = {
  kind: "transaction" | "url" | "text" | "manual_review";
  value: string;
  contentHash?: `0x${string}`;
  capturedAt: string;
};

export type QuestSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "active" | "paused" | "inactive";
  verificationMethod: "onchain" | "public_evidence" | "manual" | "hybrid";
  xpReward: number;
  startsAt?: string;
  endsAt?: string;
};

export type EvolutionProfile = {
  nft: NftIdentity;
  displayName: string;
  xp: number;
  level: number;
  stage: "hatchling" | "curious" | "explorer" | "veteran" | "legend";
  traits: string[];
  imageUrl?: string;
  version: number;
};

export type AdjudicationDecision = {
  outcome: DecisionOutcome;
  reasonCode: string;
  explanation: string;
  questId: string;
  evidenceHash: `0x${string}`;
  xpAward: number;
  decisionReference?: string;
  finalized: boolean;
};

export type LocalDemoScenario = {
  id: string;
  outcome: "accepted" | "rejected" | "pending";
  simulated: true;
  stateKind: "local_simulation";
  duplicate?: boolean;
  profile: { id: string; xp: number; level: number; stage: string; version: number };
  claim: { id: string; status: "accepted" | "rejected" | "verifying" };
  evolution: { status: "simulated" | "not_awarded" | "pending"; xpAward: number };
};
