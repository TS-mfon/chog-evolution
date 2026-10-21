import { toHex, type Address, type Hex } from "viem";
import type { WalletSession } from "./auth-repository.js";
import { MongoClaimRepository } from "./claim-repository.js";
import {
  ApiError,
  chainConfiguration,
  confirmationDepth,
  ownsProfile,
  rpcClient,
  validateChain,
  type ChainClient,
  type ClientFactory,
} from "./config.js";
import { evidenceDigest } from "./evidence-source.js";
import {
  MongoScanRepository,
  parseScanTargets,
  scanTargetKey,
  type ActivityProof,
  type ScanTarget,
  type ScanCoverage,
} from "./scan-repository.js";

function boundedSetting(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ApiError("scan_range_configuration_invalid");
  return value;
}

export class ScanService {
  constructor(
    private readonly scans: MongoScanRepository,
    private readonly claims: MongoClaimRepository,
    private readonly factory: ClientFactory = rpcClient,
  ) {}

  async run(session: WalletSession, profileId: string) {
    if (!session.authProofId)
      throw new ApiError("wallet_reauthentication_required", 401);
    const profile = await this.claims.getProfileForWallet(
      profileId,
      session.walletId,
    );
    if (!profile) throw new ApiError("profile_not_found_for_wallet", 404);
    if (!(await ownsProfile(profile, session.address, this.factory)))
      throw new ApiError(
        "nft_not_currently_owned_by_authenticated_wallet",
        403,
      );
    // NFT ownership uses its own chain above. Ecosystem activity always uses mainnet.
    const config = chainConfiguration("original_companion");
    const client = this.factory(config);
    await validateChain(client, config.chainId);
    let targets: ScanTarget[];
    try {
      targets = parseScanTargets(process.env.MONAD_SCAN_TARGETS).filter(
        (target) => target.chainId === config.chainId,
      );
    } catch {
      throw new ApiError("scan_targets_invalid");
    }
    const finality = confirmationDepth();
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const safeHead = head >= finality - 1n ? head - finality + 1n : -1n;
    if (safeHead < 0n) throw new ApiError("scan_chain_not_ready");
    const checkpoint = await this.scans.latestCheckpoint(
      session.walletId,
      config.chainId,
    );
    let jobId: string;
    try {
      jobId = await this.scans.start(
        session.walletId,
        profileId,
        config.chainId,
        checkpoint,
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ApiError("scan_already_running", 409);
      throw error;
    }
    const stopAt = Date.now() + 22_000;
    const coverage: ScanCoverage = {
      mode: targets.length ? "configured_events" : "recent_transactions",
      fromBlock: null,
      toBlock: null,
      fromTime: null,
      toTime: null,
      latestFinalizedBlock: safeHead.toString(),
      hasMore: true,
    };
    let complete = true;
    try {
      if (targets.length) {
        const maxBlocks = boundedSetting(
          "SCAN_MAX_BLOCK_RANGE",
          10_000,
          100,
          50_000,
        );
        const chunkBlocks = boundedSetting("SCAN_CHUNK_BLOCKS", 500, 1, 2000);
        const walletTopic =
          `0x${session.address.toLowerCase().slice(2).padStart(64, "0")}` as Hex;
        let totalChunks = 0;
        for (const target of targets) {
          const key = scanTargetKey(target);
          const start = Math.max(
            target.startBlock,
            checkpoint.targets[key] ?? target.startBlock,
          );
          const to = Math.min(Number(safeHead), start + maxBlocks - 1);
          for (let from = start; from <= to; from += chunkBlocks) {
            if (Date.now() > stopAt || totalChunks >= 12) {
              complete = false;
              break;
            }
            const end = Math.min(to, from + chunkBlocks - 1);
            const topics: (Hex | null)[] = [target.topic0];
            while (topics.length <= target.walletTopicIndex) topics.push(null);
            topics[target.walletTopicIndex] = walletTopic;
            const logs = await client.request({
              method: "eth_getLogs",
              params: [
                {
                  address: target.address,
                  fromBlock: toHex(from),
                  toBlock: toHex(end),
                  topics,
                },
              ],
            });
            if (logs.length > 100)
              throw new ApiError("scan_too_many_events_reduce_chunk");
            for (const log of logs) {
              if (
                log.removed ||
                !log.transactionHash ||
                !log.blockNumber ||
                !log.blockHash ||
                log.logIndex === null ||
                log.address.toLowerCase() !== target.address.toLowerCase() ||
                log.topics[0]?.toLowerCase() !== target.topic0.toLowerCase() ||
                log.topics[target.walletTopicIndex]?.toLowerCase() !==
                  walletTopic
              )
                continue;
              const proof = await this.verifyActivity(
                client,
                config.chainId,
                session.address,
                log.transactionHash,
                safeHead,
                target,
                Number(BigInt(log.logIndex)),
              );
              if (
                proof &&
                (target.questSlug ||
                  (proof.transaction_from === session.address.toLowerCase() &&
                    proof.input !== "0x" &&
                    proof.transaction_to !== session.address.toLowerCase()))
              )
                await this.scans.saveCandidate(
                  jobId,
                  profileId,
                  session.walletId,
                  proof,
                  target.questSlug ?? "monad-mainnet-explorer",
                  target.explorerTxBase ?? config.explorerUrl,
                );
            }
            checkpoint.targets[key] = end + 1;
            if (
              coverage.fromBlock === null ||
              from < Number(coverage.fromBlock)
            )
              coverage.fromBlock = String(from);
            if (coverage.toBlock === null || end > Number(coverage.toBlock))
              coverage.toBlock = String(end);
            totalChunks++;
            await this.scans.saveCheckpoint(jobId, checkpoint, "running");
          }
          if ((checkpoint.targets[key] ?? start) <= Number(safeHead))
            complete = false;
        }
      } else {
        const perRequest = boundedSetting(
          "SCAN_WALLET_BLOCKS_PER_REQUEST",
          32,
          1,
          128,
        );
        const lookback = boundedSetting(
          "SCAN_WALLET_LOOKBACK_BLOCKS",
          256,
          1,
          4096,
        );
        const key = "wallet-transactions-v1";
        const start =
          checkpoint.targets[key] ??
          Math.max(0, Number(safeHead) - lookback + 1);
        const end = Math.min(Number(safeHead), start + perRequest - 1);
        // Batches bound RPC concurrency, payloads and serverless duration. A checkpoint is
        // advanced only after all candidate receipts in that block were checked and saved.
        for (let from = start; from <= end; from += 4) {
          if (Date.now() > stopAt) {
            complete = false;
            break;
          }
          const numbers = Array.from(
            { length: Math.min(4, end - from + 1) },
            (_, offset) => from + offset,
          );
          const blocks = await Promise.all(
            numbers.map((block) =>
              client.getBlock({
                blockNumber: BigInt(block),
                includeTransactions: true,
              }),
            ),
          );
          for (const block of blocks) {
            if (!block.hash || block.number === null)
              throw new ApiError("scan_block_unavailable");
            const matching = block.transactions.filter(
              (tx) =>
                typeof tx !== "string" &&
                tx.from.toLowerCase() === session.address.toLowerCase() &&
                tx.to &&
                tx.to.toLowerCase() !== session.address.toLowerCase() &&
                tx.input !== "0x",
            );
            if (matching.length > 50)
              throw new ApiError("scan_too_many_wallet_transactions");
            for (const tx of matching) {
              if (typeof tx === "string") continue;
              const proof = await this.verifyActivity(
                client,
                config.chainId,
                session.address,
                tx.hash,
                safeHead,
              );
              if (proof)
                await this.scans.saveCandidate(
                  jobId,
                  profileId,
                  session.walletId,
                  proof,
                  "monad-mainnet-explorer",
                  config.explorerUrl,
                );
            }
            checkpoint.targets[key] = Number(block.number) + 1;
            coverage.fromBlock ??= block.number.toString();
            coverage.fromTime ??= new Date(
              Number(block.timestamp) * 1000,
            ).toISOString();
            coverage.toBlock = block.number.toString();
            coverage.toTime = new Date(
              Number(block.timestamp) * 1000,
            ).toISOString();
            await this.scans.saveCheckpoint(jobId, checkpoint, "running");
          }
        }
        if ((checkpoint.targets[key] ?? start) <= Number(safeHead))
          complete = false;
      }
      const queued = new Map<
        string,
        NonNullable<Awaited<ReturnType<MongoClaimRepository["getForWallet"]>>>
      >();
      const candidates = await this.scans.pendingEvents(
        session.walletId,
        config.chainId,
      );
      for (const candidate of candidates) {
        if (Date.now() > stopAt + 5000) {
          complete = false;
          break;
        }
        const quest = await this.claims.questBySlug(
          candidate.quest_slug ?? "monad-mainnet-explorer",
        );
        if (!quest) {
          await this.scans.reviewError(
            String(candidate._id),
            "activity_policy_unavailable",
          );
          continue;
        }
        try {
          const result = await this.claims.createOrGet({
            profileId,
            questId: String(quest._id),
            walletId: session.walletId,
            walletAddress: session.address,
            idempotencyKey: `scan:${candidate._id}`,
            scanEventId: String(candidate._id),
            ...(session.authProofId
              ? { authProofId: session.authProofId }
              : {}),
          });
          if (result.kind !== "claim") {
            await this.scans.reviewError(String(candidate._id), result.kind);
            continue;
          }
          await this.scans.attachClaim(
            jobId,
            String(candidate._id),
            result.item.id,
          );
          queued.set(result.item.id, result.item);
        } catch (error) {
          await this.scans.reviewError(
            String(candidate._id),
            error instanceof ApiError
              ? error.code
              : "activity_review_temporarily_unavailable",
          );
        }
      }
      if (
        queued.size > 0 &&
        candidates.length >= 12 &&
        (await this.scans.pendingEvents(session.walletId, config.chainId))
          .length
      )
        complete = false;
      coverage.hasMore = !complete;
      await this.scans.saveCoverage(jobId, coverage);
      await this.scans.saveCheckpoint(
        jobId,
        checkpoint,
        complete ? "complete" : "partial",
      );
      const item = await this.scans.getForWallet(jobId, session.walletId);
      return {
        item: item ? { ...item, claims: [...queued.values()] } : null,
        claims: [...queued.values()],
        next: complete ? null : jobId,
        candidateOnly: true,
        partial: !complete,
      };
    } catch (error) {
      await this.scans.saveCoverage(jobId, coverage).catch(() => undefined);
      await this.scans
        .saveCheckpoint(
          jobId,
          checkpoint,
          "failed",
          error instanceof ApiError
            ? error.code
            : "scan_rpc_or_storage_failure",
        )
        .catch(() => undefined);
      throw error;
    }
  }

  private async verifyActivity(
    client: ChainClient,
    chainId: number,
    wallet: Address,
    hash: Hex,
    safeHead: bigint,
    target?: ScanTarget,
    logIndex = -1,
  ): Promise<ActivityProof | null> {
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash }),
    ]);
    if (
      receipt.status !== "success" ||
      receipt.blockNumber > safeHead ||
      !receipt.blockHash ||
      transaction.blockHash !== receipt.blockHash ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      transaction.hash.toLowerCase() !== hash.toLowerCase() ||
      receipt.from.toLowerCase() !== transaction.from.toLowerCase() ||
      receipt.to?.toLowerCase() !== transaction.to?.toLowerCase()
    )
      return null;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw new ApiError("scan_reorg_retry");
    const walletTopic = `0x${wallet.toLowerCase().slice(2).padStart(64, "0")}`;
    const destinationCode = transaction.to
      ? await client.getBytecode({
          address: transaction.to,
          blockNumber: receipt.blockNumber,
        })
      : undefined;
    if (target) {
      const event = receipt.logs.find(
        (log) =>
          log.logIndex === logIndex &&
          log.address.toLowerCase() === target.address.toLowerCase() &&
          log.topics[0]?.toLowerCase() === target.topic0.toLowerCase() &&
          log.topics[target.walletTopicIndex]?.toLowerCase() === walletTopic,
      );
      if (!event) return null;
      if (!target.questSlug && (!destinationCode || destinationCode === "0x"))
        return null;
    } else {
      if (
        transaction.from.toLowerCase() !== wallet.toLowerCase() ||
        !transaction.to ||
        transaction.to.toLowerCase() === wallet.toLowerCase() ||
        transaction.input === "0x"
      )
        return null;
      if (!destinationCode || destinationCode === "0x") return null;
    }
    return {
      chain_id: chainId,
      wallet: wallet.toLowerCase(),
      transaction_hash: hash,
      block_hash: receipt.blockHash,
      block_number: receipt.blockNumber.toString(),
      block_timestamp: Number(block.timestamp),
      transaction_from: transaction.from.toLowerCase(),
      transaction_to: transaction.to?.toLowerCase() ?? null,
      transaction_nonce: transaction.nonce,
      value_wei: transaction.value.toString(),
      input: transaction.input.slice(0, 74),
      receipt_status: "success",
      confirmations_required: Number(confirmationDepth()),
      interaction_type: target ? "configured_contract_event" : "contract_call",
      target_name: target?.name ?? "Monad mainnet contract interaction",
      target_address:
        target?.address.toLowerCase() ?? transaction.to!.toLowerCase(),
      ...(target
        ? {
            event_topic: target.topic0,
            event_wallet_topic: target.walletTopicIndex,
          }
        : {}),
      log_index: logIndex,
      verified_at: new Date().toISOString(),
      destination_code_hash:
        destinationCode && destinationCode !== "0x"
          ? evidenceDigest(destinationCode)
          : null,
      ...{
        input_hash: evidenceDigest(transaction.input),
        input_bytes: (transaction.input.length - 2) / 2,
      },
    };
  }
}
