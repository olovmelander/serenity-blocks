import { describe, expect, it } from 'vitest';
import { applyBotConfigOverrides, getBotDifficultyConfig } from '../../src/core/ai/bot-difficulty.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';

function controller(options = {}) {
    return new PuzzleBotController({
        playerIndex: 1, playerState: {}, actions: {}, difficulty: 8, ...options,
    });
}

describe('Odyssey rival pace caps (level design audit 2026-11, R8)', () => {
    it('leaves every tier byte-identical when no overrides are passed (versus mode)', () => {
        for (let tier = 1; tier <= 10; tier++) {
            const config = getBotDifficultyConfig(tier);
            expect(applyBotConfigOverrides(config, null)).toBe(config);
            expect(applyBotConfigOverrides(config, undefined)).toBe(config);
        }
        expect(controller().config).toEqual(getBotDifficultyConfig(8));
        expect(controller({ configOverrides: null }).config).toEqual(getBotDifficultyConfig(8));
    });

    it('caps the action rate and reaction window, keeping the tier\'s judgement', () => {
        const tier = getBotDifficultyConfig(8);
        const capped = controller({ configOverrides: { maxApm: 360, reactionMs: [140, 280] } }).config;
        expect(capped).toMatchObject({ maxApm: 360, actionIntervalMs: 60000 / 360, reactionMs: [140, 280] });
        const judgement = ['lookaheadDepth', 'lookaheadBreadth', 'mistakeChance', 'heuristicNoise', 'cascadePlanning'];
        for (const key of judgement) {
            expect(capped[key], key).toEqual(tier[key]);
        }
    });

    it('ignores anything but a positive action rate and an ordered reaction window', () => {
        const tier = getBotDifficultyConfig(6);
        const ignored = applyBotConfigOverrides(tier, {
            maxApm: -5, reactionMs: [300, 100], mistakeChance: 0, lookaheadDepth: 9,
        });
        expect(ignored).toEqual(tier);
        expect(ignored).not.toBe(tier);
    });
});
