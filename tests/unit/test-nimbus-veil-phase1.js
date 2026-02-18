import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 1 Bootstrap + Lifecycle Hardening Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase1.html');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Runtime flags include Phase 1 capability gates');
assert(themeSource.includes("noPost: readBool('nimbusNoPost')"), 'Missing nimbusNoPost flag parsing');
assert(themeSource.includes("noMRT: readBool('nimbusNoMRT')"), 'Missing nimbusNoMRT flag parsing');
assert(themeSource.includes("noCompute: readBool('nimbusNoCompute')"), 'Missing nimbusNoCompute flag parsing');
assert(themeSource.includes("mrtAudit: readBool('nimbusMrtAudit')"), 'Missing nimbusMrtAudit flag parsing');
assert(
    themeSource.includes("strictFallback: readBool('nimbusStrictFallback')"),
    'Missing nimbusStrictFallback parsing',
);
console.log('  ✓ PASS');

console.log('\nTest 2: WebGPU bootstrap and fallback path are wired');
assert(themeSource.includes("import * as THREE_WEBGPU from 'three/webgpu';"), 'Missing three/webgpu import');
assert(themeSource.includes('async initRenderer(container)'), 'Missing async initRenderer');
assert(themeSource.includes('if (!this.shouldForceWebGL()) {'), 'Missing WebGPU-first branch');
assert(
    themeSource.includes('const webgpuRenderer = new THREE_WEBGPU.WebGPURenderer(rendererOptions);'),
    'Missing WebGPU renderer construction',
);
assert(themeSource.includes('await webgpuRenderer.init();'), 'Missing async WebGPU init');
assert(
    themeSource.includes('if (webgpuRenderer.backend?.isWebGPUBackend === true)'),
    'Missing backend identity verification',
);
assert(
    themeSource.includes('renderer = new THREE.WebGLRenderer(rendererOptions);'),
    'Missing WebGL fallback construction',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Capability model and lifecycle resilience helpers exist');
assert(themeSource.includes('probeCapabilities()'), 'Missing probeCapabilities helper');
assert(themeSource.includes('post: !this.flags.noPost && this.isWebGL'), 'Missing post capability gating');
assert(themeSource.includes('mrt: this.isWebGPU && !this.flags.noMRT'), 'Missing MRT capability gating');
assert(themeSource.includes('compute: this.isWebGPU && !this.flags.noCompute'), 'Missing compute capability gating');
assert(themeSource.includes('setupRendererResilience()'), 'Missing setupRendererResilience helper');
assert(themeSource.includes('this.renderer.onDeviceLost = (info) => {'), 'Missing onDeviceLost handler wiring');
assert(
    themeSource.includes('const deviceLostPromise = this.renderer?.backend?.device?.lost;'),
    'Missing device lost promise wiring',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Downgrade and fallback flow are explicit');
assert(
    themeSource.includes('async requestRuntimeRebuild(step, reason = \'runtime-change\', error = null)'),
    'Missing requestRuntimeRebuild helper',
);
assert(
    themeSource.includes('async requestRuntimeDowngrade(reason = \'runtime-downgrade\', error = null)'),
    'Missing requestRuntimeDowngrade helper',
);
assert(
    themeSource.includes('async requestWebGLFallback(reason = \'runtime-fallback\', error = null)'),
    'Missing requestWebGLFallback helper',
);
assert(themeSource.includes('this.flags.forceWebGL = true;'), 'Missing force WebGL fallback flag');
assert(themeSource.includes('async handleDeviceLoss(info)'), 'Missing device-loss handler');
assert(
    themeSource.includes('const rebuilt = await this.createScene();'),
    'Runtime rebuild does not validate createScene result',
);
assert(
    themeSource.includes('Runtime rebuild returned false for step'),
    'Runtime rebuild failure path missing explicit error reason',
);
console.log('  ✓ PASS');

console.log('\nTest 5: Scene boot performs hard cleanup and compile warmup before animation');
assert(themeSource.includes('this.cancelAnimationLoop();'), 'Missing animation-loop cleanup before scene reinit');
assert(themeSource.includes('this.clearEventSubscriptions();'), 'Missing event cleanup before scene reinit');
assert(themeSource.includes('this.removeResizeListener();'), 'Missing resize cleanup before scene reinit');
assert(
    themeSource.includes('this.disposeRuntimeResources({ removeCanvas: true });'),
    'Missing runtime disposal before reinit',
);
assert(
    themeSource.includes('const rendererReady = await this.initRenderer(container);'),
    'createScene missing awaited renderer init',
);
assert(
    themeSource.includes('await this.precompileSceneWithTimeout(compileTimeoutMs);'),
    'createScene missing compile warmup',
);
assert(themeSource.includes('this.clock.start();'), 'Animation clock does not start after warmup');
console.log('  ✓ PASS');

console.log('\nTest 6: compileAsync warmup is timeout-guarded');
assert(
    themeSource.includes('async precompileSceneWithTimeout(timeoutMs = 3000)'),
    'Missing precompileSceneWithTimeout helper',
);
assert(
    themeSource.includes('collectWarmupCompatibility()'),
    'Missing warmup compatibility scan for WebGPU material constraints',
);
assert(themeSource.includes('Promise.race(['), 'Missing compile timeout race guard');
assert(themeSource.includes('this.renderer.compileAsync(this.scene, this.camera)'), 'Missing compileAsync invocation');
assert(themeSource.includes('compileAsync timeout after'), 'Missing compile timeout message');
assert(themeSource.includes('timeoutId = this.scheduleThemeTimeout(() => {'), 'compile timeout should be tracked');
assert(
    themeSource.includes('phase2-webgpu-shader-material-incompatible'),
    'WebGPU warmup skip reason for ShaderMaterial scenes is missing',
);
assert(
    themeSource.includes('this.recordRuntimeFailure(\'compile-warmup\', error'),
    'compile warmup failures should be captured in structured telemetry',
);
console.log('  ✓ PASS');

console.log('\nTest 7: render path degrades safely on failures');
assert(themeSource.includes('renderFrame()'), 'Missing renderFrame abstraction');
assert(themeSource.includes('Post render failed, disabling post path'), 'Missing post failure downgrade');
assert(
    themeSource.includes('this.requestRuntimeDowngrade(\'webgpu-render-failure\', error)'),
    'Missing WebGPU render failure downgrade',
);
assert(
    themeSource.includes('this.recordRuntimeFailure(\'webgpu-render\', error'),
    'WebGPU render failures should be structured',
);
console.log('  ✓ PASS');

console.log('\nTest 8: stop() uses centralized cleanup helpers and invalidates async builds');
assert(themeSource.includes('this.cancelAnimationLoop();'), 'stop() missing animation cancellation');
assert(themeSource.includes('this.clearEventSubscriptions();'), 'stop() missing event cleanup');
assert(
    themeSource.includes('this.disposeRuntimeResources({ removeCanvas: true });'),
    'stop() missing runtime disposal',
);
assert(themeSource.includes('this.capabilities = {'), 'stop() missing capability reset');
assert(themeSource.includes('this.sceneBuildToken += 1;'), 'stop() should invalidate in-flight scene build');
console.log('  ✓ PASS');

console.log('\nTest 9: Capability snapshots and structured runtime telemetry are present');
assert(themeSource.includes('recordRuntimeFailure(stage, error, context = {})'), 'Missing structured failure helper');
assert(themeSource.includes('logCapabilitySnapshot(stage = \'startup\')'), 'Missing capability snapshot logger');
assert(
    themeSource.includes('const disabledReasons = this.buildCapabilityDisabledReasons(supportsTimestampQuery);'),
    'Missing capability disabled-reasons contract',
);
assert(themeSource.includes('this.logCapabilitySnapshot(\'renderer-init\');'), 'Missing deterministic init snapshot');
assert(themeSource.includes('if (this.abortStaleSceneBuild(buildToken'), 'Missing scene-build cancellation guards');
console.log('  ✓ PASS');

console.log('\nTest 10: Phase 1 behavioral validation helpers exist');
assert(themeSource.includes('captureValidationSnapshot(label = \'snapshot\')'), 'Missing validation snapshot helper');
assert(
    themeSource.includes('async runPhase1LifecycleValidation(options = {})'),
    'Missing lifecycle validation runner',
);
assert(
    themeSource.includes('async runPhase1FailureMatrix(options = {})'),
    'Missing failure matrix runner',
);
assert(
    themeSource.includes('async runPhase1ValidationSuite(options = {})'),
    'Missing phase1 suite runner',
);
assert(
    themeSource.includes('phase1Lifecycle: (options = {}) => this.runPhase1LifecycleValidation(options)'),
    'Helper API missing phase1Lifecycle',
);
assert(
    themeSource.includes('phase1Failures: (options = {}) => this.runPhase1FailureMatrix(options)'),
    'Helper API missing phase1Failures',
);
assert(
    themeSource.includes('phase1Suite: (options = {}) => this.runPhase1ValidationSuite(options)'),
    'Helper API missing phase1Suite',
);
assert(
    themeSource.includes('phase1Download: (label) => this.downloadPhase1ValidationReport(label)'),
    'Helper API missing phase1Download',
);
console.log('  ✓ PASS');

console.log('\nTest 11: Phase 1 browser harness exists with lifecycle and failure-matrix controls');
assert(harnessSource.includes('Run 120 Lifecycle Cycles'), 'Harness missing lifecycle validation button');
assert(harnessSource.includes('Run Downgrade + Device-Loss Matrix'), 'Harness missing failure matrix button');
assert(harnessSource.includes('helper.phase1Lifecycle({'), 'Harness missing phase1Lifecycle invocation');
assert(harnessSource.includes('helper.phase1Failures({'), 'Harness missing phase1Failures invocation');
assert(harnessSource.includes('helper.phase1Suite({'), 'Harness missing phase1Suite invocation');
assert(harnessSource.includes('helper.phase1Download('), 'Harness missing phase1Download invocation');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 1 Tests Passed ===');
