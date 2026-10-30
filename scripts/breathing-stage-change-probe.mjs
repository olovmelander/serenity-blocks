/**
 * Hale session stage changes on real hardware: what building the next world ahead buys and costs.
 *
 * Electron (discrete GPU) boots the real game, builds a BreathworkSessionManager over the real
 * guide (window.breathingIndicator) as the Hub does, and runs a session through its stage changes.
 * Harness-only shortcuts, never shipped behaviour: the session's stages are shortened in the
 * manager's own copy of its plan (spec.shorten), holds are timed, sound and voice are off.
 *
 * Two modes, same commit, same build:
 *   ahead  the shipped flow: each stage builds and compiles the next stage's world off screen
 *          (BreathStage.prepareNext -> BreathWorldHost.prepareWorld / compilePrepared).
 *   cold   the probe swaps the live stage's prepareNext for one that drops the request, so every
 *          stage change builds and compiles its world behind the dip, as before building ahead.
 *
 * Recorded in the page, all on performance.now():
 *   - every stage change (BreathStage.setWorld) and the stage saying the world is back ('ready');
 *   - every pipeline and shader module the stage's device creates (sync and async, with each
 *     async pipeline's resolve time), so a change's own pipelines can be counted;
 *   - building ahead: prepareWorld (synchronous, on the main thread: its duration) and
 *     compilePrepared (start, end); and whether setWorld adopted what was built;
 *   - every requestAnimationFrame interval and every frame the stage drew.
 *
 * Usage (a Vite dev server must serve the checkout; settings in a JSON spec):
 *   node scripts/run-electron.mjs scripts/breathing-stage-change-probe.mjs --spec=path/to/spec.json
 * Spec: baseUrl, out, userData (Electron profile: its GPU shader cache), dsf, width, height, tier,
 * runs ([{session, mode}], run in order: interleave the modes), shorten ({SESSION: {phaseIndex:
 * {duration?, breaths?}}}), changes ({SESSION: how many stage changes to wait for}), tailMs.
 * Also: firstVisit ([world ids]): open the guide on each world once (the Breathing tab's path) and
 * time it to 'ready'; with a fresh userData this is a first visit with no shader cache at all.
 * Record of the measurements: docs/BREATHING_PERF_PASS_2026-10.md ("Measured on hardware").
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop, no-console */
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.join('=') || true];
}));

const { default: electron } = await import('electron');
const { app, BrowserWindow, session } = electron;
const spec = {
    baseUrl: 'http://127.0.0.1:5173',
    out: 'artifacts/breathing-gpu/stage-changes.json',
    userData: null,
    dsf: null,
    // The panel is 2560 x 1600 at a scale of 1.5: 1706.67 CSS pixels, which no window can be.
    width: 1706,
    height: 1066,
    tier: 'High',
    runs: [],
    shorten: {},
    changes: {},
    tailMs: 6000,
    firstVisit: [],
    ...JSON.parse(await readFile(String(args.spec), 'utf8')),
};

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (spec.dsf) app.commandLine.appendSwitch('force-device-scale-factor', String(spec.dsf));
if (spec.userData) app.setPath('userData', path.resolve(String(spec.userData)));

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** World requests this soon after startSession are the session opening, not stage changes. */
const OPENING_MS = 100;

