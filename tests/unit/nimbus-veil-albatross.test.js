/**
 * Nimbus Veil — the albatrosses: the Blender-built bird as the theme reads it, the flight the
 * screen shows (flown here by the same numbers), and the mark that keeps the sun's glare off a
 * bird. Relations, read off the modules: no tuning number is pinned.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NIMBUS_VEIL_ALBATROSS } from '../../src/themes/nimbus-veil/nimbus-veil-albatross-model.js';
import {
    ALBATROSS_MASK, albatrossModel, createAlbatrosses, poseAlbatross,
} from '../../src/themes/nimbus-veil/nimbus-veil-albatross.js';
import {
    ALBATROSS_FLIGHT, ALBATROSS_KINDS, ALBATROSS_MOST, ALBATROSS_ROWS, albatrossCourse, albatrossPlace, albatrossPose,
    layAlbatrossPassage, poseAlbatrosses,
} from '../../src/themes/nimbus-veil/nimbus-veil-albatross-flight.js';
import { NimbusWorld, WORLD_QUALITY, createWorldUniforms } from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
import { GLARE_ON_MARK } from '../../src/themes/nimbus-veil/nimbus-veil-post.js';
import { HAPPENINGS, HAPPEN_SLOT } from '../../src/themes/nimbus-veil/nimbus-veil-weather.js';
import { SEA_FIELD } from '../../src/themes/nimbus-veil/nimbus-veil-cloudsea.js';
import { RIG } from '../../src/themes/nimbus-veil/nimbus-veil-tsl.js';

const DUR = HAPPENINGS.albatross.dur;
const F = ALBATROSS_FLIGHT;
/** A bird's wingspan at life size (the model's). */
const M_SPAN = NIMBUS_VEIL_ALBATROSS.span;
/** The screens a passage must cross whole: wide, the usual, an old monitor, a phone held upright. */
const SCREENS = [21 / 9, 16 / 9, 4 / 3, 390 / 844];
const frameOf = (aspect, yaw = 0) => ({
    eyeX: RIG.x,
    eyeZ: RIG.z,
    yaw,
    tanH: Math.tan(THREE.MathUtils.degToRad(NimbusWorld.verticalFov(aspect)) / 2) * aspect,
});

/** A point's place on the rest view (NDC x, and its depth along the view), for a frame. */
function seen(p, frame) {
    const ahead = (p[0] - frame.eyeX) * Math.sin(frame.yaw) - (p[2] - frame.eyeZ) * Math.cos(frame.yaw);
    const aside = (p[0] - frame.eyeX) * Math.cos(frame.yaw) + (p[2] - frame.eyeZ) * Math.sin(frame.yaw);
    return { x: aside / (ahead * frame.tanH), ahead, aside };
}

