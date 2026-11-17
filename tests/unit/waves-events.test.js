/**
 * Waves — what each event adds to the sea, and what the sea does by itself.
 *
 * Every event has a form of its own (a hard drop's spout, the white water heaving where the lip
 * lands for every line, a spinner answering a twist, the tube's spit for four lines, a humpback for a perfect clear, a chain's
 * escort in the wall, shearwaters for a new level), and the sea turns through states of its own
 * on a clock beside the hours'. These tests build a real world and read back what it wrote: the
 * board's acts, the spray and the white water, and the uniforms the water reads.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HARD_DROP_REST, HEAVE_FALL, HEAVE_RISE, REST_RIG, WavesWorld, fovForAspect,
} from '../../src/themes/waves/waves-world.js';
import { fallbackLayout } from '../../src/themes/waves/waves-composition.js';
import {
    SEA_KEYS, SEA_SECONDS, SEA_STATES, seaAt,
} from '../../src/themes/waves/waves-hours.js';
import { parseSeaLife } from '../../src/themes/waves/waves-cast.js';
import { emptyPose, makeLeap, makePorpoise } from '../../src/themes/waves/waves-acts.js';

vi.setConfig({ testTimeout: 30_000 });

const DT = 1 / 60;
const PACK = parseSeaLife(readFileSync(new URL('../../src/themes/waves/assets/sea-life.glb', import.meta.url)));
const worlds = [];

afterEach(() => {
    for (const world of worlds.splice(0)) world.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** The board's world: the sea sends nothing of its own and stands at glass, unless asked. */