// In the page: the recorder, and hooks on the guide's stage once it exists.
const RECORDER = `(() => {
    if (window.__STAGEPROBE__) return true;
    const P = window.__STAGEPROBE__ = { events: [], rafs: [], draws: [], hooked: null, mode: 'ahead' };
    const now = () => performance.now();
    const log = (type, data = {}) => P.events.push({ t: now(), type, ...data });
    P.log = log;
    const frame = (t) => { P.rafs.push(t); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    P.hook = (stage) => {
        if (!stage || P.hooked === stage) return P.hooked === stage;
        if (!stage.renderer?.backend?.device || !stage.host) return false;
        P.hooked = stage;
        const device = stage.renderer.backend.device;
        const sync = (name) => {
            const original = device[name].bind(device);
            device[name] = (descriptor) => {
                log(name, { label: descriptor?.label || null });
                return original(descriptor);
            };
        };
        ['createRenderPipeline', 'createShaderModule', 'createComputePipeline'].forEach(sync);
        ['createRenderPipelineAsync', 'createComputePipelineAsync'].forEach((name) => {
            const original = device[name].bind(device);
            device[name] = (descriptor) => {
                const started = now();
                const promise = original(descriptor);
                promise.then(
                    () => log(name + ':resolved', { ms: now() - started, started }),
                    () => log(name + ':failed', { started }),
                );
                log(name, { label: descriptor?.label || null });
                return promise;
            };
        });
        const wrap = (target, name, before, after) => {
            const original = target[name];
            target[name] = function wrapped(...args) {
                const started = now();
                const extra = before?.(...args) || {};
                const result = original.apply(this, args);
                const done = (value) => { after?.(started, value, extra); return value; };
                return result && typeof result.then === 'function' ? result.then(done) : done(result);
            };
        };
        // The guide calls setWorld at every stage; only a request for another world is a change.
        wrap(stage, 'setWorld', (id) => {
            if (id !== stage.wantedWorld) log('change', { id, from: stage.wantedWorld });
        });
        const onState = stage.onState;
        stage.onState = (state) => { log('state', { state }); onState?.(state); };
        if (P.mode === 'cold') {
            stage.prepareNext = (id) => {
                log('prepareNext:dropped', { id });
                stage.nextWorld = null;
                stage.host?.discardPrepared();
                return Promise.resolve();
            };
        } else {
            wrap(stage, 'prepareNext', (id) => { log('prepareNext', { id }); });
        }
        const host = stage.host;
        wrap(host, 'prepareWorld', (id) => ({ id }), (started, built, extra) => log('build', {
            id: extra.id, built, ms: now() - started, started,
        }));
        wrap(host, 'compilePrepared', () => { log('compile:start', { id: host.prepared?.worldId ?? null }); },
            (started) => log('compile:end', { ms: now() - started, started }));
        // Adopted: the world now on screen is the very one built ahead.
        wrap(host, 'setWorld', (id) => ({ id, ahead: host.prepared }), (started, shown, extra) => log('host.setWorld', {
            id: extra.id,
            adopted: Boolean(extra.ahead) && host.world === extra.ahead.world,
            ms: now() - started,
            started,
        }));
        const render = host.render;
        host.render = function renderAndMark() { P.draws.push(now()); return render.call(this); };
        const info = device.adapterInfo;
        log('hooked', {
            backend: stage.backend,
            quality: stage.qualityName,
            adapter: info ? info.vendor + ' ' + info.architecture : null,
        });
        return true;
    };
    return true;
})()`;

const START_SESSION = `async ({ id, mode, shorten, tier }) => {
    const P = window.__STAGEPROBE__;
    P.mode = mode;
    const guide = window.breathingIndicator;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    window.settingsManager?.update?.({ effectQuality: tier });
    const { BreathworkSessionManager } = await import('/src/ui/effects/breathwork-session-manager.js');
    const manager = new BreathworkSessionManager(guide);
    window.__PROBE_MANAGER__ = manager;
    manager.audioManager?.setEnabled?.(false);
    // Harness-only: this manager's own copy of the plan, shortened so the changes come within minutes.
    const plan = manager.SESSIONS[id];
    const phases = plan.phases.map((phase, index) => ({ ...phase, ...(shorten?.[index] || {}) }));
    manager.SESSIONS[id] = { ...plan, phases };
    P.log('prepareSession', { id });
    manager.prepareSession(id);
    const t0 = performance.now();
    while (!P.hook(guide.stage) && performance.now() - t0 < 30000) await pause(20);
    // The countdown: three beats.
    await pause(2900);
    P.log('startSession', { id });
    manager.startSession(id, null, null, { openHolds: false, sounds: false, vibration: false });
    // A stage made at start (none was prepared) is hooked as soon as it exists.
    const t1 = performance.now();
    while (!P.hook(guide.stage) && performance.now() - t1 < 30000) await pause(20);
    return {
        hooked: P.hooked === guide.stage,
        quality: guide.stage?.qualityName ?? null,
        worlds: phases.map((phase) => manager._worldFor(phase, id)),
    };
}`;

const FIRST_VISIT = `async ({ world, tier }) => {
    const P = window.__STAGEPROBE__;
    const guide = window.breathingIndicator;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    window.settingsManager?.update?.({ effectQuality: tier });
    guide.setTechnique(world);
    P.log('firstVisit:start', { world });
    guide.start();
    const t0 = performance.now();
    const ready = () => P.events.find((e) => e.type === 'state' && e.state === 'ready' && e.t > t0);
    while (!P.hook(guide.stage) && performance.now() - t0 < 30000) await pause(5);
    while (performance.now() - t0 < 60000 && !ready()) await pause(10);
    return { world, ms: ready() ? ready().t - t0 : null, quality: guide.stage?.qualityName ?? null };
}`;

// Page-side: how many stage changes so far, and whether the last one is back on screen.
const PROGRESS = `(() => {
    const P = window.__STAGEPROBE__;
    const start = P.events.find((e) => e.type === 'startSession')?.t ?? 0;
    const changes = P.events.filter((e) => e.type === 'change' && e.t > start + ${OPENING_MS});
    const last = changes[changes.length - 1];
    const back = Boolean(last && P.events.some((e) => e.type === 'state' && e.state === 'ready' && e.t > last.t));
    return { changes: changes.length, readyAfterLast: back };
})()`;

