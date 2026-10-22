# Provider integrations

Provider adapters supply bounded facts and external execution. They do not replace the [protocol's](protocol.md) identity, finality or transactional reward checks. Current dated observations are recorded in [mvp-release.md](mvp-release.md).

## Integration matrix

| Integration            | Implemented behavior                                                                        | Configuration                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| EVM wallet             | EIP-6963/EIP-1193 discovery, signed session, network switch, real mint and receipt recovery | Browser wallet and testnet MON                                         |
| Monad Testnet          | Collection/supply checks, successful mint, canonical receipt and owner verification         | `MONAD_TESTNET_RPC_URL`, `DEMO_COLLECTION_ADDRESS`, confirmation depth |
| Monad mainnet          | Original ownership/metadata and bounded outbound contract-call scan                         | Mainnet RPC, original collection and scan bounds                       |
| X                      | Bio code/stable identity and exact submitted public posts/photos                            | `X_SOURCE_MODE=public_page` by default; optional explicit API mode     |
| GitHub                 | Public repo metadata, pinned commit/README and wallet attribution                           | Optional `GITHUB_PUBLIC_READ_TOKEN`                                    |
| GenLayer               | Owner-signed submission, saved reference, `FINALIZED` polling and `LATEST_FINAL` read       | Network/RPC/contract and worker private key                            |
| Deterministic renderer | Trait/equipment-based PNG/JSON and preserved identity                                       | Checked-in composition/reference assets                                |
| Gemini                 | Optional rewarded-claim image generation                                                    | Worker `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`                          |
| MongoDB/GridFS         | Durable auth/proof, claims, rewards, leases, history and source/artwork assets              | Private URI, database and replica-set support                          |

## Wallet and RPC

Runtime `/v1/config` separates browser-safe public endpoints from server RPC credentials. The API validates chain ID before using ownership/receipt facts. The wallet confirms minting on Monad Testnet; it does not receive the worker or contract-owner key.

Mint recovery retains the transaction hash. Mainnet scans require successful canonical contract interactions; a generic call does not prove attendance, social engagement or a named third-party mission. Original token metadata stays read-only.

## X public capture

`X_SOURCE_MODE=public_page` uses anonymous pages without OAuth/API credentials. `api` requires `X_API_BEARER_TOKEN`; `disabled` explicitly marks source unavailability. Invalid mode values fail configuration rather than enabling simulation.

Bio verification binds stable numeric provider identity to the wallet, surviving username changes. Unlinking does not release identity for another wallet. The post parser checks exact post ID and stable author; timeline ingestion, likes/reposts and private activity are outside this MVP.

One same-host HTTPS redirect is permitted only for exact username-case correction on the same profile/post path. Other hosts, post IDs, login routes, query changes and redirect chains remain rejected. See [public-x.ts](../services/api/src/public-x.ts).

Source text persists before media. Only exact parsed attachments are captured under image type/byte/pixel bounds. Images are preserved as source attachments without semantic analysis. Page-format changes and rate limits can make capture unavailable; do not replace failures with invented sources.

## GitHub capture

Only supported public repository URLs are identifiers. Requests use the fixed GitHub API host, bounded bodies and no redirects. Capture pins the commit/README and checks claimant wallet attribution in that README. The source key consumes the repository globally rather than treating every commit as a new reward source.

A token increases public API limits; it does not authorize private repository evidence or make forks/copied work eligible. Substance/originality remain governed by the pinned policy. See [evidence-source.ts](../services/api/src/evidence-source.ts).

## Mainnet scanning

Default recent scans inspect at most `SCAN_WALLET_BLOCKS_PER_REQUEST=32` finalized blocks per request, beginning within an initial `SCAN_WALLET_LOOKBACK_BLOCKS=256` window. Later requests resume checkpoints. Coverage and `hasMore`/partial state are reported.

Configured `MONAD_SCAN_TARGETS` selects reviewed event scanning rather than generic transaction scanning. The target fields are `chainId,address,topic0,walletTopicIndex,startBlock,questSlug`; rules must correspond to a genuine completion signal. Matches follow the same immutable claim/GenLayer path.

RPC is not a lifetime address index. Increasing scan settings does not prove complete account history. Mainnet rewards are once per wallet per UTC block date, and scanning itself awards nothing. See [quest-registry.md](quest-registry.md).

## GenLayer

The pinned stable adapter preserves StudioNet-specific chain fields. Submission is owner-signed; the contract's owner cannot be replaced by an arbitrary worker key. The adapter records the actual transaction hash, polls finality and reads finalized stored decisions before strict binding.

Validators fetch the API's exact HTTPS snapshot and compare its digest. Original source capture remains a backend trust boundary. Missing/changed snapshots produce no positive reward. Unknown-reference recovery reads finalized state rather than rebroadcasting.

Supported SDK network names and key/configuration constraints are in [configuration.md](configuration.md). Changing a deployment with pending claims requires explicit compatibility planning.

## Artwork and storage

Reward artwork uses deterministic composition without a Gemini key. Configured Gemini consumes authoritative stage/equipment and continuity/reference images; it never chooses XP or traits. Equipment jobs always use deterministic rendering.

Generation failure preserves already committed reward/prior image and retries the existing job. Published provenance identifies the actual model, prompt version, reference revision/hashes and output hash. In the dated release record, successful published artwork used `chog-trait-renderer-v2`; Gemini generation remained quota-blocked. No later Gemini success is implied here.

Publication currently uses GridFS. `ASSET_STORAGE_*` entries are reserved, not an implemented object-storage integration. Original metadata fetch failures retain the last valid cached content with explicit status. [Architecture](architecture.md).

## Scheduled worker configuration

The [worker workflow](../.github/workflows/evolution-worker.yml) uses a five-minute schedule and `workflow_dispatch`, with `cancel-in-progress: false` and database leases. A tick performs bounded capture/claim batches plus one artwork job. Pending consensus does not consume provider-failure retries.

Required repository secrets: `MONGODB_URI`, `GENLAYER_PRIVATE_KEY`. Optional secrets: Gemini and public-provider tokens. Network/contract/origins are pinned in YAML; migration runs separately during deployment. Provider availability must be observed live, independently from fixture or isolated Mongo acceptance.
