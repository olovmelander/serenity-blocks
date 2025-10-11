/**
 * @fileoverview Integration tests for garbage queue system
 * Tests FIFO queueing, burst handling, and blind attack processing
 * Run with: node tests/integration/test-garbage-queue.js
 */

// Mock constants
const MOCK_COLS = 10;

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

    expandEntries(context = {}) {
        const entries = [];
        const attackId = this.id || 'attack';
        const color = context.color || '#808080';
        const team = context.team || null;

        if (this.attackType === 'blind' && this.param > 0) {
            entries.push({
                type: 'blind',
                attackId,
                duration: this.param,
                combo: this.complexity,
                depth: this.depth
            });
        }

        const totalLines = this.getTotalLines();
        let ordinal = 0;

        const pushLineEntry = (maskBits, variant) => {
            entries.push({
                type: 'line',
                attackId,
                variant,
                holeMask: maskBits,
                color,
                team,
                blindTime: 0,
                connectAbove: ordinal > 0,
                connectBelow: ordinal < totalLines - 1,
                isLastInBurst: ordinal === totalLines - 1,
                combo: this.complexity,
                depth: this.depth
            });
            ordinal++;
        };

        (this.cleanMasks || []).forEach(maskBits => pushLineEntry(maskBits, 'clean'));
        (this.holeMasks || []).forEach(maskBits => pushLineEntry(maskBits, 'normal'));

        if (this.attackType === 'full_blind' && this.param > 0) {
            entries.push({
                type: 'full_blind',
                attackId,
                duration: this.param,
                combo: this.complexity,
                depth: this.depth
            });
        }

        return entries;
    }
}

// Mock GarbageQueue class
function cloneEntry(entry) {
    return JSON.parse(JSON.stringify(entry));
}

class GarbageQueue {
    constructor() {
        this.entries = [];
    }

    enqueue(entries) {
        if (!entries) return;
        if (Array.isArray(entries)) {
            entries.forEach(entry => this.entries.push(cloneEntry(entry)));
            return;
        }
        this.entries.push(cloneEntry(entries));
    }

    enqueueAttack(attack, context = {}) {
        if (!attack) return;
        const entries = attack.expandEntries(context);
        this.enqueue(entries);
    }

    getTotalLines() {
        return this.entries.reduce((sum, entry) => entry.type === 'line' ? sum + 1 : sum, 0);
    }

    isEmpty() {
        return this.entries.length === 0;
    }

    takePendingBlindEntries() {
        const blinds = [];
        while (this.entries.length > 0 && this.entries[0].type === 'blind') {
            blinds.push(this.entries.shift());
        }
        return blinds;
    }

    dequeueLineBurst() {
        if (this.entries.length === 0) {
            return [];
        }
        if (this.entries[0].type !== 'line') {
            return [];
        }

        const burst = [];
        while (this.entries.length > 0 && this.entries[0].type === 'line') {
            const entry = this.entries.shift();
            burst.push(entry);
            if (entry.isLastInBurst) {
                break;
            }
        }
        return burst;
    }

    clear() {
        this.entries = [];
    }

    serialize() {
        return this.entries.map(entry => cloneEntry(entry));
    }

    static fromSerialized(payload) {
        const queue = new GarbageQueue();
        if (Array.isArray(payload)) {
            payload.forEach(entry => queue.enqueue(entry));
        }
        return queue;
    }
}

// ==================== TESTS ====================

console.log('=== Garbage Queue Integration Tests ===\n');

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

// Test 1: Basic queue operations
runTest('Queue enqueue and dequeue work correctly', () => {
    const queue = new GarbageQueue();

    assertEquals(queue.isEmpty(), true, 'Queue should start empty');
    assertEquals(queue.getTotalLines(), 0, 'Should have 0 lines initially');

    const attack = new GarbageAttack({
        depth: 3,
        complexity: 1,
        rows: 2,
        holeMasks: [0x10, 0x10],
        cleanBonus: 0,
        cleanMasks: [],
        sendForClean: false,
        attackType: 'lines'
    });

    queue.enqueueAttack(attack);

    assertEquals(queue.isEmpty(), false, 'Queue should not be empty after enqueue');
    assertEquals(queue.getTotalLines(), 2, 'Should have 2 lines queued');

    const burst = queue.dequeueLineBurst();
    assertEquals(burst.length, 2, 'Should dequeue 2 entries');
    assertEquals(queue.isEmpty(), true, 'Queue should be empty after dequeue');
});

