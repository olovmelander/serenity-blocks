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
const orbitEnabled = params.get('orbit') !== '0';
let lastObjectUrl = null; // revoked when a new dropped/picked image replaces it

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

function backendName() {
    if (renderer?.backend?.isWebGPUBackend) return 'WebGPU';
    if (renderer?.backend?.isWebGLBackend) return 'WebGL2';
    return '—';
}

// ---- time ----
function tick() {
    const now = performance.now() / 1000;
    const dt = now - lastWall;
    lastWall = now;
    if (Number.isFinite(fixedTime)) {
        simTime = fixedTime;
    } else if (!paused) {
        simTime += dt;
    }
    return simTime;
}

function defaultCamera(time, cam, radius) {
    const angle = orbitEnabled ? time * 0.2 : 0.6;
    cam.position.set(Math.sin(angle) * radius, radius * 0.28, Math.cos(angle) * radius);
    cam.lookAt(0, 0, 0);
}

function applyFrame(time) {
    if (current?.camera) current.camera(time, camera);
    else defaultCamera(time, camera, current?.cameraRadius ?? 6);
    current?.update?.(time);
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
    // Defensive isolation: clear anything a previous effect left on the scene root so each
    // effect starts from a clean slate (contract: effects must otherwise be all-or-nothing).
    scene.background = null;
    scene.fog = null;
    scene.environment = null;
    currentId = id;
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    window.__PLAYGROUND_ERROR__ = null;
    try {
        current = mod.create({
            THREE,
            scene,
            camera,
            renderer,
            sizes: { width: window.innerWidth, height: window.innerHeight },
            params,
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
        pause: (p = true) => {
            paused = p;
            // resetting lastWall on resume avoids a multi-second dt jump (determinism)
            if (!paused) { fixedTime = null; lastWall = performance.now() / 1000; }
            if (hudEls.play) hudEls.play.textContent = paused ? '▶' : '⏸';
        },
        backend: backendName,
        setReference: (url, opts) => setReference(url, opts),
        get ready() { return !!window.__PLAYGROUND_READY__; },
    };
}

async function init() {
    const forceWebGL = params.get('forceWebGL') === '1';
    renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
    await renderer.init();
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

    // First frame: compile + render once (renderAsync ensures the pipeline is ready),
    // then raise the screenshot-ready signal. Mirrors the warm-up themes do at load.
    applyFrame(tick());
    // Effects may own their render (e.g. a post-processing pass); fall back to direct.
    if (current?.renderAsync) await current.renderAsync();
    else await renderer.renderAsync(scene, camera);
    // Only raise the screenshot-ready signal if a real effect actually mounted — otherwise a
    // capture agent would screenshot a blank scene believing it succeeded.
    if (mounted && current) markReady();
    else showError(`Effect "${startId}" did not mount — not raising ready signal.`);

    window.scene = scene;
    window.camera = camera;
    window.renderer = renderer;
    window.THREE = THREE;

    renderer.setAnimationLoop(() => {
        const time = tick();
        applyFrame(time);
        try {
            if (current?.render) current.render();
            else renderer.render(scene, camera);
        } catch (e) {
            showError(`render failed:\n${e?.stack || e}`);
            renderer.setAnimationLoop(null);
            return;
        }
        updateHud(time);
    });
}

init().catch((e) => showError(`init failed:\n${e?.stack || e}`));
