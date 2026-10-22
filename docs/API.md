# HTTP API reference

The unified application mounts these routes at `/api`; standalone Fastify uses the paths below. Example production base: `https://chog-evolution.vercel.app/api`. The implementation sources are [index.ts](../services/api/src/index.ts) and [product-routes.ts](../services/api/src/product-routes.ts).

[Protocol](protocol.md) · [Configuration](configuration.md) · [Operations](operations.md)

## Transport and common behavior

| Concern               | Contract                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Wallet authentication | `chog_session` HttpOnly cookie; browser calls use `credentials: "include"`                                              |
| Admin authentication  | `X-Quest-Admin-Key`; policy/review mutations also use `X-Admin-Actor`                                                   |
| JSON request limit    | 65,536 bytes, including chunked payloads, in API and Next adapter                                                       |
| Request ID            | `X-Request-Id` returned; standalone API accepts valid UUIDv4, Next adapter creates its own                              |
| Idempotency           | Required on claim, preview creation, claim retry and equipment mutations; stable key per intent, maximum 200 characters |
| Global quota          | 120 requests per minute per observed IP, plus lower route-specific quotas                                               |
| Rate response         | 429 with `Retry-After` and `X-RateLimit-*`; Mongo-backed across API instances                                           |
| Collection pagination | Normally `limit=1..100` (default 25), opaque `cursor`, `{items,nextCursor}`                                             |

JSON error shape:

```json
{
  "error": "wallet_not_authenticated",
  "message": "wallet not authenticated",
  "requestId": "ca4e6780-67b0-4a12-a523-38e6af28725c",
  "retryable": false
}
```

The ID above is illustrative. Status 202 with an `error`, such as `mint_receipt_pending`, uses the same envelope with `retryable: true`. A normal 202 `{item}` response is unchanged. Success envelopes vary by endpoint; metadata and binary/evidence responses do not use a common `{item}` wrapper.

| Status    | Interpretation                                                                    |
| --------- | --------------------------------------------------------------------------------- |
| 200 / 201 | Endpoint operation succeeded; not evidence of finalized XP                        |
| 202       | Persisted queued/partial work, or pending mint receipt; read the actual body      |
| 400       | Invalid fields, cursor or request shape                                           |
| 401 / 403 | Missing authentication, ownership or operator authority                           |
| 404       | Resource absent or not visible to the authenticated owner                         |
| 409       | Conflicting request intent, stale version, consumed source or nonretryable state  |
| 413       | Body exceeds transport limit                                                      |
| 422       | Ineligible source, stale policy or invalid evidence binding                       |
| 429       | Quota or retry bound; respect `Retry-After` when present                          |
| 5xx       | Configuration, storage or provider unavailable; preserve request intent/reference |

Errors do not reveal raw provider messages or secrets. A retryable flag is transport guidance, not permission to mint twice, change a source or rebroadcast an unknown submission.

## Maintained endpoint inventory

`Public` means no wallet cookie is required. `Wallet` means the current authenticated session; ownership-sensitive writes also verify onchain control. Development fixture scenario endpoints are excluded from this production contract and return 404 in production.

