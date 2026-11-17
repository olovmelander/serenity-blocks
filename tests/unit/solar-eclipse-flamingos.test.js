/**
 * Solar Eclipse — the flamingos, without a renderer: the model against Blender's own rig, the
 * flights and the wading flock as pure functions of the clock and the layout, and the world's
 * part that draws them.
 *
 * Gated: the skinning twin stays on Blender's vertices; blended poses keep their joints together;
 * the planner is deterministic and a bird's place and pose come from its identity, never from the
 * cap or the list it is in; no bird appears or vanishes inside the frame (only beyond its edges or
 * behind the card); the flock stands clear of the card's middle and of the sun's column, the
 * flights cross the free space left of the card under the sun and above its image in the water;
 * every image in the water lies below the horizon and nothing stands under the water; nothing
 * jumps from one frame to the next. The look (colours, sizes, light) is not pinned.
 */
import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ACT, BIRD_FLOATS, BONES, FLIGHT, FLIGHT_LONGEST, FLOCK, ROWS_PER_BIRD, flamingoModel, flamingoPose,
    flamingoVertex, flightBird, flightPlan, flightWeights, flockBird, flockBirdAt, flockSpan, lowestToe,
    projectRest, restView, writeBirds,
} from '../../src/themes/solar-eclipse/solar-eclipse-flamingo-flight.js';
import { MOST_BIRDS } from '../../src/themes/solar-eclipse/solar-eclipse-flamingos.js';
import { SE_FLAMINGO } from '../../src/themes/solar-eclipse/solar-eclipse-flamingo-model.js';
import { MIRROR, WORLD } from '../../src/themes/solar-eclipse/solar-eclipse-core.js';
import { QUALITY } from '../../src/themes/solar-eclipse/solar-eclipse-quality.js';
import { cardUnion, fallbackLayout } from '../../src/themes/solar-eclipse/solar-eclipse-composition.js';
import { REST_RIG, SolarEclipseWorld, fovForAspect } from '../../src/themes/solar-eclipse/solar-eclipse-world.js';

const ROW = SE_FLAMINGO.rows;
const SCREENS = [[1600, 900], [1920, 1080], [2560, 1080], [1440, 1080], [390, 844]];
const worlds = [];

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
});

/** A composed world (no renderer) for a screen, and its view at rest. */
function composed(width, height, quality = 'High') {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SolarEclipseWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    const view = restView({ fov: world.fov(), aspect, pitch: world.pitch() });
    const layout = world.layoutNow();
    const span = flockSpan(view, layout, world.sunScreenX);
    return {
        world, camera, view, layout, span, card: cardUnion(layout),
    };
}

