/**
 * @fileoverview Unit tests for Quadra-style deterministic garbage system
 * Tests garbage calculation, serialization, and attack packaging
 * Run with: node tests/unit/test-garbage-system.js
 */

// Mock constants for testing
const MOCK_COLS = 10;

// Import test utilities
function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
}

function assertArrayEquals(actual, expected, message) {
    if (actual.length !== expected.length) {
        throw new Error(`${message}\nExpected length: ${expected.length}\nActual length: ${actual.length}`);
    }
    for (let i = 0; i < actual.length; i++) {
        if (actual[i] !== expected[i]) {
            throw new Error(`${message}\nExpected: [${expected.join(', ')}]\nActual: [${actual.join(', ')}]`);
        }
    }
}

// Mock GarbageAttack class
class GarbageAttack {
    constructor({
        id = null,
        depth = 0,
        complexity = 0,
        rows = 0,
        holeMasks = [],
        cleanBonus = 0,
        cleanMasks = [],
        sendForClean = false,
        attackType = 'lines',
        param = 0,
        metadata = {}
    } = {}) {
        this.id = id;
        this.depth = depth;
        this.complexity = complexity;
        this.rows = rows;
        this.holeMasks = holeMasks;
        this.cleanBonus = cleanBonus;
        this.cleanMasks = cleanMasks;
        this.sendForClean = sendForClean;
        this.attackType = attackType;
        this.param = param;
        this.metadata = metadata;
    }

    withId(id) {
        this.id = id;
        return this;
    }

    getTotalLines() {
        return (this.cleanMasks?.length || 0) + (this.holeMasks?.length || 0);
    }

    toJSON() {
        return {
            id: this.id,
            depth: this.depth,
            complexity: this.complexity,
            rows: this.rows,
            holeMasks: [...this.holeMasks],
            cleanBonus: this.cleanBonus,
            cleanMasks: [...this.cleanMasks],
            sendForClean: this.sendForClean,
            attackType: this.attackType,
            param: this.param,
            metadata: { ...this.metadata }
        };
    }

    static fromJSON(payload = {}) {
        return new GarbageAttack({
            id: payload.id || null,
            depth: payload.depth || 0,
            complexity: payload.complexity || 0,
            rows: payload.rows || 0,
            holeMasks: Array.isArray(payload.holeMasks) ? payload.holeMasks.slice() : [],
            cleanBonus: payload.cleanBonus || 0,
            cleanMasks: Array.isArray(payload.cleanMasks) ? payload.cleanMasks.slice() : [],
            sendForClean: !!payload.sendForClean,
            attackType: payload.attackType || 'lines',
            param: payload.param || 0,
            metadata: payload.metadata ? { ...payload.metadata } : {}
        });
    }
}

// Mock calculateGarbage function (simplified version for testing)
function maskArrayToBits(mask) {
    let bits = 0;
    for (let x = 0; x < MOCK_COLS; x++) {
        if (mask[x]) {
            bits |= (1 << x);
        }
    }
    return bits;
}

function columnsToMask(columns) {
    const mask = Array(MOCK_COLS).fill(false);
    if (Array.isArray(columns)) {
        columns.forEach(col => {
            if (col >= 0 && col < MOCK_COLS) {
                mask[col] = true;
            }
        });
    }
    return mask;
}

function normalizeMaskRow(row, manualColumns) {
    if (!row) {
        return columnsToMask(manualColumns.length ? manualColumns : [Math.floor(MOCK_COLS / 2)]);
    }

    if (Array.isArray(row) && row.length === MOCK_COLS && typeof row[0] === 'boolean') {
        return row.slice();
    }

    if (Array.isArray(row)) {
        const mask = columnsToMask(row);
        if (!mask.some(flag => flag)) {
            const fallback = manualColumns.length ? manualColumns : [Math.floor(MOCK_COLS / 2)];
            fallback.forEach(col => {
                if (col >= 0 && col < MOCK_COLS) {
                    mask[col] = true;
                }
            });
        }
        return mask;
    }

    return columnsToMask(manualColumns.length ? manualColumns : [Math.floor(MOCK_COLS / 2)]);
}

function calculateGarbage(summary, rules = {}) {
    if (!summary) {
        return new GarbageAttack({});
    }

    const depth = summary.depth ?? summary.totalLines ?? 0;
    const complexity = summary.complexity ?? summary.comboStages ?? 0;
    const rawMask = summary.holeMask ?? summary.holeMaskBuffer ?? [];
    const manualColumns = summary.manualColumns || [];
    const maskMatrix = rawMask.map(row => normalizeMaskRow(row, manualColumns));

    const rowsToSend = Math.max(0, depth - 1);
    const holeMasks = maskMatrix.slice(0, rowsToSend).map(maskArrayToBits);

    const sendForClean = !!summary.sendForClean;
    const cleanBonus = sendForClean ? Math.floor((depth + 1) / 2) : 0;

    const CLEAN_PATTERN_EVEN = [3, 6];
    const CLEAN_PATTERN_ODD = [0, 3, 6, 9];
    const cleanMasks = [];
    for (let i = 0; i < cleanBonus; i++) {
        const pattern = (i % 2 === 0) ? CLEAN_PATTERN_EVEN : CLEAN_PATTERN_ODD;
        cleanMasks.push(maskArrayToBits(columnsToMask(pattern)));
    }

    return new GarbageAttack({
        depth,
        complexity,
        rows: rowsToSend,
        holeMasks,
        cleanBonus,
        cleanMasks,
        sendForClean,
        attackType: 'lines',
        param: 0,
        metadata: {
            manualColumns: manualColumns.slice(),
            sourceColor: summary.sourceColor || null,
            sourcePiece: summary.sourcePiece || null,
            sequence: summary.sequence
        }
    });
}

