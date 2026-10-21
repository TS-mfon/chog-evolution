import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { MemoryDb } from "./memory-db.js";
import { MongoAuthRepository } from "../src/auth-repository.js";
import { MongoClaimRepository } from "../src/claim-repository.js";
import { MongoProfileRepository } from "../src/profile-repository.js";
import { EvidencePreviewRepository } from "../src/evidence-preview.js";
import { ensureIndexes } from "../src/mongo.js";
import type { ClientFactory } from "../src/config.js";
import { readDemoMetadata } from "../src/demo-metadata.js";

const account = privateKeyToAccount(`0x${"31".repeat(32)}`);
const collection = `0x${"41".repeat(20)}` as const;
async function fixture(t: TestContext) {
  const values = {
    APP_ORIGIN: "https://chog.example",
    PUBLIC_API_PATH: "/api",
    PUBLIC_API_URL: "",
    DEMO_COLLECTION_ADDRESS: collection,
    GENLAYER_CONTRACT_ADDRESS: collection,
    X_SOURCE_MODE: "public_page",
  };
  const old = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const key of Object.keys(values)) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  });
  const memory = new MemoryDb(),
    db = memory.db;
  await ensureIndexes(db);
  const auth = new MongoAuthRepository(db);
  const nonce = await auth.issueNonce(
    account.address,
    10143,
    "https://chog.example",
  );
  const session = (await auth.verifyAndCreateSession(
    nonce.message,
    await account.signMessage({ message: nonce.message }),
  ))!;
  let owner = account.address;
  const factory: ClientFactory = (config) =>
    ({
      getChainId: async () => config.chainId,
      readContract: async () => owner,
    }) as any;
  let revision = 1,
    fetches = 0,
    available = true;
  const request: typeof fetch = async (url) => {
    fetches++;
    if (!available) return new Response("unavailable", { status: 503 });
    const path = new URL(String(url)).pathname;
    return Response.json(
      path.includes("/git/ref/")
        ? { object: { type: "commit", sha: String(revision).repeat(40) } }
        : path.endsWith("/readme")
          ? {
              encoding: "base64",
              sha: "d".repeat(40),
              path: "README.md",
              content: Buffer.from(
                `CHOG contribution revision ${revision}. Wallet ${account.address}`,
              ).toString("base64"),
            }
          : {
              id: 123,
              private: false,
              full_name: "alice/chog",
              default_branch: "main",
              fork: false,
            },
    );
  };
  const profiles = new MongoProfileRepository(db);
  const profile = await profiles.register(session.walletId, {
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "1",
    mode: "demo",
  });
  const claims = new MongoClaimRepository(db, factory, request),
    previews = new EvidencePreviewRepository(db, factory, request);
  const quest = (await claims.questBySlug("ecosystem-contribution"))!;
  const input = {
    profileId: profile.id,
    questId: String(quest._id),
    walletId: session.walletId,
    walletAddress: account.address,
    authProofId: session.authProofId!,
    idempotencyKey: randomUUID(),
  };
  return {
    memory,
    db,
    session,
    profile,
    profiles,
    claims,
    previews,
    quest,
    input,
    factory,
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
    transfer() {
      owner = `0x${"51".repeat(20)}`;
    },
  };
}

test("consumed previews replay the same saved claim after an expired or lost response", async (t) => {
  const f = await fixture(t);
  const preview = await f.previews.create(
    f.session,
    {
      profileId: f.profile.id,
      url: "https://github.com/alice/chog",
      text: "A real guide",
    },
    "preview-1",
  );
  assert.equal(preview.status, "ready");
  const first = await f.claims.createOrGet({
    ...f.input,
    previewId: preview.id,
  });
  assert.equal(first.kind, "claim");
  if (first.kind !== "claim") return;
  await f.db
    .collection<any>("evidence_previews")
    .updateOne({ _id: preview.id }, { $set: { expires_at: new Date(0) } });
  const repeat = await f.claims.createOrGet({
    ...f.input,
    previewId: preview.id,
  });
  assert.equal(repeat.kind, "claim");
  if (repeat.kind !== "claim") return;
  assert.equal(repeat.item.id, first.item.id);
  assert.equal(repeat.duplicate, true);
  const saved = await f.previews.get(preview.id, f.session.walletId);
  assert.equal(saved.status, "consumed");
  assert.equal(saved.claimId, first.item.id);
  assert.equal(f.memory.rows("claims").length, 1);
  assert.equal(f.memory.rows("claim_attempts").length, 1);
  await assert.rejects(
    f.claims.createOrGet({
      ...f.input,
      previewId: preview.id,
      text: "changed",
    }),
    /preview_request_mismatch/,
  );
});

