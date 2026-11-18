/**
 * THE FOLD IS LONGER (2026-11-17). The owner: "can we make inside the black hole longer and spread
 * out the orbs more so it is a longer experience inside the black hole!!!" Pinned here:
 *  - the stretch's schedule (transitions/odyssey-fold-stretch.js): one unit of progress covers
 *    `rate` times the world in chapter 7's middle, eased in and out, with a world measure that
 *    inverts exactly and leaves every reach that does not touch the stretch alone to the bit;
 *  - the longer rail (odyssey-path-stretch.js): today's curve, today's camera frames and today's
 *    rail rings to the bit everywhere outside the stretch, joined on smoothly at both ends;
 *  - the orbs: 50-55 stand at even world distances between orb 49's park and orb 56, each with a
 *    park of its own; orbs 49, 56 and 57 and the chapter boundaries do not move;
 *  - the time: a ride between two orbs of the fold takes ~3-4.5 s and the wheel and the drift
 *    slow in step with the world, while the dive (48 -> 49) and the way out (56 -> 57) keep
 *    exactly their own time.
 * LONGER AGAIN (2026-11-18; the owner: "increasing it even more so that we have a longer distance
 * between the orbs in the black hole"): the rate went 8.8 -> 15, the orbs ~69 u -> ~108 u apart.
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { OdysseyCameraController } from '../../src/rendering/odyssey/OdysseyCameraController.js';
import {
    ODYSSEY_PATH_CURVE_TYPE,
    ODYSSEY_PATH_TENSION,
    getActiveOdysseyPathData,
    getOdysseyPathCurve,
} from '../../src/rendering/odyssey/path-utils.js';
import { createOdysseyPathCurve } from '../../src/rendering/odyssey/odyssey-path-stretch.js';
import {
    CH7_FOLD_STRETCH,
    foldStretchArea,
    foldStretchMeasure,
    foldStretchProgress,
    foldStretchRange,
    foldStretchRate,
    foldStretchReach,
} from '../../src/rendering/odyssey/transitions/odyssey-fold-stretch.js';
import {
    foldRideBetween,
    foldTravelExtraMs,
    plungeTravelExtraMs,
    plungeTravelMeasure,
    plungeTravelProgress,
    resolveBlackHoleInsideProgress,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import { odysseyScrollPace } from '../../src/rendering/odyssey/odyssey-scroll-pace.js';
import {
    CH7_FOLD_RUSH_CALM,
    foldRushCalm,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import { resolveOdysseyPathReveal } from '../../src/rendering/odyssey/odyssey-path-horizon.js';
import { ODYSSEY_PATH_DATA } from '../../src/rendering/odyssey/path-data.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const rig = createOdysseyCameraRig();
const { cp, layout } = rig;
const range = foldStretchRange(cp);
const curve = getOdysseyPathCurve();
const points = getActiveOdysseyPathData().controlPoints.map((pt) => new THREE.Vector3(pt.x, pt.y, pt.z));
const plain = createOdysseyPathCurve(points, ODYSSEY_PATH_CURVE_TYPE, ODYSSEY_PATH_TENSION, null);
const FOLD_ORBS = [49, 50, 51, 52, 53, 54, 55, 56];

/** The world length of the rail between two progress values, walked in fine steps. */
function railLength(c, p0, p1, steps = 4000) {
    let sum = 0;
    let prev = c.getPointAt(p0);
    for (let i = 1; i <= steps; i += 1) {
        const pt = c.getPointAt(p0 + (((p1 - p0) * i) / steps));
        sum += pt.distanceTo(prev);
        prev = pt;
    }
    return sum;
}

/** The board's trip time (OdysseyBoardController.computeTravelDuration) between two orbs. */
const tripMs = (a, b) => 900 + (Math.abs(rig.parkOf(b) - rig.parkOf(a)) * 2600)
    + plungeTravelExtraMs(rig.parkOf(a), rig.parkOf(b), cp);

