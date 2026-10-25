import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import {
    VERDANT_HILLS_CLOUD_VOLUME_SEED, VERDANT_HILLS_CLOUD_VOLUME_SIZE, bakeVerdantHillsCloudVolume,
    computeVerdantHillsCloudVolume, verdantHillsCloudVolumeKey,
} from '../../src/themes/verdant-hills/verdant-hills-cloud-volume.js';
import {
    verdantHillsBakeJobs, verdantHillsBakeKey, verdantHillsBakes,
} from '../../src/themes/verdant-hills/verdant-hills-bakes.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';

/**
 * The cumulus's 3D noise: what rounds the heaps in every direction (flat noise stood on end made
 * every billow a column, and the clouds read as tents, shark fins and cones). It must tile, use
 * its whole range in every channel, and bake off the page's thread on a first visit.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/verdant-hills/${name}`, import.meta.url), 'utf8');
const SMALL = 24;

afterEach(() => resetBakeCache());

/** Mean step between neighbouring texels along x, inside the volume and across its wrap. */
function steps(data, n, channel) {
    let inside = 0;
    let seam = 0;
    for (let z = 0; z < n; z += 1) {
        for (let y = 0; y < n; y += 1) {
            const row = (z * n + y) * n;
            for (let x = 0; x < n - 1; x += 1) {
                inside += Math.abs(data[(row + x + 1) * 4 + channel] - data[(row + x) * 4 + channel]);
            }
            seam += Math.abs(data[row * 4 + channel] - data[(row + n - 1) * 4 + channel]);
        }
    }
    return { inside: inside / (n * n * (n - 1)), seam: seam / (n * n) };
}

describe('Verdant Hills cumulus volume', () => {
    it('is an RGBA8 block, the same for a seed and another for another seed', () => {
        const volume = computeVerdantHillsCloudVolume(SMALL, 5);
        expect(volume.size).toBe(SMALL);
        expect(volume.data).toBeInstanceOf(Uint8Array);
        expect(volume.data).toHaveLength(SMALL ** 3 * 4);
        expect(Buffer.from(computeVerdantHillsCloudVolume(SMALL, 5).data).equals(Buffer.from(volume.data))).toBe(true);
        expect(Buffer.from(computeVerdantHillsCloudVolume(SMALL, 6).data).equals(Buffer.from(volume.data))).toBe(false);
    });

    it('tiles: the step across its wrap is no larger than a step inside it, in every channel', () => {
        const { data, size } = computeVerdantHillsCloudVolume(32, VERDANT_HILLS_CLOUD_VOLUME_SEED);
        for (let channel = 0; channel < 4; channel += 1) {
            const { inside, seam } = steps(data, size, channel);
            expect(seam, `channel ${channel}`).toBeLessThan(inside * 1.6 + 2);
        }
    });

    it('spreads every channel over its whole range, so a threshold means the same at every seed', () => {
        const { data } = computeVerdantHillsCloudVolume(32, 11);
        for (let channel = 0; channel < 4; channel += 1) {
            let low = 255;
            let high = 0;
            let sum = 0;
            for (let i = channel; i < data.length; i += 4) {
                low = Math.min(low, data[i]);
                high = Math.max(high, data[i]);
                sum += data[i];
            }
            const mean = sum / (data.length / 4);
            expect(low, `channel ${channel}`).toBe(0);
            expect(high, `channel ${channel}`).toBe(255);
            expect(mean, `channel ${channel}`).toBeGreaterThan(70);
            expect(mean, `channel ${channel}`).toBeLessThan(185);
        }
    });

    it('is baked once a session under the key the worker primes', () => {
        const key = verdantHillsCloudVolumeKey(VERDANT_HILLS_CLOUD_VOLUME_SIZE, VERDANT_HILLS_CLOUD_VOLUME_SEED);
        expect(isBaked(key)).toBe(false);
        const first = bakeVerdantHillsCloudVolume();
        expect(isBaked(key)).toBe(true);
        expect(bakeVerdantHillsCloudVolume()).toBe(first);
        expect(first.size).toBe(VERDANT_HILLS_CLOUD_VOLUME_SIZE);
    });
});

describe('Verdant Hills bakes its cumulus volume ahead of the build', () => {
    it('asks for the volume only where the tier marches the clouds', () => {
        for (const [quality, tier] of Object.entries(VERDANT_HILLS_TIERS)) {
            const jobs = verdantHillsBakeJobs(quality);
            expect(jobs, quality).toHaveLength(tier.cloudSteps > 0 ? 1 : 0);
            for (const job of jobs) {
                expect(verdantHillsBakeKey(job)).toBe(
                    verdantHillsCloudVolumeKey(VERDANT_HILLS_CLOUD_VOLUME_SIZE, VERDANT_HILLS_CLOUD_VOLUME_SEED),
                );
            }
        }
        expect(verdantHillsBakeJobs('Minimal')).toEqual([]);
    });

    it('keeps the volume in a module that imports no three, served by its worker', () => {
        expect(source('verdant-hills-cloud-volume.js')).not.toMatch(/from 'three/);
        expect(source('verdant-hills-bake.worker.js')).toMatch(/\bcloudVolume: computeVerdantHillsCloudVolume\b/);
    });

    it('starts the bake before the renderer and awaits it before the world builds', () => {
        const theme = source('verdant-hills-theme.js');
        const start = theme.indexOf('const baking = verdantHillsBakes(this.quality);');
        const renderer = theme.indexOf('const renderer = await this.createRenderer(ownerGeneration);');
        const assets = theme.indexOf('assets = await this.loadAssets(current);');
        const awaited = theme.indexOf('await baking;');
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(renderer);
        expect(assets).toBeLessThan(awaited);
        expect(awaited).toBeLessThan(theme.indexOf('if (await this.buildScene(current) === false)'));
    });

    it('resolves at once without a Worker, leaving the light rig to bake as before', async () => {
        await expect(verdantHillsBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
