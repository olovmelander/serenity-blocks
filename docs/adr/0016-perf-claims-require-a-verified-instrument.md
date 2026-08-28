# 0016 — Performance claims require a content-matched measurement from a verified instrument

- **Status:** accepted
- **Date:** 2026-08-12
- **Plan hook:** ODYSSEY_ONE_WORLD_PLAN_2026-08.md § 0.3 ("what the plan got wrong")

## Context

ADR-0007 already says a WebGPU/TSL **visual** change is not done without a screenshot, because
this project repeatedly shipped visual regressions that looked fine in reasoning. The Odyssey
One World plan demonstrated the same failure mode in the **performance** dimension, four times
in one document, and every instance was plausible enough to survive review and get quoted as
settled fact:

- **"69 % of every drawn frame is rail furniture."** Built on a 66,560-triangle path ribbon.
  The live ribbon is 15,360 — the figure came from an un-capped spec constant while the builder
  caps it twice over. An entire wave item ("ribbon streaming") existed to optimise 3 % of the
  forest.
- **"55 orbs × 3 nested transparent shells"** — actually two transparent shells and one
  *opaque* depth-writing core, with measured blended coverage of **0.86 % of the frame**. The
  fill hypothesis the wave was organised around had the wrong shape entirely.
- **The A/B that would have caught both had never run.** `setAllVisible` omitted the inner-core
  mesh, so the "hidden" half of the comparison still drew 31.8 % of the group, and the URL flag
  was a silent no-op unless a second flag was also passed. Both perf reports carried
  `levelNodesMs: null` against a harness with a purpose-built configuration for it.
- **The sampler was dwell-weighted.** three's `Info.reset()` clears drawCalls and triangles but
  deliberately **not** `render.timestamp` — only `dispose()` does. Reading it once per FRAME
  therefore records one resolved value repeated for however many frames it lingered. A slower
  lane resolves less often, so its samples weigh more: the bias lands hardest on exactly the
  lane being judged against a budget, and no post-processing can undo it.

Two further traps were found while fixing those. The harness published a **scene difference as
thermal drift** (`baselineDriftMs: 0.786`) because the camera drifted off the seeked station —
53 draws in one baseline, 39 in its repeat — and nothing compared them. And a single
contaminated run (a Chrome tab rendering WebGPU at 240 fps on the same adapter) produced a
confident "the Lane A baseline is 3× what we published" that a clean re-run refuted.

## Decision

A performance claim is not admissible — into a plan, a budget cell, or a commit message —
unless all four hold:

1. **The instrument is verified.** GPU samples are recorded **once per resolved query**, never
   once per frame. `src/playground/main.js` and
   `OdysseyBoardController._resolveRenderTimestamps` are the reference implementations.
2. **The baselines are content-matched.** Two runs compared as a differential must agree on
   draw calls exactly and on triangles within 2 %. `scripts/odyssey-gpu-split.mjs` enforces
   this and **voids** the figure with a `baselineDriftVoidReason` rather than publishing it.
3. **The station is pinned.** Seeking is not enough — the camera controller's travel model
   overrides it on the next frame. Zero `travelModel.velocity`, `inputVelocity` and
   `config.autoDriftScale`, and record the achieved position.
4. **The machine is quiet.** No browser tab rendering WebGPU, no stray Vite server. A single
   run is a hypothesis; a claim needs a repeat that agrees.
5. **A differential claim reports n ≥ 3 per arm, as median + range, with both arms on the same
   instrument build and the same protocol** (amended 2026-08-25). Not every *field* needs this —
   some are structural and land identically on every run while others swing 30 %+ on identical
   code; which is which is an empirical property of the instrument, and publishing it is part of
   verifying the instrument. The theme lane's field-by-field table is
   `THEME_FLEET_SWEEP_2026-08.md` §18; other harnesses owe their own. And when choosing a
   representative run from an arm, check the fields the change was NOT about — a median on one
   axis can be the outlier on another (the sweep retracted a published cell for exactly this,
   §22).

Quantisation is part of the reading, not noise to average away: GPU timestamps land on
**65.536 µs** boundaries, so two configurations in the same bucket mean "difference below
resolution", never "zero cost".

## Consequences

- Budget cells may carry a **null baseline** rather than a number taken from an unverified run.
  `perf-budgets.json`'s `odysseyWorldGpuP50LaneBMs` does exactly this, deliberately.
- Scoping work off an unmeasured cost is the specific failure this forbids. Wave 7 spent its
  design on a subsystem that measures **0.000 ms** on the lane that could be measured.
- This does not require measuring everything. It requires that anything *presented as a number*
  came from an instrument someone checked — and that an unmeasured cost is written as unmeasured
  rather than estimated into the plan as fact.
- Enforcement: `tests/unit/odyssey-gpu-profile-sampling.test.js` (sampling shape, A/B wiring)
  and `tests/unit/odyssey-gpu-split-content-match.test.js` (the void guard).
