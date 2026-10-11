/**
 * Moonlit Greenhouse — the plants' geometry.
 *
 * Every frond, leaf and trunk is built in code (moonlit-greenhouse-flora-geometry.js) and merged
 * per species. These tests pin what the eye cannot check from one screenshot: that the palms'
 * fronds point where the canopy's analytic shadow (mgCanopy) thinks they do, that every
 * triangle's normal agrees with its winding (the leaves are double-sided and flip their normal on
 * the back face, so a wound-wrong strip would be lit from behind), that the upper faces of leaves
 * and the outsides of trunks face out, that everything stays inside the glass, that the tiers
 * scale the garden, and that a part disposes what it built.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    KIND, buildFerns, buildLeaves, buildPalms, buildVines, fitArc, understory,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-flora-geometry.js';
import { palmCrownCentre, palmFrondAngle, planGarden } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-plan.js';
import { QUALITY } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { HOUSE, vaultHeightAt } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';
import { MoonlitGreenhouseWorld } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';

const kindOf = (data, i) => Math.floor(data.aInfo[i * 4 + 3] + 0.05);
const idOf = (data, i) => Math.floor(data.aInfo[i * 4 + 1] + 0.5);

/** The share of triangles whose face normal agrees with the mean of their vertex normals. */
function windingAgreement(data) {
    const P = data.position;
    const N = data.normal;
    const I = data.index;
    let agree = 0;
    let total = 0;
    for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
        const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
        const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const area = Math.hypot(f[0], f[1], f[2]);
        if (area < 1e-9) continue;
        const n = [N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]];
        total += 1;
        if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] > 0) agree += 1;
    }
    return agree / Math.max(1, total);
}

function everyFinite(data) {
    return [data.position, data.normal, data.aLeaf, data.aSway, data.aInfo].every((arr) => arr.every(Number.isFinite));
}

