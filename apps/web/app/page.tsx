"use client";

import { useCallback, useEffect, useState } from "react";
import { artDataUri, composeDemoChog } from "@chog/art-composition";

type Quest = {
  id?: string;
  slug?: string;
  title?: string;
  name?: string;
  description?: string;
  detail?: string;
  status?: string;
  evidence?: string;
  xp?: number;
  xpReward?: number;
  kind?: string;
  allowedEvidenceHosts?: string[];
};
type Scenario = {
  id: string;
  outcome: "accepted" | "rejected" | "pending";
  simulated: true;
  profile: { xp: number; level: number; stage: string; version: number };
  claim: { status: "accepted" | "rejected" | "verifying" };
  evolution: {
    status: "simulated" | "not_awarded" | "pending";
    xpAward: number;
  };
};
type Profile = {
  id: string;
  nft: {
    mode: "demo" | "original_companion";
    chainId: number;
    collectionAddress: string;
    tokenId: string;
  };
  displayName: string;
  xp: number;
  level: number;
  stage: string;
  traits: string[];
  version: number;
  artworkUrl?: string;
};
type Claim = {
  id: string;
  status: string;
  questSlug?: string;
  xpAward?: number;
  outcome?: string;
  explanation?: string;
  createdAt?: string;
};
type XProfileLink = { username: string; verifiedAt: string };
type ScanResult = {
  id: string;
  status: string;
  candidateOnly: true;
  events: {
    targetName: string;
    questSlug?: string | null;
    txHash: string;
    blockNumber: string;
    transactionUrl?: string | null;
  }[];
  errorCode?: string | null;
};
type RpcLog = { address: string; topics?: string[] };
type RpcReceipt = {
  status?: string;
  transactionHash?: string;
  logs?: RpcLog[];
};
type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
};
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "/api"
).replace(/\/$/, "");
const SIMULATION_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION === "true";
const DEMO_COLLECTION = process.env.NEXT_PUBLIC_DEMO_COLLECTION_ADDRESS || "";
const MONAD_TESTNET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_MONAD_TESTNET_CHAIN_ID || 10143,
);
const MONAD_TESTNET_CHAIN_HEX = `0x${MONAD_TESTNET_CHAIN_ID.toString(16)}`;
const MONAD_TESTNET_RPC =
  process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL ||
  "https://testnet-rpc.monad.xyz";
const MONAD_TESTNET_EXPLORER =
  process.env.NEXT_PUBLIC_MONAD_TESTNET_EXPLORER_URL || "";
const ORIGINAL_COLLECTION =
  process.env.NEXT_PUBLIC_ORIGINAL_CHOG_COLLECTION_ADDRESS || "";
const MONAD_MAINNET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_MONAD_MAINNET_CHAIN_ID || 143,
);
const MONAD_MAINNET_CHAIN_HEX = `0x${MONAD_MAINNET_CHAIN_ID.toString(16)}`;
const MONAD_MAINNET_RPC =
  process.env.NEXT_PUBLIC_MONAD_MAINNET_RPC_URL || "https://rpc.monad.xyz";

