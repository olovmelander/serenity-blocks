/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Boot Warp Transition — the studio-ident → intro reveal renderer.
 *
 * A self-contained, PRE-WARMED WebGPU renderer that plays the game-ident diamond ->
 * restrained warp flight -> nebula-arrival transition on its own full-screen canvas
 * (opaque near-black, z between the intro canvas and the game-ident shell). The heavy
 * TSL→WGSL compile is done up-front in `prewarm()` while the ident still covers the
 * screen, so `play()` is pure GPU work with no first-frame hitch.
 *
 * Boot handoff (src/main.js):
 *   1. ident held ≥4s
 *   2. `await warp.prewarm()`            (compile masked by the ident)
 *   3. `introAnimation.show()`           (intro warms behind the opaque warp canvas)
 *   4. quick-fade the ident              → reveals the warp's diamond beneath
 *   5. `await warp.play()`               → the dive (intro is rendering behind)
 *   6. `await warp.fadeOut()`            → crossfades to the live intro
 *   7. `warp.dispose()`
 *
 * Requires a real WebGPU backend (compute). `BootWarpTransition.isSupported()`
 * gates it; callers fall back to the CSS reveal when unsupported / reduced-motion.
 *
 * The particle scene itself lives in the shared builder (boot-warp-transition-scene.js)
 * so it stays pixel-identical to the playground iteration harness.
 */
import * as THREE from 'three/webgpu';
import { createWarpParticles } from './boot-warp-transition-scene.js';
import { markStartup } from './startup-debug.js';
import { gpuResilience } from '../utils/gpu-context-resilience.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import {
    BOOT_WARP_DEFAULT_DURATION_MS,
    BOOT_WARP_FADE_PROGRESS,
    BOOT_WARP_REVEAL_PROGRESS,
    BOOT_WARP_TITLE_PROGRESS,
} from './boot-warp-startup.js';

const CANVAS_ID = 'boot-warp-canvas';
let nextTransitionId = 1;

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function elapsedSince(startedAt) {
    return Math.round((nowMs() - startedAt) * 10) / 10;
}

/**
 * Whether the WebGPU particle reveal can run here.
 * @param {URLSearchParams} [params]
 * @returns {boolean}
 */
export function isBootWarpSupported(params) {
    try {
        const p = params || (typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search) : new URLSearchParams());
        if (p.get('noBootWarp') === '1' || p.get('forceWebGL') === '1') return false;
        if (typeof navigator === 'undefined' || !navigator.gpu) return false;
        if (typeof window !== 'undefined' && window.matchMedia) {
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        }
        return true;
    } catch {
        return false;
    }
}

export class BootWarpTransition {
    /**
     * @param {object} [opts]
     * @param {number} [opts.count]   particle count (default 48000)
     * @param {number} [opts.zIndex]  canvas stacking (default 15000 — between intro & shell)
     */
    constructor(opts = {}) {
        this.debugId = nextTransitionId;
        nextTransitionId += 1;
        this.count = opts.count || 48000;
        this.zIndex = opts.zIndex ?? 15000;
        // Optional shared GPUDevice (the intro's). When set, the warp reuses it instead of
        // creating its OWN WebGPU device — so with a warmed heavy theme it's theme-device +
        // shared-intro/warp-device = 2 contexts (the count that already works), not 3 (blank).
        this.sharedDevice = opts.device || null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.warp = null;
        this.canvas = null;
        this._raf = 0;
        this._ready = false;
        this._disposed = false;
        this._playing = false;
        this._playResolve = null;
        this._playState = null;
        // Set true if the GPU device is lost mid-transition (a TDR on a fragile
        // iGPU). The play loop bails on it so the caller falls back to the CSS reveal.
        this._deviceLost = false;
        this._resilienceUnsub = null;
        this._eventBusUnsub = null;
        this._monitoredDevice = null;
        this.lastPrewarmStatus = null;
        markStartup('boot-warp:constructed', {
            id: this.debugId,
            count: this.count,
            sharedDevice: Boolean(this.sharedDevice),
        });
    }

    static isSupported(params) { return isBootWarpSupported(params); }

