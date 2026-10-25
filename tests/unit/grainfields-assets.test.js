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
    GRAINFIELDS_ASSET_SCHEMA, GRAINFIELDS_FOLIAGE_URL, GRAINFIELDS_HORSE_URL,
    GRAINFIELDS_IMPOSTOR_URL, GRAINFIELDS_TREE_URLS, disposeGrainfieldsAssets, grainfieldsImpostorLayout,
    loadGrainfieldsAssets, parseGrainfieldsHorse, parseGrainfieldsMeshes, parseGrainfieldsTree,
    prepareGrainfieldsImpostors,
} from '../../src/themes/grainfields/grainfields-assets.js';
import {
    HORSE_BONES, SKIN_ROWS, createPose, createRig, poseRig, writeSkinRows,
} from '../../src/themes/grainfields/grainfields-horse-rig.js';

const assetDirectory = new URL('../../src/themes/grainfields/assets/', import.meta.url);
const KB = 1000;
const MB = 1000 * KB;
const TREE_NAMES = Object.keys(GRAINFIELDS_TREE_URLS);
const SPECIES = ['birch', 'spruce', 'larch'];
// The heights the three species were asked for: shirakaba, Ezo spruce and karamatsu.
const HEIGHTS = Object.freeze({ birch: [12, 17], spruce: [16, 22], larch: [18, 24] });
// The spray each species wears: every tree is a grove tree, so each wears the light one.
const FOLIAGE_OF_SPECIES = Object.freeze({ birch: 'birch_sprig', spruce: 'spruce_frond', larch: 'larch_tuft' });
// Every spray the trees ask the foliage pack for: two variants of each kind.
const REQUIRED_FOLIAGE = ['birch_sprig_0', 'birch_sprig_1', 'spruce_frond_0', 'spruce_frond_1', 'larch_tuft_0',
    'larch_tuft_1'];
// What counts a spray's leaves in its record.
const SPRAY_UNITS = Object.freeze({ birch_sprig: 'leaves', spruce_frond: 'shoots', larch_tuft: 'tufts' });
const FOLIAGE_FILE = 'grainfields-foliage.glb';
const IMPOSTOR_FILE = 'grainfields-impostors.png';
const HORSE_FILE = 'grainfields-horse.glb';
// The twelve files of the pack.
const PACK_FILES = [...TREE_NAMES.map((name) => `${name}.glb`), FOLIAGE_FILE, IMPOSTOR_FILE, HORSE_FILE];

// What the pack may weigh (it wrote 1.83 MB on 2026-10-18, the heaviest tree 207 KB, the
// sprite sheet 489 KB; the rigged horse of 2026-10-25 is 179 KB), so it cannot balloon without
// someone raising a number on purpose.
const BUDGET = Object.freeze({
    packBytes: 2.5 * MB, treeBytes: 260 * KB, impostorBytes: 700 * KB, horseBytes: 250 * KB,
});
// The herd's horse is one skinned mesh drawn a handful of times twenty to fifty metres out.
const HORSE_TRIANGLES = Object.freeze({ min: 6000, max: 11000 });
// Poses the skin must take without tearing (local turns, radians): a gallop's reach and gather, the
// neck down to the grass, a hind cocked at rest.
const TEST_POSES = Object.freeze({
    reach: {
        chest: [-0.06, 0, 0],
        pelvis: [0.08, 0, 0],
        neck0: [0.25, 0, 0],
        head: [-0.15, 0, 0],
        scapulaL: [-0.22, 0, 0],
        humerusL: [-0.35, 0, 0],
        forearmL: [-0.45, 0, 0],
        foreCannonL: [0.35, 0, 0],
        humerusR: [0.2, 0, 0],
        forearmR: [-0.9, 0, 0],
        foreCannonR: [1.9, 0, 0],
        forePasternR: [0.9, 0, 0],
        femurL: [0.45, 0, 0],
        tibiaL: [0.15, 0, 0],
        hindCannonL: [0.25, 0, 0],
        femurR: [0.2, 0, 0],
        tibiaR: [0.35, 0, 0],
        hindCannonR: [-0.8, 0, 0],
        hindPasternR: [0.9, 0, 0],
        tail0: [0.8, 0, 0],
        tail1: [0.3, 0, 0.3],
        tail3: [0.2, 0, -0.4],
    },
    gather: {
        chest: [0.06, 0, 0],
        pelvis: [-0.1, 0, 0],
        humerusL: [0.15, 0, 0],
        forearmL: [-0.7, 0, 0],
        foreCannonL: [1.6, 0, 0],
        forePasternL: [0.8, 0, 0],
        femurL: [-0.55, 0, 0],
        tibiaL: [0.35, 0, 0],
        hindCannonL: [-0.9, 0, 0],
        hindPasternL: [0.7, 0, 0],
        femurR: [-0.45, 0, 0],
        tibiaR: [0.3, 0, 0],
        hindCannonR: [-0.7, 0, 0],
    },
    graze: {
        neck0: [1.05, 0.15, 0],
        neck1: [0.55, 0.1, 0],
        neck2: [0.33, 0, 0],
        head: [-1.2, 0.1, 0.1],
        jaw: [0.2, 0.04, 0],
        earL: [-0.3, 0.9, 0.2],
        earR: [0.25, 0, -0.1],
    },
    rest: {
        pelvis: [0, 0, 0.05],
        femurR: [-0.08, 0, 0],
        tibiaR: [0.05, 0, 0],
        hindCannonR: [-0.32, 0, 0],
        hindPasternR: [1.0, 0, 0],
        hindHoofR: [0.35, 0, 0],
        earL: [0.15, 0, 0.75],
        earR: [0.15, 0, -0.75],
    },
});
// The fields draw a couple of hundred of these trees: each keeps its sprays to Summer's grove counts.
const MAX_SITES = 300;

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

function mean(array) {
    return array.reduce((sum, value) => sum + value, 0) / array.length;
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

/** A vertex's bones and their weights (0..1), from the horse's `_bones` and `_weights`. */
function horseSkin(geometry) {
    const { _bones: bones, _weights: weights } = geometry.attributes;
    return (v) => ({
        bones: [bones.getX(v), bones.getY(v), bones.getZ(v), bones.getW(v)],
        weights: [weights.getX(v), weights.getY(v), weights.getZ(v), weights.getW(v)],
    });
}

const parsed = { trees: {}, foliage: null, horse: null };

beforeAll(async () => {
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseGrainfieldsTree(gltfs[index], name); });
    parsed.foliage = parseGrainfieldsMeshes(await parseGlb(FOLIAGE_FILE), 'Foliage');
    parsed.horse = parseGrainfieldsHorse(await parseGlb(HORSE_FILE));
}, 60000);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Grainfields asset sources', () => {
    it('are strict UTF-8 with Unix line endings', () => {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        // The decoder really is strict: a lone Windows-1252 dash (0x97) is not UTF-8.
        expect(() => decoder.decode(Uint8Array.of(0x20, 0x97, 0x20))).toThrow();
        const sources = [
            new URL('../../src/themes/grainfields/grainfields-assets.js', import.meta.url),
            new URL('../../scripts/blender/grainfields_assets.py', import.meta.url),
            ...['species.py', 'leaves.py', 'preview.py', 'horse.py'].map(
                (file) => new URL(`../../scripts/blender/grainfields/${file}`, import.meta.url),
            ),
            new URL('ATTRIBUTION.md', assetDirectory),
            new URL('asset-manifest.json', assetDirectory),
        ];
        for (const source of sources) {
            const file = fileURLToPath(source);
            const bytes = readFileSync(source);
            let text = null;
            expect(() => { text = decoder.decode(bytes); }, `${file} is not valid UTF-8`).not.toThrow();
            expect(text.includes('\r'), `${file} has a carriage return`).toBe(false);
            expect(text.includes('�'), `${file} has a replacement character`).toBe(false);
            // No byte-order mark either.
            expect([bytes[0], bytes[1], bytes[2]], file).not.toEqual([0xef, 0xbb, 0xbf]);
        }
    });

    it('owns its modules: the loader imports nothing from another theme', () => {
        const module = new URL('../../src/themes/grainfields/grainfields-assets.js', import.meta.url);
        const source = readFileSync(module, 'utf8');
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
        expect(imports.sort()).toEqual(['./assets/asset-manifest.json', 'three/addons/loaders/GLTFLoader.js',
            'three/webgpu'].sort());
    });
});

