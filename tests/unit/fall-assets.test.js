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
    FALL_ASSET_SCHEMA, FALL_FOLIAGE_URL, FALL_IMPOSTOR_URL, FALL_TREE_URLS, disposeFallAssets, fallImpostorLayout,
    loadFallAssets, parseFallFoliage, parseFallTree, prepareImpostorTexture,
} from '../../src/themes/fall/fall-assets.js';
import { FALL_FEATURE_TREES, layoutFallGrove } from '../../src/themes/fall/fall-composition.js';

const assetDirectory = new URL('../../src/themes/fall/assets/', import.meta.url);
const MIB = 1024 * 1024;
const TREE_NAMES = Object.keys(FALL_TREE_URLS);
const SPECIES = ['maple', 'oak', 'birch'];
// Every mesh the runtime asks the foliage pack for: crown sprays per species (two variants
// each), the leaf in the air, and the litter on the floor.
const REQUIRED_FOLIAGE = ['maple_spray_0', 'maple_spray_1', 'maple_clump_0', 'maple_clump_1', 'oak_spray_0',
    'oak_spray_1', 'birch_strand_0', 'birch_strand_1', 'leaf_maple', 'leaf_maple_far', 'leaf_oak', 'leaf_birch'];

// Generous ceilings, roughly 40% above what the Blender generator wrote on 2026-10-05
// (noted beside each), so the pack cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({
    directoryBytes: 4.6 * MIB, // 3.27 MiB
    glbBytes: 1.35 * MIB, // maple-hero.glb, 0.94 MiB
    impostorBytes: 1.3 * MIB, // 0.90 MiB
    barkTriangles: { hero: 56000, grove: 7500 }, // 39,460 and 5,272
    sites: { hero: 1850, grove: 350 }, // 1,293 and 244
    sprayTriangles: 330, // 234
    leafTriangles: 26, // 18
});

function fileNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

