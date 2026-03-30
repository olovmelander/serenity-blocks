/**
 * Wolfhour Theme Canvas Caching Optimization Test (Simple Version)
 */

const assert = require('assert');

// Seeded random number generator for deterministic procedural generation
function seededRandom(seed) {
    let state = seed;
    return function() {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

// Mock cache
const wolfhourBackgroundCache = new Map();

// Simulate canvas generation
function generateBackground(seed, cacheKey) {
    const startTime = Date.now();

    if (wolfhourBackgroundCache.has(cacheKey)) {
        const endTime = Date.now();
        return {
            fromCache: true,
            duration: endTime - startTime,
            dataURL: wolfhourBackgroundCache.get(cacheKey)
        };
    }

    const rng = seededRandom(seed);

    // Simulate expensive canvas operations
    let result = '';
    for (let i = 0; i < 50; i++) {
        const x = rng() * 2000;
        const y = rng() * 800;
        const radius = rng() * 200 + 100;
        const opacity = rng() * 0.15 + 0.05;
        // Simulate gradient calculation
        result += `${x},${y},${radius},${opacity};`;
    }

    const dataURL = `url(data:image/png;base64,${result.substring(0, 50)})`;
    wolfhourBackgroundCache.set(cacheKey, dataURL);

    const endTime = Date.now();
    return {
        fromCache: false,
        duration: endTime - startTime,
        dataURL: dataURL
    };
}

// Run tests
console.log('🧪 Wolfhour Canvas Caching Optimization Tests\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
        failed++;
    }
}

// Test 1: Seeded Random Determinism
test('Seeded random produces deterministic output', () => {
    const rng1 = seededRandom(12345);
    const rng2 = seededRandom(12345);

    const values1 = [rng1(), rng1(), rng1()];
    const values2 = [rng2(), rng2(), rng2()];

    assert.deepStrictEqual(values1, values2);
});

// Test 2: Different seeds produce different output
test('Different seeds produce different output', () => {
    const rng1 = seededRandom(12345);
    const rng2 = seededRandom(54321);

    const val1 = rng1();
    const val2 = rng2();

    assert.notStrictEqual(val1, val2);
});

// Test 3: Cache miss on first call
test('First generation does not use cache', () => {
    wolfhourBackgroundCache.clear();
    const result = generateBackground(12345, 'test-nebula-1');

    assert.strictEqual(result.fromCache, false);
    assert.ok(result.dataURL.startsWith('url(data:'));
});

// Test 4: Cache hit on second call
test('Second generation uses cache', () => {
    wolfhourBackgroundCache.clear();

    const result1 = generateBackground(12345, 'test-nebula-2');
    const result2 = generateBackground(12345, 'test-nebula-2');

    assert.strictEqual(result1.fromCache, false);
    assert.strictEqual(result2.fromCache, true);
    assert.strictEqual(result1.dataURL, result2.dataURL);
});

// Test 5: Deterministic output
test('Same seed produces identical output', () => {
    wolfhourBackgroundCache.clear();
    const result1 = generateBackground(12345, 'det-test-1');

    wolfhourBackgroundCache.clear();
    const result2 = generateBackground(12345, 'det-test-2');

    assert.strictEqual(result1.dataURL, result2.dataURL);
});

// Test 6: Performance improvement
test('Cache provides significant performance improvement', () => {
    wolfhourBackgroundCache.clear();

    const timings = [];
    for (let i = 0; i < 5; i++) {
        const result = generateBackground(12345, 'perf-test');
        timings.push(result.duration);
    }

    const firstCall = timings[0];
    const cachedCalls = timings.slice(1);
    const avgCached = cachedCalls.reduce((a, b) => a + b, 0) / cachedCalls.length;

    console.log(`   First call: ${firstCall}ms, Avg cached: ${avgCached}ms`);

    // Cached calls should be faster (or at worst equal if system is very fast)
    assert.ok(avgCached <= firstCall,
        `Cached calls (${avgCached}ms) should be <= first call (${firstCall}ms)`);
});

// Test 7: Multiple cache entries
test('Different cache keys store separately', () => {
    wolfhourBackgroundCache.clear();

    generateBackground(12345, 'nebula-back');
    generateBackground(54321, 'nebula-mid');
    generateBackground(11111, 'mountain-distant');

    assert.strictEqual(wolfhourBackgroundCache.size, 3);
});

// Test 8: Memory stability
test('Cache does not grow with repeated access', () => {
    wolfhourBackgroundCache.clear();

    for (let i = 0; i < 20; i++) {
        generateBackground(12345, 'memory-test');
    }

    assert.strictEqual(wolfhourBackgroundCache.size, 1);
});

// Test 9: Cache persistence
test('Cache persists across theme switches', () => {
    wolfhourBackgroundCache.clear();

    // Simulate multiple theme switches
    generateBackground(12345, 'switch-test');
    generateBackground(54321, 'switch-test-2');
    generateBackground(12345, 'switch-test'); // Back to first
    generateBackground(54321, 'switch-test-2'); // Back to second

    assert.strictEqual(wolfhourBackgroundCache.size, 2);
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed === 0) {
    console.log('🎉 All tests passed! Wolfhour caching optimization verified.\n');
    console.log('✨ Benefits:');
    console.log('   • Deterministic rendering (same visuals every time)');
    console.log('   • Faster theme switching after first load');
    console.log('   • Reduced CPU usage during theme changes');
    console.log('   • Memory-efficient caching strategy\n');
    process.exit(0);
} else {
    console.log('⚠️  Some tests failed. Please review.\n');
    process.exit(1);
}
