import {
  measureOperation,
  recordOperationalMetric,
} from "./operational-metrics.js";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { MongoClaimRepository, policyUsable } from "./claim-repository.js";
import type { WalletSession } from "./auth-repository.js";
import {
  ApiError,
  ownsProfile,
  rpcClient,
  type ClientFactory,
} from "./config.js";
import {
  captureContribution,
  evidenceDigest,
  parseContributionUrl,
  type SourceSnapshot,
} from "./evidence-source.js";
import { captureSourceMedia, sourceMediaUrl } from "./media-capture.js";
import { contributionAllowance } from "@chog/evolution-rules";

export class EvidencePreviewRepository {
  private claims: MongoClaimRepository;
  constructor(
    private db: Db,
    private factory: ClientFactory = rpcClient,
    private request: typeof fetch = fetch,
  ) {
    this.claims = new MongoClaimRepository(db, factory, request);
  }

  async create(
    session: WalletSession,
    input: { profileId: string; questId?: string; url: string; text?: string },
    key: string,
  ) {
    const source = parseContributionUrl(input.url);
    const quest = input.questId
      ? await this.db
          .collection<any>("quests")
          .findOne({ _id: input.questId, status: "active" })
      : await this.claims.questBySlug("ecosystem-contribution");
    const policy =
      quest &&
      (await this.db
        .collection<any>("quest_policies")
        .find({ quest_id: quest._id })
        .sort({ version: -1 })
        .limit(1)
        .next());
    if (
      !quest ||
      !policyUsable(policy) ||
      policy.policy.kind !== "public_evidence"
    )
      throw new ApiError("contribution_review_unavailable", 422);
    const profile = await this.claims.getProfileForWallet(
      input.profileId,
      session.walletId,
    );
    if (
      !profile ||
      !(await ownsProfile(profile, session.address, this.factory))
    )
      throw new ApiError(
        "nft_not_currently_owned_by_authenticated_wallet",
        403,
      );
    const requestHash = evidenceDigest(
      JSON.stringify({
        profileId: input.profileId,
        questId: quest._id,
        url: source.canonicalUrl,
        text: input.text?.trim() ?? "",
      }),
    );
    const previews = this.db.collection<any>("evidence_previews");
    const existing = await previews.findOne({
      wallet_id: session.walletId,
      idempotency_key: key,
    });
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new ApiError("idempotency_conflict", 409);
      return this.get(String(existing._id), session.walletId);
    }
    const id = randomUUID(),
      now = new Date();
    try {
      await previews.insertOne({
        _id: id,
        wallet_id: session.walletId,
        wallet_address: session.address,
        profile_id: input.profileId,
        quest_id: quest._id,
        policy_id: policy._id,
        provider: source.provider,
        url: source.canonicalUrl,
        text: input.text?.trim() ?? "",
        idempotency_key: key,
        request_hash: requestHash,
        status: "pending",
        attempts: 0,
        lease_token: null,
        lease_until: null,
        next_attempt_at: null,
        expires_at: new Date(now.getTime() + 600000),
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const previous = await previews.findOne({
        wallet_id: session.walletId,
        idempotency_key: key,
      });
      if (!previous || previous.request_hash !== requestHash)
        throw new ApiError("idempotency_conflict", 409);
      return this.get(previous._id, session.walletId);
    }
    // The row is durable before any network request. A killed request is resumed by the worker.
    await this.process(id);
    return this.get(id, session.walletId);
  }

  async get(id: string, walletId: string) {
    const row = await this.db
      .collection<any>("evidence_previews")
      .findOne({ _id: id, wallet_id: walletId });
    if (!row) throw new ApiError("preview_not_found", 404);
    const expired =
      Number(row.expires_at) <= Date.now() && row.status !== "consumed";
    return {
      id,
      profileId: String(row.profile_id),
      questId: String(row.quest_id),
      claimId: row.claim_id ?? null,
      status: expired ? "expired" : row.status,
      source: row.source ?? null,
      media: (row.source?.media ?? []).map((m: any) => ({
        ...m,
        ...(m.mediaId ? { url: sourceMediaUrl(m.mediaId) } : {}),
      })),
      eligibility: expired
        ? {
            eligible: false,
            reasonCode: "preview_expired",
            message: "Preview expired. Capture the source again.",
          }
        : (row.eligibility ?? {
            eligible: false,
            message: "Reading your source.",
          }),
      errorCode: row.error_code ?? null,
      attempts: row.attempts,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  async retry(id: string, walletId: string, key?: string) {
    const previews = this.db.collection<any>("evidence_previews");
    const row = await previews.findOne({ _id: id, wallet_id: walletId });
    if (!row) throw new ApiError("preview_not_found", 404);
    if (row.status === "consumed") return this.get(id, walletId);
    if (
      (key && row.last_retry_key === key) ||
      (row.lease_until && Number(row.lease_until) > Date.now())
    )
      return this.get(id, walletId);
    const profile = await this.claims.getProfileForWallet(
      row.profile_id,
      walletId,
    );
    if (
      !profile ||
      !(await ownsProfile(profile, profile.wallet_address, this.factory))
    )
      throw new ApiError(
        "nft_not_currently_owned_by_authenticated_wallet",
        403,
      );
    const fresh =
      Number(row.expires_at) <= Date.now() ||
      row.status === "ready" ||
      row.status === "failed";
    await previews.updateOne(
      {
        _id: id,
        wallet_id: walletId,
        status: { $ne: "consumed" },
        $or: [{ lease_until: null }, { lease_until: { $lt: new Date() } }],
      },
      {
        $set: {
          status: "pending",
          attempts: 0,
          next_attempt_at: null,
          lease_token: null,
          lease_until: null,
          expires_at: new Date(Date.now() + 600000),
          ...(fresh ? { capture_job_id: `${id}:${randomUUID()}` } : {}),
          ...(key ? { last_retry_key: key } : {}),
          updated_at: new Date(),
        },
        ...(fresh ? { $unset: { source: "", eligibility: "" } } : {}),
      },
    );
    await this.process(id);
    return this.get(id, walletId);
  }

  async process(id?: string) {
    const token = randomUUID(),
      now = new Date();
    const previews = this.db.collection<any>("evidence_previews");
    const candidate = await previews.findOneAndUpdate(
      {
        ...(id ? { _id: id } : {}),
        status: { $in: ["pending", "reading", "source_unavailable"] },
        attempts: { $lt: 3 },
        expires_at: { $gt: now },
        $and: [
          { $or: [{ lease_until: null }, { lease_until: { $lt: now } }] },
          {
            $or: [
              { next_attempt_at: null },
              { next_attempt_at: { $lte: now } },
            ],
          },
        ],
      },
      {
        $set: {
          status: "reading",
          lease_token: token,
          lease_until: new Date(now.getTime() + 120000),
          updated_at: now,
        },
        $inc: { attempts: 1 },
      },
      { sort: { created_at: 1, _id: 1 }, returnDocument: "after" },
    );
    if (!candidate) return false;
    let captured: SourceSnapshot | undefined;
    let failed = false;
    try {
      const link = await this.db
        .collection<any>("x_profile_links")
        .findOne({ wallet_id: candidate.wallet_id });
      // A partial capture keeps the exact source snapshot and already stored image bytes.
      // A fresh/expired preview still fetches again; never combine two revisions of a post.
      captured =
        candidate.source && Number(candidate.expires_at) > Date.now()
          ? candidate.source
          : await measureOperation(
              this.db,
              {
                kind: "provider",
                name: candidate.provider === "x" ? "x" : "github",
                operation: "capture",
                attempt: candidate.attempts,
              },
              () =>
                captureContribution(
                  parseContributionUrl(candidate.url),
                  candidate.wallet_address,
                  link,
                  this.request,
                ),
            );
      if (!captured || !captured.identity_binding.verified)
        throw new ApiError("evidence_attribution_required", 422);
      if (
        captured.provider === "x" &&
        captured.identity_binding.provider_user_id !== link?.provider_user_id
      )
        throw new ApiError("evidence_author_not_linked_to_wallet", 422);
      // Media jobs may survive this process. Save the exact text and media source
      // descriptors first so recovery never pairs saved bytes with a newer post.
      const checkpoint = await previews.updateOne(
        {
          _id: candidate._id,
          lease_token: token,
          lease_until: { $gt: new Date() },
        },
        { $set: { source: captured, updated_at: new Date() } },
      );
      if (checkpoint.matchedCount !== 1) return true;
      if (captured.media?.length) {
        captured.media = await captureSourceMedia(
          this.db,
          captured,
          this.request,
          String(candidate.capture_job_id ?? candidate._id),
        );
        captured.public_content.media = captured.media;
        captured.content_hash = evidenceDigest(
          JSON.stringify(captured.public_content),
        );
        if (captured.media.some((media) => media.status !== "captured"))
          throw new ApiError("evidence_media_capture_incomplete", 503);
      }
      const duplicate = await this.db
        .collection<any>("claims")
        .findOne({
          scope_key: `source:${captured.provider}:${captured.source_id}`,
        });
      const ledger = await this.db
        .collection<any>("xp_ledger")
        .find({ wallet_id: candidate.wallet_id, reward_family: "contribution" })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray();
      const allowance = contributionAllowance(
        ledger.map((l: any) => ({
          amount: l.amount,
          createdAt: new Date(l.created_at),
        })),
        new Date(),
      );
      // A capped contribution can still be evaluated and recorded; it simply grants no XP.
      const eligibility = duplicate
        ? {
            eligible: false,
            reasonCode: "duplicate_source",
            message: "This source already has a claim.",
            rewardXp: 0,
            ...(duplicate.wallet_id === candidate.wallet_id
              ? { claimId: String(duplicate._id) }
              : {}),
          }
        : {
            eligible: true,
            reasonCode: allowance.reasonCode,
            rewardXp: allowance.amount,
            nextEligibleAt: allowance.nextEligibleAt,
            message:
              allowance.amount === 0
                ? "You can submit this contribution, but your current reward limit means it may earn no XP."
                : "Source and attribution captured. GenLayer will decide whether it meets the quest.",
          };
      await previews.updateOne(
        { _id: candidate._id, lease_token: token },
        {
          $set: {
            status: "ready",
            source: captured,
            eligibility,
            error_code: null,
            lease_until: null,
            lease_token: null,
            updated_at: new Date(),
          },
        },
      );
    } catch (error) {
      failed = true;
      const code =
        error instanceof ApiError ? error.code : "evidence_source_unavailable";
      const retryable = !(error instanceof ApiError) || error.status >= 500;
      await previews.updateOne(
        { _id: candidate._id, lease_token: token },
        {
          $set: {
            status: retryable ? "source_unavailable" : "failed",
            ...(captured ? { source: captured } : {}),
            error_code: code,
            eligibility: {
              eligible: false,
              reasonCode: code,
              message:
                "The source could not be fully captured. Your preview and completed images are saved.",
            },
            lease_until: null,
            lease_token: null,
            next_attempt_at: new Date(
              Date.now() + 60000 * 2 ** Math.max(0, candidate.attempts - 1),
            ),
            updated_at: new Date(),
          },
        },
      );
    }
    await recordOperationalMetric(this.db, {
      kind: "job",
      name: "capture",
      operation: "process",
      outcome: failed ? "failure" : "success",
      durationMs: Date.now() - now.getTime(),
      attempt: candidate.attempts,
    });
    return true;
  }
}
export async function processOneCapture(db: Db) {
  return new EvidencePreviewRepository(db).process();
}
