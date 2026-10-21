# Architecture

CHOG Evolution is a TypeScript monorepo with Next.js, Fastify, MongoDB and a separate GenLayer/artwork worker. MongoDB replaced the original PostgreSQL plan at the user's direction; transactions require Atlas or a replica set.

## Responsibilities

| System                  | Authority                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| Monad                   | NFT ownership, demo mint state, transactions and logs                      |
| GenLayer                | Finalized evidence-review outcome and permitted XP                         |
| API                     | Wallet auth, current ownership, policies, source capture and deduplication |
| MongoDB                 | Claims, decisions, XP ledger, profiles, checkpoints, leases and history    |
| Worker                  | Submission/reconciliation, finalization and artwork jobs                   |
| Trait renderer / Gemini | Images only; no authority over ownership, traits or XP                     |
| GridFS                  | Published image and JSON assets                                            |
| Web                     | Story, mint, quests, evolution, activity, profile and upgrade interactions |

Vercel mounts Fastify lazily behind `/api`; standalone deployment is also supported. Runtime `/v1/config` supplies public chain settings without exposing private RPC credentials.

## Data flow

1. A wallet signs an expiring single-use nonce. The API creates an HttpOnly session and stores authentication proof privately.
2. Mint preparation verifies collection and supply. After wallet confirmation, the client remembers the transaction per wallet, waits for its receipt and asks the API to verify finality, mint event and ownership. Registration and its first quest are automatic. Refresh resumes confirmation without a second mint.
3. NFT discovery uses ERC-721 enumeration when available, otherwise bounded token-ID ownership reads. Original Chogs use companion profiles; their collection metadata is not changed.
4. Claims reference immutable policy versions and source snapshots. Mint proof comes from the receipt. X posts bind to verified X identity. GitHub evidence pins a commit and README containing wallet attribution. Recent mainnet scans capture successful contract calls or configured events and resume from checkpoints.
5. Wallet/request-intent idempotency, source identity and reward-scope indexes prevent duplicate claims and repeated rewards across profiles. Evidence is served at a content-hashed HTTPS URL for validators.
6. The worker stores one GenLayer transaction reference, polls for Finalized consensus, then reads finalized contract state. Pending, rejected, unavailable, malformed and mismatched decisions cannot add XP.
7. An accepted decision commits the ledger, latest profile, history and immutable artwork snapshot in a MongoDB transaction. Artwork jobs validate and store PNG/JSON assets. Publication checks the evolution version so older jobs cannot replace newer art.

## Repository

```text
apps/web/                   Next routes, shared shell and wallet/data state
services/api/               Fastify routes, repositories, evidence and scans
services/evolution-worker/   Stable StudioNet adapter, finalization and artwork
packages/evolution-rules/    Progression thresholds and constraints
packages/art-composition/    Deterministic Chog art and trait catalogue
packages/shared-types/      Shared domain types
packages/validation/        Shared validators
contracts/                  Demo ERC-721 and Foundry tests
genlayer/                   Deployed Intelligent Contract source
assets/chog-references/     Supplied brand illustrations and hashes
.ulpi/design/               Locked purple/black design and flow spec
scripts/                    Build, browser, docs and contract checks
```

## Invariants and recovery

- Privileged calls verify the session and current onchain ownership. Client-supplied XP, decisions and ownership are never authoritative.
- Each positive claim creates at most one XP entry and one evolution job; zero-XP acceptance creates neither. Equipment changes use independent source events and do not award XP. XP uses the profile read inside the transaction, not a stale worker snapshot.
- Receipt recovery and claim idempotency survive refresh/retry. Account changes clear private client state.
- Workers use expiring leases. Pending consensus is not a failed attempt; unknown submission references are held for review instead of rebroadcast.
- Evidence and evolution history are immutable. Public proof contains verified facts, not signatures or session secrets.
- Provider requests use fixed hosts, size limits and no redirects. User context is untrusted evidence.
- The prior valid image remains available on failure. A missing Gemini key selects the built-in trait renderer; configured provider failures retry.

The RPC scanner reports a bounded recent window, not lifetime indexed history. Browser tests use separate acceptance fixtures, never a public simulation mode. Provider and visual verification limits are in [testing.md](testing.md).

## Durable MVP boundaries

Previews persist source text before resumable image capture. `evidence_previews`, `source_capture_jobs`, `source_media_jobs`, `source_media` and source GridFS files retain exact capture generations. A preview-to-claim transaction checks the observed generation and hash before consumption. `claim_attempts` preserves prior evidence while retrying only unavailable sources; ambiguous submissions reconcile finalized GenLayer state without rebroadcast. `claim_events` exposes a sanitized public timeline.

Reward policy version 3 serializes positive contribution rewards at wallet scope: 75 XP once per UTC finalization day and a one-hour cooldown across midnight. The transaction re-reads current profile/version and commits ledger, earned-trait provenance, source event, history and job together. Optional equipment is owner-controlled and does not change automatically on unlock. Its own history/jobs use source-event uniqueness, and publication checks the target version. History can resolve the previous image across pagination boundaries.

Original token metadata is read-only, safely bounded and cached separately from companion artwork, with explicit refresh failure status. Anonymous public X hydration supports stable numeric identities and source-bound attached images without content interpretation. Fixed provider boundaries and image validation reject unrelated posts, private URLs and unsupported media.

The Next adapter enforces the request limit before buffering; Fastify normalizes error/request IDs and uses shared Mongo quotas. Lists use stable opaque cursors. Provider/job metrics are bounded aggregates. Schema version 3 is applied explicitly and repeatably before readiness, never during request cold starts. Both API-instance restarts and actual Mongo transactions are exercised separately from fixture browser tests.
