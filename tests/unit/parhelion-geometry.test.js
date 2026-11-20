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
    MENHIR_KINDS,
    STONE,
    projectWorld,
    solveStone,
} from '../../src/playground/effects/parhelion-composition.js';
import {
    MENHIR_SINK,
    STONE_SEED,
    buildFarStoneMeshes,
    buildMenhirGeometry,
    buildStoneGeometry,
    buildStoneRings,
    measureStoneProfile,
} from '../../src/playground/effects/parhelion-geometry.js';
import { PARHELION_MENHIRS } from '../../src/themes/parhelion/parhelion-menhir-models.js';

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

describe('parhelion far stones: the avenue of menhirs (2026-11 living pass)', () => {
    it('is ONE instanced draw a kind, every stone of the composition placed once', () => {
        const material = new THREE.MeshBasicNodeMaterial();
        const meshes = buildFarStoneMeshes(material, FAR_STONES);
        const kinds = new Set(FAR_STONES.map((stone) => stone[6]));
        expect(meshes.length).toBe(kinds.size);
        expect(meshes.length).toBeLessThanOrEqual(MENHIR_KINDS.length);
        expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(FAR_STONES.length);
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        MENHIR_KINDS.forEach((name, kind) => {
            const mesh = meshes.find((entry) => entry.name.endsWith(name));
            const rows = FAR_STONES.filter((stone) => stone[6] === kind);
            expect(mesh.isInstancedMesh, name).toBe(true);
            expect(mesh.count, name).toBe(rows.length);
            rows.forEach(([x, z, , height], i) => {
                mesh.getMatrixAt(i, m);
                m.decompose(p, q, s);
                // Float32 matrices: the foot is where the composition says, to a millimetre.
                expect(p.x).toBeCloseTo(x, 3);
                expect(p.z).toBeCloseTo(z, 3);
                // Sunk a little into the snow (less than the model's own buried foot), and its
                // model one stone-height tall on every axis (no squash: the kinds keep their shape).
                expect(p.y).toBeCloseTo(-MENHIR_SINK * height, 3);
                expect(s.x).toBeCloseTo(height, 3);
                expect(s.y).toBeCloseTo(height, 3);
                expect(s.z).toBeCloseTo(height, 3);
            });
        });
        meshes.forEach((mesh) => mesh.geometry.dispose());
        material.dispose();
    });

    it('decodes each model to a unit-tall indexed mesh with unit normals and an occlusion in 0..1', () => {
        MENHIR_KINDS.forEach((name) => {
            const model = PARHELION_MENHIRS[name];
            expect(MENHIR_SINK, name).toBeLessThan(model.bury);
            const geometry = buildMenhirGeometry(model);
            const pos = geometry.attributes.position;
            const { normal } = geometry.attributes;
            const ao = geometry.attributes.aAo;
            expect(geometry.index.count % 3).toBe(0);
            expect(pos.count).toBe(normal.count);
            expect(pos.count).toBe(ao.count);
            let top = -Infinity;
            let bottom = Infinity;
            for (let i = 0; i < pos.count; i++) {
                top = Math.max(top, pos.getY(i));
                bottom = Math.min(bottom, pos.getY(i));
                const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
                expect(length).toBeGreaterThan(0.97);
                expect(length).toBeLessThan(1.03);
                expect(ao.getX(i)).toBeGreaterThanOrEqual(0);
                expect(ao.getX(i)).toBeLessThanOrEqual(1);
            }
            expect(top, name).toBeCloseTo(1, 3);
            expect(bottom, name).toBeLessThan(0);
            for (let i = 0; i < geometry.index.count; i++) expect(geometry.index.getX(i)).toBeLessThan(pos.count);
            geometry.dispose();
        });
    });

    it('gives each stone the half-width its kind really has (its shadow and its light pillar use it)', () => {
        FAR_STONES.forEach(([, , halfWidth, height, , , kind]) => {
            const model = PARHELION_MENHIRS[MENHIR_KINDS[kind]];
            const real = Math.max(Math.abs(model.min[0]), Math.abs(model.max[0])) * height;
            // Within a third of the model's own broadest half-width (a shadow is softened anyway).
            expect(halfWidth / real, MENHIR_KINDS[kind]).toBeGreaterThan(0.66);
            expect(halfWidth / real, MENHIR_KINDS[kind]).toBeLessThan(1.34);
        });
    });
});
