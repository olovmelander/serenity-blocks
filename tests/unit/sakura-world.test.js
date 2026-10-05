import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    SAKURA_FOX_URL, SAKURA_TREE_URLS, disposeSakuraAssets, loadSakuraAssets,
} from '../../src/themes/sakura-twilight/sakura-assets.js';
import {
    SAKURA_BRIDGE, SAKURA_FEATURE_TREES, SAKURA_FUJI, SAKURA_GROVE_CEILING, SAKURA_LANTERN_GLOW, SAKURA_PAGODA,
    SAKURA_STONE_LANTERNS, SAKURA_TORII, SAKURA_VIEWS, createSakuraVisibilityTest, layoutSakuraGrove, planPaperLanterns,
    sakuraLampList, sakuraPlacements, sakuraViewFor,
} from '../../src/themes/sakura-twilight/sakura-composition.js';
import { SakuraForest, sakuraLanternReach } from '../../src/themes/sakura-twilight/sakura-forest.js';
import { SAKURA_RING_SLOTS, sakuraMoonDirection } from '../../src/themes/sakura-twilight/sakura-light.js';
import {
    PETAL_AIR, PETAL_FLOAT, PETAL_IDLE, PETAL_REST,
} from '../../src/themes/sakura-twilight/sakura-petal-sim.js';
import { SakuraPost } from '../../src/themes/sakura-twilight/sakura-post.js';
import { SAKURA_TIERS, sakuraTier } from '../../src/themes/sakura-twilight/sakura-quality.js';
import {
    SAKURA_MAX_FOXFIRE, SAKURA_REACTION_LIMITS, SakuraReactions,
} from '../../src/themes/sakura-twilight/sakura-reactions.js';
import { SAKURA_CONSTELLATIONS } from '../../src/themes/sakura-twilight/sakura-sky.js';
import { SAKURA_DEFAULT_BOARD, SAKURA_STAGE_DEPTH } from '../../src/themes/sakura-twilight/sakura-stage.js';
import {
    SAKURA_PATH_SETBACK, SAKURA_TERRAIN_BOUNDS, SAKURA_WATER_LEVEL, createSakuraBedTexture, sakuraLand,
    sakuraPathDistance, sakuraPathZ, sakuraShore, sakuraSurfaceHeight, sakuraTerrainHeight,
} from '../../src/themes/sakura-twilight/sakura-terrain.js';
import { SAKURA_UNMIRRORED_LAYER } from '../../src/themes/sakura-twilight/sakura-water.js';
import { SakuraWorld } from '../../src/themes/sakura-twilight/sakura-world.js';

const assetDirectory = new URL('../../src/themes/sakura-twilight/assets/', import.meta.url);
const TREE_NAMES = Object.keys(SAKURA_TREE_URLS);
const TIER_NAMES = Object.keys(SAKURA_TIERS);
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const WORLD_PARTS = ['terrain', 'sky', 'backdrop', 'forest', 'garden', 'foxes', 'water', 'spirits', 'petals'];
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

function fileNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

async function parseGlb(file) {
    if (!files.has(file)) {
        const bytes = readFileSync(new URL(file, assetDirectory));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return new GLTFLoader().parseAsync(files.get(file).slice(0), '');
}

/**
 * The real asset pack, parsed from disk by the theme's own loader; the sprite sheet is a
 * stand-in data texture. `fox: false` plays a failed fox download.
 */
async function loadBundle({
    trees = TREE_NAMES, impostors = true, fox = true, track = true,
} = {}) {
    const loader = {
        loadAsync: async (url) => {
            if (url === SAKURA_FOX_URL && !fox) throw new Error('404 Fox.glb');
            return parseGlb(fileNameOf(url));
        },
    };
    const textureLoader = impostors
        ? { loadAsync: async () => new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4) }
        : null;
    const assets = await loadSakuraAssets({ trees, loader, textureLoader });
    if (track) bundles.push(assets);
    return assets;
}

function createWorld(quality, assets, { seed = 187, aspect = LANDSCAPE, track = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 4000);
    const world = new SakuraWorld({
        scene, camera, quality, rng: seededRandom(seed), assets,
    });
    if (track) owned.push(world);
    return {
        scene, camera, world, assets, tier: SAKURA_TIERS[quality],
    };
}

async function buildWorld(quality = 'Minimal', options = {}) {
    const built = createWorld(quality, options.assets ?? await loadBundle(options), options);
    built.world.build();
    return built;
}

/** A camera framed the way SakuraWorld.prepareCamera() frames it, for pure composition checks. */
function frameCamera(aspect = LANDSCAPE) {
    const view = sakuraViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 4000);
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

/** Screen position (fractions, y down) of a world point. */
function onScreen(camera, x, y, z) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    return { x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5, ahead: point.z < 1 };
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

/** Everything a world borrows from the bundle and must never dispose. */
function assetGeometries(assets) {
    const geometries = new Set([...Object.values(assets.blossoms.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.fuji.geometry]);
    assets.fox?.scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); });
    return geometries;
}

function allFinite(array) {
    if (!(array instanceof Float32Array || array instanceof Float64Array)) return true;
    for (let index = 0; index < array.length; index += 1) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / values.length;

function instancePositions(mesh) {
    const matrix = new THREE.Matrix4();
    return Array.from({ length: mesh.count }, (_, index) => {
        mesh.getMatrixAt(index, matrix);
        return new THREE.Vector3().setFromMatrixPosition(matrix);
    });
}

/**
 * Where a drawable stands in the world, however it is drawn: one entry for a plain mesh, one
 * for each instance of an instanced one. `yaw` is its turn about the vertical.
 */
function placementsOf(mesh) {
    const matrices = [];
    if (mesh.isInstancedMesh) {
        for (let index = 0; index < mesh.count; index += 1) {
            const matrix = new THREE.Matrix4();
            mesh.getMatrixAt(index, matrix);
            matrices.push(matrix);
        }
    } else {
        mesh.updateMatrix();
        matrices.push(mesh.matrix.clone());
    }
    return matrices.map((matrix) => {
        const position = new THREE.Vector3();
        const turn = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, turn, scale);
        return { position, scale, yaw: new THREE.Euler().setFromQuaternion(turn, 'YXZ').y };
    });
}

function eventPetalsInFlight(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index += 1) {
        if (sim.state[index] === PETAL_AIR) result.push({ x: sim.position[index * 3], y: sim.position[index * 3 + 1] });
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
    render = vi.fn(), light, scene, camera, prime,
} = {}) {
    const renderer = fakeRenderer(render);
    const options = {
        renderer,
        scene: scene ?? new THREE.Scene(),
        camera: camera ?? new THREE.PerspectiveCamera(),
        quality,
    };
    if (light !== undefined) options.light = light;
    if (prime !== undefined) options.prime = prime;
    const post = new SakuraPost(options);
    owned.push(post);
    return { ...options, post };
}

beforeAll(() => {
    // The fox carries a texture; in Node the loader needs somewhere to decode it to.
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4, close() {} }));
});

afterAll(() => {
    vi.unstubAllGlobals();
});

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeSakuraAssets(assets));
    vi.restoreAllMocks();
});

describe('Sakura quality tiers', () => {
    it('describes the same six tiers as the reaction director, with one set of columns', () => {
        expect([...TIER_NAMES].sort()).toEqual(Object.keys(SAKURA_REACTION_LIMITS).sort());
        expect(Object.isFrozen(SAKURA_TIERS)).toBe(true);
        const columns = Object.keys(SAKURA_TIERS.High).sort();
        for (const [name, tier] of Object.entries(SAKURA_TIERS)) {
            expect(Object.keys(tier).sort(), name).toEqual(columns);
            expect(Object.isFrozen(tier)).toBe(true);
            expect(sakuraTier(name)).toBe(tier);
            expect(tier.shadowMap).toHaveLength(2);
            for (const size of tier.shadowMap) {
                expect(Number.isInteger(Math.log2(size)), `${name} shadow map ${size}`).toBe(true);
            }
            for (const key of ['groveTrees', 'farTrees', 'grass', 'petals', 'lamps', 'paperLanterns', 'fireflies',
                'foxfire', 'waterLanterns', 'skyLanterns', 'mist']) {
                expect(Number.isInteger(tier[key]) && tier[key] > 0, `${name}.${key}`).toBe(true);
            }
            expect(tier.foliage).toBeGreaterThan(0);
            expect(tier.foliage).toBeLessThanOrEqual(1);
            expect(tier.mirror).toBeGreaterThanOrEqual(0);
            expect(tier.mirror).toBeLessThanOrEqual(1);
            // The beams and the bloom live in the RenderPipeline: no pipeline, no beams.
            if (!tier.post) expect(tier.godrays).toBe(0);
            if (tier.godrays > 0) expect(tier.godraysScale).toBeGreaterThan(0);
            if (tier.post) expect(tier.bloomScale).toBeGreaterThan(0);
            // The grove never has more trees to give than the composition lays out.
            expect(tier.groveTrees).toBeLessThanOrEqual(SAKURA_GROVE_CEILING);
            // A full combo can light every flame the tier draws.
            expect(tier.foxfire).toBeLessThanOrEqual(SAKURA_MAX_FOXFIRE);
            // A flight released by a level-up never needs more lanterns than there are.
            expect(tier.skyLanterns).toBeGreaterThanOrEqual(3);
        }
        for (const quality of ['low', 'Potato', '', undefined, null, 7]) {
            expect(sakuraTier(quality)).toBe(SAKURA_TIERS.High);
        }
    });

    it('never asks a cheaper tier for more than a dearer one', () => {
        expect([...TIER_ORDER].sort()).toEqual([...TIER_NAMES].sort());
        for (let index = 1; index < TIER_ORDER.length; index += 1) {
            const cheaper = SAKURA_TIERS[TIER_ORDER[index]];
            const dearer = SAKURA_TIERS[TIER_ORDER[index - 1]];
            for (const key of ['groveTrees', 'farTrees', 'foliage', 'grass', 'petals', 'lamps', 'paperLanterns',
                'fireflies', 'foxfire', 'waterLanterns', 'skyLanterns', 'mist', 'mirror', 'godrays', 'godraysScale',
                'bloomScale']) {
                expect(cheaper[key], `${TIER_ORDER[index]}.${key}`).toBeLessThanOrEqual(dearer[key]);
            }
            const texels = (tier) => tier.shadowMap[0] * tier.shadowMap[1];
            expect(texels(cheaper)).toBeLessThanOrEqual(texels(dearer));
            expect(Number(cheaper.post)).toBeLessThanOrEqual(Number(dearer.post));
            expect(Number(Boolean(cheaper.twigs))).toBeLessThanOrEqual(Number(Boolean(dearer.twigs)));
        }
        // The ladder really is a ladder: the top tier draws several times what the bottom one does.
        expect(SAKURA_TIERS.Extreme.petals).toBeGreaterThan(SAKURA_TIERS.Minimal.petals * 2);
        expect(SAKURA_TIERS.Extreme.grass).toBeGreaterThan(SAKURA_TIERS.Minimal.grass * 2);
    });
});

describe('Sakura terrain', () => {
    it('puts the camera on a knoll at the near end of a lake that the far shore closes', () => {
        for (const view of Object.values(SAKURA_VIEWS)) {
            const [x, y, z] = view.position;
            // Dry ground under the camera, and the eye above it.
            expect(sakuraLand(x, z)).toBeGreaterThan(0);
            expect(sakuraTerrainHeight(x, z)).toBeGreaterThan(SAKURA_WATER_LEVEL);
            expect(y - sakuraTerrainHeight(x, z)).toBeGreaterThan(0.5);
            expect(y - sakuraTerrainHeight(x, z)).toBeLessThan(4);
        }
        // Straight ahead the bank ends in a cove and the lake begins.
        const shore = sakuraShore(0);
        expect(shore).toBeLessThan(SAKURA_VIEWS.landscape.position[2]);
        expect(shore).toBeGreaterThan(-20);
        expect(sakuraLand(0, shore + 1)).toBeGreaterThan(0);
        expect(sakuraLand(0, shore - 1)).toBeLessThan(0);
        for (const z of [-10, -30, -60, -100]) {
            expect(sakuraTerrainHeight(0, z), `z ${z}`).toBeLessThan(SAKURA_WATER_LEVEL);
            expect(sakuraSurfaceHeight(0, z)).toBe(SAKURA_WATER_LEVEL);
        }
        // The bank steps forward in a lobe on either side of the cove.
        expect(sakuraShore(-25)).toBeLessThan(shore);
        expect(sakuraShore(25)).toBeLessThan(shore);
        // Two wooded points reach out further back on either side: the hand-placed cherries beyond
        // the two old trees stand on them, with open water between them down the middle.
        const points = SAKURA_FEATURE_TREES.slice(2);
        expect(points.some((tree) => tree.x < 0) && points.some((tree) => tree.x > 0)).toBe(true);
        for (const tree of points) {
            expect(sakuraLand(tree.x, tree.z), tree.asset).toBeGreaterThan(0);
            expect(tree.z).toBeLessThan(shore);
            expect(sakuraLand(0, tree.z), `the middle of the lake at z ${tree.z}`).toBeLessThan(0);
        }
        // And the far shore closes the water.
        for (const x of [-140, -70, 0, 70, 140]) expect(sakuraTerrainHeight(x, -200), `x ${x}`).toBeGreaterThan(0);
    });

    it('is finite, continuous and consistent between its three views of the land', () => {
        const {
            minX, maxX, minZ, maxZ,
        } = SAKURA_TERRAIN_BOUNDS;
        expect(Object.isFrozen(SAKURA_TERRAIN_BOUNDS)).toBe(true);
        let lowest = Infinity;
        let highest = -Infinity;
        let steepest = 0;
        let wet = 0;
        let dry = 0;
        const problems = [];
        for (let z = maxZ; z >= minZ; z -= 2.5) {
            for (let x = minX; x <= maxX; x += 2.5) {
                const height = sakuraTerrainHeight(x, z);
                const land = sakuraLand(x, z);
                if (!Number.isFinite(height) || !Number.isFinite(land)) problems.push(`not finite at ${x}, ${z}`);
                // Inland is above the water, offshore is the lake bed: the two never disagree.
                if ((land > 0) !== (height > SAKURA_WATER_LEVEL)) {
                    problems.push(`land ${land} but height ${height} at ${x}, ${z}`);
                }
                if (sakuraSurfaceHeight(x, z) !== Math.max(SAKURA_WATER_LEVEL, height)) {
                    problems.push(`surface at ${x}, ${z}`);
                }
                if (land > 0) dry += 1;
                else wet += 1;
                lowest = Math.min(lowest, height);
                highest = Math.max(highest, height);
                // No cliffs: a tree a step away stands at nearly the same height.
                steepest = Math.max(
                    steepest,
                    Math.abs(sakuraTerrainHeight(x + 0.25, z) - height),
                    Math.abs(sakuraTerrainHeight(x, z - 0.25) - height),
                );
            }
        }
        expect(problems.slice(0, 5)).toEqual([]);
        expect(steepest).toBeLessThan(0.5);
        // A garden, not a mountain range; and a lake deep enough to hide its bed, but with one.
        expect(highest).toBeGreaterThan(1);
        expect(highest).toBeLessThan(8);
        expect(lowest).toBeLessThan(-1);
        expect(lowest).toBeGreaterThanOrEqual(-4);
        expect(wet).toBeGreaterThan(dry * 0.2);
        expect(dry).toBeGreaterThan(wet * 0.2);
        // Outside the map the functions still answer.
        for (const [x, z] of [[1e4, 0], [0, 1e4], [0, -1e4], [-1e4, -1e4]]) {
            expect(Number.isFinite(sakuraTerrainHeight(x, z))).toBe(true);
            expect(Number.isFinite(sakuraSurfaceHeight(x, z))).toBe(true);
            expect(Number.isFinite(sakuraPathZ(x))).toBe(true);
        }
    });

    it('runs the stepping-stone path along the near shore, set back on dry ground', () => {
        expect(SAKURA_PATH_SETBACK).toBeGreaterThan(1);
        for (let x = -12; x <= 12; x += 0.5) {
            const z = sakuraPathZ(x);
            // It follows the waterline round the cove and both lobes, the same step back from it.
            expect(z - sakuraShore(x)).toBeCloseTo(SAKURA_PATH_SETBACK, 9);
            expect(sakuraPathDistance(x, z)).toBe(0);
            expect(sakuraPathDistance(x, z + 3)).toBeCloseTo(3, 9);
            expect(sakuraPathDistance(x, z - 3)).toBeCloseTo(3, 9);
            expect(sakuraPathDistance(x, z + 4)).toBeGreaterThan(sakuraPathDistance(x, z + 1));
            // The foxes walk a little to either side of it: all of that is above the water.
            for (const lane of [-0.6, 0, 0.6]) {
                expect(sakuraTerrainHeight(x, z + lane), `x ${x} lane ${lane}`).toBeGreaterThan(0.2);
            }
            // Between the camera and the water.
            expect(z).toBeLessThan(SAKURA_VIEWS.landscape.position[2]);
            expect(z).toBeGreaterThan(sakuraShore(x));
        }
    });

    it('bakes the lake bed into a texture the water can read depth from', () => {
        const size = 32;
        const texture = createSakuraBedTexture(size);
        const {
            minX, maxX, minZ, maxZ,
        } = SAKURA_TERRAIN_BOUNDS;
        expect(texture.isDataTexture).toBe(true);
        expect(texture.image).toMatchObject({ width: size, height: size });
        expect(texture.image.data).toHaveLength(size * size * 4);
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        const { data } = texture.image;
        let worst = 0;
        let shallow = 0;
        let deep = 0;
        for (let row = 0; row < size; row += 1) {
            for (let column = 0; column < size; column += 1) {
                const x = minX + ((column + 0.5) / size) * (maxX - minX);
                const z = minZ + ((row + 0.5) / size) * (maxZ - minZ);
                const o = (row * size + column) * 4;
                // Red decodes back to the height in metres over -4..4, to within a byte's step.
                const decoded = (data[o] / 255 - 0.5) * 8;
                worst = Math.max(worst, Math.abs(decoded - Math.max(-4, Math.min(4, sakuraTerrainHeight(x, z)))));
                // Green rises from open water to the bank: where the petals raft together.
                if (sakuraLand(x, z) > 3) expect(data[o + 1]).toBe(255);
                if (sakuraLand(x, z) < -6) expect(data[o + 1]).toBe(0);
                expect(data[o + 3]).toBe(255);
                if (data[o] < 100) deep += 1;
                if (data[o] > 127) shallow += 1;
            }
        }
        expect(worst).toBeLessThan(8 / 255);
        expect(deep).toBeGreaterThan(10);
        expect(shallow).toBeGreaterThan(10);
        // The default map is fine enough to follow the shoreline.
        const full = createSakuraBedTexture();
        expect(full.image.width).toBeGreaterThanOrEqual(128);
        expect((maxX - minX) / full.image.width).toBeLessThan(3);
        texture.dispose();
        full.dispose();
    });
});

