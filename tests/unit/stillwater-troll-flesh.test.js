/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the troll's own flesh (stillwater-troll-flesh.js), and his arms kept out of it
 * (stillwater-troll-body.js `solveArmClear`, `solveStaffHand`).
 *
 * He is stout and his arms are thick. Posed for where his wrists should be alone, the hand he
 * rested on his knee lay inside his own lap, a hand laid on his heart went in through his belly,
 * and the staff he knocked on the water came down through the side of him: with his arm then
 * also grown into his loincloth (the mesh: stillwater-troll-assets.test.js), it looked as if his
 * arm were caught in his cloth. What is pinned here: the distance to each kind of mass his file
 * names; that through a night of his, with the flesh, no ball of either arm stands deep in him
 * while without it they do (so the test would notice the solve going quiet); that his hands move
 * without a jump; and that the staff is set down, not dropped, and his hand slides on it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FIST_SLIDE_SPEED, TrollBody, parentsFromSpec, restFromSpec, tailsFromSpec,
} from '../../src/themes/stillwater/stillwater-troll-body.js';
import { FLESH, fleshFromSpec, massDepth } from '../../src/themes/stillwater/stillwater-troll-flesh.js';
import { HEART, SPIRIT, TROLL } from '../../src/themes/stillwater/stillwater-core.js';
import { groundHeight } from '../../src/themes/stillwater/stillwater-plan.js';

const SPEC = (() => {
    const bytes = readFileSync(new URL('../../src/themes/stillwater/assets/troll-lod1.glb', import.meta.url));
    const length = bytes.readUInt32LE(12);
    return JSON.parse(bytes.toString('utf8', 20, 20 + length).trim()).scenes[0].extras;
})();

const DT = 1 / 60;
/** Centimetres of him to a model unit. */
const CM = TROLL.height * 100;
const HOME = [TROLL.home[0], TROLL.home[2]];
const REACH = [TROLL.reach[0], TROLL.reach[2]];
const SHALLOWS = [TROLL.shallows[0], TROLL.shallows[2]];
const FACE = Math.atan2(SPIRIT.home[0] - TROLL.home[0], SPIRIT.home[2] - TROLL.home[2]);
const HER = [SPIRIT.home[0], 1.4, SPIRIT.home[2]];
const want = (at, extra = {}) => ({
    at: [...at], face: FACE, sit: false, staff: 'walk', crouch: false, look: HER, reach: 0, pace: TROLL.pace, ...extra,
});

/** A night of his with his hands busy: [what, what he is asked, seconds, a gesture through it]. */
const NIGHT = [
    ['sits on his stone', want(HOME, { sit: true }), 3],
    ['tends his lantern', want(HOME, { sit: true }), 4.4, 'tend'],
    ['gets up', want(HOME), 3],
    ['waves', want(HOME), 2.8, 'wave'],
    ['bows', want(HOME), 3.2, 'bow'],
    ['laughs', want(HOME), 3, 'laugh'],
    ['raises his lantern', want(HOME, { staff: 'raise' }), 3],
    ['walks down to the water\'s edge', want(REACH), 9],
    ['knocks his staff', want(REACH), 2.6, 'thump'],
    ['wades into the shallows', want(SHALLOWS), 9],
    ['crouches to the water', want(SHALLOWS, { crouch: true, staff: 'dip', look: [HEART[0], 0, HEART[2]] }), 4],
    ['rises', want(SHALLOWS), 3],
    ['walks home', want(HOME, { staff: 'high', pace: 0.42, heavy: true }), 15],
    ['sits again', want(HOME, { sit: true }), 5],
];

const FLESH_OF_HIM = fleshFromSpec(SPEC);

function makeBody(flesh) {
    const body = new TrollBody(restFromSpec(SPEC), {
        sole: SPEC.sole,
        height: TROLL.height,
        ground: groundHeight,
        parents: parentsFromSpec(SPEC),
        tails: tailsFromSpec(SPEC),
        flesh,
    });
    body.reset(HOME[0], HOME[1], FACE, { seated: true, seat: [...TROLL.seat] });
    return body;
}

/**
 * Live through the night; after every frame `each(body, label, frame)`. Returns per pose how deep
 * the deepest ball of each arm stood in his masses (model units) and the largest change of each
 * hand's velocity in one frame (m/s), measured against the masses whether he keeps out of them or not.
 */
