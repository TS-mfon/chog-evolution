import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { encodeEventTopics, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../src/index.js";
import { MongoClaimRepository, policyUsable } from "../src/claim-repository.js";
import {
  ApiError,
  publicApiBase,
  publicConfiguration,
  transferAbi,
  type ChainClient,
  type ClientFactory,
} from "../src/config.js";
import {
  captureContribution,
  evidenceDigest,
  parseContributionUrl,
} from "../src/evidence-source.js";
import { MongoProfileRepository } from "../src/profile-repository.js";
import { ensureIndexes, seedAppQuests } from "../src/mongo.js";
import { MemoryDb } from "./memory-db.js";

const alice = privateKeyToAccount(`0x${"11".repeat(32)}`);
const bob = privateKeyToAccount(`0x${"22".repeat(32)}`);
const collection = "0x0000000000000000000000000000000000000010" as Address;
const original = "0x0000000000000000000000000000000000000020" as Address;
const protocol = "0x0000000000000000000000000000000000000030" as Address;
const hash = (value: number): Hex =>
  `0x${value.toString(16).padStart(64, "0")}`;
const blockHash = (value: bigint) => hash(Number(value) + 10_000);

test("blank public API overrides fall back to the configured app origin", async (t) => {
  await fixture(t);
  process.env.PUBLIC_API_URL = "";
  assert.equal(publicApiBase(), "https://chog.example/api");
  assert.equal(publicConfiguration().features.evidence, true);
  process.env.PUBLIC_API_URL = "   ";
  process.env.APP_ORIGIN = "";
  assert.equal(publicApiBase(), "https://chog.example/api");
  process.env.PUBLIC_API_URL = " https://api.chog.example ";
  assert.equal(publicApiBase(), "https://api.chog.example");
});

function mockRpc(chainId: number) {
  const state = {
    head: 100n,
    next: 2n,
    max: 100n,
    chainId,
    owner: alice.address,
    ownerCalls: 0,
    simulations: 0,
    transactions: new Map<Hex, any>(),
    receipts: new Map<Hex, any>(),
    blocks: new Map<bigint, any>(),
    code: "0x60016000" as Hex,
  };
  const client = {
    async getChainId() {
      return state.chainId;
    },
    async readContract({ functionName, args }: any) {
      if (functionName === "name") return "CHOG Evolution Demo";
      if (functionName === "symbol") return "DCHOG";
      if (functionName === "nextTokenId") return state.next;
      if (functionName === "maxSupply") return state.max;
      if (functionName === "ownerOf") {
        state.ownerCalls++;
        if (args[0] <= 0n || args[0] >= state.next)
          throw new Error("execution reverted: nonexistent token");
        return state.owner;
      }
      if (functionName === "balanceOf") return state.next - 1n;
      if (functionName === "supportsInterface") return false;
      throw new Error(`Unexpected mock read ${functionName}`);
    },
    async simulateContract() {
      state.simulations++;
      return {};
    },
    async getBlockNumber() {
      return state.head;
    },
    async getTransaction({ hash: id }: any) {
      const tx = state.transactions.get(id);
      if (!tx)
        throw Object.assign(new Error("pending"), {
          name: "TransactionNotFoundError",
        });
      return tx;
    },
    async getTransactionReceipt({ hash: id }: any) {
      const tx = state.receipts.get(id);
      if (!tx)
        throw Object.assign(new Error("pending"), {
          name: "TransactionReceiptNotFoundError",
        });
      return tx;
    },
    async getBlock({ blockNumber }: any) {
      return (
        state.blocks.get(blockNumber) ?? {
          number: blockNumber,
          hash: blockHash(blockNumber),
          timestamp: 1_792_368_000n,
          transactions: [],
        }
      );
    },
    async getBytecode() {
      return state.code;
    },
  } as unknown as ChainClient;
  return { state, client };
}

function addTransaction(
  rpc: ReturnType<typeof mockRpc>,
  id: number,
  block = 97n,
  from: Address = alice.address,
  to: Address = protocol,
  input: Hex = "0x12345678",
) {
  const tx = {
    hash: hash(id),
    from,
    to,
    input,
    nonce: id,
    value: 0n,
    blockNumber: block,
    blockHash: blockHash(block),
  };
  const receipt = {
    transactionHash: tx.hash,
    from,
    to,
    blockNumber: block,
    blockHash: blockHash(block),
    status: "success",
    logs: [] as any[],
  };
  rpc.state.transactions.set(tx.hash, tx);
  rpc.state.receipts.set(tx.hash, receipt);
  return { tx, receipt };
}

function addMint(rpc: ReturnType<typeof mockRpc>, tokenId = 1n, id = 1) {
  const item = addTransaction(
    rpc,
    id,
    90n,
    alice.address,
    collection,
    "0x1249c58b",
  );
  item.receipt.logs = [
    {
      address: collection,
      data: "0x",
      blockNumber: 90n,
      blockHash: blockHash(90n),
      transactionHash: item.tx.hash,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
      topics: encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from: zeroAddress, to: alice.address, tokenId },
      }),
    },
  ];
  return item;
}

