/**
 * THE CITY IS LONGER (2026-11-18). The owner: "I also want to lengthen the urban dreams encore so
 * we have a bit longer between the orbs in that chapter and travel a bit longer into that chapter."
 * Pinned here:
 *  - the city's schedule (transitions/odyssey-city-stretch.js): from just past orb 57's park (after
 *    the 7 -> 8 seam) to the journey's end a unit of progress covers `rate` times the world, eased
 *    in, with the journey's world measure (odyssey-rail-stretch.js) inverting exactly;
 *  - the carried rail (odyssey-path-stretch.js): today's curve to the bit up to its start, then
 *    today's sway and height over the street with a longer run down the boulevard's axis, smooth;
 *  - the city stays where it was authored: its anchor, its stage basis, the corridor's orientation
 *    and the Retrosun are read on today's rail;
 *  - the orbs: 58 and 59 at even world distances between orb 57's park and orb 60, each with a
 *    park of its own; orbs 57 and 60 and the chapter boundaries do not move;
 *  - the time: a ride between two orbs of the city rides the rail (~2 s, was a jump and a swing),
 *    the way out of the hole keeps its time to the bit, and the wheel and the drift slow in step
 *    with the world.
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_PATH_CURVE_TYPE,
    ODYSSEY_PATH_TENSION,
    getActiveOdysseyPathData,
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../../src/rendering/odyssey/path-utils.js';
import { createOdysseyPathCurve } from '../../src/rendering/odyssey/odyssey-path-stretch.js';
import {
    CH8_CITY_STRETCH,
    cityStretchArea,
    cityStretchRange,
    cityStretchRate,
} from '../../src/rendering/odyssey/transitions/odyssey-city-stretch.js';
import {
    railStretchArea,
    railStretchMeasure,
    railStretchProgress,
    railStretchRate,
    railStretchReach,
} from '../../src/rendering/odyssey/transitions/odyssey-rail-stretch.js';
import { foldStretchRange } from '../../src/rendering/odyssey/transitions/odyssey-fold-stretch.js';
import {
    CH8_CITY_TRAVEL,
    cityRideBetween,
    cityTravelExtraMs,
    journeyTravelExtraMs,
    journeyTravelMeasure,
    journeyTravelProgress,
} from '../../src/rendering/odyssey/transitions/odyssey-travel-measure.js';
import { plungeTravelExtraMs } from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import { seamWindowAt } from '../../src/rendering/odyssey/transitions/odyssey-seam-schedule.js';
import { computeStageBasis } from '../../src/rendering/odyssey/composition/odyssey-stage-frame.js';
import { odysseyScrollPace } from '../../src/rendering/odyssey/odyssey-scroll-pace.js';
import { resolveRetrosunStage } from '../../src/rendering/odyssey/chapter-environments/urban-dreams.js';
import { ODYSSEY_PATH_DATA } from '../../src/rendering/odyssey/path-data.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const rig = createOdysseyCameraRig();
const { cp, layout } = rig;
const range = cityStretchRange(cp);
const curve = getOdysseyPathCurve();
const points = getActiveOdysseyPathData().controlPoints.map((pt) => new THREE.Vector3(pt.x, pt.y, pt.z));
const plain = createOdysseyPathCurve(points, ODYSSEY_PATH_CURVE_TYPE, ODYSSEY_PATH_TENSION, null);
const CITY_ORBS = [57, 58, 59, 60];
const L = curve.getLength();

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

/** The board's trip time (OdysseyBoardController.computeTravelDuration) between two parks. */
const tripMs = (a, b) => 900 + (Math.abs(b - a) * 2600) + plungeTravelExtraMs(a, b, cp)
    + cityTravelExtraMs(a, b, cp);

/** A point in the city's own frame (its corridor: x across the lane, y up, -z down the boulevard). */
const stage = (() => {
    const basis = computeStageBasis(plain, cp[7], cp[8]);
    const { center } = getChapterPathRange(8);
    const m = new THREE.Matrix4().makeBasis(basis.right, basis.up, basis.forward.clone().negate());
    const inv = m.clone().invert();
    return (pt) => pt.clone().sub(center).applyMatrix4(inv);
})();

