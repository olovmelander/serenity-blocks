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
    SUMMER_ASSET_SCHEMA, SUMMER_FOLIAGE_URL, SUMMER_IMPOSTOR_URL, SUMMER_PROPS_URL, SUMMER_TREE_URLS,
    disposeSummerAssets, loadSummerAssets, parseSummerMeshes, parseSummerTree, prepareSummerImpostors,
    summerImpostorLayout, summerPropRecord,
} from '../../src/themes/summer/summer-assets.js';
import { SUMMER_FEATURE_TREES, layoutSummerGrove } from '../../src/themes/summer/summer-composition.js';
import { SUMMER_MATERIALS } from '../../src/themes/summer/summer-homestead.js';
import { seededRandom } from '../../src/utils/helpers.js';

const assetDirectory = new URL('../../src/themes/summer/assets/', import.meta.url);
const KB = 1000;
const MB = 1000 * KB;
const TREE_NAMES = Object.keys(SUMMER_TREE_URLS);
const SPECIES = ['birch', 'spruce'];
// The spray each tree wears: the two framing trees the finely modelled ones, the grove the light ones.
const FOLIAGE_OF = Object.freeze({
    'birch-hero': 'birch_spray',
    'spruce-hero': 'spruce_bough',
    'birch-grove-a': 'birch_strand',
    'birch-grove-b': 'birch_strand',
    'birch-grove-c': 'birch_strand',
    'spruce-grove-a': 'spruce_frond',
    'spruce-grove-b': 'spruce_frond',
    'spruce-grove-c': 'spruce_frond',
    'spruce-grove-d': 'spruce_frond',
});
// Every spray the trees ask the foliage pack for: two variants of each kind.
const REQUIRED_FOLIAGE = ['birch_spray_0', 'birch_spray_1', 'birch_strand_0', 'birch_strand_1', 'spruce_bough_0',
    'spruce_bough_1', 'spruce_frond_0', 'spruce_frond_1'];
// Everything SummerHomestead looks up by name.
const REQUIRED_PROPS = ['cottage', 'shed', 'maypole', 'jetty', 'rowboat', 'boulder_a', 'boulder_b', 'boulder_c',
    'fence'];
const FOLIAGE_FILE = 'summer-foliage.glb';
const PROPS_FILE = 'summer-props.glb';
const IMPOSTOR_FILE = 'summer-impostors.png';
// The twelve files of the pack.
const PACK_FILES = [...TREE_NAMES.map((name) => `${name}.glb`), FOLIAGE_FILE, PROPS_FILE, IMPOSTOR_FILE];

// What the pack may weigh (it wrote 3.45 MB, 715 KB for the old birch and 443 KB of props on
// 2026-10-08), so it cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({ packBytes: 4.5 * MB, heroBytes: 900 * KB, propsBytes: 450 * KB });

// What each prop is made of, in the runtime's names for the material codes.
const PROP_MATERIALS = Object.freeze({
    cottage: ['timber', 'red', 'white', 'roof', 'stone', 'glass', 'door', 'garland', 'flowers'],
    shed: ['timber', 'red', 'white', 'roof', 'stone', 'glass', 'door'],
    maypole: ['timber', 'garland', 'flowers'],
    jetty: ['timber'],
    rowboat: ['timber', 'red'],
    boulder_a: ['stone'],
    boulder_b: ['stone'],
    boulder_c: ['stone'],
    fence: ['timber'],
});
// The generator's name for each code (the file's own `materialCodes` table), by the runtime's.
const GENERATOR_NAMES = Object.freeze({
    timber: 'timber',
    red: 'red',
    white: 'white',
    roof: 'tile',
    stone: 'stone',
    glass: 'glass',
    door: 'accent',
    garland: 'leaf',
    flowers: 'flower',
});
// The named points the runtime reads: ribbons and the bouquet, the chimney's smoke, the jetty's end.
const RUNTIME_ANCHORS = Object.freeze({
    maypole: ['top', 'armLeft', 'armRight', 'wreathLeft', 'wreathRight'],
    cottage: ['chimneyTop'],
    jetty: ['end'],
});
// Seven kinds of flowers are picked on Midsummer's Eve; a flower's tone says which it is.
const FLOWER_KINDS = 7;

function fileNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

function readAsset(file) {
    return readFileSync(new URL(file, assetDirectory));
}

function readManifest() {
    return JSON.parse(readAsset('asset-manifest.json').toString('utf8'));
}

function sizeOf(file) {
    return statSync(new URL(file, assetDirectory)).size;
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

/**
 * What a prop's vertices say they are made of, read the way the paint shader reads it:
 * the code is the green channel times eight, rounded. `worst` is how far any vertex is
 * from a whole code; `tones` are the red channel of the vertices of one material.
 */
function paintOf(geometry) {
    const { color } = geometry.attributes;
    const codes = new Map();
    let worst = 0;
    for (let index = 0; index < color.count; index++) {
        const raw = color.getY(index) * 8;
        const code = Math.round(raw);
        worst = Math.max(worst, Math.abs(raw - code));
        if (!codes.has(code)) codes.set(code, []);
        codes.get(code).push(index);
    }
    const tones = (code) => (codes.get(code) || []).map((index) => color.getX(index));
    return { codes, worst, tones };
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

const parsed = { trees: {}, foliage: null, props: null };

beforeAll(async () => {
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseSummerTree(gltfs[index], name); });
    parsed.foliage = parseSummerMeshes(await parseGlb(FOLIAGE_FILE), 'Foliage');
    parsed.props = parseSummerMeshes(await parseGlb(PROPS_FILE), 'Props');
}, 60000);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Summer source files', () => {
    const sourceDirectory = new URL('../../src/themes/summer/', import.meta.url);

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
        expect(files.length).toBeGreaterThanOrEqual(24);
        for (const module of ['summer-theme.js', 'summer-world.js', 'summer-assets.js', 'summer-homestead.js',
            'summer-rings.js']) {
            expect(files).toContain(module);
        }
        for (const file of files) {
            const bytes = readFileSync(new URL(file, sourceDirectory));
            let text = null;
            expect(() => { text = decoder.decode(bytes); }, `${file} is not valid UTF-8`).not.toThrow();
            expect(text.includes('\r'), `${file} has a carriage return`).toBe(false);
            expect(text.includes('�'), `${file} has a replacement character`).toBe(false);
            // No byte-order mark either: the files start with their header comment or an import.
            expect([bytes[0], bytes[1], bytes[2]], file).not.toEqual([0xef, 0xbb, 0xbf]);
        }
    });
});