async function fixture(t: TestContext, request?: typeof fetch) {
  const environment: Record<string, string | undefined> = {
    NODE_ENV: "test",
    APP_ORIGIN: "https://chog.example",
    WEB_ORIGIN: "https://chog.example",
    PUBLIC_API_URL: undefined,
    PUBLIC_API_PATH: "/api",
    DEMO_COLLECTION_ADDRESS: collection,
    ORIGINAL_CHOG_COLLECTION_ADDRESS: original,
    MONAD_TESTNET_CHAIN_ID: "10143",
    MONAD_MAINNET_CHAIN_ID: "143",
    MONAD_TESTNET_RPC_URL: "https://testnet.example.invalid/private-key",
    MONAD_MAINNET_RPC_URL: "https://mainnet.example.invalid/private-key",
    GENLAYER_CONTRACT_ADDRESS: collection,
    MONAD_SCAN_TARGETS: "[]",
    MONAD_FINALITY_BLOCKS: "4",
    SCAN_WALLET_BLOCKS_PER_REQUEST: "1",
    SCAN_WALLET_LOOKBACK_BLOCKS: "1",
    X_SOURCE_MODE: "api",
    X_API_BEARER_TOKEN: "test-provider-token",
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const db = new MemoryDb();
  await ensureIndexes(db.db);
  const demo = mockRpc(10143),
    mainnet = mockRpc(143);
  const factories: number[] = [];
  const factory: ClientFactory = (config) => {
    factories.push(config.chainId);
    return config.chainId === 10143 ? demo.client : mainnet.client;
  };
  const app = buildApp(undefined, {
    database: db.db,
    factory,
    logger: false,
    ...(request ? { request } : {}),
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  async function login(account = alice) {
    const nonce = await app.inject({
      method: "POST",
      url: "/v1/auth/nonce",
      payload: { address: account.address, chainId: 10143 },
    });
    assert.equal(nonce.statusCode, 201);
    const message = nonce.json().message;
    const signature = await account.signMessage({ message });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { message, signature },
    });
    assert.equal(response.statusCode, 200, response.body);
    const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
    const wallet = db
      .rows("wallets")
      .find((row) => row.address === account.address.toLowerCase());
    const session = db
      .rows("wallet_sessions")
      .find((row) => row.wallet_id === wallet._id);
    return {
      cookie,
      walletId: wallet._id as string,
      authProofId: session.auth_proof_id as string,
      message,
      signature,
    };
  }
  return { db, app, demo, mainnet, factory, factories, login };
}

test("wallet authentication persists across requests, rejects nonce replay, and isolates sessions", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const me = await f.app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie: signed.cookie },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().wallet, alice.address.toLowerCase());
  assert.equal(f.db.rows("wallet_auth_proofs")[0].signature, signed.signature);
  const replay = await f.app.inject({
    method: "POST",
    url: "/v1/auth/verify",
    payload: { message: signed.message, signature: signed.signature },
  });
  assert.equal(replay.statusCode, 401);
  const tampered = await f.app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie: `${signed.cookie}tampered` },
  });
  assert.equal(tampered.statusCode, 401);
  const other = await f.login(bob);
  assert.notEqual(other.walletId, signed.walletId);
  const logout = await f.app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { cookie: signed.cookie },
  });
  assert.equal(logout.statusCode, 200);
  assert.equal(
    (
      await f.app.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: { cookie: signed.cookie },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: { cookie: other.cookie },
      })
    ).statusCode,
    200,
  );
});

