/**
 * Parhelion — "the hidden sun and its hounds" (BaseTheme wrapper).
 *
 * The scene IS the playground effect (src/playground/effects/parhelion.effect.js, the
 * halcyon-apex thin-wrapper shape): the 22° halo, the sundogs and the Vigil Stone that hides
 * the sun behind the board card. This class owns only the lifecycle around it (THEME_SPEC §4):
 *
 *   new ParhelionTheme() -> init() -> start() -> createScene(gen)
 *     -> [pause() / resume() + restartRenderLoop()]* -> cleanup()   (terminal, synchronous)
 *
 * - Renderer: WebGPURenderer (WebGPU, else its WebGL2 backend; ?forceWebGL /
 *   ?parhelionForceWebGL), NoToneMapping + SRGBColorSpace — the post chain tone-maps and
 *   encodes exactly once (spec §6).
 * - GPU loss: setupRendererResilience + one coordinated WebGPU → WebGL2 recovery.
 * - Gameplay: canonical bus events → ReactionDirector (stage only) → one cue per resolution
 *   → runtime.cue/count/setResonance/setLevel. Gated on isActive && !isPaused &&
 *   backgroundComboEffects; pieceLockRipple reaches the director through configure()
 *   (lockRipple), which drops LOCK/STONEFALL cues but still counts the lock — dropping the
 *   PIECE_LOCK event itself would break the true-combo tracker.
 * - Layout: DOM rects (composition/parhelion-board-rects.js) → runtime.setLayout, re-read inside
 *   the frame loop on frame time (now, +0.5 s, +1.5 s after a trigger); never from a handler.
 * - Warm: none shipped (small-theme law, spec §6: every pool is always visible with zero-size
 *   dormant slots). Add compileGroupThroughPost + one post render before the loop ONLY if the
 *   fixed perf lane shows an after-gap over 700 ms (n=3).
 *
 * Determinism: ?parhelionSeed=<int> seeds the runtime; ?parhelionFixedDt=<s> fixes the frame
 * step (values above 1 are read as milliseconds).
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import {
    CAM_REST,
    CAMERA_FAR,
    CAMERA_NEAR,
    E,
    VFOV_DEG,
} from '../../playground/effects/parhelion-composition.js';
import { create as createParhelionScene } from '../../playground/effects/parhelion.effect.js';
import { ParhelionBoardRects } from './composition/parhelion-board-rects.js';
import { PARHELION_EVENT_HANDLERS, ReactionDirector } from './sim/parhelion-reaction-director.js';
import { PARHELION_TETROMINOS } from './parhelion-tetrominos.js';

const THEME_ID = 'parhelion';
const LOG_PREFIX = '[Parhelion]';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
const DEFAULT_DELTA_S = 1 / 60;
const CLEAR_COLOR = 0x142C66;

/** Pixel-ratio cap per quality tier (spec §9); the desktop policy and renderScale still apply. */
const PIXEL_RATIO_CAP = Object.freeze({
    Minimal: 0.9,
    Low: 1.0,
    Medium: 1.15,
    High: 1.25,
    Ultra: 1.35,
    Extreme: 1.5,
});

/** Layout re-reads after a trigger (seconds of frame time): immediately, +0.5 s, +1.5 s. */
const LAYOUT_REREAD_OFFSETS = Object.freeze([0, 0.5, 1.5]);

/** Playground-only params that must never reach the in-game runtime (?board=1 mocks a board). */
const PLAYGROUND_ONLY_PARAMS = Object.freeze(['board', 't']);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readSearchParams() {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location?.search || '');
}

function readBoolParam(params, ...keys) {
    return keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        return value === null || value === '' || ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });
}

