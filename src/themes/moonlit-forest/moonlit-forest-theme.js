/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Forest — "Silverheart Glade" production wrapper.
 *
 * The visual surface lives in the WebGPU/TSL playground runtime. This class only
 * owns the BaseTheme lifecycle, renderer backend selection, gameplay-event bridge,
 * quality hand-off, warm render, resize, and deterministic cleanup.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { create as createMoonlitForestScene } from '../../playground/effects/moonlit-forest-master.effect.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';
import { MOONLIT_FOREST_TETROMINOS } from './moonlit-forest-tetrominos.js';
import { MoonlitForestFXController } from './moonlit-forest-fx-controller.js';

const QUALITY_LEVELS = Object.freeze([
    'Minimal',
    'Low',
    'Medium',
    'High',
    'Ultra',
    'Extreme',
]);

const QUALITY_DPR_CAPS = Object.freeze({
    Minimal: 0.8,
    Low: 1,
    Medium: 1.15,
    High: 1.35,
    Ultra: 1.5,
    Extreme: 1.5,
});

const FX_QUALITY = Object.freeze({
    Minimal: {
        comboEffects: {
            fireflyMultiplier: 0.2,
            sporesMultiplier: 0.2,
            wispsMultiplier: 0,
            auroraEnabled: false,
            shootingStarsEnabled: false,
        },
    },
    Low: {
        comboEffects: {
            fireflyMultiplier: 0.4,
            sporesMultiplier: 0.4,
            wispsMultiplier: 0.3,
            auroraEnabled: false,
            shootingStarsEnabled: false,
        },
    },
    Medium: {
        comboEffects: {
            fireflyMultiplier: 0.65,
            sporesMultiplier: 0.65,
            wispsMultiplier: 0.65,
            auroraEnabled: true,
            shootingStarsEnabled: false,
        },
    },
    High: {
        comboEffects: {
            fireflyMultiplier: 0.85,
            sporesMultiplier: 0.85,
            wispsMultiplier: 0.85,
            auroraEnabled: true,
            shootingStarsEnabled: true,
        },
    },
    Ultra: {
        comboEffects: {
            fireflyMultiplier: 1.1,
            sporesMultiplier: 1.1,
            wispsMultiplier: 1.1,
            auroraEnabled: true,
            shootingStarsEnabled: true,
        },
    },
    Extreme: {
        comboEffects: {
            fireflyMultiplier: 1.5,
            sporesMultiplier: 1.5,
            wispsMultiplier: 1.5,
            auroraEnabled: true,
            shootingStarsEnabled: true,
        },
    },
});

function readBoolParam(...keys) {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        if (value === null || value === '') return true;
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });
}

function normalizeQuality(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return QUALITY_LEVELS.find((quality) => quality.toLowerCase() === normalized) || 'High';
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** Map the controller's board-neutral origin to Silverheart Glade's water plane. */
export function mapMoonlitOriginToWorld(origin) {
    if (!origin || typeof origin !== 'object') return null;

    if (Number.isFinite(origin.position?.x) && Number.isFinite(origin.position?.z)) {
        return {
            x: clamp(Number(origin.position.x), -180, 180),
            z: clamp(Number(origin.position.z), -180, 52),
        };
    }

    if (!Number.isFinite(origin.normalized?.x) || !Number.isFinite(origin.normalized?.y)) {
        return null;
    }

    return {
        x: THREE.MathUtils.lerp(-18, 18, clamp(origin.normalized.x, 0, 1)),
        z: THREE.MathUtils.lerp(-86, -38, clamp(origin.normalized.y, 0, 1)),
    };
}

/** Map Serenity's canonical viewport-pixel interaction to the glade water plane. */
export function mapMoonlitViewportPointToWorld(position, width, height) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    return {
        x: THREE.MathUtils.lerp(-18, 18, clamp(Number(position.x) / safeWidth, 0, 1)),
        z: THREE.MathUtils.lerp(-86, -38, clamp(Number(position.y) / safeHeight, 0, 1)),
    };
}

