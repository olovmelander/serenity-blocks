/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the spirit's body (stillwater-spirit-body.js), posed from the real skeleton.
 *
 * She does not walk, she drifts; she kneels on the water and trails her hand in it; her hands are
 * placed by a two-bone solve for what she does with them; her gown's four panels and her two
 * links of hair hang from her whatever she does. These tests take her skeleton from the file the
 * game loads (spirit-lod0.glb's extras: heads, parents and tails) and pin what her motion promises
 * (she comes to rest where she is sent, a kneel turned back does not jump, her hair hangs down,
 * her gown spreads when she kneels, her fingertips touch the water only while she kneels, a replay
 * is the same), not the rates it is tuned with.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SPIRIT_ACT, SpiritBody } from '../../src/themes/stillwater/stillwater-spirit-body.js';
import { parentsFromSpec, restFromSpec } from '../../src/themes/stillwater/stillwater-troll-body.js';
import { wrapAngle } from '../../src/themes/stillwater/stillwater-motion.js';
import { HEART, SPIRIT, TROLL } from '../../src/themes/stillwater/stillwater-core.js';
import { spiritPathPoint } from '../../src/themes/stillwater/stillwater-story.js';

const SPEC = (() => {
    const bytes = readFileSync(new URL('../../src/themes/stillwater/assets/spirit-lod0.glb', import.meta.url));
    const length = bytes.readUInt32LE(12);
    return JSON.parse(bytes.toString('utf8', 20, 20 + length).trim()).scenes[0].extras;
})();
const TAILS = Object.fromEntries(SPEC.bones.map((b) => [b.name, new THREE.Vector3(...b.tail)]));

const DT = 1 / 60;
const HOME = [...SPIRIT.home];
/** A little way out over the water (where the world has her kneel), and as far as a chain brings her. */
const KNEEL = spiritPathPoint(0.28);
const OUT = spiritPathPoint(1);
const LANTERN = [TROLL.home[0] - 0.4, 2.4, TROLL.home[2] + 0.3];
const TO_HIM = Math.atan2(LANTERN[0] - HOME[0], LANTERN[2] - HOME[2]);
const PANELS = ['skirtF', 'skirtB', 'skirtL', 'skirtR'];

function makeBody() {
    const body = new SpiritBody(restFromSpec(SPEC), {
        height: SPIRIT.height, parents: parentsFromSpec(SPEC), tails: TAILS,
    });
    body.reset(HOME[0], HOME[1], HOME[2], 1.35);
    return body;
}

/** What she means to do, as the world would put it. */
const want = (at, extra = {}) => ({
    at: [...at], face: TO_HIM, kneel: false, hands: 'rest', look: null, gazeDown: true, wind: 0.25, ...extra,
});

function live(body, script, { start = 0, dt = DT, each = null } = {}) {
    let time = start;
    for (const [label, wanted, seconds] of script) {
        const frames = Math.round(seconds / dt);
        for (let i = 0; i < frames; i++) {
            time += dt;
            body.update(dt, wanted, time);
            if (each) each(body, label, time, i);
        }
    }
    return time;
}

/** Where a bone's tail is now (her model frame). */
function tailOf(body, name) {
    const offset = TAILS[name].clone().sub(body.rest[name]).applyQuaternion(body.global[name]);
    return body.globalPos[name].clone().add(offset);
}

/** Which way a bone points now (her model frame, which stands upright). */
const directionOf = (body, name) => tailOf(body, name).sub(body.globalPos[name]).normalize();

function poseOf(body) {
    return [
        ...Object.keys(body.local).flatMap((name) => body.local[name].toArray()),
        ...body.hipsOffset.toArray(), ...body.root.toArray(), body.heading, body.kneelK,
    ];
}

