/**
 * Crystal Cave — opaline mineral facets, a subterranean mirror and traveling
 * resonance. Both backends render the same artwork proven in the playground;
 * this owner handles generation-safe startup, events, sizing and disposal.
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { CRYSTAL_CAVE_TETROMINOS } from './crystal-cave-tetrominos.js';
import { CrystalCaveAtmosphere } from './crystal-cave-atmosphere.js';
import { CrystalCaveReactions } from './crystal-cave-reactions.js';
import { CrystalCavePost } from './crystal-cave-post.js';
import { QUALITY_PRESETS } from './crystal-cave-quality.js';
import { revealHiddenDrawables } from '../shared/warm-hidden-drawables.js';

export { QUALITY_PRESETS } from './crystal-cave-quality.js';

const INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
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
export function readCrystalCaveEventCount(payload, keys, fallback) {
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

export default class CrystalCaveTheme extends BaseTheme {
    constructor() {
        super('crystal-cave');
        this.resourceProfile = 'heavy-gpu';
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.atmosphere = null;
        this.reactions = null;
        this.post = null;
        this.timer = null;
        this.time = 0;
        this.quality = 'High';
        this.currentQuality = 'High';
        this.pointer = { x: 0, y: 0 };
        this.smoothedPointer = { x: 0, y: 0 };
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
        return CRYSTAL_CAVE_TETROMINOS;
    }

    getWarmupRoots() {
        return [this.atmosphere?.group, this.reactions?.group].filter(Boolean);
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
        this.currentQuality = this.quality;
        this.qualityPreset = QUALITY_PRESETS[this.quality];
        this.activePreset = this.qualityPreset;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById('crystal-cave-theme');
        if (!container) throw new Error('[CrystalCave] Theme container not found.');
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
        renderer.setClearColor(0x080913, 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.95;
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
            this.warmEventPools();
            this.timer = new THREE.Timer();
            this.timer.connect(document);
            this.timer.reset();
            if (enabledParam(searchParams(), 'themeValidation')) window.__CRYSTAL_CAVE__ = this;
            if (!this.isPaused && current()) this.startAnimation();
        } catch (error) {
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }
    }

    async createRenderer(ownerGeneration) {
        const forceWebGL = this.forceWebGL || enabledParam(searchParams(), 'forceWebGL', 'crystalCaveForceWebGL');
        const current = () => ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        const attempt = (force) => this.initializeRendererCandidate(new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL: force,
            powerPreference: 'high-performance',
        }), {
            timeoutMs: INIT_TIMEOUT_MS,
            label: `CrystalCave ${force ? 'WebGL2' : 'WebGPU'} renderer init`,
            ownerGeneration,
        });
        if (!forceWebGL && typeof navigator !== 'undefined' && navigator.gpu) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!current()) return null;
                console.warn('[CrystalCave] WebGPU initialization failed; trying node WebGL2.', error);
            }
        }
        if (!current()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!current()) return null;
            throw new Error('CrystalCave could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    buildScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 260);
        this.atmosphere = new CrystalCaveAtmosphere({
            scene: this.scene, camera: this.camera, quality: this.quality,
        });
        this.reactions = new CrystalCaveReactions({
            scene: this.scene,
            anchors: this.atmosphere.anchors,
            quality: this.qualityPreset,
            uniforms: this.atmosphere.uniforms,
        });
        this.post = new CrystalCavePost({
            renderer: this.renderer, scene: this.scene, camera: this.camera, quality: this.quality,
        });
    }

    getGraphicsQuality() {
        return this.getCurrentQualityLevel();
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            crystalCount: this.atmosphere?.art.crystalCount ?? 0,
            reactions: this.reactions?.debug ?? null,
            post: this.post?.getDiagnostics?.() ?? null,
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
                if (this.gpuRecoveryAttempted) throw new Error('CrystalCave WebGPU recovery already attempted.');
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
        this.registerEventListener(window, 'pointermove', (event) => {
            if (!this.isActive || this.isPaused || event.pointerType === 'touch') return;
            this.pointer.x = THREE.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
            this.pointer.y = THREE.MathUtils.clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
        });
    }

    teardownEventListeners() {
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
    }

    onPieceLock(payload) {
        if (!this.effectsAllowed()
            || (typeof window !== 'undefined' && window.settings?.pieceLockRipple === false)) return;
        this.reactions?.pieceLock(eventDetail(payload));
    }

    onLineClear(payload) {
        if (!this.effectsAllowed()) return;
        const count = readCrystalCaveEventCount(payload, ['lineCount', 'count', 'lines'], 1);
        if (count <= 0) return;
        this.reactions?.lineClear(Math.max(1, Math.min(4, count)));
    }

    onCombo(payload) {
        if (!this.effectsAllowed()) return;
        const count = readCrystalCaveEventCount(payload, ['comboCount', 'combo', 'count'], 0);
        if (count > 0) this.reactions?.combo(Math.min(32, count));
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
        const dpr = this.getEffectivePixelRatio(this.qualityPreset.pixelRatio);
        if (this.appliedSize?.width === view.width && this.appliedSize?.height === view.height
            && this.appliedSize?.dpr === dpr) return;
        this.appliedSize = { width: view.width, height: view.height, dpr };
        this.camera.aspect = view.width / view.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(view.width, view.height);
        this.post?.setSize?.(view.width, view.height);
        this.atmosphere?.prepareCamera?.(this.camera.aspect);
    }

    update(delta) {
        const dt = Math.max(0, Math.min(MAX_DELTA_S, Number.isFinite(delta) ? delta : 0));
        this.time += dt;
        this.reactions?.update(dt, this.time);
        const smoothing = 1 - Math.exp(-dt * 3);
        this.smoothedPointer.x += (this.pointer.x - this.smoothedPointer.x) * smoothing;
        this.smoothedPointer.y += (this.pointer.y - this.smoothedPointer.y) * smoothing;
        this.atmosphere?.update(this.time, dt, this.smoothedPointer);
        const uniforms = this.atmosphere?.uniforms;
        this.post?.update?.({ energy: uniforms?.energy.value ?? 0, resonance: uniforms?.resonance.value ?? 0 });
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        if (this.post) this.post.render();
        else this.renderer.render(this.scene, this.camera);
    }

    warmEventPools() {
        if (!this.renderer || !this.scene || !this.camera || !this.reactions?.group) return 0;
        const reveal = revealHiddenDrawables(this.reactions.group, { camera: this.camera });
        try {
            this.reactions.group.updateMatrixWorld(true);
            // Use the shipped post/direct render so target and material context match
            // gameplay. The loading-surface session owns async pipeline completion.
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
        if (!this.renderer || !this.scene || !this.atmosphere) return false;
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
            try { value?.dispose?.(); } catch (error) { console.warn(`[CrystalCave] ${label} disposal failed.`, error); }
        };
        release('Post', this.post);
        this.post = null;
        release('Atmosphere', this.atmosphere);
        this.atmosphere = null;
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
        if (typeof window !== 'undefined' && window.__CRYSTAL_CAVE__ === this) delete window.__CRYSTAL_CAVE__;
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
