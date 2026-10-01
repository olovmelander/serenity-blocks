import { describe, expect, it } from 'vitest';
import {
    BLOOD_MOON_TIERS, BloodMoonReactions, resolveBloodMoonLayout,
} from '../../src/playground/effects/blood-moon-state.js';

function expectClearDisk(layout, width, height, rects = []) {
    const x = layout.x * width;
    const y = (1 - layout.y) * height;
    const radius = layout.radius * height;
    expect(x - radius).toBeGreaterThanOrEqual(-1e-7);
    expect(x + radius).toBeLessThanOrEqual(width + 1e-7);
    expect(y - radius).toBeGreaterThanOrEqual(-1e-7);
    expect(y + radius).toBeLessThanOrEqual(height + 1e-7);
    for (const rect of rects) {
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(radius - 1e-7);
    }
}

describe('Blood Moon composition', () => {
    it('places the wide hero at the upper left and the portrait hero at the upper right', () => {
        expect(resolveBloodMoonLayout(1920, 1080)).toEqual({ x: 0.235, y: 0.62, radius: 0.23 });
        const portrait = resolveBloodMoonLayout(600, 900);
        expect(portrait.x).toBeCloseTo(0.72);
        expect(portrait.y).toBeCloseTo(0.82);
        expect(portrait.radius).toBeCloseTo(0.14);
        expectClearDisk(portrait, 600, 900);
    });

    const viewportSizes = [[320, 1440], [720, 800], [1024, 768], [3440, 1440]];
    it.each(viewportSizes)('keeps the whole disk inside a %i x %i viewport', (width, height) => {
        expectClearDisk(resolveBloodMoonLayout(width, height), width, height);
    });

    it('keeps the moon clear of a central board without changing the wide composition', () => {
        const rects = [{
            left: 750, top: 140, right: 1170, bottom: 1000,
        }];
        const layout = resolveBloodMoonLayout(1920, 1080, rects);
        expect(layout.x).toBeCloseTo(0.235);
        expect(layout.radius).toBeCloseTo(0.23);
        expectClearDisk(layout, 1920, 1080, rects);
    });

    it('finds a visible disk around obstructed portrait and multiplayer layouts', () => {
        const cases = [
            {
                width: 600,
                height: 900,
                rects: [{
                    left: 160, top: 170, right: 520, bottom: 840,
                }],
            },
            {
                width: 1920,
                height: 1080,
                rects: [
                    {
                        left: 150, top: 250, right: 720, bottom: 1050,
                    },
                    {
                        left: 1000, top: 250, right: 1570, bottom: 1050,
                    },
                ],
            },
        ];
        for (const { width, height, rects } of cases) {
            const layout = resolveBloodMoonLayout(width, height, rects);
            expect(layout.radius).toBeGreaterThan(0.065);
            expectClearDisk(layout, width, height, rects);
        }
    });

    it('handles a fully occluded viewport and malformed geometry without non-finite output', () => {
        expect(resolveBloodMoonLayout(800, 600, [{
            left: 0, top: 0, right: 800, bottom: 600,
        }]).radius).toBe(0);
        expect(resolveBloodMoonLayout(1920, 1080, [null, {}, { left: NaN }]))
            .toEqual(resolveBloodMoonLayout(1920, 1080));
        const invalid = resolveBloodMoonLayout(NaN, Infinity, null);
        expect(Object.values(invalid).every(Number.isFinite)).toBe(true);
    });

    it('keeps all six quality tiers bounded and preserves the hero surface on low quality', () => {
        const tiers = Object.values(BLOOD_MOON_TIERS);
        expect(tiers).toHaveLength(6);
        expect(BLOOD_MOON_TIERS.Minimal.surfaceSize).toBe(512);
        expect(BLOOD_MOON_TIERS.Extreme.surfaceSize).toBe(2048);
        for (let i = 1; i < tiers.length; i++) {
            for (const key of ['stars', 'motes', 'sparks', 'surfaceSize']) {
                expect(tiers[i][key]).toBeGreaterThanOrEqual(tiers[i - 1][key]);
            }
        }
    });
});

