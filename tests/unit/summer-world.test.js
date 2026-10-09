import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    SUMMER_TREE_URLS, disposeSummerAssets, parseSummerMeshes, parseSummerTree, summerImpostorLayout,
    summerPropRecord,
} from '../../src/themes/summer/summer-assets.js';
import { SUMMER_SUN_RADIUS_DEGREES } from '../../src/themes/summer/summer-atmosphere.js';
import {
    SUMMER_FEATURE_TREES, SUMMER_VIEWS, summerEye, summerViewFor,
} from '../../src/themes/summer/summer-composition.js';
import { SUMMER_FLOWERS } from '../../src/themes/summer/summer-flowers.js';
import {
    SUMMER_HOUR_COLOURS, SUMMER_HOURS, summerHourAt, summerSunDirection,
} from '../../src/themes/summer/summer-hours.js';
import { SummerForest } from '../../src/themes/summer/summer-forest.js';
import { SUMMER_MIRROR_LAYER } from '../../src/themes/summer/summer-lake.js';
import { SUMMER_SUN_DIRECTION } from '../../src/themes/summer/summer-light.js';
import { SUMMER_PARTICLES } from '../../src/themes/summer/summer-petal-sim.js';
import { SummerPost } from '../../src/themes/summer/summer-post.js';
import { SUMMER_TIERS } from '../../src/themes/summer/summer-quality.js';
import { SUMMER_PIECE_FLOWERS, SummerReactions } from '../../src/themes/summer/summer-reactions.js';
import { SUMMER_DEFAULT_BOARD, SUMMER_STAGE_DEPTH } from '../../src/themes/summer/summer-stage.js';
import {
    SUMMER_BOUNDS, SUMMER_PLACES, SUMMER_TERRACES, summerGroundHeight, summerShoreDistance, summerShores,
} from '../../src/themes/summer/summer-terrain.js';
import { SummerWorld } from '../../src/themes/summer/summer-world.js';
import { seededRandom } from '../../src/utils/helpers.js';

const assetDirectory = new URL('../../src/themes/summer/assets/', import.meta.url);
const TREE_NAMES = Object.keys(SUMMER_TREE_URLS);
// The tiers built once and shared by the scene-contract tests, dearest first.
const BUILT = ['High', 'Low', 'Minimal'];
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
// The theme's own default seed.
const SEED = 624;
// Building the meadow from the real asset pack takes a second or so on a busy machine.
const SLOW = 120000;
const LETTERS = Object.keys(SUMMER_PIECE_FLOWERS);
const { petal: PETAL } = SUMMER_PARTICLES;
// The parts of the world the lake mirrors, in the order the world builds them; the meadow
// lies behind its own crest as the lake sees it and is left out.
const MIRRORED = ['terrain', 'forest', 'backdrop', 'atmosphere', 'homestead', 'shore', 'life', 'garlands', 'petals'];
const PARTS = [...MIRRORED, 'meadow', 'lake'];
// What getDiagnostics() counts, besides the petal pool.
const COUNTS = ['trees', 'sprays', 'grass', 'flowers', 'reeds', 'lilies', 'farTrees', 'butterflies', 'swallows'];
// Meshes drawn straight from the geometry of the shared asset pack.
const FROM_THE_PACK = /^Summer(Bark|Foliage) |^Summer (cottage|shed|maypole|jetty|rowboat|fence|boulder_[abc])$/;
// SummerForest keeps a draw out of the mirror when every tree in it stands behind the near
// shore: further up the bank than a crown's reach from where the water begins. These are
// NEAR_SHORE_Z and CROWN_REACH of summer-forest.js, which does not export them.
const NEAR_SHORE_Z = -8;
const CROWN_REACH = 6.5;
const standsBehindTheShore = (tree) => tree.z - CROWN_REACH * tree.scale > NEAR_SHORE_Z;
const owned = [];
const bundles = [];
const files = new Map();

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
    const [foliage, propsGltf, ...gltfs] = await Promise.all([parseGlb('summer-foliage.glb'),
        parseGlb('summer-props.glb'), ...trees.map((name) => parseGlb(`${name}.glb`))]);
    const assets = {
        foliage: parseSummerMeshes(foliage, 'Foliage'),
        props: parseSummerMeshes(propsGltf, 'Props'),
        trees: {},
        impostors: null,
    };
    trees.forEach((name, index) => { assets.trees[name] = parseSummerTree(gltfs[index], name); });
    if (impostors) {
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
        assets.impostors = { ...summerImpostorLayout(), texture };
    }
    if (!props) {
        Object.values(assets.props.meshes).forEach((geometry) => geometry.dispose());
        assets.props = null;
    }
    if (track) bundles.push(assets);
    return assets;
}

function createWorld(quality, assets, { seed = SEED, aspect = LANDSCAPE, track = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 3400);
    const world = new SummerWorld({
        scene, camera, quality, rng: seededRandom(seed), assets,
    });
    if (track) owned.push(world);
    return {
        scene, camera, world, assets, tier: SUMMER_TIERS[quality],
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
const count = (group, pattern) => sum(named(group, pattern).map((mesh) => mesh.count));

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

/** Roots of the plants of a meadow draw: where each stands, from its instance data. */
function roots(mesh) {
    const { aRoot } = mesh.geometry.attributes;
    const result = [];
    for (let index = 0; index < aRoot.count; index++) {
        result.push({ x: aRoot.getX(index), y: aRoot.getY(index), z: aRoot.getZ(index) });
    }
    return result;
}

/** What the game has thrown into the air and is still there. */
function alight(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index++) {
        if (sim.life[index] > 0) {
            result.push({
                x: sim.x[index], y: sim.y[index], z: sim.z[index], kind: sim.kind[index], flower: sim.flower[index],
            });
        }
    }
    return result;
}

/** The rings (or gusts) of a pool that are under way, as { x, z, age, strength }. */
function under(pool) {
    return pool.rings.filter((ring) => ring.w > 0).map((ring) => ({
        x: ring.x, z: ring.y, age: ring.z, strength: ring.w,
    }));
}

/** How brightly each of the seven lanterns on the maypole burns, as the paint shader reads them. */
function lanterns(world) {
    const [low, high] = world.homestead.bouquetVectors;
    return [low.x, low.y, low.z, low.w, high.x, high.y, high.z];
}

/** The seven lanterns with those of the given pieces lit: each letter has its own flower. */
function lanternsOf(letters) {
    const levels = new Array(LETTERS.length).fill(0);
    letters.forEach((letter) => { levels[SUMMER_PIECE_FLOWERS[letter]] = 1; });
    return levels;
}

/** One filled cell of a piece of a given kind at board column `x`, row `y` (rows 4..23 are visible). */
function piece(letter, x = 4, y = 20) {
    return {
        x, y, shape: [[1]], shapeKey: letter,
    };
}

/** Play the reactions into the world, frame by frame. */
function advance(world, reactions, seconds, each) {
    const frames = Math.max(1, Math.round(seconds / STEP));
    for (let frame = 0; frame < frames; frame++) {
        const state = reactions.update(STEP);
        world.update(reactions.time, STEP, state);
        each?.(state);
    }
}

/** Where a point of a prop (in its own metres) stands in the world: turned about Y, then moved. */
function placedPoint(place, x, z) {
    const cos = Math.cos(place.yaw || 0);
    const sin = Math.sin(place.yaw || 0);
    return { x: place.x + x * cos + z * sin, z: place.z - x * sin + z * cos };
}

/** The ground people levelled around a place: the terrace whose flat top holds it, if there is one. */
function terraceUnder(place) {
    return SUMMER_TERRACES.find((terrace) => Math.hypot(terrace.x - place.x, terrace.z - place.z) < terrace.radius);
}

/** A grid of points over a prop's footprint: its bounding box, turned by its yaw and set on its place. */
function footprint(name, steps = 16) {
    const { boundsMin, boundsMax } = summerPropRecord(name);
    const points = [];
    for (let column = 0; column <= steps; column++) {
        for (let row = 0; row <= steps; row++) {
            points.push(placedPoint(
                SUMMER_PLACES[name],
                boundsMin[0] + (boundsMax[0] - boundsMin[0]) * (column / steps),
                boundsMin[2] + (boundsMax[2] - boundsMin[2]) * (row / steps),
            ));
        }
    }
    return points;
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
    const post = new SummerPost(options);
    owned.push(post);
    return { ...options, post };
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeSummerAssets(assets));
    vi.restoreAllMocks();
});