describe('Sakura composition', () => {
    it('frames wide screens in landscape and tall screens in portrait', () => {
        expect(sakuraViewFor(LANDSCAPE)).toBe(SAKURA_VIEWS.landscape);
        expect(sakuraViewFor(21 / 9)).toBe(SAKURA_VIEWS.landscape);
        expect(sakuraViewFor(4 / 3)).toBe(SAKURA_VIEWS.landscape);
        expect(sakuraViewFor(1)).toBe(SAKURA_VIEWS.landscape);
        expect(sakuraViewFor(PORTRAIT)).toBe(SAKURA_VIEWS.portrait);
        expect(sakuraViewFor(9 / 16)).toBe(SAKURA_VIEWS.portrait);
        expect(sakuraViewFor(3 / 4)).toBe(SAKURA_VIEWS.portrait);
        for (const view of Object.values(SAKURA_VIEWS)) {
            expect(Object.isFrozen(view)).toBe(true);
            expect(view.fov).toBeGreaterThan(20);
            expect(view.fov).toBeLessThan(100);
            expect([...view.position, ...view.target, ...view.moon].every(Number.isFinite)).toBe(true);
            // The camera stands at the near end of the lake and looks out over it, slightly upward.
            expect(view.target[2]).toBeLessThan(view.position[2]);
            expect(view.target[1]).toBeGreaterThan(view.position[1]);
            // A low moon: above the horizon, well short of overhead.
            expect(view.moon[1]).toBeGreaterThan(0);
            expect(view.moon[1]).toBeLessThan(45);
        }
        // A tall screen sees less to the sides, so it steps back and opens up.
        expect(SAKURA_VIEWS.portrait.fov).toBeGreaterThan(SAKURA_VIEWS.landscape.fov);
        expect(SAKURA_VIEWS.portrait.position[2]).toBeGreaterThan(SAKURA_VIEWS.landscape.position[2]);
    });

    it('points the moon where its azimuth and elevation say', () => {
        const ahead = sakuraMoonDirection(0, 0);
        expect(ahead.toArray().map((value) => Math.round(value * 1e9) / 1e9)).toEqual([0, 0, -1]);
        expect(sakuraMoonDirection(90, 0).x).toBeCloseTo(1, 9);
        expect(sakuraMoonDirection(-90, 0).x).toBeCloseTo(-1, 9);
        expect(sakuraMoonDirection(37, 90).y).toBeCloseTo(1, 9);
        for (const [azimuth, elevation] of [[26.5, 14], [4, 27], [-140, 3], [200, 60]]) {
            const direction = sakuraMoonDirection(azimuth, elevation);
            expect(direction.length()).toBeCloseTo(1, 12);
            expect(direction.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(elevation)), 12);
        }
        const target = new THREE.Vector3();
        expect(sakuraMoonDirection(10, 10, target)).toBe(target);
    });

    it.each([
        ['landscape', LANDSCAPE], ['ultrawide', 21 / 9], ['4:3', 4 / 3], ['portrait', PORTRAIT], ['tall tablet', 3 / 4],
    ])('keeps the moon in the picture on a %s screen', (_label, aspect) => {
        const view = sakuraViewFor(aspect);
        const camera = frameCamera(aspect);
        const moon = camera.position.clone().addScaledVector(sakuraMoonDirection(view.moon[0], view.moon[1]), 500);
        const screen = onScreen(camera, moon.x, moon.y, moon.z);
        expect(screen.ahead).toBe(true);
        expect(screen.x).toBeGreaterThan(0.03);
        expect(screen.x).toBeLessThan(0.97);
        // In the sky, above the middle of the screen.
        expect(screen.y).toBeGreaterThan(0.03);
        expect(screen.y).toBeLessThan(0.5);
    });

    // The board card hides the middle of the screen, so the picture is composed for the two
    // side thirds: the mountain over the torii on the left, the moon over the drum bridge on
    // the right.
    it('composes the landscape picture for the thirds either side of the board card', () => {
        const camera = frameCamera(LANDSCAPE);
        const { x0, x1 } = SAKURA_DEFAULT_BOARD;
        const view = SAKURA_VIEWS.landscape;
        const moonPoint = camera.position.clone().addScaledVector(sakuraMoonDirection(view.moon[0], view.moon[1]), 500);
        const moon = onScreen(camera, moonPoint.x, moonPoint.y, moonPoint.z);
        const peak = onScreen(camera, SAKURA_FUJI.x, SAKURA_FUJI.y + SAKURA_FUJI.height, SAKURA_FUJI.z);
        const torii = onScreen(camera, SAKURA_TORII.x, 3, SAKURA_TORII.z);
        const bridge = onScreen(camera, SAKURA_BRIDGE.x, 1.5, SAKURA_BRIDGE.z);
        const pagoda = onScreen(camera, SAKURA_PAGODA.x, 10, SAKURA_PAGODA.z);
        for (const [name, point] of Object.entries({
            moon, peak, torii, bridge, pagoda,
        })) {
            expect(point.ahead, name).toBe(true);
            expect(point.x, name).toBeGreaterThan(0.02);
            expect(point.x, name).toBeLessThan(0.98);
            expect(point.y, name).toBeGreaterThan(0.02);
            expect(point.y, name).toBeLessThan(0.98);
            // Never behind the card.
            expect(point.x < x0 || point.x > x1, name).toBe(true);
        }
        // Left third: the mountain stands over the torii.
        expect(peak.x).toBeLessThan(x0);
        expect(torii.x).toBeLessThan(x0);
        expect(Math.abs(peak.x - torii.x)).toBeLessThan(0.08);
        expect(peak.y).toBeLessThan(torii.y);
        // Right third: the moon hangs over the bridge.
        expect(moon.x).toBeGreaterThan(x1);
        expect(bridge.x).toBeGreaterThan(x1);
        expect(Math.abs(moon.x - bridge.x)).toBeLessThan(0.08);
        expect(moon.y).toBeLessThan(bridge.y);
        // The mountain is far beyond the map the garden is built on.
        expect(SAKURA_FUJI.z).toBeLessThan(SAKURA_TERRAIN_BOUNDS.minZ);
        expect(SAKURA_FUJI.height).toBeGreaterThan(50);
    });

    it('plants the two old trees either side of the board and the same grove for the same seed', () => {
        const [left, right] = SAKURA_FEATURE_TREES;
        expect(left.x).toBeLessThan(0);
        expect(right.x).toBeGreaterThan(0);
        // Beside the camera, in front of the lens, so their boughs frame the picture.
        for (const hero of [left, right]) {
            expect(hero.z).toBeLessThan(SAKURA_VIEWS.landscape.position[2]);
            expect(Math.hypot(hero.x, hero.z - SAKURA_VIEWS.landscape.position[2])).toBeLessThan(25);
        }
        expect(Object.isFrozen(SAKURA_FEATURE_TREES)).toBe(true);
        const grove = layoutSakuraGrove(seededRandom(5));
        expect(layoutSakuraGrove(seededRandom(5))).toEqual(grove);
        expect(layoutSakuraGrove(seededRandom(6))).not.toEqual(grove);
        // Generated in priority order: a cheaper tier keeps the same garden with fewer trees.
        for (const count of [0, 1, 6, 12, SAKURA_GROVE_CEILING]) {
            expect(layoutSakuraGrove(seededRandom(5), count)).toEqual(grove.slice(0, count));
        }
        const {
            minX, maxX, minZ, maxZ,
        } = SAKURA_TERRAIN_BOUNDS;
        for (const seed of [5, 187, 271]) {
            const planted = layoutSakuraGrove(seededRandom(seed));
            expect(planted.length).toBeLessThanOrEqual(SAKURA_GROVE_CEILING);
            // Enough ground was found for the tiers most players run.
            expect(planted.length).toBeGreaterThanOrEqual(SAKURA_TIERS.High.groveTrees);
            const every = [...SAKURA_FEATURE_TREES, ...planted];
            for (const tree of every) {
                expect(TREE_NAMES).toContain(tree.asset);
                expect([tree.x, tree.z, tree.yaw].every(Number.isFinite)).toBe(true);
                expect(tree.scale).toBeGreaterThan(0.5);
                expect(tree.scale).toBeLessThan(2);
                expect(tree.tone).toBeGreaterThanOrEqual(0);
                expect(tree.tone).toBeLessThanOrEqual(1);
                expect(tree.x).toBeGreaterThan(minX);
                expect(tree.x).toBeLessThan(maxX);
                expect(tree.z).toBeGreaterThan(minZ);
                expect(tree.z).toBeLessThan(maxZ);
                // Trees stand on dry ground.
                expect(sakuraTerrainHeight(tree.x, tree.z), `${tree.asset} at ${tree.x}, ${tree.z}`).toBeGreaterThan(0);
            }
            for (const tree of planted) {
                // A little back from the water's edge, and no two trunks share a spot.
                expect(sakuraLand(tree.x, tree.z)).toBeGreaterThan(1);
                for (const other of every) {
                    if (other !== tree) expect(Math.hypot(other.x - tree.x, other.z - tree.z)).toBeGreaterThan(5);
                }
                expect(typeof tree.far).toBe('boolean');
            }
            // Even the smallest tier's share of the grove stands on both sides of the lake.
            const nearest = planted.slice(0, SAKURA_TIERS.Minimal.groveTrees);
            expect(nearest.some((tree) => tree.x < 0)).toBe(true);
            expect(nearest.some((tree) => tree.x > 0)).toBe(true);
        }
    });

    it('lists every modelled tree with its foot on the ground, hand-placed ones first', () => {
        const all = sakuraPlacements(seededRandom(5));
        const some = sakuraPlacements(seededRandom(5), 4);
        expect(some).toHaveLength(SAKURA_FEATURE_TREES.length + 4);
        expect(all.slice(0, some.length)).toEqual(some);
        expect(sakuraPlacements(seededRandom(5), 0).map((tree) => tree.asset))
            .toEqual(SAKURA_FEATURE_TREES.map((tree) => tree.asset));
        all.forEach((tree, index) => {
            expect(tree.y).toBe(sakuraTerrainHeight(tree.x, tree.z));
            if (index < SAKURA_FEATURE_TREES.length) expect(tree).toMatchObject(SAKURA_FEATURE_TREES[index]);
        });
        // The frozen composition is never written to.
        expect(SAKURA_FEATURE_TREES[0].y).toBeUndefined();
    });

    it('recognises what could be on screen and what never is', () => {
        const visible = createSakuraVisibilityTest();
        expect(visible(0, 5, -30, 1)).toBe(true);
        // Everything the garden is composed around.
        expect(visible(SAKURA_TORII.x, 3, SAKURA_TORII.z, 3)).toBe(true);
        expect(visible(SAKURA_BRIDGE.x, 1.5, SAKURA_BRIDGE.z, 3)).toBe(true);
        expect(visible(SAKURA_PAGODA.x, 10, SAKURA_PAGODA.z, 8)).toBe(true);
        const halfMountain = SAKURA_FUJI.height / 2;
        expect(visible(SAKURA_FUJI.x, SAKURA_FUJI.y + halfMountain, SAKURA_FUJI.z, halfMountain)).toBe(true);
        for (const lantern of SAKURA_STONE_LANTERNS) expect(visible(lantern.x, 1, lantern.z, 1.5)).toBe(true);
        // Behind the camera, far above it, and far off to the side of the foreground.
        expect(visible(0, 5, 80, 1)).toBe(false);
        expect(visible(0, 400, -10, 1)).toBe(false);
        expect(visible(400, 5, 10, 1)).toBe(false);
        expect(visible(-400, 5, 10, 1)).toBe(false);
        // A big enough thing just outside the frame still counts.
        expect(visible(0, 5, 80, 200)).toBe(true);
        // It is conservative: whatever a real framing shows, it accepts.
        for (const aspect of [LANDSCAPE, 21 / 9, PORTRAIT, 3 / 4]) {
            const camera = frameCamera(aspect);
            const point = new THREE.Vector3();
            for (const [sx, sy, depth] of [[0.02, 0.02, 30], [0.98, 0.98, 30], [0.02, 0.98, 120], [0.98, 0.02, 120],
                [0.5, 0.5, 400]]) {
                point.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize()
                    .multiplyScalar(depth)
                    .add(camera.position);
                expect(visible(point.x, point.y, point.z, 0.5), `${aspect} ${sx},${sy}`).toBe(true);
            }
        }
    });

    it('orders the lanterns as light sources: the two by the camera, then paper and stone in turn', () => {
        const stone = sakuraLampList();
        expect(stone).toHaveLength(SAKURA_STONE_LANTERNS.length);
        stone.forEach((lamp, index) => {
            const lantern = SAKURA_STONE_LANTERNS[index];
            const glow = SAKURA_LANTERN_GLOW[lantern.kind];
            expect(lamp).toEqual({
                x: lantern.x,
                y: sakuraTerrainHeight(lantern.x, lantern.z) + glow.height,
                z: lantern.z,
                power: glow.power,
            });
            expect(lamp.power).toBeGreaterThan(0);
        });
        // The first two really are the ones nearest the camera.
        const eye = SAKURA_VIEWS.landscape.position;
        const distance = (lamp) => Math.hypot(lamp.x - eye[0], lamp.z - eye[2]);
        const nearest = [...stone].sort((a, b) => distance(a) - distance(b)).slice(0, 2);
        expect(stone.slice(0, 2)).toEqual(expect.arrayContaining(nearest));

        const paper = [{ x: 1, y: 6, z: 2 }, { x: 3, y: 7, z: 4 }, { x: 5, y: 8, z: 6 }];
        const mixed = sakuraLampList(paper);
        expect(mixed).toHaveLength(stone.length + paper.length);
        expect(mixed.slice(0, 2)).toEqual(stone.slice(0, 2));
        const isPaper = (lamp) => paper.some((hook) => hook.x === lamp.x && hook.z === lamp.z);
        expect(mixed.slice(2, 8).map(isPaper)).toEqual([true, false, true, false, true, false]);
        // The lit paper hangs below its hook.
        mixed.filter(isPaper).forEach((lamp, index) => {
            expect(lamp.y).toBeLessThan(paper[index].y);
            expect(lamp.y).toBeGreaterThan(paper[index].y - 1.5);
            expect(lamp.power).toBeGreaterThan(0);
        });
        // Every lantern appears exactly once, however many there are of each kind.
        for (const lamp of stone) {
            expect(mixed.filter((entry) => entry.x === lamp.x && entry.z === lamp.z)).toHaveLength(1);
        }
        const many = Array.from({ length: 20 }, (_, index) => ({ x: 100 + index, y: 5, z: -index }));
        const crowded = sakuraLampList(many);
        expect(crowded).toHaveLength(stone.length + many.length);
        expect(new Set(crowded.map((lamp) => `${lamp.x},${lamp.z}`)).size).toBe(crowded.length);
        // A tier lights a prefix: even the shortest has both kinds in it.
        const fewest = Math.min(...Object.values(SAKURA_TIERS).map((tier) => tier.lamps));
        expect(crowded.slice(0, fewest).some(isPaperOf(many))).toBe(true);
        expect(crowded.slice(0, fewest).some((lamp) => !isPaperOf(many)(lamp))).toBe(true);
    });

    it('measures how much lantern light reaches a point', () => {
        const lantern = {
            x: 0, y: 2, z: 0, power: 1,
        };
        expect(sakuraLanternReach([], 0, 0, 0)).toBe(0);
        const at = (distance, lanterns = [lantern]) => sakuraLanternReach(lanterns, distance, 2, 0);
        expect(at(0)).toBeCloseTo(1, 9);
        expect(at(2)).toBeLessThan(at(0));
        expect(at(6)).toBeLessThan(at(2));
        expect(at(40)).toBeLessThan(0.001);
        expect(at(40)).toBeGreaterThan(0);
        // The same in every direction, including up and down.
        expect(sakuraLanternReach([lantern], 0, 5, 0)).toBeCloseTo(at(3), 12);
        expect(sakuraLanternReach([lantern], 0, 2, -3)).toBeCloseTo(at(3), 12);
        // Lanterns add up, each by its own power; one without a power counts as one.
        expect(at(2, [lantern, lantern])).toBeCloseTo(at(2) * 2, 12);
        expect(at(2, [{ ...lantern, power: 0.5 }])).toBeCloseTo(at(2) * 0.5, 12);
        expect(at(2, [{ x: 0, y: 2, z: 0 }])).toBeCloseTo(at(2), 12);
    });
});