const pose1 = (row) => flamingoPose(new Float32Array([row, 1]), 1);
const deformAt = (pose, b, p) => {
    const o = b * 8;
    const [x, y, z, w] = [pose[o], pose[o + 1], pose[o + 2], pose[o + 3]];
    const v = [p[0], p[1], p[2]];
    const cx = y * v[2] - z * v[1] + w * v[0];
    const cy = z * v[0] - x * v[2] + w * v[1];
    const cz = x * v[1] - y * v[0] + w * v[2];
    const r = [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
    return r.map((c, k) => c * pose[o + 7] + pose[o + 4 + k]);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the flamingo model', () => {
    it('decodes the mesh Blender wrote, small enough to draw by the dozen', () => {
        const m = flamingoModel();
        expect(m.positions.length).toBe(SE_FLAMINGO.vertexCount * 3);
        expect(m.index.length).toBe(SE_FLAMINGO.triangleCount * 3);
        expect(SE_FLAMINGO.triangleCount).toBeLessThan(2500);
        expect(BONES).toBe(16);
        // A greater flamingo's span and its flying length, bill to toes.
        expect(SE_FLAMINGO.span).toBeGreaterThan(1.4);
        expect(SE_FLAMINGO.span).toBeLessThan(1.7);
        expect(SE_FLAMINGO.length).toBeGreaterThan(1.5);
        for (let i = 0; i < SE_FLAMINGO.vertexCount; i += 1) {
            expect(m.skin[i * 4]).toBeLessThan(BONES);
            expect(m.skin[i * 4 + 1]).toBeLessThan(BONES);
        }
    });

    it('skins every vertex where Blender\'s own rig put it', () => {
        expect(SE_FLAMINGO.checks.length).toBeGreaterThan(20);
        SE_FLAMINGO.checks.forEach((c) => {
            const v = flamingoVertex(c.vertex, pose1(c.row));
            expect(dist(v, c.at), `vertex ${c.vertex} row ${c.row}`).toBeLessThan(3e-4);
        });
    });

    it('winds every part outward (its faces lit from the side they face)', () => {
        const m = flamingoModel();
        // The parts share no vertex: each joined piece (the body, the neck and head, the bill, a
        // leg, a wing) is a part. Union-find over the triangles.
        const up = Int32Array.from({ length: m.vertexCount }, (_, i) => i);
        const find = (i) => {
            let r = i;
            while (up[r] !== r) r = up[r];
            return r;
        };
        for (let t = 0; t < m.index.length; t += 3) {
            const a = find(m.index[t]);
            [m.index[t + 1], m.index[t + 2]].forEach((v) => { up[find(v)] = a; });
        }
        const parts = new Map();
        for (let t = 0; t < m.index.length; t += 3) {
            const key = find(m.index[t]);
            if (!parts.has(key)) parts.set(key, []);
            parts.get(key).push([m.index[t], m.index[t + 1], m.index[t + 2]]
                .map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]));
        }
        expect(parts.size).toBe(7);
        // Each part's signed volume about its own middle: positive when its faces look outward.
        parts.forEach((tris, key) => {
            const mid = [0, 0, 0];
            tris.forEach((p) => p.forEach((q) => q.forEach((v, k) => { mid[k] += v / (tris.length * 3); })));
            let volume = 0;
            tris.forEach(([a, b, c]) => {
                const u = a.map((v, k) => v - mid[k]);
                const e1 = b.map((v, k) => v - a[k]);
                const e2 = c.map((v, k) => v - a[k]);
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
                volume += (u[0] * n[0] + u[1] * n[1] + u[2] * n[2]) / 6;
            });
            expect(volume, `part at vertex ${key}`).toBeGreaterThan(0);
        });
    });

    it('keeps every joint together in a blend of very different poses', () => {
        const blends = [
            [ROW.Stand, 0.5, ROW.FeedL, 0.5],
            [ROW.Alert, 0.3, ROW.Stretch, 0.7],
            [ROW.Walk + 2, 0.6, ROW.Rest, 0.4],
            [ROW.Flap + 3, 0.5, ROW.Glide, 0.5],
        ];
        blends.forEach((w) => {
            const pose = flamingoPose(new Float32Array(w), 2);
            for (let b = 0; b < BONES; b += 1) {
                const p = SE_FLAMINGO.parents[b];
                if (p < 0) continue;
                const h = SE_FLAMINGO.pivots[b];
                expect(dist(deformAt(pose, p, h), deformAt(pose, b, h)), `${w} bone ${b}`).toBeLessThan(0.004);
            }
        });
    });

    it('stands its feet on the ground in every pose on the water, its bill in the water when it feeds', () => {
        [ROW.Stand, ROW.Alert, ROW.Stretch, ROW.FeedL, ROW.FeedR, ROW.Rest, ROW.Walk, ROW.Walk + 4].forEach((row) => {
            const pose = pose1(row);
            const low = lowestToe(pose);
            const m = flamingoModel();
            let lowest = Infinity;
            for (let i = 0; i < m.vertexCount; i += 1) lowest = Math.min(lowest, flamingoVertex(i, pose)[1]);
            // Nothing reaches more than a few centimetres below the lower foot (a feeding bill
            // dips into the water: the vertex stage lays it on the surface).
            expect(lowest - low, `row ${row}`).toBeGreaterThan(-0.08);
        });
        // The checks list each row's telling vertices in one order: the bill's tip is the third.
        const feed = pose1(ROW.FeedL);
        const tip = SE_FLAMINGO.checks.filter((c) => c.row === ROW.FeedL)[2];
        const at = flamingoVertex(tip.vertex, feed);
        expect(at[1] - lowestToe(feed)).toBeLessThan(0.06);
    });
});

