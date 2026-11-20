/**
 * Painted Ages — the world under the weather: a real PaintedAgesWorld in a scene (no renderer),
 * its air held by a capture override or turned by the clock, and what that writes into the
 * uniforms the materials read.
 *
 * Relations, not tuning: an air raises or lowers a uniform against `fair` at the same hour, a
 * chain closes the sky over whatever air is there, the far shower's shard gives way to an event's
 * bow without a dip, the moon keeps to the dark, and a seek lands where a live run stands.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PaintedAgesWorld, REST_RIG, SPIN_SECONDS, fovForAspect,
} from '../../src/themes/painted-ages/painted-ages-world.js';
import {
    FIELDS, FIELD_ORDER, PIECE_COLORS, TIMING,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { HOUR_COUNT } from '../../src/themes/painted-ages/painted-ages-hours.js';
import {
    AIRS, AIR_HOLD, AIR_NAMES, AIR_SECONDS, airAt, airPlace,
} from '../../src/themes/painted-ages/painted-ages-weather.js';
import { MIST_HEIGHT } from '../../src/themes/painted-ages/painted-ages-light.js';
import { decodeField } from '../../src/themes/painted-ages/painted-ages-field.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

const START = 10;
const FRAME = 1 / 30;
const worlds = [];
let fields;
let prepared;

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
    prepared = PaintedAgesWorld.prepareSync('Low', fields);
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo(world, camera, to, dt = FRAME, each = null) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const s = sim(from + i * h, h);
        world.updateCamera(camera, s);
        world.update(s, camera);
        if (each) each(world);
    }
}

function makeWorld({
    width = 1600, height = 900, start = START, overrides = null, reduced = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PaintedAgesWorld({
        scene, quality: 'Low', capture: true, prepared,
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // The clock's own happenings are another file's: here they would only add a devil or a flicker.
    world.setCaptureOverrides({ happenings: false, ...overrides });
    world.setReducedMotion(reduced);
    world.seek(start);
    world.updateCamera(camera, sim(start, 0));
    world.update(sim(start, 0), camera);
    return { scene, camera, world };
}

const air = (name) => {
    const index = AIR_NAMES.indexOf(name);
    if (index < 0) throw new Error(`no air named ${name}`);
    return index;
};
const read = (node) => (typeof node.value === 'number' ? node.value : node.value.toArray());
/** What the weather writes, as plain numbers. */
function sky(world) {
    const { u } = world;
    return {
        mistDensity: u.mistDensity.value,
        mistHeight: u.mistHeight.value,
        cloudCover: u.cloudCover.value,
        cloudDepth: u.cloudDepth.value,
        towerGrow: u.towerGrow.value,
        hazeDensity: u.hazeDensity.value,
        windSpeed: u.windSpeed.value,
        cirrus: u.cirrus.value,
        haze: u.haze.value.toArray(),
        mist: u.mist.value.toArray(),
        virga: u.virga.value.toArray(),
        bow: u.bow.value.toArray(),
        bowLeg: u.bowLeg.value,
    };
}
/** Hold an hour and an air, draw one still frame, and read the sky. */
function under(world, camera, hour, name) {
    world.setCaptureOverrides({ hour, air: air(name) });
    world.updateCamera(camera, sim(world.time, 0));
    world.update(sim(world.time, 0), camera);
    return sky(world);
}
/** How warm a linear colour leans: red over blue. */
const redOverBlue = (rgb) => rgb[0] / rgb[2];
const luminance = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
const HOURS_OF_DAY = [0, 1, 2, 3, 4];
const BLUE_HOUR = 5;
const ALL_HOURS = [...HOURS_OF_DAY, BLUE_HOUR];

