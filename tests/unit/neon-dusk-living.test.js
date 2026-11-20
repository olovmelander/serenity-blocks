/**
 * Neon Dusk never stands still, and every event has an instrument of its own (2026-11):
 *
 *   - the clocks (neon-dusk-clock.js, three-free): airs beside the moods, the sky's turn, the
 *     planet's round, the sun's ride, the happenings; all closed forms of the time;
 *   - the world: each event lights its own layer and no other event's; a seek lands in the middle
 *     of the same happening; a run's end sets the sun and the next run raises it;
 *   - the parts the pass added: the ridgelines follow the ranges' skylines, the glider's hull is
 *     whole, a flight comes out of the pass and is parked afterwards.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    AIRS, AIR_COUNT, AIR_KEYS, AIR_PERIOD, HAPPENINGS, HAPPENING_PERIOD, PLANET, SUN_DRIFT, airAt,
    airName, airPhase, happeningOf, planetAt, skyTurn, sunDrift,
} from '../../src/themes/neon-dusk/neon-dusk-clock.js';
import { MOODS, MOOD_PERIOD, swing } from '../../src/themes/neon-dusk/neon-dusk-moods.js';
import { NeonDuskWorld, SHOW, SLOTS } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import { RANGES } from '../../src/themes/neon-dusk/neon-dusk-mountains.js';
import { FLIGHT } from '../../src/themes/neon-dusk/neon-dusk-flight.js';
import {
    GLIDER, GLIDER_EDGE, GLIDER_KIND, GLIDER_NORMAL, GLIDER_POSITION,
} from '../../src/themes/neon-dusk/neon-dusk-glider-model.js';
import { RIG, SUN } from '../../src/themes/neon-dusk/neon-dusk-tsl.js';

const DT = 1 / 60;

const seeded = (seed = 7) => {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
};

function makeWorld({ happenings = false, board = null } = {}) {
    const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
    world.tune.happenings = happenings;
    world.setLayout(16 / 9, board, { immediate: true });
    world.update({ time: 10, delta: DT });
    return world;
}

function runTo(world, until) {
    for (let t = world.time + DT; t <= until + 1e-9; t += DT) world.update({ time: t, delta: DT });
}

/** What every instrument is showing now. */
function lit(world) {
    const { u } = world;
    return {
        halos: world.holoU.filter((h) => h.value.z > 0.01).length,
        triangle: u.tri.value.z > 0.01,
        twins: u.twin.value.y > 0.01,
        beams: u.beamCount.value,
        scan: u.scan.value.y > 0.01,
        meteors: u.shootCount.value,
        pulses: u.ridgePulseCount.value,
        racers: u.racerCount.value,
        shock: Math.max(u.shock0.value.w, u.shock1.value.w) > 0.01,
        rays: u.rays.value.x,
        crown: u.crown.value,
        slits: u.slitFill.value,
    };
}

