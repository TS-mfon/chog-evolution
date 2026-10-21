import { parsePage, pageQuery, paginateRows } from "./pagination.js";
import { recordClaimEvent } from "./claim-events.js";
import { PROGRESSION_POLICY_VERSION } from "@chog/evolution-rules";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";

export type QuestPolicyInput = {
  slug: string;
  name: string;
  description: string;
  status: "active" | "paused" | "inactive";
  sourceUrl: string;
  rules: string;
  xpReward: number;
  verificationMethod: "public_evidence" | "manual" | "hybrid";
  allowedEvidenceHosts: string[];
  startsAt: string | null;
  endsAt: string | null;
};

export class MongoQuestAdminRepository {
  constructor(private readonly db: Db) {}

  async createVersion(input: QuestPolicyInput, actor: string) {
    const quests = this.db.collection<any>("quests");
    const policies = this.db.collection<any>("quest_policies");
    const questId = randomUUID();
    const policyId = randomUUID();
    const session = this.db.client.startSession();
    let version = 0;
    try {
      await session.withTransaction(async () => {
        const now = new Date();
        await quests.updateOne(
          { slug: input.slug },
          {
            $set: {
              name: input.name,
              description: input.description,
              status: input.status,
              updated_at: now,
            },
            $setOnInsert: { _id: questId, slug: input.slug, created_at: now },
          },
          { upsert: true, session },
        );
        const quest = await quests.findOne({ slug: input.slug }, { session });
        if (!quest) throw new Error("quest_create_failed");
        await quests.updateOne(
          { _id: quest._id },
          { $inc: { revision_lock: 1 } },
          { session },
        );
        const last = await policies
          .find({ quest_id: quest._id }, { session })
          .sort({ version: -1 })
          .limit(1)
          .next();
        version = (last?.version ?? 0) + 1;
        const policy = {
          rules: input.rules,
          verificationMethod: input.verificationMethod,
          allowedEvidenceHosts: input.allowedEvidenceHosts,
          sourceReviewedBy: actor,
          kind: "public_evidence",
          rewardPolicyVersion: PROGRESSION_POLICY_VERSION,
          dailyCap: 75,
          cooldownSeconds: 3600,
          rewardScope: "wallet_utc_finalization_day",
        };
        await policies.insertOne(
          {
            _id: policyId,
            quest_id: quest._id,
            version,
            policy,
            source_url: input.sourceUrl,
            source_checked_at: now,
            starts_at: input.startsAt ? new Date(input.startsAt) : null,
            ends_at: input.endsAt ? new Date(input.endsAt) : null,
            xp_reward: input.xpReward,
            created_at: now,
          },
          { session },
        );
        await this.db
          .collection<any>("audit_events")
          .insertOne(
            {
              _id: randomUUID(),
              entity_type: "quest",
              entity_id: quest._id,
              action: "policy_version_created",
              details: {
                policy_id: policyId,
                version,
                source_url: input.sourceUrl,
                actor,
              },
              created_at: now,
            },
            { session },
          );
      });
      const quest = await quests.findOne({ slug: input.slug });
      return { questId: quest?._id, policyId, version, status: input.status };
    } finally {
      await session.endSession();
    }
  }

  async listManualReviews(query: unknown = {}) {
    const { limit, cursor } = parsePage(query);
    const page = paginateRows(
      await this.db
        .collection<any>("claims")
        .find({ status: "needs_review", ...pageQuery(cursor, 1) })
        .sort({ created_at: 1, _id: 1 })
        .limit(limit + 1)
        .toArray(),
      limit,
    );
    const claims = page.items;
    const rows = [];
    for (const claim of claims) {
      const [quest, policy, evidence, wallet] = await Promise.all([
        this.db.collection<any>("quests").findOne({ _id: claim.quest_id }),
        this.db
          .collection<any>("quest_policies")
          .findOne({ _id: claim.policy_id }),
        (claim.current_attempt ?? 1) > 1
          ? this.db
              .collection<any>("claim_attempts")
              .findOne({ claim_id: claim._id, attempt: claim.current_attempt })
              .then((row) => row?.evidence)
          : this.db
              .collection<any>("evidence")
              .findOne({ claim_id: claim._id }),
        this.db.collection<any>("wallets").findOne({ _id: claim.wallet_id }),
      ]);
      rows.push({
        id: claim._id,
        status: claim.status,
        createdAt: new Date(claim.created_at).toISOString(),
        questSlug: quest?.slug,
        questName: quest?.name,
        rules: policy?.policy?.rules,
        xpCap: policy?.xp_reward,
        evidenceUrl: evidence?.source_url,
        evidenceHash: evidence?.content_hash,
        evidenceText: evidence?.payload?.text,
        wallet: wallet?.address,
      });
    }
    return { items: rows, nextCursor: page.nextCursor };
  }

  async reviewClaim(
    claimId: string,
    outcome: "rejected",
    xpAward: 0,
    explanation: string,
    actor: string,
  ) {
    const session = this.db.client.startSession();
    const reviewRef = `manual:${randomUUID()}`;
    try {
      let reviewed = false;
      await session.withTransaction(async () => {
        const claim = await this.db
          .collection<any>("claims")
          .findOne({ _id: claimId, status: "needs_review" }, { session });
        if (!claim) return;
        const now = new Date();
        await this.db
          .collection<any>("decisions")
          .updateOne(
            { claim_id: claimId },
            {
              $set: {
                claim_id: claimId,
                outcome,
                reason_code: "manual_rejection",
                explanation: explanation.slice(0, 1000),
                xp_award: 0,
                decision_reference: reviewRef,
                finalized: true,
                payload: { reviewer: actor, method: "manual_rejection_only" },
                finalized_at: now,
              },
            },
            { upsert: true, session },
          );
        await recordClaimEvent(
          this.db,
          claim,
          "rejected",
          explanation,
          "manual_rejected",
          session,
        );
        const result = await this.db
          .collection<any>("claims")
          .updateOne(
            { _id: claimId, status: "needs_review" },
            {
              $set: {
                status: "rejected",
                finalized_at: now,
                updated_at: now,
                lease_token: null,
                lease_until: null,
                reconciliation_requested: false,
              },
            },
            { session },
          );
        if (result.modifiedCount !== 1) throw new Error("claim_review_race");
        await this.db
          .collection<any>("audit_events")
          .insertOne(
            {
              _id: randomUUID(),
              entity_type: "claim",
              entity_id: claimId,
              action: "manual_rejection",
              request_id: reviewRef,
              details: { actor, xp_award: 0 },
              created_at: now,
            },
            { session },
          );
        reviewed = true;
      });
      return reviewed
        ? {
            kind: "reviewed" as const,
            reference: reviewRef,
            outcome,
            xpAward: 0 as const,
          }
        : { kind: "claim_not_reviewable" as const };
    } finally {
      await session.endSession();
    }
  }
}