describe("the city's schedule", () => {
    it('starts past the 7 -> 8 seam and orb 57\'s park, and runs to the journey\'s end', () => {
        expect(range.a).toBeCloseTo(cp[7] + ((cp[8] - cp[7]) * CH8_CITY_STRETCH.from), 12);
        expect(range.b).toBe(1);
        expect(seamWindowAt(range.a, cp)).toBeNull();
        expect(range.a).toBeGreaterThan(rig.parkOf(57));
        // Never touching the fold's stretch.
        expect(range.a).toBeGreaterThan(foldStretchRange(cp).b);
    });

    it('covers `rate` times the world once under way, easing up from 1 without a step', () => {
        expect(cityStretchRate(range.a, cp)).toBe(1);
        expect(cityStretchRate(0.5, cp)).toBe(1);
        expect(cityStretchRate(range.a + range.s, cp)).toBeCloseTo(CH8_CITY_STRETCH.rate, 12);
        expect(cityStretchRate(1, cp)).toBeCloseTo(CH8_CITY_STRETCH.rate, 12);
        const steepest = ((CH8_CITY_STRETCH.rate - 1) * 1.5 * 1e-6) / CH8_CITY_STRETCH.shoulder;
        let prev = cityStretchRate(range.a - 0.001, cp);
        for (let p = range.a - 0.001; p <= 1; p += 1e-6) {
            const r = cityStretchRate(p, cp);
            expect(Math.abs(r - prev)).toBeLessThan(steepest * 1.01);
            prev = r;
        }
    });

    it('measures the world in closed form, and the journey measure inverts across both stretches', () => {
        let numeric = 0;
        const h = 1e-6;
        for (let p = range.a - 0.0005; p < 1; p += h) numeric += (cityStretchRate(p + (h / 2), cp) - 1) * h;
        expect(cityStretchArea(1, cp)).toBeCloseTo(numeric, 7);
        expect(cityStretchArea(range.a, cp)).toBe(0);
        let prev = -Infinity;
        for (let p = 0.9; p <= 1; p += 0.000037) {
            const m = railStretchMeasure(p, cp);
            expect(m).toBeGreaterThan(prev);
            prev = m;
            expect(railStretchProgress(m, cp)).toBeCloseTo(p, 11);
        }
        expect(railStretchRate(0.95, cp)).toBe(1);
        expect(railStretchArea(range.a, cp)).toBe(railStretchArea(0.95, cp));
        // Before both, progress is its own measure.
        expect(railStretchMeasure(0.4321, cp)).toBe(0.4321);
    });

    it('leaves a reach that touches neither stretch alone to the bit, and measures one in the world', () => {
        for (let p = 0; p <= 0.97; p += 0.0137) {
            [0.001, 0.0157, -0.004].forEach((d) => {
                const target = p + d;
                const touches = [foldStretchRange(cp), range].some((r) => Math.max(p, target) > r.a
                    && Math.min(p, target) < r.b);
                if (!touches) expect(railStretchReach(p, target, cp)).toBe(target);
            });
        }
        const p = range.a + 0.004;
        const target = railStretchReach(p, p + 0.01, cp);
        expect(railStretchMeasure(target, cp) - railStretchMeasure(p, cp)).toBeCloseTo(0.01, 10);
        expect(target - p).toBeCloseTo(0.01 / CH8_CITY_STRETCH.rate, 6);
    });
});

