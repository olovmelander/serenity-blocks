import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    FOREST_TREE_URLS, disposeForestAssets, forestImpostorLayout, parseForestMeshes, parseForestTree,
} from '../../src/themes/forest/forest-assets.js';
import {
    FOREST_FEATURE_TREES, FOREST_GROVE_CEILING, FOREST_VIEWS, createForestVisibilityTest, forestEye, forestTowardMoon,
    forestViewFor, layoutForestGrove,
} from '../../src/themes/forest/forest-composition.js';
import { FOREST_MOON_DIRECTION } from '../../src/themes/forest/forest-light.js';
import {
    FOREST_EYE, FOREST_MOON_AZIMUTH_DEGREES, FOREST_MOON_ELEVATION_DEGREES, FOREST_MOON_RADIUS_DEGREES,
    FOREST_RIDE_AXIS, forestBearing, forestRide, forestRideHalfWidth, forestRidePoint,
} from '../../src/themes/forest/forest-plan.js';
import { ForestPost } from '../../src/themes/forest/forest-post.js';
import { FOREST_TIERS, forestTier } from '../../src/themes/forest/forest-quality.js';
import { FOREST_REACTION_LIMITS, ForestReactions } from '../../src/themes/forest/forest-reactions.js';
import { forestFigure } from '../../src/themes/forest/forest-figures.js';
import { FOREST_DEFAULT_BOARD } from '../../src/themes/forest/forest-stage.js';
import {
    FOREST_BOUNDS, FOREST_HEARTH, FOREST_KNOLL, forestGroundHeight, forestPlateau,
} from '../../src/themes/forest/forest-terrain.js';
import { createEmptyForestAssets } from '../../src/themes/forest/forest-theme.js';
import { ForestTrees } from '../../src/themes/forest/forest-trees.js';
import { FOREST_FIGURE_STAND } from '../../src/themes/forest/forest-understory.js';
import { ForestWorld } from '../../src/themes/forest/forest-world.js';

// The world is built in Node from the real asset pack. These tests assert how its parts relate
// (what stands where, what a tier may draw, who owns what), not the numbers it is tuned to.
const assetDirectory = new URL('../../src/themes/forest/assets/', import.meta.url);
const STAG = forestFigure('stag');
const TREE_NAMES = Object.keys(FOREST_TREE_URLS);
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
// The tiers built once and shared by the scene-contract tests, dearest first.
const BUILT = ['High', 'Medium', 'Low', 'Minimal'];
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const DEG = Math.PI / 180;
// Building a forest from the real asset pack takes seconds on a busy machine.
const SLOW = 120000;
const owned = [];
const bundles = [];
const files = new Map();

function seededRandom(seed = 419) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

async function parseGlb(file) {
    if (!files.has(file)) {
        const bytes = readFileSync(new URL(file, assetDirectory));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return new GLTFLoader().parseAsync(files.get(file).slice(0), '');
}

/** The real asset pack, parsed from disk; the sprite sheet and the moon are stand-in data textures. */
async function loadBundle({
    trees = TREE_NAMES, impostors = true, props = true, moon = true, track = true,
} = {}) {
    const [foliage, propsGltf, ...gltfs] = await Promise.all([parseGlb('forest-foliage.glb'),
        parseGlb('forest-props.glb'), ...trees.map((name) => parseGlb(`${name}.glb`))]);
    const assets = {
        foliage: parseForestMeshes(foliage, 'Foliage'),
        props: parseForestMeshes(propsGltf, 'Props'),
        trees: {},
        impostors: null,
        moon: moon ? new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(200), 4, 4) : null,
    };
    trees.forEach((name, index) => { assets.trees[name] = parseForestTree(gltfs[index], name); });
    if (impostors) {
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
        assets.impostors = { ...forestImpostorLayout(), texture };
    }
    if (!props) {
        Object.values(assets.props.meshes).forEach((geometry) => geometry.dispose());
        assets.props = null;
    }
    if (track) bundles.push(assets);
    return assets;
}

function createWorld(quality, assets, { seed = 419, aspect = LANDSCAPE, track = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 3400);
    const world = new ForestWorld({
        scene, camera, quality, rng: seededRandom(seed), assets,
    });
    if (track) owned.push(world);
    return {
        scene, camera, world, assets, tier: FOREST_TIERS[quality],
    };
}

async function buildWorld(quality = 'Minimal', options = {}) {
    const built = createWorld(quality, options.assets ?? await loadBundle(options), options);
    built.world.build();
    return built;
}

function drawables(group) {
    const meshes = [];
    group.traverse((object) => { if (object.isMesh) meshes.push(object); });
    return meshes;
}

function named(group, pattern) {
    return drawables(group).filter((mesh) => (
        typeof pattern === 'string' ? mesh.name === pattern : pattern.test(mesh.name)));
}

function resources(group) {
    const geometries = new Set();
    const materials = new Set();
    const instanced = new Set();
    group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
        if (object.isInstancedMesh) instanced.add(object);
    });
    return { geometries, materials, instanced };
}

function assetGeometries(assets) {
    return new Set([...Object.values(assets.foliage?.meshes ?? {}), ...Object.values(assets.props?.meshes ?? {}),
        ...Object.values(assets.trees).map((tree) => tree.bark)]);
}

function allFinite(array) {
    if (!ArrayBuffer.isView(array)) return true;
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** Position and scale of every instance of a set of instanced meshes. */
function instances(meshes) {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const result = [];
    for (const mesh of meshes) {
        for (let index = 0; index < mesh.count; index++) {
            mesh.getMatrixAt(index, matrix);
            matrix.decompose(position, rotation, scale);
            result.push({
                mesh: mesh.name, x: position.x, y: position.y, z: position.z, scale: scale.x,
            });
        }
    }
    return result;
}

function eyeOf(view) {
    return new THREE.Vector3(...forestEye(view));
}

/** A camera framed the way the world frames it for a screen. */
function framedCamera(aspect) {
    const view = forestViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 3400);
    camera.position.copy(eyeOf(view));
    camera.lookAt(...view.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
}

/** Unit vector toward a point of the sky given in degrees. */
function skyDirection(azimuth, elevation) {
    return new THREE.Vector3(
        Math.sin(azimuth * DEG) * Math.cos(elevation * DEG),
        Math.sin(elevation * DEG),
        -Math.cos(azimuth * DEG) * Math.cos(elevation * DEG),
    );
}

function fakeRenderer(render = vi.fn()) {
    return {
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 0.75,
        outputColorSpace: THREE.SRGBColorSpace,
        render,
    };
}

/** A renderer that, like the real one, can be pointed at an offscreen target. */
function targetRenderer(previous = null) {
    const renderer = fakeRenderer();
    const log = { bound: [], drawnInto: [], disposed: [] };
    let current = previous;
    renderer.getRenderTarget = vi.fn(() => current);
    renderer.setRenderTarget = vi.fn((target) => {
        current = target;
        log.bound.push(target);
        target?.addEventListener?.('dispose', () => log.disposed.push(target));
    });
    renderer.render.mockImplementation(() => log.drawnInto.push(current));
    return { renderer, log, current: () => current };
}

function createPost(quality = 'Low', {
    render = vi.fn(), renderer = fakeRenderer(render), light, scene, camera,
} = {}) {
    const options = {
        renderer,
        scene: scene ?? new THREE.Scene(),
        camera: camera ?? new THREE.PerspectiveCamera(),
        quality,
    };
    if (light !== undefined) options.light = light;
    const post = new ForestPost(options);
    owned.push(post);
    return { ...options, post };
}

/** A director frame with every cue in it: envelopes, emitters, waves, a front, a figure, stars. */
function eventfulReactions(quality = 'High') {
    const reactions = new ForestReactions({ quality, rng: seededRandom(5) });
    const piece = { x: 1, y: 20, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] };
    reactions.onHardDrop({ piece, distance: 17 });
    reactions.onPieceLock({ piece });
    reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
    reactions.onPieceLock({ piece: { x: 7, y: 12, shape: [[1]] } });
    reactions.onLineClear(2, { clearedRows: [12, 13] });
    reactions.onCombo(9);
    reactions.onTSpin({ piece });
    reactions.onBackToBack();
    reactions.onPerfectClear();
    reactions.onLevelUp();
    return reactions;
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeForestAssets(assets));
    vi.restoreAllMocks();
});

describe('Forest quality tiers', () => {
    it('describes the same six tiers as the reaction director, with one set of columns', () => {
        expect(Object.keys(FOREST_TIERS).sort()).toEqual([...TIER_ORDER].sort());
        expect(Object.keys(FOREST_TIERS).sort()).toEqual(Object.keys(FOREST_REACTION_LIMITS).sort());
        expect(Object.isFrozen(FOREST_TIERS)).toBe(true);
        const columns = Object.keys(FOREST_TIERS.High).sort();
        for (const [name, tier] of Object.entries(FOREST_TIERS)) {
            expect(Object.keys(tier).sort(), name).toEqual(columns);
            expect(Object.isFrozen(tier)).toBe(true);
            expect(forestTier(name)).toBe(tier);
            expect(tier.shadowMap).toHaveLength(2);
            for (const size of tier.shadowMap) {
                expect(Number.isInteger(Math.log2(size)), `${name} shadow map ${size}`).toBe(true);
            }
            for (const key of ['groveTrees', 'farTrees', 'ferns', 'grass', 'fungi', 'rocks', 'fireflies', 'pulses',
                'motes', 'mist']) {
                expect(Number.isInteger(tier[key]) && tier[key] > 0, `${name}.${key}`).toBe(true);
            }
            for (const key of ['flowers', 'trail', 'lightMap', 'godrays']) {
                expect(Number.isInteger(tier[key]) && tier[key] >= 0, `${name}.${key}`).toBe(true);
            }
            expect(tier.foliage).toBeGreaterThan(0);
            expect(tier.foliage).toBeLessThanOrEqual(1);
            for (const key of ['limbs', 'stars', 'post']) expect(typeof tier[key], `${name}.${key}`).toBe('boolean');
            // The beams and the bloom live in the RenderPipeline: no pipeline, neither of them.
            if (!tier.post) expect([tier.godrays, tier.godraysScale, tier.bloomScale]).toEqual([0, 0, 0]);
            if (tier.godrays > 0) {
                expect(tier.godraysScale).toBeGreaterThan(0);
                expect(tier.godraysScale).toBeLessThanOrEqual(1);
            }
            if (tier.post) {
                expect(tier.bloomScale).toBeGreaterThan(0);
                expect(tier.bloomScale).toBeLessThanOrEqual(1);
            }
            // What the scene can actually make: the procedural grove has a ceiling.
            expect(tier.groveTrees).toBeLessThanOrEqual(FOREST_GROVE_CEILING);
            // A firefly light map too small to hold one pool of light would be worse than none.
            if (tier.lightMap > 0) expect(tier.lightMap).toBeGreaterThanOrEqual(16);
        }
        for (const quality of ['low', 'Potato', '', undefined, null, 7]) {
            expect(forestTier(quality)).toBe(FOREST_TIERS.High);
        }
    });

    it('never asks a cheaper tier for more than a dearer one', () => {
        for (let index = 1; index < TIER_ORDER.length; index++) {
            const cheaper = FOREST_TIERS[TIER_ORDER[index]];
            const dearer = FOREST_TIERS[TIER_ORDER[index - 1]];
            for (const key of ['groveTrees', 'farTrees', 'foliage', 'ferns', 'grass', 'fungi', 'flowers', 'rocks',
                'fireflies', 'trail', 'lightMap', 'pulses', 'motes', 'mist', 'godrays', 'godraysScale', 'bloomScale']) {
                expect(cheaper[key], `${TIER_ORDER[index]}.${key}`).toBeLessThanOrEqual(dearer[key]);
            }
            // The headline numbers really do step down at every tier.
            for (const key of ['groveTrees', 'farTrees', 'ferns', 'grass', 'fireflies', 'motes']) {
                expect(cheaper[key], `${TIER_ORDER[index]}.${key}`).toBeLessThan(dearer[key]);
            }
            const texels = (tier) => tier.shadowMap[0] * tier.shadowMap[1];
            expect(texels(cheaper)).toBeLessThanOrEqual(texels(dearer));
            for (const key of ['post', 'limbs', 'stars']) {
                expect(Number(cheaper[key]), `${TIER_ORDER[index]}.${key}`).toBeLessThanOrEqual(Number(dearer[key]));
            }
        }
        expect(FOREST_TIERS.Extreme.post).toBe(true);
        expect(FOREST_TIERS.Minimal.post).toBe(false);
    });
});

