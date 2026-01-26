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
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { MISTY_LAKE_TETROMINOS } from './misty-lake-tetrominos.js';
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
} from './misty-lake-shaders.js';

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
    fireflyColor: new THREE.Color(0xffaa40), // Golden orange

    // God rays
    rayColor: new THREE.Color(0xa0c0ff),

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
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class MistyLakeTheme extends BaseTheme {
    constructor() {
        super('misty-lake');
        console.log('[MistyLake] Constructor called!');

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
        this.mistLayers = [];
        this.mistMaterials = [];
        this.mountains = [];
        this.mountainMaterials = [];
        this.trees = [];
        this.treeMaterials = [];

        // Effects
        this.ripples = [];
        this.mistBursts = [];
        this.lightBurst = null;
        this.lightBurstMaterial = null;

        // Animation state
        this.clock = new THREE.Clock();
        this.time = 0;
        this.animationFrameId = null;

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

        // Event handlers
        this.eventUnsubscribers = [];

        // Quality
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[MistyLake] Constructor complete!');
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
        this.createFireflies();
        this.createTrees();
        this.createLightBurst();
        this.setupLighting();

        if (this.qualityPreset.enableBloom) {
            this.setupPostProcessing();
        }

        this.setupEventListeners();

        // Interactive ripples
        window.addEventListener('mousemove', this.onMouseMove.bind(this));

        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.animate();

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
        this.mainGroup.add(this.sky);
    }

    createMountains() {
        const layerConfigs = [
            {
                z: -80, scale: 1.0, fogAmount: 0.75, color: COLORS.mountainFar,
            },
            {
                z: -55, scale: 1.15, fogAmount: 0.5, color: COLORS.mountainMid,
            },
            {
                z: -35, scale: 1.3, fogAmount: 0.25, color: COLORS.mountainNear,
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

            this.mountains.push(mountain);
            this.mountainMaterials.push(material);
            this.mainGroup.add(mountain);
        });
    }

    createMoon() {
        const geometry = new THREE.PlaneGeometry(18, 18);

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
        this.moon.position.set(18, 40, -70);
        this.mainGroup.add(this.moon);
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
        const geometry = new THREE.PlaneGeometry(150, 80, 80, 40);
        geometry.rotateX(-Math.PI / 2);

        this.waterMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uDeepColor: { value: COLORS.waterDeep },
                uShallowColor: { value: COLORS.waterShallow },
                uMoonReflection: { value: COLORS.moonReflection },
                uMoonGlow: { value: 1.0 },
                uGlowIntensity: { value: 0 },
                uMoonPosition: { value: new THREE.Vector2(0.62, 0.75) },
            },
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
        });

        this.water = new THREE.Mesh(geometry, this.waterMaterial);
        this.water.position.set(0, -0.5, 0);
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

            this.mistLayers.push(mist);
            this.mistMaterials.push(material);
            this.mainGroup.add(mist);
        }
    }

    createFireflies() {
        const count = this.qualityPreset.fireflyCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = 1.5 + Math.random() * 18;
            positions[i3 + 2] = -8 - Math.random() * 50;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        this.fireflyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 6.0 },
            },
            vertexShader: fireflyVertexShader,
            fragmentShader: fireflyFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.fireflies = new THREE.Points(geometry, this.fireflyMaterial);
        this.mainGroup.add(this.fireflies);
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

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.35,
            0.85,
        );
        this.composer.addPass(this.bloomPass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;

        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        this.time += delta;

        this.updateUniforms();
        this.animateCamera(delta);
        this.animateEffects(delta);
        this.updateRipples(delta);
        this.updateMistBursts(delta);

        if (this.composer && this.qualityPreset.enableBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateUniforms() {
        // Water
        if (this.waterMaterial) {
            this.waterMaterial.uniforms.uTime.value = this.time;
            this.waterMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
        }

        // Moon
        if (this.moonMaterial) {
            this.moonMaterial.uniforms.uTime.value = this.time;
            this.moonMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
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

        // Fireflies
        if (this.fireflyMaterial) {
            this.fireflyMaterial.uniforms.uTime.value = this.time;
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

        // Trees
        this.treeMaterials.forEach((mat) => {
            mat.uniforms.uTime.value = this.time;
            mat.uniforms.uWind.value = this.windStrength;
        });

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
        // Deep meditative breathing motion
        this.cameraBreathPhase += delta * 0.12;

        const breathX = Math.sin(this.cameraBreathPhase) * 2.5;
        const breathY = Math.cos(this.cameraBreathPhase * 0.7) * 1.2;
        const breathZ = Math.sin(this.cameraBreathPhase * 0.5) * 1.0;

        // Additional subtle sway
        const swayX = Math.sin(this.time * 0.05) * 0.8;
        const swayY = Math.cos(this.time * 0.04) * 0.5;

        this.camera.position.x = this.baseCameraPos.x + breathX + swayX;
        this.camera.position.y = this.baseCameraPos.y + breathY + swayY;
        this.camera.position.z = this.baseCameraPos.z + breathZ;

        // Slight look-at drift
        const lookY = 2 + Math.sin(this.time * 0.08) * 0.5;
        this.camera.lookAt(0, lookY, -25);
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
            setTimeout(() => {
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
            setTimeout(() => {
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

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(window.innerWidth, window.innerHeight);

        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
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

    stop() {
        console.log('[MistyLake] Stopping theme...');

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        window.removeEventListener('resize', this.onWindowResize.bind(this));
        window.removeEventListener('mousemove', this.onMouseMove.bind(this));

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

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
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

        super.stop();
        console.log('[MistyLake] Theme stopped');
    }
}