describe("the city's longer rail", () => {
    it("is today's curve to the bit up to the stretch, and its length stays the journey's scale", () => {
        for (let i = 0; i <= 3000; i += 1) {
            const p = (i / 3000) * range.a;
            if (curve.inFoldStretch(p)) continue;
            expect(curve.inCityStretch(p)).toBe(false);
            expect(curve.getPointAt(p).toArray()).toEqual(plain.getPointAt(p).toArray());
            expect(curve.getTangentAt(p).toArray()).toEqual(plain.getTangentAt(p).toArray());
        }
        expect(curve.getPointAt(range.a).toArray()).toEqual(plain.getPointAt(range.a).toArray());
        expect(curve.getLength()).toBe(plain.getLength());
    });

    it("keeps today's sway across the lane and height over the street, and runs on down the boulevard", () => {
        for (let p = range.a; p <= 1; p += 0.0002) {
            const today = stage(plain.getPointAt(p));
            const longer = stage(curve.getPointAt(p));
            expect(longer.x).toBeCloseTo(today.x, 6);
            expect(longer.y).toBeCloseTo(today.y, 6);
            // Down the boulevard (local -z) by exactly the stretch's extra world so far.
            expect(today.z - longer.z).toBeCloseTo(L * cityStretchArea(p, cp), 6);
        }
        // The journey now ends ~123 u down the boulevard from the city's centre (was ~45 u), still
        // far short of the spire (z -560) and inside the lane.
        const end = stage(curve.getPointAt(1));
        expect(end.z).toBeLessThan(-110);
        expect(end.z).toBeGreaterThan(-200);
        expect(Math.abs(end.x)).toBeLessThan(24);
    });

    it('is about as long in the world as the schedule says, with no corner', () => {
        const target = L * ((1 - range.a) + cityStretchArea(1, cp));
        const walked = railLength(curve, range.a, 1, 20000);
        // (today's sway is a little off the axis, so the walk is a few percent short of the measure)
        expect(walked / target).toBeGreaterThan(0.95);
        expect(walked / target).toBeLessThan(1.001);
        expect(walked / railLength(plain, range.a, 1)).toBeGreaterThan(2.2);
        let prevT = curve.getTangentAt(range.a - 0.0005);
        let prevP = curve.getPointAt(range.a - 0.0005);
        for (let p = range.a - 0.0005; p <= 1; p += 0.000005) {
            const t = curve.getTangentAt(p);
            const pt = curve.getPointAt(p);
            const world = pt.distanceTo(prevP);
            const turn = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, t.dot(prevT))));
            if (world > 0.05) expect(turn / world).toBeLessThan(3);
            expect(world).toBeLessThan(1.5);
            // The direction is the curve's own (finite differences agree, within the few tenths of
            // a degree today's rail's coarse arc-length table puts into its own speed).
            if (p > range.a + 0.0001 && p < 1 - 0.0001) {
                const d = curve.getPointAt(p + 1e-6).sub(curve.getPointAt(p - 1e-6)).normalize();
                expect(d.dot(t)).toBeGreaterThan(0.999);
            }
            prevT = t;
            prevP = pt;
        }
    });

    it('lays the rail tube with rings as far apart in the world as anywhere, square to the rail', () => {
        const segments = 2400;
        const plan = curve.railSamplePlan(segments);
        const today = plain.computeFrenetFrames(segments, false);
        const ringWorld = L / segments;
        let cityRings = 0;
        plan.us.forEach((u, i) => {
            if (curve.inCityStretch(u)) {
                cityRings += 1;
                expect(Math.abs(plan.normals[i].dot(plan.tangents[i]))).toBeLessThan(1e-9);
                expect(plan.tangents[i].distanceTo(curve.getTangentAt(u))).toBeLessThan(1e-9);
                return;
            }
            const ring = u * segments;
            if (curve.inFoldStretch(u) || Math.abs(ring - Math.round(ring)) > 1e-9) return;
            expect(plan.normals[i].toArray()).toEqual(today.normals[Math.round(ring)].toArray());
        });
        expect(cityRings).toBeGreaterThan((1 - range.a) * segments * 2);
        for (let i = 1; i < plan.us.length; i += 1) {
            if (!curve.inCityStretch(plan.us[i])) continue;
            const gap = curve.getPointAt(plan.us[i]).distanceTo(curve.getPointAt(plan.us[i - 1]));
            expect(gap).toBeLessThan(ringWorld * 1.5);
        }
    });

    it('gives the camera the carried place without a step, its frame square to the rail', () => {
        const v = () => new THREE.Vector3();
        let prev = rig.controller.getPathDataAt(range.a - 0.0004, v(), v(), v(), v());
        for (let p = range.a - 0.0004; p <= 1; p += 0.00001) {
            const f = rig.controller.getPathDataAt(p, v(), v(), v(), v());
            expect(f.position.distanceTo(prev.position)).toBeLessThan(1);
            // (the camera's table is today's rail sampled and interpolated, as everywhere)
            expect(f.position.distanceTo(curve.getPointAt(p))).toBeLessThan(0.1);
            expect(Math.abs(f.normal.dot(f.tangent))).toBeLessThan(1e-6);
            const turn = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, f.normal.dot(prev.normal))));
            expect(turn).toBeLessThan(1);
            prev = f;
        }
    });
});

