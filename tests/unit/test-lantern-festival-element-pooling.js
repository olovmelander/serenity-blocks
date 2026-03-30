const fs = require('fs');
const path = require('path');

// Read the script.js file
const scriptPath = path.join(__dirname, '../../script.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

console.log('=== Lantern Festival Element Pooling Optimization Tests ===\n');

let passedTests = 0;
let failedTests = 0;

function test(description, assertion) {
    try {
        if (assertion()) {
            console.log(`✓ ${description}`);
            passedTests++;
        } else {
            console.log(`✗ ${description}`);
            failedTests++;
        }
    } catch (error) {
        console.log(`✗ ${description} - Error: ${error.message}`);
        failedTests++;
    }
}

// Test 1: Element pool is declared
test('lanternFestivalElementPool is declared', () => {
    return scriptContent.includes('const lanternFestivalElementPool = {');
});

// Test 2: Pool has all required arrays
test('Element pool has lanterns array', () => {
    return scriptContent.includes('lanterns: []');
});

test('Element pool has reflections array', () => {
    return scriptContent.includes('reflections: []');
});

test('Element pool has petals array', () => {
    return scriptContent.includes('petals: []');
});

test('Element pool has embers array', () => {
    return scriptContent.includes('embers: []');
});

test('Element pool has initialized flag', () => {
    return scriptContent.includes('initialized: false');
});

// Test 3: Pool has explanatory comment
test('Element pool has explanatory comment', () => {
    return scriptContent.includes('Element pool for Lantern Festival to avoid expensive DOM regeneration');
});

// Test 4: Function checks pool initialization
test('createLanternFestivalScene checks if pool is initialized', () => {
    return scriptContent.includes('if (lanternFestivalElementPool.initialized)');
});

// Test 5: Early return on pool hit
test('Function returns early when pool is initialized', () => {
    const poolCheckIndex = scriptContent.indexOf('if (lanternFestivalElementPool.initialized)');
    const returnIndex = scriptContent.indexOf('return; // Skip expensive generation', poolCheckIndex);
    return poolCheckIndex > -1 && returnIndex > poolCheckIndex && (returnIndex - poolCheckIndex) < 2000;
});

// Test 6: Seeded random is used
test('Seeded random is used for lantern festival', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('const rng = seededRandom(88888)');
});

// Test 7: Seeded random replaces Math.random for lantern generation
test('Seeded random replaces Math.random() for lanterns', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    // Should use rng() instead of Math.random() for lantern properties
    return funcContent.includes('const color = lanternColors[Math.floor(rng() * lanternColors.length)]');
});

// Test 8: Elements are stored in pool
test('Lanterns are stored in pool', () => {
    return scriptContent.includes('lanternFestivalElementPool.lanterns.push(lantern)');
});

test('Reflections are stored in pool', () => {
    return scriptContent.includes('lanternFestivalElementPool.reflections.push(reflection)');
});

test('Petals are stored in pool', () => {
    return scriptContent.includes('lanternFestivalElementPool.petals.push(petal)');
});

test('Embers are stored in pool', () => {
    return scriptContent.includes('lanternFestivalElementPool.embers.push(ember)');
});

// Test 9: Pool is marked as initialized
test('Pool is marked as initialized after first generation', () => {
    return scriptContent.includes('lanternFestivalElementPool.initialized = true');
});

// Test 10: Elements are reattached from pool
test('Lanterns are reattached from pool on subsequent loads', () => {
    const reattachBlock = scriptContent.indexOf('if (lanternFestivalElementPool.initialized)');
    const returnBlock = scriptContent.indexOf('return; // Skip expensive generation');
    const reattachContent = scriptContent.substring(reattachBlock, returnBlock);
    return reattachContent.includes('lanternFestivalElementPool.lanterns[lanternIndex]');
});

test('Reflections are reattached from pool', () => {
    const reattachBlock = scriptContent.indexOf('if (lanternFestivalElementPool.initialized)');
    const returnBlock = scriptContent.indexOf('return; // Skip expensive generation');
    const reattachContent = scriptContent.substring(reattachBlock, returnBlock);
    return reattachContent.includes('lanternFestivalElementPool.reflections.forEach');
});

test('Petals are reattached from pool', () => {
    const reattachBlock = scriptContent.indexOf('if (lanternFestivalElementPool.initialized)');
    const returnBlock = scriptContent.indexOf('return; // Skip expensive generation');
    const reattachContent = scriptContent.substring(reattachBlock, returnBlock);
    return reattachContent.includes('lanternFestivalElementPool.petals.forEach');
});

test('Embers are reattached from pool', () => {
    const reattachBlock = scriptContent.indexOf('if (lanternFestivalElementPool.initialized)');
    const returnBlock = scriptContent.indexOf('return; // Skip expensive generation');
    const reattachContent = scriptContent.substring(reattachBlock, returnBlock);
    return reattachContent.includes('lanternFestivalElementPool.embers.forEach');
});

// Test 11: All Math.random() calls replaced with rng()
test('Math.random() replaced with rng() for lantern size', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('const size = rng() * (layer.maxSize - layer.minSize) + layer.minSize');
});

test('Math.random() replaced with rng() for lantern position', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('const xPos = rng() * 100');
});

test('Math.random() replaced with rng() for lantern duration', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('const duration = rng() * (layer.maxDuration - layer.minDuration) + layer.minDuration');
});

test('Math.random() replaced with rng() for lantern sway', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('(rng() - 0.5) * 10');
});

test('Math.random() replaced with rng() for petal properties', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('rng() * 100}vw');
});

test('Math.random() replaced with rng() for ember properties', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('ember.style.left = `${rng() * 100}%`');
});

// Test 12: Element creation logic preserved
test('Lantern creation logic is preserved', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('const lantern = document.createElement(\'div\')') &&
           funcContent.includes('lantern.className = \'lantern\'');
});

test('Lantern shapes are preserved', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('Classic round') &&
           funcContent.includes('Cylinder') &&
           funcContent.includes('Diamond');
});

test('Lantern colors are preserved', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('#ff7675') &&
           funcContent.includes('#feca57') &&
           funcContent.includes('#ab54c5');
});

test('Lantern layers configuration is preserved', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('count: 20') &&
           funcContent.includes('count: 15') &&
           funcContent.includes('count: 10');
});

test('Reflection logic is preserved for front lanterns', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('lanterns-front') &&
           funcContent.includes('lantern-reflection');
});

test('Petal count is preserved (20 petals)', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('for (let i = 0; i < 20; i++)') &&
           funcContent.includes('lantern-petal');
});

test('Ember count is preserved (40 embers)', () => {
    const funcStart = scriptContent.indexOf('function createLanternFestivalScene()');
    const funcEnd = scriptContent.indexOf('function createFluidDreamsScene()');
    const funcContent = scriptContent.substring(funcStart, funcEnd);
    return funcContent.includes('for (let i = 0; i < 40; i++)') &&
           funcContent.includes('lantern-ember');
});

// Summary
console.log(`\nTests Run: ${passedTests + failedTests}`);
console.log(`Tests Passed: ${passedTests}`);
console.log(`Tests Failed: ${failedTests}\n`);

if (failedTests === 0) {
    console.log('✅ All Lantern Festival element pooling optimization tests passed!');
    process.exit(0);
} else {
    console.log('❌ Some tests failed. Please review the optimization implementation.');
    process.exit(1);
}
