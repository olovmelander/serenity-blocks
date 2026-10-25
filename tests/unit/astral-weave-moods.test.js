/**
 * Astral Weave — the deep field's moods turn by the clock in every mode, and a level is one mood
 * on top as well as its richer figure (astral-weave-moods.js, and how the world stands the sky on
 * them). Timings are read from the module, never copied.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ASTRAL_MOODS, AstralWeaveMoods, LEVEL_EASE, MOOD_COLOURS, MOOD_PERIOD, MOOD_REST, MOOD_SCALARS, moodAt,
    moodDriftAt,
} from '../../src/themes/astral-weave/astral-weave-moods.js';
import { AstralWeaveWorld, K_REST } from '../../src/themes/astral-weave/astral-weave-world.js';
import { LAMPS } from '../../src/themes/astral-weave/astral-weave-sky.js';
import { fallbackLayout } from '../../src/themes/astral-weave/astral-weave-composition.js';

const N = ASTRAL_MOODS.length;
/** The middle of mood `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + MOOD_REST * 0.5) * MOOD_PERIOD;
const melting = (k) => (k + MOOD_REST + (1 - MOOD_REST) * 0.5) * MOOD_PERIOD;
/** The largest difference in any channel of any of two moods' colours. */
const far = (a, b) => Math.max(...MOOD_COLOURS.flatMap(
    (key) => a.colours[key].map((c, i) => Math.abs(c - b.colours[key][i])),
));

function makeWorld(at = 10) {
    const world = new AstralWeaveWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
    world.setViewport(1920, 1080, 16 / 9);
    world.setLayout(fallbackLayout(1920, 1080), 16 / 9);
    world.seek(at);
    return world;
}

/** Advance the world from its current time to `to` seconds, at `hz` frames a second. */
function runTo(world, to, hz = 20) {
    const t0 = world.time;
    const steps = Math.max(1, Math.round((to - t0) * hz));
    for (let i = 1; i <= steps; i++) world.update({ time: t0 + ((to - t0) * i) / steps, delta: (to - t0) / steps });
}

/** What the sky shader reads right now. */
const shown = (world) => ({
    colours: Object.fromEntries(MOOD_COLOURS.map((key) => [key, world.shared.uMood[key].value.toArray()])),
    ...Object.fromEntries(MOOD_SCALARS.map((key) => [key, world.shared.uMood[key].value])),
});

