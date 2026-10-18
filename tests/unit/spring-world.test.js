import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BLOOM_PATCH, FLOOD, FLUSH, ICE_OUT, REST_RIG, SPRING_PARTS, SpringWorld, fovForAspect, useValleyGround,
} from '../../src/themes/spring/spring-world.js';
import { TIMING } from '../../src/themes/spring/spring-core.js';
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
        expect(world.flights.slots.map((s) => s.kind?.id).sort()).toEqual([0, 1]);
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
