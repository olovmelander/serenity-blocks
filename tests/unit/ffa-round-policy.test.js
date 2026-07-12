import {
    describe, expect, it, vi,
} from 'vitest';
import {
    handleFfaRoundRestart,
    parseFfaRoundGeneration,
    readFfaRoundAdvance,
} from '../../src/core/multiplayer/ffa-round-policy.js';

describe('FFA round generation policy', () => {
    it('accepts only safe non-negative generations and strict advances', () => {
        expect(parseFfaRoundGeneration(0)).toBe(0);
        expect(parseFfaRoundGeneration(Number.NaN)).toBeNull();
        expect(parseFfaRoundGeneration(1.5)).toBeNull();
        expect(readFfaRoundAdvance(2, 3)).toBe(3);
        expect(readFfaRoundAdvance(2, 2)).toBeNull();
        expect(readFfaRoundAdvance(2, 1)).toBeNull();
    });

    it('rejects non-host and stale restart commands before lifecycle mutation', () => {
        const game = {
            isHost: false,
            roundGeneration: 2,
            _isFromHost: vi.fn(() => false),
            _rejectSpoof: vi.fn(),
            performRoundRestart: vi.fn(),
        };
        const forged = { from: 'EVIL', data: { roundGeneration: 3 } };

        expect(handleFfaRoundRestart(game, forged)).toBe(false);
        expect(game._rejectSpoof).toHaveBeenCalledWith('GAME_ROUND_RESTART', forged);
        expect(game.performRoundRestart).not.toHaveBeenCalled();

        game._isFromHost.mockReturnValue(true);
        expect(handleFfaRoundRestart(game, {
            from: 'HOST', data: { roundGeneration: 2 },
        })).toBe(false);
        expect(game.performRoundRestart).not.toHaveBeenCalled();
    });

    it('passes one validated host advance to the restart lifecycle', () => {
        const game = {
            isHost: false,
            roundGeneration: 2,
            _isFromHost: vi.fn(() => true),
            performRoundRestart: vi.fn(),
        };
        const message = {
            from: 'HOST',
            data: { roundGeneration: 3, newSeed: 7 },
        };

        expect(handleFfaRoundRestart(game, message)).toBe(true);
        expect(game.performRoundRestart).toHaveBeenCalledWith({
            roundGeneration: 3,
            newSeed: 7,
        });
    });
});
