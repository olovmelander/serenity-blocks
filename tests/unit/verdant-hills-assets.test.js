import { createHash } from 'node:crypto';
import {
    existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    VERDANT_HILLS_ASSET_SCHEMA, VERDANT_HILLS_FOLIAGE_URL, VERDANT_HILLS_IMPOSTOR_URL, VERDANT_HILLS_MATERIALS,
    VERDANT_HILLS_MATERIAL_STEPS, VERDANT_HILLS_PROPS_URL, VERDANT_HILLS_TREE_URLS, disposeVerdantHillsAssets,
    loadVerdantHillsAssets, parseVerdantHillsMeshes, parseVerdantHillsTree, prepareVerdantHillsImpostors,
    verdantHillsImpostorLayout, verdantHillsPropRecord, verdantHillsTreeRecord,
} from '../../src/themes/verdant-hills/verdant-hills-assets.js';

const assetDirectory = new URL('../../src/themes/verdant-hills/assets/', import.meta.url);
const KB = 1000;
const MB = 1000 * KB;
const TREE_NAMES = Object.keys(VERDANT_HILLS_TREE_URLS);
const FIELD_TREES = ['oak-field-a', 'oak-field-b', 'oak-field-c'];
// The spray each tree wears: the old oak the finely modelled one, the field trees the light one.
const FOLIAGE_OF = Object.freeze({
    'oak-hero': 'oak_spray',
    'oak-field-a': 'oak_tuft',
    'oak-field-b': 'oak_tuft',
    'oak-field-c': 'oak_tuft',
});
// Every spray the trees ask the foliage pack for: two variants of each kind.
const REQUIRED_FOLIAGE = ['oak_spray_0', 'oak_spray_1', 'oak_tuft_0', 'oak_tuft_1'];
const REQUIRED_PROPS = ['windmill', 'windmill_sails', 'wall', 'wall_head', 'gate', 'bench', 'boulder_a', 'boulder_b',
    'boulder_c', 'sheep_a', 'sheep_b', 'post'];
const FOLIAGE_FILE = 'verdant-foliage.glb';
const PROPS_FILE = 'verdant-props.glb';
const IMPOSTOR_FILE = 'verdant-impostors.png';
// The seven files of the pack.
const PACK_FILES = [...TREE_NAMES.map((name) => `${name}.glb`), FOLIAGE_FILE, PROPS_FILE, IMPOSTOR_FILE];
// Not the pack's, but kept in the same folder: the valley's baked land map and the sky's baked
// cloud field, each with its record (scripts/verdant-hills/bake-land.mjs writes all four).
const BAKED_PICTURES = Object.freeze(['verdant-land.png', 'verdant-clouds.png']);
const BAKED_FILES = Object.freeze([...BAKED_PICTURES, 'verdant-land.json', 'verdant-clouds.json']);

// What the pack may weigh, so it cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({ packBytes: 4 * MB, heroBytes: 820 * KB, propsBytes: 450 * KB });

// What each prop is made of, in the names of VERDANT_HILLS_MATERIALS (which are the generator's own).
const PROP_MATERIALS = Object.freeze({
    windmill: ['timber', 'limewash', 'white', 'tar', 'stone', 'glass', 'door', 'iron'],
    windmill_sails: ['timber', 'canvas', 'iron'],
    wall: ['stone'],
    wall_head: ['stone'],
    gate: ['timber', 'stone', 'iron'],
    bench: ['timber'],
    boulder_a: ['stone'],
    boulder_b: ['stone'],
    boulder_c: ['stone'],
    sheep_a: ['wool', 'skin'],
    sheep_b: ['wool', 'skin'],
    post: ['timber'],
});
// The named points the brief asks for, prop by prop.
const PROP_ANCHORS = Object.freeze({
    windmill: ['hub', 'axis', 'door', 'capTop'],
    gate: ['hinge', 'latch', 'postLeft', 'postRight'],
    post: ['top'],
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
 * What a prop's vertices say they are made of, read the way a paint shader reads it: the
 * code is the green channel times sixteen, rounded. `worst` is how far any vertex is from a
 * whole code; `indices(name)` are the vertices of one material.
 */
function paintOf(geometry) {
    const { color } = geometry.attributes;
    const codes = new Map();
    let worst = 0;
    for (let index = 0; index < color.count; index++) {
        const raw = color.getY(index) * VERDANT_HILLS_MATERIAL_STEPS;
        const code = Math.round(raw);
        worst = Math.max(worst, Math.abs(raw - code));
        if (!codes.has(code)) codes.set(code, []);
        codes.get(code).push(index);
    }
    const indices = (material) => codes.get(VERDANT_HILLS_MATERIALS[material]) || [];
    return { codes, worst, indices };
}

/** The box round the vertices of one material of a prop. */
function boxOf(geometry, material) {
    const { position } = geometry.attributes;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const index of paintOf(geometry).indices(material)) {
        box.expandByPoint(point.fromBufferAttribute(position, index));
    }
    return box;
}

/** A loader that serves the real files from disk instead of fetching them. */
function diskLoader() {
    return { loadAsync: vi.fn(async (url) => parseGlb(fileNameOf(url))) };
}

/**
 * Hands out tiny data textures and records which of them are disposed. `sprites` are the
 * ones it handed out for the sprite sheet. The loader also asks it for the valley's baked
 * land map and the sky's baked cloud field, which a two-by-two stand-in cannot be: the
 * loader then goes without each, with a warning for each.
 */
function stubTextureLoader() {
    const textures = [];
    const sprites = [];
    const disposed = [];
    return {
        textures,
        sprites,
        disposed,
        loadAsync: vi.fn(async (url) => {
            const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
            texture.addEventListener('dispose', () => disposed.push(texture));
            textures.push(texture);
            if (url === VERDANT_HILLS_IMPOSTOR_URL) sprites.push(texture);
            return texture;
        }),
    };
}

const parsed = { trees: {}, foliage: null, props: null };

beforeAll(async () => {
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseVerdantHillsTree(gltfs[index], name); });
    parsed.foliage = parseVerdantHillsMeshes(await parseGlb(FOLIAGE_FILE), 'Foliage');
    parsed.props = parseVerdantHillsMeshes(await parseGlb(PROPS_FILE), 'Props');
}, 60000);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Verdant Hills asset sources', () => {
    it('are strict UTF-8 with Unix line endings', () => {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        // The decoder really is strict: a lone Windows-1252 dash (0x97) is not UTF-8.
        expect(() => decoder.decode(Uint8Array.of(0x20, 0x97, 0x20))).toThrow();
        const scripts = new URL('../../scripts/blender/', import.meta.url);
        const helpers = readdirSync(new URL('verdant_hills/', scripts)).filter((file) => file.endsWith('.py'));
        expect(helpers.sort()).toEqual(['kit.py', 'leaves.py', 'mill.py', 'preview.py', 'props.py', 'species.py']);
        const files = [
            new URL('../../src/themes/verdant-hills/verdant-hills-assets.js', import.meta.url),
            new URL('verdant_hills_assets.py', scripts),
            ...helpers.map((file) => new URL(`verdant_hills/${file}`, scripts)),
            new URL('ATTRIBUTION.md', assetDirectory),
            new URL('asset-manifest.json', assetDirectory),
        ];
        for (const file of files) {
            const bytes = readFileSync(file);
            let text = null;
            expect(() => { text = decoder.decode(bytes); }, `${file} is not valid UTF-8`).not.toThrow();
            expect(text.includes('\r'), `${file} has a carriage return`).toBe(false);
            expect(text.includes('�'), `${file} has a replacement character`).toBe(false);
            expect([bytes[0], bytes[1], bytes[2]], `${file}`).not.toEqual([0xef, 0xbb, 0xbf]);
        }
    });
});

