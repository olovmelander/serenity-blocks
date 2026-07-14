/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
/**
 * @fileoverview Odyssey WebGPU pilot — standalone chapter-by-chapter validation scene (DEV only).
 *
 * Part of the Odyssey AAA WebGPU migration (P2/P3). See docs/ODYSSEY_AAA_MASTER_PLAN.md §3/§7.
 * Renders the converted TSL chapter modules (<chapter>.tsl.js) + the atmosphere dome on a
 * real THREE.WebGPURenderer — WITHOUT touching the live Odyssey board — so each conversion
 * can be eyeballed and any WGSL/TSL compile error surfaced before the whole board is flipped.
 *
 * Open `http://localhost:5173/odyssey-webgpu-pilot.html` (after `npm run dev`).
 *   ?chapter=earth-core   start on a specific chapter (default deep-ocean)
 *   ?forceWebGL=1         exercise the automatic WebGL2 fallback backend (look MUST match)
 *   ?dist=120             override camera distance
 * Keys: [n]/→ next chapter, [p]/← previous, [1..7] jump.
 *
 * The HUD reports the resolved backend, current chapter, fps, and a running count of any
 * captured WGSL / ShaderModule / RenderPipeline / "No stack defined" errors.
 */

import * as THREE from 'three/webgpu';
import { createOdysseyAtmosphereDomeTSL } from '../composition/odyssey-atmosphere-dome.tsl.js';
import { OdysseyTslPipeline } from '../odyssey-post/odyssey-tsl-pipeline.js';

const CHAPTERS = [
    {
        key: 'deep-ocean', label: 'Deep Ocean', fn: 'createDeepOceanPilotTSL', dist: 70, lookY: 25, sky: 0x001030, fog: 0x002040, fogD: 0.004, load: () => import('../chapter-environments/deep-ocean.tsl.js'),
    },
    {
        key: 'earth-core', label: 'Earth Core', fn: 'createEarthCorePilotTSL', dist: 150, lookY: 0, sky: 0x1a0a00, fog: 0x2d1500, fogD: 0.004, load: () => import('../chapter-environments/earth-core.tsl.js'),
    },
    {
        // Chapter 3 — was silently exempt from the GPU gate: the assembler existed
        // in surface-world.tsl.js but was never wired here (plan §3c.1).
        key: 'surface-world', label: 'Surface World', fn: 'createSurfaceWorldPilotTSL', dist: 260, lookY: 25, sky: 0x2a2010, fog: 0xb08a50, fogD: 0.0015, load: () => import('../chapter-environments/surface-world.tsl.js'),
    },
    {
        key: 'mountain-peaks', label: 'Mountains', fn: 'createMountainPeaksPilotTSL', dist: 700, lookY: 120, sky: 0x2c3e50, fog: 0x95a5a6, fogD: 0.0006, load: () => import('../chapter-environments/mountain-peaks.tsl.js'),
    },
    {
        key: 'sky-drift', label: 'Sky & Drift', fn: 'createSkyDriftPilotTSL', dist: 320, lookY: 0, sky: 0x1a1a2e, fog: 0x16213e, fogD: 0.0012, load: () => import('../chapter-environments/sky-drift.tsl.js'),
    },
    {
        key: 'cosmic-expanse', label: 'Space', fn: 'createCosmicExpansePilotTSL', dist: 170, lookY: 0, sky: 0x05060f, fog: 0x1a1a2e, fogD: 0.0035, load: () => import('../chapter-environments/cosmic-expanse.tsl.js'),
    },
    {
        key: 'black-hole-transcendence', label: 'Black Hole', fn: 'createBlackHoleTranscendencePilotTSL', dist: 120, lookY: 0, sky: 0x000000, fog: 0x0d0d0d, fogD: 0.01, load: () => import('../chapter-environments/black-hole-transcendence.tsl.js'),
    },
    {
        key: 'urban-dreams', label: 'Neon City', fn: 'createUrbanDreamsPilotTSL', dist: 170, lookY: 30, sky: 0x0a0a1a, fog: 0x1a1020, fogD: 0.01, load: () => import('../chapter-environments/urban-dreams.tsl.js'),
    },
    {
        key: 'path', label: 'Diegetic Path', fn: 'createPathRendererPilotTSL', dist: 36, lookY: 0, sky: 0x05060f, fog: 0x0a0f24, fogD: 0.002, load: () => import('../odyssey-path-renderer.tsl.js'),
    },
    {
        key: 'level-nodes', label: 'Level Nodes', fn: 'createLevelNodesPilotTSL', dist: 16, lookY: 0, sky: 0x0a0a1a, fog: 0x001030, fogD: 0.0008, load: () => import('../level-node-manager.tsl.js'),
    },
    {
        key: 'threshold-breach', label: 'Threshold Breach', fn: 'createThresholdBreachPilotTSL', dist: 20, lookY: 0, sky: 0x100018, fog: 0x180611, fogD: 0.002, load: () => import('../transitions/chapter-threshold-director.tsl.js'),
    },
];

const hud = document.getElementById('hud');
const errEl = document.getElementById('err');
const errors = [];

// Validation-harness contract (plan §3c): the headless GPU gate polls these
// globals instead of a fixed delay, and asserts the backend actually
// initialized — a silent WebGL2 fallback in the WebGPU leg must fail loudly.
window.__ODYSSEY_PILOT_READY__ = false;
window.__ODYSSEY_PILOT_BACKEND__ = null;
window.__ODYSSEY_PILOT_ERRORS__ = errors; // live reference the harness reads