describe('neon-dusk clocks: the dusk never stands still', () => {
    it('opens on the clear air and turns through every air by the clock, each clearly its own', () => {
        expect(AIRS[0].name).toBe('clear');
        expect(airName(airPhase(0))).toBe('clear');
        const seen = new Set();
        for (let t = 0; t < AIR_PERIOD * AIR_COUNT; t += AIR_PERIOD) seen.add(airName(airPhase(t + 1)));
        expect(seen.size).toBe(AIR_COUNT);
        // Each air leads in something of its own.
        for (const key of ['cloud', 'deep', 'haze', 'lattice']) {
            const best = [...AIRS].sort((a, b) => b[key] - a[key]);
            expect(best[0][key] - best[1][key], key).toBeGreaterThan(0.4);
        }
        // Whole phases are an air exactly; between, it melts.
        const out = airAt(2, {});
        for (const key of AIR_KEYS) expect(out[key]).toBe(AIRS[2][key]);
        const half = airAt(2.5, {});
        expect(half.deep).toBeGreaterThan(Math.min(AIRS[2].deep, AIRS[3].deep));
        expect(half.deep).toBeLessThan(Math.max(AIRS[2].deep, AIRS[3].deep));
        // The airs and the moods run on periods of their own, so the pairings keep changing.
        expect(AIR_PERIOD).not.toBe(MOOD_PERIOD);
        expect((AIR_PERIOD * AIR_COUNT) % (MOOD_PERIOD * MOODS.length)).not.toBe(0);
    });

    it('turns the sky, rides the sun and rounds the planet as closed forms of the time', () => {
        expect(skyTurn(0)).toBe(0);
        expect(skyTurn(300)).toBeGreaterThan(skyTurn(100));
        expect(skyTurn(100, 1)).toBeGreaterThan(skyTurn(100, 0));
        expect(sunDrift(0)).toBe(0);
        let reach = 0;
        for (let t = 0; t < SUN_DRIFT.period; t += 5) reach = Math.max(reach, Math.abs(sunDrift(t)));
        expect(reach).toBeCloseTo(SUN_DRIFT.reach, 3);
        // The sun never leaves the pass by its ride alone.
        expect(SUN.elevation - SUN_DRIFT.reach).toBeGreaterThan(0.04);

        // The planet is up at the opening, sets, stays down a while and rises again.
        expect(planetAt(0).up).toBe(1);
        let ups = 0;
        let downs = 0;
        let top = 0;
        for (let t = 0; t < PLANET.period; t += 2) {
            const p = planetAt(t);
            if (p.up) {
                ups += 1;
                top = Math.max(top, p.elevation);
                expect(p.azimuth).toBeGreaterThanOrEqual(PLANET.from - 1e-9);
                expect(p.azimuth).toBeLessThanOrEqual(PLANET.to + 1e-9);
            } else {
                downs += 1;
                expect(p.elevation).toBeLessThan(0);
            }
        }
        expect(ups / (ups + downs)).toBeCloseTo(PLANET.up, 1);
        expect(top).toBeCloseTo(PLANET.peak, 2);
        // It rides clear above the sun's crown at the top of its arc.
        expect(PLANET.peak - PLANET.radius * 2.4).toBeGreaterThan(SUN.elevation + SUN.radius);
    });

    it('draws the same happening for a window every time, never the same kind twice running', () => {
        const kinds = new Set();
        let last = 'none';
        for (let k = 0; k < 400; k += 1) {
            const a = happeningOf(k);
            const b = happeningOf(k);
            expect(a.kind).toBe(b.kind);
            expect(a.start).toBe(b.start);
            expect(a.start).toBeGreaterThanOrEqual(k * HAPPENING_PERIOD);
            expect(a.start).toBeLessThan((k + 1) * HAPPENING_PERIOD);
            if (a.kind !== 'none') expect(a.kind).not.toBe(last);
            last = a.kind;
            kinds.add(a.kind);
        }
        for (const h of HAPPENINGS) expect(kinds.has(h.kind), h.kind).toBe(true);
    });

    it('swings a colour the short way round the wheel, never through grey', () => {
        const pink = MOODS[0].grid;
        const cyan = MOODS[0].gridHot;
        expect(swing(pink, cyan, 0)).toEqual([...pink]);
        expect(swing(pink, cyan, 1)).toEqual([...cyan]);
        const mid = swing(pink, cyan, 0.5);
        const max = Math.max(...mid);
        const min = Math.min(...mid);
        expect((max - min) / max).toBeGreaterThan(0.6);
        // Half-way from magenta to cyan is a violet-blue: blue leads, green trails.
        expect(mid[2]).toBe(max);
        expect(mid[1]).toBe(min);
    });
});

