# CHOG MVP release evidence — 2026-10-21

Continuation of the approved plan from session `01a158a5-82b3-7893-b678-80b252ffd18d`. Existing Git history, NFT contracts, production project and locked seven-route design are preserved. The prior rebuild report is historical.

## Verification ledger

| Gate                               | Current evidence                                                                                                                                                                                                                                                       | Status         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Workspace regressions              | Workspace regression gates passed with zero failures.                                                                                                                                                                                                                  | Passed locally |
| Production build and types         | Production API/worker/Next build, seven workspace type checks, Solidity and GenVM checks passed.                                                                                                                                                                       | Passed locally |
| Anonymous sources/runtime/UI       | Parent-reverified leaf checks passed; source and runtime regressions plus UI type contracts.                                                                                                                                                                           | Passed locally |
| Fixture browser                    | Desktop/mobile source previews, safe retry, equipment, history and account isolation passed. Final production-build fixture rerun passed.                                                                                                                              | Passed locally |
| Real API browser                   | Actual Fastify HTTP, Mongo and GridFS: one claim, one 75 XP ledger entry, three history/artifact versions; API reconnect and account isolation; owned database cleanup verified. External RPC/source/adjudicator controlled.                                           | Passed locally |
| Mongo acceptance                   | Parent reverified all 27 cases across 33 application collections; owned database cleanup verified.                                                                                                                                                                     | Passed locally |
| GenLayer contract                  | GenVM lint (3 checks) and SDK validation passed; existing contract unchanged.                                                                                                                                                                                          | Passed locally |
| Reference provenance               | Five image hashes verified against repository commit `b1b273b58c37a09d96ff98de08a552df6623bd78`; manifest pinned with user authorization, no invented license.                                                                                                         | Passed locally |
| GitHub/CI                          | Implementation pushed as 87d6eb43241360d00ded3268aa1ce6494c9c6b36. CI 39537438093 stopped on incorrect pip package name; corrected to genvm-linter==0.11.0 and rerunning.                                                                                              | Pending        |
| Vercel                             | Existing project `prj_BXrwPrLCIeEWLNPm7qK05GrNNWmu` confirmed with Node 24; new production deployment pending.                                                                                                                                                         | Pending        |
| Live mint/GenLayer/XP/artwork      | Real production acceptance references pending; fixture results do not satisfy this gate.                                                                                                                                                                               | Pending        |
| Controlled X bio and source images | Anonymous lookup confirmed @Mfon_crypto (ID 1677064675798728707). User selected wallet 0x5905c9Dea6Ae52AA0947D8F7F218263889eDfC4E; public post 2112179691696144720 and its attached JPEG retrieved (1199×278, 21,805 bytes). Controlled bio/signature remains pending. | Pending        |
| Demo metadata URI                  | Read-only inspection and any needed owner configuration/readback pending.                                                                                                                                                                                              | Pending        |

## Release targets

- Repository: https://github.com/TS-mfon/chog-evolution
- Production: https://chog-evolution.vercel.app
- Demo Monad Testnet (10143): `0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce`
- Original Monad mainnet (143): `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`
- GenLayer StudioNet: `0x73Bd1106FFa722cf8e71A04f612ee868CDCd2396`
- Implementation commit: `87d6eb43241360d00ded3268aa1ce6494c9c6b36`
- Production deployment URL: pending
- First CI run (tool-install failure): https://github.com/TS-mfon/chog-evolution/actions/runs/39537438093; corrected release rerun pending
- Live claim/transaction/artifact references: pending

## Product contract

Anonymous X public pages are the default, without OAuth or an API key. Submitted image files are captured without content inference. Source snapshots/checkpoints and numbered attempts survive retry. Unavailable submissions reconcile safely; rejection is terminal. Contributions grant 75 XP once per wallet per UTC finalization day with a one-hour cooldown across midnight; later accepted claims grant zero. Mint/X-link once-only rewards and 25 XP mainnet/day are preserved.

Owners choose earned optional equipment; unlocks do not automatically equip. Cosmetic changes award no XP and create independent source events and immutable before/after artwork. Original NFT metadata remains read-only beside companion art. Explicit schema-3 migration, shared quotas, pagination, safe errors and bounded operational metrics are part of the release.

Arena, crafting, timeline ingestion, mainnet mint and `$CHOG` remain deferred. This record is not a claim of completed production acceptance while any required gate is pending.

## Live read preflight — 2026-10-21

Monad Testnet chain 10143 reports the configured demo collection as CHOG Evolution Demo / DCHOG with nextTokenId=1. Monad mainnet chain 143 reports the configured original collection as Chog Genesis / CHOG. Read-only token 1 ownerOf and IPFS tokenURI succeeded. These reads do not satisfy the required live mint-to-artwork acceptance.
