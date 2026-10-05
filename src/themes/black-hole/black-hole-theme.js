/**
 * Black Hole — the hole you feed. A ray-traced Schwarzschild black hole hangs behind the
 * board: every locked piece is drawn off it as a stream of its own colour and swallowed,
 * every clear sends a pressure wave through the disk, and a streak of clears winds the hole
 * up until its jets fire.
 *
 * Both backends render the artwork proven in the playground (black-hole-world.js). This
 * owner handles generation-safe startup, gameplay events, sizing, dynamic resolution and
 * disposal.
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { getViewport } from '../../utils/viewport.js';
import { revealHiddenDrawables } from '../shared/warm-hidden-drawables.js';
import { readBoardRects } from './black-hole-board-rects.js';
import { BlackHolePost } from './black-hole-post.js';
import { QUALITY_PRESETS, normalizeBlackHoleQuality } from './black-hole-quality.js';
import { ResolutionController } from './black-hole-resolution.js';
import { BLACK_HOLE_TETROMINOS } from './black-hole-tetrominos.js';
import { BlackHoleWorld, bakeBlackHoleTexturesAsync } from './black-hole-world.js';

export { QUALITY_PRESETS } from './black-hole-quality.js';

const INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
/** Boards settle over a few frames after a layout change; re-read them at these delays. */
const BOARD_READ_DELAYS_S = [0, 0.6, 1.8];
/** Seconds between GPU render-time samples for dynamic resolution. */
const GPU_SAMPLE_INTERVAL_S = 1 / 15;

function searchParams() {
    return new URLSearchParams(typeof window === 'undefined' ? '' : window.location?.search || '');
}

function enabledParam(params, ...keys) {
    return keys.some((key) => params.has(key)
        && ['', '1', 'true', 'yes', 'on'].includes((params.get(key) || '').toLowerCase()));
}

function eventDetail(payload) {
    return payload?.detail ?? payload;
}

/**
 * The frame rate dynamic resolution holds the theme to: the player's target, but never more
 * than the display can show — on a 50 Hz panel a 60 fps target would read as late for ever.
 */
function targetFrameRate() {
    const settings = typeof window === 'undefined' ? null : window.settings;
    const configured = Number(settings?.targetFrameRate) || 60;
    const refresh = typeof window === 'undefined' ? NaN
        : Number(window.serenityBlocks?.frameRateController?.monitorRefreshRate);
    return Math.max(30, Math.min(configured, refresh > 0 ? refresh : configured));
}

export default class BlackHoleTheme extends BaseTheme {
    constructor() {
        super('black-hole');
        this.resourceProfile = 'heavy-gpu';
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.world = null;
        this.post = null;
        this.timer = null;
        this.time = 0;
        this.qualityPresets = QUALITY_PRESETS;
        this.quality = 'High';
        this.currentQuality = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingQuality = null;
        this.pointer = { x: 0, y: 0 };
        this.isWebGPU = false;
        this.usesNodeMaterials = false;
        this.forceWebGL = false;
        this.runtimeGeneration = 0;
        this.animationLoopStarted = false;
        this.animationFrameId = null;
        this.eventUnsubscribers = [];
        this.gpuSurfaceUnregister = null;
        this.gpuRecoveryAttempted = false;
        this.rebuildQueued = false;
        this.rebuildPending = false;
        this.appliedSize = null;
        this.drawingBuffer = new THREE.Vector2();
        this.boardReads = [];
        this.modeManager = null;
        this.reducedMotionQuery = null;
        this.resolution = new ResolutionController();
        this.gpuTiming = { enabled: false, pending: false, nextSampleAt: 0 };
        /** Animation frames the browser delivered since the last one this theme drew. */
        this.framesSinceDraw = 0;
    }

    getTetrominoConfig() {
        return BLACK_HOLE_TETROMINOS;
    }

    usesMrtScenePass() {
        return false;
    }

    /** Event layers parked invisible until an event needs them. */
    getWarmupRoots() {
        return this.world?.matter?.group ? [this.world.matter.group] : [];
    }

    /** The tier the player chose; `Minimum` is the legacy label for the cheapest one. */
    getGraphicsQuality() {
        const settings = typeof window === 'undefined' ? null : window.settings;
        return normalizeBlackHoleQuality(settings?.effectQuality || settings?.graphicsQuality);
    }

