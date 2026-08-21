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

