import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "mongodb";
import type { Hex } from "viem";
import type { MongoAuthRepository, WalletSession } from "./auth-repository.js";
import { activityPage } from "./activity-repository.js";
import {
  operationalMetricsSummary,
  measureOperation,
} from "./operational-metrics.js";
import { MongoClaimRepository } from "./claim-repository.js";
import {
  ApiError,
  chainConfiguration,
  ownsProfile,
  publicConfiguration,
  rpcClient,
  type ClientFactory,
} from "./config.js";
import { discoverProfiles } from "./discovery-service.js";
import { MongoProfileRepository } from "./profile-repository.js";
import { prepareMint, verifyDemoMint } from "./mint-service.js";
import { MongoScanRepository } from "./scan-repository.js";
import { ScanService } from "./scan-service.js";
import { readDemoMetadata } from "./demo-metadata.js";
import { EvidencePreviewRepository } from "./evidence-preview.js";
import { readSourceMedia } from "./media-capture.js";
import {
  TRAIT_CATALOGUE,
  TRAIT_CATALOGUE_VERSION,
} from "@chog/evolution-rules";
import { createHash, timingSafeEqual } from "node:crypto";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type Dependencies = {
  mongo: Db | undefined;
  auth: MongoAuthRepository | undefined;
  profiles: MongoProfileRepository | undefined;
  claims: MongoClaimRepository | undefined;
  scans: MongoScanRepository | undefined;
  factory?: ClientFactory;
  request?: typeof fetch;
};

function sendFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  fallback: string,
) {
  if (error instanceof ApiError)
    return reply.code(error.status).send({ error: error.code });
  if (
    error instanceof Error &&
    /TransactionReceiptNotFound|TransactionNotFound/.test(error.name)
  )
    return reply.code(202).send({ error: "mint_receipt_pending" });
  request.log.error({ err: error }, fallback);
  return reply.code(503).send({ error: fallback });
}