describe('neon-dusk world: the clocks drive the picture', () => {
    it('wears the live mood on the grid, the scan lines and the ridgelines', () => {
        const world = makeWorld();
        const at = (t) => {
            world.seek(t);
            world.update({ time: t, delta: 0 });
            return [world.u.gridNear.value.toArray(), world.u.ridge.value.toArray(), world.u.scanHigh.value.toArray()];
        };
        const [grid0, ridge0, scan0] = at(10);
        expect(grid0).toEqual(MOODS[0].grid);
        expect(ridge0).toEqual(MOODS[0].ridge);
        expect(scan0).toEqual(MOODS[0].scanHigh);
        const [grid2, ridge2] = at(MOOD_PERIOD * 2 + 10);
        expect(grid2).toEqual(MOODS[2].grid);
        expect(ridge2).toEqual(MOODS[2].ridge);
        expect(grid2).not.toEqual(grid0);
        world.dispose();
    });

    it('turns the air, the sky and the planet by the clock, the same after a seek', () => {
        const world = makeWorld();
        const read = () => ({
            deep: world.u.deep.value,
            cloud: world.u.cloud.value,
            lattice: world.u.lattice.value,
            sky: world.u.skyRot.value.elements.slice(),
            planet: world.u.planetDir.value.toArray(),
            sun: world.u.sunDir.value.toArray(),
        });
        runTo(world, 30);
        const early = read();
        // The sky's frame is a rotation.
        const m = new THREE.Matrix3().fromArray(early.sky);
        expect(m.determinant()).toBeCloseTo(1, 5);

        runTo(world, AIR_PERIOD * 2 + 20);
        const later = read();
        expect(world.airName()).toBe('deep sky');
        expect(later.deep).toBeGreaterThan(early.deep + 0.4);
        expect(later.sky).not.toEqual(early.sky);
        expect(later.planet).not.toEqual(early.planet);
        expect(later.sun[1]).not.toBe(early.sun[1]);

        world.seek(AIR_PERIOD * 2 + 20);
        world.update({ time: AIR_PERIOD * 2 + 20, delta: 0 });
        const sought = read();
        expect(sought.deep).toBeCloseTo(later.deep, 6);
        sought.sky.forEach((v, i) => expect(v).toBeCloseTo(later.sky[i], 6));
        sought.planet.forEach((v, i) => expect(v).toBeCloseTo(later.planet[i], 6));

        // The playground can hold one air.
        world.tune.air = 4;
        world.update({ time: world.time, delta: 0 });
        expect(world.u.lattice.value).toBe(1);
        expect(world.airName()).toBe('lattice');
        world.dispose();
    });

    it('brings the sky\'s visitors by the clock: the same one after a seek, none under reduced motion', () => {
        const world = makeWorld({ happenings: true });
        // Find a window of each kind and land in the middle of it.
        const windows = {};
        for (let k = 0; k < 200 && Object.keys(windows).length < 5; k += 1) {
            const h = happeningOf(k);
            if (h.kind !== 'none' && !windows[h.kind]) windows[h.kind] = h;
        }
        expect(Object.keys(windows).sort()).toEqual(['comet', 'flight', 'meteors', 'racers', 'satellite']);
        const showing = {
            meteors: () => world.u.shootCount.value > 0,
            satellite: () => world.u.shootCount.value > 0,
            comet: () => world.u.comet.value.w > 0.05,
            racers: () => world.u.racerCount.value > 0,
            flight: () => world.flight.progress(world.time) >= 0,
        };
        for (const [kind, h] of Object.entries(windows)) {
            const at = h.start + Math.min(5, h.duration * 0.4);
            world.seek(h.start - 0.5);
            runTo(world, at);
            expect(showing[kind](), `${kind} by the clock`).toBe(true);
            world.seek(at);
            world.update({ time: at, delta: 0 });
            expect(showing[kind](), `${kind} after a seek`).toBe(true);
        }

        const calm = makeWorld({ happenings: true });
        calm.motion = 0;
        for (let t = 0; t < HAPPENING_PERIOD * 12; t += 0.25) {
            calm.update({ time: t, delta: 0.25 });
            expect(calm.u.shootCount.value).toBe(0);
            expect(calm.u.racerCount.value).toBe(0);
            expect(calm.u.comet.value.w).toBe(0);
            expect(calm.flight.progress(t)).toBe(-1);
        }
        world.dispose();
        calm.dispose();
    });
});

