# Operator runbook

Operate from persisted claims, attempts and network references. Keep reward authority, source capture and artwork recovery separate. This runbook describes current tooling and manual procedures; it does not imply a general repair CLI exists.

[Protocol](protocol.md) · [Deployment](deployment.md) · [Security](security.md)

## Routine health and queue inspection

```sh
curl --fail https://chog-evolution.vercel.app/api/health
curl --fail https://chog-evolution.vercel.app/api/ready
curl --fail https://chog-evolution.vercel.app/api/v1/config
curl --fail https://chog-evolution.vercel.app/api/v1/quests
```

`/health` is process liveness. `/ready` requires MongoDB/schema 3. Usable quests show migration/configuration/policy availability. None alone proves a funded signer, successful consensus or image generation.

Authenticated admin metrics at `GET /v1/admin/metrics` require `X-Quest-Admin-Key`. The response contains bounded request/provider/job aggregates, capture/claim/artwork counts, oldest queued time, queue age and overdue leases. Supply credentials through private operator tooling rather than copying them into public artifacts.

Investigate rising queue age with workflow history, provider failures, attempt references and leases. Metric failure does not authorize reconstructing or resetting a claim from memory.

## Worker execution

The [worker workflow](../.github/workflows/evolution-worker.yml) uses `cron: "*/5 * * * *"` and manual dispatch. Workflow concurrency does not cancel an in-flight run; MongoDB leases also coordinate queue work.

Manual execution for an already reviewed worker environment:

```sh
npm run build --workspace=@chog/worker
node --env-file=.env.production services/evolution-worker/dist/index.js --once
```

In a preconfigured shell, `npm run once --workspace=@chog/worker` is equivalent. A tick processes a bounded capture batch, claim batch and one artwork job. The normal continuous worker delays between ticks; a cron tick exits after bounded work.

| Work type         | Recovery control                                                   |
| ----------------- | ------------------------------------------------------------------ |
| Capture/media     | Durable source-first checkpoints and separate leases               |
| Claim             | Expiring claim lease and stored submission reference               |
| Pending consensus | Another poll after 15 seconds; no provider failure increment       |
| Provider errors   | Bounded backoff; eight failures move claim to review               |
| Artwork           | Dedicated lease, upload checkpoints and bounded automatic attempts |

A missing worker signer is fatal to the production CLI. Do not resolve a configuration error by running production data in a development/manual-review-only mode.

## Mint recovery

If the wallet has a transaction hash, recover that hash rather than requesting another mint. `POST /v1/mints/confirm` verifies the receipt, configured collection/token and current owner, then registers the profile and starts its idempotent mint quest.

A 202 `mint_receipt_pending` means wait for receipt/confirmations. A registered profile with `claimWarning` means registration succeeded and review needs recovery; confirming the same hash retries review without another NFT. Reverted or wrong-owner receipts cannot be converted into rewards manually.

## Preview and source recovery

| State                 | Action                                                                           |
| --------------------- | -------------------------------------------------------------------------------- |
| `reading` / `pending` | Fetch the same owner-scoped preview and allow leased work to finish              |
| Partial media         | Explicit retry resumes the saved source revision/checkpoints                     |
| `expired`             | Retry creates a new capture generation; submit the newly observed ready revision |
| `consumed`            | Follow `claimId`; do not create another claim                                    |
| Attribution failure   | Correct the actual verified source/identity, not the stored proof                |

Preview retry is `POST /v1/evidence/previews/:id/retry`; reuse a stable idempotency key when provided. A ready preview is not GenLayer acceptance. Do not substitute new text into a saved generation or copy images from another post.

## Claim recovery

### Consensus pending

For `awaiting_genlayer`, retain the saved reference and let the worker poll. `ACCEPTED` is insufficient for XP; it must read a valid `LATEST_FINAL` decision after finality. Pending consensus is not a failed provider attempt and does not authorize rebroadcast.

### Submission reference unknown

`submission_reference_unknown` indicates that a broadcast may have happened without a persisted hash. The owner retry endpoint requests finalized-state reconciliation by the current contract claim ID. If no finalized decision is found, the claim stays in review and is not resent. If a matching decision exists, recovery uses a `final-state:<contract>:<claim>` reference.

