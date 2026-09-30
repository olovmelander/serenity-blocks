/* eslint-disable no-console, import/no-extraneous-dependencies */
/**
 * Boot smoothness probe — measures whether the boot screens keep MOVING.
 *
 * The question it answers: while the studio ident / intro / boot warp are on screen, how long
 * does the page stop presenting frames, and what caused each stop? A stop with no JS long task
 * is GPU-process starvation — a synchronous `device.createRenderPipeline` compiles on the GPU
 * process main thread, which also draws the display compositor, so even compositor-only CSS
 * freezes. Measured on this machine (RTX 3070, D3D12): a heavy shader created through
 * `renderer.render()` froze every frame for 2.9 s; the same shader through `compileAsync`
 * (createRenderPipelineAsync) compiled in 4.5 s with a 61 ms worst frame.
 *
 * Usage (Electron, dev server already running):
 *   node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs \
 *     --port 5173 --theme neon-district --duration 45000 --out reports/boot-smoothness/<tag>.json
 *
 *   --theme <id>       seed settings.backgroundMode=Specific + backgroundTheme=<id> (default: fresh profile default)
 *   --profile-dir <d>  reuse a profile (warm Dawn cache); default is a fresh temp dir = COLD cache
 *   --duration <ms>    capture window from navigation (default 45000)
 *   --url-params <qs>  extra query string, e.g. "noBootWarp=1"
 *   --show 0           hide the window (default shown; occlusion throttling is disabled either way)
 *   --width/--height   window size (default 1280x720)
 *   --scenario=mode-entry --mode=single [--entry-offsets=300,900,...]
 *                      after the boot reaches the menu, start that mode and measure the loading
 *                      overlay (summary.modeEntryWindow); screenshots at those ms after the click
 *   --screenshots=3000,6000              window captures at those ms after navigation
 *   --shots-phase=<trace phase> --shots-offsets=0,300   captures relative to a startup trace phase
 *   --final-eval=<file.js>  evaluate a script in the page at the end (result in the JSON)
 *   --console-grep=<re>  --verbose      console filtering / step logging
 * Pass values inline (--key=value) when they look like URLs or contain ':' (Chromium would treat a
 * loose one as a URL to open and exit 127).
 *
 *   node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs --port 5173 --duration 70000 \
 *     --theme neon-district --url-params=noThemeWarm=1 --scenario=mode-entry --mode=single \
 *     --out reports/boot-smoothness/<tag>.json
 *
 * Output: JSON with every pipeline creation (sync/async, label, first app stack frame), every
 * frame gap >= 50 ms, long animation frames (main-thread attribution), and the startup trace;
 * plus a printed summary. One Electron process per run (ADR-0016).
 */
import electron from 'electron';
import {
    mkdtempSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const { app, BrowserWindow } = electron;

// Chromium parses Electron's argv too and only understands --switch=value: a loose value that
// looks like a URL scheme (e.g. "boot-warp:play-start") can make Electron exit at launch. Pass
// such values as --key=value.
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = '1';
        else { out[key] = next; i += 1; }
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 5173);
const DURATION_MS = Number(args.duration || 45000);
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);
const OUT = resolve(args.out || `reports/boot-smoothness/probe-${process.pid}.json`);
const PROFILE_DIR = args['profile-dir'] ? resolve(args['profile-dir']) : mkdtempSync(join(tmpdir(), 'sb-boot-probe-'));

// Same adapter the shipped app uses (electron/main.js), and never let occlusion throttle rAF to
// ~1 Hz (that produced flat 1000 ms "freezes" that were really a covered window).
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.setPath('userData', PROFILE_DIR);

