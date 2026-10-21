import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { parseAbi } from "viem";
import {
  ApiError,
  chainConfiguration,
  rpcClient,
  validateChain,
  type ClientFactory,
} from "./config.js";

export const MAX_ORIGINAL_METADATA_BYTES = 128 * 1024;
const REQUEST_MS = 8_000;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return (
    family === 6 &&
    !address.includes("%") &&
    globalV6.check(address, "ipv6") &&
    !blocked.check(address, "ipv6")
  );
}

/** Resolve storage schemes to fixed public gateways. No redirects, IP literals or credentials. */
export function metadataUrl(value: string): URL {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    /[\\\s\u0000-\u001f\u007f]/.test(value)
  )
    throw new ApiError("original_metadata_url_not_allowed", 422);
  let converted = value;
  if (value.startsWith("ipfs://")) {
    const path = value.slice(7).replace(/^ipfs\//, "");
    if (
      !/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:[/?]|$)/.test(path)
    )
      throw new ApiError("original_metadata_url_not_allowed", 422);
    converted = `https://ipfs.io/ipfs/${path}`;
  } else if (value.startsWith("ar://")) {
    const path = value.slice(5);
    if (!/^[A-Za-z0-9_-]{43}(?:[/?]|$)/.test(path))
      throw new ApiError("original_metadata_url_not_allowed", 422);
    converted = `https://arweave.net/${path}`;
  }
  let url: URL;
  try {
    url = new URL(converted);
  } catch {
    throw new ApiError("original_metadata_url_not_allowed", 422);
  }
  const authority = converted.match(/^https:\/\/([^/?#]+)/i)?.[1];
  let segments: string[];
  try {
    segments = converted
      .split(/[?#]/, 1)[0]!
      .split("/")
      .slice(3)
      .map(decodeURIComponent);
  } catch {
    throw new ApiError("original_metadata_url_not_allowed", 422);
  }
  if (
    !authority ||
    !/^[A-Za-z0-9.-]+$/.test(authority) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    isIP(url.hostname) ||
    url.hostname.length > 253 ||
    url.hostname.endsWith(".") ||
    !url.hostname.includes(".") ||
    url.hostname
      .split(".")
      .some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/.test(
      url.hostname,
    ) ||
    segments.some(
      (part) =>
        part === "." || part === ".." || /[\\/\u0000-\u001f\u007f]/.test(part),
    )
  )
    throw new ApiError("original_metadata_url_not_allowed", 422);
  return url;
}

type ResolvedAddress = { address: string; family: number };
export type MetadataNetwork = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: typeof httpsRequest;
};

async function publicAddresses(
  url: URL,
  network: MetadataNetwork,
  timeout: number,
): Promise<ResolvedAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      network.resolve
        ? network.resolve(url.hostname)
        : lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ApiError("original_metadata_unavailable")),
          timeout,
        );
      }),
    ]);
    if (
      !addresses.length ||
      addresses.length > 64 ||
      addresses.some(
        (row) =>
          !publicAddress(row.address) || isIP(row.address) !== row.family,
      )
    )
      throw new ApiError("original_metadata_url_not_allowed", 422);
    return addresses;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("original_metadata_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function readPublicMetadataJson(
  url: URL,
  network: MetadataNetwork = {},
): Promise<unknown> {
  // Revalidate exported callers too, before DNS or an outgoing connection.
  url = metadataUrl(url.href);
  const deadline = Date.now() + REQUEST_MS;
  const [pinned] = await publicAddresses(url, network, REQUEST_MS);
  const raw = await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let req: ReturnType<typeof httpsRequest> | undefined;
    const timer = setTimeout(
      () => finish(new ApiError("original_metadata_unavailable")),
      Math.max(1, deadline - Date.now()),
    );
    function finish(error: Error | null, value?: Buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        req?.destroy();
      } else resolve(value!);
    }
    try {
      req = (network.request ?? httpsRequest)(
        url,
        {
          method: "GET",
          agent: false,
          timeout: Math.max(1, deadline - Date.now()),
          // Keep the hostname for TLS certificate validation, pin only the connection address.
          lookup: ((_hostname: string, options: any, callback: any) =>
            options?.all
              ? callback(null, [pinned!])
              : callback(null, pinned!.address, pinned!.family)) as any,
          headers: {
            accept: "application/json",
            "accept-encoding": "identity",
            "user-agent": "CHOG-Original-Metadata/1.0",
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.destroy();
            finish(new ApiError("original_metadata_unavailable"));
            return;
          }
          if (
            Number(res.headers["content-length"]) > MAX_ORIGINAL_METADATA_BYTES
          ) {
            res.destroy();
            finish(new ApiError("original_metadata_too_large", 422));
            return;
          }
          if (
            res.headers["content-encoding"] &&
            res.headers["content-encoding"] !== "identity"
          ) {
            res.destroy();
            finish(new ApiError("original_metadata_invalid", 422));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_ORIGINAL_METADATA_BYTES) {
              res.destroy();
              finish(new ApiError("original_metadata_too_large", 422));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            res.complete
              ? finish(null, Buffer.concat(chunks, size))
              : finish(new ApiError("original_metadata_unavailable")),
          );
          res.on("error", () =>
            finish(new ApiError("original_metadata_unavailable")),
          );
          res.on("aborted", () =>
            finish(new ApiError("original_metadata_unavailable")),
          );
          res.on("close", () => {
            if (!res.complete)
              finish(new ApiError("original_metadata_unavailable"));
          });
        },
      );
      req.on("timeout", () =>
        finish(new ApiError("original_metadata_unavailable")),
      );
      req.on("error", () =>
        finish(new ApiError("original_metadata_unavailable")),
      );
      req.end();
    } catch {
      finish(new ApiError("original_metadata_unavailable"));
    }
  });
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError("original_metadata_invalid", 422);
  }
}

