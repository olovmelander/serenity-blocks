/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams V3 — Theme Orchestrator
 *
 * Thin orchestrator. Does NOT contain visual logic — it composes the
 * subsystems (camera, nebula, fluid, GI, post) into a frame loop.
 *
 * Phase 0/1 scope (current):
 *   - Volumetric nebula sky (procedural, no fluid yet)
 *   - Cinematic camera director (figure-8 dolly)
 *   - Modern post stack (MRT bloom + ACES + grade)
 *   - Event subscriptions wired (idle responses only)
 *
 * NOT implemented yet (V3 phases 2-10):
 *   - MLS-MPM fluid simulation
 *   - Radiance Cascades GI
 *   - TAAU temporal upscaling
 *   - Motion blur, DOF
 *   - Bokeh particles, foreground embers
 *
 * Design principle: each frame, this file does as little as possible.
 * Heavy work lives in subsystems; the orchestrator just calls update()
 * on each in the right order.
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CameraDirector } from './composition/camera-director.js';
import { createNebulaSky } from './rendering/nebula-volume.js';
import { createFluidParticlesRenderer } from './rendering/fluid-particles-renderer.js';
import { V3PostPipeline, getV3PostProfile } from './post/render-pipeline.js';
import { FluidParticleSim, getFluidBudget } from './sim/fluid-particles.js';
import { FluidEmitters } from './sim/fluid-emitters.js';
import { SHAPE_NAMES } from './sim/shape-formations.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';

// ─── Master shape pool (single, randomized) ───
// All visual shapes go here. Every game event rolls from this same pool — the
// event's role is to control STRENGTH and DURATION, not which shape appears.
// 'free' is excluded (it's the no-attraction state, not a shape).
// 'heart' is excluded from the random pool because it's reserved for game over
// as a deliberate emotional anchor (always heart on game over, never random).
const RANDOM_SHAPE_POOL = Object.freeze([
    'sphere', 'torus', 'helix', 'galaxy', 'cube', 'star', 'wave', 'butterfly',
    'ring', 'tetromino', 'tetrominoSet', 'pyramid', 'octahedron', 'hexagon',
    'sunflower', 'infinity', 'trefoil', 'vortex', 'wavySphere', 'lightning',
    'snowflake', 'lotus', 'crescent', 'crystalShard', 'mobius', 'comet', 'nautilus',
]);

const QUALITY_PRESETS = Object.freeze({
    Minimal: {
        enablePost: false, useMRT: false, enableFluid: true, fluidSizeMul: 1.2,
    },
    Low: {
        enablePost: true, useMRT: false, enableFluid: true, fluidSizeMul: 1.1,
    },
    Medium: {
        enablePost: true, useMRT: true, enableFluid: true, fluidSizeMul: 1.0,
    },
    High: {
        enablePost: true, useMRT: true, enableFluid: true, fluidSizeMul: 1.0,
    },
    Ultra: {
        enablePost: true, useMRT: true, enableFluid: true, fluidSizeMul: 0.95,
    },
    Extreme: {
        enablePost: true, useMRT: true, enableFluid: true, fluidSizeMul: 0.9,
    },
});

function normalizeQuality(name) {
    if (typeof name !== 'string') return 'High';
    return QUALITY_PRESETS[name] ? name : 'High';
}

