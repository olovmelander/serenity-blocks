import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Astral Weave Theme Container Visibility Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseThemePath = path.join(__dirname, '..', '..', 'src', 'themes', 'base-theme.js');
const astralThemePath = path.join(__dirname, '..', '..', 'src', 'themes', 'astral-weave', 'astral-weave-theme.js');

const baseThemeSource = fs.readFileSync(baseThemePath, 'utf8');
const astralThemeSource = fs.readFileSync(astralThemePath, 'utf8');

console.log('Test 1: Astral Weave does not force root container visibility inline');
assert(
    !astralThemeSource.includes("container.style.visibility = 'visible';"),
    'Astral Weave should not force root container visibility inline',
);
assert(
    !astralThemeSource.includes("container.style.opacity = '1';"),
    'Astral Weave should not force root container opacity inline',
);
console.log('  ✓ PASS');

console.log('\nTest 2: BaseTheme.start clears stale inline visibility before re-activating');
assert(
    /themeContainer\.style\.removeProperty\('opacity'\);\s*themeContainer\.style\.removeProperty\('visibility'\);\s*\/\/ Add active class to this theme's container\s*themeContainer\.classList\.add\('active'\);/s
        .test(baseThemeSource),
    'BaseTheme.start should clear inline opacity/visibility before adding the active class',
);
console.log('  ✓ PASS');

console.log('\nTest 3: BaseTheme.stop clears inline visibility after deactivating');
assert(
    /themeContainer\.classList\.remove\('active'\);\s*themeContainer\.style\.removeProperty\('opacity'\);\s*themeContainer\.style\.removeProperty\('visibility'\);/s
        .test(baseThemeSource),
    'BaseTheme.stop should remove inline opacity/visibility after removing the active class',
);
console.log('  ✓ PASS');

console.log('\nAstral Weave theme container visibility checks passed.');
