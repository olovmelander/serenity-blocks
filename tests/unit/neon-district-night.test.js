import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FLYBY_BEAT, FLYBY_KINDS, FLYBY_RUN, FLYBY_SPAN, WEATHER, WEATHER_PERIOD, flybyAt, weatherAt, weatherTime,
} from '../../src/themes/neon-district/neon-district-night.js';
import {
    DISTRICT_PALETTES, DISTRICT_PERIOD, NeonDistrictWorld, REST_RIG,
} from '../../src/themes/neon-district/neon-district-world.js';
import { STREET } from '../../src/themes/neon-district/neon-district-core.js';
import { fallbackLayout } from '../../src/themes/neon-district/neon-district-composition.js';
import { FIREWORK_SHELLS, STRIKE_SLOTS } from '../../src/themes/neon-district/neon-district-fx.js';

function makeWorld(quality = 'High') {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, REST_RIG.near, REST_RIG.far);
    const world = new NeonDistrictWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    world.setLayout(fallbackLayout(1600, 900), 16 / 9);
    const at = (time) => {
        world.seek(time);
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: 0 }, camera);
    };
    at(10);
    return { camera, world, at };
}

describe('neon district night: the weather', () => {
    it('starts every night in today\'s rain and comes round on a clock of its own', () => {
        const first = weatherAt(0);
        expect(first.name).toBe('rain');
        expect(first).toMatchObject({
            fall: 1, fog: 1, sky: 0, mist: 1, warm: 0, sat: 1.12,
        });
        expect(first.tint).toEqual([0.86, 0.97, 1.16]);
        expect(WEATHER_PERIOD).toBe(WEATHER.reduce((sum, state) => sum + state.span, 0));
        const again = weatherAt(WEATHER_PERIOD);
        expect(again.name).toBe('rain');
        expect(again.fall).toBeCloseTo(1, 9);
        // The palettes turn on another clock: the two meet the same way only after hours.
        const wheel = DISTRICT_PERIOD * DISTRICT_PALETTES.length;
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        expect((wheel * WEATHER_PERIOD) / gcd(wheel, WEATHER_PERIOD)).toBeGreaterThan(3600 * 2);
    });

    it('shows every state pure for a while, and melts between them without a step', () => {
        for (const state of WEATHER) {
            const w = weatherAt(weatherTime(state.name));
            expect(w.name).toBe(state.name);
            expect(w.melt).toBe(0);
            for (const key of ['fall', 'wind', 'fog', 'sky', 'storm', 'mist', 'warm', 'sat']) expect(w[key], `${state.name}.${key}`).toBe(state[key]);
        }
        const a = weatherAt(0);
        const b = weatherAt(0);
        for (let t = 0; t < WEATHER_PERIOD; t += 0.25) {
            weatherAt(t, a);
            weatherAt(t + 0.25, b);
            expect(Math.abs(a.fall - b.fall), `fall @${t}`).toBeLessThan(0.03);
            expect(Math.abs(a.fog - b.fog), `fog @${t}`).toBeLessThan(0.04);
            expect(Math.abs(a.sky - b.sky), `sky @${t}`).toBeLessThan(0.03);
            for (let c = 0; c < 3; c++) expect(Math.abs(a.tint[c] - b.tint[c])).toBeLessThan(0.01);
        }
        // It has a dry spell, a fog bank and a downpour in it.
        expect(Math.min(...WEATHER.map((state) => state.fall))).toBe(0);
        expect(Math.max(...WEATHER.map((state) => state.fog))).toBeGreaterThan(2);
        expect(Math.max(...WEATHER.map((state) => state.fall))).toBeGreaterThan(1.5);
    });

    it('turns the district with it: the rain stops and the smog parts, the fog thickens and glows', () => {
        const { world, at } = makeWorld();
        at(weatherTime('rain'));
        const rain = {
            fall: world.u.fall.value, fog: world.u.fog.value, haze: world.u.hazeLow.value.toArray(), post: { ...world.getPostState() },
        };
        expect(world.getState().weather).toBe('rain');
        expect(rain.fall).toBeCloseTo(1, 6);
        expect(rain.fog).toBeCloseTo(1, 6);
        expect(rain.post.glassWet).toBeCloseTo(1, 6);

        at(weatherTime('clear'));
        expect(world.getState().weather).toBe('clear');
        expect(world.u.fall.value).toBe(0);
        expect(world.u.sky.value).toBe(1);
        expect(world.u.fog.value).toBeLessThan(0.7);
        // Dry air, wet street: the road keeps its mirror, the glass loses its drops.
        expect(world.u.rain.value).toBeGreaterThanOrEqual(1);
        expect(world.getPostState().glassWet).toBe(0);
        expect(world.getPostState().sat).toBeGreaterThan(rain.post.sat);

        at(weatherTime('fog'));
        expect(world.u.fog.value).toBeGreaterThan(2.5);
        const fog = world.u.hazeLow.value.toArray();
        // Brighter, and warmer: red gains on blue.
        expect(fog[0] + fog[1] + fog[2]).toBeGreaterThan((rain.haze[0] + rain.haze[1] + rain.haze[2]) * 1.5);
        expect(fog[0] / fog[2]).toBeGreaterThan(rain.haze[0] / rain.haze[2]);

        at(weatherTime('downpour'));
        expect(world.u.fall.value).toBeGreaterThan(1.5);
        expect(world.u.downpour.value).toBeGreaterThan(0.9);
        expect(world.u.rain.value).toBeGreaterThan(1.2);

        // A playground (or a test) can hold one state whatever the clock says.
        world.weatherHold = weatherTime('fog');
        at(5);
        expect(world.getState().weather).toBe('fog');
        world.dispose();
    });

    it('lets hot play bring the rain into a clear spell, and a crown open the sky in the rain', () => {
        const { camera, world, at } = makeWorld();
        at(weatherTime('clear'));
        expect(world.u.fall.value).toBe(0);
        // A fever: locks and clears in quick succession.
        let t = world.time;
        for (let i = 0; i < 60; i++) {
            t += 0.25;
            world.onLock({ u: (i % 10) / 10, hardDrop: true });
            if (i % 2) world.onClear({ lines: 2, combo: i });
            world.updateCamera(camera, { time: t, delta: 0.25 });
            world.update({ time: t, delta: 0.25 }, camera);
        }
        expect(world.u.fall.value).toBeGreaterThan(0.3);

        at(weatherTime('rain'));
        world.onClear({ lines: 4, perfect: true });
        t = world.time;
        for (let i = 0; i < 90; i++) {
            t += 1 / 60;
            world.update({ time: t, delta: 1 / 60 }, camera);
        }
        expect(world.u.sky.value).toBeGreaterThan(0.8);
        world.dispose();
    });
});

