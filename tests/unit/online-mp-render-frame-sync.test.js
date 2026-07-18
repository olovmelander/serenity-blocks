/**
 * @fileoverview Pinning tests for P0-2 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18
 * §2.2): RENDER_FRAME payloads emitted from the unified loop's own rAF
 * (detail.fromLoopFrame) must be processed SYNCHRONOUSLY — deferring them to a
 * fresh rAF settled into a 2-frame cycle that halved MP's render rate.
 * Out-of-frame emits keep the rAF-batched path, and a pending deferred detail
 * plus a loop-frame detail must never double-process. Also pins the producer
 * side: the pre-allocated payload is REUSED every frame, so renderAllPlayers
 * must stamp fromLoopFrame unconditionally (a stale true must never leak).
 */

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import {
    MULTIPLAYER_EVENTS,
    onMultiplayerEvent,
} from '../../src/events/multiplayer-events.js';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

function createMode() {
    const rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
    }));
    const mode = Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        _renderFrameScheduled: false,
        _pendingRenderDetail: null,
        _processRenderFrame: vi.fn(),
    });
    const flushRaf = () => {
        const callbacks = rafCallbacks.splice(0);
        callbacks.forEach((cb) => cb());
    };
    return { mode, rafCallbacks, flushRaf };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('OnlineMultiplayerMode._handleRenderFrame (§2.2 synchronous loop frames)', () => {
    it('processes a loop-frame detail synchronously with zero rAF use', () => {
        const { mode } = createMode();
        const detail = { players: [], playerCount: 0, fromLoopFrame: true };

        mode._handleRenderFrame(detail);

        expect(mode._processRenderFrame).toHaveBeenCalledTimes(1);
        expect(mode._processRenderFrame).toHaveBeenCalledWith(detail);
        expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
        expect(mode._pendingRenderDetail).toBeNull();
        expect(mode._renderFrameScheduled).toBe(false);
    });

    it('keeps deferring out-of-frame details to the next rAF', () => {
        const { mode, flushRaf } = createMode();
        const detail = { players: [], playerCount: 0, fromLoopFrame: false };

        mode._handleRenderFrame(detail);
        expect(mode._processRenderFrame).not.toHaveBeenCalled();
        expect(mode._renderFrameScheduled).toBe(true);

        flushRaf();
        expect(mode._processRenderFrame).toHaveBeenCalledTimes(1);
        expect(mode._processRenderFrame).toHaveBeenCalledWith(detail);
        expect(mode._pendingRenderDetail).toBeNull();
        expect(mode._renderFrameScheduled).toBe(false);
    });

    it('a hand-built detail without the flag (e.g. _updateHostUI) stays deferred', () => {
        const { mode } = createMode();

        mode._handleRenderFrame({ players: [] }); // no fromLoopFrame at all

        expect(mode._processRenderFrame).not.toHaveBeenCalled();
        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('never double-processes when a deferred detail is pending and a loop-frame detail arrives', () => {
        const { mode, flushRaf } = createMode();
        const deferred = { players: [], playerCount: 0, fromLoopFrame: false };
        const loopDetail = { players: [], playerCount: 0, fromLoopFrame: true };

        mode._handleRenderFrame(deferred); // schedules a rAF, sets pending
        mode._handleRenderFrame(loopDetail); // sync path clears pending

        expect(mode._processRenderFrame).toHaveBeenCalledTimes(1);
        expect(mode._processRenderFrame).toHaveBeenCalledWith(loopDetail);

        // The already-scheduled rAF callback must find pending === null and no-op.
        flushRaf();
        expect(mode._processRenderFrame).toHaveBeenCalledTimes(1);

        // And the scheduler flag reset so the NEXT out-of-frame emit re-schedules.
        expect(mode._renderFrameScheduled).toBe(false);
        mode._handleRenderFrame(deferred);
        flushRaf();
        expect(mode._processRenderFrame).toHaveBeenCalledTimes(2);
    });
});

describe('FFAGameStateP2P.renderAllPlayers fromLoopFrame stamping (reused payload)', () => {
    function createRenderState() {
        const player = {
            name: 'Host',
            color: '#fff',
            gameState: {},
            garbageQueue: null,
            isAlive: true,
            awaitingSpawn: false,
            frags: 0,
        };
        return Object.assign(Object.create(FFAGameStateP2P.prototype), {
            localPlayerId: 'HOST',
            players: new Map([['HOST', player]]),
            _renderPayload: {
                players: [{
                    steamId: null,
                    name: null,
                    color: null,
                    gameState: null,
                    garbageQueue: null,
                    isLocal: false,
                    isAlive: true,
                    awaitingSpawn: false,
                    frags: 0,
                }],
                playerCount: 0,
                fromLoopFrame: false,
            },
        });
    }

    it('stamps the flag unconditionally so a stale true cannot leak into an out-of-frame emit', () => {
        const state = createRenderState();
        const seen = [];
        const unsubscribe = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.RENDER_FRAME,
            (payload) => seen.push(payload.fromLoopFrame),
        );

        try {
            state.renderAllPlayers(true); // loop frame
            state.renderAllPlayers(); // out-of-frame (e.g. input echo) — same object
            state.renderAllPlayers(true);
            state.renderAllPlayers(false);
        } finally {
            unsubscribe();
        }

        expect(seen).toEqual([true, false, true, false]);
        expect(state._renderPayload.fromLoopFrame).toBe(false);
        expect(state._renderPayload.playerCount).toBe(1);
    });
});
