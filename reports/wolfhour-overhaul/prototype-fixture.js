import * as THREE from 'three/webgpu';
import { create } from '../../src/playground/effects/wolfhour.effect.js';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';
import * as materials from '../../src/themes/wolfhour/wolfhour-materials.js';
import * as post from '../../src/themes/wolfhour/wolfhour-post.js';

window.__WOLFHOUR_ERRORS__ = [];
window.addEventListener('error', event => window.__WOLFHOUR_ERRORS__.push(String(event.message)));
window.addEventListener('unhandledrejection', event => window.__WOLFHOUR_ERRORS__.push(String(event.reason)));

function createShipping({ scene, renderer, params }, fixedTime) {
    const quality = params.get('quality') || 'High';
    window.settings = { graphicsQuality: quality };
    const theme = new WolfhourTheme();
    theme.applyQualityPreset(quality);
    let seed = Number(params.get('seed') || 73013) % 2147483647;
    theme.randomFn = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    theme.renderer = renderer;
    theme.scene = scene;
    scene.background = new THREE.Color(0x000000);
    theme.camera = new THREE.OrthographicCamera(-500 * innerWidth / innerHeight, 500 * innerWidth / innerHeight, 500, -500, 0.1, 10000);
    theme.camera.position.set(0, 0, 1000);
    theme.camera.lookAt(0, 0, 0);
    const readPointer = key => {
        const value = Number(params.get(key) || 0);
        return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    };
    theme.pointerX = readPointer('pointerX');
    theme.pointerY = readPointer('pointerY');
    // Capture the settled pointer pose, independently of host frame cadence.
    theme.smoothedPointerX = theme.pointerX;
    theme.smoothedPointerY = theme.pointerY;
    theme.isWebGPU = true;
    theme.materialFactories = materials;
    theme.postFactories = post;
    theme.flags.usePost = theme.qualityPreset.enableNodePost && params.get('noPost') !== '1';
    theme.flags.useMRT = theme.qualityPreset.enableMRT;
    theme.flags.useCompute = false;
    theme.enforceMRTRuntimeCompatibility();
    theme.createAmbientScene();
    theme.setupPostProcessing();
    theme.configureRendererColorPipeline();
    theme.setupReactivePools();
    theme.lastMeteorTime = fixedTime;
    theme.nextMeteorDelay = 100000;
    let initializedEvent = false;
    const render = () => {
        if (theme.postProcessing) theme.postProcessing.render();
        else renderer.render(scene, theme.camera);
    };
    return {
        theme,
        render,
        update(time) {
            const event = params.get('event');
            const age = event ? Math.max(0, Number(params.get('eventAge') || 0.35)) : 0;
            const advance = delta => {
                // Match startAnimation's director order without rendering between steps.
                theme.updateCameraAnimation(delta);
                theme.updateLunarReaction();
                theme.updateNebulas(delta);
                theme.updateEffects(delta);
                theme.celestialSky?.update(theme.time, theme.effectState);
                theme.alpineLandscape?.update(theme.time, theme.effectState);
                theme.processReactiveQueue();
                theme.updateMeteors();
                theme.updateMeteorCrashes();
            };
            if (event && !initializedEvent) {
                // Queue burst spacing and expiry use wall time, while visual envelopes
                // use theme.time. Advance both together only inside this synchronous
                // simulation. Spawn durations here are synthetic, never perf evidence.
                const ownNow = Object.getOwnPropertyDescriptor(performance, 'now');
                let virtualNow = 1000;
                try {
                    Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => virtualNow });
                    theme.time = time - age;
                    theme.updateCameraAnimation(0);
                    const payload = { playerId: 'capture', viewportOrigin: { x: 0.8, y: 0.75 } };
                    theme.onPieceLock(payload);
                    if (event === 'line' || event === 'combo' || event === 'crash') theme.onLineClear({ ...payload, lineCount: 4 });
                    if (event === 'combo' || event === 'crash') theme.onCombo({ ...payload, comboCount: Number(params.get('combo') || (event === 'crash' ? 5 : 3)) });
                    const steps = Math.max(1, Math.ceil(age * 60));
                    const delta = age / steps;
                    for (let step = 0; step < steps; step++) {
                        const elapsed = (step + 1) * delta;
                        virtualNow = 1000 + elapsed * 1000;
                        theme.time = time - age + elapsed;
                        advance(delta);
                    }
                    initializedEvent = true;
                } finally {
                    if (ownNow) Object.defineProperty(performance, 'now', ownNow);
                    else delete performance.now;
                }
            } else {
                theme.time = time;
                advance(0);
            }
        },
        async renderAsync() { await renderer.compileAsync(scene, theme.camera); render(); },
    };
}

