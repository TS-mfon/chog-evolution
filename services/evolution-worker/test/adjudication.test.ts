import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  transactionFinality,
  createAdjudicator,
  type Adjudicator,
} from "../src/genlayer.js";
import { finalize, processOne, validateDecision } from "../src/index.js";
import { artifactUrl, artworkVersionFilter } from "../src/artwork.js";
import { studionet } from "genlayer-js-stable/chains";

const wallet = "0x" + "1".repeat(40);
const collection = "0x" + "2".repeat(40);
const tx = "0x" + "3".repeat(64);
const text = JSON.stringify({ wallet, kind: "monad_activity" });
const hash = "0x" + createHash("sha256").update(text).digest("hex");

function fixture() {
  return {
    claim: {
      _id: "claim-a",
      wallet_id: "wallet-a",
      profile_id: "profile-a",
      policy_id: "policy-a",
      quest_id: "quest-a",
      status: "awaiting_genlayer",
      genlayer_tx_id: tx,
      lease_token: "lease-a",
      failure_count: 0,
    },
    wallet: { _id: "wallet-a", address: wallet },
    profile: {
      _id: "profile-a",
      chain_id: 10143,
      collection_address: collection,
      token_id: "7",
      xp: 0,
      version: 0,
    },
    policy: {
      _id: "policy-a",
      version: 1,
      xp_reward: 50,
      policy: { rules: "Verify the wallet's contribution." },
      source_url: "https://example.org/policy",
    },
    evidence: {
      claim_id: "claim-a",
      content_hash: hash,
      payload: { text },
      source_url: "https://example.org/api/v1/evidence/claim-a",
    },
    quest: { _id: "quest-a" },
  };
}

function decision() {
  return {
    claim_id: "claim-a",
    claimant: wallet,
    profile_identity: `10143:${collection}:7`,
    policy_version: 1,
    quest_id: "quest-a",
    outcome: "accepted",
    evidence_hash: hash,
    reason: "Verified contribution",
    xp: 50,
  };
}

// A small repository double captures writes while preserving independent
// persisted state, so stale snapshots and repeat-finalization regressions fail.
function database(item = fixture(), persistedXp = 100, persistedVersion = 2) {
  const rows: Record<string, any[]> = {
    claims: [structuredClone(item.claim)],
    wallets: [item.wallet],
    nft_profiles: [
      { ...item.profile, xp: persistedXp, version: persistedVersion },
    ],
    quest_policies: [item.policy],
    evidence: [item.evidence],
    quests: [item.quest],
    xp_ledger: [],
    decisions: [],
    evolution_jobs: [],
    evolution_history: [],
    audit_events: [],
  };
  const writes: { table: string; query: any; update: any }[] = [];
  const matches = (row: any, query: any) =>
    Object.entries(query).every(
      ([k, v]) =>
        k.startsWith("$") ||
        (typeof v === "object" && v !== null && !(v instanceof Date)) ||
        row[k] === v,
    );
  const db = {
    client: {
      startSession: () => ({
        withTransaction: async (fn: () => Promise<unknown>) => fn(),
        endSession: async () => undefined,
      }),
    },
    collection(table: string) {
      rows[table] ??= [];
      return {
        async findOne(query: any) {
          const row = rows[table]!.find((r) => matches(r, query));
          return row ? structuredClone(row) : null;
        },
        async findOneAndUpdate(_query: any, update: any) {
          const row = rows[table]![0];
          if (!row) return null;
          const set = update[0].$set;
          Object.assign(row, {
            lease_token: set.lease_token,
            lease_until: set.lease_until,
            status: row.genlayer_tx_id ? "awaiting_genlayer" : "verifying",
          });
          return structuredClone(row);
        },
        async updateMany() {
          return { modifiedCount: 0 };
        },
        async updateOne(query: any, update: any, options?: any) {
          writes.push({ table, query, update });
          let row = rows[table]!.find((r) => matches(r, query));
          if (!row && options?.upsert) {
            row = { ...query, ...update.$setOnInsert };
            rows[table]!.push(row);
          }
          if (!row) return { modifiedCount: 0 };
          Object.assign(row, update.$set);
          for (const [key, increment] of Object.entries(update.$inc ?? {}))
            row[key] = (row[key] ?? 0) + Number(increment);
          return { modifiedCount: 1 };
        },
        async insertOne(row: any) {
          rows[table]!.push(structuredClone(row));
          return { insertedId: row._id };
        },
      };
    },
  } as unknown as Db;
  return { db, rows, writes };
}

