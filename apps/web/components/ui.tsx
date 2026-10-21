"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { artDataUri, composeDemoChog } from "@chog/art-composition";
import {
  artifactUrl,
  dateLabel,
  friendlyError,
  isPending,
  progression,
  reasonMessage,
  safeUrl,
  statusLabel,
  timeLabel,
  titleCase,
} from "../lib/api";
import type {
  Claim,
  EvidenceSource,
  EvolutionEvent,
  Profile,
  SourceMedia,
} from "../lib/types";
import { useChog } from "./chog-provider";
import { Icon } from "./icons";
import { HistoryComparison } from "./history-comparison";

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">
          <span className="tiny-dot" />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-header-action">{children}</div>}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
  action,
}: {
  children: React.ReactNode;
  tone?: "info" | "error" | "success";
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Loading({ label = "Finding your Chog…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-ring" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
  icon = "chog",
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  icon?: "chog" | "spark" | "clock" | "globe";
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={36} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="button-row">{children}</div>}
    </div>
  );
}

export function ProfileGate({ children }: { children: React.ReactNode }) {
  const {
    signedIn,
    sessionReady,
    walletBusy,
    profilesLoading,
    profile,
    profileError,
    connect,
    refreshData,
  } = useChog();
  if (!sessionReady || (signedIn && profilesLoading && !profile))
    return <Loading />;
  if (!signedIn)
    return (
      <div className="connect-state">
        <div className="connect-illustration">
          <img
            src="/brand/chog-hero.webp"
            alt="A purple Chog waiting for its next adventure"
            width={420}
            height={420}
          />
          <span className="handwritten">There you are.</span>
        </div>
        <div>
          <div className="eyebrow">Your story starts here</div>
          <h2>
            One wallet.
            <br />
            Your whole world.
          </h2>
          <p>
            Connect to find your Chogs, keep up with your quests, and see what
            you’re becoming.
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={walletBusy}
            onClick={() => void connect()}
          >
            <Icon name="wallet" />
            {walletBusy ? "Connecting…" : "Connect wallet"}
          </button>
          <span className="caption connect-caption">
            A free sign-in. Your wallet stays yours.
          </span>
        </div>
      </div>
    );
  if (profileError && !profile)
    return (
      <EmptyState
        icon="globe"
        title="Your Chogs are taking a moment."
        description={profileError}
      >
        <button
          type="button"
          className="button button-primary"
          onClick={() => void refreshData()}
          disabled={profilesLoading}
        >
          <Icon name="refresh" />
          Try again
        </button>
      </EmptyState>
    );
  if (!profile)
    return (
      <EmptyState
        title="A Chog-shaped space."
        description="Your collection is waiting for its first character. Mint a Chog, or let us find one you already own."
      >
        <Link href="/mint" className="button button-primary">
          Mint a Chog <Icon name="up-right" />
        </Link>
        <DiscoverButton />
      </EmptyState>
    );
  return (
    <>
      {profileError && (
        <Notice
          tone="error"
          action={
            <button
              className="text-button"
              type="button"
              disabled={profilesLoading}
              onClick={() => void refreshData()}
            >
              Refresh
            </button>
          }
        >
          {profileError}
        </Notice>
      )}
      {children}
    </>
  );
}

