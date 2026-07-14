import {
    describe, expect, it, vi,
} from 'vitest';
import { fillBag, GameState } from '../../src/core/game.js';
import {
    bindLegacySessionRng,
    createLegacySessionRngDescriptor,
    generateSessionSeed,
    normalizeSessionSeed,
} from '../../src/core/session-rng.js';
import { seededRandom } from '../../src/utils/helpers.js';

describe('legacy session RNG seed boundary', () => {
    it('preserves zero, including negative zero, as the valid uint32 seed zero', () => {
        expect(normalizeSessionSeed(0)).toBe(0);
        expect(normalizeSessionSeed(-0)).toBe(0);

        const gameState = {};
        const descriptor = bindLegacySessionRng(gameState, 0);
        const expected = seededRandom(0);

        expect(descriptor.seed).toBe(0);
        expect(gameState.randomGenerator.seed).toBe(0);
        expect(Array.from({ length: 16 }, () => gameState.randomGenerator()))
            .toEqual(Array.from({ length: 16 }, () => expected()));
    });

    it.each([
        undefined,
        null,
        '',
        '0',
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        1.5,
        0x100000000,
    ])('rejects invalid or non-canonical seed %j without mutating state', (seed) => {
        const originalGenerator = vi.fn();
        const gameState = { randomGenerator: originalGenerator };

        expect(() => bindLegacySessionRng(gameState, seed)).toThrow(TypeError);
        expect(gameState).toEqual({ randomGenerator: originalGenerator });
    });

    it.each([null, undefined, [], () => {}])('rejects non-object game state %j', (gameState) => {
        expect(() => bindLegacySessionRng(gameState, 1)).toThrow(TypeError);
    });
});

describe('legacy session RNG descriptor', () => {
    it('is explicit and immutable', () => {
        const descriptor = createLegacySessionRngDescriptor(0xffffffff);

        expect(descriptor).toEqual({
            algorithm: 'lcg-v1',
            seed: 0xffffffff,
            stream: 'pieces:shared-v1',
        });
        expect(Object.isFrozen(descriptor)).toBe(true);
        expect(() => {
            descriptor.seed = 7;
        }).toThrow(TypeError);
        expect(descriptor.seed).toBe(0xffffffff);
    });

    it('binds identical legacy sequences, bags, and cursors for one seed', () => {
        const first = { nextPieces: [] };
        const second = { nextPieces: [] };
        const legacy = {
            nextPieces: [],
            randomGenerator: seededRandom(0xdecafbad),
        };
        bindLegacySessionRng(first, 0xdecafbad);
        bindLegacySessionRng(second, 0xdecafbad);

        const firstSequence = Array.from({ length: 32 }, () => first.randomGenerator());
        expect(firstSequence)
            .toEqual(Array.from({ length: 32 }, () => second.randomGenerator()));
        expect(firstSequence)
            .toEqual(Array.from({ length: 32 }, () => legacy.randomGenerator()));
        fillBag(first.nextPieces, first.randomGenerator);
        fillBag(second.nextPieces, second.randomGenerator);
        fillBag(legacy.nextPieces, legacy.randomGenerator);

        expect(first.nextPieces).toEqual(second.nextPieces);
        expect(first.nextPieces).toEqual(legacy.nextPieces);
        expect(first.randomGenerator.getState()).toBe(second.randomGenerator.getState());
        expect(first.randomGenerator.getState()).toBe(legacy.randomGenerator.getState());
        expect(first.rngDescriptor).toEqual(second.rngDescriptor);
    });

    it('clears the descriptor and generator together on GameState reset', () => {
        const gameState = new GameState();
        const descriptor = bindLegacySessionRng(gameState, 17);

        expect(gameState.rngDescriptor).toBe(descriptor);
        gameState.reset();

        expect(gameState.rngDescriptor).toBeNull();
        expect(gameState.randomGenerator).toBe(Math.random);
    });
});

describe('legacy session seed generation', () => {
    it('uses an injected crypto source without touching the fallback', () => {
        const fallbackRandom = vi.fn(() => 0.5);
        const getRandomValues = vi.fn((words) => {
            words.set([0xdecafbad]);
            return words;
        });

        expect(generateSessionSeed({
            cryptoProvider: { getRandomValues },
            fallbackRandom,
        })).toBe(0xdecafbad);
        expect(getRandomValues).toHaveBeenCalledTimes(1);
        expect(getRandomValues.mock.calls[0][0]).toBeInstanceOf(Uint32Array);
        expect(fallbackRandom).not.toHaveBeenCalled();
    });

    it('uses a deterministic injectable fallback when crypto is unavailable', () => {
        const fallbackRandom = vi.fn(() => 0.5);

        expect(generateSessionSeed({ cryptoProvider: null, fallbackRandom }))
            .toBe(0x80000000);
        expect(fallbackRandom).toHaveBeenCalledTimes(1);
        expect(generateSessionSeed({ cryptoProvider: null, fallbackRandom: () => 0 }))
            .toBe(0);
    });

    it.each([-0.1, 1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects an invalid fallback draw %s',
        (draw) => {
            expect(() => generateSessionSeed({
                cryptoProvider: null,
                fallbackRandom: () => draw,
            })).toThrow(TypeError);
        },
    );
});
