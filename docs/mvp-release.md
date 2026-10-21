# CHOG MVP release evidence — 2026-10-21

Continuation of the approved plan from session `01a158a5-82b3-7893-b678-80b252ffd18d`. Existing Git history, NFT contracts, production project and locked seven-route design are preserved. The prior rebuild report is historical.

## Verification ledger

| Gate                               | Current evidence                                                                                                                                                                                                                                                                                       | Status                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Workspace regressions              | Workspace regression gates passed with zero failures.                                                                                                                                                                                                                                                  | Passed locally                |
| Production build and types         | Production API/worker/Next build, seven workspace type checks, Solidity and GenVM checks passed.                                                                                                                                                                                                       | Passed locally                |
| Anonymous sources/runtime/UI       | Parent-reverified leaf checks passed; source and runtime regressions plus UI type contracts.                                                                                                                                                                                                           | Passed locally                |
| Fixture browser                    | Desktop/mobile source previews, safe retry, equipment, history and account isolation passed. Final production-build fixture rerun passed.                                                                                                                                                              | Passed locally                |
| Real API browser                   | Actual Fastify HTTP, Mongo and GridFS: one claim, one 75 XP ledger entry, three history/artifact versions; API reconnect and account isolation; owned database cleanup verified. External RPC/source/adjudicator controlled.                                                                           | Passed locally                |
| Mongo acceptance                   | Parent reverified all 27 cases across 33 application collections; owned database cleanup verified.                                                                                                                                                                                                     | Passed locally                |
| GenLayer contract                  | GenVM lint (3 checks) and SDK validation passed; existing contract unchanged.                                                                                                                                                                                                                          | Passed locally                |
| Reference provenance               | Five image hashes verified against repository commit `b1b273b58c37a09d96ff98de08a552df6623bd78`; manifest pinned with user authorization, no invented license.                                                                                                                                         | Passed locally                |
| GitHub/CI                          | Release CI39537710053 attempt2 passed; corrected source/Gemini follow-up c19c555 passed CI39546264835, including unit/types/build, 27 persistence cases and both browser journeys.                                                                           | Passed live |
| Vercel                             | Production alias serves schema 3. Verified deployment: https://chog-evolution-65aryx7yo-gen-daves-projects.vercel.app. Source/Gemini request fix c19c555 deployed by CI39546264835; production smoke passed.                                                                                                                                                  | Passed live |
| Live mint/GenLayer/XP/artwork      | User wallet minted demo token 1. Independent finality/readback: accepted GenLayer decision, exactly one 50 XP ledger entry, Curious level 2, published artwork version 1. Public PNG hash and desktop/mobile passport refresh verified at 2026-10-21T04:45:33Z.                                        | Passed live                   |
| Controlled X bio and source images | @Mfon_crypto stable ID 1677064675798728707 bound to chosen wallet at 2026-10-21T04:18:46Z. Stored public bio proof hashes match; challenge consumed. Original supplied image post retrieved. New post 2112752750228357333 recovered into saved preview with four decoded images and preserved context. | Passed live                   |
| Demo metadata URI                  | Owner transaction configured the existing collection. tokenURI(1), metadata JSON and published image URL agree on production.                                                                                                                                                                          | Passed live                   |

## Release targets