describe('Painted Ages weather in the world: fair is the day the owner knows', () => {
    it('shows fair at t = 0: the hour\'s own air, nothing of the weather\'s added', () => {
        const { world, camera } = makeWorld({ start: 0 });
        expect(world.getState().air).toMatchObject({ name: 'fair', from: 0, mix: 0 });
        const fair = AIRS[0];
        const { u, light } = world;
        expect(u.cloudCover.value).toBe(fair.cover);
        expect(u.cloudDepth.value).toBe(fair.shade);
        expect(u.towerGrow.value).toBe(fair.towers);
        // The hour's haze and mist as the hours wrote them: fair neither thickens nor tints them.
        expect(u.hazeDensity.value).toBe(light.hazeDensity);
        expect(u.mistDensity.value).toBe(light.mistDensity);
        expect(u.mistHeight.value).toBe(MIST_HEIGHT);
        expect(u.haze.value.toArray()).toEqual(light.haze);
        expect(u.mist.value.toArray()).toEqual(light.mist);
        expect(u.windSpeed.value).toBe(1);
        expect(u.virga.value.y).toBe(0);
        expect(u.bow.value.x).toBe(0);
        expect(u.bowLeg.value).toBe(0);
        // ... and it rests there for the air's whole hold.
        const before = sky(world);
        stepTo(world, camera, AIR_HOLD * AIR_SECONDS * 0.98, 0.5);
        expect(world.getState().air).toMatchObject({ name: 'fair', mix: 0 });
        const after = sky(world);
        for (const key of ['cloudCover', 'cloudDepth', 'towerGrow', 'mistHeight', 'windSpeed', 'cirrus']) {
            expect(after[key], key).toBe(before[key]);
        }
    });

    it('turns to the next air by the clock alone, and reports the air it shows', () => {
        const { world, camera } = makeWorld({ start: 0 });
        const seen = [];
        stepTo(world, camera, AIR_SECONDS * AIRS.length, 1, (w) => {
            const { name } = w.getState().air;
            if (seen[seen.length - 1] !== name) seen.push(name);
        });
        expect(seen).toEqual([...AIR_NAMES, AIR_NAMES[0]]);
    });
});

