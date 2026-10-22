# Quest registry and policy maintenance

A quest is data with versioned verification rules. Its current availability is separate from the immutable policy pinned by an existing claim. [Protocol](protocol.md) · [API administration](API.md) · [Operations](operations.md).

## Record and policy model

| Record                          | Required meaning                                                   |
| ------------------------------- | ------------------------------------------------------------------ |
| Quest `slug`, name, description | Stable identity and user-facing activity                           |
| Quest status                    | `active`, `paused` or `inactive`                                   |
| Policy source URL/check time    | Authoritative reference and reviewed freshness                     |
| Eligibility window              | Explicit starts/ends, timezone-aware dates                         |
| Policy kind/rules               | Verifiable activity and interpretation constraints                 |
| Allowed hosts                   | Public snapshot host and permitted external contribution providers |
| Verification method             | Objective facts plus public interpretation or review               |
| Policy version / XP reward      | Immutable authorization pinned when creating a claim               |
| Reward scope                    | Once-only, source or wallet/date boundary                          |
| Managed revision                | Source-derived identity for app-owned policy updates               |

[seedAppQuests](../services/api/src/mongo.ts) owns maintained definitions; [policyUsable](../services/api/src/claim-repository.ts) enforces date/freshness compatibility. External policies require a source review within 30 days. Maintained app policies use `sourceFreshness=maintained` and receive new versions when definitions change.

## Maintained quests

Progression/reward policy is **3**; individual quest versions increase separately. Migration seeds these evergreen application policies only when their configured evidence/adjudication prerequisites are usable.

| Slug / kind                                  | Required evidence                                                                                         | Reward                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `demo-first-mint` / `demo_mint`              | Successful canonical testnet receipt, configured collection/token, mint-to-claimant and current ownership | 50 XP once per wallet                                             |
| `verify-x-bio` / `bio_link`                  | Unique valid bio code, stable numeric X identity and stored verification proof                            | 50 XP once per wallet and bound identity                          |
| `ecosystem-contribution` / `public_evidence` | Substantive original Chog/Monad public X post or pinned GitHub README, with verified attribution          | 75 XP once per wallet per UTC finalization day; one-hour cooldown |
| `monad-mainnet-explorer` / `monad_activity`  | Successful outbound mainnet contract interaction with calldata, code and canonical receipt/block          | 25 XP once per wallet per UTC block date                          |

These are app-owned participation policies, not endorsed external campaigns. Source capture, identity linking and scanning do not directly award XP. All positive awards require a bound finalized GenLayer decision plus transactionally enforced allowance and current ownership.

Contribution sources are globally consumed at claim creation, across quests/profiles/wallets. A repository's new commit does not create another repository reward source. Further accepted contributions can have zero XP; `daily_cap`, `cooldown` and `ownership_changed` preserve adjudication separately from the actual amount.

## Substance and attribution

An X post author must match the verified stable account ID, not just a username. GitHub README capture must attribute the claimant wallet. Those facts do not automatically prove originality or substance.

The maintained rules reject forks, copied work, generic boilerplate, spam, unrelated contributions and unsupported marketing. User context cannot supply missing evidence or change the policy. Images are attached-source documentation only and are not semantically interpreted. Ambiguity yields review without XP.

A bio link establishes identity control; it does not prove likes, attendance, reposts or another activity. Generic onchain calls establish participation under the maintained rule, not a specific protocol's mission.

## Operator policy creation

`POST /v1/admin/quests` requires the admin key, actor label and `sourceReviewed:true`, and returns a newly recorded policy version. The attestation is an operator review, not an automatic external-source audit. Currently exposed administration accepts XP 1–75 and verification methods `public_evidence`, `manual` or `hybrid`; the capture implementation still needs a supported policy kind/evidence path.

Before activating a new campaign:

1. Read the authoritative announcement/contract and record exact source plus review time.
2. Establish dates, eligibility and a real observable completion signal.
3. Determine which facts can be verified deterministically and which require interpretation.
4. Specify bounded evidence capture, attribution, immutable snapshot and reward scope.
5. Confirm the existing implementation can capture that policy kind; UI copy alone does not add an adapter.
6. Version the policy and retain prior versions for submitted claims.
7. Pause future submissions when the source/rules become unreliable; plan pending-claim handling explicitly.

Manual review can reject with zero XP; it cannot accept and issue positive rewards. Re-running migration refreshes app-managed policies and availability, so treat that operation as configuration/policy maintenance rather than only index creation.

## Research history — 2026-10-18

The [Chogtober page](https://chog.zone/) and [Chog product site](https://www.chog.xyz/) were considered as sources. That review did not establish exact campaign dates, participant exports or verifiable per-mission completion. No third-party campaign was activated from those observations.

Recheck authoritative sources and their completion signals before creating a campaign policy. Historical research is not current source freshness or proof of participation.
