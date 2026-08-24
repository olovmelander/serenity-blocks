/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Vesper Chrysalis — WebGPU/TSL theme wrapper.
 *
 * "A hatching at dusk." A dormant crystalline relic-heart on a mirror-still
 * twilight lake that WAKES as you play: one eased escalation scalar S drives the
 * whole world through Dormant → Fracture → Spill → Ascension → Cosmos beats.
 *
 * The scene is authored + screenshot-verified in the playground first
 * (src/playground/effects/vesper-chrysalis.effect.js); this wrapper gives it a
 * BaseTheme lifecycle, WebGPU→WebGL fallback, resize handling, a tetromino
 * palette, and bridges gameplay events to the inline metamorphosis director via
 * runtime.pulse(kind, payload).
 *
 * See docs/VESPER_CHRYSALIS_THEME_MASTERPLAN_2026-07.md.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { create as createVesperScene } from '../../playground/effects/vesper-chrysalis.effect.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';
import { VESPER_CHRYSALIS_TETROMINOS } from './vesper-chrysalis-tetrominos.js';

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

export default class VesperChrysalisTheme extends BaseTheme {
    constructor() {
        super('vesper-chrysalis');

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

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[VesperChrysalis] Theme container not found');
            return;
        }

        this.disposeRuntime();
        container.innerHTML = '';

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 20000);

        this.runtime = createVesperScene({
            THREE,
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            sizes: { width, height },
            params: new URLSearchParams(window.location.search),
        });

        this.setupResize();
        this.setupEventListeners();
        await this.warmRuntime();
        if (ownerGeneration !== this.lifecycleGeneration) return;
        this.startAnimationLoop();

        console.log(`[VesperChrysalis] Scene created (webgpu=${this.isWebGPU})`);
    }

    /**
     * Warm the pipelines before the loop reveals anything.
     *
     * MEASURED 2026-08-24 (docs/THEME_FLEET_SWEEP_2026-08.md Part B): this theme created 103
     * pipelines and warmed NONE of them — 0 async, 103 sync — so 5,760 ms of GPU compile landed
     * after the switch had already resolved, second-worst in the 61-theme fleet.
     *
     * `compileGroupThroughPost` is used rather than a bare `renderer.compileAsync(scene, camera)`
     * because a bare call binds no render target, and r185's deferred build loop reads the live
     * `renderer.getMRT()` per object — it would bake shaders under a key the post pass never looks
     * up, which is waste at best and a poisoned cache at worst. The recipe holds the scene-pass
     * target bound across the whole await. It has zero imports and is duck-typed.
     */
    async warmRuntime() {
        const postStack = this.runtime?.getPostStack?.() ?? null;
        const scenePass = postStack?.scenePass ?? null;
        if (!this.renderer?.compileAsync || !this.scene || !this.camera) return;
        try {
            if (scenePass?.renderTarget) {
                // PassNode.setup() has not run yet — it runs on the first postProcessing.render() —
                // so the target still holds RenderTarget defaults while the live pass will take
                // `renderer.samples`. The WebGPU pipeline cache key hashes sample count, so warming
                // against the wrong one produces pipelines that all miss on the first live frame.
                // This is what PassNode.js:765-767 does during setup.
                scenePass.renderTarget.samples = this.renderer.samples;
                scenePass.renderTarget.texture.type = this.renderer.getOutputBufferType();
                await compileGroupThroughPost(
                    this.renderer,
                    postStack,
                    this.scene,
                    this.camera,
                    this.scene,
                    false,
                );
            } else {
                // No post stack: the theme renders straight to the canvas, so an unbound compile is
                // the correct binding rather than a missing one.
                await this.renderer.compileAsync(this.scene, this.camera);
            }
        } catch (error) {
            console.warn('[VesperChrysalis] Pipeline precompile was incomplete:', error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gameplay → metamorphosis-director bridge. Feeds runtime.pulse(kind,payload)
    // so play escalates the world. Gated by the standard backgroundComboEffects
    // setting; intensity scaled down for reduced-motion.
    // ─────────────────────────────────────────────────────────────────────────
    setupEventListeners() {
        if (!this.runtime?.pulse) return;

        this.applyIntensity();

        const allow = () => this.isActive !== false
            && this.runtime?.pulse
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (d) => { if (allow()) this.runtime.pulse('pieceLock', { piece: d?.piece }); }),
            eventBus.on(EVENTS.COMBO, (d) => { if (allow()) this.runtime.pulse('combo', { count: d?.comboCount ?? d?.combo ?? 0, player: d?.player ?? d?.playerId ?? d?.pid }); }),
            eventBus.on(EVENTS.LINE_CLEAR, (d) => { if (allow()) this.runtime.pulse('lineClear', { lines: d?.lineCount ?? 0, cascade: d?.cascadeCount ?? 1 }); }),
            eventBus.on(EVENTS.TSPIN, (d) => { if (allow()) this.runtime.pulse('tspin', { lines: d?.lineCount ?? 0 }); }),
            eventBus.on(EVENTS.B2B, (d) => { if (allow()) this.runtime.pulse('b2b', { active: !!d?.active }); }),
            eventBus.on(EVENTS.PERFECT_CLEAR, (d) => { if (allow()) this.runtime.pulse('perfectClear', { depth: d?.depth ?? 1 }); }),
            eventBus.on(EVENTS.HARD_DROP, (d) => { if (allow()) this.runtime.pulse('hardDrop', { piece: d?.piece }); }),
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

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const antialias = this.getAntialiasEnabled();
        const forceWebGL = readBoolParam('forceWebGL', 'vesperChrysalisForceWebGL');
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
                label: `Vesper Chrysalis ${useWebGLBackend ? 'WebGL2' : 'WebGPU'} renderer init`,
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
                console.warn('[VesperChrysalis] WebGPU init failed, trying WebGL2 backend:', error);
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
                console.error('[VesperChrysalis] Renderer init failed:', error);
                container.innerHTML = '<div style="color:#d9c8ff;text-align:center;padding:2em;'
                    + 'font-family:sans-serif;">Vesper Chrysalis needs WebGPU or WebGL2.</div>';
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
        renderer.setClearColor(0x0a0716, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'vesper-chrysalis-renderer';
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
            // The effect owns render() so the scene goes through its post pipeline
            // (bloom + violet-ember grade + grain); fall back to a direct render.
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
            try { this.runtime.dispose?.(); } catch (error) { console.warn('[VesperChrysalis] Runtime dispose failed:', error); }
            this.runtime = null;
        }

        if (this.renderer) {
            try { this.disposeRenderer(this.renderer, { nullInstance: false }); } catch (error) { console.warn('[VesperChrysalis] Renderer dispose failed:', error); }
            this.renderer = null;
        }

        this.removeRendererResilience();
        this.scene = null;
        this.camera = null;
        this.animationLoopStarted = false;
        this.time = 0;
    }

    getTetrominoConfig() {
        return VESPER_CHRYSALIS_TETROMINOS;
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
