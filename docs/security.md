# Security and trust model

CHOG Evolution combines finalized GenLayer adjudication with operator-controlled evidence capture and offchain progression. No independent audit or formal security certification is claimed. The important assets are wallet authentication, NFT control, evidence integrity, reward uniqueness and preserved history.

[Protocol specification](protocol.md) · [Private reporting](../SECURITY.md) · [Recovery](operations.md)

## Trust boundaries

| Boundary                     | What is trusted                                                  | Failure consequence                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Browser → API                | Verified session, not client ownership/XP assertions             | Unauthorized control or fabricated proof if validation is bypassed                                                    |
| API → Monad RPC              | Configured chain, canonical receipt/block and current `ownerOf`  | Incorrect ownership or activity evidence from compromised RPC                                                         |
| API → public source          | Exact parsed identity, stable attribution and bounded capture    | False contribution facts or source unavailability                                                                     |
| Adjudicator owner → GenLayer | Backend-selected policy, evidence digest and claimant            | Compromised signer can submit arbitrary policies/snapshots; downstream bindings alone do not establish external truth |
| GenLayer → worker            | Finalized state plus exact decision binding                      | Pending/mismatched results must produce no XP                                                                         |
| Worker → MongoDB             | Transactional correctness, unique indexes and operator integrity | Offchain XP/history can be lost or changed by privileged storage access                                               |
| Renderer → publication       | Image validation and authoritative snapshot                      | Broken/incorrect artwork must not change rewards                                                                      |

Validators independently retrieve the API snapshot. They do not independently reconstruct the original X/GitHub/RPC capture. A SHA-256 match proves byte consistency with submitted evidence, not the original source's honesty or a trustless storage commitment.

## Privileged capabilities

| Capability                | Holder                            | Scope                                                                                           |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Demo collection ownership | Solidity `Ownable` owner          | Change all demo token base URIs; transfer/renounce ownership through inherited methods          |
| Adjudicator submission    | GenLayer deployment owner         | Choose submitted claim, rules, source and XP maximum; duplicate contract claim IDs are rejected |
| Quest administration      | Holder of `QUEST_ADMIN_API_KEY`   | Create versioned operator-reviewed policies and reject review-queue claims with zero XP         |
| Database administration   | MongoDB operator                  | Control persisted profiles, evidence, ledgers, leases and assets                                |
| Deployment configuration  | Repository/hosting administrators | Change runtime contracts, origins, provider keys and code                                       |

The GenLayer source exposes no owner-transfer method. Rotating its submission identity generally requires a new adjudicator deployment and an explicit policy/configuration migration. Existing pending attempts must retain their original adjudicator context during recovery; changing the address blindly is unsafe.

Manual review cannot accept a claim or issue positive XP. `X-Admin-Actor` is an audit label supplied under a shared key, not an independent operator identity or per-user authorization system. No automatic database rollback or governance delay protects operator changes.

## Authentication and client isolation

- Five-minute challenges bind origin, supported chain and address; signature recovery verifies the exact stored message.
- Conditional nonce consumption prevents concurrent challenge replay.
- Session tokens are hashed at rest, expire after seven days and can be revoked.
- Production cookies are HttpOnly, Secure and SameSite=Lax.
- Signed authentication proofs are retained privately for claims; public evidence omits raw messages, signatures and session material.
- Current ownership is checked for profile mutations and before positive finalization.
- Browser account changes clear private state; a new owner must authenticate to control a transferred NFT.

This is a custom signed-message flow, not an asserted full SIWE implementation. There is no separate CSRF token or per-mutation Origin check in the current routes; deployment relies on the cookie policy and configured CORS origin. XSS in the allowed origin remains consequential. Ownership reads cannot atomically lock a token against transfer during a subsequent MongoDB commit.

## Evidence and prompt handling

Policy is pinned when the claim is created. Source and user context are untrusted data in both the evidence envelope and adjudication prompt. The contract normalizes supported outcomes, reason and integer XP, caps accepted XP and forces nonaccepted XP to zero. The worker verifies all identities and exact accepted reward before using a decision.

