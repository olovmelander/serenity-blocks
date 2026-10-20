/**
 * Sunbraid — the world's choreography, run without a renderer: the land prepared once, a scene, a
 * camera, and the world driven in fixed steps (camera, then events, then the frame, as the theme
 * does). One world serves most of the file: each test seeks it back to the same start.
 *
 * The look is still being tuned, so the gameplay beats are held as relations to the braid's own
 * constants (a lock ticks the suns on by its step, four lines bring them into one white sun and
 * part them, a chain opens them, game over sets them), not as numbers. The models are
 * tests/unit/grainfields-world.test.js and tests/unit/high-coast-world.test.js.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PHASE0, REST_RIG, SUNBRAID_PARTS, SunbraidWorld, fovForAspect,
} from '../../src/themes/sunbraid/sunbraid-world.js';
import {
    BRAID_RATE, PIECE_COLORS, azElOf, sunVector,
} from '../../src/themes/sunbraid/sunbraid-core.js';
import { BRAID_EVENTS } from '../../src/themes/sunbraid/sunbraid-braid.js';
import { MAX_CASTERS, eyePosition } from '../../src/themes/sunbraid/sunbraid-plan.js';

vi.setConfig({ testTimeout: 60_000 });

const START = 10;
const QUALITY = 'Minimal';
/** The theme's contract (tests/unit/sunbraid-theme.test.js WORLD_METHODS), plus what captures and the playground call. */
const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'prerender', 'getPostState', 'getState',
    'dispose', 'onB2B', 'onGameOver', 'onSessionStart', 'exportSessionState', 'importSessionState',
    'setAirMarch', 'setCaptureOverrides',
];
const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'b2bSteps', 'levelUps',
    'gameOvers', 'mornings',
];
const {
    tick, twist, level: LEVEL, conjunction, dusk: DUSK,
} = BRAID_EVENTS;

/** The land, prepared once. */
let land;
/** The world most tests share (seeked back to START by each). */
let shared;

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

function makeWorld() {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SunbraidWorld({
        scene, quality: QUALITY, capture: true, prepared: land,
    });
    const built = world.build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    return {
        scene, camera, world, built,
    };
}

/** Seek a world to `time` and draw that frame, as a capture does. */
function begin({ world, camera }, time = START) {
    world.seek(time);
    world.updateCamera(camera, sim(time, 0));
    world.update(sim(time, 0), camera);
}

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo({ world, camera }, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, sim(time, 0));
        world.update(sim(time, h), camera);
    }
}

/** Every value the materials read, flattened (the row tables included). */
function uniformValues(world) {
    const out = [];
    for (const [key, node] of Object.entries(world.u)) {
        if (Array.isArray(node)) {
            node.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`${key}[${r}].${i}`, v])));
            continue;
        }
        if (!node || !('value' in node)) continue;
        const { value } = node;
        if (typeof value === 'number') out.push([key, value]);
        else if (value?.toArray) value.toArray().forEach((v, i) => out.push([`${key}.${i}`, v]));
    }
    return out;
}

const objectCount = (root) => {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
};

/** The three suns as the materials read them: direction and light. */
const suns = (world) => [0, 1, 2].map((k) => ({
    dir: world.u[`sun${k}`].value.toArray(), col: world.u[`col${k}`].value.toArray(),
}));
const elevation = (dir) => azElOf(dir)[1];

/** A session with something of everything in it, from the world's current time. */
function play(w) {
    const { world } = w;
    const t = world.time;
    world.onLock({ u: 0.2, rows: [18], color: PIECE_COLORS[0] });
    world.onClear({ lines: 2, combo: 1, rowCodes: Array.from({ length: 20 }, (_, i) => i % 7) });
    stepTo(w, t + 1);
    world.levelUp(2);
    for (let n = 2; n <= 5; n++) {
        world.onLock({
            u: n / 7, rows: [19], color: PIECE_COLORS[n % 7], hardDrop: n === 3, distance: 12,
        });
        world.onClear({ lines: 1, combo: n, tspin: n === 4 });
        world.onCombo(n);
        stepTo(w, world.time + 0.8);
    }
    world.onLock({ u: 0.7, rows: [19, 18, 17, 16], color: PIECE_COLORS[3] });
    world.onClear({ lines: 4, combo: 1 });
    world.onCombo(0);
    world.onB2B(2);
    stepTo(w, world.time + 2);
    world.onClear({ lines: 1, perfect: true });
    stepTo(w, world.time + 1.5);
}

