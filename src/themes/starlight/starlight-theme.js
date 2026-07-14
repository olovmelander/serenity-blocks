/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — WebGPU/TSL Theme Orchestrator
 *
 * Rebuild of the legacy DOM/CSS Starlight (divs + keyframes) into a best-in-class
 * WebGPU/Three.js TSL backdrop. See docs/STARLIGHT_WEBGPU_MASTERPIECE_PLAN.md.
 *
 * Thin conductor (mirrors electric-dreams-v3): zero visual math here — it
 * composes the subsystems and calls update() on each in the right order.
 *
 * Implemented: nebula sky (§3), deep parallax starfield (§3), curl-noise stardust
 * river (§5, compute-gated), meteors/shooting stars (§6), event reactivity (§8),
 * MRT selective-bloom post pipeline (§9), cinematic camera (§10), WebGPU + WebGL2
 * fallback with compute capability gating.
 *
 * Not yet: constellations + aurora magic layer (§7), full quality-tier polish (§11).
 */
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { STARLIGHT_TETROMINOS } from './starlight-tetrominos.js';
import { CameraDirector } from './composition/camera-director.js';
import { createNebulaSky } from './rendering/nebula-sky.js';
import { createDeepStarfield } from './rendering/deep-starfield.js';
import { createAuroraBand } from './rendering/aurora-band.js';
import { ConstellationController } from './sim/constellations.js';
import { createConstellationRenderer } from './rendering/constellation-lines.js';
import { StardustSim, getStardustBudget } from './sim/stardust-particles.js';
import { createStardustRenderer } from './rendering/stardust-renderer.js';
import { MeteorSystem, getMeteorBudget } from './sim/meteor-system.js';
import { createMeteorRenderer } from './rendering/meteor-renderer.js';
import { ShockwaveSystem } from './sim/shockwave-system.js';
import { createShockwaveRenderer } from './rendering/shockwave-renderer.js';
import { StarlightReactionDirector } from './sim/starlight-reaction-director.js';
import { createReactionAdapters } from './sim/starlight-reaction-adapters.js';
import { StarlightPostPipeline, getStarlightPostProfile } from './post/render-pipeline.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

// Deep-starfield star counts per quality tier (validated in playground on target iGPU).
const STAR_COUNTS = Object.freeze({
    Minimal: 4000,
    Low: 8000,
    Medium: 12000,
    High: 16000,
    Ultra: 24000,
    Extreme: 32000,
});

function normalizeQuality(name) {
    if (typeof name === 'string' && STAR_COUNTS[name]) return name;
    return 'High';
}

export default class StarlightTheme extends BaseTheme {
    constructor() {
        super('starlight');

        // Deep-disposal opt-in (also injected from the registry's HEAVY_GPU set).
        this.resourceProfile = 'heavy-gpu';

        // Three core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Subsystems
        this.cameraDirector = null;
        this.nebula = null;
        this.aurora = null;
        this.constellations = null;
        this.constellationRenderer = null;
        this.starfield = null;
        this.stardustSim = null;
        this.stardustRenderer = null;
        this.meteors = null;
        this.meteorRenderer = null;
        this.shockwaves = null;
        this.shockwaveRenderer = null;
        this.director = null;
        this.postPipeline = null;
        this.postProfile = null;

        // Event-driven FX punches (decayed per-frame; feed post.updateDynamic).
        this.fxState = {
            bloomPunch: 0, vignettePunch: 0, chromaPunch: 0, flashPunch: 0,
        };
        // Reused dynamic-post payload (no per-frame allocation).
        this._dynPost = {
            time: 0,
            baseBloom: 0,
            bloomBoost: 0,
            baseVignette: 0,
            vignetteBoost: 0,
            baseChromatic: 0,
            chromaticBoost: 0,
            baseExposure: 0,
            exposureDip: 0,
        };

        // Backend capability
        this.isWebGPU = false;
        this._computeAvailable = false;
        this._computeFailedOnce = false;

        // Animation state
        this.time = 0;
        this.animationLoopStarted = false;
        // Rare idle ambient meteors (so the sky has life even without play).
        this._idleMeteorTimer = 0;
        this._nextIdleMeteor = 8 + Math.random() * 18;

        // Cleanup handles
        this.eventUnsubscribers = [];
        this._onPointerMove = null;
        this.boundResize = null;

        this.qualityName = 'High';
    }

    async init() {
        this.qualityName = this._getQualityFromSettings();
        this.postProfile = getStarlightPostProfile(this.qualityName);
    }

    _getQualityFromSettings() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    _starCount() {
        return STAR_COUNTS[this.qualityName] || STAR_COUNTS.High;
    }

