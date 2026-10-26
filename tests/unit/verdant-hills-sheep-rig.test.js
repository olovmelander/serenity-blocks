/**
 * Verdant Hills — the sheep's bodies (src/themes/verdant-hills/verdant-hills-sheep-rig.js): two
 * skeletons on the quadruped solver the foxes and the polar bear share, the sheep's own gaits and
 * what it does. Three-free: everything here runs in plain Node.
 */
import { describe, expect, it } from 'vitest';
import {
    EWE_BONES, EWE_MARKS, EWE_RIG, LAMB_BONES, LAMB_MARKS, LAMB_RIG, LAMB_SIZE, SHEEP_ACTS, SHEEP_GAITS,
    SHEEP_LEAPS, SHEEP_LEGS, SHEEP_LIE_HOLD, SHEEP_LOOPS, SPEC, sheepGaitAt, sheepGaitTable, sheepLeapHeight,
    sheepStride,
} from '../../src/themes/verdant-hills/verdant-hills-sheep-rig.js';

const RIGS = [['ewe', EWE_RIG, EWE_BONES, EWE_MARKS], ['lamb', LAMB_RIG, LAMB_BONES, LAMB_MARKS]];
const frac = (v) => v - Math.floor(v);

/** Where each hoof meets the ground in a solved posture (model metres). */
function hooves(rig, posture) {
    return SHEEP_LEGS.map((leg) => rig.point(posture, leg[3], rig.marks[leg[4]]));
}

describe('Verdant Hills sheep: two skeletons, one set of bones', () => {
    it('gives the ewe and the lamb the same twenty bones in the same order, mirrored side to side', () => {
        expect(EWE_BONES).toHaveLength(20);
        expect(LAMB_BONES.map((bone) => bone[0])).toEqual(EWE_BONES.map((bone) => bone[0]));
        expect(LAMB_BONES.map((bone) => bone[1])).toEqual(EWE_BONES.map((bone) => bone[1]));
        for (const [, , bones, marks] of RIGS) {
            const at = Object.fromEntries(bones.map((bone) => [bone[0], bone.slice(2)]));
            for (const [name, place] of Object.entries(at)) {
                if (name.endsWith('L')) {
                    const other = at[`${name.slice(0, -1)}R`];
                    expect(other[0]).toBeCloseTo(-place[0], 9);
                    expect(other[1]).toBeCloseTo(place[1], 9);
                    expect(other[2]).toBeCloseTo(place[2], 9);
                } else if (!name.endsWith('R')) expect(place[0]).toBe(0);
            }
            // The hooves stand on the ground, under their legs.
            for (const paw of ['pawFL', 'pawFR', 'pawBL', 'pawBR']) expect(marks[paw][1]).toBe(0);
            expect(marks.pawFL[2]).toBeGreaterThan(0);
            expect(marks.pawBL[2]).toBeLessThan(0);
            // The muzzle is ahead of everything and the tail behind.
            expect(marks.nose[2]).toBeGreaterThan(Math.max(...bones.map((bone) => bone[4])));
            expect(marks.tailTip[2]).toBeLessThan(Math.min(...bones.map((bone) => bone[4])) + 1e-9);
        }
    });

    it('makes the lamb a long-legged small thing beside the ewe', () => {
        const height = (bones) => Math.max(...bones.map((bone) => bone[3]));
        const length = (marks) => marks.nose[2] - marks.tailTip[2];
        expect(height(LAMB_BONES) / height(EWE_BONES)).toBeGreaterThan(0.55);
        expect(height(LAMB_BONES) / height(EWE_BONES)).toBeLessThan(0.75);
        expect(length(LAMB_MARKS) / length(EWE_MARKS)).toBeLessThan(0.65);
        // Its head is big for its body.
        const head = (bones, marks) => {
            const poll = bones.find((bone) => bone[0] === 'head');
            return Math.hypot(marks.nose[1] - poll[3], marks.nose[2] - poll[4]) / length(marks);
        };
        expect(head(LAMB_BONES, LAMB_MARKS)).toBeGreaterThan(head(EWE_BONES, EWE_MARKS));
        expect(LAMB_RIG.size).toBe(LAMB_SIZE);
    });

    it('stands square with every hoof where its mark says', () => {
        for (const [name, rig] of RIGS) {
            const spec = rig.createSpec();
            const posture = rig.createPosture();
            rig.spec({ act: 'Stand' }, spec);
            rig.solve(spec, posture);
            const paws = hooves(rig, posture);
            ['pawFL', 'pawFR', 'pawBL', 'pawBR'].forEach((paw, i) => {
                for (let k = 0; k < 3; k++) expect(paws[i][k], `${name} ${paw}`).toBeCloseTo(rig.marks[paw][k], 3);
            });
            expect(Math.max(...posture.short), name).toBe(0);
        }
    });
});

