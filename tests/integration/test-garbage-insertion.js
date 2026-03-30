/**
 * @fileoverview Integration tests for garbage insertion into the playfield
 * Tests garbage row insertion, hole placement, and top-out detection
 * Run with: node tests/integration/test-garbage-insertion.js
 */

// Mock constants
const COLS = 10;
const ROWS = 20;
const HIDDEN_ROWS = 4;

// Test utilities
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

// Mock board generation
function generateBoard(lockedPieces) {
    const board = Array.from(
        { length: ROWS + HIDDEN_ROWS },
        () => Array(COLS).fill(null)
    );

    for (const piece of lockedPieces) {
        piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const boardX = piece.x + x;
                    const boardY = piece.y + y;

                    if (boardY >= 0 && boardY < board.length && boardX >= 0 && boardX < COLS) {
                        board[boardY][boardX] = {
                            color: piece.shapeKey,
                            id: piece.pieceId || piece.shapeKey
                        };
                    }
                }
            });
        });
    }

    return board;
}

function getHighestOccupiedRow(board) {
    for (let y = 0; y < board.length; y++) {
        if (board[y].some(cell => cell !== null)) {
            return y;
        }
    }
    return ROWS + HIDDEN_ROWS;
}

function bitsToColumns(bits) {
    const columns = [];
    for (let x = 0; x < COLS; x++) {
        if ((bits & (1 << x)) !== 0) {
            columns.push(x);
        }
    }
    return columns;
}

function isPartOfPiece(boardX, boardY, piece) {
    const relX = boardX - piece.x;
    const relY = boardY - piece.y;

    if (relY >= 0 && relY < piece.shape.length &&
        relX >= 0 && relX < piece.shape[relY].length) {
        return piece.shape[relY][relX] > 0;
    }

    return false;
}

function settleFloatingBlocksAfterGarbage(lockedPieces) {
    let totalSteps = 0;
    let falling = true;

    while (falling) {
        falling = false;
        const board = generateBoard(lockedPieces);

        const pieces = lockedPieces
            .filter(piece => piece && Array.isArray(piece.shape) && piece.shape.length > 0)
            .sort((a, b) => {
                const aHeight = Array.isArray(a.shape) ? a.shape.length : 0;
                const bHeight = Array.isArray(b.shape) ? b.shape.length : 0;
                const aY = typeof a.y === 'number' ? a.y : 0;
                const bY = typeof b.y === 'number' ? b.y : 0;
                return (bY + bHeight) - (aY + aHeight);
            });

        for (const piece of pieces) {
            const originX = typeof piece.x === 'number' ? piece.x : 0;
            const originY = typeof piece.y === 'number' ? piece.y : 0;

            let canFall = true;

            for (let localY = piece.shape.length - 1; localY >= 0 && canFall; localY--) {
                const row = piece.shape[localY];

                for (let localX = 0; localX < row.length; localX++) {
                    if (row[localX] <= 0) continue;

                    const boardX = originX + localX;
                    const boardY = originY + localY + 1;

                    if (boardY >= ROWS + HIDDEN_ROWS) {
                        canFall = false;
                        break;
                    }

                    const occupant = board[boardY]?.[boardX] ?? null;
                    if (occupant !== null && !isPartOfPiece(boardX, boardY, piece)) {
                        canFall = false;
                        break;
                    }
                }
            }

            if (canFall) {
                piece.y = originY + 1;
                totalSteps++;
                falling = true;
            }
        }
    }

    return totalSteps;
}

