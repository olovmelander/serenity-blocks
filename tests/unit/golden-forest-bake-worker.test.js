import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import {
    GOLDEN_FOREST_BAKE_JOBS, goldenForestBakeKey, goldenForestBakes,
} from '../../src/themes/golden-forest/golden-forest-bakes.js';
import { bakeLakeMap } from '../../src/themes/golden-forest/golden-forest-shape.js';

/**
 * Golden Forest's lake map bakes in a module Worker on a first visit (0.12 s of main thread,
 * play-feel probe 2026-10-16). The job must name exactly the bake the terrain asks for, under the
 * key it keeps (the bytes are identical to the terrain's own bake before the move).
 */
const source = (name) => readFileSync(new URL(`../../src/themes/golden-forest/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Golden Forest bakes its lake map ahead of the build', () => {
    it('names the bake the terrain builds from, under the key it keeps', () => {
        for (const job of GOLDEN_FOREST_BAKE_JOBS) expect(isBaked(goldenForestBakeKey(job))).toBe(false);
        const terrain = source('golden-forest-terrain.js');
        expect(terrain).toContain('new THREE.DataTexture(bakeLakeMap(), LAKE_MAP_WIDTH, LAKE_MAP_HEIGHT');
        bakeLakeMap();
        for (const job of GOLDEN_FOREST_BAKE_JOBS) expect(isBaked(goldenForestBakeKey(job))).toBe(true);
    });

    it('keeps the land in a module that imports no three, served by its worker', async () => {
        expect(source('golden-forest-shape.js')).not.toMatch(/from 'three/);
        expect(source('golden-forest-bake.worker.js')).toMatch(/\blakeMap: bakeLakeMap\b/);
        // The distance is the nearest shore's, every height finite.
        const shape = await import('../../src/themes/golden-forest/golden-forest-shape.js');
        for (let x = -60; x <= 60; x += 7.3) {
            for (let z = -200; z <= 40; z += 9.1) {
                const s = shape.goldenForestShores(x, z);
                expect(Number.isFinite(shape.goldenForestGroundHeight(x, z))).toBe(true);
                expect(shape.goldenForestShoreDistance(x, z)).toBe(Math.max(...Object.values(s)));
            }
        }
    });

    it('starts the bake before the renderer and awaits it with the asset pack', () => {
        const theme = source('golden-forest-theme.js');
        const start = theme.indexOf('const baking = goldenForestBakes();');
        const renderer = theme.indexOf('const renderer = await this.createRenderer(ownerGeneration);');
        const assets = theme.indexOf('assets = await this.loadAssets(current);');
        const awaited = theme.indexOf('await baking;');
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(renderer);
        expect(assets).toBeLessThan(awaited);
        expect(awaited).toBeLessThan(theme.indexOf('if (await this.buildScene(current) === false)'));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(goldenForestBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