describe('neon-dusk events: an instrument each', () => {
    const play = (fire, age = 0.3) => {
        const world = makeWorld();
        fire(world);
        runTo(world, world.time + age);
        const state = lit(world);
        world.dispose();
        return state;
    };

    it('gives each event its own instrument, and no other event\'s', () => {
        const rest = play(() => {});
        expect(rest).toMatchObject({
            halos: 0, triangle: false, twins: false, beams: 0, scan: false, meteors: 0, pulses: 0, racers: 0, shock: false,
        });
        expect(rest.rays).toBe(0);

        const single = play((w) => w.onLineClear(1));
        expect(single.pulses).toBe(1);
        expect(single).toMatchObject({
            halos: 0, beams: 0, triangle: false, twins: false, scan: false, racers: 0,
        });

        const double = play((w) => w.onLineClear(2));
        expect(double.halos).toBe(1);
        expect(double.beams).toBe(0);

        const triple = play((w) => w.onLineClear(3));
        expect(triple.beams).toBe(3);
        expect(triple.rays).toBe(0);

        const quad = play((w) => w.onLineClear(4));
        expect(quad.beams).toBe(5);
        expect(quad.rays).toBeGreaterThan(0.6);
        expect(quad.halos).toBeGreaterThanOrEqual(1);

        const twist = play((w) => w.onTwist(2));
        expect(twist.triangle).toBe(true);
        expect(twist).toMatchObject({ halos: 0, beams: 0, twins: false });

        const b2b = play((w) => w.onB2B(true));
        expect(b2b.twins).toBe(true);
        expect(b2b).toMatchObject({ halos: 0, triangle: false, beams: 0 });

        const cascade = play((w) => w.onCombo(3), 0.25);
        expect(cascade.meteors).toBe(3);
        expect(cascade).toMatchObject({ halos: 0, triangle: false, beams: 0 });

        const level = play((w) => w.onLevelUp(), 0.6);
        expect(level.scan).toBe(true);
        expect(level.racers).toBeGreaterThanOrEqual(4);
        expect(level.pulses).toBe(3);
        expect(level).toMatchObject({ triangle: false, twins: false, beams: 0 });

        const hard = play((w) => {
            w.onHardDrop();
            w.onPieceLock({ type: 'T', x: 2 });
        }, 0.2);
        expect(hard.shock).toBe(true);
        const soft = play((w) => w.onPieceLock({ type: 'T', x: 2 }), 0.2);
        expect(soft.shock).toBe(false);
    });

    it('makes the biggest moments the biggest: a quad over a triple, the perfect clear over all', () => {
        const light = (s) => s.rays + s.beams * 0.2 + s.halos * 0.2 + s.crown + s.meteors * 0.1 + s.pulses * 0.15;
        const single = play((w) => w.onLineClear(1));
        const triple = play((w) => w.onLineClear(3));
        const quad = play((w) => w.onLineClear(4));
        const perfect = play((w) => {
            w.onLineClear(4);
            w.onPerfectClear();
        }, 0.5);
        expect(light(triple)).toBeGreaterThan(light(single));
        expect(light(quad)).toBeGreaterThan(light(triple) + 0.5);
        expect(light(perfect)).toBeGreaterThan(light(quad) + 0.5);
        expect(perfect.beams).toBe(SLOTS.beams);
        expect(perfect.crown).toBeGreaterThan(0.6);
    });

    it('stands a hard drop\'s pillar where the piece rose, and no pillar for a soft lock', () => {
        const world = makeWorld();
        const { iPillar } = world.fx.pillars;
        const livePillars = () => {
            let n = 0;
            for (let i = 0; i < iPillar.count; i += 1) if (iPillar.array[i * 4 + 2] > -1e5) n += 1;
            return n;
        };
        world.onPieceLock({ type: 'L', x: 4 });
        expect(livePillars()).toBe(0);
        world.onHardDrop();
        world.onPieceLock({ type: 'L', x: 4 });
        expect(livePillars()).toBe(1);
        world.seek(0);
        expect(livePillars()).toBe(0);
        world.dispose();
    });

    it('lights a slit of the sun for each step of a chain and puts them out when it breaks', () => {
        const world = makeWorld();
        const clearingLock = () => {
            world.onPieceLock({ type: 'I', x: 2 });
            world.onLineClear(1);
        };
        clearingLock();
        runTo(world, world.time + 0.5);
        expect(world.u.slitFill.value).toBe(0);
        const fills = [];
        for (let n = 0; n < 4; n += 1) {
            clearingLock();
            runTo(world, world.time + 0.6);
            fills.push(world.u.slitFill.value);
        }
        for (let i = 1; i < fills.length; i += 1) expect(fills[i]).toBeGreaterThan(fills[i - 1] + 0.5);
        expect(fills[3]).toBeCloseTo(4, 0);
        // A lock that clears nothing breaks the chain.
        world.onPieceLock({ type: 'O', x: 6 });
        runTo(world, world.time + 3);
        expect(world.u.slitFill.value).toBe(0);
        world.dispose();
    });

    it('sets the sun at a run\'s end and raises it for the next run', () => {
        const world = makeWorld();
        const up = world.u.sunDir.value.y;
        world.onGameOver();
        runTo(world, world.time + 9);
        expect(world.u.night.value).toBeGreaterThan(0.95);
        // The whole disc is under the pass's floor.
        const elevation = Math.asin(world.u.sunDir.value.y);
        expect(elevation + SUN.radius).toBeLessThan(0.03);
        expect(world.getState().ended).toBe(true);
        // It stays down while nothing is played.
        runTo(world, world.time + 5);
        expect(world.u.night.value).toBeGreaterThan(0.95);

        world.onSessionStart();
        expect(world.u.ridgePulseCount.value + world.pulses.filter((p) => p.energy > 0).length).toBeGreaterThan(0);
        runTo(world, world.time + 6);
        expect(world.u.night.value).toBeLessThan(0.02);
        expect(world.u.sunDir.value.y).toBeCloseTo(up, 1);

        // A lock with the sun still down is the next run too; leaving the mode lifts it quietly.
        world.onGameOver();
        runTo(world, world.time + 2);
        world.onPieceLock({ type: 'T', x: 3 });
        expect(world.getState().ended).toBe(false);
        world.onGameOver();
        world.onSessionStop();
        expect(world.getState().ended).toBe(false);
        world.dispose();
    });

    it('keeps every layer inside its slots under a hot hand, and never a number that is not one', () => {
        const world = makeWorld({ happenings: true });
        const rand = seeded(11);
        for (let step = 0; step < 240; step += 1) {
            const r = rand();
            if (r < 0.5) {
                world.onHardDrop();
                world.onPieceLock({ type: 'TIOSZJL'[step % 7], x: step % 10, rotation: step % 4 });
            }
            if (r < 0.35) world.onLineClear(1 + (step % 4), { cascade: 1 + (step % 3) });
            if (r > 0.9) world.onCombo(2 + (step % 4));
            if (step % 17 === 0) world.onTwist(step % 3);
            if (step % 23 === 0) world.onB2B(true);
            if (step % 41 === 0) world.onPerfectClear();
            if (step % 53 === 0) world.onLevelUp();
            runTo(world, world.time + 0.12);
            const { u } = world;
            expect(u.shootCount.value).toBeLessThanOrEqual(SLOTS.shoots);
            expect(u.beamCount.value).toBeLessThanOrEqual(SLOTS.beams);
            expect(u.ridgePulseCount.value).toBeLessThanOrEqual(SLOTS.pulses);
            expect(u.racerCount.value).toBeLessThanOrEqual(SLOTS.racers);
            const numbers = [
                u.sunPulse.value, u.rays.value.x, u.rays.value.z, u.tri.value.z, u.twin.value.x, u.scan.value.x,
                u.slitFill.value, u.night.value, u.ridgeGain.value, u.scanGain.value, u.comboShift.value,
                ...u.gridNear.value.toArray(), ...u.sunDir.value.toArray(), ...u.planetDir.value.toArray(),
            ];
            for (const row of [...u.shoots.array, ...u.beams.array, ...u.ridgePulses.array, ...u.racers.array]) {
                numbers.push(row.x, row.y, row.z, row.w);
            }
            expect(numbers.every(Number.isFinite)).toBe(true);
            expect(u.rays.value.x).toBeLessThan(3);
        }
        world.dispose();
    });
});