/** Whether a lamp of sakuraLampList() came from one of these paper-lantern hooks. */
function isPaperOf(hooks) {
    return (lamp) => hooks.some((hook) => hook.x === lamp.x && hook.z === lamp.z);
}

describe('Sakura world scene contracts', () => {
    const garden = {};

    beforeAll(async () => {
        const built = await Promise.all(TIER_NAMES.map((quality) => buildWorld(quality, { track: false })));
        TIER_NAMES.forEach((quality, index) => { garden[quality] = built[index]; });
    }, 120000);

    afterAll(() => {
        Object.values(garden).forEach(({ world, assets }) => {
            world.dispose();
            disposeSakuraAssets(assets);
        });
    });

    it.each(TIER_NAMES)('builds the complete finite node scene at %s', (quality) => {
        const {
            scene, camera, world, assets, tier,
        } = garden[quality];
        expect(world.tier).toBe(tier);
        expect(world.built).toBe(true);
        expect(scene.children).toEqual([world.group]);
        expect(world.group.parent).toBe(scene);
        for (const part of WORLD_PARTS) expect(world[part].group.parent, part).toBe(world.group);
        expect(world.light.moon.parent).toBe(world.group);
        expect(world.light.moon.target.parent).toBe(world.group);
        const meshes = drawables(world.group);
        expect(meshes.length).toBeGreaterThan(30);
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
        // Bark, blossom, petals, furniture, lanterns and the mountain are drawn straight from the pack.
        const borrowed = named(
            world.group,
            /^Sakura(Bark|Blossom|Garden) |^Sakura(PetalsInTheAir|Mountain|LanternsAfloat|SkyLanterns)$/,
        );
        expect(borrowed.length).toBeGreaterThan(20);
        for (const mesh of borrowed) expect(shared.has(mesh.geometry), mesh.name).toBe(true);

        // Light: one low moon whose shadow-casting direction is the one every material shades with.
        const { moon } = world.light;
        const view = sakuraViewFor(camera.aspect);
        const moonward = sakuraMoonDirection(view.moon[0], view.moon[1]);
        expect(moon.castShadow).toBe(true);
        expect(moon.shadow.mapSize.toArray()).toEqual(tier.shadowMap);
        expect(moon.shadow.autoUpdate).toBe(false);
        expect(moon.shadow.needsUpdate).toBe(true);
        expect(moon.position.clone().sub(moon.target.position).normalize().distanceTo(moonward)).toBeLessThan(1e-9);
        expect(world.light.uMoonDir.value.distanceTo(moonward)).toBeLessThan(1e-9);
        // The shadow box holds the garden the camera looks at.
        const shadowCamera = moon.shadow.camera;
        expect(shadowCamera.right - shadowCamera.left).toBeGreaterThan(60);
        expect(shadowCamera.far).toBeGreaterThan(moon.position.distanceTo(moon.target.position));

        // Lanterns: every one in the garden is known, and the tier lights a prefix of them.
        expect(world.paperLanterns.length).toBeGreaterThan(0);
        expect(world.paperLanterns.length).toBeLessThanOrEqual(tier.paperLanterns);
        expect(world.lanterns).toHaveLength(SAKURA_STONE_LANTERNS.length + world.paperLanterns.length);
        expect(world.light.lampCount).toBe(Math.min(tier.lamps, world.lanterns.length));
        expect(world.light.lampList).toEqual(world.lanterns.slice(0, world.light.lampCount));

        // Trees.
        const { stats, placements } = world.forest;
        expect(world.placements).toEqual(placements);
        expect(stats.trees).toBe(placements.length);
        expect(stats.trees).toBeGreaterThanOrEqual(SAKURA_FEATURE_TREES.length);
        expect(stats.trees).toBeLessThanOrEqual(SAKURA_FEATURE_TREES.length + tier.groveTrees);
        expect(placements.slice(0, SAKURA_FEATURE_TREES.length).map((tree) => tree.asset))
            .toEqual(SAKURA_FEATURE_TREES.map((tree) => tree.asset));
        const bark = named(world.group, /^SakuraBark /);
        expect(sum(bark.map((mesh) => mesh.count))).toBe(stats.trees);
        expect(bark.every((mesh) => mesh.castShadow)).toBe(true);
        const sprays = named(world.group, /^SakuraBlossom /);
        expect(sum(sprays.map((mesh) => mesh.count))).toBe(stats.sprays);
        expect(stats.sprays).toBeGreaterThan(0);
        expect(sprays.every((mesh) => mesh.castShadow)).toBe(true);
        // Every specimen shares one bark material and every spray one blossom material, so the
        // grove costs two sets of pipelines however many kinds of tree stand in it. What differs
        // per tree and per spray rides on the geometry, one value for each instance.
        expect(new Set(bark.map((mesh) => mesh.material)).size).toBe(1);
        expect(new Set(sprays.map((mesh) => mesh.material)).size).toBe(1);
        expect(bark[0].material).not.toBe(sprays[0].material);
        for (const mesh of [...bark, ...sprays]) {
            const instanced = Object.values(mesh.geometry.attributes)
                .filter((attribute) => attribute.isInstancedBufferAttribute);
            expect(instanced.length, mesh.name).toBeGreaterThan(0);
        }
        // Wherever per-instance data rides on a geometry it has one value for each instance
        // drawn, and that geometry is drawn by one mesh only: a second would overwrite it.
        const carriers = new Map();
        for (const mesh of meshes) {
            const instanced = Object.entries(mesh.geometry.attributes)
                .filter(([, attribute]) => attribute.isInstancedBufferAttribute);
            if (instanced.length) {
                expect(mesh.isInstancedMesh, mesh.name).toBe(true);
                expect(carriers.has(mesh.geometry), `${mesh.name} and ${carriers.get(mesh.geometry)}`).toBe(false);
                carriers.set(mesh.geometry, mesh.name);
                for (const [key, attribute] of instanced) {
                    expect(attribute.count, `${mesh.name}.${key}`).toBe(mesh.count);
                    expect(allFinite(attribute.array), `${mesh.name}.${key}`).toBe(true);
                }
            }
        }
        expect(stats.blossomTriangles).toBe(sum(sprays.map((mesh) => (mesh.geometry.index.count / 3) * mesh.count)));
        expect(Number.isInteger(stats.culledSprays) && stats.culledSprays >= 0).toBe(true);
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

        // The far side of the lake.
        const [farTrees] = named(world.group, 'SakuraFarShoreTrees');
        expect(farTrees.isInstancedMesh).toBe(true);
        expect(farTrees.count).toBe(world.backdrop.count);
        expect(world.backdrop.count).toBeGreaterThan(0);
        expect(world.backdrop.count).toBeLessThanOrEqual(tier.farTrees);
        expect(named(world.group, 'SakuraMountain')).toHaveLength(1);
        expect(named(world.group, 'SakuraHills')).toHaveLength(1);

        // The garden's furniture and its grass.
        const stoneLanterns = named(world.group, /^SakuraGarden (stone|snow)_lantern$/);
        expect(sum(stoneLanterns.map((mesh) => mesh.count))).toBe(SAKURA_STONE_LANTERNS.length);
        const [paper] = named(world.group, 'SakuraGarden paper_lantern');
        expect(paper.count).toBe(world.paperLanterns.length);
        // Paper lanterns swing; a static shadow map could not follow them.
        expect(paper.castShadow).toBe(false);
        for (const landmark of ['torii', 'bridge', 'pagoda']) {
            // One of each, however it is drawn, and each throws a shadow.
            const drawn = named(world.group, `SakuraGarden ${landmark}`);
            expect(drawn, landmark).toHaveLength(1);
            expect(placementsOf(drawn[0]), landmark).toHaveLength(1);
            expect(drawn[0].castShadow).toBe(true);
        }
        const rocks = named(world.group, /^SakuraGarden rock_/);
        expect(sum(rocks.map((mesh) => mesh.count))).toBeGreaterThan(0);
        const [grass] = named(world.group, 'SakuraSpringGrass');
        expect(grass.count).toBeGreaterThan(0);
        expect(grass.count).toBeLessThanOrEqual(tier.grass);
        expect(world.garden.stats).toEqual({
            props: SAKURA_STONE_LANTERNS.length + paper.count + 3 + sum(rocks.map((mesh) => mesh.count)),
            grass: grass.count,
        });

        // The lake: a real mirror where the tier can afford one.
        expect(named(world.group, 'SakuraLake')).toHaveLength(1);
        expect(Boolean(world.water.reflection)).toBe(tier.mirror > 0);
        expect(world.water.getDiagnostics()).toEqual({ mirror: tier.mirror > 0 ? tier.mirror : 'analytic' });
        if (tier.mirror > 0) expect(world.water.reflection.target.parent).toBe(world.water.group);

        // The sky and the small lights.
        expect(named(world.group, 'SakuraSkyDome')).toHaveLength(1);
        expect(named(world.group, 'SakuraConstellationLines')).toHaveLength(1);
        expect(named(world.group, 'SakuraConstellationStars')[0].count)
            .toBe(sum(SAKURA_CONSTELLATIONS.map((figure) => figure.points.length)));
        expect(named(world.group, /^SakuraMistBank /)).toHaveLength(tier.mist);
        const [fireflies] = named(world.group, 'SakuraFireflies');
        // The meadow is as full as the tier budgets, bar the odd home that found no dry ground.
        expect(fireflies.count).toBeLessThanOrEqual(tier.fireflies);
        expect(fireflies.count).toBeGreaterThanOrEqual(Math.ceil(tier.fireflies * 0.9));
        expect(named(world.group, 'SakuraFoxfire')[0].count).toBe(tier.foxfire);
        expect(named(world.group, 'SakuraPetalFlashes')[0].count).toBeGreaterThan(1);
        for (const name of ['SakuraLanternsAfloat', 'SakuraLanternsAfloatGlow']) {
            expect(named(world.group, name)[0].count, name).toBe(tier.waterLanterns);
        }
        for (const name of ['SakuraSkyLanterns', 'SakuraSkyLanternGlow']) {
            expect(named(world.group, name)[0].count, name).toBe(tier.skyLanterns);
        }
        // A few lanterns are already out on the lake; the rest wait for cleared lines.
        expect(world.spirits.waterAmbient).toBeGreaterThan(0);
        expect(world.spirits.waterAmbient).toBeLessThan(tier.waterLanterns);

        // The two foxes.
        expect(world.foxes.foxes).toHaveLength(2);
        expect(named(world.group, 'fox')).toHaveLength(2);
        expect(named(world.group, /^SakuraFoxShade /)).toHaveLength(2);

        // The eye sees everything; the lake's second view of the garden is spared the near,
        // small things it never shows: grass, petals, foxes and the little lights.
        const unmirrored = new THREE.Layers();
        unmirrored.set(SAKURA_UNMIRRORED_LAYER);
        const spared = meshes.filter((mesh) => mesh.layers.mask === unmirrored.mask);
        const mirrored = meshes.filter((mesh) => mesh.layers.mask !== unmirrored.mask);
        for (const mesh of meshes) expect(camera.layers.test(mesh.layers), mesh.name).toBe(true);
        for (const pattern of [/^SakuraSpringGrass$/, /^SakuraPetalsInTheAir$/, /^SakuraFireflies$/, /^SakuraFoxfire$/,
            /^SakuraPetalFlashes$/, /^SakuraMistBank /, /^fox$/, /^SakuraFoxShade /]) {
            expect(spared.some((mesh) => pattern.test(mesh.name)), String(pattern)).toBe(true);
            expect(mirrored.some((mesh) => pattern.test(mesh.name)), String(pattern)).toBe(false);
        }
        // What makes the reflection is all still in it.
        for (const pattern of [/^SakuraBark /, /^SakuraBlossom /, /^SakuraGarden /, /^SakuraMountain$/, /^SakuraHills$/,
            /^SakuraFarShoreTrees$/, /^SakuraSkyDome$/, /^SakuraGround$/, /^SakuraLanternsAfloat$/,
            /^SakuraSkyLanterns$/]) {
            expect(mirrored.some((mesh) => pattern.test(mesh.name)), String(pattern)).toBe(true);
            expect(spared.some((mesh) => pattern.test(mesh.name)), String(pattern)).toBe(false);
        }
        if (tier.mirror > 0) {
            const mirrorCamera = world.water.reflection.reflector.getVirtualCamera(camera);
            for (const mesh of spared) expect(mirrorCamera.layers.test(mesh.layers), mesh.name).toBe(false);
            for (const mesh of mirrored) expect(mirrorCamera.layers.test(mesh.layers), mesh.name).toBe(true);
        }

        // Petals in the air: one draw, fed by the simulation's own buffers.
        const { sim, mesh: petalMesh } = world.petals;
        expect(sim.count).toBe(tier.petals);
        expect(sim.ambient + sim.reserve).toBe(tier.petals);
        expect(sim.ambient).toBeGreaterThan(0);
        expect(sim.reserve).toBeGreaterThan(0);
        expect(named(world.group, 'SakuraPetalsInTheAir')).toEqual([petalMesh]);
        expect(petalMesh.count).toBe(tier.petals);
        expect(petalMesh.castShadow).toBe(false);
        expect(world.petals.positions.array).toBe(sim.outPosition);
        expect(world.petals.rotations.array).toBe(sim.outRotation);
        expect(world.petals.looks.array).toBe(sim.outLook);
        expect(world.petals.positions.count).toBe(tier.petals);
        expect(allFinite(sim.outPosition) && allFinite(sim.outRotation) && allFinite(sim.outLook)).toBe(true);
        // The opening picture has petals in the air, on the grass and on the water.
        const counts = sim.counts();
        expect(counts.idle).toBe(sim.reserve);
        for (const key of ['air', 'rest', 'afloat']) expect(counts[key], key).toBeGreaterThan(0);

        expect(world.getDiagnostics()).toEqual({
            quality,
            ...stats,
            ...world.garden.stats,
            mirror: tier.mirror > 0 ? tier.mirror : 'analytic',
            farTrees: world.backdrop.count,
            lanterns: world.lanterns.length,
            lamps: world.light.lampCount,
            petals: counts,
        });
        expect(sum(Object.values(world.getDiagnostics().petals))).toBe(tier.petals);

        expect(Number.isFinite(camera.fov)).toBe(true);
        expect(allFinite(Float64Array.from(camera.projectionMatrix.elements))).toBe(true);
        expect(allFinite(Float64Array.from(camera.matrixWorld.elements))).toBe(true);
        expect(world.stage.board).toEqual(SAKURA_DEFAULT_BOARD);
    });

    it('keeps the same garden and draws less of it as the tier drops', () => {
        for (let index = 1; index < TIER_ORDER.length; index += 1) {
            const cheaper = garden[TIER_ORDER[index]].world;
            const dearer = garden[TIER_ORDER[index - 1]].world;
            const less = cheaper.getDiagnostics();
            const more = dearer.getDiagnostics();
            for (const key of ['trees', 'sprays', 'blossomTriangles', 'barkTriangles', 'farTrees', 'props', 'grass',
                'lanterns', 'lamps']) {
                expect(less[key], `${TIER_ORDER[index]}.${key}`).toBeLessThanOrEqual(more[key]);
            }
            expect(less.sprays).toBeLessThan(more.sprays);
            expect(cheaper.petals.sim.count).toBeLessThanOrEqual(dearer.petals.sim.count);
            expect(drawables(cheaper.group).length).toBeLessThanOrEqual(drawables(dearer.group).length);
            expect(named(cheaper.group, 'SakuraFireflies')[0].count)
                .toBeLessThanOrEqual(named(dearer.group, 'SakuraFireflies')[0].count);
            // Changing quality must not rearrange the garden: same seed, same trees, fewer of them.
            const kept = cheaper.forest.placements;
            expect(dearer.forest.placements.slice(0, kept.length)).toEqual(kept);
        }
        // What every tier keeps: both old trees, every stone lantern and all three landmarks.
        const least = garden.Minimal.world;
        expect(least.forest.placements.length).toBeGreaterThan(SAKURA_FEATURE_TREES.length);
        expect(least.getDiagnostics().mirror).toBe('analytic');
        expect(garden.Extreme.world.getDiagnostics().mirror).toBeGreaterThan(0);
    });

    it('stands everything on the same analytic ground', () => {
        const { world, assets, camera } = garden.Medium;
        const ground = world.terrain.mesh.geometry.attributes.position;
        let worst = 0;
        for (let index = 0; index < ground.count; index += 1) {
            const expected = sakuraTerrainHeight(ground.getX(index), ground.getZ(index));
            worst = Math.max(worst, Math.abs(ground.getY(index) - expected));
        }
        expect(worst).toBeLessThan(1e-4);
        // The mesh covers the whole map the lake bed is baked from.
        world.terrain.mesh.geometry.computeBoundingBox();
        const box = world.terrain.mesh.geometry.boundingBox;
        expect(box.min.x).toBeCloseTo(SAKURA_TERRAIN_BOUNDS.minX, 6);
        expect(box.max.x).toBeCloseTo(SAKURA_TERRAIN_BOUNDS.maxX, 6);
        expect(box.min.z).toBeCloseTo(SAKURA_TERRAIN_BOUNDS.minZ, 6);
        expect(box.max.z).toBeCloseTo(SAKURA_TERRAIN_BOUNDS.maxZ, 6);

        let trunks = 0;
        for (const mesh of named(world.group, /^SakuraBark /)) {
            for (const base of instancePositions(mesh)) {
                expect(base.y).toBeCloseTo(sakuraTerrainHeight(base.x, base.z), 4);
                expect(base.y).toBeGreaterThan(SAKURA_WATER_LEVEL);
                trunks += 1;
            }
        }
        expect(trunks).toBe(world.forest.stats.trees);
        // Stone lanterns are bedded a finger's width into whatever they stand on.
        for (const mesh of named(world.group, /^SakuraGarden (stone|snow)_lantern$/)) {
            for (const foot of instancePositions(mesh)) {
                const sink = sakuraTerrainHeight(foot.x, foot.z) - foot.y;
                expect(sink).toBeGreaterThan(0);
                expect(sink).toBeLessThan(0.2);
            }
        }
        // Paper lanterns hang from real boughs, clear of the grass and the water under them.
        const drop = -assets.props.meshes.paper_lantern.boundingBox.min.y;
        expect(drop).toBeGreaterThan(0.5);
        for (const hook of instancePositions(named(world.group, 'SakuraGarden paper_lantern')[0])) {
            expect(hook.y - drop).toBeGreaterThan(sakuraSurfaceHeight(hook.x, hook.z) + 0.5);
            expect(hook.y).toBeLessThan(sakuraSurfaceHeight(hook.x, hook.z) + 12);
        }
        // Grass grows on the bank and leaves the stepping stones clear; boulders line the shore.
        const tufts = instancePositions(named(world.group, 'SakuraSpringGrass')[0]);
        for (let index = 0; index < tufts.length; index += 23) {
            const tuft = tufts[index];
            expect(sakuraLand(tuft.x, tuft.z)).toBeGreaterThan(0);
            expect(sakuraPathDistance(tuft.x, tuft.z)).toBeGreaterThan(0.5);
            expect(Math.abs(tuft.y - sakuraTerrainHeight(tuft.x, tuft.z))).toBeLessThan(0.1);
        }
        for (const mesh of named(world.group, /^SakuraGarden rock_/)) {
            for (const rock of instancePositions(mesh)) expect(Math.abs(sakuraLand(rock.x, rock.z))).toBeLessThan(2);
        }
        // Far trees stand on land, facing the camera.
        expect(world.backdrop.cards).toHaveLength(world.backdrop.count);
        for (const card of world.backdrop.cards) {
            expect(sakuraTerrainHeight(card.x, card.z)).toBeGreaterThan(SAKURA_WATER_LEVEL);
            expect(Math.abs(card.y - sakuraTerrainHeight(card.x, card.z))).toBeLessThan(0.5);
            const facing = new THREE.Vector3(Math.sin(card.yaw), 0, Math.cos(card.yaw));
            const toEye = new THREE.Vector3(camera.position.x - card.x, 0, camera.position.z - card.z).normalize();
            expect(facing.dot(toEye)).toBeGreaterThan(0.99);
        }
        // The landmarks: the mountain where the composition puts it, the lake at water level.
        const [mountain] = placementsOf(named(world.group, 'SakuraMountain')[0]);
        expect(mountain.position.x).toBeCloseTo(SAKURA_FUJI.x, 3);
        expect(mountain.position.y).toBeCloseTo(SAKURA_FUJI.y, 3);
        expect(mountain.position.z).toBeCloseTo(SAKURA_FUJI.z, 3);
        expect(mountain.scale.y).toBeCloseTo(SAKURA_FUJI.height, 3);
        const lake = world.water.mesh.geometry.attributes.position;
        for (let index = 0; index < lake.count; index += 1) expect(lake.getY(index)).toBeCloseTo(SAKURA_WATER_LEVEL, 9);
        for (const [name, place] of [['torii', SAKURA_TORII], ['bridge', SAKURA_BRIDGE], ['pagoda', SAKURA_PAGODA]]) {
            const [stood] = placementsOf(named(world.group, `SakuraGarden ${name}`)[0]);
            expect(stood.position.x, name).toBeCloseTo(place.x, 3);
            expect(stood.position.z, name).toBeCloseTo(place.z, 3);
            expect(stood.scale.x, name).toBeCloseTo(place.scale, 5);
            expect(stood.scale.y, name).toBeCloseTo(place.scale, 5);
            expect(stood.yaw, name).toBeCloseTo(place.yaw, 5);
            // On the ground, or on the water where there is none: never sunk out of sight.
            const footing = sakuraSurfaceHeight(place.x, place.z);
            expect(stood.position.y - footing, name).toBeGreaterThan(-0.5);
            expect(stood.position.y - footing, name).toBeLessThan(0.5);
        }

        const { sim } = world.petals;
        let resting = 0;
        let floating = 0;
        for (let index = 0; index < sim.count; index += 1) {
            const o = index * 3;
            const x = sim.position[o];
            const z = sim.position[o + 2];
            if (sim.state[index] === PETAL_REST) {
                const lift = sim.position[o + 1] - sakuraTerrainHeight(x, z);
                expect(lift).toBeGreaterThan(-1e-3);
                expect(lift).toBeLessThan(0.1);
                resting += 1;
            } else if (sim.state[index] === PETAL_FLOAT) {
                // Afloat means over water, lying on its surface.
                expect(sakuraTerrainHeight(x, z)).toBeLessThanOrEqual(SAKURA_WATER_LEVEL + 1e-3);
                expect(sim.position[o + 1]).toBeGreaterThan(SAKURA_WATER_LEVEL);
                expect(sim.position[o + 1]).toBeLessThan(SAKURA_WATER_LEVEL + 0.05);
                floating += 1;
            }
        }
        expect(resting).toBeGreaterThan(0);
        expect(floating).toBeGreaterThan(0);
        // The far plane holds the sky dome and the mountain.
        expect(camera.far).toBeGreaterThan(world.sky.dome.geometry.parameters.radius);
        expect(camera.far).toBeGreaterThan(camera.position.distanceTo(mountain.position) + SAKURA_FUJI.height * 3);
    });

    it('draws the constellations in the sky the board card leaves open', () => {
        const { world } = garden.Minimal;
        const camera = frameCamera(LANDSCAPE);
        const [lines] = named(world.group, 'SakuraConstellationLines');
        const { position, uv } = lines.geometry.attributes;
        const quads = sum(SAKURA_CONSTELLATIONS.map((figure) => figure.lines.length));
        expect(position.count).toBe(quads * 4);
        expect(lines.geometry.index.count).toBe(quads * 6);
        const { x0, x1 } = SAKURA_DEFAULT_BOARD;
        /** Each figure's box on the screen of a camera, from the quads that draw its lines. */
        const boxesFor = (view) => {
            let vertex = 0;
            const boxes = SAKURA_CONSTELLATIONS.map((figure) => {
                const box = {
                    name: figure.name, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity,
                };
                for (let corner = 0; corner < figure.lines.length * 4; corner += 1, vertex += 1) {
                    const screen = onScreen(view, position.getX(vertex), position.getY(vertex), position.getZ(vertex));
                    expect(screen.ahead).toBe(true);
                    box.left = Math.min(box.left, screen.x);
                    box.right = Math.max(box.right, screen.x);
                    box.top = Math.min(box.top, screen.y);
                    box.bottom = Math.max(box.bottom, screen.y);
                }
                return box;
            });
            expect(vertex).toBe(position.count);
            return boxes;
        };
        const boxes = boxesFor(camera);
        for (const box of boxes) {
            // The whole figure is inside the frame, above the horizon, and never behind the card.
            expect(box.left, box.name).toBeGreaterThan(0);
            expect(box.right, box.name).toBeLessThan(1);
            expect(box.top, box.name).toBeGreaterThan(0);
            expect(box.bottom, box.name).toBeLessThan(0.5);
            expect(box.right < x0 || box.left > x1, box.name).toBe(true);
            // A figure, not a speck.
            expect(box.right - box.left, box.name).toBeGreaterThan(0.02);
            expect(box.bottom - box.top, box.name).toBeGreaterThan(0.02);
        }
        // The sky right of the card belongs to the moon and the spreading cherry's boughs, so
        // every figure stands in the open sky to its left; and no figure lies across another.
        for (const box of boxes) expect(box.right, box.name).toBeLessThan(x0);
        for (const a of boxes) {
            for (const b of boxes) {
                const apart = a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top;
                if (a !== b) expect(apart, `${a.name} and ${b.name}`).toBe(true);
            }
        }
        // A wider screen shows more sky to the sides: nothing leaves the frame there either.
        for (const box of boxesFor(frameCamera(21 / 9))) {
            expect(box.left, box.name).toBeGreaterThan(0);
            expect(box.right, box.name).toBeLessThan(1);
            expect(box.top, box.name).toBeGreaterThan(0);
        }
        // The lines are drawn in one after another: each quad owns its own slice of 0..1.
        const order = [];
        for (let quad = 0; quad < quads; quad += 1) {
            const start = uv.getY(quad * 4);
            const end = uv.getY(quad * 4 + 2);
            expect(uv.getY(quad * 4 + 1)).toBe(start);
            expect(uv.getY(quad * 4 + 3)).toBe(end);
            expect(end).toBeGreaterThan(start);
            order.push(start, end);
            // Across the line the coordinate runs from one edge to the other.
            expect([uv.getX(quad * 4), uv.getX(quad * 4 + 1)].sort()).toEqual([-1, 1]);
        }
        expect(order[0]).toBe(0);
        expect(order.at(-1)).toBeCloseTo(1, 6);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // Every figure's lines join stars it really has, and no star is left unjoined.
        for (const figure of SAKURA_CONSTELLATIONS) {
            const joined = new Set(figure.lines.flat());
            expect(Math.max(...joined)).toBeLessThan(figure.points.length);
            expect(Math.min(...joined)).toBeGreaterThanOrEqual(0);
            expect(joined.size).toBe(figure.points.length);
        }
    });

    it('hangs the paper lanterns from real boughs of the near trees, the old trees first', () => {
        const { world, assets } = garden.High;
        const plan = (count, seed = 11) => planPaperLanterns(world.placements, assets.trees, count, seededRandom(seed));
        const many = plan(60);
        expect(many.length).toBeGreaterThan(SAKURA_TIERS.Minimal.paperLanterns);
        expect(many.length).toBeLessThanOrEqual(60);
        // Dealt a round at a time: any prefix of the list is the plan for a smaller budget.
        for (const count of [0, 1, 7, 20]) expect(plan(count)).toEqual(many.slice(0, count));
        expect(plan(60)).toEqual(many);
        expect(plan(60, 12)).not.toEqual(many);
        const visible = createSakuraVisibilityTest();
        const perTree = new Map();
        for (const lantern of many) {
            const tree = world.placements[lantern.tree];
            perTree.set(lantern.tree, (perTree.get(lantern.tree) || 0) + 1);
            expect(tree.far).not.toBe(true);
            expect([lantern.x, lantern.y, lantern.z].every(Number.isFinite)).toBe(true);
            expect(lantern.phase).toBeGreaterThanOrEqual(0);
            expect(lantern.phase).toBeLessThan(1);
            expect(typeof lantern.red).toBe('boolean');
            // Under that tree's crown, on a low bough, somewhere the camera can see.
            const asset = assets.trees[tree.asset];
            const reach = Math.max(...asset.crownRadii) * tree.scale + Math.abs(asset.crownCentre[0]) + 2;
            expect(Math.hypot(lantern.x - tree.x, lantern.z - tree.z)).toBeLessThan(reach);
            // A low bough: above head height, below the middle of the crown.
            expect(lantern.y - tree.y).toBeGreaterThan(2);
            expect(lantern.y - tree.y).toBeLessThan(asset.crownCentre[1] * tree.scale);
            expect(lantern.y - sakuraSurfaceHeight(lantern.x, lantern.z)).toBeGreaterThan(2);
            expect(visible(lantern.x, lantern.y - 0.6, lantern.z, 0.4)).toBe(true);
        }
        // The first round gives one to each tree that has a hook, starting with the two heroes.
        expect(many[0].tree).toBe(0);
        expect(many.slice(0, 2).map((lantern) => lantern.tree)).toEqual([0, 1]);
        // The two old trees by the camera carry the most.
        const others = [...perTree].filter(([tree]) => tree > 1).map(([, count]) => count);
        expect(perTree.get(0)).toBeGreaterThan(Math.max(...others));
        expect(perTree.get(1)).toBeGreaterThan(Math.max(...others));
        // Lanterns on one tree keep their distance from each other.
        for (const [tree] of perTree) {
            const hung = many.filter((lantern) => lantern.tree === tree);
            for (const a of hung) {
                for (const b of hung) {
                    if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.5);
                }
            }
        }
        // Both colours of paper are in the garden, the red ones the fewer.
        const red = many.filter((lantern) => lantern.red).length;
        expect(red).toBeGreaterThan(0);
        expect(red).toBeLessThan(many.length / 2);
        // A tree whose model was not loaded simply carries none.
        const { 'sakura-hero-weeping': gone, ...rest } = assets.trees;
        expect(gone).toBeDefined();
        const without = planPaperLanterns(world.placements, rest, 60, seededRandom(11));
        expect(without.every((lantern) => world.placements[lantern.tree].asset !== 'sakura-hero-weeping')).toBe(true);
        expect(planPaperLanterns(world.placements, {}, 60, seededRandom(11))).toEqual([]);
    });

    it('sheds its ambient petals mostly from the two old trees by the camera', () => {
        const { world } = garden.Medium;
        const points = world.forest.sampleCrownPoints(600, seededRandom(3));
        expect(points).toBeInstanceOf(Float32Array);
        expect(points).toHaveLength(600 * 4);
        expect(allFinite(points)).toBe(true);
        const near = world.forest.placements.filter((tree) => !tree.far);
        const heroTones = SAKURA_FEATURE_TREES.slice(0, 2).map((tree) => Math.fround(tree.tone));
        let fromHeroes = 0;
        for (let index = 0; index < 600; index += 1) {
            const [x, y, z, tone] = points.subarray(index * 4, index * 4 + 4);
            // On a bough: above the ground, within reach of one of the near trees, in its colour.
            expect(y).toBeGreaterThan(sakuraSurfaceHeight(x, z));
            const shedBy = (tree) => Math.fround(tree.tone) === tone && Math.hypot(tree.x - x, tree.z - z) < 16;
            expect(near.some(shedBy)).toBe(true);
            if (heroTones.includes(tone)) fromHeroes += 1;
        }
        expect(fromHeroes).toBeGreaterThan(300);
        expect(fromHeroes).toBeLessThan(600);
        // Deterministic for a seed, and nothing at all when there are no near trees.
        expect(world.forest.sampleCrownPoints(600, seededRandom(3))).toEqual(points);
        expect(world.forest.sampleCrownPoints(0, seededRandom(3))).toHaveLength(0);
    });

    it('reproduces the same world for the same seed', async () => {
        const first = garden.Minimal.world;
        const { world: second } = await buildWorld('Minimal');
        const { world: other } = await buildWorld('Minimal', { seed: 12345 });
        expect(second.forest.placements).toEqual(first.forest.placements);
        expect(other.forest.placements).not.toEqual(first.forest.placements);
        expect(second.paperLanterns).toEqual(first.paperLanterns);
        expect(second.lanterns).toEqual(first.lanterns);
        expect(second.getDiagnostics()).toEqual(first.getDiagnostics());
        const firstMeshes = drawables(first.group);
        const secondMeshes = drawables(second.group);
        expect(secondMeshes.map((mesh) => mesh.name)).toEqual(firstMeshes.map((mesh) => mesh.name));
        secondMeshes.forEach((mesh, index) => {
            if (!mesh.isInstancedMesh) return;
            expect(mesh.count).toBe(firstMeshes[index].count);
            expect(mesh.instanceMatrix.array).toEqual(firstMeshes[index].instanceMatrix.array);
        });
        expect(second.petals.sim.outPosition).toEqual(first.petals.sim.outPosition);
        expect(second.spirits.waterSlots.array).toEqual(first.spirits.waterSlots.array);
    }, 30000);
});

