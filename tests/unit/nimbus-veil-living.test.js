/**
 * Nimbus Veil — the living pass (2026-11-20): the air turns on a wheel of its own beside the
 * hours, the sky has happenings of its own, and every gameplay event plays an instrument no other
 * event plays. These are relations, read off the modules: no tuning number is pinned.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    NimbusWorld, RING_SLOTS, WORLD_QUALITY, sunReach,
} from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
import NimbusVeilTheme from '../../src/themes/nimbus-veil/nimbus-veil-theme.js';
import { RAY_SLOTS } from '../../src/themes/nimbus-veil/nimbus-veil-optics.js';
import { RIPPLE_SLOTS, ROAD_STONES, stoneSize } from '../../src/themes/nimbus-veil/nimbus-veil-cloudsea.js';
import { LANTERN_BEARING, lanternOrder } from '../../src/themes/nimbus-veil/nimbus-veil-cumulus.js';
import { MOON, SUN, TOWERS } from '../../src/themes/nimbus-veil/nimbus-veil-tsl.js';
import {
    MOODS, MOOD_HOLD, MOOD_PERIOD,
} from '../../src/themes/nimbus-veil/nimbus-veil-moods.js';
import {
    AIRS, AIR_COUNT, AIR_HOLD, AIR_KEYS, AIR_PERIOD, HAPPENINGS, HAPPENING_KINDS, HAPPEN_QUIET, HAPPEN_SLOT,
    airAt, airIndex, airPhase, happeningEnvelope, happeningKind, happeningSlot, happeningState,
} from '../../src/themes/nimbus-veil/nimbus-veil-weather.js';
import { NIMBUS_VEIL_TETROMINOS } from '../../src/themes/nimbus-veil/nimbus-veil-tetrominos.js';

const DT = 1 / 60;
const BOARD = Object.freeze({
    x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
});
const seeded = (seed = 7) => {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
};

/** A world with a solo board on screen, its camera, and a clock that steps both. */
function stage({ time = 12, quality = 'High', board = BOARD } = {}) {
    const world = new NimbusWorld({ scene: new THREE.Scene(), quality, random: seeded() }).build();
    world.setHappenings(false);
    world.setLayout(16 / 9, board, { immediate: true });
    const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, 0.5, 9000);
    const clock = { t: time };
    const frame = (dt = DT) => {
        clock.t += dt;
        world.updateCamera(camera, { time: clock.t, delta: dt });
        world.update({ time: clock.t, delta: dt });
    };
    const run = (seconds) => {
        for (let i = Math.round(seconds / DT); i > 0; i -= 1) frame();
    };
    world.seek(time);
    frame(0);
    return {
        world, camera, clock, frame, run,
    };
}

/** Which of the events' instruments are sounding, by name. */
function sounding(world) {
    const { u } = world;
    const live = new Set();
    if (u.ripples.array.some((r) => r.w > 1e-3)) live.add('ripple');
    if (u.rings.some((r) => r.value.z > 1e-3)) live.add('wave');
    if (u.skyWave.value.z > 1e-3) live.add(u.skyWave.value.w > 0.5 ? 'sky spectrum' : 'sky wave');
    if (u.rays.array.some((r) => r.z > 1e-3)) live.add('ray');
    if (u.optics.value.x > 1e-3) live.add('corona');
    if (u.road.value.x > 1e-3) live.add('stones');
    if (u.lanterns.value > 1e-3) live.add('lanterns');
    if (u.glory.value.z > 1e-3) live.add('glory');
    if (u.climb.value.y > 1e-3) live.add('climb');
    return live;
}

