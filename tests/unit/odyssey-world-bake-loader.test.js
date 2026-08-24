/**
 * Item 2.1 (2026-08-21): the One World boot bakes run in a Worker started before the renderer;
 * the world is assembled afterwards from the landed arrays. These tests pin the contract the
 * board relies on: the loader's synchronous twin is byte-identical to the direct bakes, its
 * stages resolve lazily (the caller's prologue is not charged), `createOdysseyWorld` consumes
 * `prebaked` data without re-baking and produces the same texels, and a mismatched resolution or
 * spec slice is ignored rather than trusted.
 */

import { createHash } from 'node:crypto';
import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import {
    awaitWorldBake, bakeWorldSync, startWorldBake,
} from '../../src/rendering/odyssey/world/odyssey-world-bake-loader.js';
import {
    bakeReliefData, bakeMacroData, makeReliefSampler,
} from '../../src/rendering/odyssey/world/odyssey-world-bake-data.js';
import { ODYSSEY_CLOUD_FIELD_SPECS } from '../../src/rendering/odyssey/world/odyssey-cloud-field-specs.js';
import { buildCloudFieldGeometryData } from '../../src/rendering/odyssey/world/odyssey-cloud-field.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';
import { ODYSSEY_WORLD_QUALITY, createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';

const sha = (typed) => createHash('sha256')
    .update(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength))
    .digest('hex')
    .slice(0, 32);

const RAIL = Array.from({ length: 48 }, (_, i) => ({ x: -2200 + (i * 90), y: 40 + (i % 7), z: 600 - (i * 30) }));

describe('world bake loader — synchronous twin', () => {
    it('is byte-identical to the direct bakes and carries per-stage timings', () => {
        const out = bakeWorldSync({
            reliefRes: 64, shadowRes: 32, cloudSpecs: ODYSSEY_CLOUD_FIELD_SPECS.slice(0, 2), railSamples: RAIL, cloudField: true,
        });
        expect(sha(out.relief.data)).toBe(sha(bakeReliefData(64).data));
        expect(sha(out.textures.macro.data)).toBe(sha(bakeMacroData().data));
        expect(out.cloudField.masses).toBe(2);
        expect(sha(out.cloudField.position)).toBe(sha(buildCloudFieldGeometryData(ODYSSEY_CLOUD_FIELD_SPECS.slice(0, 2), RAIL).position));
        expect(Object.keys(out.ms)).toEqual(['relief', 'sunFields', 'atlas', 'detail', 'macro', 'cloudField', 'scatter', 'total']);
    });

    it('startWorldBake without a Worker resolves its stages lazily, on the first await', async () => {
        expect(typeof Worker).toBe('undefined'); // vitest node environment
        const handle = startWorldBake({
            reliefRes: 48, shadowRes: 24, cloudField: false, forceSync: true,
        });
        expect(handle.viaWorker).toBe(false);
        const relief = await handle.relief;
        expect(relief.res).toBe(48);
        const all = await awaitWorldBake(handle);
        expect(all.viaWorker).toBe(false);
        expect(all.cloudField).toBeNull();
        expect(all.textures.sunFields.res).toBe(24);
        expect(sha(all.relief.data)).toBe(sha(relief.data)); // one bake, shared by every stage
        expect(makeReliefSampler(all.relief)(0, 0)).toBeTypeOf('number');
    });
});

describe('forest scatter lane', () => {
    it('runs the same scatter the world would have run itself (options passed through verbatim)', () => {
        const scatterOptions = {
            spacing: 24, seaLevel: 0, rail: RAIL, visibilityCull: true, forceLod: null, lodDistance: { hero: 200, mid: 520 },
        };
        const out = bakeWorldSync({
            reliefRes: 96, shadowRes: 32, cloudField: false, scatter: scatterOptions,
        });
        const direct = scatterZonedForest(makeReliefSampler(out.relief), scatterOptions);
        expect(out.scatter.stats).toEqual(direct.stats);
        expect(out.scatter.placements.length).toBe(direct.placements.length);
        expect([...out.scatter.buckets.keys()].sort()).toEqual([...direct.buckets.keys()].sort());
        expect(out.ms.scatter).toBeGreaterThanOrEqual(0);
    });

    it('is skipped (null) when the world does not build a forest', () => {
        const out = bakeWorldSync({ reliefRes: 64, shadowRes: 24, cloudField: false });
        expect(out.scatter).toBeNull();
    });
});

