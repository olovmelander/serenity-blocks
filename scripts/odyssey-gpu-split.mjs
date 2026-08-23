/**
 * WAVE −1 — GPU-time split for the Odyssey board, published to reports/odyssey-perf/.
 *
 * Usage:
 *   node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane A
 *   node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane B --low-power
 *
 * WHY A MATRIX. This script prices OBJECTS, and no pass boundary isolates an object: removing
 * one system and diffing against baseline is the only way to attribute its cost. That is a
 * weak instrument — it cannot see overlap between systems (overlapping cost lands on whichever
 * is removed first), and on Lane A the whole frame is only ~22 timestamp ticks (65.536 us
 * quantum), so a 0.0-0.3 ms per-object delta sits below the noise. Always read
 * `baselineDriftMs` and `contentMismatch` before believing a delta.
 *
 * WHAT CHANGED ON 0.185.1. The original rationale here also claimed there was nowhere to hang
 * a per-pass query without forking the renderer. That was true of r181; it is NOT true now.
 * The WebGPU pool retains a duration per render-pass uid (`WebGPUTimestampQueryPool.js`
 * `timestamps.set(uid, duration)`, uid from `Backend.js` `getTimestampUID`, one query pair per
 * pass in `WebGPUBackend.js`), and the board publishes it as `passes[]` on
 * `window.__ODYSSEY_GPU_PROFILE__` (OdysseyBoardController `_recordPassTimestamps`). So:
 * pass-level questions (scene vs bloom mip vs composite) are answered by ONE run with no
 * differential and no drift subtraction — do not reach for this matrix to answer them.
 *
 * Discipline (the wave's exit criterion): p50/p99 only, never a mean; fixed-size ring; draw
 * calls latched once per frame. All of that lives in src/utils/perf-ring.js and the board's
 * _sampleGpuProfile; this script only drives configurations and writes the file.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */

import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const { app, BrowserWindow } = electron;
const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 4179);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LANE = String(args.lane || 'A').toUpperCase();
const LOW_POWER = args['low-power'] === true || args.lowPower === true;
const QUALITY = String(args.quality || (LANE === 'B' ? 'Medium' : 'High'));
const SETTLE_MS = Number(args.settle || 9000);
const SAMPLE_MS = Number(args.sample || 14000);
// §8 specifies Lane A at 1920x1080 and Lane B at 1280x720. Measuring Lane A at 720p put the
// whole scene at ~1 ms on a 5080, where every configuration's p50 landed within ONE tick of
// the GPU timer's ~0.065 ms quantization and no system could be told apart from the drift.
// Measure the lane the budget is written against, or the numbers answer a different question.
const WIDTH = Math.max(320, Number(args.width || (LANE === 'B' ? 1280 : 1920)));
const HEIGHT = Math.max(240, Number(args.height || (LANE === 'B' ? 720 : 1080)));
// Journey progress to measure at. 0.42 sits inside chapter 4 — mid Act II, the frame One
// World actually changes — rather than at the journey start where the board parks.
const SEEK = Number.isFinite(Number.parseFloat(args.seek)) ? Number.parseFloat(args.seek) : 0.42;
// Which chapter environments the board is allowed to create. Defaults to the Act II window
// this harness was built for; Act I measurements pass --chapters 1,2,3 (chapter 1 is never
// created under the default window, so a --seek into it would measure an empty frame).
const CHAPTERS = args.chapters ? String(args.chapters) : '3,4,5';
// Output filename. Defaults to the canonical lane report; anything measuring a DIFFERENT
// station/window must pass --out so it cannot clobber the Act II baselines behind the
// perf-budgets.json cells.
const OUT_FILE = args.out ? String(args.out) : null;
// Extra URL flags applied to EVERY configuration (comma-separated k=v). Exists because the
// ch1 station has a drawable that flickers 92<->93 on a time-driven cadence, which voids
// every baseline/repeat pair via the content-match guard. Applying a flag to BOTH sides
// (e.g. --flags odysseyHideLevelNodes=1) keeps the pair comparable by construction and lets
// the flicker be bisected by subsystem instead of guessed at.
const EXTRA_FLAGS = {};
if (args.flags) {
    String(args.flags).split(',').forEach((pair) => {
        const [k, v = '1'] = pair.split('=');
        if (k) EXTRA_FLAGS[k.trim()] = v.trim();
    });
}
const BREAK = String.fromCharCode(10);
const OUT_DIR = path.join(ROOT, 'reports', 'odyssey-perf');

