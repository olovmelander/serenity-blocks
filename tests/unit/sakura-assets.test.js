import { createHash } from 'node:crypto';
import {
    existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    SAKURA_ASSET_SCHEMA, SAKURA_BLOSSOM_URL, SAKURA_FOX_URL, SAKURA_FUJI_URL, SAKURA_IMPOSTOR_URL, SAKURA_PROPS_URL,
    SAKURA_TREE_URLS, disposeSakuraAssets, loadSakuraAssets, parseSakuraPack, parseSakuraTree, prepareImpostorTexture,
    sakuraImpostorLayout,
} from '../../src/themes/sakura-twilight/sakura-assets.js';
import {
    SAKURA_FEATURE_TREES, SAKURA_LANTERN_GLOW, SAKURA_STONE_LANTERNS, layoutSakuraGrove,
} from '../../src/themes/sakura-twilight/sakura-composition.js';

const assetDirectory = new URL('../../src/themes/sakura-twilight/assets/', import.meta.url);
const MIB = 1024 * 1024;
const TREE_NAMES = Object.keys(SAKURA_TREE_URLS);
const PACK_URLS = [SAKURA_BLOSSOM_URL, SAKURA_PROPS_URL, SAKURA_FUJI_URL];
/** The glTF sample fox as it came: what the garden's own fox (SAKURA_FOX_URL) is rigged from. */
const FOX_SOURCE = 'Fox.glb';
// Every mesh the runtime asks the two packs for by name: the petal in the air, the garden's
// furniture, the boulders, and the lanterns the game sets afloat and aloft. (The blossom
// sprays are asked for by each tree's own `foliage` kind; see below.)
const REQUIRED_BLOSSOMS = ['petal'];
const REQUIRED_PROPS = ['stone_lantern', 'snow_lantern', 'paper_lantern', 'torii', 'bridge', 'pagoda', 'rock_a',
    'rock_b', 'rock_c', 'water_lantern', 'sky_lantern'];

// Generous ceilings, roughly 40% above what the Blender generator wrote on 2026-10-05
// (noted beside each), so the pack cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({
    directoryBytes: 5 * MIB, // 3.54 MiB
    glbBytes: 1.1 * MIB, // sakura-hero-spreading.glb, 0.77 MiB
    impostorBytes: 1.25 * MIB, // 0.86 MiB
    barkTriangles: { hero: 45000, grove: 10000 }, // 31,632 and 6,980
    sites: { hero: 2800, grove: 620 }, // 1,941 and 433
    sprayTriangles: 470, // 330
    petalTriangles: 8, // 4
    propTriangles: 2300, // the bridge, 1,572
    mountainTriangles: 28000, // 19,320
});

function fileNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

const files = new Map();

function readAsset(file) {
    if (!files.has(file)) files.set(file, readFileSync(new URL(file, assetDirectory)));
    return files.get(file);
}

/** The GLB container and its JSON chunk, with the header checked on the way. */
function readGlb(file) {
    const bytes = readAsset(file);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    return { bytes, json };
}

async function parseGlb(file) {
    const bytes = readAsset(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new GLTFLoader().parseAsync(buffer, '');
}

function finite(array) {
    for (let index = 0; index < array.length; index += 1) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

function extent(array, stride, offset) {
    let min = Infinity;
    let max = -Infinity;
    for (let index = offset; index < array.length; index += stride) {
        min = Math.min(min, array[index]);
        max = Math.max(max, array[index]);
    }
    return [min, max];
}

/** Smallest and largest vector length in a packed array of `width`-component vectors. */
function lengths(array, width) {
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < array.length; index += width) {
        let sum = 0;
        for (let component = 0; component < width; component += 1) sum += array[index + component] ** 2;
        min = Math.min(min, Math.sqrt(sum));
        max = Math.max(max, Math.sqrt(sum));
    }
    return [min, max];
}

function attributeLengths(attribute) {
    const vector = new THREE.Vector3();
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < attribute.count; index += 1) {
        const length = vector.fromBufferAttribute(attribute, index).length();
        min = Math.min(min, length);
        max = Math.max(max, length);
    }
    return [min, max];
}

function triangles(geometry) {
    return geometry.index.count / 3;
}

/** A loader that serves the real files from disk instead of fetching them, and keeps what it served. */
function diskLoader() {
    const served = new Map();
    return {
        served,
        loadAsync: vi.fn(async (url) => {
            const gltf = await parseGlb(fileNameOf(url));
            served.set(fileNameOf(url), gltf);
            return gltf;
        }),
    };
}

/** Hands out tiny data textures and records which of them are disposed. */
function stubTextureLoader() {
    const textures = [];
    const disposed = [];
    return {
        textures,
        disposed,
        loadAsync: vi.fn(async () => {
            const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
            texture.addEventListener('dispose', () => disposed.push(texture));
            textures.push(texture);
            return texture;
        }),
    };
}

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function materialsOf(gltf) {
    const materials = new Set();
    gltf.scene.traverse((object) => {
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
            if (material) materials.add(material);
        });
    });
    return [...materials];
}

function everyGeometry(assets) {
    return [...Object.values(assets.blossoms.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.fuji.geometry];
}

const parsed = {
    trees: {}, blossoms: null, props: null, manifest: null,
};

beforeAll(async () => {
    // The fox carries a texture; in Node the loader needs somewhere to decode it to.
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4, close() {} }));
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseSakuraTree(gltfs[index], name); });
    parsed.blossoms = parseSakuraPack(await parseGlb(fileNameOf(SAKURA_BLOSSOM_URL)), 'The blossom pack');
    parsed.props = parseSakuraPack(await parseGlb(fileNameOf(SAKURA_PROPS_URL)), 'The garden pack');
    parsed.manifest = JSON.parse(readAsset('asset-manifest.json').toString('utf8'));
});

