import { createHash } from 'node:crypto';
import {
    existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    FOREST_ASSET_SCHEMA, FOREST_FOLIAGE_URL, FOREST_IMPOSTOR_URL, FOREST_PROPS_URL, FOREST_TREE_URLS,
    forestImpostorLayout, parseForestMeshes as parseMeshes, parseForestTree as parseTree,
} from '../../src/themes/forest/forest-assets.js';

// This file vouches for the asset pack itself: what scripts/blender/forest_assets.py wrote into
// src/themes/forest/assets, read through the theme's own parsers. How the loader fetches,
// hands over and releases the pack is the loader's business and is not tested here.
const assetDirectory = new URL('../../src/themes/forest/assets/', import.meta.url);
const generatorDirectory = new URL('../../scripts/blender/', import.meta.url);
const MB = 1000 * 1000;
const SCHEMA = 1;
const FOLIAGE_FILE = 'forest-foliage.glb';
const PROPS_FILE = 'forest-props.glb';
const IMPOSTOR_FILE = 'forest-impostors.png';

// What scripts/blender/forest_night/trees.py grows: the contract with the theme's loader.
const TREES = Object.freeze({
    'spruce-elder': {
        species: 'spruce', role: 'hero', foliage: 'spruce_frond', height: 36, crownBase: 8.1,
    },
    'pine-elder': {
        species: 'pine', role: 'hero', foliage: 'pine_tuft', height: 27, crownBase: 16.74,
    },
    'spruce-old-a': {
        species: 'spruce', role: 'grove', foliage: 'spruce_bough', height: 31, crownBase: 9.3,
    },
    'spruce-old-b': {
        species: 'spruce', role: 'grove', foliage: 'spruce_bough', height: 27, crownBase: 5.4,
    },
    'spruce-old-c': {
        species: 'spruce', role: 'grove', foliage: 'spruce_bough', height: 22, crownBase: 2.2,
    },
    'spruce-young-a': {
        species: 'spruce', role: 'grove', foliage: 'spruce_bough', height: 9, crownBase: 0.36,
    },
    'spruce-young-b': {
        species: 'spruce', role: 'grove', foliage: 'spruce_bough', height: 5, crownBase: 0.2,
    },
    'pine-old-a': {
        species: 'pine', role: 'grove', foliage: 'pine_clump', height: 25, crownBase: 16.5,
    },
    'birch-a': {
        species: 'birch', role: 'grove', foliage: 'birch_strand', height: 17.5, crownBase: 5.6,
    },
    'birch-b': {
        species: 'birch', role: 'grove', foliage: 'birch_strand', height: 16, crownBase: 5.12,
    },
});
const TREE_NAMES = Object.keys(TREES);
const GROVE_NAMES = TREE_NAMES.filter((name) => TREES[name].role === 'grove');
const SPECIES = ['spruce', 'pine', 'birch'];
// Sprays the trees' foliage sites refer to, and the fern fronds the ground is planted with.
const TREE_SPRAY_KINDS = ['spruce_frond', 'spruce_bough', 'pine_tuft', 'pine_clump', 'birch_strand'];
const FERN_FRONDS = ['fern_frond_0', 'fern_frond_1'];
const TREE_SPRAYS = TREE_SPRAY_KINDS.flatMap((kind) => [`${kind}_0`, `${kind}_1`]);
const REQUIRED_FOLIAGE = [...TREE_SPRAYS, ...FERN_FRONDS];
const REQUIRED_PROPS = ['log', 'stump', 'boulder_a', 'boulder_b', 'boulder_c', 'snag'];
const BINARIES = [...TREE_NAMES.map((name) => `${name}.glb`), FOLIAGE_FILE, PROPS_FILE, IMPOSTOR_FILE];

// Ceilings a little above what the Blender generator wrote on 2026-10-08 (noted beside each),
// so the pack cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({
    packBytes: 3.4 * MB, // 2.96 MB for the whole directory
    glbBytes: 0.7 * MB, // spruce-elder.glb, 0.53 MB
    impostorBytes: 1.0 * MB, // 0.83 MB
    barkTriangles: { hero: 30000, grove: 7200 }, // 22,676 and 5,384
    sites: { hero: 1500, grove: 450 }, // 1,146 and 328
    sprayTriangles: 280, // 200
    fernTriangles: { fern_frond_0: [250, 450], fern_frond_1: [100, 180] }, // 371 and 161
    propTriangles: 3400, // 2,487
});

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

/** Smallest and largest value of one component (0 = x/r ... 3 = w/a) of an attribute. */
function channelRange(attribute, component) {
    const getter = ['getX', 'getY', 'getZ', 'getW'][component];
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < attribute.count; index++) {
        min = Math.min(min, attribute[getter](index));
        max = Math.max(max, attribute[getter](index));
    }
    return [min, max];
}

/** Smallest and largest component anywhere in a (possibly normalised integer) attribute. */
function attributeRange(attribute) {
    let min = Infinity;
    let max = -Infinity;
    for (let component = 0; component < attribute.itemSize; component++) {
        const [low, high] = channelRange(attribute, component);
        min = Math.min(min, low);
        max = Math.max(max, high);
    }
    return [min, max];
}

