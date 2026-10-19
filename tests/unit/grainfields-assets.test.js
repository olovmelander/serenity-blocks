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
    GRAINFIELDS_ASSET_SCHEMA, GRAINFIELDS_FOLIAGE_URL, GRAINFIELDS_HORSE_PARTS, GRAINFIELDS_HORSE_URL,
    GRAINFIELDS_IMPOSTOR_URL, GRAINFIELDS_TREE_URLS, disposeGrainfieldsAssets, grainfieldsImpostorLayout,
    loadGrainfieldsAssets, parseGrainfieldsHorse, parseGrainfieldsMeshes, parseGrainfieldsTree,
    prepareGrainfieldsImpostors,
} from '../../src/themes/grainfields/grainfields-assets.js';

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
// sprite sheet 489 KB and the horse 72 KB), so it cannot balloon without someone raising a
// number on purpose.
const BUDGET = Object.freeze({
    packBytes: 2.5 * MB, treeBytes: 260 * KB, impostorBytes: 700 * KB, horseBytes: 250 * KB,
});
// The herd's horse is one mesh drawn a handful of times sixty metres out.
const HORSE_TRIANGLES = Object.freeze({ min: 3000, max: 6000 });
const HORSE_ROOT_PIVOTS = ['frontLeft', 'frontRight', 'hindLeft', 'hindRight', 'neck', 'tail'];
const HORSE_JOINT_PIVOTS = ['ear', 'frontFetlock', 'hindFetlock', 'hock', 'knee', 'poll'];
const HORSE_PIVOT_NAMES = [...HORSE_ROOT_PIVOTS, ...HORSE_JOINT_PIVOTS].sort();
const LEGS = ['frontLeft', 'frontRight', 'hindLeft', 'hindRight'];
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

/** The horse's manifest record. */
function horseRecord() {
    return readManifest().assets.find((entry) => entry.kind === 'horse');
}

/**
 * Each vertex's part id, decoded from the red channel the way a vertex stage would (`raw`), and
 * the part it mostly moves with (`parts`): the band of skin round a part whose weight on the part's
 * root joint is under a half stays mostly with the trunk, so it counts as the body's.
 */
function horseParts(geometry, partScale = horseRecord().partScale) {
    const { color, _rig: rig } = geometry.attributes;
    const raw = new Uint8Array(color.count);
    const parts = new Uint8Array(color.count);
    let worst = 0;
    for (let index = 0; index < color.count; index++) {
        const scaled = color.getX(index) * partScale;
        raw[index] = Math.round(scaled);
        parts[index] = rig && rig.getX(index) < 0.5 ? GRAINFIELDS_HORSE_PARTS.body : raw[index];
        worst = Math.max(worst, Math.abs(scaled - raw[index]));
    }
    return { parts, raw, worst };
}

/** Bounds, centroid and vertex count of each part, keyed by part id. */
function partStats(geometry, parts) {
    const { position } = geometry.attributes;
    const stats = new Map();
    for (let index = 0; index < position.count; index++) {
        const point = [position.getX(index), position.getY(index), position.getZ(index)];
        if (!stats.has(parts[index])) {
            stats.set(parts[index], {
                count: 0, min: [...point], max: [...point], sum: [0, 0, 0],
            });
        }
        const entry = stats.get(parts[index]);
        entry.count += 1;
        for (let axis = 0; axis < 3; axis++) {
            entry.min[axis] = Math.min(entry.min[axis], point[axis]);
            entry.max[axis] = Math.max(entry.max[axis], point[axis]);
            entry.sum[axis] += point[axis];
        }
    }
    for (const entry of stats.values()) entry.centre = entry.sum.map((value) => value / entry.count);
    return stats;
}

