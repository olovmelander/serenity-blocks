import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 2 Event Pipeline Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const fxControllerPath = path.join(__dirname, '..', '..', 'src', 'themes', 'moonlit-forest', 'moonlit-forest-fx-controller.js');

const themeSource = fs.readFileSync(themePath, 'utf8');
const fxSource = fs.readFileSync(fxControllerPath, 'utf8');

console.log('Test 1: FX controller has queued burst pipeline state');
assert(fxSource.includes('this.pendingBursts = {'), 'Missing pending burst queue state');
assert(fxSource.includes('queueBurst(name, amount)'), 'Missing burst queue helper');
assert(fxSource.includes('drainParticleBursts()'), 'Missing queue drain helper');
console.log('  ✓ PASS');

console.log('\nTest 2: FX controller exposes envelope channels for non-DOM runtime');
assert(fxSource.includes('this.mushroomPulse = 0;'), 'Missing mushroom pulse envelope');
assert(fxSource.includes('this.moonbeamPulse = 0;'), 'Missing moonbeam pulse envelope');
assert(fxSource.includes('this.wildlifePulse = 0;'), 'Missing wildlife pulse envelope');
assert(fxSource.includes('this.atmospherePulse = 0;'), 'Missing atmosphere pulse envelope');
console.log('  ✓ PASS');

console.log('\nTest 3: Theme loop consumes queued GPU bursts every frame');
assert(themeSource.includes('emitQueuedGpuEffects()'), 'Missing queued GPU burst dispatcher');
assert(themeSource.includes('this.emitQueuedGpuEffects();'), 'Animation loop does not consume queued bursts');
assert(themeSource.includes('const bursts = this.fxController.drainParticleBursts();'), 'Burst dispatcher does not drain controller queue');
assert(themeSource.includes('if (!this.particleSystem) return;'), 'Burst dispatcher is missing particle-system guard');
console.log('  ✓ PASS');

console.log('\nTest 4: Event handlers route through FX controller and GPU helpers');
assert(themeSource.includes('const directives = this.fxController.onLineClear(lineCount, this.qualityConfig);'), 'Line clear is not routed through FX controller');
assert(themeSource.includes('const directives = this.fxController.onCombo(comboCount, this.qualityConfig);'), 'Combo is not routed through FX controller');
assert(themeSource.includes('const directives = this.fxController.onPieceLock(this.random(), this.random());'), 'Piece lock is not routed through FX controller');
assert(themeSource.includes('this.brightenMushrooms(directives.mushroomIntensity);'), 'Line clear does not drive mushroom GPU helper');
assert(themeSource.includes('this.createMagicalSparkles(directives.combo);'), 'Combo does not drive sparkle GPU helper');
assert(themeSource.includes('this.createSmallSparkle();'), 'Piece lock does not drive sparkle GPU helper');
console.log('  ✓ PASS');

console.log('\nTest 5: Legacy Moonlit runtime branches are removed');
assert(!themeSource.includes('useLegacyVisualDom'), 'Legacy runtime branch flag still present');
assert(!themeSource.includes('moonlitLegacy'), 'Legacy migration query flag still present');
assert(!themeSource.includes('toggleLegacySkyElements'), 'Legacy sky toggles still present');
assert(!themeSource.includes('document.createElement'), 'DOM element creation still present in Moonlit runtime');
assert(!themeSource.includes('toDataURL'), 'Canvas toDataURL path still present in Moonlit runtime');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 2 Tests Passed ===');