export function ProfilePicker() {
  const { profiles, profile, setSelectedProfile } = useChog();
  if (!profile) return null;
  if (profiles.length === 1)
    return (
      <span className="profile-selection">
        <Icon name="chog" size={18} />
        {profile.displayName}
      </span>
    );
  return (
    <label className="profile-picker">
      <span className="sr-only">Choose your Chog</span>
      <select
        value={profile.id}
        onChange={(event) => setSelectedProfile(event.target.value)}
      >
        {profiles.map((item) => (
          <option value={item.id} key={item.id}>
            {item.displayName} · {titleCase(item.stage)}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={16} />
    </label>
  );
}

export function DiscoverButton() {
  const {
    address,
    ensureSession,
    config,
    addProfile,
    request,
    refreshData,
    walletMatches,
  } = useChog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  function savedDiscovery(
    wallet: string,
  ): Record<string, string | null> | null {
    try {
      const value = JSON.parse(
        localStorage.getItem(`chog:discovery:${wallet.toLowerCase()}`) ||
          "null",
      ) as Record<string, unknown> | null;
      if (!value || typeof value !== "object") return null;
      return Object.fromEntries(
        Object.entries(value).filter(
          ([mode, cursor]) =>
            ["demo", "original_companion"].includes(mode) &&
            (cursor === null ||
              (typeof cursor === "string" && cursor.length <= 1500)),
        ),
      ) as Record<string, string | null>;
    } catch {
      return null;
    }
  }
  useEffect(() => {
    setCursors(savedDiscovery(address) || {});
    setMessage("");
    setFailed(false);
  }, [address]);
  async function discover() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const session = await ensureSession();
      const modes: ("demo" | "original_companion")[] = config?.mainnet
        .collectionAddress
        ? ["demo", "original_companion"]
        : ["demo"];
      let count = 0;
      const stored = savedDiscovery(session.address);
      const next: Record<string, string | null> =
        stored && Object.keys(stored).length
          ? { ...stored }
          : Object.fromEntries(modes.map((mode) => [mode, null]));
      for (const mode of modes) {
        if (!(mode in next)) continue;
        const result = await request<{
          items: Profile[];
          nextCursor?: string | null;
          partial?: boolean;
        }>("/v1/profiles/discover", {
          method: "POST",
          body: { mode, ...(next[mode] ? { cursor: next[mode] } : {}) },
          timeout: 90_000,
        });
        if (!walletMatches(session.address)) return;
        if (result.nextCursor) next[mode] = result.nextCursor;
        else delete next[mode];
        // Finding the first Chog replaces the empty screen and unmounts this
        // control. Save the next cursor before publishing that profile.
        try {
          localStorage.setItem(
            `chog:discovery:${session.address.toLowerCase()}`,
            JSON.stringify(next),
          );
        } catch {
          /* Discovery can still continue during this session. */
        }
        setCursors({ ...next });
        for (const item of result.items) {
          addProfile(item);
          count++;
        }
      }
      setMessage(
        Object.keys(next).length
          ? `${count ? `Found ${count} Chog${count === 1 ? "" : "s"}. ` : ""}There’s more of your wallet history to check. Continue to find the rest.`
          : count
            ? `Found ${count} Chog${count === 1 ? "" : "s"}. Your collection is up to date.`
            : "No Chogs found in this wallet yet. Your first one is waiting on the mint page.",
      );
      await refreshData();
    } catch (error) {
      setFailed(true);
      setMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="discover-control">
      <button
        type="button"
        className="button button-secondary"
        disabled={busy}
        onClick={() => void discover()}
      >
        <Icon name="refresh" size={18} className={busy ? "spin" : ""} />
        {busy
          ? "Finding your Chogs…"
          : Object.keys(cursors).length
            ? "Continue finding Chogs"
            : "Find my Chogs"}
      </button>
      {message && (
        <p
          className={`inline-message ${failed ? "is-error" : ""}`}
          role="status"
        >
          {message}
        </p>
      )}
    </div>
  );
}

export function ChogArtwork({
  profile,
  className = "",
}: {
  profile: Profile;
  className?: string;
}) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const published = artifactUrl(profile.artworkUrl || profile.imageUrl);
  let fallback: string | undefined;
  try {
    fallback = artDataUri(profile.nft.tokenId, profile.stage, {
      ...(profile.equippedTraitIds
        ? { equippedTraitIds: profile.equippedTraitIds }
        : {}),
      mode: profile.nft.mode,
    });
  } catch {
    /* A malformed identity never gets invented artwork. */
  }
  const source =
    profile.artworkPending && fallback && !failedUrls.includes(fallback)
      ? fallback
      : published && !failedUrls.includes(published)
        ? published
        : fallback && !failedUrls.includes(fallback)
          ? fallback
          : undefined;
  return (
    <div className={`chog-artwork ${className}`}>
      {source ? (
        <img
          src={source}
          width={640}
          height={640}
          alt={`${profile.displayName}${profile.nft.mode === "original_companion" ? " companion" : ""}, ${titleCase(profile.stage)} stage${source === fallback ? ", current look preview" : ""}`}
          onError={() =>
            setFailedUrls((current) =>
              current.includes(source) ? current : [...current, source],
            )
          }
        />
      ) : (
        <div className="artwork-empty">
          <Icon name="chog" size={90} />
          <span>
            {published
              ? "Artwork is temporarily unavailable"
              : "Your artwork will appear here"}
          </span>
        </div>
      )}
      <span className="artwork-label">
        {profile.nft.mode === "demo" ? "Demo Chog" : "Evolution companion"}
        {source === fallback ? " · preview" : ""}
        <span>Level {profile.level}</span>
      </span>
    </div>
  );
}

export function ProfileArtwork({ profile }: { profile: Profile }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (profile.nft.mode !== "original_companion")
    return <ChogArtwork profile={profile} />;
  const original = profile.originalMetadata;
  const source = safeUrl(original?.imageUrl);
  const metadata = safeUrl(original?.tokenUri);
  return (
    <div className="identity-artworks">
      <figure className="original-artwork">
        <div className="original-image">
          {source && failed !== source ? (
            <img
              src={source}
              alt={original?.name || `Original Chog #${profile.nft.tokenId}`}
              width={480}
              height={480}
              onError={() => setFailed(source)}
            />
          ) : (
            <div className="artwork-empty">
              <Icon name="chog" size={52} />
              <span>Original artwork unavailable</span>
            </div>
          )}
        </div>
        <figcaption>
          <strong>Original NFT</strong>
          <span>{original?.name || `Chog #${profile.nft.tokenId}`}</span>
          <span className="caption">
            Original collection · Token {profile.nft.tokenId}
          </span>
          {profile.originalMetadataStatus === "unavailable" && (
            <p className="caption original-metadata-notice" role="status">
              {source
                ? "Showing the last retrieved original artwork. Its metadata is temporarily unavailable."
                : "Original metadata is temporarily unavailable. Your companion is still here."}
              {profile.originalMetadataAttemptedAt && (
                <>
                  {" "}
                  Last checked {timeLabel(profile.originalMetadataAttemptedAt)}.
                </>
              )}
            </p>
          )}
          {metadata && (
            <a
              className="text-link"
              href={metadata}
              target="_blank"
              rel="noreferrer"
            >
              Original metadata <Icon name="up-right" size={14} />
            </a>
          )}
        </figcaption>
      </figure>
      <div className="companion-artwork">
        <ChogArtwork profile={profile} />
        <p className="caption">
          Your evolving companion. The original NFT’s artwork and identity stay
          unchanged.
        </p>
      </div>
    </div>
  );
}

export function SourceEvidence({
  source,
  media = [],
  fallbackUrl,
}: {
  source?: EvidenceSource | null | undefined;
  media?: SourceMedia[] | undefined;
  fallbackUrl?: string | null | undefined;
}) {
  const headingId = useId();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const content = source?.publicContent || source?.public_content || {};
  const text =
    typeof content.text === "string"
      ? content.text
      : typeof content.readme === "string"
        ? content.readme
        : "";
  const description =
    typeof content.description === "string" ? content.description : "";
  const author =
    typeof content.username === "string"
      ? `@${content.username}`
      : typeof content.full_name === "string"
        ? content.full_name
        : undefined;
  const url = safeUrl(
    source?.canonicalUrl || source?.canonical_url || fallbackUrl,
  );
  const immutableUrl =
    typeof content.immutable_readme_url === "string"
      ? safeUrl(content.immutable_readme_url)
      : undefined;
  const capturedAt = source?.fetchedAt || source?.fetched_at;
  const captures = media.length ? media : source?.media || [];
  return (
    <section className="source-evidence" aria-labelledby={headingId}>
      <div className="source-heading">
        <h3 id={headingId}>Captured source</h3>
        {source && (
          <span className="eyebrow">
            {source.provider === "x"
              ? "Public X post"
              : titleCase(source.provider)}
          </span>
        )}
      </div>
      {author && <p className="source-author">{author}</p>}
      {description && <p>{description}</p>}
      {text ? (
        <blockquote
          className="source-text"
          tabIndex={0}
          aria-label="Captured source text"
        >
          {text}
        </blockquote>
      ) : (
        <p className="muted">
          {source
            ? "No text was included in this source."
            : "Captured source text is not available for this review."}
        </p>
      )}
      {content.readme_truncated === true && (
        <p className="caption">
          This capture includes the beginning of the README. The full pinned
          version is linked below.
        </p>
      )}
      {!!captures.length && (
        <ul
          className="source-media"
          aria-label="Images attached to the captured source"
        >
          {captures.map((item, index) => {
            const image = artifactUrl(item.url);
            const captured =
              (!item.status || item.status === "captured") &&
              image &&
              !failedImages.includes(image);
            return (
              <li key={item.mediaId || `${item.sourceUrl || "image"}:${index}`}>
                {captured ? (
                  <a
                    href={image}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open captured source image ${index + 1}`}
                  >
                    <img
                      src={image}
                      width={item.width || 480}
                      height={item.height || 320}
                      loading="lazy"
                      alt={`Image ${index + 1} attached to the source`}
                      onError={() =>
                        setFailedImages((current) => [...current, image])
                      }
                    />
                  </a>
                ) : (
                  <div className="source-media-missing">
                    <Icon name="link" size={24} />
                    <span>
                      Image {index + 1}{" "}
                      {item.status === "capturing" || item.status === "pending"
                        ? "is being captured"
                        : "is unavailable"}
                    </span>
                  </div>
                )}
                <p className="caption">
                  {captured
                    ? `Captured image ${index + 1}`
                    : "This image has not been included in the review yet."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {!!captures.length && (
        <p className="caption">
          Images are preserved with the source. The review uses source text and
          verified attribution; it does not interpret image contents.
        </p>
      )}
      <div className="source-references">
        {url && (
          <a className="text-link" href={url} target="_blank" rel="noreferrer">
            Open source <Icon name="up-right" size={15} />
          </a>
        )}
        {immutableUrl && (
          <a
            className="text-link"
            href={immutableUrl}
            target="_blank"
            rel="noreferrer"
          >
            Read captured version <Icon name="up-right" size={15} />
          </a>
        )}
        {capturedAt && (
          <span className="caption">
            Captured <time dateTime={capturedAt}>{timeLabel(capturedAt)}</time>
          </span>
        )}
      </div>
    </section>
  );
}

export function Progress({ profile }: { profile: Profile }) {
  const { next, percent, remaining } = progression(profile.xp);
  return (
    <div className="xp-progress">
      <div className="progress-heading">
        <span>{titleCase(profile.stage)}</span>
        <strong>
          {profile.xp.toLocaleString()} <small>XP</small>
        </strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={
          next ? `Progress to ${next.name}` : "Legend evolution reached"
        }
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={
          next ? `${remaining} XP to ${next.name}` : "Legend reached"
        }
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>
        {next ? (
          <>
            <span>{remaining} XP to go</span>
            <span>
              Next: {next.name} <Icon name="spark" size={13} />
            </span>
          </>
        ) : (
          <>
            <span>The legend lives on.</span>
            <span>
              Keep exploring <Icon name="spark" size={13} />
            </span>
          </>
        )}
      </p>
    </div>
  );
}

export function ProfileTraits({ profile }: { profile: Profile }) {
  let traits: { name: string; value: string }[] = [];
  if (!profile.traits.length) {
    try {
      traits = composeDemoChog(profile.nft.tokenId, profile.stage, {
        ...(profile.equippedTraitIds
          ? { equippedTraitIds: profile.equippedTraitIds }
          : {}),
        mode: profile.nft.mode,
      }).traits.filter(
        (trait) => !["Collection", "Evolution"].includes(trait.name),
      );
    } catch {
      /* Keep existing profile traits available. */
    }
  }
  return (
    <div className="traits-grid">
      {traits.map((trait) => (
        <div className="trait" key={trait.name}>
          <span>{trait.name}</span>
          <strong>{trait.value}</strong>
        </div>
      ))}
      {profile.traits.map((trait) => (
        <div className="trait earned-trait" key={trait}>
          <Icon name="spark" size={15} />
          <strong>{titleCase(trait)}</strong>
        </div>
      ))}
      {!traits.length && !profile.traits.length && (
        <p className="muted">Your traits will appear as your Chog evolves.</p>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = [
    "accepted",
    "complete",
    "completed",
    "confirmed",
    "minted",
  ].includes(status)
    ? "success"
    : ["rejected", "failed", "source_unavailable", "unresolved"].includes(
          status,
        )
      ? "error"
      : isPending(status) || status === "partial"
        ? "pending"
        : "neutral";
  return (
    <span className={`status-badge status-${tone}`}>
      <span />
      {statusLabel(status)}
    </span>
  );
}

export function ClaimList({
  claims,
  compact = false,
}: {
  claims: Claim[];
  compact?: boolean;
}) {
  return (
    <ol className={`claim-list ${compact ? "compact" : ""}`}>
      {claims.map((claim) => (
        <li key={claim.id}>
          <div className="claim-icon">
            <Icon
              name={
                claim.status === "accepted"
                  ? "check"
                  : isPending(claim.status)
                    ? "clock"
                    : "link"
              }
            />
          </div>
          <div className="claim-content">
            <div className="claim-title">
              <strong>
                <Link href={`/claims/${encodeURIComponent(claim.id)}`}>
                  {claim.questName ||
                    titleCase(claim.questSlug || "Contribution review")}
                </Link>
              </strong>
              <StatusBadge status={claim.status} />
            </div>
            <span className="caption">
              {dateLabel(claim.createdAt)}
              {claim.status === "accepted" &&
              claim.finalized !== false &&
              claim.xpAward
                ? ` · +${claim.xpAward} XP earned`
                : ""}
            </span>
            {!compact && (
              <p>
                {claim.explanation ||
                  (isPending(claim.status)
                    ? "Your contribution is saved. We’ll update your Chog when the review is final."
                    : claim.status === "rejected"
                      ? "This contribution did not meet the quest requirements. You can explore other quests or submit a new contribution."
                      : claim.status === "source_unavailable"
                        ? "The contribution couldn’t be read. Open this review to retry the saved attempt."
                        : "Your review result has been recorded.")}
              </p>
            )}
            {!compact && reasonMessage(claim.reasonCode) && (
              <p>{reasonMessage(claim.reasonCode)}</p>
            )}
            <Link
              className="text-link claim-detail-link"
              href={`/claims/${encodeURIComponent(claim.id)}`}
            >
              View review <Icon name="arrow" size={15} />
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function EvolutionTimeline({ events }: { events: EvolutionEvent[] }) {
  return (
    <ol className="evolution-timeline">
      {events.map((event, index) => {
        const source = artifactUrl(event.artworkUrl);
        const evidence = safeUrl(event.evidenceUrl || event.evidence_url);
        const total = event.xpTotal ?? event.xp_total;
        const award = event.changes?.xpAward ?? event.changes?.xp_award;
        const cosmetic = event.kind === "trait_change";
        const claimId = event.claimId || event.claim_id;
        const version = event.newVersion ?? event.new_version;
        return (
          <li key={event.id}>
            <span className="timeline-marker">
              <Icon name="spark" size={18} />
            </span>
            <div className="timeline-entry">
              <div className="timeline-meta">
                <span className="eyebrow">
                  {cosmetic ? "New look" : "XP reward"}
                  {version !== undefined
                    ? ` · Version ${version}`
                    : ` · Chapter ${index + 1}`}
                </span>
                <time dateTime={event.createdAt}>
                  {dateLabel(event.createdAt)}
                </time>
              </div>
              <h3>
                {cosmetic
                  ? "A look of your own."
                  : event.questName ||
                    titleCase(
                      event.questSlug || event.quest_slug || "A new chapter",
                    )}
              </h3>
              <p>
                {event.explanation ||
                  (cosmetic
                    ? "You changed your equipped traits. Your XP, level and stage stayed the same."
                    : "Your contribution was accepted and added to your Chog’s story.")}
              </p>
              <div className="timeline-details">
                {cosmetic ? (
                  <strong>Cosmetic change · No XP awarded</strong>
                ) : (
                  award !== undefined && <strong>+{award} XP</strong>
                )}
                {total !== undefined && <span>{total} total XP</span>}
                {event.changes?.stage && (
                  <span>{titleCase(event.changes.stage)}</span>
                )}
                {evidence && (
                  <a href={evidence} target="_blank" rel="noreferrer">
                    View contribution <Icon name="up-right" size={14} />
                  </a>
                )}
                {claimId && (
                  <Link href={`/claims/${encodeURIComponent(claimId)}`}>
                    View review <Icon name="arrow" size={14} />
                  </Link>
                )}
              </div>
              <HistoryComparison event={event} />
              {!event.before && !event.after && source && (
                <img
                  className="history-art"
                  src={source}
                  alt={`Artwork from chapter ${index + 1} of this Chog’s evolution`}
                  loading="lazy"
                  width={220}
                  height={220}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
