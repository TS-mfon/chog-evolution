# API contract

API base path is `/v1`. Implemented development routes return JSON errors with a stable `error` code. The current handler does not yet normalize Fastify validation errors into a common request-ID envelope.

## Implemented endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Process health only; it does not certify provider readiness. |
| `GET /v1/quests` | Returns only active, configured quests. Empty means no quest is currently verified and enabled. |
| `POST /v1/auth/nonce`, `POST /v1/auth/verify`, `GET /v1/auth/me`, `POST /v1/auth/logout` | Signed one-time challenge and expiring wallet-bound session. |
| `POST /v1/profiles/register`, `GET /v1/profiles` | Register and list profiles after current chain ownership verification. |
| `GET /v1/passports/:id` | Read a public profile and finalized accepted evolution history; captured evidence text is never published. |
| `GET /v1/artifacts/:id` | Stream a validated, published image or JSON metadata artifact from MongoDB GridFS. Only artifact IDs recorded as published can be retrieved. |
| `GET /v1/social/x`, `POST /v1/social/x/challenge`, `POST /v1/social/x/verify` | Read linked handle, issue a 30-minute wallet-bound bio code, and check the public bio using the official X API. Requires `X_API_BEARER_TOKEN`; this does not verify likes, follows, views, or private engagement. |
| `DELETE /v1/social/x` | Unlink the verified X identity from the authenticated wallet and write an audit event. |
| `POST /v1/scans`, `GET /v1/scans/:id` | Scan configured, chain-scoped log targets for the signed wallet, persist block checkpoints and candidate events, and resume a partial scan. Candidates are informational and never create claims or XP. Requires `MONAD_SCAN_TARGETS` and the selected chain RPC. |
| `GET /v1/claims`, `POST /v1/claims`, `GET /v1/claims/:id` | List claim history, submit allowlisted evidence for an active quest, and inspect lifecycle. Submission requires an authenticated, currently owning wallet and an `Idempotency-Key`. |
| `POST /v1/admin/quests` | Create a new immutable policy version after an authenticated operator attests that the official source and rules were reviewed. Requires `x-quest-admin-key` and audit label `x-admin-actor`. |
| `GET /v1/admin/claims/review`, `POST /v1/admin/claims/:id/review` | Read review queue and record an audited rejection. Manual review cannot award XP or finalize acceptance. Writes require `x-quest-admin-key` and audit label `x-admin-actor`. |
| `POST /v1/dev/scenarios` | Creates or reuses an explicitly simulated local walkthrough; nonproduction-only and separately feature-gated. Requires `Idempotency-Key`; body `{ "outcome": "accepted" | "rejected" | "pending" }`. |
| `GET /v1/dev/scenarios/:id` | Reads a persisted local scenario. Response always marks `simulated: true` / `stateKind: "local_simulation"`. |

The local simulation is not evidence of blockchain activity, NFT minting, or a GenLayer decision. Production must refuse these routes even if a client sets the feature flag.

## Current limitations

- No separately paginated profile-history endpoint exists; the Passport response includes accepted history and artifact references.
- No dedicated evolution-job status/retry endpoint exists yet.
- Artifact output uses MongoDB GridFS and the worker path is implemented, but provider generation and storage have not been verified live in this environment.

Scan targets are explicit operator configuration entries: `{chainId,address,topic0,walletTopicIndex,startBlock,name,questSlug?,explorerTxBase?}`. The empty example config scans nothing. No candidate is treated as evidence or awarded XP until it is separately submitted and verified through the claim flow.

Claim writes return a persisted `submitted` claim only when an active, recently checked quest policy and allowed public evidence domain are configured. A claim has no XP while it is submitted, processing, pending finality, rejected, needs review, or unresolved. The worker requires database and GenLayer configuration; accepted XP is committed atomically only after successful finality and strict binding checks. The local scenario endpoint is a judge/development aid only.