| Method and path                          | Access             | Purpose                                                  |
| ---------------------------------------- | ------------------ | -------------------------------------------------------- |
| `GET /health`                            | Public             | Process liveness                                         |
| `GET /ready`                             | Public             | MongoDB and schema readiness                             |
| `GET /v1/config`                         | Public             | Public-safe chains, collections and feature availability |
| `POST /v1/auth/nonce`                    | Public             | Issue wallet challenge                                   |
| `POST /v1/auth/verify`                   | Public             | Verify signature and set cookie                          |
| `GET /v1/auth/me`                        | Wallet             | Resolve session                                          |
| `POST /v1/auth/logout`                   | Cookie, if present | Revoke session and clear cookie                          |
| `POST /v1/mints/prepare`                 | Wallet             | Verify/simulate available demo mint                      |
| `POST /v1/mints/confirm`                 | Wallet/owner       | Verify receipt and register/queue once-only mint claim   |
| `POST /v1/profiles/discover`             | Wallet             | Bounded onchain NFT discovery                            |
| `POST /v1/profiles/register`             | Wallet/owner       | Compatibility identity registration                      |
| `GET /v1/profiles`                       | Wallet             | Current owned registered profiles                        |
| `GET /v1/passports/:id`                  | Public             | Profile and finalized evolution history                  |
| `GET /v1/traits`                         | Public             | Versioned trait catalogue                                |
| `PATCH /v1/profiles/:id/traits`          | Wallet/owner       | Idempotent version-checked equipment update              |
| `GET /v1/social/x`                       | Wallet             | Current X link                                           |
| `POST /v1/social/x/challenge`            | Wallet             | Issue bio code                                           |
| `POST /v1/social/x/verify`               | Wallet             | Verify public bio identity                               |
| `DELETE /v1/social/x`                    | Wallet             | Unlink current display association                       |
| `GET /v1/quests`                         | Public             | Active usable versioned policies                         |
| `POST /v1/evidence/previews`             | Wallet/owner       | Persist source preview and media work                    |
| `GET /v1/evidence/previews/:id`          | Wallet             | Preview status/source/eligibility                        |
| `POST /v1/evidence/previews/:id/retry`   | Wallet             | Resume or recapture a preview                            |
| `GET /v1/evidence/media/:id`             | Public             | Captured source image                                    |
| `POST /v1/claims`                        | Wallet/owner       | Claim under a selected active policy                     |
| `POST /v1/upgrades/evidence`             | Wallet/owner       | Submit maintained contribution policy                    |
| `GET /v1/claims`                         | Wallet             | Wallet-scoped paginated claims                           |
| `GET /v1/claims/:id`                     | Public             | Sanitized current result, source, attempts and timeline  |
| `POST /v1/claims/:id/retry`              | Wallet/owner       | Source recapture or unknown-reference reconciliation     |
| `GET /v1/evidence/:id`                   | Public             | Immutable attempt-1 JSON text                            |
| `GET /v1/evidence/:id/attempts/:attempt` | Public             | Exact numbered attempt JSON text                         |
| `POST /v1/scans`                         | Wallet/owner       | Bounded mainnet candidate scan                           |
| `GET /v1/scans/:id`                      | Wallet             | Saved coverage, checkpoints and candidates               |
| `GET /v1/activity`                       | Wallet             | Paginated mint/social/scan/claim/evolution activity      |
| `GET /v1/metadata/demo/:tokenId`         | Public             | Dynamic minted demo ERC-721 metadata                     |
| `GET /v1/artifacts/:id`                  | Public             | Completed published PNG or JSON from GridFS              |
| `POST /v1/admin/quests`                  | Admin              | Record operator-reviewed policy version                  |
| `GET /v1/admin/claims/review`            | Admin              | Manual review queue                                      |
| `POST /v1/admin/claims/:id/review`       | Admin              | Audited zero-XP rejection                                |
| `GET /v1/admin/metrics`                  | Admin              | Bounded operational aggregates and queue state           |

## Authentication

### POST /v1/auth/nonce

Body: `{address,chainId}`. `address` is a 20-byte EVM hexadecimal address; `chainId` is a supported numeric chain ID. Returns 201 `{message,expiresAt}`. Sign the exact returned message; do not reconstruct it client-side. Challenge expires after five minutes. Route quota: 8/minute.

### POST /v1/auth/verify

Body: `{message,signature}`. A recoverable 65-byte EVM message signature must match the stored, unconsumed challenge. Returns `{authenticated:true,wallet,expiresAt}` and sets a seven-day session cookie. Invalid/expired/replayed challenge returns 401. Route quota: 8/minute.

`GET /v1/auth/me` returns the authenticated wallet/expiry or 401. `POST /v1/auth/logout` revokes a matching session and returns `{authenticated:false}`. Signed proof is private; a sign-in is not an NFT transaction or XP event.

## Mint and profile registration

### POST /v1/mints/prepare

No domain body required. Returns:

```text
{
  chainId: number,
  transaction: { to: EvmAddress, data: HexCalldata, value: "0x0" },
  supply: { minted: DecimalString, maxSupply: DecimalString }
}
```

Verifies chain, collection name/symbol, supply and mint simulation for the session wallet. Submit the returned transaction through the selected wallet only after the user's confirmation. Route quota: 6/minute.

### POST /v1/mints/confirm

Body: `{transactionHash}`. Checks successful receipt, sender, exact configured collection, canonical block hash, confirmation depth, one mint event and current owner. Returns `{item:Profile,claim:Claim}` or `{item:Profile,claimWarning:string}` if registration succeeded while review creation is unavailable. A pending receipt returns 202 with the error envelope. Quota: 20/minute.

Persist and retry the same hash. A lost HTTP response or review warning is not a reason to call mint again. No separate idempotency header is required: mint claim intent uses the verified transaction hash.

### POST /v1/profiles/discover

Body: `{mode?,cursor?}` with default `mode:"demo"`; alternative `original_companion`. Returns `{items,partial,nextCursor}` and coverage fields supplied by discovery. Enumeration is preferred; nonenumerable collections use bounded token-ID owner reads. Continue the supplied discovery cursor unchanged. Quota: 40/minute.

### POST /v1/profiles/register

