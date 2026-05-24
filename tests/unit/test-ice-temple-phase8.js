import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Ice Temple Phase 8 Validation Instrumentation Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themePath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'themes',
    'ice-temple',
    'ice-temple-theme.js',
);
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Debug flag parsing includes baseline deterministic playback controls');
assert(
    themeSource.includes("baseline: readBool('iceTempleBaseline')"),
    'Missing iceTempleBaseline flag parsing',
);
assert(
    themeSource.includes("const seed = readNumber('iceTempleSeed') ?? readNumber('seed');"),
    'Missing iceTempleSeed parsing',
);
assert(
    themeSource.includes("const fixedDtMs = readNumber('iceTempleFixedDt') ?? readNumber('fixedDt');"),
    'Missing iceTempleFixedDt parsing',
);
assert(
    themeSource.includes("const playbackRaw = readString('iceTemplePlayback');"),
    'Missing iceTemplePlayback parsing',
);
assert(
    themeSource.includes("const playbackLoopsRaw = readNumber('iceTemplePlaybackLoops');"),
    'Missing iceTemplePlaybackLoops parsing',
);
console.log('  PASS');

console.log('\nTest 2: Baseline frame metrics and report fields are implemented');
assert(themeSource.includes('trackBaselineFrame(deltaSeconds)'), 'Missing trackBaselineFrame helper');
assert(themeSource.includes('reportBaseline()'), 'Missing reportBaseline helper');
assert(themeSource.includes('avgDrawCalls'), 'Missing avgDrawCalls report field');
assert(themeSource.includes('low1Fps'), 'Missing low1Fps report field');
assert(themeSource.includes('frameTimeStdDevMs'), 'Missing frameTimeStdDevMs report field');
assert(themeSource.includes('frameTimeVarianceMs2'), 'Missing frameTimeVarianceMs2 report field');
assert(themeSource.includes('gpuMemoryEstimateMb'), 'Missing gpuMemoryEstimateMb report field');
assert(
    themeSource.includes('eventCounts: { ...this.baselineEventCounts }'),
    'Missing eventCounts in report',
);
console.log('  PASS');

console.log('\nTest 3: Helper API is exposed on window for Phase 8 harness automation');
assert(
    themeSource.includes('window.iceTempleBaseline = {'),
    'Missing window.iceTempleBaseline helper exposure',
);
assert(themeSource.includes('capture: (label) => this.captureBaseline(label)'), 'Missing capture helper');
assert(themeSource.includes('report: () => this.reportBaseline()'), 'Missing report helper');
assert(
    themeSource.includes('downloadReport: (label) => this.downloadBaselineReport(label)'),
    'Missing downloadReport helper',
);
assert(
    themeSource.includes(
        "play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options)",
    ),
    'Missing play helper',
);
assert(
    themeSource.includes('validateEvents: (options = {}) => this.runBaselineEventValidation(options)'),
    'Missing validateEvents helper',
);
assert(
    themeSource.includes('validatePipeline: (options = {}) => this.validatePipelineHealth(options)'),
    'Missing validatePipeline helper',
);
assert(
    themeSource.includes('validateMRT: (options = {}) => this.validateMrtIsolation(options)'),
    'Missing validateMRT helper',
);
assert(
    themeSource.includes('validateSnowCompute: (options = {}) => this.validateSnowComputeCapacity(options)'),
    'Missing validateSnowCompute helper',
);
assert(
    themeSource.includes("getSequenceDuration: (sequence = 'default', loops = 1, stepMs = 260) =>"),
    'Missing getSequenceDuration helper',
);
assert(
    themeSource.includes('this.getBaselineSequenceDurationMs(sequence, loops, stepMs)'),
    'Missing getSequenceDuration implementation',
);
assert(
    themeSource.includes('getPresetOrder: () => this.getBaselinePresetOrder()'),
    'Missing getPresetOrder helper',
);
assert(
    themeSource.includes('setQuality: (level, options = {}) => this.setBaselineQuality(level, options)'),
    'Missing setQuality helper',
);
assert(
    themeSource.includes('capturePresetMatrix: (options = {}) => this.captureBaselinePresetMatrix(options)'),
    'Missing capturePresetMatrix helper',
);
assert(
    themeSource.includes('downloadPresetMatrix: (label) => this.downloadBaselinePresetMatrix(label)'),
    'Missing downloadPresetMatrix helper',
);
assert(
    themeSource.includes('collectEvidence: (options = {}) => this.collectBaselineEvidence(options)'),
    'Missing collectEvidence helper',
);
assert(
    themeSource.includes('downloadEvidence: (label) => this.downloadBaselineEvidence(label)'),
    'Missing downloadEvidence helper',
);
assert(
    themeSource.includes('getEvidence: () => this.lastBaselineEvidence'),
    'Missing getEvidence helper',
);
assert(themeSource.includes('stop: () => this.clearBaselinePlaybackTimers()'), 'Missing stop helper');
console.log('  PASS');

