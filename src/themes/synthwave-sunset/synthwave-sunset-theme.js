/**
 * Synthwave Sunset Theme — an outrun sunset: the slit sun setting behind neon-wireframe
 * mountains, a city skyline, palm silhouettes and an endless neon grid.
 *
 * The theme is a thin lifecycle shell. The world (synthwave-sunset-world.js) builds and drives
 * every part and solves the composition — the camera yaws so the sun sits in the free zone beside
 * the gameplay board; with no board on screen it faces the sun. The post stack
 * (synthwave-sunset-post.js) does bloom, the lens streak and the grade.
 *
 * Renderer: ONE node-material path on both WebGPURenderer backends (ADR-0019) — WebGPU where
 * available, its WebGL2 backend otherwise (or with ?forceWebGL=1). No compute, no MRT: every
 * animation is analytic in the vertex/fragment stages, so both backends run identical content.
 *
 * Debug flags (URL): forceWebGL, synthwaveNoPost|noPost, synthwaveNoDRS|noDRS|noDrs,
 * synthwaveFixedDt|fixedDt=<ms>, synthwaveSeed|seed=<n>, synthwaveBaseline|baseline.
 */

import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from './synthwave-sunset-tetrominos.js';
import { RIG } from './synthwave-sunset-tsl.js';
import {
    SynthwaveWorld,
    WORLD_QUALITY,
    boardRectsDiffer,
    readBoardRect,
} from './synthwave-sunset-world.js';
import {
    POST_LOOK,
    SynthwaveSunsetPost,
    createPassThroughPipeline,
} from './synthwave-sunset-post.js';

const LAYOUT_POLL_MS = 1000;
const LAYOUT_DEBOUNCE_MS = 150;

