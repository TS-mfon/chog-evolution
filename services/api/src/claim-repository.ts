import { createHash, randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { createPublicClient, defineChain, http, parseAbi, parseEventLogs } from "viem";

export type ClaimSubmission = { profileId: string; questId: string; walletId: string; walletAddress: `0x${string}`; idempotencyKey: string; transactionHash?: `0x${string}` };
const digest = (value: string) => `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
export class MongoClaimRepository {
  constructor(private readonly db: Db) {}

  async listActiveQuests() {
    const quests = await this.db.collection<any>("quests").find({ status: "active" }).sort({ name: 1 }).toArray();
    const out = [];
    for (const q of quests) {
      const policy = await this.db.collection<any>("quest_policies").find({ quest_id: q._id }).sort({ version: -1 }).limit(1).next();
      if (!policy || policy.source_checked_at < new Date(Date.now() - 30 * 86400_000)) continue;
      if (policy.starts_at && policy.starts_at > new Date() || policy.ends_at && policy.ends_at < new Date()) continue;
      out.push({ id: q._id, slug: q.slug, name: q.name, description: q.description, policyVersion: policy.version, sourceUrl: policy.source_url, xpReward: policy.xp_reward, startsAt: policy.starts_at, endsAt: policy.ends_at, verificationMethod: policy.policy.verificationMethod, allowedEvidenceHosts: policy.policy.allowedEvidenceHosts, kind: policy.policy.kind });
    }
    return out;
  }

  async getProfileForWallet(profileId: string, walletId: string) {
    const p = await this.db.collection<any>("nft_profiles").findOne({ _id: profileId, owner_wallet_id: walletId });
    const w = p && await this.db.collection<any>("wallets").findOne({ _id: walletId });
    return p && w ? { id: p._id, mode: p.mode, chain_id: p.chain_id, collection_address: p.collection_address, token_id: p.token_id, wallet_address: w.address } : null;
  }

  async createOrGet(input: ClaimSubmission) {
    const claims = this.db.collection<any>("claims");
    const now = new Date();
    const profile = await this.getProfileForWallet(input.profileId, input.walletId);
    if (!profile) return { kind: "quest_unavailable" as const };
    const quest = await this.db.collection<any>("quests").findOne({ _id: input.questId, status: "active" });
    const policy = quest && await this.db.collection<any>("quest_policies").find({ quest_id: quest._id }).sort({ version: -1 }).limit(1).next();
    if (!policy || policy.source_checked_at < new Date(Date.now() - 30 * 86400_000) || policy.starts_at && policy.starts_at > now || policy.ends_at && policy.ends_at < now) return { kind: "quest_unavailable" as const };
    let evidenceText: string;
    if (policy.policy.kind === "bio_link") {
      const link = await this.db.collection<any>("x_profile_links").findOne({ wallet_id: input.walletId });
      if (!link?.verified_at || !link.provider_user_id) return { kind: "evidence_unverified" as const };
      evidenceText = JSON.stringify({ schema: "chog-evidence-v1", kind: "bio_link", wallet: profile.wallet_address.toLowerCase(), provider: "x", provider_user_id: link.provider_user_id, username: link.username, verified_at: new Date(link.verified_at).toISOString(), policy_id: policy._id, policy_version: policy.version });
    } else if (policy.policy.kind === "demo_mint") {
      if (!input.transactionHash) return { kind: "evidence_unverified" as const };
      const expectedAddress = process.env.DEMO_COLLECTION_ADDRESS?.toLowerCase();
      const rpcUrl = process.env.MONAD_TESTNET_RPC_URL;
      if (!profile || profile.mode !== "demo" || Number(profile.chain_id) !== Number(process.env.MONAD_TESTNET_CHAIN_ID ?? 10143) || !expectedAddress || profile.collection_address.toLowerCase() !== expectedAddress || !rpcUrl) return { kind: "quest_unavailable" as const };
      const chainId = Number(process.env.MONAD_TESTNET_CHAIN_ID ?? 10143);
      const client = createPublicClient({ chain: defineChain({ id: chainId, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } }), transport: http(rpcUrl, { timeout: 12_000, retryCount: 1 }) });
      const receipt = await client.getTransactionReceipt({ hash: input.transactionHash });
      const tx = await client.getTransaction({ hash: input.transactionHash });
      if (receipt.status !== "success" || tx.to?.toLowerCase() !== expectedAddress) return { kind: "evidence_unverified" as const };
      const events = parseEventLogs({ abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]), logs: receipt.logs.filter((log) => log.address.toLowerCase() === expectedAddress), strict: true });
      const minted = events.find((event) => event.eventName === "Transfer" && event.args.from.toLowerCase() === "0x0000000000000000000000000000000000000000" && event.args.to.toLowerCase() === input.walletAddress.toLowerCase());
      if (!minted) return { kind: "evidence_unverified" as const };
      const owner = await client.readContract({ address: expectedAddress as `0x${string}`, abi: parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]), functionName: "ownerOf", args: [minted.args.tokenId] });
      if (owner.toLowerCase() !== input.walletAddress.toLowerCase()) return { kind: "evidence_unverified" as const };
      if (input.walletAddress.toLowerCase() !== profile.wallet_address.toLowerCase()) return { kind: "evidence_unverified" as const };
      evidenceText = JSON.stringify({ schema: "chog-evidence-v1", kind: "demo_mint", chain_id: chainId, collection_address: expectedAddress, wallet: input.walletAddress.toLowerCase(), transaction_hash: receipt.transactionHash, block_number: receipt.blockNumber.toString(), token_id: minted.args.tokenId.toString(), receipt_status: receipt.status, event: "Transfer(zero,wallet,tokenId)", verified_at: now.toISOString(), policy_id: policy._id, policy_version: policy.version });
    } else return { kind: "evidence_unverified" as const };
    const contentHash = digest(evidenceText);
    const requestHash = digest(JSON.stringify({ profileId: input.profileId, questId: input.questId, contentHash }));
    const evidenceKey = contentHash;
    const old = await claims.findOne({ $or: [{ idempotency_key: input.idempotencyKey }, { profile_id: input.profileId, quest_id: input.questId, evidence_key: evidenceKey }, { wallet_id: input.walletId, quest_id: input.questId }] });
    if (old) {
      if (old.idempotency_key === input.idempotencyKey && old.request_hash !== requestHash) return { kind: "idempotency_conflict" as const };
      return { kind: "claim" as const, duplicate: true, item: { id: old._id, status: old.status, decisionReference: old.genlayer_tx_id ?? null, createdAt: old.created_at.toISOString(), evidenceHash: old.evidence_key } };
    }
    const claimId = randomUUID();
    const origin = process.env.APP_ORIGIN;
    if (!origin) return { kind: "evidence_unverified" as const };
    const evidenceUrl = new URL(`/v1/evidence/${claimId}`, origin);
    if (evidenceUrl.protocol !== "https:" && process.env.NODE_ENV === "production") return { kind: "evidence_unverified" as const };
    if (!policy.policy.allowedEvidenceHosts.includes(evidenceUrl.hostname)) return { kind: "evidence_host_not_allowed" as const };
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        const conflict = await claims.findOne({ $or: [{ idempotency_key: input.idempotencyKey }, { profile_id: input.profileId, quest_id: input.questId, evidence_key: evidenceKey }, { wallet_id: input.walletId, quest_id: input.questId }] }, { session });
        if (conflict) throw new Error("duplicate_claim");
        await claims.insertOne({ _id: claimId, profile_id: input.profileId, quest_id: input.questId, policy_id: policy._id, wallet_id: input.walletId, evidence_key: evidenceKey, status: "submitted", idempotency_key: input.idempotencyKey, request_hash: requestHash, attempt_count: 0, failure_count: 0, genlayer_tx_id: null, lease_token: null, lease_until: null, created_at: now, updated_at: now }, { session });
        await this.db.collection<any>("evidence").insertOne({ _id: randomUUID(), claim_id: claimId, kind: policy.policy.kind, source_url: evidenceUrl.toString(), content_hash: evidenceKey, captured_at: now, payload: { text: evidenceText } }, { session });
        await this.db.collection<any>("audit_events").insertOne({ _id: randomUUID(), actor_wallet_id: input.walletId, entity_type: "claim", entity_id: claimId, action: "submitted", details: { content_hash: evidenceKey }, created_at: now }, { session });
      });
      return { kind: "claim" as const, duplicate: false, item: { id: claimId, status: "submitted", decisionReference: null, createdAt: now.toISOString(), evidenceHash: evidenceKey } };
    } catch (error) {
      if ((error as { code?: number }).code === 11000 || error instanceof Error && error.message === "duplicate_claim") {
        const duplicate = await claims.findOne({ $or: [{ idempotency_key: input.idempotencyKey }, { profile_id: input.profileId, quest_id: input.questId, evidence_key: evidenceKey }, { wallet_id: input.walletId, quest_id: input.questId }] });
        if (!duplicate) throw error;
        if (duplicate.idempotency_key === input.idempotencyKey && duplicate.request_hash !== requestHash) return { kind: "idempotency_conflict" as const };
        return { kind: "claim" as const, duplicate: true, item: { id: duplicate._id, status: duplicate.status, decisionReference: duplicate.genlayer_tx_id ?? null, createdAt: duplicate.created_at.toISOString(), evidenceHash: evidenceKey } };
      }
      throw error;
    } finally { await session.endSession(); }
  }

  async getPublicEvidence(claimId: string): Promise<string | null> {
    const evidence = await this.db.collection<any>("evidence").findOne({ claim_id: claimId });
    const text = evidence?.payload?.text;
    if (!text || typeof text !== "string" || evidence.content_hash !== digest(text)) return null;
    return text;
  }

  async getForWallet(id: string, walletId: string) {
    const claim = await this.db.collection<any>("claims").findOne({ _id: id, wallet_id: walletId });
    if (!claim) return null;
    const [quest, decision, evidence] = await Promise.all([
      this.db.collection<any>("quests").findOne({ _id: claim.quest_id }),
      this.db.collection<any>("decisions").findOne({ claim_id: id }),
      this.db.collection<any>("evidence").findOne({ claim_id: id }),
    ]);
    return { id, status: claim.status, decisionReference: claim.genlayer_tx_id ?? null, createdAt: claim.created_at.toISOString(), outcome: decision?.outcome ?? null, reasonCode: decision?.reason_code ?? null, explanation: decision?.explanation ?? null, xpAward: decision?.xp_award ?? 0, finalized: decision?.finalized ?? false, evidenceHash: evidence?.content_hash, evidenceUrl: evidence?.source_url, questSlug: quest?.slug };
  }

  async listForWallet(walletId: string) {
    const claims = await this.db.collection<any>("claims").find({ wallet_id: walletId }).sort({ created_at: -1 }).limit(100).toArray();
    return Promise.all(claims.map(async (c) => await this.getForWallet(c._id, walletId)));
  }
}