test("a preview refreshed during ownership verification cannot be consumed by an older submission", async (t) => {
  const f = await fixture(t);
  const preview = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url: "https://github.com/alice/chog" },
    "generation-race",
  );
  let continueOwnership!: () => void, ownershipStarted!: () => void;
  const paused = new Promise<void>((resolve) => {
    continueOwnership = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ownershipStarted = resolve;
  });
  const factory: ClientFactory = (config) =>
    ({
      getChainId: async () => config.chainId,
      readContract: async () => {
        ownershipStarted();
        await paused;
        return account.address;
      },
    }) as any;
  const claims = new MongoClaimRepository(f.db, factory, async () => {
    assert.fail("saved previews must not refetch sources");
  });
  const submitting = claims.createOrGet({ ...f.input, previewId: preview.id });
  await started;
  f.change();
  const fresh = await f.previews.retry(
    preview.id,
    f.session.walletId,
    "fresh-generation",
  );
  assert.notEqual(fresh.source.content_hash, preview.source.content_hash);
  continueOwnership();
  await assert.rejects(submitting, /preview_unavailable_or_ineligible/);
  assert.equal(f.memory.rows("claims").length, 0);
  assert.equal(
    (await f.previews.get(preview.id, f.session.walletId)).status,
    "ready",
  );
  const saved = await f.claims.createOrGet({
    ...f.input,
    previewId: preview.id,
  });
  if (saved.kind !== "claim") assert.fail(saved.kind);
  assert.equal(
    JSON.parse((await f.claims.getPublicEvidence(saved.item.id))!).source
      .content_hash,
    fresh.source.content_hash,
  );
});

test("public demo metadata and fallback artwork follow equipped accessories", async (t) => {
  const f = await fixture(t);
  await f.db
    .collection<any>("nft_profiles")
    .updateOne(
      { _id: f.profile.id },
      { $set: { xp: 350, stage: "veteran", level: 4, equipped_trait_ids: [] } },
    );
  const none = await readDemoMetadata(f.db, "1", f.factory);
  assert.ok(
    !none.attributes.some(
      (item) => item.trait_type === "Accessory" && item.value === "Star crown",
    ),
  );
  await f.db
    .collection<any>("nft_profiles")
    .updateOne(
      { _id: f.profile.id },
      { $set: { equipped_trait_ids: ["trail-scarf"] } },
    );
  const scarf = await readDemoMetadata(f.db, "1", f.factory);
  assert.ok(
    scarf.attributes.some(
      (item) => item.trait_type === "Accessory" && item.value === "Trail scarf",
    ),
  );
  assert.notEqual(scarf.image, none.image);
});

test("legacy passport history restores the exact prior artwork across pagination", async (t) => {
  const f = await fixture(t);
  for (let version = 1; version <= 2; version++) {
    const event = randomUUID();
    await f.db
      .collection<any>("evolution_history")
      .insertOne({
        _id: event,
        source_event_id: event,
        profile_id: f.profile.id,
        previous_version: version - 1,
        new_version: version,
        finalized: true,
        outcome: "accepted",
        created_at: new Date(),
        before: { xp: (version - 1) * 75, artworkUrl: null },
        after: { xp: version * 75, artworkUrl: null },
      });
    await f.db
      .collection<any>("artifacts")
      .insertOne({
        _id: randomUUID(),
        source_event_id: event,
        profile_id: f.profile.id,
        evolution_version: version,
        public_url: `https://art.example/version-${version}.png`,
        created_at: new Date(),
      });
  }
  const first = await f.profiles.getPassport(f.profile.id, { limit: 1 });
  const second = await f.profiles.getPassport(f.profile.id, {
    limit: 1,
    cursor: first!.nextCursor,
  });
  assert.equal(
    first!.history[0].after.artworkUrl,
    "https://art.example/version-1.png",
  );
  assert.equal(
    second!.history[0].before.artworkUrl,
    "https://art.example/version-1.png",
  );
  assert.equal(
    second!.history[0].after.artworkUrl,
    "https://art.example/version-2.png",
  );
});

