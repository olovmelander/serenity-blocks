# One World boot bakes in a Worker (plan item 2.1)

Status: **LANDED 2026-08-21** (commit `c97ad8bd` on `feature/game_improvements_20260724`; measured
cells `r185p1world` in `reports/odyssey-perf/rtx3070-r181-vs-r185/AGGREGATE.md`). three 0.185.1,
Electron 38 / Chrome 140. Plan: `docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md` row 2.1.

How it was decided: a DevTools sampling profile of the Odyssey activation (self/inclusive time by
function inside the `world` span), then a read-only research workflow — four lenses (world stages,
worker patterns, startup sequencing, three upload paths), two independent designs (worker-first vs
main-thread slicing + IndexedDB cache), an adversarial critique (worker 8/10, slicing 4/10: slicing
cannot hide CPU behind CPU-bound startup work and caps at ~−0.5 s) and a synthesis. What shipped
is the worker design with the critique's three amendments, and one deliberate simplification of
the synthesis (§2.4).

---

## §0 Problem, gate, result

**Problem.** `createOdysseyWorld()` ran synchronously inside `trace('world')`: **1,737 ms** on every
cold cell (r185p1live medians), of which 1,08–1,14 s were five deterministic texture bakes (relief
+ derivatives, sun fields, ground atlas, detail normal + cloud silhouette, macro) and ~0.5 s the
cloud-field SDF sculpt — one long task, the largest frame in every cell since r181. Profile
(Chrome, inclusive): cloud field 685 ms, relief 596, sun fields 383, macro 318; plus
`buildHeroCloudGeometry` sculpted unconditionally for a mesh that is mounted only when `heroes`
(retired, default false) — pure waste.

**Gate (plan row).** `world` ≤ 650 ms; long-task max 1,767 → ≤ 300 ms; cold startup −1.0…−1.4 s;
bytes identical (golden hashes); no visual change (ADR-0007).

**Result (Electron cold session, 2026-08-21; n = 3 cells in AGGREGATE.md):** startup total
5,580 → 3,982 ms, board visible 6,615 → 5,057, `world` 1,737 → **207 ms**; the 1.7 s long task is
gone (largest task left: the 0.68 s app-boot task in `main.js`, outside Odyssey); worker stages
relief 476 / sunFields 308 / atlas 34 / detail 112 / macro 311 / cloudField 528 ms, relief landed
at +961 ms, everything at +1.9 s; sync pipeline creations after the reveal still 0; the chapter-3
capture renders the full world from the worker plates; 12 goldens + 4 loader tests byte-identical.

---

## §1 Stage inventory (what moved, what stayed)

| Stage | Inputs | Deterministic | Where now | Measured (worker, Electron) |
|---|---|---|---|---|
| relief + derivatives + height mirror (`bakeReliefData`) | `reliefRes` | yes (integer hashes) | **worker, stage 1** — posted first, `data` transferred, `total` copied (the worker keeps its own for the sun fields) | 476 ms |
| sun fields (`bakeGroundSunFieldsData`) | relief sampler, `shadowRes` | yes | worker, stage 2 | 308 ms |
| ground atlas (`bakeGroundAtlasData`) | — | yes (pinned) | worker, stage 2 (its `avg[]` — TSL constants in the ground graph — travel with the data and are byte-identical, so the material graph is unchanged) | 34 ms |
| detail normal + cloud silhouette (`bakeDetailNormalData`) | — | yes (pinned) | worker, stage 2 | 112 ms |
| macro (`bakeMacroData`) | — | yes | worker, stage 2 | 311 ms |
| cloud-field sculpt (`buildCloudFieldGeometryData`) | specs slice + 48 rail points (LOD promotion) | yes (`makeRng(seed)`) | worker, stage 3 — five Float32Arrays transferred; the main thread wraps attributes + bounding sphere | 528 ms |
| hero clouds | specs | yes | **not built** unless `heroes` | 0 |
| clipmaps ×3, 9 TSL material graphs, sky/water/lake, god rays/motes/fish reseat, forest scatter + per-variant geometry + InstancedMesh compose | relief sampler, rail | yes | main thread, in the `world` span, after the nodes | ~200 ms total |

Follow-ups the inventory makes obvious: the forest scatter (`scatterZonedForest`, three-free,
needs only the height mirror + rail) is the next candidate for the worker; an IndexedDB cache keyed
by quality + a bake-schema stamp would remove even the worker cost on second launch.

---

## §2 Mechanism (as landed)

### 2.1 Pure halves
`src/rendering/odyssey/world/odyssey-world-bake-data.js` holds the bakes that lived in the renderer
module, extracted verbatim (same loops, same order, same `DataUtils.toHalfFloat` from `three` core);
`odyssey-ground-bakes.js` and `odyssey-cloud-field.js` are split into `*Data` (typed arrays) +
`wrap*` (three objects) pairs, with the old names kept as wrappers that accept an optional `baked`.
The module imports `three` core only (tree-shaken to `DataUtils`, `IcosahedronGeometry`,
`BufferGeometry`): the production worker chunk is 107 KB with no WebGPU/TSL.

