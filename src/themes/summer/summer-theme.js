/**
 * Summer — Midsummer's Eve by the lake, shared with the isolated playground.
 * The theme owns lifecycle, renderer, asset loading and gameplay subscriptions;
 * SummerWorld owns the artwork (the flowering meadow, Blender-grown birch and spruce, the
 * cottage, the maypole, the mirror lake, light and air) and SummerReactions owns bounded,
 * seconds-based event envelopes. Both renderer backends use the same node scene and
 * RenderPipeline.
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { seededRandom } from '../../utils/helpers.js';
import { disposeSummerAssets, loadSummerAssets } from './summer-assets.js';
import { readSummerBoardRect } from './summer-stage.js';
import { SUMMER_TETROMINOS } from './summer-tetrominos.js';
import { SummerWorld } from './summer-world.js';
import { SummerReactions } from './summer-reactions.js';
import { SummerPost } from './summer-post.js';
import { SUMMER_TIERS } from './summer-quality.js';

const INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
const BOARD_POLL_S = 0.75;
const PIXEL_RATIO_CAP = Object.freeze({
    Extreme: 1.5, Ultra: 1.35, High: 1.25, Medium: 1, Low: 0.9, Minimal: 0.75,
});

// The preset a tier reports to generic readers. What it really draws is set by
// SUMMER_TIERS in summer-quality.js and reported by world.getDiagnostics().
export const QUALITY_PRESETS = Object.freeze(Object.fromEntries(
    Object.entries(SUMMER_TIERS).map(([name, tier]) => [name, Object.freeze({
        petalCount: tier.petals,
        flowerCount: tier.flowersNear + tier.flowersFar,
        birdCount: tier.birds,
        enablePost: tier.post,
        enablePostProcessing: tier.post,
    })]),
));

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

function settingUpdate(payload, key) {
    const detail = eventDetail(payload);
    if (!detail || typeof detail !== 'object') return { present: false };
    if (detail.type === key) {
        return { present: true, value: detail.value ?? detail[key] ?? detail.settings?.[key] };
    }
    for (const source of [detail, detail.changed, detail.settings]) {
        if (source && Object.prototype.hasOwnProperty.call(source, key)) {
            return { present: true, value: source[key] };
        }
    }
    return { present: false };
}

function enabledSetting(value, fallback = true) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no'].includes(normalized)) return false;
        if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    }
    return value !== false;
}

/** Accept the bus's canonical fields, historical aliases and DOM detail envelopes. */
export function readSummerEventCount(payload, keys, fallback) {
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

export default class SummerTheme extends BaseTheme {
    constructor() {
        super('summer');
        this.resourceProfile = 'heavy-gpu';
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.world = null;
        this.reactions = null;
        this.post = null;
        this.assets = null;
        this.timer = null;
        this.time = 0;
        this.boardPoll = 0;
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
        this.pointer = {
            x: 0, y: 0, sx: 0, sy: 0,
        };
        this.restPosition = new THREE.Vector3(0, 4.7, 14.5);
        this.restTarget = new THREE.Vector3(0, 1.2, -45.5);
        this.cameraDirection = new THREE.Vector3();
        this.reducedMotion = false;
        this.comboEffects = true;
        this.lockRipple = true;
        this.renderFailureReported = false;
    }

    getTetrominoConfig() {
        return SUMMER_TETROMINOS;
    }

    getWarmupRoots() {
        return this.world?.group ? [this.world.group] : [];
    }

    usesMrtScenePass() {
        return false;
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
        const container = document.getElementById('summer-theme');
        if (!container) throw new Error('[Summer] Theme container not found.');
        this.disposeRuntime();
        const runtimeGeneration = ++this.runtimeGeneration;
        const current = () => runtimeGeneration === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        const initialSettingsQuality = this.getCurrentQualityLevel();
        this.applyQualityPreset(this.pendingQuality ?? initialSettingsQuality);
        this.pendingQuality = null;
        this.rebuildPending = false;
        this.renderFailureReported = false;
        this.pointer.x = 0;
        this.pointer.y = 0;
        this.pointer.sx = 0;
        this.pointer.sy = 0;

        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return;
        if (!current()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        // Settings listeners are detached while the replacement renderer starts.
        // Reconcile an intervening settings change before any artwork is built,
        // while retaining an explicit event target if global settings stayed put.
        let seenSettingsQuality = this.getCurrentQualityLevel();
        if (seenSettingsQuality !== initialSettingsQuality) this.applyQualityPreset(seenSettingsQuality);
        this.renderer = renderer;
        this.usesNodeMaterials = renderer.isWebGPURenderer === true;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setClearColor(0x9fc0d8, 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        // The meadow and its trees are lit through one static shadow map of the low sun.
        renderer.shadowMap.enabled = true;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        // The registry's static container is never registered for removal.
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();
        let assets = null;
        try {
            assets = await this.loadAssets(current);
        } catch (error) {
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }
        if (!assets || !current()) {
            // A newer start, stop or cleanup owns the theme now; this one keeps nothing.
            disposeSummerAssets(assets);
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            return;
        }
        this.assets = assets;
        // The same reconciliation again: the pack is the same for every tier, so a change
        // made while it loaded only has to pick the tier the meadow is built at.
        const loadedSettingsQuality = this.getCurrentQualityLevel();
        if (loadedSettingsQuality !== seenSettingsQuality) {
            seenSettingsQuality = loadedSettingsQuality;
            this.applyQualityPreset(loadedSettingsQuality);
        }
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
            if (enabledParam(searchParams(), 'themeValidation')) window.__SUMMER__ = this;
            if (!this.isPaused && current()) this.startAnimation();
        } catch (error) {
            if (runtimeGeneration === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }
    }

    async createRenderer(ownerGeneration) {
        const forceWebGL = this.forceWebGL || enabledParam(searchParams(), 'forceWebGL', 'summerForceWebGL');
        const current = () => ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        const attempt = (force) => this.initializeRendererCandidate(new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL: force,
            powerPreference: 'high-performance',
        }), {
            timeoutMs: INIT_TIMEOUT_MS,
            label: `Summer ${force ? 'WebGL2' : 'WebGPU'} renderer init`,
            ownerGeneration,
        });
        if (!forceWebGL && typeof navigator !== 'undefined' && navigator.gpu) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!current()) return null;
                console.warn('[Summer] WebGPU initialization failed; trying node WebGL2.', error);
            }
        }
        if (!current()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!current()) return null;
            throw new Error('Summer could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    /** Trees, sprays, props and sprites authored in Blender; see summer-assets.js. */
    loadAssets(isCurrent = () => true) {
        return loadSummerAssets({ isCurrent });
    }

    buildScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3400);
        this.camera.position.set(0, 4.7, 14.5);
        this.camera.lookAt(0, 1.2, -45.5);
        const rawSeed = searchParams().get('summerSeed');
        const seed = rawSeed === null || rawSeed === '' ? 624 : Number(rawSeed);
        const rng = seededRandom(Number.isFinite(seed) ? seed : 624);
        this.reactions = new SummerReactions({ quality: this.quality, rng });
        this.world = new SummerWorld({
            scene: this.scene, camera: this.camera, quality: this.quality, rng, assets: this.assets,
        });
        // Keep ownership even if an art module throws halfway through its build.
        this.world.build();
        // SummerPost retains the same artwork on both node backends.
        this.post = new SummerPost({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            quality: this.quality,
            light: this.world.light,
        });
        this.boardPoll = 0;
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
                if (this.gpuRecoveryAttempted) throw new Error('Summer WebGPU recovery already attempted.');
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
            && (typeof document === 'undefined' || document.hidden !== true)
            && (typeof window === 'undefined' || window.isRenderingPaused !== true)
            && this.comboEffects;
    }

    setupEventListeners() {
        this.teardownEventListeners();
        this.comboEffects = enabledSetting(window.settings?.backgroundComboEffects);
        this.lockRipple = enabledSetting(window.settings?.pieceLockRipple);
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.HARD_DROP, (payload) => this.onHardDrop(payload)),
            eventBus.on(EVENTS.PIECE_LOCK, (payload) => this.onPieceLock(payload)),
            eventBus.on(EVENTS.LINE_CLEAR, (payload) => this.onLineClear(payload)),
            eventBus.on(EVENTS.COMBO, (payload) => this.onCombo(payload)),
            eventBus.on(EVENTS.TSPIN, (payload) => this.onFlourish('onTSpin', payload)),
            eventBus.on(EVENTS.B2B, (payload) => this.onFlourish('onBackToBack', payload)),
            eventBus.on(EVENTS.PERFECT_CLEAR, (payload) => this.onFlourish('onPerfectClear', payload)),
            eventBus.on(EVENTS.LEVEL_UP, (payload) => this.onFlourish('onLevelUp', payload)),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (view) => this.resize(view?.width, view?.height)),
            eventBus.on(EVENTS.SETTINGS_CHANGED, (payload) => this.handleSettingsChanged(payload)),
        );
        this.registerEventListener(window, 'settingsChanged', (payload) => this.handleSettingsChanged(payload));
        this.registerEventListener(window, 'gameOver', () => this.reactions?.onGameOver());
        this.registerEventListener(window, 'pointermove', (event) => {
            if (!this.isActive || this.isPaused || this.reducedMotion) return;
            if (event.pointerType && event.pointerType !== 'mouse') return;
            this.pointer.x = THREE.MathUtils.clamp((event.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1);
            this.pointer.y = THREE.MathUtils.clamp((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1, -1, 1);
        });
        const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const updateMotion = () => {
            this.reducedMotion = motionQuery?.matches === true;
            if (this.reducedMotion) {
                this.pointer.x = 0;
                this.pointer.y = 0;
                this.pointer.sx = 0;
                this.pointer.sy = 0;
            }
        };
        updateMotion();
        if (motionQuery?.addEventListener) {
            this.registerEventListener(motionQuery, 'change', updateMotion);
        }
    }

    teardownEventListeners() {
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
    }

    onHardDrop(payload) {
        if (!this.effectsAllowed() || !this.lockRipple) return;
        // The payload's piece is pooled and reset after this call: read it synchronously.
        this.reactions?.onHardDrop(eventDetail(payload));
    }

    onPieceLock(payload) {
        if (!this.effectsAllowed() || !this.lockRipple) return;
        this.reactions?.onPieceLock(eventDetail(payload));
    }

    /** T-spins, back-to-backs, perfect clears and level-ups share one gate. */
    onFlourish(method, payload) {
        if (!this.effectsAllowed()) return;
        this.reactions?.[method]?.(eventDetail(payload));
    }

    onLineClear(payload) {
        if (!this.effectsAllowed()) return;
        const count = readSummerEventCount(payload, ['lineCount', 'count', 'lines'], 1);
        if (count <= 0) return;
        this.reactions?.onLineClear(Math.max(1, Math.min(4, count)), eventDetail(payload));
    }

    onCombo(payload) {
        if (!this.effectsAllowed()) return;
        const count = readSummerEventCount(payload, ['comboCount', 'combo', 'count'], 0);
        this.reactions?.onCombo(Math.max(0, Math.min(32, count)), eventDetail(payload));
    }

    handleSettingsChanged(payload) {
        if (!this.isActive || !this.renderer) return;
        const effects = settingUpdate(payload, 'backgroundComboEffects');
        if (effects.present) {
            this.comboEffects = enabledSetting(effects.value);
            if (!this.comboEffects) {
                this.reactions?.reset();
                this.world?.resetEffects?.();
            }
        }
        const lock = settingUpdate(payload, 'pieceLockRipple');
        if (lock.present) this.lockRipple = enabledSetting(lock.value);
        const quality = settingUpdate(payload, 'effectQuality');
        const legacyQuality = settingUpdate(payload, 'graphicsQuality');
        let requestedQuality = { present: false };
        if (quality.present) requestedQuality = quality;
        else if (window.settings?.effectQuality === undefined) requestedQuality = legacyQuality;
        if (requestedQuality.present
            && normalizeQuality(requestedQuality.value) !== (this.pendingQuality ?? this.quality)) {
            const nextQuality = normalizeQuality(requestedQuality.value);
            if (nextQuality === this.quality) {
                this.pendingQuality = null;
                this.rebuildPending = false;
            } else {
                this.pendingQuality = nextQuality;
                this.queueRebuild();
            }
            return;
        }
        if (settingUpdate(payload, 'renderScale').present) {
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
            if (!this.isActive || generation !== this.runtimeGeneration
                || this.pendingQuality === null || this.pendingQuality === this.quality) return;
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
        this.world?.prepareCamera?.(this.camera.aspect);
        this.restPosition.copy(this.camera.position);
        this.camera.getWorldDirection(this.cameraDirection);
        this.restTarget.copy(this.camera.position).addScaledVector(this.cameraDirection, 60);
    }

    update(delta) {
        const dt = Math.max(0, Math.min(MAX_DELTA_S, Number.isFinite(delta) ? delta : 0));
        this.time += dt;
        this.reactions?.update(dt);
        const frame = this.reactions?.getFrame();
        this.boardPoll -= dt;
        if (this.boardPoll <= 0) {
            // The board card can move (mode, resize, multiplayer); follow it cheaply.
            this.boardPoll = BOARD_POLL_S;
            this.world?.setBoard?.(readSummerBoardRect());
        }
        this.updateCamera(dt);
        this.world?.update(this.time, dt, frame);
        this.post?.update?.({ ...frame, time: this.time });
    }

    updateCamera(dt) {
        if (!this.camera) return;
        const blend = 1 - Math.exp(-dt * 3.2);
        this.pointer.sx += (this.pointer.x - this.pointer.sx) * blend;
        this.pointer.sy += (this.pointer.y - this.pointer.sy) * blend;
        const x = this.reducedMotion ? 0 : this.pointer.sx;
        const y = this.reducedMotion ? 0 : this.pointer.sy;
        this.camera.position.copy(this.restPosition);
        this.camera.position.x += x * 0.48;
        this.camera.position.y -= y * 0.22;
        this.camera.lookAt(this.restTarget.x + x * 0.2, this.restTarget.y - y * 0.08, this.restTarget.z);
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
            try {
                this.timer.update(timestamp);
                this.update(this.timer.getDelta());
                this.renderFrame();
            } catch (error) {
                this.pause();
                if (!this.renderFailureReported) {
                    this.renderFailureReported = true;
                    console.error('[Summer] Render failed.', error);
                    this.onRuntimeFailure?.(error);
                }
            }
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
            try { value?.dispose?.(); } catch (error) {
                console.warn(`[Summer] ${label} disposal failed.`, error);
            }
        };
        release('Post', this.post);
        this.post = null;
        release('World', this.world);
        this.world = null;
        release('Assets', { dispose: () => disposeSummerAssets(this.assets) });
        this.assets = null;
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
        if (typeof window !== 'undefined' && window.__SUMMER__ === this) delete window.__SUMMER__;
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
