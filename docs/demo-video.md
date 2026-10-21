# CHOG Evolution demo — 2 minutes 30 seconds

The main aim is to show the deployed project in action. Use real screen recordings for about 85% of the video, with short motion transitions, captions, and a generated storyteller voice. Target 150 seconds; hard limit 179 seconds. Record at 1920×1080, 30 fps.

| Time     | On-screen action                                                                                                                                     | Voiceover                                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–10s    | Open Home, move from the headline to the Chog. Brief title overlay: “Your activity shapes your Chog.”                                                | “What if your NFT could keep a history of what you actually do? This is CHOG Evolution. Let me show you how a contribution becomes part of your Chog’s story.”                                                                                                                                                          |
| 10–30s   | Connect the chosen wallet, open My Chog, show token #1, Curious, 50 XP and bright eyes.                                                              | “I connect my wallet and open My Chog. This is my demo NFT on Monad Testnet. I already minted it, so we won’t mint another. That mint earned 50 XP after the decision finalized, unlocking the Curious stage and bright eyes.”                                                                                          |
| 30–45s   | Profile: scroll to verified @Mfon_crypto connection. Brief “Verified identity” callout.                                                              | “My public X account is verified using a bio code. The app binds its stable identity to my wallet. That lets it check that submitted posts are mine and prevents the same identity from collecting rewards through another wallet.”                                                                                     |
| 45–75s   | Open contribution review; paste post 2112752750228357333 and context; preview the actual text and four images. Scroll enough to show the captures.   | “Now I open contribution review. I paste a public X post, add a little context, and preview it. The app reads the public post, checks the author, and saves its text and attached images. This is the evidence that will be reviewed. A ready preview confirms capture and attribution; it doesn’t guarantee a reward.” |
| 75–95s   | Click Submit for review once, then open the newly saved claim and timeline.                                                                          | “I submit the captured source for GenLayer review. The claim page shows its current status and evidence. While consensus is pending, XP stays unchanged. I can leave and return to the same saved review.”                                                                                                              |
| 95–125s  | Clearly labeled cut: “Completed mint review.” Open existing finalized mint claim, show explanation/reference; Evolution before/after; hover artwork. | “Here’s the completed mint review from earlier. GenLayer finalized the decision, and the app recorded exactly one 50 XP reward. The evolution history preserves the before and after, with the source and decision reference. The published artwork reflects the Chog’s authoritative stage and traits.”                |
| 125–145s | Open public Passport, show XP, traits and history; refresh once and show persistence.                                                                | “The public passport brings the Chog, traits, and history together. Refreshing keeps the same progress and artwork. For an original Chog, evolution lives in the companion profile while the original collection metadata remains read-only.”                                                                           |
| 145–150s | Short branded close over the real app: logo/wordmark, URL and “Built on Monad · Adjudicated with GenLayer.”                                          | “CHOG Evolution. Make your mark. Watch it evolve.”                                                                                                                                                                                                                                                                      |

## Voice and motion direction

Generated voice: an original adult storyteller voice, warm and curious, conversational English, clear pronunciation, around 135–145 words per minute. Small pauses while screens change. Avoid theatrical delivery. Pronounce CHOG as “chog,” Monad as “MOH-nad,” and GenLayer as “jen-layer.”

Generate narration in seven separate clips so the edit can follow actions. Keep about 15–20 seconds across the cut for silent UI interaction. Use a low-volume instrumental bed only if available and licensed; speech should be clear.

Use the existing ink/violet/cream identity. Title holds of 1–2 seconds, gentle cursor zooms, thin violet focus rings, and a simple “Evidence → Decision → Evolution” transition. Animate headings and callouts; keep the actual app legible. Avoid replacing the walkthrough with promotional slides.

## Recording and truthfulness

- Use the user’s chosen wallet and already minted token #1. Wallet connection/signing remains a genuine user action.
- Show a shortened wallet address. Never record environment files, keys, browser storage, or signing/debug consoles.
- Record the contribution capture after the source fix is deployed. Submit only once. If the newer claim is still pending, keep its true status and cut to the separately labeled completed mint claim.
- Existing artwork version 1 was published by `chog-trait-renderer-v2`. Say “published artwork.” Only say Gemini generated an image when an actual successful publication records that provenance.
- The new Gemini key authenticates, but image requests currently return 429 RESOURCE_EXHAUSTED for free-tier quota. Do not make Gemini success a demo claim while this remains unresolved. Narration generation can use a separate available TTS model/provider.
- Preserve genuine acceptance or rejection. Preview readiness is not eligibility approval, and finality is not instant. Contribution rewards are checked at finalization with the daily cap and cooldown.
- If the preview expired, recapture before recording. Use the full supplied post URL; no mock evidence or invented transactions.
- Captions: two lines maximum, high contrast; hold references long enough to read.

## Capture links

- Home: https://chog-evolution.vercel.app
- Profile: https://chog-evolution.vercel.app/profile
- Contribution review: https://chog-evolution.vercel.app/upgrade
- Current post: https://x.com/Mfon_crypto/status/2112752750228357333
- Completed mint claim: https://chog-evolution.vercel.app/claims/8fc7778f-1692-4f41-b751-2811661be5cc
- Public passport: https://chog-evolution.vercel.app/passport/1549a11b-e86b-469b-9a97-fccb9e26d0a9
- Evolution: https://chog-evolution.vercel.app/evolution

Deliverables for the build: a 150-second 1080p MP4, seven narration clips, caption file, and editable motion composition. This document is the production plan; no rendered video is claimed yet.
