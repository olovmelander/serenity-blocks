import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 9 Decommission Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const rendererPath = path.join(root, 'src', 'rendering', 'renderer.js');
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'public', 'styles', 'main.css');

const themeSource = fs.readFileSync(themePath, 'utf8');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');

console.log('Test 1: Moonlit runtime has no legacy DOM/canvas generation calls');
assert(!themeSource.includes('document.createElement'), 'Found document.createElement in Moonlit theme runtime');
assert(!themeSource.includes("canvas.getContext('2d')"), 'Found canvas 2D generation path in Moonlit theme runtime');
assert(!themeSource.includes('toDataURL'), 'Found toDataURL path in Moonlit theme runtime');
console.log('  ✓ PASS');

console.log('\nTest 2: Moonlit legacy migration switches are removed');
assert(!themeSource.includes('moonlitLegacy'), 'Found moonlitLegacy migration flag');
assert(!themeSource.includes('useLegacyVisualDom'), 'Found useLegacyVisualDom branch');
assert(!themeSource.includes('toggleLegacySkyElements'), 'Found legacy sky toggle method');
console.log('  ✓ PASS');

console.log('\nTest 3: Moonlit legacy DOM containers are removed from markup/styles');
const legacySelectors = [
    'moonlit-forest-back',
    'moonlit-forest-mid',
    'moonlit-forest-front',
    'glowing-mushrooms',
    'moonbeam-container',
    'moonlit-wildlife',
];

legacySelectors.forEach((selector) => {
    assert(!indexSource.includes(selector), `Found legacy Moonlit selector in index.html: ${selector}`);
    assert(!cssSource.includes(selector), `Found legacy Moonlit selector in main.css: ${selector}`);
});
console.log('  ✓ PASS');

console.log('\nTest 4: Legacy renderer Moonlit branch is removed');
assert(!rendererSource.includes("themeName === 'moonlit-forest'"), 'Found legacy moonlit renderer branch');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 9 Tests Passed ===');
