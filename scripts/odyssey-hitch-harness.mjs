/* eslint-disable import/no-extraneous-dependencies, no-console, no-await-in-loop */
/**
 * ODYSSEY HITCH HARNESS — repeated-measures A/B for load/stutter work.
 *
 * WHY THIS EXISTS (2026-08-17). The loading/freeze investigation
 * (docs/ODYSSEY_LOADING_AND_FREEZE_PLAN_2026-08.md) hit a hard measurement ceiling: single runs of
 * the ad-hoc scroll probe varied between 2 212 ms and 9 473 ms of forward stall on the SAME machine
 * and build. Effect sizes under ~1 s are simply not resolvable that way, and tuning against them
 * produces confident, wrong conclusions. This harness exists so the next change is judged properly.
 *
 * What it does differently from the ad-hoc probe:
 *
 *  1. REAL INPUT. It dispatches synthetic `wheel` events at the canvas, so the whole input path
 *     runs: shouldRouteOdysseyWheel -> normalizeOdysseyWheelDelta -> _markInteraction() ->
 *     cameraController.scroll(). The old probe assigned `cameraController.targetPosition`
 *     directly, which BYPASSES `travelModel.inputVelocity` — and since the background gate now
 *     reads that (see _isScrollIdle), a direct-assignment probe reports "player idle" all through
 *     a scroll and silently measures the wrong scheduling behaviour.
 *  2. INTERLEAVED variants (A,B,A,B,...) rather than blocked (A,A,B,B). The machine warms up and
 *     throttles over a session; blocked runs confound that drift with the change under test.
 *  3. A DISCARDED WARM-UP run per variant, because the first run after a build has a stale WebGPU
 *     pipeline cache and behaves like a cold one (board init 5 241 ms vs 3 911 ms warm).
 *  4. MEDIAN + IQR, never the mean: these distributions have hard outliers (one 4 680 ms frame).
 *
 * Usage:
 *   node scripts/run-electron.mjs scripts/odyssey-hitch-harness.mjs --runs 5
 *   ... --variant "base=" --variant "noBgWarm=odysseyBgWarm=0"
 *   ... --port 4173 --end 0.8 --scroll-ms 30000 --settle-ms 12000 --out artifacts/hitch.json
 *
 * Measure a PRODUCTION build (npm run build && vite preview --port 4173); the dev server's
 * numbers are Vite recompiles, not load.
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
    aggregate, iqrOverlaps, summarizePhase,
} from './lib/hitch-stats.mjs';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * A wedged GPU process makes rAF stop firing, so any page-side promise this harness awaits
 * (the scroll drivers in particular) never resolves and the whole session hangs silently.
 * Observed live: a run stalled indefinitely after Chromium logged
 * "GPU state invalid after WaitForGetOffsetInRange". Every run is therefore time-boxed; a
 * timed-out run is recorded as failed and the session continues.
 */
const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_r, reject) => { setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms); }),
]);

let activeWindow = null;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
    console.log(`odyssey-hitch-harness — repeated-measures A/B for Odyssey load/stutter.

  --runs N          measured runs per variant (default 5)
  --variant name=flags   repeatable; url flags for that variant (default: one "base=" variant)
  --port N          preview port (default 4173)
  --end P           forward scroll end progress (default 0.8)
  --scroll-ms MS    duration of each scroll pass (default 30000)
  --settle-ms MS    idle dwell after reveal, before scrolling (default 12000)
  --no-warmup       do not discard a first warm-up run per variant
  --run-timeout-ms MS  abort a wedged run instead of hanging (default 240000)
  --out PATH        json output (default artifacts/odyssey-hitch/<stamp>.json)
`);
    process.exit(0);
}

// Electron is imported lazily (after --help) so the usage text works without the binary,
// matching scripts/odyssey-perf-session.mjs.
const electronModule = await import('electron');
const electron = electronModule.default ?? electronModule;
const { app, BrowserWindow } = electron;

