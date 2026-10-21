# Product walkthrough

Use the deployed application with a real wallet and testnet MON. The public app has no simulated judge or developer walkthrough.

1. Read the illustrated story on `/` and choose **Mint a Chog**.
2. Confirm the sign-in, network switch and mint in the wallet. The application retrieves the receipt, finds the NFT, registers the profile and submits its first review. No token ID or transaction hash needs to be entered.
3. Visit `/profile` for owned Chogs, XP, level, traits and stats. Use **Find my Chogs** for an existing demo or original collection NFT. Connect an X profile by placing the supplied one-time code in its bio and verifying.
4. Visit `/quests` for maintained quest requirements and review progress.
5. On `/upgrade`, check recent Monad mainnet activity or submit an original X post/public GitHub repository with optional context. Preview the exact saved source and attached images, then submit that preview. X posts must belong to the linked account; GitHub's pinned README must contain wallet attribution.
6. Wait for the real GenLayer review. `/claims/:id` shows the public source, numbered attempts and timeline; `/activity` links to pending and final outcomes. A positive finalized award updates XP and `/evolution` history. Artwork arrives after the worker finishes rendering.
7. Equip or remove an earned accessory in `/profile`. Verify that XP is unchanged and the recorded before/after images appear in history. An original Chog keeps its source image beside separate companion art.
8. Refresh during an in-flight mint and confirm that the same transaction resumes. Re-submit saved evidence and verify that it does not earn duplicate XP.

Provider configuration and deployed demo metadata setup are in [deployment.md](deployment.md). The local Playwright tests use isolated fixtures solely for verification; they are not user-facing demonstrations or evidence of live chain success.

Daily contribution rewards are 75 XP once per wallet per UTC finalization day with a one-hour cooldown; additional accepted contributions grant zero. Use [mvp-release.md](mvp-release.md) for actual live references and outstanding gates.
