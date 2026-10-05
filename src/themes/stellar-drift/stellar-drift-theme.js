/**
 * Stellar Drift — shared planetary atmosphere, seconds-based celestial reactions
 * and one node scene on WebGPU and the WebGL2 compatibility backend.
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { seededRandom } from '../../utils/helpers.js';
import { STELLAR_DRIFT_TETROMINOS } from './stellar-drift-tetrominos.js';
import { StellarDriftAtmosphere } from './stellar-drift-atmosphere.js';
import { StellarDriftReactions } from './stellar-drift-reactions.js';
import { StellarDriftPost } from './stellar-drift-post.js';

const INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
const PIXEL_RATIO_CAP = Object.freeze({
    Extreme: 1.5, Ultra: 1.35, High: 1.25, Medium: 1, Low: 0.9, Minimal: 0.75,
});

// Public budget keys used by canonical mobile-quality checks are retained.
export const QUALITY_PRESETS = Object.freeze({
    Extreme: { meteorCount: 500, enablePostProcessing: true },
    Ultra: { meteorCount: 400, enablePostProcessing: true },
    High: { meteorCount: 300, enablePostProcessing: true },
    Medium: { meteorCount: 200, enablePostProcessing: true },
    Low: { meteorCount: 100, enablePostProcessing: false },
    Minimal: { meteorCount: 50, enablePostProcessing: false },
});

function searchParams() {
    return new URLSearchParams(typeof window === 'undefined' ? '' : window.location?.search || '');
}

function enabledParam(params, ...keys) {
    return keys.some((key) => params.has(key)
        && ['', '1', 'true', 'yes', 'on'].includes((params.get(key) || '').toLowerCase()));
}

function readFlags() {
    const params = searchParams();
    const rawSeed = params.get('stellarSeed') ?? params.get('seed');
    const seed = rawSeed === null || rawSeed === '' ? 187 : Number(rawSeed);
    return {
        forceWebGL: enabledParam(params, 'forceWebGL', 'stellarDriftForceWebGL'),
        noPost: enabledParam(params, 'stellarNoPost'),
        noMRT: enabledParam(params, 'stellarNoMRT'),
        noCompute: true,
        seed: Number.isFinite(seed) ? seed : 187,
    };
}

function eventDetail(payload) {
    return payload?.detail ?? payload;
}

export function readStellarDriftEventCount(payload, keys, fallback) {
    const detail = eventDetail(payload);
    const candidates = typeof detail === 'number' || typeof detail === 'string'
        ? [detail] : keys.map((key) => detail?.[key]);
    for (const value of candidates) {
        if (typeof value !== 'number' && typeof value !== 'string') continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        const number = Number(value);
        if (Number.isFinite(number)) return Math.floor(number);
    }
    return fallback;
}

export default class StellarDriftTheme extends BaseTheme {
    constructor() {
        super('stellar-drift');
        this.resourceProfile = 'heavy-gpu';
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.atmosphere = null;
        this.reactions = null;
        this.postProcessing = null;
        this.composer = null;
        this.timer = null;
        this.time = 0;
        this.flags = readFlags();
        this.activeQualityLevel = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingQuality = null;
        this.capabilities = { post: false, mrt: false, compute: false };
        this.usesNodeMaterials = false;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.runtimeGeneration = 0;
        this.animationLoopStarted = false;
        this.animationFrameId = null;
        this.eventUnsubscribers = [];
        this.rebuildQueued = false;
        this.rebuildPending = false;
        this.renderFallbackInProgress = false;
        this.deviceLossRecoveryInProgress = false;
        this.deviceLossRecoveries = 0;
        this.appliedSize = null;
        this.nextLayoutCheck = 0;
        this.layoutKey = null;
        this.lastRenderPath = null;
    }

    getTetrominoConfig() {
        return STELLAR_DRIFT_TETROMINOS;
    }

    getCurrentQualityLevel() {
        return normalizeQuality(typeof window === 'undefined' ? undefined
            : window.settings?.effectQuality || window.settings?.graphicsQuality);
    }

    applyQualityPreset(quality) {
        this.activeQualityLevel = normalizeQuality(quality);
        this.qualityPreset = QUALITY_PRESETS[this.activeQualityLevel];
    }

    getWarmupRoots() {
        return this.atmosphere?.group ? [this.atmosphere.group] : [];
    }

    usesMrtScenePass() {
        return this.postProcessing?.useMRT === true;
    }

    shouldForceWebGL() {
        return this.flags.forceWebGL;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById('stellar-drift-theme');
        if (!container) throw new Error('[StellarDrift] Theme container not found.');
        this.disposeRuntime();
        const runtimeGeneration = ++this.runtimeGeneration;
        const current = () => ownerGeneration === this.lifecycleGeneration
            && runtimeGeneration === this.runtimeGeneration && this.isActive && !this.cleanupComplete;
        this.applyQualityPreset(this.pendingQuality ?? this.getCurrentQualityLevel());
        this.pendingQuality = null;
        const ready = await this.initRenderer(container, ownerGeneration, runtimeGeneration);
        if (!ready || !current()) return;
        try {
            this.probeCapabilities();
            this.configureRendererColorPipeline();
            this.setupRendererResilience();
            this.buildScene();
            this.setupPostProcessing();
            const { width, height } = getViewport();
            this.resize(width, height);
            if (!current()) return;
            this.setupEventListeners();
            this.time = 0;
            this.update(0);
            this.timer = new THREE.Timer();
            this.timer.connect(document);
            this.timer.reset();
            if (enabledParam(searchParams(), 'themeValidation')) window.__STELLAR_DRIFT__ = this;
            if (!this.isPaused && current()) this.startAnimation();
        } catch (error) {
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }
    }

    async initRenderer(
        container,
        ownerGeneration = this.lifecycleGeneration,
        ownerRuntimeGeneration = this.runtimeGeneration,
    ) {
        if (!container) throw new Error('[StellarDrift] Renderer container not found.');
        const current = () => ownerGeneration === this.lifecycleGeneration
            && ownerRuntimeGeneration === this.runtimeGeneration && this.isActive && !this.cleanupComplete;
        const forceWebGL = this.shouldForceWebGL() || typeof navigator === 'undefined' || !navigator.gpu;
        const attempt = (force) => this.initializeRendererCandidate(new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL: force,
            powerPreference: 'high-performance',
        }), {
            timeoutMs: INIT_TIMEOUT_MS,
            label: `Stellar Drift ${force ? 'WebGL2' : 'WebGPU'} renderer init`,
            ownerGeneration,
        });
        let renderer;
        try {
            renderer = await attempt(forceWebGL);
        } catch (error) {
            if (!current()) return false;
            if (forceWebGL) throw new Error('Stellar Drift could not initialize node WebGL2.', { cause: error });
            console.warn('[StellarDrift] Native initialization failed; trying node WebGL2.', error);
            try {
                renderer = await attempt(true);
            } catch (fallbackError) {
                if (!current()) return false;
                throw new Error('Stellar Drift could not initialize WebGPU or WebGL2.', { cause: fallbackError });
            }
        }
        if (!current()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        this.usesNodeMaterials = renderer.isWebGPURenderer === true;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = renderer.backend?.isWebGLBackend === true || (!this.isWebGPU && this.usesNodeMaterials);
        renderer.setClearColor(0x040816, 1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'stellar-drift-renderer';
        renderer.domElement.setAttribute?.('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        // Preserve the registry's static theme container; only the canvas is owned.
        container.appendChild(renderer.domElement);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100000);
        return true;
    }

    probeCapabilities() {
        const maxColorAttachments = this.renderer?.backend?.device?.limits?.maxColorAttachments
            ?? this.renderer?.capabilities?.maxColorAttachments ?? 1;
        const supportsPost = this.usesNodeMaterials && typeof THREE.RenderPipeline === 'function';
        const supportsMRT = this.isWebGPU && maxColorAttachments >= 2;
        this.capabilities = {
            webgpu: this.isWebGPU,
            webgl: this.isWebGL,
            maxColorAttachments,
            supportsPost,
            supportsMRT,
            supportsCompute: this.isWebGPU && typeof this.renderer?.compute === 'function',
            post: supportsPost && this.qualityPreset.enablePostProcessing && !this.flags.noPost,
            mrt: supportsMRT && this.qualityPreset.enablePostProcessing && !this.flags.noPost && !this.flags.noMRT,
            compute: false,
        };
        this.flags.usePost = this.capabilities.post;
        this.flags.useMRT = this.capabilities.mrt;
        this.flags.useCompute = false;
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;
        this.renderer.toneMapping = this.capabilities.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    buildScene() {
        const rng = seededRandom(this.flags.seed);
        this.reactions = new StellarDriftReactions({ quality: this.activeQualityLevel, rng });
        this.atmosphere = new StellarDriftAtmosphere({
            scene: this.scene, camera: this.camera, quality: this.activeQualityLevel, rng,
        }).build();
    }

    setupPostProcessing() {
        this.disposePostProcessingStack();
        if (this.flags.noPost) return;
        this.postProcessing = new StellarDriftPost({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            quality: this.activeQualityLevel,
            useMRT: this.capabilities.mrt,
        });
    }

    applyAdaptiveScalerState() {
        this.postProcessing?.update?.(this.reactions?.getFrame() ?? {});
    }

    removeRendererResilienceListeners() {
        BaseTheme.prototype.removeRendererResilience.call(this);
    }

    setupRendererResilience() {
        if (!this.renderer?.domElement) return;
        this.removeRendererResilienceListeners();
        if (this.isWebGL) {
            // Preserve Three's constructor callback and the BaseTheme restore path.
            BaseTheme.prototype.setupRendererResilience.call(this, this.renderer, { webgpuDevice: null });
            return;
        }
        // SB-15: use Three's existing device-loss callback rather than adding an
        // undetachable promise continuation that would retain this scene.
        const rendererAtRegistration = this.renderer;
        const ownerGeneration = this.lifecycleGeneration;
        const { runtimeGeneration } = this;
        this.renderer.onDeviceLost = (info) => {
            rendererAtRegistration._isDeviceLost = true;
            if (ownerGeneration !== this.lifecycleGeneration || runtimeGeneration !== this.runtimeGeneration
                || this.renderer !== rendererAtRegistration || !this.isActive || this.cleanupComplete) return;
            this.handleDeviceLoss(info).catch((error) => this.reportRuntimeFailure(error));
        };
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive || this.cleanupComplete) return;
        this.deviceLossRecoveryInProgress = true;
        this.deviceLossRecoveries += 1;
        try {
            await this.requestWebGLFallback('device-loss', info);
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    async requestWebGLFallback(reason, error) {
        if (this.renderFallbackInProgress || !this.isActive || this.cleanupComplete) return;
        if (this.shouldForceWebGL()) {
            this.pause();
            this.reportRuntimeFailure(error);
            return;
        }
        this.renderFallbackInProgress = true;
        this.flags.forceWebGL = true;
        console.warn(`[StellarDrift] Recovering through node WebGL2 (${reason}).`, error);
        try {
            await this.start(this.webglRenderer, {
                assetManager: this.assetManager,
                audioManager: this.audioManager,
                onRuntimeFailure: this.onRuntimeFailure,
            });
        } catch (fallbackError) {
            this.reportRuntimeFailure(fallbackError);
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    reportRuntimeFailure(error) {
        console.error('[StellarDrift] Runtime failed.', error);
        try {
            this.onRuntimeFailure?.(error);
        } catch (notificationError) {
            console.warn('[StellarDrift] Failure notification failed.', notificationError);
        }
    }

    effectsAllowed() {
        return this.isActive && !this.isPaused && !this.cleanupComplete
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);
    }

    setupEventListeners() {
        this.clearEventSubscriptions();
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (payload) => this.onPieceLock(payload)),
            eventBus.on(EVENTS.LINE_CLEAR, (payload) => this.onLineClear(payload)),
            eventBus.on(EVENTS.COMBO, (payload) => this.onCombo(payload)),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (view) => this.resize(view?.width, view?.height)),
            eventBus.on(EVENTS.SETTINGS_CHANGED, (payload) => this.handleSettingsChanged(payload)),
        );
        this.registerEventListener(window, 'settingsChanged', (payload) => this.handleSettingsChanged(payload));
        this.registerEventListener(window, 'gameOver', () => this.reactions?.reset());
        this.registerEventListener(window, 'pointermove', (event) => {
            if (event.pointerType === 'touch') return;
            const { width, height } = this.appliedSize ?? getViewport();
            this.atmosphere?.setPointer((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
        }, { passive: true });
        this.registerEventListener(document, 'pointerleave', () => this.atmosphere?.setPointer(0, 0));
        this.registerEventListener(window, 'blur', () => this.atmosphere?.setPointer(0, 0));
    }

    clearEventSubscriptions() {
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
    }

    onPieceLock(payload) {
        if (!this.effectsAllowed()
            || (typeof window !== 'undefined' && window.settings?.pieceLockRipple === false)) return;
        this.reactions?.onPieceLock(eventDetail(payload));
    }

    onLineClear(payload) {
        if (!this.effectsAllowed()) return;
        const count = readStellarDriftEventCount(payload, ['lineCount', 'count', 'lines', 'linesCleared'], 0);
        if (count <= 0) return;
        this.reactions?.onLineClear(Math.min(4, count), eventDetail(payload));
    }

    onCombo(payload) {
        if (!this.effectsAllowed()) return;
        const count = readStellarDriftEventCount(payload, ['comboCount', 'combo', 'count'], 0);
        if (count <= 0) return;
        this.reactions?.onCombo(Math.min(60, count), eventDetail(payload));
    }

    triggerLockEffect(payload) { this.onPieceLock(payload); }

    triggerComboEffect(payload) { this.onCombo(payload); }

    handleSettingsChanged(payload) {
        if (!this.isActive || !this.renderer) return;
        const detail = eventDetail(payload) || {};
        const quality = detail.type === 'effectQuality' ? detail.value
            : detail.effectQuality ?? detail.settings?.effectQuality ?? detail.changed?.effectQuality;
        if (quality !== undefined) {
            const nextQuality = normalizeQuality(quality);
            this.pendingQuality = nextQuality === this.activeQualityLevel ? null : nextQuality;
            if (this.pendingQuality) {
                this.queueRebuild();
                return;
            }
            this.rebuildPending = false;
        }
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
            if (!this.pendingQuality || this.pendingQuality === this.activeQualityLevel) return;
            if (this.isPaused) {
                this.rebuildPending = true;
                return;
            }
            this.start(this.webglRenderer, {
                assetManager: this.assetManager,
                audioManager: this.audioManager,
                onRuntimeFailure: this.onRuntimeFailure,
            }).catch((error) => this.reportRuntimeFailure(error));
        });
    }

    readBoardRect() {
        const board = document.querySelector('.player-card[data-player="solo"], #game-container canvas');
        const rect = board?.getBoundingClientRect?.();
        return rect?.width > 0 && rect?.height > 0 ? rect : null;
    }

    updateLayout(force = false) {
        if (!this.atmosphere || !this.camera) return;
        const { width, height } = this.appliedSize ?? getViewport();
        const rect = this.readBoardRect();
        const key = rect
            ? `${width}:${height}:${rect.left}:${rect.top}:${rect.width}:${rect.height}` : `${width}:${height}`;
        if (!force && key === this.layoutKey) return;
        this.layoutKey = key;
        this.atmosphere.prepareCamera(this.camera.aspect, rect, { width, height });
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const view = width > 0 && height > 0 ? { width, height } : getViewport();
        if (!(view.width > 0) || !(view.height > 0)) return;
        const dpr = this.getEffectivePixelRatio(PIXEL_RATIO_CAP[this.activeQualityLevel]);
        if (this.appliedSize?.width === view.width && this.appliedSize?.height === view.height
            && this.appliedSize?.dpr === dpr) return;
        this.appliedSize = { width: view.width, height: view.height, dpr };
        this.camera.aspect = view.width / view.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(view.width, view.height);
        this.postProcessing?.setSize?.(view.width, view.height);
        this.updateLayout(true);
    }

    update(delta) {
        const dt = Math.max(0, Math.min(MAX_DELTA_S, Number.isFinite(delta) ? delta : 0));
        this.time += dt;
        this.reactions?.update(dt);
        const frame = this.reactions?.getFrame() ?? {};
        this.atmosphere?.update(this.time, dt, frame);
        this.postProcessing?.update?.(frame);
        if (this.time >= this.nextLayoutCheck) {
            this.nextLayoutCheck = this.time + 0.5;
            this.updateLayout();
        }
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        try {
            if (this.postProcessing) this.postProcessing.render();
            else this.renderer.render(this.scene, this.camera);
            this.lastRenderPath = this.isWebGPU
                ? `webgpu-${this.capabilities.post ? 'post' : 'direct'}`
                : `webgl2-node-${this.capabilities.post ? 'post' : 'direct'}`;
        } catch (error) {
            this.requestWebGLFallback('render-failure', error).catch((failure) => this.reportRuntimeFailure(failure));
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
            if (!this.shouldRenderFrame() || document.hidden === true) {
                if (document.hidden === true || window.isRenderingPaused) this.timer.reset();
                return;
            }
            this.timer.update(timestamp);
            this.update(this.timer.getDelta());
            this.renderFrame();
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
        if (!this.renderer || !this.scene || !this.atmosphere) return false;
        const resumed = super.resume();
        if (resumed) {
            this.timer?.reset();
            const { width, height } = getViewport();
            this.resize(width, height);
            this.updateLayout(true);
            if (this.rebuildPending) {
                this.rebuildPending = false;
                this.queueRebuild();
            } else this.startAnimation();
        }
        return resumed;
    }

    disposePostProcessingStack() {
        this.postProcessing?.dispose?.();
        this.postProcessing = null;
        this.composer = null;
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;
        this.renderer.onDeviceLost = () => {};
        this.removeRendererResilienceListeners();
        this.disposeRenderer(this.renderer, { nullInstance: false, preserveCanvas: !removeCanvas });
        this.renderer = null;
    }

    disposeRuntime() {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.animationLoopStarted = false;
        this.clearEventSubscriptions();
        this.removeRendererResilienceListeners();
        const release = (label, action) => {
            try { action(); } catch (error) { console.warn(`[StellarDrift] ${label} disposal failed.`, error); }
        };
        release('Post', () => this.disposePostProcessingStack());
        this.postProcessing = null;
        release('Atmosphere', () => this.atmosphere?.dispose());
        this.atmosphere = null;
        release('Reactions', () => this.reactions?.dispose());
        this.reactions = null;
        release('Timer', () => this.timer?.dispose());
        this.timer = null;
        this.scene?.clear();
        this.scene = null;
        this.camera = null;
        release('Renderer', () => this.disposeRendererResources());
        this.usesNodeMaterials = false;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.appliedSize = null;
        this.layoutKey = null;
        this.nextLayoutCheck = 0;
        if (typeof window !== 'undefined' && window.__STELLAR_DRIFT__ === this) delete window.__STELLAR_DRIFT__;
    }

    releaseManagedGpuResources() {
        this.disposeRuntime();
        super.releaseManagedGpuResources();
    }

    stop() {
        super.stop();
        this.disposeRuntime();
    }

    cleanup() {
        if (this.cleanupComplete) return;
        this.stop();
        super.cleanup();
    }
}
