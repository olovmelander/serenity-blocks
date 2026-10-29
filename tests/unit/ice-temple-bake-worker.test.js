import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    NOISE_SEED, NOISE_SIZE, bakeArchitectureData, bakeNoiseMips,
} from '../../src/themes/ice-temple/ice-temple-bake-data.js';
import {
    hasIceTempleBake, iceTempleBakeJobs, iceTempleBakes, keepIceTempleBake,
} from '../../src/themes/ice-temple/ice-temple-bakes.js';
import { IceTempleWorld } from '../../src/themes/ice-temple/ice-temple-world.js';
import { toHalfFloat } from '../../src/themes/shared/half-float.js';

/**
 * Ice Temple's noise texture and architecture bake in a module Worker on a first visit (~45 +
 * 30-50 ms of main thread in the world's build before). The jobs must be exactly the bakes the world
 * builds from, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/ice-temple/${name}`, import.meta.url), 'utf8');

describe('Ice Temple bakes its noise and ice ahead of the build', () => {
    it('names the bakes the world builds from, served by its worker from a three-free module', () => {
        expect(iceTempleBakeJobs()).toEqual([
            { kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] },
            { kind: 'architecture', args: [] },
        ]);
        expect(source('ice-temple-bake-data.js')).not.toMatch(/from 'three/);
        expect(source('ice-temple-bake.worker.js')).toMatch(/noise: bakeNoiseMips, architecture: bakeArchitectureData/);
        expect(source('ice-temple-theme.js')).toContain('const baking = iceTempleBakes();');
        expect(source('ice-temple-theme.js')).toContain('await baking;');
        // The world builds the default plan under the key the worker's job is kept under.
        expect(source('ice-temple-world.js')).toContain("this.planSeed = seed ?? 'default';");
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(iceTempleBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted, and the world builds from it without baking again', () => {
        const [noiseJob, iceJob] = iceTempleBakeJobs();
        expect(hasIceTempleBake(noiseJob)).toBe(false);
        expect(hasIceTempleBake(iceJob)).toBe(false);
        // Malformed posts are refused.
        keepIceTempleBake(noiseJob, [{ data: new Float32Array(4) }]);
        keepIceTempleBake(iceJob, { position: [] });
        expect(hasIceTempleBake(noiseJob)).toBe(false);
        expect(hasIceTempleBake(iceJob)).toBe(false);

        const mips = bakeNoiseMips(...noiseJob.args);
        const ice = bakeArchitectureData(...iceJob.args);
        keepIceTempleBake(noiseJob, mips);
        keepIceTempleBake(iceJob, ice);
        expect(hasIceTempleBake(noiseJob)).toBe(true);
        expect(hasIceTempleBake(iceJob)).toBe(true);

        const world = new IceTempleWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true }).build();
        expect(world.noise.mipmaps.map((level) => level.data)).toEqual(mips.map((level) => level.data));
        expect(world.noise.mipmaps[0].data).toBe(mips[0].data);
        const { geometry } = world.parts.architecture;
        expect(geometry.getAttribute('position').array).toBe(ice.position);
        expect(geometry.getAttribute('aSt').array).toBe(ice.st);
        world.dispose();
    }, 60_000);

    it('bakes the same bytes every time: the worker\'s bake is the page\'s', () => {
        const a = bakeNoiseMips();
        const b = bakeNoiseMips();
        expect(a.length).toBe(Math.log2(NOISE_SIZE) + 1);
        a.forEach((level, i) => expect(Buffer.compare(Buffer.from(level.data.buffer), Buffer.from(b[i].data.buffer))).toBe(0));
        const x = bakeArchitectureData();
        const y = bakeArchitectureData();
        for (const key of ['position', 'normal', 'smooth', 'info', 'st']) {
            expect(Buffer.compare(Buffer.from(x[key].buffer), Buffer.from(y[key].buffer)), key).toBe(0);
        }
        expect(x.triangles).toBe(y.triangles);
    }, 60_000);

    it('encodes half floats bit for bit as three does', () => {
        const values = [0, 1, -1, 0.5, 1 / 3, 1e-8, 6.1e-5, 65504, 70000, -70000, Math.PI, 0.999, 2 ** -14, 2 ** -24];
        for (let i = 0; i < 2000; i += 1) values.push(Math.sin(i * 12.9898) * 10 ** ((i % 9) - 4));
        for (const v of values) expect(toHalfFloat(v), String(v)).toBe(THREE.DataUtils.toHalfFloat(v));
    });
});
