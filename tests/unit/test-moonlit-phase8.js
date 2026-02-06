import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 8 Validation Instrumentation Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const harnessPath = path.join(__dirname, '..', 'performance', 'benchmark-moonlit-phase8.html');
const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Baseline flag parsing includes deterministic playback controls');
assert(
    themeSource.includes("baseline: readBool('moonlitBaseline')"),
    'Missing moonlitBaseline flag parsing',
);
assert(
    themeSource.includes("const seed = readNumber('moonlitSeed') ?? readNumber('seed');"),
    'Missing moonlitSeed parsing',
);
assert(
    themeSource.includes("const fixedDtMs = readNumber('moonlitFixedDt') ?? readNumber('fixedDt');"),
    'Missing moonlitFixedDt parsing',
);
assert(
    themeSource.includes("const playbackRaw = readString('moonlitPlayback');"),
    'Missing moonlitPlayback parsing',
);
assert(
    themeSource.includes("const playbackLoopsRaw = readNumber('moonlitPlaybackLoops');"),
    'Missing moonlitPlaybackLoops parsing',
);
assert(
    themeSource.includes("debugLogs: readBool('moonlitDebug')"),
    'Missing moonlitDebug log gate parsing',
);
assert(
    themeSource.includes('playback: playbackSequence,'),
    'Missing playback sequence wiring in parsed flags',
);
assert(
    themeSource.includes('playbackLoops,'),
    'Missing playback loop wiring in parsed flags',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Baseline metrics/report helpers are implemented');
assert(themeSource.includes('trackBaselineFrame(deltaSeconds)'), 'Missing trackBaselineFrame helper');
assert(themeSource.includes('computeBaselineReport()'), 'Missing computeBaselineReport helper');
assert(themeSource.includes('reportBaseline()'), 'Missing reportBaseline helper');
assert(themeSource.includes('shouldLogDiagnostics()'), 'Missing diagnostic log gate helper');
assert(themeSource.includes('debugLog(...args)'), 'Missing debugLog helper');
assert(themeSource.includes('avgDrawCalls'), 'Missing avgDrawCalls report field');
assert(themeSource.includes('low1Fps'), 'Missing low1Fps report field');
assert(themeSource.includes('frameTimeStdDevMs'), 'Missing frameTimeStdDevMs report field');
assert(themeSource.includes('frameTimeVarianceMs2'), 'Missing frameTimeVarianceMs2 report field');
assert(themeSource.includes('gpuMemoryEstimateMb'), 'Missing gpuMemoryEstimateMb report field');
assert(
    themeSource.includes('eventCounts: { ...this.baselineEventCounts }'),
    'Missing eventCounts in baseline report',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Phase 8 helper API is exposed on window for automation');
assert(themeSource.includes('window.moonlitBaseline = {'), 'Missing window.moonlitBaseline helper exposure');
assert(themeSource.includes('capture: (label) => this.captureBaseline(label)'), 'Missing capture helper');
assert(themeSource.includes('report: () => this.reportBaseline()'), 'Missing report helper');
assert(themeSource.includes('reset: () => this.resetBaseline()'), 'Missing reset helper');
assert(
    themeSource.includes("play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options)"),
    'Missing play helper',
);
assert(
    themeSource.includes('validateEvents: (options = {}) => this.runBaselineEventValidation(options)'),
    'Missing validateEvents helper',
);
assert(
    themeSource.includes('validateHeroFrame: (options = {}) => this.runHeroFrameChecklist(options)'),
    'Missing validateHeroFrame helper',
);
assert(
    themeSource.includes("getSequenceDuration: (sequence = 'default', loops = 1, stepMs = 260) =>"),
    'Missing getSequenceDuration helper',
);
assert(themeSource.includes('getPresetOrder: () => this.getBaselinePresetOrder()'), 'Missing getPresetOrder helper');
assert(themeSource.includes('setQuality: (level, options = {}) => this.setBaselineQuality(level, options)'), 'Missing setQuality helper');
assert(themeSource.includes('waitForQuality: (level, options = {}) => this.waitForQualityPreset(level, options)'), 'Missing waitForQuality helper');
assert(
    themeSource.includes('runResizeStress: (options = {}) => this.runBaselineResizeStress(options)'),
    'Missing runResizeStress helper',
);
assert(
    themeSource.includes('runSoak: (options = {}) => this.runBaselineSoak(options)'),
    'Missing runSoak helper',
);
assert(
    themeSource.includes('runSoakCampaign: (options = {}) => this.runBaselineSoakCampaign(options)'),
    'Missing runSoakCampaign helper',
);
assert(
    themeSource.includes('captureEventAnchors: (options = {}) => this.captureBaselineEventAnchors(options)'),
    'Missing captureEventAnchors helper',
);
assert(
    themeSource.includes('runPresetSweep: (options = {}) => this.runBaselinePresetSweep(options)'),
    'Missing runPresetSweep helper',
);
assert(
    themeSource.includes('getTetrominoSnapshot: () => this.buildTetrominoSnapshot(this.getTetrominoConfig())'),
    'Missing getTetrominoSnapshot helper',
);
assert(
    themeSource.includes('validateTetrominoStyling: (options = {}) => this.validateTetrominoStyling(options)'),
    'Missing validateTetrominoStyling helper',
);
assert(
    themeSource.includes('collectEvidence: (options = {}) => this.collectBaselineEvidence(options)'),
    'Missing collectEvidence helper',
);
assert(themeSource.includes('getHeroFrameReport: () => this.lastBaselineHeroFrameReport'), 'Missing getHeroFrameReport helper');
assert(themeSource.includes('getAnchorReport: () => this.lastBaselineAnchorPack'), 'Missing getAnchorReport helper');
assert(themeSource.includes('getPresetSweep: () => this.lastBaselinePresetSweep'), 'Missing getPresetSweep helper');
assert(themeSource.includes('getEvidence: () => this.lastBaselineEvidence'), 'Missing getEvidence helper');
assert(themeSource.includes('getSoakCampaign: () => this.lastBaselineSoakCampaign'), 'Missing getSoakCampaign helper');
assert(themeSource.includes('stop: () => this.clearBaselinePlaybackTimers()'), 'Missing stop helper');
console.log('  ✓ PASS');

console.log('\nTest 4: Validation/stress orchestration methods exist and emit gameplay events');
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
    themeSource.includes('runBaselineResizeStress(options = {})'),
    'Missing runBaselineResizeStress helper',
);
assert(themeSource.includes('runBaselineSoak(options = {})'), 'Missing runBaselineSoak helper');
assert(themeSource.includes('runBaselineSoakCampaign(options = {})'), 'Missing runBaselineSoakCampaign helper');
assert(themeSource.includes('runHeroFrameChecklist(options = {})'), 'Missing runHeroFrameChecklist helper');
assert(themeSource.includes('captureBaselineEventAnchors(options = {})'), 'Missing captureBaselineEventAnchors helper');
assert(themeSource.includes('runBaselinePresetSweep(options = {})'), 'Missing runBaselinePresetSweep helper');
assert(themeSource.includes('buildTetrominoSnapshot(config = this.getTetrominoConfig())'), 'Missing buildTetrominoSnapshot helper');
assert(themeSource.includes('validateTetrominoStyling(options = {})'), 'Missing validateTetrominoStyling helper');
assert(themeSource.includes('collectBaselineEvidence(options = {})'), 'Missing collectBaselineEvidence helper');
assert(themeSource.includes('getBaselinePresetOrder()'), 'Missing getBaselinePresetOrder helper');
assert(themeSource.includes('waitForQualityPreset(level, options = {})'), 'Missing waitForQualityPreset helper');
assert(themeSource.includes('setBaselineQuality(level, options = {})'), 'Missing setBaselineQuality helper');
assert(themeSource.includes('eventBus.emit(step.event, payload);'), 'Playback sequence does not emit gameplay events');
assert(themeSource.includes('eventBus.emit(check.event, { ...check.payload });'), 'Validation does not emit gameplay events');
assert(themeSource.includes('if (this.flags.playback) {'), 'Missing playback auto-start wiring in createScene');
console.log('  ✓ PASS');

console.log('\nTest 5: Frame loop and gameplay handlers update baseline counters');
assert(themeSource.includes('if (this.flags.baseline) {\n                this.trackBaselineFrame(delta);'), 'Render loop does not track baseline frame metrics');
assert(themeSource.includes('this.baselineEventCounts.lineClear += 1;'), 'LINE_CLEAR baseline counter not incremented');
assert(themeSource.includes('this.baselineEventCounts.combo += 1;'), 'COMBO baseline counter not incremented');
assert(themeSource.includes('this.baselineEventCounts.pieceLock += 1;'), 'PIECE_LOCK baseline counter not incremented');
assert(themeSource.includes('this.installBaselineHelpers();'), 'createScene does not install baseline helpers');
assert(themeSource.includes('this.clearBaselinePlaybackTimers();'), 'Missing baseline playback timer cleanup');
assert(themeSource.includes('this.removeBaselineHelpers();'), 'Missing baseline helper teardown');
console.log('  ✓ PASS');

console.log('\nTest 6: Phase 8 browser harness exists for soak and stress campaigns');
assert(
    harnessSource.includes('Moonlit Forest Phase 8 Validation Harness'),
    'Missing Moonlit Phase 8 harness title',
);
assert(
    harnessSource.includes('Run Theme Switch Stress'),
    'Harness missing theme-switch stress control',
);
assert(
    harnessSource.includes('Run Resize Stress'),
    'Harness missing resize stress control',
);
assert(
    harnessSource.includes('Run M/H/U Campaign'),
    'Harness missing Medium/High/Ultra campaign control',
);
assert(
    harnessSource.includes('Validate Tetromino Styling'),
    'Harness missing tetromino validation control',
);
assert(
    harnessSource.includes('Validate Hero Frame Checklist'),
    'Harness missing hero frame validation control',
);
assert(
    harnessSource.includes('Capture Event Anchors'),
    'Harness missing event anchor control',
);
assert(
    harnessSource.includes('Run Preset Sweep (Minimal..Extreme)'),
    'Harness missing preset sweep control',
);
assert(
    harnessSource.includes('Run Evidence Bundle'),
    'Harness missing evidence bundle control',
);
assert(
    harnessSource.includes('Run WebGPU + WebGL Campaign'),
    'Harness missing dual backend campaign control',
);
assert(
    harnessSource.includes('window.moonlitBaseline.runSoakCampaign'),
    'Harness missing soak campaign command documentation',
);
assert(
    harnessSource.includes('window.moonlitBaseline.validateHeroFrame'),
    'Harness missing hero frame command documentation',
);
assert(
    harnessSource.includes('window.moonlitBaseline.captureEventAnchors'),
    'Harness missing event anchor command documentation',
);
assert(
    harnessSource.includes('window.moonlitBaseline.runPresetSweep'),
    'Harness missing preset sweep command documentation',
);
assert(
    harnessSource.includes('window.moonlitBaseline.collectEvidence'),
    'Harness missing evidence command documentation',
);
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 8 Tests Passed ===');
