/**
 * Earth Core's clock (earth-core-clock.js): what the chapter is doing at a second, as pure
 * functions. A test can hold what the picture depends on: every event is continuous in time (no
 * pop when a slot turns), its place changes only while it is down, visits differ, and the numbers
 * stay in the ranges the shaders were authored for.
 */
import { describe, expect, it } from 'vitest';
import {
    EARTH_CORE_CLOCK,
    EARTH_CORE_FOUNTAIN_SITES,
    EARTH_CORE_PLATE_SITES,
    earthCoreActivity,
    earthCoreSlotHash,
    sampleEarthCoreClock,
} from '../../src/rendering/odyssey/chapter-environments/earth-core-clock.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { getChapterPathRange } from '../../src/rendering/odyssey/path-utils.js';

const HOUR = 3600;

describe('earth core clock', () => {
    it('hashes a slot to [0, 1), the same every time', () => {
        for (let slot = 0; slot < 400; slot += 1) {
            const h = earthCoreSlotHash(slot, 11);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(1);
            expect(earthCoreSlotHash(slot, 11)).toBe(h);
        }
    });

    it('keeps every level in range for an hour, and survives a bad clock', () => {
        for (let t = 0; t < HOUR; t += 0.37) {
            const c = sampleEarthCoreClock(t, {});
            [c.activity, c.fountain.power, c.plate.amount, c.rockfall.power, c.gust, c.vent, c.flare].forEach((v) => {
                expect(Number.isFinite(v)).toBe(true);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            });
            expect(c.fountain.height).toBeGreaterThan(6);
            expect(c.fountain.height).toBeLessThan(28);
            expect(c.fountain.radius).toBeGreaterThan(4);
            expect(c.fountain.radius).toBeLessThan(13);
        }
        [NaN, -5, Infinity].forEach((bad) => {
            const c = sampleEarthCoreClock(bad, {});
            expect(Number.isFinite(c.activity)).toBe(true);
            expect(Number.isFinite(c.fountain.power)).toBe(true);
        });
    });

    it('is continuous in time: no level steps when a slot turns', () => {
        // 1/60 s steps across an hour: the steepest any level moves in one frame. The attacks are
        // 0.25 s (the rock fall letting go) to 9 s (the plate), so a frame's step is small; a pop
        // (a place or a strength changing while the event is up) would be a step near 1.
        const dt = 1 / 60;
        let prev = sampleEarthCoreClock(0, {});
        let worst = 0;
        for (let t = dt; t < 900; t += dt) {
            const c = sampleEarthCoreClock(t, {});
            worst = Math.max(
                worst,
                Math.abs(c.activity - prev.activity),
                Math.abs(c.fountain.power - prev.fountain.power),
                Math.abs(c.plate.amount - prev.plate.amount),
                Math.abs(c.gust - prev.gust),
                Math.abs(c.vent - prev.vent),
                Math.abs(c.flare - prev.flare),
            );
            // The rock fall lets go in a quarter of a second: its own, larger, bound.
            expect(Math.abs(c.rockfall.power - prev.rockfall.power)).toBeLessThan(0.12);
            prev = c;
        }
        expect(worst).toBeLessThan(0.05);
    });

    it('moves an event only while it is down', () => {
        // The fountain's vent, its height and its radius, the plate's reach and the rock fall's
        // ledge are the slot's: within one play of an event they do not change.
        const dt = 0.05;
        let prev = sampleEarthCoreClock(0, {});
        for (let t = dt; t < 1800; t += dt) {
            const c = sampleEarthCoreClock(t, {});
            if (c.fountain.power > 0 && prev.fountain.power > 0) {
                expect(c.fountain.x).toBe(prev.fountain.x);
                expect(c.fountain.z).toBe(prev.fountain.z);
                expect(c.fountain.height).toBe(prev.fountain.height);
                expect(c.fountain.radius).toBe(prev.fountain.radius);
                expect(c.fountain.slot).toBe(prev.fountain.slot);
            }
            if (c.plate.amount > 0 && prev.plate.amount > 0) {
                expect(c.plate.x).toBe(prev.plate.x);
                expect(c.plate.radius).toBe(prev.plate.radius);
            }
            if (c.rockfall.power > 0 && prev.rockfall.power > 0) {
                expect(c.rockfall.azimuth).toBe(prev.rockfall.azimuth);
                expect(c.rockfall.slot).toBe(prev.rockfall.slot);
            }
            prev = c;
        }
    });

    it('makes two visits to the same orb different', () => {
        // The picture at a station is set by these levels; sampled a visit apart (30 s to 10 min)
        // they are rarely the same, and over an hour every vent and every reach has its turn.
        const vents = new Set();
        const reaches = new Set();
        let fountainUp = 0;
        let rockFalls = 0;
        let lastRock = -1;
        let moodLow = 1;
        let moodHigh = 0;
        for (let t = 0; t < HOUR; t += 0.5) {
            const c = sampleEarthCoreClock(t, {});
            if (c.fountain.power > 0.3) {
                fountainUp += 1;
                vents.add(`${c.fountain.x},${c.fountain.z}`);
            }
            if (c.plate.amount > 0.3) reaches.add(`${c.plate.x},${c.plate.z}`);
            if (c.rockfall.power > 0.5 && c.rockfall.slot !== lastRock) {
                rockFalls += 1;
                lastRock = c.rockfall.slot;
            }
            moodLow = Math.min(moodLow, c.activity);
            moodHigh = Math.max(moodHigh, c.activity);
        }
        expect(vents.size).toBe(EARTH_CORE_FOUNTAIN_SITES.length);
        expect(reaches.size).toBe(EARTH_CORE_PLATE_SITES.length);
        // A fountain plays a fair share of the time, and is down a fair share.
        const share = fountainUp / (HOUR * 2);
        expect(share).toBeGreaterThan(0.2);
        expect(share).toBeLessThan(0.7);
        // A rock fall is an occasion: more than a handful an hour, fewer than one a slot.
        expect(rockFalls).toBeGreaterThan(30);
        expect(rockFalls).toBeLessThan(HOUR / EARTH_CORE_CLOCK.ROCKFALL_SLOT);
        // The mood really banks and really rouses.
        expect(moodLow).toBeLessThan(0.15);
        expect(moodHigh).toBeGreaterThan(0.85);
        expect(earthCoreActivity(0)).toBeGreaterThan(0);
    });

    it('runs its events on periods that never fall into step', () => {
        const C = EARTH_CORE_CLOCK;
        const periods = [C.FOUNTAIN_SLOT, C.PLATE_SLOT, C.ROCKFALL_SLOT, C.GUST_SLOT, C.VENT_SLOT];
        const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
        for (let i = 0; i < periods.length; i += 1) {
            for (let j = i + 1; j < periods.length; j += 1) {
                expect(gcd(periods[i], periods[j]), `${periods[i]} and ${periods[j]}`).toBe(1);
            }
        }
    });

    it('stands every fountain in orb 1\'s frame, on the lake, clear of the orb card', () => {
        // Placed by scoring the real camera at orb 1's station (the only station that looks
        // across the lake): each vent lies in the lower part of that frame, left of the card that
        // covers the frame's right edge, and inside the lake plane.
        const rig = createOdysseyCameraRig();
        const range = getChapterPathRange(1);
        const cam = rig.poseAt(rig.parkOf(1));
        const lakeWorldY = range.start.y - 10;
        EARTH_CORE_FOUNTAIN_SITES.forEach((site) => {
            const w = rig.camera.position.clone().set(range.center.x + site.x, lakeWorldY, range.center.z + site.z);
            expect(rig.inFrame(cam, w, 1), `fountain at ${site.x},${site.z}`).toBe(true);
            const ndc = w.clone().project(cam);
            expect(ndc.y).toBeLessThan(-0.3);
            expect(ndc.x).toBeLessThan(0.55);
            expect(ndc.x).toBeGreaterThan(-0.75);
            expect(Math.hypot(site.x, site.z)).toBeLessThan(160);
        });
    });
});
