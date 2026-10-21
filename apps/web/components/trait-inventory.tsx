"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  friendlyError,
  idempotencyKey,
  isAbort,
  titleCase,
} from "../lib/api";
import type { Profile, Trait } from "../lib/types";
import { useChog } from "./chog-provider";
import { Icon } from "./icons";
import { Loading, Notice } from "./ui";

export function TraitInventory({ profile }: { profile: Profile }) {
  const {
    address,
    request,
    ensureSession,
    walletMatches,
    addProfile,
    refreshData,
  } = useChog();
  const [catalogue, setCatalogue] = useState<Trait[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>(
    profile.equippedTraitIds || [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mutation = useRef<{ signature: string; key: string } | null>(null);
  const scope = `${address.toLowerCase()}:${profile.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const controller = useRef<AbortController | null>(null);
  const equipped = [...(profile.equippedTraitIds || [])].sort();
  const equippedKey = equipped.join(",");
  useEffect(() => {
    setSelected(equippedKey ? equippedKey.split(",") : []);
    mutation.current = null;
  }, [scope, profile.version, equippedKey]);
  useEffect(() => {
    setBusy(false);
    setError("");
    setMessage("");
    return () => controller.current?.abort();
  }, [scope]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError("");
    void api<{ items: Trait[]; version: number }>("/v1/traits", {
      signal: abort.signal,
    })
      .then((result) => {
        if (!abort.signal.aborted) setCatalogue(result.items);
      })
      .catch((cause) => {
        if (!isAbort(cause)) setLoadError(friendlyError(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);

  function choose(slot: string, id: string) {
    const slotIds = new Set(
      catalogue.filter((trait) => trait.slot === slot).map((trait) => trait.id),
    );
    setSelected((current) =>
      [
        ...current.filter((trait) => !slotIds.has(trait)),
        ...(id ? [id] : []),
      ].sort(),
    );
    setError("");
    setMessage("");
    mutation.current = null;
  }

  async function save() {
    if (busy || [...selected].sort().join(",") === equippedKey) return;
    const selectedScope = scope;
    const ids = [...selected].sort();
    const expectedVersion = profile.version;
    const signature = `${selectedScope}:${expectedVersion}:${ids.join(",")}`;
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, key: idempotencyKey() };
    const key = mutation.current.key;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const session = await ensureSession();
      if (
        scopeRef.current !== selectedScope ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      const result = await request<{ item: Profile }>(
        `/v1/profiles/${encodeURIComponent(profile.id)}/traits`,
        {
          method: "PATCH",
          headers: { "idempotency-key": key },
          body: { equippedTraitIds: ids, expectedVersion },
          signal: abort.signal,
        },
      );
      if (
        scopeRef.current !== selectedScope ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      addProfile(result.item);
      setMessage(
        `Your new look is saved. Your ${result.item.xp.toLocaleString()} XP stays the same.`,
      );
      mutation.current = null;
    } catch (cause) {
      if (scopeRef.current !== selectedScope || isAbort(cause)) return;
      setError(friendlyError(cause));
      if (
        cause instanceof ApiError &&
        cause.code === "profile_version_conflict"
      ) {
        mutation.current = null;
        await refreshData();
      }
    } finally {
      if (scopeRef.current === selectedScope && !abort.signal.aborted)
        setBusy(false);
    }
  }

  const slots = [
    ...new Set(
      catalogue.filter((trait) => trait.removable).map((trait) => trait.slot),
    ),
  ];
  const earned = new Set(
    profile.earnedTraitIds ??
      catalogue
        .filter((trait) => profile.xp >= trait.minXp)
        .map((trait) => trait.id),
  );
  const dirty = [...selected].sort().join(",") !== equippedKey;
  return (
    <section className="trait-inventory" aria-labelledby="inventory-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">EARN IT. MAKE IT YOURS.</span>
          <h2 id="inventory-heading">Your trait collection.</h2>
        </div>
        <Icon name="spark" size={28} />
      </div>
      <p className="muted">
        Your stage and identity grow with earned XP. Choose one earned accessory
        and one aura, or leave a slot empty. Changing your look adds no XP.
      </p>
      {loading && <Loading label="Opening your trait collection…" />}
      {loadError && (
        <Notice
          tone="error"
          action={
            <button
              className="text-button"
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </button>
          }
        >
          {loadError}
        </Notice>
      )}
      {!loading && !loadError && !catalogue.length && (
        <p className="quiet-empty">
          Traits will appear here when the collection is available.
        </p>
      )}
      {!!catalogue.length && (
        <>
          <ul className="fixed-traits">
            {catalogue
              .filter((trait) => !trait.removable)
              .map((trait) => (
                <li key={trait.id}>
                  <Icon
                    name={earned.has(trait.id) ? "check" : "spark"}
                    size={18}
                  />
                  <strong>{trait.name}</strong>
                  <span>
                    {earned.has(trait.id)
                      ? "Part of your stage · always on"
                      : `Unlocks at ${trait.minXp} XP`}
                  </span>
                </li>
              ))}
          </ul>
          <div className="inventory-slots">
            {slots.map((slot) => {
              const options = catalogue.filter(
                (trait) => trait.removable && trait.slot === slot,
              );
              const chosen =
                selected.find((id) =>
                  options.some((trait) => trait.id === id),
                ) || "";
              return (
                <fieldset key={slot} disabled={busy}>
                  <legend>{titleCase(slot)}</legend>
                  <label
                    className={`inventory-option ${chosen === "" ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`trait-${profile.id}-${slot}`}
                      value=""
                      checked={chosen === ""}
                      onChange={() => choose(slot, "")}
                    />
                    <span>
                      <strong>No {slot}</strong>
                      <small>Leave this slot empty</small>
                    </span>
                  </label>
                  {options.map((trait) => (
                    <label
                      key={trait.id}
                      className={`inventory-option ${chosen === trait.id ? "is-selected" : ""} ${!earned.has(trait.id) ? "is-locked" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`trait-${profile.id}-${slot}`}
                        value={trait.id}
                        checked={chosen === trait.id}
                        disabled={!earned.has(trait.id)}
                        onChange={() => choose(slot, trait.id)}
                      />
                      <span>
                        <strong>{trait.name}</strong>
                        <small>
                          {earned.has(trait.id)
                            ? equipped.includes(trait.id)
                              ? "Currently equipped"
                              : "Earned · ready to wear"
                            : `Unlocks at ${trait.minXp} XP`}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
          {!!slots.length && (
            <div className="button-row">
              <button
                type="button"
                className="button button-primary"
                disabled={!dirty || busy}
                onClick={() => void save()}
              >
                <Icon name={busy ? "clock" : "check"} size={18} />
                {busy ? "Saving your look…" : "Save my look"}
              </button>
              {dirty && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(equipped);
                    mutation.current = null;
                    setError("");
                  }}
                >
                  Reset choices
                </button>
              )}
            </div>
          )}
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
    </section>
  );
}
