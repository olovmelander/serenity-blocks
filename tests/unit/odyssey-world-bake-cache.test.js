/* eslint-disable max-classes-per-file */
// The One World's boot bake is kept (perf audit 2026-10-28). It depends only on its request and
// on the code that runs it, yet every Odyssey visit baked it again: ~3 s of CPU over four or five
// workers, 37-43 MB out, on the way to the first map. The session's bake is now handed to every
// request for the same inputs (a re-entry; the mode's start of it at activation, then the board's
// own request), and a production build keeps a copy in IndexedDB keyed by its own chunk URL, so
// the next launch reads it instead of baking. These tests pin both, and that the copy is asked
// before any worker is spent on a bake it already holds.

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    awaitWorldBake, forgetWorldBake, startWorldBake, worldBakeKey,
} from '../../src/rendering/odyssey/world/odyssey-world-bake-loader.js';
import {
    isUsableStoredWorldBake, readStoredWorldBake, storeWorldBake, worldBakeStoreAvailable,
} from '../../src/rendering/odyssey/world/odyssey-world-bake-store.js';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (file) => readFileSync(path.resolve(here, '../../src', file), 'utf8');

const SMALL = { reliefRes: 32, shadowRes: 16, cloudField: false };

beforeEach(() => { forgetWorldBake(); });
afterEach(() => {
    forgetWorldBake();
    delete globalThis.Worker;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the session keeps its bake', () => {
    it('hands a second request for the same inputs the same bake', async () => {
        const first = startWorldBake({ ...SMALL, forceSync: true });
        const second = startWorldBake({ ...SMALL, forceSync: true });
        expect(second.reused).toBe(true);
        const [a, b] = await Promise.all([awaitWorldBake(first), awaitWorldBake(second)]);
        // The same arrays, not an equal second bake.
        expect(b.relief.data).toBe(a.relief.data);
        expect(b.textures.sunFields.data).toBe(a.textures.sunFields.data);
        expect(b.source).toBe('sync');
    });

    it('shares across what only changes how a bake runs, not across what it reads', async () => {
        const base = startWorldBake({ ...SMALL, forceSync: true });
        const sameInputs = startWorldBake({ ...SMALL, forceSync: false, bandCount: 3 });
        expect(sameInputs.reused).toBe(true);
        expect(worldBakeKey({ ...SMALL, bandCount: 1, forceSync: true })).toBe(worldBakeKey(SMALL));
        // The cloud specs and rail only count when the field is baked.
        const unbakedField = {
            ...SMALL, cloudSpecs: [{ id: 'x' }], railSamples: [{ x: 1, y: 2, z: 3 }],
        };
        expect(worldBakeKey(unbakedField)).toBe(worldBakeKey(SMALL));
        expect(worldBakeKey({ ...SMALL, shadowRes: 24 })).not.toBe(worldBakeKey(SMALL));
        expect(worldBakeKey({ ...SMALL, scatter: { spacing: 24 } })).not.toBe(worldBakeKey(SMALL));

        const otherLane = startWorldBake({ ...SMALL, shadowRes: 24, forceSync: true });
        expect(otherLane.reused).toBeUndefined();
        expect((await otherLane.textures).sunFields.res).toBe(24);
        // One bake at a time: the lane asked for last replaced the first.
        const again = startWorldBake({ ...SMALL, forceSync: true });
        expect(again.reused).toBeUndefined();
        expect((await again.relief).data).not.toBe((await base.relief).data);
    });

    it('bakes afresh, keeping nothing, when asked not to keep it', async () => {
        const kept = startWorldBake({ ...SMALL, forceSync: true });
        const fresh = startWorldBake({ ...SMALL, forceSync: true, cache: false });
        expect(fresh.reused).toBeUndefined();
        expect((await fresh.relief).data).not.toBe((await kept.relief).data);
        // ...and the kept bake is still the session's.
        expect(startWorldBake({ ...SMALL, forceSync: true }).reused).toBe(true);
    });

    it('forgets a bake that failed, so the next request bakes again', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const broken = {
            ...SMALL, cloudField: true, cloudSpecs: [null], forceSync: true,
        };
        const failed = startWorldBake(broken);
        await expect(failed.done).rejects.toBeTruthy();
        expect(startWorldBake(broken).reused).toBeUndefined();
    });
});