describe('the flights', () => {
    it('plans the same flight from the same identity, whatever came before', () => {
        const { view } = composed(1600, 900);
        const a = flightPlan(5, view);
        flightPlan(9, view);
        const b = flightPlan(5, view);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        // A bird's place comes from the flight and its rank, not from how many the tier keeps.
        const few = flightPlan(5, view, 4);
        const t = (a.start + a.end) / 2;
        few.birds.forEach((bird, i) => {
            const s = flightBird(few, bird, t);
            const s2 = flightBird(a, a.birds[i], t);
            expect(s.id).toBe(s2.id);
            expect(s.size).toBe(s2.size);
            expect(s.beat).toBe(s2.beat);
        });
    });

    it('sends one flight a slot, 5 to 12 birds, crossing in about 12 to 30 s, never two at once', () => {
        const { view } = composed(1600, 900);
        let previous = null;
        for (let k = -3; k < 40; k += 1) {
            const p = flightPlan(k, view);
            expect(p.birds.length).toBeGreaterThanOrEqual(FLIGHT.birds[0]);
            expect(p.birds.length).toBeLessThanOrEqual(FLIGHT.birds[1]);
            const seconds = p.end - p.start;
            expect(seconds).toBeGreaterThan(11);
            expect(seconds).toBeLessThan(30);
            if (previous) {
                expect(p.start - previous.start).toBeGreaterThan(FLIGHT.period - FLIGHT.jitter - 1e-9);
                expect(p.start).toBeGreaterThan(previous.end);
            }
            previous = p;
        }
        // On a very wide frame a flight flies faster rather than outstay its slot.
        const wide = composed(3840, 1080).view;
        for (let k = 0; k < 20; k += 1) {
            const plan = flightPlan(k, wide);
            expect(plan.end - plan.start).toBeLessThanOrEqual(FLIGHT_LONGEST + 1e-6);
        }
    });

    it('lets no bird appear or vanish inside the frame: each comes in beyond an edge and leaves beyond one', () => {
        SCREENS.forEach(([w, h]) => {
            const { view } = composed(w, h);
            for (let k = 0; k < 12; k += 1) {
                const p = flightPlan(k, view);
                [p.start, p.end].forEach((t) => {
                    p.birds.forEach((b) => {
                        const s = flightBird(p, b, t);
                        const q = projectRest(view, s.place);
                        // Its half length on screen, as a share of the frame's width.
                        const half = (1.0 * s.size) / Math.max(q.depth, 1) / (2 * view.tanH);
                        const outside = q.x < -half || q.x > 1 + half;
                        expect(outside, `${w}x${h} flight ${k} bird ${b.rank} at ${q.x.toFixed(3)}`).toBe(true);
                    });
                });
            }
        });
    });

    it('crosses the free space left of the card under the sun and over its image in the water', () => {
        const { world, view, card } = composed(1600, 900);
        // (The sun's radius as a share of the frame's height.)
        const sunBottom = world.sunScreenY + world.sunRadius() / (world.fov() * (Math.PI / 180));
        const sunImageTop = 2 * WORLD.horizonY - sunBottom;
        const seen = [];
        for (let k = 0; k < 16; k += 1) {
            const p = flightPlan(k, view);
            for (let t = p.start; t <= p.end; t += 0.25) {
                p.birds.forEach((b) => {
                    const s = flightBird(p, b, t);
                    const q = projectRest(view, s.place);
                    if (q.x < 0 || q.x > card.x0) return;
                    seen.push(q.x);
                    const image = projectRest(view, [s.place[0], -2 * MIRROR.eye - s.place[1], s.place[2]]);
                    expect(q.y).toBeGreaterThan(sunBottom);
                    expect(q.y).toBeLessThan(WORLD.horizonY);
                    expect(image.y).toBeGreaterThan(WORLD.horizonY);
                    expect(image.y).toBeLessThan(sunImageTop);
                });
            }
        }
        expect(seen.length).toBeGreaterThan(500);
    });

    it('beats each bird at its own pace, the rows weighing one', () => {
        const w = flightWeights(3.37, 0.25);
        expect(w[1] + w[3] + w[5]).toBeCloseTo(1, 6);
        expect(w[4]).toBe(ROW.Glide);
        const { view } = composed(1600, 900);
        const p = flightPlan(2, view);
        const beats = new Set(p.birds.map((b) => b.beat.toFixed(4)));
        expect(beats.size).toBe(p.birds.length);
    });
});

