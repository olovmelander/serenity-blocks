/**
 * @fileoverview Regression test for "the peer's stack gets HIGHER for a second then resets
 * during a cascade/clear" — while the host's miniboard view of the peer is perfect.
 *
 * Mechanism: after the peer's PREDICTED cascade clears lines (its grid shrinks), the host is
 * ~RTT behind. The host acknowledges the peer's lock input (so the input-based hold signal
 * goes false), but the host's OWN async cascade for that board is still in flight, so its
 * snapshot still carries the PRE-CLEAR (taller) grid. Without a guard the peer adopts that
 * stale taller grid → "stack jumps higher" → then the host finishes the clear and the next
 * snapshot resets it.
 *
 * Fix (Signal 5): `lines` is the clean monotonic signal for "the host finished the clear"
 * (the host only bumps lines when detectFullLines runs). While the host's lines are BEHIND
 * the peer's predicted lines, keep holding the peer's predicted (cleared) grid; adopt only
 * once the host catches up — so the cleared board never flickers back to the taller pre-clear.
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

// Build a board grid (24 rows x 10) with exactly `cellCount` occupied cells from the bottom.
function gridWith(cellCount) {
    const g = [];
    for (let y = 0; y < 24; y++) g.push(Array(10).fill(null));
    let n = 0;
    for (let y = 23; y >= 4 && n < cellCount; y--) {
        for (let x = 0; x < 10 && n < cellCount; x++) { g[y][x] = { type: 'g', color: '#888' }; n++; }
    }
    return g;
}

function makeHoldStub(overrides = {}) {
    return {
        isHost: false,
        localPlayerId: 'P1',
        roundGeneration: 0,
        _localBoardHoldRoundGen: 0, // matches roundGeneration → gen-reset won't clear hold state
        _localBoardHoldEnabled: true,
        _localBoardHoldCount: 0,
        _LOCAL_BOARD_HOLD_MAX_FRAMES: 30,
        _LOCAL_BOARD_HOLD_MAX_PHYSICS_FRAMES: 90,
        _holdStatsEnabled: true,
        _lastLocalLockTime: 0, // recentlyLocked → false (isolate Signal 5)
        _RECENT_LOCK_MS: 250,
        inputSequence: 0,
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

function apply(stub, hostLines, hostGrid) {
    return FFAGameStateP2P.prototype._applySnapshotState.call(stub, {
        roundGeneration: 0,
        gamePhase: 'playing',
        players: [{ steamId: 'P1', isAlive: true, score: 100, lines: hostLines, level: 1, frags: 0, grid: hostGrid, currentPiece: null }],
    }, { forceLocal: false, reconcileLocal: true });
}

describe('cascade hold — no "stack higher then reset" on the peer', () => {
    it('HOLDS the predicted cleared grid while the host has not caught up to our cleared lines', () => {
        const peerCleared = gridWith(3); // our predicted post-clear board (short)
        const player = {
            steamId: 'P1', isAlive: true,
            gameState: { lines: 5, boardGrid: peerCleared, grid: peerCleared, isProcessingPhysics: false },
            garbageQueue: { entries: [] },
        };
        const stub = makeHoldStub({ players: new Map([['P1', player]]) });

        // Host snapshot is a STALE pre-clear frame: fewer lines (2 < 5) and a TALLER grid.
        apply(stub, 2, gridWith(20));

        // We keep our cleared board — NOT the host's taller stale one (no "jump higher").
        expect(player.gameState.boardGrid).toBe(peerCleared);
        expect(stub._localBoardHoldCount).toBe(1);
        expect(player.gameState.lines).toBe(5); // stats held too (not regressed to 2)
    });

    it('ADOPTS the host grid once the host catches up to our cleared line count', () => {
        const peerCleared = gridWith(3);
        const hostFinal = gridWith(3);
        const player = {
            steamId: 'P1', isAlive: true,
            gameState: { lines: 5, boardGrid: peerCleared, grid: peerCleared, isProcessingPhysics: false },
            garbageQueue: { entries: [] },
        };
        const stub = makeHoldStub({ players: new Map([['P1', player]]) });

        apply(stub, 5, hostFinal); // host caught up (lines 5 == 5)

        expect(player.gameState.boardGrid).toBe(hostFinal); // adopt the matching final grid
        expect(stub._localBoardHoldCount).toBe(0);
    });

    it('does NOT spuriously hold when the host is AHEAD on lines (host cleared more than we predicted)', () => {
        const peerGrid = gridWith(10);
        const hostGrid = gridWith(4);
        const player = {
            steamId: 'P1', isAlive: true,
            gameState: { lines: 3, boardGrid: peerGrid, grid: peerGrid, isProcessingPhysics: false },
            garbageQueue: { entries: [] },
        };
        const stub = makeHoldStub({ players: new Map([['P1', player]]) });

        apply(stub, 6, hostGrid); // host lines 6 > our 3 → adopt (host is the more-cleared truth)

        expect(player.gameState.boardGrid).toBe(hostGrid);
        expect(player.gameState.lines).toBe(6);
    });
});
