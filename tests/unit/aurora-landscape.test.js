import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { AIR_BOX, buildAirSeeds } from '../../src/themes/aurora/aurora-air.js';
import { HAZE, MIST, layerDepthCpu } from '../../src/themes/aurora/aurora-atmosphere.js';
import {
    SHORE_ICE, SHORE_Z, bakeShoreIce, bankHeight, buildSpruceGeometry, orientTriangles, placeForest, rangeHeight,
} from '../../src/themes/aurora/aurora-landscape.js';
import { createRandom } from '../../src/themes/aurora/aurora-noise.js';
import { QUALITY_PRESETS } from '../../src/themes/aurora/aurora-quality.js';
import { AURORA_SEED, AuroraWorld } from '../../src/themes/aurora/aurora-world.js';

const RANGE_SEED = AURORA_SEED % 9973;
const worlds = [];

afterEach(() => {
    for (const world of worlds) world.dispose();
    worlds.length = 0;
});

/** Midpoint-rule optical depth of an exponential layer along a straight path. */
function integrate(h0, h1, length, height, density, steps = 4000) {
    let sum = 0;
    for (let i = 0; i < steps; i += 1) {
        const h = h0 + (h1 - h0) * ((i + 0.5) / steps);
        sum += density * Math.exp(-Math.max(h, 0) / height);
    }
    return (sum * length) / steps;
}

describe('Aurora atmosphere', () => {
    it('integrates both layers in closed form, level paths included', () => {
        const paths = [[8, 0, 120], [8, 300, 2400], [8, 8, 500], [8, 8.0004, 500], [40, 2, 60], [0, 900, 9000]];
        for (const [h0, h1, length] of paths) {
            for (const { height, density } of [MIST, HAZE]) {
                const exact = integrate(h0, h1, length, height, density);
                expect(Math.abs(layerDepthCpu(h0, h1, length, height, density) - exact) / exact).toBeLessThan(1e-4);
            }
        }
        expect(layerDepthCpu(8, 0, 0, MIST.height, MIST.density)).toBe(0);
    });

    it('leaves the near water clear, hazes the far shore and lets the peaks stand out of the mist', () => {
        const total = (h1, length) => layerDepthCpu(8, h1, length, MIST.height, MIST.density)
            + layerDepthCpu(8, h1, length, HAZE.height, HAZE.density);
        const nearWater = total(0, 60);
        const farShore = total(0, -SHORE_Z);
        const valley = total(20, 1500);
        const summit = total(600, 1900);
        expect(Math.exp(-nearWater)).toBeGreaterThan(0.9);
        expect(farShore).toBeGreaterThan(nearWater * 5);
        expect(valley).toBeGreaterThan(summit * 2);
        expect(Math.exp(-summit)).toBeGreaterThan(0.6);
        // The eye under the water (the planar mirror's) sees the same air as the one above it.
        expect(layerDepthCpu(Math.abs(-8), 300, 2400, MIST.height, MIST.density))
            .toBe(layerDepthCpu(8, 300, 2400, MIST.height, MIST.density));
    });
});

describe('Aurora spruces', () => {
    const geometry = buildSpruceGeometry(createRandom(7));
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    const snow = geometry.attributes.snow.array;
    const index = geometry.index.array;

    it('winds every triangle with its written normals, so a double-sided material lights the right side', () => {
        const indices = Array.from(index);
        expect(orientTriangles(position, normal, indices)).toBe(0);
        // A triangle wound against its normals is turned over.
        const flipped = [indices[0], indices[2], indices[1]];
        expect(orientTriangles(position, normal, flipped)).toBe(1);
        expect(flipped).toEqual(indices.slice(0, 3));
    });

    it('carries its snow on surfaces that face the sky, never on the undersides', () => {
        let loadedUp = 0;
        let loaded = 0;
        for (let i = 0; i < snow.length; i += 1) {
            if (snow[i] > 0.2) {
                loaded += 1;
                if (normal[i * 3 + 1] > 0.3) loadedUp += 1;
            }
            if (normal[i * 3 + 1] < -0.5) expect(snow[i]).toBe(0);
        }
        expect(loaded).toBeGreaterThan(500);
        expect(loadedUp / loaded).toBeGreaterThan(0.95);
    });

    it('is one unit tall, narrower than it is tall, and within its triangle budget', () => {
        geometry.computeBoundingBox();
        const { min, max } = geometry.boundingBox;
        // The lowest boughs sag to the snow the trunk stands in.
        expect(min.y).toBeGreaterThan(-0.15);
        expect(max.y).toBeCloseTo(1, 1);
        expect(max.x - min.x).toBeLessThan(0.75);
        expect(max.z - min.z).toBeLessThan(0.75);
        expect(index.length / 3).toBeLessThan(9000);
        const far = buildSpruceGeometry(createRandom(7), {
            whorls: 8, segments: 1, teeth: false, branches: 6, coreSides: 7, coreRings: 4,
        });
        expect(far.index.count / 3).toBeLessThan(450);
        expect(far.attributes.snow.count).toBe(far.attributes.position.count);
    });
});

