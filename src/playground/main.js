/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Standalone WebGPU/TSL playground harness — mounts ONE effect in isolation with
// instant HMR, deterministic time, a screenshot-ready signal, and a reference-image
// overlay. Decoupled from the game (no BaseTheme / theme DOM / eventBus theme pipeline).
//
// URL params:
//   ?effect=<id>        which effect to mount (default: first registered)
//   ?t=<seconds>        FIXED deterministic time (phase-locked, reproducible screenshots)
//   ?paused=1           start paused (hold current time)
//   ?orbit=0            disable the default orbit camera (static framing)
//   ?forceWebGL=1       force the WebGL2 backend instead of WebGPU
//   ?trackTimestamp=1   opt into GPU timestamp queries for measured capture sessions
//   ?profile=1          collect bounded CPU/frame/GPU samples via __PLAYGROUND__.profile
//   ?ref=<url>          reference image to overlay (e.g. /playground-refs/target.png)
//   ?refMode=overlay|split|side
//   ?refOpacity=<0..1>
//   ?inspector=1        attach three.js's built-in Inspector (r181+) — GPU-timestamp
//                        Performance/Memory/Console panel, opt-in (adds its own DOM overlay)
//
// Screenshot contract: `window.__PLAYGROUND_READY__ === true` and a `playground-ready`
// event fire after the first frame has compiled + rendered. Agent API on `window.__PLAYGROUND__`.
import './playground.css';
import * as THREE from 'three/webgpu';
import { computeScenePixelRatio } from '../utils/desktop-performance-policy.js';
import { gpuResilience } from '../utils/gpu-context-resilience.js';
import { listEffects, getEffect } from './effects/index.js';
import { createReferenceOverlay } from './reference-overlay.js';

const params = new URLSearchParams(window.location.search);
const stage = document.getElementById('stage');
const errBox = document.getElementById('err');

// ---- state ----
let renderer;
let scene;
let camera;
let current = null; // active effect controller
let currentId = null;
let referenceOverlay = null;

let paused = params.get('paused') === '1';
let fixedTime = params.has('t') ? Number.parseFloat(params.get('t')) : null;
let simTime = Number.isFinite(fixedTime) ? fixedTime : 0;
let lastWall = performance.now() / 1000;
let simDt = 0; // last frame's sim delta — 0 while fixed/paused, so capture mode freezes stateful sims
const orbitEnabled = params.get('orbit') !== '0';
const profileEnabled = params.get('profile') === '1';
const timestampRequested = params.get('trackTimestamp') === '1';
// Timestamp tracking allocates query slots in r181. Only enable it when this harness
// will also drain those queries through the bounded profiler.
const trackTimestamp = profileEnabled && timestampRequested;
let lastObjectUrl = null; // revoked when a new dropped/picked image replaces it

// ---- deterministic RNG (documented seed → reproducible ?t= captures) ----
// mulberry32: tiny, well-distributed 32-bit PRNG. The default is a fixed documented
// constant so a capture with no ?seed= is still reproducible; pass ?seed=<int> or
// __PLAYGROUND__.reset(seed) to vary it. Effects receive `rng` in create()/reset() and
// MUST draw all catalog randomness from it (never Math.random) to stay phase-locked.
const DEFAULT_SEED = 0x57a21197; // documented "starlight" capture seed — do not change casually
function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= (t + Math.imul(t ^ (t >>> 7), 61 | t));
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
let rngSeed = params.has('seed') ? (Number.parseInt(params.get('seed'), 10) >>> 0) : DEFAULT_SEED;
let rng = mulberry32(rngSeed);

const PROFILE_CAPACITY = 1200;
// A frame counts as "dropped" when its wall interval exceeds a 60 Hz budget — the same
// 16.7 ms reference the Definition of Success uses for the p95 target.
const FRAME_BUDGET_MS = 1000 / 60;
const profileState = {
    cpuMs: new Float64Array(PROFILE_CAPACITY),
    frameMs: new Float64Array(PROFILE_CAPACITY),
    gpuMs: new Float64Array(PROFILE_CAPACITY),
    computeMs: new Float64Array(PROFILE_CAPACITY),
    cpuCount: 0,
    frameCount: 0,
    gpuCount: 0,
    computeCount: 0,
    droppedFrames: 0,
    lastFrameStart: null,
    timestampPending: false,
    computeTimestampPending: false,
    timestampError: null,
    computeTimestampError: null,
    heapStart: null,
    heapPeak: 0,
    epoch: 0,
};

