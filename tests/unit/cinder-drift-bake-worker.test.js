import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeNoise, bakePlates } from '../../src/themes/cinder-drift/cinder-drift-tsl.js';
import {
    CINDER_DRIFT_BAKE_JOBS, cinderDriftBakeKey, cinderDriftBakes, takeBakedPlan,
} from '../../src/themes/cinder-drift/cinder-drift-bakes.js';
import { PLAN_SEED, bakePlanData, buildPlan } from '../../src/themes/cinder-drift/cinder-drift-layout.js';
import { tierFor } from '../../src/themes/cinder-drift/cinder-drift-quality.js';
import { CinderDriftWorld } from '../../src/themes/cinder-drift/cinder-drift-world.js';

/**
 * Cinder Drift's noise and plates bake in a module Worker on a first visit (about 0.14 s of main
 * thread, play-feel probe 2026-10-16; its stepped build: build-steps.test.js). The jobs must name
 * exactly the bakes the world's build asks for, under the keys those bakes keep.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/cinder-drift/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Cinder Drift bakes its fields ahead of the build', () => {
    it('names the two bakes the world builds from, under the keys they keep', () => {
        for (const job of CINDER_DRIFT_BAKE_JOBS) expect(isBaked(cinderDriftBakeKey(job))).toBe(false);
        // What the world calls (cinder-drift-world.js: both at their defaults).
        expect(source('cinder-drift-world.js')).toContain('createFieldTexture(bakeNoise(), NOISE_SIZE');
        expect(source('cinder-drift-world.js')).toContain('createFieldTexture(bakePlates(), PLATE_SIZE');
        bakeNoise();
        bakePlates();
        for (const job of CINDER_DRIFT_BAKE_JOBS) expect(isBaked(cinderDriftBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('cinder-drift-bake.js')).not.toMatch(/from 'three/);
        const worker = source('cinder-drift-bake.worker.js');
        for (const { kind } of CINDER_DRIFT_BAKE_JOBS) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(cinderDriftBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
        expect(takeBakedPlan(PLAN_SEED, tierFor('High').detail)).toBeNull();
    });
});

/** A Worker that bakes on this thread and posts a structured clone, as a real one does. */
class InlineWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.bakes = { noise: bakeNoise, plates: bakePlates, plan: bakePlanData };
    }

    postMessage({ id, kind, args }) {
        const value = structuredClone(this.bakes[kind](...args));
        queueMicrotask(() => this.onmessage?.({ data: { id, ok: true, value } }));
    }

    terminate() {} // eslint-disable-line class-methods-use-this
}

/** Every plain field of a plan, and its readers sampled over the chamber. */
function planSignature(plan) {
    const data = JSON.stringify(plan, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x));
    const samples = [];
    for (let x = -140; x <= 140; x += 9.7) {
        for (let z = -230; z <= 20; z += 8.3) {
            samples.push(plan.heightAt(x, z), plan.ceilingAt(x, z), plan.depthAt(x, z), plan.wallDepth(x, z));
        }
    }
    return { data, samples };
}

describe('Cinder Drift bakes its plan ahead of the world', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        ['Minimal', 'High'].forEach((q) => takeBakedPlan(PLAN_SEED, tierFor(q).detail));
    });

    it.each(['Minimal', 'High'])('hands a worker plan to one %s world, as its own would be', async (quality) => {
        vi.stubGlobal('Worker', InlineWorker);
        await expect(cinderDriftBakes(quality)).resolves.toEqual({ viaWorker: true, baked: 3, cached: 0 });
        const world = new CinderDriftWorld({ scene: new THREE.Scene(), quality, capture: true });
        const expected = buildPlan({ seed: PLAN_SEED, detail: tierFor(quality).detail });
        expect(planSignature(world.plan)).toEqual(planSignature(expected));
        expect(world.plan.islands).toBe(expected.islands);
        // Taken once: the next world plans for itself.
        expect(takeBakedPlan(PLAN_SEED, tierFor(quality).detail)).toBeNull();
        world.dispose();
    });

    it('serves the plan from the worker, whose layout imports no three', () => {
        expect(source('cinder-drift-bake.worker.js')).toMatch(/\bplan: bakePlanData\b/);
        expect(source('cinder-drift-layout.js')).not.toMatch(/from 'three/);
        expect(source('cinder-drift-theme.js')).toContain('const baking = cinderDriftBakes(this.quality);');
    });
});