test("public config never exposes server RPC credentials and mint preparation checks sold-out state", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const config = publicConfiguration();
  assert.equal(config.demo.rpcUrl, "https://testnet-rpc.monad.xyz");
  assert.equal(config.mainnet.rpcUrl, "https://rpc.monad.xyz");
  assert.ok(!JSON.stringify(config).includes("private-key"));
  const prepared = await f.app.inject({
    method: "POST",
    url: "/v1/mints/prepare",
    headers: { cookie: signed.cookie },
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  assert.equal(prepared.json().transaction.to, collection);
  assert.equal(prepared.json().transaction.data, "0x1249c58b");
  assert.deepEqual(prepared.json().supply, { minted: "1", maxSupply: "100" });
  f.demo.state.next = 101n;
  const soldOut = await f.app.inject({
    method: "POST",
    url: "/v1/mints/prepare",
    headers: { cookie: signed.cookie },
  });
  assert.equal(soldOut.statusCode, 409);
  assert.equal(soldOut.json().error, "mint_sold_out");
  assert.equal(f.demo.state.simulations, 1);
});

test("mint confirmation derives token identity, stores proof, and replays one immutable claim without XP", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const minted = addMint(f.demo);
  const options = {
    method: "POST" as const,
    url: "/v1/mints/confirm",
    headers: { cookie: signed.cookie },
    payload: { transactionHash: minted.tx.hash },
  };
  const first = await f.app.inject(options);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().item.nft.tokenId, "1");
  assert.ok(first.json().claim?.id, first.body);
  const again = await f.app.inject(options);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().item.id, first.json().item.id);
  assert.equal(again.json().claim.id, first.json().claim.id);
  assert.equal(f.db.rows("nft_profiles").length, 1);
  assert.equal(f.db.rows("claims").length, 1);
  assert.equal(f.db.rows("nft_profiles")[0].xp, 0);
  assert.equal(f.db.rows("xp_ledger").length, 0);
  const profile = f.db.rows("nft_profiles")[0];
  assert.equal(profile.mint_transaction_hash, minted.tx.hash);
  assert.equal(profile.mint_proof.transaction_nonce, 1);
  const evidence = f.db.rows("evidence")[0];
  assert.equal(
    evidence.source_url,
    `https://chog.example/api/v1/evidence/${first.json().claim.id}`,
  );
  assert.equal(evidence.verified_wallet_proof.signature, signed.signature);
  assert.ok(!evidence.payload.text.includes(signed.signature));
  assert.ok(!evidence.payload.text.includes(signed.message));
  const publicEvidence = await f.app.inject({
    method: "GET",
    url: `/v1/evidence/${first.json().claim.id}`,
  });
  assert.equal(publicEvidence.statusCode, 200);
  assert.equal(publicEvidence.body, evidence.payload.text);
  assert.equal(evidenceDigest(publicEvidence.body), evidence.content_hash);
  const activity = await f.app.inject({
    method: "GET",
    url: "/v1/activity",
    headers: { cookie: signed.cookie },
  });
  assert.ok(activity.json().items.some((item: any) => item.type === "mint"));
});

test("mint recovery retries a failed review without minting again, and never registers an unfinalized receipt", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const minted = addMint(f.demo);
  const options = {
    method: "POST" as const,
    url: "/v1/mints/confirm",
    headers: { cookie: signed.cookie },
    payload: { transactionHash: minted.tx.hash },
  };
  f.demo.state.head = 91n;
  const pending = await f.app.inject(options);
  assert.equal(pending.statusCode, 202);
  assert.equal(pending.json().error, "mint_receipt_pending");
  assert.equal(f.db.rows("nft_profiles").length, 0);
  f.demo.state.head = 100n;
  const quest = f.db
    .rows("quests")
    .find((row) => row.slug === "demo-first-mint");
  quest.status = "inactive";
  const registered = await f.app.inject(options);
  assert.equal(registered.statusCode, 200);
  assert.ok(registered.json().claimWarning);
  assert.equal(f.db.rows("claims").length, 0);
  quest.status = "active";
  const recovered = await f.app.inject(options);
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().item.id, registered.json().item.id);
  assert.ok(recovered.json().claim.id);
  assert.equal(f.db.rows("nft_profiles").length, 1);
  assert.equal(f.demo.state.simulations, 0);
});

test("mint proofs cannot reward another token or a wallet after ownership transfer", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  f.demo.state.next = 3n;
  const minted = addMint(f.demo, 2n);
  const profiles = new MongoProfileRepository(f.db.db);
  const profile = await profiles.register(signed.walletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "1",
  });
  const quest = f.db
    .rows("quests")
    .find((row) => row.slug === "demo-first-mint");
  const claim = await f.app.inject({
    method: "POST",
    url: "/v1/claims",
    headers: { cookie: signed.cookie, "idempotency-key": "different-token" },
    payload: {
      profileId: profile.id,
      questId: quest._id,
      transactionHash: minted.tx.hash,
    },
  });
  assert.equal(claim.statusCode, 422, claim.body);
  assert.equal(claim.json().error, "mint_invalid_transaction");
  assert.equal(f.db.rows("claims").length, 0);
  f.demo.state.owner = bob.address;
  const transferred = await f.app.inject({
    method: "POST",
    url: "/v1/mints/confirm",
    headers: { cookie: signed.cookie },
    payload: { transactionHash: minted.tx.hash },
  });
  assert.equal(transferred.statusCode, 403);
  const other = await f.login(bob);
  const foreign = await f.app.inject({
    method: "POST",
    url: "/v1/claims",
    headers: { cookie: other.cookie, "idempotency-key": "wrong-wallet" },
    payload: { profileId: profile.id, questId: quest._id },
  });
  assert.equal(foreign.statusCode, 404);
});

