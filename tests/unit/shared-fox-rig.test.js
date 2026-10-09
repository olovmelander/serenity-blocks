/**
 * The fox rig the themes share (src/themes/shared/fox-rig.js), on a fox that is nobody's: a
 * made-up skeleton of other proportions than the arctic fox's, at other sizes, drawn at other
 * scales, with a tail of three bones or of four. No three, no GPU.
 *
 * What is pinned is what a second fox needs of the engine — a spec of zeros is its stand, a
 * planted paw is reached and does not slide, its size scales lengths and no angle, its scale
 * only turns world speeds into the model's — not the tuning. (The arctic fox's own body, its
 * asset and its poses are winter-fox-rig.test.js.)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    FOOT, FOX_ACTS, FOX_COMMON_ACTS, FOX_LEGS, POUNCE_AIR, SLEEP_HOLD, SPEC, SPEC_SIZE, createFoxRig, createFoxSpec,
} from '../../src/themes/shared/fox-rig.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'shared',
    'fox-rig.js',
), 'utf8');

const FRAME = 1 / 60;
/** Samples to a cycle of the gait. */
const CYCLE = 240;
/** Every act every fox knows. */
const COMMON = Object.keys(FOX_COMMON_ACTS);
/** Paces as the arctic fox would feel them (m/s): a walk, a trot, a run, a gallop opening, flat out. */
const FELT = [0.6, 1.5, 3, 4.5, 6.8];
/** The numbers of a spec that are lengths (model metres); the rest are angles and shares. */
const LENGTHS = new Set(['rear', 'fore', 'shift', 'sway'].map((name) => SPEC[name]));
[FOOT.FL, FOOT.FR, FOOT.BL, FOOT.BR].forEach((foot) => {
    [FOOT.dx, FOOT.dy, FOOT.dz].forEach((number) => LENGTHS.add(foot + number));
});
const FIELDS = [];
Object.entries(SPEC).forEach(([name, index]) => {
    if (name !== 'feet') FIELDS[index] = name;
});
['FL', 'FR', 'BL', 'BR'].forEach((leg) => ['dx', 'dy', 'dz', 'toe', 'air'].forEach((name) => {
    FIELDS[FOOT[leg] + FOOT[name]] = `${leg}.${name}`;
}));

const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
/** The angle between two rotations (radians). */
const turnBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b))));
/** Whether two rotations are one and the same turn, to rounding. */
const sameTurn = (a, b) => 1 - Math.abs(dot4(a, b)) < 1e-12;

/**
 * A fox that is nobody's, `k` times the arctic fox's size: longer in the leg, shorter in the
 * muzzle, every leg in one fore-and-aft plane (shoulder, elbow, wrist and paw at one distance
 * from its midline), a tail of `tailBones` bones along its midline.
 */
function madeUp(k = 1, tailBones = 3) {
    const m = (x, y, z) => [x * k, y * k, z * k];
    const tail = [[0, 0.34, -0.2], [0, 0.27, -0.3], [0, 0.22, -0.4], [0, 0.2, -0.48], [0, 0.19, -0.55]]
        .slice(0, tailBones);
    const bones = [
        ['hips', null, ...m(0, 0.36, -0.14)],
        ['spine', 'hips', ...m(0, 0.365, 0)],
        ['chest', 'spine', ...m(0, 0.37, 0.13)],
        ['neck', 'chest', ...m(0, 0.45, 0.22)],
        ['head', 'neck', ...m(0, 0.54, 0.32)],
        ...tail.map((at, i) => [`tail${i + 1}`, i ? `tail${i}` : 'hips', ...m(...at)]),
        ...[['L', 1], ['R', -1]].flatMap(([side, s]) => [
            [`arm${side}`, 'chest', ...m(0.08 * s, 0.31, 0.2)],
            // (An elbow behind the line from shoulder to wrist, a knee before the line from hip to hock.)
            [`fore${side}`, `arm${side}`, ...m(0.08 * s, 0.18, 0.17)],
            [`hand${side}`, `fore${side}`, ...m(0.08 * s, 0.06, 0.19)],
            [`thigh${side}`, 'hips', ...m(0.09 * s, 0.32, -0.12)],
            [`shin${side}`, `thigh${side}`, ...m(0.09 * s, 0.19, -0.06)],
            [`hock${side}`, `shin${side}`, ...m(0.09 * s, 0.1, -0.13)],
        ]),
    ];
    const end = tail[tail.length - 1] ?? [0, 0.3, -0.2];
    const marks = {
        nose: m(0, 0.5, 0.54),
        tailTip: m(0, end[1] + 0.02, end[2] - 0.07),
        pawFL: m(0.08, 0, 0.22),
        pawFR: m(-0.08, 0, 0.22),
        pawBL: m(0.09, 0, -0.1),
        pawBR: m(-0.09, 0, -0.1),
    };
    return { bones, marks };
}