describe('nimbus veil albatross: the model', () => {
    const M = NIMBUS_VEIL_ALBATROSS;
    const model = albatrossModel();

    it('decodes to the bird the script wrote: a long narrow wing, a short body', () => {
        expect(model.positions.length).toBe(M.vertexCount * 3);
        expect(model.normals.length).toBe(M.vertexCount * 3);
        expect(model.colours.length).toBe(M.vertexCount * 4);
        expect(model.rig.length).toBe(M.vertexCount * 4);
        expect(model.index.length).toBe(M.triangleCount * 3);
        expect(Math.max(...model.index)).toBeLessThan(M.vertexCount);
        let left = 0;
        let right = 0;
        let nose = -Infinity;
        let tail = Infinity;
        for (let i = 0; i < M.vertexCount; i += 1) {
            left = Math.max(left, model.positions[i * 3]);
            right = Math.min(right, model.positions[i * 3]);
            nose = Math.max(nose, model.positions[i * 3 + 2]);
            tail = Math.min(tail, model.positions[i * 3 + 2]);
            const n = Math.hypot(model.normals[i * 3], model.normals[i * 3 + 1], model.normals[i * 3 + 2]);
            expect(n).toBeGreaterThan(0.9);
            expect(n).toBeLessThan(1.1);
        }
        // Both wings alike, and far longer than the bird: that is what an albatross is.
        expect(left).toBeCloseTo(-right, 3);
        expect(left - right).toBeCloseTo(M.span, 3);
        expect(M.span / (nose - tail)).toBeGreaterThan(2.2);
        // Light enough to draw five of without a thought.
        expect(M.triangleCount).toBeLessThan(900);
    });

    it('is white below and dark on the wings above', () => {
        const wing = M.parts.indexOf('wing');
        let over = 0;
        let overN = 0;
        let under = 0;
        let underN = 0;
        for (let i = 0; i < M.vertexCount; i += 1) {
            if (model.parts[i] !== wing) continue;
            const x = Math.abs(model.positions[i * 3]);
            // The middle of the wing, away from its dark tip.
            if (x < 0.3 || x > 1.0) continue;
            const light = (model.colours[i * 4] + model.colours[i * 4 + 1] + model.colours[i * 4 + 2]) / 3;
            if (model.normals[i * 3 + 1] > 0.6) {
                over += light;
                overN += 1;
            } else if (model.normals[i * 3 + 1] < -0.6) {
                under += light;
                underN += 1;
            }
        }
        expect(overN).toBeGreaterThan(8);
        expect(underN).toBeGreaterThan(8);
        expect(under / underN).toBeGreaterThan((over / overN) * 4);
    });

    it('poses a vertex exactly as the script\'s own twin of the vertex stage does', () => {
        expect(M.checks.length).toBeGreaterThan(8);
        for (const check of M.checks) {
            const i = check.vertex;
            const p = [model.positions[i * 3], model.positions[i * 3 + 1], model.positions[i * 3 + 2]];
            const rig = [model.rig[i * 4], model.rig[i * 4 + 1], model.rig[i * 4 + 2], model.rig[i * 4 + 3]];
            const at = poseAlbatross(p, rig, check.arm, check.hand, check.fan, check.twist);
            for (let k = 0; k < 3; k += 1) expect(at[k]).toBeCloseTo(check.at[k], 4);
        }
        // The body does not move with the wings; a wingtip does.
        const still = poseAlbatross([0, 0, 0.3], [0, 0, 0, 1], 0.4, -0.3, 1, 0.5);
        expect(still).toEqual([0, 0, 0.3]);
    });

    it('tears no edge and bunches none in any pose the flight asks for', () => {
        // (The tail's fan is the widest stretch there is: it spreads by design.)
        expect(M.stretch[0]).toBeGreaterThan(1 / (1 + M.fanGain) - 0.02);
        expect(M.stretch[1]).toBeLessThan(1 + M.fanGain + 0.02);
        // And the flight's poses stay inside the ones the script measured.
        const arms = Object.values(M.poses).map((pose) => pose[0]);
        expect(F.arm + F.beat.arm + F.flex[0] * 1.2).toBeLessThan(Math.max(...arms) + 0.25);
        expect(F.arm - F.beat.arm - F.flex[0] * 0.6).toBeGreaterThan(Math.min(...arms) - 0.25);
    });
});