describe('Painted Ages weather in the world: what each air does to the uniforms', () => {
    it.each(ALL_HOURS)('hour %i: mist fills the valley, pools close the deck, towers grow, crystal clears', (hour) => {
        const { world, camera } = makeWorld();
        const fair = under(world, camera, hour, 'fair');
        const mist = under(world, camera, hour, 'mist');
        expect(mist.mistDensity).toBeGreaterThan(fair.mistDensity);
        expect(mist.mistHeight).toBeGreaterThan(fair.mistHeight);
        const pools = under(world, camera, hour, 'pools');
        expect(pools.cloudCover).toBeGreaterThan(fair.cloudCover);
        expect(pools.cloudDepth).toBeGreaterThan(fair.cloudDepth);
        const towers = under(world, camera, hour, 'towers');
        expect(towers.towerGrow).toBeGreaterThan(fair.towerGrow);
        const crystal = under(world, camera, hour, 'crystal');
        expect(crystal.hazeDensity).toBeLessThan(fair.hazeDensity);
        const dust = under(world, camera, hour, 'dust');
        expect(dust.windSpeed).toBeGreaterThan(fair.windSpeed);
        // Whatever the air, the numbers stay where the shaders can take them.
        for (const name of AIR_NAMES) {
            const s = under(world, camera, hour, name);
            expect(s.cloudCover, name).toBeGreaterThan(0);
            expect(s.cloudCover, name).toBeLessThanOrEqual(0.92);
            expect(s.cloudDepth, name).toBeGreaterThan(0);
            expect(s.cloudDepth, name).toBeLessThanOrEqual(1);
            expect(s.towerGrow, name).toBeGreaterThanOrEqual(0);
            expect(s.towerGrow, name).toBeLessThanOrEqual(1);
            expect(s.hazeDensity, name).toBeGreaterThan(0);
            expect(s.mistDensity, name).toBeGreaterThan(0);
            expect(s.mistHeight, name).toBeGreaterThan(0);
            expect(s.windSpeed, name).toBeGreaterThan(0);
        }
    });

    it.each([0, 1, 2, 3])('at hour %i (by day) a wind of dust leans the haze and the valley layer warm', (hour) => {
        const { world, camera } = makeWorld();
        const fair = under(world, camera, hour, 'fair');
        const dust = under(world, camera, hour, 'dust');
        expect(redOverBlue(dust.haze)).toBeGreaterThan(redOverBlue(fair.haze));
        expect(redOverBlue(dust.mist)).toBeGreaterThan(redOverBlue(fair.mist));
    });

    // WAS A FAULT (found by this test, fixed in the living pass): at sunset the hour's own haze (0.74, 0.38, 0.30) is redder than the dust it is leaned
    // toward (1.0, 0.7, 0.46): red over blue falls from fair's 2.47 to 2.34. The dust cools the sunset.
    it('at hour 4 (sunset, the sun still up) a wind of dust leans the haze toward warm', () => {
        const { world, camera } = makeWorld();
        const fair = under(world, camera, 4, 'fair');
        const dust = under(world, camera, 4, 'dust');
        expect(redOverBlue(dust.haze)).toBeGreaterThan(redOverBlue(fair.haze));
    });

    it('does not tint the haze at the blue hour, nor once a game over\'s dusk has fallen', () => {
        const { world, camera } = makeWorld();
        const fair = under(world, camera, BLUE_HOUR, 'fair');
        const dust = under(world, camera, BLUE_HOUR, 'dust');
        expect(dust.haze).toEqual(fair.haze);
        expect(dust.mist).toEqual(fair.mist);
        // Dusk at high day: the tint leaves with the light.
        const dusty = makeWorld({ overrides: { hour: 2, air: air('dust') } });
        const plain = makeWorld({ overrides: { hour: 2, air: air('fair') } });
        expect(redOverBlue(read(dusty.world.u.haze))).toBeGreaterThan(redOverBlue(read(plain.world.u.haze)));
        for (const w of [dusty, plain]) {
            w.world.onGameOver();
            stepTo(w.world, w.camera, w.world.time + TIMING.dusk + 0.5);
        }
        expect(dusty.world.dusk).toBeCloseTo(1, 6);
        read(dusty.world.u.haze).forEach((v, i) => expect(v, `haze[${i}]`).toBeCloseTo(read(plain.world.u.haze)[i], 9));
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (dustTint's own comment: "keeping its brightness"): the tint's target is the dust colour at
    // 1.12 × the luminance, but the dust colour's own luminance is 0.746, so the target is 16 % darker.
    // By day the haze under dust loses 8 % of its luminance and the valley layer 14 %.
    it('keeps the haze\'s and the valley layer\'s brightness while it tints them', () => {
        const { world, camera } = makeWorld();
        for (const hour of [1, 2, 3]) {
            const fair = under(world, camera, hour, 'fair');
            const dust = under(world, camera, hour, 'dust');
            expect(luminance(dust.haze) / luminance(fair.haze), `haze at hour ${hour}`).toBeGreaterThan(0.97);
            expect(luminance(dust.mist) / luminance(fair.mist), `mist at hour ${hour}`).toBeGreaterThan(0.97);
        }
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (weather.js: "sat — added to the grade's saturation"; crystal is "deep colours"): nothing
    // reads an air's `sat`. The post state's saturation is 1.0 + the wet rock + the heat of play in
    // every air: crystal (+0.07) and dust (−0.02) grade exactly as fair does.
    it('adds each air\'s own saturation to the grade: deeper in crystal air, paler in dust', () => {
        const { world, camera } = makeWorld();
        const gradeIn = (name) => {
            under(world, camera, 2, name);
            return world.getPostState().saturation;
        };
        const fair = gradeIn('fair');
        const others = AIRS.filter((a) => a.sat !== AIRS[0].sat);
        expect(others.length).toBeGreaterThan(0);
        for (const a of others) expect(Math.sign(gradeIn(a.name) - fair), a.name).toBe(Math.sign(a.sat - AIRS[0].sat));
    });

    it('drifts the deck faster in a strong wind and slower in a still air, never backward', () => {
        const run = (name) => {
            const { world, camera } = makeWorld({ overrides: { hour: 2, air: air(name) } });
            const from = read(world.u.wind);
            let back = 0;
            let last = from[0];
            stepTo(world, camera, world.time + 10, FRAME, (w) => {
                back = Math.min(back, w.u.wind.value.x - last);
                last = w.u.wind.value.x;
            });
            expect(back, name).toBe(0);
            return world.u.wind.value.x - from[0];
        };
        const fair = run('fair');
        expect(run('dust')).toBeGreaterThan(fair);
        expect(run('pools')).toBeGreaterThan(fair);
        expect(run('mist')).toBeLessThan(fair);
        expect(run('mist')).toBeGreaterThan(0);
    });
});

describe('Painted Ages weather in the world: a chain still closes the sky', () => {
    it.each(AIR_NAMES)('in %s a chain of eight raises the cover above the air\'s own, never past 0.92', (name) => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, air: air(name) } });
        const own = world.u.cloudCover.value;
        for (let n = 1; n <= 8; n += 1) world.onCombo(n);
        let top = 0;
        let fell = 0;
        let last = own;
        stepTo(world, camera, world.time + 8, FRAME, (w) => {
            top = Math.max(top, w.u.cloudCover.value);
            fell = Math.min(fell, w.u.cloudCover.value - last);
            last = w.u.cloudCover.value;
        });
        expect(world.u.cloudCover.value).toBeGreaterThan(own);
        expect(top).toBeLessThanOrEqual(0.92);
        // It closes steadily while the chain holds (no step back on the way in).
        expect(fell).toBeGreaterThanOrEqual(-1e-12);
        // The chain breaks: the sky opens again to the air's own cover.
        world.onCombo(0);
        stepTo(world, camera, world.time + 20);
        expect(world.u.cloudCover.value).toBeCloseTo(own, 2);
    });
});

describe('Painted Ages weather in the world: the far shower and its shard of rainbow', () => {
    const SHOWERS = { air: AIR_NAMES.indexOf('showers') };

    it.each(HOURS_OF_DAY)('by day (hour %i) the showers hang curtains on one side, a shard of bow in them', (hour) => {
        const { world } = makeWorld({ overrides: { hour, ...SHOWERS } });
        const { u } = world;
        expect(u.virga.value.y).toBeGreaterThan(0);
        expect(u.bow.value.x).toBeGreaterThan(0);
        expect(Math.abs(u.bowLeg.value)).toBe(1);
        // The shard stands where the curtains hang, and it is a single bow.
        expect(Math.sign(u.bowLeg.value)).toBe(Math.sign(u.virga.value.x));
        expect(Math.sign(u.virga.value.z)).toBe(Math.sign(u.virga.value.x));
        expect(u.bow.value.y).toBe(0);
    });

    it('shows no shard at the blue hour, in an air without a shower, or under a game over\'s dusk', () => {
        const night = makeWorld({ overrides: { hour: BLUE_HOUR, ...SHOWERS } });
        expect(night.world.u.bow.value.x).toBe(0);
        expect(Math.abs(night.world.u.bowLeg.value)).toBe(0);
        expect(night.world.u.virga.value.y).toBeGreaterThan(0); // the curtains hang on in the dark
        const { world, camera } = makeWorld();
        for (const name of AIR_NAMES) {
            const s = under(world, camera, 2, name);
            if (airAt(air(name)).virga > 0) continue;
            expect(s.bow[0], name).toBe(0);
            expect(Math.abs(s.bowLeg), name).toBe(0);
            expect(s.virga[1], name).toBe(0);
        }
        const day = makeWorld({ overrides: { hour: 2, ...SHOWERS } });
        expect(day.world.u.bow.value.x).toBeGreaterThan(0);
        day.world.onGameOver();
        stepTo(day.world, day.camera, day.world.time + TIMING.dusk + 0.5);
        expect(day.world.u.bow.value.x).toBeLessThan(1e-6);
    });

    /** The showers' first visit by the clock: every frame from the melt in to the melt out. */
    function firstVisit() {
        const { world, camera } = makeWorld({ start: (SHOWERS.air - 1) * AIR_SECONDS });
        const rows = [];
        stepTo(world, camera, (SHOWERS.air + 1) * AIR_SECONDS, FRAME, (w) => {
            const [bearing, amount, slant] = w.u.virga.value.toArray();
            rows.push({
                t: w.time, bearing, amount, slant, bow: w.u.bow.value.x, leg: w.u.bowLeg.value, day: w.u.sunUp.value,
            });
        });
        return rows;
    }

    it('by the clock the curtains come and go without a step, on one side, the shard with them', () => {
        const rows = firstVisit();
        expect(rows[0].amount).toBeLessThan(0.01);
        expect(rows[rows.length - 1].amount).toBeLessThan(0.01);
        expect(Math.max(...rows.map((row) => row.amount))).toBe(1);
        const side = Math.sign(rows[Math.floor(rows.length / 2)].bearing);
        rows.forEach((row, i) => {
            if (!i) return;
            const last = rows[i - 1];
            // The amount and the shard's strength never step: a frame moves them a hair.
            expect(Math.abs(row.amount - last.amount), `curtains at ${row.t.toFixed(2)}`).toBeLessThan(0.01);
            expect(Math.abs(row.bow - last.bow), `shard at ${row.t.toFixed(2)}`).toBeLessThan(0.01);
            if (row.amount > 0) {
                expect(Math.sign(row.bearing), `side at ${row.t.toFixed(2)}`).toBe(side);
                expect(Math.sign(row.slant), `slant at ${row.t.toFixed(2)}`).toBe(side);
            }
            // The shard is the shower's: on its side, and only by day (this visit falls in daylight).
            if (row.bow > 0.02) expect(row.leg, `leg at ${row.t.toFixed(2)}`).toBe(side);
            expect(row.day).toBe(1);
        });
        expect(Math.max(...rows.map((row) => row.bow))).toBeGreaterThan(0.3);
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (virgaBearing's drift starts over at every whole place): by the clock the bearing creeps
    // from 0.325 to 0.395 rad through the melt in, and in the frame the wheel comes to rest on the
    // showers (t = 276 s, the curtains at full strength) it steps back 0.07 rad at once.
    it('by the clock never moves the curtains more than a hair from one frame to the next', () => {
        const rows = firstVisit();
        let worst = 0;
        for (let i = 1; i < rows.length; i += 1) {
            if (rows[i].amount > 0.02) worst = Math.max(worst, Math.abs(rows[i].bearing - rows[i - 1].bearing));
        }
        // 0.07 rad over the whole visit is 0.00002 rad a frame; a hundred times that is still no jump.
        expect(worst).toBeLessThan(0.002);
    });

    /** Trace (time, bow strength, second bow, leg, the bow as drawn) for `seconds` from now. */
    function trace(world, camera, seconds) {
        const rows = [];
        stepTo(world, camera, world.time + seconds, FRAME, (w) => {
            const [x, y, z] = w.u.bow.value.toArray();
            // The sky fades a young bow in over its first second and a half (painted-ages-events.js).
            const young = Math.min(1, Math.max(0, z / 1.5));
            rows.push({
                t: w.time, x, y, leg: w.u.bowLeg.value, drawn: x * young * young * (3 - 2 * young),
            });
        });
        return rows;
    }

    it.each([4, 5, 8])('lets a broken chain of %i raise its bow out of the shard: never weaker, then whole', (peak) => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, ...SHOWERS } });
        const shard = world.u.bow.value.x;
        for (let n = 1; n <= peak; n += 1) world.onCombo(n);
        stepTo(world, camera, world.time + 5);
        // The storm dims the far shower's shard (a long chain's takes it away altogether); what is
        // left of it is still the shower's leg.
        const showing = world.u.bow.value.x;
        expect(showing).toBeLessThan(shard);
        const dimmed = showing > 0.02;
        if (dimmed) expect(Math.abs(world.u.bowLeg.value)).toBe(1);
        world.onCombo(0);
        expect(world.counts.releases).toBe(1);
        const rows = trace(world, camera, 9);
        rows.forEach((row, i) => {
            // Never below what was showing when the chain broke, never a step down while it rises.
            expect(row.x, `at ${row.t.toFixed(2)}`).toBeGreaterThanOrEqual(showing - 1e-9);
            if (dimmed) expect(row.drawn, `drawn at ${row.t.toFixed(2)}`).toBeGreaterThanOrEqual(showing - 1e-9);
            if (i) expect(row.x, `at ${row.t.toFixed(2)}`).toBeGreaterThanOrEqual(rows[i - 1].x - 1e-9);
        });
        // The event's bow is the stronger one: the whole arc stands, not the shower's leg.
        const risen = rows.filter((row) => row.x > shard + 1e-6);
        expect(risen.length).toBeGreaterThan(rows.length / 2);
        risen.forEach((row) => expect(Math.abs(row.leg), `leg at ${row.t.toFixed(2)}`).toBe(0));
        // When the bow has run its life the shower keeps its shard: never darker than the shard.
        const later = trace(world, camera, TIMING.bowLife + 4);
        later.forEach((row) => expect(row.x, `at ${row.t.toFixed(2)}`).toBeGreaterThanOrEqual(showing - 1e-9));
        expect(Math.abs(later[later.length - 1].leg)).toBe(1);
        expect(later[later.length - 1].x).toBeCloseTo(shard, 2);
    });

    it('lets a perfect clear\'s bow rise out of the shard under reduced motion: at once, never weaker', () => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, ...SHOWERS }, reduced: true });
        const shard = world.u.bow.value.x;
        world.onClear({ lines: 4, perfect: true });
        const rows = trace(world, camera, 9);
        expect(world.spinning).toBe(false);
        rows.forEach((row, i) => {
            expect(row.x, `at ${row.t.toFixed(2)}`).toBeGreaterThanOrEqual(shard - 1e-9);
            if (i) expect(row.x, `at ${row.t.toFixed(2)}`).toBeGreaterThanOrEqual(rows[i - 1].x - 1e-9);
            if (row.x > shard + 1e-6) expect(Math.abs(row.leg), `leg at ${row.t.toFixed(2)}`).toBe(0);
        });
        expect(rows[rows.length - 1].x).toBeGreaterThan(shard);
        expect(Math.abs(rows[rows.length - 1].leg)).toBe(0);
    });

    it('lets a perfect clear\'s bow rise out of the shard once the wheeling day is back: never weaker', () => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, ...SHOWERS } });
        const shard = world.u.bow.value.x;
        world.onClear({ lines: 4, perfect: true });
        const rows = trace(world, camera, SPIN_SECONDS + 8);
        // From the frame its second bow first shows (the bow is raised), the bow only grows.
        const raised = rows.findIndex((row) => row.y > 0);
        expect(raised).toBeGreaterThan(0);
        expect(rows[raised].t - (START + SPIN_SECONDS)).toBeLessThan(0);
        const showing = rows[raised - 1].x;
        expect(showing).toBeGreaterThan(0); // the light is back: the shard stands again
        for (let i = raised; i < rows.length; i += 1) {
            expect(rows[i].x, `at ${rows[i].t.toFixed(2)}`).toBeGreaterThanOrEqual(showing - 1e-9);
            expect(rows[i].x, `at ${rows[i].t.toFixed(2)}`).toBeGreaterThanOrEqual(rows[i - 1].x - 1e-9);
            if (rows[i].x > shard + 1e-6) expect(Math.abs(rows[i].leg), `leg at ${rows[i].t.toFixed(2)}`).toBe(0);
        }
        expect(rows[rows.length - 1].x).toBeGreaterThan(shard);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): raiseBow() only counts an EVENT's bow as "showing". With the shower's shard on screen
    // (strength 0.5) a fresh double bow sets bowSecondShown = 1 at once, so the second bow's leg pops
    // into the shard at full in one frame (second bow drawn: 0 → 0.5) instead of fading in.
    it('fades the second bow in when a double bow is raised over the shard (no pop)', () => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, ...SHOWERS }, reduced: true });
        const before = world.u.bow.value.x * world.u.bow.value.y;
        world.onClear({ lines: 4, perfect: true });
        const rows = trace(world, camera, 3);
        const second = rows.map((row) => row.drawn * row.y);
        let worst = Math.abs(second[0] - before);
        for (let i = 1; i < second.length; i += 1) worst = Math.max(worst, Math.abs(second[i] - second[i - 1]));
        // A thirtieth of a second: a bow that takes even one second to come moves 0.035 a frame.
        expect(worst).toBeLessThan(0.1);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): bowSecond is never cleared when an event's double bow has faded, and u.bow.y carries it
    // for the shard too: 23 s after a perfect clear's bow is gone the far shower's shard is still a
    // double one (u.bow = 0.5, 1; bowLeg ±1), where before the perfect clear it was single.
    it('gives the shower its own single shard back once an event\'s double bow has run its life', () => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, ...SHOWERS }, reduced: true });
        expect(world.u.bow.value.y).toBe(0);
        world.onClear({ lines: 4, perfect: true });
        stepTo(world, camera, world.time + TIMING.bowLife + 20);
        expect(Math.abs(world.u.bowLeg.value)).toBe(1); // only the shard shows again
        expect(world.u.bow.value.y).toBeLessThan(0.01);
    });
});

