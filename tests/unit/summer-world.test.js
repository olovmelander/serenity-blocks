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
import { SummerBackdrop } from '../../src/themes/summer/summer-backdrop.js';
import {
    SUMMER_FEATURE_TREES, SUMMER_VIEWS, summerEye, summerViewFor,
} from '../../src/themes/summer/summer-composition.js';
import { SUMMER_FLOWERS } from '../../src/themes/summer/summer-flowers.js';
import {
    SUMMER_HOUR_COLOURS, SUMMER_HOURS, summerHourAt, summerSunDirection,
} from '../../src/themes/summer/summer-hours.js';
import { SummerForest } from '../../src/themes/summer/summer-forest.js';
import { SummerLife } from '../../src/themes/summer/summer-life.js';
import { SUMMER_MIRROR_LAYER } from '../../src/themes/summer/summer-lake.js';
import { SUMMER_BREEZE, SUMMER_SUN_DIRECTION } from '../../src/themes/summer/summer-light.js';
import { SUMMER_PARTICLES } from '../../src/themes/summer/summer-petal-sim.js';
import { createSummerPetalGeometry } from '../../src/themes/summer/summer-petals.js';
import { SummerPost } from '../../src/themes/summer/summer-post.js';
import { SUMMER_TIERS } from '../../src/themes/summer/summer-quality.js';
import {
    SUMMER_PIECE_FLOWERS, SUMMER_WASH_SECONDS, SummerReactions,
} from '../../src/themes/summer/summer-reactions.js';
import { SUMMER_DEFAULT_BOARD, SUMMER_STAGE_DEPTH } from '../../src/themes/summer/summer-stage.js';
import {
    SUMMER_BOUNDS, SUMMER_PLACES, SUMMER_TERRACES, summerGroundHeight, summerShoreDistance, summerShores,
} from '../../src/themes/summer/summer-terrain.js';
import {
    SUMMER_WEATHER_HOLD, SUMMER_WEATHER_SECONDS, SUMMER_WEATHERS,
} from '../../src/themes/summer/summer-weather.js';
import { SummerWorld } from '../../src/themes/summer/summer-world.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { REDUCED_FLASH_SCALE, holdFlashing } from '../../src/utils/photosensitivity.js';

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
const { petal: PETAL, glow: GLOW } = SUMMER_PARTICLES;
// The parts of the world the lake mirrors, in the order the world builds them; the meadow
// lies behind its own crest as the lake sees it and is left out.
const MIRRORED = ['terrain', 'forest', 'backdrop', 'atmosphere', 'homestead', 'shore', 'life'];
// Hung near the eye: their images would land on the meadow, so they stay out of the mirror whole.
const UNMIRRORED = ['garlands', 'petals'];
const PARTS = [...MIRRORED, ...UNMIRRORED, 'meadow', 'lake'];
// Small things the half-size, rippled mirror never shows, or whose image lies under them: pollen,
// the fine streaks of a sun shower, butterflies, and the lily pads lying flat on the water.
const SPECKS = /^(SummerPollen|SummerRain|SummerButterflies|SummerLilies [01])$/;
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

