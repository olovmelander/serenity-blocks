/**
 * Black Hole — the hole's moods turn by the clock in every mode, and a level is one mood forward
 * on top (black-hole-moods.js, BlackHoleWorld.stepMood / applyDirector). Timings are read from
 * the module; the director's own look (play heat) still builds on top of the mood.
 */
import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    MOODS, MOOD_COUNT, MOOD_HOLD, MOOD_PERIOD, MOOD_SCALARS, MOOD_TINTS, moodAt,
} from '../../src/themes/black-hole/black-hole-moods.js';
import {
    BLACK_HOLE_SEED, BlackHoleWorld, bakeBlackHoleTextures,
} from '../../src/themes/black-hole/black-hole-world.js';
import BlackHoleTheme from '../../src/themes/black-hole/black-hole-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const BAKES = bakeBlackHoleTextures({ skySize: [32, 16] }, BLACK_HOLE_SEED);
const worlds = [];
function create() {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 20000);
    const world = new BlackHoleWorld({
        scene: new THREE.Scene(), camera, quality: 'Minimal', bakes: BAKES,
    });
    worlds.push(world);
    return world;
}
afterEach(() => {
    for (const world of worlds) world.dispose();
    worlds.length = 0;
    vi.unstubAllGlobals();
});

const resting = (k) => (k + MOOD_HOLD * 0.5) * MOOD_PERIOD;

/** What the lens is fed, over what the director (or the lens default of 1) set: the mood. */
function shown(world) {
    const { uniforms: u, director: d } = world;
    return {
        heat: u.diskHeat.value / d.diskHeat,
        gain: u.diskGain.value / d.diskGain,
        ring: u.ringGain.value / d.ringGain,
        sky: u.skyGain.value / d.skyGain,
        nebula: u.nebulaGain.value / d.nebulaGain,
        stars: u.starGain.value,
        corona: u.coronaGain.value,
        tint: u.diskTint.value.toArray().map((c, i) => c / d.diskTint[i]),
        ringTint: u.ringTint.value.toArray().map((c, i) => c / d.ringTint[i]),
    };
}
function expectMood(world, k) {
    const s = shown(world);
    for (const key of MOOD_SCALARS) expect(s[key], `${MOODS[k].name} ${key}`).toBeCloseTo(MOODS[k][key], 5);
    for (const key of MOOD_TINTS) s[key].forEach((c, i) => expect(c).toBeCloseTo(MOODS[k][key][i], 5));
}
/** Advance the world with no events from `from` to `to`. */
function run(world, from, to, step = 1 / 30) {
    let t = from;
    while (t < to - 1e-9) {
        const dt = Math.min(step, to - t);
        t += dt;
        world.update(t, dt);
    }
    return t;
}

describe('black-hole moods: the factors', () => {
    it('opens on today\'s look: mood 0 scales nothing', () => {
        for (const key of MOOD_SCALARS) expect(MOODS[0][key]).toBe(1);
        for (const key of MOOD_TINTS) expect(MOODS[0][key]).toEqual([1, 1, 1]);
    });

    it('has 4-6 moods, each its own, every factor positive', () => {
        expect(MOOD_COUNT).toBeGreaterThanOrEqual(4);
        expect(MOOD_COUNT).toBeLessThanOrEqual(6);
        for (let k = 0; k < MOOD_COUNT; k++) {
            const a = MOODS[k];
            const b = MOODS[(k + 1) % MOOD_COUNT];
            for (const key of MOOD_SCALARS) expect(a[key]).toBeGreaterThan(0);
            const spread = Math.max(...MOOD_SCALARS.map((key) => Math.abs(a[key] - b[key])));
            expect(spread, `${a.name} -> ${b.name}`).toBeGreaterThan(0.3);
        }
    });

    it('is a mood exactly on a whole phase, and between two it lies between them', () => {
        for (let k = 0; k < MOOD_COUNT; k++) {
            const out = moodAt(k + MOOD_COUNT * 4);
            for (const key of MOOD_SCALARS) expect(out[key]).toBe(MOODS[k][key]);
        }
        const half = moodAt(1.5);
        for (const key of MOOD_SCALARS) {
            const lo = Math.min(MOODS[1][key], MOODS[2][key]);
            const hi = Math.max(MOODS[1][key], MOODS[2][key]);
            expect(half[key]).toBeGreaterThanOrEqual(lo);
            expect(half[key]).toBeLessThanOrEqual(hi);
        }
    });

    it('never flashes: a melt changes no factor by more than a sliver a frame (ADR-0021)', () => {
        const world = create();
        let before = shown(world);
        const step = 1 / 60;
        for (let t = step; t < MOOD_PERIOD * MOOD_COUNT; t += step * 6) {
            world.time = t;
            world.stepMood(1);
            world.applyDirector();
            const now = shown(world);
            for (const key of MOOD_SCALARS) {
                // Six frames at a time: the bound is per frame.
                expect(Math.abs(now[key] - before[key]) / 6, key).toBeLessThan(0.002);
            }
            before = now;
        }
    });
});

