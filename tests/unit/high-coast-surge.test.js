/**
 * High Coast — reactions that BUILD instead of popping and resetting (the theme event surge).
 *
 * The world driven without a renderer, as in high-coast-world.test.js: every reaction that used to
 * restart a single slot accumulates (a weak event after a strong one never cuts the light), a long
 * chain reads hotter than its first clear (the air clears, the wind rises, the sky burns, the risen
 * rock gleams), and the coast breathes back to rest when the hands do.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { HighCoastWorld, REST_RIG, fovForAspect } from '../../src/themes/high-coast/high-coast-world.js';
import { PIECE_COLORS, TIMING, hexToLinear } from '../../src/themes/high-coast/high-coast-core.js';
import { spinnakerOpen } from '../../src/themes/high-coast/high-coast-fleet.js';

vi.setConfig({ testTimeout: 30_000 });

const START = 10;
let prepared;
let shared;

function makeWorld() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
    const world = new HighCoastWorld({
        scene, quality: 'Minimal', capture: true, prepared,
    }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    return { world, camera };
}

function begin({ world, camera }, time = START) {
    world.seek(time);
    world.setReducedMotion(false);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

/** Frames from the world's time to `to`, as the theme draws them (camera, then the frame). */
function stepTo({ world, camera }, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, { time, delta: h });
        world.update({ time, delta: h }, camera);
    }
}

/** A long hot chain from the world's time: a hard-dropped clearing lock every 0.64 s. */
function chain(w, links = 12) {
    const { world } = w;
    for (let n = 1; n <= links; n += 1) {
        world.onLock({
            u: (n * 0.37) % 1, rows: [19], color: PIECE_COLORS[n % 7], hardDrop: true, distance: 14,
        });
        world.onClear({
            lines: 1 + (n % 3), combo: n, rows: [19], rowCodes: new Array(10).fill(n % 7),
        });
        world.onCombo(n);
        stepTo(w, world.time + 0.64);
    }
}

/** What a frame wears: the uniforms and post values the surge drives. */
const look = ({ world }) => ({
    level: world.heat.level,
    fever: world.heat.fever,
    breeze: world.u.breeze.value,
    haze: world.u.hazeDensity.value,
    cloudCover: world.u.cloudCover.value,
    sails: world.u.heat.value.z,
    gild: world.u.heat.value.w,
    saturation: world.getPostState().saturation,
    exposure: world.getPostState().exposure,
    zenith: world.u.zenith.value.z,
});

beforeAll(() => {
    prepared = HighCoastWorld.prepareSync('Minimal');
    shared = makeWorld();
    begin(shared);
});

afterAll(() => {
    shared?.world.dispose();
});

