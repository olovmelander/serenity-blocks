import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bakePlates } from '../../src/themes/void-ember/void-ember-core.js';
import { VOID_EMBER_BAKE_JOBS, voidEmberBakes } from '../../src/themes/void-ember/void-ember-bakes.js';
import { createPlatesTexture, hasPlatesBake, keepPlatesBake } from '../../src/themes/void-ember/void-ember-tsl.js';

/**
 * Void Ember's crust plates bake in a module Worker on a first visit (174 ms of main thread
 * before). The job must be exactly the bake createPlatesTexture makes, or the build bakes it again
 * on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/void-ember/${name}`, import.meta.url), 'utf8');

describe('Void Ember bakes its plates ahead of the build', () => {
    it('names the bake the texture builds from, served by its worker from a three-free module', () => {
        expect(source('void-ember-tsl.js')).toContain('platesBake = bakePlates();');
        expect(VOID_EMBER_BAKE_JOBS).toEqual([{ kind: 'plates', args: [] }]);
        expect(source('void-ember-core.js')).not.toMatch(/from 'three/);
        expect(source('void-ember-bake.worker.js')).toMatch(/\bplates: bakePlates\b/);
        expect(source('void-ember-theme.js')).toContain('const baking = voidEmberBakes();');
    });

    it('resolves at once without a Worker, leaving the texture to bake as before', async () => {
        await expect(voidEmberBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted, and the texture draws it without baking again', () => {
        expect(hasPlatesBake()).toBe(false);
        keepPlatesBake({ data: null, width: 0, height: 0 });
        expect(hasPlatesBake()).toBe(false);
        const posted = bakePlates();
        keepPlatesBake(posted);
        expect(hasPlatesBake()).toBe(true);
        const texture = createPlatesTexture();
        expect(texture.image.data).toBe(posted.data);
        // The same seed bakes the same bytes: the worker's plates are the page's.
        const again = bakePlates();
        expect(Buffer.compare(Buffer.from(again.data), Buffer.from(posted.data))).toBe(0);
        texture.dispose();
    });
});
