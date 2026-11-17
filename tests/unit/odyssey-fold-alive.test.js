/**
 * THE FOLD, ALIVE AND IN ITS OWN TIME (masterpiece pass, 2026-11-17). Pinned here, all pure:
 *  - the fold's clock (transitions/odyssey-fold-clock.js): three moods never in step, one
 *    happening a slot at a different place in each, quarter turns that add up, all without a
 *    step in time, and all still under reduced motion;
 *  - what is shown (odyssey-fold-rooms.js advanceFoldShow): a trip between two orbs of the
 *    chapter JUMPS the progress, so the next room opens on the clock, never on one frame; the way
 *    out alone follows the rail;
 *  - the way out's share of a trip (odyssey-black-hole-fall.js CH7_EXIT_TRAVEL): the trip from
 *    orb 56 to orb 57 spends its middle there, as the 48 -> 49 trip does in the plunge.
 */
import { describe, expect, it } from 'vitest';

import {
    CH7_FOLD_CLOCK,
    foldHappeningStart,
    resolveFoldClock,
} from '../../src/rendering/odyssey/transitions/odyssey-fold-clock.js';
import {
    CH7_FOLD_OPENING,
    CH7_FOLD_PLACE_IDS,
    CH7_FOLD_ROOMS,
    advanceFoldShow,
    createFoldShow,
    resolveFoldRoom,
    resolveFoldRoomAnchors,
} from '../../src/rendering/odyssey/transitions/odyssey-fold-rooms.js';
import {
    CH7_EXIT_TRAVEL,
    plungeTravelExtraMs,
    plungeTravelMeasure,
    plungeTravelProgress,
    plungeTravelTouches,
    resolveExitStretch,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import { resolveSunCarry } from '../../src/rendering/odyssey/chapter-environments/urban-dreams-sun-carry.js';
import {
    CH7_FOLD_ENTRY_SPAN,
    CH7_WARP_DRIVE,
    createBlackHoleTranscendenceEnvironment,
    updateBlackHoleTranscendenceEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

describe("the fold's clock", () => {
    it('turns three moods that are never in step, each within 0..1 and without a step', () => {
        const [a, b, c] = CH7_FOLD_CLOCK.moods;
        expect(new Set([a, b, c]).size).toBe(3);
        // No period a whole multiple of another: they do not come round together for a long while.
        expect(b % a).not.toBe(0);
        expect(c % a).not.toBe(0);
        expect(c % b).not.toBe(0);
        let prev = resolveFoldClock(0).mood;
        for (let t = 0.05; t < 400; t += 0.05) {
            const { mood } = resolveFoldClock(t);
            for (let i = 0; i < 3; i += 1) {
                expect(mood[i]).toBeGreaterThanOrEqual(0);
                expect(mood[i]).toBeLessThanOrEqual(1);
                expect(Math.abs(mood[i] - prev[i])).toBeLessThan(0.005);
            }
            prev = mood;
        }
        // Two visits a minute apart are not the same room.
        const first = resolveFoldClock(30).mood;
        const later = resolveFoldClock(90).mood;
        expect(first.some((m, i) => Math.abs(m - later[i]) > 0.15)).toBe(true);
    });

    it('has one happening in every slot, at a different place in each, rising and falling without a step', () => {
        const C = CH7_FOLD_CLOCK;
        const starts = [];
        for (let k = 0; k < 12; k += 1) {
            const start = foldHappeningStart(k);
            expect(start).toBeGreaterThanOrEqual(k * C.slot);
            expect(start + C.last).toBeLessThanOrEqual((k + 1) * C.slot + 1e-9);
            starts.push(start - (k * C.slot));
            // Its strength is whole in the middle and nothing at both ends.
            expect(resolveFoldClock(start + (C.last / 2)).event).toBeCloseTo(1, 6);
            expect(resolveFoldClock(start).event).toBeCloseTo(0, 6);
            expect(resolveFoldClock(start + C.last).event).toBeCloseTo(0, 6);
        }
        expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(C.slot * 0.3);
        let prev = resolveFoldClock(0);
        let busy = 0;
        const dt = 0.02;
        for (let t = dt; t < C.slot * 8; t += dt) {
            const now = resolveFoldClock(t);
            expect(now.event).toBeGreaterThanOrEqual(0);
            expect(now.event).toBeLessThanOrEqual(1);
            // Calm: nothing rises faster than a fifth of its strength in a tenth of a second.
            expect(Math.abs(now.event - prev.event)).toBeLessThan(0.006);
            if (now.event > 0 && prev.event > 0) {
                expect(now.eventAge - prev.eventAge).toBeCloseTo(dt, 6);
            }
            if (now.event > 0) busy += dt;
            prev = now;
        }
        // Rare: something is happening about a third of the time.
        expect(busy / (C.slot * 8)).toBeGreaterThan(0.2);
        expect(busy / (C.slot * 8)).toBeLessThan(0.45);
    });

    it('counts a quarter turn for every happening, eased through it, and wraps at a whole turn', () => {
        const C = CH7_FOLD_CLOCK;
        const firstEnd = foldHappeningStart(0) + C.last;
        expect(resolveFoldClock(foldHappeningStart(0) - 0.01).turns).toBeCloseTo(0, 6);
        expect(resolveFoldClock(firstEnd + 0.01).turns).toBeCloseTo(1, 6);
        expect(resolveFoldClock(foldHappeningStart(2) - 0.01).turns).toBeCloseTo(2, 6);
        let prev = resolveFoldClock(0).turns;
        for (let t = 0.05; t < C.slot * 5; t += 0.05) {
            const { turns } = resolveFoldClock(t);
            expect(turns).toBeGreaterThanOrEqual(0);
            expect(turns).toBeLessThan(4);
            // A step only where four quarters wrap to none (the same turn).
            const step = turns - prev;
            expect(step > -1e-9 ? step : step + 4).toBeLessThan(0.02);
            prev = turns;
        }
    });

    it('is still under reduced motion', () => {
        [0, 17, 300].forEach((t) => {
            expect(resolveFoldClock(t, { still: true })).toEqual({
                mood: [0.5, 0.5, 0.5], event: 0, eventAge: 0, eventSeed: 0, turns: 0,
            });
        });
        expect(resolveFoldClock(Number.NaN).event).toBe(0);
    });
});

describe('a room opens in its own time, however the eye got there', () => {
    const rig = createOdysseyCameraRig();
    const { cp } = rig;
    const anchors = resolveFoldRoomAnchors(cp);
    const at = (p) => resolveFoldRoom(p, anchors, cp);
    const idOf = (name) => CH7_FOLD_PLACE_IDS[name];

    it('takes the eye\'s room whole on its first frame', () => {
        const show = advanceFoldShow(createFoldShow(), at(rig.parkOf(53)), 1 / 60);
        expect(show.from).toBe(idOf('flock'));
        expect(show.to).toBe(idOf('flock'));
        expect(show.morph).toBe(0);
        expect(show.exit).toBe(0);
    });

    it('opens the next room over a second and more when the progress jumps from one orb to the next', () => {
        const show = advanceFoldShow(createFoldShow(), at(rig.parkOf(51)), 1 / 60);
        // The trip 51 -> 52 inside the chapter: the progress is simply at orb 52 on the next frame.
        let frames = 0;
        let prev = 0;
        let opened = null;
        for (let t = 0; t < 3; t += 1 / 60) {
            advanceFoldShow(show, at(rig.parkOf(52)), 1 / 60);
            frames += 1;
            if (frames === 1) {
                // Not a cut: the lattice is still whole on the first frame, the nave just begun.
                expect(show.from).toBe(idOf('lattice'));
                expect(show.to).toBe(idOf('nave'));
                expect(show.morph).toBeLessThan(0.01);
                expect(show.door).toEqual(CH7_FOLD_ROOMS[2].door);
            }
            if (show.from !== show.to) {
                expect(show.morph).toBeGreaterThanOrEqual(prev - 1e-12);
                expect(show.morph - prev).toBeLessThan(0.03);
                prev = show.morph;
            } else if (opened === null) {
                opened = t;
            }
        }
        expect(opened).toBeGreaterThan(CH7_FOLD_OPENING.seconds * 0.9);
        expect(opened).toBeLessThan(CH7_FOLD_OPENING.seconds * 1.1);
        expect(show.from).toBe(idOf('nave'));
        expect(show.to).toBe(idOf('nave'));
    });

    it('goes back the same way, and hurries a room on when another is asked for behind it', () => {
        const show = advanceFoldShow(createFoldShow(), at(rig.parkOf(54)), 1 / 60);
        advanceFoldShow(show, at(rig.parkOf(53)), 1 / 60);
        expect(show.from).toBe(idOf('stairs'));
        expect(show.to).toBe(idOf('flock'));
        // A third of the way in, the eye jumps on to orb 51: the flock finishes fast, then the
        // lattice opens through it (never a room swapped mid-wave).
        for (let t = 0; t < CH7_FOLD_OPENING.seconds / 3; t += 1 / 60) {
            advanceFoldShow(show, at(rig.parkOf(53)), 1 / 60);
        }
        const before = show.morph;
        expect(before).toBeGreaterThan(0.1);
        let swapped = null;
        for (let t = 0; t < 3; t += 1 / 60) {
            const wasTo = show.to;
            const wasMorph = show.morph;
            advanceFoldShow(show, at(rig.parkOf(51)), 1 / 60);
            if (show.to !== wasTo && swapped === null) {
                swapped = t;
                // The swap comes only once the flock was whole.
                expect(wasMorph === 0 || wasMorph > 0.97).toBe(true);
                expect(show.from).toBe(idOf('flock'));
                expect(show.to).toBe(idOf('lattice'));
            }
        }
        expect(swapped).toBeLessThan((CH7_FOLD_OPENING.seconds * (2 / 3)) / CH7_FOLD_OPENING.hurry + 0.1);
        expect(show.to).toBe(idOf('lattice'));
        expect(show.from).toBe(idOf('lattice'));
    });

    it('does not flap when the eye drifts about the middle between two orbs', () => {
        const show = advanceFoldShow(createFoldShow(), at(anchors[2]), 1 / 60);
        const mid = (anchors[2] + anchors[3]) / 2;
        const seen = new Set();
        for (let t = 0; t < 20; t += 1 / 60) {
            advanceFoldShow(show, at(mid + (Math.sin(t * 3) * (anchors[3] - anchors[2]) * 0.03)), 1 / 60);
            seen.add(show.to);
        }
        expect([...seen]).toEqual([idOf('nave')]);
    });

    it("holds the last orb's room whole where the eye comes into it from the room before", () => {
        // Just short of orb 56's park the room coordinate is already the paint's (the room before
        // has given way): the hall has not begun.
        const show = advanceFoldShow(createFoldShow(), at(rig.parkOf(55)), 1 / 60);
        const nearly = rig.parkOf(56) - 0.0004;
        for (let t = 0; t < 4; t += 1 / 60) advanceFoldShow(show, at(nearly), 1 / 60);
        expect(show.to).toBe(idOf('paint'));
        expect(show.from).toBe(idOf('paint'));
        expect(show.exit).toBe(0);
    });

    it('opens the way out in step with the rail, and closes it again going back', () => {
        const show = advanceFoldShow(createFoldShow(), at(rig.parkOf(56)), 1 / 60);
        let prev = 0;
        for (let p = rig.parkOf(56); p <= cp[7] + 0.002; p += 0.00005) {
            const target = at(p);
            advanceFoldShow(show, target, 1 / 60);
            const opened = Math.min(1, Math.max(0, target.index - 6));
            expect(show.exit).toBeCloseTo(opened, 9);
            if (opened > 0 && opened < 1) expect(show.morph).toBeCloseTo(opened, 9);
            else expect(show.morph).toBe(0);
            expect(show.exit).toBeGreaterThanOrEqual(prev - 1e-12);
            expect(show.exit - prev).toBeLessThan(0.04);
            prev = show.exit;
        }
        expect(show.exit).toBe(1);
        expect(show.to).toBe(idOf('hall'));
        for (let p = cp[7]; p >= rig.parkOf(56); p -= 0.00005) advanceFoldShow(show, at(p), 1 / 60);
        expect(show.exit).toBe(0);
        expect(show.to).toBe(idOf('paint'));
        expect(show.from).toBe(idOf('paint'));
    });
});

describe("the fold's own travel", () => {
    it('never jumps while the eye is inside, though the drive\'s phase wraps, and begins afresh each time', () => {
        const rig = createOdysseyCameraRig();
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const camera = rig.poseAt(rig.parkOf(53));
        const inside = rig.parkOf(53);
        const windowUniforms = group.userData.distantHole.userData.singularity;
        updateBlackHoleTranscendenceEnvironment(group, 0.016, 100, camera, inside);
        const first = windowUniforms.uPhase.value;
        expect(first).toBeGreaterThanOrEqual(100 % CH7_FOLD_ENTRY_SPAN);
        expect(first).toBeLessThan((100 % CH7_FOLD_ENTRY_SPAN) + 1);
        // Carry the drive to just under its wrap, and across it.
        group.userData.warpDrive.phase = CH7_WARP_DRIVE.wrap - 0.004;
        group.userData.warpDrive.lastPhase = CH7_WARP_DRIVE.wrap - 0.004;
        let prev = windowUniforms.uPhase.value;
        let wrapped = false;
        for (let i = 0; i < 60; i += 1) {
            const before = group.userData.warpDrive.phase;
            updateBlackHoleTranscendenceEnvironment(group, 0.016, 100 + (i * 0.016), camera, inside);
            if (group.userData.warpDrive.phase < before) wrapped = true;
            const now = windowUniforms.uPhase.value;
            expect(now).toBeGreaterThan(prev);
            expect(now - prev).toBeLessThan(0.2);
            prev = now;
        }
        expect(wrapped).toBe(true);
        // Out of the hole and in again later: a fresh start, by the clock.
        updateBlackHoleTranscendenceEnvironment(group, 0.016, 700, camera, rig.cp[6] - 0.02);
        updateBlackHoleTranscendenceEnvironment(group, 0.016, 700.016, camera, inside);
        expect(windowUniforms.uPhase.value).toBeGreaterThanOrEqual(700 % CH7_FOLD_ENTRY_SPAN);
        expect(windowUniforms.uPhase.value).toBeLessThan((700 % CH7_FOLD_ENTRY_SPAN) + 1);
    });
});

describe('the way out takes its time', () => {
    const rig = createOdysseyCameraRig();
    const { cp } = rig;
    const ease = (r) => (r < 0.5 ? 4 * r * r * r : 1 - (((-2 * r) + 2) ** 3) / 2);
    const stretch = resolveExitStretch(cp);

    /** Milliseconds a trip spends in the way out's stretch, eased in the travel measure. */
    function wayOutMs(p0, p1, warped = true) {
        const T = 900 + (Math.abs(p1 - p0) * 2600) + (warped ? plungeTravelExtraMs(p0, p1, cp) : 0);
        const m0 = plungeTravelMeasure(p0, cp);
        const m1 = plungeTravelMeasure(p1, cp);
        let tIn = null;
        let tOut = null;
        for (let t = 0; t <= T; t += 1) {
            const e = ease(t / T);
            const p = warped ? plungeTravelProgress(m0 + ((m1 - m0) * e), cp) : p0 + ((p1 - p0) * e);
            if (tIn === null && p >= stretch.from) tIn = t;
            if (tOut === null && p >= stretch.to) tOut = t;
        }
        return { inside: tOut - tIn, total: T };
    }

    it('covers the hall opening to the mouth passing the frame, between orb 56 and the city', () => {
        expect(stretch.from).toBeGreaterThan(rig.parkOf(56));
        expect(stretch.from - rig.parkOf(56)).toBeLessThan(0.002);
        // By its end the mouth is past the corners of a 16:9 frame (about 57 of its 80 degrees)...
        expect(resolveSunCarry(stretch.to, cp).open).toBeGreaterThan(0.7);
        // ...and it ends on chapter 7's side of the line: the city's own stretch is not slowed.
        expect(stretch.to).toBeLessThan(cp[7]);
        expect(CH7_EXIT_TRAVEL.to).toBeLessThan(1);
    });

    it('gives it a second and a half of the 56 -> 57 trip instead of a third of one', () => {
        const before = wayOutMs(rig.parkOf(56), rig.parkOf(57), false);
        const after = wayOutMs(rig.parkOf(56), rig.parkOf(57));
        expect(before.inside).toBeLessThan(400);
        expect(after.inside).toBeGreaterThan(1400);
        expect(after.total).toBeLessThan(4200);
    });

    it('inverts exactly, touches only trips that cross it, and gives a long trip no more time', () => {
        for (let p = stretch.from - 0.01; p <= stretch.to + 0.01; p += 0.00037) {
            expect(plungeTravelProgress(plungeTravelMeasure(p, cp), cp)).toBeCloseTo(p, 10);
        }
        let prev = -Infinity;
        for (let p = stretch.from - 0.005; p <= stretch.to + 0.005; p += 1e-5) {
            const m = plungeTravelMeasure(p, cp);
            expect(m).toBeGreaterThan(prev);
            prev = m;
        }
        expect(plungeTravelTouches(rig.parkOf(56), rig.parkOf(57), cp)).toBe(true);
        expect(plungeTravelTouches(rig.parkOf(52), rig.parkOf(55), cp)).toBe(false);
        expect(plungeTravelTouches(rig.parkOf(58), rig.parkOf(60), cp)).toBe(false);
        expect(plungeTravelExtraMs(rig.parkOf(56), rig.parkOf(57), cp)).toBeCloseTo(CH7_EXIT_TRAVEL.extraMs, 6);
        expect(plungeTravelExtraMs(rig.parkOf(57), rig.parkOf(56), cp)).toBeCloseTo(CH7_EXIT_TRAVEL.extraMs, 6);
        expect(plungeTravelExtraMs(rig.parkOf(52), rig.parkOf(55), cp)).toBe(0);
        expect(plungeTravelExtraMs(rig.parkOf(20), rig.parkOf(58), cp)).toBe(0);
    });
});
