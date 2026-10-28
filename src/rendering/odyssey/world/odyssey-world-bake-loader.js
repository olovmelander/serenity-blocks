/**
 * @fileoverview Starts the One World boot bakes as early as their inputs exist and hands each
 * stage to the board as a promise (plan item 2.1, 2026-08-21).
 *
 * WHY. The world bucket was 1.74 s of the cold Odyssey startup on every cell, 1.08–1.14 s of it
 * the five texture bakes and ~0.3–0.6 s the cloud-field sculpt — deterministic, input-free CPU
 * inside ONE long task, the largest frame in every cell (AGGREGATE.md r185p1live). Every input
 * (quality, flags, the 48 rail samples) is known before `renderer.init()` is awaited, and
 * `nodes` needs only the height mirror, so the bakes can run in a Worker while the renderer,
 * chapter 1, the path and the nodes are built, and the world itself (clipmaps, materials, forest)
 * is assembled afterwards from the landed arrays.
 *
 * Contract: {@link startWorldBake} returns `{ relief, textures, cloudField, done, viaWorker }`
 * promises. With no Worker (vitest, a CSP that forbids it, a spawn error) the same pure functions
 * run synchronously on the caller's thread at the first await — the exact code path the goldens
 * pin — so the result is byte-identical either way.
 *
 * ONE BAKE A SESSION, AND ONE ACROSS LAUNCHES (perf audit 2026-10-28). The bake depends only on
 * its request and on the code that runs it, yet every Odyssey visit baked it again (~3 s of CPU
 * over four or five workers on the audit's cloud runner, 37-43 MB out). The session's bake is now
 * kept, in flight or landed: a request with the same inputs is handed the same promises, so a
 * re-entry (or OdysseyMode's start at activation, then the board's own request) bakes once.
 * Sharing the landed arrays is safe because nothing consumes them destructively: the world wraps
 * them as textures and attributes, and nothing is transferred once they have landed. A production
 * build also keeps a copy in IndexedDB (odyssey-world-bake-store.js) keyed by this chunk's URL, so
 * the next launch reads it instead of baking; the workers start as soon as the store says it has
 * no copy for this key, or after a short grace if it is slow to say. `cache: false` (the board's
 * `?odysseyNoBakeCache=1`) bakes afresh and keeps nothing, as before.
 */

import {
    bakeReliefData, bakeGroundSunFieldsData, bakeGroundAtlasData, bakeDetailNormalData, bakeMacroData, bakeSculptPlateData,
    makeReliefSampler, mergeReliefBands, reliefBandRanges,
} from './odyssey-world-bake-data.js';
import { buildCloudFieldGeometryData } from './odyssey-cloud-field.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { bakeForestShadeData } from './odyssey-forest-shade.js';
import { readStoredWorldBake, storeWorldBake, worldBakeStoreAvailable } from './odyssey-world-bake-store.js';

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The stages a handle carries. */
const STAGE_KEYS = ['relief', 'textures', 'cloudField', 'scatter', 'done'];

/**
 * How long the kept copy may take to say whether it has this bake before the workers start
 * anyway: a store slow to answer never holds the bake up by more than this.
 */
const STORE_GRACE_MS = 250;

/**
 * What a copy kept across launches is keyed by besides the request: in a production build, this
 * chunk's URL. It names the chunk's content hash, and the chunk embeds the hashed name of the
 * worker's bundle (`new URL("odyssey-world-bake.worker-<hash>.js", import.meta.url)`), so it
 * changes whenever any code the bake runs does. Dev servers and tests have no such name and keep
 * no copy.
 */
const STORE_FINGERPRINT = (() => {
    try {
        return import.meta.env.PROD === true ? String(import.meta.url) : null;
    } catch {
        return null; // no Vite (a plain Node import)
    }
})();

const KEPT_COPY_STORE = { read: readStoredWorldBake, write: storeWorldBake };

/**
 * The key two requests share one bake under: everything the bakes read, nothing that only
 * changes how they run (the band count, the synchronous lever, the cache lever).
 * @param {{reliefRes: number, shadowRes: number, cloudSpecs?: object[]|null, railSamples?: object[]|null, cloudField?: boolean, scatter?: object|null}} request
 * @returns {string}
 */