export default class SynthwaveSunsetTheme extends BaseTheme {
    constructor() {
        super('synthwave-sunset');

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.world = null;
        this.postProcessing = null;
        this.passThrough = null;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.flags = this.readFlags();
        this.currentQuality = 'High';

        this.time = 0;
        this.lastFrameTime = null;
        this.isAnimating = false;
        this.loopGeneration = 0;
        this.random = Math.random;

        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;
        this.sunUv = new THREE.Vector2(0.25, 0.5);
        this._sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        this._postParams = {
            time: 0, sun: this.sunUv, sunVis: 0, bloomBoost: 0,
        };

        this.layoutWatch = null;
        this.appliedBoard = undefined;
        this.eventUnsubscribers = [];

        this.dynamicResolution = {
            enabled: true,
            scale: 1.0,
            minScale: 0.7,
            maxScale: 1.0,
            targetMs: 16.6,
            emaMs: 16.6,
            adjustInterval: 0.5,
            elapsed: 0,
        };
        this.baselineFrames = [];
        this.baselineMaxFrames = 600;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Flags + quality
    // ─────────────────────────────────────────────────────────────────────────

    readFlags() {
        const flags = {
            forceWebGL: false, noPost: false, noDrs: false, baseline: false, fixedDtMs: null, seed: null,
        };
        if (typeof window === 'undefined') return flags;
        const params = new URLSearchParams(window.location.search);
        const has = (name) => params.has(name) && params.get(name) !== '0' && params.get(name) !== 'false';
        flags.forceWebGL = has('forceWebGL');
        flags.noPost = has('synthwaveNoPost') || has('noPost');
        flags.noDrs = has('synthwaveNoDRS') || has('noDRS') || has('noDrs');
        flags.baseline = has('synthwaveBaseline') || has('baseline');
        const dt = Number(params.get('synthwaveFixedDt') || params.get('fixedDt'));
        flags.fixedDtMs = Number.isFinite(dt) && dt > 0 ? dt : null;
        if (params.has('synthwaveSeed') || params.has('seed')) {
            const seed = Number(params.get('synthwaveSeed') || params.get('seed'));
            flags.seed = Number.isFinite(seed) ? seed : 1;
        }
        return flags;
    }

    getGraphicsQuality() {
        const quality = typeof window !== 'undefined' ? window.settings?.effectQuality : null;
        return WORLD_QUALITY[quality] ? quality : 'High';
    }

    getTetrominoConfig() {
        return SYNTHWAVE_SUNSET_TETROMINOS;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene
    // ─────────────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById('synthwave-sunset-theme');
        if (!container) {
            throw new Error('[SynthwaveSunset] Container #synthwave-sunset-theme not found');
        }
        container.innerHTML = '';

        this.flags = this.readFlags();
        this.random = Number.isFinite(this.flags.seed) ? this.seededRandom(this.flags.seed) : Math.random;
        this.currentQuality = this.getGraphicsQuality();
        this.time = 0;
        this.lastFrameTime = null;
        this.baselineFrames = [];
        const drs = this.dynamicResolution;
        drs.enabled = !this.flags.noDrs && !this.flags.baseline;
        drs.scale = 1.0;
        drs.emaMs = drs.targetMs;
        drs.elapsed = 0;

        const ready = await this.initRenderer(container, ownerGeneration);
        if (!ready) return;

        this.world = new SynthwaveWorld({
            scene: this.scene,
            quality: this.currentQuality,
            random: () => this.random(),
        }).build();
        this.appliedBoard = readBoardRect();
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        this.world.setLayout(aspect, this.appliedBoard, { immediate: true });
        this.syncCamera();
        this.logLayout('initial');

        this.setupPostProcessing();
        this.resize(window.innerWidth, window.innerHeight);
        this.setupEventListeners();
        if (this.flags.baseline) this.installBaselineHelpers();

        // A parked (pre-warmed) theme owns no live loop or DOM watch; resume() restarts both.
        if (!this.isPaused) {
            this.installLayoutWatch();
            this.animate();
        }
        console.log(`[SynthwaveSunset] Scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'}, ${this.currentQuality})`);
    }

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        // The scene always renders into a pass (MSAA lives there on the showcase tier), so the
        // canvas needs neither depth nor MSAA.
        const makeCandidate = (forceWebGL) => new THREE.WebGPURenderer({
            antialias: false,
            depth: false,
            alpha: false,
            forceWebGL,
        });
        // r185 falls back to WebGL2 by itself when WebGPU rejects; the explicit second candidate
        // covers an adapter request that hangs past the init timeout.
        const backends = this.flags.forceWebGL ? [true] : [false, true];
        let renderer = null;
        let lastError = null;
        for (const forceWebGL of backends) {
            try {
                const candidate = makeCandidate(forceWebGL);
                // eslint-disable-next-line no-await-in-loop
                await this.initializeRendererCandidate(candidate, {
                    label: `Synthwave Sunset ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
                    ownerGeneration,
                });
                renderer = candidate;
                break;
            } catch (error) {
                if (!ownsLifecycle()) return false;
                lastError = error;
                const backend = forceWebGL ? 'WebGL2' : 'WebGPU';
                console.warn(`[SynthwaveSunset] ${backend} renderer init failed:`, error?.message || error);
            }
        }
        if (!renderer) {
            throw new Error('[SynthwaveSunset] Renderer initialization failed.', { cause: lastError });
        }
        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = !this.isWebGPU;
        renderer.setClearColor(0x05030b, 1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setPixelRatio(this.getDynamicPixelRatio());
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        this.camera = new THREE.PerspectiveCamera(SynthwaveWorld.verticalFov(aspect), aspect, RIG.near, RIG.far);
        this.camera.position.set(RIG.x, RIG.height, RIG.z);
        return true;
    }

    setupPostProcessing() {
        this.disposePost();
        if (!this.flags.noPost) {
            try {
                const look = POST_LOOK[this.currentQuality] || POST_LOOK.High;
                this.postProcessing = new SynthwaveSunsetPost(this.renderer, this.scene, this.camera, {
                    look,
                    samples: this.getAntialiasEnabled() ? look.msaa : 0,
                    grain: !this.flags.baseline && this.flags.fixedDtMs === null,
                });
                return;
            } catch (error) {
                console.warn('[SynthwaveSunset] Post stack failed, rendering pass-through:', error?.message || error);
                this.postProcessing = null;
            }
        }
        try {
            // The canvas has no depth buffer, so even the no-post path renders through a pass.
            this.passThrough = createPassThroughPipeline(this.renderer, this.scene, this.camera);
        } catch (error) {
            console.warn('[SynthwaveSunset] Pass-through pipeline failed:', error?.message || error);
            this.passThrough = null;
        }
    }

    disposePost() {
        this.postProcessing?.dispose();
        this.postProcessing = null;
        this.passThrough?.dispose();
        this.passThrough = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Layout: the composition follows the board, read off the frame loop
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Re-read the board rect on resize, on board resizes (ResizeObserver) and on a slow poll
     * (boards appear/disappear with the game mode). The world eases the camera toward the new
     * composition, so a change reads as a slow pan, never a jump.
     */
    installLayoutWatch() {
        this.removeLayoutWatch();
        if (typeof window === 'undefined' || !this.world) return;
        const watch = { debounce: null, interval: null, observer: null };
        this.layoutWatch = watch;
        const commit = () => {
            if (this.layoutWatch !== watch || !this.world || !this.isActive) return;
            const board = readBoardRect();
            if (this.appliedBoard !== undefined && !boardRectsDiffer(board, this.appliedBoard)) return;
            this.appliedBoard = board;
            this.world.setLayout(window.innerWidth / Math.max(1, window.innerHeight), board);
            this.observeBoards(watch);
            this.logLayout('changed');
        };
        watch.schedule = () => {
            if (this.layoutWatch !== watch) return;
            clearTimeout(watch.debounce);
            watch.debounce = setTimeout(commit, LAYOUT_DEBOUNCE_MS);
        };
        if (typeof ResizeObserver === 'function') watch.observer = new ResizeObserver(watch.schedule);
        watch.interval = setInterval(watch.schedule, LAYOUT_POLL_MS);
        this.observeBoards(watch);
        watch.schedule();
    }

    /** One line per composition change: which board rect was read and where the sun lands. */
    logLayout(label) {
        if (!this.world) return;
        const board = this.appliedBoard;
        const sunX = this.world.sunScreenX(this.world.targetYaw).toFixed(3);
        const where = board
            ? `board x ${board.x0.toFixed(3)}–${board.x1.toFixed(3)}, y ${board.y0.toFixed(3)}–${board.y1.toFixed(3)}`
            : 'no board';
        console.log(`[SynthwaveSunset] Layout (${label}): ${where} → sun at x=${sunX}`);
    }

    observeBoards(watch) {
        if (!watch.observer || typeof document === 'undefined') return;
        watch.observer.disconnect();
        document.querySelectorAll('.player-card[data-player]').forEach((el) => watch.observer.observe(el));
    }

    removeLayoutWatch() {
        const watch = this.layoutWatch;
        if (!watch) return;
        this.layoutWatch = null;
        clearTimeout(watch.debounce);
        clearInterval(watch.interval);
        watch.observer?.disconnect();
    }

    pause() {
        const paused = super.pause();
        if (paused) this.removeLayoutWatch();
        return paused;
    }

    resume() {
        const resumed = super.resume();
        if (resumed && this.world) this.installLayoutWatch();
        return resumed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        this.clearEventUnsubscribers();
        const reactive = () => this.isActive && window.settings?.backgroundComboEffects === true;

        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (reactive()) this.world?.onPieceLock(data?.piece);
        });
        const clearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (reactive()) this.world?.onLineClear(data?.lineCount ?? 1);
        });
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (reactive()) this.world?.onCombo(data?.comboCount ?? 0);
        });
        const levelUnsub = eventBus.on(EVENTS.LEVEL_UP, () => {
            if (reactive()) this.world?.onLevelUp();
        });

        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        const onResize = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('resize', onResize);
        this.eventUnsubscribers.push(
            lockUnsub,
            clearUnsub,
            comboUnsub,
            levelUnsub,
            () => window.removeEventListener('pointermove', onPointerMove),
            () => window.removeEventListener('resize', onResize),
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Frame loop
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (this.isAnimating || !this.isActive || !this.renderer) return;
        this.isAnimating = true;
        this.lastFrameTime = null;
        const generation = ++this.loopGeneration;
        let consecutiveErrors = 0;
        const loop = (now) => {
            if (!this.isActive || generation !== this.loopGeneration || !this.renderer) {
                if (generation === this.loopGeneration) this.isAnimating = false;
                return;
            }
            this.registerAnimation(requestAnimationFrame(loop));
            if (!this.shouldRenderFrame()) return;
            try {
                this.stepFrame(now);
                consecutiveErrors = 0;
            } catch (error) {
                consecutiveErrors += 1;
                console.error('[SynthwaveSunset] Frame failed:', error);
                if (consecutiveErrors >= 5) {
                    console.error('[SynthwaveSunset] Too many consecutive frame errors; stopping the loop.');
                    this.loopGeneration += 1;
                    this.isAnimating = false;
                }
            }
        };
        this.registerAnimation(requestAnimationFrame(loop));
    }

    stepFrame(now) {
        if (!this.world || !this.camera) return;
        const t = Number.isFinite(now) ? now : performance.now();
        const wallDelta = this.lastFrameTime === null ? 1 / 60 : Math.max(0, (t - this.lastFrameTime) / 1000);
        this.lastFrameTime = t;
        const delta = this.flags.fixedDtMs !== null ? this.flags.fixedDtMs / 1000 : Math.min(wallDelta, 0.05);
        this.time += delta;

        const k = 1 - Math.exp(-2.2 * delta);
        this.smoothedPointerX += (this.pointerX - this.smoothedPointerX) * k;
        this.smoothedPointerY += (this.pointerY - this.smoothedPointerY) * k;

        const sim = this._sim;
        sim.time = this.time;
        sim.delta = delta;
        sim.pointerX = this.smoothedPointerX;
        sim.pointerY = this.smoothedPointerY;
        this.world.updateCamera(this.camera, sim);
        this.world.update(sim);

        if (this.postProcessing) {
            const pp = this._postParams;
            pp.time = this.time;
            pp.sunVis = this.world.getSunScreen(this.camera, this.sunUv);
            pp.bloomBoost = Math.min(1, this.world.sunPulse);
            this.postProcessing.update(pp);
            this.postProcessing.render();
        } else if (this.passThrough) {
            this.passThrough.render();
        }

        if (this.flags.baseline) this.trackBaseline(wallDelta);
        this.updateDynamicResolution(wallDelta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resolution (DRS: the pixel ratio follows frame time, 0.7–1.0 of the effective ratio)
    // ─────────────────────────────────────────────────────────────────────────

    getDynamicPixelRatio() {
        const scale = this.dynamicResolution.enabled ? this.dynamicResolution.scale : 1.0;
        return Math.max(0.25, Math.round(this.getEffectivePixelRatio() * scale * 100) / 100);
    }

    updateDynamicResolution(deltaSeconds) {
        const drs = this.dynamicResolution;
        if (!drs.enabled || !this.renderer) return;
        drs.emaMs = drs.emaMs * 0.9 + deltaSeconds * 1000 * 0.1;
        drs.elapsed += deltaSeconds;
        if (drs.elapsed < drs.adjustInterval) return;
        drs.elapsed = 0;
        let next = drs.scale;
        if (drs.emaMs > drs.targetMs * 1.12) next = Math.max(drs.minScale, drs.scale - 0.05);
        else if (drs.emaMs < drs.targetMs * 0.85) next = Math.min(drs.maxScale, drs.scale + 0.05);
        if (Math.abs(next - drs.scale) >= 0.01) {
            drs.scale = next;
            this.resize(window.innerWidth, window.innerHeight);
        }
    }

    syncCamera() {
        if (!this.camera || !this.world) return;
        this.camera.fov = this.world.lens.vfov;
        this.camera.aspect = this.world.lens.aspect;
        this.camera.updateProjectionMatrix();
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        this.renderer.setPixelRatio(this.getDynamicPixelRatio());
        this.renderer.setSize(w, h);
        if (this.world) {
            this.world.setLayout(w / h, this.appliedBoard ?? null);
            this.syncCamera();
        }
        const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.postProcessing?.setSize(w, h, buffer.x, buffer.y);
        this.layoutWatch?.schedule?.();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Baseline helpers (?synthwaveBaseline): frame-time report for A/B checks
    // ─────────────────────────────────────────────────────────────────────────

    trackBaseline(deltaSeconds) {
        this.baselineFrames.push(deltaSeconds * 1000);
        if (this.baselineFrames.length > this.baselineMaxFrames) this.baselineFrames.shift();
    }

    reportBaseline() {
        if (!this.baselineFrames.length) return null;
        const sorted = [...this.baselineFrames].sort((a, b) => a - b);
        const avgMs = this.baselineFrames.reduce((a, b) => a + b, 0) / this.baselineFrames.length;
        const p99Ms = sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)];
        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            preset: this.currentQuality,
            avgFps: Number((1000 / avgMs).toFixed(1)),
            p99Ms: Number(p99Ms.toFixed(2)),
            low1Fps: Number((1000 / p99Ms).toFixed(1)),
            frames: this.baselineFrames.length,
        };
        console.log('[SynthwaveBaseline] Report:', report);
        return report;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.synthwaveBaseline = {
            report: () => this.reportBaseline(),
            reset: () => { this.baselineFrames = []; },
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        this.loopGeneration += 1;
        this.isAnimating = false;
        this.removeLayoutWatch();
        super.stop();

        this.clearEventUnsubscribers();
        this.disposePost();
        this.world?.dispose();
        this.world = null;

        if (this.renderer) {
            this.disposeRenderer(this.renderer, { nullInstance: false });
            const container = document.getElementById('synthwave-sunset-theme');
            if (container?.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.appliedBoard = undefined;
        if (typeof window !== 'undefined' && window.synthwaveBaseline) delete window.synthwaveBaseline;
    }
}
