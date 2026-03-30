import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Serenity Hub Integration Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const registryPath = path.join(root, 'src', 'themes', 'theme-registry.js');
const aliasThemePath = path.join(root, 'src', 'themes', 'sky-children-v2', 'sky-children-alias-theme.js');
const v2ThemePath = path.join(root, 'src', 'themes', 'sky-children-v2', 'sky-children-v2-theme.js');
const v2TetrominoPath = path.join(root, 'src', 'themes', 'sky-children-v2', 'sky-children-v2-tetrominos.js');
const indexPath = path.join(root, 'index.html');
const themesTabPath = path.join(root, 'src', 'ui', 'serenity-hub', 'ThemesTab.js');

const registrySource = fs.readFileSync(registryPath, 'utf8');
const aliasThemeSource = fs.readFileSync(aliasThemePath, 'utf8');
const v2ThemeSource = fs.readFileSync(v2ThemePath, 'utf8');
const v2TetrominoSource = fs.readFileSync(v2TetrominoPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const themesTabSource = fs.readFileSync(themesTabPath, 'utf8');

console.log('Test 1: Theme is registered for Serenity Hub and ThemeManager lazy loading');
assert(
    registrySource.includes("id: 'sky-children'"),
    'theme-registry is missing sky-children id',
);
assert(
    registrySource.includes("displayName: 'Sky Children'"),
    'theme-registry is missing Sky Children display name',
);
assert(
    registrySource.includes("module: './sky-children-v2/sky-children-alias-theme.js'"),
    'theme-registry should map sky-children to sky-children-v2 alias module',
);
assert(
    registrySource.includes("group: 'sky'"),
    'theme-registry should categorize sky-children in sky group',
);
assert(
    registrySource.includes("id: 'sky-children-v2'"),
    'theme-registry is missing sky-children-v2 id',
);
assert(
    registrySource.includes("module: './sky-children-v2/sky-children-v2-theme.js'"),
    'theme-registry is missing sky-children-v2 module path',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Alias + v2 implementation expose sky-children and v2 runtime');
assert(aliasThemeSource.includes("super('sky-children')"), 'Alias should use sky-children identity');
assert(v2ThemeSource.includes("constructor(themeName = 'sky-children-v2')"), 'V2 should default to sky-children-v2 id');
assert(v2ThemeSource.includes('getTetrominoConfig()'), 'V2 should expose tetromino config');
assert(
    v2ThemeSource.includes('return SKY_CHILDREN_V2_TETROMINOS;'),
    'V2 should return Sky Children v2 tetromino config',
);
assert(
    v2ThemeSource.includes('window.skyChildrenV2 = {'),
    'V2 should install skyChildrenV2 debug helpers',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Index has dedicated containers for alias and v2');
assert(
    indexSource.includes('id="sky-children-theme" class="theme-container"'),
    'index.html is missing sky-children theme container',
);
assert(
    indexSource.includes('id="sky-children-v2-theme" class="theme-container"'),
    'index.html is missing sky-children-v2 theme container',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Hub card emoji fallback is wired for both display names');
assert(
    themesTabSource.includes("'Sky Children': '☁️'"),
    'ThemesTab fallback icon map is missing Sky Children',
);
assert(
    themesTabSource.includes("'Sky Children v2': '🌤️'"),
    'ThemesTab fallback icon map is missing Sky Children v2',
);
console.log('  ✓ PASS');

console.log('\nTest 5: V2 tetromino configuration exists and exports a config');
assert(
    v2TetrominoSource.includes('export const SKY_CHILDREN_V2_TETROMINOS'),
    'Missing SKY_CHILDREN_V2_TETROMINOS export',
);
assert(
    v2TetrominoSource.includes('renderMode: \'glow\''),
    'Sky v2 tetromino config should define renderMode',
);
console.log('  ✓ PASS');

console.log('\n=== Sky Children Serenity Hub Integration Tests Passed ===');
