/**
 * Winter — the polar bears: the body (winter-bear-rig.js), the assets skinned to it
 * (assets/polar-bear.glb and polar-bear-cub.glb, modelled by scripts/winter/model-bear.mjs), and
 * where they go, how they put their feet down and what they do (winter-bear-plan.js). No three, no
 * GPU: the materials are built in winter-shaders.test.js, their place in the world in
 * winter-world.test.js.
 *
 * What is pinned is what holds by construction or is the point of the design — a planted paw does
 * not slide, every leg reaches the ground it stands on (over the spit's slopes too), no paw or toe
 * goes into the ground, no joint jumps from one frame to the next, at any pace and through
 * everything it does at a stop; the walk is a function of its clock and its seed alone; it walks
 * where the game lets the lake be seen and only on ice there; each lap is another deal (who walks
 * it, what it does, how fast) and never the same act twice running; a cub keeps behind its mother
 * and beside her; the board's stops hold it still and give it back where it was — not the tuning:
 * lengths, paces and timings are read from the modules.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import {
    BEAR_ACTS, BEAR_ACT_SPAN, BEAR_BONES, BEAR_BONE_INDEX, BEAR_FEET, BEAR_MARKS, BEAR_SCALE, BEAR_SPEC, FOOT, HEAD_ONLY,
    LIE_HOLD, OWNS_FEET, bearAct, bearPaw, bearPoint, createBearPosture, createBearSpec, solveBear,
} from '../../src/themes/winter/winter-bear-rig.js';
import {
    BEAR_AWAY, BEAR_CUB, BEAR_EASE, BEAR_EDGE, BEAR_GAIT, BEAR_KINDS, BEAR_PACE, BEAR_PACES, BEAR_ROUTE, BEAR_ROUTES,
    BearMind, bearCourse, bearLope, bearManner, bearOnCourse, bearPlace, bearStride, bearSwingTime, dealLap, pawAt, phaseAt,
} from '../../src/themes/winter/winter-bear-plan.js';
import { fovForAspect, groundHeight, lakeMask } from '../../src/themes/winter/winter-core.js';
import { readGlb } from '../../scripts/fox/glb-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = path.join(ROOT, 'src', 'themes', 'winter', 'assets');
const ASSET = path.join(ASSETS, 'polar-bear.glb');
const CUB_ASSET = path.join(ASSETS, 'polar-bear-cub.glb');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const LANDSCAPE = 16 / 9;
/** What it does, by name (its walk and standing are not acts that end). */
const ACTS = Object.keys(BEAR_ACTS).filter((name) => name !== 'Walk' && name !== 'Stand');
/** What it does at a stop of its own accord (not the board's acts, nor those of its head alone). */
const STOP_ACTS = ['Sniff', 'Scent', 'Look', 'Sit', 'Rest', 'Roll', 'Hunt', 'Dig', 'Stretch', 'Upright', 'Shake'];
/** The lengths an act is looked at with: its own, or both ends of the span it may be given. */
const lengthsOf = (name) => {
    if (BEAR_ACT_SPAN[name]) return [...BEAR_ACT_SPAN[name]];
    return [name === 'Lie' ? LIE_HOLD + 2 : BEAR_ACTS[name]];
};
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
/** A point of the body (model metres) where it stands in the world, at the animal's own size. */
const inWorld = (pose, v) => {
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const k = BEAR_SCALE * (pose.size ?? 1);
    return [pose.x + (v[0] * c + v[2] * s) * k, pose.y + v[1] * k, pose.z + (-v[0] * s + v[2] * c) * k];
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
/** How much quicker a bear of a size moves than the big male (its clock runs this much faster). */
const quickOf = (size) => 1 / Math.sqrt(size);
/** A pose's pace in the animal's own measure (the big male's metres and seconds). */
const ownPace = (pose) => pose.speed / (pose.size * quickOf(pose.size));
/**
 * The furthest a joint may go in a sixtieth of a second, in the animal's own measure. Walking,
 * the fastest is a paw swinging through: a third of a stride (half of one, loping) on a path that
 * starts and ends at rest. At a stop, the fastest thing it does is come down on its forepaws.
 */
const jointLimit = (pose) => {
    if (pose.act !== 'Walk') return 0.2;
    const pace = Math.max(BEAR_PACE, ownPace(pose));
    return ((pace / (bearLope(pace) > 0.5 ? 0.5 : BEAR_GAIT.swingShare)) * 1.875 * 1.25) / 60;
};

/**
 * Walk a mind from one world time to another, frame by frame, and gather the worst of what must
 * hold of the body it draws (the cub's, if asked), each in the animal's own measure: how far short
 * of the ground a paw that bears weight fell (`short`) and how far off it stood (`off`), how deep a
 * paw or the tips of its toes went into the ground (`under`), how far a planted paw moved from one
 * frame to the next (`slide`), and the fastest joint against what it is allowed (`joint`, 1 = all
 * of it). `onIce`: only where it stands on the lake's ice (the frame never shows it anywhere else).
 */
function watch(mind, from, to, { cub = false, fps = 60, onIce = false } = {}) {
    const posture = createBearPosture();
    const worst = {
        short: 0, off: 0, under: 0, slide: 0, joint: 0,
    };
    const where = {};
    const note = (key, value, label) => {
        if (value > worst[key]) {
            worst[key] = value;
            where[key] = label();
        }
    };
    let bearing = 0;
    let frames = 0;
    let last = null;
    for (let t = from; t < to; t += 1 / fps) {
        const grown = mind.step(t);
        const pose = cub ? grown.cub : grown;
        if (!pose.present || (onIce && lakeMask(pose.x, pose.z) < 0.99)) {
            last = null;
            continue;
        }
        solveBear(pose.spec, posture);
        const now = {
            joints: posture.at.map((at) => inWorld(pose, at)),
            balls: BEAR_FEET.map((_, i) => inWorld(pose, bearPaw(posture, i))),
            planted: pose.paws.map((paw) => paw.swing === 0 && paw.air < 0.05),
        };
        const { size } = pose;
        for (let i = 0; i < 4; i++) {
            const label = () => `${BEAR_FEET[i].name} at ${t.toFixed(2)} (${pose.act})`;
            if (pose.paws[i].air <= 0.05) {
                bearing += 1;
                note('short', posture.short[i], label);
                note('off', Math.abs(overGround(now.balls[i])) / size, label);
            }
            note('under', -Math.min(overGround(now.balls[i]), overGround(inWorld(pose, toeTip(posture, i)))) / size, label);
            if (last && now.planted[i] && last.planted[i]) {
                note('slide', Math.hypot(now.balls[i][0] - last.balls[i][0], now.balls[i][2] - last.balls[i][2]) / size, label);
            }
        }
        if (last) {
            const { moved, bone } = fastestJoint(last.joints, now.joints);
            const allowed = jointLimit(pose) * size * quickOf(size) * (60 / fps);
            note('joint', moved / allowed, () => `${bone} at ${t.toFixed(2)} (${pose.act})`);
        }
        last = now;
        frames += 1;
    }
    return {
        worst, where, bearing, frames,
    };
}
/**
 * What a watch must show of an animal that holds the ground. (A smaller bear measures the spit's
 * slope steeper for its size: a paw may stand a shade further off it.) `short` is how far a leg
 * may fall short of its planted paw (model metres).
 */
function expectHoldsTheGround({ worst, where }, { short = 0.005, off = 0.008, slide = 0.003 } = {}) {
    expect(worst.short, where.short).toBeLessThan(short);
    expect(worst.off, where.off).toBeLessThan(off);
    expect(worst.under, where.under).toBeLessThan(0.002);
    expect(worst.slide, where.slide).toBeLessThan(slide);
    expect(worst.joint, where.joint).toBeLessThan(1);
}
/** A lap's first and last moment (world seconds) for a mind whose clock is the world's. */
const lapSpan = (mind, n) => {
    mind.clockOf({ lap: n });
    const lap = mind.laps[n];
    return [lap.start + lap.wait, lap.start + lap.wait + lap.period];
};
/** A mind's laps dealt over a stretch of its clock. */
const lapsOver = (seconds, seed) => {
    const mind = new BearMind(LANDSCAPE, seed === undefined ? { start: 0 } : { start: 0, seed });
    mind.lapIndex(seconds);
    return mind;
};

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
    // The whole of its first lap from the start of its clock, sixty frames a second: its walk at
    // the paces the lap was dealt, every stop and what it does there, the spit's slopes.
    const mind = new BearMind(LANDSCAPE, { start: 0 });
    const { course } = mind;
    let lap = null;
    beforeAll(() => {
        lap = watch(mind, 0, mind.laps[0].period);
    });

    it('walks its four feet in turn, the left hind first, each on the ice two thirds of a stride', () => {
        // FL FR BL BR: the left hind, the left fore, the right hind, the right fore.
        const order = [2, 0, 3, 1].map((leg) => BEAR_GAIT.falls[leg]);
        for (let i = 1; i < 4; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
        expect(1 - BEAR_GAIT.swingShare).toBeGreaterThan(0.6);
    });

    it('reaches the ground under every paw that bears its weight, a whole lap round, over the spit too', () => {
        expect(lap.worst.short, lap.where.short).toBeLessThan(0.005);
        expect(lap.worst.off, lap.where.off).toBeLessThan(0.006);
        // (Most of the time at least two paws bear it: they come off their weight as their heels peel.)
        expect(lap.bearing).toBeGreaterThan(lap.frames * 1.5);
        // (The lap does climb: its course crosses the back of a spit of snow behind the trees.)
        expect(Math.max(...course.grade.map(Math.abs))).toBeGreaterThan(0.15);
    });

    it('never puts a paw or the tips of its toes into the ground, setting down or swinging through', () => {
        expect(lap.worst.under, lap.where.under).toBeLessThan(0.002);
    });

    it('does not slide a planted paw, and moves every joint smoothly, frame by frame', () => {
        expect(lap.worst.slide, lap.where.slide).toBeLessThan(0.003);
        expect(lap.worst.joint, lap.where.joint).toBeLessThan(1);
    });

    it('takes shorter steps on a slope than on the level ice', () => {
        // Strides a metre at its pace on its first way: where the ground is level, and where it is steep.
        const plain = bearCourse(LANDSCAPE);
        const rate = (steep) => {
            for (let c = 0; c < plain.period - 1; c += 0.25) {
                const a = bearOnCourse(plain, c, {});
                const b = bearOnCourse(plain, c + 0.5, {});
                if (a.speed < BEAR_PACE * 0.999 || b.speed < BEAR_PACE * 0.999) continue;
                const i = Math.floor(((((a.distance % plain.length) + plain.length) % plain.length) / plain.length) * plain.count);
                const g = Math.abs(plain.grade[i]);
                if (steep ? g > 0.15 : g < 0.01) return (phaseAt(plain, c + 0.5) - phaseAt(plain, c)) / (b.distance - a.distance);
            }
            return null;
        };
        const level = rate(false);
        const slope = rate(true);
        expect(level).toBeGreaterThan(0);
        expect(slope).toBeGreaterThan(level * 1.2);
    });

    it('never walks in slow motion: slower, its strides are shorter and its paws swing no slower', () => {
        const { amble, walk, brisk } = BEAR_PACES;
        expect(amble).toBeLessThan(walk);
        expect(brisk).toBeGreaterThan(walk);
        expect(bearStride(amble)).toBeLessThan(bearStride(walk) * 0.85);
        for (let v = 0.2; v <= 3.4; v += 0.1) {
            expect(bearSwingTime(v), `swing at ${v.toFixed(1)}`).toBeLessThanOrEqual(BEAR_GAIT.swingTime[1] + 1e-9);
            expect(bearSwingTime(v), `swing at ${v.toFixed(1)}`).toBeGreaterThan(0.3);
        }
        // Brisker than its walk it steps quicker, not further: its stride has a longest.
        expect(bearStride(brisk)).toBeLessThanOrEqual(BEAR_GAIT.strideMost);
        expect(brisk / bearStride(brisk)).toBeGreaterThan((walk / bearStride(walk)) * 1.2);
        // How it carries itself goes with its pace: ambling, walking, brisk, loping.
        expect(bearManner(amble)).toBe(-1);
        expect(bearManner(walk)).toBeCloseTo(0, 9);
        expect(bearManner(brisk)).toBeCloseTo(1, 9);
        expect(bearManner(BEAR_PACES.lope)).toBe(2);
        expect(bearLope(brisk)).toBe(0);
        expect(bearLope(BEAR_PACES.lope)).toBe(1);
    });
});

