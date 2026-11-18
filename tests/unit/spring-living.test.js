/**
 * Spring — the living valley: the weather wheel beside the day's (spring-weather.js), the sky it
 * hangs its clouds in and the rainbow (spring-sky.js, spring-bow.js), the birds on their routes
 * (spring-flights.js), and what each gameplay event sends into the valley (SpringWorld): a pulse
 * over the fall, streamers of petals, the fall's thunder, the sky's crown, a sheet of light down
 * the river, the last petals of a run.
 *
 * The shader half builds the new and the changed materials through three's own node builders
 * against a device-less renderer (WGSL for the WebGPU backend, GLSL for the WebGL2 fallback) and
 * runs the repo's `unassignedReads` gate over them: the sky's layers are uniform branches, the
 * trap that gate is for.
 */
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { DEG } from '../../src/themes/spring/spring-core.js';
import { HOURS, lightAt, sunHeightAt } from '../../src/themes/spring/spring-hours.js';
import {
    WEATHERS, WEATHER_COUNT, WEATHER_KEYS, WEATHER_TIMING, bowLight, createWeather, nightShine, underLight,
    weatherAt, weatherMix, weatherPlace,
} from '../../src/themes/spring/spring-weather.js';
import { createNoiseTexture, createLatticeTexture, createUniforms } from '../../src/themes/spring/spring-tsl.js';
import { QUALITY } from '../../src/themes/spring/spring-quality.js';
import { createSky } from '../../src/themes/spring/spring-sky.js';
import { createCumulus } from '../../src/themes/spring/spring-cumulus.js';
import { SKY_BOW, createBow } from '../../src/themes/spring/spring-bow.js';
import { BOW } from '../../src/themes/spring/spring-light.js';
import { MOTE_KIND, Motes } from '../../src/themes/spring/spring-motes.js';
import {
    BIRDS, FLIGHT_MOST, Flights, ROUTES, VISITS, WINGBEAT, birdGeometry, routePoint, visitAt, walkRoute,
} from '../../src/themes/spring/spring-flights.js';
import { EYE, RIG, bearingOf } from '../../src/themes/spring/spring-plan.js';
import {
    CROWN, FALL_PLAY, LAST_FALL, REST_RIG, STREAMER, SpringWorld, VISIT_CATCH, WIND, fovForAspect, valleyGround,
    windTravel,
} from '../../src/themes/spring/spring-world.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

