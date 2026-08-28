/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Summer — "Midsommar Solstice" — WebGPU/TSL theme wrapper.
 *
 * A from-scratch rebuild of the old WebGL summer theme (which rendered 250k×48-tri
 * grass blades). The visual scene is authored + screenshot-verified in the
 * playground (src/playground/effects/summer-meadow.effect.js); this wrapper gives
 * it a BaseTheme lifecycle, WebGPU→WebGL2 fallback, resize, the tetromino palette,
 * and the SeasonDirector → reactive-uniform bridge for combo/lock effects.
 *
 * See docs/SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { create as createSummerMeadowScene } from '../../playground/effects/summer-meadow.effect.js';
import { SUMMER_TETROMINOS } from './summer-tetrominos.js';
import { SeasonDirector } from './composition/season-director.js';

function readBoolParam(...keys) {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        if (value === null || value === '') return true;
        return ['1', 'true', 'yes'].includes(value.toLowerCase());
    });
}

export default class SummerTheme extends BaseTheme {
    constructor() {
        super('summer');

        this.resourceProfile = 'heavy-gpu';

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.runtime = null;
        this.director = new SeasonDirector();
        this.clock = new THREE.Clock();
        this.time = 0;
        this.isWebGPU = false;
        this.animationLoopStarted = false;
        this.boundResize = null;
        this.eventUnsubscribers = [];
        this.reducedMotionQuery = null;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[Summer] Theme container not found');
            return;
        }

