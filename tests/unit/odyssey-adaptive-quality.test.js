/**
 * @fileoverview Unit tests for OdysseyAdaptiveQuality — the Odyssey resolution/quality controller.
 *
 * This pure ring-buffer + policy controller drives Tier-0 renderScale and the bloom/post degrade
 * ladder, and was the root of both the "low-res" report (the board reads soft when it downscales)
 * and the session-review adaptive-freeze deadlock — yet it had NO isolation tests. These lock in:
 * the disabled/warm-up gates, frame recording hygiene, the injected-policy resolution step, the
 * ceiling clamp, the escalate/recover ladder with its cooldowns, and resetFrameWindow.
 *
 * Constants mirrored from the source: window 60, MIN_SAMPLES 30, target 60fps → budget 16.67ms,
 * downThreshold ≈19ms, upThreshold ≈15ms; escalate cooldown 6s, recover cooldown 12s;
 * bloom 0.5→0.25, resolution floor 0.5.
 */

import {
    describe, it, expect, vi,
} from 'vitest';
import { OdysseyAdaptiveQuality } from '../../src/rendering/odyssey/composition/OdysseyAdaptiveQuality.js';

const SLOW = 30; // ms/frame → p95 30 > downThreshold ~19 → under pressure
const FAST = 10; // ms/frame → p95 10 < upThreshold ~15 → headroom

function makeCtx() {
    return {
        applyRenderScale: vi.fn(),
        pipeline: {
            setBloomScale: vi.fn(),
            setBloomEnabled: vi.fn(),
            setPostQuality: vi.fn(),
        },
    };
}

/** Fill the rolling window with n frames of the given ms. */
function fill(ctrl, ms, n = 30) {
    for (let i = 0; i < n; i += 1) ctrl.recordFrame(ms);
}

/** A resolution policy that pins renderScale (changed:false) — isolates the bloom/post ladder. */
const pinnedPolicy = (scale) => () => ({ changed: false, nextRenderScale: scale });