export async function readOriginalMetadata(
  tokenId: string,
  factory: ClientFactory = rpcClient,
  network: MetadataNetwork = {},
) {
  if (
    typeof tokenId !== "string" ||
    !/^(?:0|[1-9]\d{0,77})$/.test(tokenId) ||
    BigInt(tokenId) >= 2n ** 256n
  )
    throw new ApiError("original_token_id_invalid", 422);
  const config = chainConfiguration("original_companion");
  if (!config.collectionAddress)
    throw new ApiError("original_collection_unconfigured");
  const client = factory(config);
  await validateChain(client, config.chainId);
  let tokenUri: unknown;
  try {
    tokenUri = await client.readContract({
      address: config.collectionAddress,
      abi: parseAbi([
        "function tokenURI(uint256 tokenId) view returns (string)",
      ]),
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
    });
  } catch {
    throw new ApiError("original_metadata_unavailable");
  }
  if (typeof tokenUri !== "string" || tokenUri.length > 2048)
    throw new ApiError("original_metadata_invalid", 422);
  const content = await readPublicMetadataJson(metadataUrl(tokenUri), network);
  if (!content || typeof content !== "object" || Array.isArray(content))
    throw new ApiError("original_metadata_invalid", 422);
  const metadata = content as Record<string, unknown>;
  let imageUrl: string | undefined;
  if (metadata.image !== undefined) {
    if (typeof metadata.image !== "string")
      throw new ApiError("original_metadata_invalid", 422);
    const image = metadataUrl(metadata.image);
    await publicAddresses(image, network, REQUEST_MS);
    imageUrl = image.href;
  }
  return {
    tokenUri,
    imageUrl,
    name:
      typeof metadata.name === "string"
        ? metadata.name.slice(0, 120)
        : undefined,
    description:
      typeof metadata.description === "string"
        ? metadata.description.slice(0, 2000)
        : undefined,
    fetchedAt: new Date().toISOString(),
  };
}
