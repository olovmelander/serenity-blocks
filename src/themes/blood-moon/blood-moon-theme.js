/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌑 BLOOD MOON 🌑
 *  A Stunning 3D Blood Moon Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Deep 3D Starfield with twinkling white and red stars
 * - 3D Blood Moon sphere with procedural craters and pulsing crimson glow
 * - Multiple glow layers around the moon for intense atmosphere
 * - Drifting nebula clouds at varying depths
 * - Floating crimson particles throughout 3D space
 * - Gameplay effects: blood waves, crimson lightning, soul orbs
 * - Post-processing: Bloom + Vignette for atmospheric depth
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BLOOD_MOON_TETROMINOS } from './blood-moon-tetrominos.js';
import {
    moonVertexShader,
    moonFragmentShader,
    waveVertexShader,
    waveFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    starVertexShader,
    starFragmentShader,
    bloodSparkVertexShader,
    bloodSparkFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
} from './blood-moon-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 50000,
        nebulaCount: 25,
        ambientParticles: 400,
        bloodSparks: 3000,
        bloomStrength: 0.6,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        moonDetail: 64,
        glowLayers: 8,
    },
    Ultra: {
        starCount: 40000,
        nebulaCount: 20,
        ambientParticles: 300,
        bloodSparks: 2500,
        bloomStrength: 0.55,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        moonDetail: 56,
        glowLayers: 7,
    },
    High: {
        starCount: 30000,
        nebulaCount: 15,
        ambientParticles: 200,
        bloodSparks: 2000,
        bloomStrength: 0.5,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        moonDetail: 48,
        glowLayers: 6,
    },
    Medium: {
        starCount: 18000,
        nebulaCount: 10,
        ambientParticles: 120,
        bloodSparks: 1500,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        enablePostProcessing: true,
        moonDetail: 36,
        glowLayers: 5,
    },
    Low: {
        starCount: 10000,
        nebulaCount: 6,
        ambientParticles: 60,
        bloodSparks: 1000,
        bloomStrength: 0.3,
        bloomRadius: 0.3,
        enablePostProcessing: false,
        moonDetail: 24,
        glowLayers: 4,
    },
    Minimal: {
        starCount: 5000,
        nebulaCount: 4,
        ambientParticles: 30,
        bloodSparks: 600,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        enablePostProcessing: false,
        moonDetail: 16,
        glowLayers: 3,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.7 },
        offset: { value: 1.3 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;
        
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(offset, offset - 0.7, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class BloodMoonTheme extends BaseTheme {
    constructor() {
        super('blood-moon');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.moon = null;
        this.moonGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.ambientParticles = null;
        this.moonGlowLayers = [];
        this.bloodWaves = [];
        this.soulOrbs = [];
        this.bloodSparks = []; // Array of particle systems for overlapping bursts
        this.bloodSparkIndex = 0; // Cycle through available systems

        // Effect states
        this.moonPulseIntensity = 0;
        this.moonGlowIntensity = 1.0;
        this.comboMultiplier = 1.0;

        // Moon drift animation
        this.moonPhaseX = Math.random() * Math.PI * 2;
        this.moonPhaseY = Math.random() * Math.PI * 2;
        this.moonPhaseX2 = Math.random() * Math.PI * 2;
        this.moonPhaseY2 = Math.random() * Math.PI * 2;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingComboCount = 0;

        console.log('[BloodMoon] Theme constructed');
    }

    getTetrominoConfig() {
        return BLOOD_MOON_TETROMINOS;
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

    async createScene() {
        console.log('[BloodMoon] Creating stunning 3D blood moon scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('blood-moon-theme');
        if (!container) {
            console.error('[BloodMoon] Container not found');
            return;
        }

        // Clear any existing content (old canvas)
        container.innerHTML = '';

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaClouds();
        this.createMoon();
        this.createAmbientParticles();
        this.createBloodSparks();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[BloodMoon] Scene created successfully');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x050005, 1); // Deep crimson-black
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0208, 0.0008); // Crimson fog

        // Camera positioned for depth
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000);
        this.camera.position.set(0, 0, 1200);
        this.camera.lookAt(0, 0, 0);

        // Crimson lighting from moon
        const moonLight = new THREE.PointLight(0xcc1a2e, 2, 3000);
        moonLight.position.set(0, 0, 0);
        this.scene.add(moonLight);

        // Subtle ambient
        const ambientLight = new THREE.AmbientLight(0x150508, 0.4);
        this.scene.add(ambientLight);

        // Resize handler
        window.addEventListener('resize', this.onWindowResize.bind(this));

        console.log('[BloodMoon] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Deep 3D stars with white and red tinting
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2); // vec2: phase, speed
        const brightness = new Float32Array(starCount);

        // Blood moon red-tinted star colors
        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xffeedd), // Warm white
            new THREE.Color(0xffcccc), // Light pink
            new THREE.Color(0xff9999), // Pink
            new THREE.Color(0xff6666), // Red tint
            new THREE.Color(0xcc3333), // Deep red
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // Spread stars across full screen (rectangular distribution)
            // Use extra wide spread to account for camera parallax movement
            const spreadX = (Math.random() - 0.5) * 16000;  // Very wide horizontal spread
            const spreadY = (Math.random() - 0.5) * 10000;  // Very wide vertical spread

            // 3 depth layers: near, mid, far
            const layerRand = Math.random();
            let depth;
            if (layerRand < 0.33) {
                depth = -1500 - Math.random() * 500;   // Near layer
            } else if (layerRand < 0.66) {
                depth = -2500 - Math.random() * 1000;  // Mid layer
            } else {
                depth = -4000 - Math.random() * 2000;  // Far layer
            }

            positions[i3] = spreadX;
            positions[i3 + 1] = spreadY;
            positions[i3 + 2] = depth;

            // Color - mostly red-tinted stars for blood moon atmosphere
            const colorIndex = Math.random() > 0.15
                ? Math.floor(2 + Math.random() * 4) // Red tints (85%)
                : Math.floor(Math.random() * 2);     // White (15%)
            const color = starColors[colorIndex];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Larger atmospheric star sizes
            sizes[i] = 20 + Math.random() * 40;

            // Twinkle: phase offset, varied speed (0.8 to 2.5 Hz)
            twinkleData[i2] = Math.random() * Math.PI * 2;      // phase
            twinkleData[i2 + 1] = 0.8 + Math.random() * 1.7;    // speed

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
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[BloodMoon] Starfield created with', starCount, 'atmospheric stars in 3 depth layers');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Crimson/burgundy clouds at varying depths
    // ─────────────────────────────────────────────────────────────────────────



    createNebulaClouds() {
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/blood-moon/';

        const textures = [
            textureLoader.load(texturePath + 'nebula-red-1.png'),
            textureLoader.load(texturePath + 'nebula-red-2.png'),
            textureLoader.load(texturePath + 'nebula-red-3.png'),
        ];

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Large planes to fill the background
        const nebulaConfigs = [
            // Deep background layer (Parallax factor 0.1)
            { texture: textures[0], size: 6000, z: -4500, opacity: 0.3, speed: 0.0001 },
            { texture: textures[1], size: 7000, z: -4000, opacity: 0.25, speed: 0.00015 },
            // Mid layer (Parallax factor 0.3)
            { texture: textures[2], size: 5000, z: -3000, opacity: 0.2, speed: 0.0002 },
            { texture: textures[0], size: 5500, z: -2500, opacity: 0.15, speed: 0.00025 },
        ];

        this.nebulaClouds = [];

        nebulaConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
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
            // Random position spread
            mesh.position.x = (Math.random() - 0.5) * 2000;
            mesh.position.y = (Math.random() - 0.5) * 1000;
            mesh.position.z = config.z;
            mesh.rotation.z = Math.random() * Math.PI * 2;

            mesh.userData = {
                driftSpeed: config.speed,
                baseOpacity: config.opacity,
                pulsePhase: Math.random() * Math.PI * 2,
            };

            this.nebulaClouds.push(mesh);
            this.scene.add(mesh);
        });

        console.log('[BloodMoon] Nebula clouds created with textures');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blood Moon - 3D Sphere with craters and intense glow
    // ─────────────────────────────────────────────────────────────────────────

    createMoon() {
        const moonSize = 280;

        // Create moon group for drifting
        this.moonGroup = new THREE.Group();
        this.scene.add(this.moonGroup);

        // Moon sphere with shader material
        const geometry = new THREE.SphereGeometry(moonSize, this.qualityPreset.moonDetail, this.qualityPreset.moonDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulseIntensity: { value: 0 },
                uGlowIntensity: { value: 1.0 },
            },
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
        });

        this.moon = new THREE.Mesh(geometry, material);
        this.moon.renderOrder = 100;
        this.moonGroup.add(this.moon);

        // Create glow layers around the moon
        this.createMoonGlowLayers(moonSize);

        console.log('[BloodMoon] 3D Blood Moon created');
    }

    createMoonGlowLayers(moonSize) {
        const glowConfigs = [];
        const layerCount = this.qualityPreset.glowLayers;

        for (let i = 0; i < layerCount; i++) {
            const sizeMult = 1.3 + i * 0.25;
            const opacity = 0.35 - i * 0.04;
            glowConfigs.push({
                size: moonSize * sizeMult,
                color: i < 3 ? 0xcc1a2e : (i < 5 ? 0x8a0f1e : 0x500a12),
                opacity: Math.max(0.05, opacity),
                z: -5 * (i + 1),
            });
        }

        for (const config of glowConfigs) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.15, 'rgba(255, 200, 200, 0.8)');
            gradient.addColorStop(0.4, 'rgba(255, 100, 100, 0.4)');
            gradient.addColorStop(0.7, 'rgba(255, 50, 50, 0.15)');
            gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(geometry, material);
            glow.position.set(0, 0, config.z);
            glow.renderOrder = 50;
            glow.userData.baseOpacity = config.opacity;
            this.moonGlowLayers.push(glow);
            this.moonGroup.add(glow);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating crimson particles
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const particleCount = this.qualityPreset.ambientParticles;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            // Orbit around moon area
            const angle = Math.random() * Math.PI * 2;
            const radius = 200 + Math.random() * 600;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = (Math.random() - 0.5) * 400;
            positions[i3 + 2] = Math.sin(angle) * radius - 100;

            randoms[i] = Math.random();
            sizes[i] = 8.0 + Math.random() * 10.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.moonGroup.add(this.ambientParticles);

        console.log('[BloodMoon] Ambient particles created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blood Sparks - Explosive burst from moon surface outward
    // Creates a pool of particle systems to allow overlapping bursts
    // ─────────────────────────────────────────────────────────────────────────

    createBloodSparks() {
        const poolSize = 8; // Number of overlapping bursts allowed
        const countPerSystem = Math.floor(this.qualityPreset.bloodSparks / 2); // Split particles across pool

        const moonRadius = 180; // Start at moon surface

        // Color palette for blood sparks - deep reds
        const colorOptions = [
            new THREE.Color(0xff2020), // Bright pure red
            new THREE.Color(0xcc1a1a), // Deep crimson red
            new THREE.Color(0xff3030), // Vivid red
            new THREE.Color(0xdd2222), // Blood red
        ];

        for (let p = 0; p < poolSize; p++) {
            const geometry = new THREE.BufferGeometry();

            const thetas = new Float32Array(countPerSystem);
            const phis = new Float32Array(countPerSystem);
            const radii = new Float32Array(countPerSystem);
            const randoms = new Float32Array(countPerSystem);
            const colors = new Float32Array(countPerSystem * 3);
            const positions = new Float32Array(countPerSystem * 3);

            for (let i = 0; i < countPerSystem; i++) {
                // Distribute particles evenly on moon surface
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                thetas[i] = theta;
                phis[i] = phi;
                radii[i] = moonRadius;
                randoms[i] = Math.random();

                // Color selection - weighted toward hot colors
                const colorType = Math.random();
                let c;
                if (colorType > 0.6) c = colorOptions[0];
                else if (colorType > 0.3) c = colorOptions[1];
                else if (colorType > 0.1) c = colorOptions[2];
                else c = colorOptions[3];

                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = 0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aTheta', new THREE.BufferAttribute(thetas, 1));
            geometry.setAttribute('aPhi', new THREE.BufferAttribute(phis, 1));
            geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    uPulseTimer: { value: -100.0 },
                },
                vertexShader: bloodSparkVertexShader,
                fragmentShader: bloodSparkFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const sparks = new THREE.Points(geometry, material);
            this.moonGroup.add(sparks);
            this.bloodSparks.push(sparks);
        }

        console.log('[BloodMoon] Blood sparks pool created with', poolSize, 'systems,', countPerSystem, 'particles each');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) {
            console.log('[BloodMoon] Post-processing disabled for quality level');
            return;
        }

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.2
        );
        this.composer.addPass(bloomPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[BloodMoon] Post-processing configured');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        this.animate();
    }

    animate() {
        if (!this.isActive) return;

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);

        const delta = this.clock.getDelta();
        this.time += delta;

        // Update shader uniforms
        if (this.moon && this.moon.material.uniforms) {
            this.moon.material.uniforms.uTime.value = this.time;
            this.moon.material.uniforms.uPulseIntensity.value = this.moonPulseIntensity;
            this.moon.material.uniforms.uGlowIntensity.value = this.moonGlowIntensity;
        }

        if (this.starfield && this.starfield.material.uniforms) {
            this.starfield.material.uniforms.uTime.value = this.time;
            // Decay event boost smoothly
            if (this.starfield.material.uniforms.uEventBoost.value > 0) {
                this.starfield.material.uniforms.uEventBoost.value *= 0.95;
                if (this.starfield.material.uniforms.uEventBoost.value < 0.01) {
                    this.starfield.material.uniforms.uEventBoost.value = 0;
                }
            }
        }

        if (this.ambientParticles && this.ambientParticles.material.uniforms) {
            this.ambientParticles.material.uniforms.uTime.value = this.time;
        }

        // Update all blood spark systems in the pool
        for (const sparks of this.bloodSparks) {
            if (sparks && sparks.material.uniforms) {
                sparks.material.uniforms.time.value = this.time;

                // Update pulse wave
                if (sparks.material.uniforms.uPulseTimer.value > -50.0) {
                    // Move wave outwards at 15 units/sec for punchy explosion
                    sparks.material.uniforms.uPulseTimer.value += delta * 15.0;

                    // Turn off when wave completes (maxLife 70 + stagger 3 + buffer)
                    if (sparks.material.uniforms.uPulseTimer.value > 85.0) {
                        sparks.material.uniforms.uPulseTimer.value = -100.0;
                    }
                }
            }
        }

        // Slow drift moon across entire screen
        if (this.moonGroup) {
            const driftX = Math.sin(this.time * 0.03 + this.moonPhaseX) * 550 +
                Math.cos(this.time * 0.02 + this.moonPhaseX2) * 250;
            const driftY = Math.cos(this.time * 0.025 + this.moonPhaseY) * 350 +
                Math.sin(this.time * 0.015 + this.moonPhaseY2) * 150;

            this.moonGroup.position.x = driftX;
            this.moonGroup.position.y = driftY;

            // Gentle rotation
            this.moonGroup.rotation.z = Math.sin(this.time * 0.01) * 0.05;
        }

        // Slow camera orbit for parallax depth (independent of moon)
        if (this.camera) {
            const cameraTime = this.time * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 400; // Wide horizontal sway
            const orbitRadiusY = 300;  // Vertical sway range
            const orbitRadiusZ = 200;  // Depth breathing

            // Orbital sway - creates parallax with starfield/nebula
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX +
                Math.cos(cameraTime * 0.7) * orbitRadiusX * 0.4;
            this.camera.position.y = Math.cos(cameraTime * 0.8) * orbitRadiusY +
                Math.sin(cameraTime * 0.5) * orbitRadiusY * 0.3;
            this.camera.position.z = 1200 + Math.sin(cameraTime * 0.6) * orbitRadiusZ;

            // LookAt drift for dynamic framing (not following moon)
            const lookOffsetX = Math.sin(cameraTime * 0.4) * 150;
            const lookOffsetY = Math.cos(cameraTime * 0.5) * 100;
            this.camera.lookAt(lookOffsetX, lookOffsetY, 0);
        }

        // Pulse glow layers with moon pulse intensity
        const glowPulse = Math.sin(this.time * 2.0) * 0.15 + 1.0;
        for (const glow of this.moonGlowLayers) {
            const pulse = (1 + this.moonPulseIntensity * 0.5) * glowPulse;
            glow.material.opacity = glow.userData.baseOpacity * pulse;
        }

        // Nebula drift and pulse (synced with camera for seamless coverage)
        for (const cloud of this.nebulaClouds) {
            // Move nebulas with camera so they always cover the view
            // Plus gentle drift for atmosphere
            cloud.userData.driftOffset = (cloud.userData.driftOffset || 0) + cloud.userData.driftSpeed * 50;
            if (cloud.userData.driftOffset > 6000) cloud.userData.driftOffset = -6000;

            // Sync base position with camera, add drift offset
            cloud.position.x = (this.camera?.position.x || 0) * 0.3 + cloud.userData.driftOffset;
            cloud.position.y = (this.camera?.position.y || 0) * 0.2;

            cloud.userData.pulsePhase += 0.005;
            // Pulse: -1 to 1 for subtle breathing
            const pulse = Math.sin(cloud.userData.pulsePhase);

            if (cloud.material.uniforms) {
                cloud.material.uniforms.uPulse.value = pulse + (this.moonPulseIntensity * 2.0); // React to gameplay
            }
        }

        // Slowly rotate starfield
        if (this.starfield) {
            this.starfield.rotation.y = this.time * 0.005;
            this.starfield.rotation.z = this.time * 0.002;
        }

        // Decay pulse intensity
        if (this.moonPulseIntensity > 0) {
            this.moonPulseIntensity *= 0.95;
            if (this.moonPulseIntensity < 0.01) this.moonPulseIntensity = 0;
        }

        // Update blood waves
        this.updateBloodWaves(delta);

        // Update soul orbs
        this.updateSoulOrbs(delta);

        // Render
        this.renderer.clear();
        if (this.composer && this.qualityPreset.enablePostProcessing) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blood Waves - Expanding crimson torus rings
    // ─────────────────────────────────────────────────────────────────────────

    createBloodWave(intensity) {
        const geometry = new THREE.TorusGeometry(30, 2, 8, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: this.time },
                uOpacity: { value: 1.0 },
                uColor: { value: new THREE.Color(0xcc1a2e) },
            },
            vertexShader: waveVertexShader,
            fragmentShader: waveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.random() * Math.PI * 0.3;
        wave.rotation.y = Math.random() * Math.PI * 2;

        wave.userData = {
            speed: 80 + intensity * 20,
            life: 1.0,
            maxLife: 1.0,
        };

        this.moonGroup.add(wave);
        this.bloodWaves.push(wave);
    }

    updateBloodWaves(delta) {
        for (let i = this.bloodWaves.length - 1; i >= 0; i--) {
            const wave = this.bloodWaves[i];
            wave.scale.addScalar(wave.userData.speed * delta * 0.1);
            wave.userData.life -= delta * 0.8;

            if (wave.material.uniforms) {
                wave.material.uniforms.uOpacity.value = wave.userData.life;
            }

            if (wave.userData.life <= 0) {
                this.moonGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.bloodWaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Soul Orbs - Glowing particles rising upward
    // ─────────────────────────────────────────────────────────────────────────

    createSoulOrb() {
        const geometry = new THREE.SphereGeometry(4 + Math.random() * 4, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff4060,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });

        const orb = new THREE.Mesh(geometry, material);
        orb.position.x = (Math.random() - 0.5) * 300;
        orb.position.y = -200;
        orb.position.z = (Math.random() - 0.5) * 200;

        orb.userData = {
            velocityY: 30 + Math.random() * 40,
            velocityX: (Math.random() - 0.5) * 10,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
        };

        this.moonGroup.add(orb);
        this.soulOrbs.push(orb);
    }

    updateSoulOrbs(delta) {
        for (let i = this.soulOrbs.length - 1; i >= 0; i--) {
            const orb = this.soulOrbs[i];
            orb.position.y += orb.userData.velocityY * delta;
            orb.position.x += orb.userData.velocityX * delta;
            orb.userData.life -= delta * 0.3;

            // Pulse
            orb.userData.pulsePhase += delta * 5;
            const pulse = Math.sin(orb.userData.pulsePhase) * 0.3 + 0.7;
            orb.material.opacity = orb.userData.life * pulse;

            if (orb.userData.life <= 0 || orb.position.y > 300) {
                this.moonGroup.remove(orb);
                orb.geometry.dispose();
                orb.material.dispose();
                this.soulOrbs.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    handlePieceLock() {
        this.moonPulseIntensity = Math.min(this.moonPulseIntensity + 0.15, 0.5);
        // Subtle star twinkle boost on piece lock
        if (this.starfield && this.starfield.material.uniforms) {
            this.starfield.material.uniforms.uEventBoost.value = Math.min(
                this.starfield.material.uniforms.uEventBoost.value + 0.2, 0.5
            );
        }
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    onLineClear(lineCount, comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.moonPulseIntensity = Math.min(0.6 + comboCount * 0.2, 1.5);

        // Star twinkle boost scales with combo
        if (this.starfield && this.starfield.material.uniforms) {
            const boost = Math.min(0.3 + comboCount * 0.15 + lineCount * 0.1, 1.0);
            this.starfield.material.uniforms.uEventBoost.value = boost;
        }

        // Trigger blood spark burst on combos - cycle through pool for overlapping
        if (comboCount >= 2 && this.bloodSparks.length > 0) {
            const sparks = this.bloodSparks[this.bloodSparkIndex];
            if (sparks && sparks.material.uniforms) {
                sparks.material.uniforms.uPulseTimer.value = 0.0;
            }
            // Cycle to next system in pool
            this.bloodSparkIndex = (this.bloodSparkIndex + 1) % this.bloodSparks.length;
        }

        // Create blood waves
        const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), 4);
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => this.createBloodWave(comboCount), i * 100);
        }

        // Create soul orbs for combos
        if (comboCount >= 2) {
            const orbCount = Math.min(comboCount * 2, 10);
            for (let i = 0; i < orbCount; i++) {
                setTimeout(() => this.createSoulOrb(), i * 50);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
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

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        window.removeEventListener('resize', this.onWindowResize.bind(this));

        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('blood-moon-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose scene objects
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

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.moon = null;
        this.moonGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.moonGlowLayers = [];
        this.bloodWaves = [];
        this.soulOrbs = [];
        this.ambientParticles = null;
        this.bloodSparks = [];
        this.bloodSparkIndex = 0;

        super.stop();
    }
}
