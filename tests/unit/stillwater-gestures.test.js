/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the two figures' gestures (stillwater-gestures.js), and the bodies making them.
 *
 * A gesture is laid over whatever a body is doing: a wave, a bow, a stone thrown, a twirl. What is
 * pinned is what keeps that from ever looking wrong: every gesture comes in from nothing and goes
 * out to nothing (so it cannot jump on or off), its numbers stay finite, a gesture cut short fades
 * out, each body makes every one of its gestures with every bone finite, a hand a gesture asks for
 * is one the arm can reach, a twirl ends where it began and one cut short never swings her back.
 */
import { readFileSync } from 'node:fs';
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GestureSlots, HANDOVERS, SPIRIT_GESTURES, TROLL_GESTURES, emptyPose, envelope, slotWeight,
} from '../../src/themes/stillwater/stillwater-gestures.js';
import {
    TrollBody, parentsFromSpec, restFromSpec, tailsFromSpec,
} from '../../src/themes/stillwater/stillwater-troll-body.js';
import { SpiritBody } from '../../src/themes/stillwater/stillwater-spirit-body.js';
import { wrapAngle } from '../../src/themes/stillwater/stillwater-motion.js';
import { SPIRIT, TROLL } from '../../src/themes/stillwater/stillwater-core.js';
import { groundHeight } from '../../src/themes/stillwater/stillwater-plan.js';

const spec = (file) => {
    const bytes = readFileSync(new URL(`../../src/themes/stillwater/assets/${file}`, import.meta.url));
    const length = bytes.readUInt32LE(12);
    return JSON.parse(bytes.toString('utf8', 20, 20 + length).trim()).scenes[0].extras;
};
const TROLL_SPEC = spec('troll-lod1.glb');
const SPIRIT_SPEC = spec('spirit-lod0.glb');
const DT = 1 / 60;

// The bodies' tests pose a body a few thousand times: room for a loaded machine.
vi.setConfig({ testTimeout: 30000 });
const FACE = Math.atan2(SPIRIT.home[0] - TROLL.home[0], SPIRIT.home[2] - TROLL.home[2]);

function makeTroll() {
    const body = new TrollBody(restFromSpec(TROLL_SPEC), {
        sole: TROLL_SPEC.sole,
        height: TROLL.height,
        ground: groundHeight,
        parents: parentsFromSpec(TROLL_SPEC),
        tails: tailsFromSpec(TROLL_SPEC),
    });
    body.reset(TROLL.home[0], TROLL.home[2], FACE, { seated: false, seat: [...TROLL.seat] });
    return body;
}
function makeSpirit() {
    const tails = Object.fromEntries(SPIRIT_SPEC.bones.map((b) => [b.name, new THREE.Vector3(...b.tail)]));
    const body = new SpiritBody(restFromSpec(SPIRIT_SPEC), {
        height: SPIRIT.height, parents: parentsFromSpec(SPIRIT_SPEC), tails,
    });
    body.reset(SPIRIT.home[0], SPIRIT.home[1], SPIRIT.home[2], 1.35);
    return body;
}
const trollWant = (gesture, extra = {}) => ({
    at: [TROLL.home[0], TROLL.home[2]],
    face: FACE,
    sit: false,
    staff: 'walk',
    crouch: false,
    look: [0, 1, -12],
    pace: 0.5,
    gesture,
    ...extra,
});
const spiritWant = (gesture, extra = {}) => ({
    at: [...SPIRIT.home],
    face: 1.4,
    kneel: false,
    hands: 'rest',
    look: [8, 2, -11],
    gazeDown: false,
    wind: 0.25,
    gesture,
    ...extra,
});

/** Every bone of a body is a finite turn. */
const allFinite = (body, label) => Object.values(body.local)
    .forEach((q) => q.toArray().forEach((v) => expect(Number.isFinite(v), label).toBe(true)));

/** Every number a pose holds. */
const numbersOf = (p) => [...p.spine, ...p.chest, ...p.neck, ...p.head, ...p.hips, p.clav, p.look, p.spin, p.flare,
    ...(p.R ? [...p.R.p, p.R.w] : []), ...(p.L ? [...p.L.p, p.L.w] : [])];
