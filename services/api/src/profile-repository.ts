import type { Db } from "mongodb";
import type { NftIdentity } from "@chog/shared-types";
import { randomUUID } from "node:crypto";

export type ProfileRecord = {
  id: string;
  nft: NftIdentity;
  displayName: string;
  xp: number;
  level: number;
  stage: string;
  traits: string[];
  version: number;
  artworkUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export class MongoProfileRepository {
  constructor(private readonly db: Db) {}

  async register(
    walletId: string,
    identity: NftIdentity,
  ): Promise<ProfileRecord> {
    const key = {
      chain_id: identity.chainId,
      collection_address: identity.collectionAddress.toLowerCase(),
      token_id: identity.tokenId,
    };
    const now = new Date();
    const result = await this.db
      .collection<any>("nft_profiles")
      .findOneAndUpdate(
        key,
        {
          $setOnInsert: {
            _id: randomUUID(),
            ...key,
            mode: identity.mode,
            display_name: `Chog #${identity.tokenId}`,
            xp: 0,
            level: 1,
            stage: "hatchling",
            traits: [],
            version: 0,
            created_at: now,
          },
          $set: { owner_wallet_id: walletId, updated_at: now },
        },
        { upsert: true, returnDocument: "after" },
      );
    if (!result) throw new Error("profile_register_failed");
    return this.toRecord(result);
  }

  async listForWallet(walletId: string): Promise<ProfileRecord[]> {
    const rows = await this.db
      .collection<any>("nft_profiles")
      .find({ owner_wallet_id: walletId })
      .sort({ created_at: 1 })
      .toArray();
    return rows.map((row) => this.toRecord(row));
  }

  async releaseOwnership(walletId: string, profileId: string) {
    await this.db
      .collection<any>("nft_profiles")
      .updateOne(
        { _id: profileId, owner_wallet_id: walletId },
        { $unset: { owner_wallet_id: "" }, $set: { updated_at: new Date() } },
      );
  }

  async getPassport(profileId: string) {
    const row = await this.db
      .collection<any>("nft_profiles")
      .findOne({ _id: profileId });
    if (!row) return undefined;
    const history = await this.db
      .collection<any>("evolution_history")
      .find({ profile_id: profileId, finalized: true, outcome: "accepted" })
      .sort({ new_version: 1 })
      .toArray();
    const artifacts = await this.db
      .collection<any>("artifacts")
      .find({ profile_id: profileId })
      .sort({ created_at: 1 })
      .toArray();
    const artifactByClaim = new Map(
      artifacts.map((item) => [item.claim_id, item]),
    );
    return {
      profile: this.toRecord(row),
      history: history.map((item) => ({
        ...item,
        id: String(item._id),
        artworkUrl: artifactByClaim.get(item.claim_id)?.public_url ?? null,
        artworkHash: artifactByClaim.get(item.claim_id)?.image_hash ?? null,
        createdAt: new Date(item.created_at).toISOString(),
      })),
    };
  }

  private toRecord(row: any): ProfileRecord {
    return {
      id: String(row._id),
      nft: {
        mode: row.mode,
        chainId: Number(row.chain_id),
        collectionAddress: row.collection_address as `0x${string}`,
        tokenId: String(row.token_id),
      },
      displayName: row.display_name,
      xp: row.xp,
      level: row.level,
      stage: row.stage,
      traits: row.traits ?? [],
      version: row.version,
      ...(typeof row.artwork_url === "string"
        ? { artworkUrl: row.artwork_url }
        : {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