// Each configuration removes ONE system. baseline must run first and last: a drifting
// baseline (thermal throttling, a background compile) invalidates every delta between them,
// and the only way to know is to measure it twice.
const CONFIGURATIONS = [
    { id: 'baseline', flags: {}, note: 'everything on' },
    { id: 'no-bloom', flags: { odysseyPerfDisableBloom: '1' }, note: 'bloom node detached from the post graph' },
    {
        id: 'no-level-nodes',
        flags: { odysseyHideLevelNodes: '1' },
        note: '55 nodes x 3 nested transparent shells hidden',
    },
    // One World is the DEFAULT path since Wave 3, so `baseline` IS One World and the old
    // `one-world` configuration compared it against itself — a guaranteed zero delta that
    // would have read as "the rebuild costs nothing". The comparison that means something now
    // is against the LEGACY dioramas, which is what the escape hatch restores.
    {
        id: 'legacy-dioramas',
        flags: { odysseyOneWorld: '0' },
        note: 'chapters 2-5 back to their own environments (the ?odysseyOneWorld=0 fallback)',
    },
    {
        id: 'legacy-no-level-nodes',
        flags: { odysseyOneWorld: '0', odysseyHideLevelNodes: '1' },
        note: 'legacy dioramas without the orb group',
    },
    // THE SEA PLATE (Ghibli-water plan, Wave 0). One ungated DoubleSide transparent clipmap
    // that draws across the whole act window (p 0.063-0.678) and whose total cost had never
    // been measured because nothing could switch it off. Run as
    // `--only baseline,no-water,baseline-repeat` so the differential AND its drift bound come
    // from ONE cooled session.
    {
        id: 'no-water',
        flags: { odysseyWorldNoWater: '1' },
        note: 'the Act II sea plate is not built at all (draws, fill, vertex and pipeline)',
    },
    // THE CLOUD DECK (Act II cloud plan, Wave 0). One transparent clipmap sheet at y=660
    // drawing across the whole act window whose cost has NEVER been measured -- and ADR-0016
    // is explicit that an unmeasured cost cannot fund a package, so this differential is the
    // prerequisite for every visual wave in that plan. Note the lever is asymmetric with
    // `no-water`: the deck mesh is still constructed and only withheld from the group
    // (odyssey-world-renderer.js:1166), so this prices DRAWS + FILL + VERTEX, and any
    // pipeline-compile cost stays on both sides of the pair. Run as
    // `--only baseline,no-clouds,baseline-repeat` so the differential AND its drift bound
    // come from ONE cooled session.
    {
        id: 'cloud-sheet',
        flags: { odysseyWorldCloudSheet: '1' },
        note: 'the Act II cloud deck is not added to the world group (draws, fill, vertex)',
    },
    // THE HERO CUMULUS (cloud plan §7.1) — RETIRED BY THE OWNER 2026-08-14, so the polarity
    // FLIPPED: heroes are opt-in (?odysseyWorldHeroes=1) and the baseline is heroless. The old
    // `no-heroes` configuration would now measure baseline-vs-baseline and report exactly 0,
    // which is the wrong kind of true. Historical reports gpu-split-laneb-heroes-*.json were
    // measured under the old polarity (baseline INCLUDED heroes). The measured law survives in
    // perf-budgets.json: opaque merged geometry rasterises only its own silhouette, emits no
    // blend state, and cost 1-2 timer ticks — but it is purely ADDITIVE (a hero above an
    // overhead sheet never occludes a deck fragment). Run as
    // `--only baseline,heroes,baseline-repeat`; heroesMs is now the cost of ADDING them.
    {
        id: 'heroes',
        flags: { odysseyWorldHeroes: '1' },
        note: 'the retired Act II hero cumulus added back to the world group',
    },
    // THE CLOUD FIELD (cloud-field plan Wave 0a). Opt-in, like `heroes`: the baseline is the
    // shipped sheet, so `fieldMs` is the cost of ADDING a sky's worth of opaque cloud geometry.
    // Argument order carries the sign — never also negate (the heroes cell's double-flip).
    // Run as `--only baseline,cloud-field,baseline-repeat`.
    {
        id: 'no-cloud-field',
        flags: { odysseyWorldNoCloudField: '1' },
        note: 'the shipped sculpted cloud field withheld from the world group',
    },
    // HALF the probe masses — the second point on the cost curve. Run all four as
    // `--only baseline,cloud-field-half,cloud-field,baseline-repeat` to get both in one
    // thermal window, which is the only way the two are comparable.
    {
        id: 'cloud-field-half',
        flags: { odysseyWorldCloudFieldCount: '26' },
        note: 'half the sculpted field, for the cost curve',
    },
    // THE FOREST (Act II forest plan, Wave 0a). The largest content system in the world file
    // — 15,412 trees / 40 InstancedMesh chunks / ~462k triangles at high quality — and the
    // last big one whose cost has NEVER been measured as a differential, for the same reason
    // the water's had not been: nothing in the tree could switch it off. ADR-0016 makes this
    // pair the prerequisite for the whole overhaul. The lever is the `no-water` shape, not
    // the deck's: the forest is never built, so this prices DRAWS + FILL + VERTEX + PIPELINE
    // together. That matters here more than it did for the sea plate — the forest's own
    // header law is that its cost is VERTEX, not fill, so a gate that left 40 meshes
    // constructed and merely hidden would price the wrong half of it.
    // Run at the forest-facing stations, one thermal window each:
    //   --seek 0.225 --chapters 2,3   --only baseline,no-forest,baseline-repeat
    //   --seek 0.42  --chapters 3,4,5 --only baseline,no-forest,baseline-repeat
    // and always with --out, so a non-canonical station cannot clobber the Act II baselines.
    {
        id: 'no-forest',
        flags: { odysseyWorldNoForest: '1' },
        note: 'the Act II forest is not scattered or built at all (draws, fill, vertex and pipeline)',
    },
    // THE RETIRED CONE FOREST (swap 2026-08-14). The roster ships, so baseline CONTAINS it and
    // `forestMs` prices the NEW forest; this lever restores the incumbent, priced against the
    // forest's absence like every whole-forest configuration. The old `forest-v2` id is
    // retired WITH its flag — a configuration driving a flag nobody reads would collect a p50
    // identical to baseline and report a real cost as zero (the heroes' lesson).
    // THE GROUND'S FRAGMENT STACK (ground plan Wave 0a) — asymmetric, like the cloud deck's:
    // the geometry is built identically and only the disputed fragment work is withheld, so
    // draws and triangles agree EXACTLY on both sides and the content-match guard passes by
    // construction rather than by luck. Prices detail-bump octaves, the atlas fetch, the biome
    // mixes, curvature, strata, the caustic web and the two-model shadow. Caveat for the cell:
    // pipeline compile stays on both sides, so the figure is a floor, not a ceiling.
    {
        id: 'flat-ground',
        flags: { odysseyWorldFlatGround: '1' },
        note: 'the ground keeps its geometry and loses its fragment mesostructure '
            + '(constant albedo under the baked sun)',
    },
    {
        id: 'forest-v1',
        flags: { odysseyWorldForestV1: '1' },
        note: 'the retired incumbent cone forest restored in place of the roster',
    },
    // ── CH6 SPACE (ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md, Wave 0) ──────────────
    // Ch6 has NEVER had a station or a budget cell; these five levers price the diorama
    // tier by tier before the Painted-Cosmos overhaul touches anything. Each tier is
    // never BUILT under its flag (the `no-water` lever shape: draws + fill + vertex +
    // pipeline together — the tiers are additive-blended sprites, so fill is the
    // suspected whale and an asymmetric hide-only lever would price the wrong half).
    // Stations (all with --chapters 5,6,7 and --out, so they cannot clobber Act II):
    //   entry --seek 0.665 · reef --seek 0.73 · fall --seek 0.80
    // Run per station, ONE thermal window:
    //   --only baseline,ch6-no-dome,ch6-no-nebula,ch6-no-dust,ch6-no-stars,ch6-no-heroes,ch6-no-aurora,baseline-repeat
    // The content-match guard only judges baseline/baseline-repeat; differential rows
    // are EXPECTED to change draws — verify each row's draw count actually drops, or the
    // lever is dead and reports innocence, not absence.
    {
        id: 'ch6-no-dome',
        flags: { odysseyCh6NoDome: '1' },
        note: 'ch6 void-sky dome not built (per-fragment FBM backdrop — the Act I whale pattern)',
    },
    {
        id: 'ch6-no-nebula',
        flags: { odysseyCh6NoNebula: '1' },
        note: 'ch6 nebula tiers (110 near + 90 far domain-warped-FBM additive sprites) + pillar not built',
    },
    {
        id: 'ch6-no-dust',
        flags: { odysseyCh6NoDust: '1' },
        note: 'ch6 dust tiers + 500 suction debris + 90 streak motes not built',
    },
    {
        id: 'ch6-no-stars',
        flags: { odysseyCh6NoStars: '1' },
        note: 'ch6 starfield tiers (~1200 far + ~350 near instanced quads) not built',
    },
    {
        id: 'ch6-no-heroes',
        flags: { odysseyCh6NoHeroes: '1' },
        note: 'ch6 hero triad (black hole assembly, gas giant + rings, galaxy) not built',
    },
    // THE RETIRED FBM DOME (Space overhaul Wave 2 swap). The baked dome ships, so the
    // baseline IS the bake and this lever ADDS the old per-fragment-FBM dome back in
    // its place — the differential is the cost of the retired system (argument order
    // carries the sign: configuration minus baseline, like `cloud-sheet`).
    {
        id: 'ch6-procedural-dome',
        flags: { odysseyCh6ProceduralDome: '1' },
        note: 'the retired FBM void dome restored in place of the baked backdrop',
    },
    // THE RETIRED NEBULA SPRITES (Space overhaul Wave 3 swap). A TRUE swap lever —
    // sprites on means the sculpted field is withheld — so this single differential
    // is the swap's whole price in one thermal window (unlike the cloud sheet, whose
    // add-back stacked on top of the field and left the swap price an ESTIMATE).
    {
        id: 'ch6-nebula-sprites',
        flags: { odysseyCh6NebulaSprites: '1' },
        note: 'the retired additive nebula sprite tiers + billboard pillar restored in place of the sculpted field',
    },
    // THE AURORAL CROWN (Space overhaul Wave 5). Unlike the two swap levers above this
    // one is a plain REMOVE — the crown is new, so baseline-minus-lever is its own price.
    // The lever drops BOTH halves (the +1-draw curtain mesh and the gas giant's surface
    // term), because pricing only the mesh would miss the hero's extra fragment ALU.
    {
        id: 'ch6-no-aurora',
        flags: { odysseyCh6NoAurora: '1' },
        note: 'ch6 hero auroral crown withheld — curtain mesh AND the gas-giant surface term',
    },
    // THE 5->6 SEAM LIMB. `odysseyNoCloudBank=1` skips createCloudBank entirely
    // (OdysseyBoardController.js), so this prices the whole object — draws, fill, vertex AND
    // its pipeline compile — the same lever SHAPE as `no-water`, not a material swap.
    //
    // ⚠️ The seam has NEVER been priced. `render.gpuMs` in the chapter-capture sidecars reads
    // 0 at all 18 stations and always has: that harness sends `odysseyOverlay=0`, which makes
    // isOdysseyAAADebugEnabled() false, so the renderer is built with trackTimestamp:false and
    // no query pool ever exists. It is a constructor default being mistaken for a measurement.
    // THIS script is the correct instrument — it sets odysseyGpuProfile=1, which arms both
    // switches, discards a warm-up, and voids on content mismatch.
    //
    // Seek 0.7401 (the boundary) for the worst frame — the rising branch peaks at density 1.0
    // there. Seek 0.7941 for the direction question: the new envelope still has density 0.0386
    // where the old one was exactly 0, and the camera is INSIDE the r=620 ellipsoid where it
    // was outside the r=150 one.
    {
        id: 'no-cloud-bank',
        flags: { odysseyNoCloudBank: '1' },
        note: 'the ch5->6 limb bank is never built (draws + fill + vertex + pipeline compile)',
    },
    // THE LAVA LAKE (docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md §4, gate G1/G2). Prices
    // the lake's fill on each lane: `no-lake` withholds the mesh (earth-core.js bisect lever),
    // `lake-baked` swaps its 19 analytic simplex bodies per fragment for 19 fetches of the
    // periodic R16F 3D texture. Run at the entry station, where the lake fills the lower frame:
    //   --lane B --low-power --seek 0 --chapters 1 --only baseline,no-lake,lake-baked,baseline-repeat
    // Accept (design §4): lakeBakedMs ≤ 0.5 × lakeMs with the differential ≥ 4 timer ticks and
    // baseline drift ≤ 25 % of the saving.
    { id: 'no-lake', flags: { earthCoreNoLake: '1' }, note: 'the Earth Core lava lake is not built' },
    // SPLIT LEVER. `no-lake` withholds SIX draws: the 360x360 lake plane AND five large additive
    // glow sprites (ambient 120u, inner 70u, three basin coronas 66-84u, all frustumCulled=false
    // and depthWrite=false). So `lakeMs` is plane PLUS sprite fill, and the split between them
    // was unknown. It matters because the fixes are opposite: a cheaper lake shader, versus
    // simply cutting sprites. Run the trio in ONE cooled session so all three share a baseline:
    //   --lane B --low-power --seek 0 --chapters 1 --flags odysseyHideLevelNodes=1     //     --only baseline,no-lake,no-lake-glows,baseline-repeat
    // Liveness gate: no-lake drops SIX draws, no-lake-glows drops exactly FIVE. A five-draw drop
    // is the proof the lever hit the sprites and only the sprites.
    {
        id: 'no-lake-glows',
        flags: { earthCoreNoLakeGlows: '1' },
        note: 'the lake plane still draws; its five additive glow sprites are withheld',
    },
    { id: 'lake-baked', flags: { earthCoreLakeBake: '1' }, note: 'lake noise from the baked 3D texture' },
    { id: 'baseline-repeat', flags: {}, note: 'drift check against the first baseline' },
];

