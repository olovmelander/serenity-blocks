# Chiral Gold — event choreography follow-up

This pass continues the merged October overhaul. The paired foil sculptures,
amber atmosphere and shared WebGPU/WebGL2 node renderer remain the artwork's
foundation. It gives the reactions distinct shapes and timing, preserves the
gold surface during events, and keeps piece-lock feedback reliable during
sustained play.

## Reactions

The existing fixed corona pool now draws broken orbital strokes. Each stroke
has a copper tail, an amber body and a narrow ivory leading glint. Three.js
torus UVs drive the material mask; no texture fetch, new particle system or
event-time geometry allocation is required. Both renderer backends use the
same material graph.

| Event | Motion | Lifetime |
| --- | --- | ---: |
| Lock | One quick arc on the locked side; a compact outward snap at the lock height | 0.78 s |
| Clear | Two traveling strokes with a wider expansion and modest upward drift | 1.45 s |
| Four-line clear | Three strokes on each side, counter-rotating and lifting together | 2.10 s |
| Combo | Paired three-stroke flourishes; the second side starts 0.12 s later and both rise farther | 2.30 s per side |

Reaction alpha rises quickly and decays smoothly. Traveling foil fronts are
narrower and their combined brightness is bounded. Their amber highlights and
the reduced global kick preserve the dark metallic body when multiple events
overlap. Active corona anchors are recomputed during resize, so an orientation
change keeps them at the peripheral sculptures.

The geometry and pool counts from the initial overhaul are retained. All
qualities keep their sculpture silhouette. Reaction strength now uses the
theme's existing quality-dependent event scale.

## Gameplay routing

Clear reactions originate at the projected center of the cleared-row band.
Infinity's canonical viewport origin takes precedence over absolute grid rows.
Locks select the corresponding side instead of alternating regardless of piece
position. The local spark burst remains at the projected piece itself.

A matching COMBO and LINE_CLEAR received at the same simulation time no longer
launch two hero corona pairs. If COMBO arrives first, LINE_CLEAR adds a
`clear-front` at the row band without replacing the combo flourish. If a
four-line clear arrives first, its hero flourish remains and the matching COMBO
does not duplicate it. Event context includes source, player and level when
present. Independent events and standalone clears with positive combo values
retain their response.

An explicit combo count of zero is authoritative. It cannot borrow a stale
pending count from a previous event; a missing count can still consume the
pending value for compatibility when source, player and level match. A clear
from another context consumes and retires the pending value without borrowing
it. The same-context handoff survives an intervening animation frame.

Cleared rows emit one symmetric pair of small dissolve batches at the band
edges. Previously each row consumed two whole CPU pool slots, so a four-line
clear could exhaust the pool partway through and lose one side. Coalescing the
band keeps the sparse visual connection while leaving capacity for locks and
the larger decorative bursts.

When all CPU burst pools are busy, a lock reclaims the oldest decorative pool.
If every pool already contains lock feedback, it replaces the oldest lock.
Retirement clears the previous particles and reuses the same geometry and
arrays. Decorative bursts still preserve active bursts when the pool is full.
This policy changes only background feedback.

## Verification

The extended capture script supports `playground`, `theme` and `game` modes,
targeted lock positions, event ages, and a four-phase timeline. The `game` mode
uses the actual single-player board and HUD, with gameplay simulation frozen
while the production theme advances. The event bus drives background reactions.
It checks that the mode is running and one Phaser board canvas exists before
capturing. This verifies composition beside the gameplay UI; it is not an
end-to-end play session.

Local visual validation captured 47 screenshots, 47 companion state reports
and 21 aggregate reports across the isolated sculpture, shipped theme and
actual single-player game. All final aggregate runs passed with zero browser
or shader-validation errors. Every production run stopped cleanly, and all
three native High compute systems reported ready. Screenshots and diagnostic
artifacts are retained locally; this publication includes the code and
reproducible capture harness.

For an installed Playwright/Chromium runtime, set `PLAYWRIGHT_MODULE` and
`CHROMIUM_EXECUTABLE` if they are not discoverable locally, then run:

```bash
node scripts/chiral-gold-visual-validation.mjs playground --native --event combo --timeline --image-format jpeg --output-dir reports/chiral-gold-local-validation
node scripts/chiral-gold-visual-validation.mjs theme --native --image-format jpeg --output-dir reports/chiral-gold-local-validation
node scripts/chiral-gold-visual-validation.mjs game --mobile --event combo --event-age .42 --image-format jpeg --output-dir reports/chiral-gold-local-validation
```

The actual Low phone game reached a clean rendering state. Its landscape
background fills the viewport, while the short-screen board/statistics layout
still extends below the viewport after a normal resize; this is a separate HUD
layout limitation. Software-adapter captures establish rendering correctness
and lifecycle behavior. Physical GPU frame rate, phone performance and battery
cost remain unmeasured.

Focused regressions cover reaction duration, staggered combo timing, lock side,
front-only composition, deterministic reset, orientation-change anchors,
explicit-zero combo routing, event-context deduplication, projected clear
origins, symmetric dissolve emission and saturated CPU lock recovery.

The final local suite passes 548 files and 6,012 tests in 64.07 seconds.
The production build passes in 22.56 seconds, including the boot-closure gate.
Typecheck, scoped ESLint, dependency boundaries, theme lifecycle, architecture
fitness, TypeScript ratchet and structural performance/release gates pass.
The measured repository lint ceiling is lowered from 1,103 to 1,070.
