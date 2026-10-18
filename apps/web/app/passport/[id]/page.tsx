"use client";

import { use, useEffect, useState } from "react";
import { artDataUri, composeDemoChog } from "@chog/art-composition";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
type Passport = {
  profile: { id: string; nft: { mode: string; chainId: number; collectionAddress: string; tokenId: string }; displayName: string; xp: number; level: number; stage: string; traits: string[]; version: number };
  history: { id: string; previousVersion: number; newVersion: number; xpTotal: number; changes: { xpAward?: number; stage?: string }; createdAt: string; questSlug: string; outcome: string; reasonCode: string; explanation: string; decisionReference?: string | null; evidenceHash?: string | null; evidenceUrl?: string | null }[];
};

export default function PassportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [message, setMessage] = useState("Loading public evolution history…");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void fetch(`${API_BASE}/v1/passports/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const body = await response.json() as { item?: Passport; error?: string };
        if (!response.ok || !body.item) throw new Error(body.error || `Passport returned ${response.status}`);
        setPassport(body.item); setMessage("");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Passport is unavailable."));
  }, [id]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  return <main className="passport-shell">
    <header><a href="/">CHOG / EVOLUTION</a><span>PUBLIC PASSPORT</span></header>
    {message && <p role="status">{message}</p>}
    {passport && <>
      <section className="passport-hero"><div className="eyebrow">{passport.profile.nft.mode === "demo" ? "DEMO COLLECTION · MONAD TESTNET" : "ORIGINAL CHOG · COMPANION PROFILE"}</div>{passport.profile.nft.mode === "demo" && <><img className="passport-art" src={artDataUri(passport.profile.nft.tokenId, passport.profile.stage)} alt={`Chogins demo artwork, ${passport.profile.stage} stage`}/><div className="passport-traits">{composeDemoChog(passport.profile.nft.tokenId, passport.profile.stage).traits.map((trait) => <span key={trait.name}>{trait.name}: {trait.value}</span>)}</div></>}<h1>{passport.profile.displayName} <em>#{passport.profile.nft.tokenId}</em></h1><p>{passport.profile.stage} · Level {passport.profile.level} · {passport.profile.xp} XP</p><code>{passport.profile.nft.collectionAddress}</code><button onClick={() => void copyLink()}>{copied ? "Link copied" : "Share this Passport ↗"}</button></section>
      <section className="passport-story"><div className="eyebrow">EVOLUTION HISTORY</div><h2>{passport.history.length} verified milestone{passport.history.length === 1 ? "" : "s"}</h2>{passport.history.length === 0 ? <p>No accepted evolution events have been recorded yet.</p> : <ol>{passport.history.map((event) => <li key={event.id}><span className="passport-step">VERSION {event.previousVersion} → {event.newVersion}</span><h3>{event.questSlug.replaceAll("-", " ")}</h3><p>{event.explanation}</p><p>+{event.changes.xpAward ?? 0} XP · {event.xpTotal} total XP · {event.changes.stage || "stage unchanged"}</p><small>{new Date(event.createdAt).toLocaleString()}</small>{event.evidenceHash && <p><small>Evidence SHA-256: {event.evidenceHash}</small></p>}{event.evidenceUrl && <a href={event.evidenceUrl} target="_blank" rel="noreferrer">View public evidence ↗</a>}{event.decisionReference && <p><small>Finalized decision: {event.decisionReference}</small></p>}</li>)}</ol>}</section>
      {passport.profile.nft.mode === "original_companion" && <p className="passport-disclaimer">This evolution Passport records a companion profile. It does not change the original Chog NFT metadata.</p>}
    </>}
    <footer><a href="/">← Return to Evolution Lab</a><span>History shows finalized accepted claims only.</span></footer>
  </main>;
}
