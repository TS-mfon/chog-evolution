# Provider integrations and live verification

This document separates code adapters from provider behavior that has actually been exercised.

| Provider       | Implemented path                                                                       | Configuration                                                                               | Evidence / current limit                                                                                                |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| EVM wallet     | Browser wallet discovery, connect, network display/switch, signed nonce authentication | Monad testnet public chain settings, API origin                                             | Source and unit/API tests exist; no real browser wallet journey run in this environment.                                |
| Monad testnet  | Viem reads and demo collection contract source                                         | `MONAD_TESTNET_RPC_URL`, `DEMO_COLLECTION_ADDRESS`; frontend public counterparts            | Contract is not deployed and address is blank. No real mint/receipt verified.                                           |
| Original Chog  | `ownerOf` checks for the configured mainnet ERC-721 and companion profiles             | Mainnet RPC and user-supplied `ORIGINAL_CHOG_COLLECTION_ADDRESS`                            | Address is documented as Chog Genesis; RPC ownership call not exercised here. Companion does not mutate token metadata. |
| X              | Public user lookup API verifies a temporary code in a profile bio                      | Server-only `X_API_BEARER_TOKEN`                                                            | This is not OAuth and does not retrieve posts/engagement. No bearer token is configured, so live lookup is unverified.  |
| GenLayer       | Pinned `genlayer-js` adapter submits adjudication and worker polls to finality         | `GENLAYER_NETWORK`, `GENLAYER_RPC_URL`, `GENLAYER_CONTRACT_ADDRESS`, `GENLAYER_PRIVATE_KEY` | Contract lints and adapter compiles; no deployed contract/signer, so live transaction/finality is unverified.           |
| Gemini         | Worker uses the supported `@google/genai` Interactions image-generation API            | `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`                                                      | Generation and validation code is implemented; a live request and configured key are still needed for provider proof.   |
| Object storage | MongoDB GridFS stores generated image and JSON metadata artifacts                      | `MONGODB_URI`, `MONGODB_DATABASE`                                                           | Durable artifact pipeline is implemented; live storage/readback requires the Mongo replica set to be reachable.         |
| MongoDB        | Wallet auth, profiles, claims, quests, bio links, scans, decisions, XP and worker jobs | `MONGODB_URI`, `MONGODB_DATABASE`                                                           | API and scheduled worker use Mongo repositories; live connection/transaction flow is not verified in this environment.  |

## GitHub Actions scheduled worker

`.github/workflows/evolution-worker.yml` runs a single bounded worker tick every five minutes and supports `workflow_dispatch`. It uses Mongo lease fields and workflow concurrency to avoid overlapping scheduled runs from this repository. The job does not apply migrations. Run migrations separately during deployment.

Configure these GitHub repository variables:

- `GENLAYER_NETWORK` — supported network key from the pinned SDK, such as `testnetBradbury` only if that is the intended deployed environment.
- `GENLAYER_RPC_URL` — approved RPC endpoint.
- `GENLAYER_CONTRACT_ADDRESS` — deployed adjudicator.
- `GEMINI_IMAGE_MODEL` — optional approved Google image model; defaults to `gemini-3.1-flash-image`.
- `MONGODB_DATABASE` — target database name.

Configure these GitHub Actions secrets:

- `MONGODB_URI` — TLS-enabled MongoDB Atlas connection URI with only required access.
- `GENLAYER_PRIVATE_KEY` — dedicated, funded service signer; never put it in a repository variable.
- `GEMINI_API_KEY` — server-side Gemini API key. Without it, accepted XP is preserved and image jobs enter manual review after a bounded attempt.

The scheduled workflow must be present on the repository's default branch. GitHub may delay scheduled runs under load. Check Actions run logs for missing-configuration failures. One tick claims at most one item; later runs continue queued work. Test manually with `workflow_dispatch` after adding the config. No successful scheduled run or provider operation is claimed until the Actions environment actually executes it.
