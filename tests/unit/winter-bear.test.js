/**
 * Winter — the polar bear: its body (winter-bear-rig.js), the asset skinned to it
 * (assets/polar-bear.glb, modelled by scripts/winter/model-bear.mjs), and where it goes and when
 * (winter-bear-plan.js). No three, no GPU: its material is built in winter-shaders.test.js, its
 * place in the world in winter-world.test.js.
 *
 * What is pinned is what holds by construction or is the point of the design — a planted paw does
 * not slide, every leg reaches, its nose never goes into the ice, the walk is a function of its
 * clock alone, it walks where the game lets the lake be seen and only on ice there, the board's
 * stops hold it still and give it back where it was — not the tuning: lengths, paces and timings
 * are read from the modules.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    BEAR_ACTS, BEAR_BONES, BEAR_BONE_INDEX, BEAR_LEGS, BEAR_MARKS, BEAR_RIG, BEAR_SCALE, BEAR_WALK, FOOT, LIE_HOLD,
    bearSpec, bearStride, createBearPosture, createBearSpec, layWalk, solveBear,
} from '../../src/themes/winter/winter-bear-rig.js';
import {
    BEAR_EASE, BEAR_PACE, BEAR_ROUTE, BearMind, bearCourse, bearOnCourse,
} from '../../src/themes/winter/winter-bear-plan.js';
import { fovForAspect, lakeMask } from '../../src/themes/winter/winter-core.js';
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

    it('stands each leg over the paw it puts on the ice, the paw on the ice', () => {
        BEAR_LEGS.forEach(([, , , last, paw]) => {
            const joint = BEAR_BONES[BEAR_BONE_INDEX[last]];
            const mark = BEAR_MARKS[paw];
            expect(mark[1], paw).toBe(0);
            expect(Math.abs(joint[2] - mark[0]), paw).toBeLessThan(0.03);
            expect(Math.abs(joint[4] - mark[2]), paw).toBeLessThan(0.25);
        });
    });
});

describe('winter bear: its walk and its acts', () => {
    const posture = createBearPosture();
    const spec = createBearSpec();
    const paw = (leg) => BEAR_RIG.point(posture, leg[3], BEAR_MARKS[leg[4]]);

    it('reaches every paw through a whole stride at its pace: no leg is left short', () => {
        for (let i = 0; i < 120; i++) {
            solveBear(bearSpec({
                act: 'Walk', phase: i / 120, speed: BEAR_PACE, amp: 1,
            }, spec), posture);
            posture.short.forEach((short, k) => expect(short, `${BEAR_LEGS[k][0]} at ${i / 120}`).toBeLessThan(0.005));
        }
        // (The walk is laid over the stance as numbers: none of them is left behind at a stop.)
        expect([...layWalk(createBearSpec(), 0.3, BEAR_PACE, 0)].every((v) => v === 0)).toBe(true);
    });

    it('walks its four feet in turn, the left hind first, each on the ice two thirds of a stride', () => {
        const falls = BEAR_RIG.footfalls(BEAR_PACE);
        // FL FR BL BR: the left hind, the left fore, the right hind, the right fore.
        const order = [2, 0, 3, 1].map((leg) => falls[leg]);
        for (let i = 1; i < 4; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
        expect(BEAR_WALK.duty).toBeGreaterThan(0.6);
        expect(BEAR_RIG.gallop(BEAR_PACE)).toBe(0);
    });

    it('does not slide a planted paw: on the ice it stays where it was put while the body goes over it', () => {
        const stride = bearStride(BEAR_PACE);
        BEAR_LEGS.forEach((leg, k) => {
            // The middle of its stance, a fifth of a stride either side.
            const mid = BEAR_WALK.falls[k] + BEAR_WALK.duty / 2;
            const where = [];
            for (let i = -10; i <= 10; i++) {
                const phase = mid + (i / 10) * 0.2;
                solveBear(bearSpec({
                    act: 'Walk', phase, speed: BEAR_PACE, amp: 1,
                }, spec), posture);
                // The paw in the world: the body has walked `phase` strides.
                where.push(paw(leg)[2] * BEAR_SCALE + phase * stride);
            }
            expect(Math.max(...where) - Math.min(...where), leg[0]).toBeLessThan(0.03);
        });
    });

    it('reaches every planted paw in every act, and never puts its nose into the ice', () => {
        ACTS.forEach((name) => {
            const length = name === 'Lie' ? LIE_HOLD + 2 : BEAR_ACTS[name];
            for (let t = 0; t <= length; t += 0.1) {
                bearSpec({ act: name, actTime: t }, spec);
                solveBear(spec, posture);
                BEAR_LEGS.forEach((leg, k) => {
                    if (spec[FOOT[leg[0]] + FOOT.air] > 0.01) return;
                    expect(posture.short[k], `${name} ${leg[0]} at ${t.toFixed(1)}`).toBeLessThan(0.01);
                    expect(paw(leg)[1], `${name} ${leg[0]} at ${t.toFixed(1)}`).toBeGreaterThan(-0.005);
                });
                const nose = BEAR_RIG.point(posture, 'head', BEAR_MARKS.nose);
                expect(nose[1], `${name}'s nose at ${t.toFixed(1)}`).toBeGreaterThan(0.08);
            }
        });
    });

    it('stands up on its hind legs to see further, and lies down with its chin over its paws', () => {
        solveBear(bearSpec({ act: 'Rear', actTime: BEAR_ACTS.Rear / 2 }, spec), posture);
        const up = BEAR_RIG.point(posture, 'head', BEAR_MARKS.nose);
        expect(up[1]).toBeGreaterThan(2.2);
        solveBear(bearSpec({ act: 'Lie', actTime: LIE_HOLD + 1 }, spec), posture);
        expect(posture.at[BEAR_BONE_INDEX.spine][1]).toBeLessThan(0.62);
        expect(BEAR_RIG.point(posture, 'head', BEAR_MARKS.nose)[1]).toBeLessThan(0.4);
        // Getting up is lying down run backwards: it ends where it began, standing.
        solveBear(bearSpec({ act: 'Rise', actTime: BEAR_ACTS.Rise }, spec), posture);
        expect(posture.at[BEAR_BONE_INDEX.spine][1]).toBeCloseTo(BEAR_BONES[BEAR_BONE_INDEX.spine][3], 3);
    });

    it('lays what it was made to do over whatever it was doing, all the way at a blend of one', () => {
        const over = bearSpec({
            act: 'Walk', phase: 0.3, speed: BEAR_PACE, amp: 1, over: 'Rear', overTime: 3, overBlend: 1,
        }, createBearSpec());
        const alone = bearSpec({ act: 'Rear', actTime: 3 }, createBearSpec());
        over.forEach((v, i) => expect(v, `spec[${i}]`).toBeCloseTo(alone[i], 9));
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
        expect(json.asset.extras?.winterBear).toBeGreaterThan(0);
    });

    it('is a few thousand triangles of sixteen-bit indices, standing on the ice', () => {
        const indices = accessorData(prim.indices);
        expect(json.accessors[prim.indices].componentType).toBe(5123);
        expect(indices.length / 3).toBeLessThanOrEqual(8000);
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
                if (/(arm|fore|hand|thigh|shin|hock)[LR]$/.test(name)) expect(name.endsWith(x > 0 ? 'L' : 'R'), `vertex ${i} on ${name}`).toBe(true);
            }
        }
    });

    it('paints the coat\'s four numbers into each vertex\'s colour: its black nose, and the sky it sees', () => {
        expect(json.accessors[prim.attributes.COLOR_0]).toMatchObject({ type: 'VEC4', componentType: 5121, normalized: true });
        const colours = accessorData(prim.attributes.COLOR_0);
        let nose = 0;
        let darkest = 0;
        for (let i = 0; i < count; i++) {
            const d = Math.hypot(
                positions[i * 3] - BEAR_MARKS.nose[0],
                positions[i * 3 + 1] - BEAR_MARKS.nose[1],
                positions[i * 3 + 2] - BEAR_MARKS.nose[2],
            );
            if (d < 0.04) {
                nose += 1;
                darkest = Math.max(darkest, colours[i * 4 + 2]);
            }
        }
        expect(nose).toBeGreaterThan(0);
        expect(darkest).toBeGreaterThan(0.6);
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
    it('walks a closed course, a whole number of strides to the lap, so its gait comes round with it', () => {
        const course = bearCourse(LANDSCAPE);
        const laps = course.length / course.stride;
        expect(Math.abs(laps - Math.round(laps))).toBeLessThan(1e-9);
        const a = bearOnCourse(course, 3, {});
        const b = bearOnCourse(course, 3 + course.period, {});
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.z).toBeCloseTo(a.z, 6);
        expect(b.act).toBe(a.act);
        expect(Math.abs(b.phase - a.phase - Math.round(b.phase - a.phase))).toBeLessThan(1e-9);
    });

    it('is a function of its clock alone: any history of frames gives the pose a single step does', () => {
        const stepped = new BearMind(LANDSCAPE);
        for (let t = 0; t <= 95; t += 1 / 30) stepped.step(t);
        const at = 95.01;
        const a = { ...stepped.step(at) };
        const b = { ...new BearMind(LANDSCAPE).step(at) };
        ['x', 'z', 'heading', 'speed', 'phase', 'actTime', 'blend'].forEach((key) => expect(a[key], key).toBeCloseTo(b[key], 9));
        expect(a.act).toBe(b.act);
    });

    it('walks on the lake\'s ice wherever the frame shows it, and only crosses land behind the trees', () => {
        for (const aspect of [LANDSCAPE, 21 / 9, 4 / 3, 430 / 932]) {
            const course = bearCourse(aspect);
            for (let i = 0; i < course.count; i++) {
                const x = course.points[i * 3];
                const z = course.points[i * 3 + 1];
                if (lakeMask(x, z) >= 0.5) continue;
                expect(Math.abs(fractionOf(x, z, aspect)), `${aspect.toFixed(2)} sample ${i}`).toBeGreaterThan(0.6);
            }
        }
    });

    it('stops only where it can be seen, in the open ice right of the board', () => {
        BEAR_ROUTE.filter((knot) => knot[2]).forEach(([fraction, dist, [act]]) => {
            expect(fraction, `${act} at ${fraction}`).toBeGreaterThanOrEqual(WINDOW[0]);
            expect(fraction, `${act} at ${fraction}`).toBeLessThanOrEqual(WINDOW[1]);
            expect(dist).toBeLessThan(150);
            expect(BEAR_ACTS[act], act).toBeTruthy();
        });
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
