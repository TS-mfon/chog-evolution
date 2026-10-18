We are building Chogins

 Build CHOG Evolution — Chogathon MVP  You are the lead full-stack engineer, smart-contract engineer, and technical architect for CHOG Evolution, a Chogathon 2026 project.  ## Product objective  Build a complete, functional platform where a Chog NFT evolves in response to verifiable ecosystem participation. The application must demonstrate a real utility loop: discover activity, submit evidence, validate the claim using the appropriate verification layer, award progression, update the NFT's evolution state, and display a persistent before-and-after history.  Do not build a static mockup. Implement a working end-to-end experience.  ## Mandatory product modes  1. Demo Chog: deploy a separate NFT collection that we control. Users and judges must be able to mint and evolve demo NFTs without owning an original Chog. 2. Original Chog: verify authentic ownership against the confirmed Chog Genesis collection on Monad. Support a companion evolution profile unless the original contract explicitly permits an authorized metadata update.  Never misrepresent demo NFTs as members of the original 1,969-token collection. Never imply that the original NFT's metadata changed if only the companion profile changed.  ## Visual references  Use the five actual Chog NFT references in the supplied public GitHub repository. Inspect the images before implementing the art pipeline. Preserve the recognizable Chog silhouette and visual language. Do not substitute generic frogs or unrelated characters. Keep the demo artwork clearly distinguished from official collection artwork.  Do not invent a repository URL, contract address, ABI, or official integration permission. If any is missing, isolate it in configuration and document the required input.  ## Required features  - Responsive Home / Evolution Lab - Wallet connection and Monad network handling - Demo NFT minting - Original Chog collection detection - Quest Board - Ecosystem Rescan - Evidence submission and status tracking - GenLayer Intelligent Contract for evidence adjudication - XP, levels, evolution stages, and trait unlocking - Deterministic art composition from an approved trait catalogue - Evolution history and public Chog Passport - PostgreSQL-backed quest, claim, evidence, scan, and evolution records - Monad RPC indexing with checkpoints, caching, retries, and idempotency - X profile linking via a temporary public bio verification code - A maintained event registry with source URLs, dates, rules, and verification methods - A clearly labelled judge demo scenario - Useful loading, error, pending, rejected, and source-unavailable states  ## Technical constraints  - Use a clean TypeScript-based frontend and a maintainable backend. - Use an EVM-compatible library for Monad reads and contract interactions. - Use the public Monad RPC initially; make the endpoint configurable for a future private RPC provider. - Confirm Monad mainnet chain ID and current endpoint settings before deployment. - Use Solidity and a standard ERC-721 implementation for the demo collection. - Use GenLayer's current supported SDK and deployment environment for the adjudicator. - Do not trust frontend-supplied XP, eligibility, ownership, or verification status. - Do not award a claim before its required verification and adjudication conditions are satisfied. - Do not use a social scraper as a guaranteed source of likes, attendance, or private activity. - Store secrets only in environment variables. - Keep original collection metadata and demo collection metadata separate. - Make all rewards idempotent and prevent duplicate claims. - Preserve prior valid NFT artwork if image generation or metadata publication fails.  ## GenLayer decision model  Implement structured decisions, including: - accepted - rejected - needs_review - source_unavailable  Include a reason code, quest identifier, XP award, evidence identifier or hash, and the relevant transaction/decision reference.  Use deterministic checks for objective on-chain facts. Use GenLayer for the portion that genuinely requires interpretation or judgment. Validators must independently inspect the underlying evidence according to explicit verification rules. Do not accept a result solely because an LLM returned valid-looking JSON.  ## Ecosystem research  Before implementing automatic ecosystem rewards, search official Chog and Monad sources for recent or active events and quests. For each candidate event, record: - exact event name and dates - official source URL - eligibility rules - evidence required - actual completion signal - verification method - whether the claim can be verified automatically  Do not invent event participation records or contract addresses. If no reliable completion signal exists, support manual review or leave the quest inactive.  ## Delivery process  1. Inspect the repository and existing code before making changes. 2. Write or update PRD.md, architecture.md, and quest-registry.md. 3. Implement the application in small, testable phases. 4. Deploy and test the demo NFT and evolution state. 5. Integrate and test GenLayer adjudication. 6. Integrate original Chog ownership verification. 7. Add rescan and evidence integrations. 8. Test duplicates, wallet transfers, RPC failures, missing evidence, pending decisions, and image-generation failures. 9. Provide a reproducible local setup, environment-variable example, contract addresses, deployment instructions, test commands, and judge-demo instructions. 10. Ensure the judge can complete the end-to-end experience without purchasing an original Chog.  Prioritize a working, polished, truthful MVP over incomplete integrations. Do not mark any feature complete unless it has been implemented and tested. Record unresolved dependencies explicitly rather than silently substituting simulated behavior for real verification.



Where should the demo NFT be deployed?
Monad testnet — safer and easier for judges to experiment
How should original Chogs evolve?
Companion evolution profile by default; mutate original metadata only if authorized and supported
How should the artwork change?
Approved trait-composition system first — more consistent and reliable
How should community participation be verified?
Hybrid — on-chain verification, supported public evidence, and manual review for ambiguous claims

# CHOG Evolution — Updated PRD & Build Blueprint

Version 2.0 · Chogathon · GenLayer + Monad · Updated 17 October 2026

The biggest change is that we are no longer building just an NFT that changes its appearance. We are building a usable platform where people connect their wallets, prove what they have done in the CHOG ecosystem, earn evolution progress, and watch their Chog evolve.

And your clarification solves an important practical problem: you do not own one of the original 1,969 Chog NFTs, so we should not make the demo depend on buying one or having permission to change the original collection's contract.

The updated plan has two NFT modes:

- Demo Chogs: NFTs we mint in our own test collection, with original, clearly labelled Chog-inspired artwork based on the five authentic reference NFTs you will supply. These let judges test the complete experience without owning an original Chog.
- Existing Chogs: A separate integration mode that detects and verifies authentic NFTs held in a user's Monad wallet. We support their evolution through the original collection only if its contract allows it; otherwise, our platform provides a companion evolution profile without falsely claiming to have changed the original NFT.

This distinction is essential. We can build and demonstrate both modes, but we must not present a mock NFT as an authentic member of the original 1,969-token collection.

## 1. Product overview

# CHOG EVOLUTION

Your activity shapes your Chog. Your Chog becomes your history.