describe('createOdysseyWorld({ prebaked })', () => {
    const q = ODYSSEY_WORLD_QUALITY.low;
    const specs = ODYSSEY_CLOUD_FIELD_SPECS.slice(0, 3);

    it('uses the landed arrays, bakes nothing it was given, and produces the same texels', () => {
        const baked = bakeWorldSync({
            reliefRes: q.reliefRes, shadowRes: q.shadowRes, cloudSpecs: specs, railSamples: RAIL, cloudField: true,
        });
        const opts = {
            quality: 'low', forest: false, heroes: false, water: true, cloudField: true, cloudFieldCount: 3, railSamples: RAIL,
        };
        const direct = createOdysseyWorld(opts);
        const fromBake = createOdysseyWorld({
            ...opts,
            prebaked: {
                relief: baked.relief, textures: baked.textures, cloudField: baked.cloudField, ms: baked.ms, viaWorker: true,
            },
        });
        expect(fromBake.stats.prebaked).toEqual({
            relief: true, textures: true, cloudField: true, scatter: false, viaWorker: true, workerMs: baked.ms,
        });
        expect(direct.stats.prebaked).toBeNull();
        // The wrap is a few ms; a re-bake would be hundreds (the 'relief' span covers all five).
        expect(fromBake.stats.bakeMs.relief).toBeLessThan(direct.stats.bakeMs.relief / 4);
        // Same bytes uploaded either way, for every one of the five plates.
        for (const key of ['height', 'sunVis', 'atlas', 'detail', 'macro']) {
            expect(sha(fromBake.bakeTextures[key].image.data), key).toBe(sha(direct.bakeTextures[key].image.data));
        }
        expect(fromBake.stats.cloudFieldMasses).toBe(3);
        expect(fromBake.stats.cloudFieldTriangles).toBe(direct.stats.cloudFieldTriangles);
        expect(fromBake.heightAt(120, -80)).toBe(direct.heightAt(120, -80));
        direct.dispose();
        fromBake.dispose();
    });

    it('ignores prebaked data baked for another resolution or spec slice', () => {
        const baked = bakeWorldSync({
            reliefRes: 64, shadowRes: 32, cloudSpecs: specs.slice(0, 1), railSamples: RAIL, cloudField: true,
        });
        const world = createOdysseyWorld({
            quality: 'low',
            forest: false,
            heroes: false,
            cloudField: true,
            cloudFieldCount: 3,
            railSamples: RAIL,
            prebaked: { relief: baked.relief, textures: baked.textures, cloudField: baked.cloudField },
        });
        expect(world.stats.prebaked.relief).toBe(false); // 64 ≠ low's reliefRes
        expect(world.stats.prebaked.textures).toBe(true); // atlas/detail/macro are resolution-free; sunFields checked by res
        expect(world.stats.cloudFieldMasses).toBe(3); // the 1-mass bake was not trusted for a 3-mass slice
        world.dispose();
    });
});

/**
 * Item 2.4's parallel band lanes, driven by a Worker stub that ANSWERS (the tests above run with no
 * Worker at all). One job at a time, in arrival order, each job's stage messages then its `done` —
 * that serialisation is the point: at ?odysseyBakeBands=1 there is no band 1 to take the scatter,
 * so the scatter and the sun march queue on the SAME host worker, and a terminate() landing between
 * them is a world that never assembles. Payloads are the right shapes, not real bakes; the bytes
 * are pinned by the synchronous twin above.
 */
