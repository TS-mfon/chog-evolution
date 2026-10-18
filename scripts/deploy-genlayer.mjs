import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js-stable";
import { studionet } from "genlayer-js-stable/chains";
import { TransactionStatus } from "genlayer-js-stable/types";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "genlayer/ClaimAdjudicator.py");
const manifestPath = resolve(root, "deployments/genlayer-studionet.json");
const envBuildPath = process.env.ENV_BUILD_PATH ?? "/home/sudodave/.env.build";
const chain = studionet;

let previousAttempts = [];
if (await fileExists(manifestPath)) {
  const previous = JSON.parse(await readFile(manifestPath, "utf8"));
  if (previous.status !== "finalized_failure" || process.env.RETRY_FINALIZED_FAILURE !== "1") {
    throw new Error("Refusing to resubmit: an existing deployment is pending or successful; a finalized failure requires RETRY_FINALIZED_FAILURE=1");
  }
  previousAttempts = [
    ...(Array.isArray(previous.attempts) ? previous.attempts : []),
    {
      transactionHash: previous.transactionHash,
      status: previous.status,
      statusName: previous.statusName,
      txExecutionResultName: previous.txExecutionResultName,
      contractAddress: previous.contractAddress,
      submittedAt: previous.submittedAt,
      finalizedAt: previous.finalizedAt,
    },
  ];
}

const envText = process.env.GENLAYER_PRIVATE_KEY
  ? ""
  : await readFile(envBuildPath, "utf8");
const keyLine = envText.split(/\r?\n/).find((line) =>
  /^\s*(?:export\s+)?PRIVATE_KEY\s*=/.test(line),
);
const privateKey =
  process.env.GENLAYER_PRIVATE_KEY ??
  keyLine?.split("=", 2)[1]?.trim().replace(/^['"]|['"]$/g, "");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("PRIVATE_KEY is missing or malformed in the configured build env file");
}

const code = await readFile(sourcePath, "utf8");
const codeHash = createHash("sha256").update(code).digest("hex");
const account = createAccount(privateKey);
if (account.address.toLowerCase() !== "0xed9edd8586b20524cafa4f568413c504c9b03172") {
  throw new Error("The build key does not match the previously configured deployment account");
}

const client = createClient({ chain, account });
const schema = await client.getContractSchemaForCode(code);
if (!schema) throw new Error("GenLayer returned no contract schema; deployment was not submitted");

const transactionHash = await client.deployContract({ code, leaderOnly: true });
const record = {
  network: "studionet",
  chainId: Number(chain.id),
  rpc: chain.rpcUrls.default.http[0],
  source: "genlayer/ClaimAdjudicator.py",
  sourceSha256: codeHash,
  deployer: account.address,
  transactionHash: String(transactionHash),
  attempt: previousAttempts.length + 1,
  attempts: previousAttempts,
  status: "submitted",
  submittedAt: new Date().toISOString(),
};
await mkdir(resolve(root, "deployments"), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ event: "genlayer_contract_submitted", ...record }));

try {
  const result = await client.waitForTransactionReceipt({
    hash: transactionHash,
    status: TransactionStatus.ACCEPTED,
    interval: 5_000,
    retries: 120,
  });
  const contractAddress = result.data?.contract_address ?? result.txDataDecoded?.contractAddress ?? null;
  let deployedSchema = null;
  if (contractAddress) {
    try {
      deployedSchema = await client.getContractSchema(contractAddress);
    } catch {
      deployedSchema = null;
    }
  }
  const deploymentVerified = Boolean(contractAddress && deployedSchema);
  const finalizedRecord = {
    ...record,
    status: deploymentVerified
      ? "finalized_deployment_verified"
      : "accepted_without_verified_deployment",
    finalizedAt: new Date().toISOString(),
    statusName: result.statusName,
    txExecutionResultName: result.txExecutionResultName ?? null,
    contractAddress,
    deploymentVerified,
    schemaMethodCount: deployedSchema
      ? Object.keys(deployedSchema.methods ?? {}).length
      : 0,
    attempts: [...previousAttempts, {
      transactionHash: String(transactionHash),
      statusName: result.statusName,
      txExecutionResultName: result.txExecutionResultName ?? null,
      contractAddress,
      submittedAt: record.submittedAt,
      finalizedAt: new Date().toISOString(),
    }],
    clientVersion: "genlayer-js@1.1.8",
  };
  await writeFile(manifestPath, `${JSON.stringify(finalizedRecord, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ event: "genlayer_contract_finalized", ...finalizedRecord }));
  if (!deploymentVerified) process.exitCode = 2;
} catch (error) {
  const pendingRecord = {
    ...record,
    status: "submitted_pending_reconciliation",
    lastPollError: error instanceof Error ? error.message : "unknown polling error",
    updatedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(pendingRecord, null, 2)}\n`, { mode: 0o600 });
  console.error(JSON.stringify({ event: "genlayer_contract_pending", ...pendingRecord }));
  process.exitCode = 2;
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
