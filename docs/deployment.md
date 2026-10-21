# Deployment

The existing production alias is `https://chog-evolution.vercel.app`, backed by the private `TS-mfon/chog-evolution` repository. The MVP continuation reuses this project and repository history. See [mvp-release.md](mvp-release.md) for current verification, commit, deployment and live acceptance references; earlier deployments are historical observations.

## Local development

Follow [setup.md](setup.md). Root `npm run dev` and `npm run db:migrate` load `.env`. Next serves its API at `/api`; standalone Fastify listens on port 4000. MongoDB must support transactions. No public simulation mode is required or exposed.

## Unified Vercel application

`vercel.json` builds the API before Next. The catch-all route lazily creates Fastify and forwards requests through `app.inject`, preserving same-origin cookies. Database and provider connections are initialized at runtime, not during static page generation.

`.github/workflows/deploy-vercel.yml` uses Node 24, installs the lockfile, verifies build/types/contracts, runs isolated Mongo acceptance and both browser suites, then applies migrations, configures production environment variables, deploys, and checks readiness and seeded quests. Required deployment secrets are `VERCEL_TOKEN` and `MONGODB_URI`. Runtime configuration includes:

- `APP_ORIGIN` and `WEB_ORIGIN`: the public HTTPS site origin.
- `PUBLIC_API_PATH=/api`. Use `PUBLIC_API_URL` only for a separate public API base; an empty value uses the app origin.
- `MONGODB_DATABASE=chog_evolution` and the server-only MongoDB URI.
- Monad RPC URLs and collection addresses from `.env.example`.
- `GENLAYER_CONTRACT_ADDRESS` during both migration and runtime, so maintained review policies can be enabled.
- `X_SOURCE_MODE=public_page` for anonymous X lookup without OAuth or a key. The optional `api` mode uses `X_API_BEARER_TOKEN`; `disabled` is an explicit unavailable-source release state. Optional `GITHUB_PUBLIC_READ_TOKEN` increases repository API limits.
- `QUEST_ADMIN_API_KEY` for operational metrics and reviewed policy administration.

The GenLayer signer belongs in the worker environment, never the browser. Optional Gemini settings are in [integrations.md](integrations.md).

Run `npm run db:migrate` with the complete production configuration before serving the new API. Migrations create indexes, update maintained policy versions, and reconcile legacy reward scopes while retaining accepted XP and history. In a preconfigured shell, `npm run db:migrate --workspace=@chog/api` is equivalent.

## Standalone API

Build with `docker build -f services/api/Dockerfile -t chog-evolution-api .`. Set `PUBLIC_API_URL=https://api.example.com` (including any actual public prefix), `WEB_ORIGIN` to the browser origin, and `NEXT_PUBLIC_API_BASE_URL` to the API base before building the frontend. `/ready` verifies MongoDB connectivity and schema version 3. A separate origin requires compatible secure cookies and CORS; same-origin hosting avoids third-party cookie restrictions.

## Existing contracts

| Network                         | Contract                                                      | Deployment record                                                 |
| ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Monad Testnet, chain 10143      | DemoChog `0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce`         | [monad-testnet.json](../deployments/monad-testnet.json)           |
| GenLayer StudioNet, chain 61999 | ClaimAdjudicator `0x73Bd1106FFa722cf8e71A04f612ee868CDCd2396` | [genlayer-studionet.json](../deployments/genlayer-studionet.json) |
| Monad mainnet, chain 143        | Original Chog `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`    | User-supplied collection; companion ownership checks only         |

Deployment manifests record successful receipt/code or schema checks from 2026-10-18. Reuse these contracts; this rebuild does not require redeployment. The worker uses stable `genlayer-js@1.1.8`, preserves StudioNet configuration, and waits for Finalized consensus before reading the bound decision. Its signer must own the deployed adjudicator. Original NFT metadata is never modified.

## Demo NFT metadata

The original demo deployment recorded an empty base URI. The new public `/api/v1/metadata/demo/:tokenId` endpoint returns ERC-721 metadata after verifying minted existence; initial artwork is deterministic and finalized evolutions use persisted state and artwork.

After deploying, run `npm run metadata:check` to inspect the current URI. To configure the existing contract, set its owner's `MONAD_OWNER_PRIVATE_KEY` in a server environment and run `npm run metadata:check -- --apply`. This command validates chain, collection, owner and deployed metadata, then journals its transaction so retries do not blindly send again. Do not redeploy the NFT contract. Current owner-transaction evidence is recorded in [mvp-release.md](mvp-release.md).

## Release acceptance

1. Run workspace tests, type checks, production build and browser acceptance from [testing.md](testing.md).
2. Migrate the transaction-capable database with complete production configuration.
3. Deploy and check `/api/ready`, `/api/v1/config`, `/api/v1/quests` and all seven pages.
4. Use a real wallet with testnet MON to mint once. Refresh during confirmation and verify that it resumes the same transaction and shows the Chog.
5. Submit a qualifying mainnet interaction or verified X/GitHub evidence. Inspect its immutable evidence URL, worker submission reference, finalized GenLayer decision, one XP entry, profile update, evolution history and artwork.
6. Verify actual X lookup, desktop/mobile motion and keyboard navigation.

Local network and browser checks are available. Real-provider acceptance remains a separate gate from fixtures and isolated Mongo tests. Record failures explicitly; do not claim a source works based on controlled responses. Preserve the existing Git history and use a normal push; do not initialize unrelated history or force-push.

The CI test database is a disposable local replica set and never uses the production URI. Production migrations run only after tests and use the configured application database. Operational provider/job summaries are available through authenticated `GET /api/v1/admin/metrics`. Workers carry explicit chain/collection configuration so finalization rechecks ownership on the correct network.
