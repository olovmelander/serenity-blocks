// @ts-check
/**
 * @fileoverview Async compute-pipeline creation for three 0.185.1 (r185).
 *
 * WHY: a synchronous `device.createComputePipeline` compiles on the GPU-process main thread,
 * which also draws the display compositor, so every animation on screen freezes while it runs
 * (a heavy pipeline measured 2.9 s). `createComputePipelineAsync` compiles on Dawn's worker
 * threads and the screen keeps presenting (worst frame 61-91 ms, same shader). r185 has no
 * async compute path at all; r186 adds `renderer.compileComputeAsync`.
 *
 * r185 chain: Renderer.compute (Renderer.js:2718) → Pipelines.getForCompute (Pipelines.js:86)
 *   → _getComputePipeline: caches.set (:359) → backend.createComputePipeline(pipeline, bindings)
 *   → WebGPUPipelineUtils.createComputePipeline → device.createComputePipeline (:417)  — SYNC.
 *
 * {@link compileComputeAsync} runs the REAL `renderer.compute(list)` inside a synchronous
 * "compile window" (so onInit, the dispose listener, the node build and bind groups are all
 * three's own bookkeeping) while a create hook swaps the sync create for an async one and a
 * dispatch guard drops the window's dispatch.
 *
 * GUARD (kept permanently): WebGPUBackend.compute (:1608-1612) calls setPipeline(undefined)
 * for a pipeline whose async create is still pending → WebIDL TypeError → the caller's rAF loop
 * dies. r186 has the same hole, so on the r186 upgrade delete the create hook and keep the guard.
 * RULE: await compileComputeAsync before any ONE-SHOT dispatch (the guard drops dispatches while
 * the pipeline is pending); per-frame simulations simply start a few frames later.
 *
 * Rollback: ?syncComputePipelines=1 (or localStorage serenity.syncComputePipelines=1) installs
 * nothing — exactly today's r185 behaviour.
 * Pinned by tests/unit/three-r185-compute-pipeline-contract.test.js.
 */
import { readFlag } from '../core/flags.js';

const STATE = new WeakMap(); // backend -> state
const TIMEOUT = Symbol('compute-compile-timeout');
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function asyncComputeDisabled() {
    return readFlag('syncComputePipelines', false);
}

/**
 * Synchronous capability check, so callers can keep today's path with no extra awaits.
 * @param {any} renderer
 * @returns {boolean}
 */
export function isAsyncComputeCapable(renderer) {
    if (asyncComputeDisabled()) return false;
    const backend = renderer?.backend;
    const device = backend?.device;
    return !!backend && backend.isWebGPUBackend === true
        && typeof backend.get === 'function'
        && typeof backend.compute === 'function'
        && typeof backend.createComputePipeline === 'function'
        && typeof device?.createComputePipelineAsync === 'function'
        && typeof device.createPipelineLayout === 'function';
}

// Mirrors r185 WebGPUPipelineUtils.createComputePipeline (:380-433), but pops the validation
// scope SYNCHRONOUSLY: createComputePipelineAsync reports its own errors by rejecting, and a
// scope held across an await on the shared intro/warp device would swallow the live loop's errors.
function createAsyncInto(backend, renderer, state, pipeline, bindings) {
    const { device } = backend;
    const stage = pipeline.computeProgram;
    const compute = backend.get(stage).module; // { module, entryPoint: 'main' } (WebGPUBackend.js:2308-2311)
    const pipelineData = backend.get(pipeline);
    const bindGroupLayouts = bindings.map((group) => backend.get(group).layout.layoutGPU);
    const label = `computePipeline_${stage.stage}${stage.name ? `_${stage.name}` : ''}`;
    device.pushErrorScope('validation');
    let created;
    try {
        const layout = device.createPipelineLayout({ bindGroupLayouts });
        created = device.createComputePipelineAsync({ label, layout, compute });
    } catch (error) {
        created = Promise.reject(error);
    }
    const layoutScope = device.popErrorScope(); // always balanced
    return Promise.allSettled([created, layoutScope]).then(([pipelineResult, scopeResult]) => {
        const scopeError = scopeResult.status === 'fulfilled' ? scopeResult.value : scopeResult.reason;
        if (pipelineResult.status === 'fulfilled' && !scopeError) {
            pipelineData.pipeline = pipelineResult.value; // the slot the sync path fills (:417)
            state.created += 1;
            return { label, ok: true };
        }
        pipelineData.error = true; // .pipeline stays undefined → the guard keeps skipping it
        state.failed += 1;
        const pipelineError = pipelineResult.status === 'rejected' ? pipelineResult.reason : null;
        const reason = scopeError?.message || pipelineError?.message || 'unknown';
        if (renderer._isDeviceLost !== true) {
            // eslint-disable-next-line no-console
            console.error(`WebGPURenderer: Async compute pipeline creation failed (${label}): ${reason}`);
        }
        return { label, ok: false, reason };
    });
}