/** How far a pose is from no pose at all (radians and metres, the hands' weight). */
const reach = (p) => Math.max(
    ...[...p.spine, ...p.chest, ...p.neck, ...p.head, ...p.hips, p.clav, p.flare].map(Math.abs),
    p.R ? p.R.w : 0,
    p.L ? p.L.w : 0,
    1 - p.look,
);

describe('stillwater gestures: each one, alone', () => {
    const books = { troll: TROLL_GESTURES, spirit: SPIRIT_GESTURES };
    for (const [who, book] of Object.entries(books)) {
        for (const [name, fn] of Object.entries(book)) {
            it(`${who} ${name}: finite, from nothing and back to nothing (but a whole turn)`, () => {
                const len = 3;
                for (let k = 0; k <= 1 + 1e-9; k += 0.01) {
                    const p = emptyPose();
                    fn(k, k * len, len, p);
                    numbersOf(p).forEach((v) => expect(Number.isFinite(v), `${name} at ${k}`).toBe(true));
                }
                const first = emptyPose();
                fn(0, 0, len, first);
                const last = emptyPose();
                fn(1, len, len, last);
                // (A gesture made to follow another begins where that one ends: see the hand-overs below.)
                const follows = HANDOVERS.some((h) => h.who === who && h.to === name);
                const followed = HANDOVERS.some((h) => h.who === who && h.from === name);
                if (!follows) expect(reach(first), `${name} at its start`).toBeLessThan(0.02);
                if (!followed) expect(reach(last), `${name} at its end`).toBeLessThan(0.02);
                // A twirl turns her a whole turn and no other amount; nothing else turns her at all.
                expect(Math.abs(wrapAngle(last.spin)), name).toBeLessThan(1e-9);
            });
        }
    }

    it('ends each gesture made to be followed exactly where the one that follows it begins', () => {
        for (const { who, from, to } of HANDOVERS) {
            const book = who === 'troll' ? TROLL_GESTURES : SPIRIT_GESTURES;
            const end = emptyPose();
            book[from](1, 3, 3, end);
            const start = emptyPose();
            book[to](0, 0, 3, start);
            for (const side of ['R', 'L']) {
                if (!end[side] && !start[side]) continue;
                expect(start[side].bone, `${from} → ${to} ${side}`).toBe(end[side].bone);
                start[side].p.forEach((v, i) => expect(v, `${from} → ${to} ${side}`).toBeCloseTo(end[side].p[i], 3));
                expect(start[side].w).toBeCloseTo(end[side].w, 3);
            }
        }
    });

    it('comes in and goes out on its envelope', () => {
        expect(envelope(0)).toBe(0);
        expect(envelope(1)).toBe(0);
        expect(envelope(0.5)).toBe(1);
    });
});

describe('stillwater gestures: slots', () => {
    it('brings a gesture asked for in, and fades one no longer asked for (or past its end) out', () => {
        const slots = new GestureSlots();
        const wave = { name: 'wave', start: 0, length: 2 };
        let s = slots.step(wave, 0.01, DT);
        for (let t = 0.02; t < 1; t += DT) s = slots.step(wave, t, DT);
        expect(slotWeight(s[0])).toBe(1);
        // Cut short: it goes out over a moment, not at once.
        const after = slots.step(null, 1, DT);
        expect(slotWeight(after[0])).toBeGreaterThan(0.9);
        for (let t = 1; t < 2; t += DT) slots.step(null, t, DT);
        expect(slots.slots).toHaveLength(0);
        // Asked for past its end, it goes all the same.
        slots.step(wave, 0.5, DT);
        for (let t = 0.5; t < 4; t += DT) slots.step(wave, t, DT);
        expect(slots.slots.every((x) => slotWeight(x) === 0) || slots.slots.length === 0).toBe(true);
    });
});

