import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = resolve(import.meta.dirname, "..");
const envBuildPath = process.env.ENV_BUILD_PATH ?? "/home/sudodave/.env.build";
const manifestPath = resolve(root, "deployments/monad-testnet.json");
const artifactPath = resolve(root, "contracts/out/DemoChog.sol/DemoChog.json");
const rpcUrl = process.env.MONAD_TESTNET_RPC_URL ?? "https://monad-testnet.drpc.org";
const maxSupply = BigInt(process.env.DEMO_MAX_SUPPLY ?? "10000");
const baseURI = process.env.DEMO_BASE_URI ?? "";
const chainId = 10143;

if (await fileExists(manifestPath)) {
  throw new Error("Refusing to deploy again: deployments/monad-testnet.json already exists");
}
if (maxSupply < 1n || !rpcUrl.startsWith("https://")) {
  throw new Error("Invalid demo supply or Monad HTTPS RPC URL");
}

const envText = await readFile(envBuildPath, "utf8");
const keyLine = envText.split(/\r?\n/).find((line) =>
  /^\s*(?:export\s+)?PRIVATE_KEY\s*=/.test(line),
);
const privateKey = keyLine?.split("=", 2)[1]?.trim().replace(/^['"]|['"]$/g, "");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("PRIVATE_KEY is missing or malformed in the configured build env file");
}
const account = privateKeyToAccount(privateKey);
if (account.address.toLowerCase() !== "0xed9edd8586b20524cafa4f568413c504c9b03172") {
  throw new Error("The build key does not match the configured deployment account");
}

const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const deploymentData = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [maxSupply, baseURI],
});
const scriptHash = createHash("sha256")
  .update(await readFile(resolve(root, "contracts/src/DemoChog.sol")))
  .digest("hex");
const networkChainId = BigInt(await rpc("eth_chainId", []));
if (networkChainId !== BigInt(chainId)) {
  throw new Error(`RPC chain ID ${networkChainId} did not match Monad testnet ${chainId}; no transaction sent`);
}

const nonce = BigInt(await rpc("eth_getTransactionCount", [account.address, "pending"]));
const gasPrice = BigInt(await rpc("eth_gasPrice", []));
const balance = BigInt(await rpc("eth_getBalance", [account.address, "latest"]));
const estimatedGas = BigInt(
  await rpc("eth_estimateGas", [{ from: account.address, data: deploymentData, value: "0x0" }]),
);
const gas = (estimatedGas * 120n + 99n) / 100n;
if (balance < gas * gasPrice) {
  throw new Error("Deployment account balance is below the estimated transaction cost; no transaction sent");
}

const signed = await account.signTransaction({
  chainId,
  nonce,
  gas,
  gasPrice,
  value: 0n,
  data: deploymentData,
});
const transactionHash = keccak256(signed);
const contractAddress = getContractAddress({ from: account.address, nonce });
const prepared = {
  network: "Monad Testnet",
  chainId,
  rpcUrl,
  contractName: "CHOG Evolution Demo",
  symbol: "DCHOG",
  contractAddress,
  transactionHash,
  deployer: account.address,
  maxSupply: maxSupply.toString(),
  baseURI,
  deploymentSourceSha256: scriptHash,
  status: "prepared",
  preparedAt: new Date().toISOString(),
};
await mkdir(resolve(root, "deployments"), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`, { mode: 0o644 });

try {
  const sentHash = await rpc("eth_sendRawTransaction", [signed]);
  if (String(sentHash).toLowerCase() !== transactionHash.toLowerCase()) {
    throw new Error("RPC returned a different transaction hash than the signed transaction");
  }
  await save({ ...prepared, status: "submitted", submittedAt: new Date().toISOString() });
  console.log(JSON.stringify({ event: "monad_demo_contract_submitted", transactionHash, contractAddress, chainId }));
} catch (error) {
  // A send timeout can be ambiguous. Persist the locally computed hash and
  // refuse any resend until that exact hash is reconciled against the RPC.
  await save({
    ...prepared,
    status: "send_outcome_unknown",
    lastError: error instanceof Error ? error.message : "unknown send error",
    updatedAt: new Date().toISOString(),
  });
  throw error;
}

let receipt;
for (let attempt = 0; attempt < 30; attempt += 1) {
  receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
  if (receipt) break;
  await new Promise((resolveWait) => setTimeout(resolveWait, 4_000));
}
if (!receipt) {
  await save({ ...prepared, status: "submitted_pending_receipt", updatedAt: new Date().toISOString() });
  throw new Error(`Transaction ${transactionHash} is still pending; do not submit it again`);
}
if (BigInt(receipt.status) !== 1n) {
  await save({
    ...prepared,
    status: "execution_failed",
    blockNumber: receipt.blockNumber,
    updatedAt: new Date().toISOString(),
  });
  throw new Error(`DemoChog deployment reverted in transaction ${transactionHash}`);
}

const code = await rpc("eth_getCode", [contractAddress, "latest"]);
if (code === "0x" || code === "0x0") throw new Error("Deployment receipt succeeded but no code exists at the expected address");
const read = async (functionName) => {
  const data = encodeFunctionData({ abi: artifact.abi, functionName });
  const result = await rpc("eth_call", [{ to: contractAddress, data }, "latest"]);
  return decodeFunctionResult({ abi: artifact.abi, functionName, data: result });
};
const [name, symbol, maxSupplyOnchain, owner] = await Promise.all([
  read("name"),
  read("symbol"),
  read("maxSupply"),
  read("owner"),
]);
if (name !== "CHOG Evolution Demo" || symbol !== "DCHOG" || maxSupplyOnchain !== maxSupply || owner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error("Deployed bytecode readback did not match the expected collection identity and configuration");
}

const verified = {
  ...prepared,
  status: "confirmed_and_verified",
  blockNumber: Number(BigInt(receipt.blockNumber)),
  transactionIndex: Number(BigInt(receipt.transactionIndex)),
  verifiedName: name,
  verifiedSymbol: symbol,
  verifiedMaxSupply: maxSupplyOnchain.toString(),
  verifiedOwner: owner,
  confirmedAt: new Date().toISOString(),
};
await save(verified);
console.log(JSON.stringify({ event: "monad_demo_contract_confirmed", ...verified }));

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  const result = spawnSync(
    "curl",
    ["-sS", "--connect-timeout", "5", "--max-time", "18", "-X", "POST", "-H", "content-type: application/json", "--data-binary", "@-", rpcUrl],
    { input: body, encoding: "utf8", timeout: 20_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`RPC transport failed for ${method}: ${result.error?.message ?? "curl exited nonzero"}`);
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error(`RPC returned malformed JSON for ${method}`);
  }
  if (response.error) throw new Error(`RPC ${method} failed: ${response.error.message ?? "unknown provider error"}`);
  return response.result;
}

async function save(record) {
  await writeFile(manifestPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
