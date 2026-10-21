"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChog } from "../../components/chog-provider";
import { Icon } from "../../components/icons";
import { ChogArtwork, DiscoverButton, Notice } from "../../components/ui";
import {
  ApiError,
  friendlyError,
  isAbort,
  safeUrl,
  UserError,
} from "../../lib/api";
import type { Claim, EthereumProvider, Profile } from "../../lib/types";

type PendingMint = {
  wallet: string;
  hash: string;
  chainId: number;
  createdAt: string;
};
type MintStep =
  "ready" | "connect" | "prepare" | "wallet" | "confirm" | "finish" | "done";
type PreparedMint = {
  chainId: number;
  transaction: { to: string; data: string; value: string };
  supply: { minted: number | string; maxSupply: number | string };
};
const pendingKey = (address: string) =>
  `chog:pending-mint:${address.toLowerCase()}`;

function readPending(address: string): PendingMint | null {
  if (!address) return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(pendingKey(address)) || "null",
    ) as PendingMint | null;
    return value &&
      value.wallet?.toLowerCase() === address.toLowerCase() &&
      /^0x[0-9a-fA-F]{64}$/.test(value.hash) &&
      Number.isSafeInteger(value.chainId)
      ? value
      : null;
  } catch {
    return null;
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", cancelled);
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    const cancelled = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

export default function MintPage() {
  const chog = useChog();
  const {
    address,
    signedIn,
    config,
    ensureSession,
    addProfile,
    addClaim,
    refreshData,
    request,
    walletMatches,
    currentProvider,
  } = chog;
  const [step, setStep] = useState<MintStep>("ready");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMint | null>(null);
  const [minted, setMinted] = useState<Profile | null>(null);
  const [receiptHash, setReceiptHash] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [soldOut, setSoldOut] = useState(false);
  const [supply, setSupply] = useState<PreparedMint["supply"] | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const recovered = useRef("");
  const previousAddress = useRef("");
  const contextRef = useRef(chog);
  contextRef.current = chog;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const previous = previousAddress.current;
    previousAddress.current = address;
    // The first account is the normal result of clicking Mint. Only an actual
    // account switch cancels that in-flight connection and mint operation.
    if (previous && previous.toLowerCase() !== address.toLowerCase()) {
      controllerRef.current?.abort();
      busyRef.current = false;
    }
    if (!busyRef.current) {
      setBusy(false);
      setStep("ready");
      setMinted(null);
      setReceiptHash("");
      setError("");
      setMessage("");
      setPending(readPending(address));
      recovered.current = "";
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === pendingKey(address)) setPending(readPending(address));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [address]);

  const finishMint = useCallback(
    async (
      saved: PendingMint,
      provider: EthereumProvider,
      signal: AbortSignal,
    ) => {
      const current = () =>
        mounted.current &&
        !signal.aborted &&
        contextRef.current.walletMatches(saved.wallet);
      if (!current()) return;
      setStep("confirm");
      setMessage(
        "Your Chog is on its way. Waiting for the network to confirm your mint.",
      );
      let receipt: { status?: string } | null = null;
      for (let attempt = 0; attempt < 24; attempt++) {
        if (!current()) return;
        const chain = Number.parseInt(
          String(await provider.request({ method: "eth_chainId" })),
          16,
        );
        if (chain === saved.chainId) {
          receipt = (await provider.request({
            method: "eth_getTransactionReceipt",
            params: [saved.hash],
          })) as { status?: string } | null;
        } else {
          const rpcUrl = contextRef.current.config?.demo.rpcUrl;
          if (!rpcUrl)
            throw new UserError(
              "Your mint is saved. Reconnect on Monad Testnet to finish checking it.",
            );
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getTransactionReceipt",
              params: [saved.hash],
            }),
            signal,
          });
          const result = (await response.json()) as {
            result?: { status?: string } | null;
            error?: unknown;
          };
          if (!response.ok || result.error)
            throw new UserError(
              "The network is taking a moment. Your mint is saved; check again shortly.",
            );
          receipt = result.result || null;
        }
        if (receipt) break;
        await pause(3500, signal);
      }
      if (!current()) return;
      if (!receipt) throw new ApiError("mint_receipt_pending", 202);
      if (receipt.status === "0x0" || receipt.status === "0x00") {
        localStorage.removeItem(pendingKey(saved.wallet));
        setPending(null);
        throw new ApiError("mint_transaction_failed", 422);
      }
      if (receipt.status !== "0x1" && receipt.status !== "0x01")
        throw new UserError(
          "Your mint is saved while its confirmation is checked. Please try again shortly.",
        );
      setStep("finish");
      setMessage(
        "Mint confirmed. Bringing your Chog home and setting up its first quest.",
      );
      let result: {
        item: Profile;
        claim?: Claim;
        claimWarning?: string;
      } | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          result = await contextRef.current.request<{
            item: Profile;
            claim?: Claim;
            claimWarning?: string;
          }>("/v1/mints/confirm", {
            method: "POST",
            body: { transactionHash: saved.hash },
            signal,
            timeout: 40_000,
          });
          break;
        } catch (cause) {
          if (
            !(
              cause instanceof ApiError && cause.code === "mint_receipt_pending"
            ) ||
            attempt === 7
          )
            throw cause;
          await pause(3500, signal);
        }
      }
      if (!result || !current()) return;
      contextRef.current.addProfile(result.item);
      if (result.claim)
        contextRef.current.addClaim({
          ...result.claim,
          profileId: result.claim.profileId || result.item.id,
        });
      localStorage.removeItem(pendingKey(saved.wallet));
      setPending(null);
      setMinted(result.item);
      setReceiptHash(saved.hash);
      setStep("done");
      setMessage(
        result.claimWarning
          ? "Your Chog is home. Its first quest needs another check; you can claim it from the quest page."
          : "Your Chog is home. Let’s give it a story.",
      );
      void contextRef.current.refreshData();
    },
    [],
  );

  useEffect(() => {
    if (
      !signedIn ||
      !pending ||
      busyRef.current ||
      recovered.current === pending.hash
    )
      return;
    const provider = currentProvider();
    if (!provider) return;
    recovered.current = pending.hash;
    const controller = new AbortController();
    controllerRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError("");
    void finishMint(pending, provider, controller.signal)
      .catch((cause) => {
        if (!isAbort(cause) && mounted.current && walletMatches(pending.wallet))
          setError(friendlyError(cause));
      })
      .finally(() => {
        if (controllerRef.current === controller) {
          busyRef.current = false;
          if (mounted.current) setBusy(false);
        }
      });
    // Resume only an already submitted mint; this effect never signs or sends.
  }, [signedIn, pending, finishMint, currentProvider, walletMatches]);

  async function mint() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    controllerRef.current = controller;
    let account = address;
    try {
      setStep("connect");
      setMessage(
        "Open your wallet to connect. We’ll guide you through the rest.",
      );
      const session = await ensureSession(config?.demo.chainId || 10143);
      account = session.address;
      if (!mounted.current || controller.signal.aborted) return;
      const perform = async () => {
        const saved = readPending(session.address);
        if (saved) {
          setPending(saved);
          recovered.current = saved.hash;
          await finishMint(saved, session.provider, controller.signal);
          return;
        }
        setStep("prepare");
        setMessage("Getting your Chog ready…");
        const prepared = await request<PreparedMint>("/v1/mints/prepare", {
          method: "POST",
          signal: controller.signal,
        });
        setSupply(prepared.supply);
        if (
          !/^0x[0-9a-fA-F]{40}$/.test(prepared.transaction.to) ||
          !/^0x[0-9a-fA-F]+$/.test(prepared.transaction.data) ||
          prepared.chainId !== (config?.demo.chainId || 10143)
        )
          throw new UserError(
            "Minting is not ready right now. Please try again shortly.",
          );
        // Refuse to submit unless a receipt can survive navigation and refresh.
        try {
          localStorage.setItem(
            `${pendingKey(session.address)}:storage-check`,
            "ok",
          );
          localStorage.removeItem(
            `${pendingKey(session.address)}:storage-check`,
          );
        } catch {
          throw new UserError(
            "Allow this site to save your mint progress in this browser, then try again.",
          );
        }
        const accounts = (await session.provider.request({
          method: "eth_accounts",
        })) as string[];
        const chain = Number.parseInt(
          String(await session.provider.request({ method: "eth_chainId" })),
          16,
        );
        if (
          accounts[0]?.toLowerCase() !== session.address.toLowerCase() ||
          !walletMatches(session.address)
        )
          throw new ApiError("wallet_changed", 409);
        if (chain !== prepared.chainId)
          throw new UserError(
            "Your network changed. Try again and we’ll switch your wallet back to Monad Testnet.",
          );
        if (controller.signal.aborted) return;
        setStep("wallet");
        setMessage(
          "Your wallet is ready. Review the mint and confirm when you’re happy.",
        );
        const hash = (await session.provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: session.address,
              to: prepared.transaction.to,
              data: prepared.transaction.data,
              value: prepared.transaction.value,
              chainId: `0x${prepared.chainId.toString(16)}`,
            },
          ],
        })) as string;
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
          throw new UserError(
            "Your wallet didn’t return a mint receipt. Check your wallet’s activity, then use Find my Chogs before trying another mint.",
          );
        const next: PendingMint = {
          wallet: session.address,
          hash,
          chainId: prepared.chainId,
          createdAt: new Date().toISOString(),
        };
        // Always retain a sent transaction, even if the user navigated away or
        // switched accounts while the wallet confirmation was open.
        localStorage.setItem(pendingKey(session.address), JSON.stringify(next));
        if (
          !mounted.current ||
          !walletMatches(session.address) ||
          controller.signal.aborted
        )
          return;
        setPending(next);
        recovered.current = hash;
        await finishMint(next, session.provider, controller.signal);
      };
      if (navigator.locks)
        await navigator.locks.request(
          `chog-mint:${session.address.toLowerCase()}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock)
              throw new UserError(
                "Your Chog is being minted in another tab. Finish there, then return to your collection.",
              );
            await perform();
          },
        );
      else await perform();
    } catch (cause) {
      if (
        !isAbort(cause) &&
        mounted.current &&
        (!account || walletMatches(account))
      ) {
        setError(friendlyError(cause));
        if (cause instanceof ApiError && cause.code === "mint_sold_out")
          setSoldOut(true);
      }
    } finally {
      if (controllerRef.current === controller) {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }

  const stepIndex = [
    "ready",
    "connect",
    "prepare",
    "wallet",
    "confirm",
    "finish",
    "done",
  ].indexOf(step);
  const explorer = safeUrl(config?.demo.explorerUrl);
  const hash = pending?.hash || receiptHash;
  const receipt =
    explorer && hash ? `${explorer.replace(/\/$/, "")}/tx/${hash}` : undefined;
  return (
    <main id="main-content" className="mint-page section-width">
      <div className="mint-topline">
        <Link className="text-link" href="/">
          <Icon name="arrow" className="arrow-back" size={16} />
          Back to the story
        </Link>
        <span className="network-label">
          <span className="tiny-dot" />
          MONAD TESTNET
        </span>
      </div>
      <div className="mint-layout">
        <section
          className="mint-visual"
          aria-label={minted ? "Your minted Chog" : "Meet the Chog collection"}
        >
          {minted ? (
            <ChogArtwork profile={minted} />
          ) : (
            <div className="mint-brand-art">
              <div className="mint-orbit" aria-hidden="true" />
              <span className="mint-art-word">
                HELLO,
                <br />
                HUMAN.
              </span>
              <img
                src="/brand/chog-hero.webp"
                alt="A purple Chog, ready for a new adventure"
                width={1000}
                height={1000}
              />
              <span className="mint-art-sticker">
                <Icon name="spark" size={22} />A LITTLE
                <br />
                UNPREDICTABLE.
              </span>
              <span className="mint-preview-label">
                Meet the Chog world · Your NFT is revealed after minting
              </span>
            </div>
          )}
        </section>
        <section className="mint-copy" aria-labelledby="mint-heading">
          <div className="eyebrow">
            {minted
              ? "THE BEGINNING OF SOMETHING GOOD"
              : "GOOD THINGS START SMALL"}
          </div>
          <h1 id="mint-heading">
            {minted ? (
              <>
                Oh, hey.
                <br />
                You’re a Chog.
              </>
            ) : (
              <>
                Your story.
                <br />
                Your Chog.
              </>
            )}
          </h1>
          <p className="mint-description">
            {minted
              ? `${minted.displayName} is officially part of your world. There’s a whole ecosystem out there. Time to make a little history.`
              : "One small mint. A whole lot of possibility. Bring home a Chog and let your adventures shape what it becomes."}
          </p>
          <div className="mint-facts">
            <span>
              <Icon name="chog" size={17} />A real demo NFT
            </span>
            <span>
              <Icon name="globe" size={17} />
              Monad Testnet
            </span>
            <span>
              <Icon name="spark" size={17} />
              Made to evolve
            </span>
          </div>
          {!minted && (
            <p className="mint-fee-note">
              You’ll need a little testnet MON for the network fee. Your wallet
              shows the details before you confirm.
            </p>
          )}
          {minted ? (
            <div className="mint-success">
              <Notice tone="success">{message}</Notice>
              <Link
                className="button button-primary button-large button-full"
                href="/profile"
              >
                Meet your Chog <Icon name="arrow" />
              </Link>
              <Link className="text-link" href="/quests">
                Find its first adventure <Icon name="up-right" size={17} />
              </Link>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="button button-primary button-large button-full mint-main-button"
                disabled={busy || soldOut}
                onClick={() => void mint()}
              >
                <Icon name={busy ? "clock" : "spark"} />
                {busy
                  ? (
                      {
                        connect: "Connecting your wallet…",
                        prepare: "Getting ready…",
                        wallet: "Confirm in your wallet",
                        confirm: "Your Chog is on its way…",
                        finish: "Bringing your Chog home…",
                      } as Record<string, string>
                    )[step] || "Working on your Chog…"
                  : soldOut
                    ? "This collection is minted out"
                    : pending
                      ? "Finish my mint"
                      : "Mint a Chog"}
                {!busy && !soldOut && <Icon name="up-right" />}
              </button>
              {pending && !busy && (
                <p className="caption">
                  Your mint is safely saved. Checking again continues the same
                  mint.
                </p>
              )}
              {busy && message && (
                <p className="mint-status" role="status">
                  {message}
                </p>
              )}
              {error && <Notice tone="error">{error}</Notice>}
              {supply && (
                <p className="caption supply-count">
                  {Number(supply.minted).toLocaleString()} of{" "}
                  {Number(supply.maxSupply).toLocaleString()} minted
                </p>
              )}
              <ol className="mint-steps" aria-label="Mint progress">
                {[
                  { label: "Connect", index: 1 },
                  { label: "Confirm mint", index: 3 },
                  { label: "Meet your Chog", index: 5 },
                ].map((item, index) => (
                  <li
                    key={item.label}
                    className={stepIndex >= item.index ? "is-active" : ""}
                    aria-current={
                      busy &&
                      stepIndex >= item.index &&
                      stepIndex < item.index + 2
                        ? "step"
                        : undefined
                    }
                  >
                    <span>
                      {stepIndex > item.index + 1 ? (
                        <Icon name="check" size={12} />
                      ) : (
                        `0${index + 1}`
                      )}
                    </span>
                    {item.label}
                  </li>
                ))}
              </ol>
            </>
          )}
          {receipt && (
            <a
              className="text-link receipt-link"
              href={receipt}
              target="_blank"
              rel="noreferrer"
            >
              View mint receipt <Icon name="up-right" size={15} />
            </a>
          )}
          <div className="mint-existing">
            <p>Already have a Chog?</p>
            <DiscoverButton />
          </div>
        </section>
      </div>
      <div className="mint-bottom">
        <Icon name="spark" size={24} />
        <p>
          The mint is just the beginning.
          <br />
          <span>
            Explore, contribute, and give your Chog a reason to evolve.
          </span>
        </p>
        <Link className="text-link" href="/evolution">
          How evolution works <Icon name="arrow" size={17} />
        </Link>
      </div>
    </main>
  );
}
