/**
 * Koi Pond — the wheel of nights.
 *
 * The pond's colours stand on a wheel of six nights. A new level steps it one night on, and the
 * clock carries it round by itself, level or no level. These tests pin the wheel (every night
 * whole, neighbours that mix through a colour, a rest on each night), the two ways it turns, and
 * that the pond's light stays a pure function of the clock, so a seek and a replay still
 * reproduce any frame.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    KOI_POND_MOODS, LEAF_KEYS, LEAF_STOPS, MOOD_DRIFT, MOOD_KEYS, MOOD_REST, MOOD_TURN, moodAt, moodMix, moodPhase,
    sinkOf, turnToward,
} from '../../src/themes/koi-pond/koi-pond-moods.js';
import {
    LEAF_ROWS, MOON_COLOR, PondLight,
} from '../../src/themes/koi-pond/koi-pond-light.js';
import { KoiPondWorld, REST_RIG, fovForAspect } from '../../src/themes/koi-pond/koi-pond-world.js';
import { fallbackLayout } from '../../src/themes/koi-pond/koi-pond-composition.js';
import { tierFor } from '../../src/themes/koi-pond/koi-pond-quality.js';

vi.setConfig({ testTimeout: 30_000 }); // some tests build a pond, on a machine that may be busy

const DT = 1 / 60;
const N = KOI_POND_MOODS.length;
const worlds = [];

function makeWorld() {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new KoiPondWorld({ scene, quality: 'Minimal', capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    world.setLayout(fallbackLayout(1600, 900), aspect);
    world.seek(0);
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    worlds.push(world);
    return { camera, world };
}

function run(world, camera, seconds) {
    const t0 = world.time;
    const steps = Math.round(seconds / DT);
    for (let i = 1; i <= steps; i += 1) {
        const sim = { time: t0 + i * DT, delta: DT };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** How much of a colour is colour: 0 for a grey, 1 for a pure hue. */
const chroma = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b, 1e-9);
const hue = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min || 1e-9;
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
};
const uniformRgb = (u) => [u.value.x, u.value.y, u.value.z];

afterEach(() => {
    while (worlds.length) worlds.pop().dispose();
});