export function worldBakeKey(request) {
    const field = !!request.cloudField && Array.isArray(request.cloudSpecs);
    return JSON.stringify({
        reliefRes: request.reliefRes,
        shadowRes: request.shadowRes,
        cloudSpecs: field ? request.cloudSpecs : null,
        railSamples: field ? (request.railSamples ?? null) : null,
        scatter: request.scatter ?? null,
    });
}

/**
 * The session's bake, in flight or landed, and the key it was asked under. One at a time: a
 * request for other inputs replaces it (a change of quality lane), and a bake that fails is
 * forgotten. It outlives the board, as CPU memory only; the board's GPU copies go with the board.
 */
let sessionBake = null;

/** Forget the session's bake: the next request bakes (or reads the kept copy) again. */
export function forgetWorldBake() {
    sessionBake = null;
}

/**
 * Another handle on the same bake. Every stage is the source's own promise, read through it, so
 * a synchronous-twin source still bakes on the first access of a stage from either handle.
 */
function shareWorldBake(source) {
    const view = { reused: true, startedAt: now() };
    for (const key of [...STAGE_KEYS, 'viaWorker']) {
        Object.defineProperty(view, key, { enumerable: true, get: () => source[key] });
    }
    return view;
}

/** Run `task` once the page is idle (bounded), or shortly. */
function whenPageIdle(task) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => task(), { timeout: 4000 });
    else setTimeout(task, 500);
}

/**
 * Synchronous twin of the worker (same stage order, same functions). Used as the fallback and by
 * tests; the stages resolve immediately.
 */
export function bakeWorldSync({
    reliefRes, shadowRes, cloudSpecs = null, railSamples = null, cloudField = false, scatter = null,
}) {
    const t0 = now();
    const relief = bakeReliefData(reliefRes);
    const t1 = now();
    const sunFields = bakeGroundSunFieldsData(makeReliefSampler(relief), shadowRes);
    const t2 = now();
    const atlas = bakeGroundAtlasData();
    const t3 = now();
    const detail = bakeDetailNormalData();
    const t4 = now();
    const macro = bakeMacroData();
    const summit = bakeSculptPlateData();
    const t5 = now();
    const field = cloudField && Array.isArray(cloudSpecs) ? buildCloudFieldGeometryData(cloudSpecs, railSamples) : null;
    const t6 = now();
    const zoned = scatter ? scatterZonedForest(makeReliefSampler(relief), scatter) : null;
    if (zoned) zoned.shade = bakeForestShadeData(zoned.placements, makeReliefSampler(relief));
    const t7 = now();
    return {
        relief,
        textures: {
            sunFields, atlas, detail, macro, summit,
        },
        cloudField: field,
        scatter: zoned,
        ms: {
            relief: +(t1 - t0).toFixed(1),
            sunFields: +(t2 - t1).toFixed(1),
            atlas: +(t3 - t2).toFixed(1),
            detail: +(t4 - t3).toFixed(1),
            macro: +(t5 - t4).toFixed(1),
            cloudField: +(t6 - t5).toFixed(1),
            scatter: +(t7 - t6).toFixed(1),
            total: +(t7 - t0).toFixed(1),
        },
    };
}

/**
 * Start the bakes, or hand back the session's bake when it was asked for the same inputs (it may
 * still be in flight). Prefer module Workers, after the copy kept across launches if a production
 * build has one; otherwise (or on any worker failure) the synchronous twin runs on the first await
 * of any stage.
 * @param {{reliefRes: number, shadowRes: number, cloudSpecs?: object[]|null, railSamples?: object[]|null, cloudField?: boolean, forceSync?: boolean, cache?: boolean}} request
 *   `cache: false` bakes afresh and keeps nothing
 * @param {{store?: {read: Function, write: Function}|null, fingerprint?: string|null, graceMs?: number, whenIdle?: Function}} [env]
 *   seams for tests: the kept copy (null for none), what it is keyed by, how long its answer is
 *   waited for, and when a fresh bake is written to it
 * @returns {{relief: Promise<object>, textures: Promise<object>, cloudField: Promise<object|null>, done: Promise<object>, viaWorker: boolean, startedAt: number, reused?: boolean}}
 */
export function startWorldBake(request, env = {}) {
    const key = request.cache === false ? null : worldBakeKey(request);
    if (key && sessionBake?.key === key) return shareWorldBake(sessionBake.handle);
    const handle = bakeWorld(request, key, env);
    if (key) sessionBake = { key, handle };
    return handle;
}

