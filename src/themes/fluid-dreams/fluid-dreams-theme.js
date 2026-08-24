/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FLUID DREAMS — WebGPU/TSL Hero Refactor
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * One vibrant iridescent fluid surface (TSL raymarched metaballs) drifting in
 * volumetric neon haze, with curl-noise compute particles, MRT emissive bloom,
 * ACES tonemap, and subtle chromatic aberration.
 *
 * WebGPU path: TSL node materials + compute + THREE.RenderPipeline.
 * WebGL fallback: MeshPhysicalMaterial liquid-glass orbs + EffectComposer.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { IntroCameraParallax } from '../../ui/intro-camera-parallax.js';
import { FLUID_DREAMS_TETROMINOS } from './fluid-dreams-tetrominos.js';
import {
    backgroundVertexShader,
    backgroundFragmentShader,
    fallbackParticleVertexShader,
    fallbackParticleFragmentShader,
} from './fluid-dreams-shaders.js';
import {
    createFluidHeroNodeMaterial,
    createBackgroundNodeMaterial,
    createVolumetricHazeNodeMaterial,
    createFluidParticleNodeMaterial,
    ELECTRIC_PALETTE,
} from './fluid-dreams-materials.js';
import { FluidDreamsParticleCompute } from './fluid-dreams-compute.js';
import { FluidDreamsPost } from './fluid-dreams-post.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality presets — vibrant-hero budget
// ─────────────────────────────────────────────────────────────────────────────

// Quality budgets — rebalanced for stable framerate.
// computeStride: dispatch particle compute every Nth frame (1 = every frame).
const QUALITY_PRESETS = {
    Minimal: {
        particleCount: 1200,
        marchSteps: 24,
        bgHazeSteps: 0,
        hazeSegments: [0, 0],
        metaballCount: 4,
        enableBloom: false,
        enableChromaticAberration: false,
        bloomStrength: 0.25,
        bloomRadius: 0.6,
        bloomDownsample: 0.5,
        computeStride: 2,
    },
    Low: {
        particleCount: 2500,
        marchSteps: 32,
        bgHazeSteps: 6,
        hazeSegments: [16, 12],
        metaballCount: 5,
        enableBloom: true,
        enableChromaticAberration: false,
        bloomStrength: 0.3,
        bloomRadius: 0.7,
        bloomDownsample: 0.55,
        computeStride: 1,
    },
    Medium: {
        particleCount: 5000,
        marchSteps: 40,
        bgHazeSteps: 10,
        hazeSegments: [16, 12],
        metaballCount: 6,
        enableBloom: true,
        enableChromaticAberration: true,
        bloomStrength: 0.38,
        bloomRadius: 0.8,
        bloomDownsample: 0.6,
        computeStride: 1,
    },
    High: {
        particleCount: 9000,
        marchSteps: 52,
        bgHazeSteps: 14,
        hazeSegments: [20, 14],
        metaballCount: 6,
        enableBloom: true,
        enableChromaticAberration: true,
        bloomStrength: 0.45,
        bloomRadius: 0.9,
        bloomDownsample: 0.6,
        computeStride: 1,
    },
    Ultra: {
        particleCount: 14000,
        marchSteps: 64,
        bgHazeSteps: 16,
        hazeSegments: [24, 16],
        metaballCount: 7,
        enableBloom: true,
        enableChromaticAberration: true,
        bloomStrength: 0.52,
        bloomRadius: 0.95,
        bloomDownsample: 0.6,
        computeStride: 1,
    },
    Extreme: {
        particleCount: 22000,
        marchSteps: 76,
        bgHazeSteps: 20,
        hazeSegments: [24, 16],
        metaballCount: 8,
        enableBloom: true,
        enableChromaticAberration: true,
        bloomStrength: 0.58,
        bloomRadius: 1.0,
        bloomDownsample: 0.65,
        computeStride: 1,
    },
};

const DEFAULT_QUALITY = 'High';
const SHOCKWAVE_DURATION = 1.25;
const SHOCKWAVE_MAX_RADIUS = 30.0;
const COMBO_THRESHOLD_FOR_SHOCKWAVE = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────