// fps tracking
let fps = 0;
let fpsLast = performance.now();
let fpsFrames = 0;

function showError(msg) {
    // eslint-disable-next-line no-console
    console.error('[playground]', msg);
    window.__PLAYGROUND_ERROR__ = String(msg); // fail-fast signal for capture tooling
    if (errBox) {
        errBox.textContent = String(msg);
        errBox.style.display = 'block';
    }
}

// Which PHYSICAL GPU WebGPU actually picked — shown in the HUD because on this dual-GPU
// machine the answer decides whether the page runs at 240 fps or 14. Chromium IGNORES the
// page-level powerPreference hint on Windows (crbug 369219127), so a plain browser tab lands
// on whatever Windows assigns it — measured here: the Radeon 610M, ~10x slower than the RTX
// for the Odyssey world — and nothing on the page can override that. The fix is one-time and
// user-side: Windows Settings → System → Display → Graphics → add the browser → High
// performance. This label exists so "why is it suddenly slow" is answered by reading the HUD
// instead of by a debugging session.
let adapterSuffix = '';
async function resolveAdapterLabel() {
    try {
        const info = renderer?.backend?.device?.adapterInfo
            ?? (await navigator.gpu?.requestAdapter?.())?.info;
        if (!info) return;
        const vendor = info.vendor || '';
        const arch = info.architecture || '';
        if (vendor) adapterSuffix = ` · ${vendor}${arch ? ` ${arch}` : ''}`;
        const integrated = /amd|intel/i.test(vendor) && !/nvidia/i.test(vendor);
        if (integrated && navigator.platform?.startsWith('Win')) {
            // eslint-disable-next-line no-console
            console.warn(
                `[playground] WebGPU is running on the INTEGRATED GPU (${vendor} ${arch}). `
                + 'Windows ignores the powerPreference hint (crbug 369219127); to use the '
                + 'discrete GPU: Windows Settings → Display → Graphics → add this browser → '
                + 'High performance, then restart the browser.',
            );
        }
    } catch { /* adapter identity is best-effort; the label just stays plain */ }
}

function backendName() {
    if (renderer?.backend?.isWebGPUBackend) return `WebGPU${adapterSuffix}`;
    if (renderer?.backend?.isWebGLBackend) return 'WebGL2';
    return '—';
}

function recordProfileSample(buffer, countKey, value) {
    if (!Number.isFinite(value)) return;
    const count = profileState[countKey];
    buffer[count % PROFILE_CAPACITY] = value;
    profileState[countKey] = count + 1;
}

function orderedProfileValues(buffer, count) {
    const length = Math.min(count, PROFILE_CAPACITY);
    const start = count > PROFILE_CAPACITY ? count % PROFILE_CAPACITY : 0;
    return Array.from({ length }, (_, index) => buffer[(start + index) % PROFILE_CAPACITY]);
}

function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return sorted[index];
}

function summarizeProfileBuffer(buffer, count) {
    const values = orderedProfileValues(buffer, count).sort((a, b) => a - b);
    return {
        samples: values.length,
        p50: percentile(values, 0.50),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
        max: values.length ? values[values.length - 1] : null,
    };
}

function readHeapBytes() {
    // Chrome-only; undefined elsewhere. Used to surface an allocation/growth trend.
    const used = performance?.memory?.usedJSHeapSize;
    return Number.isFinite(used) ? used : null;
}

function resetProfile() {
    profileState.epoch += 1;
    profileState.cpuCount = 0;
    profileState.frameCount = 0;
    profileState.gpuCount = 0;
    profileState.computeCount = 0;
    profileState.droppedFrames = 0;
    profileState.lastFrameStart = null;
    profileState.timestampError = null;
    profileState.computeTimestampError = null;
    profileState.heapStart = readHeapBytes();
    profileState.heapPeak = profileState.heapStart ?? 0;
}