test("fresh numbered retries preserve original evidence and terminal rejection cannot be reopened", async (t) => {
  const f = await fixture(t);
  const result = await f.claims.createOrGet({
    ...f.input,
    url: "https://github.com/alice/chog",
  });
  assert.equal(result.kind, "claim");
  if (result.kind !== "claim") return;
  const id = result.item.id,
    original = await f.claims.getPublicEvidence(id);
  await f.db
    .collection<any>("claims")
    .updateOne(
      { _id: id },
      { $set: { status: "source_unavailable", finalized_at: new Date() } },
    );
  f.change();
  const retry = await f.claims.retry(
    id,
    f.session.walletId,
    account.address,
    "retry-1",
    f.session.authProofId,
  );
  assert.equal(retry!.id, id);
  assert.equal(retry!.attempt, 2);
  assert.equal(retry!.status, "submitted");
  assert.equal(await f.claims.getPublicEvidence(id), original);
  assert.notEqual(await f.claims.getPublicEvidence(id, 2), original);
  assert.equal(f.memory.rows("claim_attempts")[1].contract_claim_id, `${id}:2`);
  const again = await f.claims.retry(
    id,
    f.session.walletId,
    account.address,
    "retry-1",
    f.session.authProofId,
  );
  assert.equal(again!.attempt, 2);
  assert.equal(f.memory.rows("claim_attempts").length, 2);
  const publicDetail = await f.claims.getPublic(id);
  assert.equal(publicDetail!.attempts.length, 2);
  assert.ok(!JSON.stringify(publicDetail).includes("signature"));
  assert.ok(!JSON.stringify(publicDetail).includes("Nonce:"));
  await f.db
    .collection<any>("claims")
    .updateOne({ _id: id }, { $set: { status: "rejected" } });
  await assert.rejects(
    f.claims.retry(
      id,
      f.session.walletId,
      account.address,
      "retry-2",
      f.session.authProofId,
    ),
    /claim_not_retryable/,
  );
  assert.equal(f.memory.rows("xp_ledger").length, 0);
});

test("unknown submissions request reconciliation without another evidence attempt or provider fetch", async (t) => {
  const f = await fixture(t);
  const result = await f.claims.createOrGet({
    ...f.input,
    url: "https://github.com/alice/chog",
  });
  if (result.kind !== "claim") assert.fail(result.kind);
  await f.db
    .collection<any>("claims")
    .updateOne(
      { _id: result.item.id },
      {
        $set: {
          status: "needs_review",
          last_error_code: "submission_reference_unknown",
        },
      },
    );
  const count = f.fetches;
  await f.claims.retry(
    result.item.id,
    f.session.walletId,
    account.address,
    "reconcile-1",
    f.session.authProofId,
  );
  assert.equal(f.fetches, count);
  assert.equal(f.memory.rows("claim_attempts").length, 1);
  assert.equal(f.memory.rows("claims")[0].reconciliation_requested, true);
  f.transfer();
  await assert.rejects(
    f.claims.retry(
      result.item.id,
      f.session.walletId,
      account.address,
      "reconcile-2",
      f.session.authProofId,
    ),
    /not_currently_owned/,
  );
});

test("capture jobs stop after three automatic attempts and a manual retry can recover an expired preview", async (t) => {
  const f = await fixture(t);
  f.outage();
  const preview = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url: "https://github.com/alice/chog" },
    "failing",
  );
  assert.equal(preview.status, "source_unavailable");
  for (let i = 0; i < 2; i++) {
    await f.db
      .collection<any>("evidence_previews")
      .updateOne({ _id: preview.id }, { $set: { next_attempt_at: null } });
    assert.equal(await f.previews.process(preview.id), true);
  }
  await f.db
    .collection<any>("evidence_previews")
    .updateOne({ _id: preview.id }, { $set: { next_attempt_at: null } });
  assert.equal(await f.previews.process(preview.id), false);
  assert.equal(f.memory.rows("evidence_previews")[0].attempts, 3);
  await f.db
    .collection<any>("evidence_previews")
    .updateOne({ _id: preview.id }, { $set: { expires_at: new Date(0) } });
  f.recover();
  assert.equal(
    (await f.previews.retry(preview.id, f.session.walletId, "retry")).status,
    "ready",
  );
});

