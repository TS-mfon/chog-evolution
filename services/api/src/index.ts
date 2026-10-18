import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { GridFSBucket, ObjectId } from "mongodb";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { MongoAuthRepository, type WalletSession } from "./auth-repository.js";
import {
  closeDatabase,
  connectDatabase,
  ensureIndexes,
  getDatabase,
} from "./mongo.js";
import { MongoProfileRepository } from "./profile-repository.js";
import { MongoClaimRepository } from "./claim-repository.js";
import {
  MongoQuestAdminRepository,
  type QuestPolicyInput,
} from "./quest-admin-repository.js";
import { MongoSocialRepository } from "./social-repository.js";
import { lookupPublicXProfile } from "./x-profile.js";
import {
  MongoScanRepository,
  parseScanTargets,
  scanTargetKey,
  type ScanCheckpoint,
} from "./scan-repository.js";
import type { ScenarioRepository, ScenarioOutcome } from "./repository.js";

const localDemoEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_LOCAL_DEMO_SCENARIOS === "true";

export function buildApp(repository?: ScenarioRepository): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  app.register(cookie);
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const mongo =
    repository || !process.env.MONGODB_URI ? undefined : getDatabase();
  const scenarios = repository;
  const auth = mongo ? new MongoAuthRepository(mongo) : undefined;
  const profiles = mongo ? new MongoProfileRepository(mongo) : undefined;
  const claims = mongo ? new MongoClaimRepository(mongo) : undefined;
  const questAdmin = mongo ? new MongoQuestAdminRepository(mongo) : undefined;
  const social = mongo ? new MongoSocialRepository(mongo) : undefined;
  const scans = mongo ? new MongoScanRepository(mongo) : undefined;
  app.addHook("onReady", async () => {
    if (mongo) {
      await connectDatabase();
      await ensureIndexes();
    }
  });
  app.addHook("onClose", async () => {
    await closeDatabase();
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "chog-api",
    timestamp: new Date().toISOString(),
  }));
  app.get("/ready", async (_request, reply) => {
    if (!mongo)
      return reply
        .code(503)
        .send({
          status: "not_ready",
          dependencies: { mongodb: "unconfigured" },
        });
    try {
      await mongo.command({ ping: 1 });
      return {
        status: "ready",
        service: "chog-api",
        dependencies: { mongodb: "available" },
      };
    } catch {
      return reply
        .code(503)
        .send({
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
          process.env.WEB_ORIGIN ?? "http://localhost:3000",
        );
        return reply.code(201).send(challenge);
      } catch (error) {
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
      request.log.error({ err: error }, "Could not resolve wallet session");
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
  });
  app.post("/v1/auth/logout", async (request, reply) => {
    try {
      if (auth) await auth.revokeSession(request.cookies.chog_session);
    } catch (error) {
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
      request.log.error({ err: error }, "Could not validate wallet session");
      return reply.code(503).send({ error: "wallet_session_unavailable" });
    }
    if (!session)
      return reply.code(401).send({ error: "wallet_not_authenticated" });
    try {
      const items = await profiles.listForWallet(session.walletId);
      const current = [];
      for (const item of items) {
        const rpcUrl =
          process.env[
            item.nft.mode === "demo"
              ? "MONAD_TESTNET_RPC_URL"
              : "MONAD_MAINNET_RPC_URL"
          ];
        if (!rpcUrl)
          return reply
            .code(503)
            .send({ error: "profile_ownership_rpc_unconfigured" });
        const ownerClient = createPublicClient({
          chain: defineChain({
            id: item.nft.chainId,
            name: "Monad",
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            rpcUrls: { default: { http: [rpcUrl] } },
          }),
          transport: http(rpcUrl, { timeout: 10_000, retryCount: 2 }),
        });
        const owner = await ownerClient.readContract({
          address: item.nft.collectionAddress,
          abi: parseAbi([
            "function ownerOf(uint256 tokenId) view returns (address)",
          ]),
          functionName: "ownerOf",
          args: [BigInt(item.nft.tokenId)],
        });
        if (owner.toLowerCase() === session.address.toLowerCase())
          current.push(item);
        else await profiles.releaseOwnership(session.walletId, item.id);
      }
      return { items: current };
    } catch (error) {
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
        const passport = await profiles.getPassport(request.params.id);
        return passport
          ? { item: passport }
          : reply.code(404).send({ error: "passport_not_found" });
      } catch (error) {
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
          claim_id: artifact.claim_id,
          artifact_id: artifact._id,
          status: "completed",
        });
        if (!job)
          return reply.code(404).send({ error: "artifact_not_found" });
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
      const username = request.body?.username?.replace(/^@/, "");
      if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username))
        return reply.code(400).send({ error: "valid_x_username_required" });
      const bearerToken = process.env.X_API_BEARER_TOKEN;
      if (!bearerToken)
        return reply.code(503).send({ error: "x_api_unconfigured" });
      try {
        const profile = await lookupPublicXProfile(username, bearerToken);
        if (!profile)
          return reply.code(404).send({ error: "x_profile_not_found" });
        const result = await social.verifyXChallenge(
          session.walletId,
          profile.username,
          profile.id,
          profile.description,
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
        request.log.error(
          { err: error },
          "Could not verify X bio with the official API",
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
      request.log.error({ err: error }, "Could not unlink X account");
      return reply.code(503).send({ error: "social_unlink_unavailable" });
    }
  });
  app.post<{ Body: { profileId?: string } }>(
    "/v1/scans",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth || !claims || !scans)
        return reply.code(503).send({ error: "scan_database_unconfigured" });
      let session: WalletSession | undefined;
      try {
        session = await auth.resolveSession(request.cookies.chog_session);
      } catch {
        return reply.code(503).send({ error: "wallet_session_unavailable" });
      }
      if (!session)
        return reply.code(401).send({ error: "wallet_not_authenticated" });
      const profileId = request.body?.profileId;
      if (typeof profileId !== "string" || !/^[0-9a-f-]{36}$/i.test(profileId))
        return reply.code(400).send({ error: "valid_profile_id_required" });
      const profile = await claims.getProfileForWallet(
        profileId,
        session.walletId,
      );
      if (!profile)
        return reply.code(404).send({ error: "profile_not_found_for_wallet" });
      const rpcUrl =
        process.env[
          profile.mode === "demo"
            ? "MONAD_TESTNET_RPC_URL"
            : "MONAD_MAINNET_RPC_URL"
        ];
      if (!rpcUrl)
        return reply.code(503).send({ error: "scan_rpc_unconfigured" });
      let targets;
      try {
        targets = parseScanTargets(process.env.MONAD_SCAN_TARGETS);
      } catch (error) {
        request.log.error({ err: error }, "Invalid configured scan targets");
        return reply.code(503).send({ error: "scan_targets_invalid" });
      }
      if (!targets.length)
        return reply.code(503).send({ error: "scan_targets_unconfigured" });
      const requestedMaxBlocks = Number(
        process.env.SCAN_MAX_BLOCK_RANGE ?? 10_000,
      );
      const requestedChunkBlocks = Number(process.env.SCAN_CHUNK_BLOCKS ?? 500);
      if (
        !Number.isSafeInteger(requestedMaxBlocks) ||
        requestedMaxBlocks < 100 ||
        requestedMaxBlocks > 50_000 ||
        !Number.isSafeInteger(requestedChunkBlocks) ||
        requestedChunkBlocks < 50 ||
        requestedChunkBlocks > 2_000
      ) {
        return reply
          .code(503)
          .send({ error: "scan_range_configuration_invalid" });
      }
      const maxBlocks = requestedMaxBlocks;
      const chunkBlocks = requestedChunkBlocks;
      let checkpoint: ScanCheckpoint | undefined;
      let jobId: string | undefined;
      try {
        const chainId = Number(profile.chain_id);
        targets = targets.filter((target) => target.chainId === chainId);
        if (!targets.length)
          return reply
            .code(503)
            .send({ error: "scan_targets_not_configured_for_profile_chain" });
        const chain = defineChain({
          id: chainId,
          name: profile.mode === "demo" ? "Monad Testnet" : "Monad",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
        });
        const client = createPublicClient({
          chain,
          transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }),
        });
        const owner = await client.readContract({
          address: profile.collection_address as `0x${string}`,
          abi: parseAbi([
            "function ownerOf(uint256 tokenId) view returns (address)",
          ]),
          functionName: "ownerOf",
          args: [BigInt(profile.token_id)],
        });
        if (owner.toLowerCase() !== session.address.toLowerCase())
          return reply
            .code(403)
            .send({ error: "nft_not_currently_owned_by_authenticated_wallet" });
        const latestBlock = await client.getBlockNumber();
        checkpoint = await scans.latestCheckpoint(profileId);
        jobId = await scans.start(
          session.walletId,
          profileId,
          chainId,
          checkpoint,
        );
        const walletTopic =
          `0x${session.address.toLowerCase().slice(2).padStart(64, "0")}` as `0x${string}`;
        let allComplete = true;
        for (const target of targets) {
          const key = scanTargetKey(target);
          const fromBlock = Math.max(
            target.startBlock,
            checkpoint.targets[key] ?? target.startBlock,
          );
          const toBlock = Math.min(
            Number(latestBlock),
            fromBlock + maxBlocks - 1,
          );
          if (fromBlock > Number(latestBlock)) {
            checkpoint.targets[key] = Number(latestBlock) + 1;
            continue;
          }
          for (let start = fromBlock; start <= toBlock; start += chunkBlocks) {
            const end = Math.min(toBlock, start + chunkBlocks - 1);
            const logs = await client.getLogs({
              address: target.address,
              fromBlock: BigInt(start),
              toBlock: BigInt(end),
            });
            const matching = logs
              .filter(
                (log) =>
                  log.topics[0]?.toLowerCase() ===
                    target.topic0.toLowerCase() &&
                  log.topics[target.walletTopicIndex]?.toLowerCase() ===
                    walletTopic,
              )
              .flatMap((log) =>
                log.transactionHash &&
                log.logIndex !== null &&
                log.blockNumber !== null
                  ? [
                      {
                        blockNumber: log.blockNumber,
                        transactionHash: log.transactionHash,
                        logIndex: log.logIndex,
                        topics: log.topics,
                      },
                    ]
                  : [],
              );
            await scans.saveEvents(
              jobId,
              profileId,
              chainId,
              target,
              walletTopic,
              matching,
            );
            checkpoint.targets[key] = end + 1;
            await scans.saveCheckpoint(jobId, checkpoint, "running");
          }
          if (toBlock < Number(latestBlock)) allComplete = false;
        }
        await scans.saveCheckpoint(
          jobId,
          checkpoint,
          allComplete ? "complete" : "partial",
        );
        const item = await scans.getForWallet(jobId, session.walletId);
        return reply.code(allComplete ? 200 : 202).send({
          item,
          candidateOnly: true,
          next: allComplete
            ? null
            : "POST /v1/scans to continue from the saved block checkpoint",
        });
      } catch (error) {
        request.log.error({ err: error }, "Monad ecosystem scan failed");
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === 11000
        )
          return reply.code(409).send({ error: "scan_already_running" });
        if (checkpoint && jobId) {
          try {
            await scans.saveCheckpoint(
              jobId,
              checkpoint,
              "failed",
              "scan_rpc_or_storage_failure",
            );
          } catch {
            /* preserve the original failure */
          }
        }
        return reply.code(503).send({ error: "scan_unavailable" });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/scans/:id",
    async (request, reply) => {
      if (!auth || !scans)
        return reply.code(503).send({ error: "scan_database_unconfigured" });
      let session: WalletSession | undefined;
      try {
        session = await auth.resolveSession(request.cookies.chog_session);
      } catch {
        return reply.code(503).send({ error: "wallet_session_unavailable" });
      }
      if (!session)
        return reply.code(401).send({ error: "wallet_not_authenticated" });
      if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
        return reply.code(400).send({ error: "invalid_scan_id" });
      try {
        const item = await scans.getForWallet(
          request.params.id,
          session.walletId,
        );
        return item
          ? { item, candidateOnly: true }
          : reply.code(404).send({ error: "scan_not_found" });
      } catch (error) {
        request.log.error({ err: error }, "Could not load scan job");
        return reply.code(503).send({ error: "scan_unavailable" });
      }
    },
  );
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
        const chain = defineChain({
          id: expectedChainId,
          name: demoMode ? "Monad Testnet" : "Monad Mainnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
        });
        const client = createPublicClient({
          chain,
          transport: http(rpcUrl, { timeout: 10_000, retryCount: 2 }),
        });
        const owner = await client.readContract({
          address: configuredCollection as `0x${string}`,
          abi: parseAbi([
            "function ownerOf(uint256 tokenId) view returns (address)",
          ]),
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
        });
        if (owner.toLowerCase() !== session.address.toLowerCase())
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
      return { items: await claims.listActiveQuests() };
    } catch (error) {
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
          ? reply.type("text/plain; charset=utf-8").send(item)
          : reply.code(404).send({ error: "verified_evidence_not_found" });
      } catch (error) {
        request.log.error(
          { err: error },
          "Could not resolve verified evidence reference",
        );
        return reply.code(503).send({ error: "evidence_unavailable" });
      }
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
        xpReward! > 10000 ||
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
        return { items: await questAdmin.listManualReviews() };
      } catch (error) {
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
      return { items: await claims.listForWallet(session.walletId) };
    } catch (error) {
      request.log.error({ err: error }, "Could not load wallet claims");
      return reply.code(503).send({ error: "claims_unavailable" });
    }
  });
  app.post<{
    Body: { profileId?: string; questId?: string; transactionHash?: string };
    Headers: { "idempotency-key"?: string };
  }>(
    "/v1/claims",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!auth || !claims)
        return reply.code(503).send({ error: "claim_database_unconfigured" });
      let session: WalletSession | undefined;
      try {
        session = await auth.resolveSession(request.cookies.chog_session);
      } catch (error) {
        request.log.error({ err: error }, "Could not validate claim session");
        return reply.code(503).send({ error: "wallet_session_unavailable" });
      }
      if (!session)
        return reply.code(401).send({ error: "wallet_not_authenticated" });
      const { profileId, questId, transactionHash } = request.body ?? {};
      const idempotencyKey = request.headers["idempotency-key"];
      if (
        !profileId ||
        !/^[0-9a-f-]{36}$/i.test(profileId) ||
        !questId ||
        !/^[0-9a-f-]{36}$/i.test(questId) ||
        !idempotencyKey ||
        idempotencyKey.length > 200 ||
        (transactionHash !== undefined &&
          !/^0x[0-9a-fA-F]{64}$/.test(transactionHash))
      ) {
        return reply
          .code(400)
          .send({ error: "valid_claim_identity_and_idempotency_key_required" });
      }
      const profile = await claims.getProfileForWallet(
        profileId,
        session.walletId,
      );
      if (!profile)
        return reply.code(404).send({ error: "profile_not_found_for_wallet" });
      const ownershipChainId = Number(profile.chain_id);
      const ownershipRpc =
        process.env[
          profile.mode === "demo"
            ? "MONAD_TESTNET_RPC_URL"
            : "MONAD_MAINNET_RPC_URL"
        ];
      if (!ownershipRpc)
        return reply
          .code(503)
          .send({ error: "profile_ownership_rpc_unconfigured" });
      try {
        const ownerClient = createPublicClient({
          chain: defineChain({
            id: ownershipChainId,
            name: "Monad",
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            rpcUrls: { default: { http: [ownershipRpc] } },
          }),
          transport: http(ownershipRpc, { timeout: 10_000, retryCount: 2 }),
        });
        const currentOwner = await ownerClient.readContract({
          address: profile.collection_address as `0x${string}`,
          abi: parseAbi([
            "function ownerOf(uint256 tokenId) view returns (address)",
          ]),
          functionName: "ownerOf",
          args: [BigInt(profile.token_id)],
        });
        if (currentOwner.toLowerCase() !== session.address.toLowerCase())
          return reply
            .code(403)
            .send({ error: "nft_not_currently_owned_by_authenticated_wallet" });
      } catch (error) {
        request.log.error(
          { err: error },
          "Could not recheck profile ownership",
        );
        return reply
          .code(503)
          .send({ error: "profile_ownership_verification_unavailable" });
      }
      try {
        const result = await claims.createOrGet({
          profileId,
          questId,
          walletId: session.walletId,
          walletAddress: session.address,
          idempotencyKey,
          ...(transactionHash
            ? { transactionHash: transactionHash as `0x${string}` }
            : {}),
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
          return reply.code(422).send({ error: "verified_bio_link_required" });
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
        request.log.error({ err: error }, "Could not persist claim");
        return reply.code(503).send({ error: "claim_submission_unavailable" });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/claims/:id",
    async (request, reply) => {
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
        const item = await claims.getForWallet(
          request.params.id,
          session.walletId,
        );
        return item
          ? { item }
          : reply.code(404).send({ error: "claim_not_found" });
      } catch (error) {
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

if (process.env.NODE_ENV !== "test") {
  const app = buildApp();
  await app.listen({
    port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
    host: "0.0.0.0",
  });
}
