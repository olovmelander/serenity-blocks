/**
 * Rainbark — the world, on the CPU: a real RainbarkWorld in a THREE.Scene, no renderer (the node
 * graphs are built, never compiled).
 *
 * These pin behaviour and contracts — the camera rig, the Climb, Mistfall, what the events
 * record, determinism and the shape of what the theme reads — never a tuning number: constants
 * are imported, and the assertions are relations (counted, ordered, bounded, monotonic).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    RAINBARK_PARTS, REST_RIG, RainbarkWorld, fovForAspect, pitchForAspect,
} from '../../src/themes/rainbark/rainbark-world.js';
import {
    MISTFALL, STOREY, ZONES, climbHeight, sunDirection,
} from '../../src/themes/rainbark/rainbark-core.js';
import { QUALITY_NAMES } from '../../src/themes/rainbark/rainbark-quality.js';
import { fallbackLayout } from '../../src/themes/rainbark/rainbark-composition.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';

const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'restCamera', 'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'getPostState', 'getState',
    'dispose', 'onB2B', 'onGameOver', 'onSessionStart',
];
const DEG = Math.PI / 180;

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, at = 10, reduce = false, level = 1,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new RainbarkWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    if (level > 1) world.levelUp(level, { silent: true });
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { scene, camera, world };
}

/** One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world. */
function frame(world, camera, dt, during = null, pointerX = 0) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) frame(world, camera, dt);
}

const lock = (world, extra = {}) => world.onLock({
    player: 0,
    rows: [12, 11],
    u: 0.3,
    hardDrop: false,
    distance: 0,
    color: '#2BCB72',
    shape: 'T',
    cells: null,
    screen: null,
    ...extra,
});
const clear = (world, extra = {}) => world.onClear({
    player: 0,
    rows: [19, 18],
    lines: 2,
    combo: 1,
    cascade: 1,
    tspin: false,
    perfect: false,
    b2b: false,
    rowCodes: [],
    screen: null,
    ...extra,
});

describe('Rainbark world: the contract the theme calls', () => {
    it('implements every method the theme and the playground call', () => {
        WORLD_METHODS.forEach((method) => {
            expect(RainbarkWorld.prototype[method], `RainbarkWorld.${method}`).toBeTypeOf('function');
        });
        expect(REST_RIG).toEqual({
            near: 0.3, far: 3000, minFov: 30, maxFov: 78,
        });
    });

    it('names the parts the URL parameter reference lists for ?rainbarkParts', () => {
        expect(RAINBARK_PARTS).toEqual(['sky', 'trunks', 'mist', 'curls', 'fx', 'life']);
        const entry = THEME_URL_PARAMETERS.find(({ name }) => name === 'rainbarkParts');
        const listed = entry.values.replace(/^[^:]*:/, '').split(',').map((name) => name.trim());
        expect(listed).toEqual([...RAINBARK_PARTS]);
    });

    it('builds for every tier, node materials only, all in one root, and lets everything go', () => {
        for (const quality of QUALITY_NAMES) {
            const { world, scene } = makeWorld(quality);
            expect(scene.children).toEqual([world.root]);
            // The parts built so far are a subset of the listed ones, the backdrop among them.
            expect(Object.keys(world.parts)).toContain('sky');
            Object.keys(world.parts).forEach((name) => expect(RAINBARK_PARTS).toContain(name));
            const materials = [];
            scene.traverse((o) => { if (o.material) materials.push(o.material); });
            expect(materials.length).toBeGreaterThan(0);
            expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
            expect(world.getState().quality).toBe(quality);
            world.dispose();
            world.dispose(); // idempotent
            expect(scene.children).toHaveLength(0);
            expect(world.u).toBeNull();
        }
    });

    it('shares exactly two uniform arrays (the palette and the event table)', () => {
        const { world } = makeWorld();
        const arrays = Object.values(world.u).filter((v) => v?.isArrayBufferNode);
        expect(arrays).toHaveLength(2);
        expect(world.u.tables.events).toHaveLength(112);
        expect(world.u.palette).toBeTruthy();
        expect(world.u.events).toBeTruthy();
        world.dispose();
    });

    it('never grows the scene after it is built: events and frames only write numbers', () => {
        const { world, scene, camera } = makeWorld('High');
        const before = [];
        scene.traverse((o) => before.push(o));
        lock(world);
        lock(world, { hardDrop: true, distance: 18 });
        clear(world, { lines: 4 });
        world.onCombo(3);
        world.onB2B(2);
        world.levelUp(2);
        world.onGameOver();
        world.resetSession();
        world.onSessionStart();
        run(world, camera, 6);
        const after = [];
        scene.traverse((o) => after.push(o));
        expect(after).toEqual(before);
        world.dispose();
    });

    it('hands the post one reused object, carrying the zone\'s exposure, saturation and grade', () => {
        const { world, camera } = makeWorld('Medium', { level: 4 });
        const post = world.getPostState();
        run(world, camera, 0.5);
        expect(world.getPostState()).toBe(post);
        expect(post).toMatchObject({ exposure: ZONES[1].exposure, sat: ZONES[1].sat, iris: 1 });
        expect(post.gradeShadow).toHaveLength(3);
        expect(post.gradeLight).toHaveLength(3);
        // The grade's shadow is darker than its light.
        expect(post.gradeShadow.reduce((s, v) => s + v, 0)).toBeLessThan(post.gradeLight.reduce((s, v) => s + v, 0));
        world.dispose();
    });

    it('draws only the parts it is asked for, ignoring names it has not built', () => {
        const { world } = makeWorld();
        world.showOnlyParts(['trunks']);
        expect(world.parts.sky.mesh.visible).toBe(false);
        world.showOnlyParts(['sky', 'nonsense']);
        expect(world.parts.sky.mesh.visible).toBe(true);
        world.dispose();
    });
});

