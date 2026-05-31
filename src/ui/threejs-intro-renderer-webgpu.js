/**
 * Three.js Intro Renderer - WebGPU Version
 * Renders the 3D intro animation using WebGPU renderer + TSL compute shaders.
 * All particle simulation and tetromino physics run on the GPU.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cos,
    dot,
    float,
    fract,
    instanceIndex,
    length,
    mix,
    pass,
    positionLocal,
    sin,
    smoothstep,
    storage,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { IntroParticleCompute } from './intro-particle-compute.js';
import { IntroTetrominoCompute } from './intro-tetromino-compute.js';
import { INTRO_PHASES, getIntroVisualProfile, getQualityBudget } from './intro-visual-config.js';
import { IntroCameraParallax } from './intro-camera-parallax.js';
import { createIntroNebulaSky } from './intro-nebula-sky.js';

const SHAPE_KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Camera idle-drift amplitudes — must match the values used in update(). Combined
// with the pointer-parallax orbit amplitudes they bound how far the visible frame
// can travel, so tetrominos spawn beyond that envelope and always drift in from
// off-screen instead of popping into view.
const CAMERA_IDLE_AMP_X = 5;
const CAMERA_IDLE_AMP_Y = 3;
// A tetromino's approximate half-extent (max block offset ~3 + block radius ~1).
const TETROMINO_RADIUS = 4;
// Extra clearance beyond the reveal envelope so the whole piece starts off-screen.
const SPAWN_CLEARANCE = 6;
// Minimum inward drift so pieces cross the larger off-screen margin in a few seconds.
const SPAWN_INWARD_DRIFT = 0.05;
const {
    AdditiveBlending,
    DoubleSide,
    LineBasicNodeMaterial,
    MeshBasicNodeMaterial,
    MeshStandardNodeMaterial,
} = THREE;

function isWindowsPlatform() {
    if (typeof navigator === 'undefined') return false;
    return /Windows/i.test(navigator.userAgent || '');
}

export default class ThreeJSIntroRendererWebGPU {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.postProcessing = null;
        this.envMap = null;

        this.particleCompute = null;
        this.tetrominoCompute = null;

        this.particleMesh = null;
        this.nebulaClouds = [];
        this.nebulaSky = null; // Phase A1: volumetric nebula backdrop
        this.volumetricNebula = null;
        this.constellationMesh = null;
        this.tetrominoInstances = {};
        this.enableVolumetricNebula = false;
        this.enableConstellationLines = false;
        this.titleGlowEnabled = true;

        this.visualProfileId = 'cinematic_clean';
        this.visualProfile = getIntroVisualProfile(this.visualProfileId);
        this.performanceLevel = 'HIGH';

        this.clock = new THREE.Clock();
        this.lastSpawnTime = 0;
        this.spawnAccumulator = 0;

        // Pointer-driven camera parallax (cursor arcs the camera around the scene).
        this.cameraParallax = new IntroCameraParallax();
        this.simulationTime = 0;
        this.nextHeroInhaleTime = 0;
        this.heroInhaleReleaseAt = 0;

        this.quality = getQualityBudget(this.visualProfile, this.performanceLevel);
        this.frameTimes = [];
        this.lastQualityCheck = 0;
        this.dynamicQualityEnabled = false;
        this.computeFrameCounter = 0;
        this.spawnInterval = this.quality.spawnInterval;

        this.isBackgroundMode = false;
        this.audioPulse = 0;
        this.warpStartTime = -1;
        this.warpDuration = 1.2;
        this.phase = INTRO_PHASES.BOOT;
        this.phaseState = null;
        this.phaseTargetState = null;
        this.phaseTransition = null;

        this.uTime = uniform(0);
        this.uBloomStrength = uniform(this.quality.bloomStrength);
        this.uGodRayStrength = uniform(this.quality.godRays);
        this.uDoFStrength = uniform(this.quality.dof);
        this.uFringeStrength = uniform(this.quality.fringe);
        this.uAudioPulse = uniform(0);
        this.uWarp = uniform(0);
        this.uTitleGlowStrength = uniform(0.24);
        this.uTitleGlowCenter = uniform(new THREE.Vector2(0.5, 0.43));
        this.uTitleGlowSize = uniform(new THREE.Vector2(0.38, 0.13));

        // Phase B — cinematic grade uniforms (luma-preserving saturation, gentle
        // contrast, real chromatic aberration, multiply vignette).
        this.uSaturation = uniform(this.visualProfile?.post?.saturation ?? 1.16);
        this.uContrast = uniform(this.visualProfile?.post?.contrast ?? 1.10);
        this.uChromaticStrength = uniform(this.visualProfile?.post?.chromatic ?? 0.0022);
        this.uVignetteDarkness = uniform(this.visualProfile?.post?.vignetteDarkness ?? 0.42);
        // Exposure feeds the manual ACES tonemap in the post graph (the renderer
        // itself uses NoToneMapping, so toneMappingExposure no longer applies).
        this.uExposure = uniform(this.visualProfile?.post?.baseExposure ?? 1.13);

        this.COLORS = {
            I: 0x00ff00,
            O: 0xff9900,
            T: 0x0000ff,
            S: 0x00ffff,
            Z: 0xff0000,
            J: 0xffff00,
            L: 0xcc00cc,
        };

        this.phaseState = this.getPhasePreset(INTRO_PHASES.BOOT);
        this.phaseTargetState = { ...this.phaseState };
        this.scheduleNextHeroInhale();
    }

    async init() {
        if (!this.canvas) return false;

        try {
            this.detectInitialQuality();

            const webgpuOptions = {
                canvas: this.canvas,
                alpha: true,
                antialias: true,
            };
            // Chromium on Windows currently warns that powerPreference is ignored for requestAdapter().
            if (!isWindowsPlatform()) {
                webgpuOptions.powerPreference = 'high-performance';
            }

            this.renderer = new THREE.WebGPURenderer(webgpuOptions);
            await this.renderer.init();

            if (!this.renderer.backend?.isWebGPUBackend) {
                console.warn('[IntroWebGPU] WebGPU backend not available');
                this.renderer.dispose();
                return false;
            }

            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
            // ACES is applied MANUALLY in the post graph (so the cinematic grade can
            // run in display space). The renderer must therefore NOT tonemap — it
            // only performs the sRGB output transform on the post output node.
            this.renderer.toneMapping = THREE.NoToneMapping;

            this.scene = new THREE.Scene();
            // A4 — atmospheric depth: tint the fog toward the nebula's deep-indigo
            // base so distant particles dissolve INTO the backdrop instead of
            // fading to flat black. Slightly thinner so the nebula reads through.
            this.scene.fog = new THREE.FogExp2(0x0a0620, 0.0058);

            this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.camera.position.z = 40;

            // A1 — volumetric nebula sky backdrop (replaces the empty black void).
            this.nebulaSky = createIntroNebulaSky();
            this.scene.add(this.nebulaSky.mesh);

            this.createEnvironmentMap();
            this.setupLighting();

            this.initTetrominoCompute();
            this.initParticleCompute();

            if (this.enableVolumetricNebula) {
                this.createVolumetricNebula();
            }
            if (this.enableConstellationLines) {
                this.createConstellationLines();
            }

            this.initCachedResources();
            this.initTetrominoInstancing();
            this.setupPostProcessing();
            this.applyQualitySettings();
            this.setPhase(INTRO_PHASES.BOOT, true);
            // Seed pieces already in view so the intro/menu background is alive
            // from frame one instead of empty until pieces drift in.
            this.prepopulateTetrominos();

            window.addEventListener('resize', this._onResize = this.onResize.bind(this));
            this.cameraParallax.attach();

            console.log(`[IntroWebGPU] Initialized (${this.quality.key}) with ${IntroParticleCompute.TOTAL_PARTICLES} particles`);
            return true;
        } catch (e) {
            console.error('[IntroWebGPU] Initialization failed:', e);
            return false;
        }
    }

    setVisualProfile(profileId = 'cinematic_clean') {
        this.visualProfileId = profileId;
        this.visualProfile = getIntroVisualProfile(profileId);
        this.quality = getQualityBudget(this.visualProfile, this.performanceLevel);

        // Exposure now feeds the manual ACES tonemap in the post graph, not the
        // renderer (which is NoToneMapping).
        const exposure = this.visualProfile?.post?.baseExposure;
        if (this.uExposure && Number.isFinite(exposure)) {
            this.uExposure.value = exposure;
        }

        this.phaseState = this.getPhasePreset(this.phase);
        this.phaseTargetState = { ...this.phaseState };
        this.phaseTransition = null;
        this.scheduleNextHeroInhale();
        if (this.scene && this.camera && this.renderer) {
            this._scenePass?.dispose?.();
            this.postProcessing?.dispose?.();
            this._scenePass = null;
            this.postProcessing = null;
            this.setupPostProcessing();
        }
        this.applyQualitySettings();
    }

    setPerformanceBudget(level = 'HIGH') {
        this.performanceLevel = ['HIGH', 'MEDIUM', 'LOW'].includes(level) ? level : 'HIGH';
        this.quality = getQualityBudget(this.visualProfile, this.performanceLevel);
        this.applyQualitySettings();
    }

    setTitleBounds(bounds) {
        if (!bounds || !this.canvas) return;

        const width = window.innerWidth || 1;
        const height = window.innerHeight || 1;
        const cx = (bounds.x + bounds.width * 0.5) / width;
        const cy = (bounds.y + bounds.height * 0.5) / height;
        const sx = Math.max(0.06, (bounds.width / width) * 0.42);
        const sy = Math.max(0.04, (bounds.height / height) * 0.72);

        this.uTitleGlowCenter.value.set(cx, 1 - cy);
        this.uTitleGlowSize.value.set(sx, sy);
    }

    getPhasePreset(phase) {
        const presets = this.visualProfile?.phaseCurves || {};
        const base = presets[phase] || presets[INTRO_PHASES.IDLE] || {};
        return {
            bloomMul: base.bloomMul ?? 1,
            attractionMul: base.attractionMul ?? 1,
            spawnMul: base.spawnMul ?? 1,
            titleGlowMul: base.titleGlowMul ?? 1,
            particleMul: base.particleMul ?? 1,
            cameraDriftMul: base.cameraDriftMul ?? 1,
        };
    }

    setPhase(phase, immediate = false, options = null) {
        if (!phase) return;

        const target = this.getPhasePreset(phase);
        this.phase = phase;
        this.phaseTargetState = target;

        if (immediate || !this.phaseState) {
            this.phaseState = { ...target };
            this.phaseTransition = null;
            return;
        }

        const durationOverride = options && Number.isFinite(options.durationMs)
            ? options.durationMs
            : null;
        const durationMs = durationOverride ?? (this.visualProfile?.phaseCurves?.[phase]?.durationMs ?? 520);
        this.phaseTransition = {
            start: performance.now(),
            durationMs: Math.max(1, durationMs),
            from: { ...this.phaseState },
            to: { ...target },
        };
    }

    scheduleNextHeroInhale() {
        const config = this.visualProfile?.heroInhale;
        const min = config?.intervalMin ?? 6.0;
        const max = config?.intervalMax ?? 8.0;
        const span = Math.max(0.1, max - min);
        this.nextHeroInhaleTime = this.simulationTime + min + Math.random() * span;
    }

    updatePhaseState() {
        if (this.phaseTransition) {
            const elapsed = performance.now() - this.phaseTransition.start;
            const t = Math.max(0, Math.min(1, elapsed / this.phaseTransition.durationMs));
            const e = t * t * (3 - 2 * t); // smoothstep easing
            const out = {};
            const { from, to } = this.phaseTransition;
            for (const key of Object.keys(to)) {
                out[key] = from[key] + (to[key] - from[key]) * e;
            }
            this.phaseState = out;
            if (t >= 1) this.phaseTransition = null;
        } else if (!this.phaseState) {
            this.phaseState = this.getPhasePreset(this.phase);
        }

        if (this.phase === INTRO_PHASES.IDLE && this.simulationTime >= this.nextHeroInhaleTime) {
            const holdDuration = this.visualProfile?.heroInhale?.holdDuration ?? 1.1;
            this.setPhase(INTRO_PHASES.HERO_INHALE);
            this.heroInhaleReleaseAt = this.simulationTime + holdDuration;
        } else if (this.phase === INTRO_PHASES.HERO_INHALE && this.simulationTime >= this.heroInhaleReleaseAt) {
            const releaseDurationSec = this.visualProfile?.heroInhale?.releaseDuration ?? 0.95;
            const releaseDurationMs = Math.max(120, releaseDurationSec * 1000);
            this.setPhase(INTRO_PHASES.IDLE, false, { durationMs: releaseDurationMs });
            this.scheduleNextHeroInhale();
        }
    }

    detectInitialQuality() {
        const mem = navigator.deviceMemory || 8;
        const threads = navigator.hardwareConcurrency || 8;
        const screenPixels = window.innerWidth * window.innerHeight;

        if (mem <= 4 || threads <= 4 || screenPixels > 3_500_000) {
            this.performanceLevel = 'MEDIUM';
        }
        if (mem <= 2 || threads <= 2) {
            this.performanceLevel = 'LOW';
        }

        this.quality = getQualityBudget(this.visualProfile, this.performanceLevel);
        this.spawnInterval = this.quality.spawnInterval;
    }

    initParticleCompute() {
        this.particleCompute = new IntroParticleCompute();
        this.particleCompute.setLayerProfile(this.visualProfile?.particle?.layers);
        if (this.tetrominoCompute) {
            this.particleCompute.bindTetrominoBuffers(
                this.tetrominoCompute.getPositionBuffer(),
                this.tetrominoCompute.getVelocityBuffer(),
                IntroTetrominoCompute.MAX_TETROMINOS,
            );
        }
        this.particleCompute.initializeParticles();
        this.particleCompute.createComputeNode();

        const count = IntroParticleCompute.TOTAL_PARTICLES;

        // Use MeshBasicNodeMaterial + InstancedMesh — same proven pattern as tetrominoes.
        // Avoids PointsNodeMaterial.setupVertexSprite() double-offset bug with InstancedMesh.
        const posStore = storage(this.particleCompute.getPositionBuffer(), 'vec4', count);
        const lifeStore = storage(this.particleCompute.getLifeBuffer(), 'vec4', count);
        const miscStore = storage(this.particleCompute.getMiscBuffer(), 'vec4', count);

        const material = new MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        });

        // Per-instance position: scale local quad by particle size, offset by world position.
        // misc.x = particle base size (0.07-0.72 world units from config).
        const warpScale = float(1.0).add(this.uWarp.mul(float(3.0)));
        // Unwrapped positionNode logic
        const particlePos = posStore.element(instanceIndex);
        const particleLife = lifeStore.element(instanceIndex);
        const particleMisc = miscStore.element(instanceIndex);

        // Scale the quad by particle size; misc.x is base size (0.07-0.72).
        // Multiply by 0.06 for small visible dots with soft glow texture.
        const size = particleMisc.x.mul(float(0.06)).mul(particleLife.x).mul(warpScale);
        const local = positionLocal.mul(size);

        // Unwrapped positionNode logic to avoid TSL/WGSL errors with inline Fn return types
        // Offset by world position; hide dead particles off-screen
        const alive = clamp(particleLife.x, float(0.0), float(1.0));
        const worldPos = mix(
            vec3(float(0.0), float(-9999.0), float(0.0)),
            particlePos.xyz,
            alive,
        );
        material.positionNode = local.add(worldPos);

        // Unwrapped colorNode logic. Slightly tamed brightness (2.5 → 2.2) so the
        // field reads as stars rather than saturated confetti.
        const particleLifeColor = lifeStore.element(instanceIndex);
        material.colorNode = vec3(particleLifeColor.y, particleLifeColor.z, particleLifeColor.w).mul(float(2.2));

        // Unwrapped opacityNode logic
        const particleLifeOpacity = lifeStore.element(instanceIndex);
        const particlePosOpacity = posStore.element(instanceIndex); // Needed for depth fade
        const baseOpacity = clamp(
            particleLifeOpacity.x.mul(float(0.6)).add(this.uWarp.mul(float(0.1))),
            float(0.0),
            float(0.7),
        );

        // Circular soft falloff using UV distance from center.
        // This makes each quad render as a round glowing dot instead of a square.
        const uvCentered = uv().sub(vec2(0.5, 0.5));
        const dist = length(uvCentered).mul(float(2.0)); // 0 at center, 1 at edge
        const circle = clamp(float(1.0).sub(dist.mul(dist).mul(float(3.0))), float(0.0), float(1.0));

        // Atmospheric Depth Fade:
        // Camera is at Z=40. Particles exist from Z=-160 to Z=60.
        // Squared falloff maps Z [-160, 40] to opacity [0.06, 1.0] — far particles
        // fade hard so the far/mid/near parallax reads as real 3D depth instead of
        // an even confetti field.
        const zPos = particlePosOpacity.z;
        const depthRamp = smoothstep(float(-160.0), float(40.0), zPos);
        const depthFade = depthRamp.mul(depthRamp).mul(float(0.94)).add(float(0.06));

        material.opacityNode = baseOpacity.mul(circle).mul(depthFade);

        // InstancedMesh: each instance = one particle billboard quad
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        this.particleMesh = new THREE.InstancedMesh(planeGeo, material, count);
        this.particleMesh.frustumCulled = false;
        this.scene.add(this.particleMesh);
    }

    initTetrominoCompute() {
        this.tetrominoCompute = new IntroTetrominoCompute();
        this.tetrominoCompute.createComputeNode();
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(this.visualProfile?.palette?.indigo ?? 0x402060, 1.7);
        this.scene.add(ambientLight);

        const light1 = new THREE.PointLight(this.visualProfile?.palette?.cyan ?? 0x00ffff, 1.8, 110);
        light1.position.set(20, 20, 20);
        this.scene.add(light1);

        const light2 = new THREE.PointLight(this.visualProfile?.palette?.violet ?? 0xff00ff, 1.65, 110);
        light2.position.set(-20, -10, 10);
        this.scene.add(light2);

        const light3 = new THREE.PointLight(this.visualProfile?.palette?.cyan ?? 0x3399ff, 1.3, 120);
        light3.position.set(0, -30, 0);
        this.scene.add(light3);
    }

    createVolumetricNebula() {
        const geometry = new THREE.PlaneGeometry(520, 280, 1, 1);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
        });

        const cloudUv = uv();
        const centeredUv = cloudUv.sub(vec2(0.5, 0.5));
        const dist = length(centeredUv);
        const t = this.uTime.mul(float(0.08));

        const noiseA = fract(sin(cloudUv.x.mul(float(21.17)).add(cloudUv.y.mul(float(37.33))).add(t)).mul(float(43758.5453)));
        const noiseB = fract(sin(cloudUv.x.mul(float(53.91)).sub(cloudUv.y.mul(float(17.41))).sub(t.mul(float(1.7)))).mul(float(24634.6345)));
        const fbm = noiseA.mul(float(0.65)).add(noiseB.mul(float(0.35)));

        const flow = sin(t.mul(float(6.0)).add(cloudUv.x.mul(float(10.0))).add(noiseB.mul(float(7.0)))).mul(float(0.5)).add(float(0.5));
        const falloff = smoothstep(float(0.9), float(0.1), dist);

        const alpha = falloff.mul(fbm).mul(flow).mul(float(0.28));
        const nebulaColor = vec3(float(0.38), float(0.16), float(0.82)).mul(float(0.75))
            .add(vec3(float(0.05), float(0.65), float(0.95)).mul(float(0.35)));

        material.colorNode = nebulaColor;
        material.opacityNode = clamp(alpha, float(0.0), float(0.14));

        this.volumetricNebula = new THREE.Mesh(geometry, material);
        this.volumetricNebula.position.set(-15, 8, -160);
        this.scene.add(this.volumetricNebula);
    }

    createEnvironmentMap() {
        const size = 128;
        const faces = [];
        const spotColors = ['#FF3366', '#00FFFF', '#FFFF00', '#FF6600', '#9933FF', '#00FF66', '#FF0099', '#3399FF'];

        for (let i = 0; i < 6; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
            gradient.addColorStop(0, '#1a0033');
            gradient.addColorStop(0.3, '#0d001a');
            gradient.addColorStop(0.6, '#080010');
            gradient.addColorStop(1, '#030005');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            const spotCount = 20 + Math.floor(Math.random() * 15);
            for (let j = 0; j < spotCount; j++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const r = 2 + Math.random() * 10;
                const color = spotColors[Math.floor(Math.random() * spotColors.length)];

                const spotGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                spotGrad.addColorStop(0, color);
                spotGrad.addColorStop(0.5, `${color}80`);
                spotGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = spotGrad;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
            }

            faces.push(canvas);
        }

        this.envMap = new THREE.CubeTexture(faces);
        this.envMap.needsUpdate = true;
    }

    setupPostProcessing() {
        this.postProcessing = new THREE.PostProcessing(this.renderer);

        const scenePass = pass(this.scene, this.camera);
        const sceneColor = scenePass.getTextureNode('output');
        const bloomThreshold = this.visualProfile?.post?.bloomThreshold ?? 0.58;
        const bloomRadius = this.visualProfile?.post?.bloomRadius ?? 0.8;
        const bloomNode = bloom(sceneColor, this.uBloomStrength, bloomThreshold, bloomRadius);

        const screenUv = uv();
        const center = screenUv.sub(vec2(0.5, 0.52));
        const dist = length(center);

        // ── Real chromatic aberration ──
        // Resample the scene R/G/B at a radial, edge-biased offset — true lens
        // dispersion (premium "glass" feel), not just an additive tint.
        const edgeBoost = float(1.0).add(dist.mul(float(0.7)));
        const chromaOffset = center.mul(this.uChromaticStrength).mul(edgeBoost);
        const sampleR = sceneColor.sample(screenUv.add(chromaOffset));
        const sampleG = sceneColor.sample(screenUv);
        const sampleB = sceneColor.sample(screenUv.sub(chromaOffset));
        const chroma = vec3(sampleR.r, sampleG.g, sampleB.b);

        // ── A3: title-anchored volumetric light glow (soft, breathing) ──
        const titleDelta = screenUv.sub(this.uTitleGlowCenter);
        const titleDist = length(titleDelta);
        const breathing = sin(this.uTime.mul(float(1.9))).mul(float(0.5)).add(float(0.5));
        const shaftMask = clamp(float(1.0).sub(titleDist.mul(float(1.7))), float(0.0), float(1.0));
        const shaft = vec3(float(0.10), float(0.55), float(0.95))
            .mul(shaftMask.mul(shaftMask))
            .mul(breathing.mul(float(0.35)).add(float(0.65)))
            .mul(this.uGodRayStrength.add(float(0.08)));

        // ── DoF proxy ──
        const focusMask = smoothstep(float(0.1), float(0.72), dist).mul(this.uDoFStrength.mul(float(0.6)));
        const softFocus = vec3(focusMask);

        // ── Selective chromatic fringe on bright scene edges ──
        const sceneLuma = dot(chroma, vec3(float(0.2126), float(0.7152), float(0.0722)));
        const brightMask = clamp(sceneLuma.sub(float(0.55)).mul(float(2.2)), float(0.0), float(1.0));
        const edgeMask = smoothstep(float(0.12), float(0.95), dist);
        const fringeMask = brightMask.mul(edgeMask).mul(this.uFringeStrength);
        const fringeColor = vec3(float(0.08), float(0.0), float(0.14)).mul(fringeMask);

        // ── Title glow (breathing two-tone elliptical halo) ──
        const titleScale = vec2(
            titleDelta.x.div(this.uTitleGlowSize.x),
            titleDelta.y.div(this.uTitleGlowSize.y),
        );
        const titleFalloff = smoothstep(float(1.35), float(0.0), length(titleScale));
        const titleColor = vec3(
            float(this.visualProfile.palette.titleGlow[0]),
            float(this.visualProfile.palette.titleGlow[1]),
            float(this.visualProfile.palette.titleGlow[2]),
        );
        const titleColorSecondary = vec3(
            float(this.visualProfile.palette.titleGlowSecondary[0]),
            float(this.visualProfile.palette.titleGlowSecondary[1]),
            float(this.visualProfile.palette.titleGlowSecondary[2]),
        );
        const titlePulse = sin(this.uTime.mul(float(1.35))).mul(float(0.5)).add(float(0.5));
        const titleGlow = mix(titleColor, titleColorSecondary, titlePulse.mul(float(0.4)))
            .mul(titleFalloff)
            .mul(this.uTitleGlowStrength);

        // ── HDR composite (pre-tonemap): scene + bloom + emissive glows − DoF ──
        const hdr = chroma
            .add(bloomNode)
            .add(shaft)
            .add(titleGlow)
            .add(fringeColor)
            .sub(softFocus);

        // Vignette in linear/HDR space (darkens edges before the tonemap shoulder).
        const vignetteFactor = smoothstep(float(0.95), float(0.35), dist); // 1 centre → 0 edge
        const vignetted = hdr.mul(
            mix(float(1.0).sub(this.uVignetteDarkness), float(1.0), vignetteFactor),
        );

        // ── Exposure + manual ACES filmic tonemap → display-referred [0,1] ──
        // The renderer uses NoToneMapping (it only does the sRGB output transform),
        // so we tonemap HERE. That puts the grade below into DISPLAY space, where a
        // 0.5-pivot contrast is correct and can be pushed hard WITHOUT driving
        // channels negative (which previously produced an olive ACES artefact).
        const exposed = clamp(vignetted, float(0.0), float(64.0)).mul(this.uExposure);
        const acesNum = exposed.mul(exposed.mul(float(2.51)).add(float(0.03)));
        const acesDen = exposed.mul(exposed.mul(float(2.43)).add(float(0.59))).add(float(0.14));
        const toned = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // ── Display-space grade: luma-preserving saturation + contrast ──
        const luma = dot(toned, vec3(float(0.2126), float(0.7152), float(0.0722)));
        const saturated = mix(vec3(luma), toned, this.uSaturation);
        const contrasted = saturated.sub(float(0.5)).mul(this.uContrast).add(float(0.5));

        // ── Film grain (animated) + dither (anti-banding) ──
        const grainStrength = this.visualProfile?.post?.grain ?? 0.0025;
        const ditherStrength = this.visualProfile?.post?.dither ?? 0.0018;
        const grainSeed = screenUv.x.mul(float(1234.5)).add(screenUv.y.mul(float(6789.3))).add(this.uTime.mul(float(41.0)));
        const grain = fract(sin(grainSeed).mul(float(43758.5453))).sub(float(0.5)).mul(float(grainStrength));
        const ditherSeed = screenUv.x.mul(float(317.1)).add(screenUv.y.mul(float(269.5)));
        const dither = fract(sin(ditherSeed).mul(float(43758.5453))).sub(float(0.5)).mul(float(ditherStrength));

        const finalColor = clamp(contrasted.add(vec3(grain)).add(vec3(dither)), float(0.0), float(1.0));
        this.postProcessing.outputNode = finalColor;
        this.postProcessing.needsUpdate = true;
        this._scenePass = scenePass;
    }

    createConstellationLines() {
        const posData = this.particleCompute?.positionData;
        if (!posData) return;

        const starPositions = [];
        const maxStars = 260;
        for (let i = 0; i < IntroParticleCompute.STAR_COUNT && starPositions.length < maxStars; i += 5) {
            const i4 = i * 4;
            starPositions.push([posData[i4], posData[i4 + 1], posData[i4 + 2]]);
        }

        const segments = [];
        const maxDistanceSq = 22 * 22;
        const maxSegments = 180;
        for (let i = 0; i < starPositions.length && segments.length < maxSegments; i++) {
            let nearestJ = -1;
            let nearestDist = Number.POSITIVE_INFINITY;
            for (let j = i + 1; j < starPositions.length; j++) {
                const dx = starPositions[i][0] - starPositions[j][0];
                const dy = starPositions[i][1] - starPositions[j][1];
                const dz = starPositions[i][2] - starPositions[j][2];
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < nearestDist && d2 < maxDistanceSq) {
                    nearestDist = d2;
                    nearestJ = j;
                }
            }
            if (nearestJ >= 0) {
                segments.push(starPositions[i], starPositions[nearestJ]);
            }
        }

        if (segments.length === 0) return;

        const linePositions = new Float32Array(segments.length * 3);
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            const o = i * 3;
            linePositions[o] = s[0];
            linePositions[o + 1] = s[1];
            linePositions[o + 2] = s[2];
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        const material = new LineBasicNodeMaterial({
            color: new THREE.Color(0x73b8ff),
            transparent: true,
            opacity: 0.18,
            blending: AdditiveBlending,
            depthWrite: false,
        });
        this.constellationMesh = new THREE.LineSegments(geometry, material);
        this.constellationMesh.frustumCulled = false;
        this.constellationMesh.position.z = -15;
        this.scene.add(this.constellationMesh);
    }

    initCachedResources() {
        this.cachedResources = {};

        const extrudeSettings = {
            depth: 1.8,
            bevelEnabled: true,
            bevelThickness: 0.15,
            bevelSize: 0.15,
            bevelSegments: 3,
        };

        SHAPE_KEYS.forEach((type) => {
            const color = this.COLORS[type];
            const threeColor = new THREE.Color(color);
            const threeShape = this.createTetrominoShape(type);

            const geometry = new THREE.ExtrudeGeometry(threeShape, extrudeSettings);
            geometry.computeBoundingBox();
            const centerOffset = new THREE.Vector3();
            geometry.boundingBox.getCenter(centerOffset).negate();
            geometry.translate(centerOffset.x, centerOffset.y, centerOffset.z);

            const material = new MeshStandardNodeMaterial({
                color: threeColor.clone().multiplyScalar(0.6),
                emissive: threeColor,
                emissiveIntensity: 0.5,
                roughness: 0.05,
                metalness: 0.1,
                envMap: this.envMap,
                envMapIntensity: 0.5,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide,
            });

            const glowMaterial = new MeshBasicNodeMaterial({
                color: threeColor.clone().multiplyScalar(1.35),
                transparent: true,
                opacity: 0.33,
                blending: AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false,
            });

            material.userData.baseEmissiveIntensity = 0.5;
            glowMaterial.userData.baseOpacity = 0.33;

            this.cachedResources[type] = { geometry, material, glowMaterial };
        });
    }

    initTetrominoInstancing() {
        const capacity = IntroTetrominoCompute.MAX_TETROMINOS;
        const positionStore = storage(this.tetrominoCompute.getPositionBuffer(), 'vec4', capacity);
        const rotationStore = storage(this.tetrominoCompute.getRotationBuffer(), 'vec4', capacity);
        const velocityStore = storage(this.tetrominoCompute.getVelocityBuffer(), 'vec4', capacity);

        const createPositionNode = (typeIdx, baseScale) => {
            const slot = instanceIndex;
            const statePos = positionStore.element(slot);
            const stateRot = rotationStore.element(slot);
            const stateVel = velocityStore.element(slot);

            const active = statePos.w;
            const typeDiff = abs(stateVel.w.sub(float(typeIdx)));
            const typeMask = float(1.0).sub(clamp(typeDiff, float(0.0), float(1.0)));
            const drawMask = active.mul(typeMask);

            // Collision scale pulse: flash (rot.w) drives a brief 20% scale-up
            const flash = stateRot.w.mul(typeMask);
            const scale = float(baseScale).add(flash.mul(float(baseScale * 0.2)));

            const local = positionLocal.mul(scale);
            const sx = sin(stateRot.x);
            const cx = cos(stateRot.x);
            const sy = sin(stateRot.y);
            const cy = cos(stateRot.y);
            const sz = sin(stateRot.z);
            const cz = cos(stateRot.z);

            const y1 = local.y.mul(cx).sub(local.z.mul(sx));
            const z1 = local.y.mul(sx).add(local.z.mul(cx));
            const x1 = local.x;

            const x2 = x1.mul(cy).add(z1.mul(sy));
            const z2 = x1.negate().mul(sy).add(z1.mul(cy));
            const y2 = y1;

            const x3 = x2.mul(cz).sub(y2.mul(sz));
            const y3 = x2.mul(sz).add(y2.mul(cz));
            const z3 = z2;

            const worldPos = vec3(x3, y3, z3).add(statePos.xyz);
            const hiddenPos = vec3(float(0.0), float(-20000.0), float(0.0));

            return mix(hiddenPos, worldPos, drawMask);
        };

        SHAPE_KEYS.forEach((type, typeIdx) => {
            const resources = this.cachedResources[type];
            const mesh = new THREE.InstancedMesh(resources.geometry, resources.material, capacity);
            const glowMesh = new THREE.InstancedMesh(resources.geometry, resources.glowMaterial, capacity);
            mesh.count = capacity;
            glowMesh.count = capacity;
            mesh.frustumCulled = false;
            glowMesh.frustumCulled = false;

            resources.material.positionNode = createPositionNode(typeIdx, 0.75);
            resources.glowMaterial.positionNode = createPositionNode(typeIdx, 0.82);

            // Collision flash visual feedback:
            // rotationBuffer.w stores collision flash intensity (0→1 on hit, decays each frame).
            // Boost emissive intensity and glow opacity when a tetromino collides.
            const flashSlot = instanceIndex;
            const flashRot = rotationStore.element(flashSlot);
            const flashVel = velocityStore.element(flashSlot);
            const flashTypeDiff = abs(flashVel.w.sub(float(typeIdx)));
            const flashTypeMask = float(1.0).sub(clamp(flashTypeDiff, float(0.0), float(1.0)));
            const flashIntensity = flashRot.w.mul(flashTypeMask);

            // Emissive boost: base 0.5 → up to 3.0 on collision flash
            resources.material.emissiveIntensityNode = float(0.5).add(flashIntensity.mul(float(2.5)));

            // Glow opacity boost: base 0.33 → up to 0.85 on collision flash
            resources.glowMaterial.opacityNode = float(0.33).add(flashIntensity.mul(float(0.52)));

            this.scene.add(mesh);
            this.scene.add(glowMesh);
            this.tetrominoInstances[typeIdx] = { mesh, glowMesh };
        });
    }

    spawnTetromino() {
        const typeIdx = Math.floor(Math.random() * SHAPE_KEYS.length);
        const z = (Math.random() - 0.5) * 20 - 10;
        const bounds = this.getVisibleBoundsAtDepth(z);
        const halfW = bounds.width / 2;
        const halfH = bounds.height / 2;

        // Spawn beyond the camera's full reveal envelope (idle drift + pointer
        // parallax) so pieces always drift in from off-screen rather than popping
        // into view when the camera pans toward them.
        const envX = CAMERA_IDLE_AMP_X + (this.cameraParallax?.orbitX || 0);
        const envY = CAMERA_IDLE_AMP_Y + (this.cameraParallax?.orbitY || 0);
        const marginX = envX + TETROMINO_RADIUS + SPAWN_CLEARANCE;
        const marginY = envY + TETROMINO_RADIUS + SPAWN_CLEARANCE;
        const spanW = bounds.width + envX * 2;
        const spanH = bounds.height + envY * 2;

        let x;
        let y;
        let vx = (Math.random() - 0.5) * 0.05;
        let vy = (Math.random() - 0.5) * 0.05;
        const vz = (Math.random() - 0.5) * 0.025;

        const side = Math.floor(Math.random() * 4);
        switch (side) {
            case 0:
                x = (Math.random() - 0.5) * spanW;
                y = halfH + marginY;
                vy = -Math.abs(vy) - SPAWN_INWARD_DRIFT;
                break;
            case 1:
                x = (Math.random() - 0.5) * spanW;
                y = -halfH - marginY;
                vy = Math.abs(vy) + SPAWN_INWARD_DRIFT;
                break;
            case 2:
                x = -halfW - marginX;
                y = (Math.random() - 0.5) * spanH;
                vx = Math.abs(vx) + SPAWN_INWARD_DRIFT;
                break;
            default:
                x = halfW + marginX;
                y = (Math.random() - 0.5) * spanH;
                vx = -Math.abs(vx) - SPAWN_INWARD_DRIFT;
                break;
        }

        const slot = this.tetrominoCompute.spawn(x, y, z, vx, vy, vz, typeIdx);
        return slot !== -1;
    }

    /**
     * Seed a handful of tetrominos already INSIDE the view so the intro is alive
     * from the first frame instead of starting empty and waiting ~5-7s for the
     * first piece to drift in from off-screen (regular spawnTetromino() spawns
     * beyond the edge so pieces "drift in" rather than pop).
     */
    prepopulateTetrominos(count = 12) {
        if (!this.tetrominoCompute) return;
        for (let i = 0; i < count; i++) {
            const typeIdx = Math.floor(Math.random() * SHAPE_KEYS.length);
            const z = (Math.random() - 0.5) * 24 - 8; // -20..4
            const bounds = this.getVisibleBoundsAtDepth(z);
            // Inset a little so they read as on-screen, not clipping the edges.
            const x = (Math.random() - 0.5) * bounds.width * 0.82;
            const y = (Math.random() - 0.5) * bounds.height * 0.7;
            // Gentle drift in any direction (no forced inward push — they're already in view).
            const vx = (Math.random() - 0.5) * 0.06;
            const vy = (Math.random() - 0.5) * 0.06;
            const vz = (Math.random() - 0.5) * 0.03;
            this.tetrominoCompute.spawn(x, y, z, vx, vy, vz, typeIdx);
        }
    }

    getVisibleBoundsAtDepth(depth) {
        if (!this.camera) return { width: 60, height: 40 };

        const dist = this.camera.position.z - depth;
        const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
        const height = 2 * Math.tan(vFOV / 2) * dist;
        const width = height * this.camera.aspect;

        return { width, height };
    }

    createTetrominoShape(type) {
        const shape = new THREE.Shape();
        switch (type) {
            case 'I':
                shape.moveTo(-4, -1); shape.lineTo(4, -1); shape.lineTo(4, 1); shape.lineTo(-4, 1); shape.lineTo(-4, -1);
                break;
            case 'O':
                shape.moveTo(-2, -2); shape.lineTo(2, -2); shape.lineTo(2, 2); shape.lineTo(-2, 2); shape.lineTo(-2, -2);
                break;
            case 'T':
                shape.moveTo(-3, -1); shape.lineTo(3, -1); shape.lineTo(3, 1); shape.lineTo(1, 1);
                shape.lineTo(1, 3); shape.lineTo(-1, 3); shape.lineTo(-1, 1); shape.lineTo(-3, 1); shape.lineTo(-3, -1);
                break;
            case 'S':
                shape.moveTo(-3, -2); shape.lineTo(1, -2); shape.lineTo(1, 0); shape.lineTo(3, 0);
                shape.lineTo(3, 2); shape.lineTo(-1, 2); shape.lineTo(-1, 0); shape.lineTo(-3, 0); shape.lineTo(-3, -2);
                break;
            case 'Z':
                shape.moveTo(-1, -2); shape.lineTo(3, -2); shape.lineTo(3, 0); shape.lineTo(1, 0);
                shape.lineTo(1, 2); shape.lineTo(-3, 2); shape.lineTo(-3, 0); shape.lineTo(-1, 0); shape.lineTo(-1, -2);
                break;
            case 'J':
                shape.moveTo(-2, -3); shape.lineTo(2, -3); shape.lineTo(2, 3); shape.lineTo(0, 3);
                shape.lineTo(0, -1); shape.lineTo(-2, -1); shape.lineTo(-2, -3);
                break;
            case 'L':
                shape.moveTo(-2, -3); shape.lineTo(2, -3); shape.lineTo(2, -1); shape.lineTo(0, -1);
                shape.lineTo(0, 3); shape.lineTo(-2, 3); shape.lineTo(-2, -3);
                break;
            default:
                shape.moveTo(-2, -2); shape.lineTo(2, -2); shape.lineTo(2, 2); shape.lineTo(-2, 2); shape.lineTo(-2, -2);
                break;
        }
        return shape;
    }

    setAudioPulse(pulse) {
        this.audioPulse = Math.max(0, Math.min(1, pulse));
    }

    setBackgroundMode(enabled) {
        this.isBackgroundMode = !!enabled;
        if (this.particleCompute) {
            this.particleCompute.setBackgroundMode(this.isBackgroundMode);
        }
        if (this.isBackgroundMode) {
            this.setPhase(INTRO_PHASES.MENU_BG);
        } else if (this.phase === INTRO_PHASES.MENU_BG) {
            this.setPhase(INTRO_PHASES.IDLE);
        }
        this.applyQualitySettings();
    }

    startWarpDismiss(duration = 1.2) {
        this.warpDuration = Math.max(0.4, duration);
        this.warpStartTime = this.uTime.value;
        this.uWarp.value = 0;
        this.setPhase(INTRO_PHASES.DISMISS);
        this.tetrominoCompute?.applyWarpImpulse?.(0.55);
    }

    updateWarp(time) {
        if (this.warpStartTime < 0) {
            // Smoothly decay any residual warp to avoid a pop
            if (this.uWarp.value > 0.001) {
                this.uWarp.value *= 0.92;
            } else {
                this.uWarp.value = 0;
            }
            return;
        }

        const elapsed = time - this.warpStartTime;
        const t = Math.max(0, Math.min(1, elapsed / this.warpDuration));

        // Bell-curve: smoothly rises to peak at ~40% progress, then gently decays.
        // This avoids both the hard start and the abrupt snap at the end.
        const peak = 0.4;
        let warp;
        if (t < peak) {
            // Ease-in to peak: smoothstep 0→1 over [0, peak]
            const s = t / peak;
            warp = s * s * (3 - 2 * s);
        } else {
            // Ease-out from peak: smoothstep 1→0 over [peak, 1]
            const s = (t - peak) / (1 - peak);
            warp = 1 - s * s * (3 - 2 * s);
        }

        this.uWarp.value = warp;

        if (elapsed >= this.warpDuration) {
            this.warpStartTime = -1;
        }
    }

    update() {
        if (!this.scene || !this.camera || !this.renderer) return;

        // Clamp simulation delta to avoid giant jumps after frame hitches/tab throttling.
        // This keeps GPU simulation visually continuous instead of "resetting" motion.
        const rawDelta = this.clock.getDelta();
        const delta = Math.min(rawDelta, 1 / 30);
        this.simulationTime += delta;
        this.updatePhaseState();
        const phase = this.phaseState || this.getPhasePreset(this.phase);

        this.uTime.value = this.simulationTime;
        this.uAudioPulse.value = this.audioPulse;
        this.updateWarp(this.simulationTime);

        // Idle Lissajous drift + warp dolly, then pointer parallax on top.
        // apply() adds the cursor-driven offset and performs the final lookAt,
        // so it must come after the base position is set.
        const cameraDriftScale = (1 + this.uWarp.value * 1.5) / Math.max(0.1, phase.cameraDriftMul);
        const t = this.simulationTime * 0.2;
        this.camera.position.x = (Math.sin(t * 0.5) * CAMERA_IDLE_AMP_X) / cameraDriftScale;
        this.camera.position.y = (Math.cos(t * 0.3) * CAMERA_IDLE_AMP_Y) / cameraDriftScale;
        this.camera.position.z = 40 - this.uWarp.value * 10;
        this.cameraParallax.apply(this.camera, delta);

        this.uBloomStrength.value = this.quality.bloom
            ? (this.quality.bloomStrength * phase.bloomMul) + (this.audioPulse * 0.05) + (this.uWarp.value * 0.1)
            : 0;
        this.uGodRayStrength.value = this.quality.godRays;
        this.uDoFStrength.value = this.quality.dof + (this.uWarp.value * 0.05);
        this.uFringeStrength.value = this.quality.fringe + (this.audioPulse * 0.03);
        const menuBgGlowAttenuation = this.phase === INTRO_PHASES.MENU_BG ? 0.28 : 1.0;
        this.uTitleGlowStrength.value = this.titleGlowEnabled
            ? (0.22 * phase.titleGlowMul + this.audioPulse * 0.03) * menuBgGlowAttenuation
            : 0;

        if (this.particleCompute) {
            this.particleCompute.setAttractionStrength(this.quality.attraction * phase.attractionMul);
            this.particleCompute.setAudioPulse(this.audioPulse);
            this.particleCompute.setWarpFactor(this.uWarp.value);
            this.particleCompute.setEventIntensity(Math.max(0.4, phase.particleMul));
            this.particleCompute.update(delta, this.simulationTime);
        }

        const shouldCompute = (this.computeFrameCounter++ % this.quality.computeFrameSkip) === 0;
        if (shouldCompute) {
            if (this.particleCompute?.computeNode) {
                this.renderer.compute(this.particleCompute.computeNode);
            }
            if (this.tetrominoCompute?.computeNode) {
                this.tetrominoCompute.update(delta, this.simulationTime);
                this.renderer.compute(this.tetrominoCompute.computeNode);
            }
        }

        this.spawnAccumulator += delta;
        const effectiveSpawnInterval = this.spawnInterval / Math.max(0.2, phase.spawnMul);
        if (this.spawnAccumulator >= effectiveSpawnInterval) {
            this.spawnAccumulator -= effectiveSpawnInterval;
            const spawned = this.spawnTetromino();
            if (spawned) {
                this.lastSpawnTime = this.simulationTime;
            }
        }

        if (this.nebulaSky) {
            this.nebulaSky.uniforms.uTime.value = this.simulationTime;
            this.nebulaSky.uniforms.uPulse.value = this.audioPulse;
        }

        if (this.volumetricNebula) {
            this.volumetricNebula.rotation.z = Math.sin(this.simulationTime * 0.05) * 0.05;
        }

        if (this.constellationMesh) {
            this.constellationMesh.rotation.z = Math.sin(this.simulationTime * 0.05) * 0.03;
            const pulse = 0.12 + this.audioPulse * 0.14 + Math.sin(this.simulationTime * 0.6) * 0.03;
            this.constellationMesh.material.opacity = Math.max(0.05, pulse);
        }

        for (const cloud of this.nebulaClouds) {
            cloud.rotation.z += cloud.userData.driftSpeed * delta;
        }

        if (this.cachedResources) {
            const emissiveMul = this.isBackgroundMode ? 0.72 : Math.min(1.15, 0.82 + phase.titleGlowMul * 0.25);
            const glowMul = this.isBackgroundMode ? 0.62 : Math.min(1.12, 0.84 + phase.titleGlowMul * 0.2);
            for (const key of SHAPE_KEYS) {
                const entry = this.cachedResources[key];
                if (!entry) continue;
                const baseEmissive = entry.material?.userData?.baseEmissiveIntensity ?? 0.5;
                const baseGlowOpacity = entry.glowMaterial?.userData?.baseOpacity ?? 0.33;
                if (entry.material) entry.material.emissiveIntensity = baseEmissive * emissiveMul;
                if (entry.glowMaterial) entry.glowMaterial.opacity = baseGlowOpacity * glowMul;
            }
        }

        // Always render through the post pipeline: it owns the manual ACES tonemap
        // now (renderer is NoToneMapping), so the direct path would look untonemapped.
        // On low tiers bloom strength is driven to 0, so the cost is just the grade.
        if (this.postProcessing) {
            this.postProcessing.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        this.trackFrameTime(rawDelta);
    }

    trackFrameTime(delta) {
        if (!this.dynamicQualityEnabled) return;

        this.frameTimes.push(delta);
        if (this.frameTimes.length > 90) this.frameTimes.shift();

        const now = performance.now();
        if (now - this.lastQualityCheck < 2000) return;
        this.lastQualityCheck = now;

        if (this.frameTimes.length < 40) return;

        const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const avgFPS = 1 / avgDelta;

        if (avgFPS < 35 && this.quality.key !== 'LOW') {
            this.quality = getQualityBudget(this.visualProfile, 'LOW');
            this.applyQualitySettings();
            console.log('[IntroWebGPU] Quality reduced to LOW (FPS:', Math.round(avgFPS), ')');
        } else if (avgFPS < 50 && this.quality.key === 'HIGH') {
            this.quality = getQualityBudget(this.visualProfile, 'MEDIUM');
            this.applyQualitySettings();
            console.log('[IntroWebGPU] Quality reduced to MEDIUM (FPS:', Math.round(avgFPS), ')');
        }
    }

    applyQualitySettings() {
        this.spawnInterval = this.quality.spawnInterval;
        this.uDoFStrength.value = this.isBackgroundMode ? this.quality.dof * 0.4 : this.quality.dof;
        this.uFringeStrength.value = this.isBackgroundMode ? this.quality.fringe * 0.5 : this.quality.fringe;

        if (this.renderer) {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
        }

        if (this.particleCompute) {
            this.particleCompute.setAttractionStrength(this.quality.attraction);
            this.particleCompute.setBackgroundMode(this.isBackgroundMode);
            this.particleCompute.setLayerProfile(this.visualProfile?.particle?.layers);
            this.particleCompute.setEventIntensity(this.visualProfile?.particle?.eventOpacity ?? 1.0);
            this.particleCompute.applyQualityProfile(this.quality.key, this.isBackgroundMode);
        }

        const maxClouds = this.isBackgroundMode
            ? 0
            : this.quality.nebulaClouds;

        this.nebulaClouds.forEach((cloud, i) => {
            cloud.visible = i < maxClouds;
        });

        if (this.nebulaSky) {
            // Full brightness for the intro (the liked look); dimmer behind the
            // menu so it never competes with the cards.
            const tierScale = this.quality.key === 'LOW' ? 0.8 : 1.0;
            this.nebulaSky.setIntensity((this.isBackgroundMode ? 0.5 : 1.0) * tierScale);
        }

        if (this.volumetricNebula) {
            // The nebula pass creates a broad blue haze behind the menu cards.
            // Keep it for the full intro, but disable it in background-only mode.
            this.volumetricNebula.visible = this.quality.key !== 'LOW' && !this.isBackgroundMode;
        }

        if (this.constellationMesh) {
            this.constellationMesh.visible = this.quality.key !== 'LOW' && !this.isBackgroundMode;
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));

        if (this._scenePass) {
            this._scenePass.setSize(window.innerWidth, window.innerHeight);
        }
    }

    destroy() {
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        }
        this.cameraParallax?.detach();

        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }

        if (this.tetrominoCompute) {
            this.tetrominoCompute.dispose();
            this.tetrominoCompute = null;
        }

        if (this.particleMesh) {
            this.particleMesh.geometry?.dispose();
            this.particleMesh.material?.dispose();
            this.particleMesh.removeFromParent();
            this.particleMesh = null;
        }

        for (const key of Object.keys(this.tetrominoInstances)) {
            const bucket = this.tetrominoInstances[key];
            if (bucket?.mesh) {
                bucket.mesh.removeFromParent();
                bucket.mesh.dispose?.();
            }
            if (bucket?.glowMesh) {
                bucket.glowMesh.removeFromParent();
                bucket.glowMesh.dispose?.();
            }
        }
        this.tetrominoInstances = {};

        if (this.cachedResources) {
            for (const key of Object.keys(this.cachedResources)) {
                const res = this.cachedResources[key];
                res.geometry?.dispose();
                res.material?.dispose();
                res.glowMaterial?.dispose();
            }
            this.cachedResources = null;
        }

        for (const cloud of this.nebulaClouds) {
            cloud.geometry?.dispose();
            cloud.material?.dispose();
            cloud.removeFromParent();
        }
        this.nebulaClouds = [];

        if (this.nebulaSky) {
            this.nebulaSky.dispose();
            this.nebulaSky = null;
        }

        if (this.volumetricNebula) {
            this.volumetricNebula.geometry?.dispose();
            this.volumetricNebula.material?.dispose();
            this.volumetricNebula.removeFromParent();
            this.volumetricNebula = null;
        }

        if (this.constellationMesh) {
            this.constellationMesh.geometry?.dispose();
            this.constellationMesh.material?.dispose();
            this.constellationMesh.removeFromParent();
            this.constellationMesh = null;
        }

        if (this.envMap) {
            this.envMap.dispose();
            this.envMap = null;
        }

        if (this._scenePass) {
            this._scenePass.dispose?.();
            this._scenePass = null;
        }

        if (this.postProcessing) {
            this.postProcessing.dispose?.();
            this.postProcessing = null;
        }

        if (this.scene) {
            this.scene.clear();
            this.scene = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.camera = null;
        this.frameTimes = [];
    }
}
