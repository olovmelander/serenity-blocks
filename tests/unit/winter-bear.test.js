/**
 * Winter — the polar bear: its body (winter-bear-rig.js), the asset skinned to it
 * (assets/polar-bear.glb, modelled by scripts/winter/model-bear.mjs), and where it goes, how it
 * puts its feet down and what it does (winter-bear-plan.js). No three, no GPU: its materials are
 * built in winter-shaders.test.js, its place in the world in winter-world.test.js.
 *
 * What is pinned is what holds by construction or is the point of the design — a planted paw does
 * not slide, every leg reaches the ground it stands on (over the spit's slopes too), no paw or toe
 * goes into the ground, no joint jumps from one frame to the next, the walk is a function of its
 * clock alone, it walks where the game lets the lake be seen and only on ice there, the board's
 * stops hold it still and give it back where it was — not the tuning: lengths, paces and timings
 * are read from the modules.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import {
    BEAR_ACTS, BEAR_BONES, BEAR_BONE_INDEX, BEAR_FEET, BEAR_MARKS, BEAR_SCALE, BEAR_SPEC, FOOT, LIE_HOLD, OWNS_FEET,
    bearAct, bearPaw, bearPoint, createBearPosture, createBearSpec, solveBear,
} from '../../src/themes/winter/winter-bear-rig.js';
import {
    BEAR_AWAY, BEAR_EASE, BEAR_EDGE, BEAR_GAIT, BEAR_PACE, BEAR_ROUTE, BEAR_ROUTES, BearMind, bearCourse, bearOnCourse,
    pawAt, phaseAt,
} from '../../src/themes/winter/winter-bear-plan.js';
import { fovForAspect, groundHeight, lakeMask } from '../../src/themes/winter/winter-core.js';
import { readGlb } from '../../scripts/fox/glb-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSET = path.join(ROOT, 'src', 'themes', 'winter', 'assets', 'polar-bear.glb');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const LANDSCAPE = 16 / 9;
/** What it does at a stop, by name (its walk and standing are not acts that end). */
const ACTS = Object.keys(BEAR_ACTS).filter((name) => name !== 'Walk' && name !== 'Stand');
/** The fraction of the frame's half width a world point stands at, seen from the eye. */
const fractionOf = (x, z, aspect = LANDSCAPE) => {
    const half = Math.atan(Math.tan((fovForAspect(aspect) * Math.PI) / 360) * aspect);
    return Math.atan2(x, -z) / half;
};
/** The open ice right of the card, where the bear's course is laid (fractions of the half width). */
const WINDOW = [0.22, 0.45];
const B = BEAR_BONE_INDEX;
/** A foot's number in a spec. */
const footAt = (spec, i, key) => spec[BEAR_SPEC.feet + i * FOOT.size + FOOT[key]];
/** A point of the body (model metres) where it stands in the world. */
const inWorld = (pose, v) => {
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    return [pose.x + (v[0] * c + v[2] * s) * BEAR_SCALE, pose.y + v[1] * BEAR_SCALE, pose.z + (-v[0] * s + v[2] * c) * BEAR_SCALE];
};
/** The tips of a foot's toes, in the posture's frame. */
const toeTip = (posture, i) => {
    const foot = BEAR_FEET[i];
    return bearPoint(posture, foot.bones[foot.bones.length - 1], BEAR_MARKS[`tip${foot.name}`]);
};
/** How far a point is over the ground under it (world metres). */
const overGround = (p) => p[1] - groundHeight(p[0], p[2]);
/** How far each joint moved from one frame's joints to the next's (the most, and which). */
const fastestJoint = (before, after) => after.reduce((most, j, k) => {
    const moved = Math.hypot(j[0] - before[k][0], j[1] - before[k][1], j[2] - before[k][2]);
    return moved > most.moved ? { moved, bone: BEAR_BONES[k][0] } : most;
}, { moved: 0, bone: '' });

