# Configuration reference

Copy [.env.example](../.env.example) into an ignored environment file and supply values for your deployment. Root `npm run dev`, `npm run db:migrate` and `npm run metadata:check` load `.env`; individual workspace start/once commands expect an already loaded process environment.

This reference distinguishes browser-safe public settings, server secrets, runtime controls and legacy deployment fields. A configured variable does not prove provider availability or grant access to the recorded deployment owner.

## Application and database

| Variable                   | Consumer / default                   | Meaning                                                                            |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `NODE_ENV`                 | All processes; example `development` | Production enables Secure cookies and requires complete worker adjudication config |
| `WEB_ORIGIN`               | API; example `http://localhost:3000` | Browser origin for CORS and signed challenge; deployment fallback uses Vercel host |
| `APP_ORIGIN`               | Evidence/metadata; example localhost | Public application origin; deployed evidence requires HTTPS                        |
| `PUBLIC_API_PATH`          | API/worker; `/api`                   | API mount appended to the evidence origin                                          |
| `PUBLIC_API_URL`           | API/worker; empty                    | Explicit full evidence/artifact API base, overrides origin plus path               |
| `NEXT_PUBLIC_API_BASE_URL` | Browser; `/api`                      | Browser transport base; changing a public build value requires rebuilding web      |
| `API_PORT`                 | Standalone API; `4000`               | Listener port; `PORT` overrides it when supplied by the host                       |
| `MONGODB_URI`              | API/worker/migration; required       | Private transaction-capable MongoDB connection                                     |
| `MONGODB_DATABASE`         | API/worker; example `chog_evolution` | Database name; omitted value uses the URI/client default                           |
| `MONGODB_TEST_URI`         | Acceptance only                      | Isolated test server; runners create their own random marked database              |
| `QUEST_ADMIN_API_KEY`      | API; optional                        | Shared secret for policy/review and bounded metrics                                |

`PUBLIC_API_URL` is the complete API base: for unified hosting include `/api`. Do not append it twice. The API rejects credentials, query strings and fragments in public evidence bases and requires HTTPS in production. A localhost HTTP value can be valid development configuration while remaining unreachable to external validators.

## Monad chains and wallet configuration

| Variable                                       | Default / example               | Purpose                                                                    |
| ---------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `MONAD_TESTNET_CHAIN_ID`                       | `10143`                         | Expected server mint chain                                                 |
| `MONAD_TESTNET_RPC_URL`                        | `https://testnet-rpc.monad.xyz` | Server RPC; may contain private credentials                                |
| `DEMO_COLLECTION_ADDRESS`                      | Recorded demo manifest          | Server-authorized ERC-721 collection                                       |
| `NEXT_PUBLIC_MONAD_TESTNET_CHAIN_ID`           | Example `10143`                 | Public wallet configuration                                                |
| `NEXT_PUBLIC_MONAD_TESTNET_RPC_URL`            | Public testnet RPC              | Browser-safe RPC; never use a credential-bearing URL                       |
| `NEXT_PUBLIC_MONAD_TESTNET_EXPLORER_URL`       | `https://testnet.monadscan.com` | Public explorer                                                            |
| `NEXT_PUBLIC_DEMO_COLLECTION_ADDRESS`          | Recorded demo address           | Browser collection fallback/configuration                                  |
| `MONAD_OWNER_PRIVATE_KEY`                      | Empty; operator tooling only    | Existing demo owner for explicit metadata mutation or live mint acceptance |
| `MONAD_MAINNET_CHAIN_ID`                       | `143`                           | Expected original ownership/activity chain                                 |
| `MONAD_MAINNET_RPC_URL`                        | `https://rpc.monad.xyz`         | Server mainnet RPC                                                         |
| `ORIGINAL_CHOG_COLLECTION_ADDRESS`             | Recorded original address       | Allowed original collection for companions                                 |
| `NEXT_PUBLIC_MONAD_MAINNET_CHAIN_ID`           | Example `143`                   | Public mainnet wallet config                                               |
| `NEXT_PUBLIC_MONAD_MAINNET_RPC_URL`            | Public mainnet RPC              | Browser-safe mainnet endpoint                                              |
| `NEXT_PUBLIC_ORIGINAL_CHOG_COLLECTION_ADDRESS` | Recorded original address       | Browser collection fallback/configuration                                  |
| `ORIGINAL_COLLECTION_MAX_TOKEN_ID`             | `1969`                          | Inclusive fallback discovery bound if enumeration is unavailable           |
| `MONAD_FINALITY_BLOCKS`                        | `4`; allowed `1–100`            | Required confirmation depth for canonical receipt/scan evidence            |

Runtime `GET /v1/config` supplies normalized server-authorized chain/collection settings. Public RPC values reject credentials, query strings and fragments; server RPC URLs are not exposed. Unsupported or mismatched collections cannot be made eligible by changing a browser field.

## Scanning