function githubFetch(
  calls: string[],
  readme = `# Chog SDK\nAn original Monad integration with documented transaction handling.\nMaintainer wallet: ${alice.address}`,
): typeof fetch {
  return (async (url, init) => {
    const target = String(url);
    calls.push(target);
    assert.equal(new URL(target).hostname, "api.github.com");
    assert.equal(init?.redirect, "error");
    const repository = target.includes("/second") ? "second" : "project";
    if (target.includes("/git/ref/"))
      return Response.json({ object: { type: "commit", sha: "a".repeat(40) } });
    if (target.includes("/readme"))
      return Response.json({
        encoding: "base64",
        content: Buffer.from(readme).toString("base64"),
        sha: "b".repeat(40),
        path: "README.md",
      });
    return Response.json({
      id: repository === "project" ? 123 : 124,
      private: false,
      full_name: `builder/${repository}`,
      default_branch: "main",
      description: "Chog integration",
      owner: { login: "builder" },
      fork: false,
      archived: false,
    });
  }) as typeof fetch;
}

test("contribution snapshots fetch pinned public content and deduplicate canonical sources across contexts and profiles", async (t) => {
  const calls: string[] = [];
  const f = await fixture(t, githubFetch(calls));
  const signed = await f.login();
  const profile = await new MongoProfileRepository(f.db.db).register(
    signed.walletId,
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  const send = (url: string, key: string, text = "My contribution") =>
    f.app.inject({
      method: "POST",
      url: "/v1/upgrades/evidence",
      headers: { cookie: signed.cookie, "idempotency-key": key },
      payload: { profileId: profile.id, url, text },
    });
  const first = await send(
    "https://github.com/Builder/Project?utm_source=x",
    "evidence-1",
  );
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(calls.length, 3);
  assert.ok(calls[2]?.endsWith(`?ref=${"a".repeat(40)}`));
  const replay = await send("https://github.com/builder/project", "evidence-1");
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().item.id, first.json().item.id);
  const changedIntent = await send(
    "https://github.com/builder/project",
    "evidence-1",
    "Changed context",
  );
  assert.equal(changedIntent.statusCode, 409);
  const duplicate = await send(
    "https://github.com/builder/project",
    "evidence-new-key",
    "Changed context",
  );
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().item.id, first.json().item.id);
  assert.equal(calls.length, 3);
  const second = await send("https://github.com/builder/second", "evidence-2");
  assert.equal(second.statusCode, 202, second.body);
  assert.equal(f.db.rows("claims").length, 2);
  const snapshot = JSON.parse(f.db.rows("evidence")[0].payload.text);
  assert.equal(snapshot.source.public_content.commit_sha, "a".repeat(40));
  assert.equal(snapshot.source.identity_binding.verified, true);
  assert.equal(snapshot.user_context_untrusted, "My contribution");
  assert.equal(
    snapshot.wallet_authentication.address,
    alice.address.toLowerCase(),
  );
  assert.equal(snapshot.wallet_proof, undefined);
  assert.equal(f.db.rows("nft_profiles")[0].xp, 0);
});

test("contribution allowlist rejects SSRF URLs before any request and refuses unbound GitHub evidence", async (t) => {
  for (const url of [
    "http://github.com/a/b",
    "https://127.0.0.1/a/b",
    "https://github.com.evil.test/a/b",
    "https://github.com@127.0.0.1/a/b",
    "https://github.com:444/a/b",
    "https://api.github.com/a/b",
    "https://localhost/a/b",
    "file:///etc/passwd",
    "https://github.com/a/b/../../../../etc/passwd",
    "https://github.com/a/b#fragment",
  ]) {
    assert.throws(() => parseContributionUrl(url), ApiError, url);
  }
  const calls: string[] = [];
  const f = await fixture(
    t,
    githubFetch(
      calls,
      "# A generic project without verifiable wallet attribution",
    ),
  );
  const signed = await f.login();
  const profile = await new MongoProfileRepository(f.db.db).register(
    signed.walletId,
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/upgrades/evidence",
    headers: { cookie: signed.cookie, "idempotency-key": "unbound-evidence" },
    payload: {
      profileId: profile.id,
      url: "https://github.com/builder/project",
      text: `I own it: ${alice.address}`,
    },
  });
  assert.equal(response.statusCode, 422, response.body);
  assert.equal(response.json().error, "github_wallet_attribution_required");
  assert.equal(f.db.rows("claims").length, 0);
});