describe('Summer world scene contracts', () => {
    const meadow = {};

    beforeAll(async () => {
        const built = await Promise.all(BUILT.map((quality) => buildWorld(quality, { track: false })));
        BUILT.forEach((quality, index) => { meadow[quality] = built[index]; });
    }, SLOW);

    afterAll(() => {
        Object.values(meadow).forEach(({ world, assets }) => {
            world.dispose();
            disposeSummerAssets(assets);
        });
    });

    it.each(BUILT)('builds the complete finite node scene at %s', (quality) => {
        const {
            scene, camera, world, assets, tier,
        } = meadow[quality];
        expect(world.tier).toBe(tier);
        expect(world.built).toBe(true);
        expect(scene.children).toEqual([world.group]);
        expect(world.group.parent).toBe(scene);
        for (const part of PARTS) expect(world[part].group.parent, part).toBe(world.group);
        expect(world.light.sun.parent).toBe(world.group);
        expect(world.light.sun.target.parent).toBe(world.group);
        const meshes = drawables(world.group);
        expect(meshes.length).toBeGreaterThan(40);
        world.group.traverse((object) => {
            // Everything drawn is a mesh: no points, lines or sprites with their own material rules.
            expect(Boolean(object.isPoints || object.isLine || object.isSprite), object.name).toBe(false);
        });
        const shared = assetGeometries(assets);
        for (const mesh of meshes) {
            expect(mesh.name, mesh.material.name).toMatch(/^Summer/);
            // Node materials only: both backends shade from the same graph, and nothing
            // carries hand-written GLSL that the WebGPU backend could not run.
            expect(Array.isArray(mesh.material)).toBe(false);
            expect(mesh.material.isNodeMaterial, mesh.name).toBe(true);
            expect(mesh.material.isShaderMaterial, mesh.name).not.toBe(true);
            expect(mesh.material.isRawShaderMaterial, mesh.name).not.toBe(true);
            // Unlit: every surface calls the shared light rig itself.
            expect(mesh.material.type, mesh.name).toBe('MeshBasicNodeMaterial');
            expect(mesh.material.name, mesh.name).toMatch(/^Summer/);
            expect(mesh.material.fog, mesh.name).toBe(false);
            const shaded = [mesh.material.fragmentNode, mesh.material.colorNode].filter(Boolean);
            expect(shaded, mesh.name).toHaveLength(1);
            expect(shaded[0].isNode, mesh.name).toBe(true);
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
                // Light in the air is blended over the scene and never writes depth.
                expect(mesh.material.depthWrite, mesh.name).toBe(false);
                expect(mesh.material.opacityNode?.isNode, mesh.name).toBe(true);
            }
        }
        // The solid things of the land cast into the sun's one shadow map ...
        expect(world.terrain.mesh.castShadow).toBe(true);
        for (const mesh of [...drawables(world.forest.group), ...named(world.group, FROM_THE_PACK),
            ...named(world.group, 'SummerFarShore')]) {
            expect(mesh.castShadow, mesh.name).toBe(true);
        }
        // ... and nothing that is grass, flower, wing, petal, ribbon, air or water does.
        for (const part of ['meadow', 'shore', 'life', 'garlands', 'petals', 'atmosphere', 'lake']) {
            for (const mesh of drawables(world[part].group)) expect(mesh.castShadow, mesh.name).toBe(false);
        }
        // Bark, sprays and props are drawn straight from the shared asset pack.
        expect(named(world.group, FROM_THE_PACK).length).toBeGreaterThan(20);
        for (const mesh of named(world.group, FROM_THE_PACK)) {
            expect(shared.has(mesh.geometry), mesh.name).toBe(true);
        }

        // Light: one low sun whose shadow-casting direction is the one every material shades with.
        const { sun } = world.light;
        expect(sun.castShadow).toBe(true);
        expect(sun.shadow.mapSize.toArray()).toEqual(tier.shadowMap);
        // The land never moves under a fixed sun: its shadows are drawn on request only.
        expect(sun.shadow.autoUpdate).toBe(false);
        expect(sun.shadow.needsUpdate).toBe(true);
        const toSun = sun.position.clone().sub(sun.target.position).normalize();
        expect(toSun.distanceTo(SUMMER_SUN_DIRECTION)).toBeLessThan(1e-9);
        expect(world.light.uSunDir.value.distanceTo(SUMMER_SUN_DIRECTION)).toBeLessThan(1e-9);
        expect(SUMMER_SUN_DIRECTION.length()).toBeCloseTo(1, 12);
        // Midsummer's Eve: the sun low over the lake in front of the camera, and left of the
        // board (the score card stands on the right).
        expect(SUMMER_SUN_DIRECTION.y).toBeGreaterThan(0);
        expect(SUMMER_SUN_DIRECTION.y).toBeLessThan(0.4);
        expect(SUMMER_SUN_DIRECTION.z).toBeLessThan(0);
        expect(SUMMER_SUN_DIRECTION.x).toBeLessThan(0);

        // Trees.
        const { stats, placements } = world.forest;
        expect(stats.trees).toBe(placements.length);
        expect(stats.trees).toBeGreaterThan(SUMMER_FEATURE_TREES.length);
        expect(stats.trees).toBeLessThanOrEqual(SUMMER_FEATURE_TREES.length + tier.groveTrees);
        expect(placements.slice(0, SUMMER_FEATURE_TREES.length).map((tree) => tree.asset))
            .toEqual(SUMMER_FEATURE_TREES.map((tree) => tree.asset));
        const bark = named(world.group, /^SummerBark /);
        expect(sum(bark.map((mesh) => mesh.count))).toBe(stats.trees);
        const sprays = named(world.group, /^SummerFoliage /);
        expect(sum(sprays.map((mesh) => mesh.count))).toBe(stats.sprays);
        expect(stats.sprays).toBeGreaterThan(0);
        // Sprays no pixel will ever need, directly or mirrored, were dropped at build time.
        expect(stats.culledSprays).toBeGreaterThan(0);
        expect(stats.foliageTriangles).toBe(sum(sprays.map((mesh) => (mesh.geometry.index.count / 3) * mesh.count)));
        // What the forest says it draws is what its bark geometry is set to draw.
        expect(stats.barkTriangles).toBe(sum(bark.map((mesh) => (
            (Math.min(mesh.geometry.index.count, mesh.geometry.drawRange.count) / 3) * mesh.count))));
        // The white wood comes first in each bark index buffer; tiers without limbs stop there.
        for (const mesh of bark) {
            const tree = assets.trees[mesh.name.slice('SummerBark '.length)];
            expect(tree, mesh.name).toBeDefined();
            const drawn = Math.min(tree.bark.index.count, tree.bark.drawRange.count);
            expect(drawn, tree.name).toBe(tier.limbs ? tree.bark.index.count : tree.barkCoreIndices);
        }
        // Every spray draw has its own material: the instance buffers are part of its graph.
        expect(new Set(sprays.map((mesh) => mesh.material)).size).toBe(sprays.length);
        expect(sprays.every((mesh) => mesh.material.side === THREE.DoubleSide)).toBe(true);

        // The far shores and the air.
        const [farTrees] = named(world.group, 'SummerFarShore');
        expect(farTrees.isInstancedMesh).toBe(true);
        expect(farTrees.count).toBe(world.backdrop.count);
        expect(world.backdrop.count).toBeGreaterThan(tier.farTrees * 0.8);
        expect(world.backdrop.count).toBeLessThanOrEqual(tier.farTrees);
        expect(named(world.group, 'SummerRidges')).toHaveLength(1);
        expect(named(world.group, 'SummerSky')).toHaveLength(1);
        expect(named(world.group, /^SummerMistBank /)).toHaveLength(tier.mist);
        expect(count(world.group, 'SummerPollen')).toBe(tier.motes);

        // The meadow: all grass in one material and all flowers in another, whatever their
        // kind or level of detail.
        const grass = named(world.meadow.group, /^SummerGrass /);
        const flowers = named(world.meadow.group, /^SummerFlower /);
        expect(drawables(world.meadow.group)).toHaveLength(grass.length + flowers.length);
        expect(sum(grass.map((mesh) => mesh.count))).toBe(world.meadow.stats.grass);
        expect(world.meadow.stats.grass).toBeGreaterThan((tier.grassNear + tier.grassFar) * 0.8);
        expect(world.meadow.stats.grass).toBeLessThanOrEqual(tier.grassNear + tier.grassFar);
        expect(sum(flowers.map((mesh) => mesh.count))).toBe(world.meadow.stats.flowers);
        expect(world.meadow.stats.flowers).toBeGreaterThan((tier.flowersNear + tier.flowersFar) * 0.8);
        expect(world.meadow.stats.flowers).toBeLessThanOrEqual(tier.flowersNear + tier.flowersFar);
        expect(new Set(grass.map((mesh) => mesh.material)).size).toBe(1);
        expect(new Set(flowers.map((mesh) => mesh.material)).size).toBe(1);
        expect(flowers[0].material).toBe(world.meadow.flowerMaterial);
        // Every kind is counted, and each of the seven a piece can call on really grows there.
        expect(sum(Object.values(world.meadow.census))).toBe(world.meadow.stats.flowers);
        for (const flower of SUMMER_FLOWERS.filter((kind) => kind.piece)) {
            expect(world.meadow.census[flower.id], flower.id).toBeGreaterThan(0);
        }

        // The water's edge: reeds in the shallows, lilies planted with the meadow's own shader.
        expect(count(world.shore.group, 'SummerReeds')).toBe(world.shore.stats.reeds);
        expect(world.shore.stats.reeds).toBeGreaterThan(tier.reeds * 0.5);
        expect(world.shore.stats.reeds).toBeLessThanOrEqual(tier.reeds);
        const lilies = named(world.shore.group, /^SummerLilies /);
        expect(sum(lilies.map((mesh) => mesh.count))).toBe(world.shore.stats.lilies);
        expect(world.shore.stats.lilies).toBeGreaterThan(0);
        expect(world.shore.stats.lilies).toBeLessThanOrEqual(tier.lilies);
        for (const mesh of lilies) expect(mesh.material).toBe(world.meadow.flowerMaterial);

        // The things people made.
        for (const prop of ['cottage', 'shed', 'maypole', 'jetty', 'rowboat', 'flagpole', 'pennant',
            'maypole ribbons', 'fence']) {
            expect(named(world.homestead.group, `Summer ${prop}`), prop).toHaveLength(1);
        }
        expect(world.homestead.boat).toBe(named(world.group, 'Summer rowboat')[0]);
        // Someone has the stove lit, since the pack says where the chimney ends.
        expect(summerPropRecord('cottage').anchors.chimneyTop).toHaveLength(3);
        expect(named(world.homestead.group, 'Summer chimney smoke')).toHaveLength(1);
        expect(named(world.homestead.group, 'Summer chimney smoke')[0].isInstancedMesh).toBe(true);
        const boulders = named(world.group, /^Summer boulder_/);
        expect(sum(boulders.map((mesh) => mesh.count))).toBeGreaterThanOrEqual(8);
        expect(sum(boulders.map((mesh) => mesh.count))).toBeLessThanOrEqual(tier.rocks);
        // One shader paints every prop; the maypole has its own, whose flowers are lanterns.
        const paint = new Set(named(world.group, /^Summer (cottage|shed|jetty|rowboat|fence|boulder_[abc])$/)
            .map((mesh) => mesh.material));
        expect(paint.size).toBe(1);
        expect(paint.has(named(world.group, 'Summer maypole')[0].material)).toBe(false);
        expect(world.homestead.uFlash.value).toBe(0);

        // What lives in the air.
        expect(world.life.butterflies).toBe(tier.butterflies);
        expect(world.life.swallows).toBe(tier.birds);
        expect(named(world.group, 'SummerButterflies').map((mesh) => mesh.count))
            .toEqual(tier.butterflies ? [tier.butterflies] : []);
        expect(named(world.group, 'SummerSwallows').map((mesh) => mesh.count)).toEqual(tier.birds ? [tier.birds] : []);
        // Ribbons are built, and hidden until a combo calls them.
        const ribbons = named(world.group, /^SummerGarland /);
        expect(ribbons).toHaveLength(tier.ribbons);
        expect(world.garlands.uLevel.value).toBe(0);

        // Petals, seed and pollen: two draws fed by the simulation's own buffers.
        const { sim } = world.petals;
        expect(sim.count).toBe(tier.petals);
        expect(sim.ambient + sim.reserve).toBe(tier.petals);
        expect(sim.ambient).toBeGreaterThan(0);
        expect(sim.reserve).toBeGreaterThan(sim.ambient);
        expect(named(world.group, 'SummerPetals')).toEqual([world.petals.petals]);
        expect(named(world.group, 'SummerDown')).toEqual([world.petals.down]);
        expect(world.petals.petals.count).toBe(tier.petals);
        expect(world.petals.down.count).toBe(tier.petals);
        expect(world.petals.places.array).toBe(sim.outPlace);
        expect(world.petals.looks.array).toBe(sim.outLook);
        for (const buffer of [world.petals.places, world.petals.looks]) {
            expect(buffer.isInstancedBufferAttribute).toBe(true);
            expect(buffer.itemSize).toBe(4);
            expect(buffer.count).toBe(tier.petals);
        }
        expect(allFinite(sim.outPlace) && allFinite(sim.outLook)).toBe(true);
        expect(sim.groundHeight).toBe(summerGroundHeight);

        // The lake: one sheet of water with its pool of rings, and the director that feeds
        // it, the meadow's gusts and the petals.
        const [water] = named(world.group, 'SummerWater');
        expect(world.lake.mesh).toBe(water);
        expect(water.isInstancedMesh).not.toBe(true);
        expect(world.lake.ripples.count).toBe(tier.ripples);
        expect(world.lake.ripples.active()).toBe(0);
        expect(world.light.waves.count).toBe(tier.waves);
        expect(world.light.waves.active()).toBe(0);
        expect(world.director.sim).toBe(sim);
        expect(world.director.ripples).toBe(world.lake.ripples);
        expect(world.director.waves).toBe(world.light.waves);
        expect(world.director.stage).toBe(world.stage);
        expect(world.director.groundHeight).toBe(summerGroundHeight);

        const diagnostics = world.getDiagnostics();
        expect(diagnostics).toEqual({
            quality,
            ...stats,
            ...world.meadow.stats,
            ...world.shore.stats,
            farTrees: world.backdrop.count,
            butterflies: tier.butterflies,
            swallows: tier.birds,
            petals: { ambient: sim.ambient, reserve: sim.reserve, live: 0 },
            rings: 0,
            waves: 0,
        });
        for (const key of COUNTS) {
            expect(Number.isInteger(diagnostics[key]) && diagnostics[key] >= 0, key).toBe(true);
        }

        expect(camera.fov).toBe(SUMMER_VIEWS.landscape.fov);
        expect(allFinite(Float64Array.from(camera.projectionMatrix.elements))).toBe(true);
        expect(allFinite(Float64Array.from(camera.matrixWorld.elements))).toBe(true);
        expect(world.stage.board).toEqual(SUMMER_DEFAULT_BOARD);
    });

    it.each(BUILT)('puts the scenery of %s in the mirror of the lake, and keeps out what it never shows', (quality) => {
        const { world, camera, assets } = meadow[quality];
        const scenery = MIRRORED.flatMap((part) => {
            const objects = [];
            world[part].group.traverse((object) => objects.push([part, object]));
            return objects;
        });
        const flagged = [];
        for (const [part, object] of scenery) {
            // In the mirror unless it says it can never be seen there.
            const unmirrored = object.userData?.unmirrored === true;
            expect(object.layers.isEnabled(SUMMER_MIRROR_LAYER), `${part}: ${object.name}`).toBe(!unmirrored);
            // Still drawn by the main camera as well.
            expect(object.layers.isEnabled(0), `${part}: ${object.name}`).toBe(true);
            if (unmirrored) flagged.push(object);
        }
        expect(scenery.length - flagged.length).toBeGreaterThan(40);
        // Only draws of the woods ever opt out, and every one of them says which it is.
        const woods = drawables(world.forest.group);
        expect(flagged.every((object) => woods.includes(object))).toBe(true);
        for (const mesh of woods) expect(typeof mesh.userData.unmirrored, mesh.name).toBe('boolean');

        // A draw is kept out exactly when every tree in it stands behind the near shore.
        const { placements } = world.forest;
        const treesOf = (mesh) => {
            if (mesh.name.startsWith('SummerBark ')) {
                const asset = mesh.name.slice('SummerBark '.length);
                return placements.filter((tree) => tree.asset === asset);
            }
            const kind = mesh.name.slice('SummerFoliage '.length).replace(/_\d+$/, '');
            return placements.filter((tree) => assets.trees[tree.asset].foliage === kind);
        };
        for (const mesh of woods) {
            const trees = treesOf(mesh);
            expect(trees.length, mesh.name).toBeGreaterThan(0);
            expect(mesh.userData.unmirrored, mesh.name).toBe(trees.every(standsBehindTheShore));
            // A stand that reaches a far shore, the cove or the skerry is always mirrored.
            if (trees.some((tree) => tree.far || summerShores(tree.x, tree.z).near <= 0)) {
                expect(mesh.userData.unmirrored, mesh.name).toBe(false);
                expect(mesh.layers.isEnabled(SUMMER_MIRROR_LAYER), mesh.name).toBe(true);
            }
        }
        // Whatever is kept out really cannot show in the water: each of its trees is rooted
        // on the camera's bank, further from the waterline than its own limbs reach.
        expect(flagged.length).toBeGreaterThan(0);
        for (const mesh of flagged) {
            for (const tree of treesOf(mesh)) {
                const where = `${mesh.name}: ${tree.asset} at ${tree.x}, ${tree.z}`;
                const { min, max } = assets.trees[tree.asset].bark.boundingBox;
                const reach = Math.max(-min.x, max.x, -min.z, max.z) * tree.scale;
                expect(tree.far, where).not.toBe(true);
                expect(summerShores(tree.x, tree.z).near, where).toBeGreaterThan(reach);
            }
        }
        // That is the two framing trees, which carry more of the forest than all the rest.
        for (const tree of SUMMER_FEATURE_TREES.filter((entry) => assets.trees[entry.asset].role === 'hero')) {
            const { foliage } = assets.trees[tree.asset];
            expect(named(world.forest.group, `SummerBark ${tree.asset}`)[0].userData.unmirrored, tree.asset).toBe(true);
            for (const spray of named(world.forest.group, new RegExp(`^SummerFoliage ${foliage}_`))) {
                expect(spray.userData.unmirrored, spray.name).toBe(true);
            }
        }

        // The meadow is not mirrored at all ...
        let unreflected = 0;
        world.meadow.group.traverse((object) => {
            expect(object.layers.isEnabled(SUMMER_MIRROR_LAYER), `meadow: ${object.name}`).toBe(false);
            unreflected += 1;
        });
        expect(unreflected).toBeGreaterThan(4);
        // ... and the water and the mirror's own target are not reflected in themselves.
        world.lake.group.traverse((object) => {
            expect(object.layers.isEnabled(SUMMER_MIRROR_LAYER), `lake: ${object.name}`).toBe(false);
        });
        expect(world.lake.mesh.layers.mask).toBe(1);
        // Every drawable is accounted for: mirrored, or one of those three exceptions.
        for (const mesh of drawables(world.group)) {
            const excepted = flagged.includes(mesh) || mesh === world.lake.mesh
                || drawables(world.meadow.group).includes(mesh);
            expect(mesh.layers.isEnabled(SUMMER_MIRROR_LAYER), mesh.name).toBe(!excepted);
        }
        // The mirror is a real planar reflection on every tier, and its camera sees only that layer.
        expect(world.lake.reflection).not.toBeNull();
        expect(world.lake.reflection.target.name).toBe('SummerLakeMirror');
        expect(world.lake.reflection.target.parent).toBe(world.lake.group);
        const virtual = world.lake.reflection.reflector.getVirtualCamera(camera);
        expect(virtual.layers.mask).toBe(1 << SUMMER_MIRROR_LAYER);
        // The player's camera is left as it was: it sees the default layer, lake included.
        expect(camera.layers.mask).toBe(1);
        expect(SUMMER_MIRROR_LAYER).toBeGreaterThan(0);
    });

    it('keeps the same evening and draws less of it as the tier drops', () => {
        for (let index = 1; index < BUILT.length; index++) {
            const cheaper = meadow[BUILT[index]].world;
            const dearer = meadow[BUILT[index - 1]].world;
            const less = cheaper.getDiagnostics();
            const more = dearer.getDiagnostics();
            // Nothing ever rises ...
            for (const key of [...COUNTS, 'foliageTriangles', 'barkTriangles', 'grassTriangles', 'flowerTriangles']) {
                expect(less[key], `${BUILT[index]}.${key}`).toBeLessThanOrEqual(more[key]);
            }
            expect(less.petals.ambient + less.petals.reserve).toBeLessThan(more.petals.ambient + more.petals.reserve);
            // ... and the headline numbers really do step down.
            for (const key of ['trees', 'sprays', 'grass', 'flowers', 'reeds', 'farTrees']) {
                expect(less[key], `${BUILT[index]}.${key}`).toBeLessThan(more[key]);
            }
            // The numbers come from the one tier table.
            expect(less.petals.ambient + less.petals.reserve).toBe(SUMMER_TIERS[BUILT[index]].petals);
            expect(cheaper.lake.ripples.count).toBeLessThanOrEqual(dearer.lake.ripples.count);
            expect(cheaper.light.waves.count).toBeLessThanOrEqual(dearer.light.waves.count);
            expect(drawables(cheaper.group).length).toBeLessThanOrEqual(drawables(dearer.group).length);
            expect(count(cheaper.group, 'SummerPollen')).toBeLessThan(count(dearer.group, 'SummerPollen'));
            // Changing quality must not rearrange the woods: same seed, same trees, fewer of them.
            const kept = cheaper.forest.placements;
            expect(dearer.forest.placements.slice(0, kept.length)).toEqual(kept);
        }
        // High keeps the limbs of the bark; Low and Minimal draw trunks only.
        expect(SUMMER_TIERS.High.limbs).toBe(true);
        expect(SUMMER_TIERS.Low.limbs).toBe(false);
        expect(meadow.Low.world.getDiagnostics().barkTriangles)
            .toBeLessThan(meadow.High.world.getDiagnostics().barkTriangles / 2);
    });

    it('stands everything on the same analytic land', () => {
        const { world, camera } = meadow.High;
        const ground = world.terrain.mesh.geometry.attributes.position;
        let worst = 0;
        const span = {
            minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        };
        for (let index = 0; index < ground.count; index++) {
            const expected = summerGroundHeight(ground.getX(index), ground.getZ(index));
            worst = Math.max(worst, Math.abs(ground.getY(index) - expected));
            span.minX = Math.min(span.minX, ground.getX(index));
            span.maxX = Math.max(span.maxX, ground.getX(index));
            span.minZ = Math.min(span.minZ, ground.getZ(index));
            span.maxZ = Math.max(span.maxZ, ground.getZ(index));
        }
        expect(worst).toBeLessThan(1e-4);
        expect(span).toEqual(SUMMER_BOUNDS);
        expect(world.terrain.height(3, -20)).toBe(summerGroundHeight(3, -20));
        // Every trunk is rooted a little way into the ground under it, never above it ...
        const trunks = instances(named(world.group, /^SummerBark /));
        expect(trunks).toHaveLength(world.forest.stats.trees);
        for (const trunk of trunks) {
            const sunk = summerGroundHeight(trunk.x, trunk.z) - trunk.y;
            expect(sunk, `${trunk.mesh} at ${trunk.x}, ${trunk.z}`).toBeGreaterThanOrEqual(0);
            expect(sunk, `${trunk.mesh} at ${trunk.x}, ${trunk.z}`).toBeLessThan(0.2);
        }
        // ... and on dry land: the stands and the trees placed by hand alike.
        for (const tree of world.forest.placements) {
            expect(tree.y, `${tree.asset} at ${tree.x}, ${tree.z}`).toBeGreaterThan(0);
            expect(summerShoreDistance(tree.x, tree.z), `${tree.asset} at ${tree.x}, ${tree.z}`).toBeGreaterThan(0);
        }
        // Grass and flowers are rooted in the turf of the camera's bank, clear of the water.
        const plants = [...named(world.meadow.group, /^SummerGrass /), ...named(world.meadow.group, /^SummerFlower /)];
        for (const mesh of plants) {
            const rooted = roots(mesh);
            for (let index = 0; index < rooted.length; index += 23) {
                const root = rooted[index];
                const sunk = summerGroundHeight(root.x, root.z) - root.y;
                expect(sunk, mesh.name).toBeGreaterThanOrEqual(0);
                expect(sunk, mesh.name).toBeLessThan(0.1);
                expect(summerShores(root.x, root.z).near, mesh.name).toBeGreaterThan(0);
                expect(root.y, mesh.name).toBeGreaterThan(0);
            }
        }
        // Water lilies float on the lake, a little way out from a shore.
        for (const mesh of named(world.shore.group, /^SummerLilies /)) {
            for (const pad of roots(mesh)) {
                expect(summerShoreDistance(pad.x, pad.z), mesh.name).toBeLessThan(0);
                expect(summerGroundHeight(pad.x, pad.z), mesh.name).toBeLessThan(0);
                expect(Math.abs(pad.y), mesh.name).toBeLessThan(0.05);
            }
        }
        // Reeds stand in the shallows or at the very edge; none floats and none is drowned.
        const reeds = instances(named(world.group, 'SummerReeds'));
        expect(reeds).toHaveLength(world.shore.stats.reeds);
        for (let index = 0; index < reeds.length; index += 5) {
            const reed = reeds[index];
            const floor = summerGroundHeight(reed.x, reed.z);
            expect(reed.y).toBeGreaterThanOrEqual(Math.min(0, floor) - 0.05);
            expect(reed.y).toBeLessThanOrEqual(Math.max(0, floor) + 1e-6);
            expect(Math.abs(summerShoreDistance(reed.x, reed.z))).toBeLessThan(4);
        }
        // Far trees stand on land beyond the water, never in the foreground.
        for (const card of instances(named(world.group, 'SummerFarShore'))) {
            expect(summerShoreDistance(card.x, card.z)).toBeGreaterThan(0);
            expect(Math.hypot(card.x - camera.position.x, card.z - camera.position.z)).toBeGreaterThan(40);
        }
        // Boulders are bedded into whatever is under them, shallows included.
        for (const stone of instances(named(world.group, /^Summer boulder_/))) {
            expect(stone.y).toBeLessThan(summerGroundHeight(stone.x, stone.z));
            expect(stone.y).toBeGreaterThan(summerGroundHeight(stone.x, stone.z) - 1);
        }
        // Ambient down hangs over the meadow and the near water, never under the ground.
        const { sim } = world.petals;
        for (let index = 0; index < sim.ambient; index++) {
            expect(sim.outPlace[index * 4 + 1]).toBeGreaterThan(0);
        }
        // The far plane holds the sky dome.
        expect(camera.far).toBeGreaterThan(world.atmosphere.sky.geometry.parameters.radius);
    });

    // Regression: the cottage was once placed on the slope of its promontory, one corner in
    // the air. A building stands on ground the terrain has levelled for it.
    it.each(['cottage', 'shed'])('stands the %s on level ground, bedded into it and never floating', (name) => {
        const { world } = meadow.High;
        const place = SUMMER_PLACES[name];
        const record = summerPropRecord(name);
        const [mesh] = named(world.homestead.group, `Summer ${name}`);
        // The mesh is where the place says, turned as it says, at its modelled size ...
        expect(mesh.position.x).toBe(place.x);
        expect(mesh.position.z).toBe(place.z);
        expect(mesh.rotation.toArray().slice(0, 3)).toEqual([0, place.yaw, 0]);
        expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
        // ... and the footprint sampled below is the footprint of what is drawn.
        for (let axis = 0; axis < 3; axis++) {
            expect(mesh.geometry.boundingBox.min.getComponent(axis)).toBeCloseTo(record.boundsMin[axis], 3);
            expect(mesh.geometry.boundingBox.max.getComponent(axis)).toBeCloseTo(record.boundsMax[axis], 3);
        }
        const corner = new THREE.Vector3(record.boundsMax[0], 0, record.boundsMin[2]).applyMatrix4(mesh.matrix);
        const expected = placedPoint(place, record.boundsMax[0], record.boundsMin[2]);
        expect(corner.x).toBeCloseTo(expected.x, 9);
        expect(corner.z).toBeCloseTo(expected.z, 9);

        const points = footprint(name);
        expect(points.length).toBeGreaterThan(200);
        const heights = points.map((point) => summerGroundHeight(point.x, point.z));
        // Level: a few centimetres between the highest and the lowest ground under it.
        expect(Math.max(...heights) - Math.min(...heights), `${name}: ground spread`).toBeLessThan(0.05);
        // That level ground is a terrace the terrain carries for it, above the lake.
        const terrace = terraceUnder(place);
        expect(terrace, `${name} stands on no terrace`).toBeDefined();
        expect(terrace.height).toBeGreaterThan(0);
        expect(Math.abs(summerGroundHeight(place.x, place.z) - terrace.height)).toBeLessThan(0.05);
        // The lowest thing of the building (its plinth, at its origin plane) ...
        const base = mesh.position.y + record.boundsMin[1];
        points.forEach((point, index) => {
            const where = `${name} at ${point.x.toFixed(2)}, ${point.z.toFixed(2)}`;
            // ... is on land everywhere,
            expect(summerShoreDistance(point.x, point.z), where).toBeGreaterThan(0);
            expect(heights[index], where).toBeGreaterThan(0);
            // never above the ground under it,
            expect(base, where).toBeLessThanOrEqual(heights[index]);
            // and bedded no more than a hand deep.
            expect(heights[index] - base, where).toBeLessThanOrEqual(0.1);
        });
    });

    // Regression: the boathouse once stood between the camera and the red cottage. From
    // where the player stands nothing of it may come in front of the house.
    it.each(
        Object.entries(SUMMER_VIEWS),
    )('keeps the boathouse clear of the cottage in the %s framing', (_name, view) => {
        const [eyeX, , eyeZ] = summerEye(view);
        const span = (name) => {
            const bearings = footprint(name).map((point) => {
                // Both stand out in front of the camera, so a bearing never wraps.
                expect(eyeZ - point.z, name).toBeGreaterThan(0);
                return THREE.MathUtils.radToDeg(Math.atan2(point.x - eyeX, eyeZ - point.z));
            });
            return { from: Math.min(...bearings), to: Math.max(...bearings) };
        };
        const cottage = span('cottage');
        const shed = span('shed');
        expect(cottage.to).toBeGreaterThan(cottage.from);
        expect(shed.to).toBeGreaterThan(shed.from);
        // Side by side with clear water or grass between them: a degree and a half at least.
        const gap = Math.max(cottage.from - shed.to, shed.from - cottage.to);
        expect(gap, `cottage ${cottage.from.toFixed(1)}..${cottage.to.toFixed(1)} deg, `
            + `boathouse ${shed.from.toFixed(1)}..${shed.to.toFixed(1)} deg`).toBeGreaterThanOrEqual(1.5);
    });

    // Regression: the maypole is placed so that, from where the player stands, the sun is
    // seen through its right-hand wreath. Moving the pole, the camera or the sun breaks it.
    it('shows the sun through the maypole\'s right-hand wreath from the resting camera', () => {
        const { world } = meadow.High;
        const place = SUMMER_PLACES.maypole;
        const { anchors } = summerPropRecord('maypole');
        const [, wreath] = world.homestead.bouquetAnchors().wreaths;
        // The wreath is where the pack's anchor lands once the pole is turned and stood on its ground.
        const spot = placedPoint(place, anchors.wreathRight[0], anchors.wreathRight[2]);
        expect(wreath.x).toBeCloseTo(spot.x, 9);
        expect(wreath.z).toBeCloseTo(spot.z, 9);
        expect(wreath.y).toBeCloseTo(summerGroundHeight(place.x, place.z) + anchors.wreathRight[1], 9);
        // How far off the line of sight to the wreath's middle the sun stands, and how large
        // the wreath's ring looks from there (both as angles, in degrees).
        const sight = (view) => {
            const toWreath = wreath.clone().sub(new THREE.Vector3(...summerEye(view)));
            return {
                off: THREE.MathUtils.radToDeg(toWreath.angleTo(SUMMER_SUN_DIRECTION)),
                ring: THREE.MathUtils.radToDeg(Math.atan(anchors.wreathRadius / toWreath.length())),
            };
        };
        // Landscape: the sun's middle is in the wreath's middle to within half a degree, and
        // the ring is wide enough to hold the whole disc.
        const landscape = sight(SUMMER_VIEWS.landscape);
        expect(landscape.off, `sun ${landscape.off.toFixed(2)} deg off the wreath's middle`).toBeLessThan(0.5);
        expect(landscape.ring).toBeGreaterThan(SUMMER_SUN_RADIUS_DEGREES);
        // Portrait stands a little further back: the sun's middle is still inside the ring.
        const portrait = sight(SUMMER_VIEWS.portrait);
        expect(portrait.off, `sun ${portrait.off.toFixed(2)} deg off, ring ${portrait.ring.toFixed(2)} deg`)
            .toBeLessThan(portrait.ring);
    });

    // Regression: the camera once looked down far enough to cut the maypole's leafy crown off
    // at the top of the frame.
    it('keeps the whole maypole, crown and foot, inside the landscape frame', () => {
        const place = SUMMER_PLACES.maypole;
        const { boundsMax } = summerPropRecord('maypole');
        const view = SUMMER_VIEWS.landscape;
        const foot = summerGroundHeight(place.x, place.z);
        // The frame's height does not depend on its width: one aspect ratio stands for all.
        const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.25, 3600);
        camera.position.set(...summerEye(view));
        camera.lookAt(...view.target);
        camera.updateMatrixWorld(true);
        const seen = (height) => new THREE.Vector3(place.x, foot + height, place.z).project(camera);
        const crown = seen(boundsMax[1]);
        // Headroom above the crown, and the pole standing in the left half, clear of the edge.
        expect(crown.y, `crown at ${crown.y.toFixed(3)} of the frame's half-height`).toBeLessThan(0.94);
        expect(crown.y).toBeGreaterThan(0.6);
        expect(seen(0).y).toBeGreaterThan(-0.8);
        expect(crown.x).toBeGreaterThan(-0.9);
        expect(crown.x).toBeLessThan(-0.2);
    });

    it('roots the maypole on its dance ground and hangs its ribbons and bouquet from the pack\'s anchors', () => {
        const { world } = meadow.High;
        const place = SUMMER_PLACES.maypole;
        const { anchors, boundsMin } = summerPropRecord('maypole');
        const [pole] = named(world.homestead.group, 'Summer maypole');
        expect(pole.position.x).toBe(place.x);
        expect(pole.position.z).toBe(place.z);
        // Its foot is on land, with the whole mown ring of the dance around it.
        const foot = summerGroundHeight(place.x, place.z);
        expect(foot).toBeGreaterThan(0);
        expect(summerShoreDistance(place.x, place.z)).toBeGreaterThan(place.ring);
        expect(summerShores(place.x, place.z).near).toBeGreaterThan(place.ring);
        // It stands on the terrace levelled for the dance: the ground under the pole is that
        // terrace's height, and the mown ring is flat from edge to edge.
        const terrace = terraceUnder(place);
        expect(terrace, 'the maypole stands on no terrace').toBeDefined();
        expect(foot).toBeCloseTo(terrace.height, 9);
        expect(terrace.radius).toBeGreaterThanOrEqual(place.ring);
        for (let step = 0; step < 24; step++) {
            const angle = (step / 24) * Math.PI * 2;
            const x = place.x + Math.cos(angle) * place.ring * 0.98;
            const z = place.z + Math.sin(angle) * place.ring * 0.98;
            expect(summerGroundHeight(x, z), `ring at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeCloseTo(foot, 6);
        }
        // Nobody dances round a tree: no trunk stands inside the mown ring, hand-placed or sown.
        for (const tree of [...SUMMER_FEATURE_TREES, ...world.forest.placements]) {
            const trunk = world.assets.trees[tree.asset].trunkRadius * tree.scale;
            expect(Math.hypot(tree.x - place.x, tree.z - place.z) - trunk, `${tree.asset} at ${tree.x}, ${tree.z}`)
                .toBeGreaterThan(place.ring);
        }
        // It stands on the ground, its pole going into it.
        expect(pole.position.y).toBeLessThanOrEqual(foot);
        expect(foot - pole.position.y).toBeLessThan(0.1);
        expect(pole.position.y + boundsMin[1]).toBeLessThan(foot);
        // The bouquet is thrown from the top and the two wreaths of the mesh as it stands.
        const bouquet = world.homestead.bouquetAnchors();
        const at = (key) => new THREE.Vector3(...anchors[key]).applyMatrix4(pole.matrix);
        expect(bouquet.top.distanceTo(at('top'))).toBeLessThan(1e-9);
        expect(bouquet.wreaths).toHaveLength(2);
        expect(bouquet.wreaths[0].distanceTo(at('wreathLeft'))).toBeLessThan(1e-9);
        expect(bouquet.wreaths[1].distanceTo(at('wreathRight'))).toBeLessThan(1e-9);
        expect(world.director.maypole).toEqual(bouquet);
        expect(bouquet.top.y).toBeGreaterThan(foot + 5);
        for (const wreath of bouquet.wreaths) {
            expect(wreath.y).toBeGreaterThan(foot + 3);
            expect(wreath.y).toBeLessThan(bouquet.top.y);
            // A wreath hangs over the mown ring, not out over the lake.
            expect(summerShoreDistance(wreath.x, wreath.z)).toBeGreaterThan(0);
        }
        expect(bouquet.wreaths[0].distanceTo(bouquet.wreaths[1])).toBeGreaterThan(2);
    });

    it('runs the jetty from the bank out over the lake and floats the boat beside it', () => {
        const { world } = meadow.High;
        const [jetty] = named(world.homestead.group, 'Summer jetty');
        const { boat } = world.homestead;
        const { boundsMin } = summerPropRecord('rowboat');
        // The jetty's deck is level with the lake's datum; its root is on the bank ...
        expect(jetty.position.y).toBe(0);
        expect(jetty.position.x).toBe(SUMMER_PLACES.jetty.x);
        expect(jetty.position.z).toBe(SUMMER_PLACES.jetty.z);
        expect(summerShoreDistance(jetty.position.x, jetty.position.z)).toBeGreaterThan(0);
        // ... and its far end is over open water, deep enough to need its piles.
        const end = world.homestead.anchor('jetty', 'end');
        expect(end).not.toBeNull();
        expect(end.distanceTo(new THREE.Vector3(...summerPropRecord('jetty').anchors.end).applyMatrix4(jetty.matrix)))
            .toBeLessThan(1e-9);
        expect(summerShoreDistance(end.x, end.z)).toBeLessThan(-2);
        expect(summerGroundHeight(end.x, end.z)).toBeLessThan(-0.5);
        expect(end.y).toBeGreaterThan(0);
        // It points away from the camera's bank, out toward the lake.
        expect(end.z).toBeLessThan(jetty.position.z - 5);
        // Most of it stands in water.
        const middle = new THREE.Vector3().lerpVectors(jetty.position, end, 0.5);
        expect(summerGroundHeight(middle.x, middle.z)).toBeLessThan(0);

        // The rowboat floats: over water deep enough for its hull, riding at the surface.
        expect(boat.position.x).toBe(SUMMER_PLACES.boat.x);
        expect(boat.position.z).toBe(SUMMER_PLACES.boat.z);
        expect(summerShoreDistance(boat.position.x, boat.position.z)).toBeLessThan(-2);
        expect(summerGroundHeight(boat.position.x, boat.position.z)).toBeLessThan(boundsMin[1] - 0.5);
        expect(Math.abs(boat.position.y)).toBeLessThan(0.05);
    });

    it('reproduces the same world for the same seed', async () => {
        const first = meadow.Minimal.world;
        const assets = await loadBundle();
        const { world: second } = createWorld('Minimal', assets);
        const { world: other } = createWorld('Minimal', assets, { seed: 12345 });
        second.build();
        expect(second.forest.placements).toEqual(first.forest.placements);
        expect(second.getDiagnostics()).toEqual(first.getDiagnostics());
        expect(second.meadow.census).toEqual(first.meadow.census);
        const firstMeshes = drawables(first.group);
        const secondMeshes = drawables(second.group);
        expect(secondMeshes.map((mesh) => mesh.name)).toEqual(firstMeshes.map((mesh) => mesh.name));
        secondMeshes.forEach((mesh, index) => {
            if (!mesh.isInstancedMesh) return;
            expect(mesh.count).toBe(firstMeshes[index].count);
            expect(mesh.instanceMatrix.array).toEqual(firstMeshes[index].instanceMatrix.array);
            // Grass and flowers carry their places as instance data, not matrices.
            const { aRoot } = mesh.geometry.attributes;
            if (aRoot) expect(aRoot.array).toEqual(firstMeshes[index].geometry.attributes.aRoot.array);
        });
        expect(second.petals.sim.outPlace).toEqual(first.petals.sim.outPlace);
        expect(second.petals.sim.home).toEqual(first.petals.sim.home);
        // Another seed plants other stands on the same shores, around the same hand-placed trees.
        second.dispose();
        other.build();
        expect(other.forest.placements).not.toEqual(first.forest.placements);
        expect(other.forest.placements.slice(0, SUMMER_FEATURE_TREES.length))
            .toEqual(first.forest.placements.slice(0, SUMMER_FEATURE_TREES.length));
        // The buildings do not move with the seed.
        for (const prop of ['cottage', 'shed', 'maypole', 'jetty']) {
            const [here] = named(first.group, `Summer ${prop}`);
            const [there] = named(other.group, `Summer ${prop}`);
            expect(there.matrix.equals(here.matrix), prop).toBe(true);
        }
    }, SLOW);

    it.each([
        ['landscape', LANDSCAPE, 'landscape'], ['ultrawide', 21 / 9, 'landscape'], ['square', 1, 'landscape'],
        ['just wide enough', 0.85, 'landscape'], ['just too narrow', 0.849, 'portrait'],
        ['tall tablet', 3 / 4, 'portrait'], ['portrait', PORTRAIT, 'portrait'],
    ])('frames the camera and the stage for a %s screen', (_label, aspect, framing) => {
        const { world, camera } = meadow.Minimal;
        const restore = camera.aspect;
        try {
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            world.prepareCamera(aspect);
            // Tall screens get the portrait framing, everything from 0.85 up the landscape one.
            const view = SUMMER_VIEWS[framing];
            expect(summerViewFor(aspect)).toBe(view);
            expect(camera.fov).toBe(view.fov);
            expect(camera.near).toBeGreaterThan(0);
            expect(camera.far).toBeGreaterThan(3000);
            expect(camera.position.x).toBe(view.position[0]);
            expect(camera.position.z).toBe(view.position[2]);
            // The camera stands in the meadow: on land, at eye height above the ground under it.
            const floor = summerGroundHeight(camera.position.x, camera.position.z);
            expect(floor).toBeGreaterThan(0);
            expect(summerShores(camera.position.x, camera.position.z).near).toBeGreaterThan(0);
            expect(camera.position.y).toBeCloseTo(floor + view.position[1], 12);
            expect(camera.position.y).toBeGreaterThan(floor + 1);
            expect(camera.position.toArray()).toEqual(summerEye(view));
            const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
            expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-9);
            // It looks out over the lake, not back up the hill.
            expect(towards.z).toBeLessThan(0);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
            expect(camera.projectionMatrixInverse.elements.every(Number.isFinite)).toBe(true);
            // The stage follows: the board centre projects back onto the middle of the default card.
            const { stage } = world;
            const centre = stage.centre().project(camera);
            expect(centre.x).toBeCloseTo((SUMMER_DEFAULT_BOARD.x0 + SUMMER_DEFAULT_BOARD.x1) - 1, 9);
            expect(centre.y).toBeCloseTo(1 - (SUMMER_DEFAULT_BOARD.y0 + SUMMER_DEFAULT_BOARD.y1), 9);
            const halfHeight = SUMMER_STAGE_DEPTH * Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
            expect(stage.halfWidth()).toBeCloseTo(halfHeight * aspect, 9);
            // And so do the ribbons a combo winds around the board.
            const middle = stage.centre();
            expect(world.garlands.uBoard.value.x).toBeCloseTo(middle.x, 9);
            expect(world.garlands.uBoard.value.y).toBeCloseTo(middle.y, 9);
            expect(world.garlands.uBoard.value.z).toBeCloseTo(middle.z, 9);
            expect(world.garlands.uBoard.value.w).toBeGreaterThan(0);
            // Re-framing is repeatable and never moves the camera twice.
            const pose = camera.matrixWorld.clone();
            const stageBefore = world.stage;
            world.prepareCamera(aspect);
            expect(camera.matrixWorld.equals(pose)).toBe(true);
            expect(world.stage).toBe(stageBefore);
            // The mirror goes on seeing only its own layer through the re-framed camera.
            expect(world.lake.reflection.reflector.getVirtualCamera(camera).layers.mask)
                .toBe(1 << SUMMER_MIRROR_LAYER);
        } finally {
            camera.aspect = restore;
            camera.updateProjectionMatrix();
            world.prepareCamera(restore);
        }
    });

    it('falls back to the landscape view for an unusable aspect ratio', () => {
        const { world, camera } = meadow.Minimal;
        const stageBefore = world.stage;
        for (const aspect of [NaN, 0, -1, Infinity, undefined, null, 'wide']) {
            world.prepareCamera(PORTRAIT);
            expect(camera.fov).toBe(SUMMER_VIEWS.portrait.fov);
            world.prepareCamera(aspect);
            expect(camera.fov).toBe(SUMMER_VIEWS.landscape.fov);
            expect(camera.position.z).toBe(SUMMER_VIEWS.landscape.position[2]);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        }
        expect(world.stage).toBe(stageBefore);
    });
});

describe('Summer world in play', () => {
    const rest = (world) => ({
        petals: world.petals.sim.counts().live,
        rings: world.lake.ripples.active(),
        gusts: world.light.waves.active(),
    });

    // `new THREE.Vector4()` is (0, 0, 0, 1): left at its default, lantern 3 would burn and flower
    // slots 3 and 7 would be called on until the first update().
    it('starts with every lantern dark and no flower called on, before any frame has run', async () => {
        const { world } = await buildWorld('Minimal');
        expect(lanterns(world)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(world.homestead.bouquetVectors.map((vector) => vector.toArray())).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
        expect(world.light.speciesVectors.map((vector) => vector.toArray())).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
        // The first frame, and a reset, already leave them that way.
        world.update(0, 0, {});
        const afterFrame = [...world.homestead.bouquetVectors, ...world.light.speciesVectors];
        expect(afterFrame.map((vector) => vector.toArray())).toEqual(new Array(4).fill([0, 0, 0, 0]));
    }, SLOW);

    it('wears the hour of the night the frame names, and the evening when it names none', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const uniforms = { ...light.hourUniforms };
        const close = (key, expected) => light.hourUniforms[key].value.toArray().forEach(
            (channel, index) => expect(channel, `${key}[${index}]`).toBeCloseTo(expected[index], 5),
        );
        const wears = (hour) => {
            for (const key of SUMMER_HOUR_COLOURS) close(key, hour[key]);
            expect(light.uHaze.value).toBeCloseTo(hour.haze, 9);
            expect(light.uLamps.value).toBeCloseTo(hour.lamps, 9);
            expect(light.hour.exposure).toBeCloseTo(hour.exposure, 9);
        };
        // Every colour of the table has a uniform to go to.
        expect(Object.keys(light.hourUniforms).sort()).toEqual([...SUMMER_HOUR_COLOURS].sort());
        // Before any frame, and on a frame that says nothing about the hour: the evening.
        wears(SUMMER_HOURS[0]);
        world.update(0, 0, {});
        wears(SUMMER_HOURS[0]);
        SUMMER_HOURS.forEach((hour, index) => {
            world.update(1, 1 / 60, { hour: index });
            wears(hour);
            expect(light.hour.phase).toBe(index);
        });
        // Between two hours, between their colours; past the last, round to the first again.
        world.update(1, 1 / 60, { hour: 1.5 });
        const [rose, night] = [SUMMER_HOURS[1], SUMMER_HOURS[2]];
        expect(light.uSunColor.value.r).toBeCloseTo((rose.sun[0] + night.sun[0]) / 2, 5);
        expect(light.uLamps.value).toBeCloseTo((rose.lamps + night.lamps) / 2, 9);
        world.update(1, 1 / 60, { hour: SUMMER_HOURS.length + 2 });
        wears(night);
        for (const hour of [NaN, undefined, null, 'night', Infinity]) {
            world.update(1, 0, { hour });
            wears(SUMMER_HOURS[0]);
        }
        // Nothing was rebuilt to change the hour: the uniforms are the ones it was built with.
        world.update(2, 1 / 60, { hour: 2 });
        for (const key of SUMMER_HOUR_COLOURS) expect(light.hourUniforms[key]).toBe(uniforms[key]);
        // The windows burn by the same hour.
        expect(world.homestead.uLamps).toBeUndefined();
        // A haze override (a playground knob) outlasts the hours until it is taken away.
        light.hazeOverride = 0.004;
        world.update(2, 1 / 60, { hour: 3 });
        expect(light.uHaze.value).toBe(0.004);
        close('sun', SUMMER_HOURS[3].sun);
        light.hazeOverride = null;
        world.update(2, 1 / 60, { hour: 3 });
        expect(light.uHaze.value).toBeCloseTo(SUMMER_HOURS[3].haze, 9);
    }, SLOW);

    it('moves the sun with the hour: in the ring of the wreath in the evening, out of it at the others', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const [, wreath] = world.homestead.bouquetAnchors().wreaths;
        const eye = new THREE.Vector3(...summerEye(SUMMER_VIEWS.landscape));
        const toWreath = wreath.clone().sub(eye);
        const { wreathRadius } = summerPropRecord('maypole').anchors;
        const ring = THREE.MathUtils.radToDeg(Math.atan(wreathRadius / toWreath.length()));
        const offRing = () => THREE.MathUtils.radToDeg(toWreath.angleTo(light.uSunDir.value));
        // Built, and at the evening hour: exactly where the evening sun is said to stand.
        expect(light.uSunDir.value.distanceTo(SUMMER_SUN_DIRECTION)).toBeLessThan(1e-12);
        world.update(0, 0, { hour: 0 });
        expect(light.uSunDir.value.distanceTo(SUMMER_SUN_DIRECTION)).toBeLessThan(1e-12);
        expect(offRing()).toBeLessThan(0.5);
        SUMMER_HOURS.forEach((hour, index) => {
            world.update(1, 1 / 60, { hour: index });
            const expected = new THREE.Vector3(...summerSunDirection(hour.sunAzimuth, hour.sunElevation));
            expect(light.uSunDir.value.distanceTo(expected), hour.id).toBeLessThan(1e-12);
            expect(light.uSunDir.value.length()).toBeCloseTo(1, 12);
            // In the ring only in the evening: at the other hours its middle is well outside.
            if (index === 0) expect(offRing(), hour.id).toBeLessThan(0.5);
            else expect(offRing(), hour.id).toBeGreaterThan(ring + 0.5);
        });
        // The sun leaves the ring slowly: the first tenth of the hour keeps it well inside.
        const last = SUMMER_HOURS.length;
        for (const phase of [0.02, 0.05, 0.1, last - 0.1, last - 0.02]) {
            world.update(1, 1 / 60, { hour: phase });
            expect(offRing(), `phase ${phase}`).toBeLessThan(ring * 0.25);
        }
        // And it is back in the middle of the ring when the night has come round.
        world.update(1, 1 / 60, { hour: SUMMER_HOURS.length });
        expect(offRing()).toBeLessThan(0.5);
    }, SLOW);

    it('draws the shadows again when the sun has moved a little way, not on every frame', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const { shadow } = light.sun;
        const lightDirection = () => light.sun.position.clone().sub(light.sun.target.position).normalize();
        world.update(0, 0, { hour: 0 });
        expect(lightDirection().distanceTo(SUMMER_SUN_DIRECTION)).toBeLessThan(1e-9);
        // Let the first frames' redraws pass, as a renderer would.
        for (let frame = 0; frame < 12; frame += 1) world.update(frame / 60, 1 / 60, { hour: 0 });
        shadow.needsUpdate = false;
        // The sun standing still asks for nothing.
        for (let frame = 0; frame < 20; frame += 1) world.update(1, 1 / 60, { hour: 0 });
        expect(shadow.needsUpdate).toBe(false);
        // A move too small to see is not followed.
        world.update(1, 1 / 60, { hour: 0.01 });
        world.update(1, 1 / 60, { hour: 0.01 });
        expect(shadow.needsUpdate).toBe(false);
        expect(lightDirection().distanceTo(SUMMER_SUN_DIRECTION)).toBeLessThan(1e-9);
        // A real move is: the light stands where the sun now is, and the map is asked for.
        world.update(1, 1 / 60, { hour: 1 });
        world.update(1, 1 / 60, { hour: 1 });
        expect(shadow.needsUpdate).toBe(true);
        expect(lightDirection().distanceTo(light.uSunDir.value)).toBeLessThan(1e-9);
        expect(light.sun.target.position.equals(light.shadowCentre)).toBe(true);
        // While the night turns quickly, the shadows follow at most every other frame.
        let redraws = 0;
        for (let frame = 0; frame < 60; frame += 1) {
            shadow.needsUpdate = false;
            world.update(2, 1 / 60, { hour: 1 + frame / 60 });
            if (shadow.needsUpdate) redraws += 1;
        }
        expect(redraws).toBeGreaterThan(10);
        expect(redraws).toBeLessThanOrEqual(30);
        // They never fall far behind the sun the materials are lit by.
        const behind = THREE.MathUtils.radToDeg(lightDirection().angleTo(light.uSunDir.value));
        expect(behind).toBeLessThan(0.4);
        // Standing still again, the last small step is caught up and then nothing more is asked.
        for (let frame = 0; frame < 4; frame += 1) world.update(3, 1 / 60, { hour: 2 });
        expect(lightDirection().distanceTo(light.uSunDir.value)).toBeLessThan(1e-3);
        shadow.needsUpdate = false;
        for (let frame = 0; frame < 10; frame += 1) world.update(3, 1 / 60, { hour: 2 });
        expect(shadow.needsUpdate).toBe(false);
        expect(summerHourAt(2).sunElevation).toBe(SUMMER_HOURS[2].sunElevation);
    }, SLOW);

    it('follows a director through a level-up and its slow night, frame by frame', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5), hourSeconds: 30 });
        advance(world, reactions, 0.5);
        expect(light.hour.phase).toBeCloseTo(0.5 / 30, 6);
        const before = light.uSunColor.value.clone();
        reactions.onLevelUp({ level: 2 });
        advance(world, reactions, 12);
        // One hour for the level and some drift: the rose hour, going on toward the white night.
        expect(light.hour.phase).toBeCloseTo(reactions.getFrame().hour, 9);
        expect(light.hour.phase).toBeGreaterThan(1.3);
        expect(light.hour.phase).toBeLessThan(1.5);
        expect(light.uSunColor.value.g).toBeLessThan(before.g);
        expect(Number.isFinite(light.uSunColor.value.r + light.uZenith.value.b + light.uHaze.value)).toBe(true);
    }, SLOW);

    it('answers a lock with petals of its flower, a ring on the lake, a gust in the meadow and a lantern', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.petals;
        const reactions = new SummerReactions({ quality: 'Low', rng: seededRandom(5) });
        advance(world, reactions, 0.25);
        expect(rest(world)).toEqual({ petals: 0, rings: 0, gusts: 0 });
        expect(lanterns(world)).toEqual([0, 0, 0, 0, 0, 0, 0]);

        // A piece locks at the left edge of the board.
        const kind = SUMMER_PIECE_FLOWERS.Z;
        reactions.onPieceLock({ piece: piece('Z', 0) });
        expect(() => advance(world, reactions, STEP)).not.toThrow();
        const thrown = alight(sim);
        expect(thrown.length).toBeGreaterThan(0);
        expect(world.getDiagnostics().petals.live).toBe(thrown.length);
        const petals = thrown.filter((particle) => particle.kind === PETAL);
        expect(petals.length).toBeGreaterThan(0);
        // Petals of the piece's own flower, released over the heads of the meadow, beside the
        // board's left edge.
        const centre = world.stage.centre();
        for (const petal of petals) {
            expect(petal.flower).toBe(kind);
            expect(petal.x).toBeLessThan(centre.x);
        }
        for (const particle of thrown) {
            expect([particle.x, particle.y, particle.z].every(Number.isFinite)).toBe(true);
            expect(particle.y).toBeGreaterThan(Math.max(0, summerGroundHeight(particle.x, particle.z)));
        }
        // One ring opens on the lake, on water ...
        const rings = under(world.lake.ripples);
        expect(rings).toHaveLength(1);
        expect(summerGroundHeight(rings[0].x, rings[0].z)).toBeLessThan(0);
        expect(world.getDiagnostics().rings).toBe(1);
        // ... and one gust starts in the meadow at the foot of the board, on the camera's bank.
        const gusts = under(world.light.waves);
        expect(gusts).toHaveLength(1);
        expect(summerGroundHeight(gusts[0].x, gusts[0].z)).toBeGreaterThan(0);
        expect(summerShores(gusts[0].x, gusts[0].z).near).toBeGreaterThan(0);
        expect(world.getDiagnostics().waves).toBe(1);
        // That kind of flower is called on wherever it grows, and its lantern lights on the maypole.
        expect(world.light.species[kind]).toBeGreaterThan(0.3);
        expect(Array.from(world.light.species).filter((level) => level > 0)).toHaveLength(1);
        // (The shaders read the eight call levels as two vectors of four.)
        expect(world.light.speciesVectors[kind < 4 ? 0 : 1].getComponent(kind % 4)).toBe(world.light.species[kind]);
        expect(lanterns(world)).toEqual(lanternsOf(['Z']));
        expect(world.homestead.uFlash.value).toBe(0);
        expect(world.lake.uShimmer.value).toBeGreaterThan(0);

        // The ring and the gust age; the petals fly on and come down.
        advance(world, reactions, 0.5);
        expect(under(world.lake.ripples)[0].age).toBeCloseTo(31 * STEP, 6);
        expect(under(world.light.waves)[0].age).toBeCloseTo(31 * STEP, 6);
        expect(alight(sim).slice(0, 3)).not.toEqual(thrown.slice(0, 3));
        advance(world, reactions, 12);
        expect(sim.counts().live).toBe(0);
        expect(under(world.light.waves)).toEqual([]);
    }, SLOW);

    it('answers a line clear with jets from both sides, rings, a gust, a front of wind and wings', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.petals;
        const reactions = new SummerReactions({ quality: 'Low', rng: seededRandom(5) });
        advance(world, reactions, 0.25);
        reactions.onLineClear(2, { clearedRows: [22, 23] });
        expect(() => advance(world, reactions, STEP)).not.toThrow();
        // A broad ring and a second on its heels, both on water; one gust through the grass.
        const rings = under(world.lake.ripples);
        expect(rings).toHaveLength(2);
        for (const ring of rings) expect(summerGroundHeight(ring.x, ring.z)).toBeLessThan(0);
        expect(under(world.light.waves)).toHaveLength(1);
        expect(world.lake.uShimmer.value).toBeGreaterThan(0.3);
        expect(world.life.uFlutter.value).toBeGreaterThan(0);
        expect(world.light.uGust.value).toBeGreaterThan(0);
        // Two lines do not send the swallows up; four do.
        expect(world.life.uStartle.value).toBe(0);

        let front = 0;
        advance(world, reactions, 0.6, () => { front = Math.max(front, world.light.uFront.value.y); });
        // Petals were blown out of both sides of the board ...
        const centre = world.stage.centre();
        const thrown = alight(sim);
        expect(thrown.filter((particle) => particle.x < centre.x).length).toBeGreaterThan(3);
        expect(thrown.filter((particle) => particle.x > centre.x).length).toBeGreaterThan(3);
        // ... and a front of wind is crossing the meadow and the woods.
        expect(front).toBeGreaterThan(0);
        expect(world.director.fields.some((field) => field.kind === 'jet')).toBe(true);

        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        advance(world, reactions, STEP);
        expect(world.life.uStartle.value).toBeGreaterThan(0.9);
        expect(world.light.uWarmth.value).toBeGreaterThan(0.5);
        advance(world, reactions, 1);
        // Four lines lift petals off the whole meadow: more in the air than two lines put there.
        expect(sim.counts().live).toBeGreaterThan(thrown.length);
        expect(alight(sim).every((particle) => Number.isFinite(particle.x + particle.y + particle.z))).toBe(true);
    }, SLOW);

    it('winds the ribbons around the board only while a combo is up', async () => {
        const { world, tier } = await buildWorld('Low');
        const ribbons = world.garlands.group.children;
        const shown = () => ribbons.filter((ribbon) => ribbon.visible).length;
        expect(ribbons).toHaveLength(tier.ribbons);
        // Built hidden, shown at zero strength for the first few frames so no combo compiles
        // their pipelines, then hidden: at rest they cost nothing.
        expect(shown()).toBe(0);
        const reactions = new SummerReactions({ quality: 'Low', rng: seededRandom(5) });
        advance(world, reactions, STEP);
        expect(shown()).toBe(ribbons.length);
        expect(world.garlands.uLevel.value).toBe(0);
        advance(world, reactions, 0.5);
        expect(shown()).toBe(0);
        // Locks and single clears do not call them.
        reactions.onPieceLock({ piece: piece('T') });
        reactions.onLineClear(1, { clearedRows: [23] });
        advance(world, reactions, 0.5, (frame) => {
            expect(frame.ribbons).toBe(0);
            expect(shown()).toBe(0);
        });

        // A long combo: the crown gathers, and above its halfway mark the ribbons unfurl.
        reactions.onCombo(8);
        let peak = 0;
        let seen = 0;
        let crowned = false;
        const follow = (frame) => {
            peak = Math.max(peak, world.garlands.uLevel.value);
            expect(world.garlands.uLevel.value).toBeCloseTo(frame.ribbons, 12);
            // All of them or none; there whenever the combo calls, gone whenever it does not.
            expect([0, ribbons.length]).toContain(shown());
            if (frame.ribbons > 0.01) expect(shown()).toBe(ribbons.length);
            if (frame.ribbons === 0) expect(shown()).toBe(0);
            seen = Math.max(seen, shown());
            crowned = crowned || world.director.fields.some((field) => field.kind === 'vortex');
        };
        advance(world, reactions, 2, follow);
        expect(seen).toBe(ribbons.length);
        expect(peak).toBeGreaterThan(0.5);
        // The crown turns around the board, fed with petals of every kind in turn.
        expect(crowned).toBe(true);
        expect(new Set(alight(world.petals.sim).map((particle) => particle.flower)).size).toBe(LETTERS.length);
        expect(world.garlands.uBoard.value.x).toBeCloseTo(world.stage.centre().x, 9);

        // The combo ends; the crown unwinds and the ribbons are put away again.
        advance(world, reactions, 12, follow);
        expect(world.garlands.uLevel.value).toBe(0);
        expect(shown()).toBe(0);
        // A game over lets the crown fall, and the ribbons with it.
        reactions.onCombo(12);
        advance(world, reactions, 1.5, follow);
        expect(shown()).toBe(ribbons.length);
        reactions.onGameOver();
        advance(world, reactions, 4, follow);
        expect(shown()).toBe(0);
    }, SLOW);

    it('lights a lantern for each kind locked and throws the bouquet from the maypole at the seventh', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.petals;
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        advance(world, reactions, 0.25);
        const picked = [];
        for (const letter of LETTERS.slice(0, -1)) {
            reactions.onPieceLock({ piece: piece(letter) });
            expect(() => advance(world, reactions, STEP)).not.toThrow();
            picked.push(letter);
            // Each new kind lights its own lantern, and the ones before it stay lit.
            expect(lanterns(world)).toEqual(lanternsOf(picked));
            expect(lanterns(world)[SUMMER_PIECE_FLOWERS[letter]]).toBe(1);
            expect(world.homestead.uFlash.value).toBe(0);
            // Locking the same kind again changes nothing.
            reactions.onPieceLock({ piece: piece(letter) });
            advance(world, reactions, STEP);
            expect(lanterns(world)).toEqual(lanternsOf(picked));
        }
        expect(picked).toHaveLength(6);
        // The lanterns hold while the game goes on.
        advance(world, reactions, 3);
        expect(lanterns(world)).toEqual(lanternsOf(picked));

        // The seventh kind completes the bouquet: all seven burn and the whole pole flares.
        const spawn = vi.spyOn(sim, 'spawn');
        const anchors = world.homestead.bouquetAnchors();
        reactions.onPieceLock({ piece: piece(LETTERS.at(-1)) });
        advance(world, reactions, STEP);
        expect(lanterns(world)).toEqual([1, 1, 1, 1, 1, 1, 1]);
        expect(world.homestead.uFlash.value).toBeGreaterThan(0.9);
        expect(world.homestead.uFlash.value).toBeLessThanOrEqual(1);
        expect(reactions.getFrame().emitters.map((emitter) => emitter.kind)).toContain('bouquet');
        // The maypole throws it: over the next second petals leave the top and both wreaths,
        // and between them they carry all seven kinds.
        advance(world, reactions, 1);
        const from = [anchors.top, ...anchors.wreaths];
        const leaving = from.map(() => 0);
        const kinds = new Set();
        for (const [x, y, z, , , , options] of spawn.mock.calls) {
            const start = new THREE.Vector3(x, y, z);
            const nearest = from.reduce((best, anchor, index) => (
                start.distanceTo(anchor) < start.distanceTo(from[best]) ? index : best), 0);
            if (start.distanceTo(from[nearest]) < 0.5) {
                leaving[nearest] += 1;
                if (options.kind === PETAL) kinds.add(options.flower);
            }
        }
        expect(leaving.every((thrown) => thrown > 0), `thrown from top and wreaths: ${leaving}`).toBe(true);
        expect([...kinds].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(sim.counts().live).toBeGreaterThan(sum(leaving) * 0.5);
        expect(world.light.uGlow.value).toBeGreaterThan(0);

        // Then the lanterns burn down, and the next bouquet begins from the first kind locked.
        advance(world, reactions, 15);
        expect(lanterns(world)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(world.homestead.uFlash.value).toBeLessThan(0.01);
        reactions.onPieceLock({ piece: piece('O') });
        advance(world, reactions, STEP);
        expect(lanterns(world)).toEqual(lanternsOf(['O']));
    }, SLOW);

    it('plays a session of gameplay reactions without creating meshes, geometries or materials', async () => {
        const { world, scene } = await buildWorld('Medium');
        const meshes = drawables(world.group);
        const children = [...world.group.children];
        const before = resources(world.group);
        const counts = meshes.map((mesh) => mesh.count);
        const { sim } = world.petals;
        const versions = [world.petals.places.version, world.petals.looks.version];
        const reactions = new SummerReactions({ quality: 'Medium', rng: seededRandom(5) });
        const script = {
            3: () => { reactions.onHardDrop({ distance: 15 }); reactions.onPieceLock({ piece: piece('I', 1) }); },
            20: () => {
                reactions.onPieceLock({ piece: piece('L', 8, 12) });
                reactions.onLineClear(1, { clearedRows: [23] });
            },
            40: () => {
                reactions.onPieceLock({ piece: piece('S', 1) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(2);
            },
            60: () => { reactions.onCombo(5); reactions.onTSpin({ piece: piece('T', 8, 12) }); },
            80: () => { reactions.onCombo(9); reactions.onBackToBack(); },
            100: () => { reactions.onPerfectClear(); reactions.onLevelUp(); },
            170: () => reactions.onGameOver(),
        };
        const seen = {
            kinds: new Set(), fields: new Set(), live: 0, rings: 0, gusts: 0, finite: true, settled: false,
        };
        const frames = 200;
        for (let frame = 0; frame < frames; frame++) {
            script[frame]?.();
            const state = reactions.update(STEP);
            world.update(reactions.time, STEP, state);
            state.emitters.forEach((emitter) => seen.kinds.add(emitter.kind));
            world.director.fields.forEach((field) => seen.fields.add(field.kind));
            seen.live = Math.max(seen.live, sim.counts().live);
            seen.rings = Math.max(seen.rings, world.lake.ripples.active());
            seen.gusts = Math.max(seen.gusts, world.light.waves.active());
            seen.settled = seen.settled || world.director.env.settled;
            seen.finite = seen.finite && allFinite(sim.outPlace) && allFinite(sim.outLook)
                && [...world.lake.ripples.rings, ...world.light.waves.rings]
                    .every((ring) => ring.toArray().every(Number.isFinite));
            // Whatever rings the lake carries, it carries on water.
            for (const ring of under(world.lake.ripples)) {
                if (!(summerGroundHeight(ring.x, ring.z) < 0)) throw new Error(`ring on land at ${ring.x}, ${ring.z}`);
            }
        }

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
        for (const kind of ['lock', 'seeds', 'clear', 'rise', 'combo', 'spin', 'bouquet']) {
            expect([...seen.kinds], kind).toContain(kind);
        }
        for (const kind of ['burst', 'jet', 'vortex']) expect([...seen.fields], kind).toContain(kind);
        // ... petals flew, the lake rang until its pool was full, gusts crossed the meadow,
        // and it all settled when the game ended.
        expect(seen.live).toBeGreaterThan(sim.reserve * 0.2);
        expect(seen.rings).toBe(world.lake.ripples.count);
        expect(seen.gusts).toBeGreaterThan(1);
        expect(seen.settled).toBe(true);
        expect(seen.finite).toBe(true);
        // Every frame re-uploads the two petal buffers, and only moves the clock forward.
        expect(world.petals.places.version).toBe(versions[0] + frames);
        expect(world.petals.looks.version).toBe(versions[1] + frames);
        expect(world.light.uTime.value).toBeCloseTo(reactions.time, 9);
        expect(sim.time).toBeCloseTo(frames * STEP, 9);
        expect(world.getDiagnostics()).toMatchObject({
            petals: sim.counts(), rings: world.lake.ripples.active(), waves: world.light.waves.active(),
        });
    }, SLOW);

    it('keeps invalid time inputs out of the world clock and bounds what a frame can ask for', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const { sim } = world.petals;
        const { boat } = world.homestead;
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        reactions.onPieceLock({ piece: piece('J', 1) });
        reactions.onLineClear(2, { clearedRows: [22, 23] });
        reactions.onCombo(8);
        advance(world, reactions, 10 * STEP);
        const frame = reactions.getFrame();
        const before = {
            time: light.uTime.value,
            simTime: sim.time,
            place: Array.from(sim.outPlace),
            pose: boat.matrix.clone(),
            rings: world.lake.ripples.rings.map((ring) => ring.toArray()),
            gusts: light.waves.rings.map((ring) => ring.toArray()),
            live: sim.counts().live,
        };
        expect(before.live).toBeGreaterThan(0);
        expect(before.time).toBeGreaterThan(0);

        // A frame whose time and timestep are not numbers moves nothing.
        for (const junk of [NaN, undefined, null, Infinity, -Infinity, 'soon']) {
            expect(() => world.update(junk, junk, frame), String(junk)).not.toThrow();
        }
        expect(light.uTime.value).toBe(before.time);
        expect(sim.time).toBe(before.simTime);
        expect(sim.counts().live).toBe(before.live);
        expect(Array.from(sim.outPlace)).toEqual(before.place);
        expect(world.lake.ripples.rings.map((ring) => ring.toArray())).toEqual(before.rings);
        expect(light.waves.rings.map((ring) => ring.toArray())).toEqual(before.gusts);
        expect(boat.matrix.equals(before.pose)).toBe(true);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);

        // Each is judged on its own: a good timestep still advances a frame with a bad time,
        world.update(NaN, STEP, frame);
        expect(light.uTime.value).toBe(before.time);
        expect(sim.time).toBeCloseTo(before.simTime + STEP, 12);
        expect(boat.matrix.equals(before.pose)).toBe(true);
        // and a good time still moves the light and the boat when the timestep is bad.
        world.update(9, NaN, frame);
        expect(light.uTime.value).toBe(9);
        expect(sim.time).toBeCloseTo(before.simTime + STEP, 12);
        expect(boat.matrix.equals(before.pose)).toBe(false);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);
        // Time never runs before the start, and a negative step is no step.
        world.update(-5, -1, frame);
        expect(light.uTime.value).toBe(0);
        expect(sim.time).toBeCloseTo(before.simTime + STEP, 12);

        // A frame without anything in it, or with nothing at all, is as welcome.
        expect(() => {
            world.update(1, STEP);
            world.update(1, STEP, {});
            world.update(1, STEP, {
                emitters: null, rings: null, waves: null, front: null, species: null, bouquet: null,
            });
            world.update();
        }).not.toThrow();
        expect(world.garlands.uLevel.value).toBe(0);
        expect(lanterns(world)).toEqual([0, 0, 0, 0, 0, 0, 0]);

        // Envelopes outside their range are clamped; nonsense reads as rest.
        world.update(4, 0, {
            gust: 2, warmth: -5, glow: NaN, shimmer: 40, flock: -2, flutter: 9, ribbons: NaN, heat: 9, bouquetFlash: 7,
        });
        const fullGust = light.uGust.value;
        expect(fullGust).toBeGreaterThan(0);
        expect(light.uWarmth.value).toBe(0);
        expect(light.uGlow.value).toBe(0);
        expect(world.lake.uShimmer.value).toBe(1);
        expect(world.life.uStartle.value).toBe(0);
        expect(world.life.uFlutter.value).toBe(1);
        expect(world.garlands.uLevel.value).toBe(0);
        expect(world.garlands.uHeat.value).toBe(1);
        expect(world.homestead.uFlash.value).toBe(1);
        world.update(4, 0, {
            gust: 1, warmth: 0.5, glow: 0.25, shimmer: 0.4, flock: 0.7, bouquet: [0.5, 2, -1, NaN, 'x', 1, 0.25],
        });
        expect(light.uGust.value).toBe(fullGust);
        expect(light.uWarmth.value).toBe(0.5);
        expect(light.uGlow.value).toBe(0.25);
        expect(world.lake.uShimmer.value).toBe(0.4);
        expect(world.life.uStartle.value).toBe(0.7);
        expect(lanterns(world)).toEqual([0.5, 1, 0, 0, 0, 1, 0.25]);
        // Hostile frames never reach the petals, the lake or the grass as numbers that are not.
        for (let step = 0; step < 30; step++) {
            world.update(step * STEP, STEP, {
                gust: NaN, warmth: null, glow: -1, crown: Infinity, heat: 'hot', front: null, emitters: [], rings: [],
            });
            world.update(step * STEP, STEP, {
                gust: 1e9,
                crown: 1e9,
                heat: 1e9,
                emitters: 'none',
                rings: 'none',
                waves: 'none',
                species: 'all',
                bouquet: 'all',
                front: { x: NaN, strength: 9 },
            });
        }
        expect(allFinite(sim.outPlace) && allFinite(sim.outLook)).toBe(true);
        expect(Number.isFinite(light.uGust.value)).toBe(true);
        expect(light.uFront.value.toArray().every(Number.isFinite)).toBe(true);
        expect([...world.lake.ripples.rings, ...light.waves.rings]
            .every((ring) => ring.toArray().every(Number.isFinite))).toBe(true);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);
    }, SLOW);

    it('clears petals, rings and gusts on resetEffects, and plays what comes next', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.petals;
        const fresh = Array.from(sim.outPlace);
        const reactions = new SummerReactions({ quality: 'Low', rng: seededRandom(5) });
        reactions.onHardDrop({ distance: 16 });
        reactions.onPieceLock({ piece: piece('Z', 1) });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onCombo(8);
        advance(world, reactions, 0.75);
        expect(sim.counts().live).toBeGreaterThan(20);
        expect(world.lake.ripples.active()).toBeGreaterThan(1);
        expect(world.light.waves.active()).toBeGreaterThan(1);
        expect(world.director.fields.length).toBeGreaterThan(0);
        expect(Array.from(world.light.species).some((level) => level > 0)).toBe(true);
        const { version } = world.petals.places;

        // On its own it drops everything in flight, at once.
        world.resetEffects();
        expect(rest(world)).toEqual({ petals: 0, rings: 0, gusts: 0 });
        expect(alight(sim)).toEqual([]);
        expect(sim.time).toBe(0);
        expect(sim.counts()).toEqual({ ambient: sim.ambient, reserve: sim.reserve, live: 0 });
        expect(Array.from(sim.outPlace)).toEqual(fresh);
        expect(world.lake.ripples.rings.every((ring) => ring.toArray().every((value) => value === 0))).toBe(true);
        expect(world.light.waves.rings.every((ring) => ring.toArray().every((value) => value === 0))).toBe(true);
        expect(world.director.fields).toEqual([]);
        expect(Array.from(world.light.species).every((level) => level === 0)).toBe(true);
        // The cleared buffers are flagged for upload even though no frame has run.
        expect(world.petals.places.version).toBeGreaterThan(version);
        expect(world.getDiagnostics()).toMatchObject({ rings: 0, waves: 0, petals: { live: 0 } });

        // With the reactions started over as well (a new session, effects switched off), the
        // evening stays calm: nothing that was asked for before comes back.
        reactions.reset();
        const ringsAdded = vi.spyOn(world.lake.ripples, 'add');
        const gustsAdded = vi.spyOn(world.light.waves, 'add');
        advance(world, reactions, 1);
        expect(rest(world)).toEqual({ petals: 0, rings: 0, gusts: 0 });
        expect(ringsAdded).not.toHaveBeenCalled();
        expect(gustsAdded).not.toHaveBeenCalled();
        expect(world.garlands.uLevel.value).toBe(0);
        // A new session numbers its events from zero again; its first lock must not be
        // swallowed. The director learns of the new session from the frame itself.
        reactions.onPieceLock({ piece: piece('S', 8) });
        advance(world, reactions, STEP);
        expect(world.director.epoch).toBe(reactions.epoch);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(ringsAdded).toHaveBeenCalledOnce();
        expect(gustsAdded).toHaveBeenCalledOnce();
        expect(rest(world)).toMatchObject({ rings: 1, gusts: 1 });
    }, SLOW);

    it('does not replay what the reactions still hold after resetEffects alone', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.petals;
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(1) });
        reactions.onPieceLock({ piece: piece('I', 1) });
        reactions.onTSpin({ piece: piece('T', 1) });
        reactions.onLineClear(2, { clearedRows: [22, 23] });
        // Forty frames: the puff, the garland and both jets have thrown all their petals.
        advance(world, reactions, 40 * STEP);
        expect(sim.counts().live).toBeGreaterThan(5);
        expect(world.lake.ripples.active()).toBeGreaterThan(2);

        world.resetEffects();
        // The reactions were left alone: rings and gusts still queued, emitters in mid-flight.
        const held = reactions.getFrame();
        expect(held.rings.filter((ring) => ring.serial >= 0).length).toBeGreaterThan(2);
        expect(held.waves.filter((wave) => wave.serial >= 0).length).toBeGreaterThan(2);
        expect(held.emitters.length).toBeGreaterThan(0);
        const ringsAdded = vi.spyOn(world.lake.ripples, 'add');
        const gustsAdded = vi.spyOn(world.light.waves, 'add');
        const spawned = vi.spyOn(sim, 'spawn');
        advance(world, reactions, 10 * STEP);
        // Not one ring or gust comes back, and no finished puff is thrown again.
        expect(ringsAdded).not.toHaveBeenCalled();
        expect(gustsAdded).not.toHaveBeenCalled();
        expect(spawned).not.toHaveBeenCalled();
        expect(rest(world)).toEqual({ petals: 0, rings: 0, gusts: 0 });
        // What the reactions ask for next is new, and is played.
        reactions.onPieceLock({ piece: piece('L', 8) });
        advance(world, reactions, STEP);
        expect(ringsAdded).toHaveBeenCalledOnce();
        expect(gustsAdded).toHaveBeenCalledOnce();
        expect(sim.counts().live).toBeGreaterThan(0);
        const centre = world.stage.centre();
        expect(alight(sim).filter((particle) => particle.kind === PETAL).every((particle) => particle.x > centre.x))
            .toBe(true);
    }, SLOW);

    it('follows the board wherever it is measured to be, and keeps the default for nonsense', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.petals;
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        const home = world.garlands.uBoard.value.clone();
        const lockOnRightEdge = () => {
            // A new session each time: the reactions start over, the world drops what was in flight.
            reactions.reset();
            world.resetEffects();
            reactions.onPieceLock({ piece: piece('O', 9, 14) });
            advance(world, reactions, 3 * STEP);
            const flying = alight(sim).filter((particle) => particle.kind === PETAL);
            expect(flying.length).toBeGreaterThan(0);
            return sum(flying.map((particle) => particle.x)) / flying.length;
        };
        expect(world.stage.board).toEqual(SUMMER_DEFAULT_BOARD);
        expect(home.x).toBeCloseTo(world.stage.centre().x, 9);
        expect(lockOnRightEdge()).toBeGreaterThan(0);

        // A card on the far left of the screen: its right edge is left of the view axis.
        const left = {
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        };
        world.setBoard(left);
        expect(world.stage.board).toEqual(left);
        // The ribbons' board uniform moves with it ...
        const moved = world.garlands.uBoard.value.clone();
        expect(moved.x).toBeLessThan(home.x - 1);
        expect(moved.x).toBeCloseTo(world.stage.centre().x, 9);
        expect(moved.y).toBeCloseTo(world.stage.centre().y, 9);
        expect(moved.z).toBeCloseTo(world.stage.centre().z, 9);
        // ... its height is the card's height at the depth it stands,
        expect(moved.w / home.w)
            .toBeCloseTo((left.y1 - left.y0) / (SUMMER_DEFAULT_BOARD.y1 - SUMMER_DEFAULT_BOARD.y0), 9);
        // ... and so does where the petals are thrown from.
        expect(lockOnRightEdge()).toBeLessThan(0);

        for (const junk of [null, undefined, {}, 'board', 42, [], { x0: NaN }, {
            x0: 0.9, x1: 0.1, y0: 0, y1: 1,
        }, {
            x0: 0.4, x1: 0.41, y0: 0, y1: 1,
        }]) {
            world.setBoard(left);
            expect(world.garlands.uBoard.value.equals(moved)).toBe(true);
            expect(() => world.setBoard(junk)).not.toThrow();
            expect(world.stage.board).toEqual(SUMMER_DEFAULT_BOARD);
            expect(world.garlands.uBoard.value.equals(home)).toBe(true);
        }
        // Back at the default card the petals leave from the right of the view axis again.
        expect(lockOnRightEdge()).toBeGreaterThan(0);
    }, SLOW);

    it('rocks the boat now and then hard enough to ring the water beside it', async () => {
        const { world } = await buildWorld('Minimal');
        const { ripples } = world.lake;
        const { boat } = world.homestead;
        const added = vi.spyOn(ripples, 'add');
        let highest = 0;
        // Twenty seconds of an empty, settled evening: no fish, no events, only the boat.
        for (let frame = 0; frame < 20 * 60; frame++) {
            world.update(frame * STEP, STEP, { settled: true });
            highest = Math.max(highest, Math.abs(boat.position.y));
        }
        const rocked = added.mock.calls.filter(([x, z]) => x === boat.position.x && z === boat.position.z);
        expect(rocked.length).toBeGreaterThanOrEqual(2);
        expect(rocked.length).toBeLessThan(10);
        expect(added).toHaveBeenCalledTimes(rocked.length);
        // Faint rings: the boat is not a piece locking.
        for (const [, , strength] of rocked) expect(strength).toBeLessThan(0.5);
        // It bobs by centimetres, never out of the water, and stays moored where it was put.
        expect(highest).toBeGreaterThan(0);
        expect(highest).toBeLessThan(0.05);
        expect(boat.position.x).toBe(SUMMER_PLACES.boat.x);
        expect(boat.position.z).toBe(SUMMER_PLACES.boat.z);
        expect(boat.matrix.elements.every(Number.isFinite)).toBe(true);
        // With the game on, a fish rises now and then too.
        added.mockClear();
        for (let frame = 0; frame < 30 * 60; frame++) world.update(20 + frame * STEP, STEP, {});
        const fish = added.mock.calls.filter(([x, z]) => !(x === boat.position.x && z === boat.position.z));
        expect(fish.length).toBeGreaterThan(0);
        for (const [x, z] of fish) expect(summerGroundHeight(x, z)).toBeLessThan(0);
    }, SLOW);
});

describe('Summer world ownership', () => {
    it('builds only once', async () => {
        const { world, scene } = await buildWorld('Minimal');
        const meshes = drawables(world.group);
        const {
            forest, meadow, petals, light, stage, director, lake, homestead,
        } = world;
        expect(world.built).toBe(true);
        expect(world.build()).toBe(world);
        expect(world.forest).toBe(forest);
        expect(world.meadow).toBe(meadow);
        expect(world.petals).toBe(petals);
        expect(world.light).toBe(light);
        expect(world.stage).toBe(stage);
        expect(world.director).toBe(director);
        expect(world.lake).toBe(lake);
        expect(world.homestead).toBe(homestead);
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
        expect(ownGeometries.length).toBeGreaterThan(15);
        expect(geometries.size - ownGeometries.length).toBeGreaterThan(15);
        expect(materials.size).toBeGreaterThan(25);
        const spy = (resource) => vi.spyOn(resource, 'dispose');
        const once = [...ownGeometries, ...materials, ...instanced, world.light.noiseTexture, world.terrain.lakeMap,
            world.terrain.meadowMap].map(spy);
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
        // Nothing of the evening is left in the scene, at any depth.
        expect(scene.children).toHaveLength(0);
        expect(drawables(scene)).toEqual([]);
        expect(world.group.parent).toBeNull();
        expect(world.group.children).toHaveLength(0);
        for (const key of ['light', ...PARTS, 'director', 'stage']) expect(world[key], key).toBeNull();
        expect(() => world.build()).toThrow('Cannot rebuild a disposed SummerWorld.');
        expect(scene.children).toHaveLength(0);

        // A disposed world is inert rather than explosive.
        expect(() => {
            world.update(1, STEP, { emitters: [] });
            world.setBoard(SUMMER_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        expect(world.getDiagnostics()).toEqual({
            quality: 'Minimal', farTrees: 0, butterflies: 0, swallows: 0, petals: null, rings: 0, waves: 0,
        });

        // The bundle is released by whoever loaded it, once.
        disposeSummerAssets(assets);
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
        expect(bystander.layers.isEnabled(SUMMER_MIRROR_LAYER)).toBe(false);
        world.dispose();
        expect(scene.children).toEqual([bystander]);
        bystander.geometry.dispose();
        bystander.material.dispose();
    }, SLOW);

    it('needs its assets and says so before touching the scene', async () => {
        const scene = new THREE.Scene();
        // Asked for nothing in particular, a world is a High one.
        const unspecified = new SummerWorld({ scene, camera: new THREE.PerspectiveCamera() });
        expect(unspecified.quality).toBe('High');
        expect(unspecified.tier).toBe(SUMMER_TIERS.High);
        const idle = {
            farTrees: 0, butterflies: 0, swallows: 0, petals: null, rings: 0, waves: 0,
        };
        expect(unspecified.getDiagnostics()).toEqual({ quality: 'High', ...idle });
        // An unknown tier name reads as High too.
        expect(new SummerWorld({ scene, camera: new THREE.PerspectiveCamera(), quality: 'Potato' }).tier)
            .toBe(SUMMER_TIERS.High);
        const world = new SummerWorld({ scene, camera: new THREE.PerspectiveCamera(), quality: 'Minimal' });
        owned.push(world);
        expect(world.tier).toBe(SUMMER_TIERS.Minimal);
        for (const missing of [undefined, null]) {
            world.assets = missing;
            expect(() => world.build()).toThrow('[Summer] The world needs its loaded assets before it can build.');
        }
        expect(scene.children).toHaveLength(0);
        expect(world.built).toBe(false);
        // Nothing was half-made: update, the board and diagnostics are still safe.
        expect(() => {
            world.update(0, STEP, { emitters: [] });
            world.setBoard(SUMMER_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        expect(world.getDiagnostics()).toEqual({ quality: 'Minimal', ...idle });
        // Once the assets are there the same world builds.
        world.assets = await loadBundle();
        expect(world.build()).toBe(world);
        expect(scene.children).toEqual([world.group]);
        expect(world.getDiagnostics().trees).toBeGreaterThan(SUMMER_FEATURE_TREES.length);
    }, SLOW);

    it('names the missing spray when the foliage pack lacks one, and still cleans up', async () => {
        const assets = await loadBundle();
        const removed = assets.foliage.meshes.spruce_frond_1;
        delete assets.foliage.meshes.spruce_frond_1;
        const { world, scene } = createWorld('Minimal', assets);
        expect(() => world.build())
            .toThrow('[Summer] Foliage mesh "spruce_frond_1" is missing from the asset pack.');
        // A half-built world answers a frame by doing nothing.
        expect(() => world.update(0, STEP, {})).not.toThrow();
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
        vi.spyOn(SummerForest.prototype, 'build').mockImplementation(function failedBuild() {
            this.own(geometry);
            this.own(material);
            this.group.add(new THREE.Mesh(geometry, material));
            throw new Error('partial forest failure');
        });
        const { world, scene } = createWorld('Minimal', await loadBundle());
        expect(() => world.build()).toThrow('partial forest failure');
        expect(world.forest).toBeInstanceOf(SummerForest);
        // What was finished before the failure is still owned and released.
        const finished = [world.terrain.mesh.geometry, world.terrain.mesh.material, world.terrain.lakeMap,
            world.terrain.meadowMap, world.light.noiseTexture].map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        world.dispose();
        expect(geometryDisposal).toHaveBeenCalledOnce();
        expect(materialDisposal).toHaveBeenCalledOnce();
        finished.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        expect(() => world.build()).toThrow('Cannot rebuild a disposed SummerWorld.');
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
        for (const mesh of named(low.world.group, /^SummerBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeLessThan(mesh.geometry.index.count);
        }
        low.world.dispose();
        expect(ranges()).toEqual(pristine);
        const high = createWorld('Medium', assets);
        high.world.build();
        for (const mesh of named(high.world.group, /^SummerBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeGreaterThanOrEqual(mesh.geometry.index.count);
        }
    }, SLOW);

    it('builds without the far-tree sprite sheet and without the props', async () => {
        const { world } = await buildWorld('Minimal', { impostors: false, props: false });
        expect(world.backdrop.count).toBe(0);
        expect(world.getDiagnostics().farTrees).toBe(0);
        expect(named(world.group, 'SummerFarShore')).toEqual([]);
        expect(named(world.group, 'SummerRidges')).toHaveLength(1);
        // No cottage, maypole, jetty or boat; the meadow, the reeds and the lilies need no pack.
        expect(drawables(world.homestead.group)).toEqual([]);
        expect(world.homestead.boat).toBeNull();
        expect(world.getDiagnostics().grass).toBeGreaterThan(0);
        expect(world.getDiagnostics().reeds).toBeGreaterThan(0);
        // The bouquet is still thrown from where the maypole would stand: above its ring.
        const anchors = world.homestead.bouquetAnchors();
        const { maypole } = SUMMER_PLACES;
        expect(Math.hypot(anchors.top.x - maypole.x, anchors.top.z - maypole.z)).toBeLessThan(0.01);
        expect(anchors.top.y).toBeGreaterThan(summerGroundHeight(maypole.x, maypole.z) + 5);
        expect(anchors.wreaths).toHaveLength(2);
        for (const wreath of anchors.wreaths) {
            expect(wreath.toArray().every(Number.isFinite)).toBe(true);
            expect(Math.hypot(wreath.x - maypole.x, wreath.z - maypole.z)).toBeLessThan(maypole.ring);
        }
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        expect(() => {
            LETTERS.forEach((letter) => reactions.onPieceLock({ piece: piece(letter) }));
            advance(world, reactions, 2);
        }).not.toThrow();
        expect(world.petals.sim.counts().live).toBeGreaterThan(0);
        // With no boat to rock, a settled evening leaves the lake alone.
        world.resetEffects();
        const added = vi.spyOn(world.lake.ripples, 'add');
        for (let frame = 0; frame < 600; frame++) world.update(frame * STEP, STEP, { emitters: [], settled: true });
        expect(added).not.toHaveBeenCalled();
    }, SLOW);

    it.each([
        ['one framing tree and one grove tree', ['spruce-hero', 'birch-grove-a']],
        ['a single grove tree', ['spruce-grove-d']],
        ['no trees at all', []],
    ])('builds its woods from whichever trees were loaded: %s', async (_label, trees) => {
        const { world, scene } = await buildWorld('Minimal', { trees });
        const { placements } = world.forest;
        expect(world.built).toBe(true);
        expect(scene.children).toEqual([world.group]);
        expect(placements.every((tree) => trees.includes(tree.asset))).toBe(true);
        const bark = named(world.group, /^SummerBark /);
        expect(bark.map((mesh) => mesh.name).sort())
            .toEqual([...new Set(placements.map((tree) => `SummerBark ${tree.asset}`))].sort());
        expect(world.forest.stats.trees).toBe(sum(bark.map((mesh) => mesh.count)));
        expect(world.forest.stats.trees).toBe(placements.length);
        expect(world.forest.stats.trees)
            .toBeLessThan(SUMMER_FEATURE_TREES.length + SUMMER_TIERS.Minimal.groveTrees);
        const kinds = new Set(trees.map((name) => world.assets.trees[name].foliage));
        const sprays = named(world.group, /^SummerFoliage /);
        expect(sprays.every((mesh) => kinds.has(mesh.name.slice('SummerFoliage '.length).replace(/_\d+$/, ''))))
            .toBe(true);
        if (!trees.length) expect(drawables(world.forest.group)).toEqual([]);
        // The rest of the evening is all there, and plays.
        expect(world.petals.sim.count).toBe(SUMMER_TIERS.Minimal.petals);
        expect(world.getDiagnostics()).toMatchObject({ trees: placements.length });
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        reactions.onPieceLock({ piece: piece('S', 2) });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        expect(() => advance(world, reactions, 0.5)).not.toThrow();
        expect(world.petals.sim.counts().live).toBeGreaterThan(0);
    }, SLOW);
});

describe('Summer post tier ownership', () => {
    let meadow;

    beforeAll(async () => {
        meadow = await buildWorld('Minimal', { track: false });
    }, SLOW);

    afterAll(() => {
        meadow.world.dispose();
        disposeSummerAssets(meadow.assets);
    });

    const lit = () => ({ light: meadow.world.light, scene: meadow.scene, camera: meadow.camera });
    const DIRECT = Object.keys(SUMMER_TIERS).filter((quality) => !SUMMER_TIERS[quality].post);
    const GRADED = Object.keys(SUMMER_TIERS).filter((quality) => SUMMER_TIERS[quality].post);

    it('has tiers that draw directly and tiers that grade through a pipeline', () => {
        expect(DIRECT.length).toBeGreaterThan(0);
        expect(GRADED.length).toBeGreaterThan(0);
        expect([...DIRECT, ...GRADED].sort()).toEqual(Object.keys(SUMMER_TIERS).sort());
        // The shafts and the bloom live in the pipeline: no pipeline, no shafts.
        for (const quality of DIRECT) expect(SUMMER_TIERS[quality].godrays).toBe(0);
    });

    it.each(DIRECT)('avoids post targets at %s and restores direct renderer settings', (quality) => {
        let drawTone;
        let drawExposure;
        const {
            renderer, scene, camera, post,
        } = createPost(quality, lit());
        renderer.render.mockImplementation(() => {
            drawTone = renderer.toneMapping;
            drawExposure = renderer.toneMappingExposure;
        });
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
        // The scene goes straight through the renderer, with ACES for that one draw.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(drawTone).toBe(THREE.ACESFilmicToneMapping);
        expect(drawExposure).toBe(post.uExposure.value);
        expect(drawExposure).toBeGreaterThan(resting);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
        expect(() => post.setSize(800, 400)).not.toThrow();
        expect(post.uAspect.value).toBe(2);
        post.dispose();
        expect(() => post.dispose()).not.toThrow();
        expect(post.disposed).toBe(true);
        post.render();
        expect(renderer.render).toHaveBeenCalledOnce();
        expect(post.renderer).toBeNull();
        expect(post.light).toBeNull();
        expect(() => post.update({ warmth: 1 })).not.toThrow();
    });

    it.each(DIRECT)('restores the %s renderer state when a direct render throws', (quality) => {
        const { renderer, post } = createPost(quality, { render: vi.fn(() => { throw new Error('device lost'); }) });
        expect(() => post.render()).toThrow('device lost');
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });

    it('constructs a node-only post graph with sun shafts for High and disposes it exactly once', () => {
        expect(meadow.world.light.sun.shadow.map).toBeNull();
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
        // of the scene makes the shadow rig exist first.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(post.godraysNode.raymarchSteps.value).toBe(SUMMER_TIERS.High.godrays);
        expect(post.godraysNode.resolutionScale).toBe(SUMMER_TIERS.High.godraysScale);
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
        // The world's own light is not the lens's to dispose.
        expect(meadow.world.light.sun.parent).toBe(meadow.world.group);
    });

    it.each(GRADED)('renders %s through its pipeline only', (quality) => {
        const { renderer, post } = createPost(quality, lit());
        const tier = SUMMER_TIERS[quality];
        expect(post.getDiagnostics()).toEqual({
            quality, disabled: false, useMRT: false, godrays: tier.godrays > 0,
        });
        if (tier.godrays > 0) {
            expect(post.godraysNode.raymarchSteps.value).toBe(tier.godrays);
            expect(post.godraysNode.resolutionScale).toBe(tier.godraysScale);
        }
        const draw = vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        renderer.render.mockClear();
        post.render();
        expect(draw).toHaveBeenCalledOnce();
        expect(renderer.render).not.toHaveBeenCalled();
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });

    it('does not prime the shadow rig again once its map exists', () => {
        const { sun } = meadow.world.light;
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
        // One render of the scene, into a throwaway target shaped like the scene pass's own:
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
        for (const quality of DIRECT) {
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
        expect(() => new SummerPost({ ...lit(), renderer, quality: 'High' })).toThrow('device lost');
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
        expect(post.tier).toBe(SUMMER_TIERS.High);
        expect(post.disabled).toBe(!SUMMER_TIERS.High.post);
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
        const calm = read({});
        expect(read()).toEqual(calm);
        const warm = read({ warmth: 0.5, shafts: 0.5 });
        const hot = read({ warmth: 1, shafts: 1 });
        for (const key of ['exposure', 'shafts', 'bloom']) {
            expect(calm[key]).toBeGreaterThan(0);
            expect(warm[key]).toBeGreaterThan(calm[key]);
            expect(hot[key]).toBeGreaterThan(warm[key]);
        }
        expect(read({ warmth: 50, shafts: 50 })).toEqual(hot);
        for (const frame of [{ warmth: NaN, shafts: Infinity }, { warmth: -3, shafts: -3 },
            { warmth: 'hot', shafts: null }]) {
            expect(read(frame)).toEqual(calm);
        }
        // The lens stays subtle: a full celebration is a lift, not a flash.
        expect(hot.exposure).toBeLessThan(calm.exposure * 1.1);
        expect(hot.bloom).toBeLessThan(calm.bloom * 1.5);
        // Events lift the exposure from its resting value, wherever that has been set.
        expect(calm.exposure).toBe(post.exposure);
        post.exposure = 0.6;
        expect(read({}).exposure).toBe(0.6);
        expect(read({ warmth: 1 }).exposure - 0.6).toBeCloseTo(hot.exposure - calm.exposure, 12);
        // The direct-draw tiers expose by the same rule.
        const { renderer, post: direct } = createPost(DIRECT[0], lit());
        direct.exposure = 0.9;
        direct.update({ warmth: 1 });
        let drawn;
        renderer.render.mockImplementation(() => { drawn = renderer.toneMappingExposure; });
        direct.render();
        expect(drawn).toBeCloseTo(0.9 + (hot.exposure - calm.exposure), 12);
    });

    it('tints its shafts from where the sun really stands on screen', () => {
        const { post, camera } = createPost('High', lit());
        post.update({});
        const sun = post.uSunScreen.value;
        // Left of the board and above the middle of the screen: over the open lake.
        expect(sun.x).toBeGreaterThan(0);
        expect(sun.x).toBeLessThan(0.5);
        expect(sun.y).toBeGreaterThan(0);
        expect(sun.y).toBeLessThan(0.5);
        // It is the projection of the light rig's own sun direction (uv, y down).
        const point = camera.position.clone().addScaledVector(SUMMER_SUN_DIRECTION, 500).project(camera);
        expect(sun.x).toBeCloseTo(point.x * 0.5 + 0.5, 9);
        expect(sun.y).toBeCloseTo(0.5 - point.y * 0.5, 9);
        // Without a light or a camera the last position simply stands.
        const blind = createPost(DIRECT[0]).post;
        const before = blind.uSunScreen.value.clone();
        blind.update({ warmth: 1 });
        expect(blind.uSunScreen.value.equals(before)).toBe(true);
    });
});