function createWorld(quality, assets, {
    seed = SEED, aspect = LANDSCAPE, track = true, samples,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 3400);
    const world = new SummerWorld({
        scene, camera, quality, rng: seededRandom(seed), assets, samples,
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
    render = vi.fn(), renderer = fakeRenderer(render), light, scene, camera, samples,
} = {}) {
    const options = {
        renderer,
        scene: scene ?? new THREE.Scene(),
        camera: camera ?? new THREE.PerspectiveCamera(),
        quality,
    };
    if (light !== undefined) options.light = light;
    if (samples !== undefined) options.samples = samples;
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
        // A summer's eve: the sun low over the lake in front of the camera, and left of the
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
        // The rain of a sun shower: one instanced draw in the air, more drops than motes on every
        // tier, light blended over the scene like the pollen, and never a caster of shadow.
        const [rain, ...moreRain] = named(world.group, 'SummerRain');
        expect(moreRain).toEqual([]);
        expect(rain).toBe(world.atmosphere.rain);
        expect(rain.parent).toBe(world.atmosphere.group);
        expect(rain.isInstancedMesh).toBe(true);
        expect(rain.count).toBeGreaterThan(tier.motes);
        expect(rain.count).toBeLessThanOrEqual(tier.motes * 3);
        expect(rain.material.blending).toBe(THREE.AdditiveBlending);
        expect(rain.frustumCulled).toBe(false);

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
            'maypole ribbons', 'maypole posies', 'fence']) {
            expect(named(world.homestead.group, `Summer ${prop}`), prop).toHaveLength(1);
        }
        // The posies tied to the pole are painted by the maypole's own shader (their heads are
        // lanterns with the rest of it) and stand in the sun like the pole: they cast its shadow.
        const [posies] = named(world.homestead.group, 'Summer maypole posies');
        expect(posies).toBe(world.homestead.posies);
        expect(posies.material).toBe(named(world.group, 'Summer maypole')[0].material);
        expect(posies.castShadow).toBe(true);
        expect(posies.geometry.index).toBeNull();
        expect(posies.geometry.attributes.position.count % 3).toBe(0);
        expect(posies.geometry.attributes.position.count).toBeGreaterThan(300);
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
            swans: { afloat: 2, cygnets: tier.swans[0], flying: 0 },
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
        expect(scenery.length - flagged.length).toBeGreaterThan(30);
        // Besides the specks, only draws of the woods opt out, and every one of them says which it is.
        const woods = drawables(world.forest.group);
        const specks = flagged.filter((object) => SPECKS.test(object.name));
        expect(specks.map((object) => object.name).sort())
            .toEqual(['SummerButterflies', 'SummerLilies 0', 'SummerLilies 1', 'SummerPollen', 'SummerRain']);
        // The rain is the air's: it falls in front of the eye, where its image would land on the meadow.
        expect(specks.find((object) => object.name === 'SummerRain')).toBe(world.atmosphere.rain);
        expect(flagged.every((object) => woods.includes(object) || specks.includes(object))).toBe(true);
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
        expect(flagged.length).toBeGreaterThan(specks.length);
        for (const mesh of flagged.filter((object) => woods.includes(object))) {
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

        // The garlands and the petals are not mirrored at all ...
        for (const part of UNMIRRORED) {
            let parts = 0;
            world[part].group.traverse((object) => {
                expect(object.layers.isEnabled(SUMMER_MIRROR_LAYER), `${part}: ${object.name}`).toBe(false);
                parts += 1;
            });
            expect(parts, part).toBeGreaterThan(1);
        }
        // ... nor is the meadow ...
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
        // Every drawable is accounted for: mirrored, or one of those exceptions.
        const near = UNMIRRORED.flatMap((part) => drawables(world[part].group));
        for (const mesh of drawables(world.group)) {
            const excepted = flagged.includes(mesh) || mesh === world.lake.mesh
                || drawables(world.meadow.group).includes(mesh) || near.includes(mesh);
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
        // Ten ribbons hang from it: three from the end of each arm and four from the top of the
        // pole, a hand's breadth wide, blue and yellow by turns, no two the same length on one anchor.
        const [ribbons] = named(world.homestead.group, 'Summer maypole ribbons');
        const { position, uv, cloth } = ribbons.geometry.attributes;
        const strips = new Map();
        for (let vertex = 0; vertex < position.count; vertex++) {
            const phase = cloth.getZ(vertex);
            if (!strips.has(phase)) {
                strips.set(phase, {
                    anchor: new THREE.Vector3().fromBufferAttribute(position, vertex),
                    hue: cloth.getX(vertex),
                    length: 0,
                });
            }
            const strip = strips.get(phase);
            strip.length = Math.max(strip.length, uv.getY(vertex));
            // Every vertex of a ribbon sits on its anchor (the shader hangs it from there), half the width to a side.
            expect(new THREE.Vector3().fromBufferAttribute(position, vertex).distanceTo(strip.anchor)).toBe(0);
            expect(Math.abs(uv.getX(vertex))).toBeCloseTo(0.05, 6);
            expect(cloth.getX(vertex)).toBe(strip.hue);
        }
        const hung = [...strips.values()];
        expect(hung).toHaveLength(10);
        const fromAnchor = (key) => hung.filter((strip) => strip.anchor.distanceTo(at(key)) < 0.2);
        expect(fromAnchor('armLeft')).toHaveLength(3);
        expect(fromAnchor('armRight')).toHaveLength(3);
        expect(fromAnchor('top')).toHaveLength(4);
        for (const key of ['armLeft', 'armRight', 'top']) {
            const lengths = fromAnchor(key).map((strip) => strip.length);
            expect(new Set(lengths.map((length) => length.toFixed(3))).size).toBe(lengths.length);
            for (const length of lengths) {
                expect(length).toBeGreaterThan(1.2);
                // Never long enough to trail on the mown ring.
                expect(length).toBeLessThan(at(key).y - foot);
            }
            const hues = fromAnchor(key).map((strip) => strip.hue);
            expect(new Set(hues)).toEqual(new Set([0, 1]));
        }
        expect(hung.filter((strip) => strip.hue === 0)).toHaveLength(5);
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
        // Let the first frames' redraws pass, as a renderer would: each frame's render draws the map
        // (the first redraws count draws: shared/static-shadow-draws.js).
        for (let frame = 0; frame < 12; frame += 1) {
            world.update(frame / 60, 1 / 60, { hour: 0 });
            shadow.needsUpdate = false;
        }
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

    it('quickens the swallows\' wingbeat and the creatures\' rounds without a jump', () => {
        const light = { uTime: { value: 0 } };
        const life = new SummerLife({ light, tier: { butterflies: 0, birds: 0 } });
        const TAU = Math.PI * 2;
        let flap = life.uFlap.value;
        let clock = life.uSwallowClock.value;
        // A quad startles the flock in one frame and the fever lets it go: the beat only ever
        // moves on by a frame's worth, however the startle jumps.
        for (let step = 0; step < 600; step++) {
            light.uTime.value += STEP;
            const flock = step > 100 && step < 300 ? 1 : 0;
            const fever = step > 200 && step < 400 ? 1 : 0;
            life.update({ flock }, STEP, {
                flock, flutter: flock, level: fever, fever, motion: 1,
            });
            const moved = (life.uFlap.value - flap + TAU) % TAU;
            expect(moved).toBeGreaterThan(13 * STEP - 1e-9);
            expect(moved).toBeLessThanOrEqual(18 * STEP + 1e-9);
            flap = life.uFlap.value;
            // The swallows' own clock runs at least as fast as time, and never jumps.
            const advanced = life.uSwallowClock.value - clock;
            expect(advanced).toBeGreaterThanOrEqual(STEP - 1e-9);
            expect(advanced).toBeLessThan(STEP * 2.1);
            clock = life.uSwallowClock.value;
        }
        // Hurried through the fever; back to their own pace after it, and on a reset.
        expect(life.hurried.swallows).toBeGreaterThan(0.5);
        life.reset();
        expect(life.hurried).toEqual({ butterflies: 0, swallows: 0 });
        // Reduce motion keeps them close to their rounds.
        life.update({}, STEP, {
            flock: 1, flutter: 1, level: 1, fever: 1, motion: 0.35,
        });
        expect(life.uStartle.value).toBeCloseTo(0.35, 12);
        expect(life.uFlutter.value).toBeCloseTo(0.35, 12);
    });

    it('builds through a chain: the evening freshens, deepens and dances, then breathes back', async () => {
        const { world } = await buildWorld('Low');
        const reactions = new SummerReactions({ quality: 'Low', rng: seededRandom(5) });
        advance(world, reactions, 0.25);
        const { light, homestead, life } = world;
        const knobs = () => ({
            wind: light.uWind.value,
            festival: homestead.uFestival.value,
            sunBlue: light.uSunColor.value.b,
            haze: light.uHaze.value,
            hurried: life.hurried.swallows + life.hurried.butterflies,
            shimmer: world.lake.uShimmer.value,
        });
        // At rest the evening is exactly as it always was.
        const resting = knobs();
        expect(resting.wind).toBe(SUMMER_BREEZE);
        expect(resting.festival).toBe(0);
        expect(resting.hurried).toBe(0);
        const clear = (n) => {
            reactions.onHardDrop({ distance: 16 });
            reactions.onPieceLock({
                piece: {
                    x: n % 8, y: 20, shape: [[1, 1]], shapeKey: 'O',
                },
            });
            reactions.onLineClear(n === 11 ? 4 : 1 + (n % 3), { clearedRows: [22, 23], cascadeCount: 1 });
            advance(world, reactions, 0.64);
        };
        clear(0);
        const first = knobs();
        for (let n = 1; n < 12; n++) clear(n);
        const last = knobs();
        expect(reactions.getFrame().surge.stage).toBe(3);
        // A chain reads hotter than its first clear: the breeze freshens, the sun deepens toward
        // gold and the air clears, the swallows and butterflies are hurried on, the lanterns dance.
        expect(last.wind).toBeGreaterThan(first.wind + 0.15);
        expect(last.sunBlue).toBeLessThan(first.sunBlue * 0.9);
        expect(last.haze).toBeLessThan(first.haze);
        expect(last.hurried).toBeGreaterThan(first.hurried + 0.5);
        expect(last.festival).toBeGreaterThan(0.5);
        expect(first.festival).toBeLessThan(0.1);
        expect(last.shimmer).toBeGreaterThanOrEqual(first.shimmer);
        // The hands rest: within seconds the evening is calm again (the creatures keep the ground
        // they made up, at their own pace once more).
        advance(world, reactions, 10);
        const calm = knobs();
        expect(calm.wind - SUMMER_BREEZE).toBeLessThan(0.02);
        expect(reactions.getFrame().surge.stage).toBe(0);
        expect(calm.festival).toBeLessThan(0.03);
        expect(calm.sunBlue).toBeCloseTo(resting.sunBlue, 1);
        const pace = calm.hurried;
        advance(world, reactions, 1);
        expect(knobs().hurried - pace).toBeLessThan(0.1);
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
        // The swallows go up and the light warms over a moment, not in one frame: a quad lifts the
        // flock instead of teleporting it.
        expect(world.life.uStartle.value).toBeLessThan(0.2);
        expect(world.light.uWarmth.value).toBeGreaterThan(0);
        let startle = 0;
        let warmth = 0;
        let last = world.life.uStartle.value;
        let jump = 0;
        advance(world, reactions, 1, () => {
            const now = world.life.uStartle.value;
            jump = Math.max(jump, Math.abs(now - last));
            last = now;
            startle = Math.max(startle, now);
            warmth = Math.max(warmth, world.light.uWarmth.value);
        });
        expect(startle).toBeGreaterThan(0.6);
        expect(jump).toBeLessThan(0.06);
        expect(warmth).toBeGreaterThan(0.5);
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
            60: () => { reactions.onCombo(5); reactions.onTwist({ piece: piece('T', 8, 12) }); },
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
        reactions.onTwist({ piece: piece('T', 1) });
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

describe('Summer world weather, dusk and the level-up\'s wave', () => {
    /** The single-player score panel as it stands right of the board on a 16:9 screen. */
    const SCORE_PANEL = Object.freeze({
        x0: 0.624, x1: 0.772, y0: 0.19, y1: 0.49,
    });
    /** A moment into the n-th weather, while it still holds as itself. */
    const during = (index) => index * SUMMER_WEATHER_SECONDS + 1;

    it('wears the weather its own clock has reached, fair at the start, and keeps the hour\'s colours', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const state = light.weather;
        const wears = (weather, label) => {
            const close = (actual, expected) => actual.forEach(
                (value, index) => expect(value, `${label}[${index}]`).toBeCloseTo(expected[index], 12),
            );
            // The sky: the low cumulus and its height, the row above it, the high deck; then the
            // mackerel field, the cirrus and the fan of rays (the last is the hour's: the white night).
            close(light.uSky.value.toArray(), [weather.low, weather.tall, weather.mid, weather.deck]);
            close(light.uSky2.value.toArray().slice(0, 3), [weather.mackerel, weather.cirrus, weather.rays]);
            // The air: mist, rain, how deep a cloud's shadow is, how veiled the sun.
            close(light.uAir.value.toArray(), [weather.mist, weather.rain, weather.shade, weather.veil]);
            expect(light.uRuffle.value, label).toBeCloseTo(weather.ruffle, 12);
            // The breeze at rest is the weather's, and the haze the hour's own times the weather's share.
            expect(light.uWind.value, label).toBeCloseTo(weather.wind, 12);
            expect(light.uHaze.value, label).toBeCloseTo(light.hour.haze * weather.haze, 12);
        };
        const [fair] = SUMMER_WEATHERS;
        // Before any frame and on the first: the fair evening the scene was built in.
        wears(fair, 'built');
        expect(light.uWind.value).toBe(SUMMER_BREEZE);
        expect(light.uHaze.value).toBe(SUMMER_HOURS[0].haze);
        world.update(0, 0, {});
        wears(fair, 'first frame');
        expect(light.weatherPin).toBeNull();
        // Each weather in its turn, as the clock reaches it, and fair again when the wheel has come round.
        SUMMER_WEATHERS.forEach((weather, index) => {
            world.update(during(index), STEP, {});
            wears(weather, weather.id);
            expect(light.weather.phase).toBeCloseTo(during(index) / SUMMER_WEATHER_SECONDS, 9);
        });
        world.update(during(SUMMER_WEATHERS.length), STEP, {});
        wears(fair, 'round again');
        // Half way through a turn: half way between the two.
        const turning = (2 + SUMMER_WEATHER_HOLD + (1 - SUMMER_WEATHER_HOLD) / 2) * SUMMER_WEATHER_SECONDS;
        world.update(turning, STEP, {});
        const [towers, shower] = [SUMMER_WEATHERS[2], SUMMER_WEATHERS[3]];
        expect(light.uAir.value.y).toBeCloseTo(0.5, 9);
        expect(light.uSky.value.x).toBeCloseTo((towers.low + shower.low) / 2, 9);
        expect(light.uWind.value).toBeCloseTo((towers.wind + shower.wind) / 2, 9);
        // The weather changes the air, never the hour's own colours or its lamps.
        const colours = () => Object.values(light.hourUniforms).map((uniform) => uniform.value.toArray());
        world.update(during(0), STEP, { hour: 1 });
        const inFair = colours();
        world.update(during(4), STEP, { hour: 1 });
        expect(colours()).toEqual(inFair);
        expect(light.uLamps.value).toBe(SUMMER_HOURS[1].lamps);
        expect(light.uHaze.value).toBeCloseTo(SUMMER_HOURS[1].haze * SUMMER_WEATHERS[4].haze, 12);
        // Nothing was rebuilt to change it: one state, written into every frame.
        expect(light.weather).toBe(state);
        // A haze override (a playground knob) is the haze, whatever the weather.
        light.hazeOverride = 0.004;
        world.update(during(4), STEP, {});
        expect(light.uHaze.value).toBe(0.004);
        light.hazeOverride = null;
        // Time that is no time leaves the weather where the clock last stood.
        world.update(during(3), STEP, {});
        for (const junk of [NaN, undefined, null, 'later']) {
            world.update(junk, STEP, {});
            wears(SUMMER_WEATHERS[3], String(junk));
        }
    }, SLOW);

    it('holds the weather at a pinned phase for a capture, and lets the clock run again without one', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        SUMMER_WEATHERS.forEach((weather, index) => {
            light.weatherPin = index;
            // Whatever the clock says.
            world.update(during((index + 2) % SUMMER_WEATHERS.length), STEP, {});
            expect(light.uAir.value.y, weather.id).toBe(weather.rain);
            expect(light.uSky.value.y, weather.id).toBe(weather.tall);
            expect(light.uWind.value, weather.id).toBeCloseTo(weather.wind, 12);
            expect(light.weather.phase).toBe(index);
        });
        // A phase between two, and one round the wheel.
        light.weatherPin = SUMMER_WEATHERS.length + 3;
        world.update(0, STEP, {});
        expect(light.uAir.value.y).toBe(1);
        // Anything that is no phase lets the weather turn by the clock.
        for (const pin of [null, undefined, NaN, 'shower', Infinity]) {
            light.weatherPin = pin;
            world.update(during(1), STEP, {});
            expect(light.uWind.value, String(pin)).toBeCloseTo(SUMMER_WEATHERS[1].wind, 12);
        }
    }, SLOW);

    it('says how far into the white night the hour stands, for what only shows then', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const nightAt = (hour) => {
            world.update(1, STEP, { hour });
            return light.uSky2.value.w;
        };
        const night = SUMMER_HOURS.findIndex((hour) => hour.id === 'white-night');
        expect(nightAt(0)).toBe(0);
        expect(nightAt(night)).toBeGreaterThan(0.5);
        expect(nightAt(night)).toBeLessThanOrEqual(1);
        // Deepest at the white night itself, coming on and going through the hours beside it.
        SUMMER_HOURS.forEach((hour, index) => {
            const depth = nightAt(index);
            expect(depth, hour.id).toBeGreaterThanOrEqual(0);
            expect(depth, hour.id).toBeLessThanOrEqual(nightAt(night));
        });
        let previous = 0;
        for (let phase = night - 1; phase <= night; phase += 0.1) {
            const depth = nightAt(phase);
            expect(depth).toBeGreaterThanOrEqual(previous - 1e-12);
            previous = depth;
        }
        // And where the sun stands in the sky's own layout: its bearing from straight ahead and
        // the tangent of its height, hour by hour.
        SUMMER_HOURS.forEach((hour, index) => {
            world.update(1, STEP, { hour: index });
            const radians = THREE.MathUtils.degToRad;
            expect(light.uSunSky.value.x, hour.id).toBeCloseTo(radians(hour.sunAzimuth), 12);
            expect(light.uSunSky.value.y, hour.id).toBeCloseTo(Math.tan(radians(hour.sunElevation)), 12);
            const direction = light.uSunDir.value;
            expect(Math.atan2(direction.x, -direction.z)).toBeCloseTo(light.uSunSky.value.x, 9);
            expect(direction.y / Math.hypot(direction.x, direction.z)).toBeCloseTo(light.uSunSky.value.y, 9);
        });
    }, SLOW);

    it('carries the clouds and their shadows on at the weather\'s pace, and rewinds them for a capture', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const offset = light.uCloudOffset.value;
        expect(light.uCloudDrift.value).toBe(0);
        expect(offset.toArray()).toEqual([0, 0]);
        const run = (seconds, pin = 0) => {
            light.weatherPin = pin;
            const before = { drift: light.uCloudDrift.value, x: offset.x, y: offset.y };
            for (let step = 0; step < Math.round(seconds / STEP); step++) world.update(1, STEP, {});
            return { drift: light.uCloudDrift.value - before.drift, x: offset.x - before.x, y: offset.y - before.y };
        };
        const fair = run(2);
        expect(fair.drift).toBeGreaterThan(0);
        // The shadows travel the way the wind blows.
        const wind = light.uWindDir.value;
        expect(fair.x * wind.x + fair.y * wind.z).toBeGreaterThan(0);
        expect(fair.x / fair.y).toBeCloseTo(wind.x / wind.z, 9);
        // Every weather at its own pace: the fresh breeze hurries them, the mackerel sky hardly moves.
        SUMMER_WEATHERS.forEach((weather, index) => {
            const moved = run(2, index);
            expect(moved.drift / fair.drift, weather.id).toBeCloseTo(weather.drift / SUMMER_WEATHERS[0].drift, 6);
            expect(moved.x / fair.x, weather.id).toBeCloseTo(weather.drift / SUMMER_WEATHERS[0].drift, 6);
        });
        // No time, no travel; and a hitch is a short step, not a leap across the sky.
        const still = { drift: light.uCloudDrift.value, x: offset.x, y: offset.y };
        for (const dt of [0, -1, NaN, undefined, null, 'soon', -Infinity]) world.update(1, dt, {});
        expect({ drift: light.uCloudDrift.value, x: offset.x, y: offset.y }).toEqual(still);
        light.weatherPin = 0;
        world.update(1, 60, {});
        const hitch = light.uCloudDrift.value - still.drift;
        expect(hitch).toBeGreaterThan(0);
        expect(hitch).toBeLessThan(fair.drift);
        // An evening long: the shadows' offset stays inside one tile of the noise, the drift only grows.
        let previous = light.uCloudDrift.value;
        light.weatherPin = 1;
        for (let step = 0; step < 4000; step++) {
            light.step(0.25);
            expect(Math.abs(offset.x)).toBeLessThan(1);
            expect(Math.abs(offset.y)).toBeLessThan(1);
            expect(light.uCloudDrift.value).toBeGreaterThan(previous);
            previous = light.uCloudDrift.value;
        }
        expect(Number.isFinite(previous)).toBe(true);
        // Switching effects off (or a new session) does not move the sky ...
        const before = { drift: light.uCloudDrift.value, x: offset.x, y: offset.y };
        world.resetEffects();
        light.reset();
        expect({ drift: light.uCloudDrift.value, x: offset.x, y: offset.y }).toEqual(before);
        // ... a capture's seek does: back to where a session starts, in the vector the shaders hold.
        light.rewind();
        expect(light.uCloudDrift.value).toBe(0);
        expect(light.uCloudOffset.value).toBe(offset);
        expect(offset.toArray()).toEqual([0, 0]);
    }, SLOW);

    it('brings the dusk down over a few seconds when the session is over, and lifts it for the next', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        world.update(0, 0, {});
        expect(world.worn.dusk).toBe(0);
        const settled = [];
        for (let step = 0; step < 60 * 8; step++) {
            world.update(step * STEP, STEP, { settled: true });
            settled.push(world.worn.dusk);
            // The light rig wears what the world has eased.
            expect(light.dusk).toBe(world.worn.dusk);
        }
        // Only ever deeper, never at once, and all but down within a few seconds.
        for (let step = 1; step < settled.length; step++) expect(settled[step]).toBeGreaterThan(settled[step - 1]);
        expect(settled[0]).toBeLessThan(0.05);
        expect(settled[59]).toBeGreaterThan(0.2);
        expect(settled[59]).toBeLessThan(0.7);
        expect(settled.at(-1)).toBeGreaterThan(0.9);
        expect(settled.at(-1)).toBeLessThanOrEqual(1);
        // What dusk is: mist off the water and a veiled sun where the weather had neither, the
        // wind gone still and the lake flat.
        const { dusk } = world.worn;
        const [fair] = SUMMER_WEATHERS;
        expect(fair.mist).toBe(0);
        expect(light.uAir.value.x).toBeGreaterThan(0.4);
        expect(light.uAir.value.w).toBeGreaterThan(0.3);
        expect(light.uAir.value.y).toBe(0);
        expect(light.uWind.value).toBeLessThan(fair.wind * 0.5);
        expect(light.uWind.value).toBeGreaterThan(0);
        expect(light.uRuffle.value).toBeLessThan(fair.ruffle * 0.6);
        // Never less mist or veil than the weather's own.
        light.weatherPin = SUMMER_WEATHERS.findIndex((weather) => weather.id === 'mist');
        world.update(9, STEP, { settled: true });
        expect(light.uAir.value.x).toBe(SUMMER_WEATHERS[light.weatherPin].mist);
        light.weatherPin = null;
        // The next session starts: the dusk lifts, sooner than it fell.
        const lifting = [];
        for (let step = 0; step < 60 * 5; step++) {
            world.update(9 + step * STEP, STEP, { settled: false });
            lifting.push(world.worn.dusk);
        }
        for (let step = 1; step < lifting.length; step++) expect(lifting[step]).toBeLessThan(lifting[step - 1]);
        expect(lifting[59]).toBeLessThan(dusk * 0.4);
        expect(lifting[59]).toBeLessThan(1 - settled[59]);
        expect(lifting.at(-1)).toBeLessThan(0.01);
        expect(light.uAir.value.x).toBeLessThan(0.01);
        expect(light.uWind.value).toBeCloseTo(fair.wind, 2);
        // Only a session that is really over brings it down: anything but `true` is play.
        for (const junk of ['true', 1, {}, null, undefined]) {
            for (let step = 0; step < 30; step++) world.update(20, STEP, { settled: junk });
            expect(world.worn.dusk, String(junk)).toBeLessThan(0.01);
        }
        // A frame with no time in it (the first frame of a rebuilt scene, a seek) shows it as it stands.
        world.update(20, 0, { settled: true });
        expect(world.worn.dusk).toBe(1);
        expect(light.dusk).toBe(1);
        expect(light.uAir.value.x).toBeGreaterThan(0.5);
        // Forgetting every effect in flight lifts it at once.
        world.resetEffects();
        expect(world.worn.dusk).toBe(0);
        world.update(20, STEP, {});
        expect(light.dusk).toBeLessThan(0.05);
    }, SLOW);

    it('lets it rain only in the sun shower: the rain is in the scene while it falls or is warmed', async () => {
        const { world } = await buildWorld('Minimal');
        const { light, atmosphere } = world;
        const { rain } = atmosphere;
        expect(named(world.group, 'SummerRain')).toEqual([rain]);
        // Built hidden: nothing is drawn of it before the first frame.
        expect(rain.visible).toBe(false);
        expect(rain.userData.unmirrored).toBe(true);
        expect(rain.layers.isEnabled(SUMMER_MIRROR_LAYER)).toBe(false);
        expect(rain.castShadow).toBe(false);
        // The first few frames draw it (at no strength: there is no rain in fair weather) so its
        // pipeline exists before the first shower; then it is out of the scene.
        const shown = [];
        for (let frame = 0; frame < 20; frame++) {
            world.update(frame * STEP, STEP, {});
            shown.push(rain.visible);
            expect(light.uAir.value.y).toBe(0);
        }
        expect(shown[0]).toBe(true);
        const warmed = shown.lastIndexOf(true) + 1;
        expect(warmed).toBeGreaterThanOrEqual(2);
        expect(warmed).toBeLessThanOrEqual(6);
        expect(shown.slice(0, warmed).every(Boolean)).toBe(true);
        expect(shown.slice(warmed).some(Boolean)).toBe(false);
        // The shower, by the pin of a capture and by the weather's own clock.
        const shower = SUMMER_WEATHERS.findIndex((weather) => weather.id === 'shower');
        light.weatherPin = shower;
        world.update(1, STEP, {});
        expect(light.uAir.value.y).toBe(1);
        expect(rain.visible).toBe(true);
        light.weatherPin = null;
        world.update(1, STEP, {});
        expect(rain.visible).toBe(false);
        world.update(during(shower), STEP, {});
        expect(rain.visible).toBe(true);
        // No other weather has it ...
        SUMMER_WEATHERS.forEach((weather, index) => {
            world.update(during(index), STEP, {});
            expect(rain.visible, weather.id).toBe(index === shower);
        });
        // ... but it comes on as the towers turn to the shower and thins out into the mist after it.
        const turn = (index, share) => (index + SUMMER_WEATHER_HOLD + (1 - SUMMER_WEATHER_HOLD) * share)
            * SUMMER_WEATHER_SECONDS;
        world.update(turn(shower - 1, 0.5), STEP, {});
        expect(rain.visible).toBe(true);
        world.update(turn(shower, 0.5), STEP, {});
        expect(rain.visible).toBe(true);
        world.update(turn(shower, 0.999), STEP, {});
        expect(rain.visible).toBe(false);
        // Built hidden behind the theme now playing: drawn (unseen) all the while, then not.
        world.update(1, STEP, {});
        expect(rain.visible).toBe(false);
        world.setWarming(true);
        expect(atmosphere.warming).toBe(true);
        for (let frame = 0; frame < 30; frame++) {
            world.update(1 + frame * STEP, STEP, {});
            expect(rain.visible).toBe(true);
        }
        world.setWarming(false);
        world.update(2, STEP, {});
        expect(rain.visible).toBe(false);
        for (const junk of ['yes', 1, {}, null, undefined]) {
            world.setWarming(junk);
            world.update(2, STEP, {});
            expect(rain.visible, String(junk)).toBe(false);
        }
        // Dusk at the end of a session lays mist, not rain.
        world.update(2, 0, { settled: true });
        expect(rain.visible).toBe(false);
    }, SLOW);

    it('sends fronts of the breeze\'s own through the meadow when the weather blows fresh, by the clock', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const frontAt = (time, frame = {}) => {
            world.update(time, STEP, frame);
            return { x: light.uFront2.value.z, push: light.uFront2.value.w };
        };
        const crossings = (seconds) => {
            const found = [];
            let open = null;
            for (let time = 0.02; time < seconds; time += 0.05) {
                const front = frontAt(time);
                if (front.push > 0) {
                    if (!open) {
                        open = { from: time, fronts: [] };
                        found.push(open);
                    }
                    open.fronts.push(front);
                    open.to = time;
                } else open = null;
            }
            return found;
        };
        // Fair weather, and every weather calmer than a fresh breeze: none.
        for (const weather of SUMMER_WEATHERS.filter((entry) => entry.id !== 'breeze')) {
            light.weatherPin = SUMMER_WEATHERS.indexOf(weather);
            expect(crossings(20), weather.id).toEqual([]);
        }
        // The breeze: one sets out every so many seconds and crosses the view with the wind.
        light.weatherPin = SUMMER_WEATHERS.findIndex((weather) => weather.id === 'breeze');
        const found = crossings(40);
        expect(found.length).toBeGreaterThanOrEqual(3);
        const starts = found.map((crossing) => crossing.from);
        const period = starts[1] - starts[0];
        expect(period).toBeGreaterThan(5);
        expect(period).toBeLessThan(15);
        for (let index = 2; index < starts.length; index++) {
            expect(starts[index] - starts[index - 1]).toBeCloseTo(period, 1);
        }
        for (const crossing of found.slice(0, -1)) {
            // A couple of seconds each, with a rest between two: from the upwind side to the downwind.
            expect(crossing.to - crossing.from).toBeGreaterThan(1.5);
            expect(crossing.to - crossing.from).toBeLessThan(period * 0.6);
            const xs = crossing.fronts.map((front) => front.x);
            for (let index = 1; index < xs.length; index++) expect(xs[index]).toBeGreaterThan(xs[index - 1]);
            expect(xs[0]).toBeLessThan(-20);
            expect(xs.at(-1)).toBeGreaterThan(20);
            // It swells in and dies away, and is a gentler thing than a front the game sends.
            const pushes = crossing.fronts.map((front) => front.push);
            const peak = pushes.indexOf(Math.max(...pushes));
            expect(peak).toBeGreaterThan(pushes.length * 0.15);
            expect(peak).toBeLessThan(pushes.length * 0.85);
            expect(Math.max(...pushes)).toBeLessThan(1);
            expect(pushes[0]).toBeLessThan(Math.max(...pushes) * 0.5);
        }
        // Read off the clock: a seek shows the same front in the same place, and so does a period later.
        const at = frontAt(starts[1] + 1);
        expect(frontAt(starts[1] + 1)).toEqual(at);
        frontAt(3.3);
        expect(frontAt(starts[1] + 1)).toEqual(at);
        const later = frontAt(starts[1] + 1 + period * 2);
        expect(later.x).toBeCloseTo(at.x, 1);
        // Reduce motion calms it with the rest of the wind.
        world.setMotion(0.5);
        expect(frontAt(starts[1] + 1).push).toBeCloseTo(at.push / 2, 9);
        world.setMotion(1);
        // The game's own fronts come first: when it has three crossing, the third slot is its.
        const game = [-0.5, 0, 0.5].map((position) => ({ position, direction: 1, strength: 0.6 }));
        const taken = frontAt(starts[1] + 1, { front: game[2], fronts: game });
        expect(taken.x).toBeCloseTo(0.5 * world.stage.halfWidth(40), 9);
        expect(taken.push).toBeCloseTo(0.6 * 2, 9);
        // With two of the game's, the breeze has the third.
        const shared = frontAt(starts[1] + 1, { front: game[1], fronts: game.slice(0, 2) });
        expect(shared).toEqual(at);
        expect(light.uFront2.value.y).toBeCloseTo(0.6 * 2, 9);
        // When the session is over the wind dies, the breeze's fronts with it.
        world.update(starts[1] + 1, 0, { settled: true });
        expect(light.uFront2.value.w).toBe(0);
    }, SLOW);

    it('rolls the level-up\'s wave of bloom out from the eye, through the meadow and on across the lake', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const wash = light.uWash.value;
        const washAt = (crossed) => {
            world.update(1, STEP, { wash: crossed });
            return [wash.x, wash.y];
        };
        /** Where the front is (metres from the eye) and how strong, for a share of the way across. */
        const waveOf = (c) => [2 + 95 * c + 195 * c ** 3, Math.min(1, 9 * c) * (1 - c) ** 0.7];
        // No wave crossing: nothing, whatever stands in for "none".
        expect([wash.x, wash.y]).toEqual([0, 0]);
        for (const none of [-1, -0.2, undefined, null, NaN, Infinity, -Infinity, 'half']) {
            expect(washAt(none), String(none)).toEqual([0, 0]);
        }
        // It sets out at the eye with no strength yet ...
        expect(washAt(0)).toEqual([2, 0]);
        let previous = washAt(0);
        let strongest = 0;
        for (let crossed = 0.01; crossed <= 1.0001; crossed += 0.01) {
            const [distance, strength] = washAt(crossed);
            const [expectedDistance, expectedStrength] = waveOf(Math.min(1, crossed));
            expect(distance).toBeCloseTo(expectedDistance, 9);
            expect(strength).toBeCloseTo(expectedStrength, 9);
            // ... runs only ever away from the eye, never stronger than full ...
            expect(distance).toBeGreaterThan(previous[0]);
            expect(strength).toBeGreaterThanOrEqual(0);
            expect(strength).toBeLessThanOrEqual(1);
            strongest = Math.max(strongest, strength);
            previous = [distance, strength];
        }
        // ... is at its strongest early, in the meadow, and has spent itself at the far shore.
        expect(strongest).toBeGreaterThan(0.8);
        expect(washAt(0.12)[1]).toBeGreaterThan(washAt(0.6)[1]);
        expect(washAt(1)[1]).toBe(0);
        expect(washAt(1)[0]).toBeGreaterThan(250);
        // Faster over the lake than through the grass: the second half covers most of the way.
        const [half] = washAt(0.5);
        expect(washAt(1)[0] - half).toBeGreaterThan(half * 2);
        // Past the far shore is the far shore.
        expect(washAt(7)).toEqual(washAt(1));
        // The vector the shaders hold is the one it writes into.
        expect(light.uWash.value).toBe(wash);

        // Through the director: a level-up sends it, and it is gone when its time is up.
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        advance(world, reactions, 0.2);
        expect([wash.x, wash.y]).toEqual([0, 0]);
        reactions.onLevelUp({ level: 2 });
        let front = 0;
        let seen = 0;
        advance(world, reactions, SUMMER_WASH_SECONDS - 0.1, () => {
            expect(wash.x).toBeGreaterThan(front);
            front = wash.x;
            seen = Math.max(seen, wash.y);
        });
        expect(front).toBeGreaterThan(200);
        expect(seen).toBeGreaterThan(0.8);
        advance(world, reactions, 0.3);
        expect([wash.x, wash.y]).toEqual([0, 0]);
        // The level alone (effects off) turns the hour and sends no wave.
        reactions.setLevel(3);
        advance(world, reactions, 0.3);
        expect([wash.x, wash.y]).toEqual([0, 0]);
    }, SLOW);

    it('sends a skein of swans up once for each level-up\'s flourish, and none for a session it takes up', async () => {
        const { world, tier } = await buildWorld('Minimal');
        const { swans } = world;
        const takeWing = vi.spyOn(swans, 'takeWing');
        let clock = 0;
        const frame = (state) => {
            clock += STEP;
            world.update(clock, STEP, state);
        };
        expect(world.flightsSeen).toBeNull();
        expect(swans.counts()).toEqual({ afloat: 2, cygnets: tier.swans[0], flying: 0 });
        // Frames that say nothing of flights, or nothing usable: no count is read and nothing flies.
        for (const state of [{}, undefined, { flights: undefined }, { flights: NaN }, { flights: 'two' },
            { flights: null }, { flights: Infinity }]) {
            frame(state);
            expect(world.flightsSeen).toBeNull();
        }
        expect(takeWing).not.toHaveBeenCalled();
        // The first frame that carries a count only records it: a scene rebuilt in the middle of a
        // session does not send the swans up for the level-ups that came before it.
        frame({ flights: 3 });
        expect(world.flightsSeen).toBe(3);
        expect(takeWing).not.toHaveBeenCalled();
        // The same count, frame after frame, and a frame without one in between: still nothing.
        for (let step = 0; step < 30; step++) frame(step % 7 === 3 ? {} : { flights: 3 });
        expect(takeWing).not.toHaveBeenCalled();
        expect(world.flightsSeen).toBe(3);
        expect(swans.counts().flying).toBe(0);
        // One more level-up has asked for its flourish: one skein, in the air that very frame.
        frame({ flights: 4 });
        expect(takeWing).toHaveBeenCalledOnce();
        expect(takeWing).toHaveBeenLastCalledWith();
        expect(takeWing).toHaveLastReturnedWith(true);
        expect(world.flightsSeen).toBe(4);
        const { flying } = swans.counts();
        expect(flying).toBeGreaterThan(0);
        expect(flying).toBeLessThanOrEqual(tier.swans[1]);
        // Not again while the count stands, however long the skein is in the air.
        for (let step = 0; step < 60; step++) frame({ flights: 4 });
        expect(takeWing).toHaveBeenCalledOnce();
        expect(swans.counts().flying).toBe(flying);
        // Each rise is one call, whether or not a skein is already up, and however far it rose.
        frame({ flights: 5 });
        expect(takeWing).toHaveBeenCalledTimes(2);
        frame({ flights: 9 });
        expect(takeWing).toHaveBeenCalledTimes(3);
        expect(world.flightsSeen).toBe(9);
        expect(swans.counts().flying).toBe(flying);
        // A new session counts from nothing: the count falling back sends none, the next rise does.
        frame({ flights: 0 });
        expect(takeWing).toHaveBeenCalledTimes(3);
        expect(world.flightsSeen).toBe(0);
        frame({ flights: 1 });
        expect(takeWing).toHaveBeenCalledTimes(4);
        // Forgetting every effect in flight brings the skein down; the count read so far is kept.
        world.resetEffects();
        expect(swans.counts().flying).toBe(0);
        frame({ flights: 1 });
        expect(takeWing).toHaveBeenCalledTimes(4);
        expect(swans.counts().flying).toBe(0);
    }, SLOW);

    it('lets the swans take wing on a level-up through the director, and not when only the level is set', async () => {
        const { world } = await buildWorld('Minimal');
        const { swans } = world;
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        const takeWing = vi.spyOn(swans, 'takeWing');
        // Play that is no level-up, and the level alone (effects off): the pair stays on the lake.
        reactions.onPieceLock({ piece: piece('I') });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onPerfectClear();
        advance(world, reactions, 0.5);
        reactions.setLevel(4);
        advance(world, reactions, 0.5);
        expect(takeWing).not.toHaveBeenCalled();
        expect(world.flightsSeen).toBe(0);
        expect(swans.counts().flying).toBe(0);
        // The level turns with its flourish: the skein goes up with the wave of bloom.
        reactions.onLevelUp({ level: 5 });
        advance(world, reactions, STEP);
        expect(takeWing).toHaveBeenCalledOnce();
        expect(swans.counts().flying).toBeGreaterThan(0);
        expect(world.light.uWash.value.x).toBeGreaterThan(0);
        advance(world, reactions, 1);
        expect(takeWing).toHaveBeenCalledOnce();
        // The next session starts its own count: its first level-up sends them again.
        reactions.reset();
        world.resetEffects();
        advance(world, reactions, 0.2);
        expect(world.flightsSeen).toBe(0);
        expect(swans.counts().flying).toBe(0);
        reactions.onLevelUp();
        advance(world, reactions, STEP);
        expect(takeWing).toHaveBeenCalledTimes(2);
        expect(swans.counts().flying).toBeGreaterThan(0);
    }, SLOW);

    it('fans the sun\'s rays across the sky for a sunburst, held back where flashes are reduced', async () => {
        const { world } = await buildWorld('Minimal');
        const { light } = world;
        const raysFor = (sunburst) => {
            // (A frame with no time in it wears the envelope as it stands.)
            world.update(1, 0, { sunburst });
            return light.uSunburst.value;
        };
        expect(light.uSunburst.value).toBe(0);
        expect(raysFor(0.8)).toBeCloseTo(0.8, 12);
        expect(raysFor(1)).toBe(1);
        expect(raysFor(40)).toBe(1);
        for (const none of [0, -3, NaN, undefined, null, 'bright']) expect(raysFor(none), String(none)).toBe(0);
        try {
            holdFlashing(true);
            expect(REDUCED_FLASH_SCALE).toBeLessThan(0.2);
            expect(raysFor(0.8)).toBeCloseTo(0.8 * REDUCED_FLASH_SCALE, 12);
            expect(raysFor(1)).toBeCloseTo(REDUCED_FLASH_SCALE, 12);
        } finally {
            holdFlashing(false);
        }
        expect(raysFor(0.8)).toBeCloseTo(0.8, 12);
        // Over time it eases in rather than snapping: a perfect clear's rays open over a moment.
        world.update(1, 0, { sunburst: 0 });
        world.update(1, STEP, { sunburst: 1 });
        expect(light.uSunburst.value).toBeGreaterThan(0);
        expect(light.uSunburst.value).toBeLessThan(0.5);
    }, SLOW);

    it('lights the heart of a sky flower, dimmed where flashes are reduced while its petals fly as ever', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.petals;
        const reactions = new SummerReactions({ quality: 'Low', rng: seededRandom(5) });
        /** What is drawn of every particle in the air: its kind and how bright. */
        const drawn = () => {
            const found = [];
            for (let index = sim.ambient; index < sim.count; index++) {
                if (sim.life[index] > 0) {
                    found.push({ index, kind: sim.kind[index], light: sim.outLook[index * 4 + 3] });
                }
            }
            return found;
        };
        reactions.onPerfectClear();
        // Nothing is lit while the first flower is still climbing.
        advance(world, reactions, 0.3);
        expect(drawn().filter((particle) => particle.kind === GLOW)).toEqual([]);
        advance(world, reactions, 0.4);
        // A frame with no time in it, drawn three times over: as the player has it, with flashes
        // held back, and as before again.
        const still = () => {
            world.update(reactions.time, 0, reactions.getFrame());
            return drawn();
        };
        const full = still();
        const hearts = full.filter((particle) => particle.kind === GLOW);
        expect(hearts.length).toBeGreaterThanOrEqual(1);
        expect(Math.max(...hearts.map((heart) => heart.light))).toBeGreaterThan(0.3);
        // The heart is where its flower is: metres up in the air, and metres across.
        for (const heart of hearts) {
            const ground = Math.max(0, summerGroundHeight(sim.x[heart.index], sim.z[heart.index]));
            expect(sim.y[heart.index]).toBeGreaterThan(ground + 2);
            expect(sim.outPlace[heart.index * 4 + 3]).toBeGreaterThan(0.2);
            expect(sim.outLook[heart.index * 4 + 1]).toBe(GLOW);
        }
        let held;
        try {
            holdFlashing(true);
            held = still();
        } finally {
            holdFlashing(false);
        }
        expect(held).toHaveLength(full.length);
        held.forEach((particle, slot) => {
            const before = full[slot];
            expect(particle.index).toBe(before.index);
            // The lights keep the share a reduced flash keeps; every petal, seed and mote is as it was.
            if (particle.kind === GLOW) expect(particle.light).toBeCloseTo(before.light * REDUCED_FLASH_SCALE, 6);
            else expect(particle.light).toBe(before.light);
        });
        expect(still()).toEqual(full);
        // The petals are there in numbers either way.
        expect(full.filter((particle) => particle.kind === PETAL).length).toBeGreaterThan(50);
    }, SLOW);

    it('sets the maypole\'s ribbons wheeling on a twist, the wheel only ever turning on', async () => {
        const { world } = await buildWorld('Minimal');
        const { homestead } = world;
        const TURN = Math.PI * 2;
        expect(homestead.uWhirl.value).toBe(0);
        expect(homestead.uWhirlTurn.value).toBe(0);
        world.update(1, STEP, {});
        expect([homestead.uWhirl.value, homestead.uWhirlTurn.value]).toEqual([0, 0]);
        // How far the ribbons fly out is the frame's whirl; the wheel turns while they are out.
        world.update(1, STEP, { whirl: 0.6 });
        expect(homestead.uWhirl.value).toBe(0.6);
        const slow = homestead.uWhirlTurn.value;
        expect(slow).toBeGreaterThan(0);
        // The further out, the faster it wheels.
        world.update(1, STEP, { whirl: 1 });
        expect(homestead.uWhirlTurn.value - slow).toBeGreaterThan(slow);
        // Round and round inside one turn, never jumping back but for the wrap.
        let previous = homestead.uWhirlTurn.value;
        let wraps = 0;
        for (let step = 0; step < 60 * 10; step++) {
            world.update(1, STEP, { whirl: 1 });
            const turn = homestead.uWhirlTurn.value;
            expect(turn).toBeGreaterThanOrEqual(0);
            expect(turn).toBeLessThan(TURN);
            if (turn < previous) {
                wraps += 1;
                expect(previous - turn).toBeGreaterThan(TURN * 0.9);
            } else expect(turn - previous).toBeLessThan(0.2);
            previous = turn;
        }
        expect(wraps).toBeGreaterThan(3);
        // The ribbons come to rest where the wheel stands: it does not unwind, and no time is no turn.
        world.update(1, STEP, { whirl: 0 });
        expect(homestead.uWhirl.value).toBe(0);
        expect(homestead.uWhirlTurn.value).toBe(previous);
        for (const dt of [0, NaN, -1, undefined]) world.update(1, dt, { whirl: 1 });
        expect(homestead.uWhirlTurn.value).toBe(previous);
        // In range, and nothing for nonsense.
        world.update(1, 0, { whirl: 9 });
        expect(homestead.uWhirl.value).toBe(1);
        for (const junk of [NaN, -2, 'round', null, undefined, Infinity]) {
            world.update(1, 0, { whirl: junk });
            expect(homestead.uWhirl.value, String(junk)).toBe(0);
        }
        // Reduce motion calms the dance with everything else that moves.
        world.setMotion(0.25);
        world.update(1, 0, { whirl: 0.8 });
        expect(homestead.uWhirl.value).toBeCloseTo(0.2, 12);
        world.setMotion(1);
        // Through the director: a twist, and nothing else, starts it.
        const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(5) });
        reactions.onPieceLock({ piece: piece('T') });
        reactions.onLineClear(2, { clearedRows: [22, 23] });
        advance(world, reactions, 0.5);
        expect(homestead.uWhirl.value).toBe(0);
        reactions.onTwist({ piece: piece('T') });
        advance(world, reactions, 0.5);
        expect(homestead.uWhirl.value).toBeGreaterThan(0.8);
        advance(world, reactions, 30);
        expect(homestead.uWhirl.value).toBe(0);
    }, SLOW);

    it('tells its stage where the score panel stands, so the flowers of a perfect clear open clear of it', async () => {
        const { world, camera } = await buildWorld('Minimal');
        const { stage, director } = world;
        expect(stage.hud).toBeNull();
        const seenAt = (lines) => {
            const heart = director.blossomSpot({ lines }, new THREE.Vector3()).project(camera);
            return (heart.x + 1) / 2;
        };
        const open = [1, 3, 5].map(seenAt);
        world.setHud(SCORE_PANEL);
        expect(stage.hud).toEqual(SCORE_PANEL);
        expect(stage.covered()).toEqual({ x0: SUMMER_DEFAULT_BOARD.x0, x1: SCORE_PANEL.x1 });
        // The board is as it was: only what covers the middle is wider.
        expect(stage.board).toEqual(SUMMER_DEFAULT_BOARD);
        for (const lines of [0, 1, 2, 3, 4, 5]) {
            const x = seenAt(lines);
            expect(x < SUMMER_DEFAULT_BOARD.x0 || x > SCORE_PANEL.x1, `flower ${lines} at ${x}`).toBe(true);
        }
        [1, 3, 5].forEach((lines, index) => expect(seenAt(lines)).not.toBeCloseTo(open[index], 3));
        // A new board keeps the panel; the panel gone (or nonsense) forgets it.
        world.setBoard({
            x0: 0.36, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(stage.covered()).toEqual({ x0: 0.36, x1: SCORE_PANEL.x1 });
        world.setBoard(null);
        for (const none of [null, undefined, 'panel', {}]) {
            world.setHud(SCORE_PANEL);
            world.setHud(none);
            expect(stage.hud, String(none)).toBeNull();
        }
        [1, 3, 5].forEach((lines, index) => expect(seenAt(lines)).toBeCloseTo(open[index], 9));
        // A world that has not been built yet, or has been disposed of, has no stage to tell.
        const unbuilt = createWorld('Minimal', null);
        expect(() => unbuilt.world.setHud(SCORE_PANEL)).not.toThrow();
        world.dispose();
        expect(() => world.setHud(SCORE_PANEL)).not.toThrow();
    }, SLOW);

    it('never plants more sprite trees on the far shores than a tier allows, and nearly as many', () => {
        const impostors = summerImpostorLayout();
        expect(impostors.tiles.length).toBeGreaterThan(0);
        let dearer = Infinity;
        for (const [name, tier] of Object.entries(SUMMER_TIERS)) {
            const counts = [SEED, 1, 77, 4242].map((seed) => {
                const backdrop = new SummerBackdrop({
                    light: null, impostors, tier, rng: seededRandom(seed),
                });
                const cards = backdrop.layout();
                // The shares of the six bands are rounded one by one: never past the tier's own number.
                expect(cards.length, `${name}, seed ${seed}`).toBeLessThanOrEqual(tier.farTrees);
                expect(cards.length, `${name}, seed ${seed}`).toBeGreaterThan(tier.farTrees * 0.9);
                for (const card of cards) {
                    expect([card.x, card.y, card.z, card.scale, card.tone, card.phase, card.yaw].every(Number.isFinite))
                        .toBe(true);
                    expect(impostors.tiles).toContain(card.tile);
                }
                return cards;
            });
            const [cards] = counts;
            // The far shore across the lake is woods: it carries the most of them by far.
            const far = cards.filter((card) => card.z < -290);
            expect(far.length, name).toBeGreaterThan(cards.length * 0.4);
            expect(cards.length, name).toBeLessThanOrEqual(dearer);
            dearer = cards.length;
        }
    });
});

