/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Stillwater — production lifecycle adapter.
 *
 * The screenshot-proven WebGPU/TSL composition lives in
 * rendering/stillwater-runtime.js. This class owns only application lifecycle:
 * backend selection and recovery, quality/layout policy, gameplay attachment,
 * warmup, frame gating, diagnostics, and deterministic teardown.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { getViewport } from '../../utils/viewport.js';
import {
    resolveStillwaterLayout,
} from './composition/stillwater-layout.js';
import {
    getStillwaterQualityProfile,
    normalizeStillwaterQuality,
} from './stillwater-quality.js';
import { createStillwaterRuntime } from './rendering/stillwater-runtime.js';
import { STILLWATER_TETROMINOS } from './stillwater-tetrominos.js';

const RENDERER_INIT_TIMEOUT_MS = 5_500;
const VALIDATION_QUEUE_TIMEOUT_MS = 5_000;
const RENDERER_RESIZE_DRAIN_TIMEOUT_MS = 5_000;
const FRAME_SAMPLE_CAPACITY = 1_200;
const MAX_SIMULATION_DELTA_SECONDS = 0.1;
const DEFAULT_FRAME_SECONDS = 1 / 60;
const RENDERER_POOL_DRAIN_TIMEOUT_MS = 5_000;
const ACTIVATION_POST_REVEAL_OBSERVE_MS = 250;
const WEBGL_PIXEL_RATIO_CAP = 0.6;
const ACTIVATION_MILESTONE_NAMES = Object.freeze([
    'sceneStart',
    'rendererReady',
    'runtimeConstructed',
    'criticalHeroReady',
    'targetHeroReady',
    'warmRenderComplete',
    'canvasReveal',
]);

let pooledRendererRecord = null;

function drainRendererQueue(renderer) {
    const backend = renderer?.backend;
    const queue = renderer?.backend?.device?.queue;
    let timeoutId = null;
    const drain = Promise.resolve().then(async () => {
        // Validation renderers allocate timestamp-query pairs per render
        // context. Resolve before pooling so successive Stillwater runtimes do
        // not accumulate retired context IDs in r181's fixed 2,048-query pool.
        if (
            (
                renderer?.__stillwaterTimestampQuerySupported === true
                || backend?.trackTimestamp === true
            )
            && typeof renderer.resolveTimestampsAsync === 'function'
        ) {
            backend.trackTimestamp = true;
            try {
                await renderer.resolveTimestampsAsync('render');
            } finally {
                backend.trackTimestamp = false;
            }
        }
        if (typeof queue?.onSubmittedWorkDone === 'function') {
            await queue.onSubmittedWorkDone();
        }
        return true;
    });
    return Promise.race([
        drain,
        new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(false), RENDERER_POOL_DRAIN_TIMEOUT_MS);
        }),
    ]).catch(() => false).finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
    });
}

function detachRendererCanvas(renderer) {
    const canvas = renderer?.domElement;
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
}

/**
 * Retire transient r181 render state without destroying the dedicated
 * Stillwater renderer/backend. Public dispose() is terminal and cannot be used
 * for a pooled renderer, while leaving these caches untouched pins the most
 * recently retired scene through render lists, node-frame references, and the
 * shared QuadMesh geometry's first RenderObject closure.
 */
function resetPooledRendererTransientState(renderer) {
    if (!renderer) return;

    try { renderer.setRenderTarget?.(null); } catch (error) { /* noop */ }
    try { renderer.setOutputRenderTarget?.(null); } catch (error) { /* noop */ }

    const nodes = renderer._nodes;
    const nodeFrame = nodes?.nodeFrame;
    if (nodeFrame) {
        // A queued/pending r181 callback may outlive the public NodeFrame slot.
        // Sever its strong render references before replacing the frame so that
        // callback cannot retain a retired scene and its last rendered object.
        nodeFrame.scene = null;
        nodeFrame.camera = null;
        nodeFrame.object = null;
        nodeFrame.material = null;
        nodeFrame.renderer = null;
    }
    if (nodeFrame) {
        try {
            nodes.nodeFrame = new nodeFrame.constructor();
        } catch (error) { /* strong slots were already severed above */ }
    }

    // These r181 managers are reusable after dispose(): each call only replaces
    // its scene-keyed ChainMaps. Do not bulk-dispose nodes, textures, pipelines,
    // bindings, attributes, objects, or geometries on a live backend.
    renderer._renderLists?.dispose?.();
    renderer._renderContexts?.dispose?.();
    renderer._bundles?.dispose?.();

    // Geometries.initGeometry() stores a strong Map entry whose listener closes
    // over the first RenderObject for a geometry. All post passes share
    // renderer._quad.geometry, so that one listener otherwise pins the first
    // retired Stillwater post graph for the lifetime of the pool. The geometry
    // and its initialized GPU attributes remain valid and reusable.
    const quadGeometry = renderer._quad?.geometry;
    const geometryListeners = renderer._geometries?._geometryDisposeListeners;
    const quadDisposeListener = quadGeometry && geometryListeners?.get?.(quadGeometry);
    if (quadDisposeListener) {
        quadGeometry.removeEventListener?.('dispose', quadDisposeListener);
        geometryListeners.delete(quadGeometry);
    }

    renderer.info?.reset?.();
}