// Lane B is an iGPU, and CLAUDE.md records that long WebGPU sessions have TDR-crashed this
// machine's integrated part. --only lets that lane run the two configurations that actually
// answer §8's open question (baseline, and the level-node group) instead of all six.
const ONLY = args.only ? String(args.only).split(',').map((t) => t.trim()) : null;

let devServer = null;

/**
 * Kill the dev server AND ITS CHILDREN.
 *
 * The server is spawned with `shell: true` on Windows, so `devServer.kill()` reaps the shell
 * and leaves node/Vite listening. Because every run uses `--strictPort`, the NEXT invocation
 * then fails with "dev server did not start in 90s" — a leak that presents as a harness bug.
 * The 2026-08-12 Act I session lost three measurement runs to it (and wedged one half-run
 * holding the port) before the orphans were swept by hand. Kill the tree instead.
 */
function killDevServerTree() {
    const proc = devServer;
    devServer = null;
    if (!proc || proc.killed || !proc.pid) return;
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
            return;
        } catch { /* fall through to the POSIX path */ }
    }
    proc.kill();
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const fmt = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}ms` : '—');

async function startDevServer() {
    return new Promise((resolve, reject) => {
        devServer = spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['vite', '--port', String(PORT), '--strictPort'],
            {
                cwd: ROOT,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
                // Isolated dep cache: sharing node_modules/.vite with an interactive dev
                // server corrupts the optimizer and wedges BOTH servers (the "everything
                // freezes" bug). Port-scoped so concurrent harnesses cannot collide either.
                env: { ...process.env, VITE_CACHE_DIR: `node_modules/.vite-harness-${PORT}` },
            },
        );
        const timer = setTimeout(() => reject(new Error('dev server did not start in 90s')), 90000);
        devServer.stdout.on('data', (chunk) => {
            if (String(chunk).includes('ready in') || String(chunk).includes(String(PORT))) {
                clearTimeout(timer);
                setTimeout(resolve, 1200);
            }
        });
        devServer.on('error', reject);
    });
}

function urlFor(flags) {
    const params = new URLSearchParams({
        skipIntro: '1',
        odysseyGpuProfile: '1',
        odysseyOverlay: '0',
        odysseyPixelRatio: '1',
        odysseyDisableAdaptiveQuality: '1',
        odysseyDisableBackgroundLoading: '1',
        // Load only the Act II window. Without this the board creates and warms all EIGHT
        // chapters before isActive flips, which on a cold shader cache runs past the readiness
        // wait — and it was One World, the heaviest boot, that always lost that race and
        // recorded null. Applied to EVERY configuration so they stay comparable, and it also
        // makes the measured frame the Act II frame, which is the one One World changes.
        odysseyCaptureChapters: CHAPTERS,
        // Chromium's switch alone is not enough: the board asks the renderer for
        // 'high-performance', which hands back the discrete part regardless.
        ...(LOW_POWER ? { odysseyLowPowerGpu: '1' } : {}),
        quality: QUALITY,
        bust: String(Date.now()),
        ...EXTRA_FLAGS,
        ...flags,
    });
    return `${BASE_URL}/?${params.toString()}`;
}

async function loadWithRetry(win, url, attempts = 4) {
    for (let i = 0; i < attempts; i += 1) {
        try {
            await win.loadURL(url);
            return;
        } catch (error) {
            if (i === attempts - 1) throw error;
            process.stdout.write(`[gpu-split]   load retry ${i + 1} (${error?.message ?? error})
