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
        this.cameraTargetOffset = new THREE.Vector3(0, 0, 0);

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
            500,
        );
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(this.cameraTarget);

        // Renderer - Following Red Stapler tutorial approach
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());

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
                size / 2,
                size / 2,
                0,
                size / 2,
                size / 2,
                size * 0.7,
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
                spotGrad.addColorStop(0.5, `${color}40`); // Lower alpha
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
                            Math.random() * 100,
                        ),
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

            // Spread blobs across the FULL screen for immersive coverage
            // Use layered depth - some close, some far
            const zLayer = Math.random();
            const zPosition = (zLayer < 0.3) ? 10 + Math.random() * 15 // Close layer
                : (zLayer < 0.7) ? -10 + Math.random() * 20 // Mid layer
                    : -30 + Math.random() * 20; // Far layer

            blob.position.set(
                (Math.random() - 0.5) * 120, // Wide X spread across screen
                (Math.random() - 0.5) * 70, // Full vertical coverage
                zPosition, // Layered depth
            );

            // Store animation data for drifting/floating
            blob.userData = {
                basePosition: blob.position.clone(),
                floatPhase: Math.random() * Math.PI * 2,
                floatPhase2: Math.random() * Math.PI * 2, // Secondary phase for complex motion
                floatSpeed: 0.15 + Math.random() * 0.15, // Slower, dreamier
                floatAmplitude: 3 + Math.random() * 5, // Larger float range
                // Drift velocity - slow continuous movement across screen
                driftSpeed: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.8, // Slow X drift
                    (Math.random() - 0.5) * 0.4, // Slow Y drift
                    (Math.random() - 0.5) * 0.5, // Slow Z drift
                ),
                // Combo effect state
                comboScale: 1.0,
                targetComboScale: 1.0,
                comboColorShift: 0, // Color cycling effect
                comboWobble: 0, // Wobble/jiggle effect
                comboGlow: 0, // Subtle light pulse
                originalScale: size,
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
                (Math.random() - 0.5) * 40,
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
                    Math.sin(angle) * radius,
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
                Math.sin(angle) * 20,
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
            0.2, // radius
            0.85, // threshold
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
        // Very minimal pulse
        this.targetPulseIntensity = Math.min(this.targetPulseIntensity + lineCount * 0.02, 0.2);

        // Shockwave disabled - too bright
        // this.createShockwave(lineCount * 0.3);

        // Burst bubbles outward (subtle)
        this.burstBubbles(lineCount * 0.3);
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 3.0);

        // Minimal pulse - avoid brightness
        this.targetPulseIntensity = Math.min(this.targetPulseIntensity + comboCount * 0.01, 0.15);

        // No bloom boost - keep it at base level
        // (removed to prevent brightness)

        // ═══════════════════════════════════════════════════════════════════
        // BLOB-CONNECTED COMBO EFFECTS
        // ═══════════════════════════════════════════════════════════════════

        // Activate ALL blobs for the pulse/wobble/color effects
        this.blobs.forEach((blob) => {
            const data = blob.userData;

            // Scale pulse - very subtle breathing effect
            data.targetComboScale = 1.03 + comboCount * 0.01; // Barely visible

            // Color shift - cycle through the palette
            data.comboColorShift = 1.0 + comboCount * 0.3;

            // Wobble - make blobs jiggle gently
            data.comboWobble = 0.5 + comboCount * 0.2;

            // Light Pulse - Sharp "kick" that decays fast (snappy flash)
            data.comboGlow = Math.min(0.4 + comboCount * 0.1, 0.8);

            // Speed up drift temporarily
            const speedBoost = 1.5 + comboCount * 0.3;
            data.driftSpeed.x *= speedBoost;
            data.driftSpeed.y *= speedBoost;
            data.driftSpeed.z *= speedBoost;

            // Decay speed back to normal over time
            setTimeout(() => {
                if (data.driftSpeed) {
                    data.driftSpeed.x /= speedBoost;
                    data.driftSpeed.y /= speedBoost;
                    data.driftSpeed.z /= speedBoost;
                }
            }, 800);
        });

        // Trigger particles/ripples on a subset to avoid performance/visual overload
        // Select random blobs to emit particles/ripples based on combo count
        const particleCount = Math.min(comboCount + 1, 5);
        const shuffledBlobs = [...this.blobs].sort(() => Math.random() - 0.5);

        for (let i = 0; i < particleCount; i++) {
            const blob = shuffledBlobs[i];

            // Emit burst particles from this blob (re-enabled)
            this.emitBlobBurstParticles(blob, comboCount);

            // Create ripple rings emanating from this blob (fluid theme fitting)
            this.createBlobRipple(blob, comboCount);
        }

        // Create energy connections between nearby blobs for high combos
        if (comboCount >= 3) {
            this.createBlobConnections(comboCount);
        }

        // Shockwaves disabled to prevent brightness
        // if (comboCount >= 3) {
        //     for (let i = 0; i < Math.min(comboCount - 2, 3); i++) {
        //         setTimeout(() => {
        //             this.createShockwave(0.5 + comboCount * 0.1);
        //         }, i * 100);
        //     }
        // }
    }

    onPieceLock() {
        // Very minimal pulse
        this.targetPulseIntensity = Math.min(this.targetPulseIntensity + 0.02, 0.1);
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
    // Blob Ripple Effect - Expanding rings emanating from blobs (fluid theme)
    // ─────────────────────────────────────────────────────────────────────────

    createBlobRipple(blob, comboCount) {
        const blobRadius = blob.userData.originalScale || 5;

        // Create a ring geometry around the blob
        const geometry = new THREE.RingGeometry(blobRadius * 0.8, blobRadius * 1.0, 32);

        // Pick a color from the blob's palette
        const colors = [0x79faff, 0xff7cf0, 0xa1ffcf, 0x8c9bff];
        const ringColor = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);

        const material = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.2, // Subtle starting opacity
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const ripple = new THREE.Mesh(geometry, material);
        ripple.position.copy(blob.position);

        // Random slight rotation
        ripple.rotation.x = Math.random() * Math.PI * 0.3;
        ripple.rotation.y = Math.random() * Math.PI * 2;

        ripple.userData = {
            startTime: this.clock.getElapsedTime(),
            duration: 1.5 + comboCount * 0.2,
            startScale: 1,
            maxScale: 3 + comboCount * 0.5,
            blob, // Reference to track blob position
        };

        this.scene.add(ripple);

        // Store for animation/cleanup
        if (!this.blobRipples) this.blobRipples = [];
        this.blobRipples.push(ripple);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blob Burst Particles - Emit sparkles from blob surface during combos
    // ─────────────────────────────────────────────────────────────────────────

    emitBlobBurstParticles(blob, comboCount) {
        const particleCount = 5 + comboCount; // Very few particles
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const colorOptions = [
            new THREE.Color(0x79faff),
            new THREE.Color(0xff7cf0),
            new THREE.Color(0xa1ffcf),
            new THREE.Color(0xffe066),
        ];

        for (let i = 0; i < particleCount; i++) {
            // Emit from blob surface in random directions
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const direction = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi),
            );

            // Start at blob surface
            const blobRadius = blob.userData.originalScale || 5;
            positions[i * 3] = blob.position.x + direction.x * blobRadius;
            positions[i * 3 + 1] = blob.position.y + direction.y * blobRadius;
            positions[i * 3 + 2] = blob.position.z + direction.z * blobRadius;

            // Velocity outward
            velocities.push(direction.clone().multiplyScalar(5 + Math.random() * 10));

            // Random iridescent color
            const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            sizes[i] = 0.5 + Math.random() * 0.8; // Very small particles
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 1.0 },
            },
            vertexShader: `
                attribute vec3 aColor;
                attribute float aSize;
                varying vec3 vColor;
                varying float vOpacity;
                uniform float uOpacity;
                void main() {
                    vColor = aColor;
                    vOpacity = uOpacity;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize * (100.0 / -mvPosition.z);  // Smaller point size
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float glow = 1.0 - dist * 2.0;
                    glow = pow(glow, 3.0);  // Very sharp falloff
                    gl_FragColor = vec4(vColor, glow * vOpacity * 0.3);  // Much dimmer
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const burstParticles = new THREE.Points(geometry, material);
        burstParticles.userData = {
            velocities,
            startTime: this.clock.getElapsedTime(),
            duration: 1.2,
            gravity: -2,
        };

        this.scene.add(burstParticles);

        // Store for animation/cleanup
        if (!this.blobBurstParticles) this.blobBurstParticles = [];
        this.blobBurstParticles.push(burstParticles);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blob Energy Connections - Draw glowing lines between nearby blobs
    // ─────────────────────────────────────────────────────────────────────────

    createBlobConnections(comboCount) {
        // 1. Constellation Chain Logic: A -> B -> C
        // Pick a random starting blob to ensure variety
        let currentBlob = this.blobs[Math.floor(Math.random() * this.blobs.length)];
        const visited = new Set([currentBlob]);

        // Limit chain length based on combo, but keep it reasonable
        const chainLength = Math.min(comboCount, 5);

        for (let i = 0; i < chainLength; i++) {
            let nearestBlob = null;
            let minDist = Infinity;

            // Find nearest unvisited blob
            for (const blob of this.blobs) {
                if (!visited.has(blob)) {
                    const dist = currentBlob.position.distanceTo(blob.position);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestBlob = blob;
                    }
                }
            }

            // If we found a neighbor within reasonable range, connect and continue chain
            if (nearestBlob && minDist < 100) { // Large search radius ensures connections
                this.createEnergyLine(currentBlob, nearestBlob, comboCount);
                visited.add(nearestBlob);
                currentBlob = nearestBlob;
            } else {
                break; // End chain if no valid neighbors
            }
        }
    }

    createEnergyLine(blobA, blobB, comboCount) {
        // Clean constellation line - simple glowing connection
        const segments = 20;
        const points = [];

        // Create a gentle curved path between blobs
        const midPoint = new THREE.Vector3()
            .addVectors(blobA.position, blobB.position)
            .multiplyScalar(0.5);
        // Subtle upward arc for elegance
        const dist = blobA.position.distanceTo(blobB.position);
        midPoint.y += Math.min(dist * 0.15, 5);

        const curve = new THREE.QuadraticBezierCurve3(
            blobA.position.clone(),
            midPoint,
            blobB.position.clone(),
        );

        for (let i = 0; i <= segments; i++) {
            points.push(curve.getPoint(i / segments));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        // Soft white-cyan glow for constellation aesthetic
        const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(0xaaeeff),
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
        });

        const line = new THREE.Line(geometry, material);
        line.userData = {
            startTime: this.clock.getElapsedTime(),
            duration: 1.5 + comboCount * 0.2,
            blobA,
            blobB,
        };

        this.mainGroup.add(line);

        if (!this.energyLines) this.energyLines = [];
        this.energyLines.push(line);
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

        // Animate blobs with drifting and floating
        this.blobs.forEach((blob) => {
            const data = blob.userData;

            // Apply drift velocity (continuous slow movement)
            blob.position.x += data.driftSpeed.x * delta;
            blob.position.y += data.driftSpeed.y * delta;
            blob.position.z += data.driftSpeed.z * delta;

            // Layered floating motion (more organic with two sine waves)
            const floatY = Math.sin(elapsed * data.floatSpeed + data.floatPhase) * data.floatAmplitude;
            const floatX = Math.sin(elapsed * data.floatSpeed * 0.7 + data.floatPhase2) * data.floatAmplitude * 0.5;
            blob.position.y += floatY * delta * 0.5;
            blob.position.x += floatX * delta * 0.3;

            // Wrap-around when blobs drift off-screen (seamless looping)
            if (blob.position.x > 70) { blob.position.x = -70; data.basePosition.x = blob.position.x; }
            if (blob.position.x < -70) { blob.position.x = 70; data.basePosition.x = blob.position.x; }
            if (blob.position.y > 45) { blob.position.y = -45; data.basePosition.y = blob.position.y; }
            if (blob.position.y < -45) { blob.position.y = 45; data.basePosition.y = blob.position.y; }
            if (blob.position.z > 40) { blob.position.z = -40; data.basePosition.z = blob.position.z; }
            if (blob.position.z < -50) { blob.position.z = 30; data.basePosition.z = blob.position.z; }

            // Animate combo scale effect
            data.comboScale += (data.targetComboScale - data.comboScale) * 0.08;
            data.targetComboScale += (1.0 - data.targetComboScale) * 0.02; // Decay back to 1.0
            const scale = data.originalScale * data.comboScale;
            blob.scale.setScalar(scale / data.originalScale);

            // Animate color shift (passed to shader via morph seed modulation)
            if (data.comboColorShift > 0) {
                data.comboColorShift *= 0.98; // Decay
                if (blob.material.uniforms.uMorphSpeed) {
                    blob.material.uniforms.uMorphSpeed.value = 0.3 + data.comboColorShift * 0.5;
                }
            }

            // Animate wobble effect
            if (data.comboWobble > 0) {
                data.comboWobble *= 0.96; // Decay
                const wobbleX = Math.sin(elapsed * 8 + data.floatPhase) * data.comboWobble * 0.3;
                const wobbleY = Math.cos(elapsed * 7 + data.floatPhase2) * data.comboWobble * 0.2;
                blob.position.x += wobbleX * delta;
                blob.position.y += wobbleY * delta;
            }

            // Animate glow pulse (Slower, dreamy pulse)
            if (data.comboGlow > 0.01) {
                data.comboGlow *= 0.96; // Slower decay for longer presence
                if (blob.material.uniforms.uPulseIntensity) {
                    // Add to base pulse
                    const basePulse = this.uniforms.pulseIntensity.value;
                    // Calmer sine modulation (3.0 vs 15.0)
                    const life = 1.0 + Math.sin(elapsed * 3.0) * 0.15;
                    blob.material.uniforms.uPulseIntensity.value = Math.min(basePulse + data.comboGlow * life, 1.3);
                }
            } else {
                // Sync with global pulse if no local combo glow
                if (blob.material.uniforms.uPulseIntensity) {
                    blob.material.uniforms.uPulseIntensity.value = this.uniforms.pulseIntensity.value;
                }
            }

            // Slow rotation for organic feel
            blob.rotation.y += 0.003;
            blob.rotation.x += 0.002;
            blob.rotation.z += 0.001;
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

        // ═══════════════════════════════════════════════════════════════════
        // Animate Blob Burst Particles
        // ═══════════════════════════════════════════════════════════════════
        if (this.blobBurstParticles) {
            for (let i = this.blobBurstParticles.length - 1; i >= 0; i--) {
                const burst = this.blobBurstParticles[i];
                const age = elapsed - burst.userData.startTime;
                const progress = age / burst.userData.duration;

                if (progress >= 1) {
                    this.scene.remove(burst);
                    burst.geometry.dispose();
                    burst.material.dispose();
                    this.blobBurstParticles.splice(i, 1);
                } else {
                    // Update particle positions with velocity and gravity
                    const positions = burst.geometry.attributes.position.array;
                    const { velocities } = burst.userData;

                    for (let j = 0; j < velocities.length; j++) {
                        velocities[j].y += burst.userData.gravity * delta;
                        positions[j * 3] += velocities[j].x * delta;
                        positions[j * 3 + 1] += velocities[j].y * delta;
                        positions[j * 3 + 2] += velocities[j].z * delta;
                    }
                    burst.geometry.attributes.position.needsUpdate = true;

                    // Fade out
                    burst.material.uniforms.uOpacity.value = 1 - progress;
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Animate Blob Ripples
        // ═══════════════════════════════════════════════════════════════════
        if (this.blobRipples) {
            for (let i = this.blobRipples.length - 1; i >= 0; i--) {
                const ripple = this.blobRipples[i];
                const age = elapsed - ripple.userData.startTime;
                const progress = age / ripple.userData.duration;

                if (progress >= 1) {
                    this.scene.remove(ripple);
                    ripple.geometry.dispose();
                    ripple.material.dispose();
                    this.blobRipples.splice(i, 1);
                } else {
                    // Expand the ripple
                    const scale = ripple.userData.startScale + progress * (ripple.userData.maxScale - ripple.userData.startScale);
                    ripple.scale.setScalar(scale);

                    // Fade out as it expands
                    ripple.material.opacity = 0.2 * (1 - progress);

                    // Follow the blob if it's still moving
                    if (ripple.userData.blob && ripple.userData.blob.position) {
                        ripple.position.lerp(ripple.userData.blob.position, 0.1);
                    }
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Animate Energy Lines
        // Animate Constellation Lines
        if (this.energyLines) {
            for (let i = this.energyLines.length - 1; i >= 0; i--) {
                const line = this.energyLines[i];
                const age = elapsed - line.userData.startTime;
                const progress = age / line.userData.duration;

                if (progress >= 1) {
                    // Cleanup
                    line.geometry.dispose();
                    line.material.dispose();
                    this.mainGroup.remove(line);
                    this.energyLines.splice(i, 1);
                } else {
                    const { blobA } = line.userData;
                    const { blobB } = line.userData;

                    if (blobA && blobB && blobA.position && blobB.position) {
                        // Fade in/out - quick fade in, slow fade out
                        const opacity = progress < 0.1 ? progress * 6 : 0.6 * (1 - progress);
                        line.material.opacity = opacity;

                        // Update curve to follow moving blobs
                        const dist = blobA.position.distanceTo(blobB.position);
                        const midPoint = new THREE.Vector3()
                            .addVectors(blobA.position, blobB.position)
                            .multiplyScalar(0.5);
                        midPoint.y += Math.min(dist * 0.15, 5);

                        const curve = new THREE.QuadraticBezierCurve3(
                            blobA.position,
                            midPoint,
                            blobB.position,
                        );

                        const points = curve.getPoints(20);
                        line.geometry.setFromPoints(points);
                    }
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Dynamic Dreamy Camera Movement
        // ═══════════════════════════════════════════════════════════════════
        const cameraTime = elapsed * 0.05; // Slow overall movement

        // Multi-layered sine waves for organic floating motion
        const cameraWobbleX = Math.sin(cameraTime) * 4 + Math.sin(cameraTime * 1.7) * 2 + Math.sin(cameraTime * 0.3) * 3;
        const cameraWobbleY = Math.cos(cameraTime * 0.8) * 3 + Math.sin(cameraTime * 1.3) * 1.5;
        const cameraWobbleZ = Math.sin(cameraTime * 0.6) * 5 + Math.cos(cameraTime * 0.4) * 2;

        this.camera.position.x = this.baseCameraPos.x + cameraWobbleX;
        this.camera.position.y = this.baseCameraPos.y + cameraWobbleY;
        this.camera.position.z = this.baseCameraPos.z + cameraWobbleZ;

        // Subtle camera target movement for additional dreaminess
        this.cameraTargetOffset.x = Math.sin(cameraTime * 0.4) * 2;
        this.cameraTargetOffset.y = Math.cos(cameraTime * 0.3) * 1.5;
        this.camera.lookAt(
            this.cameraTarget.x + this.cameraTargetOffset.x,
            this.cameraTarget.y + this.cameraTargetOffset.y,
            this.cameraTarget.z,
        );

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

            // Dispose blob burst particles
            if (this.blobBurstParticles) {
                this.blobBurstParticles.forEach((burst) => {
                    burst.geometry.dispose();
                    burst.material.dispose();
                    this.scene.remove(burst);
                });
                this.blobBurstParticles = [];
            }

            // Dispose energy lines
            if (this.energyLines) {
                this.energyLines.forEach((line) => {
                    line.geometry.dispose();
                    line.material.dispose();
                    this.mainGroup.remove(line);
                });
                this.energyLines = [];
            }

            // Dispose blob ripples
            if (this.blobRipples) {
                this.blobRipples.forEach((ripple) => {
                    ripple.geometry.dispose();
                    ripple.material.dispose();
                    this.scene.remove(ripple);
                });
                this.blobRipples = [];
            }

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
