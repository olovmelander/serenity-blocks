/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The breathing guide's own renderer: three r186 WebGPURenderer on WebGPU, on its WebGL2
 * backend where WebGPU is missing or fails to start (the same ladder the themes climb down).
 *
 * Renderer kind (ADR-0008): WebGPU-primary node scene with the WebGL2 compatibility backend.
 * The stage owns only the canvas, the device and the frame loop; BreathWorldHost owns the scene,
 * so the playground runs exactly the artwork that ships.
 *
 * A world swap is a blink: the canvas dips to dark, the next world's pipelines compile off the
 * compositor thread while nothing is visible, and the canvas returns. Nothing compiles on screen.
 * In a Hale session the next stage's world is built and compiled ahead, while the current one
 * breathes (prepareNext), so its blink is just the dip.
 */
import * as THREE from 'three/webgpu';
import { BreathWorldHost, BREATH_QUALITY, breathPixelRatio } from './breath-world-host.js';
import {
    beginAsyncRenderPipelines, preloadAsyncRenderPipelines,
} from '../../../../rendering/async-render-pipelines.js';

const INIT_TIMEOUT_MS = 6000;
const DIP_MS = 420;
/** Longest wait for a world's pipelines before it is shown anyway (see _settlePipelines). */
const SETTLE_MS = 20000;
/** How long a world has on screen, settled, before the next one is built ahead (prepareNext). */
const PREPARE_AFTER_MS = 2000;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function wantsWebGL() {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const forced = params.has('forceWebGL')
        && ['', '1', 'true', 'yes', 'on'].includes((params.get('forceWebGL') || '').toLowerCase());
    return forced || !globalThis.navigator?.gpu;
}

async function initRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, forceWebGL });
    let timer;
    try {
        await Promise.race([
            renderer.init(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('renderer init timed out')), INIT_TIMEOUT_MS);
            }),
        ]);
    } catch (error) {
        // A failed candidate must not donate its canvas to the retry.
        Promise.resolve(renderer.dispose()).catch(() => {});
        throw error;
    } finally {
        clearTimeout(timer);
    }
    return renderer;
}

export class BreathStage {
    /**
     * @param {HTMLElement} container
     * @param {{quality?: string, onState?: (state: 'ready'|'veiled'|'lost') => void}} [options]
     */
    constructor(container, { quality = 'High', onState = null } = {}) {
        this.container = container;
        this.name = 'breathing';
        this.qualityName = BREATH_QUALITY[quality] ? quality : 'High';
        this.onState = onState;
        this.renderer = null;
        this.host = null;
        this.scene = null;
        this.camera = null;
        this.backend = null;
        this.running = false;
        this.disposed = false;
        this.frameId = null;
        this.lastFrame = null;
        this.worldId = null;
        this.wantedWorld = null;
        this.swapping = null;
        /** The world a session moves to next, built ahead while this one shows (prepareNext). */
        this.nextWorld = null;
        this.preparing = null;
        this.focus = 0.14;
        this.sessionPhase = null;
        this.breath = { breath: 0, phase: 0, progress: 0 };
        this.initPromise = null;
        this._motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
        this._frame = (now) => this._animate(now);
        this._onMotion = (event) => this.host?.setReducedMotion(event.matches);
        this._onVisibility = () => {
            this.lastFrame = null;
            if (document.hidden) this._cancelFrame();
            else this._requestFrame();
        };
    }

    /** Create the renderer once. Rejects when neither backend starts; the guide then stays on CSS. */
    init() {
        if (!this.initPromise) this.initPromise = this._init();
        return this.initPromise;
    }

