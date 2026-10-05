import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    FALL_TREE_URLS, disposeFallAssets, fallImpostorLayout, parseFallFoliage, parseFallTree,
} from '../../src/themes/fall/fall-assets.js';
import {
    FALL_FEATURE_TREES, FALL_VIEWS, createFallVisibilityTest, fallViewFor, layoutFallGrove,
} from '../../src/themes/fall/fall-composition.js';
import { FallForest } from '../../src/themes/fall/fall-forest.js';
import { LEAF_AIR, LEAF_IDLE, LEAF_REST } from '../../src/themes/fall/fall-leaf-sim.js';
import { FALL_SUN_DIRECTION } from '../../src/themes/fall/fall-light.js';
import { FallPost } from '../../src/themes/fall/fall-post.js';
import { FALL_TIERS, fallTier } from '../../src/themes/fall/fall-quality.js';
import { FALL_REACTION_LIMITS, FallReactions } from '../../src/themes/fall/fall-reactions.js';
import { FALL_DEFAULT_BOARD, FALL_STAGE_DEPTH } from '../../src/themes/fall/fall-stage.js';
import {
    FALL_GROUND_BOUNDS, fallPathDistance, fallPathX, fallTerrainHeight,
} from '../../src/themes/fall/fall-terrain.js';
import { FallWorld } from '../../src/themes/fall/fall-world.js';

const assetDirectory = new URL('../../src/themes/fall/assets/', import.meta.url);
const TREE_NAMES = Object.keys(FALL_TREE_URLS);
const TIER_NAMES = Object.keys(FALL_TIERS);
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const owned = [];
const bundles = [];
const files = new Map();