describe('Sakura world camera and stage', () => {
    let built;

    beforeAll(async () => {
        built = await buildWorld('Minimal', { track: false });
    }, 60000);

    afterAll(() => {
        built.world.dispose();
        disposeSakuraAssets(built.assets);
    });

    it.each([
        ['landscape', LANDSCAPE], ['ultrawide', 21 / 9], ['square', 1], ['portrait', PORTRAIT], ['tall tablet', 3 / 4],
    ])('frames the camera, the stage, the moon and the foxfire for a %s screen', (_label, aspect) => {
        const { world, camera } = built;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        world.prepareCamera(aspect);
        const view = sakuraViewFor(aspect);
        expect(world.view).toBe(view);
        expect(camera.fov).toBe(view.fov);
        expect(camera.near).toBeGreaterThan(0);
        expect(camera.far).toBeGreaterThan(camera.near);
        expect(camera.position.toArray()).toEqual(view.position);
        const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
        expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-9);
        expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        expect(camera.projectionMatrixInverse.elements.every(Number.isFinite)).toBe(true);
        // The stage follows: the board centre projects back onto the middle of the default card.
        const { stage, spirits, light } = world;
        const centre = stage.centre().project(camera);
        expect(centre.x).toBeCloseTo((SAKURA_DEFAULT_BOARD.x0 + SAKURA_DEFAULT_BOARD.x1) - 1, 9);
        expect(centre.y).toBeCloseTo(1 - (SAKURA_DEFAULT_BOARD.y0 + SAKURA_DEFAULT_BOARD.y1), 9);
        const halfHeight = SAKURA_STAGE_DEPTH * Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
        expect(stage.halfWidth()).toBeCloseTo(halfHeight * aspect, 9);
        // Each framing keeps the moon in its own corner of the sky, and the shadows follow it.
        const moonward = sakuraMoonDirection(view.moon[0], view.moon[1]);
        expect(light.uMoonDir.value.distanceTo(moonward)).toBeLessThan(1e-9);
        expect(light.moon.position.clone().sub(light.moon.target.position).normalize().distanceTo(moonward))
            .toBeLessThan(1e-9);
        // The spirit flames stand in two rows just outside the card's edges, as tall as the card.
        const ringCentre = spirits.uRingCentre.value;
        expect(ringCentre.distanceTo(stage.centre())).toBeLessThan(1e-9);
        const rightFlame = ringCentre.clone().add(spirits.uRingRight.value).project(camera);
        const leftFlame = ringCentre.clone().sub(spirits.uRingRight.value).project(camera);
        const cardRight = SAKURA_DEFAULT_BOARD.x1 * 2 - 1;
        const cardLeft = SAKURA_DEFAULT_BOARD.x0 * 2 - 1;
        expect(rightFlame.x).toBeGreaterThan(cardRight);
        expect(leftFlame.x).toBeLessThan(cardLeft);
        expect(rightFlame.x - cardRight).toBeCloseTo(cardLeft - leftFlame.x, 9);
        expect(rightFlame.x - cardRight).toBeLessThan((cardRight - cardLeft));
        const top = ringCentre.clone().add(spirits.uRingUp.value).project(camera);
        expect(top.y).toBeCloseTo(1 - SAKURA_DEFAULT_BOARD.y0 * 2, 9);
        expect(top.x).toBeCloseTo(centre.x, 9);
        // Re-framing is repeatable and never moves the camera twice.
        const pose = camera.matrixWorld.clone();
        world.prepareCamera(aspect);
        expect(camera.matrixWorld.equals(pose)).toBe(true);
    });

    it('moves the moon only when the framing changes', () => {
        const { world } = built;
        world.prepareCamera(LANDSCAPE);
        const setMoon = vi.spyOn(world.light, 'setMoon');
        const { shadow } = world.light.moon;
        world.prepareCamera(21 / 9);
        world.prepareCamera(4 / 3);
        expect(setMoon).not.toHaveBeenCalled();
        shadow.needsUpdate = false;
        world.prepareCamera(PORTRAIT);
        expect(setMoon).toHaveBeenCalledExactlyOnceWith(...SAKURA_VIEWS.portrait.moon);
        // A new moon throws new shadows: the static map is drawn again.
        expect(shadow.needsUpdate).toBe(true);
        world.prepareCamera(9 / 16);
        expect(setMoon).toHaveBeenCalledOnce();
        world.prepareCamera(LANDSCAPE);
        expect(setMoon).toHaveBeenCalledTimes(2);
        expect(setMoon).toHaveBeenLastCalledWith(...SAKURA_VIEWS.landscape.moon);
    });

    it('falls back to the landscape view for an unusable aspect ratio', () => {
        const { world, camera } = built;
        const stageBefore = world.stage;
        for (const aspect of [NaN, 0, -1, Infinity, undefined, null, 'wide']) {
            world.prepareCamera(PORTRAIT);
            expect(camera.fov).toBe(SAKURA_VIEWS.portrait.fov);
            world.prepareCamera(aspect);
            expect(camera.fov).toBe(SAKURA_VIEWS.landscape.fov);
            expect(camera.position.z).toBe(SAKURA_VIEWS.landscape.position[2]);
            expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
        }
        expect(world.stage).toBe(stageBefore);
    });

    it('redraws the static shadow map over the first frames and then leaves it alone', () => {
        const { world } = built;
        const { light } = world;
        const { shadow } = light.moon;
        light.frameShadows();
        // Pipelines may still be compiling when the first map is drawn: the first frames redraw it.
        for (let frame = 0; frame < 5; frame += 1) {
            shadow.needsUpdate = false;
            light.update(frame * STEP, {});
            expect(shadow.needsUpdate, `frame ${frame}`).toBe(true);
        }
        let redraws = 0;
        for (let frame = 5; frame < 1200; frame += 1) {
            shadow.needsUpdate = false;
            light.update(frame * STEP, {});
            if (shadow.needsUpdate) redraws += 1;
        }
        // A handful of catch-up redraws, not one a frame.
        expect(redraws).toBeLessThan(20);
        shadow.needsUpdate = false;
        for (let frame = 1200; frame < 1260; frame += 1) light.update(frame * STEP, {});
        expect(shadow.needsUpdate).toBe(false);
        // Until the moon moves again.
        light.setMoon(10, 20);
        expect(shadow.needsUpdate).toBe(true);
        world.view = null;
        world.prepareCamera(LANDSCAPE);
    });

    it('starts rings in a fixed pool of slots, oldest first, and rejects nonsense', () => {
        const { light } = built.world;
        light.resetRings();
        light.update(3, {});
        const live = () => light.ringData.filter((ring) => ring.w > 0);
        expect(live()).toEqual([]);
        expect(light.ring(1, -20, 0.8)).toBe(true);
        expect(live()).toHaveLength(1);
        // x, z, the moment it started, and its strength.
        expect(live()[0].toArray()).toEqual([1, -20, 3, Math.fround(0.8) === 0.8 ? 0.8 : live()[0].w]);
        expect(live()[0].w).toBeCloseTo(0.8, 6);
        const pool = light.ringData;
        for (const [x, z, strength] of [[1, 2, 0], [1, 2, -1], [1, 2, NaN], [NaN, 2, 1], [1, Infinity, 1],
            [undefined, 2, 1], [1, 2, undefined]]) {
            expect(light.ring(x, z, strength)).toBe(false);
        }
        expect(live()).toHaveLength(1);
        for (let index = 0; index < SAKURA_RING_SLOTS + 2; index += 1) {
            light.update(4 + index, {});
            expect(light.ring(100 + index, 0, 1)).toBe(true);
            expect(live().length).toBeLessThanOrEqual(SAKURA_RING_SLOTS);
        }
        // Nothing was allocated, the first rings were the ones replaced, the newest are all there.
        expect(light.ringData).toBe(pool);
        expect(light.ringData).toHaveLength(SAKURA_RING_SLOTS);
        const xs = live().map((ring) => ring.x).sort((a, b) => a - b);
        expect(xs).toEqual(Array.from({ length: SAKURA_RING_SLOTS }, (_, index) => 102 + index));
        // Each remembers when it started, so each keeps its own radius.
        expect(new Set(live().map((ring) => ring.z)).size).toBe(SAKURA_RING_SLOTS);
        // However hard the piece lands, a ring's strength is bounded.
        light.ring(0, 0, 1e6);
        light.ring(0, 0, 1e9);
        const strongest = live().map((ring) => ring.w).sort((a, b) => b - a);
        expect(strongest[0]).toBe(strongest[1]);
        expect(strongest[0]).toBeLessThan(10);
        light.resetRings();
        expect(live()).toEqual([]);
        // A cleared slot was "started" long ago, so it draws nothing even at full strength.
        for (const ring of light.ringData) expect(ring.z).toBeLessThan(-100);
        light.update(0, {});
    });
});