afterAll(() => {
    vi.unstubAllGlobals();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Sakura asset pack on disk', () => {
    it('points every URL at a file that exists in the asset directory', () => {
        expect(Object.isFrozen(SAKURA_TREE_URLS)).toBe(true);
        expect(TREE_NAMES.length).toBeGreaterThan(0);
        const urls = [...Object.values(SAKURA_TREE_URLS), ...PACK_URLS, SAKURA_IMPOSTOR_URL, SAKURA_FOX_URL];
        for (const [name, url] of Object.entries(SAKURA_TREE_URLS)) expect(fileNameOf(url)).toBe(`${name}.glb`);
        for (const url of [...PACK_URLS, SAKURA_FOX_URL]) expect(fileNameOf(url)).toMatch(/\.glb$/);
        expect(fileNameOf(SAKURA_IMPOSTOR_URL)).toMatch(/\.png$/);
        const directory = fileURLToPath(assetDirectory);
        const referenced = urls.map(fileNameOf);
        urls.forEach((url) => {
            const file = fileNameOf(url);
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(statSync(new URL(file, assetDirectory)).size).toBeGreaterThan(0);
            // Under Vitest the URLs are file URLs; they must land in the pack, not beside it.
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(file, assetDirectory)));
                expect(fileURLToPath(url).startsWith(directory)).toBe(true);
            }
        });
        // Nothing ships that the runtime does not load, and nothing is loaded twice. The one file
        // kept beside them is the model the garden's fox was made from, untouched: the source
        // of the script that rigs it (scripts/sakura/rig-fox.mjs), never a download.
        const shipped = readdirSync(assetDirectory).filter((file) => /\.(glb|png)$/i.test(file)).sort();
        expect(referenced).not.toContain(FOX_SOURCE);
        expect(shipped).toEqual([...referenced, FOX_SOURCE].sort());
        expect(new Set(referenced).size).toBe(referenced.length);
        expect(readAsset(fileNameOf(SAKURA_IMPOSTOR_URL)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('knows every tree the composition places', () => {
        const placed = new Set(SAKURA_FEATURE_TREES.map((tree) => tree.asset));
        for (const seed of [5, 187, 271]) {
            layoutSakuraGrove(seededRandom(seed)).forEach((tree) => placed.add(tree.asset));
        }
        expect(placed.size).toBeGreaterThan(2);
        for (const asset of placed) expect(TREE_NAMES).toContain(asset);
        // And no tree is authored, shipped and loaded without ever being planted.
        for (const name of TREE_NAMES) expect([...placed]).toContain(name);
        // The two old trees by the camera are the two hero models.
        const heroes = TREE_NAMES.filter((name) => parsed.trees[name].role === 'hero');
        expect(SAKURA_FEATURE_TREES.slice(0, 2).map((tree) => tree.asset).sort()).toEqual([...heroes].sort());
        // The procedural grove never plants a hero.
        for (const tree of layoutSakuraGrove(seededRandom(5))) expect(parsed.trees[tree.asset].role).toBe('grove');
    });

    it('keeps the pack inside its download budget', () => {
        const shipped = readdirSync(assetDirectory);
        const total = shipped.reduce((sum, file) => sum + statSync(new URL(file, assetDirectory)).size, 0);
        expect(total).toBeLessThanOrEqual(BUDGET.directoryBytes);
        // An empty pack would also be inside its budget.
        expect(total).toBeGreaterThan(0.5 * MIB);
        for (const file of shipped.filter((entry) => entry.endsWith('.glb'))) {
            expect(statSync(new URL(file, assetDirectory)).size, file).toBeLessThanOrEqual(BUDGET.glbBytes);
        }
        expect(statSync(new URL(fileNameOf(SAKURA_IMPOSTOR_URL), assetDirectory)).size)
            .toBeLessThanOrEqual(BUDGET.impostorBytes);
    });

    it('matches every manifest entry byte for byte', () => {
        const { manifest } = parsed;
        expect(manifest.schemaVersion).toBe(SAKURA_ASSET_SCHEMA);
        expect(Array.isArray(manifest.assets)).toBe(true);
        expect(manifest.assets.length).toBeGreaterThan(0);
        // Portable: no absolute paths from the machine that ran Blender.
        expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//i);
        const loaded = [...Object.values(SAKURA_TREE_URLS), ...PACK_URLS, SAKURA_IMPOSTOR_URL].map(fileNameOf);
        // The generator merges partial runs into the manifest, so it may lag behind the
        // directory: this asserts that every LISTED entry matches its file, deliberately not
        // that every file is listed (the fox is a borrowed sample model and never is).
        const seen = new Set();
        for (const entry of manifest.assets) {
            expect(entry.file).not.toMatch(/[\\/]/);
            expect(seen.has(entry.file), `${entry.file} listed twice`).toBe(false);
            seen.add(entry.file);
            expect(existsSync(new URL(entry.file, assetDirectory)), entry.file).toBe(true);
            const bytes = readFileSync(new URL(entry.file, assetDirectory));
            expect(bytes.length, entry.file).toBe(entry.bytes);
            expect(createHash('sha256').update(bytes).digest('hex'), entry.file).toBe(entry.sha256);
            // Nothing is listed that the runtime does not load.
            expect(loaded, entry.file).toContain(entry.file);
            expect(typeof entry.kind).toBe('string');
        }
        // The sprite-sheet layout is read from here at runtime.
        expect(manifest.assets.filter((entry) => entry.kind === 'impostors')).toHaveLength(1);
        expect(manifest.assets.find((entry) => entry.kind === 'impostors').file).toBe(fileNameOf(SAKURA_IMPOSTOR_URL));
    });

    it('describes each listed tree, pack and the mountain the way the files really are', async () => {
        const { manifest } = parsed;
        const mountains = manifest.assets.filter((entry) => entry.kind === 'mountain');
        const summits = await Promise.all(mountains.map((entry) => parseGlb(entry.file)));
        let checked = 0;
        for (const entry of manifest.assets) {
            if (entry.kind === 'tree') {
                const tree = parsed.trees[entry.file.replace(/\.glb$/, '')];
                expect(tree, entry.file).toBeDefined();
                expect(entry).toMatchObject({ role: tree.role, habit: tree.habit });
                if (entry.sites !== undefined) expect(entry.sites).toBe(tree.sites.count);
                if (entry.barkTriangles !== undefined) expect(entry.barkTriangles).toBe(triangles(tree.bark));
                checked += 1;
            }
            if ((entry.kind === 'blossoms' || entry.kind === 'props') && entry.meshes) {
                const pack = entry.kind === 'blossoms' ? parsed.blossoms : parsed.props;
                expect(Object.keys(entry.meshes).sort()).toEqual(Object.keys(pack.meshes).sort());
                // The pack carries the same record inside the file.
                expect(pack.records).toEqual(entry.meshes);
                for (const [name, record] of Object.entries(entry.meshes)) {
                    const geometry = pack.meshes[name];
                    expect(record.triangles, name).toBe(triangles(geometry));
                    if (record.boundsMin) {
                        const { min, max } = geometry.boundingBox;
                        record.boundsMin.forEach((value, axis) => {
                            expect(min.getComponent(axis), name).toBeCloseTo(value, 2);
                        });
                        record.boundsMax.forEach((value, axis) => {
                            expect(max.getComponent(axis), name).toBeCloseTo(value, 2);
                        });
                    }
                }
                checked += 1;
            }
            if (entry.kind === 'mountain') {
                const gltf = summits[mountains.indexOf(entry)];
                const mesh = gltf.scene.children.find((child) => child.name === 'fuji');
                expect(entry.triangles).toBe(mesh.geometry.index.count / 3);
                expect(gltf.scene.userData.baseRadius).toBe(entry.baseRadius);
                expect(gltf.scene.userData.height).toBe(entry.height);
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});

describe('Sakura tree assets', () => {
    it.each(TREE_NAMES)('%s is a compact, texture-free GLB with a bark mesh and a cloud of blossom sites', (name) => {
        const { json } = readGlb(`${name}.glb`);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.extensionsUsed || []).not.toContain('EXT_meshopt_compression');
        expect(json.extensionsUsed || []).not.toContain('KHR_draco_mesh_compression');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes).toHaveLength(1);
        const primitive = (nodeName) => {
            const node = json.nodes.find((entry) => entry.name === nodeName);
            expect(node, nodeName).toBeDefined();
            // parseSakuraTree decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            return json.meshes[node.mesh].primitives[0];
        };
        const bark = primitive('bark');
        expect(bark.mode ?? 4).toBe(4);
        expect(Object.keys(bark.attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0']);
        expect(bark.indices).toBeDefined();
        const sites = primitive('sites');
        expect(sites.mode).toBe(0);
        expect(Object.keys(sites.attributes).sort()).toEqual(['POSITION', '_BENT', '_KIND', '_PARAMS', '_ROT']);
        const meta = json.scenes[0].extras;
        expect(meta).toMatchObject({ schemaVersion: SAKURA_ASSET_SCHEMA, name });
        expect(['hero', 'grove']).toContain(meta.role);
        expect(['spreading', 'weeping']).toContain(meta.habit);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        expect(tree).toMatchObject({ name });
        expect(['hero', 'grove']).toContain(tree.role);
        expect(['spreading', 'weeping']).toContain(tree.habit);
        expect(tree.height).toBeGreaterThan(5);
        expect(tree.height).toBeLessThan(40);
        expect(tree.trunkRadius).toBeGreaterThan(0.05);
        expect(tree.trunkRadius).toBeLessThan(tree.height / 5);
        for (const key of ['crownCentre', 'crownRadii']) {
            expect(tree[key]).toHaveLength(3);
            expect(tree[key].every(Number.isFinite)).toBe(true);
        }
        expect(tree.crownCentre[1]).toBeGreaterThan(0);
        expect(tree.crownCentre[1]).toBeLessThan(tree.height);
        expect(tree.crownRadii.every((radius) => radius > 0)).toBe(true);

        const { bark } = tree;
        expect(bark.isBufferGeometry).toBe(true);
        expect(bark.name).toBe('bark');
        expect(Object.keys(bark.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
        const { position } = bark.attributes;
        expect(position.array).toBeInstanceOf(Float32Array);
        expect(position.itemSize).toBe(3);
        expect(position.normalized).toBe(false);
        expect(finite(position.array)).toBe(true);
        for (const key of ['normal', 'uv', 'color']) expect(bark.attributes[key].count).toBe(position.count);
        const [minY, maxY] = extent(position.array, 3, 1);
        // The roots go down into the soil (deep enough to stay buried on the slope of the
        // knoll); the trunk starts at the origin.
        expect(minY).toBeLessThan(0.05);
        expect(minY).toBeGreaterThan(-2.5);
        // `height` is the design height the crown was grown toward: the wood stops at or below
        // it (a weeping cherry's boughs arch over well short of the top of its blossom).
        expect(maxY).toBeLessThanOrEqual(tree.height * 1.05);
        expect(maxY).toBeGreaterThan(tree.height * 0.5);
        for (const offset of [0, 2]) {
            const [min, max] = extent(position.array, 3, offset);
            expect(min).toBeLessThan(0);
            expect(max).toBeGreaterThan(0);
            expect(max - min).toBeLessThan(tree.height * 2);
            expect(max - min).toBeGreaterThan(tree.trunkRadius * 2);
        }
        expect(bark.boundingBox.min.y).toBeCloseTo(minY, 5);
        expect(bark.boundingBox.max.y).toBeCloseTo(maxY, 5);
        expect(bark.boundingSphere.radius).toBeGreaterThan(tree.height * 0.3);
        expect(bark.boundingSphere.radius).toBeLessThan(tree.height * 1.5);

        expect(bark.index).not.toBeNull();
        expect(bark.index.count % 3).toBe(0);
        expect(extent(bark.index.array, 1, 0)).toEqual([0, position.count - 1]);
        expect(triangles(bark)).toBeLessThanOrEqual(BUDGET.barkTriangles[tree.role]);
        expect(triangles(bark)).toBeGreaterThan(500);
        // Twigs come last in the index buffer, so a tier can stop drawing at a triangle boundary.
        expect(Number.isInteger(tree.barkCoreIndices)).toBe(true);
        expect(tree.barkCoreIndices % 3).toBe(0);
        expect(tree.barkCoreIndices).toBeGreaterThan(0);
        expect(tree.barkCoreIndices).toBeLessThanOrEqual(bark.index.count);

        const normals = attributeLengths(bark.attributes.normal);
        expect(normals[0]).toBeGreaterThan(0.97);
        expect(normals[1]).toBeLessThan(1.03);
        expect(finite(bark.attributes.uv.array)).toBe(true);
        // Paint: sway, limb phase, occlusion, moss - all fractions.
        const paint = bark.attributes.color;
        expect(paint.itemSize).toBe(4);
        for (let index = 0; index < paint.count; index += 37) {
            for (const value of [paint.getX(index), paint.getY(index), paint.getZ(index), paint.getW(index)]) {
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
            }
        }
    });

    it.each(TREE_NAMES)('%s carries well-formed blossom sites on its boughs', (name) => {
        const tree = parsed.trees[name];
        const { sites } = tree;
        expect(sites.count).toBeGreaterThan(0);
        expect(sites.count).toBeLessThanOrEqual(BUDGET.sites[tree.role]);
        expect(sites.position).toHaveLength(sites.count * 3);
        expect(sites.rotation).toHaveLength(sites.count * 4);
        expect(sites.bent).toHaveLength(sites.count * 3);
        for (const key of ['scale', 'sky', 'sway', 'phase', 'hue', 'variant']) {
            expect(sites[key], key).toHaveLength(sites.count);
        }
        for (const key of ['position', 'rotation', 'bent', 'scale', 'sky', 'sway', 'phase', 'hue']) {
            expect(sites[key]).toBeInstanceOf(Float32Array);
            expect(finite(sites[key]), key).toBe(true);
        }
        const rotations = lengths(sites.rotation, 4);
        expect(rotations[0]).toBeGreaterThan(0.98);
        expect(rotations[1]).toBeLessThan(1.02);
        const bent = lengths(sites.bent, 3);
        expect(bent[0]).toBeGreaterThan(0.9);
        expect(bent[1]).toBeLessThan(1.1);
        for (const key of ['sky', 'sway', 'phase', 'hue']) {
            const [min, max] = extent(sites[key], 1, 0);
            expect(min, key).toBeGreaterThanOrEqual(0);
            expect(max, key).toBeLessThanOrEqual(1);
        }
        // Each spray is its own: the per-site numbers really vary across the crown.
        for (const key of ['sky', 'phase', 'hue']) {
            const [min, max] = extent(sites[key], 1, 0);
            expect(max - min, key).toBeGreaterThan(0.3);
        }
        // Sprays are sized in metres: never collapsed, never the size of the tree.
        const [smallest, largest] = extent(sites.scale, 1, 0);
        expect(smallest).toBeGreaterThan(0);
        expect(largest).toBeLessThan(tree.height / 2);
        // They sit on the wood: never below the roots, never above the top of the tree, and
        // most of them well up in the crown.
        const { boundingBox } = tree.bark;
        const [lowest, highest] = extent(sites.position, 3, 1);
        expect(lowest).toBeGreaterThan(boundingBox.min.y);
        expect(highest).toBeLessThanOrEqual(tree.height * 1.05);
        let aloft = 0;
        for (let index = 0; index < sites.count; index += 1) {
            if (sites.position[index * 3 + 1] > 1) aloft += 1;
        }
        expect(aloft).toBeGreaterThan(sites.count * 0.9);
        for (const [offset, axis] of [[0, 'x'], [2, 'z']]) {
            const [min, max] = extent(sites.position, 3, offset);
            expect(min).toBeGreaterThan(boundingBox.min[axis] - 2);
            expect(max).toBeLessThan(boundingBox.max[axis] + 2);
        }
        // Each site names a spray variant the blossom pack really has.
        const { variants, meshes } = parsed.blossoms;
        expect(typeof tree.foliage).toBe('string');
        for (let variant = 0; variant < variants; variant += 1) {
            expect(meshes[`${tree.foliage}_${variant}`], `${tree.foliage}_${variant}`).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBeGreaterThan(1);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it('lets the hero trees carry far more wood and blossom than the grove trees', () => {
        const heroes = Object.values(parsed.trees).filter((tree) => tree.role === 'hero');
        const grove = Object.values(parsed.trees).filter((tree) => tree.role === 'grove');
        expect(heroes.length).toBeGreaterThan(0);
        expect(grove.length).toBeGreaterThan(heroes.length);
        const least = (trees, read) => Math.min(...trees.map(read));
        const most = (trees, read) => Math.max(...trees.map(read));
        expect(least(heroes, (tree) => tree.sites.count)).toBeGreaterThan(most(grove, (tree) => tree.sites.count));
        expect(least(heroes, (tree) => triangles(tree.bark)))
            .toBeGreaterThan(most(grove, (tree) => triangles(tree.bark)));
        expect(least(heroes, (tree) => tree.height)).toBeGreaterThan(most(grove, (tree) => tree.height));
        // Both habits are in the grove, so the far shore is not one silhouette.
        expect(new Set(grove.map((tree) => tree.habit)).size).toBeGreaterThan(1);
    });

    it('refuses a tree written for another schema or missing a primitive', async () => {
        const file = 'sakura-grove-weeping.glb';
        const stale = await parseGlb(file);
        stale.scene.userData.schemaVersion = SAKURA_ASSET_SCHEMA + 1;
        const other = SAKURA_ASSET_SCHEMA + 1;
        expect(() => parseSakuraTree(stale, 'weeping'))
            .toThrow(`[Sakura] Tree "weeping" has asset schema ${other}; expected ${SAKURA_ASSET_SCHEMA}.`);
        const untagged = await parseGlb(file);
        untagged.scene.userData = {};
        expect(() => parseSakuraTree(untagged, 'bare')).toThrow('has asset schema undefined');
        const parts = ['sites', 'bark'];
        const copies = await Promise.all(parts.map(() => parseGlb(file)));
        parts.forEach((missing, index) => {
            const broken = copies[index];
            broken.scene.remove(broken.scene.children.find((entry) => entry.name === missing));
            expect(() => parseSakuraTree(broken, 'broken'))
                .toThrow(`[Sakura] Asset is missing its "${missing}" primitive.`);
        });
        // The file names its own tree; the argument is only a fallback and a label for errors.
        const renamed = await parseGlb(file);
        expect(parseSakuraTree(renamed, 'whatever').name).toBe('sakura-grove-weeping');
        const anonymous = await parseGlb(file);
        delete anonymous.scene.userData.name;
        expect(parseSakuraTree(anonymous, 'fallback').name).toBe('fallback');
    });
});

describe('Sakura blossom and garden packs', () => {
    it.each([
        ['blossom', SAKURA_BLOSSOM_URL], ['garden', SAKURA_PROPS_URL], ['mountain', SAKURA_FUJI_URL],
    ])('ships the %s pack as a compact, texture-free GLB', (_label, url) => {
        const { json } = readGlb(fileNameOf(url));
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.extensionsUsed || []).not.toContain('EXT_meshopt_compression');
        expect(json.extensionsUsed || []).not.toContain('KHR_draco_mesh_compression');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(SAKURA_ASSET_SCHEMA);
        for (const node of json.nodes) {
            // Meshes decode through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
        }
    });

    it('contains every mesh the runtime asks for', () => {
        const { variants, meshes } = parsed.blossoms;
        expect(variants).toBeGreaterThanOrEqual(1);
        for (const name of REQUIRED_BLOSSOMS) expect(meshes[name], name).toBeDefined();
        const kinds = new Set(Object.values(parsed.trees).map((tree) => tree.foliage));
        expect(kinds.size).toBeGreaterThan(1);
        for (const kind of kinds) {
            for (let variant = 0; variant < variants; variant += 1) {
                expect(meshes[`${kind}_${variant}`], `${kind}_${variant}`).toBeDefined();
            }
        }
        for (const name of REQUIRED_PROPS) expect(parsed.props.meshes[name], name).toBeDefined();
        // Every lantern the composition stands in the garden has a model and a lit core.
        for (const lantern of SAKURA_STONE_LANTERNS) {
            expect(parsed.props.meshes[lantern.kind], lantern.kind).toBeDefined();
            expect(SAKURA_LANTERN_GLOW[lantern.kind], lantern.kind).toBeDefined();
        }
        for (const [kind, glow] of Object.entries(SAKURA_LANTERN_GLOW)) {
            // The light a lantern throws on the ground comes from inside the lantern.
            const { min, max } = parsed.props.meshes[kind].boundingBox;
            expect(glow.height).toBeGreaterThan(min.y);
            expect(glow.height).toBeLessThan(max.y);
            expect(glow.power).toBeGreaterThan(0);
        }
    });

    it('authors every blossom mesh small, complete and the right way up', () => {
        const names = Object.keys(parsed.blossoms.meshes);
        expect(names.length).toBeGreaterThan(REQUIRED_BLOSSOMS.length);
        for (const name of names) {
            const geometry = parsed.blossoms.meshes[name];
            expect(geometry.isBufferGeometry).toBe(true);
            expect(geometry.name).toBe(name);
            expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
            const { position } = geometry.attributes;
            expect(position.array).toBeInstanceOf(Float32Array);
            expect(finite(position.array)).toBe(true);
            for (const key of ['normal', 'uv', 'color']) expect(geometry.attributes[key].count).toBe(position.count);
            expect(geometry.index.count % 3).toBe(0);
            expect(extent(geometry.index.array, 1, 0)[1]).toBeLessThan(position.count);
            const single = !/^blossom_/.test(name);
            expect(triangles(geometry)).toBeGreaterThan(1);
            expect(triangles(geometry), name).toBeLessThanOrEqual(single && name.startsWith('petal')
                ? BUDGET.petalTriangles : BUDGET.sprayTriangles);
            // Authored at about unit size; instances scale them into place.
            const size = geometry.boundingBox.getSize(new THREE.Vector3());
            expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.3);
            expect(Math.max(size.x, size.y, size.z)).toBeLessThan(2);
            const normals = attributeLengths(geometry.attributes.normal);
            expect(normals[0]).toBeGreaterThan(0.97);
            expect(normals[1]).toBeLessThan(1.03);
            // Paint (position along the petal, flower id, shade, petal-or-wood) is all fractions.
            const paint = geometry.attributes.color;
            expect(paint.itemSize).toBe(4);
            for (let index = 0; index < paint.count; index += 1) {
                for (const value of [paint.getX(index), paint.getY(index), paint.getZ(index), paint.getW(index)]) {
                    expect(value).toBeGreaterThanOrEqual(0);
                    expect(value).toBeLessThanOrEqual(1);
                }
            }
            if (single) {
                // The petal simulation lays a petal flat by turning its local XY plane to the ground.
                expect(size.z).toBeLessThan(Math.min(size.x, size.y) * 0.5);
            } else {
                // Sprays grow from their attachment point along +Y.
                expect(geometry.boundingBox.min.y).toBeGreaterThan(-0.2);
                expect(geometry.boundingBox.max.y).toBeGreaterThan(0.5);
            }
        }
        // The air is full of the cheapest mesh in the pack.
        const petal = triangles(parsed.blossoms.meshes.petal);
        for (const name of names.filter((entry) => /^blossom_/.test(entry))) {
            expect(triangles(parsed.blossoms.meshes[name])).toBeGreaterThan(petal * 5);
        }
    });

    it('authors the garden furniture in metres, each piece standing on its own origin', () => {
        const box = (name) => parsed.props.meshes[name].boundingBox;
        for (const name of Object.keys(parsed.props.meshes)) {
            const geometry = parsed.props.meshes[name];
            expect(geometry.name).toBe(name);
            expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
            expect(finite(geometry.attributes.position.array)).toBe(true);
            expect(geometry.index.count % 3).toBe(0);
            expect(extent(geometry.index.array, 1, 0)[1]).toBeLessThan(geometry.attributes.position.count);
            expect(triangles(geometry)).toBeGreaterThan(10);
            expect(triangles(geometry), name).toBeLessThanOrEqual(BUDGET.propTriangles);
            const normals = attributeLengths(geometry.attributes.normal);
            expect(normals[0]).toBeGreaterThan(0.97);
            expect(normals[1]).toBeLessThan(1.03);
            // uv is not a texture coordinate here: x is how much of the face is lit paper and
            // y the height inside the lit part, both fractions.
            const { uv } = geometry.attributes;
            expect(uv.count).toBe(geometry.attributes.position.count);
            let lowest = Infinity;
            let highest = -Infinity;
            for (let index = 0; index < uv.count; index += 1) {
                lowest = Math.min(lowest, uv.getX(index), uv.getY(index));
                highest = Math.max(highest, uv.getX(index), uv.getY(index));
            }
            expect(lowest, name).toBeGreaterThanOrEqual(0);
            expect(highest, name).toBeLessThanOrEqual(1);
            // Surface colour and baked occlusion are fractions too.
            const paint = geometry.attributes.color;
            expect(paint.itemSize).toBe(4);
            for (let index = 0; index < paint.count; index += 11) {
                for (const value of [paint.getX(index), paint.getY(index), paint.getZ(index), paint.getW(index)]) {
                    expect(value).toBeGreaterThanOrEqual(0);
                    expect(value).toBeLessThanOrEqual(1);
                }
            }
            // Centred on its origin in plan.
            const { min, max } = geometry.boundingBox;
            expect(min.x).toBeLessThan(0);
            expect(max.x).toBeGreaterThan(0);
            expect(min.z).toBeLessThan(0);
            expect(max.z).toBeGreaterThan(0);
        }
        // Lanterns on the ground and on the water stand on their foot.
        for (const name of ['stone_lantern', 'water_lantern', 'sky_lantern', 'pagoda']) {
            expect(box(name).min.y, name).toBeCloseTo(0, 1);
            expect(box(name).max.y, name).toBeGreaterThan(0.3);
        }
        // A paper lantern hangs below the hook it is placed at.
        expect(box('paper_lantern').max.y).toBeCloseTo(0, 2);
        expect(box('paper_lantern').min.y).toBeLessThan(-0.5);
        // The torii's posts and the bridge's piers reach down into the lake.
        expect(box('torii').min.y).toBeLessThan(-0.5);
        expect(box('bridge').min.y).toBeLessThan(-0.5);
        // Human scale: a lantern is about a person tall, the pagoda is a tower.
        expect(box('stone_lantern').max.y).toBeGreaterThan(1);
        expect(box('stone_lantern').max.y).toBeLessThan(3.5);
        expect(box('pagoda').max.y).toBeGreaterThan(8);
        expect(box('torii').max.y).toBeGreaterThan(3);
        expect(box('water_lantern').max.y).toBeLessThan(1);
        // The paper of every lantern glows; boulders have none.
        const lit = (name) => {
            const { uv } = parsed.props.meshes[name].attributes;
            let most = 0;
            for (let index = 0; index < uv.count; index += 1) most = Math.max(most, uv.getX(index));
            return most;
        };
        for (const name of ['stone_lantern', 'snow_lantern', 'paper_lantern', 'water_lantern', 'sky_lantern']) {
            expect(lit(name), name).toBeGreaterThan(0.5);
        }
        for (const name of ['rock_a', 'rock_b', 'rock_c']) expect(lit(name), name).toBe(0);
    });

    it('refuses a pack written for another schema, naming the pack', async () => {
        const stale = await parseGlb(fileNameOf(SAKURA_BLOSSOM_URL));
        stale.scene.userData.schemaVersion = 0;
        expect(() => parseSakuraPack(stale, 'The blossom pack'))
            .toThrow(`[Sakura] The blossom pack has asset schema 0; expected ${SAKURA_ASSET_SCHEMA}.`);
        stale.scene.userData = undefined;
        expect(() => parseSakuraPack(stale, 'The garden pack')).toThrow('The garden pack has asset schema undefined');
        // A pack without records or variants still parses its meshes.
        const bare = await parseGlb(fileNameOf(SAKURA_PROPS_URL));
        bare.scene.userData = { schemaVersion: SAKURA_ASSET_SCHEMA };
        const pack = parseSakuraPack(bare, 'The garden pack');
        expect(pack.variants).toBe(0);
        expect(pack.records).toEqual({});
        expect(Object.keys(pack.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        Object.values(pack.meshes).forEach((geometry) => geometry.dispose());
    });
});

describe('Sakura far-shore sprite sheet', () => {
    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const layout = sakuraImpostorLayout();
        expect(Object.keys(layout).sort()).toEqual(['atlasHeight', 'atlasWidth', 'tiles']);
        const png = readAsset(fileNameOf(SAKURA_IMPOSTOR_URL));
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(layout.atlasWidth);
        expect(png.readUInt32BE(20)).toBe(layout.atlasHeight);
        // Shade, blossom mask, hue seed and coverage: four 8-bit channels.
        expect([png[24], png[25]]).toEqual([8, 6]);
        expect(layout.tiles.length).toBeGreaterThan(0);
        const ordered = [...layout.tiles].sort((a, b) => a.x - b.x);
        let cursor = 0;
        for (const tile of ordered) {
            expect(Number.isInteger(tile.x)).toBe(true);
            expect(Number.isInteger(tile.pixels)).toBe(true);
            expect(tile.pixels).toBeGreaterThan(0);
            expect(tile.x).toBeGreaterThanOrEqual(cursor);
            cursor = tile.x + tile.pixels;
        }
        expect(cursor).toBeLessThanOrEqual(layout.atlasWidth);
    });

    it('describes each tile as one of the grove trees, at its true proportions', () => {
        const layout = sakuraImpostorLayout();
        for (const tile of layout.tiles) {
            const tree = parsed.trees[tile.asset];
            expect(tree, tile.asset).toBeDefined();
            expect(tree.role).toBe('grove');
            expect(tile.habit).toBe(tree.habit);
            // Metres on the card match pixels on the sheet, so no sprite is stretched.
            expect(tile.width / tile.height).toBeCloseTo(tile.pixels / layout.atlasHeight, 3);
            // The card frames the tree in blossom: about as tall as the tree, never a different scale.
            expect(tile.height).toBeGreaterThan(tree.height * 0.6);
            expect(tile.height).toBeLessThan(tree.height * 1.4);
            // Where the trunk stands, as a fraction of the tile width from its centre.
            expect(Math.abs(tile.trunk)).toBeLessThan(0.5);
            expect(tile.coverage).toBeGreaterThan(0);
            expect(tile.coverage).toBeLessThanOrEqual(1);
        }
        // Far trees come in more than one silhouette and both habits.
        expect(new Set(layout.tiles.map((tile) => tile.asset)).size).toBe(layout.tiles.length);
        expect(new Set(layout.tiles.map((tile) => tile.habit)).size).toBeGreaterThan(1);
    });

    it('prepares the sheet as linear, clamped, mip-mapped data', () => {
        const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareImpostorTexture(texture)).toBe(texture);
        // The channels are shading data, not colour: no transfer function may touch them.
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.name).not.toBe('');
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });
});

describe('loading and releasing the Sakura assets', () => {
    it('loads every file once and returns the parsed bundle', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const isCurrent = vi.fn(() => true);
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadSakuraAssets({ loader, textureLoader, isCurrent });
        const requested = loader.loadAsync.mock.calls.map(([url]) => url);
        expect([...requested].sort())
            .toEqual([...PACK_URLS, SAKURA_FOX_URL, ...Object.values(SAKURA_TREE_URLS)].sort());
        expect(textureLoader.loadAsync).toHaveBeenCalledExactlyOnceWith(SAKURA_IMPOSTOR_URL);
        // Ownership is checked once, after everything has arrived.
        expect(isCurrent).toHaveBeenCalledOnce();
        expect(isCurrent.mock.invocationCallOrder[0])
            .toBeGreaterThan(Math.max(...loader.loadAsync.mock.invocationCallOrder));

        expect(Object.keys(assets).sort()).toEqual(['blossoms', 'fox', 'fuji', 'impostors', 'props', 'trees']);
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        for (const name of TREE_NAMES) {
            expect(assets.trees[name].name).toBe(name);
            expect(assets.trees[name].sites.count).toBe(parsed.trees[name].sites.count);
            expect(triangles(assets.trees[name].bark)).toBe(triangles(parsed.trees[name].bark));
        }
        expect(Object.keys(assets.blossoms.meshes).sort()).toEqual(Object.keys(parsed.blossoms.meshes).sort());
        expect(assets.blossoms.variants).toBe(parsed.blossoms.variants);
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(assets.impostors).toEqual({ ...sakuraImpostorLayout(), texture: textureLoader.textures[0] });
        expect(assets.impostors.texture.colorSpace).toBe(THREE.NoColorSpace);
        // The fox is handed over whole: its scene, one skinned mesh on its skeleton. It brings no
        // clips — the theme animates the skeleton itself (sakura-fox-rig.js).
        expect(fileNameOf(SAKURA_FOX_URL)).not.toBe(FOX_SOURCE);
        expect(assets.fox.scene).toBe(loader.served.get(fileNameOf(SAKURA_FOX_URL)).scene);
        expect(assets.fox.animations).toBe(loader.served.get(fileNameOf(SAKURA_FOX_URL)).animations);
        expect(assets.fox.animations).toEqual([]);
        const skins = [];
        assets.fox.scene.traverse((object) => { if (object.isSkinnedMesh) skins.push(object); });
        expect(skins).toHaveLength(1);
        expect(skins[0].skeleton.bones.length).toBeGreaterThan(0);
        expect(skins[0].material.map).toBeTruthy();
        // A bundle that is handed over is intact.
        expect(disposal).not.toHaveBeenCalled();
        expect(textureLoader.disposed).toEqual([]);
        disposeSakuraAssets(assets);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('stands the mountain on the horizon plane at unit height', async () => {
        const assets = await loadSakuraAssets({ loader: diskLoader(), textureLoader: null });
        const { geometry, baseRadius } = assets.fuji;
        expect(geometry.isBufferGeometry).toBe(true);
        expect(geometry.name).toBe('fuji');
        expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position']);
        expect(finite(geometry.attributes.position.array)).toBe(true);
        expect(triangles(geometry)).toBeGreaterThan(1000);
        expect(triangles(geometry)).toBeLessThanOrEqual(BUDGET.mountainTriangles);
        // The backdrop scales it by the height it wants: the model itself is one unit tall.
        const { min, max } = geometry.boundingBox;
        expect(min.y).toBeCloseTo(0, 1);
        expect(max.y).toBeGreaterThan(0.9);
        expect(max.y).toBeLessThan(1.1);
        // A broad cone: several times wider than tall, with the recorded foot.
        expect(baseRadius).toBeGreaterThan(1.5);
        const reach = Math.max(-min.x, max.x, -min.z, max.z);
        expect(reach).toBeGreaterThan(baseRadius * 0.8);
        expect(reach).toBeLessThan(baseRadius * 1.2);
        const normals = attributeLengths(geometry.attributes.normal);
        expect(normals[0]).toBeGreaterThan(0.97);
        expect(normals[1]).toBeLessThan(1.03);
        disposeSakuraAssets(assets);
    });

    it('disposes everything and returns null when the start that asked is no longer current', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const mapDisposal = vi.spyOn(THREE.Texture.prototype, 'dispose');
        const assets = await loadSakuraAssets({ loader, textureLoader, isCurrent: () => false });
        expect(assets).toBeNull();
        expect(loader.loadAsync).toHaveBeenCalledTimes(TREE_NAMES.length + 4);
        const fox = loader.served.get(fileNameOf(SAKURA_FOX_URL));
        const foxGeometries = [];
        const foxMaps = [];
        fox.scene.traverse((object) => {
            if (object.geometry) foxGeometries.push(object.geometry);
            if (object.material?.map) foxMaps.push(object.material.map);
        });
        expect(foxGeometries.length).toBeGreaterThan(0);
        expect(foxMaps.length).toBeGreaterThan(0);
        const released = disposal.mock.contexts.filter((geometry) => !foxGeometries.includes(geometry))
            .map((geometry) => geometry.name).sort();
        expect(released).toEqual([...Object.keys(parsed.blossoms.meshes), ...REQUIRED_PROPS,
            ...TREE_NAMES.map(() => 'bark'), 'fuji'].sort());
        expect(new Set(disposal.mock.contexts).size).toBe(released.length + foxGeometries.length);
        for (const geometry of foxGeometries) expect(disposal.mock.contexts).toContain(geometry);
        for (const map of foxMaps) expect(mapDisposal.mock.contexts).toContain(map);
        expect(textureLoader.textures).toHaveLength(1);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('releases the loader\'s own materials but leaves the fox its fur', async () => {
        const loader = diskLoader();
        const served = [];
        const parse = loader.loadAsync.getMockImplementation();
        loader.loadAsync.mockImplementation(async (url) => {
            const gltf = await parse(url);
            const spies = materialsOf(gltf).map((material) => vi.spyOn(material, 'dispose'));
            served.push({ file: fileNameOf(url), spies });
            return gltf;
        });
        const assets = await loadSakuraAssets({ loader, textureLoader: null });
        expect(served).toHaveLength(TREE_NAMES.length + 4);
        for (const { file, spies } of served) {
            expect(spies.length, file).toBeGreaterThan(0);
            if (file === fileNameOf(SAKURA_FOX_URL)) {
                // The garden draws the fox with the model's own texture, so nothing of it may go yet.
                spies.forEach((spy) => expect(spy, file).not.toHaveBeenCalled());
            } else {
                // The garden shades everything else itself: the stand-in materials are not kept.
                spies.forEach((spy) => expect(spy, file).toHaveBeenCalled());
            }
        }
        const fox = served.find((entry) => entry.file === fileNameOf(SAKURA_FOX_URL));
        disposeSakuraAssets(assets);
        fox.spies.forEach((spy) => expect(spy).toHaveBeenCalled());
    });

    it('loads a chosen subset of trees, each once, and can skip the sprite sheet', async () => {
        const loader = diskLoader();
        const assets = await loadSakuraAssets({
            trees: ['sakura-grove-a', 'sakura-grove-weeping', 'sakura-grove-a'], loader, textureLoader: null,
        });
        expect(Object.keys(assets.trees)).toEqual(['sakura-grove-a', 'sakura-grove-weeping']);
        expect(loader.loadAsync).toHaveBeenCalledTimes(6);
        const always = [...PACK_URLS, SAKURA_FOX_URL].map(fileNameOf);
        expect(loader.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual([...always, 'sakura-grove-a.glb', 'sakura-grove-weeping.glb'].sort());
        expect(assets.impostors).toBeNull();
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(assets.fuji.geometry.isBufferGeometry).toBe(true);
        disposeSakuraAssets(assets);
        // No trees at all is still a garden's worth of packs.
        const bare = await loadSakuraAssets({ trees: [], loader: diskLoader(), textureLoader: null });
        expect(bare.trees).toEqual({});
        expect(Object.keys(bare.blossoms.meshes).length).toBeGreaterThan(0);
        disposeSakuraAssets(bare);
    });

    it('rejects an unknown tree name and a failed download of anything the garden needs', async () => {
        await expect(loadSakuraAssets({
            trees: ['sakura-hero-weeping', 'pine'], loader: diskLoader(), textureLoader: stubTextureLoader(),
        })).rejects.toThrow('[Sakura] Unknown tree asset "pine".');
        await Promise.all(['sakura-hero-spreading.glb', ...PACK_URLS.map(fileNameOf)].map(async (missing) => {
            const flaky = diskLoader();
            const parse = flaky.loadAsync.getMockImplementation();
            flaky.loadAsync.mockImplementation(async (url) => {
                if (fileNameOf(url) === missing) throw new Error(`404 ${missing}`);
                return parse(url);
            });
            await expect(loadSakuraAssets({ loader: flaky, textureLoader: stubTextureLoader() }), missing)
                .rejects.toThrow(`404 ${missing}`);
        }));
        const noSheet = stubTextureLoader();
        noSheet.loadAsync.mockRejectedValue(new Error('404 sprites'));
        await expect(loadSakuraAssets({ loader: diskLoader(), textureLoader: noSheet })).rejects.toThrow('404 sprites');
    });

    it('rejects a mountain written for another schema', async () => {
        const loader = diskLoader();
        const parse = loader.loadAsync.getMockImplementation();
        loader.loadAsync.mockImplementation(async (url) => {
            const gltf = await parse(url);
            if (url === SAKURA_FUJI_URL) gltf.scene.userData.schemaVersion = SAKURA_ASSET_SCHEMA + 1;
            return gltf;
        });
        const other = SAKURA_ASSET_SCHEMA + 1;
        await expect(loadSakuraAssets({ loader, textureLoader: null }))
            .rejects.toThrow(`[Sakura] The mountain has asset schema ${other}; expected ${SAKURA_ASSET_SCHEMA}.`);
    });

    // The garden is whole without its foxes: a failed download only leaves them out.
    it('builds the bundle without the fox when its download fails', async () => {
        const loader = diskLoader();
        const parse = loader.loadAsync.getMockImplementation();
        loader.loadAsync.mockImplementation(async (url) => {
            if (url === SAKURA_FOX_URL) throw new Error('404 sakura-fox.glb');
            return parse(url);
        });
        const textureLoader = stubTextureLoader();
        const assets = await loadSakuraAssets({ loader, textureLoader });
        expect(assets.fox).toBeNull();
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        expect(assets.impostors.texture).toBe(textureLoader.textures[0]);
        expect(() => disposeSakuraAssets(assets)).not.toThrow();
        // A file that parses to nothing usable is treated the same way.
        const empty = diskLoader();
        const parseEmpty = empty.loadAsync.getMockImplementation();
        empty.loadAsync.mockImplementation(async (url) => (url === SAKURA_FOX_URL ? {} : parseEmpty(url)));
        const without = await loadSakuraAssets({ loader: empty, textureLoader: null });
        expect(without.fox).toBeNull();
        disposeSakuraAssets(without);
    });

    it('releases each geometry, the sprite sheet and the fox exactly once', async () => {
        const textureLoader = stubTextureLoader();
        const assets = await loadSakuraAssets({ loader: diskLoader(), textureLoader });
        const geometries = everyGeometry(assets);
        expect(new Set(geometries).size)
            .toBe(Object.keys(parsed.blossoms.meshes).length + REQUIRED_PROPS.length + TREE_NAMES.length + 1);
        const foxParts = [];
        assets.fox.scene.traverse((object) => {
            if (object.geometry) foxParts.push(object.geometry, object.material, object.material.map);
        });
        expect(foxParts.length).toBeGreaterThanOrEqual(3);
        expect(foxParts.every(Boolean)).toBe(true);
        const disposals = [...geometries, assets.impostors.texture, ...new Set(foxParts)]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        disposeSakuraAssets(assets);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('tolerates missing and partial bundles', () => {
        const part = () => ({ dispose: vi.fn() });
        const bark = part();
        const petal = part();
        const torii = part();
        const mountain = part();
        const texture = part();
        const fur = { map: part(), dispose: vi.fn() };
        const skin = { geometry: part(), material: [fur, null] };
        for (const assets of [null, undefined, false, 0, {},
            {
                blossoms: null, props: null, trees: null, fuji: null, impostors: null, fox: null,
            },
            { blossoms: {} }, { props: { meshes: {} } }, { trees: {} }, { trees: { sapling: {} } },
            { trees: { sapling: { bark: null } } }, { fuji: {} }, { impostors: {} }, { impostors: { texture: null } },
            { fox: {} }, { fox: { scene: null } }, { fox: { scene: { traverse: (visit) => visit({}) } } }]) {
            expect(() => disposeSakuraAssets(assets)).not.toThrow();
        }
        disposeSakuraAssets({ trees: { sapling: { bark } } });
        disposeSakuraAssets({ blossoms: { meshes: { petal } } });
        disposeSakuraAssets({ props: { meshes: { torii } } });
        disposeSakuraAssets({ fuji: { geometry: mountain } });
        disposeSakuraAssets({ impostors: { texture } });
        disposeSakuraAssets({ fox: { scene: { traverse: (visit) => visit(skin) } } });
        for (const resource of [bark, petal, torii, mountain, texture, skin.geometry, fur.map]) {
            expect(resource.dispose).toHaveBeenCalledOnce();
        }
        expect(fur.dispose).toHaveBeenCalledOnce();
    });
});
