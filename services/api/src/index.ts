import { parsePage } from "./pagination.js";
import {
  recordOperationalMetric,
  measureOperation,
} from "./operational-metrics.js";
import { ApiError } from "./config.js";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import {
  installRuntimeControls,
  MAX_REQUEST_BYTES,
} from "./runtime-controls.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { MongoAuthRepository, type WalletSession } from "./auth-repository.js";
import {
  closeDatabase,
  connectDatabase,
  SCHEMA_VERSION,
  getDatabase,
} from "./mongo.js";
import { MongoProfileRepository } from "./profile-repository.js";
import { MongoClaimRepository } from "./claim-repository.js";
import {
  MongoQuestAdminRepository,
  type QuestPolicyInput,
} from "./quest-admin-repository.js";
import { MongoSocialRepository } from "./social-repository.js";
import { lookupXProfile } from "./x-profile.js";
import { MongoScanRepository } from "./scan-repository.js";
import { registerProductRoutes } from "./product-routes.js";
import { ownsProfile, rpcClient, type ClientFactory } from "./config.js";
import type { ScenarioRepository, ScenarioOutcome } from "./repository.js";

const localDemoEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_LOCAL_DEMO_SCENARIOS === "true";

const configuredWebOrigin = () => {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN;
  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercelHost ? `https://${vercelHost}` : "http://localhost:3000";
};

