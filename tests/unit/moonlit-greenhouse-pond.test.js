/**
 * Moonlit Greenhouse — the lily canal's geometry.
 *
 * The pads, the lilies and the reeds are built in code (moonlit-greenhouse-pond.js). These tests
 * pin what one screenshot cannot: that every triangle's normal agrees with its winding (the pads
 * are single-sided and lit by their stored normal, so a pad wound the wrong way would be dark or
 * culled), that the pads' floors face up and the Victoria rims stand up from their floors with the
 * outer skirt facing out, that the tiers scale the reeds and the lilies, that the reed clumps the
 * mirror darkens agree with the plan's reeds, that the swell's slopes stay physical, and that each
 * part disposes what it built.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    LILY_PAD, PETAL, REED, RING, VICTORIA, buildLilyGeometry, buildLilyPadGeometry, buildReedGeometry,
    buildVictoriaGeometry, buildWaterGeometry, reedClumps, residentLilies, ringRadius, swellAt, victoriaSection,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-pond.js';
import { planGarden } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-plan.js';
import { QUALITY } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { FLOOR, TIMING } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';
import { MoonlitGreenhouseWorld } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';

const arrays = (g) => ({
    position: g.getAttribute('position').array,
    normal: g.getAttribute('normal').array,
    index: g.getIndex().array,
});

/** The share of triangles whose face normal agrees with the mean of their vertex normals. */
function windingAgreement(g) {
    const { position: P, normal: N, index: I } = arrays(g);
    let agree = 0;
    let total = 0;
    for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
        const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
        const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (Math.hypot(f[0], f[1], f[2]) < 1e-10) continue;
        const n = [N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]];
        total += 1;
        if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] > 0) agree += 1;
    }
    return agree / Math.max(1, total);
}

const finite = (g) => Object.values(g.attributes).every((a) => a.array.every(Number.isFinite));