// Mock insertGarbageEntries function
function insertGarbageEntries(lockedPieces, entries) {
    const lineEntries = entries.filter(entry => entry.type === 'line');
    if (lineEntries.length === 0) {
        return {
            success: true,
            topOut: false,
            settledSteps: 0,
            linesAfterInsertion: []
        };
    }

    const board = generateBoard(lockedPieces);
    const highestOccupiedRow = getHighestOccupiedRow(board);
    const newHighestRow = highestOccupiedRow - lineEntries.length;

    if (newHighestRow < HIDDEN_ROWS) {
        return { success: false, topOut: true };
    }

    // Shift existing pieces up
    lockedPieces.forEach(piece => {
        piece.y -= lineEntries.length;
    });

    const baseY = ROWS + HIDDEN_ROWS - lineEntries.length;

    // Insert garbage rows
    lineEntries.forEach((entry, index) => {
        const y = baseY + index;
        const holeColumns = bitsToColumns(entry.holeMask);
        const holeSet = new Set(holeColumns);
        const row = [];

        for (let x = 0; x < COLS; x++) {
            row.push(holeSet.has(x) ? 0 : 1);
        }

        lockedPieces.push({
            shapeKey: entry.variant === 'clean' ? 'CLEAN_GARBAGE' : 'GARBAGE',
            shape: [row],
            x: 0,
            y,
            color: entry.color || '#808080',
            pieceId: `${entry.attackId || 'garbage'}-${index}`,
            isGarbage: true,
            garbageMeta: {
                attackId: entry.attackId || null,
                variant: entry.variant || 'normal',
                connectTop: !!entry.connectAbove,
                connectBottom: !!entry.connectBelow,
                combo: entry.combo,
                depth: entry.depth
            }
        });
    });

    const settledSteps = settleFloatingBlocksAfterGarbage(lockedPieces);

    const boardAfter = generateBoard(lockedPieces);
    const linesAfterInsertion = [];
    for (let y = HIDDEN_ROWS; y < ROWS + HIDDEN_ROWS; y++) {
        if (boardAfter[y].every(cell => cell !== null)) {
            linesAfterInsertion.push(y);
        }
    }

    return {
        success: true,
        topOut: false,
        settledSteps,
        linesAfterInsertion
    };
}

// ==================== TESTS ====================

console.log('=== Garbage Insertion Integration Tests ===\n');

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

// Test 1: Basic garbage insertion
runTest('Insert single garbage line with hole', () => {
    const lockedPieces = [];
    const entries = [{
        type: 'line',
        attackId: 'A1',
        variant: 'normal',
        holeMask: 0x10, // Hole at column 4
        color: '#808080',
        team: null,
        blindTime: 0,
        connectAbove: false,
        connectBelow: false,
        isLastInBurst: true,
        combo: 1,
        depth: 2
    }];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');
    assertEquals(result.topOut, false, 'Should not cause top out');
    assertEquals(lockedPieces.length, 1, 'Should have 1 garbage piece');

    const garbagePiece = lockedPieces[0];
    assertEquals(garbagePiece.isGarbage, true, 'Should be marked as garbage');
    assertEquals(garbagePiece.y, ROWS + HIDDEN_ROWS - 1, 'Should be at bottom row');
    assertEquals(garbagePiece.shape[0].length, COLS, 'Should span full width');

    // Check hole placement
    assertEquals(garbagePiece.shape[0][4], 0, 'Column 4 should have a hole');
    for (let x = 0; x < COLS; x++) {
        if (x !== 4) {
            assert(garbagePiece.shape[0][x] > 0, `Column ${x} should be filled`);
        }
    }
});

// Test 2: Multiple garbage lines
runTest('Insert multiple garbage lines', () => {
    const lockedPieces = [];
    const entries = [
        {
            type: 'line',
            attackId: 'A1',
            variant: 'normal',
            holeMask: 0x10, // Hole at column 4
            color: '#808080',
            connectAbove: false,
            connectBelow: true,
            isLastInBurst: false
        },
        {
            type: 'line',
            attackId: 'A1',
            variant: 'normal',
            holeMask: 0x10,
            color: '#808080',
            connectAbove: true,
            connectBelow: true,
            isLastInBurst: false
        },
        {
            type: 'line',
            attackId: 'A1',
            variant: 'normal',
            holeMask: 0x10,
            color: '#808080',
            connectAbove: true,
            connectBelow: false,
            isLastInBurst: true
        }
    ];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');
    assertEquals(lockedPieces.length, 3, 'Should have 3 garbage pieces');

    // Check that they stack properly
    const baseY = ROWS + HIDDEN_ROWS - 3;
    assertEquals(lockedPieces[0].y, baseY, 'First row should be at correct Y');
    assertEquals(lockedPieces[1].y, baseY + 1, 'Second row should be at correct Y');
    assertEquals(lockedPieces[2].y, baseY + 2, 'Third row should be at correct Y');

    // Check connection metadata
    assertEquals(lockedPieces[0].garbageMeta.connectTop, false, 'First should not connect top');
    assertEquals(lockedPieces[0].garbageMeta.connectBottom, true, 'First should connect bottom');
    assertEquals(lockedPieces[1].garbageMeta.connectTop, true, 'Middle should connect top');
    assertEquals(lockedPieces[1].garbageMeta.connectBottom, true, 'Middle should connect bottom');
    assertEquals(lockedPieces[2].garbageMeta.connectTop, true, 'Last should connect top');
    assertEquals(lockedPieces[2].garbageMeta.connectBottom, false, 'Last should not connect bottom');
});