// ==================== TESTS ====================

console.log('=== Quadra Garbage System Unit Tests ===\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
    try {
        testFn();
        console.log(`✓ PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`✗ FAIL: ${name}`);
        console.log(`  Error: ${error.message}`);
        testsFailed++;
    }
}

// Test 1: Basic single line clear
runTest('Single line clear generates correct attack', () => {
    const summary = {
        depth: 1,
        complexity: 1,
        holeMask: [
            [false, false, false, true, true, false, false, false, false, false] // Holes at columns 3,4
        ],
        manualColumns: [3, 4],
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.depth, 1, 'Depth should be 1');
    assertEquals(attack.complexity, 1, 'Complexity should be 1');
    assertEquals(attack.rows, 0, 'Rows to send should be 0 (depth-1)');
    assertEquals(attack.cleanBonus, 0, 'Clean bonus should be 0');
    assertEquals(attack.sendForClean, false, 'sendForClean should be false');
    assertEquals(attack.holeMasks.length, 0, 'Should send 0 hole masks for 1 line');
});

// Test 2: Double line clear (basic attack)
runTest('Double line clear generates 1 garbage line', () => {
    const summary = {
        depth: 2,
        complexity: 1,
        holeMask: [
            [false, false, false, true, false, false, false, false, false, false], // Hole at column 3
            [false, false, false, true, false, false, false, false, false, false]  // Hole at column 3
        ],
        manualColumns: [3],
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.depth, 2, 'Depth should be 2');
    assertEquals(attack.rows, 1, 'Rows to send should be 1 (depth-1)');
    assertEquals(attack.holeMasks.length, 1, 'Should send 1 hole mask');
});

// Test 3: Tetris (4 line clear)
runTest('Tetris generates 3 garbage lines', () => {
    const summary = {
        depth: 4,
        complexity: 1,
        holeMask: [
            [false, false, false, true, true, true, true, false, false, false], // I-piece at columns 3-6
            [false, false, false, true, true, true, true, false, false, false],
            [false, false, false, true, true, true, true, false, false, false],
            [false, false, false, true, true, true, true, false, false, false]
        ],
        manualColumns: [3, 4, 5, 6],
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.depth, 4, 'Depth should be 4');
    assertEquals(attack.rows, 3, 'Rows to send should be 3 (depth-1)');
    assertEquals(attack.holeMasks.length, 3, 'Should send 3 hole masks');
});

// Test 4: Cascade combo (multiple stages)
runTest('Cascade combo increases complexity', () => {
    const summary = {
        depth: 6, // 2 lines + 4 line cascade
        complexity: 2, // 2 stages
        holeMask: [
            [false, false, false, true, false, false, false, false, false, false],
            [false, false, false, true, false, false, false, false, false, false],
            [true, false, false, false, false, false, false, false, false, false], // Cascade at column 0
            [true, false, false, false, false, false, false, false, false, false],
            [true, false, false, false, false, false, false, false, false, false],
            [true, false, false, false, false, false, false, false, false, false]
        ],
        manualColumns: [3],
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.depth, 6, 'Depth should be 6');
    assertEquals(attack.complexity, 2, 'Complexity should be 2');
    assertEquals(attack.rows, 5, 'Rows to send should be 5 (depth-1)');
    assertEquals(attack.holeMasks.length, 5, 'Should send 5 hole masks');
});

// Test 5: Clean field bonus
runTest('Clean field grants bonus lines', () => {
    const summary = {
        depth: 5,
        complexity: 1,
        holeMask: [
            [false, false, false, true, false, false, false, false, false, false],
            [false, false, false, true, false, false, false, false, false, false],
            [false, false, false, true, false, false, false, false, false, false],
            [false, false, false, true, false, false, false, false, false, false],
            [false, false, false, true, false, false, false, false, false, false]
        ],
        manualColumns: [3],
        sendForClean: true // Field is empty after clear!
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.sendForClean, true, 'sendForClean should be true');
    const expectedCleanBonus = Math.floor((5 + 1) / 2); // floor((depth+1)/2) = floor(6/2) = 3
    assertEquals(attack.cleanBonus, expectedCleanBonus, `Clean bonus should be ${expectedCleanBonus}`);
    assertEquals(attack.cleanMasks.length, expectedCleanBonus, `Should have ${expectedCleanBonus} clean masks`);

    // Total lines sent = (depth-1) + cleanBonus = 4 + 3 = 7
    const totalLines = attack.getTotalLines();
    assertEquals(totalLines, 4 + expectedCleanBonus, `Total lines should be ${4 + expectedCleanBonus}`);
});

// Test 6: O-piece multi-column holes
runTest('O-piece creates 2-column wide holes', () => {
    const summary = {
        depth: 3,
        complexity: 1,
        holeMask: [
            [false, false, false, false, true, true, false, false, false, false], // O-piece at columns 4-5
            [false, false, false, false, true, true, false, false, false, false],
            [false, false, false, false, true, true, false, false, false, false]
        ],
        manualColumns: [4, 5],
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.rows, 2, 'Should send 2 rows');
    assertEquals(attack.holeMasks.length, 2, 'Should have 2 hole masks');

    // Check that both columns 4 and 5 are marked as holes in the bitmask
    const expectedBits = (1 << 4) | (1 << 5); // Bits 4 and 5 set
    attack.holeMasks.forEach((mask, i) => {
        assert((mask & expectedBits) === expectedBits, `Mask ${i} should have bits 4 and 5 set`);
    });
});

// Test 7: Serialization and deserialization
runTest('Attack serialization preserves all data', () => {
    const original = new GarbageAttack({
        id: 'P1-A42',
        depth: 8,
        complexity: 3,
        rows: 7,
        holeMasks: [0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400],
        cleanBonus: 2,
        cleanMasks: [0x48, 0x209],
        sendForClean: true,
        attackType: 'lines',
        param: 0,
        metadata: { sourceColor: '#FF0000', sourcePiece: 'I' }
    });

    const json = original.toJSON();
    const restored = GarbageAttack.fromJSON(json);

    assertEquals(restored.id, 'P1-A42', 'ID should match');
    assertEquals(restored.depth, 8, 'Depth should match');
    assertEquals(restored.complexity, 3, 'Complexity should match');
    assertEquals(restored.rows, 7, 'Rows should match');
    assertEquals(restored.cleanBonus, 2, 'Clean bonus should match');
    assertEquals(restored.sendForClean, true, 'sendForClean should match');
    assertArrayEquals(restored.holeMasks, original.holeMasks, 'Hole masks should match');
    assertArrayEquals(restored.cleanMasks, original.cleanMasks, 'Clean masks should match');
});

// Test 8: Hole mask respects cascade position changes
runTest('Cascade holes change position between stages', () => {
    const summary = {
        depth: 5,
        complexity: 2,
        holeMask: [
            // First clear: right side (columns 7-9)
            [false, false, false, false, false, false, false, true, true, true],
            [false, false, false, false, false, false, false, true, true, true],
            // Cascade clear: left side (column 1)
            [false, true, false, false, false, false, false, false, false, false],
            [false, true, false, false, false, false, false, false, false, false],
            [false, true, false, false, false, false, false, false, false, false]
        ],
        manualColumns: [7, 8, 9],
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.holeMasks.length, 4, 'Should have 4 hole masks');

    // First two masks should have right-side holes (columns 7-9)
    const rightHoleBits = (1 << 7) | (1 << 8) | (1 << 9);
    assert((attack.holeMasks[0] & rightHoleBits) !== 0, 'First mask should have right-side holes');
    assert((attack.holeMasks[1] & rightHoleBits) !== 0, 'Second mask should have right-side holes');

    // Last three masks should have left-side hole (column 1)
    const leftHoleBits = (1 << 1);
    assert((attack.holeMasks[2] & leftHoleBits) !== 0, 'Third mask should have left-side hole');
    assert((attack.holeMasks[3] & leftHoleBits) !== 0, 'Fourth mask should have left-side hole');
});

// Test 9: Empty summary generates empty attack
runTest('Empty summary generates empty attack', () => {
    const attack = calculateGarbage(null);

    assertEquals(attack.depth, 0, 'Depth should be 0');
    assertEquals(attack.complexity, 0, 'Complexity should be 0');
    assertEquals(attack.rows, 0, 'Rows should be 0');
    assertEquals(attack.holeMasks.length, 0, 'Should have no hole masks');
});

// Test 10: Fallback to center column when no holes specified
runTest('Fallback to center column for missing holes', () => {
    const summary = {
        depth: 2,
        complexity: 1,
        holeMask: [
            Array(MOCK_COLS).fill(false), // No holes specified
            Array(MOCK_COLS).fill(false)
        ],
        manualColumns: [], // No manual columns
        sendForClean: false
    };

    const attack = calculateGarbage(summary);

    assertEquals(attack.rows, 1, 'Should send 1 row');

    // Should fallback to center column (column 5 for 10 columns)
    const centerBit = 1 << Math.floor(MOCK_COLS / 2);
    assert((attack.holeMasks[0] & centerBit) !== 0, 'Should have center column as hole');
});

// ==================== SUMMARY ====================

console.log('\n=== Test Summary ===');
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