test("X evidence requires official provider author identity and bounded readable responses", async (t) => {
  await fixture(t);
  const source = parseContributionUrl(
    "https://twitter.com/chogger/status/123?ref=test",
  );
  assert.equal(source.canonicalUrl, "https://x.com/chogger/status/123");
  const response: typeof fetch = async () =>
    Response.json({
      data: {
        id: "123",
        text: "An original Chog guide",
        author_id: "55",
        created_at: "2026-10-19T00:00:00Z",
      },
      includes: { users: [{ id: "55", username: "chogger" }] },
    });
  await assert.rejects(
    captureContribution(source, alice.address, null, response),
    (error: any) => error.code === "x_profile_link_required",
  );
  await assert.rejects(
    captureContribution(
      source,
      alice.address,
      { provider_user_id: "66", username: "other" },
      response,
    ),
    (error: any) => error.code === "evidence_author_not_linked_to_wallet",
  );
  const verified = await captureContribution(
    source,
    alice.address,
    { provider_user_id: "55", username: "chogger" },
    response,
  );
  assert.equal(verified.identity_binding.verified, true);
  const oversized: typeof fetch = async () =>
    new Response("x".repeat(193 * 1024));
  await assert.rejects(
    captureContribution(
      source,
      alice.address,
      { provider_user_id: "55", username: "chogger" },
      oversized,
    ),
    (error: any) => error.code === "evidence_source_too_large",
  );
});

test("mainnet rescans use the NFT chain only for ownership and queue one daily reward across profiles", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  f.demo.state.next = 3n;
  const profiles = new MongoProfileRepository(f.db.db);
  const first = await profiles.register(signed.walletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "1",
  });
  const second = await profiles.register(signed.walletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "2",
  });
  const a = addTransaction(f.mainnet, 10);
  const b = addTransaction(f.mainnet, 11);
  const foreign = addTransaction(f.mainnet, 12, 97n, bob.address);
  const reverted = addTransaction(f.mainnet, 13);
  reverted.receipt.status = "reverted";
  const empty = addTransaction(
    f.mainnet,
    14,
    97n,
    alice.address,
    protocol,
    "0x",
  );
  f.mainnet.state.blocks.set(97n, {
    number: 97n,
    hash: blockHash(97n),
    timestamp: 1_792_368_000n,
    transactions: [a.tx, b.tx, foreign.tx, reverted.tx, empty.tx],
  });
  const request = (profileId: string) =>
    f.app.inject({
      method: "POST",
      url: "/v1/scans",
      headers: { cookie: signed.cookie },
      payload: { profileId },
    });
  const firstScan = await request(first.id);
  assert.equal(firstScan.statusCode, 200, firstScan.body);
  assert.equal(firstScan.json().item.chainId, 143);
  assert.equal(firstScan.json().item.events.length, 2);
  assert.equal(firstScan.json().claims.length, 1);
  assert.equal(f.db.rows("claims").length, 1);
  assert.equal(f.mainnet.state.ownerCalls, 0);
  assert.ok(f.demo.state.ownerCalls > 0);
  assert.ok(f.factories.includes(143) && f.factories.includes(10143));
  const repeated = await request(first.id);
  assert.equal(repeated.statusCode, 200);
  assert.equal(f.db.rows("scan_events").length, 2);
  f.mainnet.state.head = 101n;
  const next = addTransaction(f.mainnet, 15, 98n);
  f.mainnet.state.blocks.set(98n, {
    number: 98n,
    hash: blockHash(98n),
    timestamp: 1_792_368_100n,
    transactions: [next.tx],
  });
  const secondScan = await request(second.id);
  assert.equal(secondScan.statusCode, 200, secondScan.body);
  assert.equal(f.db.rows("claims").length, 1);
  assert.equal(secondScan.json().claims[0].id, firstScan.json().claims[0].id);
  assert.equal(f.db.rows("xp_ledger").length, 0);
  assert.ok(f.db.rows("nft_profiles").every((row) => row.xp === 0));
  const evidence = JSON.parse(f.db.rows("evidence")[0].payload.text);
  assert.equal(evidence.activity.chain_id, 143);
  assert.equal(evidence.profile.chain_id, 10143);
  assert.equal(evidence.activity.transaction_nonce, 10);
  assert.equal(evidence.activity.receipt_status, "success");
});

