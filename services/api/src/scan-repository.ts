import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";

export type ScanCheckpoint = { targets: Record<string, number> };
export type ScanCoverage = {
  mode: "recent_transactions" | "configured_events";
  fromBlock: string | null;
  toBlock: string | null;
  fromTime: string | null;
  toTime: string | null;
  latestFinalizedBlock: string;
  hasMore: boolean;
};
export type ScanTarget = {
  chainId: number;
  address: `0x${string}`;
  topic0: `0x${string}`;
  walletTopicIndex: 1 | 2 | 3;
  startBlock: number;
  name: string;
  questSlug?: string;
  explorerTxBase?: string;
};
export function scanTargetKey(target: ScanTarget) {
  return `${target.address.toLowerCase()}:${target.topic0.toLowerCase()}:${target.walletTopicIndex}`;
}

export type ActivityProof = {
  chain_id: number;
  wallet: string;
  transaction_hash: string;
  block_hash: string;
  block_number: string;
  block_timestamp: number;
  transaction_from: string;
  transaction_to: string | null;
  transaction_nonce: number;
  value_wei: string;
  input: string;
  receipt_status: "success";
  confirmations_required: number;
  interaction_type: "contract_call" | "configured_contract_event";
  target_name: string;
  target_address: string;
  event_topic?: string;
  event_wallet_topic?: number;
  log_index: number;
  verified_at: string;
  destination_code_hash: string | null;
};

export class MongoScanRepository {
  constructor(private readonly db: Db) {}

  async latestCheckpoint(
    walletId: string,
    chainId: number,
  ): Promise<ScanCheckpoint> {
    const row = await this.db
      .collection<any>("scan_jobs")
      .find({
        wallet_id: walletId,
        chain_id: chainId,
        status: { $in: ["complete", "partial", "failed"] },
        checkpoint_version: 2,
      })
      .sort({ updated_at: -1 })
      .limit(1)
      .next();
    return row?.checkpoint ?? { targets: {} };
  }

  async start(
    walletId: string,
    profileId: string,
    chainId: number,
    checkpoint: ScanCheckpoint,
  ) {
    const jobs = this.db.collection<any>("scan_jobs");
    const now = new Date();
    await jobs.updateMany(
      {
        wallet_id: walletId,
        chain_id: chainId,
        status: "running",
        updated_at: { $lt: new Date(now.getTime() - 90_000) },
      },
      {
        $set: {
          status: "failed",
          last_error_code: "scan_lease_expired",
          completed_at: now,
          updated_at: now,
        },
      },
    );
    const id = randomUUID();
    await jobs.insertOne({
      _id: id,
      wallet_id: walletId,
      profile_id: profileId,
      chain_id: chainId,
      status: "running",
      checkpoint_version: 2,
      checkpoint,
      attempts: 0,
      updated_at: now,
      created_at: now,
      last_error_code: null,
      claim_ids: [],
    });
    return id;
  }

  async saveCheckpoint(
    jobId: string,
    checkpoint: ScanCheckpoint,
    status: "running" | "partial" | "complete" | "failed",
    errorCode?: string,
  ) {
    const now = new Date();
    await this.db.collection<any>("scan_jobs").updateOne(
      { _id: jobId },
      {
        $set: {
          checkpoint,
          status,
          updated_at: now,
          completed_at: status === "running" ? null : now,
          last_error_code: errorCode ?? null,
        },
        $inc: { attempts: 1 },
      },
    );
  }

  async saveCoverage(jobId: string, coverage: ScanCoverage) {
    await this.db
      .collection<any>("scan_jobs")
      .updateOne({ _id: jobId }, { $set: { coverage } });
  }

  async saveCandidate(
    jobId: string,
    profileId: string,
    walletId: string,
    proof: ActivityProof,
    questSlug: string,
    explorer: string,
  ) {
    const dedupeKey = `${walletId}:${proof.chain_id}:${proof.transaction_hash.toLowerCase()}:${proof.log_index}`;
    await this.db.collection<any>("scan_events").updateOne(
      { dedupe_key: dedupeKey },
      {
        $setOnInsert: {
          _id: randomUUID(),
          dedupe_key: dedupeKey,
          scan_job_id: jobId,
          wallet_id: walletId,
          profile_id: profileId,
          chain_id: proof.chain_id,
          target_address: proof.target_address,
          target_name: proof.target_name,
          quest_slug: questSlug,
          tx_hash: proof.transaction_hash.toLowerCase(),
          log_index: proof.log_index,
          block_number: proof.block_number,
          block_number_sort: Number(proof.block_number),
          tx_url: `${explorer.replace(/\/$/, "")}/tx/${proof.transaction_hash}`,
          observed_at: new Date(),
          verified_proof: proof,
        },
        $addToSet: { scan_job_ids: jobId },
      },
      { upsert: true },
    );
  }

