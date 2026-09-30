// @ts-check
/**
 * Loading-surface async render pipelines (three 0.185.1).
 *
 * WHY: a synchronous `device.createRenderPipeline` compiles on the GPU-process main thread, which
 * also draws the display compositor, so every animation on screen — CSS loading screens included
 * — freezes for the whole compile (a heavy pipeline measured 2.9 s on this machine; the same
 * shader through createRenderPipelineAsync kept the worst frame at 61-91 ms).
 *
 * WHAT: while a session is active, a renderer the session OWNS creates the render pipelines its
 * own live renders request with createRenderPipelineAsync. The descriptor is still built
 * synchronously from the LIVE render state (WebGPUPipelineUtils.js:72-261), so render target,
 * MRT, sample count, call depth and two-pass side are correct by construction — no compileAsync,
 * no target bound across a yield, no MRT-null WGSL. A pipeline still in flight only skips that
 * object's draw (Pipelines.isReady, Renderer.js:3725); the surface is hidden or masked meanwhile.
 * Stays synchronous: PMREM / cube bakes (a skipped draw there would bake black — exempt below),
 * the final composite quad drawn to the canvas (isFinalComposite: every post effect that is not
 * its own pass is inlined into it, so a heavy grade/vignette chain is one short sync compile),
 * device-level mipmap/transfer passes, compute pipelines (a theme's live renderer.compute();
 * boot surfaces use webgpu-compute-pipeline-async.js) and shader modules.
 *
 * r185 anchors, pinned by tests/unit/async-render-pipelines-contract.test.js:
 *   Pipelines.js:160, :331-335   the live path passes promises = null
 *   Pipelines.js:380-400         pipeline cached + renderObject.pipeline set, THEN
 *                                backend.createRenderPipeline (its sole caller)
 *   WebGPUPipelineUtils.js:261   null → sync create; :292/:339 async create + push into promises
 *   WebGPUPipelineUtils.js:316   the validation scope is popped only after the compile
 *   Pipelines.js:255-266 + Renderer.js:3725  pending pipeline → draw skipped
 *   WebGPUBackend.js:1909        pipelineData.error → never drawn (see the repair in track())
 *   PMREMGenerator.js:899-916    PMREM targets: isPMREMTexture / 'PMREM.cubeUv' / CubeUV mapping
 *
 * Rollback: ?themeWarmAsync=0 (or localStorage serenity.themeWarmAsync=0).
 */
const CUBE_UV_REFLECTION_MAPPING = 306; // three/src/constants.js
const sessions = new Set();
const inFlightByTheme = new WeakMap();
let patched = null; // { proto, original, wrapped }
let protoPromise = null;
let protoResolved = null;
let preloadGeneration = 0; // bumped by the test reset: a preload still in flight must not land after it
const diagnostics = { unownedSyncDuringSession: 0 };
// Set while one of our wrappers runs: a copy of ours left inside a foreign wrapper chain (see
// uninstallIfIdle) is then a pure pass-through instead of counting every create twice.
let inWrapper = false;

/**
 * Resolve the WebGPUBackend prototype once (the app has usually loaded 'three/webgpu' already).
 * @param {() => Promise<any>} [loader]
 * @returns {Promise<any>}
 */
export function preloadAsyncRenderPipelines(loader = () => import('three/webgpu')) {
    if (!protoPromise) {
        const generation = preloadGeneration;
        protoPromise = Promise.resolve()
            .then(loader)
            .then((m) => {
                const proto = m?.WebGPUBackend?.prototype ?? null;
                if (generation === preloadGeneration) protoResolved = proto;
                return proto;
            })
            .catch(() => {
                if (generation === preloadGeneration) protoResolved = null;
                return null;
            });
    }
    return protoPromise;
}

/**
 * True once the backend prototype has resolved, i.e. a session can start (synchronously).
 * @returns {boolean}
 */
export function isAsyncRenderPipelinesReady() {
    return protoResolved !== null;
}

/**
 * One-shot bake targets must keep synchronous creation: a skipped draw would cache black.
 * @param {any} rt
 * @returns {boolean}
 */
export function isOneShotRenderTarget(rt) {
    if (!rt) return false;
    if (rt.isCubeRenderTarget === true) return true;
    const tex = rt.texture;
    if (!tex) return false;
    if (tex.isPMREMTexture === true || tex.mapping === CUBE_UV_REFLECTION_MAPPING) return true;
    return typeof tex.name === 'string' && tex.name.startsWith('PMREM');
}