function profileSnapshot() {
    return {
        enabled: profileEnabled,
        backend: backendName(),
        effect: currentId,
        // Pinned environment so a metrics artifact is self-describing (§6.1): the seed
        // plus whatever tier/effect-scale/DPR the effect chose to report.
        seed: rngSeed,
        fixedTime: Number.isFinite(fixedTime) ? fixedTime : null,
        captureMeta: current?.getCaptureMeta?.() || null,
        internalResolution: renderer ? {
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            cssWidth: window.innerWidth,
            cssHeight: window.innerHeight,
            pixelRatio: renderer.getPixelRatio?.() ?? null,
        } : null,
        cpuMs: summarizeProfileBuffer(profileState.cpuMs, profileState.cpuCount),
        frameMs: summarizeProfileBuffer(profileState.frameMs, profileState.frameCount),
        gpuMs: summarizeProfileBuffer(profileState.gpuMs, profileState.gpuCount),
        computeMs: summarizeProfileBuffer(profileState.computeMs, profileState.computeCount),
        // Dropped frames: intervals over the 60 Hz budget, with the ratio so a capture
        // can assert "0 dropped" without recomputing from the raw buffer.
        droppedFrames: {
            budgetMs: FRAME_BUDGET_MS,
            dropped: profileState.droppedFrames,
            total: profileState.frameCount,
            ratio: profileState.frameCount > 0
                ? profileState.droppedFrames / profileState.frameCount
                : 0,
        },
        // Allocation/growth trend across the capture window (Chrome only).
        memory: (() => {
            const currentHeap = readHeapBytes();
            if (currentHeap == null || profileState.heapStart == null) return { supported: false };
            return {
                supported: true,
                startBytes: profileState.heapStart,
                currentBytes: currentHeap,
                peakBytes: profileState.heapPeak,
                growthBytes: currentHeap - profileState.heapStart,
                growthMB: (currentHeap - profileState.heapStart) / (1024 * 1024),
            };
        })(),
        // Live particle population, when the effect can report it (§0.9). Null for static
        // scenes that have no dynamic particle simulation.
        activeParticles: current?.getActiveParticleCount?.() ?? null,
        gpuTimestamp: {
            requested: timestampRequested,
            renderStatus: profileState.gpuCount > 0 ? 'available' : 'unavailable',
            computeStatus: profileState.computeCount > 0 ? 'available' : 'unavailable',
            error: profileState.timestampError,
            computeError: profileState.computeTimestampError,
        },
        renderer: current?.getRendererCounters?.() || null,
    };
}

function resolveGpuTimestamp() {
    if (!profileEnabled || !trackTimestamp || profileState.timestampPending) return;
    if (typeof renderer?.resolveTimestampsAsync !== 'function') {
        profileState.timestampError = 'renderer.resolveTimestampsAsync unavailable';
        return;
    }
    profileState.timestampPending = true;
    const { epoch } = profileState;
    renderer.resolveTimestampsAsync('render')
        .then(() => {
            const timestamp = renderer.info?.render?.timestamp;
            if (epoch === profileState.epoch && Number.isFinite(timestamp) && timestamp > 0) {
                recordProfileSample(profileState.gpuMs, 'gpuCount', timestamp);
            }
        })
        .catch((error) => {
            profileState.timestampError = String(error?.message || error);
        })
        .finally(() => {
            profileState.timestampPending = false;
        });
}

function resolveComputeTimestamp() {
    if (!profileEnabled || !trackTimestamp || profileState.computeTimestampPending) return;
    if (typeof renderer?.resolveTimestampsAsync !== 'function') return;
    profileState.computeTimestampPending = true;
    const { epoch } = profileState;
    renderer.resolveTimestampsAsync('compute')
        .then(() => {
            const timestamp = renderer.info?.compute?.timestamp;
            if (epoch === profileState.epoch && Number.isFinite(timestamp) && timestamp > 0) {
                recordProfileSample(profileState.computeMs, 'computeCount', timestamp);
            }
        })
        .catch((error) => {
            profileState.computeTimestampError = String(error?.message || error);
        })
        .finally(() => {
            profileState.computeTimestampPending = false;
        });
}