describe('Summer petal geometry', () => {
    const geometry = createSummerPetalGeometry();
    const { position, uv, normal } = geometry.attributes;
    const vertex = (index) => new THREE.Vector3().fromBufferAttribute(position, index);
    const triangles = [];
    for (let index = 0; index < geometry.index.count; index += 3) {
        triangles.push([geometry.index.getX(index), geometry.index.getX(index + 1), geometry.index.getX(index + 2)]);
    }
    const area = ([a, b, c]) => new THREE.Vector3().subVectors(vertex(b), vertex(a))
        .cross(new THREE.Vector3().subVectors(vertex(c), vertex(a))).length() / 2;
    /** The five stations from the claw to the tip: left edge, midrib, right edge. */
    const stations = [0, 1, 2, 3, 4].map((row) => [0, 1, 2].map((column) => vertex(row * 3 + column)));

    it('is fifteen vertices in five stations and sixteen triangles, all inside the unit box', () => {
        expect(position.count).toBe(15);
        expect(uv.count).toBe(15);
        expect(normal.count).toBe(15);
        expect(geometry.index.count).toBe(16 * 3);
        expect(triangles).toHaveLength(16);
        for (let index = 0; index < position.count; index++) {
            const point = vertex(index);
            for (const value of point.toArray()) {
                expect(Number.isFinite(value)).toBe(true);
                expect(Math.abs(value)).toBeLessThanOrEqual(0.5);
            }
            // Laid out 0..1 across and from the claw to the tip, as the shader paints it.
            expect(uv.getX(index)).toBeCloseTo(point.x + 0.5, 6);
            expect(uv.getY(index)).toBeCloseTo(point.y + 0.5, 6);
            expect(uv.getX(index)).toBeGreaterThanOrEqual(0);
            expect(uv.getX(index)).toBeLessThanOrEqual(1);
            expect(uv.getY(index)).toBeGreaterThanOrEqual(0);
            expect(uv.getY(index)).toBeLessThanOrEqual(1);
        }
        // Every triangle names three vertices of the petal, and no triangle twice.
        for (const corners of triangles) {
            for (const corner of corners) expect(Number.isInteger(corner) && corner >= 0 && corner < 15).toBe(true);
            expect(new Set(corners).size).toBe(3);
        }
        expect(new Set(triangles.map((corners) => [...corners].sort((a, b) => a - b).join())).size).toBe(16);
        // It runs the whole length of the box, claw at the foot and tip at the top.
        expect(stations[0][1].y).toBe(-0.5);
        expect(stations[4][1].y).toBe(0.5);
        for (let row = 1; row < stations.length; row++) {
            expect(stations[row][1].y).toBeGreaterThan(stations[row - 1][1].y);
            for (const point of stations[row]) expect(point.y).toBe(stations[row][1].y);
        }
    });

    it('is a petal: a claw that widens to a blade, widest past the middle, closed by a blunt tip', () => {
        const widths = stations.map(([left, , right]) => right.x - left.x);
        // A point at the claw and at the tip, a blade between.
        expect(widths[0]).toBe(0);
        expect(widths[4]).toBe(0);
        for (const width of widths.slice(1, 4)) expect(width).toBeGreaterThan(0.2);
        const widest = widths.indexOf(Math.max(...widths));
        const along = uv.getY(widest * 3 + 1);
        expect(along).toBeGreaterThanOrEqual(0.5);
        expect(along).toBeLessThanOrEqual(0.75);
        // It widens all the way to there and narrows from there on: one blade, no waist.
        for (let row = 1; row <= widest; row++) expect(widths[row]).toBeGreaterThan(widths[row - 1]);
        for (let row = widest + 1; row < widths.length; row++) expect(widths[row]).toBeLessThan(widths[row - 1]);
        // Narrower than it is long, wide enough to read as a petal and not a blade of grass.
        expect(Math.max(...widths)).toBeGreaterThan(0.5);
        expect(Math.max(...widths)).toBeLessThan(1);
        // The blunt tip: the blade is still broad a little under it; the claw comes to a fine point.
        expect(widths[3] / (0.5 - stations[3][1].y)).toBeGreaterThan(widths[1] / (stations[1][1].y + 0.5));
        // A real surface: all but the slivers where the claw and the tip come to a point have area.
        const solid = triangles.filter((corners) => area(corners) > 1e-6);
        expect(solid.length).toBeGreaterThanOrEqual(12);
        expect(solid.reduce((total, corners) => total + area(corners), 0)).toBeGreaterThan(0.25);
    });

    it('is the same on both sides of its midrib, folded along it and cupped', () => {
        for (const [left, middle, right] of stations) {
            // Mirror images about x = 0.
            expect(middle.x).toBe(0);
            expect(left.x).toBe(-right.x);
            expect(left.y).toBe(right.y);
            expect(left.z).toBe(right.z);
            // The midrib lies under the edges (the fold), and nothing dips below the claw.
            expect(middle.z).toBeLessThanOrEqual(left.z);
            expect(middle.z).toBeGreaterThanOrEqual(0);
        }
        for (const [left, middle] of stations.slice(1, 4)) expect(left.z).toBeGreaterThan(middle.z + 0.02);
        // Cupped: the blade rises from the claw.
        expect(stations[2][0].z).toBeGreaterThan(stations[1][0].z);
        expect(stations[0][0].z).toBe(0);
        // Lit as a surface: every vertex a triangle with area uses has a unit normal, and across
        // the blade it leans up out of the cup, away from the midrib on either side.
        const used = new Set(triangles.filter((corners) => area(corners) > 1e-6).flat());
        expect(used.size).toBeGreaterThanOrEqual(13);
        for (const index of used) {
            expect(new THREE.Vector3().fromBufferAttribute(normal, index).length()).toBeCloseTo(1, 5);
        }
        for (const row of [1, 2, 3]) {
            const [left, middle, right] = [0, 1, 2]
                .map((column) => new THREE.Vector3().fromBufferAttribute(normal, row * 3 + column));
            for (const direction of [left, middle, right]) expect(direction.z).toBeGreaterThan(0.9);
            expect(left.x).toBeGreaterThan(0.1);
            expect(right.x).toBeLessThan(-0.1);
            expect(Math.abs(middle.x)).toBeLessThan(Math.abs(left.x));
        }
        for (let index = 0; index < normal.count; index++) {
            expect(new THREE.Vector3().fromBufferAttribute(normal, index).toArray().every(Number.isFinite)).toBe(true);
        }
        // Each call hands out a geometry of its own (the world disposes of the one it draws).
        const other = createSummerPetalGeometry();
        expect(other).not.toBe(geometry);
        expect(Array.from(other.attributes.position.array)).toEqual(Array.from(position.array));
        other.dispose();
    });
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
            quality: 'Minimal', farTrees: 0, butterflies: 0, swallows: 0, swans: null, petals: null, rings: 0, waves: 0,
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
            farTrees: 0, butterflies: 0, swallows: 0, swans: null, petals: null, rings: 0, waves: 0,
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
        vi.spyOn(SummerForest.prototype, 'buildSteps').mockImplementation(function failedBuild() {
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
        // A multisampled scene pass (High up with antialiasing on) primes through a target of the
        // same sample count, so the pipelines it compiles are still the ones the pass will use.
        const msaa = targetRenderer(canvas);
        const { post: smooth } = createPost('High', { ...lit(), renderer: msaa.renderer, samples: 4 });
        expect(smooth.scenePass.options.samples).toBe(4);
        expect(msaa.log.bound[0].samples).toBe(4);
        expect(msaa.log.bound[0].texture.type).toBe(THREE.HalfFloatType);
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

    it('closes the lens and cools the colour as dusk comes down, and carries the shafts on the weather\'s air', () => {
        const { light } = meadow.world;
        const { post } = createPost('High', lit());
        const rest = { dusk: light.dusk, shafts: light.weather.shafts };
        const read = (frame = {}) => {
            post.update(frame);
            return {
                exposure: post.uExposure.value,
                saturation: post.uSaturation.value,
                density: post.godraysNode.density.value,
                ceiling: post.godraysNode.maxDensity.value,
            };
        };
        try {
            light.dusk = 0;
            light.weather.shafts = 1;
            const day = read();
            // The session is over: a little darker and a little cooler, by degrees.
            light.dusk = 0.5;
            const falling = read();
            light.dusk = 1;
            const dusk = read();
            for (const key of ['exposure', 'saturation']) {
                expect(falling[key], key).toBeLessThan(day[key]);
                expect(dusk[key], key).toBeLessThan(falling[key]);
                expect(day[key] - falling[key], key).toBeCloseTo(falling[key] - dusk[key], 9);
            }
            // A dimming of the evening, not a fade to black.
            expect(dusk.exposure).toBeGreaterThan(day.exposure * 0.7);
            expect(dusk.exposure).toBeLessThan(day.exposure * 0.95);
            expect(dusk.saturation).toBeGreaterThan(day.saturation * 0.7);
            // The events still lift the exposure at dusk, in proportion.
            expect(read({ warmth: 1 }).exposure).toBeGreaterThan(dusk.exposure);
            // Out of range or not a number: no dusk.
            for (const junk of [NaN, -3, undefined, null, 'late']) {
                light.dusk = junk;
                expect(read().exposure, String(junk)).toBe(day.exposure);
            }
            light.dusk = 7;
            expect(read().exposure).toBe(dusk.exposure);
            light.dusk = 0;
            // The weather's air: mist holds a shaft of sun, a fresh breeze clears it.
            const dense = (shafts) => {
                light.weather.shafts = shafts;
                return read();
            };
            const [thin, misty] = [dense(0.85), dense(1.6)];
            expect(thin.density).toBeLessThan(day.density);
            expect(misty.density).toBeGreaterThan(day.density);
            expect(misty.density / day.density).toBeCloseTo(1.6, 9);
            // The ceiling follows more gently than the density.
            expect(misty.ceiling).toBeGreaterThan(day.ceiling);
            expect(misty.ceiling / day.ceiling).toBeLessThan(misty.density / day.density);
            expect(thin.ceiling).toBeLessThan(day.ceiling);
            // Neither moves the exposure: the air changes the shafts, not the lens.
            expect(misty.exposure).toBe(day.exposure);
            // A sunburst floods them on top, the same in any weather.
            const burst = (shafts) => {
                light.weather.shafts = shafts;
                const calm = read().density;
                return read({ sunburst: 1 }).density - calm;
            };
            expect(burst(1)).toBeGreaterThan(0);
            expect(burst(1.6)).toBeCloseTo(burst(1), 12);
        } finally {
            light.dusk = rest.dusk;
            light.weather.shafts = rest.shafts;
        }
        // A lens without a light rig has no dusk and no weather: it grades as at rest.
        const { post: bare } = createPost('High', { scene: meadow.scene, camera: meadow.camera });
        bare.update({});
        expect(bare.uExposure.value).toBe(bare.exposure);
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

describe('Summer mirror samples', () => {
    it('takes the scene pass\'s sample count, so a mirrored material builds one pipeline', async () => {
        // From High up with antialiasing on the theme hands its world 4 (shared/scene-antialias.js).
        const { world } = await buildWorld('Minimal', { samples: 4 });
        expect(world.samples).toBe(4);
        expect(world.lake.reflection.reflector.samples).toBe(4);
        // Without it (a single-sampled pass, or no option at all) the mirror stays single-sampled.
        const plain = (await buildWorld('Minimal')).world;
        expect(plain.lake.reflection.reflector.samples).toBe(0);
    });
});
