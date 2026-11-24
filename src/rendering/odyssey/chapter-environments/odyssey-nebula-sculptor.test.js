import { describe, expect, it } from 'vitest';

import {
    CLOUD_FIELD_LOD_DETAIL, buildCloudFieldGeometry, buildCloudLobes, cloudFieldSdf, cloudMassSdf, sculptCloudMass,
} from './odyssey-nebula-sculptor.js';

/** The nebula's sculptor: the hull chapter 6's gas is measured against, and the prototype's mass. */
const SPEC = Object.freeze({
    id: 'mass', lod: 'near', x: 120, base: 400, z: -300, w: 640, h: 300, yaw: 0.4, seed: 11.3,
});

describe('the nebula\'s sculptor', () => {
    it('puts every vertex on the surface it marched to, above its base, its normals unit', () => {
        const m = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.near);
        const lobes = buildCloudLobes(SPEC);
        let worst = 0;
        for (let v = 0; v < m.position.length; v += 3) {
            worst = Math.max(worst, Math.abs(cloudMassSdf(SPEC, lobes, m.position[v], m.position[v + 1], m.position[v + 2])));
            expect(m.position[v + 1]).toBeGreaterThan(SPEC.base - (SPEC.w * 0.05));
            expect(Math.hypot(m.normal[v], m.normal[v + 1], m.normal[v + 2])).toBeCloseTo(1, 3);
        }
        // A vertex that collapsed to the centre lands a full radius away.
        expect(worst).toBeLessThan(SPEC.w * 0.005);
    });

    it('bakes an occlusion with a real range, and the same mass every time', () => {
        const a = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.near);
        const ao = Array.from({ length: a.colour.length / 3 }, (_, v) => a.colour[v * 3]);
        expect(Math.min(...ao)).toBeLessThan(0.35);
        expect(Math.max(...ao)).toBeGreaterThan(0.85);
        expect(Array.from(sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.near).position)).toEqual(Array.from(a.position));
    });

    it('refuses a mass with no inside, rather than sculpting it inside out', () => {
        expect(() => sculptCloudMass({ ...SPEC, w: 0 }, 1)).toThrow(/centre is outside/);
    });

    it('merges masses into one geometry, with every attribute its paint reads', () => {
        const { geometry, triangles, masses } = buildCloudFieldGeometry([SPEC, {
            ...SPEC, x: 2000, lod: 'far', seed: 4.2,
        }]);
        expect(masses).toBe(2);
        expect(triangles).toBe((20 * ((CLOUD_FIELD_LOD_DETAIL.near + 1) ** 2)) + (20 * ((CLOUD_FIELD_LOD_DETAIL.far + 1) ** 2)));
        ['position', 'normal', 'aMassCentre', 'color', 'aLobe'].forEach((name) => {
            expect(geometry.getAttribute(name).count, name).toBe(triangles * 3);
        });
        geometry.dispose();
    });

    it('measures to the nearest surface of them all', () => {
        const two = [SPEC, { ...SPEC, x: 3000 }];
        expect(cloudFieldSdf(two, SPEC.x, SPEC.base + 120, SPEC.z)).toBeLessThan(0);
        expect(cloudFieldSdf(two, 1500, SPEC.base + 120, SPEC.z)).toBeGreaterThan(500);
    });
});