Do not clear `genlayer_tx_id`, reset the state to `submitted`, alter the attempt ID or fabricate a transaction hash. An operator needing broader repair must inspect actual network state and preserve the uncertainty/audit trail.

### Finalized source unavailable

The owner can call `POST /v1/claims/:id/retry` with an idempotency key. The API checks current ownership and the pinned policy, captures the same logical source, adds a numbered immutable attempt and preserves previous evidence/decision references. It permits at most 100 attempts. Existing attempt 1 remains at its original evidence URL.

Rejection is terminal. Unsupported source identity changes, another wallet/profile or a new repository commit cannot bypass global source consumption.

### Accepted with zero XP

Read `reasonCode`, `xpAward` and finalization time. Contribution `daily_cap` and `cooldown`, or `ownership_changed`, preserve accepted adjudication without progression. That is a legitimate persisted outcome, not a failed finalization to be repaired into an award.

## Equipment and artwork

A 409 stale equipment version requires fetching the latest profile and resolving user intent with a fresh `expectedVersion`. Do not overwrite a concurrently advanced profile. Only earned optional traits in distinct permitted slots can be equipped.

Image failures do not undo rewards. Inspect the existing job, provider quota and upload checkpoints; preserve the last valid image. Automatic image recovery is bounded. There is no documented general “reset every failed job” CLI; any exhausted-job intervention needs an inspected, audited repair of the specific job.

Late old jobs may complete historical art. Their version condition must prevent replacing current art. Check completed job/artifact/source-event binding and GridFS file/chunks before treating publication as complete. Never update the current profile URL without its matching artifact and target version.

## Policy administration

`POST /v1/admin/quests` uses the shared admin key, actor label and `sourceReviewed: true`. It creates a new version; operator attestation does not mean the endpoint independently verified an external campaign. Review actual source, dates, eligibility, host boundaries, completion signal and reward scope.

The manual review queue can be rejected with zero XP. It cannot be accepted or positively rewarded. App-managed quest availability is updated by migration; a local `.env` edit alone does not pause a deployed quest or rewrite an existing claim policy.

## Backups and restoration

Include domain records **and** both GridFS buckets, including files and chunks. Critical families are wallet identity/proofs, profiles, policies, previews/source checkpoints, claims/attempts/evidence, decisions, XP, history, jobs and artifacts.

Restoration is a manual operational procedure:

1. Stop affected API mutations and workers before applying restored state.
2. Restore to an isolated database; do not expose it to production execution yet.
3. Verify schema/indexes, NFT/claim/source uniqueness and ledger/profile consistency.
4. Verify policy and attempt references, public evidence digests and GridFS bytes/bindings.
5. Reconcile pending external submissions with their actual network state.
6. Point processes at the reviewed restored database and verify readiness plus queue behavior.
7. Record the restore revision/time and unresolved cases before reopening submissions.

Replaying from an old backup can omit an externally finalized transaction. Do not assume a database restore reverses it. Restore profile totals with their ledger/history rather than independently assigning XP. Hashes detect inconsistent bytes but do not reconstruct missing data.

## Secret rotation and incident handling

For suspected signer/database compromise, stop affected execution, preserve nonsecret attempt/reference/audit evidence and rotate credentials. Session compromise requires revocation and fresh wallet authentication. Provider read-key rotation does not require another claim or mint.

The GenLayer contract has no exposed ownership rotation. A new signer/contract requires deliberate provisioning and handling of pending claims tied to the old runtime target; the worker does not automatically route per historical deployment. Demo metadata owner rotation is a separate inherited Solidity ownership operation.

Use [SECURITY.md](../SECURITY.md) for private reporting. Do not publish raw secrets, signed transaction material or production database contents in incident notes.

## Release/rollback review

A release is ready only after required build/contract/persistence/browser checks and relevant live observations. The current workflow migrates before deploying; an incompatible migration can affect the running older process. Review that ordering before changing the schema.

A code rollback is not a database downgrade or chain rollback. Keep the compatible schema and preserved records until an explicit migration/reconciliation is reviewed. Readiness, queue age and current provider acceptance must be measured again after recovery; historical successes are not fresh proof.
