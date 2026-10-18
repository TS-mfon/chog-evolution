# Local setup and deployment

## Local development

1. Install Node.js 22+ and npm 11+.
2. Copy `.env.example` to `.env`, configure `MONGODB_URI` and `MONGODB_DATABASE`, and use TLS and a least-privilege Atlas database user.
3. Use an Atlas deployment or MongoDB replica set; standalone MongoDB cannot execute the app's multi-document transaction workflows.
4. Run `npm install`; in Bash load the root file with `set -a && . ./.env && set +a`.
5. Initialize MongoDB indexes and starter quest data with `npm run db:migrate --workspace=@chog/api`.
6. To expose the local walkthrough, set server `ENABLE_LOCAL_DEMO_SCENARIOS=true` and web `NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION=true` in that shell. Both are development-only. It creates persisted simulated records, not blockchain transactions.
7. Run `npm run dev` from the same shell, then open `http://localhost:3000`; API default is `http://localhost:4000`.

Run `npm run check`, `npm run build`, and `npm test` before publishing. The Mongo migration command verifies connectivity, creates the indexes, and upserts versioned starter quests; it is safe to rerun.

## Testnet judge deployment

### API container

- Build from the repository root with `docker build -f services/api/Dockerfile -t chog-evolution-api .`.
- Run as a persistent container/service with `MONGODB_URI`, `MONGODB_DATABASE`, `WEB_ORIGIN`, `APP_ORIGIN`, `MONAD_TESTNET_RPC_URL`, and provider variables configured server-side.
- Set `APP_ORIGIN` to the public HTTPS API origin (the worker publishes evidence URLs there); set `WEB_ORIGIN` to the deployed Vercel site.
- The container health check uses `/ready`, which verifies MongoDB reachability. Run `npm run db:migrate --workspace=@chog/api` once against the same database before traffic.

### Vercel frontend

- Import the GitHub repository into Vercel with the project root `apps/web`; use the repository root for package installation/monorepo detection.
- Set `NEXT_PUBLIC_API_BASE_URL` to the deployed API's HTTPS origin and the public Monad chain/collection variables for the demo.
- Do not deploy the frontend with the local default API origin; wallet, quest, profile and claim flows would target the visitor's localhost.
- Vercel CLI is authenticated in `.local-auth/vercel`; pass `--global-config "$PWD/.local-auth/vercel"` to use that session because the system-wide config location is unavailable here. The frontend is not deployed because there is no deployed API origin; publishing it against localhost would leave the primary workflows unusable.

- Monad Testnet is chain ID `10143`; the official public endpoint is `https://testnet-rpc.monad.xyz`. The live deployment is `0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce`, transaction `0xe5d40c17743d7e19f6e7e0290386ee2519fe6eec929eef92f8cdca40daaf3218`, block `72084803`. The successful receipt and deployed code were verified, then `name`, `symbol`, `maxSupply`, and `owner` were read back. The frontend and `.env.example` point at this address. `node scripts/deploy-monad-testnet.mjs` refuses duplicate deployment; use its manifest and deployed address rather than resubmitting. It reads `PRIVATE_KEY` from `/home/sudodave/.env.build` into process memory; do not copy that file into the repository or pass the key on a command line.
- The GenLayer source is pinned to StudioNet (`chainId 61999`, `https://studio.genlayer.com/api`). `node scripts/deploy-genlayer.mjs` records the source hash and transaction before polling finality; a valid release requires a successful `Finalized` result and a verified contract address. The recorded attempt finalized with `NO_MAJORITY` and created no contract. The current environment could not submit a retry because Node's RPC lookup failed with `EAI_AGAIN studio.genlayer.com`; the GenLayer CLI receipt command could not decrypt its existing keystore. No GenLayer deployment is claimed.
- Configure database and the GitHub Actions scheduled worker using [integrations.md](integrations.md). The workflow runs one bounded worker tick every five minutes and can be manually dispatched; run database initialization separately. Configure Gemini and GridFS using the server-side secrets. The five checked-in reference images are hash-pinned locally, but their upstream commit/license provenance remains to be confirmed before public production use.
- For X bio linking, configure a server-side `X_API_BEARER_TOKEN` with access to X's public user lookup API. This feature verifies only control of the profile bio, not activity or engagement.
- To enable ecosystem rescans, populate `MONAD_SCAN_TARGETS` only with reviewed, chain-specific contract addresses, event topics, indexed wallet positions, and start blocks. The example is empty; matches remain candidate records and never directly award XP.
- Run a smoke claim with a documented real quest and inspect evidence, GenLayer transaction ID/finality, artwork, metadata, and Passport history.
- Keep the clearly labelled local simulation available for judge orientation, but do not use it as a substitute for the real path in acceptance claims.

### Original collection identity

Configured mainnet collection: `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`. The supplied address resolves to **Chog Genesis**, and the marketplace item page identifies the collection token as an ERC-721 on Monad ([OpenSea item](https://opensea.io/item/monad/0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763/946)). A MonadScan transaction page independently shows ERC-721 transfer/mint events emitted by the same contract ([MonadScan transaction](https://monadscan.com/tx/0x730195964d4ec7cfba5b460cad486b5c35356d0edabc3b88506c4547c64bc6d9)). Use it only for mainnet ownership checks and companion profiles; original NFT metadata is never written by this application.

## Production blockers

The user supplied the original collection address, and marketplace/explorer records identify it as the Chog Genesis ERC-721 on Monad. The configured address is for ownership checks and companion profiles only; no permission to mutate original metadata is implied. Five local visual references are in `assets/chog-references/` and their SHA-256 hashes are recorded in that folder's README. Their upstream repository/commit provenance is still unavailable. The Monad demo contract is live and verified. GenLayer StudioNet contract deployment remains blocked pending a successful final decision and verified contract address.
