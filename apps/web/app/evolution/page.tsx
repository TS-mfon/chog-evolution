"use client";

import Link from "next/link";
import { useChog } from "../../components/chog-provider";
import { Icon } from "../../components/icons";
import {
  EmptyState,
  EvolutionTimeline,
  Loading,
  Notice,
  PageHeader,
  ProfileGate,
  ProfilePicker,
  ProfileArtwork,
  Progress,
} from "../../components/ui";
import { STAGES } from "../../lib/api";
import { usePassport } from "../../lib/use-passport";

export default function EvolutionPage() {
  const { profile } = useChog();
  const {
    passport,
    error,
    loading,
    refresh,
    loadMore,
    loadingMore,
    moreError,
  } = usePassport(profile?.id, profile?.version, profile?.artworkUrl);
  return (
    <main id="main-content" className="product-page section-width">
      <PageHeader
        eyebrow="BECOMING IS THE BEST PART"
        title="Every Chog has a story."
        description="The quests, contributions, and little leaps that made your Chog who it is."
      >
        <ProfilePicker />
      </PageHeader>
      <ProfileGate>
        {profile && (
          <div className="evolution-layout">
            <aside className="evolution-sidebar">
              <ProfileArtwork profile={profile} />
              <h2>{profile.displayName}</h2>
              <Progress profile={profile} />
              <Link className="text-link" href={`/passport/${profile.id}`}>
                Open public passport <Icon name="up-right" size={16} />
              </Link>
              <div className="stages-guide">
                <span className="eyebrow">THE ROAD AHEAD</span>
                <ol>
                  {STAGES.map((stage) => (
                    <li
                      key={stage.name}
                      className={profile.xp >= stage.xp ? "is-reached" : ""}
                    >
                      <span className="stage-guide-dot">
                        {profile.xp >= stage.xp && (
                          <Icon name="check" size={11} />
                        )}
                      </span>
                      <span>{stage.name}</span>
                      <span>{stage.xp} XP</span>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>
            <section
              className="evolution-history"
              aria-labelledby="history-heading"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">THE STORY SO FAR</span>
                  <h2 id="history-heading">Your evolution.</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  disabled={loading}
                  onClick={refresh}
                  aria-label="Refresh evolution history"
                >
                  <Icon
                    name="refresh"
                    size={19}
                    className={loading ? "spin" : ""}
                  />
                </button>
              </div>
              {error && (
                <Notice
                  tone="error"
                  action={
                    <button
                      type="button"
                      className="text-button"
                      onClick={refresh}
                    >
                      Try again
                    </button>
                  }
                >
                  {error}
                </Notice>
              )}
              {loading && !passport ? (
                <Loading label="Opening your story…" />
              ) : passport && passport.history.length ? (
                <EvolutionTimeline events={passport.history} />
              ) : (
                !error && (
                  <EmptyState
                    icon="spark"
                    title="The best part is still ahead."
                    description="Your Chog’s first chapter starts with an accepted contribution. Complete a quest or share something you made, and come back to see the story unfold."
                  >
                    <Link className="button button-primary" href="/quests">
                      Find your first quest <Icon name="arrow" size={18} />
                    </Link>
                  </EmptyState>
                )
              )}
              {moreError && <Notice tone="error">{moreError}</Notice>}
              {passport?.nextCursor && (
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
                Finalized XP rewards and saved cosmetic changes. Before and
                after images show the artwork recorded for each version.
              </p>
            </section>
          </div>
        )}
      </ProfileGate>
    </main>
  );
}
