/**
 * Item 2.1 (2026-08-21): the One World boot bakes run in a Worker started before the renderer;
 * the world is assembled afterwards from the landed arrays. These tests pin the contract the
 * board relies on: the loader's synchronous twin is byte-identical to the direct bakes, its
 * stages resolve lazily (the caller's prologue is not charged), `createOdysseyWorld` consumes
 * `prebaked` data without re-baking and produces the same texels, and a mismatched resolution or
 * spec slice is ignored rather than trusted.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    awaitWorldBake, bakeWorldSync, startWorldBake,
} from '../../src/rendering/odyssey/world/odyssey-world-bake-loader.js';
import {
    bakeReliefData, bakeMacroData, makeReliefSampler,
} from '../../src/rendering/odyssey/world/odyssey-world-bake-data.js';
import { ODYSSEY_CLOUD_FIELD_SPECS } from '../../src/rendering/odyssey/world/odyssey-cloud-field-specs.js';
import { buildCloudFieldGeometryData } from '../../src/rendering/odyssey/world/odyssey-cloud-field.js';
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
        expect(Object.keys(out.ms)).toEqual(['relief', 'sunFields', 'atlas', 'detail', 'macro', 'cloudField', 'total']);
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
            relief: true, textures: true, cloudField: true, viaWorker: true, workerMs: baked.ms,
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
