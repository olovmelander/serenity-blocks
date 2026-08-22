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
    beginDeferredSideCapture,
    beginNestedContextDepth,
    beginLiveCompileReads,
    launchCompileInScenePassPrologue,
    compileGroupUnderLiveLoop,
    POST_SCENE_PASS_CALL_DEPTH,
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
        // restoreContexts is null on this double (no _renderContexts) — the depth patch is tested below.
        expect(saved).toEqual({ previousTarget: 'CANVAS', previousMRT: null, restoreContexts: null });
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

    it('buckets of ONE two-pass material (transparent DoubleSide) run in sequence; everything else stays parallel', async () => {
        // The deferred-side capture re-applies material.side per drained item and the node build
        // yields mid-way, so two concurrent drains of one two-pass material would race its side.
        // Opaque / single-pass materials never have their side mutated by three — they fan out.
        const { renderer, pending } = pendingRenderer();
        const twoPass = { uuid: 'tp', transparent: true, side: 2 };
        const singlePass = {
            uuid: 'sp', transparent: true, side: 2, forceSinglePass: true,
        };
        const opaque = { uuid: 'op', side: 2 };
        const geoA = { attributes: { position: { itemSize: 3 }, uv: { itemSize: 2 } }, index: null };
        const geoB = { attributes: { position: { itemSize: 3 } }, index: null };
        const group = makeGroup([
            { ...renderable('t1', twoPass), geometry: geoA },
            { ...renderable('t2', twoPass), geometry: geoB },
            {
                ...renderable('t3', twoPass), geometry: geoA, isInstancedMesh: true, uuid: 't3',
            },
            { ...renderable('s1', singlePass), geometry: geoA },
            { ...renderable('s2', singlePass), geometry: geoB },
            {
                ...renderable('o1', opaque), geometry: geoA, isInstancedMesh: true, uuid: 'o1',
            },
            {
                ...renderable('o2', opaque), geometry: geoA, isInstancedMesh: true, uuid: 'o2',
            },
        ]);
        const done = compileGroupThroughPost(renderer, makePostStack(), 'SCENE', 'CAM', group, false, { concurrency: 8 });
        await Promise.resolve();
        expect(pending.map((p) => p.object.name)).toEqual(['t1', 's1', 's2', 'o1', 'o2']);
        const order = [];
        while (pending.length) {
            const next = pending.shift();
            order.push(next.object.name);
            next.resolve();
            // eslint-disable-next-line no-await-in-loop
            await flushMicrotasks();
        }
        await done;
        expect(order).toEqual(['t1', 's1', 's2', 'o1', 'o2', 't2', 't3']);
        expect(renderer.compileAsync).toHaveBeenCalledTimes(7);
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

// r185's compileAsync defers pipeline creation into a work-item queue and drains it after the
// render-list walk restored material.side (Renderer.js _createObjectPipeline / compileAsync).
// This double reproduces exactly that: the two-pass push (BackSide item, FrontSide item, restore
// DoubleSide) and the sequential drain that reads item.material, builds, then requests the pipeline.
const FrontSide = 0; const BackSide = 1; const DoubleSide = 2;
function r185Double() {
    const built = []; // { passId, sideAtBuild, sideAtPipeline }
    const renderer = {
        _compilationPromises: null,
        _currentRenderContext: { id: 7 },
        _pipelines: {
            getForRender(renderObject, promises) {
                renderObject.sideAtPipeline = renderObject.material.side;
                if (Array.isArray(promises)) promises.push(Promise.resolve());
                built.push(renderObject);
                return { cacheKey: 'pipe' };
            },
        },
        // three's own: queue a bare item in async mode
        _createObjectPipeline(object, material, scene, camera, lightsNode, group, clippingContext, passId) {
            if (this._compilationPromises !== null) {
                this._compilationPromises.push({
                    object, material, scene, camera, lightsNode, group, clippingContext, passId, renderContext: this._currentRenderContext,
                });
                return;
            }
            built.push({ passId, sync: true, material });
        },
        // three's two-pass walk (renderObject / _renderTransparents) for ONE transparent DoubleSide object
        walk(object, material) {
            material.side = BackSide;
            this._createObjectPipeline(object, material, 'S', 'C', 'L', null, null, 'backSide');
            material.side = FrontSide;
            this._createObjectPipeline(object, material, 'S', 'C', 'L', null, null, null);
            material.side = DoubleSide;
        },
        // three's drain: read item.material, "build" (async, yields), request the pipeline
        async drain(items) {
            for (const item of items) {
                const renderObject = {
                    object: item.object, material: item.material, passId: item.passId, sideAtBuild: item.material.side,
                };
                // eslint-disable-next-line no-await-in-loop
                await Promise.resolve(); // getForRenderAsync yields
                const promises = [];
                this._pipelines.getForRender(renderObject, promises);
                // eslint-disable-next-line no-await-in-loop
                await Promise.all(promises);
            }
        },
        async compileAsync(object, material) {
            const previous = this._compilationPromises;
            const items = [];
            this._compilationPromises = items;
            this.walk(object, material);
            this._compilationPromises = previous;
            await this.drain(items);
        },
    };
    return { renderer, built };
}

describe('beginDeferredSideCapture (r185 deferred compile loses the two-pass material.side)', () => {
    it('WITHOUT the capture, both queued passes compile DoubleSide (the bug being worked around)', async () => {
        const { renderer, built } = r185Double();
        const material = { side: DoubleSide, transparent: true };
        await renderer.compileAsync({ name: 'card' }, material);
        expect(built.map((b) => [b.passId, b.sideAtBuild, b.sideAtPipeline])).toEqual([
            ['backSide', DoubleSide, DoubleSide], [null, DoubleSide, DoubleSide],
        ]);
    });

    it('re-applies the side each item was queued with, through build and pipeline request, then restores', async () => {
        const { renderer, built } = r185Double();
        const material = { side: DoubleSide, transparent: true };
        const release = beginDeferredSideCapture(renderer);
        await renderer.compileAsync({ name: 'card' }, material);
        expect(built.map((b) => [b.passId, b.sideAtBuild, b.sideAtPipeline])).toEqual([
            ['backSide', BackSide, BackSide], [null, FrontSide, FrontSide],
        ]);
        expect(material.side).toBe(DoubleSide); // restored after each drained item
        release();
        expect(renderer._createObjectPipeline.name).not.toBe('odysseyCreateObjectPipeline');
        // Sync (non-compile) path is untouched: three's original runs.
        renderer._createObjectPipeline({ name: 'x' }, material, 'S', 'C', 'L', null, null, null);
        expect(built.at(-1)).toMatchObject({ sync: true });
    });

    it('leaves LIVE getForRender calls (no promise array) alone and is refcounted across overlapping compiles', () => {
        const { renderer } = r185Double();
        const material = { side: DoubleSide, transparent: true };
        const releaseA = beginDeferredSideCapture(renderer);
        const releaseB = beginDeferredSideCapture(renderer);
        expect(releaseB).toBe(releaseA);
        // A live render mid-two-pass: side BackSide, no promises → must NOT be reset.
        material.side = BackSide;
        renderer._pipelines.getForRender({ material }, undefined);
        expect(material.side).toBe(BackSide);
        material.side = DoubleSide;
        releaseA();
        expect(renderer.__odysseySideCapture).toBeDefined(); // B still holds
        releaseB();
        expect(renderer.__odysseySideCapture).toBeUndefined();
    });

    it('restores a side left mid-flight when the session is released', () => {
        const { renderer } = r185Double();
        const material = { side: DoubleSide };
        const release = beginDeferredSideCapture(renderer);
        renderer._compilationPromises = [];
        material.side = BackSide;
        renderer._createObjectPipeline({ name: 'o' }, material, 'S', 'C', 'L', null, null, 'backSide');
        material.side = DoubleSide;
        const [item] = renderer._compilationPromises;
        expect(item.material).toBe(material); // getter applied the captured side…
        expect(material.side).toBe(BackSide); // …and the drain has not requested the pipeline yet
        release();
        expect(material.side).toBe(DoubleSide);
    });

    it('re-applies the captured side right before the pipeline key even if a live frame flipped it meanwhile (FIX-4)', () => {
        const { renderer, built } = r185Double();
        const material = { side: DoubleSide, transparent: true };
        const release = beginDeferredSideCapture(renderer);
        renderer._compilationPromises = [];
        material.side = BackSide;
        renderer._createObjectPipeline({ name: 'o' }, material, 'S', 'C', 'L', null, null, 'backSide');
        material.side = DoubleSide;
        const [item] = renderer._compilationPromises;
        expect(item.material.side).toBe(BackSide); // drain reads the item → BackSide applied
        material.side = DoubleSide; // …a live two-pass of a SHARED material restored it during a yield
        renderer._pipelines.getForRender({ material, passId: 'backSide' }, []);
        expect(built.at(-1).sideAtPipeline).toBe(BackSide); // key computed with the captured side
        expect(material.side).toBe(DoubleSide); // original restored
        release();
    });

    it('returns null for a renderer without the deferred path (WebGL / doubles)', () => {
        expect(beginDeferredSideCapture({})).toBeNull();
        expect(beginDeferredSideCapture(null)).toBeNull();
    });
});

describe("beginNestedContextDepth (compile at the scene pass's call depth)", () => {
    it('maps the default depth 0 to the post scene-pass depth and leaves explicit depths alone', () => {
        const calls = [];
        const renderer = {
            _renderContexts: {
                get(rt = null, mrt = null, depth = 0) { calls.push([rt, mrt, depth]); return { id: depth }; },
            },
        };
        const restore = beginNestedContextDepth(renderer);
        expect(renderer._renderContexts.get('RT', null)).toEqual({ id: POST_SCENE_PASS_CALL_DEPTH });
        expect(renderer._renderContexts.get('RT', null, 0)).toEqual({ id: POST_SCENE_PASS_CALL_DEPTH });
        expect(renderer._renderContexts.get('RT', null, -1)).toEqual({ id: -1 }); // clear contexts stay
        expect(renderer._renderContexts.get('RT', null, 2)).toEqual({ id: 2 });
        expect(beginNestedContextDepth(renderer)).toBeNull(); // already patched → join, no double wrap
        restore();
        expect(renderer._renderContexts.get('RT', null)).toEqual({ id: 0 });
        expect(calls.length).toBe(5);
    });

    it("pins three's contract: RenderContexts keys by attachment + mrt + callDepth; _callDepth starts at -1", () => {
        const contexts = readFileSync(path.resolve('node_modules/three/src/renderers/common/RenderContexts.js'), 'utf8');
        expect(contexts).toMatch(/get\( renderTarget = null, mrt = null, callDepth = 0 \)/);
        expect(contexts).toMatch(/attachmentState \+ '-' \+ mrtState \+ '-' \+ callDepth/);
        const rendererSrc = readFileSync(path.resolve('node_modules/three/src/renderers/common/Renderer.js'), 'utf8');
        expect(rendererSrc).toMatch(/this\._callDepth = - 1;/);
        expect(rendererSrc).toMatch(/this\._renderContexts\.get\( renderTarget, this\._mrt, this\._callDepth \)/);
        // compileAsync resolves its context at the DEFAULT depth — the reason the patch exists.
        expect(rendererSrc).toMatch(/const renderContext = this\._renderContexts\.get\( renderTarget, this\._mrt \);/);
        // The deferred drain the side capture works around.
        expect(rendererSrc).toMatch(/this\._compilationPromises\.push\( \{/);
        expect(rendererSrc).toMatch(/for \( const item of compilationPromises \)/);
    });
});

// ── Item 2.11: background compiles under the live rAF loop ─────────────────────────────────────
// A renderer double shaped like r185's: PROTOTYPE accessors exactly as Renderer.js defines them
// (getRenderTarget/getMRT return the private fields; isOutputTarget / currentToneMapping /
// currentColorSpace / needsFrameBufferTarget derive from each other), a synchronous render() that
// reads them the way _renderScene does, and a compileAsync split into a synchronous prologue
// (resolves the context, queues items) and a yielding drain that reads getRenderTarget()/getMRT()
// before the first yield and after the last one, like NodeMaterial.setup / WGSLNodeBuilder.buildCode.
class R185Renderer {
    constructor() {
        this._renderTarget = null;
        this._mrt = null;
        this._outputRenderTarget = null;
        this.toneMapping = 'ACES';
        this.outputColorSpace = 'srgb';
        this._compilationPromises = null;
        this._callDepth = -1;
        const contexts = new Map();
        this._renderContexts = {
            get: (rt = null, mrt = null, depth = 0) => {
                const id = `${rt?.name ?? rt}|${mrt}|${depth}`;
                if (!contexts.has(id)) contexts.set(id, { id, depth: 'renderer-flag', stencil: 'renderer-flag' });
                this._renderContexts.last = contexts.get(id);
                return contexts.get(id);
            },
        };
        this.frames = []; // what each render() saw
        this.builds = []; // what each drained item saw
        this.prologues = []; // what each compileAsync prologue saw
    }

    getRenderTarget() { return this._renderTarget; }

    getMRT() { return this._mrt; }

    setRenderTarget(t) { this._renderTarget = t; }

    setMRT(m) { this._mrt = m; }

    get isOutputTarget() { return this._renderTarget === this._outputRenderTarget || this._renderTarget === null; }

    get currentSamples() { return this._renderTarget ? this._renderTarget.samples : 0; } // Renderer.js 2476

    clear() { this.cleared = (this.cleared || []).concat([this._renderTarget]); } // reads the field directly (2306)

    get currentToneMapping() { return this.isOutputTarget ? this.toneMapping : 'none'; }

    get currentColorSpace() { return this.isOutputTarget ? this.outputColorSpace : 'working'; }

    get needsFrameBufferTarget() { return this.currentToneMapping !== 'none' || this.currentColorSpace !== 'working'; }

    // A live frame: the RenderPipeline quad at depth 0, a nested scene pass at depth 1 that
    // binds its own target and restores — reads through the public accessors like three does.
    render(label = 'frame') {
        this._callDepth += 1;
        const outer = {
            label, depth: this._callDepth, target: this.getRenderTarget(), mrt: this.getMRT(), tone: this.currentToneMapping, fb: this.needsFrameBufferTarget,
        };
        this.frames.push(outer);
        if (this._callDepth === 0 && label === 'post') {
            const prevT = this.getRenderTarget(); const prevM = this.getMRT();
            this.setRenderTarget('SCENE_RT'); this.setMRT('SCENE_MRT');
            this.render('scene-pass');
            this.setRenderTarget(prevT); this.setMRT(prevM);
        }
        this._callDepth -= 1;
        return outer;
    }

    // The r185 compileAsync shape, reduced to what matters here.
    async compileAsync(object) {
        const ctx = this._renderContexts.get(this._renderTarget || this._outputRenderTarget, this._mrt);
        this.prologues.push({
            object: object.name, visible: object.visible, frustumCulled: object.frustumCulled, ctx: ctx.id, target: this._renderTarget, mrt: this._mrt, fb: this.needsFrameBufferTarget,
        });
        const items = [{ object, renderContext: ctx }];
        for (const item of items) {
            const before = { target: this.getRenderTarget(), mrt: this.getMRT(), tone: this.currentToneMapping };
            // eslint-disable-next-line no-await-in-loop -- buildAsync yields (9×); a frame may run here
            await new Promise((r) => { setTimeout(r, 0); });
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => { setTimeout(r, 0); });
            const after = { target: this.getRenderTarget(), mrt: this.getMRT(), tone: this.currentToneMapping };
            this.builds.push({
                object: item.object.name, ctx: item.renderContext.id, before, after,
            });
        }
    }
}

const tick = () => new Promise((r) => { setTimeout(r, 0); });

describe('item 2.11 — beginLiveCompileReads', () => {
    it('answers target/MRT reads with the binding between frames and with the truth inside a render', () => {
        const r = new R185Renderer();
        const sceneRT = { name: 'SCENE_RT', samples: 4 };
        const release = beginLiveCompileReads(r, { renderTarget: sceneRT, mrt: 'SCENE_MRT' });
        expect(r.getRenderTarget()).toBe(sceneRT);
        expect(r.getMRT()).toBe('SCENE_MRT');
        expect(r.isOutputTarget).toBe(false);
        expect(r.currentToneMapping).toBe('none'); // derived getters follow the shadowed field
        expect(r.needsFrameBufferTarget).toBe(false);
        expect(r.currentSamples).toBe(4); // the field accessor covers what a method shadow misses
        expect(r.__odysseyLiveCompileReads.backing.renderTarget).toBeNull(); // the truth is untouched
        r.clear(); // a between-frame clear() is suspended: it sees the truth
        expect(r.cleared).toEqual([null]);
        const frame = r.render('post');
        expect(frame.target).toBeNull(); // the live quad saw the canvas …
        expect(frame.tone).toBe('ACES'); // … with tone mapping, i.e. the real isOutputTarget
        expect(frame.fb).toBe(true);
        expect(r.frames[1]).toMatchObject({
            label: 'scene-pass', depth: 1, target: 'SCENE_RT', mrt: 'SCENE_MRT', tone: 'none',
        });
        expect(r.__odysseyLiveCompileReads.backing.renderTarget).toBeNull(); // frame restored its own binding
        // The app's own save points see the truth through the backing, not the binding.
        r.setRenderTarget('PRIVATE_WARM');
        expect(r.__odysseyLiveCompileReads.backing.renderTarget).toBe('PRIVATE_WARM');
        expect(r.getRenderTarget()).toBe(sceneRT); // a drained build still sees the binding
        r.setRenderTarget(null);
        release();
        expect(r.getRenderTarget()).toBeNull();
        expect(r._renderTarget).toBeNull();
        const desc = Object.getOwnPropertyDescriptor(r, '_renderTarget');
        expect(desc && 'value' in desc).toBe(true); // plain data field again
        expect(Object.prototype.hasOwnProperty.call(r, 'render')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(r, 'clear')).toBe(false);
        expect(r.currentToneMapping).toBe('ACES');
    });

    it("suspends the drain's own node update hooks (a FRAME-type updateBefore sees and restores the truth)", () => {
        const r = new R185Renderer();
        const sceneRT = { name: 'SCENE_RT', samples: 4 };
        const seen = [];
        r._nodes = {
            // A FRAME-type updateBefore that saves / rebinds / restores, like PassNode / RTTNode.
            updateBefore() {
                const saved = r.getRenderTarget(); seen.push(saved); r.setRenderTarget('RTT'); r.render('rtt'); r.setRenderTarget(saved);
            },
            updateForRender() { seen.push(r.getRenderTarget()); },
            updateAfter() {},
        };
        const release = beginLiveCompileReads(r, { renderTarget: sceneRT, mrt: 'SCENE_MRT' });
        r._nodes.updateBefore();
        r._nodes.updateForRender();
        expect(seen).toEqual([null, null]); // the hooks saw the TRUTH, not the binding
        expect(r.__odysseyLiveCompileReads.backing.renderTarget).toBeNull(); // and restored it
        // Inside a live scene pass the scene-pass target is LEGITIMATELY bound around nested hooks.
        r.setRenderTarget(sceneRT);
        r._nodes.updateForRender();
        expect(seen.at(-1)).toBe(sceneRT);
        expect(r.__odysseyLiveCompileReads.backing.renderTarget).toBe(sceneRT); // never "corrected"
        r.setRenderTarget(null);
        release();
        expect(r._nodes.updateBefore.name).not.toBe('odysseySuspended'); // restored
    });

    it('does not wrap async entry points (their awaits would keep the override suspended)', () => {
        const r = new R185Renderer();
        r.renderAsync = async function renderAsync() { return 'async'; };
        r.computeAsync = async function computeAsync() { return 'async'; };
        const release = beginLiveCompileReads(r, { renderTarget: 'RT', mrt: null });
        expect(r.renderAsync.name).toBe('renderAsync');
        expect(r.computeAsync.name).toBe('computeAsync');
        release();
    });

    it('is refcounted and never leaves a shadow behind when a render throws', () => {
        const r = new R185Renderer();
        r.render = function boom() { throw new Error('device lost'); };
        const a = beginLiveCompileReads(r, { renderTarget: 'RT', mrt: null });
        const b = beginLiveCompileReads(r, { renderTarget: 'RT', mrt: null });
        expect(b).toBe(a);
        expect(() => r.render()).toThrow('device lost');
        expect(r.getRenderTarget()).toBe('RT'); // liveDepth unwound in finally
        a();
        expect(r.__odysseyLiveCompileReads).toBeDefined();
        b();
        expect(r.__odysseyLiveCompileReads).toBeUndefined();
    });

    it('returns null for renderers without the accessors', () => {
        expect(beginLiveCompileReads({}, { renderTarget: null, mrt: null })).toBeNull();
    });
});

describe('item 2.11 — launchCompileInScenePassPrologue', () => {
    it('binds the scene pass at depth 1 and reveals the object ONLY for the synchronous prologue', async () => {
        const r = new R185Renderer();
        const scenePass = { renderTarget: { name: 'SCENE_RT', depthBuffer: true, stencilBuffer: false }, getMRT: () => 'SCENE_MRT' };
        const light = { name: 'light', isLight: true, visible: false };
        const child = {
            name: 'gated', isMesh: true, visible: false, frustumCulled: true,
        };
        const object = {
            name: 'far-chapter-mesh',
            isMesh: true,
            visible: false,
            frustumCulled: true,
            traverse(fn) { fn(this); fn(child); fn(light); },
        };
        r.setRenderTarget('PRIVATE_WARM'); // whatever the app had bound before
        const promise = launchCompileInScenePassPrologue(r, scenePass, object, () => r.compileAsync(object));
        // Synchronously after the call: everything restored, nothing a frame could observe.
        expect(r._renderTarget).toBe('PRIVATE_WARM');
        expect(r._mrt).toBeNull();
        expect(r._renderContexts.last).toMatchObject({ depth: true, stencil: false }); // FIX-1: target's buffers, not renderer flags
        expect(object.visible).toBe(false);
        expect(object.frustumCulled).toBe(true);
        expect(child.visible).toBe(false);
        expect(light.visible).toBe(false);
        expect(r._renderContexts.__odysseyDepthPatched).toBeUndefined();
        // The prologue saw the scene pass, the depth-1 context, and the revealed object.
        expect(r.prologues[0]).toMatchObject({
            object: 'far-chapter-mesh',
            visible: true,
            frustumCulled: false,
            target: scenePass.renderTarget,
            mrt: 'SCENE_MRT',
            fb: false,
            ctx: `SCENE_RT|SCENE_MRT|${POST_SCENE_PASS_CALL_DEPTH}`,
        });
        await promise;
    });

    it('restores even when compileAsync throws synchronously', () => {
        const r = new R185Renderer();
        const scenePass = { renderTarget: 'SCENE_RT', getMRT: () => null };
        const object = {
            name: 'o', isMesh: true, visible: false, frustumCulled: true,
        };
        expect(() => launchCompileInScenePassPrologue(r, scenePass, object, () => { throw new Error('x'); })).toThrow('x');
        expect(r._renderTarget).toBeNull();
        expect(object.visible).toBe(false);
        expect(r._renderContexts.__odysseyDepthPatched).toBeUndefined();
    });
});

describe('item 2.11 — compileGroupUnderLiveLoop / compileGroupThroughPost(live)', () => {
    const hiddenChapter = () => {
        const a = {
            name: 'a', isMesh: true, visible: false, frustumCulled: true, material: { uuid: 'ma' },
        };
        const b = {
            name: 'b', isMesh: true, visible: false, frustumCulled: true, material: { uuid: 'mb', transparent: true, side: 2 },
        };
        const group = { name: 'ch6', visible: false, traverse(fn) { fn(this); fn(a); fn(b); } };
        return { group, a, b };
    };

    it('drained builds see the scene-pass binding across yields while live frames keep rendering to the canvas', async () => {
        const r = new R185Renderer();
        const { group, a, b } = hiddenChapter();
        const post = { scenePass: { renderTarget: 'SCENE_RT', getMRT: () => 'SCENE_MRT' } };
        const done = compileGroupUnderLiveLoop(r, post, 'SCENE', 'CAM', group);
        // The rAF loop keeps going while the builds yield.
        r.render('post');
        await tick();
        r.render('post');
        await done;
        expect(r.builds.map((x) => x.object).sort()).toEqual(['a', 'b']); // hidden objects compiled
        for (const build of r.builds) {
            expect(build.ctx).toBe(`SCENE_RT|SCENE_MRT|${POST_SCENE_PASS_CALL_DEPTH}`);
            expect(build.before).toEqual({ target: 'SCENE_RT', mrt: 'SCENE_MRT', tone: 'none' });
            expect(build.after).toEqual({ target: 'SCENE_RT', mrt: 'SCENE_MRT', tone: 'none' });
        }
        const quads = r.frames.filter((f) => f.label === 'post');
        expect(quads.length).toBe(2);
        quads.forEach((f) => { expect(f.target).toBeNull(); expect(f.tone).toBe('ACES'); });
        expect(a.visible).toBe(false);
        expect(b.visible).toBe(false);
        expect(r._renderTarget).toBeNull();
        // Everything released.
        expect(r.__odysseyLiveCompileReads).toBeUndefined();
        expect(r.__odysseySideCapture).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(r, 'getMRT')).toBe(false);
    });

    it('compileGroupThroughPost runs the live path only when asked, and still refuses otherwise', async () => {
        const r = new R185Renderer();
        const { group } = hiddenChapter();
        const post = { scenePass: { renderTarget: 'SCENE_RT', getMRT: () => 'SCENE_MRT' } };
        expect(await compileGroupThroughPost(r, post, 'SCENE', 'CAM', group, true)).toBe(false);
        expect(r.builds.length).toBe(0);
        expect(await compileGroupThroughPost(r, post, 'SCENE', 'CAM', group, true, { live: true })).toBe(true);
        expect(r.builds.length).toBe(2);
    });

    it('is a no-op (false) without a post scene pass', async () => {
        const r = new R185Renderer();
        const { group } = hiddenChapter();
        expect(await compileGroupUnderLiveLoop(r, null, 'SCENE', 'CAM', group)).toBe(false);
    });
});
