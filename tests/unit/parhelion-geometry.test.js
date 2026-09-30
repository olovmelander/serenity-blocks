/**
 * Parhelion Vigil Stone geometry (spec §5.1, §2.4): the mesh the solver sizes must match the
 * numbers the solver assumes. No GPU: the geometry is plain BufferGeometry data.
 */

import { describe, expect, it } from 'vitest';
import {
    CROWN_CAP_Y,
    DEFAULT_STONE_PROFILE,
    MEASURED_VIEWPORTS,
    STONE,
    projectWorld,
    solveStone,
} from '../../src/playground/effects/parhelion-composition.js';
import {
    STONE_SEED,
    buildStoneGeometry,
    buildStoneRings,
    measureStoneProfile,
} from '../../src/playground/effects/parhelion-geometry.js';

describe('parhelion stone geometry', () => {
    const { geometry, profile } = buildStoneGeometry(STONE_SEED);
    const pos = geometry.attributes.position;

    it('is a low-poly, non-indexed faceted mesh with per-facet hashes and barycentrics', () => {
        expect(geometry.index).toBeNull();
        const tris = pos.count / 3;
        expect(tris).toBeGreaterThanOrEqual(200);
        expect(tris).toBeLessThanOrEqual(300);
        expect(geometry.attributes.aFacet.count).toBe(pos.count);
        expect(geometry.attributes.aBary.count).toBe(pos.count);
        expect(geometry.attributes.normal.count).toBe(pos.count);
        const facet = geometry.attributes.aFacet;
        for (let t = 0; t < tris; t++) {
            expect(facet.getX(t * 3)).toBe(facet.getX(t * 3 + 2));
        }
    });

    it('keeps DEFAULT_STONE_PROFILE equal to the measured default mesh (the solver trusts it)', () => {
        expect(profile).toHaveLength(STONE.BANDS);
        for (let b = 0; b < STONE.BANDS; b++) {
            expect(profile[b], `band ${b}`).toBeCloseTo(DEFAULT_STONE_PROFILE[b], 3);
        }
        expect(Array.from(measureStoneProfile(buildStoneRings(STONE_SEED).rings))).toEqual(Array.from(profile));
    });

    it('never shrinks the body below the core (outward-only jitter), only the rounded shoulder narrows', () => {
        for (let b = 0; b < STONE.BANDS - 2; b++) expect(profile[b], `band ${b}`).toBeGreaterThanOrEqual(0.985);
        expect(profile[STONE.BANDS - 1]).toBeGreaterThan(0.75);
    });

    it('tops out at UNIT_CROWN, with the peak left of the axis (asymmetric crown)', () => {
        let maxY = 0;
        let peakX = 0;
        for (let i = 0; i < pos.count; i++) {
            if (pos.getY(i) > maxY) {
                maxY = pos.getY(i);
                peakX = pos.getX(i);
            }
        }
        expect(maxY).toBeLessThanOrEqual(STONE.UNIT_CROWN + 1e-6);
        expect(maxY).toBeGreaterThan(STONE.UNIT_CROWN - 0.02);
        expect(peakX).toBeLessThan(0);
    });

    it('orients every facet outward', () => {
        for (let t = 0; t < pos.count / 3; t++) {
            const i = t * 3;
            const ax = pos.getX(i);
            const ay = pos.getY(i);
            const az = pos.getZ(i);
            const ux = pos.getX(i + 1) - ax;
            const uy = pos.getY(i + 1) - ay;
            const uz = pos.getZ(i + 1) - az;
            const vx = pos.getX(i + 2) - ax;
            const vy = pos.getY(i + 2) - ay;
            const vz = pos.getZ(i + 2) - az;
            const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
            const c = [
                (ax + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
                (ay + pos.getY(i + 1) + pos.getY(i + 2)) / 3 - 0.45,
                (az + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
            ];
            expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2], `facet ${t}`).toBeGreaterThan(0);
        }
    });

    it('keeps the real mesh under the crown cap at every measured viewport once solved', () => {
        const scr = { x: 0, y: 0, depth: 0 };
        const cl = Math.cos(STONE.LEAN);
        const sl = Math.sin(STONE.LEAN);
        for (const vp of MEASURED_VIEWPORTS) {
            const solve = solveStone({ card: vp.card, aspect: vp.aspect, profile });
            let top = 1;
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i) * solve.sx;
                const y = pos.getY(i) * solve.sy;
                const z = pos.getZ(i) * solve.sx * STONE.DEPTH_SCALE;
                projectWorld({ x: x * cl + y * sl, y: -x * sl + y * cl, z: STONE.Z + z }, vp.aspect, scr);
                top = Math.min(top, scr.y);
            }
            // The solver caps the peak at the slab centre; front crown vertices may sit a hair higher.
            expect(top, `${vp.width}x${vp.height}`).toBeGreaterThan(CROWN_CAP_Y - 0.004);
        }
    });
});