describe('Rainbark world: the camera rig', () => {
    it('frames every aspect from a tall phone to 21:9 with a sane lens, narrowing as the frame widens', () => {
        const aspects = [0.46, 390 / 844, 0.75, 1, 1.5, 16 / 9, 2, 21 / 9];
        let last = Infinity;
        aspects.forEach((aspect) => {
            const fov = fovForAspect(aspect);
            expect(fov, `fovForAspect(${aspect})`).toBeGreaterThan(1);
            expect(fov, `fovForAspect(${aspect})`).toBeLessThan(179);
            expect(fov).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fov).toBeLessThanOrEqual(REST_RIG.maxFov);
            expect(fov).toBeLessThanOrEqual(last);
            last = fov;
        });
        // The spec's anchors.
        expect(fovForAspect(0.46)).toBeCloseTo(64, 6);
        expect(fovForAspect(16 / 9)).toBeCloseTo(50, 1);
        expect(fovForAspect(2.37)).toBeCloseTo(44, 0);
        expect(pitchForAspect(0.46)).toBeCloseTo(9, 6);
        expect(pitchForAspect(16 / 9)).toBeCloseTo(6, 1);
        expect(Number.isFinite(fovForAspect(NaN))).toBe(true);
    });

    it('hangs the camera on the level\'s storey, looking down −z, pitched up, with no roll', () => {
        for (const level of [1, 4, 7, 12, 13]) {
            const { world, camera } = makeWorld('Minimal', { level });
            expect(Math.abs(camera.position.y - climbHeight(level))).toBeLessThan(0.11);
            expect(Math.abs(camera.position.x)).toBeLessThan(0.16);
            expect(camera.position.z).toBe(0);
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            expect(fwd.z).toBeLessThan(-0.9);
            expect(Math.asin(fwd.y) / DEG).toBeCloseTo(pitchForAspect(16 / 9), 3);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            expect(right.y).toBeCloseTo(0, 9); // no roll
            expect(camera.fov).toBeCloseTo(fovForAspect(16 / 9), 9);
            expect(camera.near).toBe(REST_RIG.near);
            expect(camera.far).toBe(REST_RIG.far);
            expect(world.getState().camY).toBe(climbHeight(level));
            expect(world.u.camY.value).toBe(climbHeight(level));
            world.dispose();
        }
    });

    it('breathes and follows the mouse, and holds still under reduced motion', () => {
        const { world, camera } = makeWorld('Minimal');
        const xs = [];
        for (let i = 0; i < 40; i++) {
            frame(world, camera, 0.5);
            xs.push(camera.position.x);
        }
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.05);
        xs.forEach((x) => expect(Math.abs(x)).toBeLessThanOrEqual(0.15 + 1e-9));
        frame(world, camera, 0, null, 1);
        const withPointer = camera.position.x;
        frame(world, camera, 0, null, 0);
        expect(withPointer - camera.position.x).toBeCloseTo(0.25, 9);
        world.setReducedMotion(true);
        frame(world, camera, 3.7, null, 1);
        expect(camera.position.x).toBe(0);
        expect(camera.position.y).toBe(climbHeight(1));
        world.dispose();
    });

    it('writes the camera\'s frame and the zone\'s sun into the uniforms the backdrop reads', () => {
        const { world, camera } = makeWorld('Minimal', { level: 4 });
        expect(world.u.camPos.value.y).toBeCloseTo(camera.position.y, 9);
        expect(world.u.camFwd.value.z).toBeLessThan(-0.9);
        expect(world.u.tanHalf.value.y).toBeCloseTo(Math.tan((camera.fov * DEG) / 2), 9);
        const sun = world.u.sunDir.value;
        expect(sun.length()).toBeCloseTo(1, 9);
        const bole = sunDirection(ZONES[1].sunElevation);
        // The azimuth drifts a few degrees over the tide; the elevation is the zone's.
        expect(sun.y).toBeCloseTo(bole[1], 9);
        expect(sun.x).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('Rainbark world: the Climb and Mistfall', () => {
    it('climbs a storey on a new level, waiting for the latest clear first, then rising smoothly', () => {
        const { world, camera } = makeWorld('Minimal', { level: 3 });
        const y0 = climbHeight(3);
        clear(world);
        world.levelUp(4);
        expect(world.getState().level).toBe(4);
        expect(world.getState().counts.levelUps).toBe(1);
        // The shed reads first, at a still camera.
        run(world, camera, 1.0);
        expect(world.getState().camY).toBe(y0);
        const heights = [];
        for (let i = 0; i < 60; i++) {
            frame(world, camera, 0.1);
            heights.push(world.getState().camY);
        }
        for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
        expect(heights[heights.length - 1]).toBe(y0 + STOREY);
        expect(world.getState().climbing).toBe(false);
        world.dispose();
    });

    it('jumps straight to the storey on a silent level-up (a rebuild mid-run)', () => {
        const { world } = makeWorld('Minimal');
        world.levelUp(7, { silent: true });
        expect(world.getState()).toMatchObject({
            level: 7, camY: climbHeight(7), climbing: false, zone: ZONES[2].name,
        });
        expect(world.getState().counts.levelUps).toBe(0);
        world.dispose();
    });

    it('never moves the camera on a level-up under reduced motion: the zone crossfades', () => {
        const { world, camera } = makeWorld('Minimal', { level: 5, reduce: true });
        world.levelUp(6);
        frame(world, camera, 0.2);
        expect(world.getState().camY).toBe(climbHeight(6));
        expect(world.getState().zoneMix).toBeGreaterThan(0);
        expect(world.getState().zoneMix).toBeLessThan(1);
        run(world, camera, 2);
        expect(world.getState()).toMatchObject({ zone: ZONES[2].name, climbing: false });
        world.dispose();
    });

    it('lets the mist rise past the camera at game over, and drains it for the next run', () => {
        const { world, camera } = makeWorld('Minimal', { level: 4 });
        const restTide = world.u.tide.value;
        expect(restTide).toBeLessThan(world.getState().camY);
        world.onGameOver();
        world.resetSession();
        run(world, camera, 5);
        expect(world.getState().mistfall).toBeCloseTo(1, 6);
        expect(world.u.tide.value).toBeGreaterThan(camera.position.y);
        expect(world.getPostState().sat).toBeCloseTo(MISTFALL.sat, 6);
        // The new run went back down to the first storey under the mist.
        expect(world.getState()).toMatchObject({ level: 1, camY: climbHeight(1) });
        world.onSessionStart();
        run(world, camera, 3.5);
        expect(world.getState().mistfall).toBeCloseTo(0, 6);
        expect(world.u.tide.value).toBeLessThan(camera.position.y);
        expect(world.getState().counts).toMatchObject({ gameOvers: 1, mornings: 1 });
        world.dispose();
    });
});

describe('Rainbark world: what the events record', () => {
    it('counts locks, hard drops, clears, lines, quads, T-spins and perfect clears, and the session\'s sheds', () => {
        const { world } = makeWorld('Minimal');
        world.primeSession({ sheds: 0 });
        lock(world);
        lock(world, { hardDrop: true, distance: 14 });
        clear(world, { lines: 3, rowCodes: [0, 1, 2, 3, 4, 5, 6, 7, 7, 7] });
        clear(world, { lines: 4, tspin: false });
        clear(world, { lines: 2, tspin: true });
        clear(world, { lines: 1, perfect: true });
        const { counts, sheds } = world.getState();
        expect(counts).toMatchObject({
            locks: 2, hardDrops: 1, clears: 4, lines: 10, quads: 1, tspins: 1, perfects: 1,
        });
        expect(sheds).toBeGreaterThan(2);
        // What it keeps is its own copy: the director reuses its context objects.
        const rows = [5, 4];
        world.onLock({ rows, u: 0.8, shape: 'I' });
        rows[0] = 0;
        expect(world.lastLock).toMatchObject({ rowTop: 4, rowBottom: 5, code: 0 });
        world.dispose();
    });

    it('opens a link per chain step, and calls a broken chain of two or more a release', () => {
        const { world } = makeWorld('Minimal');
        world.onCombo(1);
        world.onCombo(2);
        world.onCombo(3);
        expect(world.getState()).toMatchObject({ combo: 3, peak: 3 });
        world.onCombo(0);
        expect(world.getState()).toMatchObject({ combo: 0, peak: 0 });
        expect(world.getState().counts).toMatchObject({ chainSteps: 2, releases: 1 });
        // A chain of one that breaks is no release.
        world.onCombo(1);
        world.onCombo(0);
        expect(world.getState().counts.releases).toBe(1);
        world.dispose();
    });

    it('holds the back-to-back level between 0 and 3', () => {
        const { world } = makeWorld('Minimal');
        world.onB2B(1);
        world.onB2B(2);
        world.onB2B(9);
        expect(world.getState().b2b).toBe(3);
        world.onB2B(0);
        expect(world.getState().b2b).toBe(0);
        world.onB2B(-2);
        expect(world.getState().b2b).toBe(0);
        expect(world.getState().counts.b2bSteps).toBe(3);
        world.dispose();
    });

    it('starts a new run with no chain, no rain and no sheds', () => {
        const { world } = makeWorld('Minimal', { level: 5 });
        world.onCombo(4);
        world.onB2B(2);
        lock(world);
        world.resetSession();
        expect(world.getState()).toMatchObject({
            combo: 0, peak: 0, b2b: 0, sheds: 0, level: 1,
        });
        world.dispose();
    });
});

describe('Rainbark world: determinism', () => {
    it('gives two worlds seeked to the same moment, through the same events, the same state', () => {
        const play = (world, camera) => {
            world.seek(37.25);
            world.levelUp(4, { silent: true });
            frame(world, camera, 0);
            lock(world);
            run(world, camera, 0.5);
            clear(world, { lines: 2 });
            world.onCombo(2);
            world.levelUp(5);
            run(world, camera, 2.4, 1 / 60);
        };
        const a = makeWorld('Low');
        const b = makeWorld('Low', { at: 99 });
        play(a.world, a.camera);
        play(b.world, b.camera);
        expect(a.world.getState()).toEqual(b.world.getState());
        expect(a.camera.position.toArray()).toEqual(b.camera.position.toArray());
        expect(a.world.u.tide.value).toBe(b.world.u.tide.value);
        const rowsOf = (w) => w.u.tables.palette.map((v) => v.toArray());
        expect(rowsOf(a.world)).toEqual(rowsOf(b.world));
        a.world.dispose();
        b.world.dispose();
    });

    it('forgets everything in flight on a seek', () => {
        const { world, camera } = makeWorld('Minimal', { level: 4 });
        lock(world);
        world.onCombo(3);
        world.onGameOver();
        run(world, camera, 1);
        world.seek(12);
        expect(world.getState()).toMatchObject({
            time: 12, level: 1, combo: 0, mistfall: 0, climbing: false, camY: climbHeight(1),
        });
        expect(Object.values(world.getState().counts).every((n) => n === 0)).toBe(true);
        world.dispose();
    });
});