export default function Home() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("");
  const [walletMessage, setWalletMessage] = useState("Wallet not connected");
  const [authenticatedWallet, setAuthenticatedWallet] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileMessage, setProfileMessage] = useState("");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [questState, setQuestState] = useState("Loading quest board…");
  const [claimEvidence, setClaimEvidence] = useState<
    Record<string, { url: string; text: string; txHash: string }>
  >({});
  const [claimItems, setClaimItems] = useState<Claim[]>([]);
  const [claimBusy, setClaimBusy] = useState("");
  const [claimMessage, setClaimMessage] = useState("");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [scenarioState, setScenarioState] = useState("");
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [mode, setMode] = useState<"demo" | "original">("demo");
  const [originalTokenId, setOriginalTokenId] = useState("");
  const [mintBusy, setMintBusy] = useState(false);
  const [mintMessage, setMintMessage] = useState("");
  const [mintedToken, setMintedToken] = useState<{
    tokenId: string;
    transactionHash: string;
  } | null>(null);
  const [xUsername, setXUsername] = useState("");
  const [xBioCode, setXBioCode] = useState("");
  const [xProfileLink, setXProfileLink] = useState<XProfileLink | null>(null);
  const [xLinkMessage, setXLinkMessage] = useState("");
  const [xLinkBusy, setXLinkBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanMessage, setScanMessage] = useState("");

  const refreshWallet = useCallback(async () => {
    if (!window.ethereum) {
      setWalletMessage("No browser wallet provider found");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_accounts",
      })) as string[];
      const chainId = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      setAddress(accounts?.[0] || "");
      setChain(chainId || "");
      setWalletMessage(
        accounts?.[0] ? "Wallet connected" : "Wallet available · not connected",
      );
      if (
        accounts?.[0] &&
        authenticatedWallet &&
        accounts[0].toLowerCase() !== authenticatedWallet.toLowerCase()
      )
        setAuthenticatedWallet("");
    } catch {
      setWalletMessage("Could not read wallet state");
    }
  }, [authenticatedWallet]);

  useEffect(() => {
    void refreshWallet();
    void fetch(`${API_BASE}/v1/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (response.ok) {
          const session = (await response.json()) as { wallet?: string };
          const accounts = window.ethereum
            ? ((await window.ethereum.request({
                method: "eth_accounts",
              })) as string[])
            : [];
          if (
            session.wallet &&
            accounts.some(
              (account) =>
                account.toLowerCase() === session.wallet!.toLowerCase(),
            )
          )
            setAuthenticatedWallet(session.wallet);
        }
      })
      .catch(() => undefined);
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/quests`, {
          headers: { accept: "application/json" },
        });
        if (!response.ok)
          throw new Error(`Quest service returned ${response.status}`);
        const body = (await response.json()) as
          { items?: Quest[]; quests?: Quest[] } | Quest[];
        const rows = Array.isArray(body) ? body : (body.items ?? body.quests);
        if (!Array.isArray(rows))
          throw new Error("Quest service returned an unexpected response");
        setQuests(rows);
        setQuestState(rows.length ? "" : "No quests are available yet.");
      } catch (error) {
        setQuestState(
          error instanceof Error
            ? error.message
            : "Quest service is unavailable.",
        );
      }
    };
    void load();
    if (authenticatedWallet) {
      void Promise.all([
        fetch(`${API_BASE}/v1/profiles`, { credentials: "include" }).then(
          async (response) => {
            if (!response.ok)
              throw new Error(`Profile service returned ${response.status}`);
            const body = (await response.json()) as { items?: Profile[] };
            setProfiles(body.items ?? []);
            setProfileMessage("");
          },
        ),
        fetch(`${API_BASE}/v1/claims`, { credentials: "include" }).then(
          async (response) => {
            if (response.ok) {
              const body = (await response.json()) as { items?: Claim[] };
              setClaimItems(body.items ?? []);
            }
          },
        ),
      ]).catch((error: unknown) =>
        setProfileMessage(
          error instanceof Error ? error.message : "Profiles are unavailable.",
        ),
      );
    } else {
      setProfiles([]);
      setClaimItems([]);
    }
    const changed = () => {
      void refreshWallet();
    };
    window.ethereum?.on?.("accountsChanged", changed);
    window.ethereum?.on?.("chainChanged", changed);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", changed);
      window.ethereum?.removeListener?.("chainChanged", changed);
    };
  }, [refreshWallet, authenticatedWallet]);

  useEffect(() => {
    if (!authenticatedWallet) {
      setXProfileLink(null);
      setXBioCode("");
      return;
    }
    void fetch(`${API_BASE}/v1/social/x`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { item?: XProfileLink | null };
        setXProfileLink(body.item ?? null);
      })
      .catch(() => undefined);
  }, [authenticatedWallet]);

  async function connectWallet() {
    if (!window.ethereum) {
      setWalletMessage("No browser wallet provider found");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const account = accounts?.[0];
      if (!account) throw new Error("No wallet account was selected");
      const chainId = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      setAddress(account);
      setChain(chainId);
      setWalletMessage("Wallet connected · verifying signed session…");
      const nonceResponse = await fetch(`${API_BASE}/v1/auth/nonce`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: account,
          chainId: Number.parseInt(chainId, 16),
        }),
      });
      const challenge = (await nonceResponse.json()) as {
        message?: string;
        error?: string;
      };
      if (!nonceResponse.ok || !challenge.message)
        throw new Error(
          challenge.error || "Wallet authentication is unavailable",
        );
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, account],
      })) as string;
      const verifyResponse = await fetch(`${API_BASE}/v1/auth/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: challenge.message, signature }),
      });
      const verified = (await verifyResponse.json()) as {
        wallet?: string;
        error?: string;
      };
      if (!verifyResponse.ok || !verified.wallet)
        throw new Error(
          verified.error || "Wallet signature could not be verified",
        );
      setAuthenticatedWallet(verified.wallet);
      setWalletMessage("Wallet connected · server session verified");
    } catch (error) {
      setAuthenticatedWallet("");
      setWalletMessage(
        error instanceof Error
          ? `Wallet connected · ${error.message}`
          : "Wallet connection or signature failed",
      );
    }
  }

  async function signOut() {
    let revoked = false;
    try {
      const response = await fetch(`${API_BASE}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      revoked = response.ok;
    } catch {
      /* Clear the visible session even if the API is unreachable. */
    }
    setAuthenticatedWallet("");
    setProfiles([]);
    setClaimItems([]);
    setWalletMessage(
      address
        ? revoked
          ? "Wallet connected · signed out"
          : "Wallet connected · local sign out; server revocation unavailable"
        : "Wallet not connected",
    );
  }

  async function switchToMonadTestnet() {
    if (!window.ethereum) {
      setWalletMessage("No browser wallet provider found");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_TESTNET_CHAIN_HEX }],
      });
      await refreshWallet();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: number }).code
          : undefined;
      if (code !== 4902) {
        setWalletMessage("Network switch was rejected or failed");
        return;
      }
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: MONAD_TESTNET_CHAIN_HEX,
              chainName: "Monad Testnet",
              nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
              rpcUrls: [MONAD_TESTNET_RPC],
              ...(MONAD_TESTNET_EXPLORER
                ? { blockExplorerUrls: [MONAD_TESTNET_EXPLORER] }
                : {}),
            },
          ],
        });
        await refreshWallet();
      } catch {
        setWalletMessage("Could not add Monad Testnet to this wallet");
      }
    }
  }

  async function switchToMonadMainnet() {
    if (!window.ethereum) {
      setWalletMessage("No browser wallet provider found");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_MAINNET_CHAIN_HEX }],
      });
      await refreshWallet();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: number }).code
          : undefined;
      if (code !== 4902) {
        setWalletMessage("Network switch was rejected or failed");
        return;
      }
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: MONAD_MAINNET_CHAIN_HEX,
              chainName: "Monad",
              nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
              rpcUrls: [MONAD_MAINNET_RPC],
            },
          ],
        });
        await refreshWallet();
      } catch {
        setWalletMessage("Could not add Monad Mainnet to this wallet");
      }
    }
  }

  async function registerOriginalChog() {
    if (
      !ORIGINAL_COLLECTION ||
      !/^0x[0-9a-fA-F]{40}$/.test(ORIGINAL_COLLECTION)
    ) {
      setProfileMessage(
        "Original collection verification is unavailable until the official address is configured.",
      );
      return;
    }
    if (!/^(0|[1-9][0-9]{0,77})$/.test(originalTokenId)) {
      setProfileMessage("Enter a valid original token ID.");
      return;
    }
    if (
      !address ||
      authenticatedWallet.toLowerCase() !== address.toLowerCase()
    ) {
      setProfileMessage(
        "Connect and sign in with the wallet that owns this original Chog.",
      );
      return;
    }
    if (chain.toLowerCase() !== MONAD_MAINNET_CHAIN_HEX.toLowerCase()) {
      setProfileMessage("Switch to Monad Mainnet before verifying ownership.");
      return;
    }
    setProfileMessage(
      "Checking original collection ownership through the configured RPC…",
    );
    try {
      const response = await fetch(`${API_BASE}/v1/profiles/register`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "original_companion",
          chainId: MONAD_MAINNET_CHAIN_ID,
          collectionAddress: ORIGINAL_COLLECTION,
          tokenId: originalTokenId,
        }),
      });
      const result = (await response.json()) as {
        item?: Profile;
        error?: string;
      };
      if (!response.ok || !result.item)
        throw new Error(
          result.error || `Profile service returned ${response.status}`,
        );
      setProfiles((current) => [
        result.item!,
        ...current.filter((profile) => profile.id !== result.item!.id),
      ]);
      setProfileMessage(
        `Original Chog #${originalTokenId} ownership verified. Evolution is a companion profile; original metadata stays unchanged.`,
      );
    } catch (error) {
      setProfileMessage(
        error instanceof Error
          ? error.message
          : "Original Chog verification failed.",
      );
    }
  }

  async function submitClaim(quest: Quest) {
    const profile = profiles.find(
      (item) =>
        item.nft.mode === (mode === "demo" ? "demo" : "original_companion"),
    );
    const evidence = claimEvidence[quest.id || ""];
    if (
      !authenticatedWallet ||
      !profile ||
      !quest.id ||
      (quest.kind === "demo_mint" &&
        !/^0x[0-9a-fA-F]{64}$/.test(evidence?.txHash ?? ""))
    ) {
      setClaimMessage(
        quest.kind === "demo_mint"
          ? "Sign in, select a registered demo Chog, and provide the mint transaction hash."
          : "Sign in, register a Chog, and verify the wallet's public X bio before submitting this quest.",
      );
      return;
    }
    setClaimBusy(quest.id);
    setClaimMessage("Saving claim and evidence…");
    try {
      const response = await fetch(`${API_BASE}/v1/claims`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          profileId: profile.id,
          questId: quest.id,
          ...(quest.kind === "demo_mint"
            ? { transactionHash: evidence!.txHash }
            : {}),
        }),
      });
      const result = (await response.json()) as {
        item?: Claim;
        error?: string;
        duplicate?: boolean;
      };
      if (!response.ok || !result.item)
        throw new Error(
          result.error || `Claim service returned ${response.status}`,
        );
      setClaimItems((items) => [
        result.item!,
        ...items.filter((item) => item.id !== result.item!.id),
      ]);
      setClaimMessage(
        `Claim ${result.item.id} saved as ${result.item.status}. No XP is awarded until adjudication is finalized.`,
      );
      void (async () => {
        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          try {
            const statusResponse = await fetch(
              `${API_BASE}/v1/claims/${result.item!.id}`,
              { credentials: "include" },
            );
            if (!statusResponse.ok) continue;
            const body = (await statusResponse.json()) as { item?: Claim };
            if (!body.item) continue;
            setClaimItems((items) => [
              body.item!,
              ...items.filter((item) => item.id !== body.item!.id),
            ]);
            if (
              body.item.status === "accepted" ||
              body.item.status === "rejected" ||
              body.item.status === "needs_review" ||
              body.item.status === "source_unavailable" ||
              body.item.status === "unresolved"
            )
              break;
          } catch {
            /* Claim remains readable from the history list on refresh. */
          }
        }
      })();
    } catch (error) {
      setClaimMessage(
        error instanceof Error ? error.message : "Claim submission failed.",
      );
    } finally {
      setClaimBusy("");
    }
  }

  async function createXBioChallenge() {
    setXLinkBusy(true);
    setXLinkMessage("Creating a wallet-bound bio code…");
    try {
      const response = await fetch(`${API_BASE}/v1/social/x/challenge`, {
        method: "POST",
        credentials: "include",
      });
      const result = (await response.json()) as {
        bioCode?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !result.bioCode)
        throw new Error(result.error || "Could not create the X bio challenge");
      setXBioCode(result.bioCode);
      setXLinkMessage(
        `Add this exact code to your public X bio. It expires ${new Date(result.expiresAt!).toLocaleTimeString()}.`,
      );
    } catch (error) {
      setXLinkMessage(
        error instanceof Error
          ? error.message
          : "X profile linking is unavailable.",
      );
    } finally {
      setXLinkBusy(false);
    }
  }

  async function verifyXBio() {
    setXLinkBusy(true);
    setXLinkMessage("Checking the public X bio through X’s API…");
    try {
      const response = await fetch(`${API_BASE}/v1/social/x/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: xUsername }),
      });
      const result = (await response.json()) as {
        item?: XProfileLink;
        error?: string;
      };
      if (!response.ok || !result.item)
        throw new Error(result.error || "X bio verification failed");
      setXProfileLink(result.item);
      setXBioCode("");
      setXLinkMessage(`@${result.item.username} linked to the signed wallet.`);
    } catch (error) {
      setXLinkMessage(
        error instanceof Error ? error.message : "X bio verification failed.",
      );
    } finally {
      setXLinkBusy(false);
    }
  }

  async function unlinkXProfile() {
    setXLinkBusy(true);
    setXLinkMessage("Removing the wallet link…");
    try {
      const response = await fetch(`${API_BASE}/v1/social/x`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json()) as {
        linked?: boolean;
        error?: string;
      };
      if (!response.ok || result.linked !== false)
        throw new Error(result.error || "Could not unlink X profile");
      setXProfileLink(null);
      setXBioCode("");
      setXUsername("");
      setXLinkMessage("X profile unlinked from this wallet.");
    } catch (error) {
      setXLinkMessage(
        error instanceof Error ? error.message : "X profile unlink failed.",
      );
    } finally {
      setXLinkBusy(false);
    }
  }

  async function rescanEcosystem() {
    const profile = profiles.find(
      (item) =>
        item.nft.mode === (mode === "demo" ? "demo" : "original_companion"),
    );
    if (!profile || !authenticatedWallet) {
      setScanMessage(
        "Connect and sign in, then register a Chog profile before scanning.",
      );
      return;
    }
    setScanBusy(true);
    setScanMessage(
      "Scanning configured Monad events and saving the block checkpoint…",
    );
    setScanResult(null);
    try {
      const response = await fetch(`${API_BASE}/v1/scans`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      const result = (await response.json()) as {
        item?: ScanResult;
        error?: string;
        next?: string;
      };
      if (!response.ok && response.status !== 202)
        throw new Error(result.error || `Scan returned ${response.status}`);
      if (!result.item)
        throw new Error(
          result.error || "Scan response did not include a saved result",
        );
      setScanResult(result.item);
      setScanMessage(
        result.item.status === "complete"
          ? `Scan complete · ${result.item.events.length} wallet-linked log candidate(s).`
          : `Scan checkpoint saved · ${result.item.events.length} candidate(s) · run again to continue.`,
      );
    } catch (error) {
      setScanMessage(
        error instanceof Error
          ? error.message
          : "Ecosystem scan is unavailable.",
      );
    } finally {
      setScanBusy(false);
    }
  }

  async function mintDemoChog() {
    if (!DEMO_COLLECTION || !/^0x[0-9a-fA-F]{40}$/.test(DEMO_COLLECTION)) {
      setMintMessage(
        "Mint is unavailable until the deployed demo collection address is configured.",
      );
      return;
    }
    if (!window.ethereum || !address) {
      setMintMessage("Connect a wallet before minting.");
      return;
    }
    if (chain.toLowerCase() !== MONAD_TESTNET_CHAIN_HEX.toLowerCase()) {
      setMintMessage("Switch to Monad Testnet before minting.");
      return;
    }
    setMintBusy(true);
    setMintMessage("Confirm the demo mint transaction in your wallet.");
    setMintedToken(null);
    try {
      const transactionHash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: DEMO_COLLECTION, data: "0x1249c58b" }],
      })) as string;
      setMintMessage(
        `Transaction submitted: ${transactionHash}. Waiting for the Monad receipt…`,
      );
      let receipt: RpcReceipt | null = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        const result = (await window.ethereum.request({
          method: "eth_getTransactionReceipt",
          params: [transactionHash],
        })) as RpcReceipt | null;
        if (result) {
          receipt = result;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      if (!receipt)
        throw new Error(
          "The transaction is still pending. Check the wallet and try refreshing this page.",
        );
      if (receipt.status !== "0x1")
        throw new Error("The demo mint transaction reverted.");
      const recipient = `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
      const mintLog = receipt.logs?.find(
        (log) =>
          log.address.toLowerCase() === DEMO_COLLECTION.toLowerCase() &&
          log.topics?.[0]?.toLowerCase() ===
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
          log.topics?.[1] === `0x${"0".repeat(64)}` &&
          log.topics?.[2]?.toLowerCase() === recipient &&
          Boolean(log.topics?.[3]),
      );
      if (!mintLog?.topics?.[3])
        throw new Error(
          "The mint receipt succeeded, but its demo token ID could not be read. Keep the transaction hash for support.",
        );
      const tokenId = BigInt(mintLog.topics[3]).toString();
      setMintedToken({ tokenId, transactionHash });
      const registration = await fetch(`${API_BASE}/v1/profiles/register`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "demo",
          chainId: MONAD_TESTNET_CHAIN_ID,
          collectionAddress: DEMO_COLLECTION,
          tokenId,
        }),
      });
      const registrationBody = (await registration.json()) as {
        item?: Profile;
        error?: string;
      };
      if (!registration.ok || !registrationBody.item) {
        setMintMessage(
          `Demo Chog #${tokenId} was minted onchain, but profile registration failed: ${registrationBody.error || "service unavailable"}. Transaction: ${transactionHash}`,
        );
        return;
      }
      setProfiles((current) => [
        registrationBody.item!,
        ...current.filter(
          (profile) => profile.id !== registrationBody.item!.id,
        ),
      ]);
      setMintMessage(
        `Demo Chog #${tokenId} minted and registered to the verified wallet. This is not an original Chog.`,
      );
    } catch (error) {
      setMintMessage(
        error instanceof Error ? error.message : "Demo mint failed.",
      );
    } finally {
      setMintBusy(false);
    }
  }

  async function runScenario(outcome: "accepted" | "rejected" | "pending") {
    if (!SIMULATION_ENABLED) return;
    setScenarioBusy(true);
    setScenarioState(
      "LOCAL SIMULATION · Submitting a simulated judge scenario…",
    );
    setScenario(null);
    const key =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const response = await fetch(`${API_BASE}/v1/dev/scenarios`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ outcome }),
      });
      if (!response.ok)
        throw new Error(`Scenario API returned ${response.status}`);
      const result = (await response.json()) as Scenario;
      if (!result.id)
        throw new Error("Scenario response did not include an id");
      setScenario(result);
      setScenarioState(
        result.outcome === "accepted"
          ? `LOCAL SIMULATION · Scenario accepted; simulated +${result.evolution.xpAward} XP. No production profile changed.`
          : result.outcome === "rejected"
            ? "LOCAL SIMULATION · Scenario rejected; no XP was awarded."
            : "LOCAL SIMULATION · Scenario remains pending; no XP was awarded.",
      );
    } catch (error) {
      setScenarioState(
        `LOCAL SIMULATION · ${error instanceof Error ? error.message : "Simulation service is unavailable."}`,
      );
    } finally {
      setScenarioBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#home">
          <span className="brand-mark">C</span>
          <span>
            CHOG<span className="brand-light"> / EVOLUTION</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#lab">Evolution Lab</a>
          <a href="#quests">Quest board</a>
          <a href="#history">History</a>
        </nav>
        <div className="wallet">
          <span className="wallet-state">
            {walletMessage}
            {chain &&
              ` · ${chain.toLowerCase() === MONAD_TESTNET_CHAIN_HEX.toLowerCase() ? "Monad testnet" : `chain ${chain}`}`}
          </span>
          <button className="connect" type="button" onClick={connectWallet}>
            {address
              ? `${address.slice(0, 6)}…${address.slice(-4)}`
              : "Connect wallet"}
            <span>↗</span>
          </button>
          {authenticatedWallet && (
            <button
              className="sign-out"
              type="button"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <section className="intro" id="home">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> MONAD TESTNET{" "}
            <span className="divider">/</span> EVOLUTION PASSPORT
          </div>
          <h1>
            Every move leaves
            <br />
            <em>a mark.</em>
          </h1>
          <p className="lede">
            Build a history of participation with your Chog. Start in the
            clearly separate demo collection, or view an original Chog when
            connected.
          </p>
          <div
            className="mode-switch"
            role="group"
            aria-label="Companion collection mode"
          >
            <button
              className={mode === "demo" ? "selected" : ""}
              onClick={() => setMode("demo")}
            >
              Demo companion
            </button>
            <button
              className={mode === "original" ? "selected" : ""}
              onClick={() => setMode("original")}
            >
              Original companion
            </button>
          </div>
          <div className="mode-note">
            {mode === "demo"
              ? "Demo collection · separate from official Chog ownership and metadata."
              : "Original collection · verified ownership creates a companion profile only. Original collection metadata is not modified."}
          </div>
          {mode === "original" && (
            <div className="original-register">
              <label htmlFor="original-token-id">Original Chog token ID</label>
              <input
                id="original-token-id"
                inputMode="numeric"
                value={originalTokenId}
                onChange={(event) => setOriginalTokenId(event.target.value)}
                placeholder="Enter token ID"
              />
              <p className="subtle">
                Collection:{" "}
                {ORIGINAL_COLLECTION
                  ? `${ORIGINAL_COLLECTION.slice(0, 8)}…${ORIGINAL_COLLECTION.slice(-4)}`
                  : "Official collection address not configured"}
              </p>
            </div>
          )}
          <div className="actions">
            {mode === "demo" ? (
              <button
                className="primary"
                type="button"
                onClick={() => void mintDemoChog()}
                disabled={
                  !DEMO_COLLECTION ||
                  !address ||
                  authenticatedWallet.toLowerCase() !== address.toLowerCase() ||
                  chain.toLowerCase() !==
                    MONAD_TESTNET_CHAIN_HEX.toLowerCase() ||
                  mintBusy
                }
              >
                {mintBusy ? "Minting…" : "Mint demo Chog"}
                <span>↗</span>
              </button>
            ) : (
              <button
                className="primary"
                type="button"
                onClick={() => void registerOriginalChog()}
                disabled={
                  !ORIGINAL_COLLECTION ||
                  !originalTokenId ||
                  !address ||
                  authenticatedWallet.toLowerCase() !== address.toLowerCase() ||
                  chain.toLowerCase() !== MONAD_MAINNET_CHAIN_HEX.toLowerCase()
                }
              >
                Verify and add companion
              </button>
            )}
            {mode === "demo" &&
              chain &&
              chain.toLowerCase() !== MONAD_TESTNET_CHAIN_HEX.toLowerCase() && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void switchToMonadTestnet()}
                >
                  Switch to Monad Testnet →
                </button>
              )}
            {mode === "original" &&
              chain &&
              chain.toLowerCase() !== MONAD_MAINNET_CHAIN_HEX.toLowerCase() && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void switchToMonadMainnet()}
                >
                  Switch to Monad Mainnet →
                </button>
              )}
          </div>
          {mode === "demo" && !DEMO_COLLECTION && (
            <p className="subtle">
              Mint is disabled until `NEXT_PUBLIC_DEMO_COLLECTION_ADDRESS` is
              set after deployment.
            </p>
          )}
          {address &&
            authenticatedWallet.toLowerCase() !== address.toLowerCase() && (
              <p className="subtle">
                Sign in with your wallet before minting so the API can verify
                and register the token.
              </p>
            )}
          {profileMessage && mode === "original" && (
            <p className="status" role="status">
              {profileMessage}
            </p>
          )}
          {mintMessage && (
            <p className="status" role="status">
              {mintMessage}
            </p>
          )}
          {mintedToken && (
            <p className="subtle">
              Token ID {mintedToken.tokenId} · transaction{" "}
              {MONAD_TESTNET_EXPLORER ? (
                <a
                  href={`${MONAD_TESTNET_EXPLORER.replace(/\/$/, "")}/tx/${mintedToken.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {mintedToken.transactionHash.slice(0, 10)}…
                </a>
              ) : (
                mintedToken.transactionHash.slice(0, 12) + "…"
              )}
            </p>
          )}
          <p className="subtle">
            A successful mint is an onchain testnet transaction. Local judge
            scenarios below are separate simulations.
          </p>
        </div>
        <div className="creature-panel" id="lab">
          <div className="panel-top">
            <span>YOUR EVOLUTION LAB</span>
            <span className="pill">
              {authenticatedWallet
                ? "SESSION VERIFIED"
                : address
                  ? "WALLET LINKED · SIGN IN REQUIRED"
                  : "NO WALLET"}
            </span>
          </div>
          {profileMessage && (
            <p className="status" role="status">
              {profileMessage}
            </p>
          )}
          {profiles.filter((profile) =>
            mode === "demo"
              ? profile.nft.mode === "demo"
              : profile.nft.mode === "original_companion",
          ).length ? (
            profiles
              .filter((profile) =>
                mode === "demo"
                  ? profile.nft.mode === "demo"
                  : profile.nft.mode === "original_companion",
              )
              .map((profile) => (
                <div
                  className={`creature-stage${profile.nft.mode === "demo" ? " art-stage" : ""}`}
                  key={profile.id}
                >
                  <div className="orb orb-a" />
                  <div className="orb orb-b" />
                  {profile.nft.mode === "demo" ? (
                    <>
                      <img
                        className="demo-art"
                        src={
                          profile.artworkUrl
                            ? `${API_BASE}${profile.artworkUrl}`
                            : artDataUri(profile.nft.tokenId, profile.stage)
                        }
                        alt={`Original Chogins demo art · ${profile.stage} stage`}
                      />
                      <div className="art-traits">
                        {composeDemoChog(
                          profile.nft.tokenId,
                          profile.stage,
                        ).traits.map((trait) => (
                          <span key={trait.name}>
                            <small>{trait.name}</small>
                            {trait.value}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="chog-placeholder">
                      <span>ORIGINAL CHOG COMPANION</span>
                      <b>#{profile.nft.tokenId}</b>
                      <small>
                        Verified original token · companion profile only
                      </small>
                    </div>
                  )}
                  <div className="stage-label">
                    {profile.displayName} ·{" "}
                    {profile.nft.collectionAddress.slice(0, 8)}…
                    {profile.nft.collectionAddress.slice(-4)}
                  </div>
                  <div className="stats">
                    <div>
                      <small>LEVEL</small>
                      <strong>{profile.level}</strong>
                    </div>
                    <div>
                      <small>EXPERIENCE</small>
                      <strong>
                        {profile.xp} <i>XP</i>
                      </strong>
                    </div>
                    <div>
                      <small>STAGE</small>
                      <strong>{profile.stage}</strong>
                    </div>
                  </div>
                  <span className="subtle">
                    Companion profile · version {profile.version}. Original
                    metadata is unchanged.
                  </span>
                  <a className="passport-link" href={`/passport/${profile.id}`}>
                    View public Passport ↗
                  </a>
                </div>
              ))
          ) : (
            <>
              <div
                className={`creature-stage${mode === "demo" ? " art-stage" : ""}`}
              >
                <div className="orb orb-a" />
                <div className="orb orb-b" />
                {mode === "demo" ? (
                  <>
                    <img
                      className="demo-art"
                      src={artDataUri("0", "hatchling")}
                      alt="Chogins demo art preview; no NFT is represented"
                    />
                    <span className="preview-label">
                      ART PREVIEW · NO NFT MINTED
                    </span>
                  </>
                ) : (
                  <div className="chog-placeholder">
                    <span>ORIGINAL CHOG</span>
                    <b>?</b>
                  </div>
                )}
                <div className="stage-label">
                  {authenticatedWallet
                    ? mode === "demo"
                      ? "Mint a demo Chog to register its profile"
                      : "No verified original Chog profiles found"
                    : "Connect and sign in to load verified companion profiles"}
                </div>
              </div>
              <div className="progress-row">
                <span>HATCHLING</span>
                <div className="progress">
                  <i />
                </div>
                <span>CURIOUS</span>
              </div>
              <div className="stats">
                <div>
                  <small>LEVEL</small>
                  <strong>—</strong>
                </div>
                <div>
                  <small>EXPERIENCE</small>
                  <strong>
                    — <i>XP</i>
                  </strong>
                </div>
                <div>
                  <small>NEXT CHANGE</small>
                  <strong>Not available</strong>
                </div>
              </div>
              <div id="history" className="history">
                <b>Evolution history</b>
                <span>No recorded evolution events yet.</span>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="quest-section" id="quests">
        <div className="section-heading">
          <div>
            <div className="eyebrow">THE NEXT CHAPTER</div>
            <h2>
              Find your first <em>proof.</em>
            </h2>
          </div>
          <span className="quiet">
            QUEST BOARD <b>{String(quests.length).padStart(2, "0")}</b>
          </span>
        </div>
        <div className="rescan-card">
          <div>
            <div className="eyebrow">MONAD ACTIVITY</div>
            <b>Ecosystem rescan</b>
            <p>
              Search the explicitly configured event logs for this wallet.
              Results are candidates only; they never award XP or prove quest
              completion on their own.
            </p>
          </div>
          <button
            type="button"
            disabled={
              !authenticatedWallet ||
              scanBusy ||
              !profiles.some(
                (profile) =>
                  profile.nft.mode ===
                  (mode === "demo" ? "demo" : "original_companion"),
              )
            }
            onClick={() => void rescanEcosystem()}
          >
            {scanBusy ? "Scanning…" : "Rescan activity"}
          </button>
        </div>
        {scanMessage && (
          <p className="status" role="status">
            {scanMessage}
          </p>
        )}
        {scanResult && (
          <div className="scan-results">
            <div className="eyebrow">
              {scanResult.status.toUpperCase()} · CANDIDATES ONLY
            </div>
            {scanResult.events.length ? (
              scanResult.events.map((event) => (
                <article key={`${event.txHash}-${event.blockNumber}`}>
                  <span>
                    {event.targetName}
                    {event.questSlug ? ` · possible ${event.questSlug}` : ""}
                  </span>
                  <small>Block {event.blockNumber}</small>
                  {event.transactionUrl ? (
                    <a
                      href={event.transactionUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open transaction ↗
                    </a>
                  ) : (
                    <code>{event.txHash.slice(0, 12)}…</code>
                  )}
                </article>
              ))
            ) : (
              <p>No matching wallet-linked logs in the scanned range.</p>
            )}
          </div>
        )}
        {questState && (
          <p className="status" role="status">
            {questState}
          </p>
        )}
        <div className="quest-grid">
          {quests.map((quest, index) => (
            <article
              className="quest"
              key={quest.id || quest.title || quest.name || index}
            >
              <div className="quest-index">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="quest-copy">
                <div className="eyebrow">{quest.status || "ACTIVE QUEST"}</div>
                <h3>
                  {quest.title || quest.name || quest.slug || "Untitled quest"}
                </h3>
                <p>
                  {quest.description ||
                    quest.detail ||
                    "Evidence requirements will be shown when available."}
                </p>
                <span className="quest-xp">
                  {quest.xpReward !== undefined
                    ? `${quest.xpReward} XP on finalized acceptance`
                    : "Progress tracked by quest status"}
                </span>
                {quest.id && (
                  <div className="claim-form">
                    {quest.kind === "demo_mint" ? (
                      <>
                        <label htmlFor={`mint-hash-${quest.id}`}>
                          Monad testnet mint transaction
                        </label>
                        <input
                          id={`mint-hash-${quest.id}`}
                          autoComplete="off"
                          placeholder="0x transaction hash"
                          value={claimEvidence[quest.id]?.txHash ?? ""}
                          onChange={(event) =>
                            setClaimEvidence((values) => ({
                              ...values,
                              [quest.id!]: {
                                url: "",
                                text: "",
                                txHash: event.target.value,
                              },
                            }))
                          }
                        />
                        <p>
                          The API verifies the receipt, collection, mint event,
                          and current token owner.
                        </p>
                      </>
                    ) : (
                      <p>
                        Evidence comes from the wallet-bound public X bio
                        verification. User-entered text and URLs are not used.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={
                        !authenticatedWallet ||
                        claimBusy === quest.id ||
                        (quest.kind === "bio_link" && !xProfileLink) ||
                        (quest.kind === "demo_mint" &&
                          !/^0x[0-9a-fA-F]{64}$/.test(
                            claimEvidence[quest.id]?.txHash ?? "",
                          ))
                      }
                      onClick={() => void submitClaim(quest)}
                    >
                      {claimBusy === quest.id
                        ? "Submitting…"
                        : "Submit verified quest"}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
        {claimMessage && (
          <p className="status" role="status">
            {claimMessage}
          </p>
        )}
        {claimItems.length > 0 && (
          <div className="history">
            <b>Claim history</b>
            {claimItems.map((claim) => (
              <span key={claim.id}>
                {claim.questSlug || "Quest"} · {claim.status} ·{" "}
                {claim.outcome || "No final decision"} · {claim.xpAward ?? 0} XP
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="social-link" aria-labelledby="x-link-title">
        <div className="eyebrow">WALLET-BOUND SOCIAL IDENTITY</div>
        <h2 id="x-link-title">Link an X profile</h2>
        <p>
          Prove control by adding a short code to your public bio. Verification
          reads the profile through X’s official API. A linked bio does not
          prove likes, follows, views, or private engagement.
        </p>
        {!authenticatedWallet ? (
          <p className="status">
            Connect and sign in with a wallet to link an X profile.
          </p>
        ) : xProfileLink ? (
          <div className="status">
            <p>
              Verified X profile <b>@{xProfileLink.username}</b> · linked{" "}
              {new Date(xProfileLink.verifiedAt).toLocaleDateString()}
            </p>
            <button
              type="button"
              disabled={xLinkBusy}
              onClick={() => void unlinkXProfile()}
            >
              {xLinkBusy ? "Working…" : "Unlink X profile"}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={xLinkBusy}
              onClick={() => void createXBioChallenge()}
            >
              {xLinkBusy ? "Working…" : "Create bio verification code"}
            </button>
            {xBioCode && (
              <div className="x-code">
                <code>{xBioCode}</code>
                <span>
                  Copy this into your public X bio, then verify below. The code
                  expires after 30 minutes.
                </span>
              </div>
            )}
            <div className="x-verify">
              <label htmlFor="x-username">X username</label>
              <input
                id="x-username"
                autoComplete="off"
                value={xUsername}
                onChange={(event) =>
                  setXUsername(event.target.value.replace(/^@/, ""))
                }
                placeholder="ChogNFT"
              />
              <button
                type="button"
                disabled={xLinkBusy || !xBioCode || !xUsername}
                onClick={() => void verifyXBio()}
              >
                {xLinkBusy ? "Checking…" : "Verify public bio"}
              </button>
            </div>
          </>
        )}
        {xLinkMessage && (
          <p className="status" role="status">
            {xLinkMessage}
          </p>
        )}
      </section>
      <section className="judge" aria-labelledby="judge-title">
        <div className="eyebrow">DEVELOPER WALKTHROUGH · LOCAL SIMULATION</div>
        <h2 id="judge-title">Local simulated judge</h2>
        <p>
          These outcomes exercise the development scenario API only. They are
          simulated decisions, never blockchain transactions, and do not change
          original collection metadata or any production profile.
        </p>
        {!SIMULATION_ENABLED ? (
          <div className="status">
            LOCAL SIMULATION DISABLED. Set{" "}
            <code>NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION=true</code> to enable this
            local walkthrough.
          </div>
        ) : (
          <>
            <div className="scenario-buttons">
              {(["accepted", "rejected", "pending"] as const).map((value) => (
                <button
                  key={value}
                  disabled={scenarioBusy}
                  onClick={() => void runScenario(value)}
                >
                  Simulate {value}
                </button>
              ))}
            </div>
            <p className="status" role="status">
              {scenarioBusy
                ? "LOCAL SIMULATION · Saving simulated scenario…"
                : scenarioState ||
                  "LOCAL SIMULATION · Choose an outcome to run the simulated judge walkthrough."}
            </p>
            {scenario && (
              <div className="scenario-result">
                <b>
                  LOCAL SIMULATION · {scenario.outcome} ·{" "}
                  {scenario.evolution.status}
                </b>
                <span>
                  XP award: {scenario.evolution.xpAward} · scenario{" "}
                  {scenario.id}
                </span>
                <span>
                  Simulated profile: level {scenario.profile.level},{" "}
                  {scenario.profile.xp} XP
                </span>
              </div>
            )}
          </>
        )}
      </section>
      <footer>
        <span>
          CHOG EVOLUTION <i>·</i> A PARTICIPATION MEMORY
        </span>
        <span>DEMO AND ORIGINAL MODES ARE DISTINCT</span>
      </footer>
    </main>
  );
}