        this.disposeRuntime();
        container.innerHTML = '';

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 20000);

        this.runtime = createSummerMeadowScene({
            THREE,
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            sizes: { width, height },
            params: new URLSearchParams(window.location.search),
        });

        this.director.reset();
        this.setupResize();
        this.setupEventListeners();
        this.startAnimationLoop();

        console.log(`[Summer] Scene created (webgpu=${this.isWebGPU})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Combo / lock reactivity. Gameplay events poke the SeasonDirector; its eased
    // state is pushed into the effect's reactive uniforms each frame. Gated by the
    // standard backgroundComboEffects setting; intensity scaled for reduced-motion.
    // ─────────────────────────────────────────────────────────────────────────
    setupEventListeners() {
        this.applyIntensity();

        // Ambient atmosphere (director) is gated by backgroundComboEffects. The
        // discrete "Midsummer Promise" FX (dew seal + ring dance) are additionally
        // gated per the plan: lock needs pieceLockRipple too; combo needs only
        // backgroundComboEffects. LINE_CLEAR is forwarded for order-independent
        // combo correlation but emits no discrete particle of its own.
        const allowAmbient = () => this.isActive !== false
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);
        const allowCombo = () => allowAmbient();
        const allowLock = () => allowCombo()
            && (typeof window === 'undefined' || window.settings?.pieceLockRipple !== false);

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (d) => {
                if (allowLock()) this.runtime?.pulse?.('PIECE_LOCK', d);
                if (allowAmbient()) this.director.onPieceLock();
            }),
            eventBus.on(EVENTS.HARD_DROP, () => { if (allowAmbient()) this.director.onHardDrop(); }),
            eventBus.on(EVENTS.COMBO, (d) => {
                if (allowCombo()) this.runtime?.pulse?.('COMBO', d);
                if (allowAmbient()) this.director.onCombo(d?.comboCount ?? d?.combo ?? 0);
            }),
            eventBus.on(EVENTS.LINE_CLEAR, (d) => {
                if (allowCombo()) this.runtime?.pulse?.('LINE_CLEAR', d);
                if (allowAmbient()) this.director.onLineClear(d?.lineCount ?? 0, d?.comboCount ?? 0);
            }),
            eventBus.on(EVENTS.TSPIN, (d) => { if (allowAmbient()) this.director.onTSpin(d?.lineCount ?? 0); }),
            eventBus.on(EVENTS.PERFECT_CLEAR, () => { if (allowAmbient()) this.director.onPerfectClear(); }),
            eventBus.on(EVENTS.LEVEL_UP, () => { if (allowAmbient()) this.director.onLevelUp(); }),
        );

        // Re-apply the discrete FX quality / reduced-motion when the OS media query
        // flips; setup-time intensity alone is insufficient (plan §7.6).
        if (typeof window !== 'undefined' && window.matchMedia) {
            this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            const onReduce = () => this.applyIntensity();
            if (this.reducedMotionQuery.addEventListener) {
                this.registerEventListener(this.reducedMotionQuery, 'change', onReduce);
            }
        }
    }

    resolveEffectQuality() {
        if (typeof window === 'undefined') return 'High';
        return window.settings?.effectQuality || window.settings?.graphicsQuality || 'High';
    }

    prefersReducedMotion() {
        if (typeof window === 'undefined') return false;
        return window.settings?.reducedMotion === true
            || this.reducedMotionQuery?.matches === true
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    }

    applyIntensity() {
        const comboEnabled = typeof window === 'undefined'
            || window.settings?.backgroundComboEffects !== false;
        const reduce = this.prefersReducedMotion();

        // Ambient director: soft multiplier (0 when disabled, damped for reduced motion).
        let mult = comboEnabled ? 1 : 0;
        if (reduce) mult = Math.min(mult, 0.45);
        this.director.setIntensity(mult);

        // Discrete FX: designed reduced-motion form (not just lower opacity), and a
        // hard 0 intensity when combo effects are disabled.
        this.runtime?.configureGameplay?.({
            quality: this.resolveEffectQuality(),
            reducedMotion: reduce,
            intensity: comboEnabled ? 1 : 0,
        });
    }

    teardownEventListeners() {
        this.eventUnsubscribers.forEach((unsub) => {
            try { unsub?.(); } catch (error) { /* noop */ }
        });
        this.eventUnsubscribers = [];
    }

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const antialias = this.getAntialiasEnabled();
        const forceWebGL = readBoolParam('forceWebGL', 'summerForceWebGL');
        const wantWebGPU = !forceWebGL && typeof navigator !== 'undefined' && !!navigator.gpu;

        const makeRenderer = async (useWebGLBackend) => {
            const renderer = new THREE.WebGPURenderer({
                antialias,
                alpha: false,
                forceWebGL: useWebGLBackend,
                powerPreference: 'high-performance',
            });
            await this.initializeRendererCandidate(renderer, {
                timeoutMs: 5000,
                label: `Summer ${useWebGLBackend ? 'WebGL2' : 'WebGPU'} renderer init`,
                ownerGeneration,
            });
            return renderer;
        };

        let renderer = null;
        if (wantWebGPU) {
            try {
                renderer = await makeRenderer(false);
                if (renderer.backend?.isWebGPUBackend !== true) {
                    this.disposeRenderer(renderer, { nullInstance: false });
                    renderer = null;
                }
            } catch (error) {
                if (ownerGeneration !== this.lifecycleGeneration
                    || !this.isActive
                    || this.cleanupComplete) return false;
                console.warn('[Summer] WebGPU init failed, trying WebGL2 backend:', error);
            }
        }

        if (!renderer) {
            if (ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) return false;
            try {
                renderer = await makeRenderer(true);
            } catch (error) {
                if (ownerGeneration !== this.lifecycleGeneration
                    || !this.isActive
                    || this.cleanupComplete) return false;
                console.error('[Summer] Renderer init failed:', error);
                container.innerHTML = '<div style="color:#3f6b2e;text-align:center;padding:2em;'
                    + 'font-family:sans-serif;">Midsommar needs WebGPU or WebGL2.</div>';
                return false;
            }
        }

        if (ownerGeneration !== this.lifecycleGeneration
            || !this.isActive
            || this.cleanupComplete) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;

        renderer.setPixelRatio(this.getEffectivePixelRatio(1.5, 'theme'));
        renderer.setSize(width, height);
        renderer.setClearColor(0xbcd2dc, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'summer-renderer';
        renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(renderer.domElement);

        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
        });

        return true;
    }

    setupResize() {
        this.boundResize = () => this.resize(window.innerWidth, window.innerHeight);
        this.registerEventListener(window, 'resize', this.boundResize);
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(1.5, 'theme'));
        this.renderer.setSize(width, height);
        this.runtime?.resize?.(width, height);
    }

    startAnimationLoop() {
        if (this.animationLoopStarted) return;

        this.animationLoopStarted = true;
        this.clock.start();
        this.clock.getDelta();

        const animate = this.safeAnimate(() => {
            const rawDelta = this.clock.getDelta();
            const delta = Number.isFinite(rawDelta) ? Math.min(rawDelta, 0.05) : 0.016;
            this.time += delta;

            this.director.update(delta);
            this.runtime?.setReactive?.(this.director.getState());
            this.runtime?.camera?.(this.time, this.camera);
            this.runtime?.update?.(this.time, delta);
            // The effect owns its render when it has a post-processing (bloom) pass.
            if (this.runtime?.render) this.runtime.render();
            else this.renderer.render(this.scene, this.camera);
        }, { maxConsecutiveErrors: 3 });

        animate();
    }

    disposeRuntime() {
        this.animationIds.forEach((id) => cancelAnimationFrame(id));
        this.animationIds = [];
        this.clearTrackedResources();
        this.teardownEventListeners();

        if (this.runtime) {
            try {
                this.runtime.dispose?.();
            } catch (error) {
                console.warn('[Summer] Runtime dispose failed:', error);
            }
            this.runtime = null;
        }

        if (this.renderer) {
            try {
                this.disposeRenderer(this.renderer, { nullInstance: false });
            } catch (error) {
                console.warn('[Summer] Renderer dispose failed:', error);
            }
            this.renderer = null;
        }

        this.removeRendererResilience();
        this.scene = null;
        this.camera = null;
        this.animationLoopStarted = false;
        this.time = 0;
    }

    getTetrominoConfig() {
        return SUMMER_TETROMINOS;
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