  async pendingEvents(walletId: string, chainId: number) {
    return this.db
      .collection<any>("scan_events")
      .find({
        wallet_id: walletId,
        chain_id: chainId,
        verified_proof: { $exists: true },
        claim_id: { $exists: false },
      })
      .sort({ block_number_sort: 1 })
      .limit(12)
      .toArray();
  }

  async attachClaim(jobId: string, eventId: string, claimId: string) {
    await this.db
      .collection<any>("scan_events")
      .updateOne(
        { _id: eventId },
        { $set: { claim_id: claimId }, $unset: { review_error_code: "" } },
      );
    await this.db
      .collection<any>("scan_jobs")
      .updateOne({ _id: jobId }, { $addToSet: { claim_ids: claimId } });
  }

  async reviewError(eventId: string, errorCode: string) {
    await this.db
      .collection<any>("scan_events")
      .updateOne({ _id: eventId }, { $set: { review_error_code: errorCode } });
  }

  async getForWallet(jobId: string, walletId: string) {
    const job = await this.db
      .collection<any>("scan_jobs")
      .findOne({ _id: jobId, wallet_id: walletId });
    if (!job) return null;
    const events = await this.db
      .collection<any>("scan_events")
      .find({
        wallet_id: walletId,
        $or: [{ scan_job_ids: jobId }, { scan_job_id: jobId }],
      })
      .sort({ block_number_sort: -1, log_index: -1 })
      .limit(200)
      .toArray();
    return {
      id: String(job._id),
      profileId: String(job.profile_id),
      chainId: job.chain_id,
      status: job.status,
      checkpoint: job.checkpoint,
      updatedAt: new Date(job.updated_at).toISOString(),
      createdAt: new Date(job.created_at).toISOString(),
      coverage: job.coverage ?? null,
      lastErrorCode: job.last_error_code,
      errorCode: job.last_error_code,
      claimIds: job.claim_ids ?? [],
      events: events.map((event) => ({
        id: String(event._id),
        targetName: event.target_name,
        questSlug: event.quest_slug,
        txHash: event.tx_hash,
        blockNumber: event.block_number,
        transactionUrl: event.tx_url,
        observedAt: new Date(event.observed_at).toISOString(),
        claimId: event.claim_id ?? null,
        reviewErrorCode: event.review_error_code ?? null,
      })),
      candidateOnly: true as const,
    };
  }
}

export function parseScanTargets(raw: string | undefined): ScanTarget[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 10)
    throw new Error("invalid_scan_targets_configuration");
  const targets = parsed.map((item): ScanTarget => {
    if (typeof item !== "object" || item === null)
      throw new Error("invalid_scan_targets_configuration");
    const row = item as Record<string, unknown>;
    const {
      chainId,
      address,
      topic0,
      walletTopicIndex,
      startBlock,
      name,
      questSlug,
      explorerTxBase,
    } = row;
    if (
      typeof chainId !== "number" ||
      !Number.isSafeInteger(chainId) ||
      chainId <= 0 ||
      typeof address !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(address) ||
      typeof topic0 !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(topic0) ||
      ![1, 2, 3].includes(walletTopicIndex as number) ||
      typeof startBlock !== "number" ||
      !Number.isSafeInteger(startBlock) ||
      startBlock < 0 ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80 ||
      (questSlug !== undefined &&
        (typeof questSlug !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(questSlug))) ||
      (explorerTxBase !== undefined &&
        (typeof explorerTxBase !== "string" ||
          !/^https:\/\//.test(explorerTxBase)))
    )
      throw new Error("invalid_scan_targets_configuration");
    return {
      chainId,
      address: address as `0x${string}`,
      topic0: topic0 as `0x${string}`,
      walletTopicIndex: walletTopicIndex as 1 | 2 | 3,
      startBlock,
      name,
      ...(questSlug ? { questSlug } : {}),
      ...(explorerTxBase ? { explorerTxBase } : {}),
    };
  });
  if (
    new Set(
      targets.map((target) => `${target.chainId}:${scanTargetKey(target)}`),
    ).size !== targets.length
  )
    throw new Error("duplicate_scan_target_address");
  return targets;
}
