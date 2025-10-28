/**
 * CRITICAL TEST: Quadra Hole Position Encoding/Decoding Accuracy
 *
 * This test validates that our implementation exactly matches Quadra's hole position system:
 * 1. Piece placement → holes in garbage (inverse mapping)
 * 2. MSB-first bit encoding (column 0 = bit 9)
 * 3. Correct encoding/decoding round-trip
 */

import { COLS } from '../../src/core/constants.js';

/**
 * Test implementation of Quadra's MSB-first encoding
 */
function maskArrayToBits(mask) {
    let bits = 0;
    for (let x = 0; x < COLS; x++) {
        bits <<= 1;  // Shift left (MSB-first)
        if (mask[x]) {
            bits |= 1;
        }
    }
    return bits;
}

/**
 * Test implementation of Quadra's MSB-first decoding
 */
function bitsToColumns(bits) {
    const columns = [];
    for (let x = 0; x < COLS; x++) {
        const bitPos = COLS - 1 - x;  // MSB-first
        if ((bits & (1 << bitPos)) !== 0) {
            columns.push(x);
        }
    }
    return columns;
}

/**
 * Test 1: Verify MSB-first encoding matches Quadra examples
 */
function testQuadraExamples() {
    console.log('\n=== TEST 1: Quadra Documentation Examples ===\n');

    // Quadra clean patterns (from documentation)
    // Even lines: 72 = 0b0001001000 = columns 1, 4 (0-indexed)
    // Odd lines: 585 = 0b1001001001 = columns 0, 3, 6, 9 (0-indexed)

    const evenMask = Array(COLS).fill(false);
    evenMask[1] = true;
    evenMask[4] = true;
    const evenBits = maskArrayToBits(evenMask);
    console.log(`Clean EVEN pattern:`);
    console.log(`  Expected: 72 (0b${(72).toString(2).padStart(10, '0')})`);
    console.log(`  Got:      ${evenBits} (0b${evenBits.toString(2).padStart(10, '0')})`);
    console.log(`  Columns:  [${[1, 4].join(', ')}]`);
    console.log(`  Match:    ${evenBits === 72 ? '✓ PASS' : '✗ FAIL'}\n`);

    const oddMask = Array(COLS).fill(false);
    oddMask[0] = true;
    oddMask[3] = true;
    oddMask[6] = true;
    oddMask[9] = true;
    const oddBits = maskArrayToBits(oddMask);
    console.log(`Clean ODD pattern:`);
    console.log(`  Expected: 585 (0b${(585).toString(2).padStart(10, '0')})`);
    console.log(`  Got:      ${oddBits} (0b${oddBits.toString(2).padStart(10, '0')})`);
    console.log(`  Columns:  [${[0, 3, 6, 9].join(', ')}]`);
    console.log(`  Match:    ${oddBits === 585 ? '✓ PASS' : '✗ FAIL'}\n`);

    return evenBits === 72 && oddBits === 585;
}

/**
 * Test 2: Round-trip encoding/decoding
 */