/** The phase the braid gains over the calm turn by `until`, after `act` at START. */
function phaseGain(act, until) {
    begin(shared);
    stepTo(shared, until);
    const calm = shared.world.getState().phase;
    begin(shared);
    act(shared.world);
    stepTo(shared, until);
    return shared.world.getState().phase - calm;
}

beforeAll(() => {
    land = SunbraidWorld.prepareSync(QUALITY);
    shared = makeWorld();
    begin(shared);
});

afterAll(() => {
    shared?.world.dispose();
    vi.restoreAllMocks();
});

describe('SunbraidWorld build', () => {
    it('implements every method the theme, the captures and the playground call', async () => {
        for (const method of WORLD_METHODS) {
            expect(SunbraidWorld.prototype[method], `SunbraidWorld.${method}`).toBeTypeOf('function');
        }
        expect(SunbraidWorld.prepareSync).toBeTypeOf('function');
        const prepared = await SunbraidWorld.prepare(QUALITY, { signal: new AbortController().signal });
        expect(prepared).toMatchObject({ quality: QUALITY });
        expect(prepared.casters.length).toBe(land.casters.length);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        expect(REST_RIG.near).toBeGreaterThan(0);
    });

    it('builds every named part into one root in the scene, and hands itself back', () => {
        const { world, scene, built } = shared;
        expect(built).toBe(world);
        expect(Object.keys(world.parts).sort()).toEqual([...SUNBRAID_PARTS].sort());
        expect(world.root.parent).toBe(scene);
        for (const name of SUNBRAID_PARTS) {
            const part = world.parts[name];
            const meshes = part.meshes || [part.mesh];
            expect(meshes.length, name).toBeGreaterThan(0);
            for (const mesh of meshes) expect(mesh.parent, name).toBe(world.root);
            expect(part.dispose, name).toBeTypeOf('function');
        }
        expect(world.getState()).toMatchObject({
            quality: QUALITY, parts: expect.arrayContaining([...SUNBRAID_PARTS]),
        });
        expect(world.getState().sceneChildren).toBe(world.root.children.length);
    });

    it('writes the towers\' shadow casters from the plan, once', () => {
        const { world } = shared;
        const n = Math.min(land.casters.length, MAX_CASTERS);
        expect(n).toBeGreaterThan(0);
        expect(world.u.casterCount.value).toBe(n);
        land.casters.slice(0, n).forEach((c, i) => {
            expect(world.u.casterRows[i * 2].toArray()).toEqual([c.x, c.y0, c.z, c.r]);
            expect(world.u.casterRows[i * 2 + 1].x).toBe(c.y1);
        });
        // The rows past the list stand far below the world: they shadow nothing.
        for (let i = n; i < world.u.casterRows.length / 2; i++) expect(world.u.casterRows[i * 2].y).toBeLessThan(-1e4);
    });

    it('draws everything with node materials (both renderer backends)', () => {
        const plain = [];
        let materials = 0;
        shared.scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                materials += 1;
                if (material.isNodeMaterial && !material.isShaderMaterial) return;
                plain.push(`${object.name || object.type}: ${material.type}`);
            });
        });
        expect(plain).toEqual([]);
        expect(materials).toBeGreaterThanOrEqual(SUNBRAID_PARTS.length);
    });

    it('shows only the parts a capture asks for, and all of them again', () => {
        const { world } = shared;
        const meshesOf = (name) => world.parts[name].meshes || [world.parts[name].mesh];
        world.showOnlyParts(['sky', 'land']);
        for (const name of SUNBRAID_PARTS) {
            for (const mesh of meshesOf(name)) expect(mesh.visible, name).toBe(name === 'sky' || name === 'land');
        }
        world.showOnlyParts(SUNBRAID_PARTS);
        for (const name of SUNBRAID_PARTS) {
            for (const mesh of meshesOf(name)) expect(mesh.visible, name).toBe(true);
        }
    });

    it('stands the camera at the eye on the rig; the lens breathes and leans; reduced motion holds it', () => {
        const { world, camera } = shared;
        begin(shared);
        world.updateCamera(camera, sim(20, 0));
        expect(camera.position.toArray()).toEqual(eyePosition());
        expect(camera.fov).toBe(fovForAspect(16 / 9));
        expect([camera.near, camera.far]).toEqual([REST_RIG.near, REST_RIG.far]);
        const at = (t, px = 0) => {
            world.updateCamera(camera, sim(t, 0, px));
            return camera.quaternion.clone();
        };
        expect(at(20).angleTo(at(37))).toBeGreaterThan(1e-4); // the lens breathes
        expect(at(20).angleTo(at(20, 1))).toBeGreaterThan(1e-3); // the pointer leans it
        world.setReducedMotion(true);
        try {
            expect(world.getState().reducedMotion).toBe(true);
            expect(at(20).angleTo(at(37))).toBeLessThan(1e-6);
            expect(at(20).angleTo(at(20, 1))).toBeLessThan(1e-6);
        } finally {
            world.setReducedMotion(false);
        }
        // Looking out over the valley: forward, a little down at most.
        at(20);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        expect(forward.z).toBeLessThan(-0.8);
        expect(forward.y).toBeLessThan(0.1);
        begin(shared);
    });

    it('keeps the scene\'s object count stable through every kind of event and many frames', () => {
        const { world, scene } = shared;
        begin(shared);
        const before = {
            scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
        };
        play(shared);
        world.onGameOver();
        stepTo(shared, world.time + DUSK.set);
        world.onSessionStart();
        world.resetSession();
        stepTo(shared, world.time + 5, 1 / 15);
        expect({
            scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
        }).toEqual(before);
        expect(world.getState().sceneChildren).toBe(before.root);
    });
});