Body: `{mode,chainId,collectionAddress,tokenId}`. Token ID is a decimal string. This compatibility route verifies allowed chain/collection and `ownerOf`, returning 201 `{item:Profile}`. It does not accept arbitrary NFT collections or independently prove a mint. Quota: 10/minute.

`GET /v1/profiles` returns `{items:Profile[],nextCursor}` after checking current ownership. Profiles that transferred away are removed from that wallet's current association. A filtered empty page can still have a cursor.

## Profiles, history and equipment

Representative `Profile` shape:

```text
{
  id, nft: { mode, chainId, collectionAddress, tokenId },
  displayName, xp, level, stage, traits,
  earnedTraitIds, equippedTraitIds, traitCatalogueVersion,
  version, artworkVersion, artworkPending,
  artworkUrl?, mintTransactionHash?, createdAt, updatedAt,
  originalMetadata?, originalMetadataStatus?,
  originalMetadataErrorCode?, originalMetadataAttemptedAt?
}
```

`GET /v1/passports/:id` returns `{item:{profile,history,nextCursor}}`. History includes claim/source event, versions, XP total, before/after snapshots, artwork URL/hash and decision reference. Its cursor is profile/version-bound and distinct from ordinary collection cursors. History can resolve a previous image across page boundaries.

`GET /v1/traits` returns `{items,version}` for the catalogue.

### PATCH /v1/profiles/:id/traits

Body: `{equippedTraitIds:string[],expectedVersion:number}` plus `Idempotency-Key`. Returns `{item:Profile}`. At most two distinct earned optional traits, one per slot. Bright eyes cannot be removed; scarf/crown share the accessory slot. A stale version returns 409. Quota: 10/minute.

An effective equipment change increments version, history and artwork work without XP or GenLayer adjudication. Newly earned optional traits do not automatically equip.

## X identity

`GET /v1/social/x` returns `{item:link|null}`. `POST /v1/social/x/challenge` returns 201 `{bioCode,expiresAt}`; the challenge lasts 30 minutes (quota 4/minute).

`POST /v1/social/x/verify` body is `{username}` with an optional leading `@`. The API fetches the public bio and verifies code plus stable numeric identity, returning `{item:{username,verifiedAt}}`. Quota: 5/minute. Missing code is 422; expired challenge or identity bound to another wallet is 409.

`DELETE /v1/social/x` returns `{linked:false}`. Unlinking does not free a stable account ID for another wallet. The current link proves identity, not social engagement, and linking alone does not award XP.

Default `X_SOURCE_MODE=public_page` requires no OAuth or API key. Optional explicit `api` mode uses `X_API_BEARER_TOKEN`. Submitted post authors must match the verified stable ID.

## Previews, claims and immutable evidence

### POST /v1/evidence/previews

Body: `{profileId,questId?,url,text?}` plus `Idempotency-Key`. URL and untrusted context are each capped at 1,000 characters. Omitted quest selects the maintained contribution policy. Returns `{item:Preview}`, with 202 for reading/pending work or 200 for an immediately resolved preview. Quota: 6/minute.

```text
Preview = {
  id, profileId, questId, claimId, status, source, media,
  eligibility: { eligible, reasonCode?, message, ... },
  errorCode, attempts, expiresAt
}
```

Previews expire after ten minutes. GET is owner-only. Retry accepts an optional stable `Idempotency-Key` and resumes saved capture or creates a new generation after expiry. Quota: 4/minute. Consumed previews resolve to the existing claim. Early eligibility can report consumed source or reward allowance; it is not approval, and allowance is rechecked at finalization.

X capture accepts at most four JPEG/PNG/WebP attachments, 10 MiB each, 20 MiB combined and 16 million pixels each; animation is rejected. Source text is saved before images. The exact parsed post and author must match, and images are not semantically interpreted. GitHub capture pins public repository/commit/README and requires wallet attribution.

### POST /v1/claims

Body: `{profileId,questId,previewId?,url?,text?,transactionHash?}` plus `Idempotency-Key`. The policy kind determines required server-verified evidence. Returns 202 `{item:Claim,duplicate:false,status}` for a new queued claim, or 200 with the existing item and `duplicate:true`. Quota: 10/minute.

### POST /v1/upgrades/evidence

Body: `{profileId,previewId?,url?,text?}` plus `Idempotency-Key`. Uses `ecosystem-contribution`; at least a URL or preview is required. Response is the same claim envelope. Quota: 6/minute.

Claims require an active, recently checked quest policy, or a versioned app-maintained evergreen policy. The pinned policy, current NFT ownership and captured attribution are verified before creating the claim. Preview consumption checks exact generation, source hash and request/policy identity in the creation transaction.

