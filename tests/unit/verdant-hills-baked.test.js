import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { decodePng, encodePng } from '../../scripts/himalayan-peak/png.mjs';
import {
    VERDANT_HILLS_CLOUDS_URL, VERDANT_HILLS_LAND_URL, loadVerdantHillsClouds, loadVerdantHillsLand,
    prepareVerdantHillsLand, verdantHillsCloudRecord, verdantHillsLandRecord,
} from '../../src/themes/verdant-hills/verdant-hills-land.js';
import { verdantHillsTreeShadows } from '../../src/themes/verdant-hills/verdant-hills-layout.js';
import {
    VERDANT_HILLS_CLOUD_SCHEMA, VERDANT_HILLS_CLOUD_SEED, VERDANT_HILLS_CLOUD_SIZE, VerdantHillsLight,
    createVerdantHillsCloudData,
} from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_LAND_SCHEMA, VERDANT_HILLS_MAP_BOUNDS, VERDANT_HILLS_PLACES, createVerdantHillsLandData,
    verdantHillsFieldAt, verdantHillsRiverZ,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';

// Baking the patchwork again, to hold it against the file, takes seconds on a busy machine.
vi.setConfig({ testTimeout: 300000 });

const repoRoot = new URL('../../', import.meta.url);
const assetDirectory = new URL('src/themes/verdant-hills/assets/', repoRoot);
const LAND_FILE = 'verdant-land.png';
const CLOUDS_FILE = 'verdant-clouds.png';
/** How to bring a stale file up to date: said in every message that finds one. */
const REBAKE = 'the bake is stale: run `node scripts/verdant-hills/bake-land.mjs`';
const LAND_MODULE = '../../src/themes/verdant-hills/verdant-hills-land.js';
const LAND_MANIFEST = '../../src/themes/verdant-hills/assets/verdant-land.json';
const CLOUDS_MANIFEST = '../../src/themes/verdant-hills/assets/verdant-clouds.json';

const files = new Map();
const read = (name) => {
    if (!files.has(name)) files.set(name, readFileSync(new URL(name, assetDirectory)));
    return files.get(name);
};
const pictures = new Map();
const decode = (name) => {
    if (!pictures.has(name)) pictures.set(name, decodePng(read(name)));
    return pictures.get(name);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** How many bytes of two pictures differ, channel by channel. */
function differing(a, b) {
    const channels = [0, 0, 0, 0];
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) channels[index % 4] += 1;
    return channels;
}

