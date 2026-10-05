import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    GOLDEN_FOREST_TREE_URLS, disposeGoldenForestAssets, goldenForestImpostorLayout, parseGoldenForestMeshes,
    parseGoldenForestTree,
} from '../../src/themes/golden-forest/golden-forest-assets.js';
import {
    GOLDEN_FOREST_FEATURE_TREES, GOLDEN_FOREST_GROVE_CEILING, GOLDEN_FOREST_SUN_AZIMUTH_DEGREES, GOLDEN_FOREST_VIEWS,
    createGoldenForestVisibilityTest, goldenForestEye, goldenForestViewFor, layoutGoldenForestGrove,
} from '../../src/themes/golden-forest/golden-forest-composition.js';
import { GoldenForestForest } from '../../src/themes/golden-forest/golden-forest-forest.js';
import { GOLDEN_FOREST_MIRROR_LAYER } from '../../src/themes/golden-forest/golden-forest-lake.js';
import { GOLDEN_FOREST_SUN_DIRECTION } from '../../src/themes/golden-forest/golden-forest-light.js';
import { GoldenForestPost } from '../../src/themes/golden-forest/golden-forest-post.js';
import { GOLDEN_FOREST_TIERS, goldenForestTier } from '../../src/themes/golden-forest/golden-forest-quality.js';
import {
    GOLDEN_FOREST_REACTION_LIMITS, GoldenForestReactions,
} from '../../src/themes/golden-forest/golden-forest-reactions.js';
import {
    GOLDEN_FOREST_DEFAULT_BOARD, GOLDEN_FOREST_STAGE_DEPTH,
} from '../../src/themes/golden-forest/golden-forest-stage.js';
import {
    GOLDEN_FOREST_BOUNDS, GOLDEN_FOREST_MAP_BIAS, GOLDEN_FOREST_MAP_RANGE, goldenForestGroundHeight,
    goldenForestShoreDistance, goldenForestShores,
} from '../../src/themes/golden-forest/golden-forest-terrain.js';
import { GoldenForestWorld } from '../../src/themes/golden-forest/golden-forest-world.js';

const assetDirectory = new URL('../../src/themes/golden-forest/assets/', import.meta.url);
const TREE_NAMES = Object.keys(GOLDEN_FOREST_TREE_URLS);
const TIER_NAMES = Object.keys(GOLDEN_FOREST_TIERS);
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
// The tiers built once and shared by the scene-contract tests, dearest first.
const BUILT = ['High', 'Low', 'Minimal'];
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
// Building a lake from the real asset pack takes seconds on a busy machine.
const SLOW = 120000;
const SHADOW_CASTERS = /^GoldenForest(Ground|Bark .+|Needles .+|FarShore|Boulders .+| jetty| snag| rowboat)$/;
// Meshes drawn straight from the geometry of the shared asset pack.
const FROM_THE_PACK = /^GoldenForest(Bark|Needles|Boulders) |^GoldenForest (jetty|snag|rowboat)$/;
// The parts of the world the lake mirrors, in the order the world builds them.
const SCENERY = ['terrain', 'forest', 'backdrop', 'atmosphere', 'shore', 'birds', 'ribbons', 'sparks'];
const owned = [];
const bundles = [];
const files = new Map();

function seededRandom(seed = 271) {
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

/** The real asset pack, parsed from disk; the sprite sheet is a stand-in data texture. */
async function loadBundle({
    trees = TREE_NAMES, impostors = true, props = true, track = true,
} = {}) {
    const [foliage, propsGltf, ...gltfs] = await Promise.all([parseGlb('golden-forest-foliage.glb'),
        parseGlb('golden-forest-props.glb'), ...trees.map((name) => parseGlb(`${name}.glb`))]);
    const assets = {
        foliage: parseGoldenForestMeshes(foliage, 'Foliage'),
        props: parseGoldenForestMeshes(propsGltf, 'Props'),
        trees: {},
        impostors: null,
    };
    trees.forEach((name, index) => { assets.trees[name] = parseGoldenForestTree(gltfs[index], name); });
    if (impostors) {
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
        assets.impostors = { ...goldenForestImpostorLayout(), texture };
    }
    if (!props) {
        Object.values(assets.props.meshes).forEach((geometry) => geometry.dispose());
        assets.props = null;
    }
    if (track) bundles.push(assets);
    return assets;
}

function createWorld(quality, assets, { seed = 271, aspect = LANDSCAPE, track = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 3400);
    const world = new GoldenForestWorld({
        scene, camera, quality, rng: seededRandom(seed), assets,
    });
    if (track) owned.push(world);
    return {
        scene, camera, world, assets, tier: GOLDEN_FOREST_TIERS[quality],
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
    return new Set([...Object.values(assets.foliage.meshes), ...Object.values(assets.props?.meshes ?? {}),
        ...Object.values(assets.trees).map((tree) => tree.bark)]);
}

function allFinite(array) {
    if (!(array instanceof Float32Array || array instanceof Float64Array)) return true;
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / values.length;

/** Position and uniform-ish scale of every instance of a set of instanced meshes. */
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

function sparksAlight(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index++) {
        if (sim.life[index] > 0) result.push({ x: sim.x[index], y: sim.y[index], z: sim.z[index] });
    }
    return result;
}

function cell(x, y) {
    return { x, y, shape: [[1]] };
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
    const post = new GoldenForestPost(options);
    owned.push(post);
    return { ...options, post };
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeGoldenForestAssets(assets));
    vi.restoreAllMocks();
});

describe('Golden Forest quality tiers', () => {
    it('describes the same six tiers as the reaction director, with one set of columns', () => {
        expect([...TIER_NAMES].sort()).toEqual(Object.keys(GOLDEN_FOREST_REACTION_LIMITS).sort());
        expect([...TIER_NAMES].sort()).toEqual([...TIER_ORDER].sort());
        expect(Object.isFrozen(GOLDEN_FOREST_TIERS)).toBe(true);
        const columns = Object.keys(GOLDEN_FOREST_TIERS.High).sort();
        for (const [name, tier] of Object.entries(GOLDEN_FOREST_TIERS)) {
            expect(Object.keys(tier).sort(), name).toEqual(columns);
            expect(Object.isFrozen(tier)).toBe(true);
            expect(goldenForestTier(name)).toBe(tier);
            expect(tier.shadowMap).toHaveLength(2);
            for (const size of tier.shadowMap) {
                expect(Number.isInteger(Math.log2(size)), `${name} shadow map ${size}`).toBe(true);
            }
            for (const key of ['groveTrees', 'farTrees', 'reeds', 'grass', 'rocks', 'sparks', 'motes', 'mist',
                'ripples', 'ribbons']) {
                expect(Number.isInteger(tier[key]) && tier[key] > 0, `${name}.${key}`).toBe(true);
            }
            expect(Number.isInteger(tier.birds) && tier.birds >= 0, `${name}.birds`).toBe(true);
            expect(tier.foliage).toBeGreaterThan(0);
            expect(tier.foliage).toBeLessThanOrEqual(1);
            expect(tier.reflection).toBeGreaterThan(0);
            expect(tier.reflection).toBeLessThanOrEqual(1);
            expect(typeof tier.limbs).toBe('boolean');
            expect(typeof tier.post).toBe('boolean');
            // The shafts and the bloom live in the RenderPipeline: no pipeline, no shafts.
            if (!tier.post) expect([tier.godrays, tier.godraysScale, tier.bloomScale]).toEqual([0, 0, 0]);
            if (tier.godrays > 0) expect(tier.godraysScale).toBeGreaterThan(0);
            if (tier.post) expect(tier.bloomScale).toBeGreaterThan(0);
            // What the scene can actually draw: four ribbon paths, six mist banks, the grove's ceiling,
            // eight hand-placed boulders, and a reaction ring queue of six.
            expect(tier.ribbons).toBeLessThanOrEqual(4);
            expect(tier.mist).toBeLessThanOrEqual(6);
            expect(tier.groveTrees).toBeLessThanOrEqual(GOLDEN_FOREST_GROVE_CEILING);
            expect(tier.rocks).toBeGreaterThanOrEqual(8);
        }
        for (const quality of ['low', 'Potato', '', undefined, null, 7]) {
            expect(goldenForestTier(quality)).toBe(GOLDEN_FOREST_TIERS.High);
        }
    });

    it('never asks a cheaper tier for more than a dearer one', () => {
        for (let index = 1; index < TIER_ORDER.length; index++) {
            const cheaper = GOLDEN_FOREST_TIERS[TIER_ORDER[index]];
            const dearer = GOLDEN_FOREST_TIERS[TIER_ORDER[index - 1]];
            for (const key of ['groveTrees', 'farTrees', 'foliage', 'reeds', 'grass', 'rocks', 'sparks', 'motes',
                'birds', 'mist', 'ripples', 'reflection', 'godrays', 'godraysScale', 'ribbons', 'bloomScale']) {
                expect(cheaper[key], `${TIER_ORDER[index]}.${key}`).toBeLessThanOrEqual(dearer[key]);
            }
            // The headline numbers really do step down at every tier.
            for (const key of ['groveTrees', 'farTrees', 'reeds', 'grass', 'sparks', 'motes']) {
                expect(cheaper[key], `${TIER_ORDER[index]}.${key}`).toBeLessThan(dearer[key]);
            }
            const texels = (tier) => tier.shadowMap[0] * tier.shadowMap[1];
            expect(texels(cheaper)).toBeLessThanOrEqual(texels(dearer));
            expect(Number(cheaper.post)).toBeLessThanOrEqual(Number(dearer.post));
            expect(Number(cheaper.limbs)).toBeLessThanOrEqual(Number(dearer.limbs));
        }
        expect(GOLDEN_FOREST_TIERS.Minimal.birds).toBe(0);
    });
});

