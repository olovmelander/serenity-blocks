
import { getBinaryEncoder, getBinaryDecoder, compareEncodingSizes } from '../src/core/network/binary-encoding.js';

console.log('=== Binary Encoder/Decoder Verification ===\n');

let testsPassed = 0;
let testsFailed = 0;

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

function assertDeepEquals(actual, expected, path = '') {
    if (actual === expected) return;

    if (typeof actual !== typeof expected) {
        throw new Error(`${path}: Type mismatch (${typeof actual} vs ${typeof expected})`);
    }

    if (Array.isArray(actual)) {
        if (actual.length !== expected.length) {
            throw new Error(`${path}: Array length mismatch (${actual.length} vs ${expected.length})`);
        }
        for (let i = 0; i < actual.length; i++) {
            assertDeepEquals(actual[i], expected[i], `${path}[${i}]`);
        }
        return;
    }

    if (typeof actual === 'object' && actual !== null) {
        const keys1 = Object.keys(actual).sort();
        const keys2 = Object.keys(expected).sort();

        // Filter out keys that might not be preserved or are optional default 0
        // e.g. undefined vs 0 or null

        for (const key of keys2) {
            if (!Object.prototype.hasOwnProperty.call(actual, key)) {
                // Check if expected[key] is a falsy value that might be omitted
                if (expected[key]) {
                    throw new Error(`${path}: Missing key '${key}' in actual`);
                }
            }
        }

        for (const key of keys1) {
            // Special handling for binary encoder approximations or omissions
            // 1. Attacker ID might be hashed -> 'unknown_HASH' if not cached
            if (key === 'attackerId' && actual[key].startsWith('unknown_')) {
                // Accept it
                continue;
            }
            // 2. Locked pieces are skipped
            if (key === 'lockedPieces') {
                continue;
            }
            // 3. Offset/reserved fields
            if (key === 'reserved') continue;

            assertDeepEquals(actual[key], expected[key], `${path}.${key}`);
        }
        return;
    }

    throw new Error(`${path}: Value mismatch (Actual: ${actual}, Expected: ${expected})`);
}

function runTest(name, fn) {
    try {
        fn();
        console.log(`✓ PASS: ${name}`);
        testsPassed++;
    } catch (e) {
        console.log(`✗ FAIL: ${name}`);
        console.error(e);
        testsFailed++;
    }
}

const encoder = getBinaryEncoder();
const decoder = getBinaryDecoder();

// === MOCK DATA GENERATORS ===

function createMockGrid() {
    const grid = [];
    for (let y = 0; y < 24; y++) {
        const row = [];
        for (let x = 0; x < 10; x += 2) {
            row[x] = { type: 'I' };
            row[x + 1] = { type: 'empty' }; // Should appear as null/empty
        }
        grid.push(row);
    }
    return grid;
}

function createPlayer(id, name) {
    return {
        steamId: id,
        name: name,
        color: '#ff0000',
        score: 123456,
        lines: 42,
        level: 10,
        frags: 5,
        isAlive: true,
        garbagePending: 3,
        dropCounter: 500,
        dropInterval: 800,
        grid: createMockGrid(),
        currentPiece: { type: 'T', x: 4, y: 10, rotation: 1 },
        nextPieces: [{ type: 'Z' }, { type: 'S' }],
        garbageEntries: [
            { type: 'line', attackerId: 'attacker_1', holeMask: 0x55 },
            { type: 'blind', attackerId: 'attacker_2', holeMask: 0xAA, duration: 4.5 },
            { type: 'full_blind', attackerId: 'attacker_1', holeMask: 0x00, duration: 6.2 }
        ],
        blindTimers: {
            field: 4.5,
            fieldMax: 6.0,
            pending: 3.2,
            pendingMax: 4.0
        },
        lockedPieces: [] // Skipped by encoder
    };
}

// Register attacker IDs for decoding
decoder.registerAttackerIds(new Map([
    ['attacker_1', {}],
    ['attacker_2', {}]
]));

// === TESTS ===