describe('Verdant Hills asset pack on disk', () => {
    it('points every URL at a file that exists in the asset directory, and ships nothing else', () => {
        expect(Object.isFrozen(VERDANT_HILLS_TREE_URLS)).toBe(true);
        expect(TREE_NAMES).toEqual(['oak-hero', ...FIELD_TREES]);
        const referenced = [];
        for (const [name, url] of Object.entries(VERDANT_HILLS_TREE_URLS)) {
            expect(fileNameOf(url)).toBe(`${name}.glb`);
            referenced.push(fileNameOf(url));
        }
        expect(fileNameOf(VERDANT_HILLS_FOLIAGE_URL)).toBe(FOLIAGE_FILE);
        expect(fileNameOf(VERDANT_HILLS_PROPS_URL)).toBe(PROPS_FILE);
        expect(fileNameOf(VERDANT_HILLS_IMPOSTOR_URL)).toBe(IMPOSTOR_FILE);
        referenced.push(FOLIAGE_FILE, PROPS_FILE, IMPOSTOR_FILE);
        expect([...referenced].sort()).toEqual([...PACK_FILES].sort());
        expect(PACK_FILES).toHaveLength(7);
        const directory = fileURLToPath(assetDirectory);
        for (const url of [...Object.values(VERDANT_HILLS_TREE_URLS), VERDANT_HILLS_FOLIAGE_URL,
            VERDANT_HILLS_PROPS_URL, VERDANT_HILLS_IMPOSTOR_URL]) {
            const file = fileNameOf(url);
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(sizeOf(file)).toBeGreaterThan(0);
            // Under Vitest the URLs are file URLs; they must land in the pack, not beside it.
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(file, assetDirectory)));
                expect(fileURLToPath(url).startsWith(directory)).toBe(true);
            }
        }
        // Nothing of the pack is loaded twice, and nothing ships that the runtime does not load:
        // no tree, prop or sprite of the scene this one replaced is left lying in the folder.
        expect(new Set(referenced).size).toBe(referenced.length);
        const present = readdirSync(assetDirectory);
        for (const file of referenced) expect(present).toContain(file);
        // All in the folder that is not the Blender pack's are the four baked files: the valley's
        // land map, the sky's cloud field and the record of each.
        expect(BAKED_FILES).toHaveLength(4);
        const shipped = present
            .filter((file) => /\.(glb|gltf|png|jpe?g|webp|ktx2|hdr|exr|bin)$/i.test(file))
            .filter((file) => !BAKED_FILES.includes(file)).sort();
        expect(shipped).toEqual([...referenced].sort());
        // Beside them only the manifest and the attribution.
        expect(present.filter((file) => !shipped.includes(file) && !BAKED_FILES.includes(file)).sort())
            .toEqual(['ATTRIBUTION.md', 'asset-manifest.json']);
        // No baked file is one of the pack's, so none is counted, hashed or budgeted as one.
        for (const file of BAKED_FILES) expect(PACK_FILES).not.toContain(file);
        // The pack's manifest vouches for the pack and for nothing else.
        expect(readManifest().assets.map((entry) => entry.file).sort()).toEqual([...referenced].sort());
        expect(readAsset(IMPOSTOR_FILE).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('keeps the pack under 4 MB, the old oak under 820 KB and the props under 450 KB', () => {
        // The Blender pack alone: its seven binaries, and its manifest and attribution beside
        // them. (The baked land map and cloud field in the same folder are not part of it, nor
        // of this budget.)
        const fetched = PACK_FILES.reduce((sum, file) => sum + sizeOf(file), 0);
        expect(PACK_FILES).toHaveLength(7);
        expect(fetched).toBeLessThanOrEqual(BUDGET.packBytes);
        expect(fetched + sizeOf('asset-manifest.json') + sizeOf('ATTRIBUTION.md'))
            .toBeLessThanOrEqual(BUDGET.packBytes);
        expect(sizeOf('oak-hero.glb')).toBeLessThanOrEqual(BUDGET.heroBytes);
        // A field tree is a fraction of the old oak.
        for (const name of FIELD_TREES) expect(sizeOf(`${name}.glb`), name).toBeLessThan(BUDGET.heroBytes / 5);
        expect(sizeOf(PROPS_FILE)).toBeLessThanOrEqual(BUDGET.propsBytes);
        // The manifest's own arithmetic agrees.
        const manifest = readManifest();
        expect(manifest.assets.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(BUDGET.packBytes);
        expect(manifest.assets.find((entry) => entry.role === 'hero').bytes).toBeLessThanOrEqual(BUDGET.heroBytes);
        expect(manifest.assets.find((entry) => entry.kind === 'props').bytes).toBeLessThanOrEqual(BUDGET.propsBytes);
    });

    // This pins the pack: regenerating it changes these hashes, and committing a new manifest
    // beside the new files is the conscious act that makes this pass again.
    it('matches every manifest entry byte for byte', () => {
        const manifest = readManifest();
        expect(manifest.schemaVersion).toBe(VERDANT_HILLS_ASSET_SCHEMA);
        expect(VERDANT_HILLS_ASSET_SCHEMA).toBe(1);
        expect(manifest.glTFUpAxis).toBe('Y');
        expect(Array.isArray(manifest.assets)).toBe(true);
        expect(manifest.assets).toHaveLength(7);
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
        const fetched = [...Object.values(VERDANT_HILLS_TREE_URLS), VERDANT_HILLS_FOLIAGE_URL, VERDANT_HILLS_PROPS_URL,
            VERDANT_HILLS_IMPOSTOR_URL].map(fileNameOf);
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
                const name = entry.file.replace(/\.glb$/, '');
                const tree = parsed.trees[name];
                expect(tree, entry.file).toBeDefined();
                expect(entry).toMatchObject({ species: tree.species, role: tree.role, height: tree.height });
                expect(entry.sites).toBe(tree.sites.count);
                expect(entry.barkTriangles).toBe(triangles(tree.bark));
                // The anchors ride in the file and in the manifest, and they agree.
                expect(entry.anchors).toEqual(tree.anchors);
                expect(verdantHillsTreeRecord(name)).toEqual(entry);
            }
            if (entry.kind === 'foliage' || entry.kind === 'props') {
                const pack = parsed[entry.kind];
                expect(Object.keys(entry.meshes).sort()).toEqual(Object.keys(pack.meshes).sort());
                for (const [name, record] of Object.entries(entry.meshes)) {
                    expect(record.triangles, name).toBe(triangles(pack.meshes[name]));
                    // The node's own record is the manifest's.
                    expect(pack.records[name], name).toEqual(record);
                }
            }
        }
        for (const unknown of ['oak', 'oak-hero.glb', '', undefined, null]) {
            expect(verdantHillsTreeRecord(unknown)).toBeNull();
        }
    });
});

