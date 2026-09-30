import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import Renderer from 'three/src/renderers/common/Renderer.js';
import Pipelines from 'three/src/renderers/common/Pipelines.js';
import Info from 'three/src/renderers/common/Info.js';
import WebGPUBackend from 'three/src/renderers/webgpu/WebGPUBackend.js';
import { EventDispatcher } from 'three/src/core/EventDispatcher.js';
import {
    compileComputeAsync,
    getAsyncComputeStats,
    installAsyncComputePipelines,
    isAsyncComputeCapable,
} from '../../src/rendering/webgpu-compute-pipeline-async.js';

// Behaviour of the r185 async-compute helper against the REAL three r185 Renderer / Pipelines /
// WebGPUBackend classes, with a fake GPUDevice. The sync create throws, so any test that reaches
// it fails loudly; setPipeline enforces WebIDL typing like Chromium does.

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function makeHarness({ nativeCompileComputeAsync = false } = {}) {
    const pending = deferred();
    const pass = {
        setPipeline: vi.fn((p) => {
            if (typeof p !== 'object' || p === null) {
                throw new TypeError("Failed to execute 'setPipeline': not a GPUComputePipeline");
            }
        }),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
    };
    const device = {
        limits: { maxComputeWorkgroupsPerDimension: 65535 },
        queue: { submit: vi.fn() },
        createShaderModule: vi.fn(() => ({ kind: 'module' })),
        createPipelineLayout: vi.fn((desc) => ({ kind: 'layout', desc })),
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn(() => Promise.resolve(null)),
        createComputePipeline: vi.fn(() => { throw new Error('SYNC create must not be reached'); }),
        createComputePipelineAsync: vi.fn(() => pending.promise),
        createCommandEncoder: vi.fn(() => ({ beginComputePass: () => pass, finish: () => ({ kind: 'cmd' }) })),
    };
    const backend = new WebGPUBackend();
    backend.device = device;
    const group = { kind: 'bind-group' };
    backend.get(group).layout = { layoutGPU: { kind: 'layoutGPU' } };
    backend.get(group).group = { kind: 'gpu-bind-group' };
    const nodes = {
        nodeFrame: { renderId: 0 },
        updateForCompute() {},
        delete: vi.fn(),
        getForCompute: () => ({ computeShader: 'WGSL-COMPUTE', transforms: [], nodeAttributes: [] }),
    };
    const bindings = {
        updateForCompute: vi.fn(),
        deleteForCompute: vi.fn(),
        getForCompute: () => [group],
    };
    const info = new Info();
    const pipelines = new Pipelines(backend, nodes, info);
    const renderer = Object.create(Renderer.prototype);
    Object.assign(renderer, {
        _initialized: true,
        _isDeviceLost: false,
        info,
        _inspector: { beginCompute() {}, finishCompute() {} }, // the `inspector` accessor wraps this
        backend,
        _pipelines: pipelines,
        _bindings: bindings,
        _nodes: nodes,
    });
    if (nativeCompileComputeAsync) renderer.compileComputeAsync = vi.fn(async () => {});
    backend.renderer = renderer;
    const node = Object.assign(new EventDispatcher(), {
        isComputeNode: true,
        id: 4242,
        version: 0,
        name: '',
        onInitFunction: vi.fn(),
        count: 64,
        workgroupSize: [64],
    });
    const pipelineOf = () => pipelines.get(node).pipeline;
    return {
        renderer, backend, device, pass, node, pending, pipelines, pipelineOf,
    };
}