describe('moonlit greenhouse: the lily canal', () => {
    const tier = QUALITY.High;
    const plan = planGarden(tier);

    it('lays the water over the canal, facing up', () => {
        const g = buildWaterGeometry();
        g.computeBoundingBox();
        const box = g.boundingBox;
        expect(box.min.x).toBeCloseTo(-FLOOR.canal.half, 5);
        expect(box.max.x).toBeCloseTo(FLOOR.canal.half, 5);
        expect(box.max.z).toBeCloseTo(FLOOR.canal.head, 5);
        expect(box.min.z).toBeCloseTo(FLOOR.canal.end, 5);
        expect(box.min.y).toBeCloseTo(FLOOR.canal.water, 5);
        expect(box.max.y).toBeCloseTo(FLOOR.canal.water, 5);
        expect(windingAgreement(g)).toBe(1);
        const n = g.getAttribute('normal').array;
        for (let i = 1; i < n.length; i += 3) expect(n[i]).toBeCloseTo(1, 5);
    });

    it('winds every pad, lily and reed triangle with its normal', () => {
        const victoria = buildVictoriaGeometry(plan.pads, 96);
        const pads = buildLilyPadGeometry(plan.pads, 24);
        const lilies = buildLilyGeometry(residentLilies(plan.pads, 6));
        const reeds = buildReedGeometry(plan.reeds, 7);
        [victoria, pads, lilies, reeds].forEach((g) => {
            expect(finite(g)).toBe(true);
            expect(windingAgreement(g)).toBeGreaterThan(0.995);
        });
    });

    it('floats the pads face up on the water, inside the canal', () => {
        const victoria = buildVictoriaGeometry(plan.pads, 96);
        const pads = buildLilyPadGeometry(plan.pads, 24);
        [victoria, pads].forEach((g) => {
            const P = g.getAttribute('position').array;
            const N = g.getAttribute('normal').array;
            const leaf = g.getAttribute('aLeaf').array;
            let up = 0;
            let floors = 0;
            for (let i = 0; i < P.length / 3; i += 1) {
                expect(Math.abs(P[i * 3])).toBeLessThan(FLOOR.canal.half);
                if (leaf[i * 4 + 2] > 0.5) continue; // the Victoria's rim
                floors += 1;
                up += N[i * 3 + 1];
                expect(P[i * 3 + 1]).toBeGreaterThan(FLOOR.canal.water);
            }
            expect(up / floors).toBeGreaterThan(0.95);
        });
    });

    it('turns up the Victoria rim 6-10 cm, inner face in, outer skirt out', () => {
        const section = victoriaSection(0.8, VICTORIA.floor + 0.08);
        const top = Math.max(...section.map((q) => q.y));
        expect(top - VICTORIA.floor).toBeGreaterThan(0.06);
        expect(top - VICTORIA.floor).toBeLessThan(0.1 + 0.01);
        expect(section.some((q) => q.part === 3 && q.y < VICTORIA.floor)).toBe(true);
        // In the merged pads: rim normals point toward the pad's middle on the inner face and
        // away from it on the outer skirt.
        const g = buildVictoriaGeometry(plan.pads, 96);
        const N = g.getAttribute('normal').array;
        const P = g.getAttribute('position').array;
        const pad = g.getAttribute('aPad').array;
        const leaf = g.getAttribute('aLeaf').array;
        let inner = 0;
        let outer = 0;
        let innerN = 0;
        let outerN = 0;
        for (let i = 0; i < P.length / 3; i += 1) {
            const part = leaf[i * 4 + 2];
            const h = leaf[i * 4 + 3];
            if (h < 0.3 || h > 0.9) continue;
            const rx = P[i * 3] - pad[i * 4];
            const rz = P[i * 3 + 2] - pad[i * 4 + 1];
            const radial = (N[i * 3] * rx + N[i * 3 + 2] * rz) / Math.hypot(rx, rz);
            if (part > 0.5 && part < 1.5) {
                inner += radial;
                innerN += 1;
            } else if (part > 2.5) {
                outer += radial;
                outerN += 1;
            }
        }
        expect(inner / innerN).toBeLessThan(-0.8);
        expect(outer / outerN).toBeGreaterThan(0.8);
    });

    it('cuts the lily pads\' sinus and keeps the flowers on their pads', () => {
        const g = buildLilyPadGeometry(plan.pads, 24);
        const leaf = g.getAttribute('aLeaf').array;
        for (let i = 0; i < leaf.length; i += 4) {
            const k = leaf[i + 3];
            if (k < 0.5) continue;
            const phi = Math.atan2(leaf[i + 1], leaf[i]);
            expect(Math.abs(phi)).toBeGreaterThan(LILY_PAD.sinus * k + 0.02);
        }
        const lilies = residentLilies(plan.pads, 6);
        expect(lilies.length).toBe(6);
        lilies.forEach((l) => {
            expect(l.pad.kind).toBe('lily');
            expect(Math.hypot(l.x - l.pad.x, l.z - l.pad.z)).toBeLessThan(l.pad.radius * 0.5);
        });
        const flowers = buildLilyGeometry(lilies);
        const kinds = new Set();
        const pk = flowers.getAttribute('aPetal').array;
        for (let i = 2; i < pk.length; i += 4) kinds.add(pk[i]);
        expect([...kinds].sort()).toEqual([PETAL.sepal, PETAL.petal, PETAL.stamen]);
    });

    it('scales the reeds and the lilies with the tier', () => {
        const counts = ['Minimal', 'Medium', 'Extreme'].map((name) => {
            const p = planGarden(QUALITY[name]);
            const g = buildReedGeometry(p.reeds, 6);
            const blade = g.getAttribute('aBlade').array;
            let heads = 0;
            for (let i = 0; i < blade.length; i += 4) if (blade[i + 1] === REED.head && blade[i + 2] === 0) heads += 1;
            const cattails = p.reeds.filter((r) => r.cattail).length;
            return { verts: g.getAttribute('position').count, heads, cattails };
        });
        expect(counts[0].verts).toBeLessThan(counts[1].verts);
        expect(counts[1].verts).toBeLessThan(counts[2].verts);
        // One head (9 vertices round its foot ring) a cattail.
        counts.forEach((c) => expect(c.heads).toBe(c.cattails * 9));
    });

    it('gathers the reeds into clumps that hold them', () => {
        const clumps = reedClumps(plan.reeds, 64);
        const total = clumps.reduce((n, c) => n + c.count, 0);
        expect(total).toBe(plan.reeds.length);
        clumps.forEach((c) => {
            expect(Math.abs(c.x)).toBeLessThan(FLOOR.canal.half);
            expect(c.radius).toBeGreaterThan(0.1);
            expect(c.radius).toBeLessThan(1.2);
            expect(c.height).toBeGreaterThan(0.5);
        });
        const near = reedClumps(plan.reeds, 8);
        expect(near.length).toBe(8);
        for (let i = 1; i < near.length; i += 1) expect(near[i].z).toBeLessThanOrEqual(near[i - 1].z);
    });

    it('keeps the swell gentle and the rings inside the canal', () => {
        let most = 0;
        let high = 0;
        for (let i = 0; i < 400; i += 1) {
            const s = swellAt(Math.sin(i) * 2.4, -i * 0.13, i * 0.37);
            most = Math.max(most, Math.hypot(s.sx, s.sz));
            high = Math.max(high, Math.abs(s.h));
        }
        expect(most).toBeLessThan(0.05);
        expect(most).toBeGreaterThan(0.01);
        expect(high).toBeLessThan(0.02);
        expect(RING.life).toBe(TIMING.ringLife);
        expect(ringRadius(RING.life)).toBeLessThan(FLOOR.canal.half * 2);
        expect(ringRadius(-1)).toBe(RING.start);
    });

    it('builds and disposes all three parts', () => {
        const world = new MoonlitGreenhouseWorld({ scene: new THREE.Scene(), quality: 'Low' }).build();
        ['water', 'pads', 'reeds'].forEach((name) => {
            const part = world.parts[name];
            const meshes = [];
            part.mesh.traverse((o) => { if (o.isMesh) meshes.push(o); });
            expect(meshes.length).toBeGreaterThan(0);
            meshes.forEach((m) => {
                expect(m.frustumCulled).toBe(false);
                expect(m.renderOrder).toBeGreaterThan(0);
            });
            let disposed = 0;
            meshes.forEach((m) => {
                m.geometry.addEventListener('dispose', () => { disposed += 1; });
                m.material.addEventListener('dispose', () => { disposed += 1; });
            });
            part.dispose();
            expect(part.mesh.parent).toBe(null);
            expect(disposed).toBe(meshes.length * 2);
        });
        expect(world.parts.pads.lilies.length).toBeGreaterThanOrEqual(3);
        expect(world.parts.pads.lilies.length).toBeLessThanOrEqual(8);
        expect(world.parts.pads.mesh.renderOrder).toBe(0);
    });
});
