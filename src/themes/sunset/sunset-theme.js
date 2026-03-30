/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ SUNSET THEME - Three.js 3D Edition ✧
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A stunning 3D sunset/sunrise experience with:
 * - Dynamic day-night cycle with magical golden hour colors
 * - Glowing 3D sun with corona effects
 * - Volumetric god rays
 * - Twinkling starfield that appears at night
 * - Floating ambient particles
 * - Gentle camera drift
 * - Lock piece and combo effects
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SUNSET_TETROMINOS } from './sunset-tetrominos.js';
import { SunsetOceanWater } from './SunsetOceanWater.js';
import {
    skyVertexShader,
    skyFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    starVertexShader,
    starFragmentShader,
    godRayVertexShader,
    godRayFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
    flareVertexShader,
    flareFragmentShader,
    moonVertexShader,
    moonFragmentShader,
} from './sunset-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = {
    Extreme: {
        starCount: 35000,
        particleCount: 600,
        godRaySegments: 64,
        enablePostEffects: true,
        enableBloom: true,
        bloomStrength: 0.35,
        bloomRadius: 0.4,
        bloomThreshold: 0.92,
    },
    Ultra: {
        starCount: 25000,
        particleCount: 450,
        godRaySegments: 48,
        enablePostEffects: true,
        enableBloom: true,
        bloomStrength: 0.3,
        bloomRadius: 0.35,
        bloomThreshold: 0.92,
    },
    High: {
        starCount: 15000,
        particleCount: 300,
        godRaySegments: 32,
        enablePostEffects: true,
        enableBloom: true,
        bloomStrength: 0.28,
        bloomRadius: 0.3,
        bloomThreshold: 0.94,
    },
    Medium: {
        starCount: 8000,
        particleCount: 200,
        godRaySegments: 24,
        enablePostEffects: true,
        enableBloom: true,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        bloomThreshold: 0.95,
    },
    Low: {
        starCount: 3000,
        particleCount: 100,
        godRaySegments: 16,
        enablePostEffects: false,
        enableBloom: false,
        bloomStrength: 0.2,
        bloomRadius: 0.2,
        bloomThreshold: 0.96,
    },
    Minimal: {
        starCount: 1000,
        particleCount: 25,
        godRaySegments: 12,
        enablePostEffects: false,
        enableBloom: false,
        bloomStrength: 0,
        bloomRadius: 0,
        bloomThreshold: 1.0,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palette - Warm sunset tones
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = {
    // Dawn colors (early morning)
    dawn: {
        top: new THREE.Color(0x1a1a3e), // Deep purple-blue
        mid: new THREE.Color(0xff6b8a), // Rose pink
        bottom: new THREE.Color(0xffb347), // Warm orange
    },
    // Day colors (midday)
    day: {
        top: new THREE.Color(0x87ceeb), // Sky blue
        mid: new THREE.Color(0xffecd2), // Soft cream
        bottom: new THREE.Color(0xffd89b), // Golden glow
    },
    // Sunset colors (golden hour)
    sunset: {
        top: new THREE.Color(0x2d1b4e), // Deep purple
        mid: new THREE.Color(0xff4500), // Orange-red
        bottom: new THREE.Color(0xffd700), // Golden yellow
    },
    // Night colors
    night: {
        top: new THREE.Color(0x0a0a1a), // Deep night blue
        mid: new THREE.Color(0x1a1a2e), // Dark purple
        bottom: new THREE.Color(0x2d1b4e), // Purple horizon
    },
    // Sun colors
    sun: {
        core: new THREE.Color(0xffffff), // Bright white core
        corona: new THREE.Color(0xffdd44), // Golden corona
        edge: new THREE.Color(0xff6b1a), // Orange edge
    },
    // God ray color
    godRays: new THREE.Color(0xffcc66),
    // Particle colors (embers/dust)
    particles: [
        new THREE.Color(0xffd700), // Gold
        new THREE.Color(0xff8c00), // Dark orange
        new THREE.Color(0xff6b6b), // Soft red
        new THREE.Color(0xffb347), // Light orange
    ],
    // Horizon
    horizon: {
        day: new THREE.Color(0x4a3728), // Warm brown
        night: new THREE.Color(0x1a1a2e), // Dark blue
    },
    // Moon colors for night
    moon: {
        core: new THREE.Color(0xf5f5dc), // Beige/cream moon
        glow: new THREE.Color(0xd4c4a8), // Soft warm glow
        halo: new THREE.Color(0x6b5b4f), // Subtle outer halo
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class SunsetTheme extends BaseTheme {
    constructor() {
        super('sunset');
        this.eventUnsubscribers = [];
        this.boundResizeHandler = this.onWindowResize.bind(this);

        // Three.js core components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.sky = null;
        this.sun = null;
        this.sunGlowLayers = [];
        this.godRays = null;
        this.stars = null;
        this.particles = null;
        this.horizon = null;
        this.ocean = null;
        this.moon = null;
        this.moonGlowLayers = [];

        // Effects
        this.shockwaves = [];
        this.celestialFlares = [];

        // Post-processing
        this.composer = null;
        this.bloomPass = null;

        // Moon position (opposite of sun)
        this.moonPosition = new THREE.Vector3(0, -30, -120);

        // Day-night cycle state
        this.dayProgress = 0.55; // Start at golden hour (0.5-0.75 is sunset)
        this.cycleSpeed = 0.005; // Full cycle takes ~200 seconds

        // Camera animation
        this.baseCameraPos = new THREE.Vector3(0, 0, 30);

        // Shared uniforms
        this.uniforms = {
            time: { value: 0 },
            dayProgress: { value: 0.55 },
            sunIntensity: { value: 1.0 },
        };

        // Sun position (moves based on day progress)
        this.sunPosition = new THREE.Vector3(0, 5, -100);

        // Quality settings
        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
        this.qualityChangeHandler = null;
    }

    getTetrominoConfig() {
        return SUNSET_TETROMINOS;
    }

    getCurrentQualityLevel() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!QUALITY_PRESETS[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[Sunset3D] Initializing Three.js scene...');

        const container = document.getElementById('sunset-theme');
        if (!container) {
            console.error('[Sunset3D] Container not found');
            return;
        }

        // Clear any existing content
        container.innerHTML = '';

        // Apply quality settings
        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        this.setupQualityListener();

        // Initialize renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: true,
            powerPreference: 'high-performance',
        });
        // Use effective pixel ratio (applies render scale for performance)
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        container.appendChild(this.renderer.domElement);

        // Setup scene
        this.scene = new THREE.Scene();

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            30000,
        );
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(0, 0, 0);

        // Main group for drifting elements
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create all scene elements
        this.createSky();
        this.createSun();
        this.createGodRays();
        this.createMoon(); // Beautiful moon for night
        this.createStars();
        // this.createParticles(); // Disabled per user request
        this.createOcean(); // Ocean water with reflections
        this.setupLighting();

        // Setup dynamic atmospheric fog
        // Color and density will be updated based on time of day
        this.scene.fog = new THREE.FogExp2(0xffd89b, 0.003);

        // Setup ACES Filmic tone mapping for cinematic HDR
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.85;

        // Setup post-processing (bloom, etc.)
        this.setupPostProcessing();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.boundResizeHandler);

        // Start animation
        this.clock.start();
        this.animate();

        console.log('[Sunset3D] Scene initialized with', this.currentQuality, 'quality');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sky Dome
    // ─────────────────────────────────────────────────────────────────────────

    createSky() {
        const geometry = new THREE.SphereGeometry(500, 32, 32);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uDayProgress: this.uniforms.dayProgress,
                uSunPosition: { value: this.sunPosition },
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.BackSide,
            depthWrite: false,
        });

        this.sky = new THREE.Mesh(geometry, material);
        this.sky.renderOrder = -100; // Background should be rendered first
        this.scene.add(this.sky);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sun with Glow Layers
    // ─────────────────────────────────────────────────────────────────────────

    createSun() {
        // Main sun sphere
        const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
        const sunMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uIntensity: this.uniforms.sunIntensity,
                uCoreColor: { value: PALETTE.sun.core },
                uCoronaColor: { value: PALETTE.sun.corona },
                uEdgeColor: { value: PALETTE.sun.edge },
            },
            vertexShader: sunVertexShader,
            fragmentShader: sunFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sun.position.copy(this.sunPosition);
        this.mainGroup.add(this.sun);

        // Add glow layers (sprites) - reduced opacity to prevent over-brightness
        const glowTexture = this.createGlowTexture();
        const glowLayers = [
            { scale: 25, opacity: 0.2, color: PALETTE.sun.corona },
            { scale: 40, opacity: 0.12, color: PALETTE.sun.edge },
            { scale: 60, opacity: 0.06, color: new THREE.Color(0xff6600) },
        ];

        glowLayers.forEach((layer) => {
            const spriteMaterial = new THREE.SpriteMaterial({
                map: glowTexture,
                color: layer.color,
                transparent: true,
                opacity: layer.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(layer.scale, layer.scale, 1);
            sprite.position.copy(this.sunPosition);
            this.mainGroup.add(sprite);
            this.sunGlowLayers.push(sprite);
        });
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 240, 200, 0.7)');
        gradient.addColorStop(0.2, 'rgba(255, 200, 100, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 150, 50, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        return new THREE.CanvasTexture(canvas);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // God Rays
    // ─────────────────────────────────────────────────────────────────────────

    createGodRays() {
        const geometry = new THREE.PlaneGeometry(60, 60, 1, 1);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uIntensity: this.uniforms.sunIntensity,
                uColor: { value: PALETTE.godRays },
            },
            vertexShader: godRayVertexShader,
            fragmentShader: godRayFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.godRays = new THREE.Mesh(geometry, material);
        this.godRays.position.copy(this.sunPosition);
        this.godRays.position.z += 1; // Slightly in front of sun
        this.mainGroup.add(this.godRays);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield
    // ─────────────────────────────────────────────────────────────────────────

    createStarsOld() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Star colors - whites, pale blues, pale yellows
        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xffeedd),
            new THREE.Color(0xddddff),
            new THREE.Color(0xffffee),
        ];

        for (let i = 0; i < count; i++) {
            // Spread stars on a hemisphere above
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.8); // Upper portion
            const radius = 300 + Math.random() * 100;

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.cos(phi) + 50; // Bias upward
            positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            sizes[i] = 0.5 + Math.random() * 2.0;
            phases[i] = Math.random() * Math.PI * 2;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uDayProgress: this.uniforms.dayProgress,
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.stars = new THREE.Points(geometry, material);
        this.scene.add(this.stars); // Stars in background scene
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles (dust motes, embers)
    // ─────────────────────────────────────────────────────────────────────────

    createParticles() {
        const count = this.activePreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Spread particles in view
            positions[i * 3] = (Math.random() - 0.5) * 80;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 60 - 10;

            sizes[i] = 1 + Math.random() * 3;
            phases[i] = Math.random();

            const color = PALETTE.particles[Math.floor(Math.random() * PALETTE.particles.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
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
    // Ocean Water
    // ─────────────────────────────────────────────────────────────────────────

    createOcean() {
        // Large ocean plane extending to horizon
        // Higher resolution geometry for smoother waves
        const geometry = new THREE.PlaneGeometry(800, 400, 128, 64);

        // Load water normal texture
        const textureLoader = new THREE.TextureLoader();
        const waterNormals = textureLoader.load(
            'textures/water-normal.jpg',
            (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                // Ensure the uniform is updated after load
                if (this.ocean?.material?.uniforms?.normalSampler) {
                    this.ocean.material.uniforms.normalSampler.value = texture;
                }
                console.log('[Sunset3D] Ocean water normal texture loaded');
            },
            undefined,
            (error) => {
                console.warn('[Sunset3D] Failed to load water normal texture', error);
            },
        );

        this.ocean = new SunsetOceanWater(geometry, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals,
            sunDirection: new THREE.Vector3(0, 0.5, -1).normalize(),
            sunColor: 0xffd700,
            waterColor: 0x1a3a5c,
            distortionScale: 2.0, // Reduced for smoother appearance
            fog: false,
        });

        // Set size uniform for proper noise scaling
        if (this.ocean.material?.uniforms?.size) {
            this.ocean.material.uniforms.size.value = 0.5;
        }

        this.ocean.rotation.x = -Math.PI / 2;
        this.ocean.position.set(0, -28, -35); // At horizon level, in front of celestial bodies
        this.mainGroup.add(this.ocean);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ocean Color Interpolation for Day-Night Cycle
    // ─────────────────────────────────────────────────────────────────────────

    getOceanColorsForTime(dayProgress) {
        // Define color palettes for different times of day
        const palettes = {
            // Night (0.0) - Deep navy
            night: {
                near: new THREE.Color(0x0a1628),
                far: new THREE.Color(0x1a2840),
                sunReflect: new THREE.Color(0xc0c0ff),
            },
            // Dawn (0.22) - Purple to rose
            dawn: {
                near: new THREE.Color(0x2a1a40),
                far: new THREE.Color(0xff6b8a),
                sunReflect: new THREE.Color(0xffb347),
            },
            // Morning (0.35) - Teal to sky blue
            morning: {
                near: new THREE.Color(0x1a4a6a),
                far: new THREE.Color(0x87ceeb),
                sunReflect: new THREE.Color(0xffd89b),
            },
            // Noon (0.5) - Ocean blue
            noon: {
                near: new THREE.Color(0x1a5a7a),
                far: new THREE.Color(0x4a90c0),
                sunReflect: new THREE.Color(0xffffff),
            },
            // Golden Hour (0.72) - Brown-orange to orange
            golden: {
                near: new THREE.Color(0x4a3020),
                far: new THREE.Color(0xff8c00),
                sunReflect: new THREE.Color(0xffd700),
            },
            // Sunset (0.82) - Purple-brown to red-orange
            sunset: {
                near: new THREE.Color(0x2a1a30),
                far: new THREE.Color(0xff4500),
                sunReflect: new THREE.Color(0xff6b1a),
            },
            // Dusk (0.92) - Dark purple to magenta
            dusk: {
                near: new THREE.Color(0x1a1a2e),
                far: new THREE.Color(0x4a2040),
                sunReflect: new THREE.Color(0xd4c4a8),
            },
        };

        // Helper function to interpolate between palettes
        const lerpPalette = (p1, p2, t) => ({
            near: new THREE.Color().lerpColors(p1.near, p2.near, t),
            far: new THREE.Color().lerpColors(p1.far, p2.far, t),
            sunReflect: new THREE.Color().lerpColors(p1.sunReflect, p2.sunReflect, t),
        });

        // Determine which palettes to blend based on dayProgress
        if (dayProgress < 0.12) {
            // Night -> Pre-dawn
            const t = dayProgress / 0.12;
            return lerpPalette(palettes.night, palettes.dawn, t * 0.3);
        } if (dayProgress < 0.22) {
            // Pre-dawn -> Dawn
            const t = (dayProgress - 0.12) / 0.10;
            return lerpPalette(palettes.night, palettes.dawn, 0.3 + t * 0.7);
        } if (dayProgress < 0.35) {
            // Dawn -> Morning
            const t = (dayProgress - 0.22) / 0.13;
            return lerpPalette(palettes.dawn, palettes.morning, t);
        } if (dayProgress < 0.50) {
            // Morning -> Noon
            const t = (dayProgress - 0.35) / 0.15;
            return lerpPalette(palettes.morning, palettes.noon, t);
        } if (dayProgress < 0.65) {
            // Noon -> Afternoon (stay similar)
            const t = (dayProgress - 0.50) / 0.15;
            return lerpPalette(palettes.noon, palettes.golden, t * 0.3);
        } if (dayProgress < 0.72) {
            // Afternoon -> Golden Hour
            const t = (dayProgress - 0.65) / 0.07;
            return lerpPalette(palettes.noon, palettes.golden, 0.3 + t * 0.7);
        } if (dayProgress < 0.82) {
            // Golden Hour -> Sunset
            const t = (dayProgress - 0.72) / 0.10;
            return lerpPalette(palettes.golden, palettes.sunset, t);
        } if (dayProgress < 0.92) {
            // Sunset -> Dusk
            const t = (dayProgress - 0.82) / 0.10;
            return lerpPalette(palettes.sunset, palettes.dusk, t);
        }
        // Dusk -> Night
        const t = (dayProgress - 0.92) / 0.08;
        return lerpPalette(palettes.dusk, palettes.night, t);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Moon - Beautiful glowing moon for night
    // ─────────────────────────────────────────────────────────────────────────

    createMoon() {
        // Create moon sphere with crater shader
        const moonGeometry = new THREE.SphereGeometry(8, 48, 48);

        // Load high-res moon texture (Source: https://www.solarsystemscope.com/textures/)
        const textureLoader = new THREE.TextureLoader();
        const moonTexture = textureLoader.load('./textures/2k_moon.jpg'); // Use relative path for Vite
        moonTexture.wrapS = THREE.ClampToEdgeWrapping;
        moonTexture.wrapT = THREE.ClampToEdgeWrapping;

        const moonMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: moonTexture },
                uTime: this.uniforms.time,
                uOpacity: { value: 0 }, // Start hidden, fade in at night
                uSunDirection: { value: new THREE.Vector3(1, 0, 0) }, // Will be updated
            },
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
            transparent: true,
            depthWrite: true,
        });

        this.moon = new THREE.Mesh(moonGeometry, moonMaterial);
        this.moon.position.copy(this.moonPosition);
        this.moon.renderOrder = 10; // Ensure moon renders AFTER stars (foreground)
        this.mainGroup.add(this.moon);

        // Create glow layers for moon
        const glowTexture = this.createMoonGlowTexture();
        const glowLayers = [
            { scale: 22, opacity: 0.4, color: PALETTE.moon.core },
            { scale: 38, opacity: 0.2, color: PALETTE.moon.glow },
            { scale: 60, opacity: 0.08, color: PALETTE.moon.halo },
        ];

        glowLayers.forEach((layer, index) => {
            const spriteMaterial = new THREE.SpriteMaterial({
                map: glowTexture,
                color: layer.color,
                transparent: true,
                opacity: 0, // Start hidden
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(layer.scale, layer.scale, 1);
            sprite.position.copy(this.moonPosition);
            sprite.userData = { baseOpacity: layer.opacity, index };
            this.mainGroup.add(sprite);
            this.moonGlowLayers.push(sprite);
        });
    }

    createMoonGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(245, 245, 220, 1)'); // Beige center
        gradient.addColorStop(0.3, 'rgba(212, 196, 168, 0.6)'); // Soft glow
        gradient.addColorStop(0.6, 'rgba(107, 91, 79, 0.2)'); // Subtle halo
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        return new THREE.CanvasTexture(canvas);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Warm ambient light
        const ambient = new THREE.AmbientLight(0xffd89b, 0.3);
        this.scene.add(ambient);

        // Sun directional light
        const sunLight = new THREE.DirectionalLight(0xffcc66, 0.8);
        sunLight.position.copy(this.sunPosition);
        this.scene.add(sunLight);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.activePreset.enableBloom) {
            console.log('[Sunset3D] Bloom disabled for quality preset');
            return;
        }

        // Create EffectComposer
        this.composer = new EffectComposer(this.renderer);

        // Base render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // UnrealBloomPass for sun/star light bleed
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.activePreset.bloomStrength,
            this.activePreset.bloomRadius,
            this.activePreset.bloomThreshold,
        );
        this.composer.addPass(this.bloomPass);

        // Vignette pass for cinematic feel
        const VignetteShader = {
            uniforms: {
                tDiffuse: { value: null },
                darkness: { value: 0.5 },
                offset: { value: 1.2 },
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
                uniform float darkness;
                uniform float offset;
                varying vec2 vUv;
                
                void main() {
                    vec4 texel = texture2D(tDiffuse, vUv);
                    vec2 uv = (vUv - 0.5) * 2.0;
                    float vignette = 1.0 - smoothstep(offset - 0.5, offset, length(uv));
                    texel.rgb = mix(texel.rgb, texel.rgb * (1.0 - darkness), 1.0 - vignette);
                    gl_FragColor = texel;
                }
            `,
        };

        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.darkness.value = 0.4;
        vignettePass.uniforms.offset.value = 1.3;
        this.composer.addPass(vignettePass);

        console.log('[Sunset3D] Post-processing initialized with bloom and vignette');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        // Update uniforms
        this.uniforms.time.value = elapsed;

        // Progress day-night cycle
        this.dayProgress = (this.dayProgress + this.cycleSpeed * delta) % 1.0;
        this.uniforms.dayProgress.value = this.dayProgress;

        // Update sun position based on day progress
        this.updateSunPosition();

        // Decay sun intensity back to normal
        if (this.uniforms.sunIntensity.value > 1.0) {
            this.uniforms.sunIntensity.value = THREE.MathUtils.lerp(
                this.uniforms.sunIntensity.value,
                1.0,
                delta * 2.0,
            );
        }

        // Camera drift
        this.updateCameraDrift(elapsed);

        // Update effects
        this.updateShockwaves(delta);
        this.updateCelestialFlares(delta);

        // Rotate stars slowly and handle event boost decay
        if (this.stars) {
            this.stars.rotation.y = elapsed * 0.005;
            // Decay event boost smoothly
            if (this.stars.material.uniforms.uEventBoost && this.stars.material.uniforms.uEventBoost.value > 0) {
                this.stars.material.uniforms.uEventBoost.value *= 0.95;
                if (this.stars.material.uniforms.uEventBoost.value < 0.01) {
                    this.stars.material.uniforms.uEventBoost.value = 0;
                }
            }
        }

        // Rotate moon slowly
        if (this.moon) {
            this.moon.rotation.y += delta * 0.05;
        }

        // Update ocean uniforms
        this.updateOcean(elapsed);

        // Update dynamic fog
        this.updateFog();

        // Render - use composer if available for post-processing
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateSunPosition() {
        // Sun traces a proper arc across the sky and below the horizon
        // The arc goes from east (dawn) to west (sunset) and dips below at night
        // dayProgress: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1 = midnight

        const angle = this.dayProgress * Math.PI * 2 - Math.PI * 0.5;

        // Widen the arc significantly to use full desktop screen width
        // Z is -100, so X needs to be ~180-200 to cover full 16:9 FOV
        const x = Math.cos(angle) * 200; // Much wider sweep

        // Y position: Peak higher in the sky for a grander feel
        const y = Math.sin(angle) * 70 - 15; // Peak +55, Dip -85

        this.sunPosition.set(x, y, -100);

        // Update sun mesh and glow layers
        if (this.sun) {
            this.sun.position.copy(this.sunPosition);
        }
        this.sunGlowLayers.forEach((sprite) => {
            sprite.position.copy(this.sunPosition);
        });
        if (this.godRays) {
            this.godRays.position.copy(this.sunPosition);
            this.godRays.position.z += 1;
        }

        // Update sky shader uniform
        if (this.sky?.material?.uniforms?.uSunPosition) {
            this.sky.material.uniforms.uSunPosition.value.copy(this.sunPosition);
        }

        // Calculate sun visibility - fades as it approaches horizon
        // Horizon is around Y = -30, fade starts at Y = 0
        const sunVisibility = THREE.MathUtils.clamp((y + 30) / 40, 0, 1);

        if (this.sun) {
            this.sun.material.opacity = sunVisibility;
            this.sun.visible = sunVisibility > 0.01;
        }
        this.sunGlowLayers.forEach((sprite) => {
            const baseOpacity = sprite.userData?.baseOpacity || 0.5;
            sprite.material.opacity = baseOpacity * sunVisibility;
        });
        if (this.godRays) {
            this.godRays.material.uniforms.uIntensity.value = sunVisibility;
            this.godRays.visible = sunVisibility > 0.05;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Moon - rises from bottom during deep night
        // Moon appears later than sun disappears, peaking around midnight
        // ─────────────────────────────────────────────────────────────────────

        // Moon angle: offset so it peaks at midnight (dayProgress = 0 or 1)
        // When dayProgress = 0 (midnight), moonAngle should give max Y
        const moonAngle = (this.dayProgress + 0.5) * Math.PI * 2 - Math.PI * 0.5;

        // Widen moon path even more as it is further away (Z=-120)
        const moonX = Math.cos(moonAngle) * 240;

        // Moon Y: Peak higher (+50) to match sun's grandeur
        const moonY = Math.sin(moonAngle) * 75 - 25;

        this.moonPosition.set(moonX, moonY, -120);

        // Moon visibility - only visible when above horizon AND sun is down
        // Horizon is around Y = -30
        const moonAboveHorizon = THREE.MathUtils.clamp((moonY + 35) / 50, 0, 1);
        const sunDown = 1 - sunVisibility;
        const moonVisibility = sunDown * moonAboveHorizon;

        if (this.moon) {
            this.moon.position.copy(this.moonPosition);
            // Update shader uniforms
            if (this.moon.material.uniforms?.uOpacity) {
                this.moon.material.uniforms.uOpacity.value = moonVisibility;
            }
            // Update sun direction for realistic phase lighting
            if (this.moon.material.uniforms?.uSunDirection) {
                const sunDir = this.sunPosition.clone().normalize();
                this.moon.material.uniforms.uSunDirection.value.copy(sunDir);
            }
            this.moon.visible = moonVisibility > 0.01;
        }
        this.moonGlowLayers.forEach((sprite) => {
            sprite.position.copy(this.moonPosition);
            const baseOpacity = sprite.userData?.baseOpacity || 0.3;
            sprite.material.opacity = baseOpacity * moonVisibility;
        });
    }

    updateFog() {
        if (!this.scene?.fog) return;

        // ═══════════════════════════════════════════════════════════════════════
        // DYNAMIC ATMOSPHERIC FOG
        // Density and color change based on time of day
        // ═══════════════════════════════════════════════════════════════════════

        const { dayProgress } = this;

        // Calculate fog density based on time of day
        // Thicker at dawn (~0.22) and dusk (~0.82), lighter at noon and night
        const dawnWeight = Math.exp(-(((dayProgress - 0.22) * 8) ** 2));
        const duskWeight = Math.exp(-(((dayProgress - 0.82) * 8) ** 2));
        const noonWeight = Math.exp(-(((dayProgress - 0.5) * 5) ** 2));
        const nightWeight = dayProgress < 0.15 || dayProgress > 0.9 ? 1.0 : 0.0;

        // Fog density: thick at dawn/dusk, light at noon, very light at night
        const baseDensity = 0.002;
        const dawnDuskDensity = 0.006;
        const nightDensity = 0.001;

        let fogDensity = baseDensity;
        fogDensity += (dawnWeight + duskWeight) * (dawnDuskDensity - baseDensity);
        fogDensity = THREE.MathUtils.lerp(fogDensity, nightDensity, nightWeight * 0.7);

        this.scene.fog.density = fogDensity;

        // Fog color matches horizon palette
        const fogColorNight = new THREE.Color(0x0a0812);
        const fogColorDawn = new THREE.Color(0xffb090);
        const fogColorNoon = new THREE.Color(0xc8dff8);
        const fogColorDusk = new THREE.Color(0xff8060);

        const fogColor = new THREE.Color();
        fogColor.copy(fogColorNoon);
        fogColor.lerp(fogColorDawn, dawnWeight);
        fogColor.lerp(fogColorDusk, duskWeight);
        fogColor.lerp(fogColorNight, nightWeight * 0.8);

        this.scene.fog.color.copy(fogColor);
    }

    updateCameraDrift(elapsed) {
        if (!this.camera) return;

        // ═══════════════════════════════════════════════════════════════════════
        // IMMERSIVE BREATHING CAMERA MOVEMENT
        // More pronounced, meditative motion with layered frequencies
        // ═══════════════════════════════════════════════════════════════════════

        const t = elapsed;

        // Primary breathing speed (~10 second cycle)
        const breatheSpeed = 0.1;
        // Secondary slow drift (~25 second cycle)
        const driftSpeed = 0.04;

        // ─────────────────────────────────────────────────────────────────────
        // X Axis: Gentle horizontal sway
        // ─────────────────────────────────────────────────────────────────────
        const floatX = Math.sin(t * driftSpeed) * 4.0 // Primary sway
            + Math.sin(t * driftSpeed * 0.7 + 1.0) * 2.0 // Secondary offset
            + Math.cos(t * driftSpeed * 1.3) * 1.0; // Subtle variation

        // ─────────────────────────────────────────────────────────────────────
        // Y Axis: Deep vertical breathing movement
        // ─────────────────────────────────────────────────────────────────────
        const floatY = Math.sin(t * breatheSpeed) * 3.0 // Primary breathe (up/down)
            + Math.cos(t * breatheSpeed * 0.6 + 0.5) * 1.5 // Secondary drift
            + Math.sin(t * breatheSpeed * 1.8) * 0.5; // Subtle bob

        // ─────────────────────────────────────────────────────────────────────
        // Z Axis: Forward/back depth breathing
        // ─────────────────────────────────────────────────────────────────────
        const floatZ = Math.sin(t * breatheSpeed * 0.8) * 4.0 // Primary push/pull
            + Math.cos(t * driftSpeed * 0.5) * 2.0; // Secondary variation

        this.camera.position.x = this.baseCameraPos.x + floatX;
        this.camera.position.y = this.baseCameraPos.y + floatY;
        this.camera.position.z = this.baseCameraPos.z + floatZ;

        // ─────────────────────────────────────────────────────────────────────
        // FOV Breathing - subtle zoom in/out for immersive effect
        // ─────────────────────────────────────────────────────────────────────
        const baseFov = 60;
        const fovBreathing = Math.sin(t * breatheSpeed * 0.7) * 2.0; // ±2 degrees
        this.camera.fov = baseFov + fovBreathing;
        this.camera.updateProjectionMatrix();

        // Smart LookAt: Target moves slightly out of phase for stabilized feel
        const targetX = Math.sin(t * driftSpeed * 0.8 + 1.0) * 2.0;
        const targetY = Math.cos(t * breatheSpeed * 0.5 + 0.5) * 1.5;

        this.camera.lookAt(targetX, targetY, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ocean Update
    // ─────────────────────────────────────────────────────────────────────────

    updateOcean(elapsed) {
        if (!this.ocean || !this.ocean.material?.uniforms) return;

        const { uniforms } = this.ocean.material;

        // Update time
        uniforms.time.value = elapsed;
        uniforms.uDayProgress.value = this.dayProgress;

        // Calculate sun/moon visibility (reuse logic from updateSunPosition)
        const sunY = this.sunPosition.y;
        const moonY = this.moonPosition.y;
        const sunVisibility = THREE.MathUtils.clamp((sunY + 30) / 40, 0, 1);
        const moonAboveHorizon = THREE.MathUtils.clamp((moonY + 35) / 50, 0, 1);
        const moonVisibility = (1 - sunVisibility) * moonAboveHorizon;

        // Pass celestial positions
        uniforms.uSunPosition.value.copy(this.sunPosition);
        uniforms.uMoonPosition.value.copy(this.moonPosition);
        uniforms.uSunIntensity.value = sunVisibility;
        uniforms.uMoonIntensity.value = moonVisibility;

        // Update colors based on day-night cycle
        const colors = this.getOceanColorsForTime(this.dayProgress);
        uniforms.uNearColor.value.copy(colors.near);
        uniforms.uFarColor.value.copy(colors.far);
        uniforms.uSunReflectColor.value.copy(colors.sunReflect);

        // Moon reflection is always silvery
        uniforms.uMoonReflectColor.value.setHex(0xd4c4ff);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effects: Shockwaves (Combo)
    // ─────────────────────────────────────────────────────────────────────────

    createShockwave(intensity, position = this.sunPosition, color = PALETTE.particles[0]) {
        const geometry = new THREE.RingGeometry(0.5, 1.0, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 1.0 },
                uColor: { value: new THREE.Color(color) },
            },
            vertexShader: shockwaveVertexShader,
            fragmentShader: shockwaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.position.copy(position);
        wave.position.z += 5;
        wave.rotation.x = Math.random() * 0.3;
        wave.rotation.y = Math.random() * 0.3;

        wave.userData = {
            speed: 15 + intensity * 5,
            life: 1.0,
            maxLife: 1.0,
        };

        this.mainGroup.add(wave);
        this.shockwaves.push(wave);
    }

    updateShockwaves(delta) {
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.userData.life -= delta;

            // Expand
            const expansion = wave.userData.speed * delta;
            wave.scale.x += expansion;
            wave.scale.y += expansion;

            // Fade
            wave.material.uniforms.uOpacity.value = wave.userData.life / wave.userData.maxLife;

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effects: Celestial Flares (Piece Lock)
    // ─────────────────────────────────────────────────────────────────────────

    createCelestialFlare(position = this.sunPosition, color = PALETTE.particles[0]) {
        const particleCount = 30;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const phases = new Float32Array(particleCount);

        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        for (let i = 0; i < particleCount; i++) {
            // Start at source position
            positions[i * 3] = position.x + (Math.random() - 0.5) * 4;
            positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 4;
            positions[i * 3 + 2] = position.z + 5;

            phases[i] = Math.random();

            const speed = 10 + Math.random() * 15;
            const spread = 0.5;
            velocities.push({
                x: dirX * speed + (Math.random() - 0.5) * spread * speed,
                y: dirY * speed + (Math.random() - 0.5) * spread * speed,
                z: (Math.random() - 0.5) * 5,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.PointsMaterial({
            color: new THREE.Color(color),
            size: 3,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const flare = new THREE.Points(geometry, material);
        flare.userData = {
            velocities,
            life: 0.8,
            maxLife: 0.8,
        };

        this.mainGroup.add(flare);
        this.celestialFlares.push(flare);
    }

    updateCelestialFlares(delta) {
        for (let i = this.celestialFlares.length - 1; i >= 0; i--) {
            const flare = this.celestialFlares[i];
            flare.userData.life -= delta;

            const positions = flare.geometry.attributes.position.array;
            const { velocities } = flare.userData;

            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * delta;
                positions[j * 3 + 1] += velocities[j].y * delta;
                positions[j * 3 + 2] += velocities[j].z * delta;
            }
            flare.geometry.attributes.position.needsUpdate = true;

            // Fade
            flare.material.opacity = flare.userData.life / flare.userData.maxLife;

            if (flare.userData.life <= 0) {
                this.mainGroup.remove(flare);
                flare.geometry.dispose();
                flare.material.dispose();
                this.celestialFlares.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            this.onLineClear(data.lineCount);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            this.onCombo(data.comboCount);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (!this.isActive) return;
            this.onPieceLock();
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        const { isSun, position, color } = this.getActiveCelestialBody();

        // Boost intensity
        if (isSun) {
            this.uniforms.sunIntensity.value += lineCount * 0.3;
        } else if (this.moon && this.moon.material.uniforms?.uOpacity) {
            // Pulse moon opacity
            this.moon.material.uniforms.uOpacity.value += 0.3;
        }

        // Create shockwave for multi-line clears
        if (lineCount >= 2) {
            this.createShockwave(lineCount, position, color);
        }
    }

    onCombo(comboCount) {
        if (comboCount >= 2) {
            const { isSun, position, color } = this.getActiveCelestialBody();

            if (isSun) {
                this.uniforms.sunIntensity.value += 0.2;
            } else if (this.moon && this.moon.material.uniforms?.uOpacity) {
                this.moon.material.uniforms.uOpacity.value += 0.2;
            }

            this.createShockwave(comboCount * 0.5, position, color);
        }
    }

    onPieceLock() {
        const { isSun, position, color } = this.getActiveCelestialBody();

        // Small pulse
        if (isSun) {
            this.uniforms.sunIntensity.value += 0.1;
        } else if (this.moon && this.moon.material.uniforms?.uOpacity) {
            this.moon.material.uniforms.uOpacity.value += 0.1;
        }

        // Celestial flare burst
        this.createCelestialFlare(position, color);
    }

    // Helper to determine whether effects should happen on Sun or Moon
    getActiveCelestialBody() {
        // Sun is dominant during day (0.2 - 0.8)
        // Moon is dominant at night
        const isSun = this.dayProgress > 0.2 && this.dayProgress < 0.8;

        if (isSun) {
            return {
                isSun: true,
                position: this.sunPosition,
                color: PALETTE.particles[0], // Gold/Orange
            };
        }
        return {
            isSun: false,
            position: this.moonPosition,
            color: 0xd4c4a8, // Moon glow color
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Quality & Resize
    // ─────────────────────────────────────────────────────────────────────────

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

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Update post-processing
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
        if (this.bloomPass) {
            this.bloomPass.setSize(window.innerWidth, window.innerHeight);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        super.stop();

        this.teardownQualityListener();
        window.removeEventListener('resize', this.boundResizeHandler);

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Unsubscribe event listeners
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Dispose shockwaves
        this.shockwaves.forEach((wave) => {
            this.mainGroup?.remove(wave);
            wave.geometry?.dispose();
            wave.material?.dispose();
        });
        this.shockwaves = [];

        // Dispose solar flares
        this.celestialFlares.forEach((flare) => {
            this.mainGroup?.remove(flare);
            flare.geometry?.dispose();
            flare.material?.dispose();
        });
        this.celestialFlares = [];

        // Dispose sun glow layers
        this.sunGlowLayers.forEach((sprite) => {
            this.mainGroup?.remove(sprite);
            sprite.material?.dispose();
        });
        this.sunGlowLayers = [];

        // Dispose moon glow layers
        this.moonGlowLayers.forEach((sprite) => {
            this.mainGroup?.remove(sprite);
            sprite.material?.dispose();
        });
        this.moonGlowLayers = [];

        // Dispose post-processing
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }
        this.bloomPass = null;

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('sunset-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose all scene objects
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

        // Null references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.sky = null;
        this.sun = null;
        this.moon = null;
        this.godRays = null;
        this.stars = null;
        this.particles = null;
        this.horizon = null;
        this.ocean = null;

        console.log('[Sunset3D] Theme stopped and cleaned up');
    }

    createStars() {
        // Use High Quality settings from Blood Moon as baseline (35k stars) or respect preset
        const count = this.activePreset.starCount >= 20000 ? this.activePreset.starCount : 35000;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinkleData = new Float32Array(count * 2); // vec2: phase, speed
        const brightness = new Float32Array(count);

        // Sunset star colors - whites, pale golds, soft blues
        // Sunset star colors - Natural stellar types
        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xfff4e8), // Warm white (G-type)
            new THREE.Color(0xffdcd4), // Pale red-orange (M-type)
            new THREE.Color(0xdceeff), // Soft blue-white (A-type)
            new THREE.Color(0xfbeeb8), // Soft yellowish (F-type)
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // Spherical distribution for depth (parallax)
            // Radius: min 2500 (beyond camera), max 14000
            const radius = 2500 + Math.random() * 11500;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1); // Full sphere (0 to PI)

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi);
            positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            // Color selection
            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Scaled sizes - larger stars for atmospheric effect
            sizes[i] = 30 + Math.random() * 60;

            // Twinkle: phase offset, varied speed (0.8 to 2.5 Hz)
            twinkleData[i2] = Math.random() * Math.PI * 2; // phase
            twinkleData[i2 + 1] = 0.8 + Math.random() * 1.7; // speed

            brightness[i] = 0.3 + Math.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uDayProgress: this.uniforms.dayProgress,
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
                uEventBoost: { value: 0 },
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            // vertexColors: true, // Disabled since we use custom aColor attribute
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.stars = new THREE.Points(geometry, material);
        this.stars.renderOrder = -50; // Ensure stars render AFTER sky but BEFORE other elements
        this.mainGroup.add(this.stars);
    }
}
