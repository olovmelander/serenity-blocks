import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 3 GPU World Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Forest geometry includes new GPU world systems');
assert(themeSource.includes('createForestUndergrowth()'), 'Missing createForestUndergrowth');
assert(themeSource.includes('createFramingSilhouettes()'), 'Missing createFramingSilhouettes');
assert(themeSource.includes('createFogBasin()'), 'Missing createFogBasin');
console.log('  ✓ PASS');

console.log('\nTest 2: Forest geometry build calls undergrowth/framing/fog basin');
assert(themeSource.includes('this.createForestUndergrowth();'), 'Forest build does not add undergrowth');
assert(themeSource.includes('this.createFramingSilhouettes();'), 'Forest build does not add framing silhouettes');
assert(themeSource.includes('this.createFogBasin();'), 'Forest build does not add fog basin');
console.log('  ✓ PASS');

console.log('\nTest 3: Runtime update loop animates new world systems');
assert(themeSource.includes('this.forestUndergrowthLayers.forEach((layer) => {'), 'Undergrowth runtime animation missing');
assert(themeSource.includes('this.forestFramingSilhouettes.forEach((silhouette) => {'), 'Framing silhouette animation missing');
assert(themeSource.includes('this.fogBasinLayers.forEach((layer) => {'), 'Fog basin animation missing');
console.log('  ✓ PASS');

console.log('\nTest 4: Constructor and cleanup track new runtime arrays');
assert(themeSource.includes('this.forestUndergrowthLayers = [];'), 'Undergrowth runtime array not tracked');
assert(themeSource.includes('this.forestFramingSilhouettes = [];'), 'Framing silhouette runtime array not tracked');
assert(themeSource.includes('this.fogBasinLayers = [];'), 'Fog basin runtime array not tracked');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 3 Tests Passed ===');
