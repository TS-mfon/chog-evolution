# Deployment and network records

The existing application is [chog-evolution.vercel.app](https://chog-evolution.vercel.app), backed by `TS-mfon/chog-evolution`. Use the existing repository history and manifests; deployment records are dated observations, not proof of present network availability.

[Setup](setup.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Release evidence](mvp-release.md)

## Recorded identities

| Network            | Chain ID | Role                          | Identity                                     |
| ------------------ | -------: | ----------------------------- | -------------------------------------------- |
| Monad Testnet      |    10143 | Demo ERC-721                  | `0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce` |
| Monad mainnet      |      143 | Original companion collection | `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763` |
| GenLayer StudioNet |    61999 | Claim adjudicator             | `0x73Bd1106FFa722cf8e71A04f612ee868CDCd2396` |

| Record                                                            | What it preserves                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [monad-testnet.json](../deployments/monad-testnet.json)           | Demo transaction, source digest, cap, name/symbol and owner verification     |
| [genlayer-studionet.json](../deployments/genlayer-studionet.json) | Source digest, SDK, deployment attempts, contract/schema and recorded status |
| [demo-metadata.json](../deployments/demo-metadata.json)           | Confirmed owner URI update and network reference                             |
| [mvp-release.md](mvp-release.md)                                  | Dated application deployment and actual mint/finality/XP/artwork journey     |

Verify RPC chain ID, deployed bytecode/schema and authority independently before using a signer. Original collection interactions remain read-only. The owner-gated adjudicator needs its deployment owner's funded key; an arbitrary EVM key is insufficient.

## Unified Vercel deployment

[vercel.json](../vercel.json) builds API before Next. The catch-all Node route lazily creates Fastify and forwards requests using `app.inject`, preserving same-origin cookies. Private database/provider connections initialize at runtime, not static page generation.

The [application workflow](../.github/workflows/deploy-vercel.yml) runs on pushes to `main` and `workflow_dispatch`:

1. Install Node 24, committed npm dependencies, Foundry and `genvm-linter==0.11.0`.
2. Run unit tests and full build/type/contract/docs/reference verification.
3. Start an isolated MongoDB replica set and run transaction/recovery acceptance.
4. Run fixture and actual API/Mongo browser acceptance; upload artifacts.
5. Apply production migrations with complete source/contract/origin configuration.
6. Link/configure the Vercel project, deploy production and smoke-test readiness plus usable quests.

Required deployment secrets are `VERCEL_TOKEN` and `MONGODB_URI`. Optional source/admin/artwork secrets are passed by the workflow. The GenLayer signer belongs in the worker environment, not the web client. Review [configuration.md](configuration.md) for all settings and public/private boundaries.

The workflow hardcodes the existing project, alias, database and network identities. A different staging/project deployment requires deliberately changing those settings; merely changing local `.env` does not retarget Actions. Its current migration-before-deployment ordering must be considered when assessing rollback compatibility.

## Standalone API and worker

Build the API image from the repository root:

```sh
docker build -f services/api/Dockerfile -t chog-evolution-api .
```

After an explicit migration, run it with an isolated reviewed production environment:

```sh
docker run --env-file .env.production -p 4000:4000 chog-evolution-api
```

The image's readiness healthcheck verifies `/ready`. Its process is only the HTTP API; it does not include a continuously running worker.

Build/run the worker with the complete server environment loaded:

```sh
npm run build --workspace=@chog/worker
node --env-file=.env.production services/evolution-worker/dist/index.js
```

For a separate API, configure the browser transport, CORS origin and full public API base consistently. The standalone listener does not enable trusted reverse-proxy handling automatically. See [architecture.md](architecture.md) for buffering and scaling limits.

## Migrations and release order

Migrations create correctness indexes, seed/version managed quest definitions and reconcile legacy data. They never run on request cold starts or every worker tick. API `/ready` requires schema 3.

For a deployment outside the existing workflow:

1. Record current revision, contracts, configuration and backup/restore point.
2. Test the candidate against an isolated transaction-capable database.
3. Inspect migration compatibility with the currently running API/worker and existing claims.
4. Stop/drain affected execution when an incompatible migration or contract change requires it.
5. Apply migration under the intended complete environment, then deploy API/web/worker.
6. Verify readiness, usable quests, queue progress and artifact access before declaring release acceptance.

A Git rollback does not reverse database migration or finalized network transactions. Do not restore old profile totals independently of ledger/evidence/history. [Recovery procedures](operations.md).

## Contract deployment boundaries

The recorded Node deployment scripts are historical deployment tooling. They read a private build-env path, are pinned to the recorded deployment account and refuse a successful/pending existing manifest. They must not be run as generic fresh-install commands or made reusable by deleting evidence.

For a new deployment, use an isolated, reviewed provisioning procedure and your own signer/network. The [Foundry script](../contracts/script/DeployDemoChog.s.sol) accepts `DEPLOY_PRIVATE_KEY`, `DEMO_MAX_SUPPLY` and `DEMO_BASE_URI`; omit broadcast until the target/configuration has been reviewed. Record source digest, actual transaction, chain, address, owner, supply and URI readback in a new manifest.

The GenLayer deployment script currently uses `leaderOnly: true` for deployment and waits for an accepted receipt plus schema verification. Its `finalized_deployment_verified` label is historical tooling terminology, not sufficient proof of claim finality. Reward adjudication uses validator consensus and the worker's `FINALIZED` plus `LATEST_FINAL` path. See [genlayer/README.md](../genlayer/README.md).

Changing an adjudicator address while old attempts are pending requires explicit compatibility/reconciliation planning. The current worker selects its contract from runtime configuration rather than automatically routing historical attempts across deployments.

## Demo metadata configuration

Read-only inspection:

```sh
npm run metadata:check
```

Explicit owner mutation, after reviewing the target and public endpoint:

```sh
npm run metadata:check -- --apply
```

`--apply` uses `MONAD_OWNER_PRIVATE_KEY` and the existing collection, journals the operation and verifies the resulting URI. Preserve the journal on timeout/unknown send. A prepared operation without a known hash must be reconciled against owner activity before another send. This changes the demo collection-wide base URI; it never modifies the original mainnet collection.

## Release acceptance

Process/schema readiness alone does not prove wallet, GenLayer or artwork availability. A live reward journey must preserve actual mint/receipt, bound finalized decision, exactly one committed positive ledger entry, durable artwork and refresh persistence. Source modes and optional Gemini need their own provider observations.

Use [testing.md](testing.md) for proof boundaries. Record unavailable/quota-blocked providers accurately. Historical deployment and rebuild notes must not be presented as fresh verification.
