# CHOG Evolution build handoff

Every screen must read as the same product if placed side by side.

Target: delegated nextjs-senior-engineer task `web_rebuild`. Implement exactly this spec and DESIGN.md. Use native accessible controls and the existing Next App Router. Do not introduce a second design system. React Bits registry access is being investigated; use actual registry components only when retrieved, and do not mislabel bespoke animations as React Bits.

## Routes and composition

- `/`: a long illustrated origin story. Persistent navigation, full-width oversized CHOG typography with overlapping supplied art, a short introduction and one mint CTA. Follow with a tilted text ribbon, a spacious asymmetric story spread, a scroll-revealed evolution trail (hatchling 0, curious 50, explorer 150, veteran 350, legend 700 XP), full-width supplied scene art, and a strong closing invitation. At least three layout families. Reference art is brand illustration, not fabricated live evolution history. Meaningful intro and scroll motion; no empty decorative dashboards.
- `/mint`: a large collectible preview, concise explanation, real Monad Testnet mint button, processing steps, sold-out/error/retry states. Button connects wallet, authenticates, asks wallet to switch networks, submits mint, waits for a receipt, and automatically creates profile/claim. Remember a pending transaction per wallet so refresh/retry never causes a second mint. Wallet confirmation remains explicit. No token ID or transaction-hash input.
- `/evolution`: real, finalized evolution history for the selected owned Chog, accessible chronological trail, XP and artwork from API, honest empty and loading states. Also explain stages without pretending illustrations are achieved outcomes. Link to public passport.
- `/quests`: real quest feed, category filters only when useful, distinct quest rows with XP, status and clear action. Mint and X quests use existing account data; contribution quests accept a URL and short context. Completion is read from finalized claims. No fake quest counts.
- `/activity`: wallet-specific mint, claim, scan and evolution events, understandable status and timestamps, expandable explanation/receipt link, reload/retry control and honest empty state.
- `/profile`: owned Chog selector, persistent art or deterministic demo art, XP/progress, level, traits, activity statistics, X link flow, discover owned Chogs button. X verification: username, copy provided code into bio, verify; keep provider setup problems friendly. No raw metadata fields.
- `/upgrade`: selected Chog, progress to next evolution, one "Check for an evolution" action scanning wallet activity on Monad MAINNET even when the NFT is a testnet demo. A second clear section lets the user submit an X post, GitHub repo or supported contribution URL plus context for GenLayer review. Show discovered activity, queued evaluations, review progress, accepted/rejected/error outcomes honestly. Never award XP just for clicking rescan.

Navigation: brand link, Story, Evolution, Quests, My Chog; primary Mint action. My Chog area includes Profile, Activity and Upgrade. Active route indicator, mobile menu with aria-expanded and Escape behavior, skip link. Share the shell with passport/admin without exposing admin in public navigation.

## Data and API contract

API base stays same-origin `/api` by default. Include credentials on authenticated calls. Do not display a raw API error. Existing auth `/v1/auth/nonce`, `/verify`, `/me`, `/logout` remain. Nonce body `{address,chainId}`, verify `{message,signature}`. Use an EIP-1193 provider, EIP-6963 discovery when feasible, and clear account-switch/logout state. Never auto-sign or automatically mint on connection alone.

Backend task will supply:

- `GET /v1/config` → `{demo:{chainId,collectionAddress,rpcUrl,explorerUrl},mainnet:{chainId,collectionAddress,rpcUrl,explorerUrl},features:{xLink,scans,evidence}}`. Public wallet RPC URLs only.
- `POST /v1/mints/prepare` (authenticated) → `{chainId,transaction:{to,data,value},supply:{minted,maxSupply}}`. Readiness and sold-out validated by server. UI sends this transaction from active wallet.
- `POST /v1/mints/confirm` body `{transactionHash}` → `{item:Profile,claim?:Claim,claimWarning?:string}`; server verifies mint, registers profile and queues mint quest. UI reads wallet receipt before confirm, stores pending transaction, retries confirm without another send.
- `GET /v1/metadata/demo/:tokenId` → standard ERC-721 metadata after a configured-chain existence check; no state changes. Demo contract base URI is configured once by its owner after deployment, outside the user flow.
- `POST /v1/profiles/discover` body `{mode?:"demo"|"original_companion",cursor?:string}` → `{items:Profile[],nextCursor?:string|null,partial?:boolean}`. Resolve ownership automatically, paginate scans if needed.
- Existing `GET /v1/profiles`, `/v1/quests`, `/v1/claims`, `/v1/passports/:id` retained. Claims gain `profileId`, `questName`; include real statuses/decision explanations.
- `POST /v1/claims` body `{profileId,questId,url?,text?}` (and idempotency-key); server resolves mint evidence from profile so users never paste hashes.
- `POST /v1/upgrades/evidence` body `{profileId,url,text?}` and idempotency-key → `{item:Claim,duplicate:boolean}`.
- `POST /v1/scans` body `{profileId}` → `{item:{id,status,events,claims?,errorCode?},claims?:Claim[],next?:string|null}`; mainnet scan and automatic evaluation submission. `GET /v1/scans/:id` retained.
- `GET /v1/activity` → `{items:[{id,type,title,status,createdAt,profileId?,xpAward?,description?,transactionUrl?}]}`.
- Existing X social GET/challenge/verify/DELETE remain.

If backend adjusts response shape, coordinate before implementation assumptions spread. Derive types from implementations where practical.

## State and component requirements

Shared wallet/data provider manages session, owned profiles, selected profile, quests, claims and loading errors; refresh in background while decisions are pending. Clear wallet-specific state on account change. Avoid an auth loop when session expires; preserve pending receipt/draft and offer sign-in. Use abort/cleanup for polling, bound retries and avoid stale writes after switching accounts.

Buttons: primary purple/black text; secondary bordered; busy label, disabled busy state, visible focus. Forms: visible labels, inline field errors, one URL + optional description, aria-live polite status, no nested forms. Screen loading retains layout; empty state explains the next action; errors have a retry button. Statuses are text plus color. History uses a semantic list. Progress has accessible name/value. Profile selector labeled and keyboard operable. Images have meaningful alt text except decorations. Keep animation wrappers from hiding links/contents before hydration. Mobile: stack compositions, shorten huge typography, no horizontal overflow; horizontal trails scroll within a named region.

## Design preflight

Spec reviewed: one identity, supplied imagery drives character; no fake stats, gradients, glass panels or repeated three-card features. Form groups contain at most two editable fields; one primary action per region. All requested states, wallet cancellation, pending refresh, account switch, unavailable providers and offline retry are specified. Manual implementation review must calculate contrast, inspect desktop/mobile screenshots and keyboard paths before acceptance. Initial design critique: distinctiveness 3, hierarchy 3, consistency 4, accessibility 3, state coverage 4, copy 3, restraint 3, motion motivation 3 (26/32). Revised generic split hero to oversized poster typography and creature overlap to tie the composition specifically to Chog.
