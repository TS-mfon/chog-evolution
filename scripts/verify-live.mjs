import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  hexToString,
  http,
  keccak256,
  parseAbi,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Operator acceptance against real production HTTP and real Monad transactions.
// The signing bridge stays in Node; neither private keys nor signed transactions
// enter the browser. A hash and signed transaction are journaled BEFORE broadcast.
const root = resolve(import.meta.dirname, "..");
const origin = "https://chog-evolution.vercel.app";
const collection = "0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce";
const directory = resolve(root, "artifacts/live");
const journalPath = resolve(directory, "mint-journal.json");
const statePath = resolve(directory, "browser-state.json");
const mintData = encodeFunctionData({
  abi: parseAbi(["function mint()"]),
  functionName: "mint",
});
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});
const key = process.env.MONAD_OWNER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
assert.ok(/^0x[0-9a-f]{64}$/i.test(key ?? ""), "operator private key required");
const account = privateKeyToAccount(key);
assert.equal(
  account.address.toLowerCase(),
  "0xed9edd8586b20524cafa4f568413c504c9b03172",
);
const transport = http(chain.rpcUrls.default.http[0], {
  timeout: 20_000,
  retryCount: 1,
});
const rpc = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport, account });
assert.equal(await rpc.getChainId(), chain.id);
await mkdir(directory, { recursive: true });
let journal;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const save = async () =>
  writeFile(journalPath, JSON.stringify(journal, null, 2) + "\n", {
    mode: 0o600,
  });