`);
            await wait(2500 * (i + 1));
        }
    }
}

async function runConfiguration(config) {
    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: true, // GPU timestamps are unavailable to an occluded surface.
        webPreferences: { backgroundThrottling: false, offscreen: false },
    });
    try {
        // Vite re-runs its dependency optimizer when a new query string shows up, and serves a
        // 504 for the second or so it takes — which Electron reports as a flat ERR_FAILED and
        // which killed configuration 2 of 6 on three consecutive runs. Retry rather than treat
        // a transient dev-server hiccup as a measurement failure.
        await loadWithRetry(win, urlFor(config.flags));
        // Loading the page is not entering the mode: without this the harness would settle,
        // sample, and publish a confident GPU-time split of the main menu.
        await win.webContents.executeJavaScript(`(async () => {
            const waitFor = async (fn, ms = 240000) => {
                const until = Date.now() + ms;
                while (Date.now() < until) {
                    try { if (await fn()) return true; } catch (e) { /* still booting */ }
                    await new Promise((r) => setTimeout(r, 250));
                }
                return false;
            };
            await waitFor(() => window.serenityBlocks?.gameModeManager);
            window.settings = {
                ...(window.settings || {}),
                effectQuality: ${JSON.stringify(QUALITY)},
                graphicsQuality: ${JSON.stringify(QUALITY)},
            };
            window.settingsManager?.update?.({
                effectQuality: ${JSON.stringify(QUALITY)},
                graphicsQuality: ${JSON.stringify(QUALITY)},
            });
            const gm = window.serenityBlocks.gameModeManager;
            if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (!gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            return waitFor(() => window.odysseyMode?.boardController?.isActive === true);
        })()`, true);
        // SEEK INTO ACT II BEFORE SAMPLING. Without this the harness measures the board where
        // it PARKS — the journey start — which for an Act II-scoped chapter window is 40 draws
        // and 0.13 ms of empty frame. Every One World delta measured that way is a delta of
        // nothing. Mechanism borrowed from odyssey-chapter-capture.mjs's settleAtPosition.
        await win.webContents.executeJavaScript(`
            (() => {
                const bc = window.odysseyMode?.boardController;
                if (!bc?.cameraController) return false;
                const pos = ${SEEK};
                bc.cameraController.setCurrentPosition(pos);
                bc.cameraController.updateFollowPosition?.({ position: pos, direct: true });
                // PIN THE STATION. Seeking alone does not hold: the controller keeps an
                // in-flight travel/drift model that overrides the seeked position on the very
                // next frame, so a long sample window slowly walks off the station. The
                // 2026-08-12 Lane A run is the evidence — baseline sampled 53 draws /
                // 758,151 tris and baseline-repeat 39 / 535,543, i.e. a different scene, and
                // the difference was published as thermal drift. Same hardening as
                // scripts/odyssey-perf-session.mjs, which already got this right.
                if (bc.cameraController.travelModel) {
                    bc.cameraController.travelModel.velocity = 0;
                    bc.cameraController.travelModel.inputVelocity = 0;
                }
                if (bc.cameraController.config) {
                    bc.cameraController.config.autoDriftScale = 0;
                }
                const blendState = bc.environmentManager?.getBlendState(pos) || null;
                bc.environmentManager?.updateVisibility(pos, { mode: 'progress', blendState });
                bc.environmentManager?.updateGlobalEnvironment(pos, blendState);
                const directorState = bc.director?.update?.(1 / 60, {
                    ascentProgress: pos, audio: null, blendState,
                }) || bc.director?.getState?.() || null;
                bc.cameraController?.setDirectorState?.(directorState);
                bc.nodeManager?.setCameraProgress(pos);
                return bc.cameraController.getCurrentPosition?.() ?? true;
            })()
        `, true).catch(() => {});
        await wait(SETTLE_MS);
        // Discard everything sampled while pipelines were still compiling — a cold compile is
        // a real cost, but it is a STARTUP cost and averaging it into steady state hides both.
        await win.webContents.executeJavaScript(
            'window.__ODYSSEY_GPU_RESET__?.(); true',
        ).catch(() => {});
        await wait(SAMPLE_MS);
        const summary = await win.webContents.executeJavaScript(
            'window.__ODYSSEY_GPU_PROFILE__ ?? null',
        );
        return { ...config, summary };
    } finally {
        win.destroy();
        await wait(2000);
    }
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i += 1; }
    }
    return out;
}

/**
 * CONTENT MATCH — did two configurations actually render comparable scenes?
 *
 * A differential is only meaningful if everything except the toggled system was equal. The
 * 2026-08-12 Lane A run is the cautionary case: `baseline` recorded 53 draws / 758,151 tris
 * and `baseline-repeat` recorded 39 / 535,543 — the camera had drifted off the seeked
 * station (an in-flight path animation silently overrides `seekProgress`), so the pair
 * measured different scenes and the published `baselineDriftMs: 0.786` was scene difference
 * reported as thermal drift. Nothing in the harness noticed.
 *
 * Draw calls are the sharper signal (integer, and insensitive to LOD wobble), so a mismatch
 * there voids the figure outright; triangles get a small tolerance for per-frame instance
 * culling. A voided delta is reported as null WITH a reason rather than silently omitted —
 * a missing number invites a re-run, a wrong number gets quoted in a plan for weeks.
 */
function contentMismatch(a, b, results) {
    const byId = Object.fromEntries(results.map((r) => [r.id, r.summary ?? null]));
    const A = byId[a];
    const B = byId[b];
    if (!A || !B) return null;
    if (!Number.isFinite(A.drawCalls) || !Number.isFinite(B.drawCalls)) return null;
    if (A.drawCalls !== B.drawCalls) {
        return `draw calls differ (${a}=${A.drawCalls}, ${b}=${B.drawCalls})`;
    }
    const ta = A.triangles;
    const tb = B.triangles;
    if (Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) > Math.max(ta, tb) * 0.02) {
        return `triangles differ >2% (${a}=${ta}, ${b}=${tb})`;
    }
    return null;
}

function buildSplit(results) {
    const byId = Object.fromEntries(results.map((r) => [r.id, r.summary?.p50 ?? null]));
    const delta = (from, to) => (
        Number.isFinite(byId[from]) && Number.isFinite(byId[to])
            ? +(byId[from] - byId[to]).toFixed(3)
            : null
    );
    // The two baselines are the ONLY pair that must render identically; every other pair
    // differs by exactly the system under test, so their draw-call delta is the signal.
    const driftMismatch = contentMismatch('baseline', 'baseline-repeat', results);
    return {
        bloomMs: delta('baseline', 'no-bloom'),
        levelNodesMs: delta('baseline', 'no-level-nodes'),
        // The Act II sea plate's TOTAL cost at this station (draws + fill + vertex + its
        // pipeline), not an increment: baseline minus the same frame with no water built.
        waterMs: delta('baseline', 'no-water'),
        // The Act II cloud deck's cost at this station (draws + fill + vertex; the deck's
        // pipeline compiles on BOTH sides because the material is built either way).
        // ⚠️ POLARITY FLIPPED 2026-08-14 with the sheet's retirement. The sheet is opt-IN now,
        // so its lever ADDS it and the cost is configuration minus baseline — the same shape
        // as heroesMs. Leaving `no-clouds` in place would have been a lever with nothing to
        // switch off, which is exactly how a dead `odysseyWorldNoHeroes` produced a confident
        // wrong answer once already.
        cloudsMs: delta('cloud-sheet', 'baseline'),
        // Polarity flip 2026-08-14 with the heroes' retirement: the lever ADDS them now, so
        // the heroes' cost is the `heroes` configuration minus baseline — which is exactly
        // delta('heroes', 'baseline'), since delta(from, to) is byId[from] - byId[to]. ⚠️ The
        // first cut of this flip ALSO negated the result ("delta() is baseline-minus-config" —
        // a misreading of the helper), a double flip that would have published the heroes as a
        // SAVING; three independent review lenses caught it before a report was written.
        // Positive still means cost, like every other figure in this split.
        heroesMs: delta('heroes', 'baseline'),
        // ...and cloudFieldMs flips the OTHER way for the same reason: the field is shipped
        // now, so its lever REMOVES it and the cost is baseline minus configuration.
        cloudFieldMs: delta('baseline', 'no-cloud-field'),
        // THE LAVA LAKE (design §4 gate G1/G2): both figures are costs. lakeMs is the shipped
        // analytic lake (baseline minus no-lake); lakeBakedMs is the baked lake's cost on the
        // same frame (lake-baked minus no-lake). Measured 2026-08-21 at the entry station:
        // Lane B (Vega 8) 4.45 → 1.96 ms of a 7.6 ms frame; Lane A (RTX 3070) 0.79 → 0.20 ms.
        lakeMs: delta('baseline', 'no-lake'),
        lakeBakedMs: delta('lake-baked', 'no-lake'),
        // The five additive glow sprites alone (baseline minus the same frame without them).
        lakeGlowsMs: delta('baseline', 'no-lake-glows'),
        // The lake PLANE alone, by subtraction: the whole group minus the sprite share. Report
        // it only when both levers ran in the same session — across sessions the two baselines
        // are different frames and the subtraction is meaningless.
        lakePlaneMs: (Number.isFinite(byId.baseline)
            && Number.isFinite(byId['no-lake'])
            && Number.isFinite(byId['no-lake-glows']))
            ? +(byId['no-lake-glows'] - byId['no-lake']).toFixed(3)
            : null,
        // NOT `baseline - cloud-field-half`. `cloud-field-half` truncates the spec table to
        // its first 26 masses, so that subtraction would price the UPPER 26 (the satellites,
        // which are far-LOD and tiny) and read as 'half the field is nearly free'. The cost
        // curve wants the cost OF a half field, so it is measured against the field's absence.
        // Requires `no-cloud-field` in the same run; `delta` returns null rather than guessing.
        cloudFieldHalfMs: delta('cloud-field-half', 'no-cloud-field'),
        // The Act II forest's TOTAL cost at this station (draws + fill + vertex + its
        // pipeline). The forest SHIPS, so its lever REMOVES it and the cost is baseline minus
        // configuration — the same polarity as waterMs and cloudFieldMs, and the opposite of
        // the two retired systems above. Argument order carries the sign; never also negate.
        // Since the swap, baseline's forest IS the roster — so this prices the shipped
        // five-species forest. Its Lane B value at p=0.225 is 2.621 ms (D5-accepted).
        forestMs: delta('baseline', 'no-forest'),
        // The retired incumbent's price, for regression comparisons only.
        forestV1Ms: delta('forest-v1', 'no-forest'),
        // The ground's FRAGMENT cost — the stack that had never been priced. The ground ships
        // (it is the world), so its lever REMOVES the disputed work and the cost is baseline
        // minus configuration, the same polarity as waterMs, cloudFieldMs and forestMs.
        groundFragMs: delta('baseline', 'flat-ground'),
        // POSITIVE means One World (the default baseline) is CHEAPER than the dioramas.
        oneWorldSavingMs: delta('legacy-dioramas', 'baseline'),
        baselineDriftMs: driftMismatch ? null : delta('baseline', 'baseline-repeat'),
        baselineDriftVoidReason: driftMismatch,
        note: 'Differential, not per-pass: each figure is baseline p50 minus that '
            + 'configuration p50 — except heroesMs and cloudsMs, whose levers ADD a retired '
            + 'system, so they are the configuration minus baseline. Positive always '
            + 'means cost. Overlapping costs are attributed to whichever system is '
            + 'removed first, and baselineDriftMs bounds how much of any figure could be '
            + 'drift rather than signal. baselineDriftMs is null when the two baselines did '
            + 'not render comparable scenes — see baselineDriftVoidReason.',
    };
}

app.commandLine.appendSwitch(LOW_POWER ? 'force_low_power_gpu' : 'force_high_performance_gpu');
app.disableHardwareAcceleration = false;
// Electron quits the app when the last window closes. This harness deliberately runs one
// window per configuration and destroys each when its samples are in — so without this the
// process exits, silently and with status 0, the moment configuration 1 finishes. It read as
// three different failures (an ERR_FAILED on the next load, then a run that just stopped) and
// it was one cause: the app was already shutting down.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
    const results = [];
    try {
        process.stdout.write(`[gpu-split] lane ${LANE} (${QUALITY}), starting dev server...\n`);
        await startDevServer();
        const selected = ONLY
            ? CONFIGURATIONS.filter((c) => ONLY.includes(c.id))
            : CONFIGURATIONS;
        if (ONLY) {
            process.stdout.write(`[gpu-split] restricted to: ${selected.map((c) => c.id).join(', ')}
`);
        }
        // ── WARM-UP PASS, DISCARDED (added 2026-08-14 after it voided two pairs in one day)
        // ADR-0016 already says "first-configuration-after-boot voided as cold-compile", but
        // the harness knew that and did nothing about it, so the rule had to be applied by
        // hand — by noticing an impossible number. Twice in one day a pair came back with the
        // BASELINE carrying a p99 of 39 ms and 232 ms and the differential landing NEGATIVE
        // (-0.852 and -5.374): adding geometry cannot speed up a frame, so both were discarded
        // and re-run.
        //
        // Each configuration already gets its own BrowserWindow and its own sampler reset, so
        // the contamination is not the sampler — it is everything the FIRST window pays that
        // later ones inherit warm: Vite's first transform of the module graph, the driver's
        // cold pipeline cache, first texture uploads. The reference is always measured first,
        // so the reference is always the one spoiled.
        //
        // Running the first configuration once and throwing the result away moves that cost
        // off every published number. It costs one window (~30 s) and buys a pair that does
        // not have to be re-run. `--warmup 0` opts out.
        if (String(args.warmup ?? '1') !== '0' && selected.length > 0) {
            process.stdout.write(`[gpu-split] warm-up (discarded)...${BREAK}`);
            const warm = await Promise.race([
                runConfiguration(selected[0]),
                wait(320000).then(() => null),
            ]);
            const ws = warm && warm.summary;
            process.stdout.write(ws
                ? `[gpu-split]   warm-up p50 ${fmt(ws.p50)} p99 ${fmt(ws.p99)} - DISCARDED${BREAK}`
                : `[gpu-split]   warm-up produced no samples - DISCARDED${BREAK}`);
        }

        for (const config of selected) {
            process.stdout.write(`[gpu-split] ${config.id}...\n`);
            // A configuration that never becomes ready must not take the whole run with it:
            // one stall previously cost five measured configurations and produced no report at
            // all. Record it as a null row and carry on — an absent number is information.
            const result = await Promise.race([
                runConfiguration(config),
                wait(320000).then(() => ({ ...config, summary: null, timedOut: true })),
            ]);
            const s = result.summary;
            process.stdout.write(
                s
                    ? `[gpu-split]   p50 ${fmt(s.p50)} p95 ${fmt(s.p95)} p99 ${fmt(s.p99)} `
                      + `max ${fmt(s.max)} over ${s.samples} frames, ${s.drawCalls} draws\n`
                    : '[gpu-split]   NO SAMPLES (timestamps unavailable on this surface)\n',
            );
            results.push(result);
        }

        const adapter = await probeAdapter();
        const report = {
            wave: -1,
            generatedAt: new Date().toISOString(),
            lane: LANE,
            configurationsRun: (ONLY ? 'restricted' : 'full'),
            quality: QUALITY,
            adapter,
            // WHICH GPU WAS ASKED FOR, not just which one answered. This machine has both an
            // RTX 5080 and a Radeon 610M, and Lane B's budgets are written against the
            // INTEGRATED part — but the report recorded only `adapter`, so a Lane B run that
            // forgot `--low-power` produced a file that looked admissible in every field a
            // reader checks. It happened on 2026-08-13: the whole frame came back at 0.262 ms
            // and `cloudsMs` at exactly 0, because on a 5080 at 720p every configuration lands
            // inside the timer's 65.536 us quantum. Recording the request alongside the result
            // makes the mismatch checkable instead of inferable.
            warmupRun: String(args.warmup ?? '1') !== '0',
            lowPower: LOW_POWER,
            powerPreference: LOW_POWER ? 'low-power' : 'high-performance',
            laneAdapterMismatch: (LANE === 'B' && !LOW_POWER) ? 'lane B is the INTEGRATED lane; this run did not pass --low-power' : null,
            resolution: `${WIDTH}x${HEIGHT}`,
            seekProgress: SEEK,
            captureChapters: CHAPTERS,
            discipline: 'p50/p99 from a fixed 600-sample ring; no mean is recorded anywhere',
            configurations: results.map((r) => ({ id: r.id, note: r.note, ...r.summary })),
            split: buildSplit(results),
        };
        await mkdir(OUT_DIR, { recursive: true });
        const file = path.join(OUT_DIR, OUT_FILE || `gpu-split-lane${LANE.toLowerCase()}.json`);
        if (report.laneAdapterMismatch) {
            console.warn(`[gpu-split] ⚠️  ${report.laneAdapterMismatch} — adapter reported `
                + `${adapter?.vendor}/${adapter?.architecture}. Treat this report as INADMISSIBLE.`);
        }
        await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        process.stdout.write(`[gpu-split] wrote ${path.relative(ROOT, file)}\n`);
        process.stdout.write(`[gpu-split] split: ${JSON.stringify(report.split)}\n`);
    } catch (error) {
        process.stderr.write(`[gpu-split] FAILED: ${error?.stack || error}\n`);
        process.exitCode = 1;
    } finally {
        killDevServerTree();
        app.quit();
    }
});

async function probeAdapter() {
    const win = new BrowserWindow({ width: 320, height: 240, show: false });
    try {
        // about:blank has no WebGPU in Electron, so the first version of this probe recorded
        // {"error":"no navigator.gpu"} into a report whose entire purpose is to say WHICH GPU
        // produced the numbers. Load a real page from the dev server instead.
        await win.loadURL(`${BASE_URL}/?adapterProbe=1`);
        return await win.webContents.executeJavaScript(`
            (async () => {
                if (!navigator.gpu) return { error: 'no navigator.gpu' };
                const a = await navigator.gpu.requestAdapter(
                    { powerPreference: ${LOW_POWER ? "'low-power'" : "'high-performance'"} },
                );
                if (!a) return { error: 'no adapter' };
                const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
                return {
                    vendor: info.vendor ?? null,
                    architecture: info.architecture ?? null,
                    device: info.device ?? null,
                    description: info.description ?? null,
                };
            })()
        `);
    } catch (error) {
        return { error: String(error?.message || error) };
    } finally {
        win.destroy();
    }
}
