/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FLUID DREAMS THEME - Three.js 3D Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A dreamy, flowing underwater-like experience featuring:
 * - Morphing 3D blobs with realistic reflective materials (MeshPhysicalMaterial)
 * - Iridescent soap bubbles with rainbow Fresnel effects
 * - Flowing ribbon streams with gradient shaders
 * - Ambient shimmer particles
 * - Gameplay-reactive effects (pulses, bursts, shockwaves)
 *
 * Inspired by: https://redstapler.co/three-js-realistic-material-reflection-tutorial/
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { FLUID_DREAMS_TETROMINOS } from './fluid-dreams-tetrominos.js';
import {
    backgroundVertexShader,
    backgroundFragmentShader,
    bubbleVertexShader,
    bubbleFragmentShader,
    blobVertexShader,
    blobFragmentShader,
    ribbonVertexShader,
    ribbonFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
} from './fluid-dreams-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = {
    Minimal: {
        blobCount: 3,
        bubbleCount: 12,
        ribbonCount: 2,
        particleCount: 200,
        blobSegments: 24,
        enableBloom: false,
        bloomStrength: 0.15,
    },
    Low: {
        blobCount: 4,
        bubbleCount: 18,
        ribbonCount: 3,
        particleCount: 400,
        blobSegments: 32,
        enableBloom: true,
        bloomStrength: 0.2,
    },
    Medium: {
        blobCount: 5,
        bubbleCount: 25,
        ribbonCount: 4,
        particleCount: 600,
        blobSegments: 48,
        enableBloom: true,
        bloomStrength: 0.22,
    },
    High: {
        blobCount: 6,
        bubbleCount: 32,
        ribbonCount: 5,
        particleCount: 800,
        blobSegments: 64,
        enableBloom: true,
        bloomStrength: 0.25,
    },
    Ultra: {
        blobCount: 8,
        bubbleCount: 40,
        ribbonCount: 6,
        particleCount: 1000,
        blobSegments: 80,
        enableBloom: true,
        bloomStrength: 0.28,
    },
    Extreme: {
        blobCount: 10,
        bubbleCount: 50,
        ribbonCount: 8,
        particleCount: 1500,
        blobSegments: 96,
        enableBloom: true,
        bloomStrength: 0.3,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palettes - Dreamy Iridescent
// ─────────────────────────────────────────────────────────────────────────────

const BLOB_COLORS = [
    {
        color1: new THREE.Color(0x79faff), // Aqua glow
        color2: new THREE.Color(0xff7cf0), // Magenta shine
        color3: new THREE.Color(0xa1ffcf), // Mint wave
    },
    {
        color1: new THREE.Color(0xff7cf0), // Magenta
        color2: new THREE.Color(0x8c9bff), // Indigo
        color3: new THREE.Color(0xffe066), // Golden
    },
    {
        color1: new THREE.Color(0xa1ffcf), // Mint
        color2: new THREE.Color(0x79faff), // Aqua
        color3: new THREE.Color(0xff8ba0), // Coral
    },
    {
        color1: new THREE.Color(0x8c9bff), // Indigo
        color2: new THREE.Color(0xffe066), // Golden
        color3: new THREE.Color(0xff7cf0), // Magenta
    },
];

const BUBBLE_COLORS = [
    new THREE.Color(0x79faff),
    new THREE.Color(0xff7cf0),
    new THREE.Color(0xa1ffcf),
    new THREE.Color(0xff8ba0),
    new THREE.Color(0x8c9bff),
];

const RIBBON_COLORS = [
    { color1: new THREE.Color(0x79faff), color2: new THREE.Color(0xff7cf0), color3: new THREE.Color(0xa1ffcf) },
    { color1: new THREE.Color(0xff8ba0), color2: new THREE.Color(0x8c9bff), color3: new THREE.Color(0xffe066) },
    { color1: new THREE.Color(0xa1ffcf), color2: new THREE.Color(0x79faff), color3: new THREE.Color(0xff8ba0) },
];

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class FluidDreamsTheme extends BaseTheme {
    constructor() {
        super('fluid-dreams');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Bind resize handler to keep reference for removal
        this.onWindowResize = this.onWindowResize.bind(this);

        // Scene elements
        this.backgroundSphere = null;
        this.blobs = [];
        this.bubbles = [];
        this.ribbons = [];
        this.particles = null;
        this.envMap = null;

        // Effect state
        this.shockwaves = [];
        this.uniforms = {
            time: { value: 0 },
            pulseIntensity: { value: 0 },
        };

        // Camera state
        this.baseCameraPos = new THREE.Vector3(0, 0, 50);
        this.cameraTarget = new THREE.Vector3(0, 0, 0);

        // Combo state
        this.comboMultiplier = 1.0;
        this.targetPulseIntensity = 0;

        // Quality
        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
        this.qualityChangeHandler = null;

        // Post-processing
        this.bloomPass = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Quality Management
    // ─────────────────────────────────────────────────────────────────────────

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!QUALITY_PRESETS[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality];
        console.log(`💧 Fluid Dreams 3D: Applied ${quality} quality preset`);

        if (this.isActive && this.scene) {
            this.rebuildQualityDependentElements();
        }
    }

    rebuildQualityDependentElements() {
        // Rebuild particles
        if (this.particles) {
            this.mainGroup.remove(this.particles);
            this.particles.geometry.dispose();
            this.particles.material.dispose();
        }
        this.createParticles();

        // Update bloom
        if (this.bloomPass) {
            this.bloomPass.enabled = this.activePreset.enableBloom;
            this.bloomPass.strength = this.activePreset.bloomStrength;
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
    // Tetromino Config
    // ─────────────────────────────────────────────────────────────────────────

    getTetrominoConfig() {
        return FLUID_DREAMS_TETROMINOS;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('💧 Fluid Dreams 3D: Initializing Three.js scene...');

        const container = document.getElementById('fluid-dreams-theme');
        if (!container) {
            console.error('💧 Fluid Dreams 3D: Container not found');
            return;
        }
        container.innerHTML = '';

        // Apply quality preset
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0515, 0.008);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            500
        );
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(this.cameraTarget);

        // Renderer - Following Red Stapler tutorial approach
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // ACES Filmic tone mapping (from tutorial)
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.6;

        // sRGB encoding (from tutorial)
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        container.appendChild(this.renderer.domElement);

        // Main group for scene organization
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create environment map FIRST (needed for materials)
        this.createEnvironmentMap();

        // Create scene elements
        this.createBackground();
        this.createBlobs();
        this.createBubbles();
        this.createRibbons();
        this.createParticles();
        this.setupLighting();
        this.setupPostProcessing();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize);

        // Start animation
        this.clock.start();
        this.animate();

        console.log(`💧 Fluid Dreams 3D: Scene initialized with ${this.blobs.length} blobs, ${this.bubbles.length} bubbles`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Environment Map - For realistic reflections (per Red Stapler tutorial)
    // ─────────────────────────────────────────────────────────────────────────

    createEnvironmentMap() {
        const size = 128;
        const faces = [];

        for (let i = 0; i < 6; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Base gradient - dreamy void (Darker)
            const gradient = ctx.createRadialGradient(
                size / 2, size / 2, 0,
                size / 2, size / 2, size * 0.7
            );
            gradient.addColorStop(0, '#0d0414');
            gradient.addColorStop(0.4, '#06020a');
            gradient.addColorStop(0.7, '#040106');
            gradient.addColorStop(1, '#000000');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            // Add iridescent spots for reflection (More subtle)
            const spotCount = 20 + Math.floor(Math.random() * 15);
            const colors = ['#79faff', '#ff7cf0', '#a1ffcf', '#8c9bff', '#ff8ba0', '#ffe066'];

            for (let j = 0; j < spotCount; j++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const r = 3 + Math.random() * 12;
                const color = colors[Math.floor(Math.random() * colors.length)];

                const spotGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                spotGrad.addColorStop(0, color);
                spotGrad.addColorStop(0.5, color + '40'); // Lower alpha
                spotGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = spotGrad;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
            }

            faces.push(canvas);
        }

        this.envMap = new THREE.CubeTexture(faces);
        this.envMap.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Background - Dreamy cosmic void
    // ─────────────────────────────────────────────────────────────────────────

    createBackground() {
        const geometry = new THREE.SphereGeometry(200, 64, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uPulseIntensity: this.uniforms.pulseIntensity,
            },
            vertexShader: backgroundVertexShader,
            fragmentShader: backgroundFragmentShader,
            side: THREE.BackSide,
            fog: false,
        });

        this.backgroundSphere = new THREE.Mesh(geometry, material);
        this.scene.add(this.backgroundSphere);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Morphing Blobs - Core visual element with realistic materials
    // ─────────────────────────────────────────────────────────────────────────

    createBlobs() {
        const count = this.activePreset.blobCount;
        const segments = this.activePreset.blobSegments;

        for (let i = 0; i < count; i++) {
            const palette = BLOB_COLORS[i % BLOB_COLORS.length];
            const size = 4 + Math.random() * 6;

            // Icosahedron for organic blob shape
            const geometry = new THREE.IcosahedronGeometry(size, 4);

            // Create custom shader material with morphing
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uMorphSpeed: { value: 0.3 + Math.random() * 0.3 },
                    uMorphAmount: { value: 0.8 + Math.random() * 0.6 },
                    uPulseIntensity: this.uniforms.pulseIntensity,
                    uMorphSeed: {
                        value: new THREE.Vector3(
                            Math.random() * 100,
                            Math.random() * 100,
                            Math.random() * 100
                        )
                    },
                    uColor1: { value: palette.color1 },
                    uColor2: { value: palette.color2 },
                    uColor3: { value: palette.color3 },
                    uEnvMap: { value: this.envMap },
                    uEnvMapIntensity: { value: 0.25 },
                    uClearcoat: { value: 0.6 },
                    uRoughness: { value: 0.2 },
                    uMetalness: { value: 0.8 },
                },
                vertexShader: blobVertexShader,
                fragmentShader: blobFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
            });

            const blob = new THREE.Mesh(geometry, material);

            // Position blobs in a loose arrangement
            const angle = (i / count) * Math.PI * 2;
            const radius = 15 + Math.random() * 10;
            const height = (Math.random() - 0.5) * 20;

            blob.position.set(
                Math.cos(angle) * radius,
                height,
                Math.sin(angle) * radius
            );

            // Store animation data
            blob.userData = {
                basePosition: blob.position.clone(),
                floatPhase: Math.random() * Math.PI * 2,
                floatSpeed: 0.3 + Math.random() * 0.3,
                floatAmplitude: 1 + Math.random() * 2,
                orbitSpeed: 0.05 + Math.random() * 0.05,
                orbitRadius: radius,
            };

            this.mainGroup.add(blob);
            this.blobs.push(blob);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Iridescent Bubbles - Floating upward with rainbow Fresnel
    // ─────────────────────────────────────────────────────────────────────────

    createBubbles() {
        const count = this.activePreset.bubbleCount;

        for (let i = 0; i < count; i++) {
            const size = 0.5 + Math.random() * 1.5;
            const geometry = new THREE.SphereGeometry(size, 24, 24);

            const baseColor = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.6 + Math.random() * 0.3 },
                    uBaseColor: { value: baseColor },
                    uEnvMap: { value: this.envMap },
                    uEnvMapIntensity: { value: 0.3 },
                    uPulseIntensity: this.uniforms.pulseIntensity,
                },
                vertexShader: bubbleVertexShader,
                fragmentShader: bubbleFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const bubble = new THREE.Mesh(geometry, material);

            // Random starting position
            bubble.position.set(
                (Math.random() - 0.5) * 60,
                -30 + Math.random() * 60,
                (Math.random() - 0.5) * 40
            );

            // Animation data
            bubble.userData = {
                speed: 1 + Math.random() * 2,
                wobblePhase: Math.random() * Math.PI * 2,
                wobbleSpeed: 1 + Math.random() * 2,
                wobbleAmount: 0.5 + Math.random() * 1,
                startY: bubble.position.y,
            };

            this.mainGroup.add(bubble);
            this.bubbles.push(bubble);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Flowing Ribbons - Gradient streams
    // ─────────────────────────────────────────────────────────────────────────

    createRibbons() {
        const count = this.activePreset.ribbonCount;

        for (let i = 0; i < count; i++) {
            // Create curved path
            const points = [];
            const segments = 50;
            const startAngle = Math.random() * Math.PI * 2;
            const length = 30 + Math.random() * 20;

            for (let j = 0; j <= segments; j++) {
                const t = j / segments;
                const angle = startAngle + t * Math.PI * (0.5 + Math.random() * 1);
                const radius = 20 + Math.sin(t * Math.PI * 3) * 10;
                const height = (t - 0.5) * 30 + Math.sin(t * Math.PI * 4) * 5;

                points.push(new THREE.Vector3(
                    Math.cos(angle) * radius,
                    height,
                    Math.sin(angle) * radius
                ));
            }

            const curve = new THREE.CatmullRomCurve3(points);
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, 0.3 + Math.random() * 0.4, 8, false);

            // Add progress attribute for flowing effect
            const positionAttr = tubeGeometry.attributes.position;
            const progress = new Float32Array(positionAttr.count);

            for (let j = 0; j < positionAttr.count; j++) {
                // Approximate progress along tube
                const pos = new THREE.Vector3().fromBufferAttribute(positionAttr, j);
                let minDist = Infinity;
                let bestT = 0;

                for (let t = 0; t <= 1; t += 0.02) {
                    const curvePoint = curve.getPointAt(t);
                    const dist = pos.distanceTo(curvePoint);
                    if (dist < minDist) {
                        minDist = dist;
                        bestT = t;
                    }
                }
                progress[j] = bestT;
            }
            tubeGeometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));

            const colors = RIBBON_COLORS[i % RIBBON_COLORS.length];
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uColor1: { value: colors.color1 },
                    uColor2: { value: colors.color2 },
                    uColor3: { value: colors.color3 },
                    uOpacity: { value: 0.08 + Math.random() * 0.05 },
                    uPulseIntensity: this.uniforms.pulseIntensity,
                },
                vertexShader: ribbonVertexShader,
                fragmentShader: ribbonFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const ribbon = new THREE.Mesh(tubeGeometry, material);

            // Rotation offset
            ribbon.rotation.y = Math.random() * Math.PI * 2;
            ribbon.rotation.x = (Math.random() - 0.5) * 0.3;

            ribbon.userData = {
                rotationSpeed: (Math.random() - 0.5) * 0.02,
            };

            this.mainGroup.add(ribbon);
            this.ribbons.push(ribbon);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Shimmer effect
    // ─────────────────────────────────────────────────────────────────────────

    createParticles() {
        const count = this.activePreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        const colorOptions = [
            new THREE.Color(0x79faff),
            new THREE.Color(0xff7cf0),
            new THREE.Color(0xa1ffcf),
            new THREE.Color(0x8c9bff),
            new THREE.Color(0xffe066),
        ];

        for (let i = 0; i < count; i++) {
            // Distribute in sphere
            const r = 10 + Math.random() * 60;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            phases[i] = Math.random();
            sizes[i] = 0.3 + Math.random() * 1.5;

            const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
                uPulseIntensity: this.uniforms.pulseIntensity,
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.particles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.particles);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Ambient light - soft purple tint
        const ambient = new THREE.AmbientLight(0x1a0828, 0.2);
        this.scene.add(ambient);

        // Hemisphere light - gradient from above/below
        const hemi = new THREE.HemisphereLight(0x79faff, 0xff7cf0, 0.2);
        this.scene.add(hemi);

        // Point lights near blobs
        const lightColors = [0x79faff, 0xff7cf0, 0xa1ffcf, 0x8c9bff];
        for (let i = 0; i < 4; i++) {
            const light = new THREE.PointLight(lightColors[i], 0.5, 50);
            const angle = (i / 4) * Math.PI * 2;
            light.position.set(
                Math.cos(angle) * 20,
                (Math.random() - 0.5) * 15,
                Math.sin(angle) * 20
            );
            this.mainGroup.add(light);
        }

        // Central glow was removed to prevent whiteout
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);

        // Render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom for dreamy glow
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.activePreset.bloomStrength,
            0.2,  // radius
            0.85   // threshold
        );
        this.bloomPass.enabled = this.activePreset.enableBloom;
        this.composer.addPass(this.bloomPass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gameplay Effects
    // ─────────────────────────────────────────────────────────────────────────

    onLineClear(lineCount) {
        // Pulse intensity boost
        this.targetPulseIntensity = Math.min(this.targetPulseIntensity + lineCount * 0.3, 1.5);

        // Create shockwave
        this.createShockwave(lineCount * 0.3);

        // Burst bubbles outward
        this.burstBubbles(lineCount);
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 3.0);

        // Strong pulse
        this.targetPulseIntensity = Math.min(this.targetPulseIntensity + comboCount * 0.2, 2.0);

        // Boost bloom temporarily
        if (this.bloomPass && this.activePreset.enableBloom) {
            this.bloomPass.strength = this.activePreset.bloomStrength + comboCount * 0.1;
        }

        // Multiple shockwaves for high combos
        if (comboCount >= 3) {
            for (let i = 0; i < Math.min(comboCount - 2, 3); i++) {
                setTimeout(() => {
                    this.createShockwave(0.5 + comboCount * 0.1);
                }, i * 100);
            }
        }
    }

    onPieceLock() {
        // Stronger pulse for visibility
        this.targetPulseIntensity = Math.min(this.targetPulseIntensity + 0.5, 1.0);
    }

    createShockwave(intensity) {
        const geometry = new THREE.PlaneGeometry(100, 100);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uRadius: { value: 0 },
                uMaxRadius: { value: 1.0 },
                uColor: { value: new THREE.Color(0x79faff) },
                uIntensity: { value: intensity },
            },
            vertexShader: shockwaveVertexShader,
            fragmentShader: shockwaveFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const shockwave = new THREE.Mesh(geometry, material);
        shockwave.position.copy(this.camera.position);
        shockwave.position.z -= 30;
        shockwave.lookAt(this.camera.position);

        shockwave.userData = {
            startTime: this.clock.getElapsedTime(),
            duration: 1.0,
        };

        this.scene.add(shockwave);
        this.shockwaves.push(shockwave);
    }

    burstBubbles(intensity) {
        // Push bubbles outward briefly
        this.bubbles.forEach((bubble) => {
            const direction = bubble.position.clone().normalize();
            bubble.userData.burstVelocity = direction.multiplyScalar(intensity * 2);
            bubble.userData.burstDecay = 0.95;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(() => this.animate());

        const elapsed = this.clock.getElapsedTime();
        const delta = this.clock.getDelta();

        // Update uniforms
        this.uniforms.time.value = elapsed;

        // Decay pulse intensity - SNAPPIER RESPONSE
        // Faster lerp to catch up (0.4 vs 0.1), slightly slower decay (0.92 vs 0.95)
        this.uniforms.pulseIntensity.value += (this.targetPulseIntensity - this.uniforms.pulseIntensity.value) * 0.4;
        this.targetPulseIntensity *= 0.92;

        // Reset bloom to base strength gradually
        if (this.bloomPass && this.activePreset.enableBloom) {
            this.bloomPass.strength += (this.activePreset.bloomStrength - this.bloomPass.strength) * 0.05;
        }

        // Animate blobs
        this.blobs.forEach((blob) => {
            const data = blob.userData;

            // Floating motion
            const floatY = Math.sin(elapsed * data.floatSpeed + data.floatPhase) * data.floatAmplitude;

            // Slow orbit
            const orbitAngle = elapsed * data.orbitSpeed;
            const baseAngle = Math.atan2(data.basePosition.z, data.basePosition.x);

            blob.position.x = Math.cos(baseAngle + orbitAngle) * data.orbitRadius;
            blob.position.y = data.basePosition.y + floatY;
            blob.position.z = Math.sin(baseAngle + orbitAngle) * data.orbitRadius;

            // Slow rotation
            blob.rotation.y += 0.002;
            blob.rotation.x += 0.001;
        });

        // Animate bubbles
        this.bubbles.forEach((bubble) => {
            const data = bubble.userData;

            // Upward float
            bubble.position.y += data.speed * delta * 3;

            // Horizontal wobble
            const wobble = Math.sin(elapsed * data.wobbleSpeed + data.wobblePhase) * data.wobbleAmount;
            bubble.position.x += Math.sin(elapsed * 0.5) * 0.02;

            // Burst velocity decay
            if (data.burstVelocity) {
                bubble.position.add(data.burstVelocity.clone().multiplyScalar(delta));
                data.burstVelocity.multiplyScalar(data.burstDecay);
                if (data.burstVelocity.length() < 0.01) {
                    data.burstVelocity = null;
                }
            }

            // Reset when off screen
            if (bubble.position.y > 40) {
                bubble.position.y = -35;
                bubble.position.x = (Math.random() - 0.5) * 60;
                bubble.position.z = (Math.random() - 0.5) * 40;
            }
        });

        // Animate ribbons
        this.ribbons.forEach((ribbon) => {
            ribbon.rotation.y += ribbon.userData.rotationSpeed;
        });

        // Update shockwaves
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const shockwave = this.shockwaves[i];
            const age = elapsed - shockwave.userData.startTime;
            const progress = age / shockwave.userData.duration;

            if (progress >= 1) {
                this.scene.remove(shockwave);
                shockwave.geometry.dispose();
                shockwave.material.dispose();
                this.shockwaves.splice(i, 1);
            } else {
                shockwave.material.uniforms.uRadius.value = progress;
            }
        }

        // Gentle camera drift
        const cameraWobbleX = Math.sin(elapsed * 0.1) * 2;
        const cameraWobbleY = Math.cos(elapsed * 0.08) * 1.5;
        this.camera.position.x = this.baseCameraPos.x + cameraWobbleX;
        this.camera.position.y = this.baseCameraPos.y + cameraWobbleY;
        this.camera.lookAt(this.cameraTarget);

        // Render
        if (this.composer && this.activePreset.enableBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
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

        if (this.bloomPass) {
            this.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        console.log('💧 Fluid Dreams 3D: Stopping...');

        // Cancel animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Teardown quality listener
        this.teardownQualityListener();

        // Remove resize listener
        window.removeEventListener('resize', this.onWindowResize);

        // Dispose Three.js resources
        if (this.scene) {
            // Dispose blobs
            this.blobs.forEach((blob) => {
                blob.geometry.dispose();
                blob.material.dispose();
                this.mainGroup.remove(blob);
            });
            this.blobs = [];

            // Dispose bubbles
            this.bubbles.forEach((bubble) => {
                bubble.geometry.dispose();
                bubble.material.dispose();
                this.mainGroup.remove(bubble);
            });
            this.bubbles = [];

            // Dispose ribbons
            this.ribbons.forEach((ribbon) => {
                ribbon.geometry.dispose();
                ribbon.material.dispose();
                this.mainGroup.remove(ribbon);
            });
            this.ribbons = [];

            // Dispose particles
            if (this.particles) {
                this.particles.geometry.dispose();
                this.particles.material.dispose();
                this.mainGroup.remove(this.particles);
                this.particles = null;
            }

            // Dispose shockwaves
            this.shockwaves.forEach((sw) => {
                sw.geometry.dispose();
                sw.material.dispose();
                this.scene.remove(sw);
            });
            this.shockwaves = [];

            // Dispose background
            if (this.backgroundSphere) {
                this.backgroundSphere.geometry.dispose();
                this.backgroundSphere.material.dispose();
                this.scene.remove(this.backgroundSphere);
                this.backgroundSphere = null;
            }

            // Dispose env map
            if (this.envMap) {
                this.envMap.dispose();
                this.envMap = null;
            }

            // Dispose composer
            if (this.composer) {
                this.composer.dispose();
                this.composer = null;
            }

            // Dispose renderer
            if (this.renderer) {
                this.renderer.dispose();
                this.renderer.domElement.remove();
                this.renderer = null;
            }

            // Clear scene
            this.scene.clear();
            this.scene = null;
            this.mainGroup = null;
        }

        this.camera = null;
        this.clock = new THREE.Clock();

        super.stop();

        console.log('💧 Fluid Dreams 3D: Stopped.');
    }
}
