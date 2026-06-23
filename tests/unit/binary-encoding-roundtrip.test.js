/**
 * @fileoverview Round-trip tests for the 4-bit-per-cell binary snapshot protocol.
 *
 * The binary codec (binary-encoding.js) is the wire format for host-authoritative
 * multiplayer state, yet was almost entirely untested. These tests assert that a
 * representative snapshot survives encode -> decode (full and delta) with its
 * scalar stats, identity, grid occupancy, and game phase intact, and that the
 * binary form is materially smaller than JSON (remediation Phase 3).
 */

import { describe, it, expect } from 'vitest';
import {
    getBinaryEncoder,
    getBinaryDecoder,
    compareEncodingSizes,
} from '../../src/core/network/binary-encoding.js';

const GRID_ROWS = 24;
const GRID_COLS = 10;

function emptyGrid() {
    return Array.from({ length: GRID_ROWS }, () => Array.from({ length: GRID_COLS }, () => null));
}

function makePlayer(overrides = {}) {
    return {
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
        ...overrides,
    };
}

function makeSnapshot(players) {
    return {
        players,
        gamePhase: 'playing',
        winner: null,
        timestamp: 0,
        tick: 99,
    };
}

describe('binary snapshot encoding', () => {
    it('round-trips a full snapshot preserving identity, stats, phase and tick', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        const grid = emptyGrid();
        grid[23][0] = { type: 'I' };
        grid[23][1] = { type: 'O' };
        grid[22][5] = { type: 'GARBAGE' };

        const snapshot = makeSnapshot([
            makePlayer({ steamId: '1000', name: 'Alpha', grid }),
            makePlayer({
                steamId: '2000', name: 'Bravo', score: 777, lines: 9, level: 2, frags: 0, isAlive: false,
            }),
        ]);

        const decoded = decoder.decodeSnapshot(encoder.encodeSnapshot(snapshot));

        expect(decoded.gamePhase).toBe('playing');
        expect(decoded.tick).toBe(99);
        expect(decoded.players).toHaveLength(2);

        const [a, b] = decoded.players;
        expect(a.steamId).toBe('1000');
        expect(a.name).toBe('Alpha');
        expect(a.score).toBe(12345);
        expect(a.lines).toBe(42);
        expect(a.level).toBe(5);
        expect(a.frags).toBe(3);
        expect(a.isAlive).toBe(true);
        expect(a.garbagePending).toBe(2);

        expect(b.steamId).toBe('2000');
        expect(b.score).toBe(777);
        expect(b.isAlive).toBe(false);

        // Grid occupancy survives: occupied cells decode to objects with the right
        // type; empty cells decode to null.
        expect(a.grid[23][0]).toMatchObject({ type: 'I' });
        expect(a.grid[23][1]).toMatchObject({ type: 'O' });
        expect(a.grid[22][5]).toMatchObject({ type: 'GARBAGE' });
        expect(a.grid[0][0]).toBeNull();
    });

    it('round-trips a delta snapshot, updating changed stats and keeping identity', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        const baseline = makeSnapshot([makePlayer({ steamId: '1000', name: 'Alpha', score: 100 })]);
        const current = makeSnapshot([makePlayer({ steamId: '1000', name: 'Alpha', score: 250 })]);
        current.tick = 100;

        const deltaBuffer = encoder.encodeDeltaSnapshot(current, baseline);
        expect(deltaBuffer).not.toBeNull();

        const decoded = decoder.decodeDeltaSnapshot(deltaBuffer, baseline);
        expect(decoded.players[0].steamId).toBe('1000');
        expect(decoded.players[0].name).toBe('Alpha'); // identity carried from baseline
        expect(decoded.players[0].score).toBe(250); // changed stat applied
    });

    it('returns null for a delta when the player roster changes (forcing a full snapshot)', () => {
        const encoder = getBinaryEncoder();
        const baseline = makeSnapshot([makePlayer({ steamId: '1000' })]);
        const current = makeSnapshot([makePlayer({ steamId: '1000' }), makePlayer({ steamId: '2000' })]);
        expect(encoder.encodeDeltaSnapshot(current, baseline)).toBeNull();
    });

    it('round-trips garbage entries with the full 10-bit hole mask, variant and isLastInBurst', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        // Hole columns include 8 and 9 — exactly the bits the old 8-bit mask
        // truncated, which garbled garbage on peer victims (the board is 10 cols).
        const holeMask = 0b1100000101; // cols 0,2,8,9 → 773, needs 10 bits
        const snapshot = makeSnapshot([makePlayer({
            steamId: '1000',
            garbageEntries: [
                { type: 'line', attackerId: '2000', holeMask, duration: 0, variant: 'clean', isLastInBurst: true },
                { type: 'line', attackerId: '2000', holeMask: 0x0F, duration: 0, variant: 'normal', isLastInBurst: false },
            ],
        })]);

        const decoded = decoder.decodeSnapshot(encoder.encodeSnapshot(snapshot));
        const entries = decoded.players[0].garbageEntries;
        expect(entries).toHaveLength(2);
        expect(entries[0].holeMask).toBe(holeMask); // NOT truncated to 0x05
        expect(entries[0].variant).toBe('clean');
        expect(entries[0].isLastInBurst).toBe(true);
        expect(entries[1].holeMask).toBe(0x0F);
        expect(entries[1].variant).toBe('normal');
        expect(entries[1].isLastInBurst).toBe(false);
    });

    it('encodes a full 8-player snapshot far smaller than JSON', () => {
        const players = Array.from({ length: 8 }, (_, i) => makePlayer({ steamId: String(1000 + i) }));
        const { jsonSize, binarySize, reduction } = compareEncodingSizes(makeSnapshot(players));
        expect(binarySize).toBeLessThan(jsonSize);
        expect(reduction).toBeGreaterThan(50); // percent
    });
});
