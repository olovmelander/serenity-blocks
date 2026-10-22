/**
 * Pyrestorm — the world's choreography, run without a renderer: the bakes prepared once per tier, a
 * scene, a camera, and the world driven in fixed steps (camera, then events, then the frame, as the
 * theme does).
 *
 * The look is still being tuned, so what each beat does is held as properties — which counters it
 * moves, what it schedules, what lights up and for how long relative to TIMING, what stays within
 * its pool — not as numbers.
 */
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BOLT, FLASH_GAP, PYRESTORM_PARTS, PyrestormWorld, REST_RIG, bakeSliceMs, fovForAspect,
} from '../../src/themes/pyrestorm/pyrestorm-world.js';
import {
    CRATER, EYE, PIECE_COLORS, TIMING, VOLCANO, cellsFromMatrix, fireTint, hexToLinear, SHAPES,
} from '../../src/themes/pyrestorm/pyrestorm-core.js';
import { WALK, WATCHES } from '../../src/themes/pyrestorm/pyrestorm-hours.js';
import { HITS, LIGHTS } from '../../src/themes/pyrestorm/pyrestorm-tsl.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/pyrestorm/pyrestorm-quality.js';
import { BOMB } from '../../src/themes/pyrestorm/pyrestorm-fire.js';
import { fallbackLayout, outsideKeepOut } from '../../src/themes/pyrestorm/pyrestorm-composition.js';
import { REDUCED_FLASH_SCALE } from '../../src/utils/photosensitivity.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/** What the theme calls on its world (PLAYBOOK §2.4, with the director's onB2B/onGameOver/onSessionStart). */
const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'getPostState', 'getState', 'dispose',
    'onB2B', 'onGameOver', 'onSessionStart',
];
const START = 10;
const T_CELLS = cellsFromMatrix(SHAPES.T);
const prepared = {};
const worlds = [];

beforeAll(() => {
    // One preparation per tier (the land's grids; the tier-free bakes are shared) serves every
    // world in this file: the worlds only read it.
    for (const quality of QUALITY_NAMES) prepared[quality] = PyrestormWorld.prepareSync(quality);
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
    vi.restoreAllMocks();
});

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo(world, camera, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const s = sim(from + i * h, h);
        world.updateCamera(camera, s);
        world.update(s, camera);
    }
}

function makeWorld({
    quality = 'Minimal', width = 1600, height = 900, start = START,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PyrestormWorld({
        scene, quality, capture: true, prepared: prepared[quality],
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.seek(start);
    world.updateCamera(camera, sim(start, 0));
    world.update(sim(start, 0), camera);
    return {
        scene, camera, world, width, height,
    };
}

/** Every value the materials read, flattened (the light and hit tables included). */
function uniformValues(world) {
    const out = [];
    for (const [key, node] of Object.entries(world.u)) {
        if (key === 'tables' || !node || !('value' in node)) continue;
        const { value } = node;
        if (typeof value === 'number') out.push([key, value]);
        else if (value?.toArray) value.toArray().forEach((v, i) => out.push([`${key}.${i}`, v]));
    }
    for (const name of ['lights', 'hits']) {
        world.u.tables[name].forEach((row, r) => row.toArray().forEach((v, i) => out.push([`${name}[${r}].${i}`, v])));
    }
    world.bolts.tables.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`bolts[${r}].${i}`, v])));
    return out;
}

/** The ground bolts still waiting in the world's timed queue. */
const groundBolts = (world) => world.queue
    .filter((q) => q.at < Infinity && q.kind === 'bolt' && q.a === BOLT.ground).length;
const project = (camera, p) => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
};
/** Record what a lock throws: each spawned particle's kind, landing point and tint. */
function watchSpawns(world) {
    const thrown = [];
    const spawn = world.bombs.spawn.bind(world.bombs);
    vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
        thrown.push({
            kind: b.kind, land: [b.x + b.vx * b.life, b.y, b.z + b.vz * b.life], tint: [...b.tint],
        });
        return spawn(b);
    });
    return thrown;
}

