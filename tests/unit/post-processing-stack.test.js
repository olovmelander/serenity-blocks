import { describe, expect, it } from 'vitest';
import {
    PostProcessingStack,
    resolveChapterSeamFxProfile,
} from '../../src/rendering/odyssey/effects/PostProcessingStack.js';

function createStackStub() {
    return {
        time: 0,
        qualitySettings: {
            bloomStrength: 0.6,
            chromaticStrength: 0.002,
            vignetteIntensity: 0.4,
            filmGrainIntensity: 0.06,
        },
        dynamicState: {
            chromaticBoost: 0,
            vignetteBoost: 0,
            bloomBoost: 0,
            grainBoost: 0,
        },
        passes: {
            bloom: { strength: 0 },
            chromatic: { uniforms: { uStrength: { value: 0 } } },
            vignette: { uniforms: { uIntensity: { value: 0 } } },
            grain: { uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } } },
        },
    };
}

describe('resolveChapterSeamFxProfile', () => {
    it('returns stronger late-game profiles', () => {
        const standard = resolveChapterSeamFxProfile('standard', 1);
        const heavy = resolveChapterSeamFxProfile('heavy', 1);
        const neon = resolveChapterSeamFxProfile('neon', 1);

        expect(heavy.vignetteBoost).toBeGreaterThan(standard.vignetteBoost);
        expect(neon.bloomBoost).toBeGreaterThan(standard.bloomBoost);
        expect(neon.chromaticBoost).toBeGreaterThan(0);
    });
});

describe('PostProcessingStack chapter seam state', () => {
    it('applies seam boosts to available passes and decays them over time', () => {
        const stack = createStackStub();

        PostProcessingStack.prototype.triggerChapterSeam.call(stack, {
            preset: 'heavy',
            intensity: 1,
        });

        const initialChromaticBoost = stack.dynamicState.chromaticBoost;
        PostProcessingStack.prototype.update.call(stack, 1 / 60);

        expect(stack.passes.bloom.strength).toBeGreaterThan(0.6);
        expect(stack.passes.chromatic.uniforms.uStrength.value).toBeGreaterThan(0.002);
        expect(stack.passes.vignette.uniforms.uIntensity.value).toBeGreaterThan(0.4);
        expect(stack.passes.grain.uniforms.uIntensity.value).toBeGreaterThan(0.06);
        expect(stack.dynamicState.chromaticBoost).toBeLessThan(initialChromaticBoost);
    });

    it('still decays seam boosts when optional passes are missing', () => {
        const stack = createStackStub();
        stack.passes = {};

        PostProcessingStack.prototype.triggerChapterSeam.call(stack, {
            preset: 'neon',
            intensity: 1,
        });

        const initialBloomBoost = stack.dynamicState.bloomBoost;
        PostProcessingStack.prototype.update.call(stack, 1 / 60);

        expect(stack.dynamicState.bloomBoost).toBeLessThan(initialBloomBoost);
        expect(stack.dynamicState.chromaticBoost).toBeGreaterThanOrEqual(0);
    });
});