/** How many connected regions the vertices of each part form over the triangle edges. */
function partRegions(geometry, parts) {
    const parent = Array.from({ length: parts.length }, (_, index) => index);
    const find = (vertex) => {
        let root = vertex;
        while (parent[root] !== root) root = parent[root];
        return root;
    };
    const index = geometry.index.array;
    for (let corner = 0; corner < index.length; corner += 3) {
        for (let side = 0; side < 3; side++) {
            const a = index[corner + side];
            const b = index[corner + ((side + 1) % 3)];
            if (parts[a] === parts[b]) parent[find(a)] = find(b);
        }
    }
    const regions = new Map();
    for (let vertex = 0; vertex < parts.length; vertex++) {
        if (!regions.has(parts[vertex])) regions.set(parts[vertex], new Set());
        regions.get(parts[vertex]).add(find(vertex));
    }
    return new Map([...regions].map(([part, roots]) => [part, roots.size]));
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
                const { geometry, pivots } = parsed.horse;
                expect(entry).toMatchObject({ name: 'grainfields-horse', partScale: 8 });
                expect(entry.triangles).toBe(triangles(geometry));
                expect(entry.vertices).toBe(geometry.attributes.position.count);
                expect(entry.parts).toEqual(GRAINFIELDS_HORSE_PARTS);
                // The record and the file carry the same pivots.
                expect(entry.pivots).toEqual(pivots);
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
    it('is a compact, texture-free GLB of one quantised mesh: position, normal, colour and skin weights', () => {
        const { json } = readGlb(HORSE_FILE);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.extensionsUsed || []).not.toContain('EXT_meshopt_compression');
        expect(json.extensionsUsed || []).not.toContain('KHR_draco_mesh_compression');
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
        expect(Object.keys(attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', '_RIG']);
        const accessor = (semantic) => json.accessors[attributes[semantic]];
        // Positions int16, normals int8, colour four normalised unsigned bytes.
        expect(accessor('POSITION')).toMatchObject({ componentType: 5122, normalized: true, type: 'VEC3' });
        expect(accessor('NORMAL')).toMatchObject({ componentType: 5120, normalized: true, type: 'VEC3' });
        expect(accessor('COLOR_0')).toMatchObject({ componentType: 5121, normalized: true, type: 'VEC4' });
        // The skin's weights, four normalised unsigned bytes too.
        expect(accessor('_RIG')).toMatchObject({ componentType: 5121, normalized: true, type: 'VEC4' });
        // Sixteen-bit indices.
        expect(json.accessors[primitives[0].indices].componentType).toBe(5123);
        const meta = json.scenes[0].extras;
        expect(meta).toMatchObject({
            schemaVersion: GRAINFIELDS_ASSET_SCHEMA, name: 'grainfields-horse', partScale: 8,
        });
        expect(meta.parts).toEqual(GRAINFIELDS_HORSE_PARTS);
        expect(Object.keys(meta.pivots).sort()).toEqual(HORSE_PIVOT_NAMES);
        expect(meta.triangles).toBe(json.accessors[primitives[0].indices].count / 3);
    });

    it('parses into one watertight mesh in metres: on the ground, centred, facing +z, within budget', () => {
        const { geometry } = parsed.horse;
        expect(geometry.isBufferGeometry).toBe(true);
        expect(geometry.name).toBe('horse');
        expect(Object.keys(geometry.attributes).sort()).toEqual(['_rig', 'color', 'normal', 'position']);
        const { position, normal, color } = geometry.attributes;
        expect(geometry.attributes._rig.count).toBe(position.count);
        expect(geometry.attributes._rig.itemSize).toBe(4);
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

    it('tags every vertex with one of the seven parts, each where it belongs', () => {
        const { geometry } = parsed.horse;
        const { parts, raw, worst } = horseParts(geometry);
        // The red channel encodes whole part ids.
        expect(worst).toBeLessThan(0.02);
        const ids = GRAINFIELDS_HORSE_PARTS;
        expect([...new Set(raw)].sort()).toEqual(Object.values(ids).sort());
        expect([...new Set(parts)].sort()).toEqual(Object.values(ids).sort());
        const stats = partStats(geometry, parts);
        const body = stats.get(ids.body);
        const neck = stats.get(ids.neck);
        const tail = stats.get(ids.tail);
        for (const [id, entry] of stats) expect(entry.count, `part ${id}`).toBeGreaterThan(50);
        // The withers stand about 1.35 m; the trunk is a stocky pony's, 1.4 to 2 m long.
        expect(body.max[1]).toBeGreaterThan(1.3);
        expect(body.max[1]).toBeLessThan(1.4);
        expect(body.max[2] - body.min[2]).toBeGreaterThan(1.4);
        expect(body.max[2] - body.min[2]).toBeLessThan(2.05);
        // The deep barrel: the belly well under the half-way mark of the withers.
        expect(body.min[1]).toBeLessThan(0.7);
        // The neck and head reach forward and up, beyond the chest and above the back.
        expect(neck.max[2]).toBeGreaterThan(body.max[2] + 0.4);
        expect(neck.max[1]).toBeGreaterThan(body.max[1] + 0.4);
        expect(neck.centre[2]).toBeGreaterThan(body.max[2]);
        expect(neck.centre[1]).toBeGreaterThan(body.centre[1] + 0.3);
        // The tail falls behind the quarters, below the croup.
        expect(tail.min[2]).toBeLessThan(body.min[2]);
        expect(tail.centre[2]).toBeLessThan(body.centre[2] - 0.6);
        expect(tail.max[1]).toBeLessThan(body.max[1]);
        expect(tail.min[1]).toBeLessThan(body.min[1]);
        // The legs stand under the body, on the ground: left (+x) and right, front and hind.
        for (const name of LEGS) {
            const leg = stats.get(ids[name]);
            expect(leg.min[1], name).toBeCloseTo(0, 4);
            expect(leg.max[1], name).toBeLessThan(body.centre[1]);
            expect(leg.centre[1], name).toBeLessThan(body.min[1]);
            if (name.endsWith('Left')) expect(leg.min[0], name).toBeGreaterThan(0);
            else expect(leg.max[0], name).toBeLessThan(0);
            if (name.startsWith('front')) {
                expect(leg.centre[2], name).toBeGreaterThan(0.2);
                expect(leg.centre[2], name).toBeLessThan(body.max[2]);
            } else {
                expect(leg.centre[2], name).toBeLessThan(-0.2);
                expect(leg.centre[2], name).toBeGreaterThan(body.min[2]);
            }
        }
        // Mirrored: the right legs are the left ones reflected.
        expect(stats.get(ids.frontRight).count).toBe(stats.get(ids.frontLeft).count);
        expect(stats.get(ids.hindRight).count).toBe(stats.get(ids.hindLeft).count);
        expect(stats.get(ids.frontRight).min[0]).toBeCloseTo(-stats.get(ids.frontLeft).max[0], 4);
    });

    it('keeps each part one clean, connected region', () => {
        const { geometry } = parsed.horse;
        const { parts } = horseParts(geometry);
        const regions = partRegions(geometry, parts);
        for (const [name, id] of Object.entries(GRAINFIELDS_HORSE_PARTS)) expect(regions.get(id), name).toBe(1);
    });

    it('paints a soft dark mask on the hair and the points, a light one on the muzzle and belly', () => {
        const { geometry } = parsed.horse;
        const { parts, raw } = horseParts(geometry);
        const { color, position } = geometry.attributes;
        const ids = GRAINFIELDS_HORSE_PARTS;
        const dark = (index) => color.getY(index);
        const light = (index) => color.getZ(index);
        const tail = [];
        const back = [];
        const neckDark = [];
        let soft = 0;
        let hooves = 0;
        let forward = -Infinity;
        for (let index = 0; index < color.count; index++) {
            // Alpha is 1 everywhere.
            expect(color.getW(index)).toBe(1);
            const y = position.getY(index);
            if (parts[index] === ids.tail) tail.push(dark(index));
            // (The back proper: behind the withers' mane, before the dock.)
            const z = position.getZ(index);
            if (raw[index] === ids.body && y > 0.9 && z > -0.5 && z < 0.2) back.push(dark(index));
            if (parts[index] === ids.neck) neckDark.push(dark(index) > 0.9 ? 1 : 0);
            if (dark(index) > 0.1 && dark(index) < 0.9) soft += 1;
            if (y < 0.1) {
                // The hooves and pasterns are dark.
                expect(dark(index)).toBeGreaterThan(0.9);
                hooves += 1;
            }
            // Nothing is both dark and light.
            expect(light(index)).toBeLessThanOrEqual(1 - dark(index) + 0.01);
            // Light only on the muzzle and the belly, never on the back.
            if (light(index) > 0.5) {
                const muzzle = parts[index] === ids.neck && position.getZ(index) > 1.2;
                const belly = parts[index] === ids.body && y < 0.9;
                expect(muzzle || belly, `light vertex ${index}`).toBe(true);
            }
            if (parts[index] === ids.neck) forward = Math.max(forward, position.getZ(index));
        }
        expect(hooves).toBeGreaterThan(20);
        // The tail is hair; the coat over the barrel and back is not.
        expect(mean(tail)).toBeGreaterThan(0.9);
        expect(mean(back)).toBeLessThan(0.05);
        // The neck carries a heavy mane and a forelock, but most of it is coat.
        expect(mean(neckDark)).toBeGreaterThan(0.15);
        expect(mean(neckDark)).toBeLessThan(0.6);
        // The edges are soft.
        expect(soft).toBeGreaterThan(50);
        // The lips are the palest of all.
        let lips = 0;
        let lipCount = 0;
        for (let index = 0; index < color.count; index++) {
            if (parts[index] === ids.neck && position.getZ(index) > forward - 0.05) {
                lips += light(index);
                lipCount += 1;
            }
        }
        expect(lipCount).toBeGreaterThan(3);
        expect(lips / lipCount).toBeGreaterThan(0.6);
        // The belly is pale underneath.
        let belly = 0;
        for (let index = 0; index < color.count; index++) {
            if (parts[index] === ids.body && light(index) > 0.5) belly += 1;
        }
        expect(belly).toBeGreaterThan(20);
    });

    it('sets every pivot inside the body, at its own joint', () => {
        const { geometry, pivots } = parsed.horse;
        expect(Object.keys(pivots).sort()).toEqual(HORSE_PIVOT_NAMES);
        const { parts } = horseParts(geometry);
        const stats = partStats(geometry, parts);
        const ids = GRAINFIELDS_HORSE_PARTS;
        const body = stats.get(ids.body);
        for (const name of HORSE_ROOT_PIVOTS) {
            const pivot = pivots[name];
            expect(pivot, name).toHaveLength(3);
            expect(pivot.every(Number.isFinite), name).toBe(true);
            for (let axis = 0; axis < 3; axis++) {
                expect(pivot[axis], `${name}[${axis}]`).toBeGreaterThan(body.min[axis]);
                expect(pivot[axis], `${name}[${axis}]`).toBeLessThan(body.max[axis]);
            }
        }
        // The neck turns at its base, in front of the shoulders and high in the chest, behind
        // everything of the neck and head.
        const neck = stats.get(ids.neck);
        expect(pivots.neck[0]).toBe(0);
        expect(pivots.neck[1]).toBeGreaterThan(1.0);
        expect(pivots.neck[2]).toBeGreaterThan(pivots.frontLeft[2]);
        expect(pivots.neck[2]).toBeLessThan(neck.centre[2]);
        expect(pivots.neck[1]).toBeLessThan(neck.centre[1]);
        // Each leg turns above itself, at the shoulder or hip on its own side.
        for (const name of LEGS) {
            const leg = stats.get(ids[name]);
            const pivot = pivots[name];
            expect(pivot[1], name).toBeGreaterThan(leg.max[1]);
            expect(Math.sign(pivot[0]), name).toBe(name.endsWith('Left') ? 1 : -1);
            expect(pivot[0], name).toBeGreaterThan(leg.min[0] - 0.05);
            expect(pivot[0], name).toBeLessThan(leg.max[0] + 0.05);
            expect(pivot[2], name).toBeGreaterThan(leg.min[2] - 0.15);
            expect(pivot[2], name).toBeLessThan(leg.max[2] + 0.15);
        }
        expect(pivots.frontRight).toEqual([-pivots.frontLeft[0], pivots.frontLeft[1], pivots.frontLeft[2]]);
        expect(pivots.hindRight).toEqual([-pivots.hindLeft[0], pivots.hindLeft[1], pivots.hindLeft[2]]);
        // The tail turns at the root of the dock, at the top of the tail.
        const tail = stats.get(ids.tail);
        expect(pivots.tail[0]).toBe(0);
        expect(pivots.tail[2]).toBeLessThan(pivots.hindLeft[2]);
        expect(pivots.tail[2]).toBeGreaterThan(tail.min[2]);
        expect(pivots.tail[1]).toBeGreaterThan(tail.max[1] - 0.15);
        // The joints down the left legs, inside their legs, in order down them: the knee and the
        // hock, then the fetlocks just over the hooves.
        for (const name of HORSE_JOINT_PIVOTS) {
            expect(pivots[name], name).toHaveLength(3);
            expect(pivots[name].every(Number.isFinite), name).toBe(true);
        }
        const front = stats.get(ids.frontLeft);
        const hind = stats.get(ids.hindLeft);
        for (const [joint, leg, root] of [['knee', front, 'frontLeft'], ['frontFetlock', front, 'frontLeft'],
            ['hock', hind, 'hindLeft'], ['hindFetlock', hind, 'hindLeft']]) {
            const pivot = pivots[joint];
            for (let axis = 0; axis < 3; axis++) {
                expect(pivot[axis], `${joint}[${axis}]`).toBeGreaterThan(leg.min[axis] - 0.02);
                expect(pivot[axis], `${joint}[${axis}]`).toBeLessThan(leg.max[axis] + 0.02);
            }
            expect(pivot[1], joint).toBeLessThan(pivots[root][1]);
        }
        expect(pivots.knee[1]).toBeGreaterThan(pivots.frontFetlock[1] + 0.2);
        expect(pivots.hock[1]).toBeGreaterThan(pivots.hindFetlock[1] + 0.2);
        expect(pivots.frontFetlock[1]).toBeLessThan(0.2);
        // The head nods at the atlas, high in the neck, far up and forward of the neck's base; the
        // ears sit on top of the head.
        expect(pivots.poll[0]).toBe(0);
        expect(pivots.poll[1]).toBeGreaterThan(pivots.neck[1] + 0.4);
        expect(pivots.poll[2]).toBeGreaterThan(pivots.neck[2] + 0.3);
        expect(pivots.poll[1]).toBeLessThan(neck.max[1]);
        expect(pivots.ear[1]).toBeGreaterThan(pivots.poll[1]);
        expect(pivots.ear[0]).toBeGreaterThan(0);
    });

    it('carries skin weights that fold each limb at its joints and never tear it from the trunk', () => {
        const { geometry } = parsed.horse;
        const { raw } = horseParts(geometry);
        const ids = GRAINFIELDS_HORSE_PARTS;
        const { _rig: rig, position } = geometry.attributes;
        const legs = new Set(LEGS.map((name) => ids[name]));
        let hooves = 0;
        let muzzle = 0;
        let ears = 0;
        const wrong = [];
        for (let index = 0; index < rig.count; index++) {
            const w = [rig.getX(index), rig.getY(index), rig.getZ(index), rig.getW(index)];
            if (w.some((value) => !(value >= 0 && value <= 1))) wrong.push(`range ${index}`);
            const y = position.getY(index);
            // The trunk moves only as the body does.
            if (raw[index] === ids.body && w.some((value) => value !== 0)) wrong.push(`body ${index}`);
            if (legs.has(raw[index])) {
                // A leg's lower joints only below them; at the hoof the whole leg folds.
                if (w[1] > w[0] + 1e-6 || w[2] > w[1] + 1e-6) wrong.push(`leg order ${index}`);
                if (y > 0.6 && w[1] !== 0) wrong.push(`knee high ${index}`);
                if (y < 0.06) {
                    if (w[0] !== 1 || w[1] !== 1 || w[2] !== 1 || w[3] !== 0) wrong.push(`hoof ${index}`);
                    hooves += 1;
                }
            }
            if (raw[index] === ids.neck && position.getZ(index) > 1.3) {
                // The muzzle nods with the head, at the top of the neck.
                if (w[1] !== 1 || w[2] !== 1) wrong.push(`muzzle ${index}`);
                muzzle += 1;
            }
            if (raw[index] === ids.neck && w[3] > 0.99) ears += 1;
            if (raw[index] === ids.tail && y < 0.6 && w[0] !== 1) wrong.push(`tail ${index}`);
        }
        expect(wrong.slice(0, 10)).toEqual([]);
        expect(hooves).toBeGreaterThan(20);
        expect(muzzle).toBeGreaterThan(20);
        expect(ears).toBeGreaterThan(10);
        // Down the tail its weight grows; up the neck too.
        const along = (part, channel, from, to) => {
            let sum = 0;
            let count = 0;
            for (let index = 0; index < rig.count; index++) {
                const y = position.getY(index);
                if (raw[index] === part && y >= from && y < to) {
                    sum += channel(index);
                    count += 1;
                }
            }
            return sum / Math.max(1, count);
        };
        expect(along(ids.tail, (i) => rig.getY(i), 0.3, 0.6)).toBeGreaterThan(along(ids.tail, (i) => rig.getY(i), 0.8, 1.1));
        expect(along(ids.neck, (i) => rig.getZ(i), 1.5, 1.7)).toBeGreaterThan(along(ids.neck, (i) => rig.getZ(i), 1.05, 1.25));
        // No tear: where two parts meet along an edge, whatever moves away from the trunk there
        // barely moves (its weight on its part's root joint has faded out).
        const index = geometry.index.array;
        let seams = 0;
        let worst = 0;
        for (let corner = 0; corner < index.length; corner += 3) {
            for (let side = 0; side < 3; side++) {
                const a = index[corner + side];
                const b = index[corner + ((side + 1) % 3)];
                if (raw[a] === raw[b]) continue;
                seams += 1;
                if (raw[a] !== ids.body) worst = Math.max(worst, rig.getX(a));
                if (raw[b] !== ids.body) worst = Math.max(worst, rig.getX(b));
            }
        }
        expect(seams).toBeGreaterThan(30);
        // (A fifth of a joint's turn across one edge stretches the skin a centimetre or two.)
        expect(worst).toBeLessThan(0.2);
    });

    it('refuses a horse written for another schema, missing its mesh or a pivot', async () => {
        const stale = await parseGlb(HORSE_FILE);
        const other = GRAINFIELDS_ASSET_SCHEMA + 1;
        stale.scene.userData.schemaVersion = other;
        expect(() => parseGrainfieldsHorse(stale)).toThrow(
            `[Grainfields] Horse has asset schema ${other}; expected ${GRAINFIELDS_ASSET_SCHEMA}.`,
        );
        const bare = await parseGlb(HORSE_FILE);
        bare.scene.remove(bare.scene.children.find((entry) => entry.name === 'horse'));
        expect(() => parseGrainfieldsHorse(bare)).toThrow('[Grainfields] Asset is missing its "horse" primitive.');
        const lame = await parseGlb(HORSE_FILE);
        delete lame.scene.userData.pivots.hindRight;
        expect(() => parseGrainfieldsHorse(lame)).toThrow('[Grainfields] Horse is missing its "hindRight" pivot.');
        const bent = await parseGlb(HORSE_FILE);
        bent.scene.userData.pivots.neck = [0, Number.NaN, 1];
        expect(() => parseGrainfieldsHorse(bent)).toThrow('[Grainfields] Horse is missing its "neck" pivot.');
        // Pivots are copies: changing the parsed ones leaves the file's alone.
        const fresh = await parseGlb(HORSE_FILE);
        const horse = parseGrainfieldsHorse(fresh);
        horse.pivots.tail[1] = 99;
        expect(fresh.scene.userData.pivots.tail[1]).not.toBe(99);
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
        // The horse: a geometry in metres and its pivots, nothing else.
        expect(Object.keys(assets.horse).sort()).toEqual(['geometry', 'pivots']);
        expect(assets.horse.geometry.isBufferGeometry).toBe(true);
        expect(Object.keys(assets.horse.geometry.attributes).sort()).toEqual(['_rig', 'color', 'normal', 'position']);
        expect(triangles(assets.horse.geometry)).toBe(triangles(parsed.horse.geometry));
        expect(assets.horse.pivots).toEqual(parsed.horse.pivots);
        expect(assets.horse.pivots).toEqual(horseRecord().pivots);
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
        await failing((gltf) => { delete gltf.scene.userData.pivots.tail; });
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