console.log('\nTest 4: Gameplay event validation and playback orchestration exist');
assert(themeSource.includes("getBaselineSequence(name = 'default')"), 'Missing getBaselineSequence helper');
assert(
    themeSource.includes("playBaselineSequence(name = 'default', options = {})"),
    'Missing playBaselineSequence helper',
);
assert(
    themeSource.includes('runBaselineEventValidation(options = {})'),
    'Missing runBaselineEventValidation helper',
);
assert(
    themeSource.includes('validatePipelineHealth(options = {})'),
    'Missing validatePipelineHealth helper',
);
assert(
    themeSource.includes('validateMrtIsolation(options = {})'),
    'Missing validateMrtIsolation helper',
);
assert(
    themeSource.includes('validateSnowComputeCapacity(options = {})'),
    'Missing validateSnowComputeCapacity helper',
);
assert(
    themeSource.includes('eventBus.emit(check.event, { ...check.payload });'),
    'Event validation does not emit gameplay events',
);
console.log('  PASS');

console.log('\nTest 5: Baseline event counters are updated by gameplay handlers');
assert(themeSource.includes('this.baselineEventCounts.lineClear += 1;'), 'LINE_CLEAR counter not incremented');
assert(themeSource.includes('this.baselineEventCounts.combo += 1;'), 'COMBO counter not incremented');
assert(themeSource.includes('this.baselineEventCounts.pieceLock += 1;'), 'PIECE_LOCK counter not incremented');
assert(
    themeSource.includes('this.trackBaselineFrame(rawDelta);'),
    'Animation loop does not track baseline frames',
);
console.log('  PASS');

console.log('\nTest 6: Baseline preset matrix automation helpers exist');
assert(
    themeSource.includes(
        "const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];",
    ),
    'Missing baseline preset order',
);
assert(themeSource.includes('getBaselinePresetOrder()'), 'Missing getBaselinePresetOrder helper');
assert(themeSource.includes('waitForQualityPreset(level, options = {})'), 'Missing waitForQualityPreset helper');
assert(themeSource.includes('setBaselineQuality(level, options = {})'), 'Missing setBaselineQuality helper');
assert(themeSource.includes('captureBaselinePresetMatrix(options = {})'), 'Missing captureBaselinePresetMatrix helper');
assert(
    themeSource.includes('downloadBaselinePresetMatrix(label = \'ice-temple-baseline-matrix\')'),
    'Missing downloadBaselinePresetMatrix helper',
);
assert(themeSource.includes('getBaselineShaderInventory()'), 'Missing getBaselineShaderInventory helper');
assert(themeSource.includes('collectBaselineMaterialInventory()'), 'Missing collectBaselineMaterialInventory helper');
assert(themeSource.includes('collectBaselineEvidence(options = {})'), 'Missing collectBaselineEvidence helper');
assert(
    themeSource.includes('downloadBaselineEvidence(label = \'ice-temple-phase0-evidence\')'),
    'Missing downloadBaselineEvidence helper',
);
assert(themeSource.includes('buildBaselineEvidenceMarkdown(evidence)'), 'Missing buildBaselineEvidenceMarkdown helper');
assert(
    themeSource.includes('buildBaselinePresetMatrixMarkdown(matrix)'),
    'Missing buildBaselinePresetMatrixMarkdown helper',
);
console.log('  PASS');

console.log('\nTest 7: Lifecycle cleanup includes baseline helper/timer teardown');
assert(themeSource.includes('this.installBaselineHelpers();'), 'createScene does not install baseline helpers');
assert(themeSource.includes('this.clearBaselinePlaybackTimers();'), 'Missing baseline timeout cleanup');
assert(themeSource.includes('this.removeBaselineHelpers();'), 'Missing baseline helper removal');
assert(themeSource.includes('this.resetBaseline();'), 'Missing baseline reset on lifecycle transitions');
console.log('  PASS');

console.log('\nTest 8: Runtime resilience includes WebGPU device-loss fallback to WebGL');
assert(themeSource.includes('refreshRuntimeFlags()'), 'Missing refreshRuntimeFlags helper');
assert(themeSource.includes('setupRendererResilience()'), 'Missing setupRendererResilience helper');
assert(
    themeSource.includes("requestWebGLFallback(reason = 'runtime-fallback', error = null)"),
    'Missing requestWebGLFallback helper',
);
assert(themeSource.includes('handleDeviceLoss(info)'), 'Missing handleDeviceLoss helper');
assert(
    themeSource.includes('this.renderer.onDeviceLost = (info) => {'),
    'Missing renderer.onDeviceLost hookup',
);
assert(
    themeSource.includes("this.requestWebGLFallback('webgpu-render-failure', error).catch((fallbackError) => {"),
    'Missing render failure fallback trigger',
);
assert(
    themeSource.includes('this.flags.forceWebGL = true;'),
    'Runtime fallback does not force WebGL',
);
console.log('  PASS');

