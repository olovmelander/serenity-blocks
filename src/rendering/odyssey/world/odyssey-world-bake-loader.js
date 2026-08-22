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
 */

import {
    bakeReliefData, bakeGroundSunFieldsData, bakeGroundAtlasData, bakeDetailNormalData, bakeMacroData,
    makeReliefSampler, mergeReliefBands, reliefBandRanges,
} from './odyssey-world-bake-data.js';
import { buildCloudFieldGeometryData } from './odyssey-cloud-field.js';

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/**
 * Synchronous twin of the worker (same stage order, same functions). Used as the fallback and by
 * tests; the stages resolve immediately.
 */
export function bakeWorldSync({
    reliefRes, shadowRes, cloudSpecs = null, railSamples = null, cloudField = false,
}) {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
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
    const t5 = now();
    const field = cloudField && Array.isArray(cloudSpecs) ? buildCloudFieldGeometryData(cloudSpecs, railSamples) : null;
    const t6 = now();
    return {
        relief,
        textures: {
            sunFields, atlas, detail, macro,
        },
        cloudField: field,
        ms: {
            relief: +(t1 - t0).toFixed(1),
            sunFields: +(t2 - t1).toFixed(1),
            atlas: +(t3 - t2).toFixed(1),
            detail: +(t4 - t3).toFixed(1),
            macro: +(t5 - t4).toFixed(1),
            cloudField: +(t6 - t5).toFixed(1),
            total: +(t6 - t0).toFixed(1),
        },
    };
}

/**
 * Start the bakes. Prefer a module Worker; otherwise (or on any worker failure) the synchronous
 * twin runs on the first await of any stage.
 * @param {{reliefRes: number, shadowRes: number, cloudSpecs?: object[]|null, railSamples?: object[]|null, cloudField?: boolean, forceSync?: boolean}} request
 * @returns {{relief: Promise<object>, textures: Promise<object>, cloudField: Promise<object|null>, done: Promise<object>, viaWorker: boolean, startedAt: number}}
 */
export function startWorldBake(request) {
    const relief = deferred();
    const textures = deferred();
    const cloudField = deferred();
    const done = deferred();
    const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
    const handle = {
        relief: relief.promise, textures: textures.promise, cloudField: cloudField.promise, done: done.promise, viaWorker: false, startedAt,
    };
    // Promises nobody awaits must not surface as unhandled rejections (the fallback re-runs).
    [relief, textures, cloudField, done].forEach((d) => d.promise.catch(() => {}));

    let settled = false;
    const runSync = () => {
        if (settled) return;
        settled = true;
        try {
            const out = bakeWorldSync(request);
            relief.resolve(out.relief);
            textures.resolve(out.textures);
            cloudField.resolve(out.cloudField);
            done.resolve({ ms: out.ms, viaWorker: false });
        } catch (error) {
            [relief, textures, cloudField, done].forEach((d) => d.reject(error));
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
        for (const [key, d] of [['relief', relief], ['textures', textures], ['cloudField', cloudField], ['done', done]]) {
            Object.defineProperty(handle, key, {
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
        sunFields: null, atlas: null, detail: null, macro: null,
    };
    const workers = new Set();
    let failed = false;
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
        if (plates.sunFields && plates.atlas && plates.detail && plates.macro) textures.resolve({ ...plates });
    };
    const spawn = (message, transfer, onStage, options = {}) => {
        if (failed) return null;
        let worker;
        try {
            worker = new Worker(new URL('./odyssey-world-bake.worker.js', import.meta.url), { type: 'module' });
        } catch (error) {
            abort(error?.message || error);
            return null;
        }
        workers.add(worker);
        worker.onmessage = (event) => {
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

    // Lane 1..N — relief bands, merged here, then the sun march on the merged mirror.
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const bandCount = Math.max(1, Math.min(request.bandCount ?? (cores >= 8 ? 3 : 2), 8));
    const ranges = reliefBandRanges(request.reliefRes, bandCount);
    const bands = [];
    let hostWorker = null;
    ranges.forEach((range, bandIndex) => {
        const worker = spawn({
            lane: 'reliefBand', reliefRes: request.reliefRes, jStart: range.jStart, jEnd: range.jEnd,
        }, undefined, (msg) => {
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
            if (hostWorker) hostWorker.postMessage(sunJob, [mirror.buffer]);
            else {
                spawn(sunJob, [mirror.buffer], (sunMsg) => {
                    if (sunMsg.stage !== 'sunFields') return;
                    ms.sunFields = sunMsg.ms;
                    plates.sunFields = sunMsg.sunFields;
                    resolveTexturesWhenComplete();
                });
            }
        }, { keepAlive: bandIndex === 0 });
        if (bandIndex === 0 && worker) hostWorker = worker;
    });

    // Lane N+1 — the three plates that depend on nothing.
    spawn({ lane: 'plates' }, undefined, (msg) => {
        if (msg.stage !== 'atlas' && msg.stage !== 'detail' && msg.stage !== 'macro') return;
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

    Promise.all([relief.promise, textures.promise, cloudField.promise]).then(() => {
        if (failed || settled) return;
        settled = true;
        ms.total = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - startedAt);
        done.resolve({ ms, viaWorker: true });
    }).catch(() => { /* abort() already routed this to the synchronous twin */ });

    return handle;
}

/**
 * Await every stage into the `prebaked` shape `createOdysseyWorld` accepts.
 * @param {ReturnType<typeof startWorldBake>} handle
 */
export async function awaitWorldBake(handle) {
    const [relief, textures, cloudField, done] = await Promise.all([
        handle.relief, handle.textures, handle.cloudField, handle.done,
    ]);
    return {
        relief, textures, cloudField, ms: done.ms, viaWorker: done.viaWorker,
    };
}
