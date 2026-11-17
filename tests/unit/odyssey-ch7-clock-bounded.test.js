/**
 * THE DIVE LOOKS THE SAME AT ANY HOUR (2026-11-17). The last ring of starlight after the horizon
 * (chapter-environments/odyssey-closing-sky.tsl.js) turned by `time * turn` with its lanes sheared
 * across the ring, so the shear grew with the chapter's clock for as long as the game was open:
 * the violet and amber halves wound into fine concentric rings after half an hour, a pink moiré
 * after hours. Pinned here, all on the CPU:
 *  - the ring runs on its own clock (the chapter's modulo `clockPeriod`), every term periodic in
 *    it: the same winding at t, t + 1 h and t + 10 h, no step where the clock comes round, a shear
 *    that sways within bounds, and a fresh session as it was;
 *  - the abyss stirs on the drive's travel, whose wrap is a whole number of the noise's periods;
 *  - what else the dive and the fold read from the clock stays bounded: the drive's phase, the
 *    traced disk's turns (a seamless wrap), the hole's life, the fold's clock, and the window's
 *    uniform as the environment writes it.
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
    CH7_CLOSING_SKY,
    closingSkyClock,
    closingSkyWind,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-closing-sky.tsl.js';
import {
    CH7_WARP_DRIVE,
    advanceWarpDrive,
    createBlackHoleTranscendenceEnvironment,
    updateBlackHoleTranscendenceEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import {
    LATTICE_NOISE_PERIOD,
    latticeNoise3Cpu,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-lattice-noise.js';
import {
    GREAT_HOLE_DISK_MOTION,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-great-hole-lens.tsl.js';
import { greatHoleLifeAt } from '../../src/rendering/odyssey/chapter-environments/odyssey-great-hole-life.js';
import { resolveFoldClock } from '../../src/rendering/odyssey/transitions/odyssey-fold-clock.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';

const HOUR = 3600;
const LATER = [HOUR, 2 * HOUR, 10 * HOUR];
const STARTS = [0, 0.4, 12.5, 119.9, 299.3, 1234.5, 1799.95];
const ACROSS = [-2.5, -2, -1, -0.3, 0, 0.62, 1, 2.2, 4, 5];
const CLOSED = [0, 0.35, 0.8, 1];
/** An angle's difference, taken round the circle (rad). */
const turnApart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** The winding as it was: the clock's turn times the lanes' factor, growing without end. */
const oldWind = (t, closed, x) => ((closed * 4.2) + (t * 0.05)) * (1 - (Math.min(4, Math.max(-2, x)) * 0.06));

describe('the last ring of starlight on its own clock', () => {
    it('reads the same clock, and so the same winding, an hour and ten hours later', () => {
        STARTS.forEach((t) => {
            const c = closingSkyClock(t);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThan(CH7_CLOSING_SKY.clockPeriod);
            LATER.forEach((later) => {
                const c2 = closingSkyClock(t + later);
                expect(c2).toBeCloseTo(c, 9);
                CLOSED.forEach((closed) => ACROSS.forEach((x) => {
                    expect(closingSkyWind(c2, closed, x)).toBeCloseTo(closingSkyWind(c, closed, x), 9);
                }));
            });
        });
        // Every term divides the clock's period: the turn comes round a whole number of times in it.
        expect(CH7_CLOSING_SKY.clockPeriod % CH7_CLOSING_SKY.turnPeriod).toBe(0);
        expect(HOUR % CH7_CLOSING_SKY.clockPeriod).toBe(0);
    });

    it('has no step where its clock comes round', () => {
        const P = CH7_CLOSING_SKY.clockPeriod;
        CLOSED.forEach((closed) => ACROSS.forEach((x) => {
            const before = closingSkyWind(closingSkyClock(P - 1e-4), closed, x);
            const after = closingSkyWind(closingSkyClock(P + 1e-4), closed, x);
            expect(turnApart(before, after)).toBeLessThan(1e-3);
        }));
    });

    it('sways its lanes within bounds instead of winding them ever tighter', () => {
        const reach = (CH7_CLOSING_SKY.sway * CH7_CLOSING_SKY.clockPeriod) / (2 * Math.PI);
        let most = 0;
        for (let t = 0; t <= 10 * HOUR; t += 7.3) {
            const c = closingSkyClock(t);
            // The shear: how much farther round one width inward is wound than the line itself.
            const shear = Math.abs(closingSkyWind(c, 0, 0) - closingSkyWind(c, 0, 1));
            most = Math.max(most, shear);
            expect(shear).toBeLessThanOrEqual((reach * CH7_CLOSING_SKY.lanes) + 1e-9);
        }
        // Under a radian per width at its most: about what a fresh session showed after five minutes.
        expect(most).toBeLessThan(0.9);
        expect(most).toBeGreaterThan(0.8);
        // As it was, the shear an hour in was ten radians per width (the fine concentric rings).
        expect(Math.abs(oldWind(HOUR, 0, 0) - oldWind(HOUR, 0, 1))).toBeGreaterThan(10);
    });

    it('winds as a fresh session did over its first minute', () => {
        for (let t = 0; t <= 60; t += 0.5) {
            CLOSED.forEach((closed) => ACROSS.forEach((x) => {
                expect(turnApart(closingSkyWind(closingSkyClock(t), closed, x), oldWind(t, closed, x)))
                    .toBeLessThan(0.15);
            }));
        }
        // ...and exactly as it did at rest and under reduced motion (the clock held at 0).
        CLOSED.forEach((closed) => ACROSS.forEach((x) => {
            expect(closingSkyWind(0, closed, x)).toBeCloseTo(oldWind(0, closed, x), 12);
        }));
    });

    it('is written to the window as the environment runs, the same an hour on', () => {
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const cp = getActiveOdysseyChapterPositions();
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 9000);
        camera.position.set(267, 1358, -1146);
        camera.updateMatrixWorld(true);
        const inside = cp[6] + ((cp[7] - cp[6]) * 0.12);
        const windowUniforms = group.userData.distantHole.userData.singularity;
        expect(windowUniforms.uSkyClock).toBeDefined();
        const read = (time) => {
            updateBlackHoleTranscendenceEnvironment(group, 1 / 60, time, camera, inside);
            return windowUniforms.uSkyClock.value;
        };
        STARTS.forEach((t) => {
            const fresh = read(t);
            expect(fresh).toBeCloseTo(closingSkyClock(t), 9);
            LATER.forEach((later) => expect(read(t + later)).toBeCloseTo(fresh, 9));
        });
    });
});