describe('Summer asset pack on disk', () => {
    it('points every URL at a file that exists in the asset directory, and ships nothing else', () => {
        expect(Object.isFrozen(SUMMER_TREE_URLS)).toBe(true);
        expect(TREE_NAMES).toHaveLength(9);
        expect(TREE_NAMES.filter((name) => name.startsWith('birch-'))).toHaveLength(4);
        expect(TREE_NAMES.filter((name) => name.startsWith('spruce-'))).toHaveLength(5);
        const referenced = [];
        for (const [name, url] of Object.entries(SUMMER_TREE_URLS)) {
            expect(fileNameOf(url)).toBe(`${name}.glb`);
            referenced.push(fileNameOf(url));
        }
        expect(fileNameOf(SUMMER_FOLIAGE_URL)).toBe(FOLIAGE_FILE);
        expect(fileNameOf(SUMMER_PROPS_URL)).toBe(PROPS_FILE);
        expect(fileNameOf(SUMMER_IMPOSTOR_URL)).toBe(IMPOSTOR_FILE);
        referenced.push(FOLIAGE_FILE, PROPS_FILE, IMPOSTOR_FILE);
        expect([...referenced].sort()).toEqual([...PACK_FILES].sort());
        expect(PACK_FILES).toHaveLength(12);
        const directory = fileURLToPath(assetDirectory);
        for (const url of [...Object.values(SUMMER_TREE_URLS), SUMMER_FOLIAGE_URL, SUMMER_PROPS_URL,
            SUMMER_IMPOSTOR_URL]) {
            const file = fileNameOf(url);
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(sizeOf(file)).toBeGreaterThan(0);
            // Under Vitest the URLs are file URLs; they must land in the pack, not beside it.
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(file, assetDirectory)));
                expect(fileURLToPath(url).startsWith(directory)).toBe(true);
            }
        }
        // Nothing ships that the runtime does not load, and nothing is loaded twice: no tree,
        // prop or sprite of the scene this one replaced is left lying in the folder.
        const shipped = readdirSync(assetDirectory)
            .filter((file) => /\.(glb|gltf|png|jpe?g|webp|ktx2|hdr|exr|bin)$/i.test(file)).sort();
        expect(shipped).toEqual([...referenced].sort());
        expect(new Set(referenced).size).toBe(referenced.length);
        // Beside them only the manifest and the attribution.
        expect(readdirSync(assetDirectory).filter((file) => !shipped.includes(file)).sort())
            .toEqual(['ATTRIBUTION.md', 'asset-manifest.json']);
        expect(readAsset(IMPOSTOR_FILE).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('knows every tree the composition places, and plants every tree it ships', () => {
        const grove = layoutSummerGrove(seededRandom(624));
        const placed = new Set([...SUMMER_FEATURE_TREES, ...grove].map((tree) => tree.asset));
        for (const asset of placed) expect(TREE_NAMES).toContain(asset);
        for (const name of TREE_NAMES) expect([...placed]).toContain(name);
        // The two framing trees are placed by hand, never scattered.
        const scattered = new Set(grove.map((tree) => tree.asset));
        const heroes = TREE_NAMES.filter((tree) => parsed.trees[tree].role === 'hero');
        expect(heroes.sort()).toEqual(['birch-hero', 'spruce-hero']);
        for (const name of heroes) {
            expect(scattered.has(name), name).toBe(false);
            expect(SUMMER_FEATURE_TREES.filter((tree) => tree.asset === name)).toHaveLength(1);
        }
    });

    it('keeps the pack under 4.5 MB, each framing tree under 900 KB and the props under 450 KB', () => {
        const files = readdirSync(assetDirectory);
        const total = files.reduce((sum, file) => sum + sizeOf(file), 0);
        expect(total).toBeLessThanOrEqual(BUDGET.packBytes);
        // The download itself: every binary the theme fetches.
        const fetched = files.filter((file) => /\.(glb|png)$/.test(file));
        expect(fetched).toHaveLength(12);
        expect(fetched.reduce((sum, file) => sum + sizeOf(file), 0)).toBeLessThanOrEqual(BUDGET.packBytes);
        for (const name of TREE_NAMES) {
            const { role } = parsed.trees[name];
            if (role === 'hero') expect(sizeOf(`${name}.glb`), name).toBeLessThanOrEqual(BUDGET.heroBytes);
            // A tree of the middle distance is a fraction of a framing tree.
            else expect(sizeOf(`${name}.glb`), name).toBeLessThan(BUDGET.heroBytes / 4);
        }
        expect(sizeOf(PROPS_FILE)).toBeLessThanOrEqual(BUDGET.propsBytes);
        // The manifest's own arithmetic agrees.
        const manifest = readManifest();
        expect(manifest.assets.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(BUDGET.packBytes);
        for (const entry of manifest.assets.filter((asset) => asset.role === 'hero')) {
            expect(entry.bytes, entry.file).toBeLessThanOrEqual(BUDGET.heroBytes);
        }
        expect(manifest.assets.find((entry) => entry.kind === 'props').bytes).toBeLessThanOrEqual(BUDGET.propsBytes);
    });

    // This pins the pack: regenerating it changes these hashes, and committing a new manifest
    // beside the new files is the conscious act that makes this pass again.
    it('matches every manifest entry byte for byte', () => {
        const manifest = readManifest();
        expect(manifest.schemaVersion).toBe(SUMMER_ASSET_SCHEMA);
        expect(SUMMER_ASSET_SCHEMA).toBe(1);
        expect(manifest.glTFUpAxis).toBe('Y');
        expect(Array.isArray(manifest.assets)).toBe(true);
        expect(manifest.assets).toHaveLength(12);
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
        const fetched = [...Object.values(SUMMER_TREE_URLS), SUMMER_FOLIAGE_URL, SUMMER_PROPS_URL,
            SUMMER_IMPOSTOR_URL].map(fileNameOf);
        expect([...seen].sort()).toEqual(fetched.sort());
        expect([...seen].sort()).toEqual([...PACK_FILES].sort());
        const count = (kind) => manifest.assets.filter((entry) => entry.kind === kind);
        expect(count('tree')).toHaveLength(TREE_NAMES.length);
        expect(count('foliage').map((entry) => entry.file)).toEqual([FOLIAGE_FILE]);
        expect(count('props').map((entry) => entry.file)).toEqual([PROPS_FILE]);
        // The sprite-sheet layout and the props' anchors are read from here at runtime.
        expect(count('impostors').map((entry) => entry.file)).toEqual([IMPOSTOR_FILE]);
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

describe('Summer tree assets', () => {
    it.each(TREE_NAMES)('%s is a compact, texture-free GLB with a bark mesh and a cloud of foliage sites', (name) => {
        const { json } = readGlb(`${name}.glb`);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.extensionsUsed || []).not.toContain('EXT_meshopt_compression');
        expect(json.extensionsUsed || []).not.toContain('KHR_draco_mesh_compression');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes).toHaveLength(1);
        const primitive = (nodeName) => {
            const node = json.nodes.find((entry) => entry.name === nodeName);
            expect(node, nodeName).toBeDefined();
            // parseSummerTree decodes through translation and scale only.
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
        expect(meta).toMatchObject({ schemaVersion: SUMMER_ASSET_SCHEMA, name });
        expect(SPECIES).toContain(meta.species);
        expect(['hero', 'grove']).toContain(meta.role);
        expect(name.startsWith(`${meta.species}-${meta.role}`)).toBe(true);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
        expect(meta.foliage).toBe(FOLIAGE_OF[name]);
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        expect(tree).toMatchObject({ name });
        expect(SPECIES).toContain(tree.species);
        expect(['hero', 'grove']).toContain(tree.role);
        expect(name.startsWith(`${tree.species}-${tree.role}`)).toBe(true);
        // Birch and spruce of a Swedish lakeside: ten to twenty-odd metres.
        expect(tree.height).toBeGreaterThan(9);
        expect(tree.height).toBeLessThan(28);
        expect(tree.trunkRadius).toBeGreaterThan(0.12);
        expect(tree.trunkRadius).toBeLessThan(tree.height / 20);
        expect(tree.crownBase).toBeGreaterThan(0);
        expect(tree.crownBase).toBeLessThan(tree.height * 0.7);

        const { bark } = tree;
        expectWellFormedMesh(bark, 'bark');
        const { position } = bark.attributes;
        const [minY, maxY] = extent(position.array, 3, 1);
        // The root flare dips into the soil.
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
        expect(triangles(bark)).toBeGreaterThan(2000);
        // Sixteen-bit indices: a bark mesh never outgrows them.
        expect(position.count).toBeLessThanOrEqual(65536);
        // The white wood comes first in the index buffer, so a tier can stop drawing at a
        // triangle boundary before the fine limbs and hanging shoots.
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
        // They sit on the limbs: never lower than the wood itself, never above the leader,
        // and within reach of the bark.
        const { boundingBox } = tree.bark;
        const [lowest, highest] = extent(sites.position, 3, 1);
        expect(lowest).toBeGreaterThan(boundingBox.min.y - 0.25);
        // Neither a birch nor a spruce of this meadow is clothed to the ground.
        expect(lowest).toBeGreaterThan(1);
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
        for (const variant of new Set(sites.variant)) {
            // Exactly as SummerForest builds its bucket keys.
            const key = `${tree.foliage}_${variant % variants}`;
            expect(meshes[key], key).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBeGreaterThan(1);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it('gives the two framing trees finer foliage than the trees of the middle distance', () => {
        const kinds = Object.fromEntries(TREE_NAMES.map((name) => [name, parsed.trees[name].foliage]));
        expect(kinds).toEqual(FOLIAGE_OF);
        const { meshes, variants } = parsed.foliage;
        for (let variant = 0; variant < variants; variant++) {
            expect(triangles(meshes[`birch_spray_${variant}`]))
                .toBeGreaterThan(triangles(meshes[`birch_strand_${variant}`]));
            expect(triangles(meshes[`spruce_bough_${variant}`]))
                .toBeGreaterThan(triangles(meshes[`spruce_frond_${variant}`]));
        }
        // And the heroes are the big, detailed specimens.
        for (const species of SPECIES) {
            const hero = parsed.trees[`${species}-hero`];
            expect(hero.role).toBe('hero');
            for (const name of TREE_NAMES.filter((tree) => tree.startsWith(`${species}-grove`))) {
                expect(parsed.trees[name].role).toBe('grove');
                expect(triangles(hero.bark)).toBeGreaterThan(triangles(parsed.trees[name].bark) * 3);
                expect(hero.sites.count).toBeGreaterThan(parsed.trees[name].sites.count);
            }
        }
    });

    it('refuses a tree written for another schema or missing a primitive', async () => {
        const stale = await parseGlb('spruce-grove-d.glb');
        stale.scene.userData.schemaVersion = SUMMER_ASSET_SCHEMA + 1;
        const other = SUMMER_ASSET_SCHEMA + 1;
        expect(() => parseSummerTree(stale, 'spruce-grove-d')).toThrow(
            `[Summer] Tree "spruce-grove-d" has asset schema ${other}; expected ${SUMMER_ASSET_SCHEMA}.`,
        );
        const untagged = await parseGlb('spruce-grove-d.glb');
        untagged.scene.userData = {};
        expect(() => parseSummerTree(untagged, 'bare')).toThrow('has asset schema undefined');
        const parts = ['sites', 'bark'];
        const copies = await Promise.all(parts.map(() => parseGlb('spruce-grove-d.glb')));
        parts.forEach((missing, index) => {
            const broken = copies[index];
            broken.scene.remove(broken.scene.children.find((entry) => entry.name === missing));
            expect(() => parseSummerTree(broken, 'broken'))
                .toThrow(`[Summer] Asset is missing its "${missing}" primitive.`);
        });
        // The file names its own tree; the argument is only a fallback and a label for errors.
        const renamed = await parseGlb('spruce-grove-d.glb');
        expect(parseSummerTree(renamed, 'whatever').name).toBe('spruce-grove-d');
        const anonymous = await parseGlb('spruce-grove-d.glb');
        delete anonymous.scene.userData.name;
        expect(parseSummerTree(anonymous, 'fallback').name).toBe('fallback');
    });
});

describe('Summer foliage pack', () => {
    it('is a compact, texture-free GLB', () => {
        const { json } = readGlb(FOLIAGE_FILE);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(SUMMER_ASSET_SCHEMA);
        expect(json.scenes[0].extras.variants).toBe(2);
        for (const node of json.nodes) {
            // parseSummerMeshes decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            expect(json.meshes[node.mesh].primitives[0].mode ?? 4).toBe(4);
        }
        expect(new Set(json.nodes.map((node) => node.name)).size).toBe(json.nodes.length);
    });

    it('has exactly the eight sprays the trees wear, two variants of each kind', () => {
        const { variants, meshes } = parsed.foliage;
        expect(variants).toBe(2);
        for (const name of REQUIRED_FOLIAGE) expect(meshes[name], name).toBeDefined();
        const referenced = new Set();
        for (const tree of Object.values(parsed.trees)) {
            // Exactly as SummerForest builds its bucket keys.
            for (const variant of tree.sites.variant) referenced.add(`${tree.foliage}_${variant % variants}`);
        }
        expect([...referenced].sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        // The hero kinds are the heavy ones; the grove wears sprays a fraction of their weight.
        for (const [fine, light] of [['birch_spray', 'birch_strand'], ['spruce_bough', 'spruce_frond']]) {
            for (let variant = 0; variant < variants; variant++) {
                expect(triangles(meshes[`${fine}_${variant}`]), `${fine}_${variant}`)
                    .toBeGreaterThan(triangles(meshes[`${light}_${variant}`]) * 2);
            }
        }
    });

    it.each(REQUIRED_FOLIAGE)('%s is a small, complete spray growing from its attachment point', (name) => {
        const geometry = parsed.foliage.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(20);
        // A spray is instanced by the thousand.
        expect(triangles(geometry)).toBeLessThanOrEqual(500);
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
        // Leaf (1) against wood (0) is painted into alpha: every spray is mostly leaf.
        const { color } = geometry.attributes;
        let leaves = 0;
        for (let index = 0; index < color.count; index++) if (color.getW(index) > 0.5) leaves += 1;
        expect(leaves).toBeGreaterThan(color.count * 0.5);
    });

    it('refuses a pack written for another schema, naming which pack it was', async () => {
        const stale = await parseGlb(FOLIAGE_FILE);
        stale.scene.userData.schemaVersion = 0;
        expect(() => parseSummerMeshes(stale, 'Foliage'))
            .toThrow(`[Summer] Foliage has asset schema 0; expected ${SUMMER_ASSET_SCHEMA}.`);
        expect(() => parseSummerMeshes(stale, 'Props'))
            .toThrow(`[Summer] Props has asset schema 0; expected ${SUMMER_ASSET_SCHEMA}.`);
        stale.scene.userData = undefined;
        expect(() => parseSummerMeshes(stale, 'Foliage')).toThrow('Foliage has asset schema undefined');
        // Children without geometry (an empty, a light) are skipped rather than keyed.
        const mixed = await parseGlb(PROPS_FILE);
        const empty = new THREE.Object3D();
        empty.name = 'locator';
        mixed.scene.add(empty);
        expect(Object.keys(parseSummerMeshes(mixed, 'Props').meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
    });
});

describe('Summer props pack', () => {
    const box = (name) => parsed.props.meshes[name].boundingBox;
    const size = (name) => box(name).getSize(new THREE.Vector3());

    it('is a compact, texture-free GLB that names its own material codes', () => {
        const { json } = readGlb(PROPS_FILE);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        // The props carry no materials: their vertex colour says what each face is made of.
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        const [{ extras }] = json.scenes;
        expect(extras.schemaVersion).toBe(SUMMER_ASSET_SCHEMA);
        for (const node of json.nodes) {
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            expect(json.meshes[node.mesh].primitives[0].mode ?? 4).toBe(4);
        }
        expect(new Set(json.nodes.map((node) => node.name)).size).toBe(json.nodes.length);
        // The file's table of codes is the one the paint shader was written against.
        expect(Object.isFrozen(SUMMER_MATERIALS)).toBe(true);
        expect(Object.values(SUMMER_MATERIALS).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(extras.materialCodes).toHaveLength(Object.keys(SUMMER_MATERIALS).length);
        for (const [material, code] of Object.entries(SUMMER_MATERIALS)) {
            expect(extras.materialCodes[code], material).toBe(GENERATOR_NAMES[material]);
        }
    });

    it('has exactly the nine props the homestead places', () => {
        const { meshes } = parsed.props;
        for (const name of REQUIRED_PROPS) expect(meshes[name], name).toBeDefined();
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(Object.keys(PROP_MATERIALS).sort()).toEqual([...REQUIRED_PROPS].sort());
    });

    it.each(REQUIRED_PROPS)('%s is a complete, finite mesh painted with whole material codes', (name) => {
        const geometry = parsed.props.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(300);
        expect(geometry.attributes.position.count).toBeLessThanOrEqual(65536);
        const paint = paintOf(geometry);
        // An eight-bit channel holds code / 8 to within half a step: the shader's rounding
        // recovers a whole code for every vertex, and it is one of the nine.
        expect(paint.worst).toBeLessThan(0.02);
        for (const code of paint.codes.keys()) {
            expect(Number.isInteger(code)).toBe(true);
            expect(code).toBeGreaterThanOrEqual(0);
            expect(code).toBeLessThanOrEqual(8);
        }
        // And the prop is made of what it should be made of, and of nothing else.
        const made = [...paint.codes.keys()].sort((a, b) => a - b);
        expect(made, name).toEqual(PROP_MATERIALS[name].map((material) => SUMMER_MATERIALS[material])
            .sort((a, b) => a - b));
    });

    it('builds the cottage and the shed of red boards, white trim, tiles, stone, glass and a painted door', () => {
        for (const name of ['cottage', 'shed']) {
            const paint = paintOf(parsed.props.meshes[name]);
            const share = (material) => (paint.codes.get(SUMMER_MATERIALS[material]) || []).length;
            for (const material of ['red', 'white', 'roof', 'stone', 'glass', 'door']) {
                expect(share(material), `${name} ${material}`).toBeGreaterThan(0);
            }
            // Falu red is the house: more of it than of anything else.
            for (const material of Object.keys(SUMMER_MATERIALS).filter((key) => key !== 'red')) {
                expect(share('red'), `${name}: red against ${material}`).toBeGreaterThan(share(material));
            }
        }
        // Flowers grow at the cottage; the boathouse has none.
        const cottage = paintOf(parsed.props.meshes.cottage);
        expect(cottage.codes.get(SUMMER_MATERIALS.flowers).length).toBeGreaterThan(0);
        expect(cottage.codes.get(SUMMER_MATERIALS.garland).length).toBeGreaterThan(0);
        expect(paintOf(parsed.props.meshes.shed).codes.has(SUMMER_MATERIALS.flowers)).toBe(false);
        for (const name of ['boulder_a', 'boulder_b', 'boulder_c']) {
            expect([...paintOf(parsed.props.meshes[name]).codes.keys()]).toEqual([SUMMER_MATERIALS.stone]);
        }
    });

    it('paints every flower in the middle of one of seven bands, and all seven kinds on the maypole', () => {
        // The shader's own reading of a flower's kind.
        const kindOf = (tone) => Math.floor(tone * (FLOWER_KINDS - 0.001));
        for (const name of REQUIRED_PROPS.filter((prop) => PROP_MATERIALS[prop].includes('flowers'))) {
            const tones = paintOf(parsed.props.meshes[name]).tones(SUMMER_MATERIALS.flowers);
            expect(tones.length, name).toBeGreaterThan(0);
            for (const tone of new Set(tones)) {
                const band = tone * FLOWER_KINDS;
                // Mid-band, so neither rounding in the file nor in the shader can flip its kind.
                expect(Math.abs(band - Math.floor(band) - 0.5), `${name} tone ${tone}`).toBeLessThan(0.1);
                expect(kindOf(tone)).toBe(Math.floor(band));
                expect(kindOf(tone)).toBeGreaterThanOrEqual(0);
                expect(kindOf(tone)).toBeLessThan(FLOWER_KINDS);
            }
        }
        // The maypole is the game's bouquet: its wreaths carry a lantern for each of the seven.
        const maypole = paintOf(parsed.props.meshes.maypole);
        const tones = maypole.tones(SUMMER_MATERIALS.flowers);
        const census = new Array(FLOWER_KINDS).fill(0);
        tones.forEach((tone) => { census[kindOf(tone)] += 1; });
        expect(census.every((count) => count > 0)).toBe(true);
        // No kind is a token: each has a fair share of the wreaths.
        for (const count of census) expect(count).toBeGreaterThan(tones.length / (FLOWER_KINDS * 2));
        // Wound with birch leaves: far more garland than pole.
        expect(maypole.codes.get(SUMMER_MATERIALS.garland).length)
            .toBeGreaterThan(maypole.codes.get(SUMMER_MATERIALS.timber).length);
    });

    // The bouquet is thrown from these anchors, so they have to be where the flowers hang.
    it('hangs a ring of flowers around each of the maypole\'s wreath anchors', () => {
        const geometry = parsed.props.meshes.maypole;
        const { position, color } = geometry.attributes;
        const { anchors } = summerPropRecord('maypole');
        const flowers = paintOf(geometry).codes.get(SUMMER_MATERIALS.flowers);
        const point = new THREE.Vector3();
        expect(anchors.wreathRadius).toBeGreaterThan(0.2);
        expect(anchors.wreathRadius).toBeLessThan(1);
        for (const key of ['wreathLeft', 'wreathRight']) {
            const centre = new THREE.Vector3(...anchors[key]);
            const middle = new THREE.Vector3();
            const kinds = new Set();
            let hung = 0;
            let reach = 0;
            for (const index of flowers) {
                point.fromBufferAttribute(position, index);
                // The wreath's own flowers, not those wound round the arm above it.
                if (point.distanceTo(centre) < anchors.wreathRadius + 0.15) {
                    middle.add(point);
                    reach += point.distanceTo(centre);
                    kinds.add(Math.floor(color.getX(index) * (FLOWER_KINDS - 0.001)));
                    hung += 1;
                }
            }
            expect(hung, key).toBeGreaterThan(20);
            // A ring about the anchor: its flowers average out to the anchor and lie a radius from it.
            expect(middle.divideScalar(hung).distanceTo(centre), key).toBeLessThan(0.15);
            expect(reach / hung, key).toBeGreaterThan(anchors.wreathRadius * 0.6);
            expect(reach / hung, key).toBeLessThan(anchors.wreathRadius + 0.15);
            // Each wreath carries all seven kinds, so every lantern shows on both sides of the pole.
            expect(kinds.size, key).toBe(FLOWER_KINDS);
        }
    });

    it('records each prop in the manifest exactly as the file holds it', () => {
        const { json } = readGlb(PROPS_FILE);
        const manifest = readManifest().assets.find((entry) => entry.kind === 'props');
        expect(json.scenes[0].extras.meshes).toEqual(manifest.meshes);
        for (const name of REQUIRED_PROPS) {
            const record = summerPropRecord(name);
            expect(record, name).toBe(summerPropRecord(name));
            expect(record).toEqual(manifest.meshes[name]);
            // The node carries the same record, so the file can be read without the manifest.
            expect(json.nodes.find((node) => node.name === name).extras).toEqual(record);
            const geometry = parsed.props.meshes[name];
            expect(record.triangles).toBe(triangles(geometry));
            expect(record.vertices).toBe(geometry.attributes.position.count);
            // Bounds to the millimetre: sixteen-bit positions over a few metres.
            for (let axis = 0; axis < 3; axis++) {
                expect(geometry.boundingBox.min.getComponent(axis)).toBeCloseTo(record.boundsMin[axis], 3);
                expect(geometry.boundingBox.max.getComponent(axis)).toBeCloseTo(record.boundsMax[axis], 3);
                expect(record.size[axis]).toBeCloseTo(record.boundsMax[axis] - record.boundsMin[axis], 3);
            }
            // The generator's list of what the prop is made of is what its vertices say.
            expect([...record.materials].sort(), name)
                .toEqual(PROP_MATERIALS[name].map((material) => GENERATOR_NAMES[material]).sort());
        }
        for (const unknown of ['snag', 'Cottage', '', undefined, null]) expect(summerPropRecord(unknown)).toBeNull();
    });

    it.each(Object.entries(RUNTIME_ANCHORS))('gives the %s the anchors the runtime reads', (name, keys) => {
        const record = summerPropRecord(name);
        const bounds = new THREE.Box3(new THREE.Vector3(...record.boundsMin), new THREE.Vector3(...record.boundsMax));
        for (const key of keys) {
            const anchor = record.anchors[key];
            // SummerHomestead.anchor() accepts a point of three finite metres and nothing else.
            expect(Array.isArray(anchor), `${name}.${key}`).toBe(true);
            expect(anchor).toHaveLength(3);
            expect(anchor.every(Number.isFinite), `${name}.${key}`).toBe(true);
            // On the prop: inside its bounds, or within a hand of them.
            expect(bounds.distanceToPoint(new THREE.Vector3(...anchor)), `${name}.${key}`).toBeLessThan(0.25);
        }
    });

    it('puts those anchors where the things they name are', () => {
        const maypole = summerPropRecord('maypole').anchors;
        // The top is on the pole's axis and above everything that hangs from it.
        expect(Math.hypot(maypole.top[0], maypole.top[2])).toBeLessThan(0.05);
        expect(maypole.top[1]).toBeGreaterThan(maypole.armLeft[1] + 1);
        expect(maypole.top[1]).toBeLessThanOrEqual(box('maypole').max.y);
        // The cross-arm is level and reaches the same distance either side of the pole.
        expect(maypole.armLeft[0]).toBeLessThan(-1);
        expect(maypole.armRight[0]).toBeCloseTo(-maypole.armLeft[0], 6);
        expect(maypole.armRight[1]).toBeCloseTo(maypole.armLeft[1], 6);
        // A wreath hangs under each end of the arm.
        for (const [wreath, arm] of [[maypole.wreathLeft, maypole.armLeft], [maypole.wreathRight, maypole.armRight]]) {
            expect(wreath[1]).toBeLessThan(arm[1]);
            expect(wreath[1]).toBeGreaterThan(arm[1] - 2);
            expect(Math.abs(wreath[0] - arm[0])).toBeLessThan(0.5);
            expect(Math.sign(wreath[0])).toBe(Math.sign(arm[0]));
        }
        expect(maypole.wreathRight[0]).toBeCloseTo(-maypole.wreathLeft[0], 6);
        // Smoke leaves the cottage from the highest thing on it.
        const cottage = summerPropRecord('cottage').anchors;
        expect(cottage.chimneyTop[1]).toBeCloseTo(box('cottage').max.y, 3);
        expect(cottage.chimneyTop[1]).toBeGreaterThan(cottage.ridge[0][1]);
        // The jetty's end is its far end, on the deck.
        const jetty = summerPropRecord('jetty').anchors;
        expect(jetty.end[2]).toBeLessThan(box('jetty').min.z + 0.5);
        expect(jetty.end[2]).toBeGreaterThanOrEqual(box('jetty').min.z);
        expect(Math.abs(jetty.end[0])).toBeLessThan(0.1);
        expect(jetty.end[1]).toBeGreaterThan(0.2);
        expect(jetty.end[1]).toBeLessThan(box('jetty').max.y);
    });

    it('models the props at the sizes and origins the homestead places them by', () => {
        // The cottage and the boathouse stand on their origin plane: nothing of them is
        // below it, so a building placed at ground level neither floats nor sinks.
        for (const name of ['cottage', 'shed']) {
            expect(box(name).min.y).toBeCloseTo(0, 3);
            expect(box(name).containsPoint(new THREE.Vector3(0, 1, 0))).toBe(true);
            // The plinth reaches the origin plane all the way round the walls.
            const { position } = parsed.props.meshes[name].attributes;
            const foot = new THREE.Box3();
            const point = new THREE.Vector3();
            for (let index = 0; index < position.count; index++) {
                if (position.getY(index) < 0.02) foot.expandByPoint(point.fromBufferAttribute(position, index));
            }
            expect(foot.max.x - foot.min.x, name).toBeGreaterThan(size(name).x * 0.7);
            expect(foot.max.z - foot.min.z, name).toBeGreaterThan(size(name).z * 0.7);
        }
        // A house and a boathouse: the cottage several times the shed, both with a pitched roof.
        expect(size('cottage').x).toBeGreaterThan(8);
        expect(size('cottage').y).toBeGreaterThan(5);
        expect(size('shed').y).toBeGreaterThan(2);
        expect(size('cottage').x * size('cottage').z).toBeGreaterThan(size('shed').x * size('shed').z * 3);
        // The maypole stands on its origin with its foot in the ground, taller than the cottage.
        expect(box('maypole').min.y).toBeLessThan(0);
        expect(box('maypole').min.y).toBeGreaterThan(-1);
        expect(box('maypole').max.y).toBeGreaterThan(size('cottage').y);
        expect(box('maypole').containsPoint(new THREE.Vector3(0, 1, 0))).toBe(true);
        // Its cross-arm lies along X; it is thin the other way.
        expect(size('maypole').x).toBeGreaterThan(size('maypole').z * 4);
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
        // Boulders of a few metres (the homestead scales them down), bedded into the ground.
        for (const name of ['boulder_a', 'boulder_b', 'boulder_c']) {
            expect(Math.max(size(name).x, size(name).z)).toBeGreaterThan(2);
            expect(Math.max(size(name).x, size(name).z)).toBeLessThan(5);
            expect(box(name).min.y).toBeLessThan(-0.2);
            expect(box(name).max.y).toBeGreaterThan(0.6);
            expect(box(name).containsPoint(new THREE.Vector3(0, 0.1, 0))).toBe(true);
        }
        const outlines = ['boulder_a', 'boulder_b', 'boulder_c'].map((name) => size(name).toArray().join());
        expect(new Set(outlines).size).toBe(3);
        // One section of roundpole fence along X, centred, that tiles end to end; its stakes
        // go into the ground.
        const { anchors } = summerPropRecord('fence');
        expect(anchors.end[0] - anchors.start[0]).toBeCloseTo(anchors.section, 6);
        expect(anchors.start[0]).toBeCloseTo(-anchors.end[0], 6);
        expect(size('fence').x).toBeGreaterThanOrEqual(anchors.section);
        expect(size('fence').x).toBeLessThan(anchors.section * 1.1);
        expect(size('fence').z).toBeLessThan(0.5);
        expect(box('fence').min.y).toBeLessThan(0);
        expect(box('fence').max.y).toBeGreaterThan(1);
    });
});

describe('Summer far-shore sprite sheet', () => {
    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const layout = summerImpostorLayout();
        expect(Object.keys(layout).sort()).toEqual(['atlasHeight', 'atlasWidth', 'tiles']);
        const png = readAsset(IMPOSTOR_FILE);
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(layout.atlasWidth);
        expect(png.readUInt32BE(20)).toBe(layout.atlasHeight);
        // Shade, leaf mask, hue seed and coverage: four 8-bit channels.
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
        const layout = summerImpostorLayout();
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
        // Every grove tree has a far silhouette, each once: three birches and four spruces.
        expect(layout.tiles.map((tile) => tile.asset).sort())
            .toEqual(TREE_NAMES.filter((name) => parsed.trees[name].role === 'grove').sort());
        expect(layout.tiles.filter((tile) => tile.species === 'birch')).toHaveLength(3);
        expect(layout.tiles.filter((tile) => tile.species === 'spruce')).toHaveLength(4);
        expect(new Set(layout.tiles.map((tile) => tile.species))).toEqual(new Set(SPECIES));
    });

    it('prepares the sheet as linear, clamped, mip-mapped data', () => {
        const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareSummerImpostors(texture)).toBe(texture);
        // It stores shading data, not colour.
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.anisotropy).toBeGreaterThan(1);
        expect(texture.name).toBe('SummerFarShoreSprites');
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });
});

describe('loading and releasing the Summer assets', () => {
    const packGeometries = (assets) => [...Object.values(assets.foliage.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark)];

    it('loads every file once and returns the parsed bundle', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const isCurrent = vi.fn(() => true);
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadSummerAssets({ loader, textureLoader, isCurrent });
        const requested = loader.loadAsync.mock.calls.map(([url]) => url);
        expect([...requested].sort()).toEqual([SUMMER_FOLIAGE_URL, SUMMER_PROPS_URL,
            ...Object.values(SUMMER_TREE_URLS)].sort());
        expect(textureLoader.loadAsync).toHaveBeenCalledExactlyOnceWith(SUMMER_IMPOSTOR_URL);
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
        expect(assets.impostors).toEqual({ ...summerImpostorLayout(), texture: textureLoader.textures[0] });
        expect(assets.impostors.texture.name).toBe('SummerFarShoreSprites');
        expect(assets.impostors.texture.colorSpace).toBe(THREE.NoColorSpace);
        // A bundle that is handed over is intact.
        expect(disposal).not.toHaveBeenCalled();
        expect(textureLoader.disposed).toEqual([]);
        disposeSummerAssets(assets);
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
        const assets = await loadSummerAssets({ loader, textureLoader: null });
        // One for the sprays, one for the props, and a mesh and a points material for each tree.
        expect(materials.size).toBe(1 + 1 + TREE_NAMES.length * 2);
        for (const disposal of materials.values()) expect(disposal).toHaveBeenCalled();
        // The geometry the world adopts is not the loader's to throw away.
        const adopted = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        expect(packGeometries(assets).every((geometry) => geometry.attributes.position.count > 0)).toBe(true);
        expect(adopted).not.toHaveBeenCalled();
        disposeSummerAssets(assets);
        expect(adopted).toHaveBeenCalledTimes(REQUIRED_FOLIAGE.length + REQUIRED_PROPS.length + TREE_NAMES.length);
    });

    it('disposes everything and returns null when the start that asked is no longer current', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadSummerAssets({ loader, textureLoader, isCurrent: () => false });
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
        const assets = await loadSummerAssets({
            trees: ['spruce-grove-a', 'birch-grove-b', 'spruce-grove-a'], loader, textureLoader: null,
        });
        expect(Object.keys(assets.trees)).toEqual(['spruce-grove-a', 'birch-grove-b']);
        expect(loader.loadAsync).toHaveBeenCalledTimes(4);
        expect(loader.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual(['birch-grove-b.glb', 'spruce-grove-a.glb', FOLIAGE_FILE, PROPS_FILE]);
        expect(assets.impostors).toBeNull();
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        disposeSummerAssets(assets);
    });

    it('rejects an unknown tree name and a failed download', async () => {
        await expect(loadSummerAssets({
            trees: ['spruce-hero', 'maple'], loader: diskLoader(), textureLoader: stubTextureLoader(),
        })).rejects.toThrow('[Summer] Unknown tree asset "maple".');
        // A tree of the scene this pack replaced is as unknown as any other.
        await expect(loadSummerAssets({ trees: ['summer_aspen'], loader: diskLoader(), textureLoader: null }))
            .rejects.toThrow('[Summer] Unknown tree asset "summer_aspen".');
        const flaky = diskLoader();
        flaky.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === 'birch-hero.glb') throw new Error('404 birch-hero.glb');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadSummerAssets({ loader: flaky, textureLoader: stubTextureLoader() }))
            .rejects.toThrow('404 birch-hero.glb');
        const noProps = diskLoader();
        noProps.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === PROPS_FILE) throw new Error('404 props');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadSummerAssets({ loader: noProps, textureLoader: null })).rejects.toThrow('404 props');
        const noSheet = stubTextureLoader();
        noSheet.loadAsync.mockRejectedValue(new Error('404 sprites'));
        await expect(loadSummerAssets({ loader: diskLoader(), textureLoader: noSheet }))
            .rejects.toThrow('404 sprites');
    });

    it('rejects a pack whose files were written for another schema', async () => {
        const stale = (file) => {
            const loader = diskLoader();
            loader.loadAsync.mockImplementation(async (url) => {
                const gltf = await parseGlb(fileNameOf(url));
                if (fileNameOf(url) === file) gltf.scene.userData.schemaVersion = SUMMER_ASSET_SCHEMA + 1;
                return gltf;
            });
            return loadSummerAssets({ loader, textureLoader: null });
        };
        const other = SUMMER_ASSET_SCHEMA + 1;
        await expect(stale('spruce-grove-c.glb')).rejects.toThrow(
            `[Summer] Tree "spruce-grove-c" has asset schema ${other}; expected ${SUMMER_ASSET_SCHEMA}.`,
        );
        await expect(stale(FOLIAGE_FILE)).rejects.toThrow(
            `[Summer] Foliage has asset schema ${other}; expected ${SUMMER_ASSET_SCHEMA}.`,
        );
        await expect(stale(PROPS_FILE)).rejects.toThrow(
            `[Summer] Props has asset schema ${other}; expected ${SUMMER_ASSET_SCHEMA}.`,
        );
    });

    it('releases each geometry and the sprite sheet exactly once', async () => {
        const textureLoader = stubTextureLoader();
        const assets = await loadSummerAssets({ loader: diskLoader(), textureLoader });
        const geometries = packGeometries(assets);
        expect(new Set(geometries).size).toBe(REQUIRED_FOLIAGE.length + REQUIRED_PROPS.length + TREE_NAMES.length);
        const disposals = [...geometries, assets.impostors.texture].map((resource) => vi.spyOn(resource, 'dispose'));
        disposeSummerAssets(assets);
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
            expect(() => disposeSummerAssets(assets)).not.toThrow();
        }
        disposeSummerAssets({ trees: { sapling: { bark } } });
        disposeSummerAssets({ foliage: { meshes: { spray } } });
        disposeSummerAssets({ props: { meshes: { boat } } });
        disposeSummerAssets({ impostors: { texture } });
        for (const resource of [bark, spray, boat, texture]) expect(resource.dispose).toHaveBeenCalledOnce();
    });
});