[Chog (@ChogNFT) on X](https://images.openai.com/static-rsc-4/w0MYksWMG7lw4o0JwSLPS1OSg4oSt5tmMIuavveD80HEbf2CgpGVBFdciGGBS4PZvBsstOjJnfmPe5lXkeYe6ba9ZpSAfT_0ZAn5yZjb4MhLp6wPeiNSC5E9HfLKlUzOUVhlwJfcCfF9ZDKOhHIdArSKAmdmGAONGnzps05hOBY?purpose=inline)

[x.com](https://x.com/ChogNFT?utm_source=chatgpt.com)

Visual direction only. The final interface must use the actual Chog reference artwork from your repository, not substitute generic frog art.

Product concept: A gamified CHOG ecosystem companion where each Chog is a persistent digital identity. Its attributes, visual form, abilities, and utility evolve based on verifiable on-chain activity and validated participation in the wider ecosystem.

The problem: NFT ownership alone does not guarantee that people keep using an NFT. Community contributions, participation in events, and on-chain activity are often scattered across wallets, social platforms, and individual project sites.

Our solution: A platform that turns this activity into a persistent, visible evolution journey, using GenLayer to evaluate evidence that requires judgment, while deterministic code verifies objective facts wherever possible.

The project is designed around the Chogathon's stated challenge: invent a new NFT experience in which the NFT is essential, and demonstrate novelty, fun, retention, clarity, and execution. The published judging weights are 30%, 20%, 20%, 15%, and 15%, respectively; meaningful $CHOG integration is a bonus.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chogathon.chog.xyz\&sz=32)

Hackathon



### Product goals

- Let a judge try the full experience without owning an original Chog NFT.
- Let actual Chog holders connect their wallets and verify ownership on Monad.
- Let users rescan their ecosystem history and discover eligible activity.
- Turn accepted activity into transparent, explainable NFT evolution.
- Demonstrate a real GenLayer decision, not merely use an AI model to write descriptions.
- Make the Chog's evolution affect how it is used in the application, not just how its picture looks.

### Non-goals for the first release

- Modifying the original Chog collection without permission or contract support.
- Claiming that a demo NFT is one of the original 1,969 NFTs.
- Automatically proving every X like, follow, or view without reliable evidence.
- Supporting every Monad project, event, and social platform from day one.
- Making users pay for an NFT just to experience the judge demo.

## 2. NFT model: two modes, one platform

[Credit Runner](https://images.openai.com/static-rsc-4/Da1PYhO6luTIIUj42ZiQV2B1mgADmB26Z4zMArYEHZnRTXYGEy-ayA9UETGLrnRmY0ozEyqqC20P7C3fOt3oRGjMDFP-lj9UHb2ompQhI-UXXpnfOzBUZZI2pCtgvcdtT286E0Zmd3gXpBBGrqdYoGNocVMrh_hNhZ9e-KjhSvc?purpose=inline)

### Mode A — Demo Chog

Required for the demo

A separate NFT collection that we control. Users can mint a demo Chog and immediately use it in the evolution platform. It has its own contract address, token IDs, ownership history, and metadata.

The five authentic reference NFTs guide the visual design. The resulting art must be clearly labelled as original demo artwork, not copied and represented as official collection tokens.

[X](https://images.openai.com/static-rsc-4/79CFki5vAcefq-SyWBwLDlElhyXDZ3Ypy9-9BzWeDp9_7mHMI5U5tTY_CWNcNevlD1x3OiJ2on4zJG5ghA86UnkgBNjlBedgMs1DlbnEgFQ9Zr-u6glKVS-hNLOZZK4dM6MDnpogY2sqBxOdtVtblhIHJhuSztEnZzF4rXJvfD0?purpose=inline)

### Mode B — Original Chog

Holder integration

The app detects an authentic Chog by checking its verified collection contract and the connected wallet's token balance. The user receives an evolution profile linked to that original token.

Changing the original token's image or metadata requires support from its contract or an authorized integration. Otherwise, the evolution lives in our companion platform.

### Important collection rules

1. The original Chog collection is understood to contain 1,969 unique NFTs, based on the project information provided. The exact collection contract address, token standard, and metadata behavior must be confirmed before implementation.
2. Our demo collection must have a different contract address and must never reuse original Chog token IDs as if they belonged to the official collection.
3. A wallet may own both types. The UI must always display the correct mode and collection identity.
4. Evolution progress should follow the NFT's token identity, not simply the current wallet address. If an NFT is transferred, we must define how its progress behaves.
5. We should preserve the original artwork and collection metadata of authentic Chogs unless an authorized, contract-supported update is available.

Recommended default: Make demo minting the judge's first experience. Build authentic ownership verification as a separate, real integration—not as a requirement for using the app.

## 3. The platform judges will use

The site should feel like a playable NFT experience rather than a dashboard full of blockchain terminology.

[Dashboard Profile by Jenny Mia on Dribbble](https://images.openai.com/static-rsc-4/Jy6qmD1gvEDyYtYbMAc2F_mSwshv5u4JCYyE7_Q1m5JnKljunok6WyF05zQONAdf8lPN5z1k_REpBaknAKr17pRi5jedRDIdRbE7QulvHpdo38vIUv-Xe0YrKgGUqtuAiN2E6DpT7hRIY6tZtBy2SUm4nvgRCL9TDa-UY4J9N8M?purpose=inline)

A. Home / Evolution Lab

- See the active Chog and its current evolution stage.
- See level, XP, traits, abilities, and recent achievements.
- View the next evolution milestone.
- Choose Mint Demo Chog or Connect Existing Chog.

[Introducing the New Layer3 Quest Experience | Layer3 Blog](https://images.openai.com/static-rsc-4/M8VEpOCcKPG-PHVMZ6P8ICZypXMs6Rp8yfEYkJjwSB_qB-u1SIEgvWUNraY_qGe1CJ_9V7V9JHsj88vrmTksqQxZNe-tIf3yGXn2bVjCkNoGegrSkDtzJ38t-RJrFB47mCqwooTIcjogKUrSEAgfh9QNb3Ehne7Ogn1QQ7PiVTU?purpose=inline)

B. Quest Board

- Browse available ecosystem quests.
- See exactly what counts as valid evidence.
- Submit a transaction, event claim, public post, or other supported evidence.
- Track pending, accepted, rejected, and review-needed submissions.

[Debank — Most Powerful Tool in DeFi | Web3 App Review | by Ty Cooper | Coinmonks | Medium](https://images.openai.com/static-rsc-4/Njr_oHxg-dXEGVv59T1TAUzmz0GQuH-BVg4yYf0xIPLRWJo9MwNSlXGWydWWkCJNYWrEiT6mLeBphc1xXPLQx2lTmhfQsH3FR5oGvTlUvVFS_33pC7toIHY5YxKJsb4N_AjLJEPUSaRxIm5GZXiICEWHVzPN3wLa2_PGeHLnuB8?purpose=inline)

C. Ecosystem Rescan

- Scan wallet activity on Monad.
- Match eligible transactions against known event and quest rules.
- Find claimable past achievements.
- Show evidence links, time windows, and why each activity qualifies.
- Let users rescan after new events or integrations are added.

[Claynosaurz (@Claynosaurz) on X](https://images.openai.com/static-rsc-4/QZwvpOqX0SVTwpDpci2ZZDgRzxg4yJouaAwCinAZfhZDeL3EvVVNWFCziSmSPlGyMhGOjARMgiIiMKf_NDoiVD5Fc-zFlCXLz_EOGu4vFDQk1fMFmoWVxItCNSfumWZeZBFIJf_FqjDKeDeK9ktx0Lc0Jfqo1oKkOE6Jta4hpEU?purpose=inline)

D. Evolution Chamber

- Preview the next form before committing.
- Display the exact achievements that unlocked it.
- Explain each changed trait.
- Allow a user to trigger an eligible evolution.
- Show the transaction and the final evolution result.

[Profile & Rewards | UI/UX Gaming web design by Alejandro Mejía Villa on Dribbble](https://images.openai.com/static-rsc-4/URWNaWR6LFUTuanO8PjEGA-uHl3eBq1vFmOg6pmiz6ecKw0McOMRHFEfkJRrM1MP15QS5-XtsckAa8_ag5tOiqPMmwsykRFBBiFp9pC8a1pRNE_J6TfhP0tEfUAQvX9nlrRXU5fyAHjb5UtZ8nTcxm7pAwm_i37Bw7-WyfBhbXs?purpose=inline)

E. Chog Profile / Passport

- Display the NFT's evolution history and verified achievements.
- Separate verified on-chain facts from community or social evidence.
- Share a public profile and an evidence-backed achievement card.
- View the NFT's history even after returning to the app later.

These are design references for the UI direction, not representations of the actual Chog collection. Actual NFT artwork must come from your reference repository and the rendering pipeline.

### The core judge demo

A judge should be able to:

1. Open the site and mint a demo Chog.
2. Complete a starter quest or load a clearly labelled demo evidence scenario.
3. Submit the evidence for validation.
4. See GenLayer return a structured decision with an explanation.
5. See the Chog gain XP and unlock a trait or evolution.
6. Preview the new appearance and save the resulting evolution state.
7. Open the history and verify which evidence caused the change.

A demo scenario must be visibly labelled as simulated. It should prove that the workflow works without pretending that simulated activity happened on the real blockchain.

## 4. What actually makes the NFT evolve?

The system needs a clear relationship between activity, proof, progression, and the NFT's appearance.

### Evolution loop

1\. Connect or mint a Chog

Original collection or our demo collection

2\. Discover ecosystem activity

Wallet history, quest submissions, event records and public evidence

3\. Verify evidence

Deterministic checks first; GenLayer judgment where interpretation is needed

4\. Award XP and unlock traits

Rules-based progression, anti-duplicate checks and an auditable decision

5\. Evolve the Chog

Generate or compose a new appearance, save the version, display the result

### Proposed progression system

For the first version, use five stages. Stage names can change later.

| Stage        | Example unlock requirement                   | Possible visual change                                    |
| ------------ | -------------------------------------------- | --------------------------------------------------------- |
| 1. Hatchling | Mint or register a Chog                      | Starting appearance                                       |
| 2. Curious   | Complete the onboarding quest                | Eye or expression variant                                 |
| 3. Explorer  | Verify ecosystem participation               | Accessory or background                                   |
| 4. Veteran   | Earn several distinct achievements           | Body, outfit, aura or visual effects                      |
| 5. Legend    | Complete a high-value milestone or quest set | Rare combination, animated presentation or signature aura |

These are proposed game rules, not claims about existing Chog lore.

### XP and trait rules

Start with a simple, auditable points system:

- Verified on-chain action: 10–50 XP, depending on the action.
- Verified event participation: 25–100 XP.
- Verified contribution or completed ecosystem quest: 25–150 XP.
- Repeated low-value activity: diminishing rewards or a daily cap.
- A single piece of evidence can only be credited once for the same quest.
- A user cannot gain XP merely by refreshing the scan button.
- High-value or ambiguous claims require stronger evidence or manual review.

The backend should calculate eligibility from explicit rules. GenLayer is used when a claim requires interpretation, such as determining whether submitted public evidence genuinely demonstrates participation in a defined activity.

Critical design rule: GenLayer should not be asked to invent the score, the evidence, and the trait at once. The contract should receive evidence references and clear rules, then return a structured decision such as:

- `accepted` or `rejected`
- quest identifier
- XP awarded
- reason code
- evidence hash or identifier
- progression unlock, if any

GenLayer's design is well suited to decisions that require interpretation of web data or natural-language evidence, provided validators can independently inspect the underlying material and the contract has explicit verification criteria.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



## 5. The ecosystem rescan feature

This is a major feature, not an optional button. It can become the main way users discover that their Chog has earned something.

### User journey

1. User connects a wallet.
2. The app identifies whether the wallet holds an authentic Chog, a demo Chog, or both.
3. The user opens Ecosystem Rescan.
4. The app scans supported on-chain activity and checks a maintained registry of eligible events and quests.
5. The app presents a list of discovered claims, each with evidence and a confidence/status label.
6. The user chooses which claims to submit.
7. Each claim is checked for eligibility and duplication.
8. Accepted claims update XP and unlock the relevant evolution progress.

The app must show the difference between:

- Found: activity detected but not yet checked against a quest.
- Eligible: objective rules indicate that the activity qualifies.
- Submitted: evidence has been sent for adjudication.
- Verified: the required verification has succeeded.
- Rejected: the evidence does not satisfy the published criteria.
- Needs review: evidence is ambiguous or an external source is unavailable.

A scan should never silently award XP for an unverified claim.

### Data sources for rescanning

A. Monad on-chain data — highest priority

Transactions, contract interactions, token/NFT ownership, and event logs where the relevant contract emits suitable events. This is the most reliable starting point for proving wallet activity.

B. Ecosystem event registry

A database of specific campaigns, event dates, participating contracts, quest rules, official announcements, and accepted evidence types. The app scans against known rules rather than pretending it can automatically recognize every ecosystem event.

C. Public social evidence

User-submitted links to public posts, event recaps, public photos, or other supported sources. We can fetch public pages where technically and legally available, but a visible post alone may not prove that the person attended an event or performed a particular action.

D. Official event attestations

Where possible, organizers can publish signed participant lists, issue claim codes, or provide an official verification endpoint. These can provide stronger proof than screenshots or scraped pages.

### Event registry schema

Each supported event or quest should have:

- `event_id`
- event name and description
- official source URLs
- start and end time
- supported chain and contract addresses, if applicable
- eligibility rules
- evidence types accepted
- reward and XP values
- maximum claims per wallet
- one-time or repeatable status
- verification method
- review/fallback procedure
- date last verified by the team

The registry is how we make rescan useful beyond the hackathon. When a new verified event is added, existing users can rescan and potentially discover new achievements without the team rewriting the application.

## 6. Recent CHOG ecosystem research and event verification

The project should start with a small, high-quality list of supported activities instead of claiming to cover the entire ecosystem immediately.

The following are useful research leads from public sources. They are not yet a definitive list of quests we can award.

[hosythoang (@yoshinokuna) on X](https://images.openai.com/static-rsc-4/aH2qTYPXxPb-SKy7NB3ZgFig4wNJIyvwLh7l7_oEOZMsPAi--FCNDFPBwRI5sbb4dQx-EQk55Vl3-kqcBygs5h6ZmWjxU03qTnrKX2AwbMjBjWYUZFLliANY0Kw1wjftNK6ZpQ3hHVtb2SEujsebJl-VXoebO4-qv699gPKpGoc?purpose=inline)

Chogtober 2026

The public Chogtober site describes a multi-day program introducing participants to Monad and projects in its ecosystem, including a set of Chog-focused missions. This is a strong candidate for an event-registry entry if we can recover official mission definitions and establish how each completion was recorded.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chog.zone\&sz=32)

Chog



Verification plan: identify the official campaign and mission pages, then check whether each mission exposes on-chain transactions, claim records, account-based completion, or organizer attestations.

[Monad Community App](https://images.openai.com/static-rsc-4/mjTdYfZCBW6l2gAHbsXTvUtZDVgNnwk0IYfcUPOoEQLzrxPf3qF3gT5JKV_SX-rHUlAikuUMSyh5a-PZOuLUmkJam8OpWoyKgbX2aEU_J7R0QAV4OYehkxqrEH1h7dRFP682Uapb3YRZ3UxukVV25BXn3QcFqZqWx55AwsV7COE?purpose=inline)

Chog Genesis collection

OpenSea currently lists a collection named Chog Genesis on Monad with a supply of 1,969, consistent with the collection size you've described. The collection page and individual NFT records provide a starting point for verifying the collection identity and inspecting token traits.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://opensea.io\&sz=32)

OpenSea

+1



Verification plan: confirm the official collection contract address, ERC-721 behavior, token metadata, and whether the contract permits any authorized metadata changes. Do not infer these capabilities from the marketplace display alone.

[Monad Blitz Lagos · Luma](https://images.openai.com/static-rsc-4/as-pjl3YqTW4LXIWxFEZCNSY4TSiFmfzr7sE8Xa5b4b3Wb7foRsOREH3m1ZDviPe0fd2wWfJV34H-UFVRxPsUptDMGCWNEVMaEEkp28Nd1erXxDX_ZmANiBRTsWI6FV7xuLc9_wI_wjwNw0DUglqFICFq3xADFSlvycrbqWz-PQ?purpose=inline)

Monad ecosystem builder events

Public event listings document Monad ecosystem activities, including Monad Blitz Lagos in April 2026. This is an example of the kind of ecosystem event that could eventually be represented in the registry, but it should only reward users when there is an evidence source linking the participant to the event.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://luma.com\&sz=32)

Luma



Verification plan: use official registration/completion records, participant attestations, or accepted public evidence. A wallet's existence or a social post about the event alone is not proof of attendance.

### Research task for implementation

Before launch, the research agent must:

1. Search the official Chog website, official Chog social accounts, official Chog Discord announcements accessible to the team, Chogathon pages, and official ecosystem campaign pages.
2. Identify recent or active events and quests, with exact dates and the official announcement URL.
3. Find the actual completion signal for each event: contract event, transaction, official claim page, verified account record, organizer list, or other evidence.
4. Classify each event as automatically verifiable, user-submitted evidence, organizer attestation required, or not verifiable.
5. Add only events with documented rules to the initial registry.
6. Record the last verification date and recheck links before accepting claims.

Do not make up events, participation criteria, contract addresses, or historical completion records. If a recent event has no publicly verifiable completion signal, the platform may list it as an unsupported/manual-review activity, but it must not award automatic XP.

## 7. X account linking without a paid X API

Your proposed bio-code method is a reasonable low-cost way to verify control of a public X account, with some limitations.

### Account-linking flow

1. The user enters an X handle.
2. The app generates a unique, temporary code, for example `CHOG-LINK-7K4P2`.
3. The user adds the code to their public X bio.
4. The user submits their public profile URL.
5. The app checks whether the exact code is visible on that profile.
6. If confirmed, the user can remove the code. The app stores the verification time and account mapping.
7. The app periodically rechecks account ownership only when needed, rather than requiring the code to remain in the bio forever.

The code should expire, be single-use, and be bound to the wallet session or account-linking request. A profile link alone is not enough.

### What this proves—and what it does not

| Claim                                                         | Bio code alone proves it?                                |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| The user could edit the public X profile at verification time | Yes, if the code is correctly checked                    |
| The user owns the wallet                                      | No; verify wallet control separately                     |
| The user liked a post                                         | No                                                       |
| The user attended an event                                    | No                                                       |
| The user published a specific post                            | Not unless the post is independently located and checked |
| The account still belongs to the same person months later     | No; ownership can change                                 |

### Public post evidence

The app can accept a public post URL and try to retrieve the post and its visible content. For a claim about event participation, the system can inspect:

- whether the post exists and is public;
- its author and timestamp, where available;
- whether the text or media appears to match the event's published criteria;
- whether the event date and claim window match;
- whether the same evidence has already been claimed.

But a scraper is not a substitute for a reliable social API. X may block automated requests, change its HTML, limit visibility, or make certain engagement data inaccessible. Likes and private account activity generally cannot be assumed verifiable through public-page scraping.

### Recommended evidence policy

- Use blockchain events and official completion records for automatic XP wherever possible.
- Use X bio verification only for linking a social account.
- Use public post evidence for claims that can genuinely be supported by the post.
- Use signed organizer attestations or manual review for event attendance that cannot be established otherwise.
- If evidence cannot be fetched or independently checked, return `needs_review` or `source_unavailable`, not an invented approval.
- Avoid storing unnecessary personal data or collecting private social content.

This keeps the app functional without paid X API access while making clear which achievements are strongly verified and which are supported by weaker public evidence.

## 8. Technical architecture

The application should have four distinct responsibilities: frontend, backend/indexer, GenLayer adjudication, and NFT contracts/storage.

Frontend — Evolution Platform

React/Next.js · wallet connection · quest board · rescan · evolution UI

Backend API + Evidence Indexer

Quest registry · Monad RPC · event matching · evidence storage · cache · rate limits

Monad

Ownership, transactions, NFT state

GenLayer

Evidence adjudication and accepted decisions

Evolution State + Art Pipeline

XP, levels, traits, image composition, metadata, history

### Recommended stack

| Layer                    | Recommendation                                    | Why                                                                 |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- |
| Frontend                 | Next.js + TypeScript                              | Fast development, clear page structure and API integration          |
| UI                       | Tailwind CSS + a consistent component system      | Rapid, cohesive visual implementation                               |
| Wallet                   | EVM-compatible wallet connector                   | Connect to Monad and sign ownership-related requests                |
| Blockchain reads         | Viem or equivalent EVM library                    | Contract reads, logs and transaction inspection                     |
| Backend                  | Next.js API routes or a separate Node.js service  | Evidence orchestration, caching and integrations                    |
| Database                 | PostgreSQL, optionally Supabase                   | Users, quests, claims, scan checkpoints and evolution history       |
| Evidence/art storage     | Object storage + IPFS for durable public metadata | Keep evidence and NFT metadata separate from the application server |
| Intelligent adjudication | GenLayer Intelligent Contract                     | Consensus-backed decisions for ambiguous evidence                   |
| NFT contracts            | Solidity + OpenZeppelin                           | Mintable demo ERC-721 and optional companion profile contract       |
| Rendering                | Deterministic trait composition first             | Consistent character identity, repeatable images and low cost       |

These are proposed implementation choices, not mandatory services. Keep the initial system small enough to build and demonstrate within the hackathon window.

### Monad connection: public RPC first, private RPC later

Monad's mainnet uses chain ID `143`, with `MON` as its native currency. The Monad developers' public resources list `https://rpc.monad.xyz` as a mainnet RPC endpoint.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Recommended configuration:

- `MONAD_CHAIN_ID=143`
- `MONAD_RPC_URL` — use the public RPC initially.
- `MONAD_EXPLORER_BASE_URL` — configure the current official explorer.
- `CHOG_GENESIS_ADDRESS` — set only after confirming the collection contract.
- `DEMO_CHOG_ADDRESS` — the address of our own deployed demo collection.
- `GENLAYER_CONTRACT_ADDRESS` — populate after deployment.

Keep all endpoints and contract addresses in environment configuration rather than hardcoding them across the codebase.

RPC versus explorer API: these are related but different services.

- RPC provides direct blockchain access, such as `eth_call`, transaction receipts, block numbers and event logs.
- An explorer API may provide indexed transactions, NFT holdings, contract labels and human-readable links.
- An explorer API is convenient, but it is not a replacement for the blockchain's underlying state.

Use RPC as the primary source for critical verification and the explorer as an optional indexing/UX layer. If we later obtain a private RPC endpoint, changing the environment variable should be enough to use it.

### Rescan performance and reliability

The app should not scan the entire chain every time someone clicks the button.

1. Store the last successfully scanned block for each wallet and supported data source.
2. Scan new blocks and relevant contract logs since that checkpoint.
3. Query historical ranges only when a quest needs them.
4. Cache collection metadata and confirmed ownership results briefly.
5. Use a bounded range per request and continue large scans in background jobs.
6. Retry transient RPC failures with backoff.
7. Make scans idempotent: the same event must not create duplicate claims.
8. Use a second configured endpoint or explorer fallback if the primary RPC is unavailable, while clearly recording the data source.
9. Mark incomplete scans as incomplete rather than displaying them as fully verified.
10. Verify important state again before issuing a final award or transaction.

A public RPC is a sensible MVP choice, but shared endpoints can be rate-limited. Do not promise instant full-history scans on every wallet.

## 9. Smart contracts and on-chain state

The safest design is to use two separate NFT paths and one shared evolution system.

### Contract A — Demo Chog ERC-721

This is the collection we deploy and control.

Requirements:

- mint demo NFTs;
- assign unique token IDs;
- provide `tokenURI`;
- support controlled metadata updates if the demo needs on-chain metadata pointers to change;
- expose the contract address clearly in the UI;
- emit standard transfer events;
- restrict administrative operations;
- make demo minting inexpensive enough for judges to try, preferably on a suitable test network or with sponsored transactions.

The demo collection must be visually inspired by the actual Chog references, but it must not claim to be the original collection.

### Contract B — Evolution profile

This contract or an equivalent persistent state layer tracks evolution for a particular NFT identity.

Example conceptual fields:

```
collection_address
token_id
evolution_stage
xp
unlocked_traits
achievement_ids
evolution_version
last_updated
```

The original NFT remains in its existing collection. The evolution profile records the new progression state separately.

For the first demo, we can store the profile on-chain or use a backend database with a verifiable GenLayer decision record. The right choice depends on how much of the experience needs to be independently inspectable on-chain versus how quickly we need to ship.

### Contract C — GenLayer adjudicator

This Intelligent Contract receives structured claims and applies the published verification criteria. It should not control NFT ownership or hold privileged access to the original Chog contract.

Responsibilities:

- evaluate evidence against quest rules;
- return a structured decision and reason;
- reject reused evidence;
- ensure a claim cannot be rewarded twice;
- make accepted decisions available to the evolution service;
- retain enough evidence references or hashes to audit the outcome.

GenLayer Intelligent Contracts use Python and a validator-consensus process for decisions involving non-deterministic operations. That makes them appropriate for evidence adjudication, but the verification logic still has to be designed carefully.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



### The metadata mutation question

Before implementing original-Chog evolution, inspect the actual collection contract and verify:

- Is it ERC-721?
- How is `tokenURI` implemented?
- Is there a mutable base URI or per-token URI?
- Is the metadata frozen or immutable?
- Who has permission to change metadata?
- Does the contract have an authorized extension or companion mechanism?
- Are marketplace metadata refreshes supported?

If the contract is immutable or controlled by another party, we cannot promise that OpenSea or another marketplace will display our evolved image as the original NFT's metadata.

In that case, the original Chog remains unchanged on-chain, while our app displays a linked evolution profile. The connection must be labelled clearly.

## 10. Artwork pipeline: preserving the real Chog identity

This part deserves special care because the appearance is central to the product.

### Reference repository

You will upload five authentic Chog NFTs to a public GitHub repository. The build should treat these as the approved visual reference set.

Suggested structure:

```
chog-evolution/
  assets/
    chog-references/
      reference-01.png
      reference-02.png
      reference-03.png
      reference-04.png
      reference-05.png
      README.md
    trait-parts/
    generated/
  apps/
    web/
  services/
    evidence-indexer/
    art-renderer/
  contracts/
    demo-chog/
    evolution-profile/
  genlayer/
    chog_adjudicator.py
  docs/
    PRD.md
    architecture.md
    quest-registry.md
```

The actual repository URL should be configured when you supply it; it should not be guessed.

### Recommended rendering strategy

For the first release, use a controlled trait-composition system rather than unconstrained image generation for every evolution.

Each Chog has:

- a consistent base silhouette;
- a selected palette and background;
- permitted eye and expression variants;
- body or outfit traits;
- accessories;
- evolution effects, such as an aura or frame.

The renderer combines approved assets according to the earned trait set. This preserves the character's recognizability and lets judges compare before and after states.

Later, we can add an image-generation service that uses the approved references and a strict prompt template. That output must be checked against the character design rules before it is accepted.

### Rendering requirements

- Preserve the recognizable Chog silhouette and design language.
- Do not replace Chog with a generic frog.
- Do not use the five references as permission to claim our new artwork is official Chog art.
- Do not allow an LLM to invent arbitrary traits that are not in the approved trait catalogue.
- Generate a versioned image and metadata record for every evolution.
- Save the old image and old trait set so the evolution history remains visible.
- Use content hashes so the UI can tell whether the image or metadata changed.
- If rendering fails, preserve the last valid image and show the user that the evolution is pending.

### Example metadata for a demo Chog

```
{
  "name": "Demo Chog #12",
  "description": "A Chog-inspired demo NFT for the CHOG Evolution platform.",
  "attributes": [
    { "trait_type": "Evolution Stage", "value": "Explorer" },
    { "trait_type": "Aura", "value": "Cyan" },
    { "trait_type": "Accessory", "value": "Explorer Badge" },
    { "trait_type": "Verified Achievements", "value": 3 }
  ],
  "properties": {
    "collection_mode": "demo",
    "art_version": 2
  }
}
```

This is an illustrative metadata shape. Final fields must match the contract and marketplace behavior we implement.

## 11. Utility options — choose what the product should become

I recommend a strong primary utility plus a few supporting ones. If we build too many unrelated features, the demo will be harder to finish and the main innovation will become less clear.

## Utility shortlist

Select the utilities you want included in the build plan. The first three are my recommended foundation.

Evolution engine

Core

Verified activity changes the Chog's stage, traits, visual appearance and abilities.

Ecosystem passport

Strong add-on

A portable history of verified activity, achievements and contributions across supported CHOG/Monad experiences.

Quest and rescan engine

Strong add-on

Discover past eligible activity and new quests; submit evidence and earn progression.

Evolution arena

Optional

Let users compare Chogs in themed challenges based on unlocked traits and verified achievements—not just wallet size.

Trait crafting

Optional

Combine earned fragments or achievements to unlock a new accessory, aura or appearance variant.

Community evolution events

Optional

Limited-time community quests that evolve many Chogs together and create shared goals.

Utility access gates

Optional; partner-dependent

Use evolution levels or badges to unlock selected platform features, beta access, community roles or partner quests.

$CHOG integration

Bonus feature

Use $CHOG for an optional cosmetic or crafting action only if the integration is safe, meaningful and feasible.

&#x20;Copy selected utilitiesUse these utilities in the PRD

### My recommendation

The strongest combination is Evolution Engine + Ecosystem Passport + Quest/Rescan Engine.

It gives us one coherent product loop:

- The passport records what the user has actually done.
- The quest engine finds eligible activity and verifies claims.
- The evolution engine turns those achievements into a visible, persistent change to the Chog.

That is a better story for judges than building a generic NFT collection with a level counter. The NFT is the user's evolving identity, and the platform is the place where that identity gains meaning.

### How the NFT should matter

Every major utility should use the NFT's identity or earned traits.

For example, a user might need to unlock an Explorer trait to enter a particular challenge, or an achievement badge to access a special quest. These should be platform mechanics we can demonstrate immediately—not promises of access to external communities that have not agreed to support us.

The $CHOG token is optional under the published Chogathon rules.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chogathon.chog.xyz\&sz=32)

Hackathon

&#x20;I would not make the first release depend on token payments, staking, or financial rewards. We can add a meaningful token integration later if it improves the experience and we can verify the correct contract and transaction behavior.



## 12. Database and evidence model

The database must separate evidence, adjudication, and evolution so we can audit why an NFT changed.

| Entity               | Important fields                                                             |
| -------------------- | ---------------------------------------------------------------------------- |
| `users`              | ID, wallet addresses, created time                                           |
| `social_accounts`    | Platform, handle, verification status, verification time                     |
| `nfts`               | Chain ID, collection address, token ID, mode, current owner snapshot         |
| `evolution_profiles` | NFT identity, stage, XP, trait set, current art version                      |
| `quests`             | Quest ID, description, rules, active period, reward, evidence requirements   |
| `events`             | Official source, dates, supported evidence, verification method              |
| `claims`             | User, NFT, quest, evidence references, status, decision ID                   |
| `evidence`           | Type, URL or transaction hash, source, content hash, timestamp, fetch status |
| `decisions`          | GenLayer transaction reference, structured result, reason, finality status   |
| `evolution_history`  | Previous state, new state, cause, image/metadata version, timestamp          |
| `scan_jobs`          | Wallet, source, block range, checkpoint, status, error details               |

### Anti-abuse rules

- Enforce unique claims at the database level.
- Normalize transaction hashes, wallet addresses, and supported public URLs before checking for duplicates.
- Keep evidence linked to the specific user, wallet, quest, and NFT it supports.
- Revalidate current NFT ownership before an ownership-sensitive action.
- Do not let users choose their own XP amount or directly set their evolution stage.
- Keep an audit log for administrative overrides.
- Require a reason and authorized operator for any manual award or reversal.
- Treat social evidence as potentially forged until its source and content have been checked.
- Never trust the frontend's claim that a transaction or social event has been verified.

### Transfer behavior

The product needs an explicit rule for what happens if an NFT changes hands.

My recommendation is:

- Achievements tied to the wallet stay with that wallet.
- Achievements tied to the NFT's identity stay with that NFT.
- The interface displays which achievements are wallet-bound and which are NFT-bound.
- Demo NFT evolution follows the token, unless the game rules explicitly state otherwise.

This prevents a buyer from accidentally inheriting another user's entire social history as if they had earned it.

## 13. Security, failure handling and edge cases

| Scenario                                             | Required behavior                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| User owns no original Chog                           | Offer demo minting and label it clearly                                        |
| User owns an original Chog                           | Verify the collection and token on Monad                                       |
| NFT belongs to a counterfeit collection              | Do not recognize it as an original Chog                                        |
| RPC endpoint is rate-limited                         | Retry, back off, and show scan status                                          |
| Full historical scan is too large                    | Split into jobs and continue from checkpoints                                  |
| Explorer API is unavailable                          | Use direct RPC for supported verification                                      |
| Public X profile cannot be fetched                   | Mark social verification unavailable; do not award automatically               |
| X post was deleted or made private                   | Keep the prior evidence record but mark re-verification unavailable            |
| Same event is submitted repeatedly                   | Return the existing claim or reject the duplicate                              |
| GenLayer returns a pending or failed decision        | Do not apply the reward until the decision reaches the required accepted state |
| Image generation fails                               | Preserve the current valid appearance and retry                                |
| Metadata update is not supported by the original NFT | Show the companion evolution profile instead                                   |
| User transfers the NFT during a pending claim        | Recheck ownership before ownership-sensitive operations                        |
| Two requests attempt the same evolution              | Use idempotency keys and atomic state updates                                  |
| A quest's rules change                               | Preserve the rule version used for earlier claims                              |
| Admin changes a quest reward                         | Log the change and apply it according to a published effective date            |

### Important trust boundary

GenLayer can help establish whether evidence satisfies an agreed rule, but it does not automatically make unreliable evidence reliable. Validators must be able to independently inspect the source data, and the system must handle disagreements, timeouts, and inconclusive results.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



The backend must not award an achievement merely because a model generated a confident explanation. It should only apply a reward after the required verification and finalization conditions have been met.

## 14. Implementation plan

Build the project in phases so we always have a working demonstration, even if some external integrations are unavailable.

01

Foundation and visual identity

Deliverable: working frontend shell

- Set up the repository and application.
- Load the five approved Chog reference images.
- Build the Home, Quest Board, Rescan, Evolution Chamber, and Passport pages.
- Create the trait catalogue and rendering prototype.
- Add a clearly labelled demo mode.

02

Demo NFT and evolution state

Deliverable: mint, progress, and evolve

- Deploy the demo ERC-721 collection on the chosen test network.
- Implement token ownership and metadata.
- Build XP and stage rules.
- Add deterministic trait composition.
- Save an evolution history record after each accepted change.

03

GenLayer adjudication

Deliverable: verifiable evidence decision

- Create an Intelligent Contract with structured claim inputs.
- Implement the evidence evaluation rules and independent validator checks.
- Record transaction references and final decision status.
- Connect accepted decisions to the progression engine.
- Test accepted, rejected, duplicate, and inconclusive claims.

Use the current GenLayer SDK and the network environment appropriate to the build. GenLayer's official documentation recommends developing and testing the contract before integrating it into the frontend.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



04

Monad ownership and ecosystem rescan

Deliverable: authentic wallet integration

- Confirm the original Chog Genesis contract.
- Detect and verify original NFT ownership.
- Implement incremental wallet scans.
- Add the event registry and starter quests.
- Display transaction and evidence links.
- Add the X bio-code linking flow as a separate integration.

05

Polish and judge preparation

Deliverable: complete end-to-end demo

- Test wallet disconnection, RPC failure, and pending transactions.
- Verify that demo and original collections are visibly distinct.
- Add an example activity that genuinely changes the NFT's appearance.
- Prepare a resettable demo scenario.
- Record the demo video and publish judge instructions.

### Priorities if time becomes limited

Must ship: demo mint, evolution UI, trait changes, evidence submission, a real GenLayer decision, and an auditable history.

Should ship: original Chog ownership verification, one real Monad activity quest, and incremental rescan.

Can follow: broad event coverage, public social scraping beyond basic supported pages, advanced generative artwork, arena gameplay, and token integration.

Do not delay the entire product while trying to solve every social platform's data-access limitations.

## 15. Acceptance criteria

The build is not complete merely because the site looks good. These are the tests that should pass before we call the MVP ready.

- A judge can use the app without owning an original Chog.
- A demo Chog can be minted and has a unique token ID.
- The app distinguishes demo Chogs from original Chogs in every relevant screen.
- A wallet can be connected and its network can be checked.
- Original Chog ownership is verified against the confirmed collection contract.
- A supported on-chain activity can be discovered during a rescan.
- A submitted claim produces a real GenLayer transaction and a visible decision status.
- An accepted claim increases progression exactly once.
- A duplicate claim does not award additional XP.
- A successful evolution visibly changes at least one trait or appearance.
- The evolution history explains which verified claim caused the change.
- The app does not claim that a companion profile changed the original NFT's marketplace metadata.
- An RPC failure or unavailable public source does not cause a false approval.
- The app can recover from a pending or failed adjudication.
- The judge can follow written instructions and repeat the demo.

## 16. Judge demonstration script

Target a concise walkthrough of about three minutes, matching the Chogathon submission page's demo-video guidance.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chogathon.chog.xyz\&sz=32)

Hackathon



## 0:00

Intro

Show the problem

“NFTs can represent identity, but their appearance and utility rarely reflect what their owners do after minting. CHOG Evolution makes verified ecosystem participation change how your Chog looks and what it can do.”

## 0:25

Mint

Mint a demo Chog

Show the NFT's starting appearance, stage, XP, and traits. Explain that the demo collection is separate from the original Chog Genesis collection.

## 0:50

Evidence

Run an ecosystem scan

Show a real supported transaction or a clearly labelled sample scenario, then open its evidence record. Make the source and verification status visible.

## 1:20

Adjudicate

Show GenLayer working

Submit the claim, show the transaction status, and display the final structured decision with its reason. Do not simulate the result as if it were a real GenLayer transaction.

## 1:55

Evolution

Show the before-and-after Chog

Reveal the unlocked trait, new appearance, progression state, and the achievement responsible for the change.

## 2:30

Close

Explain why the NFT matters

Show the Passport or Quest Board and explain that the NFT's identity, earned traits, and evolution history determine the user's experience.

The important visual moment is the actual transition from the starting Chog to the evolved Chog. The important technical moment is proving that the transition followed an accepted evidence decision rather than a hardcoded animation.

## 17. Ready-to-use coding-agent prompt

Once the five references and the repository URL are available, use this as the master implementation instruction for Codex or another coding agent.


# CHOG Evolution PRD — Technical Specification Update

This update expands the PRD in three areas: GenLayer adjudication data flow, prioritized MVP tasks, and error handling/retries. It also incorporates your decision to use your Gemini API key for generating evolved NFT artwork.

One important architectural detail: GenLayer should not directly call Gemini using a secret API key or assume it can make an ordinary authenticated HTTP request. Instead, the backend should orchestrate the handoff. GenLayer evaluates the evidence and produces a structured evolution decision; the backend validates the finalized result, calls Gemini, validates the generated artwork, and saves the updated NFT properties.

That gives us a clear division of responsibility:

- Monad: establishes ownership and provides verifiable blockchain activity.
- GenLayer: decides whether the user qualifies and specifies what evolution they have earned.
- Backend: securely orchestrates adjudication, image generation, persistence, and retries.
- Gemini API: generates the evolved artwork from approved Chog references and the evolution specification.
- NFT/evolution profile: records and displays the resulting properties and image.

## 1. Detailed GenLayer adjudication data flow

1\. User requests a rescan

Wallet, selected NFT, quest or event

2\. Backend discovers candidate evidence

Monad RPC / indexed logs / official event records / supported public evidence

3\. Deterministic verification

Check chain, ownership, transaction receipt, event window, duplicates and quest rules

4\. GenLayer adjudication

Evaluate the normalized evidence against the versioned quest policy

5\. Final decision is validated

Accepted / rejected / needs review, with a reason and earned evolution specification

6\. Backend requests Gemini artwork

Server-side Gemini API key + approved Chog references + validated evolution specification

7\. Artwork and properties are validated

Check image output, permitted traits, NFT identity and metadata consistency

8\. Evolution is committed

Save image, metadata, stage, traits, history and final UI status

### 1.1 Step-by-step processing

Step 1 — Receive the evolution request

The frontend sends a request containing the wallet address, selected collection address, token ID, quest ID, and evidence references. The backend must not accept XP, eligibility, or evolution-stage values supplied by the frontend as authoritative.

The backend creates an idempotency key for the request so that a double-click, browser refresh, or network retry cannot trigger duplicate rewards.

Step 2 — Identify the NFT

The backend confirms the NFT identity and mode:

- Demo NFT: our own deployed collection.
- Original Chog: the verified original collection contract.
- Unsupported or unverified collection: reject the original-Chog path.

For an original Chog, check the current owner using the relevant contract and chain. Ownership must be rechecked before an ownership-sensitive operation is finalized.

Step 3 — Collect and normalize evidence

The backend retrieves the minimum evidence required by the quest. Each evidence item is normalized into a predictable format, such as:

- evidence ID and type;
- chain ID, transaction hash and log index, if applicable;
- wallet address;
- source URL or official event record;
- event timestamp and eligible time window;
- retrieval time and source status;
- content hash or immutable identifier where available.

For social evidence, preserve the original URL and the relevant retrieved content or a hash of it. A social post must not be represented as cryptographically verified merely because a page was accessible.

Step 4 — Run deterministic checks before GenLayer

Do the checks that do not require an intelligent contract first:

- Does the transaction exist and have a successful receipt?
- Is the transaction on the expected chain?
- Does it involve the expected contract or event?
- Is the wallet associated with the claim?
- Does the activity fall inside the permitted event window?
- Has this evidence already earned a reward?
- Is the quest active, and which rule version applies?

Reject claims that definitively fail these checks. Send ambiguous, interpretation-dependent evidence to GenLayer rather than asking GenLayer to redo every basic blockchain query.

Step 5 — Submit a structured claim to GenLayer

The backend prepares a versioned claim payload. It should contain evidence references and the relevant policy, not an unrestricted instruction to “decide whether this user deserves a reward.”

GenLayer evaluates the claim under its Intelligent Contract logic and returns a structured adjudication result. The backend tracks submission and execution status until the result reaches the required finalized state.

Step 6 — Validate the decision

The backend checks that the result:

- refers to the expected claim and quest;
- was produced by the expected deployed contract and execution;
- has reached the required finality/accepted state;
- conforms to the expected schema;
- contains only permitted XP and trait values;
- does not conflict with an already rewarded claim;
- uses the correct policy version.

If the result is `rejected`, `needs_review`, or unresolved, the backend must not start a qualifying evolution.

Step 7 — Build the Gemini request

Only after the claim is accepted does the backend construct an image-generation job. It supplies Gemini with the approved reference images, the current NFT appearance where available, and the evolution instructions returned by GenLayer.

The Gemini API key remains exclusively on the server. It must never be included in browser JavaScript, public configuration, logs, or the NFT metadata.

Step 8 — Validate the generated result

The backend verifies that Gemini returned a usable image and that the image and metadata match the allowed evolution. The model may suggest descriptive properties, but the server should remain authoritative for the token ID, evolution stage, XP, and verified achievement count.

Step 9 — Commit and display the evolution

Persist the generated image, metadata, evolution version, adjudication reference, and audit record. Then update the evolution profile or authorized metadata pointer.

The UI should show a clear progression:

`Evidence verified → GenLayer decision accepted → Generating artwork → Evolution saved`

If the original Chog contract does not allow metadata mutation, the final step updates the companion evolution profile, not the original token's immutable metadata.

## 2. Gemini image-generation integration

Google's current Gemini API supports image generation and image editing with image inputs, so the service can receive approved Chog references and instructions for a new evolution. The official documentation includes the Interactions API and image-generation models such as Gemini 3.1 Flash Image. The model name should be configurable and confirmed against the API access enabled for your key.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ai.google.dev\&sz=32)

Google AI for Developers

+1



### 2.1 The correct handoff

Your intended flow is correct at the product level: GenLayer decides what the user earned, and Gemini generates the evolved image based on those details.

The implementation should be:

1. GenLayer produces the qualifying evolution specification.
2. The backend waits for the GenLayer transaction to reach the required finality.
3. The backend reads and validates the finalized decision.
4. The backend sends the evolution specification and reference images to Gemini using your API key.
5. Gemini returns the generated image.
6. The backend validates and stores the image, creates the new metadata, and updates the evolution profile.

GenLayer has a consensus lifecycle in which an accepted decision can still be appealed. Its documentation explicitly distinguishes acceptance from finality. Therefore, do not trigger irreversible evolution effects solely because a transaction was accepted; wait for the required finalized state.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



### 2.2 What GenLayer should return

GenLayer should return an evolution specification, not attempt to generate the image or independently decide arbitrary metadata values.

Example:

```
{
  "claim_id": "claim_8f12",
  "decision": "accepted",
  "quest_id": "chog_ecosystem_event_01",
  "xp_awarded": 75,
  "evolution": {
    "target_stage": "Explorer",
    "traits_to_add": [
      "Explorer Badge",
      "Cyan Aura"
    ],
    "traits_to_preserve": [
      "Base Chog Identity",
      "Current Body Design"
    ],
    "visual_instructions": [
      "Add an explorer-themed accessory",
      "Add a subtle cyan aura",
      "Preserve the approved Chog silhouette"
    ]
  },
  "evidence_refs": [
    "evidence_93ab"
  ],
  "policy_version": "1.0"
}
```

This is an illustrative schema. The actual contract should use its supported types and a precisely defined return format.

The backend must validate all fields against a server-controlled trait catalogue. GenLayer should not be able to award a stage or trait that does not exist in the approved game rules.

### 2.3 What Gemini should receive

The Gemini image request should contain:

- The approved Chog reference images from your repository.
- The current NFT image, if available and appropriate.
- The validated evolution specification.
- A fixed visual style guide.
- The target image dimensions and format.
- A prompt instructing the model to preserve identity and change only the earned attributes.

A suitable instruction template:

> Use the supplied approved Chog reference images to preserve the recognizable character identity and visual design. Apply only the approved evolution changes listed in the evolution specification. Preserve the base silhouette, facial identity, proportions, and existing traits unless an explicit change is authorized. Do not add unearned accessories, text, logos, extra characters, or unrelated elements. Return one clean NFT artwork image with a consistent composition and background.

Use the actual five references you supply rather than retrieving substitute artwork. Google also advises ensuring that you have the necessary rights to images you upload to its image-generation service.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ai.google.dev\&sz=32)

Google AI for Developers



### 2.4 Gemini's output and NFT properties

There is a distinction between generating an image and updating NFT properties.

Gemini generates the visual asset. The backend should create the authoritative metadata using the finalized evolution decision and the actual image output. Do not let Gemini rewrite the NFT's identity, token ID, verified XP, or ownership.

For example, the backend can construct:

```
{
  "name": "Demo Chog #12",
  "image": "ipfs://<stored-image-cid>",
  "attributes": [
    { "trait_type": "Evolution Stage", "value": "Explorer" },
    { "trait_type": "Aura", "value": "Cyan" },
    { "trait_type": "Accessory", "value": "Explorer Badge" },
    { "trait_type": "Verified XP", "value": 175 }
  ],
  "properties": {
    "collection_mode": "demo",
    "evolution_version": 2,
    "claim_id": "claim_8f12"
  }
}
```

Here, `image` is a placeholder for the actual uploaded asset URI. The server calculates the authoritative attributes from application state.

Recommended image workflow: upload the generated image to durable storage, obtain its content-addressed URI, build the metadata JSON, and store the metadata. Only then mark the evolution as completed. If the original collection does not permit metadata changes, update the companion profile instead.

### 2.5 Protect the Gemini API key

Keep the key in a server-side secret such as:

```
GEMINI_API_KEY=...
GEMINI_IMAGE_MODEL=...
```

Never put the key in a `NEXT_PUBLIC_` variable, frontend source code, client-side requests, logs, GitHub, or public environment files. The browser should call our authenticated backend endpoint; only the backend calls Gemini.

Also implement per-wallet rate limits, generation quotas, output-size limits, and a maximum number of automatic retries. Otherwise, a malicious user could repeatedly trigger expensive image generation.

## 3. Detailed MVP developer tasks and priorities

The MVP should be developed around a complete vertical slice rather than building every page before the backend works.

Priority key: P0 = essential to demonstrate; P1 = important after the core loop works; P2 = post-MVP.

### P0 — Required for a working judge demo

P0

Task 1: Repository, configuration and project skeleton

Owner: Full-stack developer

- Set up frontend, backend, database migrations, and contract directories.
- Create environment-variable validation at startup.
- Add structured logging and error codes.
- Configure the demo mode separately from real blockchain verification.
- Add a `docs/` folder containing the PRD, architecture, API specification, and quest rules.

Acceptance: the app starts locally from documented instructions and refuses to start if required secrets or configuration are missing.

P0

Task 2: Chog reference assets and Gemini rendering service

Owner: Backend / AI integration developer

- Load the five approved references from the provided repository.
- Implement a server-side Gemini client.
- Build a fixed prompt template with explicit allowed and preserved traits.
- Validate image MIME type, size, dimensions, and successful decoding.
- Save generated assets to durable storage.
- Create metadata from authoritative backend state.
- Add a mock renderer for local development so the UI can be tested without consuming Gemini quota.

Acceptance: an approved test evolution produces an image, valid metadata, and an asset record. Gemini failures do not corrupt the existing NFT appearance.

P0

Task 3: Demo NFT and evolution state

Owner: Smart-contract / backend developer

- Deploy the separate demo ERC-721 collection to the chosen network.
- Build the NFT identity model using chain ID, collection address, and token ID.
- Implement XP, stage thresholds, allowed traits, and evolution history.
- Keep the collection mode explicitly set to `demo`.
- Add ownership checks and safe update rules.
- Implement idempotent evolution requests.

Acceptance: a judge can mint a demo Chog and see its state progress without owning an original Chog.

P0

Task 4: GenLayer adjudication contract and client

Owner: GenLayer developer

- Define the versioned claim and evidence schema.
- Implement the contract's eligibility policy and allowed reward catalogue.
- Return structured decisions with a reason and evolution specification.
- Create a backend client for submitting claims and retrieving their transaction status.
- Track the decision through finality rather than trusting the submission receipt.
- Test accepted, rejected, ambiguous, timeout, and appeal-related states.

Acceptance: the platform can show a genuine GenLayer adjudication result, linked to the claim that caused it. A failed or unresolved decision cannot award an evolution.

P0

Task 5: Evolution orchestration worker

Owner: Backend developer

- Create a durable job when an eligible claim is finalized.
- Validate the decision and deduplicate the claim.
- Construct the Gemini image request.
- Save the image and metadata.
- Update the evolution profile only after successful validation.
- Record the GenLayer transaction, Gemini model, asset URI, and version.
- Expose job status to the frontend.

Acceptance: the complete path—claim, finalized decision, Gemini image, metadata, evolution history—works end to end.

P0

Task 6: Judge-facing frontend

Owner: Frontend developer

- Build Home / Evolution Lab.
- Build the evidence submission screen.
- Show GenLayer transaction and decision status.
- Show the Gemini rendering state.
- Display before-and-after artwork.
- Show the exact unlocked traits and evidence.
- Provide a labelled demo scenario and reset instructions.

Acceptance: the judge can follow the flow without developer intervention or needing to inspect logs.

### P1 — Add once the complete evolution loop works

- Verify original Chog ownership against the confirmed collection contract.
- Implement incremental Monad rescan with checkpoints.
- Add the event and quest registry with official source URLs.
- Add the X bio-code account-linking flow.
- Add public social evidence submission where technically supported.
- Add a review queue for uncertain claims.
- Add richer art versions, more trait combinations, and a shareable Chog Passport.
- Add an admin interface for quest rules and event updates.

### P2 — Defer until after the hackathon MVP

- Arena battles or competitive challenges.
- Complex crafting and trait-combination systems.
- Automated coverage of many social platforms.
- Mainnet production minting if the demo can use a test network.
- Optional $CHOG integrations that introduce extra contract, security, or token-economics complexity.
- Advanced animations and high-resolution generation variants.

### Developer priority order

The critical path is:

1. Agree on the evidence schema and evolution specification.
2. Build the GenLayer decision path.
3. Build the Gemini rendering worker.
4. Build the demo NFT state and persistence.
5. Connect the steps into one reliable vertical slice.
6. Polish the judge-facing UI.
7. Add real ecosystem scans and broader integrations.

Do not build the full rescan system first. A small, real, supported quest that successfully causes a Chog to evolve is a stronger MVP than a large scan dashboard that never reaches a completed evolution.

## 4. Error handling and retry mechanisms

The central reliability requirement is that a failure at any stage must not award the same achievement twice, erase the previous NFT appearance, or cause an unqualified user to evolve.

Use a durable job queue and explicit state transitions rather than a single long-running API request that performs everything synchronously.

### 4.1 Evolution job state machine

QUEUED

Request persisted; idempotency key assigned

VERIFYING_EVIDENCE

Deterministic checks and evidence normalization

AWAITING_GENLAYER

Track the actual Intelligent Contract transaction

DECISION_FINALIZED

Accepted decision validated; rejection terminates the reward path

GENERATING_ARTWORK

Gemini job running with a persisted request ID

PUBLISHING_METADATA

Store image and metadata; verify both are readable

COMPLETED

New version committed; history and UI updated

RETRYABLE / NEEDS_REVIEW / FAILED

Retry transient errors; route ambiguous claims for review; retain the last valid state for permanent failures.

The actual implementation should define legal state transitions in code and the database. A worker must not skip from `AWAITING_GENLAYER` directly to `COMPLETED`, for example.

### 4.2 Failure handling by component

| Component                 | Typical failure                                         | Required behavior                                                                  |
| ------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Wallet / NFT verification | Wrong chain, RPC timeout, contract unavailable          | Prompt network switch or retry reads; do not treat unavailable as verified         |
| Monad scanner             | Rate limit, partial block range, provider error         | Back off, split the range, retain checkpoint, resume from the last confirmed block |
| Evidence collector        | Deleted post, inaccessible page, missing event record   | Mark source unavailable; do not turn missing evidence into approval                |
| GenLayer submission       | Submission times out before transaction ID is received  | Reconcile by request/idempotency record before resubmitting                        |
| GenLayer consensus        | Pending, timeout, undetermined, or appeal               | Keep the claim pending; query lifecycle/status; do not generate or award yet       |
| GenLayer decision         | Rejected or invalid result schema                       | Reject the reward path or flag for review; retain the raw decision record          |
| Gemini API                | 429 rate limit, 5xx, network timeout                    | Retry with exponential backoff and jitter, respecting rate-limit instructions      |
| Gemini output             | No image, invalid MIME type, malformed bytes            | Mark attempt invalid; retry within a strict limit or send to review                |
| Image validation          | Wrong character identity, unapproved trait, poor output | Retry with a constrained edit prompt; never commit invalid output                  |
| Asset storage             | Upload timeout or inaccessible URI                      | Retry upload; check for an existing asset before uploading again                   |
| Metadata publishing       | Image exists but metadata upload fails                  | Resume metadata publishing without regenerating the image                          |
| Final state update        | Database conflict or server restart                     | Reload the persisted job; use a transaction and compare-and-set version check      |
| Original NFT update       | Contract cannot mutate metadata                         | Complete the companion profile path; do not claim native metadata changed          |

### 4.3 Retry policy

Use a shared retry helper with per-service configuration. Suggested initial defaults—not provider guarantees—are:

| Failure                       | Initial retry policy                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Transient RPC errors          | Up to 5 retries with exponential backoff and jitter                                                                          |
| HTTP 429                      | Respect `Retry-After` when present; otherwise back off                                                                       |
| HTTP 5xx from Gemini          | Up to 3 retries, then mark retryable and defer                                                                               |
| Gemini timeout                | Check whether a result was persisted before submitting another generation request                                            |
| GenLayer still pending        | Poll transaction status with increasing intervals; use a maximum waiting threshold for the UI, not as an automatic rejection |
| GenLayer timeout/undetermined | Follow the documented transaction lifecycle and appeal/finality behavior; never assume it means rejected or accepted         |
| Invalid generated image       | One constrained regeneration attempt, then review or failure                                                                 |
| Permanent validation error    | No automatic retry until the evidence or configuration changes                                                               |

For example, a worker can use delays of roughly 1, 2, 4, 8, and 16 seconds plus jitter for a short transient retry sequence. Long-running jobs should switch to scheduled retries rather than hold a worker open.

Do not blindly retry every failure. Authentication errors, invalid contract addresses, unsupported models, malformed payloads, and invalid quest rules require correction, not repeated requests.

### 4.4 GenLayer-specific retry behavior

GenLayer is a consensus workflow, not an ordinary HTTP request whose response is always immediately available. Its documented lifecycle distinguishes the EVM submission receipt from the Intelligent Contract transaction status and finalization.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



Implement the following:

1. Persist the claim ID, submission transaction hash, Intelligent Contract transaction ID, and current status.
2. If the submission call times out, reconcile the transaction before creating another claim.
3. Poll the appropriate GenLayer status/lifecycle endpoints with backoff.
4. Treat accepted-but-not-finalized results as provisional.
5. Follow the documented appeal/finality process; do not set an arbitrary timer and assume finality.
6. If the decision is rejected, do not start Gemini generation.
7. If the result is undetermined or times out, retain the claim and surface a pending/review state.
8. Resume polling after a server restart from the persisted transaction ID.

A GenLayer transaction can be accepted at consensus and still be appealed, so downstream effects that are difficult to reverse should wait for finalization.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



### 4.5 Gemini-specific retry behavior

For every Gemini job, persist:

- evolution job ID;
- claim ID;
- idempotency key;
- model name and version/configuration;
- prompt-template version;
- reference-image hashes;
- generation attempt count;
- provider request/response identifiers where available;
- image validation result;
- stored image URI and content hash;
- last error code and next retry time.

When a Gemini request fails, distinguish between a confirmed failure and an uncertain outcome. A network timeout does not necessarily prove that the provider did not process the request. Before generating again, check whether the image or completed output for that job has already been saved.

Do not assume Gemini provides exactly-once execution for our application-level job. Our own backend must provide idempotent persistence.

### 4.6 Prevent partial commits

Image generation and metadata publishing are separate operations. They should not be treated as one atomic transaction.

Use this commit sequence:

1. Save the finalized GenLayer decision.
2. Create the artwork job.
3. Generate and validate the image.
4. Upload the image and verify its URI.
5. Build metadata from the validated evolution state.
6. Upload and verify metadata.
7. Update the evolution profile in a database transaction.
8. Mark the job complete and expose the new image.

If step 5 or 6 fails, resume from that stage. Do not regenerate the image unless the stored image is actually unusable.

If an on-chain metadata pointer must be updated, treat that as a separate blockchain transaction with its own pending/confirmed state. Keep the old valid pointer until the new target is ready.

### 4.7 Idempotency and concurrency

Use a unique evolution key such as:

```
claim_id + nft_identity + evolution_rule_version
```

The NFT identity must include:

```
chain_id + collection_address + token_id
```

Use database uniqueness constraints to prevent the same claim from being rewarded twice. Use row locks or optimistic concurrency checks when two workers attempt to evolve the same NFT simultaneously.

The update must verify the expected prior evolution version before writing the new one. If another worker has already advanced it, the stale worker should reload the current state and reconcile rather than overwrite it.

### 4.8 User-facing statuses

Users should see actionable messages, not raw infrastructure errors.

- Scanning: “Checking supported ecosystem activity.”
- Awaiting adjudication: “Your evidence has been submitted to GenLayer.”
- Decision pending finality: “The decision is awaiting final confirmation.”
- Generating artwork: “Your evolution is approved. Creating your new Chog appearance.”
- Publishing: “Your artwork is ready. Saving the new evolution record.”
- Completed: “Your Chog has evolved.”
- Retrying: “This step encountered a temporary problem. We’ll retry automatically.”
- Needs review: “We couldn’t verify this evidence automatically.”
- Failed: “The evolution could not be completed. Your previous appearance is safe.”

Do not expose API keys, stack traces, internal prompts, private RPC credentials, or raw provider errors in the frontend.

## 5. API endpoints and background jobs

The backend should expose a small, explicit API surface. These are proposed application routes, not existing provider endpoints.

| Endpoint                              | Purpose                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/evolution-requests`        | Start a new claim/evolution workflow                                                   |
| `GET /api/evolution-requests/:id`     | Return current workflow status                                                         |
| `POST /api/evidence/scan`             | Start or resume an ecosystem scan                                                      |
| `GET /api/evidence/scan/:id`          | Return scan progress and results                                                       |
| `POST /api/claims/:id/submit`         | Submit an eligible claim for adjudication                                              |
| `GET /api/claims/:id`                 | Retrieve claim status and evidence                                                     |
| `POST /api/internal/genlayer-webhook` | Optional authenticated notification receiver, if a supported integration is configured |
| `POST /api/internal/evolution-worker` | Internal worker entry point, protected from public use                                 |

The workflow should run in durable background jobs. A frontend request should create the job and return its ID; the frontend can then poll for progress or subscribe to updates.

### Required worker jobs

- `scan_wallet_activity`
- `normalize_evidence`
- `submit_genlayer_claim`
- `poll_genlayer_finality`
- `generate_chog_artwork`
- `validate_generated_artwork`
- `publish_nft_metadata`
- `commit_evolution_state`
- `reconcile_stalled_jobs`

A reconciliation worker is important: if the server restarts after GenLayer finalizes but before Gemini is called, the system must find the incomplete job and resume it.

## 6. Database changes for this architecture

Add an `evolution_jobs` table rather than trying to infer the entire workflow from claim status.

| Field                      | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `id`                       | Unique evolution job ID                       |
| `claim_id`                 | Claim that triggered evolution                |
| `nft_identity`             | Chain, collection and token ID                |
| `status`                   | Current state-machine stage                   |
| `genlayer_tx_id`           | Intelligent Contract transaction identifier   |
| `genlayer_status`          | Latest adjudication/finality state            |
| `evolution_spec`           | Validated, structured evolution specification |
| `gemini_model`             | Configured image-generation model             |
| `prompt_version`           | Version of the approved art prompt            |
| `generation_attempts`      | Number of image-generation attempts           |
| `image_uri`                | Stored artwork location                       |
| `image_hash`               | Content hash of the final artwork             |
| `metadata_uri`             | Stored metadata location                      |
| `previous_version`         | Evolution version before the job              |
| `new_version`              | Version produced by the job                   |
| `last_error_code`          | Machine-readable error                        |
| `next_retry_at`            | Scheduled retry time                          |
| `created_at`, `updated_at` | Audit timestamps                              |

The evolution job, claim, and evolution-history records should reference each other. This allows the app to explain exactly which evidence led to a decision, which decision authorized Gemini generation, and which generated image became the NFT's next version.

## 7. MVP definition of done

Before the team expands into more ecosystem events, the following end-to-end scenario must work:

A judge mints a demo Chog.

The judge submits evidence for a supported quest.

The backend verifies objective facts and submits the claim to GenLayer.

The application waits for the required finalized adjudication result.

GenLayer returns an accepted evolution specification.

The backend uses your Gemini API key to generate the evolved Chog artwork.

The backend validates the image and creates authoritative NFT metadata.

The new artwork and evolution history are persisted and displayed.

Repeating the same request does not award duplicate XP or create a second evolution.

### Final architecture decision

Your intended sequence is now:

Verified activity → GenLayer adjudication → finalized evolution specification → Gemini image generation → backend metadata update → evolved Chog displayed.

The key distinction is that GenLayer authorizes and describes the evolution; Gemini creates the artwork; and the backend validates and persists the resulting NFT properties. That division keeps the process auditable, protects your API key, and makes the demo resilient when any external service fails.

Two official references for implementation:

- [GenLayer transaction lifecycle and finality](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions?utm_source=chatgpt.com) — how to track an Intelligent Contract decision correctly.&#x20;

  [image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

  GenLayer Documentation

  +1

- [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation?utm_source=chatgpt.com) — supported image-generation models, image inputs, output handling, and API examples.&#x20;

  [image](https://www.google.com/s2/favicons?domain=https://ai.google.dev\&sz=32)

  Google AI for Developers

  +1


# CHOG Evolution — Updated PRD & Build Blueprint

Version 2.0 · Chogathon · GenLayer + Monad · Updated 17 October 2026

The biggest change is that we are no longer building just an NFT that changes its appearance. We are building a usable platform where people connect their wallets, prove what they have done in the CHOG ecosystem, earn evolution progress, and watch their Chog evolve.

And your clarification solves an important practical problem: you do not own one of the original 1,969 Chog NFTs, so we should not make the demo depend on buying one or having permission to change the original collection's contract.

The updated plan has two NFT modes:

- Demo Chogs: NFTs we mint in our own test collection, with original, clearly labelled Chog-inspired artwork based on the five authentic reference NFTs you will supply. These let judges test the complete experience without owning an original Chog.
- Existing Chogs: A separate integration mode that detects and verifies authentic NFTs held in a user's Monad wallet. We support their evolution through the original collection only if its contract allows it; otherwise, our platform provides a companion evolution profile without falsely claiming to have changed the original NFT.

This distinction is essential. We can build and demonstrate both modes, but we must not present a mock NFT as an authentic member of the original 1,969-token collection.

## 1. Product overview

# CHOG EVOLUTION

Your activity shapes your Chog. Your Chog becomes your history.

[Chog (@ChogNFT) on X](https://images.openai.com/static-rsc-4/w0MYksWMG7lw4o0JwSLPS1OSg4oSt5tmMIuavveD80HEbf2CgpGVBFdciGGBS4PZvBsstOjJnfmPe5lXkeYe6ba9ZpSAfT_0ZAn5yZjb4MhLp6wPeiNSC5E9HfLKlUzOUVhlwJfcCfF9ZDKOhHIdArSKAmdmGAONGnzps05hOBY?purpose=inline)

[x.com](https://x.com/ChogNFT?utm_source=chatgpt.com)

Visual direction only. The final interface must use the actual Chog reference artwork from your repository, not substitute generic frog art.

Product concept: A gamified CHOG ecosystem companion where each Chog is a persistent digital identity. Its attributes, visual form, abilities, and utility evolve based on verifiable on-chain activity and validated participation in the wider ecosystem.

The problem: NFT ownership alone does not guarantee that people keep using an NFT. Community contributions, participation in events, and on-chain activity are often scattered across wallets, social platforms, and individual project sites.

Our solution: A platform that turns this activity into a persistent, visible evolution journey, using GenLayer to evaluate evidence that requires judgment, while deterministic code verifies objective facts wherever possible.

The project is designed around the Chogathon's stated challenge: invent a new NFT experience in which the NFT is essential, and demonstrate novelty, fun, retention, clarity, and execution. The published judging weights are 30%, 20%, 20%, 15%, and 15%, respectively; meaningful $CHOG integration is a bonus.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chogathon.chog.xyz\&sz=32)

Hackathon



### Product goals

- Let a judge try the full experience without owning an original Chog NFT.
- Let actual Chog holders connect their wallets and verify ownership on Monad.
- Let users rescan their ecosystem history and discover eligible activity.
- Turn accepted activity into transparent, explainable NFT evolution.
- Demonstrate a real GenLayer decision, not merely use an AI model to write descriptions.
- Make the Chog's evolution affect how it is used in the application, not just how its picture looks.

### Non-goals for the first release

- Modifying the original Chog collection without permission or contract support.
- Claiming that a demo NFT is one of the original 1,969 NFTs.
- Automatically proving every X like, follow, or view without reliable evidence.
- Supporting every Monad project, event, and social platform from day one.
- Making users pay for an NFT just to experience the judge demo.

## 2. NFT model: two modes, one platform

[Credit Runner](https://images.openai.com/static-rsc-4/Da1PYhO6luTIIUj42ZiQV2B1mgADmB26Z4zMArYEHZnRTXYGEy-ayA9UETGLrnRmY0ozEyqqC20P7C3fOt3oRGjMDFP-lj9UHb2ompQhI-UXXpnfOzBUZZI2pCtgvcdtT286E0Zmd3gXpBBGrqdYoGNocVMrh_hNhZ9e-KjhSvc?purpose=inline)

### Mode A — Demo Chog

Required for the demo

A separate NFT collection that we control. Users can mint a demo Chog and immediately use it in the evolution platform. It has its own contract address, token IDs, ownership history, and metadata.

The five authentic reference NFTs guide the visual design. The resulting art must be clearly labelled as original demo artwork, not copied and represented as official collection tokens.

[X](https://images.openai.com/static-rsc-4/79CFki5vAcefq-SyWBwLDlElhyXDZ3Ypy9-9BzWeDp9_7mHMI5U5tTY_CWNcNevlD1x3OiJ2on4zJG5ghA86UnkgBNjlBedgMs1DlbnEgFQ9Zr-u6glKVS-hNLOZZK4dM6MDnpogY2sqBxOdtVtblhIHJhuSztEnZzF4rXJvfD0?purpose=inline)

### Mode B — Original Chog

Holder integration

The app detects an authentic Chog by checking its verified collection contract and the connected wallet's token balance. The user receives an evolution profile linked to that original token.

Changing the original token's image or metadata requires support from its contract or an authorized integration. Otherwise, the evolution lives in our companion platform.

### Important collection rules

1. The original Chog collection is understood to contain 1,969 unique NFTs, based on the project information provided. The exact collection contract address, token standard, and metadata behavior must be confirmed before implementation.
2. Our demo collection must have a different contract address and must never reuse original Chog token IDs as if they belonged to the official collection.
3. A wallet may own both types. The UI must always display the correct mode and collection identity.
4. Evolution progress should follow the NFT's token identity, not simply the current wallet address. If an NFT is transferred, we must define how its progress behaves.
5. We should preserve the original artwork and collection metadata of authentic Chogs unless an authorized, contract-supported update is available.

Recommended default: Make demo minting the judge's first experience. Build authentic ownership verification as a separate, real integration—not as a requirement for using the app.

## 3. The platform judges will use

The site should feel like a playable NFT experience rather than a dashboard full of blockchain terminology.

[Dashboard Profile by Jenny Mia on Dribbble](https://images.openai.com/static-rsc-4/Jy6qmD1gvEDyYtYbMAc2F_mSwshv5u4JCYyE7_Q1m5JnKljunok6WyF05zQONAdf8lPN5z1k_REpBaknAKr17pRi5jedRDIdRbE7QulvHpdo38vIUv-Xe0YrKgGUqtuAiN2E6DpT7hRIY6tZtBy2SUm4nvgRCL9TDa-UY4J9N8M?purpose=inline)

A. Home / Evolution Lab

- See the active Chog and its current evolution stage.
- See level, XP, traits, abilities, and recent achievements.
- View the next evolution milestone.
- Choose Mint Demo Chog or Connect Existing Chog.

[Introducing the New Layer3 Quest Experience | Layer3 Blog](https://images.openai.com/static-rsc-4/M8VEpOCcKPG-PHVMZ6P8ICZypXMs6Rp8yfEYkJjwSB_qB-u1SIEgvWUNraY_qGe1CJ_9V7V9JHsj88vrmTksqQxZNe-tIf3yGXn2bVjCkNoGegrSkDtzJ38t-RJrFB47mCqwooTIcjogKUrSEAgfh9QNb3Ehne7Ogn1QQ7PiVTU?purpose=inline)

B. Quest Board

- Browse available ecosystem quests.
- See exactly what counts as valid evidence.
- Submit a transaction, event claim, public post, or other supported evidence.
- Track pending, accepted, rejected, and review-needed submissions.

[Debank — Most Powerful Tool in DeFi | Web3 App Review | by Ty Cooper | Coinmonks | Medium](https://images.openai.com/static-rsc-4/Njr_oHxg-dXEGVv59T1TAUzmz0GQuH-BVg4yYf0xIPLRWJo9MwNSlXGWydWWkCJNYWrEiT6mLeBphc1xXPLQx2lTmhfQsH3FR5oGvTlUvVFS_33pC7toIHY5YxKJsb4N_AjLJEPUSaRxIm5GZXiICEWHVzPN3wLa2_PGeHLnuB8?purpose=inline)

C. Ecosystem Rescan

- Scan wallet activity on Monad.
- Match eligible transactions against known event and quest rules.
- Find claimable past achievements.
- Show evidence links, time windows, and why each activity qualifies.
- Let users rescan after new events or integrations are added.

[Claynosaurz (@Claynosaurz) on X](https://images.openai.com/static-rsc-4/QZwvpOqX0SVTwpDpci2ZZDgRzxg4yJouaAwCinAZfhZDeL3EvVVNWFCziSmSPlGyMhGOjARMgiIiMKf_NDoiVD5Fc-zFlCXLz_EOGu4vFDQk1fMFmoWVxItCNSfumWZeZBFIJf_FqjDKeDeK9ktx0Lc0Jfqo1oKkOE6Jta4hpEU?purpose=inline)

D. Evolution Chamber

- Preview the next form before committing.
- Display the exact achievements that unlocked it.
- Explain each changed trait.
- Allow a user to trigger an eligible evolution.
- Show the transaction and the final evolution result.

[Profile & Rewards | UI/UX Gaming web design by Alejandro Mejía Villa on Dribbble](https://images.openai.com/static-rsc-4/URWNaWR6LFUTuanO8PjEGA-uHl3eBq1vFmOg6pmiz6ecKw0McOMRHFEfkJRrM1MP15QS5-XtsckAa8_ag5tOiqPMmwsykRFBBiFp9pC8a1pRNE_J6TfhP0tEfUAQvX9nlrRXU5fyAHjb5UtZ8nTcxm7pAwm_i37Bw7-WyfBhbXs?purpose=inline)

E. Chog Profile / Passport

- Display the NFT's evolution history and verified achievements.
- Separate verified on-chain facts from community or social evidence.
- Share a public profile and an evidence-backed achievement card.
- View the NFT's history even after returning to the app later.

These are design references for the UI direction, not representations of the actual Chog collection. Actual NFT artwork must come from your reference repository and the rendering pipeline.

### The core judge demo

A judge should be able to:

1. Open the site and mint a demo Chog.
2. Complete a starter quest or load a clearly labelled demo evidence scenario.
3. Submit the evidence for validation.
4. See GenLayer return a structured decision with an explanation.
5. See the Chog gain XP and unlock a trait or evolution.
6. Preview the new appearance and save the resulting evolution state.
7. Open the history and verify which evidence caused the change.

A demo scenario must be visibly labelled as simulated. It should prove that the workflow works without pretending that simulated activity happened on the real blockchain.

## 4. What actually makes the NFT evolve?

The system needs a clear relationship between activity, proof, progression, and the NFT's appearance.

### Evolution loop

1\. Connect or mint a Chog

Original collection or our demo collection

2\. Discover ecosystem activity

Wallet history, quest submissions, event records and public evidence

3\. Verify evidence

Deterministic checks first; GenLayer judgment where interpretation is needed

4\. Award XP and unlock traits

Rules-based progression, anti-duplicate checks and an auditable decision

5\. Evolve the Chog

Generate or compose a new appearance, save the version, display the result

### Proposed progression system

For the first version, use five stages. Stage names can change later.

| Stage        | Example unlock requirement                   | Possible visual change                                    |
| ------------ | -------------------------------------------- | --------------------------------------------------------- |
| 1. Hatchling | Mint or register a Chog                      | Starting appearance                                       |
| 2. Curious   | Complete the onboarding quest                | Eye or expression variant                                 |
| 3. Explorer  | Verify ecosystem participation               | Accessory or background                                   |
| 4. Veteran   | Earn several distinct achievements           | Body, outfit, aura or visual effects                      |
| 5. Legend    | Complete a high-value milestone or quest set | Rare combination, animated presentation or signature aura |

These are proposed game rules, not claims about existing Chog lore.

### XP and trait rules

Start with a simple, auditable points system:

- Verified on-chain action: 10–50 XP, depending on the action.
- Verified event participation: 25–100 XP.
- Verified contribution or completed ecosystem quest: 25–150 XP.
- Repeated low-value activity: diminishing rewards or a daily cap.
- A single piece of evidence can only be credited once for the same quest.
- A user cannot gain XP merely by refreshing the scan button.
- High-value or ambiguous claims require stronger evidence or manual review.

The backend should calculate eligibility from explicit rules. GenLayer is used when a claim requires interpretation, such as determining whether submitted public evidence genuinely demonstrates participation in a defined activity.

Critical design rule: GenLayer should not be asked to invent the score, the evidence, and the trait at once. The contract should receive evidence references and clear rules, then return a structured decision such as:

- `accepted` or `rejected`
- quest identifier
- XP awarded
- reason code
- evidence hash or identifier
- progression unlock, if any

GenLayer's design is well suited to decisions that require interpretation of web data or natural-language evidence, provided validators can independently inspect the underlying material and the contract has explicit verification criteria.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



## 5. The ecosystem rescan feature

This is a major feature, not an optional button. It can become the main way users discover that their Chog has earned something.

### User journey

1. User connects a wallet.
2. The app identifies whether the wallet holds an authentic Chog, a demo Chog, or both.
3. The user opens Ecosystem Rescan.
4. The app scans supported on-chain activity and checks a maintained registry of eligible events and quests.
5. The app presents a list of discovered claims, each with evidence and a confidence/status label.
6. The user chooses which claims to submit.
7. Each claim is checked for eligibility and duplication.
8. Accepted claims update XP and unlock the relevant evolution progress.

The app must show the difference between:

- Found: activity detected but not yet checked against a quest.
- Eligible: objective rules indicate that the activity qualifies.
- Submitted: evidence has been sent for adjudication.
- Verified: the required verification has succeeded.
- Rejected: the evidence does not satisfy the published criteria.
- Needs review: evidence is ambiguous or an external source is unavailable.

A scan should never silently award XP for an unverified claim.

### Data sources for rescanning

A. Monad on-chain data — highest priority

Transactions, contract interactions, token/NFT ownership, and event logs where the relevant contract emits suitable events. This is the most reliable starting point for proving wallet activity.

B. Ecosystem event registry

A database of specific campaigns, event dates, participating contracts, quest rules, official announcements, and accepted evidence types. The app scans against known rules rather than pretending it can automatically recognize every ecosystem event.

C. Public social evidence

User-submitted links to public posts, event recaps, public photos, or other supported sources. We can fetch public pages where technically and legally available, but a visible post alone may not prove that the person attended an event or performed a particular action.

D. Official event attestations

Where possible, organizers can publish signed participant lists, issue claim codes, or provide an official verification endpoint. These can provide stronger proof than screenshots or scraped pages.

### Event registry schema

Each supported event or quest should have:

- `event_id`
- event name and description
- official source URLs
- start and end time
- supported chain and contract addresses, if applicable
- eligibility rules
- evidence types accepted
- reward and XP values
- maximum claims per wallet
- one-time or repeatable status
- verification method
- review/fallback procedure
- date last verified by the team

The registry is how we make rescan useful beyond the hackathon. When a new verified event is added, existing users can rescan and potentially discover new achievements without the team rewriting the application.

## 6. Recent CHOG ecosystem research and event verification

The project should start with a small, high-quality list of supported activities instead of claiming to cover the entire ecosystem immediately.

The following are useful research leads from public sources. They are not yet a definitive list of quests we can award.

[hosythoang (@yoshinokuna) on X](https://images.openai.com/static-rsc-4/aH2qTYPXxPb-SKy7NB3ZgFig4wNJIyvwLh7l7_oEOZMsPAi--FCNDFPBwRI5sbb4dQx-EQk55Vl3-kqcBygs5h6ZmWjxU03qTnrKX2AwbMjBjWYUZFLliANY0Kw1wjftNK6ZpQ3hHVtb2SEujsebJl-VXoebO4-qv699gPKpGoc?purpose=inline)

Chogtober 2026

The public Chogtober site describes a multi-day program introducing participants to Monad and projects in its ecosystem, including a set of Chog-focused missions. This is a strong candidate for an event-registry entry if we can recover official mission definitions and establish how each completion was recorded.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chog.zone\&sz=32)

Chog



Verification plan: identify the official campaign and mission pages, then check whether each mission exposes on-chain transactions, claim records, account-based completion, or organizer attestations.

[Monad Community App](https://images.openai.com/static-rsc-4/mjTdYfZCBW6l2gAHbsXTvUtZDVgNnwk0IYfcUPOoEQLzrxPf3qF3gT5JKV_SX-rHUlAikuUMSyh5a-PZOuLUmkJam8OpWoyKgbX2aEU_J7R0QAV4OYehkxqrEH1h7dRFP682Uapb3YRZ3UxukVV25BXn3QcFqZqWx55AwsV7COE?purpose=inline)

Chog Genesis collection

OpenSea currently lists a collection named Chog Genesis on Monad with a supply of 1,969, consistent with the collection size you've described. The collection page and individual NFT records provide a starting point for verifying the collection identity and inspecting token traits.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://opensea.io\&sz=32)

OpenSea

+1



Verification plan: confirm the official collection contract address, ERC-721 behavior, token metadata, and whether the contract permits any authorized metadata changes. Do not infer these capabilities from the marketplace display alone.

[Monad Blitz Lagos · Luma](https://images.openai.com/static-rsc-4/as-pjl3YqTW4LXIWxFEZCNSY4TSiFmfzr7sE8Xa5b4b3Wb7foRsOREH3m1ZDviPe0fd2wWfJV34H-UFVRxPsUptDMGCWNEVMaEEkp28Nd1erXxDX_ZmANiBRTsWI6FV7xuLc9_wI_wjwNw0DUglqFICFq3xADFSlvycrbqWz-PQ?purpose=inline)

Monad ecosystem builder events

Public event listings document Monad ecosystem activities, including Monad Blitz Lagos in April 2026. This is an example of the kind of ecosystem event that could eventually be represented in the registry, but it should only reward users when there is an evidence source linking the participant to the event.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://luma.com\&sz=32)

Luma



Verification plan: use official registration/completion records, participant attestations, or accepted public evidence. A wallet's existence or a social post about the event alone is not proof of attendance.

### Research task for implementation

Before launch, the research agent must:

1. Search the official Chog website, official Chog social accounts, official Chog Discord announcements accessible to the team, Chogathon pages, and official ecosystem campaign pages.
2. Identify recent or active events and quests, with exact dates and the official announcement URL.
3. Find the actual completion signal for each event: contract event, transaction, official claim page, verified account record, organizer list, or other evidence.
4. Classify each event as automatically verifiable, user-submitted evidence, organizer attestation required, or not verifiable.
5. Add only events with documented rules to the initial registry.
6. Record the last verification date and recheck links before accepting claims.

Do not make up events, participation criteria, contract addresses, or historical completion records. If a recent event has no publicly verifiable completion signal, the platform may list it as an unsupported/manual-review activity, but it must not award automatic XP.

## 7. X account linking without a paid X API

Your proposed bio-code method is a reasonable low-cost way to verify control of a public X account, with some limitations.

### Account-linking flow

1. The user enters an X handle.
2. The app generates a unique, temporary code, for example `CHOG-LINK-7K4P2`.
3. The user adds the code to their public X bio.
4. The user submits their public profile URL.
5. The app checks whether the exact code is visible on that profile.
6. If confirmed, the user can remove the code. The app stores the verification time and account mapping.
7. The app periodically rechecks account ownership only when needed, rather than requiring the code to remain in the bio forever.

The code should expire, be single-use, and be bound to the wallet session or account-linking request. A profile link alone is not enough.

### What this proves—and what it does not

| Claim                                                         | Bio code alone proves it?                                |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| The user could edit the public X profile at verification time | Yes, if the code is correctly checked                    |
| The user owns the wallet                                      | No; verify wallet control separately                     |
| The user liked a post                                         | No                                                       |
| The user attended an event                                    | No                                                       |
| The user published a specific post                            | Not unless the post is independently located and checked |
| The account still belongs to the same person months later     | No; ownership can change                                 |

### Public post evidence

The app can accept a public post URL and try to retrieve the post and its visible content. For a claim about event participation, the system can inspect:

- whether the post exists and is public;
- its author and timestamp, where available;
- whether the text or media appears to match the event's published criteria;
- whether the event date and claim window match;
- whether the same evidence has already been claimed.

But a scraper is not a substitute for a reliable social API. X may block automated requests, change its HTML, limit visibility, or make certain engagement data inaccessible. Likes and private account activity generally cannot be assumed verifiable through public-page scraping.

### Recommended evidence policy

- Use blockchain events and official completion records for automatic XP wherever possible.
- Use X bio verification only for linking a social account.
- Use public post evidence for claims that can genuinely be supported by the post.
- Use signed organizer attestations or manual review for event attendance that cannot be established otherwise.
- If evidence cannot be fetched or independently checked, return `needs_review` or `source_unavailable`, not an invented approval.
- Avoid storing unnecessary personal data or collecting private social content.

This keeps the app functional without paid X API access while making clear which achievements are strongly verified and which are supported by weaker public evidence.

## 8. Technical architecture

The application should have four distinct responsibilities: frontend, backend/indexer, GenLayer adjudication, and NFT contracts/storage.

Frontend — Evolution Platform

React/Next.js · wallet connection · quest board · rescan · evolution UI

Backend API + Evidence Indexer

Quest registry · Monad RPC · event matching · evidence storage · cache · rate limits

Monad

Ownership, transactions, NFT state

GenLayer

Evidence adjudication and accepted decisions

Evolution State + Art Pipeline

XP, levels, traits, image composition, metadata, history

### Recommended stack

| Layer                    | Recommendation                                    | Why                                                                 |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- |
| Frontend                 | Next.js + TypeScript                              | Fast development, clear page structure and API integration          |
| UI                       | Tailwind CSS + a consistent component system      | Rapid, cohesive visual implementation                               |
| Wallet                   | EVM-compatible wallet connector                   | Connect to Monad and sign ownership-related requests                |
| Blockchain reads         | Viem or equivalent EVM library                    | Contract reads, logs and transaction inspection                     |
| Backend                  | Next.js API routes or a separate Node.js service  | Evidence orchestration, caching and integrations                    |
| Database                 | PostgreSQL, optionally Supabase                   | Users, quests, claims, scan checkpoints and evolution history       |
| Evidence/art storage     | Object storage + IPFS for durable public metadata | Keep evidence and NFT metadata separate from the application server |
| Intelligent adjudication | GenLayer Intelligent Contract                     | Consensus-backed decisions for ambiguous evidence                   |
| NFT contracts            | Solidity + OpenZeppelin                           | Mintable demo ERC-721 and optional companion profile contract       |
| Rendering                | Deterministic trait composition first             | Consistent character identity, repeatable images and low cost       |

These are proposed implementation choices, not mandatory services. Keep the initial system small enough to build and demonstrate within the hackathon window.

### Monad connection: public RPC first, private RPC later

Monad's mainnet uses chain ID `143`, with `MON` as its native currency. The Monad developers' public resources list `https://rpc.monad.xyz` as a mainnet RPC endpoint.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Recommended configuration:

- `MONAD_CHAIN_ID=143`
- `MONAD_RPC_URL` — use the public RPC initially.
- `MONAD_EXPLORER_BASE_URL` — configure the current official explorer.
- `CHOG_GENESIS_ADDRESS` — set only after confirming the collection contract.
- `DEMO_CHOG_ADDRESS` — the address of our own deployed demo collection.
- `GENLAYER_CONTRACT_ADDRESS` — populate after deployment.

Keep all endpoints and contract addresses in environment configuration rather than hardcoding them across the codebase.

RPC versus explorer API: these are related but different services.

- RPC provides direct blockchain access, such as `eth_call`, transaction receipts, block numbers and event logs.
- An explorer API may provide indexed transactions, NFT holdings, contract labels and human-readable links.
- An explorer API is convenient, but it is not a replacement for the blockchain's underlying state.

Use RPC as the primary source for critical verification and the explorer as an optional indexing/UX layer. If we later obtain a private RPC endpoint, changing the environment variable should be enough to use it.

### Rescan performance and reliability

The app should not scan the entire chain every time someone clicks the button.

1. Store the last successfully scanned block for each wallet and supported data source.
2. Scan new blocks and relevant contract logs since that checkpoint.
3. Query historical ranges only when a quest needs them.
4. Cache collection metadata and confirmed ownership results briefly.
5. Use a bounded range per request and continue large scans in background jobs.
6. Retry transient RPC failures with backoff.
7. Make scans idempotent: the same event must not create duplicate claims.
8. Use a second configured endpoint or explorer fallback if the primary RPC is unavailable, while clearly recording the data source.
9. Mark incomplete scans as incomplete rather than displaying them as fully verified.
10. Verify important state again before issuing a final award or transaction.

A public RPC is a sensible MVP choice, but shared endpoints can be rate-limited. Do not promise instant full-history scans on every wallet.

## 9. Smart contracts and on-chain state

The safest design is to use two separate NFT paths and one shared evolution system.

### Contract A — Demo Chog ERC-721

This is the collection we deploy and control.

Requirements:

- mint demo NFTs;
- assign unique token IDs;
- provide `tokenURI`;
- support controlled metadata updates if the demo needs on-chain metadata pointers to change;
- expose the contract address clearly in the UI;
- emit standard transfer events;
- restrict administrative operations;
- make demo minting inexpensive enough for judges to try, preferably on a suitable test network or with sponsored transactions.

The demo collection must be visually inspired by the actual Chog references, but it must not claim to be the original collection.

### Contract B — Evolution profile

This contract or an equivalent persistent state layer tracks evolution for a particular NFT identity.

Example conceptual fields:

```
collection_address
token_id
evolution_stage
xp
unlocked_traits
achievement_ids
evolution_version
last_updated
```

The original NFT remains in its existing collection. The evolution profile records the new progression state separately.

For the first demo, we can store the profile on-chain or use a backend database with a verifiable GenLayer decision record. The right choice depends on how much of the experience needs to be independently inspectable on-chain versus how quickly we need to ship.

### Contract C — GenLayer adjudicator

This Intelligent Contract receives structured claims and applies the published verification criteria. It should not control NFT ownership or hold privileged access to the original Chog contract.

Responsibilities:

- evaluate evidence against quest rules;
- return a structured decision and reason;
- reject reused evidence;
- ensure a claim cannot be rewarded twice;
- make accepted decisions available to the evolution service;
- retain enough evidence references or hashes to audit the outcome.

GenLayer Intelligent Contracts use Python and a validator-consensus process for decisions involving non-deterministic operations. That makes them appropriate for evidence adjudication, but the verification logic still has to be designed carefully.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



### The metadata mutation question

Before implementing original-Chog evolution, inspect the actual collection contract and verify:

- Is it ERC-721?
- How is `tokenURI` implemented?
- Is there a mutable base URI or per-token URI?
- Is the metadata frozen or immutable?
- Who has permission to change metadata?
- Does the contract have an authorized extension or companion mechanism?
- Are marketplace metadata refreshes supported?

If the contract is immutable or controlled by another party, we cannot promise that OpenSea or another marketplace will display our evolved image as the original NFT's metadata.

In that case, the original Chog remains unchanged on-chain, while our app displays a linked evolution profile. The connection must be labelled clearly.

## 10. Artwork pipeline: preserving the real Chog identity

This part deserves special care because the appearance is central to the product.

### Reference repository

You will upload five authentic Chog NFTs to a public GitHub repository. The build should treat these as the approved visual reference set.

Suggested structure:

```
chog-evolution/
  assets/
    chog-references/
      reference-01.png
      reference-02.png
      reference-03.png
      reference-04.png
      reference-05.png
      README.md
    trait-parts/
    generated/
  apps/
    web/
  services/
    evidence-indexer/
    art-renderer/
  contracts/
    demo-chog/
    evolution-profile/
  genlayer/
    chog_adjudicator.py
  docs/
    PRD.md
    architecture.md
    quest-registry.md
```

The actual repository URL should be configured when you supply it; it should not be guessed.

### Recommended rendering strategy

For the first release, use a controlled trait-composition system rather than unconstrained image generation for every evolution.

Each Chog has:

- a consistent base silhouette;
- a selected palette and background;
- permitted eye and expression variants;
- body or outfit traits;
- accessories;
- evolution effects, such as an aura or frame.

The renderer combines approved assets according to the earned trait set. This preserves the character's recognizability and lets judges compare before and after states.

Later, we can add an image-generation service that uses the approved references and a strict prompt template. That output must be checked against the character design rules before it is accepted.

### Rendering requirements

- Preserve the recognizable Chog silhouette and design language.
- Do not replace Chog with a generic frog.
- Do not use the five references as permission to claim our new artwork is official Chog art.
- Do not allow an LLM to invent arbitrary traits that are not in the approved trait catalogue.
- Generate a versioned image and metadata record for every evolution.
- Save the old image and old trait set so the evolution history remains visible.
- Use content hashes so the UI can tell whether the image or metadata changed.
- If rendering fails, preserve the last valid image and show the user that the evolution is pending.

### Example metadata for a demo Chog

```
{
  "name": "Demo Chog #12",
  "description": "A Chog-inspired demo NFT for the CHOG Evolution platform.",
  "attributes": [
    { "trait_type": "Evolution Stage", "value": "Explorer" },
    { "trait_type": "Aura", "value": "Cyan" },
    { "trait_type": "Accessory", "value": "Explorer Badge" },
    { "trait_type": "Verified Achievements", "value": 3 }
  ],
  "properties": {
    "collection_mode": "demo",
    "art_version": 2
  }
}
```

This is an illustrative metadata shape. Final fields must match the contract and marketplace behavior we implement.

## 11. Utility options — choose what the product should become

I recommend a strong primary utility plus a few supporting ones. If we build too many unrelated features, the demo will be harder to finish and the main innovation will become less clear.

## Utility shortlist

Select the utilities you want included in the build plan. The first three are my recommended foundation.

Evolution engine

Core

Verified activity changes the Chog's stage, traits, visual appearance and abilities.

Ecosystem passport

Strong add-on

A portable history of verified activity, achievements and contributions across supported CHOG/Monad experiences.

Quest and rescan engine

Strong add-on

Discover past eligible activity and new quests; submit evidence and earn progression.

Evolution arena

Optional

Let users compare Chogs in themed challenges based on unlocked traits and verified achievements—not just wallet size.

Trait crafting

Optional

Combine earned fragments or achievements to unlock a new accessory, aura or appearance variant.

Community evolution events

Optional

Limited-time community quests that evolve many Chogs together and create shared goals.

Utility access gates

Optional; partner-dependent

Use evolution levels or badges to unlock selected platform features, beta access, community roles or partner quests.

$CHOG integration

Bonus feature

Use $CHOG for an optional cosmetic or crafting action only if the integration is safe, meaningful and feasible.

&#x20;Copy selected utilitiesUse these utilities in the PRD

### My recommendation

The strongest combination is Evolution Engine + Ecosystem Passport + Quest/Rescan Engine.

It gives us one coherent product loop:

- The passport records what the user has actually done.
- The quest engine finds eligible activity and verifies claims.
- The evolution engine turns those achievements into a visible, persistent change to the Chog.

That is a better story for judges than building a generic NFT collection with a level counter. The NFT is the user's evolving identity, and the platform is the place where that identity gains meaning.

### How the NFT should matter

Every major utility should use the NFT's identity or earned traits.

For example, a user might need to unlock an Explorer trait to enter a particular challenge, or an achievement badge to access a special quest. These should be platform mechanics we can demonstrate immediately—not promises of access to external communities that have not agreed to support us.

The $CHOG token is optional under the published Chogathon rules.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chogathon.chog.xyz\&sz=32)

Hackathon

&#x20;I would not make the first release depend on token payments, staking, or financial rewards. We can add a meaningful token integration later if it improves the experience and we can verify the correct contract and transaction behavior.



## 12. Database and evidence model

The database must separate evidence, adjudication, and evolution so we can audit why an NFT changed.

| Entity               | Important fields                                                             |
| -------------------- | ---------------------------------------------------------------------------- |
| `users`              | ID, wallet addresses, created time                                           |
| `social_accounts`    | Platform, handle, verification status, verification time                     |
| `nfts`               | Chain ID, collection address, token ID, mode, current owner snapshot         |
| `evolution_profiles` | NFT identity, stage, XP, trait set, current art version                      |
| `quests`             | Quest ID, description, rules, active period, reward, evidence requirements   |
| `events`             | Official source, dates, supported evidence, verification method              |
| `claims`             | User, NFT, quest, evidence references, status, decision ID                   |
| `evidence`           | Type, URL or transaction hash, source, content hash, timestamp, fetch status |
| `decisions`          | GenLayer transaction reference, structured result, reason, finality status   |
| `evolution_history`  | Previous state, new state, cause, image/metadata version, timestamp          |
| `scan_jobs`          | Wallet, source, block range, checkpoint, status, error details               |

### Anti-abuse rules

- Enforce unique claims at the database level.
- Normalize transaction hashes, wallet addresses, and supported public URLs before checking for duplicates.
- Keep evidence linked to the specific user, wallet, quest, and NFT it supports.
- Revalidate current NFT ownership before an ownership-sensitive action.
- Do not let users choose their own XP amount or directly set their evolution stage.
- Keep an audit log for administrative overrides.
- Require a reason and authorized operator for any manual award or reversal.
- Treat social evidence as potentially forged until its source and content have been checked.
- Never trust the frontend's claim that a transaction or social event has been verified.

### Transfer behavior

The product needs an explicit rule for what happens if an NFT changes hands.

My recommendation is:

- Achievements tied to the wallet stay with that wallet.
- Achievements tied to the NFT's identity stay with that NFT.
- The interface displays which achievements are wallet-bound and which are NFT-bound.
- Demo NFT evolution follows the token, unless the game rules explicitly state otherwise.

This prevents a buyer from accidentally inheriting another user's entire social history as if they had earned it.

## 13. Security, failure handling and edge cases

| Scenario                                             | Required behavior                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| User owns no original Chog                           | Offer demo minting and label it clearly                                        |
| User owns an original Chog                           | Verify the collection and token on Monad                                       |
| NFT belongs to a counterfeit collection              | Do not recognize it as an original Chog                                        |
| RPC endpoint is rate-limited                         | Retry, back off, and show scan status                                          |
| Full historical scan is too large                    | Split into jobs and continue from checkpoints                                  |
| Explorer API is unavailable                          | Use direct RPC for supported verification                                      |
| Public X profile cannot be fetched                   | Mark social verification unavailable; do not award automatically               |
| X post was deleted or made private                   | Keep the prior evidence record but mark re-verification unavailable            |
| Same event is submitted repeatedly                   | Return the existing claim or reject the duplicate                              |
| GenLayer returns a pending or failed decision        | Do not apply the reward until the decision reaches the required accepted state |
| Image generation fails                               | Preserve the current valid appearance and retry                                |
| Metadata update is not supported by the original NFT | Show the companion evolution profile instead                                   |
| User transfers the NFT during a pending claim        | Recheck ownership before ownership-sensitive operations                        |
| Two requests attempt the same evolution              | Use idempotency keys and atomic state updates                                  |
| A quest's rules change                               | Preserve the rule version used for earlier claims                              |
| Admin changes a quest reward                         | Log the change and apply it according to a published effective date            |

### Important trust boundary

GenLayer can help establish whether evidence satisfies an agreed rule, but it does not automatically make unreliable evidence reliable. Validators must be able to independently inspect the source data, and the system must handle disagreements, timeouts, and inconclusive results.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



The backend must not award an achievement merely because a model generated a confident explanation. It should only apply a reward after the required verification and finalization conditions have been met.

## 14. Implementation plan

Build the project in phases so we always have a working demonstration, even if some external integrations are unavailable.

01

Foundation and visual identity

Deliverable: working frontend shell

- Set up the repository and application.
- Load the five approved Chog reference images.
- Build the Home, Quest Board, Rescan, Evolution Chamber, and Passport pages.
- Create the trait catalogue and rendering prototype.
- Add a clearly labelled demo mode.

02

Demo NFT and evolution state

Deliverable: mint, progress, and evolve

- Deploy the demo ERC-721 collection on the chosen test network.
- Implement token ownership and metadata.
- Build XP and stage rules.
- Add deterministic trait composition.
- Save an evolution history record after each accepted change.

03

GenLayer adjudication

Deliverable: verifiable evidence decision

- Create an Intelligent Contract with structured claim inputs.
- Implement the evidence evaluation rules and independent validator checks.
- Record transaction references and final decision status.
- Connect accepted decisions to the progression engine.
- Test accepted, rejected, duplicate, and inconclusive claims.

Use the current GenLayer SDK and the network environment appropriate to the build. GenLayer's official documentation recommends developing and testing the contract before integrating it into the frontend.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.genlayer.com\&sz=32)

GenLayer Documentation

+1



04

Monad ownership and ecosystem rescan

Deliverable: authentic wallet integration

- Confirm the original Chog Genesis contract.
- Detect and verify original NFT ownership.
- Implement incremental wallet scans.
- Add the event registry and starter quests.
- Display transaction and evidence links.
- Add the X bio-code linking flow as a separate integration.

05

Polish and judge preparation

Deliverable: complete end-to-end demo

- Test wallet disconnection, RPC failure, and pending transactions.
- Verify that demo and original collections are visibly distinct.
- Add an example activity that genuinely changes the NFT's appearance.
- Prepare a resettable demo scenario.
- Record the demo video and publish judge instructions.

### Priorities if time becomes limited

Must ship: demo mint, evolution UI, trait changes, evidence submission, a real GenLayer decision, and an auditable history.

Should ship: original Chog ownership verification, one real Monad activity quest, and incremental rescan.

Can follow: broad event coverage, public social scraping beyond basic supported pages, advanced generative artwork, arena gameplay, and token integration.

Do not delay the entire product while trying to solve every social platform's data-access limitations.

## 15. Acceptance criteria

The build is not complete merely because the site looks good. These are the tests that should pass before we call the MVP ready.

- A judge can use the app without owning an original Chog.
- A demo Chog can be minted and has a unique token ID.
- The app distinguishes demo Chogs from original Chogs in every relevant screen.
- A wallet can be connected and its network can be checked.
- Original Chog ownership is verified against the confirmed collection contract.
- A supported on-chain activity can be discovered during a rescan.
- A submitted claim produces a real GenLayer transaction and a visible decision status.
- An accepted claim increases progression exactly once.
- A duplicate claim does not award additional XP.
- A successful evolution visibly changes at least one trait or appearance.
- The evolution history explains which verified claim caused the change.
- The app does not claim that a companion profile changed the original NFT's marketplace metadata.
- An RPC failure or unavailable public source does not cause a false approval.
- The app can recover from a pending or failed adjudication.
- The judge can follow written instructions and repeat the demo.

## 16. Judge demonstration script

Target a concise walkthrough of about three minutes, matching the Chogathon submission page's demo-video guidance.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://chogathon.chog.xyz\&sz=32)

Hackathon



## 0:00

Intro

Show the problem

“NFTs can represent identity, but their appearance and utility rarely reflect what their owners do after minting. CHOG Evolution makes verified ecosystem participation change how your Chog looks and what it can do.”

## 0:25

Mint

Mint a demo Chog

Show the NFT's starting appearance, stage, XP, and traits. Explain that the demo collection is separate from the original Chog Genesis collection.

## 0:50

Evidence

Run an ecosystem scan

Show a real supported transaction or a clearly labelled sample scenario, then open its evidence record. Make the source and verification status visible.

## 1:20

Adjudicate

Show GenLayer working

Submit the claim, show the transaction status, and display the final structured decision with its reason. Do not simulate the result as if it were a real GenLayer transaction.

## 1:55

Evolution

Show the before-and-after Chog

Reveal the unlocked trait, new appearance, progression state, and the achievement responsible for the change.

## 2:30

Close

Explain why the NFT matters

Show the Passport or Quest Board and explain that the NFT's identity, earned traits, and evolution history determine the user's experience.

The important visual moment is the actual transition from the starting Chog to the evolved Chog. The important technical moment is proving that the transition followed an accepted evidence decision rather than a hardcoded animation.

## 17. Ready-to-use coding-agent prompt

Once the five references and the repository URL are available, use this as the master implementation instruction for Codex or another coding agent.

\# Build CHOG Evolution — Chogathon MVP  You are the lead full-stack engineer, smart-contract engineer, and technical architect for CHOG Evolution, a Chogathon 2026 project.  ## Product objective  Build a complete, functional platform where a Chog NFT evolves in response to verifiable ecosystem participation. The application must demonstrate a real utility loop: discover activity, submit evidence, validate the claim using the appropriate verification layer, award progression, update the NFT's evolution state, and display a persistent before-and-after history.  Do not build a static mockup. Implement a working end-to-end experience.  ## Mandatory product modes  1. Demo Chog: deploy a separate NFT collection that we control. Users and judges must be able to mint and evolve demo NFTs without owning an original Chog. 2. Original Chog: verify authentic ownership against the confirmed Chog Genesis collection on Monad. Support a companion evolution profile unless the original contract explicitly permits an authorized metadata update.  Never misrepresent demo NFTs as members of the original 1,969-token collection. Never imply that the original NFT's metadata changed if only the companion profile changed.  ## Visual references  Use the five actual Chog NFT references in the supplied public GitHub repository. Inspect the images before implementing the art pipeline. Preserve the recognizable Chog silhouette and visual language. Do not substitute generic frogs or unrelated characters. Keep the demo artwork clearly distinguished from official collection artwork.  Do not invent a repository URL, contract address, ABI, or official integration permission. If any is missing, isolate it in configuration and document the required input.  ## Required features  - Responsive Home / Evolution Lab - Wallet connection and Monad network handling - Demo NFT minting - Original Chog collection detection - Quest Board - Ecosystem Rescan - Evidence submission and status tracking - GenLayer Intelligent Contract for evidence adjudication - XP, levels, evolution stages, and trait unlocking - Deterministic art composition from an approved trait catalogue - Evolution history and public Chog Passport - PostgreSQL-backed quest, claim, evidence, scan, and evolution records - Monad RPC indexing with checkpoints, caching, retries, and idempotency - X profile linking via a temporary public bio verification code - A maintained event registry with source URLs, dates, rules, and verification methods - A clearly labelled judge demo scenario - Useful loading, error, pending, rejected, and source-unavailable states  ## Technical constraints  - Use a clean TypeScript-based frontend and a maintainable backend. - Use an EVM-compatible library for Monad reads and contract interactions. - Use the public Monad RPC initially; make the endpoint configurable for a future private RPC provider. - Confirm Monad mainnet chain ID and current endpoint settings before deployment. - Use Solidity and a standard ERC-721 implementation for the demo collection. - Use GenLayer's current supported SDK and deployment environment for the adjudicator. - Do not trust frontend-supplied XP, eligibility, ownership, or verification status. - Do not award a claim before its required verification and adjudication conditions are satisfied. - Do not use a social scraper as a guaranteed source of likes, attendance, or private activity. - Store secrets only in environment variables. - Keep original collection metadata and demo collection metadata separate. - Make all rewards idempotent and prevent duplicate claims. - Preserve prior valid NFT artwork if image generation or metadata publication fails.  ## GenLayer decision model  Implement structured decisions, including: - accepted - rejected - needs_review - source_unavailable  Include a reason code, quest identifier, XP award, evidence identifier or hash, and the relevant transaction/decision reference.  Use deterministic checks for objective on-chain facts. Use GenLayer for the portion that genuinely requires interpretation or judgment. Validators must independently inspect the underlying evidence according to explicit verification rules. Do not accept a result solely because an LLM returned valid-looking JSON.  ## Ecosystem research  Before implementing automatic ecosystem rewards, search official Chog and Monad sources for recent or active events and quests. For each candidate event, record: - exact event name and dates - official source URL - eligibility rules - evidence required - actual completion signal - verification method - whether the claim can be verified automatically  Do not invent event participation records or contract addresses. If no reliable completion signal exists, support manual review or leave the quest inactive.  ## Delivery process  1. Inspect the repository and existing code before making changes. 2. Write or update PRD.md, architecture.md, and quest-registry.md. 3. Implement the application in small, testable phases. 4. Deploy and test the demo NFT and evolution state. 5. Integrate and test GenLayer adjudication. 6. Integrate original Chog ownership verification. 7. Add rescan and evidence integrations. 8. Test duplicates, wallet transfers, RPC failures, missing evidence, pending decisions, and image-generation failures. 9. Provide a reproducible local setup, environment-variable example, contract addresses, deployment instructions, test commands, and judge-demo instructions. 10. Ensure the judge can complete the end-to-end experience without purchasing an original Chog.  Prioritize a working, polished, truthful MVP over incomplete integrations. Do not mark any feature complete unless it has been implemented and tested. Record unresolved dependencies explicitly rather than silently substituting simulated behavior for real verification.






# CHOG Evolution — Final Product Requirements & Technical Specification

Chogathon 2026 · Implementation-ready PRD · Version 1.0 · 17 October 2026

CHOG Evolution is a GenLayer-powered platform that transforms verified participation in the Chog and Monad ecosystems into a persistent, evolving NFT identity. Users can discover eligible activity, submit evidence, receive an adjudicated evolution decision, and unlock new visual traits generated through a controlled artwork pipeline.

The defining product loop is:

Discover activity → verify evidence → adjudicate with GenLayer → unlock traits → render with Gemini → publish the evolution → use the evolved identity.

The implementation decisions below are now fixed for this specification.

Demo network: Monad testnet

Deploy and test the demo collection without requiring users to spend mainnet funds.

Original Chog support: companion evolution profile

Verify authentic original Chog ownership, but preserve the original NFT and its metadata. Store our evolution state separately.

Artwork: controlled trait composition

Use the five approved Chog references and a controlled trait catalogue. Gemini generates artwork only after an approved evolution decision.

Evidence: hybrid verification

Use deterministic on-chain checks, supported public evidence, GenLayer adjudication for interpretation, and manual review when necessary.

## 1. Product scope and success criteria

### 1.1 Core user experience

A user connects their wallet and chooses one of two paths:

- Original Chog: the platform verifies that the user owns an authentic NFT from the configured original collection and creates a companion evolution profile.
- Demo Chog: the user mints a clearly labelled NFT from our separate collection on Monad testnet.

The user then rescans eligible ecosystem activity or submits evidence for a supported quest. The backend verifies objective facts and sends the relevant claim to GenLayer. Once the required adjudication finality is reached, the backend applies the approved progression, invokes Gemini, and saves the evolved appearance and history.

### 1.2 MVP success criteria

The MVP is successful when a judge can:

1. Connect a wallet and mint a demo Chog.
2. View its initial appearance, stage, XP, and traits.
3. Submit a claim supported by real or explicitly documented demo evidence.
4. Observe an actual GenLayer adjudication transaction and its final decision.
5. See the approved evolution specification.
6. See Gemini-generated artwork based on the approved trait changes.
7. View the updated companion profile or demo NFT metadata.
8. Inspect the evidence, decision, image version, and evolution history.
9. Retry a failed operation without receiving duplicate rewards.

The application must never present a mocked GenLayer result, fabricated ecosystem participation, or simulated NFT update as a real transaction.

## 2. System architecture

Next.js web application

Wallet connection · NFT dashboard · Quest Board · Rescan · Evolution Lab · Passport

Backend API + PostgreSQL

Authentication · claims · quest rules · scan checkpoints · audit history · job orchestration

Monad

Ownership, demo ERC-721, transaction receipts and event logs

GenLayer

Evidence adjudication and structured evolution authorization

Durable evolution worker

Finality monitoring · Gemini API · trait validation · artwork storage · metadata publication

Gemini

Generate artwork from approved references and validated traits

Asset storage

Artwork, metadata, reference hashes and durable URIs

### 2.1 Architectural boundaries

| Component                     | Authoritative responsibility                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Monad                         | Blockchain state, transaction receipts, NFT ownership and demo NFT contract state       |
| GenLayer Intelligent Contract | Adjudication result and permitted evolution specification                               |
| Backend                       | Claim lifecycle, policy validation, XP accounting, retries and workflow state           |
| Gemini                        | Image generation only; not authoritative for eligibility, ownership, XP or NFT identity |
| PostgreSQL                    | Application records, job coordination, claim uniqueness and evolution history           |
| Object storage / IPFS         | Durable image and metadata assets                                                       |
| Frontend                      | User interaction and presentation; never authoritative for rewards                      |

Critical integration constraint: GenLayer does not directly call Gemini using your secret API key in this architecture. The backend observes the finalized GenLayer decision and then calls Gemini. This avoids exposing secrets and separates consensus decisions from external image-generation infrastructure.

### 2.2 Proposed repository layout

```
chog-evolution/
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       └── lib/
├── packages/
│   ├── shared-types/
│   ├── evolution-rules/
│   └── validation/
├── services/
│   ├── api/
│   ├── evidence-indexer/
│   ├── evolution-worker/
│   └── art-renderer/
├── contracts/
│   └── DemoChog.sol
├── genlayer/
│   └── chog_adjudicator.py
├── assets/
│   └── chog-references/
├── db/
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   ├── API.md
│   ├── deployment.md
│   └── judge-demo.md
└── .env.example
```

The five reference images should be stored in the approved asset directory or fetched from the configured public GitHub repository and pinned by content hash. Do not use an unpinned branch URL as the sole production reference: changes to that branch must not silently change the artwork rules.

## 3. Functional requirements

### FR-01 — Wallet and NFT registration

- Connect an EVM wallet and verify ownership using a signed nonce.
- Support Monad testnet for the demo collection.
- Allow users to register an original Chog only after verifying the configured collection address and token ownership on Monad mainnet.
- Represent an NFT by `chain_id + collection_address + token_id`, not by token ID alone.
- Clearly distinguish original collection NFTs from demo NFTs throughout the interface.
- Support multiple NFT profiles per wallet, with authorization checks on every action.

### FR-02 — Quest discovery and ecosystem rescan

- Maintain a versioned registry of quests and eligible events.
- Display eligibility requirements, dates, rewards, evidence types, and verification status before submission.
- Scan supported blockchain data incrementally.
- Support manual evidence submission for approved public URLs and event records.
- Distinguish verified activity from discovered but unverified activity.
- Allow users to rescan without generating duplicate claims or rewards.

### FR-03 — Evidence adjudication

- Perform objective checks in the backend before GenLayer submission.
- Submit only the evidence and policy required for the decision.
- Store the GenLayer transaction reference and current lifecycle status.
- Apply rewards only after the required decision finality and backend validation.
- Support accepted, rejected, needs-review, and source-unavailable outcomes.
- Keep a reproducible audit trail.

### FR-04 — Evolution progression

The backend maintains the authoritative progression state.

Initial proposed rules:

| Stage     | Illustrative XP threshold | Example unlocked traits                   |
| --------- | ------------------------- | ----------------------------------------- |
| Hatchling | 0                         | Base appearance                           |
| Curious   | 50                        | Expression variants                       |
| Explorer  | 150                       | Explorer accessory or background          |
| Veteran   | 350                       | Outfit or additional aura                 |
| Legend    | 700                       | Special frame and rare visual combination |

These thresholds are initial game parameters and should be stored in versioned configuration. GenLayer may authorize a transition within the allowed rules, but the backend must enforce the final XP and trait catalogue.

Additional rules:

- Each qualifying claim can award XP only once.
- Repeated actions may have diminishing returns or daily caps.
- Trait changes must be tied to earned achievements or documented progression rules.
- Existing traits are preserved unless an authorized rule explicitly permits replacing them.
- Every evolution creates a new immutable history record.

### FR-05 — Trait-based Gemini artwork

- Maintain a controlled catalogue of valid traits.
- Generate artwork only after a finalized qualifying decision.
- Pass approved references and the validated evolution specification to Gemini.
- Keep the Gemini API key server-side.
- Validate and store the image before updating metadata.
- Record the prompt version, model configuration, reference hashes, image hash and asset URI.
- Preserve the previous image if the new generation fails.

### FR-06 — Companion profiles for original Chogs

The platform must not imply that it can modify a third-party NFT's metadata.

For original Chogs:

- Verify ownership against the authentic collection.
- Create a companion evolution profile tied to the original NFT identity.
- Display the original NFT and evolved companion appearance separately.
- Keep the original token's metadata and ownership unchanged.
- Recheck ownership for ownership-sensitive operations.

For demo Chogs, the application may publish updated metadata if the deployed demo contract supports it. The companion profile remains the canonical source of evolution history for both modes.

### FR-07 — Chog Passport

Provide a public or shareable profile containing:

- NFT identity and collection mode;
- current stage and XP;
- unlocked traits;
- verified achievements;
- evolution history;
- evidence and decision references where safe to disclose;
- current artwork and metadata versions.

Do not expose private account information, secret keys, internal adjudication prompts, or private evidence.

## 4. Detailed GenLayer contract interface

The following is the logical contract interface. The exact Python class structure, imports, consensus APIs, and transaction lifecycle calls must be implemented using the current GenLayer SDK and deployment environment. This specification does not invent SDK-specific function signatures.

### 4.1 Contract responsibilities

`ChogAdjudicator` should:

1. Accept a versioned claim with a unique claim ID.
2. Identify the applicable quest policy.
3. Evaluate supplied evidence according to explicit criteria.
4. Return a structured decision and permitted evolution specification.
5. Record the decision against the claim ID.
6. Reject conflicting or duplicate claim submissions where supported by the contract's state model.
7. Avoid handling Gemini API credentials, image-generation calls, or NFT ownership mutations.

The backend remains responsible for objective chain checks, evidence collection, authoritative XP accounting, and orchestration.

### 4.2 Logical function interface

| Function                          | Purpose                                              | Access                                           |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `evaluate_claim(claim)`           | Evaluate evidence and produce an adjudication result | Authorized backend submission                    |
| `get_decision(claim_id)`          | Retrieve the stored decision                         | Public/read access where supported               |
| `get_claim_status(claim_id)`      | Retrieve claim processing status                     | Public/read access where supported               |
| `get_policy_version(quest_id)`    | Return the policy version used for a quest           | Public/read access where supported               |
| `register_policy(policy)`         | Register a versioned quest policy                    | Authorized administrator or governance mechanism |
| `update_policy(quest_id, policy)` | Publish a new policy version                         | Authorized administrator or governance mechanism |

Policy administration must not silently rewrite the rules for a claim already submitted. A claim records the policy version used at submission.

### 4.3 Claim input schema

```
{
  "schema_version": "1.0",
  "claim_id": "claim_8f12",
  "quest_id": "chog_event_001",
  "policy_version": "1.0",
  "claimant_wallet": "0x...",
  "nft": {
    "chain_id": 10143,
    "collection_address": "0x...",
    "token_id": "12",
    "collection_mode": "demo"
  },
  "evidence": [
    {
      "evidence_id": "ev_001",
      "evidence_type": "transaction",
      "source_uri": "https://...",
      "content_hash": "sha256:...",
      "verification_summary": "Successful interaction with the approved quest contract",
      "observed_at": 1792000000
    }
  ]
}
```

All values above are illustrative. The configured Monad testnet chain ID, addresses, and quest contract must be verified before deployment.

The contract should receive sufficient evidence for its decision, but not blindly trust the backend's `verification_summary`. Where practical, the contract or its consensus evaluation should independently inspect relevant evidence and verify the policy conditions. Objective checks that are already deterministically established should be supplied with auditable references.

### 4.4 Decision output schema

```
{
  "claim_id": "claim_8f12",
  "decision": "accepted",
  "reason_code": "ELIGIBLE_EVIDENCE",
  "reason": "The evidence satisfies the configured quest policy.",
  "quest_id": "chog_event_001",
  "policy_version": "1.0",
  "xp_awarded": 75,
  "evolution": {
    "target_stage": "Explorer",
    "traits_to_add": ["Explorer Badge", "Cyan Aura"],
    "traits_to_remove": [],
    "visual_instructions": [
      "Add an explorer-themed accessory",
      "Apply a subtle cyan aura",
      "Preserve the approved Chog silhouette"
    ]
  },
  "evidence_refs": ["ev_001"]
}
```

Supported decision values:

- `accepted`
- `rejected`
- `needs_review`
- `source_unavailable`

A contract execution that has not reached the required finality is not equivalent to any of these final business decisions.

### 4.5 Contract security requirements

- Bound the length of all user-controlled strings.
- Restrict XP awards and trait names to policy-defined values.
- Prevent duplicate claim IDs from awarding duplicate rewards.
- Bind the claim to its wallet, quest, evidence, and policy version.
- Do not let the caller choose arbitrary reward amounts.
- Do not store Gemini secrets or call Gemini from the contract.
- Do not assume a URL or content hash proves the contents of a web page.
- Use the current documented GenLayer consensus and finality semantics.
- Test replay attempts and conflicting submissions.

### 4.6 Backend-to-GenLayer adapter

Create a dedicated `GenLayerClient` module with responsibilities to:

- prepare and validate the claim payload;
- submit the claim using the official SDK;
- persist the transaction identifiers;
- retrieve the transaction lifecycle status;
- decode the finalized result;
- validate the result against the expected schema;
- return typed statuses to the job orchestrator.

The rest of the application should not depend directly on SDK-specific response formats. This adapter is the boundary that isolates the product from future SDK changes.

## 5. Gemini art pipeline specification

### 5.1 Trait catalogue

Use a versioned catalogue with allowed categories and combinations.

| Category      | Example values               | Rule                                   |
| ------------- | ---------------------------- | -------------------------------------- |
| Base identity | Approved Chog base variants  | Must preserve recognizable identity    |
| Expression    | Curious, determined, excited | Only supported variants                |
| Accessory     | Explorer Badge, event emblem | Must be earned or unlocked             |
| Aura          | None, Cyan, Gold             | Must be permitted by progression rules |
| Background    | Plain, event-themed, cosmic  | Must follow approved style rules       |
| Frame         | Standard, Veteran, Legend    | Must follow stage restrictions         |

The actual artwork values must be grounded in the five supplied reference NFTs and the project's approved trait design. These example names are not assertions about official Chog traits.

### 5.2 Generation request

The backend prepares a typed generation request containing:

```
{
  "job_id": "evolution_job_123",
  "nft_identity": {
    "chain_id": 10143,
    "collection_address": "0x...",
    "token_id": "12"
  },
  "base_image_uri": "ipfs://...",
  "reference_images": [
    {
      "uri": "https://...",
      "sha256": "..."
    }
  ],
  "target_stage": "Explorer",
  "approved_traits": {
    "add": ["Explorer Badge", "Cyan Aura"],
    "remove": [],
    "preserve": ["Base Chog Identity"]
  },
  "prompt_version": "chog-art-v1"
}
```

The backend must fetch and validate reference images from trusted configured locations before using them. The request may pass inline image data to Gemini when required by the chosen API. A public URI should not be assumed to be directly consumable by the model without retrieval.

### 5.3 Output validation

Gemini's generated image is not the source of truth for NFT properties.

The backend must:

1. Confirm that an image was returned.
2. Validate its format, size and decodability.
3. Check for disallowed or unsupported trait additions using the chosen validation method.
4. Confirm that the requested evolution job and NFT identity match the saved decision.
5. Store the final image durably and calculate its content hash.
6. Construct metadata from the authoritative evolution state.
7. Publish metadata only after the image is accessible.
8. Commit the new evolution version atomically in the database.

If image quality or trait compliance cannot be automatically established with sufficient confidence, send the result to review rather than pretending the model is infallible.

### 5.4 Artwork versioning

Every completed evolution should record:

- previous artwork URI and hash;
- new artwork URI and hash;
- metadata URI and hash;
- model and prompt-template version;
- reference-image hashes;
- finalized GenLayer decision reference;
- evolution version;
- creation timestamp.

The user can then view their Chog's evolution history, and the team can reproduce the request configuration for debugging.

## 6. Database schema

Use PostgreSQL with UUID primary keys, UTC timestamps, explicit foreign keys, and database constraints for uniqueness. The following is the required logical schema; implementation can split it into versioned SQL migrations.

### 6.1 Entity relationships

\#chatgpt-mermaid-\_r_119\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_119\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_119\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_119\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_119\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_119\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_119\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_119\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_119\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_119\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_119\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_119\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_119\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_119\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_119\_ p{margin:0;}#chatgpt-mermaid-\_r_119\_ .entityBox{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_119\_ .relationshipLabelBox{fill:rgb(48, 48, 48);opacity:0.7;background-color:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_119\_ .relationshipLabelBox rect{opacity:0.5;}#chatgpt-mermaid-\_r_119\_ .labelBkg{background-color:rgba(48, 48, 48, 0.5);}#chatgpt-mermaid-\_r_119\_ .edgeLabel{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_119\_ .edgeLabel .label rect{fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_119\_ .edgeLabel .label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_119\_ .edgeLabel .label{fill:rgb(31, 78, 148);font-size:14px;}#chatgpt-mermaid-\_r_119\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_119\_ .edge-pattern-dashed{stroke-dasharray:8,8;}#chatgpt-mermaid-\_r_119\_ .node rect,#chatgpt-mermaid-\_r_119\_ .node circle,#chatgpt-mermaid-\_r_119\_ .node ellipse,#chatgpt-mermaid-\_r_119\_ .node polygon{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_119\_ .relationshipLine{stroke:rgb(175, 175, 175);stroke-width:1px;fill:none;}#chatgpt-mermaid-\_r_119\_ .marker{fill:none!important;stroke:rgb(175, 175, 175)!important;stroke-width:1;}#chatgpt-mermaid-\_r_119\_ [data-look=neo].labelBkg{background-color:rgba(48, 48, 48, 0.5);}#chatgpt-mermaid-\_r_119\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_119\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_119\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_119\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_119\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_119\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_119\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_119\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_119\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}USERSWALLETSSOCIAL_ACCOUNTSNFT_PROFILESCLAIMSQUESTSEVIDENCEDECISIONSEVOLUTION_JOBSEVOLUTION_HISTORYARTIFACTSSCAN_JOBSownslinkscontrolsreceivesdefinescontainsadjudicated_bytriggersrecordsproducesscanned_by

### 6.2 Table definitions

Common conventions: UUID identifiers; `created_at` and `updated_at` as UTC timestamps; wallet addresses and transaction hashes stored in normalized form; JSONB only for flexible, versioned payloads.

## `users` and `wallets`

`users`

```
CREATE TABLE users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`wallets` stores authenticated wallet identities.

```
CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  address TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address)
);
```

Normalize addresses before inserts and use a case-insensitive uniqueness strategy for EVM addresses.

## `social_accounts`

Stores verified social-account links.

```
CREATE TABLE social_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  status TEXT NOT NULL,
  verification_code_hash TEXT,
  verification_expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);
```

Store a hash of the temporary bio code, not the reusable plaintext code. Restrict supported platforms to configured values.

## `nft_profiles`

Represents both original Chog companion profiles and demo NFTs.

```
CREATE TABLE nft_profiles (
  id UUID PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  collection_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  collection_mode TEXT NOT NULL,
  owner_wallet_id UUID REFERENCES wallets(id),
  stage TEXT NOT NULL DEFAULT 'Hatchling',
  xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  traits JSONB NOT NULL DEFAULT '[]',
  evolution_version INTEGER NOT NULL DEFAULT 1,
  current_artifact_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, collection_address, token_id)
);
```

`collection_mode` must be constrained to `demo` or `original_companion`. The `owner_wallet_id` is a cached ownership association, not a substitute for checking chain state.

## `quests` and `quest_policies`

```
CREATE TABLE quests (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  reward_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quest_policies (
  id UUID PRIMARY KEY,
  quest_id UUID NOT NULL REFERENCES quests(id),
  version INTEGER NOT NULL,
  policy JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quest_id, version)
);
```

Never overwrite a policy version used by an existing claim. Create a new version instead.

## `claims` and `evidence`

```
CREATE TABLE claims (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  nft_profile_id UUID NOT NULL REFERENCES nft_profiles(id),
  quest_id UUID NOT NULL REFERENCES quests(id),
  policy_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  xp_awarded BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES claims(id),
  evidence_type TEXT NOT NULL,
  source_uri TEXT,
  transaction_hash TEXT,
  log_index INTEGER,
  content_hash TEXT,
  observed_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL,
  source_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add unique constraints for transaction-based evidence using chain ID, transaction hash, and log index where those fields apply. Do not use a URL alone as a universal deduplication key.

## `decisions` and `evolution_jobs`

```
CREATE TABLE decisions (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES claims(id),
  genlayer_tx_id TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL,
  decision JSONB,
  policy_version INTEGER NOT NULL,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (claim_id)
);

CREATE TABLE evolution_jobs (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES claims(id),
  nft_profile_id UUID NOT NULL REFERENCES nft_profiles(id),
  status TEXT NOT NULL,
  evolution_spec JSONB,
  gemini_model TEXT,
  prompt_version TEXT,
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  image_uri TEXT,
  image_hash TEXT,
  metadata_uri TEXT,
  previous_version INTEGER NOT NULL,
  new_version INTEGER,
  last_error_code TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Enforce one logical evolution job per claim. If retries are recorded separately, use a child attempts table rather than creating duplicate logical jobs.

## `artifacts`, `evolution_history`, and `scan_jobs`

```
CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  evolution_job_id UUID NOT NULL REFERENCES evolution_jobs(id),
  artifact_type TEXT NOT NULL,
  uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evolution_history (
  id UUID PRIMARY KEY,
  nft_profile_id UUID NOT NULL REFERENCES nft_profiles(id),
  claim_id UUID NOT NULL REFERENCES claims(id),
  previous_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  previous_state JSONB NOT NULL,
  new_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nft_profile_id, new_version)
);

CREATE TABLE scan_jobs (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  chain_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  from_block BIGINT,
  to_block BIGINT,
  checkpoint_block BIGINT,
  status TEXT NOT NULL,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add a separate `job_attempts` table to record retries, attempt number, error classification, and timestamps. Add an append-only audit table for administrative actions and security-sensitive state transitions.

### 6.3 Database invariants

Enforce the following in database constraints and transactional service logic:

- One claim cannot be rewarded twice.
- One evolution version can only be committed once for an NFT profile.
- A completed evolution must reference an accepted, finalized decision.
- A completed evolution must have a validated image artifact and metadata artifact.
- A profile update must use the expected prior version.
- The original NFT's ownership is not treated as permanently valid just because a prior scan succeeded.
- Policy and evidence records used in past decisions remain auditable.

Use database transactions for progression and history updates. Do not keep a database transaction open while waiting for GenLayer or Gemini.

## 7. API specification

All routes below are application endpoints. Require authentication for private operations, validate request schemas, apply rate limits, and return structured errors.

### 7.1 Public and wallet-authenticated routes

| Method and route             | Request                     | Response                                  |
| ---------------------------- | --------------------------- | ----------------------------------------- |
| `POST /api/auth/nonce`       | Wallet address, chain ID    | Nonce and expiry                          |
| `POST /api/auth/verify`      | Signed nonce and wallet     | Authenticated session                     |
| `GET /api/nfts`              | Authenticated wallet        | Owned or registered profiles              |
| `POST /api/nfts/register`    | Collection, token ID, mode  | Verified profile or rejection             |
| `POST /api/nfts/demo/mint`   | Optional mint configuration | Transaction hash and mint status          |
| `GET /api/nfts/:id`          | Profile ID                  | NFT details and evolution state           |
| `GET /api/nfts/:id/history`  | Profile ID                  | Ordered evolution history                 |
| `GET /api/nfts/:id/passport` | Profile ID                  | Shareable passport data                   |
| `GET /api/quests`            | Optional status filters     | Active quests and requirements            |
| `GET /api/quests/:id`        | Quest ID                    | Policy, dates, rewards and evidence rules |

Use signed nonce authentication to prove wallet control. A connected wallet address alone is not authentication.

### 7.2 Evidence and adjudication routes

| Method and route              | Request                               | Response                              |
| ----------------------------- | ------------------------------------- | ------------------------------------- |
| `POST /api/scans`             | Wallet, chain, source filters         | Scan job ID                           |
| `GET /api/scans/:id`          | Scan job ID                           | Progress, discovered activity, errors |
| `POST /api/evidence`          | Claim context and evidence references | Stored evidence record                |
| `POST /api/claims`            | NFT profile, quest ID, evidence IDs   | Claim ID and initial status           |
| `GET /api/claims/:id`         | Claim ID                              | Claim status, decision and reason     |
| `POST /api/claims/:id/retry`  | Claim ID and retry reason             | Resumed or rejected retry request     |
| `GET /api/evolution-jobs/:id` | Job ID                                | Stage, progress and current artifacts |

Do not expose a public route that lets users submit arbitrary XP or arbitrary trait updates.

### 7.3 Social account routes

| Method and route                  | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `POST /api/social/link/start`     | Generate a one-time bio verification challenge  |
| `POST /api/social/link/verify`    | Verify the challenge against the public profile |
| `GET /api/social/accounts`        | List the user's linked accounts                 |
| `DELETE /api/social/accounts/:id` | Unlink an account                               |

A linked social account proves control at the time of verification, not that a user liked a post or attended an event.

### 7.4 Internal worker routes

| Method and route                           | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| `POST /api/internal/workers/genlayer-poll` | Process pending GenLayer transactions        |
| `POST /api/internal/workers/evolution`     | Run eligible evolution jobs                  |
| `POST /api/internal/workers/reconcile`     | Find and resume stalled jobs                 |
| `POST /api/internal/genlayer-webhook`      | Optional authenticated notification receiver |

Internal endpoints must use worker authentication or equivalent access control. They must not be exposed as unauthenticated public actions.

### 7.5 Standard response envelope

Successful responses should use a consistent structure:

```
{
  "data": {
    "id": "evolution_job_123",
    "status": "GENERATING_ARTWORK"
  },
  "request_id": "req_123"
}
```

Errors should be equally structured:

```
{
  "error": {
    "code": "GENLAYER_PENDING",
    "message": "The adjudication is still awaiting final confirmation.",
    "retryable": true
  },
  "request_id": "req_124"
}
```

Never return secret values, raw credentials, or sensitive provider error details.

## 8. Environment variables and configuration

Commit `.env.example` with placeholders only. Keep actual credentials in local ignored environment files or the deployment platform's secret manager.

```
# Application
NODE_ENV=development
APP_URL=http://localhost:3000
API_BASE_URL=http://localhost:3000/api
SESSION_SECRET=
DATABASE_URL=

# Monad testnet
MONAD_TESTNET_CHAIN_ID=10143
MONAD_TESTNET_RPC_URL=
MONAD_TESTNET_EXPLORER_URL=
MONAD_TESTNET_FALLBACK_RPC_URL=

# Monad mainnet — original Chog ownership verification
MONAD_MAINNET_CHAIN_ID=143
MONAD_MAINNET_RPC_URL=
MONAD_MAINNET_EXPLORER_URL=
CHOG_ORIGINAL_COLLECTION_ADDRESS=

# Demo collection — populated after deployment
DEMO_CHOG_CONTRACT_ADDRESS=
DEMO_MINT_ENABLED=true

# GenLayer
GENLAYER_NETWORK=
GENLAYER_RPC_URL=
GENLAYER_CONTRACT_ADDRESS=
GENLAYER_PRIVATE_KEY=
GENLAYER_POLL_INTERVAL_MS=5000
GENLAYER_MAX_PENDING_AGE_MS=900000

# Gemini — server-side only
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=
GEMINI_MAX_ATTEMPTS=3

# Chog artwork references
CHOG_REFERENCE_REPOSITORY_URL=
CHOG_REFERENCE_COMMIT=
CHOG_REFERENCE_MANIFEST_PATH=assets/chog-references/manifest.json
CHOG_PROMPT_VERSION=chog-art-v1

# Durable asset storage
STORAGE_PROVIDER=
STORAGE_BUCKET=
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
IPFS_GATEWAY_URL=
IPFS_UPLOAD_PROVIDER=

# Worker configuration
WORKER_SECRET=
WORKER_CONCURRENCY=2
JOB_MAX_ATTEMPTS=5
JOB_RETRY_BASE_MS=1000
JOB_RECONCILE_INTERVAL_MS=60000

# Optional public social evidence
SOCIAL_FETCH_ENABLED=false
SOCIAL_FETCH_TIMEOUT_MS=10000
SOCIAL_FETCH_MAX_BYTES=5000000

# Observability
LOG_LEVEL=info
ERROR_TRACKING_DSN=
```

### 8.1 Configuration requirements

- `GENLAYER_NETWORK` must identify a currently supported GenLayer environment; verify the network and endpoint against the official documentation before deployment.
- `GENLAYER_PRIVATE_KEY` must be available only to the trusted backend process that needs to submit transactions. Use a dedicated, minimally funded account and never expose it to the frontend.
- `GEMINI_API_KEY` must not use a public frontend environment-variable prefix.
- `CHOG_ORIGINAL_COLLECTION_ADDRESS` must be the verified official contract address, not a marketplace URL or an address copied from an untrusted source.
- `CHOG_REFERENCE_COMMIT` pins the exact artwork reference revision.
- `STORAGE_*` configuration must point to durable storage. Local temporary files are not sufficient for production NFT assets.
- Public RPC endpoints should be configurable and subject to rate limits.
- Validate all required variables at startup and fail clearly when configuration is incomplete.

For Monad testnet, the expected chain ID is `10143`; Monad mainnet is `143`. Verify the current official network configuration before deploying contracts. The original Chog collection address and supported GenLayer environment remain deployment prerequisites, not values to guess.

## 9. Milestones and developer priorities

The following is a suggested two-week implementation plan for a small team with parallel frontend and backend work. Actual duration depends on GenLayer deployment access, reference-image preparation, and integration readiness.

## M1

Days 1–2

Foundation and integration spike

P0

- Confirm the five approved Chog references and pin their commit.
- Scaffold the application, PostgreSQL migrations and shared types.
- Verify the GenLayer development environment and deploy a minimal test contract.
- Verify Monad testnet RPC access and deploy a basic demo ERC-721.
- Test Gemini image generation using one approved reference.

Exit criteria: all critical providers work independently, and missing access or SDK issues are identified early.

## M2

Days 3–5

Evidence and adjudication

P0

- Implement wallet authentication.
- Create quest policies, claim and evidence schemas.
- Implement deterministic checks and claim deduplication.
- Build the GenLayer adapter and transaction-status tracking.
- Persist decisions and enforce required finality.

Exit criteria: a test claim receives a real, inspectable GenLayer decision, and rejected claims cannot reach the evolution worker.

## M3

Days 6–8

Progression and Gemini pipeline

P0

- Implement the XP ledger and progression rules.
- Build the trait catalogue and constrained art prompt.
- Implement Gemini generation, output validation and asset persistence.
- Publish metadata and commit versioned evolution history.
- Add retryable jobs and reconciliation.

Exit criteria: an accepted claim causes one real artwork generation and a persistent evolution; a duplicate request does not create a second reward.

## M4

Days 9–11

Platform integration

P0

- Complete the Evolution Lab and judge-facing UI.
- Implement demo minting and NFT dashboards.
- Add evidence submission and claim progress.
- Show the before-and-after image, traits, and decision history.
- Add error states and a repeatable demo scenario.

Exit criteria: a judge can complete the end-to-end experience through the UI.

## M5

Days 12–14

Real ecosystem data and hardening

P1

- Verify original Chog ownership and create companion profiles.
- Add one or more genuinely supported Monad activity quests.
- Add incremental rescan checkpoints.
- Test rate limits, service outages, and duplicate claims.
- Complete deployment documentation and the judge demo.

Exit criteria: the app clearly distinguishes supported real evidence from sample data, and all critical acceptance tests pass.

### 9.1 Workstream ownership

| Workstream         | Main deliverable                                                 | Priority |
| ------------------ | ---------------------------------------------------------------- | -------- |
| Smart contracts    | Demo ERC-721 and verified deployment                             | P0       |
| GenLayer           | Adjudicator, policy handling and lifecycle tracking              | P0       |
| Backend            | Evidence, claims, progression and durable jobs                   | P0       |
| AI/artwork         | Gemini integration and validated trait composition               | P0       |
| Frontend           | Evolution Lab and judge journey                                  | P0       |
| Data integration   | Original Chog verification and ecosystem scans                   | P1       |
| Social integration | Bio verification and supported public evidence                   | P1       |
| Advanced utility   | Passport sharing, crafting, arena and optional token integration | P2       |

The first engineering milestone must prove the complete vertical slice. Do not spend several days building a broad dashboard before confirming that GenLayer finality, Gemini generation, and persistent metadata can work together.

## 10. Error handling and retry specification

### 10.1 State machine

Every evolution job follows explicit states:

\#chatgpt-mermaid-\_r_13v\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_13v\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_13v\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_13v\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_13v\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_13v\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_13v\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_13v\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_13v\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_13v\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_13v\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_13v\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_13v\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_13v\_ p{margin:0;}#chatgpt-mermaid-\_r_13v\_ defs [id$="-barbEnd"]{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_13v\_ g.stateGroup text{fill:rgb(31, 78, 148);stroke:none;font-size:10px;}#chatgpt-mermaid-\_r_13v\_ g.stateGroup text{fill:rgb(237, 237, 237);stroke:none;font-size:10px;}#chatgpt-mermaid-\_r_13v\_ g.stateGroup .state-title{font-weight:bolder;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ g.stateGroup rect{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_13v\_ g.stateGroup line{stroke:rgb(175, 175, 175);stroke-width:1;}#chatgpt-mermaid-\_r_13v\_ .transition{stroke:rgb(175, 175, 175);stroke-width:1;fill:none;}#chatgpt-mermaid-\_r_13v\_ .stateGroup .composit{fill:transparent;border-bottom:1px;}#chatgpt-mermaid-\_r_13v\_ .stateGroup .alt-composit{fill:#e0e0e0;border-bottom:1px;}#chatgpt-mermaid-\_r_13v\_ .state-note{stroke:rgb(58, 132, 63);fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_13v\_ .state-note text{fill:rgb(237, 237, 237);stroke:none;font-size:10px;}#chatgpt-mermaid-\_r_13v\_ .stateLabel .box{stroke:none;stroke-width:0;fill:rgb(9, 23, 44);opacity:0.5;}#chatgpt-mermaid-\_r_13v\_ .edgeLabel .label rect{fill:rgb(9, 23, 44);opacity:0.5;}#chatgpt-mermaid-\_r_13v\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_13v\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_13v\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_13v\_ .edgeLabel .label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ .label div .edgeLabel{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ .stateLabel text{fill:rgb(237, 237, 237);font-size:10px;font-weight:bold;}#chatgpt-mermaid-\_r_13v\_ .node circle.state-start{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_13v\_ .node .fork-join{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_13v\_ .node circle.state-end{fill:rgb(31, 78, 148);stroke:transparent;stroke-width:1.5;}#chatgpt-mermaid-\_r_13v\_ .end-state-inner{fill:transparent;stroke-width:1.5;}#chatgpt-mermaid-\_r_13v\_ .node rect{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_13v\_ .node polygon{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_13v\_ [id$="-barbEnd"]{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_13v\_ .statediagram-cluster rect{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_13v\_ .cluster-label,#chatgpt-mermaid-\_r_13v\_ .nodeLabel{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ .statediagram-cluster rect.outer{rx:5px;ry:5px;}#chatgpt-mermaid-\_r_13v\_ .statediagram-state .divider{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_13v\_ .statediagram-state .title-state{rx:5px;ry:5px;}#chatgpt-mermaid-\_r_13v\_ .statediagram-cluster.statediagram-cluster .inner{fill:transparent;}#chatgpt-mermaid-\_r_13v\_ .statediagram-cluster.statediagram-cluster-alt .inner{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_13v\_ .statediagram-cluster .inner{rx:0;ry:0;}#chatgpt-mermaid-\_r_13v\_ .statediagram-state rect.basic{rx:5px;ry:5px;}#chatgpt-mermaid-\_r_13v\_ .statediagram-state rect.divider{stroke-dasharray:10,10;fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_13v\_ .note-edge{stroke-dasharray:5;}#chatgpt-mermaid-\_r_13v\_ .statediagram-note rect{fill:rgb(48, 48, 48);stroke:rgb(58, 132, 63);stroke-width:1px;rx:0;ry:0;}#chatgpt-mermaid-\_r_13v\_ .statediagram-note rect{fill:rgb(48, 48, 48);stroke:rgb(58, 132, 63);stroke-width:1px;rx:0;ry:0;}#chatgpt-mermaid-\_r_13v\_ .statediagram-note text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ .statediagram-note .nodeLabel{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ .statediagram .edgeLabel{color:red;}#chatgpt-mermaid-\_r_13v\_ [id$="-dependencyStart"],#chatgpt-mermaid-\_r_13v\_ [id$="-dependencyEnd"]{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);stroke-width:1;}#chatgpt-mermaid-\_r_13v\_ .statediagramTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].statediagram-cluster rect{fill:rgb(9, 23, 44);stroke:url(#chatgpt-mermaid-\_r_13v\_-gradient);stroke-width:1;}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].statediagram-cluster rect.outer{rx:5px;ry:5px;filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_13v\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_13v\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_13v\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_13v\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_13v\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_13v\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_13v\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_13v\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}QUEUEDVERIFYING_EVIDENCEAWAITING_GENLAYERREJECTEDNEEDS_REVIEWDECISION_PENDINGDECISION_FINALIZEDGENERATING_ARTWORKPUBLISHING_METADATARETRYABLE_FAILURECOMPLETEDFAILEDEvidence eligibleObjective check failsEvidence ambiguousTransaction submittedFinalized accepted decisionFinalized rejectionUndetermined outcomeImage validatedTransient errorAssets and profilecommittedStorage errorResume generationResume publishingRetry limit exceeded

`DECISION_PENDING` must preserve the underlying GenLayer lifecycle state. It must not assume that a submitted transaction, a successful RPC response, or an accepted-but-appealable result is finalized.

### 10.2 Retry policy

These are initial application defaults, not provider guarantees.

| Failure                                    | Handling                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Monad RPC timeout or rate limit            | Up to five short retries with exponential backoff and jitter; resume from the last confirmed checkpoint |
| GenLayer submission timeout                | Reconcile using the saved request and transaction identifiers before resubmitting                       |
| GenLayer pending decision                  | Poll with increasing intervals and persist status across restarts                                       |
| GenLayer undetermined or appealed decision | Follow documented lifecycle semantics; do not award XP or start generation                              |
| Gemini HTTP 429                            | Respect `Retry-After` where present; otherwise apply backoff                                            |
| Gemini transient HTTP 5xx                  | Up to three attempts initially, then defer to the background retry queue                                |
| Gemini request timeout                     | Check persisted results before another generation request                                               |
| Invalid Gemini image                       | One constrained regeneration attempt; then mark for review or failure                                   |
| Asset upload failure                       | Retry the upload without regenerating a valid image                                                     |
| Metadata upload failure                    | Resume metadata publication using the stored image                                                      |
| Database conflict                          | Reload the current state and reconcile the expected version                                             |
| Invalid credentials or configuration       | Stop automatic retries and alert the operator                                                           |

For short retries, a sequence around 1, 2, 4, 8 and 16 seconds plus jitter is reasonable. Longer jobs should be rescheduled rather than occupying a worker indefinitely.

### 10.3 Required idempotency rules

1. Assign every claim an idempotency key.
2. Enforce one logical claim per permitted evidence/quest combination.
3. Enforce one logical evolution job per accepted claim.
4. Before Gemini generation, check whether a valid image already exists for the job.
5. Before uploading metadata, check whether the correct metadata version already exists.
6. Commit XP, traits and evolution history in a single database transaction.
7. Use optimistic concurrency control on `evolution_version`.
8. Resume incomplete jobs after restarts through a reconciliation worker.

The platform must never award the same achievement twice because the user refreshed the page or a provider call timed out.

### 10.4 User-visible error codes

| Code                        | User-facing message                                                                |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `WALLET_NOT_AUTHENTICATED`  | Connect and verify your wallet before continuing.                                  |
| `UNSUPPORTED_NETWORK`       | Switch to the required network to continue.                                        |
| `NFT_NOT_VERIFIED`          | We could not verify this NFT against the configured collection.                    |
| `EVIDENCE_UNAVAILABLE`      | We could not access this evidence source. No reward was awarded.                   |
| `CLAIM_ALREADY_PROCESSED`   | This evidence has already been processed.                                          |
| `GENLAYER_PENDING`          | Your claim is awaiting final confirmation.                                         |
| `GENLAYER_UNDETERMINED`     | We could not reach a final decision. Your claim remains unresolved.                |
| `GEMINI_RATE_LIMITED`       | Artwork generation is temporarily busy. We will retry automatically.               |
| `ARTWORK_VALIDATION_FAILED` | The generated artwork did not meet the required design rules.                      |
| `STORAGE_UPLOAD_FAILED`     | Your artwork is ready but could not yet be published.                              |
| `EVOLUTION_CONFLICT`        | Your NFT profile changed during processing. We are reconciling the latest version. |
| `EVOLUTION_FAILED`          | This evolution could not be completed. Your previous appearance is safe.           |

Store detailed technical errors internally with a request ID. Do not expose stack traces, credentials, private prompts, or internal provider responses to the browser.

## 11. Test plan and acceptance tests

Use unit tests for policy and progression logic, integration tests for provider adapters and persistence, contract tests for the demo NFT, and end-to-end tests for the judge workflow.

### 11.1 Unit tests

| ID   | Test                                     | Expected result                                          |
| ---- | ---------------------------------------- | -------------------------------------------------------- |
| U-01 | XP threshold calculation                 | Correct stage is derived from the authoritative XP rules |
| U-02 | Unknown trait in evolution specification | Rejected by validation                                   |
| U-03 | XP exceeds quest reward cap              | Claim is rejected or safely bounded according to policy  |
| U-04 | Expired quest                            | No new reward is issued                                  |
| U-05 | Duplicate evidence                       | Existing claim is reused or duplicate is rejected        |
| U-06 | Policy version changes                   | Historical claim retains its original policy version     |
| U-07 | Invalid NFT identity                     | Registration is rejected                                 |
| U-08 | Metadata builder                         | Produces consistent attributes from authoritative state  |
| U-09 | Invalid image bytes                      | Artifact fails validation                                |
| U-10 | Evolution version conflict               | Stale update does not overwrite newer state              |

### 11.2 Integration tests

| ID   | Test                                            | Expected result                                                |
| ---- | ----------------------------------------------- | -------------------------------------------------------------- |
| I-01 | Monad testnet RPC returns valid ownership data  | NFT is registered with the correct identity                    |
| I-02 | RPC rate limit                                  | Retry occurs without losing the scan checkpoint                |
| I-03 | GenLayer accepts a valid claim                  | Decision is persisted and tracked through required finality    |
| I-04 | GenLayer rejects a claim                        | No XP award or Gemini job is created                           |
| I-05 | GenLayer response is malformed                  | Job is not advanced; error is recorded                         |
| I-06 | GenLayer transaction remains pending            | Job stays pending and resumes after restart                    |
| I-07 | Gemini returns a valid image                    | Image is validated and stored                                  |
| I-08 | Gemini returns a timeout                        | Retry reconciles existing output before another generation     |
| I-09 | Image upload succeeds but metadata upload fails | Publishing resumes without regenerating artwork                |
| I-10 | Database transaction fails at commit            | Profile and history do not become partially updated            |
| I-11 | Same job is processed concurrently              | Only one evolution version is committed                        |
| I-12 | Original Chog profile is evolved                | Companion profile changes; original metadata remains untouched |

### 11.3 End-to-end judge tests

## E2E-01 — Successful evolution

Critical release blocker

1. Connect a wallet.
2. Mint a demo Chog on Monad testnet.
3. Submit a supported claim with valid evidence.
4. Observe the GenLayer transaction and finalized decision.
5. Confirm the accepted evolution specification.
6. Generate artwork through Gemini.
7. Confirm the image and metadata are stored.
8. Confirm XP, traits and history update exactly once.

Pass: the new image is visible and every stage has an auditable record.

## E2E-02 — Rejected evidence

Submit evidence that definitively fails the quest criteria.

Pass: the claim is rejected; XP is unchanged; no Gemini generation is triggered.

## E2E-03 — Duplicate submission

Submit the same qualifying claim twice, including concurrent requests.

Pass: one logical reward and one evolution job are created.

## E2E-04 — Provider outage

Simulate a Gemini failure after GenLayer has finalized the accepted decision.

Pass: the job remains recoverable, the previous image stays visible, and retrying does not resubmit the reward.

## E2E-05 — Original Chog companion

Register an original Chog from the confirmed collection.

Pass: ownership is checked on mainnet, the companion profile evolves, and the UI does not claim that the original collection metadata changed.

## E2E-06 — Incomplete finality

Leave a GenLayer transaction in a pending or appeal-related state.

Pass: the application displays the pending state and does not create an evolution artifact or reward until the required finality condition is satisfied.

### 11.4 Release gates

Do not release the MVP until:

- all P0 tests pass;
- no test can award XP twice;
- no rejected or unresolved claim can trigger an evolution;
- API keys are absent from frontend bundles and repository history;
- a worker restart can recover an incomplete job;
- the judge can complete the successful evolution scenario;
- demo and original collection identities are visibly distinct;
- error states preserve the last valid NFT appearance.

## 12. Security and operational requirements

### 12.1 Security controls

- Wallet authentication: use a signed, expiring nonce; prevent replay and bind the session to the verified address.
- Secret management: keep Gemini, GenLayer, database, storage and worker credentials server-side.
- API authorization: check wallet ownership and profile permissions on every private request.
- Input validation: validate all addresses, IDs, URLs, JSON payloads, and file sizes.
- SSRF protection: the evidence fetcher must block localhost, private IP ranges, cloud metadata endpoints, and unsafe redirects. Prefer allowlisted domains where possible.
- Rate limiting: enforce per-wallet and per-IP limits on scans, claim submissions and artwork generation.
- Evidence integrity: preserve source references, retrieval timestamps and hashes; never treat an arbitrary user-provided hash as proof.
- Worker isolation: authenticate internal worker routes and prevent public users from invoking privileged jobs.
- Contract administration: restrict demo minting and any privileged metadata operations; publish the admin permissions.
- Auditability: record policy changes, manual overrides, finalized decisions and evolution commits.
- Data minimization: store only the public social evidence and account information needed for the stated feature.

### 12.2 Operational monitoring

Track at least these metrics:

| Metric                                              | Why it matters                                       |
| --------------------------------------------------- | ---------------------------------------------------- |
| Scan success and failure rate                       | Detect RPC outages and indexing gaps                 |
| GenLayer submission-to-finality duration            | Identify adjudication bottlenecks                    |
| Claims by final decision                            | Monitor accepted, rejected and unresolved outcomes   |
| Gemini generation success rate                      | Detect model or quota problems                       |
| Average artwork generations per completed evolution | Monitor retries and generation cost                  |
| Jobs stuck in each state                            | Identify worker failures                             |
| Duplicate claim rejection count                     | Detect replay attempts or faulty client behavior     |
| Metadata publication failure rate                   | Ensure generated assets become usable NFT metadata   |
| Cost per completed evolution                        | Control image-generation and infrastructure expenses |

Use structured logs with `request_id`, `claim_id`, `evolution_job_id`, and transaction references. Never log API keys or other secrets.

## 13. Deployment plan

### Environment A — Local development

- Run the web app, PostgreSQL, API, and worker locally.
- Use mocked external services for rapid UI development.
- Keep mock mode explicitly enabled through a development-only configuration.
- Test real GenLayer and Gemini integrations separately before the end-to-end release.

### Environment B — Public judge demo

- Deploy the frontend and API to a supported hosting environment.
- Use a managed PostgreSQL database.
- Run the evolution worker as a durable background process, not solely as a short-lived request handler.
- Deploy the demo ERC-721 to Monad testnet.
- Deploy the Intelligent Contract to the selected supported GenLayer development environment.
- Configure Gemini and storage credentials as server-side secrets.
- Seed a small, documented quest registry and provide a repeatable judge scenario.

Important: a serverless deployment alone may not be sufficient for long-running adjudication polling or durable workers. Choose a compatible background-job service or scheduled worker and ensure jobs survive application restarts.

### Environment C — Future production

- Add durable queues, operational alerts, and a managed retry/reconciliation process.
- Expand the supported quest registry only when evidence sources are established.
- Verify all official collection addresses and deployment permissions.
- Add stronger storage redundancy and operational monitoring.
- Consider a private Monad RPC if public endpoint limits become a bottleneck.
- Complete contract security review before enabling valuable mainnet actions.

## 14. Decisions that remain external prerequisites

The architecture is finalized, but implementation must still verify these facts rather than invent them:

1. The five Chog reference images: provide the public GitHub repository and pin the approved commit.
2. Original Chog collection: confirm the official Monad mainnet contract address and supported NFT standard.
3. GenLayer deployment: confirm the target environment, current SDK version, contract interface and finality-monitoring method.
4. Gemini access: verify that your API key supports the selected image-generation model and required image-input features.
5. Storage: select an available durable asset-storage provider.
6. Quest sources: establish at least one genuinely verifiable ecosystem activity for the first real quest.

Until these are verified, the codebase should use explicit configuration placeholders and documented mock fixtures rather than guessed addresses or fabricated results.

## 15. Final build checklist

## Implementation tracker

### 0/10

Repository and reference assets

Approved Chog references pinned and documented

Monad demo NFT

Testnet contract deployed and minting verified

GenLayer adjudicator

Structured decisions, duplicate protection and finality tracking

Evidence service

One supported quest with documented verification criteria

Progression engine

Authoritative XP, stage thresholds and trait validation

Gemini artwork pipeline

Server-side generation, validation and durable storage

Evolution persistence

Versioned metadata, profile updates and immutable history

Original Chog companion mode

Authentic ownership verification without original metadata mutation

Error recovery

Idempotent jobs, retry policies and restart reconciliation

Judge experience

End-to-end walkthrough with clear real-versus-demo labelling
