# CHOG Evolution documentation

This documentation describes the implementation in this repository. Contract deployments and live acceptance are dated observations; the protocol specification describes current behavior and trust boundaries. The original product plan and historical release notes are retained for traceability.

## Start here

| You want to…                                    | Read                                    |
| ----------------------------------------------- | --------------------------------------- |
| Understand the product, networks and scope      | [Project overview](../README.md)        |
| Review rewards, evidence, states and invariants | [Protocol specification](protocol.md)   |
| Assess operator authority and residual risks    | [Security and trust model](security.md) |
| Understand subsystem boundaries and persistence | [Architecture](architecture.md)         |
| Build a local environment                       | [Local setup](setup.md)                 |
| Configure the API, worker and providers         | [Configuration](configuration.md)       |
| Integrate a client                              | [HTTP API reference](API.md)            |
| Review or maintain quest policies               | [Quest registry](quest-registry.md)     |
| Deploy and verify identities                    | [Deployment](deployment.md)             |
| Run the service and recover failed work         | [Operator runbook](operations.md)       |
| Troubleshoot a provider                         | [Integrations](integrations.md)         |
| Reproduce acceptance checks                     | [Testing](testing.md)                   |

## Contract references

- [DemoChog on Monad Testnet](../contracts/README.md): mint semantics, owner powers, metadata and Foundry verification.
- [ClaimAdjudicator on GenLayer](../genlayer/README.md): arguments, digest verification, validator agreement and finalized reads.
- [Monad deployment manifest](../deployments/monad-testnet.json), [GenLayer manifest](../deployments/genlayer-studionet.json) and [metadata configuration record](../deployments/demo-metadata.json).
- [Progression rules](../packages/evolution-rules/src/index.ts) and [maintained quest definitions](../services/api/src/mongo.ts) are the implementation sources for policy values.

## Evidence and history

| Document                                                                   | How to interpret it                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [MVP release record](mvp-release.md)                                       | Dated verification, real production journey and provider limitations                 |
| [Implementation checklist](implementation-checklist.md)                    | Requirement-to-implementation ledger; not a security audit                           |
| [Rebuild release record](rebuild-release.md)                               | Historical host restrictions and continuation; not a current runbook                 |
| [Product requirements](PRD.md) and [original build plan](../build-plan.md) | Product intent; current implementation is described in the protocol and architecture |
| [Judge walkthrough](judge-demo.md)                                         | A short route through the product and verifiable references                          |
| [Demo production plan](demo-video.md)                                      | Recording/narration and truthfulness requirements                                    |
| [React Bits setup](react-bits.md)                                          | Optional contributor tooling, separate from runtime requirements                     |

## Conventions

- API reference paths use standalone Fastify routes such as `/v1/claims`. Add `/api` for the unified deployment.
- `finalized` means GenLayer consensus read from finalized state. An accepted proposal or successful HTTP response is insufficient for XP.
- `accepted` describes adjudication; `xpAward` is the amount committed after reward and ownership checks.
- “Immutable” means application-enforced preservation of a revision or published artifact. A privileged database administrator still controls storage.
- Progression policy, quest policy, evidence schema, trait catalogue, profile version and database schema are distinct version domains.
- Code, deployment manifests and the committed lockfile take precedence over historical release descriptions.

Run `node scripts/verify-project-docs.mjs` after documentation changes. It checks internal links and source-backed contracts; it does not certify narrative correctness, external availability or an audited protocol.
