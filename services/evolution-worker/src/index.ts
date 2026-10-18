import { createHash, randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { TransactionHashVariant } from "genlayer-js/types";
import type { CalldataEncodable, TransactionHash } from "genlayer-js/types";
import {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";
import { stageForXp } from "@chog/evolution-rules";
import { composeDemoChog } from "@chog/art-composition";
import { processOneArtwork } from "./artwork.js";

const networks = {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} as const;
type NetworkName = keyof typeof networks;
type Decision = {
  claim_id: string;
  claimant: string;
  profile_identity: string;
  policy_version: number;
  outcome: string;
  evidence_hash: string;
  quest_id: string;
  reason: string;
  xp: number;
};
const sha256 = (value: string) =>
  `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE;
const privateKey = process.env.GENLAYER_PRIVATE_KEY as
  `0x${string}` | undefined;
const contractAddress = process.env.GENLAYER_CONTRACT_ADDRESS as
  `0x${string}` | undefined;
const networkName = (process.env.GENLAYER_NETWORK ??
  "testnetBradbury") as NetworkName;
const network = networks[networkName];
const client =
  mongoUri && privateKey && contractAddress && network
    ? createClient({
        chain: {
          id: network.id,
          name: network.name,
          rpcUrls: network.rpcUrls,
          nativeCurrency: network.nativeCurrency,
        },
        ...(process.env.GENLAYER_RPC_URL
          ? { endpoint: process.env.GENLAYER_RPC_URL }
          : {}),
        account: createAccount(privateKey),
      })
    : undefined;
const workerId = randomUUID();
const leaseMs = Math.max(
  30_000,
  Number(process.env.WORKER_LEASE_MS ?? 180_000),
);

async function getClaim(db: Db) {
  const now = new Date();
  // If a worker died in the narrow interval after an external submit but before
  // persisting its transaction reference, never resubmit that claim blindly.
  await db.collection<any>("claims").updateMany(
    {
      status: "verifying",
      genlayer_tx_id: null,
      lease_until: { $lt: new Date(now.getTime() - 60_000) },
    },
    {
      $set: {
        status: "needs_review",
        lease_token: null,
        lease_until: null,
        last_error_code: "submission_reference_unknown",
        updated_at: now,
      },
    },
  );
  const token = randomUUID();
  const claim = await db.collection<any>("claims").findOneAndUpdate(
    {
      status: { $in: ["submitted", "awaiting_genlayer"] },
      $or: [{ lease_until: null }, { lease_until: { $lt: now } }],
      $and: [
        {
          $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
        },
      ],
    },
    [
      {
        $set: {
          lease_token: token,
          lease_until: new Date(now.getTime() + leaseMs),
          updated_at: now,
          status: {
            $cond: [
              { $eq: ["$genlayer_tx_id", null] },
              "verifying",
              "awaiting_genlayer",
            ],
          },
          attempt_count: { $add: [{ $ifNull: ["$attempt_count", 0] }, 1] },
        },
      },
    ],
    { sort: { created_at: 1 }, returnDocument: "after" },
  );
  if (!claim) return undefined;
  const [wallet, profile, policy, evidence, quest] = await Promise.all([
    db.collection<any>("wallets").findOne({ _id: claim.wallet_id }),
    db.collection<any>("nft_profiles").findOne({ _id: claim.profile_id }),
    db.collection<any>("quest_policies").findOne({ _id: claim.policy_id }),
    db.collection<any>("evidence").findOne({ claim_id: claim._id }),
    db.collection<any>("quests").findOne({ _id: claim.quest_id }),
  ]);
  if (!wallet || !profile || !policy || !evidence || !quest)
    throw new Error("claim_relations_missing");
  return { claim, wallet, profile, policy, evidence, quest };
}

async function saveRetry(
  db: Db,
  item: NonNullable<Awaited<ReturnType<typeof getClaim>>>,
  error: unknown,
) {
  const now = new Date();
  const count = Number(item.claim.failure_count ?? 0) + 1;
  const code =
    error instanceof Error ? error.message.slice(0, 120) : "worker_error";
  const exhausted = count >= 8;
  const delay = Math.min(3_600_000, 1000 * 2 ** Math.min(count, 12));
  await db.collection<any>("claims").updateOne(
    { _id: item.claim._id, lease_token: item.claim.lease_token },
    {
      $set: {
        status: exhausted
          ? "needs_review"
          : item.claim.genlayer_tx_id
            ? "awaiting_genlayer"
            : "submitted",
        lease_token: null,
        lease_until: null,
        next_attempt_at: exhausted ? null : new Date(now.getTime() + delay),
        last_error_code: code,
        updated_at: now,
      },
      $inc: { failure_count: 1 },
    },
  );
  await db.collection<any>("audit_events").insertOne({
    _id: randomUUID(),
    entity_type: "claim",
    entity_id: item.claim._id,
    action: exhausted ? "worker_retry_exhausted" : "worker_retry_scheduled",
    details: { code, failureCount: count },
    created_at: now,
  });
}

function validateDecision(
  value: unknown,
  item: NonNullable<Awaited<ReturnType<typeof getClaim>>>,
): Decision {
  if (typeof value !== "object" || !value)
    throw new Error("genlayer_decision_malformed");
  const d = value as Decision;
  const identity = `${item.profile.chain_id}:${item.profile.collection_address.toLowerCase()}:${item.profile.token_id}`;
  if (
    d.claim_id !== item.claim._id ||
    d.quest_id !== item.quest._id ||
    d.policy_version !== item.policy.version ||
    d.evidence_hash?.toLowerCase() !==
      item.evidence.content_hash.toLowerCase() ||
    d.claimant?.toLowerCase() !== item.wallet.address.toLowerCase() ||
    d.profile_identity !== identity ||
    !["accepted", "rejected", "needs_review", "source_unavailable"].includes(
      d.outcome,
    ) ||
    typeof d.reason !== "string" ||
    !Number.isSafeInteger(d.xp)
  )
    throw new Error("genlayer_decision_binding_invalid");
  return d;
}

async function finalize(
  db: Db,
  item: NonNullable<Awaited<ReturnType<typeof getClaim>>>,
  decision: Decision,
  reference: string,
) {
  const now = new Date();
  const session = db.client.startSession();
  try {
    await session.withTransaction(
      async () => {
        const claims = db.collection<any>("claims");
        const current = await claims.findOne(
          { _id: item.claim._id },
          { session },
        );
        if (!current || current.status !== "awaiting_genlayer") return;
        const accepted = decision.outcome === "accepted";
        const amount = accepted
          ? Math.max(
              0,
              Math.min(Number(decision.xp), Number(item.policy.xp_reward)),
            )
          : 0;
        await db.collection<any>("decisions").updateOne(
          { claim_id: item.claim._id },
          {
            $set: {
              claim_id: item.claim._id,
              outcome: decision.outcome,
              reason_code: decision.outcome,
              explanation: decision.reason.slice(0, 500),
              xp_award: amount,
              decision_reference: reference,
              finalized: true,
              payload: decision,
              finalized_at: now,
            },
          },
          { upsert: true, session },
        );
        await claims.updateOne(
          { _id: item.claim._id },
          {
            $set: {
              status: decision.outcome,
              finalized_at: now,
              lease_token: null,
              lease_until: null,
              updated_at: now,
            },
          },
          { session },
        );
        if (accepted && amount > 0) {
          const ledger = db.collection<any>("xp_ledger");
          const prior = await ledger.findOne(
            { claim_id: item.claim._id },
            { session },
          );
          if (!prior) {
            await ledger.insertOne(
              {
                _id: randomUUID(),
                profile_id: item.profile._id,
                claim_id: item.claim._id,
                amount,
                policy_id: item.policy._id,
                created_at: now,
              },
              { session },
            );
            const oldXp = Number(item.profile.xp ?? 0);
            const total = oldXp + amount;
            const stage = stageForXp(total);
            const traits = composeDemoChog(
              String(item.profile.token_id),
              stage,
            ).traits.map((trait) => `${trait.name}: ${trait.value}`);
            const version = Number(item.profile.version ?? 0) + 1;
            await db.collection<any>("nft_profiles").updateOne(
              { _id: item.profile._id },
              {
                $set: {
                  xp: total,
                  stage,
                  traits,
                  level:
                    [
                      "hatchling",
                      "curious",
                      "explorer",
                      "veteran",
                      "legend",
                    ].indexOf(stage) + 1,
                  version,
                  updated_at: now,
                },
              },
              { session },
            );
            await db.collection<any>("evolution_jobs").updateOne(
              { claim_id: item.claim._id },
              {
                $setOnInsert: {
                  _id: randomUUID(),
                  claim_id: item.claim._id,
                  profile_id: item.profile._id,
                  status: "queued",
                  attempts: 0,
                  created_at: now,
                  updated_at: now,
                },
              },
              { upsert: true, session },
            );
            await db.collection<any>("evolution_history").insertOne(
              {
                _id: randomUUID(),
                profile_id: item.profile._id,
                claim_id: item.claim._id,
                previous_version: version - 1,
                new_version: version,
                xp_total: total,
                changes: { xpAward: amount, stage },
                outcome: "accepted",
                finalized: true,
                decision_reference: reference,
                created_at: now,
              },
              { session },
            );
          }
        }
        await db.collection<any>("audit_events").insertOne(
          {
            _id: randomUUID(),
            entity_type: "claim",
            entity_id: item.claim._id,
            action: "finalized",
            request_id: reference,
            details: { outcome: decision.outcome, xpAward: amount },
            created_at: now,
          },
          { session },
        );
      },
      { writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
}

async function processOne(db: Db) {
  const item = await getClaim(db);
  if (!item) return false;
  const { claim, wallet, profile, policy, evidence } = item;
  if (!client || !contractAddress) {
    await db.collection<any>("claims").updateOne(
      { _id: claim._id, lease_token: claim.lease_token },
      {
        $set: {
          status: "needs_review",
          lease_token: null,
          lease_until: null,
          updated_at: new Date(),
        },
      },
    );
    await db.collection<any>("decisions").updateOne(
      { claim_id: claim._id },
      {
        $setOnInsert: {
          claim_id: claim._id,
          outcome: "needs_review",
          reason_code: "genlayer_unconfigured",
          explanation:
            "GenLayer integration is not configured; no XP was awarded.",
          xp_award: 0,
          finalized: false,
        },
      },
      { upsert: true },
    );
    return true;
  }
  try {
    if (claim.genlayer_tx_id) {
      const transaction = await client.waitForFinalization({
        hash: claim.genlayer_tx_id as TransactionHash,
        interval: 5000,
        retries: 2,
      });
      if (!isSuccessful(transaction)) {
        await db.collection<any>("decisions").updateOne(
          { claim_id: claim._id },
          {
            $set: {
              outcome: "needs_review",
              reason_code: "genlayer_execution_failed",
              explanation:
                "The GenLayer transaction finalized unsuccessfully; no XP was awarded.",
              xp_award: 0,
              decision_reference: claim.genlayer_tx_id,
              finalized: true,
              finalized_at: new Date(),
            },
          },
          { upsert: true },
        );
        await db.collection<any>("claims").updateOne(
          { _id: claim._id },
          {
            $set: {
              status: "needs_review",
              lease_token: null,
              lease_until: null,
              finalized_at: new Date(),
              updated_at: new Date(),
            },
          },
        );
        return true;
      }
      const raw = await client.readContract({
        address: contractAddress,
        functionName: "get_claim_decision",
        args: [claim._id],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      });
      const decision = validateDecision(JSON.parse(String(raw)), item);
      await finalize(db, item, decision, claim.genlayer_tx_id);
      return true;
    }
    const evidenceText = evidence.payload?.text;
    if (
      typeof evidenceText !== "string" ||
      sha256(evidenceText) !== evidence.content_hash
    )
      throw new Error("evidence_snapshot_hash_invalid");
    const args: CalldataEncodable[] = [
      claim._id,
      wallet.address,
      `${profile.chain_id}:${profile.collection_address.toLowerCase()}:${profile.token_id}`,
      policy.version,
      claim.quest_id,
      `${policy.policy.rules}\nOfficial quest reference: ${policy.source_url}`,
      evidence.source_url,
      evidenceText,
      evidence.content_hash,
      policy.xp_reward,
    ];
    const write = {
      address: contractAddress,
      functionName: "adjudicate",
      args,
    };
    const fees = await client.estimateTransactionFeesForWrite(write);
    const txHash = await client.writeContract({
      ...write,
      fees: { distribution: fees.distribution, feeValue: fees.feeValue },
    });
    const saved = await db.collection<any>("claims").updateOne(
      {
        _id: claim._id,
        lease_token: claim.lease_token,
        genlayer_tx_id: null,
      },
      {
        $set: {
          genlayer_tx_id: String(txHash),
          status: "awaiting_genlayer",
          lease_until: new Date(Date.now() + leaseMs),
          updated_at: new Date(),
        },
      },
    );
    if (!saved.modifiedCount)
      throw new Error("claim_lease_lost_after_genlayer_submission");
    console.info(
      JSON.stringify({
        event: "claim_genlayer_submitted",
        claimId: claim._id,
        txId: txHash,
      }),
    );
  } catch (error) {
    await saveRetry(db, item, error);
  }
  return true;
}

async function main() {
  if (!mongoUri) throw new Error("worker_mongodb_not_configured");
  if (!client && process.env.NODE_ENV === "production")
    throw new Error("worker_genlayer_configuration_incomplete");
  const mongo = new MongoClient(mongoUri, {
    appName: "chog-evolution-worker",
    maxPoolSize: 4,
  });
  await mongo.connect();
  try {
    const db = mongo.db(databaseName || undefined);
    const claimProcessed = await processOne(db);
    const artworkProcessed = await processOneArtwork(db);
    console.info(
      JSON.stringify({
        event: "worker_tick_finished",
        workerId,
        network: client ? networkName : "manual-review-only",
        claimProcessed,
        artworkProcessed,
      }),
    );
  } finally {
    await mongo.close();
  }
}

if (process.env.NODE_ENV !== "test") await main();