/** Mean of `value(index)` over the vertices `keep(index)` selects, and how many there were. */
function meanWhere(count, keep, value) {
    let sum = 0;
    let kept = 0;
    for (let index = 0; index < count; index++) {
        if (!keep(index)) continue;
        sum += value(index);
        kept += 1;
    }
    return { mean: kept ? sum / kept : NaN, count: kept };
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

const parsed = { trees: {}, foliage: null, props: null };

beforeAll(async () => {
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseTree(gltfs[index], name); });
    parsed.foliage = parseMeshes(await parseGlb(FOLIAGE_FILE), 'Foliage');
    parsed.props = parseMeshes(await parseGlb(PROPS_FILE), 'Props');
}, 60000);

describe('Forest asset pack text files', () => {
    it('are strict UTF-8 with Unix line endings', () => {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        // The decoder really is strict: a lone Windows-1252 dash (0x97) is not UTF-8.
        expect(() => decoder.decode(Uint8Array.of(0x20, 0x97, 0x20))).toThrow();
        const helpers = readdirSync(new URL('forest_night/', generatorDirectory))
            .filter((file) => file.endsWith('.py')).map((file) => new URL(`forest_night/${file}`, generatorDirectory));
        expect(helpers.length).toBeGreaterThanOrEqual(5);
        const files = [new URL('asset-manifest.json', assetDirectory), new URL('ATTRIBUTION.md', assetDirectory),
            new URL('forest_assets.py', generatorDirectory), ...helpers];
        for (const file of files) {
            const bytes = readFileSync(file);
            let text = null;
            expect(() => { text = decoder.decode(bytes); }, `${file.pathname} is not valid UTF-8`).not.toThrow();
            expect(text.includes('\r'), `${file.pathname} has a carriage return`).toBe(false);
            expect(text.includes(String.fromCharCode(0xfffd)), `${file.pathname} has a replacement character`)
                .toBe(false);
            expect([bytes[0], bytes[1], bytes[2]], file.pathname).not.toEqual([0xef, 0xbb, 0xbf]);
            expect(text.endsWith('\n'), `${file.pathname} does not end with a newline`).toBe(true);
        }
    });

    it('says in ATTRIBUTION.md how every file was made and how to make it again', () => {
        const text = readAsset('ATTRIBUTION.md').toString('utf8');
        expect(text).toContain('scripts/blender/forest_assets.py');
        expect(text).toContain('--background --factory-startup');
        expect(text).toMatch(/Blender \d+\.\d+/);
        for (const file of [...TREE_NAMES.map((name) => name.replace(/-[a-c]$/, '')), FOLIAGE_FILE, PROPS_FILE,
            IMPOSTOR_FILE]) {
            expect(text, file).toContain(file.replace(/\.glb$|\.png$/, ''));
        }
        // Every vertex-colour convention the runtime relies on is written down.
        for (const term of ['fern', 'birch', '+Y', '+Z', 'moss', 'occlusion']) expect(text, term).toContain(term);
    });
});