Idempotency is wallet-scoped and bound to intent, excluding changing capture timestamps. Reusing a key with changed intent returns 409. Global source uniqueness applies at creation across quests/profiles/wallets. A repository's new commit is not a fresh contribution source.

Representative public `Claim`:

```text
{
  id, profileId, questId, questName, questSlug, status,
  decisionReference, createdAt, updatedAt,
  outcome, reasonCode, explanation, xpAward, finalized,
  attempt, canRetry, retryKind, timeline,
  evidenceHash, evidenceUrl, attempts, source?, media?
}
```

`GET /v1/claims` is wallet-scoped; `GET /v1/claims/:id` is public and sanitized. Attempt entries preserve attempt number, evidence hash/URL, decision reference/outcome and creation time. Public evidence does not expose sign-in messages, signatures or cookies.

### POST /v1/claims/:id/retry

Requires `Idempotency-Key` and current ownership. Returns 202 `{item:Claim}`. `source_unavailable` recaptures the same logical source under a new numbered attempt. `submission_reference_unknown` requests finalized-state reconciliation without rebroadcast. Rejected claims are terminal. At most 100 numbered attempts are allowed. Quota: 4/minute.

### Immutable evidence routes

`GET /v1/evidence/:id` serves attempt 1; `GET /v1/evidence/:id/attempts/:attempt` serves exact numbered evidence. Body is **JSON text under `text/plain; charset=utf-8`**, not a wrapped JSON object. Cache is public/immutable. Hash raw returned UTF-8 bytes; do not parse/reserialize. A public HTTPS origin is required for GenLayer validators.

`GET /v1/evidence/media/:id` serves a captured source image from its bound GridFS record. IDs are UUID-style source media IDs. `GET /v1/artifacts/:id` instead uses 24-hex GridFS file IDs and requires completed published artifact/job binding.

## Reward semantics visible to clients

| Quest            | Maximum reward | Scope                                                                |
| ---------------- | -------------: | -------------------------------------------------------------------- |
| Demo first mint  |          50 XP | Once per wallet                                                      |
| Verified X bio   |          50 XP | Once per wallet and stable X identity                                |
| Contribution     |          75 XP | One positive reward per UTC finalization day, with one-hour cooldown |
| Mainnet activity |          25 XP | Once per wallet per UTC block date                                   |

`accepted` and `xpAward` are different facts. An accepted claim may have zero XP with `daily_cap`, `cooldown` or `ownership_changed`. Positive XP/profile/history/jobs commit transactionally only after finality and complete attempt/wallet/NFT/quest/policy/hash binding. Pending or malformed decisions cannot add XP. See [protocol.md](protocol.md).

## Scans and activity

`POST /v1/scans` body is `{profileId}`. Returns coverage/candidate results, with 202 if partial or 200 when the bounded request finishes. Quota: 8/minute. Scans verify current NFT control on its own chain but inspect ecosystem activity on Monad mainnet.

`GET /v1/scans/:id` is wallet-scoped and returns `{item,claims,candidateOnly:true}`. `GET /v1/activity` returns a wallet-scoped paginated event collection. Scanning itself awards no XP. Reported coverage is a recent/checkpoint window, not lifetime account history.

## Metadata and assets

`GET /v1/metadata/demo/:tokenId` verifies minted existence and returns ERC-721 `{name,description,image,attributes,external_url}`. Cache: 30 seconds with revalidation. Missing database fails rather than publishing a temporary XP reset; an unevolved minted token can use deterministic base art.

Published artifact responses are `image/png` or `application/json`, public immutable cache up to one year. The Next adapter buffers injected responses; this does not imply a streaming object-storage/CDN integration. Original metadata remains read-only with explicit failed-refresh status and last valid content retained.

## Operator endpoints

### POST /v1/admin/quests

Body includes `slug,name,description,status,sourceUrl,rules,xpReward,verificationMethod,allowedEvidenceHosts,startsAt?,endsAt?,sourceReviewed:true`. `verificationMethod` is `public_evidence`, `manual` or `hybrid`; XP is 1–75. Requires key and actor; returns 201 `{item,sourceReviewed:true,sourceCheckedAt}`. Operator source review is an attestation, not an automatic campaign verifier. Quota: 10/minute.

`GET /v1/admin/claims/review` returns a paginated review queue. `POST /v1/admin/claims/:id/review` body must be `{outcome:"rejected",xpAward:0,explanation}`; requires key/actor and a reviewable claim, returns `{item}`. Quota: 20/minute. Manual review cannot grant XP.

`GET /v1/admin/metrics` returns aggregate metrics, capture/claim/artwork queue summaries and observation time. It requires the shared admin key and exposes no raw source/signature/secret logs. See [operations.md](operations.md).
