import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { toHalfFloat } from '../../src/themes/chiral-gold/chiral-gold-bake.js';
import { createNoiseTexture, createStudioEquirect } from '../../src/themes/chiral-gold/chiral-gold-tsl.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/chiral-gold/chiral-gold-quality.js';
import {
    chiralGoldBakeJobs, chiralGoldBakeKey, chiralGoldBakes,
} from '../../src/themes/chiral-gold/chiral-gold-bakes.js';

/**
 * Chiral Gold's studio and noise bake in a module Worker on a first visit (about 0.1 s of main
 * thread at High, play-feel probe 2026-10-15). The jobs must name exactly the bakes the world's
 * build asks for, under the keys those bakes keep, or the build bakes them again on the page; and
 * the three-free bake must write the same half floats three would.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/chiral-gold/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Chiral Gold bakes its studio and noise ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, exactly the textures the world builds from', (quality) => {
        const jobs = chiralGoldBakeJobs(quality);
        for (const job of jobs) expect(isBaked(chiralGoldBakeKey(job))).toBe(false);
        // What the world calls (chiral-gold-world.js: the noise at its defaults, the studio at the tier's width).
        expect(source('chiral-gold-world.js')).toContain('createNoiseTexture()');
        expect(source('chiral-gold-world.js')).toContain('createStudioEquirect(tier.studio)');
        createNoiseTexture().dispose();
        createStudioEquirect(tierFor(quality).studio).dispose();
        for (const job of jobs) expect(isBaked(chiralGoldBakeKey(job)), job.kind).toBe(true);
    });

    it('writes half floats bit for bit as three does', () => {
        const values = [0, -0, 1, -1, 0.5, 1e-8, 6e-5, 6.1e-5, 0.011, 0.3333, 13, 60000, 65504, 70000, -70000];
        for (let i = 0; i < 2000; i++) values.push((Math.sin(i * 12.9898) * 43758.5453) % 300);
        for (const v of values) {
            expect(toHalfFloat(v), String(v)).toBe(THREE.DataUtils.toHalfFloat(Math.max(-65504, Math.min(65504, v))));
        }
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('chiral-gold-bake.js')).not.toMatch(/from 'three/);
        const worker = source('chiral-gold-bake.worker.js');
        for (const { kind } of chiralGoldBakeJobs('High')) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(chiralGoldBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
