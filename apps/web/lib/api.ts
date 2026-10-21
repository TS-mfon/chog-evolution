import type { Page } from "./types";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "/api"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  timeout?: number;
};

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, timeout = 30_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => null)) as
      (T & { error?: string }) | null;
    if (!response.ok || result?.error)
      throw new ApiError(
        result?.error || "service_unavailable",
        response.status,
      );
    if (result === null)
      throw new ApiError("service_unavailable", response.status);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (init.signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    if (controller.signal.aborted)
      throw new UserError(
        "This is taking longer than expected. Please try again shortly.",
      );
    throw new UserError(
      "We couldn’t reach Chog right now. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

const messages: Record<string, string> = {
  wallet_not_authenticated:
    "Your sign-in has expired. Connect your wallet again to continue.",
  wallet_reauthentication_required:
    "Please sign in again so your contribution can be verified. Your draft is saved.",
  wallet_signature_invalid_or_challenge_expired:
    "That sign-in expired. Please connect your wallet and sign a fresh message.",
  wallet_changed:
    "Your wallet changed. Please try again with your selected account.",
  mint_sold_out:
    "All Chogs in this demo collection have been minted. You can still find a Chog you already own.",
  mint_not_ready: "Minting is not open yet. Please check back soon.",
  mint_receipt_pending:
    "Your mint is still confirming. We’ve saved it so you can safely check again.",
  mint_not_owned_by_wallet:
    "This Chog belongs to a different wallet. Connect the wallet you used to mint it.",
  mint_invalid_transaction:
    "We couldn’t verify this mint yet. Try checking again, or find the Chogs in your wallet.",
  mint_transaction_failed:
    "The mint didn’t complete. No Chog was minted. You can try again.",
  insufficient_funds:
    "You need a little testnet MON to cover the network fee. Add testnet MON to your wallet and try again.",
  nft_not_currently_owned_by_authenticated_wallet:
    "This Chog is no longer in your connected wallet. Refresh your collection to choose another.",
  profile_not_found_for_wallet:
    "We couldn’t find this Chog in your wallet. Refresh your collection and try again.",
  valid_x_username_required:
    "Enter your X username, using letters, numbers or underscores.",
  x_profile_not_found:
    "We couldn’t find that X profile. Check your username and try again.",
  x_bio_code_not_found:
    "The code isn’t in your public X bio yet. Save your bio, then try verifying again.",
  x_bio_challenge_missing_or_expired:
    "Your code has expired. Get a new code and add it to your X bio.",
  x_profile_already_linked_to_another_wallet:
    "That X account is connected to another wallet. Disconnect it there first.",
  x_api_unconfigured:
    "X linking is not available yet. Your Chog and other quests are still here.",
  x_profile_verification_unavailable:
    "X verification is temporarily unavailable. Your code is saved; please try again shortly.",
  verified_bio_link_required:
    "Connect your X profile on My Chog before claiming this quest.",
  evidence_host_not_allowed_by_quest_policy:
    "This quest doesn’t accept links from that site. Use one of the supported sources shown here.",
  evidence_host_not_allowed:
    "This source isn’t supported yet. Try a public X post or GitHub repository.",
  github_wallet_attribution_required:
    "Add your connected wallet address to this repository’s README so we can confirm it’s yours, then submit again.",
  github_repository_url_required:
    "Share the main page of your GitHub repository, such as github.com/you/your-project.",
  github_public_repository_required:
    "This repository needs to be public so your contribution can be reviewed.",
  github_readme_required:
    "Add a README to your public repository so the reviewer can understand your contribution.",
  x_profile_link_required:
    "Connect your X profile on My Chog before sharing your post for review. Your draft is saved.",
  x_post_url_required:
    "Share a link to a specific X post, rather than your profile page.",
  evidence_author_not_linked_to_wallet:
    "This post belongs to a different X profile. Connect that profile on My Chog, then try again.",
  x_evidence_provider_unconfigured:
    "X post reviews are not available yet. You can still share a public GitHub contribution.",
  evidence_provider_rate_limited:
    "The contribution source is busy right now. Your draft is saved; please try again shortly.",
  contribution_review_unavailable:
    "Contribution reviews are not available right now. Your draft is saved; check back soon.",
  evidence_source_not_found:
    "We couldn’t find that contribution. Check that the link is correct and public.",
  evidence_source_unavailable:
    "We couldn’t read that contribution right now. Your draft is saved; please try again shortly.",
  supported_evidence_url_required:
    "Share a complete HTTPS link to a public X post or GitHub repository.",
  evidence_url_not_allowed:
    "Share a direct HTTPS link to your X post or GitHub repository.",
  verified_evidence_required:
    "This quest needs verified activity. Connect your X profile or check your ecosystem activity, then try again.",
  valid_public_evidence_url_required:
    "Enter a complete, public link, such as an X post or GitHub repository.",
  invalid_evidence_url:
    "Enter a complete, public link beginning with https://.",
  public_evidence_required:
    "Add a public link to the contribution you’d like reviewed.",
  evidence_unavailable:
    "We couldn’t read that contribution. Make sure the link is public and try again.",
  quest_inactive_or_policy_stale:
    "This quest is no longer available. Refresh the quest board for the latest quests.",
  scan_already_running:
    "Your wallet is already being checked. Wait a moment, then refresh your activity.",
  scan_targets_unconfigured:
    "Ecosystem scanning is not open yet. You can still share a contribution for review.",
  scan_targets_not_configured_for_profile_chain:
    "Ecosystem scanning is not open yet. You can still share a contribution for review.",
  evidence_review_not_ready:
    "Contribution reviews are not open yet. Keep your link and check back soon.",
  passport_not_found:
    "This Chog’s passport could not be found. Check the link or return to your collection.",
  claim_not_found:
    "This review could not be found. Check the link or open your activity.",
  profile_version_conflict:
    "Your Chog changed while you were choosing traits. Its latest look is loaded; choose again to save.",
  invalid_or_locked_traits:
    "Choose an earned trait for each slot. New traits unlock as your Chog gains XP.",
  idempotency_conflict:
    "This action has already been saved with different details. Refresh to see the latest result.",
  preview_not_found:
    "That preview is no longer available. Your draft is saved; capture the source again.",
  preview_expired:
    "This preview has expired. Capture the source again before submitting; your draft is saved.",
  preview_not_ready:
    "Your source is still being captured. Wait for the preview before submitting.",
  preview_already_submitted:
    "This preview has already been submitted. Open your reviews to see its progress.",
  evidence_preview_invalid_or_expired:
    "Your preview needs to be refreshed before review. Your draft is saved.",
  preview_unavailable_or_ineligible:
    "Your saved preview needs another check before it can be submitted. Refresh the preview; your draft is saved.",
  preview_request_mismatch:
    "This draft no longer matches its saved preview. Preview the current contribution before submitting.",
  preview_snapshot_invalid:
    "The saved source could not be verified. Refresh the preview to capture it again.",
  claim_retry_not_allowed:
    "This review cannot be retried in its current state. Refresh to see its latest progress.",
  retry_not_allowed:
    "This review cannot be retried in its current state. Refresh to see its latest progress.",
  x_source_disabled:
    "Public X posts are temporarily unavailable. Your draft is saved; you can also share a public GitHub repository.",
  media_capture_unavailable:
    "An image from this source couldn’t be captured yet. Retry the saved preview to continue.",
  contribution_daily_cap:
    "This wallet has already used its contribution reward for this UTC day. One qualifying contribution earns 75 XP per day; further qualifying contributions earn 0 XP.",
  contribution_cooldown:
    "At least one hour must separate rewarded contributions, including across UTC days. Reviews can continue; eligibility is checked when each review is final.",
};

export function reasonMessage(code?: string | null): string | undefined {
  if (!code) return undefined;
  if (messages[code]) return messages[code];
  if (/daily.*cap|daily.*limit|cap.*reached/.test(code))
    return messages.contribution_daily_cap;
  if (/cooldown/.test(code)) return messages.contribution_cooldown;
  if (/duplicate/.test(code))
    return "This contribution already has a saved review. A source earns rewards only once.";
  return undefined;
}

export function friendlyError(error: unknown): string {
  if (error instanceof UserError) return error.message;
  if (error instanceof ApiError) {
    if (messages[error.code]) return messages[error.code]!;
    if (error.status === 429)
      return "A few too many requests. Give it a minute, then try again.";
    if (error.status === 401) return messages.wallet_not_authenticated!;
    if (
      error.code.includes("mint") &&
      (error.code.includes("unconfigured") || error.code.includes("not_ready"))
    )
      return messages.mint_not_ready!;
    if (error.code.includes("scan") && error.code.includes("unconfigured"))
      return messages.scan_targets_unconfigured!;
    if (error.code.includes("evidence") && error.code.includes("url"))
      return messages.invalid_evidence_url!;
    if (error.code.includes("unconfigured") || error.code.includes("not_ready"))
      return "This part of Chog isn’t available yet. Please check back soon.";
    if (error.status >= 500)
      return "Chog is having trouble reaching this service. Please try again shortly.";
    return "We couldn’t finish that request. Refresh your information and try again.";
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number(error.code)
      : 0;
  if (code === 4001 || code === 5000)
    return "Request cancelled in your wallet. You can try again whenever you’re ready.";
  if (code === -32002)
    return "A request is already open in your wallet. Open your wallet to finish it.";
  if (code === 4900 || code === 4901)
    return "Your wallet is offline. Reconnect it and try again.";
  const raw = error instanceof Error ? error.message.toLowerCase() : "";
  if (raw.includes("insufficient funds")) return messages.insufficient_funds!;
  if (raw.includes("user rejected") || raw.includes("user denied"))
    return "Request cancelled in your wallet. You can try again whenever you’re ready.";
  return "Something interrupted this step. Please try again.";
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function safeUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function artifactUrl(value?: string | null): string | undefined {
  if (value?.startsWith("/v1/")) return `${API_BASE}${value}`;
  return safeUrl(value);
}

export function pagePath(path: string, cursor?: string | null): string {
  return `${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
}

// Wallet collections drive selection and totals, so read every page rather
// than quietly presenting the first page as the full collection.
export async function collectionPages<T extends { id: string }>(
  path: string,
  request: <R>(path: string, options?: RequestOptions) => Promise<R> = api,
  options: RequestOptions = {},
): Promise<T[]> {
  const items = new Map<string, T>();
  const seen = new Set<string>();
  let cursor: string | null | undefined;
  do {
    const page = await request<Page<T>>(pagePath(path, cursor), options);
    for (const item of page.items || []) if (item) items.set(item.id, item);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new UserError(
        "The rest of your collection couldn’t load. Refresh to try again.",
      );
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...items.values()];
}

export function idempotencyKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export async function copyText(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new UserError("Copy the text shown here using your browser.");
  }
  await navigator.clipboard.writeText(value);
}

export function titleCase(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function dateLabel(value?: string): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function timeLabel(value?: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return "Time not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export const STAGES = [
  {
    name: "Hatchling",
    xp: 0,
    description: "A small beginning. An enormous amount of potential.",
  },
  {
    name: "Curious",
    xp: 50,
    description: "First steps, new friends, and a taste for adventure.",
  },
  {
    name: "Explorer",
    xp: 150,
    description: "A little braver. A little weirder. Entirely your own.",
  },
  {
    name: "Veteran",
    xp: 350,
    description: "The stories show. Every quill has been earned.",
  },
  {
    name: "Legend",
    xp: 700,
    description: "A living piece of the world you helped build.",
  },
] as const;

export function progression(xp: number) {
  const current =
    [...STAGES].reverse().find((stage) => xp >= stage.xp) ?? STAGES[0];
  const next = STAGES.find((stage) => stage.xp > xp);
  const percent = next
    ? Math.min(
        100,
        Math.max(0, ((xp - current.xp) / (next.xp - current.xp)) * 100),
      )
    : 100;
  return { current, next, percent, remaining: next ? next.xp - xp : 0 };
}

export function isPending(status: string): boolean {
  return [
    "submitted",
    "verifying",
    "awaiting_genlayer",
    "needs_review",
    "queued",
    "running",
    "pending",
  ].includes(status);
}

export function statusLabel(status: string): string {
  return (
    (
      {
        submitted: "Queued for review",
        verifying: "Checking contribution",
        awaiting_genlayer: "GenLayer reviewing",
        needs_review: "In review",
        accepted: "Accepted",
        rejected: "Not accepted",
        source_unavailable: "Source unavailable",
        unresolved: "Review needs attention",
        complete: "Complete",
        completed: "Complete",
        confirmed: "Confirmed",
        failed: "Needs attention",
        partial: "More to discover",
        running: "Checking activity",
        pending: "Pending",
        queued: "Queued",
        minted: "Minted",
        reading: "Reading source",
        ready: "Preview ready",
        expired: "Preview expired",
        consumed: "Submitted for review",
        retry_requested: "Retry saved",
        stale: "Refresh needed",
      } as Record<string, string>
    )[status] || titleCase(status)
  );
}