describe("the stretch's schedule", () => {
    it('sits in chapter 7, between the hairpin and the 7 -> 8 seam', () => {
        expect(range.a).toBeCloseTo(cp[6] + ((cp[7] - cp[6]) * CH7_FOLD_STRETCH.from), 12);
        expect(range.b).toBeCloseTo(cp[6] + ((cp[7] - cp[6]) * CH7_FOLD_STRETCH.to), 12);
        // After the eye is inside the hole, and after orb 49's park: the dive never sees it.
        expect(range.a).toBeGreaterThan(resolveBlackHoleInsideProgress(cp));
        expect(range.a).toBeGreaterThan(rig.parkOf(49));
        // Before orb 56's park and the 7 -> 8 seam test's first station (0.9427).
        expect(range.b).toBeLessThan(rig.parkOf(56));
        expect(range.b).toBeLessThan(0.9427);
    });

    it('covers `rate` times the world in its middle, easing up from 1 without a step', () => {
        expect(foldStretchRate(range.a - 1e-6, cp)).toBe(1);
        expect(foldStretchRate(range.b + 1e-6, cp)).toBe(1);
        expect(foldStretchRate(0.5, cp)).toBe(1);
        expect(foldStretchRate((range.a + range.b) / 2, cp)).toBeCloseTo(CH7_FOLD_STRETCH.rate, 12);
        // (whatever the rate, never steeper than a smoothstep over the whole shoulder: its
        // steepest is 1.5 times its mean)
        const steepest = ((CH7_FOLD_STRETCH.rate - 1) * 1.5 * 1e-6) / CH7_FOLD_STRETCH.shoulder;
        let prev = foldStretchRate(range.a - 0.001, cp);
        for (let p = range.a - 0.001; p <= range.b + 0.001; p += 1e-6) {
            const r = foldStretchRate(p, cp);
            expect(Math.abs(r - prev)).toBeLessThan(steepest * 1.01);
            prev = r;
        }
    });

    it('measures the world in closed form, and inverts it exactly', () => {
        // The closed form against a fine numeric integral of the rate.
        let numeric = 0;
        const h = 1e-6;
        for (let p = range.a - 0.0005; p < range.b + 0.0005; p += h) {
            numeric += (foldStretchRate(p + (h / 2), cp) - 1) * h;
        }
        expect(foldStretchArea(range.b + 0.001, cp)).toBeCloseTo(numeric, 7);
        expect(foldStretchArea(range.a, cp)).toBe(0);
        let prev = -Infinity;
        for (let p = range.a - 0.002; p <= range.b + 0.002; p += 0.000037) {
            const m = foldStretchMeasure(p, cp);
            expect(m).toBeGreaterThan(prev);
            prev = m;
            expect(foldStretchProgress(m, cp)).toBeCloseTo(p, 11);
        }
        // Outside it, progress is its own measure (to the bit before; a constant after).
        expect(foldStretchMeasure(0.4321, cp)).toBe(0.4321);
        expect(foldStretchMeasure(0.97, cp) - 0.97).toBeCloseTo(foldStretchArea(1, cp), 14);
    });

    it('leaves a reach that does not touch the stretch alone to the bit', () => {
        for (let p = 0; p <= 1; p += 0.0137) {
            [0.001, 0.0157, -0.004].forEach((d) => {
                const target = p + d;
                if (Math.max(p, target) <= range.a || Math.min(p, target) >= range.b) {
                    expect(foldStretchReach(p, target, cp)).toBe(target);
                }
            });
        }
        // Inside, a reach covers the same world as on today's rail.
        const p = range.a + 0.004;
        const target = foldStretchReach(p, p + 0.01, cp);
        expect(foldStretchMeasure(target, cp) - foldStretchMeasure(p, cp)).toBeCloseTo(0.01, 10);
    });
});

