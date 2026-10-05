# Immersive breathing and Hale sessions — October 2026

> **Superseded 2026-10-05** by [BREATHING_OVERHAUL_2026-10.md](BREATHING_OVERHAUL_2026-10.md). The renderer, worlds, guide
> and menus described here were rebuilt; the files this document names no longer exist. Kept for its
> behaviour findings (phase boundaries, ownership, cancellation), which the rebuild preserves.

## Delivered experience

All twelve breathing worlds now have distinct foreground forms and particle movement, as well as their own atmospheres. The follow-up removes the shared circular aperture, circular phase track and reused wireframes that made the first overhaul feel like color variants. A neutral linear phase track, readable instructions, countdown and phase steps explain the rhythm without imposing a common silhouette.

| World | Foreground form | Breath movement |
| --- | --- | --- |
| Aurora Dreams | Four flowing vertical ribbons | Ribbons spread and rise, then fall |
| Sacred Geometry | Square with four traced edges | Square opens; each breathing phase advances its own edge |
| Moonlit Waters | Crescent moon and reflected horizon | Moonlit tides lift and settle |
| Solar Flare | Long solar rays and corona | Rays extend and draw inward |
| Heart Glow | Six petals and a second flower whorl | Petals unfold and close |
| Crystal Prism | Triangular prism and refracted beams | Prism expands; its beams diverge |
| Volcanic Fire | Tall flame with nested fire tongues | Flame rises and settles |
| Ocean Tide | Four broad horizontal wave crests | Crests lift and return |
| Zen Garden | Incomplete textured brush stroke, stone and sand | Brush stroke opens subtly and settles |
| Cosmic Nebula | Three spiral arms | Spiral unfurls and gathers |
| Ancient Forest | Branching tree with individual leaves | Canopy opens and branches rest |
| Electric Storm | Two forked currents | Branches reach outward with continuous travelling light |

The visible **Hale sessions** control opens guided journeys directly. The Hub tab uses the same label, and Breathing includes a permanent **Choose a Hale session** action. Select **Start Hale Base**, **Elixir**, **Rest**, or **Flow**, then use the enabled **Start** button in preparation; intentions are optional. A cancellable countdown leads into the session.

The four journeys have illustrated selection cards, durations calculated from their session definitions, separate phase and overall progress, and completion results. Guided instructions sit above the artwork with session progress below it. Starting a session acquires ownership before the Hub closes, so paused falling-block gameplay remains paused throughout the journey; closing the Hub after ending/completing restores play. Portrait and landscape layouts use the same artwork.

## Rendering ownership and cost

The breathing overlay remains an intentional **classic WebGL2 surface**, compatible with three.js **0.186.1**, under ADR-0008. This does not change the game's theme renderer or the existing dependency pin. There is no second WebGPU renderer to initialize for breathing.

A retained scene replaces twelve separately rebuilt scenes. Two transparent shader planes supply atmosphere and the distinct foreground forms; a single GPU particle layer supplies mode-specific movement. The renderer retains exactly three draw objects, geometries and materials. Technique changes update shared uniforms without replacing resources or recompiling materials. There are no external textures, bloom framebuffers, CPU particle-array uploads, or renderer-module imports at menu boot. Analytic glow preserves transparency over the selected game theme.

| Tier | Particle budget | Maximum pixel ratio | Render cadence |
| --- | ---: | ---: | --- |
| Extreme | 1,000 | 1.75 | display refresh |
| High | 650 | 1.5 | display refresh |
| Medium | 400 | 1.25 | up to 45 Hz |
| Low | 220 | 1 | up to 30 Hz |
| Minimal | 100 | 0.8 | up to 30 Hz |

Coarse-pointer/small-screen devices default to Low. Reduced motion removes ambient particle/form/environment motion while retaining the essential breathing cue. ResizeObserver updates the camera and canvas after viewport changes. Page visibility suspends renderer work; stop and disposal retire frame requests and all nested scene resources. Context loss or WebGL startup failure leaves an animated CSS guide with technique-specific silhouettes available.

