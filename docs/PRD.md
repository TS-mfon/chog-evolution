# Product requirements

## Product

CHOG Evolution gives users a persistent Chog identity that reflects verifiable participation in the Chog and Monad ecosystems. Users can start with a demo NFT on Monad testnet or register a companion profile for an authentic original Chog. Verified activity can grant XP and unlock controlled visual traits; every change remains explainable through evidence and history.

## Users and primary journey

The primary audience is Chog community members and hackathon judges. The judge must be able to complete the experience without owning an original Chog or spending mainnet funds.

1. Connect a wallet and mint a clearly labelled demo Chog, or verify ownership of an original collection token.
2. Browse a quest with a published source and explicit eligibility/evidence rules.
3. Submit evidence or rescan supported onchain activity.
4. Follow deterministic verification and, where interpretation is needed, a GenLayer decision through required finality.
5. Receive an idempotent progression award, preview the unlocked trait, and view the persisted evolution history.

## MVP requirements

- Separate demo collection and original collection modes; never imply demo tokens belong to the original 1,969-token collection.
- Demo ERC-721 on Monad testnet; original ownership verification on Monad mainnet, with companion profile state only.
- Quest discovery, evidence submission, status tracking, and incremental rescan foundations.
- GenLayer outcomes: accepted, rejected, needs_review, source_unavailable. No XP or artwork generation before an accepted finalized decision and policy validation.
- Server-authoritative XP, levels, stages, trait catalogue, claim deduplication, and evolution history.
- Controlled art composition based on five approved reference images. Gemini may render after authorization but cannot determine eligibility or rewards.
- Public Passport showing evidence-backed achievements and distinguishing onchain facts from reviewed public evidence.
- Clear loading, pending, rejection, source outage, and retryable failure states.

## Non-goals for MVP

- Modifying original Chog metadata without explicit authorization and contract support.
- Claims of automatic access to private social activity, likes, attendance, or views.
- Broad project coverage, token rewards, crafting, arena gameplay, or unsupported quests.
- Treating a demo fixture as a real transaction or real participation.

## MVP success criteria

A judge can mint a testnet demo NFT, submit supported evidence, inspect a real GenLayer decision and its finality, receive one progression award, see a trait-based artwork evolution, and inspect the versioned claim and evolution history. Duplicate or concurrent submissions produce at most one award. Rejected, pending, or unresolved decisions produce no award. Provider failures can be retried without losing the prior valid artwork.

## Product defaults

- Demo network: Monad testnet.
- Original Chog behavior: companion evolution profile.
- Verification: deterministic onchain checks first, supported public evidence, GenLayer for judgment, manual review for ambiguity.
- Art: approved trait composition first; Gemini as a server-side renderer after authorization.
- Sources, addresses, reference assets, and provider configuration are prerequisites and must not be guessed.