test("mainnet scans refuse foreign profiles and a misrouted testnet RPC", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const other = await f.login(bob);
  const profile = await new MongoProfileRepository(f.db.db).register(
    signed.walletId,
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  const foreign = await f.app.inject({
    method: "POST",
    url: "/v1/scans",
    headers: { cookie: other.cookie },
    payload: { profileId: profile.id },
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(f.factories.length, 0);
  f.mainnet.state.chainId = 10143;
  const wrongChain = await f.app.inject({
    method: "POST",
    url: "/v1/scans",
    headers: { cookie: signed.cookie },
    payload: { profileId: profile.id },
  });
  assert.equal(wrongChain.statusCode, 503);
  assert.equal(wrongChain.json().error, "rpc_chain_mismatch");
  assert.equal(f.db.rows("scan_jobs").length, 0);
});

test("automatic discovery verifies current owners and rejects cross-wallet cursors", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/profiles/discover",
    headers: { cookie: signed.cookie },
    payload: { mode: "demo" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items.length, 1);
  assert.equal(response.json().items[0].nft.tokenId, "1");
  const cursor = Buffer.from(
    JSON.stringify({
      mode: "demo",
      wallet: bob.address.toLowerCase(),
      collection: collection.toLowerCase(),
      next: 1,
      end: 2,
      method: "ids",
    }),
  ).toString("base64url");
  const bad = await f.app.inject({
    method: "POST",
    url: "/v1/profiles/discover",
    headers: { cookie: signed.cookie },
    payload: { mode: "demo", cursor },
  });
  assert.equal(bad.statusCode, 400);
});

test("evergreen app policies remain usable, external campaigns expire, and legacy artwork paths are normalized", async (t) => {
  const f = await fixture(t);
  const old = {
    version: 1,
    xp_reward: 50,
    source_checked_at: new Date("2020-01-01"),
    policy: { kind: "demo_mint", sourceFreshness: "maintained" },
  };
  assert.equal(policyUsable(old), true);
  assert.equal(
    policyUsable({ ...old, policy: { kind: "public_evidence" } }),
    false,
  );
  assert.equal(
    policyUsable({ ...old, ends_at: new Date("2020-01-02") }),
    false,
  );
  const policyCount = f.db.rows("quest_policies").length;
  await seedAppQuests(f.db.db);
  assert.equal(f.db.rows("quest_policies").length, policyCount);
  const signed = await f.login();
  const profile = await new MongoProfileRepository(f.db.db).register(
    signed.walletId,
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  f.db.rows("nft_profiles")[0].artwork_url = "/v1/artifacts/abc";
  const passport = await f.app.inject({
    method: "GET",
    url: `/v1/passports/${profile.id}`,
  });
  assert.equal(
    passport.json().item.profile.artworkUrl,
    "https://chog.example/api/v1/artifacts/abc",
  );
});

test("concurrent identical submissions commit one claim and one immutable evidence snapshot", async (t) => {
  const calls: string[] = [];
  const f = await fixture(t, githubFetch(calls));
  const signed = await f.login();
  const profile = await new MongoProfileRepository(f.db.db).register(
    signed.walletId,
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  const quest = f.db
    .rows("quests")
    .find((row) => row.slug === "ecosystem-contribution");
  const claims = new MongoClaimRepository(
    f.db.db,
    f.factory,
    githubFetch(calls),
  );
  const input = {
    profileId: profile.id,
    questId: quest._id,
    walletId: signed.walletId,
    walletAddress: alice.address,
    authProofId: signed.authProofId,
    idempotencyKey: "parallel-source",
    url: "https://github.com/builder/project",
    text: "An original contribution",
  };
  const results = await Promise.all([
    claims.createOrGet(input),
    claims.createOrGet(input),
  ]);
  assert.ok(results.every((result) => result.kind === "claim"));
  const accepted = results.filter((result) => result.kind === "claim");
  assert.equal(accepted.filter((result) => result.duplicate).length, 1);
  assert.equal(accepted[0]?.item.id, accepted[1]?.item.id);
  assert.equal(f.db.rows("claims").length, 1);
  assert.equal(f.db.rows("evidence").length, 1);
  const stored = f.db.rows("evidence")[0];
  assert.equal(stored.content_hash, evidenceDigest(stored.payload.text));
});

test("a contribution source cannot be reused by another wallet and never leaks its original claim", async (t) => {
  const calls: string[] = [];
  const f = await fixture(
    t,
    githubFetch(
      calls,
      `# Original Chog contribution\nMaintainers: ${alice.address} and ${bob.address}`,
    ),
  );
  const first = await f.login();
  const second = await f.login(bob);
  f.demo.state.next = 3n;
  const profiles = new MongoProfileRepository(f.db.db);
  const a = await profiles.register(first.walletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "1",
  });
  const b = await profiles.register(second.walletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "2",
  });
  const send = (cookie: string, profileId: string) =>
    f.app.inject({
      method: "POST",
      url: "/v1/upgrades/evidence",
      headers: { cookie, "idempotency-key": "same-user-key" },
      payload: { profileId, url: "https://github.com/builder/project" },
    });
  assert.equal((await send(first.cookie, a.id)).statusCode, 202);
  f.demo.state.owner = bob.address;
  const reused = await send(second.cookie, b.id);
  assert.equal(reused.statusCode, 409, reused.body);
  assert.equal(reused.json().error, "evidence_already_claimed");
  assert.equal(reused.json().item, undefined);
  assert.equal(f.db.rows("claims").length, 1);
});

test("legacy claim migration preserves decisions while blocking reuse of a previously rewarded X identity", async (t) => {
  const f = await fixture(t);
  const quest = f.db.rows("quests").find((row) => row.slug === "verify-x-bio");
  const policy = f.db
    .rows("quest_policies")
    .find((row) => row.quest_id === quest._id);
  for (const i of [1, 2]) {
    const id = randomUUID();
    await f.db.collection("claims").insertOne({
      _id: id,
      profile_id: randomUUID(),
      wallet_id: randomUUID(),
      quest_id: quest._id,
      policy_id: policy._id,
      idempotency_key: `legacy-${i}`,
      evidence_key: hash(i),
      status: "accepted",
      created_at: new Date(`2026-10-0${i}T00:00:00Z`),
    });
    await f.db.collection("evidence").insertOne({
      _id: randomUUID(),
      claim_id: id,
      payload: { text: JSON.stringify({ provider_user_id: "55" }) },
    });
  }
  await ensureIndexes(f.db.db);
  assert.equal(f.db.rows("claims").length, 2);
  assert.ok(
    f.db
      .rows("claims")
      .every((row) => row.status === "accepted" && row.wallet_once_key),
  );
  assert.equal(
    f.db.rows("claims").filter((row) => row.scope_key === "x-account:55")
      .length,
    1,
  );
  assert.equal(
    f.db.rows("claims").filter((row) => row.scope_key.startsWith("legacy:"))
      .length,
    1,
  );
  await ensureIndexes(f.db.db);
  assert.equal(f.db.rows("claims").length, 2);
});

test("configured mainnet event scans query indexed wallet topics and verify the canonical receipt", async (t) => {
  const f = await fixture(t);
  const signed = await f.login();
  const profile = await new MongoProfileRepository(f.db.db).register(
    signed.walletId,
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  const item = addTransaction(f.mainnet, 91);
  const topics = encodeEventTopics({
    abi: transferAbi,
    eventName: "Transfer",
    args: { from: alice.address, to: bob.address, tokenId: 1n },
  });
  const log = {
    address: protocol,
    data: "0x",
    blockNumber: 97n,
    blockHash: blockHash(97n),
    transactionHash: item.tx.hash,
    transactionIndex: 0,
    logIndex: 2,
    removed: false,
    topics,
  };
  item.receipt.logs = [log];
  process.env.MONAD_SCAN_TARGETS = JSON.stringify([
    {
      chainId: 143,
      address: protocol,
      topic0: topics[0],
      walletTopicIndex: 1,
      startBlock: 97,
      name: "Reviewed protocol interaction",
    },
  ]);
  let requests = 0;
  (f.mainnet.client as any).request = async ({ method, params }: any) => {
    requests++;
    assert.equal(method, "eth_getLogs");
    assert.equal(params[0].address, protocol);
    assert.deepEqual(params[0].topics, [topics[0], topics[1]]);
    assert.equal(params[0].fromBlock, "0x61");
    assert.equal(params[0].toBlock, "0x61");
    return [
      { ...log, blockNumber: "0x61", logIndex: "0x2" },
      {
        ...log,
        transactionHash: hash(92),
        blockNumber: "0x61",
        logIndex: "0x3",
        topics: [topics[0], topics[2], topics[1], topics[3]],
      },
    ];
  };
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/scans",
    headers: { cookie: signed.cookie },
    payload: { profileId: profile.id },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(requests, 1);
  assert.equal(response.json().item.coverage.mode, "configured_events");
  assert.equal(response.json().item.events.length, 1);
  assert.equal(response.json().claims.length, 1);
  assert.equal(f.db.rows("claims").length, 1);
  assert.equal(f.db.rows("xp_ledger").length, 0);
});

test("public demo metadata supplies deterministic initial artwork without registering any state", async (t) => {
  const f = await fixture(t);
  let queriedAddress: string | undefined;
  const read = f.demo.client.readContract;
  (f.demo.client as any).readContract = async (args: any) => {
    queriedAddress = args.address;
    return read(args);
  };
  const response = await f.app.inject({
    method: "GET",
    url: `/v1/metadata/demo/1?chainId=143&collectionAddress=${original}`,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["content-type"]), /application\/json/);
  assert.equal(
    response.headers["cache-control"],
    "public, max-age=30, must-revalidate",
  );
  const metadata = response.json();
  assert.equal(metadata.name, "Chogins Demo #1");
  assert.match(metadata.description, /demo NFT on Monad Testnet/);
  assert.match(metadata.image, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decodeURIComponent(metadata.image.split(",")[1]), /HATCHLING/);
  const attributes = Object.fromEntries(
    metadata.attributes.map((item: any) => [item.trait_type, item.value]),
  );
  assert.equal(attributes.Stage, "hatchling");
  assert.equal(attributes.XP, 0);
  assert.equal(attributes.Level, 1);
  assert.equal(metadata.external_url, "https://chog.example/mint");
  assert.equal(queriedAddress, collection);
  assert.ok(f.factories.every((chainId) => chainId === 10143));
  const again = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.deepEqual(again.json(), metadata);
  for (const name of [
    "wallets",
    "wallet_auth_nonces",
    "nft_profiles",
    "claims",
    "evidence",
    "xp_ledger",
  ])
    assert.equal(
      f.db.rows(name).length,
      0,
      `${name} must not be created by public metadata reads`,
    );
  assert.equal(f.demo.state.simulations, 0);
});

test("demo metadata uses finalized profile progression and published artwork while isolating original NFTs", async (t) => {
  const f = await fixture(t);
  const profile = await new MongoProfileRepository(f.db.db).register(
    randomUUID(),
    {
      mode: "demo",
      chainId: 10143,
      collectionAddress: collection,
      tokenId: "1",
    },
  );
  const row = f.db.rows("nft_profiles").find((item) => item._id === profile.id);
  Object.assign(row, {
    xp: 175,
    level: 3,
    stage: "explorer",
    version: 3,
    traits: ["trail-scarf"],
  });
  const official = {
    _id: randomUUID(),
    mode: "original_companion",
    chain_id: 143,
    collection_address: original.toLowerCase(),
    token_id: "1",
    xp: 900,
    stage: "legend",
    artwork_url: "https://official.example/original.png",
    display_name: "Original Chog",
  };
  await f.db.collection("nft_profiles").insertOne(official);
  const before = structuredClone(f.db.rows("nft_profiles"));
  const response = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.equal(response.statusCode, 200, response.body);
  const metadata = response.json();
  const attributes = Object.fromEntries(
    metadata.attributes.map((item: any) => [item.trait_type, item.value]),
  );
  assert.equal(attributes.Stage, "explorer");
  assert.equal(attributes.XP, 175);
  assert.equal(attributes.Level, 3);
  assert.equal(attributes["Evolution version"], 3);
  assert.equal(attributes["Unlocked trait"], "trail-scarf");
  assert.match(decodeURIComponent(metadata.image.split(",")[1]), /EXPLORER/);
  assert.equal(
    metadata.external_url,
    `https://chog.example/passport/${profile.id}`,
  );
  assert.deepEqual(f.db.rows("nft_profiles"), before);

  row.artwork_url = "/v1/artifacts/0123456789abcdef01234567";
  const published = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.equal(
    published.json().image,
    "https://chog.example/api/v1/artifacts/0123456789abcdef01234567",
  );
  row.artwork_url = "/api/v1/artifacts/abcdef0123456789abcdef01";
  const current = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.equal(
    current.json().image,
    "https://chog.example/api/v1/artifacts/abcdef0123456789abcdef01",
  );
  assert.deepEqual(
    f.db.rows("nft_profiles").find((item) => item._id === official._id),
    official,
  );
});

test("demo metadata rejects noncanonical IDs and unminted or zero-owner tokens", async (t) => {
  const f = await fixture(t);
  for (const tokenId of [
    "01",
    "-1",
    "1.0",
    "1e1",
    "0x1",
    " 1",
    (2n ** 256n).toString(),
  ]) {
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/metadata/demo/${encodeURIComponent(tokenId)}`,
    });
    assert.equal(response.statusCode, 400, `${tokenId}: ${response.body}`);
    assert.equal(response.json().error, "invalid_token_id");
  }
  assert.equal(f.demo.state.ownerCalls, 0);
  for (const tokenId of ["0", "2"]) {
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/metadata/demo/${tokenId}`,
    });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "demo_token_not_found");
  }
  f.demo.state.next = 1n;
  const noMint = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.equal(noMint.statusCode, 404);
  assert.equal(noMint.json().error, "demo_token_not_found");
  f.demo.state.next = 2n;
  f.demo.state.owner = zeroAddress;
  assert.equal(
    (await f.app.inject({ method: "GET", url: "/v1/metadata/demo/1" }))
      .statusCode,
    404,
  );
  assert.equal(f.db.rows("nft_profiles").length, 0);
});

test("demo metadata fails on a mismatched RPC chain or missing configured collection", async (t) => {
  const f = await fixture(t);
  f.demo.state.chainId = 143;
  const wrongChain = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.equal(wrongChain.statusCode, 503);
  assert.equal(wrongChain.json().error, "rpc_chain_mismatch");
  assert.equal(f.demo.state.ownerCalls, 0);
  process.env.DEMO_COLLECTION_ADDRESS = "";
  const unconfigured = await f.app.inject({
    method: "GET",
    url: "/v1/metadata/demo/1",
  });
  assert.equal(unconfigured.statusCode, 503);
  assert.equal(unconfigured.json().error, "demo_metadata_unconfigured");
  assert.equal(f.db.rows("nft_profiles").length, 0);
});
