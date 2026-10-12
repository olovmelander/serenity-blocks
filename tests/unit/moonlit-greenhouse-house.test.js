/**
 * Moonlit Greenhouse — the house's geometry: the iron, the floor, the lanterns.
 *
 * Every rib, column, kerb, urn and lantern is built in code. These tests pin what one screenshot
 * cannot: that the pointed arch the ribs follow is the glass's own (springing at the side walls'
 * heads, meeting at the ridge), that the haunch eases into the girder, that every triangle is
 * wound the way its normals face (the materials are one-sided: a strip wound wrong vanishes),
 * that the faces that matter face the right way (the ribs' soffits into the nave, the columns'
 * shafts outward, the floor up, the canal walls in over the water, the lantern panes out from
 * their flames), that the tiers scale the detail within the triangle budget, and that each part
 * disposes everything it built.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    COLUMN, RIB, archOut, archPoint, buildIronMeshes, ribDepth, ribSamples,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-iron.js';
import { PAVE, buildFloorMeshes, urnProfile } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-floor.js';
import {
    LANTERN, buildLanternMeshes, flameOf,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-lanterns.js';
import { planGarden } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-plan.js';
import { QUALITY } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { ARC, FLOOR, HOUSE } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';
import { MoonlitGreenhouseWorld } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';

const TIERS = Object.keys(QUALITY);

/** Triangles whose face normal disagrees with the mean of their vertex normals. */
function windingFaults(mesh) {
    const P = mesh.position;
    const N = mesh.normal;
    const I = mesh.index;
    let faults = 0;
    for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
        const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
        const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
        const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const n = [0, 1, 2].map((k) => N[a * 3 + k] + N[b * 3 + k] + N[c * 3 + k]);
        if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] <= 0) faults += 1;
    }
    return faults;
}

/** Every vertex of a builder whose attribute `key` component 0 is `kind`: [{ p, n, v }]. */
function verticesOf(mesh, key, kind) {
    const size = mesh.sizes[key];
    const out = [];
    for (let i = 0; i < mesh.vertexCount; i += 1) {
        const v = mesh.data[key].slice(i * size, i * size + size);
        if (Math.round(v[0]) !== kind) continue;
        out.push({
            p: mesh.position.slice(i * 3, i * 3 + 3), n: mesh.normal.slice(i * 3, i * 3 + 3), v,
        });
    }
    return out;
}

function allFinite(mesh) {
    return mesh.position.every(Number.isFinite) && mesh.normal.every(Number.isFinite)
        && Object.values(mesh.data).every((list) => list.every(Number.isFinite));
}

describe('the arch the ribs follow', () => {
    it('springs from the side walls’ heads and meets at the ridge', () => {
        [-1, 1].forEach((side) => {
            const foot = archPoint(side, 0, ARC.radius);
            expect(foot[0]).toBeCloseTo(side * HOUSE.halfSpan, 6);
            expect(foot[1]).toBeCloseTo(HOUSE.spring, 6);
            const apex = archPoint(side, ARC.length, ARC.radius);
            expect(apex[0]).toBeCloseTo(0, 5);
            expect(apex[1]).toBeCloseTo(HOUSE.spring + HOUSE.rise, 5);
            // The outward normal points at the glass: horizontal at the spring, outward-up above.
            expect(archOut(side, 0)[0]).toBeCloseTo(side, 6);
            expect(archOut(side, 4)[1]).toBeGreaterThan(0);
        });
    });

    it('deepens into a haunch at the spring and eases back into the girder', () => {
        expect(ribDepth(0)).toBeCloseTo(RIB.haunch, 6);
        expect(ribDepth(RIB.haunchReach)).toBeCloseTo(RIB.depth, 6);
        expect(ribDepth(ARC.length)).toBeCloseTo(RIB.depth, 6);
        for (let s = 0; s < RIB.haunchReach; s += 0.1) {
            expect(ribDepth(s + 0.1)).toBeLessThanOrEqual(ribDepth(s) + 1e-9);
        }
    });

    it('keeps the inner chord inside the house with its soffit facing the nave', () => {
        [-1, 1].forEach((side) => {
            const samples = ribSamples(side, 30, 8);
            samples.forEach((sm) => {
                expect(Math.abs(sm.inner[0])).toBeLessThan(HOUSE.halfSpan);
                expect(Math.hypot(sm.n[0], sm.n[1])).toBeCloseTo(1, 5);
                if (sm.s >= 0) {
                    const o = archOut(side, sm.s);
                    expect(sm.n[0] * o[0] + sm.n[1] * o[1]).toBeLessThan(0);
                } else {
                    // The bracket under the spring faces in and down, toward the nave's floor.
                    expect(sm.n[0] * side).toBeLessThanOrEqual(1e-9);
                    expect(sm.inner[1]).toBeGreaterThanOrEqual(RIB.foot - 1e-9);
                }
            });
            // Climb runs up the column, then along the rib.
            for (let i = 1; i < samples.length; i += 1) {
                expect(samples[i].climb).toBeGreaterThan(samples[i - 1].climb - 1e-9);
            }
        });
    });
});