describe('neon district night: passers-by', () => {
    it('sends one down the street each beat, never the same kind twice running', () => {
        let lastKind = -1;
        const kinds = new Set();
        const sides = new Set();
        const ways = new Set();
        for (let beat = 0; beat < 80; beat++) {
            let seen = null;
            for (let t = beat * FLYBY_BEAT; t < (beat + 1) * FLYBY_BEAT; t += 0.1) {
                const fly = flybyAt(t);
                if (!fly.live) continue; // eslint-disable-line no-continue
                seen = seen || { ...fly };
                expect(fly.beat).toBe(beat);
                expect(fly.kind).toBe(seen.kind);
                expect(fly.depth).toBeGreaterThanOrEqual(FLYBY_RUN[0] - 1e-6);
                expect(fly.depth).toBeLessThanOrEqual(FLYBY_RUN[1] + 1e-6);
                // Between the walls, over the heads of the lamps' lower arms.
                expect(Math.abs(fly.x)).toBeLessThan(STREET.halfStreet - 2);
                expect(fly.y).toBeGreaterThan(3.5);
                expect(fly.fade).toBeGreaterThanOrEqual(0);
                expect(fly.fade).toBeLessThanOrEqual(1);
            }
            expect(seen, `beat ${beat}`).toBeTruthy();
            expect(seen.kind).not.toBe(lastKind);
            lastKind = seen.kind;
            kinds.add(seen.kind);
            sides.add(seen.side);
            ways.add(seen.dir);
        }
        expect(kinds.size).toBe(FLYBY_KINDS.length);
        expect(sides.size).toBe(2);
        expect(ways.size).toBe(2);
        expect(FLYBY_SPAN).toBeLessThan(FLYBY_BEAT - 6);
    });

    it('draws its card and drags its light along the street, and stays away under reduced motion', () => {
        const { world, at } = makeWorld();
        let live = 0;
        for (let t = 0; t < FLYBY_BEAT; t += 0.2) {
            const fly = flybyAt(t);
            if (fly.live && fly.fade > 0.99) {
                live = t;
                break;
            }
        }
        at(live);
        const place = world.parts.flyby.uniforms.place.value;
        expect(place.w).toBeGreaterThan(0.99);
        expect(world.u.pass.value.y).toBeGreaterThan(0.3);
        expect(world.u.pass.value.x).toBeCloseTo(place.z, 6);
        expect(world.getState().flyby).toBe(FLYBY_KINDS[flybyAt(live).kind].name);
        world.setReducedMotion(true);
        at(live);
        expect(place.w).toBe(0);
        expect(world.u.pass.value.y).toBe(0);
        world.dispose();
    });
});