/** A bake worker that answers each job with the right shapes (the bytes are pinned elsewhere). */
const spawned = [];
class ReplyingWorker {
    constructor() {
        this.terminated = false;
        this.jobs = 0;
        spawned.push(this);
    }

    postMessage(job) {
        this.jobs += 1;
        queueMicrotask(() => {
            if (this.terminated) return;
            const reply = (msg) => { if (!this.terminated) this.onmessage?.({ data: msg }); };
            if (job.lane === 'reliefBand') {
                const rows = job.jEnd - job.jStart;
                reply({
                    stage: 'reliefBand',
                    band: {
                        jStart: job.jStart,
                        jEnd: job.jEnd,
                        data: new Uint16Array(rows * job.reliefRes * 4),
                        total: new Float32Array(rows * job.reliefRes),
                    },
                    ms: 1,
                });
            }
            if (job.lane === 'sunFields') {
                const sunFields = { data: new Uint16Array(job.shadowRes ** 2 * 4), res: job.shadowRes };
                reply({ stage: 'sunFields', sunFields, ms: 1 });
            }
            if (job.lane === 'plates') {
                for (const stage of ['atlas', 'detail', 'macro', 'summit']) {
                    reply({ stage, [stage]: { data: new Uint16Array(4) }, ms: 1 });
                }
            }
            reply({ stage: 'done', lane: job.lane, ms: 1 });
        });
    }

    terminate() { this.terminated = true; }
}

/** A worker that never answers (a bake still running). */
class SilentWorker extends ReplyingWorker {
    postMessage() { this.jobs += 1; }
}

/** What a kept copy of a SMALL bake looks like. */
function keptCopy() {
    const res = SMALL.reliefRes;
    return {
        relief: {
            data: new Uint16Array(res * res * 4), total: new Float32Array(res * res), res, step: 1, origin: -16,
        },
        textures: {
            sunFields: { data: new Uint16Array(SMALL.shadowRes ** 2 * 4), res: SMALL.shadowRes },
            atlas: { data: new Uint16Array(4) },
            detail: { data: new Uint16Array(4) },
            macro: { data: new Uint16Array(4) },
            summit: { data: new Uint16Array(4) },
        },
        cloudField: null,
        scatter: null,
    };
}