describe('Blood Moon reactions', () => {
    it('gives a piece lock the Wolfhour lunar pulse timing and a smooth light envelope', () => {
        const state = new BloodMoonReactions();
        state.cue('lock');
        expect(state.lunarPulses.filter((pulse) => pulse.age !== Infinity)).toEqual([
            {
                age: 0, duration: 1.25, strength: 1, combo: 0.12,
            },
        ]);
        expect(state.lunarEnergy).toBe(0);
        state.update(0.625);
        expect(state.lunarEnergy).toBeCloseTo(0.474, 12);
        state.update(0.625);
        expect(state.lunarEnergy).toBe(0);
        expect(state.lunarPulses.every((pulse) => pulse.age === Infinity && pulse.strength === 0)).toBe(true);
    });

    it('lets repeated locks overlap without rewinding a halo already in flight', () => {
        const state = new BloodMoonReactions();
        state.cue('lock');
        const first = state.lunarPulses[0];
        state.update(0.4);
        state.cue('lock');
        expect(first.age).toBe(0.4);
        expect(state.lunarPulses.filter((pulse) => pulse.age !== Infinity)).toHaveLength(2);
        state.update(0.4);
        expect(first.age).toBe(0.8);
        expect(state.lunarPulses[1].age).toBe(0.4);
        state.update(0.46);
        expect(first.age).toBe(Infinity);
        expect(state.lunarPulses[1].age).toBeCloseTo(0.86);
        expect(state.lunarEnergy).toBeGreaterThan(0);
    });

    it('merges a same-update lock, clear and combo into one halo regardless of event order', () => {
        const events = [['lock'], ['clear', { lines: 4 }], ['combo', { combo: 5 }]];
        const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        let expected;
        for (const order of orders) {
            const state = new BloodMoonReactions();
            state.cue('lock');
            state.update(0.3);
            for (const index of order) state.cue(...events[index]);
            expect(state.lunarPulses.filter((pulse) => pulse.age !== Infinity)).toHaveLength(2);
            expect(state.lunarPulses[0].age).toBe(0.3);
            expect(state.lunarPulses[1].strength).toBeGreaterThan(1);
            expect(state.lunarPulses[1].duration).toBeGreaterThan(1.25);
            if (expected) expect(state.lunarPulses).toEqual(expected);
            else expected = state.lunarPulses;
        }
    });

    it('reuses only the halo nearest expiry when all four slots are occupied', () => {
        const state = new BloodMoonReactions();
        const slots = [...state.lunarPulses];
        state.cue('perfectClear');
        state.update(0.1);
        for (let i = 0; i < 3; i++) {
            state.cue('lock');
            state.update(0.1);
        }
        state.cue('combo', { combo: 3 });
        expect(state.lunarPulses).toHaveLength(4);
        slots.forEach((pulse, index) => expect(state.lunarPulses[index]).toBe(pulse));
        expect(slots[0].age).toBeCloseTo(0.4);
        expect(slots[1].age).toBe(0);
        expect(slots[2].age).toBeCloseTo(0.2);
        expect(slots[3].age).toBeCloseTo(0.1);
    });

    it('bounds accumulated lunar illumination during event floods and reuses slots on reset', () => {
        const state = new BloodMoonReactions();
        const pool = state.lunarPulses;
        const slots = [...pool];
        for (let i = 0; i < 1000; i++) {
            state.cue('perfectClear');
            state.cue('combo', { combo: Number.MAX_VALUE });
            state.update(0);
        }
        expect(pool.every((pulse) => pulse.duration <= 1.9 && pulse.strength <= 1.35 && pulse.combo <= 1)).toBe(true);
        state.update(0.95);
        expect(state.lunarEnergy).toBe(1.8);
        state.reset();
        expect(state.lunarPulses).toBe(pool);
        slots.forEach((pulse, index) => expect(pool[index]).toBe(pulse));
        expect(state.lunarEnergy).toBe(0);
        expect(pool.every((pulse) => pulse.age === Infinity)).toBe(true);
    });

    it('gives locks a visible bounded flash and short impact, reserving bursts for clears', () => {
        const state = new BloodMoonReactions();
        state.cue('lock');
        expect(state.pulse).toBeGreaterThan(0);
        expect(state.pulse).toBeGreaterThan(0.15);
        expect(state.pulse).toBeLessThan(0.4);
        expect(state.starBoost).toBeGreaterThan(0.5);
        expect(state.impact).toBeGreaterThan(0);
        expect(state.waveAge).toBe(Infinity);
        expect(state.burstAge).toBe(Infinity);
        state.update(0.3);
        expect(state.impact).toBeLessThan(0.015);
        state.cue('clear', { lines: 1 });
        expect(state.waveAge).toBe(0);
        expect(state.burstAge).toBe(Infinity);
        state.cue('clear', { lineCount: 4 });
        expect(state.burstAge).toBe(0);
    });

    it('coalesces clear/combo order into one stronger wave and burst', () => {
        const clearOnly = new BloodMoonReactions();
        const forward = new BloodMoonReactions();
        const reverse = new BloodMoonReactions();
        clearOnly.cue('clear', { lines: 4 });
        forward.cue('clear', { lines: 4 });
        forward.cue('combo', { combo: 5 });
        reverse.cue('combo', { comboCount: 5 });
        reverse.cue('clear', { lineCount: 4 });
        for (const key of ['pulse', 'corona', 'starBoost', 'burst', 'waveStrength', 'waveAge', 'burstAge']) {
            expect(forward[key]).toBe(reverse[key]);
        }
        expect(forward.waveStrength).toBeGreaterThan(clearOnly.waveStrength);
        expect(forward.corona).toBeGreaterThan(clearOnly.corona);
        forward.update(0.25);
        expect(forward.waveAge).toBe(0.25);
        expect(forward.burstAge).toBe(0.25);
    });

    it('signals bursts for doubles and combos without replaying one on an age-zero lock', () => {
        const state = new BloodMoonReactions();
        expect(state.cue('clear', { lines: 1 })).toBe(0);
        expect(state.cue('clear', { lines: 2 })).toBeGreaterThan(0);
        state.update(0);
        expect(state.cue('lock')).toBe(0);
        expect(state.cue('combo', { combo: 2 })).toBeGreaterThan(0);
        state.reducedMotion = true;
        expect(state.cue('tetris')).toBe(0);
    });

    it('decays identically at 30 and 144 FPS and with a single equivalent time step', () => {
        const states = [new BloodMoonReactions(), new BloodMoonReactions(), new BloodMoonReactions()];
        states.forEach((state) => state.cue('tetris'));
        for (let i = 0; i < 30; i++) states[0].update(1 / 30);
        for (let i = 0; i < 144; i++) states[1].update(1 / 144);
        states[2].update(1);
        for (const key of ['time', 'pulse', 'corona', 'starBoost', 'burst', 'waveAge', 'burstAge']) {
            expect(states[0][key]).toBeCloseTo(states[2][key], 12);
            expect(states[1][key]).toBeCloseTo(states[2][key], 12);
        }
        for (const state of states) {
            expect(state.lunarPulses[0].age).toBeCloseTo(1, 12);
            expect(state.lunarEnergy).toBeCloseTo(states[2].lunarEnergy, 12);
        }
    });

    it('bounds event floods and validates malformed payloads and time steps', () => {
        const state = new BloodMoonReactions();
        const keys = ['pulse', 'corona', 'starBoost', 'burst', 'waveStrength'];
        for (let i = 0; i < 1000; i++) {
            state.cue('perfectClear');
            state.cue('combo', { comboCount: Number.MAX_VALUE });
            state.cue('clear', { lineCount: NaN, lines: Infinity });
            state.cue('clear', null);
        }
        for (const key of keys) {
            expect(state[key]).toBeGreaterThanOrEqual(0);
            expect(state[key]).toBeLessThanOrEqual(1);
        }
        for (const dt of [undefined, NaN, Infinity, -1]) state.update(dt);
        expect(state.time).toBe(0);
        expect(state.waveAge).toBe(0);
        state.update(Number.MAX_VALUE);
        expect(state.time).toBe(60);
        expect(state.waveAge).toBe(Infinity);
        expect(state.waveStrength).toBe(0);
        expect(state.burstAge).toBe(Infinity);
        expect(state.burst).toBe(0);
    });

    it('ignores unknown events and maps both payload spellings to the same clear strength', () => {
        const state = new BloodMoonReactions();
        state.cue('unknown');
        expect(state.pulse).toBe(0);
        state.cue('clear', { lineCount: 3 });
        const alternate = new BloodMoonReactions();
        alternate.cue('clear', { lines: 3 });
        expect(state).toEqual(alternate);
    });

    it('reduces light responses and removes motion immediately when the preference changes', () => {
        const normal = new BloodMoonReactions();
        const reduced = new BloodMoonReactions({ reducedMotion: true });
        normal.cue('perfectClear');
        reduced.cue('perfectClear');
        expect(reduced.corona).toBeLessThan(normal.corona * 0.3);
        expect(reduced.pulse).toBeGreaterThan(0);
        expect(reduced.burst).toBe(0);
        expect(reduced.waveAge).toBe(Infinity);
        expect(reduced.burstAge).toBe(Infinity);
        expect(reduced.lunarEnergy).toBe(0);
        expect(reduced.lunarPulses.every((pulse) => pulse.age === Infinity)).toBe(true);
        normal.update(0.4);
        expect(normal.lunarEnergy).toBeGreaterThan(0);
        normal.reducedMotion = true;
        expect(normal.burst).toBe(0);
        expect(normal.waveStrength).toBe(0);
        expect(normal.waveAge).toBe(Infinity);
        expect(normal.lunarEnergy).toBe(0);
        expect(normal.lunarPulses.every((pulse) => pulse.age === Infinity)).toBe(true);
        normal.cue('lock');
        expect(normal.lunarPulses.every((pulse) => pulse.age === Infinity)).toBe(true);
        normal.reducedMotion = false;
        normal.cue('lock');
        expect(normal.lunarPulses.filter((pulse) => pulse.age !== Infinity)).toHaveLength(1);
        normal.reducedMotion = true;
        normal.reset();
        expect(normal.reducedMotion).toBe(true);
        expect(normal.pulse).toBe(0);
        expect(normal.time).toBe(0);
    });

    it.each(['tetris', 'tspin', 'perfectClear', 'levelUp'])('gives %s a bounded moon-first cue', (kind) => {
        const state = new BloodMoonReactions();
        state.cue(kind);
        expect(state.corona).toBeGreaterThan(state.starBoost);
        expect(state.waveAge).toBe(0);
        state.update(5);
        expect(state.waveAge).toBe(Infinity);
        expect(state.burstAge).toBe(Infinity);
    });
});