describe('neon district world: an effect of its own for every event', () => {
    it('stands a column of light up at both kerbs for a hard drop, and none for a soft lock', () => {
        const { world } = makeWorld();
        const rows = world.strike.table;
        world.onLock({ u: 0.5 });
        for (let i = 0; i < STRIKE_SLOTS; i++) expect(rows[i * 2].w).toBe(0);
        world.onLock({ u: 0.5, hardDrop: true, color: '#20e0d0' });
        const xs = [];
        for (let i = 0; i < STRIKE_SLOTS; i++) {
            expect(rows[i * 2].w).toBeGreaterThan(0.5);
            expect(rows[i * 2].z).toBeGreaterThan(world.time);
            xs.push(rows[i * 2].x);
        }
        // One at each kerb, clear of the card that covers the landing.
        expect(xs.sort((a, b) => a - b)).toEqual([-(STREET.halfRoad + 0.35), STREET.halfRoad + 0.35]);
        world.dispose();
    });

    it('sends a gyre up the canyon for a twist, the other way round each time', () => {
        const { world } = makeWorld();
        const turn = world.gyre.uniforms.turn.value;
        expect(turn.y).toBe(0);
        world.onClear({ lines: 2, twist: true });
        expect(turn.x).toBe(world.time);
        expect(turn.y).toBe(1);
        const way = turn.z;
        world.onSpin();
        expect(turn.z).toBe(-way);
        expect(turn.y).toBeLessThan(1);
        // A clear without a twist leaves it alone.
        const before = turn.clone();
        world.onClear({ lines: 3 });
        expect(turn.equals(before)).toBe(true);
        world.dispose();
    });

    it('sends up rockets for a new level and for a perfect clear, in the lanes beside the card', () => {
        const { world } = makeWorld();
        const rows = world.fireworks.table;
        const lit = () => {
            let n = 0;
            for (let i = 0; i < FIREWORK_SHELLS; i++) if (rows[i * 2].w > world.time) n += 1;
            return n;
        };
        expect(lit()).toBe(0);
        world.levelUp(2);
        expect(lit()).toBe(4);
        for (let i = 0; i < 4; i++) {
            const shell = rows[i * 2];
            // Beside the card (never behind it), between the walls, above the street.
            expect(Math.abs(shell.x)).toBeGreaterThan(1.5);
            expect(Math.abs(shell.x)).toBeLessThan(STREET.halfStreet);
            expect(shell.y).toBeGreaterThan(3);
            expect(shell.z).toBeLessThan(-6);
        }
        // A silent level (a rebuild that carries the level) sends none.
        const { world: quiet } = makeWorld();
        quiet.levelUp(4, { silent: true });
        for (let i = 0; i < FIREWORK_SHELLS; i++) expect(quiet.fireworks.table[i * 2].w).toBe(-100);
        quiet.dispose();
        world.onClear({ lines: 4, perfect: true });
        expect(lit()).toBeGreaterThanOrEqual(5);
        world.dispose();
    });

    it('calls two dragons for a perfect clear: one white-gold, one in the district\'s colours', () => {
        const { world } = makeWorld();
        world.onClear({ lines: 4, perfect: true });
        const [lead, twin] = world.flights;
        expect(lead.plan.scheme).toBe(5);
        expect(twin.plan.scheme).toBe(0);
        expect(twin.at).toBeGreaterThan(lead.at);
        expect(lead.plan.recipe).not.toBe(twin.plan.recipe);
        expect(world.getState().flights.length).toBe(2);
        world.dispose();
    });
});
