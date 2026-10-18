import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class MongoSocialRepository {
  constructor(private readonly db: Db) {}

  async createXChallenge(walletId: string) {
    const code = `CHOG-${randomBytes(8).toString("hex").toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await this.db.collection<any>("x_profile_link_challenges").updateOne({ wallet_id: walletId }, {
      $set: { code_hash: hash(code), expires_at: expiresAt, created_at: new Date() },
      $setOnInsert: { _id: randomUUID(), wallet_id: walletId },
    }, { upsert: true });
    return { bioCode: code, expiresAt: expiresAt.toISOString() };
  }

  async verifyXChallenge(walletId: string, username: string, providerUserId: string, bio: string) {
    const challenges = this.db.collection<any>("x_profile_link_challenges");
    const links = this.db.collection<any>("x_profile_links");
    const challenge = await challenges.findOne({ wallet_id: walletId, expires_at: { $gt: new Date() } });
    if (!challenge) return { kind: "challenge_missing_or_expired" as const };
    const bioCode = bio.match(/CHOG-[A-F0-9]{16}/i)?.[0]?.toUpperCase();
    const candidateHash = Buffer.from(hash(bioCode ?? ""), "hex");
    const expectedHash = Buffer.from(challenge.code_hash, "hex");
    if (candidateHash.length !== expectedHash.length || !timingSafeEqual(candidateHash, expectedHash)) return { kind: "bio_code_not_found" as const };
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        // Atomically consume the challenge so a retry/replay cannot bind the account twice.
        const consumed = await challenges.deleteOne({ _id: challenge._id, wallet_id: walletId, code_hash: challenge.code_hash, expires_at: { $gt: new Date() } }, { session });
        if (consumed.deletedCount !== 1) throw new Error("challenge_missing_or_expired");
        const existing = await links.findOne({ provider_user_id: providerUserId }, { session });
        if (existing && existing.wallet_id !== walletId) throw new Error("x_account_already_linked");
        const verifiedAt = new Date();
        await links.updateOne({ wallet_id: walletId }, { $set: { username, provider_user_id: providerUserId, verified_at: verifiedAt }, $setOnInsert: { _id: randomUUID(), wallet_id: walletId, created_at: verifiedAt } }, { upsert: true, session });
      });
      return { kind: "verified" as const, username, verifiedAt: new Date().toISOString() };
    } catch (error) {
      const code = (error as { code?: number }).code;
      const message = error instanceof Error ? error.message : "";
      if (message === "x_account_already_linked" || code === 11000) return { kind: "x_account_already_linked" as const };
      if (message === "challenge_missing_or_expired") return { kind: "challenge_missing_or_expired" as const };
      throw error;
    } finally { await session.endSession(); }
  }

  async getXLink(walletId: string) {
    const row = await this.db.collection<any>("x_profile_links").findOne({ wallet_id: walletId });
    return row ? { username: row.username, verifiedAt: new Date(row.verified_at).toISOString() } : null;
  }

  async unlinkX(walletId: string) {
    await this.db.collection("x_profile_links").deleteOne({ wallet_id: walletId });
    await this.db.collection("x_profile_link_challenges").deleteOne({ wallet_id: walletId });
  }
}
