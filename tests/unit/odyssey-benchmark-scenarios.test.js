import { describe, expect, it } from 'vitest';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { resolveScenario, supportsScenario } from '../../scripts/odyssey-benchmark/scenarios.mjs';

describe('isolated Odyssey balance experiments', () => {
    it('extends only the Orb 59 deadline without relaxing its score or quality gates', () => {
        const original = getLevelById(59);
        const before = structuredClone(original);
        for (const deadline of [210, 240]) {
            const variant = resolveScenario(original, `orb59-deadline${deadline}`);
            expect(variant.victory.failure.value).toBe(deadline);
            variant.victory.failure.value = before.victory.failure.value;
            expect(variant).toEqual(before);
        }
        expect(original).toEqual(before);
        expect(() => resolveScenario(getLevelById(51), 'orb59-deadline210')).toThrow();
    });

    it('requests only gravity scaling for Orb 51, preserving score level and acceleration', () => {
        const original = getLevelById(51);
        const before = structuredClone(original);
        const variant = resolveScenario(original, 'orb51-fall75');
        expect(variant.benchmarkPhysicsPolicy).toEqual({ initialFallMs: 75 });
        delete variant.benchmarkPhysicsPolicy;
        expect(variant).toEqual(before);
        expect(original).toEqual(before);
    });

    it('changes duel gravity while preserving first-to-seven and the authored opponent', () => {
        const original = getLevelById(4);
        const variant = resolveScenario(original, 'duel-fall700');
        expect(variant.mechanics.speed.fixedDropInterval).toBe(700);
        expect(variant.mechanics.versus).toEqual(original.mechanics.versus);
        expect(variant.mechanics.versus.fragsToWin).toBe(7);
        expect(variant.stars).toEqual(original.stars);
        expect(original.mechanics.speed.fixedDropInterval).toBe(1000);
    });

    it('returns an independent baseline and rejects unsupported or unknown experiments', () => {
        const original = getLevelById(1);
        const variant = resolveScenario(original);
        variant.victory.primary.target = 999;
        expect(original.victory.primary.target).toBe(20);
        expect(supportsScenario('duel-fall850', original)).toBe(false);
        expect(supportsScenario('invalid', original)).toBe(false);
        expect(() => resolveScenario(original, 'invalid')).toThrow();
    });
});
