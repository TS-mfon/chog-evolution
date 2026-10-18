import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "genlayer/ClaimAdjudicator.py");
const manifestPath = resolve(root, "deployments/genlayer-studionet.json");
const envBuildPath = process.env.ENV_BUILD_PATH ?? "/home/sudodave/.env.build";

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

const envText = await readFile(envBuildPath, "utf8");
const keyLine = envText.split(/\r?\n/).find((line) =>
  /^\s*(?:export\s+)?PRIVATE_KEY\s*=/.test(line),
);
const privateKey = keyLine?.split("=", 2)[1]?.trim().replace(/^['"]|['"]$/g, "");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("PRIVATE_KEY is missing or malformed in the configured build env file");
}

const code = await readFile(sourcePath, "utf8");
const codeHash = createHash("sha256").update(code).digest("hex");
const account = createAccount(privateKey);
if (account.address.toLowerCase() !== "0xed9edd8586b20524cafa4f568413c504c9b03172") {
  throw new Error("The build key does not match the previously configured deployment account");
}

const client = createClient({ chain: studionet, account });
const schema = await client.getContractSchemaForCode(code);
if (!schema) throw new Error("GenLayer returned no contract schema; deployment was not submitted");

const transactionHash = await client.deployContract({ code });
const record = {
  network: "studionet",
  chainId: Number(studionet.id),
  rpc: "https://studio.genlayer.com/api",
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
  const result = await client.waitForFinalization({
    hash: transactionHash,
    interval: 10_000,
    retries: 30,
  });
  const finalizedRecord = {
    ...record,
    status: isSuccessful(result) ? "finalized_success" : "finalized_failure",
    finalizedAt: new Date().toISOString(),
    statusName: result.statusName,
    txExecutionResultName: result.txExecutionResultName,
    contractAddress: result.contractAddress ?? null,
    attempts: [...previousAttempts, {
      transactionHash: String(transactionHash),
      statusName: result.statusName,
      txExecutionResultName: result.txExecutionResultName ?? null,
      contractAddress: result.contractAddress ?? null,
      submittedAt: record.submittedAt,
      finalizedAt: new Date().toISOString(),
    }],
  };
  await writeFile(manifestPath, `${JSON.stringify(finalizedRecord, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ event: "genlayer_contract_finalized", ...finalizedRecord }));
  if (!isSuccessful(result)) process.exitCode = 2;
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