/** A world with its camera at rest, and a helper that steps it. */
function makeWorld(quality = 'Minimal') {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SpringWorld({
        scene, quality, capture: true, prepared: { quality, ground: valleyGround(), assets: null },
    }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    let t = 0;
    const step = (seconds = 1 / 30) => {
        const frames = Math.max(1, Math.round(seconds * 30));
        for (let i = 0; i < frames; i++) {
            t += 1 / 30;
            world.updateCamera(camera, { time: t, delta: 1 / 30 });
            world.update({ time: t, delta: 1 / 30 }, camera);
        }
    };
    step();
    return { world, step, camera };
}

/** The motes alive in the ring. */
function live(world) {
    const { motes } = world;
    const out = [];
    for (let i = 0; i < motes.count; i++) {
        const born = motes.start[i * 4 + 3];
        if (born < -1e5) continue;
        out.push({
            kind: motes.kind[i * 4],
            rgb: Array.from(motes.look.subarray(i * 4, i * 4 + 3)),
            born,
            at: Array.from(motes.start.subarray(i * 4, i * 4 + 3)),
            velocity: Array.from(motes.move.subarray(i * 4, i * 4 + 3)),
        });
    }
    return out;
}

describe('spring weather: a wheel of its own beside the day\'s', () => {
    it('opens a session on the fair day, the day the hours author', () => {
        const fair = weatherAt(0);
        expect(fair.name).toBe('fair');
        expect(fair.wind).toBe(1);
        expect(fair.coverMul).toBe(1);
        expect(fair.cover).toBe(0);
        expect(fair.haze).toBe(1);
        expect(fair.mist).toBe(0);
        expect(fair.bow).toBe(0);
        expect(fair.veil).toBe(0);
        expect(weatherPlace(0)).toBe(0);
        // It holds the fair day a while before the first crossing.
        const hold = WEATHER_TIMING.span - WEATHER_TIMING.cross;
        expect(weatherAt(weatherPlace(hold - 1)).mix).toBe(0);
        expect(weatherAt(weatherPlace(hold + 5)).mix).toBeGreaterThan(0);
    });

    it('holds each weather and crosses to the next without a step, round the whole wheel', () => {
        const a = createWeather();
        const b = createWeather();
        const round = WEATHER_COUNT * WEATHER_TIMING.span;
        let widest = 0;
        for (let t = 0; t < round; t += 0.5) {
            weatherAt(weatherPlace(t), a);
            weatherAt(weatherPlace(t + 0.5), b);
            for (const key of WEATHER_KEYS) widest = Math.max(widest, Math.abs(b[key] - a[key]));
        }
        // Half a second never moves any number far (the largest span between two weathers is
        // about 1.3, crossed over the 46 s of a crossing).
        expect(widest).toBeLessThan(0.03);
        // Every weather is reached, whole, once a round.
        for (let k = 0; k < WEATHER_COUNT; k++) {
            const at = weatherAt(k + 0.2);
            expect(at.name).toBe(WEATHERS[k].name);
            for (const key of WEATHER_KEYS) expect(at[key]).toBe(WEATHERS[k][key]);
        }
        // And the wheel comes round to the fair day again.
        expect(weatherMix(WEATHER_COUNT).from).toBe(0);
    });

    it('runs at a pace of its own: the same hour does not meet the same sky two days running', () => {
        // A day is six stations of the hour wheel; a round of the weather is longer.
        const day = HOURS.length * 100;
        const round = WEATHER_COUNT * WEATHER_TIMING.span;
        expect(round).not.toBe(day);
        const first = weatherAt(weatherPlace(250)).name;
        const next = weatherAt(weatherPlace(250 + day)).name;
        expect(next).not.toBe(first);
    });

    it('keeps every weather a sky worth looking at (its numbers inside what the sky can draw)', () => {
        for (const weather of WEATHERS) {
            expect(weather.alto).toBeGreaterThanOrEqual(0);
            expect(weather.alto).toBeLessThanOrEqual(1);
            expect(weather.veil).toBeGreaterThanOrEqual(0);
            expect(weather.veil).toBeLessThanOrEqual(1);
            expect(weather.wind).toBeGreaterThan(0.4);
            expect(weather.wind).toBeLessThan(2.2);
            expect(weather.banks).toBeGreaterThan(0.6);
            expect(weather.banks).toBeLessThan(1.5);
            expect(weather.haze).toBeGreaterThan(0.4);
        }
        // One of them is each of the sights the wheel exists for.
        expect(WEATHERS.some((w) => w.alto >= 0.9)).toBe(true);
        expect(WEATHERS.some((w) => w.veil >= 0.9)).toBe(true);
        expect(WEATHERS.some((w) => w.bow >= 0.9)).toBe(true);
        expect(WEATHERS.some((w) => w.wind >= 1.8)).toBe(true);
    });

    it('lets a rainbow stand only where the sun can light one', () => {
        // Under the horizon, or behind the skyline (no sunlight in the valley): none.
        expect(bowLight(-2, 0)).toBe(0);
        expect(bowLight(10, 0)).toBe(0);
        // A low sun well up over the skyline: a full bow.
        expect(bowLight(20, 1)).toBe(1);
        // Over 42 degrees up the whole bow lies under the level line.
        expect(bowLight(46, 1)).toBe(0);
        expect(BOW.primary[1]).toBeLessThan(43);
        // The afternoon station has one, low over the fells: the sun is under 42 degrees and behind
        // the eye on the left, so the point opposite it lies to the right.
        const afternoon = lightAt(1);
        expect(afternoon.el).toBeLessThan(42);
        expect(bowLight(afternoon.el, afternoon.sunUp)).toBeGreaterThan(0.5);
        const opposite = ((afternoon.az + 180 + 540) % 360) - 180;
        expect(opposite).toBeGreaterThan(0);
        expect(opposite).toBeLessThan(90);
        // The golden evening, sunset, the night and the dawn have the sun ahead of the eye or
        // gone: no bow in the lens (the point opposite the sun lies behind the eye).
        for (const place of [2, 3, 4, 5]) {
            const light = lightAt(place);
            const behind = Math.abs(((light.az + 180 + 540) % 360) - 180) > 90;
            expect(behind || bowLight(light.el, light.sunUp) < 0.05).toBe(true);
        }
    });

    it('shows the night-shining clouds only in the light night; a low sun lights the high clouds from below', () => {
        expect(nightShine(sunHeightAt(0))).toBeGreaterThan(0.8); // midnight
        expect(nightShine(sunHeightAt(20.25))).toBe(0); // sunset: the sun still up behind the rim
        expect(nightShine(sunHeightAt(12))).toBe(0);
        expect(underLight(sunHeightAt(12))).toBe(0);
        expect(underLight(sunHeightAt(20.25))).toBeGreaterThan(0.8);
        expect(underLight(sunHeightAt(3.5))).toBeGreaterThan(0.8); // dawn
        expect(underLight(-12)).toBe(0);
    });

    it('integrates the wind, so a seek lands where stepping would', () => {
        expect(windTravel(0)).toBe(0);
        // Through the fair day the wind blows at 1: a second of travel a second.
        const hold = WEATHER_TIMING.span - WEATHER_TIMING.cross;
        expect(windTravel(hold)).toBeCloseTo(hold, 6);
        // Past it the weather's wind changes the pace, never back.
        let last = 0;
        for (let t = 0; t <= 900; t += 30) {
            const travelled = windTravel(t);
            expect(travelled).toBeGreaterThanOrEqual(last);
            last = travelled;
        }
        const { world } = makeWorld();
        world.seek(100);
        expect(world.windX).toBeCloseTo(windTravel(100) * WIND.drift[0], 3);
        expect(world.bankTurn).toBeCloseTo(windTravel(100) * WIND.bank, 6);
        world.dispose();
    });
});

describe('spring sky: the weather\'s layers, the rainbow, the heaps', () => {
    const u = createUniforms();
    const textures = { noise: createNoiseTexture(), lattice: createLatticeTexture() };

    it.each(BACKENDS)('builds the sky dome to %s at every tier, with no var read before it is set', (name, Builder) => {
        for (const quality of ['Minimal', 'High']) {
            const sky = createSky(u, textures, QUALITY[quality]);
            const built = build(Builder, sky.mesh);
            expect(built.thrown, String(built.thrown?.stack || built.thrown)).toBeUndefined();
            expect(built.heard).toEqual([]);
            expect(built.fragment).not.toMatch(/NaN|\[object Object\]|undefined/);
            if (name === 'WGSL') expect(unassignedReads(built.fragment)).toEqual([]);
            sky.dispose();
        }
    });

    it.each(BACKENDS)('builds the rainbow and the heaps to %s', (name, Builder) => {
        const bow = createBow(u, textures);
        const banks = createCumulus(u, textures, QUALITY.High, QUALITY.High.banks);
        for (const part of [bow, banks]) {
            const built = build(Builder, part.mesh);
            expect(built.thrown, String(built.thrown?.stack || built.thrown)).toBeUndefined();
            expect(built.heard).toEqual([]);
            expect(`${built.vertex}${built.fragment}`).not.toMatch(/NaN|\[object Object\]/);
            if (name === 'WGSL') expect(unassignedReads(built.fragment)).toEqual([]);
            part.dispose();
        }
    });

    it('draws the rainbow as light that adds, on a ring spanning both bows, clipped away while none stands', () => {
        const bow = createBow(u, textures);
        const { material } = bow.mesh;
        expect(material.blending).toBe(THREE.AdditiveBlending);
        expect(material.premultipliedAlpha).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(SKY_BOW.from).toBeLessThan(BOW.primary[0]);
        expect(SKY_BOW.to).toBeGreaterThan(BOW.secondary[1]);
        // The rain it stands against is nearer than the far fells and farther than the knoll's trees.
        expect(SKY_BOW.distance).toBeGreaterThan(600);
        expect(SKY_BOW.distance).toBeLessThan(2500);
        // Drawn with the world from the start (so its pipeline is never made mid-play): the vertex
        // stage clips it away by the bow's strength.
        expect(bow.mesh.visible).toBe(true);
        expect(build(THREE.WGSLNodeBuilder, bow.mesh).vertex).toMatch(/0\.004/);
        bow.dispose();
    });
});

describe('spring flights: swans and cranes on their routes', () => {
    it('models each bird with a body, a neck, and two-jointed wings out to half a wingspan', () => {
        for (const kind of Object.values(BIRDS)) {
            const geometry = birdGeometry(kind);
            const position = geometry.getAttribute('position');
            const wing = geometry.getAttribute('aWing');
            let widest = 0;
            let longest = 0;
            let tips = 0;
            for (let i = 0; i < position.count; i++) {
                widest = Math.max(widest, Math.abs(position.getX(i)));
                longest = Math.max(longest, position.getZ(i));
                if (Math.abs(wing.getX(i)) === 1) tips += 1;
                // A wing vertex stands on its own side.
                if (wing.getX(i) !== 0) expect(Math.sign(wing.getX(i))).toBe(Math.sign(position.getX(i)));
            }
            expect(widest).toBeCloseTo(0.5, 5);
            expect(tips).toBeGreaterThanOrEqual(6);
            // The neck reaches well ahead of the wings.
            expect(longest).toBeGreaterThan(0.3);
            expect(geometry.index.count / 3).toBeGreaterThan(120);
            expect(geometry.index.count / 3).toBeLessThan(400);
            geometry.dispose();
        }
        expect(WINGBEAT.wrist).toBeGreaterThan(0.3);
        expect(WINGBEAT.wrist).toBeLessThan(0.6);
    });

    it.each(BACKENDS)('builds the birds to %s', (name, Builder) => {
        const flights = new Flights(createUniforms());
        for (const mesh of flights.meshes) {
            const built = build(Builder, mesh);
            expect(built.thrown, String(built.thrown?.stack || built.thrown)).toBeUndefined();
            expect(built.heard).toEqual([]);
            expect(`${built.vertex}${built.fragment}`).not.toMatch(/NaN|\[object Object\]/);
        }
        flights.dispose();
    });

    it('starts every route out of sight and ends it out of the lens', () => {
        // The widest lens: the landscape one on a wide screen.
        const half = (aspect, fov) => Math.atan(Math.tan((fov * DEG) / 2) * aspect) / DEG;
        const edge = Math.max(half(16 / 9, RIG.landscape.fov), half(2.4, RIG.wide.fov));
        for (const [name, points] of Object.entries(ROUTES)) {
            const first = points[0];
            const last = points[points.length - 1];
            if (name === 'river') {
                // Behind the fall's brink: lower in the lens than the lip in front of it.
                const lipAngle = Math.atan2(31 - EYE.y, Math.hypot(-44 - EYE.x, -114 - EYE.z));
                const startAngle = Math.atan2(first[1] - EYE.y, Math.hypot(first[0] - EYE.x, first[2] - EYE.z));
                expect(startAngle).toBeLessThan(lipAngle);
                expect(Math.hypot(first[0], first[2])).toBeGreaterThan(Math.hypot(44, 114));
            } else {
                expect(bearingOf(first[0], first[2])).toBeLessThan(-edge - 4);
            }
            expect(bearingOf(last[0], last[2])).toBeGreaterThan(edge + 4);
        }
    });

    it('walks a route by arc length, running on straight before its start and past its end', () => {
        const route = walkRoute(ROUTES.high);
        const p = [0, 0, 0];
        const q = [0, 0, 0];
        expect(route.length).toBeGreaterThan(300);
        // Even steps of arc length are even steps of distance.
        let worst = 0;
        for (let s = 0; s < route.length - 5; s += 5) {
            routePoint(route, s, p);
            routePoint(route, s + 5, q);
            worst = Math.max(worst, Math.abs(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) - 5));
        }
        expect(worst).toBeLessThan(0.2);
        // Behind the start and past the end the route runs on (the formation's last birds).
        routePoint(route, -20, p);
        routePoint(route, 0, q);
        expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeCloseTo(20, 0);
        routePoint(route, route.length + 15, p);
        routePoint(route, route.length, q);
        expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeCloseTo(15, 0);
    });

    it('flies a flight whole: every bird on the route behind its leader from the first frame, at one pace', () => {
        const flights = new Flights(createUniforms());
        flights.launch('swan', 10, { route: 'river' });
        const mesh = flights.meshes[BIRDS.swan.id];
        const { place, heading } = mesh.userData.attributes;
        const read = () => Array.from({ length: BIRDS.swan.count }, (_, n) => ({
            at: Array.from(place.array.subarray(n * 4, n * 4 + 3)),
            size: heading.array[n * 4 + 3],
        }));
        flights.update(10);
        const start = read();
        expect(flights.live).toEqual([BIRDS.swan.count, 0]);
        // All seven out at full size at once (never grown in), the leader in front.
        for (const bird of start) expect(bird.size).toBeGreaterThan(2);
        flights.update(11);
        const later = read();
        // One pace: each has flown the same distance in the second (the route is nearly straight
        // at its start), and the formation's gaps are what they were.
        const flown = later.map((bird, n) => Math.hypot(...bird.at.map((v, c) => v - start[n].at[c])));
        for (const d of flown) expect(Math.abs(d - BIRDS.swan.speed)).toBeLessThan(1.6);
        const gap = (birds) => Math.hypot(...birds[1].at.map((v, c) => v - birds[0].at[c]));
        expect(Math.abs(gap(later) - gap(start))).toBeLessThan(0.8);
        // The flight ends when its last bird has flown the route out, and clips every bird away.
        flights.update(10 + (flights.routes.river.length + 60) / BIRDS.swan.speed);
        expect(flights.slots.every((slot) => !slot.kind)).toBe(true);
        expect(Array.from(heading.array).every((v) => v === 0)).toBe(true);
        flights.dispose();
    });

    it('keeps a flight still crossing when another sets out, while a slot is free', () => {
        const flights = new Flights(createUniforms(), { slots: 3 });
        flights.launch('swan', 0, { route: 'river', count: 2 });
        flights.launch('crane', 5, { route: 'high' });
        flights.launch('crane', 8, { route: 'rim', count: 30 });
        flights.update(9);
        expect(flights.live).toEqual([2, BIRDS.crane.count + FLIGHT_MOST]);
        expect(flights.slots.map((slot) => slot.route).sort()).toEqual(['high', 'rim', 'river']);
        flights.dispose();
    });

    it('brings birds by the clock: one visit after another, each its own time, never two at once', () => {
        let last = -Infinity;
        const seen = new Set();
        for (let k = 0; k < 40; k++) {
            const visit = visitAt(k);
            expect(visit.at).toBeGreaterThan(last + VISITS.gap - 2 * VISITS.jitter - 1e-6);
            expect(BIRDS[visit.bird]).toBeDefined();
            expect(ROUTES[visit.route]).toBeDefined();
            expect(visit.count).toBeLessThanOrEqual(FLIGHT_MOST);
            seen.add(`${visit.bird} ${visit.route}`);
            last = visit.at;
        }
        expect(seen.size).toBe(VISITS.kinds.length);
        expect(visitAt(0).at).toBeGreaterThan(5);
    });

    it('launches the clock\'s visits in the world, and a seek puts a visit under way back on its route', () => {
        const { world } = makeWorld();
        const first = visitAt(0);
        const camera = world._camera;
        const run = (from, to) => {
            for (let t = from; t <= to; t += 0.25) world.update({ time: t, delta: 0.25 }, camera);
        };
        run(0.25, first.at - 1);
        expect(world.counts.visits).toBe(0);
        expect(world.flights.slots.every((slot) => !slot.kind)).toBe(true);
        run(first.at - 0.75, first.at + 2);
        expect(world.counts.visits).toBe(1);
        expect(world.flights.slots.filter((slot) => slot.kind).map((slot) => slot.route)).toEqual([first.route]);
        // A seek into the middle of the visit: the same flight, born when the clock sent it.
        world.seek(first.at + 12);
        const slot = world.flights.slots.find((s) => s.kind);
        expect(slot.born).toBeCloseTo(first.at, 6);
        expect(slot.count).toBe(first.count);
        // A seek long after it: gone, and the next one still to come.
        world.seek(first.at + VISIT_CATCH + 5);
        expect(world.flights.slots.every((s) => !s.kind)).toBe(true);
        expect(visitAt(world.visitNext).at).toBeGreaterThan(first.at + VISIT_CATCH + 5);
        world.dispose();
    });
});