describe('High Coast: a weak event after a strong one never cuts the light', () => {
    it('keeps the run-off, the gold flare and the flash rising through a single right after a quad', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 4, combo: 1, rows: [16, 17, 18, 19] });
        stepTo(shared, START + 0.5);
        const before = {
            drain: world.u.drain.value, rebound: world.u.rebound.value, flash: world.getPostState().flash,
        };
        expect(before.drain).toBeGreaterThan(0.5);
        expect(before.rebound).toBeGreaterThan(0.5);
        // A single, the next frame: everything still lit only rises or carries on falling slowly.
        world.onClear({ lines: 1, combo: 2, rows: [19] });
        stepTo(shared, START + 0.5 + 1 / 30);
        expect(world.u.drain.value).toBeGreaterThanOrEqual(before.drain * 0.97);
        expect(world.u.rebound.value).toBeGreaterThanOrEqual(before.rebound * 0.97);
        // A second quad feeds the flare still burning: it climbs past the first one's peak.
        let peakOne = 0;
        begin(shared);
        world.onClear({ lines: 4, combo: 1, rows: [16, 17, 18, 19] });
        for (let t = START; t < START + 1.2; t += 0.05) {
            stepTo(shared, t + 0.05);
            peakOne = Math.max(peakOne, world.u.rebound.value);
        }
        world.onClear({ lines: 4, combo: 2, rows: [16, 17, 18, 19] });
        let peakTwo = 0;
        for (let t = world.time; t < START + 2.4; t += 0.05) {
            stepTo(shared, t + 0.05);
            peakTwo = Math.max(peakTwo, world.u.rebound.value);
        }
        expect(peakTwo).toBeGreaterThan(peakOne * 1.2);
    });

    it('never slams a flying spinnaker shut: a lock on its side fills it again and turns its colour', () => {
        const { world } = shared;
        begin(shared);
        const { boats } = world.parts.fleet;
        // Lock after lock on the left until every boat there flies a sail.
        const left = () => boats.filter((b) => b.place.side === -1);
        for (let n = 0; n < left().length + 1; n += 1) {
            world.onLock({ u: 0.1, rows: [19], color: PIECE_COLORS[n % 7] });
            stepTo(shared, world.time + 0.6);
        }
        const flying = left();
        expect(flying.length).toBeGreaterThan(0);
        flying.forEach((b) => expect(spinnakerOpen(b, world.time)).toBeGreaterThan(0.9));
        // Many more, quickly: no sail on that side ever drops below where it stood.
        let lowest = 1;
        for (let n = 0; n < 12; n += 1) {
            world.onLock({ u: 0.1, rows: [19], color: PIECE_COLORS[(n + 3) % 7] });
            for (let k = 0; k < 6; k += 1) {
                stepTo(shared, world.time + 0.05);
                for (const b of left()) lowest = Math.min(lowest, spinnakerOpen(b, world.time));
            }
        }
        expect(lowest).toBeGreaterThan(0.9);
        // The newest lock's colour is what the sail it reached turns to (no instant swap: it blends).
        const fed = left().reduce((a, b) => (b.fedAt > a.fedAt ? b : a));
        const target = hexToLinear(PIECE_COLORS[(11 + 3) % 7]);
        fed.colour.forEach((v, k) => expect(v).toBeCloseTo(target[k], 9));
        expect(fed.blendAt).toBe(fed.fedAt);
        // Held while locks keep feeding it, doused only TIMING.spinnaker after its last one.
        stepTo(shared, fed.fedAt + TIMING.spinnaker - 1, 0.25);
        expect(spinnakerOpen(fed, world.time)).toBeGreaterThan(0.9);
        stepTo(shared, fed.fedAt + TIMING.spinnaker + 3, 0.25);
        expect(spinnakerOpen(fed, world.time)).toBe(0);
    });

    it('lifts the gulls still climbing higher on a second quad instead of dropping them to the water', () => {
        const { world } = shared;
        begin(shared);
        const heights = () => {
            const m = world.parts.life.mesh.instanceMatrix.array;
            let sum = 0;
            for (let i = 0; i < m.length; i += 16) sum += m[i + 13];
            return sum / (m.length / 16);
        };
        const rest = heights();
        world.onClear({ lines: 4, combo: 1, rows: [16, 17, 18, 19] });
        stepTo(shared, START + 3);
        const lifted = heights();
        expect(lifted).toBeGreaterThan(rest + 20);
        world.onClear({ lines: 4, combo: 2, rows: [16, 17, 18, 19] });
        let lowest = Infinity;
        for (let k = 0; k < 30; k += 1) {
            stepTo(shared, world.time + 0.1);
            lowest = Math.min(lowest, heights());
        }
        // The sea drops a little with the second quad's rise; the flock never sinks toward it.
        expect(lowest).toBeGreaterThan(lifted - 6);
        expect(heights()).toBeGreaterThan(lifted);
    });

    it('turns the fleet back from where it stands when a second T-spin comes mid-tack', () => {
        const { world } = shared;
        begin(shared);
        const heel = () => world.parts.fleet.mesh.instanceMatrix.array.slice(0, 16);
        world.onClear({
            lines: 2, combo: 1, tspin: true, rows: [18, 19],
        });
        stepTo(shared, START + TIMING.tack * 0.5);
        const mid = heel();
        world.onSpin();
        stepTo(shared, world.time + 1 / 60, 1 / 60);
        const after = heel();
        // One frame on: the hull's orientation moved a little, it did not jump to the far side.
        const { scale } = world.parts.fleet.boats[0];
        const moved = Math.max(...mid.slice(0, 12).map((v, i) => Math.abs(v - after[i]))) / scale;
        expect(moved).toBeLessThan(0.05);
        expect(world.counts).toMatchObject({ tspins: 1, spins: 1, clears: 1 });
    });
});

