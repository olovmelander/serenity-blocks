import * as THREE from 'three/webgpu';
import WolfhourTheme from './original/wolfhour-theme.js';
import * as materials from './original/wolfhour-materials.js';
import * as post from './original/wolfhour-post.js';

window.__WOLFHOUR_ERRORS__ = [];
window.addEventListener('error', event => window.__WOLFHOUR_ERRORS__.push(String(event.message)));
window.addEventListener('unhandledrejection', event => window.__WOLFHOUR_ERRORS__.push(String(event.reason)));
const fixedTime = Number(new URLSearchParams(location.search).get('t') || 8);
window.settings = { graphicsQuality: 'High' };
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, trackTimestamp: true, powerPreference: 'high-performance' });
await renderer.init();
if (!renderer.backend.isWebGPUBackend) throw new Error('Baseline requires native WebGPU');
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const theme = new WolfhourTheme();
theme.applyQualityPreset('High');
theme.renderer = renderer;
theme.scene = new THREE.Scene();
theme.scene.background = new THREE.Color(0x000000);
theme.camera = new THREE.OrthographicCamera(-500 * innerWidth / innerHeight, 500 * innerWidth / innerHeight, 500, -500, 0.1, 10000);
theme.camera.position.set(0, 0, 1000);
theme.camera.lookAt(0, 0, 0);
theme.isWebGPU = true;
theme.materialFactories = materials;
theme.postFactories = post;
theme.flags.usePost = true;
theme.flags.useMRT = true;
theme.flags.useCompute = false;
theme.enforceMRTRuntimeCompatibility();
theme.createStarfield();
theme.createNebulaBackdrop();
theme.createMoonHero();
theme.createMountains();
theme.createGroundFog();
theme.setupPostProcessing();
theme.configureRendererColorPipeline();
theme.setupReactivePools();
theme.time = fixedTime;
theme.lastMeteorTime = fixedTime;
theme.nextMeteorDelay = 100000;
theme.updateCameraAnimation(0);
theme.updateLunarReaction();
theme.starfieldNodeData.uniforms.uTime.value = fixedTime;
for (const mountain of theme.mountains) mountain.userData.nodeData.uniforms.uTime.value = fixedTime;
theme.groundFog.userData.nodeData.uniforms.uTime.value = fixedTime;
theme.updateEffects(0);

const textureReady = () => theme.nebulaPlanes.every(plane => plane.userData.texture.image?.width > 0) && theme.moonTexture.image?.width > 0;
for (let attempt = 0; attempt < 400 && !textureReady(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
if (!textureReady()) throw new Error('Original textures failed to load');
const render = () => theme.postProcessing.render();
const stats = () => ({ ...renderer.info.render, width: renderer.domElement.width, height: renderer.domElement.height, pixelRatio: renderer.getPixelRatio(), camera: { x: theme.camera.position.x, y: theme.camera.position.y, top: theme.camera.top, left: theme.camera.left }, memory: { ...renderer.info.memory }, time: fixedTime, seed: theme.flags.seed, quality: theme.activeQualityLevel, runtimeFeatures: theme.getRuntimeFeatureSnapshot() });
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
        // One datum for one completed query resolve. No repeated reads of a stale timestamp.
        const duration = await renderer.resolveTimestampsAsync('render');
        if (Number.isFinite(duration) && duration > 0) gpu.push(duration);
    }
    return { gpuMs: summarize(gpu), cpuMs: summarize(cpu), frameMs: summarize(intervals), samples: { gpu, cpu, intervals }, content, stats: stats() };
}

const adapterInfo = renderer.backend.device.adapterInfo;
const adapter = adapterInfo ? { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture, device: adapterInfo.device, description: adapterInfo.description } : null;
window.__WOLFHOUR_BASELINE__ = { theme, renderer, measure, stats, render, adapter };
await measure(45);
window.__PLAYGROUND_READY__ = true;
console.log('Wolfhour isolated baseline ready', stats());