/** Where its shoulders are at rest (the z of `armL`): what a rig is told as `foreAt`. */
const SHOULDERS = 0.2;
/** The size of the fox most of these tests are about, and the rig made for it. */
const SIZE = 1.6;
const SKELETON = madeUp(SIZE, 3);
const RIG = createFoxRig({ ...SKELETON, size: SIZE, foreAt: SHOULDERS * SIZE });

const restOf = (rig, bone) => rig.bones[rig.index[bone]].slice(2);
const jointAt = (rig, posture, bone) => posture.at[rig.index[bone]];
/** Where a paw meets the ground in a posture. */
const pawAt = (rig, posture, leg, out = [0, 0, 0]) => {
    const [, , , last, paw] = FOX_LEGS[leg];
    return rig.point(posture, last, rig.marks[paw], out);
};
const lastTail = (rig) => `tail${rig.bones.filter((bone) => /^tail\d+$/.test(bone[0])).length}`;
const tipAt = (rig, posture) => rig.point(posture, lastTail(rig), rig.marks.tailTip);
const posed = (rig, numbers) => {
    const spec = rig.createSpec();
    Object.entries(numbers).forEach(([name, v]) => {
        spec[SPEC[name]] = v;
    });
    return rig.solve(spec);
};
/** The speed (m/s, world) a rig's fox goes at when the arctic fox would feel `felt`. */
const paceOf = (rig, felt) => felt * rig.scale * Math.sqrt(rig.size);

/** Every pose worth asking a rig about: each common act through its length, each pace through a cycle. */
function eachMoment(rig, visit) {
    const spec = rig.createSpec();
    COMMON.forEach((name) => {
        const frames = Math.ceil(rig.lengths[name] / FRAME);
        for (let i = 0; i <= frames; i++) {
            visit(rig.act(spec, name, i * FRAME), () => `${name} at ${(i * FRAME).toFixed(3)} s`);
        }
    });
    FELT.forEach((felt) => {
        for (let i = 0; i < CYCLE; i++) {
            spec.fill(0);
            rig.gait(spec, i / CYCLE, paceOf(rig, felt), 1);
            visit(spec, () => `its gait at a felt ${felt} m/s, phase ${(i / CYCLE).toFixed(3)}`);
        }
    });
}

