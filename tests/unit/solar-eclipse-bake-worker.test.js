import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeEclipseData, bakeNoise, bakeRanges } from '../../src/themes/solar-eclipse/solar-eclipse-core.js';
import {
    SOLAR_ECLIPSE_BAKE_JOBS, hasSolarEclipseBakes, keepSolarEclipseBakes, solarEclipseBakes,
} from '../../src/themes/solar-eclipse/solar-eclipse-bakes.js';
import { SolarEclipseWorld } from '../../src/themes/solar-eclipse/solar-eclipse-world.js';

/**
 * Solar Eclipse's noise and ranges were baked on every start (~35 ms of main thread). They are kept
 * for the session now, and a first visit bakes them in a module Worker. The job must be exactly the
 * bake the world builds from, or the build bakes it again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/solar-eclipse/${name}`, import.meta.url), 'utf8');

describe('Solar Eclipse bakes its sky once a session, ahead of the build', () => {
    it('names the bake the world builds from, served by its worker from a three-free module', () => {
        expect(SOLAR_ECLIPSE_BAKE_JOBS).toEqual([{ kind: 'sky', args: [] }]);
        expect(source('solar-eclipse-core.js')).not.toMatch(/from 'three/);
        expect(source('solar-eclipse-bake.worker.js')).toMatch(/\bsky: bakeEclipseData\b/);
        expect(source('solar-eclipse-theme.js')).toContain('const baking = solarEclipseBakes();');
        expect(source('solar-eclipse-bakes.js')).toContain('bakes.noise ??= bakeNoise(NOISE_SEED);');
        expect(source('solar-eclipse-bakes.js')).toContain('bakes.ranges ??= bakeRanges();');
        expect(source('solar-eclipse-world.js')).toContain('const baked = sessionEclipseBakes();');
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(solarEclipseBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keeps what the worker posted; every world of the session builds from it', () => {
        expect(hasSolarEclipseBakes()).toBe(false);
        keepSolarEclipseBakes({ noise: null, ranges: null });
        expect(hasSolarEclipseBakes()).toBe(false);
        const posted = bakeEclipseData();
        keepSolarEclipseBakes(posted);
        expect(hasSolarEclipseBakes()).toBe(true);
        const make = () => new SolarEclipseWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true });
        const worlds = [make().build(), make().build()];
        for (const world of worlds) {
            expect(world.noise.image.data).toBe(posted.noise);
            expect(world.ranges).toBe(posted.ranges);
        }
        // The same seeds bake the same bytes: the worker's sky is the page's.
        expect(Buffer.compare(Buffer.from(bakeNoise(2017)), Buffer.from(posted.noise))).toBe(0);
        const ranges = bakeRanges();
        ranges.crests.forEach((crest, i) => {
            expect(Buffer.compare(Buffer.from(crest.buffer), Buffer.from(posted.ranges.crests[i].buffer))).toBe(0);
        });
        worlds.forEach((world) => world.dispose());
    });
});
