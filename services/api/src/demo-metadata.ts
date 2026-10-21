import { artDataUri, composeDemoChog } from "@chog/art-composition";
import type { Db } from "mongodb";
import { maxUint256, zeroAddress } from "viem";
import {
  ApiError,
  chainConfiguration,
  ownerAbi,
  publicApiBase,
  publicArtifactUrl,
  rpcClient,
  validateChain,
  type ClientFactory,
} from "./config.js";

type MetadataAttribute = {
  trait_type: string;
  value: string | number;
  display_type?: "number";
};

export type DemoMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: MetadataAttribute[];
  external_url: string;
};

function webOrigin(): string {
  const configured =
    process.env.WEB_ORIGIN?.trim() ||
    process.env.APP_ORIGIN?.trim() ||
    publicApiBase();
  const url = new URL(configured);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && url.protocol === "http:"))
  )
    throw new ApiError("demo_metadata_origin_invalid");
  return url.origin;
}

function publishedImage(value: unknown, origin: string): string | undefined {
  const normalized = publicArtifactUrl(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized, origin);
    if (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        url.protocol === "ipfs:" ||
        (process.env.NODE_ENV !== "production" && url.protocol === "http:"))
    )
      return url.toString();
  } catch {
    // An invalid historical URL must not suppress the deterministic demo artwork.
  }
  return undefined;
}

const progressionNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= fallback
    ? value
    : fallback;

/** Public ERC-721 metadata. Existence and progression are read without registering a profile. */
export async function readDemoMetadata(
  db: Db | undefined,
  tokenId: string,
  factory: ClientFactory = rpcClient,
): Promise<DemoMetadata> {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(tokenId) || BigInt(tokenId) > maxUint256)
    throw new ApiError("invalid_token_id", 400);
  const config = chainConfiguration("demo");
  if (!config.collectionAddress)
    throw new ApiError("demo_metadata_unconfigured");
  const client = factory(config);
  await validateChain(client, config.chainId);
  try {
    const owner = await client.readContract({
      address: config.collectionAddress,
      abi: ownerAbi,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });
    if (!/^0x[0-9a-f]{40}$/i.test(owner) || owner.toLowerCase() === zeroAddress)
      throw new ApiError("demo_token_not_found", 404);
  } catch (error) {
    if (
      error instanceof Error &&
      /ERC721NonexistentToken|OwnerQueryForNonexistentToken|nonexistent token|invalid token ID/i.test(
        error.message,
      )
    )
      throw new ApiError("demo_token_not_found", 404);
    throw error;
  }
  // A missing database is not proof that an evolved profile is absent. Fail rather
  // than publish a temporary reset to hatchling during storage misconfiguration.
  if (!db) throw new ApiError("demo_metadata_database_unconfigured");
  const profile = await db.collection<any>("nft_profiles").findOne({
    mode: "demo",
    chain_id: config.chainId,
    collection_address: config.collectionAddress.toLowerCase(),
    token_id: tokenId,
  });
  const composition = composeDemoChog(
    tokenId,
    typeof profile?.stage === "string" ? profile.stage : "hatchling",
    Array.isArray(profile?.equipped_trait_ids)
      ? { equippedTraitIds: profile.equipped_trait_ids }
      : {},
  );
  const origin = webOrigin();
  const attributes: MetadataAttribute[] = [
    ...composition.traits
      .filter((trait) => trait.name !== "Evolution")
      .map((trait) => ({ trait_type: trait.name, value: trait.value })),
    { trait_type: "Stage", value: composition.stage },
    {
      display_type: "number",
      trait_type: "XP",
      value: progressionNumber(profile?.xp, 0),
    },
    {
      display_type: "number",
      trait_type: "Level",
      value: progressionNumber(profile?.level, 1),
    },
    {
      display_type: "number",
      trait_type: "Evolution version",
      value: progressionNumber(profile?.version, 0),
    },
    ...(Array.isArray(profile?.traits)
      ? profile.traits
          .filter(
            (trait: unknown): trait is string => typeof trait === "string",
          )
          .slice(0, 50)
          .map((trait: string) => ({
            trait_type: "Unlocked trait",
            value: trait.slice(0, 120),
          }))
      : []),
  ];
  return {
    name:
      typeof profile?.display_name === "string" && profile.display_name.trim()
        ? profile.display_name.slice(0, 120)
        : `Chogins Demo #${tokenId}`,
    description:
      "A Chogins demo NFT on Monad Testnet. Your Chog evolves through verified participation in the Chog and Monad ecosystems.",
    image:
      publishedImage(profile?.artwork_url, origin) ??
      artDataUri(
        tokenId,
        composition.stage,
        Array.isArray(profile?.equipped_trait_ids)
          ? { equippedTraitIds: profile.equipped_trait_ids }
          : {},
      ),
    attributes,
    external_url: new URL(
      profile
        ? `/passport/${encodeURIComponent(String(profile._id))}`
        : "/mint",
      origin,
    ).toString(),
  };
}
