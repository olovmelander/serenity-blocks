/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Koi Pond — "Moonwake Sanctuary" production adapter.
 *
 * The visual implementation lives in rendering/koi-pond-runtime.js and is
 * shared with the playground proof. This class owns only BaseTheme lifecycle,
 * backend selection, gameplay-event forwarding, quality changes, warmup, and
 * deterministic teardown.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { getViewport } from '../../utils/viewport.js';
import { KOI_POND_TETROMINOS } from './koi-pond-tetrominos.js';
import {
    KOI_POND_LAYOUT,
    getKoiPondPixelRatioCap,
    normalizeKoiPondQuality,
} from './rendering/koi-pond-layout.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';
import { createKoiPondRuntime } from './rendering/koi-pond-runtime.js';
import { KoiPondPost, getKoiPondPostProfile } from './rendering/koi-pond-post.js';

const RENDERER_INIT_TIMEOUT_MS = 5_500;
const PERFORMANCE_SAMPLE_LIMIT = 240;
// Reduced-motion idle frames present at ~32 fps; full rate resumes on any reaction.
const REDUCED_MOTION_FRAME_MS = 1000 / 32;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readBoolParam(...keys) {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        return value === null
            || value === ''
            || ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
    });
}

function readSettingUpdate(payload, key) {
    const detail = payload?.detail || payload || {};
    if (detail.type === key) {
        return {
            present: true,
            value: detail.value
                ?? detail[key]
                ?? detail.changed?.[key]
                ?? detail.settings?.[key],
        };
    }
    const sources = [detail, detail.changed, detail.settings];
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (source && Object.prototype.hasOwnProperty.call(source, key)) {
            return { present: true, value: source[key] };
        }
    }
    return { present: false, value: undefined };
}