describe('Sakura world in play', () => {
    function playSession(world, quality, frames = 150) {
        const reactions = new SakuraReactions({ quality, rng: seededRandom(5) });
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
        const { sim } = world.petals;
        const seen = {
            kinds: new Set(),
            fields: new Set(),
            minIdle: sim.counts().idle,
            maxAir: 0,
            peakHeat: 0,
            peakFoxfire: 0,
            peakSky: 0,
            peakScatter: 0,
            finite: true,
            front: false,
        };
        for (let frame = 0; frame < frames; frame += 1) {
            script[frame]?.();
            const state = reactions.update(STEP);
            world.update(reactions.time, STEP, state);
            state.emitters.forEach((emitter) => seen.kinds.add(emitter.kind));
            world.director.fields.forEach((field) => seen.fields.add(field.kind));
            const counts = sim.counts();
            seen.minIdle = Math.min(seen.minIdle, counts.idle);
            seen.maxAir = Math.max(seen.maxAir, counts.air);
            seen.peakHeat = Math.max(seen.peakHeat, world.petals.uHeat.value);
            seen.peakFoxfire = Math.max(seen.peakFoxfire, world.spirits.uFoxfire.value);
            seen.peakSky = Math.max(seen.peakSky, world.sky.uDraw.value);
            seen.peakScatter = Math.max(seen.peakScatter, world.spirits.uScatter.value);
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
        const { sim } = world.petals;
        const opening = sim.counts();
        const versions = [world.petals.positions.version, world.petals.rotations.version, world.petals.looks.version];
        const { spirits, light, sky } = world;
        const asked = vi.spyOn(world, 'floatLantern');
        const launched = vi.spyOn(spirits, 'launchWater');
        const released = vi.spyOn(spirits, 'releaseSky');
        const flashed = vi.spyOn(spirits, 'flash');
        const shot = vi.spyOn(sky, 'shoot');
        const rings = vi.spyOn(light, 'ring');
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
        expect([...seen.kinds].sort())
            .toEqual(['clear', 'combo', 'floats', 'lanterns', 'lock', 'rise', 'shower', 'spin', 'star']);
        expect([...seen.fields].sort()).toEqual(['burst', 'jet', 'lift', 'vortex']);
        expect(seen.front).toBe(true);
        expect(seen.finite).toBe(true);
        expect(seen.minIdle).toBeLessThan(opening.idle);
        expect(seen.maxAir).toBeGreaterThan(opening.air);
        expect(seen.peakHeat).toBeGreaterThan(0);
        expect(seen.peakFoxfire).toBeGreaterThan(1);
        expect(seen.peakSky).toBeGreaterThan(0);
        expect(seen.peakScatter).toBeGreaterThan(0);
        // And the garden's one-shot answers went out: rings on the lake, lanterns afloat and
        // aloft, shooting stars.
        expect(rings.mock.results.filter((result) => result.value === true).length).toBeGreaterThanOrEqual(4);
        for (const [x, z] of rings.mock.calls) expect(sakuraLand(x, z)).toBeLessThan(0);
        // A burst of light at the card's edge for every lock and on both sides for every clear.
        expect(flashed.mock.calls.length).toBeGreaterThanOrEqual(5);
        expect(flashed.mock.results.every((result) => result.value === true)).toBe(true);
        const boardCentre = world.stage.centre();
        for (const [x, y, z] of flashed.mock.calls) {
            expect(Math.hypot(x - boardCentre.x, z - boardCentre.z)).toBeLessThan(world.stage.halfWidth());
            expect(y).toBeGreaterThan(sakuraSurfaceHeight(x, z));
        }
        // One lantern for the single line and four for the four-line clear, every one of them
        // set down on open water.
        expect(asked).toHaveBeenCalledTimes(5);
        expect(asked.mock.results.every((result) => result.value === true)).toBe(true);
        expect(launched).toHaveBeenCalledTimes(5);
        for (const [x, z, vx, vz, power] of launched.mock.calls) {
            expect(sakuraLand(x, z)).toBeLessThan(0);
            expect([vx, vz, power].every(Number.isFinite)).toBe(true);
        }
        expect(launched.mock.results.every((result) => result.value === true)).toBe(true);
        expect(released.mock.calls.length).toBeGreaterThanOrEqual(6);
        expect(released.mock.results.every((result) => result.value === true)).toBe(true);
        expect(shot.mock.calls.length).toBeGreaterThanOrEqual(4);
        // Every frame re-uploads the three petal buffers, and only moves the clock forward.
        expect(world.petals.positions.version).toBe(versions[0] + 150);
        expect(world.petals.rotations.version).toBe(versions[1] + 150);
        expect(world.petals.looks.version).toBe(versions[2] + 150);
        expect(light.uTime.value).toBeCloseTo(reactions.time, 9);
        expect(sim.time).toBeCloseTo(150 * STEP, 9);
        expect(sum(Object.values(sim.counts()))).toBe(sim.count);
        // The game ended twenty frames ago: the lanterns are burning lower than they would.
        const hushed = light.uLampGain.value;
        world.update(reactions.time, 0, { ...reactions.getFrame(), hush: 0 });
        expect(hushed).toBeLessThan(light.uLampGain.value);
    }, 60000);

    // The director launches from somewhere out past either edge of the card, which may be the
    // bank, the shore of a wooded point or open water already. Wherever it is, the lantern is
    // walked toward the middle of the lake until it floats: no cleared line goes without one.
    it('sets a lantern afloat for every cleared line, whichever bank it is launched from', async () => {
        const { world } = await buildWorld('Minimal');
        const asked = vi.spyOn(world, 'floatLantern');
        const launched = vi.spyOn(world.spirits, 'launchWater');
        let lines = 0;
        for (let clear = 0; clear < 240; clear += 1) {
            const count = 1 + (clear % 4);
            lines += count;
            world.director.apply({
                emitters: [{
                    id: clear % 5,
                    serial: clear,
                    kind: 'floats',
                    side: clear % 2 ? 1 : -1,
                    column: 0.5,
                    row: 0.3,
                    strength: count / 4,
                    lines: count,
                    age: 0,
                    duration: 0.6,
                    seed: 0.5,
                    active: true,
                    progress: 0,
                }],
            }, 0);
        }
        expect(asked).toHaveBeenCalledTimes(lines);
        expect(asked.mock.results.every((result) => result.value === true)).toBe(true);
        expect(launched).toHaveBeenCalledTimes(lines);
        const centre = world.stage.centre();
        const banks = { left: 0, right: 0 };
        let carried = 0;
        asked.mock.calls.forEach(([x, z, vx, vz, power], index) => {
            const [lakeX, lakeZ, ...rest] = launched.mock.calls[index];
            // On open water, on the side it was asked for, no further from the middle of the lake.
            expect(sakuraLand(lakeX, lakeZ)).toBeLessThan(0);
            expect(lakeX * x).toBeGreaterThanOrEqual(0);
            expect(Math.abs(lakeX)).toBeLessThanOrEqual(Math.abs(x));
            // Carried out from the bank, not flung across the garden; its drift is its own.
            expect(Math.hypot(lakeX - x, lakeZ - z)).toBeLessThan(60);
            expect(rest).toEqual([vx, vz, power]);
            if (lakeX !== x || lakeZ !== z) carried += 1;
            banks[x < centre.x ? 'left' : 'right'] += 1;
        });
        // Both banks were used, and both kinds of launch happened: afloat at once, and carried out.
        expect(banks.left).toBeGreaterThan(lines / 4);
        expect(banks.right).toBeGreaterThan(lines / 4);
        expect(carried).toBeGreaterThan(0);
        expect(carried).toBeLessThan(lines);
    }, 30000);

    it('keeps invalid time inputs out of the world clock and bounds scene excitement', async () => {
        const { world } = await buildWorld('Minimal');
        const {
            light, petals, sky, spirits,
        } = world;
        world.update(4, 0, {});
        const restGain = light.uLampGain.value;
        world.update(4, 0, { gust: 1 });
        const fullGust = light.uGust.value;
        expect(fullGust).toBeGreaterThan(0);
        world.update(4, 0, {
            gust: 2,
            glow: NaN,
            lanterns: Infinity,
            moon: -3,
            spirit: 9,
            vortex: 0.75,
            heat: 9,
            hush: -1,
            foxfire: -4,
            constellation: 7,
            figures: 'x',
        });
        expect(light.uTime.value).toBe(4);
        expect(light.uGust.value).toBe(fullGust);
        expect(light.uGlow.value).toBe(0);
        expect(light.uSpirit.value).toBe(1);
        expect(spirits.uSpirit.value).toBe(1);
        expect(light.uLampGain.value).toBe(restGain);
        expect(petals.uHeat.value).toBe(1);
        expect(spirits.uFoxfire.value).toBe(0);
        expect(sky.uDraw.value).toBe(1);
        expect(sky.uFigures.value).toBe(0);
        expect(sky.uMoonGlow.value).toBe(0);
        world.update(4, 0, {
            glow: 0.25, lanterns: 1, moon: 0.5, spirit: 0.2, heat: 0.4, foxfire: 3.5, constellation: 0.3, figures: 0.6,
        });
        expect(light.uGust.value).toBe(0);
        expect(light.uGlow.value).toBe(0.25);
        expect(light.uSpirit.value).toBe(0.2);
        expect(petals.uHeat.value).toBe(0.4);
        expect(spirits.uFoxfire.value).toBe(3.5);
        expect(sky.uDraw.value).toBe(0.3);
        expect(sky.uFigures.value).toBe(0.6);
        expect(sky.uMoonGlow.value).toBe(0.5);
        // Lanterns answer the game by burning brighter, and the end of it by burning low.
        const bright = light.uLampGain.value;
        expect(bright).toBeGreaterThan(restGain);
        world.update(4, 0, { lanterns: 99 });
        expect(light.uLampGain.value).toBe(bright);
        world.update(4, 0, { hush: 1 });
        expect(light.uLampGain.value).toBeLessThan(restGain);
        expect(light.uLampGain.value).toBeGreaterThan(0);
        world.update(4, 0, { hush: 50 });
        expect(light.uLampGain.value).toBeGreaterThan(0);
        // A gust or a passing front startles the fireflies, within bounds.
        world.update(4, 0, { gust: 1 });
        expect(spirits.uScatter.value).toBeGreaterThan(0);
        expect(spirits.uScatter.value).toBeLessThanOrEqual(1);
        world.update(4, 0, { front: { position: 0, direction: 1, strength: 40 } });
        expect(spirits.uScatter.value).toBe(1);
        expect(light.uFront.value.y).toBeGreaterThan(0);
        expect(Number.isFinite(light.uFront.value.y)).toBe(true);
        world.update(4, 0, {});
        expect(spirits.uScatter.value).toBe(0);
        expect(light.uFront.value.y).toBe(0);
        for (const time of [NaN, Infinity, -Infinity, undefined, null, '9']) world.update(time, 0);
        expect(light.uTime.value).toBe(4);
        expect(petals.uHeat.value).toBe(0);
        world.update(-5, 0);
        expect(light.uTime.value).toBe(0);
        // Nonsense envelopes never reach the petals.
        for (let frame = 0; frame < 30; frame += 1) {
            world.update(frame * STEP, STEP, {
                gust: NaN,
                glow: null,
                lanterns: -1,
                vortex: Infinity,
                heat: 'hot',
                hush: NaN,
                front: null,
                emitters: [],
            });
            world.update(frame * STEP, STEP, {
                gust: 1e9, vortex: 1e9, heat: 1e9, foxfire: 1e9, hush: 1e9, emitters: 'none',
            });
        }
        const { sim } = petals;
        expect(allFinite(sim.outPosition) && allFinite(sim.outRotation) && allFinite(sim.velocity)).toBe(true);
        expect(Number.isFinite(light.uGust.value)).toBe(true);
        expect(Number.isFinite(light.uLampGain.value)).toBe(true);
        expect(light.uFront.value.toArray().every(Number.isFinite)).toBe(true);
    }, 30000);

    it('does not advance the petals or the foxes on a zero or invalid timestep', async () => {
        const { world } = await buildWorld('Minimal');
        const { sim } = world.petals;
        const before = Array.from(sim.outPosition);
        const foxes = world.foxes.foxes.map((fox) => fox.model.position.clone());
        for (const dt of [0, -1, NaN, undefined]) world.update(1, dt, { gust: 1, vortex: 1, emitters: [] });
        expect(sim.time).toBe(0);
        expect(Array.from(sim.outPosition)).toEqual(before);
        world.foxes.foxes.forEach((fox, index) => expect(fox.model.position.equals(foxes[index])).toBe(true));
        world.update(1, STEP, { emitters: [] });
        expect(sim.time).toBeCloseTo(STEP, 12);
    }, 30000);

    it('returns the garden to a calm opening state on resetEffects', async () => {
        const { world } = await buildWorld('Low');
        const { sim } = world.petals;
        const {
            spirits, light, sky, foxes,
        } = world;
        const ambientLanterns = Array.from(spirits.waterSlots.array.subarray(0, spirits.waterAmbient * 4));
        const { reactions } = playSession(world, 'Low', 110);
        expect(sim.counts().idle).toBeLessThan(sim.reserve);
        expect(world.director.serials.size).toBeGreaterThan(0);
        expect(light.ringData.some((ring) => ring.w > 0)).toBe(true);
        expect(spirits.skyCursor).toBeGreaterThan(0);
        expect(spirits.waterCursor).toBeGreaterThan(0);
        expect(sky.uShoot.value.w).toBeGreaterThan(0);
        const sessionTime = light.uTime.value;
        const flashBirths = () => Array.from(
            { length: spirits.flashSlots.count },
            (_, index) => spirits.flashSlots.getW(index),
        );
        expect(flashBirths().some((birth) => sessionTime - birth < 5)).toBe(true);
        const { version } = world.petals.positions;

        reactions.reset();
        world.resetEffects();
        expect(sim.time).toBe(0);
        const counts = sim.counts();
        expect(counts).toMatchObject({ idle: sim.reserve, fade: 0 });
        expect(counts.air + counts.rest + counts.afloat).toBe(sim.ambient);
        for (let index = 0; index < sim.count; index += 1) {
            if (index < sim.ambient) expect([PETAL_AIR, PETAL_REST, PETAL_FLOAT]).toContain(sim.state[index]);
            else {
                expect(sim.state[index]).toBe(PETAL_IDLE);
                expect(sim.outPosition[index * 4 + 3]).toBe(0);
            }
        }
        expect(allFinite(sim.outPosition) && allFinite(sim.outRotation)).toBe(true);
        expect(world.director.fields).toEqual([]);
        expect(world.director.serials.size).toBe(0);
        // The cleared buffers are flagged for upload even though no frame has run.
        expect(world.petals.positions.version).toBeGreaterThan(version);
        expect(eventPetalsInFlight(sim)).toEqual([]);
        // The lights the game lit are out: rings, the shooting star, the sky's figures, the flames.
        expect(light.ringData.every((ring) => ring.w === 0)).toBe(true);
        expect(sky.uShoot.value.w).toBe(0);
        expect(sky.uDraw.value).toBe(0);
        expect(sky.uFigures.value).toBe(0);
        expect(spirits.uFoxfire.value).toBe(0);
        expect(spirits.skyCursor).toBe(0);
        expect(spirits.waterCursor).toBe(0);
        // Every lantern the game released is gone; the ones the garden floats itself drift on.
        const now = light.uTime.value;
        for (let index = 0; index < spirits.skySlots.count; index += 1) {
            expect(now - spirits.skySlots.getW(index)).toBeGreaterThan(500);
        }
        for (let index = spirits.waterAmbient; index < spirits.waterSlots.count; index += 1) {
            expect(now - spirits.waterSlots.getZ(index)).toBeGreaterThan(500);
        }
        for (const birth of flashBirths()) expect(now - birth).toBeGreaterThan(500);
        expect(Array.from(spirits.waterSlots.array.subarray(0, spirits.waterAmbient * 4))).toEqual(ambientLanterns);
        // The foxes are back where they started, standing.
        for (const fox of foxes.foxes) {
            expect(fox.state).toBe('idle');
            expect(fox.x).toBe(fox.plan.x);
            expect(fox.model.position.x).toBe(fox.plan.x);
        }

        // A new session numbers its events from zero again; its first lock must not be swallowed.
        reactions.onPieceLock({ piece: cell(1, 20) });
        world.update(0, STEP, reactions.update(STEP));
        expect(eventPetalsInFlight(sim).length).toBeGreaterThan(0);
        expect(light.ringData.filter((ring) => ring.w > 0)).toHaveLength(1);
    }, 60000);

    it('throws its petals from wherever the board is measured to be, and ignores junk', async () => {
        const { world, camera } = await buildWorld('Minimal');
        const { sim } = world.petals;
        const lockOnRightEdge = () => {
            const reactions = new SakuraReactions({ quality: 'Minimal', rng: seededRandom(5) });
            world.resetEffects();
            reactions.onPieceLock({ piece: cell(9, 14) });
            for (let frame = 0; frame < 6; frame += 1) world.update(frame * STEP, STEP, reactions.update(STEP));
            const flying = eventPetalsInFlight(sim);
            expect(flying.length).toBeGreaterThan(0);
            return mean(flying.map((entry) => entry.x));
        };
        const atDefault = lockOnRightEdge();
        expect(atDefault).toBeGreaterThan(0);
        // A card on the far left of the screen: its right edge is left of the view axis.
        const moved = {
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        };
        world.setBoard(moved);
        expect(world.stage.board).toEqual(moved);
        expect(lockOnRightEdge()).toBeLessThan(0);
        // The spirit flames moved with it.
        const { spirits } = world;
        expect(spirits.uRingCentre.value.distanceTo(world.stage.centre())).toBeLessThan(1e-9);
        const flame = spirits.uRingCentre.value.clone().add(spirits.uRingRight.value).project(camera);
        expect(flame.x).toBeGreaterThan(moved.x1 * 2 - 1);
        expect(flame.x).toBeLessThan(0);
        const top = spirits.uRingCentre.value.clone().add(spirits.uRingUp.value).project(camera);
        expect(top.y).toBeCloseTo(1 - moved.y0 * 2, 9);
        for (const junk of [null, undefined, {}, 'board', 42, [], { x0: NaN }, {
            x0: 0.9, x1: 0.1, y0: 0, y1: 1,
        }]) {
            world.setBoard(moved);
            expect(() => world.setBoard(junk)).not.toThrow();
            expect(world.stage.board).toEqual(SAKURA_DEFAULT_BOARD);
        }
        // Back at the default card the petals leave from the right of the view axis again.
        expect(lockOnRightEdge()).toBeGreaterThan(0);
        expect(spirits.uRingCentre.value.distanceTo(world.stage.centre())).toBeLessThan(1e-9);
    }, 30000);

    it('sets lanterns afloat on open water, however near the bank they were asked for', async () => {
        const { world } = await buildWorld('Minimal');
        const { spirits, light } = world;
        const launch = vi.spyOn(spirits, 'launchWater');
        light.update(12, {});
        // Already on the lake (the middle of it, out in front of the board): launched where it was asked.
        const open = world.stage.lake(0.5, 30);
        expect(sakuraLand(open.x, open.z)).toBeLessThan(-1);
        expect(world.floatLantern(open.x, open.z, 0.05, -0.2, 1.2)).toBe(true);
        expect(launch).toHaveBeenLastCalledWith(open.x, open.z, 0.05, -0.2, 1.2);
        // On the near bank: carried out to the first open water beyond it.
        const bankZ = sakuraShore(0) + 3;
        expect(sakuraLand(0, bankZ)).toBeGreaterThan(0);
        expect(world.floatLantern(0, bankZ, 0.05, -0.2, 1)).toBe(true);
        const [x, z] = launch.mock.calls.at(-1);
        expect(x).toBe(0);
        expect(z).toBeLessThan(bankZ);
        expect(sakuraLand(x, z)).toBeLessThan(0);
        expect(bankZ - z).toBeLessThan(21);
        // What was launched took a slot the garden's own lanterns do not use, stamped with now.
        const slots = spirits.waterSlots;
        const stamped = [];
        for (let index = 0; index < slots.count; index += 1) {
            if (slots.getZ(index) === 12) stamped.push(index);
        }
        expect(stamped).toHaveLength(2);
        for (const index of stamped) expect(index).toBeGreaterThanOrEqual(spirits.waterAmbient);
        // Round the lake the way to the water is toward its middle, whatever the shape of the
        // bank: from under every hand-placed tree and beside every stone lantern, on the near
        // bank, the two points and the islet alike, a lantern ends up afloat.
        const spots = [...SAKURA_FEATURE_TREES, ...SAKURA_STONE_LANTERNS];
        expect(spots.some((spot) => sakuraLand(spot.x, spot.z) > 5)).toBe(true);
        for (const spot of spots) {
            expect(world.floatLantern(spot.x, spot.z, 0, -0.1, 1), `${spot.x}, ${spot.z}`).toBe(true);
            const [lakeX, lakeZ] = launch.mock.calls.at(-1);
            expect(sakuraLand(lakeX, lakeZ)).toBeLessThan(0);
            expect(Math.abs(lakeX)).toBeLessThanOrEqual(Math.abs(spot.x));
        }
        // Only somewhere with no lake within reach (far inland beyond the far shore) is none launched.
        const inland = SAKURA_TERRAIN_BOUNDS.minZ;
        expect([0, 20, 40, 60].every((step) => sakuraLand(0, inland + step) > 0)).toBe(true);
        const calls = launch.mock.calls.length;
        expect(world.floatLantern(0, inland, 0, 0, 1)).toBe(false);
        expect(launch).toHaveBeenCalledTimes(calls);
    }, 30000);
});