function logError(message) {
    errors.push(message);
    if (errEl) errEl.textContent = errors.slice(-14).join('\n');
}

window.addEventListener('error', (e) => logError(`window.error: ${e.message || e}`));
window.addEventListener('unhandledrejection', (e) => logError(`unhandled: ${e.reason?.message || e.reason}`));

const SHADER_ERR = /WGSL|ShaderModule|RenderPipeline|No stack defined|TSL/i;
const origError = console.error.bind(console);
console.error = (...args) => {
    origError(...args);
    const s = args.map(String).join(' ');
    if (SHADER_ERR.test(s)) logError(`[err] ${s.slice(0, 240)}`);
};
const origWarn = console.warn.bind(console);
console.warn = (...args) => {
    origWarn(...args);
    const s = args.map(String).join(' ');
    if (/WGSL|WebGL2 backend|WebGPU is not available/i.test(s)) logError(`[warn] ${s.slice(0, 240)}`);
};

const params = new URLSearchParams(window.location.search);
const forceWebGL = params.get('forceWebGL') === '1';
const distOverride = Number(params.get('dist')) || 0;
const noPost = params.get('nopost') === '1';

function startIndex() {
    const want = params.get('chapter');
    const i = CHAPTERS.findIndex((c) => c.key === want);
    return i >= 0 ? i : 0;
}

async function main() {
    const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
    await renderer.init();

    const isWebGPU = renderer.backend?.isWebGPUBackend === true;
    const isWebGL = renderer.backend?.isWebGLBackend === true;
    let backendName = 'unknown';
    if (isWebGPU) backendName = 'WebGPU';
    else if (isWebGL) backendName = 'WebGL2 (fallback)';
    window.__ODYSSEY_PILOT_BACKEND__ = { isWebGPU, isWebGL, backendName };

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(0x002040), 0.004);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 12000);

    const dome = createOdysseyAtmosphereDomeTSL({ radius: 4000 });
    scene.add(dome.mesh);

    // Cinematic TSL post (bloom + ACES + grade + CA + vignette + grain). ?nopost=1 bypasses.
    const pipeline = noPost ? null : new OdysseyTslPipeline(renderer, scene, camera);
    pipeline?.setSize(window.innerWidth, window.innerHeight);

    let index = startIndex();
    let current = null; // { group, uniforms, dispose }
    let chapterDef = CHAPTERS[index];
    let loadToken = 0;

    async function loadChapter(i) {
        loadToken += 1;
        const token = loadToken;
        index = (i + CHAPTERS.length) % CHAPTERS.length;
        chapterDef = CHAPTERS[index];

        if (current) {
            scene.remove(current.group);
            current.dispose?.();
            current = null;
        }
        try {
            const mod = await chapterDef.load();
            if (token !== loadToken) return; // a newer switch superseded this one
            const built = mod[chapterDef.fn]();
            scene.add(built.group);
            current = built;
        } catch (e) {
            logError(`FATAL building ${chapterDef.key}: ${e?.stack || e}`);
            return;
        }

        scene.fog.color.set(chapterDef.fog);
        scene.fog.density = chapterDef.fogD;
        renderer.setClearColor(new THREE.Color(chapterDef.fog), 1);
        dome.uniforms.uZenith.value.set(chapterDef.sky);
        dome.uniforms.uHorizon.value.set(chapterDef.fog);
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        pipeline?.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'n' || e.key === 'ArrowRight') loadChapter(index + 1);
        else if (e.key === 'p' || e.key === 'ArrowLeft') loadChapter(index - 1);
        else if (/^[1-9]$/.test(e.key)) loadChapter(Number(e.key) - 1);
    });

    await loadChapter(index);

    const clock = new THREE.Clock();
    let frames = 0;
    let fpsAccum = 0;
    let fps = 0;

    renderer.setAnimationLoop(() => {
        const dt = clock.getDelta();
        const t = clock.elapsedTime;
        if (current?.uniforms?.uTime) current.uniforms.uTime.value = t;

        const dist = distOverride || chapterDef.dist;
        camera.position.set(Math.sin(t * 0.12) * dist, chapterDef.lookY + Math.sin(t * 0.25) * dist * 0.12, Math.cos(t * 0.12) * dist);
        camera.lookAt(0, chapterDef.lookY, 0);
        dome.mesh.position.copy(camera.position);

        if (pipeline) {
            pipeline.updateDynamic({ time: t });
            pipeline.render();
        } else {
            renderer.render(scene, camera);
        }

        // First rendered frame → tell the §3c harness the scene has settled.
        if (window.__ODYSSEY_PILOT_READY__ !== true) window.__ODYSSEY_PILOT_READY__ = true;

        frames += 1;
        fpsAccum += dt;
        if (fpsAccum >= 0.5) {
            fps = Math.round(frames / fpsAccum);
            frames = 0;
            fpsAccum = 0;
        }
        if (hud) {
            hud.textContent = [
                `Odyssey WebGPU pilot — scene ${index + 1}/${CHAPTERS.length}: ${chapterDef.label}  (${chapterDef.key}.tsl.js)`,
                `backend: ${backendName}${forceWebGL ? '  [forceWebGL=1]' : ''}   fps: ${fps}`,
                'keys: [n]/→ next   [p]/← prev   [1-9] jump',
                `shader/TSL errors: ${errors.length}`,
            ].join('\n');
        }
    });
}

main().catch((e) => {
    logError(`FATAL: ${e?.stack || e}`);
    if (hud) hud.textContent = 'FATAL — see errors at bottom';
});
