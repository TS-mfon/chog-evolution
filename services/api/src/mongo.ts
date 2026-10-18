import { MongoClient, type Db, type Collection, type Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { createPublicClient, defineChain, http, parseAbi } from "viem";

let client: MongoClient | undefined;

export function getDatabase(): Db {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("mongodb_not_configured");
  client ??= new MongoClient(uri, {
    appName: "chog-evolution-api",
    maxPoolSize: 12,
  });
  return client.db(process.env.MONGODB_DATABASE || undefined);
}

export async function collection<T extends Document>(
  name: string,
): Promise<Collection<T>> {
  return getDatabase().collection<T>(name);
}

export async function connectDatabase(): Promise<Db> {
  await getDatabase().command({ ping: 1 });
  return getDatabase();
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
  client = undefined;
}

export async function ensureIndexes(): Promise<void> {
  const db = getDatabase();
  await Promise.all([
    db.collection("wallets").createIndex({ address: 1 }, { unique: true }),
    db
      .collection("wallet_auth_nonces")
      .createIndex({ nonce_hash: 1 }, { unique: true }),
    db
      .collection("wallet_auth_nonces")
      .createIndex({ expires_at: 1 }, { expireAfterSeconds: 86400 }),
    db
      .collection("wallet_sessions")
      .createIndex({ token_hash: 1 }, { unique: true }),
    db
      .collection("wallet_sessions")
      .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection("nft_profiles")
      .createIndex(
        { chain_id: 1, collection_address: 1, token_id: 1 },
        { unique: true },
      ),
    db
      .collection("nft_profiles")
      .createIndex({ owner_wallet_id: 1, created_at: 1 }),
    db
      .collection("x_profile_links")
      .createIndex({ provider_user_id: 1 }, { unique: true }),
    db
      .collection("x_profile_links")
      .createIndex({ wallet_id: 1 }, { unique: true }),
    db
      .collection("x_profile_link_challenges")
      .createIndex({ wallet_id: 1 }, { unique: true }),
    db.collection("quests").createIndex({ slug: 1 }, { unique: true }),
    db
      .collection("claims")
      .createIndex({ idempotency_key: 1 }, { unique: true }),
    db
      .collection("claims")
      .createIndex(
        { profile_id: 1, quest_id: 1, evidence_key: 1 },
        { unique: true },
      ),
    db
      .collection("claims")
      .createIndex({ wallet_id: 1, quest_id: 1 }, { unique: true }),
    db.collection("evidence").createIndex({ claim_id: 1 }, { unique: true }),
    db
      .collection("quest_policies")
      .createIndex({ quest_id: 1, version: 1 }, { unique: true }),
    db.collection("decisions").createIndex({ claim_id: 1 }, { unique: true }),
    db.collection("xp_ledger").createIndex({ claim_id: 1 }, { unique: true }),
    db
      .collection("evolution_jobs")
      .createIndex({ claim_id: 1 }, { unique: true }),
    db
      .collection("evolution_history")
      .createIndex({ claim_id: 1 }, { unique: true }),
    db.collection("artifacts").createIndex({ claim_id: 1 }, { unique: true }),
    db.collection("scan_jobs").createIndex({ profile_id: 1, updated_at: -1 }),
    db
      .collection("scan_jobs")
      .createIndex(
        { profile_id: 1 },
        { unique: true, partialFilterExpression: { status: "running" } },
      ),
    db
      .collection("scan_events")
      .createIndex(
        { profile_id: 1, chain_id: 1, tx_hash: 1, log_index: 1 },
        { unique: true },
      ),
    db
      .collection("scan_events")
      .createIndex({ scan_job_id: 1, block_number: -1, log_index: -1 }),
  ]);
  const quests = db.collection<any>("quests");
  const policies = db.collection<any>("quest_policies");
  const now = new Date();
  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:4000";
  const host = new URL(appOrigin).hostname;
  const seed = {
    slug: "verify-x-bio",
    name: "Verify your X bio",
    description:
      "Link your X profile with a one-time CHOG code, then submit the verified profile as a quest.",
    status: process.env.X_API_BEARER_TOKEN ? "active" : "inactive",
    source_url: "https://docs.x.com/x-api/users/lookup/introduction",
    created_at: now,
    updated_at: now,
  };
  await quests.updateOne(
    { slug: seed.slug },
    { $setOnInsert: { _id: randomUUID(), ...seed } },
    { upsert: true },
  );
  const quest = await quests.findOne({ slug: seed.slug });
  if (quest)
    await quests.updateOne(
      { _id: quest._id },
      {
        $set: {
          status: process.env.X_API_BEARER_TOKEN ? "active" : "inactive",
          updated_at: now,
        },
      },
    );
  if (quest) {
    const latest = await policies
      .find({ quest_id: quest._id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (
      !latest ||
      latest.xp_reward !== 50 ||
      latest.policy.kind !== "bio_link" ||
      !latest.policy.allowedEvidenceHosts?.includes(host)
    )
      await policies.insertOne({
        _id: randomUUID(),
        quest_id: quest._id,
        version: (latest?.version ?? 0) + 1,
        policy: {
          kind: "bio_link",
          rules:
            "Accept only a wallet-bound X account whose public bio contained the current one-time code when linked. The linked provider identity and timestamp are captured server-side; arbitrary user text is never evidence.",
          verificationMethod: "public_evidence",
          allowedEvidenceHosts: [host],
        },
        source_url: seed.source_url,
        source_checked_at: new Date("2026-10-18T00:00:00.000Z"),
        starts_at: null,
        ends_at: null,
        xp_reward: 50,
        created_at: now,
      });
  }
  const mintQuest = {
    slug: "demo-first-mint",
    name: "Mint your demo Chog",
    description:
      "Mint the configured Monad testnet DemoChog and submit the mint transaction. The API verifies the receipt, collection, zero-address mint event, and recipient wallet.",
    status: "inactive",
    source_url: "https://eips.ethereum.org/EIPS/eip-721",
    created_at: now,
    updated_at: now,
  };
  await quests.updateOne(
    { slug: mintQuest.slug },
    { $setOnInsert: { _id: randomUUID(), ...mintQuest } },
    { upsert: true },
  );
  const mintedQuest = await quests.findOne({ slug: mintQuest.slug });
  let verifiedDemoContract = false;
  const demoAddress = process.env.DEMO_COLLECTION_ADDRESS;
  const demoRpc = process.env.MONAD_TESTNET_RPC_URL;
  if (demoAddress && /^0x[0-9a-fA-F]{40}$/.test(demoAddress) && demoRpc) {
    try {
      const chainId = Number(process.env.MONAD_TESTNET_CHAIN_ID ?? 10143);
      const rpc = createPublicClient({
        chain: defineChain({
          id: chainId,
          name: "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: { default: { http: [demoRpc] } },
        }),
        transport: http(demoRpc, { timeout: 8000, retryCount: 0 }),
      });
      const [code, symbol, name] = await Promise.all([
        rpc.getBytecode({ address: demoAddress as `0x${string}` }),
        rpc.readContract({
          address: demoAddress as `0x${string}`,
          abi: parseAbi(["function symbol() view returns (string)"]),
          functionName: "symbol",
        }),
        rpc.readContract({
          address: demoAddress as `0x${string}`,
          abi: parseAbi(["function name() view returns (string)"]),
          functionName: "name",
        }),
      ]);
      verifiedDemoContract = Boolean(
        code &&
        code !== "0x" &&
        symbol === "DCHOG" &&
        name === "CHOG Evolution Demo",
      );
    } catch {
      verifiedDemoContract = false;
    }
  }
  if (mintedQuest)
    await quests.updateOne(
      { _id: mintedQuest._id },
      {
        $set: {
          status: verifiedDemoContract ? "active" : "inactive",
          updated_at: now,
        },
      },
    );
  if (mintedQuest && !(await policies.findOne({ quest_id: mintedQuest._id }))) {
    await policies.insertOne({
      _id: randomUUID(),
      quest_id: mintedQuest._id,
      version: 1,
      policy: {
        kind: "demo_mint",
        rules:
          "Accept only a finalized successful Monad testnet transaction to the configured DemoChog contract with an ERC-721 Transfer event from the zero address to the authenticated wallet; the server verifies the transaction and receipt, event token ID, and contract ownership. A mint transaction is evidence of minting only.",
        verificationMethod: "public_evidence",
        allowedEvidenceHosts: [host],
      },
      source_url: mintQuest.source_url,
      source_checked_at: new Date("2026-10-18T00:00:00.000Z"),
      starts_at: null,
      ends_at: null,
      xp_reward: 50,
      created_at: now,
    });
  }
}