describe('Golden Forest composition and shores', () => {
    it('frames wide screens in landscape and tall screens in portrait', () => {
        expect(goldenForestViewFor(LANDSCAPE)).toBe(GOLDEN_FOREST_VIEWS.landscape);
        expect(goldenForestViewFor(21 / 9)).toBe(GOLDEN_FOREST_VIEWS.landscape);
        expect(goldenForestViewFor(4 / 3)).toBe(GOLDEN_FOREST_VIEWS.landscape);
        expect(goldenForestViewFor(0.85)).toBe(GOLDEN_FOREST_VIEWS.landscape);
        expect(goldenForestViewFor(PORTRAIT)).toBe(GOLDEN_FOREST_VIEWS.portrait);
        expect(goldenForestViewFor(9 / 16)).toBe(GOLDEN_FOREST_VIEWS.portrait);
        expect(goldenForestViewFor(3 / 4)).toBe(GOLDEN_FOREST_VIEWS.portrait);
        for (const view of Object.values(GOLDEN_FOREST_VIEWS)) {
            expect(Object.isFrozen(view)).toBe(true);
            expect(view.fov).toBeGreaterThan(20);
            expect(view.fov).toBeLessThan(100);
            expect([...view.position, ...view.target].every(Number.isFinite)).toBe(true);
            // The camera stands on the near bank and looks down the lake, slightly upward.
            expect(view.target[2]).toBeLessThan(view.position[2] - 40);
            expect(view.target[1]).toBeGreaterThan(view.position[1]);
        }
        // A tall screen sees less to the sides, so it steps back, opens up and turns to the sun.
        expect(GOLDEN_FOREST_VIEWS.portrait.fov).toBeGreaterThan(GOLDEN_FOREST_VIEWS.landscape.fov);
        expect(GOLDEN_FOREST_VIEWS.portrait.position[2]).toBeGreaterThan(GOLDEN_FOREST_VIEWS.landscape.position[2]);
        expect(GOLDEN_FOREST_VIEWS.portrait.target[0]).toBeLessThan(0);
    });

    it.each(
        Object.entries(GOLDEN_FOREST_VIEWS),
    )('stands the %s camera on land, above the water it looks out over', (_name, view) => {
        const [x, eyeHeight, z] = view.position;
        const ground = goldenForestGroundHeight(x, z);
        // Dry land a few paces in from the waterline, not a rock in the shallows.
        expect(ground).toBeGreaterThan(0.5);
        expect(ground).toBeLessThan(4);
        expect(goldenForestShoreDistance(x, z)).toBeGreaterThan(3);
        expect(goldenForestShores(x, z).near).toBe(goldenForestShoreDistance(x, z));
        const eye = goldenForestEye(view);
        expect(eye).toEqual([x, ground + eyeHeight, z]);
        // A standing person's eye, well clear of the lake's surface at y = 0.
        expect(eyeHeight).toBeGreaterThan(1.5);
        expect(eyeHeight).toBeLessThan(4);
        expect(eye[1]).toBeGreaterThan(3);
        // Walking toward the target, the bank gives way to water within a dozen paces and
        // stays water for a long way.
        const heading = new THREE.Vector2(view.target[0] - x, view.target[2] - z).normalize();
        const along = (metres) => goldenForestGroundHeight(x + heading.x * metres, z + heading.y * metres);
        let waterline = 0;
        while (waterline < 30 && along(waterline) >= 0) waterline += 0.25;
        expect(waterline).toBeGreaterThan(2);
        expect(waterline).toBeLessThan(12);
        for (let metres = waterline; metres < waterline + 25; metres += 0.5) expect(along(metres)).toBeLessThan(0);
    });

    it('lays out the lake the header describes: bank, headland, promontory, spit, island, islet and far shore', () => {
        const land = (x, z) => {
            const shores = goldenForestShores(x, z);
            const [name] = Object.entries(shores).sort((a, b) => b[1] - a[1])[0];
            return shores[name] > 0 ? name : 'water';
        };
        expect(Object.keys(goldenForestShores(0, 0)).sort())
            .toEqual(['far', 'headland', 'island', 'islet', 'near', 'promontory', 'right', 'spit']);
        expect(land(0, 16)).toBe('near');
        // Across the water on the left, where the sun stands.
        expect(land(-100, -113)).toBe('headland');
        // The promontory reaches out past the long right shore it grows from.
        expect(land(22, -61)).toBe('promontory');
        expect(goldenForestShores(22, -61).right).toBeLessThan(-5);
        expect(goldenForestShores(60, -53).promontory).toBeGreaterThan(5);
        expect(land(90, -20)).toBe('right');
        // A low spit grows out of the right shore toward the board and ends in open water.
        expect(land(24, -8)).toBe('spit');
        expect(goldenForestShores(31, -4).spit).toBeGreaterThan(5);
        expect(goldenForestShores(31, -4).right).toBeGreaterThan(0);
        expect(goldenForestShores(24, -8).right).toBeLessThan(-3);
        expect(goldenForestShores(24, -8).near).toBeLessThan(-10);
        for (let step = 0; step <= 10; step++) {
            const x = 30 + (19.5 - 30) * (step / 10);
            const z = -4 + (-10.5 + 4) * (step / 10);
            expect(goldenForestShoreDistance(x, z), `spit at ${x}, ${z}`).toBeGreaterThanOrEqual(4.9);
            // Low ground: a couple of metres above the lake, not a hill.
            expect(goldenForestGroundHeight(x, z)).toBeGreaterThan(1);
            expect(goldenForestGroundHeight(x, z)).toBeLessThan(3);
        }
        expect(land(12, -13)).toBe('water');
        expect(land(53, -140)).toBe('island');
        expect(land(-17, -44.8)).toBe('islet');
        expect(land(0, -260)).toBe('far');
        expect(land(-200, -300)).toBe('far');
        // Open water in front of the board, and the sun's path to the headland.
        for (const [x, z] of [[0, 0], [0, -30], [0, -80], [-8, -20], [-20, -70], [30, -100], [0, -200]]) {
            expect(land(x, z), `${x},${z}`).toBe('water');
        }
        // The sun stands over the headland's side of the lake.
        expect(GOLDEN_FOREST_SUN_AZIMUTH_DEGREES).toBeLessThan(0);
        expect(GOLDEN_FOREST_SUN_DIRECTION.x).toBeLessThan(0);
        expect(GOLDEN_FOREST_SUN_DIRECTION.z).toBeLessThan(0);
        expect(Math.atan2(GOLDEN_FOREST_SUN_DIRECTION.x, -GOLDEN_FOREST_SUN_DIRECTION.z))
            .toBeCloseTo(THREE.MathUtils.degToRad(GOLDEN_FOREST_SUN_AZIMUTH_DEGREES), 9);
    });

    it('keeps one finite ground: lake bed below zero offshore, land above it, no cliff between', () => {
        const {
            minX, maxX, minZ, maxZ,
        } = GOLDEN_FOREST_BOUNDS;
        const random = seededRandom(17);
        let wet = 0;
        let dry = 0;
        let deepest = 0;
        let highest = 0;
        for (let sample = 0; sample < 6000; sample++) {
            const x = minX + (maxX - minX) * random();
            const z = minZ + (maxZ - minZ) * random();
            const height = goldenForestGroundHeight(x, z);
            const inland = goldenForestShoreDistance(x, z);
            const shores = goldenForestShores(x, z);
            if (!Number.isFinite(height) || !Number.isFinite(inland)) throw new Error(`not finite at ${x}, ${z}`);
            // The distance is to the nearest piece of land, whichever it is.
            if (inland !== Math.max(...Object.values(shores))) throw new Error(`shore distance at ${x}, ${z}`);
            // Height and shore distance agree about what is water.
            if ((inland < 0) !== (height < 0)) throw new Error(`sign mismatch at ${x}, ${z}: ${inland} vs ${height}`);
            if (inland < 0) wet += 1; else dry += 1;
            deepest = Math.min(deepest, height);
            highest = Math.max(highest, height);
            // No cliffs: a step away the ground is at nearly the same height.
            if (Math.abs(goldenForestGroundHeight(x + 0.25, z) - height) > 0.6
                || Math.abs(goldenForestGroundHeight(x, z - 0.25) - height) > 0.6) {
                throw new Error(`cliff at ${x}, ${z}`);
            }
        }
        // A lake with shores, not a puddle and not a sea.
        expect(wet).toBeGreaterThan(1000);
        expect(dry).toBeGreaterThan(1000);
        // The bed levels off at 3.6 m; the far hills climb tens of metres.
        expect(deepest).toBeGreaterThan(-3.6);
        expect(deepest).toBeLessThan(-3.4);
        expect(highest).toBeGreaterThan(25);
        expect(highest).toBeLessThan(80);
        // The waterline is where the two meet: walking out from the camera's bank the ground
        // passes through zero without a step, and the bed deepens steadily away from the bank.
        let previous = goldenForestGroundHeight(0, 14);
        for (let z = 14; z > -25; z -= 0.05) {
            const height = goldenForestGroundHeight(0, z);
            expect(Math.abs(height - previous)).toBeLessThan(0.05);
            if (previous < 0 && z > -5) expect(height).toBeLessThan(previous);
            previous = height;
        }
        expect(previous).toBeLessThan(-3);
        // Outside the map the functions still answer.
        for (const [x, z] of [[1e4, 0], [0, 1e4], [0, -1e4], [-1e4, -1e4]]) {
            expect(Number.isFinite(goldenForestGroundHeight(x, z))).toBe(true);
            expect(Number.isFinite(goldenForestShoreDistance(x, z))).toBe(true);
        }
    });

    it('stands every hand-placed tree on dry land', () => {
        expect(GOLDEN_FOREST_FEATURE_TREES).toHaveLength(7);
        for (const tree of GOLDEN_FOREST_FEATURE_TREES) {
            const where = `${tree.asset} at ${tree.x}, ${tree.z}`;
            // Rooted in ground that is clearly above the lake, not on the bed and not awash.
            expect(goldenForestGroundHeight(tree.x, tree.z), where).toBeGreaterThan(0.1);
            expect(goldenForestShoreDistance(tree.x, tree.z), where).toBeGreaterThan(0.5);
            for (const other of GOLDEN_FOREST_FEATURE_TREES) {
                if (other !== tree) expect(Math.hypot(other.x - tree.x, other.z - tree.z), where).toBeGreaterThan(2);
            }
        }
        // "Company for the two, so the frame has depth: one behind the spruce, two on the spit."
        const [spruce, , behind, ...onTheSpit] = GOLDEN_FOREST_FEATURE_TREES.slice(0, 5);
        expect(behind.asset).toBe('spruce-grove-b');
        expect(goldenForestShores(behind.x, behind.z).near).toBeGreaterThan(1);
        expect(behind.x).toBeLessThan(spruce.x);
        expect(onTheSpit.map((tree) => tree.asset)).toEqual(['spruce-grove-a', 'spruce-grove-c']);
        for (const tree of onTheSpit) {
            const shores = goldenForestShores(tree.x, tree.z);
            expect(shores.spit).toBeGreaterThan(1);
            expect(goldenForestShoreDistance(tree.x, tree.z)).toBe(shores.spit);
        }
    });

    it('plants the two framing trees on the near bank either side of the board, and two on the islet', () => {
        expect(Object.isFrozen(GOLDEN_FOREST_FEATURE_TREES)).toBe(true);
        const [spruce, pine] = GOLDEN_FOREST_FEATURE_TREES;
        expect(spruce.asset).toBe('spruce-hero');
        expect(pine.asset).toBe('pine-hero');
        // "An old spruce on the left point, a pine leaning out over the water on the right."
        expect(spruce.x).toBeLessThan(-6);
        expect(pine.x).toBeGreaterThan(6);
        for (const hero of [spruce, pine]) {
            expect(goldenForestGroundHeight(hero.x, hero.z)).toBeGreaterThan(0.1);
            expect(goldenForestShores(hero.x, hero.z).near).toBeGreaterThan(0.5);
            expect(hero.scale).toBe(1);
            // In front of the camera, close enough to frame the picture.
            expect(hero.z).toBeLessThan(GOLDEN_FOREST_VIEWS.landscape.position[2] - 8);
            expect(hero.z).toBeGreaterThan(-5);
        }
        // The pine stands at the very edge: its trunk within a pace of the waterline.
        expect(goldenForestShoreDistance(pine.x, pine.z)).toBeLessThan(1.5);
        expect(goldenForestShoreDistance(spruce.x, spruce.z)).toBeGreaterThan(2);
        // Each stands on one of the two small points the near bank pushes out for them.
        for (const hero of [spruce, pine]) {
            const here = goldenForestShores(hero.x, hero.z).near;
            const beside = goldenForestShores(hero.x + Math.sign(hero.x) * 14, hero.z).near;
            const middle = goldenForestShores(0, hero.z).near;
            expect(here).toBeGreaterThan(beside + 3);
            expect(here).toBeGreaterThan(middle + 3);
        }
        // "The islet in the sun's path: a wind-bent pine and a seedling spruce."
        const islet = GOLDEN_FOREST_FEATURE_TREES.slice(-2);
        expect(islet.map((tree) => tree.asset)).toEqual(['pine-grove-b', 'spruce-grove-c']);
        for (const tree of islet) {
            const shores = goldenForestShores(tree.x, tree.z);
            expect(shores.islet).toBeGreaterThan(1);
            expect(goldenForestShoreDistance(tree.x, tree.z)).toBe(shores.islet);
            expect(goldenForestGroundHeight(tree.x, tree.z)).toBeGreaterThan(0.5);
        }
        expect(islet[1].scale).toBeLessThan(0.5);
        // The islet lies a little left of the board, toward the sun.
        const cameraZ = GOLDEN_FOREST_VIEWS.landscape.position[2];
        const bearing = THREE.MathUtils.radToDeg(Math.atan2(islet[0].x, cameraZ - islet[0].z));
        expect(bearing).toBeLessThan(-10);
        expect(bearing).toBeGreaterThan(GOLDEN_FOREST_SUN_AZIMUTH_DEGREES - 5);
        for (const tree of GOLDEN_FOREST_FEATURE_TREES) {
            expect(TREE_NAMES).toContain(tree.asset);
            expect([tree.x, tree.z, tree.yaw, tree.scale].every(Number.isFinite)).toBe(true);
            expect(tree.tone).toBeGreaterThanOrEqual(0);
            expect(tree.tone).toBeLessThanOrEqual(1);
        }
    });

    it('lays out the same grove for the same seed, in priority order so that a tier takes a prefix', () => {
        const grove = layoutGoldenForestGrove(seededRandom(5));
        expect(layoutGoldenForestGrove(seededRandom(5))).toEqual(grove);
        expect(layoutGoldenForestGrove(seededRandom(6))).not.toEqual(grove);
        expect(grove.length).toBeLessThanOrEqual(GOLDEN_FOREST_GROVE_CEILING);
        const budgets = Object.values(GOLDEN_FOREST_TIERS).map((tier) => tier.groveTrees);
        expect(grove.length).toBeGreaterThanOrEqual(Math.max(...budgets));
        // Generated in priority order: a cheaper tier keeps the same forest with fewer trees.
        for (const count of [0, 1, 7, ...budgets]) {
            expect(layoutGoldenForestGrove(seededRandom(5), count)).toEqual(grove.slice(0, count));
        }
        const grown = TREE_NAMES.filter((name) => name.includes('-grove-'));
        const {
            minX, maxX, minZ, maxZ,
        } = GOLDEN_FOREST_BOUNDS;
        const every = [...GOLDEN_FOREST_FEATURE_TREES, ...grove];
        for (const tree of grove) {
            // Only the trees of the shores are scattered; the two old ones are placed by hand.
            expect(grown).toContain(tree.asset);
            expect([tree.x, tree.z, tree.yaw].every(Number.isFinite)).toBe(true);
            expect(tree.scale).toBeGreaterThan(0.65);
            expect(tree.scale).toBeLessThan(1.3);
            expect(tree.tone).toBeGreaterThanOrEqual(0);
            expect(tree.tone).toBeLessThanOrEqual(1);
            expect(tree.x).toBeGreaterThan(minX);
            expect(tree.x).toBeLessThan(maxX);
            expect(tree.z).toBeGreaterThan(minZ);
            expect(tree.z).toBeLessThan(maxZ);
            expect(typeof tree.far).toBe('boolean');
            // Rooted on dry land a pace or more in from the water, never in the lake.
            expect(goldenForestShoreDistance(tree.x, tree.z)).toBeGreaterThan(1);
            expect(goldenForestGroundHeight(tree.x, tree.z)).toBeGreaterThan(0.2);
            // No two trunks share a spot, the hand-placed trees included.
            for (const other of every) {
                if (other !== tree) expect(Math.hypot(other.x - tree.x, other.z - tree.z)).toBeGreaterThan(4.3);
            }
        }
        expect(new Set(grove.map((tree) => tree.asset)).size).toBe(grown.length);
        // Even the smallest tier's share reaches every shore: near bank and far, both sides.
        const least = grove.slice(0, GOLDEN_FOREST_TIERS.Minimal.groveTrees);
        expect(least.some((tree) => tree.far)).toBe(true);
        expect(least.some((tree) => !tree.far)).toBe(true);
        expect(least.some((tree) => goldenForestShores(tree.x, tree.z).headland > 0)).toBe(true);
        expect(least.some((tree) => goldenForestShores(tree.x, tree.z).promontory > 0)).toBe(true);
        expect(least.some((tree) => goldenForestShores(tree.x, tree.z).island > 0)).toBe(true);
        expect(least.some((tree) => tree.x < 0 && goldenForestShores(tree.x, tree.z).near > 0)).toBe(true);
        expect(least.some((tree) => tree.x > 0 && tree.z > -20)).toBe(true);
    });

    it('recognises what could be on screen, directly or mirrored in the lake, and what never is', () => {
        const visible = createGoldenForestVisibilityTest();
        expect(visible(0, 5, -30, 1)).toBe(true);
        // Every hand-placed tree can show at least its crown in some framing ...
        for (const tree of GOLDEN_FOREST_FEATURE_TREES) expect(visible(tree.x, 12, tree.z, 5), tree.asset).toBe(true);
        // ... and the two that frame the picture, and the pair on the islet, their trunks too.
        for (const tree of [...GOLDEN_FOREST_FEATURE_TREES.slice(0, 2), ...GOLDEN_FOREST_FEATURE_TREES.slice(-2)]) {
            expect(visible(tree.x, 6, tree.z, 2), tree.asset).toBe(true);
        }
        // Behind the camera, far above it, and far off to the side of the foreground.
        expect(visible(0, 5, 80, 1)).toBe(false);
        expect(visible(0, 400, -10, 1)).toBe(false);
        expect(visible(400, 5, 10, 1)).toBe(false);
        expect(visible(-400, 5, 10, 1)).toBe(false);
        // A big enough thing just outside the frame still counts.
        expect(visible(0, 5, 80, 200)).toBe(true);
        // The lake is a mirror at y = 0: whatever is true of a point is true of its reflection.
        const random = seededRandom(23);
        const seen = { both: 0, neither: 0 };
        for (let sample = 0; sample < 4000; sample++) {
            const x = (random() * 2 - 1) * 260;
            const y = (random() * 2 - 1) * 160;
            const z = 40 - random() * 420;
            const radius = random() * 3;
            const answer = visible(x, y, z, radius);
            if (visible(x, -y, z, radius) !== answer) throw new Error(`mirror asymmetry at ${x}, ${y}, ${z}`);
            seen[answer ? 'both' : 'neither'] += 1;
        }
        expect(seen.both).toBeGreaterThan(400);
        expect(seen.neither).toBeGreaterThan(400);
        // So a crown too far below the frame to be seen directly is kept when its image above
        // the water is in view: far down the lake, forty metres "under" the surface.
        const eye = goldenForestEye(GOLDEN_FOREST_VIEWS.portrait);
        const forward = new THREE.Vector3(...GOLDEN_FOREST_VIEWS.portrait.target)
            .sub(new THREE.Vector3(...eye)).normalize();
        const ahead = new THREE.Vector3(...eye).addScaledVector(forward, 50);
        expect(visible(ahead.x, 40, ahead.z, 1)).toBe(true);
        expect(visible(ahead.x, -40, ahead.z, 1)).toBe(true);
        expect(visible(ahead.x, 90, ahead.z, 1)).toBe(false);
        expect(visible(ahead.x, -90, ahead.z, 1)).toBe(false);
    });
});

