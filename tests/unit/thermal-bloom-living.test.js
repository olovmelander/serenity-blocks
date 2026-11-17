/**
 * Thermal Bloom — the living basin (2026-11): the day that turns beside the year, the springs' own
 * light, and the events that each got a shape of their own. On the CPU: the three-free hours, and
 * a real ThermalBloomWorld in a THREE.Scene with no renderer (node graphs built, never compiled).
 *
 * These pin behaviour (what turns, what answers what, what recovers by itself), never a tuning
 * number: constants are imported and the assertions are relations.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    COLD_HOLD, FAR_ERUPT, GREAT_BOW, REST_RIG, ThermalBloomWorld, farEruption, fovForAspect,
} from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import {
    HOURS, HOUR_NAMES, HOUR_REST, HOUR_STEP, createHourState, hourAt, hourColour, hourIndex, hourWheel,
} from '../../src/themes/thermal-bloom/thermal-bloom-hours.js';
import { FLOWER_LIFE, SEASON_STEP, VAPOUR_ROWS_PER } from '../../src/themes/thermal-bloom/thermal-bloom-core.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';

function makeWorld(quality = 'Minimal', { width = 1600, height = 900, at = 10 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new ThermalBloomWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { scene, camera, world };
}

function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 10, during = null) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) frame(world, camera, dt, during);
}

const luma = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
const clear = (world, extra = {}) => world.onClear({
    player: 0, lines: 1, rows: [19], combo: 0, cascade: 1, twist: false, perfect: false, b2b: false, ...extra,
});
/** The perfect clear as the director hands it: a crown on its own frame, with no rows. */
const perfect = (world) => world.onClear({
    player: 0, lines: 1, rows: [], perfect: true,
});

describe('Thermal Bloom hours (three-free)', () => {
    it('names five hours, Morning first, and Morning leaves the season as it was built', () => {
        expect(HOUR_NAMES).toEqual(['Morning', 'Golden Hour', 'Dusk', 'Night', 'Dawn']);
        const morning = hourAt(0);
        ['sun', 'zenith', 'haze', 'pearl'].forEach((key) => {
            expect(hourColour(morning[key], [0.3, 0.5, 0.7])).toEqual([0.3, 0.5, 0.7]);
        });
        expect(morning.land).toEqual([1, 1, 1]);
        expect(morning.glow).toBe(0);
        expect(morning.stars).toBe(0);
        expect(morning.exposure).toBe(1);
        expect(morning.shadow).toBe(1);
    });

    it('gives every hour the same shape, finite and in range', () => {
        HOURS.forEach((hour) => {
            ['sun', 'zenith', 'haze', 'pearl'].forEach((key) => {
                expect(hour[key]).toHaveLength(2);
                hour[key].flat().forEach((v) => {
                    expect(Number.isFinite(v)).toBe(true);
                    expect(v).toBeGreaterThanOrEqual(0);
                });
            });
            ['land', 'twilight', 'alpen', 'gradeShadow', 'gradeLight'].forEach((key) => {
                expect(hour[key]).toHaveLength(3);
                hour[key].forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
            });
            ['glow', 'stars', 'earthShadow', 'shadow'].forEach((key) => {
                expect(hour[key]).toBeGreaterThanOrEqual(0);
                expect(hour[key]).toBeLessThanOrEqual(1);
            });
            expect(hour.exposure).toBeGreaterThanOrEqual(1);
            expect(hour.steam).toBeGreaterThan(0.5);
        });
    });

    it('lets the heat show as the light falls: the darker the hour, the more the springs glow', () => {
        const light = (h) => h.land[0] + h.land[1] + h.land[2];
        const byLight = [...HOURS].sort((a, b) => light(b) - light(a));
        for (let i = 1; i < byLight.length; i++) {
            expect(byLight[i].glow).toBeGreaterThanOrEqual(byLight[i - 1].glow);
        }
        const night = HOURS[HOUR_NAMES.indexOf('Night')];
        expect(night.stars).toBe(1);
        // Moonlight: no share of the season's sun, a cool light of its own.
        expect(night.sun[0]).toEqual([0, 0, 0]);
        expect(night.sun[1][2]).toBeGreaterThan(night.sun[1][0]);
    });

    it('turns on the clock, resting at each end of an hour and never stepping', () => {
        expect(hourWheel(0)).toBe(0);
        expect(hourWheel(HOUR_STEP * HOUR_REST * 0.99)).toBe(0);
        expect(hourWheel(HOUR_STEP * (1 - HOUR_REST * 0.5))).toBe(1);
        expect(hourWheel(HOUR_STEP * 3)).toBe(3);
        let prev = 0;
        for (let t = 0; t <= HOUR_STEP * HOURS.length * 2; t += 0.25) {
            const w = hourWheel(t);
            expect(w).toBeGreaterThanOrEqual(prev);
            expect(w - prev).toBeLessThan(0.02);
            prev = w;
        }
        // A day is not a year: the two wheels drift against each other.
        expect((HOUR_STEP * HOURS.length) % (SEASON_STEP * 6)).not.toBe(0);
    });

    it('blends between hours and wraps the day', () => {
        const half = hourAt(2.5);
        const dusk = HOURS[2];
        const night = HOURS[3];
        expect(half.glow).toBeCloseTo((dusk.glow + night.glow) / 2, 9);
        expect(half.sun[1][2]).toBeCloseTo((dusk.sun[1][2] + night.sun[1][2]) / 2, 9);
        expect(half.name).toBe('Night');
        const wrapped = hourAt(HOURS.length + 1);
        expect(wrapped.name).toBe('Golden Hour');
        expect(wrapped.glow).toBe(HOURS[1].glow);
        // A reused state allocates nothing new.
        const state = createHourState();
        expect(hourAt(4.2, state)).toBe(state);
    });

    it('reads an hour by number or by name', () => {
        expect(hourIndex('3')).toBe(3);
        expect(hourIndex('2.5')).toBe(2.5);
        expect(hourIndex('night')).toBe(3);
        expect(hourIndex('Golden Hour')).toBe(1);
        expect(hourIndex('golden-hour')).toBe(1);
        expect(hourIndex('')).toBe(null);
        expect(hourIndex(null)).toBe(null);
        expect(hourIndex('teatime')).toBe(null);
    });
});

