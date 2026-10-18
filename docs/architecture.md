# Architecture and implementation plan

## Architecture decision

The original `build-plan.md` specified PostgreSQL. The user later explicitly directed the project to MongoDB; application runtime, worker persistence, setup, and deployment follow that instruction. Mongo transactions require MongoDB Atlas or a replica set.

## System boundaries

| System                        | Authoritative responsibility                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Monad                         | NFT ownership, demo ERC-721 state, transactions, logs                                                         |
| GenLayer Intelligent Contract | Evidence adjudication outcome and permitted evolution spec                                                    |
| API/backend                   | Wallet sessions, quest policy, deterministic checks, XP ledger, authorization, workflow state                 |
| MongoDB replica set           | Claims, evidence references, decisions, checkpoints, jobs, profiles, audit/history                            |
| Worker                        | Finality reconciliation, bounded retries and job processing; invoked on a five-minute GitHub Actions schedule |
| Gemini                        | Image generation only                                                                                         |
| Object storage                | Durable image and metadata assets                                                                             |
| Web app                       | User experience and presentation; never authoritative for rewards                                             |

The backend submits a bounded evidence packet to GenLayer and tracks the real decision lifecycle. It validates the finalized result against the stored quest policy, then commits XP and queues an evolution job. After final acceptance, the scheduled worker can generate a trait-driven image with the server-side Gemini SDK, validate it, save image and JSON metadata to MongoDB GridFS, then atomically publish the artifact URL while retaining the previous valid URL on failures.

## Repository map

```text
apps/web/                   Next.js UI
services/api/               Fastify API
services/evolution-worker/  Durable workflow worker
packages/shared-types/      API/domain types
packages/evolution-rules/   Authoritative progression policy
packages/art-composition/   Deterministic original SVG demo art and trait catalogue
packages/validation/        Shared input validators
contracts/                  Demo ERC-721 (Foundry)
genlayer/                   Intelligent Contract and adapter notes
services/api/src/mongo.ts   MongoDB collections, indexes, and quest seed
assets/chog-references/     Supplied local visual references; upstream pin pending
docs/                       Product, architecture, registry, operations
```

## Data flow

1. Wallet signs a short-lived nonce; API verifies signature and creates a wallet-bound session.
2. API validates NFT identity against configured chain and collection. Demo identity is always collection-scoped; original identity creates a companion profile.
3. Claim references a quest policy version and normalized evidence. Backend applies deterministic checks and dedupe constraints.
4. If policy needs judgment, adapter submits the evidence packet to GenLayer and records transaction/request references. A reconciliation worker waits for documented finality.
5. API validates the final decision, allowed XP and trait changes against the stored policy version. One database transaction records the ledger entry, profile version, history, and one unique evolution job.
6. The worker currently polls/reconciles one claim per tick. `.github/workflows/evolution-worker.yml` runs the bounded one-shot command every five minutes, with manual dispatch and workflow concurrency; it does not run migrations. Planned art publication will compose/request artwork, validate dimensions and format, store the image then metadata, and mark a version ready. That publication pipeline is not implemented.

## API surface

- `GET /health`, `GET /v1/quests`
- `POST /v1/auth/nonce`, `POST /v1/auth/verify`, `GET /v1/auth/me`, `POST /v1/auth/logout`
- `GET /v1/profiles`, `POST /v1/profiles/register`, `GET /v1/passports/:id`
- `GET /v1/social/x`, `POST /v1/social/x/challenge`, `POST /v1/social/x/verify`
- `POST /v1/scans`, `GET /v1/scans/:id`
- `GET /v1/claims`, `POST /v1/claims`, `GET /v1/claims/:id`
- `POST /v1/admin/quests`, `GET /v1/admin/claims/review`, `POST /v1/admin/claims/:id/review`

Implemented today: signed wallet sessions; ownership-checked profiles; Mongo-persisted claims, policies, social verification, scan checkpoints, decisions, progression, and worker jobs; bio-code X account binding; Monad evidence verification; finality-aware GenLayer calls; Gemini image generation and GridFS artifact publication. These integrations compile but external provider workflows remain unverified in this environment. Public X activity ingestion and full browser E2E remain unimplemented; scan matches remain candidate-only.

## Data model and invariants

Core entities: wallets/sessions, NFT profiles, quests and immutable policy versions, claims, evidence, adjudication decisions, XP ledger, evolution jobs, artifacts, evolution history, scan jobs/checkpoints, and audit events. Use UUIDs for application records and chain-scoped NFT keys. Store source URL, capture time, and content hash for evidence.

- Unique claim key prevents replay for a wallet/profile, quest, and normalized evidence identity.
- One finalized accepted claim can create at most one XP ledger entry and one evolution job.
- Profile updates use version checks and a transaction; history is append-only.
- Transfers do not change the token's identity or history. Current ownership is rechecked before privileged actions; original companion profiles remain tied to token identity.
- Preserve original metadata and the last valid generated artifact.

## Implementation status

The application has Mongo-backed API and cron-worker implementations, bio-code identity verification, claim adjudication, progression, and a Gemini/GridFS artwork path. Live provider access, contract deployment, production API hosting, and complete browser verification still require deployment environment configuration and successful external connections.

## Milestones

1. Foundation and provider spike: pin five approved image references, confirm network/provider access, deploy a minimal test contract and GenLayer adjudicator.
2. Wallet and evidence: signed nonce auth, quest policy storage, claim idempotency, deterministic verification, GenLayer lifecycle/finality.
3. Evolution: XP ledger, trait validation, renderer/storage adapter, versioned publication, retries and reconciliation.
4. Judge UX: mint, claim progress, before/after, evidence and decision references, Passport.
5. Original Chog and ecosystem integrations: confirmed collection ownership, first real verified quest, incremental scans, operational hardening.

## Operational and security controls

Use environment secrets server-side; reject SSRF/private-network evidence fetches; allowlist known source hosts; rate-limit scans and claims; authenticate worker operations; store structured request and job IDs; never expose provider secrets or stack traces. Verify current official chain settings and SDK lifecycle details before deployment.
