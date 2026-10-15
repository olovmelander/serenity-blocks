/**
 * The intro renderer: First Light (src/ui/intro-world/) on three's WebGPURenderer.
 *
 * One node world on both backends: WebGPU, and the WebGL2 backend (`forceWebGL`) when WebGPU is
 * missing or fails, so the opening and the menu look the same everywhere. No compute, no
 * scene lights: a handful of pipelines, created asynchronously while the loading screen covers
 * them (ADR-0020, IntroAnimation.beginIntroPipelineSession).
 *
 * Contract with IntroAnimation (kept from the renderer it replaces): init(), update(), setPhase(),
 * setBackgroundMode(), setTitleBounds(), setAudioPulse(), triggerTetrominoBounceAt(),
 * getDevice(), isLost(), setParked(), destroy(), and `renderer`. New: beginOpening(),
 * pulseBegin(), setMenuLayout().
 */

import * as THREE from 'three/webgpu';
import { INTRO_BUDGET_TIERS, INTRO_PHASES, detectIntroBudget } from './intro-visual-config.js';
import { gpuResilience } from '../utils/gpu-context-resilience.js';
import { resolveTargetFps } from '../themes/theme-frame-pacer.js';
import { prefersReducedMotion } from '../themes/shared/reduced-motion.js';
import { IntroWorld, WORLD_TIERS } from './intro-world/intro-world.js';
import { IntroWorldPost, POST_LOOK, WAVES_MAX } from './intro-world/intro-world-post.js';

/** The size a parked renderer keeps (setParked()): enough for every bloom level to stay >= 1 px. */
const PARKED_SIZE = Object.freeze({ width: 64, height: 36 });
/** Seconds after init before the frame rate may lower the budget (the first frames compile). */
const QUALITY_GRACE_SECONDS = 10;

function isWindowsPlatform() {
    if (typeof navigator === 'undefined') return false;
    return /Windows/i.test(navigator.userAgent || '');
}

