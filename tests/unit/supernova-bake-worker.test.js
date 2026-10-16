import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeNoise3D } from '../../src/themes/supernova/supernova-tsl.js';
import {
    SUPERNOVA_BAKE_JOBS, supernovaBakeKey, supernovaBakes,
} from '../../src/themes/supernova/supernova-bakes.js';

/**
 * Supernova's 3D noise bakes in a module Worker on a first visit (0.13 s of main thread, play-feel
 * probe 2026-10-16). The job must name exactly the bake the world's build asks for, under the key
 * that bake keeps, or the build bakes it again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/supernova/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Supernova bakes its noise ahead of the build', () => {
    it('names the bake the world builds from, under the key it keeps', () => {
        for (const job of SUPERNOVA_BAKE_JOBS) expect(isBaked(supernovaBakeKey(job))).toBe(false);
        // What the world calls (supernova-world.js: its seed defaults to the bake's).
        const world = source('supernova-world.js');
        expect(world).toContain('createNoise3DTexture(bakeNoise3D(this.seed))');
        expect(world).toMatch(/capture = false, seed = 1987,/);
        bakeNoise3D(1987);
        for (const job of SUPERNOVA_BAKE_JOBS) expect(isBaked(supernovaBakeKey(job))).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the job\'s kind', () => {
        expect(source('supernova-bake.js')).not.toMatch(/from 'three/);
        expect(source('supernova-bake.worker.js')).toMatch(/\bnoise3: bakeNoise3D\b/);
    });

    it('starts the bake before the renderer and awaits it before the world', () => {
        const theme = source('supernova-theme.js');
        const start = theme.indexOf('const baking = supernovaBakes();');
        const renderer = theme.indexOf('const renderer = await this.createRenderer(ownerGeneration);');
        const awaited = theme.indexOf('await baking;');
        const world = theme.indexOf('this.world = new SupernovaWorld({');
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(renderer);
        expect(renderer).toBeLessThan(awaited);
        expect(awaited).toBeLessThan(world);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(supernovaBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