// Test 2: FIFO ordering
runTest('Queue maintains FIFO ordering', () => {
    const queue = new GarbageQueue();

    const attack1 = new GarbageAttack({
        id: 'A1',
        depth: 2,
        rows: 1,
        holeMasks: [0x01]
    });

    const attack2 = new GarbageAttack({
        id: 'A2',
        depth: 3,
        rows: 2,
        holeMasks: [0x02, 0x02]
    });

    const attack3 = new GarbageAttack({
        id: 'A3',
        depth: 2,
        rows: 1,
        holeMasks: [0x04]
    });

    queue.enqueueAttack(attack1);
    queue.enqueueAttack(attack2);
    queue.enqueueAttack(attack3);

    assertEquals(queue.getTotalLines(), 4, 'Should have 4 total lines');

    // Dequeue first burst (attack1: 1 line)
    const burst1 = queue.dequeueLineBurst();
    assertEquals(burst1.length, 1, 'First burst should have 1 line');
    assertEquals(burst1[0].attackId, 'A1', 'First burst should be from A1');

    // Dequeue second burst (attack2: 2 lines)
    const burst2 = queue.dequeueLineBurst();
    assertEquals(burst2.length, 2, 'Second burst should have 2 lines');
    assertEquals(burst2[0].attackId, 'A2', 'Second burst should be from A2');

    // Dequeue third burst (attack3: 1 line)
    const burst3 = queue.dequeueLineBurst();
    assertEquals(burst3.length, 1, 'Third burst should have 1 line');
    assertEquals(burst3[0].attackId, 'A3', 'Third burst should be from A3');

    assertEquals(queue.isEmpty(), true, 'Queue should be empty');
});

// Test 3: Burst boundaries
runTest('Bursts respect isLastInBurst flag', () => {
    const queue = new GarbageQueue();

    // Create two attacks that will be in the queue
    const attack1 = new GarbageAttack({
        id: 'A1',
        depth: 4,
        rows: 3,
        holeMasks: [0x10, 0x10, 0x10]
    });

    const attack2 = new GarbageAttack({
        id: 'A2',
        depth: 3,
        rows: 2,
        holeMasks: [0x20, 0x20]
    });

    queue.enqueueAttack(attack1);
    queue.enqueueAttack(attack2);

    // First burst should only get attack1's lines
    const burst1 = queue.dequeueLineBurst();
    assertEquals(burst1.length, 3, 'First burst should have 3 lines from A1');
    assert(burst1.every(e => e.attackId === 'A1'), 'All entries should be from A1');
    assertEquals(burst1[2].isLastInBurst, true, 'Last entry should have isLastInBurst=true');

    // Second burst should get attack2's lines
    const burst2 = queue.dequeueLineBurst();
    assertEquals(burst2.length, 2, 'Second burst should have 2 lines from A2');
    assert(burst2.every(e => e.attackId === 'A2'), 'All entries should be from A2');
});

// Test 4: Blind attacks are processed separately
runTest('Blind attacks are dequeued separately', () => {
    const queue = new GarbageQueue();

    const blindAttack = new GarbageAttack({
        id: 'BLIND1',
        depth: 3,
        complexity: 2,
        attackType: 'blind',
        param: 5, // 5 turn duration
        holeMasks: [],
        cleanMasks: []
    });

    const lineAttack = new GarbageAttack({
        id: 'LINE1',
        depth: 3,
        rows: 2,
        holeMasks: [0x10, 0x10]
    });

    queue.enqueueAttack(blindAttack);
    queue.enqueueAttack(lineAttack);

    // Blind entries should be at the front
    const blindEntries = queue.takePendingBlindEntries();
    assertEquals(blindEntries.length, 1, 'Should have 1 blind entry');
    assertEquals(blindEntries[0].type, 'blind', 'Entry should be blind type');
    assertEquals(blindEntries[0].duration, 5, 'Blind duration should be 5');

    // Line entries should still be in queue
    assertEquals(queue.getTotalLines(), 2, 'Should still have 2 line entries');

    const burst = queue.dequeueLineBurst();
    assertEquals(burst.length, 2, 'Should dequeue 2 line entries');
});

// Test 5: Clean bonus lines come before normal lines
runTest('Clean bonus lines are queued before normal lines', () => {
    const queue = new GarbageQueue();

    const cleanAttack = new GarbageAttack({
        id: 'CLEAN1',
        depth: 5,
        complexity: 1,
        rows: 4,
        holeMasks: [0x10, 0x10, 0x10, 0x10],
        cleanBonus: 3,
        cleanMasks: [0x48, 0x209, 0x48], // 3 clean lines
        sendForClean: true
    });

    queue.enqueueAttack(cleanAttack);

    const totalLines = queue.getTotalLines();
    assertEquals(totalLines, 7, 'Should have 7 total lines (3 clean + 4 normal)');

    const burst = queue.dequeueLineBurst();
    assertEquals(burst.length, 7, 'Burst should contain all 7 lines');

    // First 3 should be clean variant
    assertEquals(burst[0].variant, 'clean', 'First line should be clean');
    assertEquals(burst[1].variant, 'clean', 'Second line should be clean');
    assertEquals(burst[2].variant, 'clean', 'Third line should be clean');

    // Next 4 should be normal variant
    assertEquals(burst[3].variant, 'normal', 'Fourth line should be normal');
    assertEquals(burst[4].variant, 'normal', 'Fifth line should be normal');
    assertEquals(burst[5].variant, 'normal', 'Sixth line should be normal');
    assertEquals(burst[6].variant, 'normal', 'Seventh line should be normal');

    // Last should have isLastInBurst=true
    assertEquals(burst[6].isLastInBurst, true, 'Last entry should have isLastInBurst=true');
});