describe('the city stays where it was authored', () => {
    it("anchors chapter 8 on today's rail", () => {
        const r = getChapterPathRange(8);
        expect(r.start.toArray()).toEqual(plain.getPointAt(cp[7]).toArray());
        expect(r.end.toArray()).toEqual(plain.getPointAt(1).toArray());
        // Every other chapter's ends are where the rail is anyway.
        for (let id = 1; id <= 7; id += 1) {
            const c = getChapterPathRange(id);
            expect(c.start.toArray()).toEqual(curve.getPointAt(cp[id - 1]).toArray());
            expect(c.end.toArray()).toEqual(curve.getPointAt(cp[id]).toArray());
        }
    });

    it("gives the camera today's stage frame, at today's centre", () => {
        const frame = rig.controller._getStageFrame();
        const today = computeStageBasis(plain, cp[7], cp[8]);
        ['forward', 'right', 'up'].forEach((k) => expect(frame[k].toArray()).toEqual(today[k].toArray()));
        expect(frame.center.distanceTo(getChapterPathRange(8).center)).toBeLessThan(0.05);
    });

    it('leaves the Retrosun the hole carries its sun onto where it was', () => {
        const sun = resolveRetrosunStage();
        expect(sun).not.toBeNull();
        const { center } = getChapterPathRange(8);
        const basis = computeStageBasis(plain, cp[7], cp[8]);
        // (its corridor orientation finds the chapter's ends by height on today's rail)
        const offset = sun.position.clone().sub(center);
        // ~700 u ahead down the boulevard, far past the journey's new end (~123 u).
        expect(offset.dot(basis.forward)).toBeGreaterThan(600);
        expect(stage(curve.getPointAt(1)).z).toBeGreaterThan(-200);
    });
});

describe('the orbs in the city', () => {
    it('keeps the chapter boundaries, orb 57\'s park and orb 60 where they were', () => {
        expect(cp).toEqual(ODYSSEY_PATH_DATA.chapterPositions);
        expect(rig.parkOf(57)).toBeCloseTo(0.9781, 4);
        expect(layout.levelPositionsById[57]).toBeCloseTo(0.9609, 6);
        expect(layout.levelPositionsById[60]).toBe(1);
    });

    it('stands 58 and 59 at even world distances, each with a park of its own', () => {
        const parks = CITY_ORBS.map((id) => rig.parkOf(id));
        for (let i = 1; i < parks.length; i += 1) expect(parks[i]).toBeGreaterThan(parks[i - 1]);
        // By the schedule: one even step of the world measure apart.
        const m = parks.map((p) => railStretchMeasure(p, cp));
        const steps = m.slice(1).map((x, i) => x - m[i]);
        steps.forEach((s) => expect(Math.abs(s - steps[0]) / steps[0]).toBeLessThan(0.001));
        // On the rail: ~43 u each (they were 0, 22 and 33 u).
        const gaps = parks.slice(1).map((p, i) => railLength(curve, parks[i], p, 6000));
        gaps.forEach((g) => {
            expect(g).toBeGreaterThan(38);
            expect(g).toBeLessThan(50);
        });
        // From orb 57's park to the journey's end, well over twice today's walk.
        expect(railLength(curve, parks[0], 1)).toBeGreaterThan(railLength(plain, parks[0], 1) * 2.2);
    });
});

