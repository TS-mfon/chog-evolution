import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";

export type ScanCheckpoint = { targets: Record<string, number> };
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

export class MongoScanRepository {
  constructor(private readonly db: Db) {}

  async latestCheckpoint(profileId: string): Promise<ScanCheckpoint> {
    const row = await this.db
      .collection<any>("scan_jobs")
      .find({
        profile_id: profileId,
        $or: [
          { status: { $in: ["complete", "partial", "failed"] } },
          {
            status: "running",
            updated_at: { $lt: new Date(Date.now() - 5 * 60_000) },
          },
        ],
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
        profile_id: profileId,
        status: "running",
        updated_at: { $lt: new Date(now.getTime() - 5 * 60_000) },
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
      checkpoint,
      attempts: 0,
      updated_at: now,
      created_at: now,
      last_error_code: null,
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

  async saveEvents(
    jobId: string,
    profileId: string,
    chainId: number,
    target: ScanTarget,
    walletTopic: `0x${string}`,
    logs: {
      blockNumber: bigint;
      transactionHash: `0x${string}`;
      logIndex: number;
      topics: readonly (`0x${string}` | null)[];
    }[],
  ) {
    if (!logs.length) return;
    const operations = logs.flatMap((log) => {
      if (
        !log.transactionHash ||
        log.logIndex === null ||
        log.topics[target.walletTopicIndex]?.toLowerCase() !==
          walletTopic.toLowerCase()
      )
        return [];
      const txUrl = target.explorerTxBase
        ? `${target.explorerTxBase.replace(/\/$/, "")}/tx/${log.transactionHash}`
        : null;
      return [
        {
          updateOne: {
            filter: {
              profile_id: profileId,
              chain_id: chainId,
              tx_hash: log.transactionHash.toLowerCase(),
              log_index: log.logIndex,
            },
            update: {
              $setOnInsert: {
                _id: randomUUID(),
                scan_job_id: jobId,
                profile_id: profileId,
                chain_id: chainId,
                target_address: target.address.toLowerCase(),
                target_name: target.name,
                quest_slug: target.questSlug ?? null,
                tx_hash: log.transactionHash.toLowerCase(),
                log_index: log.logIndex,
                block_number: log.blockNumber.toString(),
                matched_wallet_topic: target.walletTopicIndex,
                topics: log.topics,
                tx_url: txUrl,
                observed_at: new Date(),
              },
            },
            upsert: true,
          },
        },
      ];
    });
    if (operations.length)
      await this.db
        .collection<any>("scan_events")
        .bulkWrite(operations, { ordered: false });
  }

  async getForWallet(jobId: string, walletId: string) {
    const job = await this.db
      .collection<any>("scan_jobs")
      .findOne({ _id: jobId, wallet_id: walletId });
    if (!job) return null;
    const events = await this.db
      .collection<any>("scan_events")
      .find({ scan_job_id: jobId })
      .sort({ block_number: -1, log_index: -1 })
      .limit(200)
      .toArray();
    return {
      id: job._id,
      status: job.status,
      checkpoint: job.checkpoint,
      updatedAt: job.updated_at.toISOString(),
      lastErrorCode: job.last_error_code,
      errorCode: job.last_error_code,
      events: events.map((event) => ({
        targetName: event.target_name,
        questSlug: event.quest_slug,
        txHash: event.tx_hash,
        blockNumber: event.block_number,
        transactionUrl: event.tx_url,
        observedAt: event.observed_at.toISOString(),
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
      targets.map(
        (target) => `${target.chainId}:${target.address.toLowerCase()}`,
      ),
    ).size !== targets.length
  )
    throw new Error("duplicate_scan_target_address");
  return targets;
}