describe('Sakura small lights and foxes', () => {
    let built;

    beforeAll(async () => {
        built = await buildWorld('Low', { track: false });
    }, 60000);

    afterAll(() => {
        built.world.dispose();
        disposeSakuraAssets(built.assets);
    });

    it('launches water lanterns round a ring of slots without ever taking one of the garden\'s own', () => {
        const { spirits, light } = built.world;
        spirits.reset();
        light.update(20, {});
        const { waterSlots, waterMotion, waterAmbient } = spirits;
        const ambient = Array.from(waterSlots.array.subarray(0, waterAmbient * 4));
        const reserve = waterSlots.count - waterAmbient;
        expect(reserve).toBeGreaterThan(0);
        const versions = [waterSlots.version, waterMotion.version];
        expect(spirits.launchWater(3, -18, 0.1, -0.2, 1.4)).toBe(true);
        expect([waterSlots.getX(waterAmbient), waterSlots.getY(waterAmbient), waterSlots.getZ(waterAmbient)])
            .toEqual([3, -18, 20]);
        expect(waterMotion.getX(waterAmbient)).toBeCloseTo(0.1, 6);
        expect(waterMotion.getY(waterAmbient)).toBeCloseTo(-0.2, 6);
        // It burns for a while and then goes out.
        expect(waterMotion.getZ(waterAmbient)).toBeGreaterThan(10);
        expect(waterMotion.getW(waterAmbient)).toBeCloseTo(1.4, 6);
        // One slot rewritten, both buffers flagged for upload.
        expect(waterSlots.version).toBeGreaterThan(versions[0]);
        expect(waterMotion.version).toBeGreaterThan(versions[1]);
        // More launches than slots: the oldest launch is the one replaced.
        for (let index = 1; index <= reserve; index += 1) {
            expect(spirits.launchWater(100 + index, -30, 0, -0.1)).toBe(true);
        }
        expect(waterSlots.getX(waterAmbient)).toBe(100 + reserve);
        expect(waterSlots.getX(waterAmbient + 1)).toBe(101);
        expect(Array.from(waterSlots.array.subarray(0, waterAmbient * 4))).toEqual(ambient);
        // A launch without a power burns at the ordinary brightness.
        expect(waterMotion.getW(waterAmbient + 1)).toBe(1);
    });

    it('sends the garden\'s own lanterns out again when they burn out', () => {
        const { spirits } = built.world;
        const { waterSlots, waterMotion, waterAmbient } = spirits;
        spirits.update(50, {});
        const births = Array.from({ length: waterAmbient }, (_, index) => waterSlots.getZ(index));
        const reserve = Array.from(waterSlots.array.subarray(waterAmbient * 4));
        // Nothing has burnt out a moment later.
        spirits.update(50.5, {});
        expect(Array.from({ length: waterAmbient }, (_, index) => waterSlots.getZ(index))).toEqual(births);
        // Much later every one of them has, and sets off again at that moment.
        spirits.update(5000, {});
        for (let index = 0; index < waterAmbient; index += 1) {
            expect(waterSlots.getZ(index)).toBe(5000);
            // It starts on open water and is still afloat when it burns out.
            const life = waterMotion.getZ(index);
            const x = waterSlots.getX(index);
            const z = waterSlots.getY(index);
            expect(life).toBeGreaterThan(10);
            expect(sakuraLand(x, z)).toBeLessThan(0);
            expect(sakuraLand(x + waterMotion.getX(index) * life, z + waterMotion.getY(index) * life)).toBeLessThan(0);
            expect(waterMotion.getW(index)).toBeGreaterThan(0);
        }
        // The game's lanterns are not the garden's to relaunch.
        expect(Array.from(waterSlots.array.subarray(waterAmbient * 4))).toEqual(reserve);
    });

    it('releases sky lanterns round its slots, each stamped with its own delay', () => {
        const { spirits, light } = built.world;
        spirits.reset();
        light.update(30, {});
        const { skySlots, skyMotion } = spirits;
        expect(spirits.releaseSky(4, 1.2, -30, 2.5)).toBe(true);
        expect([skySlots.getX(0), skySlots.getZ(0)]).toEqual([4, -30]);
        expect(skySlots.getY(0)).toBeCloseTo(1.2, 6);
        // Not yet risen: it leaves the ground when its delay has passed.
        expect(skySlots.getW(0)).toBe(32.5);
        // It climbs (never sinks), and each has a size and a drift of its own.
        expect(skyMotion.getX(0)).toBeGreaterThan(0);
        expect(skyMotion.getW(0)).toBeGreaterThan(0);
        expect(spirits.releaseSky(5, 1, -31)).toBe(true);
        expect(skySlots.getW(1)).toBe(30);
        for (let index = 2; index <= skySlots.count; index += 1) spirits.releaseSky(200 + index, 1, -40, 0);
        expect(skySlots.getX(0)).toBe(200 + skySlots.count);
        expect(skySlots.getX(1)).toBe(5);
        const climbs = new Set(Array.from({ length: skySlots.count }, (_, index) => skyMotion.getX(index)));
        expect(climbs.size).toBeGreaterThan(skySlots.count / 2);
    });

    it('bursts light from a small ring of slots, each stamped with its moment and bounded in strength', () => {
        const { spirits, light } = built.world;
        spirits.reset();
        light.update(60, {});
        const { flashSlots, flashLook } = spirits;
        const slots = flashSlots.count;
        expect(slots).toBeGreaterThan(1);
        const births = () => Array.from({ length: slots }, (_, index) => flashSlots.getW(index));
        // Nothing is burning: every slot was "born" long ago.
        for (const birth of births()) expect(60 - birth).toBeGreaterThan(500);
        const versions = [flashSlots.version, flashLook.version];
        expect(spirits.flash(1.5, 4, 7.5, 0.8)).toBe(true);
        expect([flashSlots.getX(0), flashSlots.getY(0), flashSlots.getZ(0), flashSlots.getW(0)])
            .toEqual([1.5, 4, 7.5, 60]);
        expect(flashLook.getX(0)).toBeCloseTo(0.8, 6);
        expect(flashSlots.version).toBeGreaterThan(versions[0]);
        expect(flashLook.version).toBeGreaterThan(versions[1]);
        // A burst with no strength is no burst.
        for (const strength of [0, -1, NaN, null]) expect(spirits.flash(0, 0, 0, strength)).toBe(false);
        expect(births().filter((birth) => birth === 60)).toHaveLength(1);
        // Without a strength it is an ordinary one.
        expect(spirits.flash(2, 4, 7.5)).toBe(true);
        expect(flashLook.getX(1)).toBe(1);
        // More bursts than slots: the oldest is the one replaced, and nothing is allocated.
        for (let index = 2; index <= slots; index += 1) {
            light.update(60 + index, {});
            expect(spirits.flash(100 + index, 4, 7.5, 1)).toBe(true);
        }
        expect(spirits.flashSlots).toBe(flashSlots);
        expect(flashSlots.getX(0)).toBe(100 + slots);
        expect(flashSlots.getX(1)).toBe(2);
        // However hard the piece lands, the burst stays a glint.
        spirits.flash(0, 4, 7.5, 1e6);
        spirits.flash(0, 4, 7.5, 1e9);
        const strengths = Array.from({ length: slots }, (_, index) => flashLook.getX(index)).sort((a, b) => b - a);
        expect(strengths[0]).toBe(strengths[1]);
        expect(strengths[0]).toBeLessThan(10);
        spirits.reset();
        for (const birth of births()) expect(light.uTime.value - birth).toBeGreaterThan(500);
        light.update(0, {});
    });

    it('sends shooting stars alternately from either side and forgets them on reset', () => {
        const { sky, light } = built.world;
        sky.reset();
        light.update(40, {});
        expect(sky.uShoot.value.w).toBe(0);
        sky.shoot(0.7);
        expect(sky.uShoot.value.w).toBeCloseTo(0.7, 6);
        // Born now, so it is drawn from now.
        expect(sky.uShoot.value.z).toBe(40);
        const first = sky.uShootDir.value.clone();
        expect(first.length()).toBeCloseTo(1, 9);
        light.update(41, {});
        sky.shoot();
        expect(sky.uShoot.value.w).toBe(1);
        expect(sky.uShoot.value.z).toBe(41);
        expect(Math.sign(sky.uShootDir.value.x)).toBe(-Math.sign(first.x));
        sky.shoot(0.5);
        expect(Math.sign(sky.uShootDir.value.x)).toBe(Math.sign(first.x));
        // The frame's sky envelopes are clamped on the way in.
        sky.update({ constellation: 4, figures: -2, moon: NaN });
        expect([sky.uDraw.value, sky.uFigures.value, sky.uMoonGlow.value]).toEqual([1, 0, 0]);
        sky.update();
        expect([sky.uDraw.value, sky.uFigures.value, sky.uMoonGlow.value]).toEqual([0, 0, 0]);
        sky.update({ constellation: 1, figures: 1, moon: 1 });
        sky.reset();
        expect(sky.uShoot.value.w).toBe(0);
        expect(light.uTime.value - sky.uShoot.value.z).toBeGreaterThan(50);
        expect([sky.uDraw.value, sky.uFigures.value, sky.uMoonGlow.value]).toEqual([0, 0, 0]);
        light.update(0, {});
    });

    it('keeps the two foxes on the stepping-stone path, wandering, and sets them running at a hard gust', () => {
        const { foxes } = built.world;
        foxes.reset();
        expect(foxes.foxes).toHaveLength(2);
        /** What is wrong with where a fox stands, or null: on the path, on dry ground, shade under it. */
        const trouble = (fox) => {
            const { x, y, z } = fox.model.position;
            if (!(Math.abs(z - sakuraPathZ(x)) < 1)) return 'left the path';
            if (!(Math.abs(y - sakuraTerrainHeight(x, z)) < 1e-6)) return 'left the ground';
            if (!(y > SAKURA_WATER_LEVEL)) return 'walked into the lake';
            if (!(z < SAKURA_VIEWS.landscape.position[2])) return 'walked behind the camera';
            if (fox.shade.position.x !== x || fox.shade.position.z !== z) return 'lost its shade';
            if (!(fox.shade.position.y > y && fox.shade.position.y < y + 0.2)) return 'shade off the ground';
            return null;
        };
        const troubles = new Set();
        const watch = (fox) => { if (trouble(fox)) troubles.add(trouble(fox)); };
        // One either side of the board, both standing.
        expect(Math.sign(foxes.foxes[0].model.position.x)).toBe(-Math.sign(foxes.foxes[1].model.position.x));
        for (const fox of foxes.foxes) {
            expect(fox.state).toBe('idle');
            expect(trouble(fox)).toBeNull();
        }
        const visited = foxes.foxes.map(() => new Set());
        const travelled = foxes.foxes.map(() => 0);
        const speeds = { ambling: 0, running: 0 };
        /** One thirtieth of a second for both foxes; returns how far each moved along the path. */
        const tick = (frame) => {
            const before = foxes.foxes.map((fox) => fox.model.position.x);
            foxes.update(1 / 30, frame);
            foxes.foxes.forEach(watch);
            return foxes.foxes.map((fox, index) => Math.abs(fox.model.position.x - before[index]));
        };
        for (let frame = 0; frame < 30 * 120; frame += 1) {
            const steps = tick({ gust: 0.1 });
            for (let index = 0; index < steps.length; index += 1) {
                visited[index].add(foxes.foxes[index].state);
                travelled[index] += steps[index];
                speeds.ambling = Math.max(speeds.ambling, steps[index] * 30);
            }
        }
        const { ambling } = speeds;
        expect([...troubles]).toEqual([]);
        for (const [index, states] of visited.entries()) {
            // An amble and a pause, never a run while the air is calm.
            expect([...states].sort()).toEqual(['idle', 'walk']);
            expect(travelled[index]).toBeGreaterThan(2);
        }
        expect(ambling).toBeGreaterThan(0);

        // A hard gust startles both at once; they run, faster than they walk, toward the middle.
        const startled = foxes.foxes.map((fox) => fox.model.position.x);
        foxes.update(1 / 30, { gust: 0.9 });
        for (const fox of foxes.foxes) expect(fox.state).toBe('run');
        for (let frame = 0; frame < 20; frame += 1) {
            speeds.running = Math.max(speeds.running, ...tick({ gust: 0.9 }).map((step) => step * 30));
        }
        expect(speeds.running).toBeGreaterThan(ambling * 1.5);
        foxes.foxes.forEach((fox, index) => {
            const moved = fox.model.position.x - startled[index];
            expect(moved).not.toBe(0);
            if (Math.abs(startled[index]) > 1) expect(moved * Math.sign(startled[index])).toBeLessThan(0);
        });
        // The gust keeps blowing, but they are not kept running by it: they settle in between.
        const runFrames = foxes.foxes.map(() => 0);
        const frames = 30 * 14;
        for (let frame = 0; frame < frames; frame += 1) {
            tick({ gust: 0.9 });
            for (let index = 0; index < runFrames.length; index += 1) {
                if (foxes.foxes[index].state === 'run') runFrames[index] += 1;
            }
        }
        for (const count of runFrames) expect(count).toBeLessThan(frames * 0.9);
        expect([...troubles]).toEqual([]);

        // When the game is over they stand and watch the water.
        foxes.reset();
        const still = foxes.foxes.map((fox) => fox.model.position.clone());
        for (let frame = 0; frame < 30 * 30; frame += 1) foxes.update(1 / 30, { hush: 1 });
        foxes.foxes.forEach((fox, index) => {
            expect(fox.state).toBe('idle');
            expect(fox.model.position.equals(still[index])).toBe(true);
        });
        // Back to the opening pose, and still when time stands still.
        foxes.reset();
        for (const dt of [0, -1, NaN, undefined]) foxes.update(dt, { gust: 1 });
        foxes.foxes.forEach((fox, index) => {
            expect(fox.state).toBe('idle');
            expect(fox.model.position.equals(still[index])).toBe(true);
        });
    });

    it('lights the foxes with the garden\'s own rig and one shared coat', () => {
        const { world, assets } = built;
        const coats = named(world.group, 'fox');
        expect(coats).toHaveLength(2);
        expect(coats[0].material).toBe(coats[1].material);
        expect(coats[0].material.isNodeMaterial).toBe(true);
        expect(coats[0].isSkinnedMesh).toBe(true);
        // Each fox is its own skeleton over the one borrowed mesh.
        expect(coats[0].skeleton).not.toBe(coats[1].skeleton);
        expect(coats[0].geometry).toBe(coats[1].geometry);
        let original = null;
        assets.fox.scene.traverse((object) => { if (object.isMesh) original = object; });
        expect(coats[0].geometry).toBe(original.geometry);
        // The model in the bundle keeps the material it came with.
        expect(original.material).not.toBe(coats[0].material);
        // The static shadow map cannot follow them: a soft patch under each does instead.
        for (const coat of coats) expect(coat.castShadow).toBe(false);
        const shades = named(world.group, /^SakuraFoxShade /);
        expect(shades[0].material).toBe(shades[1].material);
        expect(shades[0].material.transparent).toBe(true);
        expect(shades[0].material.depthWrite).toBe(false);
    });
});