// ---- time ----
function tick() {
    const now = performance.now() / 1000;
    const wallDt = now - lastWall;
    lastWall = now;
    const prev = simTime;
    if (Number.isFinite(fixedTime)) {
        simTime = fixedTime;
    } else if (!paused) {
        simTime += wallDt;
    }
    // Sim delta: 0 while fixed/paused (deterministic capture), else real wall delta
    // clamped to 50ms (mirrors the theme animate loop) so a stutter can't jump a sim.
    simDt = Math.min(0.05, Math.max(0, simTime - prev));
    return simTime;
}

function defaultCamera(time, cam, radius) {
    const angle = orbitEnabled ? time * 0.2 : 0.6;
    cam.position.set(Math.sin(angle) * radius, radius * 0.28, Math.cos(angle) * radius);
    cam.lookAt(0, 0, 0);
}

// `?silhouette=1` renders every surface as flat black on white. Composition is
// judged on contour: during play the fovea is on the falling piece and the
// periphery resolves silhouette and motion only, so if a scene does not read in
// pure black it does not read at all. Also the fastest way to count how many
// separable masses a frame actually has.
let silhouetteMaterial = null;
function applySilhouetteOverride() {
    if (params.get('silhouette') !== '1') return;
    if (!silhouetteMaterial) {
        silhouetteMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
        silhouetteMaterial.fog = false;
    }
    // White-on-black rather than black-on-white: themes render through their own
    // PostProcessing pipeline, which does not honour scene.background, so the
    // only reliable backdrop is the default clear.
    scene.overrideMaterial = silhouetteMaterial;
    scene.background = null;
    scene.fogNode = null;
    scene.fog = null;
    // Hide the backdrop so the white shows through. The general rule is depth:
    // sky domes, moons, haloes, mist planes and additive motes all render
    // without writing depth, while the solid masses that define the composition
    // all do. That is precisely the split a silhouette test wants, and it needs
    // no per-object naming.
    scene.traverse((object) => {
        if (!object.isMesh && !object.isInstancedMesh) return;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        if (material && material.depthWrite === false) object.visible = false;
    });
}

function applyFrame(time, dt) {
    applySilhouetteOverride();
    if (current?.camera) current.camera(time, camera);
    else defaultCamera(time, camera, current?.cameraRadius ?? 6);
    // Capture mode (?t=): prefer a deterministic absolute-time seek when the effect
    // supports it (true phase-lock, independent of frame cadence); otherwise hold at
    // dt=0 so time-driven work still lands at `time` while stateful sims freeze.
    if (Number.isFinite(fixedTime) && typeof current?.seek === 'function') {
        current.seek(time);
    } else {
        current?.update?.(time, dt);
    }
}

// ---- deterministic capture controls (agent API) ----
// reset(seed): reseed the shared RNG and re-init the effect's deterministic state.
// seek(time): pin absolute time and render one deterministic frame (phase-locked).
function resetEffect(seed) {
    if (seed !== undefined && Number.isFinite(Number(seed))) rngSeed = Number(seed) >>> 0;
    rng = mulberry32(rngSeed);
    if (profileEnabled) resetProfile();
    current?.reset?.(rng, rngSeed);
}

function seekTo(time) {
    fixedTime = time;
    simTime = time;
    simDt = 0;
    applyFrame(time, 0);
    if (current?.render) current.render();
    else if (renderer) renderer.render(scene, camera);
}