describe('koi pond moods: the wheel', () => {
    it('holds six whole nights, each with every colour and both leaf ramps', () => {
        expect(N).toBe(6);
        expect(new Set(KOI_POND_MOODS.map((m) => m.name)).size).toBe(N);
        KOI_POND_MOODS.forEach((night) => {
            MOOD_KEYS.forEach((key) => {
                expect(night[key], `${night.name}.${key}`).toHaveLength(3);
                night[key].forEach((v) => {
                    expect(Number.isFinite(v)).toBe(true);
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1.2);
                });
            });
            LEAF_KEYS.forEach((key) => {
                expect(night[key], `${night.name}.${key}`).toHaveLength(LEAF_STOPS);
                // A leaf brightens from its shaded heart to its lit tip.
                const peak = night[key].map((stop) => Math.max(...stop));
                expect(peak[0]).toBeLessThan(peak[1]);
                expect(peak[1]).toBeLessThan(peak[2]);
            });
            // Moonlight is a tint, never a colour of its own: its brightest channel is 1.
            expect(Math.max(...night.moon)).toBe(1);
            expect(chroma(night.moon)).toBeLessThan(0.5);
        });
    });

    it('keeps the pond it was built as for its first night', () => {
        const jade = KOI_POND_MOODS[0];
        expect(jade.name).toBe('jade night');
        expect(jade.moon).toEqual([0.62, 0.78, 1.0]);
        expect(jade.scatter).toEqual([0.004, 0.03, 0.036]);
        expect(jade.absorb).toEqual([0.42, 0.11, 0.09]);
        expect(jade.lantern).toEqual([1.0, 0.56, 0.2]);
        expect(jade.leafA[1]).toEqual([0.46, 0.014, 0.01]);
        expect(MOON_COLOR).toEqual(jade.moon);
        // What is left of the moon a metre down: the figures the pond was tuned with.
        const sink = sinkOf(jade.absorb);
        [0.52, 0.2, 0.17].forEach((v, c) => expect(Math.abs(sink[c] - v)).toBeLessThan(0.012));
    });

    it('orders the nights by the hue of their water, so neighbours mix through a colour and never through grey', () => {
        const mixed = ['scatter', 'water', 'sky'];
        for (let i = 0; i < N; i += 1) {
            const a = KOI_POND_MOODS[i];
            const b = KOI_POND_MOODS[(i + 1) % N];
            // Round the wheel the water's hue only ever goes one way (here: up), and never so
            // far in one step that the half-way water would pale (a third of the wheel).
            const step = (hue(b.scatter) - hue(a.scatter) + 360) % 360;
            expect(step, `${a.name} -> ${b.name}`).toBeGreaterThan(20);
            expect(step, `${a.name} -> ${b.name}`).toBeLessThan(120);
            mixed.forEach((key) => {
                const half = a[key].map((v, c) => (v + b[key][c]) / 2);
                expect(chroma(half), `${a.name} + ${b.name}: ${key}`).toBeGreaterThan(0.4);
            });
        }
    });

    it('rests on a night, crosses to the next and rests again', () => {
        const at = (p) => moodMix(p, {});
        expect(at(0)).toEqual({ from: 0, to: 1, mix: 0 });
        expect(at(MOOD_REST * 0.99).mix).toBe(0);
        expect(at(0.5).mix).toBeCloseTo(0.5, 9);
        expect(at(1 - MOOD_REST * 0.99).mix).toBe(1);
        expect(at(1)).toEqual({ from: 1, to: 2, mix: 0 });
        expect(at(N - 0.5)).toMatchObject({ from: N - 1, to: 0 });
        expect(at(N)).toEqual({ from: 0, to: 1, mix: 0 });
        // Never backwards within a step, and nonsense is the first night.
        let last = -1;
        for (let p = 0; p <= 1; p += 0.01) {
            const { mix } = at(2 + Math.min(p, 0.999));
            expect(mix).toBeGreaterThanOrEqual(last);
            last = mix;
        }
        expect(at(NaN)).toEqual({ from: 0, to: 1, mix: 0 });
        expect(at(-3)).toEqual({ from: 0, to: 1, mix: 0 });
    });

    it('gives a night whole at rest and the same light where one step ends and the next begins', () => {
        for (let i = 0; i < N; i += 1) {
            const rest = moodAt(i + MOOD_REST * 0.5, {});
            MOOD_KEYS.forEach((key) => expect(rest[key]).toEqual(KOI_POND_MOODS[i][key]));
            const before = moodAt(i + 1 - 1e-9, {});
            const after = moodAt(i + 1, {});
            MOOD_KEYS.forEach((key) => {
                before[key].forEach((v, c) => expect(v).toBeCloseTo(after[key][c], 9));
            });
        }
        // It writes into what it is given, and reuses it.
        const out = {};
        expect(moodAt(0.5, out)).toBe(out);
        const { moon } = out;
        moodAt(3.5, out);
        expect(out.moon).toBe(moon);
    });

    it('puts level and clock on the same wheel', () => {
        expect(moodPhase(1, 0)).toBe(0);
        expect(moodPhase(4, 0)).toBe(3);
        expect(moodPhase(1, MOOD_DRIFT * 2.5)).toBeCloseTo(2.5, 12);
        expect(moodPhase(3, MOOD_DRIFT)).toBeCloseTo(3, 12);
        expect(moodPhase(NaN, NaN)).toBe(0);
        expect(moodPhase(0, -5)).toBe(0);
        // Slow enough to be a drift, quick enough that a long calm game sees every night.
        expect(MOOD_DRIFT).toBeGreaterThanOrEqual(60);
        expect(MOOD_DRIFT * N).toBeLessThanOrEqual(15 * 60);
    });

    it('turns to a level\'s place the short way round, and settles exactly on it', () => {
        expect(turnToward(0, 2, 1)).toBe(1);
        expect(turnToward(4.2, 1, 1)).toBe(0);
        expect(turnToward(0, N + 1, 1)).toBe(0); // level seven stands where level one does
        expect(turnToward(NaN, 3, 0.1)).toBe(2);
        // From the last night to the first is one step on, not five back.
        const on = turnToward(N - 1, N + 1, 0.25);
        expect(on).toBeGreaterThan(N - 1);
        expect(on).toBeLessThan(N);
        // A new run: from level five back to one goes two steps on (5 -> 0), not four back.
        expect(turnToward(4, 1, 0.5)).toBeCloseTo(5, 9);
        let place = 0;
        for (let i = 0; i < 2000 && place !== 1; i += 1) place = turnToward(place, 2, 1 - Math.exp(-MOOD_TURN * DT));
        expect(place).toBe(1);
        expect(turnToward(1, 2, 0)).toBe(1);
    });
});

