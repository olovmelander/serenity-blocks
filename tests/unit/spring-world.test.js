import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BLOOM_PATCH, FLOOD, FLUSH, HEAT, ICE_OUT, REST_RIG, SPRING_PARTS, STILL, SpringWorld, fovForAspect,
    useValleyGround,
} from '../../src/themes/spring/spring-world.js';
import { Rejoin, TIMING } from '../../src/themes/spring/spring-core.js';
import {
    EVENT_ROWS, PALETTE_ROWS, PATCHES, SURGES,
} from '../../src/themes/spring/spring-tsl.js';
import { EYE, S_POOL } from '../../src/themes/spring/spring-plan.js';
import { decodeValley } from '../../src/themes/spring/spring-terrain.js';
import { SPRING_FLOWERS } from '../../src/themes/spring/spring-flowers.js';
import { FLOE } from '../../src/themes/spring/spring-floes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
    // The shipped bake (the browser reads the same file); baking it here would take seconds.
    const file = path.resolve(here, '../../src/themes/spring/assets/spring-valley.bin');
    useValleyGround(decodeValley(new Uint8Array(zlib.inflateSync(fs.readFileSync(file)))));
});

function makeWorld(quality = 'Minimal', aspect = 16 / 9) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SpringWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 1600 / aspect, aspect);
    return { scene, camera, world };
}

const sim = (time, delta = 1 / 60) => ({
    time, delta, pointerX: 0, pointerY: 0,
});

function settle(world, camera, from, to, step = 1 / 30) {
    for (let t = from; t <= to + 1e-9; t += step) {
        world.updateCamera(camera, sim(t, step));
        world.update(sim(t, step), camera);
    }
}

const countObjects = (scene) => {
    let n = 0;
    scene.traverse(() => { n += 1; });
    return n;
};
const slotOf = (piece) => SPRING_FLOWERS.find((f) => f.piece === piece).slot;
const patch = (world, k) => ({
    where: world.u.tables.events[EVENT_ROWS.patch + k * 2],
    what: world.u.tables.events[EVENT_ROWS.patch + k * 2 + 1],
});
const livePatches = (world) => Array.from({ length: PATCHES }, (_, k) => patch(world, k))
    .filter((p) => p.where.z > -1e5);

describe('spring world: build and contract', () => {
    it('builds every part into the scene once, with a stable child count', () => {
        const { scene, camera, world } = makeWorld();
        expect(Object.keys(world.parts)).toEqual(['land', 'river', 'rocks', 'trees', 'woods', 'meadow', 'fx', 'sky']);
        expect(SPRING_PARTS).toEqual(Object.keys(world.parts));
        const before = countObjects(scene);
        settle(world, camera, 0, 1);
        world.onLock({ rows: [17], u: 0.2, shape: 'T' });
        world.onClear({ lines: 4, rowCodes: [], combo: 3 });
        world.onCombo(5);
        world.onClear({ lines: 2, tspin: true, combo: 6 });
        world.onClear({ lines: 4, perfect: true });
        world.levelUp(3);
        world.onGameOver();
        settle(world, camera, 1, 3);
        expect(countObjects(scene)).toBe(before);
        world.build();
        expect(countObjects(scene)).toBe(before);
        expect(world.getState().quality).toBe('Minimal');
        world.dispose();
        world.dispose();
        expect(scene.children.includes(world.root)).toBe(false);
    });

    it('frames the rest rig for every aspect', () => {
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        for (const aspect of [0.46, 0.75, 1, 16 / 9, 21 / 9]) {
            const fov = fovForAspect(aspect);
            expect(fov).toBeGreaterThan(1);
            expect(fov).toBeLessThan(179);
        }
    });

    it('keeps its palette table to the seven flowers', () => {
        const { world } = makeWorld();
        const linear = new THREE.Color();
        SPRING_FLOWERS.forEach((flower) => {
            linear.setHex(flower.petal);
            const row = world.u.tables.palette[PALETTE_ROWS.colour + flower.slot];
            expect(row.x).toBeCloseTo(linear.r, 6);
        });
        expect(world.u.tables.palette).toHaveLength(PALETTE_ROWS.count);
        world.dispose();
    });
});

