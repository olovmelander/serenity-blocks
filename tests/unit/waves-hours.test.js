/**
 * Waves — the hours: the wheel of light a new level steps and the clock turns by itself.
 *
 * The table and the wheel's arithmetic are plain numbers (waves-hours.js). The world is built
 * for real, without a renderer: where the light stands is a function of its clock and its level,
 * and what it hands the shaders are the rows of one uniform array the tests read back.
 *
 * The colours and the pace are tuned by eye and keep moving: the tests assert the order of
 * things (a level is one hour, the clock adds to it, a held hour stays held) and read every
 * number they need from the modules.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HOURS, HOUR_COLOURS, HOUR_REST, HOUR_SCALARS, HOUR_SECONDS, SET_SECONDS, hourAt, hourMix, levelPlace, restPlace,
    tideSetAge,
} from '../../src/themes/waves/waves-hours.js';
import { REST_RIG, WavesWorld, fovForAspect } from '../../src/themes/waves/waves-world.js';
import { fallbackLayout } from '../../src/themes/waves/waves-composition.js';
import { SUN, sunDirection } from '../../src/themes/waves/waves-tsl.js';

vi.setConfig({ testTimeout: 30_000 }); // the world tests build a wave each, on a machine that may be busy

const DT = 1 / 60;
const N = HOURS.length;
const NAMES = HOURS.map((hour) => hour.name);
const worlds = [];

function frame(world, camera, delta = 0) {
    const sim = { time: world.time + delta, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function makeWorld({ at = 0, ...options } = {}) {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new WavesWorld({
        scene, quality: 'Minimal', capture: true, ...options,
    }).build();
    world.setViewport(1600, 900, aspect);
    world.setLayout(fallbackLayout(1600, 900), aspect);
    world.bindCamera(camera);
    world.seek(at);
    frame(world, camera);
    worlds.push(world);
    return { camera, world };
}

/** Advance the world by `seconds`, `dt` at a time; `each()` runs after every frame. */
function run(world, camera, seconds, dt = DT, each = null) {
    const steps = Math.round(seconds / dt);
    for (let i = 1; i <= steps; i++) {
        frame(world, camera, dt);
        each?.(i);
    }
}

/** A colour of the hour as the shaders are handed it. */
const row = (world, key) => world.lightRows[HOUR_COLOURS.indexOf(key)].toArray().slice(0, 3);
const saturation = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);

afterEach(() => {
    for (const world of worlds.splice(0)) world.dispose();
});

describe('waves hours: the table', () => {
    it('has the hours of a day in order, each with every colour and every number', () => {
        expect(NAMES).toEqual(['golden', 'sunset', 'afterglow', 'moon', 'dawn', 'day']);
        expect(new Set(HOUR_COLOURS).size).toBe(HOUR_COLOURS.length);
        for (const hour of HOURS) {
            for (const key of HOUR_COLOURS) {
                expect(hour[key], `${hour.name}.${key}`).toHaveLength(3);
                for (const channel of hour[key]) {
                    expect(Number.isFinite(channel) && channel >= 0, `${hour.name}.${key}`).toBe(true);
                }
            }
            for (const key of HOUR_SCALARS) expect(Number.isFinite(hour[key]), `${hour.name}.${key}`).toBe(true);
            expect(hour.stars).toBeGreaterThanOrEqual(0);
            expect(hour.stars).toBeLessThanOrEqual(1);
            expect(hour.exposure).toBeGreaterThan(0.7);
            expect(hour.exposure).toBeLessThan(1.4);
            // Water always takes more red than green or blue: it is water at every hour.
            expect(hour.absorb[0]).toBeGreaterThan(Math.max(hour.absorb[1], hour.absorb[2]));
        }
        expect(Object.isFrozen(HOURS)).toBe(true);
        expect(Object.isFrozen(HOURS[0])).toBe(true);
        expect(Object.isFrozen(HOURS[0].horizonSun)).toBe(true);
    });

    it('keeps golden hour as the picture the theme was built to: every tint is 1', () => {
        const [golden] = HOURS;
        for (const key of ['sunTint', 'fireTint', 'skyTint', 'waterTint']) expect(golden[key], key).toEqual([1, 1, 1]);
        expect(golden.elevation).toBe(SUN.elevation);
        expect(golden.stars).toBe(0);
        expect(golden.exposure).toBe(1);
    });

    it('has a dark hour with the stars out and a moon lower in light than any sun', () => {
        const moon = HOURS[NAMES.indexOf('moon')];
        expect(moon.stars).toBe(1);
        for (const hour of HOURS) {
            if (hour === moon) continue;
            expect(Math.max(...moon.disc), hour.name).toBeLessThan(Math.max(...hour.disc));
            expect(Math.max(...moon.zenithFar), hour.name).toBeLessThan(Math.max(...hour.zenithFar));
        }
    });

    it('never mixes two neighbours through grey: half-way between them the sky and the water keep a colour', () => {
        for (let i = 0; i < N; i++) {
            const mid = hourAt(i + 0.5);
            const between = `${NAMES[i]} and ${NAMES[(i + 1) % N]}`;
            expect(mid.mix).toBeCloseTo(0.5, 12);
            for (const key of ['horizonSun', 'zenithSun', 'scatter', 'absorb']) {
                expect(saturation(mid[key]), `${key} between ${between}`).toBeGreaterThan(0.15);
            }
        }
    });
});

