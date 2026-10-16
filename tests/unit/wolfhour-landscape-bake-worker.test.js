import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { createWolfhourLandscape } from '../../src/themes/wolfhour/wolfhour-landscape.js';
import { LANDSCAPE_SEED, vertexNormals } from '../../src/themes/wolfhour/wolfhour-landscape-bake.js';
import {
    wolfhourLandscapeBakes, wolfhourLandscapeJobs, wolfhourLandscapeKey,
} from '../../src/themes/wolfhour/wolfhour-landscape-bakes.js';

/**
 * Wolfhour's landscape (four ranges, the granite grain) bakes in a module Worker on a first visit
 * (0.15-0.2 s of main thread, play-feel probe 2026-10-16). The jobs must name exactly the bakes the
 * landscape asks for, under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/wolfhour/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Wolfhour bakes its landscape ahead of the build', () => {
    it.each(['Minimal', 'Low', 'Medium', 'High'])('names, at %s, the bakes the landscape builds from', (quality) => {
        const jobs = wolfhourLandscapeJobs(quality);
        expect(jobs.map((job) => job.kind)).toEqual(['range', 'range', 'range', 'range', 'granite']);
        for (const job of jobs) expect(isBaked(wolfhourLandscapeKey(job))).toBe(false);
        const land = createWolfhourLandscape({ quality, seed: LANDSCAPE_SEED });
        for (const job of jobs) expect(isBaked(wolfhourLandscapeKey(job)), JSON.stringify(job)).toBe(true);
        land.dispose();
    });

    it('computes three\'s vertex normals bit for bit', () => {
        const rng = (() => {
            let a = 7;
            return () => {
                a = (a * 16807) % 2147483647;
                return a / 2147483647;
            };
        })();
        const positions = Float32Array.from({ length: 300 }, () => (rng() - 0.5) * 900);
        const indices = Uint32Array.from({ length: 450 }, () => Math.floor(rng() * 100));
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        // Repeated corners in a face included (random indices): read-before-write, as three does.
        const three = Array.from(geometry.getAttribute('normal').array);
        expect(Array.from(vertexNormals(positions, indices))).toEqual(three);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('wolfhour-landscape-bake.js')).not.toMatch(/from 'three/);
        const worker = source('wolfhour-landscape-bake.worker.js');
        for (const kind of ['range', 'granite']) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('starts the bakes before the renderer and awaits them before the scene', () => {
        const theme = source('wolfhour-theme.js');
        const start = theme.indexOf('const baking = wolfhourLandscapeBakes(this.activeQualityLevel, LANDSCAPE_SEED);');
        const renderer = theme.indexOf('const rendererReady = await this.initRenderer(container, ownerGeneration);');
        const awaited = theme.indexOf('await baking;');
        const ambient = theme.indexOf('        this.createAmbientScene();');
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(renderer);
        expect(renderer).toBeLessThan(awaited);
        expect(awaited).toBeLessThan(ambient);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(wolfhourLandscapeBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