describe('the longer rail', () => {
    it('is today\'s curve to the bit outside the stretch', () => {
        // (and outside the city's, tests/unit/odyssey-city-longer.test.js)
        for (let i = 0; i <= 3000; i += 1) {
            const p = i / 3000;
            if (curve.inFoldStretch(p) || curve.inCityStretch(p)) continue;
            expect(curve.getPointAt(p).toArray()).toEqual(plain.getPointAt(p).toArray());
            expect(curve.getTangentAt(p).toArray()).toEqual(plain.getTangentAt(p).toArray());
        }
        expect(curve.getLength()).toBe(plain.getLength());
    });

    it("gives the camera today's frames to the bit outside the stretch", () => {
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 40000);
        const today = new OdysseyCameraController(camera, plain, {
            levelPositions: layout.levelPositions,
            chapterPositions: cp,
            startPosition: 0,
            idleAutoDrift: false,
        });
        for (let i = 0; i <= 2000; i += 1) {
            const p = i / 2000;
            if (curve.inFoldStretch(p) || curve.inCityStretch(p)) continue;
            const a = rig.controller.getPathDataAt(p);
            const b = today.getPathDataAt(p);
            ['position', 'tangent', 'normal', 'right'].forEach((k) => {
                expect(a[k].toArray()).toEqual(b[k].toArray());
            });
        }
    });

    it("lays today's rail rings to the bit outside the stretch, and as many a world unit inside", () => {
        const segments = 2400;
        const plan = curve.railSamplePlan(segments);
        const today = plain.computeFrenetFrames(segments, false);
        let outside = 0;
        plan.us.forEach((u, i) => {
            const ring = u * segments;
            if (curve.inFoldStretch(u) || curve.inCityStretch(u) || Math.abs(ring - Math.round(ring)) > 1e-9) return;
            const k = Math.round(ring);
            expect(plan.normals[i].toArray()).toEqual(today.normals[k].toArray());
            expect(plan.tangents[i].toArray()).toEqual(today.tangents[k].toArray());
            outside += 1;
        });
        expect(outside).toBeGreaterThan(segments * 0.95);
        // Inside: rings about as far apart in the world as everywhere else.
        const ringWorld = curve.getLength() / segments;
        for (let i = 1; i < plan.us.length; i += 1) {
            if (!curve.inFoldStretch(plan.us[i]) && !curve.inFoldStretch(plan.us[i - 1])) continue;
            const gap = curve.getPointAt(plan.us[i]).distanceTo(curve.getPointAt(plan.us[i - 1]));
            expect(gap).toBeLessThan(ringWorld * 1.5);
        }
    });

    it('is as long in the world as the schedule says, joined on smoothly at both ends', () => {
        const target = curve.getLength() * ((range.b - range.a) + foldStretchArea(range.b, cp));
        const walked = railLength(curve, range.a, range.b, 20000);
        expect(Math.abs(walked - target) / target).toBeLessThan(0.01);
        // Several times today's length there.
        expect(walked / railLength(plain, range.a, range.b)).toBeGreaterThan(5);
        // No corner anywhere: the tangent turns gently per unit of world.
        let prevT = curve.getTangentAt(range.a - 0.0005);
        let prevP = curve.getPointAt(range.a - 0.0005);
        for (let p = range.a - 0.0005; p <= range.b + 0.0005; p += 0.000005) {
            const t = curve.getTangentAt(p);
            const pt = curve.getPointAt(p);
            const world = Math.max(1e-6, pt.distanceTo(prevP));
            const turn = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, t.dot(prevT))));
            if (world > 0.05) expect(turn / world).toBeLessThan(3);
            // Never a jump in place either.
            expect(world).toBeLessThan(1.5);
            prevT = t;
            prevP = pt;
        }
    });

    it("turns the camera's frame through it without a step, meeting today's at both ends", () => {
        const v = () => new THREE.Vector3();
        const at = (p) => rig.controller.getPathDataAt(p, v(), v(), v(), v());
        let prev = at(range.a - 0.0004);
        for (let p = range.a - 0.0004; p <= range.b + 0.0004; p += 0.00001) {
            const f = at(p);
            expect(f.position.distanceTo(prev.position)).toBeLessThan(1.5);
            const turn = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, f.normal.dot(prev.normal))));
            expect(turn).toBeLessThan(1.5);
            prev = f;
        }
    });
});

