/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ STELLAR DRIFT ✧
 *  A 3D Space Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Directly inspired by Andromeda's architecture:
 * - Camera at z=1450, y=100
 * - Central planet (size 500) with glow planes
 * - Front meteor field (500 meteors, z=500-1400)
 * - Scrolling background planes at z=-520
 * - Post-processing with vignette
 *
 * All code and shaders are original.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { STELLAR_DRIFT_TETROMINOS } from './stellar-drift-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets (matching Andromeda scale)
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        planetDetail: 64,
        meteorCount: 500,
        bloomStrength: 0.25,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    Ultra: {
        planetDetail: 48,
        meteorCount: 400,
        bloomStrength: 0.22,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    High: {
        planetDetail: 32,
        meteorCount: 300,
        bloomStrength: 0.2,
        bloomRadius: 0.4,
        enablePostProcessing: true,
    },
    Medium: {
        planetDetail: 24,
        meteorCount: 200,
        bloomStrength: 0.25,
        bloomRadius: 0.4,
        enablePostProcessing: true,
    },
    Low: {
        planetDetail: 16,
        meteorCount: 100,
        bloomStrength: 0.2,
        bloomRadius: 0.3,
        enablePostProcessing: false,
    },
    Minimal: {
        planetDetail: 12,
        meteorCount: 50,
        bloomStrength: 0.15,
        bloomRadius: 0.3,
        enablePostProcessing: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 },
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
            float vig = smoothstep(offset, offset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class StellarDriftTheme extends BaseTheme {
    constructor() {
        super('stellar-drift');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.planet = null;
        this.smallGlow = null;
        this.bigGlow = null;
        this.backgroundPlanes = [];
        this.meteors = [];
        this.nebulaClouds = [];
        this.ambientParticles = null;

        // Effect arrays for 3D gameplay effects
        this.shockwaveRings = [];
        this.shootingStars = [];
        this.starTwinkleIntensity = 0;
        this.dustRingPulse = 0;        // Smooth dust ring expansion
        this.bloomPulseIntensity = 0;  // Smooth bloom boost
        this.nebulaBoostIntensity = 0; // Smooth nebula brightness
        this.glowSurgeIntensity = 0;   // Smooth planet glow surge
        this.meteorActivity = 0;       // Dynamic meteor spin speed based on APM
        this.nebulaPulse = 0;          // Pulse intensity for nebulas
        this.cameraSway = new THREE.Vector3(0, 0, 0); // Gentle camera motion

        // Nebula Particle Bursts
        this.nebulaBursts = [];
        this.nebulaColors = [
            new THREE.Color(0x00FF88), // Emerald
            new THREE.Color(0xFFAA00), // Gold/Orange
            new THREE.Color(0x6633FF), // Deep Purple
            new THREE.Color(0xFF3366), // Red/Magenta
            new THREE.Color(0x00FFFF), // Cyan/Teal
            new THREE.Color(0x3344FF), // Indigo
            new THREE.Color(0xFF0044), // Crimson
            new THREE.Color(0xFFCC00), // Amber
            new THREE.Color(0xCCCCFF), // Silver/Ghost
        ];
        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.planetPhaseOffset = Math.random() * Math.PI * 2; // Random starting position for planet

        // State
        this.glowIntensity = 0.5;
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[StellarDrift] Theme constructed');
    }

    getTetrominoConfig() {
        return STELLAR_DRIFT_TETROMINOS;
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
        console.log('[StellarDrift] Creating Andromeda-style scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('stellar-drift-theme');
        if (!container) {
            console.error('[StellarDrift] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createStarfield();      // 3D point stars
        // this.createNebulaClouds();   // REMOVED: Replaced by volumetric backdrop
        // this.createOrbitingParticles(); // REMOVED: User request
        this.createNebulaBackdrop();   // NEW: High-def majestic nebula
        this.createPlanet();
        this.createDustRing();        // Dust ring around planet
        this.createAmbientParticles(); // Floating ambient sparkles
        this.createMeteorField();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[StellarDrift] Scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera (Matching Andromeda exactly)
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // ANDROMEDA CAMERA: z=1450, y=100, looking at origin
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000000);
        this.camera.position.set(0, 100, 1450);
        this.camera.lookAt(0, 0, 0);

        // Spotlight for meteors (reduced intensity)
        const meteorLight = new THREE.SpotLight(0xffffff, 2, 3000);
        meteorLight.position.set(0, 300, 200);
        meteorLight.target.position.set(0, 0, 0);
        this.scene.add(meteorLight);
        this.scene.add(meteorLight.target);

        // Ambient light (dimmer)
        const ambientLight = new THREE.AmbientLight(0x404060, 0.35);
        this.scene.add(ambientLight);

        // Directional light (reduced for less glare)
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(0, 100, 500);
        this.scene.add(dirLight);

        console.log('[StellarDrift] Camera at z=1450, y=100 with improved lighting');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Thousands of 3D point stars
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xfff8f0),
            new THREE.Color(0xf0f0ff),
            new THREE.Color(0xfff0f0),
            new THREE.Color(0xc8e0ff),
            new THREE.Color(0xfffff0),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 3000 + Math.random() * 3000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = (radius * Math.cos(phi)) - 6000;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Larger, more visible stars
            sizes[i] = 35 + Math.random() * 50;
            // Gentle twinkle - cycles every 8-20 seconds
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 1.5 + Math.random() * 2.5; // Balanced speed
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));

        // GPU shader - constant size, only brightness twinkles
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uEventBoost: { value: 0 },
                uTexture: { value: this.getStarTexture() },
            },
            vertexShader: `
                attribute float aSize;
                attribute vec2 aTwinkle;

                uniform float uTime;
                uniform float uPixelRatio;
                uniform float uEventBoost;

                varying vec3 vColor;
                varying float vBrightness;

                void main() {
                    vColor = color;

                    // Gentle brightness twinkle (no size change)
                    float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
                    vBrightness = 0.8 + twinkle * 0.2; // Subtle range: 0.6 to 1.0
                    vBrightness *= (1.0 + uEventBoost * 0.3);

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                    // CONSTANT size - no twinkle affecting size
                    gl_PointSize = aSize * uPixelRatio * (400.0 / -mvPosition.z);
                    gl_PointSize = clamp(gl_PointSize, 3.0, 60.0);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;

                varying vec3 vColor;
                varying float vBrightness;

                void main() {
                    vec4 texColor = texture2D(uTexture, gl_PointCoord);

                    // Smooth circular falloff
                    vec2 center = gl_PointCoord - 0.5;
                    float dist = length(center) * 2.0;
                    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);

                    vec3 finalColor = vColor * vBrightness * 1.8;
                    float alpha = texColor.a * softCircle * (vBrightness + 0.3);

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[StellarDrift] Starfield created with', starCount, 'smooth stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Colorful space clouds
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const cloudCount = 30; // More clouds for richer atmosphere

        for (let i = 0; i < cloudCount; i++) {
            const size = 2000 + Math.random() * 2500; // Larger clouds

            // Create soft radial gradient texture
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // VIBRANT Galaxy colors
            const colorType = Math.random();
            let hue, sat, light;
            if (colorType < 0.3) { // Electric Teal/Cyan
                hue = 180 + Math.random() * 30;
                sat = 90;
                light = 45;
            } else if (colorType < 0.6) { // Hot Pink/Magenta
                hue = 320 + Math.random() * 40;
                sat = 95;
                light = 50;
            } else if (colorType < 0.85) { // Deep Purple/Violet
                hue = 270 + Math.random() * 30;
                sat = 85;
                light = 40;
            } else { // Golden/Orange hints
                hue = 30 + Math.random() * 20;
                sat = 80;
                light = 45;
            }

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, 0.2)`);
            gradient.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.1)`);
            gradient.addColorStop(0.7, `hsla(${hue}, ${sat}%, ${light}%, 0.03)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(size, size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const cloud = new THREE.Mesh(geometry, material);

            // Spread across the whole sky
            cloud.position.x = (Math.random() - 0.5) * 5000;
            cloud.position.y = (Math.random() - 0.5) * 2500;
            cloud.position.z = -800 - Math.random() * 1500; // Layered depth

            cloud.rotation.z = Math.random() * Math.PI;

            this.nebulaClouds.push(cloud); // Store for animation
            this.scene.add(cloud);
        }

        // Add EDGE nebulas - specifically positioned at screen corners/edges
        const edgePositions = [
            { x: -2200, y: 800 },   // Top-left
            { x: 2200, y: 800 },    // Top-right
            { x: -2200, y: -600 },  // Bottom-left
            { x: 2200, y: -600 },   // Bottom-right
            { x: -2500, y: 0 },     // Left center
            { x: 2500, y: 0 },      // Right center
        ];

        edgePositions.forEach((pos) => {
            const size = 2500 + Math.random() * 1500;
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Random vibrant color for edge nebulas
            const hue = Math.random() > 0.5 ? 320 + Math.random() * 40 : 180 + Math.random() * 40;
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, 85%, 45%, 0.3)`);  // Brighter for edges
            gradient.addColorStop(0.5, `hsla(${hue}, 80%, 40%, 0.15)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(size, size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const cloud = new THREE.Mesh(geometry, material);
            cloud.position.x = pos.x + (Math.random() - 0.5) * 400;
            cloud.position.y = pos.y + (Math.random() - 0.5) * 300;
            cloud.position.z = -600 - Math.random() * 800;
            cloud.rotation.z = Math.random() * Math.PI;
            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        });

        console.log('[StellarDrift] Vibrant Nebula clouds created with edge lights');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orbiting Particles (Supernova Style)
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Orbiting Particles (REMOVED)
    // ─────────────────────────────────────────────────────────────────────────

    // createOrbitingParticles() { ... }

    // ─────────────────────────────────────────────────────────────────────────
    // Background (Two scrolling planes at z=-520, like Andromeda)
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Drifting Nebula Clouds - Separate planes that scroll left-to-right
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaBackdrop() {
        const textureLoader = new THREE.TextureLoader();

        // Load 9 distinct nebula textures (Starless)
        // Attach exact colors to each texture so they stay linked after shuffle
        const texturePath = './textures/stellar-drift/';
        const textures = [
            textureLoader.load(texturePath + 'stellar_drift_nebula.png'),     // 1: Emerald/Violet
            textureLoader.load(texturePath + 'stellar_drift_nebula_2.png'),   // 2: Gold/Orange
            textureLoader.load(texturePath + 'stellar_drift_nebula_3.png'),   // 3: Blue/Purple
            textureLoader.load(texturePath + 'stellar_drift_nebula_4.png'),   // 4: Red/Magenta
            textureLoader.load(texturePath + 'stellar_drift_nebula_5.png'),   // 5: Cyan/Teal
            textureLoader.load(texturePath + 'stellar_drift_nebula_6.png'),   // 6: Deep Indigo
            textureLoader.load(texturePath + 'stellar_drift_nebula_7.png'),   // 7: Crimson/Black
            textureLoader.load(texturePath + 'stellar_drift_nebula_8.png'),   // 8: Amber/Gold
            textureLoader.load(texturePath + 'stellar_drift_nebula_9.png'),   // 9: Silver/Ghost
        ];

        // Assign colors to textures
        // These MUST match the visual look of the texture files
        textures[0].userData = { color: new THREE.Color(0x00FF88) }; // Emerald
        textures[1].userData = { color: new THREE.Color(0xFFAA00) }; // Gold
        textures[2].userData = { color: new THREE.Color(0x6633FF) }; // Purple
        textures[3].userData = { color: new THREE.Color(0xFF3366) }; // Red
        textures[4].userData = { color: new THREE.Color(0x00FFFF) }; // Cyan
        textures[5].userData = { color: new THREE.Color(0x3344FF) }; // Indigo
        textures[6].userData = { color: new THREE.Color(0xFF0044) }; // Crimson
        textures[7].userData = { color: new THREE.Color(0xFFCC00) }; // Amber
        textures[8].userData = { color: new THREE.Color(0xCCCCFF) }; // Silver

        textures.forEach(t => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Randomize order so it's different every time
        for (let i = textures.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [textures[i], textures[j]] = [textures[j], textures[i]];
        }

        // Configuration for 9 nebula clouds - "Smart Loop" System
        // Total Cycle Width: 450,000 units
        // Spacing: 50,000 units (Ensures max 2-3 visible at once in 100k view)
        // Range: -200,000 to +200,000

        const nebulaConfigs = [
            // Center Group (Visible Now)
            { texture: textures[0], x: 0, y: 8000, z: -35000, size: 75000, speed: 0.4, vRange: 2000 },  // Center
            { texture: textures[1], x: 50000, y: -10000, z: -32000, size: 72000, speed: 0.6, vRange: 1500 },  // Right 1
            { texture: textures[2], x: 100000, y: 0, z: -40000, size: 80000, speed: 0.3, vRange: 1000 },  // Right 2
            { texture: textures[8], x: -50000, y: -5000, z: -36000, size: 70000, speed: 0.35, vRange: 2200 }, // Left 1 (Silver)

            // Outer Wings (Incoming/Outgoing)
            { texture: textures[3], x: 150000, y: 5000, z: -38000, size: 78000, speed: 0.5, vRange: 1800 },  // Right 3
            { texture: textures[4], x: 200000, y: -8000, z: -39000, size: 76000, speed: 0.55, vRange: 1600 }, // Right 4 (Edge)

            { texture: textures[5], x: -100000, y: 8000, z: -35000, size: 74000, speed: 0.45, vRange: 2000 }, // Left 2
            { texture: textures[6], x: -150000, y: 2000, z: -34000, size: 77000, speed: 0.3, vRange: 2500 },  // Left 3
            { texture: textures[7], x: -200000, y: -2000, z: -37000, size: 75000, speed: 0.4, vRange: 1900 },  // Left 4 (Deep Edge)
        ];

        // Store nebula meshes for animation
        this.nebulaMeshes = [];

        nebulaConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.6);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: config.texture },
                    uTime: { value: 0 },
                    uOpacity: { value: 0.4 },
                    uPulse: { value: 0.0 }, // Pulse intensity (0.0 to 1.0)
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
                    uniform float uTime;
                    uniform float uOpacity;
                    uniform float uPulse;
                    
                    varying vec2 vUv;
                    
                    void main() {
                        vec2 uv = vUv;
                        
                        // Sample the texture
                        vec4 texColor = texture2D(tDiffuse, uv);
                        
                        // Heavy edge fade - 40% fade zone on all sides
                        float fadeX = smoothstep(0.0, 0.4, uv.x) * smoothstep(1.0, 0.6, uv.x);
                        float fadeY = smoothstep(0.0, 0.4, uv.y) * smoothstep(1.0, 0.6, uv.y);
                        float fade = fadeX * fadeY;
                        
                        // Apply fade to alpha
                        // Pulse boosts alpha slightly
                        float pulseAlpha = uPulse * 0.2; 
                        float alpha = texColor.a * (uOpacity + pulseAlpha) * fade;
                        
                        // Pulse boosts brightness significantly
                        vec3 color = texColor.rgb;
                        color += color * uPulse * 1.5; // Bright flash
                        
                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(config.x, config.y, config.z);
            mesh.renderOrder = -2000 - index;

            mesh.userData.speed = config.speed;
            mesh.userData.startX = config.x;
            mesh.userData.startY = config.y; // Base Y position
            mesh.userData.verticalRange = config.vRange; // How much it bobs up/down
            mesh.userData.driftPhase = Math.random() * Math.PI * 2; // Random starting phase

            // Store color from texture (for particle bursts)
            if (config.texture.userData && config.texture.userData.color) {
                mesh.userData.color = config.texture.userData.color;
            } else {
                mesh.userData.color = new THREE.Color(0xFFFFFF); // Fallback
            }

            // "Smart Loop" Setup
            // Wrap boundary: 225,000 (Half of 450k width)
            // When x > 225,000, we subtract 450,000 to move it to -225,000
            mesh.userData.wrapBoundary = 225000;
            mesh.userData.totalWidth = 450000;

            this.nebulaMeshes.push(mesh);
            this.scene.add(mesh);
        });

        console.log('[StellarDrift] 3 Drifting Nebula Clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Planet - Pink/Salmon Gas Giant with Flowing Bands
    // ─────────────────────────────────────────────────────────────────────────



    getRoundParticleTexture() {
        if (this._roundParticleTexture) return this._roundParticleTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);

        this._roundParticleTexture = new THREE.CanvasTexture(canvas);
        return this._roundParticleTexture;
    }

    getStarTexture() {
        if (this._starTexture) return this._starTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const center = 64;

        // Clear canvas
        ctx.clearRect(0, 0, 128, 128);

        // Outer soft glow halo - smooth circular falloff
        const outerGlow = ctx.createRadialGradient(center, center, 0, center, center, 64);
        outerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
        outerGlow.addColorStop(0.15, 'rgba(255, 255, 255, 0.15)');
        outerGlow.addColorStop(0.35, 'rgba(255, 255, 255, 0.06)');
        outerGlow.addColorStop(0.6, 'rgba(255, 255, 255, 0.02)');
        outerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = outerGlow;
        ctx.fillRect(0, 0, 128, 128);

        // Bright core - circular with soft edges
        const coreGlow = ctx.createRadialGradient(center, center, 0, center, center, 20);
        coreGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
        coreGlow.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)');
        coreGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
        coreGlow.addColorStop(0.8, 'rgba(255, 255, 255, 0.1)');
        coreGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = coreGlow;
        ctx.fillRect(0, 0, 128, 128);

        this._starTexture = new THREE.CanvasTexture(canvas);
        return this._starTexture;
    }

    createNebulaBurst(nebulaMesh, particleCount = 30) {
        // Get nebula's current world position and scale
        const pos = nebulaMesh.position.clone();
        const scale = nebulaMesh.geometry.parameters?.width || 50000; // Nebula size

        // Use color directly from mesh (synced to texture)
        const color = nebulaMesh.userData.color || new THREE.Color(0xFFFFFF);

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            // Spawn across the FULL nebula area
            const spreadX = (Math.random() - 0.5) * scale * 0.8;
            const spreadY = (Math.random() - 0.5) * scale * 0.5;

            positions[i * 3] = pos.x + spreadX;
            positions[i * 3 + 1] = pos.y + spreadY;
            positions[i * 3 + 2] = pos.z + 3000 + Math.random() * 2000; // In front of nebula

            // Velocity: Shoot toward camera with dramatic spread
            const speed = 80 + Math.random() * 80; // FAST shooting particles
            velocities.push({
                x: (Math.random() - 0.5) * 35, // More lateral spread
                y: (Math.random() - 0.5) * 35,
                z: speed // Toward camera
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: color,
            map: this.getRoundParticleTexture(), // USE ROUND TEXTURE
            size: 200 + Math.random() * 150, // Balanced size for visibility
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            velocities: velocities,
            life: 8.0, // EVEN LONGER LIFE (was 5.0)
            maxLife: 8.0
        };

        this.scene.add(burst);
        this.nebulaBursts.push(burst);
    }

    burstAllVisibleNebulas(particlesPerNebula) {
        // Burst from ALL nebulas
        this.nebulaMeshes.forEach((nebula) => {
            // No need to look up color array anymore - it's on the mesh
            this.createNebulaBurst(nebula, particlesPerNebula);
        });
    }
    createPlanet() {
        const planetSize = 500;

        // Planet sphere with pink/salmon flowing bands shader
        const geometry = new THREE.SphereGeometry(planetSize, this.qualityPreset.planetDetail, this.qualityPreset.planetDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec3 vLocalPos; // Local position for rotation-visible texture
                
                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vLocalPos = position; // Pass local position (stays fixed to mesh)
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec3 vLocalPos; // Local position for rotation-visible texture
                
                // Noise functions using 3D position (no UV seam)
                float hash(float n) { return fract(sin(n) * 43758.5453); }
                float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
                
                float noise3D(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    
                    float n = i.x + i.y * 57.0 + i.z * 113.0;
                    return mix(
                        mix(mix(hash(n), hash(n + 1.0), f.x),
                            mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
                        mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                            mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y),
                        f.z
                    );
                }
                
                float fbm3D(vec3 p) {
                    float v = 0.0;
                    float a = 0.5;
                    for (int i = 0; i < 4; i++) {
                        v += a * noise3D(p);
                        p *= 2.0;
                        a *= 0.5;
                    }
                    return v;
                }
                
                // Color Shift Function
                vec3 hueShift(vec3 color, float shift) {
                    vec3 k = vec3(0.57735);
                    float cosAngle = cos(shift);
                    return vec3(color * cosAngle + cross(k, color) * sin(shift) + k * dot(k, color) * (1.0 - cosAngle));
                }
                
                void main() {
                    // Use LOCAL position for seamless noise that ROTATES with mesh
                    vec3 pos = normalize(vLocalPos) * 5.0;
                    float y = vUv.y;
                    
                    // Flowing horizontal bands (seamless using Y)
                    float flow = uTime * 0.02;
                    float bandNoise = fbm3D(pos * vec3(2.0, 4.0, 2.0) + vec3(flow * 0.3, 0.0, 0.0));
                    float bands = sin(y * 25.0 + bandNoise * 2.5) * 0.5 + 0.5;
                    
                    // Secondary detail
                    float detail = fbm3D(pos * vec3(4.0, 8.0, 4.0) - vec3(flow * 0.5, 0.0, 0.0)) * 0.3;
                    bands = bands + detail;
                    
                    // STORM SPOTS - visible features for rotation
                    float storm1 = smoothstep(0.85, 0.5, length(pos.xz - vec2(2.5, 1.0)));
                    float storm2 = smoothstep(0.6, 0.3, length(pos.xz - vec2(-1.5, 2.0)));
                    float storm3 = smoothstep(0.5, 0.2, length(pos.xz - vec2(0.5, -2.5)));
                    float storms = storm1 * 0.4 + storm2 * 0.3 + storm3 * 0.25;
                    
                    // ─────────────────────────────────────────────────────────────
                    // DYNAMIC COLOR PALETTE
                    // Start: Mars-like (Red, Rust, Orange)
                    // Evolution: Very slow hue shift
                    // ─────────────────────────────────────────────────────────────
                    
                    float timeShift = uTime * 0.05; // Very slow color evolution
                    
                    // Base Mars Palette
                    vec3 baseDeep    = vec3(0.3, 0.05, 0.05); // Dark Red
                    vec3 baseMid     = vec3(0.8, 0.2, 0.1);   // Rust
                    vec3 baseBright  = vec3(1.0, 0.5, 0.2);   // Orange
                    vec3 baseHighlight = vec3(1.0, 0.8, 0.6); // Pale Yellow
                    
                    // Apply Shift
                    vec3 deepColor   = hueShift(baseDeep, timeShift);
                    vec3 midColor    = hueShift(baseMid, timeShift);
                    vec3 brightColor = hueShift(baseBright, timeShift);
                    vec3 highlight   = hueShift(baseHighlight, timeShift);
                    
                    // Mix colors based on bands
                    vec3 bandColor;
                    if (bands < 0.3) {
                        bandColor = mix(deepColor, midColor, bands * 3.3);
                    } else if (bands < 0.6) {
                        bandColor = mix(midColor, brightColor, (bands - 0.3) * 3.3);
                    } else {
                        bandColor = mix(brightColor, highlight, (bands - 0.6) * 2.5);
                    }
                    
                    // Apply storm spots - darker areas that are visible during rotation
                    vec3 stormColor = deepColor * 0.6; // Dark storm centers
                    bandColor = mix(bandColor, stormColor, storms);
                    
                    // REALISTIC LIGHTING tuned for Nebula
                    // Light direction from upper-right
                    vec3 lightDir = normalize(vec3(0.7, 0.3, 0.6));
                    vec3 viewDir = normalize(vViewPosition);
                    
                    // Main directional shadow (like the reference photo)
                    float NdotL = dot(vNormal, lightDir);
                    float shadow = smoothstep(-0.1, 0.3, NdotL); // Soft terminator line
                    
                    // Apply deep shadow to unlit side
                    vec3 shadowColor = bandColor * 0.1; // Very dark shadow
                    vec3 litColor = bandColor;
                    vec3 finalColor = mix(shadowColor, litColor, shadow);
                    
                    // Add ambient light from nebula (green/purple glow)
                    float ambient = 0.12;
                    vec3 ambientColor = vec3(0.4, 0.2, 0.6); // Purple ambient
                    finalColor += bandColor * ambientColor * (1.0 - shadow) * 2.0;
                    
                    // Rim light on the dark edge (Backlight from nebula)
                    float rimLight = pow(1.0 - abs(dot(vNormal, viewDir)), 3.0);
                    rimLight *= (1.0 - shadow) * 0.6; // Only on shadow side, stronger
                    finalColor += vec3(0.5, 0.8, 0.6) * rimLight; // Emerald rim light
                    
                    // Specular highlight on lit side
                    vec3 halfDir = normalize(lightDir + viewDir);
                    float spec = pow(max(dot(vNormal, halfDir), 0.0), 20.0) * shadow;
                    finalColor += vec3(1.0, 0.95, 0.8) * spec * 0.2;
                    
                    // Very subtle atmospheric haze at edges
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.5);
                    vec3 atmosphereColor = vec3(0.6, 0.4, 0.9); // Violet atmosphere
                    finalColor += atmosphereColor * fresnel * shadow * 0.25;
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

        this.planet = new THREE.Mesh(geometry, material);
        this.planet.position.set(0, 0, 0);
        this.planet.renderOrder = 500;
        this.scene.add(this.planet);

        // Inner pink glow (tight around planet)
        this.createGlowPlane(planetSize * 2.3, 0xff88aa, 0.8, -10, 0, 'small');

        // Outer atmospheric glow (larger, softer)
        this.createGlowPlane(planetSize * 3.5, 0xff6699, 0.6, -20, 0, 'big');

        console.log('[StellarDrift] Pink gas giant planet created');
    }

    createGlowPlane(size, color, opacity, zPos, yPos, name) {
        // Soft radial gradient for glow
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        const texture = new THREE.CanvasTexture(canvas);

        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: color,
            transparent: true,
            opacity: opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const plane = new THREE.Mesh(geometry, material);
        plane.position.set(0, yPos, zPos);
        this.scene.add(plane);

        if (name === 'small') {
            this.smallGlow = plane;
        } else {
            this.bigGlow = plane;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dust Ring - Subtle ring of particles around planet
    // ─────────────────────────────────────────────────────────────────────────

    createDustRing() {
        // Ring of millions of tiny particles (simulated with fewer for performance)
        const particleCount = 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        const ringColor = new THREE.Color(0xffaaee); // Pinkish
        const ringColorOuter = new THREE.Color(0xaa88cc); // Purpleish

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Ring distribution
            const angle = Math.random() * Math.PI * 2;
            // Radius: Planet is 500. Ring from 600 to 1200
            const radius = 600 + Math.pow(Math.random(), 2) * 600;

            // Flattened ring
            const x = Math.cos(angle) * radius;
            const z = (Math.sin(angle) * radius) * 0.2; // Tilt/flatten
            const y = (Math.random() - 0.5) * 40; // Thin layer vertical variation

            positions[i3] = x;
            positions[i3 + 1] = y + z * 0.5; // Tilt
            positions[i3 + 2] = z * 2.0;

            // Color variation based on radius
            const color = radius < 800 ? ringColor : ringColorOuter;
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 2,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.dustRing = new THREE.Points(geometry, material);
        // Tilt the whole ring slightly
        this.dustRing.rotation.z = 0.2;
        this.dustRing.rotation.x = 0.3;

        this.scene.add(this.dustRing);
        console.log('[StellarDrift] Dust ring created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating sparkles across the screen
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const particleCount = 500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const particleColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xffaaee), // Pink
            new THREE.Color(0xaaddff), // Light Blue
            new THREE.Color(0xddaaff), // Light Purple
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Spread across entire visible area
            positions[i3] = (Math.random() - 0.5) * 4000;
            positions[i3 + 1] = (Math.random() - 0.5) * 2000;
            positions[i3 + 2] = (Math.random() - 0.5) * 2000 - 500;

            const color = particleColors[Math.floor(Math.random() * particleColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1 + Math.random() * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 2,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);
        console.log('[StellarDrift] Ambient particles created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Meteor Field - Dark Silhouettes (like reference image)
    // ─────────────────────────────────────────────────────────────────────────

    createMeteorField() {
        const count = this.qualityPreset.meteorCount;

        // Dark material with solid appearance - BRIGHTENED FOR VISIBILITY
        const material = new THREE.MeshStandardMaterial({
            color: 0x776655,        // Rocky Grey/Brown (was 0x0a0a0a)
            emissive: 0x222233,     // Subtle nebula glow (was none) -- Key for dark background
            roughness: 0.7,         // Slightly smoother to catch light
            metalness: 0.2,         // Slight metallic sheens
            flatShading: true,
            side: THREE.DoubleSide, // Render both sides for solid appearance
        });

        // Pre-generate geometry variations - SOLID meteors
        const geometries = [];
        for (let i = 0; i < 50; i++) {
            const size = 5 + Math.random() * 15;
            // Use IcosahedronGeometry (20 faces) for solid appearance - no gaps
            const geo = new THREE.IcosahedronGeometry(size, 0);

            // Randomize vertices for rocky appearance
            const positions = geo.attributes.position;
            const randomize = size * 0.25; // Slightly less randomization for cleaner look
            for (let j = 0; j < positions.count; j++) {
                positions.setXYZ(
                    j,
                    positions.getX(j) + (Math.random() - 0.5) * randomize,
                    positions.getY(j) + (Math.random() - 0.5) * randomize,
                    positions.getZ(j) + (Math.random() - 0.5) * randomize,
                );
            }
            geo.computeVertexNormals();
            geometries.push(geo);
        }

        // Create meteor instances
        for (let i = 0; i < count; i++) {
            const geo = geometries[Math.floor(Math.random() * geometries.length)];
            const mesh = new THREE.Mesh(geo, material);

            // Ring/Belt Distribution (Natural curve matching reference)
            const angle = (Math.random() - 0.5) * 3.5; // Wide arc (~200 degrees)
            const radius = 600 + Math.random() * 600;  // Reduced max radius (600-1200) to keep away from camera

            // Convert polar to cartesian
            mesh.position.x = Math.sin(angle) * radius;
            mesh.position.z = Math.cos(angle) * radius;

            // Vertical spread (lower down as requested)
            const beltTilt = mesh.position.z * 0.15; // Increased tilt
            mesh.position.y = (Math.random() - 0.5) * 150 - 200 + beltTilt; // Much lower (-200)

            // Define animation properties
            const speed = -(Math.random() * 0.2 + 0.1) * 0.002; // Reduced base speed (was 0.005)

            this.meteors.push({
                mesh,
                angle,
                radius,
                speed,
                yBase: mesh.position.y,
                // Rotation (tumbling)
                rotationSpeed: {
                    x: Math.random() * 0.002 + 0.002, // Reduced rotation speed
                    y: Math.random() * 0.002 + 0.002,
                    z: Math.random() * 0.002 + 0.002,
                },
            });

            this.scene.add(mesh);
        }

        console.log(`[StellarDrift] ${count} meteors created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.85,
        );
        this.composer.addPass(this.bloomPass);

        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.darkness.value = 0.4;
        vignettePass.uniforms.offset.value = 1.1;
        this.composer.addPass(vignettePass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.triggerLockEffect();
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.triggerComboEffect(data.comboCount);
            }
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        this.eventUnsubscribers.push(lockUnsub, comboUnsub);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 3D PIECE LOCK EFFECTS - Smooth interpolation (no harsh setTimeout)
    // ─────────────────────────────────────────────────────────────────────────

    triggerLockEffect() {
        // All effects use intensity variables that smoothly decay in the animation loop

        // 1. STAR TWINKLE FLASH - Stars briefly brighten
        this.starTwinkleIntensity = 1.0;

        // 2. DUST RING PULSE - Smooth expansion via intensity
        this.dustRingPulse = 0.15; // Will decay smoothly

        // 3. BLOOM PULSE - Smooth intensity boost
        this.bloomPulseIntensity = 0.3; // Will decay smoothly

        // 4. METEOR SPIN BOOST - Spin faster when playing fast
        // Cap at 5.0 (significant speed boost)
        this.meteorActivity = Math.min(this.meteorActivity + 0.8, 5.0);
    }

    createShockwaveRing() {
        // Create a 3D ring geometry that expands outward from the planet
        const geometry = new THREE.RingGeometry(450, 480, 64);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffaa66,  // Mars-like orange
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const ring = new THREE.Mesh(geometry, material);
        ring.position.set(0, 0, 50); // Slightly in front of planet
        ring.scale.set(1, 1, 1);
        ring.userData.speed = 0.08; // Expansion speed

        this.scene.add(ring);
        this.shockwaveRings.push(ring);
    }



    // ─────────────────────────────────────────────────────────────────────────
    // 3D COMBO EFFECTS - Smooth interpolation (no harsh setTimeout)
    // ─────────────────────────────────────────────────────────────────────────

    triggerComboEffect(comboCount) {
        // All effects use intensity variables that smoothly decay in the animation loop

        // 1. SHOOTING STARS - More with higher combos (staggered smoothly)
        const starCount = Math.min(comboCount + 1, 5);
        for (let i = 0; i < starCount; i++) {
            setTimeout(() => this.createShootingStar(), i * 150); // Slightly more spread out
        }

        // 2. NEBULA BOOST - Set intensity based on combo (decays smoothly)
        this.nebulaBoostIntensity = Math.min(comboCount * 0.15, 0.6);

        // 2b. NEBULA PULSE (SHADER) - Spike the shader pulse uniform
        const pulseIntensity = Math.min(0.4 + (comboCount * 0.15), 1.0);
        this.nebulaPulse = Math.max(this.nebulaPulse, pulseIntensity);

        // 3. PLANET GLOW SURGE - Set intensity based on combo (decays smoothly)
        this.glowSurgeIntensity = Math.min(comboCount * 0.08, 0.5);

        // 4. BLOOM BOOST - Add to existing pulse intensity
        this.bloomPulseIntensity = Math.max(this.bloomPulseIntensity, comboCount * 0.1);

        // 5. STAR TWINKLE on combos too
        this.starTwinkleIntensity = Math.max(this.starTwinkleIntensity, 0.5 + comboCount * 0.1);

        // 6. NEBULA PARTICLE BURSTS - ALL nebulas burst simultaneously
        const particlesPerNebula = (20 + comboCount * 8) * 10; // 10x PARTICLES for maximum visibility
        this.burstAllVisibleNebulas(particlesPerNebula);
    }

    createShootingStar() {
        // Create a 3D shooting star with a trail
        const geometry = new THREE.CylinderGeometry(0, 3, 80, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
        });

        const star = new THREE.Mesh(geometry, material);

        // Random start position at screen edge
        const side = Math.random();
        if (side < 0.5) {
            // Start from left
            star.position.set(-2500, (Math.random() - 0.5) * 1500, -500 + Math.random() * 500);
            star.userData.velocity = { x: 40 + Math.random() * 20, y: -10 + Math.random() * 20, z: 0 };
        } else {
            // Start from right
            star.position.set(2500, (Math.random() - 0.5) * 1500, -500 + Math.random() * 500);
            star.userData.velocity = { x: -(40 + Math.random() * 20), y: -10 + Math.random() * 20, z: 0 };
        }

        // Rotate to face direction of travel
        star.rotation.z = Math.atan2(star.userData.velocity.y, star.userData.velocity.x) - Math.PI / 2;

        star.userData.life = 1.0;
        this.scene.add(star);
        this.shootingStars.push(star);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        if (!this.isActive) return;

        // Sound set activation handled by theme-linked settings

        this.planetPhaseOffset = Math.random() * Math.PI * 2;

        const animate = () => {
            if (!this.isActive) return;

            this.time += 0.002;

            if (this.planet?.material?.uniforms) {
                this.planet.material.uniforms.uTime.value = this.time;
            }

            // Update Nebula Shader
            // Update and drift nebula clouds (left to right)
            if (this.nebulaMeshes && this.nebulaMeshes.length > 0) {
                this.nebulaMeshes.forEach(mesh => {
                    // 1. Horizontal Drift (Left to Right)
                    mesh.position.x += mesh.userData.speed;

                    // 2. Vertical Bobbing (Natural "floating" motion)
                    // Uses sin wave based on time + random phase offset
                    const verticalOffset = Math.sin(this.time * 0.2 + mesh.userData.driftPhase) * mesh.userData.verticalRange;
                    mesh.position.y = mesh.userData.startY + verticalOffset;

                    // Wrap around when off-screen right
                    if (mesh.position.x > mesh.userData.wrapDistance) {
                        mesh.position.x = -mesh.userData.wrapDistance;

                        // Randomize Y slightly on reset for variety
                        // Variance of +/- 2000 units from base
                        const variance = (Math.random() - 0.5) * 4000;
                        mesh.userData.startY = mesh.userData.startY + variance;
                        // Clamp to prevent drifting too far off screen over time
                        // (Reset to original config logic could be better but this adds evolution)
                    }

                    // Update time uniform
                    if (mesh.material?.uniforms?.uTime) {
                        mesh.material.uniforms.uTime.value = this.time;
                    }
                });
            }

            // Update Orbiting Particles Shader (REMOVED)
            // if (this.orbitingParticles?.material?.uniforms) {
            //     this.orbitingParticles.material.uniforms.uTime.value = this.time;
            // }

            // CAMERA DRIFT: Gentle camera movement
            if (this.camera) {
                // Subtle camera movement for depth
                const xDrift = Math.sin(this.time * 0.08) * 150;
                const yDrift = Math.cos(this.time * 0.06) * 80;
                this.camera.position.x = xDrift;
                this.camera.position.y = yDrift;
                this.camera.lookAt(0, 0, 0);
            }

            // PLANET DRIFT: Move planet to different screen positions
            let planetX = 0;
            let planetY = 0;
            if (this.planet) {
                this.planet.rotation.y += 0.0001; // Ultra slow spin

                // Large orbit so planet appears on different sides of the screen
                // Use phase offset for random starting position
                planetX = Math.sin(this.time * 0.03 + this.planetPhaseOffset) * 600;
                planetY = Math.cos(this.time * 0.025 + this.planetPhaseOffset) * 350;
                this.planet.position.x = planetX;
                this.planet.position.y = planetY;

                // Also move the glow planes with the planet
                if (this.smallGlow) {
                    this.smallGlow.position.x = planetX;
                    this.smallGlow.position.y = planetY;
                }
                if (this.bigGlow) {
                    this.bigGlow.position.x = planetX;
                    this.bigGlow.position.y = planetY;
                }
            }

            // Nebula drift is handled above

            // ─────────────────────────────────────────────────────────────────
            // DYNAMIC METEOR ACTIVITY
            // Decay meteor activity smoothly
            if (this.meteorActivity > 0) {
                this.meteorActivity *= 0.998; // Decays much slower (stays fast longer)
                if (this.meteorActivity < 0.01) this.meteorActivity = 0;
            }

            // Speed multiplier: 1.0 (base) up to ~5.0 (fastest, was ~8.5)
            const speedMultiplier = 1.0 + (this.meteorActivity * 0.8);

            // Move meteors (Rotate around PLANET position)
            this.meteors.forEach((m) => {
                // Orbital rotation
                m.angle += m.speed * speedMultiplier;

                // Update position relative to planet's current position
                m.mesh.position.x = planetX + Math.sin(m.angle) * m.radius;
                m.mesh.position.z = Math.cos(m.angle) * m.radius;

                // Add slight vertical wave movement relative to planet
                m.mesh.position.y = planetY + m.yBase + Math.sin(m.angle * 2.0 + this.time) * 10;

                // Tumble rotation
                m.mesh.rotation.x -= m.rotationSpeed.x * speedMultiplier;
                m.mesh.rotation.y -= m.rotationSpeed.y * speedMultiplier;
                m.mesh.rotation.z -= m.rotationSpeed.z * speedMultiplier;
            });

            // Animate ambient particles (very gentle drift - reduced speed to prevent jitter)
            if (this.ambientParticles) {
                const positions = this.ambientParticles.geometry.attributes.position.array;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i] += 0.01; // Much slower drift
                    if (positions[i] > 2000) positions[i] = -2000; // Wrap around
                }
                this.ambientParticles.geometry.attributes.position.needsUpdate = true;
            }

            // Animate nebula clouds (very subtle drift and rotation)
            this.nebulaClouds.forEach((cloud) => {
                cloud.rotation.z += 0.0001; // Very slow rotation
            });

            // Starfield twinkling - GPU shader driven (smooth 60fps)
            if (this.starfield?.material?.uniforms) {
                // Decay the event-triggered boost
                if (this.starTwinkleIntensity > 0) {
                    this.starTwinkleIntensity *= 0.95;
                    if (this.starTwinkleIntensity < 0.01) this.starTwinkleIntensity = 0;
                }

                // Update shader uniforms (GPU does all the work)
                this.starfield.material.uniforms.uTime.value = this.time;
                this.starfield.material.uniforms.uEventBoost.value = this.starTwinkleIntensity;
            }

            // SMOOTH DUST RING PULSE - Gradual scale decay
            if (this.dustRing) {
                if (this.dustRingPulse > 0) {
                    this.dustRingPulse *= 0.93; // Smooth decay
                    if (this.dustRingPulse < 0.005) this.dustRingPulse = 0;
                }
                const scale = 1 + this.dustRingPulse;
                this.dustRing.scale.set(scale, scale, scale);
            }

            // SMOOTH BLOOM PULSE - Gradual bloom decay
            if (this.bloomPass) {
                if (this.bloomPulseIntensity > 0) {
                    this.bloomPulseIntensity *= 0.94; // Smooth decay
                    if (this.bloomPulseIntensity < 0.005) this.bloomPulseIntensity = 0;
                }
                this.bloomPass.strength = this.qualityPreset.bloomStrength * (1 + this.bloomPulseIntensity);
            }

            // SMOOTH NEBULA BOOST - Gradual opacity decay
            if (this.nebulaBoostIntensity > 0) {
                this.nebulaBoostIntensity *= 0.97; // Slow decay for nebulas
                if (this.nebulaBoostIntensity < 0.01) this.nebulaBoostIntensity = 0;
            }

            // NEBULA PULSE DECAY - Slower decay for lingering effect
            if (this.nebulaPulse > 0) {
                this.nebulaPulse *= 0.97; // Was 0.92, now decays much slower
                if (this.nebulaPulse < 0.01) this.nebulaPulse = 0;
            }

            // Update Nebula Uniforms (Pulse + Time)
            this.nebulaMeshes.forEach(mesh => {
                // 1. Horizontal Drift (Left to Right)
                mesh.position.x += mesh.userData.speed;

                // 2. Vertical Bobbing
                const verticalOffset = Math.sin(this.time * 0.2 + mesh.userData.driftPhase) * mesh.userData.verticalRange;
                mesh.position.y = mesh.userData.startY + verticalOffset;

                // 3. Smart Loop
                if (mesh.position.x > mesh.userData.wrapBoundary) {
                    mesh.position.x -= mesh.userData.totalWidth;
                    const variance = (Math.random() - 0.5) * 4000;
                    mesh.userData.startY = mesh.userData.startY + variance;
                }

                // Update uniforms
                if (mesh.material?.uniforms) {
                    // Update Time
                    if (mesh.material.uniforms.uTime) {
                        mesh.material.uniforms.uTime.value = this.time;
                    }
                    // Update Pulse
                    if (mesh.material.uniforms.uPulse) {
                        mesh.material.uniforms.uPulse.value = this.nebulaPulse;
                    }
                }
            });
            if (this.glowSurgeIntensity > 0) {
                this.glowSurgeIntensity *= 0.96;
                if (this.glowSurgeIntensity < 0.01) this.glowSurgeIntensity = 0;
            }

            // DYNAMIC PLANET GLOW COLOR
            // Matches the shader's hue shift (speed 0.05)
            // Base Mars Hue: ~20 degrees (0.05 turn)
            const hueShift = (this.time * 0.05) / (Math.PI * 2); // Convert rad to turns
            const currentHue = (0.05 + hueShift) % 1.0;

            if (this.smallGlow) {
                const glowScale = 1 + this.glowSurgeIntensity;
                this.smallGlow.scale.set(glowScale, glowScale, 1);
                this.smallGlow.material.color.setHSL(currentHue, 0.9, 0.6);
            }
            if (this.bigGlow) {
                const bigScale = 1 + this.glowSurgeIntensity * 0.5;
                this.bigGlow.scale.set(bigScale, bigScale, 1);
                this.bigGlow.material.color.setHSL(currentHue, 0.8, 0.5);
            }

            // Animate shockwave rings (if any exist)
            this.shockwaveRings = this.shockwaveRings.filter((ring) => {
                ring.scale.x += ring.userData.speed;
                ring.scale.y += ring.userData.speed;
                ring.material.opacity -= 0.015;
                if (ring.material.opacity <= 0) {
                    this.scene.remove(ring);
                    ring.geometry.dispose();
                    ring.material.dispose();
                    return false;
                }
                return true;
            });

            // Animate shooting stars (if any exist)
            this.shootingStars = this.shootingStars.filter((star) => {
                star.position.x += star.userData.velocity.x;
                star.position.y += star.userData.velocity.y;
                star.position.z += star.userData.velocity.z;
                star.userData.life -= 0.015; // Slower fade for smoother effect
                star.material.opacity = star.userData.life;
                if (star.userData.life <= 0) {
                    this.scene.remove(star);
                    star.geometry.dispose();
                    star.material.dispose();
                    return false;
                }
                return true;
            });

            // Animate nebula particle bursts
            this.nebulaBursts = this.nebulaBursts.filter((burst) => {
                const positions = burst.geometry.attributes.position.array;
                const velocities = burst.userData.velocities;

                // Move particles
                for (let j = 0; j < velocities.length; j++) {
                    positions[j * 3] += velocities[j].x;
                    positions[j * 3 + 1] += velocities[j].y;
                    positions[j * 3 + 2] += velocities[j].z;
                }
                burst.geometry.attributes.position.needsUpdate = true;

                // Fade out
                burst.userData.life -= 0.02;
                burst.material.opacity = Math.max(0, burst.userData.life / burst.userData.maxLife);

                // Cleanup
                if (burst.userData.life <= 0) {
                    this.scene.remove(burst);
                    burst.geometry.dispose();
                    burst.material.dispose();
                    return false;
                }
                return true;
            });

            // Render
            if (this.composer && this.qualityPreset.enablePostProcessing) {
                this.renderer.clear();
                this.composer.render();
            } else {
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        if (this.renderer) this.renderer.setSize(width, height);
        if (this.composer) this.composer.setSize(width, height);
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        super.stop();
    }

    cleanup() {
        this.stop();

        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement?.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.planet = null;
        this.smallGlow = null;
        this.bigGlow = null;
        this.backgroundPlanes = [];
        this.meteors = [];

        super.cleanup();
    }
}