function readNumberParam(params, key) {
    const raw = params.get(key);
    if (raw === null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/** Seeded [0, 1) generator for ?parhelionSeed (same constants as the effect's mulberry32). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Settings payloads arrive in three shapes: the window 'settingsChanged' detail holds only the
 * changed keys; the bus SETTINGS_CHANGED carries `{ settings, source }` (a full snapshot) or
 * `{ type: 'renderScale', value }`. The payload can lead window.settings, so it wins.
 */
function readSettingUpdate(payload, key) {
    const detail = payload?.detail || payload || null;
    if (!detail) return { present: false, value: undefined };
    if (detail.type === key) {
        return { present: true, value: detail.value ?? detail[key] ?? detail.settings?.[key] };
    }
    const sources = [detail, detail.changed, detail.settings];
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key)) {
            return { present: true, value: source[key] };
        }
    }
    return { present: false, value: undefined };
}

function readSetting(payload, key) {
    const update = readSettingUpdate(payload, key);
    if (update.present) return update.value;
    return typeof window !== 'undefined' ? window.settings?.[key] : undefined;
}

function normalizeBooleanSetting(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no'].includes(normalized)) return false;
        if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    }
    return value === true;
}

export default class ParhelionTheme extends BaseTheme {
    constructor() {
        super(THEME_ID);
        // Documentary only: ThemeManager overwrites this from HEAVY_GPU_THEME_IDS.
        this.resourceProfile = 'heavy-gpu';

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.runtime = null;
        this.postProcessing = null;
        this.director = null;
        this.boardRects = new ParhelionBoardRects();

        this.isWebGPU = false;
        this.forceWebGL = false;
        this.quality = 'High';
        this.appliedAntialiasing = null;
        this.pendingQuality = null;
        this.pendingAntialiasing = null;
        this.appliedSize = null;
        this.runtimeGeneration = 0;

        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
        this.fixedDelta = 0;
        this.layoutDue = new Float64Array(LAYOUT_REREAD_OFFSETS.length).fill(Infinity);

        this.reducedMotion = false;
        this.comboEffectsEnabled = true;
        this.lockRippleEnabled = true;
        this.reducedMotionQuery = null;
        this.modeManager = null;

        this.rebuildQueued = false;
        this.rebuildPending = false;
        this.resizeQueued = false;
        this.eventUnsubscribers = [];
        this.gpuSurfaceUnregister = null;
        this.gpuRecoveryAttempted = false;
    }

    // ── build ───────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error(`${LOG_PREFIX} Theme container not found.`);

        this.disposeRuntime();
        const generation = ++this.runtimeGeneration;
        const isCurrent = () => generation === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        container.replaceChildren();
        const params = readSearchParams();
        this.quality = this.pendingQuality ?? normalizeQuality(readSetting(null, 'effectQuality'));
        const antialias = this.pendingAntialiasing ?? this.getAntialiasEnabled();
        this.pendingQuality = null;
        this.pendingAntialiasing = null;
        const buildSettings = this.getRendererSettingsSnapshot();