- Repository: https://github.com/TS-mfon/chog-evolution
- Production: https://chog-evolution.vercel.app
- Demo Monad Testnet (10143): `0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce`
- Original Monad mainnet (143): `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`
- GenLayer StudioNet: `0x73Bd1106FFa722cf8e71A04f612ee868CDCd2396`
- Implementation commit: `87d6eb43241360d00ded3268aa1ce6494c9c6b36`
- Production deployment URL: https://chog-evolution-65aryx7yo-gen-daves-projects.vercel.app
- Release CI: https://github.com/TS-mfon/chog-evolution/actions/runs/39537710053 (attempt 2 passed)
- Mint transaction: `0x6b8dc4d60e40942206289fee49c44db2370dbcd4af0e3f3e7c2ab7e164b286bf`
- Claim: `8fc7778f-1692-4f41-b751-2811661be5cc`
- GenLayer finalized reference: `0x70207349ee047207a9bd32e001576f49463758dcecf3c978f798baef56aad13a`
- Profile: `1549a11b-e86b-469b-9a97-fccb9e26d0a9`
- Artwork artifact: `e0e6ee7d-3693-41a8-9083-d6858ee0752f`
- Public artwork: https://chog-evolution.vercel.app/api/v1/artifacts/6ad836cf31ad86f35e6e79a3
- PNG: 1024×1024, 165,455 bytes, SHA-256 `baa4167193925575f4f55d297d06052a92ae1495ec4dbe1d201a3bdb7287b5a7`
- Metadata transaction: `0x58ad01e63631961029f4327b60cb1c1383049e15cc7628c6daf2b10ed666b916`; confirmed journal `deployments/demo-metadata.json`

## Product contract

Anonymous X public pages are the default, without OAuth or an API key. Submitted image files are captured without content inference. Source snapshots/checkpoints and numbered attempts survive retry. Unavailable submissions reconcile safely; rejection is terminal. Contributions grant 75 XP once per wallet per UTC finalization day with a one-hour cooldown across midnight; later accepted claims grant zero. Mint/X-link once-only rewards and 25 XP mainnet/day are preserved.

Owners choose earned optional equipment; unlocks do not automatically equip. Cosmetic changes award no XP and create independent source events and immutable before/after artwork. Original NFT metadata remains read-only beside companion art. Explicit schema-3 migration, shared quotas, pagination, safe errors and bounded operational metrics are part of the release.

Arena, crafting, timeline ingestion, mainnet mint and `$CHOG` remain deferred. This record is not a claim of completed production acceptance while any required gate is pending.

## Live read preflight — 2026-10-21

Monad Testnet chain 10143 reports the configured demo collection as CHOG Evolution Demo / DCHOG with nextTokenId=1. Monad mainnet chain 143 reports the configured original collection as Chog Genesis / CHOG. Read-only token 1 ownerOf and IPFS tokenURI succeeded. These reads do not satisfy the required live mint-to-artwork acceptance.

## Live limitations and source recovery

The published image provenance is `chog-trait-renderer-v2`, not Gemini. It was generated from the authoritative finalized traits and durably stored in GridFS. Gemini provider retries preserved reward and existing artwork. The replacement key authenticates and lists the configured image model, but generation returns 429 RESOURCE_EXHAUSTED on free-tier request/input quotas, with a reported retry delay of 8110 seconds. No successful Gemini image generation or publication is claimed.

Original mainnet collection name, ownerOf(1), and IPFS tokenURI were read without writes. Bounded IPFS metadata retrieval remains unavailable; the companion view records this truthfully.

The contribution error came from lowercasing an X username: X returned 307 to its exact casing. Public reads now permit one case-only redirect on the same HTTPS x.com profile/post path. Other hosts, credentials, ports, login routes, post IDs, queries and redirect chains remain rejected. Exact parsed post and stable author checks remain mandatory. The user's saved preview `64d77eb7-7d18-4f18-82a1-cc1c0683b7dd` recovered to ready with four captured images. Preview readiness is not GenLayer approval; the user still submits for review.

Demo production plan: [demo-video.md](demo-video.md), 150 seconds of actual screen recordings, brief motion design and generated storyteller narration. No final rendered video is claimed yet.

Follow-up deployment: https://github.com/TS-mfon/chog-evolution/actions/runs/39546264835 completed successfully on c19c555015f9769bc4ac89d025b1c2a86cdc2268. Production /api/ready returned HTTP200, schema3, MongoDB available after deployment. 131 unit tests and seven type checks passed locally; CI also passed persistent and browser acceptance. The source correction is live. Gemini image quota remains the only newly added live-provider gate without success.
