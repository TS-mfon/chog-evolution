import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient, type Db } from "mongodb";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { hexToString, type Hex } from "viem";

// Real HTTP handlers, Mongo transactions and GridFS; only wallets and external
// providers are controlled. No application API response is supplied by a fixture.
const root = resolve(import.meta.dirname, "..");
const reportDir = resolve(root, "artifacts/browser-persistence");
const uri = process.env.MONGODB_TEST_URI;
if (!uri || !/^mongodb(?:\+srv)?:\/\//i.test(uri))
  throw new Error(
    "MONGODB_TEST_URI is required for isolated browser persistence acceptance",
  );
const databaseName = `chog_test_${randomBytes(12).toString("hex")}`;
const runId = randomUUID();
const suite = "chog-browser-persistence-v3";
const ownerCollection = "_integration_owner";
const port = Number(process.env.CHOG_BROWSER_PERSISTENCE_PORT ?? 3032);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const base = `http://127.0.0.1:${port}`;
const publicBase = "https://chog-browser.example/api";
// These are disposable deterministic test identities, never funded or broadcast.
const account = privateKeyToAccount(`0x${"31".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"32".repeat(32)}`);
const collection = `0x${"41".repeat(20)}` as const;
const originalCollection = `0x${"42".repeat(20)}` as const;
for (const key of Object.keys(process.env)) {
  if (/PRIVATE_KEY|API_KEY|BEARER_TOKEN|SECRET/.test(key))
    delete process.env[key];
}
Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URI: "",
  MONGODB_DATABASE: databaseName,
  APP_ORIGIN: "https://chog-browser.example",
  WEB_ORIGIN: base,
  PUBLIC_API_URL: publicBase,
  PUBLIC_API_PATH: "/api",
  X_SOURCE_MODE: "public_page",
  ENABLE_LOCAL_DEMO_SCENARIOS: "false",
  DEMO_COLLECTION_ADDRESS: collection,
  MONAD_TESTNET_CHAIN_ID: "10143",
  MONAD_TESTNET_RPC_URL: "https://rpc.invalid",
  ORIGINAL_CHOG_COLLECTION_ADDRESS: originalCollection,
  MONAD_MAINNET_CHAIN_ID: "143",
  MONAD_MAINNET_RPC_URL: "https://rpc.invalid",
  GENLAYER_CONTRACT_ADDRESS: collection,
});
const [
  { buildApp },
  { ensureIndexes },
  { MongoProfileRepository },
  { processOne },
  { processOneArtwork },
] = await Promise.all([
  import("../services/api/src/index.js"),
  import("../services/api/src/mongo.js"),
  import("../services/api/src/profile-repository.js"),
  import("../services/evolution-worker/src/index.js"),
  import("../services/evolution-worker/src/artwork.js"),
]);
const factory: any = (configuration: any) => ({
  getChainId: async () => configuration.chainId,
  readContract: async ({ functionName, args }: any) => {
    if (functionName === "ownerOf") {
      if (args[0] === 1n) return account.address;
      if (args[0] === 2n) return otherAccount.address;
      throw new Error("ERC721NonexistentToken");
    }
    if (functionName === "balanceOf") return 1n;
    if (functionName === "supportsInterface") return false;
    if (functionName === "nextTokenId") return 3n;
    if (functionName === "maxSupply") return 1000n;
    if (functionName === "name") return "Controlled test collection";
    if (functionName === "symbol") return "TEST";
    throw new Error(`Unexpected controlled RPC method: ${functionName}`);
  },
});
let sourceReads = 0;
const sourceRequest: typeof fetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(
    url.hostname,
    "api.github.com",
    "only the controlled source provider may be contacted",
  );
  assert.ok(url.pathname.startsWith("/repos/browser/monad-guide"));
  sourceReads++;
  return Response.json(
    url.pathname.includes("/git/ref/")
      ? { object: { type: "commit", sha: "1".repeat(40) } }
      : url.pathname.endsWith("/readme")
        ? {
            encoding: "base64",
            sha: "2".repeat(40),
            path: "README.md",
            content: Buffer.from(
              `A Monad and Chog integration guide.\nWallet ${account.address}\nPersist this exact source text across refresh.`,
            ).toString("base64"),
          }
        : {
            id: 731,
            private: false,
            full_name: "browser/monad-guide",
            default_branch: "main",
            fork: false,
            description: "A public Monad guide",
          },
  );
};
let client: MongoClient;
let db: Db;
let app: ReturnType<typeof buildApp> | undefined;
let apiBase = "";
let server: ChildProcess | undefined;
let serverOutput = "";
let browser: Browser | undefined;
let page: Page | undefined;
let owned = false;
let shuttingDown = false;
let failure: unknown;
let summary: any;
const pageErrors: string[] = [];
const apiRequests: { method: string; path: string; status: number }[] = [];
const makeClient = () =>
  new MongoClient(uri, {
    appName: "chog-isolated-browser-acceptance",
    maxPoolSize: 8,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });
async function startApi() {
  app = buildApp(undefined, {
    database: db,
    factory,
    request: sourceRequest,
    logger: false,
  });
  apiBase = await app.listen({ host: "127.0.0.1", port: 0 });
}
async function waitUntil(
  predicate: () => Promise<unknown>,
  message: string,
  timeout = 30000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
}
async function relay(context: BrowserContext) {
  await context.route(
    (url) =>
      (url.origin === base || url.origin === "https://chog-browser.example") &&
      url.pathname.startsWith("/api/"),
    async (route) => {
      try {
        const url = new URL(route.request().url());
        const path = url.pathname.slice(4) + url.search;
        const response = await route.fetch({
          url: apiBase + path,
          maxRetries: 0,
          timeout: 30000,
        });
        apiRequests.push({
          method: route.request().method(),
          path,
          status: response.status(),
        });
        await route.fulfill({ response });
      } catch {
        if (!shuttingDown) pageErrors.push("Real API relay request failed");
        await route.abort("failed").catch(() => {});
      }
    },
  );
}
async function instrumentWallet(context: BrowserContext) {
  await context.exposeFunction(
    "signTestChallenge",
    async (message: string, address: string) => {
      const signer =
        address.toLowerCase() === account.address.toLowerCase()
          ? account
          : otherAccount;
      assert.equal(address.toLowerCase(), signer.address.toLowerCase());
      return signer.signMessage({
        message: message.startsWith("0x")
          ? hexToString(message as Hex)
          : message,
      });
    },
  );
  await context.addInitScript({
    content: `(function(wallet){
    const local=window;
    const listeners={};
    const selected=()=>localStorage.getItem("acceptance:wallet")||wallet;
    local.testSwitchWallet=(next)=>{
      localStorage.setItem("acceptance:wallet",next);
      for(const listener of listeners.accountsChanged??[])listener([next]);
    };
    local.ethereum={
      on(event,fn){(listeners[event]??=[]).push(fn);},
      removeListener(event,fn){listeners[event]=(listeners[event]??[]).filter(item=>item!==fn);},
      async request({method,params}){
        if(method==="eth_accounts")return localStorage.getItem("acceptance:connected")?[selected()]:[];
        if(method==="eth_requestAccounts"){localStorage.setItem("acceptance:connected","true");return [selected()];}
        if(method==="eth_chainId")return "0x279f";
        if(method==="wallet_switchEthereumChain"||method==="wallet_addEthereumChain")return null;
        if(method==="personal_sign")return local.signTestChallenge(params[0],params[1]);
        throw new Error('Unexpected wallet method; no transaction can be broadcast: '+method);
      },
    };
  })(${JSON.stringify(account.address)});`,
  });
}
try {
  await mkdir(reportDir, { recursive: true });
  client = makeClient();
  await client.connect();
  db = client.db(databaseName);
  const hello = await db.command({ hello: 1 });
  assert.ok(
    hello.setName && hello.logicalSessionTimeoutMinutes,
    "a transaction-capable replica set is required",
  );
  assert.equal(
    (await db.listCollections({}, { nameOnly: true }).toArray()).length,
    0,
    "test database collision",
  );
  await db
    .collection<any>(ownerCollection)
    .insertOne({
      _id: "owner",
      suite,
      database: databaseName,
      run_id: runId,
      created_at: new Date(),
    });
  owned = true;
  await writeFile(
    resolve(reportDir, "owned-db.json"),
    JSON.stringify({ databaseName, runId, suite }),
    { mode: 0o600 },
  );
  await ensureIndexes(db);
  const walletId = randomUUID(),
    otherWalletId = randomUUID();
  await db.collection<any>("wallets").insertMany([
    {
      _id: walletId,
      address: account.address.toLowerCase(),
      created_at: new Date(),
    },
    {
      _id: otherWalletId,
      address: otherAccount.address.toLowerCase(),
      created_at: new Date(),
    },
  ]);
  const profiles = new MongoProfileRepository(db);
  const profile = await profiles.register(walletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "1",
  });
  const otherProfile = await profiles.register(otherWalletId, {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "2",
  });
  // The starting 100 XP is an explicit persisted setup state. Every later change
  // is produced through the actual API/worker transaction paths.
  await db
    .collection<any>("nft_profiles")
    .updateOne(
      { _id: profile.id },
      {
        $set: {
          xp: 100,
          level: 2,
          stage: "curious",
          earned_trait_ids: ["bright-eyes"],
        },
      },
    );
  await startApi();
  const nextEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    MONGODB_URI: "",
    MONGODB_TEST_URI: "",
    PUBLIC_API_URL: "",
    APP_ORIGIN: base,
    WEB_ORIGIN: base,
  };
  server = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/next/dist/bin/next"),
      "start",
      "apps/web",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, env: nextEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [server.stdout, server.stderr])
    stream?.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-16000);
    });
  await waitUntil(async () => {
    if (server!.exitCode !== null)
      throw new Error("Next acceptance server stopped");
    try {
      return (
        await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) })
      ).ok;
    } catch {
      return false;
    }
  }, "Next acceptance server did not become ready");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHOG_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHOG_CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await relay(context);
  await instrumentWallet(context);
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(base + "/upgrade", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByLabel("Your contribution link").waitFor();
  await waitUntil(
    async () =>
      (await db
        .collection("wallet_sessions")
        .countDocuments({ wallet_id: walletId })) === 1,
    "real signed wallet session was not persisted",
  );
  await page
    .getByLabel("Your contribution link")
    .fill("https://github.com/browser/monad-guide");
  await page
    .getByLabel("A little context")
    .fill("A durable contribution draft.");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.getByLabel("A little context").inputValue(),
    "A durable contribution draft.",
  );
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/evidence/previews") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Preview contribution", exact: true })
    .click();
  const preview = (await (await previewResponse).json()).item;
  assert.equal(preview.status, "ready");
  assert.equal(preview.eligibility.rewardXp, 75);
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".source-text").innerText(),
    /Persist this exact source text/,
  );
  assert.equal(
    await db
      .collection("evidence_previews")
      .countDocuments({ wallet_id: walletId }),
    1,
  );
  const sourceReadsAtPreview = sourceReads;
  await page.screenshot({
    path: resolve(reportDir, "desktop-persisted-preview.png"),
    fullPage: true,
  });
  const submissionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/upgrades/evidence") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  const submitted = await (await submissionResponse).json();
  assert.equal(submitted.item.status, "submitted");
  const claimId = submitted.item.id;
  assert.equal(
    sourceReads,
    sourceReadsAtPreview,
    "submission must consume the saved source without refetching it",
  );
  assert.equal(
    (await db
      .collection<any>("evidence_previews")
      .findOne({ _id: preview.id }))!.claim_id,
    claimId,
  );
  assert.equal(await db.collection("xp_ledger").countDocuments({}), 0);
  await page.goto(base + `/claims/${claimId}`, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Review timeline", exact: true })
    .waitFor();
  let broadcasts = 0;
  let finalized = false;
  let decision: any;
  const adjudicator: any = {
    async submit(args: any[]) {
      broadcasts++;
      const evidenceResponse = await fetch(
        apiBase + new URL(String(args[6])).pathname.slice(4),
      );
      assert.ok(evidenceResponse.ok);
      assert.equal(await evidenceResponse.text(), args[7]);
      decision = {
        claim_id: args[0],
        claimant: args[1],
        profile_identity: args[2],
        policy_version: args[3],
        quest_id: args[4],
        evidence_hash: args[8],
        xp: args[9],
        outcome: "accepted",
        reason: "Controlled external adjudicator accepted the bound evidence.",
      };
      return `0x${"61".repeat(32)}`;
    },
    async poll() {
      return finalized ? "finalized" : "pending";
    },
    async readDecision() {
      return decision;
    },
  };
  assert.equal(await processOne(db, adjudicator, { factory }), true);
  assert.equal(
    (await db.collection<any>("claims").findOne({ _id: claimId }))!.status,
    "awaiting_genlayer",
  );
  await db
    .collection<any>("claims")
    .updateOne({ _id: claimId }, { $set: { next_attempt_at: null } });
  assert.equal(await processOne(db, adjudicator, { factory }), true);
  assert.equal(
    await db.collection("xp_ledger").countDocuments({}),
    0,
    "pending consensus cannot grant XP",
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.ok((await page.locator(".review-timeline > li").count()) >= 2);
  finalized = true;
  await db
    .collection<any>("claims")
    .updateOne({ _id: claimId }, { $set: { next_attempt_at: null } });
  assert.equal(await processOne(db, adjudicator, { factory }), true);
  assert.equal(await processOne(db, adjudicator, { factory }), false);
  assert.equal(broadcasts, 1);
  assert.equal(
    await db.collection("xp_ledger").countDocuments({ claim_id: claimId }),
    1,
  );
  assert.equal(
    (await db.collection<any>("xp_ledger").findOne({ claim_id: claimId }))!
      .amount,
    75,
  );
  assert.equal(await processOneArtwork(db), true);
  const afterReward = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: profile.id });
  assert.equal(afterReward!.xp, 175);
  assert.deepEqual(afterReward!.equipped_trait_ids, []);
  assert.ok(afterReward!.earned_trait_ids.includes("trail-scarf"));
  assert.equal(afterReward!.artwork_version, 1);
  await page.goto(base + "/profile", { waitUntil: "networkidle" });
  await page.getByRole("progressbar").waitFor();
  assert.match(
    await page.locator(".progress-heading strong").innerText(),
    /175\s*XP/,
  );
  await page.getByRole("radio", { name: /Trail scarf/ }).check();
  await page.getByRole("button", { name: "Save my look", exact: true }).click();
  await page.getByText(/Your new look is saved/).waitFor();
  assert.equal(await processOneArtwork(db), true);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.getByRole("radio", { name: /Trail scarf/ }).isChecked(),
    true,
  );
  await page.getByRole("radio", { name: /No accessory/ }).check();
  await page.getByRole("button", { name: "Save my look", exact: true }).click();
  await page.getByText(/Your new look is saved/).waitFor();
  assert.equal(await processOneArtwork(db), true);
  assert.equal(
    await db.collection("xp_ledger").countDocuments({}),
    1,
    "cosmetic changes cannot grant XP",
  );
  assert.equal(
    await db
      .collection("evolution_history")
      .countDocuments({ profile_id: profile.id }),
    3,
  );
  assert.equal(
    await db.collection("artifacts").countDocuments({ profile_id: profile.id }),
    3,
  );
  const persistedVersion = await db
    .collection<any>("nft_profiles")
    .findOne({ _id: profile.id });
  assert.equal(persistedVersion!.version, 3);
  assert.equal(persistedVersion!.xp, 175);
  assert.deepEqual(persistedVersion!.equipped_trait_ids, []);
  // Tear down every API repository and its Mongo connection; the next HTTP app
  // has no in-memory session, claim, profile or artwork state to reuse.
  await page.goto("about:blank");
  await app!.close();
  app = undefined;
  await client.close();
  client = makeClient();
  await client.connect();
  db = client.db(databaseName);
  await startApi();
  await page.goto(base + "/evolution", { waitUntil: "networkidle" });
  await page.locator(".history-comparison").first().waitFor();
  assert.equal(await page.locator(".history-comparison").count(), 3);
  const historyImages = await page
    .locator(".history-snapshot img")
    .evaluateAll((images) =>
      images.map((img) => (img as HTMLImageElement).src),
    );
  assert.ok(
    historyImages.length >= 5,
    "history must show recorded before and after images",
  );
  for (const url of new Set(historyImages)) {
    if (url.startsWith("data:")) continue;
    const response = await context.request.get(
      apiBase + new URL(url).pathname.slice(4),
    );
    assert.equal(
      response.status(),
      200,
      "recorded GridFS artwork remains retrievable after reconnect",
    );
  }
  await page.screenshot({
    path: resolve(reportDir, "desktop-persisted-history.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(reportDir, "mobile-persisted-history.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + "/upgrade", { waitUntil: "networkidle" });
  await page.evaluate(
    (address) => (window as any).testSwitchWallet(address),
    otherAccount.address,
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByLabel("Your contribution link").waitFor();
  assert.equal(
    await page.getByLabel("Your contribution link").inputValue(),
    "",
    "another account must not inherit a contribution draft",
  );
  const otherOwned = await page.evaluate(
    async () => await (await fetch("/api/v1/profiles")).json(),
  );
  assert.deepEqual(
    otherOwned.items.map((item: any) => item.id),
    [otherProfile.id],
  );
  const foreignPreview = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/evidence/previews/${id}`);
    return response.status;
  }, preview.id);
  assert.equal(foreignPreview, 404);
  const foreignMutation = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/profiles/${id}/traits`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "foreign-wallet",
      },
      body: JSON.stringify({
        expectedVersion: 3,
        equippedTraitIds: ["trail-scarf"],
      }),
    });
    return response.status;
  }, profile.id);
  assert.equal(foreignMutation, 403);
  const publicContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await relay(publicContext);
  const publicPage = await publicContext.newPage();
  publicPage.on("pageerror", (error) => pageErrors.push(error.message));
  await publicPage.goto(base + `/claims/${claimId}`, {
    waitUntil: "networkidle",
  });
  await publicPage
    .getByRole("heading", { name: "Review timeline", exact: true })
    .waitFor();
  assert.match(
    await publicPage.locator(".source-text").innerText(),
    /Persist this exact source text/,
  );
  assert.equal(
    await publicPage
      .getByRole("button", { name: "Retry this review", exact: true })
      .count(),
    0,
  );
  await publicPage.screenshot({
    path: resolve(reportDir, "mobile-public-finalized-claim.png"),
    fullPage: true,
  });
  assert.deepEqual(pageErrors, []);
  assert.equal(
    apiRequests.filter((item) => item.status >= 500).length,
    0,
    "real API requests must not produce server failures",
  );
  summary = {
    suite,
    api: "actual Fastify HTTP",
    storage: "isolated Mongo replica set and GridFS",
    externalProviders: "controlled",
    liveProviderProof: false,
    initialSeedXp: 100,
    awardedXp: 75,
    finalXp: 175,
    claims: 1,
    ledgerEntries: 1,
    historyEntries: 3,
    artifacts: 3,
    broadcasts,
    sourceReads,
    apiRequests: apiRequests.length,
    apiReconnected: true,
    accountIsolation: true,
  };
} catch (error) {
  failure = error;
  if (page)
    await page
      .screenshot({ path: resolve(reportDir, "failure.png"), fullPage: true })
      .catch(() => {});
} finally {
  shuttingDown = true;
  await browser?.close();
  await app?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveClose) =>
        server!.once("close", () => resolveClose()),
      ),
      delay(5000),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (owned && db!) {
    try {
      assert.match(db.databaseName, /^chog_test_[0-9a-f]{24}$/);
      assert.equal(db.databaseName, databaseName);
      const marker = await db
        .collection<any>(ownerCollection)
        .findOne({ _id: "owner" });
      assert.equal(marker?.suite, suite);
      assert.equal(marker?.database, databaseName);
      assert.equal(marker?.run_id, runId);
      assert.equal(await db.dropDatabase(), true);
      assert.equal(
        (await db.listCollections({}, { nameOnly: true }).toArray()).length,
        0,
      );
      if (summary) summary.cleanup = "verified";
    } catch {
      failure = new Error("Owned browser test database cleanup failed");
    }
  }
  await client!?.close();
  await writeFile(
    resolve(reportDir, "api-requests.json"),
    JSON.stringify(apiRequests, null, 2),
  );
  await writeFile(
    resolve(reportDir, "browser-errors.json"),
    JSON.stringify(pageErrors, null, 2),
  );
}
if (failure) {
  // Never emit driver errors containing Mongo credentials or signed messages.
  const message =
    failure instanceof Error
      ? failure.message
      : "Browser persistence acceptance failed";
  const safe = message
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[redacted]")
    .split(uri)
    .join("[redacted]");
  await writeFile(resolve(reportDir, "failure.txt"), safe);
  console.error("BROWSER PERSISTENCE FAILED: " + safe);
  process.exitCode = 1;
} else {
  await writeFile(
    resolve(reportDir, "report.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log("BROWSER PERSISTENCE VERIFIED " + JSON.stringify(summary));
}
