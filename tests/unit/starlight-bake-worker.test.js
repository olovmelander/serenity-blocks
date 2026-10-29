import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeNoise, bakeSkyData, generateCatalog } from '../../src/themes/starlight/starlight-core.js';
import {
    hasStarlightBakes, keepStarlightBakes, starlightBakeJobs, starlightBakes,
} from '../../src/themes/starlight/starlight-bakes.js';
import { tierFor } from '../../src/themes/starlight/starlight-quality.js';
import { StarlightWorld } from '../../src/themes/starlight/starlight-world.js';

/**
 * Starlight's noise and star catalogue bake in a module Worker on a first visit (85-100 ms of main
 * thread before). The job must be exactly the bake the world builds from, or the build bakes it
 * again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/starlight/${name}`, import.meta.url), 'utf8');

describe('Starlight bakes its sky ahead of the build', () => {
    it('names the bake the world builds from, served by its worker from a three-free module', () => {
        expect(starlightBakeJobs('High')).toEqual([{ kind: 'sky', args: [tierFor('High').stars] }]);
        expect(starlightBakeJobs('Low')).toEqual([{ kind: 'sky', args: [tierFor('Low').stars] }]);
        expect(source('starlight-core.js')).not.toMatch(/from 'three/);
        expect(source('starlight-bake.worker.js')).toMatch(/\bsky: bakeSkyData\b/);
        expect(source('starlight-theme.js')).toContain('const baking = starlightBakes(this.quality);');
        // The world's own bake is the same one: the noise's seed and the catalogue over it.
        expect(source('starlight-bakes.js')).toContain('bakes.noise ??= bakeNoise(NOISE_SEED);');
        expect(source('starlight-bakes.js')).toContain('generateCatalog(stars, bakes.noise)');
        expect(source('starlight-world.js')).toContain('sessionBakes(tier.stars)');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(starlightBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted, and the world builds from it without baking again', () => {
        const { stars } = tierFor('Low');
        expect(hasStarlightBakes(stars)).toBe(false);
        keepStarlightBakes(stars, { noise: null, catalog: null });
        expect(hasStarlightBakes(stars)).toBe(false);
        const posted = bakeSkyData(stars);
        keepStarlightBakes(stars, posted);
        expect(hasStarlightBakes(stars)).toBe(true);
        const world = new StarlightWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true }).build();
        const { noiseData, catalog: built } = world;
        expect(noiseData).toBe(posted.noise);
        expect(built).toBe(posted.catalog);
        // The same seeds bake the same bytes: the worker's sky is the page's.
        const noise = bakeNoise(1610);
        expect(Buffer.compare(Buffer.from(noise), Buffer.from(posted.noise))).toBe(0);
        const catalog = generateCatalog(stars, noise);
        expect(Buffer.compare(Buffer.from(catalog.polar.buffer), Buffer.from(posted.catalog.polar.buffer))).toBe(0);
        expect(Buffer.compare(Buffer.from(catalog.look.buffer), Buffer.from(posted.catalog.look.buffer))).toBe(0);
        world.dispose();
    });
});