test("accepted/proposing/unknown GenLayer states cannot award finalized XP", () => {
  for (const status of ["ACCEPTED", "PENDING", "PROPOSING", 5, undefined])
    assert.equal(transactionFinality({ status }), "pending");
  assert.equal(transactionFinality({ statusName: "FINALIZED" }), "finalized");
  assert.equal(transactionFinality({ status: 7 }), "finalized");
  assert.equal(transactionFinality({ status: "CANCELED" }), "failed");
  assert.equal(
    transactionFinality({
      status: 7,
      txExecutionResultName: "FINISHED_WITH_ERROR",
    }),
    "failed",
  );
  assert.equal(
    transactionFinality({ status: 7, resultName: "NO_MAJORITY" }),
    "finalized",
  );
});

test("SDK configuration selects supported stable StudioNet and rejects malformed secrets without echoing them", () => {
  assert.equal(createAdjudicator({}), undefined);
  assert.throws(
    () =>
      createAdjudicator({
        GENLAYER_PRIVATE_KEY: "private-value",
        GENLAYER_CONTRACT_ADDRESS: collection,
      }),
    /credentials_malformed/,
  );
  assert.throws(
    () =>
      createAdjudicator({
        GENLAYER_PRIVATE_KEY: "0x" + "1".repeat(64),
        GENLAYER_CONTRACT_ADDRESS: collection,
        GENLAYER_NETWORK: "wrong",
      }),
    /network_unsupported/,
  );
  assert.ok(
    createAdjudicator({
      GENLAYER_PRIVATE_KEY: "0x" + "1".repeat(64),
      GENLAYER_CONTRACT_ADDRESS: collection,
      GENLAYER_NETWORK: "studionet",
    }),
  );
  const originalUrls = [...studionet.rpcUrls.default.http];
  assert.ok(
    createAdjudicator({
      GENLAYER_PRIVATE_KEY: "0x" + "1".repeat(64),
      GENLAYER_CONTRACT_ADDRESS: collection,
      GENLAYER_RPC_URL: "https://example.org/studio",
    }),
  );
  assert.deepEqual(
    studionet.rpcUrls.default.http,
    originalUrls,
    "an endpoint override must not mutate the exported StudioNet chain",
  );
});

test("decisions are bound to wallet, profile, policy, evidence and capped awards", () => {
  const item = fixture();
  assert.equal(validateDecision(decision(), item).xp, 50);
  for (const delta of [
    { claimant: collection },
    { profile_identity: "other" },
    { policy_version: 2 },
    { evidence_hash: tx },
    { quest_id: "other" },
    { claim_id: "other" },
    { xp: 51 },
    { xp: -1 },
    { xp: 1.5 },
    { outcome: "rejected", xp: 50 },
  ]) {
    assert.throws(
      () => validateDecision({ ...decision(), ...delta }, item),
      /binding_invalid/,
    );
  }
});

test("finalization adds to current persisted XP, stores an immutable evolution snapshot and is idempotent", async () => {
  const item = fixture();
  const { db, rows } = database(item, 100, 2);
  await finalize(db, item, decision(), tx);
  assert.equal(rows.nft_profiles![0].xp, 150);
  assert.equal(rows.nft_profiles![0].version, 3);
  assert.equal(rows.nft_profiles![0].stage, "explorer");
  assert.equal(rows.evolution_jobs![0].evolution_version, 3);
  assert.equal(rows.evolution_jobs![0].snapshot.xp, 150);
  assert.equal(rows.xp_ledger!.length, 1);
  await finalize(db, item, decision(), tx);
  assert.equal(rows.nft_profiles![0].xp, 150);
  assert.equal(rows.xp_ledger!.length, 1);
});