describe('Forest asset pack on disk', () => {
    it('is the pack the theme loader asks for, file for file', () => {
        const fileNameOf = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());
        expect(FOREST_ASSET_SCHEMA).toBe(SCHEMA);
        expect(Object.keys(FOREST_TREE_URLS)).toEqual(TREE_NAMES);
        for (const [name, url] of Object.entries(FOREST_TREE_URLS)) expect(fileNameOf(url)).toBe(`${name}.glb`);
        expect(fileNameOf(FOREST_FOLIAGE_URL)).toBe(FOLIAGE_FILE);
        expect(fileNameOf(FOREST_PROPS_URL)).toBe(PROPS_FILE);
        expect(fileNameOf(FOREST_IMPOSTOR_URL)).toBe(IMPOSTOR_FILE);
        // The sprite-sheet layout the loader hands out is the manifest's own record.
        const record = readManifest().assets.find((entry) => entry.kind === 'impostors');
        expect(forestImpostorLayout())
            .toEqual({ atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles });
    });

    it('ships exactly the binaries the theme loads, each present and non-empty', () => {
        expect(TREE_NAMES).toHaveLength(10);
        for (const file of BINARIES) {
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(statSync(new URL(file, assetDirectory)).size, file).toBeGreaterThan(0);
        }
        const shipped = readdirSync(assetDirectory)
            .filter((file) => /\.(glb|png|jpe?g|webp|ktx2|bin)$/i.test(file)).sort();
        expect(shipped).toEqual([...BINARIES].sort());
        // No scratch folder from the sprite bake is left behind in the pack.
        expect(readdirSync(assetDirectory).sort())
            .toEqual([...BINARIES, 'ATTRIBUTION.md', 'asset-manifest.json'].sort());
        expect(readAsset(IMPOSTOR_FILE).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('keeps the whole pack under 3.4 megabytes', () => {
        const files = readdirSync(assetDirectory);
        const total = files.reduce((sum, file) => sum + statSync(new URL(file, assetDirectory)).size, 0);
        expect(total).toBeLessThan(BUDGET.packBytes);
        const fetched = files.filter((file) => /\.(glb|png)$/.test(file));
        expect(fetched).toHaveLength(13);
        for (const file of files.filter((entry) => entry.endsWith('.glb'))) {
            expect(statSync(new URL(file, assetDirectory)).size, file).toBeLessThanOrEqual(BUDGET.glbBytes);
        }
        expect(statSync(new URL(IMPOSTOR_FILE, assetDirectory)).size).toBeLessThanOrEqual(BUDGET.impostorBytes);
        // The manifest's own arithmetic agrees.
        expect(readManifest().assets.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThan(BUDGET.packBytes);
    });

    it('matches every manifest entry byte for byte', () => {
        const manifest = readManifest();
        expect(manifest.schemaVersion).toBe(SCHEMA);
        expect(manifest.glTFUpAxis).toBe('Y');
        expect(Array.isArray(manifest.assets)).toBe(true);
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
        // Every binary is vouched for, and nothing else is listed.
        expect([...seen].sort()).toEqual([...BINARIES].sort());
        expect(manifest.assets.filter((entry) => entry.kind === 'impostors')).toHaveLength(1);
        expect(manifest.assets.find((entry) => entry.kind === 'impostors').file).toBe(IMPOSTOR_FILE);
        expect(manifest.assets.find((entry) => entry.kind === 'foliage').file).toBe(FOLIAGE_FILE);
        expect(manifest.assets.find((entry) => entry.kind === 'props').file).toBe(PROPS_FILE);
        expect(manifest.assets.filter((entry) => entry.kind === 'tree')).toHaveLength(TREE_NAMES.length);
    });

    it('describes each tree and both mesh packs the way the files really are', () => {
        const manifest = readManifest();
        for (const entry of manifest.assets) {
            if (entry.kind === 'tree') {
                const tree = parsed.trees[entry.file.replace(/\.glb$/, '')];
                expect(tree, entry.file).toBeDefined();
                expect(entry).toMatchObject({
                    species: tree.species, role: tree.role, foliage: tree.foliage, height: tree.height,
                });
                expect(entry.sites).toBe(tree.sites.count);
                expect(entry.barkTriangles).toBe(triangles(tree.bark));
            }
            if (entry.kind === 'foliage' || entry.kind === 'props') {
                const pack = parsed[entry.kind];
                expect(Object.keys(entry.meshes).sort()).toEqual(Object.keys(pack.meshes).sort());
                for (const [name, record] of Object.entries(entry.meshes)) {
                    const geometry = pack.meshes[name];
                    expect(record.triangles, name).toBe(triangles(geometry));
                    // The recorded bounds are the mesh's own, to the quantisation step.
                    geometry.boundingBox.min.toArray().forEach((value, axis) => {
                        expect(record.boundsMin[axis], `${name} min ${axis}`).toBeCloseTo(value, 2);
                    });
                    geometry.boundingBox.max.toArray().forEach((value, axis) => {
                        expect(record.boundsMax[axis], `${name} max ${axis}`).toBeCloseTo(value, 2);
                    });
                }
            }
        }
    });
});

describe('Forest tree assets', () => {
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
        expect(json.nodes.map((node) => node.name).sort()).toEqual(['bark', 'sites']);
        const primitive = (nodeName) => {
            const node = json.nodes.find((entry) => entry.name === nodeName);
            expect(node, nodeName).toBeDefined();
            // The loader decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            return json.meshes[node.mesh].primitives[0];
        };
        const bark = primitive('bark');
        expect(bark.mode ?? 4).toBe(4);
        expect(Object.keys(bark.attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0']);
        expect(bark.indices).toBeDefined();
        // Quantised the way the loader expects: int16 positions, int8 normals, 8-bit colour.
        expect(json.accessors[bark.attributes.POSITION]).toMatchObject({ componentType: 5122, normalized: true });
        expect(json.accessors[bark.attributes.NORMAL]).toMatchObject({ componentType: 5120, normalized: true });
        expect(json.accessors[bark.attributes.TEXCOORD_0]).toMatchObject({ componentType: 5126, type: 'VEC2' });
        expect(json.accessors[bark.attributes.COLOR_0]).toMatchObject({
            componentType: 5121, normalized: true, type: 'VEC4',
        });
        const sites = primitive('sites');
        expect(sites.mode).toBe(0);
        expect(Object.keys(sites.attributes).sort()).toEqual(['POSITION', '_BENT', '_KIND', '_PARAMS', '_ROT']);
        expect(json.accessors[sites.attributes._ROT]).toMatchObject({ componentType: 5122, type: 'VEC4' });
        expect(json.accessors[sites.attributes._PARAMS]).toMatchObject({ componentType: 5121, type: 'VEC4' });
        expect(json.accessors[sites.attributes._BENT]).toMatchObject({ componentType: 5120, type: 'VEC4' });
        expect(json.accessors[sites.attributes._KIND]).toMatchObject({ componentType: 5121, type: 'VEC4' });
        const meta = json.scenes[0].extras;
        expect(meta).toMatchObject({ schemaVersion: SCHEMA, name, scaleRange: 2.5 });
        expect(meta).toMatchObject({
            species: TREES[name].species, role: TREES[name].role, foliage: TREES[name].foliage,
        });
        expect(name.startsWith(`${meta.species}-`)).toBe(true);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
        for (const key of ['crownCentre', 'crownRadii', 'boundsMin', 'boundsMax']) {
            expect(meta[key], key).toHaveLength(3);
            expect(meta[key].every(Number.isFinite), key).toBe(true);
        }
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        const expected = TREES[name];
        expect(tree).toMatchObject({
            name, species: expected.species, role: expected.role, foliage: expected.foliage,
        });
        expect(tree.height).toBeCloseTo(expected.height, 5);
        expect(tree.crownBase).toBeCloseTo(expected.crownBase, 1);
        expect(tree.crownBase).toBeLessThan(tree.height * 0.7);
        // From a sapling's stem to an elder a person could not reach around.
        expect(tree.trunkRadius).toBeGreaterThan(0.08);
        expect(tree.trunkRadius).toBeLessThan(tree.height / 20);
        // A pine carries its crown high on a bare trunk.
        if (tree.species === 'pine') expect(tree.crownBase).toBeGreaterThan(tree.height * 0.55);

        const { bark } = tree;
        expectWellFormedMesh(bark, 'bark');
        const { position, color } = bark.attributes;
        const [minY, maxY] = extent(position.array, 3, 1);
        // The root flare (and an elder's surface roots) dip into the soil.
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
            expect(max - min).toBeLessThan(tree.height * 1.05);
        }
        expect(bark.boundingBox.min.y).toBeCloseTo(minY, 5);
        expect(bark.boundingBox.max.y).toBeCloseTo(maxY, 5);
        expect(triangles(bark)).toBeLessThanOrEqual(BUDGET.barkTriangles[tree.role]);
        expect(triangles(bark)).toBeGreaterThan(1000);
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
        // Blue is the baked occlusion: a real spread, darkest in the crevices, never pure black.
        const [darkest, lightest] = channelRange(color, 2);
        expect(darkest).toBeGreaterThan(0.05);
        expect(lightest - darkest).toBeGreaterThan(0.3);
        // Red is how far the wind may carry the vertex: nothing at the foot, most at the tips.
        const [still, loose] = channelRange(color, 0);
        expect(still).toBeLessThan(0.02);
        expect(loose).toBeGreaterThan(0.3);
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
        expect(smallest).toBeGreaterThan(0.25);
        expect(largest).toBeLessThanOrEqual(2.5);
        // They sit on the limbs: on or above the ground, never above the leader, within reach of the bark.
        const { boundingBox } = tree.bark;
        const [lowest, highest] = extent(sites.position, 3, 1);
        expect(lowest).toBeGreaterThan(0);
        if (tree.species !== 'spruce') expect(lowest).toBeGreaterThan(tree.crownBase * 0.8);
        expect(highest).toBeLessThanOrEqual(tree.height * 1.1);
        expect(highest).toBeGreaterThan(tree.height * 0.8);
        for (const [offset, axis] of [[0, 'x'], [2, 'z']]) {
            const [min, max] = extent(sites.position, 3, offset);
            expect(min).toBeGreaterThan(boundingBox.min[axis] - 2);
            expect(max).toBeLessThan(boundingBox.max[axis] + 2);
        }
        // Each site names a spray variant the foliage pack really has.
        const { variants, meshes } = parsed.foliage;
        expect(tree.foliage.startsWith(`${tree.species}_`)).toBe(true);
        for (let variant = 0; variant < variants; variant++) {
            expect(meshes[`${tree.foliage}_${variant}`], `${tree.foliage}_${variant}`).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBeGreaterThan(1);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it('grows the elders as giants: girth, a root plate, and boughs that hang over the path', () => {
        const elder = parsed.trees['spruce-elder'];
        const pine = parsed.trees['pine-elder'];
        for (const name of GROVE_NAMES) {
            const other = parsed.trees[name];
            if (other.species === 'spruce') expect(elder.trunkRadius).toBeGreaterThan(other.trunkRadius * 1.3);
            if (other.species === 'spruce') expect(elder.height).toBeGreaterThan(other.height);
        }
        expect(elder.trunkRadius).toBeGreaterThan(0.7);
        for (const tree of [elder, pine]) {
            const { position } = tree.bark.attributes;
            // Surface roots: bark near the ground a long way from the trunk, all of it in the core.
            let reach = 0;
            for (let index = 0; index < tree.barkCoreIndices; index++) {
                const vertex = tree.bark.index.getX(index);
                if (position.getY(vertex) > 0.05 && position.getY(vertex) < 1.2) {
                    reach = Math.max(reach, Math.hypot(position.getX(vertex), position.getZ(vertex)));
                }
            }
            expect(reach).toBeGreaterThan(tree.trunkRadius * 3);
            expect(reach).toBeLessThan(8);
            // The trunk is meshed finely where the camera stands.
            const foot = meanWhere(position.count, (index) => position.getY(index) < 3, () => 1);
            expect(foot.count).toBeGreaterThan(1500);
        }
        // The spruce's lowest boughs hang between head height and the first whorls of the crown.
        const { sites } = elder;
        const [lowest] = extent(sites.position, 3, 1);
        expect(lowest).toBeGreaterThan(3);
        expect(lowest).toBeLessThan(5);
        let hanging = 0;
        let reach = 0;
        for (let index = 0; index < sites.count; index++) {
            if (sites.position[index * 3 + 1] >= 7) continue;
            hanging += 1;
            reach = Math.max(reach, Math.hypot(sites.position[index * 3], sites.position[index * 3 + 2]));
        }
        expect(hanging).toBeGreaterThan(20);
        expect(hanging).toBeLessThan(sites.count * 0.25);
        expect(reach).toBeGreaterThan(4.5);
        // The pine's trunk is bare to its high crown.
        expect(extent(pine.sites.position, 3, 1)[0]).toBeGreaterThan(15);
        // Heroes wear the fine needles, the far trees the coarse ones.
        const { meshes } = parsed.foliage;
        expect(triangles(meshes.spruce_frond_0)).toBeGreaterThan(triangles(meshes.spruce_bough_0));
        expect(triangles(meshes.pine_tuft_0)).toBeGreaterThan(triangles(meshes.pine_clump_0));
    });

    it('skirts the young spruces to the ground and lifts the old crowns clear of it', () => {
        for (const name of ['spruce-young-a', 'spruce-young-b', 'spruce-old-c']) {
            expect(extent(parsed.trees[name].sites.position, 3, 1)[0], name).toBeLessThan(0.6);
        }
        expect(extent(parsed.trees['spruce-old-a'].sites.position, 3, 1)[0]).toBeGreaterThan(5);
        // Tall and narrow against the sky, the youngsters broad for their height.
        const slenderness = (name) => {
            const { position } = parsed.trees[name].sites;
            const [minX, maxX] = extent(position, 3, 0);
            return (maxX - minX) / parsed.trees[name].height;
        };
        expect(slenderness('spruce-old-a')).toBeLessThan(0.36);
        expect(slenderness('spruce-young-a')).toBeGreaterThan(slenderness('spruce-old-a'));
    });

    it.each(['birch-a', 'birch-b'])('%s is a slender pale stem whose alpha marks its dark bark', (name) => {
        const tree = parsed.trees[name];
        expect(tree.trunkRadius).toBeLessThan(0.24);
        expect(tree.height / tree.trunkRadius).toBeGreaterThan(70);
        const { position, color } = tree.bark.attributes;
        const core = new Set();
        for (let index = 0; index < tree.barkCoreIndices; index++) core.add(tree.bark.index.getX(index));
        const trunk = (low, high) => (index) => core.has(index) && position.getY(index) >= low
            && position.getY(index) < high;
        const dark = (index) => color.getW(index);
        // Black and rough at the foot, white up the stem, brown again where it thins to a twig.
        expect(meanWhere(position.count, trunk(-1, 0.4), dark).mean).toBeGreaterThan(0.9);
        const stem = meanWhere(position.count, trunk(1.6, tree.height * 0.6), dark);
        expect(stem.count).toBeGreaterThan(200);
        expect(stem.mean).toBeLessThan(0.35);
        expect(meanWhere(position.count, trunk(tree.height * 0.97, 99), dark).mean).toBeGreaterThan(0.8);
        // The stem is mostly clean white bark, broken by the scars under its limbs.
        const white = meanWhere(position.count, trunk(1.6, tree.height * 0.6), (index) => (dark(index) < 0.1 ? 1 : 0));
        const scarred = meanWhere(
            position.count,
            trunk(1.6, tree.height * 0.6),
            (index) => (dark(index) > 0.7 ? 1 : 0),
        );
        expect(white.mean).toBeGreaterThan(0.35);
        expect(scarred.mean).toBeGreaterThan(0.02);
        expect(scarred.mean).toBeLessThan(0.3);
        // It leans and recovers: the top is off the vertical through its foot, but only slightly.
        let top = [0, -Infinity, 0];
        for (const index of core) {
            if (position.getY(index) > top[1]) top = [position.getX(index), position.getY(index), position.getZ(index)];
        }
        const lean = Math.hypot(top[0], top[2]);
        expect(lean).toBeGreaterThan(0.2);
        expect(lean).toBeLessThan(tree.height * 0.2);
        // Weeping: a site's rotation carries the spray's +Y (along the twig) to point at the ground.
        const { rotation, count } = tree.sites;
        let hanging = 0;
        let fall = 0;
        for (let index = 0; index < count; index++) {
            const forwardY = 1 - 2 * (rotation[index * 4] ** 2 + rotation[index * 4 + 2] ** 2);
            fall += forwardY;
            if (forwardY < -0.5) hanging += 1;
        }
        expect(fall / count).toBeLessThan(-0.45);
        expect(hanging / count).toBeGreaterThan(0.5);
    });
});

describe('Forest foliage and props packs', () => {
    it.each([[FOLIAGE_FILE], [PROPS_FILE]])('%s is a compact, texture-free GLB', (file) => {
        const { json } = readGlb(file);
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.materials ?? []).toHaveLength(0);
        expect(json.animations ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(SCHEMA);
        for (const node of json.nodes) {
            // The loader decodes through translation and scale only.
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
            expect(json.meshes[node.mesh].primitives).toHaveLength(1);
            const primitive = json.meshes[node.mesh].primitives[0];
            expect(primitive.mode ?? 4).toBe(4);
            expect(Object.keys(primitive.attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0']);
        }
        expect(new Set(json.nodes.map((node) => node.name)).size).toBe(json.nodes.length);
    });

    it('has every spray the trees reference plus both fern fronds, and nothing else', () => {
        const { variants, meshes } = parsed.foliage;
        expect(variants).toBe(2);
        expect(readGlb(FOLIAGE_FILE).json.scenes[0].extras.variants).toBe(2);
        for (const name of REQUIRED_FOLIAGE) expect(meshes[name], name).toBeDefined();
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        const referenced = new Set();
        for (const tree of Object.values(parsed.trees)) {
            // The way a forest builds its bucket keys: kind, then the site's variant.
            for (const variant of tree.sites.variant) referenced.add(`${tree.foliage}_${variant % variants}`);
        }
        expect([...referenced].sort()).toEqual([...TREE_SPRAYS].sort());
    });

    it.each(TREE_SPRAYS)('%s is a small, complete spray growing from its attachment point', (name) => {
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
        expect(geometry.boundingBox.max.y).toBeGreaterThan(0.75);
        const [low, high] = attributeRange(geometry.attributes.uv);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        // Leaf or needle (1) against wood (0) is painted into alpha; red runs from the shoot to the tips.
        const { color } = geometry.attributes;
        const leafy = meanWhere(color.count, () => true, (index) => (color.getW(index) > 0.5 ? 1 : 0));
        expect(leafy.mean).toBeGreaterThan(0.3);
        expect(channelRange(color, 0)[1]).toBeGreaterThan(0.95);
        expect(channelRange(color, 0)[0]).toBeLessThan(0.05);
    });

    it('hangs a birch strand below its twig', () => {
        for (const name of ['birch_strand_0', 'birch_strand_1']) {
            const box = parsed.foliage.meshes[name].boundingBox;
            // +Z is the lit upper side of a spray; a weeping strand falls away from it.
            expect(box.min.z, name).toBeLessThan(-0.25);
            expect(box.max.z, name).toBeLessThan(0.2);
        }
    });

    it.each(FERN_FRONDS)('%s is one arching frond in spray space with its documented vertex data', (name) => {
        const geometry = parsed.foliage.meshes[name];
        expectWellFormedMesh(geometry, name);
        const [fewest, most] = BUDGET.fernTriangles[name];
        expect(triangles(geometry)).toBeGreaterThanOrEqual(fewest);
        expect(triangles(geometry)).toBeLessThanOrEqual(most);
        const {
            position, color, uv, normal,
        } = geometry.attributes;
        const box = geometry.boundingBox;
        // It leaves the origin along +Y...
        expect(box.min.y).toBeGreaterThan(-0.03);
        expect(box.min.y).toBeLessThan(0.01);
        expect(box.max.y).toBeGreaterThan(0.6);
        expect(box.max.y).toBeLessThan(1.05);
        // ...spreads its leaflets along +-X, about a third as wide as it is long...
        expect(box.min.x).toBeLessThan(-0.12);
        expect(box.max.x).toBeGreaterThan(0.12);
        expect(box.max.x - box.min.x).toBeLessThan(0.6);
        // ...and arches over toward -Z, the underside of its upper face.
        expect(box.max.z).toBeLessThan(0.08);
        expect(box.min.z).toBeLessThan(-0.25);
        expect(box.min.z).toBeGreaterThan(-0.8);
        const blade = (index) => color.getW(index) > 0.5;
        const stalk = (index) => color.getW(index) < 0.5;
        // Alpha: 1 on the blade, 0 on the stalk, nothing in between.
        for (let index = 0; index < color.count; index++) expect([0, 1]).toContain(color.getW(index));
        expect(meanWhere(color.count, () => true, (index) => (blade(index) ? 1 : 0)).mean).toBeGreaterThan(0.7);
        expect(meanWhere(color.count, stalk, () => 1).count).toBeGreaterThan(10);
        // Red: 0 where the stalk leaves the ground, 1 at the tip.
        let foot = null;
        let tip = null;
        for (let index = 0; index < color.count; index++) {
            if (!stalk(index)) continue;
            if (foot === null || color.getX(index) < color.getX(foot)) foot = index;
            if (tip === null || color.getX(index) > color.getX(tip)) tip = index;
        }
        expect(color.getX(foot)).toBe(0);
        expect(Math.hypot(position.getX(foot), position.getY(foot), position.getZ(foot))).toBeLessThan(0.02);
        expect(color.getX(tip)).toBeGreaterThan(0.9);
        expect(position.getY(tip)).toBeGreaterThan(0.6);
        expect(position.getZ(tip)).toBeLessThan(-0.2);
        expect(channelRange(color, 0)[1]).toBeGreaterThan(0.9);
        // Green: one id per leaflet, 0 on the stalk.
        const ids = new Set();
        for (let index = 0; index < color.count; index++) {
            if (blade(index)) ids.add(color.getY(index));
            else expect(color.getY(index)).toBe(0);
        }
        expect(ids.size).toBeGreaterThan(24);
        // Blue: shade, darker on the stalk than out on the leaflets, never black.
        expect(channelRange(color, 2)[0]).toBeGreaterThan(0.2);
        expect(meanWhere(color.count, blade, (index) => color.getZ(index)).mean)
            .toBeGreaterThan(meanWhere(color.count, stalk, (index) => color.getZ(index)).mean + 0.15);
        // UV is the frond pressed flat at one scale: u across (the stalk down the middle, the longer
        // side reaching the edge of the square), v along.
        const [left, right] = channelRange(uv, 0);
        expect(left).toBeLessThan(0.1);
        expect(right).toBeGreaterThan(0.9);
        expect(Math.min(left, 1 - right)).toBeLessThan(0.005);
        expect(channelRange(uv, 1)[0]).toBeLessThan(0.02);
        expect(channelRange(uv, 1)[1]).toBeGreaterThan(0.98);
        expect(attributeRange(uv)[0]).toBeGreaterThanOrEqual(0);
        expect(attributeRange(uv)[1]).toBeLessThanOrEqual(1);
        for (let index = 0; index < uv.count; index++) {
            if (stalk(index)) expect(Math.abs(uv.getX(index) - 0.5)).toBeLessThan(0.05);
            // v follows the sway weight: a leaflet is attached at `red` and sweeps a little toward the tip.
            else expect(uv.getY(index) - color.getX(index)).toBeGreaterThan(-0.08);
            if (blade(index)) expect(uv.getY(index) - color.getX(index)).toBeLessThan(0.2);
        }
        // Leaflets sit on both sides of the stalk in near-equal numbers.
        const rightShare = meanWhere(color.count, blade, (index) => (uv.getX(index) > 0.5 ? 1 : 0)).mean;
        expect(rightShare).toBeGreaterThan(0.4);
        expect(rightShare).toBeLessThan(0.6);
        // The upper face is +Z where the frond leaves the ground.
        expect(meanWhere(
            color.count,
            (index) => blade(index) && color.getX(index) < 0.4,
            (index) => normal.getZ(index),
        ).mean).toBeGreaterThan(0.5);
    });

    it('makes the far frond the lighter of the two', () => {
        const { meshes } = parsed.foliage;
        expect(triangles(meshes.fern_frond_1)).toBeLessThan(triangles(meshes.fern_frond_0) * 0.6);
    });

    it('has every prop the glade places, and nothing else', () => {
        const { meshes } = parsed.props;
        for (const name of REQUIRED_PROPS) expect(meshes[name], name).toBeDefined();
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_PROPS].sort());
    });

    it.each(REQUIRED_PROPS)('%s is a complete, finite mesh with baked occlusion inside its triangle budget', (name) => {
        const geometry = parsed.props.meshes[name];
        expectWellFormedMesh(geometry, name);
        expect(triangles(geometry)).toBeGreaterThan(300);
        expect(triangles(geometry)).toBeLessThanOrEqual(BUDGET.propTriangles);
        // Blue is occlusion baked with the prop on the ground: dark underneath, open on top.
        const { color } = geometry.attributes;
        const [darkest, lightest] = channelRange(color, 2);
        expect(darkest).toBeGreaterThanOrEqual(0.1 - 1 / 255);
        expect(lightest - darkest).toBeGreaterThan(0.3);
        // Alpha is moss: there is some, and it is not everywhere.
        const [bare, mossy] = channelRange(color, 3);
        expect(bare).toBeLessThan(0.02);
        expect(mossy).toBeGreaterThan(0.3);
    });

    it('models the props at the sizes and origins the glade places them by', () => {
        const box = (name) => parsed.props.meshes[name].boundingBox;
        const size = (name) => box(name).getSize(new THREE.Vector3());
        const centre = (name) => box(name).getCenter(new THREE.Vector3());
        // The fallen spruce: seven and a half metres along X, its middle on the origin, bedded in the ground.
        expect(size('log').x).toBeGreaterThan(7.2);
        expect(size('log').x).toBeLessThan(7.8);
        expect(Math.abs(centre('log').x)).toBeLessThan(0.15);
        expect(size('log').z).toBeLessThan(2.6);
        expect(box('log').min.y).toBeLessThan(-0.03);
        expect(box('log').min.y).toBeGreaterThan(-0.35);
        expect(box('log').max.y).toBeGreaterThan(0.75);
        expect(box('log').max.y).toBeLessThan(1.7);
        // Its trunk is about 0.42 m in radius at the torn butt (-X) and tapers toward +X.
        const { position: logPosition, color: logColor } = parsed.props.meshes.log.attributes;
        const girth = (low, high) => {
            let top = -Infinity;
            for (let index = 0; index < logPosition.count; index++) {
                // Green 0.12 is the trunk's own part id (see ATTRIBUTION.md); the stubs and torn ends have others.
                if (Math.abs(logColor.getY(index) - 0.12) > 0.004) continue;
                if (logPosition.getX(index) >= low && logPosition.getX(index) < high) {
                    top = Math.max(top, logPosition.getY(index));
                }
            }
            return top;
        };
        expect(girth(-3, -2)).toBeGreaterThan(0.6);
        expect(girth(-3, -2)).toBeLessThan(0.95);
        expect(girth(2.5, 3.5)).toBeLessThan(girth(-3, -2) - 0.1);
        // The stump stands on the origin: knee high, splinters higher, roots running out around it.
        expect(box('stump').max.y).toBeGreaterThan(0.6);
        expect(box('stump').max.y).toBeLessThan(1.1);
        expect(box('stump').min.y).toBeLessThan(-0.2);
        expect(box('stump').min.y).toBeGreaterThan(-0.8);
        expect(Math.min(size('stump').x, size('stump').z)).toBeGreaterThan(1.6);
        expect(Math.max(size('stump').x, size('stump').z)).toBeLessThan(5.5);
        expect(box('stump').containsPoint(new THREE.Vector3(0, 0.3, 0))).toBe(true);
        // Three boulders, big to small, each bedded a little into the ground it is set on.
        const widths = ['boulder_a', 'boulder_b', 'boulder_c'].map((name) => Math.max(size(name).x, size(name).z));
        expect(widths[0]).toBeGreaterThan(2.1);
        expect(widths[0]).toBeLessThan(2.8);
        expect(widths[1]).toBeGreaterThan(1.3);
        expect(widths[1]).toBeLessThan(1.95);
        expect(widths[2]).toBeGreaterThan(0.75);
        expect(widths[2]).toBeLessThan(1.2);
        for (const name of ['boulder_a', 'boulder_b', 'boulder_c']) {
            expect(box(name).min.y).toBeLessThan(-0.08);
            expect(box(name).max.y).toBeGreaterThan(0.25);
            expect(box(name).max.y).toBeGreaterThan(-box(name).min.y * 1.5);
            expect(box(name).containsPoint(new THREE.Vector3(0, 0.05, 0))).toBe(true);
        }
        // The dead spruce stands on its origin, about eleven metres of it.
        expect(box('snag').max.y).toBeGreaterThan(10.5);
        expect(box('snag').max.y).toBeLessThan(12.5);
        expect(box('snag').min.y).toBeGreaterThan(-1);
        expect(box('snag').min.y).toBeLessThan(0);
        expect(box('snag').containsPoint(new THREE.Vector3(0, 1, 0))).toBe(true);
    });

    it.each(['log', 'stump', 'boulder_a', 'boulder_b', 'boulder_c'])('%s wears its moss on top', (name) => {
        const { normal, color } = parsed.props.meshes[name].attributes;
        const moss = (index) => color.getW(index);
        const sky = meanWhere(color.count, (index) => normal.getY(index) > 0.6, moss);
        const under = meanWhere(color.count, (index) => normal.getY(index) < -0.4, moss);
        expect(sky.count).toBeGreaterThan(20);
        expect(under.count).toBeGreaterThan(10);
        expect(sky.mean).toBeGreaterThan(0.25);
        expect(under.mean).toBeLessThan(0.03);
    });

    it('marks torn heartwood apart from bark in the tone channel', () => {
        for (const name of ['log', 'stump']) {
            const { color } = parsed.props.meshes[name].attributes;
            const pale = meanWhere(color.count, () => true, (index) => (color.getX(index) > 0.8 ? 1 : 0));
            const dark = meanWhere(color.count, () => true, (index) => (color.getX(index) < 0.56 ? 1 : 0));
            expect(pale.mean, name).toBeGreaterThan(0.03);
            expect(dark.mean, name).toBeGreaterThan(0.25);
            // Torn wood carries next to no moss.
            expect(meanWhere(color.count, (index) => color.getX(index) > 0.8, (index) => color.getW(index)).mean, name)
                .toBeLessThan(0.12);
        }
    });
});

describe('Forest far-stand sprite sheet', () => {
    const layout = () => {
        const record = readManifest().assets.find((entry) => entry.kind === 'impostors');
        return { atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles };
    };

    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const { atlasWidth, atlasHeight, tiles } = layout();
        const png = readAsset(IMPOSTOR_FILE);
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(atlasWidth);
        expect(png.readUInt32BE(20)).toBe(atlasHeight);
        // Shade, foliage mask, hue seed and coverage: four 8-bit channels.
        expect([png[24], png[25]]).toEqual([8, 6]);
        expect(tiles.length).toBeGreaterThan(0);
        const ordered = [...tiles].sort((a, b) => a.x - b.x);
        let cursor = 0;
        for (const tile of ordered) {
            expect(Number.isInteger(tile.x)).toBe(true);
            expect(Number.isInteger(tile.pixels)).toBe(true);
            expect(tile.pixels).toBeGreaterThan(0);
            // Inside the atlas, and not on top of the tile before it.
            expect(tile.x).toBeGreaterThanOrEqual(cursor);
            expect(tile.x + tile.pixels).toBeLessThanOrEqual(atlasWidth);
            cursor = tile.x + tile.pixels;
        }
        // The sheet is exactly its tiles: no empty margin.
        expect(cursor).toBe(atlasWidth);
        // Small enough for the GPUs the theme's lowest tier runs on.
        expect(atlasWidth).toBeLessThanOrEqual(2048);
        expect(atlasHeight).toBeLessThanOrEqual(512);
    });

    it('gives every grove tree one tile at its true proportions', () => {
        const { atlasHeight, tiles } = layout();
        for (const tile of tiles) {
            const tree = parsed.trees[tile.asset];
            expect(tree, tile.asset).toBeDefined();
            expect(tree.role).toBe('grove');
            expect(tile.species).toBe(tree.species);
            // Metres on the card match pixels on the sheet, so no sprite is stretched.
            expect(tile.width / tile.height).toBeCloseTo(tile.pixels / atlasHeight, 3);
            expect(tile.height).toBeGreaterThan(tree.height * 0.9);
            expect(tile.height).toBeLessThan(tree.height * 1.3);
            // Where the trunk stands, as a fraction of the tile width from its centre.
            expect(Math.abs(tile.trunk)).toBeLessThan(0.5);
            expect(tile.coverage).toBeGreaterThan(0.08);
            expect(tile.coverage).toBeLessThanOrEqual(1);
        }
        // Each grove tree once, in recipe order, all three species; the elders have no far silhouette.
        expect(tiles.map((tile) => tile.asset)).toEqual(GROVE_NAMES);
        expect(new Set(tiles.map((tile) => tile.species))).toEqual(new Set(SPECIES));
    });
});
