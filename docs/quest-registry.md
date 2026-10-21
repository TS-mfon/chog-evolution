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

## Maintained app quests — policy version 3

The migration seeds these versioned evergreen application policies. They activate only with a usable public evidence base and a configured GenLayer adjudicator; the mint quest also requires the demo collection and X linking requires enabled anonymous public-page access. These are app-owned participation policies, not claims of third-party campaign endorsement.

| Slug                     | Observable evidence                                                                              | Reward scope                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `demo-first-mint`        | Confirmed receipt, exact collection/token, mint-to-wallet event and current owner                | 50 XP once per wallet                                             |
| `verify-x-bio`           | Anonymous public X bio containing the unique pending code and stable numeric account identity    | 50 XP once per wallet/X identity                                  |
| `ecosystem-contribution` | Original, substantive Chog/Monad X post or pinned public GitHub README with verified attribution | 75 XP once per wallet per UTC finalization day; one-hour cooldown |
| `monad-mainnet-explorer` | Successful finalized outbound Monad mainnet contract interaction                                 | 25 XP once per wallet per UTC block date                          |

All awards require finalized GenLayer acceptance. Contribution source uniqueness applies globally across quests and profiles. After the daily award, further accepted contributions grant zero XP. The one-hour cooldown also applies across midnight. Mint and X-link remain once-only; linking an account alone is not an XP award. Source capture and scanning never directly award XP. Contributions must meet the stored substantive-content rules; a wallet address, marketing claim, copied repository or unsupported context is insufficient. Evidence snapshots are immutable and current NFT ownership is checked on submission.

App-maintained policies use `sourceFreshness=maintained` and receive new versions when rules change. External campaigns still expire after 30 days without recorded source review. Keep old policy versions for already-submitted claims. A bio link proves control of an account, not social engagement.

## Research log — 2026-10-18

- **Chogtober Week** — The [official Chogtober page](https://chog.zone/) describes a week of daily Monad ecosystem missions, including Chog-focused missions. The page could not be fetched reliably during this review, and the accessible search result did not establish exact dates, per-mission completion records, or an authoritative export/API. Keep inactive; do not infer completion from a wallet or social post.
- **Chog product activity** — The [official Chog site](https://www.chog.xyz/) lists tools such as its PFP maker, NFT snapshot, swap, and meme maker. The site does not establish a dated quest or a completion signal suitable for awarding XP, so none is activated.

Recheck these sources and obtain the actual mission rules and participant completion signal before adding a policy version. The API returns only active usable policies; the maintained app quests above do not activate any unverified third-party campaign.