| Variable                         | Default | Valid range / role                                                                                         |
| -------------------------------- | ------: | ---------------------------------------------------------------------------------------------------------- |
| `SCAN_WALLET_BLOCKS_PER_REQUEST` |      32 | Bounded recent transaction scan per request                                                                |
| `SCAN_WALLET_LOOKBACK_BLOCKS`    |     256 | Initial recent-window lookback; later requests resume checkpoints                                          |
| `SCAN_MAX_BLOCK_RANGE`           |  10,000 | Configured event range, `100–50,000`                                                                       |
| `SCAN_CHUNK_BLOCKS`              |     500 | Configured event chunk, `1–2,000`                                                                          |
| `MONAD_SCAN_TARGETS`             |    `[]` | JSON event targets; matching mainnet targets select event scanning instead of generic transaction scanning |

An event target includes `chainId`, `address`, `topic0`, `walletTopicIndex`, `startBlock` and `questSlug`. It must correspond to a reviewed policy and a real completion signal. See [integrations.md](integrations.md) and [scan-repository.ts](../services/api/src/scan-repository.ts) for validation. Increasing a window does not turn RPC scanning into lifetime indexed history.

## Sources

| Variable                   | Default       | Behavior                                                                           |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `X_SOURCE_MODE`            | `public_page` | Anonymous public profile/post capture; supported alternatives `api` and `disabled` |
| `X_API_BEARER_TOKEN`       | Empty         | Used only by explicit `api` source mode                                            |
| `GITHUB_PUBLIC_READ_TOKEN` | Empty         | Optional GitHub public-read rate-limit increase                                    |

No X OAuth or API key is required by default. Source page/API availability is still external. `disabled` is explicit unavailability, not a fixture mode. Stable account IDs and exact source attribution remain required regardless of provider mode.

## GenLayer and worker

| Variable                    | Default                                | Behavior                                                                                      |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GENLAYER_NETWORK`          | `studionet`                            | Worker supports `localnet`, `studionet`, `testnetAsimov`, `testnetBradbury` in the pinned SDK |
| `GENLAYER_RPC_URL`          | SDK chain endpoint; example Studio URL | Explicit server RPC override                                                                  |
| `GENLAYER_CONTRACT_ADDRESS` | Recorded manifest in example           | Adjudicator identity used by migration and worker                                             |
| `GENLAYER_PRIVATE_KEY`      | Empty; worker secret                   | Funded signer matching adjudicator deployment owner                                           |
| `WORKER_POLL_INTERVAL_MS`   | 5,000                                  | Continuous tick delay clamped to `1,000–60,000`                                               |
| `WORKER_LEASE_MS`           | 180,000                                | Claim lease with a 30,000 ms minimum; use a finite positive numeric value                     |
| `WORKER_BATCH_SIZE`         | 10                                     | Each capture/claim batch clamped to `1–25`; one artwork job per tick                          |

The production CLI rejects absent/malformed adjudication configuration. The existing GitHub workflow pins StudioNet/network/contract values in YAML and passes keys as repository secrets; changing local `.env` does not alter those workflow values. Capture/media and artwork have separate built-in lease durations; `WORKER_LEASE_MS` does not configure all queues.

## Artwork and reserved fields

| Variable                        | Status                             | Meaning                                                                               |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                | Optional worker secret             | Enables Gemini for rewarded claim artwork; absent key selects deterministic rendering |
| `GEMINI_IMAGE_MODEL`            | Consumed; `gemini-3.1-flash-image` | Configured image model; successful generation still depends on quota                  |
| `ASSET_STORAGE_ENDPOINT`        | Reserved, not consumed             | No implemented alternative S3 storage adapter                                         |
| `ASSET_STORAGE_BUCKET`          | Reserved, not consumed             | Publication currently uses GridFS                                                     |
| `ASSET_STORAGE_ACCESS_KEY`      | Reserved, not consumed             | Does not configure active publication                                                 |
| `ASSET_STORAGE_SECRET_KEY`      | Reserved, not consumed             | Does not configure active publication                                                 |
| `CHOG_REFERENCE_REPOSITORY_URL` | Descriptive example                | Reference provenance; renderer reads checked-in assets                                |
| `CHOG_REFERENCE_COMMIT`         | Descriptive example                | Renderer pins revision/hashes in source; env value does not override validation       |

Equipment artwork always uses deterministic composition. Configured Gemini failure retries the existing job and preserves committed XP/prior art; it does not silently claim a successful generated image.

## Tooling-only variables

- `CHOG_CHROMIUM_EXECUTABLE`: existing Chromium executable for browser acceptance.
- `DEPLOY_PRIVATE_KEY`, `DEMO_MAX_SUPPLY`, `DEMO_BASE_URI`: Foundry demo deployment script inputs, separate from application runtime.
- `ENV_BUILD_PATH`: legacy deployment scripts' private build-env file. Those scripts are pinned to the recorded deployment account and refuse existing successful manifests; they are not generic fresh-install commands.
- `RETRY_FINALIZED_FAILURE=1`: explicit legacy GenLayer deployment retry after a recorded failure, not permission to resend an uncertain submission.
- `VERCEL_TOKEN`: deployment workflow credential, never browser runtime.

For staging, use a separate database, HTTPS origin and owned adjudicator, then migrate with the complete staging configuration. See [setup.md](setup.md), [deployment.md](deployment.md) and [operations.md](operations.md).
