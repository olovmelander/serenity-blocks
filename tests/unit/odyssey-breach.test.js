/**
 * THE BREACH IS A MOMENT (masterpiece pass, 2026-11-17).
 *
 * Filmed before this pass, the trip from orb 10 to orb 11 showed the sea in one frame and the
 * island in the next: the eye crossed the surface where the trip's ease runs fastest. Now the trip
 * eases in a measure that weighs the surface (transitions/odyssey-travel-measure.js), and the
 * crossing fires a burst (composition/odyssey-breach-burst.js). These hold the timing and the
 * burst's rules; the world's shaders are built in odyssey-ocean-shaders.test.js.
 */
import { describe, expect, it } from 'vitest';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { ODYSSEY_BREACH_P } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    plungeTravelMeasure, plungeTravelTouches,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import {
    BREACH_TRAVEL, breachTravelArea, breachTravelExtraMs, breachTravelTouches, journeyTravelExtraMs,
    journeyTravelMeasure, journeyTravelProgress, journeyTravelTouches,
} from '../../src/rendering/odyssey/transitions/odyssey-travel-measure.js';
import {
    BREACH_BURST, breachBurstLife, breachLight, crownDropAt, surfaceCrossing,
} from '../../src/rendering/odyssey/composition/odyssey-breach-burst.js';
import { resolveOrbParkProgress } from '../../src/rendering/odyssey/odyssey-chapter-arrival.js';

const layout = getLevelRegistry().getPresentationLayout();
const cp = layout.chapterPositions;
const park = (id) => resolveOrbParkProgress(id <= 10 ? 2 : 3, layout.levelPositionsById[id], cp);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (((-2 * t) + 2) ** 3) / 2);

/** The trip as the camera plays it: progress at each moment of a `ms` long trip from a to b. */
function trip(a, b, ms, dt = 1 / 60) {
    const ma = journeyTravelMeasure(a, cp);
    const mb = journeyTravelMeasure(b, cp);
    const out = [];
    for (let t = 0; t <= ms / 1000 + 1e-9; t += dt) {
        out.push({ t, p: journeyTravelProgress(ma + ((mb - ma) * ease(Math.min(1, (t * 1000) / ms))), cp) });
    }
    return out;
}

describe('the travel measure weighs the surface of the sea', () => {
    it('is progress itself away from the breach (and still the plunge\'s at the hole)', () => {
        [0, 0.05, 0.1, ODYSSEY_BREACH_P - BREACH_TRAVEL.before - BREACH_TRAVEL.shoulder - 1e-4].forEach((p) => {
            expect(journeyTravelMeasure(p, cp)).toBeCloseTo(plungeTravelMeasure(p, cp), 12);
        });
        const whole = breachTravelArea(1);
        expect(whole).toBeGreaterThan(0.05);
        [0.16, 0.3, 0.6, 0.86, 0.9, 1].forEach((p) => {
            expect(journeyTravelMeasure(p, cp)).toBeCloseTo(plungeTravelMeasure(p, cp) + whole, 12);
        });
    });

    it('is monotone and inverts exactly', () => {
        let prev = journeyTravelMeasure(0, cp);
        for (let p = 0.0005; p <= 1; p += 0.0005) {
            const m = journeyTravelMeasure(p, cp);
            expect(m).toBeGreaterThan(prev);
            prev = m;
        }
        [0.02, 0.1291, 0.1361, ODYSSEY_BREACH_P, 0.1385, 0.157, 0.4, 0.8709, 0.875, 0.99].forEach((p) => {
            expect(journeyTravelProgress(journeyTravelMeasure(p, cp), cp)).toBeCloseTo(p, 8);
        });
    });

    it('knows which trips cross it', () => {
        expect(breachTravelTouches(park(10), park(11))).toBe(true);
        expect(breachTravelTouches(park(11), park(10))).toBe(true);
        expect(breachTravelTouches(park(8), park(9))).toBe(false);
        expect(breachTravelTouches(0.16, 0.3)).toBe(false);
        expect(journeyTravelTouches(park(10), park(11), cp)).toBe(true);
        expect(journeyTravelTouches(0.2, 0.3, cp)).toBe(plungeTravelTouches(0.2, 0.3, cp));
        expect(journeyTravelTouches(0.86, 0.88, cp)).toBe(true);
    });

    it('gives a short trip through the surface its time, and a long one none', () => {
        const short = breachTravelExtraMs(park(10), park(11));
        expect(short).toBeGreaterThan(BREACH_TRAVEL.extraMs * 0.9);
        expect(short).toBeLessThanOrEqual(BREACH_TRAVEL.extraMs + 1e-6);
        expect(breachTravelExtraMs(park(11), park(10))).toBeCloseTo(short, 6);
        expect(breachTravelExtraMs(park(8), park(9))).toBe(0);
        expect(breachTravelExtraMs(0.07, 0.3)).toBeLessThan(1);
        expect(journeyTravelExtraMs(park(10), park(11), cp)).toBeCloseTo(short, 6);
    });

    it('holds the eye at the waterline: the 10 -> 11 trip lingers there, then goes on', () => {
        const from = park(10);
        const to = park(11);
        const ms = 900 + (Math.abs(to - from) * 2600) + breachTravelExtraMs(from, to);
        expect(ms).toBeGreaterThan(2300);
        expect(ms).toBeLessThan(3200);
        const frames = trip(from, to, ms);
        // About 2 u of eye height either side of the surface (the eye climbs ~11 u per 0.01 p there).
        const band = 0.0019;
        const atSurface = frames.filter((f) => Math.abs(f.p - ODYSSEY_BREACH_P) < band).length / 60;
        expect(atSurface).toBeGreaterThan(0.3);
        expect(atSurface).toBeLessThan(0.9);
        // The old trip spent under a tenth of a second there.
        const old = [];
        const oldMs = 900 + (Math.abs(to - from) * 2600);
        for (let t = 0; t <= oldMs / 1000; t += 1 / 60) old.push(from + ((to - from) * ease((t * 1000) / oldMs)));
        expect(old.filter((p) => Math.abs(p - ODYSSEY_BREACH_P) < band).length / 60).toBeLessThan(0.12);
        // It never stalls and never runs backwards; it arrives.
        for (let i = 1; i < frames.length; i += 1) expect(frames[i].p).toBeGreaterThanOrEqual(frames[i - 1].p - 1e-9);
        expect(frames.at(-1).p).toBeCloseTo(to, 6);
        // The surface rushes up for a moment before it, and the climb out is not held back long.
        const crossedAt = frames.find((f) => f.p >= ODYSSEY_BREACH_P).t;
        expect(crossedAt).toBeGreaterThan(0.8);
        expect(ms / 1000 - crossedAt).toBeLessThan(1.7);
    });

    it('lingers on the way down too (the dive back in)', () => {
        const from = park(11);
        const to = park(10);
        const ms = 900 + (Math.abs(to - from) * 2600) + breachTravelExtraMs(from, to);
        const frames = trip(from, to, ms);
        expect(frames.filter((f) => Math.abs(f.p - ODYSSEY_BREACH_P) < 0.0019).length / 60).toBeGreaterThan(0.3);
        expect(frames.at(-1).p).toBeCloseTo(to, 6);
    });
});

