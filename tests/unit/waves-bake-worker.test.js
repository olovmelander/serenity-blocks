import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeWaterNoise } from '../../src/themes/waves/waves-core.js';
import {
    hasWavesBake, keepWavesBake, wavesBakeJobs, wavesBakes,
} from '../../src/themes/waves/waves-bakes.js';
import { tierFor } from '../../src/themes/waves/waves-quality.js';
import { createWaterNoise } from '../../src/themes/waves/waves-tsl.js';

/**
 * Waves baked its water noise on every start (~58 ms of main thread). It is kept for the session
 * and a first visit bakes it in a module Worker; the job must be exactly the bake the world reads.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/waves/${name}`, import.meta.url), 'utf8');

describe('Waves keeps its water noise for the session and bakes a first visit in a worker', () => {
    it('names the bake the world builds from, served by its worker from a three-free module', () => {
        expect(wavesBakeJobs('High')).toEqual([{ kind: 'water', args: [tierFor('High').noise] }]);
        expect(source('waves-core.js')).not.toMatch(/from 'three/);
        expect(source('waves-bake.worker.js')).toMatch(/\bwater: bakeWaterNoise\b/);
        expect(source('waves-theme.js')).toContain('const baking = wavesBakes(this.quality);');
        expect(source('waves-tsl.js')).toContain('sessionWaterNoise(size)');
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
});
