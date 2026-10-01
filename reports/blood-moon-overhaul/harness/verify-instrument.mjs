import assert from 'node:assert/strict';
import vm from 'node:vm';
import { THEME_PERF_BOOTSTRAP } from './theme-perf-instrument.mjs';

for (const isNode of [false, true]) {
    const context = vm.createContext({
        window: {}, performance: { now: () => 1 },
        requestAnimationFrame: () => 0,
        HTMLCanvasElement: class { getContext() { return {}; } },
        PerformanceObserver: class { observe() {} },
    });
    vm.runInContext(THEME_PERF_BOOTSTRAP, context);
    const state = context.window.__THEME_PERF__;
    const countKey = isNode ? 'drawCalls' : 'calls';
    const info = {
        autoReset: true,
        render: { [countKey]: 0, triangles: 0 },
        reset() { this.render[countKey] = 0; this.render.triangles = 0; },
    };
    const renderer = {
        isWebGPURenderer: isNode, info,
        ...(isNode ? { backend: { isWebGPUBackend: true, device: { features: new Set() } } } : {}),
        render() { info.render[countKey] += 2; info.render.triangles += 10; },
    };
    state.onRenderer(renderer);
    assert.equal(info.autoReset, false);
    state.laneFrameId = 1;
    renderer.render();
    state.laneFrameId = 2;
    renderer.render();
    assert.deepEqual(Array.from(state.rings.calls), [0, 2]);
    assert.deepEqual(Array.from(state.rings.tris), [0, 10]);
    assert.equal(state.infoResetsByTheme, 0);
    info.reset();
    assert.equal(state.infoResetsByTheme, 1);
    if (!isNode) assert.equal(state.timestampUnavailableReason, 'classic-webgl-renderer-has-no-timestamp-api');
}
console.log('Verified classic/node draw counter adapters and separation of instrument/theme resets.');

const context = vm.createContext({
    window: {}, performance: { now: () => 1 }, requestAnimationFrame: () => 0,
    HTMLCanvasElement: class { getContext() { return {}; } },
    PerformanceObserver: class { observe() {} },
});
vm.runInContext(THEME_PERF_BOOTSTRAP, context);
const state = context.window.__THEME_PERF__;
const pool = { currentQueryIndex: 2, pendingResolve: null, frames: [] };
const renderer = {
    isWebGPURenderer: true,
    backend: {
        isWebGPUBackend: true,
        device: { features: new Set(['timestamp-query']) },
        timestampQueryPool: { render: pool },
    },
    info: { autoReset: true, render: { drawCalls: 1, triangles: 2, timestamp: 0 }, reset() {} },
    render() {},
    async resolveTimestampsAsync() {
        pool.currentQueryIndex = 0;
        pool.frames = [1];
        this.info.render.timestamp = 0.5;
    },
};
state.onRenderer(renderer);
state.resolveRender();
await new Promise(setImmediate);
assert.equal(state.rings.gpu.length, 1);
state.resolveRender(); // No pending queries: cached timestamp must not be sampled.
await new Promise(setImmediate);
assert.equal(state.rings.gpu.length, 1);
pool.currentQueryIndex = 2;
renderer.resolveTimestampsAsync = async () => {}; // Failed/no-op resolve: same frame list.
state.resolveRender();
await new Promise(setImmediate);
assert.equal(state.rings.gpu.length, 1);
console.log('Verified fresh-query GPU sampling rejects idle and cached-value resolves.');