describe('SunbraidWorld: events turn the braid', () => {
    it('reports its quality and every counter in its state', () => {
        begin(shared);
        const state = shared.world.getState();
        expect(state.quality).toBe(QUALITY);
        expect(Object.keys(state.counts).sort()).toEqual([...COUNTERS].sort());
        expect(Object.values(state.counts).every((n) => n === 0)).toBe(true);
        expect(state).toMatchObject({
            level: 1, combo: 0, peak: 0, b2b: 0, spread: 1, white: 0, dusk: 0,
        });
        expect(state.phase).toBeCloseTo(PHASE0 + BRAID_RATE * START, 12);
        // A copy: the caller cannot change the world's counters through it.
        state.counts.locks = 99;
        expect(shared.world.counts.locks).toBe(0);
    });

    it('ticks the suns on by a lock\'s step within a second, further for a hard drop', () => {
        const soft = phaseGain((world) => world.onLock({ u: 0.2, rows: [14], color: PIECE_COLORS[1] }), START + 1);
        expect(soft).toBeCloseTo(tick.step, 9);
        expect(shared.world.counts).toMatchObject({ locks: 1, hardDrops: 0 });
        const hard = phaseGain((world) => world.onLock({
            u: 0.8, rows: [12], hardDrop: true, distance: 14,
        }), START + 1);
        expect(hard).toBeCloseTo(tick.hardStep, 9);
        expect(shared.world.counts).toMatchObject({ locks: 1, hardDrops: 1 });
        // The turn is eased in, never snapped: a frame after the lock it has barely moved.
        const early = phaseGain((world) => world.onLock({ u: 0.5, rows: [10] }), START + 1 / 30);
        expect(early).toBeLessThan(tick.step * 0.1);
    });

    it('twists the suns a third of a turn per spin-turn of a T-spin', () => {
        const single = phaseGain((world) => world.onClear({ lines: 1, tspin: true }), START + twist.ease + 0.5);
        expect(single).toBeCloseTo(twist.step, 9);
        const tripleDone = START + 2 * twist.gap + twist.ease + 0.5;
        const triple = phaseGain((world) => world.onClear({ lines: 3, tspin: true }), tripleDone);
        expect(triple).toBeCloseTo(3 * twist.step, 9);
        expect(shared.world.counts).toMatchObject({ clears: 1, lines: 3, tspins: 1 });
    });

    it('draws the suns in for a clear and lets them go', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 2, combo: 1 });
        expect(world.counts).toMatchObject({ clears: 1, lines: 2, quads: 0 });
        let least = 1;
        for (let k = 1; k <= 30; k++) {
            stepTo(shared, START + k / 30);
            least = Math.min(least, world.getState().spread);
        }
        expect(least).toBeLessThan(1 - BRAID_EVENTS.breath.depth[2] * 0.9);
        stepTo(shared, START + BRAID_EVENTS.breath.in + BRAID_EVENTS.breath.out + 0.2);
        expect(world.getState().spread).toBe(1);
    });

    it('brings four lines into one white sun, then parts the suns wide and settles them', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 4, combo: 1 });
        expect(world.counts).toMatchObject({ clears: 1, lines: 4, quads: 1 });
        const holdMid = conjunction.close + conjunction.hold / 2;
        stepTo(shared, START + holdMid);
        expect(world.getState().spread).toBeCloseTo(0, 6);
        expect(world.getState().white).toBeCloseTo(1, 6);
        // One white sun: the three stand on one point, and their light is the same pale colour.
        const [a, b, c] = suns(world);
        b.dir.forEach((v, i) => expect(v).toBeCloseTo(a.dir[i], 9));
        c.dir.forEach((v, i) => expect(v).toBeCloseTo(a.dir[i], 9));
        for (const sun of [a, b, c]) {
            const spread = Math.max(...sun.col) / Math.min(...sun.col);
            expect(spread).toBeLessThan(1.01); // white: no channel stands out
        }
        let widest = 0;
        const end = conjunction.close + conjunction.hold + conjunction.part + conjunction.settle;
        for (let t = holdMid; t <= end + 0.5; t += 1 / 30) {
            stepTo(shared, START + t);
            widest = Math.max(widest, world.getState().spread);
        }
        expect(widest).toBeGreaterThan(1.2);
        expect(world.getState().spread).toBeCloseTo(1, 9);
        expect(world.getState().white).toBe(0);
    });

    it('opens the suns wider with a chain, counting each step, and eases them back when it breaks', () => {
        const { world } = shared;
        begin(shared);
        world.onCombo(1);
        expect(world.counts.chainSteps).toBe(0);
        for (let n = 2; n <= 5; n++) world.onCombo(n);
        expect(world.counts.chainSteps).toBe(4);
        expect(world).toMatchObject({ combo: 5, peak: 5 });
        stepTo(shared, START + 4);
        const open = world.getState().spread;
        expect(open).toBeGreaterThan(1.2);
        // The suns stand further from one another.
        const [a, b] = suns(world);
        const gap = Math.acos(a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2]);
        begin(shared);
        const [a0, b0] = suns(world);
        const calmGap = Math.acos(a0.dir[0] * b0.dir[0] + a0.dir[1] * b0.dir[1] + a0.dir[2] * b0.dir[2]);
        expect(gap).toBeGreaterThan(calmGap * 1.2);
        // The chain ends: the spread eases back; the peak is remembered.
        for (let n = 2; n <= 5; n++) world.onCombo(n);
        stepTo(shared, START + 4);
        world.onCombo(0);
        expect(world).toMatchObject({ combo: 0, peak: 5 });
        stepTo(shared, START + 4 + 1 / 30);
        expect(world.getState().spread).toBeLessThan(open);
        stepTo(shared, START + 20, 0.25);
        expect(world.getState().spread).toBeCloseTo(1, 3);
    });

    it('winds the suns on by a level\'s step on a real level-up, not on a silent one', () => {
        const until = START + LEVEL.ease + 0.5;
        const real = phaseGain((world) => world.levelUp(2), until);
        expect(real).toBeCloseTo(LEVEL.step, 9);
        expect(shared.world.counts.levelUps).toBe(1);
        expect(shared.world.level).toBe(2);
        const two = phaseGain((world) => world.levelUp(3), until);
        expect(two).toBeCloseTo(2 * LEVEL.step, 9);
        const silent = phaseGain((world) => world.levelUp(4, { silent: true }), until);
        expect(silent).toBeCloseTo(0, 12);
        expect(shared.world.counts.levelUps).toBe(0);
        expect(shared.world.level).toBe(4);
        // The same level again, or a lower one, winds nothing.
        const same = phaseGain((world) => {
            world.levelUp(1);
            world.levelUp(0);
        }, until);
        expect(same).toBeCloseTo(0, 12);
    });

    it('sets the suns at game over and raises them again when the next session starts', () => {
        const { world } = shared;
        begin(shared);
        world.onSessionStart();
        expect(world.counts.mornings).toBe(0); // no dusk, no morning
        const t = START + DUSK.set + 0.2;
        stepTo(shared, t);
        const day = suns(world);
        begin(shared);
        world.onGameOver();
        expect(world.counts.gameOvers).toBe(1);
        stepTo(shared, START + DUSK.set / 2);
        expect(world.getState().dusk).toBeGreaterThan(0.2);
        expect(world.getState().dusk).toBeLessThan(0.8);
        stepTo(shared, t);
        expect(world.getState().dusk).toBeCloseTo(1, 6);
        const dusk = suns(world);
        dusk.forEach((sun, k) => {
            // The same suns, set by the dusk's drop, and dimmer.
            expect(elevation(sun.dir), `sun ${k}`).toBeCloseTo(elevation(day[k].dir) - DUSK.drop, 6);
            expect(sun.col.reduce((s, v) => s + v, 0), `sun ${k}`).toBeLessThan(day[k].col.reduce((s, v) => s + v, 0));
        });
        world.onSessionStart();
        expect(world.counts.mornings).toBe(1);
        stepTo(shared, world.time + DUSK.rise + 0.2);
        expect(world.getState().dusk).toBe(0);
        // A second session start with the suns already up is no morning.
        world.onSessionStart();
        expect(world.counts.mornings).toBe(1);
    });

    it('lifts the suns for a perfect clear and lets them sink back', () => {
        const { world } = shared;
        const { noon } = BRAID_EVENTS;
        const mid = START + noon.rise + noon.hold / 2;
        begin(shared);
        stepTo(shared, mid);
        const before = suns(world).map((s) => elevation(s.dir));
        begin(shared);
        world.onClear({ lines: 2, perfect: true });
        expect(world.counts.perfects).toBe(1);
        stepTo(shared, mid);
        suns(world).forEach((s, k) => expect(elevation(s.dir), `sun ${k}`).toBeCloseTo(before[k] + noon.lift, 6));
        stepTo(shared, START + noon.rise + noon.hold + noon.sink + 0.5);
        const after = suns(world).map((s) => elevation(s.dir));
        begin(shared);
        stepTo(shared, START + noon.rise + noon.hold + noon.sink + 0.5);
        suns(world).forEach((s, k) => expect(after[k]).toBeCloseTo(elevation(s.dir), 9));
    });

    it('under reduced motion: a hard drop ticks as a lock, a T-spin twists once; the counters still count', () => {
        shared.world.setReducedMotion(true);
        try {
            const hard = phaseGain((world) => world.onLock({ u: 0.5, rows: [12], hardDrop: true }), START + 1);
            expect(hard).toBeCloseTo(tick.step, 9);
            expect(shared.world.counts).toMatchObject({ locks: 1, hardDrops: 1 });
            const spinDone = START + 2 * twist.gap + twist.ease + 0.5;
            const spin = phaseGain((world) => world.onClear({ lines: 3, tspin: true }), spinDone);
            expect(spin).toBeCloseTo(twist.step, 9);
            expect(shared.world.counts.tspins).toBe(1);
        } finally {
            shared.world.setReducedMotion(false);
        }
    });

    it('lets the back-to-back run go with the session: a new run braids no ribbons from the last one', () => {
        const { world } = shared;
        begin(shared);
        world.onB2B(3);
        expect(world.counts.b2bSteps).toBe(1);
        stepTo(shared, START + 5);
        expect(world.u.ribbon.value).toBeGreaterThan(0.1);
        world.resetSession();
        expect(world).toMatchObject({
            level: 1, combo: 0, peak: 0, b2b: 0,
        });
        stepTo(shared, START + 15, 0.25);
        expect(world.u.ribbon.value).toBeLessThan(0.01);
    });
});

