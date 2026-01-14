/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲 SWEDISH FOREST THEME - Three.js 3D Implementation 🌲
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * A mystical Nordic forest with layered triangular spruce trees, fireflies,
 * god rays, forest spirits, aurora borealis, stars, and atmospheric mist.
 * Inspired by Swedish forest landscapes with deep blue-green atmosphere.
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SWEDISH_FOREST_TETROMINOS } from './swedish-forest-tetrominos.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SwedishForestWater } from './SwedishForestWater.js';

// PBR textures removed - using simple Firewatch-style ground
import {
    groundVertexShader,
    groundFragmentShader,
    mistVertexShader,
    mistFragmentShader,
    godRayVertexShader,
    godRayFragmentShader,
    fireflyVertexShader,
    fireflyFragmentShader,
    starVertexShader,
    starFragmentShader,
    spiritVertexShader,
    spiritFragmentShader,
    auroraVertexShader,
    auroraFragmentShader,
    spiritWindVertexShader,
    spiritWindFragmentShader,
    leafVertexShader,
    leafFragmentShader,
    instancedFoliageVertexShader,
    instancedFoliageFragmentShader,
    instancedTrunkVertexShader,
    instancedTrunkFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    dustVertexShader,
    dustFragmentShader,
    mountainVertexShader,
    mountainFragmentShader,
    hazeVertexShader,
    hazeFragmentShader,
    branchVertexShader,
    branchFragmentShader,
    lensFlareVertexShader,
    lensFlareFragmentShader,
} from './swedish-forest-shaders.js';

// ═══════════════════════════════════════════════════════════════════════════
// THEME CONSTANTS - Nordic forest color palette
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Sky gradient - TRUE Firewatch style (deep red-orange, NO purple)
    skyTop: new THREE.Color(0x8B2010),      // Deep burnt red-orange at top
    skyMid: new THREE.Color(0xDD5522),      // Rich orange
    skyHorizon: new THREE.Color(0xFFAA44),  // Bright golden-orange at horizon

    // Tree layers (front to back) - Firewatch layered depth
    // Front trees are nearly black silhouettes, back trees warmer/hazier
    treeLayers: [
        new THREE.Color(0x180604),  // Front - nearly black with warm hint
        new THREE.Color(0x2A1008),  // Mid-front - dark brown
        new THREE.Color(0x4A2015),  // Mid - warm brown
        new THREE.Color(0x7A4028),  // Mid-back - brown-orange
        new THREE.Color(0xAA6040),  // Back - warm orange
        new THREE.Color(0xCC8055),  // Far back - light orange (for horizon layers)
    ],

    // Trunk colors matching tree layers
    trunkLayers: [
        new THREE.Color(0x100402),  // Darkened to match new front trees
        new THREE.Color(0x1A0804),
        new THREE.Color(0x2A1008),
        new THREE.Color(0x4A2015),
        new THREE.Color(0x6A3520),
        new THREE.Color(0x8A5035),
    ],

    // Ground floor colors - Firewatch warm aesthetic
    groundBase: new THREE.Color(0x24120A),   // Deepest Charcoal Brown
    groundMoss: new THREE.Color(0x8B5A2B),   // Muted Warm Brown (was bright gold)
    groundDirt: new THREE.Color(0x150805),   // Almost Black

    // Effects - warm golden tones
    mist: new THREE.Color(0xFFAA55),         // Rich golden mist
    godRay: new THREE.Color(0xFFBB66),       // Warm golden god rays
    firefly: new THREE.Color(0xFFAA44),      // Amber-gold fireflies

    // Spirit colors - warm ethereal
    spiritBase: new THREE.Color(0xFFAA66),   // Warm amber
    spiritGlow: new THREE.Color(0xFFDD88),   // Golden glow

    // Aurora colors - repurposed for warm wisps (optional use)
    aurora1: new THREE.Color(0xFF9966), // Warm orange
    aurora2: new THREE.Color(0xFFBB44), // Golden
    aurora3: new THREE.Color(0xFF6644), // Deep orange

    // Spirit wind - warm tones
    windColor: new THREE.Color(0xFFBB77),

    // Fog - warm atmospheric haze
    fog: new THREE.Color(0x3A2510),

    // Sun colors (NEW)
    sun: {
        core: new THREE.Color(0xFFFFEE),      // Bright white-yellow core
        corona: new THREE.Color(0xFFAA22),    // Deep golden corona
        edge: new THREE.Color(0xFF6600),      // Orange edge
        halo: new THREE.Color(0xFF4400),      // Outer red-orange halo
    },
};

export default class SwedishForestTheme extends BaseTheme {
    constructor() {
        super('swedish-forest');

        // Event handling
        this.eventUnsubscribers = [];

        // Resolution handling
        this.targetResolution = null;
        this.resolutionMode = 'auto';

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.foliageInstancedMesh = null;  // Single InstancedMesh for all tree foliage
        this.trunkInstancedMesh = null;    // Single InstancedMesh for all tree trunks
        this.groundPlane = null;
        this.starfield = null;
        this.mistPlanes = [];
        this.godRays = [];
        this.fireflySystem = null;
        this.spirits = [];
        this.auroraPlanes = [];
        this.spiritWinds = [];
        this.fallingLeaves = null;

        // New features - grass and mushrooms
        this.grassMesh = null;
        this.grassMaterial = null;
        this.mushrooms = [];
        this.mushroomLights = [];
        this.mushroomPulse = 0;

        // Sun and atmospheric effects
        this.sun = null;
        this.sunGlowLayers = [];
        this.sunPosition = new THREE.Vector3(0, 25, -140); // Check: Y=25, Z=-140
        this.sunBaseY = 25; // Update base Y for animation
        this.dustMotes = null;
        this.lensFlares = []; // Lens flare elements

        // Mountains, haze, and foreground
        this.mountains = [];
        this.hazeLayers = [];
        this.foregroundBranches = [];
        this.lakeMesh = null;
        this.lakeMaterial = null;

        // 3D Silhouette Mountain (Firewatch-style)
        this.silhouetteMountain = null;
        this.silhouetteMountainMaterial = null;

        // Random camera movement offsets - different every time theme starts
        this.cameraRandomOffsets = {
            posX1: Math.random() * Math.PI * 2,
            posX2: Math.random() * Math.PI * 2,
            posX3: Math.random() * Math.PI * 2,
            posY: Math.random() * Math.PI * 2,
            posZ1: Math.random() * Math.PI * 2,
            posZ2: Math.random() * Math.PI * 2,
            lookX1: Math.random() * Math.PI * 2,
            lookX2: Math.random() * Math.PI * 2,
            lookY: Math.random() * Math.PI * 2,
            // Random speed multipliers for variety
            speedMult: 0.7 + Math.random() * 0.6,
        };

        // Shared uniforms
        this.uniforms = {
            time: { value: 0 },
            glowIntensity: { value: 0 },
            mistIntensity: { value: 0.6 },
            auroraIntensity: { value: 0 },
            windSpeed: { value: 0 },
        };

        // Effect targets for smooth transitions
        this.targetGlowIntensity = 0;
        this.targetMistIntensity = 0.6;
        this.targetAuroraIntensity = 0;
        this.targetWindSpeed = 0;
        this.comboMultiplier = 1.0;
    }

    getTetrominoConfig() {
        return SWEDISH_FOREST_TETROMINOS;
    }