### 2.2 Worker + loader
`odyssey-world-bake.worker.js` receives `{ reliefRes, shadowRes, cloudSpecs, railSamples,
cloudField }` and posts `relief` → `textures` → `cloudField` → `done` (or `error`), each with its
buffers in the transfer list. `odyssey-world-bake-loader.js` `startWorldBake()` returns
`{ relief, textures, cloudField, done }` promises + `viaWorker`; with no Worker (vitest, a spawn
failure, `?odysseyWorldBakeSync=1`) the **synchronous twin** (`bakeWorldSync`, same functions, same
order) runs on the first *access* of any stage — an overridden `.then` would not do: `await` on a
native promise bypasses it — so the fallback bakes exactly where the old synchronous build did and
the caller's prologue is never charged. A worker error mid-way falls back the same way.

### 2.3 Sequencing in `OdysseyBoardController.initialize()`
1. Quality + path layout known → `this._worldBake = startWorldBake(...)` **before
   `await this.initRenderer()`** (`_readWorldBuildOptions()` derives quality table, cloud spec
   slice and the 48 plain rail points once, shared by the bake and the build).
2. renderer · creates · path run as before (the worker bakes meanwhile).
3. nodes: `await this._worldBake.relief` → `setGroundSampler(makeReliefSampler(relief))` (the
   nodes need only the height mirror; measured wait ≈ 130 ms cold).
4. `world` span, now AFTER the nodes: `prebaked = await awaitWorldBake(this._worldBake)` →
   `createOdysseyWorld({ prebaked, … })` builds clipmaps, materials, cloud-field mesh (wrapped), props
   and forest from the landed arrays; `stats.prebaked` records provenance and per-stage worker ms.
5. post+director (the One World prewarm joins the compile pool as before) · compiles · warm-up.

### 2.4 Deviation from the synthesis — no placeholders
The synthesis proposed a two-phase world: build it early on zero-filled textures of final size and
land each plate on arrival (the lake-noise precedent), with barriers before the nodes and the
compile pool. Shipped instead: build the whole world after the nodes from landed arrays. Reasons:
the measured wait at that point is ~130 ms (the worker's 1.9 s overlaps renderer 358 + creates 441
+ path 28 + nodes ~830), which the placeholder shape would recover only partially while adding a
landing contract (texture swaps off the render loop, forest mounted late, two barriers, a failure
path that must un-suppress chapters). The simpler shape keeps `createOdysseyWorld` single-phase
and the world's failure fallback intact. If the remaining wait ever matters, the relief-first
message already supports landing the nodes earlier; the textures could follow the placeholder
route then.

### 2.5 Failure contract
A worker failure resolves to the synchronous twin; a twin failure rejects every stage — the
controller logs it, passes `prebaked = null`, and `createOdysseyWorld` bakes itself exactly as before
inside the existing try/catch (`reportWorldBuildFailure`, `oneWorldEnabled = false`,
`suppressedChapters` cleared). Because the world now builds after the startup chapter creates, a
late failure no longer re-creates chapters 2–5 in the startup loop; the background loader picks
them up (they are outside the startup set).

---

## §3 Tests
- `tests/unit/odyssey-world-bakes-golden.test.js` (12): atlas, sun fields, cloud silhouette (as
  before) + relief `data`/`total` at 96², macro at 64², `bakeWorldTextureData` shape + transfer
  list + per-stage timings.
- `tests/unit/odyssey-world-bake-loader.test.js` (4): synchronous twin byte-identical to the direct
  bakes; lazy stage resolution without a Worker; `createOdysseyWorld({ prebaked })` bakes nothing it
  was given and produces the same five plates (`world.bakeTextures`) and cloud field; mismatched
  resolution / spec slice is ignored, never trusted.
- Existing source pins kept green: `odyssey-cloud-swap` flag polarity (the build reads the flags
  literally), `odyssey-gpu-profile-sampling` (hide-level-nodes lever within reach of
  `createNodes`), `odyssey-world-default`, seating, forest, clipmap suites (323 files, 3,332 tests).

## §4 Measurement
Session: `[OdysseyStartup]` buckets (`world`, `nodes`), `world-bake started/relief landed/landed`
events with per-stage ms, `stats.prebaked.viaWorker`; long-task max; `pipelines.sync` after the
reveal (still 0). Driver: `perf-driver.sh … r185p1world`, n = 3 cold/warm/idle, Chrome tab blank,
no edits during the pass. ADR-0007: `odyssey-chapter-capture.mjs --chapter 3 --time 9`.

## §5 Rollback
`?odysseyWorldBakeSync=1` forces the synchronous twin (same bytes, main thread, at the world step —
i.e. after the nodes rather than before the creates). Removing the `startWorldBake` call restores
the pre-2.1 order entirely; `createOdysseyWorld` without `prebaked` is the old function.

## §6 Risks / open
- Worker spawn under the packaged `file://` CSP (`worker-src 'self' file: blob:`) is covered by the
  same Vite `new URL(…, import.meta.url)` shape as the lake worker; verified in `vite build` output,
  not yet in a packaged Electron run.
- The ~130 ms relief wait before the nodes on the RTX box could be larger on a slow CPU; the
  `world-bake relief landed` event makes it visible per run.
- `stats.bakeMs.relief` now measures the wrap (≈2 ms) — the bake times live in
  `stats.prebaked.workerMs`.
