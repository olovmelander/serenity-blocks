/**
 * Sunbraid — the living valley (2026-11-17): the weather wheel and the moon (three-free), the
 * pulses of light in the crust, and what each gameplay event writes on the valley beside the
 * braid's own answer. Run without a renderer, as tests/unit/sunbraid-world.test.js does.
 *
 * The look is free to change: what is held are relations (a weather is itself while it rests, an
 * eclipse takes one sun's light and leaves the others, a lock's tiles light beside the board and
 * never under it, the colour comes back behind a front, nothing is created at the moment of an
 * event).
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SUNBRAID_PARTS, SunbraidWorld, VALLEY_EVENTS, fovForAspect,
} from '../../src/themes/sunbraid/sunbraid-world.js';
import {
    MOON, WEATHERS, WEATHER_HOLD, WEATHER_NAMES, WEATHER_SECONDS, angleBetween, discCover, moonAt, moonSeen,
    weatherAt, weatherIndex,
} from '../../src/themes/sunbraid/sunbraid-weather.js';
import { PulseTable, pulseAt } from '../../src/themes/sunbraid/sunbraid-pulses.js';
import { MAX_PULSES } from '../../src/themes/sunbraid/sunbraid-tsl.js';
import {
    BRAID, DEG, PIECE_COLORS, hexToLinear,
} from '../../src/themes/sunbraid/sunbraid-core.js';
import { BRAID_EVENTS } from '../../src/themes/sunbraid/sunbraid-braid.js';
import { cardUnion, outsideKeepOut } from '../../src/themes/sunbraid/sunbraid-composition.js';
import { TWISTER } from '../../src/themes/sunbraid/sunbraid-dust.js';
import { MAX_GLIDERS, WHEEL, wheelAt } from '../../src/themes/sunbraid/sunbraid-glide.js';
import { EYE_ALTITUDE } from '../../src/themes/sunbraid/sunbraid-plan.js';

vi.setConfig({ testTimeout: 60_000 });

const START = 10;
const sim = (time, delta) => ({
    time, delta, pointerX: 0, pointerY: 0,
});

describe('the weather wheel', () => {
    const KEYS = ['cirrus', 'banks', 'veil', 'rain', 'wet', 'wind', 'haze', 'shade'];

    it('names seven weathers, the clear day first, each with every number', () => {
        expect(WEATHER_NAMES).toEqual(['clear', 'cirrus', 'veil', 'banks', 'rain', 'wet', 'wind']);
        expect(new Set(WEATHER_NAMES).size).toBe(WEATHERS.length);
        for (const w of WEATHERS) {
            for (const key of KEYS) expect(Number.isFinite(w[key]), `${w.name}.${key}`).toBe(true);
            expect(w.haze).toBeGreaterThan(0.5);
            expect(w.shade).toBeLessThan(0.7);
        }
        // The film of water follows the shower and is gone by the clear day.
        expect(WEATHERS[weatherIndex('wet')].wet).toBeGreaterThan(WEATHERS[weatherIndex('rain')].wet);
        expect(WEATHERS[0].wet).toBe(0);
        expect(weatherIndex('banks')).toBe(3);
        expect(weatherIndex(5)).toBe(5);
        expect(weatherIndex('fog')).toBe(-1);
        expect(weatherIndex(null)).toBe(-1);
    });

    it('rests on a weather, melts into the next and comes round again', () => {
        // The clock opens on the clear day and holds it for the rest.
        for (const t of [0, 1, WEATHER_SECONDS * WEATHER_HOLD * 0.9]) {
            const w = weatherAt(t);
            for (const key of KEYS) expect(w[key], `${key} at ${t}`).toBe(WEATHERS[0][key]);
        }
        // Every weather shows pure in a turn of the wheel, in order.
        WEATHERS.forEach((weather, i) => {
            const w = weatherAt(i * WEATHER_SECONDS + 1);
            expect(w.a).toBe(i);
            expect(w.wet).toBe(weather.wet);
        });
        const turn = WEATHERS.length * WEATHER_SECONDS;
        expect(weatherAt(turn + 30)).toEqual(weatherAt(30));
        // It never jumps: a tenth of a second moves no number by more than a few hundredths.
        for (let t = 0; t < turn; t += 0.73) {
            const a = { ...weatherAt(t) };
            const b = weatherAt(t + 0.1);
            for (const key of KEYS) expect(Math.abs(b[key] - a[key]), `${key} at ${t}`).toBeLessThan(0.03);
        }
    });

    it('holds a weather for a capture', () => {
        const held = weatherAt(1234.5, 5);
        for (const key of KEYS) expect(held[key]).toBe(WEATHERS[5][key]);
        expect(held.melt).toBe(0);
        // A nonsense hold is the clock's.
        expect(weatherAt(3, 99)).toEqual(weatherAt(3));
    });
});

describe('the moon', () => {
    it('covers a disc by the lens the two circles share', () => {
        expect(discCover(1, 0.2, 0.3)).toBe(0);
        expect(discCover(0, 0.2, 0.3)).toBe(1);
        // A smaller moon dead centre hides its own area's share.
        expect(discCover(0, 0.4, 0.2)).toBeCloseTo(0.25, 12);
        let last = 1;
        for (let sep = 0.1; sep <= 0.5; sep += 0.02) {
            const c = discCover(sep, 0.2, 0.3);
            expect(c).toBeLessThanOrEqual(last + 1e-12);
            expect(c).toBeGreaterThanOrEqual(0);
            last = c;
        }
        expect(discCover(0.3, 0.2, 0.3)).toBeGreaterThan(0.1);
        expect(discCover(0.3, 0.2, 0.3)).toBeLessThan(0.9);
        expect(discCover(0.1, 0, 0.3)).toBe(0);
    });

    it('crosses the triple star at the middle of each pass, on a path of its own', () => {
        const caz = BRAID.azimuth * DEG;
        const cel = BRAID.elevation * DEG;
        const offsets = new Set();
        for (let pass = 0; pass < 10; pass++) {
            const mid = moonAt((pass + 0.5) * MOON.period, caz, cel);
            expect(mid.pass).toBe(pass);
            expect(mid.az).toBeCloseTo(caz, 9);
            expect(Math.abs(mid.el - cel)).toBeLessThanOrEqual(MOON.reach + 1e-9);
            offsets.add(Math.round((mid.el - cel) * 1e4));
            // It enters from one side of the sky and leaves by the other.
            const enter = moonAt((pass + 0.01) * MOON.period, caz, cel).az;
            const leave = moonAt((pass + 0.99) * MOON.period, caz, cel).az;
            expect(leave - enter).toBeGreaterThan(MOON.span * 0.9);
        }
        expect(offsets.size).toBeGreaterThan(5);
        // It is larger than every sun's disc (a sun it crosses is hidden whole).
        expect(MOON.radius).toBeGreaterThan(1.45 * DEG);
        expect(moonSeen(0)).toBe(0);
        expect(moonSeen(0.5)).toBe(1);
        expect(moonSeen(1)).toBe(0);
        expect(angleBetween(0.3, 0.1, 0.3, 0.1)).toBeCloseTo(0, 6);
        expect(angleBetween(0, 0, Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 9);
    });
});

describe('the pulses of light in the crust', () => {
    const rowsFor = (n) => Array.from({ length: n * 2 }, (_, i) => (
        i % 2 ? new THREE.Vector4(0, 0, 0, 0) : new THREE.Vector4(0, 0, -1e5, 1)));

    it('grows a ring in closed form and lets its light rise and fall away', () => {
        const pulse = {
            radius: 10, speed: 100, gather: -20, width: 12, widen: 4, life: 2, rise: 0.1, gain: 1.5,
        };
        expect(pulseAt(pulse, 0).radius).toBe(10);
        expect(pulseAt(pulse, 1).radius).toBe(10 + 100 - 20);
        expect(pulseAt(pulse, 1).width).toBe(16);
        expect(pulseAt(pulse, -0.1).level).toBe(0);
        expect(pulseAt(pulse, 0.5).level).toBeCloseTo(1.5, 9);
        expect(pulseAt(pulse, 1.6).level).toBeLessThan(pulseAt(pulse, 1.0).level);
        expect(pulseAt(pulse, 2).level).toBe(0);
    });

    it('packs the live pulses at the front of the rows and puts spent rows back to rest', () => {
        const table = new PulseTable(4);
        const rows = rowsFor(4);
        table.add({
            at: 0, x: 5, z: -7, speed: 50, life: 1, colour: [1, 0.5, 0.25], gain: 1,
        });
        table.add({
            at: 0.5, x: 9, z: 9, speed: 50, life: 1, split: 1,
        });
        // The second is struck ahead of the clock: it waits.
        expect(table.write(rows, 0.2)).toBe(1);
        expect(rows[0].x).toBe(5);
        expect(rows[0].y).toBe(-7);
        expect(rows[0].z).toBeCloseTo(10, 9);
        expect(rows[1].x).toBeCloseTo(rows[1].y * 2, 9);
        expect(rows[1].w).toBe(0);
        expect(table.write(rows, 0.7)).toBe(2);
        expect(rows[3].w).toBe(1);
        // The first is spent: the second moves to the front, the row it left is at rest.
        expect(table.write(rows, 1.2)).toBe(1);
        expect(rows[0].x).toBe(9);
        expect(rows[2].toArray()).toEqual([0, 0, -1e5, 1]);
        expect(rows[3].toArray()).toEqual([0, 0, 0, 0]);
        expect(table.write(rows, 5)).toBe(0);
        expect(table.live).toBe(0);
        expect(rows[0].toArray()).toEqual([0, 0, -1e5, 1]);
    });

    it('makes room for a new pulse with the one that has least left, and refuses nonsense', () => {
        const table = new PulseTable(2);
        table.add({
            at: 0, x: 1, z: 0, life: 1,
        });
        table.add({
            at: 0.8, x: 2, z: 0, life: 1,
        });
        table.add({
            at: 0.9, x: 3, z: 0, life: 1,
        });
        expect(table.slots.map((s) => s.x).sort()).toEqual([2, 3]);
        expect(table.add({
            at: Number.NaN, x: 0, z: 0, life: 1,
        })).toBeNull();
        expect(table.add({
            at: 0, x: 0, z: 0, life: 0,
        })).toBeNull();
        table.reset();
        expect(table.live).toBe(0);
    });
});

describe('the gliders\' wheel', () => {
    it('rides a ring round its centre at a steady range, every glider in its own place', () => {
        const frame = { c: [100, 300, -1400], e1: [1, 0, 0], e2: [0, Math.cos(WHEEL.lean), Math.sin(WHEEL.lean)] };
        const seen = new Set();
        for (let k = 0; k < MAX_GLIDERS; k++) {
            const a = wheelAt(k, MAX_GLIDERS, 20, frame);
            const r = Math.hypot(a.x - 100, a.y - 300, a.z + 1400);
            expect(r).toBeGreaterThanOrEqual(WHEEL.range * Math.tan(WHEEL.inner) - 1e-6);
            expect(r).toBeLessThanOrEqual(WHEEL.range * Math.tan(WHEEL.outer) + 1e-6);
            const b = wheelAt(k, MAX_GLIDERS, 20.01, frame, {});
            // Its velocity is its motion.
            expect((b.x - a.x) / 0.01).toBeCloseTo(a.vx, 0);
            expect((b.y - a.y) / 0.01).toBeCloseTo(a.vy, 0);
            // The ring is still as far across a moment later.
            expect(Math.hypot(b.x - 100, b.y - 300, b.z + 1400)).toBeCloseTo(r, 6);
            seen.add(Math.round(Math.atan2(a.y - 300, a.x - 100) * 50));
        }
        expect(seen.size).toBeGreaterThan(MAX_GLIDERS * 0.7);
    });
});

describe('what play writes on the valley', () => {
    let land;
    let w;

    function makeWorld(quality = 'Minimal') {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new SunbraidWorld({
            scene, quality, capture: true, prepared: land,
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        return { scene, camera, world };
    }
    const frame = ({ world, camera }, time, delta) => {
        world.updateCamera(camera, sim(time, delta));
        world.update(sim(time, delta), camera);
    };
    function begin(it0, time = START, overrides = { moon: false, weather: 0 }) {
        it0.world.setReducedMotion(false);
        it0.world.setCaptureOverrides({
            phase: null, weather: -1, moon: null, ...overrides,
        });
        it0.world.seek(time);
        frame(it0, time, 0);
    }
    function stepTo(it0, to, dt = 1 / 30) {
        const from = it0.world.time;
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i += 1) frame(it0, from + i * h, h);
    }
    const livePulses = (world) => world.pulses.slots.filter((s) => s.live);
    const luma = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

    beforeAll(() => {
        land = SunbraidWorld.prepareSync('Minimal');
        w = makeWorld();
    });
    afterAll(() => w.world.dispose());

    it('draws the dust as a part of its own and makes nothing at the moment of an event', () => {
        const { world } = w;
        expect(SUNBRAID_PARTS).toContain('dust');
        expect(Object.keys(world.parts).sort()).toEqual([...SUNBRAID_PARTS].sort());
        begin(w);
        const before = world.root.children.length;
        world.onLock({
            u: 0.2, rows: [15], hardDrop: true, distance: 14, color: PIECE_COLORS[1],
        });
        world.onClear({ lines: 2, twist: true, combo: 1 });
        world.onClear({ lines: 4, perfect: true, combo: 2 });
        world.onSpin();
        world.levelUp(2);
        stepTo(w, START + 4);
        expect(world.root.children.length).toBe(before);
        expect(world.pulses.slots).toHaveLength(MAX_PULSES);
    });

    it('finds the plain under a point of the screen', () => {
        const { world } = w;
        begin(w);
        // Low in the frame: a little way ahead of the eye.
        const near = { ...world.floorPoint(0.5, 0.95) };
        expect(near.z).toBeLessThan(-80);
        expect(near.z).toBeGreaterThan(-260);
        expect(Math.abs(near.x)).toBeLessThan(1);
        // Higher in the frame is farther; left of centre is at negative x.
        const mid = { ...world.floorPoint(0.2, 0.7) };
        expect(Math.hypot(mid.x, mid.z)).toBeGreaterThan(Math.hypot(near.x, near.z));
        expect(mid.x).toBeLessThan(0);
        // At the rim and above it there is no plain: the far reach.
        const sky = world.floorPoint(0.5, 0.1, {}, 2600);
        expect(Math.hypot(sky.x, sky.z)).toBeCloseTo(2600, 6);
        // The eye's own height, by similar triangles: a sight line 45° down lands its height away.
        expect(EYE_ALTITUDE).toBe(70);
    });

    it('lights a lock\'s tiles beside the board, on the side the piece landed, in its colour', () => {
        const { world } = w;
        for (const [col, side] of [[0.1, 'left'], [0.9, 'right']]) {
            begin(w);
            world.onLock({ u: col, rows: [17], color: PIECE_COLORS[2] });
            const [pulse] = livePulses(world);
            expect(livePulses(world)).toHaveLength(1);
            const card = cardUnion(world.layout);
            expect(outsideKeepOut(world.layout, world._spot, 0.005), `${side} lane`).toBe(true);
            if (side === 'left') expect(world._spot.x).toBeLessThan(card.x0);
            else expect(world._spot.x).toBeGreaterThan(card.x1);
            expect([pulse.r, pulse.g, pulse.b]).toEqual(hexToLinear(PIECE_COLORS[2]));
            // The ripple spreads to its reach and stops there.
            const E = VALLEY_EVENTS.lock;
            expect(pulseAt(pulse, E.life).radius).toBeCloseTo(E.reach, 6);
            stepTo(w, START + 0.4);
            expect(world.u.pulseCount.value).toBe(1);
            stepTo(w, START + E.life + 0.2);
            expect(world.u.pulseCount.value).toBe(0);
        }
        // A hard drop's ripple is the wider, and wider still the farther it fell.
        begin(w);
        world.onLock({
            u: 0.3, rows: [18], hardDrop: true, distance: 4, color: PIECE_COLORS[0],
        });
        world.onLock({
            u: 0.3, rows: [18], hardDrop: true, distance: 16, color: PIECE_COLORS[0],
        });
        const [short, long] = livePulses(world);
        expect(pulseAt(short, short.life).radius).toBeGreaterThan(VALLEY_EVENTS.lock.reach);
        expect(pulseAt(long, long.life).radius).toBeGreaterThan(pulseAt(short, short.life).radius);
    });

    it('throws a ring of dust for a hard drop, and none under reduced motion', () => {
        const { world } = w;
        begin(w);
        world.onLock({ u: 0.3, rows: [18], color: PIECE_COLORS[0] });
        expect(world.dustRings.filter((d) => d.power > 0)).toHaveLength(0);
        world.onLock({
            u: 0.3, rows: [18], hardDrop: true, distance: 10, color: PIECE_COLORS[0],
        });
        const [ring] = world.dustRings.filter((d) => d.power > 0);
        expect(ring.at).toBe(START);
        expect(ring.height).toBeGreaterThan(VALLEY_EVENTS.dustRing.height);
        begin(w);
        world.setReducedMotion(true);
        world.onLock({
            u: 0.3, rows: [18], hardDrop: true, distance: 10, color: PIECE_COLORS[0],
        });
        expect(world.dustRings.filter((d) => d.power > 0)).toHaveLength(0);
        // The tiles still light.
        expect(livePulses(world)).toHaveLength(1);
        world.setReducedMotion(false);
    });

    it('sends a ring a line out from under the board, each in its row\'s colour', () => {
        const { world } = w;
        begin(w);
        // Three rows: all I, all O, and one mostly Z.
        const rowCodes = [
            ...new Array(10).fill(0), ...new Array(10).fill(6), 2, 2, 2, 2, 2, 2, 1, 1, 3, 3,
        ];
        world.onClear({ lines: 3, combo: 1, rowCodes });
        const rings = livePulses(world);
        expect(rings).toHaveLength(3);
        expect(rings.map((p) => [p.r, p.g, p.b])).toEqual([0, 6, 2].map((code) => hexToLinear(PIECE_COLORS[code])));
        // A beat apart, from one place, hidden under the board.
        expect(rings[1].at - rings[0].at).toBeCloseTo(VALLEY_EVENTS.clear.gap, 9);
        expect(new Set(rings.map((p) => `${p.x},${p.z}`)).size).toBe(1);
        const foot = { ...world.boardFoot(0) };
        expect(rings[0].x).toBe(foot.x);
        // More lines live longer (they run farther).
        expect(VALLEY_EVENTS.clear.life[3]).toBeGreaterThan(VALLEY_EVENTS.clear.life[1]);
        // A clear's rings light the tiles' faces; a lock's ripple the ridges alone.
        expect(rings.every((p) => p.ridge === false)).toBe(true);
        begin(w);
        world.onLock({ u: 0.2, rows: [16], color: PIECE_COLORS[4] });
        expect(livePulses(world)[0].ridge).toBe(true);
        stepTo(w, START + 0.3);
        expect(world.u.pulseRows[0].w).toBeLessThan(0);
        // A clear with no rows named still lights rings (the colours dealt from the palette).
        begin(w);
        world.onClear({ lines: 2 });
        expect(livePulses(world)).toHaveLength(2);
    });

    it('sends a ring out from each sun for a back-to-back, in the sky, not on the plain', () => {
        const { world } = w;
        const { u } = world;
        const B = VALLEY_EVENTS.b2b;
        begin(w);
        world.onClear({
            lines: 2, twist: true, combo: 1, b2b: true,
        });
        // No ring on the floor beyond the clear's own two.
        expect(livePulses(world)).toHaveLength(2);
        stepTo(w, START + B.life * 0.25);
        const early = u.haloRadius.value;
        expect(u.halo.value).toBeGreaterThan(0.5);
        expect(early).toBeGreaterThan(B.from);
        stepTo(w, START + B.life * 0.7);
        expect(u.haloRadius.value).toBeGreaterThan(early);
        expect(u.haloRadius.value).toBeLessThanOrEqual(B.reach);
        stepTo(w, START + B.life + 0.2);
        expect(u.halo.value).toBe(0);
        expect(u.haloRadius.value).toBe(0.15);
    });

    it('drains the land\'s colour for four lines and floods it back behind a front', () => {
        const { world } = w;
        const { u } = world;
        const C = BRAID_EVENTS.conjunction;
        const F = VALLEY_EVENTS.front;
        begin(w);
        expect(u.whiteLand.value).toBe(0);
        // The land's suns are in colour at rest, and the white sun's light has none.
        expect(u.sat0.value.x).toBeGreaterThan(u.sat0.value.y * 2);
        expect(u.pale0.value.x).toBeCloseTo(u.pale0.value.z, 9);
        world.onClear({ lines: 4, combo: 1 });
        stepTo(w, START + C.close * 0.9);
        expect(u.whiteLand.value).toBeGreaterThan(0.5);
        expect(u.flood.value.z).toBe(0);
        stepTo(w, START + C.close + C.hold * 0.5);
        expect(u.whiteLand.value).toBe(1);
        expect(u.rays.value).toBeGreaterThan(0.7);
        // The release: the front sets out from under the suns and a ring of split light rides it.
        const release = START + C.close + C.hold;
        stepTo(w, release + 0.6);
        expect(u.whiteLand.value).toBe(1);
        const radius = u.flood.value.z;
        expect(radius).toBeCloseTo(F.speed * (world.time - release) + F.gather * (world.time - release) ** 2, 3);
        expect(u.flood.value.x).toBeLessThan(0);
        expect(u.flood.value.y).toBeLessThan(0);
        const riding = livePulses(world).filter((p) => p.split === 1);
        expect(riding).toHaveLength(1);
        expect(pulseAt(riding[0], world.time - riding[0].at).radius).toBeCloseTo(radius, 3);
        stepTo(w, release + 1.2);
        expect(u.flood.value.z).toBeGreaterThan(radius);
        // Only one ring a release.
        expect(livePulses(world).filter((p) => p.split === 1)).toHaveLength(1);
        stepTo(w, release + F.life + 0.3);
        expect(u.whiteLand.value).toBe(0);
        expect(u.rays.value).toBeLessThan(0.05);
    });

    it('raises a twister for a twist: it stands, walks downwind, throws a faint shadow, and is gone', () => {
        const { world } = w;
        const { u } = world;
        begin(w);
        const solid = u.solidCount.value;
        expect(u.casterCount.value).toBe(solid);
        world.onClear({ lines: 2, twist: true, combo: 1 });
        const [twister] = world.twisters.filter((d) => d.power > 0);
        const tall = twister.height;
        expect(tall).toBeGreaterThan(VALLEY_EVENTS.twister.height);
        stepTo(w, START + 3);
        expect(u.casterCount.value).toBe(solid + 1);
        const foot = u.casterRows[solid * 2];
        const top = u.casterRows[solid * 2 + 1];
        // It has walked with the ground wind.
        const walked = Math.hypot(foot.x - twister.x, foot.z - twister.z);
        expect(walked).toBeCloseTo(TWISTER.walk * 3, 3);
        // Its shadow lets most of the light past (dust, not stone); the towers' rows let none.
        expect(top.y).toBeGreaterThan(0.3);
        expect(top.y).toBeLessThan(1);
        expect(u.casterRows[1].y).toBe(0);
        // The mirror and the mist's wedges still read the towers alone.
        expect(u.solidCount.value).toBe(solid);
        stepTo(w, START + twister.life + 0.5);
        expect(u.casterCount.value).toBe(solid);
        expect(u.casterRows[solid * 2].y).toBe(-1e5);
        // A twist that clears nothing raises a small one; twists take a side each in turn.
        begin(w);
        world.onSpin();
        const [small] = world.twisters.filter((d) => d.power > 0);
        expect(small.height).toBeLessThan(tall);
        world.onClear({ lines: 1, twist: true });
        const two = world.twisters.filter((d) => d.power > 0);
        expect(two).toHaveLength(2);
        expect(Math.sign(two[0].x)).not.toBe(Math.sign(two[1].x));
    });

    it('throws the suns\' spiral arms and calls the gliders for a chain, and lets both go when it breaks', () => {
        const { world } = w;
        const { u } = world;
        begin(w);
        expect(u.arms.value).toBe(0);
        expect(world.gather).toBe(0);
        for (let n = 1; n <= 7; n++) {
            world.onClear({ lines: 1, combo: n });
            world.onCombo(n);
            stepTo(w, world.time + 0.7);
        }
        const arms = u.arms.value;
        expect(arms).toBeGreaterThan(0.8);
        expect(arms).toBeLessThanOrEqual(VALLEY_EVENTS.arms.most);
        // (They keep to the sky round the suns: their reach is capped short of the board's card.)
        expect(u.armReach.value).toBeGreaterThan(1);
        expect(u.armReach.value).toBeLessThanOrEqual(1.4);
        expect(world.gather).toBeGreaterThan(0.4);
        world.onCombo(0);
        stepTo(w, world.time + 8);
        expect(u.arms.value).toBeLessThan(arms * 0.2);
        expect(world.gather).toBeLessThan(0.2);
        // The braid's frame in the sky is a frame: unit vectors square to one another.
        expect(u.centre.value.length()).toBeCloseTo(1, 9);
        expect(u.east.value.dot(u.centre.value)).toBeCloseTo(0, 9);
        expect(u.north.value.dot(u.centre.value)).toBeCloseTo(0, 9);
        expect(u.north.value.dot(u.east.value)).toBeCloseTo(0, 9);
        expect(u.braidRadius.value).toBeCloseTo(Math.tan(BRAID.spread * DEG * world.spread), 9);
    });

    it('crowns a perfect clear: rings round the suns, their pillars, three great rings on the plain', () => {
        const { world } = w;
        const { u } = world;
        const P = VALLEY_EVENTS.perfect;
        begin(w);
        expect(u.halo.value).toBe(0);
        expect(u.pillar.value).toBe(0);
        world.onClear({ lines: 1, combo: 1 });
        world.onPerfect();
        const great = livePulses(world).filter((p) => p.split === 1);
        expect(great).toHaveLength(P.rings);
        expect(great[1].at - great[0].at).toBeCloseTo(P.gap, 9);
        stepTo(w, START + 0.6);
        const early = u.haloRadius.value;
        stepTo(w, START + P.open + 0.4);
        expect(u.halo.value).toBeGreaterThan(1);
        expect(u.pillar.value).toBeGreaterThanOrEqual(1);
        expect(u.haloRadius.value).toBeGreaterThan(early);
        expect(world.gather).toBeGreaterThan(0.3);
        stepTo(w, START + P.stand + 4);
        expect(u.halo.value).toBeLessThan(0.05);
    });

    it('wakes the towers on a level-up and lets the light run out', () => {
        const { world } = w;
        const { u } = world;
        begin(w);
        expect(u.wake.value).toBe(-1);
        world.levelUp(2);
        stepTo(w, START + 1.5);
        expect(u.wake.value).toBeCloseTo(1.5, 6);
        stepTo(w, START + VALLEY_EVENTS.wake.life + 0.2);
        expect(u.wake.value).toBe(-1);
        // A silent step (a rebuild restoring the level) wakes nothing.
        begin(w);
        world.levelUp(3, { silent: true });
        stepTo(w, START + 0.5);
        expect(u.wake.value).toBe(-1);
    });

    it('brings the stars out and keeps the crust in the afterglow at game over', () => {
        const { world } = w;
        const { u } = world;
        begin(w);
        expect(u.stars.value).toBe(0);
        expect(u.afterglow.value.length()).toBe(0);
        world.onGameOver();
        stepTo(w, START + BRAID_EVENTS.dusk.set + 0.5);
        expect(u.stars.value).toBeCloseTo(1, 3);
        expect(u.afterglow.value.length()).toBeGreaterThan(0);
        expect(u.moonSeen.value).toBe(0);
    });

    it('lets the moon take the light of the sun it covers, and no other', () => {
        const { world } = w;
        const { u } = world;
        begin(w, START, { weather: 0, moon: false });
        const open = [luma(u.col0.value), luma(u.col1.value), luma(u.col2.value)];
        expect(world.eclipse).toEqual([0, 0, 0]);
        // Sweep the moon's own clock over a few passes: somewhere it hides a sun nearly whole.
        const best = { cover: 0, k: 0, at: 0 };
        for (let at = 0; at < MOON.period * 8; at += 0.25) {
            world.setCaptureOverrides({ moon: at });
            frame(w, START, 0);
            for (let k = 0; k < 3; k++) {
                if (world.eclipse[k] > best.cover) Object.assign(best, { cover: world.eclipse[k], k, at });
            }
        }
        expect(best.cover).toBeGreaterThan(0.9);
        world.setCaptureOverrides({ moon: best.at });
        frame(w, START, 0);
        const lit = [luma(u.col0.value), luma(u.col1.value), luma(u.col2.value)];
        expect(lit[best.k]).toBeLessThan(open[best.k] * 0.2);
        // The suns stand a few degrees apart: with one hidden whole, at least one other is untouched.
        const others = [0, 1, 2].filter((k) => k !== best.k);
        expect(others.some((k) => Math.abs(lit[k] - open[k]) < 1e-9)).toBe(true);
        expect(u.moonSeen.value).toBeGreaterThan(0.5);
        // The land's own colours follow.
        expect(luma(u[`sat${best.k}`].value)).toBeLessThan(open[best.k] * 0.2);
        // The one white sun is never taken.
        world.onClear({ lines: 4, combo: 1 });
        stepTo(w, START + BRAID_EVENTS.conjunction.close + 0.3);
        expect(Math.max(...world.eclipse)).toBe(0);
    });

    it('stands the suns\' discs and the moon\'s in the lens\'s own picture, so they are round there', () => {
        const { world, camera } = w;
        const { u } = world;
        begin(w);
        // The lens's axes are a frame.
        expect(u.lensRight.value.length()).toBeCloseTo(1, 9);
        expect(u.lensRight.value.dot(u.lensUp.value)).toBeCloseTo(0, 9);
        expect(u.lensAhead.value.dot(u.lensUp.value)).toBeCloseTo(0, 9);
        const tanV = Math.tan((camera.fov * DEG) / 2);
        for (const k of [0, 1, 2]) {
            const disc = u[`disc${k}`].value;
            const sun = u[`sun${k}`].value;
            // Its centre is where the sun's direction lands in the picture: left of the board,
            // in the upper half of the frame.
            const ahead = sun.dot(u.lensAhead.value);
            expect(disc.x).toBeCloseTo(sun.dot(u.lensRight.value) / ahead, 9);
            expect(disc.y).toBeCloseTo(sun.dot(u.lensUp.value) / ahead, 9);
            expect(disc.x).toBeLessThan(0);
            expect(disc.x).toBeGreaterThan(-tanV * world.aspect);
            expect(disc.y).toBeGreaterThan(0);
            expect(disc.y).toBeLessThan(tanV);
            // Its radius there is its angular radius seen that far off the axis.
            expect(disc.z).toBeGreaterThan(Math.tan(0.9 * DEG));
            expect(disc.z).toBeLessThan(Math.tan(2.2 * DEG));
        }
        // With no camera bound the rest rig's axes stand in.
        const bare = new SunbraidWorld({ scene: new THREE.Scene(), quality: 'Minimal', prepared: land }).build();
        try {
            bare.setViewport(1600, 900, 16 / 9);
            bare.seek(START);
            bare.update(sim(START, 0), null);
            expect(bare.u.lensAhead.value.length()).toBeCloseTo(1, 9);
            expect(bare.u.lensAhead.value.z).toBeLessThan(-0.9);
            expect(bare.u.disc0.value.x).toBeLessThan(0);
        } finally {
            bare.dispose();
        }
    });

    it('writes the weather it is held on', () => {
        const { world } = w;
        const { u } = world;
        begin(w, START, { moon: false, weather: weatherIndex('wet') });
        expect(u.wet.value).toBe(1);
        expect(u.rain.value).toBe(0);
        begin(w, START, { moon: false, weather: weatherIndex('veil') });
        expect(u.wet.value).toBe(0);
        expect(u.pillar.value).toBeCloseTo(0.9, 9);
        expect(u.halo.value).toBeGreaterThan(0);
        begin(w, START, { moon: false, weather: weatherIndex('wind') });
        expect(u.wind.value).toBe(1);
        // The ground wind's axes are a frame, and the dust only ever runs downwind.
        expect(u.gustAlong.value.length()).toBeCloseTo(1, 9);
        expect(u.gustAlong.value.dot(u.gustAcross.value)).toBeCloseTo(0, 9);
        const blown = world.gust;
        stepTo(w, START + 2);
        expect(world.gust).toBeGreaterThan(blown);
        // The wind weather raises a twister of its own, far out, sooner or later.
        let raised = 0;
        for (let t = START + 2; t < START + 400 && !raised; t += 1) {
            stepTo(w, t + 1, 0.5);
            raised = world.twisters.filter((d) => d.power > 0).length;
        }
        expect(raised).toBe(1);
        const [gale] = world.twisters.filter((d) => d.power > 0);
        expect(Math.hypot(gale.x, gale.z)).toBeGreaterThan(700);
        // On the clock alone the clear day opens the sitting.
        begin(w, 3, { moon: false, weather: -1 });
        expect(u.wet.value).toBe(0);
        expect(u.cirrus.value).toBe(WEATHERS[0].cirrus);
    });
});