    /**
     * Create the renderer + scene and compile the pipeline (renders one hidden
     * frame at progress 0). Resolves only once the pipeline is ready.
     * @returns {Promise<boolean>} true if a WebGPU renderer is live and primed
     */
    async prewarm(options = {}) {
        if (this._disposed) return false;
        const timeoutMs = Math.max(1, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 6500);
        const startedAt = nowMs();
        let timeoutId = null;
        let timedOut = false;
        markStartup('boot-warp:prewarm-start', {
            id: this.debugId,
            timeoutMs,
            sharedDevice: Boolean(this.sharedDevice),
        });
        const prewarmPromise = this._prewarmInternal().catch((error) => {
            this.lastPrewarmStatus = 'prewarm-exception';
            markStartup('boot-warp:prewarm-exception', {
                id: this.debugId,
                durationMs: elapsedSince(startedAt),
                message: error?.message || String(error),
            }, { level: 'warn' });
            console.warn('[BootWarp] prewarm failed:', error?.message || error);
            this.dispose();
            return false;
        });

        const result = await Promise.race([
            prewarmPromise,
            new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    resolve(false);
                }, timeoutMs);
            }),
        ]);

        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }

        if (timedOut) {
            this.lastPrewarmStatus = 'prewarm-timeout';
            markStartup('boot-warp:prewarm-timeout', {
                id: this.debugId,
                timeoutMs,
                durationMs: elapsedSince(startedAt),
            }, { level: 'warn' });
            console.warn(`[BootWarp] prewarm exceeded ${timeoutMs}ms - falling back to CSS reveal`);
            this.dispose();
            prewarmPromise
                .then(() => { try { this.dispose(); } catch { /* late cleanup */ } })
                .catch(() => { /* failed anyway - nothing live to clean */ });
            return false;
        }

        markStartup('boot-warp:prewarm-complete', {
            id: this.debugId,
            ok: Boolean(result),
            status: this.lastPrewarmStatus,
            durationMs: elapsedSince(startedAt),
        });
        return Boolean(result);
    }

    async _prewarmInternal() {
        if (this._disposed) return false;
        const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
        const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
        const aspect = w / h;

        const rendererParams = {
            antialias: false,
            alpha: false,
            powerPreference: 'high-performance',
        };
        if (this.sharedDevice) {
            // three.js skips requestAdapter/requestDevice when a device is passed — the warp
            // then shares the intro's device (no 3rd context). dispose() does NOT destroy the
            // shared device (three r181 WebGPUBackend.dispose leaves it), so the intro survives.
            rendererParams.device = this.sharedDevice;
        }
        markStartup('boot-warp:init-start', {
            id: this.debugId,
            width: w,
            height: h,
            sharedDevice: Boolean(this.sharedDevice),
        });
        const renderer = new THREE.WebGPURenderer(rendererParams);
        this.renderer = renderer;
        try {
            await renderer.init();
            markStartup('boot-warp:init-complete', {
                id: this.debugId,
                isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
                isWebGLBackend: renderer.backend?.isWebGLBackend === true,
            });
        } catch (error) {
            this.lastPrewarmStatus = 'webgpu-init-failed';
            markStartup('boot-warp:init-failed', {
                id: this.debugId,
                message: error?.message || String(error),
            }, { level: 'warn' });
            try { renderer.dispose(); } catch { /* partial init */ }
            if (this.renderer === renderer) this.renderer = null;
            return false;
        }
        if (this._disposed) {
            markStartup('boot-warp:init-late-after-dispose', { id: this.debugId }, { level: 'warn' });
            try { renderer.dispose(); } catch { /* late timeout cleanup */ }
            if (this.renderer === renderer) this.renderer = null;
            return false;
        }
        // If the backend fell back to WebGL2 there's no compute — bail so the caller uses
        // the CSS reveal instead of a broken/blank warp.
        if (renderer.backend?.isWebGPUBackend !== true) {
            this.lastPrewarmStatus = 'webgpu-backend-unavailable';
            markStartup('boot-warp:backend-unavailable', {
                id: this.debugId,
                isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
                isWebGLBackend: renderer.backend?.isWebGLBackend === true,
            }, { level: 'warn' });
            renderer.dispose?.();
            if (this.renderer === renderer) this.renderer = null;
            return false;
        }

        // Detect a mid-boot GPU device loss / uncaptured error. A TDR on the fragile
        // iGPU surfaces asynchronously via GPUDevice.lost — never as a sync throw the
        // render loop's try/catch could catch — so without this a lost device would
        // silently blank the screen. On loss we flag the loop to bail to the CSS
        // reveal. monitorWebGPU() safely no-ops if the device can't be read, and it
        // dedupes so sharing the intro's device with the intro monitor is harmless.
        const device = this.sharedDevice
            || (renderer.backend?.isWebGPUBackend ? renderer.backend.device : null);
        this._monitoredDevice = device;
        const onLost = () => {
            if (this._deviceLost) return;
            this._deviceLost = true;
            markStartup('boot-warp:device-lost', { id: this.debugId }, { level: 'error' });
        };
        // Ensure the device is monitored (broadcasts CONTEXT_LOST). If the intro
        // already registered the shared device, monitorWebGPU() dedupes to a no-op
        // and this onDeviceLost won't fire — so we ALSO subscribe to the broadcast
        // below, which reaches us regardless of who registered the device.
        this._resilienceUnsub = gpuResilience.monitorWebGPU(device, {
            label: 'boot-warp',
            onDeviceLost: onLost,
        });
        this._eventBusUnsub = eventBus.on(EVENTS.CONTEXT_LOST, (payload) => {
            if (payload?.type === 'webgpu' && payload.device === this._monitoredDevice) {
                onLost();
            }
        });

        // Everything past init is exception-guarded: once the opaque canvas is appended,
        // an uncaught throw (TSL codegen, renderAsync rejection on device loss) would
        // otherwise leave a permanent full-screen black layer over the intro AND the
        // menu — the caller's catch can't reach `candidate` to dispose it.
        try {
            renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5));
            renderer.setSize(w, h, false);
            renderer.setClearColor(0x02040b, 1);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 0.9;
            renderer.outputColorSpace = THREE.SRGBColorSpace;

            const canvas = renderer.domElement;
            canvas.id = CANVAS_ID;
            canvas.style.cssText = `position:fixed;inset:0;width:100%;height:100%;z-index:${this.zIndex};`
                + 'pointer-events:none;background:#02040b;opacity:1;';
            if (typeof document !== 'undefined') document.body.appendChild(canvas);
            this.canvas = canvas;
            markStartup('boot-warp:canvas-appended', {
                id: this.debugId,
                zIndex: this.zIndex,
                width: canvas.width,
                height: canvas.height,
            });

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
            camera.position.set(0, 0, 7);
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
            this.scene = scene;
            this.camera = camera;

            const warp = createWarpParticles({
                count: this.count,
                aspect,
                viewportHeight: h,
                compute: typeof renderer.compute === 'function',
            });
            if (!warp.computeNode) { // WebGL2 fallback slipped through — no compute, bail
                this.lastPrewarmStatus = 'compute-unavailable';
                markStartup('boot-warp:compute-unavailable', { id: this.debugId }, { level: 'warn' });
                warp.dispose();
                this.dispose();
                return false;
            }
            warp.setAspect(aspect);
            warp.setViewProj(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
            scene.add(warp.mesh);
            this.warp = warp;
            markStartup('boot-warp:particles-created', {
                id: this.debugId,
                count: this.count,
                hasComputeNode: Boolean(warp.computeNode),
            });

            // Prime: dispatch compute + render one frame at progress 0 so the pipeline
            // compiles NOW (masked by the ident), not at the first play() frame.
            warp.setProgress(0);
            warp.setTime(0);
            markStartup('boot-warp:prime-compute-start', { id: this.debugId });
            renderer.compute(warp.computeNode);
            markStartup('boot-warp:prime-render-start', { id: this.debugId });
            renderer.render(scene, camera);
            markStartup('boot-warp:prime-render-complete', { id: this.debugId });
            if (this._disposed) {
                markStartup('boot-warp:prime-late-after-dispose', { id: this.debugId }, { level: 'warn' });
                return false;
            }
        } catch (err) {
            this.lastPrewarmStatus = 'setup-failed';
            markStartup('boot-warp:setup-failed', {
                id: this.debugId,
                message: err?.message || String(err),
            }, { level: 'warn' });
            console.warn('[BootWarp] prewarm failed after setup — cleaning up:', err?.message || err);
            this.dispose();
            return false;
        }

        this.lastPrewarmStatus = 'ready';
        this._ready = true;
        markStartup('boot-warp:ready', { id: this.debugId });
        return true;
    }

    /**
     * Play the transition, driving progress 0→1 over `durationMs`.
     * @param {object} [opts]
     * @param {number} [opts.durationMs] default BOOT_WARP_DEFAULT_DURATION_MS
     * @param {(p:number, state:object)=>void} [opts.onProgress]
     * @returns {Promise<object>}
     */
    play(opts = {}) {
        const durationMs = Math.max(600, opts.durationMs || BOOT_WARP_DEFAULT_DURATION_MS);
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
        if (!this._ready || this._disposed || !this.warp) {
            return Promise.resolve({
                status: 'not-ready',
                firstFrameRendered: false,
                durationMs,
                elapsedMs: 0,
                progress: 0,
            });
        }

        this._playing = true;
        markStartup('boot-warp:play-start', {
            id: this.debugId,
            durationMs,
        });
        const progressMarks = {
            revealShell: false,
            fadeOverlap: false,
            titleReveal: false,
        };
        let start = null;
        let firstFrameRendered = false;

        return new Promise((resolve) => {
            this._playResolve = resolve;
            this._playState = {
                firstFrameRendered: false,
                durationMs,
                elapsedMs: 0,
                progress: 0,
            };
            const finish = (result) => {
                if (!this._playResolve) return;
                const activeResolve = this._playResolve;
                this._playResolve = null;
                this._playState = result;
                this._playing = false;
                activeResolve(result);
            };
            const loop = () => {
                const now = (typeof performance !== 'undefined' && performance.now)
                    ? performance.now() : Date.now();
                if (start === null) {
                    start = now;
                }
                const elapsed = now - start;
                const p = Math.min(elapsed / durationMs, 1);
                this._playState = {
                    firstFrameRendered,
                    durationMs,
                    elapsedMs: elapsed,
                    progress: p,
                };

                if (this._disposed) {
                    markStartup('boot-warp:play-disposed', { id: this.debugId }, { level: 'warn' });
                    finish({
                        status: 'disposed',
                        firstFrameRendered,
                        durationMs,
                        elapsedMs: elapsed,
                        progress: p,
                    });
                    return;
                }
                if (this._deviceLost) {
                    // GPU device lost mid-transition — stop rendering on the dead device
                    // and bail. The caller treats any non-complete status as a fall back
                    // to the CSS reveal / static menu, so the screen never stays blank.
                    markStartup('boot-warp:play-device-lost', { id: this.debugId }, { level: 'error' });
                    finish({
                        status: 'device-lost',
                        firstFrameRendered,
                        durationMs,
                        elapsedMs: elapsed,
                        progress: p,
                    });
                    return;
                }
                try {
                    this.warp.setProgress(p);
                    this.warp.setTime(elapsed / 1000);
                    this.renderer.compute(this.warp.computeNode);
                    this.renderer.render(this.scene, this.camera);
                    if (!firstFrameRendered) {
                        firstFrameRendered = true;
                        this._playState.firstFrameRendered = true;
                        markStartup('boot-warp:first-frame', {
                            id: this.debugId,
                            progress: p,
                            elapsedMs: Math.round(elapsed * 10) / 10,
                        });
                    }
                } catch (e) {
                    const status = firstFrameRendered ? 'render-failed' : 'render-failed-before-visible';
                    markStartup('boot-warp:play-render-failed', {
                        id: this.debugId,
                        status,
                        progress: p,
                        message: e?.message || String(e),
                    }, { level: 'error' });
                    // eslint-disable-next-line no-console
                    console.error('[BootWarp] render failed:', e);
                    finish({
                        status,
                        firstFrameRendered,
                        durationMs,
                        elapsedMs: elapsed,
                        progress: p,
                    });
                    return;
                }
                if (!progressMarks.revealShell && p >= BOOT_WARP_REVEAL_PROGRESS) {
                    progressMarks.revealShell = true;
                    markStartup('boot-warp:progress-reveal-shell', { id: this.debugId, progress: p });
                }
                if (!progressMarks.fadeOverlap && p >= BOOT_WARP_FADE_PROGRESS) {
                    progressMarks.fadeOverlap = true;
                    markStartup('boot-warp:progress-fade-overlap', { id: this.debugId, progress: p });
                }
                if (!progressMarks.titleReveal && p >= BOOT_WARP_TITLE_PROGRESS) {
                    progressMarks.titleReveal = true;
                    markStartup('boot-warp:progress-title-reveal', { id: this.debugId, progress: p });
                }
                if (onProgress) {
                    // Guarded: a throw from the caller's progress side-effects (shell
                    // dismiss, title reveal) must not kill this rAF loop with the play()
                    // promise unresolved — that would hang the boot behind the warp.
                    try {
                        onProgress(p, {
                            firstFrameRendered,
                            elapsedMs: elapsed,
                            durationMs,
                        });
                    } catch (progressError) {
                        markStartup('boot-warp:progress-callback-failed', {
                            id: this.debugId,
                            progress: p,
                            message: progressError?.message || String(progressError),
                        }, { level: 'error' });
                        // eslint-disable-next-line no-console
                        console.error('[BootWarp] onProgress failed (playback continues):', progressError);
                    }
                }
                if (p < 1) {
                    this._raf = requestAnimationFrame(loop);
                } else {
                    markStartup('boot-warp:play-complete', { id: this.debugId });
                    finish({
                        status: 'complete',
                        firstFrameRendered,
                        durationMs,
                        elapsedMs: elapsed,
                        progress: p,
                    });
                }
            };
            this._raf = requestAnimationFrame(loop);
        });
    }

    /**
     * Fade the (opaque) warp canvas out to reveal the live intro behind it.
     * @param {number} [ms]
     * @returns {Promise<void>}
     */
    fadeOut(ms = 500) {
        if (!this.canvas || this._disposed) return Promise.resolve();
        markStartup('boot-warp:fade-out-start', {
            id: this.debugId,
            durationMs: ms,
        });
        this.canvas.style.transition = `opacity ${ms}ms ease-out`;
        // Force a style flush before flipping opacity so the transition runs.
        this._flush = this.canvas.offsetWidth;
        this.canvas.style.opacity = '0';
        return new Promise((resolve) => {
            setTimeout(() => {
                markStartup('boot-warp:fade-out-complete', { id: this.debugId });
                resolve();
            }, ms + 30);
        });
    }

    dispose() {
        const hadLiveResources = Boolean(
            this.renderer || this.scene || this.camera || this.warp || this.canvas || this._raf,
        );
        if (hadLiveResources) {
            markStartup('boot-warp:dispose', {
                id: this.debugId,
                ready: this._ready,
                playing: this._playing,
                status: this.lastPrewarmStatus,
            });
        }
        this._disposed = true;
        this._playing = false;
        if (this._playResolve) {
            const activeResolve = this._playResolve;
            this._playResolve = null;
            activeResolve({
                status: 'disposed',
                firstFrameRendered: this._playState?.firstFrameRendered === true,
                durationMs: this._playState?.durationMs || 0,
                elapsedMs: this._playState?.elapsedMs || 0,
                progress: this._playState?.progress || 0,
            });
        }
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        try { this._resilienceUnsub?.(); } catch { /* noop */ } finally { this._resilienceUnsub = null; }
        try { this._eventBusUnsub?.(); } catch { /* noop */ } finally { this._eventBusUnsub = null; }
        this._monitoredDevice = null;
        try { if (this.warp) { this.scene?.remove(this.warp.mesh); this.warp.dispose(); } } catch { /* noop */ }
        try { this.renderer?.dispose(); } catch { /* noop */ }
        try { this.canvas?.remove(); } catch { /* noop */ }
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.warp = null;
        this.canvas = null;
        this._playState = null;
    }
}

export default BootWarpTransition;
