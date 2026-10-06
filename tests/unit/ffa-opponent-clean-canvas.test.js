/**
 * A clean canvas on an opponent's tile. Peers never run an opponent's physics, so the
 * host's per-wave clear message says when a wave empties the board; before this only
 * the host ever saw an opponent's clean canvas.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';

const ROWS = 24;
const COLS = 10;
const cell = { type: 'O', color: '#f3d28d' };

function grid(filledRows, extra = []) {
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    filledRows.forEach((r) => g[r].fill(cell));
    extra.forEach(([r, c]) => { g[r][c] = cell; });
    return g;
}

function host(boardGrid) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        _opponentClearEvents: true,
        localPlayerId: 'HOST',
        roundGeneration: 2,
        players: new Map([['P2', { name: 'Ada', gameState: { boardGrid } }]]),
        network: { broadcastToAll: vi.fn() },
    });
}

const unsubs = [];
afterEach(() => {
    while (unsubs.length) unsubs.pop()();
});

function heard() {
    const events = [];
    unsubs.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.OPPONENT_CLEAR, (detail) => events.push(detail)));
    return events;
}

describe('opponent clean canvas', () => {
    it('the host marks the wave that empties the board', () => {
        const state = host(grid([22, 23]));
        const events = heard();
        state.buildPhysicsCallbacks('P2').onLineClear(2, [], [], [22, 23], 3);

        expect(state.network.broadcastToAll).toHaveBeenCalledWith(MessageTypes.GAME_LINES_CLEAR, expect.objectContaining({
            playerSteamId: 'P2', rows: [22, 23], cascadeCount: 3, clean: true,
        }));
        expect(events[0]).toMatchObject({ steamId: 'P2', cascadeCount: 3, clean: true });
    });

    it('a wave that leaves blocks behind is not clean', () => {
        const state = host(grid([23], [[21, 4]]));
        const events = heard();
        state.buildPhysicsCallbacks('P2').onLineClear(1, [], [], [23], 1);

        expect(state.network.broadcastToAll.mock.calls[0][1].clean).toBe(false);
        expect(events[0].clean).toBe(false);
    });

    it('a peer passes the flag on to its tile', () => {
        const peer = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false,
            _opponentClearEvents: true,
            localPlayerId: 'PEER',
            roundGeneration: 2,
            players: new Map([['P2', { name: 'Ada' }]]),
        });
        const events = heard();
        peer._applyPlayerClear({
            playerSteamId: 'P2', clearSeq: 1, roundGeneration: 2, rows: [23], lineCount: 1, cascadeCount: 4, clean: true,
        });
        peer._applyPlayerClear({
            playerSteamId: 'P2', clearSeq: 2, roundGeneration: 2, rows: [23], lineCount: 1, cascadeCount: 1,
        });

        expect(events.map((e) => [e.cascadeCount, e.clean])).toEqual([[4, true], [1, false]]);
    });
});
