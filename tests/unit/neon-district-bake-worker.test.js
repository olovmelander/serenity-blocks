import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { createNoiseTexture } from '../../src/themes/neon-district/neon-district-tsl.js';
import { createGlyphTexture } from '../../src/themes/neon-district/neon-district-signs.js';
import {
    NEON_DISTRICT_BAKE_JOBS, neonDistrictBakeKey, neonDistrictBakes,
} from '../../src/themes/neon-district/neon-district-bakes.js';

/**
 * Neon District's noise and glyph atlas bake in a module Worker on a first visit (0.11 s of main
 * thread, play-feel probe 2026-10-16). The jobs must name exactly the bakes the world's build asks
 * for, under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/neon-district/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Neon District bakes its noise and its glyphs ahead of the build', () => {
    it('names the two bakes the world builds from, under the keys they keep', () => {
        for (const job of NEON_DISTRICT_BAKE_JOBS) expect(isBaked(neonDistrictBakeKey(job)), job.kind).toBe(false);
        // What the world calls (neon-district-world.js: both at their defaults).
        const world = source('neon-district-world.js');
        expect(world).toContain('const noise = createNoiseTexture();');
        expect(world).toContain('const glyphs = createGlyphTexture();');
        const noise = createNoiseTexture();
        const glyphs = createGlyphTexture();
        for (const job of NEON_DISTRICT_BAKE_JOBS) expect(isBaked(neonDistrictBakeKey(job)), job.kind).toBe(true);
        // Every texture gets its own mip list over the kept bytes.
        const again = createNoiseTexture();
        expect(again.mipmaps).not.toBe(noise.mipmaps);
        expect(again.mipmaps[0].data).toBe(noise.mipmaps[0].data);
        [noise, glyphs, again].forEach((t) => t.dispose());
    });

    it('bakes in modules that import no three, served by its worker under the jobs\' kinds', () => {
        for (const name of ['neon-district-bake.js', 'neon-district-glyphs.js']) {
            expect(source(name), name).not.toMatch(/from 'three/);
        }
        const worker = source('neon-district-bake.worker.js');
        for (const { kind } of NEON_DISTRICT_BAKE_JOBS) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('starts the bakes before the renderer and awaits them before the world', () => {
        const theme = source('neon-district-theme.js');
        const start = theme.indexOf('const baking = neonDistrictBakes();');
        const renderer = theme.indexOf('const renderer = await this.createRenderer(ownerGeneration);');
        const awaited = theme.indexOf('await baking;');
        const world = theme.indexOf('this.world = new NeonDistrictWorld({');
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(renderer);
        expect(renderer).toBeLessThan(awaited);
        expect(awaited).toBeLessThan(world);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(neonDistrictBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