describe('Sakura world ownership', () => {
    it('builds only once', async () => {
        const { world, scene } = await buildWorld('Minimal');
        const meshes = drawables(world.group);
        const {
            forest, petals, light, stage, director, spirits,
        } = world;
        expect(world.built).toBe(true);
        expect(world.build()).toBe(world);
        expect(world.forest).toBe(forest);
        expect(world.petals).toBe(petals);
        expect(world.light).toBe(light);
        expect(world.stage).toBe(stage);
        expect(world.director).toBe(director);
        expect(world.spirits).toBe(spirits);
        expect(drawables(world.group)).toEqual(meshes);
        expect(scene.children).toEqual([world.group]);
    }, 30000);

    // The moonbeams need the moon's shadow rig before the lens is built. Drawing the whole garden
    // straight to the canvas for that would compile every material a second time, so the world
    // offers a render of the ground alone.
    it('primes the shadow rig with a render of the ground alone, and puts everything back', async () => {
        const { world, scene, camera } = await buildWorld('Minimal');
        const parts = [...world.group.children];
        const shown = [];
        const renderer = { render: vi.fn(() => shown.push(parts.filter((part) => part.visible))) };
        world.primeShadows(renderer);
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        // Only the ground and the moon were there to be drawn.
        expect(shown[0]).toContain(world.terrain.group);
        expect(shown[0]).toContain(world.light.moon);
        for (const part of WORLD_PARTS.filter((name) => name !== 'terrain')) {
            expect(shown[0], part).not.toContain(world[part].group);
        }
        expect(shown[0].every((part) => part === world.terrain.group || part.isLight)).toBe(true);
        expect(parts.every((part) => part.visible)).toBe(true);
        // Whatever was already hidden stays hidden; a failed render hides nothing for good.
        world.sky.group.visible = false;
        renderer.render.mockImplementation(() => { throw new Error('device lost'); });
        expect(() => world.primeShadows(renderer)).toThrow('device lost');
        expect(world.sky.group.visible).toBe(false);
        expect(parts.filter((part) => part !== world.sky.group).every((part) => part.visible)).toBe(true);
        expect(world.group.children).toEqual(parts);
    }, 30000);

    it('disposes every owned resource once and leaves the shared assets to their owner', async () => {
        const {
            world, scene, assets, camera,
        } = await buildWorld('Medium');
        const shared = assetGeometries(assets);
        const { geometries, materials, instanced } = resources(world.group);
        const ownGeometries = [...geometries].filter((geometry) => !shared.has(geometry));
        expect(ownGeometries.length).toBeGreaterThan(8);
        expect(geometries.size - ownGeometries.length).toBeGreaterThan(20);
        const foxMaps = [];
        assets.fox.scene.traverse((object) => { if (object.material?.map) foxMaps.push(object.material.map); });
        expect(foxMaps.length).toBeGreaterThan(0);
        const spy = (resource) => vi.spyOn(resource, 'dispose');
        const once = [...ownGeometries, ...materials, ...instanced, world.light.noiseTexture, world.water.bedTexture,
            world.water.reflection].map(spy);
        const borrowed = [...shared, assets.impostors.texture, ...foxMaps].map(spy);
        const moon = spy(world.light.moon);

        world.dispose();
        world.dispose();
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(moon).toHaveBeenCalledOnce();
        borrowed.forEach((disposal) => expect(disposal).not.toHaveBeenCalled());
        expect(scene.children).toHaveLength(0);
        expect(world.group.parent).toBeNull();
        expect(world.group.children).toHaveLength(0);
        for (const key of ['light', ...WORLD_PARTS, 'director', 'stage']) expect(world[key], key).toBeNull();
        expect(() => world.build()).toThrow('Cannot rebuild a disposed SakuraWorld.');
        expect(scene.children).toHaveLength(0);
        // The camera is the theme's: it gets back the layers it came with.
        expect(camera.layers.mask).toBe(new THREE.Layers().mask);

        // A disposed world is inert rather than explosive.
        expect(() => {
            world.update(1, STEP, { emitters: [] });
            world.setBoard(SAKURA_DEFAULT_BOARD);
            world.resetEffects();
            world.placeFoxfire();
        }).not.toThrow();
        expect(world.floatLantern(0, -20, 0, 0, 1)).toBe(false);
        expect(world.getDiagnostics()).toMatchObject({
            quality: 'Medium', farTrees: 0, lamps: 0, petals: null,
        });
        expect(world.getDiagnostics().trees).toBeUndefined();

        // The bundle is released by whoever loaded it, once.
        disposeSakuraAssets(assets);
        borrowed.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    }, 30000);

    it('needs its assets and says so before touching the scene', async () => {
        const scene = new THREE.Scene();
        const world = new SakuraWorld({ scene, camera: new THREE.PerspectiveCamera() });
        owned.push(world);
        expect(world.tier).toBe(SAKURA_TIERS.High);
        expect(() => world.build()).toThrow('[Sakura] SakuraWorld needs its loaded assets before it can build.');
        expect(scene.children).toHaveLength(0);
        expect(world.built).toBe(false);
        // Nothing was half-made: update and diagnostics are still safe.
        expect(() => world.update(0, STEP, { emitters: [] })).not.toThrow();
        expect(world.getDiagnostics()).toEqual({
            quality: 'High', farTrees: 0, lanterns: 0, lamps: 0, petals: null,
        });
        // Once the assets are there the same world builds, at the tier it was asked for.
        const minimal = new SakuraWorld({ scene, camera: new THREE.PerspectiveCamera(), quality: 'Minimal' });
        owned.push(minimal);
        expect(() => minimal.build()).toThrow('needs its loaded assets');
        minimal.assets = await loadBundle();
        expect(minimal.build()).toBe(minimal);
        expect(scene.children).toEqual([minimal.group]);
        expect(minimal.petals.sim.count).toBe(SAKURA_TIERS.Minimal.petals);
    }, 30000);

    it.each([
        ['blossoms', 'petal', '[Sakura] The blossom pack has no "petal" mesh.'],
        ['blossoms', 'blossom_clump_1', '[Sakura] Blossom mesh "blossom_clump_1" is missing from the asset pack.'],
        ['props', 'torii', '[Sakura] Garden mesh "torii" is missing from the asset pack.'],
        ['props', 'stone_lantern', '[Sakura] Garden mesh "stone_lantern" is missing from the asset pack.'],
    ])('names the missing mesh when the %s pack lacks %s and still cleans up', async (pack, mesh, message) => {
        const assets = await loadBundle();
        const removed = assets[pack].meshes[mesh];
        expect(removed).toBeDefined();
        delete assets[pack].meshes[mesh];
        const { world, scene } = createWorld('Minimal', assets);
        expect(() => world.build()).toThrow(message);
        const terrain = vi.spyOn(world.terrain.mesh.geometry, 'dispose');
        const noise = vi.spyOn(world.light.noiseTexture, 'dispose');
        // Half a garden is not updated.
        expect(() => world.update(1, STEP, { emitters: [] })).not.toThrow();
        world.dispose();
        expect(terrain).toHaveBeenCalledOnce();
        expect(noise).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(world.group.children).toHaveLength(0);
        removed.dispose();
    }, 30000);

    it('builds without the lantern models the game launches, and then simply launches none', async () => {
        const assets = await loadBundle();
        for (const name of ['water_lantern', 'sky_lantern']) {
            assets.props.meshes[name].dispose();
            delete assets.props.meshes[name];
        }
        const { world } = createWorld('Minimal', assets);
        expect(world.build()).toBe(world);
        expect(named(world.group, /^Sakura(LanternsAfloat|SkyLantern)/)).toEqual([]);
        expect(world.floatLantern(2, -20, 0, -0.1, 1)).toBe(false);
        expect(world.spirits.releaseSky(0, 1, -30, 0)).toBe(false);
        const reactions = new SakuraReactions({ quality: 'Minimal', rng: seededRandom(5) });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onLevelUp();
        expect(() => {
            for (let frame = 0; frame < 20; frame += 1) world.update(frame * STEP, STEP, reactions.update(STEP));
            world.resetEffects();
        }).not.toThrow();
        // Foxfire and fireflies need no model.
        expect(named(world.group, 'SakuraFoxfire')).toHaveLength(1);
        expect(named(world.group, 'SakuraFireflies')).toHaveLength(1);
    }, 30000);

    // Every part is assigned to the world before it builds, so when a build throws halfway
    // world.dispose() still reaches what that part had already made.
    it('retains ownership of a partially built forest so a failure can be cleaned up', async () => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial();
        const geometryDisposal = vi.spyOn(geometry, 'dispose');
        const materialDisposal = vi.spyOn(material, 'dispose');
        vi.spyOn(SakuraForest.prototype, 'build').mockImplementation(function failedBuild() {
            this.own(geometry);
            this.own(material);
            this.group.add(new THREE.Mesh(geometry, material));
            throw new Error('partial forest failure');
        });
        const { world, scene } = createWorld('Minimal', await loadBundle());
        expect(() => world.build()).toThrow('partial forest failure');
        expect(world.forest).toBeInstanceOf(SakuraForest);
        // What was finished before the failure is still owned and released too.
        const finished = [world.terrain.mesh.geometry, world.terrain.mesh.material, world.light.noiseTexture,
            world.sky.dome.geometry, world.sky.dome.material].map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        world.dispose();
        expect(geometryDisposal).toHaveBeenCalledOnce();
        expect(materialDisposal).toHaveBeenCalledOnce();
        finished.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        expect(() => world.build()).toThrow('Cannot rebuild a disposed SakuraWorld.');
    }, 30000);

    // The bark geometry is borrowed from the asset bundle. A tier without twigs narrows its draw
    // range only while that forest exists; dispose() and any later build restore the range the
    // tier wants, so a cached bundle can be reused across tiers.
    it('hands a borrowed asset bundle back as it found it, whatever the tier', async () => {
        const assets = await loadBundle();
        const borrowed = [...assetGeometries(assets)];
        const ranges = () => Object.values(assets.trees).map((tree) => ({ ...tree.bark.drawRange }));
        const layout = () => borrowed.map((geometry) => Object.keys(geometry.attributes).sort().join());
        const pristine = ranges();
        const authored = layout();
        const low = createWorld('Minimal', assets);
        low.world.build();
        expect(SAKURA_TIERS.Minimal.twigs).toBe(false);
        expect(ranges()).not.toEqual(pristine);
        // While the garden stands, the grove's per-instance data rides on the borrowed geometry.
        expect(layout()).not.toEqual(authored);
        low.world.dispose();
        expect(ranges()).toEqual(pristine);
        expect(layout()).toEqual(authored);
        const high = createWorld('Medium', assets);
        high.world.build();
        expect(SAKURA_TIERS.Medium.twigs).toBe(true);
        for (const mesh of named(high.world.group, /^SakuraBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeGreaterThanOrEqual(mesh.geometry.index.count);
        }
        // The second garden's instance data is its own, sized for its own trees.
        for (const mesh of named(high.world.group, /^Sakura(Bark|Blossom) /)) {
            for (const attribute of Object.values(mesh.geometry.attributes)) {
                if (attribute.isInstancedBufferAttribute) expect(attribute.count, mesh.name).toBe(mesh.count);
            }
        }
        high.world.dispose();
        expect(ranges()).toEqual(pristine);
        expect(layout()).toEqual(authored);
    }, 30000);

    it('builds without the far-shore sprite sheet', async () => {
        const { world } = await buildWorld('Minimal', { impostors: false });
        expect(world.backdrop.count).toBe(0);
        expect(world.getDiagnostics().farTrees).toBe(0);
        expect(named(world.group, 'SakuraFarShoreTrees')).toEqual([]);
        expect(named(world.group, 'SakuraHills')).toHaveLength(1);
        expect(named(world.group, 'SakuraMountain')).toHaveLength(1);
        expect(() => world.update(1, STEP, { emitters: [] })).not.toThrow();
    }, 30000);

    // The garden is whole without its foxes: a failed download only leaves them out.
    it('builds without the foxes when their model did not arrive', async () => {
        const { world, assets } = await buildWorld('Minimal', { fox: false });
        expect(assets.fox).toBeNull();
        expect(world.foxes.foxes).toEqual([]);
        expect(world.foxes.group.children).toEqual([]);
        expect(named(world.group, 'fox')).toEqual([]);
        expect(named(world.group, /^SakuraFoxShade /)).toEqual([]);
        expect(world.foxes.group.parent).toBe(world.group);
        expect(() => {
            world.update(1, STEP, { gust: 1, emitters: [] });
            world.resetEffects();
        }).not.toThrow();
        // Everything else is there.
        expect(world.petals.sim.count).toBe(SAKURA_TIERS.Minimal.petals);
        expect(named(world.group, /^SakuraBark /).length).toBeGreaterThan(0);
    }, 30000);

    it('builds a garden from whichever trees were loaded', async () => {
        const loaded = ['sakura-hero-weeping', 'sakura-grove-a'];
        const { world } = await buildWorld('Minimal', { trees: loaded });
        const bark = named(world.group, /^SakuraBark /);
        expect(bark.map((mesh) => mesh.name).sort())
            .toEqual(['SakuraBark sakura-grove-a', 'SakuraBark sakura-hero-weeping']);
        expect(world.forest.placements.length).toBeGreaterThan(0);
        expect(world.forest.placements.every((tree) => loaded.includes(tree.asset))).toBe(true);
        expect(world.forest.stats.trees).toBe(sum(bark.map((mesh) => mesh.count)));
        const sprays = named(world.group, /^SakuraBlossom /);
        expect(sprays.length).toBeGreaterThan(0);
        expect(sprays.every((mesh) => /blossom_strand|blossom_clump/.test(mesh.name))).toBe(true);
        // Paper lanterns hang only from trees that are really there.
        expect(world.paperLanterns.length).toBeGreaterThan(0);
        for (const lantern of world.paperLanterns) expect(loaded).toContain(world.placements[lantern.tree].asset);
        expect(world.petals.sim.count).toBe(SAKURA_TIERS.Minimal.petals);
        expect(() => world.update(1, STEP, { emitters: [] })).not.toThrow();
    }, 30000);
});