/** A picture as a texture loader hands it over: an image of a size, nothing prepared. */
function picture(size, height = size) {
    const texture = new THREE.Texture({ width: size, height });
    texture.flipY = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/** A loader that resolves to a picture (or rejects), and remembers what it was asked for. */
function loaderOf(result) {
    return {
        loadAsync: vi.fn(async () => {
            if (result instanceof Error) throw result;
            return result;
        }),
    };
}

/** The loading module, read afresh against a manifest that says something else. */
async function withManifest(file, changed) {
    vi.resetModules();
    vi.doMock(file, () => ({ default: changed }));
    try {
        return await import(LAND_MODULE);
    } finally {
        vi.doUnmock(file);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
});

describe('Verdant Hills baked patchwork', () => {
    const record = verdantHillsLandRecord();

    it('records what the bake wrote: schema, size, bounds, trees and the hash of the file', () => {
        expect(record.schema).toBe(VERDANT_HILLS_LAND_SCHEMA);
        expect(Number.isInteger(record.size)).toBe(true);
        // Much finer than the coarse map the terrain can afford to make when it starts.
        expect(record.size).toBeGreaterThanOrEqual(1024);
        expect(record.size).toBeLessThanOrEqual(4096);
        // The map covers the bounds the shaders look it up by.
        expect(record.bounds).toEqual({ ...VERDANT_HILLS_MAP_BOUNDS });
        expect(record.trees).toBe(verdantHillsTreeShadows().length);
        expect(record.trees).toBeGreaterThan(0);
        expect(record.bytes).toBeGreaterThan(1000);
        expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
        // It names the script that makes it, and the script is there.
        expect(existsSync(new URL(record.generator, repoRoot))).toBe(true);
        expect(verdantHillsLandRecord()).toBe(record);
    });

    it('pins the picture to its record, byte for byte', () => {
        const file = read(LAND_FILE);
        expect(file.length, `${LAND_FILE} is not the size its manifest gives`).toBe(record.bytes);
        expect(sha256(file), `${LAND_FILE} is not the file its manifest pins`).toBe(record.sha256);
        expect(VERDANT_HILLS_LAND_URL.endsWith(`/assets/${LAND_FILE}`)).toBe(true);
    });

    it('is an opaque square picture of the size its record gives', () => {
        const { width, height, rgba } = decode(LAND_FILE);
        expect([width, height]).toEqual([record.size, record.size]);
        expect(rgba).toHaveLength(record.size * record.size * 4);
        // Opaque throughout: no decoder can premultiply the data away.
        for (let offset = 3; offset < rgba.length; offset += 4) {
            if (rgba[offset] !== 255) throw new Error(`texel ${(offset - 3) / 4} is not opaque`);
        }
    });

    it('lays row 0 along the far edge of the valley and column 0 down its left', () => {
        const { rgba } = decode(LAND_FILE);
        const {
            minX, maxX, minZ, maxZ,
        } = VERDANT_HILLS_MAP_BOUNDS;
        const { size } = record;
        const texel = (x, z) => {
            const column = Math.round(((x - minX) / (maxX - minX)) * (size - 1));
            const row = Math.round(((z - minZ) / (maxZ - minZ)) * (size - 1));
            return rgba.subarray((row * size + column) * 4, (row * size + column) * 4 + 4);
        };
        const MIDDLE = Math.round(0.5 * 255);
        // Water where the water is: mid-stream at several places, and the middle of the tarn.
        for (const x of [-900, -150, 0, 400, 1100]) {
            expect(texel(x, verdantHillsRiverZ(x))[0], `river at x ${x}`).toBe(0);
        }
        expect(texel(VERDANT_HILLS_PLACES.tarn.x, VERDANT_HILLS_PLACES.tarn.z)[0]).toBe(0);
        // Open down at the lens: neither hedge nor water.
        expect(texel(VERDANT_HILLS_PLACES.eye.x, VERDANT_HILLS_PLACES.eye.z)[0]).toBe(MIDDLE);
        // And texel for texel what stands there, over the whole map.
        const random = seededRandom(7);
        let hedges = 0;
        for (let count = 0; count < 20000; count++) {
            const column = Math.floor(random() * size);
            const row = Math.floor(random() * size);
            const x = minX + (column * (maxX - minX)) / (size - 1);
            const z = minZ + (row * (maxZ - minZ)) / (size - 1);
            const field = verdantHillsFieldAt(x, z);
            const [red, green] = rgba.subarray((row * size + column) * 4, (row * size + column) * 4 + 2);
            const wanted = Math.round((0.5 + field.hedge * 0.5 - field.water * 0.5) * 255);
            if (red !== wanted || green !== Math.round(field.tone * 255)) {
                throw new Error(`${REBAKE} (texel ${column}, ${row} holds ${red}, ${green}; the land is ${wanted})`);
            }
            if (field.hedge > 0.5) hedges += 1;
        }
        // At this size a hedge is several texels wide: the sample finds plenty.
        expect(hedges).toBeGreaterThan(100);
    });

    it('is what the terrain and the layout produce today', () => {
        const { rgba } = decode(LAND_FILE);
        const fresh = createVerdantHillsLandData(record.size, verdantHillsTreeShadows());
        expect(fresh).toHaveLength(rgba.length);
        const [hedgeAndWater, tone, shade, alpha] = differing(fresh, rgba);
        // Red changes with the water and the hedges, green with the pastures, blue with the trees.
        expect({
            hedgeAndWater, tone, shade, alpha,
        }, REBAKE).toEqual({
            hedgeAndWater: 0, tone: 0, shade: 0, alpha: 0,
        });
        // And the encoder is the one the file was written with: a fresh bake is the same bytes.
        expect(sha256(encodePng(fresh, record.size, record.size)), REBAKE).toBe(record.sha256);
    });
});

describe('preparing and loading the Verdant Hills patchwork', () => {
    const record = verdantHillsLandRecord();

    it('prepares the map as linear, unflipped, clamped, mip-mapped data', () => {
        const texture = picture(64);
        const { version } = texture;
        expect(prepareVerdantHillsLand(texture)).toBe(texture);
        // Data, not colour: no gamma, and row 0 stays the far edge.
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.flipY).toBe(false);
        // Past its rim the land has no patchwork: never the opposite edge's.
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.anisotropy).toBeGreaterThanOrEqual(1);
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });

    it('loads the baked picture once and hands it back prepared', async () => {
        const texture = picture(record.size);
        const loader = loaderOf(texture);
        const land = await loadVerdantHillsLand({ textureLoader: loader });
        expect(land).toBe(texture);
        expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith(VERDANT_HILLS_LAND_URL);
        expect(land.colorSpace).toBe(THREE.NoColorSpace);
        expect(land.flipY).toBe(false);
        expect(land.wrapS).toBe(THREE.ClampToEdgeWrapping);
        land.dispose();
    });

    it.each([
        ['half the size', (size) => [size / 2, size / 2]], ['a row short', (size) => [size, size - 1]],
        ['empty', () => [0, 0]],
    ])('refuses a picture that is %s, lets go of it and says so', async (_label, sized) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const texture = picture(...sized(record.size));
        const released = [];
        texture.addEventListener('dispose', () => released.push('texture'));
        expect(await loadVerdantHillsLand({ textureLoader: loaderOf(texture) })).toBeNull();
        // The picture it could not use is not left on the card.
        expect(released).toEqual(['texture']);
        expect(warn).toHaveBeenCalledOnce();
    });

    it('never rejects: a failed download or no loader is "make the coarse one"', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await loadVerdantHillsLand({ textureLoader: loaderOf(new Error('offline')) })).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls.at(-1))).toContain('offline');
        // A picture with no image at all.
        expect(await loadVerdantHillsLand({ textureLoader: loaderOf(new THREE.Texture()) })).toBeNull();
        expect(await loadVerdantHillsLand({ textureLoader: loaderOf(null) })).toBeNull();
        // Nothing to load with is not worth a warning.
        const before = warn.mock.calls.length;
        expect(await loadVerdantHillsLand({ textureLoader: null })).toBeNull();
        expect(await loadVerdantHillsLand({ textureLoader: {} })).toBeNull();
        expect(warn).toHaveBeenCalledTimes(before);
    });

    it('refuses a file baked for another schema without downloading it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const other = await withManifest(LAND_MANIFEST, { ...record, schema: record.schema + 1 });
        const loader = loaderOf(picture(record.size));
        expect(await other.loadVerdantHillsLand({ textureLoader: loader })).toBeNull();
        expect(loader.loadAsync).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
        // A manifest that gives another size refuses the picture it has.
        const resized = await withManifest(LAND_MANIFEST, { ...record, size: record.size * 2 });
        expect(await resized.loadVerdantHillsLand({ textureLoader: loaderOf(picture(record.size)) })).toBeNull();
    });
});

