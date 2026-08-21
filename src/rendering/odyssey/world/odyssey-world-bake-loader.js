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
    makeReliefSampler,
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

    let worker = null;
    if (!request.forceSync && typeof Worker !== 'undefined') {
        try {
            worker = new Worker(new URL('./odyssey-world-bake.worker.js', import.meta.url), { type: 'module' });
        } catch {
            worker = null;
        }
    }
    if (!worker) {
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
    const ms = {};
    worker.onmessage = (event) => {
        const msg = event?.data || {};
        if (msg.stage === 'relief') { ms.relief = msg.ms; relief.resolve(msg.relief); return; }
        if (msg.stage === 'textures') {
            Object.assign(ms, msg.ms);
            textures.resolve({
                sunFields: msg.sunFields, atlas: msg.atlas, detail: msg.detail, macro: msg.macro,
            });
            return;
        }
        if (msg.stage === 'cloudField') { ms.cloudField = msg.ms; cloudField.resolve(msg.field); return; }
        if (msg.stage === 'done') {
            if (!request.cloudField) cloudField.resolve(null);
            ms.total = msg.ms;
            settled = true;
            done.resolve({ ms, viaWorker: true });
            worker.terminate();
            return;
        }
        if (msg.stage === 'error') {
            console.warn('[world-bake] worker failed, baking on the main thread:', msg.message);
            worker.terminate();
            handle.viaWorker = false;
            runSync();
        }
    };
    worker.onerror = (event) => {
        console.warn('[world-bake] worker error, baking on the main thread:', event?.message || event);
        worker.terminate();
        handle.viaWorker = false;
        runSync();
    };
    worker.postMessage({
        reliefRes: request.reliefRes,
        shadowRes: request.shadowRes,
        cloudSpecs: request.cloudSpecs ?? null,
        railSamples: request.railSamples ?? null,
        cloudField: !!request.cloudField,
    });
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
