/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ WOLFHOUR ✧
 *  A Three.js Mystical Mountain Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { WOLFHOUR_TETROMINOS } from './wolfhour-tetrominos.js';

// Import shaders
import {
    VignetteShader,
    SilverTintShader,
    mountainVertexShader,
    mountainFragmentShader,
    starfieldVertexShader,
    starfieldFragmentShader,
    spiritVertexShader,
    spiritFragmentShader,
    burstVertexShader,
    burstFragmentShader,
    beamVertexShader,
    beamFragmentShader,
    riftVertexShader,
    riftFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    waveVertexShader,
    waveFragmentShader,
    meteorTrailVertexShader,
    meteorTrailFragmentShader,
    meteorHeadVertexShader,
    meteorHeadFragmentShader
} from './wolfhour-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Minimal: {
        starCount: 5000,
        mountainSegments: 32,
        nebulaResolution: 512,
        spiritCount: 0,
        enableBloom: false,
        bloomStrength: 0,
        maxStarBursts: 3,
        maxCosmicRifts: 1,
        maxCelestialBeams: 0,
        starTwinkleSpeed: 0.5,
    },
    Low: {
        starCount: 10000,
        mountainSegments: 64,
        nebulaResolution: 512,
        spiritCount: 3,
        enableBloom: false,
        bloomStrength: 0,
        maxStarBursts: 5,
        maxCosmicRifts: 2,
        maxCelestialBeams: 0,
        starTwinkleSpeed: 0.7,
    },
    Medium: {
        starCount: 25000,
        mountainSegments: 128,
        nebulaResolution: 1024,
        spiritCount: 8,
        enableBloom: true,
        bloomStrength: 0.3,
        maxStarBursts: 8,
        maxCosmicRifts: 3,
        maxCelestialBeams: 2,
        starTwinkleSpeed: 1.0,
    },
    High: {
        starCount: 50000,
        mountainSegments: 256,
        nebulaResolution: 1024,
        spiritCount: 15,
        enableBloom: true,
        bloomStrength: 0.5,
        maxStarBursts: 12,
        maxCosmicRifts: 4,
        maxCelestialBeams: 4,
        starTwinkleSpeed: 1.0,
    },
    Ultra: {
        starCount: 80000,
        mountainSegments: 256,
        nebulaResolution: 2048,
        spiritCount: 25,
        enableBloom: true,
        bloomStrength: 0.6,
        maxStarBursts: 15,
        maxCosmicRifts: 5,
        maxCelestialBeams: 6,
        starTwinkleSpeed: 1.0,
    },
    Extreme: {
        starCount: 150000,
        mountainSegments: 512,
        nebulaResolution: 2048,
        spiritCount: 40,
        enableBloom: true,
        bloomStrength: 0.8,
        maxStarBursts: 20,
        maxCosmicRifts: 6,
        maxCelestialBeams: 8,
        starTwinkleSpeed: 1.2,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class WolfhourTheme extends BaseTheme {
    constructor() {
        super('wolfhour');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();

        // Scene elements
        this.mountains = [];
        this.starfield = null;
        this.nebulaPlanes = [];
        this.spirits = null;
        this.bloomPass = null;
        this.silverTintPass = null;

        // Effect systems
        this.starBursts = [];
        this.cosmicRifts = [];
        this.celestialBeams = [];
        this.cosmicWaves = [];
        this.meteors = []; // Shooting star meteors
        this.lastMeteorTime = 0; // Time of last meteor spawn
        this.nextMeteorDelay = 15 + Math.random() * 15; // 15-30 seconds

        // Effect state (smooth decay)
        this.effectState = {
            starBurstIntensity: 0,
            cosmicRiftIntensity: 0,
            celestialBeamIntensity: 0,
            mountainPulse: 0,
            mountainShockwave: 0, // Vertex displacement
            spiritSurge: 0,
            bloomBoost: 0,
            nebulaBoost: 0,
        };

        // Animation
        this.time = 0;
        this.animationFrameId = null;
        this.eventUnsubscribers = [];

        // Quality
        this.qualityPreset = QUALITY_PRESETS.High;

        // Resize handler reference
        this.resizeHandler = null;

        console.log('[Wolfhour] Theme constructed');
    }

    getTetrominoConfig() {
        return WOLFHOUR_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[Wolfhour] Creating Three.js scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('wolfhour-theme');
        if (!container) {
            console.error('[Wolfhour] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaBackdrop();
        this.createMountains();
        this.createSpirits();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[Wolfhour] Scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;

        this.renderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Orthographic camera for 2D-style layered scene
        const aspect = width / height;
        const frustumSize = 1000;
        this.camera = new THREE.OrthographicCamera(
            (frustumSize * aspect) / -2,
            (frustumSize * aspect) / 2,
            frustumSize / 2,
            frustumSize / -2,
            0.1,
            10000
        );
        this.camera.position.set(0, 0, 1000);
        this.camera.lookAt(0, 0, 0);

        // Setup resize handler
        this.resizeHandler = () => this.handleResize();
        window.addEventListener('resize', this.resizeHandler);

        console.log('[Wolfhour] Renderer initialized with orthographic camera');
    }

    handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspect = width / height;
        const frustumSize = 1000;

        this.camera.left = (frustumSize * aspect) / -2;
        this.camera.right = (frustumSize * aspect) / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GPU-Driven Starfield
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const count = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinkleData = new Float32Array(count * 2);
        const brightness = new Float32Array(count);

        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xe0e0ff), // Cool white
            new THREE.Color(0xd0d0e0), // Silver
            new THREE.Color(0xc0c0d0), // Dim silver
            new THREE.Color(0xf0f0ff), // Blue-white
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            // 3 depth layers: Z = -1000 to -4500
            const layerRand = Math.random();
            let radius;
            if (layerRand < 0.33) {
                radius = 1200 + Math.random() * 300;
            } else if (layerRand < 0.66) {
                radius = 2500 + Math.random() * 500;
            } else {
                radius = 3500 + Math.random() * 1000;
            }

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            // Allow stars across full screen height (positive and negative Y)
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.6;
            // Ensure ALL stars are behind mountains (min Z = -1700, far behind back mountain at -1500)
            positions[i3 + 2] = -Math.abs(radius * Math.cos(phi)) - 1700;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 20 + Math.random() * 40;
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 1.0 + Math.random() * 2.5;
            brightness[i] = 0.3 + Math.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uEventBoost: { value: 0 },
            },
            vertexShader: starfieldVertexShader,
            fragmentShader: starfieldFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true, // Stars are occluded by mountains
            vertexColors: true,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.renderOrder = 1000; // Render AFTER mountains (so depth test occludes them)
        this.scene.add(this.starfield);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Silver Nebula Backdrop
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaBackdrop() {
        const textureLoader = new THREE.TextureLoader();
        // Correct path for Vite public folder
        const texturePath = '/textures/wolfhour/';

        const textures = [
            textureLoader.load(texturePath + 'nebula-silver-1.png'),
            textureLoader.load(texturePath + 'nebula-silver-2.png'),
            textureLoader.load(texturePath + 'nebula-silver-3.png'),
        ];

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Layer configs for parallax - LARGE sizes to fill screen completely
        const nebulaConfigs = [
            // Near layer (Z -2000)
            {
                texture: textures[0],
                x: 0, y: 150, z: -2000,
                size: 4000, speed: 8, opacity: 0.25,
            },
            // Mid layer (Z -3000)
            {
                texture: textures[1],
                x: 0, y: 100, z: -3000,
                size: 5000, speed: 5, opacity: 0.2,
            },
            // Far layer (Z -4000)
            {
                texture: textures[2],
                x: 0, y: 200, z: -4000,
                size: 6000, speed: 3, opacity: 0.15,
            },
        ];

        this.nebulaPlanes = [];

        nebulaConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.6);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: config.texture },
                    uOpacity: { value: config.opacity },
                    uPulse: { value: 0 },
                },
                vertexShader: nebulaVertexShader,
                fragmentShader: nebulaFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(config.x, config.y, config.z);
            mesh.renderOrder = -2000 - index;

            mesh.userData.speed = config.speed;
            mesh.userData.startX = config.x;
            mesh.userData.wrapBoundary = config.size * 1.5;

            this.nebulaPlanes.push(mesh);
            this.scene.add(mesh);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FBM Mountain System
    // ─────────────────────────────────────────────────────────────────────────

    createMountains() {
        const configs = [
            // Foreground (Z -500, darkest)
            {
                z: -500, size: 2000, height: 400,
                color: new THREE.Color(0x151515),
                layer: 0.0, seed: 11111,
            },
            // Mid-ground (Z -1000)
            {
                z: -1000, size: 2500, height: 500,
                color: new THREE.Color(0x202020),
                layer: 0.5, seed: 22222,
            },
            // Background (Z -1500, lightest)
            {
                z: -1500, size: 3000, height: 600,
                color: new THREE.Color(0x303030),
                layer: 1.0, seed: 33333,
            },
        ];

        configs.forEach((config) => {
            const mountain = this.createFBMMountain(config);
            this.mountains.push(mountain);
            this.scene.add(mountain);
        });
    }

    createFBMMountain(config) {
        const segments = this.qualityPreset.mountainSegments;
        const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        // CPU-side FBM displacement
        const posAttribute = geometry.attributes.position;
        const heights = [];
        const seed = config.seed;

        const fract = (n) => n - Math.floor(n);
        const mix = (a, b, t) => a * (1 - t) + b * t;
        const rand = (x, y) => Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;

        const noise = (x, y) => {
            const i = Math.floor(x);
            const j = Math.floor(y);
            const f = fract(x);
            const g = fract(y);
            const u = f * f * (3.0 - 2.0 * f);
            const v = g * g * (3.0 - 2.0 * g);
            return mix(
                mix(fract(rand(i, j)), fract(rand(i + 1, j)), u),
                mix(fract(rand(i, j + 1)), fract(rand(i + 1, j + 1)), u),
                v
            );
        };

        const fbm = (x, y) => {
            let v = 0.0;
            let a = 0.5;
            for (let i = 0; i < 5; i++) {
                v += a * noise(x, y);
                x *= 2.0;
                y *= 2.0;
                a *= 0.5;
            }
            return v;
        };

        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const z = posAttribute.getZ(i);

            // Cone shape mask
            const dist = Math.sqrt(x * x + z * z);
            const maxDist = config.size * 0.45;

            if (dist > maxDist) {
                posAttribute.setY(i, 0);
                heights.push(0);
                continue;
            }

            const normDist = dist / maxDist;
            const cone = Math.pow(1.0 - normDist, 1.5) * config.height;

            const n = fbm(x * 0.01, z * 0.01);
            const n2 = fbm(x * 0.04, z * 0.04);
            const detail = (n * 0.7 + n2 * 0.3) * config.height * 0.4 * (1.0 - normDist);

            const h = cone + detail;
            posAttribute.setY(i, h);
            heights.push(h);
        }

        geometry.computeVertexNormals();

        const heightAttr = new Float32Array(posAttribute.count);
        for (let i = 0; i < posAttribute.count; i++) {
            heightAttr[i] = heights[i] / config.height;
        }
        geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uRockColorDark: { value: new THREE.Color(0x151515) },
                uRockColorMid: { value: new THREE.Color(0x202020) },
                uRockColorLight: { value: new THREE.Color(0x303030) },
                uMountainLayer: { value: config.layer },
                uPulseIntensity: { value: 0 },
                uShockwave: { value: 0 }, // For onPieceLock displacement
                uTime: { value: 0 },
            },
            vertexShader: mountainVertexShader,
            fragmentShader: mountainFragmentShader,
            transparent: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        // Position well below viewport to account for camera movement (±30 units vertical drift)
        mesh.position.set(0, -580, config.z);
        // Render in front of stars (higher layer = closer to camera = renders later)
        mesh.renderOrder = -100 + Math.round(config.layer * 10); // Render BEFORE stars
        return mesh;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Spirit Particle System
    // ─────────────────────────────────────────────────────────────────────────

    createSpirits() {
        const count = this.qualityPreset.spiritCount;
        if (count === 0) return;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const speeds = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 1500;
            positions[i * 3 + 1] = 100 + Math.random() * 400;
            positions[i * 3 + 2] = -200 - Math.random() * 600;

            phases[i] = Math.random() * Math.PI * 2;
            speeds[i] = 0.5 + Math.random() * 1.0;
            sizes[i] = 30 + Math.random() * 50;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uSurgeIntensity: { value: 0 },
            },
            vertexShader: spiritVertexShader,
            fragmentShader: spiritFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spirits = new THREE.Points(geometry, material);
        this.scene.add(this.spirits);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enableBloom) return;

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.5,
            0.4
        );
        this.composer.addPass(this.bloomPass);

        // Silver Tint Pass (custom)
        this.silverTintPass = new ShaderPass(SilverTintShader);
        this.silverTintPass.uniforms.uAmount.value = 0.3;
        this.composer.addPass(this.silverTintPass);

        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.darkness.value = 0.6;
        vignettePass.uniforms.offset.value = 1.2;
        this.composer.addPass(vignettePass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = window.settings;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = window.settings;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = window.settings;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        const levelUpUnsub = eventBus.on(EVENTS.LEVEL_UP, (data) => {
            const settings = window.settings;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLevelUp(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, levelUpUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gameplay Effects
    // ─────────────────────────────────────────────────────────────────────────

    onPieceLock() {
        if (this.starBursts.length < this.qualityPreset.maxStarBursts) {
            this.createStarBurst();
        }

        this.effectState.mountainPulse = 0.8;
        this.effectState.mountainShockwave = 1.0; // Trigger vertex wave

        if (this.starfield) {
            this.starfield.material.uniforms.uEventBoost.value = 0.5;
        }
    }

    onLineClear(data) {
        const lineCount = data?.detail?.lineCount ?? data?.lineCount ?? 1;

        if (this.celestialBeams.length < this.qualityPreset.maxCelestialBeams) {
            for (let i = 0; i < Math.min(lineCount, 2); i++) {
                this.createCelestialBeam();
            }
        }

        // Create horizontal ripple
        this.createCosmicWave();

        this.effectState.nebulaBoost = 0.1 + lineCount * 0.02;
        this.effectState.bloomBoost = 0.05 + lineCount * 0.02;
        this.effectState.mountainPulse = Math.min(lineCount * 0.3, 1.0);
    }

    onCombo(data) {
        const comboCount = data?.detail?.comboCount ?? data?.comboCount ?? 0;

        if (comboCount >= 3) {
            if (this.cosmicRifts.length < this.qualityPreset.maxCosmicRifts) {
                this.createCosmicRift();
            }
            this.effectState.cosmicRiftIntensity = Math.min(comboCount * 0.2, 1.0);
        }

        // Spawn shooting star on combos of 4+
        if (comboCount >= 4) {
            this.createMeteor();
        }

        if (comboCount >= 5) {
            this.effectState.spiritSurge = Math.min(comboCount * 0.15, 1.0);
        }

        this.effectState.mountainPulse = Math.min(comboCount * 0.1, 0.8);

        if (this.starfield) {
            this.starfield.material.uniforms.uEventBoost.value = Math.min(comboCount * 0.1, 0.5);
        }
    }

    onLevelUp(data) {
        // Subtle bloom boost on level up
        this.effectState.bloomBoost = 0.2;
        this.effectState.spiritSurge = 0.3;
        this.effectState.mountainPulse = 0.3;
        // Trigger multiple beams
        for (let i = 0; i < 3; i++) this.createCelestialBeam();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effect Creation Methods
    // ─────────────────────────────────────────────────────────────────────────

    createStarBurst() {
        const particleCount = 30;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const cx = (Math.random() - 0.5) * 800;
        const cy = (Math.random() - 0.5) * 400;

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            positions[i3] = cx;
            positions[i3 + 1] = cy;
            positions[i3 + 2] = 100;

            const angle = Math.random() * Math.PI * 2;
            const speed = 200 + Math.random() * 300;
            velocities[i3] = Math.cos(angle) * speed;
            velocities[i3 + 1] = Math.sin(angle) * speed;
            velocities[i3 + 2] = (Math.random() - 0.5) * 100;

            sizes[i] = 15 + Math.random() * 25;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
            vertexShader: burstVertexShader,
            fragmentShader: burstFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData.startTime = this.time;
        burst.userData.duration = 0.8;

        this.starBursts.push(burst);
        this.scene.add(burst);
    }

    createCelestialBeam() {
        const beamWidth = 20 + Math.random() * 30;
        const beamHeight = 1200;
        const geometry = new THREE.PlaneGeometry(beamWidth, beamHeight);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 1.0 },
            },
            vertexShader: beamVertexShader,
            fragmentShader: beamFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const beam = new THREE.Mesh(geometry, material);
        beam.position.set((Math.random() - 0.5) * 1000, 0, -800);
        beam.rotation.z = (Math.random() - 0.5) * 0.1;

        beam.userData.startTime = this.time;
        beam.userData.duration = 1.5;

        this.celestialBeams.push(beam);
        this.scene.add(beam);
    }

    createCosmicRift() {
        const riftLength = 100 + Math.random() * 150;
        const riftWidth = 3 + Math.random() * 4;
        const geometry = new THREE.PlaneGeometry(riftLength, riftWidth);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 1.0 },
            },
            vertexShader: riftVertexShader,
            fragmentShader: riftFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const rift = new THREE.Mesh(geometry, material);
        rift.position.set(
            (Math.random() - 0.5) * 1200,
            Math.random() * 300 + 100,
            -200
        );
        rift.rotation.z = (Math.random() - 0.5) * 0.4;

        rift.userData.startTime = this.time;
        rift.userData.duration = 1.2;

        this.cosmicRifts.push(rift);
        this.scene.add(rift);
    }

    createCosmicWave() {
        // Horizontal ripple across screen
        const geometry = new THREE.PlaneGeometry(window.innerWidth, window.innerHeight);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 0.5 },
            },
            vertexShader: waveVertexShader,
            fragmentShader: waveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.position.z = 50; // In front

        wave.userData.startTime = this.time;
        wave.userData.duration = 1.0;

        this.cosmicWaves.push(wave);
        this.scene.add(wave);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Update Systems
    // ─────────────────────────────────────────────────────────────────────────

    updateNebulas(deltaTime) {
        this.nebulaPlanes.forEach((nebula) => {
            nebula.position.x += nebula.userData.speed * deltaTime;
            if (nebula.position.x > nebula.userData.wrapBoundary) {
                nebula.position.x = -nebula.userData.wrapBoundary;
            }
        });
    }

    updateEffects(deltaTime) {
        const decay = Math.pow(0.95, deltaTime * 60);

        this.effectState.starBurstIntensity *= decay;
        this.effectState.mountainPulse *= decay;
        this.effectState.mountainShockwave *= decay;
        this.effectState.cosmicRiftIntensity *= decay;
        this.effectState.spiritSurge *= decay;
        this.effectState.nebulaBoost *= decay;
        this.effectState.bloomBoost *= decay;

        if (this.starfield) {
            this.starfield.material.uniforms.uEventBoost.value = this.effectState.starBurstIntensity;
        }

        this.mountains.forEach((m) => {
            m.material.uniforms.uPulseIntensity.value = this.effectState.mountainPulse;
            m.material.uniforms.uShockwave.value = this.effectState.mountainShockwave;
        });

        if (this.spirits) {
            this.spirits.material.uniforms.uSurgeIntensity.value = this.effectState.spiritSurge;
        }

        this.nebulaPlanes.forEach((n) => {
            n.material.uniforms.uPulse.value = this.effectState.nebulaBoost;
        });

        if (this.bloomPass) {
            const baseStrength = this.qualityPreset.bloomStrength;
            this.bloomPass.strength = baseStrength + this.effectState.bloomBoost * 0.5;
        }

        this.updateStarBursts();
        this.updateCelestialBeams();
        this.updateCosmicRifts();
        this.updateCosmicWaves();
    }

    updateStarBursts() {
        for (let i = this.starBursts.length - 1; i >= 0; i--) {
            const burst = this.starBursts[i];
            const elapsed = this.time - burst.userData.startTime;
            if (elapsed > burst.userData.duration) {
                this.scene.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.starBursts.splice(i, 1);
            } else {
                burst.material.uniforms.uTime.value = elapsed;
            }
        }
    }

    updateCelestialBeams() {
        for (let i = this.celestialBeams.length - 1; i >= 0; i--) {
            const beam = this.celestialBeams[i];
            const elapsed = this.time - beam.userData.startTime;
            if (elapsed > beam.userData.duration) {
                this.scene.remove(beam);
                beam.geometry.dispose();
                beam.material.dispose();
                this.celestialBeams.splice(i, 1);
            } else {
                beam.material.uniforms.uTime.value = elapsed;
                const progress = elapsed / beam.userData.duration;
                beam.material.uniforms.uOpacity.value = 1.0 - progress;
            }
        }
    }

    updateCosmicRifts() {
        for (let i = this.cosmicRifts.length - 1; i >= 0; i--) {
            const rift = this.cosmicRifts[i];
            const elapsed = this.time - rift.userData.startTime;
            if (elapsed > rift.userData.duration) {
                this.scene.remove(rift);
                rift.geometry.dispose();
                rift.material.dispose();
                this.cosmicRifts.splice(i, 1);
            } else {
                rift.material.uniforms.uTime.value = elapsed;
                const progress = elapsed / rift.userData.duration;
                rift.material.uniforms.uOpacity.value = 1.0 - progress;
            }
        }
    }

    updateCosmicWaves() {
        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];
            const elapsed = this.time - wave.userData.startTime;
            if (elapsed > wave.userData.duration) {
                this.scene.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.cosmicWaves.splice(i, 1);
            } else {
                wave.material.uniforms.uTime.value = elapsed;
                const progress = elapsed / wave.userData.duration;
                wave.material.uniforms.uOpacity.value = 0.5 * (1.0 - progress);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Meteor / Shooting Star System
    // ─────────────────────────────────────────────────────────────────────────

    createMeteor() {
        // Limit to 2 simultaneous meteors for elegance
        if (this.meteors.length >= 2) return;

        // Random start position in upper portion of sky
        const startX = (Math.random() - 0.5) * 1200;
        const startY = 200 + Math.random() * 250; // Upper sky
        const startZ = -1800 - Math.random() * 500; // Behind mountains

        // Random direction (diagonal downward)
        const angle = -0.3 - Math.random() * 0.5; // -0.3 to -0.8 radians (diagonal down-right or down-left)
        const direction = Math.random() > 0.5 ? 1 : -1; // Left or right
        const speed = 400 + Math.random() * 200; // Units per second
        const trailLength = 150 + Math.random() * 100;
        const duration = 2.5 + Math.random() * 1.5; // 2.5-4 seconds

        // Create trail geometry (LINE with varying alpha)
        const trailSegments = 40;
        const positions = new Float32Array(trailSegments * 3);
        const trailPositions = new Float32Array(trailSegments);

        // Initialize all points at start position
        for (let i = 0; i < trailSegments; i++) {
            positions[i * 3] = startX;
            positions[i * 3 + 1] = startY;
            positions[i * 3 + 2] = startZ;
            trailPositions[i] = i / (trailSegments - 1); // 0 to 1
        }

        const trailGeometry = new THREE.BufferGeometry();
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        trailGeometry.setAttribute('aTrailPosition', new THREE.BufferAttribute(trailPositions, 1));

        const trailMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
            },
            vertexShader: meteorTrailVertexShader,
            fragmentShader: meteorTrailFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const trail = new THREE.Line(trailGeometry, trailMaterial);
        trail.renderOrder = 500; // Above mountains, below UI

        // Create glowing head point
        const headGeometry = new THREE.BufferGeometry();
        headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([startX, startY, startZ]), 3));

        const headMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
            vertexShader: meteorHeadVertexShader,
            fragmentShader: meteorHeadFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const head = new THREE.Points(headGeometry, headMaterial);
        head.renderOrder = 501;

        // Group them
        const meteor = new THREE.Group();
        meteor.add(trail);
        meteor.add(head);

        meteor.userData = {
            startTime: this.time,
            duration: duration,
            startX,
            startY,
            startZ,
            angle,
            direction,
            speed,
            trailLength,
            trailSegments,
            trail,
            head,
        };

        this.meteors.push(meteor);
        this.scene.add(meteor);

        console.log('[Wolfhour] Meteor spawned');
    }

    updateMeteors() {
        // Auto-spawn meteors periodically
        if (this.time - this.lastMeteorTime > this.nextMeteorDelay) {
            this.createMeteor();
            this.lastMeteorTime = this.time;
            this.nextMeteorDelay = 15 + Math.random() * 15; // 15-30 seconds
        }

        // Update existing meteors
        for (let i = this.meteors.length - 1; i >= 0; i--) {
            const meteor = this.meteors[i];
            const data = meteor.userData;
            const elapsed = this.time - data.startTime;
            const progress = elapsed / data.duration;

            if (progress > 1.0) {
                // Cleanup
                this.scene.remove(meteor);
                data.trail.geometry.dispose();
                data.trail.material.dispose();
                data.head.geometry.dispose();
                data.head.material.dispose();
                this.meteors.splice(i, 1);
                continue;
            }

            // Calculate current head position
            const travelDistance = elapsed * data.speed;
            const headX = data.startX + Math.cos(data.angle) * travelDistance * data.direction;
            const headY = data.startY + Math.sin(data.angle) * travelDistance;
            const headZ = data.startZ;

            // Update trail positions (head to tail)
            const trailPositions = data.trail.geometry.attributes.position.array;
            for (let j = 0; j < data.trailSegments; j++) {
                const t = j / (data.trailSegments - 1);
                const trailOffset = t * data.trailLength;
                trailPositions[j * 3] = headX - Math.cos(data.angle) * trailOffset * data.direction;
                trailPositions[j * 3 + 1] = headY - Math.sin(data.angle) * trailOffset;
                trailPositions[j * 3 + 2] = headZ;
            }
            data.trail.geometry.attributes.position.needsUpdate = true;

            // Update uniforms
            data.trail.material.uniforms.uTime.value = this.time;
            data.trail.material.uniforms.uProgress.value = progress;
            data.head.material.uniforms.uProgress.value = progress;

            // Update head position
            const headPositions = data.head.geometry.attributes.position.array;
            headPositions[0] = headX;
            headPositions[1] = headY;
            headPositions[2] = headZ;
            data.head.geometry.attributes.position.needsUpdate = true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            this.animationFrameId = requestAnimationFrame(animate);

            const deltaTime = this.clock.getDelta();
            this.time += deltaTime;

            // Subtle camera drift animation for immersive feel
            this.updateCameraAnimation();

            if (this.starfield) this.starfield.material.uniforms.uTime.value = this.time;
            if (this.spirits) this.spirits.material.uniforms.uTime.value = this.time;
            this.mountains.forEach((m) => {
                m.material.uniforms.uTime.value = this.time;
            });

            this.updateNebulas(deltaTime);
            this.updateEffects(deltaTime);
            this.updateMeteors(); // Shooting star system

            if (this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        };

        animate();
    }

    updateCameraAnimation() {
        // Subtle but noticeable camera movements for immersive feel
        // Drift period: ~45 seconds for full cycle
        const driftSpeed = 0.03; // Slightly faster drift

        // More noticeable horizontal drift (parallax effect)
        const xDrift = Math.sin(this.time * driftSpeed) * 40; // ±40 units

        // Larger vertical movement to reveal mountain top at times
        const yDrift = Math.sin(this.time * driftSpeed * 0.7 + 1.0) * 30; // ±30 units

        // Breathing effect - subtle zoom via frustum size
        // Period: ~20 seconds
        const breathe = Math.sin(this.time * 0.1) * 0.02; // ±2% zoom

        // Apply position drift
        this.camera.position.x = xDrift;
        this.camera.position.y = yDrift;

        // Apply breathing zoom (adjust frustum size)
        const baseSize = 1000;
        const zoomFactor = 1 + breathe;
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = baseSize * zoomFactor;

        this.camera.left = (frustumSize * aspect) / -2;
        this.camera.right = (frustumSize * aspect) / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();
    }

    cleanup() {
        this.stop();
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        this.mountains.forEach((m) => {
            m.geometry.dispose();
            m.material.dispose();
        });
        this.mountains = [];

        if (this.starfield) {
            this.starfield.geometry.dispose();
            this.starfield.material.dispose();
            this.starfield = null;
        }

        this.nebulaPlanes.forEach((n) => {
            n.geometry.dispose();
            n.material.uniforms.tDiffuse.value?.dispose();
            n.material.dispose();
        });
        this.nebulaPlanes = [];

        this.starBursts.forEach((b) => { b.geometry.dispose(); b.material.dispose(); });
        this.starBursts = [];
        this.celestialBeams.forEach((b) => { b.geometry.dispose(); b.material.dispose(); });
        this.celestialBeams = [];
        this.cosmicRifts.forEach((b) => { b.geometry.dispose(); b.material.dispose(); });
        this.cosmicRifts = [];
        this.cosmicWaves.forEach((b) => { b.geometry.dispose(); b.material.dispose(); });
        this.cosmicWaves = [];
        this.meteors.forEach((m) => {
            m.userData.trail.geometry.dispose();
            m.userData.trail.material.dispose();
            m.userData.head.geometry.dispose();
            m.userData.head.material.dispose();
        });
        this.meteors = [];

        if (this.spirits) {
            this.spirits.geometry.dispose();
            this.spirits.material.dispose();
            this.spirits = null;
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;

        console.log('[Wolfhour] Theme cleaned up');
    }
}
