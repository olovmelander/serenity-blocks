import {
    describe, expect, it, vi,
} from 'vitest';
import {
    handleFfaRoundRestart,
    normalizeFfaRoundSeed,
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

    it('canonicalizes only finite legacy-compatible numeric seeds', () => {
        expect(normalizeFfaRoundSeed(0)).toBe(0);
        expect(normalizeFfaRoundSeed(-0)).toBe(0);
        expect(normalizeFfaRoundSeed(42.5)).toBe(42.5);
        expect(normalizeFfaRoundSeed(' 42.5 ')).toBe(42.5);
        expect(normalizeFfaRoundSeed('0')).toBe(0);

        [
            undefined,
            null,
            false,
            true,
            '',
            '   ',
            'not-a-seed',
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            [],
            {},
        ].forEach((value) => expect(normalizeFfaRoundSeed(value)).toBeNull());
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
            from: 'HOST', data: { roundGeneration: 3 },
        })).toBe(false);
        expect(game.performRoundRestart).not.toHaveBeenCalled();

        expect(handleFfaRoundRestart(game, {
            from: 'HOST', data: { roundGeneration: 2, newSeed: 9 },
        })).toBe(false);
        expect(game.performRoundRestart).not.toHaveBeenCalled();
    });

    it('passes one validated host advance and preserves seed zero', () => {
        const game = {
            isHost: false,
            roundGeneration: 2,
            _isFromHost: vi.fn(() => true),
            performRoundRestart: vi.fn(),
        };
        const message = {
            from: 'HOST',
            data: { roundGeneration: 3, newSeed: 0 },
        };

        expect(handleFfaRoundRestart(game, message)).toBe(true);
        expect(game.performRoundRestart).toHaveBeenCalledWith({
            roundGeneration: 3,
            newSeed: 0,
        });
    });

    it('canonicalizes compatible wire strings and rejects malformed seeds before restart', () => {
        const game = {
            isHost: false,
            roundGeneration: 2,
            _isFromHost: vi.fn(() => true),
            performRoundRestart: vi.fn(),
        };

        expect(handleFfaRoundRestart(game, {
            from: 'HOST', data: { roundGeneration: 3, newSeed: ' 17 ' },
        })).toBe(true);
        expect(game.performRoundRestart).toHaveBeenLastCalledWith({
            roundGeneration: 3,
            newSeed: 17,
        });

        game.performRoundRestart.mockClear();
        [false, true, '', 'nope', Number.NaN, Number.POSITIVE_INFINITY, [], {}]
            .forEach((newSeed) => {
                expect(handleFfaRoundRestart(game, {
                    from: 'HOST', data: { roundGeneration: 3, newSeed },
                })).toBe(false);
            });
        expect(game.performRoundRestart).not.toHaveBeenCalled();
    });
});
