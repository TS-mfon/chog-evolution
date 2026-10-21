# CHOG Evolution

CHOG Evolution turns verified participation in the Chog and Monad ecosystems into a persistent NFT evolution journey. The MVP supports a separately labelled demo collection on Monad testnet and companion profiles for verified original Chogs.

## Current state

The application has separate story, mint, evolution, quest, activity, profile and upgrade pages in a purple-and-black Chog design. Minting connects the wallet, requests the correct network, waits for a real receipt and registers the NFT automatically. Wallet discovery, persistent signed sessions, verified X linking, public X/GitHub contribution reviews and recent Monad mainnet rescans feed a finality-aware GenLayer worker. Accepted XP, traits, evolution history and artwork are persisted in MongoDB.

Saved previews, numbered claim attempts and immutable source images survive retries. Owners can equip, replace or remove earned optional traits without XP changes. Contributions award 75 XP once per wallet per UTC finalization day, with a one-hour cooldown across midnight; later accepted contributions receive zero XP. Mint and X-link rewards remain once-only, and mainnet participation remains 25 XP per UTC block date.

See [docs/mvp-release.md](docs/mvp-release.md) for current verification and release evidence. Fixture tests, actual Mongo/API acceptance and live-provider acceptance are recorded separately.

## Requirements

- Node.js 24 and npm 11+
- MongoDB Atlas or replica set
- Foundry for Solidity work
- Python 3.11+ for GenLayer contract tooling

## Start locally

1. Copy `.env.example` to `.env` and configure `MONGODB_URI` plus `MONGODB_DATABASE`.
2. Start a local replica set with `docker compose up -d mongodb`, or use MongoDB Atlas.
3. Run `npm ci`.
4. Initialize indexes and seed quests with `npm run db:migrate`. For separately configured shells, `npm run db:migrate --workspace=@chog/api` also remains available.
5. Run `npm run dev`. The root command loads `.env` automatically.
6. Open http://localhost:3000. The same-origin API is at `/api`; its health endpoint is http://localhost:3000/api/health.

The demo mint is a real ERC-721 transaction on Monad Testnet. The deployed address is in `.env.example`; the server supplies runtime mint configuration. Testnet MON is required for the wallet's network fee. No user needs to paste a token ID or transaction hash. Claim submission requires an active policy, verified source data and current NFT ownership. XP is awarded only after a finalized GenLayer decision matches the stored claim. The public UI contains no simulated scenarios.

For GenLayer to review a claim, its immutable evidence URL must be publicly reachable over HTTPS. Local localhost development alone cannot receive an external GenLayer fetch; use a deployed API or your own HTTPS development origin when testing real adjudication.

## Commands

- `npm run dev` — web, API, and continuous local worker in development mode.
- `npm run once --workspace=@chog/worker` — process a bounded claim batch and one artwork job, then exit (used by the GitHub Actions cron workflow).
- `npm run build` — build all TypeScript workspaces.
- `npm run check` — type-check all TypeScript workspaces.
- `npm test` — run workspace tests.
- `npm run test:integration` — actual Mongo transactions, contention and recovery using `MONGODB_TEST_URI` from `.env.integration`.
- `npm run test:browser` — desktop/mobile navigation and mint recovery checks using explicit test fixtures, after a build.
- `npm run test:browser:persistence` — browser through actual Fastify HTTP, Mongo and GridFS with controlled external providers.
- `npm run test:browser:all` — both browser suites.
- `node scripts/verify-mvp.mjs` — production build, types, contracts, docs and reference content checks.
- `npm run mcp:react-bits` — start the shadcn MCP server in the web workspace; see [React Bits setup](docs/react-bits.md).
- `npm run db:migrate --workspace=@chog/api` — initialize MongoDB indexes and starter quests.
- `docker compose up -d mongodb` — start local MongoDB replica set for transactions.

## Project structure

See [docs/architecture.md](docs/architecture.md) for subsystem boundaries, integration contracts, data flow, and milestone sequence.

See [docs/implementation-checklist.md](docs/implementation-checklist.md) for the itemized status against `build-plan.md`.

See [docs/setup.md](docs/setup.md), [docs/integrations.md](docs/integrations.md), and [docs/testing.md](docs/testing.md) for local operation, scheduled worker secrets, and verification limits.

X bio verification and submitted posts use anonymous public pages by default (`X_SOURCE_MODE=public_page`). No OAuth or X API key is required. Attached images are captured without image-content analysis. Arena, crafting, broad social ingestion, mainnet mint and `$CHOG` remain outside this MVP.
