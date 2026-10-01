import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const read = (p) => readFile(path.join(root, p), 'utf8');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const replace = (source, from, to) => {
    if (!source.includes(from)) throw new Error(`Missing replacement: ${from}`);
    return source.replace(from, to);
};

const originalWorker = await read('scripts/capture-theme-screenshots.mjs');
const originalInstrument = await read('scripts/lib/theme-perf-instrument.mjs');
const originalCell = await read('scripts/lib/theme-perf-cell.mjs');
let worker = replace(originalWorker, "'../src/themes/theme-registry.js'", "'../../../src/themes/theme-registry.js'");
worker = replace(worker, "    'perf',", "    'perf',\n    'perf-uncapped',\n    'force-webgl',\n    'gameplay-shot',");
worker = replace(worker, 'perf: parseBoolean(args.perf, false),', "perf: parseBoolean(args.perf, false),\n        perfUncapped: parseBoolean(args['perf-uncapped'], false),\n        forceWebGL: parseBoolean(args['force-webgl'], false),\n        gameplayShot: parseBoolean(args['gameplay-shot'], false),");
worker = replace(worker, "'./lib/theme-perf-instrument.mjs'", "'./theme-perf-instrument.mjs'");
worker = replace(worker, "'./lib/theme-perf-cell.mjs'", "'./theme-perf-cell.mjs'");
worker = replace(worker, "path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')", "path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')");
worker = replace(worker, "url.searchParams.set('captureBust', config.runId);", "url.searchParams.set('captureBust', config.runId);\n    url.searchParams.set('bloodMoonTime', '12');\n    url.searchParams.set('bloodMoonSeed', '431');\n    if (config.perfUncapped) url.searchParams.set('noThemeFpsCap', '1');\n    if (config.forceWebGL) url.searchParams.set('forceWebGL', '1');");
worker = replace(worker, '            targetFps: config.perfTargetFps,', '            targetFps: config.perfTargetFps,\n            themeFpsCapDisabled: config.perfUncapped,\n            forceWebGL: config.forceWebGL,');
worker = replace(worker, 'async function hideCaptureUiPage() {', 'async function hideCaptureUiPage(options = {}) {');
worker = replace(worker,
    '    hiddenIds.forEach((id) => {',
    `    hiddenIds.forEach((id) => {
        if (options.preserveGameplay && ['single-player-container', 'multiplayer-container',
            'stats-panel', 'next-pieces', 'game-controls', 'game-container'].includes(id)) return;`);
worker = replace(worker,
    '        await executePageFunction(\n            win,\n            hideCaptureUiPage,',
    `        if (config.gameplayShot) {
            await executePageFunction(win, hideCaptureUiPage, { preserveGameplay: true }, 10000, 'gameplay capture cleanup');
            await delay(250);
            await writeFile(path.join(config.outputDir, 'gameplay.png'), (await win.webContents.capturePage()).toPNG());
        }
        await executePageFunction(
            win,
            hideCaptureUiPage,`);

let instrument = replace(originalInstrument,
    'if (!ready || !backend) {',
    "if (!ready || (S.kind === 'WebGPURenderer' && !backend)) {");
instrument = replace(instrument,
    "S.backend = backend.isWebGPUBackend ? 'webgpu' : (backend.isWebGLBackend ? 'webgl2' : null);",
    "S.backend = backend?.isWebGPUBackend ? 'webgpu' : (backend?.isWebGLBackend ? 'webgl2' : (S.kind === 'WebGLRenderer' ? 'webgl2-classic' : null));");
instrument = replace(instrument, 'S.renderer = renderer;', 'S.renderer = renderer; S.resetInfo = null;');
instrument = replace(instrument,
    'const origReset = renderer.info.reset.bind(renderer.info);',
    'const origReset = renderer.info.reset.bind(renderer.info);\n      S.resetInfo = origReset;');
instrument = replace(instrument,
    'S.rings.calls.push(rr.drawCalls);',
    'S.rings.calls.push(rr.drawCalls ?? rr.calls);');
instrument = replace(instrument,
    'S.renderer.info.reset();',
    'if (S.resetInfo) S.resetInfo(); else S.renderer.info.reset();');
instrument = replace(instrument,
    'S.epoch += 1;',
    'S.epoch += 1;\n    if (S.resetInfo) S.resetInfo();');
instrument = replace(instrument,
    'framesObserved,\n            wall:',
    'framesObserved,\n            submittedFrameWindows: cpu.samples,\n            submittedRateHz: raw.windowMs > 0 ? +(cpu.samples * 1000 / raw.windowMs).toFixed(2) : null,\n            wall:');
