# Judge walkthrough

## Local orientation flow

1. Start MongoDB and the web/API/worker stack using `docs/deployment.md`.
2. Open Evolution Lab and select **Local simulated walkthrough**.
3. Submit an accepted, rejected, or pending sample. The interface keeps a persistent `SIMULATED` label and shows that no wallet, chain transaction, GenLayer decision, or ecosystem activity was verified.
4. Refresh or revisit the returned scenario URL to confirm state persists. Repeat the same idempotency key to verify no duplicate reward.
5. Try rejected/pending scenarios: neither awards XP nor changes the profile. The previous valid image remains visible.

## Real acceptance flow (after operator configuration)

1. Connect wallet and switch to Monad testnet.
2. Mint the separate demo ERC-721 and verify its collection address/token ID.
3. Submit a quest whose source, dates, eligibility, evidence, and completion signal are documented in the registry.
4. Inspect deterministic verification, GenLayer decision reference, and finality status.
5. On finalized acceptance, inspect XP ledger, approved trait delta, generated artwork, published metadata, and Passport history.
6. Resubmit the same evidence and confirm idempotent behavior.

Until deployment inputs exist, steps in the real flow are configuration prerequisites rather than claimed live features.
