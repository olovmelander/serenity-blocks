import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { NOISE_SIZE, bakeNoise } from '../../src/themes/bioluminescence/bioluminescence-core.js';
import {
    PLAN_SEED, bakePlan, buildPlan,
} from '../../src/themes/bioluminescence/bioluminescence-layout.js';
import { bioluminescenceBakes, takeBakedPlan } from '../../src/themes/bioluminescence/bioluminescence-bakes.js';
import { BioluminescenceWorld } from '../../src/themes/bioluminescence/bioluminescence-world.js';

/**
 * Bioluminescence's noise and plan bake in a module Worker on a first visit (0.14 s of main thread
 * in the world's constructor, play-feel probe 2026-10-16). The plan's readers are closures a worker
 * cannot post: it comes as data, and the one world that takes it makes them. That world must hold
 * the plan its own constructor would have built.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/bioluminescence/${name}`, import.meta.url), 'utf8');

/** A Worker that bakes on this thread and posts a structured clone, as a real one does. */
class InlineWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
    }

    postMessage({ id, kind, args }) {
        expect(kind).toBe('plan');
        const value = structuredClone(bakePlan(...args));
        queueMicrotask(() => this.onmessage?.({ data: { id, ok: true, value } }));
    }

    terminate() {} // eslint-disable-line class-methods-use-this
}

afterEach(() => {
    vi.unstubAllGlobals();
    takeBakedPlan(PLAN_SEED);
});

/** Each point's readings and every plain field, the readers sampled over the terrain. */
function planSignature(plan) {
    const {
        floorAt, shoreAt, vaultAt, ...data
    } = plan;
    const samples = [];
    for (let x = -60; x <= 60; x += 7.3) {
        for (let z = -90; z <= 20; z += 6.1) samples.push(floorAt(x, z), shoreAt(x, z), vaultAt(x, z));
    }
    return { data, samples };
}

describe('Bioluminescence bakes its plan ahead of the world', () => {
    it('hands a worker\'s plan to one world, the plan its constructor would have built', async () => {
        vi.stubGlobal('Worker', InlineWorker);
        await expect(bioluminescenceBakes()).resolves.toEqual({ viaWorker: true, baked: 1, cached: 0 });
        // A second start while it waits: nothing to bake again.
        await expect(bioluminescenceBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 1 });
        const world = new BioluminescenceWorld({ scene: new THREE.Scene(), quality: 'High', capture: true });
        const expected = buildPlan(bakeNoise(), NOISE_SIZE, PLAN_SEED);
        expect(planSignature(world.plan)).toEqual(planSignature(expected));
        expect(Array.from(world.noiseField)).toEqual(Array.from(bakeNoise()));
        // Taken once: the next world bakes for itself.
        expect(takeBakedPlan(PLAN_SEED)).toBeNull();
    });

    it('bakes in modules that import no three, served by its worker', () => {
        for (const name of ['bioluminescence-layout.js', 'bioluminescence-core.js', 'bioluminescence-bakes.js']) {
            expect(source(name), name).not.toMatch(/from 'three/);
        }
        expect(source('bioluminescence-bake.worker.js')).toMatch(/serveBakes\(\{ plan: bakePlan \}\)/);
    });

    it('starts the bake before the renderer and awaits it before the world', () => {
        const theme = source('bioluminescence-theme.js');
        const start = theme.indexOf('const baking = bioluminescenceBakes();');
        const renderer = theme.indexOf('const renderer = await this.createRenderer(ownerGeneration);');
        const awaited = theme.indexOf('await baking;');
        const world = theme.indexOf('const world = new BioluminescenceWorld({');
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(renderer);
        expect(renderer).toBeLessThan(awaited);
        expect(awaited).toBeLessThan(world);
    });

    it('resolves at once without a Worker, leaving the world to bake as before', async () => {
        await expect(bioluminescenceBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
        expect(takeBakedPlan(PLAN_SEED)).toBeNull();
    });
});