        const renderer = await this.createRenderer(ownerGeneration, antialias, params);
        if (!renderer) return; // cancelled: BaseTheme retires the stale start
        if (!isCurrent()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.appliedAntialiasing = antialias;
        renderer.setClearColor(CLEAR_COLOR, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'parhelion-renderer';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
            + 'z-index:0;pointer-events:none';
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();

        const viewport = getViewport();
        const width = Math.max(1, viewport.width || 1);
        const height = Math.max(1, viewport.height || 1);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(VFOV_DEG, width / height, CAMERA_NEAR, CAMERA_FAR);
        this.camera.position.set(CAM_REST.x, CAM_REST.y, CAM_REST.z);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(E, 0, 0);
        // Pixel ratio + size BEFORE create(): the runtime derives its pixel angle from them.
        this.resize(width, height);

        this.fixedDelta = this.readFixedDelta(params);
        try {
            this.runtime = createParhelionScene(this.createRuntimeContext(params, width, height));
            this.postProcessing = this.runtime.post?.pipeline ?? null;
            this.runtime.camera?.(0, this.camera);
            this.setupReactions();
            this.applyLayout();
        } catch (error) {
            console.error(`${LOG_PREFIX} Scene creation failed:`, error);
            if (generation === this.runtimeGeneration) this.disposeRuntime();
            throw error; // current-attempt failure -> start() rejects -> manager falls back
        }
        if (!isCurrent()) return;

        // Settings that changed while the renderer initialised had no listener yet.
        if (this.reconcileRendererSettings(buildSettings)) return;
        this.scheduleLayoutReads();
        this.animate();
        console.log(`${LOG_PREFIX} Scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'}, ${this.quality})`);
    }

    createRuntimeContext(params, width, height) {
        const runtimeParams = new URLSearchParams(params);
        PLAYGROUND_ONLY_PARAMS.forEach((key) => runtimeParams.delete(key));
        runtimeParams.set('quality', this.quality);
        const context = {
            THREE,
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            sizes: { width, height },
            params: runtimeParams,
            tier: this.quality,
        };
        const seed = readNumberParam(params, 'parhelionSeed');
        if (seed !== null) {
            context.seed = Math.trunc(seed);
            context.rng = mulberry32(context.seed);
        }
        return context;
    }

    readFixedDelta(params) {
        const raw = readNumberParam(params, 'parhelionFixedDt');
        if (raw === null || !(raw > 0)) return 0;
        const seconds = raw > 1 ? raw / 1000 : raw;
        return clamp(seconds, 1e-4, MAX_DELTA_S);
    }

    async createRenderer(ownerGeneration, antialias, params) {
        const wantWebGL = this.forceWebGL || readBoolParam(params, 'forceWebGL', 'parhelionForceWebGL');
        const canTryWebGPU = !wantWebGL && typeof navigator !== 'undefined' && !!navigator.gpu;
        const stillOwned = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;
        const attempt = (forceWebGL) => this.initializeRendererCandidate(
            new THREE.WebGPURenderer({
                antialias,
                alpha: false,
                forceWebGL,
                powerPreference: 'high-performance',
            }),
            {
                timeoutMs: RENDERER_INIT_TIMEOUT_MS,
                label: `Parhelion ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
                ownerGeneration,
            },
        );

        if (canTryWebGPU) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!stillOwned()) return null;
                console.warn(`${LOG_PREFIX} WebGPU init failed; trying the WebGL2 backend:`, error);
            }
        }
        if (!stillOwned()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!stillOwned()) return null;
            throw new Error('Parhelion could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    setupGpuResilience() {
        const { renderer } = this;
        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
        });
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        if (!this.isWebGPU) return; // WebGL2 backend: BaseTheme's CONTEXT_RESTORED restart covers it
        this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
            recover: async () => {
                if (this.gpuRecoveryAttempted) {
                    throw new Error('Parhelion WebGPU recovery already attempted.');
                }
                this.gpuRecoveryAttempted = true;
                this.forceWebGL = true; // one-shot retry on the WebGL2 backend
                if (this.isActive) await this.createScene();
            },
        });
    }

    // ── gameplay reactions ──────────────────────────────────────────────────────

    setupReactions() {
        this.director?.dispose();
        this.director = new ReactionDirector({
            sink: {
                cue: (c) => this.runtime?.cue?.(c),
                count: (n) => this.runtime?.count?.(n),
                resonance: (r) => this.runtime?.setResonance?.(r),
                levelUp: (n) => this.runtime?.setLevel?.(n),
            },
        });
        if (this.appliedSize) this.director.setViewport(this.appliedSize.w, this.appliedSize.h);
        this.reducedMotionQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this.applyReactionSettings(null);

        // createScene re-runs on every start() and rebuild: never stack a second set of bus
        // subscriptions or window listeners (every tracked listener of this theme is set here).
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        this.modeManager = null;

        Object.keys(PARHELION_EVENT_HANDLERS).forEach((key) => {
            const eventName = EVENTS[key];
            const method = PARHELION_EVENT_HANDLERS[key];
            if (!eventName || typeof this.director[method] !== 'function') return;
            this.eventUnsubscribers.push(eventBus.on(eventName, (payload) => {
                // Stage only: the director resolves in update(), first thing in the frame.
                if (this.effectsAllowed()) this.director?.[method](payload);
            }));
        });

        const onSettings = (payload) => this.handleSettingsChanged(payload);
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.SETTINGS_CHANGED, onSettings),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (viewport) => this.handleViewportResized(viewport)),
        );
        this.registerEventListener(window, 'settingsChanged', onSettings);
        this.registerEventListener(window, 'gameOver', () => this.resetReactions());
        if (typeof this.reducedMotionQuery?.addEventListener === 'function') {
            this.registerEventListener(this.reducedMotionQuery, 'change', () => this.applyReactionSettings(null));
        }
        this.ensureModeManagerListeners();
    }

    /** The mode manager may appear after the first build (boot prewarm); subscribe once it does. */
    ensureModeManagerListeners() {
        const manager = typeof window !== 'undefined' ? window.serenityBlocks?.gameModeManager : null;
        if (!manager?.on || manager === this.modeManager) return;
        this.modeManager = manager;
        const relayout = () => this.scheduleLayoutReads();
        this.eventUnsubscribers.push(
            manager.on('modeStarted', relayout),
            manager.on('modeActivated', relayout),
            manager.on('modeStopped', () => this.resetReactions()),
        );
    }

    effectsAllowed() {
        if (!this.isActive || this.isPaused || !this.comboEffectsEnabled) return false;
        return typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false;
    }

    prefersReducedMotion(payload) {
        if (normalizeBooleanSetting(readSetting(payload, 'reducedMotion'), false)) return true;
        if (this.reducedMotionQuery) return this.reducedMotionQuery.matches === true;
        return typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    }

    applyReactionSettings(payload) {
        this.reducedMotion = this.prefersReducedMotion(payload);
        this.comboEffectsEnabled = normalizeBooleanSetting(readSetting(payload, 'backgroundComboEffects'), true);
        this.lockRippleEnabled = normalizeBooleanSetting(readSetting(payload, 'pieceLockRipple'), true);
        const intensity = this.comboEffectsEnabled ? 1 : 0;
        // intensity 0 resets the director; lockRipple false drops LOCK/STONEFALL cues only.
        this.director?.configure({
            reducedMotion: this.reducedMotion,
            intensity,
            lockRipple: this.lockRippleEnabled,
        });
        this.runtime?.configure?.({ reducedMotion: this.reducedMotion, intensity });
    }

    /** Window 'gameOver' and modeStopped: forget chains, counts and the Lower Sun level. */
    resetReactions() {
        this.director?.reset();
        const { runtime } = this;
        if (!runtime) return;
        if (typeof runtime.resetSession === 'function') runtime.resetSession();
        else runtime.setLevel?.(1);
    }

    // ── settings ────────────────────────────────────────────────────────────────

    getRendererSettingsSnapshot() {
        return {
            quality: normalizeQuality(readSetting(null, 'effectQuality')),
            antialiasing: normalizeBooleanSetting(readSetting(null, 'enableAntialiasing'), this.getAntialiasEnabled()),
        };
    }

    /** True when a rebuild was queued for settings that moved during the async renderer init. */
    reconcileRendererSettings(buildStart) {
        const live = this.getRendererSettingsSnapshot();
        const qualityMoved = live.quality !== buildStart.quality && live.quality !== this.quality;
        const aaMoved = live.antialiasing !== buildStart.antialiasing
            && live.antialiasing !== this.appliedAntialiasing;
        if (!qualityMoved && !aaMoved) return false;
        if (qualityMoved) this.pendingQuality = live.quality;
        if (aaMoved) this.pendingAntialiasing = live.antialiasing;
        this.queueRebuild();
        return true;
    }

    handleSettingsChanged(payload) {
        if (!this.renderer) return;
        const qualityUpdate = readSettingUpdate(payload, 'effectQuality');
        const requestedQuality = this.pendingQuality ?? this.quality;
        const nextQuality = qualityUpdate.present ? normalizeQuality(qualityUpdate.value) : requestedQuality;
        const aaUpdate = readSettingUpdate(payload, 'enableAntialiasing');
        const requestedAA = this.pendingAntialiasing ?? this.appliedAntialiasing ?? this.getAntialiasEnabled();
        const nextAA = aaUpdate.present ? normalizeBooleanSetting(aaUpdate.value, requestedAA) : requestedAA;
        if (nextQuality !== requestedQuality || nextAA !== requestedAA) {
            // The tier changes the graph shape (and AA is a renderer constructor option).
            this.pendingQuality = nextQuality;
            this.pendingAntialiasing = nextAA;
            this.queueRebuild();
            return;
        }
        this.applyReactionSettings(payload);
        // renderScale (incl. the adaptive PERFORMANCE_DOWNSCALE re-emit) = pixel ratio only.
        if (readSettingUpdate(payload, 'renderScale').present) this.queueResize();
    }

    /** Deferred a microtask so main.js has applied setGlobalRenderScale() first. */
    queueResize() {
        if (this.resizeQueued) return;
        this.resizeQueued = true;
        const scheduled = this.runtimeGeneration;
        queueMicrotask(() => {
            this.resizeQueued = false;
            if (!this.isActive || scheduled !== this.runtimeGeneration) return;
            const { width, height } = getViewport();
            this.resize(width, height);
        });
    }

    queueRebuild() {
        if (this.rebuildQueued) return;
        this.rebuildQueued = true;
        const scheduled = this.runtimeGeneration;
        queueMicrotask(() => {
            this.rebuildQueued = false;
            if (!this.isActive || scheduled !== this.runtimeGeneration) return;
            if (this.isPaused) {
                this.rebuildPending = true; // rebuild on resume, never behind the menu
                return;
            }
            this.createScene().catch((error) => {
                console.error(`${LOG_PREFIX} Settings rebuild failed:`, error);
                this.onRuntimeFailure?.(error);
            });
        });
    }

    // ── size + layout ───────────────────────────────────────────────────────────

    handleViewportResized(viewport) {
        const view = viewport?.width > 0 && viewport?.height > 0 ? viewport : getViewport();
        this.resize(view.width, view.height);
    }

    /** The ThemeManager resize funnel (CSS px). Deduplicated; re-reads the rects after a change. */
    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        const pixelRatio = this.getEffectivePixelRatio(PIXEL_RATIO_CAP[this.quality] ?? PIXEL_RATIO_CAP.High, 'theme');
        const last = this.appliedSize;
        if (last && last.w === w && last.h === h && last.pixelRatio === pixelRatio) return;
        this.appliedSize = { w, h, pixelRatio };
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(w, h, false);
        this.runtime?.resize?.(w, h, pixelRatio);
        this.director?.setViewport(w, h);
        this.boardRects.invalidate();
        this.scheduleLayoutReads();
    }

    /** Arms the frame-time re-reads (no timers): now, +0.5 s and +1.5 s. */
    scheduleLayoutReads() {
        for (let index = 0; index < LAYOUT_REREAD_OFFSETS.length; index += 1) {
            this.layoutDue[index] = this.elapsedTime + LAYOUT_REREAD_OFFSETS[index];
        }
    }

    processLayoutReads() {
        let due = false;
        for (let index = 0; index < this.layoutDue.length; index += 1) {
            if (this.elapsedTime >= this.layoutDue[index]) {
                this.layoutDue[index] = Infinity;
                due = true;
            }
        }
        if (due) this.applyLayout();
    }

    applyLayout() {
        if (!this.runtime) return;
        this.ensureModeManagerListeners();
        this.boardRects.invalidate();
        this.runtime.setLayout?.(this.boardRects.read());
    }

    // ── frame loop ──────────────────────────────────────────────────────────────

    animate() {
        if (this.animationLoopStarted || !this.runtime || !this.renderer) return;
        this.animationLoopStarted = true;
        this.lastFrameTimeMs = null;
        this.animationDriver = this.safeAnimate((timestamp) => this.stepFrame(timestamp), {
            maxConsecutiveErrors: 3,
        });
        const animationId = requestAnimationFrame(this.animationDriver);
        this.registerAnimation(animationId);
    }

    frameDelta(timestamp) {
        const previous = this.lastFrameTimeMs;
        this.lastFrameTimeMs = timestamp;
        if (this.fixedDelta > 0) return this.fixedDelta;
        if (previous === null) return DEFAULT_DELTA_S;
        const raw = (timestamp - previous) / 1000;
        return Number.isFinite(raw) ? clamp(raw, 0, MAX_DELTA_S) : DEFAULT_DELTA_S;
    }

    stepFrame(timestamp) {
        const { runtime } = this;
        if (!runtime) return;
        const delta = this.frameDelta(timestamp);
        this.elapsedTime += delta;
        // 1. Cues land this frame: resolve the gameplay staged since the last frame FIRST.
        this.director?.update(delta);
        // 2. Rest pose + breathing, then optics state → uniforms (+ the theme's own shake).
        runtime.camera?.(this.elapsedTime, this.camera);
        runtime.update(this.elapsedTime, delta);
        // 3. Present (post pipeline, or direct at Minimal).
        runtime.render();
        // 4. Scheduled DOM rect re-reads on frame time.
        this.processLayoutReads();
    }

    // ── teardown ────────────────────────────────────────────────────────────────

    disposeRuntime() {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.clearEventUnsubscribers();
        this.eventUnsubscribers = [];
        this.clearTrackedResources();
        this.removeRendererResilience(); // before the device is destroyed: a dispose is not a loss
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;

        if (this.director) {
            try {
                this.director.dispose();
            } catch (error) {
                console.warn(`${LOG_PREFIX} Director dispose failed:`, error);
            }
            this.director = null;
        }

        const { runtime } = this;
        this.runtime = null;
        this.postProcessing = null; // owned (and disposed) by the runtime's ParhelionPost
        if (runtime) {
            try {
                runtime.dispose?.();
            } catch (error) {
                console.warn(`${LOG_PREFIX} Runtime dispose failed:`, error);
            }
        }

        this.scene?.clear?.();
        this.scene = null;
        this.camera = null;

        if (this.renderer) {
            const { renderer } = this;
            this.renderer = null;
            let canvas = null;
            try {
                canvas = renderer.domElement;
            } catch (error) {
                canvas = null;
            }
            // Stops the loop, quiesces timestamp queries, destroys the owned device.
            this.disposeRenderer(renderer, { nullInstance: false });
            if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
        }

        this.boardRects.invalidate();
        this.layoutDue.fill(Infinity);
        this.modeManager = null;
        this.reducedMotionQuery = null;
        this.isWebGPU = false;
        this.appliedSize = null;
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
    }

    // ── lifecycle hooks ─────────────────────────────────────────────────────────

    async whenCriticalReady() {
        return !!(this.runtime && this.renderer && this.scene && this.camera);
    }

    /** No parked drawables: every pool is always visible with zero-size dormant slots (spec §6). */
    getWarmupRoots() {
        return [];
    }

    /** Single-output scene pass: the manager's bare prewarm compileAsync has nothing to poison. */
    usesMrtScenePass() {
        return false;
    }

    getTetrominoConfig() {
        return PARHELION_TETROMINOS;
    }

    getDiagnostics() {
        return {
            ...(this.runtime?.getDiagnostics?.() || {}),
            lifecycle: this.lifecycleState,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.quality,
            pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
            reducedMotion: this.reducedMotion,
            director: this.director?.getDebugState?.() ?? null,
        };
    }

    pause() {
        const paused = super.pause();
        if (paused) this.lastFrameTimeMs = null;
        return paused;
    }

    resume() {
        if (!this.runtime || !this.renderer || !this.scene || !this.camera) return false; // full restart
        const resumed = super.resume();
        if (resumed) {
            this.lastFrameTimeMs = null;
            // ThemeManager.resize reaches only the ACTIVE theme: catch up on resizes missed while parked.
            const { width, height } = getViewport();
            this.resize(width, height);
            this.boardRects.invalidate();
            this.scheduleLayoutReads();
            this.ensureModeManagerListeners();
            if (this.rebuildPending) {
                this.rebuildPending = false;
                this.queueRebuild();
            }
        }
        return resumed;
    }

    stop() {
        super.stop();
        this.disposeRuntime();
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