// Match the shipped app's GPU selection (electron/main.js) so we profile the adapter players get.
// These must be appended before app-ready.
//
// GPU-crash resilience (2026-08-17): this dev machine's iGPU has TDR form under sustained
// full-journey WebGPU (see memory: odyssey-capture-constraint), and a single GPU-process crash
// then made every SUBSEQUENT load fail — Chromium domain-blocks 3D APIs after a crash, which is
// what the unexplained ERR_FAILED on run 2 was. Disable the blocklist reaction and the crash
// limit so one bad run cannot poison the rest of a session, and LOG process deaths so a crashed
// run is attributable instead of silent. For this machine, prefer one process per run anyway:
// scripts/odyssey-hitch-baseline.mjs orchestrates exactly that.
app.disableDomainBlockingFor3DAPIs();
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-webgl');
// Without these, an occluded/backgrounded window throttles rAF to ~1Hz and every frame reads 1001ms.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const PORT = Number(args.port || 4173);
const RUNS = Number(args.runs || 5);
const END_P = Number(args.end || 0.8);
const SCROLL_MS = Number(args['scroll-ms'] || 30000);
const SETTLE_MS = Number(args['settle-ms'] || 12000);
const WARMUP = args['no-warmup'] ? 0 : 1;
const RUN_TIMEOUT_MS = Number(args['run-timeout-ms'] || 240000);
const VARIANTS = (args.variant ? [].concat(args.variant) : ['base=']).map((spec) => {
    const i = String(spec).indexOf('=');
    return i === -1
        ? { name: String(spec), flags: '' }
        : { name: String(spec).slice(0, i), flags: String(spec).slice(i + 1) };
});
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = args.out || path.join('artifacts', 'odyssey-hitch', `${STAMP}.json`);

// Injected before any page script so the very first frame is recorded.
const INIT_SCRIPT = `
(() => {
  const S = { t0: performance.now(), gaps: [], longtasks: [], phase: 'boot', marks: [] };
  window.__HITCH__ = S;
  let last = performance.now();
  const tick = (now) => {
    const d = now - last; last = now;
    if (d > 50) {
      const bc = window.odysseyMode && window.odysseyMode.boardController;
      S.gaps.push({
        at: +(now - S.t0).toFixed(0), ms: +d.toFixed(1), phase: S.phase,
        p: bc && bc.cameraController ? +(bc.cameraController.currentPosition || 0).toFixed(4) : null,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        S.longtasks.push({ at: +(e.startTime - S.t0).toFixed(0), ms: +e.duration.toFixed(1), phase: S.phase });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported — gaps still classify by absence */ }
  S.mark = (n) => S.marks.push({ name: n, at: +(performance.now() - S.t0).toFixed(0) });
})();
`;

/**
 * Drive the board with REAL wheel events along a position ramp.
 * A proportional controller issues at most one event per frame, sized by the error between the
 * ramp and the camera's actual position, so it emulates a user scrolling steadily rather than
 * teleporting the target. deltaY is clamped to the same 240px the app clamps to.
 */
function scrollDriver(label, from, to, ms) {
    return `
    (async () => {
      const S = window.__HITCH__; S.phase = ${JSON.stringify(label)};
      const bc = window.odysseyMode.boardController;
      const cc = bc.cameraController;
      const el = bc.renderer?.domElement || bc.container;
      const rect = (bc.container || el).getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const wheel = (deltaY) => el.dispatchEvent(new WheelEvent('wheel', {
        deltaY, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
      const t0 = performance.now();
      return new Promise((resolve) => {
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / ${ms});
          const want = ${from} + (${to} - ${from}) * k;
          const err = want - (cc.targetPosition ?? cc.currentPosition ?? 0);
          // err (progress) -> deltaY (px): scroll() applies deltaY*0.001*scrollSpeed.
          const px = err / (0.001 * (cc.config?.scrollSpeed || 0.09));
          const clamped = Math.max(-240, Math.min(240, px));
          if (Math.abs(clamped) > 0.5) wheel(clamped);
          if (k >= 1) { resolve(true); return; }
          requestAnimationFrame(step);
        };
        step();
      });
    })();`;
}