// ---- effect mounting ----
function mountEffect(id) {
    const mod = getEffect(id);
    if (!mod) {
        showError(`Unknown effect: "${id}". Available: ${listEffects().map((m) => m.id).join(', ')}`);
        return false;
    }
    if (current) {
        try { current.dispose?.(); } catch (e) { showError(`dispose failed: ${e?.stack || e}`); }
        current = null;
    }
    if (profileEnabled) resetProfile();
    // Defensive isolation: clear anything a previous effect left on the scene root so each
    // effect starts from a clean slate (contract: effects must otherwise be all-or-nothing).
    scene.background = null;
    scene.fog = null;
    scene.environment = null;
    currentId = id;
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    window.__PLAYGROUND_ERROR__ = null;
    // Reseed for this mount so the effect's deterministic setup is reproducible.
    rng = mulberry32(rngSeed);
    scene.overrideMaterial = null;
    try {
        current = mod.create({
            THREE,
            scene,
            camera,
            renderer,
            sizes: { width: window.innerWidth, height: window.innerHeight },
            params,
            rng,
            seed: rngSeed,
        });
    } catch (e) {
        showError(`Effect "${id}" create() failed:\n${e?.stack || e}`);
    }
    window.history.replaceState(null, '', updatedQuery({ effect: id }));
    document.title = `Playground · ${mod.meta.title}`;
    return Boolean(current);
}

function updatedQuery(updates) {
    const p = new URLSearchParams(window.location.search);
    Object.keys(updates).forEach((k) => {
        if (updates[k] == null) p.delete(k);
        else p.set(k, updates[k]);
    });
    const s = p.toString();
    return window.location.pathname + (s ? `?${s}` : '');
}

function onResize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(pixelRatio());
    current?.resize?.(window.innerWidth, window.innerHeight);
}

function pixelRatio() {
    return computeScenePixelRatio({
        renderScale: 1,
        devicePixelRatio: window.devicePixelRatio || 1,
        maxPixelRatio: 2,
        sceneType: 'theme',
    });
}

function markReady() {
    if (window.__PLAYGROUND_READY__) return;
    window.__PLAYGROUND_READY__ = true;
    document.title = `✓ ${document.title}`;
    window.dispatchEvent(new CustomEvent('playground-ready', {
        detail: { effect: currentId, backend: backendName() },
    }));
}

// ---- HUD ----
let hudEls = {};
function buildHud() {
    const hud = document.getElementById('hud');
    // `?hud=0` yields a clean, overlay-free canvas for reference-comparison captures.
    if (params.get('hud') === '0') hud.style.display = 'none';
    const effects = listEffects();
    const options = effects.map((m) => `<option value="${m.id}">${m.title}</option>`).join('');
    hud.innerHTML = `
        <div class="row">
            <strong>Playground</strong>
            <span id="pg-backend" class="tag">—</span>
            <span id="pg-fps" class="tag">0 fps</span>
        </div>
        <label class="row">effect
            <select id="pg-effect">${options}</select>
        </label>
        <label class="row">time <span id="pg-time" class="mono">0.00s</span>
            <input id="pg-scrub" type="range" min="0" max="30" step="0.01" value="0" />
            <button id="pg-play" title="play/pause">⏸</button>
        </label>
        <label class="row">reference
            <select id="pg-refmode">
                <option value="off">off</option>
                <option value="overlay">overlay</option>
                <option value="split">split</option>
                <option value="side">side</option>
            </select>
            <input id="pg-refop" type="range" min="0" max="1" step="0.01" value="0.5" title="reference opacity" />
            <button id="pg-refload" title="load reference image">img…</button>
            <input id="pg-reffile" type="file" accept="image/*" hidden />
        </label>
        <div class="hint">drop an image anywhere · ready flag:
            <span class="mono">window.__PLAYGROUND_READY__</span></div>
    `;
    hudEls = {
        backend: hud.querySelector('#pg-backend'),
        fps: hud.querySelector('#pg-fps'),
        effect: hud.querySelector('#pg-effect'),
        time: hud.querySelector('#pg-time'),
        scrub: hud.querySelector('#pg-scrub'),
        play: hud.querySelector('#pg-play'),
        refmode: hud.querySelector('#pg-refmode'),
        refop: hud.querySelector('#pg-refop'),
        refload: hud.querySelector('#pg-refload'),
        reffile: hud.querySelector('#pg-reffile'),
    };

    hudEls.effect.value = currentId;
    hudEls.play.textContent = paused ? '▶' : '⏸';

    hudEls.effect.addEventListener('change', () => mountEffect(hudEls.effect.value));
    hudEls.scrub.addEventListener('input', () => {
        fixedTime = null;
        paused = true;
        simTime = Number.parseFloat(hudEls.scrub.value);
        hudEls.play.textContent = '▶';
    });
    hudEls.play.addEventListener('click', () => {
        paused = !paused;
        if (!paused) { fixedTime = null; lastWall = performance.now() / 1000; }
        hudEls.play.textContent = paused ? '▶' : '⏸';
    });
    hudEls.refmode.addEventListener('change', () => referenceOverlay.setMode(hudEls.refmode.value));
    hudEls.refop.addEventListener('input', () => referenceOverlay.setOpacity(Number.parseFloat(hudEls.refop.value)));
    hudEls.refload.addEventListener('click', () => hudEls.reffile.click());
    hudEls.reffile.addEventListener('change', () => {
        const file = hudEls.reffile.files?.[0];
        if (file) setReference(objUrl(file));
    });
}

