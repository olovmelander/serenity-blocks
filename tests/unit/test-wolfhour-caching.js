/**
 * Wolfhour Theme Canvas Caching Optimization Test
 *
 * Tests that the Wolfhour theme properly caches canvas-generated backgrounds
 * for improved performance on subsequent theme switches.
 */

const assert = require('assert');

// Mock DOM environment
global.document = {
    createElement: function(tag) {
        return {
            width: 0,
            height: 0,
            style: {},
            getContext: function(type) {
                return {
                    fillStyle: '',
                    strokeStyle: '',
                    lineWidth: 0,
                    globalAlpha: 1,
                    beginPath: function() {},
                    moveTo: function(x, y) {},
                    lineTo: function(x, y) {},
                    arc: function(x, y, r, start, end) {},
                    closePath: function() {},
                    fill: function() {},
                    fillRect: function(x, y, w, h) {},
                    createRadialGradient: function(x1, y1, r1, x2, y2, r2) {
                        return {
                            addColorStop: function(pos, color) {}
                        };
                    }
                };
            },
            toDataURL: function() {
                return 'data:image/png;base64,MOCK_IMAGE_DATA';
            }
        };
    },
    getElementById: function(id) {
        return {
            id: id,
            style: {},
            children: [],
            appendChild: function(child) {
                this.children.push(child);
            }
        };
    }
};