    async createScene() {
        console.log('[SwedishForest] Initializing Three.js scene...');

        const container = document.getElementById('swedish-forest-theme');
        if (!container) {
            console.error('[SwedishForest] Container not found');
            return;
        }

        container.innerHTML = '';

        // ─────────────────────────────────────────────────────────────────────
        // SCENE SETUP
        // ─────────────────────────────────────────────────────────────────────

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), 0.008); // Reduced fog for sunset visibility
        this.scene.background = this.createGradientBackground();

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA
        // ─────────────────────────────────────────────────────────────────────

        this.camera = new THREE.PerspectiveCamera(
            55,
            window.innerWidth / window.innerHeight,
            0.1,
            800
        );
        this.camera.position.set(0, 5, 160); // Even further back (z=160) to see entire shore
        this.camera.lookAt(0, 6, -20);    // Look at lake and distant tree line

        // ─────────────────────────────────────────────────────────────────────
        // RENDERER
        // ─────────────────────────────────────────────────────────────────────

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP (for drift animation)
        // ─────────────────────────────────────────────────────────────────────

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SCENE ELEMENTS (order matters for depth)
        // ─────────────────────────────────────────────────────────────────────

        // this.createStarfield();      // Disabled - sunset is too bright for stars
        this.createMountains();      // Distant mountain silhouettes (Firewatch style)
        this.createSilhouetteMountain();  // 3D heightmap mountain on left side
        this.createSun();            // Large glowing sun at horizon
        // this.createAuroraLayers();   // Disabled - doesn't fit sunset theme
        this.createGodRays();        // Light beams from sun
        this.createLensFlares();     // Camera lens flare from sun
        this.createTrees();          // Layered trees
        this.createHazeLayers();     // Atmospheric haze between tree layers
        this.createForestFloor();    // Warm gradient ground (Firewatch style)
        // this.createFarShore();       // Removed - merged into ForestFloor
        this.createLake();           // Firewatch-style lake on right side
        this.createShoreFoam();      // Animated foam ring at water's edge
        this.createWaterLogs();      // Wooden dock posts in the water
        this.createShoreRocks();     // Warm-colored silhouette boulders along shoreline
        this.createShoreReeds();     // Dried grass/reeds at water's edge
        this.createLakeFramingTrees(); // Silhouette trees framing lake edges
        this.createGrass();          // Golden sunset grass
        // this.createGlowingMushrooms(); // Disabled - cleaner Firewatch look
        this.createMistLayers();     // Atmospheric golden fog
        this.createSpiritWinds();    // Flowing warm energy
        this.createDustMotes();      // Floating particles in sunlight
        this.createFireflySystem();  // Glowing amber particles
        this.createForestSpirits();  // Warm ethereal orbs
        // this.createForegroundBranches(); // Disabled - foreground branch silhouettes
        // this.createFallingLeavesSystem();  // Disabled - no falling leaves
        this.setupLighting();

        // ─────────────────────────────────────────────────────────────────────
        // EVENT LISTENERS
        // ─────────────────────────────────────────────────────────────────────

        this.setupEventListeners();
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Listen for resolution changes
        this.handleDisplaySettingsChange = (e) => {
            const { width, height, resolution } = e.detail;
            const mode = resolution === 'auto' ? 'auto' : 'fixed';
            this.setInternalResolution(width, height, mode);
        };
        window.addEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);

        // ─────────────────────────────────────────────────────────────────────
        // START ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        this.animate();

        console.log('[SwedishForest] Scene initialized.');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GRADIENT BACKGROUND - Dark top to lighter horizon
    // ═══════════════════════════════════════════════════════════════════════════

    createGradientBackground() {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // TRUE Firewatch sunset gradient - NO purple, all warm orange/red
        const gradient = ctx.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, '#5A1508');    // Deep burnt red at top
        gradient.addColorStop(0.15, '#7A2010'); // Dark red-orange
        gradient.addColorStop(0.30, '#AA3318'); // Rich red-orange
        gradient.addColorStop(0.50, '#DD5520'); // Bright orange-red
        gradient.addColorStop(0.70, '#FF7730'); // Vivid orange
        gradient.addColorStop(0.85, '#FFAA45'); // Golden orange
        gradient.addColorStop(1, '#FFCC55');    // Bright golden at horizon

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 2, 512);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STARFIELD - Twinkling stars in the night sky
    // ═══════════════════════════════════════════════════════════════════════════

    createStarfield() {
        const starCount = 300;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const randoms = new Float32Array(starCount);
        const phases = new Float32Array(starCount);
        const brightness = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Spread stars across upper sky dome
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.4; // Upper hemisphere
            const radius = 150 + Math.random() * 50;

            positions[i3] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[i3 + 1] = Math.cos(phi) * radius + 20; // Shift up
            positions[i3 + 2] = Math.sin(phi) * Math.sin(theta) * radius - 80;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
            brightness[i] = 0.3 + Math.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield); // Add to scene (not mainGroup) for fixed background
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUN - Large glowing sun for Firewatch-style sunset atmosphere
    // ═══════════════════════════════════════════════════════════════════════════

    createSun() {
        // LARGE sun sphere - Firewatch style prominent sun
        const sunGeometry = new THREE.SphereGeometry(38, 32, 32);
        const sunMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uIntensity: { value: 1.2 },
                uCoreColor: { value: new THREE.Color(0xFFFFDD) },
                uCoronaColor: { value: new THREE.Color(0xFFCC44) },
                uEdgeColor: { value: new THREE.Color(0xFF8822) },
            },
            vertexShader: sunVertexShader,
            fragmentShader: sunFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sun.position.copy(this.sunPosition);
        this.scene.add(this.sun); // Add to scene, not mainGroup for fixed position

        // Multi-layer glow sprites - BIGGER for Firewatch atmospheric look
        const glowTexture = this.createSunGlowTexture();
        this.sunGlowLayers = [];

        const glowConfigs = [
            { scale: 90, opacity: 1.0, color: new THREE.Color(0xFFDD66) },
            { scale: 150, opacity: 0.7, color: new THREE.Color(0xFFAA44) },
            { scale: 220, opacity: 0.45, color: new THREE.Color(0xFF8833) },
            { scale: 320, opacity: 0.25, color: new THREE.Color(0xFF6622) },
            { scale: 450, opacity: 0.12, color: new THREE.Color(0xFF4411) },
        ];

        glowConfigs.forEach(config => {
            const material = new THREE.SpriteMaterial({
                map: glowTexture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(config.scale, config.scale, 1);
            sprite.position.copy(this.sunPosition);
            this.scene.add(sprite);
            this.sunGlowLayers.push(sprite);
        });
    }

    createSunGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 240, 1)');
        gradient.addColorStop(0.1, 'rgba(255, 220, 150, 0.95)');
        gradient.addColorStop(0.25, 'rgba(255, 160, 80, 0.7)');
        gradient.addColorStop(0.5, 'rgba(255, 100, 40, 0.35)');
        gradient.addColorStop(0.75, 'rgba(255, 60, 20, 0.12)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        return new THREE.CanvasTexture(canvas);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LENS FLARES - Camera lens flare elements from sun
    // ═══════════════════════════════════════════════════════════════════════════

    createLensFlares() {
        if (!this.scene) return;

        console.log('[SwedishForest] Creating lens flares...');

        this.lensFlares = [];

        // Lens flare configurations - subtle flares that flicker like sun peeking through trees
        // Offset is relative to sun position (0 = at sun, 1 = at camera, negative = beyond sun)
        const flareConfigs = [
            // Main flares near sun - very subtle, appearing only briefly
            { offset: 0.08, scale: 18, opacity: 0.12, color: new THREE.Color(0xFFDD88), type: 0 },  // Circle
            { offset: 0.12, scale: 8, opacity: 0.08, color: new THREE.Color(0xFF9955), type: 1 }, // Ring
            // Secondary flares - even more subtle
            { offset: 0.25, scale: 5, opacity: 0.06, color: new THREE.Color(0xFFAA66), type: 0 },   // Circle
            { offset: 0.35, scale: 10, opacity: 0.05, color: new THREE.Color(0xFF8844), type: 1 }, // Ring
            { offset: 0.5, scale: 4, opacity: 0.06, color: new THREE.Color(0xFFCC88), type: 2 },   // Hexagon
            { offset: 0.65, scale: 6, opacity: 0.04, color: new THREE.Color(0xFFBB77), type: 0 }, // Circle
            // Anamorphic horizontal streak - subtle light streaking through branches
            { offset: 0.03, scale: 50, opacity: 0.06, color: new THREE.Color(0xFFAA55), type: 3, scaleY: 0.05 }, // Streak
        ];

        flareConfigs.forEach((config, idx) => {
            const geometry = new THREE.PlaneGeometry(1, 1);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: config.opacity },
                    uFlareColor: { value: config.color },
                    uFlareType: { value: config.type },
                },
                vertexShader: lensFlareVertexShader,
                fragmentShader: lensFlareFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: false,
                side: THREE.DoubleSide,
            });

            const flare = new THREE.Mesh(geometry, material);

            // Scale - handle special case for anamorphic streak
            const scaleY = config.scaleY ? config.scale * config.scaleY : config.scale;
            flare.scale.set(config.scale, scaleY, 1);

            // Store offset and flicker phase for animation
            flare.userData.offset = config.offset;
            flare.userData.baseOpacity = config.opacity;
            flare.userData.flickerPhase = Math.random() * Math.PI * 2; // Random phase for each flare
            flare.userData.flickerSpeed = 2.0 + Math.random() * 3.0; // Variable flicker speed

            // Initial position (will be updated in animate)
            flare.position.copy(this.sunPosition);

            this.lensFlares.push(flare);
            this.scene.add(flare);
        });

        console.log('[SwedishForest] Lens flares created:', this.lensFlares.length);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DUST MOTES - Floating particles in sunlight beams
    // ═══════════════════════════════════════════════════════════════════════════

    createDustMotes() {
        const dustCount = 150;  // More dust particles floating in sunlight
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(dustCount * 3);
        const phases = new Float32Array(dustCount);
        const randoms = new Float32Array(dustCount);

        for (let i = 0; i < dustCount; i++) {
            const i3 = i * 3;
            // Spread dust wider across the scene and deeper
            positions[i3] = (Math.random() - 0.5) * 400;    // Width: 400 (-200 to 200)
            positions[i3 + 1] = 5 + Math.random() * 25;
            positions[i3 + 2] = 10 - Math.random() * 100;   // Depth: +10 to -90

            phases[i] = Math.random() * Math.PI * 2;
            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 5.0 },
            },
            vertexShader: dustVertexShader,
            fragmentShader: dustFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.dustMotes = new THREE.Points(geometry, material);
        this.mainGroup.add(this.dustMotes);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MOUNTAINS - Firewatch-style layered silhouettes with atmospheric perspective
    // ═══════════════════════════════════════════════════════════════════════════

    createMountains() {
        this.mountains = [];

        // Mountain layer configurations - Firewatch style prominent silhouettes
        const mountainConfigs = [
            { z: -88, height: 55, fogAmount: 0.6, color: new THREE.Color(0xDD8855), x: 0, width: 280, y: 22 },   // Far - warmest, haziest
            { z: -80, height: 50, fogAmount: 0.4, color: new THREE.Color(0xBB6644), x: 0, width: 280, y: 24 },   // Mid
            { z: -73, height: 45, fogAmount: 0.2, color: new THREE.Color(0x884433), x: 0, width: 280, y: 26 },   // Near - darker
        ];

        // Fog color for atmospheric blending (matches sky orange)
        const fogColor = new THREE.Color(0xFF9944);

        mountainConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height, 1, 1);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uMountainColor: { value: config.color },
                    uFogColor: { value: fogColor },
                    uFogAmount: { value: config.fogAmount },
                    uLayer: { value: index / (mountainConfigs.length - 1) },
                    uTime: this.uniforms.time,
                },
                vertexShader: mountainVertexShader,
                fragmentShader: mountainFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const mountain = new THREE.Mesh(geometry, material);
            // Position mountains higher so peaks are visible above tree line
            mountain.position.set(config.x, config.y, config.z);

            this.mountains.push(mountain);
            this.scene.add(mountain); // Add to scene, not mainGroup
        });
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 3D SILHOUETTE MOUNTAIN - Firewatch-style heightmap mountain on left side
    // ═══════════════════════════════════════════════════════════════════════════

    createSilhouetteMountain() {
        // Mountain configuration - positioned left of sun, far behind trees
        const config = {
            size: 300,           // Size of the terrain plane
            segments: 64,        // Resolution (64x64 for performance)
            peakHeight: 100,     // Maximum height at the peak
            position: new THREE.Vector3(-90, -15, -160),  // Main peak shifted right to x=-90
        };

        // Create plane geometry
        const geometry = new THREE.PlaneGeometry(
            config.size,
            config.size,
            config.segments,
            config.segments
        );
        geometry.rotateX(-Math.PI / 2);

        // --- FBM NOISE FUNCTIONS FOR HEIGHTMAP ---
        const noise2D = (x, y) => {
            const dot = x * 12.9898 + y * 78.233;
            return (Math.sin(dot) * 43758.5453) % 1;
        };

        const smoothNoise = (x, y) => {
            const ix = Math.floor(x);
            const iy = Math.floor(y);
            const fx = x - ix;
            const fy = y - iy;

            const sx = fx * fx * (3 - 2 * fx);
            const sy = fy * fy * (3 - 2 * fy);

            const n00 = noise2D(ix, iy);
            const n10 = noise2D(ix + 1, iy);
            const n01 = noise2D(ix, iy + 1);
            const n11 = noise2D(ix + 1, iy + 1);

            const nx0 = n00 + sx * (n10 - n00);
            const nx1 = n01 + sx * (n11 - n01);

            return nx0 + sy * (nx1 - nx0);
        };

        const fbm = (x, y, octaves = 5) => {
            let value = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxValue = 0;

            for (let i = 0; i < octaves; i++) {
                value += amplitude * (smoothNoise(x * frequency, y * frequency) * 2 - 1);
                maxValue += amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }

            return value / maxValue;
        };

        // --- APPLY HEIGHTMAP DISPLACEMENT - CLASSIC MOUNTAIN PEAK ---
        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        const heights = [];

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);

            // Distance from center
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = config.size * 0.45;
            const normDist = distance / maxDist;

            // === CLASSIC TRIANGULAR PEAK ===
            let height = 0;

            if (normDist < 1.0) {
                // Simple conical peak with smooth falloff
                const peakProfile = Math.pow(1.0 - normDist, 1.2);
                height = peakProfile * config.peakHeight;

                // Add asymmetry - slightly steeper on one side
                const angle = Math.atan2(dz, dx);
                const asymmetry = 1.0 + Math.sin(angle + 0.5) * 0.15;
                height *= asymmetry;

                // Add ridges
                const ridges = Math.sin(angle * 3) * 0.08 * (1.0 - normDist);
                height += ridges * config.peakHeight;

                // Add noise
                const noiseScale = 0.01;
                const rockNoise = fbm(vertex.x * noiseScale, vertex.z * noiseScale, 5);
                height += rockNoise * config.peakHeight * 0.08 * (1.0 - normDist * 0.5);
            }

            heights.push(Math.max(0, height));
            positions.setY(i, Math.max(0, height));
        }

        geometry.computeVertexNormals();

        // Add height attribute for shader coloring
        const heightAttr = new Float32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
            heightAttr[i] = heights[i] / config.peakHeight;
        }
        geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

        // Create shader material for atmospheric perspective
        this.silhouetteMountainMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uBaseColor: { value: new THREE.Color(0x553344) },   // Dark purplish base
                uPeakColor: { value: new THREE.Color(0xFF8844) },   // Orange glow at peak
                uFogColor: { value: new THREE.Color(0xFF9944) },    // Atmospheric fog matches sky
                uSkyColor: { value: new THREE.Color(0xFFBB77) },    // Sky color integration
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vHeight;
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                attribute float aHeight;

                void main() {
                    vUv = uv;
                    vHeight = aHeight;
                    vNormal = normalize(normalMatrix * normal);
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 uBaseColor;
                uniform vec3 uPeakColor;
                uniform vec3 uFogColor;
                uniform vec3 uSkyColor;
                varying float vHeight;
                varying vec3 vWorldPosition;
                varying vec3 vNormal;

                // Simple noise function
                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }

                float noise(vec2 st) {
                    vec2 i = floor(st);
                    vec2 f = fract(st);
                    float a = random(i);
                    float b = random(i + vec2(1.0, 0.0));
                    float c = random(i + vec2(0.0, 1.0));
                    float d = random(i + vec2(1.0, 1.0));
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                void main() {
                    // Start with base silhouette color
                    vec3 finalColor = uBaseColor;

                    // Light direction (from the setting sun)
                    vec3 lightDir = normalize(vec3(0.5, 0.2, 1.0));
                    float lighting = max(0.2, dot(vNormal, lightDir));

                    // === HEIGHT-BASED COLOR ===
                    // Darker at base, lighter toward peak (Firewatch style)
                    vec3 mountainColor = mix(uBaseColor, uPeakColor, vHeight * 0.8);

                    // Add subtle lighting variation
                    mountainColor *= lighting;

                    // Add noise variation for texture
                    float noiseVal = noise(vWorldPosition.xz * 0.03);
                    mountainColor += vec3(noiseVal * 0.05 - 0.025);

                    // === ATMOSPHERIC FOG ===
                    float dist = length(vWorldPosition - cameraPosition);
                    float fogFactor = smoothstep(80.0, 200.0, dist);

                    // Height-aware atmosphere (higher = more sky color)
                    vec3 atmosphereColor = mix(uFogColor, uSkyColor, vHeight * 0.5);
                    mountainColor = mix(mountainColor, atmosphereColor, fogFactor * 0.6);

                    // === BASE FOG/MIST ===
                    float baseFog = smoothstep(0.3, 0.0, vHeight);
                    baseFog *= 0.8;
                    mountainColor = mix(mountainColor, uFogColor, baseFog);

                    // === RIM LIGHTING (edge glow from sun) ===
                    float rim = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 3.0);
                    vec3 rimColor = vec3(1.0, 0.6, 0.3); // Warm orange rim
                    mountainColor += rimColor * rim * 0.15 * vHeight;

                    gl_FragColor = vec4(mountainColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });

        // Create the mountain mesh (original peak)
        this.silhouetteMountain = new THREE.Mesh(geometry, this.silhouetteMountainMaterial);
        this.silhouetteMountain.position.copy(config.position);
        this.silhouetteMountain.renderOrder = -5;

        this.scene.add(this.silhouetteMountain);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SECOND TALLER PEAK (to the left of the first one)
        // ─────────────────────────────────────────────────────────────────────

        const tallPeakConfig = {
            size: 380,           // Wide base
            segments: 64,
            peakHeight: 170,     // Reduced height
            position: new THREE.Vector3(-180, -15, -185),  // Shifted left (x -20) and back (z -10)
        };

        // Create geometry for tall peak
        const tallGeometry = new THREE.PlaneGeometry(
            tallPeakConfig.size,
            tallPeakConfig.size,
            tallPeakConfig.segments,
            tallPeakConfig.segments
        );
        tallGeometry.rotateX(-Math.PI / 2);

        // Apply heightmap to tall peak (reusing same noise functions)
        const tallPositions = tallGeometry.attributes.position;
        const tallHeights = [];

        for (let i = 0; i < tallPositions.count; i++) {
            vertex.fromBufferAttribute(tallPositions, i);

            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = tallPeakConfig.size * 0.42;  // Slightly steeper
            const normDist = distance / maxDist;

            let height = 0;

            if (normDist < 1.0) {
                // Steeper peak profile for dramatic tall mountain
                const peakProfile = Math.pow(1.0 - normDist, 1.4);
                height = peakProfile * tallPeakConfig.peakHeight;

                // Add asymmetry
                const angle = Math.atan2(dz, dx);
                const asymmetry = 1.0 + Math.sin(angle + 0.8) * 0.12;
                height *= asymmetry;

                // Add ridges
                const ridges = Math.sin(angle * 4) * 0.1 * (1.0 - normDist);
                height += ridges * tallPeakConfig.peakHeight;

                // Add subtle noise
                const noiseScale = 0.012;
                const rockNoise = fbm(vertex.x * noiseScale + 100, vertex.z * noiseScale + 100, 3);
                height += rockNoise * tallPeakConfig.peakHeight * 0.05 * (1.0 - normDist * 0.5);
            }

            tallHeights.push(Math.max(0, height));
            tallPositions.setY(i, Math.max(0, height));
        }

        tallGeometry.computeVertexNormals();

        // Add height attribute
        const tallHeightAttr = new Float32Array(tallPositions.count);
        for (let i = 0; i < tallPositions.count; i++) {
            tallHeightAttr[i] = tallHeights[i] / tallPeakConfig.peakHeight;
        }
        tallGeometry.setAttribute('aHeight', new THREE.BufferAttribute(tallHeightAttr, 1));

        // Create tall peak mesh (reuse same material)
        this.tallMountainPeak = new THREE.Mesh(tallGeometry, this.silhouetteMountainMaterial);
        this.tallMountainPeak.position.copy(tallPeakConfig.position);
        this.tallMountainPeak.renderOrder = -6;  // Render behind the first mountain

        this.scene.add(this.tallMountainPeak);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE THIRD PEAK (FAR LEFT) (to complete the 3-tops request)
        // ─────────────────────────────────────────────────────────────────────

        const farLeftConfig = {
            size: 350,
            segments: 64,
            peakHeight: 140,     // Intermediate height
            position: new THREE.Vector3(-270, -15, -200),  // Shifted left (x -20) and back (z -15)
        };

        const farLeftGeometry = new THREE.PlaneGeometry(
            farLeftConfig.size,
            farLeftConfig.size,
            farLeftConfig.segments,
            farLeftConfig.segments
        );
        farLeftGeometry.rotateX(-Math.PI / 2);

        // Apply heightmap to far left peak
        const farLeftPositions = farLeftGeometry.attributes.position;
        const farLeftHeights = [];

        for (let i = 0; i < farLeftPositions.count; i++) {
            vertex.fromBufferAttribute(farLeftPositions, i);

            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = farLeftConfig.size * 0.45;
            const normDist = distance / maxDist;

            let height = 0;

            if (normDist < 1.0) {
                // Slightly broader profile
                const peakProfile = Math.pow(1.0 - normDist, 1.3);
                height = peakProfile * farLeftConfig.peakHeight;

                // Asymmetry
                const angle = Math.atan2(dz, dx);
                height *= (1.0 + Math.sin(angle + 2.0) * 0.1);

                // Ridges
                const ridges = Math.sin(angle * 5) * 0.08 * (1.0 - normDist);
                height += ridges * farLeftConfig.peakHeight;

                // Noise
                const noiseScale = 0.01;
                const rockNoise = fbm(vertex.x * noiseScale + 500, vertex.z * noiseScale + 500, 3);
                height += rockNoise * farLeftConfig.peakHeight * 0.05;
            }

            farLeftHeights.push(Math.max(0, height));
            farLeftPositions.setY(i, Math.max(0, height));
        }

        farLeftGeometry.computeVertexNormals();

        const farLeftHeightAttr = new Float32Array(farLeftPositions.count);
        for (let i = 0; i < farLeftPositions.count; i++) {
            farLeftHeightAttr[i] = farLeftHeights[i] / farLeftConfig.peakHeight;
        }
        farLeftGeometry.setAttribute('aHeight', new THREE.BufferAttribute(farLeftHeightAttr, 1));

        this.farLeftMountain = new THREE.Mesh(farLeftGeometry, this.silhouetteMountainMaterial);
        this.farLeftMountain.position.copy(farLeftConfig.position);
        this.farLeftMountain.renderOrder = -8; // Behind tall peak
        this.scene.add(this.farLeftMountain);


        // ─────────────────────────────────────────────────────────────────────
        // CREATE RIGHT SIDE MOUNTAIN (Background silhouette matching left mountain depth)
        // Positioned far back to blend with other background mountains
        // ─────────────────────────────────────────────────────────────────────

        const rightHillConfig = {
            size: 320,           // Similar to left mountain
            segments: 64,
            peakHeight: 115,     // Natural height, not looming
            position: new THREE.Vector3(120, -15, -160),   // Balanced position on right side
        };

        // Create plane geometry for right mountain
        const rightGeometry = new THREE.PlaneGeometry(
            rightHillConfig.size,
            rightHillConfig.size,
            rightHillConfig.segments,
            rightHillConfig.segments
        );

        // Rotate to horizontal
        rightGeometry.rotateX(-Math.PI / 2);

        // Apply heightmap to right hill
        const rightPositions = rightGeometry.attributes.position;
        const rightHeights = [];

        for (let i = 0; i < rightPositions.count; i++) {
            vertex.fromBufferAttribute(rightPositions, i);

            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = rightHillConfig.size * 0.45;
            const normDist = distance / maxDist;

            let height = 0;

            if (normDist < 1.0) {
                const peakProfile = Math.pow(1.0 - normDist, 1.1);
                height = peakProfile * rightHillConfig.peakHeight;
                const angle = Math.atan2(dz, dx);
                height *= (1.0 + Math.sin(angle * 2.0 + 1.0) * 0.1);
                const ridges = Math.sin(angle * 3) * 0.06 * (1.0 - normDist);
                height += ridges * rightHillConfig.peakHeight;
                const noiseScale = 0.008;
                const rockNoise = fbm(vertex.x * noiseScale + 200, vertex.z * noiseScale + 200, 3);
                height += rockNoise * rightHillConfig.peakHeight * 0.04;
            }

            rightHeights.push(Math.max(0, height));
            rightPositions.setY(i, Math.max(0, height));
        }

        rightGeometry.computeVertexNormals();

        const rightHeightAttr = new Float32Array(rightPositions.count);
        for (let i = 0; i < rightPositions.count; i++) {
            rightHeightAttr[i] = rightHeights[i] / rightHillConfig.peakHeight;
        }
        rightGeometry.setAttribute('aHeight', new THREE.BufferAttribute(rightHeightAttr, 1));

        this.rightHill = new THREE.Mesh(rightGeometry, this.silhouetteMountainMaterial);
        this.rightHill.position.copy(rightHillConfig.position);
        this.rightHill.renderOrder = -15; // Far behind
        this.scene.add(this.rightHill);

        console.log('[SwedishForest] 3D silhouette mountains created (4 left + 1 right)');
    }

    /* REMOVED DUPLICATE CODE
    
        const smoothNoise = (x, y) => {
            const ix = Math.floor(x);
            const iy = Math.floor(y);
            const fx = x - ix;
            const fy = y - iy;
    
            const sx = fx * fx * (3 - 2 * fx);
            const sy = fy * fy * (3 - 2 * fy);
    
            const n00 = noise2D(ix, iy);
            const n10 = noise2D(ix + 1, iy);
            const n01 = noise2D(ix, iy + 1);
            const n11 = noise2D(ix + 1, iy + 1);
    
            const nx0 = n00 + sx * (n10 - n00);
            const nx1 = n01 + sx * (n11 - n01);
    
            return nx0 + sy * (nx1 - nx0);
        };
    
        const fbm = (x, y, octaves = 5) => {
            let value = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxValue = 0;
    
            for (let i = 0; i < octaves; i++) {
                value += amplitude * (smoothNoise(x * frequency, y * frequency) * 2 - 1);
                maxValue += amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }
    
            return value / maxValue;
        };
    
        // --- APPLY HEIGHTMAP DISPLACEMENT - CLASSIC MOUNTAIN PEAK ---
        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        const heights = [];
    
        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
    
            // Distance from center
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = config.size * 0.45;
            const normDist = distance / maxDist;
    
            // === CLASSIC TRIANGULAR PEAK ===
            let height = 0;
    
            if (normDist < 1.0) {
                // Simple conical peak with smooth falloff
                const peakProfile = Math.pow(1.0 - normDist, 1.2);
                height = peakProfile * config.peakHeight;
    
                // Add asymmetry - slightly steeper on one side
                const angle = Math.atan2(dz, dx);
                const asymmetry = 1.0 + Math.sin(angle + 0.5) * 0.15;
                height *= asymmetry;
    
                // Add subtle ridges running down from peak
                const ridges = Math.sin(angle * 5) * 0.08 * (1.0 - normDist);
                height += ridges * config.peakHeight;
    
                // Add subtle FBM noise for natural rock texture
                const noiseScale = 0.01;
                const rockNoise = fbm(vertex.x * noiseScale + 50, vertex.z * noiseScale + 50, 3);
                height += rockNoise * config.peakHeight * 0.06 * (1.0 - normDist * 0.5);
            }
    
            heights.push(Math.max(0, height));
            positions.setY(i, Math.max(0, height));
        }
    
        // Recompute normals
        geometry.computeVertexNormals();
    
        // Add height attribute for shader
        const heightAttr = new Float32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
            heightAttr[i] = heights[i] / config.peakHeight;
        }
        geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));
    
        // --- CUSTOM SHADER MATERIAL - Firewatch silhouette style ---
        this.silhouetteMountainMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uBaseColor: { value: new THREE.Color(0x4A2818) },      // Dark warm brown base
                uPeakColor: { value: new THREE.Color(0x8A5535) },      // Lighter warm brown peak
                uFogColor: { value: new THREE.Color(0xFF9955) },       // Warm orange fog
                uSkyColor: { value: new THREE.Color(0xFFAA55) },       // Golden sky blend
                uSunDirection: { value: new THREE.Vector3(0.2, 0.6, -0.8).normalize() },
            },
            vertexShader: `
                attribute float aHeight;
    
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying float vHeight;
    
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vHeight = aHeight;
    
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uBaseColor;
                uniform vec3 uPeakColor;
                uniform vec3 uFogColor;
                uniform vec3 uSkyColor;
                uniform vec3 uSunDirection;
                uniform float uTime;
    
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying float vHeight;
    
                // Simple noise for detail
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
    
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
    
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
    
                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }
    
                void main() {
                    // Discard pixels below ground
                    if (vHeight < 0.02) discard;
    
                    // === LIGHTING ===
                    float NdotL = dot(vNormal, uSunDirection);
                    float lighting = max(0.4, NdotL * 0.5 + 0.5);
    
                    // === HEIGHT-BASED COLOR ===
                    // Darker at base, lighter toward peak (Firewatch style)
                    vec3 mountainColor = mix(uBaseColor, uPeakColor, vHeight * 0.8);
    
                    // Add subtle lighting variation
                    mountainColor *= lighting;
    
                    // Add noise variation for texture
                    float noiseVal = noise(vWorldPosition.xz * 0.03);
                    mountainColor += vec3(noiseVal * 0.05 - 0.025);
    
                    // === ATMOSPHERIC FOG ===
                    float dist = length(vWorldPosition - cameraPosition);
                    float fogFactor = smoothstep(80.0, 200.0, dist);
    
                    // Height-aware atmosphere (higher = more sky color)
                    vec3 atmosphereColor = mix(uFogColor, uSkyColor, vHeight * 0.5);
                    mountainColor = mix(mountainColor, atmosphereColor, fogFactor * 0.6);
    
                    // === BASE FOG/MIST ===
                    float baseFog = smoothstep(0.3, 0.0, vHeight);
                    baseFog *= 0.8;
                    mountainColor = mix(mountainColor, uFogColor, baseFog);
    
                    // === RIM LIGHTING (edge glow from sun) ===
                    float rim = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 3.0);
                    vec3 rimColor = vec3(1.0, 0.6, 0.3); // Warm orange rim
                    mountainColor += rimColor * rim * 0.15 * vHeight;
    
                    gl_FragColor = vec4(mountainColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });
    
        // Create the mountain mesh (original peak)
        this.silhouetteMountain = new THREE.Mesh(geometry, this.silhouetteMountainMaterial);
        this.silhouetteMountain.position.copy(config.position);
        this.silhouetteMountain.renderOrder = -5;
    
        this.scene.add(this.silhouetteMountain);
    
        // ─────────────────────────────────────────────────────────────────────
        // CREATE SECOND TALLER PEAK (to the left of the first one)
        // ─────────────────────────────────────────────────────────────────────
    
        const tallPeakConfig = {
            size: 380,           // Wide base
            segments: 64,
            peakHeight: 170,     // Reduced height
            position: new THREE.Vector3(-260, -15, -175),  // Further left
        };
    
        // Create geometry for tall peak
        const tallGeometry = new THREE.PlaneGeometry(
            tallPeakConfig.size,
            tallPeakConfig.size,
            tallPeakConfig.segments,
            tallPeakConfig.segments
        );
        tallGeometry.rotateX(-Math.PI / 2);
    
        // Apply heightmap to tall peak (reusing same noise functions)
        const tallPositions = tallGeometry.attributes.position;
        const tallHeights = [];
    
        for (let i = 0; i < tallPositions.count; i++) {
            vertex.fromBufferAttribute(tallPositions, i);
    
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = tallPeakConfig.size * 0.42;  // Slightly steeper
            const normDist = distance / maxDist;
    
            let height = 0;
    
            if (normDist < 1.0) {
                // Steeper peak profile for dramatic tall mountain
                const peakProfile = Math.pow(1.0 - normDist, 1.4);
                height = peakProfile * tallPeakConfig.peakHeight;
    
                // Add asymmetry
                const angle = Math.atan2(dz, dx);
                const asymmetry = 1.0 + Math.sin(angle + 0.8) * 0.12;
                height *= asymmetry;
    
                // Add ridges
                const ridges = Math.sin(angle * 4) * 0.1 * (1.0 - normDist);
                height += ridges * tallPeakConfig.peakHeight;
    
                // Add subtle noise
                const noiseScale = 0.012;
                const rockNoise = fbm(vertex.x * noiseScale + 100, vertex.z * noiseScale + 100, 3);
                height += rockNoise * tallPeakConfig.peakHeight * 0.05 * (1.0 - normDist * 0.5);
            }
    
            tallHeights.push(Math.max(0, height));
            tallPositions.setY(i, Math.max(0, height));
        }
    
        tallGeometry.computeVertexNormals();
    
        // Add height attribute
        const tallHeightAttr = new Float32Array(tallPositions.count);
        for (let i = 0; i < tallPositions.count; i++) {
            tallHeightAttr[i] = tallHeights[i] / tallPeakConfig.peakHeight;
        }
        tallGeometry.setAttribute('aHeight', new THREE.BufferAttribute(tallHeightAttr, 1));
    
        // Create tall peak mesh (reuse same material)
        this.tallMountainPeak = new THREE.Mesh(tallGeometry, this.silhouetteMountainMaterial);
        this.tallMountainPeak.position.copy(tallPeakConfig.position);
        this.tallMountainPeak.renderOrder = -6;  // Render behind the first mountain
    
        this.scene.add(this.tallMountainPeak);
    
        // ─────────────────────────────────────────────────────────────────────
        // CREATE THIRD PEAK (FAR LEFT) (to complete the 3-tops request)
        // ─────────────────────────────────────────────────────────────────────
    
        const farLeftConfig = {
            size: 350,
            segments: 64,
            peakHeight: 140,     // Intermediate height
            position: new THREE.Vector3(-380, -15, -190),  // Far left of the tall peak
        };
    
        const farLeftGeometry = new THREE.PlaneGeometry(
            farLeftConfig.size,
            farLeftConfig.size,
            farLeftConfig.segments,
            farLeftConfig.segments
        );
        farLeftGeometry.rotateX(-Math.PI / 2);
    
        // Apply heightmap to far left peak
        const farLeftPositions = farLeftGeometry.attributes.position;
        const farLeftHeights = [];
    
        for (let i = 0; i < farLeftPositions.count; i++) {
            vertex.fromBufferAttribute(farLeftPositions, i);
    
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = farLeftConfig.size * 0.45;
            const normDist = distance / maxDist;
    
            let height = 0;
    
            if (normDist < 1.0) {
                // Slightly broader profile
                const peakProfile = Math.pow(1.0 - normDist, 1.3);
                height = peakProfile * farLeftConfig.peakHeight;
    
                // Asymmetry
                const angle = Math.atan2(dz, dx);
                height *= (1.0 + Math.sin(angle + 2.0) * 0.1);
    
                // Ridges
                const ridges = Math.sin(angle * 5) * 0.08 * (1.0 - normDist);
                height += ridges * farLeftConfig.peakHeight;
    
                // Noise
                const noiseScale = 0.01;
                const rockNoise = fbm(vertex.x * noiseScale + 500, vertex.z * noiseScale + 500, 3);
                height += rockNoise * farLeftConfig.peakHeight * 0.05;
            }
    
            farLeftHeights.push(Math.max(0, height));
            farLeftPositions.setY(i, Math.max(0, height));
        }
    
        farLeftGeometry.computeVertexNormals();
    
        const farLeftHeightAttr = new Float32Array(farLeftPositions.count);
        for (let i = 0; i < farLeftPositions.count; i++) {
            farLeftHeightAttr[i] = farLeftHeights[i] / farLeftConfig.peakHeight;
        }
        farLeftGeometry.setAttribute('aHeight', new THREE.BufferAttribute(farLeftHeightAttr, 1));
    
        this.farLeftMountain = new THREE.Mesh(farLeftGeometry, this.silhouetteMountainMaterial);
        this.farLeftMountain.position.copy(farLeftConfig.position);
        this.farLeftMountain.renderOrder = -8; // Behind tall peak
        this.scene.add(this.farLeftMountain);
    
        // ─────────────────────────────────────────────────────────────────────
        // CREATE RIGHT SIDE MOUNTAIN (Background silhouette matching left mountain depth)
        // Positioned far back to blend with other background mountains
        // ─────────────────────────────────────────────────────────────────────
    
        const rightHillConfig = {
            size: 320,           // Similar to left mountain
            segments: 64,
            peakHeight: 115,     // Natural height, not looming
            position: new THREE.Vector3(120, -15, -160),   // Balanced position on right side
        };
    
        const rightGeometry = new THREE.PlaneGeometry(
            rightHillConfig.size,
            rightHillConfig.size,
            rightHillConfig.segments,
            rightHillConfig.segments
        );
        rightGeometry.rotateX(-Math.PI / 2);
    
        const rightPositions = rightGeometry.attributes.position;
        const rightHeights = [];
    
        for (let i = 0; i < rightPositions.count; i++) {
            vertex.fromBufferAttribute(rightPositions, i);
    
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = rightHillConfig.size * 0.45;
            const normDist = distance / maxDist;
    
            let height = 0;
    
            if (normDist < 1.0) {
                // Rounder, softer profile for hills
                const peakProfile = Math.pow(1.0 - normDist, 1.1);
                height = peakProfile * rightHillConfig.peakHeight;
    
                // Asymmetry
                const angle = Math.atan2(dz, dx);
                height *= (1.0 + Math.sin(angle * 2.0 + 1.0) * 0.1);
    
                // Rolling ridges
                const ridges = Math.sin(angle * 3) * 0.06 * (1.0 - normDist);
                height += ridges * rightHillConfig.peakHeight;
    
                // Noise
                const noiseScale = 0.008;
                const rockNoise = fbm(vertex.x * noiseScale + 200, vertex.z * noiseScale + 200, 3);
                height += rockNoise * rightHillConfig.peakHeight * 0.04;
            }
    
            rightHeights.push(Math.max(0, height));
            rightPositions.setY(i, Math.max(0, height));
        }
    
        rightGeometry.computeVertexNormals();
    
        const rightHeightAttr = new Float32Array(rightPositions.count);
        for (let i = 0; i < rightPositions.count; i++) {
            rightHeightAttr[i] = rightHeights[i] / rightHillConfig.peakHeight;
        }
        rightGeometry.setAttribute('aHeight', new THREE.BufferAttribute(rightHeightAttr, 1));
    
        this.rightHill = new THREE.Mesh(rightGeometry, this.silhouetteMountainMaterial);
        this.rightHill.position.copy(rightHillConfig.position);
        this.rightHill.renderOrder = -15; // Far behind trees and other elements
        this.scene.add(this.rightHill);
    
    */

    // ═══════════════════════════════════════════════════════════════════════════
    // HAZE LAYERS - Atmospheric haze between tree depth layers
    // ═══════════════════════════════════════════════════════════════════════════

    createHazeLayers() {
        this.hazeLayers = [];

        // Haze configurations between tree layers
        const hazeConfigs = [
            { z: -55, y: 8, width: 120, height: 25, density: 0.35, color: new THREE.Color(0xFFBB88) },
            { z: -35, y: 6, width: 100, height: 20, density: 0.25, color: new THREE.Color(0xFFAA77) },
            { z: -18, y: 4, width: 80, height: 15, density: 0.18, color: new THREE.Color(0xFF9966) },
        ];

        hazeConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uHazeColor: { value: config.color },
                    uDensity: { value: config.density },
                },
                vertexShader: hazeVertexShader,
                fragmentShader: hazeFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const haze = new THREE.Mesh(geometry, material);
            haze.position.set(0, config.y, config.z);

            this.hazeLayers.push(haze);
            this.mainGroup.add(haze);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREGROUND BRANCHES - Silhouette frame at screen edges (Firewatch style)
    // ═══════════════════════════════════════════════════════════════════════════

    createForegroundBranches() {
        this.foregroundBranches = [];

        // Very dark silhouette color (almost black)
        const branchColor = new THREE.Color(0x0A0502);

        // Branch configurations for both sides
        const branchConfigs = [
            { side: -1, x: -22, y: 12, z: 8, width: 18, height: 25, rotZ: 0.2, opacity: 0.95 },   // Left top
            { side: -1, x: -25, y: 3, z: 6, width: 15, height: 18, rotZ: 0.35, opacity: 0.9 },    // Left bottom
            { side: 1, x: 24, y: 14, z: 7, width: 16, height: 22, rotZ: -0.15, opacity: 0.95 },   // Right top
            { side: 1, x: 26, y: 5, z: 5, width: 14, height: 16, rotZ: -0.3, opacity: 0.85 },     // Right bottom
        ];

        branchConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uBranchColor: { value: branchColor },
                    uOpacity: { value: config.opacity },
                    uSide: { value: config.side },
                },
                vertexShader: branchVertexShader,
                fragmentShader: branchFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const branch = new THREE.Mesh(geometry, material);
            branch.position.set(config.x, config.y, config.z);
            branch.rotation.z = config.rotZ;

            this.foregroundBranches.push(branch);
            this.mainGroup.add(branch);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREST FLOOR - Simple dark ground (Firewatch style)
    // ═══════════════════════════════════════════════════════════════════════════

    createForestFloor() {

        // Extended geometry to cover from lake edge to mountains
        const geometry = new THREE.PlaneGeometry(300, 250, 64, 64);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uGroundColor: { value: COLORS.groundBase },
                uMossColor: { value: COLORS.groundMoss },
                uDirtColor: { value: COLORS.groundDirt },
                uGlowIntensity: { value: 0 },
                uFogColor: { value: COLORS.fog },
            },
            vertexShader: groundVertexShader,
            fragmentShader: groundFragmentShader,
            side: THREE.DoubleSide
        });

        this.groundPlane = new THREE.Mesh(geometry, material);
        this.groundPlane.rotation.x = -Math.PI / 2;
        // Raised to -0.35 to meet water level, pushed back to -40 to cover full depth
        this.groundPlane.position.set(0, -0.35, -40);

        this.mainGroup.add(this.groundPlane);

        // Store material reference
        this.groundMaterial = material;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3D ANIMATED GRASS - Billboard clumps with wind animation
    // ═══════════════════════════════════════════════════════════════════════════

    createGrass() {
        if (!this.scene) return;

        // Generate procedural grass texture
        const grassTexture = this.createGrassTexture();

        // Billboard geometry - 4 quads at 45° intervals for fluffy look
        const clumpSize = 2.5;
        const clumpHeight = 0.8;
        const numPlanes = 4;

        const positions = [];
        const uvs = [];
        const normals = [];

        const uvTop = 0.85;

        for (let i = 0; i < numPlanes; i++) {
            const angle = (i / numPlanes) * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const halfSize = clumpSize / 2;

            // Two triangles per plane
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, 0, halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, clumpHeight, -halfSize * sin);

            uvs.push(0, 0, 1, 0, 1, uvTop);
            uvs.push(0, 0, 1, uvTop, 0, uvTop);

            for (let j = 0; j < 6; j++) {
                normals.push(0, 1, 0);
            }
        }

        const clumpGeo = new THREE.BufferGeometry();
        clumpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        clumpGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        clumpGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

        // Forest grass shader material - bright golden Firewatch sunset tones
        const grassMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uWindStrength: { value: 0.18 },
                uGrassTexture: { value: grassTexture },
                uBaseColor: { value: new THREE.Color(0x4A3015) },  // Warm brown base
                uTipColor: { value: new THREE.Color(0xDDAA44) },   // Bright golden tips (Firewatch)
                uFogColor: { value: COLORS.fog },
                uSpiritGlow: { value: 0.0 }, // Reactive to spirits
            },
            vertexShader: `
                uniform float uTime;
                uniform float uWindStrength;
                uniform float uSpiritGlow;

                varying vec2 vUv;
                varying float vFogDepth;
                varying float vGlow;

                void main() {
                    vUv = uv;
                    vec3 pos = position;

                    #ifdef USE_INSTANCING
                        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
                    #else
                        vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    #endif

                    // Wind animation
                    float windPhase = worldPos.x * 0.3 + worldPos.z * 0.25 + uTime * 1.5;
                    float wind = sin(windPhase) * uWindStrength;
                    float wind2 = sin(windPhase * 0.6 + 1.5) * uWindStrength * 0.6;

                    float heightFactor = uv.y * uv.y;
                    pos.x += wind * heightFactor;
                    pos.z += wind2 * heightFactor;

                    // Spirit glow effect - tips glow when spirits are nearby
                    float glowPattern = sin(worldPos.x * 0.2) * sin(worldPos.z * 0.15) * 0.5 + 0.5;
                    vGlow = glowPattern * heightFactor * uSpiritGlow;

                    #ifdef USE_INSTANCING
                        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                    #else
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    #endif

                    vFogDepth = -mvPosition.z;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uGrassTexture;
                uniform vec3 uBaseColor;
                uniform vec3 uTipColor;
                uniform vec3 uFogColor;

                varying vec2 vUv;
                varying float vFogDepth;
                varying float vGlow;

                void main() {
                    vec4 texColor = texture2D(uGrassTexture, vUv);
                    if (texColor.a < 0.5) discard;

                    // Dark base to lighter tips gradient
                    float gradient = smoothstep(0.0, 0.7, vUv.y);
                    vec3 grassColor = mix(uBaseColor, uTipColor, gradient);

                    vec3 finalColor = grassColor * texColor.rgb * 1.3;

                    // Add warm sunset tint at tips
                    vec3 sunsetTint = vec3(1.0, 0.85, 0.6);
                    finalColor = mix(finalColor, finalColor * sunsetTint, gradient * 0.4);

                    // Add warm spirit glow (golden amber)
                    finalColor += vec3(1.0, 0.7, 0.3) * vGlow * 0.4;

                    // Fog
                    float fogFactor = smoothstep(15.0, 60.0, vFogDepth);
                    finalColor = mix(finalColor, uFogColor, fogFactor);

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
            depthWrite: true,
            alphaTest: 0.5,
        });

        this.grassMaterial = grassMat;

        // Create instanced grass mesh
        const grassCount = 400;
        const grassMesh = new THREE.InstancedMesh(clumpGeo, grassMat, grassCount);
        const dummy = new THREE.Object3D();

        // Lake clearing parameters (matches lake at z=5, radius 70, scale 2.5x0.45)
        const lakeCenter = { x: 0, z: 5 };
        const lakeRadiusX = 95;   // 70 * 2.5 * 0.55 margin
        const lakeRadiusZ = 38;   // 70 * 0.45 + margin

        for (let i = 0; i < grassCount; i++) {
            // Distribute grass only on near shore (positive z, in front of lake)
            const angle = (Math.random() - 0.5) * Math.PI * 0.9;
            const dist = 5 + Math.random() * 55;

            const x = Math.sin(angle) * dist;
            const z = 40 + Math.cos(angle) * dist * 0.4;  // Keep grass on near shore (z > 40)

            // Check if inside lake zone
            const dx = (x - lakeCenter.x) / lakeRadiusX;
            const dz = (z - lakeCenter.z) / lakeRadiusZ;
            const inLake = (dx * dx + dz * dz) < 1.0;

            if (inLake) {
                // Hide grass in lake area
                dummy.scale.set(0, 0, 0);
            } else {
                const scale = 0.6 + Math.random() * 0.6;
                dummy.scale.set(scale, scale * (0.8 + Math.random() * 0.4), scale);
            }

            dummy.position.set(x, -0.5, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;

            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.frustumCulled = false;

        this.mainGroup.add(grassMesh);
        this.grassMesh = grassMesh;
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        const size = 512;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, size, size);

        // Draw multiple grass blades
        const bladeCount = 20;
        for (let i = 0; i < bladeCount; i++) {
            const x = (i / bladeCount) * size + (Math.random() - 0.5) * 30;
            const height = size * (0.6 + Math.random() * 0.35);
            const baseWidth = 8 + Math.random() * 6;
            const lean = (Math.random() - 0.5) * 40;

            // Gradient from dark base to golden tip (warm sunset tones)
            const gradient = ctx.createLinearGradient(x, size, x + lean, size - height);
            gradient.addColorStop(0, '#1a1508');
            gradient.addColorStop(0.3, '#3a2a15');
            gradient.addColorStop(0.6, '#5a4a25');
            gradient.addColorStop(1.0, '#8a7a40');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(x - baseWidth / 2, size);
            ctx.lineTo(x + baseWidth / 2, size);

            // Curved blade with bezier
            const midX = x + lean * 0.6;
            const midY = size - height * 0.5;
            const tipX = x + lean;
            const tipY = size - height;

            ctx.quadraticCurveTo(midX + baseWidth * 0.3, midY, tipX, tipY);
            ctx.quadraticCurveTo(midX - baseWidth * 0.3, midY, x - baseWidth / 2, size);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAKE - Firewatch-style stylized water with gradient and ripples
    // ═══════════════════════════════════════════════════════════════════════════

    createLake() {
        if (!this.scene) return;

        console.log('[SwedishForest] Creating Three.js Water lake with organic shoreline...');

        // ─────────────────────────────────────────────────────────────────────
        // ORGANIC LAKE SHAPE - Irregular shoreline using noise
        // ─────────────────────────────────────────────────────────────────────

        const baseRadius = 70;
        const segments = 128;

        // Create custom geometry with irregular edges
        const positions = [0, 0, 0]; // Center vertex
        const uvs = [0.5, 0.5]; // Center UV
        const indices = [];

        // Simple noise function for shoreline variation
        const noise = (x, y, seed = 0) => {
            const n1 = Math.sin(x * 2.3 + seed) * Math.cos(y * 1.7 + seed * 0.7);
            const n2 = Math.sin(x * 5.1 + seed * 1.3) * Math.cos(y * 4.2 + seed * 0.5) * 0.5;
            const n3 = Math.sin(x * 8.7 + seed * 2.1) * Math.cos(y * 7.3 + seed * 1.1) * 0.25;
            return (n1 + n2 + n3) / 1.75;
        };

        // Generate vertices around the perimeter with organic variation
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Add organic variation to radius (different on near vs far shore)
            const nearShoreBoost = sin > 0 ? 0.15 : 0; // More variation on near shore (positive Y in local coords)
            const variation = noise(cos * 3, sin * 3, 42) * (0.12 + nearShoreBoost);
            const radius = baseRadius * (1 + variation);

            const x = cos * radius;
            const y = sin * radius;

            positions.push(x, y, 0);
            uvs.push((cos + 1) / 2, (sin + 1) / 2);
        }

        // Create triangle indices (fan from center)
        for (let i = 1; i <= segments; i++) {
            indices.push(0, i, i + 1);
        }

        const lakeGeometry = new THREE.BufferGeometry();
        lakeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        lakeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        lakeGeometry.setIndex(indices);
        lakeGeometry.computeVertexNormals();

        // ─────────────────────────────────────────────────────────────────────
        // THREE.JS WATER WITH ORANGE TINT
        // ─────────────────────────────────────────────────────────────────────

        const loader = new THREE.TextureLoader();
        const waterNormals = loader.load('textures/water-normal.jpg');
        waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

        this.lakeMesh = new SwedishForestWater(lakeGeometry, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: waterNormals,
            sunDirection: this.sunPosition.clone().normalize(),
            sunColor: 0xff6600,     // Orange sun
            waterColor: 0xff4400,   // Intense orange water
            distortionScale: 0.8,   // Calm ripples
            fog: false
        });

        // Position: Horizontal plane
        this.lakeMesh.rotation.x = -Math.PI / 2;
        this.lakeMesh.scale.set(2.5, 0.45, 1.0);
        this.lakeMesh.position.set(0, -0.3, 5);

        this.lakeMesh.material.uniforms.size.value = 4.0;

        this.mainGroup.add(this.lakeMesh);

        console.log('[SwedishForest] Organic shoreline lake created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHORE FOAM - Animated gradient ring around lake edge
    // ═══════════════════════════════════════════════════════════════════════════

    createShoreFoam() {
        if (!this.scene) return;

        console.log('[SwedishForest] Creating shore foam ring...');

        const baseRadius = 70;
        const segments = 128;
        const foamWidth = 5; // Width of foam ring in local units

        // Same noise function as lake for matching edges
        const noise = (x, y, seed = 0) => {
            const n1 = Math.sin(x * 2.3 + seed) * Math.cos(y * 1.7 + seed * 0.7);
            const n2 = Math.sin(x * 5.1 + seed * 1.3) * Math.cos(y * 4.2 + seed * 0.5) * 0.5;
            const n3 = Math.sin(x * 8.7 + seed * 2.1) * Math.cos(y * 7.3 + seed * 1.1) * 0.25;
            return (n1 + n2 + n3) / 1.75;
        };

        // Build ring geometry with inner and outer edges
        const positions = [];
        const uvs = [];
        const indices = [];

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Match lake's organic variation
            const nearShoreBoost = sin > 0 ? 0.15 : 0;
            const variation = noise(cos * 3, sin * 3, 42) * (0.12 + nearShoreBoost);

            // Inner edge (matches lake exactly)
            const innerRadius = baseRadius * (1 + variation);
            // Outer edge (extends onto land)
            const outerRadius = innerRadius + foamWidth;

            // Inner vertex
            positions.push(cos * innerRadius, sin * innerRadius, 0);
            uvs.push(i / segments, 0.0); // v=0 at inner edge

            // Outer vertex
            positions.push(cos * outerRadius, sin * outerRadius, 0);
            uvs.push(i / segments, 1.0); // v=1 at outer edge
        }

        // Create quad strip indices
        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = i * 2 + 2;
            const d = i * 2 + 3;
            // Two triangles per quad
            indices.push(a, b, c);
            indices.push(b, d, c);
        }

        const foamGeometry = new THREE.BufferGeometry();
        foamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        foamGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        foamGeometry.setIndex(indices);

        // Foam shader material
        const foamMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                foamColor: { value: new THREE.Color(0.95, 0.75, 0.45) }, // Warm golden (subtle)
                opacity: { value: 0.4 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 foamColor;
                uniform float opacity;
                varying vec2 vUv;

                void main() {
                    // vUv.y: 0.0 at water edge (inner), 1.0 at land edge (outer)
                    // Fade from water edge outward
                    float alpha = 1.0 - smoothstep(0.0, 0.8, vUv.y);

                    // Very subtle shimmer
                    float shimmer = 0.9 + 0.1 * sin(time * 1.0 + vUv.x * 10.0);
                    alpha *= shimmer;

                    gl_FragColor = vec4(foamColor, alpha * opacity);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.shoreFoamMesh = new THREE.Mesh(foamGeometry, foamMaterial);

        // Match lake transform
        this.shoreFoamMesh.rotation.x = -Math.PI / 2;
        this.shoreFoamMesh.scale.set(2.5, 0.45, 1.0);
        this.shoreFoamMesh.position.set(0, -0.25, 5); // Just above water surface

        this.mainGroup.add(this.shoreFoamMesh);

        console.log('[SwedishForest] Shore foam ring created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WATER LOGS - Wooden dock posts sticking out of water (Firewatch style)
    // ═══════════════════════════════════════════════════════════════════════════

    createWaterLogs() {
        if (!this.scene) return;

        console.log('[SwedishForest] Creating fallen logs...');

        this.waterLogs = new THREE.Group();

        // Dark wood silhouette color
        const woodColor = new THREE.Color(0x1A0D08);
        const woodMaterial = new THREE.MeshBasicMaterial({ color: woodColor });

        // ─────────────────────────────────────────────────────────────────────
        // FALLEN LOGS - Horizontal tree trunks lying at the far shore near trees
        // Lake is centered at z=5, far shore (near trees) is around z=-20 to -10
        // ─────────────────────────────────────────────────────────────────────
        const fallenLogs = [
            // Left side - larger log at far shore
            { x: -45, z: -15, length: 12, radius: 0.5, rotY: 0.15, tilt: 0.04 },
            // Center-left - medium log
            { x: -15, z: -12, length: 8, radius: 0.4, rotY: -0.2, tilt: 0.03 },
            // Center - small log (near the right shoreline stone)
            { x: 22, z: -15, length: 6, radius: 0.35, rotY: 0.2, tilt: -0.02 },
            // Right side - near the rocks, in the water
            { x: 85, z: 5, length: 9, radius: 0.45, rotY: -0.25, tilt: 0.02 },
            // Far right - close to right rock cluster
            { x: 100, z: 12, length: 6, radius: 0.5, rotY: 0.35, tilt: 0.03 },
        ];

        fallenLogs.forEach((config) => {
            // Create a group for log + branch stubs
            const logGroup = new THREE.Group();

            // Main trunk - oriented along X-axis (horizontal log lying down)
            // Use rotated geometry so branches can attach properly
            const geometry = new THREE.CylinderGeometry(
                config.radius * 0.85,  // Slight taper at one end
                config.radius,
                config.length,
                8
            );
            // Rotate geometry to lie along X-axis before creating mesh
            geometry.rotateZ(Math.PI / 2);

            const log = new THREE.Mesh(geometry, woodMaterial);
            logGroup.add(log);

            // Add cut-off branch stubs along the log
            const numBranches = 3 + Math.floor(config.length / 3);
            for (let i = 0; i < numBranches; i++) {
                const branchRadius = config.radius * (0.25 + Math.random() * 0.15);
                const branchLength = config.radius * (1.0 + Math.random() * 0.6);

                const branchGeom = new THREE.CylinderGeometry(
                    branchRadius * 0.4,  // Tapered end (cut-off look)
                    branchRadius,        // Base matches log
                    branchLength,
                    6
                );
                // Translate geometry so the base (wider end) is at origin
                // Cylinder is centered, so move it up by half length
                branchGeom.translate(0, branchLength / 2, 0);

                const branch = new THREE.Mesh(branchGeom, woodMaterial);

                // Position along the log length (X-axis)
                const alongLog = (i / Math.max(numBranches - 1, 1) - 0.5) * config.length * 0.8;

                // Angle around the log - alternate top/sides, with randomness
                // 0 = top, PI/2 = side, PI = bottom
                const baseAngle = (i % 3) * (Math.PI * 2 / 3); // Distribute around circumference
                const circumAngle = baseAngle + (Math.random() - 0.5) * 0.6;

                // Position branch base exactly at log surface
                const surfaceY = Math.cos(circumAngle) * config.radius;
                const surfaceZ = Math.sin(circumAngle) * config.radius;

                branch.position.set(alongLog, surfaceY, surfaceZ);

                // Rotate branch to point outward from log surface
                // The branch cylinder's Y-axis should point outward from the log center
                branch.rotation.x = circumAngle - Math.PI / 2;
                branch.rotation.z = (Math.random() - 0.5) * 0.3; // Slight random tilt

                logGroup.add(branch);
            }

            // Position the whole group - partially submerged
            logGroup.position.set(config.x, -0.15, config.z);

            // Apply rotation for variety (no need for Z rotation since geometry is pre-rotated)
            logGroup.rotation.y = config.rotY;
            logGroup.rotation.x = config.tilt;

            this.waterLogs.add(logGroup);
        });

        this.mainGroup.add(this.waterLogs);

        console.log('[SwedishForest] Fallen logs created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FAR SHORE - Visible ground strip between lake and distant trees
    // ═══════════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
    // FAR SHORE - REMOVED (Merged into Forest Floor)
    // ═══════════════════════════════════════════════════════════════════════════

    createFarShore() {
        // Function intentionally left empty or removed
        if (this.farShore) {
            this.mainGroup.remove(this.farShore);
            this.farShore = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHORE ROCKS - Warm-colored silhouette boulders along the shoreline
    // ═══════════════════════════════════════════════════════════════════════════

    createShoreRocks() {
        if (!this.scene) return;

        this.shoreRocks = [];

        const rockColors = [
            new THREE.Color(0x2A1510),  // Dark warm
            new THREE.Color(0x3A2015),  // Medium warm
            new THREE.Color(0x4A2A20),  // Lighter warm
        ];

        // Rock positions along the near shore and lake edges for natural framing
        // Lake edges visible in camera are around x=±120-160, near shore around z=35-55
        const rockPositions = [
            // NEAR SHORE CENTER - close to camera, breaking up foreground
            { x: -20, z: 42, scale: 6.0, rotY: 0.3, colorIdx: 0 },
            { x: 15, z: 45, scale: 5.0, rotY: 1.2, colorIdx: 1 },
            { x: -35, z: 38, scale: 5.5, rotY: 0.8, colorIdx: 2 },
            { x: 40, z: 40, scale: 7.0, rotY: 0.8, colorIdx: 0 },
            // LEFT EDGE framing rocks - at visible left lake edge (x=-100 to -140)
            { x: -105, z: 48, scale: 8.0, rotY: 0.9, colorIdx: 0 },
            { x: -120, z: 42, scale: 10.0, rotY: 1.5, colorIdx: 1 },
            { x: -110, z: 35, scale: 7.0, rotY: 2.2, colorIdx: 2 },
            { x: -130, z: 50, scale: 12.0, rotY: 0.4, colorIdx: 0 },
            { x: -115, z: 28, scale: 9.0, rotY: 1.8, colorIdx: 1 },
            { x: -140, z: 45, scale: 11.0, rotY: 0.6, colorIdx: 2 },
            // RIGHT EDGE framing rocks - at visible right lake edge (x=100 to 140)
            { x: 105, z: 45, scale: 8.0, rotY: 1.1, colorIdx: 0 },
            { x: 120, z: 40, scale: 10.0, rotY: 0.7, colorIdx: 1 },
            { x: 110, z: 32, scale: 7.5, rotY: 1.9, colorIdx: 2 },
            { x: 130, z: 52, scale: 12.0, rotY: 2.6, colorIdx: 0 },
            { x: 115, z: 25, scale: 9.0, rotY: 0.3, colorIdx: 1 },
            { x: 140, z: 48, scale: 11.0, rotY: 1.4, colorIdx: 2 },
            // LEFT DENSE SHORE ROCKS (foreground detail)
            { x: -85, z: 20, scale: 5.0, rotY: 0.5, colorIdx: 0 },
            { x: -95, z: 12, scale: 6.5, rotY: 1.8, colorIdx: 1 },
            { x: -88, z: 5, scale: 5.5, rotY: 2.5, colorIdx: 2 },
            { x: -100, z: -5, scale: 7.0, rotY: 0.9, colorIdx: 0 },
            // RIGHT DENSE SHORE ROCKS (foreground detail)
            { x: 85, z: 18, scale: 5.5, rotY: 1.2, colorIdx: 0 },
            { x: 95, z: 10, scale: 6.0, rotY: 2.1, colorIdx: 1 },
            { x: 88, z: 2, scale: 5.0, rotY: 0.3, colorIdx: 2 },
            { x: 100, z: -8, scale: 7.5, rotY: 1.6, colorIdx: 0 },
            // FAR SHORELINE STONES - where forest meets water (z around -10 to -18)
            { x: -25, z: -12, scale: 4.0, rotY: 0.7, colorIdx: 1 },  // Left of center, near logs
            { x: 30, z: -14, scale: 5.0, rotY: 1.4, colorIdx: 0 },   // Right of center, breaking up shore
        ];

        rockPositions.forEach((config) => {
            // ═══════════════════════════════════════════════════════════════════
            // ANGULAR BOULDER: Sharp edges, cracks, asymmetric shape
            // ═══════════════════════════════════════════════════════════════════

            // Higher subdivision (2) for more detail and sharper features
            const geometry = new THREE.IcosahedronGeometry(1, 2);

            const positions = geometry.attributes.position;
            const colors = new Float32Array(positions.count * 3);

            // FIREWATCH COLOR PALETTE - warm oranges and browns
            const shadowColor = new THREE.Color(0x2A1508);   // Deep warm shadow
            const midColor = new THREE.Color(0x7A4020);      // Warm brown mid-tone
            const lightColor = new THREE.Color(0xC86030);    // Bright orange-brown
            const rimColor = new THREE.Color(0xFF8040);      // Intense orange rim highlight
            const crackColor = new THREE.Color(0x150A04);    // Very dark for cracks

            // Random seed per rock for variety
            const seed = config.x * 0.1 + config.z * 0.2;

            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const z = positions.getZ(i);

                // ─── ANGULAR BOULDER DISTORTION ───
                // Large-scale asymmetric stretching (not uniform sphere)
                const stretchX = 0.9 + Math.sin(seed * 3.7) * 0.3;  // 0.6 to 1.2
                const stretchZ = 0.85 + Math.cos(seed * 2.3) * 0.25; // 0.6 to 1.1

                // Sharp angular noise (not smooth sine waves)
                const angularNoise = (px, py, pz) => {
                    const n = Math.sin(px * 5.0 + seed) * Math.sin(py * 4.0 + pz * 3.0);
                    // Make it sharper by squaring and preserving sign
                    return Math.sign(n) * Math.pow(Math.abs(n), 0.5);
                };

                // Crack detection - sharp indentations
                const crackNoise = (px, py, pz) => {
                    const crack1 = Math.sin(px * 8.0 + py * 3.0 + seed * 2.0);
                    const crack2 = Math.sin(pz * 7.0 + px * 4.0 + seed * 1.5);
                    // Ridge function for sharp V-shaped cracks
                    const ridge = Math.abs(crack1 * crack2);
                    return ridge < 0.15 ? (0.15 - ridge) * 3.0 : 0; // Crack depth
                };

                // Facet-like bumps for angular appearance
                const facetNoise = Math.floor(Math.sin(x * 3.0 + y * 2.0 + z * 4.0 + seed) * 3) / 3;

                // Combine distortions
                const angular = angularNoise(x, y, z) * 0.2;
                const crack = crackNoise(x, y, z);
                const facet = facetNoise * 0.1;

                // Base scale with angular features
                let scale = 1.0 + angular + facet - crack * 0.25;

                // Apply asymmetric stretching
                let nx = x * scale * stretchX;
                let ny = y * scale * 0.5;  // Flattened
                let nz = z * scale * stretchZ;

                // Add large-scale irregular bumps for boulder silhouette
                const bumpAngle = Math.atan2(z, x);
                const bump = Math.sin(bumpAngle * 3.0 + seed * 5.0) * 0.15;
                const bumpRadius = Math.sqrt(x * x + z * z);
                if (bumpRadius > 0.3) {
                    nx += Math.cos(bumpAngle) * bump * bumpRadius;
                    nz += Math.sin(bumpAngle) * bump * bumpRadius;
                }

                positions.setX(i, nx);
                positions.setY(i, ny);
                positions.setZ(i, nz);


                // ─── FIREWATCH DIRECTIONAL LIGHTING ───
                // Calculate surface normal (approximate from position)
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                const normX = nx / len;
                const normY = ny / len;
                const normZ = nz / len;

                // Sun is BEHIND the scene (negative Z), shining toward camera
                // So surfaces facing camera (positive normZ) are in SHADOW
                // Surfaces facing away from camera (negative normZ) catch backlight

                // Front-facing factor: how much the surface faces the camera
                const frontFacing = Math.max(0, normZ);  // 0 to 1, 1 = directly facing camera

                // Back-facing factor: how much the surface faces the sun (behind scene)
                const backFacing = Math.max(0, -normZ);  // 0 to 1, 1 = facing away from camera

                // Upward factor for top highlights
                const upFacing = Math.max(0, normY);

                // Bold color bands based on lighting
                let r, g, b;

                // Start with mid-tone
                r = midColor.r;
                g = midColor.g;
                b = midColor.b;

                // CAMERA-FACING = SHADOW (front of rock is dark)
                if (frontFacing > 0.2) {
                    const shadowMix = Math.min((frontFacing - 0.2) * 1.5, 0.85);
                    r = r * (1.0 - shadowMix) + shadowColor.r * shadowMix;
                    g = g * (1.0 - shadowMix) + shadowColor.g * shadowMix;
                    b = b * (1.0 - shadowMix) + shadowColor.b * shadowMix;
                }

                // BACK-FACING + UP = CATCHES SUN (bright warm highlights)
                const sunCatch = backFacing * 0.7 + upFacing * 0.5;
                if (sunCatch > 0.3) {
                    const lightMix = Math.min((sunCatch - 0.3) * 1.4, 0.9);
                    r = r * (1.0 - lightMix) + lightColor.r * lightMix;
                    g = g * (1.0 - lightMix) + lightColor.g * lightMix;
                    b = b * (1.0 - lightMix) + lightColor.b * lightMix;
                }

                // RIM LIGHTING - bright orange on silhouette edges (backlit effect)
                // Edges perpendicular to camera that face upward or backward get rim light
                const edgeFactor = 1.0 - Math.abs(normZ);  // 1 = edge, 0 = facing camera
                const rimStrength = edgeFactor * (upFacing * 0.6 + backFacing * 0.4 + 0.2);
                if (rimStrength > 0.35) {
                    const rimMix = Math.min((rimStrength - 0.35) * 2.0, 0.8);
                    r = r + (rimColor.r - r) * rimMix;
                    g = g + (rimColor.g - g) * rimMix;
                    b = b + (rimColor.b - b) * rimMix;
                }

                // CRACK DARKENING - make cracks very dark
                if (crack > 0.1) {
                    const crackMix = Math.min(crack * 2.0, 0.9);
                    r = r * (1.0 - crackMix) + crackColor.r * crackMix;
                    g = g * (1.0 - crackMix) + crackColor.g * crackMix;
                    b = b * (1.0 - crackMix) + crackColor.b * crackMix;
                }

                colors[i * 3] = Math.min(r, 1.0);
                colors[i * 3 + 1] = Math.min(g, 1.0);
                colors[i * 3 + 2] = Math.min(b, 1.0);
            }

            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.computeVertexNormals();

            // Flat shading material with vertex colors
            const material = new THREE.MeshBasicMaterial({
                vertexColors: true,
            });

            const rock = new THREE.Mesh(geometry, material);
            rock.position.set(config.x, -0.3, config.z);
            rock.scale.setScalar(config.scale);
            rock.rotation.y = config.rotY;
            rock.rotation.x = (Math.random() - 0.5) * 0.15;  // Less random tilt
            rock.rotation.z = (Math.random() - 0.5) * 0.1;

            this.shoreRocks.push(rock);
            this.mainGroup.add(rock);
        });

        console.log('[SwedishForest] Firewatch-style shore rocks created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHORE REEDS - Dried grass/reeds at the water's edge
    // ═══════════════════════════════════════════════════════════════════════════

    createShoreReeds() {
        if (!this.scene) return;

        this.shoreReeds = [];

        // Reed cluster positions along shore and lake edges
        // Visible lake edges are around x=±100-140, near shore around z=35-55
        const reedClusters = [
            // NEAR SHORE CENTER - visible along waterline
            { x: -25, z: 42, count: 14, height: 5.0 },
            { x: 30, z: 45, count: 16, height: 5.5 },
            { x: -45, z: 38, count: 12, height: 4.8 },
            { x: 50, z: 40, count: 14, height: 5.2 },
            { x: 5, z: 44, count: 10, height: 4.5 },
            // LEFT EDGE reeds - frame the left shoreline at visible edge
            { x: -100, z: 48, count: 18, height: 6.5 },
            { x: -115, z: 42, count: 16, height: 6.0 },
            { x: -105, z: 35, count: 14, height: 5.5 },
            { x: -125, z: 50, count: 20, height: 7.0 },
            { x: -110, z: 28, count: 15, height: 5.8 },
            // RIGHT EDGE reeds - frame the right shoreline at visible edge
            { x: 100, z: 45, count: 17, height: 6.2 },
            { x: 115, z: 40, count: 15, height: 5.8 },
            { x: 105, z: 32, count: 14, height: 5.5 },
            { x: 125, z: 52, count: 20, height: 7.0 },
            { x: 110, z: 25, count: 16, height: 6.0 },
        ];

        // Reed colors - dried golden brown
        const reedColors = [
            new THREE.Color(0x8A6A35),
            new THREE.Color(0x7A5A30),
            new THREE.Color(0x6A4A28),
        ];

        reedClusters.forEach((cluster) => {
            const group = new THREE.Group();

            for (let i = 0; i < cluster.count; i++) {
                // Create thin triangular reed geometry
                const height = cluster.height * (0.7 + Math.random() * 0.6);
                const geometry = new THREE.ConeGeometry(0.03, height, 4);
                geometry.translate(0, height / 2, 0);

                const material = new THREE.MeshBasicMaterial({
                    color: reedColors[Math.floor(Math.random() * reedColors.length)],
                    side: THREE.DoubleSide,
                });

                const reed = new THREE.Mesh(geometry, material);

                // Position within cluster
                reed.position.set(
                    (Math.random() - 0.5) * 2.5,
                    -0.5,
                    (Math.random() - 0.5) * 2.5
                );

                // Random rotation and lean
                reed.rotation.x = (Math.random() - 0.5) * 0.3;
                reed.rotation.z = (Math.random() - 0.5) * 0.3;

                group.add(reed);
            }

            group.position.set(cluster.x, 0, cluster.z);
            this.shoreReeds.push(group);
            this.mainGroup.add(group);
        });

        console.log('[SwedishForest] Shore reeds created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAKE FRAMING TREES - Dark silhouette trees at the lake edges
    // Creates visual containment so lake feels nestled in a forest clearing
    // ═══════════════════════════════════════════════════════════════════════════

    createLakeFramingTrees() {
        if (!this.scene) return;

        this.framingTrees = [];

        // Dark silhouette colors for framing trees (foreground, so darker)
        const treeColors = [
            new THREE.Color(0x150805),  // Very dark (closest)
            new THREE.Color(0x1A0A06),  // Dark
            new THREE.Color(0x200C08),  // Medium dark
        ];

        // Tree positions at left and right lake edges
        // Lake is scaled 2.5x in X direction (radius 70), so edges are at ~x=±175
        // Camera is at z=100, looking at z=-20, visible lake edges are around x=±120-160
        const treePositions = [
            // LEFT EDGE FRAMING TREES - visible at left side of camera view
            { x: -120, z: 50, height: 25, scale: 1.8, colorIdx: 0 },
            { x: -135, z: 42, height: 30, scale: 2.0, colorIdx: 1 },
            { x: -125, z: 35, height: 22, scale: 1.6, colorIdx: 0 },
            { x: -145, z: 48, height: 35, scale: 2.2, colorIdx: 2 },
            { x: -130, z: 28, height: 28, scale: 1.9, colorIdx: 0 },
            { x: -155, z: 55, height: 38, scale: 2.4, colorIdx: 1 },
            { x: -140, z: 38, height: 26, scale: 1.7, colorIdx: 2 },
            { x: -160, z: 45, height: 40, scale: 2.5, colorIdx: 0 },
            { x: -115, z: 58, height: 20, scale: 1.5, colorIdx: 1 },
            { x: -150, z: 32, height: 32, scale: 2.1, colorIdx: 2 },
            // RIGHT EDGE FRAMING TREES - visible at right side of camera view
            { x: 120, z: 48, height: 24, scale: 1.7, colorIdx: 0 },
            { x: 135, z: 40, height: 28, scale: 1.9, colorIdx: 1 },
            { x: 125, z: 32, height: 22, scale: 1.6, colorIdx: 2 },
            { x: 145, z: 52, height: 34, scale: 2.2, colorIdx: 0 },
            { x: 130, z: 25, height: 26, scale: 1.8, colorIdx: 1 },
            { x: 155, z: 58, height: 36, scale: 2.3, colorIdx: 0 },
            { x: 140, z: 35, height: 30, scale: 2.0, colorIdx: 2 },
            { x: 160, z: 42, height: 42, scale: 2.6, colorIdx: 1 },
            { x: 115, z: 55, height: 18, scale: 1.4, colorIdx: 0 },
            { x: 150, z: 30, height: 33, scale: 2.1, colorIdx: 2 },
        ];

        treePositions.forEach((config) => {
            // Create simple spruce silhouette (Firewatch-style cone shape)
            const treeGroup = new THREE.Group();

            // Trunk
            const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, config.height * 0.25, 6);
            const trunkMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0x0A0402),
            });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = config.height * 0.125;
            treeGroup.add(trunk);

            // Create layered foliage cones for spruce look
            const numLayers = 4;
            for (let i = 0; i < numLayers; i++) {
                const layerHeight = config.height * (0.3 - i * 0.05);
                const layerRadius = config.height * (0.22 - i * 0.04);
                const layerY = config.height * (0.2 + i * 0.2);

                const coneGeo = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
                const coneMat = new THREE.MeshBasicMaterial({
                    color: treeColors[config.colorIdx],
                });
                const cone = new THREE.Mesh(coneGeo, coneMat);
                cone.position.y = layerY;
                treeGroup.add(cone);
            }

            // Position and scale
            treeGroup.position.set(config.x, -0.5, config.z);
            treeGroup.scale.setScalar(config.scale);
            treeGroup.rotation.y = Math.random() * Math.PI * 0.5;

            this.framingTrees.push(treeGroup);
            this.mainGroup.add(treeGroup);
        });

        console.log('[SwedishForest] Lake framing trees created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOWING MUSHROOMS - Bioluminescent fungi
    // ═══════════════════════════════════════════════════════════════════════════

    createGlowingMushrooms() {
        this.mushrooms = [];
        this.mushroomLights = [];

        // Mushroom positions - scattered around the forest floor
        // Hue 0.03-0.08 = warm orange/amber for sunset atmosphere
        const mushroomData = [
            { x: -8, z: 2, scale: 0.4, hue: 0.05 },
            { x: 12, z: -5, scale: 0.5, hue: 0.07 },
            { x: -15, z: -8, scale: 0.35, hue: 0.04 },
            { x: 5, z: 5, scale: 0.45, hue: 0.06 },
            { x: -3, z: -3, scale: 0.3, hue: 0.05 },
            { x: 18, z: 0, scale: 0.4, hue: 0.08 },
            { x: -20, z: 3, scale: 0.5, hue: 0.03 },
            { x: 8, z: 8, scale: 0.35, hue: 0.06 },
            { x: -12, z: 6, scale: 0.4, hue: 0.07 },
            { x: 15, z: -10, scale: 0.45, hue: 0.05 },
        ];

        mushroomData.forEach((data, idx) => {
            // Create mushroom geometry - cap and stem
            const capGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
            const stemGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 6);

            // Bioluminescent material with emissive glow
            const glowColor = new THREE.Color().setHSL(data.hue, 0.8, 0.5);
            const emissiveColor = new THREE.Color().setHSL(data.hue, 0.9, 0.4);

            const capMat = new THREE.MeshStandardMaterial({
                color: glowColor,
                emissive: emissiveColor,
                emissiveIntensity: 1.5,
                roughness: 0.3,
                metalness: 0.1,
                transparent: true,
                opacity: 0.9,
            });

            const stemMat = new THREE.MeshStandardMaterial({
                color: 0x4a3a2a, // Warm brown stem
                emissive: emissiveColor,
                emissiveIntensity: 0.3,
                roughness: 0.8,
            });

            const cap = new THREE.Mesh(capGeo, capMat);
            cap.scale.y = 0.5; // Flatten the cap
            cap.position.y = 0.6;

            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.y = 0.3;

            // Group mushroom parts
            const mushroom = new THREE.Group();
            mushroom.add(cap);
            mushroom.add(stem);

            mushroom.position.set(data.x, -0.5, data.z);
            mushroom.scale.setScalar(data.scale);
            mushroom.rotation.y = Math.random() * Math.PI * 2;

            // Store for animation
            mushroom.userData = {
                baseEmissive: 1.5,
                phase: idx * 0.7,
                capMat: capMat,
            };

            this.mushrooms.push(mushroom);
            this.mainGroup.add(mushroom);

            // Add subtle point light for each mushroom
            const light = new THREE.PointLight(glowColor, 0.3, 8, 2);
            light.position.set(data.x, 0.5, data.z);
            this.mushroomLights.push(light);
            this.mainGroup.add(light);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAYERED SPRUCE TREES - InstancedMesh Optimization (2 draw calls vs 400+)
    // ═══════════════════════════════════════════════════════════════════════════

    createTrees() {
        // Layer configurations - trees arranged by depth (Firewatch-style layers)
        // BACK TREES: Far side of lake, all at z < -40
        const layers = [
            { count: 150, z: -42, height: 18, spacing: 3, colorIdx: 0, sway: 0.25 },   // Front tree line (dark, dense)
            { count: 140, z: -48, height: 22, spacing: 3.5, colorIdx: 0, sway: 0.22 }, // Dense dark layer
            { count: 130, z: -55, height: 26, spacing: 4, colorIdx: 1, sway: 0.20 },   // Mid layer
            { count: 120, z: -62, height: 30, spacing: 4.5, colorIdx: 2, sway: 0.18 }, // Mid-back
            { count: 100, z: -70, height: 35, spacing: 5, colorIdx: 3, sway: 0.15 },   // Back layer
            { count: 80, z: -80, height: 42, spacing: 6, colorIdx: 4, sway: 0.12 },    // Far back
            { count: 60, z: -92, height: 50, spacing: 8, colorIdx: 5, sway: 0.10 },    // Horizon
        ];

        // SIDE FRAMING TREES: Wrap around left and right edges of lake
        // These trees extend forward to frame the visible lake area
        const sideFramingTrees = [
            // LEFT SIDE - Trees coming forward along left edge
            { x: -140, z: 50, height: 22, colorIdx: 0 },
            { x: -145, z: 40, height: 26, colorIdx: 0 },
            { x: -135, z: 30, height: 20, colorIdx: 0 },
            { x: -150, z: 45, height: 28, colorIdx: 0 },
            { x: -140, z: 20, height: 24, colorIdx: 0 },
            { x: -155, z: 35, height: 30, colorIdx: 0 },
            { x: -145, z: 10, height: 22, colorIdx: 0 },
            { x: -160, z: 50, height: 32, colorIdx: 0 },
            { x: -135, z: 0, height: 20, colorIdx: 0 },
            { x: -150, z: -10, height: 25, colorIdx: 0 },
            { x: -140, z: -20, height: 23, colorIdx: 0 },
            { x: -155, z: -30, height: 27, colorIdx: 0 },
            // LEFT SHORE DENSE AREA (matching right side)
            // Smaller, closer trees for foreground density
            { x: -95, z: 25, height: 16, colorIdx: 0 },
            { x: -100, z: 18, height: 18, colorIdx: 0 },
            { x: -105, z: 10, height: 15, colorIdx: 0 },
            { x: -110, z: 22, height: 17, colorIdx: 0 },
            { x: -98, z: 5, height: 14, colorIdx: 0 },
            { x: -115, z: 15, height: 19, colorIdx: 0 },
            { x: -102, z: -5, height: 16, colorIdx: 0 },
            { x: -120, z: 8, height: 18, colorIdx: 0 },
            { x: -108, z: -12, height: 15, colorIdx: 0 },
            { x: -125, z: 0, height: 20, colorIdx: 0 },
            { x: -112, z: -20, height: 17, colorIdx: 0 },
            { x: -118, z: -28, height: 19, colorIdx: 0 },
            { x: -105, z: -35, height: 16, colorIdx: 0 },
            { x: -122, z: -38, height: 21, colorIdx: 0 },
            { x: -130, z: -25, height: 22, colorIdx: 0 },
            { x: -128, z: -15, height: 20, colorIdx: 0 },
            // RIGHT SIDE - Trees coming forward along right edge
            { x: 140, z: 48, height: 21, colorIdx: 0 },
            { x: 145, z: 38, height: 25, colorIdx: 0 },
            { x: 135, z: 28, height: 19, colorIdx: 0 },
            { x: 150, z: 42, height: 27, colorIdx: 0 },
            { x: 140, z: 18, height: 23, colorIdx: 0 },
            { x: 155, z: 32, height: 29, colorIdx: 0 },
            { x: 145, z: 8, height: 21, colorIdx: 0 },
            { x: 160, z: 48, height: 31, colorIdx: 0 },
            { x: 135, z: -2, height: 19, colorIdx: 0 },
            { x: 150, z: -12, height: 24, colorIdx: 0 },
            { x: 140, z: -22, height: 22, colorIdx: 0 },
            { x: 155, z: -32, height: 26, colorIdx: 0 },
            // RIGHT SHORE DENSE AREA (user's green marked region)
            // Smaller, closer trees for foreground density
            { x: 95, z: 25, height: 16, colorIdx: 0 },
            { x: 100, z: 18, height: 18, colorIdx: 0 },
            { x: 105, z: 10, height: 15, colorIdx: 0 },
            { x: 110, z: 22, height: 17, colorIdx: 0 },
            { x: 98, z: 5, height: 14, colorIdx: 0 },
            { x: 115, z: 15, height: 19, colorIdx: 0 },
            { x: 102, z: -5, height: 16, colorIdx: 0 },
            { x: 120, z: 8, height: 18, colorIdx: 0 },
            { x: 108, z: -12, height: 15, colorIdx: 0 },
            { x: 125, z: 0, height: 20, colorIdx: 0 },
            { x: 112, z: -20, height: 17, colorIdx: 0 },
            { x: 118, z: -28, height: 19, colorIdx: 0 },
            { x: 105, z: -35, height: 16, colorIdx: 0 },
            { x: 122, z: -38, height: 21, colorIdx: 0 },
            { x: 130, z: -25, height: 22, colorIdx: 0 },
            { x: 128, z: -15, height: 20, colorIdx: 0 },
        ];

        // Calculate total tree count (layers + side framing trees)
        const layerTreeCount = layers.reduce((sum, layer) => sum + layer.count, 0);
        const totalTreeCount = layerTreeCount + sideFramingTrees.length;
        console.log(`[SwedishForest] Creating ${totalTreeCount} trees(${layerTreeCount} layered + ${sideFramingTrees.length} side framing)`);

        // Generate ONE merged spruce geometry (foliage + trunk will be separate)
        const { foliageGeometry, trunkGeometry } = this.createMergedSpruceGeometry();

        // Create per-instance attribute arrays
        const instanceColors = new Float32Array(totalTreeCount * 3);
        const instanceSways = new Float32Array(totalTreeCount);
        const instancePhases = new Float32Array(totalTreeCount);
        const trunkColors = new Float32Array(totalTreeCount * 3);

        // Create instanced meshes
        const foliageMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uGlowIntensity: this.uniforms.glowIntensity,
            },
            vertexShader: instancedFoliageVertexShader,
            fragmentShader: instancedFoliageFragmentShader,
            side: THREE.DoubleSide,
        });

        const trunkMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uGlowIntensity: this.uniforms.glowIntensity,
            },
            vertexShader: instancedTrunkVertexShader,
            fragmentShader: instancedTrunkFragmentShader,
        });

        this.foliageInstancedMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, totalTreeCount);
        this.trunkInstancedMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTreeCount);

        // Set up transforms and per-instance data
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        let instanceIdx = 0;

        layers.forEach((layer) => {
            // Use layer.colorIdx to look up color (allows multiple layers to share colors)
            const treeColor = COLORS.treeLayers[layer.colorIdx];
            const trunkColor = COLORS.trunkLayers[layer.colorIdx];

            for (let i = 0; i < layer.count; i++) {
                const x = (i - layer.count / 2) * layer.spacing + (Math.random() - 0.5) * 5;
                const z = layer.z + (Math.random() - 0.5) * 3;
                const y = 0;

                // Random scale variation
                const scaleVal = 0.7 + Math.random() * 0.5;
                const heightScale = layer.height / 20; // Normalize to base height of 20

                position.set(x, y, z);
                quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.2);

                // ─────────────────────────────────────────────────────────────
                // LAKE CLEARING LOGIC (ellipse-based)
                // Clear trees inside the elliptical lake zone, but keep trees behind
                // Reduced size to allow more trees around lake edges (Firewatch style)
                // ─────────────────────────────────────────────────────────────
                const lakeCenter = { x: 0, z: -15 };  // Moved center forward slightly
                const lakeRadiusX = 90;   // Reduced from 130 for denser tree framing
                const lakeRadiusZ = 35;   // Reduced from 50

                // Ellipse distance formula
                const dx = (x - lakeCenter.x) / lakeRadiusX;
                const dz = (z - lakeCenter.z) / lakeRadiusZ;
                const ellipseDist = dx * dx + dz * dz;

                // STRICTLY clear everything inside the lake water area
                const inLakeZone = ellipseDist < 1.0;

                if (inLakeZone) {
                    scale.set(0, 0, 0); // Hide tree
                } else {
                    scale.set(scaleVal, scaleVal * heightScale, scaleVal);
                }

                matrix.compose(position, quaternion, scale);
                this.foliageInstancedMesh.setMatrixAt(instanceIdx, matrix);
                this.trunkInstancedMesh.setMatrixAt(instanceIdx, matrix);

                // Per-instance color (foliage)
                instanceColors[instanceIdx * 3] = treeColor.r;
                instanceColors[instanceIdx * 3 + 1] = treeColor.g;
                instanceColors[instanceIdx * 3 + 2] = treeColor.b;

                // Per-instance trunk color
                trunkColors[instanceIdx * 3] = trunkColor.r;
                trunkColors[instanceIdx * 3 + 1] = trunkColor.g;
                trunkColors[instanceIdx * 3 + 2] = trunkColor.b;

                // Per-instance sway amount
                instanceSways[instanceIdx] = layer.sway;

                // Per-instance random phase for wind variation
                instancePhases[instanceIdx] = Math.random() * Math.PI * 2;

                instanceIdx++;
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // SIDE FRAMING TREES - Place trees at specific positions along lake edges
        // These create the visual "forest wrapping around the lake" effect
        // ─────────────────────────────────────────────────────────────────────
        const darkestTreeColor = COLORS.treeLayers[0]; // Use darkest color for foreground trees
        const darkestTrunkColor = COLORS.trunkLayers[0];

        sideFramingTrees.forEach((tree) => {
            const x = tree.x + (Math.random() - 0.5) * 5;
            const z = tree.z + (Math.random() - 0.5) * 3;
            const y = 0;

            // Scale based on height
            const scaleVal = 0.8 + Math.random() * 0.4;
            const heightScale = tree.height / 20;

            position.set(x, y, z);
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.3);
            scale.set(scaleVal, scaleVal * heightScale, scaleVal);

            matrix.compose(position, quaternion, scale);
            this.foliageInstancedMesh.setMatrixAt(instanceIdx, matrix);
            this.trunkInstancedMesh.setMatrixAt(instanceIdx, matrix);

            // Use darkest color for foreground framing trees
            instanceColors[instanceIdx * 3] = darkestTreeColor.r;
            instanceColors[instanceIdx * 3 + 1] = darkestTreeColor.g;
            instanceColors[instanceIdx * 3 + 2] = darkestTreeColor.b;

            trunkColors[instanceIdx * 3] = darkestTrunkColor.r;
            trunkColors[instanceIdx * 3 + 1] = darkestTrunkColor.g;
            trunkColors[instanceIdx * 3 + 2] = darkestTrunkColor.b;

            instanceSways[instanceIdx] = 0.20; // Moderate sway
            instancePhases[instanceIdx] = Math.random() * Math.PI * 2;

            instanceIdx++;
        });

        // Set up instanced buffer attributes
        foliageGeometry.setAttribute('aInstanceColor',
            new THREE.InstancedBufferAttribute(instanceColors, 3));
        foliageGeometry.setAttribute('aInstanceSway',
            new THREE.InstancedBufferAttribute(instanceSways, 1));
        foliageGeometry.setAttribute('aInstancePhase',
            new THREE.InstancedBufferAttribute(instancePhases, 1));

        trunkGeometry.setAttribute('aInstanceColor',
            new THREE.InstancedBufferAttribute(trunkColors, 3));

        this.foliageInstancedMesh.instanceMatrix.needsUpdate = true;
        this.trunkInstancedMesh.instanceMatrix.needsUpdate = true;

        this.mainGroup.add(this.trunkInstancedMesh);
        this.mainGroup.add(this.foliageInstancedMesh);

        console.log(`[SwedishForest] Trees created: ${totalTreeCount} instances(2 draw calls)`);
    }

    /**
     * Create a merged spruce tree geometry with all foliage layers combined
     * This geometry is shared across all instances
     */
    createMergedSpruceGeometry() {
        const foliageLayers = [];
        const numLayers = 5;  // 5 layers of cones
        const baseHeight = 20; // Normalized base height
        const trunkHeight = baseHeight * 0.15;
        const maxRadius = baseHeight * 0.25; // Base width of the widest cone

        // Create foliage layers (Cones)
        for (let j = 0; j < numLayers; j++) {
            // Tapering logic: Bottom layer is widest, top is narrowest
            const layerProgress = j / (numLayers - 1); // 0 at bottom, 1 at top

            const bottomRadius = maxRadius * (1.0 - layerProgress * 0.8);
            const coneHeight = (baseHeight / numLayers) * 1.8; // Overlap layers

            // Position: Stack them up
            const y = trunkHeight + (j * (baseHeight * 0.85 / numLayers));

            // Create 3D Cone for this layer
            // radialSegments: 7 for a nice low-poly geometric look, or 16 for smooth
            const geometry = new THREE.ConeGeometry(bottomRadius, coneHeight, 7);

            // Translate to correct position (Cone origin is at center)
            geometry.translate(0, y + coneHeight / 2, 0);

            foliageLayers.push(geometry);
        }

        // Merge all foliage layers into one geometry
        const foliageGeometry = BufferGeometryUtils.mergeGeometries(foliageLayers, false);

        // Compute normals for proper 3D lighting
        foliageGeometry.computeVertexNormals();

        // Create trunk geometry (cylinder)
        const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.4, trunkHeight, 6);
        trunkGeometry.translate(0, trunkHeight / 2, 0);
        trunkGeometry.computeVertexNormals();

        // Clean up individual layer geometries
        foliageLayers.forEach(geo => geo.dispose());

        return { foliageGeometry, trunkGeometry };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MIST LAYERS - Atmospheric ground fog
    // ═══════════════════════════════════════════════════════════════════════════

    createMistLayers() {
        const mistConfigs = [
            { y: 2, z: 8, width: 300, height: 10, density: 0.35 },    // Much wider mist layers
            { y: 4, z: -8, width: 320, height: 14, density: 0.3 },
            { y: 6, z: -22, width: 350, height: 18, density: 0.25 },
        ];

        for (const config of mistConfigs) {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uDensity: { value: config.density },
                    uMistColor: { value: COLORS.mist },
                    uIntensity: this.uniforms.mistIntensity,
                },
                vertexShader: mistVertexShader,
                fragmentShader: mistFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, config.y, config.z);
            mist.rotation.x = -0.15;

            this.mistPlanes.push(mist);
            this.mainGroup.add(mist);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOD RAYS - Warm golden light beams from sun through trees
    // ═══════════════════════════════════════════════════════════════════════════

    createGodRays() {
        const rayCount = 24; // Denser, more dramatic god rays

        for (let i = 0; i < rayCount; i++) {
            const isHero = i % 5 === 0;
            const width = (isHero ? 10 : 5) + Math.random() * (isHero ? 10 : 9);
            const height = (isHero ? 80 : 60) + Math.random() * (isHero ? 55 : 40);

            const geometry = new THREE.PlaneGeometry(width, height);
            geometry.translate(0, -height * 0.5, 0); // Anchor ray top at origin (sun position)

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: (isHero ? 0.22 : 0.14) + Math.random() * (isHero ? 0.18 : 0.12) },
                    uRayWidth: { value: (isHero ? 0.24 : 0.16) + Math.random() * (isHero ? 0.1 : 0.1) },
                    uRayStrength: { value: (isHero ? 1.25 : 0.85) + Math.random() * (isHero ? 0.35 : 0.35) },
                    uSeed: { value: Math.random() * 10.0 },
                    uRayColor: { value: COLORS.godRay },
                },
                vertexShader: godRayVertexShader,
                fragmentShader: godRayFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const ray = new THREE.Mesh(geometry, material);

            // Position rays to fan out from sun position
            const angleSpread = (i / (rayCount - 1) - 0.5) * 0.9;
            const sunX = this.sunPosition.x;
            const sunY = this.sunPosition.y;
            const sunZ = this.sunPosition.z;

            const originRadius = isHero ? 18 : 12;
            const offsetX = Math.sin(angleSpread * Math.PI) * (isHero ? 10 : 6) + (Math.random() - 0.5) * originRadius;
            const offsetY = (Math.random() - 0.5) * originRadius * 0.45 + Math.random() * 2.0;
            const offsetZ = (Math.random() - 0.5) * 10 + 6;

            ray.position.set(
                sunX + offsetX,
                sunY + offsetY,
                sunZ + offsetZ
            );

            const baseRotZ = angleSpread * 0.6 + (Math.random() - 0.5) * 0.12;
            const baseRotY = angleSpread * 0.25 + (Math.random() - 0.5) * 0.08;
            const baseRotX = -0.32 + Math.random() * 0.1;
            ray.rotation.set(baseRotX, baseRotY, baseRotZ);

            ray.userData = {
                offsetX,
                offsetY,
                offsetZ,
                baseRotX,
                baseRotY,
                baseRotZ,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: 0.2 + Math.random() * 0.15,
            };

            this.godRays.push(ray);
            this.mainGroup.add(ray);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIREFLIES - Glowing particle system
    // ═══════════════════════════════════════════════════════════════════════════

    createFireflySystem() {
        // Many fireflies distributed across scene INCLUDING deep in forest between trees
        const fireflyCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(fireflyCount * 3);
        const randoms = new Float32Array(fireflyCount);
        const phases = new Float32Array(fireflyCount);
        const velocities = new Float32Array(fireflyCount * 3);

        for (let i = 0; i < fireflyCount; i++) {
            const i3 = i * 3;

            // Distribute evenly across the FULL scene width
            // Grid covers more width and depth
            const gridX = (i % 20) / 19;  // 0 to 1 across 20 columns
            const gridZ = Math.floor(i / 20) / 9;  // 0 to 1 across 10 rows

            // Add randomness to grid positions for natural look
            const randOffsetX = (Math.random() - 0.5) * 25;
            const randOffsetZ = (Math.random() - 0.5) * 18;

            // Map to scene coordinates - extend deeper and WIDER
            // Width: 500 units (-250 to +250)
            positions[i3] = -250 + gridX * 500 + randOffsetX;     // x: -250 to +250
            positions[i3 + 1] = 1 + Math.random() * 30;           // y: 1 to 31
            positions[i3 + 2] = -120 + gridZ * 140 + randOffsetZ; // z: -120 to +20

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;

            // Gentle local movement (won't drift far from starting position)
            velocities[i3] = (Math.random() - 0.5) * 0.4;     // Gentle X drift
            velocities[i3 + 1] = (Math.random() - 0.5) * 0.15; // Very gentle Y
            velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;  // Gentle Z drift
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 5.0 }, // Slightly larger for visibility across scene
                uBoost: { value: 0.0 }, // Boost from piece lock effect
            },
            vertexShader: fireflyVertexShader,
            fragmentShader: fireflyFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.fireflySystem = new THREE.Points(geometry, material);
        this.mainGroup.add(this.fireflySystem);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREST SPIRITS - Ethereal orbs spread across the entire scene
    // ═══════════════════════════════════════════════════════════════════════════

    createForestSpirits() {
        // More spirits distributed across the entire scene, deep in forest and high in sky
        const spiritCount = 45;

        for (let i = 0; i < spiritCount; i++) {
            // Varied sizes - some small, some larger
            const size = 0.8 + Math.random() * 2.5;
            const geometry = new THREE.PlaneGeometry(size, size);

            // Vary hue for each spirit - warm amber/golden for sunset
            const hueShift = (Math.random() - 0.5) * 0.1;
            const spiritColor = new THREE.Color().setHSL(
                0.08 + hueShift, // Warm amber hue
                0.8 + Math.random() * 0.15,
                0.6 + Math.random() * 0.15
            );

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.25 + Math.random() * 0.3 },
                    uSpiritColor: { value: spiritColor },
                },
                vertexShader: spiritVertexShader,
                fragmentShader: spiritFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const spirit = new THREE.Mesh(geometry, material);

            // Spread across FULL scene width and height
            spirit.position.set(
                (Math.random() - 0.5) * 500,    // Very wide horizontal spread (-250 to 250)
                3 + Math.random() * 52,         // From near ground to high above canopy
                -120 + Math.random() * 140      // Deep forest (-120) to lake (+20)
            );

            spirit.userData = {
                basePosition: spirit.position.clone(),
                targetX: spirit.position.x,
                targetY: spirit.position.y,
                velocity: new THREE.Vector2(0, 0),
                wanderPhase: Math.random() * 100,
                wanderSpeed: 0.3 + Math.random() * 0.4, // Varied wander speeds
            };

            spirit.lookAt(this.camera.position);

            this.spirits.push(spirit);
            this.mainGroup.add(spirit);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA BOREALIS - Combo effect in sky
    // ═══════════════════════════════════════════════════════════════════════════

    createAuroraLayers() {
        const auroraConfigs = [
            { offset: 0, color1: COLORS.aurora1, color2: COLORS.aurora2, color3: COLORS.aurora3 },
            { offset: 1.5, color1: COLORS.aurora2, color2: COLORS.aurora3, color3: COLORS.aurora1 },
            { offset: 3.0, color1: COLORS.aurora3, color2: COLORS.aurora1, color3: COLORS.aurora2 },
        ];

        for (const config of auroraConfigs) {
            const geometry = new THREE.PlaneGeometry(150, 30, 32, 8);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uIntensity: this.uniforms.auroraIntensity,
                    uColor1: { value: config.color1 },
                    uColor2: { value: config.color2 },
                    uColor3: { value: config.color3 },
                    uOffset: { value: config.offset },
                },
                vertexShader: auroraVertexShader,
                fragmentShader: auroraFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const aurora = new THREE.Mesh(geometry, material);
            aurora.position.set(0, 45 + config.offset * 4, -80);
            aurora.rotation.x = 0.25;

            this.auroraPlanes.push(aurora);
            this.mainGroup.add(aurora);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPIRIT WINDS - Flowing energy ribbons
    // ═══════════════════════════════════════════════════════════════════════════

    createSpiritWinds() {
        // More wind ribbons spread across the entire scene, moving slowly
        const windCount = 12;

        for (let i = 0; i < windCount; i++) {
            const width = 80 + Math.random() * 50;  // Wider ribbons
            const height = 2.0 + Math.random() * 2.5;

            const geometry = new THREE.PlaneGeometry(width, height, 48, 2);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.18 + Math.random() * 0.12 }, // Slightly varied opacity
                    uWindColor: { value: COLORS.windColor },
                    uOffset: { value: i * 1.5 },
                },
                vertexShader: spiritWindVertexShader,
                fragmentShader: spiritWindFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const wind = new THREE.Mesh(geometry, material);

            // Spread across entire scene width and depth
            wind.position.set(
                (Math.random() - 0.5) * 500,     // Full scene width (-250 to 250)
                3 + Math.random() * 25,          // Various heights from low to high
                -60 + Math.random() * 100        // Deep into scene and near camera
            );
            wind.rotation.z = (Math.random() - 0.5) * 0.15;
            wind.rotation.y = (Math.random() - 0.5) * 0.1; // Slight angle variation

            wind.userData = {
                baseX: wind.position.x,
                speed: 0.15 + Math.random() * 0.2,  // SLOWER speed (was 0.6-0.9)
                verticalDrift: (Math.random() - 0.5) * 0.02, // Gentle vertical movement
            };

            this.spiritWinds.push(wind);
            this.mainGroup.add(wind);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FALLING LEAVES
    // ═══════════════════════════════════════════════════════════════════════════

    createFallingLeavesSystem() {
        const maxLeaves = 50;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(maxLeaves * 3);
        const randoms = new Float32Array(maxLeaves);
        const phases = new Float32Array(maxLeaves);
        const velocities = new Float32Array(maxLeaves * 3);
        const rotations = new Float32Array(maxLeaves);

        for (let i = 0; i < maxLeaves; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 60;
            positions[i3 + 1] = 60 + Math.random() * 20;
            positions[i3 + 2] = -10 - Math.random() * 30;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;

            velocities[i3] = (Math.random() - 0.5) * 0.3;
            velocities[i3 + 1] = 1.5 + Math.random() * 1.0;
            velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;

            rotations[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aRotation', new THREE.BufferAttribute(rotations, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 10.0 },
            },
            vertexShader: leafVertexShader,
            fragmentShader: leafFragmentShader,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
        });

        this.fallingLeaves = new THREE.Points(geometry, material);
        this.fallingLeaves.userData = {
            activeLeaves: 0,
            startTime: 0,
        };
        this.mainGroup.add(this.fallingLeaves);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING - Warm sunset atmosphere
    // ═══════════════════════════════════════════════════════════════════════════

    setupLighting() {
        // Warm sunset ambient
        const ambient = new THREE.AmbientLight(0x3A2010, 0.4);
        this.scene.add(ambient);

        // Sunset directional light from sun position
        const sunLight = new THREE.DirectionalLight(0xFFAA44, 0.7);
        sunLight.position.set(0, 30, -60);
        this.scene.add(sunLight);

        // Warm rim light for tree silhouette edges
        const rimLight = new THREE.DirectionalLight(0xFF8833, 0.4);
        rimLight.position.set(-30, 15, 20);
        this.scene.add(rimLight);

        // Hemisphere light - warm sky to warm ground
        const hemiLight = new THREE.HemisphereLight(
            0xFF8844,  // Sky - warm orange
            0x2A1A0A,  // Ground - dark warm brown
            0.5
        );
        this.scene.add(hemiLight);

        // Warm point light for spirit/effect glow
        const spiritGlow = new THREE.PointLight(0xFFAA66, 0.5, 50);
        spiritGlow.position.set(0, 10, -15);
        this.mainGroup.add(spiritGlow);
        this.spiritLight = spiritGlow;

        // Floor illumination light - warm tones
        const floorLight = new THREE.DirectionalLight(0xAA7744, 0.5);
        floorLight.position.set(0, 30, 10);
        floorLight.target.position.set(0, 0, -20);
        this.scene.add(floorLight);
        this.scene.add(floorLight.target);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMEPLAY EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount || 0);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        this.targetGlowIntensity = Math.min(lineCount * 0.35, 1.0);
        this.targetMistIntensity = Math.min(0.6 + lineCount * 0.12, 1.0);

        this.spawnLeaves(lineCount * 4);

        this.spirits.forEach(spirit => {
            spirit.userData.velocity.x += (Math.random() - 0.5) * 2.5;
            spirit.userData.velocity.y += (Math.random() - 0.5) * 2.5;
            spirit.material.uniforms.uOpacity.value = Math.min(
                spirit.material.uniforms.uOpacity.value + 0.25,
                0.95
            );
        });

        // Boost spirit light
        if (this.spiritLight) {
            this.spiritLight.intensity = 0.8 + lineCount * 0.2;
        }
    }

    onCombo(comboCount) {
        if (comboCount < 1) return;

        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.targetGlowIntensity = Math.min(comboCount * 0.3, 1.0);
        this.targetWindSpeed = Math.min(comboCount * 0.012, 0.06);

        if (comboCount >= 3) {
            this.targetAuroraIntensity = Math.min(comboCount * 0.18, 0.9);
        }

        if (this.comboMultiplier > 1.5) {
            const centerX = 0;
            const centerY = 12;
            this.spirits.forEach(spirit => {
                spirit.userData.velocity.x += (centerX - spirit.position.x) * 0.012 * this.comboMultiplier;
                spirit.userData.velocity.y += (centerY - spirit.position.y) * 0.012 * this.comboMultiplier;
            });
        }

        // Boost fireflies based on combo count (stronger boost for higher combos)
        if (this.fireflySystem && this.fireflySystem.material.uniforms.uBoost) {
            const boostAmount = Math.min(0.5 + comboCount * 0.25, 1.0);
            this.fireflySystem.material.uniforms.uBoost.value = boostAmount;
        }
    }

    onPieceLock(data) {
        this.targetGlowIntensity += 0.1;
        this.mushroomPulse = 1.5; // Strong pulse on lock

        this.spirits.forEach(spirit => {
            spirit.material.uniforms.uOpacity.value += 0.06;
        });

        // Boost fireflies to twinkle and shine
        if (this.fireflySystem && this.fireflySystem.material.uniforms.uBoost) {
            this.fireflySystem.material.uniforms.uBoost.value = 1.0;
        }
    }

    spawnLeaves(count) {
        if (!this.fallingLeaves) return;

        const positions = this.fallingLeaves.geometry.attributes.position.array;
        const start = this.fallingLeaves.userData.activeLeaves;
        const maxLeaves = positions.length / 3;

        this.fallingLeaves.userData.startTime = this.uniforms.time.value;
        this.fallingLeaves.material.uniforms.uTime.value = 0;

        for (let i = 0; i < count && (start + i) < maxLeaves; i++) {
            const idx = ((start + i) % maxLeaves) * 3;
            positions[idx] = (Math.random() - 0.5) * 70;
            positions[idx + 1] = 45 + Math.random() * 15;
            positions[idx + 2] = -8 - Math.random() * 35;
        }

        this.fallingLeaves.geometry.attributes.position.needsUpdate = true;
        this.fallingLeaves.userData.activeLeaves = Math.min(start + count, maxLeaves);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // Update Water Waves (slowed down for calmer, more serene look)
        if (this.lakeMesh && this.lakeMesh.material.uniforms['time']) {
            this.lakeMesh.material.uniforms['time'].value += delta * 0.25;
        }

        // Update Shore Foam animation
        if (this.shoreFoamMesh && this.shoreFoamMesh.material.uniforms['time']) {
            this.shoreFoamMesh.material.uniforms['time'].value = elapsed;
        }

        // ─────────────────────────────────────────────────────────────────────
        // SMOOTH EFFECT TRANSITIONS
        // ─────────────────────────────────────────────────────────────────────

        this.uniforms.glowIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.glowIntensity.value,
            this.targetGlowIntensity,
            delta * 3
        );
        this.targetGlowIntensity *= 0.95;

        this.uniforms.mistIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.mistIntensity.value,
            this.targetMistIntensity,
            delta * 2
        );
        if (this.targetMistIntensity > 0.6) {
            this.targetMistIntensity -= delta * 0.04;
        }

        this.uniforms.auroraIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.auroraIntensity.value,
            this.targetAuroraIntensity,
            delta * 2
        );
        this.targetAuroraIntensity *= 0.97;

        this.uniforms.windSpeed.value = THREE.MathUtils.lerp(
            this.uniforms.windSpeed.value,
            this.targetWindSpeed,
            delta * 2
        );
        this.targetWindSpeed *= 0.96;

        this.comboMultiplier = Math.max(1, this.comboMultiplier - delta * 0.25);

        // Spirit light decay
        if (this.spiritLight && this.spiritLight.intensity > 0.4) {
            this.spiritLight.intensity -= delta * 0.2;
        }

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP DRIFT - very subtle
        // ─────────────────────────────────────────────────────────────────────

        const driftTime = elapsed * 0.025;
        this.mainGroup.position.x = Math.sin(driftTime) * 0.4;
        this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.15;
        this.mainGroup.rotation.y = Math.sin(driftTime * 0.5) * 0.005;

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA EXPLORATORY MOVEMENT - wandering through the forest
        // Different random path every time theme starts
        // ─────────────────────────────────────────────────────────────────────

        const ro = this.cameraRandomOffsets;  // Random offsets
        const camTime = elapsed * 0.05 * ro.speedMult;  // Randomized exploration pace
        const baseX = 0;
        const baseY = 8;
        const baseZ = 30;

        // Exploratory camera position - uses random phase offsets for unique movement each time
        this.camera.position.x = baseX +
            Math.sin(camTime * 1.0 + ro.posX1) * 15.0 +
            Math.sin(camTime * 0.37 + ro.posX2) * 8.0 +
            Math.cos(camTime * 0.71 + ro.posX3) * 5.0;
        this.camera.position.y = baseY + Math.sin(camTime * 0.43 + ro.posY) * 2.0;
        this.camera.position.z = baseZ +
            Math.cos(camTime * 0.31 + ro.posZ1) * 4.0 +
            Math.sin(camTime * 0.53 + ro.posZ2) * 2.0;

        // Look target wanders independently with random offsets
        const lookX = Math.sin(camTime * 0.47 + ro.lookX1) * 20.0 + Math.cos(camTime * 0.29 + ro.lookX2) * 10.0;
        const lookY = 12 + Math.cos(camTime * 0.23 + ro.lookY) * 4.0;
        this.camera.lookAt(lookX, lookY, -30);

        // ─────────────────────────────────────────────────────────────────────
        // SUN MOVEMENT - Slow rise/fall with gentle pulse
        // ─────────────────────────────────────────────────────────────────────

        if (this.sun) {
            // Slow vertical oscillation (like sun slowly setting/rising)
            const sunTime = elapsed * 0.02;
            const sunY = this.sunBaseY + Math.sin(sunTime) * 3.0;
            const sunX = Math.sin(sunTime * 0.3) * 2.0;

            this.sun.position.y = sunY;
            this.sun.position.x = sunX;

            // Update glow layers to follow sun
            this.sunGlowLayers.forEach(sprite => {
                sprite.position.y = sunY;
                sprite.position.x = sunX;
            });

            // Update Lens Flares - position along camera-to-sun axis
            if (this.lensFlares && this.lensFlares.length > 0) {
                const sunScreenPos = this.sun.position.clone();
                const cameraPos = this.camera.position.clone();

                // Calculate direction from sun to camera
                const sunToCam = cameraPos.clone().sub(sunScreenPos);

                // Check if sun is roughly in front of camera (dot product > 0 means behind)
                const cameraDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                const toSun = sunScreenPos.clone().sub(cameraPos).normalize();
                const sunVisibility = Math.max(0, cameraDir.dot(toSun));

                this.lensFlares.forEach(flare => {
                    // Position flare along sun-to-camera axis
                    const offset = flare.userData.offset;
                    const flarePos = sunScreenPos.clone().add(sunToCam.clone().multiplyScalar(offset));
                    flare.position.copy(flarePos);

                    // Make flare always face camera (billboarding)
                    flare.quaternion.copy(this.camera.quaternion);

                    // Intermittent flicker - simulates sun peeking through tree gaps
                    const flickerPhase = flare.userData.flickerPhase;
                    const flickerSpeed = flare.userData.flickerSpeed;

                    // Multi-frequency flicker for organic light-through-trees effect
                    const flicker1 = Math.sin(elapsed * flickerSpeed + flickerPhase);
                    const flicker2 = Math.sin(elapsed * flickerSpeed * 0.37 + flickerPhase * 1.7);
                    const flicker3 = Math.sin(elapsed * flickerSpeed * 0.61 + flickerPhase * 2.3);

                    // Combine flickers - creates irregular on/off pattern
                    let flickerIntensity = (flicker1 + flicker2 * 0.5 + flicker3 * 0.3) / 1.8;
                    // Sharpen the flicker - mostly off, occasionally bright
                    flickerIntensity = Math.pow(Math.max(0, flickerIntensity), 2.5);

                    // Only show when camera is mostly facing sun AND flickering is active
                    const baseOpacity = flare.userData.baseOpacity;
                    const viewFactor = Math.pow(sunVisibility, 2.0); // Sharper falloff when not looking at sun
                    flare.material.uniforms.uOpacity.value = baseOpacity * viewFactor * flickerIntensity;
                });
            }

            // Subtle pulse on sun intensity
            const pulse = 1.0 + Math.sin(elapsed * 0.8) * 0.05;
            if (this.sun.material.uniforms?.uIntensity) {
                this.sun.material.uniforms.uIntensity.value = pulse;
            }

            // Update Realistic Water Reflection
            if (this.lakeMesh && this.lakeMesh.material.uniforms['sunDirection']) {
                this.lakeMesh.material.uniforms['sunDirection'].value.copy(this.sun.position).normalize();
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // GOD RAY SWAY
        // ─────────────────────────────────────────────────────────────────────

        const sunPos = this.sun ? this.sun.position : this.sunPosition;
        this.godRays.forEach(ray => {
            const sway = Math.sin(elapsed * ray.userData.swaySpeed + ray.userData.swayPhase);
            const swayX = sway * 1.2;
            const swayY = Math.sin(elapsed * ray.userData.swaySpeed * 0.7 + ray.userData.swayPhase) * 0.35;

            ray.position.x = sunPos.x + ray.userData.offsetX + swayX;
            ray.position.y = sunPos.y + ray.userData.offsetY + swayY;
            ray.position.z = sunPos.z + ray.userData.offsetZ;

            ray.rotation.z = ray.userData.baseRotZ + sway * 0.02;
            ray.rotation.y = ray.userData.baseRotY + sway * 0.01;
        });

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT MOVEMENT
        // ─────────────────────────────────────────────────────────────────────

        this.spirits.forEach(spirit => {
            spirit.userData.wanderPhase += delta * 0.4;

            spirit.userData.targetX += Math.cos(spirit.userData.wanderPhase) * 0.08;
            spirit.userData.targetY += Math.sin(spirit.userData.wanderPhase * 1.3) * 0.04;

            const dx = spirit.userData.targetX - spirit.position.x;
            const dy = spirit.userData.targetY - spirit.position.y;
            spirit.userData.velocity.x += dx * 0.0015;
            spirit.userData.velocity.y += dy * 0.0015;

            spirit.userData.velocity.x *= 0.97;
            spirit.userData.velocity.y *= 0.97;

            spirit.position.x += spirit.userData.velocity.x;
            spirit.position.y += spirit.userData.velocity.y;

            spirit.material.uniforms.uOpacity.value *= 0.997;
            if (spirit.material.uniforms.uOpacity.value < 0.25) {
                spirit.material.uniforms.uOpacity.value = 0.25;
            }

            spirit.lookAt(this.camera.position);
        });

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT WIND MOVEMENT
        // ─────────────────────────────────────────────────────────────────────

        this.spiritWinds.forEach(wind => {
            // Slower, more graceful movement
            wind.position.x += wind.userData.speed * (1 + this.uniforms.windSpeed.value * 8);

            // Add gentle vertical drift
            if (wind.userData.verticalDrift) {
                wind.position.y += Math.sin(elapsed * 0.3 + wind.userData.baseX) * wind.userData.verticalDrift;
            }

            // Wrap around when reaching edge - wider range for full scene coverage
            if (wind.position.x > 150) {
                wind.position.x = -150;
                wind.position.y = 3 + Math.random() * 25;
                wind.position.z = -60 + Math.random() * 100;
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // FALLING LEAVES UPDATE
        // ─────────────────────────────────────────────────────────────────────

        if (this.fallingLeaves && this.fallingLeaves.userData.startTime > 0) {
            const leafTime = elapsed - this.fallingLeaves.userData.startTime;
            this.fallingLeaves.material.uniforms.uTime.value = leafTime;

            if (leafTime > 18) {
                this.fallingLeaves.userData.startTime = 0;
                this.fallingLeaves.userData.activeLeaves = 0;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // GRASS ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        if (this.groundMaterial && this.groundMaterial.uniforms) {
            this.groundMaterial.uniforms.uTime.value = elapsed;
            this.groundMaterial.uniforms.uGlowIntensity.value = this.uniforms.glowIntensity.value;
        }

        if (this.grassMaterial) {
            this.grassMaterial.uniforms.uTime.value = elapsed;
            // Subtle spirit glow triggered by combo effects
            this.grassMaterial.uniforms.uSpiritGlow.value = THREE.MathUtils.lerp(
                this.grassMaterial.uniforms.uSpiritGlow.value,
                this.uniforms.glowIntensity.value,
                delta * 2
            );
        }

        // ─────────────────────────────────────────────────────────────────────
        // MUSHROOM GLOW ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        // Decay pulse
        this.mushroomPulse *= 0.92;
        if (this.mushroomPulse < 0.01) this.mushroomPulse = 0;

        // Decay firefly boost for piece lock twinkle effect
        if (this.fireflySystem && this.fireflySystem.material.uniforms.uBoost) {
            const boost = this.fireflySystem.material.uniforms.uBoost;
            boost.value *= 0.94; // Smooth decay
            if (boost.value < 0.01) boost.value = 0;
        }

        this.mushrooms.forEach((mushroom, idx) => {
            if (mushroom.userData.capMat) {
                // Pulsing glow effect + Piece Lock Pulse
                const pulse = Math.sin(elapsed * 1.5 + mushroom.userData.phase) * 0.3 + 1.0;
                const comboBoost = 1 + this.uniforms.glowIntensity.value * 2;
                const lockBoost = 1 + this.mushroomPulse * 2.0; // Strong boost from lock

                mushroom.userData.capMat.emissiveIntensity = mushroom.userData.baseEmissive * pulse * comboBoost * lockBoost;
            }
        });

        // Mushroom lights also pulse
        this.mushroomLights.forEach((light, idx) => {
            const pulse = Math.sin(elapsed * 1.5 + idx * 0.7) * 0.15 + 0.3;
            const lockBoost = 1 + this.mushroomPulse * 3.0;
            light.intensity = pulse * (1 + this.uniforms.glowIntensity.value * 1.5) * lockBoost;
        });

        // ─────────────────────────────────────────────────────────────────────
        // RENDER
        // ─────────────────────────────────────────────────────────────────────

        this.renderer.render(this.scene, this.camera);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WINDOW RESIZE
    // ═══════════════════════════════════════════════════════════════════════════

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        if (this.resolutionMode === 'fixed' && this.targetResolution) {
            // FORCE pixel ratio to 1 to ensure we actually render at the requested resolution
            this.renderer.setPixelRatio(1);
            this.renderer.setSize(this.targetResolution.width, this.targetResolution.height, false);

            // We must set the DOM element size to window size (CSS handles this, but ThreeJS might set explicit style)
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
        } else {
            // Auto mode: Use native DPR for crispness
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    setInternalResolution(width, height, mode = 'auto') {
        console.log(`[SwedishForest] Setting internal resolution: ${width}x${height} (${mode})`);
        this.targetResolution = { width, height };
        this.resolutionMode = mode;
        this.onWindowResize(); // Apply changes
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════

    stop() {
        super.stop();

        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        window.removeEventListener('resize', this.onWindowResize.bind(this));
        window.removeEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('swedish-forest-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.scene) {
            this.scene.traverse((object) => {
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
        this.foliageInstancedMesh = null;
        this.trunkInstancedMesh = null;
        this.groundPlane = null;
        this.starfield = null;
        this.mistPlanes = [];
        this.godRays = [];
        this.fireflySystem = null;
        this.spirits = [];
        this.auroraPlanes = [];
        this.spiritWinds = [];
        this.fallingLeaves = null;
        this.spiritLight = null;
        this.sun = null;
        this.sunGlowLayers = [];
        this.dustMotes = null;
        this.mountains = [];
        this.hazeLayers = [];
        this.foregroundBranches = [];
        this.silhouetteMountain = null;
        this.silhouetteMountainMaterial = null;
    }
}
