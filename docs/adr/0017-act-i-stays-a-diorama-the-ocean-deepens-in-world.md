# 0017 — Act I stays a diorama; the ocean deepens in-world

- **Status:** accepted
- **Date:** 2026-08-12
- **Plan hook:** ODYSSEY_ACT_I_REBIRTH_PLAN_2026-08.md §4 (the architecture decision)

## Context

The Act I rebirth plan had to answer where Act I lives: inside the One World environment
(the Act II continuous world, ADR-0015), or as it ships today — Earth Core its own interior
chapter, the underwater stretch drawn by the world.

The facts that decide it, each measured or verified against the code on 2026-08-12:

- **The ocean IS the world already.** `uSubmerged`, the water-mode sky, caustics, god rays
  (and, from the plan's Waves 4–5: depth bands, the SSS ceiling, motes, fish) live in
  `odyssey-world-renderer.js`; `deep-ocean.js` is suppressed on the default path
  (`ONE_WORLD_CHAPTERS = [2,3,4,5]`).
- **A heightfield is single-valued; the cavern is under the sea floor.** Earth Core occupies
  y ∈ [−52, 123] at XZ (−3, 5), where `odysseyWorldHeight(−3, 5) = 98.7` — the world's own
  ocean floor. Hosting the cavern in-world means carving the clipmap (a per-fragment tax on
  the measured 0.393 ms Act II ground and a break in the "one surface" structural claim that
  `odysseyWorldDrawCallsLaneA` gates) or parenting a cave-mesh set under the world group,
  which is the diorama with a worse name.
- **The camera can never see both at once.** The only crossing is the vertical crack at
  p ≈ 0.077, inside the steam quench's occlusion window (0.033–0.153) — capture-verified,
  including the plan's Wave 6 asymmetric-density fix.
- **The registry/crash-recovery contract needs the module anyway.** ADR-0015's flagless
  crash-catch loads chapter modules; `earth-core.js` must keep its three convention-derived
  exports regardless of where its content is hosted.

## Decision

**Earth Core stays its own interior chapter, rebuilt in place to One World discipline;
the underwater stretch deepens inside the world, where it already lives.** Felt continuity
across the act is delivered by contract, not by co-residence:

- one colour script per act sharing machinery and invariants (`ODYSSEY_ACT1_COLOUR_SCRIPT`
  beside `ODYSSEY_COLOUR_SCRIPT`, handoff asserted by test);
- one light language (a single key plus darkness-gated response, flipped warm→cool by the
  quench, pre-seeded through the god-ray tint walk);
- the steam quench as the act edge (occlusion, never crossfade — the One World rule).

## Consequences

- Earth Core keeps its own frame's fixed costs, controlled by the plan's budget cells
  (`odysseyAct1Ch1*` in `perf-budgets.json`) and the drawable ratchet
  (`tests/unit/earth-core-drawable-budget.test.js`).
- The world's underwater span may grow content (bands/SSS/motes/fish shipped at a measured
  Lane B **saving** — 7.73 → 5.96 ms p50) but never chapter-shaped special cases; anything
  that needs a chapter identity belongs to the chapter module.
- Not re-litigated here: ADR-0015 (hatch + modules stay), the act-gate margin 0.03,
  `ONE_WORLD_CHAPTERS`.

## Enforcement

`odyssey-world-act-gate.js` (the 0.03 margin and its do-not-raise note), the registry
consistency tests, the Act I colour-script tests (handoff + warm/cool exclusivity), and the
drawable ratchet. The plan's §4 carries the full evidence table.
