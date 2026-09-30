/* eslint-disable no-console, import/no-extraneous-dependencies */
/**
 * Playground PHASE capture — phase-locked screenshots of one playground effect in an isolated Electron
 * (own profile, the shipped app's GPU switches), so captures never share a browser with other
 * sessions' tabs and never depend on a window being in the foreground.
 *
 *   node scripts/run-electron.mjs scripts/playground-phase-capture.mjs \
 *     --effect logo-warp-transition --params "count=48000" --times 0,0.39,0.85 \
 *     --out reports/playground/warp
 *
 *   --params "a=1&b=2"  extra playground URL params (effect, orbit=0 and hud=0 are set for you)
 *   --ident-split 1     overlay the real CSS studio ident (index.html markup + main.css) clipped to
 *                       the left half, so a match-cut can be judged side by side; also returns the
 *                       mark's measured centre in the log.
 *   --ident-compare 1   also write <out>-gpu.png / <out>-css.png: the first time full-frame, GPU only
 *                       and with the real ident on top (the logo-warp-transition match-cut check).
 *   --port (5173)  --width/--height (1280x720)  --show 0 (hidden window)
 * Values may be given inline (--key=value); use that form for anything URL-like.
 *
 * Writes <out>-t<time>.png per time and <out>.json with the log, including every renderer console
 * line (`console`) and the warnings/errors among them (`errors`: WebGPU validation errors land
 * there). Waits for window.__PLAYGROUND_READY__ and a few frames after every setTime().
 */
import electron from 'electron';
import {
    mkdtempSync, mkdirSync, writeFileSync, readFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const { app, BrowserWindow } = electron;

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq > 2) {
            out[a.slice(2, eq)] = a.slice(eq + 1);
            continue;
        }
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = '1';
        else {
            out[key] = next;
            i += 1;
        }
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 5173);
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);
const OUT = resolve(args.out || 'reports/playground/capture');
const TIMES = String(args.times || '0').split(',').map(Number).filter(Number.isFinite);

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'sb-pg-capture-')));

function identMarkup() {
    // Pull the live ident markup out of index.html so the overlay can never drift from it.
    const html = readFileSync(resolve('index.html'), 'utf8');
    const start = html.indexOf('<div id="startup-shell"');
    if (start < 0) throw new Error('startup shell markup not found in index.html');
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = start;
    let depth = 0;
    for (let m = tag.exec(html); m; m = tag.exec(html)) {
        depth += m[1] ? -1 : 1;
        if (depth === 0) return html.slice(start, m.index + m[0].length);
    }
    throw new Error('unbalanced startup shell markup');
}

async function run() {
    await app.whenReady();
    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        useContentSize: true,
        show: args.show !== '0',
        backgroundColor: '#000000',
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    const params = new URLSearchParams(args.params || '');
    params.set('effect', args.effect || 'logo-warp-transition');
    params.set('orbit', params.get('orbit') || '0');
    params.set('hud', '0');
    params.set('t', String(TIMES[0] ?? 0));
    const url = `http://localhost:${PORT}/playground.html?${params.toString()}`;
    const consoleLines = [];
    // Electron console levels: 0 verbose, 1 info, 2 warning, 3 error.
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleLines.push({
            level, message, source: `${sourceId}:${line}`,
        });
    });
    await win.loadURL(url);
    const exec = (src) => win.webContents.executeJavaScript(src, true);
    const ready = await exec(`(async () => {
      const t0 = performance.now();
      while (!window.__PLAYGROUND_READY__ && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
      return { ready: !!window.__PLAYGROUND_READY__, backend: window.__PLAYGROUND__?.backend?.(), dpr: devicePixelRatio, size: [innerWidth, innerHeight] };
    })()`);
    const log = { url, ready, shots: [] };
    if (args['ident-compare'] === '1') {
        // Full-frame pair at the first time: GPU only, then the real CSS ident on top.
        await exec(`(async () => { window.__PLAYGROUND__.setTime(${TIMES[0] ?? 0}); for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r)); })()`);
        const gpuImage = await win.webContents.capturePage();
        mkdirSync(dirname(`${OUT}-gpu.png`), { recursive: true });
        writeFileSync(`${OUT}-gpu.png`, gpuImage.toPNG());
        log.compare = { gpu: `${OUT}-gpu.png`, css: `${OUT}-css.png` };
    }
    if (args['ident-split'] === '1' || args['ident-compare'] === '1') {
        const clip = args['ident-compare'] === '1' ? 'none' : 'inset(0 50% 0 0)';
        log.ident = await exec(`(async () => {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/styles/main.css';
          document.head.appendChild(link); await new Promise((r) => { link.onload = r; link.onerror = r; });
          const fonts = document.createElement('link'); fonts.rel = 'stylesheet'; fonts.href = '/styles/fonts.css';
          document.head.appendChild(fonts); await new Promise((r) => { fonts.onload = r; fonts.onerror = r; });
          const wrap = document.createElement('div'); wrap.innerHTML = ${JSON.stringify(identMarkup())};
          const shell = wrap.firstElementChild; shell.classList.add('sb-lit');
          shell.style.clipPath = ${JSON.stringify(clip)};
          // Freeze the hold loops at their mid pose so the comparison is deterministic.
          shell.querySelectorAll('.startup-logo__orbit, .startup-logo__glint').forEach((el) => { el.style.display = 'none'; });
          const glow = shell.querySelector('.startup-logo__glow');
          if (glow) { glow.style.animation = 'none'; glow.style.opacity = '0.87'; glow.style.transform = 'scale(1.04)'; }
          document.body.appendChild(shell);
          await document.fonts?.ready;
          for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
          const m = shell.querySelector('.startup-logo__mark').getBoundingClientRect();
          return { markCenter: [m.x + m.width / 2, m.y + m.height / 2], markSize: [m.width, m.height] };
        })()`);
    }
    if (args['ident-compare'] === '1') {
        const cssImage = await win.webContents.capturePage();
        writeFileSync(`${OUT}-css.png`, cssImage.toPNG());
        await exec('document.getElementById("startup-shell").style.clipPath = "inset(0 50% 0 0)"');
    }
    for (const t of TIMES) {
        // eslint-disable-next-line no-await-in-loop -- phase-locked captures are sequential
        await exec(`(async () => { window.__PLAYGROUND__.setTime(${t}); for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r)); })()`);
        // eslint-disable-next-line no-await-in-loop -- phase-locked captures are sequential
        const image = await win.webContents.capturePage();
        const file = `${OUT}-t${String(t).replace('.', '_')}.png`;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, image.toPNG());
        log.shots.push({ t, file });
    }
    log.console = consoleLines;
    log.errors = consoleLines.filter((entry) => entry.level >= 2);
    writeFileSync(`${OUT}.json`, JSON.stringify(log, null, 1));
    console.log(JSON.stringify(log, null, 1));
    win.destroy();
    app.quit();
}

run().catch((error) => {
    console.error('[playground-phase-capture] failed:', error);
    app.exit(1);
});
