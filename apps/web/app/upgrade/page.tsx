"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useChog } from "../../components/chog-provider";
import { EvidenceForm } from "../../components/evidence-form";
import { Icon } from "../../components/icons";
import { AccountNavigation } from "../../components/site-shell";
import {
  ChogArtwork,
  ClaimList,
  Notice,
  PageHeader,
  ProfileGate,
  ProfilePicker,
  Progress,
  StatusBadge,
} from "../../components/ui";
import {
  ApiError,
  friendlyError,
  isAbort,
  isPending,
  safeUrl,
} from "../../lib/api";
import type { Claim, Scan } from "../../lib/types";

function checkedWindow(scan: Scan): string | null {
  const from = scan.coverage?.fromTime;
  const to = scan.coverage?.toTime;
  if (
    !from ||
    !to ||
    Number.isNaN(Date.parse(from)) ||
    Number.isNaN(Date.parse(to))
  )
    return null;
  const format = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `Activity checked: ${format.format(new Date(from))} – ${format.format(new Date(to))}.`;
}

export default function UpgradePage() {
  const {
    profile,
    address,
    signedIn,
    claims,
    claimError,
    request,
    ensureSession,
    addClaim,
    refreshData,
  } = useChog();
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [message, setMessage] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const profileId = profile?.id;
  const currentProfile = useRef(profileId);
  currentProfile.current = profileId;
  const scanController = useRef<AbortController | null>(null);
  const storageKey = `chog:scan:${address.toLowerCase()}:${profileId || ""}`;

  useEffect(() => {
    setScan(null);
    setScanError("");
    setMessage("");
    setHasMore(false);
    setBusy(false);
    scanController.current?.abort();
    if (!profileId || !signedIn) return;
    const controller = new AbortController();
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      /* A scan can be started without local history. */
    }
    if (saved)
      void request<{ item: Scan }>(`/v1/scans/${encodeURIComponent(saved)}`, {
        signal: controller.signal,
      })
        .then((result) => {
          setScan(result.item);
          setHasMore(result.item.status === "partial");
        })
        .catch((cause) => {
          if (!isAbort(cause)) setScanError(friendlyError(cause));
        });
    return () => {
      controller.abort();
      scanController.current?.abort();
    };
  }, [profileId, signedIn, storageKey, request]);

  useEffect(() => {
    if (!scan || !["running", "pending", "queued"].includes(scan.status))
      return;
    let attempts = 0;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++attempts > 20) {
        window.clearInterval(interval);
        return;
      }
      void request<{ item: Scan }>(`/v1/scans/${encodeURIComponent(scan.id)}`, {
        signal: controller.signal,
      })
        .then((result) => {
          setScan(result.item);
          setHasMore(result.item.status === "partial");
        })
        .catch((cause) => {
          if (!isAbort(cause)) setScanError(friendlyError(cause));
        });
    }, 5000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [scan?.id, scan?.status, request]);

  async function rescan() {
    if (!profileId || busy) return;
    const selected = profileId;
    const controller = new AbortController();
    scanController.current = controller;
    setBusy(true);
    setScanError("");
    setMessage(
      "Checking your recent Monad activity. This can take a moment if you’ve been busy.",
    );
    try {
      await ensureSession();
      const result = await request<{
        item: Scan;
        claims?: Claim[];
        next?: string | null;
      }>("/v1/scans", {
        method: "POST",
        body: { profileId: selected },
        signal: controller.signal,
        timeout: 120_000,
      });
      if (currentProfile.current !== selected || controller.signal.aborted)
        return;
      setScan(result.item);
      setHasMore(!!result.next || result.item.status === "partial");
      const evaluations = result.claims || result.item.claims || [];
      for (const claim of evaluations)
        addClaim({ ...claim, profileId: claim.profileId || selected });
      try {
        localStorage.setItem(storageKey, result.item.id);
      } catch {
        /* Results remain available in wallet activity. */
      }
      const count = result.item.events?.length || 0;
      const queued = evaluations.filter((claim) =>
        isPending(claim.status),
      ).length;
      const reviewErrors =
        result.item.events?.filter((event) => event.reviewErrorCode).length ||
        0;
      setMessage(
        reviewErrors
          ? `Found ${count} interaction${count === 1 ? "" : "s"}. ${reviewErrors} contribution${reviewErrors === 1 ? " needs" : "s need"} another review check. Try checking again to continue.`
          : queued
            ? `${queued} contribution${queued === 1 ? " is" : "s are"} in review. Your Chog will update after the decisions are final.`
            : evaluations.some((claim) => claim.status === "accepted")
              ? "Your recent activity has been checked. Accepted contributions are included in your Chog’s story."
              : count
                ? `Found ${count} interaction${count === 1 ? "" : "s"}. None matched a new eligible quest in this check.`
                : result.next || result.item.status === "partial"
                  ? "No new interactions in this part of your recent history. There’s more to check."
                  : "No new eligible interactions were found in this check of your recent activity.",
      );
      await refreshData();
    } catch (cause) {
      if (!isAbort(cause) && currentProfile.current === selected) {
        setScanError(friendlyError(cause));
        setMessage("");
      }
    } finally {
      if (scanController.current === controller) setBusy(false);
    }
  }

  const profileClaims = claims.filter((claim) => claim.profileId === profileId);
  const pending = profileClaims.filter((claim) => isPending(claim.status));
  return (
    <main id="main-content" className="product-page section-width">
      <AccountNavigation />
      <PageHeader
        eyebrow="THERE’S MORE TO YOU. AND YOUR CHOG."
        title="Ready for what’s next?"
        description="Turn the things you do into the story your Chog carries."
      >
        <ProfilePicker />
      </PageHeader>
      <ProfileGate>
        {profile && (
          <>
            <section
              className="upgrade-overview"
              aria-label="Your Chog’s progress"
            >
              <div className="upgrade-chog">
                <ChogArtwork profile={profile} />
                <div>
                  <span className="eyebrow">YOUR NEXT CHAPTER</span>
                  <h2>{profile.displayName}</h2>
                  <p>Every accepted contribution counts.</p>
                </div>
              </div>
              <Progress profile={profile} />
            </section>
            <section className="scan-section" aria-labelledby="scan-heading">
              <div className="scan-copy">
                <span className="section-number">01</span>
                <div>
                  <span className="eyebrow">ALREADY OUT THERE EXPLORING?</span>
                  <h2 id="scan-heading">
                    Your activity.
                    <br />A little more possibility.
                  </h2>
                  <p>
                    We’ll check your recent Monad mainnet activity and send
                    eligible contributions for review. You just bring the
                    curiosity.
                  </p>
                  <span className="network-label">
                    <span className="tiny-dot" />
                    RECENT MONAD MAINNET ACTIVITY
                  </span>
                </div>
              </div>
              <div className="scan-action">
                <div className={`scan-orbit ${busy ? "is-checking" : ""}`}>
                  <Icon name="globe" size={52} />
                  <span className="scan-orbit-star">
                    <Icon name="spark" size={20} />
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void rescan()}
                >
                  <Icon
                    name={busy ? "refresh" : "spark"}
                    size={18}
                    className={busy ? "spin" : ""}
                  />
                  {busy
                    ? "Checking your activity…"
                    : hasMore
                      ? "Continue checking activity"
                      : "Check for an evolution"}
                </button>
                <p className="caption">
                  No wallet transaction needed.
                  <br />
                  Your Chog evolves when eligible XP is accepted.
                </p>
              </div>
            </section>
            {message && <Notice>{message}</Notice>}
            {scanError && (
              <Notice
                tone="error"
                action={
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void rescan()}
                  >
                    Try again
                  </button>
                }
              >
                {scanError}
              </Notice>
            )}
            {scan && (
              <section
                className="scan-results"
                aria-labelledby="scan-results-heading"
              >
                <div className="section-heading">
                  <h3 id="scan-results-heading">Your latest check</h3>
                  <StatusBadge status={scan.status} />
                </div>
                {checkedWindow(scan) && (
                  <p className="scan-coverage">{checkedWindow(scan)}</p>
                )}
                {scan.errorCode && (
                  <p className="inline-message is-error">
                    Part of the check couldn’t finish. Try again to continue
                    from where we left off.
                  </p>
                )}
                {scan.events?.length ? (
                  <ul>
                    {scan.events.map((event, index) => {
                      const receipt = safeUrl(event.transactionUrl);
                      const review = [...(scan.claims || []), ...claims].find(
                        (claim) => claim.id === event.claimId,
                      );
                      return (
                        <li
                          key={
                            event.id ||
                            `${event.txHash || index}:${event.targetName}`
                          }
                        >
                          <span className="event-check">
                            <Icon name="check" size={15} />
                          </span>
                          <div>
                            <strong>{event.targetName}</strong>
                            <span>
                              {event.reviewErrorCode
                                ? friendlyError(
                                    new ApiError(event.reviewErrorCode, 503),
                                  )
                                : "Interaction found"}
                            </span>
                            {review && <StatusBadge status={review.status} />}
                          </div>
                          {receipt && (
                            <a
                              className="text-link"
                              href={receipt}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View activity <Icon name="up-right" size={15} />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted">
                    No new interactions in this check. Keep exploring, or share
                    a contribution below.
                  </p>
                )}
              </section>
            )}
            <section
              className="contribution-section"
              aria-labelledby="evidence-heading"
            >
              <div className="contribution-intro">
                <span className="section-number">02</span>
                <div>
                  <div className="eyebrow">SOME STORIES LIVE OFFCHAIN</div>
                  <h2 id="evidence-heading">
                    Made something?
                    <br />
                    Made a difference?
                  </h2>
                  <p>
                    A thoughtful post. A useful repository. A contribution that
                    helped the community. Preview the captured source, then send
                    it to GenLayer for review.
                  </p>
                  <p className="caption">
                    Each wallet can earn 75 XP from one qualifying contribution
                    per UTC day, with at least one hour between rewards. Later
                    qualifying contributions earn 0 XP. Mint and X-link quests
                    have their own rewards.
                  </p>
                  <div className="evidence-sources">
                    <span>
                      <Icon name="x" size={17} />X posts
                    </span>
                    <span>
                      <Icon name="github" size={17} />
                      GitHub
                    </span>
                    <span>
                      <Icon name="link" size={17} />
                      Public contributions
                    </span>
                  </div>
                </div>
              </div>
              <EvidenceForm />
            </section>
            <section
              className="review-section"
              aria-labelledby="review-heading"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">YOUR CONTRIBUTIONS, IN MOTION</span>
                  <h2 id="review-heading">The review room.</h2>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void refreshData()}
                >
                  <Icon name="refresh" size={17} />
                  Refresh reviews
                </button>
              </div>
              {claimError && <Notice tone="error">{claimError}</Notice>}
              {pending.length > 0 && (
                <p className="review-summary">
                  <span className="tiny-dot" />
                  {pending.length} contribution
                  {pending.length === 1 ? " is" : "s are"} being reviewed. This
                  page checks for updates while you’re here.
                </p>
              )}
              {profileClaims.length ? (
                <ClaimList claims={profileClaims} />
              ) : (
                <div className="quiet-empty">
                  <Icon name="clock" size={27} />
                  <p>
                    Your reviews will appear here.
                    <br />
                    <span>
                      Share a contribution or check your activity to get
                      started.
                    </span>
                  </p>
                </div>
              )}
              <Link className="text-link" href="/evolution">
                See your evolution story <Icon name="arrow" size={17} />
              </Link>
            </section>
          </>
        )}
      </ProfileGate>
    </main>
  );
}
