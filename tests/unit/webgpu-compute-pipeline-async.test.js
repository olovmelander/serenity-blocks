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

// Behaviour of the async-compute helper against the REAL installed Renderer / Pipelines /
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
    const descriptors = [];
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
        createShaderModule: vi.fn(() => ({
            kind: 'module', getCompilationInfo: async () => ({ messages: [] }),
        })),
        createPipelineLayout: vi.fn((desc) => ({ kind: 'layout', desc })),
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn(() => Promise.resolve(null)),
        createComputePipeline: vi.fn(() => { throw new Error('SYNC create must not be reached'); }),
        createComputePipelineAsync: vi.fn((descriptor) => {
            // r186 resets/reuses its descriptor as soon as WebGPU consumes it.
            descriptors.push({ ...descriptor });
            return pending.promise;
        }),
        createCommandEncoder: vi.fn(() => ({ beginComputePass: () => pass, finish: () => ({ kind: 'cmd' }) })),
    };
    const backend = new WebGPUBackend();
    backend.device = device;
    const group = { kind: 'bind-group' };
    backend.get(group).layout = { layoutGPU: { kind: 'layoutGPU' } };
    backend.get(group).group = { kind: 'gpu-bind-group' };
    const nodes = {
        nodeFrame: { renderId: 0 },
        updateBeforeForCompute() {},
        updateForCompute() {},
        updateAfterForCompute() {},
        delete: vi.fn(),
        getForCompute: () => ({ computeShader: 'WGSL-COMPUTE', transforms: [], nodeAttributes: [] }),
        getForComputeAsync: async () => {},
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
    if (nativeCompileComputeAsync) {
        renderer.compileComputeAsync = vi.fn(async (list) => {
            for (const entry of list) {
                const pipeline = { kind: 'native-pipeline' };
                pipelines.get(entry).pipeline = pipeline;
                backend.get(pipeline).pipeline = { kind: 'gpu-pipeline' };
            }
        });
    }
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
        renderer, backend, device, pass, node, pending, pipelines, pipelineOf, descriptors,
    };
}