describe('Golden Forest world scene contracts', () => {
    const lake = {};

    beforeAll(async () => {
        const built = await Promise.all(BUILT.map((quality) => buildWorld(quality, { track: false })));
        BUILT.forEach((quality, index) => { lake[quality] = built[index]; });
    }, SLOW);

    afterAll(() => {
        Object.values(lake).forEach(({ world, assets }) => {
            world.dispose();
            disposeGoldenForestAssets(assets);
        });
    });

    it.each(BUILT)('builds the complete finite node scene at %s', (quality) => {
        const {
            scene, camera, world, assets, tier,
        } = lake[quality];
        expect(world.tier).toBe(tier);
        expect(world.built).toBe(true);
        expect(scene.children).toEqual([world.group]);
        expect(world.group.parent).toBe(scene);
        for (const part of [...SCENERY, 'lake']) {
            expect(world[part].group.parent, part).toBe(world.group);
        }
        expect(world.light.sun.parent).toBe(world.group);
        expect(world.light.sun.target.parent).toBe(world.group);
        const meshes = drawables(world.group);
        expect(meshes.length).toBeGreaterThan(30);
        world.group.traverse((object) => {
            // Everything drawn is a mesh: no points, lines or sprites with their own material rules.
            expect(Boolean(object.isPoints || object.isLine || object.isSprite), object.name).toBe(false);
        });
        const shared = assetGeometries(assets);
        for (const mesh of meshes) {
            expect(mesh.name).not.toBe('');
            // Node materials only: both backends shade from the same graph, and nothing
            // carries hand-written GLSL that the WebGPU backend could not run.
            expect(Array.isArray(mesh.material)).toBe(false);
            expect(mesh.material.isNodeMaterial, mesh.name).toBe(true);
            expect(mesh.material.isShaderMaterial, mesh.name).not.toBe(true);
            expect(mesh.material.isRawShaderMaterial, mesh.name).not.toBe(true);
            expect(mesh.material.type, mesh.name).toBe('MeshBasicNodeMaterial');
            expect(mesh.material.name, mesh.name).toMatch(/^GoldenForest/);
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
            // Exactly the solid things of the shores cast into the sun's one shadow map.
            expect(mesh.castShadow, mesh.name).toBe(SHADOW_CASTERS.test(mesh.name));
            if (mesh.castShadow) {
                // The shadow pass multiplies a caster's alpha by its colorNode, which here would
                // sample the very shadow map being drawn: casters must shade in fragmentNode.
                expect(mesh.material.colorNode ?? null, mesh.name).toBeNull();
                expect(mesh.material.fragmentNode?.isNode, mesh.name).toBe(true);
            } else {
                expect(mesh.material.colorNode?.isNode, mesh.name).toBe(true);
                expect(mesh.material.fragmentNode ?? null, mesh.name).toBeNull();
            }
            if (mesh.material.transparent) {
                // Light in the air is blended over the scene and never writes depth.
                expect(mesh.material.depthWrite, mesh.name).toBe(false);
                expect(mesh.material.opacityNode?.isNode, mesh.name).toBe(true);
            }
        }
        // Bark, sprays and props are drawn straight from the shared asset pack.
        for (const mesh of named(world.group, FROM_THE_PACK)) {
            expect(shared.has(mesh.geometry), mesh.name).toBe(true);
        }

        // Light: one low sun whose shadow-casting direction is the one every material shades with.
        const { sun } = world.light;
        expect(sun.castShadow).toBe(true);
        expect(sun.shadow.mapSize.toArray()).toEqual(tier.shadowMap);
        expect(sun.shadow.autoUpdate).toBe(false);
        expect(sun.shadow.needsUpdate).toBe(true);
        const toSun = sun.position.clone().sub(sun.target.position).normalize();
        expect(toSun.distanceTo(GOLDEN_FOREST_SUN_DIRECTION)).toBeLessThan(1e-9);
        expect(world.light.uSunDir.value.distanceTo(GOLDEN_FOREST_SUN_DIRECTION)).toBeLessThan(1e-9);
        expect(GOLDEN_FOREST_SUN_DIRECTION.length()).toBeCloseTo(1, 12);
        // The golden hour: the sun a hand above the horizon.
        expect(GOLDEN_FOREST_SUN_DIRECTION.y).toBeGreaterThan(0.1);
        expect(GOLDEN_FOREST_SUN_DIRECTION.y).toBeLessThan(0.3);
        // Without the pipeline's shafts the haze itself carries the sunlit air.
        expect(world.light.uHazeSun.value).toBe(tier.godrays > 0 ? 0.5 : 1);

        // Trees.
        const { stats, placements } = world.forest;
        expect(stats.trees).toBe(placements.length);
        expect(stats.trees).toBe(GOLDEN_FOREST_FEATURE_TREES.length + tier.groveTrees);
        expect(placements.slice(0, GOLDEN_FOREST_FEATURE_TREES.length).map((tree) => tree.asset))
            .toEqual(GOLDEN_FOREST_FEATURE_TREES.map((tree) => tree.asset));
        const bark = named(world.group, /^GoldenForestBark /);
        expect(sum(bark.map((mesh) => mesh.count))).toBe(stats.trees);
        const sprays = named(world.group, /^GoldenForestNeedles /);
        expect(sum(sprays.map((mesh) => mesh.count))).toBe(stats.sprays);
        expect(stats.sprays).toBeGreaterThan(0);
        expect(stats.culledSprays).toBeGreaterThan(0);
        expect(stats.foliageTriangles).toBe(sum(sprays.map((mesh) => (mesh.geometry.index.count / 3) * mesh.count)));
        // What the forest says it draws is what its bark geometry is set to draw.
        expect(stats.barkTriangles).toBe(sum(bark.map((mesh) => (
            (Math.min(mesh.geometry.index.count, mesh.geometry.drawRange.count) / 3) * mesh.count))));
        // Limbs are last in each bark index buffer; tiers without them stop at the core.
        for (const tree of Object.values(assets.trees)) {
            const drawn = Math.min(tree.bark.index.count, tree.bark.drawRange.count);
            expect(drawn, tree.name).toBe(tier.limbs ? tree.bark.index.count : tree.barkCoreIndices);
        }
        // Every spray draw has its own material: the instance buffers are part of its graph.
        expect(new Set(sprays.map((mesh) => mesh.material)).size).toBe(sprays.length);
        expect(sprays.every((mesh) => mesh.material.side === THREE.DoubleSide)).toBe(true);

        // The far shores, the water's edge and the air.
        const [farTrees] = named(world.group, 'GoldenForestFarShore');
        expect(farTrees.isInstancedMesh).toBe(true);
        expect(farTrees.count).toBe(world.backdrop.count);
        expect(world.backdrop.count).toBeGreaterThan(tier.farTrees * 0.8);
        expect(world.backdrop.count).toBeLessThanOrEqual(tier.farTrees);
        expect(named(world.group, 'GoldenForestRidges')).toHaveLength(1);
        const [blades] = named(world.group, 'GoldenForestReedsAndGrass');
        expect(blades.count).toBeGreaterThan((tier.reeds + tier.grass) * 0.8);
        expect(blades.count).toBeLessThanOrEqual(tier.reeds + tier.grass);
        const boulders = named(world.group, /^GoldenForestBoulders /);
        expect(sum(boulders.map((mesh) => mesh.count))).toBeGreaterThanOrEqual(8);
        expect(sum(boulders.map((mesh) => mesh.count))).toBeLessThanOrEqual(tier.rocks);
        expect(new Set(boulders.map((mesh) => mesh.material)).size).toBe(1);
        for (const prop of ['jetty', 'snag', 'rowboat']) {
            expect(named(world.group, `GoldenForest ${prop}`), prop).toHaveLength(1);
        }
        expect(world.shore.boat).toBe(named(world.group, 'GoldenForest rowboat')[0]);
        expect(named(world.group, 'GoldenForestSky')).toHaveLength(1);
        expect(named(world.group, /^GoldenForestMistBank /)).toHaveLength(tier.mist);
        expect(named(world.group, 'GoldenForestSunMotes')[0].count).toBe(tier.motes);
        expect(world.birds.count).toBe(tier.birds);
        expect(named(world.group, 'GoldenForestBirds').map((mesh) => mesh.count))
            .toEqual(tier.birds ? [tier.birds] : []);
        // Ribbons are built, and hidden until a combo calls them.
        const ribbons = named(world.group, /^GoldenForestRibbon /);
        expect(ribbons).toHaveLength(tier.ribbons);
        expect(world.ribbons.uLevel.value).toBe(0);

        // Fireflies: one draw, fed by the simulation's own buffers.
        const { sim, mesh: sparkMesh } = world.sparks;
        expect(sim.count).toBe(tier.sparks);
        expect(sim.reserve).toBe(Math.round(tier.sparks * 0.62));
        expect(sim.ambient + sim.reserve).toBe(tier.sparks);
        expect(named(world.group, 'GoldenForestFireflies')).toEqual([sparkMesh]);
        expect(sparkMesh.count).toBe(tier.sparks);
        expect(sparkMesh.material.blending).toBe(THREE.AdditiveBlending);
        expect(world.sparks.places.array).toBe(sim.outPlace);
        expect(world.sparks.glows.array).toBe(sim.outGlow);
        expect(world.sparks.velocities.array).toBe(sim.outVelocity);
        for (const buffer of [world.sparks.places, world.sparks.glows, world.sparks.velocities]) {
            expect(buffer.isInstancedBufferAttribute).toBe(true);
            expect(buffer.itemSize).toBe(4);
            expect(buffer.count).toBe(tier.sparks);
        }
        // All three are rewritten every frame, and are flagged so for the backend that asks.
        expect(world.sparks.places.usage).toBe(THREE.DynamicDrawUsage);
        expect(world.sparks.glows.usage).toBe(THREE.DynamicDrawUsage);
        expect(world.sparks.velocities.usage).toBe(THREE.DynamicDrawUsage);
        expect(allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity)).toBe(true);
        expect(sim.groundHeight).toBe(goldenForestGroundHeight);

        // The lake: one sheet of water with its pool of rings, and the director that feeds both.
        const [water] = named(world.group, 'GoldenForestWater');
        expect(world.lake.mesh).toBe(water);
        expect(water.isInstancedMesh).not.toBe(true);
        expect(world.lake.ripples.count).toBe(tier.ripples);
        expect(world.lake.ripples.active()).toBe(0);
        expect(world.director.sim).toBe(sim);
        expect(world.director.ripples).toBe(world.lake.ripples);
        expect(world.director.stage).toBe(world.stage);
        expect(world.director.scale).toBeCloseTo(Math.max(0.2, tier.sparks / 2200), 12);

        expect(world.getDiagnostics()).toEqual({
            quality,
            ...stats,
            farTrees: world.backdrop.count,
            birds: tier.birds,
            sparks: { ambient: sim.ambient, reserve: sim.reserve, live: 0 },
            rings: 0,
        });

        expect(camera.fov).toBe(GOLDEN_FOREST_VIEWS.landscape.fov);
        expect(allFinite(Float64Array.from(camera.projectionMatrix.elements))).toBe(true);
        expect(allFinite(Float64Array.from(camera.matrixWorld.elements))).toBe(true);
        expect(world.stage.board).toEqual(GOLDEN_FOREST_DEFAULT_BOARD);
    });

    it.each(BUILT)('puts the scenery of %s in the mirror of the lake, and keeps the lake out of it', (quality) => {
        const { world, camera } = lake[quality];
        const reflected = [];
        SCENERY.forEach((part) => world[part].group.traverse((object) => reflected.push([part, object])));
        expect(reflected.length).toBeGreaterThan(40);
        for (const [part, object] of reflected) {
            expect(object.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER), `${part}: ${object.name}`).toBe(true);
            // Still drawn by the main camera as well.
            expect(object.layers.isEnabled(0), `${part}: ${object.name}`).toBe(true);
        }
        // The water and the mirror's own target are not reflected in themselves.
        let unreflected = 0;
        world.lake.group.traverse((object) => {
            expect(object.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER), `lake: ${object.name}`).toBe(false);
            unreflected += 1;
        });
        expect(unreflected).toBeGreaterThanOrEqual(2);
        expect(world.lake.mesh.layers.mask).toBe(1);
        // Every drawable outside the lake is on the mirror layer; nothing was forgotten.
        for (const mesh of drawables(world.group)) {
            expect(mesh.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER), mesh.name).toBe(mesh !== world.lake.mesh);
        }
        // The mirror is a real planar reflection on every tier, and its camera sees only that layer.
        expect(world.lake.reflection).not.toBeNull();
        expect(world.lake.reflection.target.name).toBe('GoldenForestLakeMirror');
        expect(world.lake.reflection.target.parent).toBe(world.lake.group);
        const virtual = world.lake.reflection.reflector.getVirtualCamera(camera);
        expect(virtual.layers.mask).toBe(1 << GOLDEN_FOREST_MIRROR_LAYER);
        // The player's camera is left as it was: it sees the default layer, lake included.
        expect(camera.layers.mask).toBe(1);
        expect(GOLDEN_FOREST_MIRROR_LAYER).toBeGreaterThan(0);
    });

    it('keeps the same lake and draws less of it as the tier drops', () => {
        for (let index = 1; index < BUILT.length; index++) {
            const cheaper = lake[BUILT[index]].world;
            const dearer = lake[BUILT[index - 1]].world;
            const less = cheaper.getDiagnostics();
            const more = dearer.getDiagnostics();
            for (const key of ['trees', 'sprays', 'foliageTriangles', 'barkTriangles', 'farTrees', 'birds']) {
                expect(less[key], `${BUILT[index]}.${key}`).toBeLessThanOrEqual(more[key]);
            }
            for (const key of ['trees', 'sprays', 'foliageTriangles', 'farTrees']) {
                expect(less[key], `${BUILT[index]}.${key}`).toBeLessThan(more[key]);
            }
            // The numbers come from the one tier table.
            expect(less.sparks.ambient + less.sparks.reserve).toBe(GOLDEN_FOREST_TIERS[BUILT[index]].sparks);
            expect(cheaper.sparks.sim.count).toBeLessThan(dearer.sparks.sim.count);
            expect(cheaper.lake.ripples.count).toBeLessThanOrEqual(dearer.lake.ripples.count);
            expect(drawables(cheaper.group).length).toBeLessThanOrEqual(drawables(dearer.group).length);
            const count = (world, pattern) => sum(named(world.group, pattern).map((mesh) => mesh.count));
            for (const pattern of ['GoldenForestReedsAndGrass', /^GoldenForestBoulders /, 'GoldenForestSunMotes']) {
                expect(count(cheaper, pattern), String(pattern)).toBeLessThan(count(dearer, pattern));
            }
            // Changing quality must not rearrange the forest: same seed, same trees, fewer of them.
            const kept = cheaper.forest.placements;
            expect(dearer.forest.placements.slice(0, kept.length)).toEqual(kept);
        }
        // Each tree keeps a smaller share of its sprays, and the survivors grow to close the crown.
        const sprayScale = (quality) => {
            const fronds = named(lake[quality].world.group, 'GoldenForestNeedles spruce_frond_0');
            return mean(instances(fronds).map((instance) => instance.scale));
        };
        expect(sprayScale('Minimal')).toBeGreaterThan(sprayScale('High') * 1.2);
        // High keeps the limbs of the bark; Low and Minimal draw trunks only.
        expect(lake.Low.world.getDiagnostics().barkTriangles)
            .toBeLessThan(lake.High.world.getDiagnostics().barkTriangles / 4);
    });

    it('stands everything on the same analytic shores', () => {
        const { world, camera } = lake.High;
        const ground = world.terrain.mesh.geometry.attributes.position;
        let worst = 0;
        const span = {
            minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        };
        for (let index = 0; index < ground.count; index++) {
            const expected = goldenForestGroundHeight(ground.getX(index), ground.getZ(index));
            worst = Math.max(worst, Math.abs(ground.getY(index) - expected));
            span.minX = Math.min(span.minX, ground.getX(index));
            span.maxX = Math.max(span.maxX, ground.getX(index));
            span.minZ = Math.min(span.minZ, ground.getZ(index));
            span.maxZ = Math.max(span.maxZ, ground.getZ(index));
        }
        expect(worst).toBeLessThan(1e-4);
        expect(span).toEqual(GOLDEN_FOREST_BOUNDS);
        expect(world.terrain.height(3, -20)).toBe(goldenForestGroundHeight(3, -20));
        // Every trunk is rooted a few centimetres into the ground under it.
        const trunks = instances(named(world.group, /^GoldenForestBark /));
        expect(trunks).toHaveLength(world.forest.stats.trees);
        for (const trunk of trunks) {
            expect(trunk.y).toBeCloseTo(goldenForestGroundHeight(trunk.x, trunk.z) - 0.05, 4);
        }
        // Every one of them stands on dry land: the grove and the trees placed by hand alike.
        for (const tree of world.forest.placements) {
            expect(tree.y, `${tree.asset} at ${tree.x}, ${tree.z}`).toBeGreaterThan(0);
        }
        expect(Math.min(...trunks.map((trunk) => trunk.y))).toBeGreaterThan(0);
        // Boulders are bedded into whatever is under them, shallows included.
        const stones = instances(named(world.group, /^GoldenForestBoulders /));
        for (const stone of stones) {
            expect(stone.y).toBeCloseTo(goldenForestGroundHeight(stone.x, stone.z) - stone.scale * 0.12, 4);
            expect(Math.abs(goldenForestShoreDistance(stone.x, stone.z))).toBeLessThan(4.5);
        }
        // The eight that hold the picture's corners are where they were put.
        for (const [x, z, size] of [[-7.4, 6.6, 1.25], [7.9, 3.4, 1.35], [-17.4, -43.2, 1.3]]) {
            const stone = stones.find((entry) => Math.hypot(entry.x - x, entry.z - z) < 1e-4);
            expect(stone, `boulder at ${x}, ${z}`).toBeDefined();
            expect(stone.scale).toBeCloseTo(size, 5);
        }
        // Reeds stand in the shallows or on the bank; none floats and none is drowned.
        const blades = instances(named(world.group, 'GoldenForestReedsAndGrass'));
        for (let index = 0; index < blades.length; index += 7) {
            const blade = blades[index];
            expect(blade.y).toBeCloseTo(Math.max(-0.03, goldenForestGroundHeight(blade.x, blade.z)), 4);
            expect(goldenForestShoreDistance(blade.x, blade.z)).toBeGreaterThan(-3.4);
        }
        // The water in front of the board is kept open for the rings.
        expect(blades.some((blade) => Math.abs(blade.x) < 2 && blade.z < 9 && blade.y < 0.05)).toBe(false);
        // Far trees stand on land beyond the water, never in the foreground.
        for (const card of instances(named(world.group, 'GoldenForestFarShore'))) {
            expect(goldenForestShoreDistance(card.x, card.z)).toBeGreaterThan(1);
            expect(Math.abs(card.y - (goldenForestGroundHeight(card.x, card.z) - 0.3))).toBeLessThan(1.5);
            expect(Math.hypot(card.x - camera.position.x, card.z - camera.position.z)).toBeGreaterThan(55);
        }
        // Fireflies keep house over this lake: within the scene, none under the ground.
        const { sim } = world.sparks;
        for (let index = 0; index < sim.ambient; index++) {
            expect(Math.abs(sim.home[index * 3])).toBeLessThan(110);
            expect(sim.home[index * 3 + 2]).toBeGreaterThan(-72);
            expect(sim.outPlace[index * 4 + 1]).toBeGreaterThan(0);
        }
        // The far plane holds the sky dome.
        expect(camera.far).toBeGreaterThan(world.atmosphere.sky.geometry.parameters.radius);
        // And the camera itself stands on the bank it was framed from.
        const bank = goldenForestGroundHeight(0, camera.position.z);
        expect(camera.position.y).toBeCloseTo(bank + GOLDEN_FOREST_VIEWS.landscape.position[1], 12);
        expect(goldenForestGroundHeight(camera.position.x, camera.position.z)).toBeGreaterThan(0.5);
    });

    it('moors the boat on the water beside a jetty that runs from the bank out over the lake', () => {
        const { world } = lake.High;
        const [jetty] = named(world.group, 'GoldenForest jetty');
        const [boat] = named(world.group, 'GoldenForest rowboat');
        const [snag] = named(world.group, 'GoldenForest snag');
        const at = (mesh, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrix);
        // The jetty's deck is level with the lake's datum; its root is on the bank ...
        expect(jetty.position.y).toBe(0);
        const root = at(jetty, 0, 0, 0);
        expect(goldenForestShoreDistance(root.x, root.z)).toBeGreaterThan(0.5);
        expect(goldenForestShores(root.x, root.z).near).toBeGreaterThan(0.5);
        // ... and it runs out over open water, deeper with every plank.
        const { min, max } = jetty.geometry.boundingBox;
        const length = max.z - min.z;
        expect(length).toBeGreaterThan(6);
        const end = at(jetty, 0, 0, min.z);
        expect(goldenForestShoreDistance(end.x, end.z)).toBeLessThan(-4);
        expect(goldenForestGroundHeight(end.x, end.z)).toBeLessThan(-1.5);
        let previous = Infinity;
        for (let step = 0; step <= 10; step++) {
            const point = at(jetty, 0, 0, min.z * (step / 10));
            const inland = goldenForestShoreDistance(point.x, point.z);
            expect(inland).toBeLessThan(previous);
            previous = inland;
        }
        // Most of it stands in water: the piles are there for a reason.
        const middle = at(jetty, 0, 0, min.z / 2);
        expect(goldenForestGroundHeight(middle.x, middle.z)).toBeLessThan(0);
        // It points away from the camera's bank, out toward the lake.
        expect(end.z).toBeLessThan(root.z - 5);

        // The rowboat floats: over water deep enough for its hull, riding at the surface.
        expect(goldenForestShoreDistance(boat.position.x, boat.position.z)).toBeLessThan(-2);
        expect(goldenForestGroundHeight(boat.position.x, boat.position.z))
            .toBeLessThan(boat.geometry.boundingBox.min.y - 0.5);
        expect(Math.abs(boat.position.y)).toBeLessThan(0.05);
        // Moored to the jetty: alongside its outer half, within a boat's width of it.
        const along = new THREE.Vector3().subVectors(end, root);
        const reach = new THREE.Vector3().subVectors(boat.position, root).dot(along) / along.lengthSq();
        expect(reach).toBeGreaterThan(0.3);
        expect(reach).toBeLessThan(1);
        const nearest = root.clone().addScaledVector(along, reach);
        expect(Math.hypot(boat.position.x - nearest.x, boat.position.z - nearest.z)).toBeLessThan(2.5);
        // Both are on the right of the picture, by the leaning pine.
        expect(boat.position.x).toBeGreaterThan(5);
        expect(root.x).toBeGreaterThan(5);

        // The dead pine stands on the islet, rooted in its ground.
        const shores = goldenForestShores(snag.position.x, snag.position.z);
        expect(shores.islet).toBeGreaterThan(1);
        expect(goldenForestShoreDistance(snag.position.x, snag.position.z)).toBe(shores.islet);
        expect(snag.position.y).toBeCloseTo(goldenForestGroundHeight(snag.position.x, snag.position.z) - 0.1, 9);
        expect(snag.position.y).toBeGreaterThan(0);
    });

    it('bakes the shores into the map the lake reads its depth from', () => {
        const { lakeMap } = lake.High.world.terrain;
        expect(lakeMap.isDataTexture).toBe(true);
        expect(lakeMap.name).toBe('GoldenForestLakeMap');
        expect(lakeMap.colorSpace).toBe(THREE.NoColorSpace);
        expect(lakeMap.magFilter).toBe(THREE.LinearFilter);
        expect(lakeMap.minFilter).toBe(THREE.LinearFilter);
        expect(lakeMap.format).toBe(THREE.RGBAFormat);
        const { width, height, data } = lakeMap.image;
        expect([width, height]).toEqual([512, 384]);
        expect(data).toBeInstanceOf(Uint8Array);
        expect(data).toHaveLength(width * height * 4);
        expect(lake.High.world.lake.lakeMap).toBe(lakeMap);
        const {
            minX, maxX, minZ, maxZ,
        } = GOLDEN_FOREST_BOUNDS;
        const random = seededRandom(3);
        const { clamp } = THREE.MathUtils;
        const seen = { land: 0, water: 0 };
        for (let sample = 0; sample < 3000; sample++) {
            const column = Math.floor(random() * width);
            const row = Math.floor(random() * height);
            const x = minX + ((maxX - minX) * column) / (width - 1);
            const z = minZ + ((maxZ - minZ) * row) / (height - 1);
            const offset = (row * width + column) * 4;
            const ground = goldenForestGroundHeight(x, z);
            const red = Math.round(clamp((ground + GOLDEN_FOREST_MAP_BIAS) / GOLDEN_FOREST_MAP_RANGE, 0, 1) * 255);
            const green = Math.round(clamp(-goldenForestShoreDistance(x, z) / 40, 0, 1) * 255);
            const texel = Array.from(data.subarray(offset, offset + 4));
            if (texel.join() !== [red, green, 0, 255].join()) {
                throw new Error(`texel ${column}, ${row}: ${texel} != ${[red, green, 0, 255]}`);
            }
            seen[ground < 0 ? 'water' : 'land'] += 1;
            // Decoding it the way the water shader does recovers the depth to within a step.
            if (ground > -GOLDEN_FOREST_MAP_BIAS && ground < GOLDEN_FOREST_MAP_RANGE - GOLDEN_FOREST_MAP_BIAS) {
                const decoded = (data[offset] / 255) * GOLDEN_FOREST_MAP_RANGE - GOLDEN_FOREST_MAP_BIAS;
                expect(Math.abs(decoded - ground)).toBeLessThan(GOLDEN_FOREST_MAP_RANGE / 255);
            }
            // On land the "metres offshore" channel is empty.
            if (ground >= 0) expect(data[offset + 1]).toBe(0);
        }
        expect(seen.land).toBeGreaterThan(500);
        expect(seen.water).toBeGreaterThan(500);
        // The whole lake bed fits the encoding: nothing below the bias is clipped to black.
        expect(GOLDEN_FOREST_MAP_BIAS).toBeGreaterThan(3.6);
    });

    it('reproduces the same world for the same seed', async () => {
        const first = lake.Minimal.world;
        const assets = await loadBundle();
        const { world: second } = createWorld('Minimal', assets);
        const { world: other } = createWorld('Minimal', assets, { seed: 12345 });
        second.build();
        expect(second.forest.placements).toEqual(first.forest.placements);
        expect(second.getDiagnostics()).toEqual(first.getDiagnostics());
        const firstMeshes = drawables(first.group);
        const secondMeshes = drawables(second.group);
        expect(secondMeshes.map((mesh) => mesh.name)).toEqual(firstMeshes.map((mesh) => mesh.name));
        secondMeshes.forEach((mesh, index) => {
            if (!mesh.isInstancedMesh) return;
            expect(mesh.count).toBe(firstMeshes[index].count);
            expect(mesh.instanceMatrix.array).toEqual(firstMeshes[index].instanceMatrix.array);
        });
        expect(second.sparks.sim.outPlace).toEqual(first.sparks.sim.outPlace);
        expect(second.sparks.sim.home).toEqual(first.sparks.sim.home);
        // Another seed plants another grove on the same shores, with the same hand-placed trees.
        second.dispose();
        other.build();
        expect(other.forest.placements).not.toEqual(first.forest.placements);
        expect(other.forest.placements.slice(0, GOLDEN_FOREST_FEATURE_TREES.length))
            .toEqual(first.forest.placements.slice(0, GOLDEN_FOREST_FEATURE_TREES.length));
        expect(other.forest.stats.trees).toBe(first.forest.stats.trees);
    }, SLOW);

    it.each([
        ['landscape', LANDSCAPE], ['ultrawide', 21 / 9], ['square', 1], ['portrait', PORTRAIT], ['tall tablet', 3 / 4],
    ])('frames the camera and the stage for a %s screen', (_label, aspect) => {
        const { world, camera } = lake.Minimal;
        const restore = camera.aspect;
        try {
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            world.prepareCamera(aspect);
            const view = goldenForestViewFor(aspect);
            expect(camera.fov).toBe(view.fov);
            expect(camera.near).toBeGreaterThan(0);
            expect(camera.far).toBeGreaterThan(3000);
            expect(camera.position.x).toBe(view.position[0]);
            expect(camera.position.z).toBe(view.position[2]);
            // Eye height is measured from the bank under the camera.
            expect(camera.position.y).toBeCloseTo(view.position[1] + goldenForestGroundHeight(0, view.position[2]), 12);
            const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
            expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-9);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
            expect(camera.projectionMatrixInverse.elements.every(Number.isFinite)).toBe(true);
            // The stage follows: the board centre projects back onto the middle of the default card.
            const { stage } = world;
            const centre = stage.centre().project(camera);
            expect(centre.x).toBeCloseTo((GOLDEN_FOREST_DEFAULT_BOARD.x0 + GOLDEN_FOREST_DEFAULT_BOARD.x1) - 1, 9);
            expect(centre.y).toBeCloseTo(1 - (GOLDEN_FOREST_DEFAULT_BOARD.y0 + GOLDEN_FOREST_DEFAULT_BOARD.y1), 9);
            const halfHeight = GOLDEN_FOREST_STAGE_DEPTH * Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
            expect(stage.halfWidth()).toBeCloseTo(halfHeight * aspect, 9);
            // The card stands over the water, not over the bank.
            expect(goldenForestGroundHeight(stage.centre().x, stage.centre().z)).toBeLessThan(0);
            // Re-framing is repeatable and never moves the camera twice.
            const pose = camera.matrixWorld.clone();
            const stageBefore = world.stage;
            world.prepareCamera(aspect);
            expect(camera.matrixWorld.equals(pose)).toBe(true);
            expect(world.stage).toBe(stageBefore);
            // The mirror goes on seeing only its own layer through the re-framed camera.
            expect(world.lake.reflection.reflector.getVirtualCamera(camera).layers.mask)
                .toBe(1 << GOLDEN_FOREST_MIRROR_LAYER);
        } finally {
            camera.aspect = restore;
            camera.updateProjectionMatrix();
            world.prepareCamera(restore);
        }
    });

    it('falls back to the landscape view for an unusable aspect ratio', () => {
        const { world, camera } = lake.Minimal;
        const stageBefore = world.stage;
        for (const aspect of [NaN, 0, -1, Infinity, undefined, null, 'wide']) {
            world.prepareCamera(PORTRAIT);
            expect(camera.fov).toBe(GOLDEN_FOREST_VIEWS.portrait.fov);
            world.prepareCamera(aspect);
            expect(camera.fov).toBe(GOLDEN_FOREST_VIEWS.landscape.fov);
            expect(camera.position.z).toBe(GOLDEN_FOREST_VIEWS.landscape.position[2]);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        }
        expect(world.stage).toBe(stageBefore);
    });
});