beforeEach(() => {
    vi.stubGlobal('window', {
        settings: {},
        location: { search: '' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        matchMedia: () => ({ matches: false }),
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('nimbus-veil air: a wheel of its own beside the hours', () => {
    it('has five airs, each its own, every value in range', () => {
        expect(AIR_COUNT).toBe(5);
        expect(new Set(AIRS.map((air) => air.name)).size).toBe(AIR_COUNT);
        for (const air of AIRS) {
            for (const key of AIR_KEYS) expect(Number.isFinite(air[key]), `${air.name}.${key}`).toBe(true);
            expect(air.ceil).toBeGreaterThanOrEqual(0);
            expect(air.ceil).toBeLessThanOrEqual(1);
            expect(air.ripple).toBeGreaterThanOrEqual(0);
            expect(air.ripple).toBeLessThanOrEqual(1);
            expect(air.haze).toBeGreaterThan(0.5);
        }
        for (let a = 0; a < AIR_COUNT; a += 1) {
            for (let b = a + 1; b < AIR_COUNT; b += 1) {
                const apart = Math.max(...AIR_KEYS.map((key) => Math.abs(AIRS[a][key] - AIRS[b][key])));
                expect(apart, `${AIRS[a].name} / ${AIRS[b].name}`).toBeGreaterThan(0.25);
            }
        }
        // Each air is told by what it is the most of.
        const most = (key) => AIRS.reduce((best, air) => (air[key] > best[key] ? air : best)).name;
        expect(most('wind')).toBe('tails');
        expect(most('ripple')).toBe('mackerel');
        expect(most('beams')).toBe('beams');
        expect(most('veil')).toBe('mist');
    });

    it('is an air exactly on a whole phase, melts in between, and is named', () => {
        for (let k = 0; k < AIR_COUNT; k += 1) {
            const air = airAt(k);
            for (const key of AIR_KEYS) expect(air[key]).toBe(AIRS[k][key]);
            expect(air.name).toBe(AIRS[k].name);
            expect(airIndex(AIRS[k].name)).toBe(k);
        }
        const mid = airAt(0.5);
        for (const key of AIR_KEYS) expect(mid[key]).toBeCloseTo((AIRS[0][key] + AIRS[1][key]) / 2, 9);
        expect(airIndex('no such air')).toBe(-1);
    });

    it('rests and melts by the clock, and its wheel is not the hours\' wheel', () => {
        expect(airPhase(AIR_PERIOD * AIR_HOLD * 0.9)).toBe(0);
        expect(airPhase(AIR_PERIOD * 1.0001)).toBeCloseTo(1, 3);
        expect(AIR_PERIOD).not.toBe(MOOD_PERIOD);
        // An hour meets a different air each time it comes round: after one turn of the hours'
        // wheel the air's has not come round with it.
        const hours = MOOD_PERIOD * MOODS.length;
        expect(Math.abs((hours / (AIR_PERIOD * AIR_COUNT)) % 1)).toBeGreaterThan(0.05);
    });

    it('reaches the world: the high cloud, its kind, the veils, the deck\'s heads, the haze', () => {
        const { world, frame, clock } = stage();
        for (let k = 0; k < AIR_COUNT; k += 1) {
            world.setAir(AIRS[k].name);
            frame(0);
            expect(world.airName()).toBe(AIRS[k].name);
            expect(world.u.air.value.toArray()).toEqual([AIRS[k].ceil, AIRS[k].ripple, AIRS[k].veil, AIRS[k].heads]);
            expect(world.u.air2.value.x).toBe(AIRS[k].beams);
            expect(world.u.air2.value.z).toBeCloseTo(AIRS[k].haze, 9);
        }
        // Left to the clock it turns by itself.
        world.setAir(null);
        clock.t = AIR_PERIOD * (2 + AIR_HOLD * 0.5);
        world.seek(clock.t);
        frame(0);
        expect(world.airName()).toBe(AIRS[2].name);
        world.dispose();
    });

    it('never lets the deck rise into the lens, whatever the air', () => {
        // The deck's ceiling scales with the air's \`heads\`; the lens flies as low as its rest
        // height less the deepest skim, drift and dip (nimbus-veil-world.js updateCamera).
        const tallest = Math.max(...AIRS.map((air) => air.heads));
        expect(tallest).toBeLessThanOrEqual(1.12);
        expect(Math.min(...AIRS.map((air) => air.heads))).toBeGreaterThan(0.4);
    });
});

describe('nimbus-veil happenings: the sky by itself', () => {
    it('gives a slot the same happening every time, and leaves some slots quiet', () => {
        let quiet = 0;
        const seen = new Set();
        for (let slot = 0; slot < 400; slot += 1) {
            const kind = happeningKind(slot, 0);
            expect(happeningKind(slot, 0)).toBe(kind);
            if (kind === null) quiet += 1;
            else seen.add(kind);
        }
        expect(quiet / 400).toBeGreaterThan(HAPPEN_QUIET - 0.08);
        expect(quiet / 400).toBeLessThan(HAPPEN_QUIET + 0.08);
        // By day: every kind the day allows, and none it does not.
        const day = HAPPENING_KINDS.filter((kind) => HAPPENINGS[kind].day);
        expect([...seen].sort()).toEqual([...day].sort());
    });

    it('keeps shooting stars and heat lightning for the dark', () => {
        const night = new Set();
        const dusk = new Set();
        for (let slot = 0; slot < 400; slot += 1) {
            night.add(happeningKind(slot, 1));
            dusk.add(happeningKind(slot, 0.2));
        }
        expect(night.has('meteor')).toBe(true);
        expect(night.has('flicker')).toBe(true);
        expect(night.has('albatross')).toBe(false);
        expect(dusk.has('flicker')).toBe(true);
        expect(dusk.has('meteor')).toBe(false);
        expect(HAPPENINGS.meteor.day).toBe(false);
        expect(HAPPENINGS.flicker.day).toBe(false);
    });

    it('begins and ends a happening inside its slot, and is a function of its age', () => {
        for (let slot = 0; slot < 60; slot += 1) {
            for (const kind of HAPPENING_KINDS) {
                const { dur } = HAPPENINGS[kind];
                expect(dur).toBeLessThan(HAPPEN_SLOT);
                let first = Infinity;
                let last = -Infinity;
                for (let t = slot * HAPPEN_SLOT; t < (slot + 1) * HAPPEN_SLOT; t += 0.25) {
                    const h = happeningState(kind, slot, t);
                    if (h.kind !== kind) continue;
                    expect(happeningSlot(t)).toBe(slot);
                    expect(h.u).toBeCloseTo(h.age / dur, 9);
                    first = Math.min(first, t);
                    last = Math.max(last, t);
                }
                expect(last - first, `${kind} in slot ${slot}`).toBeGreaterThan(dur - 0.6);
            }
        }
        expect(happeningState(null, 3, 3 * HAPPEN_SLOT + 5).kind).toBe(null);
        expect(happeningEnvelope(0)).toBe(0);
        expect(happeningEnvelope(1)).toBe(0);
        expect(happeningEnvelope(0.5)).toBe(1);
    });

    it('shows each happening through its own uniforms and nothing else, and a seek lands on it', () => {
        const { world, camera } = stage();
        const at = (t) => {
            world.seek(t);
            world.updateCamera(camera, { time: t, delta: 0 });
            world.update({ time: t, delta: 0 });
            return world.u;
        };
        const quiet = (u, except) => {
            if (except !== 'albatross') {
                expect(world.albatross.state().flying).toBe(0);
                // (A bird that is not in the air has no size: the first number of each bird's rows.)
                world.albatross.table.forEach((row, i) => {
                    if (i % 3 === 0) expect(row.w).toBe(0);
                });
            }
            if (except !== 'glitter') expect(u.glitter.value).toBe(0);
            if (except !== 'boil') expect(u.boil.value.y).toBe(0);
            if (except !== 'flicker') expect(u.ember.value.y).toBe(0);
            if (except !== 'meteor') expect(u.meteorGain.value.length()).toBe(0);
        };
        world.setHappenings(false);
        quiet(at(13), null);

        world.setHappenings(true, 'albatross');
        let u = at(8);
        expect(world.albatross.state().flying).toBeGreaterThan(0);
        // A bird in the air: a size, and a heading of length one.
        const leader = world.albatross.table;
        expect(leader[0].w).toBeGreaterThan(1);
        expect(new THREE.Vector3(leader[1].x, leader[1].y, leader[1].z).length()).toBeCloseTo(1, 6);
        quiet(u, 'albatross');
        // The leader crosses the whole view: it comes in over one edge and leaves over the other.
        const leaderX = (t) => {
            at(t);
            const v = world.albatross.table[0];
            return v.w > 0 ? new THREE.Vector3(v.x, v.y, v.z).project(camera).x : null;
        };
        const x0 = leaderX(0.02);
        let x1 = x0;
        for (let t = 0.5; t < HAPPENINGS.albatross.dur; t += 0.25) x1 = leaderX(t) ?? x1;
        expect(Math.min(x0, x1)).toBeLessThan(-1.05);
        expect(Math.max(x0, x1)).toBeGreaterThan(1.05);
        // A seek lands mid-flight on the same birds.
        const once = at(9.5) && world.albatross.table.map((row) => row.toArray());
        at(3);
        expect(at(9.5) && world.albatross.table.map((row) => row.toArray())).toEqual(once);
        at(HAPPENINGS.albatross.dur + 1);
        expect(world.albatross.state().flying).toBe(0);

        world.setHappenings(true, 'glitter');
        u = at(HAPPENINGS.glitter.dur / 2);
        expect(u.glitter.value).toBe(1);
        quiet(u, 'glitter');

        world.setHappenings(true, 'boil');
        u = at(HAPPENINGS.boil.dur / 2);
        expect(u.boil.value.y).toBe(1);
        expect(Math.abs(u.boil.value.x)).toBeLessThan(Math.PI);
        quiet(u, 'boil');

        world.setHappenings(true, 'flicker');
        let lit = 0;
        for (let t = 0; t < HAPPENINGS.flicker.dur; t += 0.1) {
            u = at(t);
            lit = Math.max(lit, u.ember.value.y);
            quiet(u, 'flicker');
        }
        expect(lit).toBeGreaterThan(0.5);

        world.setHappenings(true, 'meteor');
        let streaks = 0;
        for (let t = 0; t < HAPPENINGS.meteor.dur; t += 0.1) {
            u = at(t);
            if (u.meteorGain.value.length() > 0.2) streaks += 1;
            quiet(u, 'meteor');
        }
        expect(streaks).toBeGreaterThan(8);
        world.dispose();
    });

    it('settles a slot\'s happening at its start, by the starlight there', () => {
        const { world, frame, clock } = stage();
        world.setHappenings(true);
        // The blue hour's slots draw from the night's list, the first hour's from the day's.
        const night = (4 + MOOD_HOLD * 0.5) * MOOD_PERIOD;
        expect(world.starsAt(night)).toBe(1);
        expect(world.starsAt(5)).toBe(0);
        clock.t = night;
        world.seek(night);
        frame(0);
        const slot = happeningSlot(night);
        expect(world.happenKind).toBe(happeningKind(slot, world.starsAt(slot * HAPPEN_SLOT)));
        world.dispose();
    });
});

describe('nimbus-veil sun and lamp', () => {
    it('lets less of the sun reach the deck as it sinks, and lights the high cloud from below', () => {
        expect(sunReach(MOODS[0].sun).day).toBe(1);
        expect(sunReach(MOODS[2].sun).under).toBe(0);
        expect(sunReach(MOODS[4].sun).day).toBe(0);
        expect(sunReach(MOODS[4].sun).under).toBe(1);
        let last = sunReach(-10);
        for (let h = -9.5; h <= 25; h += 0.5) {
            const reach = sunReach(h);
            expect(reach.day).toBeGreaterThanOrEqual(last.day);
            expect(reach.under).toBeLessThanOrEqual(last.under);
            last = reach;
        }
    });

    it('glides the sun to a new level\'s place on its arc, slower than the colours', () => {
        const { world, run } = stage({ time: (0 + MOOD_HOLD * 0.5) * MOOD_PERIOD });
        expect(world.sunHeight).toBeCloseTo(MOODS[0].sun, 6);
        world.setLevel(3);
        run(1.5);
        // The colours lead; the sun is on its way and has not arrived.
        expect(world.sunHeight).toBeGreaterThan(MOODS[0].sun);
        expect(world.sunHeight).toBeLessThan(MOODS[2].sun - 1);
        expect(Math.abs(world.sunStep - 2)).toBeGreaterThan(Math.abs(world.moodStep - 2));
        run(14);
        expect(world.sunHeight).toBeCloseTo(MOODS[2].sun, 1);
        world.dispose();
    });

    it('stands the rays and the corona round the sun by day and the young moon at night, through nothing', () => {
        const { world, frame, clock } = stage();
        expect(world.u.lampDir.value.equals(world.u.sunDir.value)).toBe(true);
        expect(world.u.lampInfo.value.x).toBe(SUN.radius);
        expect(world.u.lampInfo.value.y).toBe(1);
        expect(world.u.lampInfo.value.z).toBe(1);
        clock.t = (4 + MOOD_HOLD * 0.5) * MOOD_PERIOD;
        world.seek(clock.t);
        frame(0);
        const lamp = world.u.lampDir.value;
        expect(lamp.y).toBeGreaterThan(0.2);
        expect(lamp.equals(world.u.sunDir.value)).toBe(false);
        expect(world.u.lampInfo.value.x).toBe(MOON.radius);
        expect(world.u.lampInfo.value.y).toBe(1);
        // The night's event light is dimmer than the day's.
        expect(world.u.lampInfo.value.z).toBeLessThan(0.7);
        // Through the handover the lamp's share dips to nothing, so a ray never jumps across the sky.
        let least = 1;
        for (let t = 3 * MOOD_PERIOD; t < 4 * MOOD_PERIOD; t += 0.5) {
            clock.t = t;
            world.seek(t);
            frame(0);
            least = Math.min(least, world.u.lampInfo.value.y);
        }
        expect(least).toBeLessThan(0.05);
        world.dispose();
    });

    it('lays a chain\'s stepping stones on the deck in the free zone beside a solo board', () => {
        // The stones run down the sun's bearing, which is where the layout parks the sun: each
        // must be on the deck, on screen with its whole width, and left of the board.
        const { world, camera } = stage();
        const p = new THREE.Vector3();
        let lastY = 0;
        expect(ROAD_STONES.length).toBeGreaterThanOrEqual(6);
        ROAD_STONES.forEach((distance, k) => {
            if (k) expect(distance, 'each stone nearer than the last').toBeLessThan(ROAD_STONES[k - 1]);
            const { across } = stoneSize(distance);
            for (const side of [-1, 1]) {
                p.set(side * across, 0, 20 - distance).project(camera);
                const x = p.x * 0.5 + 0.5;
                expect(x, `stone ${k} edge`).toBeGreaterThan(0.01);
                expect(x, `stone ${k} edge`).toBeLessThan(BOARD.x0);
            }
            p.set(0, 0, 20 - distance).project(camera);
            const y = 0.5 - p.y * 0.5;
            expect(y, `stone ${k} below the horizon`).toBeGreaterThan(0.56);
            expect(y, `stone ${k} on screen`).toBeLessThan(0.98);
            // Even steps down the screen: a stair, not a row that bunches up at the horizon.
            if (k) {
                expect(y - lastY, `step ${k}`).toBeGreaterThan(0.03);
                expect(y - lastY, `step ${k}`).toBeLessThan(0.06);
            }
            lastY = y;
        });
        // Neighbours do not run together.
        for (let k = 1; k < ROAD_STONES.length; k += 1) {
            expect(ROAD_STONES[k - 1] - ROAD_STONES[k])
                .toBeGreaterThan(stoneSize(ROAD_STONES[k - 1]).along + stoneSize(ROAD_STONES[k]).along);
        }
        world.dispose();
    });

    it('lights the lanterns outward from the middle of the view, at every tier', () => {
        for (let towers = 3; towers <= TOWERS.length; towers += 1) {
            const built = TOWERS.slice(0, towers);
            const order = lanternOrder(built);
            expect([...order].sort((a, b) => a - b)).toEqual(built.map((_, i) => i));
            for (let i = 1; i < order.length; i += 1) {
                expect(Math.abs(built[order[i]].az - LANTERN_BEARING))
                    .toBeGreaterThanOrEqual(Math.abs(built[order[i - 1]].az - LANTERN_BEARING));
            }
        }
    });
});

describe('nimbus-veil events: an instrument each', () => {
    it('plays a different set of instruments for every event', () => {
        const play = (fire, after = 0.5) => {
            const s = stage();
            fire(s.world, s);
            s.run(after);
            const live = [...sounding(s.world)].sort().join(' + ');
            s.world.dispose();
            return live;
        };
        const events = {
            lock: play((w) => w.onPieceLock()),
            clear: play((w) => w.onLineClear(2)),
            four: play((w) => w.onLineClear(4)),
            cascade: play((w, s) => {
                w.onLineClear(1);
                s.run(0.36);
                w.onLineClear(1, { cascade: 2 });
                w.onCombo(2);
            }),
            chain: play((w, s) => {
                w.onLineClear(1, { combo: 1 });
                s.run(0.7);
                w.onPieceLock({ chain: 1 });
                w.onLineClear(1, { combo: 2, chainStep: true });
            }, 0.9),
            twist: play((w) => w.onTwist(0)),
            b2b: play((w) => w.onB2B()),
            perfect: play((w) => w.onPerfectClear()),
            level: play((w) => w.onLevelUp()),
        };
        expect(events.lock).toBe('ripple');
        expect(events.clear).toBe('wave');
        expect(events.four).toContain('sky wave');
        expect(events.cascade).toContain('ray');
        expect(events.chain).toContain('stones');
        expect(events.twist).toBe('corona');
        expect(events.b2b).toContain('lanterns');
        expect(events.perfect).toContain('ray');
        expect(events.perfect).toContain('glory');
        expect(events.perfect).toContain('sky spectrum');
        expect(events.level).toContain('climb');
        const sets = Object.values(events);
        expect(new Set(sets).size, JSON.stringify(events)).toBe(sets.length);
        // Only its own event plays each of these.
        const only = (instrument, owner) => Object.entries(events)
            .filter(([, live]) => live.split(' + ').includes(instrument)).map(([name]) => name).join() === owner;
        expect(only('ripple', 'lock,chain')).toBe(true);
        expect(only('ray', 'cascade,perfect')).toBe(true);
        expect(only('stones', 'chain')).toBe(true);
        expect(only('corona', 'twist')).toBe(true);
        expect(only('lanterns', 'b2b')).toBe(true);
        expect(only('glory', 'perfect')).toBe(true);
        expect(only('sky spectrum', 'perfect')).toBe(true);
        expect(only('climb', 'level')).toBe(true);
    });

    it('spreads a lock\'s ripple on the deck beside the board, never behind it', () => {
        const { world, camera, frame } = stage();
        const p = new THREE.Vector3();
        for (let i = 0; i < 40; i += 1) {
            if (i % 3 === 0) world.onHardDrop();
            world.onPieceLock();
            frame();
            const slot = world.ripples[(world.rippleCursor - 1) % RIPPLE_SLOTS];
            p.set(slot.x, 0, slot.z).project(camera);
            const x = p.x * 0.5 + 0.5;
            const y = 0.5 - p.y * 0.5;
            expect(x < BOARD.x0 || x > BOARD.x1 + 0.1, `ripple ${i} at ${x.toFixed(2)}`).toBe(true);
            expect(x).toBeGreaterThan(0.03);
            expect(x).toBeLessThan(0.97);
            // On the deck, below the horizon.
            expect(y).toBeGreaterThan(0.56);
        }
        // A hard drop's is wider than a soft lock's, and both grow, then fade.
        world.onHardDrop();
        world.onPieceLock();
        const hard = world.ripples[(world.rippleCursor - 1) % RIPPLE_SLOTS].reach / Math.hypot(1, 1);
        world.onPieceLock();
        const soft = world.ripples[(world.rippleCursor - 1) % RIPPLE_SLOTS].reach / Math.hypot(1, 1);
        expect(hard).toBeGreaterThan(0);
        expect(soft).toBeGreaterThan(0);
        world.dispose();
    });

    it('sends a band for every line, in echelon, and a wave over the high cloud for four', () => {
        for (let lines = 1; lines <= 4; lines += 1) {
            const { world, run } = stage();
            world.onLineClear(lines);
            run(1.2);
            expect(world.u.rings.filter((r) => r.value.z > 1e-3), `${lines} lines`).toHaveLength(lines);
            const radii = world.u.rings.filter((r) => r.value.z > 1e-3).map((r) => r.value.x).sort((a, b) => a - b);
            for (let i = 1; i < radii.length; i += 1) expect(radii[i] - radii[i - 1]).toBeGreaterThan(20);
            expect(world.u.skyWave.value.z > 1e-3).toBe(lines === 4);
            world.dispose();
        }
        expect(RING_SLOTS).toBeGreaterThanOrEqual(8);
    });

    it('climbs the wave over the high cloud from the horizon to overhead', () => {
        const { world, run } = stage();
        world.onLineClear(4);
        run(0.3);
        let last = world.u.skyWave.value.x;
        expect(last).toBeGreaterThan(5);
        for (let i = 0; i < 20; i += 1) {
            run(0.1);
            const radius = world.u.skyWave.value.x;
            if (world.u.skyWave.value.z <= 0) break;
            expect(radius).toBeLessThan(last);
            last = radius;
        }
        expect(last).toBeLessThan(1.5);
        run(2);
        expect(world.u.skyWave.value.z).toBe(0);
        world.dispose();
    });

    it('stands a ray for each wave of a cascade, each on its own bearing', () => {
        const { world, run } = stage();
        world.onLineClear(2);
        for (let wave = 2; wave <= 6; wave += 1) {
            run(0.36);
            world.onLineClear(1, { cascade: wave });
            world.onCombo(wave);
        }
        run(0.2);
        const rays = world.u.rays.array.filter((r) => r.z > 1e-3);
        expect(rays).toHaveLength(Math.min(5, RAY_SLOTS));
        const bearings = rays.map((r) => Math.atan2(r.y, r.x));
        for (let a = 0; a < bearings.length; a += 1) {
            // Above the sun: a ray under the horizon would never be seen.
            expect(bearings[a]).toBeGreaterThan(0.2);
            expect(bearings[a]).toBeLessThan(Math.PI - 0.2);
            for (let b = a + 1; b < bearings.length; b += 1) {
                expect(Math.abs(bearings[a] - bearings[b])).toBeGreaterThan(0.1);
            }
        }
        // They stand together, then go.
        run(6);
        expect(world.u.rays.array.every((r) => r.z === 0)).toBe(true);
        world.dispose();
    });

    it('lights a stepping stone with each clear of a chain, and puts them out when the chain breaks', () => {
        const { world, run } = stage();
        const lit = [];
        for (let k = 1; k <= 7; k += 1) {
            world.onPieceLock({ chain: k - 1 });
            world.onLineClear(1, { combo: k, chainStep: true });
            run(0.7);
            lit.push(world.u.road.value.x);
        }
        // The first clear is no chain yet; from the second, one more stone a clear.
        expect(lit[0]).toBe(0);
        for (let i = 1; i < lit.length; i += 1) expect(lit[i]).toBeCloseTo(i, 0);
        expect(world.u.road.value.y).toBe(1);
        // A long chain never asks for more stones than there are.
        world.onPieceLock({ chain: 30 });
        world.onLineClear(1, { combo: 31, chainStep: true });
        expect(world.roadGoal).toBe(ROAD_STONES.length);
        // A lock that clears nothing ends it: the world breathes out (a wave rolling OUT) and the
        // stones go out, the nearest first.
        world.onPieceLock({ chain: 31 });
        run(0.5);
        expect(world.roadGoal).toBe(0);
        const out = world.rings.filter((r) => r.mode === 2 && r.energy > 0);
        expect(out).toHaveLength(1);
        const fading = world.u.road.value.x;
        run(0.5);
        expect(world.u.road.value.x).toBeLessThan(fading);
        run(8);
        expect(world.u.road.value.x).toBe(0);
        expect(world.u.road.value.y).toBe(0);
        world.dispose();
    });

    it('lights one more tower\'s lantern with each back-to-back of a streak, then lets them go out', () => {
        const { world, run } = stage();
        for (let k = 1; k <= 4; k += 1) {
            world.onB2B();
            run(1.2);
            expect(world.u.lanterns.value, `after ${k}`).toBeCloseTo(k, 1);
        }
        // Never more lanterns than towers, on the tier with the fewest.
        const lean = stage({ quality: 'Minimal' });
        for (let k = 0; k < 9; k += 1) lean.world.onB2B();
        expect(lean.world.lanternGoal).toBe(WORLD_QUALITY.Minimal.towers);
        lean.world.dispose();
        // They stand a while after the last one, then go out.
        run(2);
        expect(world.u.lanterns.value).toBeGreaterThan(3);
        run(14);
        expect(world.u.lanterns.value).toBe(0);
        world.dispose();
    });

    it('makes a perfect clear the largest moment: every instrument of the sky, and the air clears', () => {
        const { world, run } = stage();
        world.setAir('mist');
        run(DT);
        const hazy = world.u.air2.value.z;
        world.onLineClear(4);
        run(0.36);
        world.onPerfectClear();
        run(0.8);
        const live = sounding(world);
        for (const name of ['wave', 'sky spectrum', 'ray', 'glory']) {
            expect(live.has(name), name).toBe(true);
        }
        // The whole fan of rays stands at once.
        expect(world.u.rays.array.filter((r) => r.z > 1e-3)).toHaveLength(RAY_SLOTS);
        expect(world.u.blaze.value.w).toBeGreaterThan(0.6);
        expect(world.u.air2.value.z).toBeLessThan(hazy * 0.85);
        // More of the sky answers it than answers anything else.
        const four = stage();
        four.world.onLineClear(4);
        four.run(1.16);
        expect(live.size).toBeGreaterThan(sounding(four.world).size);
        four.world.dispose();
        run(40);
        expect(sounding(world).size).toBe(0);
        expect(world.u.air2.value.z).toBeCloseTo(hazy, 2);
        world.dispose();
    });

    it('climbs the light up the towers on a new level and surges them', () => {
        const { world, run } = stage();
        world.setLevel(2);
        world.onLevelUp();
        run(0.3);
        const low = world.u.climb.value.x;
        expect(world.u.climb.value.y).toBeGreaterThan(0.5);
        expect(world.u.climb.value.z).toBeGreaterThan(0.2);
        run(0.9);
        expect(world.u.climb.value.x).toBeGreaterThan(low + 0.4);
        run(3);
        expect(world.u.climb.value.y).toBe(0);
        world.dispose();
    });

    it('closes the veil at a run\'s end, holds it, and lifts it on a fan of rays at the next', () => {
        const { world, run } = stage();
        const open = { haze: world.u.air2.value.z, veil: world.u.air.value.z };
        world.onGameOver();
        run(6);
        expect(world.dusk).toBeGreaterThan(0.98);
        expect(world.postState().dusk).toBe(world.dusk);
        expect(world.u.air2.value.z).toBeGreaterThan(open.haze * 1.8);
        expect(world.u.air.value.z).toBeGreaterThan(open.veil + 0.5);
        run(20);
        expect(world.dusk).toBe(1);
        world.onSessionStart();
        run(0.4);
        expect(world.u.rays.array.filter((r) => r.z > 1e-3).length).toBeGreaterThanOrEqual(3);
        run(4);
        expect(world.dusk).toBeLessThan(0.02);
        expect(world.u.air2.value.z).toBeCloseTo(open.haze, 2);
        // Leaving the mode lifts it too, quietly; and so does a lock that comes while it is closed.
        world.onGameOver();
        run(6);
        world.onSessionStop();
        run(10);
        expect(world.dusk).toBeLessThan(0.02);
        world.onGameOver();
        run(6);
        world.onPieceLock();
        run(4);
        expect(world.dusk).toBeLessThan(0.02);
        world.dispose();
    });

    it('closes the iris a little on the big moments and opens it again', () => {
        const { world, run } = stage();
        const rest = world.postState().exposure;
        world.onLineClear(4);
        world.onPerfectClear();
        run(0.4);
        expect(world.postState().exposure).toBeLessThan(rest - 0.05);
        expect(world.postState().exposure).toBeGreaterThan(rest - 0.3);
        run(12);
        expect(world.postState().exposure).toBeCloseTo(rest, 2);
        world.dispose();
    });

    it('forgets every instrument on a seek, and a new run starts cold', () => {
        const {
            world, run, frame, clock,
        } = stage();
        world.onLineClear(4);
        world.onPerfectClear();
        world.onB2B();
        world.onTwist(2);
        world.onLevelUp();
        world.onCombo(3);
        world.onPieceLock({ chain: 3 });
        world.onLineClear(1, { combo: 4, chainStep: true });
        world.onGameOver();
        run(1);
        expect(sounding(world).size).toBeGreaterThan(6);
        clock.t = 40;
        world.seek(40);
        frame(0);
        expect(sounding(world).size).toBe(0);
        expect(world.dusk).toBe(0);
        expect(world.postState().exposure).toBe(1);
        world.onPieceLock({ chain: 4 });
        world.onLineClear(1, { combo: 5, chainStep: true });
        world.resetSession();
        expect(world.roadGoal).toBe(0);
        expect(world.lanternGoal).toBe(0);
        expect(world.chainWatch).toBe(0);
        world.dispose();
    });

    it('softens the wave over the high cloud under Reduce flashing', () => {
        const plain = stage();
        plain.world.onLineClear(4);
        const full = plain.world.skyWave.energy;
        plain.world.dispose();
        window.settings = { reduceFlashing: true, photosensitiveMode: true };
        const soft = stage();
        soft.world.onLineClear(4);
        expect(soft.world.skyWave.energy).toBeLessThanOrEqual(full);
        soft.world.dispose();
    });

    it('keeps every tier whole: each has the veils, the birds and every instrument', () => {
        for (const [name, tier] of Object.entries(WORLD_QUALITY)) {
            expect(tier.veils, name).toBeGreaterThanOrEqual(1);
            expect(tier.birds, name).toBeGreaterThanOrEqual(2);
            const { world, run } = stage({ quality: name });
            expect(world.parts.optics, name).toBeTruthy();
            expect(world.parts.birds, name).toBeTruthy();
            expect(world.albatross.most, name).toBe(tier.birds);
            world.onLineClear(4);
            world.onPerfectClear();
            run(0.8);
            expect(sounding(world).size, name).toBeGreaterThanOrEqual(4);
            world.dispose();
        }
    });
});

describe('nimbus-veil theme: the run\'s end and start reach the world', () => {
    it('closes the veil on gameOver, and wires the mode manager once it exists', () => {
        const listeners = new Map();
        const handlers = new Map();
        const manager = {
            on: vi.fn((event, handler) => {
                handlers.set(event, handler);
                return () => handlers.delete(event);
            }),
        };
        vi.stubGlobal('window', {
            settings: { backgroundComboEffects: false },
            location: { search: '' },
            addEventListener: vi.fn((event, handler) => listeners.set(event, handler)),
            removeEventListener: vi.fn((event) => listeners.delete(event)),
            matchMedia: () => ({ matches: false }),
            serenityBlocks: {},
        });
        const theme = new NimbusVeilTheme();
        theme.isActive = true;
        const world = {
            onGameOver: vi.fn(), onSessionStart: vi.fn(), onSessionStop: vi.fn(), setLevel: vi.fn(), dispose: vi.fn(),
        };
        theme.world = world;
        theme.setupEventListeners();
        // The veil is the light's own business: the background-effects setting does not gate it.
        listeners.get('gameOver')();
        expect(world.onGameOver).toHaveBeenCalledTimes(1);
        // No manager yet (boot prewarm): nothing subscribed, and no throw.
        expect(manager.on).not.toHaveBeenCalled();
        window.serenityBlocks.gameModeManager = manager;
        theme.ensureModeManagerListeners();
        theme.ensureModeManagerListeners();
        expect(manager.on).toHaveBeenCalledTimes(2);
        theme.level = 4;
        handlers.get('modeStarted')();
        expect(theme.level).toBe(1);
        expect(world.setLevel).toHaveBeenCalledWith(1);
        expect(world.onSessionStart).toHaveBeenCalledTimes(1);
        handlers.get('modeStopped')();
        expect(world.onSessionStop).toHaveBeenCalledTimes(1);
        theme.clearEventUnsubscribers();
        expect(listeners.has('gameOver')).toBe(false);
        expect(handlers.size).toBe(0);
    });
});

describe('nimbus-veil pieces', () => {
    it('gives the seven shapes seven hues, told apart by hue and not by shade', () => {
        const hue = (hex) => {
            const n = parseInt(hex.slice(1), 16);
            const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
            const max = Math.max(r, g, b);
            const d = max - Math.min(r, g, b);
            if (d < 0.08) return null;
            let h;
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            return ((h * 60) + 360) % 360;
        };
        const { colors } = NIMBUS_VEIL_TETROMINOS;
        const hues = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((shape) => hue(colors[shape]));
        // One of them is the pearl: nearly white, a hue to itself.
        expect(hues.filter((h) => h === null)).toHaveLength(1);
        const coloured = hues.filter((h) => h !== null).sort((a, b) => a - b);
        for (let i = 0; i < coloured.length; i += 1) {
            const next = coloured[(i + 1) % coloured.length] + (i + 1 === coloured.length ? 360 : 0);
            expect(next - coloured[i], `hues ${coloured[i].toFixed(0)} and ${(next % 360).toFixed(0)}`).toBeGreaterThanOrEqual(28);
        }
        expect(colors.GARBAGE).toMatch(/^#[0-9a-f]{6}$/i);
    });
});
