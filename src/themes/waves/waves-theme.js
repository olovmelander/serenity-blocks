/**
 * Waves — a sculpted, sunlit surf barrel shared with the isolated playground.
 * The theme owns lifecycle, renderer and gameplay subscriptions; WavesOcean owns
 * the artwork and WavesReactions owns bounded, seconds-based event envelopes.
 * Both renderer backends use the same node scene and RenderPipeline.
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { seededRandom } from '../../utils/helpers.js';
import { WAVES_TETROMINOS } from './waves-tetrominos.js';
import { WavesOcean } from './waves-ocean.js';
import { WavesReactions } from './waves-reactions.js';
import { WavesPost } from './waves-post.js';

const INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
const PIXEL_RATIO_CAP = Object.freeze({
    Extreme: 1.5, Ultra: 1.35, High: 1.25, Medium: 1, Low: 0.9, Minimal: 0.75,
});

// Preserve the public quality-preset API used by canonical mobile-tier checks.
// Each art module receives the same canonical tier and owns its own draw budget.
export const QUALITY_PRESETS = Object.freeze({
    Extreme: { sprayCount: 2000, enablePostProcessing: true },
    Ultra: { sprayCount: 1500, enablePostProcessing: true },
    High: { sprayCount: 1000, enablePostProcessing: true },
    Medium: { sprayCount: 600, enablePostProcessing: true },
    Low: { sprayCount: 300, enablePostProcessing: false },
    Minimal: { sprayCount: 150, enablePostProcessing: false },
});

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

/** Accept the bus's canonical fields, historical aliases and DOM detail envelopes. */
export function readWavesEventCount(payload, keys, fallback) {
    const detail = eventDetail(payload);
    const candidates = typeof detail === 'number' || typeof detail === 'string'
        ? [detail] : keys.map((key) => detail?.[key]);
    for (const value of candidates) {
        if (typeof value !== 'number' && typeof value !== 'string') continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        const count = Number(value);
        if (Number.isFinite(count)) return Math.floor(count);
    }
    return fallback;
}

export default class WavesTheme extends BaseTheme {
    constructor() {
        super('waves');
        this.resourceProfile = 'heavy-gpu';
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.ocean = null;
        this.reactions = null;
        this.post = null;
        this.timer = null;
        this.time = 0;
        this.quality = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingQuality = null;
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
    }

    getTetrominoConfig() {
        return WAVES_TETROMINOS;
    }

    getWarmupRoots() {
        return this.ocean?.group ? [this.ocean.group] : [];
    }

    usesMrtScenePass() {
        return this.post?.useMRT === true;
    }

    getCurrentQualityLevel() {
        return normalizeQuality(typeof window === 'undefined' ? undefined
            : window.settings?.effectQuality || window.settings?.graphicsQuality);
    }

