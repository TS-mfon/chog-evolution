"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  ApiError,
  collectionPages,
  friendlyError,
  isAbort,
  isPending,
  UserError,
  type RequestOptions,
} from "../lib/api";
import type {
  AppConfig,
  ChainConfig,
  Claim,
  EthereumProvider,
  Profile,
  Quest,
  WalletOption,
} from "../lib/types";
import { Modal } from "./modal";
import { Icon } from "./icons";

type Session = { address: string; provider: EthereumProvider };
type ChogContextType = {
  address: string;
  signedIn: boolean;
  sessionReady: boolean;
  walletBusy: boolean;
  walletError: string;
  config: AppConfig | null;
  configError: string;
  profiles: Profile[];
  profile: Profile | null;
  profilesLoading: boolean;
  profileError: string;
  claims: Claim[];
  claimError: string;
  quests: Quest[];
  questsLoading: boolean;
  questError: string;
  ensureSession: (chainId?: number) => Promise<Session>;
  connect: () => Promise<void>;
  signOut: () => Promise<void>;
  setSelectedProfile: (id: string) => void;
  addProfile: (profile: Profile) => void;
  addClaim: (claim: Claim) => void;
  refreshData: () => Promise<void>;
  refreshQuests: () => Promise<void>;
  refreshConfig: () => Promise<AppConfig>;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  walletMatches: (address: string) => boolean;
  currentProvider: () => EthereumProvider | null;
  clearWalletError: () => void;
};

const ChogContext = createContext<ChogContextType | null>(null);
const FALLBACK_CHAIN: ChainConfig = {
  chainId: 10143,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadexplorer.com",
};

async function switchChain(provider: EthereumProvider, config: ChainConfig) {
  const chainId = `0x${config.chainId.toString(16)}`;
  if (
    Number.parseInt(
      String(await provider.request({ method: "eth_chainId" })),
      16,
    ) === config.chainId
  )
    return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Number(error.code)
        : 0;
    if (code !== 4902 || !config.rpcUrl) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: config.chainId === 143 ? "Monad" : "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [config.rpcUrl],
          ...(config.explorerUrl
            ? { blockExplorerUrls: [config.explorerUrl] }
            : {}),
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
  const actual = Number.parseInt(
    String(await provider.request({ method: "eth_chainId" })),
    16,
  );
  if (actual !== config.chainId)
    throw new UserError("Select Monad in your wallet to continue.");
}