describe('Verdant Hills tree assets', () => {
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
            // parseVerdantHillsTree decodes through translation and scale only.
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
        expect(meta).toMatchObject({ schemaVersion: VERDANT_HILLS_ASSET_SCHEMA, name, species: 'oak' });
        expect(['hero', 'field']).toContain(meta.role);
        expect(name.startsWith(`${meta.species}-${meta.role}`)).toBe(true);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
        expect(meta.foliage).toBe(FOLIAGE_OF[name]);
        expect(meta.scaleRange).toBe(2.5);
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        expect(tree).toMatchObject({ name, species: 'oak' });
        expect(['hero', 'field']).toContain(tree.role);
        expect(tree.height).toBeGreaterThan(9);
        expect(tree.height).toBeLessThan(16.5);
        expect(tree.trunkRadius).toBeGreaterThan(0.2);
        expect(tree.trunkRadius).toBeLessThan(tree.height / 15);
        expect(tree.crownBase).toBeGreaterThan(2);
        expect(tree.crownBase).toBeLessThan(tree.height * 0.5);
        expect(tree.crownCentre).toHaveLength(3);
        expect(tree.crownRadii).toHaveLength(3);
        expect(new THREE.Vector3(...tree.weatherSide).length()).toBeCloseTo(1, 6);

        const { bark } = tree;
        expectWellFormedMesh(bark, 'bark');
        const { position } = bark.attributes;
        const [minY, maxY] = extent(position.array, 3, 1);
        // The root flare dips into the soil.
        expect(minY).toBeLessThan(0.05);
        expect(minY).toBeGreaterThan(-1.5);
        // `height` is the top of the foliage; the wood stops just short of it.
        expect(maxY).toBeLessThanOrEqual(tree.height);
        expect(maxY).toBeGreaterThan(tree.height * 0.85);
        for (const offset of [0, 2]) {
            const [min, max] = extent(position.array, 3, offset);
            // The trunk stands on the origin.
            expect(min).toBeLessThan(-tree.trunkRadius * 0.5);
            expect(max).toBeGreaterThan(tree.trunkRadius * 0.5);
        }
        expect(bark.boundingBox.min.y).toBeCloseTo(minY, 5);
        expect(bark.boundingBox.max.y).toBeCloseTo(maxY, 5);
        expect(bark.boundingSphere.radius).toBeGreaterThan(tree.height * 0.3);
        expect(triangles(bark)).toBeGreaterThan(1500);
        // Sixteen-bit indices: a bark mesh never outgrows them.
        expect(position.count).toBeLessThanOrEqual(65536);
        // The scaffold comes first in the index buffer, so a tier can stop drawing at a
        // triangle boundary before the forks, shoots and twigs.
        expect(Number.isInteger(tree.barkCoreIndices)).toBe(true);
        expect(tree.barkCoreIndices % 3).toBe(0);
        expect(tree.barkCoreIndices).toBeGreaterThan(0);
        expect(tree.barkCoreIndices).toBeLessThan(bark.index.count);
        // The core is the tree's frame: it alone reaches most of the way up and out.
        let coreTop = -Infinity;
        for (let index = 0; index < tree.barkCoreIndices; index++) {
            coreTop = Math.max(coreTop, position.getY(bark.index.getX(index)));
        }
        expect(coreTop).toBeGreaterThan(tree.height * 0.6);
    });

    it.each(TREE_NAMES)('%s carries well-formed foliage sites on its wood', (name) => {
        const tree = parsed.trees[name];
        const { sites } = tree;
        expect(sites.count).toBeGreaterThan(150);
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
        expect(smallest).toBeGreaterThan(0.9);
        expect(largest).toBeLessThanOrEqual(2.5);
        // They sit on the wood: within reach of the bark, never above the top of the tree,
        // and none hangs into the clear space under the crown.
        const { boundingBox } = tree.bark;
        const [lowest, highest] = extent(sites.position, 3, 1);
        expect(lowest).toBeCloseTo(tree.crownBase, 2);
        expect(highest).toBeLessThanOrEqual(tree.height);
        expect(highest).toBeGreaterThan(tree.height * 0.85);
        for (const [offset, axis] of [[0, 'x'], [2, 'z']]) {
            const [min, max] = extent(sites.position, 3, offset);
            expect(min).toBeGreaterThan(boundingBox.min[axis] - 0.05);
            expect(max).toBeLessThan(boundingBox.max[axis] + 0.05);
        }
        // Each site names a spray variant the foliage pack really has.
        const { variants, meshes } = parsed.foliage;
        expect(tree.foliage).toBe(FOLIAGE_OF[name]);
        for (const variant of new Set(sites.variant)) {
            const key = `${tree.foliage}_${variant % variants}`;
            expect(meshes[key], key).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBe(variants);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it.each(TREE_NAMES)('%s stores its sites shuffled, so drawing a share of them thins the whole crown', (name) => {
        const { sites } = parsed.trees[name];
        const whole = new THREE.Box3();
        const half = new THREE.Box3();
        const point = new THREE.Vector3();
        for (let index = 0; index < sites.count; index++) {
            point.fromArray(sites.position, index * 3);
            whole.expandByPoint(point);
            if (index < sites.count / 2) half.expandByPoint(point);
        }
        const size = whole.getSize(new THREE.Vector3());
        const kept = half.getSize(new THREE.Vector3());
        for (const axis of ['x', 'y', 'z']) expect(kept[axis], axis).toBeGreaterThan(size[axis] * 0.9);
    });

    it('grows the old oak wider than it is tall, on a massive short bole', () => {
        const hero = parsed.trees['oak-hero'];
        expect(hero.role).toBe('hero');
        expect(hero.height).toBeGreaterThanOrEqual(15);
        expect(hero.height).toBeLessThanOrEqual(16);
        // A girth of five metres at breast height.
        expect(hero.trunkRadius).toBeCloseTo(0.8, 6);
        const { position } = hero.bark.attributes;
        let widest = 0;
        for (let index = 0; index < position.count; index++) {
            if (Math.abs(position.getY(index) - 1.3) < 0.2) {
                widest = Math.max(widest, Math.hypot(position.getX(index), position.getZ(index)));
            }
        }
        expect(widest).toBeGreaterThan(0.75);
        expect(widest).toBeLessThan(1.2);
        // The crown: its sites, and a spray's reach beyond them, spread 20 to 24 metres.
        const { sites } = hero;
        const reach = 0.9;
        const [west, east] = extent(sites.position, 3, 0);
        const [back, front] = extent(sites.position, 3, 2);
        for (const spread of [east - west + 2 * reach, front - back + 2 * reach]) {
            expect(spread).toBeGreaterThanOrEqual(20);
            expect(spread).toBeLessThanOrEqual(24);
            expect(spread).toBeGreaterThan(hero.height);
        }
        // 1400 to 2200 sprays on at most 32 000 triangles of bark.
        expect(sites.count).toBeGreaterThanOrEqual(1400);
        expect(sites.count).toBeLessThanOrEqual(2200);
        expect(triangles(hero.bark)).toBeLessThanOrEqual(32000);
        expect(triangles(hero.bark)).toBeGreaterThan(15000);
        // Nothing hangs lower than a rider on the swing could reach up to.
        expect(hero.crownBase).toBeGreaterThan(4);
        // The foliage stands in masses, a couple of dozen of them, each of scores of sprays.
        const { masses } = readGlb('oak-hero.glb').json.scenes[0].extras;
        expect(masses).toBeGreaterThanOrEqual(18);
        expect(masses).toBeLessThanOrEqual(28);
        expect(sites.count / masses).toBeGreaterThan(50);
        // The crown is open inside: far fewer sprays within five metres of the bole's axis
        // than an evenly filled dome would hold there.
        let inner = 0;
        for (let index = 0; index < sites.count; index++) {
            if (Math.hypot(sites.position[index * 3], sites.position[index * 3 + 2]) < 5) inner += 1;
        }
        expect(inner / sites.count).toBeLessThan(0.3);
    });

    it('reaches one long low bough out toward +X and anchors the swing under it', () => {
        const hero = parsed.trees['oak-hero'];
        const { anchors } = hero;
        expect(Object.keys(anchors).sort()).toEqual(['boughTip', 'swing', 'swingLimbRadius']);
        const swing = new THREE.Vector3(...anchors.swing);
        const tip = new THREE.Vector3(...anchors.boughTip);
        // About five metres out from the trunk, between 4.5 and 6 m up.
        expect(swing.x).toBeGreaterThan(4.6);
        expect(swing.x).toBeLessThan(5.4);
        expect(Math.abs(swing.z)).toBeLessThan(1);
        expect(swing.y).toBeGreaterThan(4.5);
        expect(swing.y).toBeLessThan(6);
        expect(tip.x).toBeGreaterThanOrEqual(9.5);
        expect(tip.y).toBeGreaterThan(4.5);
        expect(tip.y).toBeLessThan(6.1);
        // At least nine metres long.
        expect(tip.length()).toBeGreaterThan(9);
        // The wood really runs there: every half metre from the bole to the tip there is
        // bark of the scaffold, level between 4.3 and 6.5 m once it has left the bole.
        const { position } = hero.bark.attributes;
        const core = new Set();
        for (let index = 0; index < hero.barkCoreIndices; index++) core.add(hero.bark.index.getX(index));
        const stations = new Map();
        const point = new THREE.Vector3();
        let nearest = Infinity;
        let above = 0;
        let below = 0;
        for (const index of core) {
            point.fromBufferAttribute(position, index);
            nearest = Math.min(nearest, point.distanceTo(swing));
            if (Math.abs(point.z) > 1.3 || point.y < 4.2 || point.y > 6.6) continue;
            const station = Math.floor(point.x * 2);
            stations.set(station, (stations.get(station) || 0) + 1);
            if (Math.abs(point.x - swing.x) < 0.3) {
                if (point.y > swing.y + 0.05) above += 1;
                else if (point.y < swing.y - 0.05) below += 1;
            }
        }
        for (let station = 5; station < Math.floor(tip.x * 2) - 1; station++) {
            expect(stations.get(station) || 0, `no bough at x = ${station / 2}`).toBeGreaterThan(0);
        }
        // The anchor lies on the bark, and on its underside: the bough is above it, nothing of it below.
        expect(nearest).toBeLessThan(0.1);
        expect(above).toBeGreaterThan(10);
        expect(below).toBe(0);
        expect(anchors.swingLimbRadius).toBeGreaterThan(0.12);
        expect(anchors.swingLimbRadius).toBeLessThan(0.3);
        // Bare where the swing hangs, in leaf toward its end.
        const { sites } = hero;
        let atSwing = 0;
        let atTip = 0;
        for (let index = 0; index < sites.count; index++) {
            point.fromArray(sites.position, index * 3);
            if (point.distanceTo(swing) < 1.2) atSwing += 1;
            if (point.distanceTo(tip) < 2.2) atTip += 1;
        }
        expect(atSwing).toBe(0);
        expect(atTip).toBeGreaterThan(25);
        // The field trees carry no anchors.
        for (const name of FIELD_TREES) expect(parsed.trees[name].anchors).toEqual({});
    });

    it('paints moss on the weather side of the old bole and on the tops of its heavy limbs', () => {
        const hero = parsed.trees['oak-hero'];
        const { position, normal, color } = hero.bark.attributes;
        const weather = new THREE.Vector3(...hero.weatherSide);
        const point = new THREE.Vector3();
        const facing = new THREE.Vector3();
        const sums = {
            weather: [0, 0], lee: [0, 0], top: [0, 0], under: [0, 0],
        };
        // Which of two opposite groups a facing belongs to, or neither.
        const sideOf = (amount, toward, away) => {
            if (amount > toward[1]) return toward[0];
            return amount < away[1] ? away[0] : null;
        };
        let thin = 0;
        for (let index = 0; index < hero.barkCoreIndices; index++) {
            const vertex = hero.bark.index.getX(index);
            point.fromBufferAttribute(position, vertex);
            facing.fromBufferAttribute(normal, vertex).normalize();
            const moss = color.getW(vertex);
            let side = null;
            if (point.y > 0.4 && point.y < 2.4 && Math.hypot(point.x, point.z) < 1.3) {
                side = sideOf(facing.dot(weather), ['weather', 0.5], ['lee', -0.5]);
            } else if (point.y > 6) {
                side = sideOf(facing.y, ['top', 0.7], ['under', -0.7]);
            }
            if (side) {
                sums[side][0] += moss;
                sums[side][1] += 1;
            }
        }
        const mean = (key) => sums[key][0] / sums[key][1];
        for (const key of Object.keys(sums)) expect(sums[key][1], key).toBeGreaterThan(50);
        expect(mean('weather')).toBeGreaterThan(0.25);
        expect(mean('weather')).toBeGreaterThan(mean('lee') * 1.8);
        expect(mean('top')).toBeGreaterThan(0.08);
        expect(mean('under')).toBeLessThan(0.01);
        // Twigs are bare bark: the last of the index buffer is thin wood with no moss on it.
        for (let index = hero.bark.index.count - 3000; index < hero.bark.index.count; index++) {
            thin = Math.max(thin, color.getW(hero.bark.index.getX(index)));
        }
        expect(thin).toBeLessThan(0.02);
        // Wind reach (red) grows from the bole to the twigs; the bake left occlusion in blue.
        const [stillest, loosest] = extent(color.array, 4, 0, 1 / 255);
        expect(stillest).toBeLessThan(0.02);
        expect(loosest).toBeGreaterThan(0.5);
        const [darkest, lightest] = extent(color.array, 4, 2, 1 / 255);
        expect(darkest).toBeLessThan(0.5);
        expect(lightest).toBeGreaterThan(0.8);
    });

    it('grows three field trees with a clear bole and a full, round crown', () => {
        const [a, b, c] = FIELD_TREES.map((name) => parsed.trees[name]);
        expect([a.height, b.height, c.height]).toEqual([12, 9.5, 14]);
        const crown = (tree) => {
            const { sites } = tree;
            const [west, east] = extent(sites.position, 3, 0);
            const [low, high] = extent(sites.position, 3, 1);
            const [back, front] = extent(sites.position, 3, 2);
            return {
                width: east - west, depth: front - back, height: high - low, low, middle: (east + west) / 2,
            };
        };
        for (const tree of [a, b, c]) {
            expect(tree.role).toBe('field');
            expect(tree.sites.count).toBeGreaterThanOrEqual(220);
            expect(tree.sites.count).toBeLessThanOrEqual(340);
            expect(triangles(tree.bark)).toBeLessThanOrEqual(5500);
            // A clear bole: no spray below two metres, and a single stem under the crown.
            expect(tree.crownBase).toBeGreaterThan(2);
            const { position } = tree.bark.attributes;
            let stem = 0;
            for (let index = 0; index < position.count; index++) {
                if (position.getY(index) > 0.6 && position.getY(index) < tree.crownBase - 0.3) {
                    stem = Math.max(stem, Math.hypot(position.getX(index), position.getZ(index)));
                }
            }
            expect(stem).toBeLessThan(0.7);
            // Full: the sites fill the crown's plan with no bald quarter.
            const quarters = [0, 0, 0, 0];
            const shape = crown(tree);
            for (let index = 0; index < tree.sites.count; index++) {
                const east = tree.sites.position[index * 3] > shape.middle ? 1 : 0;
                const front = tree.sites.position[index * 3 + 2] > 0 ? 2 : 0;
                quarters[east + front] += 1;
            }
            for (const count of quarters) expect(count).toBeGreaterThan(tree.sites.count / 6);
        }
        // a: a near-globe on a bole clear to about 2.5 m.
        const globe = crown(a);
        expect(globe.width / globe.height).toBeGreaterThan(0.85);
        expect(globe.width / globe.height).toBeLessThan(1.15);
        expect(Math.abs(globe.middle)).toBeLessThan(0.4);
        // b: squatter, its crown blown toward +X.
        const squat = crown(b);
        expect(squat.width / squat.height).toBeGreaterThan(globe.width / globe.height + 0.15);
        expect(squat.middle).toBeGreaterThan(0.4);
        // c: a taller oval.
        const oval = crown(c);
        expect(oval.height / oval.width).toBeGreaterThan(1.25);
        expect(Math.abs(oval.middle)).toBeLessThan(0.4);
        // The old oak dwarfs them all.
        const hero = parsed.trees['oak-hero'];
        for (const tree of [a, b, c]) {
            expect(triangles(hero.bark)).toBeGreaterThan(triangles(tree.bark) * 4);
            expect(hero.sites.count).toBeGreaterThan(tree.sites.count * 4);
        }
    });

    it('refuses a tree written for another schema or missing a primitive', async () => {
        const stale = await parseGlb('oak-field-b.glb');
        stale.scene.userData.schemaVersion = VERDANT_HILLS_ASSET_SCHEMA + 1;
        const other = VERDANT_HILLS_ASSET_SCHEMA + 1;
        expect(() => parseVerdantHillsTree(stale, 'oak-field-b')).toThrow(
            `[Verdant Hills] Tree "oak-field-b" has asset schema ${other}; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`,
        );
        const untagged = await parseGlb('oak-field-b.glb');
        untagged.scene.userData = {};
        expect(() => parseVerdantHillsTree(untagged, 'bare')).toThrow('has asset schema undefined');
        const parts = ['sites', 'bark'];
        const copies = await Promise.all(parts.map(() => parseGlb('oak-field-b.glb')));
        parts.forEach((missing, index) => {
            const broken = copies[index];
            broken.scene.remove(broken.scene.children.find((entry) => entry.name === missing));
            expect(() => parseVerdantHillsTree(broken, 'broken'))
                .toThrow(`[Verdant Hills] Asset is missing its "${missing}" primitive.`);
        });
        // The file names its own tree; the argument is only a fallback and a label for errors.
        const renamed = await parseGlb('oak-field-b.glb');
        expect(parseVerdantHillsTree(renamed, 'whatever').name).toBe('oak-field-b');
        const anonymous = await parseGlb('oak-field-b.glb');
        delete anonymous.scene.userData.name;
        expect(parseVerdantHillsTree(anonymous, 'fallback').name).toBe('fallback');
        // A tree without anchors parses to an empty set of them.
        const plain = await parseGlb('oak-field-b.glb');
        delete plain.scene.userData.anchors;
        expect(parseVerdantHillsTree(plain, 'plain').anchors).toEqual({});
    });
});

describe('Verdant Hills foliage pack', () => {
    it('is a compact, texture-free GLB', () => {
        const { json } = readGlb(FOLIAGE_FILE);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(VERDANT_HILLS_ASSET_SCHEMA);
        expect(json.scenes[0].extras.variants).toBe(2);
        for (const node of json.nodes) {
            // parseVerdantHillsMeshes decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            expect(json.meshes[node.mesh].primitives[0].mode ?? 4).toBe(4);
        }
        expect(new Set(json.nodes.map((node) => node.name)).size).toBe(json.nodes.length);
    });

    it('has exactly the four sprays the trees wear, two variants of each kind', () => {
        const { variants, meshes, records } = parsed.foliage;
        expect(variants).toBe(2);
        const referenced = new Set();
        for (const tree of Object.values(parsed.trees)) {
            for (const variant of tree.sites.variant) referenced.add(`${tree.foliage}_${variant % variants}`);
        }
        expect([...referenced].sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        for (let variant = 0; variant < variants; variant++) {
            // The hero's spray: 14 to 18 lobed leaves; the field trees': 9 to 12 plainer ones.
            const spray = records[`oak_spray_${variant}`];
            const tuft = records[`oak_tuft_${variant}`];
            expect(spray.leaves).toBeGreaterThanOrEqual(14);
            expect(spray.leaves).toBeLessThanOrEqual(18);
            expect(tuft.leaves).toBeGreaterThanOrEqual(9);
            expect(tuft.leaves).toBeLessThanOrEqual(12);
            // A lobed leaf is two dozen triangles; a plain one ten.
            expect(spray.triangles / spray.leaves).toBeGreaterThan(22);
            expect(tuft.triangles / tuft.leaves).toBeLessThan(13);
            expect(triangles(meshes[`oak_spray_${variant}`]))
                .toBeGreaterThan(triangles(meshes[`oak_tuft_${variant}`]) * 3);
        }
        expect(records.oak_spray_0.leaves).toBeGreaterThan(records.oak_spray_1.leaves);
    });

    it.each(REQUIRED_FOLIAGE)('%s is a small, complete spray growing from its attachment point', (name) => {
        const geometry = parsed.foliage.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(80);
        // A spray is instanced by the thousand.
        expect(triangles(geometry)).toBeLessThanOrEqual(480);
        // Authored at about unit size, as Summer's are; instances scale them into place.
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.6);
        expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.5);
        // Sprays grow from the limb along +Y and open toward +Z, their lit side.
        expect(geometry.boundingBox.min.y).toBeGreaterThan(-0.2);
        expect(geometry.boundingBox.min.y).toBeLessThan(0.3);
        expect(geometry.boundingBox.max.y).toBeGreaterThan(0.8);
        expect(size.z).toBeLessThan(size.y);
        const record = parsed.foliage.records[name];
        for (let axis = 0; axis < 3; axis++) {
            expect(geometry.boundingBox.min.getComponent(axis)).toBeCloseTo(record.boundsMin[axis], 3);
            expect(geometry.boundingBox.max.getComponent(axis)).toBeCloseTo(record.boundsMax[axis], 3);
        }
        const [low, high] = attributeRange(geometry.attributes.uv);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        // Leaf (1) against wood (0) is painted into alpha: every spray is mostly leaf.
        const { color, normal } = geometry.attributes;
        let leaves = 0;
        let lit = 0;
        const ids = new Set();
        for (let index = 0; index < color.count; index++) {
            if (color.getW(index) > 0.5) {
                leaves += 1;
                ids.add(color.getY(index));
                if (normal.getZ(index) > 0) lit += 1;
            } else {
                // Wood carries no flutter weight.
                expect(color.getX(index)).toBe(0);
            }
        }
        expect(leaves).toBeGreaterThan(color.count * 0.8);
        // One id per leaf (green), and the leaves face the lit side.
        expect(ids.size).toBeGreaterThanOrEqual(record.leaves - 1);
        expect(lit).toBeGreaterThan(leaves * 0.75);
        // Red runs from 0 at a leaf's base to 1 at its far lobes; blue shades the spray.
        const [stalk, tip] = extent(color.array, 4, 0, 1 / 255);
        expect(stalk).toBe(0);
        expect(tip).toBe(1);
        const [shade, bright] = extent(color.array, 4, 2, 1 / 255);
        expect(shade).toBeGreaterThan(0.3);
        expect(bright).toBeGreaterThan(0.9);
    });

    it('refuses a pack written for another schema, naming which pack it was', async () => {
        const stale = await parseGlb(FOLIAGE_FILE);
        stale.scene.userData.schemaVersion = 0;
        expect(() => parseVerdantHillsMeshes(stale, 'Foliage'))
            .toThrow(`[Verdant Hills] Foliage has asset schema 0; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`);
        expect(() => parseVerdantHillsMeshes(stale, 'Props'))
            .toThrow(`[Verdant Hills] Props has asset schema 0; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`);
        stale.scene.userData = undefined;
        expect(() => parseVerdantHillsMeshes(stale, 'Foliage')).toThrow('Foliage has asset schema undefined');
        // Children without geometry (an empty, a light) are skipped rather than keyed.
        const mixed = await parseGlb(PROPS_FILE);
        const empty = new THREE.Object3D();
        empty.name = 'locator';
        mixed.scene.add(empty);
        const pack = parseVerdantHillsMeshes(mixed, 'Props');
        expect(Object.keys(pack.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(Object.keys(pack.records).sort()).toEqual([...REQUIRED_PROPS].sort());
    });
});

describe('Verdant Hills props pack', () => {
    const mesh = (name) => parsed.props.meshes[name];
    const box = (name) => mesh(name).boundingBox;
    const size = (name) => box(name).getSize(new THREE.Vector3());
    const anchorsOf = (name) => verdantHillsPropRecord(name).anchors;

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
        expect(extras.schemaVersion).toBe(VERDANT_HILLS_ASSET_SCHEMA);
        for (const node of json.nodes) {
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            expect(json.meshes[node.mesh].primitives[0].mode ?? 4).toBe(4);
        }
        // The props in the order the generator builds them: the sails are their own node.
        expect(json.nodes.map((node) => node.name)).toEqual(REQUIRED_PROPS);
        // The file's table of codes is the loader's: eleven materials, sixteen steps of green.
        expect(Object.isFrozen(VERDANT_HILLS_MATERIALS)).toBe(true);
        expect(VERDANT_HILLS_MATERIAL_STEPS).toBe(16);
        expect(extras.materialCodeScale).toBe(VERDANT_HILLS_MATERIAL_STEPS);
        expect(extras.uvMetres).toBe(32);
        expect(Object.values(VERDANT_HILLS_MATERIALS).sort((a, b) => a - b))
            .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(extras.materialCodes).toHaveLength(Object.keys(VERDANT_HILLS_MATERIALS).length);
        for (const [material, code] of Object.entries(VERDANT_HILLS_MATERIALS)) {
            expect(extras.materialCodes[code], material).toBe(material);
        }
        // Every material is used by something.
        const used = new Set(REQUIRED_PROPS.flatMap((name) => PROP_MATERIALS[name]));
        expect([...used].sort()).toEqual(Object.keys(VERDANT_HILLS_MATERIALS).sort());
    });

    it('has exactly the twelve props of the brief', () => {
        const { meshes } = parsed.props;
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(Object.keys(PROP_MATERIALS).sort()).toEqual([...REQUIRED_PROPS].sort());
        expect(REQUIRED_PROPS).toHaveLength(12);
    });

    it.each(REQUIRED_PROPS)('%s is a complete, finite mesh painted with whole material codes', (name) => {
        const geometry = mesh(name);
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(30);
        expect(geometry.attributes.position.count).toBeLessThanOrEqual(65536);
        const paint = paintOf(geometry);
        // An eight-bit channel holds code / 16 to within a thirtieth of a step: the shader's
        // rounding recovers a whole code for every vertex, and it is one of the eleven.
        expect(paint.worst).toBeLessThan(0.04);
        for (const code of paint.codes.keys()) {
            expect(Number.isInteger(code)).toBe(true);
            expect(code).toBeGreaterThanOrEqual(0);
            expect(code).toBeLessThanOrEqual(10);
        }
        // And the prop is made of what it should be made of, and of nothing else.
        const made = [...paint.codes.keys()].sort((a, b) => a - b);
        expect(made, name).toEqual(PROP_MATERIALS[name].map((material) => VERDANT_HILLS_MATERIALS[material])
            .sort((a, b) => a - b));
        // Laid out in metres about the middle of the sheet: 0.5 + metres / 32 (panes run 0..1).
        const [low, high] = attributeRange(geometry.attributes.uv);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        // The occlusion bake is in blue: it reaches into shade and out into the open.
        const [darkest, lightest] = extent(geometry.attributes.color.array, 4, 2, 1 / 255);
        expect(darkest).toBeLessThan(0.85);
        expect(lightest).toBeGreaterThan(0.75);
        expect(lightest - darkest).toBeGreaterThan(0.15);
    });

    // The props are single-sided: a material that culls back faces must still show every one.
    it.each(REQUIRED_PROPS)('%s winds every face the way its normals point', (name) => {
        const geometry = mesh(name);
        const { position, normal } = geometry.attributes;
        const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const facing = new THREE.Vector3();
        const shaded = new THREE.Vector3();
        const vertex = new THREE.Vector3();
        let inside = 0;
        let flat = 0;
        for (let index = 0; index < geometry.index.count; index += 3) {
            shaded.set(0, 0, 0);
            for (let corner = 0; corner < 3; corner++) {
                const at = geometry.index.getX(index + corner);
                corners[corner].fromBufferAttribute(position, at);
                shaded.add(vertex.fromBufferAttribute(normal, at));
            }
            facing.crossVectors(corners[1].clone().sub(corners[0]), corners[2].clone().sub(corners[0]));
            // A sliver too thin to have a facing in sixteen-bit positions is not counted either way.
            if (facing.length() < 1e-7) flat += 1;
            else if (facing.dot(shaded) <= 0) inside += 1;
        }
        expect(inside).toBe(0);
        expect(flat).toBeLessThan(triangles(geometry) * 0.01 + 1);
    });

    it('records each prop in the manifest exactly as the file holds it', () => {
        const { json } = readGlb(PROPS_FILE);
        const manifest = readManifest().assets.find((entry) => entry.kind === 'props');
        expect(json.scenes[0].extras.meshes).toEqual(manifest.meshes);
        for (const name of REQUIRED_PROPS) {
            const record = verdantHillsPropRecord(name);
            expect(record).toEqual(manifest.meshes[name]);
            // The node carries the same record, so the file can be read without the manifest.
            expect(json.nodes.find((node) => node.name === name).extras).toEqual(record);
            expect(parsed.props.records[name]).toEqual(record);
            const geometry = mesh(name);
            expect(record.triangles).toBe(triangles(geometry));
            expect(record.vertices).toBe(geometry.attributes.position.count);
            // Bounds to the millimetre: sixteen-bit positions over a few metres.
            for (let axis = 0; axis < 3; axis++) {
                expect(geometry.boundingBox.min.getComponent(axis)).toBeCloseTo(record.boundsMin[axis], 2);
                expect(geometry.boundingBox.max.getComponent(axis)).toBeCloseTo(record.boundsMax[axis], 2);
                expect(record.size[axis]).toBeCloseTo(record.boundsMax[axis] - record.boundsMin[axis], 3);
            }
            // The generator's list of what the prop is made of is what its vertices say.
            expect([...record.materials].sort(), name).toEqual([...PROP_MATERIALS[name]].sort());
        }
        for (const unknown of ['sails', 'Windmill', '', undefined, null]) {
            expect(verdantHillsPropRecord(unknown)).toBeNull();
        }
    });

    it.each(Object.entries(PROP_ANCHORS))('gives the %s the anchors the brief names', (name, keys) => {
        const record = verdantHillsPropRecord(name);
        const bounds = new THREE.Box3(new THREE.Vector3(...record.boundsMin), new THREE.Vector3(...record.boundsMax));
        for (const key of keys) {
            const anchor = record.anchors[key];
            expect(Array.isArray(anchor), `${name}.${key}`).toBe(true);
            expect(anchor).toHaveLength(3);
            expect(anchor.every(Number.isFinite), `${name}.${key}`).toBe(true);
            // On the prop (a direction is a unit vector instead).
            if (key === 'axis') expect(new THREE.Vector3(...anchor).length()).toBeCloseTo(1, 3);
            else expect(bounds.distanceToPoint(new THREE.Vector3(...anchor)), `${name}.${key}`).toBeLessThan(0.25);
        }
    });

    it('builds the mill as a tapering limewashed tower under a tarred cap', () => {
        const geometry = mesh('windmill');
        const anchors = anchorsOf('windmill');
        const { position } = geometry.attributes;
        const paint = paintOf(geometry);
        // The wash is the tower: 6.2 m across at the ground, 3.9 m at the curb, 11.5 m up.
        expect(anchors.curb).toBe(11.5);
        expect(anchors.baseRadius * 2).toBeCloseTo(6.2, 6);
        expect(anchors.topRadius * 2).toBeCloseTo(3.9, 6);
        let foot = 0;
        let curb = 0;
        let top = -Infinity;
        for (const index of paint.indices('limewash')) {
            const reach = Math.hypot(position.getX(index), position.getZ(index));
            const level = position.getY(index);
            top = Math.max(top, level);
            if (level < 0.5) foot = Math.max(foot, reach);
            if (level > 11.45) curb = Math.max(curb, reach);
            // Every vertex of the wash lies on the cone or inside it (the reveals of the openings).
            expect(reach).toBeLessThan(3.1 - (1.15 * level) / 11.5 + 0.01);
        }
        expect(top).toBeCloseTo(11.5, 2);
        expect(foot).toBeGreaterThan(3.0);
        expect(curb).toBeCloseTo(1.95, 2);
        // It stands on a low stone plinth that goes into the ground.
        const plinth = boxOf(geometry, 'stone');
        expect(plinth.min.y).toBeLessThan(-0.2);
        expect(box('windmill').min.y).toBeCloseTo(plinth.min.y, 3);
        expect(plinth.max.x - plinth.min.x).toBeGreaterThan(6.2);
        // The cap: tarred boards from the curb to about 2.6 m above it, longer fore and aft than across.
        const cap = boxOf(geometry, 'tar');
        expect(cap.min.y).toBeGreaterThan(10.9);
        expect(cap.min.y).toBeLessThan(11.5);
        expect(cap.max.y - 11.5).toBeGreaterThan(2.4);
        expect(cap.max.y - 11.5).toBeLessThan(2.9);
        expect(cap.max.z - cap.min.z).toBeGreaterThan(cap.max.x - cap.min.x);
        expect(cap.max.x - cap.min.x).toBeGreaterThan(3.9);
        // A small finial on top: the highest thing on the mill.
        expect(anchors.capTop[1]).toBeCloseTo(box('windmill').max.y, 3);
        expect(anchors.capTop[1]).toBeGreaterThan(cap.max.y);
        expect(anchors.capTop[1] - cap.max.y).toBeLessThan(1);
        expect(Math.hypot(anchors.capTop[0], anchors.capTop[2])).toBeLessThan(0.01);
        // No sails on the body: nothing reaches a sail's length from the hub.
        expect(size('windmill').x).toBeLessThan(9);
        expect(paint.indices('canvas')).toHaveLength(0);
    });

    it('puts the hub in front of the cap and aims the sails along a shaft tilted up eight degrees', () => {
        const anchors = anchorsOf('windmill');
        const hub = new THREE.Vector3(...anchors.hub);
        const axis = new THREE.Vector3(...anchors.axis);
        expect(axis.x).toBe(0);
        expect(axis.z).toBeGreaterThan(0.98);
        expect(THREE.MathUtils.radToDeg(Math.asin(axis.y))).toBeCloseTo(8, 1);
        // In front of the cap's boards on the +Z side, at the height of the cap.
        const cap = boxOf(mesh('windmill'), 'tar');
        expect(hub.x).toBe(0);
        expect(hub.y).toBeGreaterThan(11.5);
        expect(hub.y).toBeLessThan(cap.max.y);
        // The windshaft's iron nose ends at the hub.
        const nose = boxOf(mesh('windmill'), 'iron');
        expect(Math.abs(nose.max.z - hub.z)).toBeLessThan(0.08);
        // Set on the hub, the sails clear everything: the stage's rail, the tower and the ground.
        const sails = anchorsOf('windmill_sails');
        expect(anchors.sailRadius).toBe(sails.radius);
        const down = new THREE.Vector3(0, -axis.z, axis.y);
        const lowest = hub.clone().addScaledVector(down, sails.radius);
        expect(lowest.y).toBeGreaterThan(3);
        expect(lowest.z).toBeGreaterThan(anchors.stage.outerRadius + 0.2);
        const { position } = mesh('windmill').attributes;
        const point = new THREE.Vector3();
        let closest = Infinity;
        for (let index = 0; index < position.count; index++) {
            point.fromBufferAttribute(position, index).sub(hub);
            const along = point.dot(axis);
            const radial = Math.sqrt(Math.max(0, point.lengthSq() - along * along));
            // Inside the disc the sails sweep, outside the boss: how far behind them is the mill?
            if (radial > 0.6 && radial < sails.radius) closest = Math.min(closest, -along);
        }
        // The sails' frame is set back as much as half a metre at the heel; the mill is farther back than that.
        expect(closest).toBeGreaterThan(0.2);
    });

    it('sets a door at the ground facing +Z and six small windows deep in the wall', () => {
        const geometry = mesh('windmill');
        const anchors = anchorsOf('windmill');
        const door = boxOf(geometry, 'door');
        expect(door.min.y).toBeGreaterThan(0);
        expect(door.min.y).toBeLessThan(0.3);
        expect(door.max.y).toBeGreaterThan(1.9);
        expect(door.max.y).toBeLessThan(2.4);
        expect(door.max.x - door.min.x).toBeGreaterThan(0.9);
        expect(door.max.x - door.min.x).toBeLessThan(1.3);
        expect(Math.abs(door.max.x + door.min.x)).toBeLessThan(0.02);
        // Recessed: behind the face of the tower, on its +Z side.
        expect(door.min.z).toBeGreaterThan(2.4);
        expect(door.max.z).toBeLessThan(3.05);
        expect(door.containsPoint(new THREE.Vector3(...anchors.door))).toBe(true);
        expect(anchors.doorSize).toEqual([1.15, 2.2]);
        // Four corners of glass to a window.
        const glass = paintOf(geometry).indices('glass');
        expect(anchors.windows).toHaveLength(6);
        expect(glass).toHaveLength(anchors.windows.length * 4);
        const { position, uv } = geometry.attributes;
        const point = new THREE.Vector3();
        const levels = [];
        for (const window of anchors.windows) {
            const centre = new THREE.Vector3(...window.centre);
            const normal = new THREE.Vector3(...window.normal);
            expect(normal.length()).toBeCloseTo(1, 3);
            expect(normal.y).toBe(0);
            // Small: about half a metre by three quarters.
            expect(window.width).toBeGreaterThan(0.4);
            expect(window.width).toBeLessThan(0.7);
            expect(window.height).toBeGreaterThan(0.6);
            expect(window.height).toBeLessThan(0.95);
            // Deep in the wall: the pane stands a hand and more inside the tower's face.
            const face = 3.1 - (1.15 * centre.y) / 11.5;
            const reach = Math.hypot(centre.x, centre.z);
            expect(face - reach).toBeGreaterThan(0.2);
            expect(face - reach).toBeLessThan(0.4);
            // It looks straight out of the tower.
            expect(new THREE.Vector3(centre.x, 0, centre.z).normalize().dot(normal)).toBeGreaterThan(0.999);
            const corners = glass
                .filter((index) => point.fromBufferAttribute(position, index).distanceTo(centre) < 0.7);
            expect(corners).toHaveLength(4);
            // A pane is mapped 0..1 across itself.
            expect(corners.map((index) => `${uv.getX(index)},${uv.getY(index)}`).sort())
                .toEqual(['0,0', '0,1', '1,0', '1,1']);
            levels.push(centre.y);
        }
        // They climb the tower: from the ground floor to under the curb, on every side.
        expect(Math.min(...levels)).toBeLessThan(2.5);
        expect(Math.max(...levels)).toBeGreaterThan(9);
        expect(new Set(anchors.windows.map((window) => window.normal.join())).size).toBe(4);
        // White frames stand in every opening.
        expect(paintOf(geometry).indices('white').length).toBeGreaterThan(anchors.windows.length * 20);
    });

    it('carries a timber stage round the tower at about 3.6 m, with posts, braces and a handrail', () => {
        const geometry = mesh('windmill');
        const { stage } = anchorsOf('windmill');
        expect(stage.height).toBe(3.6);
        expect(stage.outerRadius - stage.innerRadius).toBeGreaterThan(1);
        expect(stage.outerRadius - stage.innerRadius).toBeLessThan(1.4);
        const { position } = geometry.attributes;
        const timber = boxOf(geometry, 'timber');
        // Braces below the deck, the handrail a metre above it.
        expect(timber.min.y).toBeLessThan(stage.height - 1.2);
        expect(timber.min.y).toBeGreaterThan(1.5);
        expect(timber.max.y).toBeCloseTo(stage.height + 1.1, 1);
        expect(timber.max.x).toBeCloseTo(stage.outerRadius, 1);
        // The deck runs all the way round: timber at deck height in every direction.
        const sectors = new Set();
        let rail = 0;
        for (const index of paintOf(geometry).indices('timber')) {
            const level = position.getY(index);
            if (Math.abs(level - stage.height) < 0.01) {
                const turn = Math.atan2(position.getX(index), position.getZ(index)) + Math.PI;
                sectors.add(Math.floor((turn / Math.PI) * 8));
            }
            if (level > stage.height + 0.9) rail += 1;
        }
        expect(sectors.size).toBeGreaterThanOrEqual(16);
        expect(rail).toBeGreaterThan(100);
        expect(stage.railHeight).toBeGreaterThan(0.9);
    });

    it('weathers the wash: moss at the foot of the tower and grime where the water runs', () => {
        const geometry = mesh('windmill');
        const { position, color } = geometry.attributes;
        const bands = { foot: [0, 0], middle: [0, 0], curb: [0, 0] };
        const bandOf = (level) => {
            if (level < 1.2) return 'foot';
            if (level > 10) return 'curb';
            return level > 5.5 && level < 8.5 ? 'middle' : null;
        };
        let worst = 0;
        for (const index of paintOf(geometry).indices('limewash')) {
            const wear = color.getW(index);
            worst = Math.max(worst, wear);
            const band = bandOf(position.getY(index));
            if (band) {
                bands[band][0] += wear;
                bands[band][1] += 1;
            }
        }
        const mean = (key) => bands[key][0] / bands[key][1];
        expect(mean('foot')).toBeGreaterThan(0.25);
        expect(mean('foot')).toBeGreaterThan(mean('middle') * 2);
        expect(mean('curb')).toBeGreaterThan(mean('middle'));
        expect(worst).toBeGreaterThan(0.6);
    });

    it('builds four sails about the origin, in the XY plane, with canvas over their outer two thirds', () => {
        const geometry = mesh('windmill_sails');
        const anchors = anchorsOf('windmill_sails');
        expect(anchors).toMatchObject({
            radius: 9.2, axis: [0, 0, 1], sails: 4, width: 1.9, centre: [0, 0, 0],
        });
        const bounds = box('windmill_sails');
        // Each whip is 9.2 m: the four reach that far along ±X and ±Y, and the frame is thin along Z.
        for (const reach of [bounds.max.x, -bounds.min.x, bounds.max.y, -bounds.min.y]) {
            expect(reach).toBeCloseTo(9.2, 1);
        }
        expect(size('windmill_sails').z).toBeLessThan(1);
        expect(bounds.min.z).toBeLessThan(0);
        expect(bounds.max.z).toBeGreaterThan(0);
        // Not a prop that stands on the ground: it is centred on its hub.
        expect(bounds.getCenter(new THREE.Vector3()).length()).toBeLessThan(0.3);
        const { position } = geometry.attributes;
        const paint = paintOf(geometry);
        // Canvas only beyond a third of the way out, and the same on every sail.
        const quadrants = [0, 0, 0, 0];
        let innermost = Infinity;
        let outermost = 0;
        for (const index of paint.indices('canvas')) {
            const x = position.getX(index);
            const y = position.getY(index);
            const reach = Math.hypot(x, y);
            innermost = Math.min(innermost, reach);
            outermost = Math.max(outermost, reach);
            quadrants[Math.floor((((Math.atan2(y, x) + Math.PI * 2.25) % (Math.PI * 2)) / (Math.PI / 2))) % 4] += 1;
        }
        expect(innermost).toBeGreaterThan(9.2 / 3 - 0.3);
        expect(innermost).toBeLessThan(9.2 / 3 + 0.6);
        expect(anchors.clothFrom).toBeCloseTo(innermost, 0);
        expect(outermost).toBeGreaterThan(9);
        expect(new Set(quadrants).size).toBe(1);
        expect(quadrants[0]).toBeGreaterThan(40);
        // The lattice is timber: bars and laths as thin boxes, far more of it than of cloth.
        expect(paint.indices('timber').length).toBeGreaterThan(paint.indices('canvas').length * 2);
        // A sail's frame is about 1.9 m wide: the sail along +X spans that much of Y.
        let low = Infinity;
        let high = -Infinity;
        for (const index of paint.indices('timber')) {
            if (position.getX(index) > 4 && position.getX(index) < 8) {
                low = Math.min(low, position.getY(index));
                high = Math.max(high, position.getY(index));
            }
        }
        expect(high - low).toBeGreaterThan(1.8);
        expect(high - low).toBeLessThan(2.05);
        // An iron boss at the centre.
        const boss = boxOf(geometry, 'iron');
        expect(boss.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
        expect(boss.max.x).toBeLessThan(0.5);
    });

    it('models four metres of drystone wall that tile end to end', () => {
        const geometry = mesh('wall');
        const anchors = anchorsOf('wall');
        expect(anchors).toMatchObject({
            section: 4, start: [-2, 0, 0], end: [2, 0, 0], height: 1.15, footThickness: 0.6, topThickness: 0.38,
        });
        expect(triangles(geometry)).toBeGreaterThanOrEqual(1500);
        expect(triangles(geometry)).toBeLessThanOrEqual(3000);
        const bounds = box('wall');
        // One section along X, centred; its cope stones may lean a finger over the ends.
        expect(bounds.min.x).toBeGreaterThan(-2.06);
        expect(bounds.min.x).toBeLessThan(-1.999);
        expect(bounds.max.x).toBeLessThan(2.06);
        expect(bounds.max.x).toBeGreaterThan(1.999);
        // About 1.15 m tall, with a footing in the ground.
        expect(bounds.max.y).toBeGreaterThan(1.1);
        expect(bounds.max.y).toBeLessThan(1.25);
        expect(bounds.min.y).toBeCloseTo(anchors.footing, 3);
        expect(anchors.footing).toBeLessThan(-0.1);
        // Battered: 0.6 m thick at the ground (and a stone's relief more), 0.38 m under the copes.
        const { position } = geometry.attributes;
        const thick = (from, to) => {
            let reach = 0;
            for (let index = 0; index < position.count; index++) {
                if (position.getY(index) >= from && position.getY(index) <= to) {
                    reach = Math.max(reach, Math.abs(position.getZ(index)));
                }
            }
            return reach * 2;
        };
        // (Measured where stones have corners: at the top of the lowest course and of the highest.)
        expect(thick(0.1, 0.2)).toBeGreaterThan(0.55);
        expect(thick(0.1, 0.2)).toBeLessThan(0.74);
        expect(thick(0.84, 0.915)).toBeGreaterThan(0.36);
        expect(thick(0.84, 0.915)).toBeLessThan(0.54);
        expect(thick(0.1, 0.2)).toBeGreaterThan(thick(0.84, 0.915) + 0.1);
        // The stones that cross the end of the section are cut on it, and the cut at one end
        // is the cut at the other: laid end to end, the two halves meet point for point.
        const cut = (plane) => {
            const points = [];
            for (let index = 0; index < position.count; index++) {
                if (Math.abs(position.getX(index) - plane) < 2e-4 && position.getY(index) < anchors.bodyHeight) {
                    points.push(`${position.getY(index).toFixed(3)},${position.getZ(index).toFixed(3)}`);
                }
            }
            return points.sort();
        };
        expect(cut(2).length).toBeGreaterThan(40);
        expect(cut(2)).toEqual(cut(-2));
        // Real relief: many separate stones, each with a face proud of its joints, on both sides.
        for (const side of [1, -1]) {
            const depths = new Set();
            for (let index = 0; index < position.count; index++) {
                const level = position.getY(index);
                if (level > 0.15 && level < 0.36 && position.getZ(index) * side > 0) {
                    depths.add((position.getZ(index) * side).toFixed(2));
                }
            }
            expect(depths.size).toBeGreaterThan(5);
        }
        // A row of cope stones stands on top of the body.
        let copes = 0;
        for (let index = 0; index < position.count; index++) {
            if (position.getY(index) > anchors.bodyHeight + 0.15) copes += 1;
        }
        expect(copes).toBeGreaterThan(60);
    });

    it('ends a run of wall with a stout head that covers the cut stones', () => {
        const head = box('wall_head');
        const wall = box('wall');
        const anchors = anchorsOf('wall_head');
        expect(anchors.length).toBe(0.7);
        expect(size('wall_head').x).toBeGreaterThan(0.68);
        expect(size('wall_head').x).toBeLessThan(0.82);
        // It starts inside the run and ends 0.58 m beyond it.
        expect(head.min.x).toBeLessThanOrEqual(-anchors.overlap + 1e-3);
        expect(head.min.x).toBeGreaterThan(-anchors.overlap - 0.05);
        expect(anchors.overlap).toBeGreaterThan(0.05);
        expect(anchors.join).toEqual([0, 0, 0]);
        expect(anchors.end[0]).toBeCloseTo(anchors.length - anchors.overlap, 6);
        expect(head.max.x).toBeGreaterThanOrEqual(anchors.end[0]);
        // A hand thicker and taller than the wall, so the wall's last stones end inside it.
        expect(head.max.z).toBeGreaterThan(wall.max.z);
        expect(head.min.z).toBeLessThan(wall.min.z);
        expect(head.max.y).toBeGreaterThan(wall.max.y - 0.05);
        expect(head.min.y).toBeLessThanOrEqual(wall.min.y + 1e-3);
        // Its end is closed: stones face +X.
        const { position, normal } = mesh('wall_head').attributes;
        let cheek = 0;
        for (let index = 0; index < position.count; index++) {
            if (normal.getX(index) > 0.9 && position.getX(index) > anchors.end[0] - 0.02) cheek += 1;
        }
        expect(cheek).toBeGreaterThan(20);
    });

    it('hangs a five-bar gate between two dressed stone posts', () => {
        const geometry = mesh('gate');
        const anchors = anchorsOf('gate');
        expect(anchors).toMatchObject({ width: 3.3, height: 1.25, postSize: 0.45 });
        const timber = boxOf(geometry, 'timber');
        // The leaf: 3.3 m wide, its top bar at 1.25 m, clear of the ground.
        expect(timber.max.x - timber.min.x).toBeCloseTo(3.3, 2);
        expect(Math.abs(timber.max.x + timber.min.x)).toBeLessThan(0.01);
        expect(timber.min.y).toBeGreaterThan(0.08);
        expect(timber.max.y).toBeGreaterThan(1.25);
        expect(timber.max.y).toBeLessThan(1.45);
        // Five bars, closer together low down, the top one at 1.25 m.
        const { position, normal } = geometry.attributes;
        expect(anchors.bars).toHaveLength(5);
        const gaps = anchors.bars.slice(1).map((level, index) => level - anchors.bars[index]);
        for (let index = 1; index < gaps.length; index++) expect(gaps[index]).toBeGreaterThan(gaps[index - 1]);
        expect(anchors.bars[4]).toBeGreaterThan(1.1);
        expect(anchors.bars[4]).toBeLessThan(anchors.height);
        // Each is really there: a board with a top face at that height, from stile to stile.
        const ends = anchors.bars.map(() => [false, false]);
        let braced = false;
        for (const index of paintOf(geometry).indices('timber')) {
            const x = position.getX(index);
            if (normal.getY(index) > 0.99) {
                anchors.bars.forEach((level, bar) => {
                    if (position.getY(index) > level && position.getY(index) < level + 0.07) {
                        if (x < -1.5) ends[bar][0] = true;
                        if (x > 1.5) ends[bar][1] = true;
                    }
                });
            }
            // The brace is the only timber that runs on a slant.
            const rise = Math.abs(normal.getY(index));
            if (rise > 0.2 && rise < 0.98 && Math.abs(normal.getX(index)) > 0.1) braced = true;
        }
        expect(ends).toEqual(anchors.bars.map(() => [true, true]));
        expect(braced).toBe(true);
        // Two stone posts, 0.45 m square and 1.5 m tall, either side of the leaf.
        const stone = boxOf(geometry, 'stone');
        expect(stone.max.y).toBeCloseTo(1.5, 3);
        expect(stone.min.y).toBeLessThan(0);
        expect(stone.max.z - stone.min.z).toBeCloseTo(0.45, 3);
        expect(stone.max.x - stone.min.x).toBeCloseTo(anchors.opening + 2 * anchors.postSize, 3);
        expect(anchors.opening).toBeGreaterThan(anchors.width);
        expect(anchors.opening - anchors.width).toBeLessThan(0.2);
        // The anchors: the tops of both posts, the hinge on the left, the latch on the right.
        expect(anchors.postLeft[0]).toBeCloseTo(-anchors.postRight[0], 6);
        expect(anchors.postLeft[0]).toBeLessThan(-1.8);
        for (const post of [anchors.postLeft, anchors.postRight]) {
            expect(post[1]).toBe(1.5);
            expect(post[2]).toBe(0);
        }
        expect(anchors.hinge[0]).toBeLessThan(-1.6);
        expect(anchors.hinge[0]).toBeGreaterThan(anchors.postLeft[0]);
        expect(anchors.hingeAxis).toEqual([0, 1, 0]);
        expect(anchors.latch[0]).toBeGreaterThan(1.6);
        expect(anchors.latch[0]).toBeLessThan(anchors.postRight[0]);
        expect(anchors.latch[1]).toBeGreaterThan(0.7);
        expect(anchors.latch[1]).toBeLessThan(1.25);
        // Iron at both: hinges on the hanging side, the latch on the other.
        const iron = boxOf(geometry, 'iron');
        expect(iron.min.x).toBeLessThan(-1.6);
        expect(iron.max.x).toBeGreaterThan(1.6);
    });

    it('models the bench, the post, the outcrops and the sheep at the sizes the brief gives', () => {
        // A bench 1.8 m long: a seat at sitting height and a back above it, facing +Z.
        const bench = size('bench');
        expect(bench.x).toBeGreaterThan(1.78);
        expect(bench.x).toBeLessThan(1.85);
        expect(box('bench').max.y).toBeGreaterThan(0.8);
        expect(box('bench').max.y).toBeLessThan(1.05);
        expect(anchorsOf('bench').seatHeight).toBeCloseTo(0.45, 6);
        expect(anchorsOf('bench').backTop[2]).toBeLessThan(-0.2);
        expect(box('bench').min.y).toBeLessThan(0);
        // A fence post 1.3 m tall and 0.12 m thick, with its foot in the ground.
        const post = box('post');
        expect(post.max.y).toBeCloseTo(1.3, 2);
        expect(anchorsOf('post').top).toEqual([0, 1.3, 0]);
        expect(anchorsOf('post').tie[1]).toBeLessThan(1.3);
        expect(size('post').x).toBeGreaterThan(0.1);
        expect(size('post').x).toBeLessThan(0.15);
        expect(size('post').z).toBeLessThan(0.15);
        expect(post.min.y).toBeLessThan(-0.2);
        expect(post.containsPoint(new THREE.Vector3(0, 0.6, 0))).toBe(true);
        // Limestone outcrops of 0.8 to 2.2 m, bedded into the turf, flat-topped, each its own shape.
        const outlines = [];
        for (const name of ['boulder_a', 'boulder_b', 'boulder_c']) {
            const reach = Math.max(size(name).x, size(name).z);
            expect(reach, name).toBeGreaterThan(0.8);
            expect(reach, name).toBeLessThan(2.3);
            expect(box(name).min.y).toBeLessThan(-0.05);
            expect(box(name).max.y).toBeGreaterThan(0.2);
            expect(box(name).max.y).toBeLessThan(reach * 0.5);
            expect(box(name).containsPoint(new THREE.Vector3(0, 0.05, 0))).toBe(true);
            outlines.push(reach);
        }
        expect(outlines[0]).toBeGreaterThan(outlines[1]);
        expect(outlines[1]).toBeGreaterThan(outlines[2]);
        // Sheep about 1.05 m long, facing +Z: a woolly body on four dark legs.
        for (const name of ['sheep_a', 'sheep_b']) {
            const geometry = mesh(name);
            expect(triangles(geometry)).toBeGreaterThanOrEqual(300);
            expect(triangles(geometry)).toBeLessThanOrEqual(600);
            expect(size(name).z).toBeGreaterThan(0.95);
            expect(size(name).z).toBeLessThan(1.2);
            expect(size(name).x).toBeLessThan(0.7);
            expect(box(name).min.y).toBeCloseTo(0, 2);
            const wool = boxOf(geometry, 'wool');
            const skin = boxOf(geometry, 'skin');
            // The fleece is clear of the ground; the legs reach it; the head is at the +Z end.
            expect(wool.min.y).toBeGreaterThan(0.12);
            expect(skin.min.y).toBeCloseTo(0, 2);
            expect(skin.max.z).toBeGreaterThan(wool.max.z - 0.05);
            // Lumpy: its fleece is no ellipsoid (the vertices of an ellipsoid would all sit at radius 1).
            const { position } = geometry.attributes;
            const centre = wool.getCenter(new THREE.Vector3());
            const half = wool.getSize(new THREE.Vector3()).multiplyScalar(0.5);
            let least = Infinity;
            let most = 0;
            for (const index of paintOf(geometry).indices('wool')) {
                const offset = new THREE.Vector3().fromBufferAttribute(position, index).sub(centre).divide(half);
                const radius = offset.length();
                least = Math.min(least, radius);
                most = Math.max(most, radius);
            }
            expect(most - least).toBeGreaterThan(0.2);
        }
        // One stands with its head up, the other grazes with its muzzle in the grass.
        const standing = anchorsOf('sheep_a');
        const grazing = anchorsOf('sheep_b');
        expect(standing.grazing).toBe(false);
        expect(grazing.grazing).toBe(true);
        expect(standing.head[1]).toBeGreaterThan(0.8);
        expect(grazing.head[1]).toBeLessThan(0.35);
        expect(grazing.muzzle[1]).toBeLessThan(0.12);
        expect(box('sheep_a').max.y).toBeGreaterThan(box('sheep_b').max.y + 0.1);
    });
});

describe('Verdant Hills far-tree sprite sheet', () => {
    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const layout = verdantHillsImpostorLayout();
        expect(Object.keys(layout).sort()).toEqual(['atlasHeight', 'atlasWidth', 'tiles']);
        const png = readAsset(IMPOSTOR_FILE);
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(layout.atlasWidth);
        expect(png.readUInt32BE(20)).toBe(layout.atlasHeight);
        // Shade, leaf mask, hue seed and coverage: four 8-bit channels.
        expect([png[24], png[25]]).toEqual([8, 6]);
        expect(layout.tiles).toHaveLength(4);
        let cursor = 0;
        for (const tile of layout.tiles) {
            expect(Number.isInteger(tile.x)).toBe(true);
            expect(Number.isInteger(tile.pixels)).toBe(true);
            expect(tile.pixels).toBeGreaterThan(0);
            // In order, edge to edge: each tile starts where the last one ended.
            expect(tile.x).toBe(cursor);
            cursor = tile.x + tile.pixels;
        }
        expect(cursor).toBe(layout.atlasWidth);
        // The layout is the manifest's own record.
        const record = readManifest().assets.find((entry) => entry.kind === 'impostors');
        expect(layout).toEqual({ atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles });
    });

    it('describes each tile as one of the four trees, at its true proportions', () => {
        const layout = verdantHillsImpostorLayout();
        // The three field trees, then the old oak.
        expect(layout.tiles.map((tile) => tile.asset)).toEqual([...FIELD_TREES, 'oak-hero']);
        for (const tile of layout.tiles) {
            const tree = parsed.trees[tile.asset];
            expect(tree, tile.asset).toBeDefined();
            expect(tile.species).toBe(tree.species);
            expect(tile.role).toBe(tree.role);
            // Metres on the card match pixels on the sheet, so no sprite is stretched.
            expect(tile.width / tile.height).toBeCloseTo(tile.pixels / layout.atlasHeight, 3);
            expect(tile.height).toBeGreaterThan(tree.height * 0.98);
            expect(tile.height).toBeLessThan(tree.height * 1.12);
            // Where the trunk stands, as a fraction of the tile width from its centre.
            expect(Math.abs(tile.trunk)).toBeLessThan(0.5);
            expect(tile.coverage).toBeGreaterThan(0.25);
            expect(tile.coverage).toBeLessThanOrEqual(1);
        }
        // The old oak's card is wider than it is tall, and holds the whole spread of the tree.
        const hero = layout.tiles[3];
        expect(hero.width).toBeGreaterThan(hero.height);
        expect(hero.width).toBeGreaterThan(21);
        // Its long bough reaches right (+X): the trunk stands left of the middle of its card.
        expect(hero.trunk).toBeLessThan(0);
        // The wind-blown tree's crown is blown right, so its trunk stands left of the middle too.
        expect(layout.tiles[1].trunk).toBeLessThan(-0.03);
    });

    it('prepares the sheet as linear, clamped, mip-mapped data', () => {
        const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareVerdantHillsImpostors(texture)).toBe(texture);
        // It stores shading data, not colour.
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.anisotropy).toBeGreaterThan(1);
        expect(texture.name).toBe('VerdantHillsFarTreeSprites');
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });
});

