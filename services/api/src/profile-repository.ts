import type { Db } from "mongodb";
import type { NftIdentity } from "@chog/shared-types";
import { randomUUID } from "node:crypto";
import type { MintProof } from "./mint-service.js";
import { publicArtifactUrl } from "./config.js";
import {
  ApiError,
  ownsProfile,
  rpcClient,
  type ClientFactory,
} from "./config.js";
import {
  earnedTraitsForXp,
  legacyEquipment,
  validateEquipment,
  TRAIT_CATALOGUE_VERSION,
} from "@chog/evolution-rules";
import { composeDemoChog, artDataUri } from "@chog/art-composition";
import {
  readOriginalMetadata,
  type MetadataNetwork,
} from "./original-metadata.js";
import { parsePage, pageQuery, paginateRows } from "./pagination.js";

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
  mintTransactionHash?: string;
  createdAt: string;
  updatedAt: string;
  earnedTraitIds: string[];
  equippedTraitIds: string[];
  traitCatalogueVersion: number;
  artworkVersion: number | null;
  artworkPending: boolean;
  originalMetadata?: {
    tokenUri: string;
    name?: string;
    description?: string;
    imageUrl?: string;
    fetchedAt: string;
  };
  originalMetadataStatus?: "ready" | "unavailable";
  originalMetadataErrorCode?: string;
  originalMetadataAttemptedAt?: string;
};

export class MongoProfileRepository {
  constructor(private readonly db: Db) {}

