import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Chromadelic Phase 0 Instrumentation Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'chromadelic-highway', 'chromadelic-highway-theme.js');
const computePath = path.join(__dirname, '..', '..', 'src', 'themes', 'chromadelic-highway', 'chromadelic-highway-compute.js');
const materialsPath = path.join(__dirname, '..', '..', 'src', 'themes', 'chromadelic-highway', 'chromadelic-highway-materials.js');

const themeSource = fs.readFileSync(themePath, 'utf8');
const computeSource = fs.readFileSync(computePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');

console.log('Test 1: Debug flags include baseline/seed/fixed dt');
assert(themeSource.includes("baseline: hasFlag('chromadelicBaseline')"), 'Missing chromadelicBaseline flag');
assert(themeSource.includes("params.get('chromadelicSeed')"), 'Missing chromadelicSeed parsing');
assert(themeSource.includes("params.get('chromadelicFixedDt')"), 'Missing chromadelicFixedDt parsing');
console.log('  ✓ PASS');

console.log('\nTest 2: Theme exposes baseline helper API on window');
assert(themeSource.includes('window.chromadelicBaseline = {'), 'Missing window.chromadelicBaseline helper');
assert(themeSource.includes('capture: (label) => this.captureBaseline(label)'), 'Missing capture helper');
assert(themeSource.includes('report: () => this.reportBaseline()'), 'Missing report helper');
assert(themeSource.includes('downloadReport: (label) => this.downloadBaselineReport(label)'), 'Missing downloadReport helper');
assert(themeSource.includes('play: (sequence = \'default\', options = {}) => this.playBaselineSequence(sequence, options)'), 'Missing play helper');
assert(themeSource.includes('capturePack: (options = {}) => this.captureBaselinePack(options)'), 'Missing capturePack helper');
assert(themeSource.includes('captureReadability: (options = {}) => this.captureReadabilityAnchors(options)'), 'Missing captureReadability helper');
assert(
    themeSource.includes('stop: () => this.requestBaselineSoakStop()')
    || themeSource.includes('stop: () => this.clearBaselinePlaybackTimers()'),
    'Missing stop helper',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Baseline frame metrics are tracked and reported');
assert(themeSource.includes('trackBaselineFrame(deltaSeconds)'), 'Missing trackBaselineFrame');
assert(themeSource.includes('reportBaseline()'), 'Missing reportBaseline');
assert(themeSource.includes('avgDrawCalls'), 'Missing draw-call metric in report');
assert(themeSource.includes('low1Fps'), 'Missing 1% low metric in report');
assert(themeSource.includes('frameTimeStdDevMs'), 'Missing frame-time stddev metric in report');
assert(themeSource.includes('frameTimeVarianceMs2'), 'Missing frame-time variance metric in report');
assert(themeSource.includes('gpuMemoryEstimateMb'), 'Missing GPU memory estimate metric in report');
console.log('  ✓ PASS');

console.log('\nTest 4: Deterministic fixed timestep flow exists');
assert(themeSource.includes('this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;'), 'Missing fixed delta initialization');
assert(themeSource.includes('const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : this.clock.getDelta();'), 'Missing fixed delta runtime path');
assert(themeSource.includes('this.time = this.fixedElapsed;'), 'Missing deterministic elapsed time assignment');
console.log('  ✓ PASS');

console.log('\nTest 5: Theme random usage routed through seeded RNG helper');
assert(themeSource.includes('function createSeededRandom(seed)'), 'Missing seeded RNG factory');
assert(themeSource.includes('this.random = createSeededRandom(this.flags.seed);'), 'Missing seeded RNG initialization');
assert(themeSource.includes('rand() {'), 'Missing rand helper method');
console.log('  ✓ PASS');

console.log('\nTest 6: Compute initializer supports deterministic random source');
assert(computeSource.includes('constructor(particleCount, randomFn = Math.random)'), 'Compute constructor does not accept randomFn');
assert(computeSource.includes('this.random = typeof randomFn === \'function\' ? randomFn : Math.random;'), 'Compute random function not stored');
assert(computeSource.includes('this.velocityData[i4 + 2] = 3.0 + this.random() * 5.0;'), 'Compute velocity still uses Math.random');
console.log('  ✓ PASS');

console.log('\nTest 7: Phase 1 capability probing and color pipeline controls exist');
assert(themeSource.includes('probeCapabilities()'), 'Missing probeCapabilities helper');
assert(themeSource.includes('supportsPost'), 'Missing supportsPost capability tracking');
assert(themeSource.includes('supportsMRT'), 'Missing supportsMRT capability tracking');
assert(themeSource.includes('supportsCompute'), 'Missing supportsCompute capability tracking');
assert(themeSource.includes('configureRendererColorPipeline()'), 'Missing renderer color pipeline configuration');
assert(themeSource.includes('this.renderer.outputColorSpace = THREE.SRGBColorSpace;'), 'Missing explicit output color space setup');
assert(themeSource.includes('this.renderer.toneMapping = THREE.NoToneMapping;'), 'Missing WebGPU post tone mapping policy');
assert(themeSource.includes('this.renderer.toneMapping = THREE.ACESFilmicToneMapping;'), 'Missing fallback tone mapping policy');
console.log('  ✓ PASS');

console.log('\nTest 8: Phase 1 lifecycle hardening and device-loss fallback path exist');
assert(themeSource.includes('this.renderer.onDeviceLost = (info) => {'), 'Missing renderer device-loss handler');
assert(themeSource.includes('this.handleDeviceLoss(info);'), 'Missing device-loss recovery callback wiring');
assert(themeSource.includes('async handleDeviceLoss(info)'), 'Missing async device-loss recovery routine');
assert(themeSource.includes('this.flags.forceWebGL = true;'), 'Missing forced WebGL fallback after device loss');
assert(themeSource.includes('this.flags.noCompute = true;'), 'Missing compute disable during recovery');
assert(themeSource.includes('this.flags.noMRT = true;'), 'Missing MRT disable during recovery');
assert(themeSource.includes('disposeRuntimeResources({ removeCanvas = true } = {})'), 'Missing runtime disposal helper');
assert(themeSource.includes('cancelAnimationLoop()'), 'Missing RAF cancellation helper');
assert(themeSource.includes('clearEventSubscriptions()'), 'Missing event unsubscription helper');
assert(themeSource.includes('removeResizeListener()'), 'Missing resize listener cleanup helper');
assert(themeSource.includes('disposeMaterialTextures(material, disposedTextures)'), 'Missing material texture disposal helper');
console.log('  ✓ PASS');

console.log('\nTest 9: Phase 5 reactive envelope and pace-linked road modulation exist');
assert(themeSource.includes('updateReactiveCaps()'), 'Missing reactive caps configuration');
assert(themeSource.includes('pushReactiveEnvelope(boosts = {})'), 'Missing reactive envelope push helper');
assert(themeSource.includes('updateReactiveEnvelope(delta)'), 'Missing reactive envelope update helper');
assert(themeSource.includes('this.updateReactiveEnvelope(delta);'), 'Reactive envelope not integrated in animation loop');
assert(themeSource.includes('this.pushReactiveEnvelope({'), 'Gameplay events not mapped to reactive envelope');
assert(materialsSource.includes('const uPace = uniform(1.0);'), 'Road node material missing pace uniform');
assert(materialsSource.includes('{ uTime, uProgress, uPulse, uPace }'), 'Road node material does not expose pace uniform');
assert(themeSource.includes('uPace: { value: 1.0 }'), 'WebGL road shader missing pace uniform');
console.log('  ✓ PASS');

console.log('\n=== All Chromadelic Phase 0 Tests Passed ===');