describe('stillwater spirit body: drifting', () => {
    it('drifts to where she is asked, never further, and comes to rest there facing him', () => {
        const body = makeBody();
        const trips = [['out over the water', OUT], ['back to her stone', HOME], ['to her kneeling place', KNEEL]];
        for (const [label, at] of trips) {
            let gap = Infinity;
            live(body, [[label, want(at), 14]], {
                start: body.time,
                each: (b) => {
                    const now = Math.hypot(b.root.x - at[0], b.root.z - at[2]);
                    expect(now, label).toBeLessThanOrEqual(gap + 1e-9);
                    gap = now;
                },
            });
            expect(gap, label).toBeLessThan(0.01);
            expect(Math.abs(body.root.y - at[1]), label).toBeLessThan(0.02);
            expect(body.velocity.length(), label).toBeLessThan(0.01);
            expect(Math.abs(wrapAngle(body.heading - TO_HIM)), label).toBeLessThan(0.02);
            expect(body.mode, label).toBe('standing');
        }
    });

    // Her float follows where she is (low over the water), not where she is sent, so the frame she
    // is sent out or called home moves her no more than a millimetre (found pinned: she hopped 1 cm).
    it('rises into her float and out of it without a hop when she is sent out or called home', () => {
        const body = makeBody();
        let wanted = want(HOME);
        let time = live(body, [['rests on her stone', wanted, 3]]);
        const hops = [];
        for (const [label, at] of [['sent out', OUT], ['called home', HOME], ['sent out again', KNEEL]]) {
            // (At a moment her float is near its deepest or highest, so a hop would show.)
            while (Math.abs(Math.sin((time + DT) * 1.7)) < 0.9) {
                time = live(body, [['waits', wanted, DT]], { start: time });
            }
            const before = body.root.y;
            wanted = want(at);
            time = live(body, [[label, wanted, DT]], { start: time });
            hops.push(Math.abs(body.root.y - before));
            time = live(body, [[label, wanted, 6]], { start: time });
        }
        expect(Math.max(...hops)).toBeLessThan(0.001);
    });

    it('glides: never more than a few centimetres in a frame', () => {
        const body = makeBody();
        let fastest = 0;
        let last = body.root.clone();
        live(body, [['out', want(OUT), 10], ['home', want(HOME), 10]], {
            each: (b) => {
                fastest = Math.max(fastest, Math.hypot(b.root.x - last.x, b.root.z - last.z));
                last = b.root.clone();
            },
        });
        expect(fastest).toBeGreaterThan(0);
        expect(fastest).toBeLessThan(0.05);
    });
});