describe('High Coast: the crescendo', () => {
    it('reads a long chain hotter than its first clear, and breathes back to rest', () => {
        const { world } = shared;
        begin(shared);
        stepTo(shared, START + 0.5);
        const rest = look(shared);
        world.onLock({
            u: 0.3, rows: [19], color: PIECE_COLORS[1], hardDrop: true,
        });
        world.onClear({ lines: 1, combo: 1, rows: [19] });
        stepTo(shared, START + 1.2);
        const first = look(shared);
        chain(shared, 12);
        const hot = look(shared);
        expect(hot.level).toBeGreaterThan(0.8);
        expect(hot.fever).toBeGreaterThan(0.5);
        expect(hot.level).toBeGreaterThan(first.level + 0.5);
        // The wind rises, the air clears, the deck gathers, the sky deepens overhead, the sails burn
        // and the wet rock gleams; the iris closes a little and the colour deepens.
        expect(hot.breeze).toBeGreaterThan(first.breeze + 0.3);
        expect(hot.haze).toBeLessThan(first.haze * 0.7);
        expect(hot.cloudCover).toBeGreaterThan(first.cloudCover);
        expect(hot.zenith).toBeLessThan(first.zenith);
        expect(hot.sails).toBeGreaterThan(first.sails + 0.5);
        expect(hot.gild).toBeGreaterThan(first.gild + 0.8);
        expect(hot.saturation).toBeGreaterThan(first.saturation);
        expect(hot.exposure).toBeLessThan(first.exposure);
        // Casual play leaves the coast as it was.
        expect(first.haze).toBeGreaterThan(rest.haze * 0.9);
        expect(first.sails).toBeLessThan(0.15);
        // The hands rest: it all breathes back.
        world.onCombo(0);
        stepTo(shared, world.time + 12, 0.1);
        const after = look(shared);
        expect(after.level).toBeLessThan(0.1);
        expect(after.fever).toBe(0);
        expect(after.haze).toBeGreaterThan(rest.haze * 0.93);
        expect(after.sails).toBeLessThan(0.05);
        expect(after.breeze).toBeLessThan(1.1);
    });

    it('fills the whole fleet with colour in a hot chain', () => {
        const { world } = shared;
        begin(shared);
        // Every lock on one side: only that side's boats could fly without the hot-play spares.
        for (let n = 1; n <= 12; n += 1) {
            world.onLock({
                u: 0.1, rows: [19], color: PIECE_COLORS[n % 7], hardDrop: true,
            });
            world.onClear({ lines: 2, combo: n, rows: [18, 19] });
            world.onCombo(n);
            stepTo(shared, world.time + 0.64);
        }
        const { boats } = world.parts.fleet;
        expect(boats.filter((b) => spinnakerOpen(b, world.time) > 0.5)).toHaveLength(boats.length);
    });

    it('builds each cascade wave on the last: deeper, and the rock brighter', () => {
        const { world } = shared;
        const waveLift = (cascade) => {
            begin(shared);
            world.onClear({ lines: 1, combo: 1, rows: [19] });
            const before = world.liftAsk;
            world.onClear({
                lines: 1, combo: 1, cascade, rows: [19],
            });
            return world.liftAsk - before;
        };
        expect(waveLift(3)).toBeGreaterThan(waveLift(2));
        expect(waveLift(2)).toBeGreaterThan(waveLift(1));
        begin(shared);
        let last = 0;
        for (let wave = 1; wave <= 4; wave += 1) {
            world.onClear({
                lines: 1, combo: 1, cascade: wave, rows: [19],
            });
            stepTo(shared, world.time + 0.36);
            if (wave > 1) expect(world.u.rebound.value, `wave ${wave}`).toBeGreaterThan(last);
            last = world.u.rebound.value;
        }
        expect(world.counts.waves).toBe(3);
    });

    it('crowns a perfect clear that settles on its own instead of replaying a clear', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 4, combo: 1, rows: [16, 17, 18, 19] });
        stepTo(shared, START + 0.36);
        const lift = world.liftAsk;
        world.onClear({ lines: 1, perfect: true, rows: [] });
        expect(world.counts).toMatchObject({ clears: 1, quads: 1, perfects: 1 });
        expect(world.liftAsk).toBe(lift);
        stepTo(shared, START + 2);
        expect(world.u.calm.value).toBeGreaterThan(0.99);
        // A perfect clear that lands with its rows is the clear and its crown.
        begin(shared);
        world.onClear({ lines: 2, perfect: true, rows: [18, 19] });
        expect(world.counts).toMatchObject({ clears: 1, perfects: 1 });
        expect(world.liftAsk).toBeGreaterThan(0);
        // A second perfect clear while the glass holds keeps it glass (no restart from wind).
        stepTo(shared, START + TIMING.calmHold + 1, 0.1);
        world.onClear({ lines: 1, perfect: true, rows: [] });
        let lowest = 1;
        for (let k = 0; k < 20; k += 1) {
            stepTo(shared, world.time + 0.1);
            lowest = Math.min(lowest, world.u.calm.value);
        }
        expect(lowest).toBeGreaterThan(0.99);
    });

    it('answers a back-to-back clear with the lighthouse\'s long flash', () => {
        const { world } = shared;
        begin(shared);
        stepTo(shared, START + 0.5);
        const quiet = world.signalShown;
        world.onClear({
            lines: 4, combo: 1, b2b: true, rows: [16, 17, 18, 19],
        });
        world.onB2B(1);
        stepTo(shared, START + 0.9);
        expect(world.signalShown).toBeGreaterThan(quiet + 0.5);
        expect(world.parts.life.light.flash).toBeGreaterThan(0.5);
    });

    it('calms its event reactions under reduced motion', () => {
        const { world } = shared;
        const thrown = (reduced) => {
            begin(shared);
            world.setReducedMotion(reduced);
            const before = world.motes.cursor;
            world.onLock({
                u: 0.3, rows: [19], color: PIECE_COLORS[2], hardDrop: true, distance: 14,
            });
            const speed = world.u.tables.gusts[1].z;
            return { motes: (world.motes.cursor - before + world.motes.count) % world.motes.count, speed };
        };
        const full = thrown(false);
        const calm = thrown(true);
        expect(calm.motes).toBeLessThan(full.motes);
        expect(calm.speed).toBeLessThan(full.speed);
        world.setReducedMotion(false);
    });
});

