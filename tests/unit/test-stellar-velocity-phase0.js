import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import StellarVelocityTheme from '../../src/themes/stellar-velocity/stellar-velocity-theme.js';
import {
    createStellarVelocityNebulaMaterial,
    auditStellarVelocityMaterialReadiness,
} from '../../src/themes/stellar-velocity/stellar-velocity-materials.js';
import {
    getStellarVelocityComputeBudget,
    STELLAR_VELOCITY_COMPUTE_LAYOUT,
    StellarVelocityStarfieldCompute,
    StellarVelocityBurstCompute,
} from '../../src/themes/stellar-velocity/stellar-velocity-compute.js';

console.log('=== Stellar Velocity Phase 0 Instrumentation Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'stellar-velocity', 'stellar-velocity-theme.js');
const shaderPath = path.join(__dirname, '..', '..', 'src', 'themes', 'stellar-velocity', 'stellar-velocity-shaders.js');
const postPath = path.join(__dirname, '..', '..', 'src', 'themes', 'stellar-velocity', 'stellar-velocity-post.js');
const materialsPath = path.join(__dirname, '..', '..', 'src', 'themes', 'stellar-velocity', 'stellar-velocity-materials.js');
const computePath = path.join(__dirname, '..', '..', 'src', 'themes', 'stellar-velocity', 'stellar-velocity-compute.js');
const artDirectionPath = path.join(__dirname, '..', '..', 'docs', 'STELLAR_VELOCITY_ART_DIRECTION.md');
const protocolPath = path.join(__dirname, '..', '..', 'docs', 'STELLAR_VELOCITY_BASELINE_CAPTURE_PROTOCOL.md');
const harnessPath = path.join(__dirname, '..', '..', 'tests', 'performance', 'benchmark-stellar-velocity-baseline.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const shaderSource = fs.readFileSync(shaderPath, 'utf8');
const postSource = fs.readFileSync(postPath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const computeSource = fs.readFileSync(computePath, 'utf8');
const artDirectionSource = fs.readFileSync(artDirectionPath, 'utf8');
const protocolSource = fs.readFileSync(protocolPath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

function createRuntimeThemeHarness() {
    const theme = new StellarVelocityTheme();
    theme.scene = {};
    theme.camera = { updateProjectionMatrix() {} };
    theme.flags = { ...theme.flags };
    theme.capabilities = { ...theme.capabilities };
    return theme;
}

console.log('Test 1: Shader module exists and exports extracted shader definitions');
assert(shaderSource.includes('export const VignetteShader = {'), 'Missing VignetteShader export');
assert(shaderSource.includes('export const ChromaticAberrationShader = {'), 'Missing ChromaticAberrationShader export');
assert(shaderSource.includes('export const STARFIELD_VERTEX_SHADER = `'), 'Missing starfield vertex shader export');
assert(shaderSource.includes('export const STARFIELD_FRAGMENT_SHADER = `'), 'Missing starfield fragment shader export');
assert(shaderSource.includes('export const NEBULA_VERTEX_SHADER = `'), 'Missing nebula vertex shader export');
assert(shaderSource.includes('export const NEBULA_FRAGMENT_SHADER = `'), 'Missing nebula fragment shader export');
assert(shaderSource.includes('export const WARP_CORE_VERTEX_SHADER = `'), 'Missing warp core vertex shader export');
assert(shaderSource.includes('export const WARP_CORE_FRAGMENT_SHADER = `'), 'Missing warp core fragment shader export');
console.log('  ✓ PASS');

console.log('\nTest 2: Shader extraction remains centralized after Phase 3 modularization');
assert(themeSource.includes("from './stellar-velocity-shaders.js';"), 'Theme missing shader module import');
assert(materialsSource.includes("from './stellar-velocity-shaders.js';"), 'Materials module missing shader import');
assert(materialsSource.includes('vertexShader: STARFIELD_VERTEX_SHADER,'), 'Materials module does not use starfield shader extraction');
assert(materialsSource.includes('fragmentShader: STARFIELD_FRAGMENT_SHADER,'), 'Materials module does not use starfield fragment extraction');
assert(materialsSource.includes('vertexShader: NEBULA_VERTEX_SHADER,'), 'Materials module does not use nebula shader extraction');
assert(materialsSource.includes('fragmentShader: NEBULA_FRAGMENT_SHADER,'), 'Materials module does not use nebula fragment extraction');
assert(materialsSource.includes('vertexShader: WARP_CORE_VERTEX_SHADER,'), 'Materials module does not use warp core shader extraction');
assert(materialsSource.includes('fragmentShader: WARP_CORE_FRAGMENT_SHADER,'), 'Materials module does not use warp core fragment extraction');
console.log('  ✓ PASS');

console.log('\nTest 3: Deterministic Phase 0 flags are parsed and wired');
assert(themeSource.includes('function parseStellarVelocityFlags()'), 'Missing parseStellarVelocityFlags helper');
assert(themeSource.includes('const readBool = (name) => {'), 'Missing robust flag reader');
assert(themeSource.includes("baseline: readBool('stellarVelBaseline')"), 'Missing stellarVelBaseline flag parsing');
assert(themeSource.includes("params.get('stellarVelSeed')"), 'Missing stellarVelSeed parsing');
assert(themeSource.includes("params.get('stellarVelFixedDt')"), 'Missing stellarVelFixedDt parsing');
assert(themeSource.includes("const playbackValue = params.get('stellarVelPlayback');"), 'Missing stellarVelPlayback parsing');
assert(themeSource.includes('this.flags = parseStellarVelocityFlags();'), 'Theme does not assign parsed flags');
assert(themeSource.includes("noDrs: readBool('stellarVelNoDrs')"), 'Missing stellarVelNoDrs parsing');
assert(themeSource.includes("gpuTiming: readBool('stellarVelGpuTiming')"), 'Missing stellarVelGpuTiming parsing');
assert(themeSource.includes('refreshRuntimeFlags()'), 'Missing runtime flag refresh helper');
console.log('  ✓ PASS');

console.log('\nTest 4: Seeded random and deterministic delta hooks exist');
assert(themeSource.includes('function createSeededRandom(seed)'), 'Missing createSeededRandom helper');
assert(themeSource.includes('this.random = createSeededRandom(this.flags.seed);'), 'Missing seeded random assignment');
assert(themeSource.includes('rand() {'), 'Missing random accessor');
assert(themeSource.includes('this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;'), 'Missing fixed delta seconds setup');
assert(themeSource.includes('const measuredDelta = this.clock.getDelta();'), 'Missing measured delta sample');
assert(themeSource.includes('const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : measuredDelta;'), 'Missing fixed delta branch');
console.log('  ✓ PASS');

console.log('\nTest 5: All timeout usage is centralized and tracked');
assert(themeSource.includes('this.activeTimers = new Set();'), 'Missing activeTimers state');
assert(themeSource.includes('scheduleThemeTimeout(callback, delayMs)'), 'Missing scheduleThemeTimeout helper');
assert(themeSource.includes('clearThemeTimeouts()'), 'Missing clearThemeTimeouts helper');
assert(themeSource.includes('this.clearThemeTimeouts();'), 'Shutdown does not clear tracked timers');
const setTimeoutMatches = themeSource.match(/setTimeout\s*\(/g) || [];
assert(setTimeoutMatches.length === 1, 'Raw setTimeout usage should only appear in the tracked helper');
console.log('  ✓ PASS');

console.log('\nTest 6: Baseline metrics reporting includes required Phase 0 fields');
assert(themeSource.includes('trackBaselineFrame(deltaSeconds)'), 'Missing baseline frame tracker');
assert(themeSource.includes('reportBaseline()'), 'Missing baseline report helper');
assert(themeSource.includes('low1Fps'), 'Missing 1% low metric');
assert(themeSource.includes('frameTimeStdDevMs'), 'Missing frame-time stddev metric');
assert(themeSource.includes('frameTimeVarianceMs2'), 'Missing frame-time variance metric');
assert(themeSource.includes('avgDrawCalls'), 'Missing draw call metric');
assert(themeSource.includes('gpuMemoryEstimateMb'), 'Missing GPU memory estimate metric');
console.log('  ✓ PASS');

console.log('\nTest 7: Canned playback and capture helpers are available');
assert(themeSource.includes('getBaselineSequence(name = \'default\')'), 'Missing baseline sequence helper');
assert(themeSource.includes('playBaselineSequence(name = \'default\', options = {})'), 'Missing playback helper');
assert(themeSource.includes('captureBaselinePack(options = {})'), 'Missing capture pack helper');
assert(themeSource.includes('captureReadabilityAnchors(options = {})'), 'Missing readability capture helper');
assert(themeSource.includes('window.stellarVelocityBaseline = {'), 'Missing global baseline helper API');
console.log('  ✓ PASS');

console.log('\nTest 8: Cleanup closes disposal gaps called out in Phase 0');
assert(themeSource.includes('this.bloomPass?.dispose?.();'), 'Missing bloom pass disposal');
assert(themeSource.includes('this.vignettePass?.dispose?.();'), 'Missing vignette pass disposal');
assert(themeSource.includes('this.chromaticPass?.dispose?.();'), 'Missing chromatic pass disposal');
assert(themeSource.includes('disposeSceneResources()'), 'Missing centralized scene disposal helper');
assert(themeSource.includes('this.coreLight = null;'), 'Missing coreLight reference reset');
assert(themeSource.includes('this._starTexture?.dispose?.();'), 'Missing _starTexture disposal');
assert(themeSource.includes('this.glowTextures.forEach((texture) => texture?.dispose?.());'), 'Missing glow texture disposal');
console.log('  ✓ PASS');

console.log('\nTest 9: Phase 0 documentation artifacts exist and include deterministic workflow');
assert(artDirectionSource.includes('stellarVelBaseline=1'), 'Art direction packet missing deterministic baseline flags');
assert(artDirectionSource.includes('window.stellarVelocityBaseline.capturePack'), 'Art direction packet missing helper reference');
assert(protocolSource.includes('tests/performance/benchmark-stellar-velocity-baseline.html'), 'Capture protocol missing harness path');
assert(protocolSource.includes('stellarVelSeed=1234'), 'Capture protocol missing seed flag');
assert(protocolSource.includes('stellarVelFixedDt=16.666'), 'Capture protocol missing fixed dt flag');
console.log('  ✓ PASS');

console.log('\nTest 10: Performance harness targets Stellar Velocity helper and flags');
assert(harnessSource.includes('stellarVelBaseline=1&stellarVelSeed=1234&stellarVelFixedDt=16.666'), 'Harness missing baseline query flags');
assert(harnessSource.includes('window.stellarVelocityBaseline'), 'Harness missing helper API usage');
assert(harnessSource.includes('Stellar Velocity Phase 0 Baseline Harness'), 'Harness missing stellar velocity naming');
console.log('  ✓ PASS');

console.log('\nTest 11: Phase 1 async hybrid renderer bootstrap is wired');
assert(themeSource.includes("import * as THREE_WEBGPU from 'three/webgpu';"), 'Missing THREE_WEBGPU import');
assert(themeSource.includes('async initRenderer(container)'), 'Missing async initRenderer');
assert(themeSource.includes('const rendererReady = await this.initRenderer(container);'), 'createScene does not await/init renderer readiness');
assert(themeSource.includes('if (!rendererReady || !this.renderer || !this.scene || !this.camera) {'), 'createScene missing renderer readiness guard');
assert(themeSource.includes('if (webgpuRenderer.backend?.isWebGPUBackend === true)'), 'Missing backend verification check');
assert(themeSource.includes('this.isWebGPU = renderer.backend?.isWebGPUBackend === true;'), 'Missing WebGPU state assignment');
assert(themeSource.includes('this.isWebGL = renderer.isWebGLRenderer === true'), 'Missing robust WebGL state assignment');
assert(themeSource.includes('shouldForceWebGL()'), 'Missing force-WebGL helper');
console.log('  ✓ PASS');

console.log('\nTest 12: Phase 1 capabilities and color pipeline ownership exist');
assert(themeSource.includes('probeCapabilities()'), 'Missing capability probe helper');
assert(themeSource.includes('this.capabilities = {'), 'Missing capabilities object');
assert(themeSource.includes('const enhancementsEnabled = !this.flags.noEnhancements;'), 'Missing noEnhancements capability gate');
assert(themeSource.includes('configureRendererColorPipeline()'), 'Missing color pipeline helper');
assert(themeSource.includes('this.renderer.toneMapping = THREE.NoToneMapping;'), 'Missing WebGPU post tone mapping policy');
assert(themeSource.includes('this.renderer.toneMapping = THREE.ACESFilmicToneMapping;'), 'Missing fallback tone mapping policy');
assert(themeSource.includes('this.renderer.outputColorSpace = THREE.SRGBColorSpace;'), 'Missing explicit output color space assignment');
console.log('  ✓ PASS');

console.log('\nTest 13: Phase 1 device-loss recovery and runtime fallback flow exist');
assert(themeSource.includes('setupRendererResilience()'), 'Missing renderer resilience setup helper');
assert(themeSource.includes('const resilienceToken = this.rendererResilienceToken;'), 'Missing resilience token guard');
assert(themeSource.includes('this.renderer.onDeviceLost = (info) => {'), 'Missing onDeviceLost wiring');
assert(themeSource.includes('async handleDeviceLoss(info)'), 'Missing device-loss handler');
assert(themeSource.includes('async requestWebGLFallback(reason = \'runtime-fallback\', error = null)'), 'Missing runtime fallback helper');
assert(themeSource.includes('if (this.shouldForceWebGL() && this.isWebGL) return;'), 'Fallback missing already-WebGL short-circuit');
assert(themeSource.includes('this.flags.forceWebGL = true;'), 'Fallback does not force WebGL');
assert(themeSource.includes('this.flags.noMRT = true;'), 'Fallback does not disable MRT');
assert(themeSource.includes('this.flags.noCompute = true;'), 'Fallback does not disable compute');
console.log('  ✓ PASS');

console.log('\nTest 14: Phase 1 lifecycle cleanup and idempotent disposal helpers exist');
assert(themeSource.includes('disposePostProcessingStack()'), 'Missing post stack disposal helper');
assert(themeSource.includes('disposeSceneResources()'), 'Missing scene disposal helper');
assert(themeSource.includes('disposeRendererResources(removeCanvas = true)'), 'Missing renderer disposal helper');
assert(themeSource.includes('resetRuntimeReferences()'), 'Missing runtime reference reset helper');
assert(themeSource.includes('disposeRuntimeResources({ removeCanvas = true } = {})'), 'Missing runtime disposal helper');
assert(themeSource.includes('cancelAnimationLoop()'), 'Missing RAF cancellation helper');
assert(themeSource.includes('clearEventSubscriptions()'), 'Missing event cleanup helper');
assert(themeSource.includes('removeResizeListener()'), 'Missing resize cleanup helper');
console.log('  ✓ PASS');

console.log('\nTest 15: Phase 1 compile warmup and stable resize handler wiring exist');
assert(themeSource.includes('async precompileSceneWithTimeout(timeoutMs = 3000)'), 'Missing compile warmup helper');
assert(themeSource.includes('Promise.race(['), 'Missing compile timeout race');
assert(themeSource.includes('let timeoutId = null;'), 'compileAsync warmup missing timeout tracking');
assert(themeSource.includes('timeoutId = this.scheduleThemeTimeout(() => {'), 'compileAsync timeout not tracked via theme timers');
assert(themeSource.includes('clearTimeout(timeoutId);'), 'compileAsync timeout is not cleared after race');
assert(themeSource.includes('this.activeTimers.delete(timeoutId);'), 'compileAsync timeout cleanup missing activeTimers deletion');
assert(themeSource.includes('compileAsync timeout after'), 'Missing compile timeout message');
assert(themeSource.includes('const compileTimeoutMs = this.performanceBudget?.compileTimeoutMs ?? 3000;'), 'createScene should resolve compile timeout from performance budget');
assert(themeSource.includes('await this.precompileSceneWithTimeout(compileTimeoutMs);'), 'createScene does not invoke compile warmup with runtime timeout');
assert(themeSource.includes('if (!this.boundResizeHandler) {'), 'Missing stable resize callback setup');
assert(themeSource.includes('window.addEventListener(\'resize\', this.boundResizeHandler);'), 'Resize listener does not use stable callback reference');
console.log('  ✓ PASS');

console.log('\nTest 16: Phase 1 reactivation and canvas/clock lifecycle hardening exist');
assert(themeSource.includes('this.disposeRuntimeResources({ removeCanvas: true });'), 'Missing runtime teardown call used for safe reactivation');
assert(themeSource.includes('this.refreshRuntimeFlags();'), 'createScene does not refresh runtime flags before init');
assert(themeSource.includes("const staleCanvas = container.querySelector('#stellar-velocity-renderer');"), 'Missing stale renderer canvas removal guard');
assert(themeSource.includes("this.renderer.domElement.id = 'stellar-velocity-renderer';"), 'Renderer canvas id not set for stale-canvas cleanup');
assert(themeSource.includes('this.clock.start();'), 'Animation clock is not explicitly started');
assert(themeSource.includes('this.clock.stop();'), 'Animation clock is not explicitly stopped');
console.log('  ✓ PASS');

console.log('\nTest 17: Phase 2 unified render path and parity hooks exist');
assert(themeSource.includes("import { StellarVelocityPost } from './stellar-velocity-post.js';"), 'Missing StellarVelocityPost import');
assert(themeSource.includes('renderFrame()'), 'Missing renderFrame abstraction');
assert(themeSource.includes('this.postProcessing.render();'), 'renderFrame missing WebGPU post render path');
assert(themeSource.includes('this.composer.render();'), 'renderFrame missing WebGL composer render path');
assert(themeSource.includes('this.renderer.render(this.scene, this.camera);'), 'renderFrame missing direct render fallback path');
assert(themeSource.includes('this.postProcessing = new StellarVelocityPost('), 'setupPostProcessing does not construct StellarVelocityPost');
assert(themeSource.includes('if (this.postProcessing?.setSize) {'), 'resize does not include WebGPU post size normalization');
assert(!themeSource.includes('this.renderer.autoClear = false;'), 'renderer.autoClear=false should be removed in Phase 2');
assert(!themeSource.includes('this.renderer.clear();'), 'manual renderer.clear() should be removed in Phase 2');
console.log('  ✓ PASS');

console.log('\nTest 18: Phase 4 WebGPU post module supports MRT + grading pipeline');
assert(postSource.includes('export class StellarVelocityPost {'), 'Missing StellarVelocityPost class export');
assert(postSource.includes('this.requestedMRT = params.useMRT === true;'), 'Missing requested MRT post flag');
assert(postSource.includes('this.useMRT = this.requestedMRT;'), 'Missing active MRT post flag initialization');
assert(postSource.includes('this.postProcessing = new THREE_WEBGPU.PostProcessing(renderer);'), 'Missing WebGPU PostProcessing bootstrap');
assert(postSource.includes('this.scenePass = pass(scene, camera);'), 'Missing scene pass wiring');
assert(postSource.includes('this.scenePass.setMRT(mrt({ output, emissive }));'), 'Missing MRT scene pass wiring');
assert(postSource.includes("const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;"), 'Missing emissive-isolated bloom source selection');
assert(postSource.includes('this.uWarpSpeed = uniform(params.warpSpeed ?? 0.0);'), 'Missing warp-speed vignette control');
assert(postSource.includes('this.uDitherStrength = uniform(params.ditherStrength ?? 0.0018);'), 'Missing dithering control');
assert(postSource.includes('getDiagnostics() {'), 'Missing post diagnostics helper');
assert(postSource.includes('this.postProcessing.outputNode = vec4('), 'Missing post output node configuration');
assert(postSource.includes('render() {'), 'Missing post render() method');
assert(postSource.includes('setSize(width, height)'), 'Missing post setSize() method');
assert(postSource.includes('dispose() {'), 'Missing post dispose() method');
console.log('  ✓ PASS');

console.log('\nTest 19: Phase 2 renderFrame routes frames to the active backend path');
{
    const theme = createRuntimeThemeHarness();
    let postCalls = 0;
    let composerCalls = 0;
    let directCalls = 0;
    theme.renderer = { render: () => { directCalls += 1; } };
    theme.postProcessing = { render: () => { postCalls += 1; } };
    theme.composer = { render: () => { composerCalls += 1; } };
    theme.isWebGPU = true;
    theme.isWebGL = false;
    theme.capabilities.post = true;
    theme.renderFrame();
    assert(postCalls === 1 && composerCalls === 0 && directCalls === 0, 'WebGPU post path did not take priority');
}
{
    const theme = createRuntimeThemeHarness();
    let postCalls = 0;
    let composerCalls = 0;
    let directCalls = 0;
    theme.renderer = { render: () => { directCalls += 1; } };
    theme.postProcessing = { render: () => { postCalls += 1; } };
    theme.composer = { render: () => { composerCalls += 1; } };
    theme.isWebGPU = false;
    theme.isWebGL = true;
    theme.capabilities.post = true;
    theme.renderFrame();
    assert(composerCalls === 1 && postCalls === 0 && directCalls === 0, 'WebGL composer path did not take priority');
}
{
    const theme = createRuntimeThemeHarness();
    let directCalls = 0;
    theme.renderer = { render: () => { directCalls += 1; } };
    theme.postProcessing = { render: () => { throw new Error('should not be called'); } };
    theme.composer = { render: () => { throw new Error('should not be called'); } };
    theme.isWebGPU = false;
    theme.isWebGL = true;
    theme.capabilities.post = false;
    theme.renderFrame();
    assert(directCalls === 1, 'Direct render fallback path was not used');
}
console.log('  ✓ PASS');

console.log('\nTest 20: Phase 2 render fallback disables post path and recovers to direct render');
{
    const theme = createRuntimeThemeHarness();
    let directCalls = 0;
    let disposeCalls = 0;
    let colorPipelineCalls = 0;
    let fallbackCalls = 0;
    theme.renderer = {
        render: () => {
            directCalls += 1;
        },
    };
    theme.postProcessing = {
        render: () => {
            throw new Error('post failure');
        },
    };
    theme.isWebGPU = true;
    theme.isWebGL = false;
    theme.capabilities.post = true;
    theme.flags.usePost = true;
    theme.disposePostProcessingStack = () => {
        disposeCalls += 1;
        theme.postProcessing = null;
        theme.composer = null;
    };
    theme.configureRendererColorPipeline = () => {
        colorPipelineCalls += 1;
    };
    theme.requestWebGLFallback = () => {
        fallbackCalls += 1;
        return Promise.resolve();
    };

    theme.render();
    assert(theme.capabilities.post === false, 'Post capability was not disabled after post-path failure');
    assert(theme.flags.usePost === false, 'Runtime post flag was not disabled after post-path failure');
    assert(disposeCalls === 1, 'Post stack was not disposed after post-path failure');
    assert(colorPipelineCalls === 1, 'Color pipeline was not reconfigured after post-path failure');
    assert(directCalls === 1, 'Render did not recover to direct path after post-path failure');
    assert(fallbackCalls === 0, 'WebGL fallback should not trigger when direct recovery succeeds');
}
console.log('  ✓ PASS');

console.log('\nTest 21: Phase 2 render fallback escalates to WebGL when direct path also fails on WebGPU');
{
    const theme = createRuntimeThemeHarness();
    let disposeCalls = 0;
    let fallbackCalls = 0;
    theme.renderer = {
        render: () => {
            throw new Error('direct failure');
        },
    };
    theme.postProcessing = {
        render: () => {
            throw new Error('post failure');
        },
    };
    theme.isWebGPU = true;
    theme.isWebGL = false;
    theme.capabilities.post = true;
    theme.flags.usePost = true;
    theme.disposePostProcessingStack = () => {
        disposeCalls += 1;
        theme.postProcessing = null;
        theme.composer = null;
    };
    theme.configureRendererColorPipeline = () => {};
    theme.requestWebGLFallback = () => {
        fallbackCalls += 1;
        return Promise.resolve();
    };

    theme.render();
    assert(disposeCalls === 1, 'Post stack disposal should occur before WebGL escalation');
    assert(fallbackCalls === 1, 'WebGL fallback should be requested when direct path fails on WebGPU');
}
console.log('  ✓ PASS');

console.log('\nTest 22: Phase 3 materials module exports dual-path factories and bloom contract');
assert(materialsSource.includes('export const STELLAR_VELOCITY_BLOOM_WEIGHTS = {'), 'Missing stellar velocity bloom weight table');
assert(materialsSource.includes('createStellarVelocityStarfieldMaterial'), 'Missing starfield material factory');
assert(materialsSource.includes('createStellarVelocityWarpCoreMaterial'), 'Missing warp core material factory');
assert(materialsSource.includes('createStellarVelocityNebulaMaterial'), 'Missing nebula material factory');
assert(materialsSource.includes('createStellarVelocityAsteroidMaterial'), 'Missing asteroid material factory');
assert(materialsSource.includes('createStellarVelocityEnergyRingMaterial'), 'Missing energy ring material factory');
assert(materialsSource.includes('createStellarVelocityBurstParticleMaterial'), 'Missing burst material factory');
assert(materialsSource.includes('createStellarVelocityShockwaveMaterial'), 'Missing shockwave material factory');
assert(materialsSource.includes('createStellarVelocityCoreGlowMaterial'), 'Missing core glow material factory');
assert(materialsSource.includes('return {\n        material,\n        uniforms,\n        meta: material.userData,'), 'Factory finalize helper should return { material, uniforms, meta }');
console.log('  ✓ PASS');

console.log('\nTest 23: Phase 3 theme path uses modular factories and backend-agnostic uniform writes');
assert(themeSource.includes("from './stellar-velocity-materials.js';"), 'Theme missing stellar velocity materials module import');
assert(themeSource.includes('createStellarVelocityStarfieldMaterial({'), 'Theme does not route starfield material through factory');
assert(themeSource.includes('createStellarVelocityNebulaMaterial({'), 'Theme does not route nebula material through factory');
assert(themeSource.includes('createStellarVelocityWarpCoreMaterial({'), 'Theme does not route warp core material through factory');
assert(themeSource.includes('createStellarVelocityAsteroidMaterial({'), 'Theme does not route asteroid material through factory');
assert(themeSource.includes('createStellarVelocityEnergyRingMaterial({'), 'Theme does not route energy ring material through factory');
assert(themeSource.includes('createStellarVelocityBurstParticleMaterial({'), 'Theme does not route burst material through factory');
assert(themeSource.includes('createStellarVelocityShockwaveMaterial({'), 'Theme does not route shockwave material through factory');
assert(themeSource.includes('createStellarVelocityCoreGlowMaterial({'), 'Theme does not route core glow material through factory');
assert(themeSource.includes('getMaterialUniforms(material)'), 'Missing backend-agnostic material uniform resolver');
assert(themeSource.includes('setMaterialUniformValue(material, uniformName, value)'), 'Missing backend-agnostic uniform setter');
assert(themeSource.includes('setMaterialColor(material, uniformName, colorValue)'), 'Missing backend-agnostic color setter');
assert(themeSource.includes('setMaterialOpacity(material, uniformName, opacityValue)'), 'Missing backend-agnostic opacity setter');
console.log('  ✓ PASS');

console.log('\nTest 24: Phase 3 material MRT-readiness audit and point-size policy hooks exist');
assert(materialsSource.includes('auditStellarVelocityMaterialReadiness('), 'Missing material audit export');
assert(materialsSource.includes('POINT_SIZE_POLICY_VIOLATION'), 'Missing point-size policy enforcement code');
assert(materialsSource.includes('MISSING_POINT_SIZE_CAP'), 'Missing point-size metadata audit code');
assert(materialsSource.includes('WEBGPU_POINT_SIZE_CAP_PX = 1'), 'Missing explicit WebGPU point-size cap');
assert(themeSource.includes('runMaterialAudit({ log = this.flags.mrtAudit === true } = {})'), 'Missing theme material audit helper');
assert(themeSource.includes('this.ensureMrtMaterials();'), 'Scene creation does not execute MRT material readiness guard');
assert(themeSource.includes('auditStellarVelocityMaterialReadiness(this.scene'), 'Theme does not call materials audit');
assert(materialsSource.includes("primitive: 'billboard-quad'"), 'WebGPU star/burst should declare billboard-quad primitive metadata');
assert(themeSource.includes('new THREE.InstancedBufferGeometry();'), 'WebGPU star/burst should use instanced quad geometry');
assert(themeSource.includes("geometry.setAttribute('aOffset',"), 'Instanced billboard paths should write aOffset attributes');
assert(materialsSource.includes('BILLBOARD_POLICY_VIOLATION'), 'Missing billboard policy audit enforcement for WebGPU star/burst');
console.log('  ✓ PASS');

console.log('\nTest 25: Phase 4 theme wiring includes MRT fail-safe + post fallback behavior');
assert(themeSource.includes('ensureMrtMaterials({ log = this.flags.mrtAudit === true } = {})'), 'Missing ensureMrtMaterials fail-safe helper');
assert(themeSource.includes('const preset = this.getWebGPUPostPreset();'), 'setupPostProcessing should resolve post preset before backend branch logic');
assert(themeSource.includes('const requestedMRT = this.capabilities.mrt === true'), 'setupPostProcessing missing MRT request wiring');
assert(themeSource.includes('buildPostParams(requestedMRT)'), 'setupPostProcessing missing MRT post parameter path');
assert(themeSource.includes('buildPostParams(false)'), 'setupPostProcessing missing non-MRT fallback path');
assert(themeSource.includes('this.postProcessing.getDiagnostics?.()'), 'setupPostProcessing missing MRT diagnostics hook');
assert(themeSource.includes('const bloomThreshold = this.postProcessing?.useMRT === true'), 'updatePostProcessing missing MRT bloom-threshold branch');
assert(themeSource.includes('const useWebGPUPreset = this.isWebGPU === true;'), 'updatePostProcessing should branch backend parameter ownership');
assert(themeSource.includes('this.qualityPreset.bloomStrength'), 'WebGL bloom strength should remain tied to quality preset');
console.log('  ✓ PASS');

console.log('\nTest 26: Phase 4 ensureMrtMaterials disables MRT and rebuilds post path on audit failure');
{
    const theme = createRuntimeThemeHarness();
    let setupCalls = 0;
    theme.isWebGPU = true;
    theme.capabilities = { ...theme.capabilities, mrt: true, post: true };
    theme.flags = { ...theme.flags, useMRT: true, mrtAudit: false };
    theme.postProcessing = { useMRT: true };
    theme.runMaterialAudit = () => ({ ready: false, issues: [{ severity: 'error' }] });
    theme.setupPostProcessing = () => { setupCalls += 1; };

    const ready = theme.ensureMrtMaterials();
    assert(ready === false, 'ensureMrtMaterials should return false when audit fails');
    assert(theme.capabilities.mrt === false, 'ensureMrtMaterials should disable MRT capability on audit failure');
    assert(theme.flags.useMRT === false, 'ensureMrtMaterials should disable MRT runtime flag on audit failure');
    assert(setupCalls === 1, 'ensureMrtMaterials should rebuild post path when active MRT post is invalid');
}
console.log('  ✓ PASS');

console.log('\nTest 27: Phase 4 audit-only mode should not hard-fail WebGL fallback emissive verification');
{
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const { material } = createStellarVelocityNebulaMaterial({ isWebGPU: false });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const report = auditStellarVelocityMaterialReadiness(scene, {
        requireNodeMaterials: false,
        enforcePointSizePolicy: false,
    });
    assert(report.ready === true, 'Audit-only mode should stay ready for fallback materials');
    assert(
        !report.issues.some((issue) => issue.code === 'ZERO_EMISSIVE_NOT_ENFORCED'),
        'Audit-only mode should not emit hard ZERO_EMISSIVE_NOT_ENFORCED errors',
    );

    geometry.dispose();
    material.dispose();
}
console.log('  ✓ PASS');

console.log('\nTest 28: Phase 5 foundations export compute budgets and aligned layout contract');
assert(computeSource.includes('export const STELLAR_VELOCITY_COMPUTE_BUDGETS = {'), 'Missing compute budget matrix export');
assert(computeSource.includes('export const STELLAR_VELOCITY_COMPUTE_LAYOUT = {'), 'Missing compute layout contract export');
assert(computeSource.includes('strideBytes: 32'), 'Missing vec4x2 alignment contract in compute layout');
assert(computeSource.includes('positionSeed'), 'Missing positionSeed field in compute layout');
assert(computeSource.includes('motionTwinkle'), 'Missing motionTwinkle field in compute layout');
assert(computeSource.includes('createAlignedStorageBuffer('), 'Missing aligned storage buffer helper');
assert(themeSource.includes("from './stellar-velocity-compute.js';"), 'Theme missing compute module import');
assert(themeSource.includes('this.qualityBudget = getStellarVelocityComputeBudget('), 'Theme missing compute budget wiring');
assert(getStellarVelocityComputeBudget('High').maxAsteroids === 400, 'High quality compute budget mismatch');
assert(STELLAR_VELOCITY_COMPUTE_LAYOUT.starState.strideBytes === 32, 'Star compute layout should use two vec4 lanes');
assert(STELLAR_VELOCITY_COMPUTE_LAYOUT.starState.fields.positionSeed.offsetBytes === 0, 'Star positionSeed offset mismatch');
assert(STELLAR_VELOCITY_COMPUTE_LAYOUT.starState.fields.motionTwinkle.offsetBytes === 16, 'Star motionTwinkle offset mismatch');
assert(STELLAR_VELOCITY_COMPUTE_LAYOUT.burstState.strideBytes === 32, 'Burst compute layout should remain vec4x2 packed');
console.log('  ✓ PASS');

console.log('\nTest 29: Phase 5 asteroid field uses instanced draw groups');
assert(themeSource.includes('createAsteroidVariantGeometry(size, distortion)'), 'Missing asteroid geometry helper for instancing');
assert(themeSource.includes('new THREE.InstancedMesh('), 'Asteroid field should instantiate InstancedMesh groups');
assert(themeSource.includes("geometry.setAttribute('aOrbitData'"), 'Missing per-instance orbit attribute');
assert(themeSource.includes("geometry.setAttribute('aRotationData'"), 'Missing per-instance rotation attribute');
assert(themeSource.includes('mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);'), 'Missing dynamic instance matrix usage');
{
    const theme = createRuntimeThemeHarness();
    theme.scene = new THREE.Scene();
    theme.applyQualityPreset('High');
    theme.createAsteroidField();

    assert(theme.asteroids.length >= 1, 'Asteroid instancing should create at least one instanced group');
    assert(theme.asteroids.every((group) => group.mesh?.isInstancedMesh === true), 'All asteroid groups should be InstancedMesh');
    const totalInstances = theme.asteroids.reduce((sum, group) => sum + (group.count || 0), 0);
    assert(totalInstances === theme.qualityPreset.asteroidCount, 'Total instanced asteroid count should match preset');
}
console.log('  ✓ PASS');

console.log('\nTest 30: Phase 5 compute starfield/burst wiring exists in theme + materials');
assert(themeSource.includes('this.starfieldCompute = new StellarVelocityStarfieldCompute('), 'Starfield compute is not initialized in theme');
assert(themeSource.includes('this.renderer.compute(this.starfieldCompute.computeNode);'), 'Starfield compute dispatch missing');
assert(themeSource.includes('this.starfieldCompute.setInitialState(positions, velocities, twinkleData);'), 'Starfield compute initial twinkle data wiring missing');
assert(themeSource.includes('initializeBurstComputePool()'), 'Missing burst compute pool initializer');
assert(themeSource.includes('this.burstCompute = new StellarVelocityBurstCompute('), 'Burst compute is not initialized in theme');
assert(themeSource.includes('this.burstCompute.triggerBurst({'), 'Burst events should trigger pooled compute particles');
assert(themeSource.includes('this.burstCompute.dispatch(this.renderer, this.time);'), 'Burst compute should dispatch through ping-pong helper');
assert(materialsSource.includes('storage(params.starCompute.getPositionBuffer(), \'vec4\''), 'Starfield node material should consume compute position storage');
assert(materialsSource.includes('storage(params.starCompute.getMiscBuffer(), \'vec4\''), 'Starfield node material should consume compute misc storage');
assert(materialsSource.includes('miscStorage.element(instanceIndex).y'), 'Starfield node material should consume compute twinkle phase');
assert(materialsSource.includes('miscStorage.element(instanceIndex).w'), 'Starfield node material should consume compute streak factor');
assert(materialsSource.includes('storage(params.burstCompute.getPositionBuffer(), \'vec4\''), 'Burst node material should consume compute position storage');
assert(materialsSource.includes('params.burstCompute?.getPositionBuffers'), 'Burst node material should detect ping-pong position buffers');
assert(materialsSource.includes('params.burstCompute?.getDisplayBufferIndexUniform'), 'Burst node material should consume display-buffer selector uniform');
assert(materialsSource.includes('positionStorage.element(instanceIndex).xyz'), 'Compute-backed materials should index storage with instanceIndex');
console.log('  ✓ PASS');

console.log('\nTest 31: Phase 5 compute classes expose aligned storage, uniform-trigger flow, and ping-pong behavior');
{
    const starCompute = new StellarVelocityStarfieldCompute(8, { random: () => 0.5 });
    const starPositions = new Float32Array(8 * 3);
    const starVelocities = new Float32Array(8).fill(0.75);
    const twinkleData = new Float32Array(8 * 2);
    twinkleData[0] = 1.25;
    twinkleData[1] = 2.5;
    starCompute.setInitialState(starPositions, starVelocities, twinkleData);
    assert(starCompute.getPositionBuffer()?.itemSize === 4, 'Starfield compute buffer must be vec4 aligned');
    assert(starCompute.getMiscBuffer()?.itemSize === 4, 'Starfield compute misc buffer must be vec4 aligned');
    assert(Math.abs(starCompute.miscData[1] - 1.25) < 1e-6, 'Starfield twinkle phase should initialize from input data');
    assert(Math.abs(starCompute.miscData[2] - 2.5) < 1e-6, 'Starfield twinkle speed should initialize from input data');
    assert(typeof starCompute.createComputeNode() === 'object', 'Starfield compute node should be created');
    starCompute.dispose();
}
{
    const burstCompute = new StellarVelocityBurstCompute(16, { random: () => 0.5 });
    assert(Array.isArray(burstCompute.getPositionBuffers()) && burstCompute.getPositionBuffers().length === 2, 'Burst compute should expose two ping-pong position buffers');
    assert(Array.isArray(burstCompute.getVelocityBuffers()) && burstCompute.getVelocityBuffers().length === 2, 'Burst compute should expose two ping-pong velocity buffers');
    assert(burstCompute.getPositionBuffer()?.itemSize === 4, 'Burst compute position buffer must be vec4 aligned');
    assert(burstCompute.getVelocityBuffer()?.itemSize === 4, 'Burst compute velocity buffer must be vec4 aligned');
    assert(burstCompute.getDisplayBufferIndexUniform()?.value === 0, 'Burst compute should start with display buffer index 0');
    assert(typeof burstCompute.createComputeNode() === 'object', 'Burst compute node should be created');

    burstCompute.triggerBurst({
        origin: { x: 1, y: 2, z: 3 },
        count: 4,
        speedMin: 10,
        speedMax: 10,
        lifeMin: 2,
        lifeMax: 2,
        zBias: 0.3,
        time: 1.25,
    });
    assert(burstCompute.uBurstStart.value === 0, 'Burst trigger should set spawn start index');
    assert(burstCompute.uBurstCount.value === 4, 'Burst trigger should set spawn particle count');
    assert(burstCompute.uBurstTrigger.value.x === 1 && burstCompute.uBurstTrigger.value.y === 2 && burstCompute.uBurstTrigger.value.z === 3, 'Burst trigger should set uniform spawn origin');
    assert(Math.abs(burstCompute.uBurstTrigger.value.w - 1.25) < 1e-6, 'Burst trigger should encode trigger time in uniform');

    const mockRenderer = {
        calls: 0,
        compute() {
            this.calls += 1;
        },
    };
    burstCompute.dispatch(mockRenderer, 1.25);
    assert(mockRenderer.calls === 1, 'Burst compute dispatch should submit one compute pass per frame');
    assert(burstCompute.getDisplayBufferIndexUniform().value === 1, 'Burst compute dispatch should swap display buffer index');
    assert(burstCompute.uBurstCount.value === 0, 'Burst dispatch should clear burst count after consuming trigger');
    assert(burstCompute.uBurstTrigger.value.w === -1, 'Burst dispatch should reset trigger timestamp after consume');
    burstCompute.dispose();
}
console.log('  ✓ PASS');

console.log('\nTest 32: Phase 5 compute paths prohibit per-frame GPU readback hot-path usage');
assert(!computeSource.includes('getArrayBufferAsync('), 'Compute module should not perform GPU->CPU readbacks');
assert(!computeSource.includes('mapAsync('), 'Compute module should not map GPU buffers for per-frame readback');
assert(!computeSource.includes('getMappedRange('), 'Compute module should not read mapped GPU ranges in hot path');
assert(!themeSource.includes('getArrayBufferAsync('), 'Theme should not read back compute buffers per frame');
assert(!themeSource.includes('mapAsync('), 'Theme should not map compute buffers per frame');
console.log('  ✓ PASS');

console.log('\nTest 33: Phase 6 reactive envelope, color crossfade, and cinematic hooks are wired');
assert(themeSource.includes('this.reactiveEnvelope = {'), 'Phase 6 should define a unified reactive envelope');
assert(themeSource.includes('getReactiveImpulseForEvent(eventName, intensity = 1)'), 'Phase 6 should define event impulse mapping helper');
assert(themeSource.includes('triggerReactiveEvent(eventName, intensity = 1)'), 'Phase 6 should expose reactive event trigger helper');
assert(themeSource.includes('enforceReactiveBudget()'), 'Phase 6 should cap cumulative reactive intensity');
assert(themeSource.includes('decayReactiveEnvelope(delta)'), 'Phase 6 should decay reactive channels deterministically');
assert(themeSource.includes('beginColorTransition(nextIndex, durationSeconds = 2.4)'), 'Phase 6 should define smooth color transition start helper');
assert(themeSource.includes('updateColorTransition(delta)'), 'Phase 6 should update color transition state every frame');
assert(themeSource.includes('createCometStreak()'), 'Phase 6 should include idle comet creation helper');
assert(themeSource.includes('updateCometStreaks(delta)'), 'Phase 6 should include comet lifecycle updater');
assert(themeSource.includes('this.beginColorTransition(nextScheme, 2.2 + this.rand() * 0.8);'), 'Color cycle should use smooth transition, not instant swap');
assert(themeSource.includes('this.applyActivePalette();'), 'Active blended palette should be applied continuously');
assert(materialsSource.includes('uTunnelTint'), 'Starfield materials should expose tunnel tint control');
assert(shaderSource.includes('uniform vec3 uTunnelTint;'), 'GLSL starfield fallback should support tunnel tint');
assert(materialsSource.includes('uPulseBoost'), 'Warp core materials should expose pulse boost control');
assert(materialsSource.includes('uShimmer'), 'Energy ring materials should expose shimmer control');
assert(materialsSource.includes('uCoreGlow'), 'Asteroid materials should expose core glow control');
assert(postSource.includes('if (params.tintColor !== undefined && this.uTintColor?.value)'), 'Post pipeline should accept runtime tint color updates');
{
    const theme = createRuntimeThemeHarness();
    const initialPrimary = theme.activePalette.primary.clone();
    const initialWarp = theme.reactiveEnvelope.warp;

    theme.triggerReactiveEvent('COMBO', 6);
    assert(theme.reactiveEnvelope.warp > initialWarp, 'Reactive COMBO event should raise warp channel');

    theme.beginColorTransition(1, 2.0);
    assert(theme.colorTransition.active === true, 'Color transition should become active when started');
    theme.updateColorTransition(1.0);
    assert(
        !theme.activePalette.primary.equals(initialPrimary),
        'Color transition should lerp active primary color over time',
    );
}
console.log('  ✓ PASS');

console.log('\nTest 34: Phase 6 cleanup and kill-switch behavior cover late-stage enhancement state');
{
    const theme = createRuntimeThemeHarness();
    theme.cometStreaks = [{ id: 1 }];
    theme.cometCounter = 7;
    theme.warpAccretionDisc = { material: {} };
    theme.resetRuntimeReferences();
    assert(Array.isArray(theme.cometStreaks) && theme.cometStreaks.length === 0, 'resetRuntimeReferences should clear comet streak list');
    assert(theme.cometCounter === 0, 'resetRuntimeReferences should clear comet counter');
    assert(theme.warpAccretionDisc === null, 'resetRuntimeReferences should clear accretion disc reference');
}
{
    const theme = createRuntimeThemeHarness();
    theme.flags = { ...theme.flags, noEnhancements: true };
    const warpBefore = theme.reactiveEnvelope.warp;
    theme.onCombo(6);
    assert(theme.reactiveEnvelope.warp === warpBefore, 'noEnhancements should gate reactive event impulses');
    theme.reactiveEnvelope.warp = 1.2;
    theme.updateWarpState(0.016);
    assert(theme.reactiveEnvelope.warp === 0, 'noEnhancements should zero reactive envelope channels during update');
}
console.log('  ✓ PASS');

console.log('\nTest 35: Phase 6 star compute respawn retains depth-band controls');
assert(computeSource.includes('this.uNearBandCutoff = uniform(params.nearBandCutoff ?? 0.22);'), 'Starfield compute should expose near-band cutoff control');
assert(computeSource.includes('this.uMidBandCutoff = uniform(params.midBandCutoff ?? 0.70);'), 'Starfield compute should expose mid-band cutoff control');
assert(computeSource.includes('const bandRadiusMin = farRadiusMin.toVar();'), 'Starfield compute should compute depth-band radius ranges on respawn');
assert(computeSource.includes('pos.z.assign(bandZMin.sub(seedA.mul(bandZSpan)));'), 'Starfield compute should respawn z in depth-band ranges');
{
    const starCompute = new StellarVelocityStarfieldCompute(4, { random: () => 0.5 });
    starCompute.update({
        nearBandCutoff: 0.24,
        midBandCutoff: 0.72,
        nearRadiusMin: 90,
        midRadiusMin: 130,
        farRadiusMin: 270,
        nearRadiusScale: 0.58,
        midRadiusScale: 0.88,
        farRadiusScale: 1.3,
        nearZMin: -640,
        midZMin: -1260,
        farZMin: -2560,
        nearZSpan: 2800,
        midZSpan: 4300,
        farZSpan: 6800,
    });
    assert(Math.abs(starCompute.uNearBandCutoff.value - 0.24) < 1e-6, 'nearBandCutoff update should propagate to compute uniforms');
    assert(Math.abs(starCompute.uFarRadiusScale.value - 1.3) < 1e-6, 'farRadiusScale update should propagate to compute uniforms');
    assert(Math.abs(starCompute.uFarZSpan.value - 6800) < 1e-6, 'farZSpan update should propagate to compute uniforms');
}
console.log('  ✓ PASS');

console.log('\nTest 36: Phase 7 adaptive scaler and performance budgets are wired');
assert(themeSource.includes('const PERFORMANCE_BUDGETS = {'), 'Phase 7 should define per-tier performance budgets');
assert(themeSource.includes('detectHardwareClass()'), 'Phase 7 should classify hardware tiers for budget tuning');
assert(themeSource.includes('resolvePerformanceBudget(quality)'), 'Phase 7 should expose quality budget resolver');
assert(themeSource.includes('resetAdaptiveScalerState()'), 'Phase 7 should expose adaptive scaler reset helper');
assert(themeSource.includes('updateAdaptiveScaler(frameMs)'), 'Phase 7 should update adaptive scaler each frame');
assert(themeSource.includes('this.updateAdaptiveScaler(rawDelta * 1000);'), 'Animation loop should run adaptive scaler');
assert(themeSource.includes('updateRuntimeBudgetControls(pressure)'), 'Adaptive loop should enforce runtime budget controls');
assert(themeSource.includes('this.runtimeBudgetControls.suppressChromatic = severe'), 'Runtime budget controls should include chromatic suppression');
assert(themeSource.includes('this.lastPostCostMs = Number.isFinite(measuredPostCost)'), 'Render path should track post cost for adaptive loop');
assert(postSource.includes('this.lastRenderCostMs = 0;'), 'Post pipeline should track render timing cost');
assert(postSource.includes('getLastRenderCostMs() {'), 'Post pipeline should expose render timing accessor');
assert(themeSource.includes('configureGpuTiming()'), 'Phase 7 should configure optional GPU timing path');
assert(themeSource.includes('updateGpuTimings()'), 'Phase 7 should resolve optional GPU timings');
assert(themeSource.includes('THREE_WEBGPU?.TimestampQuery'), 'GPU timing should use timestamp query APIs when available');
assert(themeSource.includes('runPresetSwitchStress(options = {})'), 'Phase 7 should expose preset-switch stress validation helper');
assert(themeSource.includes('presetSwitchStress: (options = {}) => this.runPresetSwitchStress(options)'), 'Baseline helper API should expose preset-switch stress runner');
{
    const theme = createRuntimeThemeHarness();
    theme.renderer = {
        info: { render: { calls: 640 } },
        setPixelRatio: () => {},
        setSize: () => {},
    };
    theme.flags = { ...theme.flags, noDrs: false, noEnhancements: false };
    theme.performanceBudget = theme.resolvePerformanceBudget('High');
    theme.resetAdaptiveScalerState();
    const initialQualityScale = theme.adaptiveScalerState.qualityScale;
    theme.lastPostCostMs = theme.performanceBudget.maxPostCostMs * 1.6;
    theme.updateAdaptiveScaler(32);
    assert(theme.adaptiveScalerState.qualityScale < initialQualityScale, 'Adaptive scaler should lower qualityScale under sustained pressure');

    const lockedQualityScale = theme.adaptiveScalerState.qualityScale;
    theme.flags.noDrs = true;
    theme.lastPostCostMs = theme.performanceBudget.maxPostCostMs * 2.2;
    theme.updateAdaptiveScaler(40);
    assert(theme.adaptiveScalerState.qualityScale === lockedQualityScale, 'noDrs flag should lock adaptive quality scaling');
}
console.log('  ✓ PASS');

console.log('\nTest 37: Phase 7 runtime budget controls and hot-path profile instrumentation respond under pressure');
{
    const theme = createRuntimeThemeHarness();
    theme.renderer = {
        info: { render: { calls: 1200 } },
        setPixelRatio: () => {},
        setSize: () => {},
    };
    theme.performanceBudget = theme.resolvePerformanceBudget('Low');
    theme.resetAdaptiveScalerState();
    for (let i = 0; i < 8; i++) {
        theme.lastPostCostMs = theme.performanceBudget.maxPostCostMs * 2.2;
        theme.updateAdaptiveScaler(theme.performanceBudget.targetFrameMs * 1.9);
    }

    assert(theme.runtimeBudgetControls.asteroidStride >= 2, 'Runtime budget controls should raise asteroid stride under pressure');
    assert(
        theme.runtimeBudgetControls.suppressChromatic === true || theme.performanceStreaks.postOverBudgetFrames > 0,
        'Runtime budget controls should react to sustained post-cost pressure',
    );

    const initialStarEma = theme.hotPathProfile.starfieldEmaMs;
    theme.runHotPathStep('starfield', () => {}, true);
    assert(theme.hotPathProfile.starfieldEmaMs >= initialStarEma, 'Hot-path profiling should update starfield EMA on sampled frame');
}
console.log('  ✓ PASS');

console.log('\n=== All Stellar Velocity Phase 0/1/2/3/4/5/6 + Phase 7 Tests Passed ===');