describe('Grainfields asset pack on disk', () => {
    it('points every URL at a file that exists in the asset directory, and ships nothing else', () => {
        expect(Object.isFrozen(GRAINFIELDS_TREE_URLS)).toBe(true);
        expect(TREE_NAMES).toHaveLength(9);
        for (const species of SPECIES) {
            expect(TREE_NAMES.filter((name) => name.startsWith(`${species}-grove-`)), species).toHaveLength(3);
        }
        const referenced = [];
        for (const [name, url] of Object.entries(GRAINFIELDS_TREE_URLS)) {
            expect(fileNameOf(url)).toBe(`${name}.glb`);
            referenced.push(fileNameOf(url));
        }
        expect(fileNameOf(GRAINFIELDS_FOLIAGE_URL)).toBe(FOLIAGE_FILE);
        expect(fileNameOf(GRAINFIELDS_IMPOSTOR_URL)).toBe(IMPOSTOR_FILE);
        expect(fileNameOf(GRAINFIELDS_HORSE_URL)).toBe(HORSE_FILE);
        referenced.push(FOLIAGE_FILE, IMPOSTOR_FILE, HORSE_FILE);
        expect([...referenced].sort()).toEqual([...PACK_FILES].sort());
        expect(PACK_FILES).toHaveLength(12);
        const directory = fileURLToPath(assetDirectory);
        for (const url of [...Object.values(GRAINFIELDS_TREE_URLS), GRAINFIELDS_FOLIAGE_URL,
            GRAINFIELDS_IMPOSTOR_URL, GRAINFIELDS_HORSE_URL]) {
            const file = fileNameOf(url);
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(sizeOf(file)).toBeGreaterThan(0);
            // Under Vitest the URLs are file URLs; they must land in the pack, not beside it.
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(file, assetDirectory)));
                expect(fileURLToPath(url).startsWith(directory)).toBe(true);
            }
        }
        // Nothing ships that the runtime does not load, and nothing is loaded twice.
        const shipped = readdirSync(assetDirectory)
            .filter((file) => /\.(glb|gltf|png|jpe?g|webp|ktx2|hdr|exr|bin)$/i.test(file)).sort();
        expect(shipped).toEqual([...referenced].sort());
        expect(new Set(referenced).size).toBe(referenced.length);
        // Beside them only the manifest and the attribution.
        expect(readdirSync(assetDirectory).filter((file) => !shipped.includes(file)).sort())
            .toEqual(['ATTRIBUTION.md', 'asset-manifest.json']);
        expect(readAsset(IMPOSTOR_FILE).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('keeps the pack under 2.5 MB, a tree under 260 KB, the sprites under 700 KB, the horse under 250 KB', () => {
        const files = readdirSync(assetDirectory);
        const total = files.reduce((sum, file) => sum + sizeOf(file), 0);
        expect(total).toBeLessThanOrEqual(BUDGET.packBytes);
        // The download itself: every binary the theme fetches.
        const fetched = files.filter((file) => /\.(glb|png)$/.test(file));
        expect(fetched).toHaveLength(12);
        expect(fetched.reduce((sum, file) => sum + sizeOf(file), 0)).toBeLessThanOrEqual(BUDGET.packBytes);
        for (const name of TREE_NAMES) expect(sizeOf(`${name}.glb`), name).toBeLessThanOrEqual(BUDGET.treeBytes);
        expect(sizeOf(IMPOSTOR_FILE)).toBeLessThanOrEqual(BUDGET.impostorBytes);
        expect(sizeOf(HORSE_FILE)).toBeLessThanOrEqual(BUDGET.horseBytes);
        // The manifest's own arithmetic agrees.
        const manifest = readManifest();
        expect(manifest.assets.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(BUDGET.packBytes);
    });

    // This pins the pack: regenerating it changes these hashes, and committing a new manifest
    // beside the new files is the conscious act that makes this pass again.
    it('matches every manifest entry byte for byte', () => {
        const manifest = readManifest();
        expect(manifest.schemaVersion).toBe(GRAINFIELDS_ASSET_SCHEMA);
        expect(GRAINFIELDS_ASSET_SCHEMA).toBe(1);
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
            expect(['tree', 'foliage', 'impostors', 'horse']).toContain(entry.kind);
        }
        // Every binary the theme fetches is vouched for, and nothing else is listed.
        const fetched = [...Object.values(GRAINFIELDS_TREE_URLS), GRAINFIELDS_FOLIAGE_URL, GRAINFIELDS_IMPOSTOR_URL,
            GRAINFIELDS_HORSE_URL].map(fileNameOf);
        expect([...seen].sort()).toEqual(fetched.sort());
        expect([...seen].sort()).toEqual([...PACK_FILES].sort());
        const count = (kind) => manifest.assets.filter((entry) => entry.kind === kind);
        expect(count('tree')).toHaveLength(TREE_NAMES.length);
        expect(count('foliage').map((entry) => entry.file)).toEqual([FOLIAGE_FILE]);
        // The sprite-sheet layout is read from here at runtime.
        expect(count('impostors').map((entry) => entry.file)).toEqual([IMPOSTOR_FILE]);
        expect(count('horse').map((entry) => entry.file)).toEqual([HORSE_FILE]);
    });

    it('describes each tree and the spray pack the way the files really are', () => {
        const manifest = readManifest();
        for (const entry of manifest.assets) {
            if (entry.kind === 'tree') {
                const tree = parsed.trees[entry.file.replace(/\.glb$/, '')];
                expect(tree, entry.file).toBeDefined();
                expect(entry).toMatchObject({ species: tree.species, role: tree.role });
                expect(entry.sites).toBe(tree.sites.count);
                expect(entry.barkTriangles).toBe(triangles(tree.bark));
            }
            if (entry.kind === 'foliage') {
                expect(Object.keys(entry.meshes).sort()).toEqual(Object.keys(parsed.foliage.meshes).sort());
                for (const [name, record] of Object.entries(entry.meshes)) {
                    expect(record.triangles, name).toBe(triangles(parsed.foliage.meshes[name]));
                    const unit = SPRAY_UNITS[name.replace(/_\d+$/, '')];
                    expect(Object.keys(record).sort(), name).toEqual([unit, 'triangles'].sort());
                    expect(record[unit], name).toBeGreaterThan(4);
                }
            }
            if (entry.kind === 'horse') {
                const { geometry, skeleton } = parsed.horse;
                expect(entry).toMatchObject({ name: 'grainfields-horse', bones: skeleton.length });
                expect(entry.triangles).toBe(triangles(geometry));
                expect(entry.vertices).toBe(geometry.attributes.position.count);
                // The breed's size, as measured on the mesh.
                expect(entry.withersHeight).toBeGreaterThan(1.3);
                expect(entry.withersHeight).toBeLessThan(1.4);
                expect(entry.height).toBeCloseTo(geometry.boundingBox.max.y, 3);
            }
        }
    });
});

