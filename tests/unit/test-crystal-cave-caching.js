/**
 * Crystal Cave Canvas Caching Optimization Tests
 *
 * This test suite verifies that the Crystal Cave theme implements canvas caching
 * to avoid expensive procedural generation on every theme switch.
 *
 * The optimization adds:
 * 1. Global crystalCaveCache Map for storing generated canvases
 * 2. Seeded random generation for deterministic crystal placement
 * 3. Cache key based on layer properties and dimensions
 * 4. Cache lookup before canvas generation
 * 5. Canvas storage after generation
 */

const fs = require('fs');
const path = require('path');

// Read the script.js file
const scriptPath = path.join(__dirname, '../../script.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Test counters
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
    testsRun++;
    try {
        fn();
        testsPassed++;
        console.log(`✓ ${description}`);
    } catch (error) {
        testsFailed++;
        console.log(`✗ ${description}`);
        console.log(`  Error: ${error.message}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

console.log('=== Crystal Cave Canvas Caching Optimization Tests ===\n');

// Test 1: Cache Map exists
test('crystalCaveCache Map is declared', () => {
    assert(
        /const crystalCaveCache = new Map\(\);/.test(scriptContent),
        'crystalCaveCache Map should be declared'
    );
});

// Test 2: Cache has explanatory comment
test('Cache has explanatory comment', () => {
    assert(
        /\/\/ Cache for Crystal Cave backgrounds to avoid expensive canvas regeneration/.test(scriptContent),
        'Cache declaration should have a clear comment'
    );
});

// Test 3: seededRandom function is available
test('seededRandom function is available', () => {
    assert(
        /function seededRandom\(seed\)/.test(scriptContent),
        'seededRandom function should exist'
    );
});

// Test 4: Crystal layers have seed property
test('Crystal layers have seed property', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?const crystalLayers = \[[^]*?\];/);
    assert(createCrystalCaveMatch, 'createCrystalCaveScene function should exist with crystalLayers');
    const layersContent = createCrystalCaveMatch[0];
    assert(
        /seed:\s*\d+/.test(layersContent),
        'Crystal layers should have seed property'
    );
});

// Test 5: Cache key includes layer properties
test('Cache key includes layer properties', () => {
    const cacheKeyMatch = scriptContent.match(/const cacheKey = [`']crystal-.*[`'];/);
    assert(cacheKeyMatch, 'Cache key should be created');
    const keyLine = cacheKeyMatch[0];
    assert(
        /zIndex/.test(keyLine) || /layer\.zIndex/.test(scriptContent.slice(cacheKeyMatch.index - 100, cacheKeyMatch.index + 200)),
        'Cache key should include zIndex'
    );
    assert(
        /count/.test(keyLine) || /layer\.count/.test(scriptContent.slice(cacheKeyMatch.index - 100, cacheKeyMatch.index + 200)),
        'Cache key should include count'
    );
    assert(
        /height/.test(keyLine) || /layer\.height/.test(scriptContent.slice(cacheKeyMatch.index - 100, cacheKeyMatch.index + 200)),
        'Cache key should include height'
    );
});

// Test 6: Cache is checked before canvas generation
test('Cache is checked before canvas generation', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    assert(createCrystalCaveMatch, 'createCrystalCaveScene function should exist');
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /if\s*\(\s*crystalCaveCache\.has\(cacheKey\)\s*\)/.test(functionContent),
        'Should check cache before generation'
    );
});

// Test 7: Cached canvas is retrieved and used
test('Cached canvas is retrieved and used', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /crystalCaveCache\.get\(cacheKey\)/.test(functionContent),
        'Should retrieve canvas from cache'
    );
    assert(
        /webglRenderer\.addLayer\([^,]+,\s*layer\.zIndex\)/.test(functionContent),
        'Should add cached canvas to WebGL renderer'
    );
});

// Test 8: Seeded random is used instead of Math.random()
test('Seeded random is used instead of Math.random()', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /const rng = seededRandom\(layer\.seed\)/.test(functionContent),
        'Should create seeded random generator'
    );
    assert(
        /rng\(\)/.test(functionContent),
        'Should use rng() for random values'
    );
});

// Test 9: Generated canvas is stored in cache
test('Generated canvas is stored in cache', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /crystalCaveCache\.set\(cacheKey,\s*canvas\)/.test(functionContent),
        'Should store generated canvas in cache'
    );
});

// Test 10: Crystal drawing logic is intact
test('Crystal drawing logic is intact', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /for\s*\([^)]*i\s*<\s*layer\.count/.test(functionContent),
        'Should iterate through crystal count'
    );
    assert(
        /ctx\.beginPath\(\)/.test(functionContent),
        'Should use canvas beginPath'
    );
    assert(
        /ctx\.fill\(\)/.test(functionContent),
        'Should fill crystals'
    );
    assert(
        /ctx\.stroke\(\)/.test(functionContent),
        'Should stroke crystal outlines'
    );
});

// Test 11: WebGL renderer integration is correct
test('WebGL renderer integration is correct', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /if\s*\(\s*webglRenderer\s*\)/.test(functionContent),
        'Should check for webglRenderer'
    );
    assert(
        /webglRenderer\.addLayer/.test(functionContent),
        'Should add layers to webglRenderer'
    );
});

// Test 12: Three crystal layers are configured
test('Three crystal layers are configured', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?const crystalLayers = \[[^]*?\];/);
    const layersContent = createCrystalCaveMatch[0];
    const layerMatches = layersContent.match(/\{\s*zIndex:/g);
    assert(
        layerMatches && layerMatches.length === 3,
        'Should have exactly 3 crystal layers'
    );
});