describe('Verdant Hills baked cloud field', () => {
    const record = verdantHillsCloudRecord();

    it('records what the bake wrote: schema, size, seed, level table and the hash of the file', () => {
        expect(record.schema).toBe(VERDANT_HILLS_CLOUD_SCHEMA);
        // The field the light rig would make for itself, so the sky is the same with or without the file.
        expect(record.size).toBe(VERDANT_HILLS_CLOUD_SIZE);
        expect(record.seed).toBe(VERDANT_HILLS_CLOUD_SEED);
        expect(record.edges).toHaveLength(256);
        record.edges.forEach((level, index) => {
            expect(Number.isInteger(level) && level >= 0 && level <= 255).toBe(true);
            if (index > 0) expect(level).toBeGreaterThanOrEqual(record.edges[index - 1]);
        });
        expect(record.bytes).toBeGreaterThan(1000);
        expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(existsSync(new URL(record.generator, repoRoot))).toBe(true);
        expect(verdantHillsCloudRecord()).toBe(record);
    });

    it('pins the picture to its record, byte for byte', () => {
        const file = read(CLOUDS_FILE);
        expect(file.length, `${CLOUDS_FILE} is not the size its manifest gives`).toBe(record.bytes);
        expect(sha256(file), `${CLOUDS_FILE} is not the file its manifest pins`).toBe(record.sha256);
        expect(VERDANT_HILLS_CLOUDS_URL.endsWith(`/assets/${CLOUDS_FILE}`)).toBe(true);
    });

    it('is what the light rig produces today, level table and all', () => {
        const { width, height, rgba } = decode(CLOUDS_FILE);
        expect([width, height]).toEqual([record.size, record.size]);
        const fresh = createVerdantHillsCloudData(record.seed, record.size);
        const [heaps, billows, fine, alpha] = differing(fresh.data, rgba);
        expect({
            heaps, billows, fine, alpha,
        }, REBAKE).toEqual({
            heaps: 0, billows: 0, fine: 0, alpha: 0,
        });
        expect(Array.from(fresh.edges, (edge) => Math.round(edge * 255)), REBAKE).toEqual(record.edges);
        for (let offset = 3; offset < rgba.length; offset += 4) {
            if (rgba[offset] !== 255) throw new Error(`texel ${(offset - 3) / 4} is not opaque`);
        }
        expect(sha256(encodePng(fresh.data, record.size, record.size)), REBAKE).toBe(record.sha256);
    });

    it('loads the baked field once and hands it back prepared, with its level table as shares', async () => {
        const texture = picture(record.size);
        const loader = loaderOf(texture);
        const clouds = await loadVerdantHillsClouds({ textureLoader: loader });
        expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith(VERDANT_HILLS_CLOUDS_URL);
        expect(clouds.texture).toBe(texture);
        // It tiles: the clouds drift across its edges all afternoon.
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        expect(texture.flipY).toBe(false);
        expect(clouds.edges).toBeInstanceOf(Float32Array);
        expect(clouds.edges).toHaveLength(256);
        // The same table, to the bit, that the rig would have worked out for itself.
        const fresh = createVerdantHillsCloudData(record.seed, record.size);
        expect(Array.from(clouds.edges)).toEqual(Array.from(fresh.edges));
        // A second load is a second table: nothing shared that one rig could spoil for another.
        const again = await loadVerdantHillsClouds({ textureLoader: loaderOf(picture(record.size)) });
        expect(again.edges).not.toBe(clouds.edges);
        texture.dispose();
        again.texture.dispose();
    });

    it('gives the light rig the sky it would have made for itself, and stays the pack\'s to release', async () => {
        const texture = picture(record.size);
        const clouds = await loadVerdantHillsClouds({ textureLoader: loaderOf(texture) });
        const released = [];
        texture.addEventListener('dispose', () => released.push('clouds'));
        const tier = VERDANT_HILLS_TIERS.Minimal;
        const baked = new VerdantHillsLight({ tier, rng: seededRandom(5), clouds });
        const made = new VerdantHillsLight({ tier, rng: seededRandom(5) });
        expect(baked.ownsClouds).toBe(false);
        expect(made.ownsClouds).toBe(true);
        expect(baked.cloudTexture).toBe(texture);
        for (const cover of [0.1, 0.25, 0.5, 0.8]) {
            baked.setCloudCover(cover);
            made.setCloudCover(cover);
            expect(baked.uCloudEdge.value).toBe(made.uCloudEdge.value);
            expect(baked.uCloudSpan.value).toBe(made.uCloudSpan.value);
        }
        baked.dispose();
        made.dispose();
        expect(released).toEqual([]);
        texture.dispose();
    });

    it.each([
        ['twice the size', (size) => [size * 2, size * 2]], ['a row too tall', (size) => [size, size + 1]],
    ])('refuses a field that is %s, lets go of it and says so', async (_label, sized) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const texture = picture(...sized(record.size));
        const released = [];
        texture.addEventListener('dispose', () => released.push('texture'));
        expect(await loadVerdantHillsClouds({ textureLoader: loaderOf(texture) })).toBeNull();
        expect(released).toEqual(['texture']);
        expect(warn).toHaveBeenCalledOnce();
    });

    it('never rejects: a failed download or no loader is "make it on the spot"', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await loadVerdantHillsClouds({ textureLoader: loaderOf(new Error('offline')) })).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls.at(-1))).toContain('offline');
        expect(await loadVerdantHillsClouds({ textureLoader: loaderOf(null) })).toBeNull();
        const before = warn.mock.calls.length;
        expect(await loadVerdantHillsClouds({ textureLoader: null })).toBeNull();
        expect(await loadVerdantHillsClouds({ textureLoader: {} })).toBeNull();
        expect(warn).toHaveBeenCalledTimes(before);
    });

    it.each([
        ['for another schema', { schema: record.schema + 1 }],
        ['with a level table a level short', { edges: record.edges.slice(1) }],
        ['with no level table', { edges: null }],
    ])('refuses a field baked %s, without downloading it', async (_label, change) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const other = await withManifest(CLOUDS_MANIFEST, { ...record, ...change });
        const loader = loaderOf(picture(record.size));
        expect(await other.loadVerdantHillsClouds({ textureLoader: loader })).toBeNull();
        expect(loader.loadAsync).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
    });
});
