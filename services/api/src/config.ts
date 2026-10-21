import {
  createPublicClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import type { NftIdentity } from "@chog/shared-types";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super(code);
  }
}

export type ChainConfiguration = {
  chainId: number;
  rpcUrl: string;
  publicRpcUrl: string;
  explorerUrl: string;
  collectionAddress: Address | null;
  mode: NftIdentity["mode"];
};

const address = (value: string | undefined): Address | null =>
  value && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)
    ? (value as Address)
    : null;

export function chainConfiguration(
  mode: NftIdentity["mode"],
): ChainConfiguration {
  const demo = mode === "demo";
  const prefix = demo ? "MONAD_TESTNET" : "MONAD_MAINNET";
  const chainId = Number(
    process.env[`${prefix}_CHAIN_ID`] ?? (demo ? 10143 : 143),
  );
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new ApiError("chain_configuration_invalid");
  const publicDefault = demo
    ? "https://testnet-rpc.monad.xyz"
    : "https://rpc.monad.xyz";
  const publicRpcUrl = publicUrl(
    process.env[`NEXT_PUBLIC_${prefix}_RPC_URL`],
    publicDefault,
  );
  return {
    chainId,
    mode,
    // Server URLs may carry private provider credentials. Never expose them in /config.
    rpcUrl: process.env[`${prefix}_RPC_URL`] || publicDefault,
    publicRpcUrl,
    explorerUrl: publicUrl(
      process.env[`NEXT_PUBLIC_${prefix}_EXPLORER_URL`],
      demo ? "https://testnet.monadscan.com" : "https://monadscan.com",
    ),
    collectionAddress: address(
      process.env[
        demo ? "DEMO_COLLECTION_ADDRESS" : "ORIGINAL_CHOG_COLLECTION_ADDRESS"
      ],
    ),
  };
}

function publicUrl(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function publicApiBase(): string {
  const explicit = process.env.PUBLIC_API_URL?.trim() || undefined;
  const origin =
    process.env.APP_ORIGIN?.trim() ||
    process.env.WEB_ORIGIN?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  if (!explicit && !origin)
    throw new ApiError("public_evidence_origin_unconfigured");
  const url = new URL(
    explicit ??
      `${origin!.replace(/\/$/, "")}${process.env.PUBLIC_API_PATH ?? "/api"}`,
  );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && url.protocol === "http:"))
  ) {
    throw new ApiError("public_evidence_origin_invalid");
  }
  return url.toString().replace(/\/$/, "");
}

export function evidenceOriginReady(): boolean {
  try {
    publicApiBase();
    return true;
  } catch {
    return false;
  }
}

export function publicArtifactUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/v1/artifacts/")) return value;
  try {
    return `${publicApiBase()}${value}`;
  } catch {
    return `${process.env.PUBLIC_API_PATH ?? "/api"}${value}`;
  }
}

export function publicConfiguration(databaseAvailable = true) {
  const publish = ({
    chainId,
    publicRpcUrl,
    explorerUrl,
    collectionAddress,
  }: ChainConfiguration) => ({
    chainId,
    rpcUrl: publicRpcUrl,
    explorerUrl,
    collectionAddress,
  });
  return {
    demo: publish(chainConfiguration("demo")),
    mainnet: publish(chainConfiguration("original_companion")),
    features: {
      xLink: databaseAvailable && process.env.X_SOURCE_MODE !== "disabled",
      scans: databaseAvailable,
      evidence: databaseAvailable && evidenceOriginReady(),
    },
  };
}

export function rpcClient(configuration: ChainConfiguration): PublicClient {
  return createPublicClient({
    chain: defineChain({
      id: configuration.chainId,
      name: configuration.mode === "demo" ? "Monad Testnet" : "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [configuration.rpcUrl] } },
    }),
    transport: http(configuration.rpcUrl, { timeout: 8_000, retryCount: 1 }),
  });
}
export type ChainClient = PublicClient;
export type ClientFactory = (configuration: ChainConfiguration) => ChainClient;

export async function validateChain(
  client: ChainClient,
  expectedChainId: number,
): Promise<void> {
  if ((await client.getChainId()) !== expectedChainId)
    throw new ApiError("rpc_chain_mismatch");
}

export const ownerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error OwnerQueryForNonexistentToken()",
]);
export const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
export const demoAbi = parseAbi([
  "function mint() returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

export function confirmationDepth(): bigint {
  const value = Number(process.env.MONAD_FINALITY_BLOCKS ?? 4);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new ApiError("finality_configuration_invalid");
  return BigInt(value);
}

export async function ownsProfile(
  profile: {
    mode: NftIdentity["mode"];
    chain_id: number;
    collection_address: string;
    token_id: string;
  },
  wallet: string,
  factory: ClientFactory = rpcClient,
): Promise<boolean> {
  const config = chainConfiguration(profile.mode);
  if (
    config.chainId !== Number(profile.chain_id) ||
    config.collectionAddress?.toLowerCase() !==
      profile.collection_address.toLowerCase()
  )
    return false;
  const client = factory(config);
  await validateChain(client, config.chainId);
  try {
    const owner = await client.readContract({
      address: config.collectionAddress,
      abi: ownerAbi,
      functionName: "ownerOf",
      args: [BigInt(profile.token_id)],
    });
    return owner.toLowerCase() === wallet.toLowerCase();
  } catch (error) {
    if (
      error instanceof Error &&
      /ERC721NonexistentToken|OwnerQueryForNonexistentToken|nonexistent token|invalid token ID/i.test(
        error.message,
      )
    )
      return false;
    throw error;
  }
}