describe('Forest plan: the eye, the moon and the ride', () => {
    it('runs the ride from the eye straight toward the moon', () => {
        expect(Object.isFrozen(FOREST_EYE)).toBe(true);
        expect(Object.isFrozen(FOREST_RIDE_AXIS)).toBe(true);
        expect(Math.hypot(FOREST_RIDE_AXIS.x, FOREST_RIDE_AXIS.z)).toBeCloseTo(1, 12);
        // The eye is where the ride starts.
        expect(forestRide(FOREST_EYE.x, FOREST_EYE.z).s).toBeCloseTo(0, 12);
        expect(forestRide(FOREST_EYE.x, FOREST_EYE.z).d).toBeCloseTo(0, 12);
        expect(forestRidePoint(0)).toEqual({ x: FOREST_EYE.x, z: FOREST_EYE.z });
        // Every point along it is on the moon's bearing, and the moon itself stands over it.
        for (const s of [1, 20, 80, 300]) {
            const point = forestRidePoint(s);
            expect(forestBearing(point.x, point.z)).toBeCloseTo(FOREST_MOON_AZIMUTH_DEGREES, 9);
            expect(Math.hypot(point.x - FOREST_EYE.x, point.z - FOREST_EYE.z)).toBeCloseTo(s, 9);
            expect(forestTowardMoon(point.x, point.z, 0.001, FOREST_MOON_AZIMUTH_DEGREES)).toBe(true);
        }
        const flat = new THREE.Vector2(FOREST_MOON_DIRECTION.x, FOREST_MOON_DIRECTION.z).normalize();
        expect(flat.x).toBeCloseTo(FOREST_RIDE_AXIS.x, 9);
        expect(flat.y).toBeCloseTo(FOREST_RIDE_AXIS.z, 9);
        expect(FOREST_MOON_DIRECTION.length()).toBeCloseTo(1, 12);
        expect(Math.asin(FOREST_MOON_DIRECTION.y) / DEG).toBeCloseTo(FOREST_MOON_ELEVATION_DEGREES, 9);
        // It looks away from the eye (into the screen), a low moon and a big one.
        expect(FOREST_RIDE_AXIS.z).toBeLessThan(0);
        expect(FOREST_MOON_ELEVATION_DEGREES).toBeGreaterThan(FOREST_MOON_RADIUS_DEGREES * 2);
        expect(FOREST_MOON_ELEVATION_DEGREES).toBeLessThan(40);
        expect(FOREST_MOON_RADIUS_DEGREES).toBeGreaterThan(1);
    });

    it('converts between the ground and ride coordinates both ways', () => {
        const random = seededRandom(3);
        for (let sample = 0; sample < 400; sample++) {
            const x = (random() * 2 - 1) * 300;
            const z = 40 - random() * 420;
            const { s, d } = forestRide(x, z);
            const back = forestRidePoint(s, d);
            expect(back.x).toBeCloseTo(x, 8);
            expect(back.z).toBeCloseTo(z, 8);
            // Distances are kept: it is a rotation about the eye, not a stretch.
            expect(Math.hypot(s, d)).toBeCloseTo(Math.hypot(x - FOREST_EYE.x, z - FOREST_EYE.z), 8);
            const again = forestRide(back.x, back.z);
            expect(again.s).toBeCloseTo(s, 8);
            expect(again.d).toBeCloseTo(d, 8);
        }
        // `d` grows to the right of the ride as the eye looks down it.
        const right = forestRidePoint(30, 5);
        const left = forestRidePoint(30, -5);
        expect(forestBearing(right.x, right.z)).toBeGreaterThan(forestBearing(left.x, left.z));
        expect(forestRidePoint(30)).toEqual(forestRidePoint(30, 0));
        // Bearings: straight ahead is zero, left is negative.
        expect(forestBearing(FOREST_EYE.x, FOREST_EYE.z - 10)).toBeCloseTo(0, 12);
        expect(forestBearing(FOREST_EYE.x - 10, FOREST_EYE.z - 10)).toBeCloseTo(-45, 9);
        expect(forestBearing(FOREST_EYE.x + 10, FOREST_EYE.z - 10)).toBeCloseTo(45, 9);
    });

    it('keeps the ride an opening wide enough for the picture, widening with distance', () => {
        let previous = 0;
        for (const s of [0, 10, 40, 100, 250]) {
            const half = forestRideHalfWidth(s);
            expect(half).toBeGreaterThan(previous);
            previous = half;
        }
        expect(forestRideHalfWidth(0)).toBeGreaterThan(2);
        expect(forestRideHalfWidth(0)).toBeLessThan(30);
        // Behind the eye it is as wide as at the eye, not narrower.
        expect(forestRideHalfWidth(-50)).toBe(forestRideHalfWidth(0));
    });
});

describe('Forest terrain: the floor of the old wood', () => {
    it('is flat floor on the ride and plateau away from it', () => {
        for (const s of [0, 5, 30, 90, 200, 340]) {
            // The ride's own floor, right out to its edges.
            for (const share of [0, 0.5, -0.5, 0.95, -0.95]) {
                const point = forestRidePoint(s, share * forestRideHalfWidth(s));
                expect(forestPlateau(point.x, point.z), `s ${s} share ${share}`).toBe(0);
            }
            // Far to either side the old trees stand on the full plateau.
            for (const d of [-200, 200]) {
                const point = forestRidePoint(s, d);
                expect(forestPlateau(point.x, point.z), `s ${s} d ${d}`).toBe(1);
            }
            // In between it only ever rises, the same on both sides.
            let previous = 0;
            for (let d = 0; d <= 200; d += 2) {
                const right = forestRidePoint(s, d);
                const left = forestRidePoint(s, -d);
                const value = forestPlateau(right.x, right.z);
                expect(value).toBeGreaterThanOrEqual(previous);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
                expect(forestPlateau(left.x, left.z)).toBeCloseTo(value, 9);
                previous = value;
            }
        }
        // The opening widens with distance until it is the whole valley.
        const beside = (s) => {
            const point = forestRidePoint(s, 30);
            return forestPlateau(point.x, point.z);
        };
        expect(beside(10)).toBeGreaterThan(0.9);
        expect(beside(300)).toBeLessThan(beside(100));
        expect(beside(100)).toBeLessThan(beside(10));
        // Behind the eye the wood is closed as it is at the eye.
        const behind = forestRidePoint(-30, 30);
        expect(forestPlateau(behind.x, behind.z)).toBe(beside(0));
    });

    it('is one finite ground without cliffs, falling away down the ride into a valley', () => {
        const {
            minX, maxX, minZ, maxZ,
        } = FOREST_BOUNDS;
        expect(Object.isFrozen(FOREST_BOUNDS)).toBe(true);
        const random = seededRandom(17);
        let lowest = Infinity;
        let highest = -Infinity;
        for (let sample = 0; sample < 6000; sample++) {
            const x = minX + (maxX - minX) * random();
            const z = minZ + (maxZ - minZ) * random();
            const height = forestGroundHeight(x, z);
            if (!Number.isFinite(height)) throw new Error(`not finite at ${x}, ${z}`);
            lowest = Math.min(lowest, height);
            highest = Math.max(highest, height);
            // A step away the ground is at nearly the same height.
            if (Math.abs(forestGroundHeight(x + 0.25, z) - height) > 0.5
                || Math.abs(forestGroundHeight(x, z - 0.25) - height) > 0.5) {
                throw new Error(`cliff at ${x}, ${z}`);
            }
        }
        // A valley metres deep, and high ground that is a rise, not a mountain.
        expect(lowest).toBeLessThan(-5);
        expect(lowest).toBeGreaterThan(-60);
        expect(highest).toBeGreaterThan(1);
        expect(highest).toBeLessThan(40);
        // Along the ride the ground is level near the eye, then falls away and stays down.
        const along = (s, d = 0) => {
            const point = forestRidePoint(s, d);
            return forestGroundHeight(point.x, point.z);
        };
        for (let s = 0; s <= 40; s += 2) expect(Math.abs(along(s))).toBeLessThan(1.5);
        expect(along(200)).toBeLessThan(along(20) - 5);
        expect(along(330)).toBeLessThan(along(20) - 5);
        // Far along it, the plateau beside the valley stands well above its floor.
        expect(along(200, 150)).toBeGreaterThan(along(200) + 5);
        expect(along(200, -150)).toBeGreaterThan(along(200) + 5);
        // Outside the map the function still answers.
        for (const [x, z] of [[1e4, 0], [0, 1e4], [0, -1e4], [-1e4, -1e4]]) {
            expect(Number.isFinite(forestGroundHeight(x, z))).toBe(true);
            expect(Number.isFinite(forestPlateau(x, z))).toBe(true);
        }
    });

    it('raises a knoll on the right, and marks the hearth out in the open glade', () => {
        expect(Object.isFrozen(FOREST_KNOLL)).toBe(true);
        expect(Object.isFrozen(FOREST_HEARTH)).toBe(true);
        const top = forestGroundHeight(FOREST_KNOLL.x, FOREST_KNOLL.z);
        // Higher than the ground a dozen paces away on every side.
        for (let turn = 0; turn < 8; turn++) {
            const angle = (turn / 8) * Math.PI * 2;
            const around = forestGroundHeight(
                FOREST_KNOLL.x + Math.cos(angle) * 14,
                FOREST_KNOLL.z + Math.sin(angle) * 14,
            );
            expect(top).toBeGreaterThan(around + 0.2);
        }
        // To the right of the eye and in front of it.
        expect(forestBearing(FOREST_KNOLL.x, FOREST_KNOLL.z)).toBeGreaterThan(5);
        expect(FOREST_KNOLL.z).toBeLessThan(FOREST_EYE.z);
        // The hearth, where the foxfire spreads from, is in front of the eye on ground with no trees.
        expect(FOREST_HEARTH.z).toBeLessThan(FOREST_EYE.z);
        expect(Math.hypot(FOREST_HEARTH.x - FOREST_EYE.x, FOREST_HEARTH.z - FOREST_EYE.z)).toBeLessThan(40);
        expect(forestPlateau(FOREST_HEARTH.x, FOREST_HEARTH.z)).toBe(0);
    });
});

