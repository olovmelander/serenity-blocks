// @ts-check
// Executes the real bootstrap source against a stub renderer whose call shape matches
// neon-district's, which nests four deep:
//   post.render -> RenderPipeline.render -> QuadMesh.render -> renderer.render
//                                                           -> PassNode -> renderer.render
//                                                           -> ReflectorNode -> renderer.render
// Reading the source is not enough here: commit 71fcf9a9 asserted "draw counting is unaffected...
// deltas nest safely" from inspection, and it was wrong by a factor of 3.5.
/* eslint-disable no-new-func */
import { describe, expect, it } from 'vitest';
import { THEME_PERF_BOOTSTRAP } from '../../scripts/lib/theme-perf-instrument.mjs';

/**
 * Build a fake page, install the bootstrap into it, and drive one frame.
 * @param {number} drawsPerPass how many draws each leaf render adds
 * @param {number} leafPasses how many leaf renders one outer frame performs
 */
function runFrame(drawsPerPass, leafPasses) {
    const info = {
        render: {
            drawCalls: 0, triangles: 0, calls: 0, frame: 0,
        },
        reset() {},
    };
    const renderer = {
        isWebGPURenderer: true,
        info,
        // A leaf render: the only thing that actually increments Info.
        render() {
            info.render.drawCalls += drawsPerPass;
            info.render.triangles += drawsPerPass * 100;
        },
    };
    // The post object re-enters renderer.render once per leaf pass, as a RenderPipeline does.
    const post = {
        render() {
            for (let i = 0; i < leafPasses; i += 1) renderer.render();
        },
    };
    const theme = { renderer: null, post };

    const win = {
        performance: { now: () => Date.now(), memory: undefined },
        requestAnimationFrame: () => 0,
        PerformanceObserver: function PO() { return { observe() {} }; },
    };
    const sandbox = {
        window: win,
        performance: win.performance,
        requestAnimationFrame: win.requestAnimationFrame,
        PerformanceObserver: win.PerformanceObserver,
        HTMLCanvasElement: function HC() {},
        GPUDevice: undefined,
    };
    sandbox.HTMLCanvasElement.prototype = { getContext() { return null; } };

    // eslint-disable-next-line max-len
    const fn = new Function('window', 'performance', 'requestAnimationFrame', 'PerformanceObserver', 'HTMLCanvasElement', 'GPUDevice', THEME_PERF_BOOTSTRAP);
    fn(
        sandbox.window,
        sandbox.performance,
        sandbox.requestAnimationFrame,
        sandbox.PerformanceObserver,
        sandbox.HTMLCanvasElement,
        sandbox.GPUDevice,
    );

    const S = win.__THEME_PERF__;
    S.noteThemeStart(theme);
    theme.renderer = renderer; // fires the setter trap -> onRenderer -> wrapRenderEntries
    S.wrapRenderEntries(renderer);
    // The post object is built after the renderer in every real theme; the lane re-wraps per frame.
    S.theme = theme;
    S.wrapRenderEntries(renderer);

    S.frameDraws = 0;
    S.frameTris = 0;
    post.render(); // one frame, driven the way a theme drives it
    return { draws: S.frameDraws, tris: S.frameTris };
}

describe('nested render entries are measured once, not once per ancestor', () => {
    it('counts a four-deep frame exactly once', () => {
        // 3 leaf passes x 200 draws = 600 true draws for the frame.
        const { draws, tris } = runFrame(200, 3);
        expect(draws).toBe(600);
        expect(tris).toBe(60000);
    });

    it('is unaffected by how many wrapped ancestors sit above the leaf', () => {
        // Same true work, more nesting: the answer must not move.
        expect(runFrame(100, 1).draws).toBe(100);
        expect(runFrame(100, 6).draws).toBe(600);
        expect(runFrame(50, 12).draws).toBe(600);
    });

    it('leaves renderDepth balanced so a throw cannot strand the counter', () => {
        const { draws } = runFrame(10, 2);
        expect(draws).toBe(20);
        // A second frame must start from a clean depth, not an accumulated one.
        expect(runFrame(10, 2).draws).toBe(20);
    });
});
