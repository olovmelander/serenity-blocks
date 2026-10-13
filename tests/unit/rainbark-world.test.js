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
    HERO_TRUNKS, MISTFALL, PALETTE_ROWS, STOREY, TIDE_PERIOD, TRUNK_STRIDE, TWIN_TRUNKS, ZONES, climbHeight, groupMean,
    mistDrift, mistOnset, recordAxis, sunDirection, tideClock,
} from '../../src/themes/rainbark/rainbark-core.js';
import { SUN_BOLE } from '../../src/themes/rainbark/rainbark-tsl.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/rainbark/rainbark-quality.js';
import { cardUnion, fallbackLayout, trunkBand } from '../../src/themes/rainbark/rainbark-composition.js';
import { IMPOSTOR_RANKS } from '../../src/themes/rainbark/rainbark-sky.js';
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

    it('keeps the billows\' grain a whole number through a Climb (the floor never zooms)', () => {
        const { world, camera } = makeWorld('Minimal', { level: 2 });
        world.levelUp(3);
        const grains = new Set();
        for (let i = 0; i < 80; i++) {
            frame(world, camera, 0.1);
            const g = world.u.mistGrain.value;
            expect(Number.isInteger(g), `frame ${i}: ${g}`).toBe(true);
            grains.add(g);
        }
        expect(world.getState().climbing).toBe(false);
        world.dispose();
    });

    it('swaps the billows\' grain only while the floor is flat (their contrast dips to 0 at the swap)', () => {
        const { world, camera } = makeWorld('Minimal', { level: 2 });
        expect(world.u.billowK.value).toBe(1);
        world.levelUp(3);
        let last = world.u.mistGrain.value;
        let swaps = 0;
        let dipped = 1;
        for (let i = 0; i < 120; i++) {
            frame(world, camera, 0.05);
            const g = world.u.mistGrain.value;
            dipped = Math.min(dipped, world.u.billowK.value);
            if (g !== last) {
                swaps += 1;
                expect(world.u.billowK.value, `frame ${i}`).toBeLessThan(0.25);
            }
            last = g;
        }
        // (L2's grain and L3's differ: the swap happened, at a flat floor, and the contrast is back.)
        expect(swaps).toBe(1);
        expect(dipped).toBeLessThan(0.05);
        expect(world.getState().climbing).toBe(false);
        expect(world.u.billowK.value).toBe(1);
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

describe('Rainbark world: the bark', () => {
    it('stands the trunks on every tier, its near and far draws in the one root', () => {
        for (const quality of QUALITY_NAMES) {
            const { world } = makeWorld(quality);
            const { trunks } = world.parts;
            expect(trunks, quality).toBeTruthy();
            expect(trunks.mesh.parent).toBe(world.root);
            expect(trunks.near.used).toBeGreaterThan(0);
            expect(trunks.far.used).toBeGreaterThan(0);
            // The atlas the tier asks for, wrapped twice (ids and edges) over one typed array.
            const { atlasNear, atlasLin } = world.u.tex;
            expect(atlasNear.image.width).toBe(QUALITY[quality].atlas);
            expect(atlasLin.image.data).toBe(atlasNear.image.data);
            expect(atlasNear.magFilter).toBe(THREE.NearestFilter);
            expect(atlasLin.magFilter).toBe(THREE.LinearFilter);
            world.dispose();
        }
    });

    it('bakes once: every world of a size shares the same arrays, and lets only its textures go', () => {
        const a = makeWorld('High');
        const b = makeWorld('Ultra');
        expect(b.world.u.tex.atlasNear.image.data).toBe(a.world.u.tex.atlasNear.image.data);
        expect(b.world.u.tex.fbm.image.data).toBe(a.world.u.tex.fbm.image.data);
        // Each world wraps them in its own textures (compared by identity: a deep diff of two
        // megabyte atlases is slow).
        expect(b.world.u.tex.atlasNear === a.world.u.tex.atlasNear).toBe(false);
        expect(a.world.textures).toHaveLength(Object.keys(a.world.u.tex).length);
        a.world.dispose();
        // The other world's textures (and the shared arrays) are untouched.
        expect(b.world.u.tex.atlasNear.image.data.length).toBeGreaterThan(0);
        b.world.dispose();
    });

    it('writes the group clocks, the grove\'s age bias and the far bark\'s group means each frame', () => {
        const { world, camera } = makeWorld('Medium', { level: 4, at: 40 });
        world.primeSession({ minutes: 6 });
        run(world, camera, 1.5);
        const { u } = world;
        const c = world.clocks;
        expect(u.groupClock.value.toArray()).toEqual([c[0], c[1], c[2], c[3]]);
        const bias = world.ageBias();
        expect(u.ageBias.value.x).toBeCloseTo(bias, 6);
        const want = groupMean(bias, world.matrixShare, [0, 0, 0, 0], world.islandShare);
        for (let g = 0; g < 4; g++) {
            const row = u.tables.palette[PALETTE_ROWS.groupMean + g].toArray();
            row.forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
        }
        // An older session, an older grove.
        const before = u.tables.palette[PALETTE_ROWS.groupMean].w;
        world.primeSession({ minutes: 20 });
        frame(world, camera, 1 / 30);
        expect(u.tables.palette[PALETTE_ROWS.groupMean].w).toBeGreaterThan(before);
        world.dispose();
    });

    it('lights the bark with the zone\'s sun and a sheen that follows the tide', () => {
        const low = makeWorld('Low', { level: 4, at: 0 });
        // The Bole's sun is SUN_BOLE (within a few per cent: half white, half its fleck colour).
        low.world.u.sunCol.value.toArray().forEach((v, i) => expect(Math.abs(v / SUN_BOLE[i] - 1)).toBeLessThan(0.03));
        const sheenLow = low.world.u.sheenK.value;
        low.world.dispose();
        const high = makeWorld('Low', { level: 4, at: TIDE_PERIOD / 2 });
        const sheenHigh = high.world.u.sheenK.value;
        high.world.dispose();
        // Clearing (low tide) has the least sheen, immersion (high tide) the most.
        expect(sheenLow).toBeLessThan(sheenHigh);
        expect(sheenLow).toBeGreaterThan(0);
        expect(sheenHigh).toBeLessThanOrEqual(1);
    });
});

describe('Rainbark world: the grove', () => {
    const slotOf = (name) => HERO_TRUNKS.find((t) => t.name === name).code - 1;
    const axisAt = (draw, slot, y) => recordAxis(draw.data, y, [0, 0, 0], slot * TRUNK_STRIDE);

    it('stands the plan on every tier: the far draw holds its grove, the 21:9 Twin and its limbs', () => {
        for (const quality of QUALITY_NAMES) {
            const { world } = makeWorld(quality, { level: 4 });
            const { far } = world.parts.trunks;
            const { trunks: grove, limbs } = world.plan;
            expect(far.slots).toBe(grove.length + TWIN_TRUNKS.length + limbs.length);
            // At most the tier's limbs (a far trunk's that cannot read as a branch is not grown).
            expect(limbs.length).toBeLessThanOrEqual(QUALITY[quality].limbs);
            expect(limbs.length).toBeGreaterThanOrEqual(Math.min(QUALITY[quality].limbs, 6));
            grove.forEach((trunk, slot) => expect(far.live(slot), trunk.name).toBe(true));
            // No Twin in a 16:9 frame; every limb out of a live parent (a hero the composition
            // hides at this frame, as Sister Two at 1600 × 900, takes its limbs with her).
            expect(far.live(grove.length)).toBe(false);
            const { near } = world.parts.trunks;
            const farIndex = new Map(grove.map((trunk, slot) => [trunk.name, slot]));
            limbs.forEach((limb, i) => {
                const hero = HERO_TRUNKS.find((t) => t.name === limb.parent && t.code > 0);
                const parentLive = hero ? near.live(hero.code - 1) : far.live(farIndex.get(limb.parent));
                expect(far.live(grove.length + TWIN_TRUNKS.length + i), limb.parent).toBe(parentLive);
                if (limb.parent !== 'Sister Two') expect(parentLive, limb.parent).toBe(true);
            });
            // The backdrop paints the tier's impostor ranks.
            expect(world.parts.sky.impostors).toBe(Math.min(QUALITY[quality].impostors, IMPOSTOR_RANKS.length));
            world.dispose();
        }
    });

    it('re-solves the heroes for the live layout and the aspect, writing instance data only', () => {
        const { world, scene } = makeWorld('Low', { width: 1920, height: 1080, level: 4 });
        const count = () => {
            let n = 0;
            scene.traverse(() => { n += 1; });
            return n;
        };
        const before = count();
        const { near, far } = world.parts.trunks;
        const camY = world.heightAt(world.time);
        const elderX = () => axisAt(near, slotOf('Elder'), camY)[0];
        // The 16:9 fallback: where the solver puts them, every hero standing.
        const solved = trunkBand(world.layout, 16 / 9, { camY, seeds: world.plan.heroes.map((h) => h.seed) });
        expect(elderX()).toBeCloseTo(solved.placements[0].x, 4);
        expect(near.live(slotOf('Sister Two'))).toBe(true);
        // A live card further left pushes the Elder further left.
        const live = fallbackLayout(1920, 1080);
        live.cardCount = 1;
        live.cards[0] = {
            ...live.cards[0], x0: live.cards[0].x0 - 0.1, x1: live.cards[0].x1 - 0.1,
        };
        const was = elderX();
        world.setLayout(live, 16 / 9);
        expect(elderX()).toBeLessThan(was - 0.5);
        // Upright: no Sister Two, no R1a; at 21:9 the Twin stands.
        world.setLayout(null, 390 / 844);
        expect(near.live(slotOf('Sister Two'))).toBe(false);
        expect(near.live(slotOf('R1a'))).toBe(false);
        world.setViewport(2560, 1080, 2560 / 1080);
        world.setLayout(null, 2560 / 1080);
        expect(far.live(world.plan.trunks.length)).toBe(true);
        expect(count()).toBe(before);
        world.dispose();
    });

    it('pivots the grove at the eye\'s storey, through a Climb too: the composition holds on every level', () => {
        const { world, camera } = makeWorld('Low', { level: 3, at: 30 });
        const { near } = world.parts.trunks;
        const elder = slotOf('Elder');
        const eye = () => world.heightAt(world.time);
        const atEye = () => axisAt(near, elder, eye())[0];
        const rest = atEye();
        world.levelUp(4);
        // Mid-climb and after it, the Elder's axis at the eye stays put (within the taper's drift).
        run(world, camera, 1.2 + 1.75);
        expect(eye()).toBeGreaterThan(climbHeight(3));
        expect(eye()).toBeLessThan(climbHeight(4));
        expect(Math.abs(atEye() - rest)).toBeLessThan(0.15);
        run(world, camera, 3);
        expect(eye()).toBeCloseTo(climbHeight(4), 6);
        expect(Math.abs(atEye() - rest)).toBeLessThan(0.15);
        world.dispose();
    });
});

describe('Rainbark world: the mist floor', () => {
    const count = (scene) => {
        let n = 0;
        scene.traverse(() => { n += 1; });
        return n;
    };

    it('builds the tier\'s sheets and wisps as always-drawn pools (no wisp draw on a tier without wisps)', () => {
        for (const quality of QUALITY_NAMES) {
            const { world } = makeWorld(quality, { level: 4 });
            const { mist } = world.parts;
            expect(mist, quality).toBeTruthy();
            const tier = QUALITY[quality];
            expect(mist.sheets.count).toBe(Math.max(1, tier.mistSheets));
            expect(mist.sheets.geometry.instanceCount).toBe(mist.sheets.count);
            if (tier.wisps > 0) {
                expect(mist.wisps.count).toBe(tier.wisps);
                expect(mist.wisps.geometry.instanceCount).toBe(tier.wisps);
                expect(mist.mesh.children).toHaveLength(2);
            } else {
                expect(mist.wisps).toBeNull();
                expect(mist.mesh.children).toHaveLength(1);
            }
            // Premultiplied over, after the backdrop and before the curls; nothing writes depth.
            mist.mesh.children.forEach((mesh) => {
                expect(mesh.renderOrder).toBeGreaterThan(world.parts.sky.mesh.renderOrder);
                expect(mesh.material.depthWrite).toBe(false);
                expect(mesh.material.transparent).toBe(true);
                expect(mesh.material.blendSrc).toBe(THREE.OneFactor);
                expect(mesh.material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
                expect(mesh.frustumCulled).toBe(false);
            });
            world.dispose();
        }
    });

    it('keeps the scene the same after build, through frames, events, seeks, a Climb and Mistfall', () => {
        const { world, scene, camera } = makeWorld('High', { level: 4 });
        const before = count(scene);
        for (let i = 0; i < 20; i++) {
            frame(world, camera, 1 / 30, () => {
                if (i === 2) world.onLock({ rows: [18, 19], u: 0.2, shape: 'T' });
                if (i === 4) world.onClear({ rows: [19], lines: 1 });
                if (i === 6) world.levelUp(5);
                if (i === 12) world.onGameOver();
            });
        }
        world.seek(80);
        frame(world, camera, 1 / 30);
        expect(count(scene)).toBe(before);
        world.dispose();
    });

    it('writes the mist\'s drift, the cards\' band, the zone\'s haze and the tide clock every frame', () => {
        const { world, camera } = makeWorld('Low', {
            level: 4, at: 20, width: 1920, height: 1080,
        });
        const { u } = world;
        const drift = mistDrift(20);
        expect(u.mistDrift.value.x).toBeCloseTo(drift[0], 4);
        expect(u.mistDrift.value.y).toBeCloseTo(drift[1], 4);
        expect(u.mistDrift.value.z).toBeCloseTo(drift[2], 4);
        frame(world, camera, 0.5);
        expect(u.mistDrift.value.x).not.toBeCloseTo(drift[0], 4);
        // The cards' union on screen (what drifts keeps out of it).
        const card = cardUnion(world.layout);
        expect(u.cardRect.value.x).toBeCloseTo(card.x0, 6);
        expect(u.cardRect.value.z).toBeCloseTo(card.x1, 6);
        world.setLayout({
            cardCount: 1,
            cards: [{
                x0: 0.3, y0: 0.1, x1: 0.5, y1: 0.9,
            }],
            hud: null,
            boards: [],
        }, 16 / 9);
        expect(u.cardRect.value.x).toBeCloseTo(0.3, 6);
        expect(u.cardRect.value.z).toBeCloseTo(0.5, 6);
        world.dispose();
        // The haze is the zone's, measured from its tide top (it stands still while the tide breathes);
        // the tide clock's air gain thickens it toward high water (on the rays the shader gates), the
        // vapour begins higher over the risen tide, and the phase is reported.
        const low = makeWorld('Low', { level: 4, at: 0 });
        const rising = makeWorld('Low', { level: 4, at: TIDE_PERIOD / 4 });
        const high = makeWorld('Low', { level: 4, at: TIDE_PERIOD / 2 });
        [low, rising, high].forEach(({ world: w }) => {
            expect(w.u.sigmaA.value).toBeCloseTo(ZONES[1].sigmaA, 9);
            expect(w.u.hazeY.value).toBeCloseTo(ZONES[1].tideTop, 9);
        });
        expect(low.world.u.airGain.value).toBeCloseTo(tideClock(0).air, 9);
        expect(high.world.u.airGain.value).toBeCloseTo(tideClock(TIDE_PERIOD / 2).air, 9);
        expect(high.world.u.airGain.value).toBeGreaterThan(low.world.u.airGain.value);
        expect(high.world.u.mistOnset.value).toBeGreaterThan(low.world.u.mistOnset.value);
        expect(high.world.u.mistOnset.value).toBeCloseTo(
            mistOnset(tideClock(TIDE_PERIOD / 2).onset, high.world.u.tide.value, high.world.u.camY.value),
            9,
        );
        expect(low.world.u.tideHigh.value).toBeCloseTo(0, 6);
        expect(high.world.u.tideHigh.value).toBeCloseTo(1, 6);
        expect(rising.world.u.tideRise.value).toBeCloseTo(1, 6);
        expect(low.world.getState().tidePhase).toBe('clearing');
        expect(high.world.getState().tidePhase).toBe('immersion');
        expect(high.world.u.tide.value).toBeGreaterThan(low.world.u.tide.value);
        [low, rising, high].forEach(({ world: w }) => w.dispose());
    });
});