describe('Forest composition', () => {
    it('frames wide screens in landscape and tall screens upright', () => {
        for (const aspect of [LANDSCAPE, 21 / 9, 16 / 10, 4 / 3, 1.2]) {
            expect(forestViewFor(aspect)).toBe(FOREST_VIEWS.landscape);
        }
        // A square screen is framed upright too: the landscape lens would cut the moon's limb there.
        for (const aspect of [PORTRAIT, 9 / 16, 3 / 4, 1]) expect(forestViewFor(aspect)).toBe(FOREST_VIEWS.portrait);
        expect(Object.isFrozen(FOREST_VIEWS)).toBe(true);
        for (const view of Object.values(FOREST_VIEWS)) {
            expect(Object.isFrozen(view)).toBe(true);
            expect(view.fov).toBeGreaterThan(20);
            expect(view.fov).toBeLessThan(100);
            expect([...view.position, ...view.target].every(Number.isFinite)).toBe(true);
            // The eye stands at the head of the ride, a person's height above its floor ...
            const [x, eyeHeight, z] = view.position;
            expect([x, z]).toEqual([FOREST_EYE.x, FOREST_EYE.z]);
            expect(eyeHeight).toBeGreaterThan(1.2);
            expect(eyeHeight).toBeLessThan(3);
            expect(forestEye(view)).toEqual([x, forestGroundHeight(x, z) + eyeHeight, z]);
            expect(forestPlateau(x, z)).toBe(0);
            // ... and looks far down it, a little upward, to the moon's side of straight ahead.
            expect(view.target[2]).toBeLessThan(z - 30);
            expect(view.target[1]).toBeGreaterThan(forestEye(view)[1]);
            const bearing = forestBearing(view.target[0], view.target[2]);
            expect(Math.sign(bearing)).toBe(Math.sign(FOREST_MOON_AZIMUTH_DEGREES));
            expect(Math.abs(bearing)).toBeLessThanOrEqual(Math.abs(FOREST_MOON_AZIMUTH_DEGREES));
        }
        // A tall screen sees less to the sides, so it opens up and turns further toward the moon.
        expect(FOREST_VIEWS.portrait.fov).toBeGreaterThan(FOREST_VIEWS.landscape.fov);
        expect(forestBearing(FOREST_VIEWS.portrait.target[0], FOREST_VIEWS.portrait.target[2]))
            .toBeLessThan(forestBearing(FOREST_VIEWS.landscape.target[0], FOREST_VIEWS.landscape.target[2]));
    });

    it.each([
        ['ultrawide', 21 / 9], ['widescreen', LANDSCAPE], ['16:10', 16 / 10], ['4:3', 4 / 3], ['tall phone', PORTRAIT],
        ['9:16', 9 / 16], ['upright tablet', 3 / 4],
    ])('keeps the whole moon in the picture on a %s screen', (_label, aspect) => {
        const camera = framedCamera(aspect);
        const reach = FOREST_MOON_RADIUS_DEGREES;
        const across = reach / Math.cos(FOREST_MOON_ELEVATION_DEGREES * DEG);
        const limbs = [[0, 0], [0, reach], [0, -reach], [across, 0], [-across, 0]];
        for (const [azimuth, elevation] of limbs) {
            const direction = skyDirection(
                FOREST_MOON_AZIMUTH_DEGREES + azimuth,
                FOREST_MOON_ELEVATION_DEGREES + elevation,
            );
            const point = camera.position.clone().addScaledVector(direction, 1000).project(camera);
            expect(point.z).toBeLessThan(1);
            expect(Math.abs(point.x), `limb ${azimuth}, ${elevation}`).toBeLessThan(1);
            expect(Math.abs(point.y), `limb ${azimuth}, ${elevation}`).toBeLessThan(1);
        }
        // To the left of the card, where the ride is: the board does not stand in front of it.
        const centre = camera.position.clone().addScaledVector(FOREST_MOON_DIRECTION, 1000).project(camera);
        const screenX = centre.x * 0.5 + 0.5;
        expect(screenX).toBeLessThan(0.5);
        if (aspect >= 4 / 3) expect(screenX).toBeLessThan(FOREST_DEFAULT_BOARD.x0);
    });

    it('places its feature trees by hand, apart from each other, on ground that can carry them', () => {
        expect(Object.isFrozen(FOREST_FEATURE_TREES)).toBe(true);
        expect(FOREST_FEATURE_TREES.length).toBeGreaterThan(6);
        for (const tree of FOREST_FEATURE_TREES) {
            const where = `${tree.asset} at ${tree.x}, ${tree.z}`;
            expect(TREE_NAMES, where).toContain(tree.asset);
            expect([tree.x, tree.z, tree.yaw, tree.scale].every(Number.isFinite), where).toBe(true);
            expect(tree.scale, where).toBeGreaterThan(0.5);
            expect(tree.scale, where).toBeLessThan(1.6);
            expect(tree.tone, where).toBeGreaterThanOrEqual(0);
            expect(tree.tone, where).toBeLessThanOrEqual(1);
            // In front of the eye and inside the map, not down in the far valley.
            expect(tree.z, where).toBeLessThan(FOREST_EYE.z);
            expect(tree.x, where).toBeGreaterThan(FOREST_BOUNDS.minX);
            expect(tree.x, where).toBeLessThan(FOREST_BOUNDS.maxX);
            expect(forestGroundHeight(tree.x, tree.z), where).toBeGreaterThan(-3);
            for (const other of FOREST_FEATURE_TREES) {
                if (other !== tree) expect(Math.hypot(other.x - tree.x, other.z - tree.z), where).toBeGreaterThan(2.5);
            }
            // None stands on the spot the eye looks out from.
            expect(Math.hypot(tree.x - FOREST_EYE.x, tree.z - FOREST_EYE.z), where).toBeGreaterThan(5);
        }
        // The picture is framed: an elder on each side of the board, near the eye.
        const [left, right] = FOREST_FEATURE_TREES;
        expect(left.x).toBeLessThan(FOREST_EYE.x - 3);
        expect(right.x).toBeGreaterThan(FOREST_EYE.x + 3);
        for (const elder of [left, right]) {
            expect(Math.hypot(elder.x - FOREST_EYE.x, elder.z - FOREST_EYE.z)).toBeLessThan(25);
            expect(elder.scale).toBe(1);
        }
        // And the ride has walls: old trees to both sides of it, far down it.
        const sides = FOREST_FEATURE_TREES.map((tree) => forestRide(tree.x, tree.z)).filter(({ s }) => s > 20);
        expect(sides.filter(({ d, s }) => d < -forestRideHalfWidth(s)).length).toBeGreaterThanOrEqual(3);
        expect(sides.filter(({ d, s }) => d > forestRideHalfWidth(s)).length).toBeGreaterThanOrEqual(3);
    });

    it('lays out the same grove for the same seed, in priority order so that a tier takes a prefix', () => {
        const grove = layoutForestGrove(seededRandom(5));
        expect(layoutForestGrove(seededRandom(5))).toEqual(grove);
        expect(layoutForestGrove(seededRandom(6))).not.toEqual(grove);
        expect(grove.length).toBeLessThanOrEqual(FOREST_GROVE_CEILING);
        const budgets = Object.values(FOREST_TIERS).map((tier) => tier.groveTrees);
        expect(grove.length).toBeGreaterThanOrEqual(Math.max(...budgets));
        // Generated in priority order: a cheaper tier keeps the same forest with fewer trees.
        for (const count of [0, 1, 7, ...budgets]) {
            expect(layoutForestGrove(seededRandom(5), count)).toEqual(grove.slice(0, count));
        }
        const every = [...FOREST_FEATURE_TREES, ...grove];
        for (const tree of grove) {
            const where = `${tree.asset} at ${tree.x}, ${tree.z}`;
            expect(TREE_NAMES, where).toContain(tree.asset);
            expect([tree.x, tree.z, tree.yaw].every(Number.isFinite), where).toBe(true);
            expect(tree.scale, where).toBeGreaterThan(0.6);
            expect(tree.scale, where).toBeLessThan(1.5);
            expect(tree.tone, where).toBeGreaterThanOrEqual(0);
            expect(tree.tone, where).toBeLessThanOrEqual(1);
            expect(typeof tree.far, where).toBe('boolean');
            expect(tree.x, where).toBeGreaterThan(FOREST_BOUNDS.minX);
            expect(tree.x, where).toBeLessThan(FOREST_BOUNDS.maxX);
            expect(tree.z, where).toBeGreaterThan(FOREST_BOUNDS.minZ);
            expect(tree.z, where).toBeLessThan(FOREST_BOUNDS.maxZ);
            // Never on the ride's floor, and never on the open ground at the eye's feet.
            const { s, d } = forestRide(tree.x, tree.z);
            if (s > 4) expect(Math.abs(d), where).toBeGreaterThan(forestRideHalfWidth(s));
            expect(forestPlateau(tree.x, tree.z), where).toBeGreaterThan(0);
            expect(Math.hypot(tree.x - FOREST_EYE.x, tree.z - FOREST_EYE.z), where).toBeGreaterThan(4);
            // No two trunks share a spot, the hand-placed trees included.
            for (const other of every) {
                if (other !== tree) expect(Math.hypot(other.x - tree.x, other.z - tree.z), where).toBeGreaterThan(4);
            }
        }
        // The grove is a wood of several kinds of tree.
        expect(new Set(grove.map((tree) => tree.asset)).size).toBeGreaterThanOrEqual(4);
        // Even the smallest tier's share closes the wood on both sides, near and far.
        const least = grove.slice(0, Math.min(...budgets));
        expect(least.some((tree) => tree.far)).toBe(true);
        expect(least.some((tree) => !tree.far)).toBe(true);
        expect(least.some((tree) => forestRide(tree.x, tree.z).d < 0)).toBe(true);
        expect(least.some((tree) => forestRide(tree.x, tree.z).d > 0)).toBe(true);
    });

    it('recognises what could ever be on screen, so sprays nobody sees are never built', () => {
        const visible = createForestVisibilityTest();
        // Down the ride, toward the moon: certainly.
        const ahead = forestRidePoint(40);
        expect(visible(ahead.x, 5, ahead.z, 1)).toBe(true);
        for (const tree of FOREST_FEATURE_TREES) expect(visible(tree.x, 10, tree.z, 6), tree.asset).toBe(true);
        // Behind the eye, far overhead, and far off to the side of the foreground: never.
        expect(visible(FOREST_EYE.x, 5, FOREST_EYE.z + 60, 1)).toBe(false);
        expect(visible(FOREST_EYE.x, 400, FOREST_EYE.z - 10, 1)).toBe(false);
        expect(visible(FOREST_EYE.x + 400, 5, FOREST_EYE.z, 1)).toBe(false);
        expect(visible(FOREST_EYE.x - 400, 5, FOREST_EYE.z, 1)).toBe(false);
        // A big enough thing just outside the frame still counts.
        expect(visible(FOREST_EYE.x, 5, FOREST_EYE.z + 60, 200)).toBe(true);
        // It is conservative: everything the real cameras can see, at every screen shape the game
        // frames, passes; including the corners of the picture and a view leaning with the pointer.
        for (const aspect of [21 / 9, LANDSCAPE, 4 / 3, 1, 0.84, 3 / 4, 9 / 16, PORTRAIT]) {
            const camera = framedCamera(aspect);
            for (const [nx, ny] of [[0, 0], [0.99, 0.99], [-0.99, 0.99], [0.99, -0.99], [-0.99, -0.99], [0, 0.99],
                [0.99, 0], [-0.99, 0]]) {
                for (const depth of [0.5, 0.9, 0.99, 0.999]) {
                    const point = new THREE.Vector3(nx, ny, depth).unproject(camera);
                    const where = `aspect ${aspect} at ${nx}, ${ny}, ${depth}`;
                    expect(visible(point.x, point.y, point.z, 0.5), where).toBe(true);
                }
            }
        }
    });
});