export function registerProductRoutes(
  app: FastifyInstance,
  deps: Dependencies,
) {
  const { mongo, auth, profiles, claims, scans } = deps;
  const factory = deps.factory ?? rpcClient;
  const scanService =
    claims && scans ? new ScanService(scans, claims, factory) : undefined;
  async function sessionFor(
    request: FastifyRequest,
    reply: FastifyReply,
    databaseError: string,
  ): Promise<WalletSession | undefined> {
    if (!auth || !mongo) {
      reply.code(503).send({ error: databaseError });
      return undefined;
    }
    try {
      const session = await auth.resolveSession(request.cookies.chog_session);
      if (!session) reply.code(401).send({ error: "wallet_not_authenticated" });
      return session;
    } catch (error) {
      request.log.error({ err: error }, "Could not resolve wallet session");
      reply.code(503).send({ error: "wallet_session_unavailable" });
      return undefined;
    }
  }

  app.get("/v1/config", async () => publicConfiguration(Boolean(mongo)));
  const previews = mongo
    ? new EvidencePreviewRepository(mongo, factory, deps.request ?? fetch)
    : undefined;
  app.get("/v1/traits", async () => ({
    items: TRAIT_CATALOGUE,
    version: TRAIT_CATALOGUE_VERSION,
  }));
  app.patch<{
    Params: { id: string };
    Body: { equippedTraitIds?: unknown; expectedVersion?: unknown };
  }>(
    "/v1/profiles/:id/traits",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "profile_database_unconfigured",
      );
      if (!session || !profiles) return;
      const key = request.headers["idempotency-key"];
      const version = request.body?.expectedVersion;
      if (
        !uuid(request.params.id) ||
        typeof key !== "string" ||
        !key ||
        key.length > 200 ||
        typeof version !== "number" ||
        !Number.isSafeInteger(version) ||
        version < 0
      )
        return reply
          .code(400)
          .send({
            error: "valid_profile_version_and_idempotency_key_required",
          });
      try {
        return {
          item: await profiles.setEquipment(
            session.walletId,
            session.address,
            request.params.id,
            request.body?.equippedTraitIds,
            version,
            key,
            factory,
          ),
        };
      } catch (error) {
        return sendFailure(request, reply, error, "trait_update_unavailable");
      }
    },
  );
  app.post<{
    Body: {
      profileId?: unknown;
      questId?: unknown;
      url?: unknown;
      text?: unknown;
    };
  }>(
    "/v1/evidence/previews",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "evidence_database_unconfigured",
      );
      if (!session || !previews) return;
      const { profileId, questId, url, text } = request.body ?? {};
      const key = request.headers["idempotency-key"];
      if (
        !uuid(profileId) ||
        (questId !== undefined && !uuid(questId)) ||
        typeof url !== "string" ||
        url.length > 1000 ||
        (text !== undefined &&
          (typeof text !== "string" || text.length > 1000)) ||
        typeof key !== "string" ||
        !key ||
        key.length > 200
      )
        return reply
          .code(400)
          .send({ error: "valid_evidence_preview_required" });
      try {
        const item = await previews.create(
          session,
          {
            profileId,
            url,
            ...(typeof questId === "string" ? { questId } : {}),
            ...(typeof text === "string" ? { text } : {}),
          },
          key,
        );
        return reply
          .code(
            item.status === "reading" || item.status === "pending" ? 202 : 200,
          )
          .send({ item });
      } catch (error) {
        return sendFailure(
          request,
          reply,
          error,
          "evidence_preview_unavailable",
        );
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/evidence/previews/:id",
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "evidence_database_unconfigured",
      );
      if (!session || !previews) return;
      if (!uuid(request.params.id))
        return reply.code(400).send({ error: "invalid_preview_id" });
      try {
        return {
          item: await previews.get(request.params.id, session.walletId),
        };
      } catch (error) {
        return sendFailure(
          request,
          reply,
          error,
          "evidence_preview_unavailable",
        );
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/evidence/previews/:id/retry",
    { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "evidence_database_unconfigured",
      );
      if (!session || !previews) return;
      if (!uuid(request.params.id))
        return reply.code(400).send({ error: "invalid_preview_id" });
      try {
        return {
          item: await previews.retry(
            request.params.id,
            session.walletId,
            typeof request.headers["idempotency-key"] === "string"
              ? request.headers["idempotency-key"]
              : undefined,
          ),
        };
      } catch (error) {
        return sendFailure(
          request,
          reply,
          error,
          "evidence_preview_unavailable",
        );
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/evidence/media/:id",
    async (request, reply) => {
      if (!mongo || !uuid(request.params.id))
        return reply.code(404).send({ error: "source_media_not_found" });
      try {
        const found = await readSourceMedia(mongo, request.params.id);
        if (!found)
          return reply.code(404).send({ error: "source_media_not_found" });
        reply
          .header("cache-control", "public,max-age=31536000,immutable")
          .type(found.media.mime_type);
        return reply.send(found.stream);
      } catch (error) {
        return sendFailure(request, reply, error, "source_media_unavailable");
      }
    },
  );
  app.get("/v1/admin/metrics", async (request, reply) => {
    const key = process.env.QUEST_ADMIN_API_KEY;
    const provided = request.headers["x-quest-admin-key"];
    if (
      !key ||
      typeof provided !== "string" ||
      !timingSafeEqual(
        createHash("sha256").update(key).digest(),
        createHash("sha256").update(provided).digest(),
      )
    )
      return reply.code(403).send({ error: "admin_authorization_required" });
    if (!mongo)
      return reply.code(503).send({ error: "metrics_database_unconfigured" });
    const metrics = await operationalMetricsSummary(mongo);
    const summarize = async (name: string) => {
      const now = new Date();
      const counts = await mongo
        .collection(name)
        .aggregate([
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
              attempts: { $sum: { $ifNull: ["$attempts", "$failure_count"] } },
            },
          },
        ])
        .toArray();
      const oldest = await mongo
        .collection<any>(name)
        .find({
          status: {
            $in: [
              "submitted",
              "awaiting_genlayer",
              "pending",
              "reading",
              "queued",
              "generating",
            ],
          },
        })
        .sort({ created_at: 1, _id: 1 })
        .limit(1)
        .next();
      return {
        counts: counts.map(({ _id, ...row }) => ({ status: _id, ...row })),
        oldestQueuedAt: oldest?.created_at ?? null,
        queueAgeSeconds: oldest
          ? Math.max(
              0,
              Math.floor((Date.now() - Number(oldest.created_at)) / 1000),
            )
          : 0,
        overdueLeases: await mongo
          .collection(name)
          .countDocuments({ lease_until: { $lt: now, $ne: null } }),
      };
    };
    return {
      metrics,
      capture: await summarize("evidence_previews"),
      claims: await summarize("claims"),
      artwork: await summarize("evolution_jobs"),
      observedAt: new Date().toISOString(),
    };
  });

  app.get<{ Params: { tokenId: string } }>(
    "/v1/metadata/demo/:tokenId",
    async (request, reply) => {
      try {
        const metadata = await readDemoMetadata(
          mongo,
          request.params.tokenId,
          factory,
        );
        return reply
          .header("Cache-Control", "public, max-age=30, must-revalidate")
          .header("X-Content-Type-Options", "nosniff")
          .type("application/json; charset=utf-8")
          .send(metadata);
      } catch (error) {
        return sendFailure(request, reply, error, "demo_metadata_unavailable");
      }
    },
  );

  app.post(
    "/v1/mints/prepare",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "mint_database_unconfigured",
      );
      if (!session) return;
      try {
        return await prepareMint(session.address, factory);
      } catch (error) {
        return sendFailure(request, reply, error, "mint_not_ready");
      }
    },
  );

  app.post<{ Body: { transactionHash?: unknown } }>(
    "/v1/mints/confirm",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "mint_database_unconfigured",
      );
      if (!session || !profiles || !claims) return;
      const hash = request.body?.transactionHash;
      if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash))
        return reply
          .code(400)
          .send({ error: "valid_mint_transaction_required" });
      try {
        const { identity, proof } = await verifyDemoMint(
          session.address,
          hash as Hex,
          undefined,
          factory,
        );
        const item = await profiles.register(session.walletId, identity, proof);
        // Registration is already durable if review submission fails. Confirming again uses
        // the same receipt/profile and retries only the idempotent claim, never another mint.
        let claimWarning: string | undefined;
        try {
          const quest = await claims.questBySlug("demo-first-mint");
          if (quest) {
            const result = await claims.createOrGet({
              profileId: item.id,
              questId: String(quest._id),
              walletId: session.walletId,
              walletAddress: session.address,
              idempotencyKey: `mint:${hash.toLowerCase()}`,
              ...(session.authProofId
                ? { authProofId: session.authProofId }
                : {}),
            });
            if (result.kind === "claim") return { item, claim: result.item };
          }
          claimWarning =
            "Your Chog is ready. Its first evolution review is temporarily unavailable; retry to finish.";
        } catch (error) {
          request.log.error(
            { err: error },
            "Mint registered; first review can be retried",
          );
          claimWarning =
            error instanceof ApiError &&
            error.code === "wallet_reauthentication_required"
              ? "Your Chog is ready. Sign in again to finish its first evolution review."
              : "Your Chog is ready. Its first evolution review is temporarily unavailable; retry to finish.";
        }
        return { item, claimWarning };
      } catch (error) {
        return sendFailure(
          request,
          reply,
          error,
          "mint_confirmation_unavailable",
        );
      }
    },
  );

  app.post<{ Body: { mode?: unknown; cursor?: unknown } }>(
    "/v1/profiles/discover",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "profile_database_unconfigured",
      );
      if (!session || !profiles) return;
      const { mode = "demo", cursor } = request.body ?? {};
      if (
        (mode !== "demo" && mode !== "original_companion") ||
        (cursor !== undefined &&
          (typeof cursor !== "string" || cursor.length > 1500))
      )
        return reply.code(400).send({ error: "invalid_discovery_request" });
      try {
        return await discoverProfiles(
          profiles,
          session.walletId,
          session.address,
          mode,
          cursor as string | undefined,
          factory,
        );
      } catch (error) {
        return sendFailure(
          request,
          reply,
          error,
          "profile_discovery_unavailable",
        );
      }
    },
  );

  async function submit(
    request: FastifyRequest<{
      Body: {
        profileId?: unknown;
        questId?: unknown;
        url?: unknown;
        text?: unknown;
        transactionHash?: unknown;
        previewId?: unknown;
      };
      Headers: { "idempotency-key"?: string };
    }>,
    reply: FastifyReply,
    upgrade: boolean,
  ) {
    const session = await sessionFor(
      request,
      reply,
      "claim_database_unconfigured",
    );
    if (!session || !claims) return;
    const { profileId, questId, url, text, transactionHash, previewId } =
      request.body ?? {};
    const idempotencyKey = request.headers["idempotency-key"];
    if (
      !uuid(profileId) ||
      (!upgrade && !uuid(questId)) ||
      typeof idempotencyKey !== "string" ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > 200 ||
      (url !== undefined && (typeof url !== "string" || url.length > 1000)) ||
      (text !== undefined &&
        (typeof text !== "string" || text.length > 1000)) ||
      (transactionHash !== undefined &&
        (typeof transactionHash !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(transactionHash))) ||
      (previewId !== undefined && !uuid(previewId)) ||
      (upgrade && typeof url !== "string" && typeof previewId !== "string")
    )
      return reply
        .code(400)
        .send({ error: "valid_claim_identity_and_idempotency_key_required" });
    try {
      const profile = await claims.getProfileForWallet(
        profileId,
        session.walletId,
      );
      if (!profile)
        return reply.code(404).send({ error: "profile_not_found_for_wallet" });
      if (!(await ownsProfile(profile, session.address, factory)))
        return reply
          .code(403)
          .send({ error: "nft_not_currently_owned_by_authenticated_wallet" });
      const quest = upgrade
        ? await claims.questBySlug("ecosystem-contribution")
        : null;
      if (upgrade && !quest)
        return reply
          .code(503)
          .send({ error: "contribution_review_unavailable" });
      const result = await claims.createOrGet({
        profileId,
        questId: upgrade ? String(quest!._id) : (questId as string),
        walletId: session.walletId,
        walletAddress: session.address,
        idempotencyKey,
        requestId: request.id,
        ...(typeof previewId === "string" ? { previewId } : {}),
        ...(typeof url === "string" ? { url } : {}),
        ...(typeof text === "string" ? { text } : {}),
        ...(typeof transactionHash === "string"
          ? { transactionHash: transactionHash as Hex }
          : {}),
        ...(session.authProofId ? { authProofId: session.authProofId } : {}),
      });
      if (result.kind === "quest_unavailable")
        return reply
          .code(422)
          .send({ error: "quest_inactive_or_policy_stale" });
      if (result.kind === "evidence_host_not_allowed")
        return reply
          .code(422)
          .send({ error: "evidence_host_not_allowed_by_quest_policy" });
      if (result.kind === "evidence_unverified")
        return reply.code(422).send({ error: "verified_evidence_required" });
      if (result.kind === "idempotency_conflict")
        return reply
          .code(409)
          .send({ error: "idempotency_key_reused_with_different_claim" });
      return reply.code(result.duplicate ? 200 : 202).send({
        item: result.item,
        duplicate: result.duplicate,
        status: result.item.status,
      });
    } catch (error) {
      return sendFailure(request, reply, error, "claim_submission_unavailable");
    }
  }
  app.post<{
    Body: {
      profileId?: unknown;
      questId?: unknown;
      url?: unknown;
      text?: unknown;
      transactionHash?: unknown;
      previewId?: unknown;
    };
    Headers: { "idempotency-key"?: string };
  }>(
    "/v1/claims",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    (request, reply) => submit(request, reply, false),
  );
  app.post<{
    Body: {
      profileId?: unknown;
      url?: unknown;
      text?: unknown;
      previewId?: unknown;
    };
    Headers: { "idempotency-key"?: string };
  }>(
    "/v1/upgrades/evidence",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    (request, reply) => submit(request, reply, true),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/claims/:id/retry",
    { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "claim_database_unconfigured",
      );
      if (!session || !claims) return;
      const key = request.headers["idempotency-key"];
      if (
        !uuid(request.params.id) ||
        typeof key !== "string" ||
        !key.trim() ||
        key.length > 200
      )
        return reply
          .code(400)
          .send({ error: "valid_claim_and_idempotency_key_required" });
      try {
        return reply
          .code(202)
          .send({
            item: await claims.retry(
              request.params.id,
              session.walletId,
              session.address,
              key,
              session.authProofId,
            ),
          });
      } catch (error) {
        return sendFailure(request, reply, error, "claim_retry_unavailable");
      }
    },
  );

  app.post<{ Body: { profileId?: unknown } }>(
    "/v1/scans",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "scan_database_unconfigured",
      );
      if (!session || !scanService) return;
      if (!uuid(request.body?.profileId))
        return reply.code(400).send({ error: "valid_profile_id_required" });
      try {
        const result = await measureOperation(
          mongo,
          { kind: "job", name: "scan", operation: "scan" },
          () => scanService.run(session, request.body.profileId as string),
        );
        return reply.code(result.partial ? 202 : 200).send(result);
      } catch (error) {
        return sendFailure(request, reply, error, "scan_unavailable");
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/scans/:id",
    async (request, reply) => {
      const session = await sessionFor(
        request,
        reply,
        "scan_database_unconfigured",
      );
      if (!session || !scans || !claims) return;
      if (!uuid(request.params.id))
        return reply.code(400).send({ error: "invalid_scan_id" });
      try {
        const item = await scans.getForWallet(
          request.params.id,
          session.walletId,
        );
        if (!item) return reply.code(404).send({ error: "scan_not_found" });
        const evaluations = await Promise.all(
          (item.claimIds as string[]).map((id) =>
            claims.getForWallet(id, session.walletId),
          ),
        );
        return {
          item: { ...item, claims: evaluations.filter(Boolean) },
          claims: evaluations.filter(Boolean),
          candidateOnly: true,
        };
      } catch (error) {
        return sendFailure(request, reply, error, "scan_unavailable");
      }
    },
  );

  app.get("/v1/activity", async (request, reply) => {
    const session = await sessionFor(
      request,
      reply,
      "activity_database_unconfigured",
    );
    if (!session || !mongo || !claims) return;
    try {
      return await activityPage(
        mongo,
        claims,
        session.walletId,
        session.address,
        request.query,
      );
    } catch (error) {
      return sendFailure(request, reply, error, "activity_unavailable");
    }
  });
}