function seededRandom(seed = 187) {
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
async function loadBundle({ trees = TREE_NAMES, impostors = true, track = true } = {}) {
    const [foliage, ...gltfs] = await Promise.all([parseGlb('fall-foliage.glb'),
        ...trees.map((name) => parseGlb(`${name}.glb`))]);
    const assets = { foliage: parseFallFoliage(foliage), trees: {}, impostors: null };
    trees.forEach((name, index) => { assets.trees[name] = parseFallTree(gltfs[index], name); });
    if (impostors) {
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
        assets.impostors = { ...fallImpostorLayout(), texture };
    }
    if (track) bundles.push(assets);
    return assets;
}

function createWorld(quality, assets, { seed = 187, aspect = LANDSCAPE, track = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 300);
    const world = new FallWorld({
        scene, camera, quality, rng: seededRandom(seed), assets,
    });
    if (track) owned.push(world);
    return {
        scene, camera, world, assets, tier: FALL_TIERS[quality],
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
    return new Set([...Object.values(assets.foliage.meshes), ...Object.values(assets.trees).map((tree) => tree.bark)]);
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

function eventLeavesInFlight(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index++) {
        if (sim.state[index] === LEAF_AIR) result.push({ x: sim.position[index * 3], y: sim.position[index * 3 + 1] });
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

function createPost(quality = 'Low', {
    render = vi.fn(), light, scene, camera,
} = {}) {
    const renderer = fakeRenderer(render);
    const options = {
        renderer,
        scene: scene ?? new THREE.Scene(),
        camera: camera ?? new THREE.PerspectiveCamera(),
        quality,
    };
    if (light !== undefined) options.light = light;
    const post = new FallPost(options);
    owned.push(post);
    return { ...options, post };
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeFallAssets(assets));
    vi.restoreAllMocks();
});

describe('Fall quality tiers', () => {
    it('describes the same six tiers as the reaction director, with one set of columns', () => {
        expect(TIER_NAMES.sort()).toEqual(Object.keys(FALL_REACTION_LIMITS).sort());
        expect(Object.isFrozen(FALL_TIERS)).toBe(true);
        const columns = Object.keys(FALL_TIERS.High).sort();
        for (const [name, tier] of Object.entries(FALL_TIERS)) {
            expect(Object.keys(tier).sort(), name).toEqual(columns);
            expect(Object.isFrozen(tier)).toBe(true);
            expect(fallTier(name)).toBe(tier);
            for (const size of tier.shadowMap) {
                expect(Number.isInteger(Math.log2(size)), `${name} shadow map ${size}`).toBe(true);
            }
            for (const key of ['groveTrees', 'farTrees', 'litter', 'grass', 'ferns', 'rocks', 'leaves', 'motes',
                'wisps', 'mist']) {
                expect(Number.isInteger(tier[key]) && tier[key] > 0, `${name}.${key}`).toBe(true);
            }
            expect(tier.foliage).toBeGreaterThan(0);
            expect(tier.foliage).toBeLessThanOrEqual(1);
            // The shafts and the bloom live in the RenderPipeline: no pipeline, no shafts.
            if (!tier.post) expect(tier.godrays).toBe(0);
            if (tier.godrays > 0) expect(tier.godraysScale).toBeGreaterThan(0);
            if (tier.post) expect(tier.bloomScale).toBeGreaterThan(0);
        }
        for (const quality of ['low', 'Potato', '', undefined, null, 7]) {
            expect(fallTier(quality)).toBe(FALL_TIERS.High);
        }
    });

    it('never asks a cheaper tier for more than a dearer one', () => {
        const order = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
        expect([...order].sort()).toEqual([...TIER_NAMES].sort());
        for (let index = 1; index < order.length; index++) {
            const cheaper = FALL_TIERS[order[index]];
            const dearer = FALL_TIERS[order[index - 1]];
            for (const key of ['groveTrees', 'farTrees', 'foliage', 'litter', 'grass', 'ferns', 'rocks', 'leaves',
                'motes', 'wisps', 'mist', 'godrays', 'godraysScale', 'bloomScale']) {
                expect(cheaper[key], `${order[index]}.${key}`).toBeLessThanOrEqual(dearer[key]);
            }
            const texels = (tier) => tier.shadowMap[0] * tier.shadowMap[1];
            expect(texels(cheaper)).toBeLessThanOrEqual(texels(dearer));
            expect(Number(cheaper.post)).toBeLessThanOrEqual(Number(dearer.post));
            expect(Number(Boolean(cheaper.twigs))).toBeLessThanOrEqual(Number(Boolean(dearer.twigs)));
        }
    });
});

describe('Fall composition and ground', () => {
    it('frames wide screens in landscape and tall screens in portrait', () => {
        expect(fallViewFor(LANDSCAPE)).toBe(FALL_VIEWS.landscape);
        expect(fallViewFor(21 / 9)).toBe(FALL_VIEWS.landscape);
        expect(fallViewFor(4 / 3)).toBe(FALL_VIEWS.landscape);
        expect(fallViewFor(PORTRAIT)).toBe(FALL_VIEWS.portrait);
        expect(fallViewFor(9 / 16)).toBe(FALL_VIEWS.portrait);
        for (const view of Object.values(FALL_VIEWS)) {
            expect(Object.isFrozen(view)).toBe(true);
            expect(view.fov).toBeGreaterThan(20);
            expect(view.fov).toBeLessThan(100);
            expect([...view.position, ...view.target].every(Number.isFinite)).toBe(true);
            // The camera stands at the near end of the grove and looks into it, slightly upward.
            expect(view.target[2]).toBeLessThan(view.position[2]);
            expect(view.target[1]).toBeGreaterThan(view.position[1]);
        }
        // A tall screen sees less to the sides, so it steps back and opens up.
        expect(FALL_VIEWS.portrait.fov).toBeGreaterThan(FALL_VIEWS.landscape.fov);
        expect(FALL_VIEWS.portrait.position[2]).toBeGreaterThan(FALL_VIEWS.landscape.position[2]);
    });

    it('plants the two old trees either side of the board and the same grove for the same seed', () => {
        const maple = FALL_FEATURE_TREES.find((tree) => tree.asset === 'maple-hero');
        const oak = FALL_FEATURE_TREES.find((tree) => tree.asset === 'oak-hero');
        expect(maple.x).toBeLessThan(0);
        expect(oak.x).toBeGreaterThan(0);
        expect(Object.isFrozen(FALL_FEATURE_TREES)).toBe(true);
        const grove = layoutFallGrove(seededRandom(5));
        expect(layoutFallGrove(seededRandom(5))).toEqual(grove);
        expect(layoutFallGrove(seededRandom(6))).not.toEqual(grove);
        expect(grove.length).toBeGreaterThan(Math.max(...Object.values(FALL_TIERS).map((tier) => tier.groveTrees)) - 1);
        // Generated in priority order: a cheaper tier keeps the same forest with fewer trees.
        for (const count of [0, 1, 9, 18, 24]) {
            expect(layoutFallGrove(seededRandom(5), count)).toEqual(grove.slice(0, count));
        }
        const every = [...FALL_FEATURE_TREES, ...grove];
        for (const tree of every) {
            expect(TREE_NAMES).toContain(tree.asset);
            expect([tree.x, tree.z, tree.yaw].every(Number.isFinite)).toBe(true);
            expect(tree.scale).toBeGreaterThan(0.5);
            expect(tree.scale).toBeLessThan(2);
            expect(tree.tone).toBeGreaterThanOrEqual(0);
            expect(tree.tone).toBeLessThanOrEqual(1);
            expect(tree.x).toBeGreaterThan(FALL_GROUND_BOUNDS.minX);
            expect(tree.x).toBeLessThan(FALL_GROUND_BOUNDS.maxX);
            expect(tree.z).toBeGreaterThan(FALL_GROUND_BOUNDS.minZ);
            expect(tree.z).toBeLessThan(FALL_GROUND_BOUNDS.maxZ);
        }
        for (const tree of grove) {
            // The path toward the sun stays open, and no two trunks share a spot.
            expect(fallPathDistance(tree.x, tree.z)).toBeGreaterThan(3);
            for (const other of every) {
                if (other !== tree) expect(Math.hypot(other.x - tree.x, other.z - tree.z)).toBeGreaterThan(3);
            }
        }
        // Even the smallest tier's share of the grove reaches from the foreground into the distance.
        const nearest = grove.slice(0, FALL_TIERS.Minimal.groveTrees);
        expect(nearest.some((tree) => tree.far)).toBe(true);
        expect(nearest.some((tree) => !tree.far)).toBe(true);
    });

    it('recognises what could be on screen and what never is', () => {
        const visible = createFallVisibilityTest();
        expect(visible(0, 5, -30, 1)).toBe(true);
        for (const tree of FALL_FEATURE_TREES) expect(visible(tree.x, 6, tree.z, 2)).toBe(true);
        // Behind the camera, far above it, and far off to the side of the foreground.
        expect(visible(0, 5, 80, 1)).toBe(false);
        expect(visible(0, 400, -10, 1)).toBe(false);
        expect(visible(400, 5, 10, 1)).toBe(false);
        expect(visible(-400, 5, 10, 1)).toBe(false);
        // A big enough thing just outside the frame still counts.
        expect(visible(0, 5, 80, 200)).toBe(true);
    });

    it('lays a finite floor that rises into the distance, with the path running through it', () => {
        const {
            minX, maxX, minZ, maxZ,
        } = FALL_GROUND_BOUNDS;
        const rowHeights = [];
        for (let z = maxZ; z >= minZ; z -= 6) {
            const row = [];
            for (let x = minX; x <= maxX; x += 5) {
                const height = fallTerrainHeight(x, z);
                expect(Number.isFinite(height)).toBe(true);
                expect(Math.abs(height)).toBeLessThan(30);
                // No cliffs: a tree a step away stands at nearly the same height.
                expect(Math.abs(fallTerrainHeight(x + 0.25, z) - height)).toBeLessThan(0.25);
                expect(Math.abs(fallTerrainHeight(x, z - 0.25) - height)).toBeLessThan(0.25);
                row.push(height);
            }
            rowHeights.push(mean(row));
            const centre = fallPathX(z);
            expect(Number.isFinite(centre)).toBe(true);
            expect(centre).toBeGreaterThan(minX);
            expect(centre).toBeLessThan(maxX);
            expect(fallPathDistance(centre, z)).toBe(0);
            expect(fallPathDistance(centre + 4, z)).toBeGreaterThan(fallPathDistance(centre + 1, z));
            expect(fallPathDistance(centre - 4, z)).toBeCloseTo(fallPathDistance(centre + 4, z), 9);
        }
        expect(rowHeights.at(-1)).toBeGreaterThan(rowHeights[0] + 1);
        // Outside the map the functions still answer.
        for (const [x, z] of [[1e4, 0], [0, 1e4], [0, -1e4], [-1e4, -1e4]]) {
            expect(Number.isFinite(fallTerrainHeight(x, z))).toBe(true);
            expect(Number.isFinite(fallPathX(z))).toBe(true);
        }
    });
});

describe('Fall world scene contracts', () => {
    const grove = {};

    beforeAll(async () => {
        const built = await Promise.all(TIER_NAMES.map((quality) => buildWorld(quality, { track: false })));
        TIER_NAMES.forEach((quality, index) => { grove[quality] = built[index]; });
    });

    afterAll(() => {
        Object.values(grove).forEach(({ world, assets }) => {
            world.dispose();
            disposeFallAssets(assets);
        });
    });

    it.each(TIER_NAMES)('builds the complete finite node scene at %s', (quality) => {
        const {
            scene, camera, world, assets, tier,
        } = grove[quality];
        expect(world.tier).toBe(tier);
        expect(scene.children).toEqual([world.group]);
        expect(world.group.parent).toBe(scene);
        for (const part of ['terrain', 'forest', 'understory', 'backdrop', 'atmosphere', 'leaves']) {
            expect(world[part].group.parent, part).toBe(world.group);
        }
        expect(world.light.sun.parent).toBe(world.group);
        expect(world.light.sun.target.parent).toBe(world.group);
        const meshes = drawables(world.group);
        expect(meshes.length).toBeGreaterThan(20);
        world.group.traverse((object) => {
            // Everything drawn is a mesh: no points, lines or sprites with their own material rules.
            expect(Boolean(object.isPoints || object.isLine || object.isSprite), object.name).toBe(false);
        });
        const shared = assetGeometries(assets);
        for (const mesh of meshes) {
            expect(mesh.name).not.toBe('');
            expect(mesh.material.isNodeMaterial, mesh.name).toBe(true);
            expect(mesh.material.isShaderMaterial).not.toBe(true);
            expect(Array.isArray(mesh.material)).toBe(false);
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
        }
        // Bark, sprays and leaves are drawn straight from the shared asset pack.
        for (const mesh of named(world.group, /^Fall(Bark|Foliage|Litter) |^FallLeavesInTheAir$/)) {
            expect(shared.has(mesh.geometry), mesh.name).toBe(true);
        }

        // Light: one low sun whose shadow-casting direction is the one every material shades with.
        const { sun } = world.light;
        expect(sun.castShadow).toBe(true);
        expect(sun.shadow.mapSize.toArray()).toEqual(tier.shadowMap);
        expect(sun.shadow.autoUpdate).toBe(false);
        expect(sun.shadow.needsUpdate).toBe(true);
        const toSun = sun.position.clone().sub(sun.target.position).normalize();
        expect(toSun.distanceTo(FALL_SUN_DIRECTION)).toBeLessThan(1e-9);
        expect(world.light.uSunDir.value.distanceTo(FALL_SUN_DIRECTION)).toBeLessThan(1e-9);
        expect(FALL_SUN_DIRECTION.y).toBeGreaterThan(0);
        expect(FALL_SUN_DIRECTION.length()).toBeCloseTo(1, 12);

        // Trees.
        const { stats, placements } = world.forest;
        expect(stats.trees).toBe(placements.length);
        expect(stats.trees).toBeGreaterThanOrEqual(FALL_FEATURE_TREES.length);
        expect(stats.trees).toBeLessThanOrEqual(FALL_FEATURE_TREES.length + tier.groveTrees);
        expect(placements.slice(0, FALL_FEATURE_TREES.length).map((tree) => tree.asset))
            .toEqual(FALL_FEATURE_TREES.map((tree) => tree.asset));
        const bark = named(world.group, /^FallBark /);
        expect(sum(bark.map((mesh) => mesh.count))).toBe(stats.trees);
        expect(bark.every((mesh) => mesh.castShadow)).toBe(true);
        const sprays = named(world.group, /^FallFoliage /);
        expect(sum(sprays.map((mesh) => mesh.count))).toBe(stats.sprays);
        expect(stats.sprays).toBeGreaterThan(0);
        expect(stats.foliageTriangles).toBe(sum(sprays.map((mesh) => (mesh.geometry.index.count / 3) * mesh.count)));
        // What the forest says it draws is what its bark geometry is set to draw.
        expect(stats.barkTriangles).toBe(sum(bark.map((mesh) => (
            (Math.min(mesh.geometry.index.count, mesh.geometry.drawRange.count) / 3) * mesh.count))));
        // Twigs are last in each bark index buffer; tiers without them stop at the core.
        for (const tree of Object.values(assets.trees)) {
            const drawn = Math.min(tree.bark.index.count, tree.bark.drawRange.count);
            expect(drawn, tree.name).toBe(tier.twigs ? tree.bark.index.count : tree.barkCoreIndices);
        }
        const fullBark = sum(bark.map((mesh) => (mesh.geometry.index.count / 3) * mesh.count));
        if (tier.twigs) expect(stats.barkTriangles).toBe(fullBark);
        else expect(stats.barkTriangles).toBeLessThan(fullBark);

        // The deep forest, the floor and the air.
        const [farTrees] = named(world.group, 'FallDeepForest');
        expect(farTrees.isInstancedMesh).toBe(true);
        expect(farTrees.count).toBe(world.backdrop.count);
        expect(world.backdrop.count).toBeGreaterThan(0);
        expect(world.backdrop.count).toBeLessThanOrEqual(tier.farTrees);
        expect(named(world.group, 'FallWoodedRidges')).toHaveLength(1);
        const litter = named(world.group, /^FallLitter /);
        expect(litter.length).toBeGreaterThan(0);
        expect(sum(litter.map((mesh) => mesh.count))).toBeGreaterThan(0);
        expect(sum(litter.map((mesh) => mesh.count))).toBeLessThanOrEqual(tier.litter + litter.length);
        for (const [name, budget] of [['FallDryGrass', tier.grass], ['FallCopperFerns', tier.ferns],
            ['FallMossyStones', tier.rocks]]) {
            const [mesh] = named(world.group, name);
            expect(mesh.count, name).toBeGreaterThan(0);
            expect(mesh.count, name).toBeLessThanOrEqual(budget);
        }
        expect(named(world.group, 'FallLanternCaps')[0].count).toBeGreaterThan(0);
        expect(named(world.group, 'FallLeafCarpet')).toHaveLength(1);
        expect(named(world.group, 'FallSky')).toHaveLength(1);
        expect(named(world.group, /^FallMistBank /)).toHaveLength(tier.mist);
        expect(named(world.group, 'FallSunMotes')[0].count).toBe(tier.motes);
        expect(named(world.group, 'FallWisps')[0].count).toBe(tier.wisps);

        // Leaves in the air: one draw, fed by the simulation's own buffers.
        const { sim, mesh: leafMesh } = world.leaves;
        expect(sim.count).toBe(tier.leaves);
        expect(sim.ambient + sim.reserve).toBe(tier.leaves);
        expect(sim.ambient).toBeGreaterThan(0);
        expect(sim.reserve).toBeGreaterThan(0);
        expect(named(world.group, 'FallLeavesInTheAir')).toEqual([leafMesh]);
        expect(leafMesh.count).toBe(tier.leaves);
        expect(leafMesh.castShadow).toBe(false);
        expect(world.leaves.positions.array).toBe(sim.outPosition);
        expect(world.leaves.rotations.array).toBe(sim.outRotation);
        expect(world.leaves.positions.count).toBe(tier.leaves);
        expect(allFinite(sim.outPosition) && allFinite(sim.outRotation)).toBe(true);

        expect(world.getDiagnostics()).toEqual({
            quality,
            ...stats,
            farTrees: world.backdrop.count,
            leaves: sim.counts(),
        });
        expect(sum(Object.values(world.getDiagnostics().leaves))).toBe(tier.leaves);

        expect(Number.isFinite(camera.fov)).toBe(true);
        expect(allFinite(Float64Array.from(camera.projectionMatrix.elements))).toBe(true);
        expect(allFinite(Float64Array.from(camera.matrixWorld.elements))).toBe(true);
        expect(world.stage.board).toEqual(FALL_DEFAULT_BOARD);
    });

    it('keeps the same grove and draws less of it as the tier drops', () => {
        const order = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
        for (let index = 1; index < order.length; index++) {
            const cheaper = grove[order[index]].world;
            const dearer = grove[order[index - 1]].world;
            const less = cheaper.getDiagnostics();
            const more = dearer.getDiagnostics();
            for (const key of ['trees', 'sprays', 'foliageTriangles', 'barkTriangles', 'farTrees']) {
                expect(less[key], `${order[index]}.${key}`).toBeLessThanOrEqual(more[key]);
            }
            expect(less.sprays).toBeLessThan(more.sprays);
            expect(cheaper.leaves.sim.count).toBeLessThanOrEqual(dearer.leaves.sim.count);
            expect(drawables(cheaper.group).length).toBeLessThanOrEqual(drawables(dearer.group).length);
            // Changing quality must not rearrange the forest: same seed, same trees, fewer of them.
            const kept = cheaper.forest.placements;
            expect(dearer.forest.placements.slice(0, kept.length)).toEqual(kept);
        }
    });

    it('stands everything on the same analytic ground', () => {
        const { world } = grove.Medium;
        const ground = world.terrain.mesh.geometry.attributes.position;
        let worst = 0;
        for (let index = 0; index < ground.count; index++) {
            const expected = fallTerrainHeight(ground.getX(index), ground.getZ(index));
            worst = Math.max(worst, Math.abs(ground.getY(index) - expected));
        }
        expect(worst).toBeLessThan(1e-4);
        expect(world.terrain.height(3, -20)).toBe(fallTerrainHeight(3, -20));
        const matrix = new THREE.Matrix4();
        const base = new THREE.Vector3();
        let trunks = 0;
        for (const mesh of named(world.group, /^FallBark /)) {
            for (let index = 0; index < mesh.count; index++) {
                mesh.getMatrixAt(index, matrix);
                base.setFromMatrixPosition(matrix);
                expect(base.y).toBeCloseTo(fallTerrainHeight(base.x, base.z), 4);
                trunks += 1;
            }
        }
        expect(trunks).toBe(world.forest.stats.trees);
        for (const mesh of named(world.group, /^FallLitter /)) {
            for (let index = 0; index < mesh.count; index += 7) {
                mesh.getMatrixAt(index, matrix);
                base.setFromMatrixPosition(matrix);
                const lift = base.y - fallTerrainHeight(base.x, base.z);
                expect(lift).toBeGreaterThan(0);
                expect(lift).toBeLessThan(0.2);
            }
        }
        const { sim } = world.leaves;
        let resting = 0;
        for (let index = 0; index < sim.count; index++) {
            if (sim.state[index] !== LEAF_REST) continue;
            const o = index * 3;
            const lift = sim.position[o + 1] - fallTerrainHeight(sim.position[o], sim.position[o + 2]);
            expect(lift).toBeGreaterThan(-1e-3);
            expect(lift).toBeLessThan(0.1);
            resting += 1;
        }
        expect(resting).toBeGreaterThan(0);
        // The far plane holds the sky dome.
        expect(grove.Medium.camera.far).toBeGreaterThan(world.atmosphere.sky.geometry.parameters.radius);
    });

    it('reproduces the same world for the same seed', async () => {
        const first = grove.Minimal.world;
        const { world: second } = await buildWorld('Minimal');
        const { world: other } = await buildWorld('Minimal', { seed: 12345 });
        expect(second.forest.placements).toEqual(first.forest.placements);
        expect(other.forest.placements).not.toEqual(first.forest.placements);
        expect(second.getDiagnostics()).toEqual(first.getDiagnostics());
        const firstMeshes = drawables(first.group);
        const secondMeshes = drawables(second.group);
        expect(secondMeshes.map((mesh) => mesh.name)).toEqual(firstMeshes.map((mesh) => mesh.name));
        secondMeshes.forEach((mesh, index) => {
            if (!mesh.isInstancedMesh) return;
            expect(mesh.count).toBe(firstMeshes[index].count);
            expect(mesh.instanceMatrix.array).toEqual(firstMeshes[index].instanceMatrix.array);
        });
        expect(second.leaves.sim.outPosition).toEqual(first.leaves.sim.outPosition);
    });

    it.each([
        ['landscape', LANDSCAPE], ['ultrawide', 21 / 9], ['square', 1], ['portrait', PORTRAIT], ['tall tablet', 3 / 4],
    ])('frames the camera and the stage for a %s screen', async (_label, aspect) => {
        const { world, camera } = await buildWorld('Minimal');
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        world.prepareCamera(aspect);
        const view = fallViewFor(aspect);
        expect(camera.fov).toBe(view.fov);
        expect(camera.near).toBeGreaterThan(0);
        expect(camera.far).toBeGreaterThan(camera.near);
        expect(camera.position.x).toBe(view.position[0]);
        expect(camera.position.z).toBe(view.position[2]);
        // Eye height is measured from the forest floor under the camera.
        expect(camera.position.y).toBeCloseTo(view.position[1] + fallTerrainHeight(0, view.position[2]), 12);
        const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
        expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-9);
        expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        expect(camera.projectionMatrixInverse.elements.every(Number.isFinite)).toBe(true);
        // The stage follows: the board centre projects back onto the middle of the default card.
        const { stage } = world;
        const centre = stage.centre().project(camera);
        expect(centre.x).toBeCloseTo((FALL_DEFAULT_BOARD.x0 + FALL_DEFAULT_BOARD.x1) - 1, 9);
        expect(centre.y).toBeCloseTo(1 - (FALL_DEFAULT_BOARD.y0 + FALL_DEFAULT_BOARD.y1), 9);
        const halfHeight = FALL_STAGE_DEPTH * Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
        expect(stage.halfWidth()).toBeCloseTo(halfHeight * aspect, 9);
        // Re-framing is repeatable and never moves the camera twice.
        const pose = camera.matrixWorld.clone();
        world.prepareCamera(aspect);
        expect(camera.matrixWorld.equals(pose)).toBe(true);
    });

    it('falls back to the landscape view for an unusable aspect ratio', async () => {
        const { world, camera } = await buildWorld('Minimal');
        const stageBefore = world.stage;
        for (const aspect of [NaN, 0, -1, Infinity, undefined, null, 'wide']) {
            world.prepareCamera(PORTRAIT);
            expect(camera.fov).toBe(FALL_VIEWS.portrait.fov);
            world.prepareCamera(aspect);
            expect(camera.fov).toBe(FALL_VIEWS.landscape.fov);
            expect(camera.position.z).toBe(FALL_VIEWS.landscape.position[2]);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        }
        expect(world.stage).toBe(stageBefore);
    });
});

describe('Fall world in play', () => {
    function playSession(world, quality, frames = 150) {
        const reactions = new FallReactions({ quality, rng: seededRandom(5) });
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
            130: () => reactions.onGameOver(),
        };
        const { sim } = world.leaves;
        const seen = {
            kinds: new Set(),
            fields: new Set(),
            minIdle: sim.counts().idle,
            maxAir: 0,
            peakHeat: 0,
            finite: true,
            front: false,
        };
        for (let frame = 0; frame < frames; frame++) {
            script[frame]?.();
            const state = reactions.update(STEP);
            world.update(reactions.time, STEP, state);
            state.emitters.forEach((emitter) => seen.kinds.add(emitter.kind));
            world.director.fields.forEach((field) => seen.fields.add(field.kind));
            const counts = sim.counts();
            seen.minIdle = Math.min(seen.minIdle, counts.idle);
            seen.maxAir = Math.max(seen.maxAir, counts.air);
            seen.peakHeat = Math.max(seen.peakHeat, world.leaves.uHeat.value);
            seen.front = seen.front || world.light.uFront.value.y > 0;
            seen.finite = seen.finite && allFinite(sim.outPosition) && allFinite(sim.outRotation)
                && allFinite(sim.position) && allFinite(sim.velocity);
        }
        return { reactions, seen };
    }

    it('plays a session of gameplay reactions without creating meshes, geometries or materials', async () => {
        const { world, scene } = await buildWorld('Medium');
        const meshes = drawables(world.group);
        const children = [...world.group.children];
        const before = resources(world.group);
        const counts = meshes.map((mesh) => mesh.count);
        const { sim } = world.leaves;
        const opening = sim.counts();
        const versions = [world.leaves.positions.version, world.leaves.rotations.version];
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
        // The session really happened: every kind of emitter and force field was played.
        expect([...seen.kinds].sort()).toEqual(['clear', 'combo', 'lock', 'shower', 'spin']);
        expect([...seen.fields].sort()).toEqual(['burst', 'jet', 'vortex']);
        expect(seen.front).toBe(true);
        expect(seen.finite).toBe(true);
        expect(seen.minIdle).toBeLessThan(opening.idle);
        expect(seen.maxAir).toBeGreaterThan(opening.air);
        expect(seen.peakHeat).toBeGreaterThan(0);
        // Every frame re-uploads the two leaf buffers, and only moves the clock forward.
        expect(world.leaves.positions.version).toBe(versions[0] + 150);
        expect(world.leaves.rotations.version).toBe(versions[1] + 150);
        expect(world.light.uTime.value).toBeCloseTo(reactions.time, 9);
        expect(sim.time).toBeCloseTo(150 * STEP, 9);
        expect(sum(Object.values(sim.counts()))).toBe(sim.count);
    });

    it('keeps invalid time inputs out of the world clock and bounds scene excitement', async () => {
        const { world } = await buildWorld('Minimal');
        const { light, leaves } = world;
        world.update(4, 0, { gust: 1 });
        const fullGust = light.uGust.value;
        expect(fullGust).toBeGreaterThan(0);
        world.update(4, 0, {
            gust: 2, warmth: -5, shafts: Infinity, glow: NaN, vortex: 0.75, heat: 9,
        });
        expect(light.uTime.value).toBe(4);
        expect(light.uGust.value).toBe(fullGust);
        expect(light.uWarmth.value).toBe(0);
        expect(light.uGlow.value).toBe(0);
        expect(leaves.uHeat.value).toBe(1);
        world.update(4, 0, { warmth: 0.5, glow: 0.25, heat: 0.4 });
        expect(light.uGust.value).toBe(0);
        expect(light.uWarmth.value).toBe(0.5);
        expect(light.uGlow.value).toBe(0.25);
        expect(leaves.uHeat.value).toBe(0.4);
        for (const time of [NaN, Infinity, -Infinity, undefined, null, '9']) world.update(time, 0);
        expect(light.uTime.value).toBe(4);
        expect(leaves.uHeat.value).toBe(0);
        world.update(-5, 0);
        expect(light.uTime.value).toBe(0);
        // Nonsense envelopes never reach the leaves.
        for (let frame = 0; frame < 30; frame++) {
            world.update(frame * STEP, STEP, {
                gust: NaN, warmth: null, glow: -1, vortex: Infinity, heat: 'hot', front: null, emitters: [],
            });
            world.update(frame * STEP, STEP, {
                gust: 1e9, vortex: 1e9, heat: 1e9, emitters: 'none',
            });
        }
        const { sim } = leaves;
        expect(allFinite(sim.outPosition) && allFinite(sim.outRotation) && allFinite(sim.velocity)).toBe(true);
        expect(Number.isFinite(light.uGust.value)).toBe(true);
        expect(light.uFront.value.toArray().every(Number.isFinite)).toBe(true);
    });

    it('does not advance the leaves on a zero or invalid timestep', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.leaves;
        const before = Array.from(sim.outPosition);
        for (const dt of [0, -1, NaN, undefined]) world.update(1, dt, { gust: 1, vortex: 1, emitters: [] });
        expect(sim.time).toBe(0);
        expect(Array.from(sim.outPosition)).toEqual(before);
        world.update(1, STEP, { emitters: [] });
        expect(sim.time).toBeCloseTo(STEP, 12);
    });

    it('returns the leaves to a calm opening state on resetEffects', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.leaves;
        const { reactions } = playSession(world, 'Low', 110);
        expect(sim.counts().idle).toBeLessThan(sim.reserve);
        expect(world.director.serials.size).toBeGreaterThan(0);
        const { version } = world.leaves.positions;

        reactions.reset();
        world.resetEffects();
        expect(sim.time).toBe(0);
        const counts = sim.counts();
        expect(counts).toMatchObject({ idle: sim.reserve, fade: 0 });
        expect(counts.air + counts.rest).toBe(sim.ambient);
        for (let index = 0; index < sim.count; index++) {
            if (index < sim.ambient) expect([LEAF_AIR, LEAF_REST]).toContain(sim.state[index]);
            else {
                expect(sim.state[index]).toBe(LEAF_IDLE);
                expect(sim.outPosition[index * 4 + 3]).toBe(0);
            }
        }
        expect(allFinite(sim.outPosition) && allFinite(sim.outRotation)).toBe(true);
        expect(world.director.fields).toEqual([]);
        expect(world.director.serials.size).toBe(0);
        // The cleared buffers are flagged for upload even though no frame has run.
        expect(world.leaves.positions.version).toBeGreaterThan(version);
        expect(eventLeavesInFlight(sim)).toEqual([]);

        // A new session numbers its events from zero again; its first lock must not be swallowed.
        reactions.onPieceLock({ piece: cell(1, 20) });
        world.update(0, STEP, reactions.update(STEP));
        expect(eventLeavesInFlight(sim).length).toBeGreaterThan(0);
    });

    it('throws its leaves from wherever the board is measured to be, and ignores junk', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.leaves;
        const lockOnRightEdge = () => {
            const reactions = new FallReactions({ quality: 'Minimal', rng: seededRandom(5) });
            world.resetEffects();
            reactions.onPieceLock({ piece: cell(9, 14) });
            for (let frame = 0; frame < 6; frame++) world.update(frame * STEP, STEP, reactions.update(STEP));
            const flying = eventLeavesInFlight(sim);
            expect(flying.length).toBeGreaterThan(0);
            return mean(flying.map((entry) => entry.x));
        };
        const atDefault = lockOnRightEdge();
        expect(atDefault).toBeGreaterThan(0);
        // A card on the far left of the screen: its right edge is left of the view axis.
        world.setBoard({
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        });
        expect(world.stage.board).toEqual({
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        });
        expect(lockOnRightEdge()).toBeLessThan(0);
        for (const junk of [null, undefined, {}, 'board', 42, [], { x0: NaN }, {
            x0: 0.9, x1: 0.1, y0: 0, y1: 1,
        }]) {
            world.setBoard({
                x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
            });
            expect(() => world.setBoard(junk)).not.toThrow();
            expect(world.stage.board).toEqual(FALL_DEFAULT_BOARD);
        }
        // Back at the default card the leaves leave from the right of the view axis again.
        expect(lockOnRightEdge()).toBeGreaterThan(0);
    });
});