function readAsset(file) {
    return readFileSync(new URL(file, assetDirectory));
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

function triangles(geometry) {
    return geometry.index.count / 3;
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

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const parsed = { trees: {}, foliage: null };

beforeAll(async () => {
    const gltfs = await Promise.all(TREE_NAMES.map((name) => parseGlb(`${name}.glb`)));
    TREE_NAMES.forEach((name, index) => { parsed.trees[name] = parseFallTree(gltfs[index], name); });
    parsed.foliage = parseFallFoliage(await parseGlb('fall-foliage.glb'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Fall asset pack on disk', () => {
    it('points every URL at a file that exists in the asset directory', () => {
        expect(Object.isFrozen(FALL_TREE_URLS)).toBe(true);
        expect(TREE_NAMES.length).toBeGreaterThan(0);
        const referenced = [];
        for (const [name, url] of Object.entries(FALL_TREE_URLS)) {
            expect(fileNameOf(url)).toBe(`${name}.glb`);
            referenced.push(fileNameOf(url));
        }
        expect(fileNameOf(FALL_FOLIAGE_URL)).toBe('fall-foliage.glb');
        expect(fileNameOf(FALL_IMPOSTOR_URL)).toBe('fall-impostors.png');
        referenced.push(fileNameOf(FALL_FOLIAGE_URL), fileNameOf(FALL_IMPOSTOR_URL));
        const directory = fileURLToPath(assetDirectory);
        for (const [file, url] of [...Object.values(FALL_TREE_URLS), FALL_FOLIAGE_URL, FALL_IMPOSTOR_URL]
            .map((entry) => [fileNameOf(entry), entry])) {
            expect(existsSync(new URL(file, assetDirectory)), file).toBe(true);
            expect(statSync(new URL(file, assetDirectory)).size).toBeGreaterThan(0);
            // Under Vitest the URLs are file URLs; they must land in the pack, not beside it.
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(file, assetDirectory)));
                expect(fileURLToPath(url).startsWith(directory)).toBe(true);
            }
        }
        // Nothing ships that the runtime does not load, and nothing is loaded twice.
        const shipped = readdirSync(assetDirectory).filter((file) => /\.(glb|png)$/i.test(file)).sort();
        expect(shipped).toEqual([...referenced].sort());
        expect(new Set(referenced).size).toBe(referenced.length);
        expect(readAsset('fall-impostors.png').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('knows every tree the composition places', () => {
        const placed = new Set(FALL_FEATURE_TREES.map((tree) => tree.asset));
        layoutFallGrove(seededRandom()).forEach((tree) => placed.add(tree.asset));
        expect(placed.size).toBeGreaterThan(2);
        for (const asset of placed) expect(TREE_NAMES).toContain(asset);
        // And no tree is authored, shipped and loaded without ever being planted.
        for (const name of TREE_NAMES) expect([...placed]).toContain(name);
    });

    it('keeps the pack inside its download budget', () => {
        const files = readdirSync(assetDirectory);
        const total = files.reduce((sum, file) => sum + statSync(new URL(file, assetDirectory)).size, 0);
        expect(total).toBeLessThanOrEqual(BUDGET.directoryBytes);
        for (const file of files.filter((entry) => entry.endsWith('.glb'))) {
            expect(statSync(new URL(file, assetDirectory)).size, file).toBeLessThanOrEqual(BUDGET.glbBytes);
        }
        expect(statSync(new URL('fall-impostors.png', assetDirectory)).size).toBeLessThanOrEqual(BUDGET.impostorBytes);
    });

    it('matches every manifest entry byte for byte', () => {
        const manifest = JSON.parse(readAsset('asset-manifest.json').toString('utf8'));
        expect(manifest.schemaVersion).toBe(FALL_ASSET_SCHEMA);
        expect(Array.isArray(manifest.assets)).toBe(true);
        expect(manifest.assets.length).toBeGreaterThan(0);
        // Portable: no absolute paths from the machine that ran Blender.
        expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//i);
        // The generator merges partial runs (--only ...) into the manifest, so it may lag behind
        // the directory: this asserts that every LISTED entry matches its file, deliberately not
        // that every file is listed.
        const seen = new Set();
        for (const entry of manifest.assets) {
            expect(entry.file).not.toMatch(/[\\/]/);
            expect(seen.has(entry.file), `${entry.file} listed twice`).toBe(false);
            seen.add(entry.file);
            expect(existsSync(new URL(entry.file, assetDirectory)), entry.file).toBe(true);
            const bytes = readAsset(entry.file);
            expect(bytes.length, entry.file).toBe(entry.bytes);
            expect(createHash('sha256').update(bytes).digest('hex'), entry.file).toBe(entry.sha256);
        }
        // The sprite-sheet layout is read from here at runtime.
        expect(manifest.assets.filter((entry) => entry.kind === 'impostors')).toHaveLength(1);
        expect(manifest.assets.find((entry) => entry.kind === 'impostors').file).toBe(fileNameOf(FALL_IMPOSTOR_URL));
    });

    it('describes each listed tree and the foliage pack the way the files really are', () => {
        const manifest = JSON.parse(readAsset('asset-manifest.json').toString('utf8'));
        for (const entry of manifest.assets) {
            if (entry.kind === 'tree') {
                const tree = parsed.trees[entry.file.replace(/\.glb$/, '')];
                expect(tree, entry.file).toBeDefined();
                expect(entry).toMatchObject({ species: tree.species, role: tree.role });
                if (entry.sites !== undefined) expect(entry.sites).toBe(tree.sites.count);
                if (entry.barkTriangles !== undefined) expect(entry.barkTriangles).toBe(triangles(tree.bark));
            }
            if (entry.kind === 'foliage' && entry.meshes) {
                expect(Object.keys(entry.meshes).sort()).toEqual(Object.keys(parsed.foliage.meshes).sort());
                for (const [name, record] of Object.entries(entry.meshes)) {
                    expect(record.triangles, name).toBe(triangles(parsed.foliage.meshes[name]));
                }
            }
        }
    });
});

describe('Fall tree assets', () => {
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
            // parseFallTree decodes through translation and scale only.
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
        expect(meta).toMatchObject({ schemaVersion: FALL_ASSET_SCHEMA, name });
        expect(SPECIES).toContain(meta.species);
        expect(['hero', 'grove']).toContain(meta.role);
        expect(meta.sites).toBe(json.accessors[sites.attributes.POSITION].count);
        expect(meta.barkTriangles).toBe(json.accessors[bark.indices].count / 3);
    });

    it.each(TREE_NAMES)('%s parses into bark in metres standing on the ground', (name) => {
        const tree = parsed.trees[name];
        expect(tree).toMatchObject({ name });
        expect(SPECIES).toContain(tree.species);
        expect(['hero', 'grove']).toContain(tree.role);
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
        // The root flare dips a little into the soil; the trunk starts at the origin.
        expect(minY).toBeLessThan(0.05);
        expect(minY).toBeGreaterThan(-1);
        // `height` is the design height the crown was grown toward: the wood stops at or below it.
        expect(maxY).toBeLessThanOrEqual(tree.height * 1.05);
        expect(maxY).toBeGreaterThan(tree.height * 0.6);
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

    it.each(TREE_NAMES)('%s carries well-formed foliage sites inside its crown', (name) => {
        const tree = parsed.trees[name];
        const { sites } = tree;
        expect(sites.count).toBeGreaterThan(0);
        expect(sites.count).toBeLessThanOrEqual(BUDGET.sites[tree.role]);
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
        }
        // Sprays are sized in metres: never collapsed, never the size of the tree.
        const [smallest, largest] = extent(sites.scale, 1, 0);
        expect(smallest).toBeGreaterThan(0);
        expect(largest).toBeLessThan(tree.height / 2);
        // They sit on the wood, between the lowest bough and the top of the tree.
        const { boundingBox } = tree.bark;
        const [lowest, highest] = extent(sites.position, 3, 1);
        expect(lowest).toBeGreaterThan(0);
        expect(highest).toBeLessThanOrEqual(tree.height * 1.05);
        for (const [offset, axis] of [[0, 'x'], [2, 'z']]) {
            const [min, max] = extent(sites.position, 3, offset);
            expect(min).toBeGreaterThan(boundingBox.min[axis] - 2);
            expect(max).toBeLessThan(boundingBox.max[axis] + 2);
        }
        // Each site names a spray variant the foliage pack really has.
        const { variants, meshes } = parsed.foliage;
        expect(typeof tree.foliage).toBe('string');
        for (let variant = 0; variant < variants; variant++) {
            expect(meshes[`${tree.foliage}_${variant}`], `${tree.foliage}_${variant}`).toBeDefined();
        }
        expect(new Set(sites.variant).size).toBeGreaterThan(1);
        expect(Math.max(...sites.variant)).toBeLessThan(variants);
    });

    it('refuses a tree written for another schema or missing a primitive', async () => {
        const stale = await parseGlb('birch-grove-b.glb');
        stale.scene.userData.schemaVersion = FALL_ASSET_SCHEMA + 1;
        const other = FALL_ASSET_SCHEMA + 1;
        expect(() => parseFallTree(stale, 'birch-grove-b'))
            .toThrow(`[Fall] Tree "birch-grove-b" has asset schema ${other}; expected ${FALL_ASSET_SCHEMA}.`);
        const untagged = await parseGlb('birch-grove-b.glb');
        untagged.scene.userData = {};
        expect(() => parseFallTree(untagged, 'bare')).toThrow('has asset schema undefined');
        const parts = ['sites', 'bark'];
        const copies = await Promise.all(parts.map(() => parseGlb('birch-grove-b.glb')));
        parts.forEach((missing, index) => {
            const broken = copies[index];
            broken.scene.remove(broken.scene.children.find((entry) => entry.name === missing));
            expect(() => parseFallTree(broken, 'broken'))
                .toThrow(`[Fall] Asset is missing its "${missing}" primitive.`);
        });
        // The file names its own tree; the argument is only a fallback and a label for errors.
        const renamed = await parseGlb('birch-grove-b.glb');
        expect(parseFallTree(renamed, 'whatever').name).toBe('birch-grove-b');
        const anonymous = await parseGlb('birch-grove-b.glb');
        delete anonymous.scene.userData.name;
        expect(parseFallTree(anonymous, 'fallback').name).toBe('fallback');
    });
});

describe('Fall foliage pack', () => {
    it('is a compact, texture-free GLB', () => {
        const { json } = readGlb('fall-foliage.glb');
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.textures ?? []).toHaveLength(0);
        expect(json.images ?? []).toHaveLength(0);
        expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
        expect(json.scenes[0].extras.schemaVersion).toBe(FALL_ASSET_SCHEMA);
        for (const node of json.nodes) {
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
        }
    });

    it('contains every mesh the runtime asks for', () => {
        const { variants, meshes } = parsed.foliage;
        expect(variants).toBeGreaterThanOrEqual(1);
        for (const name of REQUIRED_FOLIAGE) expect(meshes[name], name).toBeDefined();
        // No mesh is shipped that nothing draws.
        expect(Object.keys(meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        const kinds = new Set(Object.values(parsed.trees).map((tree) => tree.foliage));
        expect(kinds.size).toBeGreaterThan(2);
        for (const kind of kinds) {
            for (let variant = 0; variant < variants; variant++) {
                expect(meshes[`${kind}_${variant}`], `${kind}_${variant}`).toBeDefined();
            }
        }
    });

    it.each(REQUIRED_FOLIAGE)('%s is a small, complete, finite mesh', (name) => {
        const geometry = parsed.foliage.meshes[name];
        expect(geometry.isBufferGeometry).toBe(true);
        expect(geometry.name).toBe(name);
        expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
        const { position } = geometry.attributes;
        expect(position.array).toBeInstanceOf(Float32Array);
        expect(finite(position.array)).toBe(true);
        for (const key of ['normal', 'uv', 'color']) expect(geometry.attributes[key].count).toBe(position.count);
        expect(geometry.index.count % 3).toBe(0);
        expect(extent(geometry.index.array, 1, 0)[1]).toBeLessThan(position.count);
        const leaf = name.startsWith('leaf_');
        expect(triangles(geometry)).toBeGreaterThan(1);
        expect(triangles(geometry)).toBeLessThanOrEqual(leaf ? BUDGET.leafTriangles : BUDGET.sprayTriangles);
        // Authored at about unit size; instances scale them into place.
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.3);
        expect(Math.max(size.x, size.y, size.z)).toBeLessThan(2);
        const normals = attributeLengths(geometry.attributes.normal);
        expect(normals[0]).toBeGreaterThan(0.97);
        expect(normals[1]).toBeLessThan(1.03);
        const { uv } = geometry.attributes;
        for (let index = 0; index < uv.count; index++) {
            expect(uv.getX(index)).toBeGreaterThanOrEqual(0);
            expect(uv.getX(index)).toBeLessThanOrEqual(1);
            expect(uv.getY(index)).toBeGreaterThanOrEqual(0);
            expect(uv.getY(index)).toBeLessThanOrEqual(1);
        }
        if (leaf) {
            // The leaf simulation lays a blade flat by turning its local XY plane to the ground.
            expect(size.z).toBeLessThan(Math.min(size.x, size.y) * 0.5);
        } else {
            // Sprays grow from their attachment point along +Y.
            expect(geometry.boundingBox.min.y).toBeGreaterThan(-0.2);
            expect(geometry.boundingBox.max.y).toBeGreaterThan(0.5);
        }
    });

    it('refuses a pack written for another schema', async () => {
        const stale = await parseGlb('fall-foliage.glb');
        stale.scene.userData.schemaVersion = 0;
        expect(() => parseFallFoliage(stale))
            .toThrow(`[Fall] Foliage has asset schema 0; expected ${FALL_ASSET_SCHEMA}.`);
        stale.scene.userData = undefined;
        expect(() => parseFallFoliage(stale)).toThrow('Foliage has asset schema undefined');
    });
});

describe('Fall far-tree sprite sheet', () => {
    it('lays its tiles side by side inside the atlas the PNG really has', () => {
        const layout = fallImpostorLayout();
        expect(Object.keys(layout).sort()).toEqual(['atlasHeight', 'atlasWidth', 'tiles']);
        const png = readAsset('fall-impostors.png');
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
            expect(tile.x).toBeGreaterThanOrEqual(cursor);
            cursor = tile.x + tile.pixels;
        }
        expect(cursor).toBeLessThanOrEqual(layout.atlasWidth);
    });

    it('describes each tile as one of the grove trees, at its true proportions', () => {
        const layout = fallImpostorLayout();
        for (const tile of layout.tiles) {
            const tree = parsed.trees[tile.asset];
            expect(tree, tile.asset).toBeDefined();
            expect(tree.role).toBe('grove');
            expect(tile.species).toBe(tree.species);
            // Metres on the card match pixels on the sheet, so no sprite is stretched.
            expect(tile.width / tile.height).toBeCloseTo(tile.pixels / layout.atlasHeight, 3);
            expect(tile.height).toBeGreaterThan(tree.height * 0.7);
            expect(tile.height).toBeLessThan(tree.height * 1.3);
            // Where the trunk stands, as a fraction of the tile width from its centre.
            expect(Math.abs(tile.trunk)).toBeLessThan(0.5);
            expect(tile.coverage).toBeGreaterThan(0);
            expect(tile.coverage).toBeLessThanOrEqual(1);
        }
        // Far trees come in more than one silhouette and both far species.
        expect(new Set(layout.tiles.map((tile) => tile.asset)).size).toBe(layout.tiles.length);
        expect(new Set(layout.tiles.map((tile) => tile.species)).size).toBeGreaterThan(1);
    });

    it('prepares the sheet as linear, clamped, mip-mapped data', () => {
        const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareImpostorTexture(texture)).toBe(texture);
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.name).toBe('FallDeepForestSprites');
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });
});