  async register(
    walletId: string,
    identity: NftIdentity,
    mintProof?: MintProof,
  ): Promise<ProfileRecord> {
    const key = {
      chain_id: identity.chainId,
      collection_address: identity.collectionAddress.toLowerCase(),
      token_id: identity.tokenId,
    };
    const now = new Date();
    const mintFields = mintProof
      ? {
          mint_transaction_hash: mintProof.transaction_hash,
          mint_proof: mintProof,
          minted_at: new Date(mintProof.block_timestamp * 1000),
        }
      : {};
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
            earned_trait_ids: [],
            equipped_trait_ids: [],
            trait_catalogue_version: TRAIT_CATALOGUE_VERSION,
            created_at: now,
            ...mintFields,
          },
          $set: { owner_wallet_id: walletId, updated_at: now },
        },
        { upsert: true, returnDocument: "after" },
      );
    if (!result) throw new Error("profile_register_failed");
    if (mintProof && !result.mint_proof) {
      await this.db
        .collection<any>("nft_profiles")
        .updateOne(
          { _id: result._id, mint_proof: { $exists: false } },
          { $set: mintFields },
        );
      Object.assign(result, mintFields);
    }
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

  async listPageForWallet(walletId: string, query: unknown) {
    const { limit, cursor } = parsePage(query);
    const rows = await this.db
      .collection<any>("nft_profiles")
      .find({ owner_wallet_id: walletId, ...pageQuery(cursor, 1) })
      .sort({ created_at: 1, _id: 1 })
      .limit(limit + 1)
      .toArray();
    return paginateRows(rows, limit, (row) => this.toRecord(row));
  }

  async releaseOwnership(walletId: string, profileId: string) {
    await this.db
      .collection<any>("nft_profiles")
      .updateOne(
        { _id: profileId, owner_wallet_id: walletId },
        { $unset: { owner_wallet_id: "" }, $set: { updated_at: new Date() } },
      );
  }

  async captureOriginalMetadata(
    profile: ProfileRecord,
    factory: ClientFactory = rpcClient,
    network: MetadataNetwork = {},
  ) {
    if (profile.nft.mode !== "original_companion") return profile;
    if (profile.originalMetadataStatus === "unavailable") {
      if (
        profile.originalMetadataAttemptedAt &&
        Date.now() - Date.parse(profile.originalMetadataAttemptedAt) < 60000
      )
        return profile;
    } else if (
      profile.originalMetadata &&
      Date.now() - Date.parse(profile.originalMetadata.fetchedAt) < 600000
    )
      return profile;
    const attemptedAt = new Date().toISOString(),
      attemptId = randomUUID();
    const profiles = this.db.collection<any>("nft_profiles");
    await profiles.updateOne(
      { _id: profile.id, mode: "original_companion" },
      {
        $set: {
          original_metadata_attempt_id: attemptId,
          original_metadata_attempted_at: attemptedAt,
        },
      },
    );
    try {
      const metadata = await readOriginalMetadata(
        profile.nft.tokenId,
        factory,
        network,
      );
      const saved = await profiles.updateOne(
        { _id: profile.id, original_metadata_attempt_id: attemptId },
        {
          $set: {
            original_metadata: metadata,
            original_metadata_status: "ready",
          },
          $unset: { original_metadata_error_code: "" },
        },
      );
      if (saved.matchedCount) {
        const { originalMetadataErrorCode: ignored, ...previous } = profile;
        return {
          ...previous,
          originalMetadata: metadata,
          originalMetadataStatus: "ready" as const,
          originalMetadataAttemptedAt: attemptedAt,
        };
      }
    } catch (error) {
      const code =
        error instanceof ApiError
          ? error.code
          : "original_metadata_unavailable";
      const saved = await profiles.updateOne(
        { _id: profile.id, original_metadata_attempt_id: attemptId },
        {
          $set: {
            original_metadata_status: "unavailable",
            original_metadata_error_code: code,
          },
        },
      );
      if (saved.matchedCount)
        return {
          ...profile,
          originalMetadataStatus: "unavailable" as const,
          originalMetadataErrorCode: code,
          originalMetadataAttemptedAt: attemptedAt,
        };
    }
    const latest = await profiles.findOne({ _id: profile.id });
    return latest ? this.toRecord(latest) : profile;
  }

  async setEquipment(
    walletId: string,
    address: string,
    profileId: string,
    ids: unknown,
    expectedVersion: number,
    idempotencyKey: string,
    factory: ClientFactory = rpcClient,
  ) {
    const collection = this.db.collection<any>("nft_profiles");
    const original = await collection.findOne({
      _id: profileId,
      owner_wallet_id: walletId,
    });
    if (!original || !(await ownsProfile(original, address, factory)))
      throw new ApiError(
        "nft_not_currently_owned_by_authenticated_wallet",
        403,
      );
    let equipped: string[];
    try {
      equipped = validateEquipment(Number(original.xp), ids);
    } catch {
      throw new ApiError("invalid_or_locked_traits", 422);
    }
    const eventId = randomUUID();
    const key = `traits:${walletId}:${idempotencyKey}`;
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        const receipt = await this.db
          .collection<any>("audit_events")
          .findOne({ mutation_key: key }, { session });
        if (receipt) {
          if (
            receipt.entity_id !== profileId ||
            receipt.details?.expectedVersion !== expectedVersion ||
            JSON.stringify(receipt.details?.equippedTraitIds) !==
              JSON.stringify(equipped)
          )
            throw new ApiError("idempotency_conflict", 409);
          return;
        }
        const previous = await this.db
          .collection<any>("evolution_history")
          .findOne({ mutation_key: key }, { session });
        if (previous) {
          if (
            previous.profile_id !== profileId ||
            JSON.stringify(previous.after?.equippedTraitIds) !==
              JSON.stringify(equipped)
          )
            throw new ApiError("idempotency_conflict", 409);
          return;
        }
        const row = await collection.findOne(
          { _id: profileId, owner_wallet_id: walletId },
          { session },
        );
        if (!row || row.version !== expectedVersion)
          throw new ApiError("profile_version_conflict", 409);
        const current = row.equipped_trait_ids ?? legacyEquipment(row.xp);
        if (JSON.stringify([...current].sort()) === JSON.stringify(equipped)) {
          await this.db
            .collection<any>("audit_events")
            .insertOne(
              {
                _id: randomUUID(),
                mutation_key: key,
                actor_wallet_id: walletId,
                entity_type: "profile",
                entity_id: profileId,
                action: "traits_unchanged",
                details: { expectedVersion, equippedTraitIds: equipped },
                created_at: new Date(),
              },
              { session },
            );
          return;
        }
        const version = row.version + 1;
        const now = new Date();
        const traits = composeDemoChog(String(row.token_id), row.stage, {
          equippedTraitIds: equipped,
          mode: row.mode,
        }).traits.map((t) => `${t.name}: ${t.value}`);
        const before = {
          xp: row.xp,
          level: row.level,
          stage: row.stage,
          traits: row.traits,
          equippedTraitIds: current,
          artworkUrl:
            row.artwork_version === row.version
              ? (publicArtifactUrl(row.artwork_url) ?? null)
              : Number(row.version) === 0
                ? artDataUri(String(row.token_id), row.stage, {
                    equippedTraitIds: current,
                    mode: row.mode,
                  })
                : null,
        };
        const after = {
          xp: row.xp,
          level: row.level,
          stage: row.stage,
          traits,
          equippedTraitIds: equipped,
          artworkUrl: null,
        };
        await collection.updateOne(
          { _id: profileId, version: expectedVersion },
          {
            $set: {
              equipped_trait_ids: equipped,
              traits,
              version,
              updated_at: now,
            },
          },
          { session },
        );
        await this.db
          .collection<any>("evolution_history")
          .insertOne(
            {
              _id: eventId,
              source_event_id: eventId,
              profile_id: profileId,
              actor_wallet_id: walletId,
              kind: "trait_change",
              mutation_key: key,
              previous_version: row.version,
              new_version: version,
              before,
              after,
              xp_total: row.xp,
              changes: { xpAward: 0, stage: row.stage },
              outcome: "accepted",
              finalized: true,
              created_at: now,
            },
            { session },
          );
        await this.db
          .collection<any>("evolution_jobs")
          .insertOne(
            {
              _id: randomUUID(),
              source_event_id: eventId,
              profile_id: profileId,
              kind: "trait_change",
              evolution_version: version,
              snapshot: {
                ...after,
                mode: row.mode,
                traitCatalogueVersion: TRAIT_CATALOGUE_VERSION,
              },
              status: "queued",
              attempts: 0,
              lease_token: null,
              lease_until: null,
              created_at: now,
              updated_at: now,
            },
            { session },
          );
        await this.db
          .collection<any>("audit_events")
          .insertOne(
            {
              _id: randomUUID(),
              mutation_key: key,
              actor_wallet_id: walletId,
              entity_type: "profile",
              entity_id: profileId,
              action: "traits_changed",
              details: {
                sourceEventId: eventId,
                expectedVersion,
                equippedTraitIds: equipped,
              },
              created_at: now,
            },
            { session },
          );
      });
    } finally {
      await session.endSession();
    }
    const row = await collection.findOne({
      _id: profileId,
      owner_wallet_id: walletId,
    });
    if (!row) throw new ApiError("profile_not_found", 404);
    return this.toRecord(row);
  }

  async getPassport(profileId: string, query: unknown = {}) {
    const options = query as { limit?: unknown; cursor?: unknown };
    const { limit } = parsePage({ limit: options?.limit });
    let afterVersion = -1;
    if (options?.cursor !== undefined) {
      try {
        if (typeof options.cursor !== "string" || options.cursor.length > 200)
          throw new Error();
        const value = JSON.parse(
          Buffer.from(options.cursor, "base64url").toString(),
        );
        if (
          value.p !== profileId ||
          !Number.isSafeInteger(value.v) ||
          value.v < 0 ||
          Buffer.from(JSON.stringify(value)).toString("base64url") !==
            options.cursor
        )
          throw new Error();
        afterVersion = value.v;
      } catch {
        throw new ApiError("invalid_page_cursor", 400);
      }
    }
    const row = await this.db
      .collection<any>("nft_profiles")
      .findOne({ _id: profileId });
    if (!row) return undefined;
    const history = await this.db
      .collection<any>("evolution_history")
      .find({
        profile_id: profileId,
        finalized: true,
        outcome: "accepted",
        new_version: { $gt: afterVersion },
      })
      .sort({ new_version: 1 })
      .limit(limit + 1)
      .toArray();
    const hasMore = history.length > limit;
    if (hasMore) history.pop();
    const artifacts = await this.db
      .collection<any>("artifacts")
      .find({
        profile_id: profileId,
        evolution_version: {
          $in: [
            ...new Set(
              history.flatMap((item) => [
                item.previous_version,
                item.new_version,
              ]),
            ),
          ],
        },
      })
      .sort({ created_at: 1 })
      .toArray();
    const artifactByClaim = new Map(
      artifacts.map((item) => [item.claim_id, item]),
    );
    const artifactByEvent = new Map(
      artifacts.map((item) => [item.source_event_id, item]),
    );
    const artifactByVersion = new Map(
      artifacts.map((item) => [item.evolution_version, item]),
    );
    const historyClaims = history.length
      ? await this.db
          .collection<any>("claims")
          .find({ _id: { $in: history.map((item) => item.claim_id) } })
          .toArray()
      : [];
    const quests = historyClaims.length
      ? await this.db
          .collection<any>("quests")
          .find({ _id: { $in: historyClaims.map((claim) => claim.quest_id) } })
          .toArray()
      : [];
    const questById = new Map(
      quests.map((quest) => [String(quest._id), quest]),
    );
    const questByClaim = new Map(
      historyClaims.map((claim) => [
        String(claim._id),
        questById.get(String(claim.quest_id)),
      ]),
    );
    return {
      profile: this.toRecord(row),
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({ p: profileId, v: history.at(-1)!.new_version }),
          ).toString("base64url")
        : null,
      history: history.map((item) => ({
        profile_id: profileId,
        claim_id: item.claim_id ?? null,
        source_event_id: item.source_event_id ?? item._id,
        previous_version: item.previous_version,
        new_version: item.new_version,
        xp_total: item.xp_total,
        changes: item.changes,
        outcome: item.outcome,
        finalized: item.finalized,
        decision_reference: item.decision_reference ?? null,
        id: String(item._id),
        artworkUrl:
          publicArtifactUrl(
            (item.source_event_id
              ? artifactByEvent.get(item.source_event_id)
              : artifactByClaim.get(item.claim_id)
            )?.public_url,
          ) ?? null,
        kind: item.kind ?? "claim",
        before: item.before
          ? {
              ...item.before,
              artworkUrl:
                publicArtifactUrl(item.before.artworkUrl) ??
                publicArtifactUrl(
                  artifactByVersion.get(item.previous_version)?.public_url,
                ) ??
                null,
            }
          : null,
        after: item.after
          ? {
              ...item.after,
              artworkUrl:
                publicArtifactUrl(
                  (item.source_event_id
                    ? artifactByEvent.get(item.source_event_id)
                    : artifactByClaim.get(item.claim_id)
                  )?.public_url,
                ) ?? null,
            }
          : null,
        artworkHash:
          (item.source_event_id
            ? artifactByEvent.get(item.source_event_id)
            : artifactByClaim.get(item.claim_id)
          )?.image_hash ?? null,
        questName: questByClaim.get(String(item.claim_id))?.name ?? null,
        questSlug: questByClaim.get(String(item.claim_id))?.slug ?? null,
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
      earnedTraitIds:
        row.earned_trait_ids ?? earnedTraitsForXp(Number(row.xp ?? 0)),
      equippedTraitIds:
        row.equipped_trait_ids ?? legacyEquipment(Number(row.xp ?? 0)),
      traitCatalogueVersion:
        row.trait_catalogue_version ?? TRAIT_CATALOGUE_VERSION,
      artworkVersion: Number.isSafeInteger(row.artwork_version)
        ? row.artwork_version
        : null,
      artworkPending:
        Number(row.version ?? 0) > Number(row.artwork_version ?? 0),
      ...(row.original_metadata
        ? { originalMetadata: row.original_metadata }
        : {}),
      ...(row.original_metadata_status
        ? { originalMetadataStatus: row.original_metadata_status }
        : row.original_metadata
          ? { originalMetadataStatus: "ready" as const }
          : {}),
      ...(row.original_metadata_error_code
        ? { originalMetadataErrorCode: row.original_metadata_error_code }
        : {}),
      ...(row.original_metadata_attempted_at
        ? {
            originalMetadataAttemptedAt: new Date(
              row.original_metadata_attempted_at,
            ).toISOString(),
          }
        : {}),
      version: row.version,
      ...(typeof row.artwork_url === "string"
        ? { artworkUrl: publicArtifactUrl(row.artwork_url)! }
        : {}),
      ...(typeof row.mint_transaction_hash === "string"
        ? { mintTransactionHash: row.mint_transaction_hash }
        : {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
