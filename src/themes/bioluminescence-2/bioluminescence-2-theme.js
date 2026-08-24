/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Bioluminescence II — "Glowing Cavern Reef" — WebGPU/TSL theme wrapper.
 *
 * A from-scratch WebGPU/TSL companion to the original (WebGL) `bioluminescence`
 * theme, which is left untouched. The visual scene is authored + screenshot-
 * verified in the playground (src/playground/effects/bioluminescence-2.effect.js);
 * this thin wrapper gives it a BaseTheme lifecycle, WebGPU→WebGL2 fallback,
 * resize handling, the tetromino palette, and the combo/lock reactive bridge.
 *
 * The effect owns its render() (it runs a PostProcessing bloom pass), so the loop
 * calls runtime.render() rather than renderer.render(). Gameplay events are mapped
 * straight to runtime.pulse(kind); the effect decays its own energy/pulse surges.
 *
 * Mirrors the summer/halcyon-apex WebGPU theme architecture. See
 * artifacts/bioluminescence-2/ART_DIRECTION.md.
 */
import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { create as createBioluminescence2Scene } from '../../playground/effects/bioluminescence-2.effect.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';
import { BIOLUMINESCENCE_2_TETROMINOS } from './bioluminescence-2-tetrominos.js';

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

export default class Bioluminescence2Theme extends BaseTheme {
    constructor() {
        super('bioluminescence-2');

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
            console.error('[Bioluminescence2] Theme container not found');
            return;
        }

        this.disposeRuntime();
        container.innerHTML = '';

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(56, width / height, 0.1, 20000);

        this.runtime = createBioluminescence2Scene({
            THREE,
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            sizes: { width, height },
            params: new URLSearchParams(window.location.search),
        });

        this.setupResize();
        this.setupEventListeners();
        await this.warmPipelines();
        if (ownerGeneration !== this.lifecycleGeneration) return;
        this.startAnimationLoop();

        console.log(`[Bioluminescence2] Scene created (webgpu=${this.isWebGPU})`);
    }

    /**
     * Warm the pipelines before the loop reveals anything.
     *
     * MEASURED 2026-08-24 (docs/THEME_FLEET_SWEEP_2026-08.md Part B): this theme created 174
     * pipelines and warmed NONE of them — 0 async, 174 sync, the LARGEST unwarmed set in the
     * 61-theme fleet — so 3,132 ms of GPU compile landed after the 496 ms switch had already
     * resolved (3,628 ms to first frame). There is no `compileAsync` anywhere in this theme or
     * in the effect it ships as its production scene.
     *
     * `compileGroupThroughPost` is used rather than a bare `renderer.compileAsync(scene, camera)`
     * because a bare call binds no render target, and r185's deferred build loop reads the live
     * `renderer.getMRT()` per object — it would bake shaders under a key the post pass never looks
     * up, which is waste at best and a poisoned cache at worst. The recipe holds the scene-pass
     * target bound across the whole await. It has zero imports and is duck-typed.
     */
    async warmPipelines() {
        if (!this.renderer?.compileAsync || !this.scene || !this.camera) return;
        const postStack = this.runtime?.getPostStack?.() ?? null;
        const scenePass = postStack?.scenePass ?? null;
        try {
            if (scenePass?.renderTarget) {
                // PassNode.setup() has not run yet — it runs on the first postProcessing.render() —
                // so the target still holds RenderTarget defaults while the live pass will take
                // `renderer.samples`. The WebGPU pipeline cache key hashes sample count, so warming
                // against the wrong one produces pipelines that all miss on the first live frame.
                // This is what PassNode.js:765-767 does during setup, and it is exactly the
                // rgba16float|4|depth24plus key every measured sync row carries.
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
                // No post stack (the effect's `?nobloom` path): the scene renders straight to the
                // canvas, so an unbound compile is the correct binding rather than a missing one.
                await this.renderer.compileAsync(this.scene, this.camera);
            }
        } catch (error) {
            console.warn('[Bioluminescence2] Pipeline precompile was incomplete:', error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Combo / lock reactivity. Gameplay events map directly to runtime.pulse(),
    // which boosts the scene's energy/pulse uniforms (decayed in the effect's
    // update()). Gated by the standard backgroundComboEffects setting.
    // ─────────────────────────────────────────────────────────────────────────
    setupEventListeners() {
        if (!this.runtime?.pulse) return;

        const allow = () => this.isActive !== false
            && (typeof window === 'undefined' || window.settings?.backgroundComboEffects !== false);

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, () => { if (allow()) this.runtime.pulse('pieceLock'); }),
            eventBus.on(EVENTS.COMBO, () => { if (allow()) this.runtime.pulse('combo'); }),
            eventBus.on(EVENTS.LINE_CLEAR, () => { if (allow()) this.runtime.pulse('lineClear'); }),
            eventBus.on(EVENTS.TSPIN, () => { if (allow()) this.runtime.pulse('lineClear'); }),
            eventBus.on(EVENTS.PERFECT_CLEAR, () => { if (allow()) this.runtime.pulse('combo'); }),
            eventBus.on(EVENTS.LEVEL_UP, () => { if (allow()) this.runtime.pulse('combo'); }),
        );
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
        const forceWebGL = readBoolParam('forceWebGL', 'bioluminescence2ForceWebGL');
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
                label: `Bioluminescence II ${useWebGLBackend ? 'WebGL2' : 'WebGPU'} renderer init`,
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
                console.warn('[Bioluminescence2] WebGPU init failed, trying WebGL2 backend:', error);
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
                console.error('[Bioluminescence2] Renderer init failed:', error);
                container.innerHTML = '<div style="color:#9fe8ff;text-align:center;padding:2em;'
                    + 'font-family:sans-serif;">Bioluminescence II needs WebGPU or WebGL2.</div>';
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
        renderer.setClearColor(0x050a1a, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = 'bioluminescence-2-renderer';
        renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(renderer.domElement);
        this.registerContainer(container);

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
            // The effect owns its render (it runs a PostProcessing bloom pass).
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
                console.warn('[Bioluminescence2] Runtime dispose failed:', error);
            }
            this.runtime = null;
        }

        if (this.renderer) {
            try {
                this.disposeRenderer(this.renderer, { nullInstance: false });
            } catch (error) {
                console.warn('[Bioluminescence2] Renderer dispose failed:', error);
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
        return BIOLUMINESCENCE_2_TETROMINOS;
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