// Test 3: Multi-column holes (O-piece)
runTest('Insert garbage with multi-column holes', () => {
    const lockedPieces = [];
    const entries = [{
        type: 'line',
        attackId: 'A1',
        variant: 'normal',
        holeMask: 0x30, // Holes at columns 4 and 5 (bits 4 and 5)
        color: '#808080',
        isLastInBurst: true
    }];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');

    const garbagePiece = lockedPieces[0];
    assertEquals(garbagePiece.shape[0][4], 0, 'Column 4 should have a hole');
    assertEquals(garbagePiece.shape[0][5], 0, 'Column 5 should have a hole');

    // All other columns should be filled
    for (let x = 0; x < COLS; x++) {
        if (x !== 4 && x !== 5) {
            assert(garbagePiece.shape[0][x] > 0, `Column ${x} should be filled`);
        }
    }
});

// Test 4: Existing pieces shift up
runTest('Existing pieces shift up when garbage inserted', () => {
    const lockedPieces = [
        {
            shapeKey: 'I',
            shape: [[1, 1, 1, 1]],
            x: 3,
            y: 22, // Near bottom
            color: '#00FFFF',
            pieceId: 'piece1'
        }
    ];

    const originalY = lockedPieces[0].y;

    const entries = [{
        type: 'line',
        attackId: 'A1',
        variant: 'normal',
        holeMask: 0x04,
        color: '#808080',
        isLastInBurst: true
    }];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');
    assertEquals(lockedPieces.length, 2, 'Should have 2 pieces');

    // Original piece should have shifted up by 1
    assertEquals(lockedPieces[0].y, originalY - 1, 'Original piece should shift up by 1');
});

// Test 5: Top-out detection
runTest('Detect top-out when garbage causes overflow', () => {
    // Create pieces stacked very high
    const lockedPieces = [];
    for (let y = HIDDEN_ROWS; y < HIDDEN_ROWS + 5; y++) {
        lockedPieces.push({
            shapeKey: 'I',
            shape: [[1, 1, 1, 1]],
            x: 0,
            y: y,
            color: '#00FFFF',
            pieceId: `piece${y}`
        });
    }

    // Try to insert 10 garbage lines (should cause top-out)
    const entries = [];
    for (let i = 0; i < 10; i++) {
        entries.push({
            type: 'line',
            attackId: 'A1',
            variant: 'normal',
            holeMask: 0x01,
            color: '#808080',
            isLastInBurst: i === 9
        });
    }

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, false, 'Insertion should fail');
    assertEquals(result.topOut, true, 'Should detect top-out');
});

// Test 6: Clean variant marking
runTest('Clean garbage has correct variant marking', () => {
    const lockedPieces = [];
    const entries = [
        {
            type: 'line',
            attackId: 'CLEAN1',
            variant: 'clean',
            holeMask: 0x48, // Pattern for clean garbage
            color: '#808080',
            isLastInBurst: false
        },
        {
            type: 'line',
            attackId: 'CLEAN1',
            variant: 'normal',
            holeMask: 0x10,
            color: '#808080',
            isLastInBurst: true
        }
    ];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');
    assertEquals(lockedPieces.length, 2, 'Should have 2 pieces');

    assertEquals(lockedPieces[0].shapeKey, 'CLEAN_GARBAGE', 'First should be clean garbage');
    assertEquals(lockedPieces[0].garbageMeta.variant, 'clean', 'First should have clean variant');

    assertEquals(lockedPieces[1].shapeKey, 'GARBAGE', 'Second should be normal garbage');
    assertEquals(lockedPieces[1].garbageMeta.variant, 'normal', 'Second should have normal variant');
});

