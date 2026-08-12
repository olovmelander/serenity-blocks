/**
 * @fileoverview Unit tests for the Odyssey warm-up post-target compile helpers (E2 extraction).
 *
 * These were previously private methods buried in the 2,800-line OdysseyBoardController and could
 * only be exercised through a live WebGPU board. Extracted to warmup/post-target-compile.js, the
 * bind → compile → restore recipe is now testable in isolation with a mock renderer.
 */

import {
    describe, it, expect, vi,
} from 'vitest';
import {
    beginPostTargetCompile,
    endPostTargetCompile,
    compileGroupThroughPost,
} from '../../src/rendering/odyssey/warmup/post-target-compile.js';

/** A mock renderer that records the target/MRT it currently has bound. */
function makeRenderer() {
    let target = 'CANVAS';
    let mrt = null;
    return {
        getRenderTarget: () => target,
        setRenderTarget: vi.fn((t) => { target = t; }),
        getMRT: () => mrt,
        setMRT: vi.fn((m) => { mrt = m; }),
        compileAsync: vi.fn(() => Promise.resolve()),
        _current: () => ({ target, mrt }),
    };
}

/** A mock post stack whose scene pass exposes a render target + MRT. */
function makePostStack() {
    return {
        scenePass: {
            renderTarget: 'SCENE_RT',
            getMRT: () => 'SCENE_MRT',
        },
    };
}

describe('post-target-compile (E2 warm-up helper)', () => {
    it('binds the scene-pass target + MRT and returns the previous state when post is active', () => {
        const renderer = makeRenderer();
        const saved = beginPostTargetCompile(renderer, makePostStack());
        expect(saved).toEqual({ previousTarget: 'CANVAS', previousMRT: null });
        expect(renderer._current()).toEqual({ target: 'SCENE_RT', mrt: 'SCENE_MRT' });
    });

    it('is a no-op returning null when post is inactive (no scene pass)', () => {
        const renderer = makeRenderer();
        expect(beginPostTargetCompile(renderer, null)).toBeNull();
        expect(beginPostTargetCompile(renderer, { scenePass: null })).toBeNull();
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
        expect(renderer.setMRT).not.toHaveBeenCalled();
    });

    it('is a no-op when the renderer lacks MRT support', () => {
        const renderer = { getRenderTarget: () => 'X', setRenderTarget: vi.fn() };
        expect(beginPostTargetCompile(renderer, makePostStack())).toBeNull();
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
    });

    it('restores the saved target + MRT, and is a no-op on null', () => {
        const renderer = makeRenderer();
        const saved = beginPostTargetCompile(renderer, makePostStack());
        endPostTargetCompile(renderer, saved);
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null });

        renderer.setRenderTarget.mockClear();
        endPostTargetCompile(renderer, null);
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
    });

    it('compileGroupThroughPost compiles with the post target bound, then restores', async () => {
        const renderer = makeRenderer();
        let targetDuringCompile = null;
        renderer.compileAsync = vi.fn(() => {
            targetDuringCompile = renderer._current().target; // captured while bound
            return Promise.resolve();
        });
        const promise = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'GROUP');
        // The bind is restored synchronously in finally, before the awaited promise resolves.
        expect(renderer._current().target).toBe('CANVAS');
        expect(renderer.compileAsync).toHaveBeenCalledWith('SCENE', 'CAM', 'GROUP');
        expect(targetDuringCompile).toBe('SCENE_RT'); // was bound during the compileAsync call
        await promise;
    });

    it('compileGroupThroughPost still resolves + restores when post is inactive (direct compile)', async () => {
        const renderer = makeRenderer();
        await compileGroupThroughPost(renderer, null, 'SCENE', 'CAM', 'GROUP');
        expect(renderer.compileAsync).toHaveBeenCalledWith('SCENE', 'CAM', 'GROUP');
        expect(renderer._current().target).toBe('CANVAS'); // untouched (no post to bind)
    });
});

describe('the render-loop guard (2026-08-12 device-loss fix)', () => {
    // compileAsync opens a render pass on whatever target is bound. Doing that while the rAF loop
    // is rendering the post graph puts the scene-pass "output" texture in one command encoder as
    // BOTH a sampled binding and a render attachment, which WebGPU rejects; pipeline creation then
    // returns undefined and the next draw throws inside setPipeline, permanently poisoning the
    // device. The symptom is thousands of identical errors per second, so the cheap guard below is
    // worth pinning: it is invisible in every renderer-free test unless asserted directly.
    it('does NOT bind the post target while the render loop is active', () => {
        const renderer = makeRenderer();
        expect(beginPostTargetCompile(renderer, makePostStack(), true)).toBeNull();
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
        expect(renderer.setMRT).not.toHaveBeenCalled();
    });

    it('still binds it when the loop is idle — the startup path keeps the optimisation', () => {
        const renderer = makeRenderer();
        expect(beginPostTargetCompile(renderer, makePostStack(), false)).not.toBeNull();
        expect(renderer._current()).toEqual({ target: 'SCENE_RT', mrt: 'SCENE_MRT' });
    });

    it('compileGroupThroughPost still compiles when the loop is active, just unbound', async () => {
        // The chapter must STILL be compiled — skipping the compile entirely would reintroduce a
        // first-visit freeze. Only the target binding is dropped.
        const renderer = makeRenderer();
        await compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'GROUP', true);
        expect(renderer.compileAsync).toHaveBeenCalledWith('SCENE', 'CAM', 'GROUP');
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null });
    });

    it('defaults to the SAFE behaviour when the flag is omitted', () => {
        // A caller that forgets the argument must not silently reintroduce the crash on a live
        // loop... but the default also must not disable the startup optimisation. The default is
        // "loop idle" because every in-repo caller passes the real state; this test exists so that
        // choice is deliberate and visible rather than accidental.
        const renderer = makeRenderer();
        expect(beginPostTargetCompile(renderer, makePostStack())).not.toBeNull();
    });
});