describe('High Coast: nothing dropped under fast play', () => {
    it('folds the mist it could not raise in time into the next breaths instead of losing it', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 2, combo: 1, rows: [18, 19] });
        const asked = world.siteQueue.length;
        // A frame long after: every site is stale, none rises late, all of it is carried.
        stepTo(shared, START + 2, 2);
        expect(world.siteQueue).toHaveLength(0);
        expect(world.siteCarry.mist).toBe(Math.min(24, asked));
        // The next clear's first breaths take it up.
        world.onClear({ lines: 1, combo: 1, rows: [19] });
        stepTo(shared, START + 3);
        expect(world.siteCarry.mist).toBeLessThan(Math.min(24, asked));
    });

    it('spawns into a spent mote slot rather than over one still flying', () => {
        const { world } = shared;
        begin(shared);
        const { motes } = world;
        const now = world.u.time.value;
        // The slot at the cursor still flies; the next one is spent.
        const c = motes.cursor;
        motes.start[c * 4 + 3] = now;
        motes.move[c * 4 + 3] = 5;
        const next = (c + 1) % motes.count;
        motes.start[next * 4 + 3] = now - 10;
        motes.move[next * 4 + 3] = 1;
        const i = motes.spawn({
            x: 0, y: 0, z: 0, born: now, life: 2,
        });
        expect(i).toBe(next);
    });
});
