/**
 * Neon Dusk Theme - Three.js Masterpiece Edition
 *
 * A stunning 3D synthwave experience featuring:
 * - Gradient sky with twinkling neon stars
 * - Procedural FBM mountains with signature neon rim lighting
 * - Multi-layer glowing sun with drift animation
 * - Perspective synthwave grid with tetromino highlights
 * - Dynamic particle effects and hologram rings
 * - Post-processing bloom and VHS effects
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { NEON_DUSK_TETROMINOS } from './neon-dusk-tetrominos.js';

import {
    skyVertexShader,
    skyFragmentShader,
    starVertexShader,
    starFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    sunGlowVertexShader,
    sunGlowFragmentShader,
    mountainVertexShader,
    mountainFragmentShader,
    gridVertexShader,
    gridFragmentShader,
    highlightVertexShader,
    highlightFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    ringVertexShader,
    ringFragmentShader,
    VHSShader,
    VignetteShader
} from './neon-dusk-shaders.js';

// ============================================================================
// QUALITY PRESETS
// ============================================================================

const QUALITY_PRESETS = {
    Minimal: {
        starCount: 800,
        mountainSegments: 32,
        glowLayers: 2,
        maxBurstParticles: 100,
        maxGridHighlights: 20,
        maxRings: 3,
        enableBloom: false,
        enableVHS: false,
        bloomStrength: 0,
        gridScrollSpeed: 4.0,
    },
    Low: {
        starCount: 1200,
        mountainSegments: 64,
        glowLayers: 3,
        maxBurstParticles: 200,
        maxGridHighlights: 40,
        maxRings: 5,
        enableBloom: false,
        enableVHS: true,
        bloomStrength: 0,
        gridScrollSpeed: 4.5,
        pixelCount: 100, // Added for retro pixels
    },
    Medium: {
        starCount: 1800,
        mountainSegments: 128,
        glowLayers: 4,
        maxBurstParticles: 400,
        maxGridHighlights: 60,
        maxRings: 8,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.15,
        bloomThreshold: 0.6,
        bloomRadius: 0.3,
        gridScrollSpeed: 5.0,
        pixelCount: 200, // Added for retro pixels
    },
    High: {
        starCount: 2500,
        mountainSegments: 192,
        glowLayers: 5,
        maxBurstParticles: 600,
        maxGridHighlights: 80,
        maxRings: 10,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.2,
        bloomThreshold: 0.55,
        bloomRadius: 0.35,
        gridScrollSpeed: 5.0,
        pixelCount: 300, // Added for retro pixels
    },
    Ultra: {
        starCount: 3500,
        mountainSegments: 256,
        glowLayers: 6,
        maxBurstParticles: 800,
        maxGridHighlights: 100,
        maxRings: 12,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.25,
        bloomThreshold: 0.5,
        bloomRadius: 0.4,
        gridScrollSpeed: 5.0,
        pixelCount: 400, // Added for retro pixels
    },
    Extreme: {
        starCount: 5000,
        mountainSegments: 512,
        glowLayers: 8,
        maxBurstParticles: 1000,
        maxGridHighlights: 150,
        maxRings: 15,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.3,
        bloomThreshold: 0.45,
        bloomRadius: 0.45,
        gridScrollSpeed: 5.0,
        pixelCount: 500, // Added for retro pixels
    },
};

// ============================================================================
// MAIN THEME CLASS
// ============================================================================

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();

        // Scene elements
        this.skyGradient = null;
        this.starfield = null;
        this.sun = null;
        this.sunGlow = null;
        this.mountains = [];
        this.grid = null;
        this.gridHighlights = [];
        this.highlightPool = [];
        this.retroPixels = null; // New: Retro pixels

        // Particle systems (minimal - only burst for effects)
        this.burstParticles = null;
        this.burstParticleData = [];
        this.hologramRings = [];

        // Post-processing
        this.bloomPass = null;
        this.vhsPass = null;
        this.vignettePass = null;

        // Animation state
        this.time = 0;
        this.timeOffset = Math.random() * 10000;
        this.sunPosition = { x: 0, y: 0 };

        // Effect state
        this.effectState = {
            gridPulseIntensity: 0,
            sunPulseIntensity: 0,
            mountainPulseIntensity: 0,
            mountainShockwave: 0,
            rimGlowIntensity: 1.0,
            highlightTwinkle: 0,
            colorShift: 0,
            vhsIntensity: 0,
            pixelTwinkle: 0, // NEW: Pixel twinkle intensity
        };

        // Event handlers
        this.eventUnsubscribers = [];
        this.resizeHandler = null;

        // Quality
        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;

        // Colors - classic synthwave sunset palette (like reference images)
        this.colors = {
            skyTop: new THREE.Color(0x1a0033),      // Deep dark purple
            skyMid: new THREE.Color(0x660066),      // Magenta/purple
            skyBottom: new THREE.Color(0xff6699),   // Pink/magenta at horizon (NOT orange)
            sunTop: new THREE.Color(0xffee88),      // Bright yellow (sun top)
            sunMid: new THREE.Color(0xffaa44),      // Orange (sun middle)
            sunBottom: new THREE.Color(0xff6699),   // Pink (sun bottom)
            gridColor: new THREE.Color(0xff00ff),   // Magenta grid
            gridGlow: new THREE.Color(0x00ffff),    // Cyan glow
            mountainDark: new THREE.Color(0x0a0515), // Very dark purple for silhouettes
            mountainRim: new THREE.Color(0x6633aa),  // Subtle purple edge
        };

        // Neon palette for highlights/effects
        this.neonColors = [
            new THREE.Color(0xff00ff),  // Magenta
            new THREE.Color(0x00ffff),  // Cyan
            new THREE.Color(0xff0088),  // Hot pink
            new THREE.Color(0xffff00),  // Yellow
            new THREE.Color(0xff4400),  // Orange
        ];

        // Tetromino shapes for grid highlights
        this.tetrominoShapes = {
            'I': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
            'J': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            'L': [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            'O': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            'S': [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            'T': [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            'Z': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
        };

        console.log('[NeonDusk] Theme constructed');
    }

    getTetrominoConfig() {
        return NEON_DUSK_TETROMINOS;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        console.log(`[NeonDusk] Applied ${quality} quality preset`);
    }

    // =========================================================================
    // SCENE CREATION
    // =========================================================================

    async createScene() {
        console.log('[NeonDusk] Creating Three.js scene...');

        const container = document.getElementById('neon-dusk-theme');
        if (!container) {
            console.error('[NeonDusk] Container not found');
            return;
        }

        container.innerHTML = '';

        // Apply quality
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        // Initialize renderer
        this.initRenderer(container);

        // Create scene elements
        this.createSkyGradient();
        this.createStarfield();
        this.createSun();
        this.createMountains();
        this.createGrid();
        this.createHighlightPool();
        this.createBurstParticleSystem();
        this.createRetroPixels(); // New: Create retro pixels

        // Setup post-processing
        this.setupPostProcessing();

        // Setup events
        this.setupEventListeners();
        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);

        // Start animation
        this.animate();

        console.log(`[NeonDusk] Scene created with ${quality} quality`);
    }

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x08000f, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;

        this.renderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x08000f);

        // Create perspective camera - positioned to see horizon
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
        this.camera.position.set(0, 25, 50);
        this.camera.lookAt(0, 10, -100);

        console.log('[NeonDusk] Renderer initialized');
    }

    // =========================================================================
    // SKY GRADIENT
    // =========================================================================

    createSkyGradient() {
        const geometry = new THREE.PlaneGeometry(3000, 1600);

        // Use vertex colors for gradient
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        const positions = geometry.attributes.position.array;

        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const y = positions[i * 3 + 1];
            const t = (y + 800) / 1600;

            let color;
            if (t < 0.4) {
                color = this.colors.skyBottom.clone().lerp(this.colors.skyMid, t / 0.4);
            } else {
                color = this.colors.skyMid.clone().lerp(this.colors.skyTop, (t - 0.4) / 0.6);
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.skyGradient = new THREE.Mesh(geometry, material);
        this.skyGradient.position.z = -900;
        this.skyGradient.position.y = 50;
        this.skyGradient.renderOrder = -5000;
        this.scene.add(this.skyGradient);
    }

    // =========================================================================
    // STARFIELD
    // =========================================================================

    createStarfield() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinkleData = new Float32Array(count * 2);
        const brightness = new Float32Array(count);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0x00ffff),
            new THREE.Color(0xff00ff),
            new THREE.Color(0xff88ff),
            new THREE.Color(0x88ffff),
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            // Distribute in layers - further back
            const layerRand = Math.random();
            let radius;
            if (layerRand < 0.33) {
                radius = 500 + Math.random() * 150;
            } else if (layerRand < 0.66) {
                radius = 700 + Math.random() * 200;
            } else {
                radius = 950 + Math.random() * 250;
            }

            // Only upper hemisphere (above horizon)
            if (phi > Math.PI * 0.5) {
                positions[i3] = 0;
                positions[i3 + 1] = -10000;
                positions[i3 + 2] = 0;
                continue;
            }

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi) * 0.4 + 30;
            positions[i3 + 2] = -Math.abs(radius * Math.sin(phi) * Math.sin(theta)) - 200;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 8 + Math.random() * 17;  // LARGER stars (8-25 pixels)
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 0.5 + Math.random() * 2.0;
            brightness[i] = 0.4 + Math.random() * 0.6;  // Much brighter stars
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
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.renderOrder = -4000;
        this.scene.add(this.starfield);
    }

    // =========================================================================
    // NEBULA CLOUDS
    // =========================================================================

    createNebulaClouds() {
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/wolfhour/';

        // Reuse wolfhour textures with neon tinting
        const textures = [
            textureLoader.load(texturePath + 'nebula-silver-1.png'),
            textureLoader.load(texturePath + 'nebula-silver-2.png'),
            textureLoader.load(texturePath + 'nebula-silver-3.png'),
        ];

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        const nebulaConfigs = [
            { texture: textures[0], x: 0, y: 60, z: -750, size: 700, speed: 2, opacity: 0.06 },
            { texture: textures[1], x: -80, y: 70, z: -800, size: 800, speed: 1.5, opacity: 0.05 },
            { texture: textures[2], x: 80, y: 80, z: -850, size: 850, speed: 1, opacity: 0.04 },
        ];

        const count = Math.min(this.activePreset.nebulaCount, nebulaConfigs.length);

        for (let i = 0; i < count; i++) {
            const config = nebulaConfigs[i];
            const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.6);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: config.texture },
                    uOpacity: { value: config.opacity },
                    uPulse: { value: 0 },
                    uTime: { value: 0 },
                },
                vertexShader: nebulaVertexShader,
                fragmentShader: nebulaFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(config.x, config.y, config.z);
            mesh.renderOrder = -3500 - i;

            mesh.userData.speed = config.speed;
            mesh.userData.startX = config.x;
            mesh.userData.wrapBoundary = config.size;

            this.nebulaClouds.push(mesh);
            this.scene.add(mesh);
        }
    }

    // =========================================================================
    // MASSIVE BANDED SUN (Classic Synthwave)
    // =========================================================================

    createSun() {
        // Very large sun sphere - positioned FAR BACK behind mountains
        const sunGeometry = new THREE.SphereGeometry(300, 64, 64);  // MASSIVE sun
        const sunMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColorTop: { value: this.colors.sunTop },
                uColorMid: { value: this.colors.sunMid },
                uColorBottom: { value: this.colors.sunBottom },
                uPulseIntensity: { value: 0 },
                uStripeCount: { value: 8.0 },
            },
            vertexShader: sunVertexShader,
            fragmentShader: sunFragmentShader,
            transparent: true,
            side: THREE.FrontSide,
            depthWrite: false,
        });

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        // Position sun FAR behind mountains (mountains are at z=-250 to -550)
        this.sun.position.set(0, 50, -900);
        this.sun.renderOrder = -2000;  // Render before mountains
        this.scene.add(this.sun);

        // Large atmospheric glow behind sun
        const glowGeometry = new THREE.PlaneGeometry(1200, 1200);  // MASSIVE glow
        const glowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uGlowColor: { value: new THREE.Color(0xff6688) },
                uOpacity: { value: 0.4 },
                uPulseIntensity: { value: 0 },
            },
            vertexShader: sunGlowVertexShader,
            fragmentShader: sunGlowFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        this.sunGlow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.sunGlow.position.copy(this.sun.position);
        this.sunGlow.position.z -= 10;
        this.sunGlow.renderOrder = -2100;  // Render before sun
        this.scene.add(this.sunGlow);
    }

    // =========================================================================
    // SILHOUETTE MOUNTAINS (Valley Formation)
    // =========================================================================

    createMountains() {
        // Configure mountains to form a valley - left and right sides
        // Mountains extend far to the edges to fill screen when camera moves
        const mountainConfigs = [
            // LEFT SIDE - FOREGROUND (closest, largest, fill edge)
            { x: -250, z: -150, size: 400, height: 100, layer: 0.0, seed: 11111 },
            { x: -350, z: -200, size: 500, height: 120, layer: 0.05, seed: 11112 },
            { x: -180, z: -280, size: 350, height: 90, layer: 0.1, seed: 22222 },

            // LEFT SIDE - MIDGROUND
            { x: -280, z: -380, size: 450, height: 110, layer: 0.25, seed: 33333 },
            { x: -200, z: -480, size: 400, height: 100, layer: 0.4, seed: 33334 },

            // LEFT SIDE - BACKGROUND (further, hazier)
            { x: -150, z: -600, size: 500, height: 130, layer: 0.6, seed: 44444 },
            { x: -250, z: -700, size: 550, height: 140, layer: 0.75, seed: 44445 },

            // RIGHT SIDE - FOREGROUND (closest, largest, fill edge)
            { x: 250, z: -150, size: 400, height: 100, layer: 0.0, seed: 55555 },
            { x: 350, z: -200, size: 500, height: 120, layer: 0.05, seed: 55556 },
            { x: 180, z: -280, size: 350, height: 90, layer: 0.1, seed: 66666 },

            // RIGHT SIDE - MIDGROUND
            { x: 280, z: -380, size: 450, height: 110, layer: 0.25, seed: 77777 },
            { x: 200, z: -480, size: 400, height: 100, layer: 0.4, seed: 77778 },

            // RIGHT SIDE - BACKGROUND (further, hazier)
            { x: 150, z: -600, size: 500, height: 130, layer: 0.6, seed: 88888 },
            { x: 250, z: -700, size: 550, height: 140, layer: 0.75, seed: 88889 },

            // CENTER PEAKS near horizon (small distant mountains)
            { x: -60, z: -750, size: 300, height: 80, layer: 0.85, seed: 99999 },
            { x: 60, z: -750, size: 300, height: 80, layer: 0.85, seed: 99998 },
            { x: 0, z: -800, size: 350, height: 90, layer: 0.9, seed: 99997 },
        ];

        mountainConfigs.forEach((config) => {
            const mountain = this.createSilhouetteMountain(config);
            this.mountains.push(mountain);
            this.scene.add(mountain);
        });
    }

    createSilhouetteMountain(config) {
        const segments = Math.min(this.activePreset.mountainSegments, 128);
        const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        // CPU-side procedural mountain shape
        const posAttribute = geometry.attributes.position;
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
            for (let i = 0; i < 4; i++) {
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

            // Create jagged mountain shape
            const dist = Math.sqrt(x * x + z * z);
            const maxDist = config.size * 0.45;

            if (dist > maxDist) {
                posAttribute.setY(i, -500);
                continue;
            }

            const normDist = dist / maxDist;
            const base = Math.pow(1.0 - normDist, 1.2) * config.height;
            const jagged = fbm(x * 0.02, z * 0.02) * config.height * 0.5 * (1.0 - normDist);

            posAttribute.setY(i, base + jagged);
        }

        geometry.computeVertexNormals();

        // Simple dark silhouette material - NO rim lighting
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uBaseColor: { value: this.colors.mountainDark },
                uMountainLayer: { value: config.layer },
                uTime: { value: 0 },
            },
            vertexShader: mountainVertexShader,
            fragmentShader: mountainFragmentShader,
            transparent: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(config.x, -30, config.z);
        mesh.renderOrder = -500 + Math.round(config.layer * 100);
        return mesh;
    }

    // =========================================================================
    // SYNTHWAVE GRID
    // =========================================================================

    createGrid() {
        const geometry = new THREE.PlaneGeometry(400, 300, 100, 75);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSpeed: { value: this.activePreset.gridScrollSpeed },
                uGridColor: { value: this.colors.gridColor },
                uGlowIntensity: { value: 1.0 },
                uPulseIntensity: { value: 0 },
                uColorShift: { value: this.colors.gridGlow },
            },
            vertexShader: gridVertexShader,
            fragmentShader: gridFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        this.grid = new THREE.Mesh(geometry, material);
        this.grid.position.y = 0;
        this.grid.position.z = -50;
        this.grid.renderOrder = -200;
        this.scene.add(this.grid);
    }

    // =========================================================================
    // GRID HIGHLIGHT POOL
    // =========================================================================

    createHighlightPool() {
        const poolSize = this.activePreset.maxGridHighlights;

        for (let i = 0; i < poolSize; i++) {
            const geometry = new THREE.PlaneGeometry(3.05, 3.05); // 3.05 size for overlapped solid look
            geometry.rotateX(-Math.PI / 2);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0x00ffff) },
                    uIntensity: { value: 0 },
                    uTime: { value: 0 },
                    uTwinkle: { value: 0 },
                },
                vertexShader: highlightVertexShader,
                fragmentShader: highlightFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.userData = {
                active: false,
                life: 0,
                maxLife: 15.0,
                intensity: 0,
                gridZ: 0,
                scrollOffset: 0,
            };

            mesh.renderOrder = 10;
            this.scene.add(mesh);
            this.highlightPool.push(mesh);
        }
    }

    // =========================================================================
    // AMBIENT PARTICLES
    // =========================================================================

    createAmbientParticles() {
        const count = this.activePreset.ambientParticles;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const types = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            positions[i3] = (Math.random() - 0.5) * 200;
            positions[i3 + 1] = Math.random() * 100 + 10;
            positions[i3 + 2] = (Math.random() - 0.5) * 150 - 30;

            const color = this.neonColors[Math.floor(Math.random() * this.neonColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 8 + Math.random() * 15;
            lives[i] = 1.0;
            types[i] = 0; // Circle type

            this.ambientParticleData.push({
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.2,
                vz: (Math.random() - 0.5) * 0.3,
                baseSize: sizes[i],
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uTwinkle: { value: 0 }, // Added uTwinkle uniform
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.ambientParticles.renderOrder = 200;
        this.scene.add(this.ambientParticles);
    }

    // =========================================================================
    // BURST PARTICLE SYSTEM
    // =========================================================================

    createBurstParticleSystem() {
        const count = this.activePreset.maxBurstParticles;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const types = new Float32Array(count);

        // Initialize all particles as inactive (off-screen)
        for (let i = 0; i < count; i++) {
            positions[i * 3 + 1] = -10000;
            lives[i] = 0;
            this.burstParticleData.push({
                active: false,
                x: 0, y: 0, z: 0,
                vx: 0, vy: 0, vz: 0,
                life: 0, maxLife: 1,
                size: 1, type: 0,
                color: new THREE.Color(0xffffff),
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uTwinkle: { value: 0 }, // Added uTwinkle uniform
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
        });

        this.burstParticles = new THREE.Points(geometry, material);
        this.burstParticles.renderOrder = 300;
        this.scene.add(this.burstParticles);
    }



    // =========================================================================
    // POST-PROCESSING
    // =========================================================================

    setupPostProcessing() {
        if (!this.activePreset.enableBloom && !this.activePreset.enableVHS) {
            return;
        }

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        if (this.activePreset.enableBloom) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                this.activePreset.bloomStrength,
                this.activePreset.bloomRadius || 0.3,
                this.activePreset.bloomThreshold || 0.6
            );
            this.composer.addPass(this.bloomPass);
        }

        if (this.activePreset.enableVHS) {
            this.vhsPass = new ShaderPass(VHSShader);
            this.vhsPass.uniforms.uResolution.value = new THREE.Vector2(
                window.innerWidth,
                window.innerHeight
            );
            this.vhsPass.uniforms.uIntensity.value = 0.6;
            this.composer.addPass(this.vhsPass);
        }

        // Vignette pass
        this.vignettePass = new ShaderPass(VignetteShader);
        this.vignettePass.uniforms.uDarkness.value = 0.5;
        this.vignettePass.uniforms.uOffset.value = 1.2;
        this.composer.addPass(this.vignettePass);
    }

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================

    setupEventListeners() {
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock(data);
            }
        });

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

        this.eventUnsubscribers.push(pieceLockUnsub, lineClearUnsub, comboUnsub);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    handlePieceLock(data) {
        const piece = data?.piece;
        const currentTime = this.clock.getElapsedTime();
        const scrollSpeed = this.activePreset.gridScrollSpeed;
        const scrollOffset = (currentTime * scrollSpeed) / 3.0; // Convert distance to cells (spacing 3.0)

        // Spawn grid highlights for tetromino shape
        if (piece) {
            const pieceType = piece.type;
            const shape = this.tetrominoShapes[pieceType] || this.tetrominoShapes['T'];
            const color = this.getPieceColor(pieceType);

            let gridX = piece.x !== undefined ? (piece.x - 4.5) : (Math.random() - 0.5) * 10;
            // Spread pieces across the fuller grid (multiply by 4) while keeping shape contiguous
            const spreadFactor = 4.0;
            gridX = Math.round(gridX * spreadFactor);

            const gridZ = Math.floor(scrollOffset + 5 + Math.random() * 10);
            const rotation = piece.rotation || 0;

            // Trigger pixel twinkle
            this.effectState.pixelTwinkle = 1.0;

            for (const block of shape) {
                let rx = block.x;
                let ry = block.y;

                for (let r = 0; r < rotation; r++) {
                    const temp = rx;
                    rx = -ry;
                    ry = temp;
                }

                this.spawnHighlightCell(gridX + rx * 1.5, gridZ + ry, color, scrollOffset);
            }
        }

        // Create rising squares burst
        this.createRisingSquares((Math.random() - 0.5) * 100);

        // Effect state updates
        this.effectState.gridPulseIntensity = Math.min(1, this.effectState.gridPulseIntensity + 0.25);
        this.effectState.mountainShockwave = 0.5;

        if (this.starfield) {
            this.starfield.material.uniforms.uEventBoost.value = 0.3;
        }
    }

    handleLineClear(data) {
        const lineCount = data?.lineCount || 1;

        this.effectState.gridPulseIntensity = Math.min(1, this.effectState.gridPulseIntensity + 0.3 * lineCount);
        this.effectState.mountainPulseIntensity = Math.min(1, lineCount * 0.25);

        // Spawn hologram rings from sun
        if (lineCount >= 2) {
            this.createHologramRing();
        }
        if (lineCount >= 3) {
            this.effectState.sunPulseIntensity = Math.min(1, this.effectState.sunPulseIntensity + 0.4);
            this.createHologramRing();
        }
        if (lineCount >= 4) {
            this.effectState.sunPulseIntensity = 1.0;
            this.createHologramRing();
            this.createHologramRing();
        }
    }

    handleCombo(data) {
        const comboCount = data?.comboCount || 0;

        this.effectState.rimGlowIntensity = Math.min(2.0, 1.0 + comboCount * 0.15);
        this.effectState.highlightTwinkle = Math.min(1.5, comboCount * 0.2);
        this.effectState.colorShift = Math.min(1, comboCount * 0.12);

        if (comboCount >= 2) {
            this.effectState.sunPulseIntensity = Math.min(1, this.effectState.sunPulseIntensity + 0.2);
        }

        if (this.starfield) {
            this.starfield.material.uniforms.uEventBoost.value = Math.min(0.5, comboCount * 0.08);
        }

        // Trigger VHS glitch on combos
        this.effectState.vhsIntensity = Math.min(1.5, this.effectState.vhsIntensity + 0.5 + comboCount * 0.1);
    }

    // =========================================================================
    // EFFECT HELPERS
    // =========================================================================

    getPieceColor(pieceType) {
        const colorMap = {
            'I': new THREE.Color(0x00ffff),
            'O': new THREE.Color(0xffff00),
            'T': new THREE.Color(0xff00ff),
            'S': new THREE.Color(0x00ff88),
            'Z': new THREE.Color(0xff0088),
            'J': new THREE.Color(0x00aaff),
            'L': new THREE.Color(0xff8800),
        };
        return colorMap[pieceType] || this.neonColors[0];
    }

    spawnHighlightCell(gridX, gridZ, color, scrollOffset) {
        const highlight = this.highlightPool.find(h => !h.userData.active);
        if (!highlight) return;

        highlight.userData.active = true;
        highlight.userData.life = 1.0;
        highlight.userData.maxLife = 15.0 + Math.random() * 10.0;
        highlight.userData.intensity = 2.0 + Math.random() * 0.5;
        highlight.userData.gridZ = gridZ;
        highlight.userData.scrollOffset = scrollOffset;


        highlight.position.x = gridX * 3.0 + 1.5;
        highlight.position.y = 0.02; // Very close to grid to minimize parallax
        highlight.position.z = -(gridZ - scrollOffset) * 3.0 + this.grid.position.z + 0.5;

        highlight.material.uniforms.uColor.value.copy(color);
        highlight.material.uniforms.uIntensity.value = highlight.userData.intensity;

        highlight.visible = true;
        this.gridHighlights.push(highlight);
    }

    createRisingSquares(x) {
        const count = 8;
        const positions = this.burstParticles.geometry.attributes.position.array;
        const colors = this.burstParticles.geometry.attributes.color.array;
        const sizes = this.burstParticles.geometry.attributes.aSize.array;
        const lives = this.burstParticles.geometry.attributes.aLife.array;
        const types = this.burstParticles.geometry.attributes.aType.array;

        for (let i = 0; i < count; i++) {
            const idx = this.burstParticleData.findIndex(p => !p.active);
            if (idx === -1) break;

            const p = this.burstParticleData[idx];
            const color = this.neonColors[Math.floor(Math.random() * this.neonColors.length)];

            p.active = true;
            p.x = x + (Math.random() - 0.5) * 30;
            p.y = -10;
            p.z = (Math.random() - 0.5) * 20 - 30;
            p.vx = (Math.random() - 0.5) * 1;
            p.vy = 15 + Math.random() * 10;
            p.vz = (Math.random() - 0.5) * 1;
            p.life = 1.0;
            p.maxLife = 2.0 + Math.random() * 1.0;
            p.size = 15 + Math.random() * 10;
            p.type = 2; // Square
            p.color = color;

            const i3 = idx * 3;
            positions[i3] = p.x;
            positions[i3 + 1] = p.y;
            positions[i3 + 2] = p.z;
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
            sizes[idx] = p.size;
            lives[idx] = p.life;
            types[idx] = p.type;
        }

        this.burstParticles.geometry.attributes.position.needsUpdate = true;
        this.burstParticles.geometry.attributes.color.needsUpdate = true;
        this.burstParticles.geometry.attributes.aSize.needsUpdate = true;
        this.burstParticles.geometry.attributes.aLife.needsUpdate = true;
        this.burstParticles.geometry.attributes.aType.needsUpdate = true;
    }

    createHologramRing() {
        if (this.hologramRings.length >= this.activePreset.maxRings) return;

        const geometry = new THREE.PlaneGeometry(1200, 1200);  // Much BIGGER rings
        const color = this.neonColors[Math.floor(Math.random() * this.neonColors.length)];

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: color },
                uLife: { value: 1.0 },
                uRadius: { value: 0.05 },
                uMaxRadius: { value: 1.0 },
            },
            vertexShader: ringVertexShader,
            fragmentShader: ringFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const ring = new THREE.Mesh(geometry, material);
        ring.position.copy(this.sun.position);
        ring.position.z += 10;
        ring.renderOrder = 100;

        ring.userData = {
            startTime: this.time,
            duration: 1.5 + Math.random() * 0.5,
            maxRadius: 1.0,
        };

        this.hologramRings.push(ring);
        this.scene.add(ring);
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    animate() {
        if (!this.isActive) return;

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);

        const delta = this.clock.getDelta();
        this.time += delta;

        this.updateCamera();
        this.updateSun(delta);
        this.updateMountains(delta);
        this.updateGrid(delta);
        this.updateHighlights(delta);
        this.updateRetroPixels(delta); // Update pixels
        this.updateBurstParticles(delta);
        this.updateHologramRings(delta);
        this.updateStars();
        this.decayEffects(delta);

        if (this.composer) {
            if (this.vhsPass) {
                this.vhsPass.uniforms.uTime.value = this.time;
                this.vhsPass.uniforms.uIntensity.value = this.effectState.vhsIntensity; // Update intensity
            }
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateCamera() {
        // Gentle sway animation
        const t = this.time * 0.03;
        this.camera.position.x = Math.sin(t) * 4;
        this.camera.position.y = 25 + Math.cos(t * 0.7) * 2;
        this.camera.position.z = 50 + Math.sin(t * 0.5) * 3;

        this.camera.lookAt(
            Math.sin(t * 0.4) * 3,
            10 + Math.cos(t * 0.3),
            -100
        );
    }

    updateSun(delta) {
        // Sun stays centered - no drift for clean look
        this.sun.material.uniforms.uTime.value = this.time;
        this.sun.material.uniforms.uPulseIntensity.value = this.effectState.sunPulseIntensity;

        // Update single glow layer
        if (this.sunGlow) {
            this.sunGlow.material.uniforms.uPulseIntensity.value = this.effectState.sunPulseIntensity;
            const scale = 1 + Math.sin(this.time * 0.3) * 0.03 + this.effectState.sunPulseIntensity * 0.1;
            this.sunGlow.scale.setScalar(scale);
        }

        this.sunPosition = { x: this.sun.position.x, y: this.sun.position.y };
    }

    updateMountains(delta) {
        this.mountains.forEach((mountain) => {
            mountain.material.uniforms.uTime.value = this.time;
        });
    }

    updateGrid(delta) {
        this.grid.material.uniforms.uTime.value = this.time;
        this.grid.material.uniforms.uPulseIntensity.value = this.effectState.gridPulseIntensity;
    }

    updateHighlights(delta) {
        const scrollSpeed = this.activePreset.gridScrollSpeed;
        const currentScroll = (this.time * scrollSpeed) / 3.0; // Cells

        for (let i = this.gridHighlights.length - 1; i >= 0; i--) {
            const highlight = this.gridHighlights[i];
            const data = highlight.userData;

            // Update position with grid scroll
            const relativeZ = data.gridZ - currentScroll;
            highlight.position.z = -relativeZ * 3.0 + this.grid.position.z + 0.5;

            // Distance fade
            const distanceFade = Math.max(0.3, 1.0 - Math.max(0, -relativeZ - 30) / 50);

            // Twinkle effect
            let twinkle = 1.0;
            if (this.effectState.highlightTwinkle > 0) {
                const phase = (data.gridZ * 0.5 + data.intensity * 2.0) % 6.28;
                twinkle = 1.0 + Math.sin(this.time * 15.0 + phase) * this.effectState.highlightTwinkle * 0.4;
            }

            highlight.material.uniforms.uIntensity.value = data.intensity * distanceFade * twinkle;
            highlight.material.uniforms.uTime.value = this.time;
            highlight.material.uniforms.uTwinkle.value = this.effectState.highlightTwinkle;

            // Remove when past horizon
            if (relativeZ < -60) {
                highlight.visible = false;
                data.active = false;
                this.gridHighlights.splice(i, 1);
            }
        }
    }

    // =========================================================================
    // RETRO PIXELS (Floating Squares)
    // =========================================================================

    createRetroPixels() {
        const count = this.activePreset.pixelCount || 150;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3); // Missing color attribute!
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const types = new Float32Array(count); // All type 2 (square)

        const palette = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0xff00ff), // Magenta
            new THREE.Color(0xffff00), // Yellow
            new THREE.Color(0xffffff), // White
        ];

        this.retroPixelData = [];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread across the world
            // Spread across the world - closer to camera
            const x = (Math.random() - 0.5) * 500;
            const y = Math.random() * 100 + 10;
            // Z from 50 (camera) to -600 (horizon)
            const z = 50 - Math.random() * 650;

            positions[i3] = x;
            positions[i3 + 1] = y;
            positions[i3 + 2] = z;

            const col = palette[Math.floor(Math.random() * palette.length)];
            colors[i3] = col.r;
            colors[i3 + 1] = col.g;
            colors[i3 + 2] = col.b;

            sizes[i] = 0.5 + Math.random() * 1.5; // Tiny specks (0.5-2 base size)
            lives[i] = Math.random();
            types[i] = 2.0; // Square type

            this.retroPixelData.push({
                vx: (Math.random() - 0.5) * 5, // Subtle drift x
                vy: 5 + Math.random() * 10,    // Float UP
                vz: (Math.random() - 0.5) * 5, // Subtle drift z
                maxLife: 1.0,
                colorType: Math.floor(Math.random() * 5)
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uColor: { value: new THREE.Color(0xffffff) },
                uTwinkle: { value: 0 }, // NEW
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true, // Required for vColor attribute
        });

        this.retroPixels = new THREE.Points(geometry, material);
        this.retroPixels.renderOrder = 0; // Render properly in scene
        this.scene.add(this.retroPixels);
    }

    updateRetroPixels(delta) {
        if (!this.retroPixels) return;

        const positions = this.retroPixels.geometry.attributes.position.array;
        const lives = this.retroPixels.geometry.attributes.aLife.array;

        for (let i = 0; i < this.retroPixelData.length; i++) {
            const p = this.retroPixelData[i];
            const i3 = i * 3;

            // Move up
            positions[i3] += p.vx * delta;
            positions[i3 + 1] += p.vy * delta;
            positions[i3 + 2] += p.vz * delta;

            // Wrap around
            if (positions[i3 + 1] > 150) {
                positions[i3 + 1] = 0;
                positions[i3] = (Math.random() - 0.5) * 500;
                positions[i3 + 2] = 50 - Math.random() * 650; // Random Z including close
            }

            // Pulse life
            lives[i] = 0.5 + 0.5 * Math.sin(this.time * 2 + i * 10);
        }

        this.retroPixels.geometry.attributes.position.needsUpdate = true;
        this.retroPixels.geometry.attributes.aLife.needsUpdate = true;
        this.retroPixels.material.uniforms.uTime.value = this.time;
        this.retroPixels.material.uniforms.uTwinkle.value = this.effectState.pixelTwinkle; // Update uniform
    }

    updateBurstParticles(delta) {
        if (!this.burstParticles) return;

        const positions = this.burstParticles.geometry.attributes.position.array;
        const lives = this.burstParticles.geometry.attributes.aLife.array;

        for (let i = 0; i < this.burstParticleData.length; i++) {
            const p = this.burstParticleData[i];
            if (!p.active) continue;

            // Physics
            p.x += p.vx * delta;
            p.y += p.vy * delta;
            p.z += p.vz * delta;

            // Rising squares: no gravity, just slow down
            if (p.type === 2) {
                p.vy *= 0.98;
            } else {
                p.vy -= 20 * delta;
            }

            p.life -= delta / p.maxLife;

            if (p.life <= 0) {
                p.active = false;
                p.life = 0;
            }

            const i3 = i * 3;
            positions[i3] = p.x;
            positions[i3 + 1] = p.y;
            positions[i3 + 2] = p.z;
            lives[i] = Math.max(0, p.life);
        }

        this.burstParticles.geometry.attributes.position.needsUpdate = true;
        this.burstParticles.geometry.attributes.aLife.needsUpdate = true;
    }

    updateHologramRings(delta) {
        for (let i = this.hologramRings.length - 1; i >= 0; i--) {
            const ring = this.hologramRings[i];
            const data = ring.userData;
            const elapsed = this.time - data.startTime;
            const progress = elapsed / data.duration;

            if (progress >= 1.0) {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
                this.hologramRings.splice(i, 1);
                continue;
            }

            ring.material.uniforms.uLife.value = 1.0 - progress;
            ring.material.uniforms.uRadius.value = progress;

            // Expand and follow sun
            ring.position.x = this.sunPosition.x;
            const scale = 1 + progress * 6;  // Expand much further (6x instead of 2x)
            ring.scale.setScalar(scale);
        }
    }

    updateNebulas(delta) {
        this.nebulaClouds.forEach((nebula) => {
            nebula.position.x += nebula.userData.speed * delta;
            if (nebula.position.x > nebula.userData.wrapBoundary) {
                nebula.position.x = -nebula.userData.wrapBoundary;
            }
            nebula.material.uniforms.uPulse.value = this.effectState.gridPulseIntensity * 0.5;
            nebula.material.uniforms.uTime.value = this.time;
        });
    }

    updateStars() {
        if (this.starfield) {
            this.starfield.material.uniforms.uTime.value = this.time;
        }
    }

    decayEffects(delta) {
        const decay = Math.pow(0.92, delta * 60);

        this.effectState.gridPulseIntensity *= decay;
        this.effectState.sunPulseIntensity *= decay;
        this.effectState.mountainPulseIntensity *= decay;
        this.effectState.mountainShockwave *= decay;
        this.effectState.highlightTwinkle *= decay;
        this.effectState.colorShift *= decay;
        this.effectState.vhsIntensity *= Math.pow(0.85, delta * 60);
        this.effectState.pixelTwinkle *= Math.pow(0.95, delta * 60); // Slower decay for visible flash

        // Rim glow decays back to 1.0
        this.effectState.rimGlowIntensity = 1.0 + (this.effectState.rimGlowIntensity - 1.0) * decay;

        // Star boost decay
        if (this.starfield) {
            this.starfield.material.uniforms.uEventBoost.value *= decay;
        }

        // Clamp small values
        if (this.effectState.gridPulseIntensity < 0.01) this.effectState.gridPulseIntensity = 0;
        if (this.effectState.sunPulseIntensity < 0.01) this.effectState.sunPulseIntensity = 0;
        if (this.effectState.mountainPulseIntensity < 0.01) this.effectState.mountainPulseIntensity = 0;
        if (this.effectState.mountainShockwave < 0.01) this.effectState.mountainShockwave = 0;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    onResize() {
        if (!this.camera || !this.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }

        if (this.vhsPass) {
            this.vhsPass.uniforms.uResolution.value.set(width, height);
        }
    }

    stop() {
        // Unsubscribe events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Remove resize handler
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Clear highlights
        this.gridHighlights = [];
        this.hologramRings.forEach(ring => {
            this.scene.remove(ring);
            ring.geometry.dispose();
            ring.material.dispose();
        });
        this.hologramRings = [];

        // Dispose Three.js resources
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('neon-dusk-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.scene) {
            this.scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        super.stop();
        console.log('[NeonDusk] Theme stopped');
    }
}
