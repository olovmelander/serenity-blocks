# Immersive breathing and Hale sessions — October 2026

## Delivered experience

All twelve breathing worlds share a responsive, breath-led visual language. A luminous aperture expands on inhale, settles during a hold, and recedes on exhale. Phase text remains readable, seconds count down, and a slim progress arc and phase steps explain the rhythm. Each world has its own atmosphere: aurora curtains and mountains, sacred patterns, moonlit reflections, solar filaments, rose light, prismatic rays, molten ridges, underwater caustics, raked sand, nebula clouds, forest silhouettes, and electric currents.

The four Hale-inspired journeys (BASE, ELIXIR, REST, FLOW) have distinct illustrated selection cards, durations calculated from the actual session definitions, preparation and intention screens, a cancellable countdown, separate phase and overall journey progress, and completion results. Guided instructions sit above the artwork with session progress below it. Portrait and landscape layouts use the same artwork.

## Rendering ownership and cost

The breathing overlay remains an intentional **classic WebGL2 surface**, compatible with three.js **0.186.1**, under ADR-0008. This does not change the game's theme renderer or the existing dependency pin. There is no second WebGPU renderer to initialize for breathing.

A retained scene replaces twelve separately rebuilt scenes. Two transparent shader planes supply atmosphere and the breathing aperture; GPU particles and a small retained 3D motif complete the scene. Technique changes update uniforms and visibility. There are no external textures, bloom framebuffers, CPU particle-array uploads, or renderer-module imports at menu boot. Analytic glow preserves transparency over the selected game theme.

| Tier | Particle budget | Maximum pixel ratio | Render cadence |
| --- | ---: | ---: | --- |
| Extreme | 1,000 | 1.75 | display refresh |
| High | 650 | 1.5 | display refresh |
| Medium | 400 | 1.25 | up to 45 Hz |
| Low | 220 | 1 | up to 30 Hz |
| Minimal | 100 | 0.8 | up to 30 Hz |

Coarse-pointer/small-screen devices default to Low. Reduced motion removes ambient particle/orbit/environment motion while retaining the essential breathing cue. ResizeObserver updates the camera and canvas after viewport changes. Page visibility suspends renderer work; stop and disposal retire frame requests and all nested scene resources. Context loss or WebGL startup failure leaves an animated CSS guide available.

## Behavior repairs

- Breath phase boundaries retain fractional elapsed time and skip zero-duration phases immediately. Catch-up frames resolve the current phase before notifying audio, and long suspension skips whole missed cycles instead of replaying stale voice cues.
- Standalone guide visibility/pause preserves its position in the breath. Externally controlled sessions retain the session manager's clock when returning from a hidden page.
- Grounding uses each session's declared pattern. Retention shows the empty hold. Recovery's inhale, hold, and release fit within its existing duration. Prescribed phase durations and audio assets are retained.
- Guided sessions own their rhythm. Library controls, keyboard shortcuts, and gamepad cycling cannot replace it; Space returns to session controls.
- Native session/library controls consume their activation keys without also triggering global shortcuts. Dialogs retain accessible keyboard focus without scrolling their parent surface out of view.
- Ending a session or leaving Serenity cancels countdowns and stale callbacks. Completion cannot reopen the Hub in another mode. Indicator destruction also removes its sibling progress display.

The session manager's pre-existing programmatic pause/resume restarts the current session phase; this change does not expose a new pause control. The indicator's own pause/resume preserves its breathing position.

## Verification

The capture runner is `scripts/capture-breathing-overhaul.mjs`. It imports shipping modules and styles in an isolated Vite surface, captures every world and guided session stage at 1440×900, 390×844, and 844×390, records shader/console failures, checks native ResizeObserver behavior, and measures retained resources after repeated technique changes. `--gameSmoke` also drives the real application's Serenity/Hub entry points. Use an installed Playwright module and Chromium executable via `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH`; no browser dependency is added to production.

Validation results are recorded alongside the final capture report. Software Chromium evidence establishes rendering compatibility, composition and bounded work. It does not establish native desktop or physical-phone FPS, and long session audio is covered by lifecycle tests rather than a real-time replay of every full journey.

### Recorded checks

- The twelve-world/four-session matrix captured 153 frames across desktop, portrait and landscape, with no shader/console failures, control overflow, ResizeObserver failures or teardown leaks.
- After warming every world and switching techniques 26 times, renderer counts remained at 10 geometries, zero textures and four programs. The most complex visible world used six draw calls.
- The full unit run initially passed 5,642 tests with six failures. Three presentation assertions were updated for the new transforms; the four affected files then passed all 41 tests sequentially. The other three failures were unrelated load-sensitive timeouts/performance checks. Their production code and test budgets were unchanged.
- Type checking, the lint ratchet and dependency boundaries passed. The lint baseline decreased from 1,170 to 1,147 existing errors. The production build passed its boot-closure gate; the entry and main static closures each contain three chunks, and the breathing renderer stays lazy.

The matrix's source fingerprints are preserved. Final dialog-layout, copy and timing/input repairs are verified separately with settled UI captures, regression tests and a real-application Vite smoke flow. This distinguishes the artwork/resource evidence from the final interaction evidence.

Final targeted coverage passes **117 tests in nine files**. The settled UI pass captures **69 frames** (23 per viewport), including all four preparation, countdown, active and completion flows. Screenshots and the compact source-provenance report live in [reports/breathing-immersive-overhaul](../reports/breathing-immersive-overhaul/README.md).