describe('Grainfields tree assets', () => {
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
            // parseGrainfieldsTree decodes through translation and scale only.
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
        expect(meta).toMatchObject({ schemaVersion: GRAINFIELDS_ASSET_SCHEMA, name });
        expect(SPECIES).toContain(meta.species);
        // Every tree of the fields is seen from ninety metres or more: there are no heroes.
        expect(meta.role).toBe('grove');
        expect(name.startsWith(`${meta.species}-${meta.role}`)).toBe(true);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
        expect(meta.foliage).toBe(FOLIAGE_OF_SPECIES[meta.species]);
        expect(meta.crownCentre).toHaveLength(3);
        expect(meta.crownRadii).toHaveLength(3);
        expect(meta.crownRadii.every((radius) => radius > 1)).toBe(true);
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        expect(tree).toMatchObject({ name, role: 'grove' });
        expect(SPECIES).toContain(tree.species);
        expect(name.startsWith(`${tree.species}-grove-`)).toBe(true);
        const [shortest, tallest] = HEIGHTS[tree.species];
        expect(tree.height).toBeGreaterThanOrEqual(shortest);
        expect(tree.height).toBeLessThanOrEqual(tallest);
        expect(tree.trunkRadius).toBeGreaterThan(0.12);
        expect(tree.trunkRadius).toBeLessThan(tree.height / 40);
        expect(tree.crownBase).toBeGreaterThan(0);
        expect(tree.crownBase).toBeLessThan(tree.height * 0.6);

        const { bark } = tree;
        expectWellFormedMesh(bark, 'bark');
        const { position } = bark.attributes;
        const [minY, maxY] = extent(position.array, 3, 1);
        // The root flare dips into the soil.
        expect(minY).toBeLessThan(0.05);
        expect(minY).toBeGreaterThan(-1);
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
        expect(triangles(bark)).toBeLessThan(10000);
        // Sixteen-bit indices: a bark mesh never outgrows them.
        expect(position.count).toBeLessThanOrEqual(65536);
        // The stems come first in the index buffer, so a tier can stop drawing at a triangle
        // boundary before the limbs and twigs.
        expect(Number.isInteger(tree.barkCoreIndices)).toBe(true);
        expect(tree.barkCoreIndices % 3).toBe(0);
        expect(tree.barkCoreIndices).toBeGreaterThan(0);
        expect(tree.barkCoreIndices).toBeLessThan(bark.index.count);
        // The core is the stem: it alone reaches most of the way up the tree.
        let coreTop = -Infinity;
        for (let index = 0; index < tree.barkCoreIndices; index++) {
            coreTop = Math.max(coreTop, position.getY(bark.index.getX(index)));
        }
        expect(coreTop).toBeGreaterThan(tree.height * 0.7);
        // Occlusion was baked: the wood inside the crown is darker than the open stem.
        const { color } = bark.attributes;
        let darkest = 1;
        let lightest = 0;
        for (let index = 0; index < color.count; index++) {
            darkest = Math.min(darkest, color.getZ(index));
            lightest = Math.max(lightest, color.getZ(index));
        }
        expect(lightest - darkest).toBeGreaterThan(0.5);
    });

    it.each(TREE_NAMES)('%s carries a modest cloud of well-formed foliage sites inside its crown', (name) => {
        const tree = parsed.trees[name];
        const { sites } = tree;
        expect(sites.count).toBeGreaterThan(120);
        expect(sites.count).toBeLessThanOrEqual(MAX_SITES);
        expect(sites.position).toHaveLength(sites.count * 3);
        expect(sites.rotation).toHaveLength(sites.count * 4);
        expect(sites.bent).toHaveLength(sites.count * 3);
        for (const key of ['scale', 'sky', 'sway', 'phase', 'hue', 'variant', 'level']) {
            expect(sites[key], key).toHaveLength(sites.count);
        }
        for (const key of ['position', 'rotation', 'bent', 'scale', 'sky', 'sway', 'phase', 'hue']) {
            expect(sites[key]).toBeInstanceOf(Float32Array);
            expect(finite(sites[key]), key).toBe(true);
        }
        expect(sites.variant).toBeInstanceOf(Uint8Array);
        expect(sites.level).toBeInstanceOf(Uint8Array);
        expect(Math.max(...sites.level)).toBeLessThanOrEqual(3);
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
        // No tree of the fields is clothed to the ground.
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
        expect(tree.foliage).toBe(FOLIAGE_OF_SPECIES[tree.species]);
        expect(tree.foliage.startsWith(`${tree.species}_`)).toBe(true);
        for (const variant of new Set(sites.variant)) {
            // The bucket key a forest builds, as SummerForest does.
            const key = `${tree.foliage}_${variant % variants}`;
            expect(meshes[key], key).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBeGreaterThan(1);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it('grows each species to its own silhouette: white-stemmed birch, spruce spire, open larch cone', () => {
        const tiles = Object.fromEntries(grainfieldsImpostorLayout().tiles.map((tile) => [tile.asset, tile]));
        const bySpecies = (species) => TREE_NAMES.filter((name) => parsed.trees[name].species === species);
        const aspect = (name) => tiles[name].width / tiles[name].height;
        for (const name of bySpecies('spruce')) {
            // A narrow spire, the densest of the three, clothed nearly to its foot.
            expect(aspect(name), name).toBeLessThan(0.4);
            expect(tiles[name].coverage, name).toBeGreaterThan(0.3);
            expect(parsed.trees[name].crownBase / parsed.trees[name].height, name).toBeLessThan(0.25);
        }
        for (const name of bySpecies('larch')) {
            // A broad cone on a long bole, with the sky through it.
            expect(aspect(name), name).toBeGreaterThan(0.42);
            expect(tiles[name].coverage, name).toBeLessThan(0.25);
            expect(parsed.trees[name].crownBase / parsed.trees[name].height, name).toBeGreaterThan(0.25);
        }
        for (const name of bySpecies('birch')) {
            // An airy crown high on clean stems.
            expect(tiles[name].coverage, name).toBeLessThan(0.3);
            expect(parsed.trees[name].crownBase / parsed.trees[name].height, name).toBeGreaterThan(0.3);
            // The stems are white between their dark foot and the crown (inside it they thin
            // to dark twigs): the dark-bark mask is off over most of the open bole.
            const { bark, barkCoreIndices, crownBase } = parsed.trees[name];
            const seen = new Set();
            let white = 0;
            for (let index = 0; index < barkCoreIndices; index++) {
                const vertex = bark.index.getX(index);
                const y = bark.attributes.position.getY(vertex);
                if (!seen.has(vertex) && y > 1 && y < crownBase) {
                    seen.add(vertex);
                    if (bark.attributes.color.getW(vertex) < 0.5) white += 1;
                }
            }
            expect(seen.size, name).toBeGreaterThan(50);
            expect(white / seen.size, name).toBeGreaterThan(0.8);
        }
        // Every spruce is denser than every larch.
        const spruceCover = Math.min(...bySpecies('spruce').map((name) => tiles[name].coverage));
        const larchCover = Math.max(...bySpecies('larch').map((name) => tiles[name].coverage));
        expect(spruceCover).toBeGreaterThan(larchCover + 0.08);
        // The larches are the tallest trees of the belts, the birches the smallest.
        const tallest = (species) => Math.max(...bySpecies(species).map((name) => parsed.trees[name].height));
        const shortest = (species) => Math.min(...bySpecies(species).map((name) => parsed.trees[name].height));
        expect(tallest('larch')).toBeGreaterThan(tallest('spruce'));
        expect(tallest('birch')).toBeLessThan(shortest('larch'));
        // Each species is three distinct trees, not one tree three times.
        for (const species of SPECIES) {
            const counts = bySpecies(species).map((name) => parsed.trees[name].sites.count);
            expect(new Set(counts).size, species).toBe(3);
            expect(mean(counts), species).toBeLessThanOrEqual(MAX_SITES);
        }
    });

    it('refuses a tree written for another schema or missing a primitive', async () => {
        const stale = await parseGlb('larch-grove-c.glb');
        stale.scene.userData.schemaVersion = GRAINFIELDS_ASSET_SCHEMA + 1;
        const other = GRAINFIELDS_ASSET_SCHEMA + 1;
        expect(() => parseGrainfieldsTree(stale, 'larch-grove-c')).toThrow(
            `[Grainfields] Tree "larch-grove-c" has asset schema ${other}; expected ${GRAINFIELDS_ASSET_SCHEMA}.`,
        );
        const untagged = await parseGlb('larch-grove-c.glb');
        untagged.scene.userData = {};
        expect(() => parseGrainfieldsTree(untagged, 'bare')).toThrow('has asset schema undefined');
        const parts = ['sites', 'bark'];
        const copies = await Promise.all(parts.map(() => parseGlb('larch-grove-c.glb')));
        parts.forEach((missing, index) => {
            const broken = copies[index];
            broken.scene.remove(broken.scene.children.find((entry) => entry.name === missing));
            expect(() => parseGrainfieldsTree(broken, 'broken'))
                .toThrow(`[Grainfields] Asset is missing its "${missing}" primitive.`);
        });
        // The file names its own tree; the argument is only a fallback and a label for errors.
        const renamed = await parseGlb('larch-grove-c.glb');
        expect(parseGrainfieldsTree(renamed, 'whatever').name).toBe('larch-grove-c');
        const anonymous = await parseGlb('larch-grove-c.glb');
        delete anonymous.scene.userData.name;
        expect(parseGrainfieldsTree(anonymous, 'fallback').name).toBe('fallback');
    });
});

describe('Grainfields foliage pack', () => {
    it('is a compact, texture-free GLB', () => {
        const { json } = readGlb(FOLIAGE_FILE);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(GRAINFIELDS_ASSET_SCHEMA);
        expect(json.scenes[0].extras.variants).toBe(2);
        for (const node of json.nodes) {
            // parseGrainfieldsMeshes decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            expect(json.meshes[node.mesh].primitives[0].mode ?? 4).toBe(4);
        }
        expect(new Set(json.nodes.map((node) => node.name)).size).toBe(json.nodes.length);
    });

    it('has exactly the six sprays the trees wear, two variants of each kind', () => {
        const { variants, meshes } = parsed.foliage;
        expect(variants).toBe(2);
        for (const name of REQUIRED_FOLIAGE) expect(meshes[name], name).toBeDefined();
        const referenced = new Set();
        for (const tree of Object.values(parsed.trees)) {
            for (const variant of tree.sites.variant) referenced.add(`${tree.foliage}_${variant % variants}`);
        }
        expect([...referenced].sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
    });

    it.each(REQUIRED_FOLIAGE)('%s is a small, complete spray growing from its attachment point', (name) => {
        const geometry = parsed.foliage.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(20);
        // A spray is instanced tens of thousands of times across the belts.
        expect(triangles(geometry)).toBeLessThanOrEqual(120);
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

    it('builds the larch tuft of needles alone, each tuft opening toward the lit side', () => {
        for (const name of ['larch_tuft_0', 'larch_tuft_1']) {
            const { color, position } = parsed.foliage.meshes[name].attributes;
            const spurs = [];
            const tips = [];
            for (let index = 0; index < color.count; index++) {
                // No wood in a tuft spray: the branchlet it sits on is in the bark mesh.
                expect(color.getW(index)).toBeGreaterThan(0.5);
                // Red runs from the spur (0) to the needle tips (1).
                if (color.getX(index) < 0.05) spurs.push(position.getZ(index));
                if (color.getX(index) > 0.95) tips.push(position.getZ(index));
            }
            expect(spurs.length, name).toBeGreaterThan(20);
            expect(tips.length, name).toBe(spurs.length);
            // +Z is the lit side: the needles stand up off their spurs like a shaving brush.
            expect(mean(tips) - mean(spurs), name).toBeGreaterThan(0.05);
        }
    });

    it('refuses a pack written for another schema, naming which pack it was', async () => {
        const stale = await parseGlb(FOLIAGE_FILE);
        stale.scene.userData.schemaVersion = 0;
        expect(() => parseGrainfieldsMeshes(stale, 'Foliage'))
            .toThrow(`[Grainfields] Foliage has asset schema 0; expected ${GRAINFIELDS_ASSET_SCHEMA}.`);
        stale.scene.userData = undefined;
        expect(() => parseGrainfieldsMeshes(stale, 'Foliage')).toThrow('Foliage has asset schema undefined');
        // Children without geometry (an empty, a light) are skipped rather than keyed.
        const mixed = await parseGlb(FOLIAGE_FILE);
        const empty = new THREE.Object3D();
        empty.name = 'locator';
        mixed.scene.add(empty);
        expect(Object.keys(parseGrainfieldsMeshes(mixed, 'Foliage').meshes).sort())
            .toEqual([...REQUIRED_FOLIAGE].sort());
    });
});

describe('Grainfields far-belt sprite sheet', () => {
    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const layout = grainfieldsImpostorLayout();
        expect(Object.keys(layout).sort()).toEqual(['atlasHeight', 'atlasWidth', 'tiles']);
        const png = readAsset(IMPOSTOR_FILE);
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(layout.atlasWidth);
        expect(png.readUInt32BE(20)).toBe(layout.atlasHeight);
        expect(layout.atlasHeight).toBe(256);
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

    it('describes each tile as one of the trees, at its true proportions', () => {
        const layout = grainfieldsImpostorLayout();
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
        // Every tree has a far silhouette, each once: three of each species.
        expect(layout.tiles.map((tile) => tile.asset).sort()).toEqual([...TREE_NAMES].sort());
        for (const species of SPECIES) {
            expect(layout.tiles.filter((tile) => tile.species === species), species).toHaveLength(3);
        }
    });

    it('prepares the sheet as linear, clamped, mip-mapped data', () => {
        const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareGrainfieldsImpostors(texture)).toBe(texture);
        // It stores shading data, not colour.
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.anisotropy).toBeGreaterThan(1);
        expect(texture.name).toBe('GrainfieldsFarBeltSprites');
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });
});

describe('Grainfields horse', () => {
    it('is a compact, texture-free GLB of one quantised, skinned mesh and its skeleton', () => {
        const { json } = readGlb(HORSE_FILE);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.extensionsUsed || []).not.toContain('EXT_meshopt_compression');
        expect(json.extensionsUsed || []).not.toContain('KHR_draco_mesh_compression');
        // (Its skeleton is the theme's own, in the extras: no glTF skin, no animations.)
        for (const key of ['textures', 'images', 'materials', 'animations', 'skins']) {
            expect(json[key] ?? [], key).toHaveLength(0);
        }
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.nodes).toHaveLength(1);
        const [node] = json.nodes;
        expect(node.name).toBe('horse');
        // parseGrainfieldsHorse decodes through translation and scale only.
        expect(node.rotation).toBeUndefined();
        expect(node.matrix).toBeUndefined();
        const { primitives } = json.meshes[node.mesh];
        expect(primitives).toHaveLength(1);
        expect(primitives[0].mode ?? 4).toBe(4);
        const { attributes } = primitives[0];
        expect(Object.keys(attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', '_BONES', '_MASK', '_WEIGHTS']);
        const accessor = (semantic) => json.accessors[attributes[semantic]];
        // Positions int16, normals int8, the paint and the masks four normalised unsigned bytes.
        expect(accessor('POSITION')).toMatchObject({ componentType: 5122, normalized: true, type: 'VEC3' });
        expect(accessor('NORMAL')).toMatchObject({ componentType: 5120, normalized: true, type: 'VEC3' });
        expect(accessor('COLOR_0')).toMatchObject({ componentType: 5121, normalized: true, type: 'VEC4' });
        expect(accessor('_MASK')).toMatchObject({ componentType: 5121, normalized: true, type: 'VEC4' });
        // The skin: four bone indices (plain bytes) and their weights (normalised bytes).
        expect(accessor('_BONES')).toMatchObject({ componentType: 5121, type: 'VEC4' });
        expect(accessor('_BONES').normalized).toBeUndefined();
        expect(accessor('_WEIGHTS')).toMatchObject({ componentType: 5121, normalized: true, type: 'VEC4' });
        // Sixteen-bit indices.
        expect(json.accessors[primitives[0].indices].componentType).toBe(5123);
        const meta = json.scenes[0].extras;
        expect(meta).toMatchObject({ schemaVersion: GRAINFIELDS_ASSET_SCHEMA, name: 'grainfields-horse', bones: 38 });
        expect(meta.skeleton).toHaveLength(38);
        expect(meta.skeleton.map((bone) => bone.name)).toEqual(expect.arrayContaining([...HORSE_BONES]));
        expect(Object.keys(meta.landmarks).sort()).toEqual(['eyes', 'headForward', 'headUp', 'muzzle', 'nostrils']);
        expect(meta.triangles).toBe(json.accessors[primitives[0].indices].count / 3);
    });

    it('parses into one watertight mesh in metres: on the ground, centred, facing +z, within budget', () => {
        const { geometry } = parsed.horse;
        expect(geometry.isBufferGeometry).toBe(true);
        expect(geometry.name).toBe('horse');
        expect(Object.keys(geometry.attributes).sort()).toEqual(['_bones', '_mask', '_weights', 'color', 'normal',
            'position']);
        const { position, normal, color } = geometry.attributes;
        for (const name of ['_bones', '_mask', '_weights']) {
            expect(geometry.attributes[name].count, name).toBe(position.count);
            expect(geometry.attributes[name].itemSize, name).toBe(4);
        }
        expect(position.array).toBeInstanceOf(Float32Array);
        expect(position.normalized).toBe(false);
        expect(finite(position.array)).toBe(true);
        expect(normal.count).toBe(position.count);
        expect(color.count).toBe(position.count);
        expect(color.itemSize).toBe(4);
        const [shortest, longest] = attributeLengths(normal);
        expect(shortest).toBeGreaterThan(0.97);
        expect(longest).toBeLessThan(1.03);
        // The budget, and sixteen-bit indices.
        expect(triangles(geometry)).toBeGreaterThanOrEqual(HORSE_TRIANGLES.min);
        expect(triangles(geometry)).toBeLessThanOrEqual(HORSE_TRIANGLES.max);
        expect(position.count).toBeLessThan(65536);
        const [lowest, highest] = extent(geometry.index.array, 1, 0);
        expect([lowest, highest]).toEqual([0, position.count - 1]);
        // The hooves stand on y = 0; the body is centred on x = 0 and mirrored.
        const { min, max } = geometry.boundingBox;
        expect(min.y).toBeCloseTo(0, 4);
        expect(min.x).toBeCloseTo(-max.x, 4);
        expect(max.x).toBeGreaterThan(0.25);
        expect(max.x).toBeLessThan(0.4);
        // Ears over two metres or so; nose to tail about two and a half.
        expect(max.y).toBeGreaterThan(1.8);
        expect(max.y).toBeLessThan(2.1);
        expect(max.z - min.z).toBeGreaterThan(2.1);
        expect(max.z - min.z).toBeLessThan(2.7);
        // Closed and consistently wound: every edge has two triangles, each face turns outward
        // with its corners' normals.
        const edges = new Map();
        const index = geometry.index.array;
        const corner = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const ac = new THREE.Vector3();
        const sum = new THREE.Vector3();
        let inward = 0;
        for (let first = 0; first < index.length; first += 3) {
            const [a, b, c] = [index[first], index[first + 1], index[first + 2]];
            for (const [p, q] of [[a, b], [b, c], [c, a]]) {
                const key = Math.min(p, q) * 65536 + Math.max(p, q);
                edges.set(key, (edges.get(key) || 0) + 1);
            }
            corner.fromBufferAttribute(position, a);
            ab.fromBufferAttribute(position, b).sub(corner);
            ac.fromBufferAttribute(position, c).sub(corner);
            sum.fromBufferAttribute(normal, a).add(corner.fromBufferAttribute(normal, b))
                .add(corner.fromBufferAttribute(normal, c));
            if (ab.cross(ac).dot(sum) <= 0) inward += 1;
        }
        expect([...edges.values()].every((uses) => uses === 2)).toBe(true);
        expect(inward).toBe(0);
    });

    it('is skinned to a mirrored skeleton whose joints stand inside the horse, down each leg in order', () => {
        const { geometry, skeleton } = parsed.horse;
        const rig = createRig(skeleton);
        const head = (name) => skeleton[rig.index[name]].head;
        const { min, max } = geometry.boundingBox;
        skeleton.forEach((bone) => {
            for (let axis = 0; axis < 3; axis++) {
                expect(bone.head[axis], `${bone.name}[${axis}]`).toBeGreaterThan([min.x, min.y, min.z][axis]);
                expect(bone.head[axis], `${bone.name}[${axis}]`).toBeLessThan([max.x, max.y, max.z][axis]);
            }
            // A bone on the left has its twin on the right; one on the middle line has x = 0.
            const twin = bone.name.endsWith('L') ? `${bone.name.slice(0, -1)}R` : null;
            if (twin) expect(head(twin), twin).toEqual([-bone.head[0], bone.head[1], bone.head[2]]);
            else if (!bone.name.endsWith('R')) expect(bone.head[0], bone.name).toBe(0);
        });
        // Down each leg, each joint lower than the one above it; the hooves' coffins just over the ground.
        const fore = ['scapulaL', 'humerusL', 'forearmL', 'foreCannonL', 'forePasternL', 'foreHoofL'];
        const hind = ['femurL', 'tibiaL', 'hindCannonL', 'hindPasternL', 'hindHoofL'];
        for (const chain of [fore, hind]) {
            for (let k = 1; k < chain.length; k++) {
                expect(head(chain[k])[1], chain[k]).toBeLessThan(head(chain[k - 1])[1]);
                expect(skeleton[rig.index[chain[k]]].parent).toBe(rig.index[chain[k - 1]]);
            }
            expect(head(chain[chain.length - 1])[1]).toBeLessThan(0.08);
        }
        expect(head('scapulaL')[2]).toBeGreaterThan(0.2);
        expect(head('femurL')[2]).toBeLessThan(-0.3);
        // The neck rises from the chest to the atlas; the tail falls from the croup.
        const neck = ['neck0', 'neck1', 'neck2', 'head'];
        for (let k = 1; k < neck.length; k++) {
            expect(head(neck[k])[1]).toBeGreaterThan(head(neck[k - 1])[1]);
            expect(head(neck[k])[2]).toBeGreaterThan(head(neck[k - 1])[2]);
        }
        for (let k = 1; k < 6; k++) expect(head(`tail${k}`)[1]).toBeLessThan(head(`tail${k - 1}`)[1]);
        // The eyes are a mirrored pair on the head, the nostrils by the muzzle.
        const { landmarks } = parsed.horse;
        expect(landmarks.eyes).toHaveLength(2);
        expect(landmarks.eyes[1]).toEqual([-landmarks.eyes[0][0], landmarks.eyes[0][1], landmarks.eyes[0][2]]);
        expect(landmarks.eyes[0][1]).toBeGreaterThan(head('neck2')[1]);
        landmarks.nostrils.forEach((nostril) => {
            expect(Math.hypot(...nostril.map((v, k) => v - landmarks.muzzle[k]))).toBeLessThan(0.1);
        });
    });

    it('weighs every vertex on four bones at most, its own side\'s, rigid at the hooves and over the face', () => {
        const { geometry, skeleton, landmarks } = parsed.horse;
        const { position } = geometry.attributes;
        const skin = horseSkin(geometry);
        const names = skeleton.map((bone) => bone.name);
        const side = (name) => (/[LR]$/.test(name) ? name.slice(-1) : null);
        const wrong = [];
        let hooves = 0;
        let face = 0;
        let tips = 0;
        for (let v = 0; v < position.count; v++) {
            const { bones, weights } = skin(v);
            const total = weights.reduce((a, b) => a + b, 0);
            if (Math.abs(total - 1) > 1e-6) wrong.push(`sum ${v}`);
            if (bones.some((b) => b >= skeleton.length)) wrong.push(`bone ${v}`);
            const x = position.getX(v);
            const y = position.getY(v);
            const z = position.getZ(v);
            bones.forEach((b, k) => {
                if (weights[k] <= 0) return;
                const s = side(names[b]);
                // Nothing on one flank follows a leg or an ear of the other.
                if ((s === 'L' && x < -0.04) || (s === 'R' && x > 0.04)) wrong.push(`${names[b]} at x ${x.toFixed(2)}`);
                // Low down, only the legs and the tail's end.
                if (y < 0.3 && !/(Cannon|Pastern|Hoof)[LR]$|^tail[3-5]$/.test(names[b])) wrong.push(`${names[b]} at y ${y.toFixed(2)}`);
            });
            const heaviest = names[bones[weights.indexOf(Math.max(...weights))]];
            if (y < 0.025) {
                hooves += 1;
                if (!/Hoof[LR]$/.test(heaviest) || Math.max(...weights) < 0.9) wrong.push(`hoof ${v}`);
            }
            if (Math.hypot(x - landmarks.muzzle[0], y - landmarks.muzzle[1], z - landmarks.muzzle[2]) < 0.07) {
                face += 1;
                if (bones.some((b, k) => weights[k] > 0 && !['head', 'jaw'].includes(names[b]))) wrong.push(`muzzle ${v}`);
            }
            if (z < -0.85 && y < 0.5 && y > 0.25) {
                tips += 1;
                if (bones.some((b, k) => weights[k] > 0 && !/^tail[3-5]$/.test(names[b]))) wrong.push(`tail tip ${v}`);
            }
        }
        expect(wrong.slice(0, 10)).toEqual([]);
        expect(hooves).toBeGreaterThan(20);
        expect(face).toBeGreaterThan(5);
        expect(tips).toBeGreaterThan(10);
        // Mirrored: a vertex and its mirror image hang on mirrored bones with the same weights.
        const at = new Map();
        for (let v = 0; v < position.count; v++) {
            at.set(`${position.getX(v).toFixed(4)},${position.getY(v).toFixed(4)},${position.getZ(v).toFixed(4)}`, v);
        }
        const twin = (name) => (side(name) ? `${name.slice(0, -1)}${side(name) === 'L' ? 'R' : 'L'}` : name);
        let pairs = 0;
        for (let v = 0; v < position.count; v++) {
            const mirror = at.get(`${(-position.getX(v)).toFixed(4)},${position.getY(v).toFixed(4)},${position.getZ(v).toFixed(4)}`);
            if (mirror === undefined || mirror === v) continue;
            pairs += 1;
            const a = skin(v);
            const b = skin(mirror);
            // (Within a few bytes: each side's four heaviest bones were picked and rounded on its own.)
            const mine = new Map(a.bones.map((bone, k) => [twin(names[bone]), a.weights[k]]));
            const theirs = new Map(b.bones.map((bone, k) => [names[bone], b.weights[k]]));
            const all = new Set([...mine.keys(), ...theirs.keys()]);
            all.forEach((name) => {
                expect(Math.abs((mine.get(name) || 0) - (theirs.get(name) || 0)), `vertex ${v} ${name}`)
                    .toBeLessThanOrEqual(4.5 / 255);
            });
        }
        expect(pairs).toBeGreaterThan(position.count * 0.8);
    });

    it('bends without tearing: posed through its own skin, no edge stretches far', () => {
        const { geometry, skeleton } = parsed.horse;
        const rig = createRig(skeleton);
        const { position } = geometry.attributes;
        const skin = horseSkin(geometry);
        const index = geometry.index.array;
        const rest = Float32Array.from(position.array.slice(0, position.count * 3));
        for (let v = 0; v < position.count; v++) rest.set([position.getX(v), position.getY(v), position.getZ(v)], v * 3);
        const rows = Array.from({ length: rig.count * SKIN_ROWS }, () => ({
            x: 0, y: 0, z: 0, w: 1,
        }));
        const posed = new Float32Array(rest.length);
        for (const [label, local] of Object.entries(TEST_POSES)) {
            const pose = createPose(rig);
            Object.entries(local).forEach(([name, angles]) => pose.local.set(angles, rig.index[name] * 3));
            poseRig(rig, pose, {
                x: 0, y: 1, z: 0, heading: 0, scale: 1,
            });
            writeSkinRows(rig, pose, 1, rows);
            for (let v = 0; v < position.count; v++) {
                const { bones, weights } = skin(v);
                const p = rest.subarray(v * 3, v * 3 + 3);
                const out = [0, 0, 0];
                bones.forEach((b, k) => {
                    if (weights[k] <= 0) return;
                    const q = rows[b * SKIN_ROWS];
                    const t = rows[b * SKIN_ROWS + 1];
                    const cx = q.y * p[2] - q.z * p[1] + q.w * p[0];
                    const cy = q.z * p[0] - q.x * p[2] + q.w * p[1];
                    const cz = q.x * p[1] - q.y * p[0] + q.w * p[2];
                    out[0] += weights[k] * ((p[0] + 2 * (q.y * cz - q.z * cy)) * t.w + t.x);
                    out[1] += weights[k] * ((p[1] + 2 * (q.z * cx - q.x * cz)) * t.w + t.y);
                    out[2] += weights[k] * ((p[2] + 2 * (q.x * cy - q.y * cx)) * t.w + t.z);
                });
                posed.set(out, v * 3);
            }
            const torn = new Set();
            let stretched = 0;
            let edges = 0;
            let longest = 0;
            for (let corner = 0; corner < index.length; corner += 3) {
                for (let s = 0; s < 3; s++) {
                    const a = index[corner + s] * 3;
                    const b = index[corner + ((s + 1) % 3)] * 3;
                    const before = Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2]);
                    const after = Math.hypot(posed[a] - posed[b], posed[a + 1] - posed[b + 1], posed[a + 2] - posed[b + 2]);
                    // (Stretch: on the inside of a folded joint the skin may crowd; it must not tear.)
                    const ratio = after / before;
                    longest = Math.max(longest, after - before);
                    if (before > 0.02 && ratio > 3) torn.add(Math.min(a, b) * 65536 + Math.max(a, b));
                    if (ratio > 1.6) stretched += 1;
                    edges += 1;
                }
            }
            expect(finite(posed), label).toBe(true);
            // No edge longer by more than a hand's breadth (the throat as the head goes down to the grass),
            // hardly any of a few centimetres pulled to three times its length (only in the armpit, where
            // the inside of a reaching forearm parts from the chest), few past half as long again.
            expect(longest, label).toBeLessThan(0.12);
            expect(torn.size, label).toBeLessThanOrEqual(8);
            expect(stretched / edges, label).toBeLessThan(0.04);
        }
    });

    it('paints its hair, points, pale belly and muzzle, hooves, dark skin, the hair\'s freedom and its hollows', () => {
        const { geometry, landmarks } = parsed.horse;
        const { color, position, _mask: mask } = geometry.attributes;
        const tail = [];
        const back = [];
        const belly = [];
        const top = [];
        const under = [];
        const mane = { roots: [], tips: [] };
        let hooves = 0;
        const wrong = [];
        for (let v = 0; v < color.count; v++) {
            const [hair, points, light, ao] = [color.getX(v), color.getY(v), color.getZ(v), color.getW(v)];
            const [hoof, skinMark, free] = [mask.getX(v), mask.getY(v), mask.getZ(v)];
            const x = position.getX(v);
            const y = position.getY(v);
            const z = position.getZ(v);
            if (z < -0.92 && y < 0.9 && y > 0.3) tail.push(hair);
            if (y > 1.15 && z > -0.5 && z < 0.2) back.push(hair);
            if (Math.abs(x) < 0.12 && y < 0.75 && y > 0.6 && z > -0.4 && z < 0.2) belly.push(light);
            if (y > 1.15 && z > -0.5 && z < 0.2) top.push(ao);
            if (y < 0.75 && y > 0.6 && z > -0.4 && z < 0.2 && Math.abs(x) < 0.1) under.push(ao);
            if (y < 0.06) {
                hooves += 1;
                if (hoof < 0.9 || Math.max(hair, points) < 0.9) wrong.push(`hoof ${v}`);
            }
            // Pale only on the muzzle, round the eyes and under the barrel.
            if (light > 0.5 && y > 0.95 && z < 0.9) wrong.push(`pale back ${v}`);
            if (light > 0.01 && (hair > 0.9 || points > 0.9)) wrong.push(`pale hair ${v}`);
            if (skinMark > 0.5 && Math.hypot(x - landmarks.muzzle[0], y - landmarks.muzzle[1], z - landmarks.muzzle[2]) > 0.16) {
                wrong.push(`skin ${v}`);
            }
            if (free > hair + 0.01) wrong.push(`free coat ${v}`);
            // The mane: free at its locks' ends, held at its roots along the crest.
            if (hair > 0.9 && z > 0.3 && z < 0.9 && y > 1.2) (Math.abs(x) < 0.04 ? mane.roots : mane.tips).push(free);
        }
        expect(wrong.slice(0, 10)).toEqual([]);
        expect(hooves).toBeGreaterThan(20);
        expect(mean(tail)).toBeGreaterThan(0.9);
        expect(mean(back)).toBeLessThan(0.05);
        expect(mean(belly)).toBeGreaterThan(0.3);
        // The hollows under the barrel are darker than the back in the open.
        expect(mean(top)).toBeGreaterThan(mean(under) + 0.1);
        expect(mean(mane.tips)).toBeGreaterThan(mean(mane.roots));
    });

    it('refuses a horse written for another schema, missing its mesh, its skin or its skeleton', async () => {
        const stale = await parseGlb(HORSE_FILE);
        const other = GRAINFIELDS_ASSET_SCHEMA + 1;
        stale.scene.userData.schemaVersion = other;
        expect(() => parseGrainfieldsHorse(stale)).toThrow(
            `[Grainfields] Horse has asset schema ${other}; expected ${GRAINFIELDS_ASSET_SCHEMA}.`,
        );
        const bare = await parseGlb(HORSE_FILE);
        bare.scene.remove(bare.scene.children.find((entry) => entry.name === 'horse'));
        expect(() => parseGrainfieldsHorse(bare)).toThrow('[Grainfields] Asset is missing its "horse" primitive.');
        const skinless = await parseGlb(HORSE_FILE);
        skinless.scene.children[0].geometry.deleteAttribute('_weights');
        expect(() => parseGrainfieldsHorse(skinless)).toThrow('[Grainfields] Horse is missing its "_weights" attribute.');
        const boneless = await parseGlb(HORSE_FILE);
        delete boneless.scene.userData.skeleton;
        expect(() => parseGrainfieldsHorse(boneless)).toThrow('[Grainfields] Horse is missing its skeleton.');
        const broken = await parseGlb(HORSE_FILE);
        broken.scene.userData.skeleton[4].head = [0, Number.NaN, 1];
        expect(() => parseGrainfieldsHorse(broken)).toThrow('[Grainfields] Horse\'s bone 4 is malformed.');
        // The skeleton is a copy: changing the parsed one leaves the file's alone.
        const fresh = await parseGlb(HORSE_FILE);
        const horse = parseGrainfieldsHorse(fresh);
        horse.skeleton[1].head[1] = 99;
        expect(fresh.scene.userData.skeleton[1].head[1]).not.toBe(99);
        horse.geometry.dispose();
    });
});

