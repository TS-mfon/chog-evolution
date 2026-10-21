"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Icon } from "../../../components/icons";
import {
  EmptyState,
  EvolutionTimeline,
  Loading,
  Notice,
  PageHeader,
  ProfileTraits,
  ProfileArtwork,
  Progress,
} from "../../../components/ui";
import { titleCase } from "../../../lib/api";
import { usePassport } from "../../../lib/use-passport";

export default function PassportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    passport,
    loading,
    error,
    refresh,
    loadMore,
    loadingMore,
    moreError,
  } = usePassport(id);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function share() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopyError(
        "Copy the address from your browser to share this Chog’s passport.",
      );
    }
  }
  return (
    <main id="main-content" className="product-page section-width">
      <PageHeader
        eyebrow="A STORY WORTH KEEPING"
        title={
          passport
            ? `${passport.profile.displayName}’s passport.`
            : "A little piece of Chog history."
        }
        description="An open record of this Chog’s rewards, earned traits, and changing look."
      />
      {loading && !passport && <Loading label="Opening this Chog’s story…" />}
      {error && (
        <Notice
          tone="error"
          action={
            <button type="button" className="text-button" onClick={refresh}>
              Try again
            </button>
          }
        >
          {error}
        </Notice>
      )}
      {passport && (
        <div className="passport-layout">
          <aside className="passport-summary">
            <ProfileArtwork profile={passport.profile} />
            <h2>{passport.profile.displayName}</h2>
            <span className="stage-pill">
              {titleCase(passport.profile.stage)} · Level{" "}
              {passport.profile.level}
            </span>
            <Progress profile={passport.profile} />
            <ProfileTraits profile={passport.profile} />
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void share()}
            >
              <Icon name={copied ? "check" : "copy"} size={17} />
              {copied ? "Passport link copied" : "Share this passport"}
            </button>
            {copyError && (
              <p className="inline-message" role="status">
                {copyError}
              </p>
            )}
            <p className="passport-note">
              {passport.profile.nft.mode === "demo"
                ? "A demo Chog NFT on Monad Testnet, with a story all its own."
                : "This passport follows a companion profile for an original Chog. Its original collection artwork stays its own."}
            </p>
          </aside>
          <section
            className="passport-history"
            aria-labelledby="passport-history-heading"
          >
            <div className="section-heading">
              <div>
                <div className="eyebrow">THE STORY SO FAR</div>
                <h2 id="passport-history-heading">
                  {passport.history.length
                    ? `${passport.history.length} chapter${passport.history.length === 1 ? "" : "s"}${passport.nextCursor ? " loaded" : " and counting"}.`
                    : "Just getting started."}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={loading}
                aria-label="Refresh passport"
                onClick={refresh}
              >
                <Icon
                  name="refresh"
                  size={18}
                  className={loading ? "spin" : ""}
                />
              </button>
            </div>
            {passport.history.length ? (
              <EvolutionTimeline events={passport.history} />
            ) : (
              <EmptyState
                icon="spark"
                title="The first chapter is on its way."
                description="This Chog has a whole world ahead of it. Its accepted contributions and evolutions will appear here."
              >
                <Link className="button button-primary" href="/mint">
                  Start a story of your own <Icon name="arrow" size={17} />
                </Link>
              </EmptyState>
            )}
            {moreError && <Notice tone="error">{moreError}</Notice>}
            {passport.nextCursor && (
              <button
                type="button"
                className="button button-secondary load-more"
                disabled={loading || loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading more history…" : "Load more history"}
                <Icon name="arrow" size={17} />
              </button>
            )}
            <p className="history-caption">
              This passport records finalized rewards and cosmetic changes.
              Changing equipped traits does not award XP.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
