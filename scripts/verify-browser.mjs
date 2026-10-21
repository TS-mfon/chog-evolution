import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { composeDemoChog } from "@chog/art-composition";

// These fixtures exist only inside this browser acceptance process. The app
// itself has no mock mode, fake wallet, simulated mint or simulated judge.
const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.CHOG_TEST_PORT || 3017);
const base = process.env.CHOG_TEST_BASE_URL || `http://127.0.0.1:${port}`;
const wallet = `0x${"1".repeat(40)}`;
const otherWallet = `0x${"2".repeat(40)}`;
const collection = "0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce";
const hash = `0x${"3".repeat(64)}`;
const profile = {
  id: "11111111-2222-4333-8444-555555555555",
  nft: {
    mode: "demo",
    chainId: 10143,
    collectionAddress: collection,
    tokenId: "7",
  },
  displayName: "Chog #7",
  xp: 0,
  level: 1,
  stage: "hatchling",
  traits: [],
  earnedTraitIds: [],
  equippedTraitIds: [],
  traitCatalogueVersion: 1,
  version: 0,
};
const originalProfile = {
  ...profile,
  id: "11111111-2222-4333-8444-666666666666",
  displayName: "Chog #42",
  nft: {
    mode: "original_companion",
    chainId: 143,
    collectionAddress: `0x${"4".repeat(40)}`,
    tokenId: "42",
  },
  originalMetadata: {
    name: "Original Chog #42",
    imageUrl: "/brand/chog-hero.webp",
    tokenUri: "https://example.com/original/42",
    fetchedAt: "2026-10-20T00:00:00.000Z",
  },
  originalMetadataStatus: "unavailable",
  originalMetadataErrorCode: "original_metadata_unavailable",
  originalMetadataAttemptedAt: "2026-10-20T12:00:00.000Z",
};
const otherProfile = {
  ...profile,
  id: "11111111-2222-4333-8444-777777777777",
  displayName: "Chog #99",
  nft: { ...profile.nft, tokenId: "99" },
};
const contributionQuest = {
  id: "21111111-2222-4333-8444-666666666666",
  slug: "ecosystem-contribution",
  name: "Ecosystem contribution",
  kind: "contribution",
  description: "Share a useful public contribution.",
  xpReward: 75,
};
const catalogue = [
  {
    id: "bright-eyes",
    name: "Bright eyes",
    slot: "identity",
    minXp: 50,
    removable: false,
  },
  {
    id: "trail-scarf",
    name: "Trail scarf",
    slot: "accessory",
    minXp: 150,
    removable: true,
  },
  {
    id: "star-crown",
    name: "Star crown",
    slot: "accessory",
    minXp: 350,
    removable: true,
  },
  {
    id: "comet-glow",
    name: "Comet glow",
    slot: "aura",
    minXp: 700,
    removable: true,
  },
];
const capturedSource = {
  provider: "github",
  canonical_url: "https://github.com/chog-community/monad-guide",
  fetched_at: "2026-10-20T12:00:00.000Z",
  content_hash: `0x${"d".repeat(64)}`,
  public_content: {
    full_name: "chog-community/monad-guide",
    readme:
      "A public guide to building with Monad.\nThis is the exact source text captured for this browser fixture.",
    description: "Community getting-started guide",
  },
};
const capturedMedia = {
  mediaId: "51111111-2222-4333-8444-555555555555",
  status: "captured",
  url: "/v1/evidence/media/browser-fixture",
  width: 480,
  height: 480,
  mimeType: "image/webp",
};
const fixtureArt = new Map();
function recordedSnapshot(item) {
  const artworkUrl = `/v1/artifacts/browser/${item.id}/${item.version}`;
  const svg = composeDemoChog(item.nft.tokenId, item.stage, {
    equippedTraitIds: item.equippedTraitIds,
    mode: item.nft.mode,
  }).svg;
  if (fixtureArt.has(artworkUrl))
    assert.equal(
      fixtureArt.get(artworkUrl),
      svg,
      "a recorded artwork version must remain immutable",
    );
  fixtureArt.set(artworkUrl, svg);
  return {
    xp: item.xp,
    level: item.level,
    stage: item.stage,
    equippedTraitIds: [...item.equippedTraitIds],
    artworkUrl,
  };
}
const initialSnapshot = recordedSnapshot(profile);
const quest = {
  id: "21111111-2222-4333-8444-555555555555",
  slug: "demo-first-mint",
  name: "Mint your Chog",
  description: "Begin your story with a Chog.",
  kind: "demo_mint",
  xpReward: 50,
};
const claim = {
  id: "31111111-2222-4333-8444-555555555555",
  profileId: profile.id,
  questId: quest.id,
  questName: quest.name,
  questSlug: quest.slug,
  status: "submitted",
  xpAward: 0,
  finalized: false,
  createdAt: "2026-10-19T00:00:00.000Z",
};
const configuration = {
  demo: {
    chainId: 10143,
    collectionAddress: collection,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorerUrl: "https://testnet.monadscan.com",
  },
  mainnet: {
    chainId: 143,
    collectionAddress: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763",
    rpcUrl: "https://rpc.monad.xyz",
    explorerUrl: "https://monadscan.com",
  },
  features: { xLink: true, scans: true, evidence: true },
};
const reportDir = resolve(root, "artifacts/browser");
await mkdir(reportDir, { recursive: true });