test("reward-limited previews can still create zero-expected-XP claims and cannot bypass source uniqueness", async (t) => {
  const f = await fixture(t);
  await f.db
    .collection<any>("xp_ledger")
    .insertOne({
      _id: randomUUID(),
      claim_id: "prior",
      wallet_id: f.session.walletId,
      reward_family: "contribution",
      amount: 75,
      created_at: new Date(),
    });
  const preview = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url: "https://github.com/alice/chog" },
    "limited",
  );
  assert.equal(preview.eligibility.eligible, true);
  assert.equal(preview.eligibility.reasonCode, "daily_cap");
  assert.equal((preview.eligibility as any).rewardXp, 0);
  const claim = await f.claims.createOrGet({
    ...f.input,
    previewId: preview.id,
  });
  assert.equal(claim.kind, "claim");
  const duplicate = await f.previews.create(
    f.session,
    { profileId: f.profile.id, url: "https://github.com/alice/chog" },
    "duplicate",
  );
  assert.equal(duplicate.eligibility.eligible, false);
  assert.equal(duplicate.eligibility.reasonCode, "duplicate_source");
});

test("earned equipment CAS persists removal, replay and noop receipts without rewarding cosmetic changes", async (t) => {
  const f = await fixture(t);
  await f.db
    .collection<any>("nft_profiles")
    .updateOne(
      { _id: f.profile.id },
      {
        $set: {
          xp: 350,
          stage: "veteran",
          level: 4,
          earned_trait_ids: ["bright-eyes", "trail-scarf", "star-crown"],
        },
      },
    );
  const noop = await f.profiles.setEquipment(
    f.session.walletId,
    account.address,
    f.profile.id,
    [],
    0,
    "noop",
    f.factory,
  );
  assert.equal(noop.version, 0);
  const changed = await f.profiles.setEquipment(
    f.session.walletId,
    account.address,
    f.profile.id,
    ["trail-scarf"],
    0,
    "equip",
    f.factory,
  );
  assert.equal(changed.version, 1);
  assert.deepEqual(changed.equippedTraitIds, ["trail-scarf"]);
  assert.equal(
    (
      await f.profiles.setEquipment(
        f.session.walletId,
        account.address,
        f.profile.id,
        [],
        0,
        "noop",
        f.factory,
      )
    ).version,
    1,
  );
  assert.equal(
    (
      await f.profiles.setEquipment(
        f.session.walletId,
        account.address,
        f.profile.id,
        ["trail-scarf"],
        0,
        "equip",
        f.factory,
      )
    ).version,
    1,
  );
  await assert.rejects(
    f.profiles.setEquipment(
      f.session.walletId,
      account.address,
      f.profile.id,
      ["star-crown"],
      0,
      "stale",
      f.factory,
    ),
    /version_conflict/,
  );
  await assert.rejects(
    f.profiles.setEquipment(
      f.session.walletId,
      account.address,
      f.profile.id,
      ["star-crown", "trail-scarf"],
      1,
      "invalid",
      f.factory,
    ),
    /invalid_or_locked/,
  );
  const removed = await f.profiles.setEquipment(
    f.session.walletId,
    account.address,
    f.profile.id,
    [],
    1,
    "remove",
    f.factory,
  );
  assert.equal(removed.version, 2);
  assert.equal(removed.xp, 350);
  assert.deepEqual(removed.equippedTraitIds, []);
  assert.equal(f.memory.rows("evolution_jobs").length, 2);
  assert.equal(f.memory.rows("xp_ledger").length, 0);
  assert.ok(
    f.memory
      .rows("evolution_history")
      .every((row) => row.kind === "trait_change" && !row.claim_id),
  );
});
