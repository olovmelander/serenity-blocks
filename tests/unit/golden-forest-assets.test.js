import { createHash } from 'node:crypto';
import {
    existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    GOLDEN_FOREST_ASSET_SCHEMA, GOLDEN_FOREST_FOLIAGE_URL, GOLDEN_FOREST_IMPOSTOR_URL, GOLDEN_FOREST_PROPS_URL,
    GOLDEN_FOREST_TREE_URLS, disposeGoldenForestAssets, goldenForestImpostorLayout, loadGoldenForestAssets,
    parseGoldenForestMeshes, parseGoldenForestTree, prepareGoldenForestImpostors,
} from '../../src/themes/golden-forest/golden-forest-assets.js';
import {
    GOLDEN_FOREST_FEATURE_TREES, layoutGoldenForestGrove,
} from '../../src/themes/golden-forest/golden-forest-composition.js';

const assetDirectory = new URL('../../src/themes/golden-forest/assets/', import.meta.url);
const MB = 1000 * 1000;
const TREE_NAMES = Object.keys(GOLDEN_FOREST_TREE_URLS);
const SPECIES = ['spruce', 'pine'];
// Every spray the trees ask the foliage pack for: two variants of each kind.
const REQUIRED_FOLIAGE = ['spruce_frond_0', 'spruce_frond_1', 'spruce_bough_0', 'spruce_bough_1', 'pine_tuft_0',
    'pine_tuft_1', 'pine_clump_0', 'pine_clump_1'];
// Everything GoldenForestShore looks up by name.
const REQUIRED_PROPS = ['rowboat', 'jetty', 'boulder_a', 'boulder_b', 'boulder_c', 'snag'];
const FOLIAGE_FILE = 'golden-forest-foliage.glb';
const PROPS_FILE = 'golden-forest-props.glb';
const IMPOSTOR_FILE = 'golden-forest-impostors.png';

// Ceilings roughly 40% above what the Blender generator wrote on 2026-10-05 (noted beside
// each), so the pack cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({
    packBytes: 4 * MB, // 2.93 MB for the whole directory
    glbBytes: 1.02 * MB, // spruce-hero.glb, 0.73 MB
    impostorBytes: 0.9 * MB, // 0.64 MB
    barkTriangles: { hero: 46000, grove: 7500 }, // 32,844 and 5,384
    sites: { hero: 1500, grove: 470 }, // 1,090 and 333
    sprayTriangles: 280, // 200
    propTriangles: 3200, // 2,280
});

function fileNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

function readAsset(file) {
    return readFileSync(new URL(file, assetDirectory));
}

function readManifest() {
    return JSON.parse(readAsset('asset-manifest.json').toString('utf8'));
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
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

function extent(array, stride, offset, scale = 1) {
    let min = Infinity;
    let max = -Infinity;
    for (let index = offset; index < array.length; index += stride) {
        min = Math.min(min, array[index] * scale);
        max = Math.max(max, array[index] * scale);
    }
    return [min, max];
}

/** Smallest and largest vector length in a packed array of `width`-component vectors. */
function lengths(array, width) {
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < array.length; index += width) {
        let sum = 0;
        for (let component = 0; component < width; component++) sum += array[index + component] ** 2;
        min = Math.min(min, Math.sqrt(sum));
        max = Math.max(max, Math.sqrt(sum));
    }
    return [min, max];
}

function attributeLengths(attribute) {
    const vector = new THREE.Vector3();
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < attribute.count; index++) {
        const length = vector.fromBufferAttribute(attribute, index).length();
        min = Math.min(min, length);
        max = Math.max(max, length);
    }
    return [min, max];
}

/** Smallest and largest component anywhere in a (possibly normalised integer) attribute. */
function attributeRange(attribute) {
    const getters = ['getX', 'getY', 'getZ', 'getW'].slice(0, attribute.itemSize);
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < attribute.count; index++) {
        for (const getter of getters) {
            min = Math.min(min, attribute[getter](index));
            max = Math.max(max, attribute[getter](index));
        }
    }
    return [min, max];
}

function triangles(geometry) {
    return geometry.index.count / 3;
}

/** The checks every drawable mesh of the pack must pass, whatever it depicts. */
function expectWellFormedMesh(geometry, name) {
    expect(geometry.isBufferGeometry).toBe(true);
    expect(geometry.name).toBe(name);
    expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
    const { position } = geometry.attributes;
    // Positions are decoded to metres; the compact encodings of the rest are kept.
    expect(position.array).toBeInstanceOf(Float32Array);
    expect(position.itemSize).toBe(3);
    expect(position.normalized).toBe(false);
    expect(position.count).toBeGreaterThan(2);
    expect(finite(position.array)).toBe(true);
    for (const key of ['normal', 'uv', 'color']) expect(geometry.attributes[key].count, key).toBe(position.count);
    expect(geometry.index).not.toBeNull();
    expect(geometry.index.count % 3).toBe(0);
    expect(geometry.index.count).toBeGreaterThan(0);
    const [lowest, highest] = extent(geometry.index.array, 1, 0);
    expect(lowest).toBe(0);
    expect(highest).toBe(position.count - 1);
    const normals = attributeLengths(geometry.attributes.normal);
    expect(normals[0]).toBeGreaterThan(0.97);
    expect(normals[1]).toBeLessThan(1.03);
    expect(geometry.attributes.uv.itemSize).toBe(2);
    expect(attributeRange(geometry.attributes.uv).every(Number.isFinite)).toBe(true);
    // Vertex paint is four fractions the materials read as masks.
    expect(geometry.attributes.color.itemSize).toBe(4);
    const [darkest, lightest] = attributeRange(geometry.attributes.color);
    expect(darkest).toBeGreaterThanOrEqual(0);
    expect(lightest).toBeLessThanOrEqual(1);
    const box = geometry.boundingBox;
    expect(box.isBox3).toBe(true);
    expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true);
    expect(geometry.boundingSphere.radius).toBeGreaterThan(0);
}

