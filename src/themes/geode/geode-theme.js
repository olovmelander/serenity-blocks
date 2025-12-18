/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GEODE THEME - Three.js 3D Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * An immersive experience INSIDE a giant geode crystal cavity featuring:
 * - Faceted crystals with chromatic dispersion (rainbow refraction)
 * - Dense starfield of embedded sparkles (15K-90K particles)
 * - Crystal filaments connecting formations
 * - Warm cosmic color palette (oranges, reds, magentas)
 * - Dynamic camera with gentle drift
 * - Gameplay-reactive effects (shooting stars, nova flashes, etc.)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { GEODE_TETROMINOS } from './geode-tetrominos.js';
import {
    crystalVertexShader,
    crystalFragmentShader,
    crystalSimpleFragmentShader,
    backgroundVertexShader,
    backgroundFragmentShader,
    starVertexShader,
    starFragmentShader,
    shootingStarVertexShader,
    shootingStarFragmentShader,
    filamentVertexShader,
    filamentFragmentShader,
    novaVertexShader,
    novaFragmentShader,
    energyPulseVertexShader,
    energyPulseFragmentShader,
    ambientParticleVertexShader,
    ambientParticleFragmentShader,
    chromaticAberrationShader,
} from './geode-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Minimal: {
        starCount: 15000,
        crystalClusterCount: 12,
        crystalsPerCluster: 5,
        filamentCount: 0,
        ambientParticleCount: 30,
        maxSparkles: 30,
        maxShootingStars: 4,
        maxNovaFlashes: 2,
        maxEnergyPulses: 3,
        enableBloom: false,
        enableChromaticAberration: false,
        enableDispersion: false,
        bloomStrength: 0.3,
    },
    Low: {
        starCount: 25000,
        crystalClusterCount: 20,
        crystalsPerCluster: 7,
        filamentCount: 15,
        ambientParticleCount: 50,
        maxSparkles: 50,
        maxShootingStars: 6,
        maxNovaFlashes: 3,
        maxEnergyPulses: 5,
        enableBloom: false,
        enableChromaticAberration: false,
        enableDispersion: true,
        bloomStrength: 0.35,
    },
    Medium: {
        starCount: 40000,
        crystalClusterCount: 30,
        crystalsPerCluster: 9,
        filamentCount: 30,
        ambientParticleCount: 70,
        maxSparkles: 80,
        maxShootingStars: 10,
        maxNovaFlashes: 4,
        maxEnergyPulses: 8,
        enableBloom: true,
        enableChromaticAberration: true,
        enableDispersion: true,
        bloomStrength: 0.45,
    },
    High: {
        starCount: 55000,
        crystalClusterCount: 45,
        crystalsPerCluster: 11,
        filamentCount: 45,
        ambientParticleCount: 90,
        maxSparkles: 120,
        maxShootingStars: 15,
        maxNovaFlashes: 5,
        maxEnergyPulses: 12,
        enableBloom: true,
        enableChromaticAberration: true,
        enableDispersion: true,
        bloomStrength: 0.5,
    },
    Ultra: {
        starCount: 70000,
        crystalClusterCount: 60,
        crystalsPerCluster: 13,
        filamentCount: 60,
        ambientParticleCount: 110,
        maxSparkles: 160,
        maxShootingStars: 20,
        maxNovaFlashes: 6,
        maxEnergyPulses: 16,
        enableBloom: true,
        enableChromaticAberration: true,
        enableDispersion: true,
        bloomStrength: 0.55,
    },
    Extreme: {
        starCount: 90000,
        crystalClusterCount: 80,
        crystalsPerCluster: 15,
        filamentCount: 80,
        ambientParticleCount: 130,
        maxSparkles: 200,
        maxShootingStars: 25,
        maxNovaFlashes: 8,
        maxEnergyPulses: 20,
        enableBloom: true,
        enableChromaticAberration: true,
        enableDispersion: true,
        bloomStrength: 0.6,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palettes - Warm Cosmic Spectrum
// ─────────────────────────────────────────────────────────────────────────────
const CRYSTAL_PALETTES = [
    { main: new THREE.Color(0xff6030), glow: new THREE.Color(0xff8040) }, // Orange
    { main: new THREE.Color(0xff5040), glow: new THREE.Color(0xff3060) }, // Red
    { main: new THREE.Color(0xffd060), glow: new THREE.Color(0xffe080) }, // Yellow/Gold
    { main: new THREE.Color(0xff70ff), glow: new THREE.Color(0xe060ff) }, // Magenta
    { main: new THREE.Color(0xc060ff), glow: new THREE.Color(0xa050ff) }, // Purple
    { main: new THREE.Color(0x60ffff), glow: new THREE.Color(0x50e0ff) }, // Teal (accent)
];

const STAR_COLORS = [
    '#ff6030', '#ff8040', '#ffa050', '#ffb060', '#ffc070', // Oranges
    '#ff5040', '#ff4050', '#ff3060', '#ff2070',             // Reds
    '#ffd060', '#ffe080', '#fff0a0',                         // Yellows
    '#ff70ff', '#ff60e0', '#e060ff', '#c060ff', '#a050ff', // Magentas/Purples
    '#60ffff', '#50e0ff', '#40c0ff',                         // Teals
    '#60ff90', '#50ffa0',                                    // Greens
];

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class GeodeTheme extends BaseTheme {
    constructor() {
        super('geode');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.backgroundSphere = null;
        this.crystalClusters = [];
        this.stars = null;
        this.starPositions = null;
        this.starBrightnesses = null;
        this.starRippleBoosts = null;
        this.filaments = [];
        this.ambientParticles = null;
        this.envMap = null;

        // Effect elements
        this.shootingStars = [];
        this.novaFlashes = [];
        this.energyPulses = [];
        this.sparkles = [];
        this.starRipples = [];

        // Animation state
        this.uniforms = {
            time: { value: 0 },
            pulseIntensity: { value: 0 },
            ambientPulse: { value: 1 },
        };

        // Camera state
        this.baseCameraPos = new THREE.Vector3(0, 0, 60);
        this.cameraShake = { intensity: 0, x: 0, y: 0 };
        this.chromaticAberration = 0;

        // Combo state
        this.comboMultiplier = 1.0;
        this.pendingComboCount = 0;

        // Quality
        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
        this.qualityChangeHandler = null;

        // Post-processing
        this.bloomPass = null;
        this.chromaticPass = null;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!QUALITY_PRESETS[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality];
        console.log(`💎 Geode 3D: Applied ${quality} quality preset`);

        if (this.isActive && this.scene) {
            this.rebuildQualityDependentElements();
        }
    }

    rebuildQualityDependentElements() {
        // Rebuild stars
        if (this.stars) {
            this.mainGroup.remove(this.stars);
            this.stars.geometry.dispose();
            this.stars.material.dispose();
        }
        this.createStars();

        // Rebuild ambient particles
        if (this.ambientParticles) {
            this.mainGroup.remove(this.ambientParticles);
            this.ambientParticles.geometry.dispose();
            this.ambientParticles.material.dispose();
        }
        this.createAmbientParticles();

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
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('💎 Geode 3D: Initializing Three.js scene...');

        const container = document.getElementById('geode-theme');
        if (!container) {
            console.error('💎 Geode 3D: Container not found');
            return;
        }
        container.innerHTML = '';

        // Apply quality preset
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0408, 0.003);

        // Camera - positioned at center of geode cavity
        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.3;
        container.appendChild(this.renderer.domElement);

        // Main group for scene drift
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create environment map FIRST (needed for crystals)
        this.createEnvironmentMap();

        // Create scene elements
        this.createBackground();
        this.createCrystalClusters();
        this.createStars();
        this.createFilaments();
        this.createAmbientParticles();
        this.setupLighting();
        this.setupPostProcessing();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.clock.start();
        this.animate();

        console.log(`💎 Geode 3D: Scene initialized with ${this.crystalClusters.length} crystal clusters`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Environment Map - Custom Warm Cubemap for Reflections
    // ─────────────────────────────────────────────────────────────────────────

    createEnvironmentMap() {
        const size = 256;

        // Create a procedural cubemap texture
        const faces = [];
        for (let i = 0; i < 6; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Base gradient - warm cosmic void
            const gradient = ctx.createRadialGradient(
                size / 2, size / 2, 0,
                size / 2, size / 2, size * 0.7
            );
            gradient.addColorStop(0, '#1a0808');
            gradient.addColorStop(0.3, '#0c0406');
            gradient.addColorStop(0.6, '#080204');
            gradient.addColorStop(1, '#030102');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            // Add glowing spots (simulating other crystals)
            const spotCount = 30 + Math.floor(Math.random() * 20);
            for (let j = 0; j < spotCount; j++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const r = 3 + Math.random() * 15;
                const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];

                const spotGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                spotGrad.addColorStop(0, color);
                spotGrad.addColorStop(0.5, color + '80');
                spotGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = spotGrad;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
            }

            faces.push(canvas);
        }

        // Create cube texture from canvases
        this.envMap = new THREE.CubeTexture(faces);
        this.envMap.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Background - Cosmic Void Sphere
    // ─────────────────────────────────────────────────────────────────────────

    createBackground() {
        const geometry = new THREE.SphereGeometry(800, 64, 48);
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
    // Crystal Geometry & Clusters
    // ─────────────────────────────────────────────────────────────────────────

    createCrystalGeometry(height, radius) {
        // Hexagonal crystal with pointed ends
        const geometry = new THREE.BufferGeometry();
        const sides = 6;
        const topPoint = height * 0.85;
        const midPoint = height * 0.4;
        const bottomPoint = -height * 0.15;

        const vertices = [];

        // Create hexagonal cross-section
        const points = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            points.push({
                x: Math.cos(angle) * radius,
                z: Math.sin(angle) * radius
            });
        }

        // Top pyramid
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            vertices.push(
                0, topPoint, 0,
                points[i].x, midPoint, points[i].z,
                points[next].x, midPoint, points[next].z
            );
        }

        // Middle body
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            // Upper quad
            vertices.push(
                points[i].x, midPoint, points[i].z,
                points[i].x * 0.95, 0, points[i].z * 0.95,
                points[next].x, midPoint, points[next].z
            );
            vertices.push(
                points[next].x, midPoint, points[next].z,
                points[i].x * 0.95, 0, points[i].z * 0.95,
                points[next].x * 0.95, 0, points[next].z * 0.95
            );
        }

        // Bottom pyramid
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            vertices.push(
                points[i].x * 0.95, 0, points[i].z * 0.95,
                0, bottomPoint, 0,
                points[next].x * 0.95, 0, points[next].z * 0.95
            );
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();

        return geometry;
    }

    createCrystalCluster(position, direction) {
        const group = new THREE.Group();
        const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];
        const crystalCount = Math.floor(
            this.activePreset.crystalsPerCluster * (0.7 + Math.random() * 0.6)
        );

        for (let i = 0; i < crystalCount; i++) {
            const height = 12 + Math.random() * 35;
            const radius = 1.5 + Math.random() * 3.5;
            const geometry = this.createCrystalGeometry(height, radius);

            // Choose shader based on quality preset
            const useDispersion = this.activePreset.enableDispersion && this.envMap;

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uPulseIntensity: { value: 0 },
                    uCrystalColor: { value: palette.main.clone() },
                    uGlowColor: { value: palette.glow.clone() },
                    uEnvMap: { value: this.envMap },
                    uEnvMapIntensity: { value: useDispersion ? 0.6 : 0 },
                },
                vertexShader: crystalVertexShader,
                fragmentShader: useDispersion ? crystalFragmentShader : crystalSimpleFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: true,
            });

            const crystal = new THREE.Mesh(geometry, material);

            // Position within cluster
            const offsetAngle = (i / crystalCount) * Math.PI * 2 + Math.random() * 0.5;
            const offsetDist = Math.random() * 10;
            crystal.position.set(
                Math.cos(offsetAngle) * offsetDist,
                0,
                Math.sin(offsetAngle) * offsetDist
            );

            // Random rotation
            crystal.rotation.y = Math.random() * Math.PI * 2;
            crystal.rotation.x = (Math.random() - 0.5) * 0.3;
            crystal.rotation.z = (Math.random() - 0.5) * 0.3;

            group.add(crystal);
        }

        group.position.copy(position);

        // Orient cluster to point inward (toward camera)
        group.lookAt(0, 0, 0);
        group.rotateX(Math.PI / 2); // Crystals point inward

        group.userData = {
            palette,
            phase: Math.random() * Math.PI * 2,
        };

        this.mainGroup.add(group);
        this.crystalClusters.push(group);
    }

    createCrystalClusters() {
        const count = this.activePreset.crystalClusterCount;
        const radius = 150; // Distance from center (geode wall)

        // Distribute clusters on a sphere around camera
        for (let i = 0; i < count; i++) {
            // Use fibonacci sphere distribution for even spacing
            const phi = Math.acos(1 - 2 * (i + 0.5) / count);
            const theta = Math.PI * (1 + Math.sqrt(5)) * i;

            // Add some randomness
            const r = radius * (0.85 + Math.random() * 0.3);
            const position = new THREE.Vector3(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.cos(phi),
                r * Math.sin(phi) * Math.sin(theta)
            );

            this.createCrystalCluster(position, position.clone().negate());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Star/Sparkle Particle System
    // ─────────────────────────────────────────────────────────────────────────

    createStars() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinklePhases = new Float32Array(count);
        const twinkleSpeeds = new Float32Array(count);
        const brightnesses = new Float32Array(count);
        const rippleBoosts = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Distribute stars throughout the geode cavity
        for (let i = 0; i < count; i++) {
            // Random position within cavity (not too close to center)
            const r = 30 + Math.random() * 120;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Size - smaller stars more common
            const sizeBias = Math.pow(Math.random(), 2);
            sizes[i] = 0.3 + sizeBias * 3;

            // Twinkle
            twinklePhases[i] = Math.random() * Math.PI * 2;
            twinkleSpeeds[i] = 1.5 + Math.random() * 4.5;

            // Brightness
            brightnesses[i] = 0.2 + Math.random() * 0.8;
            rippleBoosts[i] = 0;

            // Color from palette
            const color = new THREE.Color(
                STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
            );
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinklePhase', new THREE.BufferAttribute(twinklePhases, 1));
        geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));
        geometry.setAttribute('aRippleBoost', new THREE.BufferAttribute(rippleBoosts, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        // Store references for ripple updates
        this.starPositions = positions;
        this.starBrightnesses = brightnesses;
        this.starRippleBoosts = rippleBoosts;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uPulseIntensity: this.uniforms.pulseIntensity,
                uAmbientPulse: this.uniforms.ambientPulse,
                uBrightnessThreshold: { value: 0.05 },
                uEnableGlow: { value: true },
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.stars = new THREE.Points(geometry, material);
        this.mainGroup.add(this.stars);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Crystal Filaments - Glowing Threads Between Clusters
    // ─────────────────────────────────────────────────────────────────────────

    createFilaments() {
        const count = this.activePreset.filamentCount;
        if (count === 0 || this.crystalClusters.length < 2) return;

        for (let i = 0; i < count; i++) {
            // Pick two random clusters to connect
            const idx1 = Math.floor(Math.random() * this.crystalClusters.length);
            let idx2 = Math.floor(Math.random() * this.crystalClusters.length);
            if (idx2 === idx1) idx2 = (idx2 + 1) % this.crystalClusters.length;

            const start = this.crystalClusters[idx1].position.clone();
            const end = this.crystalClusters[idx2].position.clone();

            // Create curved path between clusters
            const mid = start.clone().lerp(end, 0.5);
            // Add some curve toward center
            mid.multiplyScalar(0.7 + Math.random() * 0.2);

            const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
            const points = curve.getPoints(20);

            const geometry = new THREE.BufferGeometry().setFromPoints(points);

            // Add progress attribute
            const progress = new Float32Array(points.length);
            for (let j = 0; j < points.length; j++) {
                progress[j] = j / (points.length - 1);
            }
            geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));

            const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uPulseIntensity: this.uniforms.pulseIntensity,
                    uColor: { value: palette.glow.clone() },
                    uOpacity: { value: 0.4 + Math.random() * 0.3 },
                },
                vertexShader: filamentVertexShader,
                fragmentShader: filamentFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const line = new THREE.Line(geometry, material);
            this.mainGroup.add(line);
            this.filaments.push(line);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Floating Particles
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const count = this.activePreset.ambientParticleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Random position
            positions[i * 3] = (Math.random() - 0.5) * 200;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 200;

            sizes[i] = 1.5 + Math.random() * 4;
            phases[i] = Math.random();

            const color = new THREE.Color(
                STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
            );
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
            vertexShader: ambientParticleVertexShader,
            fragmentShader: ambientParticleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.ambientParticles);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Warm ambient
        const ambient = new THREE.AmbientLight(0x201010, 0.5);
        this.scene.add(ambient);

        // Hemisphere - warm above, cool below
        const hemi = new THREE.HemisphereLight(0xff6040, 0x4060ff, 0.4);
        this.scene.add(hemi);

        // Point lights at various crystal positions
        const lightColors = [0xff6030, 0xff70ff, 0xffd060, 0x60ffff];
        for (let i = 0; i < 4; i++) {
            const light = new THREE.PointLight(lightColors[i], 1.5, 300, 0);
            const angle = (i / 4) * Math.PI * 2;
            light.position.set(
                Math.cos(angle) * 80,
                (Math.random() - 0.5) * 60,
                Math.sin(angle) * 80
            );
            this.mainGroup.add(light);
        }

        // Central subtle light
        const centerLight = new THREE.PointLight(0xffa080, 0.8, 200, 0);
        centerLight.position.set(0, 0, 0);
        this.mainGroup.add(centerLight);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // Bloom
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.activePreset.bloomStrength,
            0.5,
            0.7
        );
        this.bloomPass.enabled = this.activePreset.enableBloom;
        this.composer.addPass(this.bloomPass);

        // Chromatic aberration
        this.chromaticPass = new ShaderPass(chromaticAberrationShader);
        this.chromaticPass.uniforms.uStrength.value = 0;
        this.chromaticPass.enabled = this.activePreset.enableChromaticAberration;
        this.composer.addPass(this.chromaticPass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handling
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const settings = typeof window !== 'undefined' ? window.settings : null;

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onPieceLock() {
        this.uniforms.pulseIntensity.value = Math.min(
            this.uniforms.pulseIntensity.value + 0.05,
            0.2
        );

        // Shooting stars - reduced
        const shootingCount = 1;
        for (let i = 0; i < shootingCount && this.shootingStars.length < this.activePreset.maxShootingStars; i++) {
            this.createShootingStar();
        }

        // Small sparkle burst - reduced
        this.createSparkleBurst(2, null, 0.5);

        // Camera shake - reduced
        this.cameraShake.intensity = Math.max(this.cameraShake.intensity, 0.3);
    }

    onLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;

        this.uniforms.pulseIntensity.value = Math.min(
            this.uniforms.pulseIntensity.value + 0.1 * lineCount,
            0.6
        );

        // Multiple sparkle bursts - reduced
        const burstCount = Math.min(lineCount + 1, 4);
        for (let i = 0; i < burstCount; i++) {
            const position = new THREE.Vector3(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80
            );
            this.createSparkleBurst(3 + lineCount, position);
        }

        // Energy pulses - reduced
        const pulseCount = Math.min(lineCount, 2);
        for (let i = 0; i < pulseCount && this.energyPulses.length < this.activePreset.maxEnergyPulses; i++) {
            this.createEnergyPulse();
        }

        // Flash crystals - reduced intensity
        const flashCount = Math.min(lineCount * 2, 6);
        for (let i = 0; i < flashCount && i < this.crystalClusters.length; i++) {
            const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    crystal.material.uniforms.uPulseIntensity.value = 0.4 + lineCount * 0.1;
                }
            });
        }

        // Camera shake
        this.cameraShake.intensity = Math.max(this.cameraShake.intensity, 0.5 + lineCount * 0.2);
    }

    onCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        this.comboMultiplier = Math.min(1 + comboCount * 0.2, 2.5);
        this.uniforms.pulseIntensity.value = Math.min(
            this.uniforms.pulseIntensity.value + 0.2 * comboCount,
            1.0
        );

        // Camera shake scales with combo - reduced
        if (comboCount >= 3) {
            this.cameraShake.intensity = Math.max(
                this.cameraShake.intensity,
                1 + (comboCount - 3) * 0.3
            );
        }

        // Chromatic aberration at high combos
        if (this.activePreset.enableChromaticAberration && comboCount >= 7) {
            this.chromaticAberration = Math.min(2 + (comboCount - 7) * 0.5, 4);
        }

        // Big sparkle burst
        if (comboCount >= 2) {
            this.createSparkleBurst(comboCount * 2, null, 1.0);
        }

        // All crystals pulse - reduced
        this.crystalClusters.forEach(cluster => {
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    crystal.material.uniforms.uPulseIntensity.value = 0.5 + comboCount * 0.15;
                }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effect Creation Methods
    // ─────────────────────────────────────────────────────────────────────────

    createShootingStar() {
        const trailLength = 15;
        const geometry = new THREE.BufferGeometry();

        // Random start position and direction
        const start = new THREE.Vector3(
            (Math.random() - 0.5) * 100,
            (Math.random() - 0.5) * 100,
            (Math.random() - 0.5) * 100
        );

        const direction = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        ).normalize();

        const speed = 8 + Math.random() * 12;
        const color = new THREE.Color(
            STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
        );

        // Create trail points
        const positions = new Float32Array(trailLength * 3);
        const progress = new Float32Array(trailLength);
        const sizes = new Float32Array(trailLength);
        const colors = new Float32Array(trailLength * 3);

        for (let i = 0; i < trailLength; i++) {
            positions[i * 3] = start.x;
            positions[i * 3 + 1] = start.y;
            positions[i * 3 + 2] = start.z;
            progress[i] = i / (trailLength - 1);
            sizes[i] = 3 + Math.random() * 2;
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uLife: { value: 1.0 },
            },
            vertexShader: shootingStarVertexShader,
            fragmentShader: shootingStarFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const points = new THREE.Points(geometry, material);
        points.userData = {
            positions: positions,
            direction: direction,
            speed: speed,
            life: 1.0,
            decay: 0.025 + Math.random() * 0.015,
            trailLength: trailLength,
        };

        this.mainGroup.add(points);
        this.shootingStars.push(points);
    }

    createNovaFlash() {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uOpacity: { value: 1.0 },
                uColor: { value: palette.glow.clone() },
                uTime: this.uniforms.time,
            },
            vertexShader: novaVertexShader,
            fragmentShader: novaFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const nova = new THREE.Mesh(geometry, material);

        // Random position
        nova.position.set(
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80
        );

        // Face camera
        nova.lookAt(this.camera.position);

        nova.userData = {
            life: 1.0,
            maxLife: 1.0,
            maxScale: 60 + Math.random() * 40,
            decay: 0.04 + Math.random() * 0.02,
        };

        this.mainGroup.add(nova);
        this.novaFlashes.push(nova);
    }

    createEnergyPulse() {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uOpacity: { value: 0.6 },
                uColor: { value: palette.glow.clone() },
                uProgress: { value: 0 },
            },
            vertexShader: energyPulseVertexShader,
            fragmentShader: energyPulseFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const pulse = new THREE.Mesh(geometry, material);

        // Random position
        pulse.position.set(
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 60
        );

        pulse.lookAt(this.camera.position);

        pulse.userData = {
            life: 1.0,
            progress: 0,
            maxScale: 80 + Math.random() * 40,
            growthRate: 0.02,
        };

        this.mainGroup.add(pulse);
        this.energyPulses.push(pulse);
    }

    createStarRipple() {
        const position = new THREE.Vector3(
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80
        );

        this.starRipples.push({
            position: position,
            radius: 0,
            speed: 6 + Math.random() * 4,
            width: 30 + Math.random() * 20,
            life: 1.0,
            decay: 0.012,
        });
    }

    createSparkleBurst(count, position, speedMultiplier = 1) {
        if (!position) {
            position = new THREE.Vector3(
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 60
            );
        }

        for (let i = 0; i < count && this.sparkles.length < this.activePreset.maxSparkles; i++) {
            const color = new THREE.Color(
                STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
            );

            // Random direction
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
            ).normalize().multiplyScalar((1 + Math.random() * 2) * speedMultiplier);

            this.sparkles.push({
                position: position.clone().add(
                    new THREE.Vector3(
                        (Math.random() - 0.5) * 10,
                        (Math.random() - 0.5) * 10,
                        (Math.random() - 0.5) * 10
                    )
                ),
                velocity: velocity,
                color: color,
                size: 1.5 + Math.random() * 2,
                life: 1.0,
                decay: 0.015 + Math.random() * 0.01,
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // Ambient pulse
        this.uniforms.ambientPulse.value = Math.sin(elapsed * 0.4) * 0.1 + 0.95;

        // Decay effects
        this.uniforms.pulseIntensity.value *= 0.97;
        if (this.uniforms.pulseIntensity.value < 0.01) {
            this.uniforms.pulseIntensity.value = 0;
        }

        this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.005);

        // Camera shake decay
        this.cameraShake.intensity *= 0.9;
        if (this.cameraShake.intensity < 0.1) {
            this.cameraShake.intensity = 0;
        }

        // Chromatic aberration decay
        this.chromaticAberration *= 0.92;
        if (this.chromaticAberration < 0.1) {
            this.chromaticAberration = 0;
        }

        // Update camera
        this.updateCamera(elapsed);

        // Update crystal pulse decay
        this.updateCrystals(delta);

        // Update effects
        this.updateShootingStars(delta);
        this.updateNovaFlashes(delta);
        this.updateEnergyPulses(delta);
        this.updateStarRipples(delta);
        this.updateSparkles(delta);

        // Update chromatic aberration
        if (this.chromaticPass) {
            this.chromaticPass.uniforms.uStrength.value = this.chromaticAberration;
            this.chromaticPass.uniforms.uTime.value = elapsed;
        }

        // Render
        if (this.composer && (this.activePreset.enableBloom || this.chromaticAberration > 0)) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateCamera(elapsed) {
        // Organic drift motion
        let camX = this.baseCameraPos.x
            + Math.sin(elapsed * 0.08) * 12
            + Math.sin(elapsed * 0.23) * 4;
        let camY = this.baseCameraPos.y
            + Math.cos(elapsed * 0.05) * 8
            + Math.sin(elapsed * 0.17) * 3;
        let camZ = this.baseCameraPos.z
            + Math.sin(elapsed * 0.11) * 10
            + Math.cos(elapsed * 0.31) * 3;

        // Apply shake
        if (this.cameraShake.intensity > 0) {
            camX += (Math.random() - 0.5) * this.cameraShake.intensity * 2;
            camY += (Math.random() - 0.5) * this.cameraShake.intensity * 1.5;
            camZ += (Math.random() - 0.5) * this.cameraShake.intensity;
        }

        this.camera.position.set(camX, camY, camZ);

        // Subtle look target drift
        const lookX = Math.sin(elapsed * 0.06) * 8;
        const lookY = Math.cos(elapsed * 0.04) * 4;
        this.camera.lookAt(lookX, lookY, 0);
    }

    updateCrystals(delta) {
        this.crystalClusters.forEach(cluster => {
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    if (crystal.material.uniforms.uPulseIntensity.value > 0) {
                        crystal.material.uniforms.uPulseIntensity.value *= 0.96;
                    }
                }
            });
        });
    }

    updateShootingStars(delta) {
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            const data = star.userData;

            data.life -= data.decay;

            // Move trail points
            const positions = data.positions;
            const trailLength = data.trailLength;

            // Shift trail positions backward
            for (let j = trailLength - 1; j > 0; j--) {
                positions[j * 3] = positions[(j - 1) * 3];
                positions[j * 3 + 1] = positions[(j - 1) * 3 + 1];
                positions[j * 3 + 2] = positions[(j - 1) * 3 + 2];
            }

            // Move head
            positions[0] += data.direction.x * data.speed;
            positions[1] += data.direction.y * data.speed;
            positions[2] += data.direction.z * data.speed;

            star.geometry.attributes.position.needsUpdate = true;
            star.material.uniforms.uLife.value = data.life;

            // Slight deceleration
            data.speed *= 0.98;

            // Remove if dead or out of bounds
            if (data.life <= 0 || Math.abs(positions[0]) > 200) {
                this.mainGroup.remove(star);
                star.geometry.dispose();
                star.material.dispose();
                this.shootingStars.splice(i, 1);
            }
        }
    }

    updateNovaFlashes(delta) {
        for (let i = this.novaFlashes.length - 1; i >= 0; i--) {
            const nova = this.novaFlashes[i];
            const data = nova.userData;

            data.life -= data.decay;

            // Expand
            const progress = 1 - (data.life / data.maxLife);
            const scale = progress * data.maxScale;
            nova.scale.set(scale, scale, 1);

            nova.material.uniforms.uOpacity.value = data.life;

            // Face camera
            nova.lookAt(this.camera.position);

            if (data.life <= 0) {
                this.mainGroup.remove(nova);
                nova.geometry.dispose();
                nova.material.dispose();
                this.novaFlashes.splice(i, 1);
            }
        }
    }

    updateEnergyPulses(delta) {
        for (let i = this.energyPulses.length - 1; i >= 0; i--) {
            const pulse = this.energyPulses[i];
            const data = pulse.userData;

            data.progress += data.growthRate;
            data.life -= 0.02;

            const scale = data.progress * data.maxScale;
            pulse.scale.set(scale, scale, 1);

            pulse.material.uniforms.uProgress.value = Math.min(data.progress, 1);
            pulse.material.uniforms.uOpacity.value = data.life * 0.6;

            pulse.lookAt(this.camera.position);

            if (data.life <= 0 || data.progress > 1) {
                this.mainGroup.remove(pulse);
                pulse.geometry.dispose();
                pulse.material.dispose();
                this.energyPulses.splice(i, 1);
            }
        }
    }

    updateStarRipples(delta) {
        if (!this.stars || !this.starRippleBoosts) return;

        const rippleBoosts = this.starRippleBoosts;
        const starCount = rippleBoosts.length;

        // Decay existing boosts
        for (let i = 0; i < starCount; i++) {
            if (rippleBoosts[i] > 0) {
                rippleBoosts[i] *= 0.92;
                if (rippleBoosts[i] < 0.01) rippleBoosts[i] = 0;
            }
        }

        // Process ripples
        for (let i = this.starRipples.length - 1; i >= 0; i--) {
            const ripple = this.starRipples[i];

            ripple.radius += ripple.speed;
            ripple.life -= ripple.decay;

            if (ripple.life <= 0 || ripple.radius > 300) {
                this.starRipples.splice(i, 1);
                continue;
            }

            // Boost nearby stars
            const innerRadius = ripple.radius - ripple.width * 0.5;
            const outerRadius = ripple.radius + ripple.width * 0.5;
            const positions = this.starPositions;

            for (let j = 0; j < starCount; j++) {
                const dx = positions[j * 3] - ripple.position.x;
                const dy = positions[j * 3 + 1] - ripple.position.y;
                const dz = positions[j * 3 + 2] - ripple.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist >= innerRadius && dist <= outerRadius) {
                    const distFromCenter = Math.abs(dist - ripple.radius);
                    const intensity = 1 - (distFromCenter / (ripple.width * 0.5));
                    const boost = intensity * ripple.life * 1.5;

                    if (boost > rippleBoosts[j]) {
                        rippleBoosts[j] = boost;
                    }
                }
            }
        }

        // Update star geometry attribute
        this.stars.geometry.attributes.aRippleBoost.array.set(rippleBoosts);
        this.stars.geometry.attributes.aRippleBoost.needsUpdate = true;
    }

    updateSparkles(delta) {
        // Sparkles are rendered as part of star system, just update data
        // For simplicity, we'll manage sparkle lifecycle but they share star rendering
        for (let i = this.sparkles.length - 1; i >= 0; i--) {
            const sparkle = this.sparkles[i];

            sparkle.life -= sparkle.decay;
            sparkle.velocity.multiplyScalar(0.98);
            sparkle.velocity.y -= 0.03; // Light gravity
            sparkle.position.add(sparkle.velocity);

            if (sparkle.life <= 0) {
                this.sparkles.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize Handler
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
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        this.teardownQualityListener();
        window.removeEventListener('resize', this.onWindowResize.bind(this));

        // Clean up effects
        this.shootingStars.forEach(star => {
            this.mainGroup?.remove(star);
            star.geometry?.dispose();
            star.material?.dispose();
        });
        this.shootingStars = [];

        this.novaFlashes.forEach(nova => {
            this.mainGroup?.remove(nova);
            nova.geometry?.dispose();
            nova.material?.dispose();
        });
        this.novaFlashes = [];

        this.energyPulses.forEach(pulse => {
            this.mainGroup?.remove(pulse);
            pulse.geometry?.dispose();
            pulse.material?.dispose();
        });
        this.energyPulses = [];

        this.starRipples = [];
        this.sparkles = [];

        // Clean up filaments
        this.filaments.forEach(line => {
            this.mainGroup?.remove(line);
            line.geometry?.dispose();
            line.material?.dispose();
        });
        this.filaments = [];

        // Clean up crystal clusters
        this.crystalClusters.forEach(cluster => {
            cluster.children.forEach(crystal => {
                crystal.geometry?.dispose();
                crystal.material?.dispose();
            });
            this.mainGroup?.remove(cluster);
        });
        this.crystalClusters = [];

        // Clean up composer
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        // Clean up renderer
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('geode-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose scene objects
        if (this.scene) {
            this.scene.traverse(object => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.stars = null;
        this.ambientParticles = null;
        this.backgroundSphere = null;
        this.envMap = null;

        // Reset state
        this.uniforms.pulseIntensity.value = 0;
        this.comboMultiplier = 1.0;
        this.pendingComboCount = 0;
        this.cameraShake = { intensity: 0, x: 0, y: 0 };
        this.chromaticAberration = 0;

        super.stop();
    }

    getTetrominoConfig() {
        return GEODE_TETROMINOS;
    }
}
