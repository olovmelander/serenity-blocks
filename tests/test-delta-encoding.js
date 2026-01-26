
import { getBinaryEncoder, getBinaryDecoder } from '../src/core/network/binary-encoding.js';

console.log('=== Delta Encoding Verification ===\n');

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

// Mock Data
function createPlayer(id, score, lines) {
    return {
        steamId: id,
        name: `Player ${id}`,
        color: '#ff0000',
        score: score,
        lines: lines,
        level: 1,
        frags: 0,
        isAlive: true,
        garbagePending: 0,
        dropCounter: 0,
        dropInterval: 1000,
        grid: [], // Empty grid
        currentPiece: { type: 'T', x: 5, y: 5, rotation: 0 },
        nextPieces: [{ type: 'Z' }],
        garbageEntries: []
    };
}

runTest('Delta: No Changes', () => {
    const baseline = {
        players: [createPlayer('p1', 100, 10)],
        gamePhase: 'playing',
        tick: 100
    };
    const current = JSON.parse(JSON.stringify(baseline));
    current.tick = 101;

    const buffer = encoder.encodeDeltaSnapshot(current, baseline);
    assert(buffer !== null, 'Buffer should not be null');
    console.log(`   Delta size (no changes): ${buffer.byteLength} bytes`);

    const decoded = decoder.decodeDeltaSnapshot(buffer, baseline);
    assertEquals(decoded.tick, 101, 'Tick match');
    assertEquals(decoded.players[0].score, 100, 'Score match');
});

runTest('Delta: Stats Change', () => {
    const baseline = {
        players: [createPlayer('p1', 100, 10)],
        gamePhase: 'playing',
        tick: 100
    };
    const current = JSON.parse(JSON.stringify(baseline));
    current.tick = 105;
    current.players[0].score = 500; // changed
    current.players[0].lines = 12; // changed

    const buffer = encoder.encodeDeltaSnapshot(current, baseline);
    console.log(`   Delta size (stats change): ${buffer.byteLength} bytes`);

    const decoded = decoder.decodeDeltaSnapshot(buffer, baseline);
    assertEquals(decoded.players[0].score, 500, 'Score updated');
    assertEquals(decoded.players[0].lines, 12, 'Lines updated');
    assertEquals(decoded.players[0].name, 'Player p1', 'Name preserved from baseline');
});

runTest('Delta: Grid Change', () => {
    const baseline = {
        players: [createPlayer('p1', 100, 10)],
        gamePhase: 'playing',
        tick: 100
    };
    baseline.players[0].grid = Array(24).fill(null).map(() => Array(10).fill(null));

    const current = JSON.parse(JSON.stringify(baseline));
    current.tick = 101;
    // Change one cell
    current.players[0].grid[23][0] = { type: 'I' };

    const buffer = encoder.encodeDeltaSnapshot(current, baseline);
    console.log(`   Delta size (grid change): ${buffer.byteLength} bytes`);

    const decoded = decoder.decodeDeltaSnapshot(buffer, baseline);

    // Check grid content
    const cell = decoded.players[0].grid[23][0];
    assert(cell && cell.type === 'I', 'Grid update received');
});

runTest('Delta: Multi-Player Mixed', () => {
    const baseline = {
        players: [createPlayer('p1', 100, 0), createPlayer('p2', 200, 0)],
        gamePhase: 'playing',
        tick: 100
    };

    const current = JSON.parse(JSON.stringify(baseline));
    current.tick = 110;
    current.players[0].score = 150; // P1 changed
    // P2 unchanged

    const buffer = encoder.encodeDeltaSnapshot(current, baseline);
    const decoded = decoder.decodeDeltaSnapshot(buffer, baseline);

    assertEquals(decoded.players[0].score, 150, 'P1 updated');
    assertEquals(decoded.players[1].score, 200, 'P2 preserved');
});

console.log('\n=== Summary ===');
if (testsFailed > 0) {
    console.log(`❌ ${testsFailed} tests failed`);
    process.exit(1);
} else {
    console.log(`✅ All ${testsPassed} tests passed`);
    process.exit(0);
}
