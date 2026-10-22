# Security policy

CHOG Evolution is an operator-managed MVP. No independent security audit is claimed. Its [security and trust model](docs/security.md) describes signer powers, offchain XP, public evidence and implementation limits.

## Report privately

Use the repository’s [GitHub private vulnerability reporting](https://github.com/TS-mfon/chog-evolution/security/advisories/new) if available to your account. If that feature is unavailable, contact the repository owner through an existing private channel and request a secure reporting route. Do not publish exploit details or credentials in a public issue.

Include the affected commit/component, prerequisites, impact and a minimal reproduction using test data. Omit private keys, session cookies, provider tokens and production database contents. Ordinary documentation and nonsecurity defects can use the normal repository issue workflow.

## Review scope

Report authentication/ownership bypasses, evidence substitution, replay or duplicate XP, unsafe network fetches, leaked secrets, unauthorized administration and stale artwork replacing current state. The current `main` implementation is the supported review target; no maintenance or response SLA is promised for historical deployments.

Operators should follow the [incident and recovery runbook](docs/operations.md). A security report is not authorization to use a production signer, modify another user’s NFT/profile or test an exploit against production.