describe('koi pond moods: the light', () => {
    it('starts on the jade night and hands every part the night it is given', () => {
        const light = new PondLight({ tier: tierFor('Minimal') });
        const jade = KOI_POND_MOODS[0];
        expect(uniformRgb(light.u.moonColor)).toEqual(jade.moon);
        expect(uniformRgb(light.u.scatter)).toEqual(jade.scatter);
        expect(light.u.leafTurn.value).toBe(0);
        expect(light.leafRamp).toHaveLength(LEAF_ROWS * 2);

        const mood = moodAt(3.5, {});
        light.setMood(mood, 1.2);
        const close = (u, want) => uniformRgb(u).forEach((v, c) => expect(v).toBeCloseTo(want[c], 6));
        close(light.u.moonColor, mood.moon);
        close(light.u.skyAmbient, mood.sky);
        close(light.u.zenith, mood.zenith);
        close(light.u.waterAmbient, mood.water);
        close(light.u.scatter, mood.scatter);
        close(light.u.absorb, mood.absorb);
        close(light.u.sink, sinkOf(mood.absorb));
        close(light.u.petal, mood.petal);
        close(light.u.petalPale, mood.petalPale);
        close(light.u.firefly, mood.firefly);
        close(light.u.lanternColor, mood.lantern.map((v) => v * 1.2));
        expect(light.u.leafTurn.value).toBeCloseTo(0.5, 9);
        // The leaves are never mixed: this night's two ramps, then the next night's, whole.
        const rows = light.leafRamp.map((v) => [v.x, v.y, v.z]);
        const want = [3, 4].flatMap((night) => LEAF_KEYS.flatMap((key) => KOI_POND_MOODS[night][key]));
        rows.forEach((row, i) => row.forEach((v, c) => expect(v).toBeCloseTo(want[i][c], 6)));
        light.dispose();
    });
});

