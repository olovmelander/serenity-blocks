import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

// The board's flashes, hit-stops and zoom punches read these two switches. Only Odyssey
// writes a game state's settings, so on every other board the live Settings must count.
function boardEffects({ gameStateSettings, live = {}, osReducedMotion = false } = {}) {
    vi.stubGlobal('window', {
        settings: live,
        matchMedia: (query) => ({ matches: osReducedMotion && query.includes('reduced-motion') }),
    });
    const gameState = gameStateSettings === undefined ? {} : { settings: gameStateSettings };
    return new SharedEffects({ time: {}, tweens: {}, gameState });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('board effects under Settings > Reduce motion', () => {
    it('follow the live setting on a board whose game state carries no settings', () => {
        expect(boardEffects({ live: { reducedMotion: true } })._reducedMotion()).toBe(true);
        expect(boardEffects({ live: { reducedMotion: false } })._reducedMotion()).toBe(false);
    });

    it('follow the system preference and an Odyssey board\'s own copy', () => {
        expect(boardEffects({ osReducedMotion: true })._reducedMotion()).toBe(true);
        expect(boardEffects({ gameStateSettings: { reducedMotion: true } })._reducedMotion()).toBe(true);
    });
});

describe('board effects under Settings > Reduce flashing', () => {
    it('follow the live setting on any board', () => {
        expect(boardEffects({ live: { reduceFlashing: true } })._reducedFlashing()).toBe(true);
        expect(boardEffects({ live: {} })._reducedFlashing()).toBe(false);
    });

    it('follow it on an Odyssey board, whose own settings hold only reduced motion', () => {
        const effects = boardEffects({
            gameStateSettings: { reducedMotion: false }, live: { reduceFlashing: true },
        });
        expect(effects._reducedFlashing()).toBe(true);
    });
});