describe('stillwater spirit body: kneeling', () => {
    it('kneels on the water when asked where she is, and rises again', () => {
        const body = makeBody();
        let time = live(body, [['drifts out', want(KNEEL), 10]]);
        const standing = body.hipsOffset.y;
        const modes = [];
        time = live(body, [['kneels', want(KNEEL, { kneel: true }), SPIRIT_ACT.kneel + 1]], {
            start: time,
            each: (b) => {
                if (modes.at(-1) !== b.mode) modes.push(b.mode);
            },
        });
        expect(modes).toEqual(['kneel', 'kneeling']);
        expect(body.kneelK).toBeCloseTo(1, 6);
        expect(body.hipsOffset.y).toBeLessThan(standing - 0.1);
        modes.length = 0;
        live(body, [['rises', want(KNEEL), SPIRIT_ACT.rise + 1]], {
            start: time,
            each: (b) => {
                if (modes.at(-1) !== b.mode) modes.push(b.mode);
            },
        });
        expect(modes).toEqual(['rise', 'standing']);
        expect(body.kneelK).toBeCloseTo(0, 6);
        expect(body.hipsOffset.y).toBeCloseTo(standing, 2);
    });

    it('does not kneel while she is still on her way, nor drift while she kneels', () => {
        const body = makeBody();
        // Asked to kneel far from where she is, she drifts there first.
        let kneltAway = false;
        let time = live(body, [['asked to kneel out there', want(KNEEL, { kneel: true }), 2]], {
            each: (b) => {
                if (b.mode !== 'standing') kneltAway = true;
            },
        });
        expect(kneltAway).toBe(false);
        time = live(body, [['comes and kneels', want(KNEEL, { kneel: true }), 14]], { start: time });
        expect(body.mode).toBe('kneeling');
        // Kneeling, she stays where she knelt until she has risen.
        const knelt = body.root.clone();
        live(body, [['asked away', want(OUT), SPIRIT_ACT.rise * 0.9]], { start: time });
        expect(body.mode).toBe('rise');
        expect(Math.hypot(body.root.x - knelt.x, body.root.z - knelt.z)).toBeLessThan(1e-9);
    });

    it('turns a kneel cut short into a rise from where it got to, without a jump', () => {
        const measure = (script) => {
            const body = makeBody();
            const time = live(body, [['drifts out', want(KNEEL), 10]]);
            let kneel = 0;
            let hips = 0;
            let lastK = body.kneelK;
            let lastHips = body.hipsOffset.clone();
            const modes = new Set();
            live(body, script, {
                start: time,
                each: (b) => {
                    modes.add(b.mode);
                    kneel = Math.max(kneel, Math.abs(b.kneelK - lastK));
                    hips = Math.max(hips, b.hipsOffset.distanceTo(lastHips) * b.H);
                    lastK = b.kneelK;
                    lastHips = b.hipsOffset.clone();
                },
            });
            return {
                kneel, hips, modes, body,
            };
        };
        const whole = measure([['kneels', want(KNEEL, { kneel: true }), SPIRIT_ACT.kneel + 1]]);
        expect(whole.body.mode).toBe('kneeling');
        for (const share of [0.2, 0.5, 0.8]) {
            const cut = measure([
                ['kneels', want(KNEEL, { kneel: true }), SPIRIT_ACT.kneel * share],
                ['is called', want(KNEEL), SPIRIT_ACT.rise + 1],
            ]);
            const label = `cut at ${share}`;
            expect([...cut.modes], label).toEqual(['kneel', 'rise', 'standing']);
            expect(cut.body.kneelK, label).toBeCloseTo(0, 6);
            expect(cut.kneel, label).toBeLessThan(whole.kneel * 2);
            expect(cut.hips, label).toBeLessThan(Math.max(whole.hips * 2, 0.004));
        }
    });

    it('trails her fingertips in the water now and then while she kneels, and only then', () => {
        const body = makeBody();
        const touches = [];
        const note = (b, label, time) => {
            for (const e of b.events) {
                touches.push({
                    ...e, label, time, mode: b.mode, kneel: b.kneelK, hand: b.toWalk(b.globalPos.handR),
                });
            }
        };
        let time = live(body, [['drifts out', want(KNEEL), 10]], { each: note });
        expect(touches).toEqual([]);
        time = live(body, [['kneels', want(KNEEL, { kneel: true }), 30]], { start: time, each: note });
        const kneeling = touches.length;
        expect(kneeling).toBeGreaterThanOrEqual(3);
        live(body, [['rises', want(KNEEL), 10], ['drifts home', want(HOME), 10]], { start: time, each: note });
        expect(touches.length).toBe(kneeling);
        for (const e of touches) {
            expect(e.type).toBe('touch');
            // Down on the water: knelt, or all but.
            expect(['kneel', 'kneeling', 'rise']).toContain(e.mode);
            expect(e.kneel).toBeGreaterThan(0.95);
            // On the water, where her right hand is.
            expect(e.y).toBe(0);
            expect(Math.hypot(e.x - e.hand.x, e.z - e.hand.z)).toBeLessThan(1e-9);
            expect(e.strength).toBeGreaterThan(0);
        }
        // Now and then: a steady rhythm, never a stream.
        const gaps = touches.slice(1).map((e, i) => e.time - touches[i].time);
        expect(Math.min(...gaps)).toBeGreaterThan(1.5);
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(DT * 1.01);
    });
});