describe('neon-dusk parts', () => {
    it('draws a ridgeline along each range\'s skyline, as the rest camera sees it', () => {
        const world = makeWorld();
        const { crests } = world.parts.mountains.userData;
        expect(crests.map((c) => c.range)).toEqual([0, 1, 2]);
        const ridges = world.parts.ridges.geometry;
        let points = 0;
        crests.forEach(({ range, points: p }) => {
            const n = p.length / 3;
            points += n;
            const R = RANGES[range];
            let high = 0;
            for (let i = 0; i < n; i += 1) {
                const reach = Math.hypot(p[i * 3] - RIG.x, p[i * 3 + 2] - RIG.z);
                // On the range's own band, never under the floor.
                expect(reach).toBeGreaterThanOrEqual(R.r0 - 1);
                expect(reach).toBeLessThanOrEqual(R.r1 + 1);
                expect(p[i * 3 + 1]).toBeGreaterThanOrEqual(-0.51);
                high = Math.max(high, p[i * 3 + 1]);
            }
            expect(high).toBeGreaterThan(R.peak * 0.3);
            // The pass: the skyline sinks where the sun sets (the middle column is azimuth 0).
            expect(p[Math.floor(n / 2) * 3 + 1]).toBeLessThan(high * 0.3);
        });
        // Two corners a point, each with its neighbours and its side.
        expect(ridges.attributes.position.count).toBe(points * 2);
        const info = ridges.attributes.aRidge.array;
        for (let i = 0; i < info.length; i += 8) {
            expect(info[i]).toBe(-1);
            expect(info[i + 4]).toBe(1);
        }
        expect([...ridges.attributes.position.array].every(Number.isFinite)).toBe(true);
        world.dispose();
    });

    it('ships a whole glider: a mirrored hull with its edges coded and its faces named', () => {
        expect(GLIDER_POSITION.length).toBe(GLIDER.corners * 3);
        expect(GLIDER_NORMAL.length).toBe(GLIDER.corners * 3);
        expect(GLIDER_EDGE.length).toBe(GLIDER.corners * 3);
        expect(GLIDER_KIND.length).toBe(GLIDER.corners);
        expect(GLIDER.corners % 3).toBe(0);
        // Mirrored: every corner's place has its twin on the other side of the keel.
        const key = (x, y, z) => `${x.toFixed(2)},${y.toFixed(2)},${(Math.abs(z) < 0.005 ? 0 : z).toFixed(2)}`;
        const places = new Set();
        for (let i = 0; i < GLIDER.corners; i += 1) {
            places.add(key(GLIDER_POSITION[i * 3], GLIDER_POSITION[i * 3 + 1], GLIDER_POSITION[i * 3 + 2]));
        }
        let nose = -Infinity;
        for (let i = 0; i < GLIDER.corners; i += 1) {
            const twin = key(GLIDER_POSITION[i * 3], GLIDER_POSITION[i * 3 + 1], -GLIDER_POSITION[i * 3 + 2]);
            expect(places.has(twin), twin).toBe(true);
            nose = Math.max(nose, GLIDER_POSITION[i * 3]);
            const n = Math.hypot(GLIDER_NORMAL[i * 3], GLIDER_NORMAL[i * 3 + 1], GLIDER_NORMAL[i * 3 + 2]);
            expect(n).toBeCloseTo(1, 2);
            // An edge code is 0 or 1; no corner sits on three drawn edges' far side at once.
            const e = [GLIDER_EDGE[i * 3], GLIDER_EDGE[i * 3 + 1], GLIDER_EDGE[i * 3 + 2]];
            expect(e.every((v) => v === 0 || v === 1)).toBe(true);
            expect(e.includes(1)).toBe(true);
            expect([0, 1, 2]).toContain(GLIDER_KIND[i]);
        }
        expect(nose).toBeGreaterThan(GLIDER.length * 0.45);
        // Some sides are drawn and some are not (a seam between flat faces, a diagonal).
        let drawn = 0;
        let hidden = 0;
        for (let t = 0; t < GLIDER.corners; t += 3) {
            for (let side = 0; side < 3; side += 1) {
                const codes = [0, 1, 2].map((k) => GLIDER_EDGE[(t + k) * 3 + side]);
                if (codes.every((v) => v === 1)) hidden += 1;
                else drawn += 1;
            }
        }
        expect(drawn).toBeGreaterThan(60);
        expect(hidden).toBeGreaterThan(10);
        expect(new Set(GLIDER_KIND).size).toBe(3);
    });

    it('flies five gliders out of the pass and over the lens, and parks them afterwards', () => {
        const world = makeWorld();
        const { flight } = world;
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        const sizeOf = (i) => {
            flight.hulls.getMatrixAt(i, m);
            return m.getMaxScaleOnAxis();
        };
        for (let i = 0; i < FLIGHT.count; i += 1) expect(sizeOf(i)).toBe(0);

        world.startHappening('flight', world.time, seeded(3));
        runTo(world, world.time + FLIGHT.duration * 0.3);
        const early = [];
        for (let i = 0; i < FLIGHT.count; i += 1) {
            expect(sizeOf(i)).toBeCloseTo(FLIGHT.scale, 3);
            flight.hulls.getMatrixAt(i, m);
            early.push(p.setFromMatrixPosition(m).clone());
        }
        // Far out in the pass, on the sun's bearing, above the glass.
        for (const at of early) {
            expect(at.z).toBeLessThan(RIG.z - 800);
            expect(Math.abs(at.x - RIG.x)).toBeLessThan(120);
            expect(at.y).toBeGreaterThan(40);
        }
        runTo(world, world.time + FLIGHT.duration * 0.6);
        for (let i = 0; i < FLIGHT.count; i += 1) {
            flight.hulls.getMatrixAt(i, m);
            p.setFromMatrixPosition(m);
            // Coming at the lens, high enough to pass over it.
            expect(p.z).toBeGreaterThan(early[i].z + 800);
            expect(p.y).toBeGreaterThan(RIG.height + 30);
        }
        runTo(world, world.time + FLIGHT.duration * 0.3);
        for (let i = 0; i < FLIGHT.count; i += 1) expect(sizeOf(i)).toBe(0);
        expect(flight.progress(world.time)).toBe(-1);
        world.dispose();
    });

    it('names the instruments\' shapes (they are what the captures were tuned on)', () => {
        expect(SHOW.triangle.turn).toBeCloseTo((Math.PI * 2) / 3, 6);
        // The triangle stands outside the disc: its inradius is over one sun radius.
        expect(SHOW.triangle.side / Math.sqrt(3)).toBeGreaterThan(1.05);
        // The whole disc goes under the horizon at a run's end.
        expect(SUN.elevation + SUN_DRIFT.reach - SHOW.sunset.drop + SUN.radius).toBeLessThan(0.03);
    });
});