function isDirectSettingUpdate(payload, key) {
    const detail = payload?.detail || payload || {};
    return detail.type === key
        || Object.prototype.hasOwnProperty.call(detail, key)
        || (
            detail.changed
            && Object.prototype.hasOwnProperty.call(detail.changed, key)
        );
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

export default class KoiPondTheme extends BaseTheme {
    constructor() {
        super('koi-pond');

        this.resourceProfile = 'heavy-gpu';
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.runtime = null;
        this.post = null;
        this.isWebGPU = false;
        this.quality = 'High';
        this.forceWebGL = false;
        this.runtimeGeneration = 0;
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        this.lastRenderTimeMs = null;
        this.elapsedTime = 0;
        this.eventUnsubscribers = [];
        this.reducedMotionQuery = null;
        this.gpuSurfaceUnregister = null;
        this.gpuRecoveryAttempted = false;
        this.settingsRebuildQueued = false;
        this.performanceEnabled = false;
        this.frameSamples = [];
        this.diagnosticsApi = null;
        this.appliedAntialiasing = null;
        this.pendingQuality = null;
        this.pendingAntialiasing = null;
        this.settingsResizeQueued = false;
    }

    getQualitySetting() {
        if (typeof window === 'undefined') return 'High';
        const params = new URLSearchParams(window.location.search);
        return normalizeKoiPondQuality(
            params.get('koiQuality')
                || params.get('quality')
                || window.settings?.effectQuality
                || window.settings?.graphicsQuality
                || 'High',
        );
    }

    getRuntimeParams() {
        const params = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        if (!params.has('quality')) params.set('quality', this.quality);
        return params;
    }

    prefersReducedMotion() {
        if (typeof window === 'undefined') return false;
        return window.settings?.reducedMotion === true
            || this.reducedMotionQuery?.matches === true
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    }

    getEffectsIntensity() {
        if (typeof window === 'undefined') return 1;
        if (window.settings?.backgroundComboEffects === false) return 0;
        // Reduced-motion shaping belongs to the routing/runtime layer. Keeping
        // this as a simple on/off gate avoids multiplying the same attenuation
        // through the theme, router, and renderer until seals become illegible.
        return 1;
    }

    effectsAllowed(eventName) {
        if (!this.isActive || this.isPaused) return false;
        if (typeof window !== 'undefined' && window.settings?.backgroundComboEffects === false) {
            return false;
        }
        if (
            eventName === 'PIECE_LOCK'
            && typeof window !== 'undefined'
            && window.settings?.pieceLockRipple === false
        ) {
            return false;
        }
        return true;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error('[KoiPond] Theme container not found.');

        this.disposeRuntime();
        // Koi Pond owns the complete background. The shared transparent renderer
        // would otherwise keep a second zero-draw loop alive behind this canvas.
        this.webglRenderer?.stop?.();
        const generation = ++this.runtimeGeneration;

        container.replaceChildren();
        container.style.overflow = 'hidden';
        container.style.background = '#020b0a';

        this.quality = this.pendingQuality ?? this.getQualitySetting();
        const antialiasOverride = this.pendingAntialiasing;
        this.pendingQuality = null;
        this.pendingAntialiasing = null;
        const rendererSettingsAtBuildStart = this.getRendererSettingsSnapshot();
        this.performanceEnabled = readBoolParam('koiPerf', 'koiProfile', 'profile');
        this.frameSamples = [];
        this.reducedMotionQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;

        const rendererReady = await this.initRenderer(
            container,
            generation,
            antialiasOverride,
            ownerGeneration,
        );
        if (!rendererReady
            || generation !== this.runtimeGeneration
            || ownerGeneration !== this.lifecycleGeneration) return;

        const viewport = getViewport();
        const width = Math.max(1, viewport.width);
        const height = Math.max(1, viewport.height);
        const cameraLayout = KOI_POND_LAYOUT.camera;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            cameraLayout.fov,
            width / height,
            cameraLayout.near,
            cameraLayout.far,
        );

        try {
            this.runtime = createKoiPondRuntime({
                scene: this.scene,
                camera: this.camera,
                renderer: this.renderer,
                params: this.getRuntimeParams(),
                quality: this.quality,
                reducedMotion: this.prefersReducedMotion(),
                intensity: this.getEffectsIntensity(),
            });
            this.runtime.camera?.(0, this.camera);
            this.applyRuntimeSettings();
            // Water sets ACES on the renderer for its standalone playground proof.
            // The theme owns grading through the AgX post chain instead, so the
            // renderer must not double tone-map — renderOutput applies the
            // renderer's NoToneMapping + sRGB OETF to the post graph's linear output.
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.createPost();
            await this.warmRuntime(generation);
        } catch (error) {
            console.error('[KoiPond] Moonwake Sanctuary creation failed:', error);
            if (generation === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }

        if (generation !== this.runtimeGeneration || !this.isActive) return;
        // Listen only after the async renderer warmup. Any quality/AA change
        // that landed during that gap is reconciled immediately below, which
        // avoids rebuilding a renderer while its pipelines are still compiling.
        this.setupEventListeners();
        if (this.reconcileRendererSettings(rendererSettingsAtBuildStart)) return;
        this.installDiagnostics();
        this.animate();
        console.log(
            `[KoiPond] Moonwake Sanctuary ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'}, ${this.quality})`,
        );
    }

    async createRendererCandidate(forceWebGL, antialiasEnabled = this.getAntialiasEnabled()) {
        const renderer = new THREE.WebGPURenderer({
            antialias: antialiasEnabled,
            alpha: false,
            forceWebGL,
            powerPreference: 'high-performance',
        });
        let timeoutId = null;
        let timeoutWon = false;
        const disposeCandidate = () => {
            try { renderer.setAnimationLoop?.(null); } catch (error) { /* noop */ }
            try { renderer.dispose(); } catch (error) { /* noop */ }
        };
        const initPromise = Promise.resolve().then(() => renderer.init());

        try {
            await Promise.race([
                initPromise,
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => {
                            timeoutWon = true;
                            reject(new Error('Renderer init timeout'));
                        },
                        RENDERER_INIT_TIMEOUT_MS,
                    );
                }),
            ]);
            return renderer;
        } catch (error) {
            if (timeoutWon) {
                // Three r181's dispose() is a no-op before init completes. The
                // backend init itself is not abortable, so dispose on late
                // success to prevent a timed-out candidate from stranding its
                // managers/animation loop after fallback has already started.
                initPromise.then(disposeCandidate, disposeCandidate);
            } else {
                disposeCandidate();
            }
            throw error;
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    }

    async initRenderer(
        container,
        generation,
        antialiasOverride = null,
        ownerGeneration = this.lifecycleGeneration,
    ) {
        const requestedWebGL = this.forceWebGL
            || readBoolParam('forceWebGL', 'koiForceWebGL');
        const canAttemptWebGPU = !requestedWebGL
            && typeof navigator !== 'undefined'
            && !!navigator.gpu;
        const antialiasEnabled = typeof antialiasOverride === 'boolean'
            ? antialiasOverride
            : this.getAntialiasEnabled();
        let renderer = null;

        if (canAttemptWebGPU) {
            try {
                renderer = await this.createRendererCandidate(false, antialiasEnabled);
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose();
                    renderer = null;
                }
            } catch (error) {
                if (generation !== this.runtimeGeneration
                    || ownerGeneration !== this.lifecycleGeneration
                    || !this.isActive
                    || this.cleanupComplete) return false;
                console.warn('[KoiPond] WebGPU init failed; trying WebGL2:', error);
            }
        }

        if (!renderer) {
            if (generation !== this.runtimeGeneration
                || ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) return false;
            try {
                renderer = await this.createRendererCandidate(true, antialiasEnabled);
            } catch (error) {
                if (generation === this.runtimeGeneration
                    && ownerGeneration === this.lifecycleGeneration
                    && this.isActive
                    && !this.cleanupComplete) {
                    const message = document.createElement('div');
                    message.textContent = 'Koi Pond needs WebGPU or WebGL2.';
                    message.style.cssText = [
                        'color:#c9e5d8',
                        'font-family:sans-serif',
                        'padding:2em',
                        'text-align:center',
                    ].join(';');
                    container.replaceChildren(message);
                }
                throw new Error('Koi Pond could not initialize WebGPU or WebGL2.', {
                    cause: error,
                });
            }
        }

        if (generation !== this.runtimeGeneration
            || ownerGeneration !== this.lifecycleGeneration
            || !this.isActive
            || this.cleanupComplete) {
            renderer.dispose();
            return false;
        }

        const viewport = getViewport();
        const width = Math.max(1, viewport.width);
        const height = Math.max(1, viewport.height);
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.appliedAntialiasing = antialiasEnabled;
        renderer.setPixelRatio(this.getEffectivePixelRatio(
            getKoiPondPixelRatioCap(this.quality),
            'theme',
        ));
        renderer.setSize(width, height, false);
        renderer.setClearColor(0x020b0a, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'koi-pond-renderer';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = [
            'position:absolute',
            'inset:0',
            'width:100%',
            'height:100%',
            'z-index:0',
            'pointer-events:none',
        ].join(';');
        container.appendChild(renderer.domElement);

        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
        });
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        if (this.isWebGPU) {
            this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
                recover: async () => {
                    if (this.gpuRecoveryAttempted) {
                        throw new Error('Koi Pond WebGPU recovery already attempted.');
                    }
                    this.gpuRecoveryAttempted = true;
                    this.forceWebGL = true;
                    if (this.isActive) await this.createScene();
                },
            });
        }
        return true;
    }

    createPost() {
        this.disposePost();
        if (!this.renderer || !this.scene || !this.camera) return;
        const profile = getKoiPondPostProfile(this.quality);
        if (!profile.enabled) return;
        try {
            this.post = new KoiPondPost(this.renderer, this.scene, this.camera, profile);
            const viewport = getViewport();
            this.post.setSize(
                Math.max(1, viewport.width),
                Math.max(1, viewport.height),
            );
        } catch (error) {
            console.warn('[KoiPond] Post-processing setup failed; rendering unblended:', error);
            this.disposePost();
        }
    }

    disposePost() {
        if (!this.post) return;
        try {
            this.post.dispose();
        } catch (error) {
            console.warn('[KoiPond] Post-processing cleanup failed:', error);
        }
        this.post = null;
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        if (this.post) {
            this.post.update({ time: this.elapsedTime });
            this.post.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    async warmRuntime(generation) {
        if (!this.runtime || !this.renderer || !this.scene || !this.camera) return;

        this.runtime.camera?.(0, this.camera);
        this.runtime.update?.(0, 0);
        const restoreCompileState = this.runtime.prepareForCompile?.() || (() => {});
        try {
            try {
                // MEASURED 2026-08-24 (docs/THEME_FLEET_SWEEP_2026-08.md Part B): this bare
                // whole-scene call binds no render target, but koi-pond does not draw to the
                // canvas — renderFrame() goes through this.post.render(), so the scene is drawn
                // inside a RenderPipeline pass. r185 keys builder state on the render context
                // (RenderObject.getMaterialCacheKey), so everything warmed here was warmed under a
                // context the live frame never looks up, and then compiled AGAIN on the first post
                // frame. The cell showed both halves: 35 async pipelines summing 5,182 ms, then
                // 41 more created synchronously.
                await compileGroupThroughPost(
                    this.renderer,
                    this.post,
                    this.scene,
                    this.camera,
                    this.scene,
                    false,
                );
            } catch (error) {
                console.warn('[KoiPond] Pipeline precompile was incomplete:', error);
            }
            if (generation !== this.runtimeGeneration || !this.renderer) return;
            // Warm through the post chain: a real post.render() compiles the
            // bloom/MRT pipelines now, dodging the first-frame black screen the
            // black-hole theme documented from deferred post compilation.
            this.renderFrame();
        } finally {
            restoreCompileState();
        }
    }

    setupEventListeners() {
        this.clearEventUnsubscribers();
        const forward = (eventName) => (payload) => {
            if (this.effectsAllowed(eventName)) {
                this.runtime?.pulse?.(eventName, payload ?? {});
            }
        };

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, forward('PIECE_LOCK')),
            eventBus.on(EVENTS.LINE_CLEAR, forward('LINE_CLEAR')),
            eventBus.on(EVENTS.COMBO, forward('COMBO')),
            eventBus.on(EVENTS.TSPIN, forward('TSPIN')),
            eventBus.on(EVENTS.B2B, forward('B2B')),
            eventBus.on(EVENTS.PERFECT_CLEAR, forward('PERFECT_CLEAR')),
        );

        const handleSettingsChanged = (payload) => {
            const effectQualityUpdate = readSettingUpdate(payload, 'effectQuality');
            const graphicsQualityUpdate = readSettingUpdate(payload, 'graphicsQuality');
            const qualityUpdate = effectQualityUpdate.present
                ? effectQualityUpdate
                : graphicsQualityUpdate;
            const requestedQuality = this.pendingQuality ?? this.quality;
            const nextQuality = qualityUpdate.present
                ? normalizeKoiPondQuality(qualityUpdate.value ?? requestedQuality)
                : requestedQuality;
            const qualityChanged = qualityUpdate.present && nextQuality !== requestedQuality;

            const antialiasUpdate = readSettingUpdate(payload, 'enableAntialiasing');
            const requestedAntialiasing = this.pendingAntialiasing
                ?? this.appliedAntialiasing
                ?? this.getAntialiasEnabled();
            const nextAntialiasing = normalizeBooleanSetting(
                antialiasUpdate.value,
                requestedAntialiasing,
            );
            const antialiasChanged = antialiasUpdate.present
                && nextAntialiasing !== requestedAntialiasing;
            if (qualityChanged || antialiasChanged) {
                if (qualityChanged) this.pendingQuality = nextQuality;
                if (antialiasChanged) this.pendingAntialiasing = nextAntialiasing;
                this.queueRuntimeRebuild();
                return;
            }
            this.applyRuntimeSettings();
            const renderScaleUpdate = readSettingUpdate(payload, 'renderScale');
            if (
                isDirectSettingUpdate(payload, 'renderScale')
                || (
                    renderScaleUpdate.present
                    && this.hasEffectivePixelRatioChanged()
                )
            ) {
                this.queueRuntimeResize();
            }
        };

        this.registerEventListener(window, 'settingsChanged', handleSettingsChanged);
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.SETTINGS_CHANGED, handleSettingsChanged),
        );
        if (this.reducedMotionQuery?.addEventListener) {
            this.registerEventListener(this.reducedMotionQuery, 'change', () => {
                this.applyRuntimeSettings();
            });
        }

        const resetPointer = () => {
            this.runtime?.resetPointer?.();
        };
        const handlePointerMove = (event) => {
            if (
                !this.isActive
                || this.isPaused
                || this.prefersReducedMotion()
                || event?.isPrimary === false
                || event?.pointerType === 'touch'
            ) {
                resetPointer();
                return;
            }
            const container = document.getElementById(`${this.name}-theme`);
            const bounds = container?.getBoundingClientRect?.();
            const viewport = getViewport();
            const left = Number.isFinite(bounds?.left) ? bounds.left : 0;
            const top = Number.isFinite(bounds?.top) ? bounds.top : 0;
            const width = Math.max(1, Number(bounds?.width) || viewport.width || 1);
            const height = Math.max(1, Number(bounds?.height) || viewport.height || 1);
            const clientX = Number(event?.clientX);
            const clientY = Number(event?.clientY);
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
                resetPointer();
                return;
            }
            const x = clamp(((clientX - left) / width) * 2 - 1, -1, 1);
            const y = clamp(1 - ((clientY - top) / height) * 2, -1, 1);
            this.runtime?.setPointer?.(x, y);
        };
        this.registerEventListener(window, 'pointermove', handlePointerMove, { passive: true });
        this.registerEventListener(window, 'pointerleave', resetPointer, { passive: true });
        this.registerEventListener(window, 'pointercancel', resetPointer, { passive: true });
        this.registerEventListener(window, 'blur', resetPointer);
    }

    getRendererSettingsSnapshot() {
        return {
            quality: this.getQualitySetting(),
            antialiasing: normalizeBooleanSetting(
                typeof window !== 'undefined'
                    ? window.settings?.enableAntialiasing
                    : undefined,
                this.getAntialiasEnabled(),
            ),
        };
    }

    reconcileRendererSettings(buildStart = this.getRendererSettingsSnapshot()) {
        const live = this.getRendererSettingsSnapshot();
        // A staged bus delta may intentionally lead the global settings object.
        // Preserve the values just used to build unless the underlying settings
        // actually changed again during the listener-free async init window.
        const liveQuality = this.pendingQuality
            ?? (live.quality !== buildStart.quality ? live.quality : this.quality);
        const liveAntialiasing = this.pendingAntialiasing
            ?? (
                live.antialiasing !== buildStart.antialiasing
                    ? live.antialiasing
                    : this.appliedAntialiasing
            );
        const qualityChanged = liveQuality !== this.quality;
        const antialiasChanged = liveAntialiasing !== this.appliedAntialiasing;

        if (qualityChanged) this.pendingQuality = liveQuality;
        if (antialiasChanged) this.pendingAntialiasing = liveAntialiasing;
        if (qualityChanged || antialiasChanged) this.queueRuntimeRebuild();
        return qualityChanged || antialiasChanged || this.settingsRebuildQueued;
    }

    hasEffectivePixelRatioChanged() {
        if (!this.renderer) return false;
        const nextPixelRatio = this.getEffectivePixelRatio(
            getKoiPondPixelRatioCap(this.quality),
            'theme',
        );
        const appliedPixelRatio = this.renderer.getPixelRatio?.();
        return !Number.isFinite(appliedPixelRatio)
            || Math.abs(nextPixelRatio - appliedPixelRatio) > 0.001;
    }

    queueRuntimeResize() {
        if (this.settingsResizeQueued) return;
        this.settingsResizeQueued = true;
        const scheduledGeneration = this.runtimeGeneration;
        queueMicrotask(() => {
            this.settingsResizeQueued = false;
            if (!this.isActive || scheduledGeneration !== this.runtimeGeneration) return;
            const viewport = getViewport();
            this.resize(viewport.width, viewport.height);
        });
    }

    queueRuntimeRebuild() {
        if (this.settingsRebuildQueued) return;
        this.settingsRebuildQueued = true;
        const scheduledGeneration = this.runtimeGeneration;
        queueMicrotask(() => {
            this.settingsRebuildQueued = false;
            if (!this.isActive || scheduledGeneration !== this.runtimeGeneration) return;
            this.createScene().catch((error) => {
                console.error('[KoiPond] Settings rebuild failed:', error);
            });
        });
    }

    applyRuntimeSettings() {
        this.runtime?.configureGameplay?.({
            quality: this.quality,
            reducedMotion: this.prefersReducedMotion(),
            intensity: this.getEffectsIntensity(),
        });
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const safeWidth = Math.max(1, Number(width) || 1);
        const safeHeight = Math.max(1, Number(height) || 1);
        this.camera.aspect = safeWidth / safeHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(
            getKoiPondPixelRatioCap(this.quality),
            'theme',
        ));
        this.renderer.setSize(safeWidth, safeHeight, false);
        this.runtime?.resize?.(safeWidth, safeHeight);
        this.post?.setSize(safeWidth, safeHeight);
    }

    animate() {
        if (this.animationLoopStarted || !this.runtime || !this.renderer) return;
        this.animationLoopStarted = true;
        this.lastFrameTimeMs = null;
        this.lastRenderTimeMs = null;

        this.animationDriver = this.safeAnimate((timestamp) => {
            const rawDelta = this.lastFrameTimeMs === null
                ? 1 / 60
                : (timestamp - this.lastFrameTimeMs) / 1000;
            const sampledDelta = Number.isFinite(rawDelta)
                ? Math.max(0, rawDelta)
                : 1 / 60;
            const delta = clamp(sampledDelta, 0, 0.05);
            this.lastFrameTimeMs = timestamp;
            this.elapsedTime += delta;

            // The runtime reports whether any reaction is live this frame. The
            // sim clock always advances; only the GPU present is gated so a
            // near-static reduced-motion pond costs ~30 fps of power, not 240 —
            // and snaps back to full rate the instant a lock/combo lands.
            const active = this.runtime?.update?.(this.elapsedTime, delta);
            let shouldRender = true;
            if (this.prefersReducedMotion() && active === false) {
                if (
                    this.lastRenderTimeMs !== null
                    && timestamp - this.lastRenderTimeMs < REDUCED_MOTION_FRAME_MS
                ) {
                    shouldRender = false;
                }
            }
            if (shouldRender) {
                this.renderFrame();
                this.lastRenderTimeMs = timestamp;
            }
            // Simulation remains overload-safe, while diagnostics retain raw
            // wall stalls instead of silently flooring every report at 20 FPS.
            this.collectPerformanceSample(sampledDelta);
        }, { maxConsecutiveErrors: 3 });
        const animationId = requestAnimationFrame(this.animationDriver);
        this.registerAnimation(animationId);
    }

    collectPerformanceSample(delta) {
        if (!this.performanceEnabled || !Number.isFinite(delta) || delta <= 0) return;
        this.frameSamples.push(delta * 1_000);
        if (this.frameSamples.length > PERFORMANCE_SAMPLE_LIMIT) this.frameSamples.shift();
    }

    installDiagnostics() {
        if (typeof window === 'undefined') return;
        this.diagnosticsApi = Object.freeze({
            getDiagnostics: () => this.getDiagnostics(),
        });
        window.__KOI_POND_THEME__ = this.diagnosticsApi;
    }

    getDiagnostics() {
        const runtime = this.runtime?.getDiagnostics?.() || {};
        const samples = this.frameSamples;
        const averageFrameMs = samples.length > 0
            ? samples.reduce((sum, value) => sum + value, 0) / samples.length
            : null;
        const sorted = samples.length > 0 ? [...samples].sort((a, b) => a - b) : [];
        const p95Index = Math.floor((sorted.length - 1) * 0.95);
        const p95FrameMs = sorted.length > 0 ? sorted.at(p95Index) : null;
        return {
            ...runtime,
            lifecycle: this.lifecycleState,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.quality,
            pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
            reducedMotion: this.prefersReducedMotion(),
            averageFrameMs,
            p95FrameMs,
            averageFps: averageFrameMs ? 1_000 / averageFrameMs : null,
        };
    }

    disposeRuntime() {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        this.removeRendererResilience();
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;

        if (
            typeof window !== 'undefined'
            && this.diagnosticsApi
            && window.__KOI_POND_THEME__ === this.diagnosticsApi
        ) {
            delete window.__KOI_POND_THEME__;
        }
        this.diagnosticsApi = null;

        // Post owns GPU render targets bound to this renderer; release before
        // the runtime + renderer teardown below (SB-15 leak discipline).
        this.disposePost();

        if (this.runtime) {
            try {
                this.runtime.dispose?.();
            } catch (error) {
                console.warn('[KoiPond] Runtime cleanup failed:', error);
            }
            this.runtime = null;
        }

        this.scene?.clear?.();
        this.scene = null;
        this.camera = null;

        if (this.renderer) {
            const { renderer } = this;
            this.renderer = null;
            this.disposeRenderer(renderer, { nullInstance: false });
        }

        this.reducedMotionQuery = null;
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
        this.frameSamples = [];
        this.isWebGPU = false;
        this.appliedAntialiasing = null;
    }

    async whenCriticalReady() {
        return !!(this.runtime && this.renderer && this.scene && this.camera);
    }

    getTetrominoConfig() {
        return KOI_POND_TETROMINOS;
    }

    pause() {
        const paused = super.pause();
        if (paused) {
            this.lastFrameTimeMs = null;
            this.runtime?.resetPointer?.({ immediate: true });
        }
        return paused;
    }

    resume() {
        if (!this.runtime || !this.renderer || !this.scene || !this.camera) return false;
        const resumed = super.resume();
        if (resumed) this.lastFrameTimeMs = null;
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
