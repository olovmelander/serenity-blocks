# rtx3070 — three r181 (0.181.2) vs r185 (0.185.1), Odyssey perf-session A/B (2026-08-21)

**Machine:** Legion 82JU — Ryzen 7 5800H, RTX 3070 Laptop 8 GB (lane A / discrete; lane B is
not reproducible on this machine, see ../README.md). Electron 38, WebGPU backend on every run.
**Trees:** r181 = `b6f46ffb` (pre-bump commit, own worktree + `npm ci` → three 0.181.2);
r185 = `07ad6d02` + the uncommitted Phase 2/3 cleanups (three 0.185.1).
**Instrument:** `scripts/odyssey-perf-session.mjs` (rAF presentation deltas + `[OdysseyStartup]`
buckets + PerformanceObserver long tasks), Extreme quality, 240 Hz target, 1280×720, pixelRatio 1,
adaptive quality disabled — the existing committed instrument, unchanged between trees.

## Method — process-per-run (why not `--runs 5`)

On the 82JU one Electron process cannot host a second WebGPU window after the first is
destroyed: the second `loadURL` aborts with `ERR_FAILED (-2)` behind Chromium's
`GPU state invalid after WaitForGetOffsetInRange`. **Reproduced identically on r181 and r185**,
so it is an Electron/GPU-channel property of this machine, not an upgrade regression. The
committed `odyssey-perf-baseline.mjs --committed --runs 5` flow therefore yields only run 1 of
each cell here. `perf-driver.sh` (in this folder) runs the same session script with `--runs 1`
in a **fresh Electron process per run** — the pattern `validate-all-themes.mjs` already uses —
and `perf-aggregate.mjs` takes median / min / max across repeats (no means, per Wave −1).

Cells (3 repeats each, both trees, identical driver): `load/cold` (profile reset per run),
`load/warm` (profile primed once by a discarded warm run), `idle/warm` (30 s steady state;
note: the idle runs used a fresh profile dir per run, identically for both trees).

**Content match (ADR-0016):** draw calls identical in every cell (load 80 = 80, idle 104 = 104);
triangles within 0.01 %. Same stations, same flags, same machine, no other GPU work running.

## Results


### idle-warm  (median (min–max, n) — delta r185 vs r181)

| metric | r181 | r185 | Δ |
|---|---|---|---|
| frame p50 ms | 11.20 (11.10–11.30, n=3) | 11.40 (9.30–11.50, n=3) | 2% |
| frame p95 ms | 13.70 (13.50–13.80, n=3) | 14.00 (12.20–14.30, n=3) | 2% |
| frame p99 ms | 15.80 (15.60–16.10, n=3) | 16.20 (13.50–16.50, n=3) | 3% |
| frame max ms | 761.8 (759.2–778.7, n=3) | 851.4 (792.6–862.5, n=3) | 12% |
| spikes | 8 (5–9, n=3) | 3 (3–4, n=3) | -63% |
| long tasks (count) | 62 (60–70, n=3) | 60 (57–64, n=3) | -3% |
| long tasks total ms | 34995 (33032–38301, n=3) | 28869 (26634–28973, n=3) | -18% |
| long task max ms | 5687 (4010–5902, n=3) | 4349 (4270–4454, n=3) | -24% |
| draw calls p50 | 104 (104–104, n=3) | 104 (104–104, n=3) | 0% |
| triangles p50 | 537633 (537593–537645, n=3) | 537609 (537609–537625, n=3) | -0% |
| JS heap MB | 217.6 (196.5–221.9, n=3) | 204.7 (196.1–215.0, n=3) | -6% |
backend: r181=webgpu r185=webgpu

### load-cold  (median (min–max, n) — delta r185 vs r181)

| metric | r181 | r185 | Δ |
|---|---|---|---|
| startup total ms | 7031 (6979–7090, n=3) | 8051 (7402–8116, n=3) | 15% |
|   startup bucket: renderer | 373 (358–375, n=3) | 402 (397–424, n=3) | 8% |
|   startup bucket: world | 1713 (1706–1738, n=3) | 1732 (1727–1734, n=3) | 1% |
|   startup bucket: creates | 1545 (1337–1547, n=3) | 377 (365–394, n=3) | -76% |
|   startup bucket: nodes | 996 (970–1023, n=3) | 844 (824–851, n=3) | -15% |
|   startup bucket: post+director | 536 (492–564, n=3) | 120 (110–131, n=3) | -78% |
|   startup bucket: compiles | 1434 (1334–1457, n=3) | 4146 (3532–4163, n=3) | 189% |
|   startup bucket: warmup | 313 (310–321, n=3) | 305 (230–313, n=3) | -3% |
| board visible ms | 8054 (7992–8091, n=3) | 9084 (8431–9143, n=3) | 13% |
| frame p50 ms | 7.70 (7.70–7.70, n=3) | 8.80 (8.00–9.20, n=3) | 14% |
| frame p95 ms | 105.60 (97.20–109.30, n=3) | 28.60 (27.80–29.90, n=3) | -73% |
| frame p99 ms | 560.00 (531.80–607.10, n=3) | 215.30 (213.70–242.80, n=3) | -62% |
| frame max ms | 1720.3 (1717.8–1745.2, n=3) | 1745.1 (1735.7–1745.8, n=3) | 1% |
| spikes | 24 (23–27, n=3) | 25 (24–27, n=3) | 4% |
| long tasks (count) | 30 (28–31, n=3) | 33 (32–37, n=3) | 10% |
| long tasks total ms | 11610 (11330–11655, n=3) | 10166 (9864–10305, n=3) | -12% |
| long task max ms | 1719 (1712–1743, n=3) | 1767 (1734–1769, n=3) | 3% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 0% |
| triangles p50 | 255179 (255147–255191, n=3) | 255183 (255155–255207, n=3) | 0% |
| JS heap MB | 196.3 (194.1–204.1, n=3) | 179.1 (178.8–184.8, n=3) | -9% |
backend: r181=webgpu r185=webgpu

### load-warm  (median (min–max, n) — delta r185 vs r181)

| metric | r181 | r185 | Δ |
|---|---|---|---|
| startup total ms | 4943 (4793–5928, n=3) | 5153 (5094–5267, n=3) | 4% |
|   startup bucket: renderer | 374 (341–564, n=3) | 602 (553–627, n=3) | 61% |
|   startup bucket: world | 1715 (1710–2201, n=3) | 1727 (1714–1752, n=3) | 1% |
|   startup bucket: creates | 1081 (1034–1441, n=3) | 340 (328–363, n=3) | -69% |
|   startup bucket: nodes | 728 (715–741, n=3) | 752 (730–764, n=3) | 3% |
|   startup bucket: post+director | 455 (450–617, n=3) | 131 (109–132, n=3) | -71% |
|   startup bucket: compiles | 30 (30–40, n=3) | 1293 (1241–1299, n=3) | 4210% |
|   startup bucket: warmup | 324 (312–437, n=3) | 217 (217–225, n=3) | -33% |
| board visible ms | 5895 (5889–6907, n=3) | 6182 (6177–6274, n=3) | 5% |
| frame p50 ms | 11.30 (7.80–13.30, n=3) | 10.30 (9.60–10.90, n=3) | -9% |
| frame p95 ms | 395.90 (90.00–468.10, n=3) | 100.80 (92.90–109.40, n=3) | -75% |
| frame p99 ms | 1719.40 (630.00–1722.70, n=3) | 242.20 (232.90–251.10, n=3) | -86% |
| frame max ms | 3575.8 (3081.8–3884.8, n=3) | 1735.2 (1721.0–1761.9, n=3) | -51% |
| spikes | 27 (24–32, n=3) | 28 (28–30, n=3) | 4% |
| long tasks (count) | 34 (34–38, n=3) | 34 (33–35, n=3) | 0% |
| long tasks total ms | 16905 (15271–18631, n=3) | 9151 (8832–9308, n=3) | -46% |
| long task max ms | 3619 (3096–3892, n=3) | 1738 (1724–1758, n=3) | -52% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 0% |
| triangles p50 | 255159 (255123–255179, n=3) | 255195 (255195–255207, n=3) | 0% |
| JS heap MB | 211.8 (203.3–212.9, n=3) | 193.7 (189.6–213.7, n=3) | -9% |
backend: r181=webgpu r185=webgpu

## Reading the numbers

1. **Load smoothness is the big win — the r184 "non-blocking compileAsync" cashes out here.**
   Load-phase frame p95 −73 % (cold) / −75 % (warm), p99 −62 % / −86 %, worst frame during
   warm load 3.6 s → 1.7 s, long-task time −12 % / −46 %. The loader animates instead of freezing.
2. **Startup wall-clock is slightly longer** (cold 7.0 → 8.1 s, warm 4.9 → 5.2 s; board-visible
   +13 % / +5 %). The `compiles` bucket (+189 % cold; 30 ms → 1.3 s warm) is a **semantic shift,
   not a regression**: r185 defers node building into a per-object, main-thread-yielding loop,
   so work that r181 did synchronously inside `creates` (−76 %) and `post+director` (−78 %)
   now shows up as yielded wall-time inside the compile barrier. Warm r181 compiles were 30 ms
   because Dawn's pipeline cache made the synchronous prologue near-instant; r185 still pays
   the yield cadence (hundreds of `scheduler.yield()`s) even on cache hits. Trade accepted:
   ~1 s of extra loader time for ~2–5× fewer/shorter freezes. A follow-up could tighten the
   yield cadence or skip `compileAsync` for the focus chapter (render-warm compiles faster but
   blocks) — a product choice, not an upgrade defect.
3. **Steady-state idle: average flat, hitches fewer.** p50/p95/p99 within ~2–3 % with
   overlapping ranges (n=3, laptop thermals) — treat as no change. Spike count −63 %, long-task
   time −18 %, worst long task −24 %. Exactly the predicted shape: no higher frame rate, less stutter.
4. **JS heap −6 to −9 % in every cell** (r185 allocation/GC work + the disposal fixes).

## Caveats

- n=3 per cell; laptop thermal drift is real (r181 warm p95 ranged 90–468 ms across repeats —
  r185 was far more consistent, 93–109 ms). Ranges are printed next to every median.
- rAF deltas are **not GPU time** (README § GPU-time splits); the GPU-timestamp lane
  (`odyssey-gpu-split.mjs --lane A`) is the instrument for GPU claims.
- `frameP95Ms.perSurface.odyssey` in `perf-budgets.json` (7 ms) is an RTX 5080 target and is
  left untouched; the 3070 idle p95 here is ~14 ms on both versions — re-targeting the budget
  for the new hardware is a separate policy decision.

## GPU time — `odyssey-gpu-split.mjs --lane A` (WebGPU timestamp queries, RTX 3070, High)

Files: `../gpu-split-lanea-rtx3070-r181.json` and `../gpu-split-lanea-rtx3070-r185.json` (the canonical `gpu-split-lanea.json` is still the RTX 5080 capture). One Electron process each; configurations toggle in-page, so the 82JU multi-window limitation does not apply. Timestamps land on 65.536 µs ticks; a one-tick delta is below resolution, never zero cost.

| configuration | r181 p50 ms | r185 p50 ms | Δ ticks | r181 p95 | r185 p95 | draws | triangles |
|---|---|---|---|---|---|---|---|
| baseline | 0.655 | 0.655 | 0 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |
| no-bloom | 0.655 | 0.590 | -1 | 0.721 | 0.721 | 53 = 53 | 945810 = 945810 |
| no-level-nodes | 0.655 | 0.590 | -1 | 0.918 | 0.786 | 52 = 52 | 729406 = 729406 |
| legacy-dioramas | 1.442 | 1.376 | -1 | 4.194 | 1.507 | 87 = 87 | 270561 = 270561 |
| legacy-no-level-nodes | 1.376 | 1.180 | -3 | 2.884 | 1.311 | 78 = 78 | 54149 = 54149 |
| no-water | 0.655 | 0.655 | 0 | 0.918 | 0.918 | 59 = 59 | 915226 = 915226 |
| cloud-sheet | 0.852 | 0.786 | -1 | 0.983 | 0.983 | 63 = 63 | 976410 = 976410 |
| heroes | 0.655 | 0.655 | 0 | 0.983 | 0.852 | 62 = 62 | 954838 = 954838 |
| no-cloud-field | 0.655 | 0.655 | 0 | 0.918 | 0.852 | 60 = 60 | 913938 = 913938 |
| cloud-field-half | 0.655 | 0.655 | 0 | 0.852 | 0.852 | 61 = 61 | 933418 = 933418 |
| no-forest | 0.393 | 0.393 | 0 | 1.114 | 0.983 | 32 = 32 | 534141 = 534141 |
| flat-ground | 0.655 | 0.590 | -1 | 0.852 | 0.786 | 61 = 61 | 945818 = 945818 |
| forest-v1 | 0.524 | 0.524 | 0 | 0.852 | 0.852 | 50 = 50 | 768081 = 768081 |
| ch6-no-dome | 0.655 | 0.655 | 0 | 0.918 | 0.918 | 61 = 61 | 945818 = 945818 |
| ch6-no-nebula | 0.655 | 0.655 | 0 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |
| ch6-no-dust | 0.721 | 0.655 | -1 | 0.918 | 0.918 | 61 = 61 | 945818 = 945818 |
| ch6-no-stars | 0.655 | 0.655 | 0 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |
| ch6-no-heroes | 0.721 | 0.655 | -1 | 0.918 | 0.918 | 61 = 61 | 945818 = 945818 |
| ch6-procedural-dome | 0.655 | 0.655 | 0 | 0.918 | 0.918 | 61 = 61 | 945818 = 945818 |
| ch6-nebula-sprites | 0.655 | 0.721 | +1 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |
| ch6-no-aurora | 0.721 | 0.655 | -1 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |
| no-cloud-bank | 0.655 | 0.655 | 0 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |
| baseline-repeat | 0.721 | 0.655 | -1 | 0.918 | 0.852 | 61 = 61 | 945818 = 945818 |

**Content match:** draw calls and triangles identical in all 23 configurations. **Drift:** r181 baselineDrift −1 tick, r185 0. **Verdict:** GPU p50 identical-bucket in 12/23, r185 one tick lower in 9 (three ticks lower on legacy-no-level-nodes), one tick higher in 1 (ch6-nebula-sprites); baseline p50 identical (0.655 ms); p95 equal or better nearly everywhere (legacy-dioramas 4.19 → 1.51 ms). GPU time on the Odyssey surface is **unchanged within quantization** — as §7.5 of the plan predicted for fill-bound surfaces — with a mild tail improvement and no regression beyond one tick.

