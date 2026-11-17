/**
 * Solar Eclipse — the living pass: the weather, the shadow's breathing reach, the comet, and an
 * effect of its own per event (shadow bands, a wave through the corona, a halo CME, the shadow
 * sweeping back, a pulse round the horizon, third contact at a run's end).
 *
 * Like the world tests, nothing here pins a gain, a colour or a width: the look is tuned by eye.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SWEEP, SolarEclipseWorld, THIRD_CONTACT, fovForAspect,
} from '../../src/themes/solar-eclipse/solar-eclipse-world.js';
import {
    CLOUDS, COMET, DECK, MOON, PALETTES, PALETTE_KEYS, SHADOW_BREATH, TOWERS, WEATHERS, WEATHER_BLEND, WEATHER_CYCLE,
    WEATHER_KEYS, cometAt, shadowReachAt, weatherAt,
} from '../../src/themes/solar-eclipse/solar-eclipse-core.js';
import { fallbackLayout } from '../../src/themes/solar-eclipse/solar-eclipse-composition.js';
import { QUALITY } from '../../src/themes/solar-eclipse/solar-eclipse-quality.js';

vi.setConfig({ testTimeout: 30_000 });

const worlds = [];

function step(world, camera, from, to, dt = 1 / 30) {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const sim = {
            time: from + i * h, delta: h, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

function makeWorld(start = 10, quality = 'Low') {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SolarEclipseWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    world.setLayout(fallbackLayout(1600, 900), aspect);
    world.seek(start);
    step(world, camera, start, start + 0.1);
    const go = (seconds, dt = 1 / 30) => step(world, camera, world.time, world.time + seconds, dt);
    return { world, camera, go };
}

afterEach(() => {
    while (worlds.length) worlds.pop().dispose();
});

describe('solar eclipse: the sky at totality', () => {
    it('gives every palette a belt above its band and a band taller than its rim', () => {
        expect(PALETTE_KEYS).toContain('belt');
        PALETTES.forEach((p) => {
            expect(p.bandHeight, p.name).toBeGreaterThan(p.glowHeight);
            // The air overhead stays a deep, cool dark in every palette: never a tinted wash.
            expect(p.mid[2], p.name).toBeGreaterThan(p.mid[0]);
            expect(p.zenith[2], p.name).toBeGreaterThan(p.zenith[0]);
        });
    });
});

describe('solar eclipse: the weather', () => {
    it('turns through every weather in a cycle, each weight within 0..1', () => {
        const seen = new Set();
        const w = {};
        for (let t = 0; t < WEATHER_CYCLE; t += 5) {
            weatherAt(t, w);
            seen.add(w.name);
            WEATHER_KEYS.forEach((key) => {
                expect(w[key]).toBeGreaterThanOrEqual(0);
                expect(w[key]).toBeLessThanOrEqual(1);
            });
        }
        expect([...seen].sort()).toEqual(WEATHERS.map((x) => x.name).sort());
        expect(weatherAt(WEATHER_CYCLE + 3).name).toBe(weatherAt(3).name);
        expect(weatherAt(-WEATHER_CYCLE + 3).name).toBe(weatherAt(3).name);
    });

    it('hands one weather to the next slowly, never in a jump', () => {
        const a = {};
        const b = {};
        for (let t = 0; t < WEATHER_CYCLE * 2; t += 0.5) {
            weatherAt(t, a);
            weatherAt(t + 0.5, b);
            WEATHER_KEYS.forEach((key) => expect(Math.abs(b[key] - a[key]), `${key} at ${t}`).toBeLessThan(0.06));
        }
        expect(WEATHER_BLEND).toBeGreaterThan(10);
        WEATHERS.forEach((x) => expect(x.seconds).toBeGreaterThan(WEATHER_BLEND * 2));
    });

    it('keeps the towers below the sun and the deck faded where it is too foreshortened', () => {
        expect(TOWERS.top).toBeLessThan(0.14);
        expect(DECK.fadeLow[0]).toBeLessThan(DECK.fadeLow[1]);
        // Every tier that draws the deck draws the towers too; Minimal draws no cloud at all.
        Object.values(QUALITY).forEach((tier) => {
            if (tier.deck) expect(tier.towers).toBe(true);
        });
        expect(QUALITY.Minimal.towers || QUALITY.Minimal.deck || QUALITY.Minimal.clouds).toBe(false);
    });

    it('writes the weather to the clouds, and holds a pinned one', () => {
        const { world, go } = makeWorld(200);
        const w = weatherAt(world.time);
        expect(world.u.weather.value.y).toBeCloseTo(w.towers, 5);
        world.pinWeather('deck');
        go(0.2);
        expect(world.getState().weather).toBe('deck');
        expect(world.u.weather.value.z).toBe(1);
        world.pinWeather(null);
        go(0.2);
        expect(world.getState().weather).toBe(weatherAt(world.time).name);
    });

    it('lets the shadow\'s reach breathe, so the volcano\'s summit passes into the sunlight and out', () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let t = 0; t < SHADOW_BREATH.seconds; t += 1) {
            const r = shadowReachAt(t);
            lo = Math.min(lo, r);
            hi = Math.max(hi, r);
            expect(Math.abs(shadowReachAt(t + 1) - r)).toBeLessThan(1);
        }
        expect(hi / lo).toBeGreaterThan(1.3);
        // The far row of bars still lies beyond the shadow at its widest.
        expect(CLOUDS.rows[0].distance).toBeGreaterThan(hi * 1.18 * 1.35);
        const { world, go } = makeWorld(0);
        let dark = Infinity;
        let lit = -Infinity;
        for (let i = 0; i < 40; i += 1) {
            go(SHADOW_BREATH.seconds / 40, 0.5);
            dark = Math.min(dark, world.u.summitLit.value);
            lit = Math.max(lit, world.u.summitLit.value);
        }
        expect(dark).toBeLessThan(0.5);
        expect(lit).toBeGreaterThan(0.9);
    });
});

describe('solar eclipse: the comet', () => {
    it('stands now and then, rising and fading smoothly, each one in the next place', () => {
        expect(cometAt(0).power).toBe(0);
        expect(cometAt(COMET.offset + COMET.life / 2).power).toBe(1);
        expect(cometAt(COMET.offset + COMET.life + 1).power).toBe(0);
        let last = 0;
        for (let t = 0; t < COMET.offset + COMET.period * 2; t += 0.25) {
            const c = cometAt(t);
            expect(Math.abs(c.power - last)).toBeLessThan(0.05);
            last = c.power;
        }
        const first = cometAt(COMET.offset + 20);
        const second = cometAt(COMET.offset + COMET.period + 20);
        expect(second.angle).not.toBe(first.angle);
        // Its head stands off the limb, clear of the prominences, inside the free space.
        COMET.places.forEach(([, distance]) => {
            expect(distance).toBeGreaterThan(1.9);
            expect(distance).toBeLessThan(3);
        });
    });

    it('is written to the sky, and a pinned age shows it', () => {
        const { world, go } = makeWorld(5);
        expect(world.u.comet.value.z).toBe(0);
        world.cometPin = 30;
        go(0.1);
        expect(world.u.comet.value.z).toBeGreaterThan(0.5);
    });
});

describe('solar eclipse: an effect of its own per event', () => {
    it('sends shadow bands over the flat on two lines, and lets them die away', () => {
        const { world, go } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2 });
        go(0.4);
        expect(world.u.bands.value).toBeGreaterThan(0.3);
        go(6);
        expect(world.u.bands.value).toBeLessThan(0.02);
    });

    it('runs a wave of light out through the corona on three lines; a quick second joins it', () => {
        const { world, go } = makeWorld();
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        go(0.1);
        const wave = world.u.coronaWave.value;
        expect(Math.max(wave.y, wave.w)).toBeGreaterThan(0.9);
        const start = Math.max(wave.x, wave.z);
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        go(0.05);
        // Within a quarter second the newer wave is strengthened, never restarted.
        expect(Math.max(world.u.coronaWave.value.x, world.u.coronaWave.value.z)).toBe(start);
    });

    it('blows out a halo CME on a back-to-back, fed and never restarted while it is young', () => {
        const { world, go } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2, b2b: true });
        go(0.5);
        const at = world.u.halo.value.x;
        expect(world.u.halo.value.y).toBeGreaterThan(0.9);
        world.onClear({ rows: [19, 18], lines: 2, b2b: true });
        go(0.1);
        expect(world.u.halo.value.x).toBe(at);
        expect(world.u.halo.value.y).toBeGreaterThan(1);
    });

    it('sweeps the shadow back across the sky after a perfect clear\'s diamond, west to east', () => {
        const { world, go } = makeWorld();
        world.onClear({
            rows: [19, 18, 17, 16], lines: 4, perfect: true,
        });
        go(0.5);
        expect(world.u.sweep.value.z).toBe(0);
        let started = false;
        let last = -Infinity;
        for (let i = 0; i < 120; i += 1) {
            go(1 / 30);
            const s = world.u.sweep.value;
            if (s.z > 0) {
                started = true;
                expect(s.x).toBeGreaterThan(last);
                last = s.x;
            }
        }
        expect(started).toBe(true);
        expect(last).toBeGreaterThan(SWEEP.from);
        go(SWEEP.seconds + 1);
        expect(world.u.sweep.value.z).toBe(0);
    });

    it('runs a pulse of light round the horizon on a level-up', () => {
        const { world, go } = makeWorld();
        world.levelUp(2);
        go(0.1);
        expect(world.u.pulse.value.y).toBeGreaterThan(0.5);
        expect(world.u.pulse.value.x).toBeCloseTo(world.time - 0.1, 1);
    });

    it('reaches third contact at a run\'s end, and sweeps totality back in when the next begins', () => {
        const { world, go } = makeWorld();
        world.onLock({ rows: [19, 18], u: 0.4, color: '#ff5f8a' });
        go(1);
        world.onGameOver();
        go(THIRD_CONTACT.open + 0.5);
        expect(world.thirdContact(world.time)).toBeGreaterThan(0.95);
        expect(world.u.daylight.value).toBeGreaterThan(0.5);
        // The moon has slid off further than any diamond takes it.
        expect(Math.hypot(world.u.moon.value.x, world.u.moon.value.y)).toBeGreaterThan(MOON.diamond * 1.2);
        expect(world.prominences.some((p) => p.on)).toBe(false);
        // A second game over while it stands does not restart it.
        const { at } = world.over;
        world.onGameOver();
        expect(world.over.at).toBe(at);
        world.onSessionStart();
        go(0.2);
        expect(world.u.sweep.value.z).toBeGreaterThan(0);
        go(THIRD_CONTACT.close + SWEEP.seconds + 0.5);
        expect(world.thirdContact(world.time)).toBe(0);
        expect(world.u.daylight.value).toBe(0);
        expect(world.u.sweep.value.z).toBe(0);
    });

    it('comes back from third contact by itself if no run starts', () => {
        const { world, go } = makeWorld();
        world.onGameOver();
        go(THIRD_CONTACT.open + THIRD_CONTACT.hold + THIRD_CONTACT.close + SWEEP.seconds + 1, 0.1);
        expect(world.thirdContact(world.time)).toBe(0);
        expect(world.u.daylight.value).toBe(0);
    });

    it('forgets every effect on a seek', () => {
        const { world, go } = makeWorld();
        world.onClear({
            rows: [19, 18, 17, 16], lines: 4, perfect: true, b2b: true,
        });
        world.onGameOver();
        go(1.5);
        world.seek(40);
        go(0.1);
        expect(world.u.bands.value).toBe(0);
        expect(world.u.halo.value.y).toBe(0);
        expect(world.u.sweep.value.z).toBe(0);
        expect(world.thirdContact(world.time)).toBe(0);
        expect(world.u.coronaWave.value.y + world.u.coronaWave.value.w).toBe(0);
    });

    it('keeps the shadow bands still under reduced motion', () => {
        const { world, go } = makeWorld();
        world.setReducedMotion(true);
        world.onClear({ rows: [19, 18], lines: 2 });
        go(0.4);
        expect(world.u.bands.value).toBe(0);
    });
});