describe('Forest world scene contracts', () => {
    const forest = {};

    beforeAll(async () => {
        const built = await Promise.all(BUILT.map((quality) => buildWorld(quality, { track: false })));
        BUILT.forEach((quality, index) => { forest[quality] = built[index]; });
    }, SLOW);

    afterAll(() => {
        Object.values(forest).forEach(({ world, assets }) => {
            world.dispose();
            disposeForestAssets(assets);
        });
    });

    it.each(BUILT)('builds the complete finite node scene at %s', (quality) => {
        const {
            scene, camera, world, assets, tier,
        } = forest[quality];
        expect(world.tier).toBe(tier);
        expect(world.quality).toBe(quality);
        expect(world.built).toBe(true);
        expect(world.disposed).toBe(false);
        expect(scene.children).toEqual([world.group]);
        expect(world.group.parent).toBe(scene);
        for (const part of ['terrain', 'trees', 'understory', 'backdrop', 'sky', 'fireflies']) {
            expect(world[part].group.parent, part).toBe(world.group);
        }
        expect(world.light.moon.parent).toBe(world.group);
        expect(world.light.moon.target.parent).toBe(world.group);
        const meshes = drawables(world.group);
        expect(meshes.length).toBeGreaterThan(15);
        world.group.traverse((object) => {
            // Everything drawn is a mesh: no points, lines or sprites with their own material rules.
            expect(Boolean(object.isPoints || object.isLine || object.isSprite), object.name).toBe(false);
        });
        const shared = assetGeometries(assets);
        for (const mesh of meshes) {
            expect(mesh.name).toMatch(/^Forest/);
            // Node materials only: both backends shade from the same graph, and nothing
            // carries hand-written GLSL that the WebGPU backend could not run.
            expect(Array.isArray(mesh.material)).toBe(false);
            expect(mesh.material.isNodeMaterial, mesh.name).toBe(true);
            expect(mesh.material.isShaderMaterial, mesh.name).not.toBe(true);
            expect(mesh.material.isRawShaderMaterial, mesh.name).not.toBe(true);
            expect(mesh.material.name, mesh.name).toMatch(/^Forest/);
            expect(mesh.material.fog, mesh.name).toBe(false);
            expect((mesh.material.fragmentNode ?? mesh.material.colorNode)?.isNode, mesh.name).toBe(true);
            expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0);
            for (const [key, attribute] of Object.entries(mesh.geometry.attributes)) {
                expect(allFinite(attribute.array), `${mesh.name}.${key}`).toBe(true);
            }
            if (mesh.isInstancedMesh) {
                expect(allFinite(mesh.instanceMatrix.array), mesh.name).toBe(true);
                expect(mesh.count).toBeGreaterThan(0);
                expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
            }
            if (mesh.castShadow) {
                // The shadow pass multiplies a caster's alpha by its colorNode, which here would
                // sample the very shadow map being drawn: casters must shade in fragmentNode.
                expect(mesh.material.colorNode ?? null, mesh.name).toBeNull();
                expect(mesh.material.fragmentNode?.isNode, mesh.name).toBe(true);
            }
            if (mesh.material.transparent) {
                // Light in the air is blended over the scene and never writes depth or casts a shadow.
                expect(mesh.material.depthWrite, mesh.name).toBe(false);
                expect(mesh.material.opacityNode?.isNode, mesh.name).toBe(true);
                expect(mesh.castShadow, mesh.name).toBe(false);
            }
        }
        // The solid things of the wood cast into the moon's one shadow map; light and air do not.
        expect(named(world.group, 'ForestGround')[0].castShadow).toBe(true);
        for (const mesh of named(world.group, /^Forest(Bark|Foliage) /)) expect(mesh.castShadow, mesh.name).toBe(true);
        const lightAndAir = /^Forest(Sky|MistBank .+|MoonMotes|FireflyLights|FireflyTrails|Ridges)$/;
        for (const mesh of named(world.group, lightAndAir)) {
            expect(mesh.castShadow, mesh.name).toBe(false);
        }
        // Bark, sprays, fronds and props are drawn straight from the shared asset pack.
        for (const mesh of named(world.group, /^Forest(Bark|Foliage|Boulders|Ferns) |^Forest (log|stump|snag)$/)) {
            expect(shared.has(mesh.geometry), mesh.name).toBe(true);
        }

        // Light: one moon, whose shadow-casting direction is the one every material shades with.
        const { moon } = world.light;
        expect(moon.castShadow).toBe(true);
        expect(moon.shadow.mapSize.toArray()).toEqual(tier.shadowMap);
        expect(moon.shadow.autoUpdate).toBe(false);
        expect(moon.shadow.needsUpdate).toBe(true);
        const toMoon = moon.position.clone().sub(moon.target.position).normalize();
        expect(toMoon.distanceTo(FOREST_MOON_DIRECTION)).toBeLessThan(1e-9);
        expect(world.light.uMoonDir.value.distanceTo(FOREST_MOON_DIRECTION)).toBeLessThan(1e-9);
        expect(world.light.uMoonGain.value).toBe(1);
        // The shadow box holds the glade the eye looks into.
        const box = moon.shadow.camera;
        expect(box.right).toBeGreaterThan(20);
        expect(box.top).toBeGreaterThan(10);
        expect(box.far).toBeGreaterThan(100);

        // Trees.
        const { stats, placements } = world.trees;
        expect(stats.trees).toBe(placements.length);
        expect(stats.trees).toBeLessThanOrEqual(FOREST_FEATURE_TREES.length + tier.groveTrees);
        expect(stats.trees).toBeGreaterThanOrEqual(FOREST_FEATURE_TREES.length + Math.floor(tier.groveTrees * 0.85));
        expect(placements.slice(0, FOREST_FEATURE_TREES.length).map((tree) => [tree.asset, tree.x, tree.z]))
            .toEqual(FOREST_FEATURE_TREES.map((tree) => [tree.asset, tree.x, tree.z]));
        const bark = named(world.group, /^ForestBark /);
        expect(sum(bark.map((mesh) => mesh.count))).toBe(stats.trees);
        const sprays = named(world.group, /^ForestFoliage /);
        expect(sum(sprays.map((mesh) => mesh.count))).toBe(stats.sprays);
        expect(stats.sprays).toBeGreaterThan(0);
        expect(stats.foliageTriangles).toBe(sum(sprays.map((mesh) => (mesh.geometry.index.count / 3) * mesh.count)));
        // What the forest says it draws is what its bark geometry is set to draw.
        expect(stats.barkTriangles).toBe(sum(bark.map((mesh) => (
            (Math.min(mesh.geometry.index.count, mesh.geometry.drawRange.count) / 3) * mesh.count))));
        // Limbs are last in each bark index buffer; tiers without them stop at the core.
        for (const mesh of bark) {
            const tree = assets.trees[mesh.name.replace('ForestBark ', '')];
            const drawn = Math.min(tree.bark.index.count, tree.bark.drawRange.count);
            if (tier.limbs || !(tree.barkCoreIndices > 0)) expect(drawn, tree.name).toBe(tree.bark.index.count);
            else expect(drawn, tree.name).toBe(Math.min(tree.barkCoreIndices, tree.bark.index.count));
        }
        // Every spray draw has its own material: the instance buffers are part of its graph.
        expect(new Set(sprays.map((mesh) => mesh.material)).size).toBe(sprays.length);
        expect(sprays.every((mesh) => mesh.material.side === THREE.DoubleSide)).toBe(true);

        // The far stands, the floor's life and the air.
        const farStands = named(world.group, 'ForestFarStand');
        expect(farStands).toHaveLength(1);
        expect(farStands[0].count).toBe(world.backdrop.count);
        expect(world.backdrop.count).toBeGreaterThan(tier.farTrees * 0.6);
        expect(world.backdrop.count).toBeLessThanOrEqual(tier.farTrees + 2);
        expect(named(world.group, 'ForestRidges')).toHaveLength(1);
        const floor = world.understory.stats;
        expect(floor.ferns).toBeGreaterThan(0);
        expect(floor.ferns).toBeLessThanOrEqual(tier.ferns);
        expect(sum(named(world.group, /^ForestFerns /).map((mesh) => mesh.count))).toBe(floor.fronds);
        expect(floor.fronds).toBeGreaterThan(floor.ferns * 3);
        const [grass] = named(world.group, 'ForestGrass');
        expect(grass.count).toBe(floor.grass);
        expect(floor.grass).toBeGreaterThan(tier.grass * 0.8);
        expect(floor.grass).toBeLessThanOrEqual(tier.grass);
        expect(named(world.group, 'ForestFoxfire')[0].count).toBe(floor.fungi);
        expect(floor.fungi).toBeGreaterThan(0);
        expect(floor.fungi).toBeLessThanOrEqual(tier.fungi);
        expect(floor.flowers).toBe(tier.flowers);
        expect(named(world.group, 'ForestWoodStars').map((mesh) => mesh.count))
            .toEqual(tier.flowers ? [tier.flowers] : []);
        const boulders = named(world.group, /^ForestBoulders /);
        expect(sum(boulders.map((mesh) => mesh.count))).toBe(floor.stones);
        expect(floor.stones).toBeGreaterThan(0);
        expect(new Set(boulders.map((mesh) => mesh.material)).size).toBe(1);
        for (const prop of ['log', 'stump', 'snag']) expect(named(world.group, `Forest ${prop}`), prop).toHaveLength(1);
        expect(world.understory.log).toBe(named(world.group, 'Forest log')[0]);
        expect(named(world.group, 'ForestSky')).toHaveLength(1);
        expect(named(world.group, /^ForestMistBank /)).toHaveLength(tier.mist);
        expect(named(world.group, 'ForestMoonMotes')[0].count).toBe(tier.motes);

        // Fireflies: the lights, and (where the tier draws them) their trails, fed by the
        // simulation's own buffers.
        const { sim, lights, trails } = world.fireflies;
        expect(sim.count).toBe(tier.fireflies);
        expect(sim.ambient + sim.reserve).toBe(tier.fireflies);
        expect(sim.ambient).toBeGreaterThan(0);
        expect(sim.reserve).toBeGreaterThan(sim.ambient * 0.5);
        expect(named(world.group, 'ForestFireflyLights')).toEqual([lights]);
        expect(lights.count).toBe(tier.fireflies);
        expect(lights.material.blending).toBe(THREE.AdditiveBlending);
        if (tier.trail > 0) {
            expect(named(world.group, 'ForestFireflyTrails')).toEqual([trails]);
            expect(trails.count).toBe(tier.fireflies);
            expect(trails.geometry.parameters.heightSegments).toBe(tier.trail);
            // The trail is drawn behind the light it follows.
            expect(trails.renderOrder).toBeLessThan(lights.renderOrder);
        } else {
            expect(named(world.group, 'ForestFireflyTrails')).toEqual([]);
            expect(trails ?? null).toBeNull();
        }
        expect(world.fireflies.homesAttribute.array).toBe(sim.outHome);
        expect(world.fireflies.places.array).toBe(sim.outPlace);
        expect(world.fireflies.glows.array).toBe(sim.outGlow);
        expect(world.fireflies.velocities.array).toBe(sim.outVelocity);
        for (const buffer of [world.fireflies.homesAttribute, world.fireflies.places, world.fireflies.glows,
            world.fireflies.velocities]) {
            expect(buffer.isInstancedBufferAttribute).toBe(true);
            expect(buffer.itemSize).toBe(4);
            expect(buffer.count).toBe(tier.fireflies);
        }
        for (const buffer of [sim.outPlace, sim.outGlow, sim.outVelocity, sim.outHome]) {
            expect(allFinite(buffer)).toBe(true);
        }
        expect(sim.groundHeight).toBe(forestGroundHeight);
        expect(sim.hearth).toBe(FOREST_HEARTH);

        // The forest's own light: a pool of waves, and the map the fireflies' light is gathered into.
        expect(world.light.pulses.count).toBe(tier.pulses);
        expect(world.light.pulses.active()).toBe(0);
        if (tier.lightMap > 0) {
            expect(world.light.field.size).toBe(tier.lightMap);
            expect(world.light.fieldTexture.image.data).toBe(world.light.field.data);
            expect(world.light.fieldTexture.image.width).toBe(tier.lightMap);
        } else {
            expect(world.light.field).toBeNull();
            expect(world.light.fieldTexture).toBeNull();
        }
        // The director that feeds them all is wired to this world's own parts.
        expect(world.director.sim).toBe(sim);
        expect(world.director.pulses).toBe(world.light.pulses);
        expect(world.director.stage).toBe(world.stage);
        expect(world.director.groundHeight).toBe(forestGroundHeight);

        expect(world.getDiagnostics()).toEqual({
            quality,
            ...stats,
            ...floor,
            farTrees: world.backdrop.count,
            fireflies: {
                ambient: sim.ambient, reserve: sim.reserve, live: 0, bound: 0,
            },
            pulses: 0,
        });

        expect(camera.fov).toBe(FOREST_VIEWS.landscape.fov);
        expect(allFinite(Float64Array.from(camera.projectionMatrix.elements))).toBe(true);
        expect(allFinite(Float64Array.from(camera.matrixWorld.elements))).toBe(true);
        expect(world.stage.board).toEqual(FOREST_DEFAULT_BOARD);
        // The far plane holds the sky dome.
        expect(camera.far).toBeGreaterThan(world.sky.sky.geometry.parameters.radius);
    });

    it('keeps the same forest and draws less of it as the tier drops', () => {
        for (let index = 1; index < BUILT.length; index++) {
            const cheaper = forest[BUILT[index]].world;
            const dearer = forest[BUILT[index - 1]].world;
            const less = cheaper.getDiagnostics();
            const more = dearer.getDiagnostics();
            for (const key of ['trees', 'sprays', 'foliageTriangles', 'barkTriangles', 'farTrees', 'ferns', 'fronds',
                'grass', 'fungi', 'flowers', 'stones']) {
                expect(less[key], `${BUILT[index]}.${key}`).toBeLessThanOrEqual(more[key]);
            }
            for (const key of ['trees', 'sprays', 'foliageTriangles', 'farTrees', 'ferns', 'grass']) {
                expect(less[key], `${BUILT[index]}.${key}`).toBeLessThan(more[key]);
            }
            // The numbers come from the one tier table.
            expect(less.fireflies.ambient + less.fireflies.reserve).toBe(FOREST_TIERS[BUILT[index]].fireflies);
            expect(cheaper.fireflies.sim.count).toBeLessThan(dearer.fireflies.sim.count);
            expect(cheaper.light.pulses.count).toBeLessThanOrEqual(dearer.light.pulses.count);
            expect(drawables(cheaper.group).length).toBeLessThanOrEqual(drawables(dearer.group).length);
            // Changing quality must not rearrange the forest: same seed, same trees, fewer of them.
            const kept = cheaper.trees.placements;
            expect(dearer.trees.placements.slice(0, kept.length)).toEqual(kept);
        }
        // A tier without limbs draws far less bark for nearly the same trunks.
        const withLimbs = BUILT.filter((quality) => FOREST_TIERS[quality].limbs).at(-1);
        const without = BUILT.find((quality) => !FOREST_TIERS[quality].limbs);
        if (withLimbs && without) {
            const perTree = (quality) => forest[quality].world.getDiagnostics().barkTriangles
                / forest[quality].world.getDiagnostics().trees;
            expect(perTree(without)).toBeLessThan(perTree(withLimbs) * 0.7);
        }
        // Each tree keeps a smaller share of its sprays where the tier says so.
        const perTree = (quality) => forest[quality].world.getDiagnostics().sprays
            / forest[quality].world.getDiagnostics().trees;
        expect(perTree(BUILT.at(-1))).toBeLessThan(perTree(BUILT[0]));
    });

    it.each(BUILT)('stands every tree of the %s forest on the ground, and none on the ride in front of the moon', (
        quality,
    ) => {
        const { world } = forest[quality];
        const trunks = world.trees.trunks();
        const { placements } = world.trees;
        expect(trunks).toHaveLength(placements.length);
        // Every trunk is rooted a little into the ground under it, wherever it stands.
        const rooted = instances(named(world.group, /^ForestBark /));
        expect(rooted).toHaveLength(placements.length);
        for (const trunk of rooted) {
            const sunk = forestGroundHeight(trunk.x, trunk.z) - trunk.y;
            expect(sunk, `${trunk.mesh} at ${trunk.x}, ${trunk.z}`).toBeGreaterThan(0);
            expect(sunk, `${trunk.mesh} at ${trunk.x}, ${trunk.z}`).toBeLessThan(0.3);
        }
        placements.forEach((tree, index) => {
            const where = `${tree.asset} at ${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}`;
            expect(tree.y, where).toBeCloseTo(trunks[index].y, 9);
            expect(Math.abs(forestGroundHeight(tree.x, tree.z) - tree.y), where).toBeLessThan(0.3);
            expect(trunks[index].radius, where).toBeGreaterThan(0.02);
            expect(trunks[index].height, where).toBeGreaterThan(2);
        });

        const lowerLimb = FOREST_MOON_ELEVATION_DEGREES - FOREST_MOON_RADIUS_DEGREES;
        const discHalfWidth = FOREST_MOON_RADIUS_DEGREES / Math.cos(FOREST_MOON_ELEVATION_DEGREES * DEG);
        const handPlaced = FOREST_FEATURE_TREES.length;
        for (const view of Object.values(FOREST_VIEWS)) {
            const eye = eyeOf(view);
            let underTheMoon = 0;
            placements.forEach((tree, index) => {
                const where = `${tree.asset} at ${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}`;
                const trunk = trunks[index];
                const { s, d } = forestRide(tree.x, tree.z);
                const onTheFloor = s > 0 && Math.abs(d) < forestRideHalfWidth(s);
                const range = Math.hypot(tree.x - eye.x, tree.z - eye.z);
                const topElevation = Math.atan2(trunk.y + trunk.height - eye.y, range) / DEG;
                const trunkHalfWidth = Math.atan2(trunk.radius, range) / DEG;
                // The scattered grove keeps off the ride's floor altogether.
                if (index >= handPlaced) expect(onTheFloor, where).toBe(false);
                // Whatever stands on the moon's own bearing, on the ride's floor or beyond it, is young
                // growth: its top stays under the moon's lower limb. Anything taller has its trunk
                // clear to one side of the disc.
                if (forestTowardMoon(tree.x, tree.z, discHalfWidth + trunkHalfWidth, FOREST_MOON_AZIMUTH_DEGREES)) {
                    expect(topElevation, where).toBeLessThan(lowerLimb);
                    underTheMoon += 1;
                } else {
                    expect(Math.abs(forestBearing(tree.x, tree.z) - FOREST_MOON_AZIMUTH_DEGREES), where)
                        .toBeGreaterThanOrEqual(discHalfWidth + trunkHalfWidth);
                }
            });
            // The ride is not empty for all that: something does grow in it, low, between the eye and the moon.
            expect(underTheMoon).toBeGreaterThan(0);
            // And no crown hides the moon either: whatever a bough may take of its edge, the heart
            // of the disc is clear of every spray of every tree.
            const matrix = new THREE.Matrix4();
            const position = new THREE.Vector3();
            const rotation = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            let nearest = Infinity;
            let across = 0;
            for (const mesh of named(world.group, /^ForestFoliage /)) {
                const { radius } = mesh.geometry.boundingSphere;
                for (let index = 0; index < mesh.count; index++) {
                    mesh.getMatrixAt(index, matrix);
                    matrix.decompose(position, rotation, scale);
                    const offset = position.sub(eye);
                    const reach = Math.atan2(radius * scale.x, offset.length()) / DEG;
                    const angle = offset.angleTo(FOREST_MOON_DIRECTION) / DEG;
                    nearest = Math.min(nearest, angle - reach);
                    if (angle < FOREST_MOON_RADIUS_DEGREES) across += 1;
                }
            }
            expect(nearest).toBeGreaterThan(0);
            // A handful of sprays may cross its limb (the open pine that cuts the light into beams);
            // a crown standing in front of it would be hundreds.
            expect(across).toBeLessThan(40);
        }
        const inTheRide = placements.slice(0, handPlaced).filter((tree) => {
            const { s, d } = forestRide(tree.x, tree.z);
            return s > 0 && Math.abs(d) < forestRideHalfWidth(s);
        });
        expect(inTheRide.length).toBeGreaterThan(0);
    });

    it('stands everything else on the same analytic ground', () => {
        const { world, camera } = forest.High;
        const ground = world.terrain.mesh.geometry.attributes.position;
        let worst = 0;
        const span = {
            minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        };
        for (let index = 0; index < ground.count; index++) {
            const expected = forestGroundHeight(ground.getX(index), ground.getZ(index));
            worst = Math.max(worst, Math.abs(ground.getY(index) - expected));
            span.minX = Math.min(span.minX, ground.getX(index));
            span.maxX = Math.max(span.maxX, ground.getX(index));
            span.minZ = Math.min(span.minZ, ground.getZ(index));
            span.maxZ = Math.max(span.maxZ, ground.getZ(index));
        }
        expect(worst).toBeLessThan(1e-4);
        expect(span).toEqual(FOREST_BOUNDS);
        expect(world.terrain.height(3, -20)).toBe(forestGroundHeight(3, -20));
        const trunks = world.trees.trunks();
        const clearOfTrunks = (point, margin = 0) => trunks.every((trunk) => (
            Math.hypot(trunk.x - point.x, trunk.z - point.z) >= trunk.radius + margin));
        // Grass grows out of the ground it stands on, never out of a trunk.
        const tufts = instances(named(world.group, 'ForestGrass'));
        for (let index = 0; index < tufts.length; index += 5) {
            const tuft = tufts[index];
            expect(Math.abs(tuft.y - forestGroundHeight(tuft.x, tuft.z))).toBeLessThan(0.1);
            expect(clearOfTrunks(tuft)).toBe(true);
            expect(tuft.z).toBeLessThan(FOREST_EYE.z + 0.5);
        }
        // Every frond of a fern rosette is rooted where the rosette is.
        const fronds = instances(named(world.group, /^ForestFerns /));
        for (let index = 0; index < fronds.length; index += 3) {
            const frond = fronds[index];
            expect(Math.abs(frond.y - forestGroundHeight(frond.x, frond.z))).toBeLessThan(0.15);
            expect(clearOfTrunks(frond)).toBe(true);
            // None right under the eye, where it would fill the screen.
            expect(Math.hypot(frond.x - FOREST_EYE.x, frond.z - FOREST_EYE.z)).toBeGreaterThan(2);
        }
        // Boulders are bedded into whatever is under them.
        for (const stone of instances(named(world.group, /^ForestBoulders /))) {
            const bedded = forestGroundHeight(stone.x, stone.z) - stone.y;
            expect(bedded).toBeGreaterThanOrEqual(0);
            expect(bedded).toBeLessThan(stone.scale * 0.5 + 0.05);
        }
        // Wood stars lie on the moss.
        const stars = instances(named(world.group, 'ForestWoodStars'));
        for (let index = 0; index < stars.length; index += 4) {
            const lift = stars[index].y - forestGroundHeight(stars[index].x, stars[index].z);
            expect(lift).toBeGreaterThan(0);
            expect(lift).toBeLessThan(0.3);
        }
        // Foxfire grows on the floor or on the fallen wood above it, never under the moss.
        for (const cap of instances(named(world.group, 'ForestFoxfire'))) {
            const lift = cap.y - forestGroundHeight(cap.x, cap.z);
            expect(lift).toBeGreaterThan(-0.1);
            expect(lift).toBeLessThan(2);
        }
        // The fallen spruce, its stump and the snag rest on the ground too.
        for (const prop of ['log', 'stump', 'snag']) {
            const [mesh] = named(world.group, `Forest ${prop}`);
            const sunk = forestGroundHeight(mesh.position.x, mesh.position.z) - mesh.position.y;
            expect(sunk, prop).toBeGreaterThanOrEqual(0);
            expect(sunk, prop).toBeLessThan(0.4);
        }
        // Far stands grow beyond the modelled wood, never on the ride's floor or in the foreground.
        for (const card of instances(named(world.group, 'ForestFarStand'))) {
            expect(Math.hypot(card.x - camera.position.x, card.z - camera.position.z)).toBeGreaterThan(40);
            expect(Math.abs(card.y - forestGroundHeight(card.x, card.z))).toBeLessThan(6);
            const { s, d } = forestRide(card.x, card.z);
            if (s > 0 && s < 140) expect(Math.abs(d)).toBeGreaterThan(forestRideHalfWidth(s) - 6);
        }
        // Fireflies keep house over this floor: in front of the eye, a pace clear of the ground.
        const { sim } = world.fireflies;
        for (let index = 0; index < sim.ambient; index++) {
            const [x, y, z] = [sim.home[index * 3], sim.home[index * 3 + 1], sim.home[index * 3 + 2]];
            expect(y - forestGroundHeight(x, z)).toBeGreaterThan(0.8);
            expect(y - forestGroundHeight(x, z)).toBeLessThan(25);
            expect(Math.hypot(x - FOREST_EYE.x, z - FOREST_EYE.z)).toBeLessThan(120);
            expect(sim.homeAway[index]).toBeCloseTo(Math.hypot(x - FOREST_HEARTH.x, z - FOREST_HEARTH.z), 3);
        }
        // And the camera itself stands on the floor it was framed from.
        const floorAtEye = forestGroundHeight(camera.position.x, camera.position.z);
        expect(camera.position.y).toBeCloseTo(floorAtEye + FOREST_VIEWS.landscape.position[1], 12);
    });

    it('gives the figure a place to stand: on the floor, in view beside the card, clear of every trunk', () => {
        const { world } = forest.High;
        const anchor = world.director.figureAnchor;
        expect(Object.isFrozen(FOREST_FIGURE_STAND)).toBe(true);
        expect([anchor.x, anchor.z]).toEqual([FOREST_FIGURE_STAND.x, FOREST_FIGURE_STAND.z]);
        expect(anchor.y).toBe(forestGroundHeight(anchor.x, anchor.z));
        // In front of the eye, near enough to read as an animal, not out on the valley's side.
        const range = Math.hypot(anchor.x - FOREST_EYE.x, anchor.z - FOREST_EYE.z);
        expect(anchor.z).toBeLessThan(FOREST_EYE.z);
        expect(range).toBeGreaterThan(6);
        expect(range).toBeLessThan(45);
        // Side on to the eye: it faces across the line of sight, with its depth along it.
        const facing = new THREE.Vector2(anchor.facing.x, anchor.facing.z);
        const depth = new THREE.Vector2(anchor.depth.x, anchor.depth.z);
        expect(facing.length()).toBeCloseTo(1, 9);
        expect(depth.length()).toBeCloseTo(1, 9);
        expect(facing.dot(depth)).toBeCloseTo(0, 9);
        const away = new THREE.Vector2(anchor.x - FOREST_EYE.x, anchor.z - FOREST_EYE.z).normalize();
        expect(depth.dot(away)).toBeCloseTo(1, 9);
        // It looks toward the moon's side of the picture.
        expect(Math.sign(facing.x)).toBe(Math.sign(FOREST_RIDE_AXIS.x));
        // Its body does not stand inside a tree, and it is on screen beside the default card.
        for (const trunk of world.trees.trunks()) {
            expect(Math.hypot(trunk.x - anchor.x, trunk.z - anchor.z), trunk.asset).toBeGreaterThan(trunk.radius + 1);
        }
        // On a wide screen the whole animal, hooves to antlers and nose to tail, is in the picture
        // and beside the default card rather than behind it.
        for (const aspect of [LANDSCAPE, 21 / 9]) {
            const camera = framedCamera(aspect);
            const length = (STAG.bounds.maxX - STAG.bounds.minX) * 1.5;
            for (const [along, up] of [[-length / 2, 0], [length / 2, 0], [0, 0], [0, STAG.bounds.maxY * 1.5]]) {
                const point = new THREE.Vector3(
                    anchor.x + anchor.facing.x * along,
                    anchor.y + up,
                    anchor.z + anchor.facing.z * along,
                ).project(camera);
                const screenX = point.x * 0.5 + 0.5;
                expect(Math.abs(point.x), `aspect ${aspect}`).toBeLessThan(1);
                expect(Math.abs(point.y), `aspect ${aspect}`).toBeLessThan(1);
                const besideTheCard = screenX < FOREST_DEFAULT_BOARD.x0 || screenX > FOREST_DEFAULT_BOARD.x1;
                expect(besideTheCard, `aspect ${aspect}`).toBe(true);
            }
        }
    });

    it('reproduces the same world for the same seed', async () => {
        const first = forest.Minimal.world;
        const assets = await loadBundle();
        const { world: second } = createWorld('Minimal', assets);
        const { world: other } = createWorld('Minimal', assets, { seed: 12345 });
        second.build();
        expect(second.trees.placements).toEqual(first.trees.placements);
        expect(second.getDiagnostics()).toEqual(first.getDiagnostics());
        const firstMeshes = drawables(first.group);
        const secondMeshes = drawables(second.group);
        expect(secondMeshes.map((mesh) => mesh.name)).toEqual(firstMeshes.map((mesh) => mesh.name));
        secondMeshes.forEach((mesh, index) => {
            if (!mesh.isInstancedMesh) return;
            expect(mesh.count).toBe(firstMeshes[index].count);
            expect(mesh.instanceMatrix.array).toEqual(firstMeshes[index].instanceMatrix.array);
        });
        expect(second.fireflies.sim.outHome).toEqual(first.fireflies.sim.outHome);
        expect(second.fireflies.sim.outPlace).toEqual(first.fireflies.sim.outPlace);
        // Another seed plants another grove round the same hand-placed trees.
        second.dispose();
        other.build();
        expect(other.trees.placements).not.toEqual(first.trees.placements);
        expect(other.trees.placements.slice(0, FOREST_FEATURE_TREES.length))
            .toEqual(first.trees.placements.slice(0, FOREST_FEATURE_TREES.length));
    }, SLOW);

    it.each([
        ['landscape', LANDSCAPE], ['ultrawide', 21 / 9], ['square', 1], ['portrait', PORTRAIT], ['tall tablet', 3 / 4],
    ])('frames the camera and the stage for a %s screen', (_label, aspect) => {
        const { world, camera } = forest.Minimal;
        const restore = camera.aspect;
        try {
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            world.prepareCamera(aspect);
            const view = forestViewFor(aspect);
            expect(camera.fov).toBe(view.fov);
            expect(camera.near).toBeGreaterThan(0);
            expect(camera.near).toBeLessThan(1);
            expect(camera.far).toBeGreaterThan(3000);
            expect(camera.position.toArray()).toEqual(forestEye(view));
            const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
            expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-9);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
            expect(camera.projectionMatrixInverse.elements.every(Number.isFinite)).toBe(true);
            // The stage follows: the board centre projects back onto the middle of the default card.
            const { stage } = world;
            const centre = stage.centre().project(camera);
            expect(centre.x).toBeCloseTo((FOREST_DEFAULT_BOARD.x0 + FOREST_DEFAULT_BOARD.x1) - 1, 9);
            expect(centre.y).toBeCloseTo(1 - (FOREST_DEFAULT_BOARD.y0 + FOREST_DEFAULT_BOARD.y1), 9);
            // Re-framing is repeatable and never moves the camera twice.
            const pose = camera.matrixWorld.clone();
            const stageBefore = world.stage;
            world.prepareCamera(aspect);
            expect(camera.matrixWorld.equals(pose)).toBe(true);
            expect(world.stage).toBe(stageBefore);
            expect(world.director.stage).toBe(stageBefore);
        } finally {
            camera.aspect = restore;
            camera.updateProjectionMatrix();
            world.prepareCamera(restore);
        }
    });

    it('falls back to the landscape view for an unusable aspect ratio', () => {
        const { world, camera } = forest.Minimal;
        const stageBefore = world.stage;
        for (const aspect of [NaN, 0, -1, Infinity, undefined, null, 'wide']) {
            world.prepareCamera(PORTRAIT);
            expect(camera.fov).toBe(FOREST_VIEWS.portrait.fov);
            world.prepareCamera(aspect);
            expect(camera.fov).toBe(FOREST_VIEWS.landscape.fov);
            expect(camera.position.toArray()).toEqual(forestEye(FOREST_VIEWS.landscape));
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        }
        expect(world.stage).toBe(stageBefore);
        world.prepareCamera(camera.aspect);
    });
});

