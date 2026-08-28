/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MISTY LAKE THEME - Enhanced Three.js 3D Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * An immersive, calming 3D lake scene with:
 * - Animated water surface with caustics, waves, and moon reflections
 * - Volumetric ground-hugging mist with god rays
 * - Layered mountain silhouettes with atmospheric perspective
 * - Glowing moon with detailed halo and corona
 * - Aurora borealis in the sky
 * - Twinkling starfield with color variation
 * - Floating fireflies with organic movement
 * - Lily pads floating on water
 * - Reeds/cattails swaying at water's edge
 * - Falling petals/leaves
 * - Silhouette trees framing the scene
 * - Deep camera breathing and subtle vignette
 * - Enhanced game event effects
 *
 * Color Palette: Moonlit blues, misty purples, lantern golds
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { performanceMonitor } from '../../utils/performance-monitor.js';
import { MISTY_LAKE_TETROMINOS } from './misty-lake-tetrominos.js';
import { MistyLakeWater } from './misty-lake-water.js';
import {
    waterVertexShader,
    waterFragmentShader,
    mistVertexShader,
    mistFragmentShader,
    godRayVertexShader,
    godRayFragmentShader,
    mountainVertexShader,
    mountainFragmentShader,
    moonVertexShader,
    moonFragmentShader,
    auroraVertexShader,
    auroraFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    fireflyVertexShader,
    fireflyFragmentShader,
    treeVertexShader,
    treeFragmentShader,
    rippleVertexShader,
    rippleFragmentShader,
    lightBurstVertexShader,
    lightBurstFragmentShader,
    skyVertexShader,
    skyFragmentShader,
    mistBurstVertexShader,
    mistBurstFragmentShader,
    petalVertexShader,
    petalFragmentShader,
    reedVertexShader,
    reedFragmentShader,
    lilyVertexShader,
    lilyFragmentShader,
    birdVertexShader,
    birdFragmentShader,
} from './misty-lake-shaders.js';

function parseMistyLakeFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noPost: false,
            noMRT: false,
            noCompute: false,
            noReflection: false,
            enableReflection: false,
            debugLogs: false,
        };
    }
    const params = new URLSearchParams(window.location.search);
    const readBool = (key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        if (value === '' || value === null) return true;
        const n = value.toLowerCase();
        return n === '1' || n === 'true' || n === 'yes' || n === 'on';
    };
    return {
        forceWebGL: readBool('forceWebGL') || readBool('mistyLakeForceWebGL'),
        noPost: readBool('mistyLakeNoPost'),
        noMRT: readBool('mistyLakeNoMRT'),
        noCompute: readBool('mistyLakeNoCompute'),
        noReflection: readBool('mistyLakeNoReflection'),
        enableReflection: readBool('mistyLakeReflection') || readBool('mistyLakeEnableReflection'),
        debugLogs: readBool('mistyLakeDebug'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Color Palette
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = {
    // Sky - richer gradients, improved depth
    skyTop: new THREE.Color(0x020510), // Almost black blue
    skyMiddle: new THREE.Color(0x0a1530), // Deep twilight
    skyHorizon: new THREE.Color(0x2a3860), // Misty purple-blue

    // Water - more mysterious
    waterDeep: new THREE.Color(0x000510), // Very deep, almost black
    waterShallow: new THREE.Color(0x102540), // Dark moonlit surface
    moonReflection: new THREE.Color(0xd0eeff), // Bright silvery cyan

    // Mist - subtle contrast
    mistColor: new THREE.Color(0x405070), // Cool slate blue

    // Mountains
    mountainFar: new THREE.Color(0x203050),
    mountainMid: new THREE.Color(0x102035),
    mountainNear: new THREE.Color(0x051020),

    // Moon
    moonColor: new THREE.Color(0xfff5e0), // Creamy warm white
    moonHalo: new THREE.Color(0xc0b0ff), // Soft lavender

    // Aurora - more vibrant
    auroraGreen: new THREE.Color(0x20ffaa), // Turqouise green
    auroraPurple: new THREE.Color(0x9040ff), // Deep violet

    // Trees
    treeColor: new THREE.Color(0x020508), // Sharp silhouettes

    // Fireflies
    fireflyColor: new THREE.Color(0xffd28a), // Warm Ghibli spirit gold

    // God rays
    rayColor: new THREE.Color(0xa0c0ff),

    // Lily pads & lotus (Ghibli warm accent)
    lilyPadGreen: new THREE.Color(0x3a5848), // Cool desaturated green
    lotusOrange: new THREE.Color(0xffa850), // Warm orange lotus accent

    // Cherry petals (Ghibli signal)
    petalPink: new THREE.Color(0xffc0d0),
    petalWhite: new THREE.Color(0xfff0e8),

    // Distant lanterns
    lanternAmber: new THREE.Color(0xff9050),

    // Reeds
    reedColor: new THREE.Color(0x0a1218),

    // Effects
    rippleColor: new THREE.Color(0xa0e0ff),
    burstColor: new THREE.Color(0xb0a0ff),
};

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Quality Presets
// ─────────────────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = {
    Minimal: {
        starCount: 200,
        fireflyCount: 40,
        mistLayers: 3,
        petalCount: 20,
        reedCount: 30,
        lilyCount: 3,
        enableBloom: false,
        bloomStrength: 0.4,
        enableAurora: false,
        enableGodRays: false,
        maxRipples: 3,
        maxMistBursts: 2,
        reflectionRT: 192,
        lanternCount: 0,
        birdCount: 0,
    },
    Low: {
        starCount: 350,
        fireflyCount: 70,
        mistLayers: 4,
        petalCount: 40,
        reedCount: 50,
        lilyCount: 5,
        enableBloom: true,
        bloomStrength: 0.5,
        enableAurora: true,
        enableGodRays: false,
        maxRipples: 4,
        maxMistBursts: 3,
        reflectionRT: 256,
        lanternCount: 2,
        birdCount: 2,
    },
    Medium: {
        starCount: 550,
        fireflyCount: 100,
        mistLayers: 5,
        petalCount: 60,
        reedCount: 80,
        lilyCount: 7,
        enableBloom: true,
        bloomStrength: 0.55,
        enableAurora: true,
        enableGodRays: true,
        maxRipples: 5,
        maxMistBursts: 4,
        reflectionRT: 320,
        lanternCount: 4,
        birdCount: 3,
    },
    High: {
        starCount: 800,
        fireflyCount: 150,
        mistLayers: 6,
        petalCount: 90,
        reedCount: 120,
        lilyCount: 10,
        enableBloom: true,
        bloomStrength: 0.6,
        enableAurora: true,
        enableGodRays: true,
        maxRipples: 6,
        maxMistBursts: 5,
        reflectionRT: 384,
        lanternCount: 6,
        birdCount: 4,
    },
    Ultra: {
        starCount: 1200,
        fireflyCount: 220,
        mistLayers: 8,
        petalCount: 140,
        reedCount: 180,
        lilyCount: 15,
        enableBloom: true,
        bloomStrength: 0.7,
        enableAurora: true,
        enableGodRays: true,
        maxRipples: 8,
        maxMistBursts: 7,
        reflectionRT: 512,
        lanternCount: 8,
        birdCount: 5,
    },
    Extreme: {
        starCount: 1800,
        fireflyCount: 320,
        mistLayers: 10,
        petalCount: 200,
        reedCount: 260,
        lilyCount: 20,
        enableBloom: true,
        bloomStrength: 0.8,
        enableAurora: true,
        enableGodRays: true,
        maxRipples: 10,
        maxMistBursts: 10,
        reflectionRT: 768,
        lanternCount: 12,
        birdCount: 6,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class MistyLakeTheme extends BaseTheme {
    constructor() {
        super('misty-lake');
        console.log('[MistyLake] Constructor called!');

        // Mark as heavy-gpu so BaseTheme.releaseManagedGpuResources runs on stop
        this.resourceProfile = 'heavy-gpu';

        // URL debug flags
        this.flags = parseMistyLakeFlags();
        this.forceWebGL = this.flags.forceWebGL;
        this.isWebGPU = false;
        this.isWebGL = false;

        // Three.js components
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.bloomPass = null;
        this.mainGroup = null;

        // Scene elements
        this.sky = null;
        this.skyMaterial = null;
        this.water = null;
        this.waterMaterial = null;
        this.moon = null;
        this.moonMaterial = null;
        this.aurora = null;
        this.auroraMaterial = null;
        this.godRays = null;
        this.godRayMaterial = null;
        this.stars = null;
        this.starsMaterial = null;
        this.fireflies = null;
        this.fireflyMaterial = null;
        this.petals = null;
        this.petalMaterial = null;
        this.lilyPads = [];
        this.lilyPadMaterials = [];
        this.reeds = [];
        this.reedMaterials = [];
        this.birds = null;
        this.birdMaterial = null;
        this.birdMaterials = null;
        this.birdData = null;
        this.mistLayers = [];
        this.mistMaterials = [];
        this.mountains = [];
        this.mountainMaterials = [];
        this.trees = [];
        this.treeMaterials = [];

        // Performance monitor wiring
        this._spikeContextRegistered = false;
        this.postProcessingDisabledReason = null;

        // Effects
        this.ripples = [];
        this.mistBursts = [];
        this.lightBurst = null;
        this.lightBurstMaterial = null;

        // Animation state
        this.clock = new THREE.Clock();
        this.time = 0;
        this.animationFrameId = null;
        this.renderFrameToken = 0;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.lastRippleTime = 0;

        // Effect state
        this.glowIntensity = 0;
        this.targetGlowIntensity = 0;
        this.bloomBoost = 0;
        this.currentComboLevel = 0;
        this.windStrength = 1.0;

        // Camera state - deeper breathing
        this.baseCameraPos = new THREE.Vector3(0, 7, 38);
        this.cameraBreathPhase = 0;

        // Single source of truth for moon position (used by water reflection + moon mesh)
        this.moonPosition = new THREE.Vector3(18, 40, -70);

        // Event handlers
        this.eventUnsubscribers = [];
        this.boundMouseMoveHandler = this.onMouseMove.bind(this);
        this.boundResizeHandler = this.onWindowResize.bind(this);
        this.effectTimeouts = new Set();

        // Quality
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[MistyLake] Constructor complete!');
    }

    scheduleEffectTimeout(callback, delayMs = 0) {
        const timeoutId = window.setTimeout(() => {
            this.effectTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.effectTimeouts.add(timeoutId);
        return timeoutId;
    }

    clearEffectTimeouts() {
        this.effectTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.effectTimeouts.clear();
    }

    getTetrominoConfig() {
        return MISTY_LAKE_TETROMINOS;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[MistyLake] Creating enhanced 3D scene...');

        const quality = this.getGraphicsQuality();
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;

        let container = document.getElementById('misty-lake-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'misty-lake-theme';
            container.className = 'theme-container';
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
                pointerEvents: 'none',
                opacity: '0',
            });
            document.body.insertBefore(container, document.body.firstChild);
        }
        container.innerHTML = '';
        this.container = container;

        this.initRenderer();
        this.initScene();
        this.initCamera();

        // Create scene elements (order matters for layering)
        this.createSky();
        this.createMountains();
        this.createMoon();
        if (this.qualityPreset.enableAurora) this.createAurora();
        this.createStars();
        if (this.qualityPreset.enableGodRays) this.createGodRays();
        this.createWater();
        this.createMistLayers();
        // Phase 3: actually instantiate the unused shaders
        this.createLilyPads();
        this.createReeds();
        this.createFireflies();
        if (this.qualityPreset.petalCount > 0) this.createPetals();
        this.createTrees();
        // Phase 3: Smash-stage foreground proscenium
        this.createForegroundFraming();
        // Phase 7: distant warm spirit lanterns (cast reflection columns in water)
        if (this.qualityPreset.lanternCount > 0) this.createDistantLanterns();
        // Phase 6: distant flying birds
        if (this.qualityPreset.birdCount > 0) this.createBirds();
        this.createLightBurst();
        this.setupLighting();

        if (this.qualityPreset.enableBloom && !this.flags.noPost) {
            this.setupPostProcessing();
        }

        // Register spike context for performance monitor diagnostics
        if (!this._spikeContextRegistered && performanceMonitor?.setSpikeContextCollector) {
            performanceMonitor.setSpikeContextCollector(() => ({
                theme: 'misty-lake',
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                preset: this.getGraphicsQuality(),
                fireflies: this.qualityPreset?.fireflyCount || 0,
                ripples: this.ripples?.length || 0,
                mistBursts: this.mistBursts?.length || 0,
            }));
            this._spikeContextRegistered = true;
        }

        this.setupEventListeners();

        // Interactive ripples
        window.addEventListener('mousemove', this.boundMouseMoveHandler);

        window.addEventListener('resize', this.boundResizeHandler);

        // FIRST-FRAME WARM, EXPERIMENT 3 (2026-08-26, sweep §38). §35 falsified program
        // compile (awaited classic compileAsync: gap −2.7 %); experiment 2 falsified texture
        // upload (initTexture over every reachable texture: gap −2.8 %, and the switch did not
        // even grow — nothing costly to upload). This is the decisive form: ONE REAL RENDER
        // before the loop starts does everything the first live frame would — program compiles
        // under live state, uploads, buffer init — synchronously behind the switch mask. If the
        // 1.4 s gap survives THIS, it is not first-frame work at all, and the classic fleet's
        // gap class needs re-interpretation rather than warming.
        try {
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.warn('[MistyLake] Warm render failed:', error);
        }
        this.startRenderLoop();

        container.style.transition = 'opacity 1.5s ease-in';
        container.style.opacity = '1';

        console.log('[MistyLake] Enhanced 3D scene created successfully');
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setClearColor(COLORS.skyTop.getHex(), 1);
        // Explicit clear behavior — predictable across HMR reloads and
        // matches what renderReflection / composer.render() expect.
        this.renderer.autoClear = true;
        this.renderer.autoClearColor = true;
        this.renderer.autoClearDepth = true;
        this.renderer.autoClearStencil = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.container.appendChild(this.renderer.domElement);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLORS.mistColor.getHex(), 0.006);

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.1,
            600,
        );
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(0, 2, -25);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Elements
    // ─────────────────────────────────────────────────────────────────────────

    createSky() {
        const geometry = new THREE.PlaneGeometry(250, 120);

        this.skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTopColor: { value: COLORS.skyTop },
                uMiddleColor: { value: COLORS.skyMiddle },
                uHorizonColor: { value: COLORS.skyHorizon },
                uGlowIntensity: { value: 0 },
                uTime: { value: 0 },
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.DoubleSide,
        });

        this.sky = new THREE.Mesh(geometry, this.skyMaterial);
        this.sky.position.set(0, 30, -100);
        // Sky bounding sphere sits right at the camera's frustum edge;
        // disable culling to prevent it from being skipped on edge frames.
        this.sky.frustumCulled = false;
        this.mainGroup.add(this.sky);
    }

    createMountains() {
        const layerConfigs = [
            // Phase 6: 4th very-far layer for extreme atmospheric perspective
            {
                z: -115, scale: 0.9, fogAmount: 0.92, color: COLORS.mistColor,
            },
            {
                z: -80, scale: 1.0, fogAmount: 0.75, color: COLORS.mountainFar,
            },
            {
                z: -55, scale: 1.15, fogAmount: 0.5, color: COLORS.mountainMid,
            },
            {
                z: -38, scale: 1.3, fogAmount: 0.25, color: COLORS.mountainNear,
            },
        ];

        layerConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(220, 50);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uMountainColor: { value: config.color },
                    uFogColor: { value: COLORS.mistColor },
                    uFogAmount: { value: config.fogAmount },
                    uLayer: { value: index },
                    uTime: { value: 0 },
                },
                vertexShader: mountainVertexShader,
                fragmentShader: mountainFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
            });

            const mountain = new THREE.Mesh(geometry, material);
            mountain.position.set(0, 10 + index * 3, config.z);
            mountain.scale.set(config.scale, config.scale, 1);
            // Background layers — must never be culled even at frustum edges
            mountain.frustumCulled = false;

            this.mountains.push(mountain);
            this.mountainMaterials.push(material);
            this.mainGroup.add(mountain);
        });
    }

    createMoon() {
        // Inner moon disc — bigger (28 instead of 18) for cinematic focal weight
        const geometry = new THREE.PlaneGeometry(26, 26);

        this.moonMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uMoonColor: { value: COLORS.moonColor },
                uHaloColor: { value: COLORS.moonHalo },
                uGlowIntensity: { value: 0 },
            },
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.moon = new THREE.Mesh(geometry, this.moonMaterial);
        this.moon.position.copy(this.moonPosition);
        this.mainGroup.add(this.moon);

        // ─────────────────────────────────────────────────────────────────
        // Anamorphic horizontal streak — Switch-game cinematic touch.
        // Wide thin additive plane creates the signature lens-flare bar.
        // ─────────────────────────────────────────────────────────────────
        const streakGeometry = new THREE.PlaneGeometry(70, 4);
        const streakMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: COLORS.moonColor },
                uGlowIntensity: { value: 0 },
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                uniform float uTime;
                uniform float uGlowIntensity;
                varying vec2 vUv;
                void main() {
                    // Horizontal gaussian falloff (sharp center, soft edges)
                    float cx = vUv.x - 0.5;
                    float cy = vUv.y - 0.5;
                    float horizFalloff = exp(-cx * cx * 6.0);
                    float vertFalloff = exp(-cy * cy * 80.0);
                    float intensity = horizFalloff * vertFalloff;
                    // Subtle pulsing
                    intensity *= 0.85 + sin(uTime * 0.7) * 0.15;
                    intensity *= 0.5 + uGlowIntensity * 0.6;
                    gl_FragColor = vec4(uColor, intensity * 0.7);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.moonStreak = new THREE.Mesh(streakGeometry, streakMaterial);
        this.moonStreak.position.copy(this.moonPosition);
        this.moonStreakMaterial = streakMaterial;
        this.mainGroup.add(this.moonStreak);

        // ─────────────────────────────────────────────────────────────────
        // Outer halo — large soft additive plane gives the moon atmosphere
        // bleed effect even before MRT bloom.
        // ─────────────────────────────────────────────────────────────────
        const haloGeometry = new THREE.PlaneGeometry(60, 60);
        const haloMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uHaloColor: { value: COLORS.moonHalo },
                uGlowIntensity: { value: 0 },
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uHaloColor;
                uniform float uTime;
                uniform float uGlowIntensity;
                varying vec2 vUv;
                void main() {
                    float dist = length(vUv - 0.5) * 2.0;
                    // Soft exponential falloff for outer glow
                    float outer = exp(-dist * dist * 4.0) * 0.4;
                    float inner = exp(-dist * dist * 14.0) * 0.6;
                    float halo = (outer + inner) * (0.85 + uGlowIntensity * 0.5);
                    // Subtle breathing pulse
                    halo *= 0.92 + sin(uTime * 0.6) * 0.08;
                    gl_FragColor = vec4(uHaloColor, halo);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.moonHalo = new THREE.Mesh(haloGeometry, haloMaterial);
        this.moonHalo.position.copy(this.moonPosition);
        // Halo slightly behind moon for proper layering
        this.moonHalo.position.z -= 1;
        this.moonHaloMaterial = haloMaterial;
        this.mainGroup.add(this.moonHalo);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Birds — distant V-shape silhouettes flying across the sky. Living
    // world punctuation; only barely visible but the eye picks them up.
    // ─────────────────────────────────────────────────────────────────────
    createBirds() {
        const count = this.qualityPreset.birdCount || 0;
        if (count <= 0) return;

        // Bird geometry: simple 3-vertex V-shape (wings outstretched)
        // We use one shared geometry across all birds via per-instance positions
        const birdVertShader = /* glsl */`
            uniform float uTime;
            uniform float uPhase;
            uniform vec3 uBirdPos;
            uniform float uWingScale;
            attribute float aWingSide;
            void main() {
                vec3 pos = position;
                // Wing flap — fold wings up/down based on time + phase
                float flap = sin(uTime * 6.0 + uPhase * 8.0);
                pos.y += abs(aWingSide) * flap * 0.18 * uWingScale;
                vec3 worldPos = pos + uBirdPos;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
            }
        `;
        const birdFragShader = /* glsl */`
            uniform vec3 uBirdColor;
            void main() {
                gl_FragColor = vec4(uBirdColor, 1.0);
            }
        `;

        // V-shape: 3 line-segment-like triangles forming wing silhouette
        const wingW = 0.8;
        const wingDip = 0.05;
        const positions = new Float32Array([
            -wingW, wingDip, 0, // left wingtip
            0, 0, 0, // body center
            wingW, wingDip, 0, // right wingtip
        ]);
        const wingSides = new Float32Array([-1, 0, 1]); // left, center, right
        const indices = [0, 1, 1, 2]; // line segments

        this.birds = new THREE.Group();
        this.birdMaterials = [];
        this.birdData = [];

        for (let i = 0; i < count; i++) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
            geom.setAttribute('aWingSide', new THREE.BufferAttribute(wingSides.slice(), 1));
            geom.setIndex(indices);

            const startX = -30 - Math.random() * 30;
            const y = 10 + Math.random() * 12;
            const z = -55 - Math.random() * 25;
            const speed = 0.8 + Math.random() * 1.5;
            const wingScale = 0.7 + Math.random() * 0.6;

            const mat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPhase: { value: Math.random() },
                    uBirdPos: { value: new THREE.Vector3(startX, y, z) },
                    uBirdColor: { value: COLORS.treeColor },
                    uWingScale: { value: wingScale },
                },
                vertexShader: birdVertShader,
                fragmentShader: birdFragShader,
                transparent: false,
            });

            const bird = new THREE.LineSegments(geom, mat);
            this.birds.add(bird);
            this.birdMaterials.push(mat);
            this.birdData.push({
                x: startX,
                y,
                z,
                speed,
                phase: Math.random() * 100,
            });
        }
        this.mainGroup.add(this.birds);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Distant lanterns — small warm-amber floating spirits that cast bright
    // reflection columns in the water via the mirror camera. Sells the
    // "spirit pond" feel and gives life punctuation to the scene.
    // ─────────────────────────────────────────────────────────────────────
    createDistantLanterns() {
        const count = this.qualityPreset.lanternCount || 0;
        if (count <= 0) return;

        const geometry = new THREE.SphereGeometry(0.18, 10, 10);

        const lanternVertShader = /* glsl */`
            uniform float uTime;
            uniform float uPhase;
            void main() {
                vec3 pos = position;
                pos.y += sin(uTime * 0.6 + uPhase * 6.28) * 0.18;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `;
        const lanternFragShader = /* glsl */`
            uniform vec3 uLanternColor;
            uniform float uTime;
            uniform float uPhase;
            void main() {
                float flicker = 0.85 + sin(uTime * 4.0 + uPhase * 12.0) * 0.15;
                gl_FragColor = vec4(uLanternColor * (1.2 + flicker), 1.0);
            }
        `;

        this.lanterns = new THREE.Group();
        this.lanternMaterials = [];

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 50;
            const y = 1.8 + Math.random() * 1.5;
            const z = -25 - Math.random() * 18;

            const mat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPhase: { value: Math.random() },
                    uLanternColor: { value: COLORS.lanternAmber },
                },
                vertexShader: lanternVertShader,
                fragmentShader: lanternFragShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const lantern = new THREE.Mesh(geometry, mat);
            lantern.position.set(x, y, z);
            this.lanterns.add(lantern);
            this.lanternMaterials.push(mat);
        }
        this.mainGroup.add(this.lanterns);
    }

    createAurora() {
        const geometry = new THREE.PlaneGeometry(180, 35);

        this.auroraMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: COLORS.auroraGreen },
                uColor2: { value: COLORS.auroraPurple },
                uIntensity: { value: 0.5 },
            },
            vertexShader: auroraVertexShader,
            fragmentShader: auroraFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.aurora = new THREE.Mesh(geometry, this.auroraMaterial);
        this.aurora.position.set(-20, 50, -90);
        this.mainGroup.add(this.aurora);
    }

    createGodRays() {
        const geometry = new THREE.PlaneGeometry(120, 80);

        this.godRayMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0.4 },
                uRayColor: { value: COLORS.rayColor },
                uMoonPosition: { value: new THREE.Vector2(0.6, 0.8) },
            },
            vertexShader: godRayVertexShader,
            fragmentShader: godRayFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.godRays = new THREE.Mesh(geometry, this.godRayMaterial);
        this.godRays.position.set(10, 25, -40);
        this.mainGroup.add(this.godRays);
    }

    createStars() {
        const count = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const brightness = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.45;
            const radius = 100 + Math.random() * 80;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = 25 + radius * Math.cos(phi) * 0.5;
            positions[i3 + 2] = -50 - radius * Math.sin(phi) * Math.sin(theta) * 0.5;

            randoms[i] = Math.random();
            brightness[i] = 0.25 + Math.random() * 0.75;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        this.starsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 3.5 },
            },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.stars = new THREE.Points(geometry, this.starsMaterial);
        this.mainGroup.add(this.stars);
    }

    createWater() {
        // 160 wide × 90 deep with offset, so the water's front edge sits at
        // z=+15 — well in FRONT of the camera (camera z≈37-39). Previously
        // the water extended to z=+55 which placed vertices BEHIND the camera
        // near plane; Gerstner-displaced triangles straddling the near plane
        // caused intermittent clipping artifacts visible as whole-frame flicker.
        const geometry = new THREE.PlaneGeometry(160, 90, 192, 80);
        geometry.rotateX(-Math.PI / 2);

        // Reflection RT size scales with quality preset
        const reflectionSize = this.qualityPreset.reflectionRT || 384;

        // Load water normal map (already in /public/textures/)
        const textureLoader = new THREE.TextureLoader();
        const waterNormals = textureLoader.load('/textures/water-normal.jpg');
        waterNormals.wrapS = THREE.RepeatWrapping;
        waterNormals.wrapT = THREE.RepeatWrapping;

        // Moon position (matches createMoon — see initMoonPosition for source of truth)
        const moonPos = this.moonPosition || new THREE.Vector3(18, 40, -70);

        // Build the spirit-pond water (mirror camera + Gerstner + caustics + foam)
        this.water = new MistyLakeWater(geometry, {
            textureWidth: reflectionSize,
            textureHeight: reflectionSize,
            waterNormals,
            moonDirection: moonPos.clone().normalize(),
            moonColor: COLORS.moonColor,
            deepColor: COLORS.waterDeep,
            shallowColor: COLORS.waterShallow,
            distortionScale: 1.4,
            reflectionStrength: this.flags.enableReflection && !this.flags.noReflection ? 0.45 : 0.0,
            alpha: 0.97,
            fog: true,
            side: THREE.DoubleSide,
        });

        // Shift water -30 in z so it sits in front of camera (z=-75 far edge,
        // z=+15 near edge). Camera at z≈38 → water stays well in front.
        this.water.position.set(0, 0, -30);

        // Set the moon world position uniform for column placement
        this.water.material.uniforms.uMoonPosition.value.copy(moonPos);

        // Expose material for updateUniforms() compatibility
        this.waterMaterial = this.water.material;

        // Always render — water bounding sphere is large and camera sits very
        // close to it; frustum culling at the boundary could cause it to flip
        // in/out of rendering as the camera breathes.
        this.water.frustumCulled = false;

        // Keep mirror reflections opt-in. The reflection pass is visually nice,
        // but it is the only Misty Lake path that performs an offscreen nested
        // scene render before the composer; on Windows Electron this can
        // intermittently black-frame the compositor on fragile drivers.
        if (!this.flags.enableReflection || this.flags.noReflection) {
            this.water.disableReflection = true;
            this.water.material.uniforms.uReflectionStrength.value = 0.0;
        }

        this.mainGroup.add(this.water);
    }

    createMistLayers() {
        const layerCount = this.qualityPreset.mistLayers;

        for (let i = 0; i < layerCount; i++) {
            const depth = -8 - i * 7;
            const height = 15 + i * 3;
            const geometry = new THREE.PlaneGeometry(180, height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uDensity: { value: 0.35 + i * 0.06 },
                    uMistColor: { value: COLORS.mistColor },
                    uSpeed: { value: 0.08 + Math.random() * 0.08 },
                    uWind: { value: 1.0 },
                },
                vertexShader: mistVertexShader,
                fragmentShader: mistFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, height / 2 + 0.5, depth);
            // Mist must always render — culling these large planar layers
            // produces visible gaps in atmosphere
            mist.frustumCulled = false;

            this.mistLayers.push(mist);
            this.mistMaterials.push(material);
            this.mainGroup.add(mist);
        }
    }

    createFireflies() {
        // For perf, cap mesh fireflies at 60% of the legacy point count
        // (each mesh costs more but looks much better).
        const count = Math.floor(this.qualityPreset.fireflyCount * 0.6);
        if (count <= 0) return;

        // Tiny sphere geometry — inner spirit core
        const coreGeometry = new THREE.SphereGeometry(0.06, 8, 6);

        // Per-instance attributes for organic motion variation
        const seeds = new Float32Array(count);
        const basePositions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            seeds[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
            basePositions[i * 3 + 0] = (Math.random() - 0.5) * 90;
            basePositions[i * 3 + 1] = 1.8 + Math.random() * 14;
            basePositions[i * 3 + 2] = -6 - Math.random() * 48;
        }

        const fireflyVertShader = /* glsl */`
            uniform float uTime;
            attribute float aSeed;
            attribute vec3 aBasePos;
            attribute float aPhase;
            varying float vGlow;
            varying float vSeed;
            void main() {
                vSeed = aSeed;
                // Organic figure-8 drift in horizontal plane + gentle vertical bob
                vec3 offset = vec3(
                    sin(uTime * 0.4 + aPhase) * 1.5 + cos(uTime * 0.27 + aPhase * 1.4) * 0.9,
                    sin(uTime * 0.32 + aPhase * 1.7) * 0.6,
                    cos(uTime * 0.36 + aPhase) * 1.2 + sin(uTime * 0.21 + aPhase * 2.1) * 0.7
                );
                vec3 worldPos = aBasePos + offset + position;
                // Glow pulse — dual frequency for organic feel
                float pulseA = 0.65 + sin(uTime * 1.6 + aPhase * 4.0) * 0.35;
                float pulseB = 0.85 + cos(uTime * 0.8 + aSeed * 7.0) * 0.15;
                vGlow = pulseA * pulseB;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
            }
        `;
        const fireflyFragShader = /* glsl */`
            uniform vec3 uColor;
            varying float vGlow;
            varying float vSeed;
            void main() {
                // Bright hot center with color variation per firefly
                vec3 col = uColor * (1.0 + vSeed * 0.3);
                col *= 1.4 * vGlow; // moderate emissive — bloom (threshold 0.4) picks it up
                gl_FragColor = vec4(col, 1.0);
            }
        `;

        this.fireflyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: COLORS.fireflyColor },
            },
            vertexShader: fireflyVertShader,
            fragmentShader: fireflyFragShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        // Use BufferGeometryUtils-free approach: build instanced geometry manually
        const instancedGeom = new THREE.InstancedBufferGeometry();
        instancedGeom.setAttribute('position', coreGeometry.getAttribute('position'));
        instancedGeom.setAttribute('normal', coreGeometry.getAttribute('normal'));
        instancedGeom.setIndex(coreGeometry.getIndex());
        instancedGeom.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        instancedGeom.setAttribute('aBasePos', new THREE.InstancedBufferAttribute(basePositions, 3));
        instancedGeom.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        instancedGeom.instanceCount = count;

        this.fireflies = new THREE.Mesh(instancedGeom, this.fireflyMaterial);
        // Disable frustum culling — fireflies use instance attributes for positions
        // so the bounding sphere of the base geometry doesn't reflect actual spread
        this.fireflies.frustumCulled = false;
        this.mainGroup.add(this.fireflies);

        // ─────────────────────────────────────────────────────────────────
        // Halo orbs — slightly larger additive spheres around each firefly.
        // Bloom amplifies these into the soft warm haze halos.
        // ─────────────────────────────────────────────────────────────────
        const haloGeometry = new THREE.SphereGeometry(0.22, 8, 6);

        const haloFragShader = /* glsl */`
            uniform vec3 uColor;
            varying float vGlow;
            varying float vSeed;
            varying vec3 vNormal;
            void main() {
                // Soft fresnel-like fade for the halo
                float fade = pow(max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 0.6);
                vec3 col = uColor * (1.0 + vSeed * 0.2);
                col *= 0.8 * vGlow * fade;
                gl_FragColor = vec4(col, fade * 0.45);
            }
        `;
        const haloVertShader = /* glsl */`
            uniform float uTime;
            attribute float aSeed;
            attribute vec3 aBasePos;
            attribute float aPhase;
            varying float vGlow;
            varying float vSeed;
            varying vec3 vNormal;
            void main() {
                vSeed = aSeed;
                vNormal = normalize(normalMatrix * normal);
                vec3 offset = vec3(
                    sin(uTime * 0.4 + aPhase) * 1.5 + cos(uTime * 0.27 + aPhase * 1.4) * 0.9,
                    sin(uTime * 0.32 + aPhase * 1.7) * 0.6,
                    cos(uTime * 0.36 + aPhase) * 1.2 + sin(uTime * 0.21 + aPhase * 2.1) * 0.7
                );
                vec3 worldPos = aBasePos + offset + position;
                float pulseA = 0.65 + sin(uTime * 1.6 + aPhase * 4.0) * 0.35;
                float pulseB = 0.85 + cos(uTime * 0.8 + aSeed * 7.0) * 0.15;
                vGlow = pulseA * pulseB;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
            }
        `;

        this.fireflyHaloMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: COLORS.fireflyColor },
            },
            vertexShader: haloVertShader,
            fragmentShader: haloFragShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const haloInstancedGeom = new THREE.InstancedBufferGeometry();
        haloInstancedGeom.setAttribute('position', haloGeometry.getAttribute('position'));
        haloInstancedGeom.setAttribute('normal', haloGeometry.getAttribute('normal'));
        haloInstancedGeom.setIndex(haloGeometry.getIndex());
        haloInstancedGeom.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        haloInstancedGeom.setAttribute('aBasePos', new THREE.InstancedBufferAttribute(basePositions, 3));
        haloInstancedGeom.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        haloInstancedGeom.instanceCount = count;

        this.fireflyHalos = new THREE.Mesh(haloInstancedGeom, this.fireflyHaloMaterial);
        this.fireflyHalos.frustumCulled = false;
        this.mainGroup.add(this.fireflyHalos);
    }

    createPetals() {
        const count = this.qualityPreset.petalCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 120;
            positions[i3 + 1] = Math.random() * 40;
            positions[i3 + 2] = -10 - Math.random() * 60;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;

            // Random petal color
            const color = Math.random() > 0.5 ? COLORS.petalPink : COLORS.petalWhite;
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        this.petalMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 4.0 },
            },
            vertexShader: petalVertexShader,
            fragmentShader: petalFragmentShader,
            transparent: true,
            depthWrite: false,
        });

        this.petals = new THREE.Points(geometry, this.petalMaterial);
        this.mainGroup.add(this.petals);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Lily Pads — finally instantiated. Scattered in 3 clusters for natural
    // distribution. One in five pads carries a closed lotus (warm accent).
    // ─────────────────────────────────────────────────────────────────────
    createLilyPads() {
        const count = this.qualityPreset.lilyCount;
        if (count <= 0) return;

        // Three natural clusters for a non-uniform scatter
        const clusters = [
            { cx: -8, cz: -12, radius: 5.5 },
            { cx: 10, cz: -18, radius: 6.0 },
            { cx: -3, cz: -8, radius: 4.0 },
        ];

        for (let i = 0; i < count; i++) {
            const cluster = clusters[i % clusters.length];
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * cluster.radius;
            const x = cluster.cx + Math.cos(angle) * r;
            const z = cluster.cz + Math.sin(angle) * r;

            const size = 0.55 + Math.random() * 0.35;
            const geometry = new THREE.CircleGeometry(size, 24);
            geometry.rotateX(-Math.PI / 2);

            // Lotus-bearing pads carry warm-orange flower accent
            const hasLotus = (i % 5) === 0;
            const flowerColor = hasLotus ? COLORS.lotusOrange : COLORS.lilyPadGreen;

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: Math.random() * 10 },
                    uPadColor: { value: COLORS.lilyPadGreen },
                    uFlowerColor: { value: flowerColor },
                },
                vertexShader: lilyVertexShader,
                fragmentShader: lilyFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const pad = new THREE.Mesh(geometry, material);
            pad.position.set(x, 0.05, z);
            pad.rotation.y = Math.random() * Math.PI * 2;

            this.lilyPads.push(pad);
            this.lilyPadMaterials.push(material);
            this.mainGroup.add(pad);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Reeds / cattails — slim vertical blades clustered at shore corners.
    // Single BufferGeometry per clump for efficiency.
    // ─────────────────────────────────────────────────────────────────────
    createReeds() {
        const totalReeds = this.qualityPreset.reedCount;
        if (totalReeds <= 0) return;

        // Distribution: left-near, right-near, far-left foreground
        const clumps = [
            {
                cx: -22, cz: -3, radius: 5.5, frac: 0.35,
            },
            {
                cx: 24, cz: -3, radius: 5.5, frac: 0.35,
            },
            {
                cx: -32, cz: -18, radius: 6.0, frac: 0.20,
            },
            {
                cx: 32, cz: -18, radius: 6.0, frac: 0.10,
            },
        ];

        clumps.forEach((clump) => {
            const reedCount = Math.max(4, Math.floor(totalReeds * clump.frac));

            const positions = new Float32Array(reedCount * 6); // 2 verts per blade
            const heights = new Float32Array(reedCount * 2);
            const phases = new Float32Array(reedCount * 2);
            const indices = [];

            for (let i = 0; i < reedCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * clump.radius;
                const bx = clump.cx + Math.cos(angle) * r;
                const bz = clump.cz + Math.sin(angle) * r;
                const bladeHeight = 2.5 + Math.random() * 2.5;
                const phase = Math.random();

                // Base vertex (y=0)
                positions[i * 6 + 0] = bx;
                positions[i * 6 + 1] = 0.0;
                positions[i * 6 + 2] = bz;
                heights[i * 2 + 0] = 0.0;
                phases[i * 2 + 0] = phase;

                // Tip vertex
                positions[i * 6 + 3] = bx;
                positions[i * 6 + 4] = bladeHeight;
                positions[i * 6 + 5] = bz;
                heights[i * 2 + 1] = 1.0;
                phases[i * 2 + 1] = phase;

                indices.push(i * 2, i * 2 + 1);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geometry.setIndex(indices);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uWind: { value: 1.0 },
                    uReedColor: { value: COLORS.reedColor },
                    uTipColor: { value: COLORS.mistColor },
                },
                vertexShader: reedVertexShader,
                fragmentShader: reedFragmentShader,
                transparent: true,
            });

            const reedMesh = new THREE.LineSegments(geometry, material);
            this.reeds.push(reedMesh);
            this.reedMaterials.push(material);
            this.mainGroup.add(reedMesh);
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Foreground framing — Smash-stage proscenium. Hero silhouette branches
    // arching from top corners with procedural alpha mask for tree shape.
    // ─────────────────────────────────────────────────────────────────────
    createForegroundFraming() {
        // Hero tree fragment shader — SMOOTH ALPHA silhouette (no hard discard).
        // The previous `if (mask < 0.5) discard` created per-pixel flicker as
        // the tree swayed: pixels right at the threshold alternated between
        // rendered (opaque) and discarded each frame. Smooth alpha blending
        // produces a stable anti-aliased edge instead.
        const heroFragShader = /* glsl */`
            uniform vec3 uTreeColor;
            uniform float uMirror; // 1.0 or -1.0 for left/right tree

            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                if (uMirror < 0.0) uv.x = 1.0 - uv.x;

                // Trunk: tapered column on outer edge, sweeping inward upward.
                float trunkX = 0.88 - uv.y * 0.18;
                float trunkHalfWidth = mix(0.18, 0.05, uv.y);
                float trunkDist = abs(uv.x - trunkX) / trunkHalfWidth;
                float trunk = 1.0 - smoothstep(0.85, 1.05, trunkDist);

                // Canopy: soft radial blob at top-outer corner.
                float branchY = smoothstep(0.45, 0.95, uv.y);
                float canopyDx = uv.x - 0.85;
                float canopyDy = uv.y - 0.8;
                float canopyDist = sqrt(canopyDx * canopyDx + canopyDy * canopyDy * 0.6);
                float canopy = (1.0 - smoothstep(0.22, 0.55, canopyDist)) * branchY;

                float mask = max(trunk, canopy);

                // Smooth fades at top and bottom so the tree blends into ground/sky
                mask *= smoothstep(0.0, 0.05, uv.y);
                mask *= smoothstep(1.0, 0.95, uv.y);

                // Smooth alpha (NO hard discard threshold — that was the
                // flicker source). Only discard fragments that are essentially
                // fully transparent to avoid wasted overdraw.
                float alpha = smoothstep(0.2, 0.7, mask);
                if (alpha < 0.02) discard;
                gl_FragColor = vec4(uTreeColor, alpha);
            }
        `;

        // Reduced sway amplitude (0.4 → 0.22). Strong sway combined with the
        // hard discard previously amplified the edge flicker.
        const heroVertShader = /* glsl */`
            uniform float uTime;
            uniform float uWind;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vec3 pos = position;
                float sway = sin(uTime * 0.3 + position.y * 0.05) * uWind * 0.22;
                pos.x += sway * smoothstep(0.0, 1.0, (position.y + 5.0) / 30.0);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `;

        const heroConfigs = [
            {
                x: -24, y: 12, z: 4, w: 22, h: 36, mirror: 1.0,
            },
            {
                x: 24, y: 12, z: 4, w: 22, h: 36, mirror: -1.0,
            },
        ];

        heroConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.w, config.h, 1, 1);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uWind: { value: 1.0 },
                    uTreeColor: { value: COLORS.treeColor },
                    uMirror: { value: config.mirror },
                },
                vertexShader: heroVertShader,
                fragmentShader: heroFragShader,
                transparent: true,
                // FrontSide (was DoubleSide): one fewer draw per tree and
                // removes the back-face overdraw that compounded edge flicker.
                side: THREE.FrontSide,
                depthWrite: false,
            });

            const tree = new THREE.Mesh(geometry, material);
            tree.position.set(config.x, config.y, config.z);
            // Render order ensures trees draw after the water consistently,
            // avoiding any ambiguity in transparent sort order.
            tree.renderOrder = 5;
            this.trees.push(tree);
            this.treeMaterials.push(material);
            this.mainGroup.add(tree);
        });
    }

    createTrees() {
        const treeConfigs = [
            // Left side
            {
                x: -58, y: 18, z: -12, width: 18, height: 42,
            },
            {
                x: -45, y: 14, z: -6, width: 14, height: 32,
            },
            {
                x: -65, y: 22, z: -28, width: 22, height: 50,
            },
            // Right side
            {
                x: 55, y: 16, z: -10, width: 16, height: 38,
            },
            {
                x: 65, y: 20, z: -24, width: 20, height: 45,
            },
            {
                x: 48, y: 12, z: -4, width: 12, height: 28,
            },
        ];

        treeConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uWind: { value: 1.0 },
                    uTreeColor: { value: COLORS.treeColor },
                    uFogColor: { value: COLORS.mistColor },
                    uFogAmount: { value: Math.abs(config.z) / 60 },
                },
                vertexShader: treeVertexShader,
                fragmentShader: treeFragmentShader,
                side: THREE.DoubleSide,
            });

            const tree = new THREE.Mesh(geometry, material);
            tree.position.set(config.x, config.y, config.z);

            this.trees.push(tree);
            this.treeMaterials.push(material);
            this.mainGroup.add(tree);
        });
    }

    createLightBurst() {
        const geometry = new THREE.PlaneGeometry(100, 100);

        this.lightBurstMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uIntensity: { value: 1.0 },
                uColor: { value: COLORS.burstColor },
                uTime: { value: 0 },
            },
            vertexShader: lightBurstVertexShader,
            fragmentShader: lightBurstFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.lightBurst = new THREE.Mesh(geometry, this.lightBurstMaterial);
        this.lightBurst.position.set(0, 12, 15);
        this.lightBurst.visible = false;
        this.mainGroup.add(this.lightBurst);
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x2a3858, 0.35);
        this.scene.add(ambientLight);

        const moonLight = new THREE.DirectionalLight(COLORS.moonColor, 0.45);
        moonLight.position.set(18, 40, -30);
        this.scene.add(moonLight);

        const fillLight = new THREE.PointLight(COLORS.waterShallow, 0.25, 60);
        fillLight.position.set(0, 4, 0);
        this.scene.add(fillLight);
    }

    getSafeViewportSize() {
        return {
            width: Math.max(1, window.innerWidth || 1),
            height: Math.max(1, window.innerHeight || 1),
        };
    }

    createLdrRenderTarget(width, height, name, options = {}) {
        const target = new THREE.WebGLRenderTarget(
            Math.max(1, Math.floor(width)),
            Math.max(1, Math.floor(height)),
            {
                format: THREE.RGBAFormat,
                type: THREE.UnsignedByteType,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                depthBuffer: options.depthBuffer ?? false,
                stencilBuffer: false,
            },
        );
        target.texture.name = name;
        target.texture.generateMipmaps = false;
        return target;
    }

    replaceRenderTargetWithLdr(target, name, options = {}) {
        const replacement = this.createLdrRenderTarget(
            target?.width || 1,
            target?.height || 1,
            name,
            options,
        );
        if (target && typeof target.dispose === 'function') {
            target.dispose();
        }
        return replacement;
    }

    forceBloomPassLdrTargets(bloomPass) {
        if (!bloomPass) return;

        bloomPass.renderTargetBright = this.replaceRenderTargetWithLdr(
            bloomPass.renderTargetBright,
            'MistyLakeBloom.bright',
        );

        bloomPass.renderTargetsHorizontal = bloomPass.renderTargetsHorizontal.map((target, index) => (
            this.replaceRenderTargetWithLdr(target, `MistyLakeBloom.h${index}`)
        ));

        bloomPass.renderTargetsVertical = bloomPass.renderTargetsVertical.map((target, index) => (
            this.replaceRenderTargetWithLdr(target, `MistyLakeBloom.v${index}`)
        ));
    }

    validateRenderTargetFramebuffer(renderTarget, label) {
        if (!this.renderer || !renderTarget) return false;

        const gl = typeof this.renderer.getContext === 'function'
            ? this.renderer.getContext()
            : null;
        if (!gl || typeof gl.checkFramebufferStatus !== 'function') return true;

        const currentRenderTarget = this.renderer.getRenderTarget();

        try {
            this.renderer.setRenderTarget(renderTarget);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                console.warn(`[MistyLake] ${label} framebuffer incomplete; disabling post-processing`, status);
                return false;
            }
            return true;
        } catch (error) {
            console.warn(`[MistyLake] Could not validate ${label}; disabling post-processing`, error);
            return false;
        } finally {
            this.renderer.setRenderTarget(currentRenderTarget);
            if (typeof this.renderer.resetState === 'function') {
                this.renderer.resetState();
            }
        }
    }

    validatePostProcessingTargets() {
        if (!this.composer) return false;

        const targets = [
            [this.composer.renderTarget1, 'composer rt1'],
            [this.composer.renderTarget2, 'composer rt2'],
            [this.bloomPass?.renderTargetBright, 'bloom bright'],
            ...(this.bloomPass?.renderTargetsHorizontal || []).map((target, index) => [target, `bloom h${index}`]),
            ...(this.bloomPass?.renderTargetsVertical || []).map((target, index) => [target, `bloom v${index}`]),
        ];

        return targets.every(([target, label]) => this.validateRenderTargetFramebuffer(target, label));
    }

    disposePostProcessing() {
        if (this.bloomPass && typeof this.bloomPass.dispose === 'function') {
            this.bloomPass.dispose();
        }
        if (this.ghibliPass && typeof this.ghibliPass.dispose === 'function') {
            this.ghibliPass.dispose();
        }
        if (this.composer && typeof this.composer.dispose === 'function') {
            this.composer.dispose();
        }

        this.composer = null;
        this.bloomPass = null;
        this.ghibliPass = null;
    }

    disablePostProcessing(reason) {
        this.postProcessingDisabledReason = reason;
        console.warn(`[MistyLake] Disabling post-processing: ${reason}`);
        this.disposePostProcessing();
    }

    setupPostProcessing() {
        const { width, height } = this.getSafeViewportSize();
        const composerTarget = this.createLdrRenderTarget(
            width,
            height,
            'MistyLakeComposer.rt1',
            { depthBuffer: true },
        );

        // Three's EffectComposer and UnrealBloomPass default to HalfFloatType
        // render targets. Some Windows/Electron GPU stacks report support but
        // intermittently black-frame while resolving those targets, so Misty
        // Lake uses LDR targets for the post chain and keeps bloom conservative.
        this.composer = new EffectComposer(this.renderer, composerTarget);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // UnrealBloomPass — threshold 0.4 so only bright emissives bloom
        // (moon, fireflies, lotus, lanterns, moon column). Lower threshold
        // blew out the water surface previously.
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.qualityPreset.bloomStrength,
            0.7,
            0.4,
        );
        this.forceBloomPassLdrTargets(this.bloomPass);
        this.composer.addPass(this.bloomPass);

        // ─────────────────────────────────────────────────────────────────
        // Cinematic Ghibli grade — vignette + chromatic aberration +
        // teal-violet color grade + subtle film grain. Final polish layer.
        // ─────────────────────────────────────────────────────────────────
        const ghibliGradeShader = {
            uniforms: {
                tDiffuse: { value: null },
                uTime: { value: 0 },
                uVignette: { value: 0.45 },
                uCAStrength: { value: 0.0008 }, // very subtle CA — no color fringing on contrast edges
                uGradeLift: { value: new THREE.Vector3(0.02, 0.025, 0.05) }, // gentle indigo shadow lift
                uGradeGain: { value: new THREE.Vector3(1.0, 1.01, 1.03) }, // subtle cool tint
                uSaturation: { value: 1.05 }, // slight saturation boost
                uGrainAmount: { value: 0.02 },
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D tDiffuse;
                uniform float uTime;
                uniform float uVignette;
                uniform float uCAStrength;
                uniform vec3 uGradeLift;
                uniform vec3 uGradeGain;
                uniform float uSaturation;
                uniform float uGrainAmount;

                varying vec2 vUv;

                // Cheap pseudo-random for film grain
                float rand(vec2 co) {
                    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main() {
                    vec2 uv = vUv;
                    vec2 center = uv - 0.5;
                    float dist = length(center);

                    // ── Chromatic aberration (radial, strength scales with distance from center)
                    vec2 caDir = center * uCAStrength * (1.0 + dist * 2.0);
                    float r = texture2D(tDiffuse, uv - caDir).r;
                    float g = texture2D(tDiffuse, uv).g;
                    float b = texture2D(tDiffuse, uv + caDir).b;
                    vec3 col = vec3(r, g, b);

                    // ── Ghibli color grade: lift shadows toward indigo, gain
                    //    highlights toward cool teal, boost saturation slightly
                    col = col + uGradeLift * (1.0 - col);
                    col = col * uGradeGain;
                    float luma = dot(col, vec3(0.299, 0.587, 0.114));
                    col = mix(vec3(luma), col, uSaturation);

                    // ── Subtle film grain (time-animated)
                    float grain = (rand(uv + fract(uTime * 0.1)) - 0.5) * uGrainAmount;
                    col += grain;

                    // ── Vignette (radial darkening from center)
                    float vignette = 1.0 - dist * dist * uVignette * 2.4;
                    vignette = clamp(vignette, 0.0, 1.0);
                    col *= vignette;

                    gl_FragColor = vec4(col, 1.0);
                }
            `,
        };

        this.ghibliPass = new ShaderPass(ghibliGradeShader);
        // Force the final pass to render to the canvas. EffectComposer
        // normally auto-sets this on the last-added pass each frame, but if
        // the internal pass tracking gets out of sync (e.g. after the mirror
        // render's renderer.resetState()), the chain may render into an
        // intermediate target that never reaches the canvas → black frame.
        this.ghibliPass.renderToScreen = true;
        this.composer.addPass(this.ghibliPass);

        // Pin the composer's internal render targets to canvas dimensions.
        // EffectComposer auto-sizes its RTs on creation, but if any timing
        // jitter happens between renderer init and composer creation, the
        // RTs could end up the wrong size and produce black frames.
        this.composer.setSize(width, height);

        if (!this.validatePostProcessingTargets()) {
            this.disablePostProcessing('framebuffer validation failed');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    startRenderLoop() {
        if (!this.isActive || this.isPaused || this.animationFrameId !== null) return;

        const frameToken = ++this.renderFrameToken;
        this.animationFrameId = requestAnimationFrame(() => this.animate(frameToken));
        this.registerAnimation(this.animationFrameId);
    }

    animate(frameToken = null) {
        // App visibility/theme resume code may call animate() directly. If our
        // loop already has a frame queued, ignore that extra call so mirror
        // render-target updates cannot interleave across duplicate RAF chains.
        if (frameToken === null && this.animationFrameId !== null) return;

        if (frameToken !== null) {
            if (frameToken !== this.renderFrameToken) return;
            this.animationFrameId = null;
        }

        if (!this.isActive || this.isPaused) {
            this.animationFrameId = null;
            return;
        }

        const delta = this.clock.getDelta();
        this.time += delta;

        this.updateUniforms();
        this.animateCamera(delta);
        this.animateEffects(delta);
        this.updateRipples(delta);
        this.updateMistBursts(delta);

        // Render mirror reflection BEFORE the composer chain.
        // Doing this inside Water.onBeforeRender (which fires from inside the
        // composer's RenderPass) caused intermittent whole-screen black
        // frames as the nested render corrupted EffectComposer state.
        if (this.water && typeof this.water.renderReflection === 'function') {
            this.water.renderReflection(this.renderer, this.scene, this.camera);

            // Defensive viewport/scissor reset. setRenderTarget(null) inside
            // renderReflection restores Three.js's internal viewport tracking
            // to canvas size, but the underlying WebGL scissor/viewport state
            // can still be left at 384×384 (the mirror RT size). The composer
            // assumes full canvas dimensions for its intermediate passes —
            // any mismatch produces an entirely black composite frame.
            const { width, height } = this.getSafeViewportSize();
            this.renderer.setViewport(0, 0, width, height);
            this.renderer.setScissor(0, 0, width, height);
            this.renderer.setScissorTest(false);
            this.renderer.setRenderTarget(null);
        }

        if (this.composer && this.qualityPreset.enableBloom && !this.flags.noPost) {
            try {
                this.composer.render();
            } catch (error) {
                this.disablePostProcessing('composer render failed');
                console.warn('[MistyLake] Falling back to direct render after post-processing failure', error);
                this.renderer.setRenderTarget(null);
                this.renderer.render(this.scene, this.camera);
            }
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        // Phase D.1: feed renderer.info counters to performance monitor
        if (this.renderer?.info && performanceMonitor?.recordCounters) {
            const info = this.renderer.info;
            performanceMonitor.recordCounters({
                calls: info.render?.calls || 0,
                triangles: info.render?.triangles || 0,
                geometries: info.memory?.geometries || 0,
                textures: info.memory?.textures || 0,
                programs: info.programs?.length || 0,
            });
        }

        this.startRenderLoop();
    }

    updateUniforms() {
        // Water (MistyLakeWater uses uTime + uEye + uGlowIntensity)
        if (this.waterMaterial && this.waterMaterial.uniforms.uTime) {
            this.waterMaterial.uniforms.uTime.value = this.time;
            if (this.waterMaterial.uniforms.uGlowIntensity) {
                this.waterMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
            }
            if (this.waterMaterial.uniforms.uEye && this.camera) {
                this.waterMaterial.uniforms.uEye.value.setFromMatrixPosition(this.camera.matrixWorld);
            }
        }

        // Moon (disc, streak, halo)
        if (this.moonMaterial) {
            this.moonMaterial.uniforms.uTime.value = this.time;
            this.moonMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
        }
        if (this.moonStreakMaterial) {
            this.moonStreakMaterial.uniforms.uTime.value = this.time;
            this.moonStreakMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
        }
        if (this.moonHaloMaterial) {
            this.moonHaloMaterial.uniforms.uTime.value = this.time;
            this.moonHaloMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
        }

        // Distant lanterns
        if (this.lanternMaterials) {
            this.lanternMaterials.forEach((mat) => {
                mat.uniforms.uTime.value = this.time;
            });
        }

        // Aurora
        if (this.auroraMaterial) {
            this.auroraMaterial.uniforms.uTime.value = this.time;
        }

        // God rays
        if (this.godRayMaterial) {
            this.godRayMaterial.uniforms.uTime.value = this.time;
            this.godRayMaterial.uniforms.uIntensity.value = 0.35 + this.glowIntensity * 0.3;
        }

        // Stars
        if (this.starsMaterial) {
            this.starsMaterial.uniforms.uTime.value = this.time;
        }

        // Fireflies (spirit orb core + halo)
        if (this.fireflyMaterial) {
            this.fireflyMaterial.uniforms.uTime.value = this.time;
        }
        if (this.fireflyHaloMaterial) {
            this.fireflyHaloMaterial.uniforms.uTime.value = this.time;
        }

        // Mist layers
        this.mistMaterials.forEach((mat, i) => {
            mat.uniforms.uTime.value = this.time + i * 10;
            mat.uniforms.uWind.value = this.windStrength;
        });

        // Mountains
        this.mountainMaterials.forEach((mat) => {
            mat.uniforms.uTime.value = this.time;
        });

        // Trees + foreground framing
        this.treeMaterials.forEach((mat) => {
            mat.uniforms.uTime.value = this.time;
            if (mat.uniforms.uWind) {
                mat.uniforms.uWind.value = this.windStrength;
            }
        });

        // Lily pads (bobbing animation)
        this.lilyPadMaterials.forEach((mat) => {
            mat.uniforms.uTime.value = this.time;
        });

        // Reeds (wind sway)
        this.reedMaterials.forEach((mat) => {
            mat.uniforms.uTime.value = this.time;
            mat.uniforms.uWind.value = this.windStrength;
        });

        // Petals
        if (this.petalMaterial) {
            this.petalMaterial.uniforms.uTime.value = this.time;
        }

        // Birds — drive wing flap and slow lateral drift
        if (this.birdMaterials && this.birdData) {
            for (let i = 0; i < this.birdMaterials.length; i++) {
                const mat = this.birdMaterials[i];
                const data = this.birdData[i];
                mat.uniforms.uTime.value = this.time;
                // Move bird across sky; wrap around when it exits right side
                data.x += data.speed * 0.02;
                if (data.x > 60) data.x = -60 + Math.random() * 10;
                // Subtle vertical oscillation
                const oscY = Math.sin(this.time * 0.4 + data.phase) * 0.4;
                mat.uniforms.uBirdPos.value.set(data.x, data.y + oscY, data.z);
            }
        }

        // Sky
        if (this.skyMaterial) {
            this.skyMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
            this.skyMaterial.uniforms.uTime.value = this.time;
        }

        // Light burst
        if (this.lightBurstMaterial) {
            this.lightBurstMaterial.uniforms.uTime.value = this.time;
        }
    }

    animateCamera(delta) {
        // Minimal cinematic sway (was ±2.5 X / ±1.2 Y / ±1.0 Z — too much motion
        // amplified frustum-boundary edge cases and near-plane vertex clipping).
        this.cameraBreathPhase += delta * 0.12;

        const breathX = Math.sin(this.cameraBreathPhase) * 0.6;
        const breathY = Math.cos(this.cameraBreathPhase * 0.7) * 0.3;
        const breathZ = Math.sin(this.cameraBreathPhase * 0.5) * 0.25;

        this.camera.position.x = this.baseCameraPos.x + breathX;
        this.camera.position.y = this.baseCameraPos.y + breathY;
        this.camera.position.z = this.baseCameraPos.z + breathZ;

        // Static look-at (removed sin-based drift to avoid frame-to-frame
        // matrix recomputation introducing any subtle instability).
        this.camera.lookAt(0, 2, -25);
    }

    animateEffects(delta) {
        // Glow intensity decay
        this.glowIntensity = THREE.MathUtils.lerp(
            this.glowIntensity,
            this.targetGlowIntensity,
            delta * 2.5,
        );
        this.targetGlowIntensity *= 0.94;

        // Bloom boost decay
        if (this.bloomPass && this.bloomBoost > 0) {
            this.bloomPass.strength = this.qualityPreset.bloomStrength + this.bloomBoost;
            this.bloomBoost *= 0.94;
            if (this.bloomBoost < 0.01) this.bloomBoost = 0;
        } else if (this.bloomPass) {
            this.bloomPass.strength = this.qualityPreset.bloomStrength;
        }

        // Drive ghibli grade time (film grain animation)
        if (this.ghibliPass) {
            this.ghibliPass.uniforms.uTime.value = this.time;
        }

        // Wind variation with gusts
        const baseWind = 0.8;
        const gust = Math.max(0, Math.sin(this.time * 0.15) * Math.sin(this.time * 0.5 + 2.0));
        this.windStrength = baseWind + gust * 0.6; // Occasional strong gusts

        // Light burst animation
        if (this.lightBurst && this.lightBurst.visible) {
            const progress = this.lightBurstMaterial.uniforms.uProgress.value;
            this.lightBurstMaterial.uniforms.uProgress.value += delta * 1.2;

            if (progress >= 1) {
                this.lightBurst.visible = false;
                this.lightBurstMaterial.uniforms.uProgress.value = 0;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ripple Effects
    // ─────────────────────────────────────────────────────────────────────────

    createRipple(intensity = 1.0, x = 0, z = 0) {
        if (this.ripples.length >= this.qualityPreset.maxRipples) {
            const oldest = this.ripples.shift();
            this.mainGroup.remove(oldest);
            oldest.geometry.dispose();
            oldest.material.dispose();
        }

        const size = 18 + intensity * 12;
        const geometry = new THREE.PlaneGeometry(size, size);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uOpacity: { value: 0.65 * intensity },
                uColor: { value: COLORS.rippleColor },
            },
            vertexShader: rippleVertexShader,
            fragmentShader: rippleFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const ripple = new THREE.Mesh(geometry, material);
        ripple.position.set(x, 0.1, z);
        ripple.userData = { progress: 0, lifetime: 2.2 };

        this.ripples.push(ripple);
        this.mainGroup.add(ripple);
    }

    updateRipples(delta) {
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const ripple = this.ripples[i];
            ripple.userData.progress += delta / ripple.userData.lifetime;
            ripple.material.uniforms.uProgress.value = ripple.userData.progress;

            if (ripple.userData.progress >= 1) {
                this.mainGroup.remove(ripple);
                ripple.geometry.dispose();
                ripple.material.dispose();
                this.ripples.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mist Burst Effects
    // ─────────────────────────────────────────────────────────────────────────

    createMistBurst(intensity = 1.0) {
        if (this.mistBursts.length >= this.qualityPreset.maxMistBursts) {
            const oldest = this.mistBursts.shift();
            this.mainGroup.remove(oldest);
            oldest.geometry.dispose();
            oldest.material.dispose();
        }

        const geometry = new THREE.PlaneGeometry(10 + intensity * 5, 25);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: this.time },
                uOpacity: { value: 0.55 * intensity },
                uColor: { value: COLORS.mistColor },
                uRise: { value: 0 },
            },
            vertexShader: mistBurstVertexShader,
            fragmentShader: mistBurstFragmentShader,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const burst = new THREE.Mesh(geometry, material);
        burst.position.set((Math.random() - 0.5) * 60, 6, -12 - Math.random() * 25);
        burst.userData = { rise: 0, lifetime: 2.5 };

        this.mistBursts.push(burst);
        this.mainGroup.add(burst);
    }

    updateMistBursts(delta) {
        for (let i = this.mistBursts.length - 1; i >= 0; i--) {
            const burst = this.mistBursts[i];
            burst.userData.rise += delta / burst.userData.lifetime;
            burst.material.uniforms.uRise.value = burst.userData.rise;
            burst.material.uniforms.uTime.value = this.time;

            if (burst.userData.rise >= 1) {
                this.mainGroup.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.mistBursts.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Event Effects
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        console.log('[MistyLake] Setting up event listeners');

        const settings = window.settings || {};

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[MistyLake] Event listeners set up successfully');
    }

    onLineClear(lineCount) {
        console.log('[MistyLake] Line clear:', lineCount);

        const rippleCount = Math.min(lineCount * 2 + 1, 8);
        for (let i = 0; i < rippleCount; i++) {
            this.scheduleEffectTimeout(() => {
                const x = (Math.random() - 0.5) * 40;
                const z = -3 - Math.random() * 18;
                this.createRipple(0.5 + lineCount * 0.15, x, z);
            }, i * 80);
        }

        this.targetGlowIntensity = Math.min(lineCount * 0.35, 1.2);
        this.bloomBoost = Math.min(lineCount * 0.12, 0.35);
    }

    onCombo(comboCount) {
        console.log('[MistyLake] Combo:', comboCount);
        this.currentComboLevel = comboCount;

        const burstCount = Math.min(comboCount, 5);
        for (let i = 0; i < burstCount; i++) {
            this.scheduleEffectTimeout(() => {
                this.createMistBurst(0.5 + comboCount * 0.2);
            }, i * 120);
        }

        this.targetGlowIntensity = Math.min(comboCount * 0.3, 1.5);
        this.bloomBoost = Math.min(0.15 + comboCount * 0.1, 0.6);

        if (comboCount >= 4 && this.lightBurst) {
            this.lightBurst.visible = true;
            this.lightBurstMaterial.uniforms.uProgress.value = 0;
            this.lightBurstMaterial.uniforms.uIntensity.value = 0.5 + comboCount * 0.12;
        }
    }

    onPieceLock(piece) {
        if (Math.random() < 0.4) {
            const x = (Math.random() - 0.5) * 25;
            const z = -2 - Math.random() * 12;
            this.createRipple(0.25, x, z);
        }

        this.targetGlowIntensity = Math.max(this.targetGlowIntensity, 0.08);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Window Resize
    // ─────────────────────────────────────────────────────────────────────────

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        const { width, height } = this.getSafeViewportSize();

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    onMouseMove(event) {
        if (!this.water || !this.camera) return;

        // Throttle ripples
        const now = performance.now();
        if (now - this.lastRippleTime < 50) return; // Max 20 ripples/sec

        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObject(this.water);

        if (intersects.length > 0) {
            const { point } = intersects[0];
            // Only create ripples if within reasonable bounds
            if (Math.abs(point.x) < 70 && Math.abs(point.z) > -80 && Math.abs(point.z) < 20) {
                this.createRipple(0.2, point.x, point.z);
                this.lastRippleTime = now;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    pause() {
        const paused = super.pause();
        if (!paused) return false;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.renderFrameToken += 1;
        return true;
    }

    resume() {
        const resumed = super.resume();
        if (!resumed) return false;

        this.clock.getDelta();
        this.startRenderLoop();
        return true;
    }

    stop() {
        console.log('[MistyLake] Stopping theme...');

        this.clearEffectTimeouts();

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.renderFrameToken += 1;

        window.removeEventListener('resize', this.boundResizeHandler);
        window.removeEventListener('mousemove', this.boundMouseMoveHandler);

        // Dispose mirror reflection RT before generic scene traverse
        if (this.water && typeof this.water.dispose === 'function') {
            this.water.dispose();
        }

        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((m) => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        this.disposePostProcessing();

        if (this.renderer) {
            this.disposeRenderer(this.renderer, { nullInstance: false });
            this.renderer = null;
        }

        this.currentComboLevel = 0;
        this.glowIntensity = 0;
        this.targetGlowIntensity = 0;
        this.bloomBoost = 0;

        this.ripples = [];
        this.mistBursts = [];
        this.mistLayers = [];
        this.mistMaterials = [];
        this.mountains = [];
        this.mountainMaterials = [];
        this.trees = [];
        this.treeMaterials = [];
        this.lilyPads = [];
        this.lilyPadMaterials = [];
        this.reeds = [];
        this.reedMaterials = [];
        this.birds = null;
        this.birdMaterial = null;
        this.birdMaterials = null;
        this.birdData = null;
        this.petals = null;
        this.petalMaterial = null;
        this.moonStreak = null;
        this.moonStreakMaterial = null;
        this.moonHalo = null;
        this.moonHaloMaterial = null;
        this.lanterns = null;
        this.lanternMaterials = null;
        this.fireflyHalos = null;
        this.fireflyHaloMaterial = null;
        this.ghibliPass = null;
        this.postProcessingDisabledReason = null;

        // Unregister spike context collector
        if (this._spikeContextRegistered && performanceMonitor?.setSpikeContextCollector) {
            performanceMonitor.setSpikeContextCollector(null);
            this._spikeContextRegistered = false;
        }

        super.stop();
        console.log('[MistyLake] Theme stopped');
    }
}