function makeWorld(quality = 'High', {
    ambient = false, sea = 0, at = 20, hour = 0, seaLife = PACK,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
    const world = new WavesWorld({
        scene, quality, capture: true, seaLife, ambient, sea, hour,
    }).build();
    world.setViewport(1600, 900, 16 / 9);
    world.setLayout(fallbackLayout(1600, 900), 16 / 9);
    world.bindCamera(camera);
    world.seek(at);
    frame(world, camera);
    worlds.push(world);
    return { world, camera };
}

function frame(world, camera, delta = 0) {
    const sim = { time: world.time + delta, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function run(world, camera, seconds) {
    for (let i = Math.round(seconds / DT); i > 0; i--) frame(world, camera, DT);
}

/** The drops of the spray pool born at or after `from` on the world's clock. */
function dropsFrom(world, from) {
    const start = world.spray.geometry.getAttribute('aStart');
    const flight = world.spray.geometry.getAttribute('aFlight');
    const out = [];
    for (let i = 0; i < world.spray.count; i++) {
        if (start.getW(i) >= from - 1e-6) {
            out.push({
                x: start.getX(i), y: start.getY(i), z: start.getZ(i), birth: start.getW(i), vy: flight.getY(i),
            });
        }
    }
    return out;
}

/** The puffs of white water born at or after `from`. */
function puffsFrom(world, from) {
    const start = world.foam.geometry.getAttribute('aStart');
    const move = world.foam.geometry.getAttribute('aMove');
    const out = [];
    for (let i = 0; i < world.foam.count; i++) {
        if (start.getW(i) >= from - 1e-6) {
            out.push({
                x: start.getX(i), y: start.getY(i), z: start.getZ(i), vz: move.getZ(i), birth: start.getW(i),
            });
        }
    }
    return out;
}

const actsOf = (world, type, kind = null) => world.pod.acts.filter((act) => act.type === type && (!kind || act.kind === kind));

describe('waves events: each its own form', () => {
    it('stands the water up for a hard drop: a full spout after a breath, a small one straight after another', () => {
        const { world, camera } = makeWorld();
        const column = vi.spyOn(world.spray, 'column');
        const lock = (hardDrop) => world.onLock({
            rows: [18, 19], u: 0.4, hardDrop, color: '#ffa6e3',
        });
        const spout = () => column.mock.calls[column.mock.calls.length - 1][4];
        // A plain lock throws its crown only: no column, no white water.
        let from = world.clock;
        lock(false);
        expect(column).not.toHaveBeenCalled();
        expect(puffsFrom(world, from)).toHaveLength(0);
        run(world, camera, HARD_DROP_REST + 0.2);
        from = world.clock;
        lock(true);
        const full = spout();
        expect(full.n).toBe(Math.round(world.spray.count / 80));
        expect(puffsFrom(world, from)).toHaveLength(3);
        // Its drops go up harder than a crown's, in the piece's own colour.
        const up = dropsFrom(world, from).filter((drop) => drop.vy >= full.up[0] - 1e-6);
        expect(up.length).toBeGreaterThanOrEqual(full.n);
        expect(full.rgb[0]).toBeGreaterThan(full.rgb[1]);
        // Straight after: a small one, and lower.
        run(world, camera, 0.1);
        lock(true);
        const small = spout();
        expect(small.n).toBeLessThan(full.n * 0.5);
        expect(small.n).toBeGreaterThan(0);
        expect(small.up[1]).toBeLessThan(full.up[1]);
        // After a breath, a full one again.
        run(world, camera, HARD_DROP_REST + 0.1);
        lock(true);
        expect(spout().n).toBe(full.n);
        // A new run forgets the last one.
        world.resetSession();
        expect(world.state.hardAt).toBe(-100);
    });

    it('makes the white water heave where the lip lands for every line: harder for four than for one', () => {
        const heaves = [1, 2, 3, 4].map((lines) => {
            const { world, camera } = makeWorld('High');
            const { heave, tear } = world.U;
            // A glass sea with nothing played: the white water stands as it stands.
            const rest = heave.value;
            expect(rest).toBeLessThan(0.05);
            world.onClear({ rows: [19], lines });
            // Not at once: the throw is taken up over a third of a second (nothing in the white
            // water jumps, its puffs are placed by this number)...
            frame(world, camera, DT);
            expect(heave.value).toBeGreaterThan(rest);
            expect(heave.value).toBeLessThan(tear.value * 0.5);
            run(world, camera, 0.3);
            const up = heave.value;
            expect(up).toBeGreaterThan(rest + 0.15);
            // ...and let go of more slowly than the lip lets go of it.
            run(world, camera, 1.5);
            expect(heave.value).toBeLessThan(up);
            expect(heave.value).toBeGreaterThan(tear.value);
            run(world, camera, 9);
            expect(heave.value).toBeLessThan(0.05);
            // A new run starts with the sea at rest.
            world.onClear({ rows: [19], lines });
            run(world, camera, 0.3);
            world.resetSession();
            expect(heave.value).toBe(0);
            return up;
        });
        for (let i = 1; i < heaves.length; i++) expect(heaves[i], `${i + 1} lines`).toBeGreaterThan(heaves[i - 1]);
        expect(HEAVE_RISE).toBeGreaterThan(HEAVE_FALL * 4);
        // No animal is sent for a plain clear any more (the flying fish are gone).
        const { world } = makeWorld('High');
        const before = world.pod.acts.length;
        world.onClear({ rows: [19], lines: 2 });
        expect(world.pod.acts.length).toBe(before);
    });

    it('answers a twist that clears with a spinner\'s own spin, a turn more for every line', () => {
        for (const lines of [1, 2, 3]) {
            const { world } = makeWorld();
            world.onClear({ rows: [19], lines, twist: true });
            const spins = actsOf(world, 'leap', 'spinner');
            expect(spins).toHaveLength(1);
            expect(spins[0]).toMatchObject({ style: 'spin', turns: 2 + lines });
            expect(spins[0].t0).toBeGreaterThan(world.clock);
            // Not one of the chain's pod: it does not count as a leap the chain called.
            expect(world.getState().leaps).toBe(0);
        }
        // A plain clear calls no spinner, and a twist that cleared nothing only turns the water.
        const plain = makeWorld().world;
        plain.onClear({ rows: [19], lines: 2 });
        expect(actsOf(plain, 'leap')).toHaveLength(0);
        const spin = makeWorld().world;
        spin.onSpin();
        expect(spin.pod.acts).toHaveLength(0);
    });

    it('makes the tube spit for four lines: mist blown from behind the rider out through the eye', () => {
        const { world } = makeWorld();
        const from = world.clock;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const mist = puffsFrom(world, from).filter((puff) => puff.z > 1.5);
        expect(mist.length).toBeGreaterThanOrEqual(Math.max(6, Math.round(world.foam.count / 6)) - 1);
        for (const puff of mist) {
            // Behind the eye, inside the tube, and on its way down the line ahead.
            expect(puff.z).toBeCloseTo(2.5, 6);
            expect(puff.vz).toBeLessThan(-10);
            expect(puff.birth).toBeLessThan(from + 0.4);
        }
        expect(world.U.tear.value).toBeGreaterThanOrEqual(0);
        expect(world.state.tear).toBe(1);
        // Fewer lines: no spit.
        const three = makeWorld().world;
        const before = three.clock;
        three.onClear({ rows: [19, 18, 17], lines: 3 });
        expect(puffsFrom(three, before).filter((puff) => puff.z > 1.5)).toHaveLength(0);
    });

    it('throws a humpback out of the sea in the eye of the barrel for a perfect clear, one at a time', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        const [whale] = actsOf(world, 'whale');
        expect(whale).toMatchObject({ mode: 'breach', kind: 'humpback' });
        // Fifty to sixty-five metres off, left of the sun's road, where the eye of the barrel is widest.
        expect(-whale.z).toBeGreaterThan(50);
        expect(-whale.z).toBeLessThan(67);
        expect(whale.x).toBeLessThan(0);
        // Its crown (settled after the clear) does not send a second one while the first is up.
        world.onClear({ crown: true });
        expect(actsOf(world, 'whale')).toHaveLength(1);
        // Once it is back under the sea and gone (the four lines' hold slows the clock it runs on),
        // the next perfect clear calls another.
        run(world, camera, whale.life + 8);
        expect(actsOf(world, 'whale')).toHaveLength(0);
        world.onClear({ crown: true });
        expect(actsOf(world, 'whale')).toHaveLength(1);
        // A plain four-line clear calls none.
        const quad = makeWorld().world;
        quad.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(actsOf(quad, 'whale')).toHaveLength(0);
    });

    it('brings a chain\'s escort into the wall beside the rider from four clears on, not again too soon', () => {
        const { world, camera } = makeWorld();
        world.onCombo(3);
        expect(actsOf(world, 'ride')).toHaveLength(0);
        world.onCombo(4);
        expect(actsOf(world, 'ride')).toHaveLength(1);
        // More clears straight after: the escort is there already.
        world.onCombo(6);
        world.onCombo(8);
        expect(actsOf(world, 'ride')).toHaveLength(1);
        // Later in a long chain, a bigger one.
        run(world, camera, 12);
        world.onCombo(9);
        const rides = actsOf(world, 'ride');
        expect(rides.length).toBeGreaterThan(1);
        for (const ride of rides) {
            // In the wall, passing the rider down the line.
            expect(ride.row).toBeGreaterThan(0);
            expect(ride.row).toBeLessThan(0.5);
            expect(Math.min(ride.d0, ride.d1)).toBeLessThan(0);
            expect(ride.fade).toBe(false);
        }
    });

    it('brings shearwaters across the opening as a new level comes in, not when a level is simply set', () => {
        const { world } = makeWorld();
        world.levelUp(2);
        const birds = actsOf(world, 'soar', 'seabird');
        expect(birds.length).toBeGreaterThan(0);
        expect(birds.every((bird) => bird.y > 2)).toBe(true);
        const quiet = makeWorld().world;
        quiet.levelUp(4, { silent: true });
        expect(quiet.pod.acts).toHaveLength(0);
    });

    it('lets a new run start with none of the board\'s animals; the sea\'s own go on', () => {
        const { world, camera } = makeWorld('High', { ambient: true });
        world.onClear({
            rows: [19, 18, 17, 16], lines: 4, perfect: true, twist: true,
        });
        world.onCombo(9);
        world.levelUp(3);
        expect(world.pod.acts.length).toBeGreaterThan(5);
        world.resetSession();
        expect(world.pod.acts).toEqual([]);
        // A minute of the sea by itself: several kinds of visit, and animals drawn in it.
        let most = 0;
        for (let i = 0; i < 60; i++) {
            run(world, camera, 1);
            most = Math.max(most, Object.values(world.getState().life).reduce((sum, n) => sum + n, 0));
        }
        const visits = new Set();
        for (let t = 0; t < 60; t += 8) visits.add(world.pod.ambient.nameAt(world.clock - t));
        expect(visits.size).toBeGreaterThan(3);
        expect(most).toBeGreaterThan(0);
    });
});

describe('waves events: the water an animal throws', () => {
    const pose = (x, y, z) => Object.assign(emptyPose(), {
        x, y, z, fx: -1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, metres: 2.6,
    });

    it('throws water for every way an animal breaks the surface, and lays a ring only near the eye', () => {
        const { world } = makeWorld();
        const leap = makeLeap({
            at: world.clock, row: -0.01, d: 10, vx: -1, vy: 1.2, vz: 0,
        });
        const roll = makePorpoise({
            at: world.clock, x: -2, z: -8, hx: -1, hz: 0,
        });
        const far = makePorpoise({
            at: world.clock, x: -40, z: -90, hx: -1, hz: 0,
        });
        const cases = [
            [leap, 'breach', pose(leap.x, 0, leap.z), true],
            [leap, 'entry', pose(leap.x - 3, 0.2, leap.z), true],
            [roll, 'surface', pose(-2, 0, -8), true],
            [roll, 'dip', pose(-2, 0, -8), true],
            [far, 'surface', pose(-40, 0, -90), false],
            [{ kind: 'humpback' }, 'whale-rise', Object.assign(pose(-30, 0, -120), { metres: 13 }), false],
            [{ kind: 'humpback' }, 'whale-fall', Object.assign(pose(-30, 0, -120), { metres: 13 }), false],
            [{ kind: 'humpback' }, 'whale-blow', Object.assign(pose(-30, 0, -120), { metres: 13 }), false],
            [{ kind: 'humpback' }, 'whale-slip', Object.assign(pose(-30, 0, -120), { metres: 13 }), false],
        ];
        for (const [act, type, where, ring] of cases) {
            const rings = world.ringCount;
            const from = world.clock;
            const drops = dropsFrom(world, from - 10).length;
            const puffs = puffsFrom(world, from - 10).length;
            world.onLifeEvent(act, { t: 0, type }, where);
            const thrown = dropsFrom(world, from - 10).length - drops + puffsFrom(world, from - 10).length - puffs;
            expect(thrown, type).toBeGreaterThan(0);
            expect(world.ringCount > rings, `${type}: a ring`).toBe(ring && world.ringCount < world.ringRows.length + 1);
        }
        // Something it does not know throws nothing.
        const before = dropsFrom(world, -1e3).length;
        world.onLifeEvent(leap, { t: 0, type: 'unknown' }, pose(0, 0, -5));
        expect(dropsFrom(world, -1e3).length).toBe(before);
    });

    it('runs, counts and splashes without the animals\' bodies, and draws them once they come', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
        const { world, camera } = makeWorld('High', { seaLife: null, ambient: false });
        // (Nothing to read them from here: the world goes on without them.)
        await world.lifeReady;
        expect(world.pod.fauna).toBeNull();
        expect(console.warn).toHaveBeenCalled();
        world.onCombo(5);
        const splash = vi.spyOn(world, 'onLifeEvent');
        run(world, camera, 6);
        expect(world.getState().leaps).toBeGreaterThan(0);
        expect(splash).toHaveBeenCalled();
        world.pod.attach(PACK);
        world.onCombo(0);
        world.onCombo(5);
        run(world, camera, 1);
        expect(Object.values(world.getState().life).some((n) => n > 0)).toBe(true);
    });
});

describe('waves events: the sea\'s own states', () => {
    it('rests on each state and mixes the neighbours between, round the wheel', () => {
        expect(SEA_STATES.map((state) => state.name)).toEqual(['glass', 'offshore', 'heavy', 'sparkling']);
        SEA_STATES.forEach((state, i) => {
            const at = seaAt(i + 0.1);
            expect(at.name).toBe(state.name);
            for (const key of SEA_KEYS) expect(at[key], `${state.name} ${key}`).toBeCloseTo(state[key], 9);
            // Round the wheel: the same place a whole turn on.
            expect(seaAt(i + 0.1 + SEA_STATES.length)).toEqual(at);
            expect(seaAt(i + 0.1 - SEA_STATES.length)).toEqual(at);
        });
        // Half-way across, a mix of the two neighbours, every value between theirs.
        const half = seaAt(1 + 0.3 + 0.35);
        for (const key of SEA_KEYS) {
            const lo = Math.min(SEA_STATES[1][key], SEA_STATES[2][key]);
            const hi = Math.max(SEA_STATES[1][key], SEA_STATES[2][key]);
            expect(half[key]).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(half[key]).toBeLessThanOrEqual(hi + 1e-9);
        }
        expect(seaAt(Number.NaN)).toEqual(seaAt(0));
        // No multiple of the hours' clock: the same light does not meet the same sea in step.
        expect(SEA_SECONDS % 100).not.toBe(0);
    });

    it('hands the state to the water and moves the wave with it: wind tears the lip, a heavy sea opens the barrel', () => {
        const states = SEA_STATES.map((state, i) => {
            const { world, camera } = makeWorld('High', { sea: i });
            run(world, camera, 0.5);
            expect(world.U.sea.value.toArray()).toEqual(SEA_KEYS.map((key) => state[key]));
            expect(world.getState().sea).toBe(state.name);
            return {
                tear: world.U.tear.value, open: world.U.open.value, ripple: world.U.ripple.value,
            };
        });
        // Glass is the wave as it always was at rest.
        expect(states[0]).toEqual({ tear: 0, open: 0, ripple: 1 });
        expect(states[1].tear).toBeCloseTo(0.42, 9);
        expect(states[2].open).toBeCloseTo(0.16, 9);
        expect(states[3].ripple).toBeGreaterThan(states[0].ripple);
        // Unheld, it turns with the clock.
        const { world, camera } = makeWorld('High', { sea: null, at: SEA_SECONDS * 1.1 });
        run(world, camera, 0.1);
        expect(world.getState().sea).toBe(seaAt(world.clock / SEA_SECONDS).name);
        expect(world.getState().sea).toBe('offshore');
    });

    it('lights the sea\'s own cold glow when the hour is dark, and never by day', () => {
        const day = makeWorld('High', { hour: 0 }).world;
        const moon = makeWorld('High', { hour: 3 }).world;
        expect(day.U.glowing.value).toBe(0);
        expect(moon.U.glowing.value).toBe(1);
    });
});