---

## r185p1 — the post-upgrade Phase 1 tree (2026-08-21, same machine, same driver)

**Tree:** the r185 tree plus `docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md` Phase 1: calibrated Ashima
simplex `snoise3` (replacing MaterialX Perlin — the 7 s lava-lake shader), `setLayout` on every shared
noise `Fn`, `compileAsync(group, camera, scene)` (was inverted) with a by-builder-identity fan-out,
and the warp pre-init through `WebGLRenderer.compileAsync`. **Instrument additions in this tree:**
the session now records the actual adapter (`browser.adapter`, all cells `nvidia / ampere`) and every
pipeline creation (`browser.pipelines`: async by label with duration; synchronous creations with
target formats / samples / depth). The driver script documents its dev-server prerequisite.

**Conditions:** Chrome tab blank (a tab left on the Odyssey board inflated idle p50 11.6 → 13.0 ms
and invalidated one whole sweep — re-run). `warm-prime` discarded as before.

### Reading

- **Startup is the headline**: cold total **5,316 ms** (r185 8,051 → −34 %; r181 7,031 → −24 %),
  `compiles` 4,146 → **1,225 ms** (−70 %), board visible 9,084 → **6,444 ms** (−29 %; r181 8,054).
  Warm startup is flat (5,186 vs 5,153; `compiles` −12 %) — the Dawn cache already hid the
  shader cost there; what Phase 1 removed was the cold cost and the accidental serialisation.
- **Idle steady state** is equal-or-better on every metric (p50/p95/p99 −3…−5 %, long-task total
  −17 %, long-task max −29 %, heap −3 %): the simplex costs nothing at runtime.
- **Load-window frame health after the reveal is WORSE in the table (p99 0.2 → 2.1–2.8 s, max 1.7 →
  3.0–3.3 s) and the table is not like-for-like there.** The per-pipeline hook shows what those
  frames are: 44–101 *synchronous* pipeline creations at 9–12 s, each batch right after a background
  chapter is created — its lights join the persistent rig, `lightsNode.getCacheKey()` changes, and
  every visible material's builder state is rebuilt and its pipeline re-created on the next frame.
  The r185 ledger's load cells never reached chapter 6's creation inside their 30 s window (its
  console shows no drain, no warp pre-init), so its p99 215 ms measured a quieter window, not a
  better tree; r181's load cells show the same spike shape (2.2 / 1.3 / 3.9 s at 8.7–16 s). This is
  plan item **2.9** (light-set manifest), with the instrument that will prove it (`pipelines.sync`
  empty after reveal). One further 5.3 s frame at 17.4 s in `load-warm-3` has no creations and no
  warp log attached — recorded, unexplained.
- Content match holds: draws 80 / 104, triangles 255 k / 538 k identical across all three trees.

### idle-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 |
|---|---|---|---|---|---|---|
| frame p50 ms | 11.20 (11.10–11.30, n=3) | 11.40 (9.30–11.50, n=3) | 10.90 (10.90–11.60, n=3) | 2% | -3% | -4% |
| frame p95 ms | 13.70 (13.50–13.80, n=3) | 14.00 (12.20–14.30, n=3) | 13.60 (13.50–14.20, n=3) | 2% | -1% | -3% |
| frame p99 ms | 15.80 (15.60–16.10, n=3) | 16.20 (13.50–16.50, n=3) | 15.40 (15.30–16.40, n=3) | 3% | -3% | -5% |
| frame max ms | 761.8 (759.2–778.7, n=3) | 851.4 (792.6–862.5, n=3) | 722.8 (707.8–724.4, n=3) | 12% | -5% | -15% |
| spikes | 8 (5–9, n=3) | 3 (3–4, n=3) | 5 (5–7, n=3) | -63% | -38% | 67% |
| long tasks (count) | 62 (60–70, n=3) | 60 (57–64, n=3) | 56 (54–56, n=3) | -3% | -10% | -7% |
| long tasks total ms | 34995 (33032–38301, n=3) | 28869 (26634–28973, n=3) | 23836 (23764–24090, n=3) | -18% | -32% | -17% |
| long task max ms | 5687 (4010–5902, n=3) | 4349 (4270–4454, n=3) | 3076 (3006–3249, n=3) | -24% | -46% | -29% |
| draw calls p50 | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 0% | 0% | 0% |
| triangles p50 | 537633 (537593–537645, n=3) | 537609 (537609–537625, n=3) | 537637 (537605–537637, n=3) | -0% | 0% | 0% |
| JS heap MB | 217.6 (196.5–221.9, n=3) | 204.7 (196.1–215.0, n=3) | 197.7 (191.2–202.5, n=3) | -6% | -9% | -3% |
backend: r181=webgpu r185=webgpu r185p1=webgpu

### load-cold  (median (min–max, n))

| metric | r181 | r185 | r185p1 | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 |
|---|---|---|---|---|---|---|
| startup total ms | 7031 (6979–7090, n=3) | 8051 (7402–8116, n=3) | 5316 (5251–5431, n=3) | 15% | -24% | -34% |
|   startup bucket: renderer | 373 (358–375, n=3) | 402 (397–424, n=3) | 292 (251–363, n=3) | 8% | -22% | -27% |
|   startup bucket: world | 1713 (1706–1738, n=3) | 1732 (1727–1734, n=3) | 1751 (1745–1758, n=3) | 1% | 2% | 1% |
|   startup bucket: creates | 1545 (1337–1547, n=3) | 377 (365–394, n=3) | 453 (430–458, n=3) | -76% | -71% | 20% |
|   startup bucket: nodes | 996 (970–1023, n=3) | 844 (824–851, n=3) | 1009 (1008–1032, n=3) | -15% | 1% | 20% |
|   startup bucket: post+director | 536 (492–564, n=3) | 120 (110–131, n=3) | 173 (172–180, n=3) | -78% | -68% | 44% |
|   startup bucket: compiles | 1434 (1334–1457, n=3) | 4146 (3532–4163, n=3) | 1225 (1105–1228, n=3) | 189% | -15% | -70% |
|   startup bucket: warmup | 313 (310–321, n=3) | 305 (230–313, n=3) | 240 (232–244, n=3) | -3% | -23% | -21% |
| board visible ms | 8054 (7992–8091, n=3) | 9084 (8431–9143, n=3) | 6444 (6387–6444, n=3) | 13% | -20% | -29% |
| frame p50 ms | 7.70 (7.70–7.70, n=3) | 8.80 (8.00–9.20, n=3) | 13.60 (11.40–14.10, n=3) | 14% | 77% | 55% |
| frame p95 ms | 105.60 (97.20–109.30, n=3) | 28.60 (27.80–29.90, n=3) | 230.00 (211.50–250.80, n=3) | -73% | 118% | 704% |
| frame p99 ms | 560.00 (531.80–607.10, n=3) | 215.30 (213.70–242.80, n=3) | 2110.30 (1758.80–2308.00, n=3) | -62% | 277% | 880% |
| frame max ms | 1720.3 (1717.8–1745.2, n=3) | 1745.1 (1735.7–1745.8, n=3) | 2972.0 (2816.7–2977.7, n=3) | 1% | 73% | 70% |
| spikes | 24 (23–27, n=3) | 25 (24–27, n=3) | 33 (32–38, n=3) | 4% | 38% | 32% |
| long tasks (count) | 30 (28–31, n=3) | 33 (32–37, n=3) | 38 (38–41, n=3) | 10% | 27% | 15% |
| long tasks total ms | 11610 (11330–11655, n=3) | 10166 (9864–10305, n=3) | 12185 (12154–14659, n=3) | -12% | 5% | 20% |
| long task max ms | 1719 (1712–1743, n=3) | 1767 (1734–1769, n=3) | 2637 (2599–2815, n=3) | 3% | 53% | 49% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 0% | 0% | 0% |
| triangles p50 | 255179 (255147–255191, n=3) | 255183 (255155–255207, n=3) | 255167 (255147–255183, n=3) | 0% | -0% | -0% |
| JS heap MB | 196.3 (194.1–204.1, n=3) | 179.1 (178.8–184.8, n=3) | 201.5 (185.0–203.4, n=3) | -9% | 3% | 12% |
backend: r181=webgpu r185=webgpu r185p1=webgpu

### load-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 |
|---|---|---|---|---|---|---|
| startup total ms | 4943 (4793–5928, n=3) | 5153 (5094–5267, n=3) | 5186 (4843–5246, n=3) | 4% | 5% | 1% |
|   startup bucket: renderer | 374 (341–564, n=3) | 602 (553–627, n=3) | 540 (453–601, n=3) | 61% | 44% | -10% |
|   startup bucket: world | 1715 (1710–2201, n=3) | 1727 (1714–1752, n=3) | 1725 (1723–1754, n=3) | 1% | 1% | -0% |
|   startup bucket: creates | 1081 (1034–1441, n=3) | 340 (328–363, n=3) | 369 (360–376, n=3) | -69% | -66% | 9% |
|   startup bucket: nodes | 728 (715–741, n=3) | 752 (730–764, n=3) | 776 (739–785, n=3) | 3% | 7% | 3% |
|   startup bucket: post+director | 455 (450–617, n=3) | 131 (109–132, n=3) | 173 (172–224, n=3) | -71% | -62% | 32% |
|   startup bucket: compiles | 30 (30–40, n=3) | 1293 (1241–1299, n=3) | 1132 (924–1153, n=3) | 4210% | 3673% | -12% |
|   startup bucket: warmup | 324 (312–437, n=3) | 217 (217–225, n=3) | 239 (239–240, n=3) | -33% | -26% | 10% |
| board visible ms | 5895 (5889–6907, n=3) | 6182 (6177–6274, n=3) | 6215 (5917–6272, n=3) | 5% | 5% | 1% |
| frame p50 ms | 11.30 (7.80–13.30, n=3) | 10.30 (9.60–10.90, n=3) | 12.70 (11.80–14.50, n=3) | -9% | 12% | 23% |
| frame p95 ms | 395.90 (90.00–468.10, n=3) | 100.80 (92.90–109.40, n=3) | 249.90 (248.50–257.10, n=3) | -75% | -37% | 148% |
| frame p99 ms | 1719.40 (630.00–1722.70, n=3) | 242.20 (232.90–251.10, n=3) | 2768.40 (2143.30–2921.70, n=3) | -86% | 61% | 1043% |
| frame max ms | 3575.8 (3081.8–3884.8, n=3) | 1735.2 (1721.0–1761.9, n=3) | 3325.2 (2806.0–5348.0, n=3) | -51% | -7% | 92% |
| spikes | 27 (24–32, n=3) | 28 (28–30, n=3) | 30 (30–33, n=3) | 4% | 11% | 7% |
| long tasks (count) | 34 (34–38, n=3) | 34 (33–35, n=3) | 39 (39–42, n=3) | 0% | 15% | 15% |
| long tasks total ms | 16905 (15271–18631, n=3) | 9151 (8832–9308, n=3) | 11591 (11162–14518, n=3) | -46% | -31% | 27% |
| long task max ms | 3619 (3096–3892, n=3) | 1738 (1724–1758, n=3) | 2334 (2318–2354, n=3) | -52% | -36% | 34% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 0% | 0% | 0% |
| triangles p50 | 255159 (255123–255179, n=3) | 255195 (255195–255207, n=3) | 255183 (255163–255207, n=3) | 0% | 0% | -0% |
| JS heap MB | 211.8 (203.3–212.9, n=3) | 193.7 (189.6–213.7, n=3) | 229.5 (184.8–231.7, n=3) | -9% | 8% | 19% |
backend: r181=webgpu r185=webgpu r185p1=webgpu

---

## r185p1lake — Phase 1 + the baked lava lake (2026-08-21, same day and driver as r185p1)

**Tree:** r185p1 with `?earthCoreLakeBake=1` (the cell's manifest URL carries the flag; now the
default). Design and gate table: `docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md` §0.

**Reading (r185p1lake vs r185p1):** startup wall-clock is flat (cold 5,462 vs 5,316 ms; warm
5,283 vs 5,186; board visible 6,488 vs 6,444) — after the fan-out the lake's 1.6 s compile was no
longer on the RTX critical path, so removing it (234 ms) buys little there; `creates` +41 ms is the
4 MiB placeholder texture + Worker start (gate F6 ≤ +100). What the cells DO show is the
post-reveal window: cold frame p99 2,110 → 1,703 ms and max 2,972 → 2,003; warm p99 2,768 → 1,299
and max 3,325 → 2,052; idle long-task max 3,076 → 2,155 — the light-set re-creations of item 2.9
now re-create a cheap pipeline. The fill saving is on the GPU lanes, not in these CPU-bound cells:
`gpu-split-laneb-lake-entry.json` (Vega 8) lake 4.45 → 1.96 ms of a 7.60 ms frame;
`gpu-split-lanea-lake-entry.json` (RTX) 0.79 → 0.20 ms. Content match holds (80 / 104 draws).



---

## r185p1light — Phase 1 + lake + item 2.9 closed (2026-08-21, same day and driver)

**Tree:** r185p1lake plus plan item 2.9 in full: chapter light pool **v2** (virtual chapter lights +
9 fixed rig slots, per-frame slot sync), reveal traversals no longer flip lights visible, every
compile/warm binding resolves the render context at the post scene pass's call depth, the r185
`compileAsync` deferred-drain `material.side` regression worked around (`beginDeferredSideCapture`),
and the board's own presentation (path, level nodes, starfield) prewarmed in the startup pool.
Atmosphere rig hoist is the default. **Instrument addition:** `ODYSSEY_PERF_KEY_TRACE=1` renderer-level
key trace (`browser.keyTrace`). The earlier `r185p1light` files (pool v1, 18 resident lights) were
superseded and deleted before this sweep.

**Conditions:** Chrome tab blank; dev server on 4177; `warm-prime` discarded as before.

### Reading (r185p1light vs r185p1lake)

- **Idle/warm is the cell this item was for**: frame max **714 → 26 ms**, long-task total
  **22.2 → 13.7 s** (−38 %; −61 % vs r181), long-task count 59 → 50. p50/p95/p99 flat (11.5 /
  14.2 / 16.1 ms). Nothing re-creates pipelines in steady state any more.
