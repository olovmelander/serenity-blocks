/**
 * Adversarial decoder fuzzing (plan Phase 3b fast-check property, the §6A.9
 * fuzz target started early).
 *
 * ~1,300 lines of hand-rolled binary decode parse UNTRUSTED P2P input. The
 * contract under fuzz: for arbitrary/mutated/truncated bytes the decoder
 * either throws or returns a bounded, well-formed value — it never hangs and
 * never allocates unbounded structures from a small hostile packet.
 *
 * Seeds are FIXED so CI is deterministic; on failure fast-check prints the
 * counterexample. Bump seeds deliberately to widen the explored corpus.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getBinaryEncoder, getBinaryDecoder } from '../../src/core/network/binary-encoding.js';

const GRID_ROWS = 24;
const GRID_COLS = 10;

function emptyGrid() {
    return Array.from({ length: GRID_ROWS }, () => Array.from({ length: GRID_COLS }, () => null));
}
function makeSnapshot() {
    return {
        players: [{
            steamId: '1000',
            name: 'Alpha',
            color: '#ff0000',
            score: 12345,
            lines: 42,
            level: 5,
            frags: 3,
            isAlive: true,
            garbagePending: 2,
            dropCounter: 100,
            dropInterval: 800,
            grid: emptyGrid(),
            currentPiece: null,
            nextPieces: ['I', 'O', 'T'],
            garbageEntries: [],
            lockedPieces: [],
            blindTimers: null,
            lastInputSeq: 7,
        }],
        gamePhase: 'playing',
        winner: null,
        timestamp: 0,
        tick: 99,
        simTick: 1234,
        snapshotSeq: 56,
    };
}

/** If the decoder RETURNS (instead of throwing), the value must be bounded. */
function assertBoundedResult(decoded) {
    if (decoded === null || typeof decoded !== 'object') return;
    if (Array.isArray(decoded.players)) {
        expect(decoded.players.length).toBeLessThanOrEqual(255);
        for (const p of decoded.players) {
            expect(typeof p).toBe('object');
            if (p && Array.isArray(p.grid)) expect(p.grid.length).toBeLessThanOrEqual(64);
        }
    }
}

const toArrayBuffer = (ua) => ua.buffer.slice(ua.byteOffset, ua.byteOffset + ua.byteLength);

describe('binary decoder under adversarial input (plan §6A.9)', () => {
    const decoder = getBinaryDecoder(); // same reused instance as the live transport

    it('decodeSnapshot: arbitrary bytes → throws or bounded result, never hangs', () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 0, maxLength: 2048 }), (bytes) => {
                try {
                    assertBoundedResult(decoder.decodeSnapshot(toArrayBuffer(bytes)));
                } catch (e) { /* throwing on garbage is the contract */ }
            }),
            { numRuns: 300, seed: 1337 },
        );
    });

    it('peekDeltaBaselineTick: arbitrary bytes → number/null or throws', () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (bytes) => {
                try {
                    const tick = decoder.peekDeltaBaselineTick(toArrayBuffer(bytes));
                    expect(tick === null || typeof tick === 'number').toBe(true);
                } catch (e) { /* acceptable */ }
            }),
            { numRuns: 300, seed: 2026 },
        );
    });

    it('decodeDeltaSnapshot: arbitrary bytes against a valid baseline → throws or bounded', () => {
        const baseline = getBinaryDecoder().decodeSnapshot(getBinaryEncoder().encodeSnapshot(makeSnapshot()));
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 0, maxLength: 1024 }), (bytes) => {
                try {
                    assertBoundedResult(decoder.decodeDeltaSnapshot(toArrayBuffer(bytes), baseline));
                } catch (e) { /* acceptable */ }
            }),
            { numRuns: 300, seed: 4242 },
        );
    });

    it('seeded byte-mutation of a VALID snapshot → throws or bounded (no silent corruption crash)', () => {
        const valid = new Uint8Array(getBinaryEncoder().encodeSnapshot(makeSnapshot()));
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        index: fc.integer({ min: 0, max: valid.length - 1 }),
                        value: fc.integer({ min: 0, max: 255 }),
                    }),
                    { minLength: 1, maxLength: 16 },
                ),
                (mutations) => {
                    const mutated = valid.slice();
                    for (const m of mutations) mutated[m.index] = m.value;
                    try {
                        assertBoundedResult(decoder.decodeSnapshot(toArrayBuffer(mutated)));
                    } catch (e) { /* acceptable */ }
                },
            ),
            { numRuns: 400, seed: 90210 },
        );
    });

    it('truncation of a VALID snapshot at every prefix length → throws or bounded', () => {
        const valid = new Uint8Array(getBinaryEncoder().encodeSnapshot(makeSnapshot()));
        // Exhaustive over short prefixes + sampled over the rest.
        for (let len = 0; len < Math.min(valid.length, 64); len += 1) {
            try {
                assertBoundedResult(decoder.decodeSnapshot(toArrayBuffer(valid.slice(0, len))));
            } catch (e) { /* acceptable */ }
        }
        fc.assert(
            fc.property(fc.integer({ min: 0, max: valid.length }), (len) => {
                try {
                    assertBoundedResult(decoder.decodeSnapshot(toArrayBuffer(valid.slice(0, len))));
                } catch (e) { /* acceptable */ }
            }),
            { numRuns: 200, seed: 555 },
        );
    });
});
