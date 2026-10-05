import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    CRYSTAL_CAVE_ASSET_SCHEMA, CRYSTAL_CAVE_CAVERN_URL, disposeCrystalCaveAssets, loadCrystalCaveAssets,
    parseCrystalCaveCavern,
} from '../../src/themes/crystal-cave/crystal-cave-assets.js';

const assetDirectory = new URL('../../src/themes/crystal-cave/assets/', import.meta.url);
const MIB = 1024 * 1024;
const FAMILIES = ['aqua', 'amethyst', 'sapphire', 'rose', 'amber'];
// Ceilings roughly a third above what the Blender generator wrote on 2026-10-05 (noted
// beside each), so the pack cannot balloon without someone raising a number on purpose.
const BUDGET = Object.freeze({
    directoryBytes: 5 * MIB, // 3.6 MiB
    cavernTriangles: 200000, // 146,443
    cavernVertices: 100000, // 73,297
    crystals: 2800, // 2,057
    glowworms: 4200, // 3,200
});

function readAsset(file) {
    return readFileSync(new URL(file, assetDirectory));
}

function readGlb(file) {
    const bytes = readAsset(file);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    return { bytes, json };
}

async function parseGlb(file = 'cavern.glb') {
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

const manifest = JSON.parse(readAsset('asset-manifest.json').toString('utf8'));
let cavern;

beforeAll(async () => {
    cavern = parseCrystalCaveCavern(await parseGlb());
});

describe('Crystal Cave asset pack on disk', () => {
    it('ships exactly the files the runtime and the manifest name', () => {
        const shipped = readdirSync(assetDirectory).sort();
        expect(shipped).toEqual(['ATTRIBUTION.md', 'asset-manifest.json', 'cavern.glb']);
        expect(decodeURIComponent(new URL(CRYSTAL_CAVE_CAVERN_URL).pathname.split('/').pop())).toBe('cavern.glb');
        const total = shipped.reduce((sum, file) => sum + statSync(new URL(file, assetDirectory)).size, 0);
        expect(total).toBeLessThan(BUDGET.directoryBytes);
    });

    it('records the pack honestly: schema, size and hash match the file', () => {
        expect(manifest.schemaVersion).toBe(CRYSTAL_CAVE_ASSET_SCHEMA);
        expect(manifest.license).toBe('Project-owned');
        expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//i);
        expect(manifest.assets.map((asset) => asset.file)).toEqual(['cavern.glb']);
        const [entry] = manifest.assets;
        const bytes = readAsset(entry.file);
        expect(entry.bytes).toBe(bytes.length);
        expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is a self-contained quantised GLB with no textures, images or animations', () => {
        const { json } = readGlb('cavern.glb');
        expect(json.extensionsRequired).toEqual(['KHR_mesh_quantization']);
        expect(JSON.stringify(json.extensionsUsed)).not.toMatch(/meshopt|draco/i);
        for (const key of ['textures', 'images', 'animations', 'materials', 'skins']) expect(json[key]).toBeUndefined();
        expect(json.buffers).toHaveLength(1);
        expect(json.buffers[0].uri).toBeUndefined();
        expect(json.nodes.map((node) => node.name).sort()).toEqual(['cavern', 'crystals', 'drips', 'glowworms']);
        json.nodes.forEach((node) => {
            expect(node.rotation).toBeUndefined();
            expect(node.matrix).toBeUndefined();
        });
        const attributes = (name) => Object.keys(json.meshes[json.nodes.find((node) => node.name === name).mesh]
            .primitives[0].attributes).sort();
        expect(attributes('cavern')).toEqual(['NORMAL', 'POSITION', '_LDIR', '_LIGHT0', '_LIGHT1']);
        expect(attributes('crystals')).toEqual(['POSITION', '_DIMS', '_LOOK', '_META', '_QUAT']);
        expect(attributes('glowworms')).toEqual(['POSITION', '_PARAMS']);
    });

    it('carries the scene description the runtime builds from', () => {
        const { json } = readGlb('cavern.glb');
        const extras = json.scenes[0].extras;
        expect(extras.schemaVersion).toBe(CRYSTAL_CAVE_ASSET_SCHEMA);
        expect(extras.families).toEqual(FAMILIES);
        expect(extras.channels).toEqual([...FAMILIES, 'pool', 'sky', 'occlusion']);
        expect(extras.lightScale).toHaveLength(8);
        extras.lightScale.forEach((scale) => expect(scale).toBeGreaterThan(0));
        expect(extras.poolLevel).toBe(-7);
        expect(extras.camera).toEqual({ eye: [0, 4, 30], target: [0, 2, -18], fov: 55 });
        expect(extras.skylight.position[1]).toBeGreaterThan(extras.skylight.target[1] + 20);
        expect(extras.counts).toEqual({
            vertices: manifest.assets[0].vertices,
            triangles: manifest.assets[0].triangles,
            crystals: manifest.assets[0].crystals,
            glowworms: manifest.assets[0].glowworms,
            drips: manifest.assets[0].drips,
        });
    });
});

describe('Crystal Cave cavern, as the runtime reads it', () => {
    it('is a closed hall of rock within its budget, in world units', () => {
        const { geometry, meta } = cavern;
        expect(geometry.index.count / 3).toBe(meta.counts.triangles);
        expect(geometry.attributes.position.count).toBe(meta.counts.vertices);
        expect(meta.counts.triangles).toBeLessThan(BUDGET.cavernTriangles);
        expect(meta.counts.vertices).toBeLessThan(BUDGET.cavernVertices);
        expect(geometry.attributes.position.array).toBeInstanceOf(Float32Array);
        expect(finite(geometry.attributes.position.array)).toBe(true);
        const { min, max } = geometry.boundingBox;
        // Wider than the picture, deeper than the hall is long, and it reaches under the pool.
        expect(min.x).toBeLessThan(-50);
        expect(max.x).toBeGreaterThan(50);
        expect(min.z).toBeLessThan(-105);
        expect(max.z).toBeGreaterThan(30);
        expect(min.y).toBeLessThan(meta.poolLevel - 1.5);
        expect(max.y).toBeGreaterThan(40);
    });

    it('keeps normals and baked light in their compact encodings', () => {
        const { geometry } = cavern;
        expect(geometry.attributes.normal.array).toBeInstanceOf(Int8Array);
        expect(geometry.attributes.normal.normalized).toBe(true);
        for (const name of ['aLight0', 'aLight1']) {
            expect(geometry.attributes[name].array).toBeInstanceOf(Uint8Array);
            expect(geometry.attributes[name].normalized).toBe(true);
            expect(geometry.attributes[name].itemSize).toBe(4);
            expect(geometry.attributes[name].count).toBe(geometry.attributes.position.count);
        }
        expect(geometry.attributes.aLightDir.array).toBeInstanceOf(Int8Array);
        expect(geometry.attributes.aLightDir.normalized).toBe(true);
    });

    it('has light from every source somewhere on the rock, and darkness too', () => {
        const { geometry } = cavern;
        const channels = [0, 1, 2, 3].map((component) => ['aLight0', component])
            .concat([0, 1, 2, 3].map((component) => ['aLight1', component]));
        channels.forEach(([name, component]) => {
            const attribute = geometry.attributes[name];
            const getter = ['getX', 'getY', 'getZ', 'getW'][component];
            let lit = 0;
            let dark = 0;
            let peak = 0;
            for (let index = 0; index < attribute.count; index += 7) {
                const value = attribute[getter](index);
                if (value > 0.5) lit += 1;
                if (value < 0.12) dark += 1;
                peak = Math.max(peak, value);
            }
            expect(peak, `${name}.${component} peak`).toBeGreaterThan(0.95);
            expect(lit, `${name}.${component} lit`).toBeGreaterThan(20);
            // Occlusion is mostly open; every other source leaves most of the cave unlit.
            if (!(name === 'aLight1' && component === 3)) expect(dark, `${name}.${component} dark`).toBeGreaterThan(200);
        });
    });

    it('faces its triangles into the air: the floor up, the vault down', () => {
        const { geometry, meta } = cavern;
        const position = geometry.attributes.position;
        const normal = geometry.attributes.normal;
        let floorUp = 0;
        let floor = 0;
        let vaultDown = 0;
        let vault = 0;
        for (let index = 0; index < position.count; index += 5) {
            const y = position.getY(index);
            const x = position.getX(index);
            const z = position.getZ(index);
            if (Math.abs(x) > 9 || z > 10 || z < -60) continue;
            if (y < meta.poolLevel - 0.5) {
                floor += 1;
                if (normal.getY(index) > 0.3) floorUp += 1;
            } else if (y > 18) {
                vault += 1;
                if (normal.getY(index) < -0.1) vaultDown += 1;
            }
        }
        expect(floor).toBeGreaterThan(20);
        expect(vault).toBeGreaterThan(20);
        expect(floorUp / floor).toBeGreaterThan(0.85);
        expect(vaultDown / vault).toBeGreaterThan(0.7);
    });
});

describe('Crystal Cave crystals, glow-worms and drips', () => {
    it('describes every crystal as a finite, well-formed prism of a known family', () => {
        const { crystals, meta } = cavern;
        expect(crystals).toHaveLength(meta.counts.crystals);
        expect(crystals.length).toBeLessThan(BUDGET.crystals);
        // One pass that collects offenders: two thousand crystals, a single assertion.
        const numeric = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'radius', 'depth', 'height', 'tip', 'apexX', 'apexZ', 'glow',
            'seed', 'rank'];
        const malformed = crystals.filter((crystal) => !(numeric.every((key) => Number.isFinite(crystal[key]))
            && Math.abs(Math.hypot(crystal.qx, crystal.qy, crystal.qz, crystal.qw) - 1) < 1e-3
            && crystal.radius > 0.03 && crystal.depth > 0.03 && crystal.height > 0.1 && crystal.tip > 0.02
            && Math.abs(crystal.apexX) < 0.5 && Math.abs(crystal.apexZ) < 0.5 && crystal.glow > 0
            && Number.isInteger(crystal.family) && crystal.family >= 0 && crystal.family < FAMILIES.length
            && Number.isInteger(crystal.group) && crystal.group >= 0
            && crystal.seed >= 0 && crystal.seed < 1));
        expect(malformed).toEqual([]);
    });

    it('gives each side of the board a hero cluster and every family a presence there', () => {
        const near = cavern.crystals.filter((crystal) => crystal.group === 0 && crystal.z > -30 && crystal.height > 5);
        expect(near.filter((crystal) => crystal.x < -8).length).toBeGreaterThan(8);
        expect(near.filter((crystal) => crystal.x > 8).length).toBeGreaterThan(8);
        const present = new Set(cavern.crystals.filter((crystal) => crystal.group === 0 && crystal.height > 3)
            .map((crystal) => crystal.family));
        expect([...present].sort()).toEqual([0, 1, 2, 3, 4]);
        // The warm heart of the cave stands at the far end of the hall.
        const heart = cavern.crystals.filter((crystal) => crystal.group === 0 && crystal.z < -85 && crystal.height > 15);
        expect(heart.length).toBeGreaterThan(0);
        expect(heart.filter((crystal) => crystal.family === 4).length).toBeGreaterThan(heart.length / 2);
    });

    it('keeps the board corridor clear of large crystals near the player', () => {
        const blocking = cavern.crystals.filter((crystal) => crystal.group === 0 && crystal.height > 4
            && Math.abs(crystal.x) < 7 && crystal.z > -20 && crystal.y < 10);
        expect(blocking).toHaveLength(0);
    });

    it('reserves sprouts for play: grouped by site, at the water\'s edge, on both shores', () => {
        const { crystals, meta } = cavern;
        const sprouts = crystals.filter((crystal) => crystal.group > 0);
        const groups = new Set(sprouts.map((crystal) => crystal.group));
        expect(groups.size).toBe(meta.sprouts.length);
        expect(groups.size).toBeGreaterThanOrEqual(20);
        expect(Math.max(...groups)).toBe(meta.sprouts.length);
        expect(sprouts.length).toBe(groups.size * 5);
        expect(meta.sprouts.some((site) => site.x < 0)).toBe(true);
        expect(meta.sprouts.some((site) => site.x > 0)).toBe(true);
        meta.sprouts.forEach((site) => {
            expect(site.y).toBeGreaterThan(meta.poolLevel - 6);
            expect(site.y).toBeLessThan(meta.poolLevel + 4);
        });
    });

    it('hangs the glow-worms under the vault and finds drips over open water', () => {
        const { glowworms, drips, meta } = cavern;
        expect(glowworms.count).toBe(meta.counts.glowworms);
        expect(glowworms.count).toBeLessThan(BUDGET.glowworms);
        expect(finite(glowworms.positions)).toBe(true);
        expect(finite(glowworms.params)).toBe(true);
        let high = 0;
        for (let index = 0; index < glowworms.count; index += 1) if (glowworms.positions[index * 3 + 1] > 8) high += 1;
        expect(high / glowworms.count).toBeGreaterThan(0.95);
        expect(drips.count).toBe(meta.counts.drips);
        expect(drips.count).toBeGreaterThan(8);
        for (let index = 0; index < drips.count; index += 1) {
            expect(drips.positions[index * 3 + 1]).toBeGreaterThan(meta.poolLevel + 3);
        }
    });
});

