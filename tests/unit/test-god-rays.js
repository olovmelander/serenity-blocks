import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const cssPath = path.join(repoRoot, 'public/styles/main.css');
const scriptPath = path.join(repoRoot, 'src/themes/sunset/sunset-theme.js');

const cssCode = fs.readFileSync(cssPath, 'utf8');
const scriptCode = fs.readFileSync(scriptPath, 'utf8');

console.log('=== Serenity Blocks – Sunset God Rays Alignment Test ===\n');
console.log(`CSS source: ${path.relative(repoRoot, cssPath)}`);
console.log(`Theme source: ${path.relative(repoRoot, scriptPath)}\n`);

function ensure(condition, successMsg, failureMsg) {
    if (condition) {
        console.log(`  ✓ PASS: ${successMsg}`);
    } else {
        console.error(`  ✗ FAIL: ${failureMsg}`);
        process.exit(1);
    }
}

// Helper to extract selector blocks for focused checks
function extractBlock(selector) {
    const pattern = new RegExp(`${selector}[\\s\\S]*?}`, 'm');
    const match = cssCode.match(pattern);
    return match ? match[0] : '';
}

const godRayContainerBlock = extractBlock('\\.sunset-god-rays');
const godRayBlock = extractBlock('\\.sunset-god-ray(?!s)');

// Test 1: Verify god rays container CSS exists
console.log('Test 1: God rays container CSS exists');
ensure(
    godRayContainerBlock.includes('animation: sunset-ray-rotation'),
    '.sunset-god-rays animation defined',
    'Missing .sunset-god-rays animation block',
);

// Test 2: Verify individual god ray CSS exists
console.log('\nTest 2: Individual god ray CSS exists');
ensure(
    godRayBlock.includes('background: linear-gradient'),
    '.sunset-god-ray gradient defined',
    'Missing .sunset-god-ray gradient definition',
);

// Test 3: Verify animation keyframes exist
console.log('\nTest 3: God ray animation keyframes exist');
ensure(
    cssCode.includes('@keyframes sunset-ray-rotation')
        && cssCode.includes('rotate(-8deg)')
        && cssCode.includes('rotate(8deg)'),
    'sunset-ray-rotation keyframes present',
    'Missing sunset-ray-rotation keyframes',
);

// Test 4: Verify GPU acceleration hints
console.log('\nTest 4: GPU acceleration optimization');
ensure(
    godRayBlock.includes('will-change: transform')
        || godRayBlock.includes('will-change: transform, opacity'),
    '.sunset-god-ray flagged for GPU acceleration',
    'God rays should set will-change for GPU acceleration',
);

// Test 5: Verify transparency gradient
console.log('\nTest 5: Transparency optimization');
ensure(
    /rgba\(\d+,\s*\d+,\s*\d+,\s*0\.\d+/.test(godRayBlock),
    'God rays use rgba transparency',
    'God rays should use rgba colors for smooth falloff',
);

// Test 6: Verify JavaScript creates god rays correctly
console.log('\nTest 6: JavaScript god ray generation');
ensure(
    scriptCode.includes('sunset-god-rays')
        && scriptCode.includes('sunset-god-ray')
        && /for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*30/.test(scriptCode),
    'Sunset theme still creates 30 god ray elements',
    'Sunset theme no longer creates expected god rays',
);

// Test 7: Verify parent animation approach
console.log('\nTest 7: Animation efficiency');
ensure(
    godRayContainerBlock.includes('animation: sunset-ray-rotation'),
    'Parent container handles rotation animation',
    'Parent container should animate rotation to avoid 30 animations',
);

// Test 8: Verify z-index and pointer events for layering
console.log('\nTest 8: Theme layering & interaction');
ensure(
    godRayContainerBlock.includes('z-index: 2')
        && godRayContainerBlock.includes('pointer-events: none'),
    'God rays layered above mountains without intercepting events',
    'God rays should define z-index and pointer-events',
);

// Test 9: Verify container centering
console.log('\nTest 9: Container alignment with sun');
ensure(
    godRayContainerBlock.includes('top: var(--sunset-god-ray-center-y, 50%)')
        && godRayContainerBlock.includes('left: var(--sunset-god-ray-center-x, 50%)'),
    'God ray container centers on CSS variables (sun position)',
    'God ray container does not follow sun center variables',
);

// Test 10: Verify individual rays pivot from the sun\'s center
console.log('\nTest 10: Individual ray origin alignment');
ensure(
    godRayBlock.includes('top: 50%')
        && godRayBlock.includes('left: 50%')
        && godRayBlock.includes('transform: translate(-50%, 0) rotate(var(--ray-angle, 0deg))'),
    'Individual rays translate to the sun center before rotating',
    'Individual rays do not translate to sun center (misalignment risk)',
);

// Test 11: Verify CSS custom properties for ray tuning exist
console.log('\nTest 11: CSS custom properties exposed');
ensure(
    godRayBlock.includes('var(--ray-width')
        && godRayBlock.includes('var(--ray-length')
        && godRayBlock.includes('var(--ray-opacity'),
    'CSS custom properties defined for ray width/length/opacity',
    'Missing CSS custom properties for fine-grained ray styling',
);

// Test 12: Verify JavaScript feeds custom properties for per-ray variance
console.log('\nTest 12: JavaScript sets CSS custom properties for alignment');
ensure(
    scriptCode.includes("setProperty('--ray-angle'")
        && scriptCode.includes("setProperty('--ray-length'")
        && scriptCode.includes("setProperty('--ray-width'")
        && scriptCode.includes("setProperty('--ray-opacity'"),
    'Sunset theme sets CSS variables so rays stay centered while sun moves',
    'Sunset theme must set CSS custom properties for ray alignment',
);

console.log('\n=== All critical god-ray tests passed ===');
console.log('God rays are now centered on the sun and inherit its movement.\n');
