import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeGeodeData, planOver } from '../../src/themes/geode/geode-bake-data.js';
import {
    geodeBakeJobs, geodeBakes, hasGeodeBakes, keepGeodeBakes, planOptionsFor,
} from '../../src/themes/geode/geode-bakes.js';
import { tierFor } from '../../src/themes/geode/geode-quality.js';
import { GeodeWorld } from '../../src/themes/geode/geode-world.js';

/**
 * Geode baked its noise, mip chain, plan and shell on every start (~55 ms of main thread). They are
 * kept for the session, and a first visit bakes the noise, mips and shell in a module Worker. The
 * job must be exactly the bake the world builds from, or the build bakes it again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/geode/${name}`, import.meta.url), 'utf8');
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

describe('Geode keeps its bakes for the session and bakes a first visit in a worker', () => {
    it('names the bake the world builds from, served by its worker from a three-free module', () => {
        expect(geodeBakeJobs('High')).toEqual([{ kind: 'geode', args: [planOptionsFor(tierFor('High'))] }]);
        expect(source('geode-bake-data.js')).not.toMatch(/from 'three/);
        expect(source('geode-bake.worker.js')).toMatch(/\bgeode: bakeGeodeData\b/);
        expect(source('geode-theme.js')).toContain('const baking = geodeBakes(this.quality);');
        expect(source('geode-theme.js')).toContain('await baking;');
        expect(source('geode-world.js')).toContain('sessionPlan(this.noiseField, planOptionsFor(this.tier, seed))');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(geodeBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted; the world builds from it, and a revisit bakes nothing', () => {
        const [job] = geodeBakeJobs('Low');
        expect(hasGeodeBakes(job)).toBe(false);
        keepGeodeBakes(job, { field: [], mips: [], shell: {} });
        expect(hasGeodeBakes(job)).toBe(false);
        const posted = bakeGeodeData(...job.args);
        keepGeodeBakes(job, posted);
        expect(hasGeodeBakes(job)).toBe(true);

        const first = new GeodeWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true }).build();
        expect(first.noiseField).toBe(posted.field);
        expect(first.textures[0].mipmaps[0].data).toBe(posted.mips[0].data);
        const shell = first.parts.shell.geometry ?? first.parts.shell.mesh.geometry;
        expect(shell.getAttribute('position').array).toBe(posted.shell.positions);
        expect(shell.index.array).toBe(posted.shell.index);

        // A second visit: the same field, plan and shell arrays, in objects of its own.
        const second = new GeodeWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true }).build();
        expect(second.plan).toBe(first.plan);
        const shell2 = second.parts.shell.geometry ?? second.parts.shell.mesh.geometry;
        expect(shell2).not.toBe(shell);
        expect(shell2.getAttribute('position').array).toBe(posted.shell.positions);
        first.dispose();
        second.dispose();
    }, 60_000);

    it('bakes the same bytes every time: the worker\'s bake is the page\'s', () => {
        const options = planOptionsFor(tierFor('High'));
        const a = bakeGeodeData(options);
        const b = bakeGeodeData(options);
        expect(Buffer.compare(bytes(a.field), bytes(b.field))).toBe(0);
        a.mips.forEach((level, i) => expect(Buffer.compare(bytes(level.data), bytes(b.mips[i].data))).toBe(0));
        for (const key of ['positions', 'normals', 'coords', 'index']) {
            expect(Buffer.compare(bytes(a.shell[key]), bytes(b.shell[key])), key).toBe(0);
        }
        // The plan over the posted field is the plan over a fresh one.
        const strip = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : (ArrayBuffer.isView(v) ? Array.from(v) : v)));
        expect(strip(planOver(a.field, options))).toBe(strip(planOver(b.field, options)));
    }, 120_000);
});
