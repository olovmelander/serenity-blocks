import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NOISE_SIZE, bakeNoiseData } from '../../src/themes/galaxy/galaxy-bake-data.js';
import {
    NOISE_SEED, galaxyBakeJobs, galaxyBakes, hasGalaxyBake, keepGalaxyBake, sessionPlan,
} from '../../src/themes/galaxy/galaxy-bakes.js';
import { fallbackLayout } from '../../src/themes/galaxy/galaxy-composition.js';
import { REST_RIG, GalaxyWorld } from '../../src/themes/galaxy/galaxy-world.js';
import { tierFor } from '../../src/themes/galaxy/galaxy-quality.js';

/**
 * Galaxy built its plan (~14 ms) and baked its noise and mips (~20 ms) on every start. They are
 * kept for the session (every world reads the same plan, so nothing may write to it), and a first
 * visit bakes the noise and mips in a module Worker.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/galaxy/${name}`, import.meta.url), 'utf8');

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
    const world = new GalaxyWorld({ scene, quality, capture: true }).build();
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
        if (i === 260) world.onSpin();
        if (i === 300) world.onBackToBack({ x: 0.5, y: 0.5 });
        if (i % 90 === 40) world.onCombo(2 + (i % 5));
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
    return world;
}

describe('Galaxy keeps its plan and noise for the session', () => {
    it('names the bake the world builds from, served by its worker from a three-free module', () => {
        expect(galaxyBakeJobs()).toEqual([{ kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] }]);
        expect(source('galaxy-bake-data.js')).not.toMatch(/from 'three/);
        expect(source('galaxy-bake.worker.js')).toMatch(/\bnoise: bakeNoiseData\b/);
        expect(source('galaxy-theme.js')).toContain('const baking = galaxyBakes();');
        expect(source('galaxy-world.js')).toContain('this.plan = sessionPlan(seed, { stars: this.tier.stars });');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(galaxyBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps the worker\'s noise; worlds share one plan that nothing writes to', () => {
        const [job] = galaxyBakeJobs();
        expect(hasGalaxyBake(job)).toBe(false);
        keepGalaxyBake(job, { field: [], mips: [] });
        expect(hasGalaxyBake(job)).toBe(false);
        const posted = bakeNoiseData(...job.args);
        keepGalaxyBake(job, posted);
        expect(hasGalaxyBake(job)).toBe(true);

        const plan = sessionPlan(undefined, { stars: tierFor('Low').stars });
        const before = freezeAndPrint(plan).digest('hex');
        // A frozen plan throws on any write (modules are strict): two whole worlds over it.
        const a = makeWorld('Low');
        const b = makeWorld('Low');
        expect(a.plan).toBe(plan);
        expect(b.plan).toBe(plan);
        expect(a.textures[0].mipmaps[0].data).toBe(posted.mips[0].data);
        expect(printOf(plan)).toBe(before);
        a.dispose?.();
        b.dispose?.();
    }, 120_000);
});