describe('nimbus veil albatross: the flight', () => {
    const plans = [];
    for (let slot = 0; slot < 48; slot += 1) {
        for (const most of [3, 5]) plans.push(layAlbatrossPassage(slot, most, DUR, {}));
    }

    it('lays every passage from its slot alone: the same birds on a replay', () => {
        expect(layAlbatrossPassage(17, 5, DUR, {})).toEqual(layAlbatrossPassage(17, 5, DUR, {}));
        const kinds = new Set();
        const counts = new Set();
        const ways = new Set();
        for (const plan of plans) {
            kinds.add(plan.kind);
            ways.add(plan.way);
            if (plan.birds.length <= 5) counts.add(plan.count);
            expect(plan.count).toBe(plan.birds.length);
            expect(plan.count).toBeGreaterThanOrEqual(1);
            expect(plan.count).toBeLessThanOrEqual(ALBATROSS_MOST);
        }
        expect([...kinds].sort()).toEqual([...ALBATROSS_KINDS].sort());
        expect(ways.size).toBe(2);
        // One bird alone now and then, and every size of company up to the most.
        expect([...counts].sort()).toEqual([1, 2, 3, 4, 5]);
        // A lean tier flies no more than it has.
        for (let slot = 0; slot < 48; slot += 1) {
            expect(layAlbatrossPassage(slot, 3, DUR, {}).count).toBeLessThanOrEqual(3);
        }
    });

    it('brings the line in whole: evenly spaced, at one pace, every bird in and out over an edge', () => {
        for (const aspect of SCREENS) {
            for (const yaw of [0, 0.52]) {
                const frame = frameOf(aspect, yaw);
                for (const plan of plans) {
                    const laid = albatrossCourse(plan, frame);
                    const last = plan.birds[plan.count - 1];
                    // The last bird is out before the passage is over.
                    expect(last.delay + laid.cross).toBeLessThanOrEqual(DUR + 1e-9);
                    plan.birds.forEach((bird, i) => {
                        expect(bird.delay).toBeCloseTo(i * plan.gap, 9);
                        const half = (M_SPAN * bird.size) / 2;
                        for (const t of [0, laid.cross]) {
                            const p = albatrossPlace(plan, bird, t, frame, [0, 0, 0], laid);
                            const at = seen(p, frame);
                            expect(at.ahead).toBeGreaterThan(10);
                            // Outside the view by more than half a wing.
                            const clear = Math.abs(at.aside) - half - at.ahead * frame.tanH;
                            const label = `slot ${plan.slot} bird ${i} at ${t}, ${aspect.toFixed(2)}`;
                            expect(clear, label).toBeGreaterThan(1);
                        }
                        // In over one edge and out over the other.
                        const from = seen(albatrossPlace(plan, bird, 0, frame, [0, 0, 0], laid), frame).x;
                        const to = seen(albatrossPlace(plan, bird, laid.cross, frame, [0, 0, 0], laid), frame).x;
                        expect(Math.sign(from)).toBe(-plan.way);
                        expect(Math.sign(to)).toBe(plan.way);
                    });
                }
            }
        }
    });

    it('flies a real S: an even pace, no steep climb, a bank into every turn, clear of the deck and the lens', () => {
        // The deck's highest heads (nimbus-veil-cloudsea.js: the swell, a heap and a head on it).
        const heads = SEA_FIELD.swellH / 2 + SEA_FIELD.heapH + SEA_FIELD.headH - SEA_FIELD.offset;
        const pose = {};
        let rowed = 0;
        let climbingWhileRowing = 0;
        for (const aspect of [16 / 9, 390 / 844]) {
            const frame = frameOf(aspect, 0.3);
            for (const plan of plans) {
                const laid = albatrossCourse(plan, frame);
                // The S is flown many times over a crossing, never once.
                if (aspect > 1) expect(laid.cross / plan.period).toBeGreaterThan(1.5);
                for (const bird of plan.birds) {
                    let high = -Infinity;
                    let low = Infinity;
                    let banked = 0;
                    let before = null;
                    for (let t = 0; t <= laid.cross; t += 0.1) {
                        albatrossPose(plan, bird, t, frame, pose, laid);
                        const label = `slot ${plan.slot} at ${t.toFixed(1)}, ${aspect.toFixed(2)}`;
                        expect(Number.isFinite(pose.place[0] + pose.place[1] + pose.place[2]), label).toBe(true);
                        expect(Math.hypot(...pose.heading), label).toBeCloseTo(1, 6);
                        // Never slower than its course, never a dash.
                        expect(pose.pace, label).toBeGreaterThan(plan.pace * 0.9);
                        expect(pose.pace, label).toBeLessThan(plan.pace * 2.3);
                        // No climb steeper than a soaring bird's.
                        expect(Math.abs(pose.heading[1]), label).toBeLessThan(0.55);
                        expect(Math.abs(pose.roll), label).toBeLessThanOrEqual(F.bank + 1e-9);
                        // Over the heads, under the top of the view, never at the lens.
                        expect(pose.place[1], label).toBeGreaterThan(heads - 1.5);
                        expect(pose.place[1], label).toBeLessThan(RIG.height + 22);
                        const off = Math.hypot(
                            pose.place[0] - RIG.x,
                            pose.place[1] - RIG.height,
                            pose.place[2] - RIG.z,
                        );
                        expect(off, label).toBeGreaterThan(20);
                        // The wings stay inside what the model was measured for.
                        expect(pose.arm, label).toBeLessThan(0.7);
                        expect(pose.arm, label).toBeGreaterThan(-0.45);
                        expect(pose.fan, label).toBeLessThanOrEqual(1);
                        expect(pose.fan, label).toBeGreaterThanOrEqual(-1);
                        // It moves on from where it was: no jump between two moments.
                        if (before) {
                            const step = Math.hypot(
                                pose.place[0] - before[0],
                                pose.place[1] - before[1],
                                pose.place[2] - before[2],
                            );
                            expect(step, label).toBeLessThan(plan.pace * 2.3 * 0.1 + 0.05);
                        }
                        before = [pose.place[0], pose.place[1], pose.place[2]];
                        high = Math.max(high, pose.place[1]);
                        low = Math.min(low, pose.place[1]);
                        banked = Math.max(banked, Math.abs(pose.roll));
                        if (pose.rowing > 0.1 && pose.rowing < 0.9) {
                            rowed += 1;
                            if (pose.heading[1] > 0) climbingWhileRowing += 1;
                        }
                    }
                    if (aspect > 1) {
                        // It climbs and slides down by many times its own height, and banks hard doing it.
                        expect(high - low).toBeGreaterThan(8);
                        expect(banked).toBeGreaterThan(0.45);
                    }
                }
            }
        }
        // Some birds row a few beats, and they do it on the way up.
        expect(rowed).toBeGreaterThan(200);
        expect(climbingWhileRowing / rowed).toBeGreaterThan(0.9);
    });

    it('banks into the turn: the wing on the inside of it goes down', () => {
        const frame = frameOf(16 / 9, 0);
        const pose = {};
        const a = [0, 0, 0];
        const b = [0, 0, 0];
        let agreed = 0;
        let turns = 0;
        for (const plan of plans.slice(0, 24)) {
            const laid = albatrossCourse(plan, frame);
            const bird = plan.birds[0];
            for (let t = 4; t < laid.cross - 4; t += 0.5) {
                albatrossPose(plan, bird, t, frame, pose, laid);
                if (Math.abs(pose.roll) < 0.25) continue;
                // Which way its heading is turning (seen from above: + is to its left).
                albatrossPlace(plan, bird, t - 0.4, frame, a, laid);
                albatrossPlace(plan, bird, t + 0.4, frame, b, laid);
                const inX = pose.place[0] - a[0];
                const inZ = pose.place[2] - a[2];
                const outX = b[0] - pose.place[0];
                const outZ = b[2] - pose.place[2];
                // (Flying down +z its left is +x: a turn to its left is a positive y of in x out.)
                const toLeft = inZ * outX - inX * outZ;
                turns += 1;
                // Turning left, the left wing is down: a negative roll.
                if (Math.sign(toLeft) === -Math.sign(pose.roll)) agreed += 1;
            }
        }
        expect(turns).toBeGreaterThan(100);
        expect(agreed / turns).toBeGreaterThan(0.97);
    });

    it('writes a bird as three rows, and one that is not in the air as nothing with a heading', () => {
        const rows = new Float64Array(ALBATROSS_MOST * ALBATROSS_ROWS * 4);
        const frame = frameOf(16 / 9, 0.4);
        const plan = plans.find((p) => p.count === 3);
        const laid = albatrossCourse(plan, frame);
        // Before the second bird is in: one flies.
        expect(poseAlbatrosses(plan, plan.gap * 0.5, frame, rows)).toBe(1);
        expect(rows[3]).toBeGreaterThan(1);
        expect(rows[ALBATROSS_ROWS * 4 + 3]).toBe(0);
        // All of them, mid-passage.
        expect(poseAlbatrosses(plan, plan.gap * 2 + 1, frame, rows)).toBe(3);
        for (let i = 0; i < ALBATROSS_MOST; i += 1) {
            const at = i * ALBATROSS_ROWS * 4;
            expect(Math.hypot(rows[at + 4], rows[at + 5], rows[at + 6])).toBeCloseTo(1, 6);
            if (i >= 3) expect(rows[at + 3]).toBe(0);
        }
        // After the last one is out: none.
        expect(poseAlbatrosses(plan, plan.gap * 2 + laid.cross + 0.01, frame, rows)).toBe(0);
        expect(poseAlbatrosses(plan, -1, frame, rows)).toBe(0);
    });
});