/**
 * The full-screen quad a post chain draws to the CANVAS (RenderPipeline's output quad). While it
 * is pending the whole frame is black, and it is requested after every scene object of that
 * frame, so on the async queue it lands last (a heavy theme's composite resolved ~13 s after
 * entry, black until then). It is a tiny shader: create it synchronously so the frame always
 * composites and the scene streams in behind it.
 * @param {any} renderObject
 * @returns {boolean}
 */
export function isFinalComposite(renderObject) {
    return renderObject?.object?.isQuadMesh === true && !renderObject?.context?.renderTarget;
}

/**
 * @param {any} backend
 * @returns {boolean}
 */
export function isAsyncPipelineBackend(backend) {
    return patched !== null && backend != null && Object.prototype.isPrototypeOf.call(patched.proto, backend);
}

function sessionFor(backend) {
    const renderer = backend?.renderer; // Backend.js:91
    if (!renderer) return null;
    // Newest first: a loading surface armed on a theme whose retained prewarm session has not
    // ended yet must see that theme's creates, or it reads "quiet" while they are in flight.
    const list = [...sessions];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].active && list[i].owns(renderer)) return list[i];
    }
    return null;
}

function install(proto) {
    if (patched) return patched.proto === proto;
    const original = proto?.createRenderPipeline;
    if (typeof original !== 'function') return false;
    const wrapped = function serenityAsyncCreateRenderPipeline(renderObject, promises) {
        if (inWrapper || sessions.size === 0) return original.call(this, renderObject, promises ?? null);
        inWrapper = true;
        try {
            return createForSession(this, original, renderObject, promises);
        } finally {
            inWrapper = false;
        }
    };
    proto.createRenderPipeline = wrapped;
    patched = { proto, original, wrapped };
    return true;
}

function createForSession(backend, original, renderObject, promises) {
    const pipelineData = () => (renderObject.pipeline ? backend.get(renderObject.pipeline) : null);
    if (promises != null) {
        // A compileAsync drain is already async: leave it untouched, but COUNT its pipelines
        // for an owned renderer so "quiet" means the theme's own compileAsync work (e.g. a
        // prewarmScene of its whole scene) has landed too, not just the live-path requests.
        const owner = sessionFor(backend);
        const before = promises.length;
        const result = original.call(backend, renderObject, promises);
        if (owner) owner.track(promises.slice(before), pipelineData());
        return result;
    }
    const s = sessionFor(backend);
    if (s === null) {
        diagnostics.unownedSyncDuringSession += 1;
        return original.call(backend, renderObject, null);
    }
    if (isOneShotRenderTarget(renderObject?.context?.renderTarget) || isFinalComposite(renderObject)) {
        s.stats.syncExempt += 1;
        return original.call(backend, renderObject, null);
    }
    const sink = [];
    original.call(backend, renderObject, sink); // → createRenderPipelineAsync, descriptor from live state
    s.track(sink, pipelineData());
    return undefined;
}

function uninstallIfIdle() {
    if (!patched || sessions.size > 0) return;
    // If someone wrapped over us, leave ours in place: with no session it is a pass-through.
    if (patched.proto.createRenderPipeline === patched.wrapped) {
        patched.proto.createRenderPipeline = patched.original;
    }
    patched = null;
}

/**
 * Start a session for `theme` (anything with `name` and `renderer`). Synchronous: returns null
 * unless preloadAsyncRenderPipelines() has resolved, so callers keep their await structure.
 * @param {any} theme
 * @param {{label?: string, backendProto?: any}} [options]
 */
