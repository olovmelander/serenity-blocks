import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FragTracker } from '../../src/core/multiplayer/frag-tracker.js';
import { ROUND_OVER_BEAT_MS } from '../../src/core/multiplayer/ffa-round-policy.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

function makePlayer(steamId, overrides = {}) {
    return {
        steamId,
        name: `Player ${steamId}`,
        color: '#fff',
        isAlive: true,
        frags: 0,
        gameState: { score: 0, lines: 0, piecesPlaced: 0 },
        ...overrides,
    };
}

function makeGameState(overrides = {}) {
    return {
        isHost: false,
        gamePhase: 'playing',
        matchStartTime: Date.now(),
        matchConfig: { endCondition: 'never', endConditionValue: 0 },
        players: new Map([
            ['A', makePlayer('A')],
            ['B', makePlayer('B')],
        ]),
        network: { broadcastToAll: vi.fn() },
        stopStateSyncLoop: vi.fn(),
        stopGameLoop: vi.fn(),
        restartMatch: vi.fn(),
        ...overrides,
    };
}

describe('FragTracker host authority', () => {
    it('stays inert on a peer', () => {
        const gameState = makeGameState();
        const tracker = new FragTracker(gameState);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        tracker.recordDeath('B', 'A');

        expect(gameState.players.get('B').isAlive).toBe(true);
        expect(gameState.network.broadcastToAll).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('records deaths and ends the round once the owning state is promoted to host', () => {
        // The tracker is constructed while this client is still a peer — exactly what
        // happens to the successor in a host migration.
        vi.useFakeTimers();
        const gameState = makeGameState();
        const tracker = new FragTracker(gameState);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        gameState.isHost = true; // promoteToHost()

        tracker.recordDeath('B', 'A');

        expect(gameState.players.get('B').isAlive).toBe(false);
        expect(gameState.players.get('A').frags).toBe(1);
        expect(gameState.network.broadcastToAll).toHaveBeenCalledWith(
            MessageTypes.GAME_PLAYER_DIED,
            expect.objectContaining({ player: 'B', killer: 'A' }),
        );
        // Last player standing ends the round on the promoted host.
        expect(gameState.gamePhase).toBe('finished');
        expect(gameState.network.broadcastToAll).toHaveBeenCalledWith(
            MessageTypes.GAME_MATCH_END,
            expect.objectContaining({ winner: 'A' }),
        );
        // The round's outcome holds for a beat before the next round starts.
        expect(gameState.restartMatch).not.toHaveBeenCalled();
        vi.advanceTimersByTime(ROUND_OVER_BEAT_MS);
        expect(gameState.restartMatch).toHaveBeenCalledTimes(1);
        log.mockRestore();
        vi.useRealTimers();
    });

    it('drops authority again if the owning state is demoted', () => {
        const gameState = makeGameState({ isHost: true });
        const tracker = new FragTracker(gameState);

        gameState.isHost = false;

        expect(tracker.isHost).toBe(false);
        tracker.checkMatchEnd();
        expect(gameState.network.broadcastToAll).not.toHaveBeenCalled();
    });
});
