/**
 * Acceptance tests against an owned, disposable Mongo replica-set database.
 * Run through scripts/test-integration.mjs, which owns creation and cleanup.
 * HTTP, chain and adjudicator providers below are explicit fixtures; Mongo,
 * transactions, indexes, repositories, worker leases and GridFS are real.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { MongoClient, GridFSBucket, ObjectId, type Db } from "mongodb";
import { privateKeyToAccount } from "viem/accounts";
import { encodeEventTopics, zeroAddress, type Address, type Hex } from "viem";
import sharp from "sharp";
import {
  MongoAuthRepository,
  type WalletSession,
} from "../src/auth-repository.js";
import { MongoSocialRepository } from "../src/social-repository.js";
import {
  MongoProfileRepository,
  type ProfileRecord,
} from "../src/profile-repository.js";
import { MongoClaimRepository } from "../src/claim-repository.js";
import { EvidencePreviewRepository } from "../src/evidence-preview.js";
import {
  MongoScanRepository,
  type ActivityProof,
} from "../src/scan-repository.js";
import { ensureIndexes, SCHEMA_VERSION } from "../src/mongo.js";
import { evidenceDigest } from "../src/evidence-source.js";
import { readSourceMedia } from "../src/media-capture.js";
import type { MetadataNetwork } from "../src/original-metadata.js";
import { ApiError, transferAbi, type ClientFactory } from "../src/config.js";
import { buildApp } from "../src/index.js";
import {
  recordOperationalMetric,
  operationalMetricsSummary,
} from "../src/operational-metrics.js";
import { finalize, processOne } from "../../evolution-worker/src/index.js";
import {
  processOneArtwork,
  REFERENCE_COMMIT,
} from "../../evolution-worker/src/artwork.js";
import { composeDemoChog } from "@chog/art-composition";
import { stageForXp, earnedTraitsForXp } from "@chog/evolution-rules";
import {
  validateTestDatabaseName,
  assertOwnedDatabase,
  dropOwnedDatabase,
} from "../../../scripts/test-integration.mjs";

const ORIGIN = "https://chog.example";
const COLLECTION = `0x${"41".repeat(20)}` as Address;
const ORIGINAL = `0x${"42".repeat(20)}` as Address;
const PROTOCOL = `0x${"43".repeat(20)}` as Address;
const expectedCollections = [
  "wallets",
  "wallet_auth_nonces",
  "wallet_sessions",
  "wallet_auth_proofs",
  "nft_profiles",
  "x_profile_link_challenges",
  "x_profile_links",
  "x_identity_bindings",
  "quests",
  "quest_policies",
  "claims",
  "evidence",
  "claim_attempts",
  "claim_events",
  "decisions",
  "xp_ledger",
  "evolution_jobs",
  "evolution_history",
  "artifacts",
  "audit_events",
  "evidence_previews",
  "source_media",
  "source_media_jobs",
  "chog_source_media.files",
  "chog_source_media.chunks",
  "chog_artifacts.files",
  "chog_artifacts.chunks",
  "scan_jobs",
  "scan_events",
  "rate_buckets",
  "operational_metrics",
  "schema_migrations",
  "source_capture_jobs",
] as const;
const cases: { id: string; work: () => Promise<void> }[] = [];
const test = (id: string, work: () => Promise<void>) =>
  cases.push({ id, work });
const touched = new Set<string>();
const databaseNames = new Set<string>();
let transactionCommands = 0;
let duplicateFailures = 0;
let db: Db;
let peerDb: Db;
let sequence = 100;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const owners = new Map<string, string>();
const receipts = new Map<string, any>();
const transactions = new Map<string, any>();
const blocks = new Map<bigint, any>();
const rpcCalls: string[] = [];
const factory: ClientFactory = (config) =>
  ({
    getChainId: async () => config.chainId,
    async readContract({ functionName, address, args }: any) {
      rpcCalls.push(functionName);
      if (functionName === "ownerOf") {
        const owner = owners.get(
          `${config.chainId}:${address.toLowerCase()}:${args[0]}`,
        );
        if (!owner) throw new Error("ERC721NonexistentToken");
        return owner;
      }
      if (functionName === "tokenURI")
        return `https://metadata.example.net/${args[0]}.json`;
      throw new Error("unexpected_rpc_read");
    },
    getBlockNumber: async () => 1_000_000n,
    getTransactionReceipt: async ({ hash: id }: any) => {
      const row = receipts.get(id);
      if (!row) throw new Error("fixture_receipt_missing");
      return row;
    },
    getTransaction: async ({ hash: id }: any) => {
      const row = transactions.get(id);
      if (!row) throw new Error("fixture_transaction_missing");
      return row;
    },
    getBlock: async ({ blockNumber }: any) => {
      const row = blocks.get(blockNumber);
      if (!row) throw new Error("fixture_block_missing");
      return row;
    },
    getBytecode: async () => "0x60016000",
  }) as any;

function account() {
  return privateKeyToAccount(hash(++sequence));
}

async function login(who = account(), target = db) {
  const auth = new MongoAuthRepository(target);
  const nonce = await auth.issueNonce(who.address, 10143, ORIGIN);
  const session = await auth.verifyAndCreateSession(
    nonce.message,
    await who.signMessage({ message: nonce.message }),
  );
  assert.ok(session, "signed_fixture_login");
  return { account: who, session };
}

async function profileFor(
  session: WalletSession,
  mode: "demo" | "original_companion" = "demo",
  target = db,
) {
  const identity = {
    chainId: mode === "demo" ? 10143 : 143,
    collectionAddress: mode === "demo" ? COLLECTION : ORIGINAL,
    tokenId: String(++sequence),
    mode,
  };
  owners.set(
    `${identity.chainId}:${identity.collectionAddress.toLowerCase()}:${identity.tokenId}`,
    session.address,
  );
  return new MongoProfileRepository(target).register(
    session.walletId,
    identity,
  );
}

async function fixture() {
  const identity = await login();
  const profile = await profileFor(identity.session);
  const profiles = new MongoProfileRepository(db);
  const provider = githubProvider(identity.session.address);
  const claims = new MongoClaimRepository(db, factory, provider.request);
  const previews = new EvidencePreviewRepository(db, factory, provider.request);
  const quest = await claims.questBySlug("ecosystem-contribution");
  assert.ok(quest, "active_contribution_policy");
  return { ...identity, profile, profiles, provider, claims, previews, quest };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function githubProvider(...wallets: string[]) {
  let revision = 1;
  let available = true;
  let fetches = 0;
  const ids = new Map<string, number>();
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.github.com", "controlled_github_host_only");
    const match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
    assert.ok(match, "controlled_github_path");
    fetches++;
    if (!available) return new Response("Fixture unavailable", { status: 503 });
    const name = `${match[1]}/${match[2]}`;
    if (!ids.has(name)) ids.set(name, ++sequence);
    if (match[3].startsWith("/git/ref/"))
      return Response.json({
        object: {
          type: "commit",
          sha: revision.toString(16).padStart(40, "0"),
        },
      });
    if (match[3] === "/readme")
      return Response.json({
        encoding: "base64",
        sha: (revision + 1000).toString(16).padStart(40, "0"),
        path: "README.md",
        content: Buffer.from(
          `# CHOG Monad implementation\nRevision ${revision}: a concrete guide to building source-bound contribution evidence.\nAuthors: ${wallets.join(", ")}`,
        ).toString("base64"),
      });
    assert.equal(match[3], "");
    return Response.json({
      id: ids.get(name),
      full_name: name,
      default_branch: "main",
      fork: false,
      private: false,
      description: "CHOG ecosystem contribution",
    });
  };
  return {
    request,
    get fetches() {
      return fetches;
    },
    change() {
      revision++;
    },
    outage() {
      available = false;
    },
    recover() {
      available = true;
    },
  };
}

function submission(f: Fixture, fields: Record<string, unknown> = {}) {
  return {
    walletId: f.session.walletId,
    walletAddress: f.session.address,
    profileId: f.profile.id,
    questId: String(f.quest._id),
    idempotencyKey: randomUUID(),
    authProofId: f.session.authProofId,
    ...fields,
  };
}

async function contribution(f: Fixture, fields: Record<string, unknown> = {}) {
  const result = await f.claims.createOrGet(
    submission(f, {
      url: `https://github.com/chog/project-${++sequence}`,
      ...fields,
    }),
  );
  assert.equal(result.kind, "claim", "claim_created_by_repository");
  if (result.kind !== "claim") throw new Error("claim_fixture_failed");
  return result.item.id;
}

async function itemFor(id: string, target = db) {
  const claim = await target.collection<any>("claims").findOne({ _id: id });
  assert.ok(claim, "persisted_claim");
  const [wallet, profile, policy, quest, evidence] = await Promise.all([
    target.collection<any>("wallets").findOne({ _id: claim.wallet_id }),
    target.collection<any>("nft_profiles").findOne({ _id: claim.profile_id }),
    target.collection<any>("quest_policies").findOne({ _id: claim.policy_id }),
    target.collection<any>("quests").findOne({ _id: claim.quest_id }),
    claim.current_attempt > 1
      ? target
          .collection<any>("claim_attempts")
          .findOne({ claim_id: id, attempt: claim.current_attempt })
          .then((row) => row?.evidence)
      : target.collection<any>("evidence").findOne({ claim_id: id }),
  ]);
  assert.ok(
    wallet && profile && policy && quest && evidence,
    "all_claim_relations_persisted",
  );
  return { claim, wallet, profile, policy, quest, evidence };
}

function decisionFor(
  item: Awaited<ReturnType<typeof itemFor>>,
  outcome = "accepted",
) {
  return {
    claim_id: item.claim.contract_claim_id ?? item.claim._id,
    claimant: item.wallet.address,
    profile_identity: `${item.profile.chain_id}:${item.profile.collection_address.toLowerCase()}:${item.profile.token_id}`,
    policy_version: item.policy.version,
    quest_id: item.quest._id,
    outcome,
    evidence_hash: item.evidence.content_hash,
    reason: "Controlled finalized adjudication",
    xp: outcome === "accepted" ? item.policy.xp_reward : 0,
  } as any;
}

async function readyToFinalize(id: string, target = db) {
  const reference = `fixture-finality:${id}`;
  await target
    .collection<any>("claims")
    .updateOne(
      { _id: id },
      {
        $set: {
          status: "awaiting_genlayer",
          genlayer_tx_id: reference,
          lease_token: randomUUID(),
          lease_until: new Date(Date.now() + 60_000),
        },
      },
    );
  return { item: await itemFor(id, target), reference };
}

async function accept(id: string, now = new Date(), target = db) {
  const { item, reference } = await readyToFinalize(id, target);
  await finalize(target, item, decisionFor(item), reference, {
    now,
    ownershipVerified: true,
  });
}

async function isolateClaimWorker(ids: string[]) {
  await db
    .collection<any>("claims")
    .updateMany(
      {
        _id: { $nin: ids },
        status: { $in: ["submitted", "awaiting_genlayer", "needs_review"] },
      },
      { $set: { next_attempt_at: new Date("2099-01-01") } },
    );
}

async function isolateArtworkWorker(ids: string[]) {
  await db
    .collection<any>("evolution_jobs")
    .updateMany(
      { _id: { $nin: ids }, status: { $in: ["queued", "generating"] } },
      { $set: { next_attempt_at: new Date("2099-01-01") } },
    );
}

async function bytes(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function link(
  session: WalletSession,
  providerId = String(++sequence),
  username = `chog${sequence}`,
) {
  const social = new MongoSocialRepository(db);
  const challenge = await social.createXChallenge(session.walletId);
  const result = await social.verifyXChallenge(
    session.walletId,
    username,
    providerId,
    `CHOG builder ${challenge.bioCode}`,
    {
      method: "public_page",
      url: `https://x.com/${username}`,
      fetchedAt: new Date().toISOString(),
      parserVersion: "fixture-v1",
    },
  );
  assert.equal(result.kind, "verified");
  return { social, providerId, username };
}

test("01_cleanup_ownership_negative_and_positive_controls", async () => {
  const name = db.databaseName;
  validateTestDatabaseName(name, name);
  for (const unsafe of [
    "chog",
    "admin",
    "chog_production",
    "chog_test_",
    "chog_test_../production",
    name + "x",
  ]) {
    assert.throws(
      () => validateTestDatabaseName(unsafe),
      /unsafe_test_database/,
    );
    let touchedUnsafe = false;
    const forbidden = {
      databaseName: unsafe,
      collection() {
        touchedUnsafe = true;
        throw new Error("unsafe_access");
      },
      dropDatabase() {
        touchedUnsafe = true;
        throw new Error("unsafe_drop");
      },
    };
    await assert.rejects(
      dropOwnedDatabase(forbidden, name, process.env.CHOG_INTEGRATION_RUN_ID),
      /unsafe_test_database/,
    );
    assert.equal(
      touchedUnsafe,
      false,
      "unsafe_name_rejected_before_database_access",
    );
  }
  await assert.rejects(
    assertOwnedDatabase(db, name, randomUUID()),
    /test_database_ownership_mismatch/,
  );
  await assert.rejects(
    dropOwnedDatabase(db, name, randomUUID()),
    /test_database_ownership_mismatch/,
  );
  await assertOwnedDatabase(db, name, process.env.CHOG_INTEGRATION_RUN_ID);
  assert.equal(await db.collection("_integration_owner").countDocuments(), 1);
});

test("02_additive_legacy_migration_and_repeatability", async () => {
  const legacy = {
    wallet: randomUUID(),
    profile: randomUUID(),
    quest: randomUUID(),
    policy: randomUUID(),
    claim: randomUUID(),
    history: randomUUID(),
  };
  const now = new Date("2025-01-01T12:00:00Z");
  const payload = {
    text: JSON.stringify({
      kind: "public_evidence",
      signed_historical_content: "preserve byte for byte",
    }),
  };
  const decision = {
    _id: randomUUID(),
    claim_id: legacy.claim,
    finalized: true,
    outcome: "accepted",
    finalized_at: now,
    xp_award: 150,
    payload: { outcome: "accepted", xp: 150 },
  };
  await db
    .collection<any>("wallets")
    .insertOne({
      _id: legacy.wallet,
      address: account().address.toLowerCase(),
      created_at: now,
    });
  await db
    .collection<any>("quests")
    .insertOne({
      _id: legacy.quest,
      slug: "historical-contribution",
      name: "Historical reward",
      status: "inactive",
      created_at: now,
    });
  await db
    .collection<any>("quest_policies")
    .insertOne({
      _id: legacy.policy,
      quest_id: legacy.quest,
      version: 1,
      xp_reward: 150,
      policy: { kind: "public_evidence", rewardPolicyVersion: 2 },
      created_at: now,
    });
  await db
    .collection<any>("nft_profiles")
    .insertOne({
      _id: legacy.profile,
      chain_id: 10143,
      collection_address: COLLECTION.toLowerCase(),
      token_id: "1",
      mode: "demo",
      owner_wallet_id: legacy.wallet,
      xp: 150,
      level: 3,
      stage: "explorer",
      traits: ["legacy trait"],
      version: 1,
      created_at: now,
      updated_at: now,
    });
  await db
    .collection<any>("claims")
    .insertOne({
      _id: legacy.claim,
      profile_id: legacy.profile,
      wallet_id: legacy.wallet,
      quest_id: legacy.quest,
      policy_id: legacy.policy,
      status: "accepted",
      evidence_key: evidenceDigest(payload.text),
      idempotency_key: "historical-key",
      created_at: now,
    });
  const evidence = {
    _id: randomUUID(),
    claim_id: legacy.claim,
    content_hash: evidenceDigest(payload.text),
    payload,
    captured_at: now,
  };
  await db.collection<any>("evidence").insertOne(evidence);
  await db.collection<any>("decisions").insertOne(decision);
  await db
    .collection<any>("xp_ledger")
    .insertOne({
      _id: randomUUID(),
      claim_id: legacy.claim,
      profile_id: legacy.profile,
      amount: 150,
      created_at: now,
    });
  await db
    .collection<any>("evolution_history")
    .insertOne({
      _id: legacy.history,
      profile_id: legacy.profile,
      claim_id: legacy.claim,
      previous_version: 0,
      new_version: 1,
      xp_total: 150,
      changes: { xpAward: 150 },
      finalized: true,
      outcome: "accepted",
      created_at: now,
    });
  await db
    .collection<any>("evolution_jobs")
    .insertOne({
      _id: randomUUID(),
      profile_id: legacy.profile,
      claim_id: legacy.claim,
      status: "completed",
      evolution_version: 1,
      snapshot: { xp: 150, stage: "explorer" },
      created_at: now,
    });
  await db
    .collection<any>("artifacts")
    .insertOne({
      _id: randomUUID(),
      profile_id: legacy.profile,
      claim_id: legacy.claim,
      evolution_version: 1,
      created_at: now,
    });
  for (const name of ["evolution_jobs", "evolution_history", "artifacts"])
    await db.collection(name).createIndex({ claim_id: 1 }, { unique: true });
  await db
    .collection("claims")
    .createIndex({ wallet_id: 1, quest_id: 1 }, { unique: true });
  await ensureIndexes(db);
  const indexes = await Promise.all(
    expectedCollections
      .filter((name) => !name.includes(".files") && !name.includes(".chunks"))
      .map(async (name) => [
        name,
        await db.collection(name).listIndexes().toArray(),
      ]),
  );
  const policies = await db
    .collection<any>("quest_policies")
    .find({})
    .sort({ _id: 1 })
    .toArray();
  await ensureIndexes(peerDb);
  assert.deepEqual(
    await db
      .collection<any>("quest_policies")
      .find({})
      .sort({ _id: 1 })
      .toArray(),
    policies,
    "second_migration_does_not_create_policy_versions",
  );
  for (const [name, expected] of indexes)
    assert.deepEqual(
      await db
        .collection(name as string)
        .listIndexes()
        .toArray(),
      expected,
    );
  assert.deepEqual(
    await db.collection<any>("evidence").findOne({ _id: evidence._id }),
    evidence,
  );
  assert.deepEqual(
    await db.collection<any>("decisions").findOne({ _id: decision._id }),
    decision,
  );
  const migrated = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: legacy.profile });
  assert.equal(migrated.xp, 150);
  assert.deepEqual(migrated.traits, ["legacy trait"]);
  assert.deepEqual(migrated.earned_trait_ids, earnedTraitsForXp(150));
  const ledger = await db
    .collection<any>("xp_ledger")
    .findOne({ claim_id: legacy.claim });
  assert.equal(ledger.amount, 150);
  assert.equal(ledger.wallet_id, legacy.wallet);
  assert.equal(ledger.reward_family, "contribution");
  const attempt = await db
    .collection<any>("claim_attempts")
    .findOne({ claim_id: legacy.claim, attempt: 1 });
  assert.deepEqual(attempt.evidence, evidence);
  assert.deepEqual(attempt.decision, decision.payload);
  assert.equal(
    await db
      .collection<any>("schema_migrations")
      .countDocuments({ _id: `mongodb-${SCHEMA_VERSION}` }),
    1,
  );
  // Model termination after the history row was upgraded but before its related
  // records. An already-migrated history must still drive recovery on restart.
  for (const name of ["evolution_jobs", "artifacts"])
    await db
      .collection<any>(name)
      .updateOne(
        { claim_id: legacy.claim },
        { $unset: { source_event_id: "", kind: "" } },
      );
  await ensureIndexes(peerDb);
  for (const name of ["evolution_jobs", "artifacts"])
    assert.equal(
      (await db.collection<any>(name).findOne({ claim_id: legacy.claim }))
        .source_event_id,
      legacy.history,
    );
  for (const name of ["evolution_jobs", "evolution_history", "artifacts"]) {
    const list = await db.collection(name).listIndexes().toArray();
    assert.ok(!list.some((index) => index.name === "claim_id_1"));
    assert.ok(
      list.some(
        (index) =>
          index.name === "unique_claim_v3" &&
          index.unique &&
          index.partialFilterExpression?.claim_id?.$type === "string",
      ),
    );
  }
});

test("03_real_transactions_rollback_and_unique_index_controls", async () => {
  const id = randomUUID();
  const session = db.client.startSession();
  try {
    await assert.rejects(
      session.withTransaction(async () => {
        await db
          .collection<any>("audit_events")
          .insertOne(
            { _id: id, action: "rollback-control", created_at: new Date() },
            { session },
          );
        throw new Error("intentional_rollback");
      }),
      /intentional_rollback/,
    );
  } finally {
    await session.endSession();
  }
  assert.equal(
    await peerDb.collection<any>("audit_events").findOne({ _id: id }),
    null,
  );
  await db
    .collection<any>("audit_events")
    .insertOne({ _id: id, action: "commit-control", created_at: new Date() });
  assert.ok(await peerDb.collection<any>("audit_events").findOne({ _id: id }));
  await assert.rejects(
    peerDb.collection<any>("audit_events").insertOne({ _id: id }),
    { code: 11000 },
  );
  const f = await fixture();
  const row = await db
    .collection<any>("wallets")
    .findOne({ _id: f.session.walletId });
  await assert.rejects(
    peerDb.collection<any>("wallets").insertOne({ ...row, _id: randomUUID() }),
    { code: 11000 },
  );
  const nft = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  await assert.rejects(
    peerDb
      .collection<any>("nft_profiles")
      .insertOne({ ...nft, _id: randomUUID() }),
    { code: 11000 },
  );
});

test("04_concurrent_signed_nonce_replay_has_one_session_and_proof", async () => {
  const who = account();
  const auth = new MongoAuthRepository(db),
    peer = new MongoAuthRepository(peerDb);
  const nonce = await auth.issueNonce(who.address, 10143, ORIGIN);
  const signature = await who.signMessage({ message: nonce.message });
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? auth : peer).verifyAndCreateSession(nonce.message, signature),
    ),
  );
  const winners = results.filter(Boolean);
  assert.equal(winners.length, 1);
  const winner = winners[0]!;
  assert.equal(
    await db
      .collection("wallet_auth_proofs")
      .countDocuments({ wallet_id: winner.walletId }),
    1,
  );
  assert.equal(
    await db
      .collection("wallet_sessions")
      .countDocuments({ wallet_id: winner.walletId }),
    1,
  );
  const stored = await db
    .collection<any>("wallet_sessions")
    .findOne({ wallet_id: winner.walletId });
  assert.notEqual(stored.token_hash, winner.sessionId.split(".")[1]);
  assert.ok(!JSON.stringify(stored).includes(winner.sessionId.split(".")[1]));
  assert.equal(
    (await peer.resolveSession(winner.sessionId))?.walletId,
    winner.walletId,
  );
});

test("05_authentication_tampering_expiry_and_revocation", async () => {
  const who = account(),
    attacker = account();
  const auth = new MongoAuthRepository(db);
  const nonce = await auth.issueNonce(who.address, 10143, ORIGIN);
  for (const message of [
    nonce.message.replace("Domain: chog.example", "Domain: evil.example"),
    nonce.message.replace("Chain ID: 10143", "Chain ID: 143"),
    nonce.message.replace(who.address, attacker.address),
    nonce.message.replace("URI: " + ORIGIN, "URI: https://evil.example"),
    nonce.message + "\nextra",
  ]) {
    assert.equal(
      await auth.verifyAndCreateSession(
        message,
        await who.signMessage({ message }),
      ),
      undefined,
    );
  }
  assert.equal(
    await auth.verifyAndCreateSession(
      nonce.message,
      await attacker.signMessage({ message: nonce.message }),
    ),
    undefined,
  );
  assert.equal(
    await auth.verifyAndCreateSession(nonce.message, "0x00"),
    undefined,
  );
  const session = await auth.verifyAndCreateSession(
    nonce.message,
    await who.signMessage({ message: nonce.message }),
  );
  assert.ok(session, "negative_signatures_do_not_consume_legitimate_nonce");
  assert.equal(
    await auth.resolveSession(session.sessionId + ".extra"),
    undefined,
  );
  assert.equal(
    await auth.resolveSession(session.sessionId.replace(/.$/, "!")),
    undefined,
  );
  await auth.revokeSession(session.sessionId.replace(/.$/, "!"));
  assert.ok(await auth.resolveSession(session.sessionId));
  await auth.revokeSession(session.sessionId);
  assert.equal(
    await new MongoAuthRepository(peerDb).resolveSession(session.sessionId),
    undefined,
  );
  const fresh = await login(who);
  await db
    .collection<any>("wallet_sessions")
    .updateOne(
      { _id: fresh.session.sessionId.split(".")[0] },
      { $set: { expires_at: new Date(Date.now() - 1_000) } },
    );
  assert.equal(await auth.resolveSession(fresh.session.sessionId), undefined);
  const expired = await auth.issueNonce(who.address, 10143, ORIGIN);
  await db
    .collection<any>("wallet_auth_nonces")
    .updateOne(
      { message: expired.message },
      { $set: { expires_at: new Date(Date.now() - 1_000) } },
    );
  assert.equal(
    await auth.verifyAndCreateSession(
      expired.message,
      await who.signMessage({ message: expired.message }),
    ),
    undefined,
  );
});

test("06_social_identity_race_permanent_binding_and_rename", async () => {
  const a = await login(),
    b = await login();
  const sa = new MongoSocialRepository(db),
    sb = new MongoSocialRepository(peerDb);
  const ca = await sa.createXChallenge(a.session.walletId),
    cb = await sb.createXChallenge(b.session.walletId);
  const providerId = String(++sequence);
  const results = await Promise.all([
    sa.verifyXChallenge(
      a.session.walletId,
      "sameidentity",
      providerId,
      ca.bioCode,
    ),
    sb.verifyXChallenge(
      b.session.walletId,
      "sameidentity",
      providerId,
      cb.bioCode,
    ),
  ]);
  assert.equal(results.filter((r) => r.kind === "verified").length, 1);
  assert.equal(
    results.filter((r) => r.kind === "x_account_already_linked").length,
    1,
  );
  const winner = results[0].kind === "verified" ? a : b;
  const loser = winner === a ? b : a;
  await sa.unlinkX(winner.session.walletId);
  const challenge = await sa.createXChallenge(loser.session.walletId);
  assert.equal(
    (
      await sa.verifyXChallenge(
        loser.session.walletId,
        "sameidentity",
        providerId,
        challenge.bioCode,
      )
    ).kind,
    "x_account_already_linked",
  );
  assert.equal(
    await db
      .collection("x_identity_bindings")
      .countDocuments({ provider_user_id: providerId }),
    1,
  );
  const renamed = await sa.createXChallenge(winner.session.walletId);
  assert.equal(
    (
      await sa.verifyXChallenge(
        winner.session.walletId,
        "renamedidentity",
        providerId,
        renamed.bioCode,
      )
    ).kind,
    "verified",
  );
  assert.equal(
    (await sa.getXLink(winner.session.walletId))?.username,
    "renamedidentity",
  );
  assert.equal(
    (
      await sa.verifyXChallenge(
        winner.session.walletId,
        "renamedidentity",
        providerId,
        renamed.bioCode,
      )
    ).kind,
    "challenge_missing_or_expired",
  );
  const expiring = await sa.createXChallenge(loser.session.walletId);
  await db
    .collection<any>("x_profile_link_challenges")
    .updateOne(
      { wallet_id: loser.session.walletId },
      { $set: { expires_at: new Date(0) } },
    );
  assert.equal(
    (
      await sa.verifyXChallenge(
        loser.session.walletId,
        "expired",
        String(++sequence),
        expiring.bioCode,
      )
    ).kind,
    "challenge_missing_or_expired",
  );
  const stale = await sa.createXChallenge(loser.session.walletId);
  assert.equal(
    (
      await sa.verifyXChallenge(
        loser.session.walletId,
        "staleprofile",
        String(++sequence),
        stale.bioCode,
        {
          method: "public_page",
          url: "https://x.com/staleprofile",
          fetchedAt: "2020-01-01T00:00:00Z",
          parserVersion: "fixture",
        },
      )
    ).kind,
    "bio_code_not_found",
  );
});

test("07_repository_authorization_rejects_cross_wallet_access", async () => {
  const f = await fixture(),
    stranger = await login();
  const id = await contribution(f);
  const preview = await f.previews.create(
    f.session,
    {
      profileId: f.profile.id,
      url: `https://github.com/chog/private-${++sequence}`,
    },
    "owner-preview",
  );
  assert.equal(
    await f.claims.getForWallet(id, stranger.session.walletId),
    null,
  );
  await assert.rejects(
    f.claims.retry(
      id,
      stranger.session.walletId,
      stranger.session.address,
      "stolen",
      stranger.session.authProofId,
    ),
    /claim_not_found/,
  );
  await assert.rejects(
    f.previews.get(preview.id, stranger.session.walletId),
    /preview_not_found/,
  );
  await assert.rejects(
    f.previews.retry(preview.id, stranger.session.walletId, "stolen"),
    /preview_not_found/,
  );
  await assert.rejects(
    f.previews.create(
      stranger.session,
      { profileId: f.profile.id, url: "https://github.com/chog/stolen" },
      "stolen",
    ),
    /not_currently_owned/,
  );
  await assert.rejects(
    f.profiles.setEquipment(
      stranger.session.walletId,
      stranger.session.address,
      f.profile.id,
      [],
      0,
      "stolen",
      factory,
    ),
    /not_currently_owned/,
  );
  const denied = await f.claims.createOrGet({
    ...submission(f),
    walletId: stranger.session.walletId,
    walletAddress: stranger.session.address,
  });
  assert.equal(denied.kind, "quest_unavailable");
});

async function xFixture() {
  const f = await fixture();
  const identity = await link(f.session);
  const postId = String(++sequence);
  const image = await sharp({
    create: { width: 64, height: 64, channels: 4, background: "#77aa33" },
  })
    .png()
    .toBuffer();
  let revision = 1;
  let failSecond = true;
  let onMedia: ((index: number) => Promise<void>) | undefined;
  const requests = { page: 0, media: [0, 0] };
  const urls = [0, 1].map(
    (i) => `https://pbs.twimg.com/media/post${postId}_${i}.png`,
  );
  const url = `https://x.com/${identity.username}/status/${postId}`;
  const request: typeof fetch = async (input) => {
    const href = String(input);
    if (href === url) {
      requests.page++;
      const user = {
        __typename: "User",
        rest_id: identity.providerId,
        core: { screen_name: identity.username },
        profile_bio: { description: "CHOG contributor" },
      };
      const tweet = {
        __typename: "Tweet",
        rest_id: postId,
        core: { user_results: { rest_id: identity.providerId, result: user } },
        details: {
          full_text: `CHOG source revision ${revision}: an original Monad implementation guide.`,
          created_at_ms: 1_792_368_000_000,
        },
        media_entities2: urls.map((media_url_https) => ({
          type: "photo",
          media_url_https,
        })),
      };
      const body = `<script>window.cache.push({key:"data",value:${JSON.stringify(JSON.stringify({ data: { tweet_result_by_rest_id: { result: tweet } } }))}})</script>`;
      return new Response(body, { headers: { "content-type": "text/html" } });
    }
    const index = urls.indexOf(href);
    assert.ok(index >= 0, "unregistered_external_request");
    requests.media[index]++;
    await onMedia?.(index);
    if (index === 1 && failSecond)
      return new Response("Fixture media outage", { status: 503 });
    return new Response(image, { headers: { "content-type": "image/png" } });
  };
  return {
    ...f,
    identity,
    postId,
    image,
    url,
    urls,
    requests,
    request,
    previews: new EvidencePreviewRepository(db, factory, request),
    claims: new MongoClaimRepository(db, factory, request),
    change() {
      revision++;
    },
    recover() {
      failSecond = false;
    },
    fail() {
      failSecond = true;
    },
    observeMedia(callback: (index: number) => Promise<void>) {
      onMedia = callback;
    },
  };
}

test("08_preview_source_checkpoint_partial_media_restart_and_lease_race", async () => {
  const f = await xFixture();
  const observed: any[] = [];
  f.observeMedia(async () => {
    const row = await peerDb
      .collection<any>("evidence_previews")
      .findOne({ wallet_id: f.session.walletId, idempotency_key: "partial" });
    observed.push(row?.source);
  });
  const preview = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url: f.url },
    "partial",
  );
  assert.equal(preview.status, "source_unavailable");
  assert.equal(preview.errorCode, "evidence_media_capture_incomplete");
  assert.ok(
    observed.length === 2 &&
      observed.every((source) =>
        source?.public_content.text.includes("revision 1"),
      ),
    "source_is_durable_before_first_media_request",
  );
  const row = await db
    .collection<any>("evidence_previews")
    .findOne({ _id: preview.id });
  const frozenText = row.source.public_content.text;
  const captured = await db
    .collection<any>("source_media")
    .findOne({ job_id: preview.id, source_url: f.urls[0] });
  assert.equal(captured.status, "captured");
  const found = await readSourceMedia(peerDb, captured._id);
  assert.ok(found);
  assert.deepEqual(await bytes(found.stream), f.image);
  assert.equal(captured.sha256, sha256(f.image));
  const missing = await db
    .collection<any>("source_media")
    .findOne({ job_id: preview.id, source_url: f.urls[1] });
  const orphanId = new ObjectId();
  await db
    .collection<any>("source_media")
    .updateOne(
      { _id: missing._id },
      {
        $set: {
          gridfs_id: orphanId.toHexString(),
          sha256: sha256(f.image),
          bytes: f.image.length,
          width: 64,
          height: 64,
          mime_type: "image/png",
          status: "capturing",
        },
      },
    );
  await db
    .collection<any>("chog_source_media.chunks")
    .insertOne({
      _id: new ObjectId(),
      files_id: orphanId,
      n: 0,
      data: Buffer.from("interrupted upload"),
    });
  await db
    .collection<any>("evidence_previews")
    .updateOne(
      { _id: preview.id },
      {
        $set: {
          status: "reading",
          next_attempt_at: null,
          lease_token: "terminated-worker",
          lease_until: new Date(Date.now() - 1_000),
        },
      },
    );
  f.change();
  f.recover();
  const restarted = new EvidencePreviewRepository(peerDb, factory, f.request);
  const results = await Promise.all([
    f.previews.process(preview.id),
    restarted.process(preview.id),
  ]);
  assert.equal(
    results.filter(Boolean).length,
    1,
    "only_one_worker_acquires_preview",
  );
  const ready = await restarted.get(preview.id, f.session.walletId);
  assert.equal(ready.status, "ready");
  assert.equal(ready.source.public_content.text, frozenText);
  assert.equal(f.requests.page, 1, "restart_reuses_exact_source_revision");
  assert.deepEqual(
    f.requests.media,
    [1, 2],
    "restart_reuses_completed_image_and_fetches_missing_image",
  );
  assert.equal(ready.media[0].mediaId, captured._id);
  assert.equal(
    await db
      .collection("chog_source_media.chunks")
      .countDocuments({ files_id: orphanId }),
    0,
  );
  assert.equal(
    await db.collection("source_media").countDocuments({ job_id: preview.id }),
    2,
  );
  assert.equal(
    await db
      .collection("chog_source_media.files")
      .countDocuments({ "metadata.jobId": preview.id }),
    2,
  );
});

test("09_expired_preview_has_fresh_capture_identity_and_replay", async () => {
  const f = await xFixture();
  f.recover();
  const first = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url: f.url },
    "fresh",
  );
  assert.equal(first.status, "ready");
  const original = structuredClone(first.source);
  await db
    .collection<any>("evidence_previews")
    .updateOne({ _id: first.id }, { $set: { expires_at: new Date(0) } });
  assert.equal(
    (await f.previews.get(first.id, f.session.walletId)).status,
    "expired",
  );
  f.change();
  const retry = await new EvidencePreviewRepository(
    peerDb,
    factory,
    f.request,
  ).retry(first.id, f.session.walletId, "recapture");
  assert.equal(retry.status, "ready");
  assert.match(retry.source.public_content.text, /revision 2/);
  assert.notEqual(retry.source.content_hash, original.content_hash);
  assert.notEqual(retry.media[0].mediaId, first.media[0].mediaId);
  const row = await db
    .collection<any>("evidence_previews")
    .findOne({ _id: first.id });
  assert.notEqual(row.capture_job_id, first.id);
  assert.equal(
    await db
      .collection("source_media")
      .countDocuments({ job_id: row.capture_job_id }),
    2,
  );
  const calls = structuredClone(f.requests);
  const replay = await f.previews.retry(
    first.id,
    f.session.walletId,
    "recapture",
  );
  assert.equal(replay.source.content_hash, retry.source.content_hash);
  assert.deepEqual(f.requests, calls);
});

test("10_direct_and_numbered_capture_freezes_source_before_media", async () => {
  const f = await xFixture();
  const observed: any[] = [];
  f.observeMedia(async () => {
    const row = await peerDb
      .collection<any>("source_capture_jobs")
      .findOne({ "source.source_id": f.postId }, { sort: { created_at: -1 } });
    observed.push(row?.source?.public_content?.text);
  });
  const input = submission(f, {
    url: f.url,
    idempotencyKey: "interrupted-direct",
  });
  await assert.rejects(
    f.claims.createOrGet(input),
    /evidence_media_capture_incomplete/,
  );
  assert.ok(
    observed.length === 2 &&
      observed.every((text) => text?.includes("revision 1")),
  );
  f.change();
  f.recover();
  const resumed = await new MongoClaimRepository(
    peerDb,
    factory,
    f.request,
  ).createOrGet(input);
  assert.equal(resumed.kind, "claim");
  if (resumed.kind !== "claim") return;
  assert.equal(f.requests.page, 1);
  assert.match(
    JSON.parse((await f.claims.getPublicEvidence(resumed.item.id))!).source
      .public_content.text,
    /revision 1/,
  );
  const finalized = await readyToFinalize(resumed.item.id);
  await finalize(
    db,
    finalized.item,
    decisionFor(finalized.item, "source_unavailable"),
    finalized.reference,
  );
  f.fail();
  await assert.rejects(
    f.claims.retry(
      resumed.item.id,
      f.session.walletId,
      f.session.address,
      "numbered-retry",
      f.session.authProofId,
    ),
    /evidence_media_capture_incomplete/,
  );
  const saved = await db
    .collection<any>("source_capture_jobs")
    .findOne({ _id: `retry:${resumed.item.id}:2` });
  assert.match(saved.source.public_content.text, /revision 2/);
  assert.ok(observed.at(-1)?.includes("revision 2"));
  f.change();
  f.recover();
  const retry = await new MongoClaimRepository(
    peerDb,
    factory,
    f.request,
  ).retry(
    resumed.item.id,
    f.session.walletId,
    f.session.address,
    "numbered-retry",
    f.session.authProofId,
  );
  assert.equal(retry?.attempt, 2);
  assert.match(
    JSON.parse((await f.claims.getPublicEvidence(resumed.item.id, 2))!).source
      .public_content.text,
    /revision 2/,
  );
  assert.equal(
    f.requests.page,
    2,
    "numbered_retry_recovers_frozen_second_revision",
  );
  assert.deepEqual(f.requests.media, [2, 4]);
});

test("11_concurrent_claim_and_preview_consumption_exactly_once", async () => {
  const f = await fixture();
  const url = `https://github.com/chog/concurrent-${++sequence}`;
  const preview = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url },
    "concurrent-preview",
  );
  assert.equal(preview.status, "ready");
  const input = submission(f, {
    previewId: preview.id,
    idempotencyKey: "same-intent",
  });
  const peer = new MongoClaimRepository(peerDb, factory, f.provider.request);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? peer : f.claims).createOrGet(input),
    ),
  );
  assert.ok(results.every((result) => result.kind === "claim"));
  const claims = results.filter((result) => result.kind === "claim");
  assert.equal(new Set(claims.map((result) => result.item.id)).size, 1);
  assert.equal(claims.filter((result) => !result.duplicate).length, 1);
  const id = claims[0].item.id;
  for (const name of ["claims", "evidence", "claim_attempts"])
    assert.equal(
      await db
        .collection(name)
        .countDocuments(name === "claims" ? { _id: id } : { claim_id: id }),
      1,
    );
  assert.equal(
    await db
      .collection("claim_events")
      .countDocuments({ claim_id: id, event_key: "submitted" }),
    1,
  );
  assert.equal(
    (await f.previews.get(preview.id, f.session.walletId)).claimId,
    id,
  );
  const originalEvidence = await f.claims.getPublicEvidence(id);
  await db
    .collection<any>("evidence_previews")
    .updateOne({ _id: preview.id }, { $set: { expires_at: new Date(0) } });
  const repeat = await peer.createOrGet({
    ...input,
    idempotencyKey: "lost-response",
  });
  assert.equal(repeat.kind, "claim");
  if (repeat.kind === "claim") assert.equal(repeat.item.id, id);
  assert.equal(await f.claims.getPublicEvidence(id), originalEvidence);
  await assert.rejects(
    f.claims.createOrGet({ ...input, text: "tampered intent" }),
    /preview_request_mismatch/,
  );
  const duplicateSource = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url },
    "source-again",
  );
  assert.equal(duplicateSource.eligibility.eligible, false);
  assert.equal(duplicateSource.eligibility.reasonCode, "duplicate_source");
});

test("12_global_source_uniqueness_and_snapshot_tampering", async () => {
  const f = await fixture(),
    other = await fixture();
  const request = githubProvider(f.session.address, other.session.address);
  const left = new MongoClaimRepository(db, factory, request.request);
  const right = new MongoClaimRepository(peerDb, factory, request.request);
  const url = `https://github.com/chog/shared-${++sequence}`;
  const results = await Promise.allSettled([
    left.createOrGet(submission(f, { url })),
    right.createOrGet(submission(other, { url })),
  ]);
  assert.equal(
    results.filter(
      (result) =>
        result.status === "fulfilled" && result.value.kind === "claim",
    ).length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" &&
      rejected.reason instanceof ApiError &&
      rejected.reason.code === "evidence_already_claimed",
  );
  const preview = await f.previews.create(
    f.session,
    {
      profileId: f.profile.id,
      url: `https://github.com/chog/tamper-${++sequence}`,
    },
    "tamper",
  );
  await db
    .collection<any>("evidence_previews")
    .updateOne(
      { _id: preview.id },
      { $set: { "source.public_content.readme": "altered after capture" } },
    );
  await assert.rejects(
    f.claims.createOrGet(submission(f, { previewId: preview.id })),
    /preview_snapshot_invalid/,
  );
  assert.equal(
    await db
      .collection("claims")
      .countDocuments({
        wallet_id: f.session.walletId,
        source_key: `source:github:tampered`,
      }),
    0,
  );
});

test("13_numbered_retry_preserves_prior_evidence_and_decision", async () => {
  const f = await fixture();
  const id = await contribution(f);
  const originalEvidence = await db
    .collection<any>("evidence")
    .findOne({ claim_id: id });
  const ready = await readyToFinalize(id);
  const unavailable = decisionFor(ready.item, "source_unavailable");
  await finalize(db, ready.item, unavailable, ready.reference);
  const firstAttempt = await db
    .collection<any>("claim_attempts")
    .findOne({ claim_id: id, attempt: 1 });
  f.provider.change();
  const peer = new MongoClaimRepository(peerDb, factory, f.provider.request);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      (i % 2 ? peer : f.claims).retry(
        id,
        f.session.walletId,
        f.session.address,
        "same-retry",
        f.session.authProofId,
      ),
    ),
  );
  assert.ok(
    results.every((result) => result?.id === id && result.attempt === 2),
  );
  assert.equal(
    await db.collection("claim_attempts").countDocuments({ claim_id: id }),
    2,
  );
  assert.deepEqual(
    await db.collection<any>("evidence").findOne({ claim_id: id }),
    originalEvidence,
  );
  assert.deepEqual(
    await db
      .collection<any>("claim_attempts")
      .findOne({ claim_id: id, attempt: 1 }),
    firstAttempt,
  );
  const second = await db
    .collection<any>("claim_attempts")
    .findOne({ claim_id: id, attempt: 2 });
  assert.equal(second.contract_claim_id, `${id}:2`);
  assert.equal(
    second.evidence.source_url,
    `${ORIGIN}/api/v1/evidence/${id}/attempts/2`,
  );
  assert.notEqual(second.evidence.content_hash, originalEvidence.content_hash);
  assert.equal(
    await db.collection("decisions").countDocuments({ claim_id: id }),
    0,
  );
  const detail = await f.claims.getPublic(id);
  assert.equal(detail!.attempts.length, 2);
  assert.ok(!JSON.stringify(detail).includes("signature"));
  assert.ok(!JSON.stringify(detail).includes("Nonce:"));
  const current = await readyToFinalize(id);
  await finalize(
    db,
    current.item,
    decisionFor(current.item, "rejected"),
    current.reference,
  );
  await assert.rejects(
    f.claims.retry(
      id,
      f.session.walletId,
      f.session.address,
      "reopen-rejected",
      f.session.authProofId,
    ),
    /claim_not_retryable/,
  );
  assert.equal(
    await db.collection("xp_ledger").countDocuments({ claim_id: id }),
    0,
  );
});

test("14_concurrent_finalizations_cap_one_wallet_across_profiles", async () => {
  const f = await fixture();
  const profiles = [
    f.profile,
    await profileFor(f.session),
    await profileFor(f.session),
  ];
  const ids: string[] = [];
  for (let i = 0; i < 8; i++)
    ids.push(
      await contribution(f, { profileId: profiles[i % profiles.length].id }),
    );
  const ready = await Promise.all(ids.map((id) => readyToFinalize(id)));
  const now = new Date("2027-01-01T12:00:00.000Z");
  await Promise.all(
    ready.map(({ item, reference }, i) =>
      finalize(i % 2 ? peerDb : db, item, decisionFor(item), reference, {
        now,
        ownershipVerified: true,
      }),
    ),
  );
  const ledger = await db
    .collection<any>("xp_ledger")
    .find({ wallet_id: f.session.walletId })
    .toArray();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].amount, 75);
  assert.equal(
    await db
      .collection("claims")
      .countDocuments({ _id: { $in: ids }, status: "accepted" }),
    8,
  );
  assert.equal(
    await db
      .collection("decisions")
      .countDocuments({ claim_id: { $in: ids }, finalized: true, xp_award: 0 }),
    7,
  );
  for (const name of ["evolution_jobs", "evolution_history"])
    assert.equal(
      await db.collection(name).countDocuments({ claim_id: { $in: ids } }),
      1,
    );
  const updated = await db
    .collection<any>("nft_profiles")
    .find({ _id: { $in: profiles.map((p) => p.id) } })
    .toArray();
  assert.equal(
    updated.reduce((sum, p) => sum + p.xp, 0),
    75,
  );
  assert.equal(
    updated.reduce((sum, p) => sum + p.version, 0),
    1,
  );
  // A stale worker that already held the claim cannot duplicate its ledger/event.
  await Promise.all(
    ready.map(({ item, reference }) =>
      finalize(peerDb, item, decisionFor(item), reference, { now }),
    ),
  );
  assert.equal(
    await db
      .collection("xp_ledger")
      .countDocuments({ wallet_id: f.session.walletId }),
    1,
  );
  const other = await fixture();
  const separate = await contribution(other);
  await accept(separate, now);
  assert.equal(
    (await db.collection<any>("xp_ledger").findOne({ claim_id: separate }))
      .amount,
    75,
  );
});

test("15_utc_boundary_cooldown_and_zero_reward_history", async () => {
  const f = await fixture();
  const times = [
    "2027-03-01T23:50:00Z",
    "2027-03-02T00:20:00Z",
    "2027-03-02T00:50:00Z",
    "2027-03-02T02:00:00Z",
  ];
  const ids: string[] = [];
  for (const time of times) {
    const id = await contribution(f);
    ids.push(id);
    await accept(id, new Date(time));
  }
  const decisions = await Promise.all(
    ids.map((id) => db.collection<any>("decisions").findOne({ claim_id: id })),
  );
  assert.deepEqual(
    decisions.map((d) => d.xp_award),
    [75, 0, 75, 0],
  );
  assert.equal(decisions[1].reward_reason_code, "cooldown");
  assert.equal(decisions[3].reward_reason_code, "daily_cap");
  const profile = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.equal(profile.xp, 150);
  assert.equal(profile.version, 2);
  for (const id of [ids[1], ids[3]]) {
    for (const name of ["xp_ledger", "evolution_jobs", "evolution_history"])
      assert.equal(
        await db.collection(name).countDocuments({ claim_id: id }),
        0,
      );
    assert.equal(
      await db
        .collection("claim_events")
        .countDocuments({
          claim_id: id,
          event_key: "finalized",
          status: "accepted",
        }),
      1,
    );
  }
});

test("16_unknown_submissions_require_reconciliation_after_restart", async () => {
  const f = await fixture();
  const id = await contribution(f);
  await isolateClaimWorker([id]);
  let submissions = 0,
    reads = 0;
  let finalDecision: any = null;
  const adjudicator = {
    async submit() {
      submissions++;
      throw new Error("controlled_disconnect_after_submit");
    },
    async poll() {
      assert.fail("unknown_reference_must_not_poll");
    },
    async readDecision(contractId: string) {
      reads++;
      assert.equal(contractId, id);
      return finalDecision;
    },
  } as any;
  assert.equal(await processOne(db, adjudicator, { factory }), true);
  const uncertain = await peerDb.collection<any>("claims").findOne({ _id: id });
  assert.equal(uncertain.status, "needs_review");
  assert.equal(uncertain.last_error_code, "submission_reference_unknown");
  const metricsBeforeIdle = await db
    .collection<any>("operational_metrics")
    .find({ kind: "job", name: "claim" })
    .toArray();
  assert.equal(await processOne(peerDb, adjudicator, { factory }), false);
  assert.deepEqual(
    await db
      .collection<any>("operational_metrics")
      .find({ kind: "job", name: "claim" })
      .toArray(),
    metricsBeforeIdle,
    "idle_poll_does_not_count_a_job",
  );
  assert.equal(submissions, 1);
  assert.equal(reads, 0);
  await f.claims.retry(
    id,
    f.session.walletId,
    f.session.address,
    "reconcile-missing",
    f.session.authProofId,
  );
  assert.equal(await processOne(peerDb, adjudicator, { factory }), true);
  assert.equal(
    (await db.collection<any>("claims").findOne({ _id: id })).status,
    "needs_review",
  );
  assert.equal(submissions, 1);
  assert.equal(reads, 1);
  assert.equal(
    await db.collection("xp_ledger").countDocuments({ claim_id: id }),
    0,
  );
  finalDecision = decisionFor(await itemFor(id));
  await f.claims.retry(
    id,
    f.session.walletId,
    f.session.address,
    "reconcile-found",
    f.session.authProofId,
  );
  assert.equal(await processOne(db, adjudicator, { factory }), true);
  assert.equal(submissions, 1);
  assert.equal(reads, 2);
  assert.equal(
    (await db.collection<any>("claims").findOne({ _id: id })).status,
    "accepted",
  );
  assert.equal(
    await db.collection("xp_ledger").countDocuments({ claim_id: id }),
    1,
  );
  assert.equal(
    await db.collection("claim_attempts").countDocuments({ claim_id: id }),
    1,
  );
  const interrupted = await contribution(f);
  await isolateClaimWorker([interrupted]);
  await db
    .collection<any>("claims")
    .updateOne(
      { _id: interrupted },
      {
        $set: {
          status: "verifying",
          lease_token: "dead-process",
          lease_until: new Date(Date.now() - 120_000),
          genlayer_tx_id: null,
        },
      },
    );
  assert.equal(await processOne(peerDb, adjudicator, { factory }), false);
  const recovered = await db
    .collection<any>("claims")
    .findOne({ _id: interrupted });
  assert.equal(recovered.status, "needs_review");
  assert.equal(recovered.last_error_code, "submission_reference_unknown");
  assert.equal(submissions, 1);
});

test("17_pending_failed_mismatched_or_transferred_claims_grant_no_xp", async () => {
  const f = await fixture();
  const ids: string[] = [];
  for (const behavior of [
    "pending",
    "failed",
    "mismatched",
    "transferred",
  ] as const) {
    const id = await contribution(f);
    ids.push(id);
    await isolateClaimWorker([id]);
    await db
      .collection<any>("claims")
      .updateOne(
        { _id: id },
        {
          $set: {
            status: "awaiting_genlayer",
            genlayer_tx_id: hash(++sequence),
            lease_token: null,
            lease_until: null,
            next_attempt_at: null,
          },
        },
      );
    const item = await itemFor(id);
    const decision = decisionFor(item);
    if (behavior === "mismatched") decision.evidence_hash = hash(0);
    if (behavior === "transferred")
      owners.set(
        `${f.profile.nft.chainId}:${f.profile.nft.collectionAddress.toLowerCase()}:${f.profile.nft.tokenId}`,
        account().address,
      );
    let reads = 0;
    const client = {
      async submit() {
        assert.fail("existing_reference_must_not_resubmit");
      },
      async poll() {
        return behavior === "pending" || behavior === "failed"
          ? behavior
          : "finalized";
      },
      async readDecision() {
        reads++;
        return decision;
      },
    } as any;
    assert.equal(await processOne(db, client, { factory }), true);
    const current = await db.collection<any>("claims").findOne({ _id: id });
    if (behavior === "pending") {
      assert.equal(current.status, "awaiting_genlayer");
      assert.equal(reads, 0);
    }
    if (behavior === "failed") {
      assert.equal(current.status, "needs_review");
      assert.equal(reads, 0);
    }
    if (behavior === "mismatched") {
      assert.equal(current.failure_count, 1);
      assert.equal(
        current.last_error_code,
        "genlayer_decision_binding_invalid",
      );
    }
    if (behavior === "transferred") {
      assert.equal(current.status, "accepted");
      assert.equal(
        (await db.collection<any>("decisions").findOne({ claim_id: id }))
          .reward_reason_code,
        "ownership_changed",
      );
    }
  }
  for (const name of ["xp_ledger", "evolution_history", "evolution_jobs"])
    assert.equal(
      await db.collection(name).countDocuments({ claim_id: { $in: ids } }),
      0,
    );
  assert.equal(
    (await db.collection<any>("nft_profiles").findOne({ _id: f.profile.id }))
      .xp,
    0,
  );
  const item = await itemFor(ids[0]);
  for (const altered of [
    { claimant: account().address },
    { profile_identity: "wrong:profile" },
    { quest_id: randomUUID() },
    { policy_version: 99 },
    { claim_id: "other-attempt" },
    { xp: 76 },
  ]) {
    await assert.rejects(
      finalize(
        db,
        item,
        { ...decisionFor(item), ...altered },
        item.claim.genlayer_tx_id,
      ),
      /genlayer_decision_binding_invalid/,
    );
  }
});

async function setXp(f: Fixture, xp: number) {
  const stage = stageForXp(xp);
  await db
    .collection<any>("nft_profiles")
    .updateOne(
      { _id: f.profile.id },
      {
        $set: {
          xp,
          stage,
          level:
            ["hatchling", "curious", "explorer", "veteran", "legend"].indexOf(
              stage,
            ) + 1,
          earned_trait_ids: earnedTraitsForXp(xp),
        },
      },
    );
}

test("18_equipment_validation_race_noop_receipts_and_owner_transfer", async () => {
  const f = await fixture();
  await assert.rejects(
    f.profiles.setEquipment(
      f.session.walletId,
      f.session.address,
      f.profile.id,
      ["trail-scarf"],
      0,
      "locked",
      factory,
    ),
    /invalid_or_locked_traits/,
  );
  await setXp(f, 700);
  for (const invalid of [
    ["bright-eyes"],
    ["trail-scarf", "star-crown"],
    ["trail-scarf", "trail-scarf"],
    ["invented-trait"],
  ])
    await assert.rejects(
      f.profiles.setEquipment(
        f.session.walletId,
        f.session.address,
        f.profile.id,
        invalid,
        0,
        randomUUID(),
        factory,
      ),
      /invalid_or_locked_traits/,
    );
  const unchanged = await f.profiles.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    [],
    0,
    "noop",
    factory,
  );
  assert.equal(unchanged.version, 0);
  assert.equal(
    await db
      .collection("evolution_jobs")
      .countDocuments({ profile_id: f.profile.id }),
    0,
  );
  assert.equal(
    await db
      .collection("audit_events")
      .countDocuments({
        mutation_key: `traits:${f.session.walletId}:noop`,
        action: "traits_unchanged",
      }),
    1,
  );
  const peer = new MongoProfileRepository(peerDb);
  const contenders = ["trail-scarf", "star-crown"];
  const results = await Promise.allSettled(
    contenders.map((trait, i) =>
      (i ? peer : f.profiles).setEquipment(
        f.session.walletId,
        f.session.address,
        f.profile.id,
        [trait],
        0,
        `race-${i}`,
        factory,
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const failed = results.find((result) => result.status === "rejected");
  assert.ok(
    failed?.status === "rejected" &&
      failed.reason instanceof ApiError &&
      failed.reason.code === "profile_version_conflict",
  );
  const winningIndex = results.findIndex(
    (result) => result.status === "fulfilled",
  );
  const replay = await peer.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    [contenders[winningIndex]],
    0,
    `race-${winningIndex}`,
    factory,
  );
  assert.equal(replay.version, 1);
  assert.deepEqual(replay.equippedTraitIds, [contenders[winningIndex]]);
  const noopReplay = await peer.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    [],
    0,
    "noop",
    factory,
  );
  assert.equal(noopReplay.version, 1);
  assert.deepEqual(noopReplay.equippedTraitIds, replay.equippedTraitIds);
  await assert.rejects(
    f.profiles.setEquipment(
      f.session.walletId,
      f.session.address,
      f.profile.id,
      ["comet-glow"],
      0,
      "noop",
      factory,
    ),
    /idempotency_conflict/,
  );
  const removed = await peer.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    [],
    1,
    "remove",
    factory,
  );
  assert.equal(removed.version, 2);
  assert.equal(removed.xp, 700);
  const newOwner = await login();
  owners.set(
    `${f.profile.nft.chainId}:${f.profile.nft.collectionAddress.toLowerCase()}:${f.profile.nft.tokenId}`,
    newOwner.session.address,
  );
  await assert.rejects(
    f.profiles.setEquipment(
      f.session.walletId,
      f.session.address,
      f.profile.id,
      ["comet-glow"],
      2,
      "old-owner",
      factory,
    ),
    /not_currently_owned/,
  );
  const transferred = await peer.register(
    newOwner.session.walletId,
    f.profile.nft,
  );
  assert.equal(transferred.id, f.profile.id);
  assert.equal(transferred.xp, 700);
  assert.equal(transferred.version, 2);
  const equipped = await peer.setEquipment(
    newOwner.session.walletId,
    newOwner.session.address,
    f.profile.id,
    ["comet-glow"],
    2,
    "new-owner",
    factory,
  );
  assert.equal(equipped.version, 3);
  assert.equal(
    await db
      .collection("xp_ledger")
      .countDocuments({ profile_id: f.profile.id }),
    0,
  );
  assert.equal(
    await db
      .collection("evolution_jobs")
      .countDocuments({ profile_id: f.profile.id }),
    3,
  );
  const history = await db
    .collection<any>("evolution_history")
    .find({ profile_id: f.profile.id })
    .sort({ new_version: 1 })
    .toArray();
  assert.deepEqual(
    history.map((row) => [row.kind, row.before.xp, row.after.xp, row.claim_id]),
    Array(3).fill(["trait_change", 700, 700, undefined]),
  );
  assert.equal(history[2].actor_wallet_id, newOwner.session.walletId);
});

test("19_deterministic_cosmetic_artwork_stale_version_cas_and_replay", async () => {
  const f = await fixture();
  await setXp(f, 700);
  await f.profiles.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    ["trail-scarf"],
    0,
    "first",
    factory,
  );
  await f.profiles.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    ["star-crown", "comet-glow"],
    1,
    "second",
    factory,
  );
  const jobs = await db
    .collection<any>("evolution_jobs")
    .find({ profile_id: f.profile.id })
    .sort({ evolution_version: 1 })
    .toArray();
  await isolateArtworkWorker(jobs.map((job) => job._id));
  let generatorCalls = 0;
  const options = {
    async generateImage() {
      generatorCalls++;
      throw new Error("cosmetic_generator_must_not_run");
    },
  };
  const before = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.equal(await processOneArtwork(db, options), true);
  const stale = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.equal(stale.version, 2);
  assert.equal(
    stale.artwork_artifact_id,
    before.artwork_artifact_id,
    "version_one_art_cannot_publish_over_version_two",
  );
  assert.equal(
    (await db.collection<any>("evolution_jobs").findOne({ _id: jobs[0]._id }))
      .status,
    "completed",
  );
  assert.equal(await processOneArtwork(peerDb, options), true);
  const current = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.equal(current.artwork_version, 2);
  assert.ok(current.artwork_artifact_id);
  assert.equal(generatorCalls, 0);
  const artifacts = await db
    .collection<any>("artifacts")
    .find({ profile_id: f.profile.id })
    .sort({ evolution_version: 1 })
    .toArray();
  assert.equal(artifacts.length, 2);
  const bucket = new GridFSBucket(peerDb, { bucketName: "chog_artifacts" });
  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    const image = await bytes(
      bucket.openDownloadStream(new ObjectId(artifact.gridfs_id)),
    );
    const expected = await sharp(
      Buffer.from(
        composeDemoChog(f.profile.nft.tokenId, stageForXp(700), {
          equippedTraitIds:
            i === 0 ? ["trail-scarf"] : ["comet-glow", "star-crown"],
          mode: "demo",
        }).svg,
      ),
    )
      .resize(1024, 1024)
      .png()
      .toBuffer();
    // validateGeneratedImage normalizes the raster once before storage.
    const normalized = await sharp(expected).png().toBuffer();
    assert.deepEqual(image, normalized);
    assert.equal(artifact.image_hash, `0x${sha256(image)}`);
    const metadata = JSON.parse(
      (
        await bytes(
          bucket.openDownloadStream(new ObjectId(artifact.metadata_gridfs_id)),
        )
      ).toString(),
    );
    assert.equal(metadata.sourceEventId, jobs[i].source_event_id);
    assert.equal(metadata.kind, "trait_change");
    assert.equal(metadata.claimId, undefined);
    assert.equal(metadata.provenance.referenceCommit, REFERENCE_COMMIT);
    assert.equal(metadata.provenance.referenceHashes.length, 5);
  }
  const history = await db
    .collection<any>("evolution_history")
    .find({ profile_id: f.profile.id })
    .sort({ new_version: 1 })
    .toArray();
  assert.equal(history[0].after.artworkUrl, artifacts[0].public_url);
  assert.equal(history[1].before.artworkUrl, artifacts[0].public_url);
  assert.equal(history[1].after.artworkUrl, artifacts[1].public_url);
  const filesBeforeReplay = await db
    .collection("chog_artifacts.files")
    .countDocuments({ "metadata.profile_id": f.profile.id });
  await db
    .collection<any>("evolution_jobs")
    .updateOne(
      { _id: jobs[1]._id },
      {
        $set: {
          status: "generating",
          lease_until: new Date(0),
          lease_token: "terminated-renderer",
          next_attempt_at: null,
        },
      },
    );
  assert.equal(await processOneArtwork(peerDb, options), true);
  assert.equal(
    await db
      .collection("chog_artifacts.files")
      .countDocuments({ "metadata.profile_id": f.profile.id }),
    filesBeforeReplay,
  );
  assert.equal(
    await db
      .collection("artifacts")
      .countDocuments({ source_event_id: jobs[1].source_event_id }),
    1,
  );
  await assert.rejects(
    db
      .collection<any>("artifacts")
      .insertOne({ ...artifacts[1], _id: randomUUID() }),
    { code: 11000 },
  );
});

async function existingArtworkFixture() {
  const f = await fixture();
  await setXp(f, 700);
  await f.profiles.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    ["trail-scarf"],
    0,
    "baseline-art",
    factory,
  );
  const job = await db
    .collection<any>("evolution_jobs")
    .findOne({ profile_id: f.profile.id });
  await isolateArtworkWorker([job._id]);
  assert.equal(await processOneArtwork(db), true);
  const profile = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.ok(profile.artwork_artifact_id, "positive_control_artwork_published");
  return { ...f, baseline: profile };
}

test("20_image_provider_failure_preserves_published_artwork", async () => {
  const f = await existingArtworkFixture();
  const id = await contribution(f);
  await accept(id);
  const job = await db
    .collection<any>("evolution_jobs")
    .findOne({ claim_id: id });
  await isolateArtworkWorker([job._id]);
  let calls = 0;
  assert.equal(
    await processOneArtwork(peerDb, {
      async generateImage() {
        calls++;
        throw new Error("controlled_image_provider_failure");
      },
    }),
    true,
  );
  assert.equal(calls, 1);
  const failed = await db
    .collection<any>("evolution_jobs")
    .findOne({ _id: job._id });
  assert.equal(failed.status, "queued");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error_code, "controlled_image_provider_failure");
  const profile = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.equal(profile.artwork_artifact_id, f.baseline.artwork_artifact_id);
  assert.equal(profile.artwork_url, f.baseline.artwork_url);
  assert.equal(profile.artwork_version, 1);
  assert.equal(profile.version, 2);
  assert.equal(
    await db
      .collection("artifacts")
      .countDocuments({ source_event_id: job.source_event_id }),
    0,
  );
});

test("21_real_gridfs_failure_orphan_recovery_and_publication", async () => {
  const f = await existingArtworkFixture();
  await f.profiles.setEquipment(
    f.session.walletId,
    f.session.address,
    f.profile.id,
    ["star-crown"],
    1,
    "storage-failure",
    factory,
  );
  const job = await db
    .collection<any>("evolution_jobs")
    .findOne({ profile_id: f.profile.id, evolution_version: 2 });
  await isolateArtworkWorker([job._id]);
  const files = db.collection<any>("chog_artifacts.files");
  const filename = `${f.profile.id}-evolution-2.png`;
  const sentinelId = new ObjectId();
  const indexName = `integration_storage_${sequence++}`;
  // Real Mongo rejects the GridFS files insert after its chunks were written.
  // The partial index is limited to this test's exact new filename.
  await files.createIndex(
    { filename: 1 },
    { name: indexName, unique: true, partialFilterExpression: { filename } },
  );
  await files.insertOne({
    _id: sentinelId,
    filename,
    length: 0,
    chunkSize: 261120,
    uploadDate: new Date(),
    metadata: { integrationFailureSentinel: true },
  });
  let failed: any;
  try {
    assert.equal(await processOneArtwork(db), true);
    failed = await db
      .collection<any>("evolution_jobs")
      .findOne({ _id: job._id });
    assert.equal(failed.status, "queued");
    assert.equal(failed.attempts, 1);
    const profile = await db
      .collection<any>("nft_profiles")
      .findOne({ _id: f.profile.id });
    assert.equal(profile.artwork_artifact_id, f.baseline.artwork_artifact_id);
    assert.equal(
      await db
        .collection("artifacts")
        .countDocuments({ source_event_id: job.source_event_id }),
      0,
    );
    assert.ok(failed.image_gridfs_id);
    const imageId = new ObjectId(failed.image_gridfs_id);
    assert.equal(await files.findOne({ _id: imageId }), null);
    assert.ok(
      await db
        .collection("chog_artifacts.chunks")
        .countDocuments({ files_id: imageId }),
      "storage_failure_leaves_real_recoverable_orphan_chunks",
    );
  } finally {
    await files.deleteOne({ _id: sentinelId });
    await files.dropIndex(indexName);
  }
  const reservedId = failed.image_gridfs_id;
  await db
    .collection<any>("evolution_jobs")
    .updateOne(
      { _id: job._id },
      {
        $set: {
          next_attempt_at: null,
          status: "generating",
          lease_token: "terminated-upload",
          lease_until: new Date(0),
        },
      },
    );
  assert.equal(await processOneArtwork(peerDb), true);
  const complete = await db
    .collection<any>("evolution_jobs")
    .findOne({ _id: job._id });
  assert.equal(complete.status, "completed");
  assert.equal(complete.image_gridfs_id, reservedId);
  const profile = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: f.profile.id });
  assert.equal(profile.artwork_version, 2);
  assert.notEqual(profile.artwork_artifact_id, f.baseline.artwork_artifact_id);
  const artifact = await db
    .collection<any>("artifacts")
    .findOne({ _id: profile.artwork_artifact_id });
  const image = await bytes(
    new GridFSBucket(peerDb, {
      bucketName: "chog_artifacts",
    }).openDownloadStream(new ObjectId(artifact.gridfs_id)),
  );
  assert.equal(`0x${sha256(image)}`, artifact.image_hash);
  assert.equal(await files.countDocuments({ filename }), 1);
  const chunks = await db
    .collection<any>("chog_artifacts.chunks")
    .find({ files_id: new ObjectId(reservedId) })
    .sort({ n: 1 })
    .toArray();
  assert.deepEqual(
    chunks.map((chunk) => chunk.n),
    Array.from({ length: chunks.length }, (_, i) => i),
  );
  assert.equal(
    await db
      .collection("artifacts")
      .countDocuments({ source_event_id: job.source_event_id }),
    1,
  );
});

test("22_original_metadata_stays_bound_to_read_only_collection", async () => {
  const f = await fixture();
  const original = await profileFor(f.session, "original_companion");
  const start = rpcCalls.length;
  let metadataRequests = 0;
  const network: MetadataNetwork = {
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: ((url: URL, options: any, callback: Function) => {
      assert.equal(url.hostname, "metadata.example.net");
      assert.equal(options.method, "GET");
      metadataRequests++;
      const req = new EventEmitter() as any;
      let res: any;
      req.destroy = () => {
        res?.destroy();
        return req;
      };
      req.end = () => {
        queueMicrotask(() => {
          res = new PassThrough();
          res.statusCode = 200;
          res.headers = {};
          res.complete = false;
          callback(res);
          res.complete = true;
          res.end(
            JSON.stringify({
              name: "Original Chog",
              description: "Immutable source collection metadata",
              image: "https://images.example.net/original.png",
            }),
          );
        });
        return req;
      };
      return req;
    }) as MetadataNetwork["request"],
  };
  const captured = await f.profiles.captureOriginalMetadata(
    original,
    factory,
    network,
  );
  assert.equal(captured.originalMetadataStatus, "ready");
  assert.equal(captured.originalMetadata?.name, "Original Chog");
  const cached = await new MongoProfileRepository(
    peerDb,
  ).captureOriginalMetadata(captured, factory, network);
  assert.equal(metadataRequests, 1);
  assert.deepEqual(cached.originalMetadata, captured.originalMetadata);
  assert.deepEqual(
    rpcCalls.slice(start),
    ["tokenURI"],
    "metadata_read_is_cached_and_never_writes_to_original_contract",
  );
  const source = structuredClone(captured.originalMetadata);
  await setXp({ ...f, profile: original }, 700);
  const changed = await f.profiles.setEquipment(
    f.session.walletId,
    f.session.address,
    original.id,
    ["comet-glow"],
    0,
    "companion-trait",
    factory,
  );
  assert.deepEqual(changed.originalMetadata, source);
  const persisted = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: original.id });
  assert.equal(persisted.collection_address, ORIGINAL.toLowerCase());
  assert.deepEqual(persisted.original_metadata, source);
  assert.equal(persisted.mode, "original_companion");
});

function activityProof(session: WalletSession, date: string): ActivityProof {
  const n = ++sequence;
  return {
    chain_id: 143,
    wallet: session.address.toLowerCase(),
    transaction_hash: hash(n),
    block_hash: hash(n + 10_000),
    block_number: String(n),
    block_timestamp: Math.floor(Date.parse(date) / 1000),
    transaction_from: session.address.toLowerCase(),
    transaction_to: PROTOCOL,
    transaction_nonce: n,
    value_wei: "0",
    input: "0x12345678",
    receipt_status: "success",
    confirmations_required: 4,
    interaction_type: "contract_call",
    target_name: "Controlled Monad app",
    target_address: PROTOCOL,
    log_index: -1,
    verified_at: new Date().toISOString(),
    destination_code_hash: hash(1),
  };
}

test("23_scanner_resume_dedupe_and_wallet_utc_day_rewards", async () => {
  const f = await fixture(),
    secondProfile = await profileFor(f.session);
  const scans = new MongoScanRepository(db),
    peer = new MongoScanRepository(peerDb);
  const attempts = await Promise.allSettled([
    scans.start(f.session.walletId, f.profile.id, 143, { targets: {} }),
    peer.start(f.session.walletId, secondProfile.id, 143, { targets: {} }),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const first = attempts.find((r) => r.status === "fulfilled");
  assert.ok(first?.status === "fulfilled");
  const firstId = first.value;
  const checkpoint = { targets: { controlled_contract: 100 } };
  await scans.saveCheckpoint(firstId, checkpoint, "partial");
  assert.deepEqual(
    await peer.latestCheckpoint(f.session.walletId, 143),
    checkpoint,
  );
  const secondId = await peer.start(
    f.session.walletId,
    secondProfile.id,
    143,
    await peer.latestCheckpoint(f.session.walletId, 143),
  );
  const proof = activityProof(f.session, "2027-05-04T12:00:00Z");
  await scans.saveCandidate(
    firstId,
    f.profile.id,
    f.session.walletId,
    proof,
    "monad-mainnet-explorer",
    "https://monadscan.com",
  );
  await Promise.all([
    peer.saveCandidate(
      secondId,
      secondProfile.id,
      f.session.walletId,
      proof,
      "monad-mainnet-explorer",
      "https://monadscan.com",
    ),
    scans.saveCandidate(
      secondId,
      f.profile.id,
      f.session.walletId,
      proof,
      "monad-mainnet-explorer",
      "https://monadscan.com",
    ),
  ]);
  const saved = await db
    .collection<any>("scan_events")
    .find({ wallet_id: f.session.walletId })
    .toArray();
  assert.equal(saved.length, 1);
  assert.deepEqual(
    new Set(saved[0].scan_job_ids),
    new Set([firstId, secondId]),
  );
  await scans.saveCoverage(secondId, {
    mode: "recent_transactions",
    fromBlock: "1",
    toBlock: "100",
    fromTime: "2027-05-04T00:00:00Z",
    toTime: "2027-05-04T23:59:59Z",
    latestFinalizedBlock: "100",
    hasMore: true,
  });
  const quest = await f.claims.questBySlug("monad-mainnet-explorer");
  assert.ok(quest);
  const result = await f.claims.createOrGet(
    submission(f, { questId: String(quest._id), scanEventId: saved[0]._id }),
  );
  assert.equal(result.kind, "claim");
  if (result.kind !== "claim") return;
  await scans.reviewError(saved[0]._id, "temporary_review_outage");
  await scans.attachClaim(secondId, saved[0]._id, result.item.id);
  assert.equal((await peer.pendingEvents(f.session.walletId, 143)).length, 0);
  const view = await peer.getForWallet(secondId, f.session.walletId);
  assert.ok(view);
  assert.equal(view.events.length, 1);
  assert.equal(view.events[0].reviewErrorCode, null);
  assert.equal(view.coverage?.hasMore, true);
  assert.equal(await scans.getForWallet(secondId, randomUUID()), null);
  await accept(result.item.id, new Date("2027-05-06T00:00:00Z"));
  assert.equal(
    (
      await db
        .collection<any>("xp_ledger")
        .findOne({ claim_id: result.item.id })
    ).amount,
    25,
  );
  const sameDay = activityProof(f.session, "2027-05-04T21:00:00Z");
  await scans.saveCandidate(
    secondId,
    secondProfile.id,
    f.session.walletId,
    sameDay,
    "monad-mainnet-explorer",
    "https://monadscan.com",
  );
  const sameEvent = await db
    .collection<any>("scan_events")
    .findOne({ tx_hash: sameDay.transaction_hash });
  const repeated = await f.claims.createOrGet(
    submission(f, {
      profileId: secondProfile.id,
      questId: String(quest._id),
      scanEventId: sameEvent._id,
    }),
  );
  assert.equal(repeated.kind, "claim");
  if (repeated.kind === "claim") {
    assert.equal(repeated.item.id, result.item.id);
    assert.equal(repeated.duplicate, true);
  }
  const tomorrow = activityProof(f.session, "2027-05-05T00:00:00Z");
  await scans.saveCandidate(
    secondId,
    secondProfile.id,
    f.session.walletId,
    tomorrow,
    "monad-mainnet-explorer",
    "https://monadscan.com",
  );
  const nextEvent = await db
    .collection<any>("scan_events")
    .findOne({ tx_hash: tomorrow.transaction_hash });
  const nextClaim = await f.claims.createOrGet(
    submission(f, {
      profileId: secondProfile.id,
      questId: String(quest._id),
      scanEventId: nextEvent._id,
    }),
  );
  assert.equal(nextClaim.kind, "claim");
  if (nextClaim.kind !== "claim") return;
  assert.notEqual(nextClaim.item.id, result.item.id);
  await accept(nextClaim.item.id, new Date("2027-05-06T00:00:00Z"));
  assert.equal(
    (
      await db
        .collection<any>("xp_ledger")
        .findOne({ claim_id: nextClaim.item.id })
    ).amount,
    25,
  );
  await db
    .collection<any>("scan_jobs")
    .updateOne(
      { _id: secondId },
      { $set: { updated_at: new Date(Date.now() - 120_000) } },
    );
  const thirdId = await scans.start(
    f.session.walletId,
    f.profile.id,
    143,
    checkpoint,
  );
  assert.equal(
    (await db.collection<any>("scan_jobs").findOne({ _id: secondId }))
      .last_error_code,
    "scan_lease_expired",
  );
  await scans.saveCheckpoint(
    thirdId,
    { targets: { controlled_contract: 200 } },
    "complete",
  );
  assert.deepEqual(await peer.latestCheckpoint(f.session.walletId, 143), {
    targets: { controlled_contract: 200 },
  });
});

function mintTransaction(profile: ProfileRecord, session: WalletSession) {
  const n = ++sequence,
    id = hash(n),
    number = BigInt(n),
    blockHash = hash(n + 10_000);
  const tx = {
    hash: id,
    from: session.address,
    to: COLLECTION,
    input: "0x1249c58b",
    nonce: n,
    value: 0n,
    blockNumber: number,
    blockHash,
  };
  transactions.set(id, tx);
  blocks.set(number, { number, hash: blockHash, timestamp: 1_792_368_000n });
  receipts.set(id, {
    transactionHash: id,
    from: session.address,
    to: COLLECTION,
    blockNumber: number,
    blockHash,
    status: "success",
    logs: [
      {
        address: COLLECTION,
        data: "0x",
        blockNumber: number,
        blockHash,
        transactionHash: id,
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
        topics: encodeEventTopics({
          abi: transferAbi,
          eventName: "Transfer",
          args: {
            from: zeroAddress,
            to: session.address,
            tokenId: BigInt(profile.nft.tokenId),
          },
        }),
      },
    ],
  });
  return id;
}

test("24_mint_and_bio_once_only_scopes_remain_independent", async () => {
  const f = await fixture(),
    second = await profileFor(f.session);
  const mintQuest = await f.claims.questBySlug("demo-first-mint"),
    bioQuest = await f.claims.questBySlug("verify-x-bio");
  assert.ok(mintQuest && bioQuest);
  const firstMint = await f.claims.createOrGet(
    submission(f, {
      questId: String(mintQuest._id),
      transactionHash: mintTransaction(f.profile, f.session),
    }),
  );
  assert.equal(firstMint.kind, "claim");
  if (firstMint.kind !== "claim") return;
  const secondMint = await f.claims.createOrGet(
    submission(f, {
      profileId: second.id,
      questId: String(mintQuest._id),
      transactionHash: mintTransaction(second, f.session),
    }),
  );
  assert.equal(secondMint.kind, "claim");
  if (secondMint.kind === "claim")
    assert.equal(secondMint.item.id, firstMint.item.id);
  const identity = await link(f.session);
  const firstBio = await f.claims.createOrGet(
    submission(f, { questId: String(bioQuest._id) }),
  );
  assert.equal(firstBio.kind, "claim");
  if (firstBio.kind !== "claim") return;
  await identity.social.unlinkX(f.session.walletId);
  await link(f.session, identity.providerId, "newhandle");
  const secondBio = await f.claims.createOrGet(
    submission(f, { profileId: second.id, questId: String(bioQuest._id) }),
  );
  assert.equal(secondBio.kind, "claim");
  if (secondBio.kind === "claim")
    assert.equal(secondBio.item.id, firstBio.item.id);
  const contributionId = await contribution(f);
  const now = new Date("2027-06-01T12:00:00Z");
  await accept(contributionId, now);
  await accept(firstMint.item.id, now);
  await accept(firstBio.item.id, now);
  const ledger = await db
    .collection<any>("xp_ledger")
    .find({ wallet_id: f.session.walletId })
    .toArray();
  assert.deepEqual(
    ledger.map((row) => row.amount).sort((a, b) => a - b),
    [50, 50, 75],
  );
  assert.equal(
    await db
      .collection("claims")
      .countDocuments({
        wallet_once_key: `${f.session.walletId}:${mintQuest._id}`,
      }),
    1,
  );
  assert.equal(
    await db
      .collection("claims")
      .countDocuments({
        wallet_once_key: `${f.session.walletId}:${bioQuest._id}`,
      }),
    1,
  );
  const stranger = await login();
  const challenge = await identity.social.createXChallenge(
    stranger.session.walletId,
  );
  assert.equal(
    (
      await identity.social.verifyXChallenge(
        stranger.session.walletId,
        "newhandle",
        identity.providerId,
        challenge.bioCode,
      )
    ).kind,
    "x_account_already_linked",
  );
});

test("25_shared_runtime_quota_authentication_boundaries_and_metrics", async () => {
  const f = await fixture(),
    outsider = await login();
  const id = await contribution(f);
  const preview = await f.previews.create(
    f.session,
    {
      profileId: f.profile.id,
      url: `https://github.com/chog/http-${++sequence}`,
    },
    "http-preview",
  );
  const app = buildApp(undefined, {
    database: db,
    factory,
    request: f.provider.request,
    logger: false,
  });
  const other = buildApp(undefined, {
    database: peerDb,
    factory,
    request: f.provider.request,
    logger: false,
  });
  await Promise.all([app.ready(), other.ready()]);
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/ready" })).statusCode,
      200,
    );
    const marker = await db
      .collection<any>("schema_migrations")
      .findOne({ _id: `mongodb-${SCHEMA_VERSION}` });
    await db
      .collection<any>("schema_migrations")
      .deleteOne({ _id: marker._id });
    try {
      assert.equal(
        (await other.inject({ method: "GET", url: "/ready" })).statusCode,
        503,
      );
    } finally {
      await db.collection<any>("schema_migrations").insertOne(marker);
    }
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/admin/metrics" }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/metrics",
          headers: { "x-quest-admin-key": "wrong-fixture-key" },
        })
      ).statusCode,
      403,
    );
    const ownerCookie = `chog_session=${f.session.sessionId}`,
      otherCookie = `chog_session=${outsider.session.sessionId}`;
    const owned = await app.inject({
      method: "GET",
      url: `/v1/claims/${id}`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(owned.statusCode, 200);
    for (const target of [`/v1/evidence/previews/${preview.id}`]) {
      assert.equal(
        (await app.inject({ method: "GET", url: target })).statusCode,
        401,
      );
      assert.equal(
        (
          await other.inject({
            method: "GET",
            url: target,
            headers: { cookie: otherCookie },
          })
        ).statusCode,
        404,
      );
    }
    const forbidden = await other.inject({
      method: "PATCH",
      url: `/v1/profiles/${f.profile.id}/traits`,
      headers: { cookie: otherCookie, "idempotency-key": "cross-wallet" },
      payload: { equippedTraitIds: [], expectedVersion: 0 },
    });
    assert.equal(forbidden.statusCode, 403);
    const trace = randomUUID();
    const large = await app.inject({
      method: "POST",
      url: "/v1/auth/nonce",
      headers: { "content-type": "application/json", "x-request-id": trace },
      payload: JSON.stringify({
        address: f.session.address,
        chainId: 10143,
        padding: "x".repeat(65_536),
      }),
    });
    assert.equal(large.statusCode, 413);
    assert.equal(large.json().requestId, trace);
    assert.equal(large.headers["x-request-id"], trace);
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? app : other).inject({
          method: "POST",
          url: "/v1/auth/nonce",
          remoteAddress: "198.51.100.42",
          headers: { "x-forwarded-for": `192.0.2.${i + 1}` },
          payload: { address: f.session.address, chainId: 10143 },
        }),
      ),
    );
    assert.equal(
      responses.filter((response) => response.statusCode === 201).length,
      8,
      "quota_is_shared_between_two_mongo_backed_apps",
    );
    assert.equal(
      responses.filter((response) => response.statusCode === 429).length,
      4,
      "spoofed_forwarded_headers_cannot_escape_quota",
    );
    const limited = responses.find((response) => response.statusCode === 429)!;
    assert.ok(limited.headers["retry-after"]);
    assert.equal(limited.json().retryable, true);
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/auth/nonce",
      remoteAddress: "198.51.100.43",
      payload: { address: f.session.address, chainId: 999 },
    });
    assert.equal(challenge.statusCode, 400);
    const who = account();
    const nonce = await other.inject({
      method: "POST",
      url: "/v1/auth/nonce",
      remoteAddress: "198.51.100.44",
      payload: { address: who.address, chainId: 10143 },
    });
    assert.equal(nonce.statusCode, 201);
    const message = nonce.json().message;
    const verified = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      remoteAddress: "198.51.100.44",
      payload: { message, signature: await who.signMessage({ message }) },
    });
    assert.equal(verified.statusCode, 200);
    const cookie = String(verified.headers["set-cookie"]).split(";")[0];
    assert.match(String(verified.headers["set-cookie"]), /HttpOnly/);
    assert.equal(
      (
        await other.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: { cookie },
        })
      ).json().authenticated,
      true,
    );
    await other.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie },
    });
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: { cookie },
        })
      ).statusCode,
      401,
    );
    const metricWrites = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        recordOperationalMetric(i % 2 ? db : peerDb, {
          kind: "provider",
          name: "rpc",
          operation: "lookup",
          outcome: i < 8 ? "success" : "failure",
          durationMs: i * 10,
          attempt: (i % 2) + 1,
        }),
      ),
    );
    assert.ok(metricWrites.every(Boolean));
    const metric = (
      await db
        .collection<any>("operational_metrics")
        .find({ kind: "provider", name: "rpc", operation: "lookup" })
        .toArray()
    ).reduce(
      (sum, row) => ({
        count: sum.count + row.count,
        failures: sum.failures + row.failures,
        retries: sum.retries + row.retries,
      }),
      { count: 0, failures: 0, retries: 0 },
    );
    assert.deepEqual(metric, { count: 12, failures: 4, retries: 6 });
    const metrics = await other.inject({
      method: "GET",
      url: "/v1/admin/metrics",
      headers: { "x-quest-admin-key": process.env.QUEST_ADMIN_API_KEY! },
    });
    assert.equal(metrics.statusCode, 200);
    assert.ok(metrics.json().metrics);
    assert.ok(metrics.json().claims.counts.length > 0);
    const summary = JSON.stringify(await operationalMetricsSummary(db));
    assert.ok(!summary.includes(f.session.address));
    assert.ok(!summary.includes(f.session.sessionId));
  } finally {
    await Promise.all([app.close(), other.close()]);
  }
});

test("26_actual_database_pagination_is_stable_for_equal_timestamps", async () => {
  const f = await fixture();
  const profiles = [f.profile];
  for (let i = 0; i < 6; i++) profiles.push(await profileFor(f.session));
  const timestamp = new Date("2027-07-01T00:00:00Z");
  await db
    .collection<any>("nft_profiles")
    .updateMany(
      { owner_wallet_id: f.session.walletId },
      { $set: { created_at: timestamp } },
    );
  const expected = profiles.map((p) => p.id).sort();
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await new MongoProfileRepository(
      pages % 2 ? peerDb : db,
    ).listPageForWallet(f.session.walletId, {
      limit: "2",
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor;
    pages++;
    assert.ok(pages < 10, "pagination_terminates");
  } while (cursor);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 7);
  await assert.rejects(
    f.profiles.listPageForWallet(f.session.walletId, {
      cursor: "not-a-cursor",
    }),
    /invalid_page_cursor/,
  );
  const claims: string[] = [];
  for (let i = 0; i < 5; i++) claims.push(await contribution(f));
  await db
    .collection<any>("claims")
    .updateMany({ _id: { $in: claims } }, { $set: { created_at: timestamp } });
  const actual: string[] = [];
  cursor = null;
  pages = 0;
  do {
    const page = await f.claims.listPageForWallet(f.session.walletId, {
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    actual.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pages++;
    assert.ok(pages < 10);
  } while (cursor);
  assert.deepEqual(actual, claims.sort().reverse());
});

test("27_collection_and_transaction_coverage_is_measured", async () => {
  const listed = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (row) => row.name,
    ),
  );
  for (const name of expectedCollections) {
    assert.ok(listed.has(name), `real_collection_created:${name}`);
    assert.ok(touched.has(name), `real_collection_exercised:${name}`);
    assert.ok(
      await db.collection(name).countDocuments(),
      `real_documents_persisted:${name}`,
    );
  }
  assert.ok(transactionCommands > 50, "real_transaction_commands_observed");
  assert.ok(
    duplicateFailures >= 4,
    "negative_uniqueness_controls_reached_mongo",
  );
  assert.deepEqual(
    [...databaseNames],
    [db.databaseName],
    "all_application_commands_stayed_in_owned_test_database",
  );
  await assertOwnedDatabase(
    peerDb,
    db.databaseName,
    process.env.CHOG_INTEGRATION_RUN_ID,
  );
});

function observe(client: MongoClient) {
  client.on("commandStarted", (event) => {
    const command = event.command;
    const name = command[event.commandName];
    if (
      [
        "find",
        "insert",
        "update",
        "delete",
        "findAndModify",
        "aggregate",
        "count",
        "distinct",
      ].includes(event.commandName) &&
      typeof name === "string"
    ) {
      databaseNames.add(event.databaseName);
      if (
        event.databaseName === process.env.CHOG_INTEGRATION_DATABASE &&
        !name.startsWith("_integration_")
      )
        touched.add(name);
    }
    if (command.autocommit === false) transactionCommands++;
  });
  client.on("commandSucceeded", (event) => {
    const reply = event.reply as any;
    if (reply.writeErrors?.some((error: any) => error.code === 11000))
      duplicateFailures++;
  });
  client.on("commandFailed", (event) => {
    if ((event.failure as any)?.code === 11000) duplicateFailures++;
  });
}

async function main() {
  const name = process.env.CHOG_INTEGRATION_DATABASE;
  const runId = process.env.CHOG_INTEGRATION_RUN_ID;
  validateTestDatabaseName(name, process.env.MONGODB_DATABASE);
  assert.ok(
    runId && process.env.MONGODB_TEST_URI,
    "integration_runner_required",
  );
  assert.equal(
    process.env.MONGODB_URI,
    "",
    "default_database_access_is_disabled",
  );
  Object.assign(process.env, {
    APP_ORIGIN: ORIGIN,
    WEB_ORIGIN: ORIGIN,
    PUBLIC_API_URL: "",
    PUBLIC_API_PATH: "/api",
    DEMO_COLLECTION_ADDRESS: COLLECTION,
    ORIGINAL_CHOG_COLLECTION_ADDRESS: ORIGINAL,
    MONAD_TESTNET_CHAIN_ID: "10143",
    MONAD_MAINNET_CHAIN_ID: "143",
    MONAD_TESTNET_RPC_URL: "https://rpc-fixture.example.invalid",
    MONAD_MAINNET_RPC_URL: "https://rpc-fixture.example.invalid",
    MONAD_FINALITY_BLOCKS: "4",
    GENLAYER_CONTRACT_ADDRESS: COLLECTION,
    X_SOURCE_MODE: "public_page",
    MONAD_SCAN_TARGETS: "[]",
    QUEST_ADMIN_API_KEY: "integration-admin-fixture-key",
  });
  delete process.env.GITHUB_PUBLIC_READ_TOKEN;
  delete process.env.X_API_BEARER_TOKEN;
  delete process.env.GEMINI_API_KEY;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("unexpected_live_http_request");
  };
  const options = {
    appName: "chog-isolated-persistence-tests",
    monitorCommands: true,
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  };
  const client = new MongoClient(process.env.MONGODB_TEST_URI!, options);
  const peer = new MongoClient(process.env.MONGODB_TEST_URI!, options);
  observe(client);
  observe(peer);
  let completed = 0;
  try {
    await Promise.all([client.connect(), peer.connect()]);
    db = client.db(name);
    peerDb = peer.db(name);
    await assertOwnedDatabase(db, name, runId);
    for (const entry of cases) {
      const started = Date.now();
      try {
        await entry.work();
        completed++;
        console.log(
          `PERSISTENCE CASE ${entry.id} PASS ${Date.now() - started}ms`,
        );
      } catch (error) {
        const failure = error as any;
        const details = {
          case: entry.id,
          type: failure?.name ?? "Error",
          code:
            failure instanceof ApiError
              ? failure.code
              : (failure?.code ?? null),
          message:
            failure?.name === "AssertionError"
              ? String(failure.message).slice(0, 2000)
              : undefined,
          location: String(failure?.stack ?? "")
            .split("\n")
            .filter((line) => line.includes("persistence.integration.ts"))
            .slice(0, 4),
        };
        console.error("PERSISTENCE CASE FAILED " + JSON.stringify(details));
        throw new Error("persistence_assertion_failed");
      }
    }
    const measured = expectedCollections.filter((name) => touched.has(name));
    console.log(
      "PERSISTENCE COVERAGE " +
        JSON.stringify({
          cases: completed,
          collections: measured,
          transactionCommands,
          duplicateFailures,
        }),
    );
    assert.equal(measured.length, expectedCollections.length);
    await new Promise<void>((resolve, reject) => {
      if (!process.send)
        return reject(new Error("integration_runner_ipc_required"));
      process.send(
        {
          type: "persistence-summary",
          runId,
          cases: completed,
          collections: measured,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  } finally {
    await Promise.all([client.close(), peer.close()]);
    globalThis.fetch = realFetch;
  }
}

main().catch(() => {
  console.error("PERSISTENCE SUITE FAILED");
  process.exitCode = 1;
});
