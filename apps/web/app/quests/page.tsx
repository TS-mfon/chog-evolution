"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useChog } from "../../components/chog-provider";
import { EvidenceForm } from "../../components/evidence-form";
import { Icon } from "../../components/icons";
import {
  EmptyState,
  Loading,
  Notice,
  PageHeader,
  ProfilePicker,
  StatusBadge,
} from "../../components/ui";
import {
  friendlyError,
  idempotencyKey,
  isPending,
  safeUrl,
} from "../../lib/api";
import type { Claim, Quest, XLink } from "../../lib/types";

function category(quest: Quest) {
  return quest.kind === "demo_mint"
    ? "Getting started"
    : quest.verificationMethod === "onchain" ||
        ["ecosystem_event", "monad_activity"].includes(quest.kind || "")
      ? "Ecosystem"
      : "Community";
}

function QuestRow({ quest, xLinked }: { quest: Quest; xLinked: boolean }) {
  const {
    signedIn,
    profile,
    claims,
    ensureSession,
    connect,
    walletBusy,
    request,
    addClaim,
  } = useChog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const repeatable = !["demo_mint", "bio_link"].includes(quest.kind || "");
  const matching = claims.filter(
    (claim) =>
      (claim.questId === quest.id || claim.questSlug === quest.slug) &&
      (!repeatable || !claim.profileId || claim.profileId === profile?.id),
  );
  const claim =
    matching.find((item) => item.status === "accepted") ||
    matching.find((item) => isPending(item.status)) ||
    matching[0];
  const done =
    !repeatable && claim?.status === "accepted" && claim.finalized !== false;
  const awaiting =
    !repeatable &&
    !!claim &&
    (isPending(claim.status) ||
      (claim.status === "accepted" && claim.finalized === false));
  const earnedElsewhere = !!claim?.profileId && claim.profileId !== profile?.id;
  const evidence =
    !["demo_mint", "bio_link", "ecosystem_event", "monad_activity"].includes(
      quest.kind || "",
    ) && quest.verificationMethod !== "onchain";
  const source = safeUrl(quest.sourceUrl);

  async function claimQuest() {
    if (!profile || busy) return;
    setBusy(true);
    setError("");
    setResultMessage("");
    try {
      await ensureSession();
      const result = await request<{ item: Claim; duplicate: boolean }>(
        "/v1/claims",
        {
          method: "POST",
          body: { profileId: profile.id, questId: quest.id },
          headers: { "idempotency-key": idempotencyKey() },
        },
      );
      addClaim({
        ...result.item,
        profileId: result.item.profileId || profile.id,
        questId: quest.id,
        questName: quest.name,
        questSlug: quest.slug,
      });
      setResultMessage(
        result.duplicate
          ? `This quest is already saved${result.item.profileId && result.item.profileId !== profile.id ? " for another Chog in your wallet" : ""}. Its latest review status is shown here.`
          : "Your quest is saved and ready for review. We’ll update your Chog when it’s accepted.",
      );
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  const action = done ? (
    <span className="quest-complete">
      <Icon name="check" size={19} />
      {earnedElsewhere ? "Earned on another Chog" : "Quest complete"}
    </span>
  ) : awaiting ? (
    <StatusBadge status={claim!.status} />
  ) : !signedIn ? (
    <button
      type="button"
      className="button button-secondary"
      disabled={walletBusy}
      onClick={() => void connect()}
    >
      Connect to start <Icon name="wallet" size={17} />
    </button>
  ) : !profile ? (
    <Link className="button button-primary" href="/mint">
      Get your Chog <Icon name="arrow" size={17} />
    </Link>
  ) : quest.kind === "demo_mint" && profile.nft.mode !== "demo" ? (
    <Link className="button button-secondary" href="/mint">
      Mint a demo Chog <Icon name="arrow" size={17} />
    </Link>
  ) : quest.kind === "bio_link" && !xLinked ? (
    <Link className="button button-secondary" href="/profile#connect-x">
      Connect X <Icon name="up-right" size={16} />
    </Link>
  ) : ["ecosystem_event", "monad_activity"].includes(quest.kind || "") ||
    (quest.verificationMethod === "onchain" && quest.kind !== "demo_mint") ? (
    <Link className="button button-secondary" href="/upgrade">
      Check activity <Icon name="arrow" size={17} />
    </Link>
  ) : evidence ? (
    <button
      type="button"
      className="button button-secondary"
      aria-expanded={open}
      aria-controls={`quest-form-${quest.id}`}
      onClick={() => setOpen((current) => !current)}
    >
      {open ? "Close contribution" : "Share contribution"}
      <Icon name={open ? "close" : "arrow"} size={17} />
    </button>
  ) : (
    <button
      type="button"
      className="button button-secondary"
      disabled={busy}
      onClick={() => void claimQuest()}
    >
      {busy ? "Checking your quest…" : "Claim quest"}
      <Icon name={busy ? "clock" : "arrow"} size={17} />
    </button>
  );

  return (
    <article className={`quest-row ${done ? "is-complete" : ""}`}>
      <div className="quest-row-main">
        <div
          className={`quest-symbol quest-symbol-${category(quest).toLowerCase().replaceAll(" ", "-")}`}
        >
          <Icon
            name={
              quest.kind === "demo_mint"
                ? "chog"
                : quest.kind === "bio_link"
                  ? "x"
                  : category(quest) === "Ecosystem"
                    ? "globe"
                    : "spark"
            }
            size={29}
          />
        </div>
        <div className="quest-description">
          <span className="eyebrow">{category(quest)}</span>
          <h2>{quest.name}</h2>
          <p>{quest.description}</p>
          {source && (
            <a
              className="quest-source"
              href={source}
              target="_blank"
              rel="noreferrer"
            >
              Quest details <Icon name="up-right" size={13} />
            </a>
          )}
        </div>
        <div className="quest-reward">
          <strong>+{quest.xpReward}</strong>
          <span>XP reward</span>
        </div>
        <div className="quest-action">{action}</div>
      </div>
      {claim && !done && !awaiting && (
        <div className="quest-review-result">
          <StatusBadge status={claim.status} />
          {claim.explanation && <p>{claim.explanation}</p>}
        </div>
      )}
      {claim && (
        <div className="quest-review-link">
          <Link
            className="text-link"
            href={`/claims/${encodeURIComponent(claim.id)}`}
          >
            View saved review <Icon name="arrow" size={15} />
          </Link>
        </div>
      )}
      {open && evidence && signedIn && profile && (
        <div className="quest-evidence" id={`quest-form-${quest.id}`}>
          <EvidenceForm quest={quest} />
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {resultMessage && <Notice tone="success">{resultMessage}</Notice>}
    </article>
  );
}

export default function QuestsPage() {
  const {
    quests,
    questsLoading,
    questError,
    refreshQuests,
    signedIn,
    address,
    request,
    claims,
    profile,
  } = useChog();
  const [filter, setFilter] = useState("All quests");
  const [xLinked, setXLinked] = useState(false);
  useEffect(() => {
    setXLinked(false);
    if (!signedIn) return;
    const controller = new AbortController();
    void request<{ item: XLink | null }>("/v1/social/x", {
      signal: controller.signal,
    })
      .then((result) => setXLinked(!!result.item))
      .catch(() => undefined);
    return () => controller.abort();
  }, [signedIn, address, request]);
  const categories = [...new Set(quests.map(category))];
  const shown = quests.filter(
    (quest) => filter === "All quests" || category(quest) === filter,
  );
  const completed = new Set(
    claims
      .filter(
        (claim) =>
          claim.profileId === profile?.id &&
          claim.status === "accepted" &&
          claim.finalized !== false,
      )
      .map((claim) => claim.questId || claim.questSlug),
  ).size;
  return (
    <main id="main-content" className="product-page section-width">
      <PageHeader
        eyebrow="A LITTLE CURIOUS? GOOD."
        title="Go make a little history."
        description="Small adventures. Real contributions. Every accepted quest brings your Chog a little further."
      >
        <ProfilePicker />
      </PageHeader>
      <div className="quest-banner">
        <div>
          <Icon name="spark" size={38} />
          <p>
            Good stories don’t happen
            <br />
            <strong>by standing still.</strong>
          </p>
        </div>
        <span>
          {signedIn && profile ? (
            <>
              <strong>{completed}</strong> accepted quest
              {completed === 1 ? "" : "s"}
            </>
          ) : (
            "Explore. Contribute. Evolve."
          )}
        </span>
      </div>
      <section className="quest-board" aria-labelledby="quest-board-heading">
        <div className="quest-board-heading">
          <h2 id="quest-board-heading">The quest board</h2>
          <button
            type="button"
            className="text-button"
            disabled={questsLoading}
            onClick={() => void refreshQuests()}
          >
            <Icon
              name="refresh"
              size={17}
              className={questsLoading ? "spin" : ""}
            />
            Refresh
          </button>
        </div>
        {categories.length > 1 && (
          <div className="filter-list" aria-label="Filter quests">
            {["All quests", ...categories].map((item) => (
              <button
                type="button"
                aria-pressed={filter === item}
                key={item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
        )}
        {questError && (
          <Notice
            tone="error"
            action={
              <button
                type="button"
                className="text-button"
                onClick={() => void refreshQuests()}
              >
                Try again
              </button>
            }
          >
            {questError}
          </Notice>
        )}
        {questsLoading && !quests.length ? (
          <Loading label="Finding your next adventure…" />
        ) : !questError && !quests.length ? (
          <EmptyState
            icon="spark"
            title="The next adventure is on its way."
            description="New quests will appear here when they’re ready. In the meantime, share a contribution you’ve already made."
          >
            <Link href="/upgrade" className="button button-secondary">
              Share a contribution <Icon name="arrow" size={17} />
            </Link>
          </EmptyState>
        ) : (
          shown.map((quest) => (
            <QuestRow
              key={`${quest.id}:${profile?.id || ""}`}
              quest={quest}
              xLinked={xLinked}
            />
          ))
        )}
      </section>
      <div className="quest-bottom">
        <Icon name="globe" size={24} />
        <p>
          Already been busy in the ecosystem?
          <span>
            Check your Monad activity and see what’s ready for review.
          </span>
        </p>
        <Link className="text-link" href="/upgrade">
          Check my activity <Icon name="arrow" size={17} />
        </Link>
      </div>
    </main>
  );
}
