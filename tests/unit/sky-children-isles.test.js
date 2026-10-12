/**
 * Sky Children — the isles' geometry (sky-children-isles.js), pinned as relations: every piece
 * grows finite and in one piece of stone kinds; the crown weight never interpolates an id; the
 * spillway's notch is where the Mother Fall's outlet stands; the terraces hold the pool slots the
 * gameplay needs, each brimming below the pool above it; the aqueduct's piers stand on the Twin's
 * crown; and the far isles are built at FAR_UNIT.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FAR_UNIT, GATEWAY, MAT, buildAqueduct, buildBody, buildCascade, buildFarIsles, buildMassif, buildOutcrops, buildSatellites,
    crownHeight, groveSpots, isleAnchors, isleShapes, massifCrownAt, outletAt,
} from '../../src/themes/sky-children/sky-children-isles.js';
import { PLAN } from '../../src/themes/sky-children/sky-children-plan.js';
import { QUALITY } from '../../src/themes/sky-children/sky-children-quality.js';

const finite = (g) => Array.from(g.attributes.position.array).every(Number.isFinite);
const SHAPES = isleShapes(PLAN);

describe('Sky Children isles: the massifs', () => {
    it('grow finite, with a crown weight beside whole-piece stone kinds (no id swept from iron to crown)', () => {
        for (const [name, p] of Object.entries(SHAPES)) {
            const g = buildMassif(p, {
                radial: 40, rings: 30, seed: 3, outletTh: Math.PI / 2 - 0.62, spur: name === 'twin' ? [Math.PI, 0.45, 0.35] : null,
            });
            expect(finite(g), name).toBe(true);
            const mats = new Set(Array.from(g.attributes.aMat.array));
            // Before ensureAttrs folds the crown into the iron kind, a massif names only those two.
            mats.forEach((m) => expect([MAT.iron, MAT.crown], name).toContain(m));
            g.dispose();
        }
    });

    it('cut the spillway: the outlet at the Mother Fall\'s bearing stands in the notch\'s floor', () => {
        const p = SHAPES.spring;
        const terraces = buildCascade(p, { count: 8, radial: 12 });
        const mother = outletAt(terraces.outlets, p.notch.th);
        const aside = outletAt(terraces.outlets, -0.6);
        // (The outlets stand every 0.1 rad round the front: the nearest is within the notch's floor.)
        expect(mother.y).toBeCloseTo(p.lip + 0.6 - p.notch.depth, 1);
        expect(aside.y).toBeGreaterThan(mother.y + p.notch.depth * 0.9);
        // The crown sinks into the notch at the rim there, and not at the opposite shoulder.
        const opts = { seed: 33, asym: 0.2 };
        const unnotched = { ...p, notch: null };
        const sink = (th) => {
            const x = Math.sin(th) * p.radius * 0.97;
            const z = Math.cos(th) * p.radius * 0.97;
            return crownHeight(unnotched, x, z, opts).y - crownHeight(p, x, z, opts).y;
        };
        expect(sink(p.notch.th)).toBeGreaterThan(p.notch.depth * 0.5);
        expect(sink(-p.notch.th)).toBeLessThan(0.01);
        terraces.geometry.dispose();
    });
});

describe('Sky Children isles: the rimstone terraces', () => {
    it('hold enough pool slots, every pool brimming below the one above it', () => {
        for (const [name, count, least] of [['spring', 12, 26], ['twin', 8, 16]]) {
            const p = SHAPES[name];
            const t = buildCascade(p, { count, radial: 16 });
            expect(finite(t.geometry), name).toBe(true);
            expect(t.pools.length, name).toBeGreaterThanOrEqual(least);
            for (let i = 1; i < t.levels.length; i++) expect(t.levels[i], `${name} ${i}`).toBeLessThan(t.levels[i - 1]);
            t.pools.forEach((q) => {
                expect(q.radius, name).toBeGreaterThan(1);
                expect(q.y, name).toBeCloseTo(t.levels[q.level] - 0.05, 9);
            });
            t.geometry.dispose();
        }
    });
});

describe('Sky Children isles: the set pieces', () => {
    it('stands the aqueduct\'s piers on the Twin\'s crown, and ends its channel past the last pier', () => {
        const { aqueduct: aq, spanLip } = isleAnchors(PLAN);
        const built = buildAqueduct(aq.spans, aq.span, aq.lower, aq.upper, aq.depth, aq.groundAt);
        expect(finite(built.geometry)).toBe(true);
        // Every pier but the outer one stands over the crown (the outer one runs on down the cliff).
        const tw = SHAPES.twin;
        for (let i = 0; i < aq.spans; i++) {
            const { on } = massifCrownAt(tw, aq.x - i * aq.span, aq.z, { seed: 71, asym: 0.2, spur: [Math.PI, 0.45, 0.35] });
            expect(on, `pier ${i}`).toBe(true);
        }
        expect(spanLip.x).toBeLessThan(aq.x - (aq.spans - 1) * aq.span);
        expect(spanLip.y).toBeGreaterThan(aq.y + aq.lower + aq.upper);
        built.geometry.dispose();
    });

    it('grows satellites, outcrops and far isles finite', () => {
        const sat = buildSatellites(SHAPES.spring, [[-1, -70, 0, 9], [0.3, -200, 0.8, 5]], { seed: 5 });
        const out = buildOutcrops(SHAPES.spring, 6, { seed: 7 });
        expect(finite(sat)).toBe(true);
        expect(finite(out)).toBe(true);
        const far = buildFarIsles(1);
        expect(far).toHaveLength(5);
        far.forEach((g, i) => {
            expect(finite(g), `variant ${i}`).toBe(true);
            g.computeBoundingBox();
            // Built at FAR_UNIT metres of radius (scaled at placement).
            expect(g.boundingBox.max.x, `variant ${i}`).toBeLessThan(FAR_UNIT * 2);
            g.dispose();
        });
        sat.dispose();
        out.dispose();
    });
});

// Where the built crown actually is (a ray straight down onto the mesh, its facets and all).
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const meshOf = (geometry) => {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.updateMatrixWorld(true);
    return m;
};
const surfaceAt = (mesh, x, z) => {
    ray.set(new THREE.Vector3(x, 5000, z), DOWN);
    const hit = ray.intersectObject(mesh, false)[0];
    return hit ? hit.point.y : -Infinity;
};
const SPRING = { seed: 33, asym: 0.2 };
const TWIN = { seed: 71, asym: 0.2, spur: [Math.PI, 0.45, 0.35] };

describe('Sky Children isles: nothing the builders made floats', () => {
    for (const quality of ['Minimal', 'High', 'Extreme']) {
        it(`stands the gateway, the aqueduct's piers and the trees on the crown as built (${quality})`, () => {
            const tier = QUALITY[quality];
            const { spring, twin } = SHAPES;
            const springMesh = meshOf(buildMassif(spring, {
                radial: tier.isleRadial, rings: tier.isleRings, ...SPRING, outletTh: Math.PI / 2 - 0.62,
            }));
            const twinMesh = meshOf(buildMassif(twin, {
                radial: Math.round(tier.isleRadial * 0.5), rings: Math.round(tier.isleRings * 0.55), ...TWIN,
            }));
            const { arch: a, aqueduct: aq } = isleAnchors(PLAN);
            // The gateway: its footing (2.6 m under the plinth) reaches the ground under every part of
            // the plinth, and the plinth never stands proud of its levelled terrace.
            const [w0, , d0] = GATEWAY.plinth[0];
            for (let i = 0; i <= 12; i++) {
                for (let j = 0; j <= 4; j++) {
                    const x = a.x - w0 / 2 + (w0 * i) / 12;
                    const z = a.z - d0 / 2 + (d0 * j) / 4;
                    const ground = surfaceAt(springMesh, x, z);
                    expect(a.y - 2.6, `gateway footing at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThan(ground);
                    expect(a.y - ground, `gateway plinth at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThan(1.0);
                }
            }
            // The aqueduct: every pier's foot is under the ground across its whole footprint.
            const built = buildAqueduct(aq.spans, aq.span, aq.lower, aq.upper, aq.depth, aq.groundAt);
            const pier = aq.span * 0.22;
            for (let i = 0; i <= aq.spans; i++) {
                const xc = -i * aq.span;
                let low = Infinity;
                for (const dx of [-pier * 0.6, 0, pier * 0.6]) {
                    for (const dz of [-aq.depth * 0.55, 0, aq.depth * 0.55]) low = Math.min(low, aq.groundAt(xc + dx, dz));
                }
                const foot = aq.y + Math.min(0, low - 2.2);
                for (const dx of [-pier / 2, 0, pier / 2]) {
                    for (const dz of [-aq.depth / 2, 0, aq.depth / 2]) {
                        expect(foot, `pier ${i}`).toBeLessThan(surfaceAt(twinMesh, aq.x + xc + dx, aq.z + dz));
                    }
                }
            }
            built.geometry.dispose();
            // The trees: every trunk's foot is under the turf, and none stands in the works.
            const springTrees = groveSpots(spring, tier.groveTrees, 77, SPRING, [[a.x, a.z, 15], [a.x, a.z + 10, 6]]);
            const aqLine = Array.from({ length: 9 }, (_, k) => [aq.x - (k / 8) * aq.spans * aq.span, aq.z, 7.5]);
            const twinTrees = groveSpots(twin, Math.max(4, Math.round(tier.groveTrees * 0.35)), 79, TWIN, aqLine);
            expect(springTrees.length, 'spring trees').toBeGreaterThan(tier.groveTrees * 0.6);
            [[springTrees, springMesh], [twinTrees, twinMesh]].forEach(([spots, mesh]) => {
                spots.forEach(([x, y, z]) => {
                    for (const dx of [-0.4, 0, 0.4]) {
                        for (const dz of [-0.4, 0, 0.4]) expect(y, `tree at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThan(surfaceAt(mesh, x + dx, z + dz));
                    }
                });
            });
            springTrees.forEach(([x, , z, size]) => expect(Math.hypot(x - a.x, z - a.z), 'a tree in the gateway').toBeGreaterThan(15 + size * 0.5 - 1e-9));
            springMesh.geometry.dispose();
            twinMesh.geometry.dispose();
        });
    }

    it('stands the Far Gate\'s plinth on its mesa, end to end', () => {
        const W = PLAN.gate.width;
        const base = meshOf(buildBody({
            top: 0, lip: -60, root: -PLAN.gate.height * 0.55, radius: W * 0.8, terraces: 0, crownPower: 0.25,
        }, {
            radial: 40, rings: 28, seed: 123, asym: 0.08,
        }));
        for (let i = 0; i <= 16; i++) {
            for (let j = 0; j <= 4; j++) {
                const x = -W * 0.625 + (W * 1.25 * i) / 16;
                const z = -W * 0.225 + (W * 0.45 * j) / 4;
                expect(-PLAN.gate.sink, `plinth at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBeLessThan(surfaceAt(base, x, z));
            }
        }
        base.geometry.dispose();
    });
});