    _auroraEnabledForTier() {
        return this.qualityName === 'High'
            || this.qualityName === 'Ultra'
            || this.qualityName === 'Extreme';
    }

    _constellationsEnabledForTier() {
        return this.qualityName !== 'Minimal' && this.qualityName !== 'Low';
    }

    async createScene() {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[Starlight] Container not found');
            return;
        }
        // createScene can be re-invoked (context restore) — start from clean DOM.
        container.innerHTML = '';

        this.qualityName = this._getQualityFromSettings();
        this.postProfile = getStarlightPostProfile(this.qualityName);

        const ok = await this._initRenderer(container);
        if (!ok) return;

        const w = window.innerWidth;
        const h = window.innerHeight;

        // ── Scene + camera ──
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 600);
        this.camera.position.set(0, 0.4, 14);
        this.camera.lookAt(0, 0, 0);

        // ── Subsystems ──
        this.cameraDirector = new CameraDirector(this.camera, new THREE.Vector3(0, 0, 0));
        this.cameraDirector.snapToRest();

        this.nebula = createNebulaSky();
        this.scene.add(this.nebula.mesh);

        // Aurora band — thin upper-sky whisper, High+ only (first layer dropped).
        if (this._auroraEnabledForTier()) {
            this.aurora = createAuroraBand({ strength: 0.6 });
            this.scene.add(this.aurora.mesh);
        }

        this.starfield = createDeepStarfield({ count: this._starCount() });
        this.scene.add(this.starfield.mesh);

        // Stardust river — capability-gated living hero layer (compute only).
        this._setupStardust();

        // Meteors / shooting stars (CPU sim; works on both backends).
        this._setupMeteors();

        // Shockwave rings / light-echo shells (cheap CPU pool; both backends).
        this.shockwaves = new ShockwaveSystem();
        this.shockwaveRenderer = createShockwaveRenderer(this.shockwaves);
        this.scene.add(this.shockwaveRenderer.mesh);

        // Constellations — ambient signs ON (art direction: a busy, sign-filled sky, not
        // the restrained "one earned sign"). Combos scatter more on top (see the director).
        if (this._constellationsEnabledForTier()) {
            this.constellations = new ConstellationController({ ambient: true });
            this.constellationRenderer = createConstellationRenderer(this.constellations);
            this.scene.add(this.constellationRenderer.group);
        }

        // Post pipeline (MRT selective bloom) — WebGPU only; gated + defensive.
        this._setupPost();

        // Event reactivity — the StarlightReactionDirector coalesces each lock
        // resolution into ONE dominant cue (per-player, on a theme-time timeline).
        // Adapters bind its abstract cues to these subsystems; seal is deferred
        // until board-rect projection (see starlight-reaction-adapters.js).
        const { adapters, resolvers } = createReactionAdapters(this);
        this.director = new StarlightReactionDirector({ adapters, resolvers });
        this.eventUnsubscribers.push(this.director.attach(eventBus, EVENTS));

        this._setupPointer();
        this._setupResize();
        this._startAnimation();

        console.log(
            `[Starlight] Scene created (quality=${this.qualityName}, stars=${this._starCount()}, `
                + `webgpu=${this.isWebGPU}, compute=${this._computeAvailable})`,
        );
    }

    /**
     * Create a WebGPURenderer, falling back to its WebGL2 backend when WebGPU is
     * unavailable. TSL node materials render on both backends; only the compute
     * stardust river (later phase) needs true WebGPU, which is gated separately.
     * Returns true on success.
     */
    async _initRenderer(container) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const antialias = this.getAntialiasEnabled();
        const wantWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

        const make = async (forceWebGL) => {
            const r = new THREE_WEBGPU.WebGPURenderer({
                antialias,
                alpha: false,
                powerPreference: 'high-performance',
                forceWebGL,
            });
            await Promise.race([
                r.init(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('WebGPU init timeout')), 5000);
                }),
            ]);
            return r;
        };

        let renderer = null;
        if (wantWebGPU) {
            try {
                renderer = await make(false);
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose();
                    renderer = null;
                }
            } catch (err) {
                console.warn('[Starlight] WebGPU init failed, trying WebGL2 backend:', err);
                renderer = null;
            }
        }
        if (!renderer) {
            try {
                renderer = await make(true); // WebGL2 backend of WebGPURenderer
            } catch (err) {
                console.error('[Starlight] Renderer init failed:', err);
                container.innerHTML = '<div style="color:#aab;text-align:center;padding:2em;'
                    + 'font-family:sans-serif;">Starlight needs WebGPU or WebGL2. '
                    + 'Try Chrome 113+ or Safari 26+.</div>';
                return false;
            }
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this._computeAvailable = this.isWebGPU && typeof renderer.compute === 'function';

        renderer.setPixelRatio(this.getEffectivePixelRatio(2, 'theme'));
        renderer.setSize(w, h);
        renderer.setClearColor(0x05060f, 1);
        if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

        renderer.domElement.id = 'starlight-renderer';
        renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(renderer.domElement);
        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
        });
        return true;
    }

    _setupPointer() {
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
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(2, 'theme'));
        this.renderer.setSize(w, h);
    }

    _startAnimation() {
        if (this.animationLoopStarted) return;
        this.animationLoopStarted = true;
        this.clock.start();
        this.clock.getDelta(); // discard the large first delta

        const animate = this.safeAnimate(
            () => {
                const raw = this.clock.getDelta();
                const delta = Number.isFinite(raw) ? Math.min(raw, 0.05) : 0.016;
                this.time += delta;

                // Reaction director first: flush this frame's coalesced resolution and
                // fire due beats so their spawns/camera punches land this same frame.
                this.director?.update(delta);

                this.cameraDirector?.update(delta);

                if (this.starfield) {
                    // Feed the camera projection for the pixel-size floor:
                    // viewportH = drawing-buffer pixel height; projScaleY = proj[1][1].
                    const bufH = this.renderer.domElement.height || window.innerHeight;
                    const projScaleY = this.camera.projectionMatrix.elements[5];
                    this.starfield.setProjection(bufH, projScaleY);
                    this.starfield.update(this.time);
                }
                this.nebula?.update(this.time);
                this.aurora?.update(this.time);

                // Stardust compute river (gated; one-shot try/catch disables on failure).
                if (this.stardustSim && !this._computeFailedOnce) {
                    this.stardustSim.update(delta, this.time);
                    this._safeStardustCompute();
                    this.stardustRenderer?.update(this.time);
                }

                // Meteors (CPU sim → instanced billboards) + rare idle drift.
                if (this.meteors) {
                    this._idleMeteorTimer += delta;
                    if (this._idleMeteorTimer >= this._nextIdleMeteor) {
                        this._idleMeteorTimer = 0;
                        this._nextIdleMeteor = 25 + Math.random() * 35; // 25–60s
                        if (Math.random() < 0.85) this.meteors.spawnFaint();
                        else this.meteors.spawnBright();
                    }
                    this.meteors.update(delta);
                    this.meteorRenderer?.update();
                }

                // Shockwave rings / light-echo shells.
                if (this.shockwaves) {
                    this.shockwaves.update(delta, this.time);
                    this.shockwaveRenderer?.update(this.time);
                }

                // Constellations (self-drawing figures).
                if (this.constellations) {
                    this.constellations.update(delta);
                    this.constellationRenderer?.update();
                }

                // Decay event FX punches (fast taps, not sustained boosts).
                // Delta-normalized (exp of the 60 Hz-referenced per-frame factors) so the
                // punch tail matches at 60/120/144 Hz instead of decaying faster on high-refresh.
                const fx = this.fxState;
                fx.bloomPunch *= Math.exp(-9.05 * delta); // ≈0.86 / frame @60Hz
                fx.vignettePunch *= Math.exp(-11.9 * delta); // ≈0.82
                fx.chromaPunch *= Math.exp(-13.4 * delta); // ≈0.80
                fx.flashPunch *= Math.exp(-14.9 * delta); // ≈0.78

                // Render — through the post pipeline when enabled, else direct.
                if (this.postPipeline?.isEnabled()) {
                    const dp = this._dynPost;
                    dp.time = this.time;
                    dp.baseBloom = this.postProfile.bloomStrength;
                    dp.bloomBoost = fx.bloomPunch + fx.flashPunch * 0.35;
                    dp.baseVignette = this.postProfile.vignetteDarkness;
                    dp.vignetteBoost = fx.vignettePunch;
                    dp.baseChromatic = this.postProfile.chromaticStrength;
                    dp.chromaticBoost = fx.chromaPunch;
                    dp.baseExposure = this.postProfile.exposure;
                    dp.exposureDip = 0;
                    this.postPipeline.updateDynamic(dp);
                    this.postPipeline.render();
                } else {
                    this.renderer.render(this.scene, this.camera);
                }
            },
            { maxConsecutiveErrors: 3 },
        );

        animate();
    }

    /**
     * Build the curl-noise stardust river — only when WebGPU compute is available
     * and the tier budget is non-zero. On the WebGL2 fallback (or Minimal) the
     * starfield + sky carry the theme.
     */
    _setupStardust() {
        if (!this._computeAvailable) {
            console.log('[Starlight] Compute unavailable — stardust river skipped (starfield carries the theme)');
            return;
        }
        const budget = getStardustBudget(this.qualityName);
        if (!budget.count) return; // Minimal tier: no dust
        try {
            this.stardustSim = new StardustSim(budget.count, { flowStrength: budget.flowStrength });
            this.stardustSim.createComputeNode();
            this.stardustRenderer = createStardustRenderer(this.stardustSim, {
                sizeMul: 1.0,
                brightness: 1.2,
                twinkleAmp: 0.85,
            });
            this.scene.add(this.stardustRenderer.mesh);
            console.log(`[Starlight] Stardust river active (${budget.count} motes)`);
        } catch (err) {
            console.warn('[Starlight] Stardust setup failed:', err);
            this._teardownStardust();
        }
    }

    // Try/catch isolated so V8 can optimize the animate body.
    _safeStardustCompute() {
        try {
            this.renderer.compute(this.stardustSim.computeNode);
        } catch (err) {
            console.warn('[Starlight] Stardust compute failed, disabling:', err.message);
            this._computeFailedOnce = true;
            this._teardownStardust();
        }
    }

    _teardownStardust() {
        if (this.stardustRenderer) {
            this.scene?.remove(this.stardustRenderer.mesh);
            this.stardustRenderer.dispose();
            this.stardustRenderer = null;
        }
        if (this.stardustSim) {
            this.stardustSim.dispose();
            this.stardustSim = null;
        }
    }

    _setupMeteors() {
        const max = getMeteorBudget(this.qualityName);
        this.meteors = new MeteorSystem(max);
        this.meteorRenderer = createMeteorRenderer(this.meteors, { intensity: 1.0 });
        this.scene.add(this.meteorRenderer.mesh);
    }

    _teardownMeteors() {
        if (this.meteorRenderer) {
            this.scene?.remove(this.meteorRenderer.mesh);
            this.meteorRenderer.dispose();
            this.meteorRenderer = null;
        }
        if (this.meteors) {
            this.meteors.dispose();
            this.meteors = null;
        }
    }

    /**
     * MRT selective-bloom post pipeline — WebGPU only, profile-gated, defensive
     * (any failure → null → orchestrator falls back to direct renderer.render()).
     */
    _setupPost() {
        if (!this.postProfile?.enabled || !this.isWebGPU) return;
        const useMRT = this.qualityName !== 'Low'; // Low: cheaper non-selective bloom
        try {
            this.postPipeline = new StarlightPostPipeline(this.renderer, this.scene, this.camera, {
                ...this.postProfile,
                useMRT,
            });
            this.postPipeline.setProfile(this.postProfile);
            if (!this.postPipeline.isEnabled()) this.postPipeline = null;
        } catch (err) {
            console.warn('[Starlight] Post setup failed; rendering without post:', err);
            this.postPipeline = null;
        }
    }

    getTetrominoConfig() {
        return STARLIGHT_TETROMINOS;
    }

    stop() {
        super.stop();

        for (const unsub of this.eventUnsubscribers) {
            try {
                unsub?.();
            } catch (e) {
                /* ignore */
            }
        }
        this.eventUnsubscribers = [];

        this._teardownStardust();
        this._teardownMeteors();
        if (this.shockwaveRenderer) {
            this.scene?.remove(this.shockwaveRenderer.mesh);
            this.shockwaveRenderer.dispose();
            this.shockwaveRenderer = null;
        }
        if (this.shockwaves) {
            this.shockwaves.dispose();
            this.shockwaves = null;
        }
        if (this.constellationRenderer) {
            this.scene?.remove(this.constellationRenderer.group);
            this.constellationRenderer.dispose();
            this.constellationRenderer = null;
        }
        if (this.constellations) {
            this.constellations.dispose();
            this.constellations = null;
        }
        if (this.postPipeline) {
            this.postPipeline.dispose();
            this.postPipeline = null;
        }
        if (this.director) {
            this.director.dispose();
            this.director = null;
        }
        if (this.starfield) {
            this.scene?.remove(this.starfield.mesh);
            this.starfield.dispose();
            this.starfield = null;
        }
        if (this.aurora) {
            this.scene?.remove(this.aurora.mesh);
            this.aurora.dispose();
            this.aurora = null;
        }
        if (this.nebula) {
            this.scene?.remove(this.nebula.mesh);
            this.nebula.dispose();
            this.nebula = null;
        }
        this.cameraDirector = null;

        if (this.renderer) {
            try {
                this.disposeRenderer(this.renderer, { nullInstance: false });
            } catch (e) {
                /* ignore */
            }
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        this.animationLoopStarted = false;
    }
}