describe('the wading flock', () => {
    it('builds each bird from its own number alone', () => {
        expect(JSON.stringify(flockBird(7))).toBe(JSON.stringify(flockBird(7)));
        expect(flockBird(7).id).not.toBe(flockBird(8).id);
        const kinds = new Set();
        for (let i = 0; i < FLOCK.birds; i += 1) flockBird(i).acts.forEach((a) => kinds.add(a.kind));
        Object.values(ACT).forEach((kind) => expect(kinds.has(kind), `act ${kind}`).toBe(true));
    });

    it('stands clear of the card\'s middle and of the sun\'s column, in every landscape frame', () => {
        SCREENS.filter(([w, h]) => w > h).forEach(([w, h]) => {
            const {
                world, view, span, card,
            } = composed(w, h);
            const middle = [card.x0 + (card.x1 - card.x0) * 0.25, card.x1 - (card.x1 - card.x0) * 0.25];
            for (let i = 0; i < FLOCK.birds; i += 1) {
                const bird = flockBird(i);
                for (let t = 0; t < bird.loop; t += 2) {
                    const s = flockBirdAt(bird, t, span);
                    const q = projectRest(view, s.place);
                    expect(q.x < middle[0] || q.x > middle[1], `${w}x${h} bird ${i} t ${t}`).toBe(true);
                    expect(Math.abs(q.x - world.sunScreenX), `${w}x${h} bird ${i} t ${t}`).toBeGreaterThan(0.025);
                    // On the water, below the horizon, never in front of the sun's image.
                    expect(q.y).toBeGreaterThan(WORLD.horizonY);
                    expect(q.y).toBeLessThan(WORLD.horizonY + 0.06);
                }
            }
        });
    });

    it('walks a few at a time and feeds, rests and looks up the rest of the time', () => {
        const { span } = composed(1600, 900);
        const share = {};
        let total = 0;
        for (let t = 0; t < 600; t += 3) {
            for (let i = 0; i < FLOCK.birds; i += 1) {
                const s = flockBirdAt(flockBird(i), t, span);
                share[s.kind] = (share[s.kind] ?? 0) + 1;
                total += 1;
            }
        }
        expect(share[ACT.walk] / total).toBeLessThan(0.3);
        expect(share[ACT.walk] / total).toBeGreaterThan(0.05);
        expect(share[ACT.feed] / total).toBeGreaterThan(0.2);
    });

    it('never jumps: place, heading and every bone move smoothly from frame to frame', () => {
        const { span } = composed(1600, 900);
        const dt = 1 / 60;
        for (let i = 0; i < 8; i += 1) {
            const bird = flockBird(i);
            let last = null;
            for (let t = 0; t < bird.loop + 5; t += dt) {
                const s = flockBirdAt(bird, t, span);
                const pose = flamingoPose(s.weights, s.n);
                const now = {
                    place: [...s.place], heading: s.heading, lift: lowestToe(pose), bones: Array.from(pose),
                };
                if (last) {
                    expect(dist(now.place, last.place), `bird ${i} t ${t.toFixed(2)}`).toBeLessThan(0.02);
                    const turned = now.heading - last.heading;
                    expect(Math.abs(Math.atan2(Math.sin(turned), Math.cos(turned)))).toBeLessThan(0.06);
                    expect(Math.abs(now.lift - last.lift)).toBeLessThan(0.03);
                    for (let b = 0; b < BONES; b += 1) {
                        const o = b * 8;
                        const moved = dist(now.bones.slice(o + 4, o + 7), last.bones.slice(o + 4, o + 7));
                        expect(moved, `bird ${i} bone ${b} t ${t.toFixed(2)}`).toBeLessThan(0.06);
                    }
                }
                last = now;
            }
        }
    });
});