async function captureScreenshot(page, options) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.screenshot(options);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHOG_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHOG_CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
} catch (error) {
  await writeFile(resolve(reportDir, "launch-failure.txt"), String(error));
  throw new Error(
    "Browser acceptance could not launch Chromium. See artifacts/browser/launch-failure.txt. Install Chromium with npx playwright install chromium, or run in a host that permits browser IPC.",
    { cause: error },
  );
}

let server;
let serverOutput = "";
try {
  if (!process.env.CHOG_TEST_BASE_URL) {
    server = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/next/dist/bin/next"),
        "start",
        "apps/web",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "production",
          MONGODB_URI: "",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (chunk) => {
        serverOutput = (serverOutput + chunk).slice(-16_000);
      });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null)
        throw new Error(`Next server stopped: ${serverOutput}`);
      try {
        const res = await fetch(`${base}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        /* bounded startup wait */
      }
      await delay(500);
    }
    assert.ok(ready, `Next server did not start: ${serverOutput}`);
  }

  const state = {
    authenticated: false,
    minted: false,
    confirmed: false,
    evidence: [],
    preview: null,
    previewCreates: 0,
    previewRetries: 0,
    previewKeys: [],
    authenticatedWallet: wallet,
    signingWallet: wallet,
    extraProfiles: false,
    history: [],
    traitMutations: [],
    retryActions: 0,
    retryResponses: new Map(),
    loseRetryResponse: true,
    pageRequests: new Set(),
  };
  async function fixtures(context) {
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const path = requestUrl.pathname.replace(/^\/api/, "");
      const cursor = requestUrl.searchParams.get("cursor");
      if (cursor) state.pageRequests.add(path);
      let status = 200;
      let body;
      if (path === "/v1/config") body = configuration;
      else if (path === "/v1/quests")
        body = {
          items: cursor ? [contributionQuest] : [quest],
          nextCursor: cursor ? null : "quests-page-two",
        };
      else if (path === "/v1/traits") body = { items: catalogue, version: 1 };
      else if (path === "/v1/auth/me") {
        status = state.authenticated ? 200 : 401;
        body = state.authenticated
          ? { wallet: state.authenticatedWallet, authenticated: true }
          : { error: "wallet_not_authenticated" };
      } else if (path === "/v1/auth/nonce") {
        state.signingWallet = request.postDataJSON().address;
        body = { message: "CHOG browser acceptance fixture sign-in" };
      } else if (path === "/v1/auth/verify") {
        state.authenticated = true;
        state.authenticatedWallet = state.signingWallet;
        body = { wallet: state.authenticatedWallet, authenticated: true };
      } else if (path === "/v1/auth/logout") {
        await delay(120);
        state.authenticated = false;
        body = { authenticated: false };
      } else if (path === "/v1/profiles" || path === "/v1/profiles/discover")
        body = {
          items:
            state.authenticatedWallet === otherWallet
              ? [otherProfile]
              : state.minted
                ? cursor
                  ? [originalProfile]
                  : [profile]
                : [],
          nextCursor:
            state.minted &&
            state.extraProfiles &&
            !cursor &&
            state.authenticatedWallet !== otherWallet
              ? "profiles-page-two"
              : null,
          partial: false,
        };
      else if (path === "/v1/claims" && request.method() === "GET")
        body = {
          items:
            state.authenticatedWallet === otherWallet
              ? []
              : state.minted
                ? cursor
                  ? state.evidence
                  : [claim]
                : [],
          nextCursor:
            state.authenticatedWallet !== otherWallet &&
            state.evidence.length &&
            !cursor
              ? "claims-page-two"
              : null,
        };
      else if (path === "/v1/social/x") body = { item: null };
      else if (path === "/v1/activity")
        body = {
          items:
            state.authenticatedWallet === otherWallet
              ? []
              : state.minted
                ? cursor
                  ? state.evidence.map((item) => ({
                      ...item,
                      id: `claim:${item.id}`,
                      claimId: item.id,
                      title: item.questName,
                      type: "claim",
                    }))
                  : [
                      {
                        id: "mint-7",
                        title: "Chog #7 joined the family",
                        type: "mint",
                        status: "confirmed",
                        createdAt: claim.createdAt,
                        profileId: profile.id,
                      },
                    ]
                : [],
          nextCursor:
            state.authenticatedWallet !== otherWallet &&
            state.evidence.length &&
            !cursor
              ? "activity-page-two"
              : null,
        };
      else if (path.startsWith("/v1/passports/")) {
        const selected = path.endsWith(originalProfile.id)
          ? originalProfile
          : profile;
        body = {
          item: {
            profile: selected,
            history:
              selected.id === profile.id
                ? cursor
                  ? state.history.slice(1)
                  : state.history.slice(0, 1)
                : [],
            nextCursor:
              selected.id === profile.id && state.history.length > 1 && !cursor
                ? "history-page-two"
                : null,
          },
        };
      } else if (path.startsWith("/v1/artifacts/browser/")) {
        assert.ok(fixtureArt.has(path));
        await route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: fixtureArt.get(path),
        });
        return;
      } else if (path === "/v1/evidence/media/browser-fixture") {
        await route.fulfill({
          status: 200,
          contentType: "image/webp",
          body: await readFile(
            resolve(root, "apps/web/public/brand/chog-hero.webp"),
          ),
        });
        return;
      } else if (path === "/v1/evidence/previews") {
        const data = request.postDataJSON();
        assert.equal(data.profileId, profile.id);
        const key = request.headers()["idempotency-key"];
        assert.ok(key);
        state.previewKeys.push(key);
        if (!state.preview) {
          state.previewCreates++;
          state.preview = {
            id: "61111111-2222-4333-8444-555555555555",
            profileId: profile.id,
            questId: contributionQuest.id,
            status: "source_unavailable",
            source: capturedSource,
            media: [
              {
                ...capturedMedia,
                status: "unavailable",
                errorCode: "media_capture_unavailable",
              },
            ],
            errorCode: "media_capture_unavailable",
            eligibility: {
              eligible: false,
              message: "One source image is unavailable.",
            },
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          };
        }
        body = { item: state.preview };
      } else if (path.startsWith("/v1/evidence/previews/")) {
        assert.ok(state.preview);
        if (path.endsWith("/retry")) {
          assert.ok(request.headers()["idempotency-key"]);
          state.previewRetries++;
          state.preview = {
            ...state.preview,
            status: "ready",
            media: [capturedMedia],
            errorCode: null,
            eligibility: {
              eligible: true,
              rewardXp: 75,
              message: "Source and attribution captured. Ready for review.",
            },
          };
        }
        body = { item: state.preview };
      } else if (/^\/v1\/profiles\/[^/]+\/traits$/.test(path)) {
        const data = request.postDataJSON();
        assert.ok(request.headers()["idempotency-key"]);
        assert.equal(data.expectedVersion, profile.version);
        assert.ok(data.equippedTraitIds.length < 3);
        const before = recordedSnapshot(profile);
        state.traitMutations.push({
          ...data,
          key: request.headers()["idempotency-key"],
        });
        profile.equippedTraitIds = data.equippedTraitIds;
        profile.version++;
        profile.artworkPending = true;
        state.history.push({
          id: `trait-change-${profile.version}`,
          kind: "trait_change",
          previousVersion: profile.version - 1,
          newVersion: profile.version,
          createdAt: new Date().toISOString(),
          outcome: "accepted",
          xpTotal: profile.xp,
          changes: { xpAward: 0, stage: profile.stage },
          before,
          after: recordedSnapshot(profile),
        });
        body = { item: profile };
      } else if (/^\/v1\/claims\/[^/]+(?:\/retry)?$/.test(path)) {
        const id = path.split("/")[3];
        const item = [claim, ...state.evidence].find((row) => row.id === id);
        assert.ok(item, "fixture claim must exist");
        if (path.endsWith("/retry")) {
          const key = request.headers()["idempotency-key"];
          assert.ok(key);
          if (!state.retryResponses.has(key)) {
            state.retryActions++;
            item.attempt++;
            item.canRetry = false;
            item.status = "submitted";
            item.timeline.push({
              id: "retry-event",
              status: "retry_requested",
              attempt: item.attempt,
              createdAt: "2026-10-20T12:01:00.000Z",
              description: "Owner requested another check of the saved source.",
            });
            state.retryResponses.set(key, item);
          }
          if (state.loseRetryResponse) {
            state.loseRetryResponse = false;
            await route.abort("failed");
            return;
          }
          body = { item: state.retryResponses.get(key) };
        } else body = { item };
      } else if (path === "/v1/mints/prepare")
        body = {
          chainId: 10143,
          transaction: { to: collection, data: "0x1249c58b", value: "0x0" },
          supply: { minted: 6, maxSupply: 10000 },
        };
      else if (path === "/v1/mints/confirm") {
        assert.equal(request.postDataJSON().transactionHash, hash);
        state.minted = true;
        state.confirmed = true;
        body = { item: profile, claim };
      } else if (path === "/v1/upgrades/evidence") {
        assert.equal(request.postDataJSON().profileId, profile.id);
        assert.equal(request.postDataJSON().previewId, state.preview.id);
        assert.equal(state.preview.status, "ready");
        assert.ok(request.headers()["idempotency-key"]);
        const item = {
          ...claim,
          id: "41111111-2222-4333-8444-555555555555",
          questName: "Ecosystem contribution",
          evidenceUrl: capturedSource.canonical_url,
          source: capturedSource,
          media: [capturedMedia],
          attempt: 1,
          canRetry: false,
          evidenceHash: capturedSource.content_hash,
          decisionReference: `0x${"e".repeat(64)}`,
          timeline: [
            {
              id: "submitted-event",
              status: "submitted",
              attempt: 1,
              createdAt: claim.createdAt,
              description: "The captured public source is saved for review.",
            },
          ],
        };
        state.evidence.push(item);
        state.preview = {
          ...state.preview,
          status: "consumed",
          claimId: item.id,
        };
        body = { item, duplicate: false };
        status = 202;
      } else {
        status = 404;
        body = { error: "fixture_route_not_defined" };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }

  const violations = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await fixtures(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => violations.push(error.message));
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of [
      "/",
      "/mint",
      "/evolution",
      "/quests",
      "/activity",
      "/profile",
      "/upgrade",
    ]) {
      const response = await page.goto(base + path, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200, path);
      assert.equal(
        await page.locator("main#main-content").count(),
        1,
        `${path} main landmark`,
      );
      assert.ok(
        await page.locator("h1").first().isVisible(),
        `${path} heading must remain visible with reduced motion`,
      );
      const text = await page.locator("body").innerText();
      assert.doesNotMatch(
        text,
        /Original Chog token ID|Monad testnet mint transaction|Local simulated judge|LOCAL SIMULATION DISABLED|DEVELOPER WALKTHROUGH/,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      );
      assert.equal(
        overflow,
        false,
        `${path} horizontal overflow at ${viewport.width}px`,
      );
      await captureScreenshot(page, {
        path: resolve(
          reportDir,
          `${viewport.width}-${path === "/" ? "story" : path.slice(1)}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await context.close();

  const walletContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await fixtures(walletContext);
  await walletContext.addInitScript(
    ({ wallet, hash }) => {
      const listeners = {};
      const account = () =>
        localStorage.getItem("test-wallet-address") || wallet;
      window.testSwitchWallet = (next) => {
        localStorage.setItem("test-wallet-address", next);
        for (const listener of listeners.accountsChanged || [])
          listener([next]);
      };
      window.ethereum = {
        on(event, callback) {
          (listeners[event] ??= []).push(callback);
        },
        removeListener(event, callback) {
          listeners[event] = (listeners[event] || []).filter(
            (fn) => fn !== callback,
          );
        },
        async request({ method, params }) {
          if (method === "eth_accounts")
            return localStorage.getItem("test-wallet-connected")
              ? [account()]
              : [];
          if (method === "eth_requestAccounts") {
            localStorage.setItem("test-wallet-connected", "1");
            return [account()];
          }
          if (method === "eth_chainId")
            return localStorage.getItem("test-wallet-chain") || "0x1";
          if (
            method === "wallet_switchEthereumChain" ||
            method === "wallet_addEthereumChain"
          ) {
            localStorage.setItem("test-wallet-chain", params[0].chainId);
            return null;
          }
          if (method === "personal_sign") return `0x${"a".repeat(130)}`;
          if (method === "eth_sendTransaction") {
            localStorage.setItem(
              "test-send-count",
              String(Number(localStorage.getItem("test-send-count") || 0) + 1),
            );
            return hash;
          }
          if (method === "eth_getTransactionReceipt")
            return localStorage.getItem("test-receipt-ready")
              ? { status: "0x1", transactionHash: hash, logs: [] }
              : null;
          throw new Error(`Unexpected wallet request: ${method}`);
        },
      };
    },
    { wallet, hash },
  );
  const walletPage = await walletContext.newPage();
  walletPage.on("pageerror", (error) => violations.push(error.message));
  await walletPage.goto(base + "/mint", { waitUntil: "networkidle" });
  await walletPage
    .getByRole("button", { name: "Mint a Chog", exact: true })
    .click();
  await walletPage.waitForFunction(
    (address) =>
      !!localStorage.getItem(`chog:pending-mint:${address.toLowerCase()}`),
    wallet,
  );
  assert.equal(
    await walletPage.evaluate(() => localStorage.getItem("test-send-count")),
    "1",
  );
  await walletPage.evaluate(() =>
    localStorage.setItem("test-receipt-ready", "1"),
  );
  await walletPage.reload({ waitUntil: "networkidle" });
  await walletPage
    .getByRole("link", { name: "Meet your Chog", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(state.confirmed, true);
  assert.equal(
    await walletPage.evaluate(() => localStorage.getItem("test-send-count")),
    "1",
    "refresh must not mint again",
  );
  await walletPage.goto(base + "/upgrade", { waitUntil: "networkidle" });
  await walletPage
    .getByLabel("Your contribution link")
    .fill("https://github.com/chog-community/monad-guide");
  await walletPage
    .getByLabel("A little context")
    .fill("A saved contribution draft.");
  await walletPage.reload({ waitUntil: "networkidle" });
  assert.equal(
    await walletPage.getByLabel("A little context").inputValue(),
    "A saved contribution draft.",
  );
  await walletPage
    .getByRole("button", { name: "Preview contribution", exact: true })
    .click();
  await walletPage.getByText("Source unavailable", { exact: true }).waitFor();
  assert.equal(
    await walletPage
      .getByRole("button", { name: "Submit for review", exact: true })
      .count(),
    0,
    "incomplete images must not allow submission",
  );
  await walletPage.reload({ waitUntil: "networkidle" });
  await walletPage.getByText("Source unavailable", { exact: true }).waitFor();
  await walletPage
    .getByRole("button", { name: "Retry saved preview", exact: true })
    .click();
  await walletPage.getByText("Preview ready", { exact: true }).waitFor();
  assert.equal(state.previewCreates, 1, "retry reuses the persisted preview");
  assert.equal(state.previewRetries, 1);
  await walletPage.reload({ waitUntil: "networkidle" });
  await walletPage
    .getByRole("button", { name: "Submit for review", exact: true })
    .waitFor();
  assert.match(
    await walletPage.locator(".source-text").innerText(),
    /exact source text/,
  );
  assert.equal(await walletPage.locator(".source-media img").count(), 1);
  await captureScreenshot(walletPage, {
    path: resolve(reportDir, "1280-saved-preview.png"),
    fullPage: true,
  });
  await walletPage
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await walletPage
    .getByText(/Your contribution is saved for GenLayer review/)
    .waitFor();
  assert.equal(state.evidence.length, 1);
  await walletPage
    .getByRole("link", { name: "Open saved review", exact: true })
    .click();
  await walletPage
    .getByRole("heading", { name: "Review timeline", exact: true })
    .waitFor();
  await walletPage.locator(".review-references summary").click();
  assert.match(
    await walletPage.locator(".review-references").innerText(),
    /GenLayer decision/,
  );
  state.evidence[0].status = "source_unavailable";
  state.evidence[0].canRetry = true;
  state.evidence[0].timeline.push({
    id: "unavailable-event",
    status: "source_unavailable",
    attempt: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
    description: "Source access was interrupted.",
  });
  await walletPage
    .getByRole("button", { name: "Refresh review", exact: true })
    .click();
  await walletPage
    .getByRole("button", { name: "Retry this review", exact: true })
    .click();
  await walletPage
    .getByRole("alert")
    .filter({ hasText: /couldn’t reach Chog/ })
    .waitFor();
  await walletPage
    .getByRole("button", { name: "Retry this review", exact: true })
    .click();
  await walletPage.getByText(/The retry is saved on this review/).waitFor();
  assert.equal(
    state.retryActions,
    1,
    "a lost retry response must replay the same operation",
  );
  assert.equal(state.evidence[0].attempt, 2);
  assert.equal(state.evidence.length, 1, "retry must keep the stable claim");
  await walletPage.reload({ waitUntil: "networkidle" });
  await walletPage
    .getByRole("heading", { name: "Review timeline", exact: true })
    .waitFor();
  assert.equal(
    await walletPage.locator(".review-timeline > li").count(),
    3,
    "reload preserves prior review attempts",
  );
  await walletPage.goto(base + "/profile", { waitUntil: "networkidle" });
  const progress = walletPage.getByRole("progressbar");
  await progress.waitFor({ state: "visible" });
  assert.equal(
    await progress.getAttribute("aria-valuenow"),
    "0",
    "submitted evidence must not display fabricated XP",
  );

  // Higher XP below is an explicit server fixture. It tests earned inventory,
  // immutable snapshots and cap copy, not a live GenLayer reward.
  Object.assign(profile, {
    xp: 350,
    level: 4,
    stage: "veteran",
    version: 1,
    earnedTraitIds: ["bright-eyes", "trail-scarf", "star-crown"],
    equippedTraitIds: ["star-crown"],
  });
  state.history.push({
    id: "reward-event",
    claimId: state.evidence[0].id,
    kind: "claim",
    previousVersion: 0,
    newVersion: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
    outcome: "accepted",
    questName: "Recorded XP reward",
    changes: { xpAward: 350, stage: "veteran" },
    xpTotal: 350,
    before: initialSnapshot,
    after: recordedSnapshot(profile),
  });
  await walletPage.reload({ waitUntil: "networkidle" });
  await walletPage.getByRole("radio", { name: /Trail scarf/ }).focus();
  await walletPage.keyboard.press("Space");
  await walletPage
    .getByRole("button", { name: "Save my look", exact: true })
    .click();
  await walletPage.getByText(/Your new look is saved/).waitFor();
  assert.deepEqual(
    profile.equippedTraitIds,
    ["trail-scarf"],
    "accessory selection replaces the previously equipped trait",
  );
  assert.equal(profile.xp, 350, "cosmetic changes award no XP");
  assert.equal(
    await walletPage.getByRole("radio", { name: /Comet glow/ }).isDisabled(),
    true,
    "locked traits cannot be selected",
  );
  await walletPage.getByRole("radio", { name: /No accessory/ }).check();
  await walletPage
    .getByRole("button", { name: "Save my look", exact: true })
    .click();
  await walletPage.getByText(/Your new look is saved/).waitFor();
  assert.deepEqual(
    profile.equippedTraitIds,
    [],
    "optional traits can be removed",
  );
  assert.equal(state.traitMutations.length, 2);
  assert.equal(state.traitMutations[0].expectedVersion, 1);
  assert.equal(state.traitMutations[1].expectedVersion, 2);
  assert.notEqual(state.traitMutations[0].key, state.traitMutations[1].key);
  await walletPage.goto(base + "/evolution", { waitUntil: "networkidle" });
  await walletPage
    .getByRole("button", { name: "Load more history", exact: true })
    .click();
  await walletPage
    .getByText("Cosmetic change · No XP awarded", { exact: true })
    .first()
    .waitFor();
  assert.equal(await walletPage.locator(".history-comparison").count(), 3);
  assert.equal(
    await walletPage
      .locator(".history-snapshot figcaption")
      .filter({ hasText: "Before" })
      .count(),
    3,
  );
  await captureScreenshot(walletPage, {
    path: resolve(reportDir, "1280-history-comparison.png"),
    fullPage: true,
  });
  await walletPage.goto(base + "/activity", { waitUntil: "networkidle" });
  await walletPage
    .getByRole("link", { name: "View review", exact: true })
    .waitFor();
  for (const path of [
    "/v1/quests",
    "/v1/claims",
    "/v1/activity",
    `/v1/passports/${profile.id}`,
  ])
    assert.ok(
      state.pageRequests.has(path),
      `${path} must read the next cursor`,
    );

  state.extraProfiles = true;
  await walletPage.goto(base + "/profile", { waitUntil: "networkidle" });
  await walletPage
    .getByLabel("Choose your Chog")
    .selectOption(originalProfile.id);
  await walletPage.getByText("Original NFT", { exact: true }).waitFor();
  await walletPage
    .getByText(/Showing the last retrieved original artwork/)
    .waitFor();
  assert.equal(
    await walletPage.locator(".original-image img").getAttribute("src"),
    originalProfile.originalMetadata.imageUrl,
    "an unavailable metadata refresh keeps the recorded original artwork",
  );
  await walletPage.reload({ waitUntil: "networkidle" });
  assert.equal(
    await walletPage.getByLabel("Choose your Chog").inputValue(),
    originalProfile.id,
    "selected Chog survives refresh",
  );
  await walletPage
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await walletPage
    .locator("main")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  assert.equal(
    await walletPage.getByLabel("Choose your Chog").inputValue(),
    originalProfile.id,
    "signing back into the same wallet restores its selected Chog",
  );
  assert.ok(
    state.pageRequests.has("/v1/profiles"),
    "profile selector must include paged Chogs",
  );
  assert.match(
    await walletPage.locator(".identity-artworks").innerText(),
    /Evolution companion/,
  );
  await captureScreenshot(walletPage, {
    path: resolve(reportDir, "1280-original-companion.png"),
    fullPage: true,
  });
  await walletPage.goto(base + "/upgrade", { waitUntil: "networkidle" });
  await walletPage
    .getByLabel("Your contribution link")
    .fill("https://x.com/chog/status/1234567890");
  await walletPage
    .getByLabel("A little context")
    .fill("Only the first wallet can see this draft.");
  await walletPage.evaluate(
    (next) => window.testSwitchWallet(next),
    otherWallet,
  );
  await walletPage
    .locator("main")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .waitFor();
  assert.equal(
    await walletPage.getByLabel("Your contribution link").count(),
    0,
    "account switch immediately hides previous drafts",
  );
  await walletPage
    .locator("main")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await walletPage.getByLabel("Your contribution link").waitFor();
  assert.equal(
    await walletPage.getByLabel("Your contribution link").inputValue(),
    "",
    "another wallet starts with its own empty draft",
  );
  assert.equal(
    await walletPage.getByLabel("A little context").inputValue(),
    "",
  );
  await walletPage.evaluate((next) => window.testSwitchWallet(next), wallet);
  await walletPage
    .locator("main")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await walletPage.getByLabel("Your contribution link").waitFor();
  assert.equal(
    await walletPage.getByLabel("A little context").inputValue(),
    "Only the first wallet can see this draft.",
  );
  await walletPage.reload({ waitUntil: "networkidle" });
  assert.equal(
    await walletPage.getByLabel("A little context").inputValue(),
    "Only the first wallet can see this draft.",
  );

  state.evidence[0].status = "accepted";
  state.evidence[0].finalized = true;
  state.evidence[0].xpAward = 0;
  state.evidence[0].reasonCode = "contribution_daily_cap";
  state.evidence[0].explanation =
    "The contribution qualified. This UTC day’s contribution reward limit has been reached.";
  const publicContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await fixtures(publicContext);
  const publicPage = await publicContext.newPage();
  publicPage.on("pageerror", (error) => violations.push(error.message));
  await publicPage.goto(`${base}/claims/${state.evidence[0].id}`, {
    waitUntil: "networkidle",
  });
  await publicPage
    .getByRole("heading", { name: "Review timeline", exact: true })
    .waitFor();
  assert.match(await publicPage.locator(".reward-reason").innerText(), /75 XP/);
  assert.equal(
    await publicPage.locator(".review-reward strong").innerText(),
    "+0 XP",
  );
  assert.equal(
    await publicPage
      .getByRole("button", { name: "Retry this review", exact: true })
      .count(),
    0,
  );
  await captureScreenshot(publicPage, {
    path: resolve(reportDir, "390-public-review.png"),
    fullPage: true,
  });
  await publicContext.close();
  await walletPage.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [
    ["profile-traits", "/profile"],
    ["saved-draft", "/upgrade"],
    ["evolution", "/evolution"],
    ["passport", `/passport/${profile.id}`],
    ["claim", `/claims/${state.evidence[0].id}`],
  ]) {
    await walletPage.goto(base + path, { waitUntil: "networkidle" });
    if (name === "profile-traits") {
      await walletPage.getByText("Original NFT", { exact: true }).waitFor();
      await walletPage.getByRole("radio", { name: /Trail scarf/ }).waitFor();
      await captureScreenshot(walletPage, {
        path: resolve(reportDir, "390-original-companion.png"),
        fullPage: true,
      });
      await walletPage.getByLabel("Choose your Chog").selectOption(profile.id);
      await walletPage
        .getByRole("heading", { name: profile.displayName, exact: true })
        .waitFor();
    } else if (name === "saved-draft") {
      await walletPage.getByLabel("A little context").waitFor();
      assert.equal(
        await walletPage.getByLabel("A little context").inputValue(),
        "Only the first wallet can see this draft.",
      );
    } else if (name === "evolution" || name === "passport") {
      if (name === "evolution")
        await walletPage
          .getByLabel("Choose your Chog")
          .selectOption(profile.id);
      await walletPage
        .getByRole("button", { name: "Load more history", exact: true })
        .click();
      await walletPage.locator(".history-comparison").nth(2).waitFor();
    } else {
      await walletPage
        .getByRole("heading", { name: "Review timeline", exact: true })
        .waitFor();
    }
    assert.equal(
      await walletPage.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      ),
      false,
      `${name} signed-in mobile overflow`,
    );
    await captureScreenshot(walletPage, {
      path: resolve(reportDir, `390-${name}.png`),
      fullPage: true,
    });
    if (name === "profile-traits")
      await walletPage
        .getByLabel("Choose your Chog")
        .selectOption(originalProfile.id);
  }
  await walletContext.close();
  assert.deepEqual(violations, [], "browser runtime errors");
  console.log(
    "BROWSER ACCEPTANCE VERIFIED (desktop/mobile routes, one-send mint recovery, persisted preview and drafts, lost retry response, trait replacement/removal, before/after history, public claim, account isolation and pagination; test fixtures, not live chain proof)",
  );
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise((done) => server.once("exit", done));
    server.kill("SIGTERM");
    await Promise.race([stopped, delay(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