/** A loader that serves the real files from disk instead of fetching them. */
function diskLoader() {
    return { loadAsync: vi.fn(async (url) => parseGlb(fileNameOf(url))) };
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

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const parsed = { trees: {}, foliage: null, props: null };

beforeAll(async () => {
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseGoldenForestTree(gltfs[index], name); });
    parsed.foliage = parseGoldenForestMeshes(await parseGlb(FOLIAGE_FILE), 'Foliage');
    parsed.props = parseGoldenForestMeshes(await parseGlb(PROPS_FILE), 'Props');
}, 60000);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Golden Forest source files', () => {
    const sourceDirectory = new URL('../../src/themes/golden-forest/', import.meta.url);

    function scripts(directory = sourceDirectory, prefix = '') {
        return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            if (entry.isDirectory()) return scripts(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
            return entry.name.endsWith('.js') ? [`${prefix}${entry.name}`] : [];
        });
    }

    it('are strict UTF-8 with Unix line endings', () => {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        // The decoder really is strict: a lone Windows-1252 dash (0x97) is not UTF-8.
        expect(() => decoder.decode(Uint8Array.of(0x20, 0x97, 0x20))).toThrow();
        const files = scripts();
        expect(files.length).toBeGreaterThanOrEqual(22);
        expect(files).toContain('golden-forest-theme.js');
        expect(files).toContain('golden-forest-ripples.js');
        for (const file of files) {
            const bytes = readFileSync(new URL(file, sourceDirectory));
            let text = null;
            expect(() => { text = decoder.decode(bytes); }, `${file} is not valid UTF-8`).not.toThrow();
            expect(text.includes('\r'), `${file} has a carriage return`).toBe(false);
            expect(text.includes('\uFFFD'), `${file} has a replacement character`).toBe(false);
            // No byte-order mark either: the files start with their header comment or an import.
            expect([bytes[0], bytes[1], bytes[2]], file).not.toEqual([0xef, 0xbb, 0xbf]);
        }
    });
});