describe('spring world: gameplay', () => {
    it('bursts a patch of the piece\'s own flower into bloom where the lock lands, beside the card', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        // A floor-row lock on the left lands on the knoll's meadow, left of the eye.
        world.onLock({ rows: [19], u: 0.1, shape: 'T' });
        const [left] = livePatches(world);
        expect(left.what.x).toBe(slotOf('T'));
        expect(left.what.y).toBe(BLOOM_PATCH.radius);
        expect(left.where.w).toBe(BLOOM_PATCH.soft);
        expect(left.where.x).toBeLessThan(EYE.x);
        expect(Math.hypot(left.where.x - EYE.x, left.where.y - EYE.z)).toBeLessThan(40);
        // A hard drop on the right opens a wider patch of its own flower, on the right.
        world.onLock({
            rows: [19], u: 0.9, shape: 'Z', hardDrop: true, distance: 12,
        });
        const right = patch(world, 1);
        expect(right.what.x).toBe(slotOf('Z'));
        expect(right.what.y).toBe(BLOOM_PATCH.hardRadius);
        expect(right.where.w).toBe(BLOOM_PATCH.hard);
        expect(right.where.x).toBeGreaterThan(EYE.x);
        // A lock high on the board lands on the water: it splashes, and its patch opens on the
        // knoll's near edge on that side.
        const { cursor } = world.motes;
        world.onLock({ rows: [2], u: 0.12, shape: 'S' });
        const third = patch(world, 2);
        expect(third.what.x).toBe(slotOf('S'));
        expect(Math.hypot(third.where.x - EYE.x, third.where.y - EYE.z)).toBeCloseTo(BLOOM_PATCH.onKnoll, 3);
        expect(third.where.x).toBeLessThan(EYE.x);
        expect(world.motes.cursor).not.toBe(cursor);
        expect(world.counts.locks).toBe(3);
        expect(world.counts.hardDrops).toBe(1);
        expect(world.getState().patches).toBe(3);
        world.dispose();
    });

    it('sends one surge down the rapids for a clear, bigger the more lines, and flushes the knoll into bloom', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 1);
        world.onClear({ lines: 1, rowCodes: [], combo: 1 });
        world.onClear({ lines: 4, rowCodes: [], combo: 2 });
        const surges = Array.from({ length: SURGES }, (_, k) => world.u.tables.events[EVENT_ROWS.surge + k])
            .filter((r) => r.x > -1e5);
        expect(surges).toHaveLength(2);
        expect(surges[1].y).toBeGreaterThan(surges[0].y);
        settle(world, camera, 1, 1 + FLUSH.rise + 0.5);
        expect(world.u.flush.value).toBeGreaterThan(0.9);
        settle(world, camera, 1 + FLUSH.rise + 0.5, 2 + FLUSH.rise + FLUSH.hold + FLUSH.fall);
        expect(world.u.flush.value).toBe(0);
        expect(world.counts.lines).toBe(5);
        world.dispose();
    });

    it('raises the flood with every link of a chain and lets it fall when the chain breaks', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        world.onCombo(6);
        settle(world, camera, 0.5, 8, 1 / 20);
        expect(world.flood).toBeCloseTo(FLOOD.perLink * 5, 1);
        expect(world.foamBoost).toBeGreaterThan(0.3);
        world.onCombo(0);
        settle(world, camera, 8, 22, 1 / 20);
        expect(world.flood).toBeLessThan(0.05);
        expect(world.counts.chainSteps).toBe(1);
        world.dispose();
    });

    it('sends the last of the ice out on four lines, down the rapids and away', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        expect(world.counts.quads).toBe(1);
        settle(world, camera, 0.5, 6, 1 / 20);
        expect(world.floes.live).toBe(Math.min(ICE_OUT.floes, world.tier.floes));
        const first = world.floes.floes.filter((f) => f.alive).map((f) => f.s);
        settle(world, camera, 6, 16, 1 / 20);
        const later = world.floes.floes.filter((f) => f.alive).map((f) => f.s);
        later.forEach((s, k) => expect(s).toBeGreaterThan(first[k]));
        expect(Math.min(...later)).toBeGreaterThan(S_POOL);
        settle(world, camera, 16, 6 + FLOE.life + 4, 1 / 4);
        expect(world.floes.live).toBe(0);
        world.dispose();
    });

    it('turns the pool in a whirl on a T-spin, throwing spray off its rim', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        const { cursor } = world.motes;
        world.onClear({
            lines: 2, rowCodes: [], combo: 1, tspin: true,
        });
        expect(world.u.whirl.value.x).toBe(world.time);
        expect(world.u.whirl.value.y).toBe(1);
        expect(world.motes.cursor).not.toBe(cursor);
        expect(world.counts.tspins).toBe(1);
        world.dispose();
    });

    it('brings whooper swans over on a perfect clear and cranes on a level-up', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        world.onClear({ lines: 4, perfect: true });
        world.levelUp(2);
        settle(world, camera, 0.5, 3);
        expect(world.flights.slots.filter((s) => s.kind).map((s) => s.kind.id).sort()).toEqual([0, 1]);
        expect(world.flights.live).toEqual([7, 9]);
        // A silent level-up (a rebuild in place) sends no birds.
        const { world: quiet } = makeWorld();
        quiet.levelUp(3, { silent: true });
        expect(quiet.flights.slots.every((s) => !s.kind)).toBe(true);
        quiet.dispose();
        world.dispose();
    });

    it('glitters while back-to-back lasts', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        world.onB2B(3);
        settle(world, camera, 0.5, 6, 1 / 20);
        expect(world.u.glory.value).toBeGreaterThan(0.9);
        world.onB2B(0);
        settle(world, camera, 6, 12, 1 / 20);
        expect(world.u.glory.value).toBeLessThan(0.05);
        world.dispose();
    });

    it('turns the light with the clock alone and steps it on a level-up', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.1);
        const az0 = world.light.az;
        settle(world, camera, 0.1, 60, 0.5);
        expect(world.light.az).not.toBeCloseTo(az0, 1);
        expect(world.level).toBe(1);
        const { place } = world.light;
        world.levelUp(2);
        settle(world, camera, 60, 60 + TIMING.levelTurn, 0.25);
        expect(world.light.place).toBeGreaterThan(place + 0.99);
        expect(world.counts.levelUps).toBe(1);
        world.levelUp(4, { silent: true });
        expect(world.counts.levelUps).toBe(1);
        world.dispose();
    });

    it('closes the flowers and falls to dusk at game over, and brings the light back with the next run', () => {
        const { camera, world } = makeWorld();
        world.setCaptureOverrides({ hour: 1 });
        settle(world, camera, 0, 0.5);
        const open = world.u.open.value;
        world.onGameOver();
        settle(world, camera, 0.5, 0.5 + TIMING.dusk + 0.5, 0.25);
        expect(world.u.open.value).toBeLessThan(open * 0.4);
        expect(world.u.dusk.value).toBeCloseTo(1, 3);
        world.onSessionStart();
        settle(world, camera, 7, 7 + TIMING.dawn + 0.5, 0.25);
        expect(world.u.open.value).toBeCloseTo(open, 2);
        expect(world.counts.mornings).toBe(1);
        world.dispose();
    });

    it('replays deterministically from a seek and carries its session across a rebuild', () => {
        const run = () => {
            const { camera, world } = makeWorld();
            world.seek(40);
            settle(world, camera, 40, 41);
            world.onLock({ rows: [15], u: 0.3, shape: 'S' });
            world.onClear({ lines: 2, rowCodes: [], combo: 2 });
            settle(world, camera, 41, 42);
            return world;
        };
        const a = run();
        const b = run();
        expect(a.u.tables.events.map((v) => v.toArray())).toEqual(b.u.tables.events.map((v) => v.toArray()));
        const state = a.exportSessionState();
        const { world: c } = makeWorld();
        c.importSessionState(state);
        expect(c.u.tables.events.map((v) => v.toArray())).toEqual(a.u.tables.events.map((v) => v.toArray()));
        expect(c.combo).toBe(a.combo);
        expect(c.wheel.exportState()).toEqual(a.wheel.exportState());
        c.importSessionState(null);
        [a, b, c].forEach((w) => w.dispose());
    });
});

