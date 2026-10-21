---
project: CHOG Evolution
register: brand
aesthetic_direction: playful / toy
color_strategy: committed
design_system: bespoke semantic HTML with native controls
design_variance: 8
motion_intensity: 7
visual_density: 4
---

# CHOG Evolution design language

## Design Read

A mischievous purple creature with a life of its own: oversized comic-poster typography, black space, and a collectible story that grows with its owner.

## Signature

The CHOG wordmark becomes a stage for the supplied purple character: huge, tightly set lettering, an overlapping creature, and a circular evolution trail. Repeat the circular trail in progress displays, without repeating the hero composition on every page.

## Inspiration

The requested reference is https://www.chog.xyz/. Live inspection was attempted but DNS is unavailable in this workspace; no claims about its current layout are made. The actual inspected sources are the project's five supplied Chog images. Take their purple quills, expressive faces, black line work and community playfulness. Build an original editorial story and task-focused routes. Never present reference artwork as a newly minted or evolved NFT.

## Color (locked)

Purple is explicitly required by the user. Use flat purple and black, without purple-to-blue gradients, gradient text, glass cards, or background glow.

| Role           | Hex     | Use                                                                 |
| -------------- | ------- | ------------------------------------------------------------------- |
| background     | #09070d | Main black canvas                                                   |
| surface        | #15101d | Quiet app panels                                                    |
| elevated       | #21182e | Hover and selected panels                                           |
| text           | #faf7ff | Primary text                                                        |
| muted          | #beb2cc | Secondary text                                                      |
| subtle         | #a294b4 | Captions                                                            |
| border         | #594767 | Decorative rules and panel separation                               |
| control-border | #7e6992 | Functional input/button boundaries, minimum 3.50:1 on dark surfaces |
| accent         | #a779ff | Purple buttons, active marks, major story surfaces                  |
| accent-ink     | #130b20 | Text on purple                                                      |
| success        | #a9d6ba | Confirmed results                                                   |
| warning        | #ecd39a | Waiting/review                                                      |
| danger         | #ffa9b5 | Errors                                                              |
| info           | #d2bcff | Informational text                                                  |

Calculated OKLCH and WCAG contrast from the actual stylesheet are recorded in [contrast.json](contrast.json). Primary/muted/subtle text measures 6.02–18.91:1 on the three dark surfaces; accent-ink on accent is 6.22:1. Control boundaries measure 3.50–4.13:1. Never place white body text on accent. Approximately 60% black, 30% art/purple surface, 10% text/control accents. These calculations do not replace rendered browser accessibility review.

## Type (locked)

Display and body: locally bundled Ubuntu Sans variable. Display uses its narrow width and 800 weight, the bundled font's actual maximum; body uses normal width and 400–600 weight. This deliberate one-family pairing keeps the character of the curved letterforms while contrasting density. DejaVu Sans Condensed was unavailable. Display is uppercase, tightly tracked at -0.055em, line-height .88, clamped from 52 to 180px. Product titles clamp 36–68px. Body 16–18px/1.6, captions no smaller than 12px. Data use tabular numerals. Headings balance; body lines stay under 70ch.

## Scales (locked)

Spacing: 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128px. Radius: 4, 12, 24px and fully rounded buttons/chips. Borders 1px; hero art may use a 2px outline. No nested panels. Content width 1280px, reading width 720px. Breakpoints 640, 768, 1024, 1280px. Targets at least 48px. Z layers: base 0, sticky 30, modal 50, toast 70, skip link 80.

Motion: fast 150ms, base 300ms, reveal 500ms; cubic-bezier(.16,1,.3,1). One staggered intro; scroll reveals through the story; slow scroll-linked parallax of hero art; a horizontal evolution sequence on large screens. Movement communicates arrival, discovery and progress. Reduced motion renders all content immediately with no parallax. Content remains visible without JS. Pause any loop when offscreen. Never delay a mint or form for decoration.

## Voice

Friendly, direct and slightly mischievous. "Meet your Chog", "Start your story", "Find my Chogs", "Check for an evolution", "Share your contribution". Label the mint as a real NFT on Monad Testnet; keep the distinction concise. No simulated user outcomes, invented statistics, raw provider errors, contract addresses or transaction hashes in form fields. Explorer links are optional receipts. Do not promise an evolution before evaluation is accepted.

Every screen must read as the same product if placed side by side.