function percentile(sorted, p) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function intervalStats(times, from, to) {
    const inside = [];
    for (let i = 1; i < times.length; i++) {
        if (times[i] > from && times[i] <= to) inside.push(times[i] - times[i - 1]);
    }
    const sorted = [...inside].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    return {
        frames: inside.length,
        p50: median,
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1] ?? null,
        // A frame that took more than one and a half display intervals is a missed one.
        over: median ? inside.filter((ms) => ms > median * 1.5).length : null,
        over20: inside.filter((ms) => ms > 20).length,
    };
}

/** Per stage change: time back on screen, pipelines made, and the frames around building ahead. */
function analyse(page, mode) {
    const { events, rafs, draws } = page;
    const start = events.find((e) => e.type === 'startSession')?.t ?? 0;
    // The opening (the guide's own world, then the session's prepared one, in the same task as
    // startSession) is not a stage change.
    const changes = events.filter((e) => e.type === 'change' && e.t > start + OPENING_MS);
    return changes.map((change, index) => {
        const next = changes[index + 1]?.t ?? Infinity;
        const ready = events.find((e) => e.type === 'state' && e.state === 'ready' && e.t > change.t && e.t < next);
        const until = ready?.t ?? next;
        const between = events.filter((e) => e.t >= change.t && e.t <= until);
        const count = (type) => between.filter((e) => e.type === type).length;
        const adopt = events.find((e) => e.type === 'host.setWorld' && e.t >= change.t && e.t <= until);
        // Building ahead during this stage, for the stage after it.
        const build = events.find((e) => e.type === 'build' && e.started > change.t && e.started < next);
        const compileEnd = events.find((e) => e.type === 'compile:end'
            && e.started >= (build?.started ?? Infinity) - 1 && e.t < next);
        const asyncDone = between.filter((e) => e.type === 'createRenderPipelineAsync:resolved');
        const restFrom = (ready?.t ?? change.t) + 500;
        const windowFrom = build ? build.started - 1 : restFrom + 2000;
        const windowTo = compileEnd ? compileEnd.t + 1 : windowFrom + 1500;
        return {
            mode,
            to: change.id,
            msToReady: ready ? ready.t - change.t : null,
            adopted: adopt?.adopted ?? null,
            hostSetWorldMs: adopt?.ms ?? null,
            pipelinesSync: count('createRenderPipeline'),
            pipelinesAsync: count('createRenderPipelineAsync'),
            shaderModules: count('createShaderModule'),
            slowestAsyncMs: asyncDone.reduce((top, e) => Math.max(top, e.ms), 0) || null,
            drawsHidden: draws.filter((t) => t >= change.t && t <= (ready?.t ?? change.t)).length,
            buildAhead: build ? {
                id: build.id,
                built: build.built,
                buildMs: build.ms,
                compileMs: compileEnd?.ms ?? null,
                startsAfterReadyMs: ready ? build.started - ready.t : null,
            } : null,
            // rAF intervals while the next world is built and compiled (or the same span of a stage
            // with nothing built), against the rest of the stage's settled time.
            framesWhileBuilding: intervalStats(rafs, windowFrom, windowTo),
            stageDrawsWhileBuilding: intervalStats(draws, windowFrom, windowTo),
            framesAtRest: intervalStats(rafs, windowTo + 500, Math.min(next, windowTo + 500 + 8000) - 300),
            windowMs: windowTo - windowFrom,
        };
    });
}

function describeChange(run, c) {
    const f = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '—');
    const ahead = c.buildAhead
        ? `${c.buildAhead.id} build ${f(c.buildAhead.buildMs, 1)} ms compile ${f(c.buildAhead.compileMs)} ms` : '-';
    const building = c.framesWhileBuilding;
    return `${run.session} ${run.mode} -> ${c.to}: ready ${f(c.msToReady)} ms, adopted ${c.adopted}, `
        + `pipelines ${c.pipelinesSync} sync / ${c.pipelinesAsync} async, shaders ${c.shaderModules}; ahead ${ahead}; `
        + `frames while building max ${f(building.max, 1)} (over ${building.over}/${building.frames}), `
        + `at rest max ${f(c.framesAtRest.max, 1)}`;
}

async function bootGame(win, problems) {
    await win.loadURL(`${spec.baseUrl}/?skipIntro=1&unlockAll=1`);
    const t0 = Date.now();
    for (;;) {
        const ready = await win.webContents
            .executeJavaScript('Boolean(window.breathingIndicator && window.settingsManager)')
            .catch(() => false);
        if (ready) break;
        if (Date.now() - t0 > 120000) throw new Error('the guide never appeared');
        await sleep(250);
    }
    await win.webContents.executeJavaScript(RECORDER);
    // Let the boot's own compiles and the menu settle.
    await sleep(4000);
    problems.length = 0;
}