function fakeStore({ answer = 'miss', copy = keptCopy() } = {}) {
    const store = {
        reads: [],
        writes: [],
        release: null,
        read: vi.fn((key, request, { onMeta } = {}) => {
            store.reads.push(key);
            if (answer === 'hang') return new Promise(() => {});
            if (answer === 'slow-hit') {
                return new Promise((resolve) => { store.release = () => { onMeta?.(true); resolve(copy); }; });
            }
            onMeta?.(answer === 'hit');
            return Promise.resolve(answer === 'hit' ? copy : null);
        }),
        write: vi.fn((key, bake) => {
            store.writes.push({ key, bake });
            return Promise.resolve(true);
        }),
    };
    return store;
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('the copy kept across launches', () => {
    beforeEach(() => { spawned.length = 0; globalThis.Worker = ReplyingWorker; });

    it('is read first, and a copy for this build and these inputs means no worker at all', async () => {
        const store = fakeStore({ answer: 'hit' });
        const handle = startWorldBake(SMALL, { store, fingerprint: 'build-A', whenIdle: (task) => task() });
        const out = await awaitWorldBake(handle);
        expect(store.reads).toEqual([`build-A\n${worldBakeKey(SMALL)}`]);
        expect(spawned).toHaveLength(0);
        expect(out.source).toBe('kept');
        expect(out.viaWorker).toBe(false);
        expect(out.relief.res).toBe(SMALL.reliefRes);
        await settle();
        expect(store.writes).toHaveLength(0); // nothing new to keep
    });

    it('starts the workers as soon as it has no copy, and keeps the fresh bake once it has landed', async () => {
        const store = fakeStore({ answer: 'miss' });
        const idle = [];
        const handle = startWorldBake(SMALL, { store, fingerprint: 'build-A', whenIdle: (task) => idle.push(task) });
        expect(spawned.length).toBeGreaterThan(0); // the "no copy" answer came before any wait
        const out = await awaitWorldBake(handle);
        expect(out.source).toBe('worker');
        expect(idle).toHaveLength(1); // written when the page is idle, not as it lands
        idle[0]();
        await settle();
        expect(store.writes).toHaveLength(1);
        expect(store.writes[0].key).toBe(`build-A\n${worldBakeKey(SMALL)}`);
        expect(store.writes[0].bake.relief).toBe(out.relief);
        expect(store.writes[0].bake.textures).toBe(out.textures);
        expect(spawned.every((w) => w.terminated)).toBe(true);
    });

    it('never holds the bake up for a store slow to answer', async () => {
        vi.useFakeTimers();
        const store = fakeStore({ answer: 'hang' });
        startWorldBake(SMALL, { store, fingerprint: 'build-A', graceMs: 250 });
        expect(spawned).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(249);
        expect(spawned).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(2);
        expect(spawned.length).toBeGreaterThan(0);
    });

    it('a copy that lands while the workers still run wins, and stops them', async () => {
        vi.useFakeTimers();
        globalThis.Worker = SilentWorker;
        const copy = keptCopy();
        const store = fakeStore({ answer: 'slow-hit', copy });
        const handle = startWorldBake(SMALL, { store, fingerprint: 'build-A', graceMs: 10 });
        await vi.advanceTimersByTimeAsync(20); // the grace ran out: the workers started
        expect(spawned.length).toBeGreaterThan(0);
        store.release();
        const out = await awaitWorldBake(handle);
        expect(out.source).toBe('kept');
        expect(out.relief).toBe(copy.relief);
        expect(spawned.every((w) => w.terminated)).toBe(true);
    });

    it('a copy that lands after the workers finished changes nothing', async () => {
        vi.useFakeTimers();
        const store = fakeStore({ answer: 'slow-hit' });
        const handle = startWorldBake(SMALL, { store, fingerprint: 'build-A', graceMs: 10 });
        await vi.advanceTimersByTimeAsync(20);
        const out = await awaitWorldBake(handle);
        expect(out.source).toBe('worker');
        store.release();
        await vi.advanceTimersByTimeAsync(1);
        expect((await handle.relief)).toBe(out.relief);
        expect(handle.viaWorker).toBe(true);
    });

    it('is never asked without a build fingerprint (dev servers, tests) or when told not to keep', async () => {
        const store = fakeStore({ answer: 'hit' });
        await awaitWorldBake(startWorldBake(SMALL, { store, fingerprint: null }));
        forgetWorldBake();
        await awaitWorldBake(startWorldBake({ ...SMALL, cache: false }, { store, fingerprint: 'build-A' }));
        expect(store.read).not.toHaveBeenCalled();
    });

    it('a bake replaced before the page was idle leaves the writing to its successor', async () => {
        const store = fakeStore({ answer: 'miss' });
        const idle = [];
        const env = { store, fingerprint: 'build-A', whenIdle: (task) => idle.push(task) };
        await awaitWorldBake(startWorldBake(SMALL, env));
        await awaitWorldBake(startWorldBake({ ...SMALL, shadowRes: 24 }, env));
        expect(idle).toHaveLength(2);
        idle.forEach((task) => task());
        await settle();
        expect(store.writes.map((w) => w.bake.textures.sunFields.res)).toEqual([24]);
    });
});

/** Just enough IndexedDB for the store: one database, out-of-line keys, values cloned at put. */
function fakeIndexedDB({ failOpen = false } = {}) {
    const stores = new Map();
    let version = 0;
    const connection = {
        objectStoreNames: { contains: (name) => stores.has(name) },
        createObjectStore: (name) => { stores.set(name, new Map()); },
        close() {},
        transaction(name) {
            const tx = {};
            let pending = 0;
            const settleTx = () => queueMicrotask(() => { if (pending === 0) tx.oncomplete?.(); });
            tx.objectStore = () => ({
                get(key) {
                    const request = {};
                    pending += 1;
                    queueMicrotask(() => {
                        request.result = structuredClone(stores.get(name).get(key));
                        pending -= 1;
                        request.onsuccess?.();
                        settleTx();
                    });
                    return request;
                },
                put(value, key) {
                    const cloned = structuredClone(value); // throws DataCloneError, as IndexedDB does
                    pending += 1;
                    queueMicrotask(() => {
                        stores.get(name).set(key, cloned);
                        pending -= 1;
                        settleTx();
                    });
                    return {};
                },
            });
            return tx;
        },
    };
    return {
        stores,
        open(_name, wanted) {
            const request = {};
            queueMicrotask(() => {
                if (failOpen) {
                    request.error = new Error('storage denied');
                    request.onerror?.();
                    return;
                }
                request.result = connection;
                if (version < wanted) {
                    version = wanted;
                    request.onupgradeneeded?.({ target: request });
                }
                request.onsuccess?.();
            });
            return request;
        },
    };
}

describe('the IndexedDB store', () => {
    const request = { ...SMALL, scatter: null };
    const options = (indexedDB) => ({ indexedDB, connection: { db: null, _opening: null } });

    it('reads back exactly what it kept, for the same key only', async () => {
        const idb = fakeIndexedDB();
        const opts = options(idb);
        const copy = keptCopy();
        copy.relief.data[5] = 4242;
        await expect(storeWorldBake('K1', copy, opts)).resolves.toBe(true);

        const metaAnswers = [];
        const back = await readStoredWorldBake('K1', request, { ...opts, onMeta: (m) => metaAnswers.push(m) });
        expect(back.relief.data[5]).toBe(4242);
        expect(back.relief.data).toBeInstanceOf(Uint16Array);
        expect(metaAnswers).toEqual([true]);

        const other = await readStoredWorldBake('K2', request, { ...opts, onMeta: (m) => metaAnswers.push(m) });
        expect(other).toBeNull();
        expect(metaAnswers).toEqual([true, false]);
    });

    it('keeps one copy: a new key replaces the old one', async () => {
        const idb = fakeIndexedDB();
        const opts = options(idb);
        await storeWorldBake('K1', keptCopy(), opts);
        await storeWorldBake('K2', keptCopy(), opts);
        expect([...idb.stores.get('bake').keys()].sort()).toEqual(['data', 'meta']);
        expect(await readStoredWorldBake('K1', request, opts)).toBeNull();
        expect(await readStoredWorldBake('K2', request, opts)).not.toBeNull();
    });

    it('reads a copy that does not fit this bake as no copy', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const idb = fakeIndexedDB();
        const opts = options(idb);
        await storeWorldBake('K1', keptCopy(), opts);
        expect(await readStoredWorldBake('K1', { ...request, shadowRes: 24 }, opts)).toBeNull();
        expect(await readStoredWorldBake('K1', { ...request, scatter: { spacing: 24 } }, opts)).toBeNull();
    });

    it('never throws: no database, a refused open or an uncloneable bake read as a miss or no write', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const onMeta = vi.fn();
        const refused = options(fakeIndexedDB({ failOpen: true }));
        await expect(readStoredWorldBake('K1', request, { ...refused, onMeta })).resolves.toBeNull();
        expect(onMeta).toHaveBeenCalledWith(false); // the loader starts its workers on this
        await expect(storeWorldBake('K1', keptCopy(), refused)).resolves.toBe(false);
        const broken = { ...keptCopy(), scatter: { placements: [], fn: () => {} } };
        await expect(storeWorldBake('K1', broken, options(fakeIndexedDB()))).resolves.toBe(false);
        await expect(readStoredWorldBake('K1', request, options(undefined))).resolves.toBeNull();
    });

    it('checks the shapes the board consumes', () => {
        const copy = keptCopy();
        expect(isUsableStoredWorldBake(copy, request)).toBe(true);
        const shortMirror = { ...copy, relief: { ...copy.relief, total: new Float32Array(3) } };
        expect(isUsableStoredWorldBake(shortMirror, request)).toBe(false);
        expect(isUsableStoredWorldBake(copy, { ...request, reliefRes: 64 })).toBe(false);
        expect(isUsableStoredWorldBake(copy, { ...request, cloudField: true, cloudSpecs: [{}] })).toBe(false);
        const withField = { ...copy, cloudField: { position: new Float32Array(9), masses: 1 } };
        expect(isUsableStoredWorldBake(withField, { ...request, cloudField: true, cloudSpecs: [{}] })).toBe(true);
        const withForest = {
            ...copy,
            scatter: {
                placements: [], buckets: new Map(), stats: { trees: 0 }, shade: { data: new Uint8Array(4) },
            },
        };
        expect(isUsableStoredWorldBake(withForest, { ...request, scatter: { spacing: 24 } })).toBe(true);
        expect(isUsableStoredWorldBake(null, request)).toBe(false);
    });

    it('is kept only where there is IndexedDB and memory to spare', () => {
        const idb = fakeIndexedDB();
        expect(worldBakeStoreAvailable({ indexedDB: idb, deviceMemory: 8 })).toBe(true);
        expect(worldBakeStoreAvailable({ indexedDB: idb, deviceMemory: undefined })).toBe(true);
        expect(worldBakeStoreAvailable({ indexedDB: idb, deviceMemory: 2 })).toBe(false);
        expect(worldBakeStoreAvailable({ indexedDB: undefined, deviceMemory: 8 })).toBe(false);
    });
});