describe('Thermal Bloom world: the day beside the year', () => {
    it('opens in the morning with no glow, no stars and the full shadows', () => {
        const { world } = makeWorld();
        const s = world.getState();
        expect(s.hour).toBe('Morning');
        expect(world.u.glow.value).toBe(0);
        expect(world.u.stars.value).toBe(0);
        expect(world.u.shadowHold.value).toBe(1);
        expect(world.getPostState().exposure).toBe(1);
        world.dispose();
    });

    it('turns the light with the clock alone: a level steps the year, never the day', () => {
        const { world, camera } = makeWorld('Minimal', { at: HOUR_STEP * 3.1 });
        expect(world.getState().hour).toBe('Night');
        const before = world.getState().hourWheel;
        frame(world, camera, 0.1, () => world.levelUp(2));
        frame(world, camera, 0.1, () => world.levelUp(3));
        expect(world.getState().hourWheel - before).toBeLessThan(0.01);
        expect(world.getState().seasonOffset).toBe(2);
        world.dispose();
    });

    it('holds an hour for a capture, and by night the springs light the basin', () => {
        const { world, camera } = makeWorld();
        const daySun = luma(world.u.sunColor.value);
        const dayZenith = luma(world.u.zenith.value);
        world.hold('hour', 3);
        run(world, camera, 1);
        expect(world.getState().hour).toBe('Night');
        expect(luma(world.u.sunColor.value)).toBeLessThan(daySun * 0.25);
        expect(luma(world.u.zenith.value)).toBeLessThan(dayZenith * 0.25);
        // Moonlight is cool; the sun was warm.
        expect(world.u.sunColor.value.z).toBeGreaterThan(world.u.sunColor.value.x);
        expect(world.u.stars.value).toBe(1);
        expect(world.u.glow.value).toBeGreaterThan(0.5);
        expect(world.getPostState().exposure).toBeGreaterThan(1.2);
        // The far rim, painted unlit, takes the hour's light too.
        expect(luma(world.u.land.value)).toBeLessThan(0.2);
        world.hold('hour', null);
        run(world, camera, 1);
        expect(world.getState().hour).toBe('Morning');
        world.dispose();
    });

    it('casts no shadows from a sun under the horizon, and blushes what stands tall', () => {
        const { world, camera } = makeWorld();
        world.hold('hour', 2);
        run(world, camera, 0.5);
        expect(world.u.shadowHold.value).toBeLessThan(0.6);
        expect(luma(world.u.alpen.value)).toBeGreaterThan(0.1);
        expect(luma(world.u.twilight.value)).toBeGreaterThan(0.05);
        expect(world.u.earthShadow.value).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('Thermal Bloom world: the springs\' own light', () => {
    it('raises the glow with the chain by day and lets it settle after the break', () => {
        const { world, camera } = makeWorld();
        expect(world.u.glow.value).toBe(0);
        let link = 1;
        run(world, camera, 5, 1 / 10, () => {
            if (link < 10) {
                link += 1;
                world.onCombo(link);
            }
        });
        const lit = world.u.glow.value;
        expect(lit).toBeGreaterThan(0.6);
        frame(world, camera, 0.1, () => world.onCombo(0));
        run(world, camera, 12);
        expect(world.u.glow.value).toBeLessThan(lit * 0.2);
        world.dispose();
    });

    it('goes cold at a game over, and warms again by itself while the Chalice stays drained', () => {
        const { world, camera } = makeWorld();
        world.hold('hour', 3);
        run(world, camera, 1);
        const night = world.u.glow.value;
        frame(world, camera, 0.1, () => world.onGameOver());
        run(world, camera, 4);
        expect(world.cold).toBeGreaterThan(0.8);
        expect(world.u.cold.value).toBe(world.cold);
        expect(world.u.glow.value).toBeLessThan(night * 0.35);
        // The menu behind a finished run is never left dead: the springs warm by themselves.
        run(world, camera, COLD_HOLD + 12);
        expect(world.cold).toBeLessThan(0.1);
        expect(world.u.glow.value).toBeGreaterThan(night * 0.85);
        expect(world.getState().drained).toBe(true);
        // A second game over, then a new run: warm at once.
        frame(world, camera, 0.1, () => world.onGameOver());
        run(world, camera, 3);
        expect(world.cold).toBeGreaterThan(0.8);
        frame(world, camera, 0.1, () => world.onSessionStart());
        run(world, camera, 6);
        expect(world.cold).toBeLessThan(0.2);
        expect(world.getState().drained).toBe(false);
        world.dispose();
    });
});

describe('Thermal Bloom world: events with their own shapes', () => {
    it('opens the Iris\'s flower at a back-to-back clear, and builds one flower from quick ones', () => {
        const { world, camera } = makeWorld();
        const rest = world.u.flowerAt.value;
        expect(world.u.time.value - rest).toBeGreaterThan(FLOWER_LIFE);
        frame(world, camera, 0.1, () => clear(world, { lines: 2 }));
        expect(world.getState().counts.flowers).toBe(0);
        frame(world, camera, 0.1, () => {
            world.onB2B(1);
            clear(world, { lines: 4, rows: [19, 18, 17, 16], b2b: true });
        });
        expect(world.getState().counts.flowers).toBe(1);
        expect(world.u.time.value - world.u.flowerAt.value).toBeLessThan(0.2);
        expect(world.u.flowerLevel.value).toBe(1);
        // Another, a moment later and deeper into the chain: the same flower, more petals.
        frame(world, camera, 0.3, () => {
            world.onB2B(3);
            clear(world, { lines: 4, rows: [19, 18, 17, 16], b2b: true });
        });
        expect(world.getState().counts.flowers).toBe(1);
        expect(world.u.flowerLevel.value).toBe(3);
        const turn = world.u.flowerTurn.value;
        // Once it has opened, the next is a new flower, turned so it never repeats the last.
        run(world, camera, 2);
        frame(world, camera, 0.1, () => clear(world, { lines: 4, rows: [19, 18, 17, 16], b2b: true }));
        expect(world.getState().counts.flowers).toBe(2);
        expect(world.u.flowerTurn.value).not.toBe(turn);
        world.dispose();
    });

    it('answers a perfect clear with the whole basin: every petal, the Consort, the great bow', () => {
        const { world, camera } = makeWorld();
        const { aura } = world.parts.fx;
        expect(aura.mesh.visible).toBe(false);
        expect(world.greatBowAt(world.time).amount).toBe(0);
        frame(world, camera, 0.1, () => perfect(world));
        expect(world.getState().counts.perfects).toBe(1);
        expect(world.u.flowerLevel.value).toBe(4);
        expect(world.consortCol.at).toBe(world.time);
        // The bow stands in the fall-back, not at the launch.
        expect(aura.bow()).toBeLessThan(0.05);
        run(world, camera, GREAT_BOW.perfect.full + 0.5);
        expect(aura.mesh.visible).toBe(true);
        expect(aura.bow()).toBeGreaterThan(0.95);
        const whole = world.greatBowAt(world.time);
        expect(whole.second).toBeGreaterThan(0);
        expect(world.u.glow.value).toBeGreaterThan(1);
        run(world, camera, GREAT_BOW.perfect.gone + 1);
        expect(aura.bow()).toBe(0);
        expect(aura.mesh.visible).toBe(false);
        world.dispose();
    });

    it('stands a paler single bow while four lines rain, and none for smaller clears', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => clear(world, { lines: 3, rows: [19, 18, 17] }));
        run(world, camera, 3);
        expect(world.greatBowAt(world.time).amount).toBe(0);
        frame(world, camera, 0.1, () => clear(world, { lines: 4, rows: [19, 18, 17, 16] }));
        run(world, camera, GREAT_BOW.quad.full + 0.4);
        const bow = world.greatBowAt(world.time);
        expect(bow.amount).toBeGreaterThan(0.2);
        expect(bow.amount).toBeLessThanOrEqual(GREAT_BOW.quad.share);
        expect(bow.second).toBe(0);
        run(world, camera, GREAT_BOW.quad.gone);
        expect(world.greatBowAt(world.time).amount).toBe(0);
        world.dispose();
    });

    it('never piles a bank of steam under quick locks: an older boil-over yields to newer ones beside it', () => {
        const total = (world) => {
            const rows = world.u.tables.vapour;
            let sum = 0;
            for (let i = 0; i < world.u.vapourCount.value; i++) sum += rows[i * VAPOUR_ROWS_PER + 1].z;
            return sum;
        };
        const lock = (world) => world.onLock({
            player: 0, rows: [12, 11], u: 0.8, hardDrop: true, distance: 12, color: '#FF9A3C',
        });
        const one = makeWorld();
        const base = total(one.world);
        frame(one.world, one.camera, 0.1, () => lock(one.world));
        run(one.world, one.camera, 1.2);
        const single = total(one.world) - base;
        expect(single).toBeGreaterThan(0);
        const many = makeWorld();
        for (let i = 0; i < 5; i++) {
            frame(many.world, many.camera, 0.1, () => lock(many.world));
            run(many.world, many.camera, 0.5);
        }
        run(many.world, many.camera, 0.6);
        // Five in a row breathe less than three alone would.
        expect(total(many.world) - base).toBeLessThan(single * 3);
        one.world.dispose();
        many.world.dispose();
    });
});

describe('Thermal Bloom far eruptions (closed form)', () => {
    it('stays at rest through a session\'s opening, then each column erupts on its own clock', () => {
        for (let i = 0; i < 12; i++) {
            for (let t = 0; t < FAR_ERUPT.quiet; t += 0.5) expect(farEruption(i, t)).toBe(0);
        }
        const starts = [];
        for (let i = 0; i < 8; i++) {
            let first = -1;
            let peak = 0;
            let prev = 0;
            for (let t = 0; t < FAR_ERUPT.period[1] * 3; t += 0.1) {
                const k = farEruption(i, t);
                expect(k).toBeGreaterThanOrEqual(0);
                expect(k).toBeLessThanOrEqual(1);
                // Eased in and out: never a jump.
                expect(Math.abs(k - prev)).toBeLessThan(0.12);
                if (first < 0 && k > 0.5) first = t;
                peak = Math.max(peak, k);
                prev = k;
            }
            expect(peak).toBeGreaterThan(0.95);
            starts.push(Math.round(first));
        }
        // Their own clocks: they do not all go together.
        expect(new Set(starts).size).toBeGreaterThan(5);
    });

    it('is the same at the same time (seek-safe)', () => {
        expect(farEruption(3, 412.5)).toBe(farEruption(3, 412.5));
        expect(farEruption(0, Number.NaN)).toBe(0);
    });
});