describe('astral weave moods: the deep field', () => {
    it('opens on the deep field the theme has always shown', () => {
        const [first] = ASTRAL_MOODS;
        // The constants the sky shader used before the moods.
        expect(first.gasA).toEqual([0.012, 0.21, 0.27]);
        expect(first.gasB).toEqual([0.07, 0.055, 0.33]);
        expect(first.gasC).toEqual([0.36, 0.05, 0.2]);
        expect(first.space).toEqual([0.0022, 0.0034, 0.0105]);
        expect(first.band).toEqual([0.0035, 0.005, 0.017]);
        expect(first.lampA).toEqual(LAMPS[0].tint);
        expect(first.lampB).toEqual(LAMPS[1].tint);
        expect(first.glow).toEqual([0.3, 0.5, 0.95]);
        expect(first.filamentA).toEqual([0.3, 0.62, 0.8]);
        expect(first.filamentB).toEqual([0.8, 0.42, 0.62]);
        expect(first.highlight).toEqual([0.55, 0.7, 0.9]);
        expect([first.stars, first.weave]).toEqual([1, 1]);
    });

    it('gives every mood every value, each plainly a different nebula from its neighbours', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        for (const mood of ASTRAL_MOODS) {
            for (const key of MOOD_COLOURS) {
                expect(mood[key]).toHaveLength(3);
                expect(mood[key].every((c) => c >= 0 && c <= 1)).toBe(true);
            }
            for (const key of MOOD_SCALARS) expect(mood[key]).toBeGreaterThan(0.5);
        }
        for (let k = 0; k < N; k++) {
            expect(far(moodAt(k), moodAt(k + 1)), `${ASTRAL_MOODS[k].name}`).toBeGreaterThan(0.15);
        }
    });

    it('is exactly a mood on a whole phase', () => {
        for (let k = 0; k < N * 2; k++) {
            const mood = moodAt(k);
            for (const key of MOOD_COLOURS) expect(mood.colours[key]).toEqual([...ASTRAL_MOODS[k % N][key]]);
            for (const key of MOOD_SCALARS) expect(mood[key]).toBe(ASTRAL_MOODS[k % N][key]);
        }
    });

    it('rests on a mood, then melts into the next, at the house pace', () => {
        for (let k = 0; k < N + 1; k++) {
            expect(moodDriftAt(k * MOOD_PERIOD)).toBe(k);
            expect(moodDriftAt(resting(k))).toBe(k);
            expect(moodDriftAt(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
        expect(MOOD_PERIOD).toBeGreaterThanOrEqual(80);
        expect(N * MOOD_PERIOD).toBeGreaterThanOrEqual(360);
        expect(N * MOOD_PERIOD).toBeLessThanOrEqual(600);
    });
});

describe('astral weave moods: the clock turns the light', () => {
    it('turns the sky through every mood with no event at all', () => {
        const world = makeWorld(0);
        let before = null;
        for (let k = 0; k < N; k++) {
            runTo(world, resting(k));
            expect(world.moods.phase).toBe(k);
            const sky = shown(world);
            for (const key of MOOD_COLOURS) {
                sky.colours[key].forEach((c, i) => expect(c).toBeCloseTo(ASTRAL_MOODS[k][key][i], 6));
            }
            if (before) expect(far(sky, before)).toBeGreaterThan(0.15);
            before = sky;
        }
        // The figure stays the play's: the clock never re-weaves it.
        expect(world.kTarget).toBe(K_REST);
        world.dispose();
    });

    it('stands where the clock says after a seek, replayed or not', () => {
        const a = makeWorld(0);
        runTo(a, melting(2));
        const b = makeWorld(melting(2));
        expect(b.moods.phase).toBeCloseTo(a.moods.phase, 9);
        expect(far(shown(b), shown(a))).toBeLessThan(1e-6);
        a.dispose();
        b.dispose();
    });
});

describe('astral weave moods: a level is a mood on top', () => {
    it('still rests the weave on a richer figure and rings the hoop, and moves the light one mood on', () => {
        const world = makeWorld(10);
        const fronts = () => world.shared.uSweep.array.filter((s) => s.z > 0 && s.y === world.time).length;
        world.levelUp(2);
        expect(world.kTarget).toBe(K_REST + 1);
        expect(fronts()).toBe(1);
        runTo(world, 10.5);
        expect(world.energy).toBeGreaterThan(0.2);
        expect(world.moods.phase).toBeGreaterThan(0);
        expect(world.moods.phase).toBeLessThan(0.5);
        runTo(world, 10 + LEVEL_EASE * 10);
        expect(world.moods.phase).toBe(1);
        // And the clock turns on from the new mood: half-way through the melt, half a mood on.
        runTo(world, melting(0));
        expect(world.moods.phase).toBeCloseTo(1.5, 6);
        world.dispose();
    });

    it('keeps the light through a new run and a seek; a restart stands it at once', () => {
        const world = makeWorld(10);
        world.levelUp(2);
        world.levelUp(3);
        world.resetSession();
        expect(world.kTarget).toBe(K_REST);
        expect(world.moodSteps).toBe(2);
        world.seek(resting(0));
        expect(world.moods.phase).toBe(2);
        world.setMoodSteps(4);
        expect(world.moods.phase).toBe(4);
        expect(shown(world).colours.gasA).toEqual([...ASTRAL_MOODS[4].gasA]);
        world.dispose();
    });

    it('goes the short way round and lands exactly', () => {
        const moods = new AstralWeaveMoods();
        for (let i = 0; i < N + 1; i++) moods.levelUp();
        moods.update(1 / 30, 1);
        expect(moods.step).toBeGreaterThan(0);
        expect(moods.step).toBeLessThan(1);
        // N + 1 levels on shows the same mood as one: it never spins the whole wheel round.
        for (let i = 0; i < 900; i++) moods.update(1 / 30, 1);
        expect(moods.phase).toBe(1);
    });
});