describe('the mode starts the bake the board will ask for', () => {
    const registry = getLevelRegistry();

    function stubPage() {
        vi.stubGlobal('window', { settings: { effectQuality: 'High' }, location: { search: '' } });
    }

    it('the board\'s own request is handed the bake the mode started', async () => {
        stubPage();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const started = OdysseyBoardController.prestartWorldBake(registry);
        expect(started).not.toBeNull();
        expect(started.reused).toBeUndefined();

        // Run the board's initialize() up to its first await (the renderer), as the mode does.
        const board = Object.create(OdysseyBoardController.prototype);
        Object.assign(board, {
            layoutOverride: null,
            oneWorldEnabled: true,
            targetFrameRateOption: null,
            adaptiveQuality: {},
            _adaptiveCtx: {},
        });
        const stop = new Error('stop at the renderer');
        board.initRenderer = () => { throw stop; };
        await expect(board.initialize(registry.getAllLevelPresentations(), {}, registry.getPresentationLayout()))
            .rejects.toBe(stop);
        expect(board._worldBake.reused).toBe(true);
        // Not by accident of an empty request: it carries the rail and the forest.
        expect(board._worldBakeOptions.railSamples).toHaveLength(48);
        expect(board._worldBakeOptions.scatter).not.toBeNull();
    });

    it('starts nothing when the board will build no world', () => {
        vi.stubGlobal('window', { settings: { effectQuality: 'High' }, location: { search: '?odysseyOneWorld=0' } });
        expect(OdysseyBoardController.prestartWorldBake(registry)).toBeNull();
    });

    it('never throws into the mode\'s activation', () => {
        stubPage();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const broken = { getAllLevelPresentations: () => { throw new Error('registry not ready'); } };
        expect(OdysseyBoardController.prestartWorldBake(broken)).toBeNull();
    });

    it('is the first thing the mode does when it activates', () => {
        const src = read('core/game-modes/OdysseyMode.js');
        const activate = src.indexOf('    async onActivate() {');
        const prestart = src.indexOf('OdysseyBoardController.prestartWorldBake(this.levelRegistry);', activate);
        const firstWait = src.indexOf('await this._applyBoardAudioPolicy', activate);
        expect(activate).toBeGreaterThan(-1);
        expect(prestart).toBeGreaterThan(activate);
        expect(prestart).toBeLessThan(firstWait);
    });
});