const spawnedWorkers = [];

function bakeWorkerReplies(job) {
    const out = [];
    if (job.lane === 'reliefBand') {
        const rows = job.jEnd - job.jStart;
        out.push({
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
    if (job.lane === 'scatter') {
        out.push({ stage: 'scatter', zoned: { placements: [], stats: {} }, ms: 1 });
    }
    if (job.lane === 'sunFields') {
        out.push({ stage: 'sunFields', sunFields: { data: new Uint8Array(4), res: job.shadowRes }, ms: 1 });
    }
    if (job.lane === 'plates') {
        out.push({ stage: 'atlas', atlas: { data: new Uint8Array(4) }, ms: 1 });
        out.push({ stage: 'detail', detail: { data: new Uint8Array(4) }, ms: 1 });
        out.push({ stage: 'macro', macro: { data: new Uint8Array(4) }, ms: 1 });
    }
    out.push({ stage: 'done', lane: job.lane, ms: 1 });
    return out;
}

class ReplyingBakeWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.jobs = [];
        this.lanesRun = [];
        this.terminated = false;
        spawnedWorkers.push(this);
    }

    postMessage(message) {
        this.jobs.push(message);
        queueMicrotask(() => this.runNextJob());
    }

    /** A terminated worker answers nothing — including a job already queued behind the last one. */
    runNextJob() {
        if (this.terminated) return;
        const job = this.jobs.shift();
        if (!job) return;
        this.lanesRun.push(job.lane);
        for (const message of bakeWorkerReplies(job)) {
            if (this.terminated) return;
            this.onmessage?.({ data: message });
        }
    }

    terminate() { this.terminated = true; }
}

/**
 * The finished bake, or 'stalled' if any stage is still pending. Every stub reply lands in a
 * microtask, so a bake that is going to finish HAS finished before any timer fires: the race is
 * deterministic, not a wall-clock guess.
 */
function bakeOrStall(handle) {
    return Promise.race([
        awaitWorldBake(handle),
        new Promise((resolve) => { setTimeout(() => resolve('stalled'), 0); }),
    ]);
}

describe('parallel band lanes', () => {
    beforeEach(() => { spawnedWorkers.length = 0; globalThis.Worker = ReplyingBakeWorker; });
    afterEach(() => { delete globalThis.Worker; });

    it('?odysseyBakeBands=1 finishes: the host survives the scatter it also ran', async () => {
        const out = await bakeOrStall(startWorldBake({
            reliefRes: 32, shadowRes: 16, cloudField: false, bandCount: 1, scatter: { spacing: 24, seaLevel: 0 },
        }));
        expect(out).not.toBe('stalled'); // retiring the host on 'scatter' terminated it mid sun march
        expect(out.viaWorker).toBe(true); // and it was the worker path, not abort()'s synchronous twin
        expect(out.textures.sunFields.res).toBe(16);
        expect(out.scatter).not.toBeNull();
        // Both follow-up jobs ran on the one band worker, in order — and it is still retired at the end.
        expect(spawnedWorkers.map((w) => w.lanesRun)).toEqual([
            ['reliefBand', 'scatter', 'sunFields'], ['plates'],
        ]);
        expect(spawnedWorkers.every((w) => w.terminated)).toBe(true);
    });

    it('two bands still hand the scatter to band 1 and the sun march to the host', async () => {
        const out = await bakeOrStall(startWorldBake({
            reliefRes: 32, shadowRes: 16, cloudField: false, bandCount: 2, scatter: { spacing: 24, seaLevel: 0 },
        }));
        expect(out).not.toBe('stalled');
        expect(spawnedWorkers.map((w) => w.lanesRun)).toEqual([
            ['reliefBand', 'sunFields'], ['reliefBand', 'scatter'], ['plates'],
        ]);
        expect(spawnedWorkers.every((w) => w.terminated)).toBe(true);
    });
});