describe('stillwater spirit body: what hangs from her', () => {
    it('lets her hair hang down whatever her head does', () => {
        const looks = [
            ['up at the sky', want(KNEEL, { look: [KNEEL[0], 40, KNEEL[2] + 3], gazeDown: false })],
            ['down at her feet', want(KNEEL, { look: [KNEEL[0], -3, KNEEL[2] + 0.4], gazeDown: false })],
            ['across at him', want(KNEEL, { look: LANTERN, gazeDown: false })],
            ['far round to her left', want(KNEEL, { look: [KNEEL[0] - 6, 1, KNEEL[2] - 4], gazeDown: false })],
            ['into the water, kneeling', want(KNEEL, { kneel: true })],
            ['at the heart, kneeling', want(KNEEL, { kneel: true, look: [...HEART], gazeDown: false })],
        ];
        const heads = [];
        for (const [label, wanted] of looks) {
            const body = makeBody();
            let lowest = -Infinity;
            live(body, [['drifts out', want(KNEEL), 10], [label, wanted, 6]], {
                each: (b, step) => {
                    if (step === 'drifts out') return;
                    for (const name of ['hair1', 'hair2']) lowest = Math.max(lowest, directionOf(b, name).y);
                },
            });
            expect(lowest, label).toBeLessThan(-0.7);
            heads.push(body.global.head.clone());
        }
        // (Her head did turn: up and down are far apart.)
        expect(heads[0].angleTo(heads[1])).toBeGreaterThan(0.3);
    });

    it('streams her hair and her gown behind her as she drifts', () => {
        const way = Math.atan2(OUT[0] - HOME[0], OUT[2] - HOME[2]);
        const body = makeBody();
        live(body, [['rests, facing the way she will go', want(HOME, { face: way }), 4]]);
        const gown = () => tailOf(body, 'skirtF').sub(body.globalPos.skirtF).z;
        const hair = () => directionOf(body, 'hair2').z;
        const still = { gown: gown(), hair: hair() };
        // She sets off: in her own frame forward is +z, so what trails her goes toward −z.
        const trailed = { gown: 0, hair: 0 };
        live(body, [['drifts out', want(OUT, { face: way }), 2]], {
            start: 4,
            each: () => {
                trailed.gown = Math.min(trailed.gown, gown() - still.gown);
                trailed.hair = Math.min(trailed.hair, hair() - still.hair);
            },
        });
        expect(trailed.gown).toBeLessThan(-0.005);
        expect(trailed.hair).toBeLessThan(-0.02);
    });

    it('spreads her gown out on the water when she kneels', () => {
        const body = makeBody();
        let time = live(body, [['drifts out', want(KNEEL), 10]]);
        const reach = (name) => tailOf(body, name).sub(body.globalPos[name]);
        const standing = Object.fromEntries(PANELS.map((name) => [name, reach(name)]));
        time = live(body, [['kneels', want(KNEEL, { kneel: true }), SPIRIT_ACT.kneel + 2]], { start: time });
        expect(body.mode).toBe('kneeling');
        const kneeling = Object.fromEntries(PANELS.map((name) => [name, reach(name)]));
        // Out before her, behind her, to her left (+x) and to her right.
        expect(kneeling.skirtF.z).toBeGreaterThan(standing.skirtF.z + 0.05);
        expect(kneeling.skirtB.z).toBeLessThan(standing.skirtB.z - 0.05);
        expect(kneeling.skirtL.x).toBeGreaterThan(standing.skirtL.x + 0.05);
        expect(kneeling.skirtR.x).toBeLessThan(standing.skirtR.x - 0.05);
        // Standing, every panel hangs down.
        for (const name of PANELS) expect(standing[name].y, name).toBeLessThan(0);
        // And it gathers in again as she rises.
        live(body, [['rises', want(KNEEL), SPIRIT_ACT.rise + 2]], { start: time });
        for (const name of PANELS) {
            expect(reach(name).distanceTo(standing[name]), name).toBeLessThan(0.02);
        }
    });
});

describe('stillwater spirit body: her hands', () => {
    it('puts each hand where she means it, wherever her arm can reach', () => {
        const body = makeBody();
        const seen = { reachable: 0, worst: 0 };
        const target = new THREE.Vector3();
        const check = (b) => {
            for (const side of ['L', 'R']) {
                target.set(...b.hands[side].x);
                const arm = b.arms[side];
                if (b.globalPos[arm.names[0]].distanceTo(target) > arm.l1 + arm.l2 - 1e-3) continue;
                seen.reachable += 1;
                seen.worst = Math.max(seen.worst, b.globalPos[arm.names[2]].distanceTo(target) * b.H);
            }
        };
        const script = ['rest', 'open', 'heart', 'receive', 'reach', 'rest']
            .map((hands) => [hands, want(KNEEL, { hands, look: LANTERN, gazeDown: false }), 3]);
        live(body, script, { each: check });
        const { reachable, worst } = seen;
        expect(reachable).toBeGreaterThan(300);
        expect(worst).toBeLessThan(1e-6);
    });

    it('opens her hands wide for the heart, holds them to her breast, and reaches out toward him', () => {
        const settle = (hands, extra = {}) => {
            const body = makeBody();
            live(body, [['drifts out', want(OUT), 10], [hands, want(OUT, {
                hands, look: LANTERN, gazeDown: false, ...extra,
            }), 4]]);
            return body;
        };
        const width = (b) => b.globalPos.handL.distanceTo(b.globalPos.handR);
        const rest = settle('rest');
        const open = settle('open');
        const heart = settle('heart');
        const reach = settle('reach');
        expect(width(open)).toBeGreaterThan(width(rest) + 0.1);
        // At her breast: both hands near her chest.
        for (const side of ['handL', 'handR']) {
            expect(heart.globalPos[side].distanceTo(heart.globalPos.chest), side).toBeLessThan(0.15);
        }
        // Reaching, her right hand is nearer him than it is at rest.
        const toHim = (b) => b.toWalk(b.globalPos.handR).distanceTo(new THREE.Vector3(...LANTERN));
        expect(toHim(reach)).toBeLessThan(toHim(rest) - 0.1);
        // Her heart (where the light she takes goes) is in her breast.
        const at = reach.heartWalk();
        expect(at.y - reach.root.y).toBeGreaterThan(SPIRIT.height * 0.55);
        expect(at.y - reach.root.y).toBeLessThan(SPIRIT.height * 0.9);
        expect(Math.hypot(at.x - reach.root.x, at.z - reach.root.z)).toBeLessThan(0.3);
        expect(reach.handsWalk().toArray().every(Number.isFinite)).toBe(true);
    });
});