describe('Forest world in play', () => {
    it.each(['High', 'Low'])('answers a %s frame with every cue in it, and plays a session through', async (
        quality,
    ) => {
        const { world, scene, tier } = await buildWorld(quality);
        const reactions = eventfulReactions(quality);
        const frame = reactions.update(STEP);
        // The frame really does carry everything the world can be asked for.
        expect(frame.emitters.length).toBeGreaterThan(3);
        expect(frame.waves.filter((wave) => wave.serial >= 0).length).toBeGreaterThan(3);
        expect(frame.front).not.toBeNull();
        expect(frame.figure).toMatchObject({ held: true });
        expect(frame.stars).toBeGreaterThan(0);
        for (const key of ['gust', 'moon', 'shafts', 'glow']) expect(frame[key], key).toBeGreaterThan(0);

        const meshes = drawables(world.group);
        const before = resources(world.group);
        const counts = meshes.map((mesh) => mesh.count);
        const { sim } = world.fireflies;
        const { pulses } = world.light;
        const uploads = () => [world.fireflies.places.version, world.fireflies.glows.version,
            world.fireflies.velocities.version];
        const versions = uploads();
        expect(() => world.update(reactions.time, STEP, frame)).not.toThrow();
        expect(world.light.uTime.value).toBeCloseTo(STEP, 12);
        expect(sim.time).toBeCloseTo(STEP, 9);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(sim.counts().bound).toBeGreaterThan(0);
        expect(pulses.active()).toBeGreaterThan(0);
        expect(pulses.active()).toBeLessThanOrEqual(tier.pulses);
        expect(world.light.uGust.value).toBeGreaterThan(0);
        expect(world.light.uGlow.value).toBeCloseTo(frame.glow, 12);
        expect(world.light.uMoonGain.value).toBeGreaterThan(1);
        expect(world.director.epoch).toBe(frame.epoch);

        const seen = {
            kinds: new Set(),
            fields: new Set(),
            maxLive: 0,
            maxBound: 0,
            maxPulses: 0,
            wake: 0,
            threads: 0,
            front: false,
            meteor: false,
        };
        const frames = 420;
        for (let step = 1; step < frames; step++) {
            if (step === 120) {
                reactions.onPieceLock({ piece: { x: 3, y: 21, shape: [[1]] } });
                reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
                reactions.onCombo(12);
            }
            if (step === 330) reactions.onGameOver();
            const state = reactions.update(STEP);
            world.update(reactions.time, STEP, state);
            state.emitters.forEach((emitter) => seen.kinds.add(emitter.kind));
            world.director.fields.forEach((field) => seen.fields.add(field.kind));
            const live = sim.counts();
            seen.maxLive = Math.max(seen.maxLive, live.live);
            seen.maxBound = Math.max(seen.maxBound, live.bound);
            seen.maxPulses = Math.max(seen.maxPulses, pulses.active());
            seen.wake = Math.max(seen.wake, world.light.uWake.value);
            seen.threads = Math.max(seen.threads, world.terrain.uThreads.value);
            seen.front = seen.front || world.light.uFront.value.y > 0;
            seen.meteor = seen.meteor || world.sky.meteor.active;
            if (!(allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity))) {
                throw new Error(`a firefly buffer went non-finite at frame ${step}`);
            }
        }
        // Nothing was created to play it: same meshes, same instance counts, same resources.
        const after = drawables(world.group);
        expect(after).toHaveLength(meshes.length);
        after.forEach((mesh, index) => {
            expect(mesh).toBe(meshes[index]);
            expect(mesh.count).toBe(counts[index]);
        });
        expect(scene.children).toEqual([world.group]);
        const now = resources(world.group);
        for (const kind of ['geometries', 'materials', 'instanced']) {
            expect(now[kind].size).toBe(before[kind].size);
            expect([...now[kind]].every((resource) => before[kind].has(resource))).toBe(true);
        }
        // The session really happened.
        expect([...seen.kinds]).toEqual(expect.arrayContaining(['lock', 'clear', 'rise', 'combo', 'spin']));
        expect([...seen.fields]).toEqual(expect.arrayContaining(['burst', 'jet', 'vortex']));
        expect(seen.maxLive).toBeGreaterThan(sim.reserve * 0.3);
        expect(seen.maxLive).toBeLessThanOrEqual(sim.reserve);
        expect(seen.maxBound).toBeGreaterThan(0);
        expect(seen.maxPulses).toBe(tier.pulses);
        expect(seen.wake).toBeGreaterThan(0.3);
        expect(seen.threads).toBeGreaterThan(0);
        expect(seen.front).toBe(true);
        expect(seen.meteor).toBe(true);
        // Every frame re-uploads the three firefly buffers, and the clocks agree.
        expect(uploads()).toEqual(versions.map((version) => version + frames));
        expect(world.light.uTime.value).toBeCloseTo(reactions.time, 9);
        expect(sim.time).toBeCloseTo(frames * STEP, 6);
        // Game over settled it: nobody is bound, the director knows, and the figure has gone.
        expect(world.director.env.settled).toBe(true);
        expect(sim.counts().bound).toBe(0);
        expect(world.getDiagnostics()).toMatchObject({ fireflies: sim.counts(), pulses: pulses.active() });
        // The fireflies' light is gathered for the floor where the tier has a map for it.
        if (tier.lightMap > 0) {
            expect(world.light.field.dirty).toBe(false);
            expect(world.light.fieldTexture.version).toBeGreaterThan(0);
        }
    }, SLOW);

    it('welcomes a frame with nothing in it, or no frame at all', async () => {
        const { world } = await buildWorld('Minimal');
        expect(() => {
            world.update(0, STEP);
            world.update(STEP, STEP, {});
            world.update(2 * STEP, STEP, {
                emitters: null, waves: null, front: null, figure: null,
            });
            world.update(3 * STEP, 0, { emitters: [], waves: [] });
        }).not.toThrow();
        expect(world.light.uTime.value).toBeCloseTo(3 * STEP, 12);
        expect(world.fireflies.sim.counts()).toMatchObject({ live: 0, bound: 0 });
        expect(world.light.pulses.active()).toBe(0);
        expect(world.light.uGust.value).toBe(0);
        expect(world.light.uWake.value).toBe(0);
        expect(world.light.uMoonGain.value).toBe(1);
        expect(world.terrain.uThreads.value).toBe(0);
        expect(world.light.uFront.value.y).toBe(0);
    }, SLOW);

    it('keeps a time or a step that is not a number out of every clock and uniform', async () => {
        const { world } = await buildWorld('Medium');
        const reactions = eventfulReactions('Medium');
        const frame = reactions.update(STEP);
        world.update(4, STEP, frame);
        const {
            light, fireflies, sky, terrain,
        } = world;
        const { sim } = fireflies;
        const simTime = sim.time;
        const radii = light.pulses.place.map((place) => place.w);
        for (const [time, step] of [[NaN, NaN], [Infinity, Infinity], [-Infinity, -1], [undefined, undefined],
            [null, null], ['5', '0.016'], [NaN, STEP], [6, NaN]]) {
            expect(() => world.update(time, step, frame)).not.toThrow();
            expect(Number.isFinite(light.uTime.value)).toBe(true);
            expect(light.uTime.value).toBeGreaterThanOrEqual(4);
            expect(Number.isFinite(sim.time)).toBe(true);
            expect(Number.isFinite(fireflies.uSimTime.value)).toBe(true);
            expect(Number.isFinite(fireflies.uBeat.value)).toBe(true);
            expect(sky.uMeteor.value.toArray().every(Number.isFinite)).toBe(true);
            for (const vector of [...light.pulses.place, ...light.pulses.shape, light.uFront.value]) {
                expect(vector.toArray().every(Number.isFinite)).toBe(true);
            }
            expect(allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity)).toBe(true);
        }
        // Only the two calls with a usable step moved the simulation, by that step.
        expect(sim.time).toBeCloseTo(simTime + STEP, 9);
        // A bad time holds the clock where it was; a good one moves it, never backwards past zero.
        expect(light.uTime.value).toBe(6);
        world.update(-3, STEP, frame);
        expect(light.uTime.value).toBe(0);
        // The waves went on only as far as real steps carried them.
        light.pulses.place.forEach((place, index) => {
            if (radii[index] > 0) expect(place.w).toBeGreaterThanOrEqual(radii[index]);
        });

        // Envelopes that are not numbers, or out of range, are bounded the same way.
        world.update(7, STEP, {
            gust: Infinity,
            glow: NaN,
            wake: 40,
            moon: -5,
            shafts: 'x',
            heat: NaN,
            sync: Infinity,
            beatRate: NaN,
            stars: NaN,
            front: { x: NaN, strength: 9 },
            epoch: frame.epoch,
        });
        expect(light.uGust.value).toBe(0);
        expect(light.uGlow.value).toBe(0);
        expect(light.uWake.value).toBe(1);
        expect(light.uMoonGain.value).toBe(1);
        expect(light.uFront.value.y).toBe(0);
        expect(Number.isFinite(terrain.uThreads.value) && terrain.uThreads.value > 0).toBe(true);
        expect(Number.isFinite(fireflies.uSync.value)).toBe(true);
        expect(Number.isFinite(fireflies.uBeatRate.value)).toBe(true);
        expect(Number.isFinite(fireflies.uTrail.value) && fireflies.uTrail.value > 0).toBe(true);
        world.update(8, STEP, { gust: 1, moon: 1, wake: 1 });
        const fullGust = light.uGust.value;
        const fullMoon = light.uMoonGain.value;
        world.update(8, STEP, { gust: 7, moon: 7, wake: 7 });
        expect(light.uGust.value).toBe(fullGust);
        expect(light.uMoonGain.value).toBe(fullMoon);
        expect(fullMoon).toBeGreaterThan(1);
        expect(fullMoon).toBeLessThan(3);
    }, SLOW);

    it('forgets every effect in flight on resetEffects, without replaying what the reactions hold', async () => {
        const { world } = await buildWorld('Medium');
        const reactions = eventfulReactions('Medium');
        for (let step = 0; step < 40; step++) world.update(reactions.time, STEP, reactions.update(STEP));
        const { sim } = world.fireflies;
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(sim.counts().bound).toBeGreaterThan(0);
        expect(world.light.pulses.active()).toBeGreaterThan(0);
        world.resetEffects();
        expect(sim.counts()).toMatchObject({ live: 0, bound: 0 });
        expect(sim.time).toBe(0);
        expect(world.light.pulses.active()).toBe(0);
        expect(world.director.fields).toEqual([]);
        expect(world.director.figureHeld).toBe(false);
        expect(world.sky.meteor.active).toBe(false);
        expect(world.sky.uMeteor.value.toArray()).toEqual([0, 0]);
        if (world.light.field) expect(world.light.field.data.every((value) => value === 0)).toBe(true);
        // The trees, the floor and the sky are not effects.
        expect(world.built).toBe(true);
        expect(drawables(world.group).length).toBeGreaterThan(10);
        // The reactions were not reset: the same waves are still queued and the figure is still called.
        const frame = reactions.update(STEP);
        expect(frame.figure).toMatchObject({ held: true });
        world.update(reactions.time, STEP, frame);
        expect(world.light.pulses.active()).toBe(0);
        expect(sim.counts().bound).toBe(0);
        // And a falling star that was already counted does not fall again.
        expect(world.sky.meteor.active).toBe(false);
        // New events after the reset are answered as usual.
        reactions.onPieceLock({ piece: { x: 2, y: 22, shape: [[1]] } });
        world.update(reactions.time, STEP, reactions.update(STEP));
        expect(world.light.pulses.active()).toBe(1);
        expect(sim.counts().live).toBeGreaterThan(0);
    }, SLOW);

    it('throws its fireflies from wherever the board is measured to be, and ignores junk', async () => {
        const { world } = await buildWorld('Minimal');
        const reactions = new ForestReactions({ quality: 'Minimal', rng: seededRandom(5) });
        const lockAt = (board) => {
            // A new epoch each time, as when the theme forgets every effect: the lock is a new event.
            reactions.reset();
            world.resetEffects();
            world.setBoard(board);
            reactions.onPieceLock({ piece: { x: 0, y: 14, shape: [[1]] } });
            world.update(0, STEP, reactions.update(STEP));
            const { sim } = world.fireflies;
            let total = 0;
            let count = 0;
            for (let index = sim.ambient; index < sim.count; index++) {
                if (sim.life[index] > 0) {
                    total += sim.x[index];
                    count += 1;
                }
            }
            expect(count).toBeGreaterThan(0);
            return total / count;
        };
        const centred = lockAt(null);
        expect(world.stage.board).toEqual(FOREST_DEFAULT_BOARD);
        const left = lockAt({
            x0: 0.05, x1: 0.3, y0: 0.1, y1: 0.9,
        });
        const right = lockAt({
            x0: 0.7, x1: 0.95, y0: 0.1, y1: 0.9,
        });
        expect(left).toBeLessThan(centred - 1);
        expect(right).toBeGreaterThan(centred + 1);
        for (const junk of [undefined, {}, 'board', {
            x0: NaN, x1: 1, y0: 0, y1: 1,
        }, {
            x0: 0.5, x1: 0.5, y0: 0.2, y1: 0.8,
        }]) {
            // The same edge of the default card, give or take the scatter of the puff itself.
            expect(Math.abs(lockAt(junk) - centred)).toBeLessThan(0.4);
            expect(world.stage.board).toEqual(FOREST_DEFAULT_BOARD);
        }
    }, SLOW);
});