console.log('\nTest 9: Phase 7 volumetric aurora enhancement is gated by flags and preset policy');
assert(
    themeSource.includes('noEnhancements: readBool(\'iceTempleNoEnhancements\')'),
    'Missing iceTempleNoEnhancements flag parsing',
);
assert(
    themeSource.includes('noAuroraVolume: readBool(\'iceTempleNoAuroraVolume\')'),
    'Missing iceTempleNoAuroraVolume flag parsing',
);
assert(
    themeSource.includes('shouldUseVolumetricAurora()'),
    'Missing shouldUseVolumetricAurora helper',
);
assert(
    themeSource.includes('auroraLayers: 3'),
    'Missing high-tier aurora layer preset policy',
);
assert(
    themeSource.includes('const layerCount = this.shouldUseVolumetricAurora() ?')
        && themeSource.includes('(this.qualityPreset.auroraLayers ?? 2) : 1;'),
    'Aurora layering is not policy-driven',
);
assert(
    themeSource.includes('aurora.userData.auroraTimeOffset = timeOffset;'),
    'Aurora layer time offset metadata missing',
);
assert(
    themeSource.includes('aurora.userData.auroraIntensityScale = intensityScale;'),
    'Aurora layer intensity metadata missing',
);
console.log('  PASS');

console.log('\nTest 10: MRT tagging exists for non-node scene materials');
assert(
    themeSource.includes('tagMaterialForMrt(material, role, emitsBloom)'),
    'Missing tagMaterialForMrt helper',
);
assert(
    themeSource.includes("this.tagMaterialForMrt(material, 'frost-floor', false);"),
    'Frost floor MRT role tag missing',
);
assert(
    themeSource.includes("this.tagMaterialForMrt(crackMaterial, 'floor-crack', true);"),
    'Crack overlay MRT role tag missing',
);
assert(
    themeSource.includes("this.tagMaterialForMrt(shardMaterial, 'pillar-shard', true);")
        || themeSource.includes("this.tagMaterialForMrt(mat, 'pillar-shard', true);"),
    'Pillar shard MRT role tag missing',
);
assert(
    themeSource.includes("this.tagMaterialForMrt(material, 'pillar-core', true);"),
    'Pillar core MRT role tag missing',
);
assert(
    themeSource.includes("this.tagMaterialForMrt(spriteMaterial, 'pillar-glow', true);"),
    'Pillar glow MRT role tag missing',
);
console.log('  PASS');

console.log('\nTest 11: Evidence bundle includes automated validation outputs');
assert(
    themeSource.includes('includeValidation = true'),
    'collectBaselineEvidence missing includeValidation option',
);
assert(
    themeSource.includes('validationOptions = {}'),
    'collectBaselineEvidence missing validationOptions option',
);
assert(
    themeSource.includes('validation.pipeline = await this.validatePipelineHealth(validationOptions.pipeline || {});'),
    'Evidence pipeline validation missing',
);
assert(
    themeSource.includes('validation.mrt = this.validateMrtIsolation(validationOptions.mrt || {});'),
    'Evidence MRT validation missing',
);
assert(
    themeSource.includes('validation.events = await this.runBaselineEventValidation(validationOptions.events || {});'),
    'Evidence event validation missing',
);
assert(
    themeSource.includes('validation.snowCompute = await this.validateSnowComputeCapacity(snowOptions);'),
    'Evidence snow-compute validation missing',
);
assert(
    themeSource.includes('validation.passed = checks.every((check) => check.passed !== false);'),
    'Evidence aggregate validation pass logic missing',
);
assert(
    themeSource.includes("report.reason = 'mrt-disabled';"),
    'MRT validator should mark not-applicable state',
);
assert(
    themeSource.includes("report.reason = 'compute-unavailable';"),
    'Snow compute validator should mark not-applicable state',
);
console.log('  PASS');

console.log('\nTest 12: Success-criteria evaluation is exported and persisted in evidence');
assert(
    themeSource.includes('includeSuccessCriteria = true'),
    'collectBaselineEvidence missing includeSuccessCriteria option',
);
assert(
    themeSource.includes('successCriteriaOptions = {}'),
    'collectBaselineEvidence missing successCriteriaOptions option',
);
assert(
    themeSource.includes('evidence.successCriteria = this.evaluateSuccessCriteria({'),
    'collectBaselineEvidence missing success-criteria evaluation',
);
assert(
    themeSource.includes('counterpartEvidence: successCriteriaOptions.counterpartEvidence || null'),
    'collectBaselineEvidence missing counterpartEvidence wiring',
);
assert(
    themeSource.includes('evaluateCriteria: (options = {}) => this.evaluateSuccessCriteria(options)'),
    'Baseline helper surface missing evaluateCriteria',
);
assert(
    themeSource.includes("lines.push('## Success Criteria Snapshot');"),
    'Evidence markdown missing success criteria snapshot section',
);
console.log('  PASS');

console.log('\n=== All Ice Temple Phase 8 Instrumentation Tests Passed ===');
