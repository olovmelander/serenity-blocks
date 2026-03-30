import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 0 Baseline Lock Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase0.html');
const artDirectionPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');
const protocolPath = path.join(root, 'docs', 'NIMBUS_VEIL_BASELINE_CAPTURE_PROTOCOL.md');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');
const artDirectionSource = fs.readFileSync(artDirectionPath, 'utf8');
const protocolSource = fs.readFileSync(protocolPath, 'utf8');

console.log('Test 1: Deterministic Phase 0 flags are parsed');
assert(themeSource.includes('function parseNimbusFlags()'), 'Missing parseNimbusFlags helper');
assert(themeSource.includes("forceWebGL: readBool('forceWebGL')"), 'Missing forceWebGL flag parsing');
assert(themeSource.includes("baseline: readBool('nimbusBaseline')"), 'Missing nimbusBaseline flag parsing');
assert(themeSource.includes("const seed = readNumber('nimbusSeed')"), 'Missing nimbusSeed parsing');
assert(themeSource.includes("const fixedDtMs = readNumber('nimbusFixedDt')"), 'Missing nimbusFixedDt parsing');
assert(themeSource.includes("const playback = readString('nimbusPlayback');"), 'Missing nimbusPlayback parsing');
assert(
    themeSource.includes("const playbackLoopsRaw = readNumber('nimbusPlaybackLoops');"),
    'Missing nimbusPlaybackLoops parsing',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Seeded random + fixed-delta animation hooks exist');
assert(themeSource.includes('function createSeededRandom(seed)'), 'Missing createSeededRandom helper');
assert(
    themeSource.includes('this.randomFn = createSeededRandom(this.flags.seed);'),
    'Missing seeded random assignment',
);
assert(
    themeSource.includes('this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;'),
    'Missing fixed delta seconds setup',
);
assert(themeSource.includes('const measuredDelta = this.clock.getDelta();'), 'Missing measured delta sample');
assert(
    themeSource.includes('const delta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : measuredDelta;'),
    'Missing fixed-delta branch',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Baseline instrumentation and helper APIs are exposed');
assert(themeSource.includes('trackBaselineFrame(deltaSeconds)'), 'Missing baseline frame tracker');
assert(themeSource.includes('reportBaseline()'), 'Missing baseline report helper');
assert(themeSource.includes('resetDeterministicSimulationState(options = {})'), 'Missing deterministic reset helper');
assert(themeSource.includes('captureBaselinePack(options = {})'), 'Missing capture pack helper');
assert(themeSource.includes('captureReadabilityAnchors(options = {})'), 'Missing readability capture helper');
assert(themeSource.includes('window.nimbusBaseline = {'), 'Missing global nimbus baseline helper API');
assert(
    themeSource.includes('if (this.flags.baseline || this.flags.debugLogs) {'),
    'Baseline helpers should only be installed in diagnostic modes',
);
assert(
    themeSource.includes('this.resetDeterministicSimulationState({ resetRandom: true });'),
    'Capture flows must reset deterministic simulation state',
);
assert(
    themeSource.includes('capturePack: (options = {}) => this.captureBaselinePack(options)'),
    'Missing capturePack helper export',
);
assert(
    themeSource.includes('captureReadability: (options = {}) => this.captureReadabilityAnchors(options)'),
    'Missing captureReadability helper export',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Timer tracking and resize-listener lifecycle hardening are present');
assert(themeSource.includes('this.activeTimers = new Set();'), 'Missing activeTimers state');
assert(
    themeSource.includes('scheduleThemeTimeout(callback, delayMs, trackingSet = null)'),
    'Missing tracked timeout helper',
);
assert(themeSource.includes('clearThemeTimeouts()'), 'Missing timeout cleanup helper');
assert(
    themeSource.includes('window.addEventListener(\'resize\', this.boundResizeHandler);'),
    'Resize listener is not using stable handler',
);
assert(
    themeSource.includes('window.removeEventListener(\'resize\', this.boundResizeHandler);'),
    'Resize listener cleanup is not using stable handler',
);
const setTimeoutMatches = themeSource.match(/setTimeout\s*\(/g) || [];
assert(setTimeoutMatches.length === 1, 'Raw setTimeout should only exist in scheduleThemeTimeout');
console.log('  ✓ PASS');

console.log('\nTest 5: Art packet includes composition locks and deterministic review flags');
assert(artDirectionSource.includes('Nimbus Veil Art Direction Packet'), 'Missing art packet title');
assert(artDirectionSource.includes('## Composition Locks'), 'Missing composition lock section');
assert(artDirectionSource.includes('nimbusBaseline=1'), 'Art packet missing deterministic baseline flag');
assert(artDirectionSource.includes('window.nimbusBaseline.capturePack'), 'Art packet missing helper command reference');
console.log('  ✓ PASS');

console.log('\nTest 6: Baseline protocol references harness and matrix workflow');
assert(protocolSource.includes('Nimbus Veil Baseline Capture Protocol'), 'Missing protocol title');
assert(protocolSource.includes('benchmark-nimbus-veil-phase0.html'), 'Protocol missing harness reference');
assert(protocolSource.includes('nimbusSeed=1234'), 'Protocol missing seed flag');
assert(protocolSource.includes('nimbusFixedDt=16.666'), 'Protocol missing fixed dt flag');
assert(protocolSource.includes('forceWebGL=1'), 'Protocol missing forceWebGL parity flag');
assert(
    protocolSource.includes('Nimbus is still WebGL-only at this stage.'),
    'Protocol missing pre-WebGPU runtime note',
);
console.log('  ✓ PASS');

console.log('\nTest 7: Harness wires deterministic flags and helper controls');
assert(harnessSource.includes('Nimbus Veil Phase 0 Baseline Harness'), 'Harness title is missing Nimbus naming');
assert(
    harnessSource.includes('nimbusBaseline=1&nimbusSeed=1234&nimbusFixedDt=16.666'),
    'Harness missing baseline query flags',
);
assert(harnessSource.includes('Load Runtime + forceWebGL Flag'), 'Harness missing explicit forceWebGL label');
assert(harnessSource.includes('window.nimbusBaseline.play(\'default\''), 'Harness missing baseline play command');
assert(harnessSource.includes('window.nimbusBaseline.capturePack'), 'Harness missing capturePack command');
assert(
    harnessSource.includes('window.nimbusBaseline.captureReadability'),
    'Harness missing captureReadability command',
);
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 0 Tests Passed ===');
