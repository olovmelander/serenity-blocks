/**
 * Grainfields — how the stand and the shelterbelts are drawn (docs/GRAINFIELDS_PERF_2026-10.md):
 * the barley in bands by distance, nearest first, each band's stems drawn opaque apart from its ears
 * under multisampling; the trees' limbs left out where they are a fraction of a pixel. No GPU: the
 * meshes and materials are inspected as built.
 */
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    GRAIN_BANDS, STEM_CUT, bandSites, createGrain, grainTemplate,
} from '../../src/themes/grainfields/grainfields-grain.js';
import { BARK_LIMBS_TO, createForest } from '../../src/themes/grainfields/grainfields-forest.js';
import { loadGrainfieldsAssets } from '../../src/themes/grainfields/grainfields-assets.js';
import { grainSites, treeSites } from '../../src/themes/grainfields/grainfields-plan.js';
import { createNoiseTexture, createUniforms } from '../../src/themes/grainfields/grainfields-tsl.js';
import { tierFor } from '../../src/themes/grainfields/grainfields-quality.js';
import { EYE } from '../../src/themes/grainfields/grainfields-core.js';

vi.setConfig({ testTimeout: 60_000 });

const distance = (data, i) => Math.hypot(data[i * 8] - EYE.x, data[i * 8 + 2] - EYE.z);

/** The Medium tier's stand: small enough to build quickly, every band populated. */
function mediumSites() {
    const { grain } = tierFor('Medium');
    return {
        near: grainSites({
            count: grain.near, near: 2.5, far: grain.nearReach, knee: 7, seed: 0x6a7e,
        }),
        far: grainSites({
            count: grain.far, near: grain.nearReach * 0.92, far: grain.farReach, seed: 0x6a7f,
        }),
    };
}

describe('Grainfields stand: bands by distance, nearest first', () => {
    it('lays its bands end to end over every distance, a field at a time', () => {
        ['near', 'far'].forEach((field) => {
            const bands = GRAIN_BANDS.filter((band) => band.field === field);
            expect(bands[0].from).toBe(0);
            expect(bands[bands.length - 1].to).toBe(Infinity);
            for (let k = 1; k < bands.length; k++) expect(bands[k].from).toBe(bands[k - 1].to);
        });
        // Farther bands never draw a plant with more rows than a nearer one.
        const near = GRAIN_BANDS.filter((band) => band.field === 'near');
        for (let k = 1; k < near.length; k++) {
            expect(near[k].stemRows).toBeLessThanOrEqual(near[k - 1].stemRows);
            expect(near[k].earRows).toBeLessThanOrEqual(near[k - 1].earRows);
        }
    });

    it('hands every clump to exactly one band, nearest first, with its record intact', () => {
        const sites = mediumSites();
        let total = 0;
        const seen = new Set();
        GRAIN_BANDS.filter((band) => band.field === 'near').forEach((band) => {
            const { data, count } = bandSites(sites.near, band.from, band.to);
            total += count;
            for (let i = 0; i < count; i++) {
                const r = distance(data, i);
                expect(r).toBeGreaterThanOrEqual(band.from);
                expect(r).toBeLessThan(band.to);
                if (i > 0) expect(r).toBeGreaterThanOrEqual(distance(data, i - 1));
                seen.add(Array.from(data.subarray(i * 8, i * 8 + 8)).join(','));
            }
        });
        expect(total).toBe(sites.near.count);
        // The records are the field's own, moved whole (no clump lost, none twice).
        expect(seen.size).toBe(sites.near.count);
        const original = new Set();
        for (let i = 0; i < sites.near.count; i++) {
            original.add(Array.from(sites.near.data.subarray(i * 8, i * 8 + 8)).join(','));
        }
        seen.forEach((record) => expect(original.has(record)).toBe(true));
    });

    it('splits a template into its stems and its ears without losing a triangle', () => {
        const whole = grainTemplate(6, 4, 4);
        const stems = grainTemplate(6, 4, 4, 'stem');
        const ears = grainTemplate(6, 4, 4, 'ear');
        expect(stems.triangles + ears.triangles).toBe(whole.triangles);
        expect(stems.triangles).toBe(6 * 4 * 2);
        expect(ears.triangles).toBe(6 * 4 * 2);
    });
});