function terminallyDisposePooledRenderer(renderer) {
    if (!renderer) return;
    const { backend } = renderer;
    const device = backend?.isWebGPUBackend === true ? backend.device : null;
    if (device?.destroy) renderer.onDeviceLost = () => {};
    try { renderer._animation?.stop?.(); } catch (error) { /* noop */ }
    try { renderer.setAnimationLoop?.(null); } catch (error) { /* noop */ }
    try { renderer.dispose?.(); } catch (error) { /* noop */ }
    detachRendererCanvas(renderer);
    if (device?.destroy) {
        try { device.destroy(); } catch (error) { /* noop */ }
        if (backend.device === device) backend.device = null;
    }
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function readActivationTime() {
    if (typeof globalThis.performance?.now === 'function') {
        return globalThis.performance.now();
    }
    return Date.now();
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

function readStringParam(...keys) {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    for (let index = 0; index < keys.length; index += 1) {
        const value = params.get(keys[index]);
        if (value != null && String(value).trim()) return String(value).trim();
    }
    return null;
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

function getCollectionSize(value) {
    if (Number.isFinite(value?.size)) return value.size;
    if (Number.isFinite(value?.length)) return value.length;
    return null;
}

function getModePlayerCount(mode) {
    const candidates = [
        mode?.multiplayerState?.numPlayers,
        getCollectionSize(mode?.multiplayerState?.players),
        mode?.matchConfig?.numPlayers,
        mode?.playerCount,
        mode?.numPlayers,
        getCollectionSize(mode?.ffaGameState?.players),
        getCollectionSize(mode?.players),
    ];
    const match = candidates.find((value) => Number.isFinite(Number(value)));
    return Math.max(1, Math.trunc(Number(match) || 1));
}

function percentile(sortedValues, fraction) {
    if (sortedValues.length === 0) return null;
    const index = Math.floor((sortedValues.length - 1) * fraction);
    return sortedValues[index];
}

export default class StillwaterTheme extends BaseTheme {
    constructor() {
        super('stillwater');

        this.resourceProfile = 'heavy-gpu';
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.runtime = null;
        this.runtimeDetach = null;
        this.layoutPolicy = null;
        this.quality = 'High';
        this.qualityProfile = getStillwaterQualityProfile(this.quality);
        this.isWebGPU = false;
        this.isWebGL = false;
        this.forceWebGL = false;
        this.backendName = 'Unavailable';
        this.runtimeGeneration = 0;
        this.rendererIdentity = 0;
        this.gpuRecoveryAttempted = false;
        this.gpuSurfaceUnregister = null;

        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
        this.validationEnabled = false;
        this.validationDriverActive = false;
        this.validationFramePending = false;
        this.validationTimestampSupported = false;
        this.validationRendererAnimationWasRunning = false;
        this.rendererAnimationPausedByLifecycle = false;
        this.activationTelemetry = null;
        this.activationLongTaskObserver = null;
        this.activationLongTaskStopTimer = null;
        this.rendererPowerPreference = 'high-performance';
        this.pendingRendererResize = null;
        this.rendererResizeJob = null;
        this.rendererResizeJobSerial = 0;
        this.rendererResizeInFlight = false;
        this.rendererPoolReused = false;

        this.eventUnsubscribers = [];
        this.modeManager = null;
        this.modeUnsubscribers = [];
        this.reducedMotionQuery = null;
        this.settingsRebuildQueued = false;
        this.settingsResizeQueued = false;
        this.pendingQuality = null;
        this.pendingAntialiasing = null;
        this.pendingBloom = null;
        this.appliedAntialiasing = null;
        this.appliedBloom = null;

        this.criticalReady = false;
        this.fullReady = false;
        this.criticalReadyPromise = Promise.resolve(false);
        this.fullReadyPromise = Promise.resolve(false);

        this.performanceEnabled = false;
        this.frameSamples = new Float32Array(FRAME_SAMPLE_CAPACITY);
        this.frameSampleCount = 0;
        this.frameSampleCursor = 0;
        this.lastRawFrameMs = null;
        this.maximumRawFrameMs = null;

        this.masterpieceApi = null;
        this.themeDiagnosticsApi = null;
        this.lifecycleCounters = this.createLifecycleCounters();
    }

    createLifecycleCounters() {
        return {
            scheduledFrames: 0,
            allowedFrames: 0,
            gatedFrames: 0,
            simulationUpdates: 0,
            composedRenders: 0,
            warmupRenders: 0,
            gameplayRenders: 0,
            validationRenders: 0,
            animationLoopStarts: 0,
            terminalWebGpuDeviceDestroys: 0,
            rendererPoolClaims: 0,
            rendererPoolStores: 0,
            rendererAnimationPauseStops: 0,
            rendererAnimationResumeStarts: 0,
            layoutApplications: 0,
            resizes: 0,
            pauses: 0,
            resumes: 0,
            settingsRebuilds: 0,
            recoveries: 0,
        };
    }

    async start(webglRenderer, managers = {}) {
        // Recovery is bounded once per activation, not once for the lifetime of
        // a cached theme object. Runtime/settings rebuilds do not reset it.
        this.gpuRecoveryAttempted = false;
        this.rendererAnimationPausedByLifecycle = false;
        this.lifecycleCounters = this.createLifecycleCounters();
        return super.start(webglRenderer, managers);
    }

    getCurrentQualityLevel() {
        return this.quality;
    }

    getQualitySetting() {
        if (typeof window === 'undefined') return 'High';
        return normalizeStillwaterQuality(
            readStringParam('stillwaterQuality', 'quality')
                || window.settings?.effectQuality
                || window.settings?.graphicsQuality
                || 'High',
        );
    }

    getBloomSetting() {
        if (typeof window === 'undefined') return true;
        return normalizeBooleanSetting(window.settings?.enableBloom, true);
    }

    getAntialiasSetting() {
        const liveSetting = typeof window !== 'undefined'
            ? window.settings?.enableAntialiasing
            : undefined;
        return normalizeBooleanSetting(liveSetting, this.getAntialiasEnabled());
    }

    getRendererPowerPreference() {
        if (!this.validationEnabled) return 'high-performance';
        return readStringParam('stillwaterPowerPreference') === 'low-power'
            ? 'low-power'
            : 'high-performance';
    }

    prefersReducedMotion(payload = null) {
        const update = readSettingUpdate(payload, 'reducedMotion');
        if (update.present) {
            return normalizeBooleanSetting(update.value, false);
        }
        if (typeof window === 'undefined') return false;
        return window.settings?.reducedMotion === true
            || this.reducedMotionQuery?.matches === true
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    }

    getRuntimeParams() {
        // Deliberately fresh: unrelated app/playground/debug query parameters
        // must never leak into the production shader graph.
        const params = new URLSearchParams();
        params.set('quality', this.quality);
        params.set('layout', this.layoutPolicy?.layout || 'solo');
        params.set('reducedMotion', this.prefersReducedMotion() ? '1' : '0');
        params.set('bloom', this.appliedBloom === false ? '0' : '1');
        params.set('grade', 'full');
        params.set('reflection', 'auto');
        params.set('responses', 'on');
        params.set('proxies', 'off');
        params.set('post', 'off');
        params.set('boardGuide', 'off');
        params.set('event', 'idle');
        if (this.validationEnabled) params.set('validationTelemetry', '1');
        return params;
    }

    getRendererSettingsSnapshot() {
        return {
            quality: this.getQualitySetting(),
            antialiasing: this.getAntialiasSetting(),
            bloom: this.getBloomSetting(),
        };
    }

    resolveLayout(width, height, override = {}) {
        const viewport = getViewport();
        const safeWidth = Math.max(1, Number(width) || viewport.width || 1);
        const safeHeight = Math.max(1, Number(height) || viewport.height || 1);
        const manager = typeof window !== 'undefined'
            ? window.serenityBlocks?.gameModeManager
            : null;
        const mode = manager?.getCurrentMode?.() || null;
        const gameMode = override.gameMode
            || manager?.getCurrentModeId?.()
            || (typeof window !== 'undefined' ? window.settings?.gameMode : null)
            || 'single';

        return resolveStillwaterLayout({
            stillwaterLayout: override.stillwaterLayout
                || readStringParam('stillwaterLayout'),
            gameMode,
            playerCount: override.playerCount || getModePlayerCount(mode),
            width: safeWidth,
            height: safeHeight,
        });
    }

    applyLayout(width, height, override = {}) {
        this.layoutPolicy = this.resolveLayout(width, height, override);
        this.runtime?.setLayout?.(this.layoutPolicy);
        this.runtime?.camera?.(this.elapsedTime, this.camera);
        this.lifecycleCounters.layoutApplications += 1;
        return this.layoutPolicy;
    }

    beginActivationTelemetry(generation, requestedStartMs = null) {
        this.stopActivationLongTaskObserver();
        this.activationTelemetry = null;
        if (!this.validationEnabled) return;

        const startedAtMs = Number.isFinite(requestedStartMs)
            ? requestedStartMs
            : readActivationTime();
        const milestones = {};
        ACTIVATION_MILESTONE_NAMES.forEach((name) => {
            milestones[name] = null;
        });
        this.activationTelemetry = {
            generation,
            clock: typeof globalThis.performance?.now === 'function'
                ? 'performance.now'
                : 'Date.now',
            startedAtMs,
            milestones,
            longTasks: {
                supported: false,
                observing: false,
                postRevealObservationMs: ACTIVATION_POST_REVEAL_OBSERVE_MS,
                entries: [],
            },
        };
        this.recordActivationMilestone('sceneStart', generation, startedAtMs);

        const Observer = globalThis.PerformanceObserver;
        const supportedTypes = Observer?.supportedEntryTypes;
        const explicitlyUnsupported = Array.isArray(supportedTypes)
            && !supportedTypes.includes('longtask');
        if (typeof Observer !== 'function' || explicitlyUnsupported) return;

        let observer = null;
        try {
            observer = new Observer((list) => {
                this.captureActivationLongTasks(list?.getEntries?.() || [], generation);
            });
        } catch (error) {
            return;
        }
        try {
            observer.observe({ type: 'longtask', buffered: true });
        } catch (error) {
            try {
                observer.observe({ entryTypes: ['longtask'] });
            } catch (fallbackError) {
                observer.disconnect?.();
                return;
            }
        }
        this.activationLongTaskObserver = observer;
        this.activationTelemetry.longTasks.supported = true;
        this.activationTelemetry.longTasks.observing = true;
    }

    recordActivationMilestone(name, generation, timestampMs = readActivationTime()) {
        const telemetry = this.activationTelemetry;
        if (
            !this.validationEnabled
            || !telemetry
            || telemetry.generation !== generation
            || !Object.prototype.hasOwnProperty.call(telemetry.milestones, name)
            || telemetry.milestones[name]
        ) {
            return false;
        }
        telemetry.milestones[name] = {
            timestampMs,
            elapsedMs: Math.max(0, timestampMs - telemetry.startedAtMs),
        };
        return true;
    }

    captureActivationLongTasks(entries, generation) {
        const telemetry = this.activationTelemetry;
        if (!telemetry || telemetry.generation !== generation) return;
        entries.forEach((entry) => {
            if (entry?.entryType !== 'longtask') return;
            const startTimeMs = Number(entry.startTime);
            const durationMs = Number(entry.duration);
            if (!Number.isFinite(startTimeMs) || !Number.isFinite(durationMs)) return;
            const endTimeMs = startTimeMs + durationMs;
            if (endTimeMs < telemetry.startedAtMs) return;
            telemetry.longTasks.entries.push({
                name: String(entry.name || 'self'),
                startTimeMs,
                durationMs,
                elapsedStartMs: startTimeMs - telemetry.startedAtMs,
                elapsedEndMs: endTimeMs - telemetry.startedAtMs,
            });
        });
    }

    stopActivationLongTaskObserver({ capturePending = true } = {}) {
        if (this.activationLongTaskStopTimer !== null) {
            clearTimeout(this.activationLongTaskStopTimer);
            this.activationLongTaskStopTimer = null;
        }
        const observer = this.activationLongTaskObserver;
        this.activationLongTaskObserver = null;
        if (observer && capturePending) {
            this.captureActivationLongTasks(
                observer.takeRecords?.() || [],
                this.activationTelemetry?.generation,
            );
        }
        observer?.disconnect?.();
        if (this.activationTelemetry) {
            this.activationTelemetry.longTasks.observing = false;
        }
    }

    completeActivationTelemetry(generation) {
        if (!this.recordActivationMilestone('canvasReveal', generation)) return;
        // Retain the observer briefly after reveal. This captures immediate
        // unmasked activation work instead of making post-reveal LongTasks
        // structurally unobservable.
        this.activationLongTaskStopTimer = setTimeout(() => {
            this.activationLongTaskStopTimer = null;
            if (this.activationTelemetry?.generation === generation) {
                this.stopActivationLongTaskObserver();
            }
        }, ACTIVATION_POST_REVEAL_OBSERVE_MS);
    }

    getActivationTelemetryDiagnostics(runtimeDiagnostics = null) {
        const telemetry = this.validationEnabled ? this.activationTelemetry : null;
        if (!telemetry) return null;
        const entries = telemetry.longTasks.entries
            .map((entry) => ({ ...entry }))
            .sort((left, right) => left.startTimeMs - right.startTimeMs);
        const totalDurationMs = entries.reduce(
            (total, entry) => total + entry.durationMs,
            0,
        );
        const longestDurationMs = entries.reduce(
            (longest, entry) => Math.max(longest, entry.durationMs),
            0,
        );
        return {
            generation: telemetry.generation,
            clock: telemetry.clock,
            milestones: Object.fromEntries(
                Object.entries(telemetry.milestones).map(([name, value]) => [
                    name,
                    value ? { ...value } : null,
                ]),
            ),
            activationToRevealMs: telemetry.milestones.canvasReveal?.elapsedMs ?? null,
            measurementNotes: {
                warmRenderComplete: [
                    'Recorded when the warm render call returns.',
                    'GPU queue completion is not measured by this milestone.',
                ].join(' '),
                heroGltf: [
                    'Combined GLTF load + parse/attach.',
                    'GPU upload is not measured separately.',
                ].join(' '),
            },
            heroGltf: runtimeDiagnostics?.characters?.gltfTimings ?? null,
            longTasks: {
                supported: telemetry.longTasks.supported,
                observing: telemetry.longTasks.observing,
                postRevealObservationMs:
                    telemetry.longTasks.postRevealObservationMs,
                count: entries.length,
                totalDurationMs,
                longestDurationMs: entries.length ? longestDurationMs : null,
                entries,
            },
        };
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error('[Stillwater] Theme container not found.');
        const validationRequested = readBoolParam('stillwaterValidation');
        const sceneStartMs = validationRequested ? readActivationTime() : null;

        this.disposeRuntime();
        // Stillwater owns the whole background and must not leave the shared
        // renderer's zero-draw loop running behind its dedicated canvas.
        this.webglRenderer?.stop?.();
        const generation = ++this.runtimeGeneration;
        this.validationEnabled = validationRequested;
        this.beginActivationTelemetry(generation, sceneStartMs);

        container.replaceChildren();
        container.style.overflow = 'hidden';
        container.style.background = '#010706';

        const buildStart = this.getRendererSettingsSnapshot();
        this.quality = this.pendingQuality ?? buildStart.quality;
        this.qualityProfile = getStillwaterQualityProfile(this.quality);
        const antialiasOverride = this.pendingAntialiasing;
        this.appliedBloom = this.pendingBloom ?? buildStart.bloom;
        this.pendingQuality = null;
        this.pendingAntialiasing = null;
        this.pendingBloom = null;
        this.reducedMotionQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this.performanceEnabled = readBoolParam(
            'stillwaterPerf',
            'stillwaterProfile',
            'profile',
        );
        this.rendererPowerPreference = this.getRendererPowerPreference();
        this.resetPerformanceSamples();

        const rendererReady = await this.initRenderer(
            container,
            generation,
            antialiasOverride,
            ownerGeneration,
        );
        if (!rendererReady
            || generation !== this.runtimeGeneration
            || ownerGeneration !== this.lifecycleGeneration) return;
        this.recordActivationMilestone('rendererReady', generation);

        const viewport = getViewport();
        const width = Math.max(1, viewport.width);
        const height = Math.max(1, viewport.height);
        this.layoutPolicy = this.resolveLayout(width, height);
        const cameraPolicy = this.layoutPolicy.camera;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            cameraPolicy.fov,
            width / height,
            cameraPolicy.near,
            cameraPolicy.far,
        );

        try {
            const runtime = createStillwaterRuntime({
                scene: this.scene,
                camera: this.camera,
                renderer: this.renderer,
                params: this.getRuntimeParams(),
                sizes: { width, height },
                layoutPolicy: this.layoutPolicy,
            });
            this.runtime = runtime;
            this.recordActivationMilestone('runtimeConstructed', generation);
            runtime.setLayout?.(this.layoutPolicy);
            runtime.camera?.(0, this.camera);
            this.applyRuntimeSettings();
            this.installReadiness(runtime, generation);

            await Promise.all([
                this.criticalReadyPromise,
                this.fullReadyPromise,
            ]);
            if (
                generation !== this.runtimeGeneration
                || runtime !== this.runtime
                || !this.isActive
            ) return;

            await this.warmRuntime(generation);
            if (
                generation !== this.runtimeGeneration
                || runtime !== this.runtime
                || !this.isActive
            ) return;

            // The director owns exactly the six canonical gameplay
            // subscriptions. The wrapper never forwards the same events again.
            this.runtimeDetach = runtime.attach(eventBus, EVENTS);
        } catch (error) {
            console.error('[Stillwater] Production runtime creation failed:', error);
            if (generation === this.runtimeGeneration) this.disposeRuntime();
            throw error;
        }

        if (generation !== this.runtimeGeneration || !this.isActive) return;
        // End the potentially long shader-compilation/warm-render task while the
        // canvas is still opaque. Revealing from a fresh task keeps that work
        // genuinely behind the activation mask instead of writing opacity near
        // the tail of the same LongTask.
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        if (generation !== this.runtimeGeneration || !this.isActive) return;
        this.renderer.domElement.style.opacity = '1';
        this.completeActivationTelemetry(generation);
        this.setupEventListeners();
        this.setupModeManagerListeners();
        if (this.reconcileRendererSettings(buildStart)) return;
        this.installDiagnostics();
        this.animate();
        console.log(
            `[Stillwater] Masterpiece ready (${this.backendName}, ${this.quality}, ${this.layoutPolicy.layout})`,
        );
    }

    installReadiness(runtime, generation) {
        this.criticalReady = false;
        this.fullReady = false;
        this.criticalReadyPromise = Promise.resolve(runtime.criticalReady)
            .then((ready) => {
                const current = generation === this.runtimeGeneration
                    && runtime === this.runtime
                    && ready === true;
                if (current) {
                    this.criticalReady = true;
                    this.recordActivationMilestone('criticalHeroReady', generation);
                }
                return current;
            })
            .catch((error) => {
                console.warn('[Stillwater] Critical character readiness failed:', error);
                return false;
            });
        this.fullReadyPromise = Promise.resolve(runtime.ready)
            .then((ready) => {
                const current = generation === this.runtimeGeneration
                    && runtime === this.runtime
                    && ready === true;
                if (current) {
                    this.fullReady = true;
                    this.recordActivationMilestone('targetHeroReady', generation);
                }
                return current;
            })
            .catch((error) => {
                console.warn('[Stillwater] Full character readiness failed:', error);
                return false;
            });
    }

    async createRendererCandidate(
        forceWebGL,
        antialiasEnabled = this.getAntialiasSetting(),
    ) {
        const renderer = new THREE.WebGPURenderer({
            antialias: antialiasEnabled,
            alpha: false,
            forceWebGL,
            powerPreference: this.rendererPowerPreference,
            trackTimestamp: this.validationEnabled,
        });
        let timeoutId = null;
        let timeoutWon = false;
        const disposeCandidate = () => {
            try { renderer.setAnimationLoop?.(null); } catch (error) { /* noop */ }
            try {
                this.disposeOwnedRenderer(renderer, { nullInstance: false });
            } catch (error) { /* noop */ }
        };
        const initPromise = Promise.resolve().then(() => renderer.init());

        try {
            await Promise.race([
                initPromise,
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        timeoutWon = true;
                        reject(new Error('Renderer init timeout'));
                    }, RENDERER_INIT_TIMEOUT_MS);
                }),
            ]);
            const exactBackend = forceWebGL
                ? renderer.backend?.isWebGLBackend === true
                : renderer.backend?.isWebGPUBackend === true;
            if (!exactBackend) {
                throw new Error(
                    forceWebGL
                        ? 'Forced WebGL2 backend verification failed'
                        : 'Native WebGPU backend verification failed',
                );
            }
            return renderer;
        } catch (error) {
            if (timeoutWon) {
                // r181 cannot abort backend initialization. Dispose a late
                // winner so a timed-out native candidate cannot survive beside
                // the forced-WebGL2 fallback.
                initPromise.then(disposeCandidate, disposeCandidate);
            }
            disposeCandidate();
            throw error;
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    }

    async claimPooledRenderer(forceWebGL, antialiasEnabled) {
        const record = pooledRendererRecord;
        if (!record) return null;
        pooledRendererRecord = null;

        const backendMatches = forceWebGL
            ? record.renderer?.backend?.isWebGLBackend === true
            : record.renderer?.backend?.isWebGPUBackend === true;
        const settingsMatch = backendMatches
            && record.antialiasEnabled === antialiasEnabled
            && record.powerPreference === this.rendererPowerPreference
            && record.trackTimestamp === this.validationEnabled;
        const backendHealthy = record.renderer?._isDeviceLost !== true
            && (
                forceWebGL
                    ? record.renderer?.backend?.gl?.isContextLost?.() !== true
                    : Boolean(record.renderer?.backend?.device)
            );
        const drained = settingsMatch && backendHealthy
            ? await record.drainPromise
            : false;
        if (!drained) {
            record.terminal = true;
            this.disposeOwnedRenderer(record.renderer, { nullInstance: false });
            return null;
        }

        this.rendererPoolReused = true;
        this.lifecycleCounters.rendererPoolClaims += 1;
        try {
            if (record.renderer?._animation?._requestId == null) {
                record.renderer._animation.start?.();
            }
        } catch (error) { /* noop */ }
        return record.renderer;
    }

    storePooledRenderer(renderer) {
        if (!renderer) return false;
        if (pooledRendererRecord?.renderer && pooledRendererRecord.renderer !== renderer) {
            pooledRendererRecord.terminal = true;
            terminallyDisposePooledRenderer(pooledRendererRecord.renderer);
        }
        try { renderer._animation?.stop?.(); } catch (error) { /* noop */ }
        try { renderer.setAnimationLoop?.(null); } catch (error) { /* noop */ }
        detachRendererCanvas(renderer);
        const record = {
            renderer,
            antialiasEnabled: this.appliedAntialiasing,
            powerPreference: this.rendererPowerPreference,
            trackTimestamp: this.validationEnabled,
            terminal: false,
            drainPromise: null,
        };
        record.drainPromise = drainRendererQueue(renderer).then((drained) => {
            if (drained && !record.terminal) {
                resetPooledRendererTransientState(renderer);
            }
            return drained;
        });
        pooledRendererRecord = record;
        this.lifecycleCounters.rendererPoolStores += 1;
        return true;
    }

    static disposeRendererPool() {
        const record = pooledRendererRecord;
        pooledRendererRecord = null;
        if (record) record.terminal = true;
        terminallyDisposePooledRenderer(record?.renderer);
    }

    /**
     * ThemeManager invokes this only during full application/manager teardown.
     * Normal theme eviction deliberately preserves the renderer pool so a later
     * Stillwater activation can reuse the already-initialized backend.
     */
    static disposeSharedResources() {
        StillwaterTheme.disposeRendererPool();
    }

    async initRenderer(
        container,
        generation,
        antialiasOverride = null,
        ownerGeneration = this.lifecycleGeneration,
    ) {
        const requestedWebGL = this.forceWebGL
            || readBoolParam('forceWebGL', 'stillwaterForceWebGL');
        const canAttemptWebGPU = !requestedWebGL
            && typeof navigator !== 'undefined'
            && !!navigator.gpu;
        const antialiasEnabled = typeof antialiasOverride === 'boolean'
            ? antialiasOverride
            : this.getAntialiasSetting();
        let renderer = null;

        if (canAttemptWebGPU) {
            renderer = await this.claimPooledRenderer(false, antialiasEnabled);
            if (generation !== this.runtimeGeneration
                || ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) {
                this.disposeOwnedRenderer(renderer, { nullInstance: false });
                return false;
            }
            try {
                renderer ||= await this.createRendererCandidate(false, antialiasEnabled);
            } catch (error) {
                if (generation !== this.runtimeGeneration
                    || ownerGeneration !== this.lifecycleGeneration
                    || !this.isActive
                    || this.cleanupComplete) return false;
                console.warn('[Stillwater] WebGPU init failed; trying WebGL2:', error);
            }
        }

        if (!renderer) {
            if (generation !== this.runtimeGeneration
                || ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) return false;
            renderer = await this.claimPooledRenderer(true, antialiasEnabled);
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
                    message.textContent = 'Stillwater needs WebGPU or WebGL2.';
                    message.style.cssText = [
                        'color:#d7eadf',
                        'font-family:sans-serif',
                        'padding:2em',
                        'text-align:center',
                    ].join(';');
                    container.replaceChildren(message);
                }
                throw new Error(
                    'Stillwater could not initialize WebGPU or WebGL2.',
                    { cause: error },
                );
            }
        }

        if (generation !== this.runtimeGeneration
            || ownerGeneration !== this.lifecycleGeneration
            || !this.isActive
            || this.cleanupComplete) {
            this.disposeOwnedRenderer(renderer, { nullInstance: false });
            return false;
        }

        const viewport = getViewport();
        const width = Math.max(1, viewport.width);
        const height = Math.max(1, viewport.height);
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = renderer.backend?.isWebGLBackend === true;
        this.backendName = this.isWebGPU ? 'WebGPU' : 'WebGL2';
        this.validationTimestampSupported = this.validationEnabled && (
            renderer.__stillwaterTimestampQuerySupported === true
            || renderer.backend?.trackTimestamp === true
        );
        renderer.__stillwaterTimestampQuerySupported = this.validationTimestampSupported;
        // r181 consumes a pair of timestamp queries for every render pass.
        // Keep tracking dormant during ordinary animation and enable it only
        // around the isolated manual driver, which resolves every frame.
        if (renderer.backend) renderer.backend.trackTimestamp = false;
        this.appliedAntialiasing = antialiasEnabled;
        this.rendererIdentity += 1;

        renderer.info.autoReset = false;
        renderer.setPixelRatio(this.getEffectivePixelRatio(
            this.getBackendPixelRatioCap(),
            'theme',
        ));
        renderer.setSize(width, height, false);
        renderer.setClearColor(0x010706, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'stillwater-renderer';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = [
            'position:absolute',
            'inset:0',
            'width:100%',
            'height:100%',
            'z-index:0',
            'opacity:0',
            'pointer-events:none',
        ].join(';');
        container.appendChild(renderer.domElement);

        this.setupRendererResilience(renderer, {
            onContextLost: () => {
                if (!this.isWebGL) return;
                this.recoverBackend('webgl').catch((error) => {
                    console.error('[Stillwater] WebGL2 recovery failed:', error);
                });
            },
        });
        if (this.isWebGPU) {
            // Keep the device monitor's pending promise free of theme-capturing
            // callbacks. Local ownership is handled by the renderer lifecycle.
            this.setupRendererResilience(null, {
                webgpuDevice: renderer.backend?.device,
            });
        }
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        if (this.isWebGPU) {
            this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
                recover: () => this.recoverBackend('webgpu'),
            });
        }
        return true;
    }

    disposeOwnedRenderer(renderer, { nullInstance = true } = {}) {
        if (!renderer) return;
        const { backend } = renderer;
        const device = backend?.isWebGPUBackend === true
            ? backend.device
            : null;

        // Three r181 keeps `device.lost.then(() => renderer.onDeviceLost())`
        // pending, while WebGPUBackend.dispose() neither destroys nor severs
        // its owned device. Stillwater requests a fresh device per activation,
        // so terminal teardown must resolve that promise without reporting a
        // deliberate disposal as a production device-loss incident.
        if (device?.destroy) renderer.onDeviceLost = () => {};

        this.disposeRenderer(renderer, { nullInstance });

        if (device?.destroy) {
            try {
                device.destroy();
                if (this.lifecycleCounters) {
                    this.lifecycleCounters.terminalWebGpuDeviceDestroys += 1;
                }
            } catch (error) {
                console.warn('[Stillwater] Terminal WebGPU device destroy failed:', error);
            }
            if (backend.device === device) backend.device = null;
        }
    }

    async recoverBackend(backend) {
        if (this.gpuRecoveryAttempted) {
            throw new Error('Stillwater GPU recovery already attempted.');
        }
        this.gpuRecoveryAttempted = true;
        this.lifecycleCounters.recoveries += 1;
        if (backend === 'webgpu') this.forceWebGL = true;
        if (this.isActive) await this.createScene();
    }

    async warmRuntime(generation) {
        if (!this.runtime || !this.renderer || !this.scene || !this.camera) return;

        this.runtime.camera?.(0, this.camera);
        this.runtime.update?.(0, 0);
        const usesMrt = this.runtime.getDiagnostics?.()?.post?.useMRT === true;
        if (!usesMrt) {
            try {
                await this.renderer.compileAsync?.(this.scene, this.camera);
            } catch (error) {
                console.warn('[Stillwater] Pipeline precompile was incomplete:', error);
            }
        }
        if (generation !== this.runtimeGeneration || !this.renderer) return;
        // A real post/reflection render is authoritative for MRT tiers:
        // compileAsync(scene, camera) compiles against a one-target framebuffer
        // and can poison r181's cache before the two-target output/emissive pass.
        // The canvas remains masked while this exact shipped graph warms.
        if (this.renderRuntime('warmup')) {
            this.recordActivationMilestone('warmRenderComplete', generation);
        }
    }

    renderRuntime(source = 'gameplay') {
        if (!this.renderer || !this.runtime) return false;
        // autoReset=false lets reflector/post passes aggregate. Exactly one
        // reset happens immediately before the complete runtime frame.
        this.renderer.info.reset();
        this.runtime.render();
        this.lifecycleCounters.composedRenders += 1;
        if (source === 'warmup') this.lifecycleCounters.warmupRenders += 1;
        else if (source === 'validation') this.lifecycleCounters.validationRenders += 1;
        else this.lifecycleCounters.gameplayRenders += 1;
        return true;
    }

    setupEventListeners() {
        this.clearEventUnsubscribers();
        const handleSettingsChanged = (payload) => {
            const effectQualityUpdate = readSettingUpdate(payload, 'effectQuality');
            const graphicsQualityUpdate = readSettingUpdate(payload, 'graphicsQuality');
            const qualityUpdate = effectQualityUpdate.present
                ? effectQualityUpdate
                : graphicsQualityUpdate;
            const requestedQuality = this.pendingQuality ?? this.quality;
            const nextQuality = qualityUpdate.present
                ? normalizeStillwaterQuality(qualityUpdate.value ?? requestedQuality)
                : requestedQuality;
            const qualityChanged = qualityUpdate.present
                && nextQuality !== requestedQuality;

            const antialiasUpdate = readSettingUpdate(payload, 'enableAntialiasing');
            const requestedAntialiasing = this.pendingAntialiasing
                ?? this.appliedAntialiasing
                ?? this.getAntialiasSetting();
            const nextAntialiasing = normalizeBooleanSetting(
                antialiasUpdate.value,
                requestedAntialiasing,
            );
            const antialiasChanged = antialiasUpdate.present
                && nextAntialiasing !== requestedAntialiasing;

            const bloomUpdate = readSettingUpdate(payload, 'enableBloom');
            const requestedBloom = this.pendingBloom
                ?? this.appliedBloom
                ?? this.getBloomSetting();
            const nextBloom = normalizeBooleanSetting(
                bloomUpdate.value,
                requestedBloom,
            );
            const bloomChanged = bloomUpdate.present && nextBloom !== requestedBloom;

            if (qualityChanged || antialiasChanged || bloomChanged) {
                if (qualityChanged) this.pendingQuality = nextQuality;
                if (antialiasChanged) this.pendingAntialiasing = nextAntialiasing;
                if (bloomChanged) this.pendingBloom = nextBloom;
                this.queueRuntimeRebuild();
                return;
            }

            this.applyRuntimeSettings(payload);
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
        const handleViewport = (payload = {}) => {
            this.resize(payload.width, payload.height);
        };
        const handleGameModeChanged = (payload = {}) => {
            this.setupModeManagerListeners();
            this.applyLayout(undefined, undefined, {
                gameMode: payload?.detail?.mode || payload?.mode,
            });
        };

        this.registerEventListener(window, 'settingsChanged', handleSettingsChanged);
        this.registerEventListener(window, 'gameModeChanged', handleGameModeChanged);
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.SETTINGS_CHANGED, handleSettingsChanged),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, handleViewport),
        );
        if (this.reducedMotionQuery?.addEventListener) {
            this.registerEventListener(this.reducedMotionQuery, 'change', () => {
                this.applyRuntimeSettings();
            });
        }
    }

    setupModeManagerListeners() {
        const manager = typeof window !== 'undefined'
            ? window.serenityBlocks?.gameModeManager
            : null;
        if (manager === this.modeManager) return;
        this.clearModeManagerListeners();
        this.modeManager = manager || null;
        if (!manager?.on) return;
        const refresh = () => this.applyLayout();
        this.modeUnsubscribers = [
            manager.on('modeActivated', refresh),
            manager.on('modeStarted', refresh),
            manager.on('modeResumed', refresh),
        ];
    }

    clearModeManagerListeners() {
        this.modeUnsubscribers.forEach((unsubscribe) => {
            try { unsubscribe?.(); } catch (error) { /* noop */ }
        });
        this.modeUnsubscribers = [];
        this.modeManager = null;
    }

    reconcileRendererSettings(buildStart = this.getRendererSettingsSnapshot()) {
        const live = this.getRendererSettingsSnapshot();
        const liveQuality = this.pendingQuality
            ?? (live.quality !== buildStart.quality ? live.quality : this.quality);
        const liveAntialiasing = this.pendingAntialiasing
            ?? (
                live.antialiasing !== buildStart.antialiasing
                    ? live.antialiasing
                    : this.appliedAntialiasing
            );
        const liveBloom = this.pendingBloom
            ?? (live.bloom !== buildStart.bloom ? live.bloom : this.appliedBloom);
        const qualityChanged = liveQuality !== this.quality;
        const antialiasChanged = liveAntialiasing !== this.appliedAntialiasing;
        const bloomChanged = liveBloom !== this.appliedBloom;

        if (qualityChanged) this.pendingQuality = liveQuality;
        if (antialiasChanged) this.pendingAntialiasing = liveAntialiasing;
        if (bloomChanged) this.pendingBloom = liveBloom;
        if (qualityChanged || antialiasChanged || bloomChanged) {
            this.queueRuntimeRebuild();
        }
        return qualityChanged
            || antialiasChanged
            || bloomChanged
            || this.settingsRebuildQueued;
    }

    applyRuntimeSettings(payload = null) {
        const backgroundUpdate = readSettingUpdate(payload, 'backgroundComboEffects');
        const lockUpdate = readSettingUpdate(payload, 'pieceLockRipple');
        const backgroundComboEffects = normalizeBooleanSetting(
            backgroundUpdate.value,
            typeof window === 'undefined'
                ? true
                : window.settings?.backgroundComboEffects !== false,
        );
        const pieceLockRipple = normalizeBooleanSetting(
            lockUpdate.value,
            typeof window === 'undefined'
                ? true
                : window.settings?.pieceLockRipple !== false,
        );
        this.runtime?.configureGameplay?.({
            enabled: this.isActive && !this.isPaused,
            backgroundComboEffects,
            pieceLockRipple,
            reducedMotion: this.prefersReducedMotion(payload),
            intensity: 1,
        });
    }

    getBackendPixelRatioCap() {
        return this.isWebGL
            ? Math.min(this.qualityProfile.maxPixelRatio, WEBGL_PIXEL_RATIO_CAP)
            : this.qualityProfile.maxPixelRatio;
    }

    hasEffectivePixelRatioChanged() {
        if (!this.renderer) return false;
        const nextPixelRatio = this.getEffectivePixelRatio(
            this.getBackendPixelRatioCap(),
            'theme',
        );
        const appliedPixelRatio = this.renderer.getPixelRatio?.();
        return !Number.isFinite(appliedPixelRatio)
            || Math.abs(nextPixelRatio - appliedPixelRatio) > 0.001;
    }

    queueRuntimeResize() {
        if (this.settingsResizeQueued) return;
        this.settingsResizeQueued = true;
        const generation = this.runtimeGeneration;
        queueMicrotask(() => {
            this.settingsResizeQueued = false;
            if (!this.isActive || generation !== this.runtimeGeneration) return;
            const viewport = getViewport();
            this.resize(viewport.width, viewport.height);
        });
    }

    queueRuntimeRebuild() {
        if (this.settingsRebuildQueued) return;
        this.settingsRebuildQueued = true;
        this.lifecycleCounters.settingsRebuilds += 1;
        const generation = this.runtimeGeneration;
        queueMicrotask(() => {
            this.settingsRebuildQueued = false;
            if (!this.isActive || generation !== this.runtimeGeneration) return;
            this.createScene().catch((error) => {
                console.error('[Stillwater] Settings rebuild failed:', error);
            });
        });
    }

    applyRendererResize(width, height) {
        if (!this.renderer || !this.runtime) return false;
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(
            this.getBackendPixelRatioCap(),
            'theme',
        ));
        this.renderer.setSize(width, height, false);
        this.runtime.resize?.(width, height);
        return true;
    }

    queueRendererResize(width, height) {
        this.pendingRendererResize = {
            generation: this.runtimeGeneration,
            height,
            width,
        };
        if (this.rendererResizeJob) return;

        const { renderer } = this;
        const generation = this.runtimeGeneration;
        const queue = renderer?.backend?.device?.queue;
        const job = {
            generation,
            id: ++this.rendererResizeJobSerial,
            renderer,
        };
        this.rendererResizeJob = job;
        this.rendererResizeInFlight = true;
        this.lastFrameTimeMs = null;
        let timeoutId = null;
        const drain = Promise.resolve().then(() => queue.onSubmittedWorkDone());
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(
                    `WebGPU resize drain timed out after ${RENDERER_RESIZE_DRAIN_TIMEOUT_MS}ms.`,
                ));
            }, RENDERER_RESIZE_DRAIN_TIMEOUT_MS);
        });

        Promise.race([drain, timeout])
            .then(() => {
                if (this.rendererResizeJob !== job) return;
                const pending = this.pendingRendererResize;
                if (
                    !pending
                    || pending.generation !== generation
                    || generation !== this.runtimeGeneration
                    || renderer !== this.renderer
                ) {
                    return;
                }
                this.pendingRendererResize = null;
                this.applyRendererResize(pending.width, pending.height);
                this.lastFrameTimeMs = null;
            })
            .catch(async (error) => {
                if (this.rendererResizeJob !== job) return;
                this.pendingRendererResize = null;
                console.warn('[Stillwater] WebGPU resize drain failed:', error);
                if (
                    this.isActive
                    && generation === this.runtimeGeneration
                    && renderer === this.renderer
                    && !this.gpuRecoveryAttempted
                ) {
                    try {
                        await this.recoverBackend('webgpu');
                    } catch (recoveryError) {
                        console.warn(
                            '[Stillwater] Resize recovery could not complete:',
                            recoveryError,
                        );
                    }
                }
            })
            .finally(() => {
                if (timeoutId !== null) clearTimeout(timeoutId);
                if (this.rendererResizeJob !== job) return;
                this.rendererResizeJob = null;
                this.rendererResizeInFlight = false;
                this.lastFrameTimeMs = null;
                if (this.pendingRendererResize) {
                    this.queueRendererResize(
                        this.pendingRendererResize.width,
                        this.pendingRendererResize.height,
                    );
                }
            });
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        this.lifecycleCounters.resizes += 1;
        const viewport = getViewport();
        const safeWidth = Math.max(1, Number(width) || viewport.width || 1);
        const safeHeight = Math.max(1, Number(height) || viewport.height || 1);
        this.camera.aspect = safeWidth / safeHeight;
        this.applyLayout(safeWidth, safeHeight);
        if (
            this.isWebGPU
            && typeof this.renderer.backend?.device?.queue?.onSubmittedWorkDone === 'function'
        ) {
            this.queueRendererResize(safeWidth, safeHeight);
            return;
        }
        this.applyRendererResize(safeWidth, safeHeight);
    }

    animate() {
        if (
            this.animationLoopStarted
            || this.validationDriverActive
            || !this.runtime
            || !this.renderer
        ) return;
        this.animationLoopStarted = true;
        this.lifecycleCounters.animationLoopStarts += 1;
        this.lastFrameTimeMs = null;

        this.animationDriver = this.safeAnimate((timestamp) => {
            this.runFrame(timestamp);
        }, { maxConsecutiveErrors: 3 });
        const animationId = requestAnimationFrame(this.animationDriver);
        this.registerAnimation(animationId);
    }

    runFrame(timestamp, source = 'gameplay') {
        if (!this.runtime || !this.renderer || !this.camera) return false;
        const safeTimestamp = Number.isFinite(timestamp)
            ? timestamp
            : performance.now();
        const rawDelta = this.lastFrameTimeMs === null
            ? DEFAULT_FRAME_SECONDS
            : (safeTimestamp - this.lastFrameTimeMs) / 1_000;
        const sampledDelta = Number.isFinite(rawDelta)
            ? Math.max(0, rawDelta)
            : DEFAULT_FRAME_SECONDS;
        const simulationDelta = clamp(
            sampledDelta,
            0,
            MAX_SIMULATION_DELTA_SECONDS,
        );
        this.lastFrameTimeMs = safeTimestamp;
        this.elapsedTime += simulationDelta;

        this.runtime.camera?.(this.elapsedTime, this.camera);
        this.runtime.update?.(this.elapsedTime, simulationDelta);
        this.lifecycleCounters.simulationUpdates += 1;
        const rendered = this.renderRuntime(source);
        this.collectPerformanceSample(sampledDelta);
        return rendered;
    }

    beginValidationDriver() {
        if (!this.validationEnabled) {
            return { ok: false, reason: 'Stillwater validation mode is disabled.' };
        }
        if (!this.runtime || !this.renderer || !this.isActive || this.isPaused) {
            return { ok: false, reason: 'Stillwater is not ready for validation stepping.' };
        }
        if (this.validationDriverActive) {
            return {
                ok: true,
                alreadyActive: true,
                backend: this.backendName,
                powerPreference: this.rendererPowerPreference,
            };
        }

        this.validationDriverActive = true;
        if (this.renderer?.backend) {
            this.renderer.backend.trackTimestamp = this.validationTimestampSupported;
        }
        this.cancelAnimationFrames();
        const rendererAnimation = this.renderer?._animation;
        this.validationRendererAnimationWasRunning = rendererAnimation?._requestId != null;
        if (this.validationRendererAnimationWasRunning) {
            rendererAnimation.stop?.();
        }
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        return {
            ok: true,
            alreadyActive: false,
            backend: this.backendName,
            powerPreference: this.rendererPowerPreference,
            rendererAnimationSuspended: this.validationRendererAnimationWasRunning,
        };
    }

    async stepValidationFrame(timestamp = performance.now()) {
        if (!this.validationEnabled || !this.validationDriverActive) {
            return { ok: false, reason: 'Stillwater validation driver is not active.' };
        }
        if (this.validationFramePending) {
            return { ok: false, reason: 'A Stillwater validation frame is already pending.' };
        }
        if (!this.runtime || !this.renderer || !this.isActive || this.isPaused) {
            return { ok: false, reason: 'Stillwater cannot render a validation frame.' };
        }

        this.validationFramePending = true;
        const { renderer } = this;
        const frameStartedAt = performance.now();
        try {
            if (!this.shouldRenderFrame()) {
                return {
                    ok: true,
                    rendered: false,
                    reason: 'Frame was gated by the production lifecycle.',
                };
            }

            // Three r181 advances NodeFrame only from the renderer's private
            // animation loop. The isolated validation driver suspends that
            // loop, so advance exactly once per sampled production frame.
            const nodeFrame = renderer._nodes?.nodeFrame;
            if (typeof nodeFrame?.update === 'function') {
                nodeFrame.update();
                if (renderer.info) renderer.info.frame = nodeFrame.frameId;
            }
            const rendered = this.runFrame(timestamp, 'validation');
            const submittedAt = performance.now();
            let gpuTimestampMs = null;
            let gpuTimestampError = null;
            if (
                renderer.backend?.trackTimestamp === true
                && typeof renderer.resolveTimestampsAsync === 'function'
            ) {
                try {
                    const timestampDuration = await renderer.resolveTimestampsAsync('render');
                    if (Number.isFinite(timestampDuration)) {
                        gpuTimestampMs = timestampDuration;
                    }
                } catch (error) {
                    gpuTimestampError = error?.message || String(error);
                }
            }
            const queue = renderer.backend?.device?.queue;
            const queueCompletionSupported = typeof queue?.onSubmittedWorkDone === 'function';
            let queueCompletionError = null;
            if (queueCompletionSupported) {
                let timeoutId = null;
                try {
                    await Promise.race([
                        queue.onSubmittedWorkDone(),
                        new Promise((_, reject) => {
                            timeoutId = setTimeout(() => {
                                reject(new Error(
                                    `WebGPU queue completion exceeded ${VALIDATION_QUEUE_TIMEOUT_MS}ms`,
                                ));
                            }, VALIDATION_QUEUE_TIMEOUT_MS);
                        }),
                    ]);
                } catch (error) {
                    queueCompletionError = error?.message || String(error);
                } finally {
                    if (timeoutId !== null) clearTimeout(timeoutId);
                }
            }
            const completedAt = performance.now();
            return {
                ok: queueCompletionError === null && gpuTimestampError === null,
                rendered,
                backend: this.backendName,
                completionSource: queueCompletionSupported
                    ? 'webgpu-queue-drained'
                    : 'cpu-submit-only',
                cpuSubmissionMs: submittedAt - frameStartedAt,
                queueWaitMs: completedAt - submittedAt,
                completedFrameMs: completedAt - frameStartedAt,
                gpuTimestampMs,
                gpuTimestampSupported: renderer.backend?.trackTimestamp === true,
                gpuTimestampError,
                queueCompletionSupported,
                queueCompletionError,
                counters: {
                    simulationUpdates: this.lifecycleCounters.simulationUpdates,
                    composedRenders: this.lifecycleCounters.composedRenders,
                },
                renderer: {
                    render: { ...(renderer.info?.render || {}) },
                    compute: { ...(renderer.info?.compute || {}) },
                    memory: { ...(renderer.info?.memory || {}) },
                },
            };
        } finally {
            this.validationFramePending = false;
        }
    }

    endValidationDriver() {
        if (!this.validationEnabled) {
            return { ok: false, reason: 'Stillwater validation mode is disabled.' };
        }
        const wasActive = this.validationDriverActive;
        this.validationDriverActive = false;
        this.validationFramePending = false;
        if (this.renderer?.backend) this.renderer.backend.trackTimestamp = false;
        const rendererAnimationRestarted = Boolean(
            wasActive
            && this.validationRendererAnimationWasRunning
            && !this.isPaused
            && this.renderer?._animation?._requestId == null,
        );
        if (rendererAnimationRestarted) {
            this.renderer._animation.start?.();
        }
        if (
            wasActive
            && this.validationRendererAnimationWasRunning
            && this.isPaused
        ) {
            // Validation owns the renderer-animation suspension while active.
            // If it ends during a lifecycle pause, transfer restart ownership
            // to resume() instead of waking a hidden renderer callback.
            this.rendererAnimationPausedByLifecycle = true;
        }
        this.validationRendererAnimationWasRunning = false;
        this.lastFrameTimeMs = null;
        if (wasActive && this.isActive && !this.isPaused && this.runtime && this.renderer) {
            this.animate();
        }
        return {
            ok: true,
            wasActive,
            rendererAnimationRestarted,
            animationRestarted: Boolean(
                wasActive
                && this.isActive
                && !this.isPaused
                && this.animationLoopStarted,
            ),
        };
    }

    resetPerformanceSamples() {
        this.frameSamples.fill(0);
        this.frameSampleCount = 0;
        this.frameSampleCursor = 0;
        this.lastRawFrameMs = null;
        this.maximumRawFrameMs = null;
    }

    collectPerformanceSample(deltaSeconds) {
        if (!this.performanceEnabled || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
            return;
        }
        const milliseconds = deltaSeconds * 1_000;
        this.frameSamples[this.frameSampleCursor] = milliseconds;
        this.frameSampleCursor = (this.frameSampleCursor + 1) % FRAME_SAMPLE_CAPACITY;
        this.frameSampleCount = Math.min(
            FRAME_SAMPLE_CAPACITY,
            this.frameSampleCount + 1,
        );
        this.lastRawFrameMs = milliseconds;
        this.maximumRawFrameMs = Math.max(this.maximumRawFrameMs || 0, milliseconds);
    }

    shouldRenderFrame() {
        this.lifecycleCounters.scheduledFrames += 1;
        const allowed = !this.rendererResizeJob && super.shouldRenderFrame();
        if (allowed) this.lifecycleCounters.allowedFrames += 1;
        else this.lifecycleCounters.gatedFrames += 1;
        return allowed;
    }

    getPerformanceDiagnostics() {
        const samples = new Array(this.frameSampleCount);
        const start = (
            this.frameSampleCursor
            - this.frameSampleCount
            + FRAME_SAMPLE_CAPACITY
        ) % FRAME_SAMPLE_CAPACITY;
        let total = 0;
        for (let index = 0; index < this.frameSampleCount; index += 1) {
            const value = this.frameSamples[
                (start + index) % FRAME_SAMPLE_CAPACITY
            ];
            samples[index] = value;
            total += value;
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const averageFrameMs = samples.length > 0 ? total / samples.length : null;
        return {
            enabled: this.performanceEnabled,
            sampleCount: samples.length,
            averageFrameMs,
            averageFps: averageFrameMs ? 1_000 / averageFrameMs : null,
            p95FrameMs: percentile(sorted, 0.95),
            p99FrameMs: percentile(sorted, 0.99),
            lastRawFrameMs: this.lastRawFrameMs,
            maximumRawFrameMs: this.maximumRawFrameMs,
            simulationDeltaCapMs: MAX_SIMULATION_DELTA_SECONDS * 1_000,
        };
    }

    installDiagnostics() {
        if (typeof window === 'undefined' || !this.runtime) return;
        const { runtime } = this;
        const validationApi = this.validationEnabled
            ? {
                beginValidationDriver: () => this.beginValidationDriver(),
                stepValidationFrame: (timestamp) => this.stepValidationFrame(timestamp),
                endValidationDriver: () => this.endValidationDriver(),
            }
            : {};
        this.masterpieceApi = Object.freeze({
            criticalReady: this.criticalReadyPromise,
            ready: this.fullReadyPromise,
            isCriticalReady: () => this.criticalReady && runtime === this.runtime,
            isReady: () => this.fullReady && runtime === this.runtime,
            pulse: (...args) => runtime.pulse?.(...args) ?? false,
            triggerPreset: (...args) => runtime.triggerPreset?.(...args) ?? false,
            flushReactions: (...args) => runtime.flushReactions?.(...args),
            resetReactions: () => runtime.resetReactions?.(),
            setReducedMotion: (enabled) => runtime.setReducedMotion?.(enabled),
            getCaptureMeta: () => runtime.getCaptureMeta?.(),
            setLayout: (input = {}) => this.applyLayout(
                input.width,
                input.height,
                input,
            ),
            getDiagnostics: () => ({
                ...(runtime.getDiagnostics?.() || {}),
                production: this.getDiagnostics(),
            }),
            getResourceState: () => runtime.getResourceState?.(),
            getRendererCounters: () => runtime.getRendererCounters?.(),
            ...validationApi,
        });
        this.themeDiagnosticsApi = Object.freeze({
            whenCriticalReady: () => this.whenCriticalReady(),
            whenFullReady: () => this.whenFullReady(),
            setLayout: (input = {}) => this.applyLayout(
                input.width,
                input.height,
                input,
            ),
            getDiagnostics: () => this.getDiagnostics(),
        });
        window.__STILLWATER_MASTERPIECE__ = this.masterpieceApi;
        window.__STILLWATER_THEME__ = this.themeDiagnosticsApi;
    }

    getDiagnostics() {
        const runtimeDiagnostics = this.runtime?.getDiagnostics?.() || null;
        return {
            lifecycle: this.lifecycleState,
            generation: this.runtimeGeneration,
            rendererIdentity: this.rendererIdentity,
            backend: this.backendName,
            isWebGPU: this.isWebGPU,
            isWebGL: this.isWebGL,
            forceWebGL: this.forceWebGL,
            validation: {
                enabled: this.validationEnabled,
                driverActive: this.validationDriverActive,
                framePending: this.validationFramePending,
                gpuTimestampSupported: this.validationTimestampSupported,
                gpuTimestampTracking: this.renderer?.backend?.trackTimestamp === true,
                activation: this.getActivationTelemetryDiagnostics(runtimeDiagnostics),
            },
            rendererPowerPreference: this.rendererPowerPreference,
            rendererPoolReused: this.rendererPoolReused,
            rendererAnimation: {
                requestActive: this.renderer?._animation?._requestId != null,
                pausedByLifecycle: this.rendererAnimationPausedByLifecycle,
                suspendedForValidation: Boolean(
                    this.validationDriverActive
                    && this.validationRendererAnimationWasRunning,
                ),
            },
            recoveryAttempted: this.gpuRecoveryAttempted,
            quality: this.quality,
            qualityProfile: this.qualityProfile.name,
            pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
            antialiasing: this.appliedAntialiasing,
            bloom: this.appliedBloom,
            reducedMotion: this.prefersReducedMotion(),
            layout: this.layoutPolicy,
            readiness: {
                critical: this.criticalReady,
                full: this.fullReady,
            },
            counters: { ...this.lifecycleCounters },
            frame: this.getPerformanceDiagnostics(),
            renderer: {
                autoReset: this.renderer?.info?.autoReset ?? null,
                render: { ...(this.renderer?.info?.render || {}) },
                compute: { ...(this.renderer?.info?.compute || {}) },
                memory: { ...(this.renderer?.info?.memory || {}) },
            },
            runtime: runtimeDiagnostics,
        };
    }

    disposeRuntime() {
        this.stopActivationLongTaskObserver();
        this.activationTelemetry = null;
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.clearEventUnsubscribers();
        this.clearModeManagerListeners();
        this.clearTrackedResources();
        this.removeRendererResilience();
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;

        if (typeof window !== 'undefined') {
            if (
                this.masterpieceApi
                && window.__STILLWATER_MASTERPIECE__ === this.masterpieceApi
            ) {
                delete window.__STILLWATER_MASTERPIECE__;
            }
            if (
                this.themeDiagnosticsApi
                && window.__STILLWATER_THEME__ === this.themeDiagnosticsApi
            ) {
                delete window.__STILLWATER_THEME__;
            }
        }
        this.masterpieceApi = null;
        this.themeDiagnosticsApi = null;

        try {
            this.runtimeDetach?.();
        } catch (error) {
            console.warn('[Stillwater] Gameplay detach failed:', error);
        }
        this.runtimeDetach = null;
        if (this.runtime) {
            try {
                this.runtime.dispose?.();
            } catch (error) {
                console.warn('[Stillwater] Runtime cleanup failed:', error);
            }
            this.runtime = null;
        }

        this.scene?.clear?.();
        this.scene = null;
        this.camera = null;
        if (this.renderer) {
            const { renderer } = this;
            const poolable = !this.rendererResizeJob
                && !this.rendererResizeInFlight
                && !this.gpuRecoveryAttempted
                && renderer._isDeviceLost !== true;
            this.renderer = null;
            if (poolable) this.storePooledRenderer(renderer);
            else this.disposeOwnedRenderer(renderer, { nullInstance: false });
        }

        this.layoutPolicy = null;
        this.reducedMotionQuery = null;
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
        this.validationEnabled = false;
        this.validationDriverActive = false;
        this.validationFramePending = false;
        this.validationTimestampSupported = false;
        this.validationRendererAnimationWasRunning = false;
        this.rendererAnimationPausedByLifecycle = false;
        this.rendererPowerPreference = 'high-performance';
        this.rendererPoolReused = false;
        this.pendingRendererResize = null;
        this.rendererResizeJob = null;
        this.rendererResizeInFlight = false;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.backendName = 'Unavailable';
        this.appliedAntialiasing = null;
        this.appliedBloom = null;
        this.criticalReady = false;
        this.fullReady = false;
        this.criticalReadyPromise = Promise.resolve(false);
        this.fullReadyPromise = Promise.resolve(false);
        this.resetPerformanceSamples();
    }

    async whenCriticalReady() {
        try {
            return Boolean(await this.criticalReadyPromise);
        } catch {
            return false;
        }
    }

    async whenFullReady() {
        try {
            return Boolean(await this.fullReadyPromise);
        } catch {
            return false;
        }
    }

    getTetrominoConfig() {
        return STILLWATER_TETROMINOS;
    }

    pause() {
        const paused = super.pause();
        if (paused) {
            this.lifecycleCounters.pauses += 1;
            const rendererAnimation = this.renderer?._animation;
            const wasRunning = rendererAnimation?._requestId != null;
            if (wasRunning) {
                try {
                    rendererAnimation.stop?.();
                    this.rendererAnimationPausedByLifecycle = (
                        rendererAnimation?._requestId == null
                    );
                } catch (error) {
                    this.rendererAnimationPausedByLifecycle = false;
                }
                if (this.rendererAnimationPausedByLifecycle) {
                    this.lifecycleCounters.rendererAnimationPauseStops += 1;
                }
            } else {
                this.rendererAnimationPausedByLifecycle = false;
            }
            this.animationIds = [];
            this.lastFrameTimeMs = null;
            this.applyRuntimeSettings();
        }
        return paused;
    }

    resume() {
        if (!this.runtime || !this.renderer || !this.scene || !this.camera) return false;
        const resumed = super.resume();
        if (resumed) {
            this.lifecycleCounters.resumes += 1;
            if (
                this.rendererAnimationPausedByLifecycle
                && !this.validationDriverActive
                && this.renderer?._animation?._requestId == null
            ) {
                try {
                    this.renderer._animation.start?.();
                    if (this.renderer._animation._requestId != null) {
                        this.rendererAnimationPausedByLifecycle = false;
                        this.lifecycleCounters.rendererAnimationResumeStarts += 1;
                    }
                } catch (error) { /* leave pending for a later resume attempt */ }
            }
            this.lastFrameTimeMs = null;
            this.applyLayout();
            this.setupModeManagerListeners();
            this.applyRuntimeSettings();
            this.animate();
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
