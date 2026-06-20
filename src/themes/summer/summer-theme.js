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
    }

    async createScene() {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[Summer] Theme container not found');
            return;
        }

        this.disposeRuntime();
        container.innerHTML = '';

        const rendererReady = await this.initRenderer(container);
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

        const allow = () => this.isActive !== false
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, () => { if (allow()) this.director.onPieceLock(); }),
            eventBus.on(EVENTS.HARD_DROP, () => { if (allow()) this.director.onHardDrop(); }),
            eventBus.on(EVENTS.COMBO, (d) => { if (allow()) this.director.onCombo(d?.comboCount ?? d?.combo ?? 0); }),
            eventBus.on(EVENTS.LINE_CLEAR, (d) => { if (allow()) this.director.onLineClear(d?.lineCount ?? 0, d?.comboCount ?? 0); }),
            eventBus.on(EVENTS.TSPIN, (d) => { if (allow()) this.director.onTSpin(d?.lineCount ?? 0); }),
            eventBus.on(EVENTS.PERFECT_CLEAR, () => { if (allow()) this.director.onPerfectClear(); }),
            eventBus.on(EVENTS.LEVEL_UP, () => { if (allow()) this.director.onLevelUp(); }),
        );
    }

    applyIntensity() {
        let mult = 1;
        if (typeof window !== 'undefined') {
            if (window.settings?.backgroundComboEffects === false) mult = 0;
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            if (reduce) mult = Math.min(mult, 0.45);
        }
        this.director.setIntensity(mult);
    }

    teardownEventListeners() {
        this.eventUnsubscribers.forEach((unsub) => {
            try { unsub?.(); } catch (error) { /* noop */ }
        });
        this.eventUnsubscribers = [];
    }

    async initRenderer(container) {
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
            await Promise.race([
                renderer.init(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('WebGPU init timeout')), 5000);
                }),
            ]);
            return renderer;
        };

        let renderer = null;
        if (wantWebGPU) {
            try {
                renderer = await makeRenderer(false);
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose();
                    renderer = null;
                }
            } catch (error) {
                console.warn('[Summer] WebGPU init failed, trying WebGL2 backend:', error);
            }
        }

        if (!renderer) {
            try {
                renderer = await makeRenderer(true);
            } catch (error) {
                console.error('[Summer] Renderer init failed:', error);
                container.innerHTML = '<div style="color:#3f6b2e;text-align:center;padding:2em;'
                    + 'font-family:sans-serif;">Midsommar needs WebGPU or WebGL2.</div>';
                return false;
            }
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