describe('SunbraidWorld: the frame writes the uniforms', () => {
    it('writes the suns where the braid stands, the camera and the clock into the uniforms every frame', () => {
        const { world, camera } = shared;
        begin(shared);
        stepTo(shared, START + 3);
        const state = world.getState();
        for (let k = 0; k < 3; k++) {
            const expected = sunVector(state.phase, k, world.time, state.spread);
            world.u[`sun${k}`].value.toArray().forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
            expect(world.u[`col${k}`].value.toArray().every((v) => v >= 0)).toBe(true);
        }
        expect(world.u.time.value).toBe(world.time);
        expect(world.u.eye.value.toArray()).toEqual(camera.position.toArray());
        // The high cloud drifts at a constant speed: a closed form of the clock.
        const d1 = world.u.cloudDrift.value.clone();
        stepTo(shared, 2 * world.time);
        expect(world.u.cloudDrift.value.x).toBeCloseTo(2 * d1.x, 6);
        expect(world.u.cloudDrift.value.y).toBeCloseTo(2 * d1.y, 6);
        expect(Math.hypot(d1.x, d1.y)).toBeGreaterThan(0);
        begin(shared);
    });

    it('pins the suns to a capture\'s phase override, and lets them go again', () => {
        const { world } = shared;
        begin(shared);
        world.setCaptureOverrides({ phase: 1.234 });
        try {
            stepTo(shared, START + 2);
            for (let k = 0; k < 3; k++) {
                const expected = sunVector(1.234, k, world.time, world.getState().spread);
                world.u[`sun${k}`].value.toArray().forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
            }
        } finally {
            world.setCaptureOverrides({ phase: null });
        }
        stepTo(shared, START + 2 + 1 / 30);
        const free = sunVector(world.getState().phase, 0, world.time, world.getState().spread);
        world.u.sun0.value.toArray().forEach((v, i) => expect(v).toBeCloseTo(free[i], 9));
        begin(shared);
    });

    it('hands the post one object, every frame, with finite values', () => {
        const { world } = shared;
        begin(shared);
        const post = world.getPostState();
        world.onClear({ lines: 4, combo: 1 });
        world.onCombo(2);
        for (let k = 1; k <= 20; k++) {
            stepTo(shared, START + k / 10);
            expect(world.getPostState()).toBe(post);
        }
        for (const [key, value] of Object.entries(post)) {
            if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
        }
        expect(post.flashColour.every(Number.isFinite)).toBe(true);
        expect(post.exposure).toBeGreaterThan(0);
    });

    it('keeps every uniform finite over a long scripted session', () => {
        const { world } = shared;
        begin(shared, 0);
        const bad = [];
        let combo = 0;
        for (let frame = 1; frame <= 1500; frame++) {
            const t = frame / 15;
            if (frame % 22 === 0) {
                world.onLock({
                    u: (frame * 0.173) % 1,
                    rows: [19 - (frame % 20)],
                    color: PIECE_COLORS[frame % 8],
                    hardDrop: frame % 66 === 0,
                    distance: frame % 19,
                });
            }
            if (frame % 44 === 0) {
                const lines = 1 + (frame % 4);
                combo = frame % 440 < 330 ? combo + 1 : 0;
                world.onClear({ lines, combo: Math.max(1, combo), tspin: frame % 352 === 0 });
                world.onCombo(combo);
                world.onB2B(lines === 4 ? Math.min(4, world.b2b + 1) : 0);
            }
            if (frame === 700) world.onClear({ lines: 4, perfect: true });
            if (frame % 400 === 0) world.levelUp(world.level + 1);
            if (frame === 1100) world.onGameOver();
            if (frame === 1160) {
                world.onSessionStart();
                world.resetSession();
            }
            world.updateCamera(shared.camera, sim(t, 0, Math.sin(t), Math.cos(t * 0.7)));
            world.update(sim(t, 1 / 15), shared.camera);
            if (frame % 30 === 0) {
                for (const [key, v] of uniformValues(world)) {
                    if (!Number.isFinite(v)) bad.push(`${key} at ${t.toFixed(2)} s: ${v}`);
                }
            }
        }
        expect(bad.slice(0, 10)).toEqual([]);
        expect(world.counts.locks).toBeGreaterThan(50);
        expect(world.counts.gameOvers).toBe(1);
        begin(shared);
    });
});