describe('the iron', () => {
    const plan = planGarden(QUALITY.High);
    const built = buildIronMeshes(plan, QUALITY.High);

    it('winds every triangle the way its normals face, with finite data', () => {
        ['solid', 'lattice', 'brick'].forEach((key) => {
            expect(built[key].triangleCount).toBeGreaterThan(0);
            expect(windingFaults(built[key])).toBe(0);
            expect(allFinite(built[key])).toBe(true);
        });
    });

    it('turns the column shafts outward and keeps the lattice plates in the ribs’ planes', () => {
        const shafts = verticesOf(built.solid, 'aIron', 1);
        expect(shafts.length).toBeGreaterThan(plan.columns.length * 8);
        shafts.forEach(({ p, n }) => {
            const c = plan.columns.reduce((best, q) => (
                Math.hypot(q.x - p[0], q.z - p[2]) < Math.hypot(best.x - p[0], best.z - p[2]) ? q : best));
            const out = (p[0] - c.x) * n[0] + (p[2] - c.z) * n[2];
            expect(out).toBeGreaterThan(0);
            expect(p[1]).toBeGreaterThanOrEqual(COLUMN.shaftFrom - 1e-6);
            expect(p[1]).toBeLessThanOrEqual(COLUMN.shaftTo + 1e-6);
        });
        const L = built.lattice;
        for (let i = 0; i < L.vertexCount; i += 1) {
            expect(L.normal[i * 3 + 2]).toBeCloseTo(1, 6);
            expect(plan.ribs.some((z) => Math.abs(z - L.position[i * 3 + 2]) < 1e-6)).toBe(true);
            // The web's width is positive and the across coordinate stays within it.
            const w = L.data.aLat[i * 4 + 2];
            const vm = L.data.aLat[i * 4 + 1];
            expect(w).toBeGreaterThan(0.1);
            expect(vm).toBeGreaterThanOrEqual(0);
            expect(vm).toBeLessThanOrEqual(w + 1e-9);
        }
    });

    it('stays inside the glass', () => {
        const P = built.solid.position;
        let worst = -Infinity;
        for (let i = 0; i < P.length; i += 3) {
            const [x, y, z] = [P[i], P[i + 1], P[i + 2]];
            worst = Math.max(worst, Math.abs(x) - HOUSE.halfSpan, z - HOUSE.near, HOUSE.far - z);
            // Above the spring: inside both arcs' circles (the vault is their intersection).
            if (y > HOUSE.spring + 0.2) {
                const dy = y - HOUSE.spring;
                const far = Math.max(Math.hypot(x - ARC.offset, dy), Math.hypot(x + ARC.offset, dy));
                worst = Math.max(worst, far - ARC.radius);
            }
        }
        expect(worst).toBeLessThan(1e-3);
    });

    it('scales its detail with the tier inside the triangle budget', () => {
        let last = 0;
        TIERS.forEach((name) => {
            const b = buildIronMeshes(planGarden(QUALITY[name]), QUALITY[name]);
            const total = b.solid.triangleCount + b.lattice.triangleCount + b.brick.triangleCount;
            expect(total).toBeGreaterThan(30000);
            expect(total).toBeLessThan(150000);
            expect(total).toBeGreaterThanOrEqual(last);
            last = total;
        });
    });
});