function bakeWorld(request, key, env) {
    const relief = deferred();
    const textures = deferred();
    const cloudField = deferred();
    const scatter = deferred();
    const done = deferred();
    const startedAt = now();
    const handle = {
        relief: relief.promise,
        textures: textures.promise,
        cloudField: cloudField.promise,
        scatter: scatter.promise,
        done: done.promise,
        viaWorker: false,
        startedAt,
    };
    // Promises nobody awaits must not surface as unhandled rejections (the fallback re-runs).
    [relief, textures, cloudField, scatter, done].forEach((d) => d.promise.catch(() => {}));
    // A bake that failed outright is not kept: the next request bakes again.
    done.promise.catch(() => { if (sessionBake?.handle === handle) sessionBake = null; });

    let settled = false;
    const runSync = () => {
        if (settled) return;
        settled = true;
        try {
            const out = bakeWorldSync(request);
            relief.resolve(out.relief);
            textures.resolve(out.textures);
            cloudField.resolve(out.cloudField);
            scatter.resolve(out.scatter);
            done.resolve({ ms: out.ms, viaWorker: false, source: 'sync' });
        } catch (error) {
            [relief, textures, cloudField, scatter, done].forEach((d) => d.reject(error));
        }
    };

    // Workers unavailable (vitest, ?odysseyWorldBakeSync=1, a CSP that forbids them): the lanes
    // below are skipped and the synchronous twin runs on the first stage ACCESS. Each lane still
    // falls back on its own construction error (see abort()).
    if (request.forceSync || typeof Worker === 'undefined') {
        // Lazily, on the first ACCESS of any stage (`await handle.relief` reads the property):
        // the caller's synchronous prologue is not charged, and the bake runs exactly where the
        // old synchronous build did. (An overridden `.then` would not work — `await` on a native
        // promise bypasses it.)
        const stages = [
            ['relief', relief], ['textures', textures], ['cloudField', cloudField],
            ['scatter', scatter], ['done', done],
        ];
        for (const [stage, d] of stages) {
            Object.defineProperty(handle, stage, {
                enumerable: true,
                configurable: true,
                get() { runSync(); return d.promise; },
            });
        }
        return handle;
    }
    handle.viaWorker = true;
    // PARALLEL LANES (item 2.4, 2026-08-21). A single serial worker ran ~1.8 s and, once the
    // startup CPU steps stopped costing a second of yield latency, the world step waited on it.
    // The plate splits per texel, so the relief bake runs as N row BANDS at once; the sun march
    // (whole-plate, and normalised over it) follows on the merged mirror; the other three plates
    // and the cloud-field sculpt are independent lanes from the start. Wall time is the longest
    // chain (band + sunFields), not the sum of six bakes.
    const ms = {};
    const plates = {
        sunFields: null, atlas: null, detail: null, macro: null, summit: null,
    };
    const workers = new Set();
    let failed = false;
    // The kept copy landed first: every worker is stopped, and none is started after it.
    let closed = false;
    const abort = (why) => {
        if (failed || settled) return;
        failed = true;
        console.warn('[world-bake] worker failed, baking on the main thread:', why);
        workers.forEach((w) => w.terminate());
        workers.clear();
        handle.viaWorker = false;
        runSync();
    };
    const resolveTexturesWhenComplete = () => {
        if (plates.sunFields && plates.atlas && plates.detail && plates.macro && plates.summit) {
            textures.resolve({ ...plates });
        }
    };
    const spawn = (message, transfer, onStage, options = {}) => {
        if (failed || closed) return null;
        let worker;
        try {
            worker = new Worker(new URL('./odyssey-world-bake.worker.js', import.meta.url), { type: 'module' });
        } catch (error) {
            abort(error?.message || error);
            return null;
        }
        workers.add(worker);
        if (options.keepAlive) worker.__odysseyKeptAlive = true;
        worker.onmessage = (event) => {
            if (closed) return;
            const msg = event?.data || {};
            if (msg.stage === 'error') { abort(msg.message); return; }
            if (msg.stage === 'done') {
                ms[`lane:${msg.lane}`] = msg.ms;
                // A worker kept warm has a follow-up job coming (the sun march); it is
                // terminated when that lands. Spawning a module Worker costs 0.3-0.5 s on the
                // dev server, which would otherwise sit in the middle of the critical chain.
                if (options.keepAlive && !worker.__odysseyRetired) return;
                worker.terminate();
                workers.delete(worker);
                return;
            }
            onStage(msg);
        };
        worker.onerror = (event) => abort(event?.message || event);
        worker.postMessage(message, transfer);
        return worker;
    };

    let workersStarted = false;
    const startWorkers = () => {
        if (workersStarted || settled) return;
        workersStarted = true;
        // Lane 1..N — relief bands, merged here, then the sun march on the merged mirror.
        // Band count. More bands shorten the relief half of the only dependency chain (bands -> sun
        // march) but each one is another module Worker to spawn, and spawning is NOT free: measured
        // 2026-08-22 on the dev server, the bake wall was 1,388 ms at 3 bands, 1,412 at 6 and 1,514 at
        // 8 — the split paid for itself and no more. Three it is (two on small machines);
        // ?odysseyBakeBands=N re-measures it anywhere (a packaged build spawns from one 107 KB chunk,
        // so its knee may sit higher).
        const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
        const bandCount = Math.max(1, Math.min(request.bandCount ?? (cores >= 8 ? 3 : 2), 8));
        const ranges = reliefBandRanges(request.reliefRes, bandCount);
        const bands = [];
        let hostWorker = null;
        let scatterWorker = null;
        ranges.forEach((range, bandIndex) => {
            const worker = spawn({
                lane: 'reliefBand', reliefRes: request.reliefRes, jStart: range.jStart, jEnd: range.jEnd,
            }, undefined, (msg) => {
                if (msg.stage === 'scatter') {
                    ms.scatter = msg.ms;
                    // Retire only a DEDICATED scatter worker. At ?odysseyBakeBands=1 there is no band 1,
                    // so the scatter ran on the HOST — which still owes the sun march queued behind it.
                    // Retiring the host here made the scatter job's own {stage:"done"} terminate it
                    // mid-march: sunFields never arrived, `textures` never resolved, and the board sat
                    // in `await awaitWorldBake(...)` forever (terminate() raises nothing, so abort() and
                    // the synchronous twin never fired either). The host is retired by its own
                    // 'sunFields' branch below, which is the correct point.
                    if (scatterWorker) scatterWorker.__odysseyRetired = true;
                    scatter.resolve(msg.zoned);
                    return;
                }
                if (msg.stage === 'sunFields') {
                    ms.sunFields = msg.ms;
                    plates.sunFields = msg.sunFields;
                    if (hostWorker) hostWorker.__odysseyRetired = true;
                    resolveTexturesWhenComplete();
                    return;
                }
                if (msg.stage !== 'reliefBand') return;
                ms[`band:${msg.band.jStart}`] = msg.ms;
                bands.push(msg.band);
                if (bands.length !== ranges.length) return;
                const merged = mergeReliefBands(bands, request.reliefRes);
                relief.resolve(merged);
                // The sun march needs its own copy: a transfer would detach the mirror the board
                // seats its level nodes against.
                const mirror = merged.total.slice();
                const sunJob = {
                    lane: 'sunFields',
                    shadowRes: request.shadowRes,
                    relief: {
                        total: mirror, res: merged.res, step: merged.step, origin: merged.origin,
                    },
                };
                if (request.scatter) {
                    // The scatter needs the same mirror; a second copy so both jobs own theirs.
                    const scatterMirror = merged.total.slice();
                    const scatterJob = {
                        lane: 'scatter',
                        scatter: request.scatter,
                        relief: {
                            total: scatterMirror, res: merged.res, step: merged.step, origin: merged.origin,
                        },
                    };
                    const target = scatterWorker || hostWorker;
                    if (target) target.postMessage(scatterJob, [scatterMirror.buffer]);
                    else spawn(scatterJob, [scatterMirror.buffer], () => {});
                } else {
                    scatter.resolve(null);
                }
                if (hostWorker) hostWorker.postMessage(sunJob, [mirror.buffer]);
                else {
                    spawn(sunJob, [mirror.buffer], (sunMsg) => {
                        if (sunMsg.stage !== 'sunFields') return;
                        ms.sunFields = sunMsg.ms;
                        plates.sunFields = sunMsg.sunFields;
                        resolveTexturesWhenComplete();
                    });
                }
            }, { keepAlive: bandIndex <= 1 });
            if (bandIndex === 0 && worker) hostWorker = worker;
            if (bandIndex === 1 && worker) scatterWorker = worker;
        });

        // Lane N+1 — the three plates that depend on nothing.
        spawn({ lane: 'plates' }, undefined, (msg) => {
            if (!['atlas', 'detail', 'macro', 'summit'].includes(msg.stage)) return;
            ms[msg.stage] = msg.ms;
            plates[msg.stage] = msg[msg.stage];
            resolveTexturesWhenComplete();
        });

        // Lane N+2 — the cloud-field sculpt (rail samples only).
        if (request.cloudField && Array.isArray(request.cloudSpecs)) {
            spawn({
                lane: 'cloudField', cloudSpecs: request.cloudSpecs, railSamples: request.railSamples ?? null,
            }, undefined, (msg) => {
                if (msg.stage !== 'cloudField') return;
                ms.cloudField = msg.ms;
                cloudField.resolve(msg.field);
            });
        } else {
            cloudField.resolve(null);
        }

        Promise.all([relief.promise, textures.promise, cloudField.promise, scatter.promise]).then(() => {
            if (failed || settled) return;
            settled = true;
            ms.total = Math.round(now() - startedAt);
            // A band worker kept warm for a follow-up that never came (no forest: band 1 waits
            // for a scatter job) idles until it is stopped; everything it could send has landed.
            workers.forEach((w) => {
                if (!w.__odysseyKeptAlive || w.__odysseyRetired) return;
                w.terminate();
                workers.delete(w);
            });
            done.resolve({ ms, viaWorker: true, source: 'worker' });
        }).catch(() => { /* abort() already routed this to the synchronous twin */ });
    };

    // THE COPY KEPT ACROSS LAUNCHES (production builds; odyssey-world-bake-store.js). Asked first,
    // since a copy makes every worker unnecessary: the workers start the moment it says it has
    // none for this key, or after STORE_GRACE_MS if it is slow to say, in which case whichever
    // lands first wins (the bytes are the same). A fresh bake is written to it once it has landed,
    // when the page is next idle (the board is then waiting on its pipeline compiles).
    let { store } = env;
    if (store === undefined) store = worldBakeStoreAvailable() ? KEPT_COPY_STORE : null;
    const fingerprint = env.fingerprint !== undefined ? env.fingerprint : STORE_FINGERPRINT;
    const storeKey = key && store && fingerprint ? `${fingerprint}\n${key}` : null;
    if (!storeKey) {
        startWorkers();
        return handle;
    }
    const grace = setTimeout(startWorkers, env.graceMs ?? STORE_GRACE_MS);
    const bakeInstead = () => {
        clearTimeout(grace);
        startWorkers();
    };
    store.read(storeKey, request, { onMeta: (match) => { if (!match) bakeInstead(); } }).then((kept) => {
        if (!kept) {
            bakeInstead();
            return;
        }
        clearTimeout(grace);
        if (settled) return; // the workers the grace started landed first
        settled = true;
        closed = true;
        workers.forEach((w) => w.terminate());
        workers.clear();
        handle.viaWorker = false;
        relief.resolve(kept.relief);
        textures.resolve(kept.textures);
        cloudField.resolve(kept.cloudField);
        scatter.resolve(kept.scatter);
        done.resolve({ ms: { kept: Math.round(now() - startedAt) }, viaWorker: false, source: 'kept' });
    }, bakeInstead);
    done.promise.then((landed) => {
        if (landed?.source === 'kept') return;
        (env.whenIdle ?? whenPageIdle)(() => {
            // Replaced (another lane was asked for since): the bake now kept writes its own.
            if (sessionBake?.handle !== handle) return;
            Promise.all([relief.promise, textures.promise, cloudField.promise, scatter.promise])
                .then(([r, t, c, z]) => store.write(storeKey, {
                    relief: r, textures: t, cloudField: c, scatter: z,
                }))
                .catch(() => { /* never kept: the next launch bakes */ });
        });
    }, () => { /* failed: nothing to keep */ });
    return handle;
}

/**
 * Await every stage into the `prebaked` shape `createOdysseyWorld` accepts.
 * @param {ReturnType<typeof startWorldBake>} handle
 */
export async function awaitWorldBake(handle) {
    const [relief, textures, cloudField, scatter, done] = await Promise.all([
        handle.relief, handle.textures, handle.cloudField, handle.scatter, handle.done,
    ]);
    return {
        relief, textures, cloudField, scatter, ms: done.ms, viaWorker: done.viaWorker, source: done.source,
    };
}