export default class ElectricDreamsV3Theme extends BaseTheme {
    constructor() {
        super('electric-dreams-v3');

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Subsystems
        this.cameraDirector = null;
        this.nebula = null;
        this.postPipeline = null;
        this.fluidSim = null;
        this.fluidRenderer = null;
        this.fluidEmitters = null;
        this._computeAvailable = false;
        this._computeFailedOnce = false;

        // Quality
        this.qualityName = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.postProfile = getV3PostProfile('High');

        // Animation state
        this.time = 0;
        this.frameCount = 0;
        this.animationLoopStarted = false;

        // Event subscription handles (for cleanup)
        this.eventUnsubscribers = [];
        this.boundResize = null;

        // FX state — minimal Phase 1 version (will expand as conductors come online)
        this.fxState = {
            stageHeat: 0,
            comboIntensity: 0,
            comboPulse: 0,
            rewardPulse: 0,
            actProgress: 0,
            // Percussive punches — bumped by events, decayed per-frame in animate.
            // These drive transient post effects (chromatic, bloom, vignette)
            // without requiring per-event setTimeout cleanup.
            chromaPunch: 0,
            bloomPunch: 0,
            vignettePunch: 0,
        };

        // Memory of last-picked shape — anti-repeat across the unified pool.
        // Prevents the same shape from appearing twice in a row regardless
        // of which event triggered it.
        this._lastShapePick = null;

        // Reused dynamic-params payload — avoid per-frame allocation
        this._dynPostParams = {
            time: 0,
            bloomBoost: 0,
            baseBloom: 0,
            chromaticBoost: 0,
            baseChromatic: 0,
            vignetteBoost: 0,
            baseVignette: 0,
            exposureDip: 0,
            baseExposure: 0,
        };
    }

    async init() {
        this.qualityName = this._getQualityFromSettings();
        this.qualityPreset = QUALITY_PRESETS[this.qualityName];
        this.postProfile = getV3PostProfile(this.qualityName);
    }