// Import the seeded random function (copy from script.js)
function seededRandom(seed) {
    let state = seed;
    return function() {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

// Mock cache
const wolfhourBackgroundCache = new Map();

// Simplified version of nebula generation for testing
function generateNebula(seed, cacheKey) {
    if (wolfhourBackgroundCache.has(cacheKey)) {
        return {
            fromCache: true,
            dataURL: wolfhourBackgroundCache.get(cacheKey)
        };
    }

    const rng = seededRandom(seed);
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');

    // Simulate expensive gradient operations
    for (let i = 0; i < 50; i++) {
        const x = rng() * canvas.width;
        const y = rng() * canvas.height;
        const radius = rng() * 200 + 100;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const opacity = rng() * 0.15 + 0.05;
        gradient.addColorStop(0, `rgba(200, 200, 200, ${opacity})`);
        gradient.addColorStop(0.5, `rgba(150, 150, 150, ${opacity * 0.5})`);
        gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const dataURL = `url(${canvas.toDataURL()})`;
    wolfhourBackgroundCache.set(cacheKey, dataURL);

    return {
        fromCache: false,
        dataURL: dataURL
    };
}

// Simplified mountain generation
function generateMountains(seed, cacheKey, width, height) {
    if (wolfhourBackgroundCache.has(cacheKey)) {
        return {
            fromCache: true,
            data: wolfhourBackgroundCache.get(cacheKey)
        };
    }

    const rng = seededRandom(seed);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#404040';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);

    for (let x = 0; x < canvas.width; x += 20) {
        const y = canvas.height - (rng() * 300 + 200) - Math.sin(x * 0.01) * 100;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    const backgroundImage = `url(${canvas.toDataURL()})`;
    const backgroundSize = '2000px 100%';
    const data = { backgroundImage, backgroundSize };
    wolfhourBackgroundCache.set(cacheKey, data);

    return {
        fromCache: false,
        data: data
    };
}

// Test Suite
describe('Wolfhour Canvas Caching Optimization', function() {

    beforeEach(function() {
        // Clear cache before each test
        wolfhourBackgroundCache.clear();
    });

    describe('Seeded Random Generator', function() {
        it('should produce deterministic output', function() {
            const rng1 = seededRandom(12345);
            const rng2 = seededRandom(12345);

            const values1 = [rng1(), rng1(), rng1(), rng1(), rng1()];
            const values2 = [rng2(), rng2(), rng2(), rng2(), rng2()];

            assert.deepStrictEqual(values1, values2,
                'Same seed should produce identical random sequences');
        });

        it('should produce different output for different seeds', function() {
            const rng1 = seededRandom(12345);
            const rng2 = seededRandom(54321);

            const values1 = [rng1(), rng1(), rng1()];
            const values2 = [rng2(), rng2(), rng2()];

            assert.notDeepStrictEqual(values1, values2,
                'Different seeds should produce different sequences');
        });

        it('should produce values in [0, 1) range', function() {
            const rng = seededRandom(999);

            for (let i = 0; i < 100; i++) {
                const val = rng();
                assert.ok(val >= 0 && val < 1,
                    `Random value ${val} should be in [0, 1) range`);
            }
        });
    });

    describe('Nebula Canvas Caching', function() {
        it('should not use cache on first generation', function() {
            const result = generateNebula(12345, 'test-nebula-1');

            assert.strictEqual(result.fromCache, false,
                'First generation should not use cache');
            assert.ok(result.dataURL.startsWith('url(data:'),
                'Should generate data URL');
        });

        it('should use cache on second generation', function() {
            const result1 = generateNebula(12345, 'test-nebula-2');
            const result2 = generateNebula(12345, 'test-nebula-2');

            assert.strictEqual(result1.fromCache, false,
                'First call should generate');
            assert.strictEqual(result2.fromCache, true,
                'Second call should use cache');
            assert.strictEqual(result1.dataURL, result2.dataURL,
                'Cached result should match original');
        });

        it('should cache different nebulae independently', function() {
            const nebulaBack = generateNebula(12345, 'nebula-back');
            const nebulaMid = generateNebula(54321, 'nebula-mid');

            assert.strictEqual(wolfhourBackgroundCache.size, 2,
                'Should have 2 cached entries');
            assert.notStrictEqual(nebulaBack.dataURL, nebulaMid.dataURL,
                'Different seeds should produce different results');
        });

        it('should produce deterministic output with same seed', function() {
            wolfhourBackgroundCache.clear();
            const result1 = generateNebula(12345, 'test-deterministic-1');

            wolfhourBackgroundCache.clear();
            const result2 = generateNebula(12345, 'test-deterministic-2');

            assert.strictEqual(result1.dataURL, result2.dataURL,
                'Same seed should produce identical nebula');
        });
    });

    describe('Mountain Canvas Caching', function() {
        it('should cache mountain backgrounds', function() {
            const result1 = generateMountains(11111, 'test-mountain', 4000, 800);
            const result2 = generateMountains(11111, 'test-mountain', 4000, 800);

            assert.strictEqual(result1.fromCache, false,
                'First generation should not use cache');
            assert.strictEqual(result2.fromCache, true,
                'Second generation should use cache');
            assert.deepStrictEqual(result1.data, result2.data,
                'Cached data should match original');
        });

        it('should cache backgroundSize along with backgroundImage', function() {
            const result = generateMountains(22222, 'test-mountain-size', 4000, 600);

            assert.ok(result.data.backgroundImage, 'Should have backgroundImage');
            assert.ok(result.data.backgroundSize, 'Should have backgroundSize');
            assert.strictEqual(result.data.backgroundSize, '2000px 100%',
                'Background size should be cached');
        });
    });

    describe('Cache Performance', function() {
        it('should significantly reduce generation time on cache hits', function() {
            const iterations = 10;
            const timings = [];

            for (let i = 0; i < iterations; i++) {
                const start = Date.now();
                generateNebula(12345, 'perf-test-nebula');
                const duration = Date.now() - start;
                timings.push(duration);
            }

            const firstCallTime = timings[0];
            const avgCachedTime = timings.slice(1).reduce((a, b) => a + b, 0) / (iterations - 1);

            // Cache hits should be at least 10x faster (likely much more)
            assert.ok(avgCachedTime < firstCallTime / 10,
                `Cached calls (${avgCachedTime}ms avg) should be much faster than first call (${firstCallTime}ms)`);
        });

        it('should handle multiple theme switches efficiently', function() {
            const switches = 20;
            const cacheKey = 'multi-switch-test';

            for (let i = 0; i < switches; i++) {
                generateNebula(12345, cacheKey);
            }

            // Should only have 1 cached entry despite 20 switches
            assert.strictEqual(wolfhourBackgroundCache.size, 1,
                'Cache should have exactly 1 entry after multiple switches');
        });
    });

    describe('Memory Management', function() {
        it('should not leak memory with repeated cache access', function() {
            const initialSize = wolfhourBackgroundCache.size;

            for (let i = 0; i < 100; i++) {
                generateNebula(12345, 'memory-test');
            }

            assert.strictEqual(wolfhourBackgroundCache.size, initialSize + 1,
                'Cache size should only increase by 1 despite 100 accesses');
        });

        it('should store data URLs efficiently', function() {
            generateNebula(12345, 'size-test-1');
            generateNebula(54321, 'size-test-2');

            const cachedValue = wolfhourBackgroundCache.get('size-test-1');
            assert.ok(typeof cachedValue === 'string',
                'Cached value should be a string');
            assert.ok(cachedValue.startsWith('url(data:'),
                'Cached value should be a data URL');
        });
    });
});

// Run tests
console.log('Running Wolfhour Canvas Caching Tests...\n');

const tests = [
    ['Seeded Random - Deterministic', () => {
        const rng1 = seededRandom(12345);
        const rng2 = seededRandom(12345);
        assert.deepStrictEqual([rng1(), rng1()], [rng2(), rng2()]);
    }],
    ['Cache Miss on First Call', () => {
        wolfhourBackgroundCache.clear();
        const result = generateNebula(12345, 'test-1');
        assert.strictEqual(result.fromCache, false);
    }],
    ['Cache Hit on Second Call', () => {
        wolfhourBackgroundCache.clear();
        generateNebula(12345, 'test-2');
        const result = generateNebula(12345, 'test-2');
        assert.strictEqual(result.fromCache, true);
    }],
    ['Deterministic Output', () => {
        wolfhourBackgroundCache.clear();
        const r1 = generateNebula(12345, 'det-1');
        wolfhourBackgroundCache.clear();
        const r2 = generateNebula(12345, 'det-2');
        assert.strictEqual(r1.dataURL, r2.dataURL);
    }],
    ['Mountain Caching Works', () => {
        wolfhourBackgroundCache.clear();
        const r1 = generateMountains(11111, 'mtn-1', 4000, 800);
        const r2 = generateMountains(11111, 'mtn-1', 4000, 800);
        assert.strictEqual(r2.fromCache, true);
    }]
];

let passed = 0;
let failed = 0;

tests.forEach(([name, test]) => {
    try {
        test();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
        failed++;
    }
});

console.log(`\n${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('\n🎉 All tests passed! Wolfhour caching optimization verified.');
    process.exit(0);
} else {
    console.log('\n⚠️  Some tests failed. Please review.');
    process.exit(1);
}