async function runOnce(variant, tag) {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: true,
        // No sandbox — matches the battle-tested odyssey-perf-session.mjs window config.
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    activeWindow = win;
    win.webContents.on('render-process-gone', (_e, details) => {
        console.log(`!! render-process-gone: ${details?.reason || 'unknown'}`);
    });
    const consoleLines = [];
    win.webContents.on('console-message', (_e, _l, message) => consoleLines.push(message));
    win.webContents.on('did-start-loading', () => {
        win.webContents.executeJavaScript(INIT_SCRIPT, true).catch(() => {});
    });

    const params = new URLSearchParams({ skipIntro: '1', odysseyDebug: '1' });
    String(variant.flags || '').split(',').filter(Boolean).forEach((pair) => {
        const [k, v = '1'] = pair.split('=');
        if (k) params.set(k, v);
    });
    // A window destroyed on the previous run can leave the GPU process briefly unable to serve a
    // new load (ERR_FAILED). Retry once after a pause rather than aborting the whole session.
    const url = `http://127.0.0.1:${PORT}/?${params.toString()}`;
    try {
        await win.loadURL(url);
    } catch (err) {
        console.log(`  load failed (${err?.code || err?.message}) — retrying once`);
        await sleep(3000);
        await win.loadURL(url);
    }
    await win.webContents.executeJavaScript(INIT_SCRIPT, true).catch(() => {});
    console.log('  phase: page loaded');

    await win.webContents.executeJavaScript(`
      (async () => {
        const S = window.__HITCH__;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 200; i += 1) { if (window.serenityBlocks?.gameModeManager) break; await sleep(100); }
        const gm = window.serenityBlocks.gameModeManager;
        if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
        for (let i = 0; i < 600; i += 1) {
          if (window.odysseyMode?.boardController?.isActive) break; await sleep(50);
        }
        S.mark('board-active');
        return true;
      })();`, true).catch(() => {});

    console.log('  phase: board active, settling');
    await sleep(SETTLE_MS);
    console.log('  phase: forward pass');
    await win.webContents.executeJavaScript(scrollDriver('forward', 0, END_P, SCROLL_MS), true)
        .catch((e) => console.log(`  forward driver threw: ${e?.message}`));
    await sleep(3000);
    console.log('  phase: backward pass');
    await win.webContents.executeJavaScript(scrollDriver('backward', END_P, 0, SCROLL_MS), true)
        .catch((e) => console.log(`  backward driver threw: ${e?.message}`));
    await sleep(2000);
    // SECOND forward pass — the discriminator for path-locked costs (2026-08-17): a cost that
    // recurs here fires on EVERY forward crossing (warming can never fix it; the crossing itself
    // must get cheap). A cost absent here is once-per-session (and, if a pre-reveal warm crossing
    // failed to pay it, something RE-ARMED it in between).
    console.log('  phase: forward2 pass');
    await win.webContents.executeJavaScript(scrollDriver('forward2', 0, END_P, SCROLL_MS), true)
        .catch((e) => console.log(`  forward2 driver threw: ${e?.message}`));
    await sleep(2000);
    console.log('  phase: collecting');

    const raw = await win.webContents.executeJavaScript(`
      (() => {
        const S = window.__HITCH__ || {};
        const bc = window.odysseyMode?.boardController;
        const envs = bc?.environmentManager?.environments;
        const warmed = {};
        if (envs) for (const [id, env] of envs) warmed[id] = !!env._renderWarmed;
        const w = bc?._warmupStats;
        return {
          warmup: w ? {
            mode: w.mode, sampleCount: w.sampleCount, totalMs: Math.round(w.totalMs),
            variantsMs: Math.round(w.variantsMs || 0),
            driveMs: Math.round(w.driveMs || 0),
            driveGaps: w.driveGaps || [],
            slowestSamples: (w.samples || []).slice().sort((a, b) => b.totalMs - a.totalMs)
              .slice(0, 5).map((x) => ({ p: x.progress, ms: x.totalMs })),
          } : null,
          gaps: S.gaps || [], longtasks: S.longtasks || [], marks: S.marks || [],
          renderWarmed: warmed,
          bgRenderWarmComplete: !!bc?._bgRenderWarmComplete,
          finalPosition: bc?.cameraController?.currentPosition ?? null,
        };
      })();`, true).catch((e) => ({ error: e?.message }));

    win.destroy();
    activeWindow = null;
    // Let the renderer/GPU process finish tearing down before the next window loads.
    await sleep(2000);
    return summarize(raw, consoleLines, variant, tag);
}

