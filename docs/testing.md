# Testing and verification

Use Node 24 and the committed npm lockfile. Tests establish different kinds of evidence; fixture success must not be reported as live-provider success. [mvp-release.md](mvp-release.md) contains dated results, while [rebuild-release.md](rebuild-release.md) describes historical host constraints.

## Verification layers

| Command                                         | What it establishes                                                                                               | What it does not establish                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm test`                                      | API/provider/recovery/progression/renderer/worker behavior and local signature cryptography with explicit doubles | Actual production RPC/source/consensus availability          |
| `npm run check`                                 | Workspace TypeScript consistency                                                                                  | Runtime correctness or network finality                      |
| `npm run build`                                 | API/worker/web production output                                                                                  | Live acceptance                                              |
| `node scripts/verify-project-docs.mjs`          | Internal links, README coverage, maintained route inventory and source-backed config/policy/deployment references | Audit, all prose correctness or external links' availability |
| `node scripts/verify-mvp.mjs`                   | Production build/routes, types, Solidity, GenVM, docs and reference hashes                                        | Live wallet/source/image-provider success                    |
| `npm run test:integration`                      | Actual isolated Mongo transactions, indexes, contention, checkpoints, reward recovery and GridFS                  | Independent external providers; they remain controlled       |
| `npm run test:browser`                          | Responsive fixture UI journeys, refresh/retry/account isolation and screenshots                                   | Actual persistence/provider execution                        |
| `npm run test:browser:persistence`              | Browser through real Fastify HTTP/Mongo/GridFS with signed test identity                                          | Live RPC/source/GenLayer; those adapters are controlled      |
| `npm run test:browser:all`                      | Both browser layers after a build                                                                                 | Universal browser/device compatibility                       |
| `forge test --root contracts --offline`         | Targeted demo mint/metadata/supply tests                                                                          | Comprehensive ERC-721 security audit                         |
| `genvm-lint check genlayer/ClaimAdjudicator.py` | AST and SDK semantic checks                                                                                       | Actual validator consensus                                   |
| `npm run metadata:check`                        | Read-only current demo metadata configuration                                                                     | A new owner update or reward journey                         |

## Local behavior and documentation checks

```sh
npm ci
npm test
npm run check
node scripts/verify-project-docs.mjs
```

After a reward/evidence change, preserve negative cases: pending or wrong-bound decisions, replayed requests/sources, concurrent wallet allowance, ownership transfer, unknown broadcast references and stale image publication. Tests must assert outcomes rather than simply mirror implementation text.

## Full release check

Requires Foundry, Solidity 0.8.28, Python 3.11+ and the CLI installed from `genvm-linter==0.11.0`. Build the compiler artifact first on a clean host; `--offline` assumes the compiler is cached.

```sh
forge build --root contracts
node scripts/verify-mvp.mjs
```

The release script accepts no skip-check options. It runs the build/route oracle, workspace types, Foundry, GenVM, static contract guards, documentation checks and five reference-content pins. Put `genvm-lint` on PATH. See [setup.md](setup.md).

## Persistence acceptance

Supply an isolated transaction-capable `MONGODB_TEST_URI` in ignored `.env.integration`. Never select the application database as a test fixture.

```sh
npm run test:integration
```

Each runner creates a random `chog_test_` database with an ownership marker. Cleanup requires exact database/suite/run identity and is verified before success. Test environments strip production provider secrets/default application database. Real persistence includes transactions and GridFS; controlled external services remain distinct from live consensus.

## Browser acceptance

```sh
npm run build
npx playwright install chromium
npm run test:browser:all
```

An existing browser can be selected with `CHOG_CHROMIUM_EXECUTABLE`. Reports/screenshots are under ignored `artifacts/browser/` and `artifacts/browser-persistence/`. The latter records seeded/awarded XP, ledger/history/artifact counts and cleanup, using the actual HTTP app rather than canned application API responses.

Review desktop/mobile screenshots, keyboard behavior and reduced-motion states alongside assertions. Automated screenshots are not proof that every visual/accessibility requirement is satisfied on all devices.

## Production acceptance

A positive live journey should record the actual mint transaction/receipt, current owner, immutable claim/attempt, finalized bound GenLayer decision, one positive XP ledger entry, durable asset and refresh persistence. Check original metadata read-only behavior and relevant source providers separately. Optional Gemini requires a successful recorded publication with its own provenance.

`node --env-file=/absolute/path/to/operator.env scripts/verify-live.mjs` is **a real transaction tool** using `MONAD_OWNER_PRIVATE_KEY` (or its supported private-key fallback). It performs one production-UI testnet mint and journals the signed transaction/hash before broadcast under ignored owner-private `artifacts/live/`. Rerunning reconciles the same hash. It must only run under explicit authorization for that mint; it is not a read-only smoke check.

X linking still needs the user's chosen wallet/identity and genuine bio proof. A source preview is not adjudication success. Source, image or RPC unavailability remains recorded as unavailable, not replaced by fixture results.

## CI and evidence reporting

The application workflow runs tests/full verification plus an isolated Mongo replica set and both browser suites before production migration/deployment. Browser artifacts are uploaded. Source/contract/configuration changes still require the relevant live observations after deployment.

Report the tested commit, commands/layers, result and material limits. Keep source/reference IDs and nonsecret artifacts; exclude keys, sessions and signed transaction material from public evidence. Historical test totals are observations, not a number to carry forward as if rerun.

Legacy `verify-application-integration.mjs` and `verify-local-e2e.mjs` are narrower checks, not live end-to-end proof.
