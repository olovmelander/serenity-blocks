import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NOISE_SIZE, bakeNoiseData } from '../../src/themes/halcyon-apex/halcyon-apex-bake-data.js';
import {
    NOISE_SEED, halcyonApexBakeJobs, halcyonApexBakes, hasHalcyonApexBake, keepHalcyonApexBake, sessionPlan,
} from '../../src/themes/halcyon-apex/halcyon-apex-bakes.js';
import { fallbackLayout } from '../../src/themes/halcyon-apex/halcyon-apex-composition.js';
import { REST_RIG, HalcyonApexWorld } from '../../src/themes/halcyon-apex/halcyon-apex-world.js';

/**
 * Halcyon Apex built its plan on every start (~19 ms) and baked its noise and mips on a first visit
 * (~26 ms). The plan is kept for the session (every world reads the same one, so nothing may write
 * to it), and a first visit bakes the noise and mips in a module Worker.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/halcyon-apex/${name}`, import.meta.url), 'utf8');

/** Freeze every plain object and array in `value`; return the typed arrays' fingerprint. */
function freezeAndPrint(value, hash = createHash('sha1'), seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return hash;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
        hash.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        return hash;
    }
    Object.values(value).forEach((v) => freezeAndPrint(v, hash, seen));
    Object.freeze(value);
    return hash;
}
const printOf = (value) => {
    const hash = createHash('sha1');
    const walk = (v, seen = new Set()) => {
        if (!v || typeof v !== 'object' || seen.has(v)) return;
        seen.add(v);
        if (ArrayBuffer.isView(v)) hash.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
        else Object.values(v).forEach((w) => walk(w, seen));
    };
    walk(value);
    return hash.digest('hex');
};

function makeWorld(quality = 'Low') {
    const width = 1600;
    const height = 900;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new HalcyonApexWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    world.setLayout(fallbackLayout(width, height), width / height);
    world.seek(10);
    // Frames with play in them: locks, hard drops, clears up to a crown, a spin and a chain.
    for (let i = 0; i <= 480; i++) {
        const sim = { time: 10 + i / 60, delta: 1 / 60 };
        if (i % 30 === 5) world.onLock({ u: (i % 7) / 7, hardDrop: i % 60 === 5, color: '#ffa8d0' });
        if (i % 60 === 20) world.onClear({ lines: 1 + ((i / 60) % 4) });
        if (i === 200) world.onCrown();
        if (i === 260) world.onSpin({});
        if (i % 90 === 40) world.onCombo(2 + (i % 5));
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
    return world;
}

describe('Halcyon Apex keeps its plan and noise for the session', () => {
    it('names the bake the world builds from, served by its worker from a three-free module', () => {
        expect(halcyonApexBakeJobs()).toEqual([{ kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] }]);
        expect(source('halcyon-apex-bake-data.js')).not.toMatch(/from 'three/);
        expect(source('halcyon-apex-bake.worker.js')).toMatch(/\bnoise: bakeNoiseData\b/);
        expect(source('halcyon-apex-theme.js')).toContain('const baking = halcyonApexBakes();');
        expect(source('halcyon-apex-world.js')).toContain('this.plan = yield* sessionPlanSteps(this.planSeed);');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(halcyonApexBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps the worker\'s noise; worlds share one plan that nothing writes to', () => {
        const [job] = halcyonApexBakeJobs();
        expect(hasHalcyonApexBake(job)).toBe(false);
        keepHalcyonApexBake(job, { field: [], mips: [] });
        expect(hasHalcyonApexBake(job)).toBe(false);
        const posted = bakeNoiseData(...job.args);
        keepHalcyonApexBake(job, posted);
        expect(hasHalcyonApexBake(job)).toBe(true);

        const plan = sessionPlan();
        const before = freezeAndPrint(plan).digest('hex');
        // A frozen plan throws on any write (modules are strict): two whole worlds over it.
        const a = makeWorld('Low');
        const b = makeWorld('High');
        expect(a.plan).toBe(plan);
        expect(b.plan).toBe(plan);
        expect(a.noiseField).toBe(posted.field);
        expect(printOf(plan)).toBe(before);
        a.dispose?.();
        b.dispose?.();
    }, 120_000);
});