describe('the flamingos in the world', () => {
    it('is a part of the world on every tier, its table inside one 16 KB uniform block', () => {
        Object.entries(QUALITY).forEach(([name, tier]) => {
            expect(tier.flamingos.flock, name).toBeGreaterThan(0);
            expect(tier.flamingos.flight, name).toBeGreaterThan(0);
            expect(tier.flamingos.flock + tier.flamingos.flight, name).toBeLessThanOrEqual(MOST_BIRDS);
        });
        expect(MOST_BIRDS * ROWS_PER_BIRD * 16).toBeLessThanOrEqual(16384);
        ['Minimal', 'High'].forEach((quality) => {
            const { world, camera } = composed(1600, 900, quality);
            expect(world.parts.get('flamingos')).toBe(world.flamingos.object);
            world.seek(14);
            const sim = {
                time: 14, delta: 0, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            expect(world.flamingos.count).toBeGreaterThanOrEqual(world.tier.flamingos.flock);
            expect(world.flamingos.count).toBeLessThanOrEqual(world.tier.flamingos.flock + world.tier.flamingos.flight);
            expect(world.flamingos.meshes.length).toBe(2);
        });
    });

    it('replays the same frame after a seek, and a pinned flight is in the air', () => {
        const { world, camera } = composed(1600, 900);
        const frame = (t) => {
            const sim = {
                time: t, delta: 1 / 30, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        };
        world.flamingos.pin(0, 14 - 8);
        world.seek(14);
        frame(14);
        const first = Float32Array.from(world.flamingos.table);
        const { count } = world.flamingos;
        expect(count).toBeGreaterThan(world.tier.flamingos.flock);
        for (let t = 14; t < 30; t += 0.5) frame(t);
        world.seek(14);
        frame(14);
        expect(world.flamingos.count).toBe(count);
        expect(Array.from(world.flamingos.table.slice(0, count * BIRD_FLOATS)))
            .toEqual(Array.from(first.slice(0, count * BIRD_FLOATS)));
    });

    it('keeps every bird out of the water and every image in it below the horizon', () => {
        const { world, camera } = composed(1600, 900);
        world.flamingos.pin(3, 0);
        world.seek(0);
        const m = flamingoModel();
        for (let t = 0.5; t < 20; t += 1.5) {
            const sim = {
                time: t, delta: 0, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            const { table, count } = world.flamingos;
            for (let bird = 0; bird < count; bird += 1) {
                const pose = table.subarray(bird * BIRD_FLOATS, (bird + 1) * BIRD_FLOATS);
                for (let i = 0; i < m.vertexCount; i += 7) {
                    const v = flamingoVertex(i, pose);
                    // (A feeding bill dips in; the vertex stage lays it on the water.)
                    expect(v[1], `bird ${bird} vertex ${i}`).toBeGreaterThan(-MIRROR.eye - 0.08);
                    v[1] = Math.max(v[1], -MIRROR.eye);
                    const image = world.screenOf([v[0], -2 * MIRROR.eye - v[1], v[2]], {});
                    const horizon = world.screenOf([v[0], 0, v[2]], {});
                    expect(image.y).toBeGreaterThan(horizon.y);
                }
            }
        }
        // The flock's feet are on the water.
        const report = [];
        writeBirds({
            time: 9,
            view: restView({ fov: world.fov(), aspect: world.aspect, pitch: world.pitch() }),
            span: { centre: 0, half: 0.05 },
            flightMost: 0,
            pinned: null,
        }, world.flamingos.flock, new Float32Array(MOST_BIRDS * BIRD_FLOATS), report);
        report.forEach((b) => expect(b.foot).toBe(-MIRROR.eye));
    });
});
