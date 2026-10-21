"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { copyText, dateLabel, friendlyError, isAbort } from "../lib/api";
import type { XLink } from "../lib/types";
import { useChog } from "./chog-provider";
import { Icon } from "./icons";
import { Notice } from "./ui";

export function XProfileLink() {
  const { address, signedIn, request } = useChog();
  const [link, setLink] = useState<XLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [challenge, setChallenge] = useState<{
    bioCode: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const storageKey = `chog:x:${address.toLowerCase()}`;
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    setLoading(true);
    setLink(null);
    setChallenge(null);
    setUsername("");
    setError("");
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(storageKey) || "null",
      ) as { username?: string; bioCode?: string; expiresAt?: string } | null;
      if (
        saved?.bioCode &&
        saved.expiresAt &&
        new Date(saved.expiresAt).getTime() > Date.now()
      ) {
        setChallenge({ bioCode: saved.bioCode, expiresAt: saved.expiresAt });
        setUsername(saved.username || "");
      }
    } catch {
      /* A fresh challenge can always be requested. */
    }
    void request<{ item: XLink | null }>("/v1/social/x", {
      signal: controller.signal,
    })
      .then((result) => {
        setLink(result.item);
        setLoading(false);
      })
      .catch((cause) => {
        if (!isAbort(cause)) {
          setError(friendlyError(cause));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [signedIn, storageKey, request, loadVersion]);

  async function getCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalized = username.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(normalized)) {
      setError(
        "Enter a valid X username, using letters, numbers or underscores.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await request<{ bioCode: string; expiresAt: string }>(
        "/v1/social/x/challenge",
        { method: "POST" },
      );
      setUsername(normalized);
      setChallenge(result);
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ ...result, username: normalized }),
        );
      } catch {
        /* The code remains visible in the current session. */
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ item: XLink }>("/v1/social/x/verify", {
        method: "POST",
        body: { username: username.replace(/^@/, "").trim() },
      });
      setLink(result.item);
      setChallenge(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* The server stores the verified connection. */
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError("");
    try {
      await request("/v1/social/x", { method: "DELETE" });
      setLink(null);
      setChallenge(null);
      setUsername("");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="social-section"
      id="connect-x"
      aria-labelledby="x-heading"
    >
      <div className="social-intro">
        <span className="social-icon">
          <Icon name="x" size={32} />
        </span>
        <div className="eyebrow">PUT A NAME TO THE QUILLS</div>
        <h2 id="x-heading">
          Same you.
          <br />
          More connected.
        </h2>
        <p>
          Connect your X profile so your community contributions can become part
          of your Chog’s story.
        </p>
      </div>
      <div className="social-form">
        {loading ? (
          <p className="muted" role="status">
            Checking your X connection…
          </p>
        ) : link ? (
          <>
            <span className="status-badge status-success">
              <Icon name="check" size={15} />X profile connected
            </span>
            <h3>@{link.username}</h3>
            <p>
              Connected {dateLabel(link.verifiedAt)}. You can remove the
              verification code from your bio.
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/quests">
                Explore your quests <Icon name="arrow" size={17} />
              </Link>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => void unlink()}
              >
                {busy ? "Disconnecting…" : "Disconnect X"}
              </button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={(event) => void getCode(event)}>
              <div className="form-field">
                <label htmlFor="x-username">Your X username</label>
                <input
                  id="x-username"
                  placeholder="@yourname"
                  autoComplete="username"
                  maxLength={16}
                  pattern="@?[A-Za-z0-9_]{1,15}"
                  required
                  value={username}
                  disabled={busy}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              {!challenge && (
                <button
                  type="submit"
                  className="button button-secondary"
                  disabled={busy}
                >
                  {busy ? "Getting your code…" : "Connect X profile"}
                  <Icon name="arrow" size={17} />
                </button>
              )}
            </form>
            {challenge && (
              <div className="x-challenge">
                <p>
                  <strong>One small step:</strong> add this code to your public
                  X bio.
                </p>
                <div className="copy-code">
                  <code>{challenge.bioCode}</code>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      copied ? "Code copied" : "Copy verification code"
                    }
                    onClick={() => {
                      void copyText(challenge.bioCode)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError(
                            "Copy the code above and paste it into your X bio.",
                          ),
                        );
                    }}
                  >
                    <Icon name={copied ? "check" : "copy"} size={18} />
                  </button>
                </div>
                <p className="caption" role="status">
                  {copied
                    ? "Copied. Paste it in your bio, then save your profile."
                    : `This code expires at ${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(challenge.expiresAt))}. You can remove it after verification.`}
                </p>
                <a
                  className="text-link"
                  href="https://x.com/settings/profile"
                  target="_blank"
                  rel="noreferrer"
                >
                  Edit your X bio <Icon name="up-right" size={15} />
                </a>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void verify()}
                  >
                    {busy ? "Checking your bio…" : "Verify X profile"}
                    <Icon name="check" size={18} />
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void getCode()}
                  >
                    Get a new code
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <Notice
            tone="error"
            action={
              !challenge && !link ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setLoadVersion((value) => value + 1)}
                >
                  Retry connection check
                </button>
              ) : undefined
            }
          >
            {error}
          </Notice>
        )}
      </div>
    </section>
  );
}