describe('Painted Ages weather in the world: the moon keeps to the dark', () => {
    it.each(HOURS_OF_DAY)('is down at daylight hour %i, in every air', (hour) => {
        const { world, camera } = makeWorld();
        for (const name of AIR_NAMES) {
            under(world, camera, hour, name);
            expect(world.u.moonUp.value, name).toBe(0);
            expect(world.u.moon.value.toArray(), name).toEqual([0, 0, 0]);
        }
    });

    it('is up at the blue hour, a unit vector above the horizon, with light to give', () => {
        const { world } = makeWorld({ overrides: { hour: BLUE_HOUR } });
        expect(world.u.moonUp.value).toBeGreaterThan(0);
        world.u.moon.value.toArray().forEach((v) => expect(v).toBeGreaterThan(0));
        expect(world.u.moonDir.value.length()).toBeCloseTo(1, 12);
        expect(world.u.moonDir.value.y).toBeGreaterThan(0);
    });

    it.each(HOURS_OF_DAY)('rises with a game over\'s dusk from hour %i, and sets again with the morning', (hour) => {
        const { world, camera } = makeWorld({ overrides: { hour } });
        expect(world.u.moonUp.value).toBe(0);
        world.onGameOver();
        let last = 0;
        stepTo(world, camera, world.time + TIMING.dusk + 0.5, FRAME, (w) => {
            // It only rises while the dusk falls.
            expect(w.u.moonUp.value).toBeGreaterThanOrEqual(last - 1e-12);
            last = w.u.moonUp.value;
        });
        expect(world.u.moonUp.value).toBeGreaterThan(0.5);
        world.u.moon.value.toArray().forEach((v) => expect(v).toBeGreaterThan(0));
        world.onSessionStart();
        stepTo(world, camera, world.time + TIMING.dawn + 0.5);
        expect(world.u.moonUp.value).toBe(0);
        expect(world.u.moon.value.toArray()).toEqual([0, 0, 0]);
    });

    it('is a unit vector above the horizon whenever it shows: a whole day by the clock, and an age wheeling by', () => {
        const check = (w) => {
            const { moonUp, moonDir, moon } = w.u;
            expect(moonUp.value).toBeGreaterThanOrEqual(0);
            expect(moonUp.value).toBeLessThanOrEqual(1);
            if (moonUp.value > 0) {
                expect(moonDir.value.length()).toBeCloseTo(1, 12);
                expect(moonDir.value.y).toBeGreaterThan(0);
            } else {
                expect(moon.value.toArray()).toEqual([0, 0, 0]);
            }
        };
        const day = makeWorld({ start: 0 });
        const places = [];
        stepTo(day.world, day.camera, TIMING.hour * HOUR_COUNT, 0.25, (w) => {
            check(w);
            if (w.u.moonUp.value > 0) places.push(w.light.place);
        });
        // By the clock it is up only round the blue hour: after sunset has begun to fail, before first light.
        expect(places.length).toBeGreaterThan(0);
        expect(Math.min(...places)).toBeGreaterThan(4);
        expect(Math.max(...places)).toBeLessThan(HOUR_COUNT);
        const age = makeWorld({ overrides: { hour: 2 } });
        age.world.onClear({ lines: 4, perfect: true });
        let rose = 0;
        stepTo(age.world, age.camera, age.world.time + SPIN_SECONDS + 1, FRAME, (w) => {
            check(w);
            rose = Math.max(rose, w.u.moonUp.value);
        });
        expect(rose).toBeGreaterThan(0.5); // the night of the wheeling day has its moon
        expect(age.world.u.moonUp.value).toBe(0);
    });
});

