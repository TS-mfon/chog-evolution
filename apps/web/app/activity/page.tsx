"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useChog } from "../../components/chog-provider";
import { Icon } from "../../components/icons";
import { AccountNavigation } from "../../components/site-shell";
import {
  EmptyState,
  Loading,
  Notice,
  PageHeader,
  ProfileGate,
  StatusBadge,
} from "../../components/ui";
import {
  dateLabel,
  collectionPages,
  friendlyError,
  isAbort,
  isPending,
  safeUrl,
} from "../../lib/api";
import type { Activity } from "../../lib/types";

export default function ActivityPage() {
  const { address, signedIn, request } = useChog();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All activity");
  const [revision, setRevision] = useState(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await collectionPages<Activity>(
          "/v1/activity",
          request,
          {
            ...(signal ? { signal } : {}),
          },
        );
        if (signal?.aborted) return;
        setItems(result);
        setError("");
      } catch (cause) {
        if (!signal?.aborted && !isAbort(cause)) setError(friendlyError(cause));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [request],
  );
  useEffect(() => {
    setItems([]);
    setError("");
    if (!signedIn) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [signedIn, address, load]);
  useEffect(() => {
    if (!signedIn || !revision) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [revision, signedIn, load]);
  const pending = items.some((item) => isPending(item.status));
  useEffect(() => {
    if (!signedIn || !pending) return;
    let attempts = 0;
    let inFlight = false;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Match the review service's scheduled cadence: up to 30 visible minutes.
      if (++attempts > 120) {
        window.clearInterval(interval);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      void load(controller.signal).finally(() => {
        inFlight = false;
      });
    }, 15_000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [signedIn, pending, load]);
  const visible = items.filter(
    (item) =>
      filter === "All activity" ||
      (filter === "In progress" && isPending(item.status)) ||
      (filter === "Completed" &&
        ["accepted", "complete", "completed", "confirmed", "minted"].includes(
          item.status,
        )),
  );
  return (
    <main id="main-content" className="product-page section-width">
      <AccountNavigation />
      <PageHeader
        eyebrow="THE FOOTPRINTS YOU LEAVE"
        title="You’ve been up to things."
        description="Mints, quests, contributions, and new chapters. This is your Chog world in motion."
      >
        <button
          type="button"
          className="button button-secondary"
          disabled={!signedIn || loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <Icon name="refresh" size={17} className={loading ? "spin" : ""} />
          {loading ? "Refreshing…" : "Refresh activity"}
        </button>
      </PageHeader>
      {!signedIn ? (
        <ProfileGate>
          <></>
        </ProfileGate>
      ) : (
        <section className="activity-board" aria-label="Your wallet activity">
          {items.length > 0 && (
            <div className="filter-list" aria-label="Filter activity">
              {["All activity", "In progress", "Completed"].map((label) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={filter === label}
                  onClick={() => setFilter(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {error && (
            <Notice
              tone="error"
              action={
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Try again
                </button>
              }
            >
              {error}
            </Notice>
          )}
          {loading && !items.length ? (
            <Loading label="Catching up with your world…" />
          ) : !error && !visible.length ? (
            <EmptyState
              icon="clock"
              title={
                items.length
                  ? "Nothing here just yet."
                  : "An adventure waiting to happen."
              }
              description={
                items.length
                  ? "Try another filter to see the rest of your activity."
                  : "Your first mint, quest, or contribution will appear here. Ready to leave a little footprint?"
              }
            >
              {items.length ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setFilter("All activity")}
                >
                  Show all activity
                </button>
              ) : (
                <Link className="button button-primary" href="/quests">
                  Explore quests <Icon name="arrow" size={18} />
                </Link>
              )}
            </EmptyState>
          ) : (
            <ol className="activity-list">
              {visible.map((item) => {
                const receipt = safeUrl(item.transactionUrl);
                const claimId =
                  item.claimId ||
                  (item.type === "claim" && item.id.startsWith("claim:")
                    ? item.id.slice(6)
                    : null);
                return (
                  <li key={item.id}>
                    <span
                      className={`activity-symbol ${item.status === "accepted" ? "is-accepted" : ""}`}
                    >
                      <Icon
                        name={
                          item.type.includes("mint")
                            ? "chog"
                            : item.type.includes("evolution")
                              ? "spark"
                              : item.type.includes("scan")
                                ? "globe"
                                : "bolt"
                        }
                        size={23}
                      />
                    </span>
                    <div className="activity-item">
                      <div className="activity-title">
                        <h2>{item.title}</h2>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="activity-meta">
                        <time dateTime={item.createdAt}>
                          {dateLabel(item.createdAt)}
                        </time>
                        {item.xpAward &&
                        item.xpAward > 0 &&
                        item.status === "accepted" ? (
                          <strong>+{item.xpAward} XP</strong>
                        ) : null}
                      </div>
                      {(item.description || receipt) && (
                        <details className="activity-details">
                          <summary>
                            See details <Icon name="chevron" size={15} />
                          </summary>
                          {item.description && <p>{item.description}</p>}
                          {receipt && (
                            <a
                              className="text-link"
                              href={receipt}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View receipt <Icon name="up-right" size={15} />
                            </a>
                          )}
                        </details>
                      )}
                      {claimId && (
                        <Link
                          className="text-link claim-detail-link"
                          href={`/claims/${encodeURIComponent(claimId)}`}
                        >
                          View review <Icon name="arrow" size={15} />
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