describe('Verdant Hills sheep: the gaits', () => {
    it('walks, trots and gallops on one coordinate, quicker strides as it goes faster', () => {
        expect(SHEEP_GAITS).toHaveLength(3);
        expect(sheepGaitAt(0.8)).toBe(0);
        expect(sheepGaitAt(2.4)).toBe(1);
        expect(sheepGaitAt(5)).toBe(2);
        // A lamb's short legs break into a trot and a gallop sooner (Froude).
        expect(sheepGaitAt(1.5, LAMB_SIZE)).toBeGreaterThan(sheepGaitAt(1.5));
        let last = 0;
        for (let v = 0.2; v < 6; v += 0.2) {
            const stride = sheepStride(v);
            expect(stride).toBeGreaterThan(last);
            last = stride;
        }
        // The walk is a lateral four-beat (left hind, left fore, right hind, right fore); the trot
        // pairs the diagonals; every hoof is on the ground longer at a walk than at a gallop.
        const walk = sheepGaitTable(0);
        expect([...walk.falls]).toEqual([0.22, 0.72, 0, 0.5]);
        const trot = sheepGaitTable(1);
        expect(frac(trot.falls[0] - trot.falls[3])).toBeCloseTo(0, 9);
        expect(frac(trot.falls[1] - trot.falls[2])).toBeCloseTo(0, 9);
        expect(sheepGaitTable(0).duty).toBeGreaterThan(sheepGaitTable(1).duty);
        expect(sheepGaitTable(1).duty).toBeGreaterThan(sheepGaitTable(2).duty);
    });

    it('never slides a planted hoof: carried by the body at its speed, it stays where it struck', () => {
        for (const [name, rig] of RIGS) {
            const spec = rig.createSpec();
            const posture = rig.createPosture();
            for (const speed of [0.2, 0.85, 2.1, 4.6]) {
                const model = speed / rig.scale;
                const gait = sheepGaitAt(model, rig.size);
                const G = sheepGaitTable(gait);
                const stride = sheepStride(model, rig.size);
                const where = [null, null, null, null];
                let worst = 0;
                for (let i = 0; i <= 200; i++) {
                    const travelled = (i / 100) * stride;
                    const phase = travelled / stride;
                    rig.spec({
                        act: 'Walk', phase, speed, amp: 1, gait,
                    }, spec);
                    rig.solve(spec, posture);
                    const paws = hooves(rig, posture);
                    for (let k = 0; k < 4; k++) {
                        const at = frac(phase - G.falls[k]);
                        // Away from the moments it strikes and leaves (the toe rolls there).
                        if (at > 0.08 * G.duty && at < 0.55 * G.duty) {
                            const ground = paws[k][2] + travelled;
                            if (where[k] === null) where[k] = ground;
                            worst = Math.max(worst, Math.abs(ground - where[k]));
                        } else where[k] = null;
                    }
                }
                // A centimetre a stance at the walk, a little more at the gallop (model metres).
                expect(worst, `${name} at ${speed} m/s`).toBeLessThan(speed > 3 ? 0.035 : 0.012);
            }
        }
    });

    it('reaches every planted hoof at a walk and keeps a trot and a gallop within a few centimetres', () => {
        for (const [name, rig] of RIGS) {
            const spec = rig.createSpec();
            const posture = rig.createPosture();
            for (const speed of [0.3, 0.85, 1.3, 2.1, 3, 4.9]) {
                const model = speed / rig.scale;
                const G = sheepGaitTable(sheepGaitAt(model, rig.size));
                let worst = 0;
                for (let i = 0; i < 100; i++) {
                    rig.spec({
                        act: 'Walk', phase: i / 100, speed, amp: 1,
                    }, spec);
                    rig.solve(spec, posture);
                    for (let k = 0; k < 4; k++) {
                        if (frac(i / 100 - G.falls[k]) < G.duty) worst = Math.max(worst, posture.short[k]);
                    }
                }
                expect(worst, `${name} at ${speed} m/s`).toBeLessThan(speed < 1.5 ? 0.012 : 0.035);
            }
        }
    });

    it('lifts its hooves clear of the grass through the swing', () => {
        for (const [name, rig] of RIGS) {
            const spec = rig.createSpec();
            const posture = rig.createPosture();
            const G = sheepGaitTable(0);
            for (let k = 0; k < 4; k++) {
                // Mid-swing for this hoof.
                const phase = G.falls[k] + G.duty + (1 - G.duty) / 2;
                rig.spec({
                    act: 'Walk', phase, speed: 0.9, amp: 1,
                }, spec);
                rig.solve(spec, posture);
                expect(hooves(rig, posture)[k][1], `${name} hoof ${k}`).toBeGreaterThan(0.02 * rig.size);
            }
        }
    });
});

