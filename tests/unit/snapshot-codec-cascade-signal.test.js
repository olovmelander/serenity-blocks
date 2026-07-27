// @ts-nocheck
/**
 * P0-5 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18 §2.7) — keep snapshots flowing mid-cascade.
 *
 * A line clear / cascade is an async multi-frame animation during which the fields
 * `hasSignificantStateChanges` compares (score/lines/level/dropCounter/currentPiece) are all
 * static, so broadcasts used to pause for the whole clear and opponents froze then teleported.
 * The fix treats an in-progress cascade on any ALIVE player as "changed" — gated on
 * `isProcessingPhysics` actually being true so a fully idle game still returns false.
 */
import { describe, it, expect } from 'vitest';
import { hasSignificantStateChanges } from '../../src/core/multiplayer/ffa/snapshot-codec.js';

/** Build a player whose tracked fields deliberately MATCH its recorded lastBroadcastState, so
 *  the field comparison yields "no change" — isolating isProcessingPhysics as the only variable. */
function makePlayer({ isAlive = true, isProcessingPhysics = false, garbagePending = 0 } = {}) {
    return {
        isAlive,
        frags: 0,
        garbageQueue: { getTotalLines: () => garbagePending },
        gameState: {
            score: 100,
            lines: 5,
            level: 2,
            currentPiece: null, // mid-cascade there is no active piece — the crux of the bug
            dropCounter: 0,
            isProcessingPhysics,
        },
    };
}

/** The record broadcastGameState() writes into lastBroadcastState — matched to makePlayer above. */
function matchingLastState() {
    return {
        score: 100,
        lines: 5,
        level: 2,
        currentPieceY: undefined,
        currentPieceX: undefined,
        dropCounter: 0,
        garbagePending: 0,
        frags: 0,
        isAlive: true,
        awaitingSpawn: false,
        hotPotatoGeneration: 0,
    };
}

function makeGame(players) {
    const map = new Map();
    const last = new Map();
    for (const [id, { player, lastState }] of Object.entries(players)) {
        map.set(id, player);
        if (lastState) last.set(id, lastState);
    }
    return { isHost: true, players: map, lastBroadcastState: last, hotPotatoState: null };
}

describe('hasSignificantStateChanges — mid-cascade broadcast signal (review §2.7 / P0-5)', () => {
    it('returns FALSE for a fully idle player whose tracked fields match the last broadcast', () => {
        const game = makeGame({
            p1: { player: makePlayer({ isProcessingPhysics: false }), lastState: matchingLastState() },
        });
        expect(hasSignificantStateChanges(game)).toBe(false);
    });

    it('returns TRUE when the ONLY difference is that player is mid-cascade (isProcessingPhysics)', () => {
        // Identical tracked fields + lastState as the idle case above; flipping isProcessingPhysics
        // to true is what must now force a broadcast so the animation keeps streaming.
        const game = makeGame({
            p1: { player: makePlayer({ isProcessingPhysics: true }), lastState: matchingLastState() },
        });
        expect(hasSignificantStateChanges(game)).toBe(true);
    });

    it('does NOT force a broadcast for a DEAD player mid-physics (gated on isAlive)', () => {
        const dead = makePlayer({ isAlive: false, isProcessingPhysics: true });
        const lastState = { ...matchingLastState(), isAlive: false };
        const game = makeGame({ p1: { player: dead, lastState } });
        expect(hasSignificantStateChanges(game)).toBe(false);
    });

    it('detects a mid-cascade player even when another player is idle (per-player scan)', () => {
        const game = makeGame({
            p1: { player: makePlayer({ isProcessingPhysics: false }), lastState: matchingLastState() },
            p2: { player: makePlayer({ isProcessingPhysics: true }), lastState: matchingLastState() },
        });
        expect(hasSignificantStateChanges(game)).toBe(true);
    });

    it('still broadcasts on a normal field change while idle (existing path intact)', () => {
        const player = makePlayer({ isProcessingPhysics: false });
        player.gameState.score = 250; // diverges from lastState.score = 100
        const game = makeGame({ p1: { player, lastState: matchingLastState() } });
        expect(hasSignificantStateChanges(game)).toBe(true);
    });

    it('returns FALSE on a non-host regardless of cascade state', () => {
        const game = makeGame({
            p1: { player: makePlayer({ isProcessingPhysics: true }), lastState: matchingLastState() },
        });
        game.isHost = false;
        expect(hasSignificantStateChanges(game)).toBe(false);
    });
});
