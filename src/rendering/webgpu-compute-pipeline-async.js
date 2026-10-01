// @ts-check
/**
 * Native async compute compilation for three 0.186.1.
 *
 * Boot surfaces compile on Dawn's workers before dispatching. Native compileComputeAsync
 * yields while building nodes, before a pipeline is cached, so a live compute() must also
 * wait during that interval (otherwise it creates the pipeline synchronously). The backend
 * guard covers cached pending/failed pipelines: r186 still calls setPipeline unguarded.
 *
 * A native compile promise resolves even on GPU validation/creation failure. Read the
 * actual pipeline slot before reporting ready. A timeout only stops waiting; both guards
 * remain installed until compilation settles. Await readiness before one-shot dispatches.
 * Pinned by tests/unit/three-r186-compute-pipeline-contract.test.js.
 */
const STATE = new WeakMap(); // backend -> state
const TIMEOUT = Symbol('compute-compile-timeout');
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** @param {any} renderer */
export function isAsyncComputeCapable(renderer) {
    const backend = renderer?.backend;
    return backend?.isWebGPUBackend === true
        && typeof renderer.compileComputeAsync === 'function'
        && typeof renderer.compute === 'function'
        && typeof renderer._pipelines?.has === 'function'
        && typeof renderer._pipelines?.get === 'function'
        && typeof backend.get === 'function'
        && typeof backend.compute === 'function';
}

/** Install guards without replacing native pipeline creation. Idempotent. @param {any} renderer */
export function installAsyncComputePipelines(renderer) {
    if (!isAsyncComputeCapable(renderer)) return null;
    const { backend } = renderer;
    const existing = STATE.get(backend);
    if (existing) return existing;
    const state = {
        pendingNodes: new Map(), skippedPending: 0, created: 0, failed: 0,
    };

    const baseCompute = backend.compute;
    backend.compute = function computeUnlessPending(group, node, bindings, pipeline, dispatchSize = null) {
        const data = this.get(pipeline);
        if (data.error === true || data.pipeline == null) {
            state.skippedPending += 1;
            return undefined;
        }
        return baseCompute.call(this, group, node, bindings, pipeline, dispatchSize);
    };

    const rendererCompute = renderer.compute;
    renderer.compute = function computeUnlessBuilding(nodes, dispatchSize = null) {
        const pending = Array.isArray(nodes)
            ? nodes.some((node) => state.pendingNodes.has(node))
            : state.pendingNodes.has(nodes);
        if (pending) {
            state.skippedPending += 1;
            return undefined;
        }
        return rendererCompute.call(this, nodes, dispatchSize);
    };
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
 * @param {any} renderer
 * @param {any} computeNodes
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{status: 'ready'|'failed'|'timeout'|'unsupported'|'device-lost', created: number, failed: number, results: Array<any>, ms: number, skippedPending?: number}>}
 */
export async function compileComputeAsync(renderer, computeNodes, { timeoutMs = 0 } = {}) {
    const startedAt = nowMs();
    const list = (Array.isArray(computeNodes) ? computeNodes : [computeNodes]).filter((n) => n?.isComputeNode === true);
    const done = (status, extra = {}) => ({
        status, created: 0, failed: 0, results: [], ms: Math.round(nowMs() - startedAt), ...extra,
    });
    if (list.length === 0) return done('ready');
    if (renderer?.initialized === false) await renderer.init();
    if (renderer?._isDeviceLost === true) return done('device-lost');
    const state = installAsyncComputePipelines(renderer);
    if (state === null) return done('unsupported');
    const pipelines = renderer._pipelines;
    // DataMap.get creates an entry. Do not call it for unseen nodes before
    // compilation: native onInit/dispose registration is gated by has().
    const existingPipelines = new Set(list
        .filter((node) => pipelines.has(node))
        .map((node) => pipelines.get(node).pipeline).filter(Boolean));
    for (const node of list) state.pendingNodes.set(node, (state.pendingNodes.get(node) || 0) + 1);
    const work = (async () => {
        try {
            await renderer.compileComputeAsync(list);
            const checked = new Set();
            const results = [];
            for (const node of list) {
                const pipeline = pipelines.has(node) ? pipelines.get(node).pipeline : null;
                if (pipeline && checked.has(pipeline)) continue;
                if (pipeline) checked.add(pipeline);
                const data = pipeline ? renderer.backend.get(pipeline) : null;
                const ok = data?.pipeline != null && data.error !== true;
                if (ok && existingPipelines.has(pipeline)) continue;
                results.push({ ok });
                if (ok) state.created += 1;
                else state.failed += 1;
            }
            return results;
        } finally {
            for (const node of list) {
                const remaining = state.pendingNodes.get(node) - 1;
                if (remaining > 0) state.pendingNodes.set(node, remaining);
                else state.pendingNodes.delete(node);
            }
        }
    })();
    const results = await withBudget(work, timeoutMs);
    if (results === TIMEOUT) return done('timeout', { skippedPending: state.skippedPending });
    const failed = results.filter((r) => !r.ok).length;
    return done(failed > 0 ? 'failed' : 'ready', {
        created: results.length - failed, failed, results, skippedPending: state.skippedPending,
    });
}

/** @param {any} renderer */
export function getAsyncComputeStats(renderer) {
    const state = renderer?.backend ? STATE.get(renderer.backend) : undefined;
    return state ? { skippedPending: state.skippedPending, created: state.created, failed: state.failed } : null;
}