    async _init() {
        const forceWebGL = wantsWebGL();
        let renderer;
        try {
            renderer = await initRenderer(forceWebGL);
        } catch (error) {
            if (forceWebGL) throw error;
            console.warn('[BreathStage] WebGPU unavailable, using the WebGL2 backend:', error?.message || error);
            renderer = await initRenderer(true);
        }
        if (this.disposed) {
            Promise.resolve(renderer.dispose()).catch(() => {});
            throw new Error('stage disposed during init');
        }
        this.renderer = renderer;
        this.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const canvas = renderer.domElement;
        canvas.className = 'breath-guide__canvas';
        canvas.setAttribute('aria-hidden', 'true');
        this.container.appendChild(canvas);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(20, 1, 0.1, 60);
        this.host = new BreathWorldHost({
            renderer, scene: this.scene, camera: this.camera, quality: this.qualityName,
        });
        this.host.setReducedMotion(Boolean(this._motionQuery?.matches));
        this.host.setFocus(this.focus);
        this.host.setSessionPhase(this.sessionPhase);
        this.host.setBreath(this.breath);
        this.resize();
        this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(this.container);
        document.addEventListener('visibilitychange', this._onVisibility);
        this._motionQuery?.addEventListener?.('change', this._onMotion);
        // A lost device cannot be revived in place: fall back to the CSS guide and rebuild next start.
        renderer.backend?.device?.lost?.then(() => {
            if (this.renderer === renderer) this._handleLost();
        });
        canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            this._handleLost();
        });
        // Resolved before the first world mounts, so even that one compiles off the compositor thread.
        if (this.backend === 'webgpu') await preloadAsyncRenderPipelines(() => Promise.resolve(THREE)).catch(() => {});
    }

    _handleLost() {
        if (this.disposed) return;
        this.onState?.('lost');
        this.dispose();
    }

    async start() {
        this.running = true;
        await this.init();
        if (this.disposed || !this.running) return;
        if (this.wantedWorld && this.wantedWorld !== this.worldId) {
            await this._swap();
        } else if (this.worldId && !this.swapping) {
            // Started again on the world it already shows (a parked stage, a return from over the
            // theme): nothing compiles, but the guide hid the canvas when it stopped. Without this
            // the world drew every frame behind an invisible canvas and only the CSS orb showed.
            this._draw(0);
            this.onState?.('ready');
        }
        this.lastFrame = null;
        this._requestFrame();
    }

    /**
     * Get a world ready before the guide opens (a session's countdown): start the renderer and
     * compile the world's pipelines behind the hidden canvas, with no frame loop. start() then
     * opens on it at once. On the WebGL2 backend only the renderer starts: its shaders compile
     * synchronously and would stall what is on screen meanwhile.
     * @param {string} id
     */
    async prepare(id) {
        this.wantedWorld = id;
        await this.init();
        // A start() since then owns the swap.
        if (this.disposed || this.running || this.backend !== 'webgpu') return;
        if (this.wantedWorld !== this.worldId) await this._swap();
    }

    /**
     * Build the world a session moves to next while the current one stays on screen, and compile
     * it on the driver's workers (BreathWorldHost.prepareWorld, compilePrepared): the stage change
     * then adopts it instead of building and compiling behind the dip, and the world comes back
     * as soon as the dip ends. It starts once the world on screen has settled, and a moment more.
     * WebGPU only: the WebGL2 backend compiles synchronously, which would stall what is on screen.
     * null drops what was built ahead: at once, or, while a stage change is under way, once it is
     * done. A session's last stage asks for nothing next in the same moment as it asks for its own
     * world, whose swap adopts what was built ahead only after the dip: dropped at once, that
     * world was built and compiled again behind the dip (docs/BREATHING_PERF_PASS_2026-10.md,
     * "Stage changes on hardware").
     * @param {string|null} id
     */
    prepareNext(id) {
        this.nextWorld = id || null;
        if (!this.nextWorld) {
            // Still nothing wanted next once the change is done: drop whatever was not adopted.
            const drop = () => { if (!this.nextWorld) this.host?.discardPrepared(); };
            if (this.swapping) this.swapping.then(drop, drop);
            else drop();
            return Promise.resolve();
        }
        if (!this.preparing) this.preparing = this._prepareNext().finally(() => { this.preparing = null; });
        return this.preparing;
    }

    async _prepareNext() {
        await this.init();
        // Each turn serves the latest request; one made meanwhile takes another turn.
        for (;;) {
            if (this.disposed || !this.host || this.backend !== 'webgpu' || !this.nextWorld) return;
            // A swap settles only when no pipeline is pending: let the world on screen come first.
            if (this.swapping) {
                // eslint-disable-next-line no-await-in-loop
                await this.swapping;
                continue;
            }
            const id = this.nextWorld;
            // eslint-disable-next-line no-await-in-loop
            await wait(PREPARE_AFTER_MS);
            if (this.disposed || !this.host) return;
            if (this.swapping || id !== this.nextWorld) continue;
            // A tier that cannot compile ahead (no scene pass) builds nothing ahead either.
            if (!this.host.compilesAhead) return;
            this.host.prepareWorld(id);
            // eslint-disable-next-line no-await-in-loop
            await this.host.compilePrepared();
            if (id === this.nextWorld) return;
        }
    }

    stop() {
        this.running = false;
        this.lastFrame = null;
        this._cancelFrame();
    }

    /** Show a world. Resolves once it is on screen (or the request was superseded). */
    setWorld(id) {
        this.wantedWorld = id;
        if (!this.host || !this.running) return Promise.resolve();
        return this._swap();
    }

    _swap() {
        if (!this.swapping) {
            this.swapping = this._runSwap().finally(() => { this.swapping = null; });
        }
        return this.swapping;
    }

    async _runSwap() {
        while (!this.disposed && this.host && this.wantedWorld !== this.worldId) {
            const target = this.wantedWorld;
            this.onState?.('veiled');
            // eslint-disable-next-line no-await-in-loop
            if (this.worldId) await wait(DIP_MS);
            if (this.disposed || !this.host) return;
            this.worldId = this.host.setWorld(target);
            if (target !== this.worldId) this.wantedWorld = this.worldId;
            // eslint-disable-next-line no-await-in-loop
            await this._settlePipelines();
        }
        if (!this.disposed && this.host) this.onState?.('ready');
    }

    /**
     * Draw hidden frames until the new world's pipelines exist, without blocking the compositor.
     * The wait is generous: until it ends the guide keeps its CSS orb, words and timing, which is
     * far better than unveiling a canvas whose pipelines are still compiling (their draws are
     * skipped, so it shows black). A heavy world's shaders can take seconds on some drivers.
     */
    async _settlePipelines() {
        const session = this.backend === 'webgpu' ? beginAsyncRenderPipelines(this, { label: 'breathing' }) : null;
        try {
            this._draw(0);
            if (session) await session.settle({ maxMs: SETTLE_MS, quietFrames: 3 });
            else await wait(32);
        } finally {
            session?.end();
        }
        if (!this.disposed && this.host) this._draw(0);
    }

    setBreath(state) {
        this.breath = state;
        this.host?.setBreath(state);
    }

    setSessionPhase(type) {
        this.sessionPhase = type;
        this.host?.setSessionPhase(type);
    }

    setFocus(focus) {
        if (!Number.isFinite(focus)) return;
        this.focus = focus;
        this.host?.setFocus(focus);
    }

    get quality() { return BREATH_QUALITY[this.qualityName]; }

    resize() {
        if (!this.renderer || !this.host) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return;
        const ratio = breathPixelRatio(this.quality, width, height, window.devicePixelRatio);
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(width, height, false);
        this.host.setSize(width, height, height * ratio);
        if (this.running && this.worldId && !this.swapping) this._draw(0);
    }

    _requestFrame() {
        if (this.running && !this.disposed && this.host && !document.hidden && this.frameId === null) {
            this.frameId = requestAnimationFrame(this._frame);
        }
    }

    _cancelFrame() {
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.frameId = null;
    }

    _animate(now) {
        this.frameId = null;
        if (!this.running || this.disposed || document.hidden) return;
        this._requestFrame();
        const interval = this._motionQuery?.matches ? 1000 / 30 : this.quality.frameInterval;
        if (this.lastFrame !== null && now - this.lastFrame < interval - 0.5) return;
        const delta = this.lastFrame === null ? 1 / 60 : Math.min((now - this.lastFrame) / 1000, 0.1);
        this.lastFrame = now;
        this._draw(delta);
    }

    _draw(delta) {
        if (!this.host || !this.worldId) return;
        try {
            this.host.step(delta);
            this.host.render();
        } catch (error) {
            console.warn('[BreathStage] frame failed:', error?.message || error);
            this._handleLost();
        }
    }

    getDiagnostics() {
        return { backend: this.backend, running: this.running, ...this.host?.getDiagnostics() };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.stop();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        document.removeEventListener('visibilitychange', this._onVisibility);
        this._motionQuery?.removeEventListener?.('change', this._onMotion);
        this.host?.dispose();
        this.host = null;
        const { renderer } = this;
        this.renderer = null;
        if (renderer) {
            renderer.domElement.remove();
            // r186: the device must not be released before disposal settles.
            Promise.resolve(renderer.dispose()).catch((error) => {
                console.warn('[BreathStage] renderer dispose failed:', error?.message || error);
            });
        }
        this.scene = null;
        this.camera = null;
    }
}