export default class ThreeJSIntroRendererWebGPU {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{ forceWebGL?: boolean }} [options]
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.forceWebGL = options.forceWebGL === true;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.world = null;
        this.post = null;
        this.performanceLevel = 'HIGH';
        this.quality = { key: 'HIGH' };
        this.isBackgroundMode = false;
        this.phase = INTRO_PHASES.BOOT;
        this.audioPulse = 0;
        this.dynamicQualityEnabled = true;
        this.frameTimes = [];
        this.lastQualityCheck = 0;
        this._deviceLost = false;
        this._resilienceUnsub = null;
        this._parked = false;
        this._destroyed = false;
        this._lastFrameAt = null;
        this._startedAt = 0;
        this._onResize = null;
        this._onPointer = null;
        this._onContextLost = null;
    }

    async init() {
        if (!this.canvas) return false;
        try {
            this.performanceLevel = this.detectInitialQuality();
            this.quality = { key: this.performanceLevel };
            const options = {
                canvas: this.canvas,
                alpha: false,
                antialias: false,
                forceWebGL: this.forceWebGL,
            };
            // Chromium on Windows warns that powerPreference is ignored for requestAdapter().
            if (!isWindowsPlatform()) options.powerPreference = 'high-performance';
            this.renderer = new THREE.WebGPURenderer(options);
            await this.renderer.init();
            if (this._destroyed) return false;

            if (!this.forceWebGL && !this.renderer.backend?.isWebGPUBackend) {
                // Native WebGPU was asked for and three fell back on its own: let the owner retry
                // on a fresh canvas with the WebGL2 backend (a context type stays bound to a canvas).
                console.warn('[IntroWorld] WebGPU backend not available');
                await this.renderer.dispose();
                this.renderer = null;
                return false;
            }

            if (this.renderer.backend?.isWebGPUBackend) {
                // A TDR surfaces through GPUDevice.lost, never as a synchronous throw: stop drawing
                // on a dead device. The intro OWNS this device (the boot warp reuses it).
                this._resilienceUnsub = gpuResilience.monitorWebGPU(this.renderer.backend.device, {
                    label: 'intro',
                    onDeviceLost: () => { this._deviceLost = true; },
                });
            } else {
                this._onContextLost = () => { this._deviceLost = true; };
                this.canvas.addEventListener('webglcontextlost', this._onContextLost);
            }

            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.setClearColor(0x02030c, 1);
            this.renderer.setPixelRatio(this._renderPixelRatio());
            this.renderer.setSize(window.innerWidth, window.innerHeight);

            this.scene = new THREE.Scene();
            const aspect = window.innerWidth / Math.max(1, window.innerHeight);
            this.camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 1200);
            this.world = new IntroWorld({ quality: this.tierName() }).build(this.scene);
            this.world.bindCamera(this.camera);
            this.world.setReducedMotion(prefersReducedMotion(), true);
            this.buildPost();
            this.syncViewport();
            this.world.seek(0, { opening: null, menu: 0 });

            this._onResize = () => this.onResize();
            window.addEventListener('resize', this._onResize);
            this._onPointer = (event) => this.onPointer(event);
            window.addEventListener('pointermove', this._onPointer, { passive: true });
            this._startedAt = performance.now();

            const backend = this.renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
            console.log(`[IntroWorld] Initialized First Light (${this.tierName()}, ${backend})`);
            return true;
        } catch (error) {
            console.error('[IntroWorld] Initialization failed:', error);
            return false;
        }
    }

    tierName() {
        return INTRO_BUDGET_TIERS[this.performanceLevel] || 'High';
    }

    /** The post stack for the current budget; a pass-through if it cannot be built. */
    buildPost() {
        this.post?.dispose();
        this.post = null;
        const look = POST_LOOK[WORLD_TIERS[this.tierName()].post] || POST_LOOK.High;
        try {
            this.post = new IntroWorldPost(this.renderer, this.scene, this.camera, { look });
        } catch (error) {
            console.warn('[IntroWorld] Post stack failed; drawing the scene directly:', error);
            this.post = null;
        }
    }

    detectInitialQuality() {
        return detectIntroBudget({
            deviceMemory: navigator.deviceMemory || 8,
            hardwareConcurrency: navigator.hardwareConcurrency || 8,
            screenPixels: window.innerWidth * window.innerHeight,
        });
    }

    /**
     * The live GPUDevice backing this renderer, or null (WebGL2 backend / not inited). Shared with
     * the boot warp so it doesn't create a third WebGPU context.
     * @returns {GPUDevice|null}
     */
    getDevice() {
        return this.renderer?.backend?.isWebGPUBackend ? (this.renderer.backend.device || null) : null;
    }

    /** True once the device (or the WebGL context) is lost: a parked renderer is rebuilt. */
    isLost() {
        return this._deviceLost === true;
    }

    /** Kept for the old profile API: First Light has one look. */
    setVisualProfile() {}

    setPerformanceBudget(level = 'HIGH') {
        const next = ['HIGH', 'MEDIUM', 'LOW'].includes(level) ? level : 'HIGH';
        if (next === this.performanceLevel) return;
        this.performanceLevel = next;
        this.quality = { key: next };
        if (!this.renderer) return;
        this.renderer.setPixelRatio(this._renderPixelRatio());
        this.buildPost();
        this.syncViewport();
    }

    /** The wordmark's rect (CSS px): the halo stands behind it and pieces keep clear of it. */
    setTitleBounds(bounds) {
        if (!bounds || !this.world) return;
        this.world.setTitleRect({
            x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        });
    }

    /**
     * The main menu's layout (screen fractions, y down): `avoid` the pieces keep out of (the
     * navigation and the logo), `calm` the light the post softens behind (navigation, card).
     */
    setMenuLayout({ avoid = [], calm = [] } = {}) {
        this.menuLayout = { avoid, calm };
        if (this.isBackgroundMode) this.applyMenuLayout();
    }

    applyMenuLayout() {
        if (!this.world) return;
        const layout = this.isBackgroundMode ? this.menuLayout : null;
        this.world.setAvoidRects(layout?.avoid || []);
        this.world.setCalmRects(layout?.calm || []);
    }

    setAudioPulse(pulse) {
        this.audioPulse = Math.max(0, Math.min(1, pulse || 0));
    }

    setPhase(phase, immediate = false) {
        if (!phase) return;
        this.phase = phase;
        if (!this.world) return;
        if (phase === INTRO_PHASES.MENU_BG) {
            // A return to the menu lands on it at once, the world already open.
            if (immediate && !this.world.opened) this.world.finishOpening();
            this.world.setMode('menu', { immediate });
        } else if (phase !== INTRO_PHASES.DISMISS) {
            this.world.setMode('title', { immediate });
        }
    }

    setBackgroundMode(enabled) {
        this.isBackgroundMode = !!enabled;
        this.applyMenuLayout();
        if (this.isBackgroundMode) this.setPhase(INTRO_PHASES.MENU_BG);
        else if (this.phase === INTRO_PHASES.MENU_BG) this.setPhase(INTRO_PHASES.IDLE);
    }

    /**
     * Open the world: the loading screen has begun to dissolve over it. `durationMs` is that
     * dissolve; `origin` the logo's centre (screen fraction, y down).
     */
    beginOpening(options = {}) {
        this.world?.beginOpening(options);
    }

    /** The player began: a wave of light leaves the title. */
    pulseBegin(origin = null) {
        this.world?.pulseBegin(origin);
    }

    /** A click on a piece spins and lights it. */
    triggerTetrominoBounceAt(clientX, clientY) {
        if (!this.world || !this.canvas) return false;
        const rect = this.canvas.getBoundingClientRect?.();
        if (!rect || !(rect.width > 0 && rect.height > 0)) return false;
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = 1 - ((clientY - rect.top) / rect.height) * 2;
        return this.world.pick(x, y);
    }

    onPointer(event) {
        if (!this.world || event.pointerType === 'touch') return;
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        this.world.setPointer((event.clientX / w) * 2 - 1, 1 - (event.clientY / h) * 2);
    }

    update() {
        if (!this.world || !this.renderer || this._deviceLost || this._parked) return;
        const now = performance.now();
        const dt = this._lastFrameAt === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this._lastFrameAt) / 1000));
        this._lastFrameAt = now;
        this.world.setReducedMotion(prefersReducedMotion());
        this.world.setAudio(this.audioPulse);
        this.world.update(dt);
        this.renderFrame();
        this.trackFrameTime(dt);
    }

    renderFrame() {
        if (this.post) {
            const s = this.world.getPostState();
            this.post.update(s);
            for (let i = 0; i < WAVES_MAX; i++) {
                const w = s.waves[i];
                this.post.setWave(i, w?.x ?? 0.5, w?.y ?? 0.5, w?.radius ?? 0, w?.strength ?? 0);
            }
            this.post.setCalmRects(s.calm);
            this.post.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    trackFrameTime(dt) {
        if (!this.dynamicQualityEnabled || !(dt > 0)) return;
        // The first seconds compile pipelines and the opening is choreographed: judge neither.
        if ((performance.now() - this._startedAt) / 1000 < QUALITY_GRACE_SECONDS) return;
        if (this.world && this.world.opened && this.world.openingProgress() < 1) return;
        this.frameTimes.push(dt);
        if (this.frameTimes.length > 90) this.frameTimes.shift();
        const now = performance.now();
        if (now - this.lastQualityCheck < 2000 || this.frameTimes.length < 40) return;
        this.lastQualityCheck = now;
        const avgFps = 1 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
        // A Target Frame Rate under 60 paces the frames that slowly on purpose: judge against it.
        const targetFps = resolveTargetFps();
        const pace = targetFps > 0 ? Math.min(1, targetFps / 60) : 1;
        if (avgFps < 35 * pace && this.performanceLevel !== 'LOW') {
            this.setPerformanceBudget('LOW');
            this.frameTimes = [];
            console.log('[IntroWorld] Quality reduced to LOW (FPS:', Math.round(avgFps), ')');
        } else if (avgFps < 50 * pace && this.performanceLevel === 'HIGH') {
            this.setPerformanceBudget('MEDIUM');
            this.frameTimes = [];
            console.log('[IntroWorld] Quality reduced to MEDIUM (FPS:', Math.round(avgFps), ')');
        }
    }

    /**
     * Render resolution tracks the display (a HiDPI menu must not be upscaled into a blur), capped
     * per tier.
     */
    _renderPixelRatio() {
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const cap = WORLD_TIERS[this.tierName()]?.dprCap ?? 2;
        return Math.min(dpr, cap);
    }

    syncViewport() {
        if (!this.renderer || !this.world) return;
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        this.world.setViewport(w, h);
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.post?.setSize(w, h, size.x, size.y);
    }

    onResize() {
        if (!this.camera || !this.renderer || this._parked) return;
        this.renderer.setPixelRatio(this._renderPixelRatio());
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.syncViewport();
    }

    /**
     * Parked behind a game mode (IntroAnimation.parkRenderer()): draw one frame at a token size, so
     * the canvas and every screen-sized target in the post chain shrink to almost nothing while
     * the device and pipelines stay. Unparked, it is sized to the window again.
     * @param {boolean} parked
     */
    setParked(parked) {
        if (!this.renderer || !this.camera) return;
        this._parked = parked;
        if (!parked) {
            this._lastFrameAt = null;
            this.onResize();
            return;
        }
        this.renderer.setSize(PARKED_SIZE.width, PARKED_SIZE.height, false);
        this.post?.setSize(PARKED_SIZE.width, PARKED_SIZE.height);
        if (this._deviceLost) return;
        try {
            this.renderFrame();
        } catch (error) {
            console.warn('[IntroWorld] Parked frame failed:', error);
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._onResize) window.removeEventListener('resize', this._onResize);
        if (this._onPointer) window.removeEventListener('pointermove', this._onPointer);
        if (this._onContextLost) this.canvas?.removeEventListener('webglcontextlost', this._onContextLost);
        this._onResize = null;
        this._onPointer = null;
        this._onContextLost = null;
        this.post?.dispose();
        this.post = null;
        this.world?.dispose();
        this.world = null;
        if (this.scene) {
            this.scene.clear();
            this.scene = null;
        }
        try { this._resilienceUnsub?.(); } catch { /* noop */ } finally { this._resilienceUnsub = null; }
        if (this.renderer) {
            // r186 returns a promise; visible cleanup remains synchronous.
            Promise.resolve(this.renderer.dispose()).catch((error) => {
                console.warn('[IntroWorld] Renderer disposal failed:', error);
            });
            this.renderer = null;
        }
        this.camera = null;
        this.frameTimes = [];
    }
}
