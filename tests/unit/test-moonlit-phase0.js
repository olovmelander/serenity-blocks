import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 0 Baseline Lock Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-moonlit-phase8.html');
const artDirectionPath = path.join(root, 'docs', 'MOONLIT_FOREST_ART_DIRECTION.md');
const protocolPath = path.join(root, 'docs', 'MOONLIT_FOREST_BASELINE_CAPTURE_PROTOCOL.md');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');
const artDirectionSource = fs.readFileSync(artDirectionPath, 'utf8');
const protocolSource = fs.readFileSync(protocolPath, 'utf8');

console.log('Test 1: Art direction packet includes locked hero frame spec');
assert(artDirectionSource.includes('## Hero Frame'), 'Missing hero frame section in art direction packet');
assert(artDirectionSource.includes('### Locked Camera Spec (Implementation Target)'), 'Missing locked camera spec section');
assert(artDirectionSource.includes('fov ~= 58'), 'Missing hero camera FOV target');
assert(artDirectionSource.includes('Look target: `(0, 20, -700)`'), 'Missing hero look target');
assert(artDirectionSource.includes('Moon corridor target'), 'Missing moon corridor target spec');
console.log('  ✓ PASS');

console.log('\nTest 2: Theme exposes Phase 0 baseline sweep/anchor/checklist helpers');
assert(themeSource.includes('runHeroFrameChecklist(options = {})'), 'Missing runHeroFrameChecklist helper');
assert(themeSource.includes('captureBaselineEventAnchors(options = {})'), 'Missing captureBaselineEventAnchors helper');
assert(themeSource.includes('runBaselinePresetSweep(options = {})'), 'Missing runBaselinePresetSweep helper');
assert(
    themeSource.includes('validateHeroFrame: (options = {}) => this.runHeroFrameChecklist(options)'),
    'Missing validateHeroFrame helper export',
);
assert(
    themeSource.includes('captureEventAnchors: (options = {}) => this.captureBaselineEventAnchors(options)'),
    'Missing captureEventAnchors helper export',
);
assert(
    themeSource.includes('runPresetSweep: (options = {}) => this.runBaselinePresetSweep(options)'),
    'Missing runPresetSweep helper export',
);
assert(themeSource.includes('this.lastBaselinePresetSweep = null;'), 'Missing preset sweep baseline state');
assert(themeSource.includes('this.lastBaselineAnchorPack = null;'), 'Missing anchor baseline state');
assert(themeSource.includes('this.lastBaselineHeroFrameReport = null;'), 'Missing hero baseline state');
console.log('  ✓ PASS');

console.log('\nTest 3: Harness exposes Phase 0 controls for hero/anchors/preset sweep');
assert(harnessSource.includes('Validate Hero Frame Checklist'), 'Harness missing hero checklist control');
assert(harnessSource.includes('Capture Event Anchors'), 'Harness missing event anchor control');
assert(harnessSource.includes('Run Preset Sweep (Minimal..Extreme)'), 'Harness missing preset sweep control');
assert(harnessSource.includes("window.moonlitBaseline.validateHeroFrame()"), 'Missing hero helper command snippet');
assert(harnessSource.includes("window.moonlitBaseline.captureEventAnchors"), 'Missing anchor helper command snippet');
assert(harnessSource.includes("window.moonlitBaseline.runPresetSweep"), 'Missing preset sweep helper command snippet');
console.log('  ✓ PASS');

console.log('\nTest 4: Baseline protocol runbook exists and references harness outputs');
assert(protocolSource.includes('Moonlit Forest Baseline Capture Protocol'), 'Missing protocol title');
assert(protocolSource.includes('benchmark-moonlit-phase8.html'), 'Protocol missing harness reference');
assert(protocolSource.includes('Run Preset Sweep (Minimal..Extreme)'), 'Protocol missing preset sweep procedure');
assert(protocolSource.includes('Capture Event Anchors'), 'Protocol missing anchor capture procedure');
assert(protocolSource.includes('Run WebGPU + WebGL Campaign'), 'Protocol missing dual campaign step');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 0 Tests Passed ===');