describe('shared fox rig: the module', () => {
    it('stands alone: no imports, no three, no clock, no dice', () => {
        expect([...source.matchAll(/from\s+'([^']+)'/g)]).toEqual([]);
        expect(source).not.toMatch(/\bimport\b\s*[({*'"]/);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
    });

    it('writes a pose the same way for every fox: the body\'s numbers, then five for each foot', () => {
        const body = Object.entries(SPEC).filter(([name]) => name !== 'feet').map(([, index]) => index);
        expect([...body].sort((a, b) => a - b)).toEqual(body.map((_, i) => i));
        expect(SPEC.feet).toBe(body.length);
        expect(FOX_LEGS.map((leg) => leg[0])).toEqual(['FL', 'FR', 'BL', 'BR']);
        // Where a foot's numbers are: FOOT.<leg> + FOOT.<number>.
        expect(FOOT.size).toBe(5);
        expect([FOOT.dx, FOOT.dy, FOOT.dz, FOOT.toe, FOOT.air]).toEqual([0, 1, 2, 3, 4]);
        FOX_LEGS.forEach(([name], leg) => expect(FOOT[name], name).toBe(SPEC.feet + leg * FOOT.size));
        expect(SPEC_SIZE).toBe(SPEC.feet + FOX_LEGS.length * FOOT.size);
        const spec = createFoxSpec();
        expect(spec).toBeInstanceOf(Float64Array);
        expect(spec).toHaveLength(SPEC_SIZE);
        expect(spec.every((v) => v === 0)).toBe(true);
        [SPEC, FOOT, FOX_LEGS, FOX_ACTS, FOX_COMMON_ACTS, POUNCE_AIR].forEach((shared) => {
            expect(Object.isFrozen(shared)).toBe(true);
        });
    });

    it('knows a pose for every act it names a length for, but the gait', () => {
        expect(Object.keys(FOX_ACTS).filter((name) => name !== 'Run').sort()).toEqual([...COMMON].sort());
        Object.entries(FOX_ACTS).forEach(([name, seconds]) => expect(seconds, name).toBeGreaterThan(0));
        expect(POUNCE_AIR[0]).toBeGreaterThan(0);
        expect(POUNCE_AIR[1]).toBeGreaterThan(POUNCE_AIR[0]);
        expect(POUNCE_AIR[1]).toBeLessThan(FOX_ACTS.Pounce);
        expect(SLEEP_HOLD).toBeGreaterThan(0);
        expect(SLEEP_HOLD).toBeLessThan(FOX_ACTS.CurlSleep);
        COMMON.forEach((name) => {
            let moved = 0;
            for (let t = 0; t <= FOX_ACTS[name]; t += FRAME) {
                moved = Math.max(moved, ...Array.from(RIG.act(RIG.createSpec(), name, t), Math.abs));
            }
            expect(moved, name).toBeGreaterThan(0.05);
        });
    });

    it('makes a rig of a skeleton: what it was given, and everything it can be asked', () => {
        const asked = [
            'bones', 'index', 'marks', 'scale', 'size', 'lengths', 'createSpec', 'createPosture', 'act', 'stride',
            'gallop', 'duty', 'footfalls', 'gait', 'spec', 'solve', 'point',
        ];
        expect(Object.keys(RIG)).toEqual(expect.arrayContaining(asked));
        expect(Object.isFrozen(RIG)).toBe(true);
        expect(RIG.bones).toBe(SKELETON.bones);
        expect(RIG.marks).toBe(SKELETON.marks);
        expect(RIG.size).toBe(SIZE);
        expect(RIG.scale).toBe(1); // (life size, when it is not told otherwise)
        expect(createFoxRig(madeUp()).size).toBe(1);
        RIG.bones.forEach(([name], i) => expect(RIG.index[name], name).toBe(i));
        expect(RIG.lengths).toEqual(FOX_ACTS);
        expect(RIG.createSpec()).toHaveLength(SPEC_SIZE);
        const posture = RIG.createPosture();
        expect(posture.world).toHaveLength(RIG.bones.length);
        expect(posture.local).toHaveLength(RIG.bones.length);
        expect(posture.at.map((p) => [...p])).toEqual(RIG.bones.map((bone) => bone.slice(2)));
        expect(posture.short).toEqual([0, 0, 0, 0]);
        // Two rigs are two animals: neither's scratch is the other's.
        const other = createFoxRig({ ...madeUp(0.7, 4), size: 0.7 });
        const sitting = RIG.solve(RIG.act(RIG.createSpec(), 'Sit', 3));
        const before = JSON.stringify(sitting);
        other.solve(other.spec({
            clip: 'CurlSleep', clipTime: 1.2, from: 'Dig', fromTime: 0.4, blend: 0.3,
        }));
        expect(JSON.stringify(RIG.solve(RIG.act(RIG.createSpec(), 'Sit', 3)))).toBe(before);
    });

    it('lets a fox have acts and lengths of its own, over or beside the ones every fox knows', () => {
        const seen = [];
        const rig = createFoxRig({
            ...madeUp(SIZE, 3),
            size: SIZE,
            acts: {
                // (spec, seconds into it, its size)
                Wave(spec, t, k) {
                    seen.push([t, k]);
                    spec[FOOT.FL + FOOT.dy] = 0.1 * k * Math.min(1, t);
                    spec[FOOT.FL + FOOT.air] = 0;
                },
                Shake(spec) {
                    spec[SPEC.headRoll] = 0.5;
                },
            },
            lengths: { Wave: 1.5, Shake: 0.4 },
        });
        expect(rig.lengths).toMatchObject({ ...FOX_ACTS, Wave: 1.5, Shake: 0.4 });
        expect(Object.isFrozen(rig.lengths)).toBe(true);
        const waving = rig.act(rig.createSpec().fill(9), 'Wave', 0.5);
        expect(seen).toEqual([[0.5, SIZE]]);
        expect(waving[FOOT.FL + FOOT.dy]).toBeCloseTo(0.05 * SIZE, 12);
        expect(Array.from(waving).filter((v) => v !== 0)).toHaveLength(1); // what was there before is gone
        expect(pawAt(rig, rig.solve(waving), 0)[1]).toBeCloseTo(0.05 * SIZE, 9);
        // Its own way of an act every fox knows is the one it does...
        const shaking = Array.from(rig.act(rig.createSpec(), 'Shake', 0.3));
        expect(shaking.filter((v) => v !== 0)).toEqual([0.5]);
        // ...the others are the common ones, and a time before an act begins is its beginning.
        const common = Array.from(RIG.act(RIG.createSpec(), 'Sit', 3));
        expect(Array.from(rig.act(rig.createSpec(), 'Sit', 3))).toEqual(common);
        rig.act(rig.createSpec(), 'Wave', -4);
        expect(seen[1]).toEqual([0, SIZE]);
        // Its gait is not an act, nor is a name nobody gave it: it stands.
        expect(rig.act(rig.createSpec().fill(9), 'Run', 0.3).every((v) => v === 0)).toBe(true);
        expect(rig.act(rig.createSpec().fill(9), 'NoSuchAct', 1).every((v) => v === 0)).toBe(true);
        // And its acts cross-fade like any others.
        const half = rig.spec({
            clip: 'Wave', clipTime: 1, from: 'Sit', fromTime: 3, blend: 0.5, amp: 0,
        });
        const sit = rig.act(rig.createSpec(), 'Sit', 3);
        expect(half[FOOT.FL + FOOT.dy]).toBeCloseTo(0.05 * SIZE, 12);
        expect(half[SPEC.rear]).toBeCloseTo(sit[SPEC.rear] / 2, 12);
    });
});

describe('shared fox rig: a fox of other proportions', () => {
    it('stands exactly as its skeleton is drawn on a spec of zeros', () => {
        [RIG, createFoxRig({ ...madeUp(0.7, 4), size: 0.7, scale: 2 }), createFoxRig(madeUp())].forEach((rig) => {
            const posture = rig.solve(rig.createSpec());
            expect(posture.short).toEqual([0, 0, 0, 0]);
            rig.bones.forEach(([name], i) => {
                // (Its legs are solved even standing: drawn in the plane they fold in, they come
                // out where they were drawn.)
                expect(sameTurn(posture.world[i], [0, 0, 0, 1]), name).toBe(true);
                expect(sameTurn(posture.local[i], [0, 0, 0, 1]), name).toBe(true);
                expect(apart(posture.at[i], restOf(rig, name)), name).toBeLessThan(1e-12);
            });
            FOX_LEGS.forEach(([name, , , , paw], leg) => {
                expect(apart(pawAt(rig, posture, leg), rig.marks[paw]), name).toBeLessThan(1e-12);
            });
            expect(apart(rig.point(posture, 'head', rig.marks.nose), rig.marks.nose)).toBeLessThan(1e-12);
            expect(apart(tipAt(rig, posture), rig.marks.tailTip)).toBeLessThan(1e-12);
        });
    });

    it('keeps every bone a rotation, and every joint where its bones\' rotations carry it', () => {
        const posture = RIG.createPosture();
        const carried = [0, 0, 0];
        const wrong = [];
        let moments = 0;
        eachMoment(RIG, (spec, label) => {
            moments += 1;
            RIG.solve(spec, posture);
            const sound = [...posture.world, ...posture.local]
                .every((q) => q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) < 1e-9)
                && posture.at.every((p) => p.every(Number.isFinite))
                && posture.short.every((v) => Number.isFinite(v) && v >= 0);
            if (!sound) wrong.push(`${label()}: not sound`);
            RIG.bones.forEach(([name, parent, x, y, z], i) => {
                if (parent === null) return;
                const p = RIG.index[parent];
                const from = restOf(RIG, parent);
                const q = posture.world[p];
                // (qRotate, written out: the test stands on the rig's answers alone.)
                const v = [x - from[0], y - from[1], z - from[2]];
                const t = [
                    2 * (q[1] * v[2] - q[2] * v[1]), 2 * (q[2] * v[0] - q[0] * v[2]), 2 * (q[0] * v[1] - q[1] * v[0]),
                ];
                carried[0] = v[0] + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]);
                carried[1] = v[1] + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]);
                carried[2] = v[2] + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0]);
                const where = posture.at[p].map((c, k) => c + carried[k]);
                if (apart(where, posture.at[i]) > 1e-9) wrong.push(`${label()}: ${name}'s place`);
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(moments).toBeGreaterThan(1000);
    });

    it('reaches every paw it plants in every act every fox knows, and puts none under the ground', () => {
        const posture = RIG.createPosture();
        const at = [0, 0, 0];
        const wrong = [];
        let planted = 0;
        const spec = RIG.createSpec();
        COMMON.forEach((name) => {
            const frames = Math.ceil(RIG.lengths[name] / FRAME);
            for (let i = 0; i <= frames; i++) {
                RIG.solve(RIG.act(spec, name, i * FRAME), posture);
                for (let leg = 0; leg < FOX_LEGS.length; leg++) {
                    const foot = SPEC.feet + leg * FOOT.size;
                    if (spec[foot + FOOT.air] !== 0) continue;
                    planted += 1;
                    const mark = RIG.marks[FOX_LEGS[leg][4]];
                    const want = [mark[0] + spec[foot + FOOT.dx], spec[foot + FOOT.dy], mark[2] + spec[foot + FOOT.dz]];
                    pawAt(RIG, posture, leg, at);
                    const where = `${name} at ${(i * FRAME).toFixed(3)} s: ${FOX_LEGS[leg][0]}`;
                    // (Half a centimetre on a fox the arctic one's size.)
                    if (posture.short[leg] > 0.005 * SIZE) wrong.push(`${where} is ${posture.short[leg]} short`);
                    if (at[1] < want[1] - 1e-9) wrong.push(`${where} is under where it should be`);
                    if (posture.short[leg] < 1e-9 && apart(at, want) > 1e-9) wrong.push(`${where} is off its place`);
                }
            }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(planted).toBeGreaterThan(1000);
    });

    it('turns no bone far in a frame in any of them', () => {
        COMMON.forEach((name) => {
            const spec = RIG.createSpec();
            let before = RIG.createPosture();
            let after = RIG.createPosture();
            let most = 0;
            RIG.solve(RIG.act(spec, name, 0), before);
            const frames = Math.ceil(RIG.lengths[name] / FRAME);
            for (let i = 1; i <= frames; i++) {
                RIG.solve(RIG.act(spec, name, i * FRAME), after);
                for (let k = 0; k < RIG.bones.length; k++) {
                    most = Math.max(most, turnBetween(before.world[k], after.world[k]));
                }
                [before, after] = [after, before];
            }
            expect(most * (180 / Math.PI), name).toBeLessThan(35);
        });
    });

    it('does not slide a planted paw at a steady pace, and reaches the ground with it', () => {
        const rigs = [RIG, createFoxRig({ ...madeUp(0.7, 4), size: 0.7, scale: 2 })];
        const wrong = [];
        let stances = 0;
        rigs.forEach((rig) => {
            const before = rig.createPosture();
            const after = rig.createPosture();
            const a = [0, 0, 0];
            const b = [0, 0, 0];
            FELT.forEach((felt) => {
                const speed = paceOf(rig, felt);
                // The body goes forward a stride a cycle: in the model's own metres, whatever it is drawn at.
                const stride = rig.stride(speed) / rig.scale;
                const step = 0.37 / CYCLE;
                const down = [0, 0, 0, 0];
                for (let i = 0; i < CYCLE; i++) {
                    const from = rig.gait(rig.createSpec(), i / CYCLE, speed, 1);
                    const to = rig.gait(rig.createSpec(), i / CYCLE + step, speed, 1);
                    rig.solve(from, before);
                    rig.solve(to, after);
                    for (let leg = 0; leg < FOX_LEGS.length; leg++) {
                        const foot = SPEC.feet + leg * FOOT.size;
                        if (from[foot + FOOT.dy] === 0) down[leg] += 1;
                        if (from[foot + FOOT.dy] !== 0 || to[foot + FOOT.dy] !== 0) continue;
                        stances += 1;
                        pawAt(rig, before, leg, a);
                        pawAt(rig, after, leg, b);
                        const slid = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2] + step * stride);
                        const where = `size ${rig.size}, a felt ${felt} m/s, phase ${(i / CYCLE).toFixed(3)}`;
                        const name = FOX_LEGS[leg][0];
                        if (slid > 1e-9 || Math.abs(b[1]) > 1e-9) wrong.push(`${where}: ${name} slid ${slid} m`);
                        if (before.short[leg] > 1e-9) wrong.push(`${where}: ${name} is short of its paw`);
                    }
                }
                // Each paw is down for its share of the cycle.
                down.forEach((count) => {
                    const off = Math.abs(count / CYCLE - rig.duty(speed));
                    expect(off, `size ${rig.size}, a felt ${felt} m/s`).toBeLessThan(2 / CYCLE);
                });
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(stances).toBeGreaterThan(CYCLE);
    });

    it('goes round, and eases all the way round — stepping on the spot too', () => {
        const largest = (fill, samples) => {
            const a = RIG.createSpec();
            const b = RIG.createSpec();
            const most = new Float64Array(SPEC_SIZE);
            for (let i = 0; i < samples; i++) {
                fill(a.fill(0), i / samples);
                fill(b.fill(0), (i + 1) / samples);
                for (let k = 0; k < SPEC_SIZE; k++) most[k] = Math.max(most[k], Math.abs(b[k] - a[k]));
            }
            return most;
        };
        const gaits = [
            ...FELT.map((felt) => [`a felt ${felt} m/s`, (spec, phase) => RIG.gait(spec, phase, paceOf(RIG, felt), 1)]),
            ['stepping on the spot', (spec, phase) => RIG.gait(spec, phase, 0, 0, 1)],
            ['half stepping, half striding', (spec, phase) => RIG.gait(spec, phase, paceOf(RIG, 0.6), 0.3, 0.8)],
        ];
        gaits.forEach(([label, fill]) => {
            // A cycle on, it is where it was.
            const here = fill(RIG.createSpec(), 0.37);
            fill(RIG.createSpec(), 1.37).forEach((v, k) => expect(v, `${label}: ${FIELDS[k]}`).toBeCloseTo(here[k], 9));
            // A quarter of the step changes every number less than half as much: none of them jumps.
            const coarse = largest(fill, CYCLE / 2);
            const fine = largest(fill, CYCLE * 2);
            FIELDS.forEach((field, k) => {
                expect(fine[k], `${label}: ${field}`).toBeLessThanOrEqual(coarse[k] * 0.5 + 1e-12);
            });
            expect(Math.max(...coarse), label).toBeGreaterThan(0);
        });
    });

    it('lowers its shoulders by `fore` when it is told where they are, and its chest when it is not', () => {
        const lower = 0.05 * SIZE;
        const drop = (rig, posture, bone) => restOf(rig, bone)[1] - jointAt(rig, posture, bone)[1];
        // Told its shoulders: they go down by what was asked, its hips stay; and the other way about.
        const bowed = posed(RIG, { fore: lower });
        expect(drop(RIG, bowed, 'armL')).toBeCloseTo(lower, 2);
        expect(Math.abs(drop(RIG, bowed, 'hips'))).toBeLessThan(lower * 0.02);
        const sunk = posed(RIG, { rear: lower });
        expect(drop(RIG, sunk, 'hips')).toBeCloseTo(lower, 2);
        expect(Math.abs(drop(RIG, sunk, 'armL'))).toBeLessThan(lower * 0.05);
        // Not told, it is the chest joint that `fore` lowers: the shoulders ahead of it go further.
        const plain = createFoxRig({ ...madeUp(SIZE, 3), size: SIZE });
        const plainBow = posed(plain, { fore: lower });
        expect(drop(plain, plainBow, 'chest')).toBeCloseTo(lower, 2);
        expect(drop(plain, plainBow, 'armL')).toBeGreaterThan(lower * 1.1);
        expect(Math.abs(drop(plain, plainBow, 'hips'))).toBeLessThan(lower * 0.02);
        // Both ends down together is the whole body down, however it is told.
        [RIG, plain].forEach((rig) => {
            const low = posed(rig, { fore: lower, rear: lower });
            ['hips', 'spine', 'chest', 'armL', 'thighR'].forEach((bone) => {
                expect(drop(rig, low, bone), bone).toBeCloseTo(lower, 9);
            });
        });
    });

    // (A regression: which way a leg folds — an elbow back, a knee forward — was read off the
    // sign of its paw's z, so a skeleton whose origin was not between its fore and hind paws
    // folded its knees backward: the arctic fox moved a hand forward stood with its knees a
    // hand from where they were drawn. It is read off the leg's place in FOX_LEGS: fore first.)
    it('folds its legs the same wherever its skeleton\'s origin is: fore and aft of all four paws too', () => {
        const here = RIG.createPosture();
        const there = RIG.createPosture();
        for (const moved of [-0.9, 0.5, 1.4]) {
            // The same animal, every bone and mark so far along z: its hind paws ahead of the
            // origin, or its fore paws behind it.
            const bones = SKELETON.bones.map(([name, parent, x, y, z]) => [name, parent, x, y, z + moved]);
            const marks = Object.fromEntries(Object.entries(SKELETON.marks)
                .map(([name, [x, y, z]]) => [name, [x, y, z + moved]]));
            expect(Math.sign(marks.pawFL[2])).toBe(Math.sign(marks.pawBL[2]));
            const rig = createFoxRig({
                bones, marks, size: SIZE, foreAt: SHOULDERS * SIZE + moved,
            });
            const stand = rig.solve(rig.createSpec());
            rig.bones.forEach(([name], i) => {
                expect(apart(stand.at[i], restOf(rig, name)), `${name}, moved ${moved}`).toBeLessThan(1e-9);
            });
            // Whatever it does, it does as the other does it: every joint so far along, every
            // bone turned alike — its knees before its hips when it sits, its elbows behind.
            const wrong = [];
            eachMoment(RIG, (spec, label) => {
                RIG.solve(spec, here);
                rig.solve(spec, there);
                RIG.bones.forEach(([name], i) => {
                    const [x, y, z] = here.at[i];
                    if (apart([x, y, z + moved], there.at[i]) > 1e-9) wrong.push(`${label()}: ${name}'s place`);
                    if (!sameTurn(here.world[i], there.world[i])) wrong.push(`${label()}: ${name}'s turn`);
                });
            });
            expect(wrong.slice(0, 5), `moved ${moved}`).toEqual([]);
            const sitting = rig.solve(rig.act(rig.createSpec(), 'Sit', 3));
            expect(jointAt(rig, sitting, 'shinL')[2]).toBeGreaterThan(jointAt(rig, sitting, 'thighL')[2]);
            expect(jointAt(rig, sitting, 'foreL')[2]).toBeLessThan(jointAt(rig, sitting, 'armL')[2]);
        }
    });

    it('carries a tail of three bones or of four alike, and takes no other', () => {
        for (const count of [3, 4]) {
            const rig = createFoxRig({ ...madeUp(SIZE, count), size: SIZE });
            const stand = rig.solve(rig.createSpec());
            const last = rig.index[lastTail(rig)];
            const tip = tipAt(rig, stand);
            // However many bones share it out, the whole of a lift and of a curl reaches the last.
            const lifted = posed(rig, { tailLift: 0.6 });
            expect(turnBetween(lifted.world[last], lifted.world[rig.index.hips]), `${count} bones`).toBeCloseTo(0.6, 9);
            expect(tipAt(rig, lifted)[1]).toBeGreaterThan(tip[1] + 0.05 * SIZE);
            const curled = posed(rig, { tailCurl: 1.2 });
            expect(turnBetween(curled.world[last], curled.world[rig.index.hips]), `${count} bones`).toBeCloseTo(1.2, 9);
            expect(tipAt(rig, curled)[0]).toBeGreaterThan(0.05 * SIZE); // round to its left
            expect(tipAt(rig, posed(rig, { tailCurl: -1.2 }))[0]).toBeLessThan(-0.05 * SIZE);
            // A swing goes to its left, each bone a little further than the last.
            const swung = posed(rig, { tailYaw: 0.5 });
            expect(tipAt(rig, swung)[0]).toBeGreaterThan(0.03 * SIZE);
            let turned = 0;
            for (let i = 1; i <= count; i++) {
                const bone = swung.world[rig.index[`tail${i}`]];
                expect(turnBetween(bone, swung.world[rig.index.hips]), `tail${i}`).toBeGreaterThan(turned);
                turned = turnBetween(bone, swung.world[rig.index.hips]);
            }
            // Sitting, it lies as it likes whatever its hips do.
            const sitting = rig.solve(rig.act(rig.createSpec(), 'Sit', 3));
            expect(sitting.at.every((joint) => joint[1] > 0)).toBe(true);
            expect(tipAt(rig, sitting)[0]).toBeGreaterThan(0.05 * SIZE);
        }
        for (const count of [0, 1, 2, 5]) {
            expect(() => createFoxRig(madeUp(1, count)), `${count} bones`).toThrow(/three or four/);
        }
    });

    it('holds its head as level against its trunk as it is told to', () => {
        const tipped = { pitch: 0.3, roll: 0.2 };
        const headOf = (headSteady) => {
            const rig = createFoxRig({ ...madeUp(SIZE, 3), size: SIZE, headSteady });
            return posed(rig, tipped).world[rig.index.head];
        };
        const level = [0, 0, 0, 1];
        // Wholly steady, its head does not take the trunk's pitch or roll at all; not at all
        // steady, it takes all of both; and left to itself, most of the way to level.
        expect(sameTurn(headOf(1), level)).toBe(true);
        const loose = turnBetween(headOf(0), level);
        expect(loose).toBeGreaterThan(0.3);
        const usual = turnBetween(posed(RIG, tipped).world[RIG.index.head], level);
        expect(usual).toBeGreaterThan(0);
        expect(usual).toBeLessThan(loose * 0.5);
        expect(turnBetween(headOf(0.5), level)).toBeCloseTo(loose / 2, 6);
        // Where it looks is its own whatever the trunk does: a head turned on a level trunk and
        // on a tipped one differ only by what of the tip it takes.
        const rig = createFoxRig({ ...madeUp(SIZE, 3), size: SIZE, headSteady: 1 });
        const looking = posed(rig, { headYaw: 0.5, headPitch: 0.2 }).world[rig.index.head];
        const lookingTipped = posed(rig, { ...tipped, headYaw: 0.5, headPitch: 0.2 }).world[rig.index.head];
        expect(sameTurn(looking, lookingTipped)).toBe(true);
    });

    it('takes its paces from what it is told of them', () => {
        const told = {
            strideBase: 0.2,
            strideRate: 0.25,
            stanceMost: 0.3,
            dutyMost: 0.6,
            dutyLeast: 0.2,
            gallopFrom: 3,
            gallopTo: 5,
        };
        const rig = createFoxRig({
            ...madeUp(SIZE, 3), size: SIZE, scale: 2, gait: told,
        });
        // A stride is so much at a stand and so much more for every metre a second (world metres).
        expect(rig.stride(0)).toBeCloseTo(told.strideBase * 2, 12);
        expect(rig.stride(4) - rig.stride(0)).toBeCloseTo(told.strideRate * 4, 12);
        expect(rig.stride(-3)).toBe(rig.stride(0));
        // A paw is down for as long as its stance lasts of the stride, within its bounds.
        expect(rig.duty(0)).toBe(told.dutyMost);
        expect(rig.duty(1000)).toBe(told.dutyLeast);
        const between = 2 * 2; // 2 m/s in the model's metres
        expect(rig.duty(between)).toBeCloseTo(told.stanceMost / (rig.stride(between) / 2), 12);
        // It trots up to one pace and gallops from another (the model's metres a second).
        expect(rig.gallop(told.gallopFrom * 2)).toBe(0);
        expect(rig.gallop(told.gallopTo * 2)).toBe(1);
        expect(rig.gallop((told.gallopFrom + told.gallopTo))).toBeCloseTo(0.5, 12);
        // Not told, a larger fox trots up to a higher pace than a smaller one.
        const small = createFoxRig({ ...madeUp(0.7, 3), size: 0.7 });
        const pace = 2.4;
        expect(small.gallop(pace)).toBeGreaterThan(RIG.gallop(pace));
        expect(RIG.stride(pace)).toBeGreaterThan(small.stride(pace));
        // And its footfalls are a fox's: diagonal pairs at a trot, hind pair then fore pair at a gallop.
        const trot = rig.footfalls(0);
        expect(trot[0]).toBe(trot[3]);
        expect(trot[1]).toBe(trot[2]);
        expect(Math.abs(trot[1] - trot[0])).toBe(0.5);
        expect(rig.footfalls(0, [], 1)).toEqual(rig.footfalls(told.gallopTo * 2));
    });
});

describe('shared fox rig: its size and its scale', () => {
    it('scales every length with its size, and no angle: a larger fox is the same fox, larger', () => {
        const one = createFoxRig({ ...madeUp(1, 3), foreAt: SHOULDERS });
        const wrong = [];
        // Every act, all the way through: the numbers of the pose, and the animal solved from them.
        COMMON.forEach((name) => {
            for (let t = 0; t <= FOX_ACTS[name]; t += 2 * FRAME) {
                const small = one.act(one.createSpec(), name, t);
                const large = RIG.act(RIG.createSpec(), name, t);
                small.forEach((v, k) => {
                    const want = v * (LENGTHS.has(k) ? SIZE : 1);
                    if (Math.abs(large[k] - want) > 1e-12) wrong.push(`${name} at ${t.toFixed(2)} s: ${FIELDS[k]}`);
                });
                const a = one.solve(small);
                const b = RIG.solve(large);
                one.bones.forEach(([bone], i) => {
                    const where = `${name} at ${t.toFixed(2)} s: ${bone}`;
                    if (apart(a.at[i].map((c) => c * SIZE), b.at[i]) > 1e-9) wrong.push(`${where}'s place`);
                    if (!sameTurn(a.world[i], b.world[i])) wrong.push(`${where}'s turn`);
                });
            }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        // And a whole pose of a mind's, three acts in it and everything laid over them.
        const pose = {
            clip: 'Sit',
            clipTime: 3,
            from: 'LookAround',
            fromTime: 1,
            blend: 0.4,
            was: 'Dig',
            wasTime: 0.3,
            hold: 0.5,
            side: -1,
            phase: 0.3,
            speed: 0,
            amp: 0,
            step: 0.7,
            lean: 0.1,
            nod: 0.08,
            lookYaw: 0.2,
            lookPitch: 0.1,
            tailYaw: 0.2,
            tailLift: 0.3,
            breath: 0.6,
        };
        const small = one.spec(pose);
        const large = RIG.spec(pose);
        small.forEach((v, k) => expect(large[k], FIELDS[k]).toBeCloseTo(v * (LENGTHS.has(k) ? SIZE : 1), 12));
        expect(Array.from(small).filter((v) => v !== 0).length).toBeGreaterThan(20);
    });

    it('is drawn larger than life without a pose changing: its scale only turns world speeds into its own', () => {
        const life = createFoxRig({ ...madeUp(1.3, 4), size: 1.3 });
        const drawn = createFoxRig({ ...madeUp(1.3, 4), size: 1.3, scale: 2.5 });
        expect(drawn.scale).toBe(2.5);
        // What it does at a stop is the same to the last number.
        COMMON.forEach((name) => {
            const t = FOX_ACTS[name] * 0.4;
            expect(Array.from(drawn.act(drawn.createSpec(), name, t)), name)
                .toEqual(Array.from(life.act(life.createSpec(), name, t)));
        });
        // Its paces are the same animal's, at 2.5 times the speed over the ground...
        for (const speed of [0, 0.4, 1.5, 3, 5, 8]) {
            expect(drawn.stride(speed * 2.5), `${speed} m/s`).toBeCloseTo(life.stride(speed) * 2.5, 9);
            expect(drawn.duty(speed * 2.5), `${speed} m/s`).toBeCloseTo(life.duty(speed), 12);
            expect(drawn.gallop(speed * 2.5), `${speed} m/s`).toBeCloseTo(life.gallop(speed), 12);
            expect(drawn.footfalls(speed * 2.5)).toEqual(life.footfalls(speed));
            // ...and so is every number of its gait, at every moment of the cycle.
            for (const phase of [0, 0.21, 0.5, 0.83]) {
                const there = drawn.gait(drawn.createSpec(), phase, speed * 2.5, 1);
                life.gait(life.createSpec(), phase, speed, 1).forEach((v, k) => {
                    expect(there[k], `${FIELDS[k]} at ${speed} m/s`).toBeCloseTo(v, 12);
                });
            }
        }
        // A pose with a speed in it too.
        const pose = {
            clip: 'Run', clipTime: 0, from: 'Sit', fromTime: 3, blend: 0.6, phase: 0.4, amp: 1, nod: 0.05,
        };
        const there = drawn.spec({ ...pose, speed: 7.5 });
        life.spec({ ...pose, speed: 3 }).forEach((v, k) => expect(there[k], FIELDS[k]).toBeCloseTo(v, 12));
    });
});