/**
 * Install the dispatch guard (always) and, on r185, the async-capable create hook. Idempotent.
 * @param {any} renderer
 * @returns {null | {collector: Array<Promise<any>>|null, suppressDispatch: boolean, skippedPending: number, created: number, failed: number}}
 */
export function installAsyncComputePipelines(renderer) {
    if (!isAsyncComputeCapable(renderer)) return null;
    const { backend } = renderer;
    const existing = STATE.get(backend);
    if (existing) return existing;
    const state = {
        collector: null, suppressDispatch: false, skippedPending: 0, created: 0, failed: 0,
    };

    const baseCompute = backend.compute;
    backend.compute = function computeUnlessPending(group, node, bindings, pipeline, dispatchSize = null) {
        if (state.suppressDispatch) return undefined; // compile window: never dispatch
        const gpuPipeline = this.get(pipeline).pipeline; // the same read as WebGPUBackend.js:1608
        if (gpuPipeline === undefined || gpuPipeline === null) {
            state.skippedPending += 1; // pending (or failed) async create
            return undefined;
        }
        return baseCompute.call(this, group, node, bindings, pipeline, dispatchSize);
    };

    if (typeof renderer.compileComputeAsync !== 'function') { // r185 only
        const baseCreate = backend.createComputePipeline;
        backend.createComputePipeline = function createMaybeAsync(pipeline, bindings) {
            if (state.collector === null) return baseCreate.call(this, pipeline, bindings); // exact r185 path
            state.collector.push(createAsyncInto(this, renderer, state, pipeline, bindings));
            return undefined;
        };
    }
    STATE.set(backend, state);
    return state;
}

function withBudget(promise, ms) {
    if (!(ms > 0)) return promise;
    let id = null;
    const timer = new Promise((resolve) => { id = setTimeout(() => resolve(TIMEOUT), ms); });
    return Promise.race([promise, timer]).finally(() => clearTimeout(id));
}

/**
 * Create the compute pipelines for `computeNodes` on Dawn's async workers. With an initialized
 * renderer the compile window (TSL build, bind groups, createShaderModule, async create kick-off)
 * runs SYNCHRONOUSLY inside this call, so a caller can start compileAsync right after and both
 * compile concurrently. A TSL build that throws rejects the returned promise.
 * @param {any} renderer
 * @param {any} computeNodes
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{status: 'ready'|'failed'|'timeout'|'unsupported'|'disabled'|'device-lost', created: number, failed: number, results: Array<any>, ms: number, skippedPending?: number}>}
 */
export async function compileComputeAsync(renderer, computeNodes, { timeoutMs = 0 } = {}) {
    const startedAt = nowMs();
    const list = (Array.isArray(computeNodes) ? computeNodes : [computeNodes]).filter((n) => n?.isComputeNode === true);
    const done = (status, extra = {}) => ({
        status, created: 0, failed: 0, results: [], ms: Math.round(nowMs() - startedAt), ...extra,
    });
    if (list.length === 0) return done('ready');
    if (asyncComputeDisabled()) return done('disabled');
    if (renderer?.initialized === false) await renderer.init();
    if (renderer?._isDeviceLost === true) return done('device-lost');
    const state = installAsyncComputePipelines(renderer);
    if (state === null) return done('unsupported');
    let work;
    if (typeof renderer.compileComputeAsync === 'function') { // r186+: native path, guard only
        work = renderer.compileComputeAsync(list).then(() => list.map(() => ({ ok: true })));
    } else {
        const pending = [];
        state.collector = pending;
        state.suppressDispatch = true;
        try {
            renderer.compute(list); // real r185 bookkeeping; the guard drops the dispatch
        } finally {
            state.collector = null;
            state.suppressDispatch = false;
        }
        work = Promise.all(pending);
    }
    const results = await withBudget(work, timeoutMs);
    if (results === TIMEOUT) return done('timeout', { skippedPending: state.skippedPending });
    const failed = results.filter((r) => !r.ok).length;
    return done(failed > 0 ? 'failed' : 'ready', {
        created: results.length - failed, failed, results, skippedPending: state.skippedPending,
    });
}

/**
 * @param {any} renderer
 * @returns {null | {skippedPending: number, created: number, failed: number}}
 */
export function getAsyncComputeStats(renderer) {
    const state = renderer?.backend ? STATE.get(renderer.backend) : undefined;
    return state ? { skippedPending: state.skippedPending, created: state.created, failed: state.failed } : null;
}