describe('webgpu-compute-pipeline-async (r185 async compute)', () => {
    let errorSpy;
    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('window', { location: { search: '' }, localStorage: { getItem: () => null } });
    });
    afterEach(() => {
        errorSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    it('creates through createComputePipelineAsync only, inside a synchronous window', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        // The async create was issued before the promise is awaited: the window is synchronous.
        expect(h.device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
        expect(h.device.createComputePipeline).not.toHaveBeenCalled();
        expect(h.pass.setPipeline).not.toHaveBeenCalled();
        expect(h.node.onInitFunction).toHaveBeenCalledTimes(1);
        const desc = h.device.createComputePipelineAsync.mock.calls[0][0];
        expect(desc.label).toBe('computePipeline_compute');
        expect(desc.compute.entryPoint).toBe('main');
        expect(h.device.pushErrorScope.mock.calls.length).toBe(h.device.popErrorScope.mock.calls.length);
        h.pending.resolve({ kind: 'gpu-compute-pipeline' });
        await expect(result).resolves.toMatchObject({ status: 'ready', created: 1, failed: 0 });
    });

    it('drops dispatches while the pipeline is pending, and dispatches once it resolves', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        expect(() => h.renderer.compute(h.node)).not.toThrow();
        expect(h.pass.dispatchWorkgroups).not.toHaveBeenCalled();
        expect(getAsyncComputeStats(h.renderer).skippedPending).toBe(1);
        const gpuPipeline = { kind: 'gpu-compute-pipeline' };
        h.pending.resolve(gpuPipeline);
        await result;
        h.renderer.compute(h.node);
        expect(h.pass.setPipeline).toHaveBeenCalledWith(gpuPipeline);
        expect(h.pass.dispatchWorkgroups).toHaveBeenCalledWith(1, 1, 1);
        expect(h.device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
        expect(h.device.createComputePipeline).not.toHaveBeenCalled();
    });

    it('control: an unguarded r185 backend throws on a pending pipeline (the loop-killing hazard)', () => {
        const h = makeHarness();
        // Simulate a pending async create without the helper: the slot exists but is empty.
        h.device.createComputePipeline = vi.fn(() => undefined);
        expect(() => h.renderer.compute(h.node)).toThrow(TypeError);
    });

    it('is idempotent and creates nothing the second time', async () => {
        const h = makeHarness();
        const first = compileComputeAsync(h.renderer, h.node);
        h.pending.resolve({ kind: 'gpu-compute-pipeline' });
        await first;
        expect(installAsyncComputePipelines(h.renderer)).toBe(installAsyncComputePipelines(h.renderer));
        await expect(compileComputeAsync(h.renderer, h.node)).resolves.toMatchObject({ status: 'ready', created: 0 });
        expect(h.device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
    });

    it('reports a rejected create as failed and keeps dispatch skipped', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        h.pending.reject(new Error('GPUPipelineError: bad shader'));
        await expect(result).resolves.toMatchObject({ status: 'failed', failed: 1 });
        expect(errorSpy).toHaveBeenCalled();
        h.renderer.compute(h.node);
        expect(h.pass.dispatchWorkgroups).not.toHaveBeenCalled();
    });

    it('does not log failures after device loss', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        h.renderer._isDeviceLost = true;
        h.pending.reject(new Error('device lost'));
        await result;
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('times out without hanging, and a late resolve still fills the slot', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness();
            const result = compileComputeAsync(h.renderer, h.node, { timeoutMs: 50 });
            await vi.advanceTimersByTimeAsync(60);
            await expect(result).resolves.toMatchObject({ status: 'timeout' });
            const gpuPipeline = { kind: 'late' };
            h.pending.resolve(gpuPipeline);
            await vi.advanceTimersByTimeAsync(0);
            h.renderer.compute(h.node);
            expect(h.pass.setPipeline).toHaveBeenCalledWith(gpuPipeline);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves the ordinary sync create untouched outside the compile window', () => {
        const h = makeHarness();
        installAsyncComputePipelines(h.renderer);
        h.device.createComputePipeline = vi.fn(() => ({ kind: 'sync-pipeline' }));
        h.renderer.compute(h.node);
        expect(h.device.createComputePipeline).toHaveBeenCalledTimes(1);
        expect(h.device.createComputePipelineAsync).not.toHaveBeenCalled();
    });

    it('uses a native compileComputeAsync (r186+) and only installs the guard', async () => {
        const h = makeHarness({ nativeCompileComputeAsync: true });
        const createBefore = h.backend.createComputePipeline;
        await expect(compileComputeAsync(h.renderer, h.node)).resolves.toMatchObject({ status: 'ready' });
        expect(h.renderer.compileComputeAsync).toHaveBeenCalledTimes(1);
        expect(h.backend.createComputePipeline).toBe(createBefore);
        expect(Object.prototype.hasOwnProperty.call(h.backend, 'compute')).toBe(true);
    });

    it('honours the ?syncComputePipelines=1 rollback', async () => {
        vi.stubGlobal('window', {
            location: { search: '?syncComputePipelines=1' },
            localStorage: { getItem: () => null },
        });
        const h = makeHarness();
        expect(isAsyncComputeCapable(h.renderer)).toBe(false);
        await expect(compileComputeAsync(h.renderer, h.node)).resolves.toMatchObject({ status: 'disabled' });
        expect(Object.prototype.hasOwnProperty.call(h.backend, 'compute')).toBe(false);
    });

    it('reports device-lost and unsupported renderers without touching them', async () => {
        const lost = makeHarness();
        lost.renderer._isDeviceLost = true;
        await expect(compileComputeAsync(lost.renderer, lost.node)).resolves.toMatchObject({ status: 'device-lost' });
        const mocked = { backend: { isWebGPUBackend: true }, initialized: true };
        await expect(compileComputeAsync(mocked, lost.node)).resolves.toMatchObject({ status: 'unsupported' });
    });
});