describe('SunbraidWorld state', () => {
    /** What a capture would see: the session, every uniform and the post. */
    const read = ({ world }) => ({
        state: world.getState(),
        uniforms: uniformValues(world),
        post: structuredClone(world.getPostState()),
    });

    it('seeks: everything in flight is dropped, the suns stand where the clock puts them', () => {
        const { world } = shared;
        begin(shared);
        play(shared);
        world.onGameOver();
        stepTo(shared, world.time + 1);
        world.seek(START);
        expect(world).toMatchObject({
            time: START, level: 1, combo: 0, peak: 0, b2b: 0,
        });
        expect(Object.values(world.counts).every((n) => n === 0)).toBe(true);
        world.updateCamera(shared.camera, sim(START, 0));
        world.update(sim(START, 0), shared.camera);
        expect(world.getState()).toMatchObject({ spread: 1, white: 0, dusk: 0 });
        expect(world.getState().phase).toBeCloseTo(PHASE0 + BRAID_RATE * START, 12);
        // A nonsense time seeks to the start of the clock.
        world.seek(Number.NaN);
        expect(world.time).toBe(0);
        world.seek(-5);
        expect(world.time).toBe(0);
        begin(shared);
    });

    it('seeks deterministically: a seek and the same events write the same uniforms and the same post', () => {
        begin(shared);
        play(shared);
        const first = read(shared);
        expect(first.state.counts).toMatchObject({
            locks: 6,
            hardDrops: 1,
            clears: 7,
            quads: 1,
            tspins: 1,
            perfects: 1,
            levelUps: 1,
            chainSteps: 4,
            b2bSteps: 1,
        });
        begin(shared);
        play(shared);
        expect(read(shared)).toEqual(first);
        // A fresh world, sought to the same start and played the same, says the same.
        const fresh = makeWorld();
        try {
            begin(fresh);
            play(fresh);
            expect(read(fresh)).toEqual(first);
        } finally {
            fresh.world.dispose();
        }
    });

    it('round-trips a session through export and import (structured-clone equal)', () => {
        begin(shared);
        play(shared);
        const snapshot = structuredClone(shared.world.exportSessionState());
        expect(snapshot).toEqual(shared.world.exportSessionState());
        const other = makeWorld();
        try {
            begin(other, shared.world.time);
            other.world.importSessionState(snapshot);
            expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
            expect(other.world.counts).toEqual(shared.world.counts);
            expect(other.world).toMatchObject({
                level: shared.world.level, combo: shared.world.combo, peak: shared.world.peak, b2b: shared.world.b2b,
            });
            // A snapshot of another shape, or none, changes nothing.
            other.world.importSessionState({ record: [] });
            other.world.importSessionState(null);
            other.world.importSessionState(undefined);
            expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
        } finally {
            other.world.dispose();
        }
    });

    it('keeps the suns in place through a rebuild in place (export, new world, import), mid-turn, mid-dusk', () => {
        const { world } = shared;
        begin(shared);
        for (let n = 2; n <= 4; n++) world.onCombo(n);
        world.levelUp(3);
        world.onLock({ u: 0.4, rows: [19], hardDrop: true });
        stepTo(shared, START + 1);
        world.onGameOver();
        stepTo(shared, START + 1 + DUSK.set * 0.5); // mid-dusk
        expect(world.time).toBeLessThan(START + LEVEL.ease); // and mid-turn
        const snapshot = structuredClone(world.exportSessionState());
        const rebuilt = makeWorld();
        try {
            // As the theme's createScene does: the new world seeks to the clock, takes the level up
            // again silently, then the snapshot.
            rebuilt.world.seek(world.time);
            rebuilt.world.levelUp(world.level, { silent: true });
            rebuilt.world.importSessionState(snapshot);
            for (const dt of [1 / 30, 1, LEVEL.ease, DUSK.set, 60]) {
                const t = world.time + dt;
                for (const w of [shared, rebuilt]) {
                    w.world.updateCamera(w.camera, sim(t, 0));
                    w.world.update(sim(t, 1 / 30), w.camera);
                }
                const a = world.getState();
                const b = rebuilt.world.getState();
                for (const key of ['phase', 'spread', 'dusk']) expect(b[key], `${key} +${dt} s`).toBeCloseTo(a[key], 9);
                suns(rebuilt.world).forEach((sun, k) => {
                    const own = suns(world)[k];
                    sun.dir.forEach((v, i) => expect(v, `sun ${k} +${dt} s`).toBeCloseTo(own.dir[i], 9));
                    sun.col.forEach((v, i) => expect(v, `light ${k} +${dt} s`).toBeCloseTo(own.col[i], 9));
                });
            }
            expect(rebuilt.world.level).toBe(world.level);
            expect(rebuilt.world.counts).toEqual(world.counts);
        } finally {
            rebuilt.world.dispose();
            begin(shared);
        }
    });

    it('draws the same ribbons after an import as the world it came from: the chain\'s and the b2b run\'s', () => {
        const { world } = shared;
        begin(shared);
        for (let n = 2; n <= 4; n++) world.onCombo(n);
        world.onB2B(2);
        stepTo(shared, START + 6);
        expect(world.u.ribbon.value).toBeGreaterThan(0.1);
        const snapshot = structuredClone(world.exportSessionState());
        const rebuilt = makeWorld();
        try {
            rebuilt.world.seek(world.time);
            rebuilt.world.importSessionState(snapshot);
            for (const dt of [1 / 30, 3]) {
                const t = world.time + dt;
                for (const w of [shared, rebuilt]) {
                    w.world.updateCamera(w.camera, sim(t, 0));
                    w.world.update(sim(t, 1 / 30), w.camera);
                }
                expect(rebuilt.world.u.ribbon.value, `+${dt} s`).toBeCloseTo(world.u.ribbon.value, 6);
            }
        } finally {
            rebuilt.world.dispose();
            begin(shared);
        }
    });
});

describe('SunbraidWorld teardown', () => {
    it('disposes once, however often it is asked; a frame after it does nothing', () => {
        const own = makeWorld();
        const { world, scene, camera } = own;
        begin(own);
        world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
        const disposers = SUNBRAID_PARTS.map((name) => vi.spyOn(world.parts[name], 'dispose'));
        const noise = vi.spyOn(world.textures.noise, 'dispose');
        world.dispose();
        expect(() => world.dispose()).not.toThrow();
        disposers.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
        expect(noise).toHaveBeenCalledOnce();
        expect(world.disposed).toBe(true);
        expect(world.root.parent).toBeNull();
        expect(world.root.children).toHaveLength(0);
        expect(scene.children).not.toContain(world.root);
        const { time } = world;
        expect(() => {
            world.update(sim(time + 1, 0.1), camera);
            world.prerender({});
        }).not.toThrow();
        expect(world.time).toBe(time);
        // A world never built disposes too.
        const unbuilt = new SunbraidWorld({ scene: new THREE.Scene(), quality: QUALITY });
        expect(() => {
            unbuilt.dispose();
            unbuilt.dispose();
        }).not.toThrow();
    });
});