    applyQualityPreset(quality) {
        this.quality = normalizeBlackHoleQuality(quality);
        this.currentQuality = this.quality;
        this.qualityPreset = QUALITY_PRESETS[this.quality];
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById('black-hole-theme');
        if (!container) throw new Error('[BlackHole] Theme container not found.');
        this.disposeRuntime();
        const runtimeGeneration = ++this.runtimeGeneration;
        const current = () => runtimeGeneration === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        this.applyQualityPreset(this.pendingQuality ?? this.getGraphicsQuality());
        this.pendingQuality = null;

        // The galaxy and the gas are baked on the CPU in slices while the renderer comes up.
        const baking = bakeBlackHoleTexturesAsync(this.qualityPreset);
        baking.catch(() => {});
        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return;
        const bakes = current() ? await baking : null;
        if (!current()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        this.renderer = renderer;
        this.usesNodeMaterials = renderer.isWebGPURenderer === true;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setClearColor(0x000003, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        // The registry's static container is never registered for removal.
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();
        this.setupGpuTiming();
        try {
            this.buildScene(bakes);
            const { width, height } = getViewport();
            this.resize(width, height);
            this.setupEventListeners();
            this.time = 0;
            this.update(0);
            this.warmEventPools();
            this.timer = new THREE.Timer();
            this.timer.connect(document);
            this.timer.reset();
            if (enabledParam(searchParams(), 'themeValidation')) window.__BLACK_HOLE_THEME__ = this;
            if (!this.isPaused && current()) this.startAnimation();
        } catch (error) {
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }
    }

    async createRenderer(ownerGeneration) {
        const forceWebGL = this.forceWebGL || enabledParam(searchParams(), 'forceWebGL', 'blackHoleForceWebGL');
        const current = () => ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        const attempt = (force) => this.initializeRendererCandidate(new THREE.WebGPURenderer({
            // Every edge in the scene is analytic and the picture is one fullscreen material,
            // so multisampling would only multiply the cost of the march.
            antialias: false,
            alpha: false,
            forceWebGL: force,
            powerPreference: 'high-performance',
        }), {
            timeoutMs: INIT_TIMEOUT_MS,
            label: `Black Hole ${force ? 'WebGL2' : 'WebGPU'} renderer init`,
            ownerGeneration,
        });
        if (!forceWebGL && typeof navigator !== 'undefined' && navigator.gpu) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!current()) return null;
                console.warn('[BlackHole] WebGPU initialization failed; trying node WebGL2.', error);
            }
        }
        if (!current()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!current()) return null;
            throw new Error('Black Hole could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    buildScene(bakes = null) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, 1, 1, 20000);
        this.world = new BlackHoleWorld({
            scene: this.scene, camera: this.camera, quality: this.quality, bakes,
        });
        this.post = new BlackHolePost({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            preset: this.qualityPreset,
        });
        this.resolution = new ResolutionController({
            minScale: this.qualityPreset.minScale,
            targetFps: targetFrameRate(),
            enabled: !enabledParam(searchParams(), 'blackHoleNoDrs', 'blackHoleNoDRS'),
        });
        this.applyMotionPreference();
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            resolution: this.resolution.getDiagnostics(),
            world: this.world?.getDiagnostics() ?? null,
            post: this.post?.getDiagnostics() ?? null,
        };
    }

    setupGpuResilience() {
        const { renderer } = this;
        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
        });
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        if (!this.isWebGPU) return;
        this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
            recover: async () => {
                if (this.gpuRecoveryAttempted) throw new Error('Black Hole WebGPU recovery already attempted.');
                this.gpuRecoveryAttempted = true;
                this.forceWebGL = true;
                if (this.isActive) {
                    await this.start(this.webglRenderer, {
                        assetManager: this.assetManager,
                        audioManager: this.audioManager,
                        onRuntimeFailure: this.onRuntimeFailure,
                    });
                }
            },
        });
    }

    /** Measured render time steers dynamic resolution wherever the backend can report it. */
    setupGpuTiming() {
        this.gpuTiming = { enabled: false, pending: false, nextSampleAt: 0 };
        const { renderer } = this;
        if (!this.isWebGPU || !renderer?.backend || enabledParam(searchParams(), 'blackHoleNoGpuDrs')) return;
        if (renderer.hasFeature?.('timestamp-query') !== true) return;
        renderer.backend.trackTimestamp = true;
        this.gpuTiming.enabled = true;
    }

    /** Sample the last frame's GPU render time; a late answer never reaches a newer runtime. */
    sampleGpuTiming() {
        const timing = this.gpuTiming;
        const { renderer } = this;
        if (!timing.enabled || timing.pending || this.time < timing.nextSampleAt) return;
        if (!renderer?.backend?.trackTimestamp || typeof renderer.resolveTimestampsAsync !== 'function') return;
        timing.nextSampleAt = this.time + GPU_SAMPLE_INTERVAL_S;
        const generation = this.runtimeGeneration;
        const { resolution } = this;
        const owned = () => generation === this.runtimeGeneration && renderer === this.renderer
            && timing === this.gpuTiming && this.isActive && !this.cleanupComplete;
        let query;
        try {
            query = renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
        } catch {
            return;
        }
        timing.pending = true;
        Promise.resolve(query).then((duration) => {
            if (!owned()) return;
            timing.pending = false;
            if (typeof duration === 'number') resolution.noteGpuTime(duration, this.time);
        }).catch(() => {
            if (owned()) timing.pending = false;
        });
    }

    effectsAllowed() {
        return this.isActive && !this.isPaused && !this.cleanupComplete && Boolean(this.world)
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);
    }

    setupEventListeners() {
        this.teardownEventListeners();
        const whenAllowed = (handler) => (payload) => {
            if (this.effectsAllowed()) handler(eventDetail(payload));
        };
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.HARD_DROP, whenAllowed((payload) => this.world.director.onHardDrop(payload))),
            eventBus.on(EVENTS.PIECE_LOCK, (payload) => this.onPieceLock(eventDetail(payload))),
            eventBus.on(EVENTS.LINE_CLEAR, whenAllowed((payload) => this.world.director.onLineClear(payload))),
            eventBus.on(EVENTS.COMBO, whenAllowed((payload) => this.world.director.onCascade(payload))),
            eventBus.on(EVENTS.TSPIN, whenAllowed((payload) => this.world.director.onTSpin(payload))),
            eventBus.on(EVENTS.PERFECT_CLEAR, whenAllowed((payload) => this.world.director.onPerfectClear(payload))),
            eventBus.on(EVENTS.LEVEL_UP, whenAllowed((payload) => this.world.director.onLevelUp(payload))),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (view) => this.resize(view?.width, view?.height)),
            eventBus.on(EVENTS.SETTINGS_CHANGED, (payload) => this.handleSettingsChanged(payload)),
        );
        this.registerEventListener(window, 'settingsChanged', (payload) => this.handleSettingsChanged(payload));
        this.registerEventListener(window, 'gameOver', () => this.world?.director.calm());
        this.registerEventListener(window, 'pointermove', (event) => {
            if (!this.isActive || this.isPaused || event.pointerType === 'touch') return;
            this.pointer.x = THREE.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
            this.pointer.y = THREE.MathUtils.clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
        }, { passive: true });
        this.reducedMotionQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        if (typeof this.reducedMotionQuery?.addEventListener === 'function') {
            this.registerEventListener(this.reducedMotionQuery, 'change', () => this.applyMotionPreference());
        }
        // The scene was built before this query existed; apply what it says now.
        this.applyMotionPreference();
        this.ensureModeManagerListeners();
    }

    /** The mode manager may appear after the first build (boot prewarm); subscribe once it does. */
    ensureModeManagerListeners() {
        const manager = typeof window !== 'undefined' ? window.serenityBlocks?.gameModeManager : null;
        if (!manager?.on || manager === this.modeManager) return;
        this.modeManager = manager;
        const relayout = () => this.scheduleBoardReads();
        this.eventUnsubscribers.push(
            manager.on('modeStarted', relayout),
            manager.on('modeActivated', relayout),
            manager.on('modeStopped', () => this.world?.director.calm()),
        );
    }

    teardownEventListeners() {
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        this.modeManager = null;
        this.reducedMotionQuery = null;
    }

    applyMotionPreference() {
        const reduced = this.reducedMotionQuery?.matches === true
            || (typeof window !== 'undefined' && window.settings?.reducedMotion === true);
        this.world?.setReducedMotion(reduced);
    }

    /** `pieceLockRipple` switches off the visible feed, never the streak bookkeeping. */
    onPieceLock(payload) {
        if (!this.effectsAllowed()) return;
        const visible = typeof window === 'undefined' || window.settings?.pieceLockRipple !== false;
        this.world.director.onPieceLock(payload, visible);
    }

    handleSettingsChanged(payload) {
        if (!this.isActive || !this.renderer) return;
        const detail = eventDetail(payload) || {};
        const quality = detail.type === 'effectQuality' ? detail.value
            : detail.effectQuality ?? detail.settings?.effectQuality ?? detail.changed?.effectQuality;
        if (quality !== undefined && normalizeBlackHoleQuality(quality) !== this.quality) {
            this.pendingQuality = normalizeBlackHoleQuality(quality);
            this.queueRebuild();
            return;
        }
        if (typeof window !== 'undefined' && window.settings?.backgroundComboEffects === false) {
            this.world?.director.calm();
        }
        this.applyMotionPreference();
        this.resolution.setTargetFps(targetFrameRate());
        if (detail.type === 'renderScale' || detail.renderScale !== undefined
            || detail.settings?.renderScale !== undefined || detail.changed?.renderScale !== undefined) {
            const generation = this.runtimeGeneration;
            queueMicrotask(() => {
                if (!this.isActive || generation !== this.runtimeGeneration) return;
                this.appliedSize = null;
                const { width, height } = getViewport();
                this.resize(width, height);
            });
        }
    }

    queueRebuild() {
        if (this.rebuildQueued) return;
        this.rebuildQueued = true;
        const generation = this.runtimeGeneration;
        queueMicrotask(() => {
            this.rebuildQueued = false;
            if (!this.isActive || generation !== this.runtimeGeneration) return;
            if (this.isPaused) {
                this.rebuildPending = true;
                return;
            }
            this.start(this.webglRenderer, {
                assetManager: this.assetManager,
                audioManager: this.audioManager,
                onRuntimeFailure: this.onRuntimeFailure,
            }).catch((error) => this.onRuntimeFailure?.(error));
        });
    }

    /** The device-pixel ratio in force: the tier's cap, scaled by dynamic resolution. */
    getPixelRatio() {
        const base = this.getEffectivePixelRatio(this.qualityPreset.pixelRatio);
        return Math.max(0.25, Math.round(base * this.resolution.scale * 100) / 100);
    }

    resize(width, height) {
        if (!this.renderer || !this.camera || !this.world) return;
        const view = width > 0 && height > 0 ? { width, height } : getViewport();
        if (!(view.width > 0) || !(view.height > 0)) return;
        const dpr = this.getPixelRatio();
        if (this.appliedSize?.width === view.width && this.appliedSize?.height === view.height
            && this.appliedSize?.dpr === dpr) return;
        const layoutChanged = this.appliedSize?.width !== view.width || this.appliedSize?.height !== view.height;
        this.appliedSize = { width: view.width, height: view.height, dpr };
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(view.width, view.height);
        this.world.prepareCamera(view.width / view.height);
        this.renderer.getDrawingBufferSize(this.drawingBuffer);
        this.world.setViewport(this.drawingBuffer.x, this.drawingBuffer.y);
        this.post?.setSize(view.width, view.height);
        if (layoutChanged) this.scheduleBoardReads();
    }

    /** Queue board-rect reads on simulation time; the frame loop performs them. */
    scheduleBoardReads() {
        this.boardReads = BOARD_READ_DELAYS_S.map((delay) => this.time + delay);
    }

    readBoards() {
        if (!this.world) return;
        for (const rect of readBoardRects()) this.world.setBoardRect(rect.slot, rect);
    }

    update(delta) {
        if (!this.world) return;
        const dt = Math.max(0, Math.min(MAX_DELTA_S, Number.isFinite(delta) ? delta : 0));
        this.time += dt;
        if (this.boardReads.length > 0 && this.time >= this.boardReads[0]) {
            this.boardReads.shift();
            this.readBoards();
        }
        // The load reading is the browser's own cadence: under a frame-rate cap this theme
        // draws on only some animation frames, and its own spacing would read as lateness.
        const cadence = dt / Math.max(1, this.framesSinceDraw);
        this.framesSinceDraw = 0;
        if (this.resolution.update(dt, this.time, cadence)) {
            this.appliedSize = { ...this.appliedSize, dpr: -1 };
            const { width, height } = getViewport();
            this.resize(width, height);
        }
        this.world.update(this.time, dt, this.pointer);
        const { director } = this.world;
        this.post?.update({ energy: director.energy, flash: director.flash, ripples: this.world.ripples });
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera || !this.world) return;
        if (this.post) this.post.render();
        else this.renderer.render(this.scene, this.camera);
    }

    /**
     * Draw the parked event layers once through the shipped render path, so the first lock,
     * clear and jet find their pipelines already built.
     */
    warmEventPools() {
        if (!this.renderer || !this.scene || !this.camera || !this.world) return 0;
        const roots = this.getWarmupRoots();
        const reveal = revealHiddenDrawables(roots, { camera: this.camera });
        try {
            for (const root of roots) root.updateMatrixWorld(true);
            this.renderFrame();
            return reveal.revealed;
        } finally {
            reveal.restore();
        }
    }

    startAnimation() {
        if (this.animationLoopStarted || !this.isActive || this.isPaused || !this.timer) return;
        this.animationLoopStarted = true;
        this.timer.reset();
        const generation = this.runtimeGeneration;
        const animate = (timestamp) => {
            if (generation !== this.runtimeGeneration || !this.isActive || this.isPaused) return;
            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
            this.framesSinceDraw += 1;
            if (!this.shouldRenderFrame() || document.hidden === true) {
                // FPS skips accumulate elapsed time; a hidden/paused surface does not.
                if (document.hidden === true || window.isRenderingPaused) {
                    this.timer.reset();
                    this.framesSinceDraw = 0;
                }
                return;
            }
            this.timer.update(timestamp);
            this.update(this.timer.getDelta());
            this.renderFrame();
            this.sampleGpuTiming();
        };
        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    pause() {
        const paused = super.pause();
        if (paused) this.timer?.reset();
        return paused;
    }

    resume() {
        if (!this.renderer || !this.scene || !this.world) return false;
        const resumed = super.resume();
        if (resumed) {
            this.timer?.reset();
            this.ensureModeManagerListeners();
            const { width, height } = getViewport();
            this.resize(width, height);
            this.scheduleBoardReads();
            if (this.rebuildPending) {
                this.rebuildPending = false;
                this.queueRebuild();
            } else this.startAnimation();
        }
        return resumed;
    }

    disposeRuntime() {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.animationLoopStarted = false;
        this.teardownEventListeners();
        this.removeRendererResilience();
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        // Quiesce timestamp sampling before the backend goes away.
        this.gpuTiming = { enabled: false, pending: false, nextSampleAt: 0 };
        if (this.renderer?.backend) this.renderer.backend.trackTimestamp = false;
        const release = (label, value) => {
            try { value?.dispose?.(); } catch (error) { console.warn(`[BlackHole] ${label} disposal failed.`, error); }
        };
        release('Post', this.post);
        this.post = null;
        release('World', this.world);
        this.world = null;
        release('Timer', this.timer);
        this.timer = null;
        this.scene?.clear();
        this.scene = null;
        this.camera = null;
        if (this.renderer) this.disposeRenderer(this.renderer);
        this.isWebGPU = false;
        this.usesNodeMaterials = false;
        this.appliedSize = null;
        this.boardReads = [];
        if (typeof window !== 'undefined' && window.__BLACK_HOLE_THEME__ === this) delete window.__BLACK_HOLE_THEME__;
    }

    releaseManagedGpuResources() {
        this.disposeRuntime();
        super.releaseManagedGpuResources();
    }

    stop() {
        super.stop();
        this.disposeRuntime();
    }

    /** Release everything this theme built; safe to call more than once. */
    dispose() {
        this.disposeRuntime();
    }

    cleanup() {
        if (this.cleanupComplete) return;
        try {
            this.dispose();
        } finally {
            // BaseTheme owns the terminal lifecycle contract; it runs even when this
            // theme's own disposal meets an already-lost renderer or scene resource.
            super.cleanup();
        }
    }
}
