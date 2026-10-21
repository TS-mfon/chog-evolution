import {
  encodeFunctionData,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { NftIdentity } from "@chog/shared-types";
import {
  ApiError,
  chainConfiguration,
  confirmationDepth,
  demoAbi,
  ownerAbi,
  rpcClient,
  transferAbi,
  validateChain,
  type ClientFactory,
} from "./config.js";

export type MintProof = {
  chain_id: number;
  collection_address: string;
  token_id: string;
  wallet: string;
  transaction_hash: Hex;
  block_number: string;
  block_hash: Hex;
  block_timestamp: number;
  transaction_nonce: number;
  transaction_from: string;
  receipt_status: "success";
  log_index: number;
  event: "Transfer(zero,wallet,tokenId)";
  confirmations_required: number;
  verified_at: string;
};

export async function prepareMint(
  wallet: Address,
  factory: ClientFactory = rpcClient,
) {
  const config = chainConfiguration("demo");
  if (!config.collectionAddress) throw new ApiError("mint_not_ready");
  const client = factory(config);
  await validateChain(client, config.chainId);
  const [name, symbol, next, maxSupply] = await Promise.all([
    client.readContract({
      address: config.collectionAddress,
      abi: demoAbi,
      functionName: "name",
    }),
    client.readContract({
      address: config.collectionAddress,
      abi: demoAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: config.collectionAddress,
      abi: demoAbi,
      functionName: "nextTokenId",
    }),
    client.readContract({
      address: config.collectionAddress,
      abi: demoAbi,
      functionName: "maxSupply",
    }),
  ]);
  if (name !== "CHOG Evolution Demo" || symbol !== "DCHOG" || next < 1n)
    throw new ApiError("mint_not_ready");
  if (next > maxSupply) throw new ApiError("mint_sold_out", 409);
  await client.simulateContract({
    address: config.collectionAddress,
    abi: demoAbi,
    functionName: "mint",
    account: wallet,
  });
  return {
    chainId: config.chainId,
    transaction: {
      to: config.collectionAddress,
      data: encodeFunctionData({ abi: demoAbi, functionName: "mint" }),
      value: "0x0",
    },
    supply: { minted: (next - 1n).toString(), maxSupply: maxSupply.toString() },
  };
}

export async function verifyDemoMint(
  wallet: Address,
  transactionHash: Hex,
  expectedTokenId?: string,
  factory: ClientFactory = rpcClient,
): Promise<{ identity: NftIdentity; proof: MintProof }> {
  const config = chainConfiguration("demo");
  if (!config.collectionAddress) throw new ApiError("mint_not_ready");
  const client = factory(config);
  await validateChain(client, config.chainId);
  const [receipt, tx, head] = await Promise.all([
    client.getTransactionReceipt({ hash: transactionHash }),
    client.getTransaction({ hash: transactionHash }),
    client.getBlockNumber({ cacheTime: 0 }),
  ]);
  if (
    receipt.status !== "success" ||
    receipt.to?.toLowerCase() !== config.collectionAddress.toLowerCase() ||
    tx.to?.toLowerCase() !== config.collectionAddress.toLowerCase() ||
    tx.from.toLowerCase() !== wallet.toLowerCase() ||
    receipt.from.toLowerCase() !== wallet.toLowerCase() ||
    receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
    tx.hash.toLowerCase() !== transactionHash.toLowerCase()
  )
    throw new ApiError("mint_invalid_transaction", 422);
  const confirmations = confirmationDepth();
  if (head < receipt.blockNumber + confirmations - 1n)
    throw new ApiError("mint_receipt_pending", 202);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || tx.blockHash !== receipt.blockHash)
    throw new ApiError("mint_receipt_pending", 202);
  const events = parseEventLogs({
    abi: transferAbi,
    logs: receipt.logs.filter(
      (log) =>
        log.address.toLowerCase() === config.collectionAddress!.toLowerCase(),
    ),
    strict: true,
  });
  const minted = events.filter(
    (event) =>
      event.args.from.toLowerCase() === zeroAddress &&
      event.args.to.toLowerCase() === wallet.toLowerCase(),
  );
  // The deployed DemoChog mints exactly one NFT. Refuse ambiguous or mismatched proof.
  const event = minted.length === 1 ? minted[0] : undefined;
  if (
    !event ||
    (expectedTokenId !== undefined &&
      event.args.tokenId.toString() !== expectedTokenId)
  )
    throw new ApiError("mint_invalid_transaction", 422);
  const owner = await client.readContract({
    address: config.collectionAddress,
    abi: ownerAbi,
    functionName: "ownerOf",
    args: [event.args.tokenId],
  });
  if (owner.toLowerCase() !== wallet.toLowerCase())
    throw new ApiError("mint_not_owned_by_wallet", 403);
  return {
    identity: {
      mode: "demo",
      chainId: config.chainId,
      collectionAddress: config.collectionAddress,
      tokenId: event.args.tokenId.toString(),
    },
    proof: {
      chain_id: config.chainId,
      collection_address: config.collectionAddress.toLowerCase(),
      token_id: event.args.tokenId.toString(),
      wallet: wallet.toLowerCase(),
      transaction_hash: receipt.transactionHash,
      transaction_nonce: tx.nonce,
      transaction_from: tx.from.toLowerCase(),
      block_number: receipt.blockNumber.toString(),
      block_hash: receipt.blockHash,
      block_timestamp: Number(block.timestamp),
      receipt_status: "success",
      log_index: event.logIndex,
      event: "Transfer(zero,wallet,tokenId)",
      confirmations_required: Number(confirmations),
      verified_at: new Date().toISOString(),
    },
  };
}
