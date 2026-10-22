# Local setup

Use Node.js 24, npm 11+ and a transaction-capable MongoDB replica set or Atlas deployment. This guide starts the product without assuming access to the recorded deployment owner's signer.

[Configuration](configuration.md) · [Testing](testing.md) · [Deployment](deployment.md)

## 1. Install and configure

```sh
npm ci
cp .env.example .env
```

Review `.env` before migration:

- Use your own `MONGODB_URI` and `MONGODB_DATABASE`.
- Set `WEB_ORIGIN=http://localhost:3000`, `APP_ORIGIN=http://localhost:3000` and `PUBLIC_API_PATH=/api` for local work.
- Keep `NEXT_PUBLIC_API_BASE_URL=/api` for the unified web adapter.
- Leave server private keys empty for UI/source work. Clear `GENLAYER_CONTRACT_ADDRESS` before migration if you have no configured adjudication path, so maintained reward quests are inactive.
- Recorded public contract addresses identify existing deployments; they do not grant submission/owner authority.

## 2. Start a replica set

```sh
docker compose up -d --wait mongodb
```

The supplied [Compose file](../docker-compose.yml) initializes MongoDB 7 as `rs0` and uses a persistent named volume. Its example connection is `mongodb://127.0.0.1:27017/chog_evolution?replicaSet=rs0`. Check container health before migrating; a standalone MongoDB server cannot execute reward transactions.

For Atlas, supply your own URI, database and appropriate network access instead of running local MongoDB.

## 3. Migrate explicitly

```sh
npm run db:migrate
```

Root migration loads `.env`. In a separately configured shell, `npm run db:migrate --workspace=@chog/api` is equivalent. Schema 3 establishes capture/attempt/equipment/event/operational indexes and preserves historical evidence and XP. Cold starts do not run migrations.

Maintained quest availability depends on configuration at migration time. After changing evidence origin, source mode or adjudicator configuration, rerun migration deliberately to refresh managed availability/policies. Existing claim policies remain pinned.

## 4. Run and verify

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). Next mounts Fastify at `/api`; standalone Fastify also listens on port 4000. The root command loads `.env` for web, API and continuous worker.

```sh
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3000/api/ready
```

Readiness requires MongoDB plus the current schema marker. It does not establish live provider/consensus availability. Without a GenLayer signer, source/UI work remains available but real reward adjudication does not complete. Keep reward quests inactive for that environment.

## 5. Enable real adjudication separately

Use your own public HTTPS API origin and a funded signer that owns its configured adjudicator. Localhost is unreachable to external validators. `APP_ORIGIN` plus `PUBLIC_API_PATH`, or an explicit full `PUBLIC_API_URL`, must serve exact evidence snapshots. `WEB_ORIGIN` must match the browser origin used for CORS and challenges.

Do not copy a production key into local/test settings. The deployment scripts retain historical account/manifest guards; read [deployment.md](deployment.md) before treating them as reusable provisioning commands.

## Source and artwork behavior

X defaults to `X_SOURCE_MODE=public_page`; no OAuth/key is required. Optional explicit `api` mode consumes `X_API_BEARER_TOKEN`. GitHub public reads work without a token; `GITHUB_PUBLIC_READ_TOKEN` increases API limits. X posts require stable verified author identity; GitHub README evidence must attribute the wallet.

`GEMINI_API_KEY` enables optional reward artwork generation. Without it the deterministic renderer publishes images. Cosmetic jobs always use deterministic rendering. Configured Gemini failures preserve previous artwork and committed XP.

## Verification toolchain

For ordinary development:

```sh
npm run check
npm test
node scripts/verify-project-docs.mjs
```

Full release verification additionally requires Foundry and Python 3.11+:

```sh
forge build --root contracts
python3 -m venv /tmp/chog-genvm-tools
/tmp/chog-genvm-tools/bin/pip install genvm-linter==0.11.0
/tmp/chog-genvm-tools/bin/genvm-lint check genlayer/ClaimAdjudicator.py
```

The package is `genvm-linter`; the executable is `genvm-lint`. Ensure the executable is on PATH for `node scripts/verify-mvp.mjs`.

Persistence suites load ignored `.env.integration` with `MONGODB_TEST_URI`. They create marked random `chog_test_` databases and remove only their own data. Browser checks need a build and Chromium (`npx playwright install chromium` or `CHOG_CHROMIUM_EXECUTABLE`). See [testing.md](testing.md).

## Troubleshooting

| Symptom                     | Check                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| `schema_migration_required` | Correct database and explicit migration                                    |
| Transactions unavailable    | Replica-set primary / Atlas transaction support                            |
| Empty quests                | Adjudicator/evidence/source config at migration and policy freshness       |
| Ownership mismatch          | Configured chain/collection, selected wallet and actual `ownerOf`          |
| Source unavailable          | Provider reachability, exact source URL and verified account               |
| Pending mint                | Saved receipt hash and confirmation depth; do not mint again               |
| No positive XP              | Finalized bound decision, wallet allowance and current ownership           |
| No new artwork              | Existing job/provider quota, target version and previous valid publication |

For queued-work recovery use [operations.md](operations.md), preserving receipts and attempt references.