describe('winter bear: the module', () => {
    it('is three-free and clock-free: plain numbers in, plain numbers out', () => {
        for (const file of ['winter-bear-rig.js', 'winter-bear-plan.js']) {
            const source = read('src', 'themes', 'winter', file);
            expect(source, file).not.toMatch(/from 'three/);
            expect(source, file).not.toMatch(/performance\.now|Date\.now|Math\.random/);
        }
    });

    it('lays the skeleton out as one tree of named bones, parents first, every joint above the ice', () => {
        const seen = new Set();
        BEAR_BONES.forEach(([name, parent, , y]) => {
            if (parent !== null) expect(seen.has(parent), `${name}'s parent ${parent}`).toBe(true);
            expect(seen.has(name), name).toBe(false);
            expect(y, name).toBeGreaterThan(0);
            seen.add(name);
        });
        expect(BEAR_BONES[0][1]).toBeNull();
        expect(Object.keys(BEAR_BONE_INDEX)).toHaveLength(BEAR_BONES.length);
        // Left and right are each other's mirror image.
        BEAR_BONES.filter(([name]) => /L$/.test(name)).forEach(([name, , x, y, z]) => {
            const twin = BEAR_BONES[BEAR_BONE_INDEX[name.replace(/L$/, 'R')]];
            expect([twin[2], twin[3], twin[4]], name).toEqual([-x, y, z]);
        });
    });

    it('stands each leg over the paw it puts on the ice, the paw on the ice and its toes ahead of it', () => {
        BEAR_FEET.forEach((foot) => {
            const last = BEAR_BONES[B[foot.bones[foot.bones.length - 2]]];
            const ball = BEAR_MARKS[foot.paw];
            const tip = BEAR_MARKS[`tip${foot.name}`];
            expect(ball[1], foot.name).toBe(0);
            expect(Math.sign(ball[0]), foot.name).toBe(foot.side);
            expect(Math.abs(last[2] - ball[0]), foot.name).toBeLessThan(0.03);
            expect(Math.abs(last[4] - ball[2]), foot.name).toBeLessThan(0.25);
            expect(tip[2], foot.name).toBeGreaterThan(ball[2]);
        });
    });

    it('solves the spec of a bear standing square to the skeleton at rest', () => {
        const posture = solveBear(createBearSpec(), createBearPosture());
        BEAR_BONES.forEach(([name, , x, y, z], i) => {
            expect(Math.hypot(posture.at[i][0] - x, posture.at[i][1] - y, posture.at[i][2] - z), name).toBeLessThan(1e-3);
        });
        expect(posture.short).toEqual([0, 0, 0, 0]);
        BEAR_FEET.forEach((foot, i) => expect(bearPaw(posture, i)[1], foot.name).toBeCloseTo(0, 6));
    });
});

describe('winter bear: how it walks', () => {
    // A whole lap of its course from the start of its clock, frame by frame.
    const mind = new BearMind(LANDSCAPE, { start: 0 });
    const { course } = mind;
    const posture = createBearPosture();
    const lap = [];
    beforeAll(() => {
        for (let t = 0; t < course.period; t += 1 / 20) {
            const pose = mind.step(t);
            solveBear(pose.spec, posture);
            lap.push({
                t,
                short: [...posture.short],
                air: BEAR_FEET.map((_, i) => footAt(pose.spec, i, 'air')),
                balls: BEAR_FEET.map((_, i) => inWorld(pose, bearPaw(posture, i))),
                toes: BEAR_FEET.map((_, i) => inWorld(pose, toeTip(posture, i))),
            });
        }
    });

    it('walks its four feet in turn, the left hind first, each on the ice two thirds of a stride', () => {
        // FL FR BL BR: the left hind, the left fore, the right hind, the right fore.
        const order = [2, 0, 3, 1].map((leg) => BEAR_GAIT.falls[leg]);
        for (let i = 1; i < 4; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
        expect(1 - BEAR_GAIT.swingShare).toBeGreaterThan(0.6);
    });

    it('reaches the ground under every paw that bears its weight, a whole lap round, over the spit too', () => {
        let bearing = 0;
        lap.forEach(({
            t, short, air, balls,
        }) => {
            for (let i = 0; i < 4; i++) {
                if (air[i] > 0.05) continue;
                bearing += 1;
                expect(short[i], `${BEAR_FEET[i].name} at ${t.toFixed(2)}`).toBeLessThan(0.005);
                expect(Math.abs(overGround(balls[i])), `${BEAR_FEET[i].name} at ${t.toFixed(2)}`).toBeLessThan(0.006);
            }
        });
        // (Most of the time at least two paws bear it: they come off their weight as their heels peel.)
        expect(bearing).toBeGreaterThan(lap.length * 1.5);
        // (The lap does climb: its course crosses the back of a spit of snow behind the trees.)
        expect(Math.max(...course.grade.map(Math.abs))).toBeGreaterThan(0.15);
    });

    it('never puts a paw or the tips of its toes into the ground, setting down or swinging through', () => {
        lap.forEach(({ t, balls, toes }) => {
            for (let i = 0; i < 4; i++) {
                expect(overGround(balls[i]), `${BEAR_FEET[i].name} at ${t.toFixed(2)}`).toBeGreaterThan(-0.002);
                expect(overGround(toes[i]), `${BEAR_FEET[i].name}'s toes at ${t.toFixed(2)}`).toBeGreaterThan(-0.002);
            }
        });
    });

    it('does not slide a planted paw, and moves every joint smoothly, frame by frame', () => {
        // At sixty frames a second through a stop, setting off, and up and over the spit's slope.
        const windows = [[115, 128], [150, 168], [course.period - 50, course.period - 20]];
        const fresh = new BearMind(LANDSCAPE, { start: 0 });
        const p = createBearPosture();
        // The fastest a joint goes is a paw swinging through: its swing is a third of a stride,
        // on a path that starts and ends at rest.
        const fastest = ((BEAR_PACE / BEAR_GAIT.swingShare) * 1.875 * 1.25) / 60;
        windows.forEach(([from, to]) => {
            let last = null;
            for (let t = from; t < to; t += 1 / 60) {
                const pose = fresh.step(t);
                solveBear(pose.spec, p);
                const now = {
                    joints: p.at.map((at) => inWorld(pose, at)),
                    balls: BEAR_FEET.map((_, i) => inWorld(pose, bearPaw(p, i))),
                    planted: pose.paws.map((paw) => paw.swing === 0),
                };
                if (last) {
                    const { moved, bone } = fastestJoint(last.joints, now.joints);
                    expect(moved, `${bone} at ${t.toFixed(3)}`).toBeLessThan(fastest);
                    for (let i = 0; i < 4; i++) {
                        if (!now.planted[i] || !last.planted[i]) continue;
                        const slid = Math.hypot(now.balls[i][0] - last.balls[i][0], now.balls[i][2] - last.balls[i][2]);
                        expect(slid, `${BEAR_FEET[i].name} at ${t.toFixed(3)}`).toBeLessThan(0.003);
                    }
                }
                last = now;
            }
        });
    });

    it('takes shorter steps on a slope than on the level ice', () => {
        // Strides a metre at its pace: where the ground is level, and where it is steep.
        const rate = (steep) => {
            for (let c = 0; c < course.period - 1; c += 0.25) {
                const a = bearOnCourse(course, c, {});
                const b = bearOnCourse(course, c + 0.5, {});
                if (a.speed < BEAR_PACE * 0.999 || b.speed < BEAR_PACE * 0.999) continue;
                const i = Math.floor(((((a.distance % course.length) + course.length) % course.length) / course.length) * course.count);
                const g = Math.abs(course.grade[i]);
                if (steep ? g > 0.15 : g < 0.01) return (phaseAt(course, c + 0.5) - phaseAt(course, c)) / (b.distance - a.distance);
            }
            return null;
        };
        const level = rate(false);
        const slope = rate(true);
        expect(level).toBeGreaterThan(0);
        expect(slope).toBeGreaterThan(level * 1.2);
    });
});

describe('winter bear: what it does when it stops', () => {
    const posture = createBearPosture();
    const spec = createBearSpec();
    const nose = () => bearPoint(posture, 'head', BEAR_MARKS.nose);

    it('reaches every paw on the ice in every act, and never puts its nose or a paw into the ice', () => {
        ACTS.forEach((name) => {
            const length = name === 'Lie' ? LIE_HOLD + 2 : BEAR_ACTS[name];
            for (let t = 0; t <= length; t += 0.1) {
                bearAct(spec, name, t);
                solveBear(spec, posture);
                BEAR_FEET.forEach((foot, i) => {
                    expect(bearPaw(posture, i)[1], `${name} ${foot.name} at ${t.toFixed(1)}`).toBeGreaterThan(-0.002);
                    expect(toeTip(posture, i)[1], `${name} ${foot.name}'s toes at ${t.toFixed(1)}`).toBeGreaterThan(-0.002);
                    if (footAt(spec, i, 'air') > 0.05 || footAt(spec, i, 'dy') > 0.01) return;
                    expect(posture.short[i], `${name} ${foot.name} at ${t.toFixed(1)}`).toBeLessThan(0.005);
                });
                expect(nose()[1], `${name}'s nose at ${t.toFixed(1)}`).toBeGreaterThan(0.08);
            }
        });
    });

    it('stands up on its hind legs to see further, its forelegs hanging before its belly', () => {
        solveBear(bearAct(spec, 'Rear', BEAR_ACTS.Rear / 2), posture);
        expect(nose()[1]).toBeGreaterThan(2.2);
        for (const side of ['L', 'R']) {
            const shoulder = posture.at[B[`arm${side}`]];
            const elbow = posture.at[B[`fore${side}`]];
            const wrist = posture.at[B[`hand${side}`]];
            // Hanging: the elbow under the shoulder, not folded back behind it; the wrist below
            // the elbow and out in front; the paw well off the ice.
            expect(shoulder[1] - elbow[1], side).toBeGreaterThan(0.25);
            expect(elbow[2] - shoulder[2], side).toBeGreaterThan(-0.05);
            expect(elbow[1] - wrist[1], side).toBeGreaterThan(0.15);
            expect(wrist[2] - elbow[2], side).toBeGreaterThan(0.1);
            expect(wrist[1], side).toBeGreaterThan(0.7);
        }
        expect(OWNS_FEET.Rear).toBe(true);
    });

    it('lies down with its chin over its paws, and getting up ends where it began, standing', () => {
        solveBear(bearAct(spec, 'Lie', LIE_HOLD + 1), posture);
        expect(posture.at[B.spine2][1]).toBeLessThan(0.62);
        expect(nose()[1]).toBeLessThan(0.4);
        // Getting up is lying down run backwards.
        solveBear(bearAct(spec, 'Rise', BEAR_ACTS.Rise), posture);
        expect(posture.at[B.spine2][1]).toBeCloseTo(BEAR_BONES[B.spine2][3], 3);
    });
});

describe('winter bear: the asset', () => {
    const { json, read: accessorData } = readGlb(ASSET);
    const prim = json.meshes[0].primitives[0];
    const skin = json.skins[0];
    const positions = accessorData(prim.attributes.POSITION);
    const count = positions.length / 3;

    it('is one skinned mesh on the rig\'s own skeleton: its bones, in its order, where the table has them', () => {
        expect(json.meshes).toHaveLength(1);
        expect(json.skins).toHaveLength(1);
        expect(skin.joints.map((node) => json.nodes[node].name)).toEqual(BEAR_BONES.map((bone) => bone[0]));
        const above = new Map();
        json.nodes.forEach((node, i) => (node.children ?? []).forEach((child) => above.set(child, i)));
        skin.joints.forEach((node, i) => {
            const [name, parent, ...at] = BEAR_BONES[i];
            expect(above.has(node) ? json.nodes[above.get(node)].name : null, name).toBe(parent);
            const place = [0, 0, 0];
            for (let n = node; n !== undefined; n = above.get(n)) {
                (json.nodes[n].translation ?? [0, 0, 0]).forEach((v, k) => {
                    place[k] += v;
                });
            }
            at.forEach((v, k) => expect(Math.abs(place[k] - v), `${name} ${'xyz'[k]}`).toBeLessThan(1e-5));
        });
        expect(json.animations ?? []).toEqual([]);
        expect(json.asset.generator).toMatch(/model-bear\.mjs/);
        expect(json.asset.extras?.winterBear).toBeGreaterThanOrEqual(2);
    });

    it('is under eighteen thousand triangles of sixteen-bit indices, standing on the ice', () => {
        const indices = accessorData(prim.indices);
        expect(json.accessors[prim.indices].componentType).toBe(5123);
        expect(indices.length / 3).toBeLessThanOrEqual(18000);
        expect(indices.every((v) => v < count)).toBe(true);
        let low = Infinity;
        for (let i = 0; i < count; i++) low = Math.min(low, positions[i * 3 + 1]);
        expect(Math.abs(low)).toBeLessThan(1e-3);
    });

    it('weighs every vertex to bones of the skeleton, and keeps each leg to its own side', () => {
        const joints = accessorData(prim.attributes.JOINTS_0);
        const weights = accessorData(prim.attributes.WEIGHTS_0);
        for (let i = 0; i < count; i++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                expect(joints[i * 4 + k]).toBeLessThan(BEAR_BONES.length);
                sum += weights[i * 4 + k];
            }
            expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            if (y > 0.6 || Math.abs(x) < 0.12) continue;
            for (let k = 0; k < 4; k++) {
                if (weights[i * 4 + k] < 0.02) continue;
                const name = BEAR_BONES[joints[i * 4 + k]][0];
                if (/^(arm|fore|hand|fing|thigh|shin|foot|toes)[LR]$/.test(name)) expect(name.endsWith(x > 0 ? 'L' : 'R'), `vertex ${i} on ${name}`).toBe(true);
            }
        }
    });

    it('paints the coat\'s four numbers into each vertex\'s colour: its black nose and claws, and the sky it sees', () => {
        expect(json.accessors[prim.attributes.COLOR_0]).toMatchObject({ type: 'VEC4', componentType: 5121, normalized: true });
        const colours = accessorData(prim.attributes.COLOR_0);
        /** The darkest paint within `r` of a point, and how many vertices are there. */
        const darkNear = (mark, r) => {
            let near = 0;
            let darkest = 0;
            for (let i = 0; i < count; i++) {
                const d = Math.hypot(positions[i * 3] - mark[0], positions[i * 3 + 1] - mark[1], positions[i * 3 + 2] - mark[2]);
                if (d < r) {
                    near += 1;
                    darkest = Math.max(darkest, colours[i * 4 + 2]);
                }
            }
            return { near, darkest };
        };
        const nose = darkNear(BEAR_MARKS.nose, 0.04);
        expect(nose.near).toBeGreaterThan(0);
        expect(nose.darkest).toBeGreaterThan(0.6);
        BEAR_FEET.forEach((foot) => {
            const claws = darkNear(BEAR_MARKS[`tip${foot.name}`], 0.06);
            expect(claws.near, foot.name).toBeGreaterThan(0);
            expect(claws.darkest, foot.name).toBeGreaterThan(0.6);
        });
        // Its back sees the sky, its belly and the insides of its legs much less.
        let back = 0;
        let under = 1;
        for (let i = 0; i < count; i++) {
            if (positions[i * 3 + 1] > 1.3) back = Math.max(back, colours[i * 4 + 3]);
            if (positions[i * 3 + 1] < 0.6 && positions[i * 3 + 1] > 0.3 && Math.abs(positions[i * 3]) < 0.1) {
                under = Math.min(under, colours[i * 4 + 3]);
            }
        }
        expect(back).toBeGreaterThan(0.9);
        expect(under).toBeLessThan(0.6);
    });
});

describe('winter bear: where it goes, and when', () => {
    it('walks a closed course, a whole number of strides to the lap, so its feet come round with it', () => {
        const course = bearCourse(LANDSCAPE);
        expect(Number.isInteger(course.strides)).toBe(true);
        expect(phaseAt(course, 3 + course.period) - phaseAt(course, 3)).toBeCloseTo(course.strides, 9);
        const a = bearOnCourse(course, 3, {});
        const b = bearOnCourse(course, 3 + course.period, {});
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.z).toBeCloseTo(a.z, 6);
        expect(b.act).toBe(a.act);
        // (Its squaring-up steps at a stop too: a regression had them fire early from the second
        // lap on, so a foot jumped across the ice in one frame.)
        for (const clock of [3, 120.4, 121.1, 160, 330.7]) {
            BEAR_FEET.forEach((foot, f) => {
                const now = pawAt(course, f, clock, {});
                const then = pawAt(course, f, clock + course.period, {});
                expect(then.x, `${foot.name} at ${clock}`).toBeCloseTo(now.x, 6);
                expect(then.z, `${foot.name} at ${clock}`).toBeCloseTo(now.z, 6);
                expect(then.lift, `${foot.name} at ${clock}`).toBeCloseTo(now.lift, 6);
            });
        }
    });

    it('is a function of its clock alone: any history of frames gives the pose a single step does', () => {
        const stepped = new BearMind(LANDSCAPE);
        for (let t = 0; t <= 95; t += 1 / 30) stepped.step(t);
        const at = 95.01;
        const a = stepped.step(at);
        const spec = [...a.spec];
        const paws = a.paws.map((paw) => ({ ...paw }));
        const b = new BearMind(LANDSCAPE).step(at);
        ['x', 'z', 'heading', 'speed', 'actTime', 'blend'].forEach((key) => expect(a[key], key).toBeCloseTo(b[key], 9));
        expect(a.act).toBe(b.act);
        spec.forEach((v, i) => expect(v, `spec[${i}]`).toBeCloseTo(b.spec[i], 9));
        paws.forEach((paw, i) => ['x', 'y', 'z', 'swing'].forEach((key) => expect(paw[key], `paw ${i} ${key}`).toBeCloseTo(b.paws[i][key], 9)));
    });

    it('walks on the lake\'s ice wherever the frame shows it, and only crosses land behind the trees', () => {
        for (const aspect of [LANDSCAPE, 21 / 9, 4 / 3, 430 / 932]) {
            for (const { route, pace } of BEAR_ROUTES) {
                const course = bearCourse(aspect, { route, pace });
                for (let i = 0; i < course.count; i++) {
                    const x = course.points[i * 3];
                    const z = course.points[i * 3 + 1];
                    if (lakeMask(x, z) >= 0.5) continue;
                    expect(Math.abs(fractionOf(x, z, aspect)), `${aspect.toFixed(2)} sample ${i}`).toBeGreaterThan(0.6);
                }
            }
            const course = bearCourse(aspect);
            for (let i = 0; i < course.count; i++) {
                const x = course.points[i * 3];
                const z = course.points[i * 3 + 1];
                if (lakeMask(x, z) >= 0.5) continue;
                expect(Math.abs(fractionOf(x, z, aspect)), `${aspect.toFixed(2)} sample ${i}`).toBeGreaterThan(0.6);
            }
        }
    });

    it('stops only in sight, on the open ice right of the board (or out of sight where its ways meet)', () => {
        BEAR_ROUTES.forEach(({ name, route }) => {
            // Every way sets out from where they meet, past the frame's right edge, standing a moment there.
            expect(route[0][0], name).toBe(BEAR_EDGE);
            expect(route[0][2][0], name).toBe('Stand');
            route.slice(1).filter((knot) => knot[2]).forEach(([fraction, dist, [act]]) => {
                expect(fraction, `${name}: ${act} at ${fraction}`).toBeGreaterThanOrEqual(WINDOW[0]);
                expect(fraction, `${name}: ${act} at ${fraction}`).toBeLessThanOrEqual(WINDOW[1]);
                expect(dist).toBeLessThan(150);
                expect(BEAR_ACTS[act], act).toBeTruthy();
            });
        });
    });

    it('knows several ways, all meeting in one place out of sight: past the right edge, at any width', () => {
        expect(BEAR_ROUTES.length).toBeGreaterThanOrEqual(5);
        expect(BEAR_ROUTES[0].route).toBe(BEAR_ROUTE);
        for (const aspect of [LANDSCAPE, 21 / 9, 32 / 9, 4 / 3, 430 / 932]) {
            const meets = BEAR_ROUTES.map(({ route, pace }) => {
                const course = bearCourse(aspect, { route, pace });
                return bearOnCourse(course, course.period - 0.01, {});
            });
            meets.forEach((at, i) => {
                const label = `${BEAR_ROUTES[i].name} at ${aspect.toFixed(2)}`;
                expect(fractionOf(at.x, at.z, aspect), label).toBeGreaterThan(1.05);
                // (The same place and nearly the same heading for every way, each sampled along its own
                // length: one way hands over to the next unseen.)
                expect(Math.hypot(at.x - meets[0].x, at.z - meets[0].z)).toBeLessThan(0.05);
                expect(Math.abs(at.heading - meets[0].heading)).toBeLessThan(0.03);
            });
        }
    });

    it('takes another way each time, never the same twice running, and is out of sight between them', () => {
        const mind = new BearMind(LANDSCAPE);
        const ways = [];
        let lap = -1;
        let away = 0;
        for (let t = 0; t < 3 * 3600; t += 1) {
            const clock = mind.clockAt(t);
            const n = mind.lapIndex(clock);
            const p = mind.step(t);
            if (n !== lap) {
                ways.push(mind.laps[n].way);
                lap = n;
                // A new lap begins where the ways meet, out of sight.
                if (n > 0) expect(fractionOf(p.x, p.z), `lap ${n}`).toBeGreaterThan(1.05);
            }
            if (fractionOf(p.x, p.z) > 1.05) away += 1;
        }
        expect(ways.length).toBeGreaterThan(25);
        expect(ways[0]).toBe(0);
        for (let i = 1; i < ways.length; i++) expect(ways[i]).not.toBe(ways[i - 1]);
        expect(new Set(ways).size).toBe(BEAR_ROUTES.length);
        mind.laps.forEach((l) => {
            expect(l.wait).toBeGreaterThanOrEqual(BEAR_AWAY[0]);
            expect(l.wait).toBeLessThanOrEqual(BEAR_AWAY[1]);
        });
        // Out of sight a while between its ways, but in sight most of the time.
        expect(away / (3 * 3600)).toBeGreaterThan(0.05);
        expect(away / (3 * 3600)).toBeLessThan(0.4);
    });

    it('is still a function of its clock alone many ways on', () => {
        const stepped = new BearMind(LANDSCAPE);
        for (let t = 1500; t <= 1530; t += 1 / 30) stepped.step(t);
        const a = stepped.step(1530.01);
        const spec = [...a.spec];
        const b = new BearMind(LANDSCAPE).step(1530.01);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.z).toBeCloseTo(b.z, 9);
        spec.forEach((v, i) => expect(v, `spec[${i}]`).toBeCloseTo(b.spec[i], 9));
    });

    it('comes out from behind the trees within seconds of the start, and spends much of its time in sight', () => {
        const mind = new BearMind(LANDSCAPE);
        const start = mind.step(0);
        expect(fractionOf(start.x, start.z)).toBeGreaterThan(WINDOW[1]);
        let arrived = null;
        let inWindow = 0;
        const { period } = mind.course;
        for (let t = 0; t < period; t += 0.5) {
            const p = mind.step(t);
            const f = fractionOf(p.x, p.z);
            if (f >= WINDOW[0] && f <= WINDOW[1]) {
                inWindow += 0.5;
                if (arrived === null) arrived = t;
            }
        }
        expect(arrived).toBeLessThan(15);
        expect(inWindow / period).toBeGreaterThan(0.3);
    });

    it('fits its course to another aspect without losing its place along it', () => {
        const mind = new BearMind(LANDSCAPE);
        mind.step(40);
        const before = (((mind.clockAt(40) % mind.course.period) + mind.course.period) % mind.course.period) / mind.course.period;
        mind.setAspect(430 / 932, 40);
        const after = (((mind.clockAt(40) % mind.course.period) + mind.course.period) % mind.course.period) / mind.course.period;
        expect(after).toBeCloseTo(before, 6);
    });
});