describe('Verdant Hills sheep: what they do', () => {
    const settle = (rig, act, t) => {
        const spec = rig.createSpec();
        const posture = rig.createPosture();
        rig.spec({ act, actTime: t }, spec);
        rig.solve(spec, posture);
        return { spec, posture, nose: rig.point(posture, 'head', rig.marks.nose) };
    };

    it('knows every act it is asked for and how long each takes', () => {
        for (const name of ['Stand', 'Walk', 'Graze', 'Chew', 'Stare', 'Stamp', 'Lie', 'Rise', 'Stretch', 'Shake',
            'Scratch', 'Nurse', 'Suckle', 'Pronk', 'Twist', 'Butt']) {
            expect(SHEEP_ACTS[name], name).toBeGreaterThan(0);
        }
        for (const loop of SHEEP_LOOPS) expect(SHEEP_ACTS[loop]).toBeDefined();
        expect(SHEEP_LIE_HOLD).toBeLessThan(SHEEP_ACTS.Lie);
    });

    it('grazes with its muzzle down in the grass and stands with its head up chewing', () => {
        for (const [name, rig] of RIGS) {
            const standing = settle(rig, 'Stand', 1).nose;
            const grazing = settle(rig, 'Graze', 3).nose;
            const chewing = settle(rig, 'Chew', 3).nose;
            expect(grazing[1], name).toBeLessThan(0.07 * rig.size);
            expect(grazing[1], name).toBeGreaterThan(-0.02);
            expect(chewing[1], name).toBeGreaterThan(standing[1] - 0.01);
            // Grazing, its muzzle is ahead of its forefeet, not between them.
            expect(grazing[2], name).toBeGreaterThan(rig.marks.pawFL[2]);
            expect(Math.max(...settle(rig, 'Graze', 3).posture.short), name).toBeLessThan(0.005);
        }
    });

    it('lies down with its belly on the grass and its head up, and gets up again hind end first', () => {
        for (const [name, rig] of RIGS) {
            const lying = settle(rig, 'Lie', SHEEP_LIE_HOLD + 0.2);
            const hips = lying.posture.at[rig.index.hips][1];
            const chest = lying.posture.at[rig.index.chest][1];
            const standing = settle(rig, 'Stand', 1).posture;
            expect(hips, name).toBeLessThan(standing.at[rig.index.hips][1] - 0.18 * rig.size);
            expect(chest, name).toBeLessThan(standing.at[rig.index.chest][1] - 0.18 * rig.size);
            expect(lying.nose[1], name).toBeGreaterThan(0.25 * rig.size);
            // Half-way up its hindquarters are up and its front still down on its knees.
            const rising = settle(rig, 'Rise', 0.95).posture;
            expect(rising.at[rig.index.hips][1] - hips, name).toBeGreaterThan(0.12 * rig.size);
            expect(rising.at[rig.index.chest][1] - chest, name).toBeLessThan(0.08 * rig.size);
            // And at the end it stands.
            const up = settle(rig, 'Rise', SHEEP_ACTS.Rise).posture;
            expect(Math.abs(up.at[rig.index.hips][1] - standing.at[rig.index.hips][1])).toBeLessThan(0.01);
        }
    });

    it('stares with its head high and stamps a forefoot', () => {
        for (const [name, rig] of RIGS) {
            const stare = settle(rig, 'Stare', 2).nose;
            expect(stare[1], name).toBeGreaterThan(settle(rig, 'Stand', 1).nose[1] + 0.04 * rig.size);
            const stamp = settle(rig, 'Stamp', 0.36);
            expect(hooves(rig, stamp.posture)[0][1], name).toBeGreaterThan(0.03 * rig.size);
        }
    });

    it('springs a lamb straight up off all four feet and brings it down on all four', () => {
        for (const leap of ['Pronk', 'Twist']) {
            const [off, on] = SHEEP_LEAPS[leap];
            expect(sheepLeapHeight(leap, off - 0.01)).toBe(0);
            expect(sheepLeapHeight(leap, on + 0.01)).toBe(0);
            const top = sheepLeapHeight(leap, (off + on) / 2);
            expect(top).toBeGreaterThan(0.25 * LAMB_SIZE);
            const { spec } = settle(LAMB_RIG, leap, (off + on) / 2);
            for (let k = 0; k < 4; k++) expect(spec[SPEC.feet + k * 5 + 4], `${leap} hoof ${k}`).toBeGreaterThan(0.95);
        }
        // Anything else stays on the ground.
        expect(sheepLeapHeight('Graze', 0.5)).toBe(0);
    });

    it('cross-fades from a pose it was caught in half-way, so nothing jumps', () => {
        const rig = EWE_RIG;
        const caught = rig.createSpec();
        rig.posture({
            act: 'Graze', actTime: 0.4, from: 'Stand', blend: 0.5,
        }, caught);
        const next = rig.createSpec();
        rig.posture({
            act: 'Stare', actTime: 0, fromSpec: caught, blend: 0,
        }, next);
        for (let i = 0; i < next.length; i++) expect(next[i]).toBeCloseTo(caught[i], 9);
    });

    it('stands its hooves on a slope and pitches its trunk part way with it', () => {
        for (const [name, rig] of RIGS) {
            const spec = rig.createSpec();
            const posture = rig.createPosture();
            // Uphill ahead: the forefeet higher than the hind.
            const rise = 0.12 * rig.size;
            rig.spec({ act: 'Graze', actTime: 3, feet: [rise, rise, -rise, -rise] }, spec);
            rig.solve(spec, posture);
            const paws = hooves(rig, posture);
            expect(paws[0][1], name).toBeCloseTo(rise, 2);
            expect(paws[2][1], name).toBeCloseTo(-rise, 2);
            expect(posture.at[rig.index.chest][1], name).toBeGreaterThan(posture.at[rig.index.hips][1]);
            expect(Math.max(...posture.short), name).toBeLessThan(0.01);
        }
    });

    it('stands, grazes and stares on any slope the pasture has, from any side, every hoof on the grass', () => {
        for (const [name, rig] of RIGS) {
            const spec = rig.createSpec();
            const posture = rig.createPosture();
            const paws = ['pawFL', 'pawFR', 'pawBL', 'pawBR'].map((paw) => rig.marks[paw]);
            let worst = 0;
            for (const act of ['Stand', 'Graze', 'Chew', 'Stare']) {
                for (const degrees of [10, 22]) {
                    for (let turn = 0; turn < 360; turn += 30) {
                        const rise = Math.tan((degrees * Math.PI) / 180);
                        const a = (turn * Math.PI) / 180;
                        const feet = paws.map((m) => rise * (m[0] * Math.sin(a) + m[2] * Math.cos(a)));
                        rig.spec({ act, actTime: 3, feet }, spec);
                        rig.solve(spec, posture);
                        worst = Math.max(worst, ...posture.short);
                    }
                }
            }
            expect(worst, name).toBeLessThan(0.02);
        }
    });
});