describe('loading and releasing the Fall assets', () => {
    it('loads every file once and returns the parsed bundle', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const isCurrent = vi.fn(() => true);
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadFallAssets({ loader, textureLoader, isCurrent });
        const requested = loader.loadAsync.mock.calls.map(([url]) => url);
        expect([...requested].sort()).toEqual([FALL_FOLIAGE_URL, ...Object.values(FALL_TREE_URLS)].sort());
        expect(textureLoader.loadAsync).toHaveBeenCalledExactlyOnceWith(FALL_IMPOSTOR_URL);
        // Ownership is checked once, after everything has arrived.
        expect(isCurrent).toHaveBeenCalledOnce();
        expect(isCurrent.mock.invocationCallOrder[0])
            .toBeGreaterThan(Math.max(...loader.loadAsync.mock.invocationCallOrder));

        expect(Object.keys(assets).sort()).toEqual(['foliage', 'impostors', 'trees']);
        expect(Object.keys(assets.trees)).toEqual(TREE_NAMES);
        for (const name of TREE_NAMES) {
            expect(assets.trees[name].name).toBe(name);
            expect(assets.trees[name].sites.count).toBe(parsed.trees[name].sites.count);
            expect(triangles(assets.trees[name].bark)).toBe(triangles(parsed.trees[name].bark));
        }
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        expect(assets.foliage.variants).toBe(parsed.foliage.variants);
        expect(assets.impostors).toEqual({ ...fallImpostorLayout(), texture: textureLoader.textures[0] });
        expect(assets.impostors.texture.name).toBe('FallDeepForestSprites');
        expect(assets.impostors.texture.colorSpace).toBe(THREE.NoColorSpace);
        // A bundle that is handed over is intact.
        expect(disposal).not.toHaveBeenCalled();
        expect(textureLoader.disposed).toEqual([]);
        disposeFallAssets(assets);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('disposes everything and returns null when the start that asked is no longer current', async () => {
        const loader = diskLoader();
        const textureLoader = stubTextureLoader();
        const disposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
        const assets = await loadFallAssets({ loader, textureLoader, isCurrent: () => false });
        expect(assets).toBeNull();
        expect(loader.loadAsync).toHaveBeenCalledTimes(TREE_NAMES.length + 1);
        const released = disposal.mock.contexts.map((geometry) => geometry.name).sort();
        expect(released).toEqual([...REQUIRED_FOLIAGE, ...TREE_NAMES.map(() => 'bark')].sort());
        expect(new Set(disposal.mock.contexts).size).toBe(released.length);
        expect(textureLoader.textures).toHaveLength(1);
        expect(textureLoader.disposed).toEqual(textureLoader.textures);
    });

    it('loads a chosen subset of trees, each once, and can skip the sprite sheet', async () => {
        const loader = diskLoader();
        const assets = await loadFallAssets({
            trees: ['maple-grove-a', 'birch-grove-b', 'maple-grove-a'], loader, textureLoader: null,
        });
        expect(Object.keys(assets.trees)).toEqual(['maple-grove-a', 'birch-grove-b']);
        expect(loader.loadAsync).toHaveBeenCalledTimes(3);
        expect(loader.loadAsync.mock.calls.map(([url]) => fileNameOf(url)).sort())
            .toEqual(['birch-grove-b.glb', 'fall-foliage.glb', 'maple-grove-a.glb']);
        expect(assets.impostors).toBeNull();
        expect(Object.keys(assets.foliage.meshes).sort()).toEqual([...REQUIRED_FOLIAGE].sort());
        disposeFallAssets(assets);
    });

    it('rejects an unknown tree name and a failed download', async () => {
        await expect(loadFallAssets({
            trees: ['maple-hero', 'pine'], loader: diskLoader(), textureLoader: stubTextureLoader(),
        })).rejects.toThrow('[Fall] Unknown tree asset "pine".');
        const flaky = diskLoader();
        flaky.loadAsync.mockImplementation(async (url) => {
            if (fileNameOf(url) === 'oak-hero.glb') throw new Error('404 oak-hero.glb');
            return parseGlb(fileNameOf(url));
        });
        await expect(loadFallAssets({ loader: flaky, textureLoader: stubTextureLoader() }))
            .rejects.toThrow('404 oak-hero.glb');
        const noSheet = stubTextureLoader();
        noSheet.loadAsync.mockRejectedValue(new Error('404 sprites'));
        await expect(loadFallAssets({ loader: diskLoader(), textureLoader: noSheet })).rejects.toThrow('404 sprites');
    });

    it('releases each geometry and the sprite sheet exactly once', async () => {
        const textureLoader = stubTextureLoader();
        const assets = await loadFallAssets({ loader: diskLoader(), textureLoader });
        const geometries = [...Object.values(assets.foliage.meshes),
            ...Object.values(assets.trees).map((tree) => tree.bark)];
        expect(new Set(geometries).size).toBe(REQUIRED_FOLIAGE.length + TREE_NAMES.length);
        const disposals = [...geometries, assets.impostors.texture].map((resource) => vi.spyOn(resource, 'dispose'));
        disposeFallAssets(assets);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('tolerates missing and partial bundles', () => {
        const bark = { dispose: vi.fn() };
        const leaf = { dispose: vi.fn() };
        const texture = { dispose: vi.fn() };
        for (const assets of [null, undefined, false, 0, {}, { foliage: null, trees: null, impostors: null },
            { foliage: {} }, { foliage: { meshes: {} } }, { trees: {} }, { trees: { sapling: {} } },
            { trees: { sapling: { bark: null } } }, { impostors: {} }, { impostors: { texture: null } }]) {
            expect(() => disposeFallAssets(assets)).not.toThrow();
        }
        disposeFallAssets({ trees: { sapling: { bark } } });
        disposeFallAssets({ foliage: { meshes: { leaf } } });
        disposeFallAssets({ impostors: { texture } });
        for (const resource of [bark, leaf, texture]) expect(resource.dispose).toHaveBeenCalledOnce();
    });
});