describe('stillwater spirit body: soundness', () => {
    it('stays finite and whole through frames of no time, long frames and every wish', () => {
        const body = makeBody();
        const frames = [0, DT, 0.1, 0.4, 1e-7, 0, DT * 3, 3];
        const wants = [
            want(KNEEL, { kneel: true }), want(OUT, { hands: 'reach', look: LANTERN }),
            want(OUT, { hands: 'open', wind: 4 }),
            want(HOME, { hands: 'heart', look: [0, 0, 0] }), want(KNEEL, {
                kneel: true, hands: 'receive', look: null, gazeDown: false,
            }),
            want([KNEEL[0] + 0.05, KNEEL[1], KNEEL[2]], { kneel: true, face: 7 }),
            want(OUT, { hands: 'nonsense', look: LANTERN }),
        ];
        let time = 0;
        const faults = [];
        for (let i = 0; i < 4000; i++) {
            const dt = frames[i % frames.length];
            time += dt;
            body.update(dt, wants[Math.floor(i / 170) % wants.length], time);
            for (const [name, q] of Object.entries(body.local)) {
                const whole = q.toArray().every(Number.isFinite) && Math.abs(q.length() - 1) <= 1e-6;
                if (!whole) faults.push(`${i}: ${name}`);
            }
            const numbers = [...body.root.toArray(), ...body.hipsOffset.toArray(), body.heading, body.kneelK,
                ...body.heartWalk().toArray()];
            if (!numbers.every(Number.isFinite)) faults.push(`${i}: ${numbers}`);
            for (const e of body.events) if (![e.x, e.y, e.z].every(Number.isFinite)) faults.push(`${i}: an event`);
            if (faults.length > 5) break;
        }
        expect(faults).toEqual([]);
    });

    it('moves the same for the same wishes: two of her, frame for frame', () => {
        const script = [
            ['drifts out', want(KNEEL), 8], ['kneels', want(KNEEL, { kneel: true }), 12],
            ['is called', want(OUT, { hands: 'reach', look: LANTERN }), 10], ['goes home', want(HOME), 8],
        ];
        const poses = [];
        live(makeBody(), script, { each: (b) => poses.push(poseOf(b)) });
        let frame = 0;
        let differ = 0;
        live(makeBody(), script, {
            each: (b) => {
                if (poseOf(b).some((v, k) => v !== poses[frame][k])) differ += 1;
                frame += 1;
            },
        });
        expect(frame).toBe(poses.length);
        expect(differ).toBe(0);
    });

    it('starts again from rest when she is set down: a reset keeps nothing of her drift', () => {
        const fresh = makeBody();
        const used = makeBody();
        live(used, [['drifts out', want(OUT, { hands: 'open' }), 3], ['kneels', want(KNEEL, { kneel: true }), 2]]);
        for (const body of [fresh, used]) body.reset(HOME[0], HOME[1], HOME[2], 1.35);
        const script = [['rests', want(HOME), 1], ['drifts out', want(KNEEL), 4]];
        const poses = [];
        live(fresh, script, { start: 40, each: (b) => poses.push(poseOf(b)) });
        let frame = 0;
        let worst = 0;
        live(used, script, {
            start: 40,
            each: (b) => {
                poseOf(b).forEach((v, k) => {
                    worst = Math.max(worst, Math.abs(v - poses[frame][k]));
                });
                frame += 1;
            },
        });
        expect(worst).toBe(0);
    });
});