describe('winter bear: what the board makes it do', () => {
    /** The walked distance and the pose a mind gives at a time. */
    const at = (mind, t) => ({ ...mind.step(t) });

    it('stands up at a four, holds still under it, and walks on from where it stopped', () => {
        const mind = new BearMind(LANDSCAPE);
        // (Somewhere it is walking.)
        let t0 = 0;
        while (at(mind, t0).speed < BEAR_PACE * 0.99) t0 += 0.5;
        expect(mind.rear(t0)).toBe(true);
        // A second four while it is still up changes nothing.
        expect(mind.rear(t0 + 1)).toBe(false);
        const held = at(mind, t0 + BEAR_EASE + 0.5);
        expect(held.over).toBe('Rear');
        expect(held.overBlend).toBeGreaterThan(0.9);
        expect(held.speed).toBeLessThan(0.01);
        const later = at(mind, t0 + BEAR_ACTS.Rear - 0.5);
        expect(Math.abs(later.distance - held.distance)).toBeLessThan(0.02);
        // Let go, it picks up its walk where it stood: no jump from one frame to the next.
        let last = at(mind, t0 + BEAR_ACTS.Rear);
        for (let t = t0 + BEAR_ACTS.Rear; t < t0 + BEAR_ACTS.Rear + 2 * BEAR_EASE + 2; t += 1 / 60) {
            const p = at(mind, t);
            expect(Math.abs(p.distance - last.distance), `at ${t.toFixed(2)}`).toBeLessThan(BEAR_PACE / 60 + 1e-6);
            last = p;
        }
        expect(last.over).toBeNull();
        expect(last.speed).toBeGreaterThan(0.5 * BEAR_PACE);
        expect(mind.cut).toBeNull();
    });

    it('rises and drops back down with no joint jumping and no paw going into the ice', () => {
        const mind = new BearMind(LANDSCAPE);
        const posture = createBearPosture();
        let t0 = 30;
        while (at(mind, t0).speed < BEAR_PACE * 0.99) t0 += 0.5;
        let fired = false;
        let last = null;
        for (let t = t0 - 1; t < t0 + BEAR_ACTS.Rear + 2 * BEAR_EASE + 1; t += 1 / 60) {
            if (!fired && t >= t0) {
                mind.rear(t);
                fired = true;
            }
            const pose = mind.step(t);
            solveBear(pose.spec, posture);
            BEAR_FEET.forEach((foot, i) => {
                expect(overGround(inWorld(pose, bearPaw(posture, i))), `${foot.name} at ${(t - t0).toFixed(2)}`).toBeGreaterThan(-0.002);
            });
            const joints = posture.at.map((j) => inWorld(pose, j));
            if (last) {
                const { moved, bone } = fastestJoint(last, joints);
                expect(moved, `${bone} at ${(t - t0).toFixed(2)}`).toBeLessThan(0.15);
            }
            last = joints;
        }
    });

    it('lies down when the run ends and stays down until the next one, then gets up and walks on', () => {
        const mind = new BearMind(LANDSCAPE);
        let t0 = 20;
        while (at(mind, t0).speed < BEAR_PACE * 0.99) t0 += 0.5;
        mind.lie(t0);
        // A four while it lies does not get it up.
        expect(mind.rear(t0 + 2)).toBe(false);
        const down = at(mind, t0 + 10);
        const still = at(mind, t0 + 120);
        expect(still.over).toBe('Lie');
        expect(still.overTime).toBe(LIE_HOLD);
        expect(Math.abs(still.distance - down.distance)).toBeLessThan(1e-6);
        expect(mind.rise(t0 + 120)).toBe(true);
        expect(at(mind, t0 + 121).over).toBe('Rise');
        const walking = at(mind, t0 + 120 + BEAR_ACTS.Rise + 2 * BEAR_EASE + 3);
        expect(walking.over).toBeNull();
        expect(walking.distance).toBeGreaterThan(still.distance);
    });

    it('goes back to its start on a reset, with nothing the board did in flight', () => {
        const mind = new BearMind(LANDSCAPE);
        const fresh = at(mind, 50);
        mind.lie(30);
        mind.reset(0);
        const again = at(mind, 50);
        expect(again.x).toBeCloseTo(fresh.x, 9);
        expect(again.over).toBeNull();
    });
});
