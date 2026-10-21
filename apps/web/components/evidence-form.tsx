"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ApiError,
  copyText,
  friendlyError,
  idempotencyKey,
  isAbort,
  reasonMessage,
  statusLabel,
  timeLabel,
} from "../lib/api";
import type { Claim, EvidencePreview, Quest } from "../lib/types";
import { useChog } from "./chog-provider";
import { Icon } from "./icons";
import { Notice, SourceEvidence, StatusBadge } from "./ui";

type Draft = {
  storageKey: string;
  url: string;
  text: string;
  previewId: string;
  previewKey: string;
  retryKey: string;
  submissionKey: string;
  claimId: string;
};

const emptyDraft = (storageKey: string): Draft => ({
  storageKey,
  url: "",
  text: "",
  previewId: "",
  previewKey: "",
  retryKey: "",
  submissionKey: "",
  claimId: "",
});

export function EvidenceForm({ quest }: { quest?: Quest }) {
  const { profile, address, request, ensureSession, addClaim, walletMatches } =
    useChog();
  const storageKey = `chog:draft:${address.toLowerCase()}:${profile?.id || ""}:${quest?.id || "upgrade"}`;
  const [draft, setDraft] = useState<Draft>(emptyDraft(""));
  const [previewState, setPreviewState] = useState<{
    storageKey: string;
    item: EvidencePreview;
  } | null>(null);
  const [busy, setBusy] = useState<"preview" | "submit" | "restore" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef(storageKey);
  scopeRef.current = storageKey;
  const operation = useRef<AbortController | null>(null);
  const preview =
    previewState?.storageKey === storageKey ? previewState.item : null;
  const current =
    draft.storageKey === storageKey ? draft : emptyDraft(storageKey);

  function save(next: Draft) {
    if (scopeRef.current === next.storageKey) setDraft(next);
    try {
      localStorage.setItem(next.storageKey, JSON.stringify(next));
    } catch {
      /* The draft remains in memory when storage is unavailable. */
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    operation.current?.abort();
    let saved = emptyDraft(storageKey);
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) || "{}",
      );
      if (value && typeof value === "object") {
        for (const key of [
          "url",
          "text",
          "previewId",
          "previewKey",
          "retryKey",
          "submissionKey",
          "claimId",
        ] as const) {
          const field = (value as Record<string, unknown>)[key];
          if (
            typeof field === "string" &&
            field.length <= (key === "url" || key === "text" ? 1000 : 200)
          )
            saved[key] = field;
        }
      }
    } catch {
      /* Malformed local data does not replace the server record. */
    }
    setDraft(saved);
    setPreviewState(null);
    setError("");
    setErrorCode("");
    setFieldError("");
    setSuccess("");
    setCopied(false);
    setBusy(saved.previewId ? "restore" : null);
    if (saved.previewId) {
      void request<{ item: EvidencePreview }>(
        `/v1/evidence/previews/${encodeURIComponent(saved.previewId)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (controller.signal.aborted || scopeRef.current !== storageKey)
            return;
          setPreviewState({ storageKey, item: result.item });
          if (result.item.claimId || result.item.status === "ready")
            save({
              ...saved,
              retryKey: "",
              claimId: result.item.claimId || "",
            });
        })
        .catch((cause) => {
          if (
            controller.signal.aborted ||
            scopeRef.current !== storageKey ||
            isAbort(cause)
          )
            return;
          setError(friendlyError(cause));
          setErrorCode(cause instanceof ApiError ? cause.code : "");
          if (cause instanceof ApiError && cause.code === "preview_not_found")
            save({ ...saved, previewId: "", previewKey: "", retryKey: "" });
        })
        .finally(() => {
          if (!controller.signal.aborted && scopeRef.current === storageKey)
            setBusy(null);
        });
    }
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [storageKey, request]);

  useEffect(() => {
    if (!preview || !["pending", "reading"].includes(preview.status)) return;
    const controller = new AbortController();
    const id = preview.id;
    let ticks = 0;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || inFlight) return;
      if (++ticks > 30) {
        window.clearInterval(timer);
        return;
      }
      inFlight = true;
      void request<{ item: EvidencePreview }>(
        `/v1/evidence/previews/${encodeURIComponent(id)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted && scopeRef.current === storageKey)
            setPreviewState({ storageKey, item: result.item });
        })
        .catch((cause) => {
          if (
            !controller.signal.aborted &&
            scopeRef.current === storageKey &&
            !isAbort(cause)
          )
            setError(friendlyError(cause));
        })
        .finally(() => {
          inFlight = false;
        });
    }, 4000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [preview?.id, preview?.status, storageKey, request]);

  useEffect(() => {
    if (!preview) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [preview?.id, preview?.expiresAt]);

  function update(fields: Partial<Pick<Draft, "url" | "text">>) {
    save({
      ...emptyDraft(storageKey),
      url: current.url,
      text: current.text,
      ...fields,
    });
    setPreviewState(null);
    setError("");
    setErrorCode("");
    setSuccess("");
    setFieldError("");
  }

  function parsedUrl(): string | null {
    try {
      const url = new URL(current.url.trim());
      if (
        url.protocol === "http:" &&
        [
          "x.com",
          "twitter.com",
          "github.com",
          "www.x.com",
          "www.twitter.com",
          "www.github.com",
        ].includes(url.hostname.toLowerCase())
      )
        url.protocol = "https:";
      if (
        url.protocol !== "https:" ||
        !url.hostname.includes(".") ||
        url.username ||
        url.password
      )
        throw new Error();
      return url.href;
    } catch {
      setFieldError(
        "Add a complete public link, such as https://github.com/you/your-project.",
      );
      inputRef.current?.focus();
      return null;
    }
  }

  async function capture(retry = false) {
    if (!profile || busy) return;
    const url = parsedUrl();
    if (!url) return;
    const abort = new AbortController();
    operation.current = abort;
    const saved: Draft = {
      ...current,
      url,
      text: current.text.trim(),
      previewKey: current.previewKey || idempotencyKey(),
      ...(retry ? { retryKey: current.retryKey || idempotencyKey() } : {}),
    };
    save(saved);
    setBusy("preview");
    setError("");
    setErrorCode("");
    setSuccess("");
    setFieldError("");
    try {
      const session = await ensureSession();
      if (
        scopeRef.current !== storageKey ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      const result = await request<{ item: EvidencePreview }>(
        retry && saved.previewId
          ? `/v1/evidence/previews/${encodeURIComponent(saved.previewId)}/retry`
          : "/v1/evidence/previews",
        {
          method: "POST",
          signal: abort.signal,
          timeout: 60_000,
          headers: {
            "idempotency-key":
              retry && saved.previewId ? saved.retryKey : saved.previewKey,
          },
          ...(retry && saved.previewId
            ? {}
            : {
                body: {
                  profileId: profile.id,
                  ...(quest ? { questId: quest.id } : {}),
                  url,
                  ...(saved.text ? { text: saved.text } : {}),
                },
              }),
        },
      );
      if (
        scopeRef.current !== storageKey ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      setPreviewState({ storageKey, item: result.item });
      save({
        ...saved,
        previewId: result.item.id,
        retryKey: "",
        claimId: result.item.claimId || "",
      });
      setNow(Date.now());
    } catch (cause) {
      if (
        scopeRef.current !== storageKey ||
        abort.signal.aborted ||
        isAbort(cause)
      )
        return;
      setError(friendlyError(cause));
      setErrorCode(cause instanceof ApiError ? cause.code : "");
    } finally {
      if (scopeRef.current === storageKey && !abort.signal.aborted)
        setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !preview ||
      preview.status !== "ready" ||
      Date.parse(preview.expiresAt) <= Date.now()
    ) {
      await capture(!!current.previewId);
      return;
    }
    if (!profile || busy || !preview.eligibility.eligible) return;
    const abort = new AbortController();
    operation.current = abort;
    const saved = {
      ...current,
      submissionKey: current.submissionKey || idempotencyKey(),
    };
    save(saved);
    setBusy("submit");
    setError("");
    setErrorCode("");
    setSuccess("");
    try {
      const session = await ensureSession();
      if (
        scopeRef.current !== storageKey ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      const result = await request<{ item: Claim; duplicate: boolean }>(
        quest ? "/v1/claims" : "/v1/upgrades/evidence",
        {
          method: "POST",
          headers: { "idempotency-key": saved.submissionKey },
          signal: abort.signal,
          timeout: 60_000,
          body: {
            profileId: profile.id,
            ...(quest ? { questId: quest.id } : {}),
            previewId: preview.id,
            url: saved.url,
            ...(saved.text ? { text: saved.text } : {}),
          },
        },
      );
      if (
        scopeRef.current !== storageKey ||
        !walletMatches(session.address) ||
        abort.signal.aborted
      )
        return;
      addClaim({
        ...result.item,
        profileId: result.item.profileId || profile.id,
        ...(quest
          ? { questId: quest.id, questName: quest.name, questSlug: quest.slug }
          : {}),
      });
      save({ ...emptyDraft(storageKey), claimId: result.item.id });
      setPreviewState(null);
      setSuccess(
        result.duplicate
          ? `This contribution already has a saved review. ${statusLabel(result.item.status)}.`
          : "Your contribution is saved for GenLayer review. Your Chog will update after the final decision.",
      );
    } catch (cause) {
      if (
        scopeRef.current !== storageKey ||
        abort.signal.aborted ||
        isAbort(cause)
      )
        return;
      setError(friendlyError(cause));
      setErrorCode(cause instanceof ApiError ? cause.code : "");
      if (
        cause instanceof ApiError &&
        /^preview_|^evidence_preview_/.test(cause.code)
      )
        setPreviewState({
          storageKey,
          item: {
            ...preview,
            status: "stale",
            eligibility: { eligible: false, message: friendlyError(cause) },
          },
        });
      if (
        cause instanceof ApiError &&
        ["preview_not_found", "preview_request_mismatch"].includes(cause.code)
      ) {
        save({
          ...saved,
          previewId: "",
          previewKey: "",
          retryKey: "",
          submissionKey: "",
        });
        setPreviewState(null);
      }
    } finally {
      if (scopeRef.current === storageKey && !abort.signal.aborted)
        setBusy(null);
    }
  }

  const id = quest ? `evidence-${quest.id}` : "upgrade-evidence";
  const expired =
    !!preview &&
    (preview.status === "expired" ||
      (preview.status !== "consumed" && Date.parse(preview.expiresAt) <= now));
  const ready = preview?.status === "ready" && !expired;
  const reading =
    !!preview && ["pending", "reading"].includes(preview.status) && !expired;
  const savedClaimId =
    current.claimId || preview?.claimId || preview?.eligibility.claimId;
  const actionErrorCode = errorCode || preview?.errorCode || "";
  const actionError =
    error ||
    ([
      "github_wallet_attribution_required",
      "x_profile_link_required",
      "evidence_author_not_linked_to_wallet",
    ].includes(actionErrorCode)
      ? friendlyError(new ApiError(actionErrorCode, 422))
      : "");
  const previewReason = reasonMessage(preview?.eligibility.reasonCode);
  const unavailable =
    preview && ["source_unavailable", "failed"].includes(preview.status);
  return (
    <form className="evidence-form" onSubmit={(event) => void submit(event)}>
      <div className="form-field">
        <label htmlFor={`${id}-url`}>Your contribution link</label>
        <input
          ref={inputRef}
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="An X post or public GitHub repository"
          required
          maxLength={1000}
          disabled={!!busy}
          value={current.url}
          aria-invalid={!!fieldError}
          aria-describedby={`${id}-help${fieldError ? ` ${id}-error` : ""}`}
          onChange={(event) => update({ url: event.target.value })}
        />
        <p className="field-help" id={`${id}-help`}>
          {quest?.allowedEvidenceHosts?.length
            ? `Supported sources: ${quest.allowedEvidenceHosts.join(", ")}.`
            : "Share a public X post or GitHub repository that shows your contribution to Monad."}{" "}
          Your draft is saved for this Chog.
        </p>
        {fieldError && (
          <p className="field-error" id={`${id}-error`} role="alert">
            {fieldError}
          </p>
        )}
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-text`}>
          A little context <span>(optional)</span>
        </label>
        <textarea
          id={`${id}-text`}
          placeholder="What did you make, share, or take part in?"
          rows={3}
          maxLength={1000}
          disabled={!!busy}
          value={current.text}
          onChange={(event) => update({ text: event.target.value })}
        />
      </div>
      {preview && (
        <div
          className="evidence-preview"
          aria-label="Saved contribution preview"
        >
          <div className="preview-status" role="status" aria-live="polite">
            <StatusBadge status={expired ? "expired" : preview.status} />
            <span className="caption">
              {expired
                ? "Capture the source again to continue."
                : preview.status === "consumed"
                  ? "This source has a saved review."
                  : `Preview expires ${timeLabel(preview.expiresAt)}.`}
            </span>
          </div>
          {(preview.source || (preview.media?.length ?? 0) > 0) && (
            <SourceEvidence
              source={preview.source}
              media={preview.media}
              fallbackUrl={current.url}
            />
          )}
          {reading && (
            <p role="status">
              Reading the public source and saving its images. You can leave
              this page and return to the saved preview.
            </p>
          )}
          {!reading && !expired && preview.status !== "consumed" && (
            <p
              className={
                ready && preview.eligibility.eligible
                  ? "preview-eligibility"
                  : "preview-eligibility is-error"
              }
            >
              {previewReason ||
                (unavailable
                  ? friendlyError(
                      new ApiError(
                        preview.errorCode || "evidence_source_unavailable",
                        503,
                      ),
                    )
                  : preview.eligibility.message ||
                    "The source is not ready for review yet.")}
            </p>
          )}
          {preview.eligibility.nextEligibleAt && (
            <p className="caption">
              Next contribution reward window:{" "}
              <time dateTime={preview.eligibility.nextEligibleAt}>
                {timeLabel(preview.eligibility.nextEligibleAt)}
              </time>
              .
            </p>
          )}
          {ready && preview.eligibility.rewardXp === 0 && (
            <p className="caption">
              Expected contribution reward right now: 0 XP. The limit is checked
              again when the review is finalized.
            </p>
          )}
        </div>
      )}
      <div className="form-footer">
        {ready && preview?.eligibility.eligible ? (
          <button
            className="button button-primary"
            disabled={!!busy || !profile}
            type="submit"
          >
            <Icon name={busy ? "clock" : "spark"} size={18} />
            {busy === "submit" ? "Sending for review…" : "Submit for review"}
          </button>
        ) : (
          <button
            className="button button-primary"
            disabled={
              !!busy ||
              !profile ||
              reading ||
              preview?.status === "consumed" ||
              (ready && !preview?.eligibility.eligible)
            }
            type="button"
            onClick={() => void capture(!!current.previewId)}
          >
            <Icon name={busy || reading ? "clock" : "link"} size={18} />
            {busy === "restore"
              ? "Restoring your preview…"
              : busy === "preview"
                ? "Capturing your source…"
                : reading
                  ? "Reading your source…"
                  : current.previewId
                    ? "Retry saved preview"
                    : "Preview contribution"}
          </button>
        )}
        {ready && (
          <button
            className="text-button"
            disabled={!!busy}
            type="button"
            onClick={() => void capture(true)}
          >
            Refresh preview
          </button>
        )}
        <span className="caption">
          Preview first. Then GenLayer review.
          <br />
          Rewards follow the final decision.
        </span>
      </div>
      {reading && (
        <button
          type="button"
          className="text-button"
          disabled={!!busy}
          onClick={() => void capture(true)}
        >
          Check saved preview
        </button>
      )}
      {actionError && (
        <Notice
          tone="error"
          action={
            actionErrorCode === "github_wallet_attribution_required" ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void copyText(address)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        `Add this wallet address to your README: ${address}`,
                      ),
                    );
                }}
              >
                <Icon name={copied ? "check" : "copy"} size={16} />
                {copied ? "Wallet address copied" : "Copy my wallet address"}
              </button>
            ) : [
                "x_profile_link_required",
                "evidence_author_not_linked_to_wallet",
              ].includes(actionErrorCode) ? (
              <Link className="text-link" href="/profile#connect-x">
                Connect X profile <Icon name="up-right" size={16} />
              </Link>
            ) : undefined
          }
        >
          {actionError}
        </Notice>
      )}
      {success && <Notice tone="success">{success}</Notice>}
      {savedClaimId && (
        <Link
          className="text-link saved-review-link"
          href={`/claims/${encodeURIComponent(savedClaimId)}`}
        >
          Open saved review <Icon name="arrow" size={17} />
        </Link>
      )}
    </form>
  );
}