describe('winter bear: what it does when it stops', () => {
    const posture = createBearPosture();
    const spec = createBearSpec();
    const nose = () => bearPoint(posture, 'head', BEAR_MARKS.nose);
    const pose = (name, t, length) => solveBear(bearAct(spec, name, t, length), posture);

    it('reaches every paw on the ice in every act, and never puts its nose or a paw into the ice', () => {
        ACTS.forEach((name) => {
            lengthsOf(name).forEach((length) => {
                for (let t = 0; t <= length; t += 0.05) {
                    pose(name, t, length);
                    BEAR_FEET.forEach((foot, i) => {
                        expect(bearPaw(posture, i)[1], `${name} ${foot.name} at ${t.toFixed(2)}`).toBeGreaterThan(-0.002);
                        expect(toeTip(posture, i)[1], `${name} ${foot.name}'s toes at ${t.toFixed(2)}`).toBeGreaterThan(-0.002);
                        if (footAt(spec, i, 'air') > 0.05 || footAt(spec, i, 'dy') > 0.01) return;
                        expect(posture.short[i], `${name} ${foot.name} at ${t.toFixed(2)}`).toBeLessThan(0.005);
                    });
                    expect(nose()[1], `${name}'s nose at ${t.toFixed(2)}`).toBeGreaterThan(0.08);
                }
            });
        });
    });

    it('moves no joint in a jump in any act, at sixty frames a second', () => {
        ACTS.forEach((name) => {
            lengthsOf(name).forEach((length) => {
                let last = null;
                for (let t = 0; t <= length; t += 1 / 60) {
                    pose(name, t, length);
                    const now = posture.at.map((at) => [...at]);
                    if (last) {
                        const { moved, bone } = fastestJoint(last, now);
                        // (Model metres a frame: the fastest is its head as it comes down on its forepaws.)
                        expect(moved, `${name} ${bone} at ${t.toFixed(2)}`).toBeLessThan(0.14);
                    }
                    last = now;
                }
            });
        });
    });

    it('ends everything it does at a stop standing as it began, so its walk picks up from it', () => {
        const stand = [...bearAct(createBearSpec(), 'Stand', 0)];
        STOP_ACTS.filter((name) => name !== 'Look').forEach((name) => {
            lengthsOf(name).forEach((length) => {
                bearAct(spec, name, length, length);
                spec.forEach((v, i) => expect(Math.abs(v - stand[i]), `${name} spec[${i}]`).toBeLessThan(1e-6));
                // ...and began there too (a stop is cross-faded in from its walk).
                bearAct(spec, name, 0, length);
                for (let i = BEAR_SPEC.feet; i < spec.length; i++) expect(Math.abs(spec[i]), `${name} spec[${i}] at 0`).toBeLessThan(1e-6);
            });
        });
    });

    it('stands up on its hind legs to see further, its forelegs hanging before its belly', () => {
        pose('Rear', BEAR_ACTS.Rear / 2);
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
        // Of its own accord it stands up as tall, for a shorter while.
        pose('Upright', 2.5);
        expect(nose()[1]).toBeGreaterThan(2.2);
        expect(BEAR_ACTS.Upright).toBeLessThan(BEAR_ACTS.Rear);
    });

    it('lies down with its chin over its paws, and getting up ends where it began, standing', () => {
        pose('Lie', LIE_HOLD + 1);
        expect(posture.at[B.spine2][1]).toBeLessThan(0.62);
        expect(nose()[1]).toBeLessThan(0.4);
        // Getting up is lying down run backwards.
        pose('Rise', BEAR_ACTS.Rise);
        expect(posture.at[B.spine2][1]).toBeCloseTo(BEAR_BONES[B.spine2][3], 3);
    });

    it('sits on its haunches: hips down on its heels, forelegs straight under its shoulders, head up', () => {
        lengthsOf('Sit').forEach((length) => {
            pose('Sit', length / 2, length);
            expect(posture.at[B.pelvis][1], 'hips').toBeLessThan(0.62);
            expect(posture.at[B.chest][1], 'chest').toBeGreaterThan(0.9);
            expect(nose()[1], 'nose').toBeGreaterThan(1.0);
            for (let i = 0; i < 4; i++) {
                expect(bearPaw(posture, i)[1], BEAR_FEET[i].name).toBeLessThan(0.005);
                expect(posture.short[i], BEAR_FEET[i].name).toBeLessThan(0.005);
            }
            // Its forelegs are all but straight: the elbow near the line from shoulder to wrist.
            const shoulder = posture.at[B.armL];
            const wrist = posture.at[B.handL];
            const reach = Math.hypot(shoulder[0] - wrist[0], shoulder[1] - wrist[1], shoulder[2] - wrist[2]);
            const upper = Math.hypot(...[0, 1, 2].map((k) => BEAR_BONES[B.armL][2 + k] - BEAR_BONES[B.foreL][2 + k]));
            const lower = Math.hypot(...[0, 1, 2].map((k) => BEAR_BONES[B.foreL][2 + k] - BEAR_BONES[B.handL][2 + k]));
            expect(reach / (upper + lower)).toBeGreaterThan(0.85);
        });
    });

    it('rests on its chest like a sphinx with its head up, and lays its chin down only on a long rest', () => {
        const [short, long] = BEAR_ACT_SPAN.Rest;
        pose('Rest', short / 2, short);
        expect(posture.at[B.spine2][1]).toBeLessThan(0.62);
        const up = nose()[1];
        expect(up).toBeGreaterThan(0.6);
        pose('Rest', long / 2, long);
        expect(nose()[1]).toBeLessThan(0.4);
        expect(nose()[1]).toBeLessThan(up - 0.25);
    });

    it('rolls over onto its back for a snow bath, all four paws in the air, and gets up square', () => {
        // On its back: its spine low, what was its top turned down, every paw well off the ice.
        pose('Roll', 6);
        expect(posture.at[B.spine2][1]).toBeLessThan(0.55);
        const belly = bearPoint(posture, 'chest', [0, BEAR_BONES[B.chest][3] - 0.4, BEAR_BONES[B.chest][4]]);
        expect(belly[1] - posture.at[B.chest][1], 'its belly over its back').toBeGreaterThan(0.25);
        for (let i = 0; i < 4; i++) expect(bearPaw(posture, i)[1], BEAR_FEET[i].name).toBeGreaterThan(0.4);
        // It wriggles there: its back is not still.
        const a = [...posture.at[B.pelvis]];
        pose('Roll', 6.4);
        expect(Math.hypot(a[0] - posture.at[B.pelvis][0], a[1] - posture.at[B.pelvis][1])).toBeGreaterThan(0.02);
        // Up again before it shakes: standing on four paws.
        pose('Roll', 13);
        expect(posture.at[B.spine2][1]).toBeGreaterThan(1.0);
        for (let i = 0; i < 4; i++) expect(bearPaw(posture, i)[1], BEAR_FEET[i].name).toBeLessThan(0.005);
    });

    it('hunts at a seal hole: holds quite still, rears, and comes down on both forepaws', () => {
        // Listening: its head low, and nothing but its head moving, and that slowly.
        pose('Hunt', 2);
        expect(nose()[1]).toBeLessThan(0.6);
        const still = posture.at.map((at) => [...at]);
        pose('Hunt', 2.5);
        expect(fastestJoint(still, posture.at).moved).toBeLessThan(0.05);
        expect(Math.abs(posture.at[B.chest][1] - still[B.chest][1])).toBeLessThan(1e-3);
        // Up: its chest well over where it stands, both forepaws off the ice.
        pose('Hunt', 5.0);
        expect(posture.at[B.chest][1]).toBeGreaterThan(BEAR_BONES[B.chest][3] + 0.3);
        expect(bearPaw(posture, 0)[1]).toBeGreaterThan(0.3);
        expect(bearPaw(posture, 1)[1]).toBeGreaterThan(0.3);
        // Down: both forepaws on the ice ahead of where they stood, its chest low over them.
        pose('Hunt', 5.7);
        for (const i of [0, 1]) {
            expect(bearPaw(posture, i)[1]).toBeLessThan(0.005);
            expect(bearPaw(posture, i)[2]).toBeGreaterThan(BEAR_MARKS[BEAR_FEET[i].paw][2] + 0.12);
        }
        expect(posture.at[B.chest][1]).toBeLessThan(BEAR_BONES[B.chest][3] - 0.15);
    });

    it('does things whose outlines differ: how high its hips, its chest and its nose are', () => {
        // The moment each is most itself: [act, seconds in, its length].
        const moments = [
            ['Stand', 0], ['Sniff', 3], ['Scent', 3], ['Sit', 5.5], ['Rest', 4.5, BEAR_ACT_SPAN.Rest[0]], ['Roll', 6], ['Hunt', 5.0],
            ['Hunt', 8], ['Stretch', 2.8], ['Upright', 2.5],
        ];
        const outline = moments.map(([name, t, length]) => {
            pose(name, t, length);
            return [posture.at[B.pelvis][1], posture.at[B.chest][1], nose()[1]];
        });
        for (let i = 0; i < outline.length; i++) {
            for (let j = i + 1; j < outline.length; j++) {
                const apart = Math.hypot(...outline[i].map((v, k) => v - outline[j][k]));
                expect(apart, `${moments[i][0]} at ${moments[i][1]} against ${moments[j][0]} at ${moments[j][1]}`).toBeGreaterThan(0.2);
            }
        }
    });

    it('moves its head alone to scent the wind or to glance at something', () => {
        Object.keys(HEAD_ONLY).forEach((name) => {
            bearAct(spec, name, BEAR_ACTS[name] / 2, BEAR_ACTS[name], 0.9);
            const head = new Set([BEAR_SPEC.headYaw, BEAR_SPEC.headPitch, BEAR_SPEC.headRoll, BEAR_SPEC.reach, BEAR_SPEC.earL, BEAR_SPEC.earR]);
            spec.forEach((v, i) => {
                if (!head.has(i)) expect(v, `${name} spec[${i}]`).toBe(0);
            });
        });
        // A glance looks where it is told, as far as its neck turns.
        expect(bearAct(spec, 'Glance', 1, BEAR_ACTS.Glance, 0.7)[BEAR_SPEC.headYaw]).toBeCloseTo(0.7, 3);
        expect(bearAct(spec, 'Glance', 1, BEAR_ACTS.Glance, -0.7)[BEAR_SPEC.headYaw]).toBeCloseTo(-0.7, 3);
        expect(Math.abs(bearAct(spec, 'Glance', 1, BEAR_ACTS.Glance, 3)[BEAR_SPEC.headYaw])).toBeLessThan(1.3);
        expect(bearAct(spec, 'Wind', 1.5)[BEAR_SPEC.headPitch]).toBeGreaterThan(0.4);
    });
});

