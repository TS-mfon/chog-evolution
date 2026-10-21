export type Profile = {
  id: string;
  nft: {
    mode: "demo" | "original_companion";
    chainId: number;
    collectionAddress: string;
    tokenId: string;
  };
  displayName: string;
  xp: number;
  level: number;
  stage: string;
  traits: string[];
  earnedTraitIds?: string[];
  equippedTraitIds?: string[];
  traitCatalogueVersion?: number;
  originalMetadata?: {
    name?: string;
    description?: string;
    imageUrl?: string;
    tokenUri?: string;
    fetchedAt?: string;
  };
  originalMetadataStatus?: "ready" | "unavailable";
  originalMetadataErrorCode?: string | null;
  originalMetadataAttemptedAt?: string | null;
  version: number;
  artworkUrl?: string;
  artworkVersion?: number | null;
  artworkPending?: boolean;
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Quest = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status?: string;
  kind?: string;
  verificationMethod?: string;
  xpReward: number;
  allowedEvidenceHosts?: string[];
  sourceUrl?: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type Claim = {
  id: string;
  profileId?: string;
  questId?: string;
  questSlug?: string;
  questName?: string;
  status: string;
  xpAward?: number;
  finalized?: boolean;
  outcome?: string | null;
  explanation?: string | null;
  reasonCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
  evidenceUrl?: string | null;
  evidenceHash?: string | null;
  decisionReference?: string | null;
  decisionUrl?: string | null;
  attempt?: number;
  canRetry?: boolean;
  errorCode?: string | null;
  nextEligibleAt?: string | null;
  source?: EvidenceSource | null;
  media?: SourceMedia[];
  timeline?: ClaimTimelineEvent[];
};

export type ClaimTimelineEvent = {
  id: string;
  status: string;
  createdAt: string;
  description?: string | null;
  attempt?: number;
  decisionReference?: string | null;
};

export type SourceMedia = {
  mediaId?: string;
  sourceUrl?: string;
  url?: string;
  status?: string;
  errorCode?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  sha256?: string;
};

// Previously saved snapshots use snake_case. Read either version without
// replacing historical evidence with a fresh source fetch.
export type EvidenceSource = {
  provider: string;
  canonicalUrl?: string;
  canonical_url?: string;
  fetchedAt?: string;
  fetched_at?: string;
  contentHash?: string;
  content_hash?: string;
  publicContent?: Record<string, unknown>;
  public_content?: Record<string, unknown>;
  media?: SourceMedia[];
};

export type EvidencePreview = {
  id: string;
  profileId?: string;
  questId?: string;
  claimId?: string | null;
  status: string;
  source?: EvidenceSource | null;
  media?: SourceMedia[];
  eligibility: {
    eligible: boolean;
    reasonCode?: string | null;
    message?: string;
    nextEligibleAt?: string | null;
    rewardXp?: number;
    claimId?: string;
  };
  errorCode?: string | null;
  expiresAt: string;
};

export type Trait = {
  id: string;
  name: string;
  slot: string;
  minXp: number;
  removable: boolean;
};

export type Page<T> = { items: T[]; nextCursor?: string | null };

export type ChainConfig = {
  chainId: number;
  collectionAddress?: string | null;
  rpcUrl?: string | null;
  explorerUrl?: string | null;
};

export type AppConfig = {
  demo: ChainConfig;
  mainnet: ChainConfig;
  features: { xLink: boolean; scans: boolean; evidence: boolean };
};

export type XLink = { username: string; verifiedAt: string };

export type ScanEvent = {
  id?: string;
  targetName: string;
  questSlug?: string | null;
  transactionUrl?: string | null;
  txHash?: string;
  blockNumber?: string;
  claimId?: string | null;
  reviewErrorCode?: string | null;
};

export type Scan = {
  id: string;
  status: string;
  events: ScanEvent[];
  claims?: Claim[];
  errorCode?: string | null;
  coverage?: {
    fromTime?: string | null;
    toTime?: string | null;
    mode: "recent_transactions" | "configured_events";
    hasMore?: boolean;
  };
};

export type Activity = {
  id: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  profileId?: string;
  xpAward?: number;
  description?: string;
  transactionUrl?: string;
  claimId?: string | null;
};

// Older passports used database field names. Both shapes are read so existing
// finalized history remains visible when the API is upgraded.
export type EvolutionEvent = {
  id: string;
  kind?: "claim" | "trait_change";
  claimId?: string;
  claim_id?: string;
  before?: EvolutionSnapshot | null;
  after?: EvolutionSnapshot | null;
  previousVersion?: number;
  previous_version?: number;
  newVersion?: number;
  new_version?: number;
  xpTotal?: number;
  xp_total?: number;
  changes?: { xpAward?: number; xp_award?: number; stage?: string };
  createdAt: string;
  questSlug?: string;
  quest_slug?: string;
  questName?: string;
  explanation?: string;
  outcome: string;
  artworkUrl?: string | null;
  evidenceUrl?: string | null;
  evidence_url?: string | null;
};

export type EvolutionSnapshot = {
  xp: number;
  level: number;
  stage: string;
  traits?: string[];
  equippedTraitIds?: string[];
  artworkUrl?: string | null;
};

export type Passport = {
  profile: Profile;
  history: EvolutionEvent[];
  nextCursor?: string | null;
};

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
};

export type WalletOption = {
  id: string;
  name: string;
  provider: EthereumProvider;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