test("a worker whose lease changed cannot apply an old decision", async () => {
  const item = fixture();
  const { db, rows } = database(item);
  rows.claims![0].lease_token = "replacement-worker";
  await finalize(db, item, decision(), tx);
  assert.equal(rows.xp_ledger!.length, 0);
  assert.equal(rows.nft_profiles![0].xp, 100);
});

test("ordinary pending consensus releases its lease without consuming failure retries", async () => {
  const { db, rows } = database();
  const client: Adjudicator = {
    poll: async () => "pending",
    submit: async () => {
      throw new Error("must not submit");
    },
    readDecision: async () => {
      throw new Error("must not read unfinalized state");
    },
  };
  await processOne(db, client);
  assert.equal(rows.claims![0].failure_count, 0);
  assert.equal(rows.claims![0].lease_token, null);
  assert.equal(rows.claims![0].status, "awaiting_genlayer");
  assert.ok(rows.claims![0].next_attempt_at instanceof Date);
  assert.equal(rows.xp_ledger!.length, 0);
});

test("an ambiguous external submission is held for reconciliation instead of broadcasting again", async () => {
  const item = fixture();
  item.claim.genlayer_tx_id = null as any;
  item.claim.status = "submitted";
  const { db, rows } = database(item);
  let submissions = 0;
  await processOne(db, {
    poll: async () => "pending",
    readDecision: async () => null,
    submit: async () => {
      submissions++;
      throw new Error("connection ended after send");
    },
  });
  assert.equal(submissions, 1);
  assert.equal(rows.claims![0].status, "needs_review");
  assert.equal(rows.claims![0].last_error_code, "submission_reference_unknown");
  assert.equal(rows.xp_ledger!.length, 0);
});

test("a confirmed successful submission is persisted for later polling without awarding XP", async () => {
  const item = fixture();
  item.claim.genlayer_tx_id = null as any;
  item.claim.status = "submitted";
  const { db, rows } = database(item);
  await processOne(db, {
    poll: async () => "pending",
    readDecision: async () => null,
    submit: async (args) => {
      assert.equal(args[7], text);
      assert.equal(args[8], hash);
      return tx;
    },
  });
  assert.equal(rows.claims![0].genlayer_tx_id, tx);
  assert.equal(rows.claims![0].status, "awaiting_genlayer");
  assert.equal(rows.claims![0].lease_token, null);
  assert.equal(rows.xp_ledger!.length, 0);
});

test("an oversized effective policy is rejected before any GenLayer submission", async () => {
  const item = fixture();
  item.claim.genlayer_tx_id = null as any;
  item.claim.status = "submitted";
  item.policy.policy.rules = "x".repeat(4000);
  const { db, rows } = database(item);
  let submissions = 0;
  await processOne(db, {
    poll: async () => "pending",
    readDecision: async () => null,
    submit: async () => {
      submissions++;
      return tx;
    },
  });
  assert.equal(submissions, 0);
  assert.equal(
    rows.claims![0].last_error_code,
    "genlayer_submission_bounds_invalid",
  );
  assert.equal(rows.xp_ledger!.length, 0);
});

test("artifact URLs work behind Next and for standalone APIs; old artwork cannot overwrite a newer evolution", () => {
  const id = "a".repeat(24);
  assert.equal(artifactUrl(id, {}), `/api/v1/artifacts/${id}`);
  assert.equal(
    artifactUrl(id, { PUBLIC_API_URL: "" }),
    `/api/v1/artifacts/${id}`,
  );
  assert.equal(
    artifactUrl(id, { PUBLIC_API_URL: "https://api.example.org/" }),
    `https://api.example.org/v1/artifacts/${id}`,
  );
  assert.equal(artifactUrl(id, { PUBLIC_API_PATH: "" }), `/v1/artifacts/${id}`);
  assert.deepEqual(artworkVersionFilter("profile-a", 3), {
    _id: "profile-a",
    version: 3,
  });
  assert.throws(() => artifactUrl("../bad", {}), /invalid_artifact_id/);
});