    _getQualityFromSettings() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[ElectricDreamsV3] Container not found');
            return;
        }

        const w = window.innerWidth;
        const h = window.innerHeight;

        // ── Renderer (WebGPU only; theme is best-in-class WebGPU showcase) ──
        if (!navigator.gpu) {
            console.warn('[ElectricDreamsV3] No WebGPU support — showing fallback message');
            container.innerHTML = '<div style="color:#aaa;text-align:center;padding:2em;font-family:sans-serif;">'
                + 'Electric Dreams V3 requires WebGPU. Try Chrome 113+ or Safari 26+.</div>';
            return;
        }
        const renderer = new THREE.WebGPURenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
        });
        try {
            await this.initializeRendererCandidate(renderer, {
                timeoutMs: 4000,
                label: 'Electric Dreams V3 WebGPU renderer init',
                ownerGeneration,
            });
            if (renderer.backend?.isWebGPUBackend !== true) {
                throw new Error('WebGPU backend not active after init');
            }
        } catch (err) {
            if (ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) return;
            console.error('[ElectricDreamsV3] WebGPU init failed:', err);
            this.disposeRenderer(renderer, { nullInstance: false });
            container.innerHTML = '<div style="color:#aaa;text-align:center;padding:2em;font-family:sans-serif;">'
                + `WebGPU initialization failed: ${err.message}</div>`;
            return;
        }

        if (ownerGeneration !== this.lifecycleGeneration
            || !this.isActive
            || this.cleanupComplete) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        this.renderer = renderer;

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        // ── Scene + camera ──
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x05040f, 0.012);
        this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 400);
        this.camera.position.set(0, 0.6, 12);
        this.camera.lookAt(0, 0, 0);

        // ── Subsystems ──
        this.cameraDirector = new CameraDirector(this.camera, new THREE.Vector3(0, 0, 0));
        this.cameraDirector.snapToRest(); // Skip initial spring-in animation

        this.nebula = createNebulaSky();
        this.scene.add(this.nebula.mesh);

        // ── Fluid hero (the centerpiece) ──
        // Compute capability check: if renderer lacks .compute(), skip the
        // fluid entirely (Minimal/Low mobile fallback will look like just
        // nebula, which is still a valid theme just less spectacular).
        this._computeAvailable = typeof this.renderer.compute === 'function';
        if (this.qualityPreset.enableFluid && this._computeAvailable) {
            try {
                const budget = getFluidBudget(this.qualityName);
                // Focal slightly behind the screen plane so the fluid wraps
                // around the board area in depth as well as in 2D layout.
                const focal = new THREE.Vector3(0, 0, -1.5);
                // Anisotropy (0.32, 1.0, 0.7): pull on X is only 32% of pull
                // on Y → the mass spreads ~3× wider horizontally than vertically.
                // Z is 0.7 so there's some depth volume too (not paper-thin).
                // Result: a wide horizontal sweep that fills the empty corners
                // beside the game board, like aurora wings.
                this.fluidSim = new FluidParticleSim(budget.count, {
                    focalPoint: focal,
                    focalRadius: budget.focalRadius,
                    gravityStrength: budget.gravityStrength,
                    gravityAnisotropy: new THREE.Vector3(0.32, 1.0, 0.7),
                    turbulence: 0.6,
                    // Bounds bumped to match the wider equilibrium. If a particle
                    // drifts past these limits it gets respawned at focal — too
                    // tight = visible "wall" of dying particles, too loose = wasted.
                    boundsWidth: 28,
                    boundsHeight: 14,
                    boundsDepth: 18,
                });
                this.fluidSim.createComputeNode();

                this.fluidRenderer = createFluidParticlesRenderer(this.fluidSim, {
                    sizeMul: this.qualityPreset.fluidSizeMul,
                    emissiveMul: 1.4,
                });
                this.scene.add(this.fluidRenderer.mesh);

                this.fluidEmitters = new FluidEmitters(this.fluidSim, focal);
                this.fluidEmitters.attach();

                console.log(`[ElectricDreamsV3] Fluid sim active (${budget.count} particles, board-halo on)`);
            } catch (err) {
                console.warn('[ElectricDreamsV3] Fluid sim setup failed:', err);
                this._teardownFluid();
            }
        }

        // Post pipeline (optional based on preset).
        if (this.qualityPreset.enablePost) {
            this.postPipeline = new V3PostPipeline(this.renderer, this.scene, this.camera, {
                ...this.postProfile,
                useMRT: this.qualityPreset.useMRT,
            });
            this.postPipeline.setProfile(this.postProfile);
            if (!this.postPipeline.isEnabled()) {
                // Post setup failed silently — defensive null-out.
                this.postPipeline = null;
            }
        }

        // ── Board zone wiring (both fluid + post halo). Called AFTER both are
        // constructed so a single call configures everything that depends on
        // the board screen rect.
        this._updateBoardZone();

        // Debug helper: window.electricDreamsV3.shape("torus") from console
        if (this.fluidSim) this._installDebugHelper();

        // ── Events ──
        this._setupEventListeners();
        this._setupResize();

        // ── Start animation ──

        // Batch-B warm (2026-08-26, sweep §36): zero async pipelines existed — the whole compile
        // paid synchronously at first draw. Post is created just above and the loop starts just
        // below, so this is the plain bound warm (ice-temple §24): pin samples/type
        // (PassNode.setup() has not run; the pipeline cache key hashes sample count), bind the
        // scene pass's target and MRT across the fan-out at concurrency 6.
        if (this.renderer?.compileAsync) {
            try {
                const postStack = this.postPipeline ?? null;
                if (postStack?.scenePass?.renderTarget) {
                    postStack.scenePass.renderTarget.samples = this.renderer.samples;
                    postStack.scenePass.renderTarget.texture.type = this.renderer.getOutputBufferType();
                    await compileGroupThroughPost(
                        this.renderer,
                        postStack,
                        this.scene,
                        this.camera,
                        this.scene,
                        false,
                    );
                }
            } catch (error) {
                console.warn('[ElectricDreamsV3] Pipeline precompile was incomplete:', error);
            }
        }

        this._startAnimation();

        console.log(`[ElectricDreamsV3] Scene created (quality=${this.qualityName}, post=${!!this.postPipeline})`);
    }

    _setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => this._onLineClear(data));
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => this._onCombo(data));
        const hardDropUnsub = eventBus.on(EVENTS.HARD_DROP, (data) => this._onHardDrop(data));
        // Lock = the percussive "tap" on every piece placement. Subtle + frequent.
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => this._onPieceLock());
        // GAME_OVER → heart formation, no auto-release (stays until next game starts).
        const gameOverUnsub = eventBus.on(EVENTS.GAME_OVER, () => this._onGameOver());
        // GAME_START → release any held shape (heart from previous game over).
        const gameStartUnsub = eventBus.on(EVENTS.GAME_START, () => this._fadeReleaseShape());
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, hardDropUnsub, pieceLockUnsub);
        this.eventUnsubscribers.push(gameOverUnsub, gameStartUnsub);

        // Pointer → camera director. Converts clientX/Y to NDC ([-1, 1])
        // and pushes to the director, which smooths and applies as orbital
        // parallax around the fluid hero.
        // Stored on `this` so stop() can remove it cleanly without listener leaks.
        this._onPointerMove = (e) => {
            if (!this.cameraDirector) return;
            const nx = (e.clientX / window.innerWidth) * 2 - 1;
            const ny = (e.clientY / window.innerHeight) * 2 - 1;
            this.cameraDirector.setPointer(nx, ny);
        };
        window.addEventListener('pointermove', this._onPointerMove, { passive: true });
        this.eventUnsubscribers.push(() => {
            window.removeEventListener('pointermove', this._onPointerMove);
        });
    }

    _setupResize() {
        this.boundResize = () => this.resize(window.innerWidth, window.innerHeight);
        this.registerEventListener(window, 'resize', this.boundResize);
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        // Re-project the board zone — wider aspects shrink the board's
        // world-space half-extents at the focal plane, narrower stretch them.
        this._updateBoardZone();
    }

    // ── Event handlers (Phase 1 minimal — just nudge fxState) ──
    _onLineClear(data = {}) {
        const lineCount = Math.max(1, data?.lineCount || 1);
        this.fxState.comboPulse = Math.min(1.0, this.fxState.comboPulse + lineCount * 0.12);
        if (lineCount >= 4) {
            this.cameraDirector?.dolly(0.18);
            // Tetris — random shape from the unified pool, held 4.5s crisp.
            // Event controls strength/duration; the shape itself is fully random.
            const shape = this._pickRandomShape();
            if (shape) this._triggerShape(shape, {}, 0.7, 4500);
        } else if (lineCount === 3) {
            // Triple — random shape, gentler strength + shorter duration.
            const shape = this._pickRandomShape();
            if (shape) this._triggerShape(shape, {}, 0.5, 2800);
        }
    }

    _onCombo(data = {}) {
        const c = Math.max(1, data?.comboCount || 1);
        this.fxState.comboIntensity = Math.min(1.1, Math.max(this.fxState.comboIntensity, 0.2 + c * 0.08));
        this.fxState.rewardPulse = Math.min(1.0, this.fxState.rewardPulse + 0.15 + c * 0.05);
        if (c >= 7) {
            this.cameraDirector?.vertigo(0.8);
            // Big combo — random shape, strongest pull + longest hold (5s).
            const shape = this._pickRandomShape();
            if (shape) this._triggerShape(shape, {}, 0.85, 5000);
        } else if (c >= 4) {
            this.cameraDirector?.dolly(0.12);
            // Mid-combo — random shape, medium strength + duration.
            const shape = this._pickRandomShape();
            if (shape) this._triggerShape(shape, {}, 0.55, 2800);
        }
    }

    _onHardDrop() {
        // Hard drops carry significant momentum — heavier than a soft lock.
        this.cameraDirector?.dolly(0.08);
        this.cameraDirector?.shake(0.14, 200);
        this.cameraDirector?.fovPunch(-2.2);
        this.fxState.chromaPunch = Math.max(this.fxState.chromaPunch, 0.012);
        this.fxState.bloomPunch = Math.max(this.fxState.bloomPunch, 0.18);
        this.fxState.vignettePunch = Math.max(this.fxState.vignettePunch, 0.10);
    }

    /**
     * PIECE_LOCK — the rhythmic "tap" on every piece placement. Five layers:
     *   1. Camera micro-shake (0.06u, 160ms) — tactile vibration
     *   2. FOV punch (-1.4°) — camera momentarily zooms in, "absorbs" impact
     *   3. Chromatic punch (0.008) — visible RGB-split kick at screen edges
     *   4. Bloom flash (0.10) — brief glow pulse from the fluid
     *   5. Vignette pulse (0.06) — screen edges darken slightly, like a thud
     *   PLUS a radial fluid ripple from FluidEmitters at strength 3.0.
     * Total visual signature ~180ms — over before the next piece spawns.
     */
    _onPieceLock() {
        this.cameraDirector?.shake(0.06, 160);
        this.cameraDirector?.fovPunch(-1.4);
        // All three punches are additive on top of profile baseline; bumped here
        // and decayed per-frame in animate() with half-life ~70-100ms.
        this.fxState.chromaPunch = Math.max(this.fxState.chromaPunch, 0.008);
        this.fxState.bloomPunch = Math.max(this.fxState.bloomPunch, 0.10);
        this.fxState.vignettePunch = Math.max(this.fxState.vignettePunch, 0.06);
    }

    _onGameOver() {
        // Heart formation, held indefinitely (autoReleaseMs=0 → no fade).
        // Released on the next GAME_START event.
        // scale=0.65 → ~21u wide heart (fills most of horizontal frame).
        this.cameraDirector?.pullBack(0.6);
        this._triggerShape('heart', { scale: 0.65, depth: 1.8 }, 0.75, 0);
    }

    /**
     * Public API: switch the fluid to a named formation.
     * If autoReleaseMs > 0, fades strength back to 0 after that delay.
     *
     * @param {string} name     - registered shape name (see shape-formations.js)
     * @param {object} opts     - shape options (see shape-formations.js)
     * @param {number} strength - attraction strength 0..1.5 (default 0.6)
     * @param {number} autoReleaseMs - if > 0, fade out after this many ms
     */
    setShape(name, opts = {}, strength = 0.6, autoReleaseMs = 0) {
        if (!this.fluidSim) return false;
        const ok = this.fluidSim.setShape(name, opts);
        if (!ok) return false;
        this.fluidSim.setShapeStrength(strength);
        this._cancelShapeRelease();
        if (autoReleaseMs > 0) {
            this._shapeReleaseTimer = setTimeout(() => {
                this._fadeReleaseShape();
            }, autoReleaseMs);
        }
        return true;
    }

    setShapeStrength(s) {
        this.fluidSim?.setShapeStrength(s);
    }

    /** Internal: fade strength to 0 over ~1.2s, then snap to 'free'. */
    _fadeReleaseShape() {
        if (!this.fluidSim) return;
        const startStrength = this.fluidSim.uShapeStrength?.value ?? 0;
        if (startStrength <= 0) return;
        // Slower than before (was 800ms). With shapes now visible longer,
        // a slightly slower fade feels less abrupt — the formation gently
        // dissolves back to fluid instead of snapping away.
        const fadeMs = 1200;
        const startTime = performance.now();
        const tick = () => {
            if (!this.fluidSim) return;
            const elapsed = performance.now() - startTime;
            const t = Math.min(1, elapsed / fadeMs);
            this.fluidSim.setShapeStrength(startStrength * (1 - t));
            if (t < 1 && this.isActive) {
                this._shapeFadeRaf = requestAnimationFrame(tick);
            } else if (this.isActive) {
                this.fluidSim.setShape('free');
            }
        };
        this._shapeFadeRaf = requestAnimationFrame(tick);
    }

    _cancelShapeRelease() {
        if (this._shapeReleaseTimer) {
            clearTimeout(this._shapeReleaseTimer);
            this._shapeReleaseTimer = null;
        }
        if (this._shapeFadeRaf) {
            cancelAnimationFrame(this._shapeFadeRaf);
            this._shapeFadeRaf = null;
        }
    }

    /** Internal alias used by event handlers — same as setShape but tagged. */
    _triggerShape(name, opts, strength, autoReleaseMs) {
        return this.setShape(name, opts, strength, autoReleaseMs);
    }

    /**
     * Pick a random shape from the unified RANDOM_SHAPE_POOL, with anti-repeat:
     * if the rolled shape matches the last pick, re-roll from the remaining
     * shapes. Guarantees no immediate repeats without forcing a strict rotation.
     *
     * @returns {string|null}  - shape name, or null if pool somehow empty
     */
    _pickRandomShape() {
        const pool = RANDOM_SHAPE_POOL;
        if (!pool || pool.length === 0) return null;
        if (pool.length === 1) return pool[0];

        let pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick === this._lastShapePick) {
            const remaining = pool.filter((s) => s !== this._lastShapePick);
            pick = remaining[Math.floor(Math.random() * remaining.length)];
        }
        this._lastShapePick = pick;
        return pick;
    }

    /**
     * Install a window.electricDreamsV3 debug helper. Lets you experiment with
     * shapes from the browser console:
     *   window.electricDreamsV3.shape('torus')
     *   window.electricDreamsV3.shape('helix', 0.8)
     *   window.electricDreamsV3.list()
     *   window.electricDreamsV3.release()
     */
    _installDebugHelper() {
        if (typeof window === 'undefined') return;
        window.electricDreamsV3 = {
            shape: (name, strength = 0.6, opts = {}) => this.setShape(name, opts, strength, 0),
            release: () => this._fadeReleaseShape(),
            strength: (s) => this.setShapeStrength(s),
            list: () => SHAPE_NAMES,
            current: () => this.fluidSim?.currentShape || 'free',
            // Inspect the unified random pool.
            pool: () => RANDOM_SHAPE_POOL.slice(),
            // Simulate a random event: roll a shape from the unified pool.
            // Optional strength override (default 0.6).
            roll: (strength = 0.6) => {
                const pick = this._pickRandomShape();
                if (pick) this.setShape(pick, {}, strength, 0);
                return pick;
            },
        };
        console.log(
            '[ElectricDreamsV3] Shape API ready:\n'
            + `  shape(name, strength)  — set a specific shape (${SHAPE_NAMES.length} available)\n`
            + `  roll(strength)         — random pick from the unified pool (${RANDOM_SHAPE_POOL.length} shapes)\n`
            + '  release()              — fade back to free fluid\n'
            + '  pool()                 — inspect the random pool\n'
            + `Shapes: ${SHAPE_NAMES.join(', ')}`,
        );
    }

    _uninstallDebugHelper() {
        if (typeof window !== 'undefined' && window.electricDreamsV3) {
            delete window.electricDreamsV3;
        }
    }

    /**
     * Compute the board's screen rectangle and push it to BOTH the fluid sim
     * (world-space repulsion zone) and the post pipeline (UV-space halo glow).
     * Called at scene setup AND on resize.
     *
     * Strategy: detect the board DOM element if present and project its
     * bounding-rect into world + UV space. Falls back to viewport-relative
     * defaults if the element isn't found (theme can be selected from the
     * picker before a game starts).
     */
    _updateBoardZone() {
        if (!this._scratchVec3A) {
            this._scratchVec3A = new THREE.Vector3();
            this._scratchVec3B = new THREE.Vector3();
            this._scratchVec2A = new THREE.Vector2();
            this._scratchVec2B = new THREE.Vector2();
        }

        // ── Detect board screen rect ──
        // Look for the actual board mount points; fall back to viewport-relative.
        const vw = window.innerWidth || 1920;
        const vh = window.innerHeight || 1080;
        const boardEl = document.querySelector('#game-canvas, #game-board, canvas[data-game-board]');
        let rectCenterUV;
        let rectHalfUV;
        if (boardEl) {
            const r = boardEl.getBoundingClientRect();
            rectCenterUV = this._scratchVec2A.set(
                ((r.left + r.right) * 0.5) / vw,
                ((r.top + r.bottom) * 0.5) / vh,
            );
            rectHalfUV = this._scratchVec2B.set(
                (r.width * 0.5) / vw,
                (r.height * 0.5) / vh,
            );
        } else {
            // Fallback: tall central rect, ~12% wide × 64% tall. Matches the
            // Serenity board's typical size at 1920×1080.
            rectCenterUV = this._scratchVec2A.set(0.5, 0.5);
            rectHalfUV = this._scratchVec2B.set(0.12, 0.32);
        }

        // ── Push to fluid sim (world-space) ──
        // Project the UV rect to world-space at the focal plane (Z ≈ -1).
        // At 38° FOV and camera Z=15, the world height visible at Z=-1 is:
        //   2 * tan(38°/2) * 16 ≈ 11.0 units
        // Width = height * aspect.
        if (this.fluidSim) {
            const focalDepth = 16; // distance from camera to focal plane
            const fovRad = ((this.camera?.fov || 38) * Math.PI) / 180;
            const worldHeight = 2 * Math.tan(fovRad * 0.5) * focalDepth;
            const worldWidth = worldHeight * (vw / vh);
            this._scratchVec3A.set(
                (rectCenterUV.x - 0.5) * worldWidth,
                (0.5 - rectCenterUV.y) * worldHeight, // flip Y: UV Y down, world Y up
                -1.0,
            );
            // Half-extents in world, with 5% padding so the repulsion edge
            // isn't visible flush against the actual board outline.
            this._scratchVec3B.set(
                rectHalfUV.x * worldWidth * 1.05,
                rectHalfUV.y * worldHeight * 1.05,
                0.4,
            );
            // Board-repulsion FORCE is disabled. It used to push particles out
            // of the board rectangle (creating a halo around gameplay), but
            // its edge-falloff math leaves a visible cross-shaped silhouette
            // when the rectangle is centered. With shapes as the primary
            // visual feedback, the halo isn't needed — shapes/free fluid both
            // look better without the geometric carve-out.
            // The screen-space halo glow (post pipeline) stays active.
            this.fluidSim.setBoardZone({
                center: this._scratchVec3A,
                halfExtents: this._scratchVec3B,
                strength: 0,
                softness: 1.6,
            });
        }

        // ── Push to post pipeline (UV-space halo) ──
        if (this.postPipeline) {
            // Small padding on the halo too so it surrounds the board, not flush.
            this._scratchVec2B.set(rectHalfUV.x * 1.04, rectHalfUV.y * 1.02);
            this.postPipeline.setBoardHalo({
                center: rectCenterUV,
                halfSize: this._scratchVec2B,
                strength: 0.32,
                radius: 0.02,
                glow: 0.09,
            });
        }
    }

    // Try/catch lives in a helper so V8 can optimize the animate body.
    _safeFluidCompute() {
        try {
            this.renderer.compute(this.fluidSim.computeNode);
        } catch (err) {
            console.warn('[ElectricDreamsV3] Fluid compute failed, disabling:', err.message);
            this._computeFailedOnce = true;
            this._teardownFluid();
        }
    }

    _teardownFluid() {
        if (this.fluidEmitters) {
            this.fluidEmitters.detach();
            this.fluidEmitters = null;
        }
        if (this.fluidRenderer) {
            this.scene?.remove(this.fluidRenderer.mesh);
            this.fluidRenderer.dispose();
            this.fluidRenderer = null;
        }
        if (this.fluidSim) {
            this.fluidSim.dispose();
            this.fluidSim = null;
        }
    }

    _startAnimation() {
        if (this.animationLoopStarted) return;
        this.animationLoopStarted = true;
        this.clock.start();
        this.clock.getDelta(); // Discard the initial large delta

        const animate = this.safeAnimate(() => {
            const rawDelta = this.clock.getDelta();
            const delta = Number.isFinite(rawDelta) ? Math.min(rawDelta, 0.05) : 0.016;
            this.time += delta;
            this.frameCount += 1;

            // Decay event-driven fx state (per-frame multipliers)
            this.fxState.comboIntensity *= 0.97;
            this.fxState.comboPulse *= 0.95;
            this.fxState.rewardPulse *= 0.96;
            // stageHeat slowly drifts toward 0 unless something pumps it
            this.fxState.stageHeat *= 0.995;
            // Lock/drop punches decay fast (~150ms half-life) — quick "tap"
            // not a sustained boost. Multiplier picked so punches fade within
            // the time between two pieces at fast play (~300-500ms).
            this.fxState.chromaPunch *= 0.80;
            this.fxState.bloomPunch *= 0.83;
            this.fxState.vignettePunch *= 0.78;

            // Camera update (cheap)
            this.cameraDirector?.update(delta, this.fxState);

            // Fluid: update uniforms + dispatch compute. The compute call is
            // wrapped in a one-shot try/catch so a failure on first attempt
            // disables it permanently (avoids per-frame spam).
            if (this.fluidSim && !this._computeFailedOnce) {
                this.fluidSim.update(delta, this.time, {
                    heat: this.fxState.stageHeat,
                    turbulence: 0.6 + this.fxState.comboIntensity * 0.4,
                });
                this._safeFluidCompute();
            }
            this.fluidRenderer?.update(delta, this.time);

            // Nebula uniforms — single object access pattern, no allocations.
            if (this.nebula?.uniforms) {
                this.nebula.uniforms.uTime.value = this.time;
                this.nebula.uniforms.uHeat.value = this.fxState.stageHeat;
                this.nebula.uniforms.uPulse.value = this.fxState.comboPulse;
                this.nebula.uniforms.uActProgress.value = this.fxState.actProgress;
            }

            // Post dynamic update — single cached object reused across frames.
            if (this.postPipeline?.isEnabled()) {
                const dp = this._dynPostParams;
                dp.time = this.time;
                dp.baseBloom = this.postProfile.bloomStrength;
                dp.bloomBoost = this.fxState.comboIntensity * 0.18
                    + this.fxState.rewardPulse * 0.10
                    + this.fxState.bloomPunch;
                dp.baseChromatic = this.postProfile.chromaticStrength;
                dp.chromaticBoost = this.fxState.comboPulse * 0.002
                    + this.fxState.chromaPunch;
                dp.baseVignette = this.postProfile.vignetteDarkness;
                dp.vignetteBoost = this.fxState.vignettePunch;
                dp.baseExposure = this.postProfile.exposure;
                dp.exposureDip = 0;
                this.postPipeline.updateDynamic(dp);

                this.postPipeline.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        }, { maxConsecutiveErrors: 3 });

        animate();
    }

    stop() {
        super.stop();
        this._cancelShapeRelease();
        this._uninstallDebugHelper();
        for (const unsub of this.eventUnsubscribers) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this.eventUnsubscribers = [];

        this._teardownFluid();
        if (this.nebula) {
            this.scene?.remove(this.nebula.mesh);
            this.nebula.dispose();
            this.nebula = null;
        }
        this.postPipeline?.dispose();
        this.postPipeline = null;
        this.cameraDirector = null;

        if (this.renderer) {
            try { this.disposeRenderer(this.renderer, { nullInstance: false }); } catch (e) { /* ignore */ }
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        this.animationLoopStarted = false;
    }
}