export function beginAsyncRenderPipelines(theme, {
    label = theme?.name ?? 'theme',
    backendProto = protoResolved,
} = {}) {
    if (!theme || !backendProto || !install(backendProto)) return null;
    const stats = {
        async: 0, syncExempt: 0, failed: 0, errorScopeRepaired: 0, maxInFlight: 0,
    };
    const adopted = new WeakSet();
    const engagedListeners = [];
    let lastFrameStamp = null;
    const bump = (d) => {
        const n = Math.max(0, (inFlightByTheme.get(theme) ?? 0) + d);
        inFlightByTheme.set(theme, n);
        theme.asyncPipelinesInFlight = n;
        return n;
    };
    const session = {
        label,
        theme,
        stats,
        active: true,
        frame: 0,
        lastCreateFrame: -1,
        get engaged() { return stats.async > 0; },
        /** Run `fn` once, when this session first creates a pipeline async (now if it has). */
        onEngaged(fn) {
            if (stats.async > 0) queueMicrotask(fn);
            else engagedListeners.push(fn);
        },
        // Shared per theme: a prewarm tail still counts for a later loading session.
        get inFlight() { return inFlightByTheme.get(theme) ?? 0; },
        adopt(r) { if (r) adopted.add(r); },
        owns(r) {
            if (!r) return false;
            if (r === theme.renderer || adopted.has(r)) return true;
            const canvas = r.domElement;
            if (!canvas || typeof document === 'undefined' || !theme.name) return false;
            const container = document.getElementById(`${theme.name}-theme`);
            return Boolean(container && container.contains(canvas));
        },
        track(sink, pipelineData) {
            for (const p of sink) {
                stats.async += 1;
                stats.maxInFlight = Math.max(stats.maxInFlight, bump(1));
                session.lastCreateFrame = session.frame;
                // three's own promise always resolves (finally → resolve), but a compileAsync
                // array can carry other code's promises: a rejection must still land, or the
                // theme reads busy forever.
                Promise.resolve(p).then(() => {
                    bump(-1);
                    if (pipelineData?.error !== true) return;
                    if (pipelineData.pipeline) {
                        // Resolved ⇒ valid: async creation rejects on its OWN validation failure.
                        // The scope held open across the compile caught OTHER GPU work's error;
                        // undo the misattribution, or draw() would hide this object forever.
                        pipelineData.error = false;
                        stats.errorScopeRepaired += 1;
                        // eslint-disable-next-line no-console
                        console.warn(`[async-render-pipelines] ${label}: a validation error from other GPU work `
                            + 'landed in an async pipeline\'s scope; pipeline kept drawable (see the error above).');
                    } else {
                        stats.failed += 1;
                    }
                }, () => {
                    bump(-1);
                    stats.failed += 1;
                });
            }
            if (stats.async > 0 && engagedListeners.length > 0) {
                engagedListeners.splice(0).forEach((fn) => queueMicrotask(fn));
            }
        },
        /**
         * Advance the session's frame clock. Pass the rAF timestamp so concurrent settle()
         * callers (a deferred release overlapping a re-entry) count one frame per frame.
         * @param {number} [stamp]
         */
        noteFrame(stamp) {
            if (stamp !== undefined && stamp === lastFrameStamp) return;
            lastFrameStamp = stamp ?? null;
            session.frame += 1;
        },
        isQuiet(quietFrames = 12) {
            if (session.inFlight > 0) return false;
            const since = session.lastCreateFrame < 0 ? session.frame : session.frame - session.lastCreateFrame;
            return since >= quietFrames;
        },
        async settle({ maxMs: requestedMaxMs = 5000, quietFrames = 6 } = {}) {
            const maxMs = Number.isFinite(requestedMaxMs) ? Math.max(0, requestedMaxMs) : 5000;
            const t0 = performance.now();
            while (session.active && performance.now() - t0 < maxMs) {
                const budget = Math.max(0, maxMs - (performance.now() - t0));
                const hasRaf = typeof requestAnimationFrame === 'function';
                // eslint-disable-next-line no-await-in-loop
                const stamp = await new Promise((r) => {
                    // rAF stops in a hidden/minimised window: the timer keeps the bound real.
                    const timer = setTimeout(() => r(undefined), hasRaf ? Math.ceil(budget) : 16);
                    if (hasRaf) {
                        requestAnimationFrame((ts) => {
                            clearTimeout(timer);
                            r(ts);
                        });
                    }
                });
                // The timer only bounds the wait: it is not a presented frame (with rAF around).
                if (!hasRaf || stamp !== undefined) session.noteFrame(stamp);
                if (session.isQuiet(quietFrames)) return true;
            }
            return !session.active || session.isQuiet(quietFrames);
        },
        end() {
            if (session.active) {
                session.active = false;
                sessions.delete(session);
                uninstallIfIdle();
            }
            return { ...stats, inFlight: session.inFlight };
        },
    };
    sessions.add(session);
    return session;
}

/**
 * Let an active session for `theme` claim a renderer created before `theme.renderer` is set.
 * @param {any} theme
 * @param {any} renderer
 */
export function adoptRendererForTheme(theme, renderer) {
    for (const s of sessions) if (s.active && s.theme === theme) s.adopt(renderer);
}

export function getAsyncRenderPipelineDiagnostics() {
    return { installed: patched !== null, sessions: sessions.size, ...diagnostics };
}

export function resetAsyncRenderPipelinesForTests() {
    for (const s of [...sessions]) s.end();
    if (patched && patched.proto.createRenderPipeline === patched.wrapped) {
        patched.proto.createRenderPipeline = patched.original;
    }
    patched = null;
    protoPromise = null;
    protoResolved = null;
    preloadGeneration += 1;
    diagnostics.unownedSyncDuringSession = 0;
}
