import { createHash, randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { CalldataEncodable } from "genlayer-js-stable/types";
import { createAdjudicator, type Adjudicator } from "./genlayer.js";
import {
  stageForXp,
  earnedTraitsForXp,
  legacyEquipment,
  contributionAllowance,
  TRAIT_CATALOGUE_VERSION,
  PROGRESSION_POLICY_VERSION,
} from "@chog/evolution-rules";
import { processOneCapture } from "@chog/api/capture";
import { recordClaimEvent } from "@chog/api/events";
import { ownsProfile, type ClientFactory } from "@chog/api/config";
import { measureOperation, recordOperationalMetric } from "@chog/api/metrics";
import { composeDemoChog, artDataUri } from "@chog/art-composition";
import { processOneArtwork } from "./artwork.js";

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
const networkName = process.env.GENLAYER_NETWORK ?? "studionet";
const workerId = randomUUID();
const leaseMs = Math.max(
  30_000,
  Number(process.env.WORKER_LEASE_MS ?? 180_000),
);
const safeErrorCode = (error: unknown) =>
  error instanceof Error && /^[a-z][a-z0-9_]{0,100}$/.test(error.message)
    ? error.message
    : "worker_provider_unavailable";

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
      status: { $in: ["submitted", "awaiting_genlayer", "needs_review"] },
      $or: [{ lease_until: null }, { lease_until: { $lt: now } }],
      $and: [
        {
          $or: [
            { status: { $in: ["submitted", "awaiting_genlayer"] } },
            { reconciliation_requested: true },
          ],
        },
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
    Number(claim.current_attempt ?? 1) > 1
      ? db
          .collection<any>("claim_attempts")
          .findOne({ claim_id: claim._id, attempt: claim.current_attempt })
          .then((row) => row?.evidence)
      : db.collection<any>("evidence").findOne({ claim_id: claim._id }),
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
  const code = safeErrorCode(error);
  const uncertain =
    !item.claim.genlayer_tx_id &&
    (item.claim.reconciliation_requested ||
      item.claim.last_error_code === "submission_reference_unknown");
  const exhausted = count >= 8;
  const delay = Math.min(3_600_000, 1000 * 2 ** Math.min(count, 12));
  await db.collection<any>("claims").updateOne(
    { _id: item.claim._id, lease_token: item.claim.lease_token },
    {
      $set: {
        status:
          exhausted || uncertain
            ? "needs_review"
            : item.claim.genlayer_tx_id
              ? "awaiting_genlayer"
              : "submitted",
        lease_token: null,
        lease_until: null,
        next_attempt_at: exhausted ? null : new Date(now.getTime() + delay),
        last_error_code: uncertain ? "submission_reference_unknown" : code,
        reconciliation_requested: false,
        updated_at: now,
      },
      $inc: { failure_count: 1 },
    },
  );
  await recordClaimEvent(
    db,
    item.claim,
    "needs_review",
    uncertain
      ? "The submission still needs a finalized-state check. It has not been sent again."
      : exhausted
        ? "Automatic retries were exhausted; no reward was added."
        : "A temporary provider failure was saved for a later retry.",
    `retry:${count}`,
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

export function validateDecision(
  value: unknown,
  item: NonNullable<Awaited<ReturnType<typeof getClaim>>>,
): Decision {
  if (typeof value !== "object" || !value)
    throw new Error("genlayer_decision_malformed");
  const d = value as Decision;
  const identity = `${item.profile.chain_id}:${item.profile.collection_address.toLowerCase()}:${item.profile.token_id}`;
  if (
    d.claim_id !== (item.claim.contract_claim_id ?? item.claim._id) ||
    d.quest_id !== item.quest._id ||
    d.policy_version !== item.policy.version ||
    typeof d.evidence_hash !== "string" ||
    d.evidence_hash.toLowerCase() !==
      item.evidence.content_hash.toLowerCase() ||
    typeof d.claimant !== "string" ||
    d.claimant.toLowerCase() !== item.wallet.address.toLowerCase() ||
    d.profile_identity !== identity ||
    !["accepted", "rejected", "needs_review", "source_unavailable"].includes(
      d.outcome,
    ) ||
    typeof d.reason !== "string" ||
    !d.reason.trim() ||
    !Number.isSafeInteger(d.xp) ||
    d.xp < 0 ||
    d.xp > Number(item.policy.xp_reward) ||
    (d.outcome === "accepted" && d.xp !== Number(item.policy.xp_reward)) ||
    (d.outcome !== "accepted" && d.xp !== 0)
  )
    throw new Error("genlayer_decision_binding_invalid");
  return d;
}

export async function finalize(
  db: Db,
  item: NonNullable<Awaited<ReturnType<typeof getClaim>>>,
  decision: Decision,
  reference: string,
  options: { now?: Date; ownershipVerified?: boolean } = {},
) {
  decision = validateDecision(decision, item);
  const now = options.now ?? new Date();
  const session = db.client.startSession();
  try {
    await session.withTransaction(
      async () => {
        const claims = db.collection<any>("claims");
        const current = await claims.findOne(
          {
            _id: item.claim._id,
            lease_token: item.claim.lease_token,
            genlayer_tx_id: reference,
          },
          { session },
        );
        if (!current || current.status !== "awaiting_genlayer") return;
        const accepted = decision.outcome === "accepted";
        let amount = accepted
          ? Math.max(
              0,
              Math.min(Number(decision.xp), Number(item.policy.xp_reward)),
            )
          : 0;
        let rewardReason = accepted ? "awarded" : "not_accepted";
        const ownerProfile = await db
          .collection<any>("nft_profiles")
          .findOne({ _id: item.profile._id }, { session });
        if (
          accepted &&
          (options.ownershipVerified === false ||
            (ownerProfile?.owner_wallet_id &&
              ownerProfile.owner_wallet_id !== item.wallet._id))
        ) {
          amount = 0;
          rewardReason = "ownership_changed";
        }
        if (
          accepted &&
          amount > 0 &&
          item.policy.policy?.rewardPolicyVersion ===
            PROGRESSION_POLICY_VERSION &&
          item.policy.policy?.kind === "public_evidence"
        ) {
          // All claims for this wallet contend on one document inside the reward transaction.
          await db
            .collection<any>("wallets")
            .updateOne(
              { _id: item.wallet._id },
              { $inc: { reward_revision: 1 } },
              { session },
            );
          const dayStart = Date.parse(
            `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
          );
          const previous = await db
            .collection<any>("xp_ledger")
            .find(
              {
                wallet_id: item.wallet._id,
                reward_family: "contribution",
                created_at: { $gte: new Date(dayStart - 3600000) },
              },
              { session },
            )
            .sort({ created_at: -1 })
            .toArray();
          const allowance = contributionAllowance(
            previous.map((row: any) => ({
              amount: row.amount,
              createdAt: new Date(row.created_at),
            })),
            now,
            amount,
          );
          amount = allowance.amount;
          rewardReason = allowance.reasonCode;
        }
        await db.collection<any>("decisions").updateOne(
          { claim_id: item.claim._id },
          {
            $set: {
              claim_id: item.claim._id,
              outcome: decision.outcome,
              reason_code: decision.outcome,
              explanation: decision.reason.slice(0, 500),
              xp_award: amount,
              reward_reason_code: rewardReason,
              adjudication_attempt: current.current_attempt ?? 1,
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
              reconciliation_requested: false,
              last_error_code: null,
            },
          },
          { session },
        );
        await db
          .collection<any>("claim_attempts")
          .updateOne(
            { claim_id: current._id, attempt: current.current_attempt ?? 1 },
            {
              $set: {
                decision,
                decision_reference: reference,
                finalized_at: now,
              },
              $setOnInsert: { _id: randomUUID(), created_at: now },
            },
            { upsert: true, session },
          );
        await recordClaimEvent(
          db,
          current,
          decision.outcome,
          amount > 0
            ? `Finalized: ${amount} XP awarded.`
            : accepted
              ? `Finalized without XP: ${rewardReason}.`
              : decision.reason,
          "finalized",
          session,
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
                wallet_id: item.wallet._id,
                reward_family:
                  item.policy.policy?.kind === "public_evidence"
                    ? "contribution"
                    : (item.policy.policy?.kind ?? "legacy"),
                reward_policy_version:
                  item.policy.policy?.rewardPolicyVersion ?? 2,
                created_at: now,
              },
              { session },
            );
            // Re-read inside the transaction: another finalized claim can have
            // advanced the same profile since this worker acquired its lease.
            const currentProfile = await db
              .collection<any>("nft_profiles")
              .findOne({ _id: item.profile._id }, { session });
            if (!currentProfile) throw new Error("claim_profile_missing");
            const oldXp = Number(currentProfile.xp ?? 0);
            const total = oldXp + amount;
            const stage = stageForXp(total);
            const equipped =
              currentProfile.equipped_trait_ids ?? legacyEquipment(oldXp);
            const earned = earnedTraitsForXp(total);
            const before = {
              xp: oldXp,
              level: currentProfile.level ?? 1,
              stage: currentProfile.stage ?? stageForXp(oldXp),
              traits: currentProfile.traits ?? [],
              equippedTraitIds: equipped,
              artworkUrl:
                currentProfile.artwork_version === currentProfile.version
                  ? currentProfile.artwork_url
                  : Number(currentProfile.version ?? 0) === 0
                    ? artDataUri(
                        String(item.profile.token_id),
                        stageForXp(oldXp),
                        {
                          equippedTraitIds: equipped,
                          mode: item.profile.mode ?? "demo",
                        },
                      )
                    : null,
            };
            const eventId = randomUUID();
            const traits = composeDemoChog(
              String(item.profile.token_id),
              stage,
              { equippedTraitIds: equipped, mode: item.profile.mode ?? "demo" },
            ).traits.map((trait) => `${trait.name}: ${trait.value}`);
            const version = Number(currentProfile.version ?? 0) + 1;
            await db.collection<any>("nft_profiles").updateOne(
              { _id: item.profile._id },
              {
                $set: {
                  xp: total,
                  stage,
                  traits,
                  earned_trait_ids: earned,
                  equipped_trait_ids: equipped,
                  trait_catalogue_version: TRAIT_CATALOGUE_VERSION,
                  trait_unlock_provenance: [
                    ...(currentProfile.trait_unlock_provenance ?? []),
                    ...earned
                      .filter(
                        (id) =>
                          !(
                            currentProfile.earned_trait_ids ??
                            earnedTraitsForXp(oldXp)
                          ).includes(id),
                      )
                      .map((id) => ({
                        id,
                        claimId: current._id,
                        catalogueVersion: TRAIT_CATALOGUE_VERSION,
                      })),
                  ],
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
                  source_event_id: eventId,
                  kind: "claim",
                  profile_id: item.profile._id,
                  evolution_version: version,
                  snapshot: {
                    xp: total,
                    stage,
                    traits,
                    equippedTraitIds: equipped,
                    mode: item.profile.mode ?? "demo",
                    traitCatalogueVersion: TRAIT_CATALOGUE_VERSION,
                    level:
                      [
                        "hatchling",
                        "curious",
                        "explorer",
                        "veteran",
                        "legend",
                      ].indexOf(stage) + 1,
                  },
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
                _id: eventId,
                source_event_id: eventId,
                kind: "claim",
                profile_id: item.profile._id,
                actor_wallet_id: item.wallet._id,
                claim_id: item.claim._id,
                previous_version: version - 1,
                new_version: version,
                xp_total: total,
                changes: { xpAward: amount, stage },
                before,
                after: {
                  xp: total,
                  level:
                    [
                      "hatchling",
                      "curious",
                      "explorer",
                      "veteran",
                      "legend",
                    ].indexOf(stage) + 1,
                  stage,
                  traits,
                  equippedTraitIds: equipped,
                  artworkUrl: null,
                },
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
            request_id: current.request_id ?? reference,
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

export async function processOne(
  db: Db,
  client: Adjudicator | undefined,
  options: { factory?: ClientFactory } = {},
) {
  const item = await getClaim(db);
  if (!item) return false;
  const started = Date.now();
  let processFailed = false;
  const { claim, wallet, profile, policy, evidence } = item;
  if (!client) {
    await recordOperationalMetric(db, {
      kind: "job",
      name: "claim",
      operation: "process",
      outcome: "failure",
      durationMs: Date.now() - started,
    });
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
  let broadcastAttempted = false;
  try {
    const contractId = claim.contract_claim_id ?? claim._id;
    if (claim.reconciliation_requested && !claim.genlayer_tx_id) {
      const found = await measureOperation(
        db,
        { kind: "provider", name: "genlayer", operation: "read" },
        () => client.readDecision(contractId),
      );
      if (!found) {
        await db
          .collection<any>("claims")
          .updateOne(
            { _id: claim._id, lease_token: claim.lease_token },
            {
              $set: {
                status: "needs_review",
                last_error_code: "submission_reference_unknown",
                reconciliation_requested: false,
                lease_token: null,
                lease_until: null,
                updated_at: new Date(),
              },
            },
          );
        await recordClaimEvent(
          db,
          claim,
          "needs_review",
          "No finalized decision was found. The original submission may still be pending; it has not been sent again.",
          `reconciled:${claim.attempt_count}`,
        );
        return true;
      }
      const decision = validateDecision(found, item);
      const reference = `final-state:${process.env.GENLAYER_CONTRACT_ADDRESS ?? "adjudicator"}:${contractId}`;
      const changed = await db
        .collection<any>("claims")
        .updateOne(
          {
            _id: claim._id,
            lease_token: claim.lease_token,
            genlayer_tx_id: null,
          },
          { $set: { status: "awaiting_genlayer", genlayer_tx_id: reference } },
        );
      if (!changed.modifiedCount)
        throw new Error("claim_reconciliation_lease_lost");
      claim.genlayer_tx_id = reference;
      const owner = await ownsProfile(profile, wallet.address, options.factory);
      await finalize(db, item, decision, reference, {
        ownershipVerified: owner,
      });
      return true;
    }
    if (claim.genlayer_tx_id) {
      const finality = claim.genlayer_tx_id.startsWith("final-state:")
        ? "finalized"
        : await measureOperation(
            db,
            { kind: "provider", name: "genlayer", operation: "poll" },
            () => client.poll(claim.genlayer_tx_id),
          );
      if (finality === "pending") {
        await db.collection<any>("claims").updateOne(
          { _id: claim._id, lease_token: claim.lease_token },
          {
            $set: {
              status: "awaiting_genlayer",
              lease_token: null,
              lease_until: null,
              next_attempt_at: new Date(Date.now() + 15_000),
              updated_at: new Date(),
            },
          },
        );
        await recordClaimEvent(
          db,
          claim,
          "awaiting_genlayer",
          "GenLayer consensus is pending. XP is awarded only after finality.",
          "pending",
        );
        return true;
      }
      if (finality === "failed") {
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
          { _id: claim._id, lease_token: claim.lease_token },
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
        await recordClaimEvent(
          db,
          claim,
          "needs_review",
          "The GenLayer transaction failed. No XP was awarded.",
          "execution_failed",
        );
        return true;
      }
      const decision = validateDecision(
        await measureOperation(
          db,
          { kind: "provider", name: "genlayer", operation: "read" },
          () => client.readDecision(contractId),
        ),
        item,
      );
      const owner =
        decision.outcome !== "accepted" ||
        (await ownsProfile(profile, wallet.address, options.factory));
      await finalize(db, item, decision, claim.genlayer_tx_id, {
        ownershipVerified: owner,
      });
      return true;
    }
    const evidenceText = evidence.payload?.text;
    if (
      typeof evidenceText !== "string" ||
      sha256(evidenceText) !== evidence.content_hash
    )
      throw new Error("evidence_snapshot_hash_invalid");
    const rules = `${policy.policy.rules}\nOfficial quest reference: ${policy.source_url}`;
    // Validate the deployed contract's bounds before paying for a transaction.
    // Never truncate rules or a signed/content-hashed evidence snapshot.
    if (
      !policy.policy.rules ||
      rules.length > 4000 ||
      !Number.isSafeInteger(policy.version) ||
      policy.version < 1 ||
      !Number.isSafeInteger(policy.xp_reward) ||
      policy.xp_reward < 1 ||
      policy.xp_reward > 10_000 ||
      !evidenceText.length ||
      evidenceText.length > 20_000 ||
      typeof evidence.source_url !== "string" ||
      !evidence.source_url.startsWith("https://") ||
      evidence.source_url.length > 2048
    ) {
      throw new Error("genlayer_submission_bounds_invalid");
    }
    const args: CalldataEncodable[] = [
      contractId,
      wallet.address,
      `${profile.chain_id}:${profile.collection_address.toLowerCase()}:${profile.token_id}`,
      policy.version,
      claim.quest_id,
      rules,
      evidence.source_url,
      evidenceText,
      evidence.content_hash,
      policy.xp_reward,
    ];
    broadcastAttempted = true;
    const txHash = await measureOperation(
      db,
      { kind: "provider", name: "genlayer", operation: "submit" },
      () => client.submit(args),
    );
    // Preserve a received hash in memory even if the following DB write fails.
    // The recovery path must never send the same external transaction twice.
    claim.genlayer_tx_id = txHash;
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
          lease_token: null,
          lease_until: null,
          next_attempt_at: new Date(Date.now() + 15_000),
          updated_at: new Date(),
        },
      },
    );
    if (!saved.modifiedCount)
      throw new Error("claim_lease_lost_after_genlayer_submission");
    await db
      .collection<any>("claim_attempts")
      .updateOne(
        { claim_id: claim._id, attempt: claim.current_attempt ?? 1 },
        { $set: { decision_reference: txHash, submitted_at: new Date() } },
      );
    await recordClaimEvent(
      db,
      claim,
      "awaiting_genlayer",
      "Evidence submitted. Waiting for a finalized GenLayer decision.",
      "broadcast",
    );
    console.info(
      JSON.stringify({
        event: "claim_genlayer_submitted",
        claimId: claim._id,
        txId: txHash,
        requestId: claim.request_id ?? null,
      }),
    );
  } catch (error) {
    processFailed = true;
    if (broadcastAttempted && !claim.genlayer_tx_id) {
      await db.collection<any>("claims").updateOne(
        { _id: claim._id, lease_token: claim.lease_token },
        {
          $set: {
            status: "needs_review",
            last_error_code: "submission_reference_unknown",
            lease_token: null,
            lease_until: null,
            updated_at: new Date(),
          },
        },
      );
      await recordClaimEvent(
        db,
        claim,
        "needs_review",
        "The provider did not return a submission reference. Finalized state must be checked before any retry.",
        "submission_unknown",
      );
    } else {
      if (claim.genlayer_tx_id && broadcastAttempted) {
        await db.collection<any>("claims").updateOne(
          { _id: claim._id, lease_token: claim.lease_token },
          {
            $set: {
              genlayer_tx_id: claim.genlayer_tx_id,
              status: "awaiting_genlayer",
            },
          },
        );
      }
      await saveRetry(db, item, error);
    }
  } finally {
    await recordOperationalMetric(db, {
      kind: "job",
      name: "claim",
      operation: "process",
      outcome: processFailed ? "failure" : "success",
      durationMs: Date.now() - started,
      attempt: Number(claim.failure_count ?? 0) + 1,
    });
  }
  return true;
}

async function main() {
  if (!mongoUri) throw new Error("worker_mongodb_not_configured");
  const client = createAdjudicator();
  if (!client && process.env.NODE_ENV === "production")
    throw new Error("worker_genlayer_configuration_incomplete");
  const mongo = new MongoClient(mongoUri, {
    appName: "chog-evolution-worker",
    maxPoolSize: 4,
  });
  await mongo.connect();
  try {
    const db = mongo.db(databaseName || undefined);
    const once = process.argv.includes("--once");
    const batchSize = Math.min(
      25,
      Math.max(1, Number(process.env.WORKER_BATCH_SIZE) || 10),
    );
    const pollMs = Math.min(
      60_000,
      Math.max(1000, Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000),
    );
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      do {
        let capturesProcessed = 0;
        while (
          capturesProcessed < batchSize &&
          !controller.signal.aborted &&
          (await processOneCapture(db))
        )
          capturesProcessed++;
        let claimsProcessed = 0;
        while (
          claimsProcessed < batchSize &&
          !controller.signal.aborted &&
          (await processOne(db, client))
        )
          claimsProcessed++;
        const artworkProcessed = controller.signal.aborted
          ? false
          : await processOneArtwork(db);
        console.info(
          JSON.stringify({
            event: "worker_tick_finished",
            workerId,
            network: client ? networkName : "manual-review-only",
            claimsProcessed,
            capturesProcessed,
            artworkProcessed,
          }),
        );
        if (once || controller.signal.aborted) break;
        await delay(pollMs, undefined, { signal: controller.signal }).catch(
          (error: unknown) => {
            if (!controller.signal.aborted) throw error;
          },
        );
      } while (!controller.signal.aborted);
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    await mongo.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