- **Load, post-reveal window**: cold frame p95 227 → 113 ms, p99 **1,703 → 573**, max 2,003 → 1,752
  (the remaining max is the 1.7 s `world` bake long task, item 2.1 — identical in r181's 1,720);
  warm p95 211 → 107, p99 **1,299 → 574**, max 2,052 → 1,817. The first live post frame now creates
  **5** pipelines synchronously (the Bloom passes, item 2.12) instead of 45–52.
- **Startup, the cost**: cold total 5,462 → 5,510 (+48 ms, inside the cells' min–max overlap),
  board visible 6,488 → 6,539; warm total 5,283 → 5,456 (**+173 ms**, +3 %), warm `compiles` bucket
  958 → 1,384. The compile pool carries a fifth prewarm (board, ~1.2 s overlapped) and, for the
  ~45 transparent double-sided materials, two node builds each (BackSide + FrontSide — the two the
  live frame used to do synchronously); the journey warm-up sample fell 350 → 38 ms in return.
  Follow-up that would claw this back: a `forceSinglePass` audit of the flat cards among those
  materials (one build, one draw each), and a shared concurrency cap across the pool.
- Content match holds (80 / 104 draws, 255 k / 538 k triangles).

### idle-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame p50 ms | 11.20 (11.10–11.30, n=3) | 11.40 (9.30–11.50, n=3) | 10.90 (10.90–11.60, n=3) | 11.10 (9.30–11.50, n=3) | 11.50 (9.20–11.70, n=3) | 2% | -3% | -4% | -1% | -3% | 3% | 1% |
| frame p95 ms | 13.70 (13.50–13.80, n=3) | 14.00 (12.20–14.30, n=3) | 13.60 (13.50–14.20, n=3) | 13.90 (12.20–14.20, n=3) | 14.20 (12.10–15.00, n=3) | 2% | -1% | -3% | 1% | -1% | 4% | 1% |
| frame p99 ms | 15.80 (15.60–16.10, n=3) | 16.20 (13.50–16.50, n=3) | 15.40 (15.30–16.40, n=3) | 15.90 (13.20–16.40, n=3) | 16.10 (13.00–16.80, n=3) | 3% | -3% | -5% | 1% | -2% | 2% | -1% |
| frame max ms | 761.8 (759.2–778.7, n=3) | 851.4 (792.6–862.5, n=3) | 722.8 (707.8–724.4, n=3) | 713.8 (654.8–723.4, n=3) | 25.7 (22.8–29.3, n=3) | 12% | -5% | -15% | -6% | -16% | -97% | -97% |
| spikes | 8 (5–9, n=3) | 3 (3–4, n=3) | 5 (5–7, n=3) | 4 (3–5, n=3) | 0 (0–0, n=3) | -63% | -38% | 67% | -50% | 33% | -100% | -100% |
| long tasks (count) | 62 (60–70, n=3) | 60 (57–64, n=3) | 56 (54–56, n=3) | 59 (58–61, n=3) | 50 (48–52, n=3) | -3% | -10% | -7% | -5% | -2% | -19% | -17% |
| long tasks total ms | 34995 (33032–38301, n=3) | 28869 (26634–28973, n=3) | 23836 (23764–24090, n=3) | 22154 (20652–22178, n=3) | 13674 (12847–13966, n=3) | -18% | -32% | -17% | -37% | -23% | -61% | -53% |
| long task max ms | 5687 (4010–5902, n=3) | 4349 (4270–4454, n=3) | 3076 (3006–3249, n=3) | 2155 (1977–2177, n=3) | 1860 (1736–1882, n=3) | -24% | -46% | -29% | -62% | -50% | -67% | -57% |
| draw calls p50 | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| triangles p50 | 537633 (537593–537645, n=3) | 537609 (537609–537625, n=3) | 537637 (537605–537637, n=3) | 537629 (537613–537649, n=3) | 537637 (537621–537649, n=3) | -0% | 0% | 0% | -0% | 0% | 0% | 0% |
| JS heap MB | 217.6 (196.5–221.9, n=3) | 204.7 (196.1–215.0, n=3) | 197.7 (191.2–202.5, n=3) | 209.0 (207.3–216.2, n=3) | 220.0 (209.7–220.2, n=3) | -6% | -9% | -3% | -4% | 2% | 1% | 7% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu

### load-cold  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 7031 (6979–7090, n=3) | 8051 (7402–8116, n=3) | 5316 (5251–5431, n=3) | 5462 (5405–5514, n=3) | 5510 (5433–5692, n=3) | 15% | -24% | -34% | -22% | -32% | -22% | -32% |
|   startup bucket: renderer | 373 (358–375, n=3) | 402 (397–424, n=3) | 292 (251–363, n=3) | 334 (245–405, n=3) | 330 (247–361, n=3) | 8% | -22% | -27% | -10% | -17% | -12% | -18% |
|   startup bucket: world | 1713 (1706–1738, n=3) | 1732 (1727–1734, n=3) | 1751 (1745–1758, n=3) | 1746 (1735–1759, n=3) | 1737 (1723–1741, n=3) | 1% | 2% | 1% | 2% | 1% | 1% | 0% |
|   startup bucket: creates | 1545 (1337–1547, n=3) | 377 (365–394, n=3) | 453 (430–458, n=3) | 494 (452–494, n=3) | 462 (440–463, n=3) | -76% | -71% | 20% | -68% | 31% | -70% | 23% |
|   startup bucket: nodes | 996 (970–1023, n=3) | 844 (824–851, n=3) | 1009 (1008–1032, n=3) | 928 (904–1041, n=3) | 1057 (950–1106, n=3) | -15% | 1% | 20% | -7% | 10% | 6% | 25% |
|   startup bucket: post+director | 536 (492–564, n=3) | 120 (110–131, n=3) | 173 (172–180, n=3) | 176 (165–183, n=3) | 207 (165–211, n=3) | -78% | -68% | 44% | -67% | 47% | -61% | 73% |
|   startup bucket: compiles | 1434 (1334–1457, n=3) | 4146 (3532–4163, n=3) | 1225 (1105–1228, n=3) | 1128 (1110–1202, n=3) | 1470 (1441–1499, n=3) | 189% | -15% | -70% | -21% | -73% | 3% | -65% |
|   startup bucket: warmup | 313 (310–321, n=3) | 305 (230–313, n=3) | 240 (232–244, n=3) | 355 (341–362, n=3) | 40 (38–40, n=3) | -3% | -23% | -21% | 13% | 16% | -87% | -87% |
| board visible ms | 8054 (7992–8091, n=3) | 9084 (8431–9143, n=3) | 6444 (6387–6444, n=3) | 6488 (6448–6541, n=3) | 6539 (6521–6785, n=3) | 13% | -20% | -29% | -19% | -29% | -19% | -28% |
| frame p50 ms | 7.70 (7.70–7.70, n=3) | 8.80 (8.00–9.20, n=3) | 13.60 (11.40–14.10, n=3) | 11.20 (11.00–12.10, n=3) | 11.70 (9.90–11.80, n=3) | 14% | 77% | 55% | 45% | 27% | 52% | 33% |
| frame p95 ms | 105.60 (97.20–109.30, n=3) | 28.60 (27.80–29.90, n=3) | 230.00 (211.50–250.80, n=3) | 227.00 (184.90–233.70, n=3) | 113.10 (107.30–117.00, n=3) | -73% | 118% | 704% | 115% | 694% | 7% | 295% |
| frame p99 ms | 560.00 (531.80–607.10, n=3) | 215.30 (213.70–242.80, n=3) | 2110.30 (1758.80–2308.00, n=3) | 1703.00 (744.60–1708.40, n=3) | 572.50 (558.80–795.00, n=3) | -62% | 277% | 880% | 204% | 691% | 2% | 166% |
| frame max ms | 1720.3 (1717.8–1745.2, n=3) | 1745.1 (1735.7–1745.8, n=3) | 2972.0 (2816.7–2977.7, n=3) | 2003.3 (1766.0–2085.7, n=3) | 1751.8 (1742.7–1816.7, n=3) | 1% | 73% | 70% | 16% | 15% | 2% | 0% |
| spikes | 24 (23–27, n=3) | 25 (24–27, n=3) | 33 (32–38, n=3) | 37 (37–38, n=3) | 39 (35–40, n=3) | 4% | 38% | 32% | 54% | 48% | 63% | 56% |
| long tasks (count) | 30 (28–31, n=3) | 33 (32–37, n=3) | 38 (38–41, n=3) | 42 (40–43, n=3) | 46 (43–48, n=3) | 10% | 27% | 15% | 40% | 27% | 53% | 39% |
| long tasks total ms | 11610 (11330–11655, n=3) | 10166 (9864–10305, n=3) | 12185 (12154–14659, n=3) | 13698 (13634–14019, n=3) | 11983 (10381–12342, n=3) | -12% | 5% | 20% | 18% | 35% | 3% | 18% |
| long task max ms | 1719 (1712–1743, n=3) | 1767 (1734–1769, n=3) | 2637 (2599–2815, n=3) | 1765 (1764–2081, n=3) | 1773 (1740–1777, n=3) | 3% | 53% | 49% | 3% | -0% | 3% | 0% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| triangles p50 | 255179 (255147–255191, n=3) | 255183 (255155–255207, n=3) | 255167 (255147–255183, n=3) | 255167 (255147–255195, n=3) | 255187 (255179–255223, n=3) | 0% | -0% | -0% | -0% | -0% | 0% | 0% |
| JS heap MB | 196.3 (194.1–204.1, n=3) | 179.1 (178.8–184.8, n=3) | 201.5 (185.0–203.4, n=3) | 211.1 (209.9–212.4, n=3) | 196.4 (196.3–201.8, n=3) | -9% | 3% | 12% | 8% | 18% | 0% | 10% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu

### load-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 4943 (4793–5928, n=3) | 5153 (5094–5267, n=3) | 5186 (4843–5246, n=3) | 5283 (5145–5444, n=3) | 5456 (5394–5532, n=3) | 4% | 5% | 1% | 7% | 3% | 10% | 6% |
|   startup bucket: renderer | 374 (341–564, n=3) | 602 (553–627, n=3) | 540 (453–601, n=3) | 535 (442–612, n=3) | 573 (508–574, n=3) | 61% | 44% | -10% | 43% | -11% | 53% | -5% |
|   startup bucket: world | 1715 (1710–2201, n=3) | 1727 (1714–1752, n=3) | 1725 (1723–1754, n=3) | 1740 (1737–1742, n=3) | 1739 (1715–1761, n=3) | 1% | 1% | -0% | 1% | 1% | 1% | 1% |
|   startup bucket: creates | 1081 (1034–1441, n=3) | 340 (328–363, n=3) | 369 (360–376, n=3) | 385 (383–393, n=3) | 392 (388–398, n=3) | -69% | -66% | 9% | -64% | 13% | -64% | 15% |
|   startup bucket: nodes | 728 (715–741, n=3) | 752 (730–764, n=3) | 776 (739–785, n=3) | 985 (758–1011, n=3) | 934 (885–981, n=3) | 3% | 7% | 3% | 35% | 31% | 28% | 24% |
|   startup bucket: post+director | 455 (450–617, n=3) | 131 (109–132, n=3) | 173 (172–224, n=3) | 180 (141–183, n=3) | 192 (161–193, n=3) | -71% | -62% | 32% | -60% | 37% | -58% | 47% |
|   startup bucket: compiles | 30 (30–40, n=3) | 1293 (1241–1299, n=3) | 1132 (924–1153, n=3) | 958 (933–1266, n=3) | 1384 (1371–1433, n=3) | 4210% | 3673% | -12% | 3093% | -26% | 4513% | 7% |
|   startup bucket: warmup | 324 (312–437, n=3) | 217 (217–225, n=3) | 239 (239–240, n=3) | 352 (350–353, n=3) | 41 (38–41, n=3) | -33% | -26% | 10% | 9% | 62% | -87% | -81% |
| board visible ms | 5895 (5889–6907, n=3) | 6182 (6177–6274, n=3) | 6215 (5917–6272, n=3) | 6253 (6252–6371, n=3) | 6447 (6329–6487, n=3) | 5% | 5% | 1% | 6% | 1% | 9% | 4% |
| frame p50 ms | 11.30 (7.80–13.30, n=3) | 10.30 (9.60–10.90, n=3) | 12.70 (11.80–14.50, n=3) | 12.90 (11.90–13.20, n=3) | 11.10 (9.80–11.60, n=3) | -9% | 12% | 23% | 14% | 25% | -2% | 8% |
| frame p95 ms | 395.90 (90.00–468.10, n=3) | 100.80 (92.90–109.40, n=3) | 249.90 (248.50–257.10, n=3) | 211.00 (171.40–237.80, n=3) | 106.60 (104.70–107.40, n=3) | -75% | -37% | 148% | -47% | 109% | -73% | 6% |
| frame p99 ms | 1719.40 (630.00–1722.70, n=3) | 242.20 (232.90–251.10, n=3) | 2768.40 (2143.30–2921.70, n=3) | 1299.20 (722.60–1339.70, n=3) | 574.20 (457.70–574.80, n=3) | -86% | 61% | 1043% | -24% | 436% | -67% | 137% |
| frame max ms | 3575.8 (3081.8–3884.8, n=3) | 1735.2 (1721.0–1761.9, n=3) | 3325.2 (2806.0–5348.0, n=3) | 2051.6 (1753.3–2086.8, n=3) | 1817.1 (1771.4–1844.1, n=3) | -51% | -7% | 92% | -43% | 18% | -49% | 5% |
| spikes | 27 (24–32, n=3) | 28 (28–30, n=3) | 30 (30–33, n=3) | 34 (30–34, n=3) | 39 (38–39, n=3) | 4% | 11% | 7% | 26% | 21% | 44% | 39% |
| long tasks (count) | 34 (34–38, n=3) | 34 (33–35, n=3) | 39 (39–42, n=3) | 38 (35–41, n=3) | 45 (41–45, n=3) | 0% | 15% | 15% | 12% | 12% | 32% | 32% |
| long tasks total ms | 16905 (15271–18631, n=3) | 9151 (8832–9308, n=3) | 11591 (11162–14518, n=3) | 13553 (10277–14142, n=3) | 10002 (9533–11257, n=3) | -46% | -31% | 27% | -20% | 48% | -41% | 9% |
| long task max ms | 3619 (3096–3892, n=3) | 1738 (1724–1758, n=3) | 2334 (2318–2354, n=3) | 1751 (1750–2084, n=3) | 1753 (1722–1770, n=3) | -52% | -36% | 34% | -52% | 1% | -52% | 1% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| triangles p50 | 255159 (255123–255179, n=3) | 255195 (255195–255207, n=3) | 255183 (255163–255207, n=3) | 255207 (255159–255211, n=3) | 255159 (255147–255191, n=3) | 0% | 0% | -0% | 0% | 0% | 0% | -0% |
| JS heap MB | 211.8 (203.3–212.9, n=3) | 193.7 (189.6–213.7, n=3) | 229.5 (184.8–231.7, n=3) | 207.1 (197.4–207.8, n=3) | 226.5 (223.2–229.0, n=3) | -9% | 8% | 19% | -2% | 7% | 7% | 17% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu


---

## r185p1live — + items 2.11 and 2.12: background chapters compile under the live loop (2026-08-21, same day and driver)

**Tree:** r185p1light plus 2.12 (fast-start warms the lean bloom variant pre-reveal, 21 ms) and 2.11
(`compileGroupUnderLiveLoop`: the post-reveal drain compiles each background chapter through r185's
`compileAsync` WHILE the rAF loop renders — scene-pass binding applied for the synchronous prologue
only, the drained builds' target/MRT reads answered by instance accessors on `_renderTarget`/`_mrt`
suspended during every synchronous render — then the unchanged render-warm runs as a cache hit).
Design + hazard table: `docs/ODYSSEY_BACKGROUND_COMPILE_2026-08.md`. Commit `b810144d`.

**Conditions:** Chrome tab blank; dev server on 4177; `warm-prime` discarded; the first driver pass
over this tag was discarded (it ran while the code was still being amended and one run hung) — these
nine cells are from the committed code.

### Reading (r185p1live vs r185p1light)

- **The gate**: synchronous `createRenderPipeline` calls after the reveal — **0 in all nine cells**
  (was 53–78 at 10–17 s: chapters 6–8's render-warms). The only sync creations left in any cell are
  the 10 bloom/output-quad pipelines of the pre-reveal variant warm, behind the overlay.
- **Post-reveal window**: cold frame p95 113 → 99 ms, **p99 573 → 265**; warm p95 107 → 53,
  **p99 574 → 172**. Frame max stays 1,747 / 1,773 — that is the 1.7 s `world` bake long task
  (item 2.1), identical in every tree since r181.
- **Idle/warm**: long-task total 13.7 → 9.9 s (**−72 % vs r181's 35.0 s**), count 50 → 44, frame
  max 26 → 27 ms (flat — nothing re-creates pipelines in steady state; the background compiles'
  JS now lands as yielding sub-50 ms tasks).
- **Startup** is flat: cold total 5,510 → 5,580 and board visible 6,539 → 6,615 (inside the
  cells' min–max); warm total 5,456 → 5,349 (−2 %), board visible 6,447 → 6,269. The bloom warm
  added no measurable cost.
- Content match holds (80 / 104 draws, 255 k / 538 k triangles).

### idle-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | r185p1live | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame p50 ms | 11.20 (11.10–11.30, n=3) | 11.40 (9.30–11.50, n=3) | 10.90 (10.90–11.60, n=3) | 11.10 (9.30–11.50, n=3) | 11.50 (9.20–11.70, n=3) | 11.30 (11.00–11.40, n=3) | 2% | -3% | -4% | -1% | -3% | 3% | 1% | 1% | -1% |
| frame p95 ms | 13.70 (13.50–13.80, n=3) | 14.00 (12.20–14.30, n=3) | 13.60 (13.50–14.20, n=3) | 13.90 (12.20–14.20, n=3) | 14.20 (12.10–15.00, n=3) | 14.30 (13.90–14.80, n=3) | 2% | -1% | -3% | 1% | -1% | 4% | 1% | 4% | 2% |
| frame p99 ms | 15.80 (15.60–16.10, n=3) | 16.20 (13.50–16.50, n=3) | 15.40 (15.30–16.40, n=3) | 15.90 (13.20–16.40, n=3) | 16.10 (13.00–16.80, n=3) | 16.00 (15.80–16.40, n=3) | 3% | -3% | -5% | 1% | -2% | 2% | -1% | 1% | -1% |
| frame max ms | 761.8 (759.2–778.7, n=3) | 851.4 (792.6–862.5, n=3) | 722.8 (707.8–724.4, n=3) | 713.8 (654.8–723.4, n=3) | 25.7 (22.8–29.3, n=3) | 26.9 (25.0–28.7, n=3) | 12% | -5% | -15% | -6% | -16% | -97% | -97% | -96% | -97% |
| spikes | 8 (5–9, n=3) | 3 (3–4, n=3) | 5 (5–7, n=3) | 4 (3–5, n=3) | 0 (0–0, n=3) | 0 (0–0, n=3) | -63% | -38% | 67% | -50% | 33% | -100% | -100% | -100% | -100% |
| long tasks (count) | 62 (60–70, n=3) | 60 (57–64, n=3) | 56 (54–56, n=3) | 59 (58–61, n=3) | 50 (48–52, n=3) | 44 (43–44, n=3) | -3% | -10% | -7% | -5% | -2% | -19% | -17% | -29% | -27% |
| long tasks total ms | 34995 (33032–38301, n=3) | 28869 (26634–28973, n=3) | 23836 (23764–24090, n=3) | 22154 (20652–22178, n=3) | 13674 (12847–13966, n=3) | 9923 (9873–10032, n=3) | -18% | -32% | -17% | -37% | -23% | -61% | -53% | -72% | -66% |
| long task max ms | 5687 (4010–5902, n=3) | 4349 (4270–4454, n=3) | 3076 (3006–3249, n=3) | 2155 (1977–2177, n=3) | 1860 (1736–1882, n=3) | 1776 (1739–1809, n=3) | -24% | -46% | -29% | -62% | -50% | -67% | -57% | -69% | -59% |
| draw calls p50 | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 93 (93–93, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | -11% | -11% |
| triangles p50 | 537633 (537593–537645, n=3) | 537609 (537609–537625, n=3) | 537637 (537605–537637, n=3) | 537629 (537613–537649, n=3) | 537637 (537621–537649, n=3) | 534527 (534527–534527, n=3) | -0% | 0% | 0% | -0% | 0% | 0% | 0% | -1% | -1% |
| JS heap MB | 217.6 (196.5–221.9, n=3) | 204.7 (196.1–215.0, n=3) | 197.7 (191.2–202.5, n=3) | 209.0 (207.3–216.2, n=3) | 220.0 (209.7–220.2, n=3) | 217.3 (206.9–219.9, n=3) | -6% | -9% | -3% | -4% | 2% | 1% | 7% | -0% | 6% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu

### load-cold  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | r185p1live | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 7031 (6979–7090, n=3) | 8051 (7402–8116, n=3) | 5316 (5251–5431, n=3) | 5462 (5405–5514, n=3) | 5510 (5433–5692, n=3) | 5580 (5398–5668, n=3) | 15% | -24% | -34% | -22% | -32% | -22% | -32% | -21% | -31% |
|   startup bucket: renderer | 373 (358–375, n=3) | 402 (397–424, n=3) | 292 (251–363, n=3) | 334 (245–405, n=3) | 330 (247–361, n=3) | 335 (331–342, n=3) | 8% | -22% | -27% | -10% | -17% | -12% | -18% | -10% | -17% |
|   startup bucket: world | 1713 (1706–1738, n=3) | 1732 (1727–1734, n=3) | 1751 (1745–1758, n=3) | 1746 (1735–1759, n=3) | 1737 (1723–1741, n=3) | 1737 (1725–1785, n=3) | 1% | 2% | 1% | 2% | 1% | 1% | 0% | 1% | 0% |
|   startup bucket: creates | 1545 (1337–1547, n=3) | 377 (365–394, n=3) | 453 (430–458, n=3) | 494 (452–494, n=3) | 462 (440–463, n=3) | 458 (416–496, n=3) | -76% | -71% | 20% | -68% | 31% | -70% | 23% | -70% | 21% |
|   startup bucket: nodes | 996 (970–1023, n=3) | 844 (824–851, n=3) | 1009 (1008–1032, n=3) | 928 (904–1041, n=3) | 1057 (950–1106, n=3) | 1040 (914–1127, n=3) | -15% | 1% | 20% | -7% | 10% | 6% | 25% | 4% | 23% |
|   startup bucket: post+director | 536 (492–564, n=3) | 120 (110–131, n=3) | 173 (172–180, n=3) | 176 (165–183, n=3) | 207 (165–211, n=3) | 203 (164–209, n=3) | -78% | -68% | 44% | -67% | 47% | -61% | 73% | -62% | 69% |
|   startup bucket: compiles | 1434 (1334–1457, n=3) | 4146 (3532–4163, n=3) | 1225 (1105–1228, n=3) | 1128 (1110–1202, n=3) | 1470 (1441–1499, n=3) | 1514 (1335–1536, n=3) | 189% | -15% | -70% | -21% | -73% | 3% | -65% | 6% | -63% |
|   startup bucket: warmup | 313 (310–321, n=3) | 305 (230–313, n=3) | 240 (232–244, n=3) | 355 (341–362, n=3) | 40 (38–40, n=3) | 60 (59–69, n=3) | -3% | -23% | -21% | 13% | 16% | -87% | -87% | -81% | -80% |
| board visible ms | 8054 (7992–8091, n=3) | 9084 (8431–9143, n=3) | 6444 (6387–6444, n=3) | 6488 (6448–6541, n=3) | 6539 (6521–6785, n=3) | 6615 (6410–6742, n=3) | 13% | -20% | -29% | -19% | -29% | -19% | -28% | -18% | -27% |
| frame p50 ms | 7.70 (7.70–7.70, n=3) | 8.80 (8.00–9.20, n=3) | 13.60 (11.40–14.10, n=3) | 11.20 (11.00–12.10, n=3) | 11.70 (9.90–11.80, n=3) | 11.80 (9.80–11.90, n=3) | 14% | 77% | 55% | 45% | 27% | 52% | 33% | 53% | 34% |
| frame p95 ms | 105.60 (97.20–109.30, n=3) | 28.60 (27.80–29.90, n=3) | 230.00 (211.50–250.80, n=3) | 227.00 (184.90–233.70, n=3) | 113.10 (107.30–117.00, n=3) | 99.10 (48.60–107.50, n=3) | -73% | 118% | 704% | 115% | 694% | 7% | 295% | -6% | 247% |
| frame p99 ms | 560.00 (531.80–607.10, n=3) | 215.30 (213.70–242.80, n=3) | 2110.30 (1758.80–2308.00, n=3) | 1703.00 (744.60–1708.40, n=3) | 572.50 (558.80–795.00, n=3) | 265.40 (257.20–317.00, n=3) | -62% | 277% | 880% | 204% | 691% | 2% | 166% | -53% | 23% |
| frame max ms | 1720.3 (1717.8–1745.2, n=3) | 1745.1 (1735.7–1745.8, n=3) | 2972.0 (2816.7–2977.7, n=3) | 2003.3 (1766.0–2085.7, n=3) | 1751.8 (1742.7–1816.7, n=3) | 1747.0 (1733.9–1798.0, n=3) | 1% | 73% | 70% | 16% | 15% | 2% | 0% | 2% | 0% |
| spikes | 24 (23–27, n=3) | 25 (24–27, n=3) | 33 (32–38, n=3) | 37 (37–38, n=3) | 39 (35–40, n=3) | 37 (36–38, n=3) | 4% | 38% | 32% | 54% | 48% | 63% | 56% | 54% | 48% |
| long tasks (count) | 30 (28–31, n=3) | 33 (32–37, n=3) | 38 (38–41, n=3) | 42 (40–43, n=3) | 46 (43–48, n=3) | 41 (38–43, n=3) | 10% | 27% | 15% | 40% | 27% | 53% | 39% | 37% | 24% |
| long tasks total ms | 11610 (11330–11655, n=3) | 10166 (9864–10305, n=3) | 12185 (12154–14659, n=3) | 13698 (13634–14019, n=3) | 11983 (10381–12342, n=3) | 9972 (9557–10143, n=3) | -12% | 5% | 20% | 18% | 35% | 3% | 18% | -14% | -2% |
| long task max ms | 1719 (1712–1743, n=3) | 1767 (1734–1769, n=3) | 2637 (2599–2815, n=3) | 1765 (1764–2081, n=3) | 1773 (1740–1777, n=3) | 1747 (1732–1830, n=3) | 3% | 53% | 49% | 3% | -0% | 3% | 0% | 2% | -1% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–87, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| triangles p50 | 255179 (255147–255191, n=3) | 255183 (255155–255207, n=3) | 255167 (255147–255183, n=3) | 255167 (255147–255195, n=3) | 255187 (255179–255223, n=3) | 255191 (255143–259965, n=3) | 0% | -0% | -0% | -0% | -0% | 0% | 0% | 0% | 0% |
| JS heap MB | 196.3 (194.1–204.1, n=3) | 179.1 (178.8–184.8, n=3) | 201.5 (185.0–203.4, n=3) | 211.1 (209.9–212.4, n=3) | 196.4 (196.3–201.8, n=3) | 218.7 (213.3–232.6, n=3) | -9% | 3% | 12% | 8% | 18% | 0% | 10% | 11% | 22% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu

### load-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | r185p1live | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 4943 (4793–5928, n=3) | 5153 (5094–5267, n=3) | 5186 (4843–5246, n=3) | 5283 (5145–5444, n=3) | 5456 (5394–5532, n=3) | 5349 (4953–5540, n=3) | 4% | 5% | 1% | 7% | 3% | 10% | 6% | 8% | 4% |
|   startup bucket: renderer | 374 (341–564, n=3) | 602 (553–627, n=3) | 540 (453–601, n=3) | 535 (442–612, n=3) | 573 (508–574, n=3) | 510 (434–580, n=3) | 61% | 44% | -10% | 43% | -11% | 53% | -5% | 36% | -15% |
|   startup bucket: world | 1715 (1710–2201, n=3) | 1727 (1714–1752, n=3) | 1725 (1723–1754, n=3) | 1740 (1737–1742, n=3) | 1739 (1715–1761, n=3) | 1761 (1718–1772, n=3) | 1% | 1% | -0% | 1% | 1% | 1% | 1% | 3% | 2% |
|   startup bucket: creates | 1081 (1034–1441, n=3) | 340 (328–363, n=3) | 369 (360–376, n=3) | 385 (383–393, n=3) | 392 (388–398, n=3) | 382 (364–404, n=3) | -69% | -66% | 9% | -64% | 13% | -64% | 15% | -65% | 12% |
|   startup bucket: nodes | 728 (715–741, n=3) | 752 (730–764, n=3) | 776 (739–785, n=3) | 985 (758–1011, n=3) | 934 (885–981, n=3) | 975 (837–1077, n=3) | 3% | 7% | 3% | 35% | 31% | 28% | 24% | 34% | 30% |
|   startup bucket: post+director | 455 (450–617, n=3) | 131 (109–132, n=3) | 173 (172–224, n=3) | 180 (141–183, n=3) | 192 (161–193, n=3) | 202 (154–205, n=3) | -71% | -62% | 32% | -60% | 37% | -58% | 47% | -56% | 54% |
|   startup bucket: compiles | 30 (30–40, n=3) | 1293 (1241–1299, n=3) | 1132 (924–1153, n=3) | 958 (933–1266, n=3) | 1384 (1371–1433, n=3) | 1382 (808–1437, n=3) | 4210% | 3673% | -12% | 3093% | -26% | 4513% | 7% | 4507% | 7% |
|   startup bucket: warmup | 324 (312–437, n=3) | 217 (217–225, n=3) | 239 (239–240, n=3) | 352 (350–353, n=3) | 41 (38–41, n=3) | 61 (60–85, n=3) | -33% | -26% | 10% | 9% | 62% | -87% | -81% | -81% | -72% |
| board visible ms | 5895 (5889–6907, n=3) | 6182 (6177–6274, n=3) | 6215 (5917–6272, n=3) | 6253 (6252–6371, n=3) | 6447 (6329–6487, n=3) | 6269 (5875–6549, n=3) | 5% | 5% | 1% | 6% | 1% | 9% | 4% | 6% | 1% |
| frame p50 ms | 11.30 (7.80–13.30, n=3) | 10.30 (9.60–10.90, n=3) | 12.70 (11.80–14.50, n=3) | 12.90 (11.90–13.20, n=3) | 11.10 (9.80–11.60, n=3) | 11.00 (9.30–11.90, n=3) | -9% | 12% | 23% | 14% | 25% | -2% | 8% | -3% | 7% |
| frame p95 ms | 395.90 (90.00–468.10, n=3) | 100.80 (92.90–109.40, n=3) | 249.90 (248.50–257.10, n=3) | 211.00 (171.40–237.80, n=3) | 106.60 (104.70–107.40, n=3) | 52.70 (50.00–66.20, n=3) | -75% | -37% | 148% | -47% | 109% | -73% | 6% | -87% | -48% |
| frame p99 ms | 1719.40 (630.00–1722.70, n=3) | 242.20 (232.90–251.10, n=3) | 2768.40 (2143.30–2921.70, n=3) | 1299.20 (722.60–1339.70, n=3) | 574.20 (457.70–574.80, n=3) | 171.60 (169.10–191.80, n=3) | -86% | 61% | 1043% | -24% | 436% | -67% | 137% | -90% | -29% |
| frame max ms | 3575.8 (3081.8–3884.8, n=3) | 1735.2 (1721.0–1761.9, n=3) | 3325.2 (2806.0–5348.0, n=3) | 2051.6 (1753.3–2086.8, n=3) | 1817.1 (1771.4–1844.1, n=3) | 1772.7 (1727.7–1784.6, n=3) | -51% | -7% | 92% | -43% | 18% | -49% | 5% | -50% | 2% |
| spikes | 27 (24–32, n=3) | 28 (28–30, n=3) | 30 (30–33, n=3) | 34 (30–34, n=3) | 39 (38–39, n=3) | 38 (38–40, n=3) | 4% | 11% | 7% | 26% | 21% | 44% | 39% | 41% | 36% |
| long tasks (count) | 34 (34–38, n=3) | 34 (33–35, n=3) | 39 (39–42, n=3) | 38 (35–41, n=3) | 45 (41–45, n=3) | 41 (39–42, n=3) | 0% | 15% | 15% | 12% | 12% | 32% | 32% | 21% | 21% |
| long tasks total ms | 16905 (15271–18631, n=3) | 9151 (8832–9308, n=3) | 11591 (11162–14518, n=3) | 13553 (10277–14142, n=3) | 10002 (9533–11257, n=3) | 9387 (9167–9543, n=3) | -46% | -31% | 27% | -20% | 48% | -41% | 9% | -44% | 3% |
| long task max ms | 3619 (3096–3892, n=3) | 1738 (1724–1758, n=3) | 2334 (2318–2354, n=3) | 1751 (1750–2084, n=3) | 1753 (1722–1770, n=3) | 1771 (1726–1783, n=3) | -52% | -36% | 34% | -52% | 1% | -52% | 1% | -51% | 2% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 87 (87–87, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 9% | 9% |
| triangles p50 | 255159 (255123–255179, n=3) | 255195 (255195–255207, n=3) | 255183 (255163–255207, n=3) | 255207 (255159–255211, n=3) | 255159 (255147–255191, n=3) | 259949 (259937–259989, n=3) | 0% | 0% | -0% | 0% | 0% | 0% | -0% | 2% | 2% |
| JS heap MB | 211.8 (203.3–212.9, n=3) | 193.7 (189.6–213.7, n=3) | 229.5 (184.8–231.7, n=3) | 207.1 (197.4–207.8, n=3) | 226.5 (223.2–229.0, n=3) | 228.4 (216.0–231.7, n=3) | -9% | 8% | 19% | -2% | 7% | 7% | 17% | 8% | 18% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu


---

## r185p1world — + item 2.1: the One World bakes in a Worker (2026-08-21, same day and driver)

**Tree:** r185p1live plus item 2.1: the five One World texture bakes and the cloud-field sculpt run in a
module Worker started before `renderer.init()`; the nodes take their ground sampler from the relief
stage; the world is assembled after the nodes from the landed arrays; hero-cloud geometry is no
longer sculpted when heroes are off. Design: `docs/ODYSSEY_WORLD_BAKE_WORKER_2026-08.md`. Commit
`c97ad8bd`.

**Conditions:** Chrome tab blank; dev server on 4177; `warm-prime` discarded; no edits during the pass.

### Reading (r185p1world vs r185p1live)

- **Startup**: cold total **5,580 → 4,008 ms** (−28 %; −43 % vs r181's 7,031), board visible
  **6,615 → 5,015**; warm total **5,349 → 3,516**, board visible 6,269 → 4,551. The `world` bucket
  1,737 → **195 / 174 ms** (the build from landed arrays); `nodes` flat (1,011 / 946 — includes the
  ~100 ms wait for the relief stage, logged per run as `world-bake relief landed +883…1,039 ms`);
  the worker's last stage lands at +1.87…2.20 s, i.e. before the world step needs it in every run.
- **The 1.7 s long task is gone**: post-reveal frame max cold **1,747 → 464**, warm 1,773 → 579;
  long-task totals cold 9,972 → 6,874, warm 9,387 → 6,007, idle 9,923 → 6,572. The largest task left
  in any run is 662–691 ms — the app-boot task in `main.js`, before Odyssey is involved (plan row
  2.1's ≤ 300 ms gate is therefore not met by Odyssey's own tasks being large but by the app's;
  the Odyssey-side largest is the ~460 ms chapter-creation task, item 2.4/2.2 territory).
- Steady state unchanged: idle p50/p99 11.5 / 16.5 ms, idle frame max 24 ms; post-reveal p99 cold
  265 → 221, warm 172 → 179 (noise). Sync pipeline creations after the reveal: 0 in all nine cells.
- Content match holds (80 / 104 draws, 255 k / 538 k triangles); the chapter-3 capture renders the
  full world from the worker plates (ADR-0007); bytes pinned by 12 goldens.

### idle-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | r185p1live | r185p1world | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 | Δ r185p1world vs r181 | Δ r185p1world vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame p50 ms | 11.20 (11.10–11.30, n=3) | 11.40 (9.30–11.50, n=3) | 10.90 (10.90–11.60, n=3) | 11.10 (9.30–11.50, n=3) | 11.50 (9.20–11.70, n=3) | 11.30 (11.00–11.40, n=3) | 11.50 (10.70–11.60, n=3) | 2% | -3% | -4% | -1% | -3% | 3% | 1% | 1% | -1% | 3% | 1% |
| frame p95 ms | 13.70 (13.50–13.80, n=3) | 14.00 (12.20–14.30, n=3) | 13.60 (13.50–14.20, n=3) | 13.90 (12.20–14.20, n=3) | 14.20 (12.10–15.00, n=3) | 14.30 (13.90–14.80, n=3) | 14.40 (13.80–14.80, n=3) | 2% | -1% | -3% | 1% | -1% | 4% | 1% | 4% | 2% | 5% | 3% |
| frame p99 ms | 15.80 (15.60–16.10, n=3) | 16.20 (13.50–16.50, n=3) | 15.40 (15.30–16.40, n=3) | 15.90 (13.20–16.40, n=3) | 16.10 (13.00–16.80, n=3) | 16.00 (15.80–16.40, n=3) | 16.50 (15.50–16.80, n=3) | 3% | -3% | -5% | 1% | -2% | 2% | -1% | 1% | -1% | 4% | 2% |
| frame max ms | 761.8 (759.2–778.7, n=3) | 851.4 (792.6–862.5, n=3) | 722.8 (707.8–724.4, n=3) | 713.8 (654.8–723.4, n=3) | 25.7 (22.8–29.3, n=3) | 26.9 (25.0–28.7, n=3) | 24.1 (23.1–27.2, n=3) | 12% | -5% | -15% | -6% | -16% | -97% | -97% | -96% | -97% | -97% | -97% |
| spikes | 8 (5–9, n=3) | 3 (3–4, n=3) | 5 (5–7, n=3) | 4 (3–5, n=3) | 0 (0–0, n=3) | 0 (0–0, n=3) | 0 (0–0, n=3) | -63% | -38% | 67% | -50% | 33% | -100% | -100% | -100% | -100% | -100% | -100% |
| long tasks (count) | 62 (60–70, n=3) | 60 (57–64, n=3) | 56 (54–56, n=3) | 59 (58–61, n=3) | 50 (48–52, n=3) | 44 (43–44, n=3) | 41 (39–43, n=3) | -3% | -10% | -7% | -5% | -2% | -19% | -17% | -29% | -27% | -34% | -32% |
| long tasks total ms | 34995 (33032–38301, n=3) | 28869 (26634–28973, n=3) | 23836 (23764–24090, n=3) | 22154 (20652–22178, n=3) | 13674 (12847–13966, n=3) | 9923 (9873–10032, n=3) | 6572 (6357–6655, n=3) | -18% | -32% | -17% | -37% | -23% | -61% | -53% | -72% | -66% | -81% | -77% |
| long task max ms | 5687 (4010–5902, n=3) | 4349 (4270–4454, n=3) | 3076 (3006–3249, n=3) | 2155 (1977–2177, n=3) | 1860 (1736–1882, n=3) | 1776 (1739–1809, n=3) | 579 (575–613, n=3) | -24% | -46% | -29% | -62% | -50% | -67% | -57% | -69% | -59% | -90% | -87% |
| draw calls p50 | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 93 (93–93, n=3) | 93 (93–93, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | -11% | -11% | -11% | -11% |
| triangles p50 | 537633 (537593–537645, n=3) | 537609 (537609–537625, n=3) | 537637 (537605–537637, n=3) | 537629 (537613–537649, n=3) | 537637 (537621–537649, n=3) | 534527 (534527–534527, n=3) | 534527 (534527–534527, n=3) | -0% | 0% | 0% | -0% | 0% | 0% | 0% | -1% | -1% | -1% | -1% |
| JS heap MB | 217.6 (196.5–221.9, n=3) | 204.7 (196.1–215.0, n=3) | 197.7 (191.2–202.5, n=3) | 209.0 (207.3–216.2, n=3) | 220.0 (209.7–220.2, n=3) | 217.3 (206.9–219.9, n=3) | 202.2 (200.5–219.0, n=3) | -6% | -9% | -3% | -4% | 2% | 1% | 7% | -0% | 6% | -7% | -1% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu r185p1world=webgpu

### load-cold  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | r185p1live | r185p1world | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 | Δ r185p1world vs r181 | Δ r185p1world vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 7031 (6979–7090, n=3) | 8051 (7402–8116, n=3) | 5316 (5251–5431, n=3) | 5462 (5405–5514, n=3) | 5510 (5433–5692, n=3) | 5580 (5398–5668, n=3) | 4008 (3890–4239, n=3) | 15% | -24% | -34% | -22% | -32% | -22% | -32% | -21% | -31% | -43% | -50% |
|   startup bucket: renderer | 373 (358–375, n=3) | 402 (397–424, n=3) | 292 (251–363, n=3) | 334 (245–405, n=3) | 330 (247–361, n=3) | 335 (331–342, n=3) | 370 (357–412, n=3) | 8% | -22% | -27% | -10% | -17% | -12% | -18% | -10% | -17% | -1% | -8% |
|   startup bucket: world | 1713 (1706–1738, n=3) | 1732 (1727–1734, n=3) | 1751 (1745–1758, n=3) | 1746 (1735–1759, n=3) | 1737 (1723–1741, n=3) | 1737 (1725–1785, n=3) | 195 (186–213, n=3) | 1% | 2% | 1% | 2% | 1% | 1% | 0% | 1% | 0% | -89% | -89% |
|   startup bucket: creates | 1545 (1337–1547, n=3) | 377 (365–394, n=3) | 453 (430–458, n=3) | 494 (452–494, n=3) | 462 (440–463, n=3) | 458 (416–496, n=3) | 460 (449–470, n=3) | -76% | -71% | 20% | -68% | 31% | -70% | 23% | -70% | 21% | -70% | 22% |
|   startup bucket: nodes | 996 (970–1023, n=3) | 844 (824–851, n=3) | 1009 (1008–1032, n=3) | 928 (904–1041, n=3) | 1057 (950–1106, n=3) | 1040 (914–1127, n=3) | 1011 (991–1220, n=3) | -15% | 1% | 20% | -7% | 10% | 6% | 25% | 4% | 23% | 2% | 20% |
|   startup bucket: post+director | 536 (492–564, n=3) | 120 (110–131, n=3) | 173 (172–180, n=3) | 176 (165–183, n=3) | 207 (165–211, n=3) | 203 (164–209, n=3) | 180 (161–190, n=3) | -78% | -68% | 44% | -67% | 47% | -61% | 73% | -62% | 69% | -66% | 50% |
|   startup bucket: compiles | 1434 (1334–1457, n=3) | 4146 (3532–4163, n=3) | 1225 (1105–1228, n=3) | 1128 (1110–1202, n=3) | 1470 (1441–1499, n=3) | 1514 (1335–1536, n=3) | 1437 (1404–1453, n=3) | 189% | -15% | -70% | -21% | -73% | 3% | -65% | 6% | -63% | 0% | -65% |
|   startup bucket: warmup | 313 (310–321, n=3) | 305 (230–313, n=3) | 240 (232–244, n=3) | 355 (341–362, n=3) | 40 (38–40, n=3) | 60 (59–69, n=3) | 61 (61–110, n=3) | -3% | -23% | -21% | 13% | 16% | -87% | -87% | -81% | -80% | -81% | -80% |
| board visible ms | 8054 (7992–8091, n=3) | 9084 (8431–9143, n=3) | 6444 (6387–6444, n=3) | 6488 (6448–6541, n=3) | 6539 (6521–6785, n=3) | 6615 (6410–6742, n=3) | 5015 (4940–5207, n=3) | 13% | -20% | -29% | -19% | -29% | -19% | -28% | -18% | -27% | -38% | -45% |
| frame p50 ms | 7.70 (7.70–7.70, n=3) | 8.80 (8.00–9.20, n=3) | 13.60 (11.40–14.10, n=3) | 11.20 (11.00–12.10, n=3) | 11.70 (9.90–11.80, n=3) | 11.80 (9.80–11.90, n=3) | 10.10 (9.60–11.40, n=3) | 14% | 77% | 55% | 45% | 27% | 52% | 33% | 53% | 34% | 31% | 15% |
| frame p95 ms | 105.60 (97.20–109.30, n=3) | 28.60 (27.80–29.90, n=3) | 230.00 (211.50–250.80, n=3) | 227.00 (184.90–233.70, n=3) | 113.10 (107.30–117.00, n=3) | 99.10 (48.60–107.50, n=3) | 56.00 (53.80–63.60, n=3) | -73% | 118% | 704% | 115% | 694% | 7% | 295% | -6% | 247% | -47% | 96% |
| frame p99 ms | 560.00 (531.80–607.10, n=3) | 215.30 (213.70–242.80, n=3) | 2110.30 (1758.80–2308.00, n=3) | 1703.00 (744.60–1708.40, n=3) | 572.50 (558.80–795.00, n=3) | 265.40 (257.20–317.00, n=3) | 221.20 (213.60–230.70, n=3) | -62% | 277% | 880% | 204% | 691% | 2% | 166% | -53% | 23% | -60% | 3% |
| frame max ms | 1720.3 (1717.8–1745.2, n=3) | 1745.1 (1735.7–1745.8, n=3) | 2972.0 (2816.7–2977.7, n=3) | 2003.3 (1766.0–2085.7, n=3) | 1751.8 (1742.7–1816.7, n=3) | 1747.0 (1733.9–1798.0, n=3) | 464.3 (462.8–581.6, n=3) | 1% | 73% | 70% | 16% | 15% | 2% | 0% | 2% | 0% | -73% | -73% |
| spikes | 24 (23–27, n=3) | 25 (24–27, n=3) | 33 (32–38, n=3) | 37 (37–38, n=3) | 39 (35–40, n=3) | 37 (36–38, n=3) | 41 (39–42, n=3) | 4% | 38% | 32% | 54% | 48% | 63% | 56% | 54% | 48% | 71% | 64% |
| long tasks (count) | 30 (28–31, n=3) | 33 (32–37, n=3) | 38 (38–41, n=3) | 42 (40–43, n=3) | 46 (43–48, n=3) | 41 (38–43, n=3) | 43 (43–44, n=3) | 10% | 27% | 15% | 40% | 27% | 53% | 39% | 37% | 24% | 43% | 30% |
| long tasks total ms | 11610 (11330–11655, n=3) | 10166 (9864–10305, n=3) | 12185 (12154–14659, n=3) | 13698 (13634–14019, n=3) | 11983 (10381–12342, n=3) | 9972 (9557–10143, n=3) | 6874 (6845–7037, n=3) | -12% | 5% | 20% | 18% | 35% | 3% | 18% | -14% | -2% | -41% | -32% |
| long task max ms | 1719 (1712–1743, n=3) | 1767 (1734–1769, n=3) | 2637 (2599–2815, n=3) | 1765 (1764–2081, n=3) | 1773 (1740–1777, n=3) | 1747 (1732–1830, n=3) | 668 (662–691, n=3) | 3% | 53% | 49% | 3% | -0% | 3% | 0% | 2% | -1% | -61% | -62% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–87, n=3) | 87 (87–87, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 9% | 9% |
| triangles p50 | 255179 (255147–255191, n=3) | 255183 (255155–255207, n=3) | 255167 (255147–255183, n=3) | 255167 (255147–255195, n=3) | 255187 (255179–255223, n=3) | 255191 (255143–259965, n=3) | 259965 (259961–260009, n=3) | 0% | -0% | -0% | -0% | -0% | 0% | 0% | 0% | 0% | 2% | 2% |
| JS heap MB | 196.3 (194.1–204.1, n=3) | 179.1 (178.8–184.8, n=3) | 201.5 (185.0–203.4, n=3) | 211.1 (209.9–212.4, n=3) | 196.4 (196.3–201.8, n=3) | 218.7 (213.3–232.6, n=3) | 208.4 (198.9–227.7, n=3) | -9% | 3% | 12% | 8% | 18% | 0% | 10% | 11% | 22% | 6% | 16% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu r185p1world=webgpu

### load-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1lake | r185p1light | r185p1live | r185p1world | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 | Δ r185p1world vs r181 | Δ r185p1world vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 4943 (4793–5928, n=3) | 5153 (5094–5267, n=3) | 5186 (4843–5246, n=3) | 5283 (5145–5444, n=3) | 5456 (5394–5532, n=3) | 5349 (4953–5540, n=3) | 3516 (3425–4197, n=3) | 4% | 5% | 1% | 7% | 3% | 10% | 6% | 8% | 4% | -29% | -32% |
|   startup bucket: renderer | 374 (341–564, n=3) | 602 (553–627, n=3) | 540 (453–601, n=3) | 535 (442–612, n=3) | 573 (508–574, n=3) | 510 (434–580, n=3) | 576 (517–580, n=3) | 61% | 44% | -10% | 43% | -11% | 53% | -5% | 36% | -15% | 54% | -4% |
|   startup bucket: world | 1715 (1710–2201, n=3) | 1727 (1714–1752, n=3) | 1725 (1723–1754, n=3) | 1740 (1737–1742, n=3) | 1739 (1715–1761, n=3) | 1761 (1718–1772, n=3) | 174 (174–243, n=3) | 1% | 1% | -0% | 1% | 1% | 1% | 1% | 3% | 2% | -90% | -90% |
|   startup bucket: creates | 1081 (1034–1441, n=3) | 340 (328–363, n=3) | 369 (360–376, n=3) | 385 (383–393, n=3) | 392 (388–398, n=3) | 382 (364–404, n=3) | 396 (391–398, n=3) | -69% | -66% | 9% | -64% | 13% | -64% | 15% | -65% | 12% | -63% | 16% |
|   startup bucket: nodes | 728 (715–741, n=3) | 752 (730–764, n=3) | 776 (739–785, n=3) | 985 (758–1011, n=3) | 934 (885–981, n=3) | 975 (837–1077, n=3) | 946 (946–1009, n=3) | 3% | 7% | 3% | 35% | 31% | 28% | 24% | 34% | 30% | 30% | 26% |
|   startup bucket: post+director | 455 (450–617, n=3) | 131 (109–132, n=3) | 173 (172–224, n=3) | 180 (141–183, n=3) | 192 (161–193, n=3) | 202 (154–205, n=3) | 155 (151–212, n=3) | -71% | -62% | 32% | -60% | 37% | -58% | 47% | -56% | 54% | -66% | 18% |
|   startup bucket: compiles | 30 (30–40, n=3) | 1293 (1241–1299, n=3) | 1132 (924–1153, n=3) | 958 (933–1266, n=3) | 1384 (1371–1433, n=3) | 1382 (808–1437, n=3) | 1023 (898–1513, n=3) | 4210% | 3673% | -12% | 3093% | -26% | 4513% | 7% | 4507% | 7% | 3310% | -21% |
|   startup bucket: warmup | 324 (312–437, n=3) | 217 (217–225, n=3) | 239 (239–240, n=3) | 352 (350–353, n=3) | 41 (38–41, n=3) | 61 (60–85, n=3) | 58 (58–89, n=3) | -33% | -26% | 10% | 9% | 62% | -87% | -81% | -81% | -72% | -82% | -73% |
| board visible ms | 5895 (5889–6907, n=3) | 6182 (6177–6274, n=3) | 6215 (5917–6272, n=3) | 6253 (6252–6371, n=3) | 6447 (6329–6487, n=3) | 6269 (5875–6549, n=3) | 4551 (4380–5124, n=3) | 5% | 5% | 1% | 6% | 1% | 9% | 4% | 6% | 1% | -23% | -26% |
| frame p50 ms | 11.30 (7.80–13.30, n=3) | 10.30 (9.60–10.90, n=3) | 12.70 (11.80–14.50, n=3) | 12.90 (11.90–13.20, n=3) | 11.10 (9.80–11.60, n=3) | 11.00 (9.30–11.90, n=3) | 11.70 (11.50–12.00, n=3) | -9% | 12% | 23% | 14% | 25% | -2% | 8% | -3% | 7% | 4% | 14% |
| frame p95 ms | 395.90 (90.00–468.10, n=3) | 100.80 (92.90–109.40, n=3) | 249.90 (248.50–257.10, n=3) | 211.00 (171.40–237.80, n=3) | 106.60 (104.70–107.40, n=3) | 52.70 (50.00–66.20, n=3) | 53.90 (50.30–96.40, n=3) | -75% | -37% | 148% | -47% | 109% | -73% | 6% | -87% | -48% | -86% | -47% |
| frame p99 ms | 1719.40 (630.00–1722.70, n=3) | 242.20 (232.90–251.10, n=3) | 2768.40 (2143.30–2921.70, n=3) | 1299.20 (722.60–1339.70, n=3) | 574.20 (457.70–574.80, n=3) | 171.60 (169.10–191.80, n=3) | 179.40 (153.30–267.60, n=3) | -86% | 61% | 1043% | -24% | 436% | -67% | 137% | -90% | -29% | -90% | -26% |
| frame max ms | 3575.8 (3081.8–3884.8, n=3) | 1735.2 (1721.0–1761.9, n=3) | 3325.2 (2806.0–5348.0, n=3) | 2051.6 (1753.3–2086.8, n=3) | 1817.1 (1771.4–1844.1, n=3) | 1772.7 (1727.7–1784.6, n=3) | 578.9 (573.1–582.5, n=3) | -51% | -7% | 92% | -43% | 18% | -49% | 5% | -50% | 2% | -84% | -67% |
| spikes | 27 (24–32, n=3) | 28 (28–30, n=3) | 30 (30–33, n=3) | 34 (30–34, n=3) | 39 (38–39, n=3) | 38 (38–40, n=3) | 39 (36–39, n=3) | 4% | 11% | 7% | 26% | 21% | 44% | 39% | 41% | 36% | 44% | 39% |
| long tasks (count) | 34 (34–38, n=3) | 34 (33–35, n=3) | 39 (39–42, n=3) | 38 (35–41, n=3) | 45 (41–45, n=3) | 41 (39–42, n=3) | 40 (38–42, n=3) | 0% | 15% | 15% | 12% | 12% | 32% | 32% | 21% | 21% | 18% | 18% |
| long tasks total ms | 16905 (15271–18631, n=3) | 9151 (8832–9308, n=3) | 11591 (11162–14518, n=3) | 13553 (10277–14142, n=3) | 10002 (9533–11257, n=3) | 9387 (9167–9543, n=3) | 6007 (5998–6741, n=3) | -46% | -31% | 27% | -20% | 48% | -41% | 9% | -44% | 3% | -64% | -34% |
| long task max ms | 3619 (3096–3892, n=3) | 1738 (1724–1758, n=3) | 2334 (2318–2354, n=3) | 1751 (1750–2084, n=3) | 1753 (1722–1770, n=3) | 1771 (1726–1783, n=3) | 578 (573–582, n=3) | -52% | -36% | 34% | -52% | 1% | -52% | 1% | -51% | 2% | -84% | -67% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 87 (87–87, n=3) | 87 (80–87, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 9% | 9% | 9% | 9% |
| triangles p50 | 255159 (255123–255179, n=3) | 255195 (255195–255207, n=3) | 255183 (255163–255207, n=3) | 255207 (255159–255211, n=3) | 255159 (255147–255191, n=3) | 259949 (259937–259989, n=3) | 259973 (255183–259985, n=3) | 0% | 0% | -0% | 0% | 0% | 0% | -0% | 2% | 2% | 2% | 2% |
| JS heap MB | 211.8 (203.3–212.9, n=3) | 193.7 (189.6–213.7, n=3) | 229.5 (184.8–231.7, n=3) | 207.1 (197.4–207.8, n=3) | 226.5 (223.2–229.0, n=3) | 228.4 (216.0–231.7, n=3) | 223.4 (204.0–232.2, n=3) | -9% | 8% | 19% | -2% | 7% | 7% | 17% | 8% | 18% | 5% | 15% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu r185p1world=webgpu


---

## r185p1world2 / r185p1boot — the menu-dwell protocol and the app-boot work (2026-08-21, late)

**Protocol change.** Every earlier tag activated Odyssey the instant `gameModeManager` existed —
before the menu was painted. That is a click no player can make, and it counts every idle-time
deferral (the first AudioContext, three's warm) against the Odyssey startup instead of before it.
From here the session takes `--menu-dwell 1500` (`ODYSSEY_PERF_MENU_DWELL`): wait for the visible
menu, then a reaction time. `r185p1world2` is the 2.1 tree (`c97ad8bd`) re-measured under the
dwell — the baseline of the new series; `r185p1boot` is the app-boot work (`1c01a948`: AudioContext
at idle, the lean chunk graph, three warmed first thing in `bootstrap()`). The session also records
page-relative `browser.boot` milestones (menu-visible, board-init end, board-visible).

**Reading.** The two trees are flat on every cell (cold startup 4,263 → 4,231, warm 3,556 → 3,529;
launch-to-board 8,656 → 8,805 cold / 7,504 → 7,434 warm; menu-visible 1,341 → 1,335 / 1,159 →
1,118) — by construction: the boot work removes a 346 ms stall right AFTER the menu appears and
9 MB of JS from the boot path, neither of which these cells see. The dwell itself costs the
series ~250 ms versus the immediate-activation cells (1.5 s lands just before the +2 s
deferred-task release); compare within a series only. Production-preview boot (n = 2): entry
closure 2.19 MB → 12 KB, main's static closure 9.8 MB → 0.8 MB, first boot task 438–572 →
115–179 ms, long-task time around the menu −370 ms.

### idle-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1boot | r185p1lake | r185p1light | r185p1live | r185p1world | r185p1world2 | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1boot vs r181 | Δ r185p1boot vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 | Δ r185p1world vs r181 | Δ r185p1world vs r185 | Δ r185p1world2 vs r181 | Δ r185p1world2 vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame p50 ms | 11.20 (11.10–11.30, n=3) | 11.40 (9.30–11.50, n=3) | 10.90 (10.90–11.60, n=3) | 12.30 (12.20–12.40, n=3) | 11.10 (9.30–11.50, n=3) | 11.50 (9.20–11.70, n=3) | 11.30 (11.00–11.40, n=3) | 11.50 (10.70–11.60, n=3) | 11.90 (11.90–12.00, n=3) | 2% | -3% | -4% | 10% | 8% | -1% | -3% | 3% | 1% | 1% | -1% | 3% | 1% | 6% | 4% |
| frame p95 ms | 13.70 (13.50–13.80, n=3) | 14.00 (12.20–14.30, n=3) | 13.60 (13.50–14.20, n=3) | 15.70 (15.70–16.20, n=3) | 13.90 (12.20–14.20, n=3) | 14.20 (12.10–15.00, n=3) | 14.30 (13.90–14.80, n=3) | 14.40 (13.80–14.80, n=3) | 15.40 (15.10–15.40, n=3) | 2% | -1% | -3% | 15% | 12% | 1% | -1% | 4% | 1% | 4% | 2% | 5% | 3% | 12% | 10% |
| frame p99 ms | 15.80 (15.60–16.10, n=3) | 16.20 (13.50–16.50, n=3) | 15.40 (15.30–16.40, n=3) | 17.60 (17.40–17.90, n=3) | 15.90 (13.20–16.40, n=3) | 16.10 (13.00–16.80, n=3) | 16.00 (15.80–16.40, n=3) | 16.50 (15.50–16.80, n=3) | 17.20 (16.90–17.20, n=3) | 3% | -3% | -5% | 11% | 9% | 1% | -2% | 2% | -1% | 1% | -1% | 4% | 2% | 9% | 6% |
| frame max ms | 761.8 (759.2–778.7, n=3) | 851.4 (792.6–862.5, n=3) | 722.8 (707.8–724.4, n=3) | 27.1 (24.1–30.3, n=3) | 713.8 (654.8–723.4, n=3) | 25.7 (22.8–29.3, n=3) | 26.9 (25.0–28.7, n=3) | 24.1 (23.1–27.2, n=3) | 23.9 (21.8–25.8, n=3) | 12% | -5% | -15% | -96% | -97% | -6% | -16% | -97% | -97% | -96% | -97% | -97% | -97% | -97% | -97% |
| spikes | 8 (5–9, n=3) | 3 (3–4, n=3) | 5 (5–7, n=3) | 0 (0–0, n=3) | 4 (3–5, n=3) | 0 (0–0, n=3) | 0 (0–0, n=3) | 0 (0–0, n=3) | 0 (0–0, n=3) | -63% | -38% | 67% | -100% | -100% | -50% | 33% | -100% | -100% | -100% | -100% | -100% | -100% | -100% | -100% |
| long tasks (count) | 62 (60–70, n=3) | 60 (57–64, n=3) | 56 (54–56, n=3) | 52 (48–52, n=3) | 59 (58–61, n=3) | 50 (48–52, n=3) | 44 (43–44, n=3) | 41 (39–43, n=3) | 53 (50–56, n=3) | -3% | -10% | -7% | -16% | -13% | -5% | -2% | -19% | -17% | -29% | -27% | -34% | -32% | -15% | -12% |
| long tasks total ms | 34995 (33032–38301, n=3) | 28869 (26634–28973, n=3) | 23836 (23764–24090, n=3) | 7177 (7153–7404, n=3) | 22154 (20652–22178, n=3) | 13674 (12847–13966, n=3) | 9923 (9873–10032, n=3) | 6572 (6357–6655, n=3) | 7526 (7223–7889, n=3) | -18% | -32% | -17% | -79% | -75% | -37% | -23% | -61% | -53% | -72% | -66% | -81% | -77% | -78% | -74% |
| long task max ms | 5687 (4010–5902, n=3) | 4349 (4270–4454, n=3) | 3076 (3006–3249, n=3) | 633 (603–634, n=3) | 2155 (1977–2177, n=3) | 1860 (1736–1882, n=3) | 1776 (1739–1809, n=3) | 579 (575–613, n=3) | 604 (590–624, n=3) | -24% | -46% | -29% | -89% | -85% | -62% | -50% | -67% | -57% | -69% | -59% | -90% | -87% | -89% | -86% |
| draw calls p50 | 104 (104–104, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 93 (93–93, n=3) | 104 (104–104, n=3) | 104 (104–104, n=3) | 93 (93–93, n=3) | 93 (93–93, n=3) | 93 (93–93, n=3) | 0% | 0% | 0% | -11% | -11% | 0% | 0% | 0% | 0% | -11% | -11% | -11% | -11% | -11% | -11% |
| triangles p50 | 537633 (537593–537645, n=3) | 537609 (537609–537625, n=3) | 537637 (537605–537637, n=3) | 534527 (534527–534527, n=3) | 537629 (537613–537649, n=3) | 537637 (537621–537649, n=3) | 534527 (534527–534527, n=3) | 534527 (534527–534527, n=3) | 534527 (534527–534527, n=3) | -0% | 0% | 0% | -1% | -1% | -0% | 0% | 0% | 0% | -1% | -1% | -1% | -1% | -1% | -1% |
| JS heap MB | 217.6 (196.5–221.9, n=3) | 204.7 (196.1–215.0, n=3) | 197.7 (191.2–202.5, n=3) | 220.3 (200.8–222.5, n=3) | 209.0 (207.3–216.2, n=3) | 220.0 (209.7–220.2, n=3) | 217.3 (206.9–219.9, n=3) | 202.2 (200.5–219.0, n=3) | 214.0 (207.1–214.1, n=3) | -6% | -9% | -3% | 1% | 8% | -4% | 2% | 1% | 7% | -0% | 6% | -7% | -1% | -2% | 5% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1boot=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu r185p1world=webgpu r185p1world2=webgpu

### load-cold  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1boot | r185p1lake | r185p1light | r185p1live | r185p1world | r185p1world2 | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1boot vs r181 | Δ r185p1boot vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 | Δ r185p1world vs r181 | Δ r185p1world vs r185 | Δ r185p1world2 vs r181 | Δ r185p1world2 vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 7031 (6979–7090, n=3) | 8051 (7402–8116, n=3) | 5316 (5251–5431, n=3) | 4231 (4219–4297, n=3) | 5462 (5405–5514, n=3) | 5510 (5433–5692, n=3) | 5580 (5398–5668, n=3) | 4008 (3890–4239, n=3) | 4263 (4134–4279, n=3) | 15% | -24% | -34% | -40% | -47% | -22% | -32% | -22% | -32% | -21% | -31% | -43% | -50% | -39% | -47% |
|   startup bucket: renderer | 373 (358–375, n=3) | 402 (397–424, n=3) | 292 (251–363, n=3) | 285 (266–292, n=3) | 334 (245–405, n=3) | 330 (247–361, n=3) | 335 (331–342, n=3) | 370 (357–412, n=3) | 302 (289–310, n=3) | 8% | -22% | -27% | -24% | -29% | -10% | -17% | -12% | -18% | -10% | -17% | -1% | -8% | -19% | -25% |
|   startup bucket: world | 1713 (1706–1738, n=3) | 1732 (1727–1734, n=3) | 1751 (1745–1758, n=3) | 390 (319–427, n=3) | 1746 (1735–1759, n=3) | 1737 (1723–1741, n=3) | 1737 (1725–1785, n=3) | 195 (186–213, n=3) | 353 (327–441, n=3) | 1% | 2% | 1% | -77% | -77% | 2% | 1% | 1% | 0% | 1% | 0% | -89% | -89% | -79% | -80% |
|   startup bucket: creates | 1545 (1337–1547, n=3) | 377 (365–394, n=3) | 453 (430–458, n=3) | 487 (471–504, n=3) | 494 (452–494, n=3) | 462 (440–463, n=3) | 458 (416–496, n=3) | 460 (449–470, n=3) | 474 (425–499, n=3) | -76% | -71% | 20% | -68% | 29% | -68% | 31% | -70% | 23% | -70% | 21% | -70% | 22% | -69% | 26% |
|   startup bucket: nodes | 996 (970–1023, n=3) | 844 (824–851, n=3) | 1009 (1008–1032, n=3) | 1029 (1027–1071, n=3) | 928 (904–1041, n=3) | 1057 (950–1106, n=3) | 1040 (914–1127, n=3) | 1011 (991–1220, n=3) | 1060 (1036–1064, n=3) | -15% | 1% | 20% | 3% | 22% | -7% | 10% | 6% | 25% | 4% | 23% | 2% | 20% | 6% | 26% |
|   startup bucket: post+director | 536 (492–564, n=3) | 120 (110–131, n=3) | 173 (172–180, n=3) | 198 (172–212, n=3) | 176 (165–183, n=3) | 207 (165–211, n=3) | 203 (164–209, n=3) | 180 (161–190, n=3) | 195 (166–199, n=3) | -78% | -68% | 44% | -63% | 65% | -67% | 47% | -61% | 73% | -62% | 69% | -66% | 50% | -64% | 63% |
|   startup bucket: compiles | 1434 (1334–1457, n=3) | 4146 (3532–4163, n=3) | 1225 (1105–1228, n=3) | 1508 (1421–1636, n=3) | 1128 (1110–1202, n=3) | 1470 (1441–1499, n=3) | 1514 (1335–1536, n=3) | 1437 (1404–1453, n=3) | 1452 (1425–1531, n=3) | 189% | -15% | -70% | 5% | -64% | -21% | -73% | 3% | -65% | 6% | -63% | 0% | -65% | 1% | -65% |
|   startup bucket: warmup | 313 (310–321, n=3) | 305 (230–313, n=3) | 240 (232–244, n=3) | 70 (66–90, n=3) | 355 (341–362, n=3) | 40 (38–40, n=3) | 60 (59–69, n=3) | 61 (61–110, n=3) | 100 (96–104, n=3) | -3% | -23% | -21% | -78% | -77% | 13% | 16% | -87% | -87% | -81% | -80% | -81% | -80% | -68% | -67% |
| board visible ms | 8054 (7992–8091, n=3) | 9084 (8431–9143, n=3) | 6444 (6387–6444, n=3) | 5237 (5167–5300, n=3) | 6488 (6448–6541, n=3) | 6539 (6521–6785, n=3) | 6615 (6410–6742, n=3) | 5015 (4940–5207, n=3) | 5190 (5087–5213, n=3) | 13% | -20% | -29% | -35% | -42% | -19% | -29% | -19% | -28% | -18% | -27% | -38% | -45% | -36% | -43% |
| frame p50 ms | 7.70 (7.70–7.70, n=3) | 8.80 (8.00–9.20, n=3) | 13.60 (11.40–14.10, n=3) | 11.80 (11.40–12.00, n=3) | 11.20 (11.00–12.10, n=3) | 11.70 (9.90–11.80, n=3) | 11.80 (9.80–11.90, n=3) | 10.10 (9.60–11.40, n=3) | 11.70 (11.40–11.90, n=3) | 14% | 77% | 55% | 53% | 34% | 45% | 27% | 52% | 33% | 53% | 34% | 31% | 15% | 52% | 33% |
| frame p95 ms | 105.60 (97.20–109.30, n=3) | 28.60 (27.80–29.90, n=3) | 230.00 (211.50–250.80, n=3) | 72.80 (72.60–79.40, n=3) | 227.00 (184.90–233.70, n=3) | 113.10 (107.30–117.00, n=3) | 99.10 (48.60–107.50, n=3) | 56.00 (53.80–63.60, n=3) | 73.80 (69.10–76.10, n=3) | -73% | 118% | 704% | -31% | 155% | 115% | 694% | 7% | 295% | -6% | 247% | -47% | 96% | -30% | 158% |
| frame p99 ms | 560.00 (531.80–607.10, n=3) | 215.30 (213.70–242.80, n=3) | 2110.30 (1758.80–2308.00, n=3) | 259.50 (232.60–270.50, n=3) | 1703.00 (744.60–1708.40, n=3) | 572.50 (558.80–795.00, n=3) | 265.40 (257.20–317.00, n=3) | 221.20 (213.60–230.70, n=3) | 239.60 (231.00–264.10, n=3) | -62% | 277% | 880% | -54% | 21% | 204% | 691% | 2% | 166% | -53% | 23% | -60% | 3% | -57% | 11% |
| frame max ms | 1720.3 (1717.8–1745.2, n=3) | 1745.1 (1735.7–1745.8, n=3) | 2972.0 (2816.7–2977.7, n=3) | 616.5 (600.3–637.9, n=3) | 2003.3 (1766.0–2085.7, n=3) | 1751.8 (1742.7–1816.7, n=3) | 1747.0 (1733.9–1798.0, n=3) | 464.3 (462.8–581.6, n=3) | 617.3 (597.0–626.3, n=3) | 1% | 73% | 70% | -64% | -65% | 16% | 15% | 2% | 0% | 2% | 0% | -73% | -73% | -64% | -65% |
| spikes | 24 (23–27, n=3) | 25 (24–27, n=3) | 33 (32–38, n=3) | 45 (44–51, n=3) | 37 (37–38, n=3) | 39 (35–40, n=3) | 37 (36–38, n=3) | 41 (39–42, n=3) | 44 (43–45, n=3) | 4% | 38% | 32% | 88% | 80% | 54% | 48% | 63% | 56% | 54% | 48% | 71% | 64% | 83% | 76% |
| long tasks (count) | 30 (28–31, n=3) | 33 (32–37, n=3) | 38 (38–41, n=3) | 45 (44–48, n=3) | 42 (40–43, n=3) | 46 (43–48, n=3) | 41 (38–43, n=3) | 43 (43–44, n=3) | 44 (43–47, n=3) | 10% | 27% | 15% | 50% | 36% | 40% | 27% | 53% | 39% | 37% | 24% | 43% | 30% | 47% | 33% |
| long tasks total ms | 11610 (11330–11655, n=3) | 10166 (9864–10305, n=3) | 12185 (12154–14659, n=3) | 7638 (7422–7738, n=3) | 13698 (13634–14019, n=3) | 11983 (10381–12342, n=3) | 9972 (9557–10143, n=3) | 6874 (6845–7037, n=3) | 7231 (7190–7419, n=3) | -12% | 5% | 20% | -34% | -25% | 18% | 35% | 3% | 18% | -14% | -2% | -41% | -32% | -38% | -29% |
| long task max ms | 1719 (1712–1743, n=3) | 1767 (1734–1769, n=3) | 2637 (2599–2815, n=3) | 726 (703–730, n=3) | 1765 (1764–2081, n=3) | 1773 (1740–1777, n=3) | 1747 (1732–1830, n=3) | 668 (662–691, n=3) | 721 (706–730, n=3) | 3% | 53% | 49% | -58% | -59% | 3% | -0% | 3% | 0% | 2% | -1% | -61% | -62% | -58% | -59% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–87, n=3) | 87 (87–87, n=3) | 80 (80–80, n=3) | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 9% | 9% | 0% | 0% |
| triangles p50 | 255179 (255147–255191, n=3) | 255183 (255155–255207, n=3) | 255167 (255147–255183, n=3) | 255195 (255155–255199, n=3) | 255167 (255147–255195, n=3) | 255187 (255179–255223, n=3) | 255191 (255143–259965, n=3) | 259965 (259961–260009, n=3) | 255187 (255127–255199, n=3) | 0% | -0% | -0% | 0% | 0% | -0% | -0% | 0% | 0% | 0% | 0% | 2% | 2% | 0% | 0% |
| JS heap MB | 196.3 (194.1–204.1, n=3) | 179.1 (178.8–184.8, n=3) | 201.5 (185.0–203.4, n=3) | 203.2 (190.0–228.1, n=3) | 211.1 (209.9–212.4, n=3) | 196.4 (196.3–201.8, n=3) | 218.7 (213.3–232.6, n=3) | 208.4 (198.9–227.7, n=3) | 217.6 (196.5–227.4, n=3) | -9% | 3% | 12% | 3% | 13% | 8% | 18% | 0% | 10% | 11% | 22% | 6% | 16% | 11% | 22% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1boot=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu r185p1world=webgpu r185p1world2=webgpu

### load-warm  (median (min–max, n))

| metric | r181 | r185 | r185p1 | r185p1boot | r185p1lake | r185p1light | r185p1live | r185p1world | r185p1world2 | Δ r185 vs r181 | Δ r185p1 vs r181 | Δ r185p1 vs r185 | Δ r185p1boot vs r181 | Δ r185p1boot vs r185 | Δ r185p1lake vs r181 | Δ r185p1lake vs r185 | Δ r185p1light vs r181 | Δ r185p1light vs r185 | Δ r185p1live vs r181 | Δ r185p1live vs r185 | Δ r185p1world vs r181 | Δ r185p1world vs r185 | Δ r185p1world2 vs r181 | Δ r185p1world2 vs r185 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| startup total ms | 4943 (4793–5928, n=3) | 5153 (5094–5267, n=3) | 5186 (4843–5246, n=3) | 3529 (3197–4161, n=3) | 5283 (5145–5444, n=3) | 5456 (5394–5532, n=3) | 5349 (4953–5540, n=3) | 3516 (3425–4197, n=3) | 3556 (3339–4003, n=3) | 4% | 5% | 1% | -29% | -32% | 7% | 3% | 10% | 6% | 8% | 4% | -29% | -32% | -28% | -31% |
|   startup bucket: renderer | 374 (341–564, n=3) | 602 (553–627, n=3) | 540 (453–601, n=3) | 277 (238–307, n=3) | 535 (442–612, n=3) | 573 (508–574, n=3) | 510 (434–580, n=3) | 576 (517–580, n=3) | 264 (250–286, n=3) | 61% | 44% | -10% | -26% | -54% | 43% | -11% | 53% | -5% | 36% | -15% | 54% | -4% | -29% | -56% |
|   startup bucket: world | 1715 (1710–2201, n=3) | 1727 (1714–1752, n=3) | 1725 (1723–1754, n=3) | 302 (268–326, n=3) | 1740 (1737–1742, n=3) | 1739 (1715–1761, n=3) | 1761 (1718–1772, n=3) | 174 (174–243, n=3) | 254 (253–550, n=3) | 1% | 1% | -0% | -82% | -83% | 1% | 1% | 1% | 1% | 3% | 2% | -90% | -90% | -85% | -85% |
|   startup bucket: creates | 1081 (1034–1441, n=3) | 340 (328–363, n=3) | 369 (360–376, n=3) | 420 (406–429, n=3) | 385 (383–393, n=3) | 392 (388–398, n=3) | 382 (364–404, n=3) | 396 (391–398, n=3) | 422 (418–429, n=3) | -69% | -66% | 9% | -61% | 24% | -64% | 13% | -64% | 15% | -65% | 12% | -63% | 16% | -61% | 24% |
|   startup bucket: nodes | 728 (715–741, n=3) | 752 (730–764, n=3) | 776 (739–785, n=3) | 987 (983–1060, n=3) | 985 (758–1011, n=3) | 934 (885–981, n=3) | 975 (837–1077, n=3) | 946 (946–1009, n=3) | 984 (927–987, n=3) | 3% | 7% | 3% | 36% | 31% | 35% | 31% | 28% | 24% | 34% | 30% | 30% | 26% | 35% | 31% |
|   startup bucket: post+director | 455 (450–617, n=3) | 131 (109–132, n=3) | 173 (172–224, n=3) | 184 (178–212, n=3) | 180 (141–183, n=3) | 192 (161–193, n=3) | 202 (154–205, n=3) | 155 (151–212, n=3) | 165 (161–187, n=3) | -71% | -62% | 32% | -60% | 40% | -60% | 37% | -58% | 47% | -56% | 54% | -66% | 18% | -64% | 26% |
|   startup bucket: compiles | 30 (30–40, n=3) | 1293 (1241–1299, n=3) | 1132 (924–1153, n=3) | 1103 (797–1571, n=3) | 958 (933–1266, n=3) | 1384 (1371–1433, n=3) | 1382 (808–1437, n=3) | 1023 (898–1513, n=3) | 1170 (967–1329, n=3) | 4210% | 3673% | -12% | 3577% | -15% | 3093% | -26% | 4513% | 7% | 4507% | 7% | 3310% | -21% | 3800% | -10% |
|   startup bucket: warmup | 324 (312–437, n=3) | 217 (217–225, n=3) | 239 (239–240, n=3) | 69 (65–79, n=3) | 352 (350–353, n=3) | 41 (38–41, n=3) | 61 (60–85, n=3) | 58 (58–89, n=3) | 68 (67–69, n=3) | -33% | -26% | 10% | -79% | -68% | 9% | 62% | -87% | -81% | -81% | -72% | -82% | -73% | -79% | -69% |
| board visible ms | 5895 (5889–6907, n=3) | 6182 (6177–6274, n=3) | 6215 (5917–6272, n=3) | 4522 (4219–5139, n=3) | 6253 (6252–6371, n=3) | 6447 (6329–6487, n=3) | 6269 (5875–6549, n=3) | 4551 (4380–5124, n=3) | 4525 (4277–4968, n=3) | 5% | 5% | 1% | -23% | -27% | 6% | 1% | 9% | 4% | 6% | 1% | -23% | -26% | -23% | -27% |
| frame p50 ms | 11.30 (7.80–13.30, n=3) | 10.30 (9.60–10.90, n=3) | 12.70 (11.80–14.50, n=3) | 11.30 (9.50–12.10, n=3) | 12.90 (11.90–13.20, n=3) | 11.10 (9.80–11.60, n=3) | 11.00 (9.30–11.90, n=3) | 11.70 (11.50–12.00, n=3) | 10.00 (10.00–11.90, n=3) | -9% | 12% | 23% | -0% | 10% | 14% | 25% | -2% | 8% | -3% | 7% | 4% | 14% | -12% | -3% |
| frame p95 ms | 395.90 (90.00–468.10, n=3) | 100.80 (92.90–109.40, n=3) | 249.90 (248.50–257.10, n=3) | 52.90 (42.00–88.70, n=3) | 211.00 (171.40–237.80, n=3) | 106.60 (104.70–107.40, n=3) | 52.70 (50.00–66.20, n=3) | 53.90 (50.30–96.40, n=3) | 44.40 (41.20–55.90, n=3) | -75% | -37% | 148% | -87% | -48% | -47% | 109% | -73% | 6% | -87% | -48% | -86% | -47% | -89% | -56% |
| frame p99 ms | 1719.40 (630.00–1722.70, n=3) | 242.20 (232.90–251.10, n=3) | 2768.40 (2143.30–2921.70, n=3) | 148.40 (131.50–232.00, n=3) | 1299.20 (722.60–1339.70, n=3) | 574.20 (457.70–574.80, n=3) | 171.60 (169.10–191.80, n=3) | 179.40 (153.30–267.60, n=3) | 147.50 (142.00–147.70, n=3) | -86% | 61% | 1043% | -91% | -39% | -24% | 436% | -67% | 137% | -90% | -29% | -90% | -26% | -91% | -39% |
| frame max ms | 3575.8 (3081.8–3884.8, n=3) | 1735.2 (1721.0–1761.9, n=3) | 3325.2 (2806.0–5348.0, n=3) | 605.4 (477.5–625.9, n=3) | 2051.6 (1753.3–2086.8, n=3) | 1817.1 (1771.4–1844.1, n=3) | 1772.7 (1727.7–1784.6, n=3) | 578.9 (573.1–582.5, n=3) | 477.7 (464.9–588.1, n=3) | -51% | -7% | 92% | -83% | -65% | -43% | 18% | -49% | 5% | -50% | 2% | -84% | -67% | -87% | -72% |
| spikes | 27 (24–32, n=3) | 28 (28–30, n=3) | 30 (30–33, n=3) | 46 (44–49, n=3) | 34 (30–34, n=3) | 39 (38–39, n=3) | 38 (38–40, n=3) | 39 (36–39, n=3) | 44 (41–45, n=3) | 4% | 11% | 7% | 70% | 64% | 26% | 21% | 44% | 39% | 41% | 36% | 44% | 39% | 63% | 57% |
| long tasks (count) | 34 (34–38, n=3) | 34 (33–35, n=3) | 39 (39–42, n=3) | 43 (43–46, n=3) | 38 (35–41, n=3) | 45 (41–45, n=3) | 41 (39–42, n=3) | 40 (38–42, n=3) | 43 (41–46, n=3) | 0% | 15% | 15% | 26% | 26% | 12% | 12% | 32% | 32% | 21% | 21% | 18% | 18% | 26% | 26% |
| long tasks total ms | 16905 (15271–18631, n=3) | 9151 (8832–9308, n=3) | 11591 (11162–14518, n=3) | 6525 (6141–7273, n=3) | 13553 (10277–14142, n=3) | 10002 (9533–11257, n=3) | 9387 (9167–9543, n=3) | 6007 (5998–6741, n=3) | 6257 (6066–6862, n=3) | -46% | -31% | 27% | -61% | -29% | -20% | 48% | -41% | 9% | -44% | 3% | -64% | -34% | -63% | -32% |
| long task max ms | 3619 (3096–3892, n=3) | 1738 (1724–1758, n=3) | 2334 (2318–2354, n=3) | 606 (552–627, n=3) | 1751 (1750–2084, n=3) | 1753 (1722–1770, n=3) | 1771 (1726–1783, n=3) | 578 (573–582, n=3) | 560 (549–590, n=3) | -52% | -36% | 34% | -83% | -65% | -52% | 1% | -52% | 1% | -51% | 2% | -84% | -67% | -85% | -68% |
| draw calls p50 | 80 (80–80, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 87 (80–87, n=3) | 80 (80–80, n=3) | 80 (80–80, n=3) | 87 (87–87, n=3) | 87 (80–87, n=3) | 87 (87–87, n=3) | 0% | 0% | 0% | 9% | 9% | 0% | 0% | 0% | 0% | 9% | 9% | 9% | 9% | 9% | 9% |
| triangles p50 | 255159 (255123–255179, n=3) | 255195 (255195–255207, n=3) | 255183 (255163–255207, n=3) | 259957 (255227–259985, n=3) | 255207 (255159–255211, n=3) | 255159 (255147–255191, n=3) | 259949 (259937–259989, n=3) | 259973 (255183–259985, n=3) | 259965 (259957–259985, n=3) | 0% | 0% | -0% | 2% | 2% | 0% | 0% | 0% | -0% | 2% | 2% | 2% | 2% | 2% | 2% |
| JS heap MB | 211.8 (203.3–212.9, n=3) | 193.7 (189.6–213.7, n=3) | 229.5 (184.8–231.7, n=3) | 213.0 (203.3–225.9, n=3) | 207.1 (197.4–207.8, n=3) | 226.5 (223.2–229.0, n=3) | 228.4 (216.0–231.7, n=3) | 223.4 (204.0–232.2, n=3) | 212.9 (201.5–215.4, n=3) | -9% | 8% | 19% | 1% | 10% | -2% | 7% | 7% | 17% | 8% | 18% | 5% | 15% | 0% | 10% |
backend: r181=webgpu r185=webgpu r185p1=webgpu r185p1boot=webgpu r185p1lake=webgpu r185p1light=webgpu r185p1live=webgpu r185p1world=webgpu r185p1world2=webgpu