describe('the time in the city', () => {
    it('rides the rail between two orbs of the city, about two seconds each', () => {
        for (let i = 1; i < CITY_ORBS.length; i += 1) {
            const [a, b] = [rig.parkOf(CITY_ORBS[i - 1]), rig.parkOf(CITY_ORBS[i])];
            expect(cityRideBetween(a, b, cp)).toBe(true);
            const there = tripMs(a, b);
            expect(there).toBeGreaterThan(1800);
            expect(there).toBeLessThan(3000);
            expect(tripMs(b, a)).toBeCloseTo(there, 6);
            expect(journeyTravelExtraMs(a, b, cp)).toBeCloseTo(cityTravelExtraMs(a, b, cp), 9);
            expect(cityTravelExtraMs(a, b, cp)).toBeLessThanOrEqual(CH8_CITY_TRAVEL.maxMs);
        }
    });

    it('leaves the way out of the hole, and every trip that is not a ride, its own time', () => {
        expect(cityRideBetween(rig.parkOf(56), rig.parkOf(57), cp)).toBe(false);
        expect(cityTravelExtraMs(rig.parkOf(56), rig.parkOf(57), cp)).toBe(0);
        expect(cityTravelExtraMs(rig.parkOf(30), rig.parkOf(59), cp)).toBe(0);
        expect(cityTravelExtraMs(rig.parkOf(52), rig.parkOf(53), cp)).toBe(0);
        // The travel measure is untouched up to the stretch (the way out ends at orb 57's park).
        for (let p = 0.9; p <= range.a; p += 0.00013) {
            expect(journeyTravelMeasure(p, cp) - cityStretchArea(p, cp)).toBe(journeyTravelMeasure(p, cp));
        }
    });

    it("rides into the stretch no less evenly than today's rail there", () => {
        // Today's rail near the journey's end is unevenly spaced in its own progress (three's
        // arc-length table: its world speed swings ~0.86x to ~1.21x across a few metres), and the
        // carried rail inherits that sway on a 2.5x longer run, so it is evener, never rougher.
        // The worst jump of the eye's world speed between two of 2000 frames of a ride, against
        // the ride's mean speed, on the longer rail eased in the world measure and on today's rail
        // eased in progress over the same orbs.
        const worstJump = (c, measure, progressOf, p0, p1) => {
            const m0 = measure(p0);
            const m1 = measure(p1);
            const n = 2000;
            let prevSpeed = 0;
            let prevPt = c.getPointAt(p0);
            let worst = 0;
            let walked = 0;
            const speeds = [];
            for (let i = 1; i <= n; i += 1) {
                const r = i / n;
                const e = r < 0.5 ? 4 * r * r * r : 1 - ((((-2 * r) + 2) ** 3) / 2);
                const pt = c.getPointAt(progressOf(m0 + ((m1 - m0) * e)));
                const step = pt.distanceTo(prevPt);
                walked += step;
                speeds.push(step * n);
                prevPt = pt;
            }
            const mean = walked;
            speeds.forEach((speed) => {
                worst = Math.max(worst, Math.abs(speed - prevSpeed) / mean);
                prevSpeed = speed;
            });
            return worst;
        };
        for (let i = 1; i < CITY_ORBS.length; i += 1) {
            const p0 = rig.parkOf(CITY_ORBS[i - 1]);
            const p1 = rig.parkOf(CITY_ORBS[i]);
            const longer = worstJump(curve, (p) => journeyTravelMeasure(p, cp), (m) => journeyTravelProgress(m, cp), p0, p1);
            const today = worstJump(plain, (p) => p, (m) => m, p0, p1);
            expect(longer).toBeLessThanOrEqual(today);
        }
    });

    it('slows the wheel and the drift in step with the world there', () => {
        let prev = odysseyScrollPace(range.a - 0.001, cp) * railStretchRate(range.a - 0.001, cp);
        for (let p = range.a - 0.001; p <= 1; p += 1e-5) {
            const world = odysseyScrollPace(p, cp) * railStretchRate(p, cp);
            expect(Math.abs(world - prev)).toBeLessThan(0.02);
            prev = world;
        }
        expect(odysseyScrollPace(0.995, cp) * CH8_CITY_STRETCH.rate).toBeCloseTo(odysseyScrollPace(0.97, cp), 6);
    });
});
