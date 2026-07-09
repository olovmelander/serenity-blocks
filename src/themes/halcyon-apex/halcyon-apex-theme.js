/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Halcyon Apex - WebGPU/TSL theme wrapper.
 *
 * The visual scene is authored and screenshot-verified in the playground first;
 * this wrapper gives the same scene a BaseTheme lifecycle, renderer fallback,
 * resize handling, and tetromino palette.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { create as createHalcyonApexScene } from '../../playground/effects/halcyon-apex.effect.js';
import { HALCYON_APEX_TETROMINOS } from './halcyon-apex-tetrominos.js';

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

export default class HalcyonApexTheme extends BaseTheme {
    constructor() {
        super('halcyon-apex');

        this.resourceProfile = 'heavy-gpu';

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.runtime = null;
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
            console.error('[HalcyonApex] Theme container not found');
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

        this.runtime = createHalcyonApexScene({
            THREE,
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            sizes: { width, height },
            params: new URLSearchParams(window.location.search),
        });

        this.setupResize();
        this.setupEventListeners();
        this.startAnimationLoop();

        console.log(`[HalcyonApex] Scene created (webgpu=${this.isWebGPU})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Combo / lock-piece reactivity ("Ley-Light Resonance"). Bridges gameplay
    // events to the scene's runtime.pulse(kind, payload). Gated by the standard
    // backgroundComboEffects setting; intensity scaled for reduced-motion.
    // ─────────────────────────────────────────────────────────────────────────
    setupEventListeners() {
        if (!this.runtime?.pulse) return;

        this.applyIntensity();

        const allow = () => this.isActive !== false
            && this.runtime?.pulse
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);
        // Map a locked piece's board column (0–9) to a causeway shard world-Z.
        const mapLock = (piece) => {
            const col = piece && typeof piece.x === 'number' ? piece.x : 4.5;
            return { col, z: THREE.MathUtils.lerp(120, -120, col / 9) };
        };

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (d) => { if (allow()) this.runtime.pulse('pieceLock', mapLock(d?.piece)); }),
            eventBus.on(EVENTS.COMBO, (d) => { if (allow()) this.runtime.pulse('combo', { count: d?.comboCount ?? d?.combo ?? 0 }); }),
            eventBus.on(EVENTS.LINE_CLEAR, (d) => { if (allow()) this.runtime.pulse('lineClear', { lines: d?.lineCount ?? 0, cascade: d?.cascadeCount ?? 1 }); }),
            eventBus.on(EVENTS.TSPIN, (d) => { if (allow()) this.runtime.pulse('tspin', { lines: d?.lineCount ?? 0 }); }),
            eventBus.on(EVENTS.B2B, (d) => { if (allow()) this.runtime.pulse('b2b', { active: !!d?.active }); }),
            eventBus.on(EVENTS.PERFECT_CLEAR, (d) => { if (allow()) this.runtime.pulse('perfectClear', { depth: d?.depth ?? 1 }); }),
            // HARD_DROP / LEVEL_UP are declared but not emitted today — wired defensively.
            eventBus.on(EVENTS.HARD_DROP, (d) => { if (allow()) this.runtime.pulse('hardDrop', mapLock(d?.piece)); }),
            eventBus.on(EVENTS.LEVEL_UP, () => { if (allow()) this.runtime.pulse('levelUp', {}); }),
        );
    }

    applyIntensity() {
        if (!this.runtime?.setIntensity) return;
        let mult = 1;
        if (typeof window !== 'undefined') {
            if (window.settings?.backgroundComboEffects === false) mult = 0;
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            if (reduce) mult = Math.min(mult, 0.45);
        }
        this.runtime.setIntensity(mult);
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
        const forceWebGL = readBoolParam('forceWebGL', 'halcyonApexForceWebGL');
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
                console.warn('[HalcyonApex] WebGPU init failed, trying WebGL2 backend:', error);
            }
        }

        if (!renderer) {
            try {
                renderer = await makeRenderer(true);
            } catch (error) {
                console.error('[HalcyonApex] Renderer init failed:', error);
                container.innerHTML = '<div style="color:#d7eef0;text-align:center;padding:2em;'
                    + 'font-family:sans-serif;">Halcyon Apex needs WebGPU or WebGL2.</div>';
                return false;
            }
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;

        renderer.setPixelRatio(this.getEffectivePixelRatio(1.5, 'theme'));
        renderer.setSize(width, height);
        renderer.setClearColor(0xf3e2c0, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'halcyon-apex-renderer';
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

            this.runtime?.camera?.(this.time, this.camera);
            this.runtime?.update?.(this.time, delta);
            this.renderer.render(this.scene, this.camera);
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
                console.warn('[HalcyonApex] Runtime dispose failed:', error);
            }
            this.runtime = null;
        }

        if (this.renderer) {
            try {
                this.disposeRenderer(this.renderer, { nullInstance: false });
            } catch (error) {
                console.warn('[HalcyonApex] Renderer dispose failed:', error);
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
        return HALCYON_APEX_TETROMINOS;
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