function summarize(raw, consoleLines, variant, tag) {
    const phase = (name) => summarizePhase(raw.gaps, name);
    const line = (re) => (consoleLines.find((l) => re.test(l)) || '');
    const num = (re) => {
        const m = line(re).match(re);
        return m && m[1] ? Number(m[1]) : null;
    };
    const warmCompleteAt = (raw.marks || []).length ? null : null; // console-derived below
    const warmDone = consoleLines.some((l) => /background render-warm complete/.test(l));
    const warmed = raw.renderWarmed || {};
    return {
        variant: variant.name,
        tag,
        boardInitMs: num(/OdysseyStartup\] total (\d+)ms/),
        boardVisibleMs: num(/board visible (\d+)ms after overlay show/),
        forward: phase('forward'),
        forward2: phase('forward2'),
        backward: phase('backward'),
        renderWarmedAll: Object.keys(warmed).length > 0 && Object.values(warmed).every(Boolean),
        renderWarmed: warmed,
        bgRenderWarmComplete: !!raw.bgRenderWarmComplete,
        bgRenderWarmLogged: warmDone,
        warmCompleteAt,
        finalPosition: raw.finalPosition,
        validationErrors: consoleLines.filter(
            (l) => /setPipeline|not of type 'GPURenderPipeline'|includes writable usage/.test(l),
        ).length,
        // Diagnostics the summary numbers cannot answer (masterplan section 5.5): WHERE each
        // real gap sits on the path, WHAT the validation errors said, what the warm scrub paid.
        topGaps: (raw.gaps || [])
            .filter((g) => g.ms > 100 && g.phase !== 'boot')
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 12)
            .map((g) => ({
                phase: g.phase, p: g.p, ms: g.ms, at: g.at,
            })),
        // JS-vs-GPU classification per gap: the longtask overlap tells whether a gap is
        // main-thread work (GC / live-only update) or GPU starvation (no matching longtask).
        topLongtasks: (raw.longtasks || [])
            .filter((l) => l.ms > 80 && l.phase !== 'boot')
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 12)
            .map((l) => ({
                phase: l.phase, ms: l.ms, at: l.at,
            })),
        errorLines: consoleLines
            .filter((l) => /setPipeline|not of type 'GPURenderPipeline'|includes writable usage/.test(l))
            .slice(0, 6),
        warmup: raw.warmup || null,
        error: raw.error || null,
    };
}

function fmt(a) {
    return a ? `${String(a.median).padStart(5)}  [${a.p25}–${a.p75}]  (min ${a.min}, max ${a.max})` : '     —';
}

async function guardedRun(variant, tag) {
    try {
        return await withTimeout(runOnce(variant, tag), RUN_TIMEOUT_MS, `${variant.name}/${tag}`);
    } catch (err) {
        console.log(`  RUN FAILED (${err?.message}) — recorded as failed, continuing`);
        try { activeWindow?.destroy(); } catch { /* already gone */ }
        activeWindow = null;
        await sleep(3000);
        const empty = {
            gaps50: 0, gaps100: 0, worstMs: 0, totalStallMs: 0,
        };
        return {
            variant: variant.name,
            tag,
            failed: true,
            error: err?.message ?? String(err),
            forward: empty,
            backward: empty,
            renderWarmed: {},
            renderWarmedAll: false,
            bgRenderWarmComplete: false,
            validationErrors: 0,
        };
    }
}