describe('the floor', () => {
    const plan = planGarden(QUALITY.High);
    const built = buildFloorMeshes(plan, QUALITY.High);

    it('winds every triangle the way its normals face, with finite data', () => {
        ['pavement', 'stone', 'soil'].forEach((key) => {
            expect(built[key].triangleCount).toBeGreaterThan(0);
            expect(windingFaults(built[key])).toBe(0);
            expect(allFinite(built[key])).toBe(true);
        });
    });

    it('lays the paths, the landing and the soil level and facing up', () => {
        const P = built.pavement.position;
        const N = built.pavement.normal;
        for (let i = 0; i < P.length; i += 3) {
            expect(P[i + 1]).toBe(0);
            expect(N[i + 1]).toBeCloseTo(1, 6);
        }
        const S = built.soil;
        for (let i = 0; i < S.vertexCount; i += 1) expect(S.normal[i * 3 + 1]).toBeCloseTo(1, 6);
    });

    it('turns the canal walls in over the water and keeps its bed under it', () => {
        const walls = verticesOf(built.stone, 'aStone', 1);
        expect(walls.length).toBeGreaterThan(0);
        walls.forEach(({ p, n }) => {
            if (Math.abs(n[0]) > 0.5) expect(n[0] * Math.sign(p[0])).toBeLessThan(-0.99);
            else expect(n[2] * (p[2] - (FLOOR.canal.head + FLOOR.canal.end) / 2)).toBeLessThan(0);
        });
        const bed = verticesOf(built.stone, 'aStone', 2);
        bed.forEach(({ p }) => {
            expect(p[1]).toBeLessThan(FLOOR.canal.water - 0.5);
            expect(p[1]).toBeGreaterThanOrEqual(PAVE.bed - PAVE.dish - 1e-6);
        });
    });

    it('turns the urns outward up to their lip, with soil inside', () => {
        const profile = urnProfile();
        const lip = Math.max(...profile.map(([r]) => r));
        expect(Math.abs(lip - plan.urns[0].radius)).toBeLessThan(0.012);
        expect(Math.max(...profile.map(([, y]) => y))).toBeCloseTo(plan.urns[0].height, 6);
        const urnVerts = verticesOf(built.stone, 'aStone', 3);
        let outward = 0;
        let counted = 0;
        urnVerts.forEach(({ p, n }) => {
            const away = (q) => Math.hypot(q.x - p[0], q.z - p[2]);
            const u = plan.urns.reduce((best, q) => (away(q) < away(best) ? q : best));
            const r = Math.hypot(p[0] - u.x, p[2] - u.z);
            // The outer body (away from the inside of the bowl and the plinth's top).
            if (p[1] > 0.13 && p[1] < 0.88 && r > 0.05) {
                counted += 1;
                if ((p[0] - u.x) * n[0] + (p[2] - u.z) * n[2] > -1e-6) outward += 1;
            }
        });
        expect(counted).toBeGreaterThan(100);
        expect(outward / counted).toBeGreaterThan(0.97);
    });
});

describe('the lanterns', () => {
    const plan = planGarden(QUALITY.High);
    const built = buildLanternMeshes(plan);

    it('builds six panes, a frame, a chain and a halo for every lantern', () => {
        const n = plan.lanterns.length;
        expect(n).toBeGreaterThan(4);
        expect(built.panes.triangleCount).toBe(n * 6 * 2);
        expect(built.halos.triangleCount).toBe(n * 2);
        expect(built.body.triangleCount).toBeGreaterThan(n * 100);
        expect(windingFaults(built.body)).toBe(0);
        expect(windingFaults(built.panes)).toBe(0);
        expect(allFinite(built.body)).toBe(true);
    });

    it('faces every pane out from its flame, and hangs every chain from the rib to the lantern', () => {
        const P = built.panes;
        for (let i = 0; i < P.vertexCount; i += 1) {
            const lamp = P.data.aLamp.slice(i * 4, i * 4 + 3);
            const p = P.position.slice(i * 3, i * 3 + 3);
            const n = P.normal.slice(i * 3, i * 3 + 3);
            expect((p[0] - lamp[0]) * n[0] + (p[2] - lamp[2]) * n[2]).toBeGreaterThan(0);
            expect(p[1] - lamp[1]).toBeGreaterThanOrEqual(LANTERN.paneFrom - 1e-6);
            expect(p[1] - lamp[1]).toBeLessThanOrEqual(LANTERN.paneTo + 1e-6);
        }
        const chains = verticesOf(built.body, 'aKind', 1);
        expect(chains.length).toBe(plan.lanterns.length * 16);
        plan.lanterns.forEach((l) => {
            const [fx, fy, fz] = flameOf(l);
            expect(fy).toBeCloseTo(l.y - LANTERN.flameDrop, 9);
            const mine = chains.filter(({ p }) => Math.hypot(p[0] - fx, p[2] - fz) < 0.05);
            expect(Math.max(...mine.map(({ p }) => p[1]))).toBeCloseTo(l.top, 6);
            expect(Math.min(...mine.map(({ p }) => p[1]))).toBeCloseTo(fy + LANTERN.top, 6);
        });
    });
});

describe('the parts', () => {
    it('build their meshes and dispose everything they built', () => {
        const world = new MoonlitGreenhouseWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        ['iron', 'floor', 'lanterns'].forEach((name) => {
            const part = world.parts[name];
            expect(part.mesh.parent).toBe(world.group);
            const geometries = new Set();
            const materials = new Set();
            part.mesh.traverse((o) => {
                if (!o.isMesh) return;
                expect(o.frustumCulled).toBe(false);
                expect(o.renderOrder).toBeGreaterThan(0);
                geometries.add(o.geometry);
                materials.add(o.material);
            });
            expect(geometries.size).toBe(3);
            let disposed = 0;
            [...geometries, ...materials].forEach((x) => x.addEventListener('dispose', () => { disposed += 1; }));
            part.dispose();
            expect(part.mesh.parent).toBe(null);
            expect(disposed).toBe(geometries.size + materials.size);
        });
        world.dispose();
    });
});