describe('Painted Ages weather in the world: a seek lands on the sky a live run stands under', () => {
    /** What a capture must reproduce. */
    const picture = (world) => ({
        wind: read(world.u.wind),
        wind2: read(world.u.wind2),
        cloudCover: read(world.u.cloudCover),
        cloudDepth: read(world.u.cloudDepth),
        towerGrow: read(world.u.towerGrow),
        hazeDensity: read(world.u.hazeDensity),
        mistDensity: read(world.u.mistDensity),
        starTurn: read(world.u.starTurn),
        strataShift: read(world.u.strataShift),
        sunDir: read(world.u.sunDir),
        sun: read(world.u.sun),
        virga: read(world.u.virga),
        air: { ...world.getState().air },
        hour: world.getState().hour.place,
    });

    /** A session that leaves its marks on everything a seek must forget. */
    function play(world, camera) {
        world.levelUp(2);
        world.levelUp(3);
        world.onClear({
            lines: 4,
            rowCodes: Array.from({ length: 40 }, (_, i) => i % 7),
            combo: 3,
            twist: true,
            u: 0.2,
            color: PIECE_COLORS[2],
        });
        for (let n = 1; n <= 6; n += 1) world.onCombo(n);
        stepTo(world, camera, world.time + 12);
        world.onClear({ lines: 4, perfect: true });
        stepTo(world, camera, world.time + SPIN_SECONDS + 2);
        world.onGameOver();
        stepTo(world, camera, world.time + 3);
    }

    const SOUGHT = [0, 37.3, 250, 613.7, 1500.25];

    it.each(SOUGHT)('a used world sought to %f s and stepped stands where a fresh one does', (t) => {
        const used = makeWorld({ start: 5 });
        play(used.world, used.camera);
        used.world.seek(t);
        stepTo(used.world, used.camera, t + 2);
        const fresh = makeWorld({ start: t });
        stepTo(fresh.world, fresh.camera, t + 2);
        expect(picture(used.world)).toEqual(picture(fresh.world));
        // The air is the clock's, and a second seek lands on the same picture.
        expect(used.world.getState().air.name).toBe(airAt(airPlace(t + 2)).name);
        const first = picture(used.world);
        used.world.seek(t);
        stepTo(used.world, used.camera, t + 2);
        expect(picture(used.world)).toEqual(first);
    });

    it.each([60, 300, 700])('a world run live from 0 to %i s at 30 fps has the wind a world sought there has', (t) => {
        const live = makeWorld({ start: 0 });
        stepTo(live.world, live.camera, t);
        const sought = makeWorld({ start: t });
        const a = picture(live.world);
        const b = picture(sought.world);
        // The weather's wind is integrated: within a hundredth of the drift, far inside "a few percent".
        for (const key of ['wind', 'wind2']) {
            a[key].forEach((v, i) => expect(Math.abs(v / b[key][i] - 1), `${key}[${i}]`).toBeLessThan(0.01));
        }
        expect(Math.abs(live.world.u.wind.value.x)).toBeGreaterThan(t); // it has blown the whole time
        // Everything the clock alone decides is the same to the last bit.
        const byTheClock = [
            'cloudCover', 'cloudDepth', 'towerGrow', 'hazeDensity', 'mistDensity', 'starTurn', 'strataShift', 'sunDir',
            'sun', 'virga', 'air', 'hour',
        ];
        for (const key of byTheClock) expect(a[key], key).toEqual(b[key]);
    });
});
