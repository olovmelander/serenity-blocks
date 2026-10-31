import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import Renderer from 'three/src/renderers/common/Renderer.js';
import {
    ensurePrecompileRestoresLiveState,
    watchCompileDrain,
    resetPrecompileLiveRestoreForTests,
} from '../../src/rendering/three-precompile-live-restore.js';

/**
 * three r187's compileAsync drain binds each queued item's target between _beginPreCompile and
 * _finishPreCompile, and _finishPreCompile binds the target that was bound when compileAsync was
 * CALLED. A caller that bound a target for the launch only (Spring's impostor atlas, Odyssey's
 * live-loop compile) got it bound again after every drained item. These drive three's own hooks
 * on a renderer with no backend, the way the drain calls them.
 */
const src = readFileSync(new URL('../../node_modules/three/src/renderers/common/Renderer.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
const hasHooks = typeof Renderer.prototype._beginPreCompile === 'function'; // eslint-disable-line no-underscore-dangle

function bareRenderer() {
    const renderer = Object.create(Renderer.prototype);
    Object.assign(renderer, {
        _renderTarget: null,
        _activeCubeFace: 0,
        _activeMipmapLevel: 0,
        _mrt: null,
        _callDepth: -1,
        _currentRenderContext: 'live-context',
        _precompilationState: null,
    });
    return renderer;
}

/** compileAsync's prologue with `target` bound: begin, queue one item as _createObjectPipeline does, finish. */
function launch(renderer, target, mrt = null) {
    const material = { side: 2 };
    const state = {
        useFrameBufferTarget: false,
        renderTarget: target,
        outputRenderTarget: renderer._renderTarget, // eslint-disable-line no-underscore-dangle
        activeCubeFace: 0,
        activeMipmapLevel: 0,
        item: null,
        materialSide: null,
        mrt,
        outputMRT: mrt,
        renderContext: 'compile-context',
    };
    renderer._beginPreCompile(state); // eslint-disable-line no-underscore-dangle
    const item = {
        material,
        side: 0,
        precompilationState: {
            ...renderer._precompilationState, // eslint-disable-line no-underscore-dangle
            useFrameBufferTarget: true,
            renderTarget: renderer.getRenderTarget(),
            mrt: renderer.getMRT(),
            renderContext: 'compile-context',
        },
    };
    renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
    return item;
}

/** One drained item, as compileAsync runs it (the build itself left out). */
function drain(renderer, item, during = () => {}) {
    item.precompilationState.item = item; // eslint-disable-line no-param-reassign
    renderer._beginPreCompile(item.precompilationState); // eslint-disable-line no-underscore-dangle
    during();
    renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
}

/**
 * compileAsync as r187 runs it up to its first await: the prologue (begin, queue one item, finish)
 * and then the FIRST item's begin, all inside the call. `framebuffer` stands for a renderer whose
 * output needs a framebuffer target while nothing is bound.
 */
function launchFirstItem(renderer, { framebuffer = null } = {}) {
    const bound = renderer.getRenderTarget();
    const useFrameBufferTarget = framebuffer !== null && bound === null;
    const state = {
        useFrameBufferTarget,
        renderTarget: useFrameBufferTarget ? framebuffer : bound,
        outputRenderTarget: bound,
        activeCubeFace: renderer.getActiveCubeFace(),
        activeMipmapLevel: renderer.getActiveMipmapLevel(),
        item: null,
        materialSide: null,
        mrt: renderer.getMRT(),
        outputMRT: renderer.getMRT(),
        renderContext: 'compile-context',
    };
    renderer._beginPreCompile(state); // eslint-disable-line no-underscore-dangle
    const item = {
        material: { side: 2 },
        side: 0,
        precompilationState: {
            ...renderer._precompilationState, // eslint-disable-line no-underscore-dangle
            useFrameBufferTarget: true,
            renderTarget: renderer.getRenderTarget(),
            mrt: renderer.getMRT(),
            renderContext: 'compile-context',
        },
    };
    renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
    item.precompilationState.item = item;
    renderer._beginPreCompile(item.precompilationState); // eslint-disable-line no-underscore-dangle
    return item;
}

afterEach(() => resetPrecompileLiveRestoreForTests(bareRenderer()));

describe('three r187 precompile hooks restore the live binding after each drained item', () => {
    it.skipIf(hasHooks)('does nothing on a three without the hooks (r186)', () => {
        expect(ensurePrecompileRestoresLiveState(bareRenderer())).toBe(false);
    });

    it.runIf(hasHooks)('pins the drain: items bind their queue-time target, finish binds the launch target', () => {
        expect(src).toContain('const precompilationState = { useFrameBufferTarget, renderTarget, outputRenderTarget: useFrameBufferTarget ? outputRenderTarget : this._renderTarget');
        expect(src).toMatch(/precompilationState: \{\s*\.\.\.this\._precompilationState,\s*useFrameBufferTarget: true,\s*renderTarget: this\.getRenderTarget\(\),\s*mrt: this\.getMRT\(\),/);
        expect(src).toMatch(/const activePrecompilationState = this\._precompilationState;\s*this\._finishPreCompile\(\);\s*await scheduler\.yield\(\);\s*this\._beginPreCompile\( activePrecompilationState \);/);
        expect(src).toMatch(/_finishPreCompile\(\) \{[\s\S]*?if \( useFrameBufferTarget === true \) this\.setRenderTarget\( outputRenderTarget, activeCubeFace, activeMipmapLevel \);\s*this\.setMRT\( outputMRT \);/);
    });

    it.runIf(hasHooks)('without the patch the launch target comes back after a drained item (the bug)', () => {
        const renderer = bareRenderer();
        const atlas = { name: 'atlas' };
        renderer.setRenderTarget(atlas);
        const item = launch(renderer, atlas);
        renderer.setRenderTarget(null); // the caller lets go at once
        drain(renderer, item);
        expect(renderer.getRenderTarget()).toBe(atlas);
    });

    it.runIf(hasHooks)('with it, a launch-only binding stays let go, and each item still builds against its target', () => {
        const renderer = bareRenderer();
        expect(ensurePrecompileRestoresLiveState(renderer)).toBe(true);
        expect(ensurePrecompileRestoresLiveState(bareRenderer())).toBe(true); // once per prototype
        const atlas = { name: 'atlas' };
        const sceneMRT = { name: 'scene-mrt' };
        renderer.setRenderTarget(atlas);
        renderer.setMRT(sceneMRT);
        const item = launch(renderer, atlas, sceneMRT);
        expect(renderer.getRenderTarget()).toBe(atlas); // the prologue leaves the caller's binding
        renderer.setRenderTarget(null);
        renderer.setMRT(null);
        let seen = null;
        drain(renderer, item, () => { seen = { target: renderer.getRenderTarget(), mrt: renderer.getMRT() }; });
        expect(seen).toEqual({ target: atlas, mrt: sceneMRT });
        expect(renderer.getRenderTarget()).toBeNull();
        expect(renderer.getMRT()).toBeNull();
        expect(item.material.side).toBe(2); // three's own side restore still runs
    });

    it.runIf(hasHooks)('a caller that holds its binding across the await gets it back, cube face and mip level too', () => {
        const renderer = bareRenderer();
        ensurePrecompileRestoresLiveState(renderer);
        const cube = { name: 'cube' };
        renderer.setRenderTarget(cube, 3, 2);
        const item = launch(renderer, cube);
        drain(renderer, item);
        expect(renderer.getRenderTarget()).toBe(cube);
        expect(renderer.getActiveCubeFace()).toBe(3);
        expect(renderer.getActiveMipmapLevel()).toBe(2);
    });
    // r187 begins the first drained item INSIDE the compileAsync call, before the caller can put its
    // binding back (Spring in the playground stayed bound to its atlas for good, 2026-10-30).
    it.runIf(hasHooks)('the first item, begun inside the call, does not bring back a launch-only target', () => {
        const renderer = bareRenderer();
        ensurePrecompileRestoresLiveState(renderer);
        const atlas = { name: 'atlas' };
        renderer.setRenderTarget(atlas);
        launchFirstItem(renderer);
        renderer.setRenderTarget(null); // the caller lets go as the call returns
        renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
        expect(renderer.getRenderTarget()).toBeNull();
    });

    it.runIf(hasHooks)('a held binding survives the first item too', () => {
        const renderer = bareRenderer();
        ensurePrecompileRestoresLiveState(renderer);
        const atlas = { name: 'atlas' };
        renderer.setRenderTarget(atlas);
        launchFirstItem(renderer);
        renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
        expect(renderer.getRenderTarget()).toBe(atlas);
    });

    it.runIf(hasHooks)('with nothing bound, the framebuffer target an item builds into is let go after it', () => {
        const renderer = bareRenderer();
        ensurePrecompileRestoresLiveState(renderer);
        const framebuffer = { name: 'framebuffer' };
        const item = launchFirstItem(renderer, { framebuffer });
        expect(renderer.getRenderTarget()).toBe(framebuffer); // the item builds against it
        renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
        expect(renderer.getRenderTarget()).toBeNull();
        drain(renderer, item);
        expect(renderer.getRenderTarget()).toBeNull();
    });
});

describe('watchCompileDrain: when a compileAsync drain is over (three r187)', () => {
    it.runIf(hasHooks)('is done at the last queued object\'s final finish, not at a yield before it', async () => {
        const renderer = bareRenderer();
        ensurePrecompileRestoresLiveState(renderer);
        const requests = [];
        renderer._pipelines = { getForRender: (ro, promises) => requests.push([ro, promises]) }; // eslint-disable-line no-underscore-dangle
        renderer._compilationPromises = null; // eslint-disable-line no-underscore-dangle
        const watch = watchCompileDrain(renderer);
        expect(watch).not.toBeNull();
        let done = false;
        watch.done.then(() => { done = true; });
        // The prologue: begin, queue two objects through three's own _createObjectPipeline, finish.
        const prologue = {
            useFrameBufferTarget: false, renderTarget: null, outputRenderTarget: null, activeCubeFace: 0, activeMipmapLevel: 0,
            item: null, materialSide: null, mrt: null, outputMRT: null, renderContext: 'ctx',
        };
        renderer._beginPreCompile(prologue); // eslint-disable-line no-underscore-dangle
        const queue = [];
        renderer._compilationPromises = queue; // eslint-disable-line no-underscore-dangle
        const material = { side: 0 };
        renderer._createObjectPipeline({ id: 'a' }, material, null, null, null, null, null, 'default'); // eslint-disable-line no-underscore-dangle
        renderer._createObjectPipeline({ id: 'b' }, material, null, null, null, null, null, 'default'); // eslint-disable-line no-underscore-dangle
        renderer._compilationPromises = null; // eslint-disable-line no-underscore-dangle
        renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
        expect(queue).toHaveLength(2);
        const run = (item, { yieldFirst = false } = {}) => {
            item.precompilationState.item = item; // eslint-disable-line no-param-reassign
            renderer._beginPreCompile(item.precompilationState); // eslint-disable-line no-underscore-dangle
            if (yieldFirst) { // the node build's yield: finish, (a frame), begin again
                const active = renderer._precompilationState; // eslint-disable-line no-underscore-dangle
                renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
                renderer._beginPreCompile(active); // eslint-disable-line no-underscore-dangle
            }
            renderer._pipelines.getForRender({ item }, []); // eslint-disable-line no-underscore-dangle
            renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
        };
        run(queue[0]);
        await Promise.resolve();
        expect(done).toBe(false);
        run(queue[1], { yieldFirst: true });
        await Promise.resolve();
        expect(done).toBe(true);
        expect(requests).toHaveLength(2);
        watch.dispose();
    });

    it.runIf(hasHooks)('is done at the prologue\'s finish when nothing was queued', async () => {
        const renderer = bareRenderer();
        ensurePrecompileRestoresLiveState(renderer);
        renderer._pipelines = { getForRender: () => {} }; // eslint-disable-line no-underscore-dangle
        const watch = watchCompileDrain(renderer);
        let done = false;
        watch.done.then(() => { done = true; });
        renderer._beginPreCompile({ // eslint-disable-line no-underscore-dangle
            useFrameBufferTarget: false, renderTarget: null, outputRenderTarget: null, item: null, mrt: null, outputMRT: null,
        });
        renderer._finishPreCompile(); // eslint-disable-line no-underscore-dangle
        await Promise.resolve();
        expect(done).toBe(true);
        watch.dispose();
    });

    it.skipIf(hasHooks)('is unavailable on a three without the hooks (r186)', () => {
        expect(watchCompileDrain(bareRenderer())).toBeNull();
    });
});
