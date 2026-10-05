import { describe, expect, it } from 'vitest';
import {
    BREATH_PHASES, breathLevel, cycleSeconds, easeBreath, isValidPattern, nextPhase, resolveBreath,
} from '../../src/ui/effects/breathing/breath-clock.js';
import {
    BREATH_WORLDS, DEFAULT_BREATH_WORLD, formatPattern, getBreathWorld, isBreathWorld,
} from '../../src/ui/effects/breathing/breath-catalogue.js';

describe('breath clock', () => {
    it('eases a breath without a corner at either end', () => {
        expect(easeBreath(0)).toBe(0);
        expect(easeBreath(1)).toBeCloseTo(1, 12);
        expect(easeBreath(0.5)).toBeCloseTo(0.5, 12);
        // Gentle at both ends: the first and last tenth move far less than the middle tenth.
        expect(easeBreath(0.1)).toBeLessThan(0.03);
        expect(1 - easeBreath(0.9)).toBeLessThan(0.03);
        expect(easeBreath(-1)).toBe(0);
        expect(easeBreath(2)).toBeCloseTo(1, 12);
    });

    it('fills on the inhale, stays full, empties on the exhale and stays empty', () => {
        expect(breathLevel(0, 0)).toBe(0);
        expect(breathLevel(0, 1)).toBeCloseTo(1, 12);
        expect(breathLevel(1, 0.3)).toBe(1);
        expect(breathLevel(2, 0)).toBe(1);
        expect(breathLevel(2, 1)).toBeCloseTo(0, 12);
        expect(breathLevel(3, 0.7)).toBe(0);
    });

    it('resolves each phase of a pattern and wraps after a full cycle', () => {
        const pattern = [4, 7, 8, 0];
        expect(cycleSeconds(pattern)).toBe(19);
        expect(resolveBreath(pattern, 0)).toMatchObject({ phase: 0, progress: 0, breath: 0, duration: 4 });
        expect(resolveBreath(pattern, 2)).toMatchObject({ phase: 0, progress: 0.5, remaining: 2 });
        expect(resolveBreath(pattern, 4)).toMatchObject({ phase: 1, progress: 0, breath: 1 });
        expect(resolveBreath(pattern, 11)).toMatchObject({ phase: 2, progress: 0 });
        expect(resolveBreath(pattern, 19)).toMatchObject({ phase: 0, progress: 0 });
        expect(resolveBreath(pattern, 19 * 3 + 5).phase).toBe(1);
        expect(resolveBreath(pattern, -1).phase).toBe(2);
    });

    it('never lands in a phase that has no duration', () => {
        const pattern = [2, 0, 1, 0];
        for (let t = 0; t < 9; t += 0.25) expect([0, 2]).toContain(resolveBreath(pattern, t).phase);
        expect(nextPhase(pattern, 1)).toBe(2);
        expect(nextPhase(pattern, 3)).toBe(0);
        expect(nextPhase([0, 0, 0, 60], 0)).toBe(3);
    });

    it('rejects patterns that cannot be breathed', () => {
        expect(isValidPattern([4, 4, 4, 4])).toBe(true);
        expect(isValidPattern([0, 0, 0, 0])).toBe(false);
        expect(isValidPattern([4, -1, 4, 0])).toBe(false);
        expect(isValidPattern([4, 4, 4])).toBe(false);
        expect(isValidPattern([4, NaN, 4, 0])).toBe(false);
        expect(resolveBreath([0, 0, 0, 0], 5)).toMatchObject({ breath: 0, cycle: 0 });
    });
});

describe('breathing world catalogue', () => {
    it('lists twelve worlds with unique ids, a breathable rhythm and both cues', () => {
        expect(BREATH_WORLDS).toHaveLength(12);
        expect(new Set(BREATH_WORLDS.map((world) => world.id)).size).toBe(12);
        BREATH_WORLDS.forEach((world) => {
            expect(isValidPattern(world.pattern), world.id).toBe(true);
            expect(world.pattern[0], `${world.id} inhales`).toBeGreaterThan(0);
            expect(world.pattern[2], `${world.id} exhales`).toBeGreaterThan(0);
            expect(world.cues).toHaveLength(2);
            expect(world.accent).toHaveLength(3);
            world.accent.forEach((channel) => expect(channel).toBeGreaterThanOrEqual(0));
            expect(world.name && world.intent && world.summary && world.description).toBeTruthy();
        });
    });

    it('keeps the persisted technique ids and falls back to the default for unknown ones', () => {
        // These ids are stored in players' settings; renaming one silently resets their choice.
        expect(BREATH_WORLDS.map((world) => world.id)).toEqual([
            'deep-relaxation', 'box-breathing', 'calm-sleep', 'energizing', 'coherence', 'triangle',
            'wim-hof', 'ocean-breath', 'zen-garden', 'cosmic-breath', 'forest-breath', 'electric-storm',
        ]);
        expect(isBreathWorld('coherence')).toBe(true);
        expect(isBreathWorld('nope')).toBe(false);
        expect(getBreathWorld('nope').id).toBe(DEFAULT_BREATH_WORLD);
    });

    it('writes a rhythm without the phases it skips', () => {
        expect(formatPattern([5, 2, 7, 2])).toBe('5 · 2 · 7 · 2');
        expect(formatPattern([4, 7, 8, 0])).toBe('4 · 7 · 8');
        expect(formatPattern([5, 0, 5, 0])).toBe('5 · 5');
        expect(BREATH_PHASES).toEqual(['inhale', 'hold1', 'exhale', 'hold2']);
    });
});