describe('Grainfields stand: the draws', () => {
    let u;
    let t;
    let sites;
    beforeAll(() => {
        u = createUniforms();
        t = { noise: createNoiseTexture() };
        sites = mediumSites();
    });

    it('under multisampling draws each band\'s stems opaque, then its ears with coverage, nearest first', () => {
        const grain = createGrain(u, t, sites, { coverage: true });
        expect(grain.meshes).toHaveLength(GRAIN_BANDS.length * 2);
        expect(grain.counts).toEqual({ near: sites.near.count, far: sites.far.count });
        grain.meshes.forEach((mesh, i) => {
            const stems = i % 2 === 0;
            expect(mesh.material.alphaToCoverage, mesh.name).toBe(!stems);
            expect(mesh.material.transparent, mesh.name).toBe(false);
            if (stems) {
                expect(mesh.material.alphaTest).toBe(0);
                expect(mesh.material.maskNode).toBeNull();
            }
            if (i > 0) expect(mesh.renderOrder).toBeGreaterThan(grain.meshes[i - 1].renderOrder);
            // Both draws of a band share its instances.
            if (!stems) expect(mesh.geometry.attributes.iA.data).toBe(grain.meshes[i - 1].geometry.attributes.iA.data);
        });
        // Every draw stays ahead of the trees and the land (renderOrder 3 and up).
        expect(grain.meshes[grain.meshes.length - 1].renderOrder).toBeLessThan(2);
        grain.dispose();
    });

    it('without multisampling draws one masked draw a band', () => {
        const grain = createGrain(u, t, sites, { coverage: false });
        expect(grain.meshes).toHaveLength(GRAIN_BANDS.length);
        grain.meshes.forEach((mesh) => {
            expect(mesh.material.alphaToCoverage).toBe(false);
            expect(mesh.material.maskNode).not.toBeNull();
        });
        grain.dispose();
    });

    it('cuts an opaque stem to the share of its ribbon the coverage kept', () => {
        expect(STEM_CUT.keep).toBeGreaterThan(0.85);
        expect(STEM_CUT.keep).toBeLessThan(1);
        expect(STEM_CUT.trim).toBeGreaterThan(0);
        expect(STEM_CUT.trim).toBeLessThan(0.38); // never more than the floor's own half-width
    });
});

describe('Grainfields shelterbelts: limbs only where they show', () => {
    let assets;
    beforeAll(async () => {
        const directory = new URL('../../src/themes/grainfields/assets/', import.meta.url);
        const loader = {
            loadAsync: async (url) => {
                const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
                const bytes = readFileSync(new URL(name, directory));
                const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                return new GLTFLoader().parseAsync(buffer, '');
            },
        };
        const textureLoader = { loadAsync: async () => new THREE.DataTexture(new Uint8Array(16), 2, 2) };
        assets = await loadGrainfieldsAssets({ loader, textureLoader });
    });

    it('draws a far tree\'s bark as its stems alone, over the specimen\'s own buffers', () => {
        const u = createUniforms();
        const t = { noise: createNoiseTexture() };
        const forest = createForest(u, t, assets, treeSites(), tierFor('Extreme'), { coverage: true });
        const bark = forest.meshes.filter((mesh) => mesh.name.startsWith('GrainfieldsBark'));
        const stemsOnly = bark.filter((mesh) => mesh.name.endsWith('|stems'));
        const whole = bark.filter((mesh) => !mesh.name.endsWith('|stems'));
        expect(stemsOnly.length).toBeGreaterThan(0);
        expect(whole.length).toBeGreaterThan(0);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        stemsOnly.forEach((mesh) => {
            const name = mesh.name.replace('GrainfieldsBark ', '').split('|')[0];
            const asset = assets.trees[name];
            expect(mesh.geometry).not.toBe(asset.bark);
            expect(mesh.geometry.index).toBe(asset.bark.index);
            expect(mesh.geometry.attributes.position).toBe(asset.bark.attributes.position);
            expect(mesh.geometry.drawRange.count).toBe(asset.barkCoreIndices);
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, matrix);
                position.setFromMatrixPosition(matrix);
                expect(Math.hypot(position.x - EYE.x, position.z - EYE.z)).toBeGreaterThan(BARK_LIMBS_TO);
            }
        });
        whole.forEach((mesh) => {
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, matrix);
                position.setFromMatrixPosition(matrix);
                expect(Math.hypot(position.x - EYE.x, position.z - EYE.z)).toBeLessThanOrEqual(BARK_LIMBS_TO);
            }
        });
        // Fewer bark triangles than every tree drawn whole.
        const allWhole = [...stemsOnly, ...whole].reduce((sum, mesh) => {
            const name = mesh.name.replace('GrainfieldsBark ', '').split('|')[0];
            return sum + (assets.trees[name].bark.index.count / 3) * mesh.count;
        }, 0);
        expect(forest.stats.barkTriangles).toBeLessThan(allWhole * 0.5);
        forest.dispose();
    });
});