/**
 * Each body's asset: [what it is, its file, the most triangles it may have, how far round the tip of
 * its nose its dark pad is looked for (m), the fewest dark vertices its two eyes hold]. The cub's
 * mesh is the coarser (it is drawn half the size), so its nose and eyes hold fewer vertices: three
 * within the grown bear's 4 cm of its nose, five within 6 cm, every one of them black; one each
 * side for its eyes.
 */
const BODIES = [['the grown bear', ASSET, 18000, 0.04, 6], ['the cub', CUB_ASSET, 7300, 0.06, 2]];

describe.each(BODIES)('winter bear: the asset of %s', (who, file, budget, noseRoom, eyesLeast) => {
    const { json, read: accessorData } = readGlb(file);
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
        expect(json.asset.extras?.winterBear).toBeGreaterThanOrEqual(3);
    });

    it('keeps to its budget of triangles, of sixteen-bit indices, standing on the ice', () => {
        const indices = accessorData(prim.indices);
        expect(json.accessors[prim.indices].componentType).toBe(5123);
        expect(indices.length / 3).toBeLessThanOrEqual(budget);
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

    it('paints the coat\'s four numbers into each vertex\'s colour: its black nose, eyes and claws, and the sky it sees', () => {
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
        // (Each body says where its own nose is: a cub's muzzle is shorter.)
        const tip = json.asset.extras.nose;
        const nose = darkNear(tip, noseRoom);
        expect(nose.near).toBeGreaterThan(3);
        expect(nose.darkest).toBeGreaterThan(0.8);
        BEAR_FEET.forEach((foot) => {
            const claws = darkNear(BEAR_MARKS[`tip${foot.name}`], 0.07);
            expect(claws.near, foot.name).toBeGreaterThan(0);
            expect(claws.darkest, foot.name).toBeGreaterThan(0.6);
        });
        // Its eyes are dark, one each side of its head, with paler coat between them and its nose.
        let eyes = 0;
        const sides = new Set();
        for (let i = 0; i < count; i++) {
            const z = positions[i * 3 + 2];
            if (colours[i * 4 + 2] > 0.6 && positions[i * 3 + 1] > tip[1] + 0.04 && z < tip[2] - 0.1 && z > tip[2] - 0.32
                && Math.abs(positions[i * 3]) > 0.04) {
                eyes += 1;
                sides.add(Math.sign(positions[i * 3]));
            }
        }
        expect(eyes).toBeGreaterThanOrEqual(eyesLeast);
        expect(sides.size).toBe(2);
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

describe('winter bear: the cub\'s body against its mother\'s', () => {
    /** How broad a body is across its skull, its ears and its forelegs, and how far its nose is from its skull. */
    const measure = (file) => {
        const { json, read: accessorData } = readGlb(file);
        const prim = json.meshes[0].primitives[0];
        const positions = accessorData(prim.attributes.POSITION);
        const joints = accessorData(prim.attributes.JOINTS_0);
        const weights = accessorData(prim.attributes.WEIGHTS_0);
        const widest = (bones, low = -Infinity, high = Infinity) => {
            let wide = 0;
            for (let i = 0; i < positions.length / 3; i++) {
                let share = 0;
                for (let k = 0; k < 4; k++) if (bones.includes(BEAR_BONES[joints[i * 4 + k]][0])) share += weights[i * 4 + k];
                const y = positions[i * 3 + 1];
                if (share > 0.45 && y > low && y < high) wide = Math.max(wide, Math.abs(positions[i * 3]));
            }
            return wide;
        };
        return {
            skull: widest(['head']),
            ears: widest(['earL', 'earR']) - BEAR_BONES[B.earL][2],
            foreleg: widest(['foreL'], 0.3, 0.45) - BEAR_BONES[B.foreL][2],
            muzzle: json.asset.extras.nose[2] - BEAR_BONES[B.head][4],
            triangles: accessorData(prim.indices).length / 3,
        };
    };
    it('has a bigger head and ears for its body, a shorter muzzle and thicker legs, in fewer triangles', () => {
        const grown = measure(ASSET);
        const cub = measure(CUB_ASSET);
        expect(cub.skull).toBeGreaterThan(grown.skull * 1.15);
        expect(cub.ears).toBeGreaterThan(grown.ears * 1.2);
        expect(cub.foreleg).toBeGreaterThan(grown.foreleg * 1.1);
        expect(cub.muzzle).toBeLessThan(grown.muzzle);
        expect(cub.triangles).toBeLessThan(grown.triangles * 0.5);
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

    it('walks a route given alone as it always has: every leg at the one pace, each stop as the route says', () => {
        BEAR_ROUTES.forEach(({ name, route, pace }) => {
            const course = bearCourse(LANDSCAPE, { route, pace });
            const stops = course.segments.filter((s) => s.kind === 'stop');
            const marked = route.filter((knot) => knot[2]);
            // (From its first stop round to it again: the route's stops in order, its first last.)
            expect(stops.map((s) => [s.act, s.duration]), name).toEqual([...marked.slice(1), marked[0]].map((knot) => [...knot[2]]));
            course.segments.filter((s) => s.kind === 'move').forEach((s) => {
                expect(Math.max(s.v0, s.v1), name).toBeCloseTo(pace, 9);
                expect([s.m0, s.m1], name).toEqual([0, 0]);
            });
        });
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
        const onIceWhereSeen = (course, aspect, label) => {
            const { size } = course;
            for (let i = 0; i < course.count; i++) {
                const x = course.points[i * 3] * size;
                const z = course.points[i * 3 + 1] * size;
                if (lakeMask(x, z) >= 0.5) continue;
                expect(Math.abs(fractionOf(x, z, aspect)), `${label} at ${aspect.toFixed(2)} sample ${i}`).toBeGreaterThan(0.6);
            }
        };
        for (const aspect of [LANDSCAPE, 21 / 9, 4 / 3, 430 / 932]) {
            BEAR_ROUTES.forEach(({ name, route, pace }) => onIceWhereSeen(bearCourse(aspect, { route, pace }), aspect, name));
            // ...and so do a smaller bear's own course and a cub's way beside its mother's.
            const mind = new BearMind(aspect, { start: 0 });
            mind.clockOf({ lap: 14 });
            mind.laps.forEach((lap) => {
                onIceWhereSeen(mind.courseOf(lap), aspect, `lap ${lap.n}`);
                if (lap.deal.cub) onIceWhereSeen(mind.cubCourseOf(lap), aspect, `lap ${lap.n}'s cub`);
            });
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
        // A dealt lap stops at the route's own places and nowhere else.
        const mind = lapsOver(3600);
        mind.laps.forEach(({ deal }) => {
            const { route } = BEAR_ROUTES[deal.way];
            expect(deal.stops[0].k).toBe(0);
            deal.stops.slice(1).forEach((stop) => expect(route[stop.k][2], `lap ${deal.n} knot ${stop.k}`).toBeTruthy());
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

    it('is still a function of its clock alone many ways on, a cub with it', () => {
        // (A moment of a lap with a cub, far into the night.)
        const at = new BearMind(LANDSCAPE).clockOf({ holds: (deal) => deal.family, from: 5, seconds: 61.3 });
        const stepped = new BearMind(LANDSCAPE, { start: 0 });
        for (let t = at - 30; t <= at - 0.01; t += 1 / 30) stepped.step(t);
        const a = stepped.step(at);
        const spec = [...a.spec];
        const cubSpec = [...a.cub.spec];
        const b = new BearMind(LANDSCAPE, { start: 0 }).step(at);
        expect(a.cub.present).toBe(true);
        expect(b.cub.present).toBe(true);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.z).toBeCloseTo(b.z, 9);
        expect(a.cub.x).toBeCloseTo(b.cub.x, 9);
        expect(a.cub.z).toBeCloseTo(b.cub.z, 9);
        spec.forEach((v, i) => expect(v, `spec[${i}]`).toBeCloseTo(b.spec[i], 9));
        cubSpec.forEach((v, i) => expect(v, `the cub's spec[${i}]`).toBeCloseTo(b.cub.spec[i], 9));
    });

    it('comes out from behind the trees within seconds of the start, and spends much of its time in sight', () => {
        const mind = new BearMind(LANDSCAPE);
        const start = mind.step(0);
        expect(fractionOf(start.x, start.z)).toBeGreaterThan(WINDOW[1]);
        let arrived = null;
        let inWindow = 0;
        const { period } = mind.laps[0];
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
        const share = () => {
            const lap = mind.laps[mind.lapIndex(mind.clockAt(40))];
            return [lap.n, (mind.clockAt(40) - lap.start - lap.wait) / lap.period];
        };
        const before = share();
        mind.setAspect(430 / 932, 40);
        const after = share();
        expect(after[0]).toBe(before[0]);
        expect(after[1]).toBeCloseTo(before[1], 6);
        // ...many laps on too, on whichever lap it is.
        const late = new BearMind(LANDSCAPE, { start: 0 });
        late.step(2000);
        const lap = late.laps[late.lapIndex(2000)];
        const into = (2000 - lap.start - lap.wait) / lap.period;
        late.setAspect(4 / 3, 2000);
        const clock = late.clockAt(2000);
        const now = late.laps[late.lapIndex(clock)];
        expect(now.n).toBe(lap.n);
        if (into > 0) expect((clock - now.start - now.wait) / now.period).toBeCloseTo(into, 6);
    });
});

describe('winter bear: what each lap holds', () => {
    const HOURS = 3 * 3600;

    it('deals a lap from its seed and the lap\'s number alone', () => {
        const a = lapsOver(HOURS);
        const b = lapsOver(HOURS);
        expect(a.laps.length).toBe(b.laps.length);
        a.laps.forEach((lap, n) => {
            expect(JSON.stringify(lap.deal), `lap ${n}`).toBe(JSON.stringify(b.laps[n].deal));
            expect(lap.start).toBe(b.laps[n].start);
            // (Dealt on its own it is the same lap, but for the lope the laid way then places.)
            const alone = dealLap(a.seed, n, lap.way, n > 0 ? a.laps[n - 1].deal : null);
            expect(alone.stops, `lap ${n}`).toEqual(lap.deal.stops);
            expect([alone.kind, alone.family, alone.size, alone.tone], `lap ${n}`).toEqual([lap.deal.kind, lap.deal.family, lap.deal.size, lap.deal.tone]);
        });
        // Another seed, another night.
        const other = lapsOver(HOURS, 7);
        expect(JSON.stringify(other.laps.slice(0, 6).map((lap) => lap.deal))).not.toBe(JSON.stringify(a.laps.slice(0, 6).map((lap) => lap.deal)));
    });

    it('sends the big male first, then whoever comes: he, a smaller and slimmer female, or a female with her cub', () => {
        for (const seed of [undefined, 7, 12345]) {
            const mind = lapsOver(HOURS, seed);
            const first = mind.laps[0].deal;
            expect([first.kind, first.family, first.size, first.cub]).toEqual(['male', false, 1, null]);
            const cast = { male: 0, female: 0, family: 0 };
            mind.laps.forEach(({ deal }) => {
                cast[deal.family ? 'family' : deal.kind] += 1;
                const kind = BEAR_KINDS[deal.kind];
                if (deal.n > 0) {
                    expect(deal.size, `lap ${deal.n}`).toBeGreaterThanOrEqual(kind.size[0]);
                    expect(deal.size, `lap ${deal.n}`).toBeLessThanOrEqual(kind.size[1]);
                    expect(deal.tone, `lap ${deal.n}`).toBeGreaterThanOrEqual(kind.tone[0]);
                    expect(deal.tone, `lap ${deal.n}`).toBeLessThanOrEqual(kind.tone[1]);
                }
                expect(deal.slim).toBe(kind.slim);
                expect(Boolean(deal.cub)).toBe(deal.family);
                if (deal.cub) {
                    expect(deal.kind).toBe('female');
                    expect(deal.cub.size).toBeGreaterThanOrEqual(BEAR_CUB.size[0]);
                    expect(deal.cub.size).toBeLessThanOrEqual(BEAR_CUB.size[1]);
                }
            });
            // Each of them a fair share of the laps.
            Object.entries(cast).forEach(([who, laps]) => expect(laps / mind.laps.length, `${who} of seed ${seed}`).toBeGreaterThan(0.12));
        }
        expect(BEAR_KINDS.female.size[1]).toBeLessThan(BEAR_KINDS.male.size[0]);
        expect(BEAR_KINDS.female.slim).toBeLessThan(BEAR_KINDS.male.slim);
    });

    it('does something else at every stop: never the same twice running, and everything it knows within hours', () => {
        for (const seed of [undefined, 7, 12345]) {
            const mind = lapsOver(HOURS, seed);
            const done = [];
            mind.laps.forEach((lap) => {
                // (What its timeline really holds, in the order it comes to it; where its ways meet it only stands.)
                const stops = mind.courseOf(lap).segments.filter((s) => s.kind === 'stop').map((s) => s.act);
                expect(stops.pop()).toBe('Stand');
                expect(stops.length, `lap ${lap.n}`).toBeGreaterThan(0);
                done.push(...stops);
                // (The long ones at most once a lap.)
                ['Rest', 'Roll', 'Hunt'].forEach((act) => expect(stops.filter((name) => name === act).length, `${act} in lap ${lap.n}`).toBeLessThanOrEqual(1));
            });
            for (let i = 1; i < done.length; i++) expect(done[i], `stop ${i} of seed ${seed}`).not.toBe(done[i - 1]);
            STOP_ACTS.forEach((act) => expect(done, `seed ${seed}`).toContain(act));
            // No one thing is most of what it does.
            const most = Math.max(...STOP_ACTS.map((act) => done.filter((name) => name === act).length));
            expect(most / done.length).toBeLessThan(0.2);
            // Every stop is as long as what it does there.
            mind.laps.forEach(({ deal }) => deal.stops.slice(1).forEach(({ act, seconds }) => {
                const span = BEAR_ACT_SPAN[act];
                if (span) {
                    expect(seconds).toBeGreaterThanOrEqual(span[0]);
                    expect(seconds).toBeLessThanOrEqual(span[1]);
                } else if (act !== 'Stand') expect(seconds).toBe(BEAR_ACTS[act]);
            }));
        }
    });

    it('goes at another pace from leg to leg: ambling, walking, briskly, and now and then a lope', () => {
        const mind = lapsOver(HOURS);
        const paces = new Set();
        let lopes = 0;
        mind.laps.forEach((lap) => {
            const course = mind.courseOf(lap);
            const { deal } = lap;
            const moves = course.segments.filter((s) => s.kind === 'move');
            moves.forEach((s) => {
                if (s.v0 === s.v1) paces.add(s.v0);
            });
            // It comes to rest from a walk, never from a lope, and sets off the same way.
            moves.filter((s) => s.v0 === 0 || s.v1 === 0).forEach((s) => expect(Math.max(s.v0, s.v1), `lap ${lap.n}`).toBeLessThanOrEqual(BEAR_PACES.brisk));
            const loped = moves.filter((s) => s.v0 === s.v1 && s.v0 === BEAR_PACES.lope);
            if (!loped.length) return;
            lopes += 1;
            // A lope: once a lap, not with a cub, over level ice the frame can show, a few seconds of it.
            expect(loped).toHaveLength(1);
            expect(deal.family).toBe(false);
            const [run] = loped;
            expect(run.duration).toBeGreaterThan(2);
            expect(run.duration).toBeLessThan(30);
            for (let d = run.walked; d <= run.walked + run.length; d += 1) {
                const at = bearPlace(course, course.origin + d);
                const [x, z] = [at[0] * deal.size, at[1] * deal.size];
                expect(lakeMask(x, z), `lap ${lap.n}`).toBeGreaterThan(0.9);
                expect(Math.abs(fractionOf(x, z)), `lap ${lap.n}`).toBeLessThan(1);
            }
        });
        [BEAR_PACES.amble, BEAR_PACES.walk, BEAR_PACES.brisk, BEAR_PACES.lope].forEach((pace) => expect([...paces]).toContain(pace));
        expect(lopes).toBeGreaterThanOrEqual(2);
        expect(lopes / mind.laps.length).toBeLessThan(0.4);
        // With a cub she never hurries.
        mind.laps.filter(({ deal }) => deal.family).forEach(({ deal }) => deal.paces.forEach((pace) => expect(pace).toBeLessThanOrEqual(BEAR_PACES.walk)));
    });

    it('holds the ground as the big male does: a smaller female a whole lap round, and a lope from its first stride to its last', () => {
        const mind = new BearMind(LANDSCAPE, { start: 0 });
        mind.clockOf({ holds: (deal) => deal.kind === 'female' && !deal.family });
        const female = mind.laps.find(({ deal }) => deal.kind === 'female' && !deal.family);
        expect(female.deal.size).toBeLessThan(0.9);
        expectHoldsTheGround(watch(mind, ...lapSpan(mind, female.n)));
        // The lope, from the walk it breaks out of to the walk it falls back into.
        const at = mind.clockWhen('lope');
        expect(at).not.toBeNull();
        const run = watch(mind, at - 14, at + 14);
        expectHoldsTheGround(run);
        let fastest = 0;
        for (let t = at - 14; t < at + 14; t += 0.1) fastest = Math.max(fastest, mind.step(t).speed);
        expect(fastest).toBeGreaterThan(BEAR_PACES.lope * 0.9);
        // Loping, every paw is off the ice at once for a moment of each stride.
        let airborne = 0;
        for (let t = at - 1; t < at + 1; t += 1 / 60) if (mind.step(t).paws.every((paw) => paw.swing > 0)) airborne += 1;
        expect(airborne).toBeGreaterThan(2);
    });
});

describe('winter bear: a mother and her cub', () => {
    const mind = new BearMind(LANDSCAPE, { start: 0 });
    mind.clockOf({ lap: 30 });
    const families = mind.laps.filter(({ deal }) => deal.family);

    it('brings a cub on the laps dealt one, in a body of its own size, and on no other', () => {
        expect(families.length).toBeGreaterThan(3);
        mind.laps.slice(0, 8).forEach((lap) => {
            const pose = mind.step(lap.start + lap.wait + lap.period / 2);
            expect(pose.cub.present, `lap ${lap.n}`).toBe(lap.deal.family);
            if (!lap.deal.family) return;
            expect(pose.kind).toBe('female');
            expect(pose.cub.size).toBe(lap.deal.cub.size);
            expect(pose.cub.size).toBeLessThan(pose.size * 0.6);
        });
    });

    it('keeps the cub behind her and to one side: never ahead of her, never through her, never far', () => {
        families.slice(0, 4).forEach((lap) => {
            const mother = mind.courseOf(lap);
            const young = mind.cubCourseOf(lap);
            /** How far along the cub's own way a place on its mother's lies (knot for knot). */
            const beside = (distance) => {
                if (distance >= mother.length) return young.length + beside(distance - mother.length);
                const d = Math.max(0, distance);
                let k = mother.knots.length - 1;
                while (k > 0 && mother.knots[k] > d) k -= 1;
                const next = k + 1 < mother.knots.length ? [mother.knots[k + 1], young.knots[k + 1]] : [mother.length, young.length];
                return young.knots[k] + ((d - mother.knots[k]) / (next[0] - mother.knots[k])) * (next[1] - young.knots[k]);
            };
            let furthest = 0;
            const [from, to] = lapSpan(mind, lap.n);
            for (let t = from + 0.05; t < to; t += 0.1) {
                const pose = mind.step(t);
                const { cub } = pose;
                const apart = Math.hypot(pose.x - cub.x, pose.z - cub.z);
                // (A metre between their middles at the least: at her heel on the inside of a bend.)
                expect(apart, `lap ${lap.n} at ${(t - from).toFixed(1)}`).toBeGreaterThan(0.9);
                furthest = Math.max(furthest, apart);
                // Not ahead of her: seen along the way she faces, its middle is behind hers or beside it.
                const ahead = (cub.x - pose.x) * Math.sin(pose.heading) + (cub.z - pose.z) * Math.cos(pose.heading);
                expect(ahead, `lap ${lap.n} at ${(t - from).toFixed(1)}`).toBeLessThan(1.5);
                // ...and along its own way it has not got further than the place beside her (knot for knot).
                expect(cub.distance / cub.size, `lap ${lap.n} at ${(t - from).toFixed(1)}`).toBeLessThan(beside(pose.distance / pose.size) + 2.5 / cub.size);
            }
            expect(furthest, `lap ${lap.n}`).toBeLessThan(16);
        });
    });

    it('has the cub hold the ground as she does, at its walk and running to catch up', () => {
        const lap = families[0];
        const span = lapSpan(mind, lap.n);
        expectHoldsTheGround(watch(mind, ...span));
        // (The cub wherever the frame can show it: on the ice. Behind the trees its brisk little
        // steps over the spit's steep snow fall a centimetre short of it now and then.)
        const young = watch(mind, ...span, { cub: true, onIce: true });
        expect(young.frames).toBeGreaterThan(60 * lap.period * 0.5);
        // (Once a lap its left forepaw overreaches as it comes down: for three frames its landing
        // spot is up to 25 mm, model metres, beyond what the leg reaches, so it touches down that
        // much short and off the ice, then slides a centimetre and a half into place. Its stride is planned in its mother's measure and it walks
        // relatively quicker. About a centimetre in the world on an animal drawn 20 to 40 pixels
        // tall, for a twentieth of a second: looser than hers for that, and no looser. Retuning
        // the cub's stride table is the fix.)
        expectHoldsTheGround(young, { short: 0.026, off: 0.02, slide: 0.016 });
    });

    it('lets the cub dawdle, stop to look at something and run to catch up, and do things of its own', () => {
        const done = new Set();
        let ran = 0;
        let paused = 0;
        families.forEach((lap) => {
            const young = mind.cubCourseOf(lap);
            young.segments.forEach((s, i) => {
                if (s.kind === 'stop' && s.act !== 'Stand') done.add(s.act);
                // (A stop on the way: it walks on from it without her having stopped.)
                if (s.kind === 'stop' && s.k === -1) paused += 1;
                if (s.kind === 'move' && s.v0 === s.v1 && bearLope(s.v0) === 1) ran += 1;
                if (i > 0) expect(s.start, `lap ${lap.n} segment ${i}`).toBeCloseTo(young.segments[i - 1].start + young.segments[i - 1].duration, 6);
            });
            // Its lap is as long as hers, and closes: it ends where it began.
            const rate = quickOf(lap.deal.cub.size);
            expect(young.period / rate, `lap ${lap.n}`).toBeCloseTo(lap.period, 6);
            const last = young.segments[young.segments.length - 1];
            expect(last.kind).toBe('stop');
            expect(last.walked, `lap ${lap.n}`).toBeCloseTo(young.length, 6);
            // It never goes faster than its run, nor at a pace between its walk and its run for long.
            young.segments.filter((s) => s.kind === 'move').forEach((s) => expect(Math.max(s.v0, s.v1), `lap ${lap.n}`).toBeLessThan(BEAR_CUB.hurry * 1.15));
        });
        expect(ran).toBeGreaterThan(families.length * 0.5);
        expect(paused).toBeGreaterThan(0);
        expect(done.size).toBeGreaterThanOrEqual(5);
    });

    it('starts and ends the cub\'s lap out of sight beside her, where the ways meet', () => {
        families.slice(0, 4).forEach((lap) => {
            const [from, to] = lapSpan(mind, lap.n);
            const a = { ...mind.step(from + 0.01).cub };
            const b = { ...mind.step(to - 0.01).cub };
            expect(Math.hypot(a.x - b.x, a.z - b.z), `lap ${lap.n}`).toBeLessThan(0.05);
            expect(fractionOf(a.x, a.z), `lap ${lap.n}`).toBeGreaterThan(1.02);
        });
    });
});

describe('winter bear: what the board makes it do', () => {
    /** The walked distance and the pose a mind gives at a time. */
    const at = (mind, t) => ({ ...mind.step(t) });
    /** The first moment from `from` at which it has been walking at one pace for a while. */
    const walking = (mind, from) => {
        let t = from;
        while (at(mind, t).act !== 'Walk' || Math.abs(at(mind, t).speed - at(mind, t - 1).speed) > 1e-9 || at(mind, t).speed < 0.5) t += 0.5;
        return t;
    };

    it('stands up at a four, holds still under it, and walks on from where it stopped', () => {
        const mind = new BearMind(LANDSCAPE);
        const t0 = walking(mind, 2);
        const pace = at(mind, t0).speed;
        expect(mind.rear(t0)).toBe(true);
        // A second four while it is still up changes nothing.
        expect(mind.rear(t0 + 1)).toBe(false);
        const held = at(mind, t0 + BEAR_EASE + 0.5);
        expect(held.over).toBe('Rear');
        expect(held.overBlend).toBeGreaterThan(0.9);
        expect(held.speed).toBeLessThan(0.01);
        expect(held.tall).toBeGreaterThan(1.3);
        const later = at(mind, t0 + BEAR_ACTS.Rear - 0.5);
        expect(Math.abs(later.distance - held.distance)).toBeLessThan(0.02);
        // Let go, it picks up its walk where it stood: no jump from one frame to the next.
        let last = at(mind, t0 + BEAR_ACTS.Rear);
        for (let t = t0 + BEAR_ACTS.Rear; t < t0 + BEAR_ACTS.Rear + 2 * BEAR_EASE + 2; t += 1 / 60) {
            const p = at(mind, t);
            expect(Math.abs(p.distance - last.distance), `at ${t.toFixed(2)}`).toBeLessThan(BEAR_PACES.brisk / 60 + 1e-6);
            last = p;
        }
        expect(last.over).toBeNull();
        expect(last.speed).toBeGreaterThan(0.5 * Math.min(pace, BEAR_PACE));
        expect(mind.cut).toBeNull();
    });

    it('rises and drops back down with no joint jumping and no paw going into the ice', () => {
        const mind = new BearMind(LANDSCAPE);
        const posture = createBearPosture();
        const t0 = walking(mind, 30);
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
        const t0 = walking(mind, 20);
        mind.lie(t0);
        // A four while it lies does not get it up, nor a perfect clear; its head stays down.
        expect(mind.rear(t0 + 2)).toBe(false);
        expect(mind.wonder(t0 + 2)).toBe(false);
        expect(mind.scent(t0 + 3)).toBe(false);
        expect(mind.glance(t0 + 3)).toBe(false);
        const down = at(mind, t0 + 10);
        const still = at(mind, t0 + 120);
        expect(still.over).toBe('Lie');
        expect(still.overTime).toBe(LIE_HOLD);
        expect(still.tall).toBeLessThan(0.6);
        expect(Math.abs(still.distance - down.distance)).toBeLessThan(1e-6);
        expect(mind.rise(t0 + 120)).toBe(true);
        expect(at(mind, t0 + 121).over).toBe('Rise');
        const going = at(mind, t0 + 120 + BEAR_ACTS.Rise + 2 * BEAR_EASE + 3);
        expect(going.over).toBeNull();
        expect(going.distance).toBeGreaterThan(still.distance);
    });

    it('stands up at a perfect clear and sits down where it stood to watch, taking over from a four without a jump', () => {
        const mind = new BearMind(LANDSCAPE);
        const posture = createBearPosture();
        const t0 = walking(mind, 20);
        const calls = [[t0, 'rear'], [t0 + 2.5, 'wonder']];
        let last = null;
        let sat = null;
        for (let t = t0 - 0.5; t < t0 + 2.5 + BEAR_ACTS.Wonder + 2 * BEAR_EASE + 1; t += 1 / 60) {
            while (calls.length && t >= calls[0][0]) {
                const [when, verb] = calls.shift();
                expect(mind[verb](when), verb).toBe(true);
            }
            const pose = mind.step(t);
            solveBear(pose.spec, posture);
            const joints = posture.at.map((j) => inWorld(pose, j));
            if (last) {
                const { moved, bone } = fastestJoint(last, joints);
                expect(moved, `${bone} at ${(t - t0).toFixed(2)}`).toBeLessThan(0.15);
            }
            last = joints;
            if (!sat && t > t0 + 2.5 + 5) {
                sat = {
                    over: pose.over, hips: posture.at[B.pelvis][1], chest: posture.at[B.chest][1], speed: pose.speed,
                };
            }
        }
        // Up for the four, then down on its haunches where it stood (not back on all fours and up again).
        expect(sat.over).toBe('Wonder');
        expect(sat.hips).toBeLessThan(0.62);
        expect(sat.chest).toBeGreaterThan(0.9);
        expect(sat.speed).toBeLessThan(0.01);
        // Another while it watches changes nothing; a four neither.
        const again = new BearMind(LANDSCAPE);
        again.wonder(t0);
        expect(again.wonder(t0 + 3)).toBe(false);
        expect(again.rear(t0 + 3)).toBe(false);
        // Done, it is let go and walks on.
        expect(mind.step(t0 + 2.5 + BEAR_ACTS.Wonder + 2 * BEAR_EASE + 2).over).toBeNull();
        expect(mind.cut).toBeNull();
    });

    it('lifts its head to the wind at a level and looks to the board at a twist, without breaking its stride', () => {
        const head = [BEAR_SPEC.headYaw, BEAR_SPEC.headPitch, BEAR_SPEC.headRoll, BEAR_SPEC.reach, BEAR_SPEC.earL, BEAR_SPEC.earR];
        for (const [verb, act] of [['scent', 'Wind'], ['glance', 'Glance']]) {
            const mind = new BearMind(LANDSCAPE);
            const plain = new BearMind(LANDSCAPE);
            const t0 = walking(mind, 12);
            expect(mind[verb](t0), verb).toBe(true);
            const t = t0 + BEAR_ACTS[act] / 2;
            const a = mind.step(t);
            const b = plain.step(t);
            // Its walk is untouched: its place, its pace, its trunk and its feet.
            expect(a.distance).toBe(b.distance);
            expect(a.speed).toBe(b.speed);
            expect(a.over).toBeNull();
            let moved = 0;
            a.spec.forEach((v, i) => {
                if (head.includes(i)) moved = Math.max(moved, Math.abs(v - b.spec[i]));
                else if (i !== BEAR_SPEC.bend) expect(v, `${verb} spec[${i}]`).toBe(b.spec[i]);
            });
            expect(moved, verb).toBeGreaterThan(0.3);
            if (verb === 'scent') expect(a.spec[BEAR_SPEC.headPitch]).toBeGreaterThan(b.spec[BEAR_SPEC.headPitch] + 0.3);
            else {
                // (To the viewer's side of the lake: the eye stands at the world's origin.)
                const toward = Math.atan2(-a.x, -a.z) - a.heading;
                const wrapped = toward - 2 * Math.PI * Math.round(toward / (2 * Math.PI));
                expect(Math.sign(a.spec[BEAR_SPEC.headYaw] - b.spec[BEAR_SPEC.headYaw])).toBe(Math.sign(wrapped));
            }
            // It lets go again, and is as if nothing had happened.
            const after = mind.step(t0 + BEAR_ACTS[act] + 0.1);
            const same = plain.step(t0 + BEAR_ACTS[act] + 0.1);
            after.spec.forEach((v, i) => expect(v, `${verb} spec[${i}] after`).toBeCloseTo(same.spec[i], 9));
        }
    });

    it('has the cub do what its mother does, a beat later', () => {
        const mind = new BearMind(LANDSCAPE, { start: 0 });
        const from = mind.clockOf({ holds: (deal) => deal.family });
        const t0 = walking(mind, from + 20);
        mind.rear(t0);
        const early = mind.step(t0 + 0.3);
        expect(early.over).toBe('Rear');
        expect(early.cub.overBlend).toBe(0);
        const up = mind.step(t0 + 3);
        expect(up.cub.present).toBe(true);
        expect(up.cub.over).toBe('Rear');
        expect(up.cub.overBlend).toBeGreaterThan(0.9);
        expect(up.cub.overTime).toBeLessThan(up.overTime);
        expect(up.cub.speed).toBeLessThan(0.01);
        expect(up.cub.tall).toBeGreaterThan(1.3);
        // The run ends: both lie down, and both get up for the next.
        mind.step(t0 + BEAR_ACTS.Rear + 2 * BEAR_EASE + 1);
        const t1 = t0 + BEAR_ACTS.Rear + 2 * BEAR_EASE + 2;
        mind.lie(t1);
        const down = mind.step(t1 + 8);
        expect([down.over, down.cub.over]).toEqual(['Lie', 'Lie']);
        mind.rise(t1 + 9);
        const going = mind.step(t1 + 9 + BEAR_ACTS.Rise + 2 * BEAR_EASE + 4);
        expect([going.over, going.cub.over]).toEqual([null, null]);
    });

    it('goes back to its start on a reset, with nothing the board did in flight', () => {
        const mind = new BearMind(LANDSCAPE);
        const fresh = at(mind, 50);
        mind.lie(30);
        mind.scent(31);
        mind.reset(0);
        const again = at(mind, 50);
        expect(again.x).toBeCloseTo(fresh.x, 9);
        expect(again.over).toBeNull();
        expect(mind.nod).toBeNull();
    });
});