// Runs in the page before any app script. Kept dependency-free and defensive.
function probeSource(theme) {
    return `(() => {
  if (window.__bootProbe) return;
  ${theme ? `try {
    const key = 'serenityBlocksSettings';
    const s = JSON.parse(localStorage.getItem(key) || '{}') || {};
    s.backgroundMode = 'Specific'; s.backgroundTheme = ${JSON.stringify(theme)};
    localStorage.setItem(key, JSON.stringify(s));
  } catch (e) {}` : ''}
  const P = (window.__bootProbe = { gpu: [], gaps: [], loaf: [], frames: 0 });
  // Deep renderer call chains overflow V8's default 10 captured frames, which hid the app caller.
  try { Error.stackTraceLimit = 60; } catch (e) {}
  const now = () => Math.round(performance.now() * 10) / 10;
  const stackOf = () => { try { return (new Error().stack || '').split('\\n').slice(3, 18).map((s) => s.trim().replace(/\\?[^:)]*/, '').replace(/https?:\\/\\/localhost:\\d+\\//, '')).join(' | '); } catch (e) { return ''; } };
  const wrap = (proto, name, kind) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (desc) {
      const rec = { kind, at: now(), label: desc && desc.label ? String(desc.label).slice(0, 80) : '' };
      if (kind === 'shader-module') rec.codeLen = desc && desc.code ? desc.code.length : 0;
      else rec.stack = stackOf();
      if (kind === 'render-sync' || kind === 'compute-sync') {
        rec.target = desc && desc.fragment && desc.fragment.targets ? desc.fragment.targets.map((t) => t && t.format).join('+') : '';
      }
      const out = orig.apply(this, arguments);
      if (out && typeof out.then === 'function') out.then(() => { rec.doneAt = now(); }, () => { rec.doneAt = now(); rec.failed = true; });
      P.gpu.push(rec);
      return out;
    };
  };
  if (window.GPUDevice) {
    const d = GPUDevice.prototype;
    wrap(d, 'createRenderPipeline', 'render-sync');
    wrap(d, 'createComputePipeline', 'compute-sync');
    wrap(d, 'createRenderPipelineAsync', 'render-async');
    wrap(d, 'createComputePipelineAsync', 'compute-async');
    wrap(d, 'createShaderModule', 'shader-module');
  }
  // Compositor canary: a composited transform animation guarantees damage every frame, so a
  // blocked GPU main thread always shows up as a frame gap (a static page would hide it).
  const addCanary = () => {
    if (!document.documentElement || document.getElementById('__boot-probe-canary')) return;
    const st = document.createElement('style');
    st.textContent = '@keyframes __bpc{to{transform:translateX(3px)}}#__boot-probe-canary{position:fixed;left:0;top:0;width:2px;height:2px;opacity:.02;pointer-events:none;z-index:2147483647;will-change:transform;animation:__bpc .5s linear infinite alternate}';
    document.documentElement.appendChild(st);
    const c = document.createElement('div'); c.id = '__boot-probe-canary';
    document.documentElement.appendChild(c);
  };
  if (document.readyState === 'loading') document.addEventListener('readystatechange', addCanary, { once: true }); else addCanary();
  let last = null;
  const tick = (ts) => { P.frames += 1; if (last !== null && ts - last >= 50) P.gaps.push({ at: Math.round(last), gap: Math.round(ts - last) }); last = ts; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => {
      if (e.duration < 100) return;
      const scripts = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 3)
        .map((s) => ({ ms: Math.round(s.duration), fn: (s.sourceFunctionName || '').slice(0, 60), src: (s.sourceURL || '').split('/').slice(-2).join('/').split('?')[0], char: s.sourceCharPosition }));
      P.loaf.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), blockingMs: Math.round(e.blockingDuration || 0), scripts });
    })).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
})();`;
}

function firstAppFrame(stack = '') {
    return stack.split(' | ')
        .filter((s) => s && !/deps\/|node_modules|<anonymous>/.test(s))
        .slice(0, 2)
        .map((s) => s.replace(/^at /, ''))
        .join(' <- ') || '(three.js internal: render loop)';
}

/**
 * Summarise a capture. Freezes are frame gaps >= 150 ms; "ident window" is navigation → the
 * shell being dismissed (warp visible-start / css fallback / menu), i.e. what the player watches.
 */