function objUrl(file) {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(file);
    return lastObjectUrl;
}

function setReference(url, opts = {}) {
    referenceOverlay.setUrl(url, opts);
    if (hudEls.refmode) hudEls.refmode.value = referenceOverlay.mode;
}

function updateHud(time) {
    fpsFrames += 1;
    const now = performance.now();
    if (now - fpsLast >= 500) {
        fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
        fpsFrames = 0;
        fpsLast = now;
        if (hudEls.fps) hudEls.fps.textContent = `${fps} fps`;
        if (hudEls.backend) hudEls.backend.textContent = backendName();
    }
    if (hudEls.time) hudEls.time.textContent = `${time.toFixed(2)}s${Number.isFinite(fixedTime) ? ' (fixed)' : ''}`;
    if (hudEls.scrub && !paused && !Number.isFinite(fixedTime)) hudEls.scrub.value = String(time % 30);
}

// ---- drag-and-drop a reference image anywhere ----
function wireDropTarget() {
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
        if (file) setReference(objUrl(file), { mode: 'overlay' });
    });
}

// ---- agent / capture-facing API ----
function exposeApi() {
    window.__PLAYGROUND__ = {
        setEffect: (id) => mountEffect(id),
        listEffects,
        setTime: (t) => { fixedTime = t; simTime = t; },
        clearFixedTime: () => { fixedTime = null; lastWall = performance.now() / 1000; },
        // Deterministic capture: reset(seed) reseeds + re-inits; seek(time) phase-locks
        // and renders one frame. Effects opt in via reset(rng, seed) / seek(time).
        reset: (seed) => resetEffect(seed),
        seek: (t) => seekTo(t),
        seed: () => rngSeed,
        pause: (p = true) => {
            paused = p;
            // resetting lastWall on resume avoids a multi-second dt jump (determinism)
            if (!paused) { fixedTime = null; lastWall = performance.now() / 1000; }
            if (hudEls.play) hudEls.play.textContent = paused ? '▶' : '⏸';
        },
        backend: backendName,
        setReference: (url, opts) => setReference(url, opts),
        diagnostics: () => current?.getDiagnostics?.() || null,
        // Live graph access for agent probes: "is this object actually in the
        // scene, visible, and drawing?" is otherwise unanswerable from outside.
        scene: () => scene,
        camera: () => camera,
        renderer: () => renderer,
        profile: {
            reset: resetProfile,
            snapshot: profileSnapshot,
        },
        get ready() { return !!window.__PLAYGROUND_READY__; },
    };
}

