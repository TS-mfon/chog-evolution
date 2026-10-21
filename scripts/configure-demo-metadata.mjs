import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Default is read-only. --apply is an explicit owner transaction on the existing
// demo collection. The journal prevents an uncertain send from being repeated.
const root = resolve(import.meta.dirname, "..");
const journalPath = resolve(root, "deployments/demo-metadata.json");
const abi = parseAbi([
  "function owner() view returns (address)",
  "function symbol() view returns (string)",
  "function nextTokenId() view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
  "function setBaseURI(string newBaseURI)",
]);

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: npm run metadata:check [-- --apply]\nChecks the existing demo collection by default. --apply sets its public metadata base URI with MONAD_OWNER_PRIVATE_KEY; no new contract is deployed.",
    );
    return;
  }
  if (
    process.argv.slice(2).some((arg) => !["--apply", "--check"].includes(arg))
  )
    throw new Error("Unknown option; use --help.");
  const deployment = JSON.parse(
    await readFile(resolve(root, "deployments/monad-testnet.json"), "utf8"),
  );
  const address =
    process.env.DEMO_COLLECTION_ADDRESS || deployment.contractAddress;
  if (
    address?.toLowerCase() !== deployment.contractAddress.toLowerCase() ||
    deployment.chainId !== 10143
  )
    throw new Error(
      "Demo collection must match the recorded Monad Testnet deployment.",
    );
  const origin =
    process.env.APP_ORIGIN?.trim() || "https://chog-evolution.vercel.app";
  const apiBase = (
    process.env.PUBLIC_API_URL?.trim() ||
    `${origin.replace(/\/$/, "")}${process.env.PUBLIC_API_PATH ?? "/api"}`
  ).replace(/\/$/, "");
  const base = new URL(`${apiBase}/v1/metadata/demo/`);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error(
      "Metadata needs a public HTTPS API base without credentials or query parameters.",
    );
  const rpcUrl =
    process.env.MONAD_TESTNET_RPC_URL ||
    deployment.rpcUrl ||
    "https://testnet-rpc.monad.xyz";
  const chain = defineChain({
    id: 10143,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = http(rpcUrl, { timeout: 15_000, retryCount: 1 });
  const client = createPublicClient({ chain, transport });
  if ((await client.getChainId()) !== 10143)
    throw new Error("RPC chain must be Monad Testnet (10143).");
  const [owner, symbol, nextTokenId] = await Promise.all([
    client.readContract({ address, abi, functionName: "owner" }),
    client.readContract({ address, abi, functionName: "symbol" }),
    client.readContract({ address, abi, functionName: "nextTokenId" }),
  ]);
  if (symbol !== "DCHOG")
    throw new Error("Configured collection is not CHOG Evolution Demo.");
  const currentTokenURI =
    nextTokenId > 1n
      ? await client.readContract({
          address,
          abi,
          functionName: "tokenURI",
          args: [1n],
        })
      : null;
  const alreadyConfigured = currentTokenURI === `${base.href}1`;
  console.log(
    JSON.stringify(
      {
        chainId: 10143,
        collection: address,
        owner,
        metadataBase: base.href,
        currentTokenURI,
        alreadyConfigured,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--apply") || alreadyConfigured) return;

  // Verify the new endpoint is deployed before submitting its URL on chain.
  const metadataResponse = await fetch(`${base.href}1`, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const metadata = await metadataResponse.json();
  if (
    nextTokenId > 1n
      ? !metadataResponse.ok ||
        typeof metadata?.name !== "string" ||
        typeof metadata?.image !== "string"
      : metadataResponse.status !== 404 ||
        metadata?.error !== "demo_token_not_found"
  )
    throw new Error(
      "Deploy and verify the demo metadata API before applying its onchain base URI.",
    );

  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (journal) {
    if (
      journal.collection?.toLowerCase() !== address.toLowerCase() ||
      journal.metadataBase !== base.href
    )
      throw new Error(
        "An existing metadata journal belongs to another target; reconcile it before configuring a different URI.",
      );
    if (!journal.transactionHash)
      throw new Error(
        "A previous send may have been broadcast without a saved hash. Reconcile the journal with the owner's wallet activity before any retry.",
      );
    const [receipt, tx] = await Promise.all([
      client.getTransactionReceipt({ hash: journal.transactionHash }),
      client.getTransaction({ hash: journal.transactionHash }),
    ]);
    const expectedInput = encodeFunctionData({
      abi,
      functionName: "setBaseURI",
      args: [base.href],
    });
    if (
      receipt.status !== "success" ||
      tx.to?.toLowerCase() !== address.toLowerCase() ||
      tx.from.toLowerCase() !== owner.toLowerCase() ||
      tx.input !== expectedInput
    )
      throw new Error(
        "The journaled metadata transaction does not confirm this owner update. Reconcile it before another attempt.",
      );
    await writeFile(
      journalPath,
      `${JSON.stringify({ ...journal, status: "confirmed", blockNumber: receipt.blockNumber.toString() }, null, 2)}\n`,
    );
    console.log(`Metadata configuration confirmed: ${journal.transactionHash}`);
    return;
  }
  const key = process.env.MONAD_OWNER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-f]{64}$/i.test(key))
    throw new Error(
      "Set MONAD_OWNER_PRIVATE_KEY in the server environment to apply this owner transaction.",
    );
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== owner.toLowerCase())
    throw new Error(
      "The configured signer does not own the deployed demo collection.",
    );
  const nonce = await client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const { request } = await client.simulateContract({
    address,
    abi,
    functionName: "setBaseURI",
    args: [base.href],
    account,
    nonce,
  });
  const prepared = {
    chainId: 10143,
    collection: address,
    metadataBase: base.href,
    owner,
    nonce,
    status: "broadcasting",
    preparedAt: new Date().toISOString(),
  };
  await writeFile(journalPath, `${JSON.stringify(prepared, null, 2)}\n`, {
    flag: "wx",
  });
  const wallet = createWalletClient({ chain, transport, account });
  const transactionHash = await wallet.writeContract(request);
  const submitted = { ...prepared, status: "submitted", transactionHash };
  await writeFile(journalPath, `${JSON.stringify(submitted, null, 2)}\n`);
  const receipt = await client.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 4,
    timeout: 120_000,
  });
  if (receipt.status !== "success")
    throw new Error(
      "The metadata transaction reverted; its reference remains in the journal.",
    );
  await writeFile(
    journalPath,
    `${JSON.stringify({ ...submitted, status: "confirmed", blockNumber: receipt.blockNumber.toString() }, null, 2)}\n`,
  );
  console.log(`Metadata configuration confirmed: ${transactionHash}`);
}

try {
  await main();
} catch (error) {
  // Never print provider URLs, environment values, private keys or signed payloads.
  console.error(
    error?.shortMessage ||
      (error?.name === "Error"
        ? error.message
        : "Metadata configuration failed. Check network access and server configuration."),
  );
  process.exitCode = 1;
}