export function summarize(data) {
    const trace = data.trace || [];
    const at = (phase) => trace.find((e) => e.phase === phase)?.t ?? null;
    const shellGone = at('boot-warp:visible-start') ?? at('startup-shell:dismiss-request') ?? at('startup-pipeline:menu-visible');
    const warpEnd = at('boot-warp:handoff-complete');
    const freezes = (data.gaps || []).filter((g) => g.gap >= 150);
    const inWindow = (from, to) => freezes.filter((g) => g.at + g.gap > from && (to === null || g.at < to));
    const sumMs = (list) => list.reduce((a, g) => a + g.gap, 0);
    const sync = (data.gpu || []).filter((g) => g.kind === 'render-sync' || g.kind === 'compute-sync');
    const asyncs = (data.gpu || []).filter((g) => g.kind === 'render-async' || g.kind === 'compute-async');
    const byCaller = new Map();
    sync.forEach((g) => {
        const k = firstAppFrame(g.stack);
        const cur = byCaller.get(k) || { n: 0, first: g.at, last: g.at };
        cur.n += 1; cur.last = g.at; byCaller.set(k, cur);
    });
    const identFreezes = inWindow(0, shellGone);
    const warpFreezes = shellGone === null ? [] : inWindow(shellGone, warpEnd);
    // A gap mostly covered by long-animation-frame BLOCKING time is the renderer main thread:
    // it stalls rAF/JS, but compositor CSS animations (the ident) keep presenting — measured:
    // 6 distinct frames captured during a 2.5 s main-thread block. The rest is GPU-process
    // starvation (synchronous pipeline compiles), which freezes everything on screen.
    const loafs = data.loaf || [];
    const mainOverlap = (g) => loafs.reduce((ms, l) => {
        const overlap = Math.max(0, Math.min(g.at + g.gap, l.at + l.ms) - Math.max(g.at, l.at));
        return ms + overlap * (l.blockingMs / Math.max(1, l.ms));
    }, 0);
    const isGpu = (g) => mainOverlap(g) < 0.5 * g.gap;
    const split = (list) => ({
        visibleFrozenMs: sumMs(list.filter(isGpu)),
        visibleMaxMs: Math.max(0, ...list.filter(isGpu).map((g) => g.gap)),
        mainThreadOnlyMs: sumMs(list.filter((g) => !isGpu(g))),
    });
    return {
        shellDismissedAtMs: shellGone,
        warpHandoffCompleteAtMs: warpEnd,
        pipelines: { sync: sync.length, async: asyncs.length, syncBeforeShellGone: sync.filter((g) => shellGone === null || g.at < shellGone).length },
        identWindow: {
            freezes: identFreezes.length,
            frozenMs: sumMs(identFreezes),
            maxMs: Math.max(0, ...identFreezes.map((g) => g.gap)),
            ...split(identFreezes),
        },
        warpWindow: {
            freezes: warpFreezes.length,
            frozenMs: sumMs(warpFreezes),
            maxMs: Math.max(0, ...warpFreezes.map((g) => g.gap)),
            ...split(warpFreezes),
        },
        wholeCapture: { freezes: freezes.length, frozenMs: sumMs(freezes), maxMs: Math.max(0, ...freezes.map((g) => g.gap)) },
        modeEntryWindow: data.modeEntryAt == null ? null : (() => {
            const from = data.modeEntryAt;
            const to = from + 10000;
            const list = inWindow(from, to);
            const inW = (g) => g.at >= from && g.at <= to;
            return {
                fromMs: from,
                freezes: list.length,
                frozenMs: sumMs(list),
                maxMs: Math.max(0, ...list.map((g) => g.gap)),
                ...split(list),
                pipelines: {
                    sync: sync.filter(inW).length,
                    async: asyncs.filter(inW).length,
                },
            };
        })(),
        mainThreadLongFrames: (data.loaf || []).filter((l) => l.blockingMs >= 250).map((l) => ({
            at: l.at, ms: l.ms, blockingMs: l.blockingMs, top: l.scripts[0] ? `${l.scripts[0].fn || '?'}@${l.scripts[0].src}` : '',
        })),
        syncByCaller: [...byCaller.entries()].sort((a, b) => a[1].first - b[1].first)
            .map(([caller, v]) => ({
                caller, n: v.n, fromMs: Math.round(v.first), toMs: Math.round(v.last),
            })),
    };
}

const step = (msg) => { if (args.verbose) console.log(`[boot-smoothness-probe] ${msg}`); };