Captured images establish attachments only. Decoding checks integrity and resource bounds; the policy explicitly excludes image-content inference. A wallet address in a README establishes only server-observed attribution, not a cryptographic signature by the repository owner, originality or quality. Those limits must remain visible to reviewers.

Prompt instructions and validator agreement reduce some failure modes; they do not prove universal resistance to prompt injection or factual mistakes. Ambiguous decisions are retained for review without rewards.

## Fetch and media controls

| Source                  | Implemented boundary                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Contribution URLs       | Supported canonical X post or GitHub repository patterns; public HTTPS and server-chosen provider requests                          |
| X pages                 | Fixed HTTPS host/path; one exact same-path username-case redirect permitted; unrelated paths, post IDs and redirect chains rejected |
| GitHub                  | Fixed API host, bounded responses, pinned commit/README, redirects rejected                                                         |
| Source photos           | Exact parsed post attachments, permitted provider media URLs, type/byte/pixel bounds and no animation                               |
| Original token metadata | Bounded supported URI retrieval with public-address checks, restricted redirects and explicit error state                           |
| GenLayer snapshot       | HTTPS source and matching exact SHA-256 body                                                                                        |

Inspect [public-x.ts](../services/api/src/public-x.ts), [evidence-source.ts](../services/api/src/evidence-source.ts), [media-capture.ts](../services/api/src/media-capture.ts) and [original-metadata.ts](../services/api/src/original-metadata.ts) for the precise allowlists. These are implementation controls, not a blanket claim that all possible network attacks are impossible.

## Replay, concurrency and recovery

Unique indexes cover source, request and reward scopes. The finalization transaction serializes wallet contribution allowance and reads the latest profile. Equipment requires an expected version; current image publication requires the target version. Each mechanism protects a separate state transition.

Unknown external submission references must not be reset to `submitted`. Recovery reads finalized state by the immutable attempt ID and preserves zero XP if no decision is found. Source-unavailable recapture adds a numbered attempt and retains the previous snapshot. Terminal rejection cannot be retried into a fresh source.

## Request and secret controls

JSON bodies are capped at 64 KiB in the web adapter and Fastify, including chunked payloads. Shared fixed-window quota buckets use hashed keys and fail closed if Mongo quota storage is unavailable. The global ceiling is 120 requests per minute per observed client IP; sensitive routes impose smaller quotas. Limits do not prevent all distributed abuse or prove a one-human-one-wallet system.

Private RPC URLs are separated from browser-safe runtime configuration. Logs redact cookie/authorization headers and provider errors. Bounded metrics store aggregate names and durations rather than raw URLs, signatures or secrets.

Use separate least-privilege credentials for deployment, MongoDB, provider reads and adjudication. Keep `GENLAYER_PRIVATE_KEY`, `MONAD_OWNER_PRIVATE_KEY`, provider keys and database URIs out of `NEXT_PUBLIC_*`, artifacts and repository history. Project tooling does not provide an HSM or key vault; secret storage is an operator responsibility.

## Public data and retention

Claim pages, evidence snapshots, source images, passports and artifacts are public by design. Submitted public content can remain in immutable references after the original provider changes or deletes it. Authentication proofs are private but intentionally retained separately from expiring session/nonce records. There is no general automated claim-erasure or privacy-retention API in this MVP.

A database backup must include evidence, policy versions, XP, attempts, history and GridFS. Content hashes can detect inconsistent recovered bytes but cannot reconstruct lost assets or prevent privileged administrators from replacing both data and claimed hashes.

## Residual limits

- XP and equipment are offchain and operator-controlled; no cross-chain proof or onchain reward commitment exists.
- The owner-gated adjudicator and shared admin key concentrate authority.
- Stable X IDs and source deduplication reduce reuse but do not establish universal Sybil resistance.
- RPC and source outages, rate limits, consensus delays and image quotas can stop progress without losing already committed rewards.
- Anonymous X capture depends on provider page formats and availability.
- Metadata hosting and the demo owner's base-URI power affect NFT presentation.
- Test results and recorded live acceptance are scoped evidence, not audit certification or guaranteed availability.

For an incident, retain immutable attempt/reference data, stop affected execution, rotate compromised credentials and reconcile state under [operations.md](operations.md). Report vulnerabilities through [SECURITY.md](../SECURITY.md).