// Test 6: Connection flags
runTest('Connection flags are set correctly', () => {
    const queue = new GarbageQueue();

    const attack = new GarbageAttack({
        id: 'A1',
        depth: 4,
        rows: 3,
        holeMasks: [0x10, 0x10, 0x10]
    });

    queue.enqueueAttack(attack);

    const burst = queue.dequeueLineBurst();
    assertEquals(burst.length, 3, 'Should have 3 entries');

    // First entry: no connection above, connection below
    assertEquals(burst[0].connectAbove, false, 'First should not connect above');
    assertEquals(burst[0].connectBelow, true, 'First should connect below');

    // Middle entry: connections both ways
    assertEquals(burst[1].connectAbove, true, 'Middle should connect above');
    assertEquals(burst[1].connectBelow, true, 'Middle should connect below');

    // Last entry: connection above, no connection below
    assertEquals(burst[2].connectAbove, true, 'Last should connect above');
    assertEquals(burst[2].connectBelow, false, 'Last should not connect below');
});

// Test 7: Queue serialization
runTest('Queue serialization and deserialization', () => {
    const queue = new GarbageQueue();

    const attack1 = new GarbageAttack({
        id: 'A1',
        depth: 3,
        rows: 2,
        holeMasks: [0x10, 0x20]
    });

    const attack2 = new GarbageAttack({
        id: 'A2',
        depth: 2,
        rows: 1,
        holeMasks: [0x40]
    });

    queue.enqueueAttack(attack1);
    queue.enqueueAttack(attack2);

    const serialized = queue.serialize();
    assertEquals(Array.isArray(serialized), true, 'Serialized should be an array');
    assertEquals(serialized.length, 3, 'Should have 3 entries');

    const restored = GarbageQueue.fromSerialized(serialized);
    assertEquals(restored.getTotalLines(), 3, 'Restored queue should have 3 lines');

    const burst = restored.dequeueLineBurst();
    assertEquals(burst.length, 2, 'First burst should have 2 lines');
    assertEquals(burst[0].attackId, 'A1', 'Should restore correct attack ID');
});

// Test 8: Multiple attacks accumulate
runTest('Multiple attacks accumulate in queue', () => {
    const queue = new GarbageQueue();

    for (let i = 0; i < 5; i++) {
        const attack = new GarbageAttack({
            id: `A${i}`,
            depth: 2,
            rows: 1,
            holeMasks: [0x01 << i]
        });
        queue.enqueueAttack(attack);
    }

    assertEquals(queue.getTotalLines(), 5, 'Should have 5 total lines');

    // Dequeue all bursts
    let burstsDequeued = 0;
    while (!queue.isEmpty()) {
        const burst = queue.dequeueLineBurst();
        assertEquals(burst.length, 1, 'Each burst should have 1 line');
        burstsDequeued++;
    }

    assertEquals(burstsDequeued, 5, 'Should dequeue 5 bursts');
});

// Test 9: Empty queue behavior
runTest('Empty queue returns empty bursts', () => {
    const queue = new GarbageQueue();

    assertEquals(queue.isEmpty(), true, 'Queue should be empty');

    const burst = queue.dequeueLineBurst();
    assertEquals(burst.length, 0, 'Empty queue should return empty burst');

    const blinds = queue.takePendingBlindEntries();
    assertEquals(blinds.length, 0, 'Empty queue should return empty blind list');
});

// Test 10: Clear operation
runTest('Clear operation empties the queue', () => {
    const queue = new GarbageQueue();

    const attack1 = new GarbageAttack({
        id: 'A1',
        depth: 3,
        rows: 2,
        holeMasks: [0x10, 0x10]
    });

    const attack2 = new GarbageAttack({
        id: 'A2',
        depth: 4,
        rows: 3,
        holeMasks: [0x20, 0x20, 0x20]
    });

    queue.enqueueAttack(attack1);
    queue.enqueueAttack(attack2);

    assertEquals(queue.getTotalLines(), 5, 'Should have 5 lines before clear');

    queue.clear();

    assertEquals(queue.isEmpty(), true, 'Queue should be empty after clear');
    assertEquals(queue.getTotalLines(), 0, 'Should have 0 lines after clear');
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