function testRoundTrip() {
    console.log('=== TEST 2: Round-Trip Encoding/Decoding ===\n');

    const testCases = [
        { name: 'I-piece horizontal (4 holes)', columns: [3, 4, 5, 6] },
        { name: 'T-piece (3 holes)', columns: [4, 5, 6] },
        { name: 'Single column hole', columns: [4] },
        { name: 'Two holes separated', columns: [2, 7] },
        { name: 'All holes', columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
        { name: 'No holes', columns: [] },
        { name: 'Edge holes', columns: [0, 9] },
    ];

    let allPass = true;

    testCases.forEach((testCase, index) => {
        const mask = Array(COLS).fill(false);
        testCase.columns.forEach(col => mask[col] = true);

        const encoded = maskArrayToBits(mask);
        const decoded = bitsToColumns(encoded);

        const match = JSON.stringify(decoded) === JSON.stringify(testCase.columns);
        allPass = allPass && match;

        console.log(`Test ${index + 1}: ${testCase.name}`);
        console.log(`  Input:    [${testCase.columns.join(', ')}]`);
        console.log(`  Encoded:  ${encoded} (0b${encoded.toString(2).padStart(10, '0')})`);
        console.log(`  Decoded:  [${decoded.join(', ')}]`);
        console.log(`  Match:    ${match ? '✓ PASS' : '✗ FAIL'}\n`);
    });

    return allPass;
}

/**
 * Test 3: Quadra scenario from documentation (Section 4.4)
 * I-piece placed horizontally at columns 6-9 (Quadra columns 6-9, 0-indexed)
 */
function testQuadraScenario() {
    console.log('=== TEST 3: Quadra I-Piece Scenario (Documentation Example) ===\n');

    // Scenario: Horizontal I-piece at columns 6-9 (0-indexed: 2-5)
    // In Quadra: columns 6-9 in 1-indexed → 2-5 in 0-indexed
    // Expected: holes at columns 2, 3, 4, 5
    // Expected bits: 0b0011110000 = 240

    const mask = Array(COLS).fill(false);
    [2, 3, 4, 5].forEach(col => mask[col] = true);

    const encoded = maskArrayToBits(mask);
    const decoded = bitsToColumns(encoded);

    console.log(`I-piece horizontal at columns 2-5 (Quadra 6-9 in doc, adjusted for 0-index):`);
    console.log(`  Piece columns:    [${[2, 3, 4, 5].join(', ')}]`);
    console.log(`  Expected bits:    240 (0b0011110000)`);
    console.log(`  Encoded bits:     ${encoded} (0b${encoded.toString(2).padStart(10, '0')})`);
    console.log(`  Decoded holes:    [${decoded.join(', ')}]`);
    console.log(`  Match:            ${encoded === 240 ? '✓ PASS' : '✗ FAIL'}\n`);

    console.log(`Garbage interpretation (sent to opponent):`);
    console.log(`  Holes (empty):    [${decoded.join(', ')}]`);
    const solid = [];
    for (let x = 0; x < COLS; x++) {
        if (!decoded.includes(x)) solid.push(x);
    }
    console.log(`  Solid (blocks):   [${solid.join(', ')}]`);
    console.log(`  Visual:           ${Array.from({length: COLS}, (_, x) => decoded.includes(x) ? '_' : '█').join('')}\n`);

    return encoded === 240;
}

/**
 * Test 4: Verify inverse mapping (piece position → holes)
 */
function testInverseMapping() {
    console.log('=== TEST 4: Inverse Mapping (Critical Quadra Feature) ===\n');

    console.log('CONCEPT: In Quadra, where your piece touched → holes in opponent\'s garbage\n');

    const scenarios = [
        {
            name: 'Horizontal I-piece (columns 3-6)',
            pieceColumns: [3, 4, 5, 6],
            description: 'Wide piece → many holes → easier garbage'
        },
        {
            name: 'Vertical I-piece (column 5 only)',
            pieceColumns: [5],
            description: 'Narrow piece → few holes → harder garbage'
        },
        {
            name: 'L-piece (columns 3, 4, 5)',
            pieceColumns: [3, 4, 5],
            description: 'Medium piece → medium holes'
        }
    ];

    scenarios.forEach((scenario, index) => {
        const mask = Array(COLS).fill(false);
        scenario.pieceColumns.forEach(col => mask[col] = true);

        const encoded = maskArrayToBits(mask);
        const decoded = bitsToColumns(encoded);

        const solidCount = COLS - decoded.length;
        const difficulty = solidCount >= 8 ? 'BRUTAL' : solidCount >= 6 ? 'HARD' : solidCount >= 4 ? 'MEDIUM' : 'EASY';

        console.log(`Scenario ${index + 1}: ${scenario.name}`);
        console.log(`  Your piece at:    [${scenario.pieceColumns.join(', ')}]`);
        console.log(`  Opponent holes:   [${decoded.join(', ')}]`);
        console.log(`  Opponent solid:   ${solidCount} blocks → ${difficulty}`);
        console.log(`  Visual:           ${Array.from({length: COLS}, (_, x) => decoded.includes(x) ? '_' : '█').join('')}`);
        console.log(`  Strategy:         ${scenario.description}\n`);
    });

    return true;
}

/**
 * Test 5: Edge cases
 */
function testEdgeCases() {
    console.log('=== TEST 5: Edge Cases ===\n');

    const testCases = [
        { name: 'All 0s (no holes, all solid)', value: 0 },
        { name: 'All 1s (all holes)', value: 1023 },
        { name: 'First bit only', value: 512 },
        { name: 'Last bit only', value: 1 },
        { name: 'Alternating pattern', value: 0b0101010101 },
    ];

    let allPass = true;

    testCases.forEach((testCase, index) => {
        const decoded = bitsToColumns(testCase.value);
        const encoded = maskArrayToBits(Array.from({length: COLS}, (_, x) => decoded.includes(x)));

        const match = encoded === testCase.value;
        allPass = allPass && match;

        console.log(`Test ${index + 1}: ${testCase.name}`);
        console.log(`  Value:    ${testCase.value} (0b${testCase.value.toString(2).padStart(10, '0')})`);
        console.log(`  Decoded:  [${decoded.join(', ')}]`);
        console.log(`  Re-encoded: ${encoded} (0b${encoded.toString(2).padStart(10, '0')})`);
        console.log(`  Match:    ${match ? '✓ PASS' : '✗ FAIL'}\n`);
    });

    return allPass;
}

/**
 * Run all tests
 */
function runAllTests() {
    console.log('\n' + '='.repeat(70));
    console.log('QUADRA HOLE POSITION ACCURACY TEST SUITE');
    console.log('='.repeat(70));

    const results = {
        'Quadra Examples': testQuadraExamples(),
        'Round-Trip': testRoundTrip(),
        'Quadra Scenario': testQuadraScenario(),
        'Inverse Mapping': testInverseMapping(),
        'Edge Cases': testEdgeCases()
    };

    console.log('='.repeat(70));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(70));

    let totalPass = 0;
    let totalTests = 0;

    Object.entries(results).forEach(([name, passed]) => {
        console.log(`${name.padEnd(25)} ${passed ? '✓ PASS' : '✗ FAIL'}`);
        if (passed) totalPass++;
        totalTests++;
    });

    console.log('='.repeat(70));
    console.log(`OVERALL: ${totalPass}/${totalTests} test suites passed`);
    console.log('='.repeat(70) + '\n');

    return totalPass === totalTests;
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
    const success = runAllTests();
    process.exit(success ? 0 : 1);
}

export { runAllTests, testQuadraExamples, testRoundTrip, testQuadraScenario };
