/**
 * Chapter 7's warp drive (overhaul 2026-10-20): the tunnel's travel follows the eye's measured speed
 * along the path, integrated on the CPU. Pins the feel (cruise parked, a punch on every glide, a
 * slower coast) and the safety rails (no phase jumps, teleports ignored, reduced motion capped).
 */
import { describe, expect, it } from 'vitest';
import {
    advanceWarpDrive,
    CH7_WARP_DRIVE,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';

const DT = 1 / 120;

function run(state, seconds, speed, warp = 1, opts = {}) {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i += 1) {
        const p = (Number.isFinite(state.lastProgress) ? state.lastProgress : 0.9) + speed * DT;
        advanceWarpDrive(state, DT, p, warp, opts);
    }
    return state;
}

describe('chapter 7 warp drive', () => {
    it('cruises while parked at an orb', () => {
        const state = run({}, 2, 0);
        expect(state.throttle).toBeCloseTo(CH7_WARP_DRIVE.cruise, 3);
    });

    it('punches up within a few frames of a glide starting, and coasts down slower', () => {
        const state = run({}, 1, 0);
        run(state, 0.25, CH7_WARP_DRIVE.refSpeed);
        // Most of the way to full within a quarter second of travel.
        expect(state.throttle).toBeGreaterThan(0.85);
        const atLanding = state.throttle;
        run(state, 0.25, 0);
        // The coast keeps much of it a quarter second after landing (release > rise).
        expect(state.throttle).toBeGreaterThan(CH7_WARP_DRIVE.cruise + (atLanding - CH7_WARP_DRIVE.cruise) * 0.6);
        run(state, 5, 0);
        expect(state.throttle).toBeCloseTo(CH7_WARP_DRIVE.cruise, 2);
    });

    it('scales with the fall: no drive before the warp opens', () => {
        const state = run({}, 1, CH7_WARP_DRIVE.refSpeed, 0);
        expect(state.throttle).toBe(0);
    });

    it('ignores a teleport (a map jump) instead of reading it as warp speed', () => {
        const state = run({}, 1, 0);
        advanceWarpDrive(state, DT, state.lastProgress + 0.05, 1);
        expect(state.throttle).toBeCloseTo(CH7_WARP_DRIVE.cruise, 2);
    });

    it('caps the drive under reduced motion', () => {
        const state = run({}, 1, CH7_WARP_DRIVE.refSpeed * 1.5, 1, { reducedMotion: true });
        expect(state.throttle).toBeLessThanOrEqual(CH7_WARP_DRIVE.cruise * 0.6 + 1e-9);
    });

    it('advances the phase every frame, never by more than the top rate allows, and wraps whole', () => {
        const state = {};
        let prev = 0;
        const top = CH7_WARP_DRIVE.base + CH7_WARP_DRIVE.gain * 1.6 * 1.6;
        for (let i = 0; i < 1200; i += 1) {
            const speed = i % 240 < 120 ? CH7_WARP_DRIVE.refSpeed * 1.6 : 0;
            advanceWarpDrive(state, DT, (state.lastProgress ?? 0.9) + speed * DT, 1);
            const step = state.phase - prev;
            expect(step).toBeGreaterThan(0);
            expect(step).toBeLessThanOrEqual(top * DT + 1e-9);
            prev = state.phase;
        }
        // Every rate in the window shader is a multiple of 1/64 (or 1/16), so the wrap is whole.
        [1.625, 0.75, 0.0625, 0.875].forEach((rate) => {
            expect(Number.isInteger(CH7_WARP_DRIVE.wrap * rate)).toBe(true);
        });
    });

    it('holds an override throttle for captures', () => {
        const state = run({}, 0.5, 0, 1, { override: 1.3 });
        expect(state.throttle).toBeCloseTo(1.3, 6);
    });
});
