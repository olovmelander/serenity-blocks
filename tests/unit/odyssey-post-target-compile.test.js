/**
 * @fileoverview Unit tests for the Odyssey warm-up post-target compile helpers (E2 extraction).
 *
 * r185 CONTRACT (reworked 2026-08-20 — see the module's file header for the full mechanism):
 * r181 built all nodes in compileAsync's synchronous prologue, so bind → launch → restore-in-
 * finally was safe and these tests used to pin exactly that. r185 defers every object's node
 * build into a main-thread-yielding loop that reads the LIVE renderer target/MRT, so the binding
 * must now be HELD ACROSS THE ENTIRE AWAIT, shared by concurrent pooled compiles (refcounted
 * session), and restored only when the last one resolves. Under a live render loop with post
 * active there is NO safe compileAsync at all — the compile is skipped (resolves false) and
 * warming belongs to the synchronous private-target render-warm.
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

/** A mock renderer whose compileAsync stays pending until the test resolves it. */
function makeDeferredRenderer() {
    const renderer = makeRenderer();
    const pending = [];
    renderer.compileAsync = vi.fn(() => new Promise((resolve) => { pending.push(resolve); }));
    renderer._resolveCompile = (i = 0) => { pending[i](); };
    renderer._pendingCount = () => pending.length;
    return renderer;
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

/** Let queued microtasks run so awaited promise chains settle. */
const flushMicrotasks = () => new Promise((resolve) => { setTimeout(resolve, 0); });

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
});

describe('the r185 hold-across-await contract', () => {
    it('holds the post binding for the ENTIRE compile and restores only after it resolves', async () => {
        // r185 builds nodes AFTER compileAsync's synchronous section, reading the live
        // renderer target/MRT — restoring before resolution poisons the builder cache
        // (the r181-era restore-in-finally recipe this module used to pin).
        const renderer = makeDeferredRenderer();
        const promise = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'GROUP');
        expect(renderer.compileAsync).toHaveBeenCalledWith('SCENE', 'CAM', 'GROUP');
        // Still bound while the compile is in flight — the load-bearing r185 assertion.
        expect(renderer._current()).toEqual({ target: 'SCENE_RT', mrt: 'SCENE_MRT' });
        renderer._resolveCompile(0);
        await expect(promise).resolves.toBe(true);
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null });
    });

    it('concurrent compiles share ONE refcounted binding; the last release restores the ORIGINAL state', async () => {
        // The startup pool launches chapter compiles concurrently. Naive per-call
        // save/restore would capture each other's bound state and could leave the
        // scene-pass target bound after the pool drains.
        const renderer = makeDeferredRenderer();
        const first = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'G1');
        const second = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'G2');
        expect(renderer._pendingCount()).toBe(2);
        // One bind for the whole pool.
        expect(renderer.setRenderTarget).toHaveBeenCalledTimes(1);

        renderer._resolveCompile(0);
        await first;
        // Second compile still in flight — binding must survive the first release.
        expect(renderer._current()).toEqual({ target: 'SCENE_RT', mrt: 'SCENE_MRT' });

        renderer._resolveCompile(1);
        await second;
        // Restored to the TRUE original state (not an intermediate save).
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null });
        expect(renderer.setRenderTarget).toHaveBeenCalledTimes(2); // bind + final restore
    });

    it('restores even when the compile rejects', async () => {
        const renderer = makeRenderer();
        renderer.compileAsync = vi.fn(() => Promise.reject(new Error('device lost')));
        await expect(
            compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'GROUP'),
        ).rejects.toThrow('device lost');
        await flushMicrotasks();
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null });
    });

    it('normalizes a target Group\'s undefined background to null before compiling', async () => {
        // r185 upstream bug: compileAsync routes Background.update at the target
        // GROUP, whose `background` is undefined; Background guards `=== null`,
        // so `background.isColor` TypeErrors and the prewarm catch silently
        // voids every chapter warm (caught by the 2026-08-20 capture matrix —
        // "Shader prewarm failed ... reading 'isColor'"). The module mirrors
        // Scene's `background = null` default onto object groups.
        const renderer = makeRenderer();
        const group = { name: 'chapter-group' };
        let backgroundAtCompile;
        renderer.compileAsync = vi.fn(() => {
            backgroundAtCompile = group.background;
            return Promise.resolve();
        });
        await compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group);
        expect(backgroundAtCompile).toBeNull();
        // An explicitly-set background must never be clobbered.
        const themed = { background: 'SKY' };
        await compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', themed);
        expect(themed.background).toBe('SKY');
    });

    it('compiles bare (no binding) and still resolves true when post is inactive', async () => {
        const renderer = makeRenderer();
        await expect(
            compileGroupThroughPost(renderer, null, 'SCENE', 'CAM', 'GROUP'),
        ).resolves.toBe(true);
        expect(renderer.compileAsync).toHaveBeenCalledWith('SCENE', 'CAM', 'GROUP');
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null }); // untouched
    });
});

describe('the render-loop guard (2026-08-12 device-loss fix, hardened for r185)', () => {
    // Binding the shared scene-pass target while the rAF loop renders aliases its `output`
    // texture as both sampled binding and render attachment — device-poisoning, still true on
    // r185. NEW on r185: even an UNBOUND background compileAsync is unsafe with post active,
    // because the deferred builds read the live loop's drifting target/MRT and poison the
    // MRT-agnostic builder cache. So a live-loop compile with post active is SKIPPED entirely
    // (resolves false); live-loop warming belongs to the private-target render-warm.
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

    it('SKIPS the compile entirely (resolves false) when the loop is active and post is active', async () => {
        const renderer = makeRenderer();
        await expect(
            compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', 'GROUP', true),
        ).resolves.toBe(false);
        expect(renderer.compileAsync).not.toHaveBeenCalled();
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
        expect(renderer._current()).toEqual({ target: 'CANVAS', mrt: null });
    });

    it('still compiles bare on a live loop when post is INACTIVE (no MRT to poison)', async () => {
        const renderer = makeRenderer();
        await expect(
            compileGroupThroughPost(renderer, null, 'SCENE', 'CAM', 'GROUP', true),
        ).resolves.toBe(true);
        expect(renderer.compileAsync).toHaveBeenCalledWith('SCENE', 'CAM', 'GROUP');
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
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
