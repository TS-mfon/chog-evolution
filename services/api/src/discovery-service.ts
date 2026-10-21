import { parseAbi, type Address } from "viem";
import type { NftIdentity } from "@chog/shared-types";
import {
  ApiError,
  chainConfiguration,
  demoAbi,
  ownerAbi,
  rpcClient,
  validateChain,
  type ClientFactory,
} from "./config.js";
import {
  MongoProfileRepository,
  type ProfileRecord,
} from "./profile-repository.js";

const discoveryAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
type Cursor = {
  mode: NftIdentity["mode"];
  wallet: string;
  collection: string;
  next: number;
  end: number;
  method: "enumerable" | "ids";
};

export async function discoverProfiles(
  profiles: MongoProfileRepository,
  walletId: string,
  wallet: Address,
  mode: NftIdentity["mode"] = "demo",
  cursor?: string,
  factory: ClientFactory = rpcClient,
) {
  const config = chainConfiguration(mode);
  if (!config.collectionAddress)
    throw new ApiError(
      mode === "demo"
        ? "demo_collection_unconfigured"
        : "original_collection_unconfigured",
    );
  const client = factory(config);
  await validateChain(client, config.chainId);
  const balance = await client.readContract({
    address: config.collectionAddress,
    abi: discoveryAbi,
    functionName: "balanceOf",
    args: [wallet],
  });
  if (balance === 0n) return { items: [], nextCursor: null, partial: false };
  let state: Cursor;
  if (cursor) {
    try {
      state = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw new ApiError("invalid_discovery_cursor", 400);
    }
    if (
      !state ||
      state.mode !== mode ||
      state.wallet !== wallet.toLowerCase() ||
      state.collection !== config.collectionAddress.toLowerCase() ||
      !Number.isSafeInteger(state.next) ||
      !Number.isSafeInteger(state.end) ||
      state.next < 0 ||
      state.end < state.next ||
      state.end > 100_000 ||
      !["enumerable", "ids"].includes(state.method)
    )
      throw new ApiError("invalid_discovery_cursor", 400);
  } else {
    let enumerable = false;
    try {
      enumerable = await client.readContract({
        address: config.collectionAddress,
        abi: discoveryAbi,
        functionName: "supportsInterface",
        args: ["0x780e9d63"],
      });
    } catch {
      /* ERC-721 enumeration is optional. */
    }
    let end: number;
    if (enumerable) end = Number(balance) - 1;
    else if (mode === "demo")
      end =
        Number(
          await client.readContract({
            address: config.collectionAddress,
            abi: demoAbi,
            functionName: "nextTokenId",
          }),
        ) - 1;
    else {
      // The confirmed Genesis collection is capped at 1,969. An explicit maximum supports
      // a reviewed deployment with sparse IDs; supply alone would miss burned token IDs.
      const configuredMax = Number(
        process.env.ORIGINAL_COLLECTION_MAX_TOKEN_ID ?? 1969,
      );
      if (
        !Number.isSafeInteger(configuredMax) ||
        configuredMax < 0 ||
        configuredMax > 100_000
      )
        throw new ApiError("discovery_range_configuration_invalid");
      end = configuredMax;
    }
    if (!Number.isSafeInteger(end) || end > 100_000)
      throw new ApiError("discovery_range_configuration_invalid");
    state = {
      mode,
      wallet: wallet.toLowerCase(),
      collection: config.collectionAddress.toLowerCase(),
      next: mode === "demo" && !enumerable ? 1 : 0,
      end,
      method: enumerable ? "enumerable" : "ids",
    };
  }
  const items: ProfileRecord[] = [];
  const pageEnd = Math.min(state.end, state.next + 47);
  for (let start = state.next; start <= pageEnd; start += 6) {
    const candidates = Array.from(
      { length: Math.min(6, pageEnd - start + 1) },
      (_, offset) => start + offset,
    );
    const results = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const token =
          state.method === "enumerable"
            ? await client.readContract({
                address: config.collectionAddress!,
                abi: discoveryAbi,
                functionName: "tokenOfOwnerByIndex",
                args: [wallet, BigInt(candidate)],
              })
            : BigInt(candidate);
        const owner = await client.readContract({
          address: config.collectionAddress!,
          abi: ownerAbi,
          functionName: "ownerOf",
          args: [token],
        });
        if (owner.toLowerCase() !== wallet.toLowerCase()) return null;
        return profiles.register(walletId, {
          mode,
          chainId: config.chainId,
          collectionAddress: config.collectionAddress!,
          tokenId: token.toString(),
        });
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value) items.push(result.value);
      } else {
        // Nonexistent/burned IDs revert. Transport failures must not silently skip a page.
        const message =
          result.reason instanceof Error ? result.reason.message : "";
        if (
          !/revert|nonexistent|invalid token|execution reverted/i.test(message)
        )
          throw result.reason;
      }
    }
    state.next = start + candidates.length;
  }
  const partial = state.next <= state.end;
  return {
    items,
    nextCursor: partial
      ? Buffer.from(JSON.stringify(state)).toString("base64url")
      : null,
    partial,
  };
}