function live(flesh, each = null) {
    const body = makeBody(flesh);
    const ruler = makeBody(FLESH_OF_HIM);
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const at = new THREE.Vector3();
    const v = new THREE.Vector3();
    const last = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    const lastV = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    const tails = tailsFromSpec(SPEC);
    const rows = {};
    let time = 0;
    let frames = 0;
    for (const [label, wanted, seconds, gesture] of NIGHT) {
        const count = Math.round(seconds / DT);
        const g = gesture ? { name: gesture, start: time + DT, length: seconds } : null;
        const row = { deep: { L: 0, R: 0 }, jump: { L: 0, R: 0 } };
        rows[label] = row;
        for (let i = 0; i < count; i++) {
            time += DT;
            body.update(DT, g ? { ...wanted, gesture: g } : wanted, time);
            body.forward();
            frames += 1;
            Object.keys(body.global).forEach((k) => {
                ruler.global[k].copy(body.global[k]);
                ruler.globalPos[k].copy(body.globalPos[k]);
            });
            ruler.sitK = body.sitK;
            ruler.crouchK = body.crouchK;
            // (A new frame for the ruler too: his masses are placed once a frame.)
            ruler.frame += 1;
            for (const side of ['L', 'R']) {
                const [, fore, hand] = body.arms[side].names;
                const elbow = body.globalPos[fore];
                const wrist = body.globalPos[hand];
                dir.copy(tails[hand]).sub(body.rest[hand]).normalize().applyQuaternion(body.global[hand]);
                for (const [share, radius] of FLESH_OF_HIM.fore) {
                    row.deep[side] = Math.max(row.deep[side], ruler.fleshDepth(p.lerpVectors(elbow, wrist, share), radius, n, FLESH.pass));
                }
                for (const [along, radius] of side === 'L' ? FLESH_OF_HIM.fist : FLESH_OF_HIM.hand) {
                    row.deep[side] = Math.max(row.deep[side], ruler.fleshDepth(p.copy(wrist).addScaledVector(dir, along), radius, n));
                }
                body.toWalk(wrist, at);
                if (frames > 2) {
                    v.copy(at).sub(last[side]).multiplyScalar(1 / DT);
                    if (frames > 3) row.jump[side] = Math.max(row.jump[side], v.distanceTo(lastV[side]));
                    lastV[side].copy(v);
                }
                last[side].copy(at);
            }
            if (each) each(body, label, i);
        }
    }
    return rows;
}

const worst = (rows, key, side) => Math.max(...Object.values(rows).map((r) => r[key][side]));