export default class MoonlitForestTheme extends BaseTheme {
    constructor() {
        super('moonlit-forest');

        this.resourceProfile = 'heavy-gpu';
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.runtime = null;
        this.isWebGPU = false;
        this.quality = 'High';
        this.fxQuality = FX_QUALITY.High;
        this.fxController = new MoonlitForestFXController();
        this.lastReactiveWorldOrigin = { x: 0, z: -62 };
        this.eventUnsubscribers = [];
        this.boundResizeHandler = null;
        this.animationLoopStarted = false;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
        this.runtimeGeneration = 0;
        this.perfEnabled = false;
        this.perfFrameSamples = [];
        this.diagnosticsHook = null;
        this.gpuSurfaceUnregister = null;
        this.gpuRecoveryAttempted = false;
    }

    getQualitySetting() {
        if (typeof window === 'undefined') return 'High';
        const params = new URLSearchParams(window.location.search);
        const requested = params.get('moonlitQuality')
            || params.get('quality')
            || window.settings?.effectQuality
            || window.settings?.graphicsQuality
            || 'High';
        return normalizeQuality(requested);
    }

    getRuntimeParams() {
        const params = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        if (!params.has('quality')) params.set('quality', this.quality);
        return params;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[MoonlitForest] Theme container not found.');
            return;
        }

        this.disposeRuntime();
        // Moonlit owns its full visual stack. BaseTheme's shared transparent WebGL
        // surface has no particles for this theme, so stop its zero-draw clear loop.
        this.webglRenderer?.stop?.();
        const generation = ++this.runtimeGeneration;
        container.replaceChildren();

        this.quality = this.getQualitySetting();
        this.fxQuality = FX_QUALITY[this.quality] || FX_QUALITY.High;
        this.perfEnabled = readBoolParam('moonlitPerf', 'moonlitBaseline', 'baseline');
        this.perfFrameSamples = [];
        this.fxController.reset();

