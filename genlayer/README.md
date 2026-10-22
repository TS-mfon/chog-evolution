# ClaimAdjudicator contract reference

[ClaimAdjudicator.py](ClaimAdjudicator.py) is an owner-gated GenLayer Intelligent Contract. It records adjudication for one immutable claim attempt. It does not mint, transfer, award XP or modify an NFT.

[Protocol](../docs/protocol.md) · [Worker finality adapter](../services/evolution-worker/src/genlayer.ts) · [Trust model](../docs/security.md)

## Source and recorded deployment

| Field               | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Dependency pin      | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Network / chain     | GenLayer StudioNet / `61999`                                       |
| Contract            | `0x73Bd1106FFa722cf8e71A04f612ee868CDCd2396`                       |
| Client alias        | `genlayer-js-stable`, pinned to `genlayer-js@1.1.8`                |
| Deployment evidence | [genlayer-studionet.json](../deployments/genlayer-studionet.json)  |

The owner is `gl.message.sender_address` at construction. No owner-transfer method is exposed. Only that owner may call adjudication, because caller-selected permissive policies must not create application reward authority.

## Write interface

```python
adjudicate(
    claim_id: str,
    claimant: str,
    profile_identity: str,
    policy_version: int,
    quest_id: str,
    rules: str,
    source_url: str,
    evidence_text: str,
    evidence_hash: str,
    max_xp: int,
) -> dict
```

| Argument           | Validation / meaning                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| `claim_id`         | Nonempty, at most 128 characters, not previously adjudicated; attempt-specific ID    |
| `claimant`         | Nonempty, at most 128 characters; application binds normalized wallet                |
| `profile_identity` | Nonempty, at most 256 characters; application uses chain/collection/token            |
| `policy_version`   | Positive; application binds pinned quest version                                     |
| `quest_id`         | Nonempty, at most 128 characters                                                     |
| `rules`            | Nonempty, at most 4,000 characters; worker includes official source reference        |
| `source_url`       | HTTPS prefix, at most 2,048 characters; operator capture/host validation is stricter |
| `evidence_text`    | 1–20,000 characters, exact UTF-8 snapshot                                            |
| `evidence_hash`    | `0x` SHA-256 of exact evidence text                                                  |
| `max_xp`           | 1–10,000; worker uses the pinned quest maximum                                       |

The contract does not independently recover a wallet signature or reconstruct original RPC/X/GitHub capture. Those facts are supplied in the backend-verified snapshot and remain a trust boundary.

## Decision schema

```text
{
  claim_id: string,
  claimant: string,
  profile_identity: string,
  policy_version: integer,
  outcome: "accepted" | "rejected" | "needs_review" | "source_unavailable",
  evidence_hash: string,
  quest_id: string,
  reason: string,
  xp: integer
}
```

There is **no `reference` field** in this contract result. The transaction hash comes from the actual SDK submission response and is stored by the worker separately. Ambiguous recovery can use an explicitly labeled finalized-state reference.

Normalization requires supported outcome, nonempty reason and integer XP 0–10,000. Nonaccepted XP is forced to zero; accepted XP is capped to `max_xp`. Reason is trimmed and bounded to 500 characters. The worker additionally requires accepted XP to equal the pinned exact quest reward.

## Leader and validator procedure

1. The leader retrieves `source_url`, verifies HTTP success and exact body digest.
2. It evaluates stored rules with source/context explicitly treated as untrusted data.
3. Validators independently retrieve the same API-hosted body and verify its digest.
4. Validators independently evaluate the policy and compare outcome, quest, evidence hash and XP.
5. Reason wording may differ while decision-bearing fields agree.
6. Agreed unavailability is a supported zero-XP outcome; malformed/inconsistent results cannot authorize rewards.

The fetched URL is the application's immutable snapshot, not an independent live read of the original provider by each validator. Hash agreement establishes snapshot consistency, not external-source truth or resistance to every possible prompt attack.

## Read interface and finality

```python
get_claim_decision(claim_id: str) -> str
```

Returns stored JSON text, or an empty string when no decision exists. The worker reads using `TransactionHashVariant.LATEST_FINAL`; ordinary proposal execution or an `ACCEPTED` status is insufficient.

Normal reward reconciliation requires `FINALIZED` transaction status without explicit execution failure, followed by a fully bound finalized decision. Attempt ID, claimant, NFT, quest, policy version, digest and XP must match. A valid acceptance still passes wallet allowance and current ownership checks before any positive MongoDB commit.

Missing submission references are held for explicit finalized-state reconciliation by contract claim ID. A matching stored result can be recorded as `final-state:<contract>:<claim>`. No match leaves the claim in review without rebroadcast. [Recovery details](../docs/operations.md).

## Attempt and policy compatibility

Attempt 1 uses the logical claim ID. Source-unavailable recapture creates `<claimId>:<attemptNumber>` and a new evidence URL while retaining old revisions. The adjudicator's duplicate-ID protection prevents overwriting an earlier attempt result. Rejections are terminal in the application.

Changing the runtime contract while old attempts remain pending requires deliberate reconciliation. The current worker does not automatically route every historical attempt to its original deployment. A new owner generally requires a new contract rather than an in-place ownership update.

## Verification and deployment tooling

```sh
node scripts/verify-genlayer.mjs
genvm-lint check genlayer/ClaimAdjudicator.py
```

Install the CLI from `genvm-linter==0.11.0`. Static guard/AST/SDK checks establish source consistency, not live consensus behavior. Worker tests and persistence acceptance cover finality/binding/recovery with controlled providers; [release evidence](../docs/mvp-release.md) records actual production observations.

The historical deployment script is pinned to the recorded account/manifest. It uses `leaderOnly: true` for deployment and waits for an accepted receipt plus schema verification. Its `finalized_deployment_verified` label alone is not claim-finality proof. Reward submissions retain validator consensus and the stricter worker path. Do not delete the manifest to force another deployment.
