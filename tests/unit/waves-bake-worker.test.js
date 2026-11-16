import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeFoamLace, bakeWaterNoise } from '../../src/themes/waves/waves-core.js';
import {
    hasWavesBake, keepWavesBake, sessionFoamLace, sessionWaterNoise, wavesBakeJobs, wavesBakes,
} from '../../src/themes/waves/waves-bakes.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import { createFoamLace, createWaterNoise } from '../../src/themes/waves/waves-tsl.js';

/**
 * Waves baked its water noise on every start (~58 ms of main thread), and now bakes a field of
 * foam cells beside it. Both are kept for the session and a first visit bakes them in a module
 * Worker; the jobs must be exactly the bakes the world reads.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/waves/${name}`, import.meta.url), 'utf8');

describe('Waves keeps its two bakes for the session and bakes a first visit in a worker', () => {
    it('names the two bakes the world builds from, served by its worker from a three-free module', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = tierFor(quality);
            expect(wavesBakeJobs(quality), quality).toEqual([
                { kind: 'water', args: [tier.noise] },
                { kind: 'foam', args: [tier.lace] },
            ]);
        }
        expect(source('waves-core.js')).not.toMatch(/from 'three/);
        // Each kind of job is the function the page itself would bake with.
        expect(source('waves-bake.worker.js')).toMatch(/\bwater: bakeWaterNoise\b/);
        expect(source('waves-bake.worker.js')).toMatch(/\bfoam: bakeFoamLace\b/);
        expect(source('waves-theme.js')).toContain('const baking = wavesBakes(this.quality);');
        expect(source('waves-tsl.js')).toContain('sessionWaterNoise(size)');
        expect(source('waves-tsl.js')).toContain('sessionFoamLace(size)');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(wavesBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted; every texture reads it, and it is the page\'s bake', () => {
        const [job] = wavesBakeJobs('Low');
        expect(hasWavesBake(job)).toBe(false);
        keepWavesBake(job, new Uint8Array(4));
        expect(hasWavesBake(job)).toBe(false);
        const posted = bakeWaterNoise(...job.args);
        keepWavesBake(job, posted);
        expect(hasWavesBake(job)).toBe(true);
        const a = createWaterNoise(job.args[0]);
        const b = createWaterNoise(job.args[0]);
        expect(a).not.toBe(b);
        expect(a.image.data).toBe(posted);
        expect(b.image.data).toBe(posted);
        expect(a).toBeInstanceOf(THREE.DataTexture);
        expect(Buffer.compare(Buffer.from(posted), Buffer.from(bakeWaterNoise(job.args[0])))).toBe(0);
    });

    it('keeps the foam cells the same way, apart from the noise even where the two are one size', () => {
        // Medium bakes both at one size: one must not be taken for the other.
        const [water, foam] = wavesBakeJobs('Medium');
        expect(foam.args).toEqual(water.args);
        const noise = sessionWaterNoise(...water.args);
        expect(hasWavesBake(water)).toBe(true);
        expect(hasWavesBake(foam)).toBe(false);
        // Not a square of bytes of its size: not kept.
        keepWavesBake(foam, new Uint8Array(4));
        keepWavesBake(foam, Array.from(noise));
        expect(hasWavesBake(foam)).toBe(false);
        const posted = bakeFoamLace(...foam.args);
        keepWavesBake(foam, posted);
        expect(hasWavesBake(foam)).toBe(true);
        // Kept once: a second post of the same job changes nothing.
        keepWavesBake(foam, bakeFoamLace(...foam.args));
        expect(sessionFoamLace(foam.args[0])).toBe(posted);
        expect(sessionWaterNoise(water.args[0])).toBe(noise);
        const lace = createFoamLace(foam.args[0]);
        expect(lace).toBeInstanceOf(THREE.DataTexture);
        expect(lace.image.data).toBe(posted);
        expect(createFoamLace(foam.args[0]).image.data).toBe(posted);
        expect(Buffer.compare(Buffer.from(posted), Buffer.from(bakeFoamLace(foam.args[0])))).toBe(0);
        // It tiles and is filtered down like the noise: a field sampled far out on the sea.
        expect(lace.wrapS).toBe(THREE.RepeatWrapping);
        expect(lace.wrapT).toBe(THREE.RepeatWrapping);
        expect(lace.generateMipmaps).toBe(true);
        expect(lace.colorSpace).toBe(THREE.NoColorSpace);
        expect([lace.image.width, lace.image.height]).toEqual([foam.args[0], foam.args[0]]);
    });

    it('bakes on the page what no worker posted, once, and keeps nothing for a job it does not know', () => {
        const size = 32; // no tier's: nothing has asked for it yet
        expect(hasWavesBake({ kind: 'foam', args: [size] })).toBe(false);
        const lace = sessionFoamLace(size);
        expect(lace).toHaveLength(size * size * 4);
        expect(sessionFoamLace(size)).toBe(lace);
        expect(hasWavesBake({ kind: 'foam', args: [size] })).toBe(true);
        expect(hasWavesBake({ kind: 'water', args: [size] })).toBe(false);
        expect(sessionWaterNoise(size)).not.toBe(lace);
        // A kind of job that is none of its bakes is not kept, whatever came with it.
        const stray = { kind: 'sand', args: [size] };
        keepWavesBake(stray, new Uint8Array(size * size * 4));
        expect(hasWavesBake(stray)).toBe(false);
    });
});
