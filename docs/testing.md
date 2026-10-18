# Testing and verification record

## Commands

- `npm run check` — TypeScript checks across all workspaces.
- `npm test` — API route/flow, X profile lookup, scan, artwork validation/reference, art composition, and progression tests.
- `npm run build` — production TypeScript/Next builds across workspaces.
- Live MongoDB integration tests require a reachable transaction-capable replica set.
- `forge test --root contracts` — Foundry DemoChog tests.
- `node scripts/verify-genlayer.mjs` — static contract guard checks.
- `genvm-lint genlayer/ClaimAdjudicator.py` — GenVM contract lint, when the CLI is installed.
- `node scripts/verify-application-integration.mjs`, `node scripts/verify-local-e2e.mjs` — source/route integration assertions; these do not launch a browser or prove provider E2E.

## Latest recorded evidence (2026-10-18)

- `npm run check` passed across all workspaces.
- `npm test` passed across API, worker artwork validation/reference, art composition, and progression suites.
- `npm run build` passed, including optimized Next.js frontend and TypeScript API/worker builds.
- `node scripts/verify-project-docs.mjs`, `node scripts/verify-application-integration.mjs`, `node scripts/verify-local-e2e.mjs`, `node scripts/verify-genlayer.mjs`, and `genvm-lint genlayer/ClaimAdjudicator.py` passed. The application integration and local E2E scripts use explicit simulated/test fixtures and are not live provider journeys.
- MongoDB ping using the supplied URI failed; migrations, replica-set transactions, GridFS writes, and artifact readback could not be verified.
- Monad Testnet endpoint checks confirmed chain ID `10143` via dRPC, but subsequent DNS/socket failures prevented account balance/gas estimation. No Monad transaction was submitted. The Foundry deployment script compiles; the guarded deploy script records before sending and refuses duplicate attempts.
- GenLayer StudioNet (`chainId 61999`) accepted deployment transaction `0xe78797c0b016260027011617fa7866fdd45609a140670765457f5e485efdc163`, then finalized with `NO_MAJORITY`; no contract address was produced. The exact source hash and outcome are saved in `deployments/genlayer-studionet.json`. The SDK receipt endpoint was intermittently unreachable after finalization.
- Gemini live image generation failed with `APIConnectionError`; no image artifact was produced or stored.
- A credential-filtered publish copy was created and committed as `/tmp/chog-evolution-publish-20261018` (`21929e2`); it excludes `.env.build`, `mongodb.md`, and environment secrets. GitHub CLI's default config directory is read-only; a project-local `GH_CONFIG_DIR` is prepared, but GitHub login bootstrap cannot currently reach `github.com`. Vercel CLI 62.2.0 is now authenticated as `mfonante8-4360` in `.local-auth/vercel`. No frontend was deployed; the API has no deployed origin, so a frontend configured with localhost would not be a working deployment.
- Browser wallet E2E, X API lookup, live GenLayer finality, and end-to-end claim-to-artwork are unverified. Static checks do not prove these integrations.

## Required live test prerequisites

Start a transaction-capable MongoDB replica set and run `npm run db:migrate --workspace=@chog/api` before live database verification. Live acceptance additionally needs a testnet-funded wallet and deployed demo contract, supported deployed GenLayer contract plus signer, configured X API bearer token for bio lookup, a verified active quest and evidence source, and Gemini credentials and MongoDB GridFS storage. Browser E2E tooling is not currently configured in this repository.