export default class FluidDreamsTheme extends BaseTheme {
    constructor() {
        super('fluid-dreams');

        this.eventUnsubscribers = [];

        // Renderers + core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = new THREE.Clock();
        this.isWebGPU = false;
        this.isWebGL = false;
        this.animationFrame = null;

        // Scene meshes
        this.heroMesh = null;
        this.heroMaterial = null;
        this.backgroundMesh = null;
        this.backgroundMaterial = null;
        this.hazeMesh = null;
        this.hazeMaterial = null;
        this.particleSystem = null;
        this.particleMaterial = null;
        this.particleCompute = null;

        // WebGL fallback specifics
        this.fallbackOrbs = [];
        this.composer = null;
        this.bloomPass = null;

        // WebGPU post
        this.post = null;

        // Metaball CPU state (positions are advected on CPU and pushed to GPU uniforms)
        this.metaballState = [];

        // Combo / shockwave state
        this.iridescenceShift = 0;
        this.targetIridescenceShift = 0;
        this.velocityBoost = 0;
        this.targetVelocityBoost = 0;
        this.shockwaveProgress = -1; // -1 == idle
        this.shockwaveDuration = SHOCKWAVE_DURATION;
        this.shockwaveOrigin = new THREE.Vector3(0, 0, 0);

        // Gameplay-reactive impulse state. Each impulse is an additive momentum that
        // decays exponentially — small/frequent events stack, large/rare events spike.
        // lockImpulse  : piece lock (every few seconds) → small fluid breath
        // lineFlash    : line clear (per clear) → palette wash + particle bath
        // tetrisFlash  : 4-line clear → palette inversion + climax
        // comboHum     : sustained combo tension → ambient intensification
        // paletteCyclePhase: rotates through 5-stop iridescence ramp
        // heroPulse    : eased breath scalar driving metaball SDF growth
        this.lockImpulse = 0;
        this.lineFlash = 0;
        this.tetrisFlash = 0;
        this.comboHum = 0;
        this.paletteCyclePhase = 0;
        this.heroPulse = 0;
        this.targetHeroPulse = 0;
        // Particle colour wash — line clears bleed a tint into the field for a beat.
        this.particleColorTarget = new THREE.Color(0xff2d95);
        this.particleColorMix = 0;
        this.targetParticleColorMix = 0;
        // Combo attract focal point — hero centre, slightly biased toward the cluster.
        this._attractCenter = new THREE.Vector3(0, 0, 0);
        // Line-clear tint cycle (by clear count): 1=cyan, 2=pink, 3=violet, 4=gold.
        this._lineClearTints = [
            new THREE.Color(0x00E5FF),
            new THREE.Color(0xFF2D95),
            new THREE.Color(0xB14CFF),
            new THREE.Color(0xFFD93D),
        ];

        // Camera animation — composed for gameplay framing.
        // The game board + right stats panel claim the center & center-right of the
        // screen, so we shift the focal point to the right of world origin. That puts
        // the hero metaballs (which orbit world origin) in the LEFT third of the
        // viewport — the largest free zone in the gameplay UI — while leaving the
        // particle atmosphere + haze to fill the bottom and edges across the full frame.
        // Camera lifted slightly so the hero sits below screen-centre, away from the
        // top-right player widget.
        this.baseCameraPos = new THREE.Vector3(0, 1.5, 22);
        this.cameraLook = new THREE.Vector3(3.5, 0.5, 0);

        // Reuse the camera controller proven by Serenity Warp. It owns pointer
        // tracking, frame-rate-independent smoothing, and focus-loss recentering.
        this.cameraParallax = new IntroCameraParallax({
            orbitX: 5.5,
            orbitY: 3.6,
            orbitZ: 1.8,
            lookAtGain: 0.22,
            dampRate: 3.8,
        });

        // Quality
        this.currentQuality = DEFAULT_QUALITY;
        this.activePreset = QUALITY_PRESETS[DEFAULT_QUALITY];
        this.qualityChangeHandler = null;

        // Frame stability — dynamic resolution scaling.
        // Keeps frametime near 16.6ms by trimming pixel ratio when GPU-bound.
        // Tuned to react before the global PerformanceMonitor's 31-frame
        // PERFORMANCE_DOWNSCALE event fires (≈0.5s at 60Hz).
        this.drs = {
            enabled: true,
            scale: 1.0,
            minScale: 0.65,
            maxScale: 1.0,
            targetMs: 16.6,
            emaMs: 16.6,
            adjustInterval: 0.2,
            elapsed: 0,
            consecutiveSlow: 0,
        };
        this.frameCount = 0;

        // Resize
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Quality
    // ─────────────────────────────────────────────────────────────────────────

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || DEFAULT_QUALITY;
    }

    applyQualityPreset(quality) {
        if (!QUALITY_PRESETS[quality]) quality = DEFAULT_QUALITY;
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality];
        console.log(`💧 Fluid Dreams: Applied ${quality} quality preset`);

