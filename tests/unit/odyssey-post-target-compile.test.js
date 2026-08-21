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
import { readFileSync } from 'fs';
import path from 'path';
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
        expect(renderer.compileAsync).toHaveBeenCalledWith('GROUP', 'CAM', 'SCENE');
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

    it('passes the GROUP as the object to compile and the SCENE as targetScene (three\'s contract)', async () => {
        // three: `compileAsync(objectToCompile, camera, targetScene)` — the first argument
        // is projected into the render list, the third supplies lights/background/cache
        // key. Inverted (`scene, camera, group`) every "targeted" prewarm walked the whole
        // scene and read `background` off a Group (undefined → `background.isColor`
        // TypeError, first misfiled as an r185 bug). A Group must NOT be mutated to make
        // the wrong order work.
        const renderer = makeRenderer();
        const group = { name: 'chapter-group' };
        await compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group);
        expect(renderer.compileAsync).toHaveBeenCalledWith(group, 'CAM', 'SCENE');
        expect('background' in group).toBe(false);
    });

    it('pins three\'s compileAsync parameter order from the installed source', () => {
        const src = readFileSync(
            path.join(process.cwd(), 'node_modules/three/src/renderers/common/Renderer.js'),
            'utf8',
        );
        // Signature + the JSDoc that defines the third parameter as the target SCENE.
        expect(src).toMatch(/async compileAsync\(\s*scene,\s*camera,\s*targetScene\s*=\s*null\s*\)/);
        expect(src).toMatch(/@param \{\?Scene\} targetScene - If the first argument is a 3D object/);
        // The first argument is what gets projected; lights come from targetScene.
        expect(src).toMatch(/this\._projectObject\(\s*scene,\s*camera,\s*0,\s*renderList/);
        expect(src).toMatch(/targetScene\.traverseVisible\(/);
    });

    it('compiles bare (no binding) and still resolves true when post is inactive', async () => {
        const renderer = makeRenderer();
        await expect(
            compileGroupThroughPost(renderer, null, 'SCENE', 'CAM', 'GROUP'),
        ).resolves.toBe(true);
        expect(renderer.compileAsync).toHaveBeenCalledWith('GROUP', 'CAM', 'SCENE');
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
        expect(renderer.compileAsync).toHaveBeenCalledWith('GROUP', 'CAM', 'SCENE');
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

describe('the fan-out (r185 awaits each object\'s pipeline before the next — one call = serial compiles)', () => {
    const renderable = (name, material) => ({
        name, isMesh: true, material, visible: true,
    });
    const makeGroup = (children) => ({
        name: 'group',
        traverse(fn) { fn(this); children.forEach((c) => fn(c)); },
    });
    const pendingRenderer = () => {
        const renderer = makeRenderer();
        const pending = [];
        renderer.compileAsync = vi.fn((object) => new Promise((resolve) => { pending.push({ object, resolve }); }));
        return { renderer, pending };
    };

    it('compiles renderables through concurrent targeted calls, never the group as a whole', async () => {
        const { renderer, pending } = pendingRenderer();
        const m1 = { uuid: 'm1' };
        const m2 = { uuid: 'm2' };
        const m3 = { uuid: 'm3' };
        const group = makeGroup([
            renderable('a', m1), renderable('b', m2), renderable('c', m3),
            { name: 'light', isLight: true }, // not a renderable → skipped
            {
                name: 'hidden', isMesh: true, material: { uuid: 'm4' }, visible: false,
            },
        ]);
        const opts = { concurrency: 2 };
        const done = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group, false, opts);
        await Promise.resolve();
        // Width 2: exactly two calls in flight, each a targeted (object, camera, SCENE) call.
        expect(pending.map((p) => p.object.name)).toEqual(['a', 'b']);
        expect(renderer.compileAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'a' }), 'CAM', 'SCENE');
        expect(renderer.compileAsync).not.toHaveBeenCalledWith(group, 'CAM', 'SCENE');
        pending.shift().resolve();
        await Promise.resolve(); await Promise.resolve();
        expect(pending.map((p) => p.object.name)).toEqual(['b', 'c']);
        pending.forEach((p) => p.resolve());
        await Promise.resolve(); await Promise.resolve();
        await done;
        expect(renderer.compileAsync).toHaveBeenCalledTimes(3);
        const names = renderer.compileAsync.mock.calls.map(([o]) => o.name);
        expect(names).not.toContain('light');
        expect(names).not.toContain('hidden');
    });

    it('one representative per material INSTANCE + layout; instanced objects are each their own bucket', async () => {
        // three keys the builder state on the material instance's properties + the vertex layout
        // + receiveShadow — and on the OBJECT uuid for InstancedMesh / count > 1 / BatchedMesh
        // (RenderObject.getMaterialCacheKey, r185:833). The bucket rule mirrors that exactly.
        const { renderer, pending } = pendingRenderer();
        const shared = { uuid: 'shared' };
        const otherInstance = { uuid: 'shared-2' }; // same program in practice, but a different instance
        const group = makeGroup([
            renderable('s1', shared), renderable('s2', shared), renderable('s3', shared), // one bucket
            renderable('o1', otherInstance), // its own bucket (instance identity, not program)
            { ...renderable('i1', shared), isInstancedMesh: true, uuid: 'i1' }, // per-object
            { ...renderable('i2', shared), isInstancedMesh: true, uuid: 'i2' }, // per-object
            { ...renderable('rs', shared), receiveShadow: true }, // receiveShadow specialises
        ]);
        const opts = { concurrency: 8 };
        const done = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group, false, opts);
        await Promise.resolve();
        expect(pending.map((p) => p.object.name)).toEqual(['s1', 'o1', 'i1', 'i2', 'rs']);
        pending.forEach((p) => p.resolve());
        await done;
        expect(renderer.compileAsync).toHaveBeenCalledTimes(5);
        const names = renderer.compileAsync.mock.calls.map(([o]) => o.name);
        expect(names).not.toContain('s2');
        expect(names).not.toContain('s3');
    });

    it('a different vertex layout under one material instance is its own bucket (pipeline key differs)', async () => {
        const { renderer, pending } = pendingRenderer();
        const prog = { uuid: 'p' };
        const geoA = { attributes: { position: { itemSize: 3 }, uv: { itemSize: 2 } }, index: null };
        const geoB = { attributes: { position: { itemSize: 3 } }, index: null };
        const group = makeGroup([
            { ...renderable('a', prog), geometry: geoA },
            { ...renderable('b', prog), geometry: geoB },
            { ...renderable('c', prog), geometry: geoA },
        ]);
        const done = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group);
        await Promise.resolve();
        expect(pending.map((p) => p.object.name)).toEqual(['a', 'b']);
        pending.forEach((p) => p.resolve());
        await done;
        expect(renderer.compileAsync).toHaveBeenCalledTimes(2);
    });

    it('holds the post binding across the WHOLE fan-out and restores only after the last call', async () => {
        const { renderer, pending } = pendingRenderer();
        const group = makeGroup([renderable('a', { uuid: 'a' }), renderable('b', { uuid: 'b' })]);
        const done = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group);
        await Promise.resolve();
        expect(renderer.getRenderTarget()).toBe('SCENE_RT');
        pending.shift().resolve();
        await Promise.resolve(); await Promise.resolve();
        expect(renderer.getRenderTarget()).toBe('SCENE_RT');
        pending.shift().resolve();
        await done;
        expect(renderer.getRenderTarget()).toBe('CANVAS');
    });
});
