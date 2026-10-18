# Quest registry

Quests are data with versioned verification policies, not UI copy. A quest remains inactive until its source, dates, eligibility rules, evidence, completion signal, and verification method have been checked and recorded. No ecosystem event or participation record is seeded by this scaffold.

## Required registry fields

| Field                                          | Purpose                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `slug`, `name`, `description`                  | Stable identifier and user-facing explanation              |
| `status`                                       | `inactive`, `active`, or `paused`                          |
| `source_url`, `source_checked_at`              | Official announcement or authoritative contract reference  |
| `starts_at`, `ends_at`                         | Eligibility window and timezone-aware dates                |
| `eligibility_rules`                            | Who qualifies, expressed as reviewable rules               |
| `evidence_requirements`                        | Required transaction, URL, file, or reviewer evidence      |
| `completion_signal`                            | Observable fact that means the activity occurred           |
| `verification_method`                          | `onchain`, `public_evidence`, `manual`, or `hybrid`        |
| `policy_version`, `xp_reward`, `trait_unlocks` | Immutable reward authorization used by claims              |
| `automatic_verification`                       | Whether current evidence supports deterministic automation |

## Activation policy

1. Prefer official Chog and Monad project sources; record exact source and access date.
2. Determine the real completion signal. Do not infer attendance or social engagement from a wallet transaction that does not prove it.
3. Use deterministic chain checks for objective facts. Use public evidence or manual review when the source cannot be reliably queried.
4. Use GenLayer only for interpretation and require validators to inspect the underlying evidence under the stored rules.
5. Pause a quest when its source is unavailable or rules have changed. Keep historical policy versions for existing claims.

## Initial registry

The API seeds **Verify your X bio** as a versioned onboarding quest. The authenticated wallet creates a one-time code, places it in the claimed public profile bio, and the server resolves the username through X's User Lookup API and checks the returned description against the pending challenge. Evidence includes the stable provider user ID and the server-observed verification time. Clients cannot supply the evidence snapshot. The source is the [official X User Lookup documentation](https://docs.x.com/x-api/users/lookup/introduction), which documents username and ID lookup, requesting the public description field, bearer-token authentication, and the required developer account/app credentials. The source was reviewed on 2026-10-18. The quest awards 50 XP once per wallet, only after finalized GenLayer acceptance. Profile ownership proof does not establish any likes, follows, posts, views, or other engagement.

This quest depends on authorized X API lookup access. If the provider token is absent, the connection fails closed and the claim receives no evidence or XP. The source policy expires after 30 days without review.

## Research log — 2026-10-18

- **Chogtober Week** — The [official Chogtober page](https://chog.zone/) describes a week of daily Monad ecosystem missions, including Chog-focused missions. The page could not be fetched reliably during this review, and the accessible search result did not establish exact dates, per-mission completion records, or an authoritative export/API. Keep inactive; do not infer completion from a wallet or social post.
- **Chog product activity** — The [official Chog site](https://www.chog.xyz/) lists tools such as its PFP maker, NFT snapshot, swap, and meme maker. The site does not establish a dated quest or a completion signal suitable for awarding XP, so none is activated.

Recheck these sources and obtain the actual mission rules and participant completion signal before adding a policy version. The current quest API intentionally returns an empty list until an operator creates a reviewed version.