// Test 7: Wide holes (I-piece horizontal)
runTest('Insert garbage with wide holes (I-piece)', () => {
    const lockedPieces = [];
    const entries = [{
        type: 'line',
        attackId: 'A1',
        variant: 'normal',
        holeMask: 0x78, // Holes at columns 3, 4, 5, 6 (I-piece)
        color: '#808080',
        isLastInBurst: true
    }];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');

    const garbagePiece = lockedPieces[0];

    // Check all I-piece columns are holes
    assertEquals(garbagePiece.shape[0][3], 0, 'Column 3 should have a hole');
    assertEquals(garbagePiece.shape[0][4], 0, 'Column 4 should have a hole');
    assertEquals(garbagePiece.shape[0][5], 0, 'Column 5 should have a hole');
    assertEquals(garbagePiece.shape[0][6], 0, 'Column 6 should have a hole');

    // All other columns should be filled
    for (let x = 0; x < COLS; x++) {
        if (x < 3 || x > 6) {
            assert(garbagePiece.shape[0][x] > 0, `Column ${x} should be filled`);
        }
    }
});

// Test 8: Empty entry list
runTest('Empty entry list returns success', () => {
    const lockedPieces = [];
    const entries = [];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Empty insertion should succeed');
    assertEquals(result.topOut, false, 'Should not cause top-out');
    assertEquals(lockedPieces.length, 0, 'Should not add any pieces');
});

// Test 9: Non-line entries are ignored
runTest('Non-line entries are filtered out', () => {
    const lockedPieces = [];
    const entries = [
        {
            type: 'blind',
            attackId: 'BLIND1',
            duration: 5
        },
        {
            type: 'line',
            attackId: 'A1',
            variant: 'normal',
            holeMask: 0x10,
            color: '#808080',
            isLastInBurst: true
        }
    ];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');
    assertEquals(lockedPieces.length, 1, 'Should only insert line entries');
});

// Test 10: Attack metadata preservation
runTest('Attack metadata is preserved in garbage pieces', () => {
    const lockedPieces = [];
    const entries = [{
        type: 'line',
        attackId: 'P2-A42',
        variant: 'normal',
        holeMask: 0x10,
        color: '#FF0000',
        team: 'red',
        combo: 3,
        depth: 7,
        isLastInBurst: true
    }];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Insertion should succeed');

    const garbagePiece = lockedPieces[0];
    assertEquals(garbagePiece.color, '#FF0000', 'Should preserve color');
    assertEquals(garbagePiece.garbageMeta.attackId, 'P2-A42', 'Should preserve attack ID');
    assertEquals(garbagePiece.garbageMeta.combo, 3, 'Should preserve combo');
    assertEquals(garbagePiece.garbageMeta.depth, 7, 'Should preserve depth');
});

// Test 11: Floating pieces settle into holes after garbage insertion
runTest('Floating pieces settle into garbage holes', () => {
    const floatingPiece = {
        shapeKey: 'L',
        shape: [[1]],
        x: 9,
        y: ROWS + HIDDEN_ROWS - 3,
        color: '#FF8800',
        pieceId: 'floating-piece'
    };

    const lockedPieces = [floatingPiece];

    const entries = [{
        type: 'line',
        attackId: 'A1',
        variant: 'normal',
        holeMask: 1 << 9, // Hole aligns with floating piece column
        color: '#808080',
        isLastInBurst: true
    }];

    const result = insertGarbageEntries(lockedPieces, entries);

    assertEquals(result.success, true, 'Garbage insertion should succeed');
    assertEquals(result.linesAfterInsertion.length, 1, 'Should detect the filled line immediately');
    assertEquals(
        result.linesAfterInsertion[0],
        ROWS + HIDDEN_ROWS - 1,
        'Detected line should correspond to the bottom row'
    );
    assert(result.settledSteps > 0, 'Should register at least one settling step for the floating block');

    const settledPiece = lockedPieces.find(piece => piece.pieceId === 'floating-piece');
    assert(settledPiece, 'Floating piece should remain in locked pieces');
    assertEquals(
        settledPiece.y,
        ROWS + HIDDEN_ROWS - 1,
        'Floating piece should settle into the bottom hole created by garbage'
    );
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