describe('koi pond moods: the pond', () => {
    it('drifts from night to night with the clock alone, level or no level', () => {
        const { world, camera } = makeWorld();
        expect(world.getState()).toMatchObject({ night: 'jade night', nextNight: 'frost moon', nightMix: 0 });
        const jadeWater = uniformRgb(world.light.u.scatter);

        // Half-way to the next night.
        world.seek(MOOD_DRIFT * 0.5);
        world.update({ time: MOOD_DRIFT * 0.5, delta: 0 }, camera);
        expect(world.getState()).toMatchObject({ night: 'jade night', nextNight: 'frost moon', nightMix: 0.5 });
        expect(world.light.u.leafTurn.value).toBeCloseTo(0.5, 6);
        expect(uniformRgb(world.light.u.scatter)).not.toEqual(jadeWater);

        // Resting on the fourth night, two hundred and eighty seconds in, still at level one.
        const t = MOOD_DRIFT * 3 + 10;
        world.seek(t);
        world.update({ time: t, delta: 0 }, camera);
        const state = world.getState();
        expect(state).toMatchObject({
            level: 1, night: KOI_POND_MOODS[3].name, nextNight: KOI_POND_MOODS[4].name, nightMix: 0,
        });
        uniformRgb(world.light.u.moonColor).forEach((v, c) => expect(v).toBeCloseTo(KOI_POND_MOODS[3].moon[c], 6));
        const post = world.getPostState();
        expect(post.gradeMul).toEqual(KOI_POND_MOODS[3].gradeMul);
        expect(post.gradeLift).toEqual(KOI_POND_MOODS[3].gradeLift);
    });

    it('steps one night on at a new level, over a few seconds and not at a stroke', () => {
        const { world, camera } = makeWorld();
        run(world, camera, 2);
        world.levelUp(2);
        run(world, camera, DT);
        // One frame later the night has barely moved: no colour jumps.
        expect(world.moodPlace).toBeGreaterThan(0);
        expect(world.moodPlace).toBeLessThan(0.02);
        expect(world.getState().night).toBe('jade night');
        let last = world.moodPlace;
        let biggest = 0;
        for (let i = 0; i < 60 * 4; i += 1) {
            run(world, camera, DT);
            biggest = Math.max(biggest, world.moodPlace - last);
            expect(world.moodPlace).toBeGreaterThanOrEqual(last);
            last = world.moodPlace;
        }
        expect(biggest).toBeLessThan(0.012);
        // Four seconds on it is all but there; soon after, exactly there.
        expect(world.moodPlace).toBeGreaterThan(0.85);
        run(world, camera, 16);
        expect(world.moodPlace).toBe(1);
        expect(world.getState()).toMatchObject({ level: 2, night: 'frost moon' });
    });

    it('snaps to a level\'s night when told to be silent, and wraps round the wheel', () => {
        const { world, camera } = makeWorld();
        world.levelUp(4, { silent: true });
        world.update({ time: 0, delta: 0 }, camera);
        expect(world.moodPlace).toBe(3);
        expect(world.getState()).toMatchObject({ night: KOI_POND_MOODS[3].name, nightMix: 0, nightPhase: 3 });
        world.levelUp(N + 2, { silent: true });
        world.update({ time: 0, delta: 0 }, camera);
        expect(world.getState().night).toBe(KOI_POND_MOODS[1].name);
        // Nonsense is level one.
        world.levelUp('x', { silent: true });
        expect(world.level).toBe(1);
        expect(world.moodPlace).toBe(0);
    });

    it('goes back to the clock\'s own night for a new run, the short way', () => {
        const { world, camera } = makeWorld();
        world.levelUp(6, { silent: true });
        run(world, camera, 0.5);
        expect(world.getState().night).toBe(KOI_POND_MOODS[5].name);
        world.resetSession();
        expect(world.level).toBe(1);
        run(world, camera, 20);
        // One step on from the last night is the first again.
        expect(world.moodPlace).toBe(0);
        expect(world.getState().night).toBe('jade night');
        // A seek forgets the level altogether.
        world.levelUp(3, { silent: true });
        world.seek(0);
        expect(world.moodPlace).toBe(0);
        expect(world.level).toBe(1);
    });

    it('is a pure function of the clock at rest: a seek and a replay give the same night', () => {
        const a = makeWorld();
        const b = makeWorld();
        // One pond plays four minutes through a level-up; the other is dropped in at the end.
        a.world.levelUp(3, { silent: true });
        const t = MOOD_DRIFT * 2.4;
        a.world.seek(t - 30);
        a.world.levelUp(3, { silent: true });
        run(a.world, a.camera, 30);
        b.world.seek(t);
        b.world.levelUp(3, { silent: true });
        b.world.update({ time: t, delta: 0 }, b.camera);
        expect(a.world.time).toBeCloseTo(t, 6);
        expect(a.world.getState().nightPhase).toBeCloseTo(b.world.getState().nightPhase, 3);
        ['moonColor', 'scatter', 'absorb', 'skyAmbient', 'petal'].forEach((key) => {
            uniformRgb(a.world.light.u[key]).forEach((v, c) => {
                expect(v).toBeCloseTo(uniformRgb(b.world.light.u[key])[c], 5);
            });
        });
        expect(a.world.light.u.leafTurn.value).toBeCloseTo(b.world.light.u.leafTurn.value, 5);
    });

    it('lets the flame gutter in the night\'s own colour', () => {
        const { world, camera } = makeWorld();
        const t = MOOD_DRIFT * 4 + 5; // the harvest moon's deeper flame
        world.seek(t);
        world.update({ time: t, delta: 0 }, camera);
        const flame = uniformRgb(world.light.u.lanternColor);
        const want = KOI_POND_MOODS[4].lantern;
        const flicker = flame[0] / want[0];
        expect(flicker).toBeGreaterThan(0.9);
        expect(flicker).toBeLessThan(1.1);
        flame.forEach((v, c) => expect(v).toBeCloseTo(want[c] * flicker, 6));
    });
});
