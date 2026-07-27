import { describe, expect, it } from 'vitest';
import { hydrateBinarySnapshot } from '../../src/core/network/snapshot-contract.js';

function emptyGrid() {
    return Array.from({ length: 24 }, () => Array.from({ length: 10 }, () => null));
}

function makePackedSnapshot() {
    const grid = emptyGrid();
    grid[23][0] = { type: 'I', color: '#00ffff' };
    return {
        players: [{
            steamId: '1000',
            name: 'Alpha',
            color: '#ff0000',
            score: 1,
            lines: 2,
            level: 3,
            frags: 4,
            isAlive: true,
            awaitingSpawn: false,
            garbagePending: 0,
            grid,
            currentPiece: {
                type: 'T', shape: [[1, 1, 1], [0, 1, 0]], x: 3, y: 4, rotation: 0,
            },
            nextPieces: ['I'],
            dropCounter: 0,
            dropInterval: 1000,
            garbageEntries: [{ type: 'line', holeMask: 1, clearSummary: { lines: [1] } }],
            lockedPieces: [{ type: 'O', shape: [[1, 1], [1, 1]], x: 4, y: 20 }],
            blindTimers: {
                field: 1, fieldMax: 2, pending: 3, pendingMax: 4,
            },
        }],
        gamePhase: 'playing',
        winner: null,
        timestamp: 100,
        tick: 10,
        simTick: 20,
        snapshotSeq: 3,
    };
}

describe('binary snapshot hydration contract', () => {
    it('hydrates wrapper metadata without contaminating the raw delta baseline', () => {
        const packed = makePackedSnapshot();
        const hydrated = hydrateBinarySnapshot(packed, {
            roundGeneration: 5,
            migrationEpoch: 2,
            digest: 'abc',
            acknowledgements: { 1000: 9 },
        });

        expect(hydrated).not.toBe(packed);
        expect(hydrated.players[0]).not.toBe(packed.players[0]);
        expect(hydrated).toMatchObject({
            roundGeneration: 5,
            migrationEpoch: 2,
            digest: 'abc',
        });
        expect(hydrated.players[0]).toMatchObject({ lastInputSeq: 9 });
        expect(hydrated.players[0]).toHaveProperty('lastAttackerId', undefined);
        expect(hydrated.players[0]).toHaveProperty('lockSeq', undefined);
        expect(hydrated).toHaveProperty('hotPotatoState', undefined);

        expect(packed).not.toHaveProperty('roundGeneration');
        expect(packed.players[0]).not.toHaveProperty('lastInputSeq');
    });

    it('deeply isolates live mutable state from the retained packed baseline', () => {
        const packed = makePackedSnapshot();
        const hydrated = hydrateBinarySnapshot(packed);

        hydrated.players[0].grid[23][0].color = '#ffffff';
        hydrated.players[0].currentPiece.shape[0][0] = 0;
        hydrated.players[0].nextPieces.push('O');
        hydrated.players[0].garbageEntries[0].holeMask = 2;
        hydrated.players[0].garbageEntries[0].clearSummary.lines.push(2);
        hydrated.players[0].lockedPieces[0].shape[0][0] = 0;
        hydrated.players[0].blindTimers.field = 99;

        expect(packed.players[0].grid[23][0].color).toBe('#00ffff');
        expect(packed.players[0].currentPiece.shape[0][0]).toBe(1);
        expect(packed.players[0].nextPieces).toEqual(['I']);
        expect(packed.players[0].garbageEntries[0]).toMatchObject({
            holeMask: 1,
            clearSummary: { lines: [1] },
        });
        expect(packed.players[0].lockedPieces[0].shape[0][0]).toBe(1);
        expect(packed.players[0].blindTimers.field).toBe(1);
    });

    it('keeps a retained baseline intact for a later hydrate after the prior payload is mutated (P0-8)', () => {
        // steam-networking retains the packed snapshot as the delta baseline; a later delta is
        // reconstructed from it and re-hydrated. A consumer mutating an earlier hydrated payload
        // must not corrupt that reused baseline.
        const packed = makePackedSnapshot();

        const first = hydrateBinarySnapshot(packed, { acknowledgements: { 1000: 1 } });
        first.players[0].grid[23][0].color = '#ffffff';
        first.players[0].grid[23][0] = null;
        first.players[0].lockedPieces[0].y = 999;
        first.players[0].currentPiece.x = -100;

        const second = hydrateBinarySnapshot(packed, { acknowledgements: { 1000: 2 } });
        expect(second.players[0].grid[23][0]).toEqual({ type: 'I', color: '#00ffff' });
        expect(second.players[0].lockedPieces[0].y).toBe(20);
        expect(second.players[0].currentPiece.x).toBe(3);
        expect(second.players[0].lastInputSeq).toBe(2);
    });
});
