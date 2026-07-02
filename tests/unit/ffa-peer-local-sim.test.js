/**
 * @fileoverview Tests for PEER-OWNS-BOARD (?peerLocalSim) — the architectural fix that
 * makes the online peer feel like local/host by NEVER re-basing its own board against the
 * host's ~RTT-stale 30Hz snapshot. The peer owns grid/piece/nextPieces/score/lines as a
 * local sim; the host snapshot supplies only incoming garbage + frags/death (verdicts) +
 * a caught-up desync backstop. forceLocal (digest resync) is the only full re-base.
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function gridWith(cellCount) {
    const g = [];
    for (let y = 0; y < 24; y++) g.push(Array(10).fill(null));
    let n = 0;
    for (let y = 23; y >= 4 && n < cellCount; y--) {
        for (let x = 0; x < 10 && n < cellCount; x++) { g[y][x] = { type: 'g' }; n++; }
    }
    return g;
}

function makeStub(peerLocalSim, overrides = {}) {
    return {
        isHost: false,
        localPlayerId: 'P1',
        roundGeneration: 0,
        _localBoardHoldRoundGen: 0,
        _localBoardHoldEnabled: true,
        _localBoardHoldCount: 0,
        _LOCAL_BOARD_HOLD_MAX_FRAMES: 30,
        _LOCAL_BOARD_HOLD_MAX_PHYSICS_FRAMES: 90,
        _holdStatsEnabled: true,
        _lastLocalLockTime: 0,
        _RECENT_LOCK_MS: 250,
        inputSequence: 0,
        _peerLocalSimEnabled: peerLocalSim,
        _garbageIdempotentEnabled: false,
        _peerConsumedBursts: new Set(),
        _netDiagEnabled: false,
        _lockEventsEnabled: false,
        _countOccupiedCells: FFAGameStateP2P.prototype._countOccupiedCells,
        _reconcileLocalPiece: FFAGameStateP2P.prototype._reconcileLocalPiece,
        gamePhase: 'playing',
        winner: null,
        hotPotatoState: null,
        players: new Map(),
        renderAllPlayers: () => {},
        ...overrides,
    };
}

function localPlayer() {
    const myGrid = gridWith(8);
    return {
        steamId: 'P1', isAlive: true, frags: 0,
        gameState: {
            score: 500, lines: 5, level: 2,
            boardGrid: myGrid, grid: myGrid,
            currentPiece: { type: 'T', x: 4, y: 6, rotation: 0 },
            nextPieces: ['I', 'O', 'S'],
            dropInterval: 800, dropCounter: 100, isProcessingPhysics: false,
        },
        garbageQueue: { entries: [], getTotalLines: () => 0 },
    };
}

// A host snapshot that is STALE/DIFFERENT in every owned field + carries new verdicts + garbage.
function staleSnapshot() {
    return {
        roundGeneration: 0, gamePhase: 'playing',
        players: [{
            steamId: 'P1', isAlive: true, frags: 3, score: 200, lines: 2, level: 1,
            grid: gridWith(20), lockedPieces: [{ x: 0, y: 23 }],
            currentPiece: { type: 'Z', x: 0, y: 2, rotation: 1 },
            nextPieces: ['L', 'J', 'Z'], dropInterval: 1000, dropCounter: 0,
            garbageEntries: [{ type: 'line', attackId: 'g1', lineIndex: 0, holeMask: 1, variant: 'normal' }],
        }],
    };
}

function apply(stub, state, opts) {
    return FFAGameStateP2P.prototype._applySnapshotState.call(stub, state, opts);
}

describe('peer-owns-board (?peerLocalSim)', () => {
    it('does NOT re-base the local grid/piece/nextPieces/score/lines from a per-frame snapshot', () => {
        const player = localPlayer();
        const stub = makeStub(true, { players: new Map([['P1', player]]) });
        const before = player.gameState;

        apply(stub, staleSnapshot(), { forceLocal: false, reconcileLocal: true });

        // Owned by the local sim — UNCHANGED by the stale host frame:
        expect(player.gameState.score).toBe(500);
        expect(player.gameState.lines).toBe(5);
        expect(player.gameState.boardGrid).toBe(before.boardGrid); // same grid object, not re-based
        expect(player.gameState.currentPiece.type).toBe('T'); // piece not snapped
        expect(player.gameState.nextPieces).toEqual(['I', 'O', 'S']); // preview not rewound
        expect(player.gameState.dropCounter).toBe(100);
    });

    it('STILL adopts host verdicts (frags / isAlive) and incoming garbage under peerOwns', () => {
        const player = localPlayer();
        const stub = makeStub(true, { players: new Map([['P1', player]]) });

        apply(stub, staleSnapshot(), { forceLocal: false, reconcileLocal: true });

        expect(player.frags).toBe(3); // host-authoritative verdict adopted
        expect(player.isAlive).toBe(true);
        expect(player.garbageQueue.entries.length).toBe(1); // incoming garbage adopted
        expect(player.garbageQueue.entries[0].attackId).toBe('g1');
    });

    it('a forceLocal digest-resync DOES hard re-base everything (the single correction path)', () => {
        const player = localPlayer();
        const stub = makeStub(true, { players: new Map([['P1', player]]) });

        apply(stub, staleSnapshot(), { forceLocal: true, reconcileLocal: true });

        // forceLocal makes ownsLocalPiece (hence peerOwns) false → authoritative hard adopt
        expect(player.gameState.score).toBe(200);
        expect(player.gameState.lines).toBe(2);
        expect(player.gameState.boardGrid).toEqual(staleSnapshot().players[0].grid);
        expect(player.gameState.nextPieces).toEqual(['L', 'J', 'Z']);
    });

    it('with ?peerLocalSim=0 the local board re-bases as before (legacy path intact)', () => {
        const player = localPlayer();
        // legacy: disable the hold too so the grid actually adopts (not held)
        const stub = makeStub(false, { _localBoardHoldEnabled: false, _holdStatsEnabled: false, players: new Map([['P1', player]]) });

        apply(stub, staleSnapshot(), { forceLocal: false, reconcileLocal: true });

        expect(player.gameState.boardGrid).toEqual(staleSnapshot().players[0].grid); // adopted (legacy)
        expect(player.gameState.score).toBe(200);
    });
});