// Test 13: Crystal colors are preserved
test('Crystal colors are preserved', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?const crystalLayers = \[[^]*?\];/);
    const layersContent = createCrystalCaveMatch[0];
    assert(
        /colors:\s*\[/.test(layersContent),
        'Layers should have colors array'
    );
    assert(
        /rgba\(/.test(layersContent),
        'Colors should use rgba format'
    );
});

// Test 14: Crystal stroke styling is preserved
test('Crystal stroke styling is preserved', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /ctx\.strokeStyle/.test(functionContent),
        'Should set stroke style'
    );
    assert(
        /ctx\.lineWidth/.test(functionContent),
        'Should set line width'
    );
});

// Test 15: Gradient effects are preserved
test('Gradient effects are preserved', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /ctx\.createLinearGradient/.test(functionContent),
        'Should create linear gradients'
    );
    assert(
        /gradient\.addColorStop/.test(functionContent),
        'Should add color stops to gradients'
    );
});

// Test 16: Math.random() is replaced in crystal generation
test('Math.random() is replaced in crystal generation', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    // Extract only the canvas generation part (after seededRandom setup)
    const canvasGenMatch = functionContent.match(/const rng = seededRandom[^]*?crystalCaveCache\.set/s);
    if (canvasGenMatch) {
        const genContent = canvasGenMatch[0];
        // Should not have Math.random() in the generation logic
        const mathRandomMatches = genContent.match(/Math\.random\(\)/g) || [];
        assert(
            mathRandomMatches.length === 0,
            `Should not use Math.random() in crystal generation (found ${mathRandomMatches.length} uses)`
        );
    }
});

// Test 17: Each layer has a unique seed
test('Each layer has a unique seed', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?const crystalLayers = \[[^]*?\];/);
    const layersContent = createCrystalCaveMatch[0];
    const seedMatches = layersContent.match(/seed:\s*(\d+)/g);
    assert(seedMatches && seedMatches.length === 3, 'Should have 3 seed values');
    const seeds = seedMatches.map(m => m.match(/\d+/)[0]);
    const uniqueSeeds = new Set(seeds);
    assert(
        uniqueSeeds.size === 3,
        'Each layer should have a unique seed'
    );
});

// Test 18: Cache key includes window dimensions
test('Cache key includes window dimensions', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    const cacheKeySection = functionContent.match(/const cacheKey = [^;]+;/s);
    assert(cacheKeySection, 'Should have cache key definition');
    const keyDef = cacheKeySection[0];
    assert(
        /C_WIDTH/.test(keyDef) || /width/.test(keyDef),
        'Cache key should include width'
    );
    assert(
        /C_HEIGHT/.test(keyDef) || /height/.test(keyDef) || /innerHeight/.test(keyDef),
        'Cache key should include height'
    );
});

// Test 19: Canvas dimensions are set correctly
test('Canvas dimensions are set to proper size', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /canvas\.width\s*=\s*C_WIDTH/.test(functionContent) || /canvas\.width\s*=\s*2048/.test(functionContent),
        'Canvas width should be set'
    );
    assert(
        /canvas\.height\s*=\s*C_HEIGHT/.test(functionContent) || /canvas\.height\s*=\s*window\.innerHeight/.test(functionContent),
        'Canvas height should be set'
    );
});

// Test 20: Layers are processed with forEach
test('Layers are processed with forEach', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /crystalLayers\.forEach\(/.test(functionContent),
        'Should iterate through layers with forEach'
    );
});

// Test 21: Cache prevents redundant canvas generation
test('Cache prevents redundant canvas generation', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    // Should have early return when cache hit
    const cacheCheckSection = functionContent.match(/if\s*\(\s*crystalCaveCache\.has\([^)]+\)\s*\)\s*\{[^}]+\}/s);
    assert(cacheCheckSection, 'Should have cache check block');
    assert(
        /return/.test(cacheCheckSection[0]),
        'Should return early on cache hit to avoid regeneration'
    );
});

// Test 22: Function returns early on cache hit
test('Function returns early on cache hit', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    const forEachBlock = functionContent.match(/crystalLayers\.forEach\([^]*?\}\s*\);/s);
    assert(forEachBlock, 'Should have forEach block');
    const forEachContent = forEachBlock[0];
    // Check for early return in the cache hit block
    assert(
        /if\s*\(\s*crystalCaveCache\.has[^}]+return;/s.test(forEachContent),
        'Should return early from forEach callback on cache hit'
    );
});

// Test 23: Seeded random ensures deterministic output
test('Seeded random ensures deterministic output', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /const rng = seededRandom\(layer\.seed\)/.test(functionContent),
        'Should create deterministic RNG from layer seed'
    );
    // Verify rng is used for all random operations
    const rngUsages = (functionContent.match(/rng\(\)/g) || []).length;
    assert(
        rngUsages >= 10, // Should have many rng() calls for crystal generation
        `Should use rng() extensively (found ${rngUsages} uses)`
    );
});

// Test 24: Ceiling and floor crystals logic preserved
test('Ceiling and floor crystals logic preserved', () => {
    const createCrystalCaveMatch = scriptContent.match(/function createCrystalCaveScene\(\)[^]*?(?=function|\Z)/s);
    const functionContent = createCrystalCaveMatch[0];
    assert(
        /Draw from ceiling/.test(functionContent) || /ceiling/.test(functionContent),
        'Should have ceiling crystal logic'
    );
    assert(
        /Draw from floor/.test(functionContent) || /floor/.test(functionContent),
        'Should have floor crystal logic'
    );
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests Run: ${testsRun}`);
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log('='.repeat(50));

if (testsFailed === 0) {
    console.log('\n✅ All Crystal Cave caching optimization tests passed!');
    process.exit(0);
} else {
    console.log(`\n❌ ${testsFailed} test(s) failed.`);
    process.exit(1);
}