describe('stillwater troll flesh: how deep a point stands in one of his masses', () => {
    const n = [0, 0, 0];

    it('measures an ellipsoid from its skin: its radius deep at its middle, nothing on it, less than nothing outside', () => {
        const belly = { kind: 'ell', c: [0, -0.1, 0.05], r: [0.18, 0.15, 0.19] };
        expect(massDepth(belly, 0, -0.1, 0.05, n)).toBeCloseTo(0.15, 6);
        expect(massDepth(belly, 0.18, -0.1, 0.05, n)).toBeCloseTo(0, 6);
        expect(n[0]).toBeCloseTo(1, 6);
        // Out along z, where it is longest: the way out is along z, and as far as it is.
        expect(massDepth(belly, 0, -0.1, 0.05 + 0.19 + 0.04, n)).toBeCloseTo(-0.04, 2);
        expect(n).toEqual([0, 0, expect.closeTo(1, 6)]);
        // A little inside its side: that little, and out through that side.
        expect(massDepth(belly, 0.17, -0.1, 0.05, n)).toBeCloseTo(0.01, 2);
        expect(n[0]).toBeGreaterThan(0.99);
        expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    });

    it('measures a limb as a round cone: its girth deep on its line, thinner toward its far end', () => {
        const thigh = {
            kind: 'cone', a: [0.1, -0.2, 0], b: [0.1, -0.34, 0], r1: 0.09, r2: 0.064,
        };
        expect(massDepth(thigh, 0.1, -0.2, 0, n)).toBeCloseTo(0.09, 6);
        expect(massDepth(thigh, 0.1, -0.34, 0, n)).toBeCloseTo(0.064, 6);
        expect(massDepth(thigh, 0.1 + 0.2, -0.27, 0, n)).toBeCloseTo(0.077 - 0.2, 6);
        expect(n).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    });

    it('measures his cloth as a band from its belt to its hem: out through its side, or down past its hem, never up', () => {
        const cloth = {
            kind: 'wrap', top: -0.165, hem: -0.29, z0: 0.03, rx: [0.198, 0.222], rz: [0.2, 0.192], thick: 0.0105,
        };
        // In the middle of its height, a little inside its side: out through the side.
        const inside = massDepth(cloth, 0.2, -0.22, 0.03, n);
        expect(inside).toBeGreaterThan(0.01);
        expect(inside).toBeLessThan(0.03);
        expect(n[0]).toBeCloseTo(1, 6);
        expect(n[1]).toBe(0);
        // Just above its hem and deep within its girth: down past the hem is the nearer way.
        expect(massDepth(cloth, 0.05, -0.28, 0.03, n)).toBeCloseTo(0.01, 6);
        expect(n).toEqual([0, -1, 0]);
        // Under its hem: clear of it.
        expect(massDepth(cloth, 0.05, -0.32, 0.03, n)).toBeLessThan(0);
        // Above its belt but within its girth is his belly: the way out is through the side, not up.
        const over = massDepth(cloth, 0.19, -0.16, 0.03, n);
        expect(over).toBeLessThan(0);
        expect(n[1]).toBe(0);
        expect(n[0]).toBeCloseTo(1, 6);
        // Level with its belt but an arm's length out from it is CLEAR of it (it once counted as
        // just above the band wherever it was, and pushed a forearm beside his hip upward).
        expect(massDepth(cloth, 0.45, -0.16, 0.03, n)).toBeLessThan(-0.2);
        expect(massDepth(cloth, 0.45, -0.2, 0.03, n)).toBeLessThan(-0.2);
    });
});

describe('stillwater troll flesh: what his file names', () => {
    it('reads his masses, each on a bone of his, and how thick his forearm, his hand and his fist are', () => {
        const flesh = FLESH_OF_HIM;
        expect(flesh).toBeTruthy();
        const bones = new Set(SPEC.bones.map((b) => b.name));
        const names = flesh.masses.map((m) => m.name);
        for (const name of ['pelvis', 'belly', 'chest', 'cloth', 'thighL', 'thighR', 'skull', 'jaw', 'nose', 'earL', 'earR']) {
            expect(names, name).toContain(name);
        }
        for (const m of flesh.masses) {
            expect(bones.has(m.bone), `${m.name} on ${m.bone}`).toBe(true);
            expect(['ell', 'wrap', 'cone'], m.name).toContain(m.kind);
        }
        // His cloth lies on his thighs when he sits: they are marked for it.
        expect(flesh.masses.filter((m) => m.lap).map((m) => m.name).sort()).toEqual(['thighL', 'thighR']);
        // Down his forearm from elbow to wrist; down his hand to his fingers' ends.
        expect(flesh.fore[0][0]).toBe(0);
        expect(flesh.fore[flesh.fore.length - 1][0]).toBe(1);
        expect(flesh.hand.length).toBeGreaterThanOrEqual(3);
        expect(flesh.fist.length).toBeGreaterThanOrEqual(1);
        expect(flesh.grip).toBeGreaterThan(0.04);
        for (const [, radius] of [...flesh.fore, ...flesh.hand, ...flesh.fist]) {
            expect(radius).toBeGreaterThan(0.01);
            expect(radius).toBeLessThan(0.08);
        }
    });

    it('takes a file with no flesh for a body that keeps out of nothing', () => {
        expect(fleshFromSpec({ bones: [] })).toBeNull();
        expect(fleshFromSpec({ flesh: { masses: [] } })).toBeNull();
        expect(fleshFromSpec(null)).toBeNull();
        // And a body told of a mass on a bone it has not got keeps out of nothing either.
        const body = new TrollBody(restFromSpec(SPEC), {
            sole: SPEC.sole,
            flesh: {
                masses: [{
                    name: 'tail', bone: 'tail', kind: 'ell', c: [0, 0, 0], r: [1, 1, 1],
                }],
                fore: [],
                hand: [],
                fist: [],
            },
        });
        expect(body.flesh).toBeNull();
    });
});

