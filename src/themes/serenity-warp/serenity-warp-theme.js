/**
 * Serenity Warp — selectable-theme adapter for the cinematic intro renderer.
 *
 * The intro remains the single source of visual truth. This class supplies the
 * BaseTheme lifecycle, quality mapping, WebGL fallback, gameplay reactivity,
 * GPU-loss handling, and deterministic cleanup needed by Serenity Hub.
 */
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { INTRO_PHASES } from '../../ui/intro-visual-config.js';
import {
    SERENITY_WARP_FX_COMMAND,
    SerenityWarpFXController,
} from './serenity-warp-fx-controller.js';
import { createSerenityWarpGameplayFX } from './serenity-warp-gameplay-fx.js';
import { SerenityWarpReactionDirector } from './serenity-warp-reaction-director.js';
import { SERENITY_WARP_TETROMINOS } from './serenity-warp-tetrominos.js';

const WEBGPU_INIT_TIMEOUT_MS = 5500;
const THEME_TETROMINO_MINIMUM_RESIDENCE_MS = 90_000;

function readBoolParam(...keys) {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        return value === null || value === '' || ['1', 'true', 'yes'].includes(value.toLowerCase());
    });
}

function resolvePerformanceBudget() {
    const configured = typeof window !== 'undefined'
        ? (window.settings?.effectQuality || window.settings?.graphicsQuality || 'High')
        : 'High';
    const quality = String(configured).trim().toLowerCase();
    if (quality === 'minimal' || quality === 'low') return 'LOW';
    if (quality === 'medium') return 'MEDIUM';
    return 'HIGH';
}

function resolveGameplayQuality() {
    const budget = resolvePerformanceBudget();
    if (budget === 'LOW') return 'Low';
    if (budget === 'MEDIUM') return 'Medium';
    return 'High';
}

export default class SerenityWarpTheme extends BaseTheme {
    constructor() {
        super('serenity-warp');
        this.resourceProfile = 'heavy-gpu';
        this.visual = null;
        this.canvas = null;
        this.overlay = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.isWebGPU = false;
        this.gameplayFxController = null;
        this.gameplayFx = null;
        this.reactionDirector = null;
        this.reducedMotionQuery = null;
        this.animationLoopStarted = false;
        this.elapsedTime = 0;
        this.lastFrameTime = null;
        this.reactivePulse = 0;
        this.eventUnsubscribers = [];
        this.gpuSurfaceUnregister = null;
        this.gpuRecoveryAttempted = false;
        this.sceneGeneration = 0;
    }

    async createScene() {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            throw new Error('[SerenityWarp] Theme container not found');
        }

        this.disposeRuntime();
        const { sceneGeneration } = this;
        container.innerHTML = '';
        container.style.overflow = 'hidden';
        container.style.background = '#02000d';

        let canvas = this.createCanvas(container);
        let visual = null;

        const forceWebGL = readBoolParam('forceWebGL', 'serenityWarpForceWebGL');
        const canUseWebGPU = !forceWebGL && typeof navigator !== 'undefined' && !!navigator.gpu;
        if (canUseWebGPU) {
            visual = await this.createWebGPUVisual(canvas);
            if (!this.isCurrentScene(sceneGeneration)) {
                visual?.destroy?.();
                canvas.remove();
                return;
            }
        }

        if (!visual) {
            canvas = this.replaceCanvas(container, canvas);
            visual = await this.createWebGLVisual(canvas);
            if (!this.isCurrentScene(sceneGeneration)) {
                visual?.destroy?.();
                canvas.remove();
                return;
            }
        }

        if (!visual) {
            canvas.remove();
            throw new Error('Serenity Warp needs WebGPU or WebGL2');
        }

        if (!this.isActive) {
            visual.destroy?.();
            canvas.remove();
            return;
        }

        this.visual = visual;
        this.canvas = canvas;
        this.renderer = visual.renderer || null;
        this.scene = visual.scene || null;
        this.camera = visual.camera || null;
        this.isWebGPU = visual.getDevice?.() != null;