    applyQualityPreset(quality) {
        this.quality = normalizeQuality(quality);
        this.qualityPreset = QUALITY_PRESETS[this.quality];
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById('waves-theme');
        if (!container) throw new Error('[Waves] Theme container not found.');
        this.disposeRuntime();
        const runtimeGeneration = ++this.runtimeGeneration;
        const current = () => runtimeGeneration === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        this.applyQualityPreset(this.pendingQuality ?? this.getCurrentQualityLevel());
        this.pendingQuality = null;

        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return;
        if (!current()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        this.renderer = renderer;
        this.usesNodeMaterials = renderer.isWebGPURenderer === true;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setClearColor(0x052c39, 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        // The registry's static container is never registered for removal.
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();
        try {
            this.buildScene();
            const { width, height } = getViewport();
            this.resize(width, height);
            this.setupEventListeners();
            this.time = 0;
            this.update(0);
            this.timer = new THREE.Timer();
            this.timer.connect(document);
            this.timer.reset();
            if (enabledParam(searchParams(), 'themeValidation')) window.__WAVES__ = this;
            if (!this.isPaused && current()) this.startAnimation();
        } catch (error) {
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }
    }

    async createRenderer(ownerGeneration) {
        const forceWebGL = this.forceWebGL || enabledParam(searchParams(), 'forceWebGL', 'wavesForceWebGL');
        const current = () => ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        const attempt = (force) => this.initializeRendererCandidate(new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL: force,
            powerPreference: 'high-performance',
        }), {
            timeoutMs: INIT_TIMEOUT_MS,
            label: `Waves ${force ? 'WebGL2' : 'WebGPU'} renderer init`,
            ownerGeneration,
        });
        if (!forceWebGL && typeof navigator !== 'undefined' && navigator.gpu) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!current()) return null;
                console.warn('[Waves] WebGPU initialization failed; trying node WebGL2.', error);
            }
        }
        if (!current()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!current()) return null;
            throw new Error('Waves could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    buildScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 240);
        this.camera.position.set(0, 0, -25);
        this.camera.lookAt(-6, 1, 35);
        const rawSeed = searchParams().get('wavesSeed');
        const seed = rawSeed === null || rawSeed === '' ? 187 : Number(rawSeed);
        const rng = seededRandom(Number.isFinite(seed) ? seed : 187);
        this.reactions = new WavesReactions({ quality: this.quality, rng });
        this.ocean = new WavesOcean({
            scene: this.scene, camera: this.camera, quality: this.quality, rng,
        }).build();
        // WavesPost's phone path renders directly, with no pass targets or bloom.
        this.post = new WavesPost({
            renderer: this.renderer, scene: this.scene, camera: this.camera, quality: this.quality,
        });
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
                if (this.gpuRecoveryAttempted) throw new Error('Waves WebGPU recovery already attempted.');
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

    effectsAllowed() {
        return this.isActive && !this.isPaused && !this.cleanupComplete
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);
    }

    setupEventListeners() {
        this.teardownEventListeners();
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (payload) => this.onPieceLock(payload)),
            eventBus.on(EVENTS.LINE_CLEAR, (payload) => this.onLineClear(payload)),
            eventBus.on(EVENTS.COMBO, (payload) => this.onCombo(payload)),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (view) => this.resize(view?.width, view?.height)),
            eventBus.on(EVENTS.SETTINGS_CHANGED, (payload) => this.handleSettingsChanged(payload)),
        );
        this.registerEventListener(window, 'settingsChanged', (payload) => this.handleSettingsChanged(payload));
        this.registerEventListener(window, 'gameOver', () => this.reactions?.reset());
    }

    teardownEventListeners() {
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
        const count = readWavesEventCount(payload, ['lineCount', 'count', 'lines'], 1);
        if (count <= 0) return;
        this.reactions?.onLineClear(Math.max(1, Math.min(4, count)), eventDetail(payload));
    }

    onCombo(payload) {
        if (!this.effectsAllowed()) return;
        const count = readWavesEventCount(payload, ['comboCount', 'combo', 'count'], 0);
        this.reactions?.onCombo(Math.max(0, Math.min(32, count)), eventDetail(payload));
    }

    handleSettingsChanged(payload) {
        if (!this.isActive || !this.renderer) return;
        const detail = eventDetail(payload) || {};
        const quality = detail.type === 'effectQuality' ? detail.value
            : detail.effectQuality ?? detail.settings?.effectQuality ?? detail.changed?.effectQuality;
        if (quality !== undefined && normalizeQuality(quality) !== this.quality) {
            this.pendingQuality = normalizeQuality(quality);
            this.queueRebuild();
            return;
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

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const view = width > 0 && height > 0 ? { width, height } : getViewport();
        if (!(view.width > 0) || !(view.height > 0)) return;
        const dpr = this.getEffectivePixelRatio(PIXEL_RATIO_CAP[this.quality]);
        if (this.appliedSize?.width === view.width && this.appliedSize?.height === view.height
            && this.appliedSize?.dpr === dpr) return;
        this.appliedSize = { width: view.width, height: view.height, dpr };
        this.camera.aspect = view.width / view.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(view.width, view.height);
        this.post?.setSize?.(view.width, view.height);
        const hasBoard = !!document.querySelector('.player-card[data-player="solo"], #game-container canvas');
        this.ocean?.prepareCamera?.(this.camera.aspect, hasBoard);
    }

    update(delta) {
        const dt = Math.max(0, Math.min(MAX_DELTA_S, Number.isFinite(delta) ? delta : 0));
        this.time += dt;
        this.reactions?.update(dt);
        const frame = this.reactions?.getFrame();
        this.ocean?.update(this.time, dt, frame);
        this.post?.update?.({ ...frame, time: this.time });
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        if (this.post) this.post.render();
        else this.renderer.render(this.scene, this.camera);
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
                // FPS skips accumulate elapsed time; a hidden/paused surface does not.
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
        if (!this.renderer || !this.scene || !this.ocean) return false;
        const resumed = super.resume();
        if (resumed) {
            this.timer?.reset();
            const { width, height } = getViewport();
            this.resize(width, height);
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
        const release = (label, value) => {
            try { value?.dispose?.(); } catch (error) { console.warn(`[Waves] ${label} disposal failed.`, error); }
        };
        release('Post', this.post);
        this.post = null;
        release('Ocean', this.ocean);
        this.ocean = null;
        this.reactions?.reset();
        release('Reactions', this.reactions);
        this.reactions = null;
        release('Timer', this.timer);
        this.timer = null;
        this.scene?.clear();
        this.scene = null;
        this.camera = null;
        if (this.renderer) this.disposeRenderer(this.renderer);
        this.isWebGPU = false;
        this.usesNodeMaterials = false;
        this.appliedSize = null;
        if (typeof window !== 'undefined' && window.__WAVES__ === this) delete window.__WAVES__;
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