describe('OdysseyAdaptiveQuality', () => {
    it('a disabled controller records + applies nothing', () => {
        const ctrl = new OdysseyAdaptiveQuality({ enabled: false });
        const ctx = makeCtx();
        fill(ctrl, SLOW, 60);
        ctrl.update(100000, ctx);
        expect(ctx.applyRenderScale).not.toHaveBeenCalled();
        expect(ctrl.getRenderScale()).toBe(1);
    });

    it('recordFrame ignores non-finite and non-positive deltas', () => {
        const ctrl = new OdysseyAdaptiveQuality();
        ctrl.recordFrame(NaN);
        ctrl.recordFrame(0);
        ctrl.recordFrame(-5);
        ctrl.recordFrame(Infinity);
        // window is still empty → update can't act even past the throttle
        const ctx = makeCtx();
        ctrl.update(5000, ctx);
        expect(ctx.applyRenderScale).not.toHaveBeenCalled();
    });

    it('update self-throttles to evalIntervalMs and needs MIN_SAMPLES frames', () => {
        const policy = vi.fn(() => ({ changed: false, nextRenderScale: 1 }));
        const ctrl = new OdysseyAdaptiveQuality({ evaluateResolution: policy });
        fill(ctrl, SLOW, 29); // one short of MIN_SAMPLES (30)
        ctrl.update(1000, makeCtx());
        expect(policy).not.toHaveBeenCalled(); // not enough samples
        ctrl.recordFrame(SLOW); // now 30
        ctrl.update(1500, makeCtx()); // 1500-1000 < evalInterval 1000? no, 500 < 1000 → throttled
        expect(policy).not.toHaveBeenCalled();
        ctrl.update(2100, makeCtx()); // 2100-1000 >= 1000 → evaluates
        expect(policy).toHaveBeenCalledTimes(1);
    });

    it('applies a policy-driven resolution downscale via ctx.applyRenderScale', () => {
        const ctrl = new OdysseyAdaptiveQuality({
            baselineRenderScale: 1,
            renderScale: 1,
            evaluateResolution: () => ({ changed: true, nextRenderScale: 0.8 }),
        });
        const ctx = makeCtx();
        fill(ctrl, SLOW, 30);
        ctrl.update(1000, ctx);
        expect(ctx.applyRenderScale).toHaveBeenCalledWith(0.8);
        expect(ctrl.getRenderScale()).toBe(0.8);
    });

    it('never lets resolution exceed the baseline ceiling', () => {
        const ctrl = new OdysseyAdaptiveQuality({
            baselineRenderScale: 1,
            renderScale: 0.9,
            evaluateResolution: () => ({ changed: true, nextRenderScale: 1.5 }), // policy over-shoots
        });
        const ctx = makeCtx();
        fill(ctrl, FAST, 30);
        ctrl.update(1000, ctx);
        expect(ctrl.getRenderScale()).toBe(1); // clamped to baseline, not 1.5
        expect(ctx.applyRenderScale).toHaveBeenCalledWith(1);
    });

    it('will NOT upscale resolution while a bloom/post tier is still shed', () => {
        const ctrl = new OdysseyAdaptiveQuality({
            baselineRenderScale: 1,
            renderScale: 0.5,
            evaluateResolution: () => ({ changed: true, nextRenderScale: 0.6 }), // wants to climb
        });
        ctrl._pressureTier = 2; // a cheaper tier is still shed
        const ctx = makeCtx();
        fill(ctrl, FAST, 30);
        ctrl.update(1000, ctx);
        expect(ctrl.getRenderScale()).toBe(0.5); // held — pixels come back last
        expect(ctx.applyRenderScale).not.toHaveBeenCalled();
    });

    it('escalates the bloom/post ladder (0.25 → off → post-soften → post-off) under sustained floor pressure', () => {
        const ctrl = new OdysseyAdaptiveQuality({ renderScale: 0.5, evaluateResolution: pinnedPolicy(0.5) });
        const ctx = makeCtx();
        fill(ctrl, SLOW, 30); // sustained pressure at the resolution floor

        ctrl.update(1000, ctx); // seeds _floorPressureSince; no escalation yet (not held long enough)
        expect(ctrl._pressureTier).toBe(0);

        ctrl.update(7001, ctx); // held ≥6s → Tier 1: bloom working-res → 0.25
        expect(ctrl._pressureTier).toBe(1);
        expect(ctx.pipeline.setBloomScale).toHaveBeenLastCalledWith(0.25);

        ctrl.update(13002, ctx); // Tier 2: bloom disabled
        expect(ctrl._pressureTier).toBe(2);
        expect(ctx.pipeline.setBloomEnabled).toHaveBeenLastCalledWith(false);

        ctrl.update(19003, ctx); // Tier 3: post extras softened
        expect(ctrl._pressureTier).toBe(3);
        expect(ctx.pipeline.setPostQuality).toHaveBeenLastCalledWith(0.5);

        ctrl.update(25004, ctx); // Tier 4: post extras disabled
        expect(ctrl._pressureTier).toBe(4);
        expect(ctx.pipeline.setPostQuality).toHaveBeenLastCalledWith(0);

        ctrl.update(31005, ctx); // already at MAX → no further escalation
        expect(ctrl._pressureTier).toBe(4);
    });

    it('recovers a shed tier when headroom returns, after the recover cooldown', () => {
        const ctrl = new OdysseyAdaptiveQuality({ renderScale: 0.5, evaluateResolution: pinnedPolicy(0.5) });
        const ctx = makeCtx();
        ctrl._pressureTier = 2; // bloom disabled
        ctrl._appliedBloomEnabled = false;
        ctrl._appliedBloomScale = 0.25;
        fill(ctrl, FAST, 30); // headroom

        ctrl.update(1000, ctx); // first eval — establishes timing, recover cooldown not yet met
        ctrl.update(13001, ctx); // ≥12s later → recover ONE tier (2 → 1: bloom re-enabled)
        expect(ctrl._pressureTier).toBe(1);
        expect(ctx.pipeline.setBloomEnabled).toHaveBeenLastCalledWith(true);
    });

    it('resetFrameWindow discards the window so update no-ops until it refills', () => {
        const policy = vi.fn(() => ({ changed: false, nextRenderScale: 1 }));
        const ctrl = new OdysseyAdaptiveQuality({ evaluateResolution: policy });
        fill(ctrl, SLOW, 40);
        ctrl.resetFrameWindow(500);
        ctrl.update(2000, makeCtx()); // window empty → below MIN_SAMPLES → no eval
        expect(policy).not.toHaveBeenCalled();
        fill(ctrl, SLOW, 30);
        ctrl.update(3001, makeCtx()); // refilled → evaluates
        expect(policy).toHaveBeenCalledTimes(1);
    });

    it('setBaselineRenderScale lowers the ceiling and clamps the live scale under it', () => {
        const ctrl = new OdysseyAdaptiveQuality({ baselineRenderScale: 1.25, renderScale: 1.2 });
        ctrl.setBaselineRenderScale(0.9);
        expect(ctrl.baselineRenderScale).toBe(0.9);
        expect(ctrl.getRenderScale()).toBe(0.9); // was 1.2 > new ceiling → clamped down
    });
});