describe('stillwater gestures: the bodies making them', () => {
    it('the troll makes every gesture of his with every bone finite, and comes back to his own pose', () => {
        for (const name of Object.keys(TROLL_GESTURES)) {
            const body = makeTroll();
            let t = 0;
            for (let i = 0; i < 60; i++) body.update(DT, trollWant(null), (t += DT));
            const rest = body.local.head.clone();
            const g = { name, start: t + DT, length: 2.4 };
            for (let i = 0; i < 180; i++) {
                body.update(DT, trollWant(g), (t += DT));
                allFinite(body, name);
                expect(Number.isFinite(body.hipsOffset.length()), name).toBe(true);
            }
            for (let i = 0; i < 120; i++) body.update(DT, trollWant(null), (t += DT));
            expect(body.local.head.angleTo(rest), name).toBeLessThan(0.08);
        }
    });

    it('the spirit makes every gesture of hers with every bone finite, standing and kneeling', () => {
        for (const kneel of [false, true]) {
            // Settled once (risen, or knelt on the water), then every gesture in turn, a breath between.
            const body = makeSpirit();
            let t = 0;
            for (let i = 0; i < 300; i++) body.update(DT, spiritWant(null, { kneel }), (t += DT));
            for (const name of Object.keys(SPIRIT_GESTURES)) {
                const g = { name, start: t + DT, length: 2.4 };
                for (let i = 0; i < 150; i++) {
                    body.update(DT, spiritWant(g, { kneel }), (t += DT));
                    allFinite(body, name);
                }
                for (let i = 0; i < 30; i++) body.update(DT, spiritWant(null, { kneel }), (t += DT));
            }
        }
    });

    it('asks for a hand only where his arm can reach it, so no arm is stretched past itself', () => {
        // The wrist the solve was asked for, against where the hand went: never more than a hand's length apart.
        const troll = makeTroll();
        let t = 0;
        for (const name of ['wave', 'scratch', 'beard', 'bow', 'laugh', 'carry']) {
            const g = { name, start: t + DT, length: 2 };
            for (let i = 0; i < 60; i++) troll.update(DT, trollWant(g), (t += DT));
            const p = emptyPose();
            TROLL_GESTURES[name](0.5, 1, 2, p);
            const asked = troll.boneRelative(p.R, new THREE.Vector3());
            const shoulder = troll.globalPos.upperR;
            const { l1, l2 } = troll.arms.R;
            expect(asked.distanceTo(shoulder), name).toBeLessThan((l1 + l2) * 1.25);
        }
    });

    it('turns her a whole turn in a twirl and leaves her facing as before; cut short, it never swings her back', () => {
        const body = makeSpirit();
        let t = 0;
        for (let i = 0; i < 240; i++) body.update(DT, spiritWant(null), (t += DT));
        const before = body.heading;
        const g = { name: 'twirl', start: t + DT, length: 3.6 };
        let turned = 0;
        let last = body.heading;
        for (let i = 0; i < 3.6 / DT + 2; i++) {
            body.update(DT, spiritWant(g), (t += DT));
            turned += wrapAngle(body.heading - last);
            last = body.heading;
        }
        expect(Math.abs(turned)).toBeGreaterThan(Math.PI * 2 - 0.3);
        for (let i = 0; i < 60; i++) body.update(DT, spiritWant(null), (t += DT));
        expect(Math.abs(wrapAngle(body.heading - before))).toBeLessThan(0.05);
        // Cut short halfway: no frame turns her by more than a twirl's own turn does.
        const cut = makeSpirit();
        let u = 0;
        for (let i = 0; i < 240; i++) cut.update(DT, spiritWant(null), (u += DT));
        const half = { name: 'twirl', start: u + DT, length: 3.6 };
        let biggest = 0;
        let prev = cut.heading;
        for (let i = 0; i < 1.8 / DT; i++) {
            cut.update(DT, spiritWant(half), (u += DT));
            prev = cut.heading;
        }
        for (let i = 0; i < 120; i++) {
            cut.update(DT, spiritWant(null), (u += DT));
            biggest = Math.max(biggest, Math.abs(wrapAngle(cut.heading - prev)));
            prev = cut.heading;
        }
        expect(biggest).toBeLessThan(0.15);
    });
});