describe('spring world: play builds instead of popping', () => {
    /** One frame, and what the valley shows in it. */
    const look = (world, camera, t, step = 1 / 30) => {
        world.updateCamera(camera, sim(t, step));
        world.update(sim(t, step), camera);
        const post = world.getPostState();
        return {
            flush: world.u.flush.value,
            whirl: world.poolWhirl.valueAt(t),
            flood: world.u.flood.value,
            foam: world.u.foamBoost.value,
            gust: world.u.gust.value,
            bow: world.u.bow.value,
            stir: world.u.air.value.z,
            saturation: post.saturation,
            exposure: post.exposure,
            open: Math.max(...world.u.tables.palette.map((row) => row.w)),
        };
    };

    it('takes an envelope up where it stands: a hit never steps it down, and it falls as before', () => {
        const env = new Rejoin({ rise: 0.6, holdEnd: 2.8, fallEnd: 6.3 });
        env.hit(1, 0);
        // Late in its fall, a weaker hit holds it where it stands instead of cutting it...
        const before = env.valueAt(5);
        env.hit(0.25, 5);
        expect(env.valueAt(5)).toBeCloseTo(before, 9);
        expect(env.valueAt(7)).toBeCloseTo(before, 9);
        // ...and a stronger one climbs from there, without a step, to its own power.
        env.hit(0.8, 7);
        expect(env.valueAt(7)).toBeCloseTo(before, 9);
        expect(env.valueAt(7.3)).toBeGreaterThan(before);
        expect(env.valueAt(7.6)).toBeCloseTo(0.8, 9);
        // Held: a weak hit while it holds keeps it held at full, from the hit on.
        env.reset();
        env.hit(1, 0);
        env.hit(0.2, 2);
        expect(env.valueAt(2)).toBeCloseTo(1, 9);
        expect(env.valueAt(4)).toBeCloseTo(1, 9);
        expect(env.valueAt(2 + 6.3)).toBe(0);
    });

    it('a weak clear right after a strong one never cuts the flush, the pool\'s whirl or the breath', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 1);
        world.onClear({
            lines: 4, rowCodes: [], combo: 1, tspin: true,
        });
        settle(world, camera, 1, 4);
        const quad = look(world, camera, 4);
        const breath = world.u.airWave.value.clone();
        // A single (and its own T-spin) mid-way through the quad's flush and whirl.
        world.onClear({
            lines: 1, rowCodes: [], combo: 2, tspin: true,
        });
        // (Through the hold they now share: past it they fall as any one does.)
        let last = quad;
        for (let t = 4 + 1 / 30; t < 5.5; t += 1 / 30) {
            const now = look(world, camera, t);
            expect(now.flush).toBeGreaterThanOrEqual(last.flush - 1e-6);
            expect(now.whirl).toBeGreaterThanOrEqual(last.whirl - 1e-6);
            last = now;
        }
        expect(last.flush).toBeGreaterThan(0.99);
        settle(world, camera, 5.5, 7);
        // The quad's breath still crosses the valley: the single's goes out beside it.
        const both = world.u.airWave.value;
        expect([both.x, both.y]).toEqual([breath.x, breath.y]);
        expect(both.z).toBeCloseTo(4, 3);
        // Later, a new breath goes out in place of the spent one (the other still crossing), and
        // a clear right after it feeds it instead of restarting it.
        world.onClear({ lines: 2, rowCodes: [], combo: 3 });
        expect(world.airWaveAt).toBe(world.time);
        expect(world.airWave2At).toBeCloseTo(4, 3);
        const sent = world.airWavePower;
        world.onClear({ lines: 2, rowCodes: [], combo: 4 });
        expect(world.airWaveAt).toBe(world.time);
        expect(world.airWavePower).toBeGreaterThan(sent);
        // A second perfect clear keeps the air still instead of letting it go and starting again.
        world.onClear({ lines: 4, perfect: true, crown: true });
        const at = 7.1 + STILL.rise + 2;
        settle(world, camera, 7.1, at);
        const still = world.u.air.value.w;
        const bloom = world.u.flush.value;
        world.onClear({ lines: 4, perfect: true, crown: true });
        expect(look(world, camera, at + 1 / 30).flush).toBeGreaterThanOrEqual(bloom - 1e-6);
        expect(world.u.air.value.w).toBeGreaterThanOrEqual(still - 1e-6);
        // The knoll stands in full flower again, from where it stood.
        expect(look(world, camera, at + FLUSH.rise + 0.1).flush).toBeGreaterThan(0.99);
        world.dispose();
    });

    it('a long chain reads hotter than its first clear, and the valley breathes back to calm', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 1);
        const rest = look(world, camera, 1);
        const shapes = ['I', 'O', 'L', 'T', 'S', 'Z', 'J'];
        let t = 1;
        const play = (n) => {
            world.onLock({
                rows: [18], u: 0.2 + 0.1 * (n % 6), shape: shapes[n % shapes.length], hardDrop: true, distance: 10,
            });
            world.onClear({
                lines: 1 + (n % 3), rowCodes: [], combo: n + 1, cascade: n === 8 ? 3 : 1, b2b: n === 10,
            });
            world.onCombo(n + 1);
        };
        play(0);
        settle(world, camera, t + 1 / 30, t + 0.6);
        const first = look(world, camera, t + 0.64);
        for (let n = 1; n < 12; n++) {
            t += 0.64;
            play(n);
            settle(world, camera, t + 1 / 30, t + 0.6);
        }
        t += 0.64;
        const peak = look(world, camera, t);
        expect(world.heat.stage).toBe(3);
        for (const key of ['flood', 'foam', 'gust', 'bow', 'stir', 'saturation', 'open']) {
            expect(peak[key], key).toBeGreaterThan(first[key]);
        }
        // The iris closes a little so the colours stay deep, and cranes come over for the fever.
        expect(peak.exposure).toBeLessThan(first.exposure);
        expect(world.counts.feverFlights).toBe(1);
        // At rest and under no play it is the valley as it always was.
        expect(rest).toMatchObject({
            flood: 0, foam: 0, gust: 1, bow: 1, stir: 0, saturation: 1.1, open: 0,
        });
        // The chain breaks and the hands rest: it all breathes back.
        world.onLock({ rows: [18], u: 0.5, shape: 'O' });
        world.onCombo(0);
        settle(world, camera, t, t + 25, 1 / 20);
        const after = look(world, camera, t + 25.05, 1 / 20);
        expect(after.flood).toBeLessThan(0.03);
        expect(after.gust).toBeCloseTo(1, 2);
        expect(after.bow).toBeCloseTo(1, 2);
        expect(after.saturation).toBeCloseTo(1.1, 3);
        expect(after.open).toBeLessThan(0.01);
        expect(world.heat.stage).toBe(0);
        world.dispose();
    });

    it('eases the breeze when a long chain breaks instead of snapping every blade back', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        world.onCombo(7);
        settle(world, camera, 0.5, 6);
        const leaning = world.u.gust.value;
        expect(leaning).toBeGreaterThan(1.5);
        world.onCombo(0);
        let last = leaning;
        for (let t = 6 + 1 / 60; t < 9; t += 1 / 60) {
            const now = look(world, camera, t, 1 / 60).gust;
            expect(last - now).toBeLessThan(0.02);
            last = now;
        }
        expect(last).toBeLessThan(leaning);
        world.dispose();
    });

    it.each(['Minimal', 'Medium', 'High'])('blooms a patch for every lock on %s, taking the most closed', (quality) => {
        const { camera, world } = makeWorld(quality);
        settle(world, camera, 0, 0.5);
        const shown = world.tier.patches;
        let t = 0.5;
        for (let n = 0; n < 12; n++) {
            world.onLock({ rows: [19], u: n % 2 ? 0.2 : 0.8, shape: 'T' });
            // The lock's own patch is one the meadow reads.
            const rows = Array.from({ length: shown }, (_, k) => patch(world, k).where);
            expect(rows.some((row) => row.z === world.time)).toBe(true);
            t += 1;
            settle(world, camera, t - 1 + 1 / 30, t);
        }
        // Nothing is written past what the tier reads.
        for (let k = shown; k < PATCHES; k++) expect(patch(world, k).where.z).toBeLessThan(-1e5);
        world.dispose();
    });

    it('sends a second ice-out without pulling the first off the river', () => {
        const { camera, world } = makeWorld('High');
        settle(world, camera, 0, 0.5);
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        settle(world, camera, 0.5, 8, 1 / 10);
        const first = world.floes.floes.filter((f) => f.alive).map((f) => f.born);
        world.onClear({ lines: 4, rowCodes: [], combo: 2 });
        const born = world.floes.floes.filter((f) => f.alive).map((f) => f.born);
        first.forEach((b) => expect(born).toContain(b));
        expect(born.length).toBeGreaterThan(first.length);
        world.dispose();
    });

    it('answers a T-spin that cleared nothing with a little whirl, and feeds the heat of play', () => {
        const { camera, world } = makeWorld();
        settle(world, camera, 0, 0.5);
        world.onLock({
            rows: [19], u: 0.3, shape: 'T', tspin: true,
        });
        expect(world.counts.spins).toBe(1);
        settle(world, camera, 0.5, 2);
        expect(world.poolWhirl.valueAt(2)).toBeGreaterThan(0.3);
        expect(world.poolWhirl.valueAt(2)).toBeLessThan(0.6);
        expect(world.heat.level).toBeGreaterThan(0.05);
        expect(HEAT.nudge).toBeGreaterThan(0);
        world.dispose();
    });
});