describe('nimbus veil albatross: in the world', () => {
    const seeded = (seed = 7) => {
        let s = seed;
        return () => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    };

    it('draws every tier\'s birds in one instanced mesh, dormant at no size', () => {
        for (const [name, tier] of Object.entries(WORLD_QUALITY)) {
            const birds = createAlbatrosses(createWorldUniforms(), tier.birds);
            expect(birds.most, name).toBe(tier.birds);
            expect(birds.mesh.geometry.instanceCount, name).toBe(tier.birds);
            expect(birds.table.length, name).toBe(tier.birds * ALBATROSS_ROWS);
            birds.table.forEach((row, i) => {
                if (i % ALBATROSS_ROWS === 0) expect(row.w).toBe(0);
                if (i % ALBATROSS_ROWS === 1) expect(row.z).toBe(1);
            });
            expect(birds.state().flying).toBe(0);
            birds.dispose();
        }
    });

    it('flies them only in their own happening, and only by day and at dusk', () => {
        expect(HAPPENINGS.albatross.day).toBe(true);
        expect(HAPPENINGS.albatross.dusk).toBe(true);
        expect(HAPPENINGS.albatross.night).toBe(false);
        expect(HAPPENINGS.albatross.dur).toBeLessThan(HAPPEN_SLOT);
        const world = new NimbusWorld({ scene: new THREE.Scene(), quality: 'High', random: seeded() }).build();
        world.setLayout(16 / 9, null, { immediate: true });
        const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, RIG.near, RIG.far);
        const at = (t) => {
            world.seek(t);
            world.updateCamera(camera, { time: t, delta: 0 });
            world.update({ time: t, delta: 0 });
        };
        world.setHappenings(true, 'albatross');
        // Each slot has its own company, and all of it is seen at some moment.
        const companies = new Set();
        for (let slot = 0; slot < 8; slot += 1) {
            let most = 0;
            for (let age = 0.5; age < HAPPENINGS.albatross.dur; age += 1) {
                at(slot * HAPPEN_SLOT + age);
                most = Math.max(most, world.albatross.state().flying);
            }
            expect(most).toBe(world.albatross.state().plan.count);
            companies.add(`${world.albatross.state().plan.kind}:${most}:${world.albatross.state().plan.way}`);
            at(slot * HAPPEN_SLOT + HAPPENINGS.albatross.dur + 0.5);
            expect(world.albatross.state().flying).toBe(0);
        }
        expect(companies.size).toBeGreaterThan(3);
        world.setHappenings(true, 'glitter');
        at(9);
        expect(world.albatross.state().flying).toBe(0);
        world.setHappenings(false);
        at(9);
        expect(world.albatross.state().flying).toBe(0);
        world.dispose();
    });

    it('marks a bird in the scene\'s alpha, and nothing that adds light erases the mark', () => {
        const world = new NimbusWorld({ scene: new THREE.Scene(), quality: 'High', random: seeded() }).build();
        // The bird writes its whole fragment (an opaque colorNode's alpha would arrive as 1).
        const bird = world.parts.birds.material;
        expect(bird.fragmentNode).toBeTruthy();
        expect(bird.colorNode).toBeFalsy();
        expect(bird.transparent).toBe(false);
        expect(bird.depthWrite).toBe(true);
        // The post lets a share of the glare through on the mark, and the mark is under its threshold.
        expect(ALBATROSS_MASK).toBeLessThan(0.4);
        expect(GLARE_ON_MARK).toBeGreaterThan(0);
        expect(GLARE_ON_MARK).toBeLessThan(0.5);
        // Every additive part adds its light with an alpha of zero: its whole card or sprite
        // square would otherwise put the alpha back to 1 over a bird.
        const additive = [];
        world.root.traverse((object) => {
            if (object.material?.blending === THREE.AdditiveBlending) additive.push(object.material);
        });
        expect(additive.length).toBeGreaterThanOrEqual(3);
        for (const material of additive) {
            expect(material.premultipliedAlpha, material.name).toBe(true);
            expect(material.outputNode, material.name).toBeTruthy();
            expect(material.colorNode, material.name).toBeFalsy();
        }
        world.dispose();
    });
});