        if (this.isActive && this.scene) {
            this.rebuildQualityDependentElements();
        }
    }

    rebuildQualityDependentElements() {
        // Particles and hero march steps are baked in at material creation time —
        // rebuild both. Cheap because they're a single mesh each.
        this.disposeHero();
        this.disposeParticles();
        this.disposeHaze();

        this.createHaze();
        this.createHero();
        this.createParticles();

        if (this.post) {
            this.post.update({
                bloomStrength: this.activePreset.bloomStrength,
                bloomRadius: this.activePreset.bloomRadius,
                bloomDownsample: this.activePreset.bloomDownsample,
                chromaticStrength: this.activePreset.enableChromaticAberration ? 0.0022 : 0.0,
            });
        }
        if (this.bloomPass) {
            this.bloomPass.enabled = this.activePreset.enableBloom;
            this.bloomPass.strength = this.activePreset.bloomStrength;
            this.bloomPass.radius = this.activePreset.bloomRadius;
        }
    }

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (newQuality && newQuality !== this.currentQuality) {
                this.applyQualityPreset(newQuality);
            }
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tetromino config
    // ─────────────────────────────────────────────────────────────────────────

    getTetrominoConfig() {
        return FLUID_DREAMS_TETROMINOS;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene init
    // ─────────────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        console.log('💧 Fluid Dreams: Initializing WebGPU/TSL scene...');

        const container = document.getElementById('fluid-dreams-theme');
        if (!container) {
            console.error('💧 Fluid Dreams: Container not found');
            return;
        }
        container.innerHTML = '';

        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady || !this.renderer || !this.isActive) return;

        // Scene + camera (shared between WebGPU and WebGL paths)
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0A0418); // very dark base behind everything

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(this.cameraLook);

        // Build scene contents
        this.initMetaballState();
        this.createBackground();
        this.createHaze();
        this.createHero();
        this.createParticles();
        this.setupPostProcessing();

        // Events
        this.setupEventListeners();
        this.cameraParallax.attach();
        window.addEventListener('resize', this.onWindowResize);

        // Warm the render pipelines before the loop starts. Without this every pipeline is
        // created synchronously at first draw, after this promise has already told the app the
        // switch is done: 3,398 ms of the measured 3,807 ms first frame, 0 async / 14 sync.
        await this.warmPipelines();
        if (ownerGeneration !== this.lifecycleGeneration) return;

        this.clock.start();
        this.animate();

        console.log(`💧 Fluid Dreams: scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL'}) — ${this.activePreset.metaballCount} metaballs, ${this.activePreset.particleCount} particles`);
    }

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const antialias = this.getAntialiasEnabled();
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        // Try WebGPU first.
        let webgpuRenderer = null;
        let renderer = null;
        try {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                antialias,
                powerPreference: 'high-performance',
                alpha: false,
                forceWebGL: false,
            });
            await this.initializeRendererCandidate(webgpuRenderer, {
                label: 'Fluid Dreams WebGPU renderer init',
                ownerGeneration,
            });
        } catch (error) {
            if (!ownsLifecycle()) return false;
            console.warn('💧 Fluid Dreams: WebGPU init failed, falling back to WebGL2:', error);
            webgpuRenderer = null;
        }

        if (webgpuRenderer?.backend?.isWebGPUBackend === true) {
            renderer = webgpuRenderer;
            this.isWebGPU = true;
            this.isWebGL = false;
        } else {
            if (webgpuRenderer) {
                try { webgpuRenderer.dispose(); } catch (e) { /* noop */ }
            }
            if (!ownsLifecycle()) return false;
            renderer = new THREE.WebGLRenderer({
                alpha: false,
                antialias,
                powerPreference: 'high-performance',
            });
            this.isWebGPU = false;
            this.isWebGL = true;
        }

        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (this.isWebGL) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.1;
        }
        container.appendChild(this.renderer.domElement);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Metaball state
    // ─────────────────────────────────────────────────────────────────────────

    initMetaballState() {
        this.metaballState = [];
        const count = this.activePreset.metaballCount;
        for (let i = 0; i < count; i += 1) {
            const phase = (i / count) * Math.PI * 2;
            // Tighter orbits keep the hero a compact cluster instead of a spread mass —
            // so it stays inside the left-third "free zone" of the gameplay viewport
            // and never drifts behind the game board.
            const orbitRadius = 3.0 + Math.random() * 2.0;
            const verticalAmp = 1.0 + Math.random() * 1.6;
            const orbitSpeed = 0.18 + Math.random() * 0.22;
            const radius = 3.0 + Math.random() * 1.4;
            const noiseSeed = Math.random() * 100;
            this.metaballState.push({
                phase,
                orbitRadius,
                verticalAmp,
                verticalPhase: Math.random() * Math.PI * 2,
                orbitSpeed,
                radius,
                noiseSeed,
                pos: new THREE.Vector3(),
            });
        }
    }

    updateMetaballState(elapsed) {
        for (let i = 0; i < this.metaballState.length; i += 1) {
            const m = this.metaballState[i];
            const t = elapsed * m.orbitSpeed + m.phase;
            // Slow figure-8 / lazy ellipse around origin with a vertical sine wave.
            const x = Math.cos(t) * m.orbitRadius + Math.sin(t * 0.7) * 1.5;
            const z = Math.sin(t * 0.9) * m.orbitRadius * 0.7;
            const y = Math.sin(t * 0.6 + m.verticalPhase) * m.verticalAmp
                + Math.sin(elapsed * 0.2 + m.noiseSeed) * 0.8;
            m.pos.set(x, y, z);
        }
    }

    pushMetaballsToHero() {
        if (!this.heroMaterial?.userData?.metaballs) return;
        const arr = this.heroMaterial.userData.metaballs;
        const state = this.metaballState;
        const n = Math.min(arr.length, state.length);
        for (let i = 0; i < n; i += 1) {
            const u = arr[i];
            const m = state[i];
            u.value.set(m.pos.x, m.pos.y, m.pos.z, m.radius);
        }
        // Idle metaballs (when preset is smaller than material capacity) pushed off-screen.
        for (let i = n; i < arr.length; i += 1) {
            arr[i].value.set(0, 1000, 0, 0.01);
        }
    }

    pushMetaballsToFallbackOrbs() {
        if (!this.fallbackOrbs?.length) return;
        const n = Math.min(this.fallbackOrbs.length, this.metaballState.length);
        for (let i = 0; i < n; i += 1) {
            const orb = this.fallbackOrbs[i];
            const m = this.metaballState[i];
            orb.position.set(m.pos.x, m.pos.y, m.pos.z);
            orb.scale.setScalar(m.radius);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene element factories
    // ─────────────────────────────────────────────────────────────────────────

    createBackground() {
        if (this.isWebGPU) {
            const geometry = new THREE.SphereGeometry(180, 32, 24);
            const material = createBackgroundNodeMaterial();
            this.backgroundMaterial = material;
            this.backgroundMesh = new THREE.Mesh(geometry, material);
            this.backgroundMesh.renderOrder = -10;
            this.scene.add(this.backgroundMesh);
        } else {
            const geometry = new THREE.SphereGeometry(180, 32, 24);
            this.backgroundMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColorTop: { value: new THREE.Color(0x120538) },
                    uColorMid: { value: new THREE.Color(0x2E0F58) },
                    uColorBottom: { value: new THREE.Color(0x69299E) },
                },
                vertexShader: backgroundVertexShader,
                fragmentShader: backgroundFragmentShader,
                side: THREE.BackSide,
                depthWrite: false,
                fog: false,
            });
            this.backgroundMesh = new THREE.Mesh(geometry, this.backgroundMaterial);
            this.backgroundMesh.renderOrder = -10;
            this.scene.add(this.backgroundMesh);
        }
    }

    createHaze() {
        if (!this.isWebGPU) {
            // Skip volumetric haze on WebGL fallback — it would be too expensive without compute.
            return;
        }
        if (this.activePreset.bgHazeSteps <= 0) return;

        const [segW, segH] = this.activePreset.hazeSegments ?? [16, 12];
        // Tighter bounds keep the volumetric raymarch over fewer fragments.
        const geometry = new THREE.SphereGeometry(50, segW, segH);
        const material = createVolumetricHazeNodeMaterial({
            steps: this.activePreset.bgHazeSteps,
            density: 0.14,
        });
        this.hazeMaterial = material;
        this.hazeMesh = new THREE.Mesh(geometry, material);
        this.hazeMesh.renderOrder = -5;
        this.scene.add(this.hazeMesh);
    }

    createHero() {
        if (this.isWebGPU) {
            const material = createFluidHeroNodeMaterial({
                marchSteps: this.activePreset.marchSteps,
                metaballCount: this.activePreset.metaballCount,
                maxDist: 70,
                // Intensity dropped from 1.15 → 0.85 so the hero body sits below the
                // bloom threshold; only Fresnel/rim emissive pops blooming.
                intensity: 0.85,
                smoothK: 1.0,
                // Tighter orbit (max ~5 + ~4.4 metaball radius ≈ 9.5) → bounding
                // sphere can shrink to 12, which cuts wasted ray-march steps further.
                boundsRadius: 12,
            });
            this.heroMaterial = material;

            // Render the raymarched fluid inside a bounding box around the origin.
            // BackSide + a box wider than the camera dolly range keeps fragments
            // produced for every screen pixel that could see the hero.
            const geometry = new THREE.BoxGeometry(60, 60, 60);
            this.heroMesh = new THREE.Mesh(geometry, material);
            this.heroMesh.frustumCulled = false;
            this.heroMesh.renderOrder = 1;
            this.scene.add(this.heroMesh);
        } else {
            // WebGL fallback: render N MeshPhysicalMaterial glass orbs as "metaballs".
            this.fallbackOrbs = [];
            const count = this.activePreset.metaballCount;
            const sphereGeometry = new THREE.IcosahedronGeometry(1.0, 3);
            const palette = [
                ELECTRIC_PALETTE.neonPink,
                ELECTRIC_PALETTE.electricViolet,
                ELECTRIC_PALETTE.electricCyan,
                ELECTRIC_PALETTE.warmGold,
            ];
            for (let i = 0; i < count; i += 1) {
                const tint = palette[i % palette.length];
                const material = new THREE.MeshPhysicalMaterial({
                    color: new THREE.Color(tint.x, tint.y, tint.z),
                    transmission: 0.85,
                    roughness: 0.08,
                    metalness: 0.0,
                    ior: 1.42,
                    iridescence: 0.7,
                    iridescenceIOR: 1.3,
                    iridescenceThicknessRange: [120, 720],
                    emissive: new THREE.Color(tint.x, tint.y, tint.z),
                    emissiveIntensity: 0.4,
                    transparent: true,
                    opacity: 0.92,
                });
                const orb = new THREE.Mesh(sphereGeometry, material);
                orb.renderOrder = 1;
                this.scene.add(orb);
                this.fallbackOrbs.push(orb);
            }

            // Hero is conceptually the group of orbs in fallback mode.
            this.heroMesh = null;
            this.heroMaterial = null;
            // Cheap fill light so MeshPhysicalMaterial has something to react to.
            this._fallbackLights = [];
            const ambient = new THREE.AmbientLight(0x1A0532, 0.4);
            this.scene.add(ambient);
            this._fallbackLights.push(ambient);
            for (let i = 0; i < 3; i += 1) {
                const lightColor = palette[i % palette.length];
                const light = new THREE.PointLight(
                    new THREE.Color(lightColor.x, lightColor.y, lightColor.z),
                    1.8,
                    60,
                );
                const angle = (i / 3) * Math.PI * 2;
                light.position.set(Math.cos(angle) * 18, 6, Math.sin(angle) * 18);
                this.scene.add(light);
                this._fallbackLights.push(light);
            }
        }
    }

    createParticles() {
        const count = this.activePreset.particleCount;

        if (this.isWebGPU) {
            this.particleCompute = new FluidDreamsParticleCompute(count, {
                boundsRadius: 55.0,
                spawnInner: 12.0,
                spawnOuter: 48.0,
                flowStrength: 1.6,
                damping: 0.93,
            });
            this.particleCompute.createComputeNode();

            this.particleMaterial = createFluidParticleNodeMaterial({
                isWebGPU: true,
                particleCompute: this.particleCompute,
            });

            const geometry = new THREE.PlaneGeometry(1, 1);
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60);

            this.particleSystem = new THREE.InstancedMesh(geometry, this.particleMaterial, count);
            this.particleSystem.frustumCulled = false;
            this.particleSystem.renderOrder = 2;
            this.scene.add(this.particleSystem);
        } else {
            // WebGL fallback: simple animated point cloud (CPU-light, vertex-shader-driven).
            const reduced = Math.min(count, 4000); // hard-cap for WebGL fallback
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(reduced * 3);
            const colors = new Float32Array(reduced * 3);
            const phases = new Float32Array(reduced);
            const sizes = new Float32Array(reduced);

            const palette = [
                ELECTRIC_PALETTE.neonPink,
                ELECTRIC_PALETTE.electricViolet,
                ELECTRIC_PALETTE.electricCyan,
                ELECTRIC_PALETTE.warmGold,
            ];
            for (let i = 0; i < reduced; i += 1) {
                const u = Math.random();
                const v = Math.random();
                const theta = u * Math.PI * 2;
                const phi = Math.acos(2 * v - 1);
                const r = 12 + Math.random() * 35;
                const sinPhi = Math.sin(phi);
                positions[i * 3] = r * sinPhi * Math.cos(theta);
                positions[i * 3 + 1] = r * sinPhi * Math.sin(theta);
                positions[i * 3 + 2] = r * Math.cos(phi);

                const tint = palette[Math.floor(Math.random() * palette.length)];
                colors[i * 3] = tint.x;
                colors[i * 3 + 1] = tint.y;
                colors[i * 3 + 2] = tint.z;

                phases[i] = Math.random() * Math.PI * 2;
                sizes[i] = 1.5 + Math.random() * 3.0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

            this.particleMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: fallbackParticleVertexShader,
                fragmentShader: fallbackParticleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            this.particleSystem = new THREE.Points(geometry, this.particleMaterial);
            this.particleSystem.frustumCulled = false;
            this.particleSystem.renderOrder = 2;
            this.scene.add(this.particleSystem);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (this.isWebGPU) {
            this.post = new FluidDreamsPost(this.renderer, this.scene, this.camera, {
                bloomStrength: this.activePreset.bloomStrength,
                bloomRadius: this.activePreset.bloomRadius,
                // Higher threshold = only rim/highlight hotspots bloom, not the whole fluid body.
                // This preserves the iridescent palette inside the hero instead of blowing it to white.
                bloomThreshold: 0.55,
                bloomDownsample: this.activePreset.bloomDownsample,
                chromaticStrength: this.activePreset.enableChromaticAberration ? 0.0018 : 0.0,
                exposure: 1.0,
                contrast: 1.06,
                saturation: 1.15,
                tintStrength: 0.12,
                grainStrength: 0.015,
                useMRT: true,
            });
            this.post.setSize(window.innerWidth, window.innerHeight);
        } else {
            this.composer = new EffectComposer(this.renderer);
            const renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);

            if (this.activePreset.enableBloom) {
                this.bloomPass = new UnrealBloomPass(
                    new THREE.Vector2(window.innerWidth, window.innerHeight),
                    this.activePreset.bloomStrength,
                    this.activePreset.bloomRadius,
                    0.45,
                );
                this.bloomPass.enabled = true;
                this.composer.addPass(this.bloomPass);
            }
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    /**
     * Compile every render pipeline the scene needs BEFORE the first visible frame.
     *
     * In three 0.185.1 `Renderer.compileAsync` is the only path that reaches
     * `device.createRenderPipelineAsync`. Every other path creates pipelines synchronously, on
     * the GPU, at first draw — which for this theme is the 52-step raymarched hero. The compile is
     * bound to the post scene-pass target so the pipelines warmed here carry the MRT/HalfFloat
     * attachment formats the live frame actually renders into.
     */
    async warmPipelines() {
        if (!this.renderer?.compileAsync || !this.scene || !this.camera) return;
        const scenePass = this.post?.scenePass ?? null;
        try {
            if (scenePass?.renderTarget) {
                // `PassNode.setup()` runs on the first `postProcessing.render()`, which has not
                // happened yet, so the target still carries RenderTarget defaults while the live
                // pass will take `renderer.samples`. The WebGPU pipeline cache key hashes sample
                // count, so warming against the wrong one produces pipelines that all miss on the
                // first live frame. Mirrors PassNode.js:766-768.
                scenePass.renderTarget.samples = this.renderer.samples;
                scenePass.renderTarget.texture.type = this.renderer.getOutputBufferType();
                await compileGroupThroughPost(
                    this.renderer,
                    this.post,
                    this.scene,
                    this.camera,
                    this.scene,
                    false,
                );
            } else {
                // The WebGL fallback renders through EffectComposer, not a PassNode, so an
                // unbound compile is the correct binding rather than a missing one.
                await this.renderer.compileAsync(this.scene, this.camera);
            }
        } catch (error) {
            console.warn('[FluidDreams] Pipeline precompile was incomplete:', error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event listeners — combo / line clear
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (settings?.backgroundComboEffects === false) return;
            this.onLineClear(data?.lineCount ?? 1);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (settings?.backgroundComboEffects === false) return;
            this.onCombo(data?.comboCount ?? 1);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (!this.isActive) return;
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (settings?.backgroundComboEffects === false) return;
            this.onPieceLock(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gameplay reactive effects
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Design language for Fluid Dreams:
    //   PIECE_LOCK  → soft breath through the fluid (frequent, subtle).
    //   LINE_CLEAR  → palette wash + particle colour bath (per-clear celebration).
    //   COMBO       → building hum: ambient glow, faster palette cycle, particle
    //                 inward swirl. Tension that releases on combo break.
    //   4-line/Tetris → climax: palette inversion + shockwave + flash.
    //
    // All impulses are ADDITIVE momentum (per the black-hole pattern) so rapid
    // events stack rather than reset. Each impulse decays exponentially.

    onPieceLock() {
        // Cheap, frequent. Small breath, tiny iridescent nudge, brief particle puff.
        this.lockImpulse = Math.min(2.0, this.lockImpulse + 0.7);
        this.targetHeroPulse = Math.min(1.2, this.targetHeroPulse + 0.18);
        this.targetIridescenceShift = Math.min(0.6, this.targetIridescenceShift + 0.03);
        this.targetVelocityBoost = Math.min(2.5, this.targetVelocityBoost + 0.2);
    }

    onLineClear(lineCount) {
        const safe = Math.max(1, Math.min(4, lineCount));

        this.lineFlash = Math.min(3.0, this.lineFlash + safe * 0.55);
        this.targetIridescenceShift = Math.min(1.2, this.targetIridescenceShift + safe * 0.1);
        this.targetVelocityBoost = Math.min(3.5, this.targetVelocityBoost + safe * 0.45);
        this.targetHeroPulse = Math.min(1.8, this.targetHeroPulse + safe * 0.22);
        // Visible palette rotation through the 5 stops.
        this.paletteCyclePhase = (this.paletteCyclePhase + safe * 0.16) % 1.0;

        // Particle colour wash — tint by clear count (1=cyan ... 4=gold).
        this.particleColorTarget.copy(this._lineClearTints[safe - 1]);
        this.targetParticleColorMix = Math.min(0.85, this.targetParticleColorMix + 0.35 + safe * 0.08);

        // Triple+ : send a shockwave through a random metaball.
        if (safe >= 3 && this.shockwaveProgress < 0) {
            const m = this.metaballState[Math.floor(Math.random() * this.metaballState.length)];
            this.triggerShockwave(m?.pos ?? { x: 0, y: 0, z: 0 });
        }
        // Tetris signature flash — palette inversion + chromatic/bloom spike.
        if (safe === 4) {
            this.tetrisFlash = Math.max(this.tetrisFlash, 2.0);
        }
    }

    onCombo(comboCount) {
        const cap = Math.max(1, Math.min(15, comboCount));

        // comboHum builds with sustained combos and decays slowly. Drives ambient
        // intensification of the whole scene.
        this.comboHum = Math.min(2.5, this.comboHum + 0.2 + cap * 0.15);
        this.targetVelocityBoost = Math.min(3.5, this.targetVelocityBoost + cap * 0.22);

        if (cap >= COMBO_THRESHOLD_FOR_SHOCKWAVE && this.shockwaveProgress < 0) {
            const m = this.metaballState[Math.floor(Math.random() * this.metaballState.length)];
            this.triggerShockwave(m?.pos ?? { x: 0, y: 0, z: 0 });
        }
    }

    triggerShockwave(origin) {
        this.shockwaveProgress = 0;
        this.shockwaveOrigin.set(origin.x ?? 0, origin.y ?? 0, origin.z ?? 0);
        if (this.heroMaterial?.userData?.uShockwaveOrigin) {
            this.heroMaterial.userData.uShockwaveOrigin.value.copy(this.shockwaveOrigin);
        }
    }

    updateShockwave(delta) {
        if (this.shockwaveProgress < 0) {
            if (this.heroMaterial?.userData?.uShockwaveStrength) {
                this.heroMaterial.userData.uShockwaveStrength.value = 0;
                this.heroMaterial.userData.uShockwaveRadius.value = 0;
            }
            return;
        }
        this.shockwaveProgress += delta;
        const t = Math.min(1, this.shockwaveProgress / this.shockwaveDuration);
        const eased = 1 - (1 - t) ** 2.5;
        const radius = eased * SHOCKWAVE_MAX_RADIUS;
        const strength = (1 - t) * 1.2;
        if (this.heroMaterial?.userData?.uShockwaveStrength) {
            this.heroMaterial.userData.uShockwaveStrength.value = strength;
            this.heroMaterial.userData.uShockwaveRadius.value = radius;
        }
        if (t >= 1) {
            this.shockwaveProgress = -1;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dynamic resolution scaling — keep frametime stable
    // ─────────────────────────────────────────────────────────────────────────

    getEffectivePixelRatioWithDRS() {
        const base = this.getEffectivePixelRatio();
        const scale = this.drs.enabled ? this.drs.scale : 1.0;
        return Math.max(0.25, Math.round(base * scale * 100) / 100);
    }

    applyDRSPixelRatio() {
        if (!this.renderer) return;
        const target = this.getEffectivePixelRatioWithDRS();
        const current = this.renderer.getPixelRatio();
        if (Math.abs(current - target) < 0.005) return;
        this.renderer.setPixelRatio(target);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.post) this.post.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    updateDRS(delta) {
        const { drs } = this;
        if (!drs.enabled) return;

        const frameMs = delta * 1000;
        // EMA over ~12 frames for faster reaction than the 31-frame global monitor.
        drs.emaMs = drs.emaMs * 0.88 + frameMs * 0.12;

        // Emergency: if we see 10 hard-slow frames (>22ms = below 45fps) in a
        // row, downscale immediately instead of waiting for the next interval.
        // This catches sustained drops before PerformanceMonitor (31 frames) fires.
        if (frameMs > 22.0) {
            drs.consecutiveSlow += 1;
            if (drs.consecutiveSlow >= 10 && drs.scale > drs.minScale) {
                drs.scale = Math.max(drs.minScale, drs.scale - 0.1);
                drs.consecutiveSlow = 0;
                drs.elapsed = 0;
                this.applyDRSPixelRatio();
                return;
            }
        } else {
            drs.consecutiveSlow = 0;
        }

        drs.elapsed += delta;
        if (drs.elapsed < drs.adjustInterval) return;
        drs.elapsed = 0;

        let newScale = drs.scale;
        if (drs.emaMs > drs.targetMs * 1.15) {
            newScale = Math.max(drs.minScale, drs.scale - 0.08);
        } else if (drs.emaMs < drs.targetMs * 0.85) {
            newScale = Math.min(drs.maxScale, drs.scale + 0.04);
        }

        if (Math.abs(newScale - drs.scale) >= 0.01) {
            drs.scale = newScale;
            this.applyDRSPixelRatio();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;
        this.animationFrame = requestAnimationFrame(() => this.animate());

        const elapsed = this.clock.getElapsedTime();
        const delta = Math.min(0.05, this.clock.getDelta());
        this.frameCount += 1;
        this.updateDRS(delta);

        // Decay combo / impulse state. Each impulse has its own time constant —
        // small frequent events (locks) decay quickly so they punctuate without
        // bleeding into each other; sustained tension (comboHum) decays slowly.
        // exp(-delta/tau) is frame-rate independent.
        this.iridescenceShift += (this.targetIridescenceShift - this.iridescenceShift) * Math.min(1, delta * 6);
        this.targetIridescenceShift *= Math.exp(-delta / 1.4);
        this.velocityBoost += (this.targetVelocityBoost - this.velocityBoost) * Math.min(1, delta * 8);
        this.targetVelocityBoost *= Math.exp(-delta / 0.9);
        this.lockImpulse *= Math.exp(-delta / 0.3);
        this.lineFlash *= Math.exp(-delta / 0.7);
        this.tetrisFlash *= Math.exp(-delta / 1.2);
        this.comboHum *= Math.exp(-delta / 3.5);
        this.heroPulse += (this.targetHeroPulse - this.heroPulse) * Math.min(1, delta * 9);
        this.targetHeroPulse *= Math.exp(-delta / 0.45);
        this.particleColorMix += (this.targetParticleColorMix - this.particleColorMix) * Math.min(1, delta * 5);
        this.targetParticleColorMix *= Math.exp(-delta / 0.8);
        // Palette cycle drifts slowly at rest, accelerates with combo hum.
        this.paletteCyclePhase = (this.paletteCyclePhase + delta * (0.02 + this.comboHum * 0.18)) % 1.0;

        // Aggregate values that feed into uniforms.
        const heroPulseTotal = this.heroPulse
            + this.lineFlash * 0.35
            + this.tetrisFlash * 0.6
            + this.lockImpulse * 0.12;
        const iridescenceTotal = this.iridescenceShift
            + this.paletteCyclePhase
            + this.lineFlash * 0.18
            + this.comboHum * 0.14;
        const velocityTotal = this.velocityBoost
            + this.lineFlash * 0.6
            + this.lockImpulse * 0.35
            + this.comboHum * 0.45;
        const ambientGlowTotal = this.comboHum * 0.7 + this.tetrisFlash * 0.4;

        // Advect metaballs CPU-side, then push to GPU/uniform/object positions.
        this.updateMetaballState(elapsed);
        this.updateShockwave(delta);

        if (this.isWebGPU) {
            this.pushMetaballsToHero();

            // Push hero uniforms.
            if (this.heroMaterial?.userData) {
                const ud = this.heroMaterial.userData;
                ud.uTime.value = elapsed;
                ud.uIridescenceShift.value = iridescenceTotal;
                ud.uHeroPulse.value = heroPulseTotal;
                ud.uHeroPaletteInvert.value = Math.min(1.0, this.tetrisFlash * 0.65);
                ud.uHeroAmbientGlow.value = ambientGlowTotal;
            }
            if (this.backgroundMaterial?.userData) {
                this.backgroundMaterial.userData.uTime.value = elapsed;
                this.backgroundMaterial.userData.uPulse.value = this.comboHum * 0.4 + this.tetrisFlash * 0.3;
            }
            if (this.hazeMaterial?.userData) {
                this.hazeMaterial.userData.uTime.value = elapsed;
                this.hazeMaterial.userData.uPulse.value = velocityTotal * 0.25 + this.comboHum * 0.3;
            }
            // Particle material colour wash uniforms.
            if (this.particleMaterial?.userData?.uColorOverride) {
                const pud = this.particleMaterial.userData;
                pud.uColorOverride.value.set(
                    this.particleColorTarget.r,
                    this.particleColorTarget.g,
                    this.particleColorTarget.b,
                );
                pud.uColorOverrideMix.value = this.particleColorMix;
                pud.uBrightnessBoost.value = this.comboHum * 0.6 + this.lineFlash * 0.35;
            }
            // Particle compute — velocity + combo attract.
            if (this.particleCompute) {
                // Attract centre tracks the hero cluster centre (origin, slightly raised
                // toward the camera so the swirl reads on screen).
                this._attractCenter.set(0, 0.5, 4);
                this.particleCompute.update(delta, {
                    time: elapsed,
                    velocityBoost: velocityTotal,
                    attractCenter: this._attractCenter,
                    attractStrength: this.comboHum * 1.4,
                });
            }
        } else {
            this.pushMetaballsToFallbackOrbs();
            if (this.backgroundMaterial?.uniforms?.uTime) {
                this.backgroundMaterial.uniforms.uTime.value = elapsed;
            }
            if (this.particleMaterial?.uniforms?.uTime) {
                this.particleMaterial.uniforms.uTime.value = elapsed;
            }
            // Subtle iridescent pulse on fallback orbs.
            const baseEmissive = 0.45 + this.iridescenceShift * 0.5;
            for (let i = 0; i < this.fallbackOrbs.length; i += 1) {
                const orb = this.fallbackOrbs[i];
                orb.rotation.y += delta * 0.15;
                orb.rotation.x += delta * 0.09;
                if (orb.material?.emissiveIntensity !== undefined) {
                    orb.material.emissiveIntensity = baseEmissive;
                }
                if (orb.material?.iridescenceThicknessRange) {
                    const shift = Math.sin(elapsed * 0.6 + i) * 60 + this.iridescenceShift * 200;
                    orb.material.iridescenceThicknessRange = [120 + shift, 720 + shift];
                }
            }
        }

        // Establish the autonomous base pose first. IntroCameraParallax then adds
        // Serenity Warp's cursor orbit as the final camera operation.
        const dollyZ = Math.sin(elapsed * (2 * Math.PI / 8)) * 2.5;
        const yawAngle = Math.sin(elapsed * (2 * Math.PI / 14)) * (Math.PI / 30);
        const baseX = this.baseCameraPos.x;
        const baseZ = this.baseCameraPos.z + dollyZ;
        const idleCameraX = baseX * Math.cos(yawAngle) + baseZ * Math.sin(yawAngle);
        const idleCameraY = this.baseCameraPos.y + Math.sin(elapsed * 0.3) * 0.6;
        const idleCameraZ = -baseX * Math.sin(yawAngle) + baseZ * Math.cos(yawAngle);
        this.camera.position.set(idleCameraX, idleCameraY, idleCameraZ);
        this.cameraParallax.apply(this.camera, delta, this.cameraLook);

        // Counter-shift the particle volume against the camera to make nearby motes
        // separate from the distant fluid field. The small offset preserves the
        // gameplay composition while giving cursor movement a tangible depth cue.
        if (this.particleSystem) {
            this.particleSystem.position.x = -(this.camera.position.x - idleCameraX) * 0.16;
            this.particleSystem.position.y = -(this.camera.position.y - idleCameraY) * 0.12;
        }

        // Render
        this.renderFrame(elapsed);
    }

    renderFrame(elapsed) {
        if (this.isWebGPU) {
            // Throttle compute dispatch on low quality presets — most users won't
            // see the difference, and it cuts the per-frame GPU work meaningfully.
            const stride = Math.max(1, this.activePreset.computeStride ?? 1);
            if (this.particleCompute?.computeNode && (this.frameCount % stride) === 0) {
                this.renderer.compute(this.particleCompute.computeNode);
            }
            if (this.post) {
                // Post effects ride on top of the base preset values. Bloom + chromatic
                // intensify with combo hum and spike on tetris flash; everything decays
                // back to baseline within ~3 seconds of the last event.
                const baseBloom = this.activePreset.bloomStrength;
                const baseChroma = this.activePreset.enableChromaticAberration ? 0.0018 : 0.0;
                this.post.update({
                    time: elapsed,
                    bloomStrength: baseBloom
                        + this.comboHum * 0.12
                        + this.lineFlash * 0.08
                        + this.tetrisFlash * 0.22,
                    chromaticStrength: baseChroma
                        + this.comboHum * 0.0014
                        + this.tetrisFlash * 0.0026,
                    tintStrength: 0.12 + this.tetrisFlash * 0.25,
                    saturation: 1.15 + this.comboHum * 0.06,
                });
                this.post.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        } else if (this.composer && this.activePreset.enableBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        // Respect current DRS scale on resize.
        this.renderer.setPixelRatio(this.getEffectivePixelRatioWithDRS());
        this.renderer.setSize(w, h);

        if (this.post) this.post.setSize(w, h);
        if (this.composer) this.composer.setSize(w, h);
        if (this.bloomPass) this.bloomPass.resolution.set(w, h);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Disposal
    // ─────────────────────────────────────────────────────────────────────────

    disposeHero() {
        if (this.heroMesh) {
            this.heroMesh.geometry?.dispose();
            this.scene?.remove(this.heroMesh);
            this.heroMesh = null;
        }
        if (this.heroMaterial?.dispose) {
            try { this.heroMaterial.dispose(); } catch (e) { /* noop */ }
        }
        this.heroMaterial = null;

        if (this.fallbackOrbs?.length) {
            this.fallbackOrbs.forEach((orb) => {
                orb.geometry?.dispose?.();
                orb.material?.dispose?.();
                this.scene?.remove(orb);
            });
            this.fallbackOrbs = [];
        }
        if (this._fallbackLights?.length) {
            this._fallbackLights.forEach((light) => this.scene?.remove(light));
            this._fallbackLights = [];
        }
    }

    disposeHaze() {
        if (this.hazeMesh) {
            this.hazeMesh.geometry?.dispose();
            this.scene?.remove(this.hazeMesh);
            this.hazeMesh = null;
        }
        if (this.hazeMaterial?.dispose) {
            try { this.hazeMaterial.dispose(); } catch (e) { /* noop */ }
        }
        this.hazeMaterial = null;
    }

    disposeParticles() {
        if (this.particleSystem) {
            this.particleSystem.geometry?.dispose();
            this.scene?.remove(this.particleSystem);
            this.particleSystem = null;
        }
        if (this.particleMaterial?.dispose) {
            try { this.particleMaterial.dispose(); } catch (e) { /* noop */ }
        }
        this.particleMaterial = null;
        if (this.particleCompute?.dispose) {
            try { this.particleCompute.dispose(); } catch (e) { /* noop */ }
        }
        this.particleCompute = null;
    }

    stop() {
        console.log('💧 Fluid Dreams: Stopping...');

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.eventUnsubscribers.forEach((unsub) => {
            try { unsub?.(); } catch (e) { /* noop */ }
        });
        this.eventUnsubscribers = [];
        this.cameraParallax.detach();

        this.teardownQualityListener();
        window.removeEventListener('resize', this.onWindowResize);

        this.disposeHero();
        this.disposeHaze();
        this.disposeParticles();

        if (this.backgroundMesh) {
            this.backgroundMesh.geometry?.dispose();
            try { this.backgroundMaterial?.dispose?.(); } catch (e) { /* noop */ }
            this.scene?.remove(this.backgroundMesh);
            this.backgroundMesh = null;
            this.backgroundMaterial = null;
        }

        if (this.post) {
            try { this.post.dispose(); } catch (e) { /* noop */ }
            this.post = null;
        }
        if (this.composer) {
            try { this.composer.dispose?.(); } catch (e) { /* noop */ }
            this.composer = null;
        }
        if (this.bloomPass) {
            try { this.bloomPass.dispose?.(); } catch (e) { /* noop */ }
            this.bloomPass = null;
        }

        if (this.scene) {
            this.scene.clear?.();
            this.scene = null;
        }
        if (this.renderer) {
            try { this.renderer.dispose?.(); } catch (e) { /* noop */ }
            try {
                if (this.renderer.domElement?.parentNode) {
                    this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
                }
            } catch (e) { /* noop */ }
            this.renderer = null;
        }

        this.camera = null;
        this.clock = new THREE.Clock();
        this.isWebGPU = false;
        this.isWebGL = false;
        this.metaballState = [];

        super.stop();
        console.log('💧 Fluid Dreams: Stopped.');
    }
}