describe('black-hole moods: the clock turns them, a level is a step on top', () => {
    it('turns through every mood by the clock alone, with no level-up', () => {
        const world = create();
        expectMood(world, 0);
        let t = 0;
        for (let k = 0; k < MOOD_COUNT + 1; k++) {
            t = run(world, t, resting(k), 0.5);
            expectMood(world, k % MOOD_COUNT);
        }
    });

    it('lets the heat of play build on top of the mood', () => {
        const world = create();
        const t = run(world, 0, resting(3), 0.5);
        world.director.onPieceLock({ piece: { x: 3, y: 20, shape: [[1, 1, 1, 1]] } });
        world.director.onLineClear({ lineCount: 4 });
        run(world, t, t + 0.2);
        expect(world.director.diskHeat).toBeGreaterThan(1);
        expect(world.uniforms.diskHeat.value).toBeCloseTo(world.director.diskHeat * MOODS[3].heat, 6);
        expect(world.uniforms.ringGain.value).toBeCloseTo(world.director.ringGain * MOODS[3].ring, 6);
    });

    it('steps one mood forward on a level, eased over a few seconds, and keeps it through a reset', () => {
        const world = create();
        const t0 = resting(0);
        let t = run(world, 0, t0, 0.5);
        world.setLevel(2);
        t = run(world, t, t + 0.2);
        expect(Math.abs(shown(world).nebula - MOODS[1].nebula)).toBeGreaterThan(0.01);
        t = run(world, t, t + 15);
        expect(t).toBeLessThan(MOOD_HOLD * MOOD_PERIOD);
        expectMood(world, 1);
        // The level is the game's: a reset (a seek's replay) keeps it, snapped.
        world.reset();
        expectMood(world, 1);
        world.update(resting(1), 0);
        expectMood(world, 2);
    });

    it('keeps the level-up\'s own pressure front and ring flare', () => {
        const world = create();
        run(world, 0, 1);
        world.director.onLevelUp({ level: 2 });
        world.update(1 + 1 / 60, 1 / 60);
        expect(world.director.waves.some((wave) => wave.active)).toBe(true);
        expect(world.director.ringPulse).toBeGreaterThan(0.5);
    });

    it('the theme moves the hole on a LEVEL_UP whatever the background-effects setting', () => {
        vi.stubGlobal('window', {
            settings: { backgroundComboEffects: false },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { search: '' },
        });
        const theme = new BlackHoleTheme();
        theme.isActive = true;
        theme.world = { setLevel: vi.fn(), setReducedMotion: vi.fn(), director: { onLevelUp: vi.fn() } };
        theme.setupEventListeners();
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        expect(theme.world.setLevel).toHaveBeenCalledWith(3);
        expect(theme.world.director.onLevelUp).not.toHaveBeenCalled();
        // With no level in the payload it counts on from the last one.
        eventBus.emit(EVENTS.LEVEL_UP, {});
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(4);
        window.settings.backgroundComboEffects = true;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 5 });
        expect(theme.world.director.onLevelUp).toHaveBeenCalledWith({ level: 5 });
        theme.teardownEventListeners();
    });
});