describe('loading and releasing the Verdant Hills assets', () => {
    const packGeometries = (assets) => [...Object.values(assets.foliage.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark)];
    // The loader also fetches the valley's baked land map and the sky's baked cloud field
    // (verdant-hills-land.js). A stub texture loader cannot serve either, so the loader goes
    // without and says so for each: kept quiet here.
    let warn = null;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('loads every file once and returns the parsed bundle', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const isCurrent = vi.fn(() => true);
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadVerdantHillsAssets({ loader, textureLoader, isCurrent });
        const requested = loader.loadAsync.mock.calls.map(([url]) => url);
        expect([...requested].sort()).toEqual([VERDANT_HILLS_FOLIAGE_URL, VERDANT_HILLS_PROPS_URL,
            ...Object.values(VERDANT_HILLS_TREE_URLS)].sort());
        // Three pictures, each asked for once: the sprite sheet, the land map and the cloud field.
        const pictures = textureLoader.loadAsync.mock.calls.map(([url]) => fileNameOf(url));
        expect(textureLoader.loadAsync).toHaveBeenCalledTimes(3);
        expect(pictures.sort()).toEqual([IMPOSTOR_FILE, ...BAKED_PICTURES].sort());
        expect(textureLoader.sprites).toHaveLength(1);
        // Ownership is checked once, after everything has arrived.
        expect(isCurrent).toHaveBeenCalledOnce();
        expect(isCurrent.mock.invocationCallOrder[0])
            .toBeGreaterThan(Math.max(...loader.loadAsync.mock.invocationCallOrder));

        // The same shape as the Summer bundle, with the land map and the cloud field beside it.
        expect(Object.keys(assets).sort()).toEqual(['clouds', 'foliage', 'impostors', 'land', 'props', 'trees']);
        // A two-by-two stand-in is neither baked picture: the bundle carries none, and the
        // loader said so once for each.
        expect(assets.land).toBeNull();
        expect(assets.clouds).toBeNull();
        expect(warn).toHaveBeenCalledTimes(2);
        const said = warn.mock.calls.map(([message]) => String(message));
        expect(said.filter((message) => message.includes('land map'))).toHaveLength(1);
        expect(said.filter((message) => message.includes('cloud field'))).toHaveLength(1);
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        for (const name of TREE_NAMES) {
            expect(Object.keys(assets.trees[name]).sort()).toEqual(['anchors', 'bark', 'barkCoreIndices', 'crownBase',
                'crownCentre', 'crownRadii', 'foliage', 'height', 'name', 'role', 'sites', 'species', 'trunkRadius',
                'weatherSide']);
            expect(assets.trees[name].name).toBe(name);
            expect(assets.trees[name].sites.count).toBe(parsed.trees[name].sites.count);
            expect(triangles(assets.trees[name].bark)).toBe(triangles(parsed.trees[name].bark));
        }
        expect(Object.keys(assets.trees['oak-hero'].anchors).sort()).toEqual(['boughTip', 'swing', 'swingLimbRadius']);
        expect(Object.keys(assets.foliage).sort()).toEqual(['meshes', 'records', 'variants']);
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(assets.foliage.variants).toBe(parsed.foliage.variants);
        expect(Object.keys(assets.props).sort()).toEqual(['meshes', 'records', 'variants']);
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        // A prop's anchors and size ride beside its geometry.
        for (const name of REQUIRED_PROPS) {
            expect(assets.props.records[name]).toEqual(verdantHillsPropRecord(name));
            expect(assets.props.records[name].size).toHaveLength(3);
        }
        expect(assets.props.records.windmill.anchors.hub).toHaveLength(3);
        expect(assets.impostors).toEqual({ ...verdantHillsImpostorLayout(), texture: textureLoader.sprites[0] });
        expect(assets.impostors.texture.name).toBe('VerdantHillsFarTreeSprites');
        expect(assets.impostors.texture.colorSpace).toBe(THREE.NoColorSpace);
        // A bundle that is handed over is intact.
        expect(disposal).not.toHaveBeenCalled();
        expect(textureLoader.disposed).not.toContain(textureLoader.sprites[0]);
        disposeVerdantHillsAssets(assets);
        // Released, the sprite sheet goes; no picture the loader was handed outlives the bundle.
        expect(textureLoader.disposed).toContain(textureLoader.sprites[0]);
        expect(new Set(textureLoader.disposed)).toEqual(new Set(textureLoader.textures));
        expect(textureLoader.disposed).toHaveLength(textureLoader.textures.length);
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
        const assets = await loadVerdantHillsAssets({ loader, textureLoader: null });
        // One for the sprays, one for the props, and a mesh and a points material for each tree.
        expect(materials.size).toBe(1 + 1 + TREE_NAMES.length * 2);
        for (const disposal of materials.values()) expect(disposal).toHaveBeenCalled();
        // The geometry the world adopts is not the loader's to throw away.
        const adopted = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        expect(packGeometries(assets).every((geometry) => geometry.attributes.position.count > 0)).toBe(true);
        expect(adopted).not.toHaveBeenCalled();
        disposeVerdantHillsAssets(assets);
        expect(adopted).toHaveBeenCalledTimes(REQUIRED_FOLIAGE.length + REQUIRED_PROPS.length + TREE_NAMES.length);
    });

    it('disposes everything and returns null when the start that asked is no longer current', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadVerdantHillsAssets({ loader, textureLoader, isCurrent: () => false });
        expect(assets).toBeNull();
        expect(loader.loadAsync).toHaveBeenCalledTimes(TREE_NAMES.length + 2);
        const released = disposal.mock.contexts.map((geometry) => geometry.name).sort();
        expect(released).toEqual([...REQUIRED_FOLIAGE, ...REQUIRED_PROPS, ...TREE_NAMES.map(() => 'bark')].sort());
        expect(new Set(disposal.mock.contexts).size).toBe(released.length);
        // The sprite sheet is let go too, and so is every other picture the loader was handed.
        expect(textureLoader.sprites).toHaveLength(1);
        expect(textureLoader.disposed).toContain(textureLoader.sprites[0]);
        expect(new Set(textureLoader.disposed)).toEqual(new Set(textureLoader.textures));
        expect(textureLoader.disposed).toHaveLength(textureLoader.textures.length);
    });

    it('loads a chosen subset of trees, each once, and can skip the sprite sheet', async () => {
        const loader = diskLoader();
        const assets = await loadVerdantHillsAssets({
            trees: ['oak-field-c', 'oak-field-a', 'oak-field-c'], loader, textureLoader: null,
        });
        expect(Object.keys(assets.trees)).toEqual(['oak-field-c', 'oak-field-a']);
        expect(loader.loadAsync).toHaveBeenCalledTimes(4);
        expect(loader.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual(['oak-field-a.glb', 'oak-field-c.glb', FOLIAGE_FILE, PROPS_FILE].sort());
        expect(assets.impostors).toBeNull();
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(Object.keys(assets.props.meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
        disposeVerdantHillsAssets(assets);
    });

    it('rejects an unknown tree name and a failed download', async () => {
        await expect(loadVerdantHillsAssets({
            trees: ['oak-hero', 'maple'], loader: diskLoader(), textureLoader: stubTextureLoader(),
        })).rejects.toThrow('[Verdant Hills] Unknown tree asset "maple".');
        const flaky = diskLoader();
        flaky.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === 'oak-hero.glb') throw new Error('404 oak-hero.glb');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadVerdantHillsAssets({ loader: flaky, textureLoader: stubTextureLoader() }))
            .rejects.toThrow('404 oak-hero.glb');
        const noProps = diskLoader();
        noProps.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === PROPS_FILE) throw new Error('404 props');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadVerdantHillsAssets({ loader: noProps, textureLoader: null })).rejects.toThrow('404 props');
        const noSheet = stubTextureLoader();
        noSheet.loadAsync.mockRejectedValue(new Error('404 sprites'));
        await expect(loadVerdantHillsAssets({ loader: diskLoader(), textureLoader: noSheet }))
            .rejects.toThrow('404 sprites');
    });

    it('rejects a pack whose files were written for another schema', async () => {
        const stale = (file) => {
            const loader = diskLoader();
            loader.loadAsync.mockImplementation(async (url) => {
                const gltf = await parseGlb(fileNameOf(url));
                if (fileNameOf(url) === file) gltf.scene.userData.schemaVersion = VERDANT_HILLS_ASSET_SCHEMA + 1;
                return gltf;
            });
            return loadVerdantHillsAssets({ loader, textureLoader: null });
        };
        const other = VERDANT_HILLS_ASSET_SCHEMA + 1;
        await expect(stale('oak-field-c.glb')).rejects.toThrow(
            `[Verdant Hills] Tree "oak-field-c" has asset schema ${other}; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`,
        );
        await expect(stale(FOLIAGE_FILE)).rejects.toThrow(
            `[Verdant Hills] Foliage has asset schema ${other}; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`,
        );
        await expect(stale(PROPS_FILE)).rejects.toThrow(
            `[Verdant Hills] Props has asset schema ${other}; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`,
        );
    });

    it('releases each geometry and the sprite sheet exactly once', async () => {
        const textureLoader = stubTextureLoader();
        const assets = await loadVerdantHillsAssets({ loader: diskLoader(), textureLoader });
        const geometries = packGeometries(assets);
        expect(new Set(geometries).size).toBe(REQUIRED_FOLIAGE.length + REQUIRED_PROPS.length + TREE_NAMES.length);
        const disposals = [...geometries, assets.impostors.texture].map((resource) => vi.spyOn(resource, 'dispose'));
        disposeVerdantHillsAssets(assets);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('tolerates missing and partial bundles', () => {
        const bark = { dispose: vi.fn() };
        const spray = { dispose: vi.fn() };
        const mill = { dispose: vi.fn() };
        const texture = { dispose: vi.fn() };
        const land = { dispose: vi.fn() };
        const sky = { dispose: vi.fn() };
        for (const assets of [null, undefined, false, 0, {}, {
            foliage: null, props: null, trees: null, impostors: null, land: null, clouds: null,
        }, { foliage: {} }, { foliage: { meshes: {} } }, { props: {} }, { props: { meshes: {} } }, { trees: {} },
        { trees: { sapling: {} } }, { trees: { sapling: { bark: null } } }, { impostors: {} },
        { impostors: { texture: null } }, { land: null }, { clouds: null }, { clouds: {} },
        { clouds: { texture: null, edges: new Float32Array(256) } }]) {
            expect(() => disposeVerdantHillsAssets(assets)).not.toThrow();
        }
        disposeVerdantHillsAssets({ trees: { sapling: { bark } } });
        disposeVerdantHillsAssets({ foliage: { meshes: { spray } } });
        disposeVerdantHillsAssets({ props: { meshes: { mill } } });
        disposeVerdantHillsAssets({ impostors: { texture } });
        // The land map and the cloud field's texture, when the bundle carries them, are released with it.
        disposeVerdantHillsAssets({ land });
        disposeVerdantHillsAssets({ clouds: { texture: sky, edges: new Float32Array(256) } });
        for (const resource of [bark, spray, mill, texture, land, sky]) {
            expect(resource.dispose).toHaveBeenCalledOnce();
        }
        // A whole bundle lets go of every picture it holds, each once.
        const pictures = [{ dispose: vi.fn() }, { dispose: vi.fn() }, { dispose: vi.fn() }];
        disposeVerdantHillsAssets({
            impostors: { texture: pictures[0] }, land: pictures[1], clouds: { texture: pictures[2], edges: null },
        });
        for (const picture of pictures) expect(picture.dispose).toHaveBeenCalledOnce();
    });
});