describe('moonlit greenhouse: flora geometry', () => {
    const tier = QUALITY.High;
    const plan = planGarden(tier);
    const palms = buildPalms(plan, tier);
    const ferns = buildFerns(plan, tier);
    const leaves = buildLeaves(plan, tier);
    const vines = buildVines(plan, tier);
    const all = {
        'palm fronds': palms.fronds,
        'palm trunks': palms.trunks,
        'fern fronds': ferns.fronds,
        'fern trunks': ferns.trunks,
        'broad leaves': leaves.leaves,
        'urn ferns': leaves.fronds,
        'banana stems': leaves.stems,
        'vine leaves': vines.leaves,
        'basket ferns': vines.fronds,
        'basket iron': vines.iron,
    };

    it('fits a spine to its reach and drop', () => {
        const { bend, length } = fitArc(0.6, 2.5, 1.5);
        expect(bend).toBeGreaterThan(0.6);
        expect(length).toBeGreaterThan(2.5);
        expect(length).toBeLessThan(5);
    });

    it('gives every palm its plan\'s fronds, on the headings the canopy shadow uses', () => {
        plan.palms.forEach((palm, i) => {
            expect(palms.frondHeadings[i]).toHaveLength(palm.fronds);
            palms.frondHeadings[i].forEach((a, k) => expect(a).toBeCloseTo(palmFrondAngle(palm, k), 10));
        });
        // And the geometry follows them: each frond's spine runs out from the crown on its heading.
        const data = palms.fronds;
        const far = new Map();
        for (let i = 0; i < data.vertexCount; i += 1) {
            if (Math.abs(data.aLeaf[i * 4]) > 1e-6) continue; // the spine
            const id = idOf(data, i);
            const along = data.aLeaf[i * 4 + 1];
            const sigma = along / data.aInfo[i * 4];
            if (sigma < 0.3 || sigma > 0.45) continue;
            if (!far.has(id) || far.get(id).along < along) far.set(id, { along, x: data.position[i * 3], z: data.position[i * 3 + 2] });
        }
        let checked = 0;
        plan.palms.forEach((palm, i) => {
            const c = palmCrownCentre(palm);
            for (let k = 0; k < palm.fronds; k += 1) {
                const p = far.get(i * 64 + k);
                expect(p).toBeTruthy();
                const heading = Math.atan2(p.z - c.z, p.x - c.x);
                const diff = Math.atan2(Math.sin(heading - palmFrondAngle(palm, k)), Math.cos(heading - palmFrondAngle(palm, k)));
                expect(Math.abs(diff)).toBeLessThan(0.2);
                checked += 1;
            }
        });
        expect(checked).toBe(plan.palms.reduce((n, p) => n + p.fronds, 0));
    });

    it('winds every triangle the way its normals face, with finite attributes', () => {
        Object.entries(all).forEach(([name, data]) => {
            expect(data.vertexCount, name).toBeGreaterThan(0);
            expect(everyFinite(data), name).toBe(true);
            expect(windingAgreement(data), name).toBeGreaterThan(0.97);
        });
    });

    it('turns the upper faces of fronds and leaves up', () => {
        const meanUp = (data, kinds) => {
            let sum = 0;
            let n = 0;
            for (let i = 0; i < data.vertexCount; i += 1) {
                if (!kinds.includes(kindOf(data, i))) continue;
                if (data.aLeaf[i * 4 + 1] / data.aInfo[i * 4] > 0.5) continue; // before the droop
                sum += data.normal[i * 3 + 1];
                n += 1;
            }
            return sum / Math.max(1, n);
        };
        expect(meanUp(palms.fronds, [KIND.palm])).toBeGreaterThan(0.3);
        expect(meanUp(ferns.fronds, [KIND.groundFern])).toBeGreaterThan(0.3);
        expect(meanUp(ferns.fronds, [KIND.treeFern])).toBeGreaterThan(0.3);
        expect(meanUp(leaves.leaves, [KIND.banana, KIND.monstera])).toBeGreaterThan(0.2);
    });

    it('turns the trunks\' surfaces outward', () => {
        [palms.trunks, ferns.trunks, leaves.stems].forEach((data) => {
            // Each ring's vertices: the normal points away from the ring's centre.
            let outward = 0;
            let total = 0;
            const ring = new Map();
            for (let i = 0; i < data.vertexCount; i += 1) {
                const key = `${idOf(data, i)}:${data.aLeaf[i * 4 + 1].toFixed(4)}`;
                if (!ring.has(key)) ring.set(key, []);
                ring.get(key).push(i);
            }
            ring.forEach((list) => {
                const c = [0, 0, 0];
                list.forEach((i) => { for (let k = 0; k < 3; k += 1) c[k] += data.position[i * 3 + k] / list.length; });
                list.forEach((i) => {
                    let d = 0;
                    for (let k = 0; k < 3; k += 1) d += (data.position[i * 3 + k] - c[k]) * data.normal[i * 3 + k];
                    total += 1;
                    if (d > 0) outward += 1;
                });
            });
            expect(outward / total).toBeGreaterThan(0.97);
        });
    });

    it('keeps everything inside the glass', () => {
        Object.entries(all).forEach(([name, data]) => {
            let outside = 0;
            for (let i = 0; i < data.vertexCount; i += 1) {
                const x = data.position[i * 3];
                const y = data.position[i * 3 + 1];
                if (Math.abs(x) > HOUSE.halfSpan - 0.05 || y > vaultHeightAt(x) + 0.05 || y < -0.4) outside += 1;
            }
            expect(outside, name).toBe(0);
        });
    });

    it('scales the garden with the tier', () => {
        const low = QUALITY.Low;
        const planLow = planGarden(low);
        const count = (t, p) => {
            const b = [buildPalms(p, t), buildFerns(p, t), buildLeaves(p, t), buildVines(p, t)];
            return b.reduce((n, part) => n + Object.values(part).reduce((m, d) => m + (d.vertexCount || 0), 0), 0);
        };
        const nLow = count(low, planLow);
        const nHigh = count(tier, plan);
        expect(nHigh).toBeGreaterThan(nLow * 1.5);
        // Minimal keeps the whole picture (every species), with no baskets or vines.
        const min = QUALITY.Minimal;
        const planMin = planGarden(min);
        expect(buildPalms(planMin, min).fronds.vertexCount).toBeGreaterThan(0);
        expect(buildFerns(planMin, min).fronds.vertexCount).toBeGreaterThan(0);
        expect(buildLeaves(planMin, min).leaves.vertexCount).toBeGreaterThan(0);
        expect(understory(planMin, min).length).toBeGreaterThanOrEqual(planMin.groundFerns.length);
        // High stays within a sane budget for alpha-tested foliage.
        expect(nHigh).toBeLessThan(400000);
    });

    it('builds the parts as meshes with render orders and disposes them', () => {
        const scene = new THREE.Scene();
        const world = new MoonlitGreenhouseWorld({ scene, quality: 'Low' }).build();
        ['palms', 'ferns', 'leaves', 'vines'].forEach((name) => {
            const part = world.parts[name];
            const meshes = [];
            part.mesh.traverse((o) => { if (o.isMesh) meshes.push(o); });
            expect(meshes.length, name).toBeGreaterThan(0);
            expect(part.mesh.renderOrder, name).toBe(0);
            const disposed = [];
            meshes.forEach((m) => {
                expect(m.frustumCulled).toBe(false);
                expect(m.renderOrder).toBeGreaterThanOrEqual(2);
                expect(m.renderOrder).toBeLessThanOrEqual(6);
                m.geometry.addEventListener('dispose', () => disposed.push(m.name));
                m.material.addEventListener('dispose', () => disposed.push(m.material.name));
            });
            expect(part.mesh.parent).toBeTruthy();
            part.dispose();
            expect(part.mesh.parent).toBe(null);
            expect(disposed.length, name).toBe(meshes.length * 2);
        });
        delete world.parts.palms;
        delete world.parts.ferns;
        delete world.parts.leaves;
        delete world.parts.vines;
        world.dispose?.();
    });
});