describe('the burst at the surface', () => {
    const SEA = 287.31;

    it('fires on the eye crossing the surface, either way, and not on a teleport', () => {
        expect(surfaceCrossing(SEA - 1, SEA + 0.5, SEA)).toBe(1);
        expect(surfaceCrossing(SEA + 2, SEA - 0.1, SEA)).toBe(-1);
        expect(surfaceCrossing(SEA - 4, SEA - 2, SEA)).toBe(0);
        expect(surfaceCrossing(SEA + 1, SEA + 9, SEA)).toBe(0);
        expect(surfaceCrossing(SEA - 30, SEA + 30, SEA)).toBe(0);
        expect(surfaceCrossing(null, SEA + 1, SEA)).toBe(0);
        expect(surfaceCrossing(SEA - 1, NaN, SEA)).toBe(0);
    });

    it('is over in a couple of seconds', () => {
        expect(breachBurstLife(1)).toBeGreaterThan(1.5);
        expect(breachBurstLife(1)).toBeLessThan(3);
        expect(breachBurstLife(-1)).toBeGreaterThan(1.5);
        expect(breachBurstLife(-1)).toBeLessThan(3.2);
    });

    it('floods the light in at the crossing and lets it go in half a second', () => {
        expect(breachLight(0)).toBeCloseTo(BREACH_BURST.light.gain, 10);
        expect(breachLight(0)).toBeLessThan(0.35);
        expect(breachLight(0.5)).toBeLessThan(breachLight(0) * 0.2);
        expect(breachLight(2)).toBeLessThan(0.001);
        expect(breachLight(-1)).toBe(0);
        expect(breachLight(NaN)).toBe(0);
        let prev = breachLight(0);
        for (let t = 0.01; t < 3; t += 0.01) {
            expect(breachLight(t)).toBeLessThan(prev);
            prev = breachLight(t);
        }
    });

    it('throws the crown up and out and lets gravity take it back to the sea', () => {
        const C = BREACH_BURST.crown;
        let fellBack = 0;
        const n = 200;
        for (let i = 0; i < n; i += 1) {
            const s = [(i * 0.618) % 1, (i * 0.381) % 1, (i * 0.723) % 1, (i * 0.137) % 1];
            expect(crownDropAt(...s, s[3] * C.stagger - 0.01)).toBeNull();
            const born = crownDropAt(...s, s[3] * C.stagger);
            expect(Math.hypot(born.x, born.z)).toBeGreaterThanOrEqual(C.ring[0] - 1e-9);
            expect(Math.hypot(born.x, born.z)).toBeLessThanOrEqual(C.ring[1] + 1e-9);
            expect(born.y).toBeCloseTo(0, 9);
            let top = 0;
            let prevR = Math.hypot(born.x, born.z);
            let landed = false;
            for (let t = 0.02; t < C.life[1] + C.stagger; t += 0.02) {
                const d = crownDropAt(...s, (s[3] * C.stagger) + t);
                top = Math.max(top, d.y);
                const r = Math.hypot(d.x, d.z);
                expect(r).toBeGreaterThan(prevR);
                prevR = r;
                if (d.y < 0) { landed = true; break; }
            }
            expect(top).toBeGreaterThan(1.4);
            expect(top).toBeLessThan(10);
            if (landed) fellBack += 1;
        }
        // Nearly every drop is back in the sea before the burst is over.
        expect(fellBack / n).toBeGreaterThan(0.9);
    });

    it('scales its drops by tier', () => {
        expect(BREACH_BURST.crown.lowCount).toBeLessThanOrEqual(BREACH_BURST.crown.count / 2);
    });
});