describe('Crystal Cave asset loading', () => {
    const diskLoader = () => ({ loadAsync: vi.fn(async () => parseGlb()) });

    it('loads the one file once and returns the parsed cavern', async () => {
        const loader = diskLoader();
        const assets = await loadCrystalCaveAssets({ loader });
        expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith(CRYSTAL_CAVE_CAVERN_URL);
        expect(assets.crystals).toHaveLength(cavern.crystals.length);
        expect(assets.geometry.index.count).toBe(cavern.geometry.index.count);
        disposeCrystalCaveAssets(assets);
    });

    it('returns null and keeps nothing when the request went stale while loading', async () => {
        const gltf = await parseGlb();
        const disposed = [];
        gltf.scene.traverse((object) => object.geometry?.addEventListener('dispose', () => disposed.push(object.name)));
        const assets = await loadCrystalCaveAssets({ loader: { loadAsync: async () => gltf }, isCurrent: () => false });
        expect(assets).toBeNull();
        expect(disposed.sort()).toEqual(['cavern', 'crystals', 'drips', 'glowworms']);
    });

    it('rejects a failed download and a pack of the wrong schema', async () => {
        await expect(loadCrystalCaveAssets({ loader: { loadAsync: async () => { throw new Error('offline'); } } }))
            .rejects.toThrow('offline');
        const gltf = await parseGlb();
        gltf.scene.userData.schemaVersion = 99;
        expect(() => parseCrystalCaveCavern(gltf)).toThrow(/schema 99/);
        const missing = await parseGlb();
        missing.scene.remove(missing.scene.getObjectByName('crystals'));
        expect(() => parseCrystalCaveCavern(missing)).toThrow(/"crystals"/);
    });

    it('disposes the cavern geometry once and tolerates nothing to dispose', async () => {
        const assets = await loadCrystalCaveAssets({ loader: diskLoader() });
        const dispose = vi.spyOn(assets.geometry, 'dispose');
        disposeCrystalCaveAssets(assets);
        expect(dispose).toHaveBeenCalledOnce();
        expect(() => disposeCrystalCaveAssets(null)).not.toThrow();
        expect(() => disposeCrystalCaveAssets(undefined)).not.toThrow();
    });
});
