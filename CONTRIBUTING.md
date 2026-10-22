# Contributing to CHOG Evolution

Start with the [README](README.md), [protocol specification](docs/protocol.md) and [architecture](docs/architecture.md). Changes must preserve the documented authority boundaries and retry behavior.

## Development environment

Use Node 24, npm 11+ and the committed lockfile. Follow [local setup](docs/setup.md) with your own transaction-capable database. Use an isolated `MONGODB_TEST_URI` for persistence suites; production credentials and user sessions do not belong in tests.

```sh
npm ci
npm run check
npm test
node scripts/verify-project-docs.mjs
```

The full release check requires Foundry and the pinned GenVM linter. Browser acceptance additionally needs a production build and Chromium. See [testing.md](docs/testing.md) for commands and what each suite proves.

## Change review

| Change                      | Review and verification                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evidence / provider capture | Canonical source identity, stable attribution, bounded network/media handling, source-first recovery and negative cases                          |
| Reward / worker             | Finalized state and exact bindings, transaction/index uniqueness, concurrent wallets/profiles, ownership transfer and unknown-reference recovery |
| Equipment / artwork         | Earned slots, expected version, immutable event snapshot, duplicate jobs and late publication                                                    |
| Contract                    | Source/schema limits, owner powers, duplicate claim behavior, Foundry/GenVM checks and explicit deployment compatibility                         |
| API                         | Request/error shapes, auth, status codes, limits, pagination, idempotency and reference documentation                                            |
| Documentation               | Accurate implementation references, valid links, version distinctions and recorded-evidence qualifiers                                           |

Run the smallest meaningful relevant checks during development, then complete the release workflow’s required checks for a release. Do not replace a failing live-provider check with fixture success or silently relax an acceptance condition.

## Protocol rules that require deliberate migration

- Keep logical claim IDs separate from immutable attempt IDs.
- Preserve historical evidence, decisions, policy versions and earned-trait provenance.
- Never authorize XP from a pending GenLayer proposal or browser-supplied amount.
- Treat uniqueness indexes and wallet reward serialization as correctness constraints.
- Do not rebroadcast unknown submissions; reconcile finalized state.
- Keep image generation separate from reward authority.
- Preserve original collection metadata as read-only.

If policy semantics change, version the policy and explain pending-claim compatibility. Updating a deployed contract address alone does not migrate existing references. Use the [deployment guide](docs/deployment.md) and [operator runbook](docs/operations.md).

## Pull requests

Describe the concrete behavior change, relevant invariants, validation and any migration/recovery requirement. Update the API/protocol/configuration docs when their contract changes. Keep generated footage, build output, environment files and credentials out of commits. Use [private reporting](SECURITY.md) for security defects.

## Licensing and assets

The repository currently has no project-wide `LICENSE` file. `DemoChog.sol` carries an MIT SPDX identifier, dependencies have their own licenses, and supplied Chog reference assets have separately recorded provenance. Do not infer a repository-wide redistribution license from a source-file header. See [reference asset provenance](assets/chog-references/README.md) and the local font license before republishing assets.