describe('waves hours: the wheel', () => {
    it('rests on an hour at each end of it and crosses to the next in between', () => {
        for (let i = 0; i < N; i++) {
            expect(hourMix(i)).toEqual({ from: i, to: (i + 1) % N, mix: 0 });
            expect(hourMix(i + HOUR_REST * 0.99).mix).toBe(0);
            expect(hourMix(i + 1 - HOUR_REST * 0.99).mix).toBe(1);
            expect(hourMix(i + 0.5).mix).toBeCloseTo(0.5, 12);
            let last = 0;
            for (let f = 0; f < 1; f += 0.01) {
                const { from, mix } = hourMix(i + f);
                expect(from).toBe(i);
                expect(mix).toBeGreaterThanOrEqual(last);
                last = mix;
            }
        }
        expect(HOUR_REST).toBeGreaterThan(0);
        expect(HOUR_REST).toBeLessThan(0.5);
    });

    it('is a wheel: it comes round, both ways, and takes anything for a place', () => {
        expect(hourMix(N)).toEqual(hourMix(0));
        expect(hourMix(N * 3 + 1.5)).toEqual(hourMix(1.5));
        expect(hourMix(-1)).toMatchObject({ from: N - 1, to: 0 });
        expect(hourMix(-0.5)).toEqual(hourMix(N - 0.5));
        for (const odd of [NaN, Infinity, undefined, null, 'x']) expect(hourMix(odd)).toEqual(hourMix(0));
    });

    it('gives an hour exactly at its own place, and names the one the light is nearer to', () => {
        for (let i = 0; i < N; i++) {
            const light = hourAt(i);
            for (const key of HOUR_COLOURS) expect(light[key], `${NAMES[i]}.${key}`).toEqual([...HOURS[i][key]]);
            for (const key of HOUR_SCALARS) expect(light[key], `${NAMES[i]}.${key}`).toBe(HOURS[i][key]);
            expect(light).toMatchObject({ name: NAMES[i], next: NAMES[(i + 1) % N], mix: 0 });
            expect(hourAt(i + 0.49).name).toBe(NAMES[i]);
            expect(hourAt(i + 0.51)).toMatchObject({ name: NAMES[(i + 1) % N], next: NAMES[i] });
        }
    });

    it('mixes two neighbours channel by channel, and nothing else', () => {
        for (let i = 0; i < N; i++) {
            const a = HOURS[i];
            const b = HOURS[(i + 1) % N];
            const mid = hourAt(i + 0.5);
            for (const key of HOUR_COLOURS) {
                for (let c = 0; c < 3; c++) expect(mid[key][c], key).toBeCloseTo((a[key][c] + b[key][c]) / 2, 12);
            }
            for (const key of HOUR_SCALARS) expect(mid[key], key).toBeCloseTo((a[key] + b[key]) / 2, 12);
        }
    });

    it('turns without a jump anywhere on the wheel, the seam between day and golden hour included', () => {
        const step = 0.002;
        let before = hourAt(-step);
        let widest = 0;
        for (let place = 0; place <= N + step; place += step) {
            const now = hourAt(place);
            for (const key of HOUR_COLOURS) {
                for (let c = 0; c < 3; c++) widest = Math.max(widest, Math.abs(now[key][c] - before[key][c]));
            }
            before = now;
        }
        // The fastest any channel moves in a five-hundredth of an hour.
        expect(widest).toBeLessThan(0.02);
    });

    it('writes into the object it is given, and keeps its arrays', () => {
        const out = {};
        expect(hourAt(0, out)).toBe(out);
        const kept = out.horizonSun;
        hourAt(3, out);
        expect(out.horizonSun).toBe(kept);
        expect(out.horizonSun).toEqual([...HOURS[3].horizonSun]);
        // A table row is never handed out to be written to.
        expect(out.horizonSun).not.toBe(HOURS[3].horizonSun);
    });

    it('eases a level\'s turn over the set wave\'s passage, then stays put', () => {
        expect(levelPlace(2, 3, 0)).toBe(2);
        expect(levelPlace(2, 3, -5)).toBe(2);
        expect(levelPlace(2, 3, NaN)).toBe(2);
        expect(levelPlace(2, 3, SET_SECONDS)).toBe(3);
        expect(levelPlace(2, 3, 1000)).toBe(3);
        expect(levelPlace(2, 3, SET_SECONDS / 2)).toBeCloseTo(2.5, 12);
        let last = 2;
        for (let since = 0; since <= SET_SECONDS; since += 0.05) {
            const place = levelPlace(2, 3, since);
            expect(place).toBeGreaterThanOrEqual(last);
            last = place;
        }
        // Back as well as on.
        expect(levelPlace(-2, 0, SET_SECONDS / 2)).toBeCloseTo(-1, 12);
    });

    it('takes a new run back to golden hour the short way round', () => {
        expect(restPlace(0)).toBe(0);
        expect(restPlace(2)).toBe(2); // back down two hours
        expect(restPlace(4)).toBe(-2); // on two hours, round the wheel
        for (const place of [0.4, 1, 2.9, 3.2, 5.9, 6, 7.3, 13, 40.5, -2, -9.5]) {
            const rest = restPlace(place);
            expect(Math.abs(rest), `${place}`).toBeLessThanOrEqual(N / 2);
            // The same light: only whole turns of the wheel were taken off.
            expect((place - rest) / N, `${place}`).toBeCloseTo(Math.round((place - rest) / N), 9);
            expect(hourMix(rest).from).toBe(hourMix(place).from);
        }
    });

    it('sends the clock\'s own set wave half-way through every hour, and none before the first', () => {
        const half = HOUR_SECONDS / 2;
        expect(tideSetAge(0)).toBe(-1);
        expect(tideSetAge(half - 0.01)).toBe(-1);
        expect(tideSetAge(half)).toBe(0);
        expect(tideSetAge(half + 1)).toBeCloseTo(1, 9);
        expect(tideSetAge(half + SET_SECONDS + 0.01)).toBe(-1);
        expect(tideSetAge(HOUR_SECONDS)).toBe(-1);
        expect(tideSetAge(HOUR_SECONDS + half + 0.5)).toBeCloseTo(0.5, 9);
        expect(tideSetAge(HOUR_SECONDS * 7 + half + 2)).toBeCloseTo(2, 6);
        for (const odd of [NaN, -10, undefined]) expect(tideSetAge(odd)).toBe(-1);
        // A set wave is short beside the hour it marks.
        expect(SET_SECONDS).toBeLessThan(HOUR_SECONDS / 10);
    });
});