describe('the rest of the dive and the fold stay bounded on the clock', () => {
    it("stirs the abyss on the drive's travel with no step where the drive's phase wraps", () => {
        // A whole number of the lattice noise's periods per wrap: the same noise either side.
        const periods = (CH7_WARP_DRIVE.wrap * CH7_CLOSING_SKY.stir) / LATTICE_NOISE_PERIOD;
        expect(Math.abs(periods - Math.round(periods))).toBeLessThan(1e-9);
        [0.3, 7.7, 40.1].forEach((z) => {
            const at = (phase) => latticeNoise3Cpu(1.1, -0.4, z - (phase * CH7_CLOSING_SKY.stir));
            expect(at(CH7_WARP_DRIVE.wrap - 1e-6)).toBeCloseTo(at(-1e-6), 6);
        });
    });

    it("keeps the warp drive's phase within its wrap through ten hours", () => {
        const drive = {};
        let p = 0.9;
        let most = 0;
        for (let i = 0; i < 10 * HOUR * 20; i += 1) {
            p += (i % 600 < 60) ? 0.0006 : 0;
            if (p > 0.95) p = 0.9;
            advanceWarpDrive(drive, 0.05, p, 1);
            expect(drive.phase).toBeGreaterThanOrEqual(0);
            most = Math.max(most, drive.phase);
        }
        expect(most).toBeLessThan(CH7_WARP_DRIVE.wrap);
    });

    it("wraps the traced disk's turns where nothing it draws changes", () => {
        const { flowPeriod, rigidRate, turnsWrap } = GREAT_HOLE_DISK_MOTION;
        const rigid = turnsWrap * rigidRate;
        const flows = turnsWrap / flowPeriod;
        expect(Math.abs(rigid - Math.round(rigid))).toBeLessThan(1e-9);
        expect(Math.abs(flows - Math.round(flows))).toBeLessThan(1e-9);
    });

    it("keeps the hole's life and the fold's clock within bounds ten hours in", () => {
        [0, 1234.5, HOUR + 17, 10 * HOUR + 3].forEach((t) => {
            const life = greatHoleLifeAt(t);
            life.knots.forEach((k) => {
                expect(k[1]).toBeGreaterThanOrEqual(0);
                expect(k[1]).toBeLessThan(1);
                expect(Number.isFinite(k[2])).toBe(true);
            });
            const clock = resolveFoldClock(t);
            clock.mood.forEach((m) => {
                expect(m).toBeGreaterThanOrEqual(0);
                expect(m).toBeLessThanOrEqual(1);
            });
            expect(clock.event).toBeGreaterThanOrEqual(0);
            expect(clock.event).toBeLessThanOrEqual(1);
            expect(clock.turns).toBeGreaterThanOrEqual(0);
            expect(clock.turns).toBeLessThan(4);
            expect(clock.eventAge).toBeLessThanOrEqual(15);
        });
    });
});
