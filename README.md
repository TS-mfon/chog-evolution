# CHOG Evolution

CHOG Evolution turns verified participation in the Chog and Monad ecosystems into a persistent NFT evolution journey. The MVP supports a separately labelled demo collection on Monad testnet and companion profiles for verified original Chogs.

## Current state

The implementation includes signed wallet sessions, ownership-checked NFT profiles, MongoDB-backed quest/evidence/claim flows, X bio-code verification, a Monad log scanner, a finality-aware GenLayer worker, idempotent progression, and a Gemini-to-GridFS artwork pipeline. Those live paths require reachable MongoDB, X, Monad, GenLayer and Gemini providers plus deployed contracts and configured credentials. Provider connectivity and live user journeys have not been verified in this environment; see [docs/implementation-checklist.md](docs/implementation-checklist.md) for exact status.

## Requirements

- Node.js 22+
- npm 11+
- MongoDB Atlas or replica set
- Foundry for Solidity work
- Python 3.11+ for GenLayer contract tooling

## Start locally

1. Copy `.env.example` to `.env` and configure `MONGODB_URI` plus `MONGODB_DATABASE`.
2. Start a local replica set with `docker compose up -d mongodb`, or use MongoDB Atlas.
3. Run `npm install`.
4. In Bash, load the root environment with `set -a && . ./.env && set +a`.
5. Initialize indexes and seed quests with `npm run db:migrate --workspace=@chog/api`.
6. Set `ENABLE_LOCAL_DEMO_SCENARIOS=true` and `NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION=true` for the simulated walkthrough, then run `npm run dev` from the same shell.
7. Open http://localhost:3000. The API health endpoint is http://localhost:4000/health.

The demo mint requires a deployed demo collection and `NEXT_PUBLIC_DEMO_COLLECTION_ADDRESS`. The scenario walkthrough persists records but is explicitly simulated. Claim submission is available only for active, recently checked quest policies. XP is awarded only after the configured GenLayer transaction finalizes successfully and its decision matches the stored claim.

## Commands

- `npm run dev` — web, API, and continuous local worker in development mode.
- `npm run once --workspace=@chog/worker` — process at most one item and exit (used by the GitHub Actions cron workflow).
- `npm run build` — build all TypeScript workspaces.
- `npm run check` — type-check all TypeScript workspaces.
- `npm test` — run workspace tests.
- `npm run db:migrate --workspace=@chog/api` — initialize MongoDB indexes and starter quests.
- `docker compose up -d mongodb` — start local MongoDB replica set for transactions.

## Project structure

See [docs/architecture.md](docs/architecture.md) for subsystem boundaries, integration contracts, data flow, and milestone sequence.

See [docs/implementation-checklist.md](docs/implementation-checklist.md) for the itemized status against `build-plan.md`.

See [docs/setup.md](docs/setup.md), [docs/integrations.md](docs/integrations.md), and [docs/testing.md](docs/testing.md) for local operation, scheduled worker secrets, and verification limits.