describe('Aurora far forest and shore ice', () => {
    it('plants groves on the land beyond the shore, the same for the same seed', () => {
        const trees = placeForest(400, createRandom(11), RANGE_SEED);
        expect(trees).toEqual(placeForest(400, createRandom(11), RANGE_SEED));
        expect(trees.length).toBe(400);
        for (const [x, y, z, height] of trees) {
            expect(z).toBeLessThan(SHORE_Z);
            expect(y + 1.2).toBeCloseTo(rangeHeight(x, z, RANGE_SEED), 6);
            expect(y).toBeGreaterThan(0);
            expect(height).toBeGreaterThan(9);
            expect(height).toBeLessThan(29);
        }
        // Groves, not a plantation: a tree's nearest neighbour is far closer than an even
        // scatter over the same area would put it.
        let nearest = 0;
        for (const [x, , z] of trees) {
            let best = Infinity;
            for (const [ox, , oz] of trees) {
                const d = Math.hypot(ox - x, oz - z);
                if (d > 0 && d < best) best = d;
            }
            nearest += best;
        }
        expect(nearest / trees.length).toBeLessThan(25);
        expect(placeForest(0, createRandom(1), RANGE_SEED)).toEqual([]);
    });

    it('freezes the shallows along the banks and leaves the channel open', () => {
        const data = bakeShoreIce(RANGE_SEED);
        const { width, height } = SHORE_ICE;
        expect(data).toHaveLength(width * height * 4);
        const at = (x, z) => {
            const i = Math.round(((x + SHORE_ICE.half) / (SHORE_ICE.half * 2)) * (width - 1));
            const j = Math.round(((z - SHORE_ICE.near) / (SHORE_ICE.far - SHORE_ICE.near)) * (height - 1));
            return data[(j * width + i) * 4];
        };
        // Border texels stay open water, so the clamped lookup leaves the lake beyond the mask.
        for (let i = 0; i < width; i += 1) {
            expect(data[i * 4]).toBe(0);
            expect(data[((height - 1) * width + i) * 4]).toBe(0);
        }
        for (const z of [-20, -60, -120]) expect(at(0, z)).toBe(0);
        // Under each snow bank the mask is ice, and somewhere at the waterline there is a rim.
        expect(at(-120, -30)).toBe(255);
        expect(at(120, -30)).toBe(255);
        let rim = 0;
        for (let z = -30; z >= -110; z -= 20) {
            for (let x = -150; x <= 150; x += 1) {
                if (bankHeight(x, z, RANGE_SEED) < -0.2 && at(x, z) > 128) rim += 1;
            }
        }
        expect(rim).toBeGreaterThan(20);
    });
});

describe('Aurora air and the new world parts', () => {
    it('seeds the diamond dust deterministically inside the unit cube', () => {
        const seeds = buildAirSeeds(300, createRandom(5));
        expect(Array.from(seeds)).toEqual(Array.from(buildAirSeeds(300, createRandom(5))));
        expect(seeds).toHaveLength(1200);
        expect(Math.min(...seeds)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...seeds)).toBeLessThan(1);
        expect(AIR_BOX.near).toBeGreaterThan(0);
    });

    it.each(['Extreme', 'High', 'Minimal'])('builds the forest and the dust at %s and disposes them', (tier) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 12000);
        const world = new AuroraWorld({ scene, camera, quality: tier });
        worlds.push(world);
        const report = world.getDiagnostics();
        expect(report.landscape.forest).toBe(QUALITY_PRESETS[tier].forestCount);
        expect(report.air.crystals).toBe(QUALITY_PRESETS[tier].dustCount);
        const names = [];
        scene.traverse((object) => { if (object.name) names.push(object.name); });
        expect(names).toEqual(expect.arrayContaining(['Aurora — far forest', 'Aurora — diamond dust']));
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(world.air.disposed && world.landscape.disposed).toBe(true);
    });

    it('scales the new budgets down the tiers', () => {
        const tiers = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
        for (let i = 1; i < tiers.length; i += 1) {
            for (const key of ['forestCount', 'dustCount', 'sparkCount']) {
                expect(QUALITY_PRESETS[tiers[i]][key], `${tiers[i]}.${key}`)
                    .toBeLessThanOrEqual(QUALITY_PRESETS[tiers[i - 1]][key]);
            }
        }
    });
});
