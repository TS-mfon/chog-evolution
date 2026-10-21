"use client";

import { useState } from "react";
import { artifactUrl, titleCase } from "../lib/api";
import type { EvolutionEvent, EvolutionSnapshot } from "../lib/types";
import { Icon } from "./icons";

function Snapshot({
  snapshot,
  label,
}: {
  snapshot?: EvolutionSnapshot | null | undefined;
  label: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = artifactUrl(snapshot?.artworkUrl);
  return (
    <figure className="history-snapshot">
      <figcaption>{label}</figcaption>
      {image && image !== failed ? (
        <img
          src={image}
          alt={`${label} this change`}
          width={320}
          height={320}
          loading="lazy"
          onError={() => setFailed(image)}
        />
      ) : (
        <div className="history-image-placeholder">
          <Icon name="chog" size={30} />
          <span>
            {image
              ? "Saved artwork unavailable"
              : snapshot
                ? "No saved artwork for this version"
                : `${label === "Before" ? "Earlier" : "Later"} snapshot not recorded`}
          </span>
        </div>
      )}
      {snapshot && (
        <>
          <p>
            <strong>{snapshot.xp.toLocaleString()} XP</strong> · Level{" "}
            {snapshot.level}
          </p>
          <p>{titleCase(snapshot.stage)}</p>
          {snapshot.equippedTraitIds !== undefined ? (
            <p className="snapshot-traits">
              {snapshot.equippedTraitIds.length
                ? snapshot.equippedTraitIds.map(titleCase).join(" · ")
                : "No optional traits equipped"}
            </p>
          ) : snapshot.traits?.length ? (
            <p className="snapshot-traits">{snapshot.traits.join(" · ")}</p>
          ) : null}
        </>
      )}
    </figure>
  );
}

export function HistoryComparison({ event }: { event: EvolutionEvent }) {
  if (!event.before && !event.after) return null;
  return (
    <div
      className="history-comparison"
      aria-label={
        event.kind === "trait_change"
          ? "Look before and after this cosmetic change"
          : "Chog before and after this reward"
      }
    >
      <Snapshot snapshot={event.before} label="Before" />
      <Snapshot snapshot={event.after} label="After" />
    </div>
  );
}
