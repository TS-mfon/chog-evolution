# CHOG rebuild release record — 2026-10-19

**Historical record.** The host restrictions and pending items below describe earlier sessions. The current continuation has working network, Git history, Mongo, local HTTP and Chromium. See [mvp-release.md](mvp-release.md) for current code and release evidence.

The recovered session was `01a14b3f-b065-7060-9898-1e67e2fe0b92`. This rebuild is implemented locally; publication and live acceptance remain blocked by the current host.

## Delivered locally

- Purple/black Chog visual identity, local font, illustrated story, intro/scroll motion and reduced-motion fallback.
- Separate story, mint, evolution, quests, activity, profile and upgrade routes, with real wallet/API state and readable loading/empty/error states.
- Mint preparation, wallet network switching, receipt recovery, automatic NFT registration and initial quest submission. No token-ID/hash inputs or public simulation panel.
- Owned-Chog discovery, XP/level/traits/stats, public evolution passports, verified X bio linking, and wallet activity history.
- Mainnet RPC rescans with coverage/checkpoints and once-daily wallet reward scope; X/GitHub contribution capture and GenLayer review.
- Stable StudioNet worker, strict decision binding, idempotent finalization, immutable artwork snapshots and version-safe publication. Optional Gemini plus the built-in real trait renderer.
- Public demo ERC-721 metadata and a read-only-by-default owner configuration command for the already-deployed collection.
- React Bits registry entry and Codex MCP configuration sample. Current motion is native; no remote React Bits component or MCP server was installed or used.

## Verification

| Check                                          | Result                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                     | Passed: 48 tests, zero failures (29 API, 13 worker/artwork, 3 art composition, 3 progression)                                                    |
| `npm run check`                                | Passed across all seven workspaces                                                                                                               |
| `node scripts/verify-rebuild.mjs --build-only` | Passed final production build and assertions for all seven requested prerendered routes, headings, landmarks, removed copy and accessibility CSS |
| `forge test --root contracts --offline`        | Passed: 3 contract tests, zero failures                                                                                                          |
| `genvm-lint genlayer/ClaimAdjudicator.py`      | Passed: 3 lint checks                                                                                                                            |
| `node scripts/verify-genlayer.mjs`             | Passed static contract guards                                                                                                                    |
| `node scripts/verify-project-docs.mjs`         | Passed documentation/configuration checks                                                                                                        |
| Dependency lock and workflow YAML              | Passed offline lock update, local dependency consistency and YAML parsing                                                                        |
| Metadata configuration CLI                     | Syntax and help checked; no owner transaction submitted                                                                                          |
| Contrast calculated from actual CSS            | Text at least 6.02:1; primary button 6.22:1; control boundaries at least 3.50:1                                                                  |
| Browser acceptance                             | Blocked before any page opened: Chromium IPC denied (`shutdown: Operation not permitted`)                                                        |
| Local HTTP smoke                               | Blocked: Next cannot bind `127.0.0.1:3017` (`listen EPERM`)                                                                                      |
| Live deployment/provider/MCP checks            | Blocked: external DNS returns `EAI_AGAIN`, Git/config locations are unavailable for writes                                                       |

The exact direct regression command finished with `REGRESSIONS VERIFIED`. Browser fixtures have not executed and no screenshots exist; `artifacts/browser/launch-failure.txt` records the failed launch. The deployment workflow now runs tests/build/types and Playwright checks before migrating or publishing.

Unlazy ledger audit: **3 met, 0 non-abandoned unmet, 7 abandoned/handoff gates** across ten gates. The seven are `GATES:N1`, `GATES:N2`, `GATES:N3`, `GATES:N5`, `leaf-1.1:G1`, `leaf-1.1:G2`, and `leaf-1.2:G1`. Besides browser/MCP handoffs, automatic gate collection is blocked because nested piped subprocesses produce no output under this sandbox (an independent spawn diagnostic reports `EPERM`). Direct command results above remain valid, but no automatic gate evidence was fabricated. Both exact leaf leases were released after root review and the native dispatch wave is complete.

## Required release handoff

1. Publish the workspace through a writable Git checkout and a network-enabled host. The current `.git` directory is empty/read-only; no commit, push or deployment was possible.
2. Run the committed browser acceptance checks and inspect their desktop/mobile screenshots, motion and keyboard behavior. Chromium here aborts on sandbox-denied IPC before opening a page, and the host also denies local HTTP listeners.
3. Configure/migrate the live Mongo replica set and verify an actual wallet mint, real GenLayer final decision, one XP award and artwork publication. X requires `X_API_BEARER_TOKEN`; public GitHub evidence optionally uses `GITHUB_PUBLIC_READ_TOKEN`.
4. After deploying the metadata endpoint, run `npm run metadata:check`, then `npm run metadata:check -- --apply` with the deployed demo collection owner's `MONAD_OWNER_PRIVATE_KEY`. The recorded contract URI is empty; no owner transaction was sent in this session.
5. Merge `config/codex-mcp.toml` into a writable Codex configuration, restart Codex, and install/use React Bits from the registered source. npm/reactbits.dev DNS and configuration writes were unavailable here.

Network/provider checks, browser rendering and MCP activation are unverified, not simulated or replaced by local test results. See [testing.md](testing.md), [deployment.md](deployment.md) and [react-bits.md](react-bits.md).

## GitHub push and Vercel redeployment retry

The user's explicit push and redeployment requests were retried on 2026-10-19. No commit, push or deployment was created.

- GitHub repository lookup for `TS-mfon/chog-evolution` failed with `error connecting to api.github.com`.
- Vercel CLI 62.2.0 found saved authentication, but `whoami` and `project inspect chog-evolution` failed with `fetch failed`. The project check disabled update checks and telemetry and used the existing local CLI configuration, eliminating the unrelated read-only cache error. Credentials could not be validated against Vercel.
- Direct DNS checks for `api.github.com`, `api.vercel.com` and `chog-evolution.vercel.app` all returned `EAI_AGAIN` (`Temporary failure in name resolution`).
- Managed worktree creation from `main` also failed with `fatal: not a git repository`; the workspace's empty, protected `.git` cannot supply repository history.

Publishing requires a host with network access and a writable checkout of the existing repository. Do not initialize unrelated history or force-push this workspace. Once available, copy the reviewed source into that checkout, exclude local credentials and generated files, commit and push to `main`, then monitor the existing production deployment workflow and verify the production alias.

## Session continuation — 2026-10-20

Recovered session `01a15247-2c07-7023-b230-c50dde913cdb` and its explicit requests to push to GitHub and redeploy to Vercel. The saved production build remains present. No application source changed and the earlier test results above were not rerun or represented as new verification.

Fresh release checks remain blocked:

- DNS lookups for `api.github.com`, `api.vercel.com`, and `chog-evolution.vercel.app` each returned `EAI_AGAIN`.
- `gh repo view TS-mfon/chog-evolution` failed with `error connecting to api.github.com`.
- Vercel CLI 62.2.0, using the saved project-local configuration with telemetry and update notifications disabled, failed to inspect `chog-evolution` with `fetch failed`.
- `.git` remains empty and read-only, and Git does not recognize the workspace as a repository.

No commit, push, upload, or deployment was made during this continuation. The remaining publication work requires network access and the existing repository history in a writable checkout.