describe('waves hours: the world', () => {
    it('starts at golden hour: its colours in the rows the shaders read, the sun where it was built, no stars', () => {
        const { world } = makeWorld();
        expect(world.getState()).toMatchObject({
            level: 1,
            hour: 'golden',
            hourNext: 'sunset',
            hourMix: 0,
            hourPlace: 0,
            hours: N,
            sunElevation: SUN.elevation,
        });
        expect(world.lightRows).toHaveLength(HOUR_COLOURS.length);
        for (const key of HOUR_COLOURS) expect(row(world, key), key).toEqual([...HOURS[0][key]]);
        expect(world.U.stars.value).toBe(0);
        expect(world.sunDir.toArray()).toEqual(sunDirection().toArray());
        // Every colour a shader asks for is there to be asked for.
        for (const key of HOUR_COLOURS) expect(world.U.light[key], key).toBeTruthy();
    });

    it('turns by the clock alone, through every hour and round again, on a board that never levels', () => {
        const { camera, world } = makeWorld();
        for (let k = 0; k <= N + 1; k++) {
            world.seek(k * HOUR_SECONDS);
            frame(world, camera);
            const state = world.getState();
            expect(state.level).toBe(1);
            expect(state.hour, `after ${k} hours`).toBe(NAMES[k % N]);
            expect(state.hourMix).toBe(0);
            expect(state.hourPlace).toBeCloseTo(k, 9);
            for (const key of HOUR_COLOURS) expect(row(world, key), key).toEqual([...HOURS[k % N][key]]);
            // Well into it, the light stands between that hour and the next.
            world.seek((k + 0.4) * HOUR_SECONDS);
            frame(world, camera);
            expect(world.getState()).toMatchObject({ hour: NAMES[k % N], hourNext: NAMES[(k + 1) % N] });
            expect(world.getState().hourMix).toBeGreaterThan(0);
            expect(world.getState().hourMix).toBeLessThan(0.5);
        }
    });

    it('runs the hour on, frame by frame, while nothing at all happens on the board', () => {
        const { camera, world } = makeWorld({ at: HOUR_SECONDS * 0.4 });
        const before = world.getState();
        const horizon = row(world, 'horizonSun');
        const mixes = [];
        run(world, camera, 20, DT, () => mixes.push(world.getState().hourMix));
        const after = world.getState();
        expect(after.hourPlace - before.hourPlace).toBeCloseTo(20 / HOUR_SECONDS, 6);
        expect(after.hourMix).toBeGreaterThan(before.hourMix);
        for (let i = 1; i < mixes.length; i++) expect(mixes[i]).toBeGreaterThanOrEqual(mixes[i - 1]);
        expect(row(world, 'horizonSun')).not.toEqual(horizon);
        expect(after.level).toBe(1);
    });

    it('turns one whole hour for a new level, eased while its set wave runs through the tube', () => {
        const { camera, world } = makeWorld({ at: 10 });
        const before = world.hourPlace();
        world.levelUp(2);
        // Not at a stroke: the light is where it was on the frame the level arrives.
        expect(world.hourPlace()).toBeCloseTo(before, 9);
        const places = [];
        let sawSet = false;
        run(world, camera, SET_SECONDS + 0.2, DT, () => {
            places.push(world.hourPlace());
            sawSet = sawSet || world.getState().setWave;
        });
        for (let i = 1; i < places.length; i++) expect(places[i]).toBeGreaterThan(places[i - 1]);
        expect(sawSet).toBe(true);
        expect(world.levelPlace()).toBe(1);
        expect(world.hourPlace()).toBeCloseTo(before + 1 + (SET_SECONDS + 0.2) / HOUR_SECONDS, 6);
        expect(world.getState()).toMatchObject({ level: 2, hour: 'sunset' });
        // And the next level is the next hour.
        world.levelUp(3);
        run(world, camera, SET_SECONDS + 0.2);
        expect(world.getState()).toMatchObject({ level: 3, hour: 'afterglow' });
    });

    it('turns the same way whatever the frame rate: the place is a function of the clock', () => {
        const places = [1 / 60, 1 / 20].map((dt) => {
            const { camera, world } = makeWorld({ at: 10 });
            world.levelUp(2);
            run(world, camera, 2, dt);
            return world.hourPlace();
        });
        expect(places[1]).toBeCloseTo(places[0], 9);
        expect(places[0]).toBeGreaterThan(0.2);
        expect(places[0]).toBeLessThan(1.2);
    });

    it('carries on from where the light is when a level arrives in the middle of a turn', () => {
        const { camera, world } = makeWorld({ at: 10 });
        world.levelUp(2);
        run(world, camera, SET_SECONDS / 2);
        const mid = world.levelPlace();
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
        world.levelUp(3);
        expect(world.levelPlace()).toBeCloseTo(mid, 9);
        run(world, camera, SET_SECONDS + 0.1);
        expect(world.levelPlace()).toBe(2);
    });

    it('is simply at its level when told so silently: no turn, no set wave', () => {
        const { camera, world } = makeWorld({ at: 10 });
        world.levelUp(4, { silent: true });
        expect(world.levelPlace()).toBe(3);
        expect(world.getState()).toMatchObject({ level: 4, hour: 'moon', hourMix: 0 });
        expect(world.U.stars.value).toBe(1);
        for (const key of HOUR_COLOURS) expect(row(world, key), key).toEqual([...HOURS[3][key]]);
        frame(world, camera, DT);
        expect(world.U.bulge.value.y).toBe(0);
    });

    it('adds the level to what the clock has turned', () => {
        const { camera, world } = makeWorld({ at: HOUR_SECONDS * 2 });
        expect(world.getState().hour).toBe('afterglow');
        world.levelUp(3, { silent: true });
        frame(world, camera);
        expect(world.hourPlace()).toBeCloseTo(4, 9);
        expect(world.getState().hour).toBe('dawn');
    });

    it('turns back to the clock\'s own hour for a new run, the short way round, and never jumps', () => {
        const { camera, world } = makeWorld({ at: 10 });
        world.levelUp(5, { silent: true });
        frame(world, camera);
        const before = world.getState();
        expect(before.hour).toBe('dawn');
        world.resetSession();
        frame(world, camera);
        // The same light on the frame it happens: only whole turns of the wheel were taken off.
        expect(world.hour).toMatchObject({ from: -2, to: 0 });
        expect(world.getState()).toMatchObject({ level: 1, hour: 'dawn', hourMix: before.hourMix });
        run(world, camera, SET_SECONDS + 0.1);
        expect(world.levelPlace()).toBe(0);
        expect(world.getState().hour).toBe('golden');
        // From two hours on, it goes back down them.
        world.levelUp(3, { silent: true });
        world.resetSession();
        expect(world.hour).toMatchObject({ from: 2, to: 0 });
    });

    it('is put at the clock\'s hour by a seek: no level, no turn under way', () => {
        const { camera, world } = makeWorld({ at: 10 });
        world.levelUp(4);
        run(world, camera, 1);
        world.seek(HOUR_SECONDS * 1.4);
        expect(world.levelPlace()).toBe(0);
        expect(world.hourPlace()).toBeCloseTo(1.4, 9);
        expect(world.getState()).toMatchObject({ level: 1, hour: 'sunset', hourNext: 'afterglow' });
    });

    it('holds the light at an hour it is given, whatever the level and the clock say', () => {
        const { camera, world } = makeWorld({ hour: 3.4, at: 10 });
        const held = () => world.getState();
        expect(held()).toMatchObject({ hourPlace: 3.4, hour: 'moon', hourNext: 'dawn' });
        expect(held().hourMix).toBeCloseTo(hourMix(3.4).mix, 12);
        expect(held().hourMix).toBeGreaterThan(0);
        const horizon = row(world, 'horizonSun');
        world.levelUp(5);
        run(world, camera, 6);
        world.seek(HOUR_SECONDS * 4.2);
        frame(world, camera);
        expect(held().hourPlace).toBe(3.4);
        expect(row(world, 'horizonSun')).toEqual(horizon);
        // A held golden hour is place 0, not "no hold".
        const golden = makeWorld({ hour: 0, at: HOUR_SECONDS * 3 }).world;
        expect(golden.getState()).toMatchObject({ hour: 'golden', hourPlace: 0 });
        // Anything that is not a number holds nothing.
        expect(makeWorld({ hour: NaN, at: HOUR_SECONDS }).world.getState().hour).toBe('sunset');
    });

    it('moves the sun with the hour: down into the sea at afterglow, up again as the moon', () => {
        const { camera, world } = makeWorld();
        const heights = [];
        for (let k = 0; k < N; k++) {
            world.seek(k * HOUR_SECONDS);
            frame(world, camera);
            expect(world.sunDir.toArray(), NAMES[k]).toEqual(sunDirection(SUN.azimuth, HOURS[k].elevation).toArray());
            expect(world.U.sun.value.toArray()).toEqual(world.sunDir.toArray());
            expect(world.sunDir.length()).toBeCloseTo(1, 9);
            expect(world.getState().sunElevation).toBe(HOURS[k].elevation);
            heights.push(world.sunDir.y);
        }
        const at = (name) => heights[NAMES.indexOf(name)];
        expect(at('sunset')).toBeLessThan(at('golden'));
        expect(at('afterglow')).toBeLessThan(at('sunset'));
        expect(at('afterglow')).toBeLessThan(0.02); // on the horizon, or just under it
        expect(at('moon')).toBeGreaterThan(at('golden'));
        // The lens is still told where it stands.
        world.seek(NAMES.indexOf('moon') * HOUR_SECONDS);
        frame(world, camera);
        const post = world.getPostState();
        expect(Number.isFinite(post.sunX) && Number.isFinite(post.sunY)).toBe(true);
        expect(world.getState().sun.visible).toBe(1);
    });

    it('leaves a held sun where it was put while the colours turn round it', () => {
        const { camera, world } = makeWorld({ sun: { azimuth: 30, elevation: 20 }, at: HOUR_SECONDS * 3 });
        frame(world, camera);
        expect(world.sunDir.toArray()).toEqual(sunDirection(30, 20).toArray());
        expect(world.U.sun.value.toArray()).toEqual(world.sunDir.toArray());
        expect(world.getState()).toMatchObject({ hour: 'moon', sunElevation: 20 });
        expect(row(world, 'scatter')).toEqual([...HOURS[3].scatter]);
        // Half of a sun is enough to hold it: the other half is the built one.
        const half = makeWorld({ sun: { elevation: 3 }, at: HOUR_SECONDS }).world;
        expect(half.sunDir.toArray()).toEqual(sunDirection(SUN.azimuth, 3).toArray());
    });

    it('brings the stars out as the light goes, and puts them away for the day', () => {
        const { camera, world } = makeWorld();
        const stars = (place) => {
            world.seek(place * HOUR_SECONDS);
            frame(world, camera);
            return world.U.stars.value;
        };
        const moon = NAMES.indexOf('moon');
        expect(stars(NAMES.indexOf('golden'))).toBe(0);
        expect(stars(NAMES.indexOf('day'))).toBe(0);
        expect(stars(moon)).toBe(1);
        const coming = stars(moon - 0.5);
        expect(coming).toBeGreaterThan(stars(moon - 1));
        expect(coming).toBeLessThan(1);
    });

    it('hands the lens the hour\'s exposure and the colour of its shafts', () => {
        const { camera, world } = makeWorld();
        for (let k = 0; k < N; k++) {
            world.seek(k * HOUR_SECONDS);
            frame(world, camera);
            const post = world.getPostState();
            expect(post.exposure).toBe(HOURS[k].exposure);
            expect([...post.shaftTint]).toEqual([...HOURS[k].shaft]);
        }
        world.seek(HOUR_SECONDS * 2.5);
        frame(world, camera);
        const between = world.getPostState();
        expect(between.shaftTint.every((c) => Number.isFinite(c) && c > 0)).toBe(true);
        expect(between.exposure).toBeCloseTo((HOURS[2].exposure + HOURS[3].exposure) / 2, 9);
    });

    it('sends a set wave of its own down the tube half-way through the hour, with no level at all', () => {
        const half = HOUR_SECONDS / 2;
        const { camera, world } = makeWorld({ at: half - 1 });
        const bulge = world.U.bulge.value;
        expect(bulge.y).toBe(0);
        expect(world.getState().setWave).toBe(false);
        const heights = [];
        const places = [];
        let tear = 0;
        run(world, camera, 1 + SET_SECONDS + 0.5, DT, () => {
            heights.push(bulge.y);
            if (bulge.y > 0) places.push(bulge.x);
            tear = Math.max(tear, world.U.tear.value);
        });
        expect(Math.max(...heights)).toBeGreaterThan(0);
        // It comes from ahead and passes behind the eye, and the lip throws as it comes.
        for (let i = 1; i < places.length; i++) expect(places[i]).toBeGreaterThan(places[i - 1]);
        expect(places[0]).toBeLessThan(0);
        expect(places[places.length - 1]).toBeGreaterThan(0);
        expect(tear).toBeGreaterThan(0.1);
        // Then the tube is as it was, and the lip at rest.
        expect(bulge.y).toBe(0);
        expect(world.getState()).toMatchObject({ level: 1, setWave: false });
        run(world, camera, 4);
        expect(world.U.tear.value).toBe(0);
        // A seek into the middle of it finds it in the tube: it is the clock's, not an event's.
        world.seek(HOUR_SECONDS + half + SET_SECONDS / 2);
        frame(world, camera);
        expect(bulge.y).toBeGreaterThan(0);
        expect(world.getState().setWave).toBe(true);
    });

    it('lets a new level\'s set wave have the tube: taller than the clock\'s, and from the start', () => {
        const half = HOUR_SECONDS / 2;
        const tide = makeWorld({ at: half + SET_SECONDS / 2 });
        frame(tide.world, tide.camera);
        const clockHeight = tide.world.U.bulge.value.y;
        const clockPlace = tide.world.U.bulge.value.x;
        expect(clockHeight).toBeGreaterThan(0);
        tide.world.levelUp(2);
        frame(tide.world, tide.camera, DT);
        // The level's wave starts again from far ahead.
        expect(tide.world.U.bulge.value.x).toBeLessThan(clockPlace);
        run(tide.world, tide.camera, SET_SECONDS / 2 - DT);
        expect(tide.world.U.bulge.value.y).toBeGreaterThan(clockHeight);
    });
});