describe('the orbs inside the hole', () => {
    it('keeps the chapter boundaries, and orbs 49, 56 and 57 where they were', () => {
        expect(cp).toEqual(ODYSSEY_PATH_DATA.chapterPositions);
        expect(rig.parkOf(49)).toBeCloseTo(0.8941, 4);
        expect(layout.levelPositionsById[56]).toBeCloseTo(0.9484, 4);
        expect(rig.parkOf(57)).toBeCloseTo(0.9781, 4);
    });

    it('gives every orb of the fold a park of its own, about as far from the next in the world', () => {
        const parks = FOLD_ORBS.map((id) => rig.parkOf(id));
        for (let i = 1; i < parks.length; i += 1) expect(parks[i]).toBeGreaterThan(parks[i - 1]);
        const gaps = parks.slice(1).map((p, i) => railLength(curve, parks[i], p, 6000));
        const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        gaps.forEach((g) => {
            expect(g).toBeGreaterThan(95);
            expect(Math.abs(g - mean) / mean).toBeLessThan(0.2);
        });
        // The whole walk from orb 49 to orb 56 is five and a half times the short rail's (~758 u,
        // was ~139 before 2026-11-17 and ~485 after it).
        expect(railLength(curve, parks[0], parks[parks.length - 1])).toBeGreaterThan(
            railLength(plain, parks[0], parks[parks.length - 1]) * 5,
        );
    });

    it('stands the orbs on the stretched rail by its schedule', () => {
        // Orbs 50-55 stand one even step of the world measure apart, the first one step on from
        // orb 49's park (FOLD_LEVEL_POSITIONS_BY_ID in odyssey-layout.js, rounded to 1e-6).
        const m = (id) => foldStretchMeasure(id === 49 ? rig.parkOf(49) : layout.levelPositionsById[id], cp);
        const steps = [50, 51, 52, 53, 54, 55].map((id) => m(id) - m(id - 1));
        steps.forEach((s) => expect(Math.abs(s - steps[0]) / steps[0]).toBeLessThan(0.001));
    });
});