describe('Golden Forest asset pack on disk', () => {
    it('points every URL at a file that exists in the asset directory', () => {
        expect(Object.isFrozen(GOLDEN_FOREST_TREE_URLS)).toBe(true);
        expect(TREE_NAMES).toHaveLength(8);
        const referenced = [];
        for (const [name, url] of Object.entries(GOLDEN_FOREST_TREE_URLS)) {
            expect(fileNameOf(url)).toBe(`${name}.glb`);
            referenced.push(fileNameOf(url));
        }
        expect(fileNameOf(GOLDEN_FOREST_FOLIAGE_URL)).toBe(FOLIAGE_FILE);
        expect(fileNameOf(GOLDEN_FOREST_PROPS_URL)).toBe(PROPS_FILE);
        expect(fileNameOf(GOLDEN_FOREST_IMPOSTOR_URL)).toBe(IMPOSTOR_FILE);
        referenced.push(FOLIAGE_FILE, PROPS_FILE, IMPOSTOR_FILE);
        const directory = fileURLToPath(assetDirectory);
        for (const url of [...Object.values(GOLDEN_FOREST_TREE_URLS), GOLDEN_FOREST_FOLIAGE_URL,
            GOLDEN_FOREST_PROPS_URL, GOLDEN_FOREST_IMPOSTOR_URL]) {
            const file = fileNameOf(url);
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(statSync(new URL(file, assetDirectory)).size).toBeGreaterThan(0);
            // Under Vitest the URLs are file URLs; they must land in the pack, not beside it.
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(file, assetDirectory)));
                expect(fileURLToPath(url).startsWith(directory)).toBe(true);
            }
        }
        // Nothing ships that the runtime does not load, and nothing is loaded twice.
        const shipped = readdirSync(assetDirectory)
            .filter((file) => /\.(glb|png|jpe?g|webp|ktx2|bin)$/i.test(file)).sort();
        expect(shipped).toEqual([...referenced].sort());
        expect(new Set(referenced).size).toBe(referenced.length);
        expect(readAsset(IMPOSTOR_FILE).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('knows every tree the composition places, and plants every tree it ships', () => {
        const placed = new Set(GOLDEN_FOREST_FEATURE_TREES.map((tree) => tree.asset));
        layoutGoldenForestGrove(seededRandom()).forEach((tree) => placed.add(tree.asset));
        expect(placed.size).toBeGreaterThan(4);
        for (const asset of placed) expect(TREE_NAMES).toContain(asset);
        for (const name of TREE_NAMES) expect([...placed]).toContain(name);
        // The two framing trees are placed by hand, never scattered.
        const scattered = new Set(layoutGoldenForestGrove(seededRandom()).map((tree) => tree.asset));
        for (const name of TREE_NAMES.filter((tree) => parsed.trees[tree].role === 'hero')) {
            expect(scattered.has(name), name).toBe(false);
            expect(GOLDEN_FOREST_FEATURE_TREES.filter((tree) => tree.asset === name)).toHaveLength(1);
        }
    });

    it('keeps the whole pack under four megabytes', () => {
        const files = readdirSync(assetDirectory);
        const total = files.reduce((sum, file) => sum + statSync(new URL(file, assetDirectory)).size, 0);
        expect(total).toBeLessThan(BUDGET.packBytes);
        // The download itself: every binary the theme fetches.
        const fetched = files.filter((file) => /\.(glb|png)$/.test(file));
        expect(fetched).toHaveLength(11);
        expect(fetched.reduce((sum, file) => sum + statSync(new URL(file, assetDirectory)).size, 0))
            .toBeLessThan(BUDGET.packBytes);
        for (const file of files.filter((entry) => entry.endsWith('.glb'))) {
            expect(statSync(new URL(file, assetDirectory)).size, file).toBeLessThanOrEqual(BUDGET.glbBytes);
        }
        expect(statSync(new URL(IMPOSTOR_FILE, assetDirectory)).size).toBeLessThanOrEqual(BUDGET.impostorBytes);
        // The manifest's own arithmetic agrees.
        expect(readManifest().assets.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThan(BUDGET.packBytes);
    });

    it('matches every manifest entry byte for byte', () => {
        const manifest = readManifest();
        expect(manifest.schemaVersion).toBe(GOLDEN_FOREST_ASSET_SCHEMA);
        expect(GOLDEN_FOREST_ASSET_SCHEMA).toBe(1);
        expect(Array.isArray(manifest.assets)).toBe(true);
        expect(manifest.assets.length).toBeGreaterThan(0);
        // Portable: no absolute paths from the machine that ran Blender.
        expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//i);
        const seen = new Set();
        for (const entry of manifest.assets) {
            expect(entry.file).not.toMatch(/[\\/]/);
            expect(seen.has(entry.file), `${entry.file} listed twice`).toBe(false);
            seen.add(entry.file);
            expect(existsSync(new URL(entry.file, assetDirectory)), entry.file).toBe(true);
            const bytes = readAsset(entry.file);
            expect(Number.isInteger(entry.bytes) && entry.bytes > 0, entry.file).toBe(true);
            expect(bytes.length, entry.file).toBe(entry.bytes);
            expect(entry.sha256, entry.file).toMatch(/^[0-9a-f]{64}$/);
            expect(createHash('sha256').update(bytes).digest('hex'), entry.file).toBe(entry.sha256);
            expect(['tree', 'foliage', 'props', 'impostors']).toContain(entry.kind);
        }
        // Every binary the theme fetches is vouched for, and nothing else is listed.
        const fetched = [...Object.values(GOLDEN_FOREST_TREE_URLS), GOLDEN_FOREST_FOLIAGE_URL, GOLDEN_FOREST_PROPS_URL,
            GOLDEN_FOREST_IMPOSTOR_URL].map(fileNameOf);
        expect([...seen].sort()).toEqual(fetched.sort());
        // The sprite-sheet layout is read from here at runtime.
        expect(manifest.assets.filter((entry) => entry.kind === 'impostors')).toHaveLength(1);
        expect(manifest.assets.find((entry) => entry.kind === 'impostors').file).toBe(IMPOSTOR_FILE);
        expect(manifest.assets.filter((entry) => entry.kind === 'tree')).toHaveLength(TREE_NAMES.length);
    });

    it('describes each tree and both mesh packs the way the files really are', () => {
        const manifest = readManifest();
        for (const entry of manifest.assets) {
            if (entry.kind === 'tree') {
                const tree = parsed.trees[entry.file.replace(/\.glb$/, '')];
                expect(tree, entry.file).toBeDefined();
                expect(entry).toMatchObject({ species: tree.species, role: tree.role });
                expect(entry.sites).toBe(tree.sites.count);
                expect(entry.barkTriangles).toBe(triangles(tree.bark));
            }
            if (entry.kind === 'foliage' || entry.kind === 'props') {
                const pack = parsed[entry.kind];
                expect(Object.keys(entry.meshes).sort()).toEqual(Object.keys(pack.meshes).sort());
                for (const [name, record] of Object.entries(entry.meshes)) {
                    expect(record.triangles, name).toBe(triangles(pack.meshes[name]));
                }
            }
        }
    });
});

describe('Golden Forest tree assets', () => {
    it.each(TREE_NAMES)('%s is a compact, texture-free GLB with a bark mesh and a cloud of foliage sites', (name) => {
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
            // parseGoldenForestTree decodes through translation and scale only.
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
        expect(meta).toMatchObject({ schemaVersion: GOLDEN_FOREST_ASSET_SCHEMA, name });
        expect(SPECIES).toContain(meta.species);
        expect(['hero', 'grove']).toContain(meta.role);
        expect(name.startsWith(`${meta.species}-${meta.role}`)).toBe(true);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        expect(tree).toMatchObject({ name });
        expect(SPECIES).toContain(tree.species);
        expect(['hero', 'grove']).toContain(tree.role);
        // Conifers of a northern lake: fifteen to thirty-odd metres.
        expect(tree.height).toBeGreaterThan(15);
        expect(tree.height).toBeLessThan(40);
        expect(tree.trunkRadius).toBeGreaterThan(0.2);
        expect(tree.trunkRadius).toBeLessThan(tree.height / 20);
        expect(tree.crownBase).toBeGreaterThan(0);
        expect(tree.crownBase).toBeLessThan(tree.height * 0.7);
        // A pine carries its crown high on a bare trunk; a spruce is clothed nearly to the ground.
        if (tree.species === 'pine') expect(tree.crownBase).toBeGreaterThan(tree.height * 0.45);

        const { bark } = tree;
        expectWellFormedMesh(bark, 'bark');
        const { position } = bark.attributes;
        const [minY, maxY] = extent(position.array, 3, 1);
        // The root flare (and the old spruce's surface roots) dip into the soil.
        expect(minY).toBeLessThan(0.05);
        expect(minY).toBeGreaterThan(-2.5);
        // `height` is the design height the crown was grown toward.
        expect(maxY).toBeLessThanOrEqual(tree.height * 1.1);
        expect(maxY).toBeGreaterThan(tree.height * 0.85);
        for (const offset of [0, 2]) {
            const [min, max] = extent(position.array, 3, offset);
            // The trunk stands on the origin.
            expect(min).toBeLessThan(-tree.trunkRadius * 0.5);
            expect(max).toBeGreaterThan(tree.trunkRadius * 0.5);
            expect(max - min).toBeLessThan(tree.height);
        }
        expect(bark.boundingBox.min.y).toBeCloseTo(minY, 5);
        expect(bark.boundingBox.max.y).toBeCloseTo(maxY, 5);
        expect(bark.boundingSphere.radius).toBeGreaterThan(tree.height * 0.3);
        expect(bark.boundingSphere.radius).toBeLessThan(tree.height * 1.5);
        expect(triangles(bark)).toBeLessThanOrEqual(BUDGET.barkTriangles[tree.role]);
        expect(triangles(bark)).toBeGreaterThan(2000);
        // Limbs come last in the index buffer, so a tier can stop drawing at a triangle boundary.
        expect(Number.isInteger(tree.barkCoreIndices)).toBe(true);
        expect(tree.barkCoreIndices % 3).toBe(0);
        expect(tree.barkCoreIndices).toBeGreaterThan(0);
        expect(tree.barkCoreIndices).toBeLessThan(bark.index.count);
        // The core is the trunk: it alone reaches most of the way up the tree.
        let coreTop = -Infinity;
        for (let index = 0; index < tree.barkCoreIndices; index++) {
            coreTop = Math.max(coreTop, position.getY(bark.index.getX(index)));
        }
        expect(coreTop).toBeGreaterThan(tree.height * 0.7);
    });

    it.each(TREE_NAMES)('%s carries well-formed foliage sites inside its crown', (name) => {
        const tree = parsed.trees[name];
        const { sites } = tree;
        expect(sites.count).toBeGreaterThan(50);
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
        expect(sites.variant).toBeInstanceOf(Uint8Array);
        const rotations = lengths(sites.rotation, 4);
        expect(rotations[0]).toBeGreaterThan(0.999);
        expect(rotations[1]).toBeLessThan(1.001);
        const bent = lengths(sites.bent, 3);
        expect(bent[0]).toBeGreaterThan(0.97);
        expect(bent[1]).toBeLessThan(1.03);
        for (const key of ['sky', 'sway', 'phase', 'hue']) {
            const [min, max] = extent(sites[key], 1, 0);
            expect(min, key).toBeGreaterThanOrEqual(0);
            expect(max, key).toBeLessThanOrEqual(1);
            // A real spread of values, not a constant the bake forgot to write.
            expect(max - min, key).toBeGreaterThan(0.2);
        }
        // Sprays are sized in metres: never collapsed, never the size of the tree.
        const [smallest, largest] = extent(sites.scale, 1, 0);
        expect(smallest).toBeGreaterThan(0.3);
        expect(largest).toBeLessThanOrEqual(2.5);
        // They sit on the limbs: never lower than the wood itself (a spruce's lowest boughs droop
        // to the ground and below it), never above the leader, and within reach of the bark.
        const { boundingBox } = tree.bark;
        const [lowest, highest] = extent(sites.position, 3, 1);
        expect(lowest).toBeGreaterThan(boundingBox.min.y - 0.25);
        if (tree.species === 'pine') expect(lowest).toBeGreaterThan(tree.crownBase * 0.8);
        expect(highest).toBeLessThanOrEqual(tree.height * 1.1);
        expect(highest).toBeGreaterThan(tree.height * 0.8);
        for (const [offset, axis] of [[0, 'x'], [2, 'z']]) {
            const [min, max] = extent(sites.position, 3, offset);
            expect(min).toBeGreaterThan(boundingBox.min[axis] - 2);
            expect(max).toBeLessThan(boundingBox.max[axis] + 2);
        }
        // Each site names a spray variant the foliage pack really has.
        const { variants, meshes } = parsed.foliage;
        expect(typeof tree.foliage).toBe('string');
        expect(tree.foliage.startsWith(`${tree.species}_`)).toBe(true);
        for (let variant = 0; variant < variants; variant++) {
            expect(meshes[`${tree.foliage}_${variant}`], `${tree.foliage}_${variant}`).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBeGreaterThan(1);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it('gives the two framing trees finer needles than the trees of the shores', () => {
        const kinds = Object.fromEntries(TREE_NAMES.map((name) => [name, parsed.trees[name].foliage]));
        expect(kinds).toEqual({
            'spruce-hero': 'spruce_frond',
            'pine-hero': 'pine_tuft',
            'spruce-grove-a': 'spruce_bough',
            'spruce-grove-b': 'spruce_bough',
            'spruce-grove-c': 'spruce_bough',
            'spruce-grove-d': 'spruce_bough',
            'pine-grove-a': 'pine_clump',
            'pine-grove-b': 'pine_clump',
        });
        const { meshes } = parsed.foliage;
        expect(triangles(meshes.spruce_frond_0)).toBeGreaterThan(triangles(meshes.spruce_bough_0));
        expect(triangles(meshes.pine_tuft_0)).toBeGreaterThan(triangles(meshes.pine_clump_0));
        // And the heroes are the big, detailed specimens.
        for (const species of SPECIES) {
            const hero = parsed.trees[`${species}-hero`];
            for (const name of TREE_NAMES.filter((tree) => tree.startsWith(`${species}-grove`))) {
                expect(triangles(hero.bark)).toBeGreaterThan(triangles(parsed.trees[name].bark) * 3);
                expect(hero.sites.count).toBeGreaterThan(parsed.trees[name].sites.count);
            }
        }
    });

    it('refuses a tree written for another schema or missing a primitive', async () => {
        const stale = await parseGlb('pine-grove-b.glb');
        stale.scene.userData.schemaVersion = GOLDEN_FOREST_ASSET_SCHEMA + 1;
        const other = GOLDEN_FOREST_ASSET_SCHEMA + 1;
        expect(() => parseGoldenForestTree(stale, 'pine-grove-b')).toThrow(
            `[GoldenForest] Tree "pine-grove-b" has asset schema ${other}; expected ${GOLDEN_FOREST_ASSET_SCHEMA}.`,
        );
        const untagged = await parseGlb('pine-grove-b.glb');
        untagged.scene.userData = {};
        expect(() => parseGoldenForestTree(untagged, 'bare')).toThrow('has asset schema undefined');
        const parts = ['sites', 'bark'];
        const copies = await Promise.all(parts.map(() => parseGlb('pine-grove-b.glb')));
        parts.forEach((missing, index) => {
            const broken = copies[index];
            broken.scene.remove(broken.scene.children.find((entry) => entry.name === missing));
            expect(() => parseGoldenForestTree(broken, 'broken'))
                .toThrow(`[GoldenForest] Asset is missing its "${missing}" primitive.`);
        });
        // The file names its own tree; the argument is only a fallback and a label for errors.
        const renamed = await parseGlb('pine-grove-b.glb');
        expect(parseGoldenForestTree(renamed, 'whatever').name).toBe('pine-grove-b');
        const anonymous = await parseGlb('pine-grove-b.glb');
        delete anonymous.scene.userData.name;
        expect(parseGoldenForestTree(anonymous, 'fallback').name).toBe('fallback');
    });
});

describe('Golden Forest foliage and props packs', () => {
    it.each([[FOLIAGE_FILE], [PROPS_FILE]])('%s is a compact, texture-free GLB', (file) => {
        const { json } = readGlb(file);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(GOLDEN_FOREST_ASSET_SCHEMA);
        for (const node of json.nodes) {
            // parseGoldenForestMeshes decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            expect(json.meshes[node.mesh].primitives[0].mode ?? 4).toBe(4);
        }
        expect(new Set(json.nodes.map((node) => node.name)).size).toBe(json.nodes.length);
    });

    it('has every spray the trees reference, and none that no tree wears', () => {
        const { variants, meshes } = parsed.foliage;
        expect(variants).toBe(2);
        for (const name of REQUIRED_FOLIAGE) expect(meshes[name], name).toBeDefined();
        const referenced = new Set();
        for (const tree of Object.values(parsed.trees)) {
            // Exactly as GoldenForestForest builds its bucket keys.
            for (const variant of tree.sites.variant) referenced.add(`${tree.foliage}_${variant % variants}`);
        }
        expect([...referenced].sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
    });

    it.each(REQUIRED_FOLIAGE)('%s is a small, complete spray growing from its attachment point', (name) => {
        const geometry = parsed.foliage.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(20);
        expect(triangles(geometry)).toBeLessThanOrEqual(BUDGET.sprayTriangles);
        // Authored at about unit size; instances scale them into place.
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.6);
        expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.5);
        // Sprays grow from the limb along +Y.
        expect(geometry.boundingBox.min.y).toBeGreaterThan(-0.2);
        expect(geometry.boundingBox.min.y).toBeLessThan(0.3);
        expect(geometry.boundingBox.max.y).toBeGreaterThan(0.8);
        const [low, high] = attributeRange(geometry.attributes.uv);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        // Needle (1) against wood (0) is painted into alpha: every spray has needles.
        const { color } = geometry.attributes;
        let needles = 0;
        for (let index = 0; index < color.count; index++) if (color.getW(index) > 0.5) needles += 1;
        expect(needles).toBeGreaterThan(color.count * 0.3);
    });

    it('has every prop the shore places, and nothing else', () => {
        const { meshes } = parsed.props;
        for (const name of REQUIRED_PROPS) expect(meshes[name], name).toBeDefined();
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
    });

    it.each(REQUIRED_PROPS)('%s is a complete, finite mesh inside its triangle budget', (name) => {
        const geometry = parsed.props.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(300);
        expect(triangles(geometry)).toBeLessThanOrEqual(BUDGET.propTriangles);
    });

    it('models the props at the sizes and origins the shore places them by', () => {
        const box = (name) => parsed.props.meshes[name].boundingBox;
        const size = (name) => box(name).getSize(new THREE.Vector3());
        // A rowboat four and a half metres long, floating on its origin: hull under, gunwale over.
        const boat = size('rowboat');
        expect(boat.z).toBeGreaterThan(3.5);
        expect(boat.z).toBeLessThan(5.5);
        expect(boat.x).toBeGreaterThan(1.2);
        expect(boat.x).toBeLessThan(2);
        expect(Math.abs(box('rowboat').getCenter(new THREE.Vector3()).x)).toBeLessThan(0.1);
        expect(Math.abs(box('rowboat').getCenter(new THREE.Vector3()).z)).toBeLessThan(0.1);
        expect(box('rowboat').min.y).toBeLessThan(-0.05);
        expect(box('rowboat').min.y).toBeGreaterThan(-0.5);
        expect(box('rowboat').max.y).toBeGreaterThan(0.3);
        // The jetty starts at its origin and runs out along -Z, deck above the water, piles below.
        expect(box('jetty').max.z).toBeCloseTo(0, 1);
        expect(box('jetty').min.z).toBeLessThan(-6);
        expect(size('jetty').x).toBeLessThan(2.5);
        expect(box('jetty').max.y).toBeGreaterThan(0.3);
        expect(box('jetty').min.y).toBeLessThan(-1);
        // Boulders of a metre or two, bedded a little into the ground they are set on.
        for (const name of ['boulder_a', 'boulder_b', 'boulder_c']) {
            expect(Math.max(size(name).x, size(name).z)).toBeGreaterThan(2);
            expect(Math.max(size(name).x, size(name).z)).toBeLessThan(5);
            expect(box(name).min.y).toBeLessThan(-0.2);
            expect(box(name).max.y).toBeGreaterThan(0.6);
            expect(box(name).containsPoint(new THREE.Vector3(0, 0.1, 0))).toBe(true);
        }
        const outlines = ['boulder_a', 'boulder_b', 'boulder_c'].map((name) => size(name).toArray().join());
        expect(new Set(outlines).size).toBe(3);
        // The dead pine stands on its origin, taller than a house.
        expect(box('snag').max.y).toBeGreaterThan(10);
        expect(box('snag').min.y).toBeGreaterThan(-1);
        expect(box('snag').min.y).toBeLessThan(0);
        expect(box('snag').containsPoint(new THREE.Vector3(0, 1, 0))).toBe(true);
    });

    it('refuses a pack written for another schema, naming which pack it was', async () => {
        const stale = await parseGlb(FOLIAGE_FILE);
        stale.scene.userData.schemaVersion = 0;
        expect(() => parseGoldenForestMeshes(stale, 'Foliage'))
            .toThrow(`[GoldenForest] Foliage has asset schema 0; expected ${GOLDEN_FOREST_ASSET_SCHEMA}.`);
        expect(() => parseGoldenForestMeshes(stale, 'Props'))
            .toThrow(`[GoldenForest] Props has asset schema 0; expected ${GOLDEN_FOREST_ASSET_SCHEMA}.`);
        stale.scene.userData = undefined;
        expect(() => parseGoldenForestMeshes(stale, 'Foliage')).toThrow('Foliage has asset schema undefined');
        // Children without geometry (an empty, a light) are skipped rather than keyed.
        const mixed = await parseGlb(PROPS_FILE);
        const empty = new THREE.Object3D();
        empty.name = 'locator';
        mixed.scene.add(empty);
        expect(Object.keys(parseGoldenForestMeshes(mixed, 'Props').meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
    });
});

describe('Golden Forest far-shore sprite sheet', () => {
    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const layout = goldenForestImpostorLayout();
        expect(Object.keys(layout).sort()).toEqual(['atlasHeight', 'atlasWidth', 'tiles']);
        const png = readAsset(IMPOSTOR_FILE);
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(layout.atlasWidth);
        expect(png.readUInt32BE(20)).toBe(layout.atlasHeight);
        // Shade, needle mask, hue seed and coverage: four 8-bit channels.
        expect([png[24], png[25]]).toEqual([8, 6]);
        expect(layout.tiles.length).toBeGreaterThan(0);
        const ordered = [...layout.tiles].sort((a, b) => a.x - b.x);
        let cursor = 0;
        for (const tile of ordered) {
            expect(Number.isInteger(tile.x)).toBe(true);
            expect(Number.isInteger(tile.pixels)).toBe(true);
            expect(tile.pixels).toBeGreaterThan(0);
            // Inside the atlas, and not on top of the tile before it.
            expect(tile.x).toBeGreaterThanOrEqual(cursor);
            expect(tile.x + tile.pixels).toBeLessThanOrEqual(layout.atlasWidth);
            cursor = tile.x + tile.pixels;
        }
        expect(cursor).toBeLessThanOrEqual(layout.atlasWidth);
        // The sheet is not mostly empty: the tiles cover nearly all of it.
        expect(ordered.reduce((sum, tile) => sum + tile.pixels, 0)).toBeGreaterThan(layout.atlasWidth * 0.9);
        // The layout is the manifest's own record.
        const record = readManifest().assets.find((entry) => entry.kind === 'impostors');
        expect(layout).toEqual({ atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles });
    });

    it('describes each tile as one of the grove trees, at its true proportions', () => {
        const layout = goldenForestImpostorLayout();
        for (const tile of layout.tiles) {
            const tree = parsed.trees[tile.asset];
            expect(tree, tile.asset).toBeDefined();
            expect(tree.role).toBe('grove');
            expect(tile.species).toBe(tree.species);
            // Metres on the card match pixels on the sheet, so no sprite is stretched.
            expect(tile.width / tile.height).toBeCloseTo(tile.pixels / layout.atlasHeight, 3);
            expect(tile.height).toBeGreaterThan(tree.height * 0.9);
            expect(tile.height).toBeLessThan(tree.height * 1.3);
            // Where the trunk stands, as a fraction of the tile width from its centre.
            expect(Math.abs(tile.trunk)).toBeLessThan(0.5);
            expect(tile.coverage).toBeGreaterThan(0.1);
            expect(tile.coverage).toBeLessThanOrEqual(1);
        }
        // Every grove tree has a far silhouette, each once, in both species.
        expect(layout.tiles.map((tile) => tile.asset).sort())
            .toEqual(TREE_NAMES.filter((name) => parsed.trees[name].role === 'grove').sort());
        expect(new Set(layout.tiles.map((tile) => tile.species))).toEqual(new Set(SPECIES));
    });

    it('prepares the sheet as linear, clamped, mip-mapped data', () => {
        const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareGoldenForestImpostors(texture)).toBe(texture);
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.anisotropy).toBe(4);
        expect(texture.name).toBe('GoldenForestFarShoreSprites');
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });
});

describe('loading and releasing the Golden Forest assets', () => {
    const packGeometries = (assets) => [...Object.values(assets.foliage.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark)];

    it('loads every file once and returns the parsed bundle', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const isCurrent = vi.fn(() => true);
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadGoldenForestAssets({ loader, textureLoader, isCurrent });
        const requested = loader.loadAsync.mock.calls.map(([url]) => url);
        expect([...requested].sort()).toEqual([GOLDEN_FOREST_FOLIAGE_URL, GOLDEN_FOREST_PROPS_URL,
            ...Object.values(GOLDEN_FOREST_TREE_URLS)].sort());
        expect(textureLoader.loadAsync).toHaveBeenCalledExactlyOnceWith(GOLDEN_FOREST_IMPOSTOR_URL);
        // Ownership is checked once, after everything has arrived.
        expect(isCurrent).toHaveBeenCalledOnce();
        expect(isCurrent.mock.invocationCallOrder[0])
            .toBeGreaterThan(Math.max(...loader.loadAsync.mock.invocationCallOrder));

        expect(Object.keys(assets).sort()).toEqual(['foliage', 'impostors', 'props', 'trees']);
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        for (const name of TREE_NAMES) {
            expect(assets.trees[name].name).toBe(name);
            expect(assets.trees[name].sites.count).toBe(parsed.trees[name].sites.count);
            expect(triangles(assets.trees[name].bark)).toBe(triangles(parsed.trees[name].bark));
        }
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(assets.foliage.variants).toBe(parsed.foliage.variants);
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(assets.impostors).toEqual({ ...goldenForestImpostorLayout(), texture: textureLoader.textures[0] });
        expect(assets.impostors.texture.name).toBe('GoldenForestFarShoreSprites');
        expect(assets.impostors.texture.colorSpace).toBe(THREE.NoColorSpace);
        // A bundle that is handed over is intact.
        expect(disposal).not.toHaveBeenCalled();
        expect(textureLoader.disposed).toEqual([]);
        disposeGoldenForestAssets(assets);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('lets go of the materials the loader made for meshes it only wanted the geometry of', async () => {
        const materials = new Map();
        const loader = {
            loadAsync: vi.fn(async (url) => {
                const gltf = await parseGlb(fileNameOf(url));
                gltf.scene.traverse((object) => {
                    // The loader shares one default material between the meshes of a file.
                    if (object.material && !materials.has(object.material)) {
                        materials.set(object.material, vi.spyOn(object.material, 'dispose'));
                    }
                });
                return gltf;
            }),
        };
        const assets = await loadGoldenForestAssets({ loader, textureLoader: null });
        // One for the sprays, one for the props, and a mesh and a points material for each tree.
        expect(materials.size).toBe(1 + 1 + TREE_NAMES.length * 2);
        for (const disposal of materials.values()) expect(disposal).toHaveBeenCalled();
        // The geometry the forest adopted is not the loader's to throw away.
        const adopted = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        expect(packGeometries(assets).every((geometry) => geometry.attributes.position.count > 0)).toBe(true);
        expect(adopted).not.toHaveBeenCalled();
        disposeGoldenForestAssets(assets);
        expect(adopted).toHaveBeenCalledTimes(REQUIRED_FOLIAGE.length + REQUIRED_PROPS.length + TREE_NAMES.length);
    });

    it('disposes everything and returns null when the start that asked is no longer current', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadGoldenForestAssets({ loader, textureLoader, isCurrent: () => false });
        expect(assets).toBeNull();
        expect(loader.loadAsync).toHaveBeenCalledTimes(TREE_NAMES.length + 2);
        const released = disposal.mock.contexts.map((geometry) => geometry.name).sort();
        expect(released).toEqual([...REQUIRED_FOLIAGE, ...REQUIRED_PROPS, ...TREE_NAMES.map(() => 'bark')].sort());
        expect(new Set(disposal.mock.contexts).size).toBe(released.length);
        expect(textureLoader.textures).toHaveLength(1);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('loads a chosen subset of trees, each once, and can skip the sprite sheet', async () => {
        const loader = diskLoader();
        const assets = await loadGoldenForestAssets({
            trees: ['spruce-grove-a', 'pine-grove-b', 'spruce-grove-a'], loader, textureLoader: null,
        });
        expect(Object.keys(assets.trees)).toEqual(['spruce-grove-a', 'pine-grove-b']);
        expect(loader.loadAsync).toHaveBeenCalledTimes(4);
        expect(loader.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual([FOLIAGE_FILE, PROPS_FILE, 'pine-grove-b.glb', 'spruce-grove-a.glb']);
        expect(assets.impostors).toBeNull();
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        disposeGoldenForestAssets(assets);
    });

    it('rejects an unknown tree name and a failed download', async () => {
        await expect(loadGoldenForestAssets({
            trees: ['spruce-hero', 'maple'], loader: diskLoader(), textureLoader: stubTextureLoader(),
        })).rejects.toThrow('[GoldenForest] Unknown tree asset "maple".');
        const flaky = diskLoader();
        flaky.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === 'pine-hero.glb') throw new Error('404 pine-hero.glb');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadGoldenForestAssets({ loader: flaky, textureLoader: stubTextureLoader() }))
            .rejects.toThrow('404 pine-hero.glb');
        const noProps = diskLoader();
        noProps.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === PROPS_FILE) throw new Error('404 props');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadGoldenForestAssets({ loader: noProps, textureLoader: null })).rejects.toThrow('404 props');
        const noSheet = stubTextureLoader();
        noSheet.loadAsync.mockRejectedValue(new Error('404 sprites'));
        await expect(loadGoldenForestAssets({ loader: diskLoader(), textureLoader: noSheet }))
            .rejects.toThrow('404 sprites');
    });

    it('releases each geometry and the sprite sheet exactly once', async () => {
        const textureLoader = stubTextureLoader();
        const assets = await loadGoldenForestAssets({ loader: diskLoader(), textureLoader });
        const geometries = packGeometries(assets);
        expect(new Set(geometries).size).toBe(REQUIRED_FOLIAGE.length + REQUIRED_PROPS.length + TREE_NAMES.length);
        const disposals = [...geometries, assets.impostors.texture].map((resource) => vi.spyOn(resource, 'dispose'));
        disposeGoldenForestAssets(assets);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('tolerates missing and partial bundles', () => {
        const bark = { dispose: vi.fn() };
        const spray = { dispose: vi.fn() };
        const boat = { dispose: vi.fn() };
        const texture = { dispose: vi.fn() };
        for (const assets of [null, undefined, false, 0, {}, {
            foliage: null, props: null, trees: null, impostors: null,
        }, { foliage: {} }, { foliage: { meshes: {} } }, { props: {} }, { props: { meshes: {} } }, { trees: {} },
        { trees: { sapling: {} } }, { trees: { sapling: { bark: null } } }, { impostors: {} },
        { impostors: { texture: null } }]) {
            expect(() => disposeGoldenForestAssets(assets)).not.toThrow();
        }
        disposeGoldenForestAssets({ trees: { sapling: { bark } } });
        disposeGoldenForestAssets({ foliage: { meshes: { spray } } });
        disposeGoldenForestAssets({ props: { meshes: { boat } } });
        disposeGoldenForestAssets({ impostors: { texture } });
        for (const resource of [bark, spray, boat, texture]) expect(resource.dispose).toHaveBeenCalledOnce();
    });
});