describe('Fall world ownership', () => {
    it('builds only once', async () => {
        const { world, scene } = await buildWorld('Minimal');
        const meshes = drawables(world.group);
        const {
            forest, leaves, light, stage, director,
        } = world;
        expect(world.built).toBe(true);
        expect(world.build()).toBe(world);
        expect(world.forest).toBe(forest);
        expect(world.leaves).toBe(leaves);
        expect(world.light).toBe(light);
        expect(world.stage).toBe(stage);
        expect(world.director).toBe(director);
        expect(drawables(world.group)).toEqual(meshes);
        expect(scene.children).toEqual([world.group]);
    });

    it('disposes every owned resource once and leaves the shared assets to their owner', async () => {
        const {
            world, scene, assets,
        } = await buildWorld('Minimal');
        const shared = assetGeometries(assets);
        const { geometries, materials, instanced } = resources(world.group);
        const ownGeometries = [...geometries].filter((geometry) => !shared.has(geometry));
        expect(ownGeometries.length).toBeGreaterThan(5);
        expect(geometries.size - ownGeometries.length).toBeGreaterThan(10);
        const spy = (resource) => vi.spyOn(resource, 'dispose');
        const once = [...ownGeometries, ...materials, ...instanced, world.light.noiseTexture, world.terrain.groundMap]
            .map(spy);
        const borrowed = [...shared, assets.impostors.texture].map(spy);
        const sun = spy(world.light.sun);

        world.dispose();
        world.dispose();
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(sun).toHaveBeenCalledOnce();
        borrowed.forEach((disposal) => expect(disposal).not.toHaveBeenCalled());
        expect(scene.children).toHaveLength(0);
        expect(world.group.parent).toBeNull();
        expect(world.group.children).toHaveLength(0);
        for (const key of ['light', 'terrain', 'forest', 'understory', 'backdrop', 'atmosphere', 'leaves', 'director',
            'stage']) {
            expect(world[key], key).toBeNull();
        }
        expect(() => world.build()).toThrow('Cannot rebuild a disposed FallWorld.');
        expect(scene.children).toHaveLength(0);

        // A disposed world is inert rather than explosive.
        expect(() => {
            world.update(1, STEP, { emitters: [] });
            world.setBoard(FALL_DEFAULT_BOARD);
            world.resetEffects();
        }).not.toThrow();
        expect(world.getDiagnostics()).toEqual({ quality: 'Minimal', farTrees: 0, leaves: null });

        // The bundle is released by whoever loaded it, once.
        disposeFallAssets(assets);
        borrowed.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('needs its assets and says so before touching the scene', async () => {
        const scene = new THREE.Scene();
        const world = new FallWorld({ scene, camera: new THREE.PerspectiveCamera() });
        owned.push(world);
        expect(world.tier).toBe(FALL_TIERS.High);
        expect(() => world.build()).toThrow('[Fall] FallWorld needs its loaded assets before it can build.');
        expect(scene.children).toHaveLength(0);
        expect(world.built).toBe(false);
        // Nothing was half-made: update and diagnostics are still safe.
        expect(() => world.update(0, STEP, { emitters: [] })).not.toThrow();
        expect(world.getDiagnostics()).toEqual({ quality: 'High', farTrees: 0, leaves: null });
        // Once the assets are there the same world builds.
        world.assets = await loadBundle();
        expect(world.build()).toBe(world);
        expect(scene.children).toEqual([world.group]);
    });

    it.each([
        ['leaf_maple', '[Fall] The foliage pack has no "leaf_maple" mesh.'],
        ['oak_spray_1', '[Fall] Foliage mesh "oak_spray_1" is missing from the asset pack.'],
    ])('names the missing mesh when the pack lacks %s and still cleans up', async (mesh, message) => {
        const assets = await loadBundle();
        const removed = assets.foliage.meshes[mesh];
        delete assets.foliage.meshes[mesh];
        const { world, scene } = createWorld('Minimal', assets);
        expect(() => world.build()).toThrow(message);
        const terrain = vi.spyOn(world.terrain.mesh.geometry, 'dispose');
        world.dispose();
        expect(terrain).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(world.group.children).toHaveLength(0);
        removed.dispose();
    });

    // Every part is assigned to the world before it builds, so when a build throws halfway
    // world.dispose() still reaches what that part had already made.
    it('retains ownership of a partially built forest so a failure can be cleaned up', async () => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial();
        const geometryDisposal = vi.spyOn(geometry, 'dispose');
        const materialDisposal = vi.spyOn(material, 'dispose');
        vi.spyOn(FallForest.prototype, 'build').mockImplementation(function failedBuild() {
            this.own(geometry);
            this.own(material);
            this.group.add(new THREE.Mesh(geometry, material));
            throw new Error('partial forest failure');
        });
        const { world, scene } = createWorld('Minimal', await loadBundle());
        expect(() => world.build()).toThrow('partial forest failure');
        expect(world.forest).toBeInstanceOf(FallForest);
        world.dispose();
        world.dispose();
        expect(geometryDisposal).toHaveBeenCalledOnce();
        expect(materialDisposal).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
    });

    it('leaves the scene clean when a part fails half way through its build', async () => {
        vi.spyOn(FallForest.prototype, 'build').mockImplementation(() => {
            throw new Error('partial forest failure');
        });
        const { world, scene } = createWorld('Minimal', await loadBundle());
        expect(() => world.build()).toThrow('partial forest failure');
        // What was finished before the failure is still owned and released.
        const finished = [world.terrain.mesh.geometry, world.terrain.mesh.material, world.light.noiseTexture]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        world.dispose();
        finished.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        expect(() => world.build()).toThrow('Cannot rebuild a disposed FallWorld.');
    });

    // The bark geometry is borrowed from the asset bundle. A tier without twigs narrows its draw
    // range only while that forest exists; dispose() and any later build restore the range the
    // tier wants, so a cached bundle can be reused across tiers.
    it('hands a borrowed asset bundle back as it found it, whatever the tier', async () => {
        const assets = await loadBundle();
        const ranges = () => Object.values(assets.trees).map((tree) => ({ ...tree.bark.drawRange }));
        const pristine = ranges();
        const low = createWorld('Minimal', assets);
        low.world.build();
        low.world.dispose();
        expect(ranges()).toEqual(pristine);
        const high = createWorld('High', assets);
        high.world.build();
        for (const mesh of named(high.world.group, /^FallBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeGreaterThanOrEqual(mesh.geometry.index.count);
        }
    });

    it('builds without the far-tree sprite sheet', async () => {
        const { world } = await buildWorld('Minimal', { impostors: false });
        expect(world.backdrop.count).toBe(0);
        expect(world.getDiagnostics().farTrees).toBe(0);
        expect(named(world.group, 'FallDeepForest')).toEqual([]);
        expect(named(world.group, 'FallWoodedRidges')).toHaveLength(1);
        expect(() => world.update(1, STEP, { emitters: [] })).not.toThrow();
    });

    it('builds a grove from whichever trees were loaded', async () => {
        const { world } = await buildWorld('Minimal', { trees: ['maple-hero', 'birch-grove-a'] });
        const bark = named(world.group, /^FallBark /);
        expect(bark.map((mesh) => mesh.name).sort()).toEqual(['FallBark birch-grove-a', 'FallBark maple-hero']);
        const loaded = ['maple-hero', 'birch-grove-a'];
        expect(world.forest.placements.every((tree) => loaded.includes(tree.asset))).toBe(true);
        expect(world.forest.stats.trees).toBe(sum(bark.map((mesh) => mesh.count)));
        const sprays = named(world.group, /^FallFoliage /);
        expect(sprays.length).toBeGreaterThan(0);
        expect(sprays.every((mesh) => /maple_spray|birch_strand/.test(mesh.name))).toBe(true);
        expect(world.leaves.sim.count).toBe(FALL_TIERS.Minimal.leaves);
        expect(() => world.update(1, STEP, { emitters: [] })).not.toThrow();
    });
});

describe('Fall post tier ownership', () => {
    let grove;

    beforeAll(async () => {
        grove = await buildWorld('High', { track: false });
    });

    afterAll(() => {
        grove.world.dispose();
        disposeFallAssets(grove.assets);
    });

    const lit = () => ({ light: grove.world.light, scene: grove.scene, camera: grove.camera });

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
        expect(grove.world.light.sun.shadow.map).toBeNull();
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
        // of the grove makes the shadow rig exist first.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(post.godraysNode.raymarchSteps.value).toBe(FALL_TIERS.High.godrays);
        expect(post.godraysNode.resolutionScale).toBe(FALL_TIERS.High.godraysScale);
        expect(post.shaftsBlur.isNode).toBe(true);
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
        // The grove's own light is not the lens's to dispose.
        expect(grove.world.light.sun.parent).toBe(grove.world.group);
    });

    it.each(['Medium', 'High', 'Ultra', 'Extreme'])('renders %s through its pipeline only', (quality) => {
        const { renderer, post } = createPost(quality, lit());
        const tier = FALL_TIERS[quality];
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
        const { sun } = grove.world.light;
        sun.shadow.map = { isRenderTarget: true, dispose() {} };
        try {
            const { renderer, post } = createPost('High', lit());
            expect(renderer.render).not.toHaveBeenCalled();
            expect(post.getDiagnostics().godrays).toBe(true);
        } finally {
            sun.shadow.map = null;
        }
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
        expect(post.tier).toBe(FALL_TIERS.High);
        expect(post.disabled).toBe(false);
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
        expect(hot.exposure).toBeLessThan(rest.exposure * 1.5);
    });
});