export type AppOptions = {
  database?: Db | null;
  factory?: ClientFactory;
  request?: typeof fetch;
  logger?: boolean;
};
export function buildApp(
  repository?: ScenarioRepository,
  options: AppOptions = {},
): FastifyInstance {
  const app = Fastify({
    bodyLimit: MAX_REQUEST_BYTES,
    genReqId: (request) => {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          supplied,
        )
        ? supplied
        : randomUUID();
    },
    logger:
      options.logger === false
        ? false
        : {
            serializers: {
              err: (error: any) => ({
                type: "Error",
                message: "Server error; details redacted",
                stack: "",
                code:
                  typeof error?.code === "string" &&
                  /^[A-Za-z0-9_]{1,80}$/.test(error.code)
                    ? error.code
                    : "internal_error",
              }),
            },
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
              "err.config",
              "err.request",
              "err.url",
            ],
          },
  });
  app.register(cors, {
    origin: configuredWebOrigin(),
    credentials: true,
  });
  app.register(cookie);
  const mongo =
    options.database !== undefined
      ? (options.database ?? undefined)
      : repository || !process.env.MONGODB_URI
        ? undefined
        : getDatabase();
  const factory = options.factory ?? rpcClient;
  installRuntimeControls(app, mongo ? { database: mongo } : {});
  app.addHook("onResponse", async (request, reply) => {
    await recordOperationalMetric(mongo, {
      kind: "request",
      name: "http",
      operation: "request",
      outcome: reply.statusCode >= 500 ? "failure" : "success",
      durationMs: reply.elapsedTime,
    });
  });
  const scenarios = repository;
  const auth = mongo ? new MongoAuthRepository(mongo) : undefined;
  const profiles = mongo ? new MongoProfileRepository(mongo) : undefined;
  const claims = mongo
    ? new MongoClaimRepository(mongo, factory, options.request ?? fetch)
    : undefined;
  const questAdmin = mongo ? new MongoQuestAdminRepository(mongo) : undefined;
  const social = mongo ? new MongoSocialRepository(mongo) : undefined;
  const scans = mongo ? new MongoScanRepository(mongo) : undefined;
  app.addHook("onReady", async () => {
    if (mongo && options.database === undefined) {
      await connectDatabase();
    }
  });
  app.addHook("onClose", async () => {
    if (options.database === undefined) await closeDatabase();
  });
  registerProductRoutes(app, {
    mongo,
    auth,
    profiles,
    claims,
    scans,
    factory,
    request: options.request ?? fetch,
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "chog-api",
    timestamp: new Date().toISOString(),
  }));
  app.get("/ready", async (_request, reply) => {
    if (!mongo)
      return reply.code(503).send({
        status: "not_ready",
        dependencies: { mongodb: "unconfigured" },
      });
    try {
      await mongo.command({ ping: 1 });
      const schema = await mongo
        .collection<any>("schema_migrations")
        .findOne({ _id: `mongodb-${SCHEMA_VERSION}` });
      if (!schema)
        return reply.code(503).send({ error: "schema_migration_required" });
      return {
        status: "ready",
        service: "chog-api",
        schemaVersion: SCHEMA_VERSION,
        dependencies: { mongodb: "available" },
      };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        dependencies: { mongodb: "unavailable" },
      });
    }
  });
  app.post<{ Body: { address?: string; chainId?: number } }>(
    "/v1/auth/nonce",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth)
        return reply.code(503).send({ error: "auth_database_unconfigured" });
      const { address, chainId } = request.body ?? {};
      const allowedChainIds = [
        Number(process.env.MONAD_TESTNET_CHAIN_ID ?? 10143),
        Number(process.env.MONAD_MAINNET_CHAIN_ID ?? 143),
      ];
      if (
        typeof address !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(address) ||
        typeof chainId !== "number" ||
        !Number.isSafeInteger(chainId) ||
        !allowedChainIds.includes(chainId)
      ) {
        return reply
          .code(400)
          .send({ error: "valid_wallet_address_and_supported_chain_required" });
      }
      try {
        const challenge = await auth.issueNonce(
          address as `0x${string}`,
          chainId,
          configuredWebOrigin(),
        );
        return reply.code(201).send(challenge);
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not create wallet challenge");
        return reply.code(503).send({ error: "wallet_challenge_unavailable" });
      }
    },
  );
  app.post<{ Body: { message?: string; signature?: string } }>(
    "/v1/auth/verify",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth)
        return reply.code(503).send({ error: "auth_database_unconfigured" });
      const { message, signature } = request.body ?? {};
      if (
        typeof message !== "string" ||
        message.length > 2048 ||
        typeof signature !== "string"
      ) {
        return reply
          .code(400)
          .send({ error: "wallet_message_and_signature_required" });
      }
      try {
        const session = await auth.verifyAndCreateSession(message, signature);
        if (!session)
          return reply
            .code(401)
            .send({ error: "wallet_signature_invalid_or_challenge_expired" });
        reply.setCookie("chog_session", session.sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          expires: new Date(session.expiresAt),
        });
        return {
          authenticated: true,
          wallet: session.address,
          expiresAt: session.expiresAt,
        };
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not verify wallet challenge");
        return reply
          .code(503)
          .send({ error: "wallet_verification_unavailable" });
      }
    },
  );
  app.get("/v1/auth/me", async (request, reply) => {
    if (!auth)
      return reply.code(503).send({ error: "auth_database_unconfigured" });
    try {
      const session = await auth.resolveSession(request.cookies.chog_session);
      return session
        ? {
            authenticated: true,
            wallet: session.address,
            expiresAt: session.expiresAt,
          }
        : reply.code(401).send({ error: "wallet_not_authenticated" });
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not resolve wallet session");
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
  });
  app.post("/v1/auth/logout", async (request, reply) => {
    try {
      if (auth) await auth.revokeSession(request.cookies.chog_session);
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not revoke wallet session");
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
    reply.clearCookie("chog_session", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return { authenticated: false };
  });
  app.get("/v1/profiles", async (request, reply) => {
    if (!auth || !profiles)
      return reply.code(503).send({ error: "profile_database_unconfigured" });
    let session: WalletSession | undefined;
    try {
      session = await auth.resolveSession(request.cookies.chog_session);
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not validate wallet session");
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
    if (!session)
      return reply.code(401).send({ error: "wallet_not_authenticated" });
    try {
      const page = await profiles.listPageForWallet(
        session.walletId,
        request.query,
      );
      const items = page.items;
      const current = [];
      for (let offset = 0; offset < items.length; offset += 4) {
        const verified = await Promise.all(
          items.slice(offset, offset + 4).map(async (item) => {
            if (
              await ownsProfile(
                {
                  mode: item.nft.mode,
                  chain_id: item.nft.chainId,
                  collection_address: item.nft.collectionAddress,
                  token_id: item.nft.tokenId,
                },
                session.address,
                factory,
              )
            )
              return profiles.captureOriginalMetadata(item, factory);
            await profiles.releaseOwnership(session!.walletId, item.id);
            return null;
          }),
        );
        current.push(...verified.filter((item) => item !== null));
      }
      return { items: current, nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not load wallet profiles");
      return reply.code(503).send({ error: "profiles_unavailable" });
    }
  });
  app.get<{ Params: { id: string } }>(
    "/v1/passports/:id",
    async (request, reply) => {
      if (!profiles)
        return reply
          .code(503)
          .send({ error: "passport_database_unconfigured" });
      if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
        return reply.code(400).send({ error: "invalid_profile_id" });
      try {
        const passport = await profiles.getPassport(
          request.params.id,
          request.query,
        );
        return passport
          ? { item: passport }
          : reply.code(404).send({ error: "passport_not_found" });
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not load public passport");
        return reply.code(503).send({ error: "passport_unavailable" });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/artifacts/:id",
    async (request, reply) => {
      if (!mongo || !/^[0-9a-f]{24}$/i.test(request.params.id))
        return reply.code(404).send({ error: "artifact_not_found" });
      try {
        const id = new ObjectId(request.params.id);
        const artifact = await mongo.collection<any>("artifacts").findOne({
          $or: [
            { gridfs_id: id.toHexString() },
            { metadata_gridfs_id: id.toHexString() },
          ],
        });
        if (!artifact)
          return reply.code(404).send({ error: "artifact_not_found" });
        const job = await mongo.collection<any>("evolution_jobs").findOne({
          ...(artifact.source_event_id
            ? { source_event_id: artifact.source_event_id }
            : { claim_id: artifact.claim_id }),
          artifact_id: artifact._id,
          status: "completed",
        });
        if (!job) return reply.code(404).send({ error: "artifact_not_found" });
        const bucket = new GridFSBucket(mongo, {
          bucketName: "chog_artifacts",
        });
        const file = await bucket.find({ _id: id }).limit(1).next();
        if (!file || file.length > 10 * 1024 * 1024)
          return reply.code(404).send({ error: "artifact_not_found" });
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        reply.type(
          file.metadata?.contentType === "application/json"
            ? "application/json"
            : "image/png",
        );
        return reply.send(bucket.openDownloadStream(id));
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not read published artifact");
        return reply.code(503).send({ error: "artifact_unavailable" });
      }
    },
  );
  app.get("/v1/social/x", async (request, reply) => {
    if (!auth || !social)
      return reply
        .code(503)
        .send({ error: "social_link_database_unconfigured" });
    let session: WalletSession | undefined;
    try {
      session = await auth.resolveSession(request.cookies.chog_session);
    } catch {
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
    if (!session)
      return reply.code(401).send({ error: "wallet_not_authenticated" });
    try {
      return { item: await social.getXLink(session.walletId) };
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not load X profile link");
      return reply.code(503).send({ error: "social_link_unavailable" });
    }
  });
  app.post(
    "/v1/social/x/challenge",
    { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth || !social)
        return reply
          .code(503)
          .send({ error: "social_link_database_unconfigured" });
      let session: WalletSession | undefined;
      try {
        session = await auth.resolveSession(request.cookies.chog_session);
      } catch {
        return reply.code(503).send({ error: "wallet_session_unavailable" });
      }
      if (!session)
        return reply.code(401).send({ error: "wallet_not_authenticated" });
      try {
        return reply
          .code(201)
          .send(await social.createXChallenge(session.walletId));
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not create X bio challenge");
        return reply.code(503).send({ error: "social_challenge_unavailable" });
      }
    },
  );
  app.post<{ Body: { username?: string } }>(
    "/v1/social/x/verify",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth || !social)
        return reply
          .code(503)
          .send({ error: "social_link_database_unconfigured" });
      let session: WalletSession | undefined;
      try {
        session = await auth.resolveSession(request.cookies.chog_session);
      } catch {
        return reply.code(503).send({ error: "wallet_session_unavailable" });
      }
      if (!session)
        return reply.code(401).send({ error: "wallet_not_authenticated" });
      const username =
        typeof request.body?.username === "string"
          ? request.body.username.replace(/^@/, "")
          : undefined;
      if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username))
        return reply.code(400).send({ error: "valid_x_username_required" });
      try {
        const profile = await measureOperation(
          mongo,
          { kind: "provider", name: "x", operation: "lookup" },
          () => lookupXProfile(username, options.request ?? fetch),
        );
        if (!profile)
          return reply.code(404).send({ error: "x_profile_not_found" });
        const result = await social.verifyXChallenge(
          session.walletId,
          profile.username,
          profile.id,
          profile.description,
          profile.source,
        );
        if (result.kind === "challenge_missing_or_expired")
          return reply
            .code(409)
            .send({ error: "x_bio_challenge_missing_or_expired" });
        if (result.kind === "bio_code_not_found")
          return reply.code(422).send({ error: "x_bio_code_not_found" });
        if (result.kind === "x_account_already_linked")
          return reply
            .code(409)
            .send({ error: "x_profile_already_linked_to_another_wallet" });
        await mongo?.collection<any>("audit_events").insertOne({
          _id: randomUUID(),
          actor_wallet_id: session.walletId,
          entity_type: "wallet",
          entity_id: session.walletId,
          action: "x_profile_linked",
          request_id: request.id,
          details: {
            username: profile.username,
            provider_user_id: profile.id,
          },
          created_at: new Date(),
        });
        return {
          item: { username: profile.username, verifiedAt: result.verifiedAt },
        };
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error(
          { err: error },
          "Could not read X profile for bio verification",
        );
        return reply
          .code(503)
          .send({ error: "x_profile_verification_unavailable" });
      }
    },
  );
  app.delete("/v1/social/x", async (request, reply) => {
    if (!auth || !social)
      return reply
        .code(503)
        .send({ error: "social_link_database_unconfigured" });
    let session: WalletSession | undefined;
    try {
      session = await auth.resolveSession(request.cookies.chog_session);
    } catch {
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
    if (!session)
      return reply.code(401).send({ error: "wallet_not_authenticated" });
    try {
      await social.unlinkX(session.walletId);
      await mongo?.collection<any>("audit_events").insertOne({
        _id: randomUUID(),
        actor_wallet_id: session.walletId,
        entity_type: "wallet",
        entity_id: session.walletId,
        action: "x_profile_unlinked",
        request_id: request.id,
        created_at: new Date(),
      });
      return { linked: false };
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not unlink X account");
      return reply.code(503).send({ error: "social_unlink_unavailable" });
    }
  });
  app.post<{
    Body: {
      mode?: string;
      chainId?: number;
      collectionAddress?: string;
      tokenId?: string;
    };
  }>(
    "/v1/profiles/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth || !profiles)
        return reply.code(503).send({ error: "profile_database_unconfigured" });
      let session: WalletSession | undefined;
      try {
        session = await auth.resolveSession(request.cookies.chog_session);
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not validate wallet session");
        return reply.code(503).send({ error: "wallet_session_unavailable" });
      }
      if (!session)
        return reply.code(401).send({ error: "wallet_not_authenticated" });
      const { mode, chainId, collectionAddress, tokenId } = request.body ?? {};
      if (
        (mode !== "demo" && mode !== "original_companion") ||
        typeof chainId !== "number" ||
        !Number.isSafeInteger(chainId) ||
        typeof collectionAddress !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(collectionAddress) ||
        typeof tokenId !== "string" ||
        !/^(0|[1-9][0-9]{0,77})$/.test(tokenId)
      ) {
        return reply.code(400).send({ error: "invalid_nft_identity" });
      }
      const demoMode = mode === "demo";
      const expectedChainId = Number(
        process.env[
          demoMode ? "MONAD_TESTNET_CHAIN_ID" : "MONAD_MAINNET_CHAIN_ID"
        ] ?? (demoMode ? 10143 : 143),
      );
      const configuredCollection =
        process.env[
          demoMode
            ? "DEMO_COLLECTION_ADDRESS"
            : "ORIGINAL_CHOG_COLLECTION_ADDRESS"
        ];
      const rpcUrl =
        process.env[
          demoMode ? "MONAD_TESTNET_RPC_URL" : "MONAD_MAINNET_RPC_URL"
        ];
      if (!configuredCollection || !rpcUrl)
        return reply.code(503).send({
          error: demoMode
            ? "demo_collection_unconfigured"
            : "original_collection_unconfigured",
        });
      if (
        chainId !== expectedChainId ||
        collectionAddress.toLowerCase() !== configuredCollection.toLowerCase()
      ) {
        return reply
          .code(422)
          .send({ error: "nft_collection_identity_mismatch" });
      }
      try {
        if (
          !(await ownsProfile(
            {
              mode,
              chain_id: expectedChainId,
              collection_address: configuredCollection,
              token_id: tokenId,
            },
            session.address,
            factory,
          ))
        )
          return reply
            .code(403)
            .send({ error: "nft_not_owned_by_authenticated_wallet" });
        const profile = await profiles.register(session.walletId, {
          mode: demoMode ? "demo" : "original_companion",
          chainId: expectedChainId,
          collectionAddress: configuredCollection as `0x${string}`,
          tokenId,
        });
        return reply.code(201).send({ item: profile });
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error(
          { err: error },
          "Could not verify NFT ownership or register profile",
        );
        return reply
          .code(503)
          .send({ error: "nft_ownership_verification_unavailable" });
      }
    },
  );
  app.get("/v1/quests", async (_request, reply) => {
    if (!claims) return { items: [] };
    try {
      return await claims.listQuestsPage(_request.query);
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      _request.log.error({ err: error }, "Could not load active quests");
      return reply.code(503).send({ error: "quest_registry_unavailable" });
    }
  });
  app.get<{ Params: { id: string } }>(
    "/v1/evidence/:id",
    async (request, reply) => {
      if (!claims)
        return reply
          .code(503)
          .send({ error: "evidence_database_unconfigured" });
      if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
        return reply.code(400).send({ error: "invalid_evidence_reference" });
      try {
        const item = await claims.getPublicEvidence(request.params.id);
        return item
          ? reply
              .header("Cache-Control", "public, max-age=31536000, immutable")
              .header("X-Content-Type-Options", "nosniff")
              .type("text/plain; charset=utf-8")
              .send(item)
          : reply.code(404).send({ error: "verified_evidence_not_found" });
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error(
          { err: error },
          "Could not resolve verified evidence reference",
        );
        return reply.code(503).send({ error: "evidence_unavailable" });
      }
    },
  );
  app.get<{ Params: { id: string; attempt: string } }>(
    "/v1/evidence/:id/attempts/:attempt",
    async (request, reply) => {
      if (!claims)
        return reply
          .code(503)
          .send({ error: "evidence_database_unconfigured" });
      if (
        !/^[0-9a-f-]{36}$/i.test(request.params.id) ||
        !/^[1-9]\d{0,2}$/.test(request.params.attempt)
      )
        return reply.code(400).send({ error: "invalid_evidence_reference" });
      const text = await claims.getPublicEvidence(
        request.params.id,
        Number(request.params.attempt),
      );
      return text
        ? reply
            .header("Cache-Control", "public,max-age=31536000,immutable")
            .header("X-Content-Type-Options", "nosniff")
            .type("text/plain; charset=utf-8")
            .send(text)
        : reply.code(404).send({ error: "verified_evidence_not_found" });
    },
  );

  app.post<{
    Body: Partial<QuestPolicyInput> & { sourceReviewed?: boolean };
    Headers: { "x-quest-admin-key"?: string; "x-admin-actor"?: string };
  }>(
    "/v1/admin/quests",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const configuredKey = process.env.QUEST_ADMIN_API_KEY;
      const suppliedKey = request.headers["x-quest-admin-key"];
      if (!configuredKey)
        return reply.code(503).send({ error: "quest_admin_unconfigured" });
      if (
        !suppliedKey ||
        !timingSafeEqual(
          createHash("sha256").update(suppliedKey).digest(),
          createHash("sha256").update(configuredKey).digest(),
        )
      ) {
        return reply.code(401).send({ error: "quest_admin_unauthorized" });
      }
      const actor = request.headers["x-admin-actor"];
      if (
        !actor ||
        actor.length > 80 ||
        !/^[A-Za-z0-9_.@ -]{3,80}$/.test(actor)
      )
        return reply.code(400).send({ error: "valid_admin_actor_required" });
      if (!questAdmin)
        return reply.code(503).send({ error: "quest_database_unconfigured" });
      const body = request.body ?? {};
      const {
        slug,
        name,
        description,
        status,
        sourceUrl,
        rules,
        xpReward,
        verificationMethod,
        allowedEvidenceHosts,
        startsAt,
        endsAt,
        sourceReviewed,
      } = body;
      if (
        typeof slug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
        slug.length > 80 ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 120 ||
        typeof description !== "string" ||
        !description.trim() ||
        description.length > 2000 ||
        (status !== "active" && status !== "paused" && status !== "inactive") ||
        typeof sourceUrl !== "string" ||
        sourceUrl.length > 2048 ||
        typeof rules !== "string" ||
        !rules.trim() ||
        rules.length > 4000 ||
        !Number.isSafeInteger(xpReward) ||
        xpReward! < 1 ||
        xpReward! > 75 ||
        !["public_evidence", "manual", "hybrid"].includes(
          verificationMethod ?? "",
        ) ||
        !Array.isArray(allowedEvidenceHosts) ||
        allowedEvidenceHosts.length > 20 ||
        (status === "active" && allowedEvidenceHosts.length === 0) ||
        allowedEvidenceHosts.some(
          (host) =>
            typeof host !== "string" ||
            host.length > 253 ||
            !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
              host,
            ),
        ) ||
        (startsAt !== null &&
          startsAt !== undefined &&
          (typeof startsAt !== "string" ||
            !Number.isFinite(Date.parse(startsAt)))) ||
        (endsAt !== null &&
          endsAt !== undefined &&
          (typeof endsAt !== "string" ||
            !Number.isFinite(Date.parse(endsAt)))) ||
        sourceReviewed !== true
      ) {
        return reply.code(400).send({
          error: "invalid_quest_policy_or_operator_source_review_required",
        });
      }
      let officialSource: URL;
      try {
        officialSource = new URL(sourceUrl);
      } catch {
        return reply.code(400).send({ error: "invalid_quest_source_url" });
      }
      if (
        officialSource.protocol !== "https:" ||
        officialSource.username ||
        officialSource.password ||
        officialSource.port
      )
        return reply
          .code(400)
          .send({ error: "quest_source_must_be_public_https" });
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
        return reply.code(400).send({ error: "quest_end_must_follow_start" });
      try {
        const input: QuestPolicyInput = {
          slug,
          name: name.trim(),
          description: description.trim(),
          status,
          sourceUrl: officialSource.toString(),
          rules,
          xpReward: xpReward!,
          verificationMethod:
            verificationMethod as QuestPolicyInput["verificationMethod"],
          allowedEvidenceHosts,
          startsAt: startsAt ?? null,
          endsAt: endsAt ?? null,
        };
        const result = await questAdmin.createVersion(input, actor);
        return reply.code(201).send({
          item: result,
          sourceReviewed: true,
          sourceCheckedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error(
          { err: error },
          "Could not create quest policy version",
        );
        return reply
          .code(503)
          .send({ error: "quest_policy_persistence_unavailable" });
      }
    },
  );
  app.get<{ Headers: { "x-quest-admin-key"?: string } }>(
    "/v1/admin/claims/review",
    async (request, reply) => {
      const configuredKey = process.env.QUEST_ADMIN_API_KEY;
      const suppliedKey = request.headers["x-quest-admin-key"];
      if (!configuredKey)
        return reply.code(503).send({ error: "quest_admin_unconfigured" });
      if (
        !suppliedKey ||
        !timingSafeEqual(
          createHash("sha256").update(suppliedKey).digest(),
          createHash("sha256").update(configuredKey).digest(),
        )
      )
        return reply.code(401).send({ error: "quest_admin_unauthorized" });
      if (!questAdmin)
        return reply.code(503).send({ error: "quest_database_unconfigured" });
      try {
        return await questAdmin.listManualReviews(request.query);
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not load manual review queue");
        return reply
          .code(503)
          .send({ error: "manual_review_queue_unavailable" });
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: { outcome?: string; xpAward?: number; explanation?: string };
    Headers: { "x-quest-admin-key"?: string; "x-admin-actor"?: string };
  }>(
    "/v1/admin/claims/:id/review",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const configuredKey = process.env.QUEST_ADMIN_API_KEY;
      const suppliedKey = request.headers["x-quest-admin-key"];
      if (!configuredKey)
        return reply.code(503).send({ error: "quest_admin_unconfigured" });
      if (
        !suppliedKey ||
        !timingSafeEqual(
          createHash("sha256").update(suppliedKey).digest(),
          createHash("sha256").update(configuredKey).digest(),
        )
      )
        return reply.code(401).send({ error: "quest_admin_unauthorized" });
      const actor = request.headers["x-admin-actor"];
      if (
        !actor ||
        actor.length > 80 ||
        !/^[A-Za-z0-9_.@ -]{3,80}$/.test(actor)
      )
        return reply.code(400).send({ error: "valid_admin_actor_required" });
      if (!questAdmin)
        return reply.code(503).send({ error: "quest_database_unconfigured" });
      const { outcome, xpAward, explanation } = request.body ?? {};
      if (
        !/^[0-9a-f-]{36}$/i.test(request.params.id) ||
        outcome !== "rejected" ||
        xpAward !== 0 ||
        typeof explanation !== "string" ||
        !explanation.trim() ||
        explanation.length > 1000
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_manual_review_decision" });
      }
      try {
        const result = await questAdmin.reviewClaim(
          request.params.id,
          "rejected",
          0,
          explanation.trim(),
          actor,
        );
        if (result.kind === "claim_not_reviewable")
          return reply
            .code(409)
            .send({ error: "claim_not_in_manual_review_queue" });
        return { item: result };
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not record manual review");
        return reply
          .code(503)
          .send({ error: "manual_review_persistence_unavailable" });
      }
    },
  );
  app.get("/v1/claims", async (request, reply) => {
    if (!auth || !claims)
      return reply.code(503).send({ error: "claim_database_unconfigured" });
    let session: WalletSession | undefined;
    try {
      session = await auth.resolveSession(request.cookies.chog_session);
    } catch {
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
    if (!session)
      return reply.code(401).send({ error: "wallet_not_authenticated" });
    try {
      return await claims.listPageForWallet(session.walletId, request.query);
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not load wallet claims");
      return reply.code(503).send({ error: "claims_unavailable" });
    }
  });
  app.get<{ Params: { id: string } }>(
    "/v1/claims/:id",
    async (request, reply) => {
      if (!claims)
        return reply.code(503).send({ error: "claim_database_unconfigured" });
      if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
        return reply.code(400).send({ error: "invalid_claim_id" });
      try {
        const item = await claims.getPublic(request.params.id);
        return item
          ? { item }
          : reply.code(404).send({ error: "claim_not_found" });
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not load claim");
        return reply.code(503).send({ error: "claim_unavailable" });
      }
    },
  );

  app.post<{
    Body: { outcome?: string };
    Headers: { "idempotency-key"?: string };
  }>("/v1/dev/scenarios", async (request, reply) => {
    if (!localDemoEnabled())
      return reply.code(404).send({ error: "not_found" });
    const key = request.headers["idempotency-key"];
    if (!key || key.length > 200)
      return reply
        .code(400)
        .send({ error: "valid_idempotency_key_required", simulated: true });
    const outcome = request.body?.outcome;
    if (
      outcome !== "accepted" &&
      outcome !== "rejected" &&
      outcome !== "pending"
    ) {
      return reply.code(400).send({
        error: "outcome_must_be_accepted_rejected_or_pending",
        simulated: true,
      });
    }
    if (!scenarios)
      return reply.code(503).send({
        error: "scenario_database_unconfigured",
        simulated: true,
        stateKind: "local_simulation",
      });
    try {
      const result = await scenarios.createOrGet(
        key,
        outcome as ScenarioOutcome,
      );
      return reply
        .code(result.duplicate ? 200 : 201)
        .send({ ...result.record, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof ApiError)
        return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "Could not persist local scenario");
      return reply.code(503).send({
        error: "scenario_persistence_unavailable",
        simulated: true,
        stateKind: "local_simulation",
      });
    }
  });
  app.get<{ Params: { id: string } }>(
    "/v1/dev/scenarios/:id",
    async (request, reply) => {
      if (!localDemoEnabled())
        return reply.code(404).send({ error: "not_found" });
      if (!scenarios)
        return reply.code(503).send({
          error: "scenario_database_unconfigured",
          simulated: true,
          stateKind: "local_simulation",
        });
      try {
        const scenario = await scenarios.get(request.params.id);
        return scenario
          ? scenario
          : reply.code(404).send({
              error: "scenario_not_found",
              simulated: true,
              stateKind: "local_simulation",
            });
      } catch (error) {
        if (error instanceof ApiError)
          return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "Could not load local scenario");
        return reply.code(503).send({
          error: "scenario_persistence_unavailable",
          simulated: true,
          stateKind: "local_simulation",
        });
      }
    },
  );
  return app;
}
