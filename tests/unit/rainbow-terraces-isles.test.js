/**
 * Rainbow Terraces — the isles' geometry (rainbow-terraces-isles.js), pinned as relations: every piece
 * grows finite and in one piece of stone kinds; the crown weight never interpolates an id; the
 * spillway's notch is where the Mother Fall's outlet stands; the terraces hold the pool slots the
 * gameplay needs, each brimming below the pool above it; the aqueduct's piers stand on the Twin's
 * crown; the far isles are built at FAR_UNIT; nothing the builders made floats or is wound
 * inside out (each checked against the crown's mesh as built, on every tier).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BELL_HANG, FAR_GROVE, FAR_RUIN, FAR_SHAPES, FAR_UNIT, GATE_BUILD, GATEWAY, MAT, bodyGround, buildAqueduct, buildBell, buildBody, buildFarGate, buildFarIsles,
    buildGateway, buildGrove, buildMassif, buildOutcrops, buildParapet, buildPinnacles, buildSatellites, crownHeight, gateMesa,
    gatewayHeight, isleAnchors, isleCascade, isleGroves, isleShapes, massifCrownAt, massifGround, outletAt, springOutcrops,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-isles.js';
import { PLAN } from '../../src/themes/rainbow-terraces/rainbow-terraces-plan.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/rainbow-terraces/rainbow-terraces-quality.js';

const finite = (g) => Array.from(g.attributes.position.array).every(Number.isFinite);
const SHAPES = isleShapes(PLAN);
const SPRING = { seed: 33, asym: 0.2 };
const TWIN = { seed: 71, asym: 0.2, spur: [Math.PI, 0.45, 0.35] };

describe('Rainbow Terraces isles: the massifs', () => {
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

    it('hang the Spring Isle\'s root as a mountain turned over: its deepest point off the axis, leaning as it asks', () => {
        const p = SHAPES.spring;
        const g = buildMassif(p, {
            radial: QUALITY.High.isleRadial, rings: QUALITY.High.isleRings, ...SPRING, outletTh: Math.PI / 2 - 0.62,
        });
        const pos = g.attributes.position;
        // The tip is the last vertex grown; it lies along the spine's lean, a quarter radius out.
        const tip = [pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1)];
        expect(tip[1]).toBeCloseTo(p.root - 4, 6);
        expect(Math.hypot(tip[0], tip[2])).toBeCloseTo(p.lean[0] * p.radius, 6);
        expect(Math.cos(Math.atan2(tip[2], tip[0]) - p.lean[1])).toBeGreaterThan(0.999);
        g.dispose();
    });

    it('cut the spillway: the outlet at the Mother Fall\'s bearing stands on the notch\'s floor, every outlet on the rim', () => {
        const p = SHAPES.spring;
        const terraces = isleCascade(PLAN, QUALITY.High, 'spring');
        const mother = outletAt(terraces.outlets, p.notch.th);
        const aside = outletAt(terraces.outlets, -0.6);
        // (The outlets stand every 0.1 rad round the front: the nearest is within the notch's floor.)
        expect(aside.y).toBeGreaterThan(mother.y + p.notch.depth * 0.8);
        // Each leaves from the rim as the crown lays it (its outline's stretch), just over its turf.
        [['spring', SPRING], ['twin', TWIN]].forEach(([name, build]) => {
            isleCascade(PLAN, QUALITY.High, name).outlets.forEach((o) => {
                const r = Math.hypot(o.x, o.z);
                const at = (by) => massifCrownAt(SHAPES[name], (o.x * (r + by)) / r, (o.z * (r + by)) / r, build);
                expect(at(-0.6).on, `${name} outlet ${o.th.toFixed(2)} on the rim`).toBe(true);
                expect(at(0.6).on, `${name} outlet ${o.th.toFixed(2)}`).toBe(false);
                expect(Math.abs(o.y - (at(-0.3).y - 0.1)), `${name} outlet ${o.th.toFixed(2)} on its turf`).toBeLessThan(0.05);
            });
        });
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

describe('Rainbow Terraces isles: the rimstone terraces', () => {
    it('hold enough pool slots, every pool brimming below the one above it, clear of its neighbours', () => {
        for (const [name, least] of [['spring', 26], ['twin', 16]]) {
            const t = isleCascade(PLAN, QUALITY.High, name);
            expect(finite(t.geometry), name).toBe(true);
            expect(t.pools.length, name).toBeGreaterThanOrEqual(least);
            for (let i = 1; i < t.levels.length; i++) expect(t.levels[i], `${name} ${i}`).toBeLessThan(t.levels[i - 1]);
            t.pools.forEach((q, i) => {
                expect(q.radius, name).toBeGreaterThan(1);
                expect(q.y, name).toBeCloseTo(t.levels[q.level] - 0.05, 9);
                t.pools.slice(i + 1).filter((o) => o.level === q.level).forEach((o) => {
                    expect(Math.hypot(o.x - q.x, o.z - q.z), `${name} pools on terrace ${q.level}`).toBeGreaterThanOrEqual(o.radius + q.radius);
                });
            });
            // Every terrace below the first holds a pool (the lowest are the first slots handed out).
            const held = new Set(t.pools.map((q) => q.level));
            expect(held.size, name).toBeGreaterThanOrEqual(t.levels.length - 1);
            t.geometry.dispose();
        }
    });
});

describe('Rainbow Terraces isles: the set pieces', () => {
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
const UP = new THREE.Vector3(0, 1, 0);
// Every face a ray straight down crosses below `from`, top to bottom: [y, entering (an up-facing face)].
const crossings = (mesh, x, z, from) => {
    ray.set(new THREE.Vector3(x, from, z), DOWN);
    return ray.intersectObject(mesh, false).map((h) => [h.point.y, h.face.normal.dot(UP) > 0]);
};
// The triangles of a geometry as [a, b, c] vertex indices.
const triangles = (g) => {
    const n = g.index ? g.index.count : g.attributes.position.count;
    return Array.from({ length: n / 3 }, (_, t) => [0, 1, 2].map((k) => (g.index ? g.index.getX(t * 3 + k) : t * 3 + k)));
};
// The longest run of air a ray straight down meets between `from` (inside the stone) and `to`.
const airUnder = (mesh, x, z, from, to) => {
    let depth = 1;
    let exitAt = null;
    let most = 0;
    crossings(mesh, x, z, from).filter(([y]) => y > to).forEach(([y, enters]) => {
        if (enters && depth === 0 && exitAt !== null) most = Math.max(most, exitAt - y);
        depth = Math.max(0, depth + (enters ? 1 : -1));
        if (!enters && depth === 0) exitAt = y;
    });
    return most;
};
const faceNormal = (pos, [a, b, c]) => {
    const A = new THREE.Vector3().fromBufferAttribute(pos, a);
    const B = new THREE.Vector3().fromBufferAttribute(pos, b);
    const C = new THREE.Vector3().fromBufferAttribute(pos, c);
    return { n: B.sub(A).cross(C.sub(A)), at: A };
};

describe('Rainbow Terraces isles: nothing the builders made floats', () => {
    for (const quality of QUALITY_NAMES) {
        it(`stands the works, the terraces, the groves and the outcrops on the crowns as built (${quality})`, () => {
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
            // The terraces: every dam's curtain reaches the turf below it, every crest stands on the
            // crown, every pool shows over the turf it holds.
            const cascades = { spring: isleCascade(PLAN, tier, 'spring'), twin: isleCascade(PLAN, tier, 'twin') };
            [['spring', springMesh, SPRING], ['twin', twinMesh, TWIN]].forEach(([name, mesh, build]) => {
                const t = cascades[name];
                const pos = t.geometry.attributes.position;
                const { rows, cols } = t;
                for (let d = 0; d < t.levels.length; d++) {
                    for (let k = 0; k < cols; k++) {
                        // (Across the flow the dish runs past its wings into a skirt under the turf.)
                        const sv = (-1 + (2 * k) / (cols - 1)) * 1.12;
                        const lip = d * rows * cols + (rows - 4) * cols + k;
                        const foot = d * rows * cols + (rows - 1) * cols + k;
                        if (Math.abs(sv) <= 1) expect(massifCrownAt(SHAPES[name], pos.getX(lip), pos.getZ(lip), build).on, `${name} dam ${d} crest`).toBe(true);
                        if (Math.abs(sv) <= 0.6) {
                            const turf = surfaceAt(mesh, pos.getX(foot), pos.getZ(foot));
                            expect(pos.getY(foot) - turf, `${name} dam ${d} curtain at ${sv.toFixed(2)}`).toBeLessThan(0.4);
                        }
                    }
                }
                // Every pool shows over the turf it holds, and is held all round: under every point of
                // its rim lies its dish's stone or the turf within a hand of the water, or the turf
                // (or stone) rises over it there.
                // No dam runs through the one above it: a lower dam's lip, where it stands over the turf,
                // keeps clear of the upper dam's lip (it may tuck under that dam's curtain).
                for (let d = 0; d + 1 < t.levels.length; d++) {
                    for (let k = 0; k < cols; k++) {
                        const v = (d + 1) * rows * cols + (rows - 4) * cols + k;
                        const x = pos.getX(v);
                        const z = pos.getZ(v);
                        if (Math.abs((-1 + (2 * k) / (cols - 1)) * 1.12) <= 1 && pos.getY(v) > surfaceAt(mesh, x, z)) {
                            for (let k2 = 0; k2 < cols; k2++) {
                                const w = d * rows * cols + (rows - 4) * cols + k2;
                                expect(Math.hypot(pos.getX(w) - x, pos.getZ(w) - z), `${name} dams ${d} and ${d + 1} cross`).toBeGreaterThan(0.4);
                            }
                        }
                    }
                }
                const dams = meshOf(t.geometry);
                t.pools.forEach((q) => {
                    expect(q.y - surfaceAt(mesh, q.x, q.z), `${name} pool on terrace ${q.level}`).toBeGreaterThan(-0.3);
                    for (let k = 0; k < 24; k++) {
                        const ang = (k / 24) * Math.PI * 2;
                        const x = q.x + Math.cos(ang) * q.radius * 1.11;
                        const z = q.z + Math.sin(ang) * q.radius * 1.11;
                        ray.set(new THREE.Vector3(x, q.y + 0.001, z), UP);
                        if (ray.intersectObjects([mesh, dams], false).length) continue;
                        ray.set(new THREE.Vector3(x, q.y + 0.001, z), DOWN);
                        const under = ray.intersectObjects([mesh, dams], false)[0];
                        expect(under ? q.y - under.point.y : Infinity, `${name} pool on terrace ${q.level} held at ${k}`).toBeLessThan(0.3);
                    }
                });
            });
            // The groves: every trunk's foot (its whole base) is under the turf, every tree keeps its
            // own ground, and none stands in the works.
            const groves = isleGroves(PLAN, tier, cascades);
            expect(groves.spring.length, 'spring trees').toBeGreaterThan(tier.groveTrees * 0.6);
            [[groves.spring, springMesh], [groves.twin, twinMesh]].forEach(([spots, mesh]) => {
                spots.forEach(([x, y, z, size], i) => {
                    for (let k = 0; k <= 8; k++) {
                        const r = k === 8 ? 0 : size * 0.12;
                        const b = (k / 8) * Math.PI * 2;
                        expect(y, `tree at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThan(surfaceAt(mesh, x + Math.cos(b) * r, z + Math.sin(b) * r));
                    }
                    spots.slice(i + 1).forEach(([ox, , oz, os]) => {
                        expect(Math.hypot(ox - x, oz - z), 'two trees fused').toBeGreaterThanOrEqual(0.45 * (size + os) - 1e-9);
                    });
                });
            });
            groves.spring.forEach(([x, , z, size]) => expect(Math.hypot(x - a.x, z - a.z), 'a tree in the gateway').toBeGreaterThan(15 + size * 0.5 - 1e-9));
            // ... nor behind its opening on the eye's line (a trunk in the doorway, under the bell).
            const l = Math.hypot(0.063, 0.994);
            groves.spring.forEach(([x, , z, size]) => {
                const along = -((x - a.x) * 0.063 + (z - a.z) * 0.994) / l;
                const off = Math.abs((x - a.x) * 0.994 - (z - a.z) * 0.063) / l;
                if (along > 0 && along < 60) expect(off, 'a tree behind the gateway\'s opening').toBeGreaterThan(5.5 + size * 0.6);
            });
            // The outcrops: bedded, the whole of each underside under the turf, clear of the terraces.
            const rocks = springOutcrops(PLAN, tier, cascades.spring);
            const rp = rocks.attributes.position;
            const PER = 60;
            for (let b = 0; b < rp.count / PER; b++) {
                let cx = 0;
                let cz = 0;
                for (let v = b * PER; v < (b + 1) * PER; v++) {
                    cx += rp.getX(v) / PER;
                    cz += rp.getZ(v) / PER;
                }
                let r = 0;
                for (let v = b * PER; v < (b + 1) * PER; v++) r = Math.max(r, Math.hypot(rp.getX(v) - cx, rp.getZ(v) - cz));
                const G = (x, z) => massifGround(spring, x, z, SPRING);
                const up = new THREE.Vector3(-(G(cx + r, cz) - G(cx - r, cz)) / (2 * r), 1, -(G(cx, cz + r) - G(cx, cz - r)) / (2 * r)).normalize();
                // (Sunk 0.22 of its size under the turf at its centre, as buildOutcrops beds it.)
                const cy = G(cx, cz) - 0.22 * r;
                for (let v = b * PER; v < (b + 1) * PER; v++) {
                    const local = (rp.getX(v) - cx) * up.x + (rp.getY(v) - cy) * up.y + (rp.getZ(v) - cz) * up.z;
                    if (local < -0.12 * r) {
                        expect(rp.getY(v), `outcrop ${b}'s underside`).toBeLessThan(surfaceAt(springMesh, rp.getX(v), rp.getZ(v)));
                    } else if (local <= 0) {
                        // ... and its widest course at the turf, not standing over it downhill.
                        expect(rp.getY(v), `outcrop ${b}'s widest course`).toBeLessThan(surfaceAt(springMesh, rp.getX(v), rp.getZ(v)) + 0.15);
                    }
                }
                cascades.spring.pools.forEach((q) => expect(Math.hypot(q.x - cx, q.z - cz), `outcrop ${b} in a pool`).toBeGreaterThan(q.radius));
            }
            [rocks, cascades.spring.geometry, cascades.twin.geometry, springMesh.geometry, twinMesh.geometry].forEach((g) => g.dispose());
        }, 60000);
    }

    it('lays each tier of the aqueduct as one wall: no air under its course or its channel, even over the broken bay', () => {
        const { aqueduct: aq } = isleAnchors(PLAN);
        const built = buildAqueduct(aq.spans, aq.span, aq.lower, aq.upper, aq.depth, aq.groundAt);
        const wall = meshOf(built.geometry);
        const L = aq.spans * aq.span;
        const top = aq.lower + 0.9 + aq.upper;
        for (let x = -L + 0.5; x < -0.5; x += 0.5) {
            expect(airUnder(wall, x, 0, top + 1.0, top - 0.4), `air under the channel at ${x.toFixed(1)}`).toBe(0);
            expect(airUnder(wall, x, 0, aq.lower + 0.8, aq.lower - 0.4), `air under the course at ${x.toFixed(1)}`).toBe(0);
        }
        built.geometry.dispose();
    });

    it('stacks the gateway: each course on the one below, the piers on the top, the arch on its imposts, the bell in the keystone', () => {
        const G = GATEWAY;
        for (let k = 1; k < G.plinth.length; k++) {
            expect(G.plinth[k][0], `course ${k}`).toBeLessThan(G.plinth[k - 1][0]);
            expect(G.plinth[k][2], `course ${k}`).toBeLessThan(G.plinth[k - 1][2]);
        }
        const [wTop, , dTop] = G.plinth[G.plinth.length - 1];
        expect(G.span / 2 + G.pier).toBeLessThanOrEqual(wTop / 2);
        expect(G.pier * 0.95).toBeLessThanOrEqual(dTop);
        const gate = meshOf(buildGateway());
        const top = G.plinth.reduce((y, [, h]) => y + h, 0);
        const spring = top + G.pierH + 0.8;
        // Straight down from just inside each springer's foot: the impost's top at once.
        for (const x of [-(G.span / 2 + G.ring / 2), G.span / 2 + G.ring / 2]) {
            const [[y, enters]] = crossings(gate, x, 0, spring + 0.05);
            expect(enters).toBe(true);
            expect(spring - y, 'a springer off its impost').toBeLessThan(0.06);
        }
        // Down through every pier (from inside its impost): no air until the ground under the footing.
        [[-(G.span / 2 + G.pier / 2), 0, spring - 0.5], [G.span / 2 + G.pier / 2, 0, spring - 0.5]].forEach(([x, z, from]) => {
            expect(airUnder(gate, x, z, from, -2.5), `air under the piece at ${x}`).toBeLessThan(0.01);
        });
        // The bell hangs from the keystone's soffit (its pivot), its stem up into the stone, and at
        // any swing the world gives it (0.9 rad on a T-spin) its body stays under the soffit.
        const { arch, bell } = isleAnchors(PLAN);
        const h = gatewayHeight();
        expect(bell.y).toBeCloseTo(arch.y + h.intrados, 6);
        expect(bell.y + 0.4).toBeLessThan(arch.y + h.top);
        const body = buildBell(4.6);
        const bp = body.attributes.position;
        const v = new THREE.Vector3();
        for (let a = -0.9; a <= 0.9001; a += 0.1) {
            const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
            for (let k = 0; k < bp.count; k++) {
                if (bp.getY(k) <= -BELL_HANG + 0.03) {
                    v.fromBufferAttribute(bp, k).applyQuaternion(q);
                    if (Math.abs(v.z) < G.depth * 0.6) expect(v.y, `the bell in the keystone at ${a.toFixed(1)} rad`).toBeLessThan(0);
                }
            }
        }
        body.dispose();
        gate.geometry.dispose();
    });

    it('stands the Far Gate\'s plinth on its mesa, end to end, its fallen blocks bedded in the turf', () => {
        const W = PLAN.gate.width;
        const mesa = gateMesa(PLAN.gate);
        const base = meshOf(buildBody(mesa, {
            radial: 40, rings: 28, ...GATE_BUILD, frontCut: 0.04,
        }));
        for (let i = 0; i <= 16; i++) {
            for (let j = 0; j <= 4; j++) {
                const x = -W * 0.625 + (W * 1.25 * i) / 16;
                const z = -W * 0.225 + (W * 0.45 * j) / 4;
                expect(-PLAN.gate.sink, `plinth at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBeLessThan(surfaceAt(base, x, z));
            }
        }
        const { profile } = buildFarGate(W, PLAN.gate.height, {
            groundAt: (x, z) => bodyGround(mesa, x, z, GATE_BUILD) + PLAN.gate.sink - 4,
        });
        expect(profile.undersides.length).toBeGreaterThanOrEqual(12);
        profile.undersides.forEach(([x, y, z]) => {
            expect(y - PLAN.gate.sink, `a fallen block's corner at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBeLessThan(surfaceAt(base, x, z));
        });
        base.geometry.dispose();
    });

    it('stands the far isles\' grove and ruined pier on their crowns as built, at every detail', () => {
        for (const detail of [1, 1.2]) {
            const radial = Math.max(10, Math.round(14 * detail));
            const rings = Math.max(8, Math.round(10 * detail));
            const crown = ({ p, build }) => meshOf(buildMassif(p, { radial, rings, ...build }));
            const grove = FAR_SHAPES[3];
            const groveMesh = crown(grove);
            FAR_GROVE.forEach(([x, z, size]) => {
                const foot = crownHeight(grove.p, x, z, grove.build).y - 1;
                for (let k = 0; k <= 8; k++) {
                    const r = k === 8 ? 0 : size * 0.12;
                    const b = (k / 8) * Math.PI * 2;
                    expect(foot, `far tree at ${x}, ${z}`).toBeLessThan(surfaceAt(groveMesh, x + Math.cos(b) * r, z + Math.sin(b) * r));
                }
            });
            const ruin = FAR_SHAPES[4];
            const ruinMesh = crown(ruin);
            const [x, z, w] = FAR_RUIN;
            const g = (gx, gz) => crownHeight(ruin.p, gx, gz, ruin.build).y;
            const footing = Math.min(g(x - w / 2, z), g(x + w / 2, z), g(x, z - w / 2), g(x, z + w / 2)) - 3;
            for (const dx of [-w / 2, 0, w / 2]) {
                for (const dz of [-w / 2, 0, w / 2]) expect(footing, 'the far pier\'s footing').toBeLessThan(surfaceAt(ruinMesh, x + dx, z + dz));
            }
            [groveMesh, ruinMesh].forEach((m) => m.geometry.dispose());
        }
    });

    it('lays the Far Gate up solid: a real attic, no air under any course over the arch, the weir in its notch', () => {
        const W = PLAN.gate.width;
        const H = PLAN.gate.height;
        const { geometry, weir, profile: P } = buildFarGate(W, H);
        expect(H - P.atticBase, 'the attic').toBeGreaterThan(H * 0.08);
        expect(P.notchY - P.atticBase, 'the notch\'s floor').toBeGreaterThan(H * 0.05);
        expect(weir[1]).toBe(P.notchY);
        const gate = meshOf(geometry);
        // Down from just under the top line to the floor the fill stands on: never more air than a
        // voussoir's joint.
        for (let x = -W * 0.48; x <= W * 0.3; x += W * 0.01) {
            for (const z of [0, W * 0.06]) {
                expect(airUnder(gate, x, z, P.topAt(x) - 0.5, P.floorAt(x) + 2), `air in the gate at ${x.toFixed(0)}`).toBeLessThan(12);
            }
        }
        // The springers and the wall stand on their imposts (no air over them), and the drape's fill
        // lies on the keystones' own tops (no lens of air under the weir; the joints are slots).
        const UPWARD = new THREE.Vector3(0, 1, 0);
        for (let ax = W * 0.2; ax <= W * 0.5; ax += 10) {
            for (const sx of [-1, 1]) {
                for (const z of (ax <= W * 0.27 ? [-0.15, 0, 0.08, 0.16] : [-0.15, 0, 0.08])) {
                    ray.set(new THREE.Vector3(ax * sx, P.spring + 0.05, z * W), UPWARD);
                    const hits = ray.intersectObject(gate, false);
                    const inside = hits.some((h) => h.point.y < hits[0].point.y + 0.01 && h.face.normal.y > 0);
                    expect(inside || hits[0].point.y - P.spring < 0.5, `air over the impost at ${(ax * sx).toFixed(0)}, ${z}W`).toBe(true);
                }
            }
        }
        for (let x = -100; x <= 100; x += 5) {
            expect(airUnder(gate, x, W * 0.16, P.notchY - 0.5, P.floorAt(x) - 5), `a lens under the weir at ${x}`).toBeLessThan(0.3);
        }
        // The threshold's slab keeps behind the top course's front edge (0.18 W).
        const pos = geometry.attributes.position;
        const mat = geometry.attributes.aMat;
        for (let v = 0; v < pos.count; v++) {
            if (mat.getX(v) === MAT.travertine && pos.getY(v) < H * 0.2) expect(pos.getZ(v), 'the threshold').toBeLessThanOrEqual(W * 0.18);
        }
        // The weir's lip is on the notch's face, open sky over it.
        ray.set(new THREE.Vector3(0, weir[1] - 5, W), new THREE.Vector3(0, 0, -1));
        expect(ray.intersectObject(gate, false)[0].point.z).toBeCloseTo(weir[2], 3);
        ray.set(new THREE.Vector3(0, weir[1] + 5, W), new THREE.Vector3(0, 0, -1));
        expect(ray.intersectObject(gate, false)).toHaveLength(0);
        geometry.dispose();
    });
});

// Each edge of a consistently wound closed piece is walked once each way; a closed piece faces
// out when its signed volume is positive.
const pieces = (g) => {
    const pos = g.attributes.position;
    const key = (v) => `${Math.round(pos.getX(v) * 1e3)},${Math.round(pos.getY(v) * 1e3)},${Math.round(pos.getZ(v) * 1e3)}`;
    const ids = new Map();
    const id = Array.from({ length: pos.count }, (_, v) => {
        const k = key(v);
        if (!ids.has(k)) ids.set(k, ids.size);
        return ids.get(k);
    });
    const parent = Array.from({ length: ids.size }, (_, i) => i);
    const find = (i) => {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
    };
    // (A lathe's triangles at its axis have collapsed to a line: they bound nothing.)
    const tris = triangles(g).filter(([a, b, c]) => id[a] !== id[b] && id[b] !== id[c] && id[a] !== id[c]);
    tris.forEach(([a, b, c]) => {
        parent[find(id[a])] = find(id[b]);
        parent[find(id[b])] = find(id[c]);
    });
    const out = new Map();
    tris.forEach((t) => {
        const r = find(id[t[0]]);
        if (!out.has(r)) out.set(r, { edges: new Map(), volume: 0 });
        const p = out.get(r);
        const [A, B, C] = t.map((v) => new THREE.Vector3().fromBufferAttribute(pos, v));
        p.volume += A.dot(B.clone().cross(C)) / 6;
        t.forEach((v, k) => {
            const e = `${id[v]}>${id[t[(k + 1) % 3]]}`;
            p.edges.set(e, (p.edges.get(e) || 0) + 1);
        });
    });
    return [...out.values()].map(({ edges, volume }) => {
        const closed = [...edges.keys()].every((e) => edges.has(e.split('>').reverse().join('>')));
        const consistent = [...edges.values()].every((n) => n === 1);
        return { closed, consistent, volume };
    });
};

describe('Rainbow Terraces isles: every stone faces out', () => {
    it.each(['Minimal', 'High', 'Extreme'])('winds every closed piece of every builder one way, outward (%s)', (quality) => {
        const tier = QUALITY[quality];
        const cascades = { spring: isleCascade(PLAN, tier, 'spring'), twin: isleCascade(PLAN, tier, 'twin') };
        const { aqueduct: aq } = isleAnchors(PLAN);
        const builds = {
            spring: buildMassif(SHAPES.spring, {
                radial: tier.isleRadial, rings: tier.isleRings, ...SPRING, outletTh: Math.PI / 2 - 0.62,
            }),
            twin: buildMassif(SHAPES.twin, { radial: Math.round(tier.isleRadial * 0.5), rings: Math.round(tier.isleRings * 0.55), ...TWIN }),
            mesa: buildBody(gateMesa(PLAN.gate), {
                radial: 40, rings: 28, ...GATE_BUILD, frontCut: 0.04,
            }),
            gateway: buildGateway(),
            aqueduct: buildAqueduct(aq.spans, aq.span, aq.lower, aq.upper, aq.depth, aq.groundAt).geometry,
            farGate: buildFarGate(PLAN.gate.width, PLAN.gate.height).geometry,
            grove: buildGrove(isleGroves(PLAN, tier, cascades).spring, 41),
            outcrops: springOutcrops(PLAN, tier, cascades.spring),
            satellites: buildSatellites(SHAPES.spring, [[-1.05, -70, -0.2, 9], [-0.9, -150, 0.6, 7]], { seed: 5 }),
            bell: buildBell(4.6),
            parapetL: buildParapet(true),
            parapetR: buildParapet(false),
            ...Object.fromEntries(buildFarIsles(1).map((g, i) => [`far${i}`, g])),
        };
        // (Where a builder's solids touch, their seams weld them into one piece walked twice along
        // the seam: only the one-piece builds can show a fan or a patch turned over that way.)
        const onePiece = ['spring', 'twin', 'mesa', 'bell', 'outcrops', 'satellites', 'far0', 'far1', 'far2'];
        Object.entries(builds).forEach(([name, g]) => {
            const closed = pieces(g).filter((p) => p.closed);
            expect(closed.length, name).toBeGreaterThan(0);
            closed.forEach((p) => {
                if (onePiece.includes(name)) expect(p.consistent, `${name}: a piece wound both ways`).toBe(true);
                expect(p.volume, `${name}: a piece inside out`).toBeGreaterThan(0);
            });
            g.dispose();
        });
        Object.values(cascades).forEach((t) => t.geometry.dispose());
    });

    it('turns the open pieces out too: the pinnacles, the dams\' crests and curtains', () => {
        // The pinnacles: their faces look away from their own axes.
        const outward = (g, axisAt) => {
            const pos = g.attributes.position;
            const tris = triangles(g);
            const away = tris.filter((t) => {
                const { n, at } = faceNormal(pos, t);
                const [ax, az] = axisAt(at);
                return n.x * (at.x - ax) + n.z * (at.z - az) > 0;
            });
            return away.length / tris.length;
        };
        const mesa = gateMesa(PLAN.gate);
        const spires = buildPinnacles(mesa, {
            count: 1, seed: 126, radial: 8, rings: 12,
        });
        const sp = spires.attributes.position;
        let cx = 0;
        let cz = 0;
        for (let v = 0; v < sp.count; v++) {
            cx += sp.getX(v) / sp.count;
            cz += sp.getZ(v) / sp.count;
        }
        expect(outward(spires, () => [cx, cz])).toBeGreaterThan(0.9);
        // The dams: the crest and the curtain look up and downstream (the eye's side), not down.
        const t = isleCascade(PLAN, QUALITY.High, 'spring');
        const pos = t.geometry.attributes.position;
        const tris = triangles(t.geometry);
        const up = tris.filter((tri) => faceNormal(pos, tri).n.y > 0).length;
        expect(up / tris.length).toBeGreaterThan(0.75);
        // The runnel down the notch (after the dams' vertices) faces the sky, every triangle of it.
        const damVerts = t.levels.length * t.rows * t.cols;
        const runnel = tris.filter((tri) => tri[0] >= damVerts);
        expect(runnel.length).toBeGreaterThan(0);
        runnel.forEach((tri) => expect(faceNormal(pos, tri).n.y, 'the runnel').toBeGreaterThan(0));
        [spires, t.geometry].forEach((g) => g.dispose());
    });
});
