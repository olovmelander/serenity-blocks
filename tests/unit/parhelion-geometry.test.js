/**
 * Parhelion Vigil Stone geometry (spec §5.1, §2.4): the mesh the solver sizes must match the
 * numbers the solver assumes. No GPU: the geometry is plain BufferGeometry data.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CROWN_CAP_Y,
    DEFAULT_STONE_PROFILE,
    FAR_STONES,
    MEASURED_VIEWPORTS,
    STONE,
    projectWorld,
    solveStone,
} from '../../src/playground/effects/parhelion-composition.js';
import {
    STONE_SEED,
    buildFarStoneMesh,
    buildStoneGeometry,
    buildStoneRings,
    measureStoneProfile,
} from '../../src/playground/effects/parhelion-geometry.js';

describe('parhelion stone geometry', () => {
    const { geometry, profile } = buildStoneGeometry(STONE_SEED);
    const pos = geometry.attributes.position;

    it('is an indexed, smooth-normalled lathe of a few thousand triangles with ledge attributes', () => {
        expect(geometry.index).not.toBeNull();
        const tris = geometry.index.count / 3;
        expect(tris).toBeGreaterThanOrEqual(3000);
        expect(tris).toBeLessThanOrEqual(5000);
        expect(geometry.attributes.normal.count).toBe(pos.count);
        expect(geometry.attributes.aLedge.itemSize).toBe(4);
        expect(geometry.attributes.aLedgeW.itemSize).toBe(4);
        const w = geometry.attributes.aLedgeW.array;
        expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...w)).toBeLessThanOrEqual(1);
        // Some ledges exist somewhere, and some stretches have none (they come and go).
        expect(Math.max(...w)).toBeGreaterThan(0.9);
        expect(Math.min(...w)).toBeLessThan(0.1);
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

    it('orients every triangle outward (smooth normals must not point into the stone)', () => {
        const index = geometry.index.array;
        for (let t = 0; t < index.length / 3; t++) {
            const [a, b, c] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
            const ax = pos.getX(a);
            const ay = pos.getY(a);
            const az = pos.getZ(a);
            const ux = pos.getX(b) - ax;
            const uy = pos.getY(b) - ay;
            const uz = pos.getZ(b) - az;
            const vx = pos.getX(c) - ax;
            const vy = pos.getY(c) - ay;
            const vz = pos.getZ(c) - az;
            const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
            const cen = [
                (ax + pos.getX(b) + pos.getX(c)) / 3,
                (ay + pos.getY(b) + pos.getY(c)) / 3 - 0.45,
                (az + pos.getZ(b) + pos.getZ(c)) / 3,
            ];
            expect(n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2], `triangle ${t}`).toBeGreaterThan(0);
        }
        // The vertex normals agree: on the front of the stone they face the camera (+z).
        const nz = geometry.attributes.normal;
        let front = 0;
        let toward = 0;
        for (let i = 0; i < pos.count; i++) {
            if (pos.getZ(i) > 0.8 && pos.getY(i) < 0.8) {
                front += 1;
                if (nz.getZ(i) > 0) toward += 1;
            }
        }
        expect(front).toBeGreaterThan(50);
        expect(toward).toBe(front);
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

describe('parhelion far stones mesh', () => {
    it('is ONE instanced draw of the composition row: split slabs, no ledge attributes', () => {
        const material = new THREE.MeshBasicNodeMaterial();
        const mesh = buildFarStoneMesh(material, FAR_STONES);
        expect(mesh.isInstancedMesh).toBe(true);
        expect(mesh.count).toBe(FAR_STONES.length);
        expect(mesh.geometry.index).toBeNull();
        expect(mesh.geometry.attributes.aLedge).toBeUndefined();
        expect(mesh.geometry.attributes.aLedgeW).toBeUndefined();
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        FAR_STONES.forEach(([x, z], i) => {
            mesh.getMatrixAt(i, m);
            p.setFromMatrixPosition(m);
            expect(p.x).toBeCloseTo(x, 6);
            expect(p.z).toBeCloseTo(z, 6);
            expect(p.y).toBeLessThan(0);
        });
        // The crown is cut flat (a slanted plane), so no vertex rises above ≈ 1.05 unit height.
        const pos = mesh.geometry.attributes.position;
        let top = 0;
        for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
        expect(top).toBeLessThan(1.06);
        mesh.geometry.dispose();
        material.dispose();
    });
});