async function runSession(win, run, problems) {
    await bootGame(win, problems);
    const started = await win.webContents.executeJavaScript(`(${START_SESSION})(${JSON.stringify({
        id: run.session, mode: run.mode, shorten: spec.shorten[run.session] || {}, tier: spec.tier,
    })})`);
    const want = spec.changes[run.session] ?? 3;
    const t0 = Date.now();
    for (;;) {
        const seen = await win.webContents.executeJavaScript(PROGRESS);
        if (seen.changes >= want && seen.readyAfterLast) break;
        if (Date.now() - t0 > 15 * 60 * 1000) {
            throw new Error(`${run.session}: only ${seen.changes} changes in 15 minutes`);
        }
        await sleep(500);
    }
    await sleep(spec.tailMs);
    const page = await win.webContents.executeJavaScript(`(() => {
        window.__PROBE_MANAGER__?.stopSession();
        const P = window.__STAGEPROBE__;
        return { events: P.events, rafs: P.rafs, draws: P.draws };
    })()`);
    const changes = analyse(page, run.mode);
    changes.forEach((c) => console.log(describeChange(run, c)));
    return {
        ...run,
        started,
        hooked: page.events.find((e) => e.type === 'hooked'),
        changes,
        problems: [...problems],
        eventCount: page.events.length,
    };
}

async function firstVisit(win, world, problems) {
    await bootGame(win, problems);
    const visit = await win.webContents
        .executeJavaScript(`(${FIRST_VISIT})(${JSON.stringify({ world, tier: spec.tier })})`);
    const page = await win.webContents.executeJavaScript(
        '(() => { window.breathingIndicator.stop(); return { events: window.__STAGEPROBE__.events }; })()',
    );
    const startT = page.events.find((e) => e.type === 'firstVisit:start')?.t ?? 0;
    const readyT = startT + (visit.ms ?? 0);
    const between = page.events.filter((e) => e.t >= startT && e.t <= readyT);
    const count = (type) => between.filter((e) => e.type === type).length;
    visit.pipelinesSync = count('createRenderPipeline');
    visit.pipelinesAsync = count('createRenderPipelineAsync');
    visit.shaderModules = count('createShaderModule');
    visit.slowestAsyncMs = between.filter((e) => e.type === 'createRenderPipelineAsync:resolved')
        .reduce((top, e) => Math.max(top, e.ms), 0) || null;
    visit.problems = [...problems];
    const f = (n) => (Number.isFinite(n) ? n.toFixed(0) : '—');
    console.log(`first visit ${world}: ready ${f(visit.ms)} ms, pipelines ${visit.pipelinesSync} sync / `
        + `${visit.pipelinesAsync} async (slowest ${f(visit.slowestAsyncMs)} ms), shaders ${visit.shaderModules}`);
    return visit;
}

async function main() {
    const out = path.resolve(String(spec.out));
    await mkdir(path.dirname(out), { recursive: true });
    const partition = 'persist:breathing-stage-probe';
    session.fromPartition(partition).webRequest.onBeforeRequest(
        { urls: [`${spec.baseUrl.replace('http', 'ws')}/*`] },
        (_details, callback) => callback({ cancel: true }),
    );
    const win = new BrowserWindow({
        width: spec.width,
        height: spec.height,
        useContentSize: true,
        frame: false,
        // At a fractional display scale a frameless window with the thick (resize) frame gets a
        // content size Windows will not set exactly; without it the size holds.
        thickFrame: false,
        show: false,
        x: -6000,
        y: -6000,
        webPreferences: { backgroundThrottling: false, partition },
    });
    win.setPosition(-6000, -6000);
    win.showInactive();
    const problems = [];
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2 && !/vite\] failed to connect|Security Warning|vite\] connecting|AudioContext/.test(message)) {
            problems.push(message.slice(0, 300));
        }
    });
    const result = {
        spec,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        startedAt: new Date().toISOString(),
        runs: [],
        firstVisits: [],
    };
    const save = () => writeFile(out, JSON.stringify(result, null, 1));
    try {
        for (const run of spec.runs) {
            result.runs.push(await runSession(win, run, problems));
            await save();
        }
        for (const world of spec.firstVisit) {
            result.firstVisits.push(await firstVisit(win, world, problems));
            await save();
        }
    } catch (error) {
        result.error = String(error?.stack || error);
        console.error(result.error);
    } finally {
        result.finishedAt = new Date().toISOString();
        await save();
        win.destroy();
    }
    app.exit(result.error ? 1 : 0);
}

app.on('window-all-closed', () => {});
app.whenReady().then(main);