async function run() {
    step(`profile ${PROFILE_DIR}`);
    await app.whenReady();
    step('app ready');
    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        useContentSize: true,
        show: args.show !== '0',
        backgroundColor: '#000000',
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    step('window created');
    const consoleLines = [];
    const consolePattern = new RegExp(args['console-grep'] || 'ThemeManager|async-render|\\[Main\\]|IntroWebGPU|BootWarp|Theme|error', 'i');
    win.webContents.on('console-message', (event, level, message) => {
        const text = String(message ?? event?.message ?? '');
        if (consoleLines.length < 400 && consolePattern.test(text)) {
            consoleLines.push({ t: Date.now(), level, text: text.slice(0, 300) });
        }
    });
    // CDP page commands wait for a renderer, which only exists after a first navigation.
    await win.loadURL('about:blank');
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: probeSource(args.theme || null) });
    step('probe registered');

    const extra = args['url-params'] ? `&${args['url-params'].replace(/^[?&]/, '')}` : '';
    const url = `http://localhost:${PORT}/?startupDebug=1${extra}`;
    const startedAt = Date.now();
    // Do not await did-finish-load: a long boot can hold the load event; the capture window is
    // wall-clock from navigation either way.
    win.loadURL(url).catch((error) => console.error('[boot-smoothness-probe] loadURL:', error?.message || error));
    step(`navigating ${url}`);
    // --screenshots 3000,6000 : capture the window at those ms after navigation (visual check of
    // what the player sees; a capture during a GPU freeze waits for the next presented frame).
    const shots = String(args.screenshots || '').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
    for (const shotAt of shots) {
        const wait = shotAt - (Date.now() - startedAt);
        // eslint-disable-next-line no-await-in-loop -- timed captures are sequential
        if (wait > 0) await new Promise((r) => { setTimeout(r, wait); });
        try {
            // eslint-disable-next-line no-await-in-loop -- timed captures are sequential
            const image = await win.webContents.capturePage();
            const file = `${OUT.replace(/\.json$/, '')}-t${shotAt}.png`;
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, image.toPNG());
            step(`screenshot ${file} (asked ${shotAt} ms, taken ${Date.now() - startedAt} ms)`);
        } catch (error) {
            console.error('[boot-smoothness-probe] screenshot failed:', error?.message || error);
        }
    }
    // --shots-phase=boot-warp:play-start --shots-offsets 0,300,1200 : capture relative to the
    // first startup-trace entry with that phase (boot timings vary run to run).
    if (args['shots-phase']) {
        const phase = String(args['shots-phase']);
        const offsets = String(args['shots-offsets'] || '0').split(',').map(Number).filter(Number.isFinite)
            .sort((a, b) => a - b);
        let phaseAt = null;
        while (phaseAt === null && Date.now() - startedAt < DURATION_MS) {
            // An executeJavaScript issued while the navigation is still committing can never
            // settle; race every poll against a timeout so the loop cannot hang.
            // eslint-disable-next-line no-await-in-loop
            phaseAt = await Promise.race([
                win.webContents.executeJavaScript(`(() => {
                  const e = (window.__serenityStartupTrace || []).find((x) => x.phase === ${JSON.stringify(phase)});
                  return e ? performance.now() - e.t : null;
                })()`, true).catch(() => null),
                new Promise((r) => { setTimeout(() => r(null), 400); }),
            ]);
            // eslint-disable-next-line no-await-in-loop
            if (phaseAt === null) await new Promise((r) => { setTimeout(r, 50); });
        }
        if (phaseAt !== null) {
            const phaseSeenAt = Date.now() - phaseAt; // wall ms when the phase happened
            for (const offset of offsets) {
                const wait = phaseSeenAt + offset - Date.now();
                // eslint-disable-next-line no-await-in-loop
                if (wait > 0) await new Promise((r) => { setTimeout(r, wait); });
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const image = await win.webContents.capturePage();
                    const file = `${OUT.replace(/\.json$/, '')}-${phase.replace(/[^a-z0-9]+/gi, '_')}+${offset}.png`;
                    mkdirSync(dirname(file), { recursive: true });
                    writeFileSync(file, image.toPNG());
                    step(`screenshot ${file} (late by ${Math.round(Date.now() - phaseSeenAt - offset)} ms)`);
                } catch (error) {
                    console.error('[boot-smoothness-probe] phase screenshot failed:', error?.message || error);
                }
            }
        } else {
            console.error(`[boot-smoothness-probe] phase ${phase} never appeared`);
        }
    }
    // --scenario=mode-entry --mode=single [--entry-offsets=300,900,...] : after the boot reaches
    // the menu, press Enter through the intro, dwell, then start a mode the way the menu card does
    // and measure the loading overlay. Combine with --url-params=noThemeWarm=1 for a COLD entry.
    let modeEntryAt = null;
    if (args.scenario === 'mode-entry') {
        const evalT = (src) => Promise.race([
            win.webContents.executeJavaScript(src, true).catch(() => null),
            new Promise((r) => { setTimeout(() => r(null), 400); }),
        ]);
        const waitPhase = async (phase) => {
            while (Date.now() - startedAt < DURATION_MS) {
                // eslint-disable-next-line no-await-in-loop
                const hit = await evalT(`(window.__serenityStartupTrace || []).some((e) => e.phase === ${JSON.stringify(phase)})`);
                if (hit) return true;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => { setTimeout(r, 100); });
            }
            return false;
        };
        const introReady = await waitPhase('boot-warp:handoff-complete') || await waitPhase('intro:title-reveal-request');
        await new Promise((r) => { setTimeout(r, 1800); });
        if (introReady) {
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        }
        await waitPhase('startup-pipeline:menu-visible');
        await new Promise((r) => { setTimeout(r, 1500); });
        const mode = String(args.mode || 'single');
        modeEntryAt = await evalT(`(() => {
          window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: ${JSON.stringify(mode)} } }));
          return Math.round(performance.now());
        })()`);
        step(`mode entry "${mode}" dispatched at page t=${modeEntryAt}`);
        const entryWall = Date.now();
        const offsets = String(args['entry-offsets'] || '300,900,1600,2500,3500,5000').split(',').map(Number).filter(Number.isFinite);
        for (const offset of offsets) {
            const wait = entryWall + offset - Date.now();
            // eslint-disable-next-line no-await-in-loop
            if (wait > 0) await new Promise((r) => { setTimeout(r, wait); });
            try {
                // eslint-disable-next-line no-await-in-loop
                const image = await win.webContents.capturePage();
                const file = `${OUT.replace(/\.json$/, '')}-entry+${offset}.png`;
                mkdirSync(dirname(file), { recursive: true });
                writeFileSync(file, image.toPNG());
                step(`entry screenshot +${offset} (late by ${Math.round(Date.now() - entryWall - offset)} ms)`);
            } catch (error) {
                console.error('[boot-smoothness-probe] entry screenshot failed:', error?.message || error);
            }
        }
    }
    const remaining = DURATION_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((r) => { setTimeout(r, remaining); });

    const data = await win.webContents.executeJavaScript(`(() => {
      const P = window.__bootProbe || {};
      const trace = (window.__serenityStartupTrace || []).map((e) => {
        let payload = '';
        try { payload = JSON.stringify(e.payload).slice(0, 200); } catch (x) {}
        return { t: e.t, phase: e.phase, payload };
      });
      return { nowMs: Math.round(performance.now()), frames: P.frames || 0, gpu: P.gpu || [], gaps: P.gaps || [], loaf: P.loaf || [], trace,
               adapter: (window.__serenityGpuAdapterInfo || null), themeWarm: (window.__THEME_WARM_ASYNC__ || null) };
    })()`, true);
    // --final-eval=<file.js> : an async function expression evaluated in the page at the end
    // (debugging aid; its JSON result lands in data.finalEval).
    if (args['final-eval']) {
        const src = readFileSync(resolve(args['final-eval']), 'utf8');
        data.finalEval = await Promise.race([
            win.webContents.executeJavaScript(`(${src})()`, true).catch((e) => ({ error: String(e?.message || e) })),
            new Promise((r) => { setTimeout(() => r({ error: 'final-eval timeout' }), 5000); }),
        ]);
    }
    data.console = consoleLines.map((l) => ({ ...l, t: l.t - startedAt }));
    data.modeEntryAt = modeEntryAt;
    const summary = summarize(data);
    const manifest = {
        tool: 'boot-smoothness-probe',
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        url,
        theme: args.theme || null,
        durationMs: DURATION_MS,
        viewport: [WIDTH, HEIGHT],
        profileDir: PROFILE_DIR,
        coldProfile: !args['profile-dir'],
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ manifest, summary, data }, null, 1));
    console.log(JSON.stringify({ out: OUT, manifest, summary }, null, 1));
    try { dbg.detach(); } catch { /* noop */ }
    win.destroy();
    app.quit();
}

run().catch((error) => {
    console.error('[boot-smoothness-probe] failed:', error);
    app.exit(1);
});
