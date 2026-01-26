/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ NEON DISTRICT ✧
 *  A 3D Cyberpunk Blade Runner-Style Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Immersive street-level view surrounded by towering neon-lit megastructures.
 * Features:
 * - Procedural cyberpunk buildings with neon signage
 * - Street-level camera perspective looking up at towers
 * - Rain particle system
 * - Atmospheric fog (purple/blue)
 * - Colored neon lighting
 * - Post-processing with heavy bloom
 *
 * Inspired by Blade Runner and the SynthCity reference.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { NEON_DISTRICT_TETROMINOS } from './neon-district-tetrominos.js';
import {
    NeonDistrictAssets,
    NEON_DISTRICT_STAR_VERTEX_SHADER,
    NEON_DISTRICT_STAR_FRAGMENT_SHADER,
} from './neon-district-assets.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets - Balanced: visible window glow without blow-out
const QUALITY_PRESETS = {
    Extreme: {
        buildingCount: 50,
        rainParticles: 2500,
        starCount: 15000,
        bloomStrength: 1.2,
        bloomRadius: 0.8,
        bloomThreshold: 0.1,
        enablePostProcessing: true,
        flyingVehicles: 100, // Reduced from 200 for performance
    },
    Ultra: {
        buildingCount: 30,
        rainParticles: 1000,
        starCount: 12000,
        bloomStrength: 1.0,
        bloomRadius: 0.7,
        bloomThreshold: 0.15,
        enablePostProcessing: true,
        flyingVehicles: 75, // Reduced from 150 for performance
    },
    High: {
        buildingCount: 20,
        rainParticles: 800,
        starCount: 9000,
        bloomStrength: 0.9,
        bloomRadius: 0.6,
        bloomThreshold: 0.2,
        enablePostProcessing: true,
        flyingVehicles: 50, // Reduced from 100 for performance
    },
    Medium: {
        buildingCount: 15,
        rainParticles: 400,
        starCount: 6000,
        bloomStrength: 0.6,
        bloomRadius: 0.4,
        bloomThreshold: 0.3,
        enablePostProcessing: false,
        flyingVehicles: 30, // Reduced from 50 for performance
    },
    Low: {
        buildingCount: 10,
        rainParticles: 100,
        starCount: 3000,
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        bloomThreshold: 1.0,
        enablePostProcessing: false,
        flyingVehicles: 10, // Reduced from 20 for performance
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.3 }, // Reduced darkness for brighter scene
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
// Neon Colors Palette
// ─────────────────────────────────────────────────────────────────────────────
// Synthcity-style neon colors - purple dominant palette
const NEON_COLORS = [
    0xff00ff, // Magenta
    0xaa00ff, // Purple
    0x8800ff, // Deep purple
    0xcc00ff, // Bright purple
    0xff00aa, // Pink-purple
    0x6600ff, // Violet
    0xff66ff, // Light pink
    0x00ffff, // Cyan (accent)
    0xff0066, // Hot pink
    0x9933ff, // Medium purple
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class NeonDistrictTheme extends BaseTheme {
    constructor() {
        super('neon-district');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.bloomPass = null;

        // Scene elements
        this.buildings = [];
        this.neonSigns = [];
        this.rainParticles = null;
        this.flyingVehicles = [];
        this.streetLights = [];
        this.fog = null;
        this.starfield = null;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        // Effects state
        this.lightPulseIntensity = 0;
        this.rainIntensity = 1.0;
        this.bloomBoost = 0;
        this.glitchIntensity = 0;

        // Combo effect state
        this.neonSignSurgeIntensity = 0;
        this.neonSignSurgeTime = 0;

        // Piece lock effect particles
        this.pieceLockSparks = [];

        // Performance: throttle sign updates (every 3rd frame)
        this.signUpdateCounter = 0;

        // Performance: throttle blink updates (every 4th frame = 15Hz)
        this.blinkUpdateCounter = 0;

        // Shared spinner resources (initialized lazily)
        this.spinnerResources = null;

        // SynthCity Assets Manager
        this.assets = new NeonDistrictAssets();

        // Camera sway parameters (gentle floating drift)
        // Camera sway parameters (gentle floating drift) - increased movement
        this.cameraBasePosition = new THREE.Vector3(0, 4, 40);
        this.cameraBaseLookAt = new THREE.Vector3(0, 80, -400);
        this.cameraSwayAmplitude = { x: 5.0, y: 7.0, z: 2.0 };
        this.cameraSwaySpeed = { x: 0.1, y: 0.05, z: 0.08 };
        this.cameraLookAtSway = { x: 6.0, y: 4.0 };

        // VHS billboards with shader effects
        this.vhsBillboards = [];

        // Building Pool for smart caching
        this.buildingPool = [];

        // Simple building pool for outer rows (better FPS)
        this.simpleOuterBuildingPool = [];

        // Instanced outer buildings
        this.outerBuildingInstances = [];
        this.outerBuildingGeometry = null;

        // Shared rooftop beacon resources
        this.rooftopBeaconGeometry = null;
        this.rooftopBeaconMaterial = null;

        // Batched rooftop props
        this.rooftopMaterials = null;
        this.rooftopBatchMeshes = [];
        this.rooftopPropsBatched = false;
        this.freeStandingBeacons = [];

        // Flight collision bounds for vehicles
        this.flightCollisionBounds = [];
        this.outerBuildingBounds = [];
        this.vehicleRange = 2500;

        // Render scaling (performance)
        this.maxPixelRatio = 1.5;
        this.postProcessingScale = 0.75;
        this.dynamicResolutionScale = 1.0;
        this.dynamicResolutionMin = 0.7;
        this.dynamicResolutionMax = 1.0;
        this.dynamicResolutionStep = 0.05;
        this.dynamicResolutionAdjustInterval = 1.5;
        this.dynamicResolutionLowerFPS = 55;
        this.dynamicResolutionUpperFPS = 70;
        this.dynamicResolutionElapsed = 0;
        this.dynamicResolutionFrames = 0;
        this.renderMetrics = null;

        console.log('[NeonDistrict] Theme constructed');
    }

    getTetrominoConfig() {
        return NEON_DISTRICT_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.maxPixelRatio = this.qualityPreset.enablePostProcessing ? 1.5 : 1.25;
        this.postProcessingScale = this.qualityPreset.enablePostProcessing ? 0.75 : 1.0;
    }

    /**
     * Helper to defer work to the next animation frame.
     * Use for visual updates that need to render immediately.
     */
    deferToNextFrame() {
        return new Promise((resolve) => requestAnimationFrame(resolve));
    }

    /**
     * Helper to defer work to browser idle time.
     * Uses requestIdleCallback to avoid competing with gameplay/animations.
     * Falls back to setTimeout if requestIdleCallback is not available.
     */
    deferToIdleTime(timeout = 100) {
        return new Promise((resolve) => {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(resolve, { timeout });
            } else {
                // Fallback for Safari and older browsers
                setTimeout(resolve, 16);
            }
        });
    }

    async createScene() {
        console.log('[NeonDistrict] Creating cyberpunk cityscape (smart loading)...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('neon-district-theme');
        if (!container) {
            console.error('[NeonDistrict] Container not found');
            return;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 1: INSTANT - Core rendering pipeline (< 30ms)
        // ═══════════════════════════════════════════════════════════════════════
        this.initRenderer(container);
        this.createSkybox();
        this.createStarfield();
        this.setupMaterials();
        this.setupLighting();
        this.setupPostProcessing();
        this.setupEventListeners();

        // START ANIMATION IMMEDIATELY
        this.startAnimation();
        console.log('[NeonDistrict] Phase 1 complete - core rendering active');

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 1.5: LOAD SYNTHCITY TEXTURES (non-blocking)
        // ═══════════════════════════════════════════════════════════════════════
        await this.assets.loadAllTextures();
        if (!this.isActive) return;
        console.log('[NeonDistrict] SynthCity textures loaded and materials created');

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 2: Progressive Loading (Non-blocking)
        // ═══════════════════════════════════════════════════════════════════════
        // Create street immediately (fast) - required before buildings
        this.createStreet();
        this.createMegaTower(); // Add hero building at horizon
        this.createLowLyingFog(); // Add atmospheric ground fog near tower
        this.createDistantCityLayers(); // Add silhouette backdrop
        this.createMoon(); // Add Cyber Moon
        this.createDistantSkyline(); // Add 360-degree city horizon
        this.createSearchlights(); // Add animated sky beams

        // Start building creation in chunks - DO NOT AWAIT
        // This allows the first frame to render immediately with sky/street/fog
        this.createBuildings().then(() => {
            if (this.isActive) {
                this.loadRemainingContentInBackground();
            }
        });

        console.log('[NeonDistrict] Scene core initialized - starting progressive load');
    }

    /**
     * Legacy method - replaced by chunked createBuildings
     * Kept for reference but unused
     */
    createAllBuildings() {
        // Deprecated - usage replaced by progressive createBuildings()
        console.warn('createAllBuildings called but is deprecated');
    }

    /**
     * Creates a neon banner that ALWAYS uses Kanji characters
     * Positioned to face the STREET (toward x=0)
     */
    createNeonBannerKanji(building) {
        const w = 25 + Math.random() * 15; // Wider
        const h = 60 + Math.random() * 40; // Taller
        const geometry = new THREE.PlaneGeometry(w, h);

        // Purple-biased hue
        const hue = 0.75 + Math.random() * 0.2;
        const color = new THREE.Color().setHSL(hue, 1.0, 0.6);
        const texture = this.generateKanjiTexture(color);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);

        // Position sign to FACE THE STREET (x=0)
        const bx = building.position.x;
        const bz = building.position.z;
        const yPos = 40 + Math.random() * 80; // Lower for visibility

        // Offset from building edge toward street
        const streetOffset = 50; // Distance from building center

        if (bx < 0) {
            // Left side buildings - sign faces RIGHT (toward street center)
            sign.position.set(bx + streetOffset, yPos, bz);
            sign.rotation.y = -Math.PI / 2; // Face right
        } else {
            // Right side buildings - sign faces LEFT (toward street center)
            sign.position.set(bx - streetOffset, yPos, bz);
            sign.rotation.y = Math.PI / 2; // Face left
        }

        this.scene.add(sign);
        this.neonSigns.push(sign);

        // Add point light for glow
        const signLight = new THREE.PointLight(color.getHex(), 3.0, 100);
        signLight.position.copy(sign.position);
        this.scene.add(signLight);

        console.log(`[NeonDistrict] Kanji sign at x=${sign.position.x.toFixed(0)}, y=${sign.position.y.toFixed(0)}, z=${sign.position.z.toFixed(0)}`);
    }

    /**
     * Generates a neon texture that ALWAYS uses Kanji
     */
    generateKanjiTexture(baseColor) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 128, 256);

        const colorStr = `#${baseColor.getHexString()}`;
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 120, 248);

        // ALWAYS Kanji
        const kanjis = ['未来', '技術', '電脳', '日本', '東京', '夜', '酒', '愛', '光', '力', '神', '風', '龍', '炎'];
        const text = kanjis[Math.floor(Math.random() * kanjis.length)];

        ctx.fillStyle = colorStr;
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 60px Arial';

        // Vertical Kanji
        ctx.fillText(text.charAt(0), 64, 80);
        if (text.length > 1) ctx.fillText(text.charAt(1), 64, 160);

        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Loads remaining visual elements in background (buildings already created in Phase 2).
     */
    loadRemainingContentInBackground() {
        const workQueue = [];

        // 1. Holographic Billboards (Fast)
        workQueue.push(() => {
            if (!this.isActive) return;
            this.createHolographicBillboards();
        });

        // 2. Rain (Fast)
        workQueue.push(() => {
            if (!this.isActive) return;
            this.createRain();
        });

        // 3. Wires & Vehicles (OPTIMIZED: Now single draw calls, so we can do them at once)
        workQueue.push(() => {
            if (!this.isActive) return;
            this.createOverheadWires(); // Merged geometry (1 mesh)
            this.createFlyingVehicles(); // InstancedMesh (5 meshes)
        });

        // 4. Neon Signs (Still heavy, keep chunked)
        const buildingsCount = this.buildings.length;
        const neonBatchSize = 10;
        for (let i = 0; i < buildingsCount; i += neonBatchSize) {
            workQueue.push(() => {
                if (!this.isActive) return;
                this.createNeonSignsForBuildings(i, i + neonBatchSize);
            });
        }

        // Final touches
        workQueue.push(() => {
            if (!this.isActive) return;
            this.updateGroundReflections();
            console.log('[NeonDistrict] Background loading complete (Optimized)!');
        });

        // Process queue using requestIdleCallback
        this.processBackgroundQueue(workQueue, 0);
    }

    /**
     * Process work items using requestIdleCallback for better performance.
     * Processes multiple items per callback when time permits.
     */
    /**
     * Process work items using requestAnimationFrame with time budget.
     * Ensures consistent loading even under heavy load.
     */
    processBackgroundQueue(queue, index) {
        if (index >= queue.length || !this.isActive) return;

        const processBatch = () => {
            if (!this.isActive) return;

            const startTime = performance.now();
            // Process for up to 5ms per frame (avoid FPS drop)
            while (index < queue.length && (performance.now() - startTime) < 5) {
                queue[index]();
                index++;
            }

            if (index < queue.length && this.isActive) {
                requestAnimationFrame(processBatch);
            }
        };

        requestAnimationFrame(processBatch);
    }

    /**
     * Creates neon signs for a range of buildings.
     * DISABLED: Removed for performance
     */
    createNeonSignsForBuildings(startIdx, endIdx) {
        // Disabled for performance

    }

    /**
    /**
     * Creates holographic billboards attached to buildings.
     * DISABLED: Removed for performance - these were causing major FPS drops
     */
    createHolographicBillboards() {
        // Disabled for performance

    }

    // ─────────────────────────────────────────────────────────────────────────
    // Materials
    // ─────────────────────────────────────────────────────────────────────────

    setupMaterials() {
        this.buildingMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uBuildingHeight: { value: 100 },
                uBuildingWidth: { value: 50 },
                uSeed: { value: 0 },
                uGlowIntensity: { value: 1.0 },
                uWindowScale: { value: 1.0 },
                uWindowColor: { value: new THREE.Color(0xffffff) },
            },
            vertexShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                void main() {
                    vPosition = position;
                    vNormal = normal;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uBuildingHeight;
                uniform float uBuildingWidth;
                uniform float uSeed;
                uniform float uGlowIntensity;
                uniform float uWindowScale;
                uniform vec3 uWindowColor;
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                
                // Simple hash function
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                
                void main() {
                    // Base dark color with subtle structural grid
                    vec3 baseColor = vec3(0.02, 0.02, 0.04);
                    
                    // Add concrete noise texture
                    float grunge = noise(vPosition.xy * 0.5 + uSeed * 10.0);
                    baseColor += vec3(0.03) * grunge; // Subtle grime
                    
                    // Structural grid lines (very subtle)
                    float gridX = step(0.98, fract(vPosition.x / 10.0));
                    float gridY = step(0.98, fract(vPosition.y / 10.0));
                    baseColor += vec3(0.05) * max(gridX, gridY);
                    
                    // WINDOW GENERATION
                    // Use seed to vary grid size and aspect ratio per building
                    float aspectParams = hash(vec2(uSeed, 123.45));
                    float gridW = 5.0 + aspectParams * 5.0; // 5-10 width
                    float gridH = 8.0 + hash(vec2(uSeed, 678.90)) * 8.0; // 8-16 height
                    
                    // Adjust by scale uniform
                    gridW *= (0.8 + uWindowScale * 0.4);
                    gridH *= (0.8 + uWindowScale * 0.4);
                    
                    vec2 gridStr = (abs(vNormal.y) < 0.1) ? vPosition.xy : vPosition.xz;
                    gridStr += uSeed * 50.0; // Offset
                    
                    vec2 cell = floor(gridStr / vec2(gridW, gridH));
                    vec2 frac = fract(gridStr / vec2(gridW, gridH));
                    
                    // Window shape - variable gap based on seed
                    float gap = 0.2 + hash(vec2(uSeed, 333.33)) * 0.15; // 0.2 to 0.35 gap
                    bool isWindow = frac.x > gap && frac.x < (1.0 - gap) && 
                                  frac.y > gap && frac.y < (1.0 - gap);
                    
                    // Random lit chance - varied by building logic
                    float buildingLitDensity = 0.4 + hash(vec2(uSeed, 999.0)) * 0.4; // 40-80% density
                    float h = hash(cell + uSeed);
                    bool isLit = isWindow && (h > (1.0 - buildingLitDensity));
                    
                    vec3 finalColor = baseColor;
                    
                    if (isLit) {
                        float hue = hash(cell * 2.0);
                        vec3 winColor;
                        // Purple-dominant window colors
                        if (hue < 0.20) winColor = vec3(1.0, 0.0, 1.0); // Magenta
                        else if (hue < 0.35) winColor = vec3(0.7, 0.0, 1.0); // Purple
                        else if (hue < 0.50) winColor = vec3(0.5, 0.0, 0.9); // Deep purple
                        else if (hue < 0.65) winColor = vec3(0.8, 0.2, 1.0); // Light purple
                        else if (hue < 0.80) winColor = vec3(1.0, 0.0, 0.7); // Pink-purple
                        else if (hue < 0.90) winColor = vec3(0.4, 0.0, 1.0); // Violet
                        else winColor = vec3(0.0, 0.8, 1.0); // Cyan accent

                        // Varied brightness per window
                        float wBright = 1.0 + hash(cell * 3.0) * 0.8;
                        finalColor += winColor * wBright * 1.5;
                    }
                    
                    // Purple edge glow
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 3.0);
                    finalColor += vec3(0.5, 0.0, 0.9) * rim * uGlowIntensity * 1.0;
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera - Street Level Perspective
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Use higher max pixel ratio (3) for crisp rendering on high-DPI displays
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x150820, 1); // Deep Cyberpunk Purple-Black
        this.applyRenderScale(true);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // SYNTHCITY FOG - Pushed further away for clearer center view
        // SYNTHCITY FOG - Pushed further away for clearer center view
        // Extent to 8000 to reveal the new Mega Tower at -4000
        // Adjusted fog: Closer start (3000) to blend the Mega Tower base better
        this.scene.fog = new THREE.Fog(0x1a0a2e, 2000, 7000);

        // Street-level camera IN THE ALLEY - more horizontal view
        // Street-level camera IN THE ALLEY - more horizontal view
        // Far clip increased to 10000 to see the horizon tower
        this.camera = new THREE.PerspectiveCamera(70, width / height, 1, 10000);
        this.camera.position.set(0, 4, 40); // Start at street level
        this.camera.lookAt(0, 80, -400); // Looking more horizontal, at buildings

        console.log('[NeonDistrict] Camera positioned in alley');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Skybox - Dark stormy cyberpunk sky
    // ─────────────────────────────────────────────────────────────────────────

    createSkybox() {
        // Create gradient sky dome - size increased to cover new far clip
        const skyGeometry = new THREE.SphereGeometry(9000, 32, 32);
        const skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vWorldPosition;
                
                void main() {
                    float height = normalize(vWorldPosition).y;
                    
                    // Deep purple cyberpunk gradient - refined for atmosphere
                    vec3 bottomColor = vec3(0.20, 0.05, 0.30); // Hazy city glow (lighter bottom)
                    vec3 midColor = vec3(0.10, 0.03, 0.20);    // Deep purple mid
                    vec3 topColor = vec3(0.00, 0.00, 0.05);    // Deep space void (dark top)
                    
                    vec3 color;
                    if (height < 0.0) {
                        color = bottomColor;
                    } else if (height < 0.3) {
                        color = mix(bottomColor, midColor, height / 0.3);
                    } else {
                        color = mix(midColor, topColor, (height - 0.3) / 0.7);
                    }
                    
                    // Intense purple atmospheric haze
                    float hazeAmount = 1.0 - smoothstep(-0.2, 0.5, height);
                    vec3 hazeColor = vec3(0.25, 0.08, 0.45); // Vivid purple haze
                    color = mix(color, hazeColor, hazeAmount * 0.6);
                    
                    // Stars are rendered separately as a point field
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
        });

        this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(this.sky);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Neon night stars inspired by Blood Moon
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount || 6000;
        if (starCount <= 0) return;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2);
        const brightness = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xcce6ff), // Cool white
            new THREE.Color(0x88ccff), // Soft cyan
            new THREE.Color(0xb388ff), // Violet
            new THREE.Color(0xffb3ff), // Soft pink
            new THREE.Color(0x7aa6ff), // Blue accent
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const radius = 6000 + Math.random() * 3000;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 18 + Math.random() * 40;
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 0.6 + Math.random() * 1.6;
            brightness[i] = 0.25 + Math.random() * 0.75;
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
            },
            vertexShader: NEON_DISTRICT_STAR_VERTEX_SHADER,
            fragmentShader: NEON_DISTRICT_STAR_FRAGMENT_SHADER,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.frustumCulled = false;
        this.scene.add(this.starfield);
        console.log('[NeonDistrict] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Procedural Cyberpunk Buildings
    // ─────────────────────────────────────────────────────────────────────────

    async createBuildings() {
        const { buildingCount } = this.qualityPreset;
        const streetWidth = 180; // Width of the alley corridor
        const buildingSpacing = 120; // Space between buildings along the street
        const CHUNK_SIZE = 2; // Small chunks to avoid ANY lag during gameplay

        // Calculate buildings per side
        const buildingsPerSide = Math.floor(buildingCount / 2);
        const alleyLength = buildingsPerSide * buildingSpacing;

        // Outer row configuration
        const outerAlleyGap = 60; // Gap between inner and outer rows (secondary alleys)
        const avgBuildingWidth = 110; // Average building width for offset calculation
        const outerRowOffset = streetWidth / 2 + 50 + avgBuildingWidth + outerAlleyGap;

        // Prepare all building configs first (fast)
        const buildingConfigs = [];
        // Separate array for outer buildings (100% pooled for max performance)
        const outerBuildingConfigs = [];

        // Left side buildings (inner row)
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100;
            const xPos = -(streetWidth / 2 + 50 + Math.random() * 30);
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;
            buildingConfigs.push({
                x: xPos, z: zPos, width, height, depth,
            });
        }

        // Right side buildings (inner row)
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100 - buildingSpacing / 2;
            const xPos = streetWidth / 2 + 50 + Math.random() * 30;
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;
            buildingConfigs.push({
                x: xPos, z: zPos, width, height, depth,
            });

            // FILLER BUILDING: Add extra building to the right of the first one to cover void
            if (i === 0) {
                const gap = 40; // Proper alleyway gap
                const fillerW = 200 + Math.random() * 100; // Wide filler
                // Precise math: Center of Building 1 + Half Width of B1 + Gap + Half Width of Filler
                const fillerX = xPos + (width / 2) + gap + (fillerW / 2);

                // Align Z slightly behind (further from camera) or aligned to create a corner
                // zPos is negative. zPos is center.
                // Let's align it exactly with the street front (zPos)
                const fillerZ = zPos;

                buildingConfigs.push({
                    x: fillerX, z: fillerZ, width: fillerW, height: height * 0.9, depth: depth * 1.5,
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // OUTER ROWS - Two additional building rows creating secondary alleys
        // These use 100% pool cloning for maximum performance
        // ═══════════════════════════════════════════════════════════════════════

        // Outer rows layers (left and right) - 8 layers deep to fill voids from high camera (Increased from 3)
        const numOuterLayers = 8;

        for (let layer = 0; layer < numOuterLayers; layer++) {
            const layerSpacing = 150; // Spacing between layers (Tighter)
            const currentOffset = outerRowOffset + (layer * layerSpacing);

            // Left side outer rows
            for (let i = 0; i < buildingsPerSide; i++) {
                const zPos = -i * buildingSpacing - 100 - buildingSpacing * (0.2 + layer * 0.1);
                const xPos = -(currentOffset + 50 + Math.random() * 40);
                outerBuildingConfigs.push({ x: xPos, z: zPos, poolOnly: true });
            }

            // Right side outer rows
            for (let i = 0; i < buildingsPerSide; i++) {
                const zPos = -i * buildingSpacing - 100 - buildingSpacing * (0.7 + layer * 0.1);
                const xPos = currentOffset + 50 + Math.random() * 40;
                outerBuildingConfigs.push({ x: xPos, z: zPos, poolOnly: true });
            }
        }

        // Background buildings (distant, larger) - Increased range and count
        // alleyLength is already defined above
        for (let i = 0; i < 50; i++) {
            const zPos = -alleyLength - 200 - Math.random() * 6000; // Extend way back

            // EXCLUSION ZONE: Keep center clear for Mega Tower visibility
            // Spawn either far left (<-300) or far right (>300)
            const side = Math.random() > 0.5 ? 1 : -1;
            const xPos = side * (300 + Math.random() * 600);

            const width = 150 + Math.random() * 200;
            const depth = 150 + Math.random() * 200;
            const height = 1000 + Math.random() * 2000; // Taller background towers
            buildingConfigs.push({
                x: xPos, z: zPos, width, height, depth,
            });
        }

        // CREATE BUILDINGS IN SMALL CHUNKS (idle-time loading)
        for (let i = 0; i < buildingConfigs.length; i += CHUNK_SIZE) {
            if (!this.isActive) return; // Check if stopped

            const chunk = buildingConfigs.slice(i, i + CHUNK_SIZE);

            // Use Pool for 80% of buildings (perf), create fresh for 20% (variety)
            chunk.forEach((cfg) => {
                if (Math.random() < 0.8) {
                    this.createBuildingFromPool(cfg.x, cfg.z);
                } else {
                    const b = this.createBuilding(cfg.x, cfg.z, cfg.width, cfg.height, cfg.depth);
                    this.scene.add(b);
                    this.buildings.push(b);
                }
            });

            // Wait for idle time before next chunk - doesn't compete with gameplay
            if (i + CHUNK_SIZE < buildingConfigs.length) {
                await this.deferToIdleTime();
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CREATE OUTER ROW BUILDINGS - Simple boxes for better FPS
        // Single mesh per building, shared materials, no complex features
        // ═══════════════════════════════════════════════════════════════════════
        if (!this.isActive) return;
        this.createOuterBuildingInstances(outerBuildingConfigs);

        // Merge static rooftop props to reduce draw calls
        this.batchRooftopProps();

        const totalBuildings = buildingConfigs.length + outerBuildingConfigs.length;
        console.log(`[NeonDistrict] Created ${totalBuildings} buildings (${outerBuildingConfigs.length} instanced outer)`);
    }

    createBuilding(x, z, width, height, depth) {
        const building = new THREE.Group();
        building.position.set(x, 0, z);
        building.userData.width = width;
        building.userData.height = height;
        building.userData.depth = depth;

        // BUILDING VARIETY - all use shader-based windows, but vary dimensions
        // Determine building style
        const type = Math.random();

        if (type < 0.5) {
            this.createComplexTower(building, width, height, depth);
        } else if (type < 0.7) {
            this.createSteppedBuilding(building, width, height, depth);
        } else if (type < 0.8) {
            this.createSpireBuilding(building, width, height, depth);
        } else if (type < 0.9) {
            this.createWideBaseBuilding(building, width, height, depth);
        } else {
            this.createStandardTower(building, width, height, depth);
        }

        // Add Storefront (Ground Floor)
        this.createStorefront(building, width, depth);

        // Add building-attached ads
        // For pool generation, we assume it might be far back, or we randomize
        // If z is provided (not 0), check it. If 0 (pool), 50% chance.
        const shouldAddAds = (z !== 0 && z < -50) || (z === 0 && Math.random() > 0.5);
        if (shouldAddAds && this.assets?.loaded) {
            this.attachAdsToBuilding(building, width, height, depth);
        }

        // NOTE: building is NOT added to scene/arrays here anymore. caller must do it.
        return building;
    }

    /**
     * Generate a pool of varied building prototypes
     */
    generateBuildingPool() {
        if (this.buildingPool.length > 0) return; // Already generated

        console.log('[NeonDistrict] Generating building pool...');
        const poolSize = 15;

        for (let i = 0; i < poolSize; i++) {
            // Generate generic dimensions
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;

            // Create building at 0,0 (prototype)
            const building = this.createBuilding(0, 0, width, height, depth);
            this.buildingPool.push(building);
        }
    }

    /**
     * Generate simple box buildings for outer rows (better FPS)
     * These are just basic geometry with emissive materials - no complex features
     */
    generateSimpleOuterBuildingPool() {
        if (this.simpleOuterBuildingPool.length > 0) return;

        console.log('[NeonDistrict] Generating simple outer building pool...');
        const poolSize = 8; // Fewer variations needed for distant buildings

        for (let i = 0; i < poolSize; i++) {
            const width = 80 + Math.random() * 100;
            const depth = 80 + Math.random() * 100;
            const height = 400 + Math.random() * 800;

            // Simple box geometry - single mesh, no groups
            const geometry = new THREE.BoxGeometry(width, height, depth);

            // Get building material from assets (shared, not cloned)
            const matIndex = (i % 10) + 1;
            const matId = `building_${matIndex.toString().padStart(2, '0')}`;
            const material = this.assets.getMaterial(matId);

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = height / 2;

            // Store dimensions for UV scaling
            mesh.userData.height = height;
            mesh.userData.width = width;
            mesh.userData.depth = depth;
            mesh.userData.isSimpleBuilding = true;

            this.simpleOuterBuildingPool.push(mesh);
        }
    }

    /**
     * Create a simple outer building by cloning from pool
     */
    createSimpleOuterBuilding(x, z) {
        if (this.simpleOuterBuildingPool.length === 0) {
            this.generateSimpleOuterBuildingPool();
        }

        const prototype = this.simpleOuterBuildingPool[
            Math.floor(Math.random() * this.simpleOuterBuildingPool.length)
        ];
        const clone = prototype.clone();

        clone.position.x = x;
        clone.position.z = z;

        // Random Y rotation for variety
        clone.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);

        const simpleHeight = clone.userData.height;
        if (simpleHeight) {
            const simpleWidth = clone.userData.width || 60;
            const simpleDepth = clone.userData.depth || 60;
            this.addRooftopBeacons(clone, simpleWidth, simpleHeight / 2, simpleDepth, {
                chance: 0.35,
                minCount: 1,
                maxCount: 2,
                spread: 0.5,
                yOffset: 2,
                heightForBoost: simpleHeight,
            });
        }

        this.scene.add(clone);
        this.buildings.push(clone);

        return clone;
    }

    createOuterBuildingInstances(outerBuildingConfigs) {
        if (!this.assets?.loaded || outerBuildingConfigs.length === 0) return;

        if (!this.outerBuildingGeometry) {
            this.outerBuildingGeometry = new THREE.BoxGeometry(1, 1, 1);
        }

        this.outerBuildingBounds = [];

        const materialBuckets = new Map();

        outerBuildingConfigs.forEach((cfg) => {
            const width = 80 + Math.random() * 100;
            const depth = 80 + Math.random() * 100;
            const height = 400 + Math.random() * 800;
            const rotation = Math.floor(Math.random() * 4) * (Math.PI / 2);

            const matIndex = Math.floor(Math.random() * 10) + 1;
            const matId = `building_${matIndex.toString().padStart(2, '0')}`;

            if (!materialBuckets.has(matId)) {
                materialBuckets.set(matId, []);
            }
            materialBuckets.get(matId).push({
                x: cfg.x,
                z: cfg.z,
                width,
                height,
                depth,
                rotation,
            });

            const rotSteps = Math.round(rotation / (Math.PI / 2)) % 4;
            const swapped = rotSteps % 2 !== 0;
            const halfX = (swapped ? depth : width) / 2;
            const halfZ = (swapped ? width : depth) / 2;
            this.outerBuildingBounds.push({
                minX: cfg.x - halfX,
                maxX: cfg.x + halfX,
                minZ: cfg.z - halfZ,
                maxZ: cfg.z + halfZ,
                height,
            });

            this.addRooftopBeaconsAt(
                cfg.x,
                cfg.z,
                rotation,
                width,
                height,
                depth,
                {
                    chance: 0.25,
                    minCount: 1,
                    maxCount: 2,
                    spread: 0.5,
                    yOffset: 2,
                    heightForBoost: height,
                },
            );
        });

        const dummy = new THREE.Object3D();
        materialBuckets.forEach((instances, matId) => {
            const material = this.assets.getMaterial(matId);
            if (!material) return;

            const mesh = new THREE.InstancedMesh(this.outerBuildingGeometry, material, instances.length);
            mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

            instances.forEach((inst, i) => {
                dummy.position.set(inst.x, inst.height / 2, inst.z);
                dummy.rotation.y = inst.rotation;
                dummy.scale.set(inst.width, inst.height, inst.depth);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            });

            mesh.instanceMatrix.needsUpdate = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            this.scene.add(mesh);
            this.outerBuildingInstances.push(mesh);
        });
    }

    createMegaTower() {
        // Massive hero building at the end of the road
        const width = 400;
        const depth = 400;
        const height = 3000;

        // Positioned dead center at the far end
        // Slightly off-center to the right (refined from 300 to 150)
        const x = 150;
        const z = -4000;

        const building = new THREE.Group();
        building.position.set(x, 0, z);

        // Core tower
        // PROCEDURAL WINDOW SHADER: Create a grid of bright windows
        // Store reference for animation loop
        this.megaTowerMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(0x100018) }, // Darker purple base (almost black)
                uWindowColor: { value: new THREE.Color(0xff00ff) }, // Bright pink windows
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPosition;
                void main() {
                    vUv = uv;
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform vec3 uWindowColor;
                varying vec2 vUv;
                varying vec3 vPosition;

                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }

                void main() {
                    // Create window grid - Higher density for "massive" scale feel
                    // Scale UVs for tiling - Reduced slightly from 40x200 to 20x100 for less noise
                    vec2 gridUv = vUv * vec2(25.0, 100.0); 
                    vec2 cell = floor(gridUv);
                    vec2 st = fract(gridUv);

                    // Window shape (more padding = smaller windows)
                    // step(0.3, st.x) means left gap is 0.3
                    float window = step(0.35, st.x) * step(0.3, st.y) * step(st.x, 0.65) * step(st.y, 0.8);

                    // Randomly turn windows on/off - STATIC placement
                    float noise = random(cell); 
                    // Only light up 15% of windows (was 30%) for much more subtle effect
                    float state = step(0.85, noise); 

                    // Vary intensity - Softer
                    float intensity = 0.5 + random(cell) * 1.5;

                    // COLOR DRIFT ANIMATION
                    // Cycle: Pink -> Purple -> Cyan -> Pink
                    vec3 colPink = vec3(1.0, 0.0, 1.0);
                    vec3 colCyan = vec3(0.0, 1.0, 1.0);
                    vec3 colPurple = vec3(0.6, 0.0, 1.0);
                    
                    // Slow time cycle
                    float t = uTime * 0.2; 
                    vec3 mixedColor = mix(colPink, colPurple, 0.5 + 0.5 * sin(t));
                    mixedColor = mix(mixedColor, colCyan, 0.5 + 0.5 * sin(t * 0.7 + 2.0));

                    vec3 finalColor = uColor;
                    if (window > 0.5 && state > 0.5) {
                        finalColor = mixedColor * intensity;
                    }

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

        const geom = new THREE.BoxGeometry(width, height, depth);
        const mesh = new THREE.Mesh(geom, this.megaTowerMaterial);
        mesh.position.y = height / 2;
        building.add(mesh);

        // Add some glowing rings or details
        const ringGeom = new THREE.TorusGeometry(width * 0.8, 10, 16, 100);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = height * 0.8;
        building.add(ring);

        // Mast on top for aviation light
        const mastHeight = 220;
        const mastGeometry = new THREE.CylinderGeometry(6, 10, mastHeight, 10);
        const mastMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a36,
            metalness: 0.7,
            roughness: 0.4,
            emissive: 0x110011,
            emissiveIntensity: 0.2,
        });
        const mast = new THREE.Mesh(mastGeometry, mastMaterial);
        mast.position.y = height + mastHeight / 2;
        building.add(mast);

        // Add to scene
        this.scene.add(building);
        this.buildings.push(building);

        // ─────────────────────────────────────────────────────────────────────
        // Red Blinking Light at the top (Aviation Obstruction Light)
        // ─────────────────────────────────────────────────────────────────────
        const blinkerGeom = new THREE.SphereGeometry(15, 16, 16);
        const blinkerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const blinker = new THREE.Mesh(blinkerGeom, blinkerMat);
        blinker.position.set(0, height + mastHeight + 12, 0); // At the mast peak

        // Red Glow
        const blinkerLight = new THREE.PointLight(0xff0000, 10.0, 800);
        blinkerLight.position.set(0, height + mastHeight + 28, 0);

        // Animation data for updateBlinkingLights()
        blinker.userData.blinkPhase = 0;
        blinkerLight.userData.blinkPhase = 0;
        const towerBlinkProfile = this.createBlinkProfile('double', {
            period: 2.4,
            offset: 0,
            pulseOn: 0.14,
            pulseGap: 0.16,
            pulseOn2: 0.14,
            ramp: 0.05,
        });
        Object.assign(blinker.userData, towerBlinkProfile);
        Object.assign(blinkerLight.userData, towerBlinkProfile);

        building.add(blinker);
        building.add(blinkerLight);

        // Register for animation
        this.streetLights.push(blinker);
        this.streetLights.push(blinkerLight);

        console.log('[NeonDistrict] Mega Tower created at horizon');
    }

    /**
     * Creates low-lying ground fog near the Mega Tower to add atmosphere
     */
    createLowLyingFog() {
        // Create a large plane for the fog
        const width = 800; // Wide enough to cover the street view
        const depth = 2000; // Long enough to stretch from mid-distance to tower
        const geometry = new THREE.PlaneGeometry(width, depth, 32, 64);

        // Custom shader for drifting mist/fog
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(0xaa00ff) }, // Purple fog
                uDensity: { value: 0.6 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vElevation;
                
                void main() {
                    vUv = uv;
                    
                    // Add some wave motion to the vertices
                    vec3 pos = position;
                    // Gentle wave motion
                    float wave = sin(uv.x * 10.0 + uv.y * 5.0) * 5.0;
                    pos.z += wave;
                    
                    vElevation = wave;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uDensity;
                varying vec2 vUv;
                varying float vElevation;

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
                    // Scrolling noise textures
                    vec2 uv1 = vUv * 4.0;
                    uv1.y -= uTime * 0.1; // Move towards camera (or away depending on view)
                    
                    vec2 uv2 = vUv * 8.0;
                    uv2.y -= uTime * 0.15;
                    uv2.x += uTime * 0.05;

                    float n1 = noise(uv1);
                    float n2 = noise(uv2);
                    
                    // Combine noise layers
                    float fogDensity = mix(n1, n2, 0.5);
                    
                    // Soft edges
                    float alpha = smoothstep(0.0, 0.4, fogDensity) * uDensity;
                    
                    // Fade out at edges of plane
                    float edgeFade = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
                    edgeFade *= smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.5, vUv.y); // Fade out more at far end
                    
                    // Additional depth fade (optional, but good for blending)
                    alpha *= edgeFade;

                    gl_FragColor = vec4(uColor, alpha * 0.4); // Semi-transparent
                }
            `,
            transparent: true,
            depthWrite: false, // Don't write to depth buffer for proper transparency
            blending: THREE.AdditiveBlending, // Glowy fog
            side: THREE.DoubleSide,
        });

        this.lowFog = new THREE.Mesh(geometry, material);

        // Position just above the street/ground
        // Mega Tower is at z = -4000.
        // We want this fog to start around -2000 and go to -4000
        this.lowFog.position.set(0, 5, -3000);
        this.lowFog.rotation.x = -Math.PI / 2; // Flat on ground

        this.scene.add(this.lowFog);
    }

    /**
     * Create a building by cloning from the pool
     */
    createBuildingFromPool(x, z) {
        // Ensure pool exists
        if (this.buildingPool.length === 0) {
            this.generateBuildingPool();
        }

        // Pick random prototype
        const prototype = this.buildingPool[Math.floor(Math.random() * this.buildingPool.length)];
        const clone = prototype.clone();

        // Position
        clone.position.set(x, 0, z);

        // Random Y rotation (90 degree increments) for variety
        clone.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);

        const cloneWidth = clone.userData.width;
        const cloneDepth = clone.userData.depth;
        if (cloneWidth && cloneDepth) {
            clone.traverse((child) => {
                if (child.userData?.isVHS || child.userData?.isAd) {
                    this.placeBillboardFacingStreet(clone, child, cloneWidth, cloneDepth, child.position.y);
                }
            });
        }

        // Register animated components from the clone
        clone.traverse((child) => {
            if (child.userData.isAd) {
                this.neonSigns.push(child);
            }
            if (child.userData.isVHS) {
                this.vhsBillboards.push(child);
            }
            if (child.userData.blinkPhase !== undefined) {
                if (child.userData.blinkPeriod) {
                    child.userData.blinkOffset = Math.random() * child.userData.blinkPeriod;
                } else {
                    child.userData.blinkPhase = Math.random() * Math.PI * 2;
                }
                this.streetLights.push(child);
            }
        });

        // Add to scene and tracking array
        this.scene.add(clone);
        this.buildings.push(clone);

        return clone;
    }

    /**
     * Attach ads to building faces like SynthCity does
     */
    attachAdsToBuilding(building, width, height, depth) {
        const isLarge = height > 400;

        // Only ONE billboard per building to avoid z-fighting
        // 50% chance of VHS billboard for large buildings, otherwise regular ad
        if (isLarge && Math.random() < 0.5) {
            this.createVHSBillboardOnBuilding(building, width, height, depth);
            return;
        }

        const material = isLarge
            ? this.assets.getRandomLargeAdMaterial()
            : this.assets.getRandomAdMaterial();

        if (!material) return;

        // Random ad size based on building
        const adWidth = isLarge ? 60 + Math.random() * 40 : 30 + Math.random() * 25;
        const adHeight = isLarge ? 40 + Math.random() * 30 : 20 + Math.random() * 15;
        const geometry = new THREE.PlaneGeometry(adWidth, adHeight);

        // Create ad mesh
        const ad = new THREE.Mesh(geometry, material);

        // Position on building face (ALWAYS street-facing for visibility per user request)
        const adY = 50 + Math.random() * Math.min(height * 0.6, 300);
        this.placeBillboardFacingStreet(building, ad, width, depth, adY);

        // Store for animation (material switching like SynthCity)
        ad.userData.isAd = true;
        ad.userData.switchInterval = 200 + Math.random() * 800;
        ad.userData.switchCounter = Math.random() * ad.userData.switchInterval;
        ad.userData.switches = Math.random() < 0.7; // 70% of ads switch
        ad.userData.isLarge = isLarge;

        building.add(ad);
        this.neonSigns.push(ad); // Add to animation list
    }

    /**
     * Create a VHS-style billboard with scanlines, chromatic aberration, and glitch effects
     */
    createVHSBillboardOnBuilding(building, buildingWidth, buildingHeight, buildingDepth) {
        // Get two random ad textures for cycling
        const adIndex1 = Math.floor(Math.random() * 14) + 1;
        let adIndex2 = Math.floor(Math.random() * 14) + 1;
        while (adIndex2 === adIndex1) adIndex2 = Math.floor(Math.random() * 14) + 1;

        const padNum = (n) => n.toString().padStart(2, '0');
        const tex1 = this.assets?.getTexture(`ads_large_${padNum(adIndex1)}`);
        const tex2 = this.assets?.getTexture(`ads_large_${padNum(adIndex2)}`);

        if (!tex1 || !tex2) return;

        // Billboard dimensions - LARGER for visibility
        const adWidth = 100 + Math.random() * 60;
        const adHeight = 70 + Math.random() * 45;
        const geometry = new THREE.PlaneGeometry(adWidth, adHeight);

        // VHS Billboard Shader
        const vhsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uRandomOffset: { value: Math.random() * 100.0 }, // Random start time for each ad
                uTexture1: { value: tex1 },
                uTexture2: { value: tex2 },
                uMixFactor: { value: 0.0 },
                uGlitchIntensity: { value: 0.0 },
                uScanlineIntensity: { value: 0.35 },
                uChromaticAberration: { value: 0.008 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uRandomOffset;
                uniform sampler2D uTexture1;
                uniform sampler2D uTexture2;
                uniform float uMixFactor;
                uniform float uGlitchIntensity;
                uniform float uScanlineIntensity;
                uniform float uChromaticAberration;
                varying vec2 vUv;

                // Pseudo-random function
                float rand(vec2 co) {
                    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main() {
                    vec2 uv = vUv;
                    float time = uTime + uRandomOffset; // Use randomized time

                    // === TRACKING GLITCH - Horizontal offset ===
                    float glitchLine = step(0.99, rand(vec2(floor(time * 3.0), floor(uv.y * 20.0))));
                    float glitchOffset = glitchLine * uGlitchIntensity * (rand(vec2(time, uv.y)) - 0.5) * 0.1;
                    uv.x += glitchOffset;

                    // Occasional full-screen horizontal shift during transitions
                    float transitionGlitch = uGlitchIntensity * sin(time * 50.0) * 0.02;
                    uv.x += transitionGlitch;

                    // === CHROMATIC ABERRATION ===
                    float ca = uChromaticAberration * (1.0 + uGlitchIntensity * 3.0);
                    
                    // Sample with RGB separation
                    vec4 tex1Sample, tex2Sample;
                    tex1Sample.r = texture2D(uTexture1, uv + vec2(ca, 0.0)).a > 0.0 ? texture2D(uTexture1, uv + vec2(ca, 0.0)).r : texture2D(uTexture1, uv).r;
                    tex1Sample.g = texture2D(uTexture1, uv).g;
                    tex1Sample.b = texture2D(uTexture1, uv - vec2(ca, 0.0)).b;
                    tex1Sample.a = 1.0;

                    tex2Sample.r = texture2D(uTexture2, uv + vec2(ca, 0.0)).r;
                    tex2Sample.g = texture2D(uTexture2, uv).g;
                    tex2Sample.b = texture2D(uTexture2, uv - vec2(ca, 0.0)).b;
                    tex2Sample.a = 1.0;

                    // Mix between the two textures
                    vec4 texColor = mix(tex1Sample, tex2Sample, uMixFactor);

                    // === VHS SCANLINES - more visible ===
                    float scanline = sin(vUv.y * 300.0 + time * 2.0) * 0.5 + 0.5;
                    scanline = 1.0 - scanline * uScanlineIntensity;
                    texColor.rgb *= scanline;

                    // === SCROLLING INTERFERENCE LINE - visible but not overpowering ===
                    float interferenceY = fract(time * 0.12);
                    float interference = smoothstep(interferenceY - 0.04, interferenceY, vUv.y) 
                                       * smoothstep(interferenceY + 0.04, interferenceY, vUv.y);
                    texColor.rgb += interference * 0.15;

                    // === VISIBLE NOISE ===
                    float noise = rand(vUv + time) * 0.05;
                    texColor.rgb += noise;

                    // === BRIGHTNESS FLICKER - more noticeable ===
                    float flicker = 0.92 + sin(time * 8.0) * 0.05 + sin(time * 23.0) * 0.03;
                    texColor.rgb *= flicker;

                    // === EDGE VIGNETTE ===
                    float vignette = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
                    vignette *= smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);

                    // Reduce brightness to show content clearly
                    texColor.rgb *= 0.5;

                    gl_FragColor = vec4(texColor.rgb, vignette * 0.95);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending, // Normal blending to show texture content
        });

        const billboard = new THREE.Mesh(geometry, vhsMaterial);

        // Position on the street-facing side (like createAdOnBuilding)
        // Minimum Y = 150 to avoid overlapping storefronts (height 36)
        const adY = 150 + Math.random() * Math.min(buildingHeight * 0.4, 200);
        this.placeBillboardFacingStreet(building, billboard, buildingWidth, buildingDepth, adY);

        // Store cycling data
        billboard.userData.isVHS = true;
        billboard.userData.cycleTime = 8 + Math.random() * 6; // 8-14 seconds per ad
        billboard.userData.cycleProgress = Math.random() * billboard.userData.cycleTime;
        billboard.userData.currentTexture = 0;
        billboard.userData.transitionDuration = 0.5;
        billboard.userData.inTransition = false;

        building.add(billboard);
        this.vhsBillboards.push(billboard);
    }

    placeBillboardFacingStreet(building, mesh, width, depth, height, options = {}) {
        const offsetScale = options.offsetScale ?? 0.5;
        const offset = options.offset ?? 1;

        const worldPos = this._billboardWorldPos || (this._billboardWorldPos = new THREE.Vector3());
        const worldQuat = this._billboardWorldQuat || (this._billboardWorldQuat = new THREE.Quaternion());
        const worldQuatInv = this._billboardWorldQuatInv || (this._billboardWorldQuatInv = new THREE.Quaternion());
        const toCenterWorld = this._billboardToCenterWorld || (this._billboardToCenterWorld = new THREE.Vector3());
        const toCenterLocal = this._billboardToCenterLocal || (this._billboardToCenterLocal = new THREE.Vector3());

        building.getWorldPosition(worldPos);
        building.getWorldQuaternion(worldQuat);
        worldQuatInv.copy(worldQuat).invert();

        toCenterWorld.set(-worldPos.x, 0, 0);
        if (toCenterWorld.lengthSq() < 0.0001) {
            toCenterWorld.set(1, 0, 0);
        } else {
            toCenterWorld.normalize();
        }

        toCenterLocal.copy(toCenterWorld).applyQuaternion(worldQuatInv);
        const useX = Math.abs(toCenterLocal.x) >= Math.abs(toCenterLocal.z);
        const sign = useX
            ? (toCenterLocal.x >= 0 ? 1 : -1)
            : (toCenterLocal.z >= 0 ? 1 : -1);

        if (useX) {
            mesh.position.set(
                sign * (width / 2 + offset),
                height,
                (Math.random() - 0.5) * depth * offsetScale,
            );
            mesh.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
        } else {
            mesh.position.set(
                (Math.random() - 0.5) * width * offsetScale,
                height,
                sign * (depth / 2 + offset),
            );
            mesh.rotation.y = sign > 0 ? 0 : Math.PI;
        }
    }

    createStorefront(building, width, depth) {
        // Try to get a unique storefront material
        const material = this.assets?.getRandomStorefrontMaterial();

        // If no storefront available, skip entirely (no glow on this building)
        if (!material) {
            return;
        }

        const height = 36; // Ground floor height
        const geometry = new THREE.BoxGeometry(width + 2, height, depth + 2);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = height / 2;
        building.add(mesh);

        // Add ground-level grime/debris for natural transition
        this.addGroundLevelDetails(building, width, depth);
    }

    /**
     * Add ground-level details for more natural building-ground transition
     */
    addGroundLevelDetails(building, width, depth) {
        // Dark grime strip at base of building
        const grimeHeight = 3;
        const grimeGeometry = new THREE.BoxGeometry(width + 4, grimeHeight, depth + 4);
        const grimeMaterial = new THREE.MeshPhongMaterial({
            color: 0x111111,
            emissive: 0x000000,
        });
        const grime = new THREE.Mesh(grimeGeometry, grimeMaterial);
        grime.position.y = grimeHeight / 2;
        building.add(grime);

        // Random debris/clutter around base
        const debrisCount = Math.floor(2 + Math.random() * 4);
        for (let i = 0; i < debrisCount; i++) {
            const size = 1 + Math.random() * 3;
            const debrisGeom = new THREE.BoxGeometry(size, size * 0.5, size);
            const debrisMat = new THREE.MeshPhongMaterial({
                color: 0x222222 + Math.floor(Math.random() * 0x111111),
            });
            const debris = new THREE.Mesh(debrisGeom, debrisMat);

            // Position around building perimeter
            const side = Math.floor(Math.random() * 4);
            const offset = (Math.random() - 0.5) * (side < 2 ? width : depth) * 0.8;

            if (side === 0) debris.position.set(offset, size * 0.25, depth / 2 + 3 + Math.random() * 2);
            else if (side === 1) debris.position.set(offset, size * 0.25, -depth / 2 - 3 - Math.random() * 2);
            else if (side === 2) debris.position.set(width / 2 + 3 + Math.random() * 2, size * 0.25, offset);
            else debris.position.set(-width / 2 - 3 - Math.random() * 2, size * 0.25, offset);

            debris.rotation.y = Math.random() * Math.PI;
            building.add(debris);
        }

        // Ground fog/mist plane at building base (very subtle)
        if (Math.random() > 0.5) {
            const fogGeometry = new THREE.PlaneGeometry(width + 20, depth + 20);
            const fogMaterial = new THREE.MeshBasicMaterial({
                color: 0x331155,
                transparent: true,
                opacity: 0.15,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });
            const fog = new THREE.Mesh(fogGeometry, fogMaterial);
            fog.rotation.x = -Math.PI / 2;
            fog.position.y = 0.5;
            building.add(fog);
        }
    }

    createComplexTower(building, width, height, depth) {
        // "SynthCity" Style: Stacked, offset blocks logic
        const levels = Math.floor(3 + Math.random() * 3); // 3 to 5 levels
        let currentY = 0;

        // Use ONE material for the whole building (like SynthCity)
        const buildingSeed = Math.random();
        const buildingMat = this.getBuildingMaterial(buildingSeed);

        const geometries = [];

        // Base block
        const baseH = height * (0.3 + Math.random() * 0.2);
        const baseGeom = new THREE.BoxGeometry(width, baseH, depth);
        // Translate logic for merged geometry:
        // Position was: y = baseH / 2
        baseGeom.translate(0, baseH / 2, 0);
        geometries.push(baseGeom);

        currentY += baseH;

        // Stacked blocks
        let currentW = width;
        let currentD = depth;

        for (let i = 1; i < levels; i++) {
            // Reduction
            currentW *= 0.6 + Math.random() * 0.4; // Shrink 60-100%
            currentD *= 0.6 + Math.random() * 0.4;

            // Height rest
            const remainingH = height - currentY;
            if (remainingH < 10) break;

            const blockH = (i === levels - 1) ? remainingH : (remainingH * (0.4 + Math.random() * 0.3));

            const geom = new THREE.BoxGeometry(currentW, blockH, currentD);

            // Offset (Cantilever effect)
            const offsetX = (Math.random() - 0.5) * (width - currentW) * 0.8;
            const offsetZ = (Math.random() - 0.5) * (depth - currentD) * 0.8;

            // Translate: position + offset
            geom.translate(offsetX, currentY + blockH / 2, offsetZ);
            geometries.push(geom);

            currentY += blockH;
        }

        // OPTIMIZED: Merge all blocks into one mesh
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const mesh = new THREE.Mesh(merged, buildingMat);
            building.add(mesh);
        }

        this.createRooftopDetails(building, currentW, height, currentD);
    }

    createStandardTower(building, width, height, depth) {
        // Standard rectangular tower using SynthCity textures
        // Each building gets ONE material for consistency
        const buildingSeed = Math.random();
        const bodyMaterial = height > 400
            ? this.getBigBuildingMaterial(buildingSeed, Math.random() > 0.8)
            : this.getBuildingMaterial(buildingSeed);

        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height / 2;
        body.userData.material = bodyMaterial;
        building.add(body);

        // Rooftop details
        this.createRooftopDetails(building, width, height, depth);

        // Random chance for step-back design
        if (height > 900 && Math.random() > 0.6) {
            const stepHeight = height * 0.25;
            const stepGeometry = new THREE.BoxGeometry(width * 0.6, stepHeight, depth * 0.6);
            const step = new THREE.Mesh(stepGeometry, bodyMaterial);
            step.position.y = height + stepHeight / 2;
            building.add(step);
        }
    }

    createSteppedBuilding(building, width, height, depth) {
        // Building with stepped setbacks (pyramid-like)
        const levels = 3;
        const levelHeight = height / levels;

        // One material for the whole building
        const buildingMat = this.getBuildingMaterial(Math.random());
        const geometries = [];

        for (let i = 0; i < levels; i++) {
            const scale = 1 - (i * 0.2);
            const h = levelHeight;
            const geometry = new THREE.BoxGeometry(width * scale, h, depth * scale);
            // Translate: y = (i * h) + h / 2
            geometry.translate(0, (i * h) + h / 2, 0);
            geometries.push(geometry);
        }

        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const mesh = new THREE.Mesh(merged, buildingMat);
            building.add(mesh);
        }

        this.createRooftopDetails(building, width * 0.6, height, depth * 0.6);
    }

    createSpireBuilding(building, width, height, depth) {
        // Building with clean rooftop (no poles)
        const bodyMaterial = this.getBuildingMaterial(Math.random());
        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height / 2;
        building.add(body);

        this.createRooftopDetails(building, width, height, depth);
    }

    createWideBaseBuilding(building, width, height, depth) {
        // Building with wide base that narrows - ONE material for whole building
        const buildingMat = this.getBuildingMaterial(Math.random());
        const geometries = [];

        const baseGeometry = new THREE.BoxGeometry(width * 1.3, height * 0.3, depth * 1.3);
        baseGeometry.translate(0, height * 0.15, 0);
        geometries.push(baseGeometry);

        // Upper tower
        const towerGeometry = new THREE.BoxGeometry(width * 0.7, height * 0.7, depth * 0.7);
        // Translate: y = height * 0.3 + height * 0.35
        towerGeometry.translate(0, height * 0.65, 0);
        geometries.push(towerGeometry);

        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const mesh = new THREE.Mesh(merged, buildingMat);
            building.add(mesh);
        }

        this.createRooftopDetails(building, width * 0.7, height, depth * 0.7);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Get building material (SynthCity-style noise-based selection)
    // ─────────────────────────────────────────────────────────────────────────
    getBuildingMaterial(seed = Math.random()) {
        // Use noise-based selection for visual variety (like SynthCity)
        if (this.assets?.loaded) {
            return this.assets.getBuildingMaterial(seed);
        }

        // Fallback to procedural shader if assets not loaded
        if (this.buildingMaterial) {
            const fallback = this.buildingMaterial.clone();
            fallback.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
            fallback.uniforms.uSeed.value = seed * 1000;
            return fallback;
        }

        // Last resort: simple dark material
        return new THREE.MeshPhongMaterial({
            color: 0x1a1a2e,
            shininess: 0,
        });
    }

    /**
     * Get "big building" material (for tall towers)
     */
    getBigBuildingMaterial(seed = Math.random(), rare = false) {
        if (this.assets?.loaded) {
            return this.assets.getBigBuildingMaterial(seed, rare);
        }
        return this.getBuildingMaterial(seed);
    }

    // No longer the primary method - windows are now textured from SynthCity
    createWindowStrips() {
        // Removed - using texture-based windows now
    }

    getRandomWindowColor() {
        // WARM window lights like the reference - yellows, oranges, warm whites
        const colors = [
            0xffdd88, // Warm golden
            0xffcc66, // Amber yellow
            0xffaa44, // Orange
            0xffeeaa, // Warm white
            0xff9955, // Deep amber
            0xffeedd, // Cream
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    getRenderPixelRatio() {
        const baseRatio = this.getEffectivePixelRatio(this.maxPixelRatio);
        const scaledRatio = baseRatio * this.dynamicResolutionScale;
        return Math.max(0.25, Math.min(this.maxPixelRatio, scaledRatio));
    }

    getPostProcessingScale() {
        return this.qualityPreset?.enablePostProcessing ? this.postProcessingScale : 1.0;
    }

    applyRenderScale(force = false) {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRenderPixelRatio();
        const postScale = this.getPostProcessingScale();

        const metrics = this.renderMetrics;
        if (
            !force
            && metrics
            && metrics.width === width
            && metrics.height === height
            && metrics.pixelRatio === pixelRatio
            && metrics.postScale === postScale
        ) {
            return;
        }

        this.renderMetrics = {
            width, height, pixelRatio, postScale,
        };

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height);

        if (this.composer) {
            const targetWidth = Math.max(1, Math.floor(width * pixelRatio * postScale));
            const targetHeight = Math.max(1, Math.floor(height * pixelRatio * postScale));
            this.composer.setSize(targetWidth, targetHeight);

            if (this.bloomPass) {
                this.bloomPass.resolution.set(targetWidth, targetHeight);
            }
        }

        if (this.starfield?.material?.uniforms?.uPixelRatio) {
            this.starfield.material.uniforms.uPixelRatio.value = pixelRatio;
        }
    }

    updateDynamicResolution(delta) {
        if (!this.renderer) return;

        this.dynamicResolutionElapsed += delta;
        this.dynamicResolutionFrames += 1;

        if (this.dynamicResolutionElapsed < this.dynamicResolutionAdjustInterval) return;

        const fps = this.dynamicResolutionFrames / this.dynamicResolutionElapsed;
        this.dynamicResolutionElapsed = 0;
        this.dynamicResolutionFrames = 0;

        let nextScale = this.dynamicResolutionScale;

        if (fps < this.dynamicResolutionLowerFPS) {
            nextScale = Math.max(this.dynamicResolutionMin, nextScale - this.dynamicResolutionStep);
        } else if (fps > this.dynamicResolutionUpperFPS) {
            nextScale = Math.min(this.dynamicResolutionMax, nextScale + this.dynamicResolutionStep);
        }

        if (nextScale !== this.dynamicResolutionScale) {
            this.dynamicResolutionScale = nextScale;
            this.applyRenderScale();
        }
    }

    getRooftopBeaconResources() {
        if (!this.rooftopBeaconGeometry) {
            this.rooftopBeaconGeometry = new THREE.SphereGeometry(2.5, 10, 10);
        }
        if (!this.rooftopBeaconMaterial) {
            this.rooftopBeaconMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        }
        return {
            geometry: this.rooftopBeaconGeometry,
            material: this.rooftopBeaconMaterial,
        };
    }

    getRooftopMaterials() {
        if (!this.rooftopMaterials) {
            this.rooftopMaterials = {
                ac: new THREE.MeshStandardMaterial({
                    color: 0x444455,
                    metalness: 0.6,
                    roughness: 0.5,
                }),
                tank: new THREE.MeshStandardMaterial({
                    color: 0x333333,
                    metalness: 0.3,
                    roughness: 0.8,
                }),
                dish: new THREE.MeshStandardMaterial({
                    color: 0x555566,
                    metalness: 0.7,
                    roughness: 0.4,
                }),
                pipe: new THREE.MeshStandardMaterial({
                    color: 0x444444,
                    metalness: 0.6,
                    roughness: 0.5,
                }),
            };
        }
        return this.rooftopMaterials;
    }

    addRooftopBeacons(building, width, roofHeight, depth, options = {}) {
        const {
            chance = 0.75,
            minCount = 1,
            maxCount = 3,
            spread = 0.6,
            yOffset = 2.5,
            heightForBoost = roofHeight,
        } = options;

        if (Math.random() > chance) return;

        const heightBoost = heightForBoost > 900 ? 1 : 0;
        const resolvedMax = Math.max(minCount, maxCount + heightBoost);
        const count = minCount + Math.floor(Math.random() * (resolvedMax - minCount + 1));
        const { geometry, material } = this.getRooftopBeaconResources();

        for (let i = 0; i < count; i++) {
            const beacon = new THREE.Mesh(geometry, material);
            beacon.position.set(
                (Math.random() - 0.5) * width * spread,
                roofHeight + yOffset,
                (Math.random() - 0.5) * depth * spread,
            );
            const pattern = Math.random() < 0.35 ? 'double' : 'single';
            Object.assign(beacon.userData, this.createBlinkProfile(pattern));
            beacon.userData.blinkPhase = Math.random() * Math.PI * 2;
            building.add(beacon);
            this.streetLights.push(beacon);
        }
    }

    addRooftopBeaconsAt(x, z, rotationY, width, roofHeight, depth, options = {}) {
        const {
            chance = 0.75,
            minCount = 1,
            maxCount = 3,
            spread = 0.6,
            yOffset = 2.5,
            heightForBoost = roofHeight,
        } = options;

        if (Math.random() > chance) return;

        const heightBoost = heightForBoost > 900 ? 1 : 0;
        const resolvedMax = Math.max(minCount, maxCount + heightBoost);
        const count = minCount + Math.floor(Math.random() * (resolvedMax - minCount + 1));
        const { geometry, material } = this.getRooftopBeaconResources();
        const basePosition = new THREE.Vector3(x, 0, z);
        const rotationAxis = new THREE.Vector3(0, 1, 0);

        for (let i = 0; i < count; i++) {
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * width * spread,
                roofHeight + yOffset,
                (Math.random() - 0.5) * depth * spread,
            );
            offset.applyAxisAngle(rotationAxis, rotationY);

            const beacon = new THREE.Mesh(geometry, material);
            beacon.position.copy(basePosition).add(offset);
            const pattern = Math.random() < 0.35 ? 'double' : 'single';
            Object.assign(beacon.userData, this.createBlinkProfile(pattern));
            beacon.userData.blinkPhase = Math.random() * Math.PI * 2;
            this.scene.add(beacon);
            this.streetLights.push(beacon);
            this.freeStandingBeacons.push(beacon);
        }
    }

    createBlinkProfile(pattern = 'single', options = {}) {
        const resolvedPattern = pattern === 'double' ? 'double' : 'single';
        const fpmMin = resolvedPattern === 'double' ? 20 : 20;
        const fpmMax = resolvedPattern === 'double' ? 30 : 40;
        const fpm = options.fpm ?? (fpmMin + Math.random() * (fpmMax - fpmMin));
        const period = options.period ?? (60 / fpm);
        const profile = {
            blinkPattern: resolvedPattern,
            blinkPeriod: period,
            blinkOffset: options.offset ?? Math.random() * period,
            blinkRamp: options.ramp ?? 0.04,
        };

        if (resolvedPattern === 'double') {
            profile.blinkPulseOn = options.pulseOn ?? (0.11 + Math.random() * 0.05);
            profile.blinkPulseGap = options.pulseGap ?? (0.12 + Math.random() * 0.08);
            profile.blinkPulseOn2 = options.pulseOn2 ?? (0.11 + Math.random() * 0.05);
        } else {
            profile.blinkOnDuration = options.onDuration ?? (0.14 + Math.random() * 0.08);
        }

        return profile;
    }

    buildFlightCollisionBounds() {
        const bounds = [];
        const range = this.vehicleRange || 2500;
        const zMin = -range - 200;
        const zMax = range + 200;
        const box = this._flightBoundsBox || (this._flightBoundsBox = new THREE.Box3());

        this.buildings.forEach((building) => {
            const width = building.userData?.width;
            const depth = building.userData?.depth;
            const height = building.userData?.height;
            let minX; let maxX; let minZ; let maxZ; let
                maxY;

            if (width && depth && height) {
                const rotSteps = Math.round(building.rotation.y / (Math.PI / 2)) % 4;
                const swapped = rotSteps % 2 !== 0;
                const halfX = (swapped ? depth : width) / 2;
                const halfZ = (swapped ? width : depth) / 2;
                minX = building.position.x - halfX;
                maxX = building.position.x + halfX;
                minZ = building.position.z - halfZ;
                maxZ = building.position.z + halfZ;
                maxY = height;
            } else {
                box.setFromObject(building);
                minX = box.min.x;
                maxX = box.max.x;
                minZ = box.min.z;
                maxZ = box.max.z;
                maxY = box.max.y;
            }

            if (maxZ < zMin || minZ > zMax) return;
            bounds.push({
                minX, maxX, minZ, maxZ, height: maxY,
            });
        });

        this.outerBuildingBounds.forEach((bound) => {
            if (bound.maxZ < zMin || bound.minZ > zMax) return;
            bounds.push(bound);
        });

        this.flightCollisionBounds = bounds;
    }

    getRequiredFlightHeight(x, wobbleX = 0) {
        const bounds = this.flightCollisionBounds;
        if (!bounds || bounds.length === 0) return 0;

        const range = this.vehicleRange || 2500;
        const zMin = -range;
        const zMax = range;
        const lateralBuffer = 12;
        const verticalBuffer = 40;
        const span = wobbleX + lateralBuffer;
        let required = 0;

        for (let i = 0; i < bounds.length; i++) {
            const bound = bounds[i];
            if (x + span < bound.minX || x - span > bound.maxX) continue;
            if (bound.maxZ < zMin || bound.minZ > zMax) continue;
            required = Math.max(required, bound.height + verticalBuffer);
        }

        return required;
    }

    getClearFlightPosition(xRange, yRange, wobbleX = 0, attempts = 16) {
        for (let i = 0; i < attempts; i++) {
            const x = THREE.MathUtils.lerp(xRange.min, xRange.max, Math.random());
            const minY = Math.max(yRange.min, this.getRequiredFlightHeight(x, wobbleX));
            if (minY > yRange.max) continue;

            const y = THREE.MathUtils.lerp(minY, yRange.max, Math.random());
            return { x, y };
        }

        const fallbackX = THREE.MathUtils.lerp(xRange.min, xRange.max, 0.5);
        const fallbackMinY = Math.min(yRange.max, Math.max(yRange.min, this.getRequiredFlightHeight(fallbackX, wobbleX)));
        return { x: fallbackX, y: fallbackMinY };
    }

    computePulseAlpha(timeInPeriod, start, duration, ramp) {
        if (timeInPeriod < start || timeInPeriod >= start + duration) return 0;
        if (!ramp || ramp <= 0) return 1;
        const local = timeInPeriod - start;
        const fade = Math.min(ramp, duration / 2);
        if (local < fade) return local / fade;
        if (local > duration - fade) return (duration - local) / fade;
        return 1;
    }

    computeBlinkAlpha(light, time) {
        const period = light.userData.blinkPeriod;
        const pattern = light.userData.blinkPattern;
        if (!period || !pattern) {
            const blink = Math.sin(time * 2 + (light.userData.blinkPhase || 0)) > 0.7;
            return blink ? 1 : 0;
        }

        const offset = light.userData.blinkOffset
            ?? ((light.userData.blinkPhase || 0) / (Math.PI * 2)) * period;
        const t = (time + offset) % period;
        const ramp = light.userData.blinkRamp ?? 0;

        if (pattern === 'double') {
            const on1 = light.userData.blinkPulseOn ?? 0.12;
            const gap = light.userData.blinkPulseGap ?? 0.12;
            const on2 = light.userData.blinkPulseOn2 ?? on1;
            const alpha1 = this.computePulseAlpha(t, 0, on1, ramp);
            const alpha2 = this.computePulseAlpha(t, on1 + gap, on2, ramp);
            return Math.max(alpha1, alpha2);
        }

        const onDuration = light.userData.blinkOnDuration ?? 0.18;
        return this.computePulseAlpha(t, 0, onDuration, ramp);
    }

    createRooftopDetails(building, width, height, depth) {
        // Rooftop beacons (no poles)
        this.addRooftopBeacons(building, width, height, depth, {
            chance: 0.85,
            minCount: 1,
            maxCount: 3,
            spread: 0.65,
            yOffset: 3,
        });

        const materials = this.getRooftopMaterials();

        // AC units / mechanical
        const acCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < acCount; i++) {
            const acGeometry = new THREE.BoxGeometry(15 + Math.random() * 10, 10, 15 + Math.random() * 10);
            const ac = new THREE.Mesh(acGeometry, materials.ac);
            ac.position.set(
                (Math.random() - 0.5) * width * 0.7,
                height + 5,
                (Math.random() - 0.5) * depth * 0.7,
            );
            ac.userData.rooftopBatch = 'ac';
            building.add(ac);
        }

        // Water tank (cylindrical)
        if (Math.random() > 0.6) {
            const tankRadius = 8 + Math.random() * 6;
            const tankHeight = 20 + Math.random() * 15;
            const tankGeometry = new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 12);
            const tank = new THREE.Mesh(tankGeometry, materials.tank);
            tank.position.set(
                (Math.random() - 0.5) * width * 0.5,
                height + tankHeight / 2,
                (Math.random() - 0.5) * depth * 0.5,
            );
            tank.userData.rooftopBatch = 'tank';
            building.add(tank);
        }

        // Satellite dish
        if (Math.random() > 0.7) {
            const dishSize = 6 + Math.random() * 4;
            const dishGeometry = new THREE.SphereGeometry(dishSize, 12, 8, 0, Math.PI);
            const dish = new THREE.Mesh(dishGeometry, materials.dish);
            dish.position.set(
                (Math.random() - 0.5) * width * 0.6,
                height + 3,
                (Math.random() - 0.5) * depth * 0.6,
            );
            dish.rotation.x = -Math.PI / 4 + Math.random() * 0.3;
            dish.rotation.y = Math.random() * Math.PI * 2;
            dish.userData.rooftopBatch = 'dish';
            building.add(dish);
        }

        // Pipes running along roof edge
        if (Math.random() > 0.5) {
            const pipeRadius = 1 + Math.random();
            const pipeLength = Math.min(width, depth) * 0.8;
            const pipeGeometry = new THREE.CylinderGeometry(pipeRadius, pipeRadius, pipeLength, 8);
            const pipe = new THREE.Mesh(pipeGeometry, materials.pipe);
            pipe.rotation.z = Math.PI / 2;
            pipe.position.set(
                0,
                height + 2,
                (Math.random() > 0.5 ? 1 : -1) * depth * 0.4,
            );
            pipe.userData.rooftopBatch = 'pipe';
            building.add(pipe);
        }
    }

    batchRooftopProps() {
        if (this.rooftopPropsBatched || this.buildings.length === 0) return;

        const batchGeometries = new Map();
        const meshesToRemove = [];
        const geometriesToDispose = new Set();

        this.buildings.forEach((building) => {
            building.updateMatrixWorld(true);
            building.traverse((child) => {
                const batchKey = child.userData?.rooftopBatch;
                if (!batchKey || !child.geometry) return;

                const geom = child.geometry.clone();
                geom.applyMatrix4(child.matrixWorld);

                if (!batchGeometries.has(batchKey)) {
                    batchGeometries.set(batchKey, []);
                }
                batchGeometries.get(batchKey).push(geom);
                meshesToRemove.push(child);
                geometriesToDispose.add(child.geometry);
            });
        });

        if (batchGeometries.size === 0) return;

        const materials = this.getRooftopMaterials();
        const materialMap = {
            ac: materials.ac,
            tank: materials.tank,
            dish: materials.dish,
            pipe: materials.pipe,
        };

        batchGeometries.forEach((geometries, key) => {
            if (!geometries.length || !materialMap[key]) return;
            const merged = mergeGeometries(geometries);
            if (!merged) return;

            merged.computeBoundingSphere();
            const mesh = new THREE.Mesh(merged, materialMap[key]);
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            this.scene.add(mesh);
            this.rooftopBatchMeshes.push(mesh);
        });

        meshesToRemove.forEach((mesh) => {
            if (mesh.parent) mesh.parent.remove(mesh);
        });

        geometriesToDispose.forEach((geom) => geom.dispose());
        this.rooftopPropsBatched = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Street
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Street Lanterns
    // ─────────────────────────────────────────────────────────────────────────
    createStreetLanterns() {
        // Floating Cyberpunk Lanterns - OPTIMIZED: InstancedMesh
        const lanternGeometry = new THREE.CylinderGeometry(1.5, 1.5, 4, 6);
        const lanternMaterial = new THREE.MeshStandardMaterial({
            color: 0xff4400,
            emissive: 0xff8800,
            emissiveIntensity: 4.0, // Increased intensity to compensate for lack of PointLight
            roughness: 0.4,
            metalness: 0.8,
        });

        // Store positions for instancing
        const instances = [];

        // Place along the street
        for (let z = -300; z < 200; z += 40) {
            // Left Side
            if (Math.random() > 0.3) {
                instances.push({
                    x: -25,
                    y: 20 + Math.random() * 5,
                    z: z + (Math.random() - 0.5) * 10,
                    floatOffset: Math.random() * 100,
                    floatSpeed: 0.5 + Math.random() * 0.5,
                });
            }

            // Right Side
            if (Math.random() > 0.3) {
                instances.push({
                    x: 25,
                    y: 20 + Math.random() * 5,
                    z: z + (Math.random() - 0.5) * 10,
                    floatOffset: Math.random() * 100,
                    floatSpeed: 0.5 + Math.random() * 0.5,
                });
            }
        }

        if (instances.length === 0) return;

        const mesh = new THREE.InstancedMesh(lanternGeometry, lanternMaterial, instances.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Needed for animation

        const dummy = new THREE.Object3D();
        instances.forEach((data, i) => {
            dummy.position.set(data.x, data.y, data.z);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });

        mesh.userData.instances = instances; // Store data for animation
        this.streetLights.push(mesh); // Add to animation loop
        this.scene.add(mesh);
    }

    createStreet() {
        // ═══════════════════════════════════════════════════════════════════════
        // HIGH QUALITY WET ASPHALT - Extended Road
        // ═══════════════════════════════════════════════════════════════════════
        const groundGeometry = new THREE.PlaneGeometry(2000, 6000, 1, 1);

        // Need UV2 for AO map
        groundGeometry.setAttribute('uv2', groundGeometry.attributes.uv);

        // Create PLACEHOLDER material first (instant display - purple asphalt color)
        const wetAsphaltMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x2a1a3a, // Purple-ish asphalt color
            roughness: 0.15, // Low base roughness for wet look (was 0.6)
            metalness: 0.0,
            envMapIntensity: 2.0, // Strong env reflections
            clearcoat: 0.8, // Strong wet clearcoat (was 0.3)
            clearcoatRoughness: 0.0,
        });

        // Store reference for later texture swap
        this.groundMaterial = wetAsphaltMaterial;

        // ASYNC load PBR textures in background (non-blocking)
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/neon-district/';

        // Use Promise.all to load all textures in parallel
        const texturePromises = [
            new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_diff_2k.jpg`, resolve, undefined, () => resolve(null))),
            new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_nor_gl_2k.jpg`, resolve, undefined, () => resolve(null))),
            new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_rough_2k.jpg`, resolve, undefined, () => resolve(null))),
            new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_ao_2k.jpg`, resolve, undefined, () => resolve(null))),
        ];

        Promise.all(texturePromises).then(([diffuseMap, normalMap, roughnessMap, aoMap]) => {
            if (!this.isActive) return;

            // Configure loaded textures
            [diffuseMap, normalMap, roughnessMap, aoMap].filter((t) => t).forEach((tex) => {
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(4, 12); // Tiling adjusted for much longer road
            });

            // Apply textures to material (upgrade from placeholder)
            if (diffuseMap) wetAsphaltMaterial.map = diffuseMap;
            if (normalMap) {
                wetAsphaltMaterial.normalMap = normalMap;
                wetAsphaltMaterial.normalScale = new THREE.Vector2(1.0, 1.0);
            }
            if (roughnessMap) wetAsphaltMaterial.roughnessMap = roughnessMap;
            if (aoMap) {
                wetAsphaltMaterial.aoMap = aoMap;
                wetAsphaltMaterial.aoMapIntensity = 1.0;
            }

            wetAsphaltMaterial.needsUpdate = true;
            console.log('[NeonDistrict] PBR textures loaded and applied');
        });

        // Store uniforms for animation
        this.groundUniforms = {
            uTime: { value: 0 },
            uCameraPos: { value: new THREE.Vector3() },
            uLightPositions: { value: new Array(8).fill(0).map(() => new THREE.Vector3(0, 1000, 0)) },
            uLightColors: { value: new Array(8).fill(0).map(() => new THREE.Color(0x000000)) },
        };

        // ═══════════════════════════════════════════════════════════════════════
        // SHADER INJECTION - Add puddle/ripple effects via onBeforeCompile
        // ═══════════════════════════════════════════════════════════════════════
        wetAsphaltMaterial.onBeforeCompile = (shader) => {
            // Add our custom uniforms
            shader.uniforms.uTime = this.groundUniforms.uTime;
            shader.uniforms.uCameraPos = this.groundUniforms.uCameraPos;
            shader.uniforms.uLightPositions = this.groundUniforms.uLightPositions;
            shader.uniforms.uLightColors = this.groundUniforms.uLightColors;

            // ─────────────────────────────────────────────────────────────────
            // VERTEX SHADER - Add varyings for world position
            // ─────────────────────────────────────────────────────────────────
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                varying vec3 vWorldPos;
                varying vec2 vUvGround;`,
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vUvGround = uv;`,
            );

            // ─────────────────────────────────────────────────────────────────
            // FRAGMENT SHADER - Inject puddle/ripple logic
            // ─────────────────────────────────────────────────────────────────
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                
                uniform float uTime;
                uniform vec3 uCameraPos;
                uniform vec3 uLightPositions[8];
                uniform vec3 uLightColors[8];
                
                varying vec3 vWorldPos;
                varying vec2 vUvGround;
                
                // ═══════════════════════════════════════════════════════════════
                // FARAZ-STYLE HASH FUNCTIONS
                // ═══════════════════════════════════════════════════════════════
                float hash12(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                    p3 += dot(p3, p3.yzx + 19.19);
                    return fract((p3.x + p3.y) * p3.z);
                }
                
                vec2 hash22(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
                    p3 += dot(p3, p3.yzx + 19.19);
                    return fract((p3.xx + p3.yz) * p3.zy);
                }
                
                // ═══════════════════════════════════════════════════════════════
                // FARAZ-STYLE RIPPLES - Grid-based with 3x3 neighbor sampling
                // ═══════════════════════════════════════════════════════════════
                #define MAX_RADIUS 1
                
                vec3 getRipples(vec2 uv, float time) {
                    vec2 p0 = floor(uv);
                    float t = time * 3.0;
                    
                    vec2 circles = vec2(0.0);
                    
                    for (int j = -MAX_RADIUS; j <= MAX_RADIUS; ++j) {
                        for (int i = -MAX_RADIUS; i <= MAX_RADIUS; ++i) {
                            vec2 pi = p0 + vec2(float(i), float(j));
                            vec2 hsh = pi;
                            vec2 p = pi + hash22(hsh);
                            
                            float cellTime = fract(0.3 * t + hash12(hsh));
                            vec2 v = p - uv;
                            float d = length(v) - (float(MAX_RADIUS) + 1.0) * cellTime;
                            
                            float h = 0.01;
                            float d1 = d - h;
                            float d2 = d + h;
                            float p1 = sin(31.0 * d1) * smoothstep(-0.6, -0.3, d1) * smoothstep(0.0, -0.3, d1);
                            float p2 = sin(31.0 * d2) * smoothstep(-0.6, -0.3, d2) * smoothstep(0.0, -0.3, d2);
                            
                            float vLen = length(v);
                            if (vLen > 0.001) {
                                circles += 0.5 * (v / vLen) * ((p2 - p1) / (2.0 * h) * (1.0 - cellTime) * (1.0 - cellTime));
                            }
                        }
                    }
                    
                    circles /= float((MAX_RADIUS * 2 + 1) * (MAX_RADIUS * 2 + 1));
                    float circlesDot = clamp(dot(circles, circles), 0.0, 1.0);
                    return vec3(circles, sqrt(1.0 - circlesDot));
                }
                
                // ═══════════════════════════════════════════════════════════════
                // PUDDLE DETECTION using Smooth FBM (like Faraz's gln_sfbm)
                // ═══════════════════════════════════════════════════════════════
                
                // Smooth value noise with interpolation
                float valueNoise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    
                    // Smooth interpolation
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    
                    // Four corners
                    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
                    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
                    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
                    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
                    
                    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                }
                
                // Multi-octave FBM for organic shapes
                float fbmNoise(vec2 p) {
                    float f = 0.0;
                    float amplitude = 0.5;
                    float frequency = 1.0;
                    
                    for(int i = 0; i < 5; i++) {
                        f += amplitude * valueNoise(p * frequency);
                        amplitude *= 0.5;
                        frequency *= 2.0;
                    }
                    return f;
                }
                
                // Faraz-style puddle detection with distinct hotspots
                float getPuddle(vec2 uv) {
                    // Multiple noise layers for organic shape variation
                    float n1 = fbmNoise((uv + vec2(3.0, 0.0)) * 0.2);
                    float n2 = fbmNoise((uv + vec2(-5.0, 2.0)) * 0.35);
                    float combined = (n1 * 0.7 + n2 * 0.3);
                    
                    // Add distinct puddle hotspots at random locations
                    float hotspots = 0.0;
                    
                    // Puddle hotspot positions (in world space scaled by 0.015)
                    vec2 spots[8];
                    spots[0] = vec2(-1.5, -0.8);
                    spots[1] = vec2(2.0, -2.5);
                    spots[2] = vec2(-0.5, -4.0);
                    spots[3] = vec2(1.8, -5.5);
                    spots[4] = vec2(-2.2, -7.0);
                    spots[5] = vec2(0.8, -8.5);
                    spots[6] = vec2(-1.0, -10.0);
                    spots[7] = vec2(2.5, -12.0);
                    
                    for(int i = 0; i < 8; i++) {
                        float dist = length(uv - spots[i] * 100.0);
                        // Organic-shaped hotspot using noise-modulated radius
                        float radius = 25.0 + fbmNoise(spots[i] * 50.0) * 15.0;
                        float spot = 1.0 - smoothstep(0.0, radius, dist);
                        hotspots = max(hotspots, spot);
                    }
                    
                    // Combine base wetness with distinct hotspots
                    combined = smoothstep(0.35, 0.65, combined);
                    float result = max(combined * 0.6, hotspots);
                    
                    return result;
                }
                
                // Perturb normal with ripple effect
                vec3 perturbNormal(vec3 inputNormal, vec3 noiseNormal, float strength) {
                    vec3 noiseNormalOrthogonal = noiseNormal - (dot(noiseNormal, inputNormal) * inputNormal);
                    return normalize(inputNormal - noiseNormalOrthogonal * strength);
                }
                `,
            );

            // Inject puddle/roughness modifications BEFORE lighting calculation
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `#include <roughnessmap_fragment>
                
                // ═══════════════════════════════════════════════════════════════
                // PUDDLE & WET SURFACE MODIFICATIONS - Faraz-style
                // ═══════════════════════════════════════════════════════════════
                float puddle = getPuddle(vWorldPos.xz * 0.015);
                
                // Full wetness in puddle areas for mirror-like reflections
                float wetness = smoothstep(0.0, 0.5, puddle);
                
                // Wet surfaces have VERY LOW roughness (near mirror)
                float wetRoughness = mix(roughnessFactor, 0.01, wetness);
                roughnessFactor = clamp(wetRoughness, 0.01, 0.3);
                `,
            );

            // Inject normal perturbation for ripples
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `#include <normal_fragment_maps>
                
                // ═══════════════════════════════════════════════════════════════
                // RAIN RIPPLE NORMAL PERTURBATION
                // ═══════════════════════════════════════════════════════════════
                float puddle2 = getPuddle(vWorldPos.xz * 0.02);
                
                // Larger ripples (lower frequency) per user request
                vec3 rippleNormal = getRipples(vWorldPos.xz * 0.15, uTime);
                vec3 rippleNormal2 = getRipples(vWorldPos.xz * 0.1 + vec2(100.0), uTime * 0.85);
                vec3 combinedRipple = normalize(rippleNormal + rippleNormal2 * 0.5);
                
                // Stronger ripples in puddle areas
                float rippleStrength = 0.15 + puddle2 * 0.35;
                normal = perturbNormal(normal, combinedRipple, rippleStrength);
                `,
            );

            // Add neon light reflections to final color
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <output_fragment>',
                `
                // ═══════════════════════════════════════════════════════════════
                // NEON LIGHT REFLECTIONS - Vibrant colored light on wet pavement
                // ═══════════════════════════════════════════════════════════════
                vec3 neonReflection = vec3(0.0);
                vec3 viewDirGround = normalize(uCameraPos - vWorldPos);
                float puddle3 = getPuddle(vWorldPos.xz * 0.02);
                
                // High base wetness for always-visible reflections
                float wetness3 = 0.7 + puddle3 * 0.3;
                
                for(int i = 0; i < 8; i++) {
                    vec3 lightPos = uLightPositions[i];
                    vec3 lightColor = uLightColors[i];
                    
                    // Skip invalid lights (placed far away)
                    if (lightPos.y > 500.0) continue;
                    
                    float dist = distance(vWorldPos, lightPos);
                    
                    // Very gentle falloff for maximum reach
                    float atten = 1.0 / (1.0 + dist * 0.001 + dist * dist * 0.000002);
                    
                    // Wide elongated streaks (like real wet road reflections)
                    float zDist = abs(vWorldPos.z - lightPos.z);
                    float xDist = abs(vWorldPos.x - lightPos.x);
                    float streakFalloff = exp(-xDist * 0.008) * exp(-zDist * 0.001);
                    
                    // Specular reflection
                    vec3 lightDir = normalize(lightPos - vWorldPos);
                    vec3 reflectDir = reflect(-lightDir, normal);
                    float spec = pow(max(dot(reflectDir, -viewDirGround), 0.0), 4.0);
                    
                    // Combine: mostly streak-based for elongated look
                    float totalReflect = spec * 0.2 + streakFalloff * 0.8;
                    
                    // Saturate and brighten color for neon pop
                    vec3 saturatedColor = lightColor * 3.0;
                    
                    // MASSIVE intensity boost
                    neonReflection += saturatedColor * totalReflect * atten * 100.0 * wetness3;
                }
                
                // Strong purple/cyan city ambient glow
                float cityGlowMix = smoothstep(-150.0, 150.0, vWorldPos.x);
                vec3 cityGlow = mix(vec3(0.1, 0.3, 0.8), vec3(0.7, 0.1, 0.9), cityGlowMix);
                neonReflection += cityGlow * 1.2 * wetness3;
                
                outgoingLight += neonReflection;
                
                #include <output_fragment>
                `,
            );

            // Store shader reference for uniform updates
            this.groundShader = shader;
        };

        // Need customProgramCacheKey to prevent shader caching issues
        wetAsphaltMaterial.customProgramCacheKey = () => 'neon-district-wet-asphalt';

        const ground = new THREE.Mesh(groundGeometry, wetAsphaltMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(0, 0, -200);
        ground.userData.material = wetAsphaltMaterial;
        this.scene.add(ground);
        this.groundMaterial = wetAsphaltMaterial;

        // Subtle warm spotlight - reduced intensity
        const spotLight = new THREE.SpotLight(0xffaa55, 5, 300, Math.PI / 4, 0.5, 1);
        spotLight.position.set(0, 120, -100);
        spotLight.target.position.set(0, 0, -180);
        this.scene.add(spotLight);
        this.scene.add(spotLight.target);

        // Note: Street lanterns are created separately in Phase 5 of progressive loading

        // Add road markings for detail
        this.createRoadMarkings();

        // Add city glow lights
        // this.createCityGlowLights(); // Removed - visible light dots
    }

    createRoadMarkings() {
        // ═══════════════════════════════════════════════════════════════════════
        // HIGH-RES CENTER LINE - Procedural canvas texture like summer grass
        // ═══════════════════════════════════════════════════════════════════════
        const texSize = 512;
        const canvas = document.createElement('canvas');
        canvas.width = texSize;
        canvas.height = texSize;
        const ctx = canvas.getContext('2d');

        // Base yellow with gradient variation
        const gradient = ctx.createLinearGradient(0, 0, texSize, 0);
        gradient.addColorStop(0, '#cc9900');
        gradient.addColorStop(0.3, '#ffcc00');
        gradient.addColorStop(0.5, '#ffdd22');
        gradient.addColorStop(0.7, '#ffcc00');
        gradient.addColorStop(1, '#cc9900');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, texSize, texSize);

        // Add wear/aging patterns
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * texSize;
            const y = Math.random() * texSize;
            const w = 2 + Math.random() * 6;
            const h = 10 + Math.random() * 30;

            // Darker worn patches
            const darkness = 0.7 + Math.random() * 0.3;
            ctx.fillStyle = `rgba(80, 60, 0, ${1 - darkness})`;
            ctx.fillRect(x, y, w, h);
        }

        // Add subtle edge roughness
        for (let y = 0; y < texSize; y += 2) {
            const edgeVariation = Math.random() * 8;
            // Left edge
            ctx.fillStyle = 'rgba(20, 15, 10, 0.4)';
            ctx.fillRect(0, y, edgeVariation, 2);
            // Right edge
            ctx.fillRect(texSize - edgeVariation, y, edgeVariation, 2);
        }

        // Add paint splatter/texture
        for (let i = 0; i < 100; i++) {
            const x = 20 + Math.random() * (texSize - 40);
            const y = Math.random() * texSize;
            const radius = 1 + Math.random() * 3;

            // Brighter paint spots
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 230, 100, ${0.3 + Math.random() * 0.4})`;
            ctx.fill();
        }

        // Create texture with proper filtering for smooth distance rendering
        const lineTexture = new THREE.CanvasTexture(canvas);
        lineTexture.wrapS = THREE.RepeatWrapping;
        lineTexture.wrapT = THREE.RepeatWrapping;
        lineTexture.repeat.set(1, 30); // Less repetition for smoother look

        // CRITICAL: Proper mipmapping and filtering for smooth distance
        lineTexture.generateMipmaps = true;
        lineTexture.minFilter = THREE.LinearMipmapLinearFilter; // Trilinear filtering
        lineTexture.magFilter = THREE.LinearFilter;
        lineTexture.anisotropy = this.renderer?.capabilities?.getMaxAnisotropy() || 16;

        const lineGeometry = new THREE.PlaneGeometry(4, 10000); // Extended from 3000
        const lineMaterial = new THREE.MeshBasicMaterial({
            map: lineTexture,
            transparent: true,
            opacity: 0.55,
        });
        const centerLine = new THREE.Mesh(lineGeometry, lineMaterial);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.set(0, 2, -1500); // Shifted back to cover -4000 (Length/2 - Offset)
        this.scene.add(centerLine);

        // REMOVED: Circular mesh puddles - now using SHADER-BASED FBM puddles only
        // This creates organic, natural shapes instead of obvious round circles

        console.log('[NeonDistrict] Road markings created (high-res texture)');
    }

    createDistantCityLayers() {
        // Create a backdrop of simple geometry to fill the horizon void

        // Layer 1: Dense silhouettes just behind the fog start (z: -3000 to -4000)
        // Layer 2: Sparse tall towers in the far back (z: -4000 to -6000)

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ color: 0x050010 }); // Very dark purple silhouette

        const count = 300;
        const mesh = new THREE.InstancedMesh(geometry, material, count);

        const dummy = new THREE.Object3D();
        let idx = 0;

        for (let i = 0; i < count; i++) {
            // WIDER distribution to fill side gaps
            const x = (Math.random() - 0.5) * 3000;

            // Deep distance
            const z = -3500 - Math.random() * 2000;

            const w = 100 + Math.random() * 300;
            const h = 500 + Math.random() * 1500; // Tall
            const d = 100 + Math.random() * 300;

            // Avoid the very center where the Mega Tower sits (x: -150 to 150)
            if (Math.abs(x) < 250) continue;

            dummy.position.set(x, h / 2, z);
            dummy.scale.set(w, h, d);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx++, dummy.matrix);
        }

        mesh.count = idx;
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);

        // Add a few "hero" distant lights (simple sprites)
        this.createDistantLights();
    }

    createMoon() {
        // Huge Synthwave Moon/Sun
        const geometry = new THREE.CircleGeometry(800, 64);

        // Custom shader for retro gradient look
        const material = new THREE.ShaderMaterial({
            uniforms: {
                color1: { value: new THREE.Color(0xff00ff) }, // Magenta bottom
                color2: { value: new THREE.Color(0x00ffff) }, // Cyan top
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color1;
                uniform vec3 color2;
                varying vec2 vUv;
                
                void main() {
                    // Vertical gradient
                    vec3 color = mix(color1, color2, vUv.y);
                    
                    // Circular mask (soft edge)
                    float dist = distance(vUv, vec2(0.5));
                    float alpha = smoothstep(0.5, 0.48, dist);
                    
                    // Add scanlines for retro feel
                    float scanline = sin(vUv.y * 100.0) * 0.1;
                    color -= scanline;

                    // Reduce brightness significantly (30% intensity)
                    gl_FragColor = vec4(color * 0.3, alpha);
                }
            `,
            transparent: true,
            depthWrite: false, // Render behind everything opaque
            blending: THREE.AdditiveBlending,
        });

        const moon = new THREE.Mesh(geometry, material);

        // Position: Far background, slightly lower
        // Mega Tower is at z=-4000. We want this BEHIND it.
        moon.position.set(-2500, 2700, -6000);

        // Face camera
        moon.lookAt(0, 50, 0);

        this.scene.add(moon);
        console.log('[NeonDistrict] Cyber Moon created');
    }

    /**
     * Creates a panoramic skyline cylinder to surround the city
     * This fills the void with distant building silhouettes and lights
     */
    createDistantSkyline() {
        // Massive cylinder to surround the entire scene - TALLER as requested
        const geometry = new THREE.CylinderGeometry(4500, 4500, 5000, 64, 1, true);

        // Procedural city texture shader
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor1: { value: new THREE.Color(0x020005) }, // Almost black base
                uColor2: { value: new THREE.Color(0x050010) }, // Very dark top
                uWindowColor: { value: new THREE.Color(0x401060) }, // Dim purple/pink windows (darker)
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform vec3 uWindowColor;
                varying vec2 vUv;
                varying vec3 vWorldPosition;

                // Pseudo-random
                float rand(vec2 co) {
                    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main() {
                    // Mask area behind Mega Tower
                    // Mega Tower is at Z=-4000, X=150. We clear the skyline behind it.
                    if (vWorldPosition.z < -3000.0 && abs(vWorldPosition.x) < 2000.0) discard;

                    // Create skyscraper silhouettes
                    // Grid for buildings
                    float buildingWidth = 0.02; // How wide each distant building is
                    float bIndex = floor(vUv.x / buildingWidth);
                    
                    // Random height for each building segment
                    float bHeight = 0.2 + rand(vec2(bIndex, 0.0)) * 0.4;
                    
                    // Second layer of buildings (offset)
                    float bIndex2 = floor((vUv.x + 0.01) / (buildingWidth * 0.8));
                    float bHeight2 = 0.15 + rand(vec2(bIndex2, 1.0)) * 0.5;
                    
                    // Combine silhouettes
                    float isBuilding = step(vUv.y, bHeight) + step(vUv.y, bHeight2);
                    
                    // Discard sky (let background sky gradient show through)
                    if (isBuilding < 0.5) discard;
                    
                    // Windows - PRECISE PINHEAD PATTERN
                    // High frequency grid for tiny windows
                    vec2 windowGrid = fract(vUv * vec2(800.0, 400.0));
                    float isWindow = step(0.4, windowGrid.x) * step(0.4, windowGrid.y);
                    
                    // Randomly light up windows - SPARSE
                    float windowNoise = rand(floor(vUv * vec2(800.0, 400.0)));
                    float lightsOn = step(0.92, windowNoise) * isWindow; // Only 8% on
                    
                    // Fade windows at bottom (fog) and top
                    lightsOn *= smoothstep(0.0, 0.2, vUv.y);
                    
                    vec3 finalColor = mix(uColor1, uColor2, vUv.y);
                    finalColor += uWindowColor * lightsOn * 2.0; // Glowy windows

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.BackSide, // Render inside of cylinder
            transparent: true,
            depthWrite: false, // Render behind everything
        });

        const skyline = new THREE.Mesh(geometry, material);
        skyline.position.y = 1000; // Shift up (center at 1000, so 5000 height goes -1500 to +3500)
        this.scene.add(skyline);
        console.log('[NeonDistrict] Distant skyline created');
    }

    createSearchlights() {
        this.searchlights = [];
        const coneGeom = new THREE.ConeGeometry(50, 4000, 32, 1, true);
        coneGeom.translate(0, 2000, 0); // Pivot at bottom

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xaaccff) },
            },
            vertexShader: `
                varying float vHeight;
                void main() {
                    vHeight = position.y / 4000.0;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vHeight;
                void main() {
                    // Fade out at top and sharp fade at edges -> "beam" look
                    float alpha = (1.0 - vHeight) * 0.15; // Subtle
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        // Create 6 searchlights
        for (let i = 0; i < 6; i++) {
            const mesh = new THREE.Mesh(coneGeom, material);
            // Position around the city outskirts
            const angle = (i / 6) * Math.PI * 2;
            const radius = 1200 + Math.random() * 800; // Farther out
            mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius - 1000);

            // Random rotation parameters
            mesh.userData = {
                phase: Math.random() * 10,
                speed: 0.3 + Math.random() * 0.4,
                tiltX: 0.1 + Math.random() * 0.2,
                tiltZ: 0.1 + Math.random() * 0.2,
            };

            this.scene.add(mesh);
            this.searchlights.push(mesh);
        }
    }

    updateSearchlights() {
        if (!this.searchlights) return;
        const { time } = this;
        this.searchlights.forEach((light) => {
            // Sweep motion
            const t = time * light.userData.speed + light.userData.phase;
            light.rotation.z = Math.sin(t) * light.userData.tiltZ;
            light.rotation.x = Math.cos(t * 0.7) * light.userData.tiltX;
        });
    }

    createDistantLights() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        for (let i = 0; i < 200; i++) {
            const x = (Math.random() - 0.5) * 3000;
            if (Math.abs(x) < 200) continue; // Skip center

            const y = Math.random() * 1500;
            const z = -3500 - Math.random() * 2000;

            positions.push(x, y, z);

            const color = new THREE.Color();
            color.setHSL(Math.random(), 0.8, 0.5);
            colors.push(color.r, color.g, color.b);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 40,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0.6,
            transparent: true,
        });

        const points = new THREE.Points(geometry, material);
        this.scene.add(points);
    }

    // Ground-level city glow lights - Coming from building sides
    createCityGlowLights() {
        // Lights positioned at building edges, shining down onto street
        const glowPositions = [
            // LEFT SIDE (buildings at x ~ -30 to -50)
            {
                x: -35, y: 20, z: 20, color: 0xff00ff, intensity: 60,
            }, // Magenta
            {
                x: -40, y: 15, z: -30, color: 0x00ffff, intensity: 55,
            }, // Cyan
            {
                x: -38, y: 25, z: -80, color: 0xaa00ff, intensity: 50,
            }, // Purple
            {
                x: -42, y: 18, z: -130, color: 0xff00aa, intensity: 45,
            }, // Pink
            {
                x: -36, y: 22, z: -180, color: 0x8800ff, intensity: 40,
            }, // Deep purple
            {
                x: -45, y: 20, z: -250, color: 0x00ff88, intensity: 35,
            }, // Cyan-green
            {
                x: -38, y: 16, z: -320, color: 0xff66ff, intensity: 30,
            }, // Light magenta

            // RIGHT SIDE (buildings at x ~ 30 to 50)
            {
                x: 38, y: 18, z: 10, color: 0x00ffff, intensity: 60,
            }, // Cyan
            {
                x: 42, y: 22, z: -50, color: 0xff00ff, intensity: 55,
            }, // Magenta
            {
                x: 36, y: 15, z: -100, color: 0x00ff88, intensity: 50,
            }, // Green-cyan
            {
                x: 45, y: 25, z: -160, color: 0xaa00ff, intensity: 45,
            }, // Purple
            {
                x: 40, y: 18, z: -220, color: 0xff00aa, intensity: 40,
            }, // Pink
            {
                x: 35, y: 20, z: -280, color: 0x8800ff, intensity: 35,
            }, // Deep purple
            {
                x: 48, y: 16, z: -350, color: 0x66ffff, intensity: 30,
            }, // Light cyan
        ];

        glowPositions.forEach(({
            x, y, z, color, intensity,
        }) => {
            const light = new THREE.PointLight(color, intensity, 120);
            light.position.set(x, y, z);
            light.decay = 1.8;
            this.scene.add(light);
        });

        console.log('[NeonDistrict] Added building-side neon lights');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Neon Signs and Holographic Ads
    // ─────────────────────────────────────────────────────────────────────────

    async createNeonSigns() {
        this.neonSigns = [];
        const CHUNK_SIZE = 3; // Small chunks to avoid ANY lag during gameplay

        // Process buildings in chunks for non-blocking sign creation
        for (let i = 0; i < this.buildings.length; i += CHUNK_SIZE) {
            if (!this.isActive) return;

            const chunk = this.buildings.slice(i, i + CHUNK_SIZE);
            chunk.forEach((building) => {
                // 80% of buildings have at least one sign
                if (Math.random() > 0.8) return;

                // Add 1-3 signs per building
                const signCount = 1 + Math.floor(Math.random() * 3);
                for (let j = 0; j < signCount; j++) {
                    const type = Math.random();
                    if (type < 0.4) {
                        this.createNeonShape(building);
                    } else if (type < 0.7) {
                        this.createNeonBanner(building);
                    } else {
                        this.createNeonStrip(building);
                    }
                }
            });

            // Wait for idle time - doesn't compete with gameplay
            if (i + CHUNK_SIZE < this.buildings.length) {
                await this.deferToIdleTime();
            }
        }

        // SynthCity textured billboards - positioned on buildings
        // LEFT side billboards
        this.createSynthCityBillboard(-300, 350, -500, true);
        this.createSynthCityBillboard(0, 450, -700, true);
        this.createSynthCityBillboard(-200, 280, -350, false);
        this.createSynthCityBillboard(-380, 360, -550, true);
        this.createSynthCityBillboard(-180, 400, -650, false);
        this.createSynthCityBillboard(-450, 420, -500, true);
        this.createSynthCityBillboard(-250, 320, -250, true); // Closer foreground
        this.createSynthCityBillboard(-350, 480, -750, true); // Higher back
        this.createSynthCityBillboard(-150, 200, -200, false); // Low foreground
        this.createSynthCityBillboard(-420, 300, -400, false); // Mid-left

        // RIGHT side billboards (ensure both sides have ads)
        this.createSynthCityBillboard(300, 320, -400, true);
        this.createSynthCityBillboard(250, 380, -550, false);
        this.createSynthCityBillboard(350, 280, -300, true);
        this.createSynthCityBillboard(280, 450, -600, false);
        this.createSynthCityBillboard(220, 250, -200, true); // Closer foreground
        this.createSynthCityBillboard(380, 420, -700, true); // Higher back
        this.createSynthCityBillboard(150, 180, -150, false); // Low foreground
        this.createSynthCityBillboard(420, 350, -450, false); // Mid-right

        // Holographic billboards - pushed further back (z < -900)
        // Holographic billboards - REMOVED per user request
        /*
        this.createHolographicBillboard(400, 350, -1000);
        this.createHolographicBillboard(300, 450, -1100);
        this.createHolographicBillboard(150, 500, -1200);
        this.createHolographicBillboard(450, 320, -950);
        this.createHolographicBillboard(-350, 400, -1050);
        this.createHolographicBillboard(-200, 480, -1150);
        */

        // Add floating neon strips in the air
        // this.createFloatingNeonElements(); // Removed floating rings and lines per user request
        // Add smoke/steam effects
        this.createSmokeEffects();
    }

    /**
     * Create a billboard using SynthCity's ad textures
     */
    createSynthCityBillboard(x, y, z, isLarge = false) {
        const material = isLarge
            ? this.assets?.getRandomLargeAdMaterial()
            : this.assets?.getRandomAdMaterial();

        if (!material) {
            // Fallback to holographic
            this.createHolographicBillboard(x, y, z);
            return;
        }

        const width = isLarge ? 120 + Math.random() * 60 : 50 + Math.random() * 30;
        const height = isLarge ? 80 + Math.random() * 40 : 35 + Math.random() * 20;
        const geometry = new THREE.PlaneGeometry(width, height);

        const billboard = new THREE.Mesh(geometry, material);
        billboard.position.set(x, y, z);
        // Face the road: right side (x>0) faces left (+90°), left side (x<0) faces right (-90°)
        billboard.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;

        // Add glow light based on ad
        const light = new THREE.PointLight(0xffffff, 2.0, 120);
        billboard.add(light);

        // Store for flicker animation
        billboard.userData.flickerSpeed = 1 + Math.random() * 3;
        billboard.userData.flickerPhase = Math.random() * 10;
        billboard.userData.flickerAmount = 0.1;

        this.neonSigns.push(billboard);
        this.scene.add(billboard);
    }

    /**
     * Create smoke/steam effects using SynthCity textures
     */
    createSmokeEffects() {
        // Add smoke billboards near buildings
        for (let i = 0; i < 8; i++) {
            const material = this.assets?.getRandomSmokeMaterial();
            if (!material) continue;

            const size = 40 + Math.random() * 60;
            const geometry = new THREE.PlaneGeometry(size, size * 1.5);

            const smoke = new THREE.Mesh(geometry, material);
            smoke.position.set(
                (Math.random() - 0.5) * 400,
                200 + Math.random() * 300,
                -200 - Math.random() * 600,
            );

            // Store for billboard (face camera) animation
            smoke.userData.isBillboard = true;
            smoke.userData.rotationSpeed = 0.001 + Math.random() * 0.002;

            this.neonSigns.push(smoke);
            this.scene.add(smoke);
        }

        // Add volumetric spotlight beams
        this.createSpotlightBeams();
    }

    /**
     * Create volumetric spotlight beams streaming down between buildings
     */
    createSpotlightBeams() {
        // Create cone-shaped light beams
        for (let i = 0; i < 6; i++) {
            // Cone geometry for light beam
            const beamHeight = 150 + Math.random() * 200;
            const beamRadius = 30 + Math.random() * 40;
            const geometry = new THREE.ConeGeometry(beamRadius, beamHeight, 16, 1, true);

            // Volumetric light material
            const colors = [0xaa00ff, 0xff00ff, 0x8866ff, 0xcc00ff, 0x00ffff];
            const color = colors[Math.floor(Math.random() * colors.length)];

            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.08,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const beam = new THREE.Mesh(geometry, material);

            // Position beams at various heights pointing down
            beam.position.set(
                (Math.random() - 0.5) * 400,
                300 + Math.random() * 300,
                -300 - Math.random() * 600,
            );

            // Point downward with slight random tilt
            beam.rotation.x = Math.PI + (Math.random() - 0.5) * 0.3;
            beam.rotation.z = (Math.random() - 0.5) * 0.2;

            // Store for animation
            beam.userData.isSpotlight = true;
            beam.userData.pulseSpeed = 0.5 + Math.random() * 0.5;
            beam.userData.pulsePhase = Math.random() * Math.PI * 2;
            beam.userData.baseOpacity = material.opacity;

            this.neonSigns.push(beam);
            this.scene.add(beam);
        }

        console.log('[NeonDistrict] Added volumetric spotlight beams');
    }

    createNeonStrip(building) {
        // Horizontal neon accent strip
        const w = 30 + Math.random() * 50;
        const h = 3 + Math.random() * 5;
        const geometry = new THREE.PlaneGeometry(w, h);

        // Purple-heavy color palette
        const colors = [0xaa00ff, 0xff00ff, 0x8800ff, 0xcc00ff, 0xff00aa, 0x6600ff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);
        this.attachSignToBuilding(building, sign, color);
    }

    createFloatingNeonElements() {
        // Add floating neon rings and lines throughout the scene
        const purpleColors = [0xaa00ff, 0xff00ff, 0x8800ff, 0xcc00ff, 0x6600ff, 0x9933ff];

        // Floating rings
        for (let i = 0; i < 15; i++) {
            const geometry = new THREE.TorusGeometry(5 + Math.random() * 15, 0.8, 8, 32);
            const color = purpleColors[Math.floor(Math.random() * purpleColors.length)];
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending,
            });

            const ring = new THREE.Mesh(geometry, material);
            ring.position.set(
                (Math.random() - 0.5) * 600,
                100 + Math.random() * 400,
                -200 - Math.random() * 800,
            );
            ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

            // Add glow light
            const light = new THREE.PointLight(color, 1.5, 60);
            ring.add(light);

            ring.userData.floatSpeed = 0.3 + Math.random() * 0.5;
            ring.userData.floatOffset = Math.random() * 100;
            this.neonSigns.push(ring);
            this.scene.add(ring);
        }

        // Floating neon lines/tubes
        for (let i = 0; i < 20; i++) {
            const length = 20 + Math.random() * 80;
            const geometry = new THREE.CylinderGeometry(0.5, 0.5, length, 8);
            const color = purpleColors[Math.floor(Math.random() * purpleColors.length)];
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
            });

            const tube = new THREE.Mesh(geometry, material);
            tube.position.set(
                (Math.random() - 0.5) * 500,
                80 + Math.random() * 350,
                -100 - Math.random() * 700,
            );
            tube.rotation.set(
                Math.random() * Math.PI * 0.3,
                Math.random() * Math.PI,
                Math.random() * Math.PI * 0.5,
            );

            this.neonSigns.push(tube);
            this.scene.add(tube);
        }
    }

    createNeonShape(building) {
        // ... (The previous shape logic moved here) ...
        const shapeType = Math.floor(Math.random() * 4);
        let geometry;
        let scale = 1.0;

        switch (shapeType) {
        case 0: geometry = new THREE.TorusGeometry(8, 1.5, 8, 24); break;
        case 1: geometry = new THREE.ConeGeometry(10, 3, 3); scale = 1.2; break;
        case 2: geometry = new THREE.BoxGeometry(3, 40, 3); break;
        case 3: geometry = new THREE.SphereGeometry(6, 16, 16); break;
        }

        // Purple-dominant neon colors
        const colors = [0xff00ff, 0xaa00ff, 0x8800ff, 0xcc00ff, 0xff00aa, 0x6600ff, 0x9933ff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);
        sign.scale.set(scale, scale, scale);

        this.attachSignToBuilding(building, sign, color);
    }

    createNeonBanner(building) {
        // Vertical Text Banner
        const w = 15 + Math.random() * 10;
        const h = 40 + Math.random() * 40;
        const geometry = new THREE.PlaneGeometry(w, h);

        // Purple-biased hue (0.75-0.95 is purple/magenta range)
        const hue = 0.75 + Math.random() * 0.2;
        const color = new THREE.Color().setHSL(hue, 1.0, 0.55);
        const texture = this.generateNeonTexture(); // Use cached texture

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color, // Tint the white texture with color

            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);
        this.attachSignToBuilding(building, sign, color.getHex());
    }

    attachSignToBuilding(building, sign, colorHex) {
        // Position
        const buildingPos = building.position; // Usually 0,0,0 local? No, world pos for standard?
        // Wait, standard buildings are MESHES added to SCENE?
        // In createBuilding: building.position.set(x, 0, z); this.scene.add(building);
        // Correct.

        const yPos = 50 + Math.random() * 200;

        // Offset logic
        // We need approximate bounds of the building.
        // It's tricky with complex towers. Rough assumption: 50 width, 50 depth
        const offset = 40 + Math.random() * 10;
        const face = Math.floor(Math.random() * 4);

        // World space positioning relative to building center
        const bx = building.position.x;
        const bz = building.position.z;

        if (face === 0) { sign.position.set(bx, yPos, bz + offset); sign.rotation.y = 0; } else if (face === 1) { sign.position.set(bx, yPos, bz - offset); sign.rotation.y = Math.PI; } else if (face === 2) { sign.position.set(bx + offset, yPos, bz); sign.rotation.y = Math.PI / 2; } else { sign.position.set(bx - offset, yPos, bz); sign.rotation.y = -Math.PI / 2; }

        this.scene.add(sign);
        this.neonSigns.push(sign);

        // Lights removed for performance (Pure Bloom)
        sign.userData.baseColor = colorHex; // Store base color for reflections

        // Flicker
        sign.userData.flickerSpeed = 2 + Math.random() * 8;
        sign.userData.flickerPhase = Math.random() * 10;
        sign.userData.flickerAmount = 0.3;
    }

    generateNeonTexture() {
        // Initialize cache if needed
        if (!this.neonCache) this.neonCache = {};

        const words = ['BAR', 'HOTEL', 'OPEN', 'DATA', 'TECH', 'ZONE', 'LIVE', 'SEX', 'XXX', 'GIRLS', 'BOYS', 'CLUB'];
        const text = words[Math.floor(Math.random() * words.length)];

        // Check cache
        if (this.neonCache[text]) {
            return this.neonCache[text];
        }

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Black background (for additive blending or simple tinting)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 128, 256);

        // Border - WHITE for tinting
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 120, 248);

        // Text settings
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Rotate text
        ctx.save();
        ctx.translate(64, 128);
        ctx.rotate(-Math.PI / 2);
        ctx.font = 'bold 40px Arial';
        ctx.fillText(text, 0, 0);
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);

        // Cache it
        this.neonCache[text] = texture;
        return texture;
    }

    createHolographicBillboardOnBuilding(building, x, y, z, isLeft, faceCamera = false) {
        // OPTIMIZED: Smaller size for better FPS (was 100-200 x 60-140)
        const width = 60 + Math.random() * 40;
        const height = 40 + Math.random() * 30;

        // Purple color pairs for holographic effect
        const colorPairs = [
            [0xff00ff, 0x8800ff], // Magenta to purple
            [0xaa00ff, 0xff00aa], // Purple to pink
            [0xcc00ff, 0x6600ff], // Bright purple to violet
        ];
        const pair = colorPairs[Math.floor(Math.random() * colorPairs.length)];

        // OPTIMIZED: Simplified shader - removed scanlines and flicker for better FPS
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new THREE.Color(pair[0]) },
                uColor2: { value: new THREE.Color(pair[1]) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                varying vec2 vUv;

                void main() {
                    // Simple animated gradient (single sin call)
                    float gradient = sin(vUv.y * 6.0 + uTime) * 0.5 + 0.5;
                    vec3 color = mix(uColor1, uColor2, gradient);

                    // Simple edge fade
                    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                    edge *= smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

                    gl_FragColor = vec4(color, 0.7 * edge);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const billboard = new THREE.Mesh(geometry, material);
        billboard.position.set(x, y, z);

        if (faceCamera) {
            // Face the camera (toward +Z direction)
            // Camera is at z=40. Billboard should face forward (toward camera).
            billboard.rotation.y = 0;
        } else {
            // Face the street
            // For Right Building (!isLeft): Attached to -X face. Needs to face -X. Rotation = +PI/2.
            // For Left Building (isLeft): Attached to +X face. Needs to face +X. Rotation = -PI/2.
            billboard.rotation.y = isLeft ? -Math.PI / 2 : Math.PI / 2;
        }

        this.neonSigns.push(billboard);
        building.add(billboard); // Add as child of building
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rain Particle System
    // ─────────────────────────────────────────────────────────────────────────

    createRain() {
        const particleCount = this.qualityPreset.rainParticles;

        // ===== HIGH-QUALITY BILLBOARDED RAIN STREAKS =====
        // Using InstancedMesh with soft radial gradient for realistic rain

        // Base plane geometry for each raindrop (thin elongated streak)
        const rainGeometry = new THREE.PlaneGeometry(0.3, 5.0);

        // Per-instance attributes
        const instancePositions = new Float32Array(particleCount * 3);
        const instanceVelocities = new Float32Array(particleCount);
        const instancePhases = new Float32Array(particleCount);
        const instanceSizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            instancePositions[i3] = (Math.random() - 0.5) * 600;
            instancePositions[i3 + 1] = Math.random() * 500;
            instancePositions[i3 + 2] = (Math.random() - 0.5) * 800 - 200;

            instanceVelocities[i] = 18 + Math.random() * 14;
            instancePhases[i] = Math.random() * 100;
            instanceSizes[i] = 0.6 + Math.random() * 0.8; // Size variation
        }

        rainGeometry.setAttribute('aInstancePosition', new THREE.InstancedBufferAttribute(instancePositions, 3));
        rainGeometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(instanceVelocities, 1));
        rainGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(instancePhases, 1));
        rainGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(instanceSizes, 1));

        // High-quality rain shader with soft radial gradient
        const rainMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(0xcceeff) },
                uIntensity: { value: 1.0 },
            },
            vertexShader: `
                attribute vec3 aInstancePosition;
                attribute float aVelocity;
                attribute float aPhase;
                attribute float aSize;

                uniform float uTime;
                uniform float uIntensity;

                varying vec2 vUv;
                varying float vAlpha;

                void main() {
                    vUv = uv;

                    // Calculate animated instance position
                    vec3 instancePos = aInstancePosition;

                    // Fast realistic rain fall
                    float fallDistance = uTime * aVelocity * 60.0 * uIntensity;
                    instancePos.y = mod(aInstancePosition.y - fallDistance, 500.0);

                    // Subtle wind sway
                    float wind = sin(uTime * 1.5 + aPhase * 0.1) * 0.5;
                    instancePos.x += wind;

                    // Fade based on distance from camera for depth
                    float distFromCenter = length(instancePos.xz) / 400.0;
                    vAlpha = 1.0 - smoothstep(0.5, 1.0, distFromCenter);

                    // Billboard the plane to face camera (with slight downward tilt for rain angle)
                    vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                    vec3 cameraUp = vec3(0.0, 1.0, -0.15); // Slight tilt for rain angle
                    cameraUp = normalize(cameraUp);

                    // Scale the plane
                    vec3 vertexPos = position;
                    vertexPos.x *= aSize * 0.8;
                    vertexPos.y *= aSize * 1.2;

                    // Create billboarded position
                    vec3 worldPos = instancePos
                        + cameraRight * vertexPos.x
                        + cameraUp * vertexPos.y;

                    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;

                varying vec2 vUv;
                varying float vAlpha;

                void main() {
                    // Soft radial gradient with exponential falloff (key to realistic rain)
                    vec2 center = vUv - vec2(0.5);

                    // Elongate the gradient vertically for streak effect
                    center.y *= 0.25;
                    float dist = length(center) * 2.0;

                    // Exponential falloff for soft edges
                    float alpha = exp(-dist * dist * 8.0);

                    // Vertical gradient - brighter at top, fades at bottom
                    float vertFade = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.4, vUv.y);
                    alpha *= vertFade;

                    // Base opacity for visible rain with soft buildup
                    alpha *= 0.4 * vAlpha;

                    // Slight blue tint variation
                    vec3 color = uColor * (0.9 + vUv.y * 0.2);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        this.rainMaterial = rainMaterial;
        this.rainParticles = new THREE.InstancedMesh(rainGeometry, rainMaterial, particleCount);
        this.rainParticles.frustumCulled = false;
        this.scene.add(this.rainParticles);

        // ===== GPU-ANIMATED SPLASH PARTICLES =====
        const splashCount = Math.floor(particleCount * 0.3);
        const splashGeometry = new THREE.BufferGeometry();
        const splashPositions = new Float32Array(splashCount * 3);
        const splashPhases = new Float32Array(splashCount); // phase offset for staggered animation

        for (let i = 0; i < splashCount; i++) {
            splashPositions[i * 3] = (Math.random() - 0.5) * 600;
            splashPositions[i * 3 + 1] = 0.5; // Ground level
            splashPositions[i * 3 + 2] = (Math.random() - 0.5) * 800 - 200;
            splashPhases[i] = Math.random() * 6.28; // Random phase 0 to 2π
        }

        splashGeometry.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
        splashGeometry.setAttribute('aPhase', new THREE.BufferAttribute(splashPhases, 1));

        // High-quality splash shader with soft exponential falloff
        const splashMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(0xccddff) },
            },
            vertexShader: `
                attribute float aPhase;
                uniform float uTime;
                varying float vLife;

                void main() {
                    vec3 pos = position;

                    // Fast lifecycle with staggered phases
                    float cycle = mod(uTime * 6.0 + aPhase, 6.28);
                    vLife = max(0.0, sin(cycle));

                    // Quick pop up animation with slight random spread
                    pos.y += vLife * 1.5;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Size pulses with lifecycle
                    gl_PointSize = vLife * 5.0 * (300.0 / -mvPosition.z);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vLife;

                void main() {
                    // Soft radial gradient with exponential falloff (matches rain style)
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center) * 2.0;

                    // Exponential falloff for ultra-soft edges
                    float alpha = exp(-dist * dist * 6.0);

                    // Low opacity for buildup effect
                    alpha *= 0.25 * vLife;

                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.splashMaterial = splashMaterial;
        this.splashParticles = new THREE.Points(splashGeometry, splashMaterial);
        this.scene.add(this.splashParticles);

        console.log(`[NeonDistrict] Created high-quality billboarded rain with ${particleCount} drops`);
    }

    updateRain() {
        // GPU-based animation - just update shader uniforms (1 value instead of 15,000+ array ops)
        if (this.rainMaterial) {
            this.rainMaterial.uniforms.uTime.value = this.time;
            this.rainMaterial.uniforms.uIntensity.value = this.rainIntensity;
        }
        if (this.splashMaterial) {
            this.splashMaterial.uniforms.uTime.value = this.time;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Flying Vehicles (Spinners)
    // ─────────────────────────────────────────────────────────────────────────

    // OPTIMIZED: Merged Geometry for Wires
    createOverheadWires() {
        // Find left and right buildings
        const leftBuildings = this.buildings.filter((b) => b.position.x < 0);
        const rightBuildings = this.buildings.filter((b) => b.position.x > 0);

        const tubes = []; // Collect geometries

        leftBuildings.forEach((leftB) => {
            if (Math.random() > 0.4) return; // Not every building

            // Find partner
            const rightB = rightBuildings.find((b) => Math.abs(b.position.z - leftB.position.z) < 100);

            if (rightB) {
                // Connection points
                const h1 = 100 + Math.random() * 200; // Height on left
                const h2 = 100 + Math.random() * 200; // Height on right

                const p1 = new THREE.Vector3(leftB.position.x, h1, leftB.position.z);
                const p2 = new THREE.Vector3(rightB.position.x, h2, rightB.position.z);

                // Catenary sag (middle point is lower)
                const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                mid.y -= 20 + Math.random() * 30; // Sag amount

                const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);

                // Create geometry
                const geometry = new THREE.TubeGeometry(curve, 10, 0.3, 4, false);
                tubes.push(geometry);

                // Chance for a second parallel wire
                if (Math.random() > 0.5) {
                    const offset = new THREE.Vector3(0, -2, 0);
                    const p1b = p1.clone().add(offset);
                    const p2b = p2.clone().add(offset);
                    const midb = mid.clone().add(offset);
                    const curveB = new THREE.QuadraticBezierCurve3(p1b, midb, p2b);
                    const geomB = new THREE.TubeGeometry(curveB, 10, 0.3, 4, false);
                    tubes.push(geomB);
                }
            }
        });

        if (tubes.length > 0) {
            const mergedGeom = mergeGeometries(tubes);
            const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
            const mesh = new THREE.Mesh(mergedGeom, wireMaterial);
            this.scene.add(mesh);
            console.log(`[NeonDistrict] Created merged overhead wires (${tubes.length} segments)`);
        }
    }

    updateFlyingVehicles(delta) {
        if (!this.vehicleData || !this.vehicleInstances) return;

        const dummy = this.vehicleHelper;
        const count = this.vehicleData.length;
        const range = this.vehicleRange || 2500;

        for (let i = 0; i < count; i++) {
            const data = this.vehicleData[i];

            // 1. UPDATE STATE
            const dirX = data.dirX ?? 0;
            const dirZ = data.dirZ ?? 1;
            data.x += dirX * data.speed * delta;
            data.z += dirZ * data.speed * delta;

            const wrapRange = data.wrapRange || range;
            if (data.multiDirection) {
                if (data.x > wrapRange && dirX > 0) data.x = -wrapRange;
                if (data.x < -wrapRange && dirX < 0) data.x = wrapRange;
                if (data.z > wrapRange && dirZ > 0) data.z = -wrapRange;
                if (data.z < -wrapRange && dirZ < 0) data.z = wrapRange;
            } else {
                // Loop logic (Wider range for high speed)
                if (data.z > range && dirZ > 0) data.z = -range;
                if (data.z < -range && dirZ < 0) data.z = range;
            }

            // Wobble calculation
            const time = this.time + data.wobbleOffset;
            let xOff = 0; let
                yOff = 0;

            const wobbleProfile = data.wobbleProfile
                || (data.lane <= 1 ? 'low' : (data.lane <= 3 ? 'mid' : 'high'));

            if (wobbleProfile === 'low') {
                // Tighter wobble for low/mid
                xOff = Math.sin(time * 0.5) * data.wobbleX;
                yOff = Math.sin(time * 1.0) * 5;
            } else if (wobbleProfile === 'mid') {
                // Wide sweeping drift for high/skyway
                xOff = Math.cos(time * 0.2) * data.wobbleX;
                yOff = Math.sin(time * 0.3) * 20;
            } else {
                // Orbital: very slow drift
                xOff = Math.cos(time * 0.1) * data.wobbleX;
                yOff = Math.sin(time * 0.2) * 50;
            }

            // Current position
            const posX = data.x + xOff;
            const posY = data.y + yOff;
            const posZ = data.z;

            // 2. UPDATE INSTANCES
            // Re-calculate Matrix for Body just to be clean
            dummy.position.set(posX, posY, posZ);
            const heading = Math.atan2(dirX, dirZ);
            dummy.rotation.set(0, heading, 0);

            // Bank into turns
            if (data.lane > 1) {
                const bank = (data.lane === 4) ? 0.05 : 0.2;
                dummy.rotation.z = -Math.cos(time * 0.2) * bank;
            }

            dummy.updateMatrix();
            const bodyMatrix = dummy.matrix.clone();
            this.vehicleInstances.body.setMatrixAt(i, bodyMatrix);

            // HELPER to set matrix for relative part:
            // Multiply: BodyWorld * PartLocal
            const setPart = (instMesh, index, relX, relY, relZ, relRotX = 0, relRotY = 0, relRotZ = 0) => {
                dummy.position.set(relX, relY, relZ);
                dummy.rotation.set(relRotX, relRotY, relRotZ);
                dummy.updateMatrix();

                const partWorld = bodyMatrix.clone().multiply(dummy.matrix);
                instMesh.setMatrixAt(index, partWorld);
            };

            // Canopy: 0, 2, 3, rotX=PI
            setPart(this.vehicleInstances.canopy, i, 0, 2, 3, Math.PI);

            // Engines (Left/Right)
            // Left: -6, -1, -2, rotX=PI/2
            // Right: 6, -1, -2, rotX=PI/2
            setPart(this.vehicleInstances.engine, i * 2, -6, -1, -2, Math.PI / 2);
            setPart(this.vehicleInstances.engine, i * 2 + 1, 6, -1, -2, Math.PI / 2);

            // Headlights
            setPart(this.vehicleInstances.headlight, i * 2, -3, 0, 10, 0);
            setPart(this.vehicleInstances.headlight, i * 2 + 1, 3, 0, 10, 0);

            // Tail lights
            setPart(this.vehicleInstances.tailLight, i * 2, -3, 0, -10, 0, Math.PI);
            setPart(this.vehicleInstances.tailLight, i * 2 + 1, 3, 0, -10, 0, Math.PI);

            // Exhausts (Cyan OR Orange)
            if (data.exhaustType === 'cyan') {
                setPart(this.vehicleInstances.exhaustCyan, i * 2, -6, -1, -6, 0);
                setPart(this.vehicleInstances.exhaustCyan, i * 2 + 1, 6, -1, -6, 0);
            } else {
                setPart(this.vehicleInstances.exhaustOrange, i * 2, -6, -1, -6, 0);
                setPart(this.vehicleInstances.exhaustOrange, i * 2 + 1, 6, -1, -6, 0);
            }
        }

        // Mark for update
        this.vehicleInstances.body.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.canopy.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.engine.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.headlight.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.tailLight.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.exhaustCyan.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.exhaustOrange.instanceMatrix.needsUpdate = true;
    }

    // OPTIMIZED: InstancedMesh for Flying Vehicles
    createFlyingVehicles() {
        // Use Quality Preset
        const count = this.qualityPreset.flyingVehicles;
        if (count <= 0) return;

        this.buildFlightCollisionBounds();

        const altitudeBands = [
            {
                xRange: 90, yMin: 40, yMax: 220, wobbleX: 20, profile: 'low', weight: 2,
            },
            {
                xRange: 260, yMin: 200, yMax: 520, wobbleX: 30, profile: 'low', weight: 2,
            },
            {
                xRange: 260, yMin: 520, yMax: 820, wobbleX: 38, profile: 'mid', weight: 2,
            },
            {
                xRange: 600, yMin: 450, yMax: 850, wobbleX: 45, profile: 'mid', weight: 3,
            },
            {
                xRange: 1000, yMin: 700, yMax: 1200, wobbleX: 70, profile: 'mid', weight: 2,
            },
            {
                xRange: 1700, yMin: 1000, yMax: 1700, wobbleX: 120, profile: 'high', weight: 2,
            },
            {
                xRange: 2600, yMin: 1500, yMax: 2400, wobbleX: 180, profile: 'high', weight: 1,
            },
            {
                xRange: 3500, yMin: 2000, yMax: 3000, wobbleX: 220, profile: 'high', weight: 1,
            },
        ];

        const totalWeight = altitudeBands.reduce((sum, band) => sum + band.weight, 0);
        const pickAltitudeBand = () => {
            let roll = Math.random() * totalWeight;
            for (let i = 0; i < altitudeBands.length; i++) {
                roll -= altitudeBands[i].weight;
                if (roll <= 0) return altitudeBands[i];
            }
            return altitudeBands[altitudeBands.length - 1];
        };

        this.initSpinnerResources();
        const r = this.spinnerResources;

        // Create Instance Meshes
        // We use one InstancedMesh per material/geometry type
        const createInst = (geom, mat, limit) => {
            const mesh = new THREE.InstancedMesh(geom, mat, limit);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.scene.add(mesh);
            return mesh;
        };

        this.vehicleInstances = {
            body: createInst(r.bodyGeometry, r.bodyMaterial, count),
            canopy: createInst(r.canopyGeometry, r.canopyMaterial, count),
            engine: createInst(r.engineGeometry, r.engineMaterial, count * 2), // 2 per car
            exhaustCyan: createInst(r.exhaustGeometry, r.exhaustCyanMaterial, count * 2),
            exhaustOrange: createInst(r.exhaustGeometry, r.exhaustOrangeMaterial, count * 2),
            headlight: createInst(r.headlightGeometry, r.headlightMaterial, count * 2),
            tailLight: createInst(r.tailGeometry, r.tailMaterial, count * 2),
        };

        // Data array to store state
        this.vehicleData = [];
        this.vehicleHelper = new THREE.Object3D(); // Reuse for matrix calc

        for (let i = 0; i < count; i++) {
            // STATE Logic (Lane, Speed, etc)
            // 5 LAYERS OF TRAFFIC
            const lane = i % 5;
            let x; let y; let
                z;
            const altitudeBand = pickAltitudeBand();

            const clearPos = this.getClearFlightPosition(
                { min: -altitudeBand.xRange, max: altitudeBand.xRange },
                { min: altitudeBand.yMin, max: altitudeBand.yMax },
                altitudeBand.wobbleX,
            );
            x = clearPos.x;
            y = clearPos.y;

            const allowMultiDirection = altitudeBand.profile === 'high' && Math.random() > 0.3;
            const baseRange = this.vehicleRange || 2500;
            const wrapRange = allowMultiDirection ? baseRange * 1.4 : baseRange;

            z = (Math.random() - 0.5) * (allowMultiDirection ? wrapRange * 2 : 5000); // Wider Z spread
            let dirX = 0;
            let dirZ = (i % 2 === 0) ? 1 : -1;
            if (allowMultiDirection) {
                const headings = [
                    0,
                    Math.PI / 2,
                    Math.PI,
                    -Math.PI / 2,
                    Math.PI / 4,
                    -Math.PI / 4,
                    (3 * Math.PI) / 4,
                    (-3 * Math.PI) / 4,
                ];
                const baseHeading = headings[Math.floor(Math.random() * headings.length)];
                const heading = baseHeading + (Math.random() - 0.5) * 0.3;
                dirX = Math.sin(heading);
                dirZ = Math.cos(heading);
            }

            // Higher layers move faster
            let speedBase = 120;
            let speedVariance = 100;
            if (lane === 3) {
                speedBase = 220;
                speedVariance = 80;
            }
            if (lane === 4) {
                speedBase = 320; // Reduced max speed for fastest lane
                speedVariance = 60;
            }

            const speed = speedBase + Math.random() * speedVariance;
            const wobbleOffset = Math.random() * 100;

            // Assign exhaust color (Cyan or Orange)
            const exhaustType = Math.random() > 0.5 ? 'cyan' : 'orange';

            this.vehicleData.push({
                x,
                y,
                z,
                dirX,
                dirZ,
                speed,
                lane,
                wobbleOffset,
                exhaustType,
                wobbleX: altitudeBand.wobbleX,
                wobbleProfile: altitudeBand.profile,
                multiDirection: allowMultiDirection,
                wrapRange: allowMultiDirection ? wrapRange : this.vehicleRange,
            });
        }

        console.log(`[NeonDistrict] Created ${count} flying vehicles across 5 layers`);

        // Initial update to place them
        this.updateFlyingVehicles(0);
    }

    /**
     * Initialize shared geometries and materials for spinners (called once)
     */
    initSpinnerResources() {
        if (this.spinnerResources) return;

        this.spinnerResources = {
            // Geometries (shared across all spinners)
            bodyGeometry: new THREE.BoxGeometry(8, 4, 20),
            canopyGeometry: new THREE.SphereGeometry(3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            engineGeometry: new THREE.CylinderGeometry(2, 1.5, 8, 8),
            exhaustGeometry: new THREE.CircleGeometry(1.8, 8),
            headlightGeometry: new THREE.CircleGeometry(1, 8),
            tailGeometry: new THREE.CircleGeometry(0.9, 8),
            navGeometry: new THREE.SphereGeometry(0.5, 6, 6),

            // Materials (shared across all spinners)
            bodyMaterial: new THREE.MeshStandardMaterial({
                color: 0x222233,
                roughness: 0.4,
                metalness: 0.7,
                emissive: 0x111122,
                emissiveIntensity: 0.2,
            }),
            canopyMaterial: new THREE.MeshStandardMaterial({
                color: 0x4488ff,
                roughness: 0.1,
                metalness: 0.9,
                transparent: true,
                opacity: 0.7,
            }),
            engineMaterial: new THREE.MeshStandardMaterial({
                color: 0x333344,
                roughness: 0.3,
                metalness: 0.8,
            }),
            exhaustCyanMaterial: new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.9,
            }),
            exhaustOrangeMaterial: new THREE.MeshBasicMaterial({
                color: 0xff6600,
                transparent: true,
                opacity: 0.9,
            }),
            headlightMaterial: new THREE.MeshBasicMaterial({
                color: 0xffffcc,
                transparent: true,
                opacity: 1.0,
            }),
            tailMaterial: new THREE.MeshBasicMaterial({
                color: 0xff0033,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
            }),
            navMaterial: new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
        };
    }

    // Cyberpunk Spinner - detailed flying vehicle (uses shared resources)

    updateGroundReflections() {
        if (!this.groundUniforms) return;

        // Collect all neon signs with lights, sorted by Z (closer to camera first)
        const activeSigns = this.neonSigns
            .filter((s) => s.userData.light && s.userData.baseColor)
            .sort((a, b) => b.position.z - a.position.z)
            .slice(0, 8);

        const positions = [];
        const colors = [];

        for (let i = 0; i < 8; i++) {
            if (i < activeSigns.length) {
                const sign = activeSigns[i];
                // Get WORLD position of the sign (not local)
                const worldPos = new THREE.Vector3();
                sign.getWorldPosition(worldPos);
                positions.push(worldPos);

                // Boost color brightness for more visible reflections
                const baseColor = new THREE.Color(sign.userData.baseColor || 0xffffff);
                colors.push(baseColor);
            } else {
                positions.push(new THREE.Vector3(0, 1000, 0));
                colors.push(new THREE.Color(0x000000));
            }
        }

        this.groundUniforms.uLightPositions.value = positions;
        this.groundUniforms.uLightColors.value = colors;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Create PURPLE NEON environment map procedurally (no golden HDR)
        this.createPurpleEnvironmentMap();
        // Add scene lights
        this.setupSceneLighting();
    }

    createPurpleEnvironmentMap() {
        // Create a purple/cyan gradient cube map for neon reflections
        const size = 128;

        const createFace = (topColor, bottomColor) => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, size);
            gradient.addColorStop(0, topColor);
            gradient.addColorStop(0.5, '#330066');
            gradient.addColorStop(1, bottomColor);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            // Add some neon spots
            for (let i = 0; i < 8; i++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const r = 5 + Math.random() * 15;
                const spotGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                const colors = ['#ff00ff', '#00ffff', '#aa00ff', '#ff00aa'];
                spotGrad.addColorStop(0, colors[i % 4]);
                spotGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = spotGrad;
                ctx.fillRect(0, 0, size, size);
            }

            return canvas;
        };

        // Create 6 faces of cube map with purple/cyan neon colors
        const faces = [
            createFace('#ff00ff', '#00ffff'), // +x (right)
            createFace('#aa00ff', '#00ff88'), // -x (left)
            createFace('#8800ff', '#330066'), // +y (top)
            createFace('#330066', '#110022'), // -y (bottom)
            createFace('#ff00aa', '#0088ff'), // +z (front)
            createFace('#00ffff', '#ff00ff'), // -z (back)
        ];

        const cubeTexture = new THREE.CubeTexture(faces);
        cubeTexture.needsUpdate = true;

        // Process for PBR reflections
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        const envMap = pmremGenerator.fromCubemap(cubeTexture).texture;

        this.scene.environment = envMap;

        if (this.groundMaterial) {
            this.groundMaterial.envMap = envMap;
            this.groundMaterial.envMapIntensity = 1.5;
            this.groundMaterial.needsUpdate = true;
        }

        pmremGenerator.dispose();
        console.log('[NeonDistrict] Purple neon environment map created');
    }

    setupSceneLighting() {
        // ═══════════════════════════════════════════════════════════════════════════
        // SCENE LIGHTING - Night with visible buildings
        // ═══════════════════════════════════════════════════════════════════════════

        // Brighter ambient light so buildings aren't pitch black
        const ambientLight = new THREE.AmbientLight(0x334466, 1.0);
        this.scene.add(ambientLight);

        // Main directional light - gives subtle surface illumination
        const dirLight = new THREE.DirectionalLight(0x8888ff, 0.4);
        dirLight.position.set(0.5, 1, 0.3);
        this.scene.add(dirLight);

        // Secondary fill light for better building visibility from camera
        const fillLight = new THREE.DirectionalLight(0x6666aa, 0.5);
        fillLight.position.set(-0.5, 0.5, 1);
        this.scene.add(fillLight);

        // Hemisphere light for sky/ground gradient
        const hemiLight = new THREE.HemisphereLight(0x4455aa, 0x222233, 0.6);
        this.scene.add(hemiLight);

        // Purple-heavy point lights for neon atmosphere - OPTIMIZED: Reduced count
        const lightPositions = [
            { pos: [-200, 200, -300], color: 0x8800ff, intensity: 10 },
            { pos: [280, 250, -500], color: 0xaa00ff, intensity: 8 },
            { pos: [100, 80, 100], color: 0x6600ff, intensity: 8 },
            { pos: [-180, 150, 50], color: 0xff00ff, intensity: 10 },
        ];

        lightPositions.forEach(({ pos, color, intensity }) => {
            const light = new THREE.PointLight(color, intensity, 1000);
            light.position.set(...pos);
            this.scene.add(light);
        });

        console.log('[NeonDistrict] Lighting configured - brighter for visible buildings');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) {
            console.log('[NeonDistrict] Post-processing disabled for this quality level');
            return;
        }

        // Create high-resolution render target that accounts for device pixel ratio
        const pixelRatio = this.getRenderPixelRatio();
        const postScale = this.getPostProcessingScale();
        const renderTargetWidth = Math.max(1, Math.floor(window.innerWidth * pixelRatio * postScale));
        const renderTargetHeight = Math.max(1, Math.floor(window.innerHeight * pixelRatio * postScale));

        const renderTarget = new THREE.WebGLRenderTarget(renderTargetWidth, renderTargetHeight, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType, // Better color precision for HDR bloom
        });

        this.composer = new EffectComposer(this.renderer, renderTarget);

        // Render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom pass - using high-resolution dimensions
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(renderTargetWidth, renderTargetHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            this.qualityPreset.bloomThreshold || 0.4,
        );
        this.composer.addPass(this.bloomPass);

        // Vignette pass
        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log(
            `[NeonDistrict] Post-processing configured at ${renderTargetWidth}x${renderTargetHeight} (${pixelRatio}x, ${postScale} scale)`,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners - Gameplay Effects
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        // Piece lock - subtle neon glow pulse
        const onPieceLock = () => {
            // Subtle bloom/glow boost
            this.lightPulseIntensity = 0.3;
            this.bloomBoost = 0.25;
        };
        eventBus.on(EVENTS.PIECE_LOCK, onPieceLock);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.PIECE_LOCK, onPieceLock));

        // Line clear - lightning flash
        const onLineClear = (data) => {
            const lineCount = data?.lines || 1;
            this.lightPulseIntensity = 0.8 + lineCount * 0.2;
            this.bloomBoost = 0.5 + lineCount * 0.1;
            this.rainIntensity = 1.5 + lineCount * 0.3;
        };
        eventBus.on(EVENTS.LINES_CLEARED, onLineClear);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.LINES_CLEARED, onLineClear));

        // Combo - tiered cyberpunk effects
        const onCombo = (data) => {
            const combo = data?.combo || data?.comboCount || 1;
            this.triggerComboEffects(combo);
        };
        eventBus.on(EVENTS.COMBO, onCombo);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.COMBO, onCombo));

        // Resize handler
        const onResize = () => this.handleResize();
        window.addEventListener('resize', onResize);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', onResize));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Combo Effects System - Tiered Cyberpunk Effects
    // ─────────────────────────────────────────────────────────────────────────

    triggerComboEffects(combo) {
        // === TIER 1: All combos (1+) ===
        // Bloom/glow boost scales with combo
        this.lightPulseIntensity = Math.min(0.5 + combo * 0.15, 1.2);
        this.bloomBoost = Math.min(0.4 + combo * 0.12, 1.0);

        // Rain intensifies
        this.rainIntensity = Math.min(1.5 + combo * 0.2, 3.0);

        // Spawn neon sparks (scales with combo)
        const sparkCount = Math.min(combo * 6, 30); // Increased from 4 to 6 per combo
        this.spawnComboSparks(sparkCount, combo);

        // EXTRA edge sparks - specifically on screen edges where they're visible
        this.spawnEdgeSparks(combo);

        // === TIER 2: Medium combos (3+) ===
        if (combo >= 3) {
            // Neon sign surge - all signs flare brighter
            this.triggerNeonSignSurge(combo);
        }

        // === TIER 3: High combos (5+) ===
        if (combo >= 5) {
            // Lightning arc between buildings
            this.spawnLightningArc(combo);

            // Holographic glitch wave
            this.triggerGlitchWave(combo);
        }
    }

    spawnComboSparks(count, combo) {
        if (!this.scene) return;

        // Cyberpunk neon colors - bright and saturated
        const neonColors = [
            0x00ffff, // Electric cyan
            0xff00ff, // Hot magenta
            0xffff00, // Acid yellow
            0xff00aa, // Pink neon
            0x00ff66, // Toxic green
            0xaa00ff, // Purple neon
            0xffffff, // White hot
        ];

        // Spawn MORE sparks across the ENTIRE visible screen
        const actualCount = count * 3; // Triple the spark count (was 2x)

        for (let i = 0; i < actualCount; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // BIAS toward left and right EDGES - avoid center where game board is
            let spawnX;
            if (Math.random() > 0.3) {
                // 70% chance: spawn on edges (left or right side)
                const side = Math.random() > 0.5 ? 1 : -1;
                spawnX = side * (200 + Math.random() * 400); // 200-600 units from center
            } else {
                // 30% chance: full width (some will appear behind board)
                spawnX = (Math.random() - 0.5) * 1000;
            }
            const spawnY = Math.random() * 350; // Full height from ground to sky
            const spawnZ = 100 - Math.random() * 500; // Closer to camera for visibility

            // LARGER sparks for better visibility
            const sparkSize = 2 + Math.random() * 3; // 2-5 units (was 0.6-1.2)
            const geometry = new THREE.SphereGeometry(sparkSize, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
            });

            const spark = new THREE.Mesh(geometry, material);
            spark.position.set(spawnX, spawnY, spawnZ);

            // Velocity - dynamic burst with variety
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.3) * Math.PI;
            const speed = 20 + Math.random() * 40 + combo * 8;

            spark.userData = {
                vx: Math.cos(angle) * Math.cos(elevation) * speed,
                vy: Math.sin(elevation) * speed + 10,
                vz: Math.sin(angle) * Math.cos(elevation) * speed * 0.5, // Less Z movement
                life: 1.0,
                decay: 0.008 + Math.random() * 0.01, // Slower decay = longer visibility
                gravity: -40, // Gentler gravity
                color,
                baseSize: sparkSize,
            };

            this.scene.add(spark);
            this.pieceLockSparks.push(spark);
        }
    }

    // Spawn sparks SPECIFICALLY on the far left and right edges of the screen
    spawnEdgeSparks(combo) {
        if (!this.scene) return;

        // Bright neon colors for visibility
        const neonColors = [
            0x00ffff, // Electric cyan
            0xff00ff, // Hot magenta
            0xffff00, // Acid yellow
            0x00ff66, // Toxic green
            0xffffff, // White hot
        ];

        // More sparks for higher combos
        const count = 15 + combo * 8; // Increased for more visible edge effects

        for (let i = 0; i < count; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // ONLY spawn on far LEFT or RIGHT edges
            const side = Math.random() > 0.5 ? 1 : -1;
            const spawnX = side * (350 + Math.random() * 300); // 350-650 units from center (far edges)
            const spawnY = Math.random() * 400; // Full height
            const spawnZ = 150 - Math.random() * 300; // Closer to camera for maximum visibility

            // LARGER, brighter sparks for edges
            const sparkSize = 3 + Math.random() * 4; // 3-7 units
            const geometry = new THREE.SphereGeometry(sparkSize, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
            });

            const spark = new THREE.Mesh(geometry, material);
            spark.position.set(spawnX, spawnY, spawnZ);

            // Velocity - burst mostly laterally (stay on edges)
            const angle = side > 0 ? Math.random() * Math.PI - Math.PI / 2 : Math.random() * Math.PI + Math.PI / 2;
            const speed = 15 + Math.random() * 30;

            spark.userData = {
                vx: Math.cos(angle) * speed * 0.5, // Less horizontal movement to stay on edge
                vy: (Math.random() - 0.3) * speed + 10, // Mostly upward
                vz: 0, // No depth movement
                life: 1.0,
                decay: 0.006 + Math.random() * 0.008, // Extra slow decay
                gravity: -30, // Gentle gravity
                color,
                baseSize: sparkSize,
            };

            this.scene.add(spark);
            this.pieceLockSparks.push(spark);
        }
    }

    triggerNeonSignSurge(combo) {
        // Temporarily boost all neon sign brightness
        this.neonSignSurgeIntensity = Math.min(0.5 + combo * 0.1, 1.0);
        this.neonSignSurgeTime = 0;
    }

    spawnLightningArc(combo) {
        if (!this.scene || this.buildings.length < 2) return;

        // Spawn multiple lightning arcs for high combos, spread across the scene
        const arcCount = Math.min(1 + Math.floor((combo - 4) / 2), 3);

        for (let arc = 0; arc < arcCount; arc++) {
            // Find two buildings at similar Z depth for this arc
            const leftBuildings = this.buildings.filter((b) => b.position.x < 0);
            const rightBuildings = this.buildings.filter((b) => b.position.x > 0);

            if (leftBuildings.length === 0 || rightBuildings.length === 0) return;

            const leftB = leftBuildings[Math.floor(Math.random() * leftBuildings.length)];

            // Find a right building at similar Z depth for more natural arc
            const sameDepthBuildings = rightBuildings.filter((b) => Math.abs(b.position.z - leftB.position.z) < 200);
            const rightB = sameDepthBuildings.length > 0
                ? sameDepthBuildings[Math.floor(Math.random() * sameDepthBuildings.length)]
                : rightBuildings[Math.floor(Math.random() * rightBuildings.length)];

            // Arc points - full height range
            const startY = 50 + Math.random() * 250;
            const endY = 50 + Math.random() * 250;

            // Use averaged Z for the arc to stay in the building corridor
            const arcZ = (leftB.position.z + rightB.position.z) / 2;

            const start = new THREE.Vector3(
                leftB.position.x + 20,
                startY,
                arcZ + (Math.random() - 0.5) * 50,
            );
            const end = new THREE.Vector3(
                rightB.position.x - 20,
                endY,
                arcZ + (Math.random() - 0.5) * 50,
            );

            // Create lightning bolt with jagged segments
            this.createLightningBolt(start, end, combo);
        }
    }

    createLightningBolt(start, end, combo) {
        if (!this.scene) return;

        const points = [start.clone()];
        const segments = 8 + Math.floor(combo * 2);
        const direction = end.clone().sub(start);

        // Create jagged path
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const point = start.clone().lerp(end, t);

            // Add random displacement (perpendicular jitter)
            const jitter = 15 + combo * 3;
            point.x += (Math.random() - 0.5) * jitter;
            point.y += (Math.random() - 0.5) * jitter;
            point.z += (Math.random() - 0.5) * jitter * 0.5;

            points.push(point);
        }
        points.push(end.clone());

        // Create geometry from points
        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        // Electric blue/white color
        const colors = [0x88ffff, 0xffffff, 0xaaffff, 0x00ffff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 1.0,
            linewidth: 2,
            blending: THREE.AdditiveBlending,
        });

        const lightning = new THREE.Line(geometry, material);
        lightning.userData = {
            life: 1.0,
            decay: 0.06, // Fast fade
            isLightning: true,
        };

        this.scene.add(lightning);
        this.pieceLockSparks.push(lightning);

        // Create glow at both ends
        this.createSparkFlash(start.x, start.y, start.z, color);
        this.createSparkFlash(end.x, end.y, end.z, color);

        // Spawn branch lightning (for high combos)
        if (combo >= 7 && Math.random() > 0.5) {
            const midPoint = points[Math.floor(points.length / 2)];
            const branchEnd = new THREE.Vector3(
                midPoint.x + (Math.random() - 0.5) * 100,
                midPoint.y - 30 - Math.random() * 50,
                midPoint.z + (Math.random() - 0.5) * 50,
            );
            this.createLightningBolt(midPoint, branchEnd, Math.floor(combo / 2));
        }
    }

    triggerGlitchWave(combo) {
        if (!this.scene) return;

        // Create a horizontal "glitch band" plane that sweeps across
        const height = 3 + combo * 0.5;
        const geometry = new THREE.PlaneGeometry(600, height);

        // Glitch colors - electric interference
        const glitchColors = [0x00ffff, 0xff00ff, 0xffff00, 0x00ff00];
        const color = glitchColors[Math.floor(Math.random() * glitchColors.length)];

        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const glitchWave = new THREE.Mesh(geometry, material);

        // Position on LEFT or RIGHT side - avoid center where game board is
        const side = Math.random() > 0.5 ? 1 : -1;
        const randomX = side * (150 + Math.random() * 200); // 150-350 units from center
        const randomZ = -50 - Math.random() * 400;
        glitchWave.position.set(randomX, 400, randomZ);
        glitchWave.rotation.x = Math.PI / 2; // Horizontal

        glitchWave.userData = {
            life: 1.0,
            decay: 0.025,
            isGlitchWave: true,
            sweepSpeed: 300 + combo * 50,
            startY: 400,
        };

        this.scene.add(glitchWave);
        this.pieceLockSparks.push(glitchWave);
    }

    handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.applyRenderScale(true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Piece Lock Effect - Cyberpunk Neon Sparks
    // ─────────────────────────────────────────────────────────────────────────

    spawnPieceLockSparks() {
        if (!this.scene) return;

        // Cyberpunk neon colors matching the theme palette
        const neonColors = [
            0x00ffff, // Electric cyan
            0xff00ff, // Hot magenta
            0xffff00, // Acid yellow
            0xff00aa, // Pink neon
            0x00ff66, // Toxic green
            0xaa00ff, // Purple neon
        ];

        // Spawn location - spread across the ENTIRE visible city area
        const spawnX = (Math.random() - 0.5) * 800; // Full city width
        const spawnY = 10 + Math.random() * 300; // Full height range
        const spawnZ = 50 - Math.random() * 600; // From foreground to deep background

        // Create 8-15 sparks per piece lock
        const sparkCount = 8 + Math.floor(Math.random() * 8);

        for (let i = 0; i < sparkCount; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // Spark geometry - small glowing point
            const geometry = new THREE.SphereGeometry(0.8 + Math.random() * 0.8, 6, 6);
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
            });

            const spark = new THREE.Mesh(geometry, material);

            // Initial position with slight spread
            spark.position.set(
                spawnX + (Math.random() - 0.5) * 10,
                spawnY + (Math.random() - 0.5) * 10,
                spawnZ + (Math.random() - 0.5) * 10,
            );

            // Velocity - burst outward in all directions
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.3) * Math.PI; // Bias upward
            const speed = 40 + Math.random() * 60;

            spark.userData = {
                vx: Math.cos(angle) * Math.cos(elevation) * speed,
                vy: Math.sin(elevation) * speed + 20, // Upward bias
                vz: Math.sin(angle) * Math.cos(elevation) * speed,
                life: 1.0,
                decay: 0.015 + Math.random() * 0.02,
                gravity: -80, // Gravity pulls sparks down
                color,
            };

            this.scene.add(spark);
            this.pieceLockSparks.push(spark);
        }

        // Also create a brief flash/glow at spawn point
        this.createSparkFlash(spawnX, spawnY, spawnZ, neonColors[Math.floor(Math.random() * neonColors.length)]);
    }

    createSparkFlash(x, y, z, color) {
        if (!this.scene) return;

        // Create a larger, quickly fading glow sphere
        const geometry = new THREE.SphereGeometry(8, 12, 12);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });

        const flash = new THREE.Mesh(geometry, material);
        flash.position.set(x, y, z);

        flash.userData = {
            life: 1.0,
            decay: 0.08, // Fast decay for quick flash
            isFlash: true,
        };

        this.scene.add(flash);
        this.pieceLockSparks.push(flash);
    }

    updatePieceLockSparks(delta) {
        for (let i = this.pieceLockSparks.length - 1; i >= 0; i--) {
            const spark = this.pieceLockSparks[i];

            // Decay life
            spark.userData.life -= spark.userData.decay;

            if (spark.userData.life <= 0) {
                // Remove dead spark
                this.scene.remove(spark);
                if (spark.geometry) spark.geometry.dispose();
                if (spark.material) spark.material.dispose();
                this.pieceLockSparks.splice(i, 1);
                continue;
            }

            // Update opacity based on life
            spark.material.opacity = spark.userData.life;

            if (spark.userData.isLightning) {
                // Lightning just fades - no movement
                continue;
            }

            if (spark.userData.isGlitchWave) {
                // Glitch wave sweeps down the screen
                spark.position.y -= spark.userData.sweepSpeed * delta;

                // Add some horizontal jitter for glitch effect
                spark.position.x = (Math.random() - 0.5) * 10;

                continue;
            }

            if (spark.userData.isFlash) {
                // Flash grows and fades
                const scale = 1 + (1 - spark.userData.life) * 2;
                spark.scale.setScalar(scale);
            } else {
                // Regular spark - apply physics
                spark.userData.vy += spark.userData.gravity * delta;

                spark.position.x += spark.userData.vx * delta;
                spark.position.y += spark.userData.vy * delta;
                spark.position.z += spark.userData.vz * delta;

                // Friction/drag
                spark.userData.vx *= 0.98;
                spark.userData.vz *= 0.98;

                // Shrink as it dies
                const lifeScale = 0.3 + spark.userData.life * 0.7;
                spark.scale.setScalar(lifeScale);

                // Trail effect - stretch based on velocity
                const speed = Math.sqrt(
                    spark.userData.vx ** 2
                    + spark.userData.vy ** 2
                    + spark.userData.vz ** 2,
                );
                if (speed > 20) {
                    spark.scale.y = 1 + speed * 0.01;
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const animId = requestAnimationFrame(animate);
            this.registerAnimation(animId);

            const delta = this.clock.getDelta();
            this.time += delta;
            this.updateDynamicResolution(delta);

            // Camera sway - gentle floating drift
            this.updateCameraSway();

            // Update sky shader
            if (this.sky?.material?.uniforms?.uTime) {
                this.sky.material.uniforms.uTime.value = this.time;
            }

            if (this.starfield?.material?.uniforms?.uTime) {
                this.starfield.material.uniforms.uTime.value = this.time;
                this.starfield.rotation.y = this.time * 0.002;
                this.starfield.rotation.z = this.time * 0.001;
            }

            // Update ground uniforms (for ripples and reflections)
            if (this.groundUniforms) {
                this.groundUniforms.uTime.value = this.time;
                this.groundUniforms.uCameraPos.value.copy(this.camera.position);
            }

            // Animate Mega Tower Shader (Color Drift)
            if (this.megaTowerMaterial) {
                this.megaTowerMaterial.uniforms.uTime.value = this.time;
            }

            // Update searchlights
            this.updateSearchlights();

            // Update rain
            this.updateRain(delta);

            // Update flying vehicles
            this.updateFlyingVehicles(delta);

            // Update neon signs (flicker)
            this.updateNeonSigns();

            // Update blinking lights
            this.updateBlinkingLights();

            // Update VHS billboards (time + texture cycling)
            this.updateVHSBillboards(delta);

            // Update piece lock sparks
            this.updatePieceLockSparks(delta);

            // Decay effects
            this.lightPulseIntensity *= 0.95;
            this.bloomBoost *= 0.93;
            this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, 1.0, delta * 2);

            // Decay neon sign surge
            this.neonSignSurgeIntensity *= 0.92;

            // Apply bloom boost
            if (this.bloomPass) {
                this.bloomPass.strength = this.qualityPreset.bloomStrength + this.bloomBoost;
            }

            // Render
            if (this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        };

        animate();
    }

    /**
     * Updates camera with gentle floating drift motion.
     * Uses multiple sine waves at different frequencies for organic, non-repetitive movement.
     */
    updateCameraSway() {
        if (!this.camera) return;

        const t = this.time;
        const amp = this.cameraSwayAmplitude;
        const spd = this.cameraSwaySpeed;

        // Position sway - multiple frequencies for organic feel
        const swayX = Math.sin(t * spd.x) * amp.x + Math.sin(t * spd.x * 0.7 + 1.3) * amp.x * 0.4;

        // Vertical sway: Strictly positive (up from base)
        // Map sine from [-1, 1] to [0, 1] then scale
        // Phase shifted to -1.57 (-PI/2) so at t=0, sin is -1, making swayY = 0 (Start at bottom)
        const rawY = Math.sin(t * spd.y - 1.57);
        const swayY = (rawY * 0.5 + 0.5) * (amp.y * 180.0); // 0 to ~540 units up

        const swayZ = Math.sin(t * spd.z + 1.0) * amp.z;

        this.camera.position.set(
            this.cameraBasePosition.x + swayX,
            this.cameraBasePosition.y + swayY,
            this.cameraBasePosition.z + swayZ,
        );

        // LookAt sway - subtle rotation of view target
        const lookSwayX = Math.sin(t * 0.1 + 0.8) * this.cameraLookAtSway.x;
        const lookSwayY = Math.sin(t * 0.14 + 1.5) * this.cameraLookAtSway.y;

        // Dynamic pitch adjustment with "nod" at the peak
        // normalizedY: 0 at bottom, 1 at peak
        const normalizedY = rawY * 0.5 + 0.5;

        // Peak nod: when near the top (normalizedY > 0.6), tilt UP towards the moon
        // Uses smoothstep-like curve for smooth transition
        const peakThreshold = 0.6;
        const peakFactor = Math.max(0, (normalizedY - peakThreshold) / (1.0 - peakThreshold));
        const peakNod = peakFactor * peakFactor * 400; // Quadratic ease-in, look up strongly at the moon

        // Base behavior: look down as we go up (multiplier 0.5)
        // At peak: add peakNod to look UP towards the moon
        const dynamicLookY = this.cameraBaseLookAt.y + lookSwayY + (swayY * 0.5) + peakNod;

        this.camera.lookAt(
            this.cameraBaseLookAt.x + lookSwayX,
            dynamicLookY,
            this.cameraBaseLookAt.z,
        );

        // Breathing Motion (FOV Oscillation)
        // Slow, rhythmic pulse to simulate breathing or organic life
        const breath = Math.sin(t * 0.4) * 1.5; // +/- 1.5 FOV
        this.camera.fov = 75 + breath; // Base FOV 75 (assumed default)
        this.camera.updateProjectionMatrix();
    }

    /**
     * Updates VHS billboards - shader time, texture cycling, and glitch effects
     */
    updateVHSBillboards(delta) {
        this.vhsBillboards.forEach((billboard) => {
            if (!billboard.material?.uniforms) return;

            const { uniforms } = billboard.material;
            const data = billboard.userData;

            // Update shader time
            uniforms.uTime.value = this.time;

            // Progress cycle timer
            data.cycleProgress += delta;

            // Check if we should start a transition
            if (data.cycleProgress >= data.cycleTime && !data.inTransition) {
                data.inTransition = true;
                data.transitionStart = data.cycleProgress;
            }

            // Handle transition
            if (data.inTransition) {
                const transitionProgress = (data.cycleProgress - data.transitionStart) / data.transitionDuration;

                if (transitionProgress >= 1.0) {
                    // Transition complete - swap textures and reset
                    data.inTransition = false;
                    data.cycleProgress = 0;

                    // Swap textures
                    const temp = uniforms.uTexture1.value;
                    uniforms.uTexture1.value = uniforms.uTexture2.value;
                    uniforms.uTexture2.value = temp;

                    // Get a new random texture for next cycle
                    const newIndex = Math.floor(Math.random() * 14) + 1;
                    const padNum = (n) => n.toString().padStart(2, '0');
                    const newTex = this.assets?.getTexture(`ads_large_${padNum(newIndex)}`);
                    if (newTex) {
                        uniforms.uTexture2.value = newTex;
                    }

                    uniforms.uMixFactor.value = 0.0;
                    uniforms.uGlitchIntensity.value = 0.0;
                } else {
                    // During transition - animate mix and glitch
                    uniforms.uMixFactor.value = transitionProgress;

                    // Glitch peaks in the middle of transition
                    const glitchCurve = Math.sin(transitionProgress * Math.PI);
                    uniforms.uGlitchIntensity.value = glitchCurve * 1.5;
                }
            } else {
                // Occasional random glitch even when not transitioning
                if (Math.random() < 0.002) {
                    uniforms.uGlitchIntensity.value = 0.3 + Math.random() * 0.5;
                } else {
                    uniforms.uGlitchIntensity.value *= 0.9; // Quick decay
                }
            }
        });
    }

    updateNeonSigns() {
        // Throttle: only update every 3rd frame (flicker at 20Hz looks identical to 60Hz)
        this.signUpdateCounter = (this.signUpdateCounter + 1) % 3;
        if (this.signUpdateCounter !== 0) return;

        // Reuse vector for distance checks (avoid allocations)
        const worldPos = this._signWorldPos || (this._signWorldPos = new THREE.Vector3());

        this.neonSigns.forEach((sign) => {
            // Distance culling - skip signs too far from camera to notice flicker
            sign.getWorldPosition(worldPos);
            if (worldPos.z < -800) return;

            if (sign.userData.flickerPhase !== undefined) {
                // Simple flicker effect
                const flicker = Math.sin(this.time * sign.userData.flickerSpeed + sign.userData.flickerPhase);
                const { flickerAmount } = sign.userData;

                if (sign.material.opacity !== undefined) {
                    // Include combo surge intensity for dramatic flare during combos
                    const surgeBoost = this.neonSignSurgeIntensity * 0.4;
                    sign.material.opacity = Math.min(
                        0.7 + flicker * flickerAmount + this.lightPulseIntensity * 0.3 + surgeBoost,
                        1.0,
                    );
                }
            }

            // Update holographic billboard shaders
            if (sign.material.uniforms?.uTime) {
                sign.material.uniforms.uTime.value = this.time;
            }

            // Update low-lying fog shader
            if (this.lowFog && this.lowFog.material.uniforms?.uTime) {
                this.lowFog.material.uniforms.uTime.value = this.time;
            }

            // Animated ad material switching (like SynthCity)
            if (sign.userData.isAd && sign.userData.switches) {
                sign.userData.switchCounter++;
                if (sign.userData.switchCounter > sign.userData.switchInterval) {
                    sign.userData.switchCounter = 0;
                    // Switch to a random ad material
                    const newMat = sign.userData.isLarge
                        ? this.assets?.getRandomLargeAdMaterial()
                        : this.assets?.getRandomAdMaterial();
                    if (newMat) {
                        sign.material = newMat;
                    }
                }
            }

            // Spotlight beam pulse animation
            if (sign.userData.isSpotlight && sign.material.opacity !== undefined) {
                const pulse = Math.sin(this.time * sign.userData.pulseSpeed + sign.userData.pulsePhase);
                sign.material.opacity = sign.userData.baseOpacity * (0.7 + pulse * 0.3);
            }
        });
    }

    updateBlinkingLights() {
        // Throttle to 15Hz (every 4th frame) - blinking doesn't need 60Hz precision
        this.blinkUpdateCounter = (this.blinkUpdateCounter + 1) % 4;
        if (this.blinkUpdateCounter !== 0) return;

        this.streetLights.forEach((light) => {
            // OPTIMIZED: InstancedMesh processing for lanterns
            if (light.isInstancedMesh && light.userData.instances) {
                const { count } = light;
                const dummy = this.vehicleHelper || new THREE.Object3D();

                // Update every instance
                light.userData.instances.forEach((data, i) => {
                    // Capture base Y if not set
                    // Note: for instanced mesh we need to trust the data.y is the base

                    // Gentle sine wave float
                    const floatY = Math.sin(this.time * data.floatSpeed + data.floatOffset);

                    dummy.position.set(data.x, data.y + floatY * 2.5, data.z);
                    dummy.updateMatrix();
                    light.setMatrixAt(i, dummy.matrix);
                });

                light.instanceMatrix.needsUpdate = true;
                return;
            }

            // Type 1: Blinking rooftop beacon
            if (light.userData.blinkPhase !== undefined) {
                const alpha = this.computeBlinkAlpha(light, this.time);
                if (light.isLight) {
                    if (light.userData.baseIntensity === undefined) {
                        light.userData.baseIntensity = light.intensity;
                    }
                    light.intensity = light.userData.baseIntensity * alpha;
                    light.visible = alpha > 0.02;
                } else {
                    light.visible = alpha > 0.05;
                }
            }
            // Type 2: Floating Lantern (Individual - Legacy or Fallback)
            else if (light.userData.floatSpeed !== undefined) {
                // Capture base Y if not set
                if (light.userData.initialY === undefined) {
                    light.userData.initialY = light.position.y;
                }

                // Gentle sine wave float
                const floatY = Math.sin(this.time * light.userData.floatSpeed + light.userData.floatOffset);
                light.position.y = light.userData.initialY + floatY * 2.5;

                // Subtle rotation
                light.rotation.y += 0.02; // Increased to compensate for throttling
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        console.log('[NeonDistrict] Stopping...');

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        super.stop();
    }

    cleanup() {
        console.log('[NeonDistrict] Cleaning up...');

        // Dispose geometries and materials
        this.buildings.forEach((building) => {
            building.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        });

        this.outerBuildingInstances.forEach((mesh) => {
            if (this.scene) {
                this.scene.remove(mesh);
            }
        });
        this.outerBuildingInstances = [];

        if (this.outerBuildingGeometry) {
            this.outerBuildingGeometry.dispose();
            this.outerBuildingGeometry = null;
        }

        this.rooftopBatchMeshes.forEach((mesh) => {
            if (mesh.geometry) mesh.geometry.dispose();
        });
        this.rooftopBatchMeshes = [];

        if (this.rooftopMaterials) {
            Object.values(this.rooftopMaterials).forEach((material) => {
                if (material && material.dispose) material.dispose();
            });
            this.rooftopMaterials = null;
        }
        this.rooftopPropsBatched = false;

        if (this.rooftopBeaconGeometry) {
            this.rooftopBeaconGeometry.dispose();
            this.rooftopBeaconGeometry = null;
        }

        if (this.rooftopBeaconMaterial) {
            this.rooftopBeaconMaterial.dispose();
            this.rooftopBeaconMaterial = null;
        }

        this.freeStandingBeacons.forEach((beacon) => {
            if (this.scene) {
                this.scene.remove(beacon);
            }
            if (beacon.geometry) beacon.geometry.dispose();
            if (beacon.material) beacon.material.dispose();
        });
        this.freeStandingBeacons = [];

        this.neonSigns.forEach((sign) => {
            if (sign.geometry) sign.geometry.dispose();
            if (sign.material) sign.material.dispose();
        });

        if (this.rainParticles) {
            this.rainParticles.geometry.dispose();
            this.rainParticles.material.dispose();
        }

        if (this.splashParticles) {
            this.splashParticles.geometry.dispose();
            this.splashParticles.material.dispose();
        }

        // Clear shader material references
        this.rainMaterial = null;
        this.splashMaterial = null;

        // Dispose piece lock sparks
        this.pieceLockSparks.forEach((spark) => {
            if (spark.geometry) spark.geometry.dispose();
            if (spark.material) spark.material.dispose();
        });
        this.pieceLockSparks = [];

        this.flyingVehicles.forEach((vehicle) => {
            vehicle.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });

        // Dispose shared spinner resources
        if (this.spinnerResources) {
            Object.values(this.spinnerResources).forEach((resource) => {
                if (resource && typeof resource.dispose === 'function') {
                    resource.dispose();
                }
            });
            this.spinnerResources = null;
        }

        if (this.sky) {
            this.sky.geometry.dispose();
            this.sky.material.dispose();
        }

        if (this.starfield) {
            this.starfield.geometry.dispose();
            this.starfield.material.dispose();
            this.starfield = null;
        }

        // Clear arrays
        this.buildings = [];
        this.neonSigns = [];
        this.flyingVehicles = [];
        this.streetLights = [];

        // Dispose composer
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        // Dispose SynthCity assets
        if (this.assets) {
            this.assets.dispose();
            this.assets = null;
        }

        this.scene = null;
        this.camera = null;

        super.cleanup();
        console.log('[NeonDistrict] Cleanup complete');
    }
}