runTest('Basic Round Trip', () => {
    const original = {
        players: [createPlayer('p1', 'Player 1')],
        gamePhase: 'playing',
        winner: null,
        tick: 100
    };

    const buffer = encoder.encodeSnapshot(original);
    const decoded = decoder.decodeSnapshot(buffer);

    assertEquals(decoded.gamePhase, original.gamePhase, 'Game phase match');
    assertEquals(decoded.tick, original.tick, 'Tick match');
    assertEquals(decoded.players.length, 1, 'Player count match');

    // Check player details
    const p1 = decoded.players[0];
    assertEquals(p1.steamId, 'p1', 'Steam ID match');
    assertEquals(p1.name, 'Player 1', 'Name match');
    assertEquals(p1.score, 123456, 'Score match');
    assertEquals(p1.grid[0][0].type, 'I', 'Grid cell type match');

    // Check blind timers
    assert(p1.blindTimers !== undefined, 'blindTimers exists');
    assertEquals(p1.blindTimers.field, 4.5, 'field timer match');
    assertEquals(p1.blindTimers.fieldMax, 6.0, 'fieldMax timer match');
    assertEquals(p1.blindTimers.pending, 3.2, 'pending timer match');
    assertEquals(p1.blindTimers.pendingMax, 4.0, 'pendingMax timer match');

    // Check garbage entry types & durations
    assertEquals(p1.garbageEntries.length, 3, 'garbage entries count match');
    assertEquals(p1.garbageEntries[0].type, 'line', 'garbage entry 0 type match');
    assertEquals(p1.garbageEntries[1].type, 'blind', 'garbage entry 1 type match');
    assertEquals(p1.garbageEntries[1].duration, 4.5, 'garbage entry 1 duration match');
    assertEquals(p1.garbageEntries[2].type, 'full_blind', 'garbage entry 2 type match');
    assertEquals(p1.garbageEntries[2].duration, 6.2, 'garbage entry 2 duration match');
});

runTest('UTF-8 String Handling', () => {
    const original = {
        players: [createPlayer('p1', 'José §±!@#')],
        gamePhase: 'waiting',
        tick: 200
    };

    const buffer = encoder.encodeSnapshot(original);
    const decoded = decoder.decodeSnapshot(buffer);

    assertEquals(decoded.players[0].name, 'José §±!@#', 'UTF-8 Name match');
});

runTest('Max Players (8)', () => {
    const players = [];
    for (let i = 0; i < 8; i++) {
        players.push(createPlayer(`p${i}`, `Player ${i}`));
    }

    const original = {
        players,
        gamePhase: 'playing',
        tick: 300
    };

    const buffer = encoder.encodeSnapshot(original);
    const decoded = decoder.decodeSnapshot(buffer);

    assertEquals(decoded.players.length, 8, '8 players match');
    assertEquals(decoded.players[7].steamId, 'p7', 'Last player ID match');

    // Check size
    console.log(`   8-player snapshot size: ${buffer.byteLength} bytes`);
});

runTest('Edge Case: Empty Arrays', () => {
    const p1 = createPlayer('p1', 'EmptyMan');
    p1.nextPieces = [];
    p1.garbageEntries = [];
    p1.grid = [];
    p1.currentPiece = null;

    const original = {
        players: [p1],
        gamePhase: 'playing',
        tick: 400
    };

    const buffer = encoder.encodeSnapshot(original);
    const decoded = decoder.decodeSnapshot(buffer);

    assertEquals(decoded.players[0].nextPieces.length, 0, 'Empty next pieces');
    assertEquals(decoded.players[0].garbageEntries.length, 0, 'Empty garbage');
    assertEquals(decoded.players[0].currentPiece, null, 'Null current piece');
});

runTest('Edge Case: Max Garbage', () => {
    const p1 = createPlayer('p1', 'GarbageMan');
    p1.garbageEntries = [];
    for (let i = 0; i < 300; i++) { // More than 255 (byte limit)
        p1.garbageEntries.push({ type: 'line', attackerId: 'a', holeMask: 0 });
    }

    const original = {
        players: [p1],
        gamePhase: 'playing',
        tick: 500
    };

    const buffer = encoder.encodeSnapshot(original);
    const decoded = decoder.decodeSnapshot(buffer);

    // Should be capped at 255
    assertEquals(decoded.players[0].garbageEntries.length, 255, 'Garbage capped at 255');
});

// Final Summary
console.log('\n=== Summary ===');
if (testsFailed > 0) {
    console.log(`❌ ${testsFailed} tests failed`);
    process.exit(1);
} else {
    console.log(`✅ All ${testsPassed} tests passed`);
    process.exit(0);
}