async function init() {
    const forceWebGL = params.get('forceWebGL') === '1';
    renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, trackTimestamp });
    await renderer.init();
    // Fire-and-forget: the HUD updates itself every frame, so the label appears once resolved.
    resolveAdapterLabel();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(pixelRatio());
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 20000);

    referenceOverlay = createReferenceOverlay({ container: stage });

    // TDR / context-loss resilience (singleton drags in only the event bus, not the game).
    // WebGL backend fires webglcontextlost/restored; WebGPU surfaces loss via device.lost —
    // monitor whichever backend we actually got so recovery isn't silently dead.
    gpuResilience.monitorWebGL(renderer.domElement, {
        label: 'playground',
        onRestored: () => { if (currentId) mountEffect(currentId); },
    });
    if (renderer.backend?.isWebGPUBackend && renderer.backend?.device) {
        gpuResilience.monitorWebGPU(renderer.backend.device, {
            label: 'playground',
            onDeviceLost: () => showError('WebGPU device lost (possible TDR). Reload the page to recover.'),
        });
    }

    if (params.get('inspector') === '1') {
        try {
            const { Inspector } = await import('three/addons/inspector/Inspector.js');
            renderer.inspector = new Inspector();
            document.body.appendChild(renderer.inspector.domElement);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[playground] Inspector failed to attach:', e?.stack || e);
        }
    }

    window.addEventListener('resize', onResize);
    wireDropTarget();
    exposeApi();

    const startId = params.get('effect') || listEffects()[0]?.id;
    if (!startId) { showError('No effects registered. Add an *.effect.js under src/playground/effects/.'); return; }
    const mounted = mountEffect(startId);

    buildHud();

    // Apply the URL reference, if any.
    if (params.get('ref')) {
        setReference(params.get('ref'), {
            mode: params.get('refMode') || 'overlay',
            opacity: params.has('refOpacity') ? Number.parseFloat(params.get('refOpacity')) : undefined,
        });
        if (hudEls.refop && params.has('refOpacity')) hudEls.refop.value = params.get('refOpacity');
    }

    // First frame: compile + render once, then raise the screenshot-ready signal.
    // WebGPURenderer.init() has already settled; r181 deprecates renderAsync().
    // Boot-phase timestamps: when an effect takes minutes instead of seconds to first frame
    // (odyssey-world, 2026-08-12: ~165 s), the question "WHICH step" must be answerable from
    // the console of any browser, not by instrumenting a harness after the fact.
    const bootT0 = performance.now();
    const bootMark = (label) => {
        // eslint-disable-next-line no-console
        console.log(`[playground:boot] ${label} +${((performance.now() - bootT0) / 1000).toFixed(2)}s`);
    };
    bootMark('effect mounted, first applyFrame');
    applyFrame(tick(), simDt);
    bootMark('first update applied, first render');
    // Effects may own their render (e.g. a post-processing pass); fall back to direct.
    if (current?.renderAsync) await current.renderAsync();
    else renderer.render(scene, camera);
    bootMark('first render returned');
    // Only raise the screenshot-ready signal if a real effect actually mounted — otherwise a
    // capture agent would screenshot a blank scene believing it succeeded.
    if (mounted && current) markReady();
    else showError(`Effect "${startId}" did not mount — not raising ready signal.`);

    window.scene = scene;
    window.camera = camera;
    window.renderer = renderer;
    window.THREE = THREE;

    renderer.setAnimationLoop(() => {
        const frameStart = performance.now();
        if (profileEnabled) {
            if (profileState.lastFrameStart != null) {
                const interval = frameStart - profileState.lastFrameStart;
                recordProfileSample(profileState.frameMs, 'frameCount', interval);
                if (interval > FRAME_BUDGET_MS) profileState.droppedFrames += 1;
            }
            profileState.lastFrameStart = frameStart;
            const heap = readHeapBytes();
            if (heap != null && heap > profileState.heapPeak) profileState.heapPeak = heap;
        }
        const time = tick();
        applyFrame(time, simDt);
        try {
            if (current?.render) current.render();
            else renderer.render(scene, camera);
        } catch (e) {
            showError(`render failed:\n${e?.stack || e}`);
            renderer.setAnimationLoop(null);
            return;
        }
        if (profileEnabled) {
            recordProfileSample(profileState.cpuMs, 'cpuCount', performance.now() - frameStart);
            if (profileState.cpuCount % 30 === 0) {
                resolveGpuTimestamp();
                resolveComputeTimestamp();
            }
        }
        updateHud(time);
    });
}

init().catch((e) => showError(`init failed:\n${e?.stack || e}`));