async function initialize() {
    const params = new URLSearchParams(location.search);
    const time = Number(params.get('t') || 8);
    const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, trackTimestamp: true, powerPreference: 'high-performance' });
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) throw new Error('Prototype comparison requires native WebGPU');
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);
    renderer.backend.device.addEventListener('uncapturederror', event => {
        window.__WOLFHOUR_ERRORS__.push(String(event.error?.message || event.error));
        console.error('WebGPU validation:', event.error?.message || event.error);
    });

    let lastCamera = null;
    const renderScene = renderer.render.bind(renderer);
    renderer.render = (renderedScene, camera) => {
        if (renderedScene === scene) lastCamera = camera;
        return renderScene(renderedScene, camera);
    };
    const scene = new THREE.Scene();
    let startedLoading = false;
    let resolveTextures;
    const texturesLoaded = new Promise(resolve => { resolveTextures = resolve; });
    THREE.DefaultLoadingManager.onStart = () => { startedLoading = true; };
    THREE.DefaultLoadingManager.onLoad = () => resolveTextures();
    THREE.DefaultLoadingManager.onError = url => window.__WOLFHOUR_ERRORS__.push(`Texture failed: ${url}`);
    const shipping = params.get('shipping') === '1';
    const effect = shipping ? createShipping({ scene, renderer, params }, time) : create({ scene, renderer, params });
    if (startedLoading) {
        await Promise.race([
            texturesLoaded,
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('Texture loading timed out')), 20000)),
        ]);
    }
    effect.update?.(time, 0);
    if (effect.renderAsync) await effect.renderAsync();
    else effect.render();
    await renderer.resolveTimestampsAsync('render');
    const render = () => effect.render();
    const stats = () => ({
        ...renderer.info.render,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        pixelRatio: renderer.getPixelRatio(),
        camera: lastCamera ? { x: lastCamera.position.x, y: lastCamera.position.y, top: lastCamera.top, left: lastCamera.left } : null,
        memory: { ...renderer.info.memory },
        time,
        seed: Number(params.get('seed') || 73013),
        quality: params.get('quality') || 'High',
        shipping,
        runtimeFeatures: effect.theme?.getRuntimeFeatureSnapshot() || null,
        pointer: effect.theme ? { x: effect.theme.smoothedPointerX, y: effect.theme.smoothedPointerY } : null,
        activeEvents: effect.theme ? {
            stars: effect.theme.starBursts.length,
            meteors: effect.theme.meteors.length,
            crashes: effect.theme.meteorCrashes.length,
            beams: effect.theme.celestialBeams.length,
            rifts: effect.theme.cosmicRifts.length,
            waves: effect.theme.cosmicWaves.length,
            queue: effect.theme.reactiveQueue.length,
        } : null,
    });
    const percentile = (array, ratio) => [...array].sort((a, b) => a - b)[Math.min(array.length - 1, Math.floor(array.length * ratio))] ?? null;
    const summarize = array => ({ count: array.length, p50: percentile(array, 0.5), p95: percentile(array, 0.95), min: Math.min(...array), max: Math.max(...array) });

    async function measure(frames = 180) {
        const gpu = [], cpu = [], intervals = [], content = [];
        let last = null;
        for (let i = 0; i < frames; i += 1) {
            const now = await new Promise(resolve => requestAnimationFrame(resolve));
            if (last !== null) intervals.push(now - last);
            last = now;
            renderer.info.reset();
            const begin = performance.now();
            render();
            cpu.push(performance.now() - begin);
            content.push({ calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, points: renderer.info.render.points });
            // Identical to the original fixture: one datum per completed query resolve.
            const duration = await renderer.resolveTimestampsAsync('render');
            if (Number.isFinite(duration) && duration > 0) gpu.push(duration);
        }
        return { gpuMs: summarize(gpu), cpuMs: summarize(cpu), frameMs: summarize(intervals), samples: { gpu, cpu, intervals }, content, stats: stats() };
    }
    const adapterInfo = renderer.backend.device.adapterInfo;
    const adapter = adapterInfo ? {
        vendor: adapterInfo.vendor,
        architecture: adapterInfo.architecture,
        device: adapterInfo.device,
        description: adapterInfo.description,
    } : null;
    window.__WOLFHOUR_BASELINE__ = { effect, scene, renderer, measure, stats, render, adapter };
    await measure(45);
    window.__PLAYGROUND_READY__ = true;
    console.log('Wolfhour isolated prototype ready', stats());
}

initialize().catch(error => {
    window.__PLAYGROUND_ERROR__ = String(error.stack || error);
    window.__WOLFHOUR_ERRORS__.push(window.__PLAYGROUND_ERROR__);
    console.error(error);
});
