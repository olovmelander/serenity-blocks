/**
 * @fileoverview Round-trip tests for the 4-bit-per-cell binary snapshot protocol.
 *
 * The binary codec (binary-encoding.js) is the wire format for host-authoritative
 * multiplayer state, yet was almost entirely untested. These tests assert that a
 * representative snapshot survives encode -> decode (full and delta) with its
 * scalar stats, identity, grid occupancy, and game phase intact, and that the
 * binary form is materially smaller than JSON (remediation Phase 3).
 */

import {
    describe, expect, it, vi,
} from 'vitest';
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
        awaitingSpawn: false,
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
        simTick: 1234,
        snapshotSeq: 56,
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
        expect(decoded.simTick).toBe(1234);
        expect(decoded.snapshotSeq).toBe(56);
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
        current.simTick = 1235;
        current.snapshotSeq = 57;

        const deltaBuffer = encoder.encodeDeltaSnapshot(current, baseline);
        expect(deltaBuffer).not.toBeNull();

        const decoded = decoder.decodeDeltaSnapshot(
            deltaBuffer,
            decoder.decodeSnapshot(encoder.encodeSnapshot(baseline)),
        );
        expect(decoded.simTick).toBe(1235);
        expect(decoded.snapshotSeq).toBe(57);
        expect(decoded.players[0].steamId).toBe('1000');
        expect(decoded.players[0].name).toBe('Alpha'); // identity carried from baseline
        expect(decoded.players[0].score).toBe(250); // changed stat applied
    });

    it('normalizes full and delta next-piece queues to the same string shape', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();
        const baseline = makeSnapshot([makePlayer({ nextPieces: ['I', 'O', 'T'] })]);
        const current = makeSnapshot([makePlayer({ nextPieces: ['Z', 'S', 'J'] })]);
        current.tick = 100;

        const full = decoder.decodeSnapshot(encoder.encodeSnapshot(current));
        const delta = decoder.decodeDeltaSnapshot(
            encoder.encodeDeltaSnapshot(current, baseline),
            decoder.decodeSnapshot(encoder.encodeSnapshot(baseline)),
        );

        expect(full.players[0].nextPieces).toEqual(['Z', 'S', 'J']);
        expect(delta.players[0].nextPieces).toEqual(full.players[0].nextPieces);
        expect(delta.players[0].nextPieces.every((piece) => typeof piece === 'string')).toBe(true);
    });

    it('rejects JSON fallback payloads that do not satisfy the snapshot envelope', () => {
        const decoder = getBinaryDecoder();
        const malformed = new TextEncoder().encode(JSON.stringify({ arbitrary: true })).buffer;
        const plausible = new TextEncoder().encode(JSON.stringify({
            players: [],
            gamePhase: 'bogus',
            winner: null,
            timestamp: 0,
            tick: 1,
            simTick: 1,
            snapshotSeq: 1,
        })).buffer;
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(decoder.decodeSnapshot(malformed)).toBeNull();
        expect(decoder.decodeSnapshot(plausible)).toBeNull();
        expect(error).toHaveBeenCalledTimes(2);
        error.mockRestore();
    });

    it('rejects malformed nested JSON fallback data and protocol-bound violations', () => {
        const decoder = getBinaryDecoder();
        const valid = makeSnapshot([makePlayer()]);
        const malformed = [];

        const badGridDimensions = structuredClone(valid);
        badGridDimensions.players[0].grid = [[null]];
        malformed.push(badGridDimensions);

        const badGridCell = structuredClone(valid);
        badGridCell.players[0].grid[0][0] = 42;
        malformed.push(badGridCell);

        const badGarbage = structuredClone(valid);
        badGarbage.players[0].garbageEntries = [{ type: 'line', holeMask: 'left' }];
        malformed.push(badGarbage);

        const badLockedShape = structuredClone(valid);
        badLockedShape.players[0].lockedPieces = [{ shape: ['bad'], x: 0, y: 0 }];
        malformed.push(badLockedShape);

        const tooManyNextPieces = structuredClone(valid);
        tooManyNextPieces.players[0].nextPieces = Array.from({ length: 33 }, () => 'I');
        malformed.push(tooManyNextPieces);

        const tooManyPlayers = makeSnapshot(Array.from({ length: 9 }, (_, index) => makePlayer({
            steamId: String(index),
        })));
        malformed.push(tooManyPlayers);

        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const payload of malformed) {
            const buffer = new TextEncoder().encode(JSON.stringify(payload)).buffer;
            expect(decoder.decodeSnapshot(buffer)).toBeNull();
        }
        expect(error).toHaveBeenCalledTimes(malformed.length);
        error.mockRestore();
    });

    it('accepts a valid bounded JSON fallback snapshot', () => {
        const decoder = getBinaryDecoder();
        const snapshot = makeSnapshot([makePlayer({
            // Connected board components are not restricted to tetromino
            // dimensions; a placed garbage row can legitimately be 10 wide.
            lockedPieces: [{
                type: 'GARBAGE',
                shape: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
                x: 0,
                y: 23,
            }],
        })]);
        const buffer = new TextEncoder().encode(JSON.stringify(snapshot)).buffer;
        const expected = structuredClone(snapshot);
        delete expected.players[0].lastInputSeq;

        expect(decoder.decodeSnapshot(buffer)).toEqual(expected);
    });

    it('keeps authoritative metadata out of the packed v7 body', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();
        const snapshot = {
            ...makeSnapshot([makePlayer({
                lastInputSeq: 9,
                lastAttackerId: '2000',
                lockSeq: 4,
            })]),
            roundGeneration: 3,
            migrationEpoch: 2,
            digest: 'digest-99',
            hotPotatoState: { enabled: true, holderId: '1000' },
        };

        const rawV7 = decoder.decodeSnapshot(encoder.encodeSnapshot(snapshot));

        expect(rawV7).not.toHaveProperty('roundGeneration');
        expect(rawV7).not.toHaveProperty('migrationEpoch');
        expect(rawV7).not.toHaveProperty('digest');
        expect(rawV7).not.toHaveProperty('hotPotatoState');
        expect(rawV7.players[0]).not.toHaveProperty('lastInputSeq');
        expect(rawV7.players[0]).not.toHaveProperty('lastAttackerId');
        expect(rawV7.players[0]).not.toHaveProperty('lockSeq');
    });

    it('round-trips awaitingSpawn so a late joiner is not mistaken for ELIMINATED (v6)', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        // A drop-in late joiner is isAlive:false (the loop skips them until next round) but
        // awaitingSpawn:true — the wire MUST carry this bit or peers render them as eliminated.
        const snapshot = makeSnapshot([
            makePlayer({ steamId: '1000', name: 'Alive', isAlive: true, awaitingSpawn: false }),
            makePlayer({ steamId: '2000', name: 'LateJoiner', isAlive: false, awaitingSpawn: true }),
            makePlayer({ steamId: '3000', name: 'Eliminated', isAlive: false, awaitingSpawn: false }),
        ]);

        const decoded = decoder.decodeSnapshot(encoder.encodeSnapshot(snapshot));
        const [alive, late, dead] = decoded.players;

        expect(alive.awaitingSpawn).toBe(false);
        expect(late.isAlive).toBe(false);
        expect(late.awaitingSpawn).toBe(true); // the distinguishing bit
        expect(dead.isAlive).toBe(false);
        expect(dead.awaitingSpawn).toBe(false);
    });

    it('round-trips an awaitingSpawn flip (true→false) through a delta snapshot (v6)', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        // Baseline: late joiner waiting. Current: they spawned this round (awaitingSpawn cleared,
        // alive). The STATS delta must re-send the bit so the opponent's "NEXT ROUND" overlay clears.
        const baseline = makeSnapshot([makePlayer({ steamId: '1000', isAlive: false, awaitingSpawn: true })]);
        const current = makeSnapshot([makePlayer({ steamId: '1000', isAlive: true, awaitingSpawn: false })]);
        current.tick = 100;

        const deltaBuffer = encoder.encodeDeltaSnapshot(current, baseline);
        expect(deltaBuffer).not.toBeNull();

        const decoded = decoder.decodeDeltaSnapshot(
            deltaBuffer,
            decoder.decodeSnapshot(encoder.encodeSnapshot(baseline)),
        );
        expect(decoded.players[0].isAlive).toBe(true);
        expect(decoded.players[0].awaitingSpawn).toBe(false);
    });

    it('round-trips per-garbage-row attacker color so placed garbage shows the attacker color (v7 full)', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        // Two garbage rows from DIFFERENT attackers — green and red. The packed 4-bit grid only
        // carries cell TYPE, so without the v7 row-color section these decode to generic grey
        // (the bug: opponent boards showed grey garbage while the side meter showed the color).
        const grid = emptyGrid();
        for (let x = 0; x < GRID_COLS; x++) {
            if (x !== 3) grid[23][x] = { type: 'GARBAGE', color: '#00e676' }; // green attacker
            if (x !== 7) grid[22][x] = { type: 'GARBAGE', color: '#ff1744' }; // red attacker
        }

        const decoded = decoder.decodeSnapshot(encoder.encodeSnapshot(makeSnapshot([
            makePlayer({ steamId: '1000', grid }),
        ])));
        const dgrid = decoded.players[0].grid;

        expect(dgrid[23][0].type).toBe('GARBAGE');
        expect(dgrid[23][0].color).toBe('#00e676'); // green row kept
        expect(dgrid[22][0].color).toBe('#ff1744'); // red row kept (distinct from green)
        expect(dgrid[23][3]).toBeNull(); // the hole
    });

    it('round-trips garbage row color through a delta when the grid changes (v7 delta)', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        const baseline = makeSnapshot([makePlayer({ steamId: '1000', grid: emptyGrid() })]);
        const grid = emptyGrid();
        for (let x = 0; x < GRID_COLS; x++) {
            if (x !== 5) grid[23][x] = { type: 'GARBAGE', color: '#2979ff' }; // blue attacker
        }
        const current = makeSnapshot([makePlayer({ steamId: '1000', grid })]);
        current.tick = 100;

        const deltaBuffer = encoder.encodeDeltaSnapshot(current, baseline);
        expect(deltaBuffer).not.toBeNull();
        const decoded = decoder.decodeDeltaSnapshot(
            deltaBuffer,
            decoder.decodeSnapshot(encoder.encodeSnapshot(baseline)),
        );
        expect(decoded.players[0].grid[23][0].color).toBe('#2979ff');
    });

    it('peekDeltaBaselineTick reports the baseline a delta was diffed against (and null for a full)', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();

        // Delta diffed against a baseline at tick 99 must report 99 — this is the
        // classifier the receiver uses to drop superseded stragglers WITHOUT decoding
        // (a newer reliable keyframe overtaking queued unreliable deltas) instead of
        // throwing a "baseline mismatch" + resync storm.
        const baseline = makeSnapshot([makePlayer({ steamId: '1000', score: 100 })]); // tick 99
        const current = makeSnapshot([makePlayer({ steamId: '1000', score: 250 })]);
        current.tick = 107;
        const deltaBuffer = encoder.encodeDeltaSnapshot(current, baseline);

        expect(decoder.peekDeltaBaselineTick(deltaBuffer)).toBe(99);
        // A FULL snapshot is not a delta → null (caller must not treat it as one).
        const fullBuffer = encoder.encodeSnapshot(current);
        expect(decoder.peekDeltaBaselineTick(fullBuffer)).toBeNull();
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
                {
                    type: 'line',
                    attackerId: '2000',
                    color: '#3b82f6', // attacker's player color — must survive the wire
                    holeMask,
                    duration: 0,
                    variant: 'clean',
                    isLastInBurst: true,
                    attackId: 'r3-a42',
                    attackSeq: 42,
                    lineIndex: 0,
                    createdSimTick: 123,
                    sourceSimTick: 120,
                    sourceLockSeq: 9,
                    applyAfterLockSeq: 4,
                },
                {
                    type: 'line',
                    attackerId: '2000',
                    holeMask: 0x0F,
                    duration: 0,
                    variant: 'normal',
                    isLastInBurst: false,
                    attackId: 'r3-a42',
                    attackSeq: 42,
                    lineIndex: 1,
                    createdSimTick: 123,
                    sourceSimTick: 120,
                    sourceLockSeq: 9,
                    applyAfterLockSeq: 4,
                },
            ],
        })]);

        const decoded = decoder.decodeSnapshot(encoder.encodeSnapshot(snapshot));
        const entries = decoded.players[0].garbageEntries;
        expect(entries).toHaveLength(2);
        expect(entries[0].holeMask).toBe(holeMask); // NOT truncated to 0x05
        expect(entries[0].variant).toBe('clean');
        expect(entries[0].isLastInBurst).toBe(true);
        expect(entries[0]).toMatchObject({
            attackId: 'r3-a42',
            attackSeq: 42,
            lineIndex: 0,
            createdSimTick: 123,
            sourceSimTick: 120,
            sourceLockSeq: 9,
            applyAfterLockSeq: 4,
        });
        expect(entries[1].holeMask).toBe(0x0F);
        expect(entries[1].variant).toBe('normal');
        expect(entries[1].isLastInBurst).toBe(false);
        expect(entries[1].lineIndex).toBe(1);
        // v5: each garbage row carries the attacker's player color so victims see
        // sender-colored garbage (parity with local MP), not a uniform grey.
        expect(entries[0].color).toBe('#3b82f6');
        // entry[1] had no color → all-zero RGB decodes back to undefined (renderer greys it).
        expect(entries[1].color).toBeUndefined();
    });

    it('lowercases and zero-pads odd garbage colors through the 3-byte RGB field', () => {
        const encoder = getBinaryEncoder();
        const decoder = getBinaryDecoder();
        const snapshot = makeSnapshot([makePlayer({
            steamId: '1000',
            garbageEntries: [
                { type: 'line', attackerId: '2000', color: '#0A0B0C', holeMask: 1, lineIndex: 0 },
                { type: 'line', attackerId: '2000', color: '#FFFFFF', holeMask: 1, lineIndex: 1 },
            ],
        })]);
        const decoded = decoder.decodeSnapshot(encoder.encodeSnapshot(snapshot));
        const entries = decoded.players[0].garbageEntries;
        expect(entries[0].color).toBe('#0a0b0c'); // low bytes preserved + zero-padded
        expect(entries[1].color).toBe('#ffffff');
    });

    it('encodes a full 8-player snapshot far smaller than JSON', () => {
        const players = Array.from({ length: 8 }, (_, i) => makePlayer({ steamId: String(1000 + i) }));
        const { jsonSize, binarySize, reduction } = compareEncodingSizes(makeSnapshot(players));
        expect(binarySize).toBeLessThan(jsonSize);
        expect(reduction).toBeGreaterThan(50); // percent
    });
});
