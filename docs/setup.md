# Local setup

Use Node.js 24, npm 11 and a MongoDB replica set (Atlas or MongoDB 7+). Foundry and `genvm-lint==0.11.0` are needed for the full contract verification gate.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`; configure `MONGODB_URI` and `MONGODB_DATABASE`.
3. For a local replica set, run `docker compose up -d mongodb`.
4. Run `npm run db:migrate`. The root command loads `.env`; a configured shell may use `npm run db:migrate --workspace=@chog/api`.
5. Run `npm run dev` and open http://localhost:3000. Root `.env` is loaded for the web, standalone API and continuous worker. The web uses its same-origin `/api` adapter.

Migrations are explicit and repeatable. Schema version 3 adds capture checkpoints, claim attempts, equipment, source events and operational indexes while preserving historical evidence and XP. `/api/ready` requires Mongo connectivity and the current schema marker. Cold starts never run migrations.

The demo collection and GenLayer adjudicator addresses refer to existing deployments. Minting requires real wallet confirmation and testnet MON. `GENLAYER_PRIVATE_KEY` must be the funded owner of the adjudicator. Validators require a public HTTPS evidence URL: configure `APP_ORIGIN` with `/api` or an explicit `PUBLIC_API_URL`. `WEB_ORIGIN` must match the browser origin for CORS and signed challenges.

X uses anonymous public pages with `X_SOURCE_MODE=public_page`. No OAuth or API key is required. `X_API_BEARER_TOKEN` is used only by optional explicit `api` mode. GitHub evidence works without a token; `GITHUB_PUBLIC_READ_TOKEN` increases its rate limit. A submitted GitHub README must attribute the wallet. An X post must belong to the verified stable X account ID. Images are captured without image-content analysis.

`GEMINI_API_KEY` enables optional generation for rewarded claims. Without it the deterministic renderer publishes trait artwork. Cosmetic changes always use that renderer. Configured provider failures preserve prior published art and schedule recovery.

For persistent acceptance, create ignored `.env.integration` with `MONGODB_TEST_URI` for a transaction-capable test server. Runners create unique `chog_test_` databases, verify ownership markers and clean up only their own database. They never select the application database. Run `npm run test:integration` and, after building and installing Chromium with `npx playwright install chromium`, `npm run test:browser:all`. Select an existing Chromium with `CHOG_CHROMIUM_EXECUTABLE` if needed.

Run `npm test`, `node scripts/verify-mvp.mjs` and the acceptance suites before release. See [testing.md](testing.md) and [deployment.md](deployment.md).
