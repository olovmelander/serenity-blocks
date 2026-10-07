/**
 * A round that a knock-out ends holds a beat before the next one (ffa-round-policy.js):
 * the knocked-out board drains, its Out card rises and every client says who took the
 * round. Before, the host restarted at once and the last knock-out of every round never
 * showed.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    ROUND_OVER_BEAT_MS, cancelFfaRoundRestart, handleFfaMatchEnd, scheduleFfaRoundRestart,
} from '../../src/core/multiplayer/ffa-round-policy.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';

function host(overrides = {}) {
    return {
        isHost: true,
        gamePhase: 'finished',
        roundGeneration: 3,
        restartMatch: vi.fn(),
        ...overrides,
    };
}

describe('round-over beat (host)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('starts the next round after the beat', () => {
        const game = host();
        expect(scheduleFfaRoundRestart(game)).toBe(true);
        vi.advanceTimersByTime(ROUND_OVER_BEAT_MS - 1);
        expect(game.restartMatch).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(game.restartMatch).toHaveBeenCalledTimes(1);
    });

    it('never restarts a round that moved on, a match that left "finished", or a disposed state', () => {
        const moved = host();
        scheduleFfaRoundRestart(moved);
        moved.roundGeneration = 4;
        const replayed = host();
        scheduleFfaRoundRestart(replayed);
        replayed.gamePhase = 'playing';
        const gone = host();
        scheduleFfaRoundRestart(gone);
        gone._disposed = true;
        vi.advanceTimersByTime(ROUND_OVER_BEAT_MS);
        [moved, replayed, gone].forEach((game) => expect(game.restartMatch).not.toHaveBeenCalled());
    });

    it("is the host's alone, and a cancel drops it", () => {
        const peer = host({ isHost: false });
        expect(scheduleFfaRoundRestart(peer)).toBe(false);
        const game = host();
        scheduleFfaRoundRestart(game);
        cancelFfaRoundRestart(game);
        vi.advanceTimersByTime(ROUND_OVER_BEAT_MS * 2);
        expect(game.restartMatch).not.toHaveBeenCalled();
    });

    it('one beat at a time: a second schedule replaces the first', () => {
        const game = host();
        scheduleFfaRoundRestart(game);
        scheduleFfaRoundRestart(game);
        vi.advanceTimersByTime(ROUND_OVER_BEAT_MS);
        expect(game.restartMatch).toHaveBeenCalledTimes(1);
    });
});

describe('match end on a peer', () => {
    const unsubs = [];
    afterEach(() => { while (unsubs.length) unsubs.pop()(); });

    const peer = () => ({
        players: new Map([['A', { steamId: 'A', name: 'Ada' }]]),
        stopGameLoop: vi.fn(),
        stopStateSyncLoop: vi.fn(),
    });

    it('a round over tells the UI who took it, and stops the board', () => {
        const game = peer();
        const seen = [];
        unsubs.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_OVER, (d) => seen.push(d)));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        handleFfaMatchEnd(game, { data: { winner: 'A', winnerName: 'Ada', isGameOver: false } });
        expect(game.gamePhase).toBe('finished');
        expect(game.stopGameLoop).toHaveBeenCalled();
        expect(seen).toHaveLength(1);
        expect(seen[0].winner).toMatchObject({ steamId: 'A', name: 'Ada' });
    });

    it('a match over shows the results', () => {
        const game = peer();
        const results = [];
        const rounds = [];
        unsubs.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, (d) => results.push(d)));
        unsubs.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_OVER, (d) => rounds.push(d)));
        handleFfaMatchEnd(game, { data: { winner: 'A', winnerName: 'Ada', isGameOver: true, finalStats: [] } });
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ winnerName: 'Ada', isGameOver: true });
        expect(rounds).toHaveLength(0);
    });
});
