/**
 * THE DOLPHINS IN THE BAY (masterpiece pass, follow-up 2026-11-17): a pod porpoising by the
 * breach. They swim their own loops on the clock (never the camera's), in no other animal's way
 * and clear of the reef and the rail; their path through the air and the water has no corner;
 * and they are in the frame when the eye breaks the surface, whatever the clock says.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import {
    ODYSSEY_BREACH_P, ODYSSEY_SEA_LEVEL, odysseyWorldHeight,
} from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    DOLPHIN_POD, dolphinAt, dolphinDive, dolphinLoopAt, dolphinLoopLength, dolphinLoopPoints, dolphinSplashes,
    porpoiseAt,
} from '../../src/rendering/odyssey/composition/odyssey-dolphin-pod.js';
import { OCEAN_ROAM, roamAt } from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { OCEAN_REEF, planOceanReef } from '../../src/rendering/odyssey/world/odyssey-ocean-reef.js';
import {
    DOLPHIN_BELOW, buildDolphinBubbles, buildDolphinHull,
} from '../../src/rendering/odyssey/world/odyssey-dolphins.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const SEA = ODYSSEY_SEA_LEVEL;
const P = DOLPHIN_POD;
const rail = [];
for (let p = 0.066; p < 0.1372; p += 0.0015) {
    const q = getOdysseyPathPointAt(p);
    if (q.y < SEA - 2 && q.y > odysseyWorldHeight(q.x, q.z) + 2) rail.push({ x: q.x, y: q.y, z: q.z });
}
const loopOf = (d) => (d.scout ? P.scouts : P);
const diveOf = (d) => (d.height * (1 - P.leap)) / P.leap;

describe('the dolphins porpoise: an arc through the air, a dive under, no corner between', () => {
    it('leaves the water at the start of its cycle and is back in it by `leap`', () => {
        const a = { y: 0, dy: 0 };
        expect(porpoiseAt(0, 4, a).y).toBeCloseTo(0, 12);
        expect(porpoiseAt(P.leap / 2, 4, a).y).toBeCloseTo(4, 12);
        expect(porpoiseAt(P.leap, 4, a).y).toBeCloseTo(0, 9);
        expect(porpoiseAt(P.leap + ((1 - P.leap) / 2), 4, a).y).toBeCloseTo((-4 * (1 - P.leap)) / P.leap, 9);
        for (let c = 0.001; c < P.leap; c += 0.01) expect(porpoiseAt(c, 4, a).y).toBeGreaterThan(0);
        for (let c = P.leap + 0.001; c < 1; c += 0.01) expect(porpoiseAt(c, 4, a).y).toBeLessThan(0);
    });

    it('has one slope where the arc meets the dive, at both ends', () => {
        const before = { y: 0, dy: 0 };
        const after = { y: 0, dy: 0 };
        [[P.leap - 1e-7, P.leap + 1e-7], [1 - 1e-7, 1e-7]].forEach(([c0, c1]) => {
            porpoiseAt(c0, 3.6, before);
            porpoiseAt(c1, 3.6, after);
            expect(Math.abs(before.y - after.y)).toBeLessThan(1e-4);
            expect(Math.abs(before.dy - after.dy)).toBeLessThan(1e-3);
        });
    });

    it('pitches along its own path, never past a natural leap, and arches over the top', () => {
        const pose = {};
        P.dolphins.forEach((d) => {
            let steepest = 0;
            for (let t = 0; t < d.period; t += 0.01) {
                dolphinAt(d, t, pose);
                steepest = Math.max(steepest, Math.abs(pose.pitch));
                expect(Number.isFinite(pose.bend)).toBe(true);
            }
            expect((steepest * 180) / Math.PI).toBeGreaterThan(20);
            expect((steepest * 180) / Math.PI).toBeLessThan(42);
            // At the top of its arc the path curves downward: nose and tail hang.
            dolphinAt(d, ((P.leap / 2) - d.phase) * d.period, pose);
            expect(pose.y).toBeCloseTo(d.height, 6);
            expect(pose.bend).toBeLessThan(-0.1);
            expect(Math.abs(pose.pitch)).toBeLessThan(0.02);
            // It beats its flukes in the water and holds them in the air.
            expect(pose.beatAmp).toBeCloseTo(P.airBeat, 3);
            dolphinAt(d, ((P.leap + ((1 - P.leap) / 2)) - d.phase) * d.period, pose);
            expect(pose.beatAmp).toBeCloseTo(1, 3);
        });
    });

    it('never jumps: place, height and pitch are continuous on the clock', () => {
        const prev = {};
        const pose = {};
        P.dolphins.forEach((d) => {
            dolphinAt(d, 0, prev);
            for (let t = 1 / 60; t < 90; t += 1 / 60) {
                dolphinAt(d, t, pose);
                expect(Math.hypot(pose.x - prev.x, pose.z - prev.z)).toBeLessThan(0.25);
                expect(Math.abs(pose.y - prev.y)).toBeLessThan(0.25);
                expect(Math.abs(pose.pitch - prev.pitch)).toBeLessThan(0.05);
                let turn = Math.abs(pose.yaw - prev.yaw);
                if (turn > Math.PI) turn = (2 * Math.PI) - turn;
                expect(turn).toBeLessThan(0.02);
                Object.assign(prev, pose);
            }
        });
    });

    it('walks its loop at a steady pace (no sprint on the long sides)', () => {
        [P, P.scouts].forEach((lp) => {
            const a = {};
            const b = {};
            const length = dolphinLoopLength(lp);
            for (let arc = 0; arc < length; arc += 2) {
                dolphinLoopAt(arc, a, lp);
                dolphinLoopAt(arc + 0.5, b, lp);
                expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.49);
                expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.51);
                expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1, 6);
            }
        });
    });

    it('leaves its splashes where it went through the surface', () => {
        const marks = dolphinSplashes(P.dolphins[0], 0);
        const pose = {};
        P.dolphins.forEach((d) => {
            for (let t = 3; t < 40; t += 0.37) {
                dolphinSplashes(d, t, marks);
                expect(marks.exit.age).toBeGreaterThanOrEqual(0);
                expect(marks.exit.age).toBeLessThan(d.period);
                expect(marks.entry.age).toBeLessThan(d.period);
                dolphinAt(d, t - marks.exit.age, pose);
                expect(Math.abs(pose.y)).toBeLessThan(1e-6);
                expect(Math.hypot(pose.x - marks.exit.x, pose.z - marks.exit.z)).toBeLessThan(1e-6);
                dolphinAt(d, t - marks.entry.age, pose);
                expect(Math.abs(pose.y)).toBeLessThan(1e-6);
                expect(Math.hypot(pose.x - marks.entry.x, pose.z - marks.entry.z)).toBeLessThan(1e-6);
            }
        });
        expect(P.splashLife).toBeLessThan(Math.min(...P.dolphins.map((d) => d.period)));
    });

    it('marks which way it was swimming where it went through (the air it takes down follows it)', () => {
        const marks = dolphinSplashes(P.dolphins[0], 0);
        const pose = {};
        P.dolphins.forEach((d) => {
            for (let t = 3; t < 40; t += 0.61) {
                dolphinSplashes(d, t, marks);
                for (const m of [marks.entry, marks.exit]) {
                    expect(Math.hypot(m.tx, m.tz)).toBeCloseTo(1, 6);
                    dolphinAt(d, t - m.age, pose);
                    expect(Math.atan2(m.tx, m.tz)).toBeCloseTo(pose.yaw, 6);
                }
            }
        });
    });

    it('dives as deep and as long as its arc says', () => {
        const q = { y: 0, dy: 0 };
        P.dolphins.forEach((d) => {
            const dive = dolphinDive(d);
            expect(dive.depth).toBeCloseTo(diveOf(d), 9);
            expect(dive.time).toBeCloseTo((1 - P.leap) * d.period, 9);
            expect(dive.speed).toBe(loopOf(d).speed);
            // The deepest point of the dive is halfway through it.
            porpoiseAt(P.leap + ((1 - P.leap) / 2), d.height, q);
            expect(q.y).toBeCloseTo(-dive.depth, 9);
        });
    });
});

describe('the splash from below: the air the dolphins take down', () => {
    const roles = (plan, i) => [plan.a[i * 4], plan.a[(i * 4) + 1]];

    it('leaves at every mark a cloud, a trail of beads and one churn on the underside', () => {
        ['high', 'low'].forEach((quality) => {
            const dolphins = quality === 'low' ? P.lowCount : P.dolphins.length;
            const plan = buildDolphinBubbles(dolphins, quality);
            const perMark = new Map();
            for (let i = 0; i < plan.count; i += 1) {
                const [mark, role] = roles(plan, i);
                expect(Number.isInteger(mark)).toBe(true);
                expect(mark).toBeGreaterThanOrEqual(0);
                expect(mark).toBeLessThan(dolphins * 2);
                const tally = perMark.get(mark) || [0, 0, 0];
                tally[role] += 1;
                perMark.set(mark, tally);
                for (let k = 2; k < 4; k += 1) {
                    expect(plan.a[(i * 4) + k]).toBeGreaterThanOrEqual(0);
                    expect(plan.a[(i * 4) + k]).toBeLessThan(1);
                }
                for (let k = 0; k < 4; k += 1) {
                    expect(plan.b[(i * 4) + k]).toBeGreaterThanOrEqual(0);
                    expect(plan.b[(i * 4) + k]).toBeLessThan(1);
                }
            }
            expect(perMark.size).toBe(dolphins * 2);
            perMark.forEach(([puffs, beads, churn], mark) => {
                expect(churn).toBe(1);
                expect(puffs).toBeGreaterThan(0);
                expect(beads).toBeGreaterThan(puffs);
                // Going in takes more air down than coming out leaves.
                if (mark % 2 === 0) {
                    const [outPuffs, outBeads] = perMark.get(mark + 1);
                    expect(puffs).toBeGreaterThan(outPuffs);
                    expect(beads).toBeGreaterThan(outBeads);
                }
            });
        });
        const high = buildDolphinBubbles(P.dolphins.length, 'high');
        const low = buildDolphinBubbles(P.dolphins.length, 'low');
        expect(low.count).toBeLessThan(high.count);
        // The same plan every time (the bubbles of a seek are the bubbles it would have seen).
        expect(Array.from(buildDolphinBubbles(3).b)).toEqual(Array.from(buildDolphinBubbles(3).b));
    });

    it('lives no longer than the dolphin takes to come round to the next mark of the same kind', () => {
        const B = DOLPHIN_BELOW;
        const shortest = Math.min(...P.dolphins.map((d) => d.period));
        const latest = Math.max(B.entry.shed, B.exit.shed) + 0.1;
        expect(latest + B.bead.life[1]).toBeLessThan(shortest);
        expect(latest + B.puff.life[1]).toBeLessThan(shortest);
        expect(B.churn.life).toBeLessThan(shortest);
        // The trail is shed while the dolphin is still under, not after it has come out again.
        P.dolphins.forEach((d) => expect(B.entry.shed).toBeLessThan(dolphinDive(d).time));
    });
});

describe('the dolphins keep to their own water', () => {
    it('dives over a bed that is deep enough, and keeps clear of the rail', () => {
        P.dolphins.forEach((d) => {
            dolphinLoopPoints(4, loopOf(d)).forEach((pt) => {
                const depth = SEA - odysseyWorldHeight(pt.x, pt.z);
                expect(depth).toBeGreaterThan(diveOf(d) + 8);
                // Nearer the rail than this (in space) it would cross an orb's close-up.
                const near = Math.min(...rail.map((r) => Math.hypot(r.x - pt.x, r.z - pt.z, Math.max(0, (SEA - 10) - r.y))));
                expect(near).toBeGreaterThan(14);
            });
        });
    });

    it('is in no other animal\'s way: the manta under the pod, the whale shark under the scouts', () => {
        const at = { x: 0, y: 0, z: 0 };
        const pose = {};
        const others = [
            { route: OCEAN_ROAM.manta, half: 12, tall: 2 },
            { route: OCEAN_ROAM.whaleShark, half: 6, tall: 4.5 },
            { route: OCEAN_ROAM.whales, half: 9, tall: 7 },
        ];
        // Their clocks are not commensurate: walk a long stretch of them together.
        for (let t = 0; t < 2400; t += 0.25) {
            others.forEach(({ route, half, tall }) => {
                roamAt(route, t, at);
                const depth = SEA - at.y;
                P.dolphins.forEach((d) => {
                    dolphinAt(d, t, pose);
                    const apart = Math.hypot(pose.x - at.x, pose.z - at.z);
                    const over = depth - tall - (-pose.y) - 1.4; // the dolphin's belly to the other's back
                    expect(apart > half + 1.5 || over > 1, `t ${t}`).toBe(true);
                });
            });
        }
    });

    it('swims through no rock, kelp or coral (the reef keeps out of its way)', () => {
        const plan = planOceanReef({ heightAt: odysseyWorldHeight, rail, seaLevel: SEA });
        const ways = [...dolphinLoopPoints(3), ...dolphinLoopPoints(3, P.scouts)];
        const side = Math.max(...P.dolphins.map((d) => Math.abs(d.side))) + 1.5;
        const deepest = Math.max(...P.dolphins.map(diveOf)) + 1.5;
        const solids = [
            [plan.tower.x, plan.tower.z, OCEAN_REEF.tower.kelpRadius, OCEAN_REEF.canopyDepth],
            ...plan.pinnacles.map((p) => [p.x, p.z, p.baseR * 0.5, SEA - p.topY]),
            ...plan.stipes.map((st) => [st.x, st.z, 1.5, SEA - (st.y + Math.min(st.length, st.room))]),
            ...plan.corals.map((c) => [c.x, c.z, c.size, SEA - (c.y + (c.size * 1.4))]),
        ];
        solids.forEach(([x, z, r, top]) => {
            if (top > deepest) return;
            const near = Math.min(...ways.map((w) => Math.hypot(w.x - x, w.z - z)));
            expect(near, `${x.toFixed(0)},${z.toFixed(0)}`).toBeGreaterThan(r + side);
        });
    });
});

describe('the dolphins are there when the eye breaks the surface (the real camera)', () => {
    const rig = createOdysseyCameraRig();
    const pose = {};
    const camAt = (p) => {
        const cam = rig.poseAt(p).clone();
        cam.aspect = 1.6;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        return cam;
    };
    const seen = (cam, t, which, test) => P.dolphins.filter(which).some((d) => {
        dolphinAt(d, t, pose);
        if (!test(pose)) return false;
        const v = new THREE.Vector3(pose.x, SEA + pose.y, pose.z);
        const ahead = v.clone().sub(cam.position).dot(cam.getWorldDirection(new THREE.Vector3())) > 0;
        const dist = v.distanceTo(cam.position);
        v.project(cam);
        return ahead && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && dist < 170;
    });

    it('has the pod in the frame just after the crossing at every clock phase, one in the air most of the time', () => {
        const cam = camAt(ODYSSEY_BREACH_P + 0.003);
        let any = 0;
        let air = 0;
        let n = 0;
        for (let t = 0; t < 400; t += 0.25) {
            n += 1;
            if (seen(cam, t, (d) => !d.scout, () => true)) any += 1;
            if (seen(cam, t, (d) => !d.scout, (q) => q.y > 0.4)) air += 1;
        }
        expect(any / n).toBeGreaterThan(0.97);
        expect(air / n).toBeGreaterThan(0.6);
    });

    it('shows the scouts from below on the climb, at some clock phases', () => {
        const share = (p) => {
            const cam = camAt(p);
            let hit = 0;
            let n = 0;
            for (let t = 0; t < 300; t += 0.25) {
                n += 1;
                if (seen(cam, t, (d) => d.scout, (q) => q.y < 0)) hit += 1;
            }
            return hit / n;
        };
        expect(share(0.103)).toBeGreaterThan(0.6);
        expect(share(0.116)).toBeGreaterThan(0.25);
        expect(share(0.123)).toBeGreaterThan(0.2);
    });
});

describe('the dolphin\'s hull', () => {
    const hull = buildDolphinHull();
    const pos = hull.attributes.position;
    const nrm = hull.attributes.normal;

    it('is a small smooth mesh a body long: beak ahead, flukes behind, the fin on its back', () => {
        expect(hull.index.count / 3).toBeGreaterThan(900);
        expect(hull.index.count / 3).toBeLessThan(2500);
        let zMin = Infinity;
        let zMax = -Infinity;
        let yMax = -Infinity;
        let xMax = 0;
        for (let i = 0; i < pos.count; i += 1) {
            expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
            zMin = Math.min(zMin, pos.getZ(i));
            zMax = Math.max(zMax, pos.getZ(i));
            yMax = Math.max(yMax, pos.getY(i));
            xMax = Math.max(xMax, Math.abs(pos.getX(i)));
        }
        expect(zMax).toBeCloseTo(0.503, 3);
        expect(zMax - zMin).toBeGreaterThan(0.98);
        expect(zMax - zMin).toBeLessThan(1.12);
        // The dorsal fin stands over the back; the flukes are the widest thing.
        expect(yMax).toBeGreaterThan(0.19);
        expect(xMax).toBeGreaterThan(0.13);
        expect(xMax).toBeLessThan(0.2);
    });

    it('faces outward all over its body (smooth normals, none turned in)', () => {
        // The body's rings are the first vertices: each normal leans away from the body's axis.
        let outward = 0;
        const body = 35 * 16;
        for (let i = 0; i < body; i += 1) {
            const dot = (pos.getX(i) * nrm.getX(i)) + (pos.getY(i) * nrm.getY(i));
            if (dot > 0) outward += 1;
            expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 3);
        }
        expect(outward / body).toBeGreaterThan(0.97);
    });

    it('is countershaded: a dark back over a pale belly', () => {
        const col = hull.attributes.color;
        let back = 0;
        let belly = 0;
        let nb = 0;
        let nl = 0;
        for (let i = 0; i < 35 * 16; i += 1) {
            const luma = (0.2126 * col.getX(i)) + (0.7152 * col.getY(i)) + (0.0722 * col.getZ(i));
            if (nrm.getY(i) > 0.8) { back += luma; nb += 1; }
            if (nrm.getY(i) < -0.8) { belly += luma; nl += 1; }
        }
        expect(belly / nl).toBeGreaterThan((back / nb) * 4);
    });
});
