import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    AURORA_SEED, NOISE_SIZE, auroraBakeJobs, auroraBakes, hasAuroraBake, keepAuroraBake, landSeedOf, noiseSeedOf,
} from '../../src/themes/aurora/aurora-bakes.js';
import { bakeAuroraNoise } from '../../src/themes/aurora/aurora-noise.js';
import { QUALITY_PRESETS } from '../../src/themes/aurora/aurora-quality.js';
import { bakeShoreIce, rangeGridPositions } from '../../src/themes/aurora/aurora-terrain.js';
import { AuroraWorld } from '../../src/themes/aurora/aurora-world.js';

/**
 * Aurora baked its noise (~28 ms, first visit), the range's grid (~25 ms) and the shore ice (~7 ms,
 * every visit) on the main thread. They are kept for the session and a first visit bakes them in a
 * module Worker. The jobs must be exactly the bakes the world builds from, or the build bakes them
 * again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/aurora/${name}`, import.meta.url), 'utf8');
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

describe('Aurora keeps its land for the session and bakes a first visit in a worker', () => {
    it('names the bakes the world builds from, served by its worker from three-free modules', () => {
        const { terrainColumns, terrainRows } = QUALITY_PRESETS.High;
        expect(auroraBakeJobs('High')).toEqual([
            { kind: 'noise', args: [NOISE_SIZE, noiseSeedOf(AURORA_SEED)] },
            { kind: 'range', args: [terrainColumns, terrainRows, landSeedOf(AURORA_SEED)] },
            { kind: 'ice', args: [landSeedOf(AURORA_SEED)] },
        ]);
        expect(source('aurora-terrain.js')).not.toMatch(/from 'three/);
        expect(source('aurora-noise.js')).not.toMatch(/from 'three/);
        expect(source('aurora-bake.worker.js')).toMatch(/noise: bakeAuroraNoise, range: rangeGridPositions, ice: bakeShoreIce/);
        expect(source('aurora-theme.js')).toContain('const baking = auroraBakes(this.quality);');
        expect(source('aurora-theme.js')).toContain('await baking;');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(auroraBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted, and the world builds from it without baking again', () => {
        const jobs = auroraBakeJobs('Low');
        jobs.forEach((job) => expect(hasAuroraBake(job)).toBe(false));
        // Malformed posts are refused.
        jobs.forEach((job) => keepAuroraBake(job, [1, 2, 3]));
        keepAuroraBake(jobs[1], new Float32Array(3));
        jobs.forEach((job) => expect(hasAuroraBake(job)).toBe(false));
        const [noise, range, ice] = jobs;
        const posted = {
            noise: bakeAuroraNoise(...noise.args),
            range: rangeGridPositions(...range.args),
            ice: bakeShoreIce(...ice.args),
        };
        keepAuroraBake(noise, posted.noise);
        keepAuroraBake(range, posted.range);
        keepAuroraBake(ice, posted.ice);
        jobs.forEach((job) => expect(hasAuroraBake(job)).toBe(true));

        const camera = () => new THREE.PerspectiveCamera(50, 1.6, 0.1, 9000);
        const world = new AuroraWorld({ scene: new THREE.Scene(), camera: camera(), quality: 'Low' });
        const { landscape } = world;
        expect(landscape.noiseTexture.image.data).toBe(posted.noise);
        expect(landscape.range.geometry.getAttribute('position').array).toBe(posted.range);
        expect(landscape.iceTexture.image.data).toBe(posted.ice);
        // A second visit: the same range mesh arrays and skyline, in a geometry of its own.
        const again = new AuroraWorld({ scene: new THREE.Scene(), camera: camera(), quality: 'Low' });
        expect(again.landscape.range.geometry).not.toBe(landscape.range.geometry);
        expect(again.landscape.range.geometry.getAttribute('normal').array)
            .toBe(landscape.range.geometry.getAttribute('normal').array);
        expect(again.landscape.ridgeProfile).toBe(landscape.ridgeProfile);
        world.dispose?.();
        again.dispose?.();
    }, 60_000);

    it('bakes the same bytes every time: the worker\'s bake is the page\'s', () => {
        const [noise, range, ice] = auroraBakeJobs('High');
        expect(Buffer.compare(bytes(bakeAuroraNoise(...noise.args)), bytes(bakeAuroraNoise(...noise.args)))).toBe(0);
        expect(Buffer.compare(bytes(rangeGridPositions(...range.args)), bytes(rangeGridPositions(...range.args)))).toBe(0);
        expect(Buffer.compare(bytes(bakeShoreIce(...ice.args)), bytes(bakeShoreIce(...ice.args)))).toBe(0);
    }, 120_000);
});
