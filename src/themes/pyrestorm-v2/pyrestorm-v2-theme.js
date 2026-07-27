/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Theme Orchestrator (WebGPU/TSL)
 *
 * AAA rebuild of the Pyrestorm volcanic theme. Thin orchestrator: composes
 * subsystems (sky, terrain, lava, eruption, post, camera) into a frame loop.
 * Heavy visual logic lives in subsystem modules under this directory.
 *
 * See docs/PYRESTORM_AAA_WEBGPU_REBUILD_PLAN.md for the full plan.
 *
 * Implemented (Phases 0–5):
 *   - WebGPU renderer init (timeout-guarded) + graceful fallback message
 *   - Scene + exponential height fog + perspective camera
 *   - Procedural volcanic sky (TSL)
 *   - Relief-mapped molten basin + domain-warped/Worley lava material
 *   - Lit volcano cone (welded seam) + crater lake + rim peaks + basalt field
 *   - Compute eruption fountain (fountain/ember/bomb roles)
 *   - Smoke plume + drifting ash + god-ray shafts
 *
 * NOT yet implemented:
 *   - MRT selective-bloom post pipeline + color grade (Phase 6)
 *   - Cinematic camera director (off-center framing, event dollies) (Phase 7)
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { PYRESTORM_TETROMINOS } from '../pyrestorm/pyrestorm-tetrominos.js';
import { createVolcanicSky } from './materials/sky-material.js';
import { createCalderaBasin } from './rendering/caldera-basin.js';
import { createVolcano } from './rendering/volcano-mesh.js';
import { createBasaltField } from './rendering/basalt-field.js';
import { EruptionSim, getEruptionBudget } from './sim/eruption-sim.js';
import { createEruptionRenderer } from './rendering/eruption-renderer.js';
import { createSmokePlume } from './rendering/smoke-volume.js';
import { createAshMotes } from './rendering/ash-motes.js';
import { createGodRays } from './rendering/god-rays.js';

// Per-tier knobs. Phase 0 only consumes pixelRatio + fog; later phases read
// the particle/terrain/post fields added here as subsystems come online.
const QUALITY_PRESETS = Object.freeze({
    Minimal: {
        maxPixelRatio: 1.0,
        fogDensity: 0.000045,
        basinSegments: 96,
        volcanoSegments: 64,
        spireCount: 200,
        smokeCount: 40,
        ashCount: 500,
        enableGodRays: false,
        enablePost: false,
    },
    Low: {
        maxPixelRatio: 1.25,
        fogDensity: 0.000042,
        basinSegments: 128,
        volcanoSegments: 80,
        spireCount: 350,
        smokeCount: 60,
        ashCount: 800,
        enableGodRays: true,
        enablePost: false,
    },
    Medium: {
        maxPixelRatio: 1.5,
        fogDensity: 0.00004,
        basinSegments: 180,
        volcanoSegments: 112,
        spireCount: 500,
        smokeCount: 80,
        ashCount: 1200,
        enableGodRays: true,
        enablePost: true,
    },
    High: {
        maxPixelRatio: 2.0,
        fogDensity: 0.000038,
        basinSegments: 240,
        volcanoSegments: 128,
        spireCount: 750,
        smokeCount: 110,
        ashCount: 1800,
        enableGodRays: true,
        enablePost: true,
    },
    Ultra: {
        maxPixelRatio: 2.0,
        fogDensity: 0.000036,
        basinSegments: 300,
        volcanoSegments: 160,
        spireCount: 1100,
        smokeCount: 150,
        ashCount: 2600,
        enableGodRays: true,
        enablePost: true,
    },
    Extreme: {
        maxPixelRatio: 2.0,
        fogDensity: 0.000034,
        basinSegments: 360,
        volcanoSegments: 192,
        spireCount: 1600,
        smokeCount: 200,
        ashCount: 3500,
        enableGodRays: true,
        enablePost: true,
    },
});

export default class PyrestormV2Theme extends BaseTheme {
    constructor() {
        super('pyrestorm-v2');

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Subsystems
        this.sky = null;
        this.basin = null;
        this.volcano = null;
        this.basalt = null;
        this.eruption = null;
        this.eruptionRenderer = null;
        this.smoke = null;
        this.ash = null;
        this.godRays = null;
        this._computeAvailable = false;
        this._computeFailed = false;

        // Quality
        this.qualityName = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;

        // Animation / fx state
        this.time = 0;
        this.frameCount = 0;
        this.animationLoopStarted = false;
        this.intensity = 0; // 0..1, rises with gameplay
        this.lavaPulse = 0; // brief molten flare on piece lock

        // Camera framing (matches the old theme's elevated side angle)
        this.cameraBasePosition = new THREE.Vector3(0, 350, 1000);
        this.cameraLookAt = new THREE.Vector3(0, 200, 0);

        this.eventUnsubscribers = [];
        this.boundResize = null;
    }