describe('stillwater troll flesh: his arms kept out of his own body', () => {
    const bare = live(null);
    const kept = live(FLESH_OF_HIM);

    it('would stand deep in him without it: the hand on his knee in his lap, a hand on his heart through his belly', () => {
        // (What the solve is for. Were these to vanish, the test below would pin nothing.)
        expect(bare['sits on his stone'].deep.R * CM).toBeGreaterThan(6);
        expect(bare.bows.deep.R * CM).toBeGreaterThan(12);
        expect(bare['knocks his staff'].deep.L * CM).toBeGreaterThan(6);
        expect(bare['walks home'].deep.L * CM).toBeGreaterThan(8);
    });

    it('rests his hand clear of his lap when he sits, and gets up and sits down again without it going into him', () => {
        for (const label of ['sits on his stone', 'gets up', 'sits again']) {
            expect(kept[label].deep.R * CM, label).toBeLessThan(3);
            expect(kept[label].deep.L * CM, label).toBeLessThan(3);
        }
    });

    it('keeps the arm that holds his staff out of him: walking, wading, knocking it on the water, carrying it home', () => {
        for (const label of ['walks down to the water\'s edge', 'knocks his staff', 'wades into the shallows', 'crouches to the water',
            'rises', 'walks home', 'raises his lantern']) {
            expect(kept[label].deep.L * CM, label).toBeLessThan(6);
        }
    });

    it('lays a hand on his heart or his belly without going through him to do it', () => {
        expect(kept.bows.deep.R * CM).toBeLessThan(bare.bows.deep.R * CM * 0.5);
        expect(kept.laughs.deep.R * CM).toBeLessThan(4);
    });

    it('is nowhere deeper in him than a hand\'s breadth, where it was a forearm\'s', () => {
        expect(worst(bare, 'deep', 'R') * CM).toBeGreaterThan(15);
        expect(worst(kept, 'deep', 'R') * CM).toBeLessThan(11);
        expect(worst(kept, 'deep', 'L') * CM).toBeLessThan(6);
    });

    it('moves both hands without a jump: no hand\'s velocity changes by more than a quick gesture\'s in one frame', () => {
        // (His staff hand once flew half a metre in a frame as it slid on the staff; a knock of
        // the staff, the quickest thing he does with it, changes its velocity by about 4 m/s.)
        for (const side of ['L', 'R']) {
            for (const [label, row] of Object.entries(kept)) expect(row.jump[side], `${label} ${side}`).toBeLessThan(6.5);
        }
    });
});

describe('stillwater troll flesh: his hand on the staff', () => {
    it('slides on the staff no faster than a hand slides, and never jumps along it', () => {
        let lastSlide = null;
        let biggest = 0;
        live(FLESH_OF_HIM, (body) => {
            const slide = body.staffSlide;
            if (lastSlide !== null && body.staffWrist) biggest = Math.max(biggest, Math.abs(slide - lastSlide));
            lastSlide = slide;
        });
        expect(biggest).toBeLessThanOrEqual(FIST_SLIDE_SPEED * DT + 1e-9);
    });

    it('sets the staff down after carrying it: it comes to the ground over a moment, it is not dropped', () => {
        // From held up to planted: how fast its grip comes down, at the fastest.
        const body = makeBody(FLESH_OF_HIM);
        const script = [[want(HOME), 3], [want(HOME, { staff: 'raise' }), 3], [want(HOME), 2.5]];
        let time = 0;
        let lastY = null;
        let fastest = 0;
        let settled = null;
        script.forEach(([wanted, seconds], stage) => {
            for (let i = 0; i < Math.round(seconds / DT); i++) {
                time += DT;
                body.update(DT, wanted, time);
                const { y } = body.staff.gripAt;
                if (stage === 2 && lastY !== null) fastest = Math.max(fastest, (lastY - y) / DT);
                lastY = y;
                if (stage === 2) settled = body.staff;
            }
        });
        expect(settled.mode).toBe('planted');
        // (It fell at twelve metres a second: the whole way down in an eighth of one.)
        expect(fastest).toBeGreaterThan(0.5);
        expect(fastest).toBeLessThan(4.5);
        // And it stands where it should by the end.
        expect(Math.abs(body.staff.foot.y - groundHeight(body.staff.foot.x, body.staff.foot.z))).toBeLessThan(0.08);
    });
});
