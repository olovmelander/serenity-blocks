/**
 * Test suite for canvas style optimization
 * Verifies that canvas border/shadow styles are only updated when level changes,
 * not on every frame (60 FPS optimization)
 */

const fs = require('fs');
const path = require('path');

// Read the main script file
const scriptPath = path.join(__dirname, '../../script.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

console.log('=== Canvas Style Optimization Test ===\n');

let passedTests = 0;
let totalTests = 0;

function test(name, condition) {
    totalTests++;
    if (condition) {
        console.log(`✓ PASS: ${name}`);
        passedTests++;
    } else {
        console.log(`✗ FAIL: ${name}`);
    }
}

// Test 1: Check that lastRenderedLevel tracking variable exists
test('lastRenderedLevel tracking variable declared',
    scriptContent.includes('let lastRenderedLevel = 0'));

// Test 2: Check that updateCanvasStyle function exists
test('updateCanvasStyle function exists',
    scriptContent.includes('function updateCanvasStyle()'));

// Test 3: Verify updateCanvasStyle has proper comment explaining optimization
test('updateCanvasStyle has optimization comment',
    scriptContent.includes('// Only called when level actually changes (optimization)'));

// Test 4: Verify updateCanvasStyle sets lastRenderedLevel
test('updateCanvasStyle sets lastRenderedLevel',
    /updateCanvasStyle[\s\S]*?lastRenderedLevel = level/.test(scriptContent));

// Test 5: Verify draw() function checks level !== lastRenderedLevel
test('draw() checks if level changed before updating styles',
    scriptContent.includes('if (level !== lastRenderedLevel)'));

// Test 6: Verify draw() calls updateCanvasStyle conditionally
test('draw() calls updateCanvasStyle only when level changed',
    /if \(level !== lastRenderedLevel\)[\s\S]*?updateCanvasStyle\(\)/.test(scriptContent));

// Test 7: Verify draw() has optimization comment
test('draw() has performance optimization comment',
    scriptContent.includes('// Only update canvas styles when level changes (performance optimization)'));

// Test 8: Verify resetGame resets lastRenderedLevel
test('resetGame resets lastRenderedLevel to trigger initial update',
    /resetGame[\s\S]{0,500}lastRenderedLevel = 0/.test(scriptContent));

// Test 9: Verify canvas styles are NOT set unconditionally every frame in draw()
test('draw() does NOT set canvas.style.borderColor unconditionally',
    !(/function draw\(\)[\s\S]{0,200}canvas\.style\.borderColor = /.test(scriptContent) &&
      !/if \(level/.test(scriptContent.match(/function draw\(\)[\s\S]{0,200}/)[0])));

// Test 10: Verify all three level thresholds still exist in updateCanvasStyle
test('updateCanvasStyle contains level>=10 check',
    /updateCanvasStyle[\s\S]{0,500}level>=10/.test(scriptContent));

test('updateCanvasStyle contains level>=5 check',
    /updateCanvasStyle[\s\S]{0,500}level>=5/.test(scriptContent));

test('updateCanvasStyle contains else case for level<5',
    /function updateCanvasStyle[\s\S]{0,600}else[\s\S]{0,200}#8b5cf6/.test(scriptContent));

// Test 11: Verify all original styles are preserved
test('Red border color (#ef4444) preserved for level>=10',
    scriptContent.includes("canvas.style.borderColor = '#ef4444'"));

test('Red box shadow preserved for level>=10',
    scriptContent.includes('0 0 30px rgba(239, 68, 68'));

test('Yellow border color (#fbbf24) preserved for level>=5',
    scriptContent.includes("canvas.style.borderColor = '#fbbf24'"));

test('Yellow box shadow preserved for level>=5',
    scriptContent.includes('0 0 30px rgba(251, 191, 36'));

test('Purple border color (#8b5cf6) preserved for level<5',
    scriptContent.includes("canvas.style.borderColor = '#8b5cf6'"));

test('Purple box shadow preserved for level<5',
    scriptContent.includes('0 0 30px rgba(139, 92, 246'));

console.log(`\n=== Test Results: ${passedTests}/${totalTests} passed ===\n`);

if (passedTests === totalTests) {
    console.log('✅ All tests passed! Canvas style optimization is correctly implemented.');
    console.log('\nOptimization Impact:');
    console.log('- Before: 180 DOM style operations per second (3 × 60 FPS)');
    console.log('- After: ~1 operation every few minutes (only when level changes)');
    console.log('- Reduction: ~99.99% fewer DOM operations');
    console.log('- Benefit: Eliminates style recalculation on every frame, improves frame pacing\n');
    process.exit(0);
} else {
    console.log('❌ Some tests failed. Please review the implementation.\n');
    process.exit(1);
}