        const rendererReady = await this.initRenderer(container, generation, ownerGeneration);
        if (!rendererReady || generation !== this.runtimeGeneration) return;

        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 2400);

        try {
            this.runtime = createMoonlitForestScene({
                THREE,
                scene: this.scene,
                camera: this.camera,
                renderer: this.renderer,
                sizes: { width, height },
                params: this.getRuntimeParams(),
                quality: this.quality,
            });
            this.setupResize();
            this.setupEventListeners();
            this.applyReactiveState();
            await this.warmRuntime(generation);
        } catch (error) {
            console.error('[MoonlitForest] Scene creation failed:', error);
            if (generation === this.runtimeGeneration) this.disposeRuntime();
            return;
        }

        if (generation !== this.runtimeGeneration || !this.isActive) return;
        if (this.perfEnabled && typeof window !== 'undefined') {
            this.diagnosticsHook = () => this.getDiagnostics();
            window.__MOONLIT_FOREST_DIAGNOSTICS__ = this.diagnosticsHook;
        }
        this.startAnimationLoop();
        console.log(
            `[MoonlitForest] Silverheart Glade ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'}, ${this.quality})`,
        );
    }

    async createRendererCandidate(forceWebGL, ownerGeneration) {
        const renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL,
            powerPreference: 'high-performance',
        });
        return this.initializeRendererCandidate(renderer, {
            timeoutMs: 5000,
            label: `Moonlit Forest ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
            ownerGeneration,
        });
    }

    async initRenderer(container, generation, ownerGeneration = this.lifecycleGeneration) {
        const requestedWebGL = this.forceWebGL === true
            || readBoolParam('forceWebGL', 'moonlitForceWebGL');
        const canAttemptWebGPU = !requestedWebGL
            && typeof navigator !== 'undefined'
            && !!navigator.gpu;
        let renderer = null;

        if (canAttemptWebGPU) {
            try {
                renderer = await this.createRendererCandidate(false, ownerGeneration);
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose();
                    renderer = null;
                }
            } catch (error) {
                if (generation !== this.runtimeGeneration
                    || ownerGeneration !== this.lifecycleGeneration
                    || !this.isActive
                    || this.cleanupComplete) return false;
                console.warn('[MoonlitForest] WebGPU init failed; trying WebGL2:', error);
            }
        }

        if (!renderer) {
            if (generation !== this.runtimeGeneration
                || ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) return false;
            try {
                renderer = await this.createRendererCandidate(true, ownerGeneration);
            } catch (error) {
                console.error('[MoonlitForest] Renderer init failed:', error);
                if (generation === this.runtimeGeneration) {
                    container.innerHTML = '<div style="color:#c5d8dc;text-align:center;padding:2em;'
                        + 'font-family:sans-serif;">Moonlit Forest needs WebGPU or WebGL2.</div>';
                }
                throw new Error('Moonlit Forest could not initialize WebGPU or WebGL2.', { cause: error });
            }
        }

        if (generation !== this.runtimeGeneration
            || ownerGeneration !== this.lifecycleGeneration
            || !this.isActive
            || this.cleanupComplete) {
            renderer.dispose();
            return false;
        }

        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setPixelRatio(this.getEffectivePixelRatio(QUALITY_DPR_CAPS[this.quality], 'theme'));
        renderer.setSize(width, height);
        renderer.setClearColor(0x050812, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'moonlit-forest-renderer';
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
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
                        throw new Error('Moonlit Forest WebGPU recovery already attempted.');
                    }
                    this.gpuRecoveryAttempted = true;
                    this.forceWebGL = true;
                    if (this.isActive) await this.createScene();
                },
            });
        }
        return true;
    }

    async warmRuntime(generation) {
        if (!this.runtime || !this.renderer || !this.scene || !this.camera) return;

        this.runtime.camera?.(0, this.camera);
        this.runtime.update?.(0, 0);
        try {
            // MEASURED 2026-08-25 (sweep cell): the bare compileAsync here already warmed the
            // RIGHT pipelines — 29 async vs 9 sync leftovers, 53 ms after-gap, the best in the
            // WebGPU fleet — but r185 awaits pipeline promises per object, so the 25 timed
            // compiles ran strictly one at a time: 2,497 ms of compile inside a 2,903 ms wall
            // (0.83x parallelism), all of it inside switchWallMs. The helper fans the same
            // compiles out at concurrency 6. There is no post stack here, so it binds nothing
            // and preserves this call's exact render context — the argument order is three's
            // compileAsync contract (objectToCompile, camera, targetScene), scene in both seats
            // for a whole-scene warm.
            await compileGroupThroughPost(
                this.renderer,
                null,
                this.scene,
                this.camera,
                this.scene,
                false,
            );
        } catch (error) {
            console.warn('[MoonlitForest] Pipeline precompile was incomplete:', error);
        }
        if (generation !== this.runtimeGeneration || !this.renderer) return;

        if (this.runtime.render) this.runtime.render();
        else this.renderer.render(this.scene, this.camera);
    }

    setupResize() {
        this.boundResizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        this.registerEventListener(window, 'resize', this.boundResizeHandler);
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const safeWidth = Math.max(1, width);
        const safeHeight = Math.max(1, height);
        this.camera.aspect = safeWidth / safeHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(QUALITY_DPR_CAPS[this.quality], 'theme'));
        this.renderer.setSize(safeWidth, safeHeight);
        this.runtime?.resize?.(safeWidth, safeHeight);
    }

    effectsAllowed() {
        return this.isActive !== false
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);
    }

    getReactiveIntensity() {
        if (typeof window === 'undefined') return 1;
        if (window.settings?.backgroundComboEffects === false) return 0;
        return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0.45 : 1;
    }

    setupEventListeners() {
        this.clearEventUnsubscribers();
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.LINE_CLEAR, (data) => {
                if (this.effectsAllowed()) this.onLineClear(data);
            }),
            eventBus.on(EVENTS.COMBO, (data) => {
                if (this.effectsAllowed()) this.onCombo(data);
            }),
            eventBus.on(EVENTS.PIECE_LOCK, (data) => {
                if (this.effectsAllowed()) this.onPieceLock(data);
            }),
            eventBus.on(EVENTS.TSPIN, (data) => {
                if (this.effectsAllowed()) this.onTSpin(data);
            }),
            eventBus.on(EVENTS.PERFECT_CLEAR, (data) => {
                if (this.effectsAllowed()) this.onPerfectClear(data);
            }),
        );

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            this.registerEventListener(window, 'settingsChanged', (event) => {
                const detail = event.detail || {};
                const hasQualityChange = Object.prototype.hasOwnProperty.call(detail, 'effectQuality')
                    || Object.prototype.hasOwnProperty.call(detail, 'graphicsQuality')
                    || Object.prototype.hasOwnProperty.call(detail.changed || {}, 'effectQuality')
                    || Object.prototype.hasOwnProperty.call(detail.changed || {}, 'graphicsQuality');
                const hasAntialiasChange = Object.prototype.hasOwnProperty.call(
                    detail,
                    'enableAntialiasing',
                );
                const nextQuality = this.getQualitySetting();
                if (this.isActive && (hasAntialiasChange || (hasQualityChange && nextQuality !== this.quality))) {
                    this.createScene().catch((error) => {
                        console.error('[MoonlitForest] Quality rebuild failed:', error);
                    });
                    return;
                }
                this.resize(window.innerWidth, window.innerHeight);
            });
        }
    }

    resolveEventWorldOrigin(payload = {}) {
        if (Number.isFinite(payload.worldOrigin?.x) && Number.isFinite(payload.worldOrigin?.z)) {
            return {
                x: clamp(Number(payload.worldOrigin.x), -180, 180),
                z: clamp(Number(payload.worldOrigin.z), -180, 52),
            };
        }
        if (payload.source === 'serenity-interaction' && typeof window !== 'undefined') {
            return mapMoonlitViewportPointToWorld(
                payload.position,
                window.innerWidth,
                window.innerHeight,
            ) || this.lastReactiveWorldOrigin;
        }
        return this.lastReactiveWorldOrigin;
    }

    onLineClear(data = {}) {
        const payload = typeof data === 'number' ? { lineCount: data } : (data || {});
        const directives = this.fxController.onLineClear(payload.lineCount, this.fxQuality);
        const worldOrigin = this.resolveEventWorldOrigin(payload);
        this.lastReactiveWorldOrigin = worldOrigin;
        this.runtime?.triggerEvent?.('lineClear', {
            ...payload,
            worldOrigin,
            intensity: this.getReactiveIntensity(),
            directives,
        });
        this.flushQueuedBursts();
        this.applyReactiveState();
        return directives;
    }

    onCombo(data = {}) {
        const payload = typeof data === 'number' ? { comboCount: data } : (data || {});
        const directives = this.fxController.onCombo(payload.comboCount, this.fxQuality);
        const worldOrigin = this.resolveEventWorldOrigin(payload);
        this.lastReactiveWorldOrigin = worldOrigin;
        this.runtime?.triggerEvent?.('combo', {
            ...payload,
            worldOrigin,
            intensity: this.getReactiveIntensity(),
            directives,
        });
        this.flushQueuedBursts();
        this.applyReactiveState();
        return directives;
    }

    onPieceLock(data = {}) {
        const payload = data || {};
        const directives = this.fxController.onPieceLock(payload);
        const worldOrigin = mapMoonlitOriginToWorld(directives.origin);
        if (worldOrigin) this.lastReactiveWorldOrigin = worldOrigin;
        this.runtime?.triggerEvent?.('pieceLock', {
            ...payload,
            origin: worldOrigin || this.lastReactiveWorldOrigin,
            boardOrigin: directives.origin,
            intensity: this.getReactiveIntensity(),
            directives,
        });
        this.flushQueuedBursts();
        this.applyReactiveState();
        return directives;
    }

    onTSpin(data = {}) {
        this.runtime?.triggerEvent?.('tspin', {
            ...(data || {}),
            worldOrigin: this.resolveEventWorldOrigin(data || {}),
            intensity: this.getReactiveIntensity(),
        });
    }

    onPerfectClear(data = {}) {
        this.runtime?.triggerEvent?.('perfectClear', {
            ...(data || {}),
            worldOrigin: this.resolveEventWorldOrigin(data || {}),
            intensity: this.getReactiveIntensity(),
        });
    }

    flushQueuedBursts() {
        const queued = this.fxController.drainParticleBursts();
        const intensity = this.getReactiveIntensity();
        const bursts = queued.map((burst) => {
            const worldOrigin = mapMoonlitOriginToWorld(burst.origin)
                || this.lastReactiveWorldOrigin;
            return {
                name: burst.name,
                amount: burst.amount,
                intensity,
                origin: worldOrigin,
                payload: {
                    amount: burst.amount,
                    intensity,
                    origin: worldOrigin,
                    boardOrigin: burst.origin,
                },
            };
        });
        if (bursts.length > 0) this.runtime?.triggerBursts?.(bursts);
        return bursts;
    }

    applyReactiveState() {
        if (!this.runtime?.setReactive) return;
        const signals = this.fxController.getSignals();
        const intensity = this.getReactiveIntensity();
        this.runtime.setReactive({
            energy: 0.16 + (clamp(signals.atmospherePulse / 2.5, 0, 1) * intensity * 0.84),
            lockPulse: clamp(signals.pieceLockPulse, 0, 1) * intensity,
            comboPulse: clamp(Math.max(
                signals.linePulse / 1.5,
                signals.comboEnergy / 2.5,
            ), 0, 1) * intensity,
            origin: this.lastReactiveWorldOrigin,
        });
    }

    startAnimationLoop() {
        if (this.animationLoopStarted || !this.runtime || !this.renderer) return;
        this.animationLoopStarted = true;
        this.lastFrameTimeMs = null;

        const animate = this.safeAnimate((timestamp) => {
            const rawDelta = this.lastFrameTimeMs === null
                ? 1 / 60
                : (timestamp - this.lastFrameTimeMs) / 1000;
            const delta = Number.isFinite(rawDelta) ? clamp(rawDelta, 0, 0.05) : 1 / 60;
            this.lastFrameTimeMs = timestamp;
            this.elapsedTime += delta;

            this.fxController.step(delta);
            this.applyReactiveState();
            this.runtime?.update?.(this.elapsedTime, delta);
            if (this.runtime?.render) this.runtime.render();
            else this.renderer.render(this.scene, this.camera);
            this.collectPerformanceSample(delta);
        }, { maxConsecutiveErrors: 3 });

        animate();
    }

    collectPerformanceSample(delta) {
        if (!this.perfEnabled || !Number.isFinite(delta) || delta <= 0) return;
        this.perfFrameSamples.push(delta * 1000);
        if (this.perfFrameSamples.length > 240) this.perfFrameSamples.shift();
    }

    getDiagnostics() {
        const runtime = this.runtime?.getDiagnostics?.() || {};
        const render = this.renderer?.info?.render || {};
        const memory = this.renderer?.info?.memory || {};
        const samples = this.perfFrameSamples;
        const averageFrameMs = samples.length > 0
            ? samples.reduce((sum, value) => sum + value, 0) / samples.length
            : null;
        const sorted = samples.length > 0 ? [...samples].sort((a, b) => a - b) : [];
        const p95FrameMs = sorted.length > 0
            ? sorted[Math.floor((sorted.length - 1) * 0.95)]
            : null;
        return {
            ...runtime,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.quality,
            pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
            drawCalls: render.drawCalls ?? render.calls ?? 0,
            triangles: render.triangles ?? 0,
            geometries: memory.geometries ?? 0,
            textures: memory.textures ?? 0,
            averageFrameMs,
            p95FrameMs,
            averageFps: averageFrameMs ? 1000 / averageFrameMs : null,
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
            this.diagnosticsHook
            && typeof window !== 'undefined'
            && window.__MOONLIT_FOREST_DIAGNOSTICS__ === this.diagnosticsHook
        ) {
            delete window.__MOONLIT_FOREST_DIAGNOSTICS__;
        }
        this.diagnosticsHook = null;

        if (this.runtime) {
            try { this.runtime.dispose?.(); } catch (error) {
                console.warn('[MoonlitForest] Runtime dispose failed:', error);
            }
            this.runtime = null;
        }

        if (this.scene) {
            this.disposeThreeJSGroup(this.scene);
            this.scene.clear?.();
            this.scene = null;
        }
        this.camera = null;

        if (this.renderer) {
            const { renderer } = this;
            this.renderer = null;
            this.disposeRenderer(renderer, { nullInstance: false });
        }

        this.fxController.reset();
        this.lastReactiveWorldOrigin = { x: 0, z: -62 };
        this.animationLoopStarted = false;
        this.boundResizeHandler = null;
        this.lastFrameTimeMs = null;
        this.elapsedTime = 0;
        this.isWebGPU = false;
    }

    getTetrominoConfig() {
        return MOONLIT_FOREST_TETROMINOS;
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