describe('Golden Forest world in play', () => {
    function playSession(world, quality, frames = 200) {
        const reactions = new GoldenForestReactions({ quality, rng: seededRandom(5) });
        const left = cell(1, 20);
        const right = cell(8, 12);
        const script = {
            3: () => { reactions.onHardDrop({ distance: 15 }); reactions.onPieceLock({ piece: left }); },
            20: () => { reactions.onPieceLock({ piece: right }); reactions.onLineClear(1, { clearedRows: [23] }); },
            40: () => {
                reactions.onPieceLock({ piece: left });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(2);
            },
            60: () => { reactions.onCombo(5); reactions.onTSpin({ piece: right }); },
            80: () => { reactions.onCombo(9); reactions.onBackToBack(); },
            100: () => { reactions.onPerfectClear(); reactions.onLevelUp(); },
            170: () => reactions.onGameOver(),
        };
        const { sim } = world.sparks;
        const seen = {
            kinds: new Set(),
            fields: new Set(),
            maxLive: 0,
            maxRings: 0,
            peakShimmer: 0,
            peakStartle: 0,
            peakRibbons: 0,
            ribbonsShown: false,
            finite: true,
            front: false,
            settled: false,
        };
        for (let frame = 0; frame < frames; frame++) {
            script[frame]?.();
            const state = reactions.update(STEP);
            world.update(reactions.time, STEP, state);
            state.emitters.forEach((emitter) => seen.kinds.add(emitter.kind));
            world.director.fields.forEach((field) => seen.fields.add(field.kind));
            seen.maxLive = Math.max(seen.maxLive, sim.counts().live);
            seen.maxRings = Math.max(seen.maxRings, world.lake.ripples.active());
            seen.peakShimmer = Math.max(seen.peakShimmer, world.lake.uShimmer.value);
            seen.peakStartle = Math.max(seen.peakStartle, world.birds.uStartle.value);
            seen.peakRibbons = Math.max(seen.peakRibbons, world.ribbons.uLevel.value);
            seen.ribbonsShown = seen.ribbonsShown
                || (frame > 10 && world.ribbons.group.children.every((ribbon) => ribbon.visible));
            seen.front = seen.front || world.light.uFront.value.y > 0;
            seen.settled = seen.settled || world.director.env.settled;
            seen.finite = seen.finite && allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity)
                && world.lake.ripples.rings.every((ring) => ring.toArray().every(Number.isFinite));
        }
        return { reactions, seen };
    }

    it('plays a session of gameplay reactions without creating meshes, geometries or materials', async () => {
        const { world, scene } = await buildWorld('Medium');
        const meshes = drawables(world.group);
        const children = [...world.group.children];
        const before = resources(world.group);
        const counts = meshes.map((mesh) => mesh.count);
        const { sim } = world.sparks;
        const versions = [world.sparks.places.version, world.sparks.glows.version, world.sparks.velocities.version];
        const { seen, reactions } = playSession(world, 'Medium');

        const after = drawables(world.group);
        expect(after).toHaveLength(meshes.length);
        after.forEach((mesh, index) => {
            expect(mesh).toBe(meshes[index]);
            expect(mesh.count).toBe(counts[index]);
        });
        expect(world.group.children).toEqual(children);
        expect(scene.children).toEqual([world.group]);
        const now = resources(world.group);
        for (const kind of ['geometries', 'materials', 'instanced']) {
            expect(now[kind].size).toBe(before[kind].size);
            expect([...now[kind]].every((resource) => before[kind].has(resource))).toBe(true);
        }
        // The session really happened: every kind of emitter and force field was played ...
        expect([...seen.kinds].sort()).toEqual(['clear', 'combo', 'lock', 'rise', 'spin', 'splash']);
        expect([...seen.fields].sort()).toEqual(['burst', 'jet', 'vortex']);
        // ... the fireflies flew, the lake rang until its pool was full, the wind crossed it,
        expect(seen.maxLive).toBeGreaterThan(sim.reserve * 0.5);
        expect(seen.maxRings).toBe(world.lake.ripples.count);
        expect(seen.front).toBe(true);
        // ... the water shimmered, the birds went up, the ribbons unfurled, and it all settled.
        expect(seen.peakShimmer).toBeGreaterThan(0.9);
        expect(seen.peakStartle).toBeGreaterThan(0.9);
        expect(seen.peakRibbons).toBeGreaterThan(0.5);
        expect(seen.ribbonsShown).toBe(true);
        expect(seen.settled).toBe(true);
        expect(seen.finite).toBe(true);
        // Every frame re-uploads the three firefly buffers, and only moves the clock forward.
        expect(world.sparks.places.version).toBe(versions[0] + 200);
        expect(world.sparks.glows.version).toBe(versions[1] + 200);
        expect(world.sparks.velocities.version).toBe(versions[2] + 200);
        expect(world.light.uTime.value).toBeCloseTo(reactions.time, 9);
        expect(sim.time).toBeCloseTo(200 * STEP, 9);
        expect(world.getDiagnostics()).toMatchObject({
            sparks: sim.counts(), rings: world.lake.ripples.active(),
        });
        expect(world.getDiagnostics().rings).toBeGreaterThan(0);
    }, SLOW);

    it('answers one frame of every envelope and moves the rings and the fireflies on', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.sparks;
        const { ripples } = world.lake;
        const reactions = new GoldenForestReactions({ quality: 'Minimal', rng: seededRandom(5) });
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock({ piece: cell(1, 20) });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onCombo(12);
        const frame = reactions.update(STEP);
        // A full frame: every envelope, a front, rings, emitters, a river.
        expect(Object.keys(frame).sort()).toEqual(['emitters', 'epoch', 'flock', 'front', 'glow', 'gust', 'heat',
            'ribbons', 'rings', 'settled', 'shafts', 'shimmer', 'streak', 'vortex', 'warmth']);
        expect(() => world.update(reactions.time, STEP, frame)).not.toThrow();
        // The four rings the frame asked for are on the water, at age zero plus this frame.
        expect(ripples.active()).toBe(4);
        for (const ring of ripples.rings) {
            expect(ring.z).toBeCloseTo(STEP, 9);
            expect(ring.w).toBeGreaterThan(0);
            expect(goldenForestGroundHeight(ring.x, ring.y)).toBeLessThan(0);
        }
        expect(sim.time).toBeCloseTo(STEP, 9);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(world.light.uGust.value).toBeGreaterThan(1);
        expect(world.light.uWarmth.value).toBeCloseTo(frame.warmth, 12);
        expect(world.light.uGlow.value).toBeCloseTo(frame.glow, 12);
        expect(world.lake.uShimmer.value).toBeCloseTo(frame.shimmer, 12);
        expect(world.birds.uStartle.value).toBeCloseTo(frame.flock, 12);
        // The river has not built yet on its first frame.
        expect(world.ribbons.uLevel.value).toBe(frame.ribbons);

        // Half a second on: the rings have aged, the sparks have flown, the river has built.
        const lit = sparksAlight(sim);
        for (let step = 0; step < 30; step++) world.update(reactions.time, STEP, reactions.update(STEP));
        expect(ripples.active()).toBe(4);
        expect(Math.max(...ripples.rings.map((ring) => ring.z))).toBeCloseTo(31 * STEP, 6);
        expect(sim.time).toBeCloseTo(31 * STEP, 9);
        expect(sim.counts().live).toBeGreaterThan(lit.length);
        expect(sparksAlight(sim).slice(0, lit.length)).not.toEqual(lit);
        expect(world.ribbons.uLevel.value).toBeGreaterThan(0.5);
        expect(world.ribbons.uHeat.value).toBeGreaterThan(0);
        expect(world.ribbons.group.children.every((ribbon) => ribbon.visible)).toBe(true);
        expect(world.light.uFront.value.y).toBeGreaterThan(0);
        expect(world.director.fields.map((field) => field.kind)).toContain('vortex');
        // The boat rides the water rather than sitting still on it.
        const { boat } = world.shore;
        const heel = boat.rotation.z;
        world.update(reactions.time + 1, STEP, reactions.update(STEP));
        expect(boat.rotation.z).not.toBe(heel);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);
        // A frame without anything in it, or with nothing at all, is as welcome.
        expect(() => {
            world.update(reactions.time + 2, STEP);
            world.update(reactions.time + 2, STEP, {});
            world.update(reactions.time + 2, STEP, { emitters: null, rings: null, front: null });
        }).not.toThrow();
        expect(world.ribbons.uLevel.value).toBe(0);
    }, SLOW);

    it('hides the ribbons at rest once their pipelines have been warmed', async () => {
        const { world } = await buildWorld('Minimal');
        const ribbons = world.ribbons.group.children;
        expect(ribbons).toHaveLength(GOLDEN_FOREST_TIERS.Minimal.ribbons);
        // Built hidden, shown at zero strength for the first few frames so no combo compiles them.
        expect(ribbons.every((ribbon) => !ribbon.visible)).toBe(true);
        world.update(0, STEP, {});
        expect(ribbons.every((ribbon) => ribbon.visible)).toBe(true);
        expect(world.ribbons.uLevel.value).toBe(0);
        for (let frame = 0; frame < 6; frame++) world.update(frame * STEP, STEP, {});
        expect(ribbons.every((ribbon) => !ribbon.visible)).toBe(true);
        world.update(1, STEP, { ribbons: 0.6, heat: 0.3 });
        expect(ribbons.every((ribbon) => ribbon.visible)).toBe(true);
        expect(world.ribbons.uLevel.value).toBe(0.6);
        expect(world.ribbons.uHeat.value).toBe(0.3);
        world.update(1, STEP, { ribbons: 0.004 });
        expect(ribbons.every((ribbon) => !ribbon.visible)).toBe(true);
        world.update(1, STEP, { ribbons: 40, heat: -3 });
        expect(world.ribbons.uLevel.value).toBe(1);
        expect(world.ribbons.uHeat.value).toBe(0);
    }, SLOW);

    it('keeps invalid time inputs out of the world clock and bounds scene excitement', async () => {
        const { world } = await buildWorld('Minimal');
        const { light, sparks } = world;
        world.update(4, 0, { gust: 1 });
        const fullGust = light.uGust.value;
        expect(fullGust).toBeGreaterThan(0);
        world.update(4, 0, {
            gust: 2,
            warmth: -5,
            shafts: Infinity,
            glow: NaN,
            vortex: 0.75,
            heat: 9,
            shimmer: 40,
            flock: -2,
            ribbons: NaN,
        });
        expect(light.uTime.value).toBe(4);
        expect(light.uGust.value).toBe(fullGust);
        expect(light.uWarmth.value).toBe(0);
        expect(light.uGlow.value).toBe(0);
        expect(world.lake.uShimmer.value).toBe(1);
        expect(world.birds.uStartle.value).toBe(0);
        expect(world.ribbons.uLevel.value).toBe(0);
        expect(world.ribbons.uHeat.value).toBe(1);
        world.update(4, 0, {
            warmth: 0.5, glow: 0.25, shimmer: 0.4, flock: 0.7,
        });
        expect(light.uGust.value).toBe(0);
        expect(light.uWarmth.value).toBe(0.5);
        expect(light.uGlow.value).toBe(0.25);
        expect(world.lake.uShimmer.value).toBe(0.4);
        expect(world.birds.uStartle.value).toBe(0.7);
        for (const time of [NaN, Infinity, -Infinity, undefined, null, '9']) {
            world.update(time, 0);
            // The boat, like the light, stays at the last moment that made sense.
            expect(world.shore.boat.matrix.elements.every(Number.isFinite), String(time)).toBe(true);
        }
        expect(light.uTime.value).toBe(4);
        expect(world.shore.boat.position.y).toBeCloseTo(Math.sin(4 * 0.9) * 0.018, 12);
        world.update(-5, 0);
        expect(light.uTime.value).toBe(0);
        // Nonsense envelopes never reach the fireflies or the lake.
        for (let frame = 0; frame < 30; frame++) {
            world.update(frame * STEP, STEP, {
                gust: NaN, warmth: null, glow: -1, vortex: Infinity, heat: 'hot', front: null, emitters: [], rings: [],
            });
            world.update(frame * STEP, STEP, {
                gust: 1e9, vortex: 1e9, heat: 1e9, emitters: 'none', rings: 'none', front: { x: NaN, strength: 9 },
            });
        }
        const { sim } = sparks;
        expect(allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity)).toBe(true);
        expect(Number.isFinite(light.uGust.value)).toBe(true);
        expect(light.uFront.value.toArray().every(Number.isFinite)).toBe(true);
        expect(world.lake.ripples.rings.every((ring) => ring.toArray().every(Number.isFinite))).toBe(true);
        expect(world.shore.boat.matrix.elements.every(Number.isFinite)).toBe(true);
    }, SLOW);

    it('does not advance the fireflies or the rings on a frozen, backward or nonsensical timestep', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.sparks;
        const { ripples } = world.lake;
        ripples.add(0, -10, 1);
        const before = Array.from(sim.outPlace);
        const ring = ripples.rings[0].toArray();
        const clocks = () => [world.director.fishClock, world.director.vortexFeed, world.shore.boatRing];
        const rest = clocks();
        for (const dt of [0, -1, -Infinity, NaN, Infinity, undefined, null, 'soon']) {
            world.update(1, dt, { gust: 1, vortex: 1, emitters: [] });
            expect(clocks(), String(dt)).toEqual(rest);
        }
        expect(sim.time).toBe(0);
        expect(Array.from(sim.outPlace)).toEqual(before);
        expect(ripples.rings[0].toArray()).toEqual(ring);
        // Nothing was added either: no fish, no ring from the boat, no spark for the river.
        expect(ripples.active()).toBe(1);
        expect(sim.counts().live).toBe(0);
        world.update(1, STEP, { emitters: [] });
        expect(sim.time).toBeCloseTo(STEP, 12);
        expect(ripples.rings[0].z).toBeCloseTo(STEP, 12);
        expect(world.shore.boatRing).toBeCloseTo(rest[2] - STEP, 12);
    }, SLOW);

    // Regression: a NaN timestep used to stop the fish for good and drop a ring from the boat
    // on every such frame, and a NaN time wrote NaN into the rowboat's matrix.
    it('shrugs off a frame whose time and timestep are not numbers', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.sparks;
        const { ripples } = world.lake;
        const { boat } = world.shore;
        const { director, light } = world;
        const added = vi.spyOn(ripples, 'add');
        const reactions = new GoldenForestReactions({ quality: 'Minimal', rng: seededRandom(5) });
        reactions.onPieceLock({ piece: cell(1, 20) });
        reactions.onCombo(8);
        for (let frame = 0; frame < 10; frame++) world.update(2 + frame * STEP, STEP, reactions.update(STEP));
        const frame = reactions.getFrame();
        expect(frame.vortex).toBeGreaterThan(0.03);
        const before = {
            time: light.uTime.value,
            simTime: sim.time,
            place: Array.from(sim.outPlace),
            pose: boat.matrix.clone(),
            clocks: [director.fishClock, director.vortexFeed, world.shore.boatRing],
            rings: ripples.rings.map((entry) => entry.toArray()),
            added: added.mock.calls.length,
            live: sim.counts().live,
        };
        expect(before.live).toBeGreaterThan(0);
        expect(before.added).toBe(2);

        for (let repeat = 0; repeat < 8; repeat++) world.update(NaN, NaN, frame);
        // The boat is where it was, the clocks have not moved and are still numbers ...
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);
        expect(boat.position.toArray().every(Number.isFinite)).toBe(true);
        expect(boat.matrix.equals(before.pose)).toBe(true);
        expect([director.fishClock, director.vortexFeed, world.shore.boatRing]).toEqual(before.clocks);
        expect(before.clocks.every(Number.isFinite)).toBe(true);
        expect(light.uTime.value).toBe(before.time);
        // ... no ring was dropped, by the boat or by anything else, and none has aged ...
        expect(added).toHaveBeenCalledTimes(before.added);
        expect(ripples.rings.map((entry) => entry.toArray())).toEqual(before.rings);
        // ... and the fireflies hang exactly where they were, every buffer still finite.
        expect(sim.time).toBe(before.simTime);
        expect(sim.counts().live).toBe(before.live);
        expect(Array.from(sim.outPlace)).toEqual(before.place);
        expect(allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity)).toBe(true);

        // Each is judged on its own: a good timestep still advances a frame with a bad time,
        world.update(NaN, STEP, frame);
        expect(light.uTime.value).toBe(before.time);
        expect(sim.time).toBeCloseTo(before.simTime + STEP, 12);
        expect(world.shore.boatRing).toBeCloseTo(before.clocks[2] - STEP, 12);
        expect(boat.matrix.equals(before.pose)).toBe(true);
        // and a good time still moves the light and the boat when the timestep is bad.
        world.update(9, NaN, frame);
        expect(light.uTime.value).toBe(9);
        expect(sim.time).toBeCloseTo(before.simTime + STEP, 12);
        expect(boat.matrix.equals(before.pose)).toBe(false);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);

        // Afterwards the lake lives on as it would have: the boat rocks on schedule, once.
        added.mockClear();
        reactions.onGameOver();
        for (let step = 0; step < 6 * 60; step++) world.update(9 + step * STEP, STEP, reactions.update(STEP));
        expect(added.mock.calls.filter(([x, z]) => x === boat.position.x && z === boat.position.z)).toHaveLength(1);
        expect(Number.isFinite(director.fishClock)).toBe(true);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);
    }, SLOW);

    it('returns the fireflies and the lake to a calm opening state on resetEffects', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.sparks;
        const fresh = Array.from(sim.outPlace);
        const { reactions } = playSession(world, 'Low', 110);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(world.lake.ripples.active()).toBeGreaterThan(0);
        expect(world.director.serials.size).toBeGreaterThan(0);
        expect(world.director.ringSerial).toBeGreaterThan(0);
        expect(world.director.fields.length).toBeGreaterThan(0);
        const { version } = world.sparks.places;

        // A new session: the reactions start over, and the world drops what was in flight.
        reactions.reset();
        world.resetEffects();
        expect(sim.time).toBe(0);
        expect(sim.counts()).toEqual({ ambient: sim.ambient, reserve: sim.reserve, live: 0 });
        expect(Array.from(sim.outPlace)).toEqual(fresh);
        expect(sparksAlight(sim)).toEqual([]);
        expect(world.lake.ripples.active()).toBe(0);
        expect(world.lake.ripples.rings.every((ring) => ring.toArray().every((value) => value === 0))).toBe(true);
        expect(world.director.fields).toEqual([]);
        expect(world.director.vortexFeed).toBe(0);
        expect(world.director.fishClock).toBe(3);
        // The cleared buffers are flagged for upload even though no frame has run.
        expect(world.sparks.places.version).toBeGreaterThan(version);
        expect(world.getDiagnostics()).toMatchObject({ rings: 0, sparks: { live: 0 } });

        // A new session numbers its events from zero again; its first lock must not be swallowed.
        // The director learns of the new session from the frame itself.
        reactions.onPieceLock({ piece: cell(1, 20) });
        world.update(0, STEP, reactions.update(STEP));
        expect(world.director.epoch).toBe(reactions.epoch);
        expect(sparksAlight(sim).length).toBeGreaterThan(0);
        expect(world.lake.ripples.active()).toBe(1);
        // And a rest frame after the reset drops no stale ring.
        world.update(0, STEP, reactions.update(STEP));
        expect(world.lake.ripples.active()).toBe(1);
        expect(world.director.ringSerial).toBe(0);
    }, SLOW);

    // Regression: resetEffects() used to forget which rings and emitters had been played, so
    // without a reset of the reactions the very next frame dropped every queued ring again
    // and re-threw every puff still in flight.
    it('forgets the effects in flight on resetEffects alone without replaying what the reactions hold', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.sparks;
        const { ripples } = world.lake;
        const reactions = new GoldenForestReactions({ quality: 'Minimal', rng: seededRandom(1) });
        reactions.onPieceLock({ piece: cell(1, 20) });
        reactions.onTSpin({ piece: cell(1, 20) });
        reactions.onLineClear(2, { clearedRows: [22, 23] });
        // Forty frames: the puff, the spiral and both jets have thrown all their sparks.
        for (let frame = 0; frame < 40; frame++) world.update(frame * STEP, STEP, reactions.update(STEP));
        expect(sim.counts().live).toBeGreaterThan(20);
        expect(ripples.active()).toBe(4);

        world.resetEffects();
        expect(sim.counts().live).toBe(0);
        expect(ripples.active()).toBe(0);
        // The reactions were left alone: four rings still queued, four emitters in mid-flight.
        const held = reactions.getFrame();
        expect(held.rings.filter((ring) => ring.serial >= 0)).toHaveLength(4);
        expect(held.emitters.map((emitter) => emitter.kind)).toEqual(['lock', 'spin', 'clear', 'clear']);
        const added = vi.spyOn(ripples, 'add');
        for (let frame = 40; frame < 60; frame++) {
            world.update(frame * STEP, STEP, reactions.update(STEP));
            // Not one ring comes back, and not one spark is thrown again.
            expect(ripples.active()).toBe(0);
            expect(sim.counts().live).toBe(0);
        }
        expect(added).not.toHaveBeenCalled();
        expect(reactions.frame.emitters).toHaveLength(4);
        expect(world.director.epoch).toBe(1);
        // What the reactions ask for next is new, and is played.
        reactions.onPieceLock({ piece: cell(8, 12) });
        world.update(1, STEP, reactions.update(STEP));
        expect(added).toHaveBeenCalledOnce();
        expect(sparksAlight(sim).length).toBeGreaterThan(0);
        expect(sparksAlight(sim).every((spark) => spark.x > 0)).toBe(true);
    }, SLOW);

    it('throws its fireflies from wherever the board is measured to be, and ignores junk', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.sparks;
        const reactions = new GoldenForestReactions({ quality: 'Minimal', rng: seededRandom(5) });
        const lockOnRightEdge = () => {
            // A new session each time: the reactions start over, the world drops what was in flight.
            reactions.reset();
            world.resetEffects();
            reactions.onPieceLock({ piece: cell(9, 14) });
            for (let frame = 0; frame < 6; frame++) world.update(frame * STEP, STEP, reactions.update(STEP));
            const flying = sparksAlight(sim);
            expect(flying.length).toBeGreaterThan(0);
            return { x: mean(flying.map((entry) => entry.x)), ring: world.lake.ripples.rings[0].x };
        };
        const atDefault = lockOnRightEdge();
        expect(atDefault.x).toBeGreaterThan(0);
        expect(atDefault.ring).toBeGreaterThan(0);
        // A card on the far left of the screen: its right edge is left of the view axis.
        world.setBoard({
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        });
        expect(world.stage.board).toEqual({
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        });
        const moved = lockOnRightEdge();
        expect(moved.x).toBeLessThan(0);
        // The ring follows the card too: it drops on the water behind the piece.
        expect(moved.ring).toBeLessThan(0);
        for (const junk of [null, undefined, {}, 'board', 42, [], { x0: NaN }, {
            x0: 0.9, x1: 0.1, y0: 0, y1: 1,
        }]) {
            world.setBoard({
                x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
            });
            expect(() => world.setBoard(junk)).not.toThrow();
            expect(world.stage.board).toEqual(GOLDEN_FOREST_DEFAULT_BOARD);
        }
        // Back at the default card the fireflies leave from the right of the view axis again.
        expect(lockOnRightEdge().x).toBeGreaterThan(0);
    }, SLOW);

    it('rocks the boat now and then hard enough to ring the water beside it', async () => {
        const { world } = await buildWorld('Minimal');
        const { ripples } = world.lake;
        const { boat } = world.shore;
        let rings = 0;
        const seen = [];
        // Twenty seconds of an empty, settled lake: no fish, no events, only the boat.
        for (let frame = 0; frame < 20 * 60; frame++) {
            world.update(frame * STEP, STEP, { settled: true });
            if (ripples.active() > rings) seen.push(frame * STEP);
            rings = ripples.active();
        }
        expect(seen.length).toBeGreaterThanOrEqual(2);
        expect(seen[0]).toBeGreaterThan(4.9);
        expect(seen[0]).toBeLessThan(5.1);
        expect(seen[1] - seen[0]).toBeCloseTo(6.5, 1);
        const ring = ripples.rings.find((entry) => entry.w > 0);
        expect(ring.x).toBe(boat.position.x);
        expect(ring.y).toBe(boat.position.z);
        expect(ring.w).toBeCloseTo(0.2, 6);
        // It bobs by millimetres, never out of the water.
        expect(Math.abs(boat.position.y)).toBeLessThanOrEqual(0.018);
    }, SLOW);
});

