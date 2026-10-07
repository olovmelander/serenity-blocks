/**
 * A disposed game state stops its timers and the chat's key listener, and a rematch
 * vote only counts once the match has ended.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { acceptsRematchVote, disposeFfaSessionTimers } from '../../src/core/multiplayer/ffa/session-teardown.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('session teardown', () => {
    it('stops the announce, barrier and rematch timers and destroys the chat', () => {
        vi.useFakeTimers();
        const fired = vi.fn();
        const game = {
            _announceTimer: setTimeout(fired, 100),
            _readyBarrierTimer: setTimeout(fired, 100),
            _rematchRestartTimer: setTimeout(fired, 100),
            _pendingRoundStart: fired,
            chat: { destroy: vi.fn() },
        };
        disposeFfaSessionTimers(game);
        vi.advanceTimersByTime(1000);
        expect(fired).not.toHaveBeenCalled();
        expect(game._pendingRoundStart).toBeNull();
        expect(game.chat.destroy).toHaveBeenCalledTimes(1);
    });

    it('counts a rematch vote only after the match has ended', () => {
        expect(acceptsRematchVote({ gamePhase: 'playing' })).toBe(false);
        expect(acceptsRematchVote({ gamePhase: 'finished' })).toBe(true);
        expect(acceptsRematchVote({ gamePhase: 'finished', _disposed: true })).toBe(false);
    });
});
