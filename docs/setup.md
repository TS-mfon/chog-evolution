# Local setup

## Requirements

- Node.js 22 or later and npm 11 or later
- MongoDB 7+ (or MongoDB Atlas replica set) for application and worker persistence
- Foundry only for Solidity tests/deployment
- Python and GenLayer CLI only for contract lint/deployment

## Start the application

1. Copy `.env.example` to `.env`; keep secrets out of source control.
2. Start the local replica set with `docker compose up -d mongodb` or configure an Atlas URI; set `MONGODB_URI` and `MONGODB_DATABASE`.
3. Install locked dependencies using `npm ci`.
4. Load variables in the shell (`set -a; . ./.env; set +a`) and initialize MongoDB indexes and starter quests with `npm run db:migrate --workspace=@chog/api`.
5. Run `npm run dev`; visit `http://localhost:3000` and API health at `http://localhost:4000/health`.
6. Without a deployed demo collection the wallet mint control is unavailable. Local simulated records can be enabled with both `ENABLE_LOCAL_DEMO_SCENARIOS=true` and `NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION=true`; these are visibly simulated and are not evidence of live provider behavior.

## Useful commands

```sh
npm run check
npm test
npm run build
npm run db:migrate --workspace=@chog/api
docker compose up -d mongodb
forge test --root contracts
node scripts/verify-genlayer.mjs
node scripts/verify-project-docs.mjs
```

The MongoDB database must support transactions (Atlas or a replica set) because linked-account, claim, and reward writes are atomic. Contract deployment, GenLayer integration, X profile lookup, and Gemini generation require credentials and deployed configuration; see [integrations.md](integrations.md) and [testing.md](testing.md).
