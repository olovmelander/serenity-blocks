/**
 * Theme render-rate cap (investigation §5b / fix #4).
 *
 * Themes drive their own rAF loop, so on a 240Hz panel each one rendered a full
 * 3D scene 240 times a second for a 60Hz simulation — 4x the necessary GPU work,
 * and the reason there was no headroom to absorb a pipeline-compile stall.
 *
 * The cap has one hard requirement beyond "render less often": it must never
 * drop the effective rate BELOW the target. A plain `elapsed >= 1000/target`
 * gate violates that at any cadence that does not divide evenly into the target.
 * These tests pin the behaviour at every cadence that matters.
 */
import { describe, it, expect } from 'vitest';
import {
    createFramePacer,
    resetFramePacer,
    shouldRenderAtTargetFps,
    resolveTargetFps,
} from '../../src/themes/theme-frame-pacer.js';

/**
 * Drive the pacer at a fixed cadence and report the effective render rate.
 * @param {number} cadenceHz how often rAF fires
 * @param {number} targetFps the cap under test
 * @param {number} seconds how long to simulate
 */
function simulate(cadenceHz, targetFps, seconds = 2) {
    const state = createFramePacer();
    const step = 1000 / cadenceHz;
    const frames = Math.round(cadenceHz * seconds);
    let rendered = 0;
    const gaps = [];
    let lastRenderAt = null;

    for (let i = 0; i < frames; i++) {
        const now = i * step;
        if (shouldRenderAtTargetFps(state, now, targetFps)) {
            rendered++;
            if (lastRenderAt !== null) gaps.push(now - lastRenderAt);
            lastRenderAt = now;
        }
    }
    const round = (g) => Math.round(g * 100) / 100;
    const uniqueGaps = [...new Set(gaps.map(round))];
    // Steady state = everything after the cadence estimate has settled.
    const steadyGaps = [...new Set(gaps.slice(2).map(round))];
    const warmupGaps = gaps.slice(0, 2).map(round).filter((g) => !steadyGaps.includes(g)).length;
    // Steady-state rate from the gaps between renders — avoids the off-by-one
    // that counting renders per second introduces (the first frame always renders).
    const sorted = [...gaps].sort((a, b) => a - b);
    const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const renderedFps = medianGap > 0 ? 1000 / medianGap : cadenceHz;
    return {
        renderedFps, rendered, frames, uniqueGaps, steadyGaps, warmupGaps,
    };
}

describe('theme render cap — effective rate at each display cadence', () => {
    it('caps a 240Hz cadence to a 60fps target, saving 75% of the draws', () => {
        const r = simulate(240, 60);
        expect(r.renderedFps).toBeCloseTo(60, 0);
        expect(r.rendered / r.frames).toBeCloseTo(0.25, 2);
    });

    it('caps a 240Hz cadence to a 30fps target', () => {
        expect(simulate(240, 30).renderedFps).toBeCloseTo(30, 0);
    });

    it('never renders below the target when the cadence divides unevenly', () => {
        // 144/60 = 2.4 and 165/60 = 2.75 — a naive gate yields 72 and 55.
        for (const cadence of [144, 165, 120, 100, 90, 75]) {
            const r = simulate(cadence, 60);
            expect(
                r.renderedFps,
                `cadence ${cadence}Hz produced ${r.renderedFps}fps against a 60fps target`,
            ).toBeGreaterThanOrEqual(59.5);
        }
    });

    it('declines to cap when the cadence is already at or below the target', () => {
        // GPU-bound: rAF is only arriving at 90Hz. Gating to every 2nd frame
        // would yield 45fps — worse than doing nothing.
        const r = simulate(90, 60);
        expect(r.renderedFps).toBeCloseTo(90, 0);
        expect(r.rendered).toBe(r.frames);
    });

    it('is a no-op at 60Hz with a 60fps target', () => {
        const r = simulate(60, 60);
        expect(r.rendered).toBe(r.frames);
    });

    it('paces evenly once the cadence is known — no alternating long/short gaps', () => {
        // Judder shows up as more than one distinct steady-state gap length.
        // The first gap is excluded: the cadence cannot be known until two calls
        // have been observed, so exactly one frame at loop start is unpaced.
        expect(simulate(240, 60).steadyGaps.length).toBe(1);
        expect(simulate(240, 120).steadyGaps.length).toBe(1);
        expect(simulate(144, 60).steadyGaps.length).toBe(1);
    });

    it('costs exactly one unpaced frame while it learns the cadence', () => {
        const r = simulate(240, 60);
        expect(r.uniqueGaps.length).toBe(2); // warm-up gap + steady gap
        expect(r.warmupGaps).toBe(1);
    });

    it('never gates when the target is unlimited', () => {
        const r = simulate(240, 0);
        expect(r.rendered).toBe(r.frames);
    });
});

describe('theme render cap — robustness', () => {
    it('returns the same answer for repeat calls within one frame', () => {
        const state = createFramePacer();
        shouldRenderAtTargetFps(state, 0, 60); // first frame renders
        // A theme that consults the gate twice in one frame must not skip its
        // own render on the second call.
        const a = shouldRenderAtTargetFps(state, 100.0, 60);
        const b = shouldRenderAtTargetFps(state, 100.2, 60);
        const c = shouldRenderAtTargetFps(state, 100.4, 60);
        expect(a).toBe(true);
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    it('renders the very first frame it is asked about', () => {
        const state = createFramePacer();
        expect(shouldRenderAtTargetFps(state, 12345, 60)).toBe(true);
    });

    it('ignores clock jumps when estimating cadence', () => {
        const state = createFramePacer();
        shouldRenderAtTargetFps(state, 0, 60);
        shouldRenderAtTargetFps(state, 4.17, 60);
        const before = state.intervalEma;
        shouldRenderAtTargetFps(state, 4.17 + 5000, 60); // tab restore
        expect(state.intervalEma).toBe(before);
    });

    it('resets cleanly for a loop restarting after a gap', () => {
        const state = createFramePacer();
        shouldRenderAtTargetFps(state, 0, 60);
        shouldRenderAtTargetFps(state, 8, 60);
        resetFramePacer(state);
        expect(state.started).toBe(false);
        expect(state.intervalEma).toBe(0);
        expect(shouldRenderAtTargetFps(state, 99999, 60)).toBe(true);
    });

    it('tolerates a missing state object', () => {
        expect(shouldRenderAtTargetFps(null, 0, 60)).toBe(true);
    });
});

describe('target frame rate resolution', () => {
    const win = (targetFrameRate) => ({
        serenityBlocks: { settingsManager: { get: () => ({ targetFrameRate }) } },
    });

    it('reads the players setting', () => {
        expect(resolveTargetFps(win(60))).toBe(60);
        expect(resolveTargetFps(win(144))).toBe(144);
    });

    it('treats 0 as unlimited', () => {
        expect(resolveTargetFps(win(0))).toBe(0);
    });

    it('is unlimited when settings are unavailable', () => {
        expect(resolveTargetFps(null)).toBe(0);
        expect(resolveTargetFps({})).toBe(0);
        expect(resolveTargetFps(win(undefined))).toBe(0);
    });

    it('floors a corrupt setting so it cannot stall every theme', () => {
        expect(resolveTargetFps(win(3))).toBe(30);
    });
});