describe('Sakura post tier ownership', () => {
    let built;

    beforeAll(async () => {
        built = await buildWorld('Minimal', { track: false });
    }, 60000);

    afterAll(() => {
        built.world.dispose();
        disposeSakuraAssets(built.assets);
    });

    const lit = () => ({ light: built.world.light, scene: built.scene, camera: built.camera });

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
        expect(SAKURA_TIERS[quality].post).toBe(false);
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
        post.update({ glow: 0.8 });
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

    it('constructs a node-only post graph with moonbeams for High and disposes it exactly once', () => {
        expect(built.world.light.moon.shadow.map).toBeNull();
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
        // GodraysNode reads the moon's shadow map while its graph is built: one direct render
        // of the garden makes the shadow rig exist first.
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(post.godraysNode.raymarchSteps.value).toBe(SAKURA_TIERS.High.godrays);
        expect(post.godraysNode.resolutionScale).toBe(SAKURA_TIERS.High.godraysScale);
        expect(post.beamsBlur.isNode).toBe(true);
        const disposals = [post.pipeline, post.scenePass, post.bloomNode, post.godraysNode, post.beamsBlur]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        post.dispose();
        post.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        for (const key of ['pipeline', 'scenePass', 'bloomNode', 'godraysNode', 'beamsBlur', 'renderer', 'scene',
            'camera', 'light']) {
            expect(post[key], key).toBeNull();
        }
        // Nothing is drawn through a disposed lens.
        expect(() => post.render()).not.toThrow();
        expect(renderer.render).toHaveBeenCalledOnce();
        // The garden's own light is not the lens's to dispose.
        expect(built.world.light.moon.parent).toBe(built.world.group);
    });

    it.each(['Medium', 'High', 'Ultra', 'Extreme'])('renders %s through its pipeline only', (quality) => {
        const { renderer, post } = createPost(quality, lit());
        const tier = SAKURA_TIERS[quality];
        expect(post.tier).toBe(tier);
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
        const { moon } = built.world.light;
        moon.shadow.map = { isRenderTarget: true, dispose() {} };
        try {
            const { renderer, post } = createPost('High', lit());
            expect(renderer.render).not.toHaveBeenCalled();
            expect(post.getDiagnostics().godrays).toBe(true);
        } finally {
            moon.shadow.map = null;
        }
    });

    it('lets its owner prime the shadow rig instead of drawing the whole garden to the canvas', () => {
        const prime = vi.fn();
        const { renderer, post } = createPost('High', { ...lit(), prime });
        expect(prime).toHaveBeenCalledOnce();
        expect(renderer.render).not.toHaveBeenCalled();
        expect(post.getDiagnostics().godrays).toBe(true);
        // Nothing to prime where there are no beams, or where the rig already exists.
        for (const quality of ['Minimal', 'Low']) {
            const direct = createPost(quality, { ...lit(), prime });
            expect(direct.renderer.render).not.toHaveBeenCalled();
        }
        const unlit = createPost('High', { prime });
        expect(unlit.renderer.render).not.toHaveBeenCalled();
        const { moon } = built.world.light;
        moon.shadow.map = { isRenderTarget: true, dispose() {} };
        try {
            createPost('High', { ...lit(), prime });
        } finally {
            moon.shadow.map = null;
        }
        expect(prime).toHaveBeenCalledOnce();
        // The world's own primer is what the theme hands it: one render, of this scene.
        const canvas = fakeRenderer();
        owned.push(new SakuraPost({
            renderer: canvas, quality: 'Medium', ...lit(), prime: () => built.world.primeShadows(canvas),
        }));
        expect(canvas.render).toHaveBeenCalledExactlyOnceWith(built.scene, built.camera);
        expect(built.world.group.children.every((part) => part.visible)).toBe(true);
    });

    it('grades without moonbeams when it is given no light', () => {
        const { renderer, post } = createPost('High');
        expect(post.getDiagnostics()).toEqual({
            quality: 'High', disabled: false, useMRT: false, godrays: false,
        });
        expect(post.godraysNode).toBeUndefined();
        expect(post.beamsBlur).toBeUndefined();
        expect(post.pipeline.isRenderPipeline).toBe(true);
        expect(post.bloomNode.isNode).toBe(true);
        expect(renderer.render).not.toHaveBeenCalled();
        expect(() => post.update({ glow: 1, moon: 1, spirit: 1 })).not.toThrow();
        const disposals = [post.pipeline, post.scenePass, post.bloomNode]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        post.dispose();
        post.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(post.pipeline).toBeNull();
    });

    it('falls back to the High lens for an unknown tier name', () => {
        const { post } = createPost('Potato');
        expect(post.tier).toBe(SAKURA_TIERS.High);
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

    it('answers glow, the flaring moon and the spirit with a bounded lift', () => {
        const { post } = createPost('High', lit());
        const read = (frame) => {
            post.update(frame);
            return {
                exposure: post.uExposure.value,
                beams: post.uBeams.value,
                bloom: post.bloomNode.strength.value,
                spirit: post.uSpirit.value,
            };
        };
        const rest = read({});
        expect(read()).toEqual(rest);
        expect(rest.spirit).toBe(0);
        const warm = read({ glow: 0.5, moon: 0.5, spirit: 0.5 });
        const hot = read({ glow: 1, moon: 1, spirit: 1 });
        for (const key of ['exposure', 'beams', 'bloom']) {
            expect(rest[key]).toBeGreaterThan(0);
            expect(warm[key]).toBeGreaterThan(rest[key]);
            expect(hot[key]).toBeGreaterThan(warm[key]);
        }
        expect([warm.spirit, hot.spirit]).toEqual([0.5, 1]);
        // Each envelope moves its own part of the lens.
        expect(read({ moon: 1 })).toMatchObject({ exposure: rest.exposure, bloom: rest.bloom, beams: hot.beams });
        expect(read({ glow: 1 })).toMatchObject({ exposure: hot.exposure, bloom: hot.bloom, beams: rest.beams });
        expect(read({ glow: 50, moon: 50, spirit: 50 })).toEqual(hot);
        for (const frame of [{ glow: NaN, moon: Infinity, spirit: NaN }, { glow: -3, moon: -3, spirit: -3 },
            { glow: 'hot', moon: null, spirit: undefined }]) {
            expect(read(frame)).toEqual(rest);
        }
        // The lens stays subtle: a full celebration is a lift, not a flash.
        expect(hot.exposure).toBeLessThan(rest.exposure * 1.5);
    });

    it('tints the beams from where the moon really is on screen', () => {
        const { world, camera } = built;
        camera.aspect = LANDSCAPE;
        camera.updateProjectionMatrix();
        world.prepareCamera(LANDSCAPE);
        camera.updateMatrixWorld(true);
        const { post } = createPost('High', lit());
        post.update({});
        const moon = camera.position.clone().addScaledVector(world.light.uMoonDir.value, 500);
        const expected = onScreen(camera, moon.x, moon.y, moon.z);
        expect(post.uMoonScreen.value.x).toBeCloseTo(expected.x, 6);
        expect(post.uMoonScreen.value.y).toBeCloseTo(expected.y, 6);
        // Upper right, where the landscape framing hangs it.
        expect(post.uMoonScreen.value.x).toBeGreaterThan(0.5);
        expect(post.uMoonScreen.value.y).toBeLessThan(0.5);
        // The portrait framing has its own moon; the tint follows it.
        camera.aspect = PORTRAIT;
        camera.updateProjectionMatrix();
        world.prepareCamera(PORTRAIT);
        camera.updateMatrixWorld(true);
        post.update({});
        const tall = camera.position.clone().addScaledVector(world.light.uMoonDir.value, 500);
        const tallScreen = onScreen(camera, tall.x, tall.y, tall.z);
        expect(post.uMoonScreen.value.x).toBeCloseTo(tallScreen.x, 6);
        expect(post.uMoonScreen.value.y).toBeCloseTo(tallScreen.y, 6);
        expect(post.uMoonScreen.value.distanceTo(new THREE.Vector2(expected.x, expected.y))).toBeGreaterThan(0.01);
        // With its back to the moon the camera has no screen position for it: the last one is kept.
        const kept = post.uMoonScreen.value.clone();
        camera.lookAt(camera.position.clone().addScaledVector(world.light.uMoonDir.value, -100));
        camera.updateMatrixWorld(true);
        post.update({});
        expect(post.uMoonScreen.value.equals(kept)).toBe(true);
        camera.aspect = LANDSCAPE;
        camera.updateProjectionMatrix();
        world.prepareCamera(LANDSCAPE);
    });
});
