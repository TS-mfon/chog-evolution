"use client";

import { useEffect, useState, type FormEvent } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);
type ReviewClaim = {
  id: string;
  status: string;
  questName: string;
  questSlug: string;
  wallet: string;
  evidenceUrl: string;
  evidenceHash: string;
  evidenceText: string;
  rules: string;
  xpCap: number;
  createdAt: string;
};

export default function QuestAdmin() {
  const [adminKey, setAdminKey] = useState("");
  const [adminActor, setAdminActor] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<ReviewClaim[]>([]);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    status: "active",
    sourceUrl: "",
    rules: "",
    xpReward: "50",
    verificationMethod: "public_evidence",
    hosts: "",
    startsAt: "",
    endsAt: "",
  });

  useEffect(() => {
    setAdminKey(sessionStorage.getItem("chog-quest-admin-key") || "");
    setAdminActor(sessionStorage.getItem("chog-quest-admin-actor") || "");
  }, []);

  async function loadReviewQueue() {
    if (!adminKey) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/v1/admin/claims/review`, {
        headers: { "x-quest-admin-key": adminKey },
      });
      const body = (await response.json()) as {
        items?: ReviewClaim[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          body.error || `Review queue returned ${response.status}`,
        );
      setReviews(body.items ?? []);
      setMessage(`Loaded ${body.items?.length ?? 0} claims for review.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load review queue.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminKey) {
      setMessage("Enter the server configured quest admin key.");
      return;
    }
    setBusy(true);
    setMessage("Saving a new immutable quest policy version…");
    try {
      const response = await fetch(`${API_BASE}/v1/admin/quests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-quest-admin-key": adminKey,
          "x-admin-actor": adminActor,
        },
        body: JSON.stringify({
          slug: form.slug,
          name: form.name,
          description: form.description,
          status: form.status,
          sourceUrl: form.sourceUrl,
          rules: form.rules,
          xpReward: Number(form.xpReward),
          verificationMethod: form.verificationMethod,
          allowedEvidenceHosts: form.hosts
            .split(",")
            .map((host) => host.trim().toLowerCase())
            .filter(Boolean),
          startsAt: form.startsAt
            ? new Date(form.startsAt).toISOString()
            : null,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          sourceReviewed: true,
        }),
      });
      const body = (await response.json()) as {
        item?: { questId: string; policyId: string; version: number };
        error?: string;
      };
      if (!response.ok || !body.item)
        throw new Error(
          body.error || `Quest policy returned ${response.status}`,
        );
      setMessage(
        `Quest enabled with policy v${body.item.version}. Review source ${form.sourceUrl} and evidence hosts before sharing it.`,
      );
      await loadReviewQueue();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create quest policy.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewClaim(
    claim: ReviewClaim,
    outcome: "accepted" | "rejected",
  ) {
    const xpAward =
      outcome === "accepted"
        ? Number(
            window.prompt(
              `XP award (maximum ${claim.xpCap})`,
              String(claim.xpCap),
            ) ?? "NaN",
          )
        : 0;
    if (
      outcome === "accepted" &&
      (!Number.isSafeInteger(xpAward) || xpAward < 1 || xpAward > claim.xpCap)
    ) {
      setMessage(
        "Accepted claims need an integer XP award within the quest cap.",
      );
      return;
    }
    const explanation = window
      .prompt("Reason for this review decision")
      ?.trim();
    if (!explanation) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/admin/claims/${claim.id}/review`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-quest-admin-key": adminKey,
            "x-admin-actor": adminActor,
          },
          body: JSON.stringify({ outcome, xpAward, explanation }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error || `Review returned ${response.status}`);
      setMessage(
        `Claim ${claim.id} finalized as ${outcome}${xpAward ? ` for ${xpAward} XP` : " with no XP"}.`,
      );
      await loadReviewQueue();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save review.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-shell" id="main-content">
      <header>
        <a href="/">← CHOG / EVOLUTION</a>
        <span>OPERATIONS</span>
      </header>
      <h1>Quest administration</h1>
      <p>
        Only publish quests after checking the official source, dates,
        completion signal, and evidence domains. Creating a new version never
        edits the rules attached to earlier claims.
      </p>
      <label className="admin-key">
        Admin API key
        <input
          type="password"
          autoComplete="current-password"
          value={adminKey}
          onChange={(event) => {
            setAdminKey(event.target.value);
            sessionStorage.setItem("chog-quest-admin-key", event.target.value);
          }}
          placeholder="QUEST_ADMIN_API_KEY"
        />
      </label>
      <label className="admin-key">
        Reviewer name
        <input
          value={adminActor}
          onChange={(event) => {
            setAdminActor(event.target.value);
            sessionStorage.setItem(
              "chog-quest-admin-actor",
              event.target.value,
            );
          }}
          placeholder="Your name or team handle"
        />
      </label>
      <section>
        <h2>Publish a quest version</h2>
        <form onSubmit={createPolicy}>
          <label>
            Slug
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </label>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              required
              maxLength={2000}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <label>
            Registry status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Official source URL
            <input
              required
              type="url"
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
          </label>
          <label>
            Evidence rules
            <textarea
              required
              maxLength={4000}
              value={form.rules}
              onChange={(e) => setForm({ ...form, rules: e.target.value })}
            />
          </label>
          <label>
            Allowed evidence domains
            <input
              required
              placeholder="example.org, x.com"
              value={form.hosts}
              onChange={(e) => setForm({ ...form, hosts: e.target.value })}
            />
          </label>
          <div className="admin-fields">
            <label>
              XP cap
              <input
                required
                type="number"
                min="1"
                max="10000"
                value={form.xpReward}
                onChange={(e) => setForm({ ...form, xpReward: e.target.value })}
              />
            </label>
            <label>
              Verification
              <select
                value={form.verificationMethod}
                onChange={(e) =>
                  setForm({ ...form, verificationMethod: e.target.value })
                }
              >
                <option value="public_evidence">
                  Public evidence + GenLayer
                </option>
                <option value="hybrid">Hybrid + review queue</option>
                <option value="manual">Manual review</option>
              </select>
            </label>
          </div>
          <div className="admin-fields">
            <label>
              Starts at
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </label>
            <label>
              Ends at
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </label>
          </div>
          <p className="admin-warning">
            Submitting is your attestation that the public source and completion
            rules were reviewed. Host allowlists constrain URLs that the
            adjudicator and worker can fetch.
          </p>
          <button disabled={busy || !adminKey || !adminActor}>
            Create active policy version
          </button>
        </form>
      </section>
      <section>
        <div className="admin-heading">
          <h2>Manual review queue</h2>
          <button
            type="button"
            disabled={busy || !adminKey}
            onClick={() => void loadReviewQueue()}
          >
            Refresh queue
          </button>
        </div>
        {reviews.length === 0 ? (
          <p>No claims are waiting for review.</p>
        ) : (
          reviews.map((claim) => (
            <article className="review-card" key={claim.id}>
              <div>
                <b>
                  {claim.questName} · {claim.questSlug}
                </b>
                <span>
                  {claim.wallet} · {new Date(claim.createdAt).toLocaleString()}
                </span>
              </div>
              <p>{claim.rules}</p>
              <a href={claim.evidenceUrl} target="_blank" rel="noreferrer">
                Open evidence source ↗
              </a>
              <p className="evidence-snapshot">{claim.evidenceText}</p>
              <small>
                SHA-256 {claim.evidenceHash} · XP cap {claim.xpCap}
              </small>
              <div className="admin-actions">
                <button
                  disabled={busy || !adminActor}
                  onClick={() => void reviewClaim(claim, "accepted")}
                >
                  Accept with XP
                </button>
                <button
                  disabled={busy || !adminActor}
                  onClick={() => void reviewClaim(claim, "rejected")}
                >
                  Reject
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      {message && (
        <p role="status" className="admin-status">
          {message}
        </p>
      )}
    </main>
  );
}