export function ChogProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState("");
  const [sessionWallet, setSessionWallet] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [walletPicker, setWalletPicker] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimError, setClaimError] = useState("");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [questsLoading, setQuestsLoading] = useState(true);
  const [questError, setQuestError] = useState("");
  const addressRef = useRef("");
  const sessionRef = useRef("");
  const providerRef = useRef<EthereumProvider | null>(null);
  const generation = useRef(0);
  const refreshVersion = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const sawPendingReview = useRef(false);
  const authPromise = useRef<Promise<Session> | null>(null);
  const logoutPromise = useRef<Promise<void> | null>(null);
  const chooseResolve = useRef<
    ((provider: EthereumProvider | null) => void) | null
  >(null);
  const signedIn =
    !!address && address.toLowerCase() === sessionWallet.toLowerCase();

  const clearPrivate = useCallback(() => {
    generation.current++;
    refreshController.current?.abort();
    sawPendingReview.current = false;
    sessionRef.current = "";
    setSessionWallet("");
    setProfiles([]);
    setClaims([]);
    setSelectedId("");
    setProfileError("");
    setClaimError("");
    setProfilesLoading(false);
  }, []);

  const updateAddress = useCallback(
    (next: string) => {
      if (addressRef.current.toLowerCase() !== next.toLowerCase())
        clearPrivate();
      addressRef.current = next;
      setAddress(next);
    },
    [clearPrivate],
  );

  const refreshConfig = useCallback(async () => {
    try {
      const value = await api<AppConfig>("/v1/config");
      setConfig(value);
      setConfigError("");
      return value;
    } catch (error) {
      setConfigError(friendlyError(error));
      throw error;
    }
  }, []);

  const refreshQuests = useCallback(async () => {
    setQuestsLoading(true);
    try {
      const result = await collectionPages<Quest>("/v1/quests");
      setQuests(result);
      setQuestError("");
    } catch (error) {
      setQuestError(friendlyError(error));
    } finally {
      setQuestsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConfig().catch(() => undefined);
    void refreshQuests();
    function announce(event: Event) {
      const detail = (
        event as CustomEvent<{
          info?: { uuid?: string; name?: string };
          provider?: EthereumProvider;
        }>
      ).detail;
      if (!detail?.provider?.request || !detail.info?.uuid) return;
      const wallet: WalletOption = {
        id: detail.info.uuid,
        name: (detail.info.name || "Browser wallet").slice(0, 50),
        provider: detail.provider,
      };
      setWallets((current) =>
        current.some((item) => item.id === wallet.id)
          ? current
          : [...current, wallet],
      );
      if (!providerRef.current) {
        providerRef.current = wallet.provider;
        setProvider(wallet.provider);
      }
    }
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (!providerRef.current && window.ethereum) {
      providerRef.current = window.ethereum;
      setProvider(window.ethereum);
    }
    if (!providerRef.current) setSessionReady(true);
    return () => {
      window.removeEventListener("eip6963:announceProvider", announce);
      chooseResolve.current?.(null);
    };
  }, [refreshConfig, refreshQuests]);

  useEffect(() => {
    if (!provider) return;
    let active = true;
    const initialGeneration = generation.current;
    void (async () => {
      try {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[];
        if (!active || initialGeneration !== generation.current) return;
        updateAddress(accounts[0] || "");
        const epoch = generation.current;
        if (accounts[0]) {
          const me = await api<{ wallet?: string }>("/v1/auth/me");
          if (
            active &&
            generation.current === epoch &&
            me.wallet?.toLowerCase() === addressRef.current.toLowerCase()
          ) {
            sessionRef.current = me.wallet;
            setSessionWallet(me.wallet);
          }
        }
      } catch {
        /* A missing or expired session waits for an explicit sign-in. */
      } finally {
        if (active) setSessionReady(true);
      }
    })();
    const accountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      updateAddress(accounts[0] || "");
      setWalletError("");
      setSessionReady(true);
    };
    const disconnected = () => {
      updateAddress("");
      setWalletError(
        "Your wallet disconnected. Connect again when you’re ready.",
      );
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("disconnect", disconnected);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [provider, updateAddress]);

  const request = useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      const epoch = generation.current;
      try {
        const result = await api<T>(path, options);
        if (epoch !== generation.current)
          throw new ApiError("wallet_changed", 409);
        return result;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          epoch === generation.current
        ) {
          clearPrivate();
          setWalletError(friendlyError(error));
        }
        throw error;
      }
    },
    [clearPrivate],
  );

  const refreshData = useCallback(async () => {
    if (
      !sessionRef.current ||
      sessionRef.current.toLowerCase() !== addressRef.current.toLowerCase()
    )
      return;
    const epoch = generation.current;
    const version = ++refreshVersion.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setProfilesLoading(true);
    const results = await Promise.allSettled([
      collectionPages<Profile>("/v1/profiles", request, {
        signal: controller.signal,
      }),
      collectionPages<Claim>("/v1/claims", request, {
        signal: controller.signal,
      }),
    ]);
    if (epoch !== generation.current || version !== refreshVersion.current)
      return;
    const [profileResult, claimResult] = results;
    if (profileResult.status === "fulfilled") {
      setProfiles(profileResult.value);
      setProfileError("");
    } else if (!isAbort(profileResult.reason))
      setProfileError(friendlyError(profileResult.reason));
    if (claimResult.status === "fulfilled") {
      setClaims(claimResult.value);
      setClaimError("");
    } else if (!isAbort(claimResult.reason))
      setClaimError(friendlyError(claimResult.reason));
    setProfilesLoading(false);
  }, [request]);

  useEffect(() => {
    if (signedIn) void refreshData();
    return () => refreshController.current?.abort();
  }, [signedIn, refreshData, sessionWallet]);

  const pending =
    claims.some((claim) => isPending(claim.status)) ||
    profiles.some((item) => item.artworkPending);
  useEffect(() => {
    if (!signedIn) {
      sawPendingReview.current = false;
      return;
    }
    if (pending) sawPendingReview.current = true;
    else if (!sawPendingReview.current) return;
    else sawPendingReview.current = false;

    // The production worker runs every five minutes. Cover normal scheduled
    // reviews for 30 visible minutes, then keep reading profiles for ten more
    // minutes after reviews settle so separately published artwork can arrive.
    // Hidden tabs consume neither requests nor the visible-time budget.
    const maxVisibleTicks = pending ? 150 : 50;
    let visibleTicks = 0;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++visibleTicks > maxVisibleTicks) {
        window.clearInterval(timer);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      void refreshData().finally(() => {
        inFlight = false;
      });
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [signedIn, pending, refreshData, sessionWallet]);

  useEffect(() => {
    if (!address || !signedIn) return;
    try {
      setSelectedId(
        localStorage.getItem(`chog:selected:${address.toLowerCase()}`) || "",
      );
    } catch {
      /* Selection can remain in memory. */
    }
  }, [address, signedIn]);

  const chooseWallet = async (): Promise<EthereumProvider> => {
    if (providerRef.current && (wallets.length < 2 || addressRef.current))
      return providerRef.current;
    if (wallets.length === 1) return wallets[0]!.provider;
    if (!wallets.length && window.ethereum) return window.ethereum;
    setWalletPicker(true);
    const selected = await new Promise<EthereumProvider | null>((resolve) => {
      chooseResolve.current = resolve;
    });
    chooseResolve.current = null;
    setWalletPicker(false);
    if (!selected)
      throw new UserError(
        "Wallet connection closed. Connect whenever you’re ready.",
      );
    return selected;
  };

  const ensureSession = (targetChainId?: number): Promise<Session> => {
    if (authPromise.current) return authPromise.current;
    const task = (async () => {
      setWalletBusy(true);
      setWalletError("");
      try {
        // A late logout response must not clear a freshly established session.
        if (logoutPromise.current) await logoutPromise.current;
        const selectedProvider = await chooseWallet();
        providerRef.current = selectedProvider;
        setProvider(selectedProvider);
        const accounts = (await selectedProvider.request({
          method: "eth_requestAccounts",
        })) as string[];
        const account = accounts[0];
        if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account))
          throw new UserError("Choose an account in your wallet to continue.");
        updateAddress(account);
        const epoch = generation.current;
        const currentChain = Number.parseInt(
          String(await selectedProvider.request({ method: "eth_chainId" })),
          16,
        );
        const demo = config?.demo || FALLBACK_CHAIN;
        const mainnet = config?.mainnet || {
          chainId: 143,
          rpcUrl: "https://rpc.monad.xyz",
          explorerUrl: "https://monadexplorer.com",
        };
        if (
          targetChainId ||
          ![demo.chainId, mainnet.chainId].includes(currentChain)
        ) {
          await switchChain(
            selectedProvider,
            targetChainId === mainnet.chainId ? mainnet : demo,
          );
        }
        const assertCurrent = async () => {
          const now = (await selectedProvider.request({
            method: "eth_accounts",
          })) as string[];
          if (
            generation.current !== epoch ||
            now[0]?.toLowerCase() !== account.toLowerCase()
          )
            throw new ApiError("wallet_changed", 409);
        };
        await assertCurrent();
        if (sessionRef.current.toLowerCase() !== account.toLowerCase()) {
          const chainId = Number.parseInt(
            String(await selectedProvider.request({ method: "eth_chainId" })),
            16,
          );
          const challenge = await api<{ message: string }>("/v1/auth/nonce", {
            method: "POST",
            body: { address: account, chainId },
          });
          await assertCurrent();
          const hexMessage = `0x${Array.from(new TextEncoder().encode(challenge.message), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
          const signature = (await selectedProvider.request({
            method: "personal_sign",
            params: [hexMessage, account],
          })) as string;
          await assertCurrent();
          const verified = await api<{ wallet: string }>("/v1/auth/verify", {
            method: "POST",
            body: { message: challenge.message, signature },
          });
          await assertCurrent();
          if (verified.wallet?.toLowerCase() !== account.toLowerCase())
            throw new UserError(
              "We couldn’t verify that wallet. Please connect again.",
            );
          sessionRef.current = verified.wallet;
          setSessionWallet(verified.wallet);
        }
        setSessionReady(true);
        return { address: account, provider: selectedProvider };
      } catch (error) {
        setWalletError(friendlyError(error));
        throw error;
      } finally {
        setWalletBusy(false);
        authPromise.current = null;
      }
    })();
    authPromise.current = task;
    return task;
  };

  const connect = async () => {
    try {
      await ensureSession();
    } catch {
      /* A visible, friendly message is set by ensureSession. */
    }
  };
  const signOut = async () => {
    if (logoutPromise.current) return logoutPromise.current;
    clearPrivate();
    setWalletError("");
    const task = (async () => {
      try {
        await api("/v1/auth/logout", { method: "POST" });
      } catch {
        setWalletError(
          "You’re signed out here. Chog couldn’t finish ending the server session; try signing out again when your connection returns.",
        );
      } finally {
        logoutPromise.current = null;
      }
    })();
    logoutPromise.current = task;
    return task;
  };
  const setSelectedProfile = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(
        `chog:selected:${addressRef.current.toLowerCase()}`,
        id,
      );
    } catch {
      /* Selection can remain in memory. */
    }
  };
  const addProfile = (profile: Profile) => {
    setProfiles((current) => [
      ...current.filter((item) => item.id !== profile.id),
      profile,
    ]);
    setSelectedProfile(profile.id);
    setProfileError("");
  };
  const addClaim = (claim: Claim) =>
    setClaims((current) => [
      claim,
      ...current.filter((item) => item.id !== claim.id),
    ]);
  const profile =
    profiles.find((item) => item.id === selectedId) || profiles[0] || null;

  return (
    <ChogContext.Provider
      value={{
        address,
        signedIn,
        sessionReady,
        walletBusy,
        walletError,
        config,
        configError,
        profiles,
        profile,
        profilesLoading,
        profileError,
        claims,
        claimError,
        quests,
        questsLoading,
        questError,
        ensureSession,
        connect,
        signOut,
        setSelectedProfile,
        addProfile,
        addClaim,
        refreshData,
        refreshQuests,
        refreshConfig,
        request,
        walletMatches: (account) =>
          addressRef.current.toLowerCase() === account.toLowerCase(),
        currentProvider: () => providerRef.current,
        clearWalletError: () => setWalletError(""),
      }}
    >
      {children}
      {walletPicker && (
        <Modal
          title={
            wallets.length ? "Choose your wallet" : "Your Chog needs a wallet"
          }
          onClose={() => chooseResolve.current?.(null)}
        >
          <p>
            A wallet is your home for Chog. You’ll sign a free message to
            connect.
          </p>
          {wallets.length ? (
            <div className="wallet-options">
              {wallets.map((wallet) => (
                <button
                  type="button"
                  className="wallet-option"
                  key={wallet.id}
                  onClick={() => chooseResolve.current?.(wallet.provider)}
                >
                  <Icon name="wallet" />
                  <span>{wallet.name}</span>
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
          ) : (
            <>
              <p>
                Open this site in your wallet’s browser, or install a wallet to
                continue.
              </p>
              <a
                className="button button-primary"
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer"
              >
                Get a wallet <Icon name="up-right" />
              </a>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  window.dispatchEvent(new Event("eip6963:requestProvider"));
                  if (window.ethereum) chooseResolve.current?.(window.ethereum);
                }}
              >
                Check for my wallet <Icon name="refresh" />
              </button>
            </>
          )}
          <p className="caption">
            Connecting never mints a Chog or sends a transaction on its own.
          </p>
        </Modal>
      )}
    </ChogContext.Provider>
  );
}

export function useChog() {
  const context = useContext(ChogContext);
  if (!context) throw new Error("useChog must be used inside ChogProvider");
  return context;
}
