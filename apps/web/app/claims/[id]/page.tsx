"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useChog } from "../../../components/chog-provider";
import { Icon } from "../../../components/icons";
import {
  EmptyState,
  Loading,
  Notice,
  PageHeader,
  SourceEvidence,
  StatusBadge,
} from "../../../components/ui";
import {
  api,
  copyText,
  friendlyError,
  idempotencyKey,
  isAbort,
  isPending,
  reasonMessage,
  safeUrl,
  timeLabel,
  titleCase,
} from "../../../lib/api";
import type { Claim } from "../../../lib/types";

export default function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    address,
    signedIn,
    profiles,
    walletBusy,
    connect,
    request,
    ensureSession,
    walletMatches,
    addClaim,
  } = useChog();
  const [record, setRecord] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const scope = `${id}:${address.toLowerCase()}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const retryController = useRef<AbortController | null>(null);
  const retryKey = useRef<{ storageKey: string; key: string } | null>(null);
  const claim = record?.id === id ? record : null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const result = await api<{ item: Claim }>(
          `/v1/claims/${encodeURIComponent(id)}`,
          { signal },
        );
        if (signal.aborted) return;
        setRecord(result.item);
        setError("");
      } catch (cause) {
        if (!signal.aborted && !isAbort(cause)) setError(friendlyError(cause));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);
  useEffect(() => {
    setMessage("");
    setRetryError("");
    setRetrying(false);
    setCopyMessage("");
    return () => retryController.current?.abort();
  }, [scope]);
  const pending =
    !!claim &&
    (isPending(claim.status) ||
      (claim.status === "accepted" && !claim.finalized));
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let ticks = 0;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || inFlight) return;
      if (++ticks > 120) {
        window.clearInterval(timer);
        return;
      }
      inFlight = true;
      void load(controller.signal).finally(() => {
        inFlight = false;
      });
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [pending, load]);

  async function retry() {
    if (!claim?.canRetry || retrying) return;
    const selectedScope = scope;
    const abort = new AbortController();
    retryController.current = abort;
    const storageKey = `chog:claim-retry:${address.toLowerCase()}:${id}:${claim.attempt || 1}`;
    let key =
      retryKey.current?.storageKey === storageKey
        ? retryKey.current.key
        : idempotencyKey();
    try {
      key = localStorage.getItem(storageKey) || key;
      localStorage.setItem(storageKey, key);
    } catch {
      /* A retry also remains idempotent within this request. */
    }
    retryKey.current = { storageKey, key };
    setRetrying(true);
    setRetryError("");
    setMessage("");
    try {
      const session = await ensureSession();
      if (
        scopeRef.current !== selectedScope ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      const result = await request<{ item: Claim }>(
        `/v1/claims/${encodeURIComponent(id)}/retry`,
        {
          method: "POST",
          headers: { "idempotency-key": key },
          signal: abort.signal,
          timeout: 60_000,
        },
      );
      if (
        scopeRef.current !== selectedScope ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      setRecord(result.item);
      addClaim(result.item);
      setMessage(
        "The retry is saved on this review. Its earlier attempts remain in the timeline.",
      );
      retryKey.current = null;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* The server record is authoritative. */
      }
    } catch (cause) {
      if (
        scopeRef.current === selectedScope &&
        !abort.signal.aborted &&
        !isAbort(cause)
      )
        setRetryError(friendlyError(cause));
    } finally {
      if (scopeRef.current === selectedScope && !abort.signal.aborted)
        setRetrying(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setCopyMessage(`${label} copied.`);
    } catch {
      setCopyMessage(
        label === "Review link"
          ? "Copy the address from your browser to share this review."
          : "Select the reference text to copy it.",
      );
    }
  }
  const owns =
    signedIn &&
    !!claim?.profileId &&
    profiles.some((profile) => profile.id === claim.profileId);
  const reason = reasonMessage(claim?.reasonCode);
  const decisionUrl = safeUrl(claim?.decisionUrl);
  return (
    <main id="main-content" className="product-page section-width claim-page">
      <PageHeader
        eyebrow="ONE CONTRIBUTION. THE WHOLE STORY."
        title={claim?.questName || "Your contribution review."}
        description="The captured source, each review attempt, and the final reward all stay together here."
      >
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void copy(window.location.href, "Review link")}
        >
          <Icon name="copy" size={17} />
          Share this review
        </button>
      </PageHeader>
      {copyMessage && (
        <p role="status" className="inline-message">
          {copyMessage}
        </p>
      )}
      {loading && !claim && <Loading label="Opening the saved review…" />}
      {error && (
        <Notice
          tone="error"
          action={
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </button>
          }
        >
          {error}
        </Notice>
      )}
      {!loading && !claim && !error && (
        <EmptyState
          icon="globe"
          title="This review isn’t here yet."
          description="Open your activity to find your saved contributions."
        />
      )}
      {claim && (
        <>
          <section
            className="claim-summary"
            aria-labelledby="review-outcome-heading"
          >
            <div>
              <span className="eyebrow">REVIEW OUTCOME</span>
              <h2 id="review-outcome-heading">
                {claim.finalized
                  ? "The decision is in."
                  : "A chapter in progress."}
              </h2>
              <div role="status" aria-live="polite">
                <StatusBadge status={claim.status} />
              </div>
            </div>
            <div className="claim-result-copy">
              <p>
                {claim.explanation ||
                  (pending
                    ? "Your evidence is saved. This page checks for progress while the review is pending."
                    : claim.status === "accepted"
                      ? "This contribution was accepted. The final reward is recorded below."
                      : claim.status === "rejected"
                        ? "This contribution did not meet the quest requirements. See the recorded reason below before sharing a new contribution."
                        : "This review needs attention before it can continue.")}
              </p>
              {reason && <p className="reward-reason">{reason}</p>}
              {claim.reasonCode &&
                claim.reasonCode !== "awarded" &&
                !reason && (
                  <p className="reward-reason">
                    Recorded reason: {titleCase(claim.reasonCode)}.
                  </p>
                )}
              {claim.finalized && (
                <p className="review-reward">
                  <strong>
                    {claim.status === "accepted"
                      ? `+${claim.xpAward || 0}`
                      : "0"}{" "}
                    XP
                  </strong>
                  <span>
                    {claim.status === "accepted"
                      ? "Final contribution reward"
                      : "No reward awarded"}
                  </span>
                </p>
              )}
              {!claim.finalized && (
                <p className="caption">
                  XP is applied only after a final, eligible decision.
                </p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="text-button"
                  disabled={loading || retrying}
                  onClick={() => setRevision((value) => value + 1)}
                >
                  <Icon name="refresh" size={16} />
                  {loading ? "Refreshing…" : "Refresh review"}
                </button>
                {claim.profileId && (
                  <Link
                    className="text-link"
                    href={`/passport/${encodeURIComponent(claim.profileId)}`}
                  >
                    Chog passport <Icon name="arrow" size={16} />
                  </Link>
                )}
              </div>
            </div>
          </section>
          {claim.canRetry && (
            <section className="claim-retry" aria-label="Retry saved review">
              <p>
                The saved source can be checked again. A retry keeps this
                review’s link and previous attempts.
              </p>
              {owns ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={retrying}
                  onClick={() => void retry()}
                >
                  <Icon name={retrying ? "clock" : "refresh"} size={18} />
                  {retrying ? "Saving retry…" : "Retry this review"}
                </button>
              ) : !signedIn ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={walletBusy}
                  onClick={() => void connect()}
                >
                  {walletBusy ? "Connecting…" : "Connect owner wallet to retry"}
                </button>
              ) : (
                <p className="caption">
                  Connect the wallet that currently owns this Chog to retry.
                </p>
              )}
            </section>
          )}
          {retryError && <Notice tone="error">{retryError}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          <div className="claim-detail-grid">
            <SourceEvidence
              source={claim.source}
              media={claim.media}
              fallbackUrl={claim.evidenceUrl}
            />
            <section
              className="claim-attempts"
              aria-labelledby="review-timeline-heading"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">EVERY STEP STAYS</span>
                  <h2 id="review-timeline-heading">Review timeline</h2>
                </div>
                <span className="caption">Attempt {claim.attempt || 1}</span>
              </div>
              {claim.timeline?.length ? (
                <ol className="review-timeline">
                  {claim.timeline.map((event) => (
                    <li key={event.id}>
                      <span className="review-event-dot" aria-hidden="true" />
                      <div>
                        <div className="review-event-heading">
                          <StatusBadge status={event.status} />
                          {event.attempt && (
                            <span className="caption">
                              Attempt {event.attempt}
                            </span>
                          )}
                        </div>
                        <time dateTime={event.createdAt}>
                          {timeLabel(event.createdAt)}
                        </time>
                        {event.description && <p>{event.description}</p>}
                        {event.decisionReference && (
                          <p className="reference-value">
                            Decision reference: {event.decisionReference}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">
                  Detailed events were not recorded for this earlier review. Its
                  saved outcome and references are shown here.
                </p>
              )}
            </section>
          </div>
          <details className="review-references">
            <summary>
              Review references <Icon name="chevron" size={16} />
            </summary>
            <dl>
              <div>
                <dt>Review</dt>
                <dd>{claim.id}</dd>
              </div>
              {claim.decisionReference && (
                <div>
                  <dt>GenLayer decision</dt>
                  <dd>
                    {claim.decisionReference}
                    {decisionUrl && (
                      <a
                        className="text-link"
                        href={decisionUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open decision <Icon name="up-right" size={14} />
                      </a>
                    )}
                  </dd>
                </div>
              )}
              {claim.evidenceHash && (
                <div>
                  <dt>Evidence fingerprint</dt>
                  <dd>{claim.evidenceHash}</dd>
                </div>
              )}
              <div>
                <dt>Saved</dt>
                <dd>{timeLabel(claim.createdAt)}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void copy(
                  claim.decisionReference || claim.id,
                  claim.decisionReference
                    ? "Decision reference"
                    : "Review reference",
                )
              }
            >
              <Icon name="copy" size={15} />
              Copy reference
            </button>
          </details>
        </>
      )}
      <Link className="text-link claim-back" href="/activity">
        <Icon name="arrow" size={17} />
        My activity
      </Link>
    </main>
  );
}