describe('the time inside', () => {
    it('makes every ride between two orbs of the fold a ride of 3 to 4.5 seconds', () => {
        let total = 0;
        for (let i = 1; i < FOLD_ORBS.length; i += 1) {
            const [a, b] = [FOLD_ORBS[i - 1], FOLD_ORBS[i]];
            expect(foldRideBetween(rig.parkOf(a), rig.parkOf(b), cp)).toBe(true);
            const there = tripMs(a, b);
            const back = tripMs(b, a);
            expect(there).toBeGreaterThan(3000);
            expect(there).toBeLessThan(4500);
            expect(back).toBeCloseTo(there, 6);
            total += there;
        }
        // Seven rides, some twenty-seven seconds (a jump and a swing of ~0.9 s each before
        // 2026-11-17, ~24 s with the first longer fold).
        expect(total).toBeGreaterThan(25000);
    });

    it('leaves the dive and the way out their own time', () => {
        expect(foldRideBetween(rig.parkOf(48), rig.parkOf(49), cp)).toBe(false);
        expect(foldRideBetween(rig.parkOf(56), rig.parkOf(57), cp)).toBe(false);
        expect(foldTravelExtraMs(rig.parkOf(48), rig.parkOf(49), cp)).toBe(0);
        expect(foldTravelExtraMs(rig.parkOf(56), rig.parkOf(57), cp)).toBe(0);
        expect(foldTravelExtraMs(rig.parkOf(30), rig.parkOf(58), cp)).toBe(0);
        // The plunge's measure does not see the stretch before it, nor across the way out.
        for (let p = cp[5]; p <= range.a; p += 0.00071) {
            expect(plungeTravelMeasure(p, cp) - foldStretchArea(p, cp)).toBe(plungeTravelMeasure(p, cp));
        }
        const m56 = plungeTravelMeasure(rig.parkOf(56), cp);
        const m57 = plungeTravelMeasure(rig.parkOf(57), cp);
        expect(plungeTravelProgress(m56, cp)).toBeCloseTo(rig.parkOf(56), 10);
        expect(plungeTravelProgress(m57, cp)).toBeCloseTo(rig.parkOf(57), 10);
    });

    it("calms the post's rush on the rides only, never in the dive", () => {
        for (let p = cp[5]; p <= rig.parkOf(49); p += 0.0001) expect(foldRushCalm(p, 1, cp)).toBe(0);
        expect(foldRushCalm(rig.parkOf(49), 1, cp)).toBe(0);
        expect(foldRushCalm(rig.parkOf(50), 1, cp)).toBeCloseTo(CH7_FOLD_RUSH_CALM.amount, 9);
        expect(foldRushCalm(rig.parkOf(52), 0, cp)).toBe(0);
        let prev = 0;
        for (let p = rig.parkOf(49); p <= rig.parkOf(50); p += 0.00001) {
            const c = foldRushCalm(p, 1, cp);
            expect(Math.abs(c - prev)).toBeLessThan(0.002);
            prev = c;
        }
    });

    it('rides at an even world speed through the stretch', () => {
        // A ride eased in the travel measure: the eye's world speed never jumps at A or B.
        const p0 = rig.parkOf(50);
        const p1 = rig.parkOf(51);
        const m0 = plungeTravelMeasure(p0, cp);
        const m1 = plungeTravelMeasure(p1, cp);
        const L = curve.getLength();
        let prevSpeed = 0;
        let prevPt = curve.getPointAt(p0);
        const n = 2000;
        for (let i = 1; i <= n; i += 1) {
            const r = i / n;
            const e = r < 0.5 ? 4 * r * r * r : 1 - ((((-2 * r) + 2) ** 3) / 2);
            const pt = curve.getPointAt(plungeTravelProgress(m0 + ((m1 - m0) * e), cp));
            const speed = pt.distanceTo(prevPt) * n;
            expect(Math.abs(speed - prevSpeed)).toBeLessThan(L * (m1 - m0) * 0.05);
            prevSpeed = speed;
            prevPt = pt;
        }
    });

    it('slows the wheel and the drift in step with the world, and nowhere else', () => {
        // In world units a second, the pace never jumps through the stretch...
        let prev = odysseyScrollPace(range.a - 0.001, cp) * foldStretchRate(range.a - 0.001, cp);
        for (let p = range.a - 0.001; p <= range.b + 0.001; p += 1e-5) {
            const world = odysseyScrollPace(p, cp) * foldStretchRate(p, cp);
            expect(Math.abs(world - prev)).toBeLessThan(0.02);
            prev = world;
        }
        // ...and in progress it is `rate` times slower in its middle.
        const mid = (range.a + range.b) / 2;
        const outside = odysseyScrollPace(range.a - 0.0001, cp);
        expect(odysseyScrollPace(mid, cp) * CH7_FOLD_STRETCH.rate).toBeCloseTo(outside, 1);
    });

    it('lays the way on out during the dive exactly where it did', () => {
        // The first node past the inside point used to be orb 50, at 0.8835; it is far on now,
        // and the reveal keeps its old end.
        const reveal = resolveOdysseyPathReveal(cp, layout.levelPositions);
        expect(reveal.start).toBe(resolveBlackHoleInsideProgress(cp));
        expect(reveal.end).toBeCloseTo(0.8835, 6);
    });
});
