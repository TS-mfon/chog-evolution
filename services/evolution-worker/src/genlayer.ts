import { createAccount, createClient } from "genlayer-js-stable";
import {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js-stable/chains";
import { TransactionHashVariant } from "genlayer-js-stable/types";
import type {
  CalldataEncodable,
  TransactionHash,
} from "genlayer-js-stable/types";

export type Finality = "pending" | "finalized" | "failed";
export interface Adjudicator {
  submit(args: CalldataEncodable[]): Promise<string>;
  poll(hash: string): Promise<Finality>;
  readDecision(claimId: string): Promise<unknown>;
}

const networks = { localnet, studionet, testnetAsimov, testnetBradbury };

// The stable StudioNet SDK exposes status/statusName. ACCEPTED is still
// appealable; a successfully executed proposal alone must never grant XP.
export function transactionFinality(value: unknown): Finality {
  if (!value || typeof value !== "object") return "pending";
  const tx = value as Record<string, unknown>;
  const status = String(tx.statusName ?? tx.status ?? "").toUpperCase();
  if (status === "CANCELED" || status === "8") return "failed";
  if (status !== "FINALIZED" && status !== "7") return "pending";
  if (
    tx.txExecutionResultName === "FINISHED_WITH_ERROR" ||
    tx.txExecutionResult === 2
  )
    return "failed";
  // Some Studio responses omit execution-result fields. Read the bound decision
  // from LATEST_FINAL in that case. NO_MAJORITY alone is not a state proof.
  return "finalized";
}

export function createAdjudicator(
  env: NodeJS.ProcessEnv = process.env,
): Adjudicator | undefined {
  const key = env.GENLAYER_PRIVATE_KEY;
  const address = env.GENLAYER_CONTRACT_ADDRESS;
  const name = env.GENLAYER_NETWORK ?? "studionet";
  if (!key || !address) return undefined;
  if (!/^0x[0-9a-f]{64}$/i.test(key) || !/^0x[0-9a-f]{40}$/i.test(address))
    throw new Error("worker_genlayer_credentials_malformed");
  if (!(name in networks))
    throw new Error("worker_genlayer_network_unsupported");
  const chain = networks[name as keyof typeof networks];
  const { blockExplorers, ...chainFields } = chain;
  const client = createClient({
    // Preserve isStudio and the consensus contract definitions. Stripping the
    // chain to EVM-only fields sends the stable Studio RPC the wrong methods.
    chain: {
      ...chainFields,
      // The stable SDK writes endpoint overrides into rpcUrls.default.http.
      // Clone that branch so this client cannot alter another client's network.
      rpcUrls: {
        ...chain.rpcUrls,
        default: {
          ...chain.rpcUrls.default,
          http: [...chain.rpcUrls.default.http],
        },
      },
      ...(blockExplorers ? { blockExplorers } : {}),
    },
    ...(env.GENLAYER_RPC_URL ? { endpoint: env.GENLAYER_RPC_URL } : {}),
    account: createAccount(key as `0x${string}`),
  });
  return {
    async submit(args) {
      const hash: unknown = await client.writeContract({
        address: address as `0x${string}`,
        functionName: "adjudicate",
        args,
        value: 0n,
        // Evidence adjudication keeps validator consensus; leader-only was a
        // deployment option, never the reward evaluation policy.
      });
      if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash))
        throw new Error("genlayer_submission_reference_invalid");
      return hash;
    },
    async poll(hash) {
      if (!/^0x[0-9a-f]{64}$/i.test(hash))
        throw new Error("genlayer_submission_reference_invalid");
      return transactionFinality(
        await client.getTransaction({ hash: hash as TransactionHash }),
      );
    },
    async readDecision(claimId) {
      const raw = await client.readContract({
        address: address as `0x${string}`,
        functionName: "get_claim_decision",
        args: [claimId],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      });
      if (typeof raw === "string") return raw ? JSON.parse(raw) : null;
      return raw;
    },
  };
}