instrument = replace(instrument,
    'if (S.gpuPending || !S.trackTimestampArmed) return;',
    `if (S.gpuPending || !S.trackTimestampArmed) return;
    // r186 returns lastValue when no fresh query exists; count only a new resolved frame list.
    const queryPool = r.backend?.timestampQueryPool?.render;
    if (!queryPool || queryPool.pendingResolve || !queryPool.currentQueryIndex) return;
    const framesBefore = queryPool.frames;`);
instrument = replace(instrument,
    'if (epoch === S.epoch && Number.isFinite(ts) && ts > 0) S.rings.gpu.push(ts);',
    'if (epoch === S.epoch && queryPool.frames !== framesBefore && Number.isFinite(ts) && ts > 0) S.rings.gpu.push(ts);');
instrument = replace(instrument,
    'const stickySampler = gpu.samples > 0 && framesObserved > 0 && gpu.samples >= framesObserved;',
    'const stickySampler = gpu.samples > 0 && framesObserved > 0 && gpu.samples > framesObserved;');
instrument = replace(instrument,
    '// Observe rather than assume: a pin that silently did not hold makes every timing inadmissible.',
    "try { window.serenityBlocks?.settingsManager?.update?.({ targetFrameRate: ${Number(targetFps)} }); } catch (_) {}\n  // Observe rather than assume: a pin that silently did not hold makes every timing inadmissible.");
instrument = replace(instrument,
    'targetFrameRate: (window.settings && window.settings.targetFrameRate) || null,',
    'targetFrameRate: (window.settings && window.settings.targetFrameRate) || null,\n      playerTargetFrameRate: window.serenityBlocks?.settingsManager?.get?.()?.targetFrameRate ?? null,');
instrument = replace(instrument, 'S.theme = theme;', `S.theme = theme;
    // Report-local deterministic legacy capture: fixed camera/hero phase, seeded scene.
    if (theme.name === 'blood-moon') {
      let seed = 431;
      Math.random = () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (theme.clock && 'moonPhaseX' in theme) {
        theme.time = 12;
        theme.clock.getDelta = () => 0;
        theme.moonPhaseX = 0.6; theme.moonPhaseY = 1.8;
        theme.moonPhaseX2 = 2.4; theme.moonPhaseY2 = 0.2;
        theme.pointerX = 0; theme.pointerY = 0;
        theme.smoothedPointerX = 0; theme.smoothedPointerY = 0;
        const createClouds = theme.createNebulaClouds.bind(theme);
        theme.createNebulaClouds = () => {
          createClouds();
          for (const cloud of theme.nebulaClouds) {
            const phase = cloud.userData.pulsePhase;
            cloud.userData.driftSpeed = 0;
            Object.defineProperty(cloud.userData, 'pulsePhase', {
              configurable: true, get: () => phase, set: () => {},
            });
          }
        };
      }
    }`);

await Promise.all([
    writeFile(path.join(dir, 'capture-theme-screenshots.mjs'), worker),
    writeFile(path.join(dir, 'theme-perf-instrument.mjs'), instrument),
    writeFile(path.join(dir, 'theme-perf-cell.mjs'), originalCell),
    writeFile(path.join(dir, 'instrument-changes.json'), JSON.stringify({
        originals: { worker: hash(originalWorker), instrument: hash(originalInstrument), cell: hash(originalCell) },
        capture: { quality: 'High', windowWidth: 1280, windowHeight: 800, actualCanvasWidth: 1264, actualCanvasHeight: 735, seed: 431, phaseSeconds: 12, pixelRatio: 1 },
        changes: ['Recognize classic renderer without backend', 'Read classic .calls counter', 'Use original reset for lane-owned counters', 'Clear accumulated settle counters at measurement reset', 'Expose submitted render-window rate separately from independent rAF wall rate', 'Seed target scene, freeze legacy time/camera, pass new theme time/seed query parameters', 'Record GPU values only after a fresh timestamp-query frame list resolves', 'Observe and set the actual player settings manager target frame rate', 'Report-local --perf-uncapped maps to existing noThemeFpsCap diagnostic flag and is recorded in manifest', 'Report-local --force-webgl and --gameplay-shot provide compatibility and paused-board evidence'],
        limitations: ['Classic WebGL has no GPU timestamp series in this renderer; wall-frame/CPU metrics only', 'Canvas area is reduced by native Electron window decoration', 'Original before and before-repeat directories are inadmissible instrument evidence and must not be used for performance claims'],
    }, null, 2)),
]);
console.log('Prepared report-local capture instrument. Repository scripts unchanged.');
