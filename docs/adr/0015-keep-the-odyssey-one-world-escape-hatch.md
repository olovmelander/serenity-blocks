# 0015 — Keep the Odyssey One World escape hatch

- **Status:** accepted
- **Date:** 2026-08-12
- **Plan hook:** ODYSSEY_ONE_WORLD_PLAN_2026-08.md § "Wave 4/6 deletion manifest (audited)"

## Context

Odyssey's Act II (chapters 2–5) was rebuilt from eight alpha-crossfaded "diorama" chapter
environments into one continuous world. The flip shipped and is the default. Waves 4 and 6 of
the plan were written to delete the machinery the dioramas needed, and both were blocked on
one prerequisite: retiring `?odysseyOneWorld=0`, the flag that restores them. The plan called
that "an owner call, not a refactor", and `docs/adr/` had nothing on it.

A 13-agent audit tested the premise both waves rest on — "this code is only reachable via the
fallback" — with two independent adversarial lenses per target. **All eight verification
passes refuted it.** Three findings decide this ADR:

1. **The hatch is not the only entrance to the fallback.** `OdysseyBoardController.js` wraps
   `createOdysseyWorld()` in a catch that clears `suppressedChapters` *before* the
   chapter-creation loop, so on a **completely default boot** — no flag — a world-build
   failure recovers into a full diorama journey. The ordering was verified. This is a
   flagless crash-recovery path that happens to share its machinery with the flag.
2. **Retiring it converts a recoverable failure into a silent void.** With the dioramas gone,
   the same throw leaves `this.oneWorld` null; every consumer is null-guarded, so boot
   completes and the ribbon, orbs, traveller and atmosphere dome all still draw. Chapters 2–5
   simply have no ground and no sky. Orbs revert to raw spline positions, so the degraded
   state is *self-consistent* — it does not look broken enough to fail a smoke test.
3. **The deletions it would unlock mostly cannot happen anyway.** `mountain-language.js` is
   imported by the shipped **winter theme**; `canonical-mountain-range.js` is in the
   **production bundle** (`vite.config.js` registers `playground.html` as a rollup input, and
   `dist/assets/canonical-mountain-range-*.js` exists in the built output); 34 of the ~47
   ecotone bridges belong to chapters 1, 7 and 8, which still draw, and r181 makes
   `material.opacity` a dead write wherever an `opacityNode` is authored, so removing a bridge
   makes its chapter snap instead of fade.

## Decision

**Keep `?odysseyOneWorld=0`, and keep the diorama modules it restores.**

- The flag stays a tri-state (`options.oneWorld === true` wins; `=== false` forces off;
  otherwise the URL decides, defaulting ON). Pinned by `odyssey-world-default.test.js`.
- The crash-catch stays, and now **reports loudly** — a dismissible player-facing banner plus
  a capped `localStorage` failure log (`world/world-build-failure-report.js`). Silent recovery
  was the actual defect: it is how we would have retired the fallback while some machine
  quietly needed it.
- Ch2's fallback-only ecotone bridges are **kept**. The audit listed them as the one safe
  deletion; they stopped being safe the moment the fallback became a path we intend to work,
  because deleting them degrades the recovery rather than costing nothing.
- What was genuinely dead was deleted instead, and only that: `rangeAuthority` (sole writer,
  sole reader), the `ECOTONE_*` span-scaling arithmetic (verified to lose to the `seamWidth`
  floor at all seven boundaries, so it never once produced the window), and the manager-side
  3-4/4-5 seam colour windows (proven dead stores on the default path).

## Consequences

- The plan's Waves 4 and 6 close as **rescoped, not executed**. Wave 4's real purpose — ending
  the duplicate authority over the mountain silhouette — was achieved by moving the peak specs
  into `world/odyssey-peak-specs.js`. Wave 6's deletion premise is dead; its constructive half
  (replacing crossfades with occlusion moments) survives as its own item.
- Odyssey keeps ~1,100 lines of engine code the plan intended to remove. That is the price of
  a working recovery path on hardware we do not own, and it is cheaper than the alternative:
  a driver-specific TSL failure rendering two thirds of the journey as empty fog, silently.
- `tests/unit/odyssey-wave46-scope-invariants.test.js` encodes each blocker as an assertion,
  so re-deriving the deletion plan breaks a test rather than the game.
- Revisit if the world's build failure log stays empty across real user hardware for a
  meaningful period, AND the playground effects that execute the chapter builders are retired.
  Both are prerequisites, not evidence on their own.