async function main() {
    await app.whenReady();
    // THE bug that masqueraded as a GPU wedge (2026-08-17): Electron's DEFAULT
    // window-all-closed handler quits the app. Every runOnce() ends with win.destroy(), so the
    // moment a run finished, the app began shutting down — the next run's loadURL then raced the
    // teardown (the mystery ERR_FAILED), or the process simply exited before the summary. The
    // "GPU state invalid" stderr lines were incidental (they appear in successful runs too).
    // Keep the app alive between runs; main() quits explicitly when done.
    app.on('window-all-closed', () => { /* keep alive between runs */ });
    app.on('child-process-gone', (_e, details) => {
        console.log(`!! child-process-gone: type=${details?.type} reason=${details?.reason}`);
    });
    const results = [];

    // Discarded warm-up per variant: the first run after a build has a stale pipeline cache.
    for (let w = 0; w < WARMUP; w += 1) {
        for (const v of VARIANTS) {
            console.log(`[warmup ] ${v.name}`);
            results.push(await guardedRun(v, 'warmup'));
        }
    }
    // Interleaved measured runs so machine drift hits every variant equally.
    for (let i = 0; i < RUNS; i += 1) {
        for (const v of VARIANTS) {
            console.log(`[run ${i + 1}/${RUNS}] ${v.name}`);
            results.push(await guardedRun(v, 'measured'));
        }
    }

    const measured = results.filter((r) => r.tag === 'measured' && !r.failed);
    const failedCount = results.filter((r) => r.tag === 'measured' && r.failed).length;
    const report = {
        stamp: STAMP,
        port: PORT,
        runs: RUNS,
        variants: VARIANTS,
        endP: END_P,
        machine: machine(),
        results,
        summary: {},
    };

    if (failedCount) {
        console.log(`\n!! ${failedCount} measured run(s) FAILED — excluded from the medians below.`);
    }
    console.log('\n===== MEDIAN [IQR] over', RUNS, 'runs/variant =====');
    for (const v of VARIANTS) {
        const rs = measured.filter((r) => r.variant === v.name);
        const s = {
            boardInitMs: aggregate(rs, (r) => r.boardInitMs),
            boardVisibleMs: aggregate(rs, (r) => r.boardVisibleMs),
            fwdTotalStallMs: aggregate(rs, (r) => r.forward.totalStallMs),
            fwdGaps100: aggregate(rs, (r) => r.forward.gaps100),
            fwdWorstMs: aggregate(rs, (r) => r.forward.worstMs),
            fwd2TotalStallMs: aggregate(rs, (r) => r.forward2?.totalStallMs),
            bwdTotalStallMs: aggregate(rs, (r) => r.backward.totalStallMs),
            warmedAll: rs.filter((r) => r.renderWarmedAll).length,
            sweepComplete: rs.filter((r) => r.bgRenderWarmComplete).length,
            validationErrors: rs.reduce((a, r) => a + r.validationErrors, 0),
        };
        report.summary[v.name] = s;
        console.log(`\n--- ${v.name} (flags: ${v.flags || 'none'})`);
        console.log(`  board init ms      ${fmt(s.boardInitMs)}`);
        console.log(`  board visible ms   ${fmt(s.boardVisibleMs)}`);
        console.log(`  fwd stall total ms ${fmt(s.fwdTotalStallMs)}`);
        console.log(`  fwd gaps >100ms    ${fmt(s.fwdGaps100)}`);
        console.log(`  fwd worst gap ms   ${fmt(s.fwdWorstMs)}`);
        console.log(`  fwd2 stall total   ${fmt(s.fwd2TotalStallMs)}`);
        console.log(`  bwd stall total ms ${fmt(s.bwdTotalStallMs)}`);
        console.log(`  warmed-all runs    ${s.warmedAll}/${rs.length}`);
        console.log(`  sweep complete     ${s.sweepComplete}/${rs.length}`);
        console.log(`  validation errors  ${s.validationErrors}`);
    }
    // Say out loud whether the sample actually resolves the comparison, so nobody eyeballs two
    // medians and declares a win. Overlapping IQRs => add runs.
    if (VARIANTS.length > 1) {
        const base = VARIANTS[0];
        const metrics = ['fwdTotalStallMs', 'fwdGaps100', 'fwdWorstMs', 'boardVisibleMs'];
        console.log(`\n===== RESOLVED vs "${base.name}"? (IQR overlap test) =====`);
        for (const v of VARIANTS.slice(1)) {
            for (const m of metrics) {
                const a = report.summary[base.name]?.[m];
                const b = report.summary[v.name]?.[m];
                const overlap = iqrOverlaps(a, b);
                const verdict = overlap ? 'NOT RESOLVED (add runs)' : 'resolved';
                let dir = '';
                if (!overlap && a && b) dir = b.median < a.median ? ' — better' : ' — WORSE';
                console.log(`  ${v.name} ${m.padEnd(18)} ${verdict}${dir}`);
            }
        }
    }

    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nwrote', OUT);
    app.quit();
}

function machine() {
    let commit = null;
    try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
    return {
        commit,
        platform: `${os.platform()} ${os.release()}`,
        cpu: os.cpus()?.[0]?.model ?? null,
        cores: os.cpus()?.length ?? null,
        ramGB: Math.round(os.totalmem() / 1024 ** 3),
    };
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
        if (out[key] === undefined) out[key] = next;
        else out[key] = [].concat(out[key], next);
        i += 1;
    }
    return out;
}

main().catch((e) => { console.error('HARNESS FAILED', e); app.quit(); });