describe('webgpu-compute-pipeline-async', () => {
    let errorSpy;
    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('window', { location: { search: '' }, localStorage: { getItem: () => null } });
    });
    afterEach(() => {
        errorSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    it('creates through createComputePipelineAsync only and preserves onInit', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        // Native compilation yields for the async node build.
        await Promise.resolve();
        expect(h.device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
        expect(h.device.createComputePipeline).not.toHaveBeenCalled();
        expect(h.pass.setPipeline).not.toHaveBeenCalled();
        expect(h.node.onInitFunction).toHaveBeenCalledTimes(1);
        const [desc] = h.descriptors;
        expect(desc.label).toBe('computePipeline_compute');
        expect(desc.compute.entryPoint).toBe('main');
        h.pending.resolve({ kind: 'gpu-compute-pipeline' });
        await expect(result).resolves.toMatchObject({ status: 'ready', created: 1, failed: 0 });
        expect(h.device.pushErrorScope.mock.calls.length).toBe(h.device.popErrorScope.mock.calls.length);
        expect(getAsyncComputeStats(h.renderer)).toMatchObject({ created: 1, failed: 0 });
        h.node.dispatchEvent({ type: 'dispose' });
        expect(h.pipelines.has(h.node)).toBe(false);
    });

    it('drops dispatches while the pipeline is pending, and dispatches once it resolves', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        await Promise.resolve();
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

    it('control: an unguarded backend throws on a pending pipeline (the loop-killing hazard)', () => {
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
        await Promise.resolve();
        h.pending.reject(new Error('GPUPipelineError: bad shader'));
        await expect(result).resolves.toMatchObject({ status: 'failed', failed: 1 });
        expect(errorSpy).toHaveBeenCalled();
        h.renderer.compute(h.node);
        expect(h.pass.dispatchWorkgroups).not.toHaveBeenCalled();
    });

    it('guards the yield before a pipeline exists instead of compiling synchronously', async () => {
        const h = makeHarness();
        const result = compileComputeAsync(h.renderer, h.node);
        expect(h.pipelines.has(h.node)).toBe(false);
        h.renderer.compute(h.node);
        expect(h.device.createComputePipeline).not.toHaveBeenCalled();
        expect(h.pass.dispatchWorkgroups).not.toHaveBeenCalled();
        expect(h.node.onInitFunction).toHaveBeenCalledTimes(1);
        h.pending.resolve({ kind: 'ready' });
        await result;
        h.renderer.compute(h.node);
        expect(h.pass.dispatchWorkgroups).toHaveBeenCalledTimes(1);
    });

    it('keeps guarding after a timeout during native node building, before any pipeline is cached', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness();
            const building = deferred();
            h.renderer._nodes.getForComputeAsync = () => building.promise;
            const result = compileComputeAsync(h.renderer, h.node, { timeoutMs: 50 });
            await vi.advanceTimersByTimeAsync(60);
            await expect(result).resolves.toMatchObject({ status: 'timeout' });
            h.renderer.compute([h.node]);
            expect(h.device.createComputePipeline).not.toHaveBeenCalled();
            expect(h.device.createComputePipelineAsync).not.toHaveBeenCalled();
            building.resolve();
            h.pending.resolve({ kind: 'late-pipeline' });
            await vi.advanceTimersByTimeAsync(0);
            h.renderer.compute(h.node);
            expect(h.pass.dispatchWorkgroups).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
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

    it('leaves ordinary compute untouched for nodes that are not compiling', () => {
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

    it.each(['missing', 'validation-error'])('reports a resolved native compile with %s as failed', async (failure) => {
        const h = makeHarness({ nativeCompileComputeAsync: true });
        h.renderer.compileComputeAsync.mockImplementation(async () => {
            const pipeline = { kind: 'failed-native-pipeline' };
            h.pipelines.get(h.node).pipeline = pipeline;
            if (failure === 'validation-error') {
                Object.assign(h.backend.get(pipeline), { pipeline: { kind: 'invalid' }, error: true });
            }
        });
        await expect(compileComputeAsync(h.renderer, h.node)).resolves.toMatchObject({
            status: 'failed', created: 0, failed: 1,
        });
        expect(getAsyncComputeStats(h.renderer)).toMatchObject({ created: 0, failed: 1 });
        // Exercise the guard directly: a validation error can leave a non-null GPU slot.
        h.backend.compute({}, h.node, [], h.pipelineOf());
        expect(h.pass.dispatchWorkgroups).not.toHaveBeenCalled();
    });

    it('does not report a native no-op compile without a pipeline as ready', async () => {
        const h = makeHarness({ nativeCompileComputeAsync: true });
        h.renderer.compileComputeAsync.mockImplementation(async () => {});
        await expect(compileComputeAsync(h.renderer, h.node)).resolves.toMatchObject({ status: 'failed' });
        expect(h.pipelines.has(h.node)).toBe(false);
    });

    it('ignores the retired syncComputePipelines flag and still uses native async compilation', async () => {
        vi.stubGlobal('window', {
            location: { search: '?syncComputePipelines=1' },
            localStorage: { getItem: () => null },
        });
        const h = makeHarness();
        expect(isAsyncComputeCapable(h.renderer)).toBe(true);
        const result = compileComputeAsync(h.renderer, h.node);
        h.pending.resolve({ kind: 'native-pipeline' });
        await expect(result).resolves.toMatchObject({ status: 'ready' });
        expect(h.device.createComputePipeline).not.toHaveBeenCalled();
    });

    it('reports device-lost and unsupported renderers without touching them', async () => {
        const lost = makeHarness();
        lost.renderer._isDeviceLost = true;
        await expect(compileComputeAsync(lost.renderer, lost.node)).resolves.toMatchObject({ status: 'device-lost' });
        const mocked = { backend: { isWebGPUBackend: true }, initialized: true };
        await expect(compileComputeAsync(mocked, lost.node)).resolves.toMatchObject({ status: 'unsupported' });
    });
});