describe('Forest world ownership', () => {
    it('builds only once', async () => {
        const { world, scene } = await buildWorld('Minimal');
        const meshes = drawables(world.group);
        const {
            trees, fireflies, light, stage, director, terrain,
        } = world;
        expect(world.built).toBe(true);
        expect(world.build()).toBe(world);
        expect(world.trees).toBe(trees);
        expect(world.fireflies).toBe(fireflies);
        expect(world.light).toBe(light);
        expect(world.stage).toBe(stage);
        expect(world.director).toBe(director);
        expect(world.terrain).toBe(terrain);
        expect(drawables(world.group)).toEqual(meshes);
        expect(scene.children).toEqual([world.group]);
    }, SLOW);

    it('disposes every owned resource once, leaves the scene empty and the shared assets to their owner', async () => {
        const {
            world, scene, assets,
        } = await buildWorld('Medium');
        const shared = assetGeometries(assets);
        const { geometries, materials, instanced } = resources(world.group);
        const ownGeometries = [...geometries].filter((geometry) => !shared.has(geometry));
        expect(ownGeometries.length).toBeGreaterThan(5);
        expect(geometries.size - ownGeometries.length).toBeGreaterThan(10);
        expect(materials.size).toBeGreaterThan(15);
        const spy = (resource) => vi.spyOn(resource, 'dispose');
        const textures = [world.light.noiseTexture, world.light.heightTexture, world.light.fieldTexture]
            .filter(Boolean);
        const once = [...ownGeometries, ...materials, ...instanced, ...textures].map(spy);
        const borrowed = [...shared, assets.impostors.texture, assets.moon].map(spy);
        const moon = spy(world.light.moon);

        world.dispose();
        expect(world.disposed).toBe(true);
        expect(() => world.dispose()).not.toThrow();
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(moon).toHaveBeenCalledOnce();
        borrowed.forEach((disposal) => expect(disposal).not.toHaveBeenCalled());
        // Nothing of the forest is left in the scene, at any depth.
        expect(scene.children).toHaveLength(0);
        expect(drawables(scene)).toEqual([]);
        expect(world.group.parent).toBeNull();
        expect(world.group.children).toHaveLength(0);
        for (const key of ['light', 'terrain', 'trees', 'understory', 'backdrop', 'sky', 'fireflies', 'director',
            'stage']) {
            expect(world[key], key).toBeNull();
        }
        expect(() => world.build()).toThrow('Cannot rebuild a disposed ForestWorld.');
        expect(scene.children).toHaveLength(0);
        // The borrowed bark is handed back whole, whatever the tier drew of it.
        for (const tree of Object.values(assets.trees)) expect(tree.bark.drawRange.count).toBe(Infinity);

        // A disposed world is inert rather than explosive.
        expect(() => {
            world.update(1, STEP, { emitters: [] });
            world.setBoard(FOREST_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        expect(world.getDiagnostics()).toEqual({
            quality: 'Medium', farTrees: 0, fireflies: null, pulses: 0,
        });

        // The bundle is released by whoever loaded it, once.
        disposeForestAssets(assets);
        borrowed.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    }, SLOW);

    it('leaves a scene it shares with others exactly as it found it', async () => {
        const assets = await loadBundle();
        const { world, scene } = createWorld('Minimal', assets);
        const bystander = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial());
        bystander.name = 'bystander';
        scene.add(bystander);
        world.build();
        expect(scene.children).toEqual([bystander, world.group]);
        world.dispose();
        expect(scene.children).toEqual([bystander]);
        bystander.geometry.dispose();
        bystander.material.dispose();
    }, SLOW);

    it('needs its assets and says so before touching the scene', async () => {
        const scene = new THREE.Scene();
        // Asked for nothing in particular, a world is a High one.
        const unspecified = new ForestWorld({ scene, camera: new THREE.PerspectiveCamera() });
        expect(unspecified.quality).toBe('High');
        expect(unspecified.tier).toBe(FOREST_TIERS.High);
        expect(unspecified.getDiagnostics()).toEqual({
            quality: 'High', farTrees: 0, fireflies: null, pulses: 0,
        });
        const world = new ForestWorld({ scene, camera: new THREE.PerspectiveCamera(), quality: 'Minimal' });
        owned.push(world);
        expect(world.tier).toBe(FOREST_TIERS.Minimal);
        expect(() => world.build()).toThrow('[Forest] The world needs its loaded assets before it can build.');
        expect(scene.children).toHaveLength(0);
        expect(world.built).toBe(false);
        // Nothing was half-made: update, the board and diagnostics are still safe.
        expect(() => {
            world.update(0, STEP, { emitters: [] });
            world.setBoard(FOREST_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        // Once the assets are there the same world builds.
        world.assets = await loadBundle();
        expect(world.build()).toBe(world);
        expect(scene.children).toEqual([world.group]);
        expect(world.getDiagnostics().trees).toBeGreaterThan(FOREST_FEATURE_TREES.length);
    }, SLOW);

    it('names the missing spray when the foliage pack lacks one, and still cleans up', async () => {
        const assets = await loadBundle();
        const [missing] = Object.keys(assets.foliage.meshes).filter((name) => /^spruce_bough/.test(name));
        const removed = assets.foliage.meshes[missing];
        delete assets.foliage.meshes[missing];
        const { world, scene } = createWorld('Minimal', assets);
        expect(() => world.build()).toThrow(`[Forest] Foliage mesh "${missing}" is missing from the asset pack.`);
        const terrain = vi.spyOn(world.terrain.mesh.geometry, 'dispose');
        world.dispose();
        expect(terrain).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(world.group.children).toHaveLength(0);
        for (const tree of Object.values(assets.trees)) expect(tree.bark.drawRange.count).toBe(Infinity);
        removed.dispose();
    }, SLOW);

    // Every part is assigned to the world before it builds, so when a build throws halfway
    // world.dispose() still reaches what that part had already made.
    it('retains ownership of a partially built forest so a failure can be cleaned up', async () => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial();
        const geometryDisposal = vi.spyOn(geometry, 'dispose');
        const materialDisposal = vi.spyOn(material, 'dispose');
        vi.spyOn(ForestTrees.prototype, 'build').mockImplementation(function failedBuild() {
            this.own(geometry);
            this.own(material);
            this.group.add(new THREE.Mesh(geometry, material));
            throw new Error('partial forest failure');
        });
        const { world, scene } = createWorld('Minimal', await loadBundle());
        expect(() => world.build()).toThrow('partial forest failure');
        expect(world.trees).toBeInstanceOf(ForestTrees);
        // What was finished before the failure is still owned and released.
        const finished = [world.terrain.mesh.geometry, world.terrain.mesh.material, world.light.noiseTexture,
            world.light.heightTexture].map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        world.dispose();
        expect(geometryDisposal).toHaveBeenCalledOnce();
        expect(materialDisposal).toHaveBeenCalledOnce();
        finished.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        expect(() => world.build()).toThrow('Cannot rebuild a disposed ForestWorld.');
    }, SLOW);

    // The bark geometry is borrowed from the asset bundle. A tier without limbs narrows its draw
    // range only while that forest exists; dispose() and any later build restore the range the
    // tier wants, so a bundle can be reused across tiers.
    it('hands a borrowed asset bundle back as it found it, whatever the tier', async () => {
        const assets = await loadBundle();
        const ranges = () => Object.values(assets.trees).map((tree) => ({ ...tree.bark.drawRange }));
        const pristine = ranges();
        const low = createWorld('Minimal', assets);
        low.world.build();
        expect(FOREST_TIERS.Minimal.limbs).toBe(false);
        expect(ranges()).not.toEqual(pristine);
        low.world.dispose();
        expect(ranges()).toEqual(pristine);
        const high = createWorld('Medium', assets);
        high.world.build();
        for (const mesh of named(high.world.group, /^ForestBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeGreaterThanOrEqual(mesh.geometry.index.count);
        }
    }, SLOW);

    // What the theme falls back to when the pack cannot be loaded (see ForestTheme.createScene).
    it.each(['High', 'Minimal'])('grows a %s forest without trees from an empty bundle', (quality) => {
        const assets = createEmptyForestAssets();
        const { world, scene, tier } = createWorld(quality, assets);
        expect(world.build()).toBe(world);
        expect(scene.children).toEqual([world.group]);
        const diagnostics = world.getDiagnostics();
        expect(diagnostics).toMatchObject({
            quality,
            trees: 0,
            sprays: 0,
            foliageTriangles: 0,
            barkTriangles: 0,
            farTrees: 0,
            ferns: 0,
            fronds: 0,
            stones: 0,
        });
        // The night itself needs no pack: floor, sky, mist, ridges, grass, foxfire, fireflies.
        expect(named(world.group, 'ForestGround')).toHaveLength(1);
        expect(named(world.group, 'ForestSky')).toHaveLength(1);
        expect(named(world.group, 'ForestRidges')).toHaveLength(1);
        expect(named(world.group, /^ForestMistBank /)).toHaveLength(tier.mist);
        expect(named(world.group, 'ForestGrass')[0].count).toBeGreaterThan(0);
        expect(diagnostics.fungi).toBeGreaterThan(0);
        expect(diagnostics.flowers).toBe(tier.flowers);
        const fromThePack = /^Forest(Bark|Foliage|Ferns|Boulders) |^Forest (log|stump|snag)$|^ForestFarStand$/;
        expect(named(world.group, fromThePack)).toEqual([]);
        const { sim } = world.fireflies;
        expect(sim.count).toBe(tier.fireflies);
        for (let index = 0; index < sim.ambient; index++) {
            const floor = forestGroundHeight(sim.home[index * 3], sim.home[index * 3 + 2]);
            expect(sim.home[index * 3 + 1] - floor).toBeGreaterThan(0.8);
        }
        expect(world.director.posts).toEqual([]);
        expect(world.director.figureAnchor.y).toBe(forestGroundHeight(FOREST_FIGURE_STAND.x, FOREST_FIGURE_STAND.z));
        // Every reaction still plays, the figure included.
        const reactions = eventfulReactions(quality);
        expect(() => {
            for (let step = 0; step < 90; step++) world.update(reactions.time, STEP, reactions.update(STEP));
        }).not.toThrow();
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(sim.counts().bound).toBeGreaterThan(0);
        expect(world.light.pulses.active()).toBeGreaterThan(0);
        expect(allFinite(sim.outPlace) && allFinite(sim.outGlow)).toBe(true);
        // The lens is built over it like over any other forest.
        const { post, renderer } = createPost(quality, { light: world.light, scene, camera: world.camera });
        expect(post.getDiagnostics()).toEqual({
            quality, disabled: !tier.post, useMRT: false, godrays: tier.post && tier.godrays > 0,
        });
        post.update(reactions.getFrame());
        if (post.pipeline) vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        expect(() => post.render()).not.toThrow();
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        world.dispose();
        expect(scene.children).toHaveLength(0);
        // Releasing the empty bundle is as safe as releasing a full one.
        expect(() => disposeForestAssets(assets)).not.toThrow();
    }, SLOW);

    it('builds without the far-stand sprite sheet, the props or the moon’s map', async () => {
        const assets = await loadBundle({ impostors: false, props: false, moon: false });
        const { world, scene } = createWorld('Minimal', assets);
        world.build();
        expect(world.backdrop.count).toBe(0);
        expect(named(world.group, 'ForestFarStand')).toEqual([]);
        expect(named(world.group, 'ForestRidges')).toHaveLength(1);
        expect(named(world.group, /^Forest (log|stump|snag)$/)).toEqual([]);
        expect(named(world.group, /^ForestBoulders /)).toEqual([]);
        expect(world.understory.log ?? null).toBeNull();
        // A plain disc stands in for the mapped moon; the sky is drawn all the same.
        expect(named(world.group, 'ForestSky')).toHaveLength(1);
        expect(world.getDiagnostics()).toMatchObject({ farTrees: 0, stones: 0 });
        expect(world.getDiagnostics().trees).toBeGreaterThan(FOREST_FEATURE_TREES.length);
        expect(() => world.update(0, STEP, eventfulReactions('Minimal').update(STEP))).not.toThrow();
        world.dispose();
        expect(scene.children).toHaveLength(0);
    }, SLOW);

    it('builds a wood from whichever trees were loaded', async () => {
        const some = ['spruce-elder', 'spruce-old-a', 'birch-a'];
        const assets = await loadBundle({ trees: some });
        const { world } = createWorld('Minimal', assets);
        world.build();
        const used = new Set(world.trees.placements.map((tree) => tree.asset));
        expect([...used].every((name) => some.includes(name))).toBe(true);
        expect(used.has('spruce-elder')).toBe(true);
        expect(world.getDiagnostics().trees).toBe(world.trees.placements.length);
        expect(world.getDiagnostics().trees).toBeGreaterThan(0);
        expect(named(world.group, /^ForestBark /).map((mesh) => mesh.name.replace('ForestBark ', '')).sort())
            .toEqual([...used].sort());
        expect(() => world.update(0, STEP, eventfulReactions('Minimal').update(STEP))).not.toThrow();
    }, SLOW);
});

describe('Forest post tier ownership', () => {
    function fakeLight() {
        const moon = new THREE.DirectionalLight(0xffffff, 1);
        moon.castShadow = true;
        return { moon, uMoonDir: { value: FOREST_MOON_DIRECTION.clone() } };
    }

    it.each(['Minimal', 'Low'])('avoids post targets at %s and restores direct renderer settings', (quality) => {
        expect(FOREST_TIERS[quality].post).toBe(false);
        const {
            post, renderer, scene, camera,
        } = createPost(quality);
        expect(post.disabled).toBe(true);
        expect(post.pipeline ?? null).toBeNull();
        expect(post.getDiagnostics()).toEqual({
            quality, disabled: true, useMRT: false, godrays: false,
        });
        // Building it rendered nothing.
        expect(renderer.render).not.toHaveBeenCalled();
        let during = null;
        renderer.render.mockImplementation(() => {
            during = { tone: renderer.toneMapping, exposure: renderer.toneMappingExposure };
        });
        post.update({ moon: 1, shafts: 1 });
        post.render();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        // Drawn with the filmic curve at the exposure the frame asked for ...
        expect(during.tone).toBe(THREE.ACESFilmicToneMapping);
        expect(during.exposure).toBe(post.uExposure.value);
        expect(during.exposure).toBeGreaterThan(1);
        // ... and the renderer is handed back as it was.
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
        expect(() => post.setSize(1280, 720)).not.toThrow();
        expect(post.uAspect.value).toBeCloseTo(1280 / 720, 12);
    });

    it.each(['Minimal', 'Low'])('restores the %s renderer state when a direct render throws', (quality) => {
        const { post, renderer } = createPost(quality, { render: vi.fn(() => { throw new Error('device lost'); }) });
        expect(() => post.render()).toThrow('device lost');
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });

    it('constructs a node-only post graph with moonbeams for High and disposes it exactly once', () => {
        const light = fakeLight();
        const {
            post, renderer, scene, camera,
        } = createPost('High', { light });
        expect(post.disabled).toBe(false);
        expect(post.pipeline?.isRenderPipeline).toBe(true);
        expect(post.pipeline.outputNode?.isNode).toBe(true);
        // The grade applies its own output transform.
        expect(post.pipeline.outputColorTransform).toBe(false);
        expect(post.scenePass?.isNode).toBe(true);
        expect(post.godraysNode?.isNode).toBe(true);
        expect(post.bloomNode?.isNode).toBe(true);
        expect(post.godraysNode.raymarchSteps.value).toBe(FOREST_TIERS.High.godrays);
        expect(post.godraysNode.resolutionScale).toBe(FOREST_TIERS.High.godraysScale);
        expect(post.getDiagnostics()).toEqual({
            quality: 'High', disabled: false, useMRT: false, godrays: true,
        });
        // The beams read the moon's shadow map: one priming render of the scene builds it.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        const disposals = [post.pipeline, post.scenePass, post.godraysNode]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        post.dispose();
        post.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(post.disposed).toBe(true);
        for (const key of ['pipeline', 'scenePass', 'godraysNode', 'bloomNode', 'shaftsBlur', 'renderer', 'scene',
            'camera', 'light']) {
            expect(post[key], key).toBeNull();
        }
        // Disposed, it draws nothing and minds nothing.
        expect(() => {
            post.render();
            post.update({ moon: 1 });
            post.setSize(800, 600);
        }).not.toThrow();
        expect(renderer.render).toHaveBeenCalledOnce();
    });

    const POST_TIERS = TIER_ORDER.filter((quality) => FOREST_TIERS[quality].post);
    it.each(POST_TIERS)('renders %s through its pipeline only', (quality) => {
        const light = fakeLight();
        const { post, renderer } = createPost(quality, { light });
        const primed = renderer.render.mock.calls.length;
        expect(primed).toBe(FOREST_TIERS[quality].godrays > 0 ? 1 : 0);
        expect(Boolean(post.godraysNode)).toBe(FOREST_TIERS[quality].godrays > 0);
        const draw = vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        post.render();
        post.render();
        expect(draw).toHaveBeenCalledTimes(2);
        expect(renderer.render).toHaveBeenCalledTimes(primed);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    });

    it('does not prime the shadow rig again once its map exists', () => {
        const light = fakeLight();
        light.moon.shadow.map = new THREE.RenderTarget(4, 4);
        const { renderer } = createPost('High', { light });
        expect(renderer.render).not.toHaveBeenCalled();
        light.moon.shadow.map.dispose();
        light.moon.shadow.map = null;
    });

    it('primes the shadow rig through a small offscreen target, then hands the renderer back as it was', () => {
        const before = new THREE.RenderTarget(8, 8);
        const { renderer, log, current } = targetRenderer(before);
        const light = fakeLight();
        const { scene, camera } = createPost('High', { light, renderer });
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        // Drawn into its own target, not the canvas and not whatever was bound.
        const [target] = log.drawnInto;
        expect(target).not.toBeNull();
        expect(target).not.toBe(before);
        expect(target.isRenderTarget).toBe(true);
        expect(target.width).toBeLessThanOrEqual(16);
        // Shaped like the scene pass's own target (HDR colour and a depth texture), so the pipelines
        // it compiles are the ones the pass will use.
        expect(target.texture.type).toBe(THREE.HalfFloatType);
        expect(target.depthTexture?.isDepthTexture).toBe(true);
        expect(log.bound).toEqual([target, before]);
        expect(current()).toBe(before);
        expect(log.disposed).toEqual([target]);
        before.dispose();
    });

    it('restores the renderer and releases the offscreen target when priming the shadow rig throws', () => {
        const { renderer, log, current } = targetRenderer(null);
        renderer.render.mockImplementation(() => { throw new Error('shader failed'); });
        expect(() => new ForestPost({
            renderer,
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            quality: 'High',
            light: fakeLight(),
        })).toThrow('shader failed');
        expect(current()).toBeNull();
        expect(log.bound).toHaveLength(2);
        expect(log.disposed).toEqual([log.bound[0]]);
    });

    it('grades without beams when it is given no light', () => {
        const { post, renderer } = createPost('High');
        expect(post.light).toBeNull();
        expect(post.godraysNode ?? null).toBeNull();
        expect(post.bloomNode?.isNode).toBe(true);
        expect(post.getDiagnostics()).toMatchObject({ disabled: false, godrays: false });
        expect(renderer.render).not.toHaveBeenCalled();
        const moonScreen = post.uMoonScreen.value.clone();
        expect(() => post.update({ moon: 0.5, shafts: 0.5 })).not.toThrow();
        expect(post.uMoonScreen.value.equals(moonScreen)).toBe(true);
    });

    it('falls back to the High lens for an unknown tier name', () => {
        const { post } = createPost('Potato');
        expect(post.tier).toBe(FOREST_TIERS.High);
        expect(post.disabled).toBe(false);
    });

    it('accepts finite resize dimensions and rejects invalid values before resizing targets', () => {
        const { post } = createPost('Medium');
        const resize = vi.spyOn(post.scenePass, 'setSize');
        post.setSize(1920, 1080);
        expect(post.uAspect.value).toBeCloseTo(16 / 9, 12);
        expect(resize).toHaveBeenCalledExactlyOnceWith(1920, 1080);
        for (const [width, height] of [[0, 100], [100, 0], [-5, 5], [NaN, 100], [100, Infinity], [undefined, undefined],
            ['800', 600]]) {
            post.setSize(width, height);
        }
        expect(resize).toHaveBeenCalledOnce();
        expect(post.uAspect.value).toBeCloseTo(16 / 9, 12);
    });

    it('answers the moon and the beams with a bounded lift of exposure, shafts and bloom', () => {
        const { post } = createPost('High', { light: fakeLight() });
        const read = (frame) => {
            post.update(frame);
            return { exposure: post.uExposure.value, shafts: post.uShafts.value, bloom: post.bloomNode.strength.value };
        };
        const rest = read({});
        expect(read(undefined)).toEqual(rest);
        expect(rest.exposure).toBeGreaterThan(0.5);
        expect(rest.exposure).toBeLessThan(2);
        expect(rest.shafts).toBeGreaterThan(0);
        expect(rest.bloom).toBeGreaterThan(0);
        const half = read({ moon: 0.5, shafts: 0.5 });
        const full = read({ moon: 1, shafts: 1 });
        for (const key of ['exposure', 'shafts', 'bloom']) {
            expect(half[key], key).toBeGreaterThan(rest[key]);
            expect(full[key], key).toBeGreaterThan(half[key]);
            // A lift, not a flash: under double.
            expect(full[key], key).toBeLessThan(rest[key] * 2);
        }
        // The moon lifts the exposure and the bloom, the shafts envelope the beams: separately.
        const moonOnly = read({ moon: 1 });
        expect(moonOnly.shafts).toBe(rest.shafts);
        expect(moonOnly.exposure).toBe(full.exposure);
        const shaftsOnly = read({ shafts: 1 });
        expect(shaftsOnly.exposure).toBe(rest.exposure);
        expect(shaftsOnly.shafts).toBe(full.shafts);
        // Out of range is the nearest end of the range; nonsense is rest.
        expect(read({ moon: 40, shafts: 40 })).toEqual(full);
        expect(read({ moon: -40, shafts: -40 })).toEqual(rest);
        expect(read({ moon: NaN, shafts: Infinity })).toEqual(rest);
        expect(read({ moon: '1', shafts: null })).toEqual(rest);
        // The gains scale the beams and the bloom (the playground's icon lens thins them); play leaves them at one.
        expect(post.shaftGain).toBe(1);
        expect(post.bloomGain).toBe(1);
        post.shaftGain = 0.5;
        post.bloomGain = 0.25;
        const thinned = read({ moon: 1, shafts: 1 });
        expect(thinned.shafts).toBeCloseTo(full.shafts * 0.5, 12);
        expect(thinned.bloom).toBeCloseTo(full.bloom * 0.25, 12);
        expect(thinned.exposure).toBe(full.exposure);
        post.shaftGain = 0;
        expect(read({ shafts: 1 }).shafts).toBe(0);
    });

    it('tints its beams from where the moon really stands on screen', () => {
        for (const aspect of [LANDSCAPE, PORTRAIT]) {
            const camera = framedCamera(aspect);
            const { post } = createPost('High', { light: fakeLight(), camera });
            post.update({});
            const expected = camera.position.clone().addScaledVector(FOREST_MOON_DIRECTION, 500).project(camera);
            expect(post.uMoonScreen.value.x).toBeCloseTo(expected.x * 0.5 + 0.5, 9);
            // Screen coordinates run down: the moon is in the upper half, left of the middle.
            expect(post.uMoonScreen.value.y).toBeCloseTo(0.5 - expected.y * 0.5, 9);
            expect(post.uMoonScreen.value.x).toBeGreaterThan(0);
            expect(post.uMoonScreen.value.x).toBeLessThan(0.5);
            expect(post.uMoonScreen.value.y).toBeGreaterThan(0);
            expect(post.uMoonScreen.value.y).toBeLessThan(0.5);
            // It follows the camera as the pointer leans it: turn the eye to the right and the moon slides left ...
            const before = post.uMoonScreen.value.clone();
            camera.rotateY(-0.1);
            camera.updateMatrixWorld(true);
            post.update({});
            expect(post.uMoonScreen.value.x).toBeLessThan(before.x);
            expect(post.uMoonScreen.value.y).toBeCloseTo(before.y, 1);
            // ... and keeps its last place rather than jumping when the moon is behind the camera.
            const last = post.uMoonScreen.value.clone();
            camera.rotateY(Math.PI);
            camera.updateMatrixWorld(true);
            post.update({});
            expect(post.uMoonScreen.value.equals(last)).toBe(true);
        }
    });

    it('builds its lens over the real forest, and the theme-facing diagnostics agree with the tier', async () => {
        const { world, scene, camera } = await buildWorld('Medium');
        const { post, renderer } = createPost('Medium', { light: world.light, scene, camera });
        expect(post.light).toBe(world.light);
        expect(post.getDiagnostics()).toEqual({
            quality: 'Medium', disabled: false, useMRT: false, godrays: FOREST_TIERS.Medium.godrays > 0,
        });
        expect(renderer.render.mock.calls.length).toBe(FOREST_TIERS.Medium.godrays > 0 ? 1 : 0);
        const reactions = eventfulReactions('Medium');
        const rest = { shafts: post.uShafts.value, exposure: post.uExposure.value };
        post.update({});
        Object.assign(rest, { shafts: post.uShafts.value, exposure: post.uExposure.value });
        world.update(reactions.time, STEP, reactions.update(STEP));
        post.update(reactions.getFrame());
        expect(post.uShafts.value).toBeGreaterThan(rest.shafts);
        expect(post.uExposure.value).toBeGreaterThan(rest.exposure);
        expect(post.uMoonScreen.value.toArray().every(Number.isFinite)).toBe(true);
        // The lens goes before the world it reads.
        post.dispose();
        expect(() => world.dispose()).not.toThrow();
    }, SLOW);
});
