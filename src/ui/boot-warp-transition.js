/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Boot Warp Transition — the studio-ident → intro reveal renderer.
 *
 * A self-contained, PRE-WARMED WebGPU renderer that plays the diamond-mark →
 * hyperspace-dive → nebula-seed particle transition on its own full-screen canvas
 * (opaque black, z between the intro canvas and the studio-ident shell). The heavy
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

const CANVAS_ID = 'boot-warp-canvas';

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
    }

    static isSupported(params) { return isBootWarpSupported(params); }

    /**
     * Create the renderer + scene and compile the pipeline (renders one hidden
     * frame at progress 0). Resolves only once the pipeline is ready.
     * @returns {Promise<boolean>} true if a WebGPU renderer is live and primed
     */
    async prewarm() {
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
        const renderer = new THREE.WebGPURenderer(rendererParams);
        try {
            // Race init against a timeout — a shared-device init is near-instant, but an
            // own-device requestAdapter/requestDevice can stall on a context-limited GPU.
            await Promise.race([
                renderer.init(),
                new Promise((_, reject) => { setTimeout(() => reject(new Error('WebGPU init timeout')), 5000); }),
            ]);
        } catch {
            renderer.dispose?.();
            return false;
        }
        // If the backend fell back to WebGL2 there's no compute — bail so the caller uses
        // the CSS reveal instead of a broken/blank warp.
        if (renderer.backend?.isWebGPUBackend !== true) {
            renderer.dispose?.();
            return false;
        }
        this.renderer = renderer;

        renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5));
        renderer.setSize(w, h, false);
        renderer.setClearColor(0x000000, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const canvas = renderer.domElement;
        canvas.id = CANVAS_ID;
        canvas.style.cssText = `position:fixed;inset:0;width:100%;height:100%;z-index:${this.zIndex};`
            + 'pointer-events:none;background:#000;opacity:1;';
        if (typeof document !== 'undefined') document.body.appendChild(canvas);
        this.canvas = canvas;

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
            warp.dispose();
            return false;
        }
        warp.setAspect(aspect);
        warp.setViewProj(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        scene.add(warp.mesh);
        this.warp = warp;

        // Prime: dispatch compute + render one frame at progress 0 so the pipeline
        // compiles NOW (masked by the ident), not at the first play() frame.
        warp.setProgress(0);
        warp.setTime(0);
        renderer.compute(warp.computeNode);
        await renderer.renderAsync(scene, camera);

        this._ready = true;
        return true;
    }

    /**
     * Play the transition, driving progress 0→1 over `durationMs`.
     * @param {object} [opts]
     * @param {number} [opts.durationMs] default 2600
     * @param {(p:number)=>void} [opts.onProgress]
     * @returns {Promise<void>}
     */
    play(opts = {}) {
        const durationMs = Math.max(600, opts.durationMs || 2600);
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
        if (!this._ready || this._disposed || !this.warp) return Promise.resolve();

        this._playing = true;
        const start = (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();

        return new Promise((resolve) => {
            const loop = () => {
                if (this._disposed) { resolve(); return; }
                const now = (typeof performance !== 'undefined' && performance.now)
                    ? performance.now() : Date.now();
                const elapsed = now - start;
                const p = Math.min(elapsed / durationMs, 1);
                try {
                    this.warp.setProgress(p);
                    this.warp.setTime(elapsed / 1000);
                    this.renderer.compute(this.warp.computeNode);
                    this.renderer.render(this.scene, this.camera);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('[BootWarp] render failed:', e);
                    this._playing = false;
                    resolve();
                    return;
                }
                if (onProgress) onProgress(p);
                if (p < 1) {
                    this._raf = requestAnimationFrame(loop);
                } else {
                    this._playing = false;
                    resolve();
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
        this.canvas.style.transition = `opacity ${ms}ms ease-out`;
        // Force a style flush before flipping opacity so the transition runs.
        this._flush = this.canvas.offsetWidth;
        this.canvas.style.opacity = '0';
        return new Promise((resolve) => { setTimeout(resolve, ms + 30); });
    }

    dispose() {
        this._disposed = true;
        this._playing = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        try { if (this.warp) { this.scene?.remove(this.warp.mesh); this.warp.dispose(); } } catch { /* noop */ }
        try { this.renderer?.dispose(); } catch { /* noop */ }
        try { this.canvas?.remove(); } catch { /* noop */ }
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.warp = null;
        this.canvas = null;
    }
}

export default BootWarpTransition;