if (journal) {
  assert.equal(journal.wallet, account.address);
  assert.equal(journal.collection, collection);
  assert.equal(journal.chainId, chain.id);
  assert.equal(keccak256(journal.signedTransaction), journal.transactionHash);
}
const ready = await fetch(origin + "/api/ready", {
  signal: AbortSignal.timeout(60_000),
});
assert.equal(ready.status, 200);
assert.equal(
  (await ready.json()).schemaVersion,
  3,
  "new release must be deployed before a live mint",
);
const browser = await chromium.launch({ headless: true });
let context;
let page;
const observations = [];
try {
  let storageState;
  try {
    storageState = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  context = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.exposeFunction(
    "chogOperatorRequest",
    async ({ method, params = [] }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [account.address];
      if (method === "eth_chainId") return "0x279f";
      if (
        method === "wallet_switchEthereumChain" ||
        method === "wallet_addEthereumChain"
      ) {
        assert.equal(params[0].chainId, "0x279f");
        return null;
      }
      if (method === "personal_sign") {
        assert.equal(params[1].toLowerCase(), account.address.toLowerCase());
        const message = params[0].startsWith("0x")
          ? hexToString(params[0])
          : params[0];
        assert.ok(message.startsWith("CHOG Evolution Sign In\n"));
        assert.ok(message.includes("\nURI: " + origin + "\n"));
        assert.ok(message.includes("\nChain ID: 10143\n"));
        return account.signMessage({ message });
      }
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
        assert.equal(tx.to.toLowerCase(), collection.toLowerCase());
        assert.equal(tx.data, mintData);
        assert.equal(BigInt(tx.value), 0n);
        assert.equal(Number(BigInt(tx.chainId)), chain.id);
        if (!journal) {
          const prepared = await wallet.prepareTransactionRequest({
            to: collection,
            data: mintData,
            value: 0n,
          });
          const signedTransaction = await wallet.signTransaction(prepared);
          journal = {
            wallet: account.address,
            collection,
            chainId: chain.id,
            nonce: prepared.nonce,
            signedTransaction,
            transactionHash: keccak256(signedTransaction),
            status: "prepared",
            preparedAt: new Date().toISOString(),
          };
          await writeFile(
            journalPath,
            JSON.stringify(journal, null, 2) + "\n",
            { flag: "wx", mode: 0o600 },
          );
        }
        // If a response was lost, reconcile this SAME hash; never prepare a second mint.
        let existing;
        try {
          existing = await rpc.getTransaction({
            hash: journal.transactionHash,
          });
        } catch (error) {
          if (error.name !== "TransactionNotFoundError") throw error;
        }
        if (!existing) {
          assert.equal(
            await rpc.getTransactionCount({
              address: account.address,
              blockTag: "pending",
            }),
            journal.nonce,
            "nonce changed: reconcile before broadcasting",
          );
          const hash = await wallet.sendRawTransaction({
            serializedTransaction: journal.signedTransaction,
          });
          assert.equal(hash, journal.transactionHash);
          journal.status = "submitted";
          await save();
        }
        return journal.transactionHash;
      }
      if (method === "eth_getTransactionReceipt") {
        assert.equal(params[0], journal?.transactionHash);
        return rpc.request({ method, params });
      }
      throw new Error("Unexpected operator wallet request: " + method);
    },
  );
  await context.addInitScript({
    content: `(() => { const listeners = {}; window.ethereum = { request: args => window.chogOperatorRequest(args), on: (event, fn) => (listeners[event] ??= []).push(fn), removeListener: (event, fn) => { listeners[event] = (listeners[event] || []).filter(item => item !== fn); } }; })();`,
  });
  page = await context.newPage();
  page.on("response", (response) => {
    if (response.url().startsWith(origin + "/api/"))
      observations.push({
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  await page.goto(origin + "/mint", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  const confirm = page.waitForResponse(
    (response) =>
      response.url() === origin + "/api/v1/mints/confirm" &&
      response.status() === 200,
    { timeout: 180_000 },
  );
  await page.locator(".mint-main-button").click({ timeout: 60_000 });
  const result = await (await confirm).json();
  assert.equal(result.item.nft.mode, "demo");
  assert.equal(
    result.item.nft.collectionAddress.toLowerCase(),
    collection.toLowerCase(),
  );
  assert.ok(result.claim?.id, "real mint must queue a claim");
  journal.profileId = result.item.id;
  journal.claimId = result.claim.id;
  journal.tokenId = result.item.nft.tokenId;
  journal.status = "confirmed_and_registered";
  await save();
  await page.goto(origin + "/profile", { waitUntil: "domcontentloaded" });
  await page.getByRole("progressbar").waitFor({ timeout: 60_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("progressbar").waitFor({ timeout: 60_000 });
  await page.screenshot({
    path: resolve(directory, "mint-profile.png"),
    fullPage: true,
  });
  await context.storageState({ path: statePath });
  await chmod(statePath, 0o600);
  await writeFile(
    resolve(directory, "mint-report.json"),
    JSON.stringify(
      {
        wallet: account.address,
        chainId: chain.id,
        collection,
        transactionHash: journal.transactionHash,
        tokenId: journal.tokenId,
        profileId: journal.profileId,
        claimId: journal.claimId,
        refreshed: true,
        liveProviderProof: true,
        observations,
      },
      null,
      2,
    ),
  );
  console.log(
    "LIVE MINT VERIFIED " +
      JSON.stringify({
        transactionHash: journal.transactionHash,
        profileId: journal.profileId,
        claimId: journal.claimId,
        tokenId: journal.tokenId,
      }),
  );
} catch (error) {
  await page?.screenshot({ path: resolve(directory, "mint-failure.png"), fullPage: true }).catch(() => {});
  await writeFile(resolve(directory, "mint-failure.json"), JSON.stringify({ error: error.name, observations, visibleText: await page?.locator("body").innerText().catch(() => "unavailable") }, null, 2));
  throw new Error("Live mint acceptance failed; inspect ignored mint-failure.json", { cause: { name: error.name } });
} finally {
  if (context) {
    await context.storageState({ path: statePath }).catch(() => {});
    await chmod(statePath, 0o600).catch(() => {});
  }
  await browser.close();
}