describe('Golden Forest world ownership', () => {
    it('builds only once', async () => {
        const { world, scene } = await buildWorld('Minimal');
        const meshes = drawables(world.group);
        const {
            forest, sparks, light, stage, director, lake,
        } = world;
        expect(world.built).toBe(true);
        expect(world.build()).toBe(world);
        expect(world.forest).toBe(forest);
        expect(world.sparks).toBe(sparks);
        expect(world.light).toBe(light);
        expect(world.stage).toBe(stage);
        expect(world.director).toBe(director);
        expect(world.lake).toBe(lake);
        expect(drawables(world.group)).toEqual(meshes);
        expect(scene.children).toEqual([world.group]);
    }, SLOW);

    it('disposes every owned resource once, leaves the scene empty and the shared assets to their owner', async () => {
        const {
            world, scene, assets,
        } = await buildWorld('Minimal');
        const shared = assetGeometries(assets);
        const { geometries, materials, instanced } = resources(world.group);
        const ownGeometries = [...geometries].filter((geometry) => !shared.has(geometry));
        expect(ownGeometries.length).toBeGreaterThan(8);
        expect(geometries.size - ownGeometries.length).toBeGreaterThan(15);
        expect(materials.size).toBeGreaterThan(25);
        const spy = (resource) => vi.spyOn(resource, 'dispose');
        const once = [...ownGeometries, ...materials, ...instanced, world.light.noiseTexture, world.terrain.lakeMap]
            .map(spy);
        const borrowed = [...shared, assets.impostors.texture].map(spy);
        const sun = spy(world.light.sun);
        const mirror = spy(world.lake.reflection);

        world.dispose();
        expect(world.disposed).toBe(true);
        expect(() => world.dispose()).not.toThrow();
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(sun).toHaveBeenCalledOnce();
        expect(mirror).toHaveBeenCalledOnce();
        borrowed.forEach((disposal) => expect(disposal).not.toHaveBeenCalled());
        // Nothing of the lake is left in the scene, at any depth.
        expect(scene.children).toHaveLength(0);
        expect(drawables(scene)).toEqual([]);
        expect(world.group.parent).toBeNull();
        expect(world.group.children).toHaveLength(0);
        for (const key of ['light', ...SCENERY, 'lake', 'director', 'stage']) {
            expect(world[key], key).toBeNull();
        }
        expect(() => world.build()).toThrow('Cannot rebuild a disposed GoldenForestWorld.');
        expect(scene.children).toHaveLength(0);

        // A disposed world is inert rather than explosive.
        expect(() => {
            world.update(1, STEP, { emitters: [] });
            world.setBoard(GOLDEN_FOREST_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        expect(world.getDiagnostics()).toEqual({
            quality: 'Minimal', farTrees: 0, birds: 0, sparks: null, rings: 0,
        });

        // The bundle is released by whoever loaded it, once.
        disposeGoldenForestAssets(assets);
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
        expect(bystander.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER)).toBe(false);
        world.dispose();
        expect(scene.children).toEqual([bystander]);
        bystander.geometry.dispose();
        bystander.material.dispose();
    }, SLOW);

    it('needs its assets and says so before touching the scene', async () => {
        const scene = new THREE.Scene();
        // Asked for nothing in particular, a world is a High one.
        const unspecified = new GoldenForestWorld({ scene, camera: new THREE.PerspectiveCamera() });
        expect(unspecified.quality).toBe('High');
        expect(unspecified.tier).toBe(GOLDEN_FOREST_TIERS.High);
        expect(unspecified.getDiagnostics()).toEqual({
            quality: 'High', farTrees: 0, birds: 0, sparks: null, rings: 0,
        });
        const world = new GoldenForestWorld({ scene, camera: new THREE.PerspectiveCamera(), quality: 'Minimal' });
        owned.push(world);
        expect(world.tier).toBe(GOLDEN_FOREST_TIERS.Minimal);
        expect(() => world.build()).toThrow('[GoldenForest] The world needs its loaded assets before it can build.');
        expect(scene.children).toHaveLength(0);
        expect(world.built).toBe(false);
        // Nothing was half-made: update, the board and diagnostics are still safe.
        expect(() => {
            world.update(0, STEP, { emitters: [] });
            world.setBoard(GOLDEN_FOREST_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        expect(world.getDiagnostics()).toEqual({
            quality: 'Minimal', farTrees: 0, birds: 0, sparks: null, rings: 0,
        });
        // Once the assets are there the same world builds.
        world.assets = await loadBundle();
        expect(world.build()).toBe(world);
        expect(scene.children).toEqual([world.group]);
        expect(world.getDiagnostics().trees)
            .toBe(GOLDEN_FOREST_FEATURE_TREES.length + GOLDEN_FOREST_TIERS.Minimal.groveTrees);
    }, SLOW);

    it('names the missing spray when the foliage pack lacks one, and still cleans up', async () => {
        const assets = await loadBundle();
        const removed = assets.foliage.meshes.spruce_bough_1;
        delete assets.foliage.meshes.spruce_bough_1;
        const { world, scene } = createWorld('Minimal', assets);
        expect(() => world.build())
            .toThrow('[GoldenForest] Foliage mesh "spruce_bough_1" is missing from the asset pack.');
        const terrain = vi.spyOn(world.terrain.mesh.geometry, 'dispose');
        world.dispose();
        expect(terrain).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(world.group.children).toHaveLength(0);
        removed.dispose();
    }, SLOW);

    // Every part is assigned to the world before it builds, so when a build throws halfway
    // world.dispose() still reaches what that part had already made.
    it('retains ownership of a partially built forest so a failure can be cleaned up', async () => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial();
        const geometryDisposal = vi.spyOn(geometry, 'dispose');
        const materialDisposal = vi.spyOn(material, 'dispose');
        vi.spyOn(GoldenForestForest.prototype, 'build').mockImplementation(function failedBuild() {
            this.own(geometry);
            this.own(material);
            this.group.add(new THREE.Mesh(geometry, material));
            throw new Error('partial forest failure');
        });
        const { world, scene } = createWorld('Minimal', await loadBundle());
        expect(() => world.build()).toThrow('partial forest failure');
        expect(world.forest).toBeInstanceOf(GoldenForestForest);
        // What was finished before the failure is still owned and released.
        const finished = [world.terrain.mesh.geometry, world.terrain.mesh.material, world.terrain.lakeMap,
            world.light.noiseTexture].map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        world.dispose();
        expect(geometryDisposal).toHaveBeenCalledOnce();
        expect(materialDisposal).toHaveBeenCalledOnce();
        finished.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        expect(() => world.build()).toThrow('Cannot rebuild a disposed GoldenForestWorld.');
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
        expect(ranges()).not.toEqual(pristine);
        for (const mesh of named(low.world.group, /^GoldenForestBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeLessThan(mesh.geometry.index.count);
        }
        low.world.dispose();
        expect(ranges()).toEqual(pristine);
        const high = createWorld('Medium', assets);
        high.world.build();
        for (const mesh of named(high.world.group, /^GoldenForestBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeGreaterThanOrEqual(mesh.geometry.index.count);
        }
    }, SLOW);

    it('builds without the far-tree sprite sheet and without the props', async () => {
        const { world } = await buildWorld('Minimal', { impostors: false, props: false });
        expect(world.backdrop.count).toBe(0);
        expect(world.getDiagnostics().farTrees).toBe(0);
        expect(named(world.group, 'GoldenForestFarShore')).toEqual([]);
        expect(named(world.group, 'GoldenForestRidges')).toHaveLength(1);
        // No boulders, jetty, boat or snag; the reeds and grass need no pack.
        expect(named(world.group, /^GoldenForestBoulders |^GoldenForest (jetty|snag|rowboat)$/)).toEqual([]);
        expect(world.shore.boat).toBeNull();
        expect(named(world.group, 'GoldenForestReedsAndGrass')).toHaveLength(1);
        expect(() => {
            for (let frame = 0; frame < 400; frame++) world.update(frame * STEP, STEP, { emitters: [], settled: true });
        }).not.toThrow();
        // With no boat to rock, a settled lake stays still.
        expect(world.lake.ripples.active()).toBe(0);
    }, SLOW);

    it('builds a grove from whichever trees were loaded', async () => {
        const loaded = ['spruce-hero', 'pine-grove-a'];
        const { world } = await buildWorld('Minimal', { trees: loaded });
        const bark = named(world.group, /^GoldenForestBark /);
        expect(bark.map((mesh) => mesh.name).sort())
            .toEqual(['GoldenForestBark pine-grove-a', 'GoldenForestBark spruce-hero']);
        expect(world.forest.placements.every((tree) => loaded.includes(tree.asset))).toBe(true);
        expect(world.forest.stats.trees).toBe(sum(bark.map((mesh) => mesh.count)));
        expect(world.forest.stats.trees)
            .toBeLessThan(GOLDEN_FOREST_FEATURE_TREES.length + GOLDEN_FOREST_TIERS.Minimal.groveTrees);
        const sprays = named(world.group, /^GoldenForestNeedles /);
        expect(sprays.length).toBeGreaterThan(0);
        expect(sprays.every((mesh) => /spruce_frond|pine_clump/.test(mesh.name))).toBe(true);
        expect(world.sparks.sim.count).toBe(GOLDEN_FOREST_TIERS.Minimal.sparks);
        expect(() => world.update(1, STEP, { emitters: [] })).not.toThrow();
    }, SLOW);

    // Regression: with no tree standing near the water there were no boughs for the fireflies
    // to keep house in, and build() threw while looking for one. These are bundles and seeds
    // it threw for: nothing loaded at all, or only a tree no hand-placed spot uses.
    it.each([
        ['no trees at all', [], 271],
        ['only pine-grove-a', ['pine-grove-a'], 5],
        ['only spruce-grove-d', ['spruce-grove-d'], 6],
        ['only pine-grove-a, on another seed', ['pine-grove-a'], 2],
    ])('builds with %s', async (_label, trees, seed) => {
        const { world, scene } = await buildWorld('Minimal', { trees, seed });
        const { placements } = world.forest;
        expect(world.built).toBe(true);
        expect(scene.children).toEqual([world.group]);
        expect(placements.every((tree) => trees.includes(tree.asset))).toBe(true);
        expect(named(world.group, /^GoldenForestBark /)).toHaveLength(placements.length ? trees.length : 0);
        expect(world.forest.stats.trees).toBe(placements.length);
        // The fireflies are all there, keeping house over the shallows and the reeds.
        const { sim } = world.sparks;
        expect(sim.count).toBe(GOLDEN_FOREST_TIERS.Minimal.sparks);
        expect(allFinite(sim.home) && allFinite(sim.outPlace)).toBe(true);
        for (let index = 0; index < sim.ambient; index++) {
            expect(sim.outPlace[index * 4 + 1]).toBeGreaterThan(0);
            expect(Math.abs(sim.home[index * 3])).toBeLessThan(31);
            expect(sim.home[index * 3 + 2]).toBeGreaterThan(-35);
        }
        expect(() => {
            for (let frame = 0; frame < 30; frame++) world.update(frame * STEP, STEP, { emitters: [], vortex: 1 });
        }).not.toThrow();
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(world.getDiagnostics().trees).toBe(placements.length);
    }, SLOW);

    it('finds no boughs for the fireflies when every tree that is placed stands on a far shore', async () => {
        const { world } = await buildWorld('Minimal');
        const { forest } = world;
        const everywhere = forest.sampleCrownPoints(40);
        expect(everywhere).toHaveLength(120);
        expect(allFinite(everywhere)).toBe(true);
        const all = forest.placements;
        forest.placements = all.filter((tree) => tree.far);
        expect(forest.placements.length).toBeGreaterThan(0);
        const none = forest.sampleCrownPoints(40);
        expect(none).toBeInstanceOf(Float32Array);
        expect(none).toHaveLength(0);
        // The homes are then the scatter over the shallows alone: 220 of them, all above the lake.
        const homes = world.fireflyHomes();
        expect(homes).toHaveLength(220 * 3);
        expect(allFinite(homes)).toBe(true);
        for (let index = 0; index < homes.length; index += 3) expect(homes[index + 1]).toBeGreaterThan(0.29);
        forest.placements = [];
        expect(forest.sampleCrownPoints(40)).toHaveLength(0);
        forest.placements = all;
        expect(forest.sampleCrownPoints(40)).toHaveLength(120);
    }, SLOW);
});

describe('Golden Forest post tier ownership', () => {
    let lake;

    beforeAll(async () => {
        lake = await buildWorld('High', { track: false });
    }, SLOW);

    afterAll(() => {
        lake.world.dispose();
        disposeGoldenForestAssets(lake.assets);
    });

    const lit = () => ({ light: lake.world.light, scene: lake.scene, camera: lake.camera });

    it.each(['Minimal', 'Low'])('avoids post targets at %s and restores direct renderer settings', (quality) => {
        let drawTone;
        let drawExposure;
        const {
            renderer, scene, camera, post,
        } = createPost(quality, lit());
        renderer.render.mockImplementation(() => {
            drawTone = renderer.toneMapping;
            drawExposure = renderer.toneMappingExposure;
        });
        expect(GOLDEN_FOREST_TIERS[quality].post).toBe(false);
        expect(post.disabled).toBe(true);
        expect(post.pipeline).toBeFalsy();
        expect(post.scenePass).toBeFalsy();
        expect(post.bloomNode).toBeFalsy();
        expect(post.godraysNode).toBeFalsy();
        expect(post.getDiagnostics()).toEqual({
            quality, disabled: true, useMRT: false, godrays: false,
        });
        // No pipeline, so nothing needs the shadow rig primed at construction.
        expect(renderer.render).not.toHaveBeenCalled();
        post.update({});
        const resting = post.uExposure.value;
        post.update({ warmth: 0.8 });
        post.render();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(drawTone).toBe(THREE.ACESFilmicToneMapping);
        expect(drawExposure).toBe(post.uExposure.value);
        expect(drawExposure).toBeGreaterThan(resting);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
        expect(() => post.setSize(800, 400)).not.toThrow();
        expect(post.uAspect.value).toBe(2);
        post.dispose();
        post.dispose();
        post.render();
        expect(renderer.render).toHaveBeenCalledOnce();
        expect(post.renderer).toBeNull();
        expect(post.light).toBeNull();
    });

    it.each(['Minimal', 'Low'])('restores the %s renderer state when a direct render throws', (quality) => {
        const { renderer, post } = createPost(quality, { render: vi.fn(() => { throw new Error('device lost'); }) });
        expect(() => post.render()).toThrow('device lost');
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });

    it('constructs a node-only post graph with sun shafts for High and disposes it exactly once', () => {
        expect(lake.world.light.sun.shadow.map).toBeNull();
        const {
            renderer, scene, camera, post,
        } = createPost('High', lit());
        expect(post.disabled).toBe(false);
        expect(post.pipeline.isRenderPipeline).toBe(true);
        expect(post.pipeline.outputColorTransform).toBe(false);
        expect(post.pipeline.outputNode.isNode).toBe(true);
        expect(post.useMRT).toBe(false);
        expect(post.getDiagnostics()).toEqual({
            quality: 'High', disabled: false, useMRT: false, godrays: true,
        });
        // GodraysNode reads the sun's shadow map while its graph is built: one direct render
        // of the lake makes the shadow rig exist first.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(post.godraysNode.raymarchSteps.value).toBe(GOLDEN_FOREST_TIERS.High.godrays);
        expect(post.godraysNode.resolutionScale).toBe(GOLDEN_FOREST_TIERS.High.godraysScale);
        expect(post.shaftsBlur.isNode).toBe(true);
        expect(post.bloomNode.isNode).toBe(true);
        const disposals = [post.pipeline, post.scenePass, post.bloomNode, post.godraysNode, post.shaftsBlur]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        post.dispose();
        post.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        for (const key of ['pipeline', 'scenePass', 'bloomNode', 'godraysNode', 'shaftsBlur', 'renderer', 'scene',
            'camera', 'light']) {
            expect(post[key], key).toBeNull();
        }
        // Nothing is drawn through a disposed lens.
        expect(() => post.render()).not.toThrow();
        expect(renderer.render).toHaveBeenCalledOnce();
        expect(() => post.update({ warmth: 1, shafts: 1 })).not.toThrow();
        // The lake's own light is not the lens's to dispose.
        expect(lake.world.light.sun.parent).toBe(lake.world.group);
    });

    it.each(['Medium', 'High', 'Ultra', 'Extreme'])('renders %s through its pipeline only', (quality) => {
        const { renderer, post } = createPost(quality, lit());
        const tier = GOLDEN_FOREST_TIERS[quality];
        expect(tier.post).toBe(true);
        expect(post.getDiagnostics()).toEqual({
            quality, disabled: false, useMRT: false, godrays: tier.godrays > 0,
        });
        expect(post.godraysNode.raymarchSteps.value).toBe(tier.godrays);
        expect(post.godraysNode.resolutionScale).toBe(tier.godraysScale);
        const draw = vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        renderer.render.mockClear();
        post.render();
        expect(draw).toHaveBeenCalledOnce();
        expect(renderer.render).not.toHaveBeenCalled();
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });

    it('does not prime the shadow rig again once its map exists', () => {
        const { sun } = lake.world.light;
        sun.shadow.map = { isRenderTarget: true, dispose() {} };
        try {
            const { renderer, post } = createPost('High', lit());
            expect(renderer.render).not.toHaveBeenCalled();
            expect(post.getDiagnostics().godrays).toBe(true);
            const offscreen = targetRenderer();
            createPost('High', { ...lit(), renderer: offscreen.renderer });
            expect(offscreen.renderer.setRenderTarget).not.toHaveBeenCalled();
            expect(offscreen.renderer.render).not.toHaveBeenCalled();
        } finally {
            sun.shadow.map = null;
        }
    });

    it('primes the shadow rig through a small offscreen target, then hands the renderer back as it was', () => {
        const canvas = { isRenderTarget: true, name: 'whatever was bound before' };
        const { renderer, log, current } = targetRenderer(canvas);
        const { scene, camera, post } = createPost('High', { ...lit(), renderer });
        expect(post.getDiagnostics().godrays).toBe(true);
        // One render of the lake, into a throwaway target shaped like the scene pass's own:
        // half-float colour with a depth texture and no multisampling, not the canvas.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(log.bound).toHaveLength(2);
        const [target, restored] = log.bound;
        expect(target.isRenderTarget).toBe(true);
        expect(target).not.toBe(canvas);
        expect(target.texture.type).toBe(THREE.HalfFloatType);
        expect(target.samples).toBe(0);
        expect(target.depthTexture.isDepthTexture).toBe(true);
        expect(target.width * target.height).toBeLessThanOrEqual(64);
        expect(log.drawnInto).toEqual([target]);
        // Afterwards the renderer points where it did before, and the target is gone.
        expect(restored).toBe(canvas);
        expect(current()).toBe(canvas);
        expect(log.disposed).toEqual([target]);
        // Tiers without shafts never need the rig, and so never touch the renderer's target.
        for (const quality of ['Low', 'Minimal']) {
            const direct = targetRenderer(canvas);
            createPost(quality, { ...lit(), renderer: direct.renderer });
            expect(direct.renderer.setRenderTarget).not.toHaveBeenCalled();
            expect(direct.renderer.render).not.toHaveBeenCalled();
        }
        // A renderer that cannot say what was bound is handed back unbound.
        const forgetful = targetRenderer(canvas);
        delete forgetful.renderer.getRenderTarget;
        createPost('High', { ...lit(), renderer: forgetful.renderer });
        expect(forgetful.log.bound[1]).toBeNull();
        expect(forgetful.log.disposed).toHaveLength(1);
    });

    it('restores the renderer and releases the offscreen target when priming the shadow rig throws', () => {
        const canvas = { isRenderTarget: true };
        const { renderer, log, current } = targetRenderer(canvas);
        renderer.render.mockImplementation(() => { throw new Error('device lost'); });
        expect(() => new GoldenForestPost({ ...lit(), renderer, quality: 'High' })).toThrow('device lost');
        expect(log.bound).toHaveLength(2);
        expect(log.bound[0].isRenderTarget).toBe(true);
        expect(current()).toBe(canvas);
        expect(log.disposed).toEqual([log.bound[0]]);
    });

    it('grades without shafts when it is given no light', () => {
        const { renderer, post } = createPost('High');
        expect(post.getDiagnostics()).toEqual({
            quality: 'High', disabled: false, useMRT: false, godrays: false,
        });
        expect(post.godraysNode).toBeUndefined();
        expect(post.shaftsBlur).toBeUndefined();
        expect(post.pipeline.isRenderPipeline).toBe(true);
        expect(post.bloomNode.isNode).toBe(true);
        expect(renderer.render).not.toHaveBeenCalled();
        const disposals = [post.pipeline, post.scenePass, post.bloomNode]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        post.dispose();
        post.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(post.pipeline).toBeNull();
    });

    it('falls back to the High lens for an unknown tier name', () => {
        const { post } = createPost('Potato');
        expect(post.tier).toBe(GOLDEN_FOREST_TIERS.High);
        expect(post.disabled).toBe(false);
        expect(post.getDiagnostics().quality).toBe('Potato');
    });

    it('accepts finite resize dimensions and rejects invalid values before resizing targets', () => {
        const { post } = createPost('High', lit());
        const resize = vi.spyOn(post.scenePass, 'setSize');
        post.setSize(390, 844);
        expect(post.uAspect.value).toBe(390 / 844);
        expect(resize).toHaveBeenCalledExactlyOnceWith(390, 844);
        for (const [width, height] of [[Infinity, 844], [390, Infinity], [NaN, 844], [390, NaN],
            [0, 844], [390, 0], [-1, 844], [390, -1], [undefined, 844], ['390', 844], [null, null]]) {
            post.setSize(width, height);
        }
        expect(resize).toHaveBeenCalledOnce();
        expect(post.uAspect.value).toBe(390 / 844);
    });

    it('answers warmth and shafts with a bounded lift of exposure, shafts and bloom', () => {
        const { post } = createPost('High', lit());
        const read = (frame) => {
            post.update(frame);
            return { exposure: post.uExposure.value, shafts: post.uShafts.value, bloom: post.bloomNode.strength.value };
        };
        const rest = read({});
        expect(read()).toEqual(rest);
        const warm = read({ warmth: 0.5, shafts: 0.5 });
        const hot = read({ warmth: 1, shafts: 1 });
        for (const key of ['exposure', 'shafts', 'bloom']) {
            expect(rest[key]).toBeGreaterThan(0);
            expect(warm[key]).toBeGreaterThan(rest[key]);
            expect(hot[key]).toBeGreaterThan(warm[key]);
        }
        expect(read({ warmth: 50, shafts: 50 })).toEqual(hot);
        for (const frame of [{ warmth: NaN, shafts: Infinity }, { warmth: -3, shafts: -3 },
            { warmth: 'hot', shafts: null }]) {
            expect(read(frame)).toEqual(rest);
        }
        // The lens stays subtle: a full celebration is a lift, not a flash.
        expect(hot.exposure).toBeLessThan(rest.exposure * 1.1);
        expect(hot.bloom).toBeLessThan(rest.bloom * 1.5);
        // Events lift the exposure from its resting value, wherever that has been set.
        expect(rest.exposure).toBe(post.exposure);
        post.exposure = 0.8;
        expect(read({}).exposure).toBe(0.8);
        expect(read({ warmth: 1 }).exposure - 0.8).toBeCloseTo(hot.exposure - rest.exposure, 12);
        // The direct-draw tiers expose by the same rule.
        const { renderer, post: direct } = createPost('Low', lit());
        direct.exposure = 0.9;
        direct.update({ warmth: 1 });
        let drawn;
        renderer.render.mockImplementation(() => { drawn = renderer.toneMappingExposure; });
        direct.render();
        expect(drawn).toBeCloseTo(0.9 + (hot.exposure - rest.exposure), 12);
    });

    it('tints its shafts from where the sun really stands on screen', () => {
        const { post, camera } = createPost('High', lit());
        post.update({});
        const sun = post.uSunScreen.value;
        // Left of the board and above the middle of the screen: over the headland.
        expect(sun.x).toBeGreaterThan(0.05);
        expect(sun.x).toBeLessThan(0.4);
        expect(sun.y).toBeGreaterThan(0.1);
        expect(sun.y).toBeLessThan(0.45);
        // It is the projection of the light rig's own sun direction (uv, y down).
        const point = camera.position.clone().addScaledVector(GOLDEN_FOREST_SUN_DIRECTION, 500).project(camera);
        expect(sun.x).toBeCloseTo(point.x * 0.5 + 0.5, 9);
        expect(sun.y).toBeCloseTo(0.5 - point.y * 0.5, 9);
        // Without a light or a camera the last position simply stands.
        const blind = createPost('Low').post;
        const before = blind.uSunScreen.value.clone();
        blind.update({ warmth: 1 });
        expect(blind.uSunScreen.value.equals(before)).toBe(true);
    });
});