        this.configureVisual();
        this.setupGameplayFx();
        this.createOverlay(container);
        this.setupReactivity();
        this.setupGpuResilience();
        this.animate();

        console.log(`[SerenityWarp] Scene created (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
    }

    isCurrentScene(sceneGeneration) {
        return this.isActive && sceneGeneration === this.sceneGeneration;
    }

    createCanvas(container) {
        const canvas = document.createElement('canvas');
        canvas.id = 'serenity-warp-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            zIndex: '0',
            pointerEvents: 'none',
        });
        container.appendChild(canvas);
        return canvas;
    }

    replaceCanvas(container, previousCanvas) {
        previousCanvas?.remove();
        return this.createCanvas(container);
    }

    async createWebGPUVisual(canvas) {
        let visual = null;
        let timedOut = false;
        try {
            const { default: IntroWebGPUVisual } = await import('../../ui/threejs-intro-renderer-webgpu.js');
            visual = new IntroWebGPUVisual(canvas);
            const initPromise = Promise.resolve(visual.init());
            let timeoutId = null;
            const initialized = await Promise.race([
                initPromise,
                new Promise((resolve) => {
                    timeoutId = setTimeout(() => {
                        timedOut = true;
                        resolve(false);
                    }, WEBGPU_INIT_TIMEOUT_MS);
                }),
            ]).finally(() => {
                if (timeoutId !== null) clearTimeout(timeoutId);
            });

            if (timedOut) {
                initPromise.then(
                    () => visual.destroy?.(),
                    () => visual.destroy?.(),
                );
                console.warn('[SerenityWarp] WebGPU init timed out; using WebGL2 fallback');
                return null;
            }

            if (!initialized) {
                visual.destroy?.();
                return null;
            }
            return visual;
        } catch (error) {
            if (!timedOut) visual?.destroy?.();
            console.warn('[SerenityWarp] WebGPU init failed; using WebGL2 fallback:', error);
            return null;
        }
    }

    async createWebGLVisual(canvas) {
        let visual = null;
        try {
            const { default: IntroWebGLVisual } = await import('../../ui/threejs-intro-renderer.js');
            visual = new IntroWebGLVisual(canvas);
            if (!visual.init()) {
                visual.destroy?.();
                return null;
            }
            return visual;
        } catch (error) {
            visual?.destroy?.();
            console.error('[SerenityWarp] WebGL2 fallback failed:', error);
            return null;
        }
    }

    configureVisual() {
        const budget = resolvePerformanceBudget();
        this.visual?.setPerformanceBudget?.(budget);
        this.visual?.setBackgroundMode?.(false);
        this.visual?.setTitleEffectsEnabled?.(false);
        this.visual?.setTetrominoTitleAvoidanceEnabled?.(false);
        this.visual?.setTetrominoRecyclingPolicy?.({
            mode: 'minimum-residence',
            minimumResidenceMs: THEME_TETROMINO_MINIMUM_RESIDENCE_MS,
        });
        this.visual?.setPhase?.(INTRO_PHASES.IDLE, true);
    }

    prefersReducedMotion() {
        if (typeof window === 'undefined') return false;
        return window.settings?.reducedMotion === true
            || this.reducedMotionQuery?.matches === true;
    }

    areGameplayEffectsEnabled() {
        return typeof window === 'undefined'
            || window.settings?.backgroundComboEffects !== false;
    }

    setupGameplayFx() {
        if (!this.scene || !this.camera) return;

        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        }

        const reducedMotion = this.prefersReducedMotion();
        this.gameplayFxController = new SerenityWarpFXController({ reducedMotion });
        // Whole-scene reaction director: drives the intro renderer's opt-in surge levers
        // so combos surge the entire warp tunnel, not just the discrete overlay geometry.
        this.reactionDirector = new SerenityWarpReactionDirector({
            reducedMotion,
            intensity: this.areGameplayEffectsEnabled() ? 1 : 0,
        });

        try {
            this.gameplayFx = createSerenityWarpGameplayFX({
                scene: this.scene,
                camera: this.camera,
                isWebGPU: this.isWebGPU,
                quality: resolveGameplayQuality(),
                reducedMotion,
                intensity: this.areGameplayEffectsEnabled() ? 1 : 0,
            });
        } catch (error) {
            this.gameplayFx = null;
            console.warn('[SerenityWarp] Gameplay FX unavailable; continuing with ambient theme:', error);
        }
    }

    applyGameplaySettings() {
        const reducedMotion = this.prefersReducedMotion();
        const effectsEnabled = this.areGameplayEffectsEnabled();
        if (!effectsEnabled) this.reactivePulse = 0;
        this.gameplayFxController?.configure?.({ reducedMotion });
        this.reactionDirector?.configure?.({ reducedMotion, intensity: effectsEnabled ? 1 : 0 });
        try {
            this.gameplayFx?.setQuality?.(resolveGameplayQuality());
            this.gameplayFx?.setReducedMotion?.(reducedMotion);
            this.gameplayFx?.setIntensity?.(effectsEnabled ? 1 : 0);
        } catch (error) {
            this.disableGameplayFx('settings update', error);
        }
    }

    createOverlay(container) {
        const overlay = document.createElement('div');
        overlay.className = 'serenity-warp-atmosphere';
        overlay.setAttribute('aria-hidden', 'true');
        Object.assign(overlay.style, {
            position: 'absolute',
            inset: '0',
            zIndex: '1',
            pointerEvents: 'none',
            background: [
                'radial-gradient(ellipse at center, transparent 42%, rgba(0, 0, 0, 0.58) 100%)',
                'linear-gradient(180deg, rgba(2, 8, 20, 0.28) 0%, transparent 28%,'
                    + ' transparent 68%, rgba(0, 0, 0, 0.34) 100%)',
                'repeating-linear-gradient(0deg, transparent 0, transparent 2px,'
                    + ' rgba(255,255,255,0.008) 2px, rgba(255,255,255,0.008) 4px)',
            ].join(','),
        });
        container.appendChild(overlay);
        this.overlay = overlay;
    }

    setupReactivity() {
        const dispatch = (eventName, payload, pulseValue) => {
            if (!this.isActive) return;
            this.gameplayFxController?.dispatch?.(eventName, payload);
            if (this.areGameplayEffectsEnabled()) {
                this.reactivePulse = Math.max(this.reactivePulse, pulseValue);
                this.reactionDirector?.pulse(eventName, payload);
            }
        };

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (data) => dispatch('PIECE_LOCK', data, 0.16)),
            eventBus.on(EVENTS.LINE_CLEAR, (data) => dispatch(
                'LINE_CLEAR',
                data,
                Math.min(1, 0.28 + (data?.lineCount || 1) * 0.14),
            )),
            eventBus.on(EVENTS.COMBO, (data) => dispatch(
                'COMBO',
                data,
                Math.min(1, 0.32 + (data?.comboCount || 0) * 0.07),
            )),
            eventBus.on(EVENTS.TSPIN, (data) => dispatch('TSPIN', data, 0.82)),
            eventBus.on(EVENTS.PERFECT_CLEAR, (data) => dispatch('PERFECT_CLEAR', data, 1)),
            eventBus.on(EVENTS.B2B, (data) => dispatch('B2B', data, 0.52)),
        );

        const handleSettingsChanged = () => {
            this.configureVisual();
            this.applyGameplaySettings();
        };
        this.registerEventListener(window, 'settingsChanged', handleSettingsChanged);
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.SETTINGS_CHANGED, handleSettingsChanged),
        );

        if (this.reducedMotionQuery?.addEventListener) {
            this.registerEventListener(this.reducedMotionQuery, 'change', () => {
                this.applyGameplaySettings();
            });
        }
    }

    forwardGameplayCommands() {
        const commands = this.gameplayFxController?.drainCommands?.() || [];
        if (!this.gameplayFx || !this.areGameplayEffectsEnabled()) return;

        const showPhaseSeal = typeof window === 'undefined'
            || window.settings?.pieceLockRipple !== false;
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            if (!showPhaseSeal && command.type === SERENITY_WARP_FX_COMMAND.PHASE_SEAL) continue;
            try {
                this.gameplayFx.enqueue?.(command);
            } catch (error) {
                this.disableGameplayFx('command enqueue', error);
                break;
            }
        }
    }

    disableGameplayFx(operation, error) {
        console.warn(`[SerenityWarp] Gameplay FX ${operation} failed; continuing with ambient theme:`, error);
        try {
            this.gameplayFx?.dispose?.();
        } catch (disposeError) {
            console.warn('[SerenityWarp] Gameplay FX cleanup failed:', disposeError);
        }
        this.gameplayFx = null;
    }

    setupGpuResilience() {
        if (!this.renderer) return;
        this.setupRendererResilience(this.renderer, {
            webgpuDevice: this.visual?.getDevice?.() || null,
        });

        if (this.isWebGPU) {
            this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
                recover: async () => {
                    if (this.gpuRecoveryAttempted) {
                        throw new Error('WebGPU recovery already attempted');
                    }
                    this.gpuRecoveryAttempted = true;
                    if (this.isActive) await this.createScene();
                },
            });
        }
    }

    animate() {
        if (this.animationLoopStarted || !this.visual) return;
        this.animationLoopStarted = true;
        this.lastFrameTime = null;

        this._animationDriver = this.safeAnimate((frameTime) => {
            const delta = this.lastFrameTime === null
                ? 1 / 60
                : Math.min(Math.max((frameTime - this.lastFrameTime) / 1000, 0), 0.05);
            this.lastFrameTime = frameTime;
            this.elapsedTime += delta;
            this.reactivePulse = Math.max(0, this.reactivePulse - delta * 0.68);
            this.visual?.setAudioPulse?.(this.reactivePulse);
            if (this.reactionDirector) {
                const reaction = this.reactionDirector.update(delta);
                this.visual?.setReactionState?.(reaction);
            }
            this.forwardGameplayCommands();
            try {
                this.gameplayFx?.update?.(this.elapsedTime, delta);
            } catch (error) {
                this.disableGameplayFx('update', error);
            }
            this.visual?.update?.(this.elapsedTime);
        }, { maxConsecutiveErrors: 3 });
        const animationId = requestAnimationFrame(this._animationDriver);
        this.registerAnimation(animationId);
    }

    teardownEventListeners() {
        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.warn('[SerenityWarp] Failed to unsubscribe event:', error);
            }
        });
        this.eventUnsubscribers = [];
    }

    disposeRuntime() {
        this.sceneGeneration += 1;
        this.cancelAnimationFrames();
        this.clearTrackedResources();
        this.teardownEventListeners();
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        this.removeRendererResilience();

        try {
            this.gameplayFxController?.dispose?.();
        } catch (error) {
            console.warn('[SerenityWarp] Gameplay FX controller cleanup failed:', error);
        }
        this.gameplayFxController = null;

        try {
            this.reactionDirector?.dispose?.();
        } catch (error) {
            console.warn('[SerenityWarp] Reaction director cleanup failed:', error);
        }
        this.reactionDirector = null;

        if (this.gameplayFx) {
            try {
                this.gameplayFx.dispose?.();
            } catch (error) {
                console.warn('[SerenityWarp] Gameplay FX cleanup failed:', error);
            }
        }
        this.gameplayFx = null;
        this.reducedMotionQuery = null;

        if (this.visual) {
            try {
                this.visual.destroy?.();
            } catch (error) {
                console.warn('[SerenityWarp] Visual cleanup failed:', error);
            }
        }

        this.canvas?.remove();
        this.overlay?.remove();
        this.visual = null;
        this.canvas = null;
        this.overlay = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.isWebGPU = false;
        this.animationLoopStarted = false;
        this._animationDriver = null;
        this.elapsedTime = 0;
        this.lastFrameTime = null;
        this.reactivePulse = 0;
    }

    async whenCriticalReady() {
        return !!this.visual;
    }

    getTetrominoConfig() {
        return SERENITY_WARP_TETROMINOS;
    }

    stop() {
        super.stop();
        this.disposeRuntime();
    }

    resume() {
        if (!this.visual || !this.renderer || !this.canvas) {
            return false;
        }
        return super.resume();
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
