/**
 * Waves — reading the sea life's bodies (waves-cast.js).
 *
 * The one file the theme loads: src/themes/waves/assets/sea-life.glb, read with a reader of its
 * own layout so the browser and the tests parse the same bytes the same way. What is in it is
 * held in waves-meshes.test.js; here: that it is read from the theme's own folder, once a page,
 * that anything else handed to the reader is refused, and that the wave is told "nothing" (never
 * an error) when the file cannot be had.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { KINDS } from '../../src/themes/waves/waves-acts.js';
import {
    SEA_LIFE_URL, loadSeaLife, parseSeaLife, seaLifeLoaded, useSeaLife,
} from '../../src/themes/waves/waves-cast.js';

const bytes = readFileSync(new URL('../../src/themes/waves/assets/sea-life.glb', import.meta.url));

/** The file as a browser's fetch hands it over. */
const served = (body = bytes) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

const positions = (pack) => KINDS.map((name) => Array.from(pack.kinds[name].geometry.getAttribute('position').array));

beforeEach(() => {
    useSeaLife(null);
});

afterEach(() => {
    useSeaLife(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('waves cast: the file', () => {
    it('lives in the theme\'s own folder, at a path that follows the theme wherever it is served from', () => {
        // Relative to the module (an absolute path would be the filesystem's root under file://).
        expect(SEA_LIFE_URL).toMatch(/\/themes\/waves\/assets\/sea-life\.glb$/);
        const source = readFileSync(new URL('../../src/themes/waves/waves-cast.js', import.meta.url), 'utf8');
        expect(source).toContain('new URL(\'./assets/sea-life.glb\', import.meta.url)');
        if (SEA_LIFE_URL.startsWith('file:')) expect(existsSync(fileURLToPath(SEA_LIFE_URL))).toBe(true);
    });

    it('parses the same animals from the bytes however they are handed over', () => {
        const pack = parseSeaLife(bytes);
        expect(Object.keys(pack.kinds)).toEqual(KINDS);
        expect(pack.bytes).toBe(bytes.length);
        // The buffer itself, as a fetch gives it.
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        expect(positions(parseSeaLife(buffer))).toEqual(positions(pack));
        // A view that starts at an odd byte of a larger buffer: nothing in it is aligned.
        const odd = new Uint8Array(new ArrayBuffer(bytes.length + 3), 3);
        odd.set(bytes);
        const shifted = parseSeaLife(odd);
        expect(positions(shifted)).toEqual(positions(pack));
        for (const name of KINDS) {
            for (const attribute of ['normal', 'aShape', 'aSkin', 'aPivot']) {
                expect(Array.from(shifted.kinds[name].geometry.getAttribute(attribute).array), `${name}.${attribute}`)
                    .toEqual(Array.from(pack.kinds[name].geometry.getAttribute(attribute).array));
            }
            expect(Array.from(shifted.kinds[name].geometry.getIndex().array)).toEqual(Array.from(pack.kinds[name].geometry.getIndex().array));
            // What it keeps of each animal beside its body.
            expect(Object.keys(pack.kinds[name]).sort(), name).toEqual(['family', 'geometry', 'kind', 'nose', 'tail', 'triangles']);
            expect(pack.kinds[name].geometry.name, name).toBe(`WavesSeaLife:${name}`);
        }
        // Each parse is a pack of its own: nothing is shared with the last one.
        expect(parseSeaLife(bytes).kinds.manta.geometry).not.toBe(pack.kinds.manta.geometry);
    });

    it('refuses what is not the pack: no file at all, another kind of file, another theme\'s animals', () => {
        expect(() => parseSeaLife(new Uint8Array(0))).toThrow(/not a GLB/);
        expect(() => parseSeaLife(new Uint8Array(64))).toThrow(/not a GLB/);
        expect(() => parseSeaLife(new TextEncoder().encode('<!doctype html><title>Not found</title>'))).toThrow(/not a GLB/);
        // A file cut short, in its header or anywhere after it, is refused too.
        expect(() => parseSeaLife(bytes.subarray(0, 16))).toThrow(/not a GLB/);
        expect(() => parseSeaLife(bytes.subarray(0, 24))).toThrow();
        expect(() => parseSeaLife(bytes.subarray(0, 20 + bytes.readUInt32LE(12)))).toThrow(/not the Waves sea-life pack/);
        // The Ocean's creatures are laid out the same way and are not these.
        const ocean = readFileSync(new URL('../../src/themes/ocean/assets/creatures.glb', import.meta.url));
        expect(() => parseSeaLife(ocean)).toThrow(/not the Waves sea-life pack/);
    });
});

describe('waves cast: loading', () => {
    it('reads the pack once a page, however many worlds ask for it and however often', async () => {
        const fetched = vi.fn(async () => served());
        vi.stubGlobal('fetch', fetched);
        expect(seaLifeLoaded()).toBeNull();
        const asked = [loadSeaLife(), loadSeaLife(), loadSeaLife()];
        // Nothing is there until it has arrived.
        expect(seaLifeLoaded()).toBeNull();
        const packs = await Promise.all(asked);
        expect(fetched).toHaveBeenCalledExactlyOnceWith(SEA_LIFE_URL);
        expect(Object.keys(packs[0].kinds)).toEqual(KINDS);
        expect(packs[1]).toBe(packs[0]);
        expect(packs[2]).toBe(packs[0]);
        // From then on it is simply there.
        expect(seaLifeLoaded()).toBe(packs[0]);
        expect(await loadSeaLife()).toBe(packs[0]);
        expect(await loadSeaLife('somewhere/else.glb')).toBe(packs[0]);
        expect(fetched).toHaveBeenCalledOnce();
    });

    it.each([
        ['is not there', async () => ({ ok: false, status: 404 })],
        ['cannot be fetched', async () => { throw new TypeError('Failed to fetch'); }],
        ['is something else', async () => served(new TextEncoder().encode('<!doctype html>'))],
    ])('answers "nothing" and says so when the file %s, and may be asked again', async (_, respond) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetched = vi.fn(respond);
        vi.stubGlobal('fetch', fetched);
        // Never a rejection: the wave goes on with nothing living in it.
        await expect(loadSeaLife()).resolves.toBeNull();
        expect(seaLifeLoaded()).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0][0])).toContain('[Waves]');
        // The next world to ask tries again, and gets it if it is there by then.
        fetched.mockImplementation(async () => served());
        const pack = await loadSeaLife();
        expect(fetched).toHaveBeenCalledTimes(2);
        expect(Object.keys(pack.kinds)).toEqual(KINDS);
        expect(seaLifeLoaded()).toBe(pack);
        expect(warn).toHaveBeenCalledOnce();
    });

    it('answers "nothing" without a word where there is nothing to fetch with', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', undefined);
        await expect(loadSeaLife()).resolves.toBeNull();
        expect(seaLifeLoaded()).toBeNull();
        expect(warn).not.toHaveBeenCalled();
    });

    it('takes a pack handed in as if it had arrived, and forgets it when handed nothing', async () => {
        const fetched = vi.fn(async () => served());
        vi.stubGlobal('fetch', fetched);
        const pack = parseSeaLife(bytes);
        expect(useSeaLife(pack)).toBe(pack);
        expect(seaLifeLoaded()).toBe(pack);
        expect(await loadSeaLife()).toBe(pack);
        expect(fetched).not.toHaveBeenCalled();
        expect(useSeaLife(null)).toBeNull();
        expect(seaLifeLoaded()).toBeNull();
        // Forgotten: the next one to ask reads the file.
        const read = await loadSeaLife();
        expect(read).not.toBe(pack);
        expect(fetched).toHaveBeenCalledOnce();
    });
});