## Behavior repairs

- Breath phase boundaries retain fractional elapsed time and skip zero-duration phases immediately. Catch-up frames resolve the current phase before notifying audio, and long suspension skips whole missed cycles instead of replaying stale voice cues.
- Standalone guide visibility/pause preserves its position in the breath. Externally controlled sessions retain the session manager's clock when returning from a hidden page.
- Grounding uses each session's declared pattern. Retention shows the empty hold. Recovery's inhale, hold, and release fit within its existing duration. Prescribed phase durations and audio assets are retained.
- Guided sessions own their rhythm. Library controls, keyboard shortcuts, and gamepad cycling cannot replace it; Space returns to session controls.
- Native session/library controls consume their activation keys without also triggering global shortcuts. Dialogs retain accessible keyboard focus without scrolling their parent surface out of view.
- Ending a session, stopping a game mode or activating another mode cancels countdowns, guided audio and stale callbacks. Completion cannot reopen the Hub in another mode. Indicator destruction also removes its sibling progress display.

The session manager's pre-existing programmatic pause/resume restarts the current session phase; this change does not expose a new pause control. The indicator's own pause/resume preserves its breathing position.

## Verification

The capture runner is `scripts/capture-breathing-overhaul.mjs`. It imports shipping modules and styles in an isolated Vite surface, captures every world and guided session stage at 1440×900, 390×844, and 844×390, records shader/console failures, checks native ResizeObserver behavior, and measures retained resources after repeated technique changes. `--gameSmoke` also drives the real application's Serenity/Hub entry points. Use an installed Playwright module and Chromium executable via `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH`; no browser dependency is added to production.

Validation results are recorded alongside the final capture report. Software Chromium evidence establishes rendering compatibility, composition and bounded work. It does not establish native desktop or physical-phone FPS, and long session audio is covered by lifecycle tests rather than a real-time replay of every full journey.

### First-overhaul checks (historical, before the identity follow-up)

- The twelve-world/four-session matrix captured 153 frames across desktop, portrait and landscape, with no shader/console failures, control overflow, ResizeObserver failures or teardown leaks.
- After warming every world and switching techniques 26 times, renderer counts remained at 10 geometries, zero textures and four programs. The most complex visible world used six draw calls.
- The full unit run initially passed 5,642 tests with six failures. Three presentation assertions were updated for the new transforms; the four affected files then passed all 41 tests sequentially. The other three failures were unrelated load-sensitive timeouts/performance checks. Their production code and test budgets were unchanged.
- Type checking, the lint ratchet and dependency boundaries passed. The lint baseline decreased from 1,170 to 1,147 existing errors. Architecture fitness passes after each mode control captures the indicator once: global DOM reads decrease from 525 to 519, and raw shader material construction decreases from 303 to 299. Both ceilings are lowered in the baseline. TypeScript pragma, theme lifecycle, release and performance-budget gates also pass. The production build passed its boot-closure gate; the entry and main static closures each contain three chunks, and the breathing renderer stays lazy.

The matrix's source fingerprints are preserved. Final dialog-layout, copy and timing/input repairs are verified separately with settled UI captures, regression tests and a real-application Vite smoke flow. This distinguishes the artwork/resource evidence from the final interaction evidence.

Final targeted coverage passes **117 tests in nine files**. The settled UI pass captures **69 frames** (23 per viewport), including all four preparation, countdown, active and completion flows. Screenshots and the compact source-provenance report live in [reports/breathing-immersive-overhaul](../reports/breathing-immersive-overhaul/README.md).


### Identity and Hale entry follow-up

The new captures and interaction evidence are recorded separately in
[reports/breathing-identity-and-hale-entry](../reports/breathing-identity-and-hale-entry/README.md).
The earlier report above preserves the source fingerprints and resource counts of the first overhaul.
