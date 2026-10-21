# Provider integrations

Local behavior tests use explicit test doubles. They do not establish that a provider, database, wallet or deployed contract is reachable. Actual Mongo/API acceptance uses isolated storage with controlled external providers. Current evidence is in [mvp-release.md](mvp-release.md).

| Provider       | Implemented behavior                                                                                  | Configuration and limits                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| EVM wallet     | EIP-6963/EIP-1193 discovery, nonce sign-in, network switching, real mint request and refresh recovery | Browser wallet and testnet MON for network fees; receipts and NFT IDs are handled automatically                                      |
| Monad Testnet  | Collection/supply checks, receipt finality, mint event and current-owner verification                 | `MONAD_TESTNET_RPC_URL`, `DEMO_COLLECTION_ADDRESS`, `MONAD_FINALITY_BLOCKS`                                                          |
| Monad mainnet  | Original Chog discovery/ownership and recent successful outbound contract-call evidence               | `MONAD_MAINNET_RPC_URL`, `ORIGINAL_CHOG_COLLECTION_ADDRESS`; generic scans cover a bounded recent window                             |
| X              | Bio-code account verification and public post lookup; author must match verified X identity           | Anonymous `X_SOURCE_MODE=public_page` by default, no OAuth/key; optional explicit `api` mode or unavailable-source `disabled` state  |
| GitHub         | Public repository metadata, pinned commit and README with wallet attribution                          | Optional `GITHUB_PUBLIC_READ_TOKEN`; fixed API host, no redirects, bounded responses; forks/spam/nonrelevant work fail policy review |
| GenLayer       | Owner-signed adjudication, stored submission reference, finality polling and decision validation      | Stable StudioNet alias; `GENLAYER_NETWORK`, `GENLAYER_RPC_URL`, `GENLAYER_CONTRACT_ADDRESS`, `GENLAYER_PRIVATE_KEY`                  |
| Artwork        | Versioned trait-based PNG/JSON publication; optional Gemini generation                                | Built-in renderer without `GEMINI_API_KEY`; configured Gemini uses `GEMINI_IMAGE_MODEL` and retries failures                         |
| MongoDB/GridFS | Sessions, claims, evidence, decisions, XP, checkpoints, history and persistent artifacts              | `MONGODB_URI`, `MONGODB_DATABASE`; Atlas or replica set for transactions                                                             |

Public evidence URLs serve the exact content-hashed snapshot submitted to GenLayer; authentication messages and signatures stay private. `APP_ORIGIN` plus `PUBLIC_API_PATH=/api`, or an explicit `PUBLIC_API_URL`, must resolve to a publicly reachable HTTPS API for validators. User-written context is untrusted.

## Monad scans

The default scanner reads up to `SCAN_WALLET_BLOCKS_PER_REQUEST=32` finalized mainnet blocks per request, starting within `SCAN_WALLET_LOOKBACK_BLOCKS=256` blocks on its first run. Later requests continue from checkpoints. The response and UI report coverage and whether more remains. Transaction success, sender, destination code and finality are verified before review. The maintained general participation policy caps rewards at 25 XP once per wallet per UTC day, across all owned Chogs.

`MONAD_SCAN_TARGETS` optionally configures reviewed protocol event targets with contract, topic, indexed wallet position, start block and quest slug. Configured targets select event scanning instead of generic recent-transaction scanning. Matches follow the same GenLayer path; clicking rescan never awards XP. A standard RPC is not an indexed lifetime account history. See [quest-registry.md](quest-registry.md) for policy maintenance.

## Scheduled worker

`.github/workflows/evolution-worker.yml` runs every five minutes and supports `workflow_dispatch`. Workflow concurrency plus database leases coordinate work. Each bounded `--once` invocation processes the configured claim batch plus capture and artwork work. Pending consensus does not consume failure retries. Ambiguous submissions are held for explicit finalized-state reconciliation and are never blindly resent. Source-unavailable claims may recapture the same logical source into an immutable numbered attempt. Local `npm run dev` keeps the worker running continuously.

Configure GitHub Actions secrets:

- `MONGODB_URI`: the transaction-capable database.
- `GENLAYER_PRIVATE_KEY`: a funded signer matching the adjudicator owner.
- `GEMINI_API_KEY`: optional, enables the external artwork provider.

The workflow pins the existing StudioNet RPC/network/contract and public artifact path. Migrations run separately during deployment, never on every worker tick.

Finalized decisions must match claim ID, quest, policy version, wallet, NFT identity and evidence hash and stay within the XP cap. One MongoDB transaction adds XP to the latest persisted profile and records history and an immutable artwork snapshot. Each positive claim creates at most one XP entry and one artwork job. Accepted zero-XP claims create neither. Optional equipment changes use independent source events and deterministic jobs without any XP. Earned optional traits do not automatically equip. A late render cannot overwrite a later evolution.

## Historical evidence

Manifests record Monad and GenLayer contract verification on 2026-10-18. That session also recorded production Mongo migrations/readiness, the Vercel alias, and successful scheduled worker run `39138193699`. Those observations do not verify this rebuild. A current real mint-to-finalized-decision-to-artwork journey, X lookup and Gemini generation remain unverified.

## Sources, progression and operations

X account binding uses the stable numeric provider ID and survives username changes. Unlinking does not free that ID for another wallet. Only submitted public posts are read; timeline ingestion is outside this MVP. Exact source text is frozen before media uploads; image checkpoints survive interruptions. Captured JPEG/PNG/WebP files are bounded and decoded for file integrity without semantic/vision analysis. Original NFT token metadata uses bounded public URL retrieval with private-network defenses and remains separate from companion modifications.

Contributions grant 75 XP once per wallet per UTC finalization day, with a one-hour cooldown across midnight. Additional accepted contributions grant zero. Maintained mainnet participation remains 25 XP per UTC block date; mint and bio rewards remain once-only. Hourly bounded provider/job metrics exclude raw secrets and labels. Explicit schema-3 migration and `/ready` prevent serving an unmigrated database.