    getTetrominoConfig() {
        return PYRESTORM_TETROMINOS;
    }

    _getQualityFromSettings() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    _ensureContainer() {
        let container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            container = document.createElement('div');
            container.id = `${this.name}-theme`;
            container.className = 'theme-container';
            const bg = document.getElementById('background-container');
            (bg || document.body).appendChild(container);
        }
        return container;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        this.qualityName = this._getQualityFromSettings();
        this.qualityPreset = QUALITY_PRESETS[this.qualityName] || QUALITY_PRESETS.High;

        const container = this._ensureContainer();
        const w = window.innerWidth;
        const h = window.innerHeight;

        // ── WebGPU renderer (primary). Fallback message if unavailable; the
        //    existing WebGL `pyrestorm` theme remains the option for those users. ──
        if (!navigator.gpu) {
            this._showFallbackMessage(
                container,
                'This theme requires WebGPU. Use the "Pyrestorm" theme on browsers without WebGPU.',
            );
            return;
        }
        const renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });
        try {
            await this.initializeRendererCandidate(renderer, {
                timeoutMs: 4000,
                label: 'Pyrestorm V2 WebGPU renderer init',
                ownerGeneration,
            });
            if (renderer.backend?.isWebGPUBackend !== true) {
                throw new Error('WebGPU backend not active after init');
            }
        } catch (err) {
            if (ownerGeneration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete) return;
            console.error('[PyrestormV2] WebGPU init failed:', err);
            this.disposeRenderer(renderer, { nullInstance: false });
            this._showFallbackMessage(container, `WebGPU initialization failed: ${err.message}`);
            return;
        }

        if (ownerGeneration !== this.lifecycleGeneration
            || !this.isActive
            || this.cleanupComplete) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        this.renderer = renderer;

        this.renderer.setPixelRatio(this.getEffectivePixelRatio(this.qualityPreset.maxPixelRatio));
        this.renderer.setSize(w, h);
        this.renderer.setClearColor(0x050000, 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.85;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        // ── Scene + atmosphere + camera ──
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x1a0703, this.qualityPreset.fogDensity);

        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 50000);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraLookAt);

        // ── Subsystems ──
        this.sky = createVolcanicSky({ radius: 16000 });
        this.scene.add(this.sky.mesh);

        this.basin = createCalderaBasin({ segments: this.qualityPreset.basinSegments });
        this.scene.add(this.basin.mesh);

        this.volcano = createVolcano({ segments: this.qualityPreset.volcanoSegments });
        this.scene.add(this.volcano.group);

        this.basalt = createBasaltField({ spireCount: this.qualityPreset.spireCount });
        this.scene.add(this.basalt.mesh);

        // GPU eruption (requires compute). Skipped gracefully on backends without it.
        this._computeAvailable = typeof this.renderer.compute === 'function';
        if (this._computeAvailable) {
            try {
                this.eruption = new EruptionSim(getEruptionBudget(this.qualityName));
                this.eruption.createComputeNode();
                this.eruptionRenderer = createEruptionRenderer(this.eruption, {
                    sizeMul: 1.0,
                    emissiveMul: 1.5,
                });
                this.scene.add(this.eruptionRenderer.mesh);
            } catch (err) {
                console.warn('[PyrestormV2] Eruption sim setup failed:', err);
                this._teardownEruption();
            }
        }

        // Atmosphere: smoke plume (dark shoulders), drifting ash, god rays.
        this.smoke = createSmokePlume({ count: this.qualityPreset.smokeCount });
        this.scene.add(this.smoke.mesh);

        this.ash = createAshMotes({ count: this.qualityPreset.ashCount });
        this.scene.add(this.ash.mesh);

        if (this.qualityPreset.enableGodRays) {
            this.godRays = createGodRays();
            this.scene.add(this.godRays.mesh);
        }

        this._setupEventListeners();
        this._setupResize();
        this._startAnimation();

        console.log(`[PyrestormV2] Scene created (quality=${this.qualityName})`);
    }

    _showFallbackMessage(container, msg) {
        container.innerHTML = '<div style="color:#c98;display:flex;align-items:center;'
            + 'justify-content:center;height:100%;text-align:center;padding:2em;'
            + `font-family:sans-serif;line-height:1.5;">${msg}</div>`;
    }

    _setupEventListeners() {
        const bump = (amount) => { this.intensity = Math.min(1, this.intensity + amount); };
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.LINE_CLEAR, (d) => {
                const n = d?.lines || d?.count || 1;
                bump(0.15 * n);
                this.eruption?.erupt(Math.min(2.5, n * 0.6));
            }),
            eventBus.on(EVENTS.COMBO, (d) => {
                const n = d?.combo || d?.count || 0;
                bump(0.1 * n);
                this.eruption?.erupt(Math.min(4, n * 0.8));
            }),
            eventBus.on(EVENTS.PIECE_LOCK, () => {
                bump(0.04);
                this.lavaPulse = Math.min(1, this.lavaPulse + 0.4);
            }),
        );
    }

    _teardownEruption() {
        if (this.eruptionRenderer) {
            this.scene?.remove(this.eruptionRenderer.mesh);
            this.eruptionRenderer.dispose();
            this.eruptionRenderer = null;
        }
        if (this.eruption) {
            this.eruption.dispose();
            this.eruption = null;
        }
    }

    _setupResize() {
        this.boundResize = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.boundResize);
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _startAnimation() {
        if (this.animationLoopStarted) return;
        this.animationLoopStarted = true;
        this.clock.start();
        this.clock.getDelta(); // discard first large delta

        const animate = this.safeAnimate(() => {
            const raw = this.clock.getDelta();
            const dt = Number.isFinite(raw) ? Math.min(raw, 0.05) : 0.016;
            this.time += dt;
            this.frameCount += 1;

            // Intensity / pulse decay toward calm unless gameplay pumps them.
            this.intensity = Math.max(0, this.intensity - dt * 0.1);
            this.lavaPulse = Math.max(0, this.lavaPulse - dt * 2.5);

            if (this.sky?.uniforms) {
                this.sky.uniforms.uTime.value = this.time;
                this.sky.uniforms.uIntensity.value = this.intensity;
            }
            if (this.basin?.uniforms) {
                this.basin.uniforms.uTime.value = this.time;
                this.basin.uniforms.uIntensity.value = this.intensity;
            }
            if (this.volcano?.uniforms) {
                this.volcano.uniforms.uTime.value = this.time;
                this.volcano.uniforms.uIntensity.value = this.intensity;
                this.volcano.uniforms.uLavaPulse.value = this.lavaPulse;
            }
            if (this.basalt?.uniforms) {
                this.basalt.uniforms.uTime.value = this.time;
                this.basalt.uniforms.uIntensity.value = this.intensity;
                this.basalt.uniforms.uLavaPulse.value = this.lavaPulse;
            }

            if (this.smoke?.uniforms) {
                this.smoke.uniforms.uTime.value = this.time;
                this.smoke.uniforms.uIntensity.value = this.intensity;
            }
            if (this.ash?.uniforms) {
                this.ash.uniforms.uTime.value = this.time;
            }
            if (this.godRays?.uniforms) {
                this.godRays.uniforms.uTime.value = this.time;
                this.godRays.uniforms.uIntensity.value = this.intensity;
            }

            // Eruption: update uniforms + dispatch compute. One-shot failure
            // disables it permanently to avoid per-frame error spam.
            if (this.eruption && !this._computeFailed) {
                this.eruption.update(dt, this.time, this.intensity);
                try {
                    this.renderer.compute(this.eruption.computeNode);
                } catch (e) {
                    this._computeFailed = true;
                    console.warn('[PyrestormV2] Eruption compute failed; disabling:', e);
                }
            }

            this.renderer.render(this.scene, this.camera);
        }, { maxConsecutiveErrors: 3 });

        animate();
    }

    stop() {
        super.stop();

        for (const unsub of this.eventUnsubscribers) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this.eventUnsubscribers = [];

        if (this.boundResize) {
            window.removeEventListener('resize', this.boundResize);
            this.boundResize = null;
        }

        if (this.sky) {
            this.scene?.remove(this.sky.mesh);
            this.sky.dispose();
            this.sky = null;
        }

        if (this.basin) {
            this.scene?.remove(this.basin.mesh);
            this.basin.dispose();
            this.basin = null;
        }

        if (this.volcano) {
            this.scene?.remove(this.volcano.group);
            this.volcano.dispose();
            this.volcano = null;
        }

        if (this.basalt) {
            this.scene?.remove(this.basalt.mesh);
            this.basalt.dispose();
            this.basalt = null;
        }

        this._teardownEruption();

        if (this.smoke) {
            this.scene?.remove(this.smoke.mesh);
            this.smoke.dispose();
            this.smoke = null;
        }
        if (this.ash) {
            this.scene?.remove(this.ash.mesh);
            this.ash.dispose();
            this.ash = null;
        }
        if (this.godRays) {
            this.scene?.remove(this.godRays.mesh);
            this.godRays.dispose();
            this.godRays = null;
        }

        if (this.renderer) {
            try { this.disposeRenderer(this.renderer, { nullInstance: false }); } catch (e) { /* ignore */ }
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        this.animationLoopStarted = false;
    }
}
