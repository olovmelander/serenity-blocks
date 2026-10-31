/**
 * High Coast builds its forest and its sign's lettering in steps (2026-10-31): the trees' planting
 * (a seeded walk over the baked cover), the four pools and each board's distance field pause by a
 * clock, and the old functions drain the steps. Paused at every chance, they build what one call
 * builds.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { planCoast } from '../../src/themes/high-coast/high-coast-assets.js';
import {
    createForest, createForestSteps, treeSites, treeSitesSteps,
} from '../../src/themes/high-coast/high-coast-forest.js';
import { tierFor } from '../../src/themes/high-coast/high-coast-quality.js';
import { bakeSignField, bakeSignFieldSteps } from '../../src/themes/high-coast/high-coast-sign.js';
import { HighCoastWorld } from '../../src/themes/high-coast/high-coast-world.js';

/** A clock that is always due: the steps yield at every chance they have. */
const always = () => ({ due: () => true, restart() {} });
const drainCounting = (steps) => {
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
        yields += 1;
        next = steps.next();
    }
    return { value: next.value, yields };
};

describe('High Coast first build in steps', () => {
    const fields = planCoast();

    it('plants the same trees, drawing the same numbers, however often it pauses', () => {
        for (const [count, seed] of [[600, undefined], [2500, 0x51]]) {
            const once = treeSites(fields, count, seed);
            const paused = drainCounting(treeSitesSteps(fields, count, seed, always()));
            expect(paused.yields).toBeGreaterThan(count / 32);
            expect(paused.value).toEqual(once);
        }
    });

    it('builds the same four pools of trees in steps as at once', () => {
        const { u } = new HighCoastWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        const pixel = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
        const t = { noise: pixel(), shadow: pixel() };
        const tier = tierFor('Low');
        const once = createForest(u, t, tier, fields);
        const paused = drainCounting(createForestSteps(u, t, tier, fields, always()));
        expect(paused.yields).toBeGreaterThan(4);
        const forest = paused.value;
        expect(forest.sites).toEqual(once.sites);
        expect(forest.meshes.map((m) => m.name)).toEqual(once.meshes.map((m) => m.name));
        forest.meshes.forEach((mesh, i) => {
            const other = once.meshes[i];
            expect(mesh.count, mesh.name).toBe(other.count);
            expect(mesh.instanceMatrix.array, mesh.name).toEqual(other.instanceMatrix.array);
            expect(mesh.geometry.attributes.aTree.array, mesh.name).toEqual(other.geometry.attributes.aTree.array);
            const { position } = other.geometry.attributes;
            expect(mesh.geometry.attributes.position.array, mesh.name).toEqual(position.array);
        });
        once.dispose();
        forest.dispose();
    });

    it('bakes the same lettering, paused between rows', () => {
        const once = bakeSignField('HÖGA KUSTEN', 256, 48);
        const paused = drainCounting(bakeSignFieldSteps('HÖGA KUSTEN', 256, 48, {}, always()));
        expect(paused.yields).toBe(48);
        expect(Buffer.from(paused.value).equals(Buffer.from(once))).toBe(true);
    });
});