describe('spring events: each its own sight in the valley', () => {
    // The valley is baked once a run (the first world pays for it).
    beforeAll(() => {
        makeWorld().world.dispose();
    }, 60000);

    it('a lock throws a puff of the piece\'s own petals up out of its patch, a hard drop more', () => {
        const { world } = makeWorld();
        world.onLock({
            rows: [19, 18], u: 0.2, color: '#E8508C', shape: 'Z',
        });
        const soft = live(world).filter((m) => m.kind === MOTE_KIND.petal);
        expect(soft.length).toBeGreaterThan(6);
        // Thrown up, and mostly the piece's colour lifted toward white (a few white).
        expect(soft.every((m) => m.velocity[1] > 0.5)).toBe(true);
        expect(soft.filter((m) => m.rgb[0] > m.rgb[1] * 1.6).length / soft.length).toBeGreaterThan(0.5);
        world.motes.clear();
        world.onLock({
            rows: [19, 18], u: 0.2, color: '#E8508C', shape: 'Z', hardDrop: true, distance: 14,
        });
        const hard = live(world).filter((m) => m.kind === MOTE_KIND.petal);
        expect(hard.length).toBeGreaterThan(soft.length);
        world.dispose();
    });

    it('a clear sends a pulse over the fall, a surge after it, and a streamer of petals a line', () => {
        const { world, step } = makeWorld('High');
        const flowAt = world.flowClock;
        world.onClear({ lines: 2, rowCodes: [...new Array(10).fill(2), ...new Array(10).fill(4)], combo: 1 });
        // The pulse leaves the lip now, on the water's clock; the surge leaves the pool as it lands.
        expect(world.pulseBAt).toBeCloseTo(flowAt, 6);
        expect(world.pulseBPower).toBeCloseTo(FALL_PLAY.pulse + FALL_PLAY.pulsePerLine, 6);
        const surge = world.u.tables.events.find((row, k) => k >= 16 && row.x > 0);
        expect(surge.x - world.time).toBeCloseTo(FALL_PLAY.surgeDelay, 6);
        // Two streamers, one a line, on two lanes, each in its row's colour (campion pink, then
        // hepatica blue), each flying the breeze's way across the knoll.
        const petals = live(world).filter((m) => m.kind === MOTE_KIND.petal);
        expect(petals.length).toBeGreaterThan(2 * STREAMER.petals * 0.8);
        expect(world.streamLane).toBe(2);
        const coloured = petals.filter((m) => !(m.rgb[0] > 0.95 && m.rgb[1] > 0.9));
        expect(coloured.some((m) => m.rgb[0] > m.rgb[2] * 1.3)).toBe(true);
        expect(coloured.some((m) => m.rgb[2] > m.rgb[0] * 1.3)).toBe(true);
        expect(petals.every((m) => m.velocity[0] > 3)).toBe(true);
        // A ribbon: born one after another over the gust's span, not all at once.
        const births = petals.map((m) => m.born - world.time);
        expect(Math.max(...births) - Math.min(...births)).toBeGreaterThan(STREAMER.span * 0.8);
        step(0.2);
        expect(world.u.pulse.value.w).toBeCloseTo(world.pulseBPower, 6);
        world.dispose();
    });

    it('feeds a pulse still at the lip, and gives a later clear the other slot (two on the fall at once)', () => {
        const { world, step } = makeWorld();
        world.pulse(0.6);
        const first = { at: world.pulseBAt, power: world.pulseBPower };
        world.pulse(0.8);
        // Fed, not restarted: the same moment at the lip, more water.
        expect(world.pulseBAt).toBe(first.at);
        expect(world.pulseBPower).toBeGreaterThan(0.8);
        expect(world.pulseBPower).toBeLessThanOrEqual(FALL_PLAY.pulseMost);
        step(1);
        world.pulse(0.7);
        expect(world.pulseAAt).toBeGreaterThan(first.at + FALL_PLAY.pulseJoin);
        expect(world.pulseBAt).toBe(first.at);
        world.dispose();
    });

    it('four lines make the fall thunder and call half the sky\'s crown; a single line does neither', () => {
        const { world, step } = makeWorld();
        world.onClear({ lines: 1, rowCodes: [], combo: 1 });
        step(1);
        expect(world.getState().thunder).toBe(0);
        expect(world.getState().crown).toBe(0);
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        step(1.2);
        const state = world.getState();
        expect(state.thunder).toBeGreaterThan(0.9);
        expect(state.crown).toBeGreaterThan(0.2);
        expect(state.crown).toBeLessThanOrEqual(CROWN.quad + 0.2);
        // The bow in the spray stands brighter for it.
        expect(state.bow).toBeGreaterThan(1.4);
        // It falls back.
        step(FALL_PLAY.thunder.fall + 1);
        expect(world.getState().thunder).toBe(0);
        world.dispose();
    });

    it('a second quad takes the thunder up where it stands, never back to nothing', () => {
        const { world, step } = makeWorld();
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        step(2);
        const before = world.getState().thunder;
        world.onClear({ lines: 4, rowCodes: [], combo: 2 });
        step(1 / 30);
        expect(world.getState().thunder).toBeGreaterThanOrEqual(before - 0.02);
        world.dispose();
    });

    it('a perfect clear crowns the sky in full: the swans on the river, gold petals, and the hour\'s own sight', () => {
        const { world, step } = makeWorld();
        world.setCaptureOverrides({ hour: 1 }); // the afternoon: the sun behind the eye, under 42 degrees
        world.onClear({ lines: 2, rowCodes: [], combo: 1 });
        world.onClear({ perfect: true, crown: true });
        step(2);
        const state = world.getState();
        expect(state.crown).toBeGreaterThan(0.9);
        // A rainbow stands where the sun allows one, whatever the weather.
        expect(state.skyBow).toBeGreaterThan(0.5);
        expect(world.flights.slots.filter((s) => s.kind).map((s) => `${s.kind.id} ${s.route}`)).toEqual(['0 river']);
        expect(live(world).some((m) => m.kind === MOTE_KIND.petal && m.rgb[0] > 0.95 && m.rgb[2] < 0.5)).toBe(true);
        // In the light night there is no bow to light: the crown flares the night-shining clouds.
        world.setCaptureOverrides({ hour: 4 });
        step(0.1);
        expect(world.getState().skyBow).toBe(0);
        expect(world.u.sky2.value.z).toBeGreaterThan(0.8);
        expect(world.u.sky2.value.y).toBeGreaterThan(0.9);
        world.dispose();
    });

    it('a back-to-back clear sends a sheet of light down the river, stronger each step of the run', () => {
        const { world, step } = makeWorld();
        world.onB2B(1);
        world.onClear({
            lines: 4, rowCodes: [], combo: 1, b2b: true,
        });
        step(0.1);
        const first = world.u.sheen.value.y;
        expect(world.u.sheen.value.x).toBeGreaterThan(0);
        expect(first).toBeGreaterThan(0.7);
        world.onB2B(3);
        world.onClear({
            lines: 4, rowCodes: [], combo: 2, b2b: true,
        });
        step(0.1);
        expect(world.u.sheen.value.y).toBeGreaterThan(first);
        world.dispose();
    });

    it('a run\'s end lets the last petals fall through the dusk', () => {
        const { world, step } = makeWorld();
        world.onLock({
            rows: [19], u: 0.5, color: '#279DF1', shape: 'S',
        });
        world.motes.clear();
        world.onGameOver();
        const falling = live(world).filter((m) => m.kind === MOTE_KIND.petal);
        expect(falling.length).toBeGreaterThan(LAST_FALL.petals * 0.4);
        expect(falling.every((m) => m.velocity[1] <= 0)).toBe(true);
        // Over the knoll, above the eye, in view.
        expect(falling.every((m) => m.at[1] > EYE.y)).toBe(true);
        step(1);
        expect(world.getState().dusk).toBeGreaterThan(0);
        world.dispose();
    });

    it('throws nothing into the air under reduced motion (the light and the water still answer)', () => {
        const { world, step } = makeWorld();
        world.setReducedMotion(true);
        world.onLock({
            rows: [19], u: 0.3, color: '#F6E76E', shape: 'I',
        });
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        world.onGameOver();
        expect(live(world).filter((m) => m.kind === MOTE_KIND.petal)).toEqual([]);
        step(1);
        expect(world.getState().thunder).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('carries the new session state through a rebuild in place', () => {
        const { world, step } = makeWorld();
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        world.onClear({ perfect: true, crown: true });
        step(1.5);
        const state = world.exportSessionState();
        const next = makeWorld();
        next.world.importSessionState(state);
        for (const key of ['pulseAAt', 'pulseBAt', 'pulseBPower', 'windX', 'bankTurn', 'visitNext', 'streamLane']) {
            expect(next.world[key]).toBe(world[key]);
        }
        expect(next.world.thunder.valueAt(world.time)).toBeCloseTo(world.thunder.valueAt(world.time), 6);
        expect(next.world.crown.valueAt(world.time)).toBeCloseTo(world.crown.valueAt(world.time), 6);
        world.dispose();
        next.world.dispose();
    });
});

describe('spring motes: petals', () => {
    it.each(BACKENDS)('builds the motes (petals and all) to %s', (name, Builder) => {
        const motes = new Motes(createUniforms(), 64);
        const built = build(Builder, motes.mesh);
        expect(built.thrown, String(built.thrown?.stack || built.thrown)).toBeUndefined();
        expect(built.heard).toEqual([]);
        expect(`${built.vertex}${built.fragment}`).not.toMatch(/NaN|\[object Object\]/);
        motes.dispose();
    });

    it('keeps the petal kinds apart from every other kind of mote', () => {
        const kinds = Object.values(MOTE_KIND);
        expect(new Set(kinds).size).toBe(kinds.length);
        // The shader tells kinds apart by a band half a unit wide round each whole number.
        for (const kind of kinds) expect(Number.isInteger(kind)).toBe(true);
        expect(MOTE_KIND.petal).not.toBe(MOTE_KIND.petalWhirl);
    });
});

describe('spring motes: a busy moment never cuts short what is still in the air', () => {
    /**
     * Play `seconds` of hot play (a hard drop every 0.6 s, a clear every other lock in a rising
     * chain with a quad among them) and count the motes written over a slot whose mote was still
     * to be seen.
     */
    function hotPlay(quality, seconds = 14) {
        const { world, step } = makeWorld(quality);
        const { motes } = world;
        const spawn = motes.spawn.bind(motes);
        let cut = 0;
        let spawned = 0;
        motes.spawn = (o) => {
            const i = spawn(o);
            spawned += 1;
            return i;
        };
        const nextSlot = motes.nextSlot.bind(motes);
        motes.nextSlot = () => {
            const i = nextSlot();
            const born = motes.start[i * 4 + 3];
            const age = world.time - born;
            if (born > -1e5 && age < motes.move[i * 4 + 3] * 0.8) cut += 1;
            return i;
        };
        const shapes = ['I', 'T', 'Z', 'L', 'S', 'J', 'O'];
        let combo = 0;
        for (let k = 0; k * 0.6 < seconds; k++) {
            world.onLock({
                rows: [18], u: (k * 0.37) % 1, shape: shapes[k % 7], hardDrop: k % 2 === 0, distance: 12,
            });
            if (k % 2 === 1) {
                combo += 1;
                const lines = k % 10 === 9 ? 4 : 1 + (k % 3);
                world.onClear({ lines, rowCodes: Array.from({ length: lines * 10 }, (_, c) => (c + k) % 7), combo });
                world.onCombo(combo);
            }
            step(0.6);
        }
        world.dispose();
        return { cut, spawned, ring: motes.count };
    }

    it.each(['Minimal', 'High'])('on %s: every burst is sized by the room the ring has', (quality) => {
        const { cut, spawned, ring } = hotPlay(quality);
        expect(cut).toBe(0);
        // And the play still fills the air: several rings' worth over the session.
        expect(spawned).toBeGreaterThan(ring * 2);
    });

    it('counts a slot free once its mote has faded, and hands the free ones out first', () => {
        const motes = new Motes(createUniforms(), 8);
        motes.now = 0;
        expect(motes.free()).toBe(8);
        for (let i = 0; i < 6; i++) {
            motes.spawn({
                x: 0, y: 0, z: 0, born: 0, life: 10,
            });
        }
        expect(motes.free()).toBe(2);
        motes.now = 9.5; // past nine tenths of their lives: faded out
        expect(motes.free()).toBe(8);
        motes.now = 5;
        // The next spawns take the two never used, not the six in the air.
        const a = motes.spawn({
            x: 0, y: 0, z: 0, born: 5, life: 10,
        });
        const b = motes.spawn({
            x: 0, y: 0, z: 0, born: 5, life: 10,
        });
        expect([a, b].sort()).toEqual([6, 7]);
        expect(motes.free()).toBe(0);
        motes.dispose();
    });
});