describe('loading and releasing the Grainfields assets', () => {
    const packGeometries = (assets) => [...Object.values(assets.foliage.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), ...(assets.horse ? [assets.horse.geometry] : [])];

    it('loads every file once and returns the parsed bundle', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const isCurrent = vi.fn(() => true);
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadGrainfieldsAssets({ loader, textureLoader, isCurrent });
        const requested = loader.loadAsync.mock.calls.map(([url]) => url);
        expect([...requested].sort())
            .toEqual([GRAINFIELDS_FOLIAGE_URL, GRAINFIELDS_HORSE_URL, ...Object.values(GRAINFIELDS_TREE_URLS)].sort());
        expect(textureLoader.loadAsync).toHaveBeenCalledExactlyOnceWith(GRAINFIELDS_IMPOSTOR_URL);
        // Ownership is checked once, after everything has arrived.
        expect(isCurrent).toHaveBeenCalledOnce();
        expect(isCurrent.mock.invocationCallOrder[0])
            .toBeGreaterThan(Math.max(...loader.loadAsync.mock.invocationCallOrder));

        expect(Object.keys(assets).sort()).toEqual(['foliage', 'horse', 'impostors', 'trees']);
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        // The horse: a skinned geometry in metres, its skeleton and its landmarks, nothing else.
        expect(Object.keys(assets.horse).sort()).toEqual(['geometry', 'landmarks', 'skeleton']);
        expect(assets.horse.geometry.isBufferGeometry).toBe(true);
        expect(Object.keys(assets.horse.geometry.attributes).sort()).toEqual(['_bones', '_mask', '_weights', 'color',
            'normal', 'position']);
        expect(triangles(assets.horse.geometry)).toBe(triangles(parsed.horse.geometry));
        expect(assets.horse.skeleton).toEqual(parsed.horse.skeleton);
        expect(assets.horse.landmarks).toEqual(parsed.horse.landmarks);
        for (const name of TREE_NAMES) {
            expect(assets.trees[name].name).toBe(name);
            expect(assets.trees[name].sites.count).toBe(parsed.trees[name].sites.count);
            expect(triangles(assets.trees[name].bark)).toBe(triangles(parsed.trees[name].bark));
        }
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(assets.foliage.variants).toBe(parsed.foliage.variants);
        expect(assets.impostors).toEqual({ ...grainfieldsImpostorLayout(), texture: textureLoader.textures[0] });
        expect(assets.impostors.texture.name).toBe('GrainfieldsFarBeltSprites');
        expect(assets.impostors.texture.colorSpace).toBe(THREE.NoColorSpace);
        // A bundle that is handed over is intact.
        expect(disposal).not.toHaveBeenCalled();
        expect(textureLoader.disposed).toEqual([]);
        disposeGrainfieldsAssets(assets);
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
        const assets = await loadGrainfieldsAssets({ loader, textureLoader: null });
        // One for the sprays, a mesh and a points material for each tree, one for the horse.
        expect(materials.size).toBe(1 + TREE_NAMES.length * 2 + 1);
        for (const disposal of materials.values()) expect(disposal).toHaveBeenCalled();
        // The geometry the world adopts is not the loader's to throw away.
        const adopted = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        expect(packGeometries(assets).every((geometry) => geometry.attributes.position.count > 0)).toBe(true);
        expect(adopted).not.toHaveBeenCalled();
        disposeGrainfieldsAssets(assets);
        expect(adopted).toHaveBeenCalledTimes(REQUIRED_FOLIAGE.length + TREE_NAMES.length + 1);
    });

    it('disposes everything and returns null when the start that asked is no longer current', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadGrainfieldsAssets({ loader, textureLoader, isCurrent: () => false });
        expect(assets).toBeNull();
        expect(loader.loadAsync).toHaveBeenCalledTimes(TREE_NAMES.length + 2);
        const released = disposal.mock.contexts.map((geometry) => geometry.name).sort();
        expect(released).toEqual([...REQUIRED_FOLIAGE, ...TREE_NAMES.map(() => 'bark'), 'horse'].sort());
        expect(new Set(disposal.mock.contexts).size).toBe(released.length);
        expect(textureLoader.textures).toHaveLength(1);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('loads a chosen subset of trees, each once, and can skip the sprite sheet and the horse', async () => {
        const loader = diskLoader();
        const assets = await loadGrainfieldsAssets({
            trees: ['larch-grove-a', 'birch-grove-b', 'larch-grove-a'], horse: false, loader, textureLoader: null,
        });
        expect(Object.keys(assets.trees)).toEqual(['larch-grove-a', 'birch-grove-b']);
        expect(loader.loadAsync).toHaveBeenCalledTimes(3);
        expect(loader.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual(['birch-grove-b.glb', FOLIAGE_FILE, 'larch-grove-a.glb']);
        expect(assets.impostors).toBeNull();
        expect(assets.horse).toBeNull();
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        disposeGrainfieldsAssets(assets);
        // No trees at all still brings the horse.
        const herdOnly = diskLoader();
        const horseOnly = await loadGrainfieldsAssets({ trees: [], loader: herdOnly, textureLoader: null });
        expect(herdOnly.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual([FOLIAGE_FILE, HORSE_FILE]);
        expect(Object.keys(horseOnly.trees)).toEqual([]);
        expect(triangles(horseOnly.horse.geometry)).toBe(triangles(parsed.horse.geometry));
        disposeGrainfieldsAssets(horseOnly);
    });

    it('gets by without the horse when it fails to load or to parse, and keeps everything else', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failing = async (mutate) => {
            const loader = diskLoader();
            loader.loadAsync.mockImplementation(async (url) => {
                const gltf = await parseGlb(fileNameOf(url));
                if (fileNameOf(url) === HORSE_FILE) mutate(gltf);
                return gltf;
            });
            const assets = await loadGrainfieldsAssets({ loader, textureLoader: stubTextureLoader() });
            expect(assets.horse).toBeNull();
            expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
            expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
            expect(assets.impostors.texture).toBeDefined();
            disposeGrainfieldsAssets(assets);
        };
        await failing(() => { throw new Error('404 grainfields-horse.glb'); });
        expect(warn).toHaveBeenLastCalledWith(
            expect.stringContaining('[Grainfields] The horse could not be loaded'),
            expect.objectContaining({ message: '404 grainfields-horse.glb' }),
        );
        await failing((gltf) => { gltf.scene.userData.schemaVersion = GRAINFIELDS_ASSET_SCHEMA + 1; });
        expect(warn).toHaveBeenLastCalledWith(
            expect.stringContaining('[Grainfields] The horse could not be read'),
            expect.objectContaining({ message: expect.stringContaining('Horse has asset schema') }),
        );
        await failing((gltf) => { delete gltf.scene.userData.skeleton; });
        await failing((gltf) => { gltf.scene.remove(gltf.scene.children[0]); });
        expect(warn).toHaveBeenCalledTimes(4);
        // A loader that throws before it returns a promise is a failed load too.
        const abrupt = diskLoader();
        abrupt.loadAsync.mockImplementation((url) => {
            if (fileNameOf(url) === HORSE_FILE) throw new Error('offline');
            return parseGlb(fileNameOf(url));
        });
        const assets = await loadGrainfieldsAssets({ loader: abrupt, textureLoader: null });
        expect(assets.horse).toBeNull();
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        disposeGrainfieldsAssets(assets);
    });

    it('rejects an unknown tree name and a failed download', async () => {
        await expect(loadGrainfieldsAssets({
            trees: ['larch-grove-a', 'maple'], loader: diskLoader(), textureLoader: stubTextureLoader(),
        })).rejects.toThrow('[Grainfields] Unknown tree asset "maple".');
        // Summer's trees are Summer's: the fields know only their own.
        await expect(loadGrainfieldsAssets({ trees: ['spruce-hero'], loader: diskLoader(), textureLoader: null }))
            .rejects.toThrow('[Grainfields] Unknown tree asset "spruce-hero".');
        const flaky = diskLoader();
        flaky.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === 'larch-grove-b.glb') throw new Error('404 larch-grove-b.glb');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadGrainfieldsAssets({ loader: flaky, textureLoader: stubTextureLoader() }))
            .rejects.toThrow('404 larch-grove-b.glb');
        const noSprays = diskLoader();
        noSprays.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === FOLIAGE_FILE) throw new Error('404 sprays');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadGrainfieldsAssets({ loader: noSprays, textureLoader: null })).rejects.toThrow('404 sprays');
        const noSheet = stubTextureLoader();
        noSheet.loadAsync.mockRejectedValue(new Error('404 sprites'));
        await expect(loadGrainfieldsAssets({ loader: diskLoader(), textureLoader: noSheet }))
            .rejects.toThrow('404 sprites');
    });

    it('rejects a pack whose files were written for another schema', async () => {
        const stale = (file) => {
            const loader = diskLoader();
            loader.loadAsync.mockImplementation(async (url) => {
                const gltf = await parseGlb(fileNameOf(url));
                if (fileNameOf(url) === file) gltf.scene.userData.schemaVersion = GRAINFIELDS_ASSET_SCHEMA + 1;
                return gltf;
            });
            return loadGrainfieldsAssets({ loader, textureLoader: null });
        };
        const other = GRAINFIELDS_ASSET_SCHEMA + 1;
        await expect(stale('spruce-grove-c.glb')).rejects.toThrow(
            `[Grainfields] Tree "spruce-grove-c" has asset schema ${other}; expected ${GRAINFIELDS_ASSET_SCHEMA}.`,
        );
        await expect(stale(FOLIAGE_FILE)).rejects.toThrow(
            `[Grainfields] Foliage has asset schema ${other}; expected ${GRAINFIELDS_ASSET_SCHEMA}.`,
        );
    });

    it('releases each geometry and the sprite sheet exactly once', async () => {
        const textureLoader = stubTextureLoader();
        const assets = await loadGrainfieldsAssets({ loader: diskLoader(), textureLoader });
        const geometries = packGeometries(assets);
        expect(new Set(geometries).size).toBe(REQUIRED_FOLIAGE.length + TREE_NAMES.length + 1);
        const disposals = [...geometries, assets.impostors.texture].map((resource) => vi.spyOn(resource, 'dispose'));
        disposeGrainfieldsAssets(assets);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('tolerates missing and partial bundles', () => {
        const bark = { dispose: vi.fn() };
        const spray = { dispose: vi.fn() };
        const texture = { dispose: vi.fn() };
        const horse = { dispose: vi.fn() };
        for (const assets of [null, undefined, false, 0, {}, {
            foliage: null, trees: null, impostors: null, horse: null,
        }, { foliage: {} }, { foliage: { meshes: {} } }, { trees: {} }, { trees: { sapling: {} } },
        { trees: { sapling: { bark: null } } }, { impostors: {} }, { impostors: { texture: null } }, { horse: {} },
        { horse: { geometry: null, pivots: {} } }]) {
            expect(() => disposeGrainfieldsAssets(assets)).not.toThrow();
        }
        disposeGrainfieldsAssets({ trees: { sapling: { bark } } });
        disposeGrainfieldsAssets({ foliage: { meshes: { spray } } });
        disposeGrainfieldsAssets({ impostors: { texture } });
        disposeGrainfieldsAssets({ horse: { geometry: horse, pivots: {} } });
        for (const resource of [bark, spray, texture, horse]) expect(resource.dispose).toHaveBeenCalledOnce();
    });
});