describe('PyrestormWorld contract', () => {
    it('implements every method the theme calls, and exports its rig and parts', () => {
        for (const method of WORLD_METHODS) {
            expect(PyrestormWorld.prototype[method], `PyrestormWorld.${method}`).toBeTypeOf('function');
        }
        expect(PyrestormWorld.prepare).toBeTypeOf('function');
        expect(PyrestormWorld.prepareSync).toBeTypeOf('function');
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        for (let a = 0.46; a <= 21 / 9 + 1e-9; a += 0.05) {
            expect(fovForAspect(a)).toBeGreaterThan(1);
            expect(fovForAspect(a)).toBeLessThan(179);
        }
        expect(new Set(PYRESTORM_PARTS).size).toBe(PYRESTORM_PARTS.length);
    });

    it('works a frame between breaths, longer when the page is slow to give the thread back', () => {
        expect(bakeSliceMs(0)).toBe(24);
        expect(bakeSliceMs(8)).toBe(24);
        // A software renderer drawing the previous theme: a breath of half a second buys a second's work.
        expect(bakeSliceMs(500)).toBe(1000);
        expect(bakeSliceMs(60_000)).toBe(2000);
        expect(bakeSliceMs(Number.NaN)).toBe(24);
    });

    it('prepares the same land asynchronously, and gives up a preparation nobody wants', async () => {
        const data = await PyrestormWorld.prepare('Minimal');
        expect(data.quality).toBe('Minimal');
        expect([...data.land.fan.positions]).toEqual([...prepared.Minimal.land.fan.positions]);
        const controller = new AbortController();
        controller.abort();
        await expect(PyrestormWorld.prepare('Minimal', { signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('PyrestormWorld build', () => {
    it.each(QUALITY_NAMES)('builds every named part at %s into one root, with node materials only', (quality) => {
        const { world, scene } = makeWorld({ quality });
        expect(Object.keys(world.parts).sort()).toEqual([...PYRESTORM_PARTS].sort());
        expect(world.root.parent).toBe(scene);
        expect(scene.children).toEqual([world.root]);
        for (const name of PYRESTORM_PARTS) {
            const part = world.parts[name];
            for (const mesh of part.meshes || [part.mesh]) {
                expect(mesh.parent, name).toBe(world.root);
                expect(mesh.material.isNodeMaterial, name).toBe(true);
                expect(mesh.material.isShaderMaterial, name).toBeFalsy();
            }
        }
        // Each tier sizes its pools from its own row of the table.
        const tier = tierFor(quality);
        expect(world.bombs.count).toBe(tier.bombs);
        expect(world.smoke.count).toBe(tier.eventPuffs);
        expect(world.getState()).toMatchObject({ quality, parts: expect.arrayContaining(PYRESTORM_PARTS) });
        // Building twice builds nothing more.
        const children = world.root.children.length;
        expect(world.build()).toBe(world);
        expect(world.root.children).toHaveLength(children);
    });

    it('draws only the parts a capture asks for', () => {
        const { world } = makeWorld();
        world.showOnlyParts(['sky', 'land']);
        for (const name of PYRESTORM_PARTS) {
            const part = world.parts[name];
            const shown = name === 'sky' || name === 'land';
            for (const mesh of part.meshes || [part.mesh]) expect(mesh.visible, name).toBe(shown);
        }
        world.showOnlyParts(PYRESTORM_PARTS);
        expect(world.root.children.every((mesh) => mesh.visible)).toBe(true);
    });

    it('stands the camera at the eye on the rig for its aspect; reduced motion holds it still', () => {
        const { world, camera } = makeWorld();
        world.updateCamera(camera, sim(20, 0));
        expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
        expect(camera.fov).toBe(fovForAspect(16 / 9));
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        const at = (t, px = 0) => {
            world.updateCamera(camera, sim(t, 0, px));
            return camera.quaternion.clone();
        };
        expect(at(20).angleTo(at(37))).toBeGreaterThan(1e-4); // the lens breathes
        expect(at(20).angleTo(at(20, 1))).toBeGreaterThan(1e-3); // the pointer leans it
        world.setReducedMotion(true);
        expect(at(20).angleTo(at(37))).toBeLessThan(1e-6);
        expect(at(20).angleTo(at(20, 1))).toBeLessThan(1e-6);
        // It looks out across the plain, toward the volcano.
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        expect(forward.z).toBeLessThan(-0.8);
        const p = project(camera, [CRATER.x, CRATER.y, CRATER.z]);
        expect(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 && p.z < 1).toBe(true);
    });

    it('keeps the summit on screen and clear of the board card at every aspect', () => {
        const misses = [];
        for (let aspect = 0.46; aspect <= 21 / 9 + 1e-9; aspect += 0.04) {
            const height = 1000;
            const width = Math.round(aspect * height);
            const { world, camera } = makeWorld({ width, height });
            const p = project(camera, [CRATER.x, CRATER.y, CRATER.z]);
            const label = `aspect ${aspect.toFixed(2)}: summit at (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
            if (!(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 && p.z < 1)) misses.push(`${label} is off screen`);
            else if (!outsideKeepOut(fallbackLayout(width, height), p, 0)) misses.push(`${label} is behind the card`);
            world.dispose();
        }
        expect(misses).toEqual([]);
    });
});

describe('PyrestormWorld locks', () => {
    it('throws a burst of bombs from the crater on a lock, and more on a hard drop', () => {
        const { world, camera } = makeWorld();
        const thrown = watchSpawns(world);
        world.onLock({
            u: 0.3, rows: [18, 19], color: PIECE_COLORS[1], cells: T_CELLS,
        });
        const soft = thrown.filter((b) => b.kind === BOMB.bomb).length;
        expect(soft).toBeGreaterThan(0);
        expect(world.counts).toMatchObject({ locks: 1, hardDrops: 0 });
        thrown.length = 0;
        world.onLock({
            u: 0.3, rows: [18, 19], color: PIECE_COLORS[1], cells: T_CELLS, hardDrop: true, distance: 14,
        });
        const hard = thrown.filter((b) => b.kind === BOMB.bomb).length;
        expect(hard).toBeGreaterThan(soft);
        expect(world.counts).toMatchObject({ locks: 2, hardDrops: 1 });
        // A longer fall throws more still.
        thrown.length = 0;
        world.onLock({
            u: 0.3, rows: [18, 19], color: PIECE_COLORS[1], cells: T_CELLS, hardDrop: true, distance: 1,
        });
        expect(thrown.filter((b) => b.kind === BOMB.bomb).length).toBeLessThan(hard);
        // The bombs are in flight the moment after, and land where they splash.
        stepTo(world, camera, world.time + 0.5);
        expect(world.getState().bombs).toBeGreaterThan(0);
        stepTo(world, camera, world.time + TIMING.bombFlight + 1.5);
        expect(world.getState().hits).toBeGreaterThan(0);
    });

    it('throws a lock\'s bombs on arcs over the vent, each lying as an ember where its arc comes down', () => {
        const { world } = makeWorld();
        const thrown = [];
        const spawn = world.bombs.spawn.bind(world.bombs);
        vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
            thrown.push({ ...b });
            return spawn(b);
        });
        world.onLock({
            u: 0.4, rows: [19], color: PIECE_COLORS[1], cells: T_CELLS,
        });
        const bombs = thrown.filter((b) => b.kind === BOMB.bomb);
        const embers = thrown.filter((b) => b.kind === BOMB.ember);
        expect(bombs.length).toBeGreaterThan(4);
        expect(embers).toHaveLength(bombs.length);
        bombs.forEach((b, i) => {
            // It climbs well over the vent and draws a trail of its arc...
            expect(b.y + (b.vy * b.vy) / (2 * b.g)).toBeGreaterThan(CRATER.y + 100);
            expect(b.trail).toBeGreaterThan(0);
            // ...and its ember is born where and when the arc meets the ground.
            const e = embers[i];
            const t = b.life;
            expect(e.born).toBeCloseTo(b.born + t, 5);
            expect(e.x).toBeCloseTo(b.x + b.vx * t, 2);
            expect(e.z).toBeCloseTo(b.z + b.vz * t, 2);
            expect(e.y - 2).toBeCloseTo(b.y + b.vy * t - 0.5 * b.g * t * t, 1);
            expect(e.life).toBeGreaterThan(1);
        });
    });

    it('glows in the crater on a lock and lets it fade; locks as fast as frames hold it steady under its cap', () => {
        const { world, camera } = makeWorld();
        expect(world.u.burst.value).toBe(0);
        world.onLock({ u: 0.5, rows: [19], color: PIECE_COLORS[0] });
        stepTo(world, camera, world.time + 0.2);
        const lit = world.u.burst.value;
        expect(lit).toBeGreaterThan(0.2);
        // Its light reaches the cone and the cloud, and a puff of hot ash leaves the crater.
        expect(world.u.lightCount.value).toBeGreaterThan(0);
        expect(world.getState().eventPuffs).toBeGreaterThan(0);
        stepTo(world, camera, world.time + 4);
        expect(world.u.burst.value).toBeLessThan(lit * 0.05);
        // Hard drops every frame: a swell to a steady glow, never a strobe and never past its cap.
        let last = world.u.burst.value;
        let jump = 0;
        for (let k = 0; k < 90; k++) {
            world.onLock({
                u: 0.5, rows: [19], color: PIECE_COLORS[0], hardDrop: true, distance: 18,
            });
            stepTo(world, camera, world.time + 1 / 30);
            const now = world.u.burst.value;
            expect(now).toBeLessThanOrEqual(1.6);
            if (k > 15) jump = Math.max(jump, Math.abs(now - last));
            last = now;
        }
        expect(jump).toBeLessThan(0.05);
    });

    it('opens the crust with a tremor on a hard drop that fades', () => {
        const { world, camera } = makeWorld();
        world.onLock({ u: 0.5, rows: [19], color: PIECE_COLORS[0] });
        stepTo(world, camera, world.time + 1 / 30);
        expect(world.u.tremor.value).toBe(0);
        world.onLock({
            u: 0.5, rows: [19], color: PIECE_COLORS[0], hardDrop: true, distance: 18,
        });
        stepTo(world, camera, world.time + 1 / 30);
        const shaken = world.u.tremor.value;
        expect(shaken).toBeGreaterThan(0.5);
        stepTo(world, camera, world.time + 3);
        expect(world.u.tremor.value).toBeLessThan(shaken * 0.05);
    });

    it.each([[1600, 900], [2560, 1080], [900, 1600]])(
        'leans a burst the way the piece locked: left columns left, right columns right (%i × %i)',
        (width, height) => {
            const { world, camera } = makeWorld({ width, height });
            const thrown = watchSpawns(world);
            const meanX = (u) => {
                thrown.length = 0;
                for (let k = 0; k < 4; k++) world.onLock({ u, rows: [19], color: PIECE_COLORS[k] });
                const lands = thrown.filter((b) => b.kind === BOMB.bomb).map((b) => project(camera, b.land).x);
                return lands.reduce((a, b) => a + b, 0) / lands.length;
            };
            const left = meanX(0.05);
            const middle = meanX(0.5);
            const right = meanX(0.95);
            expect(left).toBeLessThan(middle);
            expect(middle).toBeLessThan(right);
        },
    );

    it('tints the fire a little by the piece\'s colour', () => {
        const { world } = makeWorld();
        const thrown = watchSpawns(world);
        const tintOf = (color) => {
            thrown.length = 0;
            world.onLock({ u: 0.5, rows: [19], color });
            return thrown.find((b) => b.kind === BOMB.bomb).tint;
        };
        const blue = tintOf('#2040FF');
        const orange = tintOf('#FF6A1F');
        expect(blue[2]).toBeGreaterThan(orange[2]);
        // Fire still: red is the strongest channel of either.
        expect(blue[0]).toBeGreaterThanOrEqual(blue[2]);
        expect(blue).toEqual([...fireTint(hexToLinear('#2040FF'), [0, 0, 0], 0.34)]);
        // No colour (a payload without one) throws the fire's own orange.
        expect(tintOf(undefined)).toEqual(tintOf('#FF6A1F'));
    });
});

describe('PyrestormWorld storm at rest', () => {
    it('keeps the storm alive at rest: a dim in-cloud glow most of the time, a crawler every few seconds', () => {
        const { world, camera } = makeWorld();
        world.seek(5);
        let glowFrames = 0;
        let frames = 0;
        const before = world.counts.spiders;
        for (let t = 5; t < 65; t += 0.1) {
            stepTo(world, camera, t);
            frames++;
            if (world.u.lightCount.value > 0) glowFrames++;
        }
        // Lit for much of the minute, not all of it (it swells and fades, never a strobe) ...
        expect(glowFrames / frames).toBeGreaterThan(0.4);
        expect(glowFrames / frames).toBeLessThan(1);
        // ... and the cloud flashes from inside every four to nine seconds.
        const crawlers = world.counts.spiders - before;
        expect(crawlers).toBeGreaterThanOrEqual(5);
        expect(crawlers).toBeLessThanOrEqual(16);
    });
});

describe('PyrestormWorld rebuild in place', () => {
    it('hands the night\'s wheel and the eruption to the new world: a rebuild never turns the night back', () => {
        const a = makeWorld();
        stepTo(a.world, a.camera, 30);
        a.world.levelUp(3);
        stepTo(a.world, a.camera, 45);
        a.world.onGameOver();
        stepTo(a.world, a.camera, 50);
        const state = JSON.parse(JSON.stringify(a.world.exportSessionState()));
        const placeA = a.world.wheel.place(50);
        const b = makeWorld();
        b.world.seek(50);
        b.world.importSessionState(state);
        expect(b.world.wheel.place(50)).toBeCloseTo(placeA, 9);
        expect(b.world.level).toBe(3);
        expect(b.world.activityTarget).toBe(a.world.activityTarget);
        // A next level-up steps on from there.
        b.world.levelUp(4);
        stepTo(b.world, b.camera, 60);
        expect(b.world.wheel.place(60)).toBeGreaterThan(placeA);
        // Malformed state is ignored, never thrown on.
        expect(() => b.world.importSessionState(null)).not.toThrow();
        expect(() => b.world.importSessionState({ wheel: 'x', level: 'y' })).not.toThrow();
    });
});

describe('PyrestormWorld clears', () => {
    it('flashes the blast at most once per FLASH_GAP however fast four-line clears arrive', () => {
        const { world, camera } = makeWorld();
        const quad = () => world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
        quad();
        const first = world.blastAt;
        expect(world.getPostState()).toBeTruthy();
        // A burst of quads (meditation taps): bombs and bolts every time, the flash once.
        for (let k = 0; k < 5; k++) {
            stepTo(world, camera, world.time + 0.15);
            quad();
        }
        expect(world.blastAt).toBe(first);
        expect(world.counts.quads).toBe(6);
        // The quads inside the gap are not dropped: one blast waits for the gap, stronger than the first.
        expect(world.blastDue).toBeCloseTo(first + FLASH_GAP, 9);
        stepTo(world, camera, first + FLASH_GAP + 0.05);
        expect(world.blastAt).toBeCloseTo(first + FLASH_GAP, 9);
        expect(world.blastPower).toBeGreaterThan(1);
        expect(world.getPostState().flash).toBeGreaterThan(0);
        quad();
        expect(world.blastAt).toBeGreaterThan(first);
        expect(world.blastAt).toBeLessThan(world.time);
    });

    it.each([1, 2, 3, 4])('schedules one ground bolt per line on a clear of %i (three and the discharge for four), staggered', (lines) => {
        const { world, camera } = makeWorld();
        const rows = Array.from({ length: lines }, (_, k) => 19 - k);
        const before = world.counts.bolts;
        world.onClear({ lines, rows, combo: 1 });
        // Four lines: three ground strokes, then the blast's discharge is the fourth, brightest beat.
        const ground = lines === 4 ? 3 : lines;
        expect(groundBolts(world)).toBe(ground);
        expect(world.counts).toMatchObject({ clears: 1, lines });
        const due = world.queue.filter((q) => q.at < Infinity && q.kind === 'bolt' && q.a === BOLT.ground)
            .map((q) => q.at).sort((a, b) => a - b);
        for (let k = 1; k < due.length; k++) expect(due[k] - due[k - 1]).toBeCloseTo(TIMING.boltStagger, 9);
        stepTo(world, camera, world.time + TIMING.boltStagger * lines + 1.5);
        expect(groundBolts(world)).toBe(0);
        // Four lines add the blast's discharge from the cloud.
        expect(world.counts.bolts - before).toBe(ground + (lines === 4 ? 1 : 0));
        expect(world.counts.quads).toBe(lines === 4 ? 1 : 0);
    });

    it('strikes high on the cone for a high row and out on the plain for the floor', () => {
        const { world, camera } = makeWorld();
        const strike = (row) => {
            world.onClear({ lines: 1, rows: [row], combo: 1 });
            stepTo(world, camera, world.time + 1 / 30);
            const slot = world.boltSlots[(world.boltCursor + world.boltSlots.length - 1) % world.boltSlots.length];
            return Math.hypot(slot.b[0] - VOLCANO.x, slot.b[2] - VOLCANO.z);
        };
        for (let k = 0; k < 5; k++) expect(strike(0)).toBeLessThan(strike(19));
        // The strike lights the ground where it lands (a hit) and the cloud (a light).
        world.onClear({ lines: 1, rows: [10], combo: 1 });
        stepTo(world, camera, world.time + TIMING.leader + 0.05);
        expect(world.getState().lights).toBeGreaterThan(0);
        expect(world.getState().hits).toBeGreaterThan(0);
    });

    it.each([[1600, 900], [2560, 1080]])('places nearly every strike where it shows (%i × %i)', (width, height) => {
        const { world, camera } = makeWorld({ width, height });
        const layout = fallbackLayout(width, height);
        let shown = 0;
        let total = 0;
        for (const row of [0, 5, 10, 15, 19]) {
            for (let k = 0; k < 6; k++) {
                world.onClear({ lines: 1, rows: [row], combo: 1 });
                stepTo(world, camera, world.time + 1 / 30);
                const slot = world.boltSlots[(world.boltCursor + world.boltSlots.length - 1) % world.boltSlots.length];
                const p = project(camera, slot.b);
                total++;
                if (p.z < 1 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 && outsideKeepOut(layout, p, 0)) shown++;
            }
        }
        expect(shown / total).toBeGreaterThan(0.85);
    });

    it('blasts the crater on four lines: a flash, the shock front, the surge, the discharge', () => {
        const { world, camera } = makeWorld();
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
        expect(world.counts.quads).toBe(1);
        expect(world.blastAt).toBe(world.time);
        // The flash is one, eased, never a strobe: it only falls after its kick, and is soon gone.
        const flashes = [];
        for (let k = 0; k < 30; k++) {
            stepTo(world, camera, world.time + 1 / 30);
            flashes.push(world.getPostState().flash);
            if (k === 0) expect(world.getState().lights).toBeGreaterThan(0); // the crater flashes
        }
        expect(flashes[0]).toBeGreaterThan(0);
        for (let k = 1; k < flashes.length; k++) expect(flashes[k], `frame ${k}`).toBeLessThanOrEqual(flashes[k - 1]);
        expect(flashes[flashes.length - 1]).toBe(0);
        // A second after the blast the shock front is still crossing the cloud, and the surge rolls
        // down the breach.
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(world.getState().eventPuffs).toBeGreaterThan(0);
        // The front races outward, then is gone.
        const r1 = world.u.shock.value.x;
        stepTo(world, camera, world.time + 0.5);
        expect(world.u.shock.value.x).toBeGreaterThan(r1);
        stepTo(world, camera, world.blastAt + TIMING.shock + 0.1);
        expect(world.u.shock.value.y).toBe(0);
    });

    it('blows a vortex ring on a T-spin', () => {
        const { world, camera } = makeWorld();
        world.onClear({
            lines: 2, rows: [19, 18], combo: 1, tspin: true,
        });
        expect(world.counts.tspins).toBe(1);
        stepTo(world, camera, world.time + 1);
        expect(world.getState().eventPuffs).toBeGreaterThan(0);
        stepTo(world, camera, world.time + TIMING.ring + 1);
        expect(world.getState().eventPuffs).toBe(0);
    });

    it('sweeps sheet lightning across the anvil on a perfect clear, with a crown of bolts, then lets it go', () => {
        const { world, camera } = makeWorld();
        const { clears, bolts } = world.counts;
        world.onClear({ lines: 4, perfect: true });
        expect(world.counts.perfects).toBe(1);
        expect(world.counts.clears).toBe(clears); // a perfect clear is its own moment, not a clear
        stepTo(world, camera, world.time + TIMING.sheet * 0.5);
        expect(world.u.sheet.value.y).toBeGreaterThan(0.5);
        expect(world.u.sheet.value.x).toBeGreaterThan(0);
        expect(world.u.sheet.value.x).toBeLessThan(1);
        stepTo(world, camera, world.sheetAt + TIMING.sheet + TIMING.sheetFade + 0.1);
        expect(world.u.sheet.value.y).toBe(0);
        expect(world.counts.bolts - bolts).toBeGreaterThanOrEqual(4);
        expect(world.getPostState().flash).toBe(0);
    });
});

describe('PyrestormWorld chains', () => {
    it('charges the storm while a chain holds: spider lightning crawls the anvil, the fountain climbs', () => {
        const { world, camera } = makeWorld();
        const fountain = world.fountainLevel;
        for (let n = 1; n <= 6; n++) {
            world.onCombo(n);
            stepTo(world, camera, world.time + 0.8);
        }
        expect(world.counts.chainSteps).toBe(5); // a chain of one is no step
        expect(world.charge).toBeGreaterThan(0.3);
        expect(world.u.charge.value).toBe(world.charge);
        expect(world.counts.spiders).toBeGreaterThan(0);
        expect(world.fountainLevel).toBeGreaterThan(fountain);
        // A longer chain charges further.
        const six = world.charge;
        for (let n = 7; n <= 10; n++) world.onCombo(n);
        stepTo(world, camera, world.time + 4);
        expect(world.charge).toBeGreaterThan(six);
        expect(world.charge).toBeLessThanOrEqual(1);
    });

    it('discharges a long chain from the anvil to the summit when it breaks, and only a long one', () => {
        const release = (peak) => {
            const { world, camera } = makeWorld();
            for (let n = 1; n <= peak; n++) world.onCombo(n);
            const before = world.counts.bolts;
            world.onCombo(0);
            stepTo(world, camera, world.time + 1);
            const { discharges, bolts } = world.counts;
            const out = { discharged: discharges, bolts: bolts - before, peak: world.peak };
            world.dispose();
            return out;
        };
        const table = Array.from({ length: 8 }, (_, i) => release(i + 1));
        const first = table.findIndex((r) => r.discharged > 0) + 1;
        expect(first).toBeGreaterThanOrEqual(3);
        expect(first).toBeLessThanOrEqual(5);
        table.forEach((r, i) => {
            expect(r.discharged, `peak ${i + 1}`).toBe(i + 1 >= first ? 1 : 0);
            if (r.discharged) expect(r.bolts).toBeGreaterThanOrEqual(1);
            expect(r.peak).toBe(0); // the chain is forgotten once it breaks
        });
    });

    it('lets the storm drain when the chain is gone', () => {
        const { world, camera } = makeWorld();
        for (let n = 1; n <= 8; n++) world.onCombo(n);
        stepTo(world, camera, world.time + 5);
        const charged = world.charge;
        world.onCombo(0);
        stepTo(world, camera, world.time + 3 / TIMING.chargeFall);
        expect(world.charge).toBeLessThan(charged * 0.2);
    });

    it('wears St Elmo\'s corona while a back-to-back run lasts', () => {
        const { world, camera } = makeWorld();
        world.onB2B(2);
        world.onB2B(3);
        expect(world.counts.b2bSteps).toBe(2);
        stepTo(world, camera, world.time + 5);
        expect(world.u.corona.value).toBeGreaterThan(0.5);
        world.onB2B(0);
        stepTo(world, camera, world.time + 6);
        expect(world.u.corona.value).toBeLessThan(0.01);
        expect(world.counts.b2bSteps).toBe(2);
    });
});

describe('PyrestormWorld: the night and the run', () => {
    it('drifts the watch with the clock alone at level 1, with no gameplay', () => {
        const { world, camera } = makeWorld({ start: 0 });
        expect(world.getState().watch).toMatchObject({ place: 0, from: WALK[0], name: WATCHES[WALK[0]].name });
        const zenith = world.u.zenith.value.clone();
        stepTo(world, camera, 60, 0.5);
        expect(world.getState().watch.place).toBeCloseTo(60 / TIMING.watch, 9);
        expect(world.getState().level).toBe(1);
        expect(world.u.zenith.value.equals(zenith)).toBe(false);
        stepTo(world, camera, TIMING.watch, 0.5);
        expect(world.getState().watch.from).toBe(WALK[1]);
    });

    it('moves the night a watch on at a level-up and sends a surge of lava down every channel', () => {
        const { world, camera } = makeWorld();
        world.levelUp(2);
        expect(world.counts.levelUps).toBe(1);
        stepTo(world, camera, world.time + 1);
        expect(world.u.pulse.value.y).toBeGreaterThan(0);
        stepTo(world, camera, world.pulseAt + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.watch).toBeCloseTo(1, 9);
        stepTo(world, camera, world.pulseAt + 14);
        expect(world.u.pulse.value.y).toBe(0);
        // A silent level-up (a rebuild restoring the run) neither counts nor surges.
        world.levelUp(3, { silent: true });
        expect(world.counts.levelUps).toBe(1);
        stepTo(world, camera, world.time + 0.1);
        expect(world.light.place - world.time / TIMING.watch).toBeCloseTo(2, 9);
        expect(world.u.pulse.value.y).toBe(0);
    });

    it('turns the night at once on a level-up under reduced motion', () => {
        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        world.levelUp(2);
        stepTo(world, camera, world.time + 1 / 30);
        expect(world.light.place - world.time / TIMING.watch).toBeCloseTo(1, 9);
        expect(world.getState().reducedMotion).toBe(true);
    });

    it('sinks the eruption at game over and wakes it with the next run', () => {
        const { world, camera } = makeWorld();
        world.onGameOver();
        expect(world.counts.gameOvers).toBe(1);
        stepTo(world, camera, world.time + TIMING.sink * 1.5);
        const sunk = world.activity;
        expect(sunk).toBeLessThan(0.5);
        expect(world.u.activity.value).toBe(sunk);
        expect(world.getPostState().heat).toBeLessThan(1);
        // The next lock (or the mode starting) wakes it.
        world.onLock({ u: 0.5, rows: [19], color: PIECE_COLORS[3] });
        expect(world.counts.wakes).toBe(1);
        stepTo(world, camera, world.time + TIMING.wake * 1.5);
        expect(world.activity).toBeGreaterThan(0.9);
        // A session start while awake wakes nothing.
        world.onSessionStart();
        expect(world.counts.wakes).toBe(1);
        world.onGameOver();
        world.onSessionStart();
        expect(world.counts.wakes).toBe(2);
    });

    it('keeps the night through a new run, and the next level-up steps forward from it', () => {
        const { world, camera } = makeWorld();
        world.levelUp(2);
        world.levelUp(3);
        for (let n = 1; n <= 3; n++) world.onCombo(n);
        world.onB2B(2);
        stepTo(world, camera, world.time + TIMING.levelTurn + 0.2);
        const { place } = world.light;
        expect(place - world.time / TIMING.watch).toBeCloseTo(2, 9);
        world.resetSession();
        expect(world).toMatchObject({
            level: 1, combo: 0, peak: 0, b2b: 0,
        });
        stepTo(world, camera, world.time + 1 / 30);
        expect(world.light.place).toBeCloseTo(place + 1 / 30 / TIMING.watch, 9);
        world.levelUp(2);
        stepTo(world, camera, world.time + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.watch).toBeCloseTo(3, 9);
    });

    it('holds a capture\'s watch when asked', () => {
        const { world, camera } = makeWorld();
        world.setCaptureOverrides({ watch: 3 });
        stepTo(world, camera, world.time + 30);
        expect(world.light.place).toBe(3);
        expect(world.getState().watch.name).toBe(WATCHES[WALK[3]].name);
    });
});

describe('PyrestormWorld state', () => {
    /** A session with something of everything in it. */
    function play(world, camera) {
        const t = world.time;
        stepTo(world, camera, t + 0.5);
        world.onLock({
            u: 0.2, rows: [18], color: PIECE_COLORS[0], cells: T_CELLS,
        });
        world.onLock({
            u: 0.7, rows: [19], color: PIECE_COLORS[2], cells: T_CELLS, hardDrop: true, distance: 14,
        });
        world.onClear({ lines: 2, rows: [19, 18], combo: 1 });
        world.onCombo(1);
        stepTo(world, camera, t + 1.5);
        for (let n = 2; n <= 6; n++) {
            world.onLock({ u: n / 9, rows: [19], color: PIECE_COLORS[n % 7] });
            world.onClear({ lines: 1, rows: [19], combo: n });
            world.onCombo(n);
            stepTo(world, camera, world.time + 0.7);
        }
        world.onClear({
            lines: 4, rows: [19, 18, 17, 16], combo: 7, tspin: true,
        });
        world.onCombo(7);
        stepTo(world, camera, world.time + 1);
        world.onLock({ u: 0.5, rows: [19], color: PIECE_COLORS[3] });
        world.onCombo(0);
        world.onB2B(2);
        world.levelUp(2);
        stepTo(world, camera, world.time + 2);
        world.onClear({ lines: 4, perfect: true });
        world.onGameOver();
        stepTo(world, camera, world.time + 3);
        world.onSessionStart();
        stepTo(world, camera, world.time + 1);
    }

    const snapshot = (world) => ({
        state: world.getState(),
        uniforms: uniformValues(world),
        puffs: [...world.smoke.puff],
        bombs: [...world.bombs.start, ...world.bombs.move, ...world.bombs.look],
        post: { ...world.getPostState() },
    });

    it('replays the same session to the same frame after a seek, in the same world and in a fresh one', () => {
        const a = makeWorld();
        play(a.world, a.camera);
        const first = snapshot(a.world);
        expect(first.state.counts).toMatchObject({
            locks: 8, hardDrops: 1, quads: 1, tspins: 1, perfects: 1, discharges: 1, levelUps: 1, gameOvers: 1,
        });
        a.world.seek(START);
        a.world.updateCamera(a.camera, sim(START, 0));
        a.world.update(sim(START, 0), a.camera);
        play(a.world, a.camera);
        expect(snapshot(a.world)).toEqual(first);
        const b = makeWorld();
        play(b.world, b.camera);
        expect(snapshot(b.world)).toEqual(first);
    });

    it('forgets everything at a seek: the session, the queue, the pools and the night\'s level', () => {
        const { world, camera } = makeWorld();
        play(world, camera);
        world.seek(START);
        world.updateCamera(camera, sim(START, 0));
        world.update(sim(START, 0), camera);
        expect(world.getState()).toMatchObject({
            time: START, level: 1, combo: 0, peak: 0, b2b: 0, liveBolts: 0, hits: 0, bombs: 0, eventPuffs: 0,
        });
        expect(Object.values(world.getState().counts).every((n) => n === 0)).toBe(true);
        expect(world.queue.every((q) => q.at === Infinity)).toBe(true);
        expect(world.getState().watch.place).toBeCloseTo(START / TIMING.watch, 12);
    });

    it('keeps its light and hit tables within their rows, their counts matching the rows in use', () => {
        const { world, camera } = makeWorld();
        const check = (label) => {
            const { lights, hits } = world.u.tables;
            expect(lights).toHaveLength(LIGHTS * 2);
            expect(hits).toHaveLength(HITS * 2);
            const lightCount = world.u.lightCount.value;
            const hitCount = world.u.hitCount.value;
            expect(lightCount, label).toBeLessThanOrEqual(LIGHTS);
            expect(hitCount, label).toBeLessThanOrEqual(HITS);
            for (let i = 0; i < LIGHTS; i++) {
                const parked = lights[i * 2].y === -1e5;
                expect(parked, `${label}: light row ${i} of ${lightCount}`).toBe(i >= lightCount);
                if (!parked) expect(lights[i * 2].w, label).toBeGreaterThan(0);
            }
            for (let i = 0; i < HITS; i++) {
                expect(hits[i * 2].y === -1e5, `${label}: hit row ${i} of ${hitCount}`).toBe(i >= hitCount);
            }
            expect(world.getState()).toMatchObject({ lights: lightCount, hits: hitCount });
        };
        check('at rest');
        const most = { lights: 0, hits: 0 };
        const note = () => {
            most.lights = Math.max(most.lights, world.u.lightCount.value);
            most.hits = Math.max(most.hits, world.u.hitCount.value);
        };
        for (let k = 0; k < 6; k++) {
            // A storm of play: two locks and a clear of four, twice a second.
            world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: k + 1 });
            for (let n = 0; n < 2; n++) world.onLock({ u: n, rows: [19], color: PIECE_COLORS[n + k] });
            for (let s = 0; s < 5; s++) {
                stepTo(world, camera, world.time + 0.1);
                check(`storm ${k}.${s}`);
                note();
            }
        }
        for (let s = 0; s < 30; s++) {
            stepTo(world, camera, world.time + 0.1);
            check(`after ${s}`);
            note();
        }
        // More was lit at once than the tables hold: they filled, and never overflowed.
        expect(most).toEqual({ lights: LIGHTS, hits: HITS });
        // The chain breaks (its discharge strikes) and the storm drains: the strikes go out; only the
        // storm's slow life at rest stays (a dim in-cloud glow, now and then a crawler).
        world.onCombo(0);
        stepTo(world, camera, world.time + 4 / TIMING.chargeFall + 4);
        check('after the storm');
        expect(world.u.lightCount.value).toBeLessThanOrEqual(2);
        expect(world.u.hitCount.value).toBe(0);
        // When the eruption sinks (game over) the storm goes quiet.
        world.onGameOver();
        stepTo(world, camera, world.time + TIMING.sink * 2 + 4);
        check('sunk');
        expect(world.u.lightCount.value).toBe(0);
    });

    it('survives a burst of two hundred hard drops inside its pools', () => {
        const { world, camera, scene } = makeWorld();
        const children = world.root.children.length;
        const queue = world.queue.length;
        expect(() => {
            for (let i = 0; i < 200; i++) {
                world.onLock({
                    u: (i % 10) / 9,
                    rows: [19 - (i % 6)],
                    color: PIECE_COLORS[i % 8],
                    cells: T_CELLS,
                    hardDrop: true,
                    distance: 18,
                });
                if (i % 4 === 0) stepTo(world, camera, world.time + 1 / 60);
            }
            stepTo(world, camera, world.time + 1);
        }).not.toThrow();
        expect(world.counts.hardDrops).toBe(200);
        expect(world.bombs.cursor).toBeLessThan(world.bombs.count);
        expect(world.getState().bombs).toBeLessThanOrEqual(world.bombs.count);
        expect(world.queue).toHaveLength(queue);
        expect(world.root.children).toHaveLength(children);
        expect(scene.children).toEqual([world.root]);
        uniformValues(world).forEach(([key, v]) => expect(Number.isFinite(v), key).toBe(true));
    });

    it('never grows its scene: every event plays in what was built', () => {
        const { world, camera, scene } = makeWorld();
        const children = world.root.children.length;
        const meshes = [...world.root.children];
        world.onLock({ u: 0.4, rows: [19], color: PIECE_COLORS[0] });
        world.onLock({
            u: 0.4, rows: [19], color: PIECE_COLORS[0], hardDrop: true, distance: 9,
        });
        for (const lines of [1, 2, 3, 4]) {
            world.onClear({ lines, rows: [19, 18, 17, 16].slice(0, lines), combo: lines });
        }
        world.onClear({
            lines: 2, rows: [19, 18], combo: 1, tspin: true,
        });
        world.onClear({ lines: 4, perfect: true });
        for (let n = 1; n <= 6; n++) world.onCombo(n);
        world.onCombo(0);
        world.onB2B(3);
        world.levelUp(2);
        world.onGameOver();
        world.onSessionStart();
        world.resetSession();
        stepTo(world, camera, world.time + 6);
        expect(world.root.children).toHaveLength(children);
        expect(world.root.children).toEqual(meshes);
        expect(scene.children).toEqual([world.root]);
        expect(world.getState().sceneChildren).toBe(children);
    });

    it('keeps every uniform finite over a long scripted session, and hands the post one reused object', () => {
        const { world, camera } = makeWorld({ start: 0 });
        const post = world.getPostState();
        const bad = [];
        let combo = 0;
        for (let frame = 1; frame <= 1800; frame++) {
            const t = frame / 15;
            if (frame % 22 === 0) {
                world.onLock({
                    u: (frame * 0.173) % 1,
                    rows: [19 - (frame % 20)],
                    color: PIECE_COLORS[frame % 8],
                    cells: T_CELLS,
                    hardDrop: frame % 66 === 0,
                    distance: frame % 19,
                });
            }
            if (frame % 44 === 0) {
                const lines = 1 + (frame % 4);
                combo = frame % 440 < 330 ? combo + 1 : 0;
                world.onClear({
                    lines, rows: [19, 18, 17, 16].slice(0, lines), combo: Math.max(1, combo), tspin: frame % 352 === 0,
                });
                world.onCombo(combo);
                world.onB2B(lines === 4 ? Math.min(4, world.b2b + 1) : 0);
            }
            if (frame === 900) world.onClear({ lines: 4, perfect: true });
            if (frame % 600 === 0) world.levelUp(world.level + 1);
            if (frame === 1300) world.onGameOver();
            if (frame === 1360) world.resetSession();
            world.updateCamera(camera, sim(t, 1 / 15, Math.sin(t), Math.cos(t * 0.7)));
            world.update(sim(t, 1 / 15), camera);
            expect(world.getPostState()).toBe(post);
            if (frame % 30 === 0) {
                for (const [key, v] of uniformValues(world)) {
                    if (!Number.isFinite(v)) bad.push(`${key} at ${t.toFixed(2)} s: ${v}`);
                }
                const values = [
                    post.exposure, post.bloomBoost, post.flash, post.heat, post.saturation, ...post.flashColour,
                ];
                for (const v of values) {
                    if (!Number.isFinite(v)) bad.push(`post at ${t.toFixed(2)} s: ${JSON.stringify(post)}`);
                }
            }
        }
        expect(bad.slice(0, 10)).toEqual([]);
        expect(world.counts.locks).toBeGreaterThan(50);
        expect(world.counts.gameOvers).toBe(1);
        // The flash a big moment gives is small: never more than half the frame's light.
        expect(post.flash).toBeLessThanOrEqual(0.5);
    });
});

describe('PyrestormWorld builds with play', () => {
    const hardDrop = (world, k = 0) => world.onLock({
        u: (k % 10) / 9, rows: [19], color: PIECE_COLORS[k % 7], cells: T_CELLS, hardDrop: true, distance: 18,
    });
    /** A chain like the tray's Fever: a hard-dropped clearing lock every 0.64 s, the combo climbing. */
    function chain(world, camera, steps, sample) {
        for (let n = 1; n <= steps; n++) {
            hardDrop(world, n);
            world.onClear({
                lines: 1 + (n % 3), rows: [19, 18, 17].slice(0, 1 + (n % 3)), combo: n,
            });
            world.onCombo(n);
            stepTo(world, camera, world.time + 0.64);
            sample?.(n);
        }
    }

    it.each(['Minimal', 'High'])('never cuts a bomb mid-arc under fast hard drops (%s)', (quality) => {
        const { world, camera } = makeWorld({ quality });
        const thrown = watchSpawns(world);
        const perDrop = [];
        for (let k = 0; k < 30; k++) {
            thrown.length = 0;
            hardDrop(world, k);
            perDrop.push(thrown.filter((b) => b.kind === BOMB.bomb).length);
            stepTo(world, camera, world.time + 0.3);
        }
        stepTo(world, camera, world.time + 8);
        // Every bomb thrown flew its whole arc and every ember it promised lay where it landed...
        expect(world.bombs.cut).toBe(0);
        // ...while the pool was full (sparks and cooling embers gave way) and later bursts threw fewer.
        expect(world.bombs.evicted).toBeGreaterThan(0);
        expect(Math.min(...perDrop.slice(10))).toBeGreaterThan(0);
        expect(Math.min(...perDrop.slice(10))).toBeLessThan(perDrop[0]);
    });

    it('never cuts the light with a weak event after a strong one', () => {
        const a = makeWorld();
        const b = makeWorld();
        for (const { world } of [a, b]) world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
        stepTo(a.world, a.camera, a.world.time + 0.1);
        stepTo(b.world, b.camera, b.world.time + 0.1);
        // One world answers a plain lock and a single on top of the quad; the other lets it play.
        b.world.onLock({ u: 0.5, rows: [19], color: PIECE_COLORS[0] });
        b.world.onClear({ lines: 1, rows: [19], combo: 2 });
        for (let k = 0; k < 90; k++) {
            stepTo(a.world, a.camera, a.world.time + 1 / 30);
            stepTo(b.world, b.camera, b.world.time + 1 / 30);
            const label = `frame ${k}`;
            expect(b.world.u.burst.value, label).toBeGreaterThanOrEqual(a.world.u.burst.value - 1e-9);
            expect(b.world.u.fountain.value, label).toBeGreaterThanOrEqual(a.world.u.fountain.value - 1e-9);
            expect(b.world.getPostState().flash, label).toBeGreaterThanOrEqual(a.world.getPostState().flash - 1e-9);
        }
    });

    it('builds through a long chain: the fountain, the rivers, the crust and the storm all climb into a fever', () => {
        const { world, camera } = makeWorld();
        const rest = {
            fountain: world.u.fountain.value, lavaHeat: world.u.lavaHeat.value, tremor: world.u.tremor.value,
        };
        const at = {};
        chain(world, camera, 12, (n) => {
            if (n === 1 || n === 12) {
                at[n] = {
                    fountain: world.u.fountain.value,
                    lavaHeat: world.u.lavaHeat.value,
                    tremor: world.u.tremor.value,
                    charge: world.charge,
                    exposure: world.getPostState().exposure,
                    stage: world.play.stage,
                };
            }
        });
        expect(at[12].fountain).toBeGreaterThan(at[1].fountain + 0.5);
        expect(at[12].lavaHeat).toBeGreaterThan(at[1].lavaHeat * 1.08);
        expect(at[12].tremor).toBeGreaterThan(at[1].tremor + 0.1);
        expect(at[12].charge).toBeGreaterThan(at[1].charge);
        // The iris closes as the fire adds light, so the colours hold.
        expect(at[12].exposure).toBeLessThan(at[1].exposure);
        expect(at[12].stage).toBe(3);
        // In the fever the storm breaks: strokes onto the plain with no clear to throw them.
        const { bolts } = world.counts;
        stepTo(world, camera, world.time + 2);
        expect(world.counts.bolts).toBeGreaterThan(bolts);
        // The hands rest: the mountain breathes back to how it was.
        world.onLock({ u: 0.5, rows: [19], color: PIECE_COLORS[0] });
        world.onCombo(0);
        stepTo(world, camera, world.time + 20);
        expect(world.play.stage).toBe(0);
        expect(world.u.fountain.value).toBeLessThan(rest.fountain + 0.08);
        expect(world.u.lavaHeat.value).toBeLessThan(world.light.lavaHeat * 1.01);
        expect(world.u.tremor.value).toBeLessThan(0.02);
        expect(world.getPostState().exposure).toBeGreaterThan(0.99);
    });

    it('builds a cascade wave on wave: each strikes harder than the last', () => {
        const { world } = makeWorld();
        const power = (cascade) => {
            world.queue.forEach((q) => { q.at = Infinity; });
            world.onClear({
                lines: 1, rows: [19], combo: 1, cascade,
            });
            const bolts = world.queue.filter((q) => q.at < Infinity && q.kind === 'bolt');
            return { strokes: bolts.length, power: Math.max(...bolts.map((q) => q.c)) };
        };
        const waves = [1, 2, 3, 4, 5].map(power);
        for (let k = 1; k < waves.length; k++) expect(waves[k].power).toBeGreaterThan(waves[k - 1].power);
        expect(waves[4].strokes).toBeGreaterThan(waves[0].strokes);
    });

    it('crowns the clear still playing on a late perfect clear: no second blast, the charge spent', () => {
        const { world, camera } = makeWorld();
        chain(world, camera, 6);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 7 });
        const blast = world.blastAt;
        const { clears } = world.counts;
        stepTo(world, camera, world.time + 0.36);
        // The director's perfect clear: a later frame, one line, no rows of its own.
        world.onClear({
            lines: 1, rows: [], combo: 7, perfect: true,
        });
        expect(world.counts.clears).toBe(clears);
        expect(world.counts.perfects).toBe(1);
        expect(world.blastAt).toBe(blast);
        expect(world.blastDue).toBe(Infinity);
        const charged = world.charge;
        expect(charged).toBeGreaterThan(0.3);
        stepTo(world, camera, world.time + 1.5);
        // The crown's discharge spent the storm: it falls quiet and does not charge again at once.
        expect(world.charge).toBeLessThan(charged * 0.5);
        expect(world.u.sheet.value.y).toBeGreaterThan(0);
    });

    it('answers a T-spin that cleared nothing with a small ring, and stacks a second ring above the first', () => {
        const { world, camera } = makeWorld();
        world.onLock({
            u: 0.5, rows: [19], color: PIECE_COLORS[2], tspin: true,
        });
        expect(world.counts.tspins).toBe(1);
        stepTo(world, camera, world.time + 0.5);
        const small = world.getState().eventPuffs;
        expect(small).toBeGreaterThan(0);
        const spawned = [];
        const spawn = world.smoke.spawn.bind(world.smoke);
        vi.spyOn(world.smoke, 'spawn').mockImplementation((p) => {
            spawned.push(p);
            return spawn(p);
        });
        const ringBase = () => Math.min(...spawned.filter((p) => p.kind === 2).map((p) => p.y));
        world.onClear({
            lines: 2, rows: [19, 18], combo: 1, tspin: true,
        });
        const first = ringBase();
        spawned.length = 0;
        stepTo(world, camera, world.time + 1);
        world.onClear({
            lines: 2, rows: [19, 18], combo: 2, tspin: true,
        });
        expect(ringBase()).toBeGreaterThan(first);
    });

    it('holds the shock front, the sheet and the crater flash back under Reduce flashing', () => {
        const run = (reduce) => {
            vi.stubGlobal('window', { settings: { reduceFlashing: reduce } });
            const { world, camera } = makeWorld();
            world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
            world.onClear({ lines: 4, perfect: true });
            stepTo(world, camera, world.time + 0.3);
            const out = { shock: world.u.shock.value.y, sheet: world.u.sheet.value.y };
            vi.unstubAllGlobals();
            return out;
        };
        const full = run(false);
        const held = run(true);
        expect(full.shock).toBeGreaterThan(0);
        expect(full.sheet).toBeGreaterThan(0);
        expect(held.shock).toBeCloseTo(full.shock * REDUCED_FLASH_SCALE, 6);
        expect(held.sheet).toBeCloseTo(full.sheet * REDUCED_FLASH_SCALE, 6);
    });
});

describe('PyrestormWorld teardown', () => {
    it('disposes once, however often it is asked, and ignores what comes after', () => {
        const { world, scene, camera } = makeWorld();
        world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
        const geometries = [];
        for (const name of PYRESTORM_PARTS) {
            const part = world.parts[name];
            for (const mesh of part.meshes || [part.mesh]) geometries.push(vi.spyOn(mesh.geometry, 'dispose'));
        }
        const lava = vi.spyOn(world.textures.lava.near.a, 'dispose');
        world.dispose();
        expect(() => world.dispose()).not.toThrow();
        // (The land's two meshes share nothing but their material.)
        geometries.forEach((spy) => expect(spy).toHaveBeenCalled());
        expect(lava).toHaveBeenCalledOnce();
        expect(world.root.parent).toBeNull();
        expect(world.root.children).toHaveLength(0);
        expect(scene.children).not.toContain(world.root);
        const counts = { ...world.counts };
        expect(() => {
            world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
            world.onClear({ lines: 2, rows: [19, 18] });
            world.update(sim(world.time + 1, 0.1), camera);
        }).not.toThrow();
        expect(world.counts).toEqual(counts);
    });

    it('disposes a world that was never built', () => {
        const world = new PyrestormWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        expect(() => world.dispose()).not.toThrow();
        expect(() => world.dispose()).not.toThrow();
    });
});
