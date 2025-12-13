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

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { NEON_DISTRICT_TETROMINOS } from './neon-district-tetrominos.js';
import { NeonDistrictAssets } from './neon-district-assets.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets - Balanced: visible window glow without blow-out
const QUALITY_PRESETS = {
    Extreme: {
        buildingCount: 40,
        rainParticles: 2500,    // Reduced from 5000 for performance
        bloomStrength: 1.2,     // Balanced bloom
        bloomRadius: 0.8,
        bloomThreshold: 0.1,    // Low threshold for emissive glow
        enablePostProcessing: true,
        flyingVehicles: 6,
    },
    Ultra: {
        buildingCount: 25,
        rainParticles: 1000,    // Reduced from 1500
        bloomStrength: 1.0,
        bloomRadius: 0.7,
        bloomThreshold: 0.15,
        enablePostProcessing: true,
        flyingVehicles: 4,
    },
    High: {
        buildingCount: 20,
        rainParticles: 800,     // Reduced from 1200
        bloomStrength: 0.9,
        bloomRadius: 0.6,
        bloomThreshold: 0.2,
        enablePostProcessing: true,
        flyingVehicles: 3,
    },
    Medium: {
        buildingCount: 15,
        rainParticles: 500,     // Reduced from 800
        bloomStrength: 0.7,
        bloomRadius: 0.5,
        bloomThreshold: 0.25,
        enablePostProcessing: true,
        flyingVehicles: 2,
    },
    Low: {
        buildingCount: 10,
        rainParticles: 200,     // Reduced from 400
        bloomStrength: 0.5,
        bloomRadius: 0.4,
        bloomThreshold: 0.3,
        enablePostProcessing: false,
        flyingVehicles: 1,
    },
    Minimal: {
        buildingCount: 12,
        rainParticles: 100,     // Minimal rain
        bloomStrength: 0.4,
        bloomRadius: 0.3,
        bloomThreshold: 0.35,
        enablePostProcessing: false,
        flyingVehicles: 1,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.3 },  // Reduced darkness for brighter scene
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

        // Shared spinner resources (initialized lazily)
        this.spinnerResources = null;

        // SynthCity Assets Manager
        this.assets = new NeonDistrictAssets();

        // Camera sway parameters (gentle floating drift)
        // Camera sway parameters (gentle floating drift) - increased movement
        this.cameraBasePosition = new THREE.Vector3(0, 50, 40);
        this.cameraBaseLookAt = new THREE.Vector3(0, 80, -400);
        this.cameraSwayAmplitude = { x: 5.0, y: 3.0, z: 2.0 };
        this.cameraSwaySpeed = { x: 0.18, y: 0.25, z: 0.15 };
        this.cameraLookAtSway = { x: 6.0, y: 4.0 };

        // VHS billboards with shader effects
        this.vhsBillboards = [];

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
    }

    /**
     * Helper to defer work to the next animation frame.
     * Use for visual updates that need to render immediately.
     */
    deferToNextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    /**
     * Helper to defer work to browser idle time.
     * Uses requestIdleCallback to avoid competing with gameplay/animations.
     * Falls back to setTimeout if requestIdleCallback is not available.
     */
    deferToIdleTime(timeout = 100) {
        return new Promise(resolve => {
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
        // PHASE 2: Create EVERYTHING immediately (all operations are fast)
        // ═══════════════════════════════════════════════════════════════════════
        await this.deferToNextFrame();
        if (!this.isActive) return;

        this.createStreet();
        this.createAllBuildings();
        this.createNeonSignsForBuildings(0, this.buildings.length);
        this.createOverheadWires();
        this.createHolographicBillboards();
        this.createRain();
        this.createFlyingVehicles();
        this.updateGroundReflections();

        console.log('[NeonDistrict] Scene fully loaded!');
    }

    /**
     * Creates ALL buildings immediately - this is a fast operation.
     */
    createAllBuildings() {
        const streetWidth = 180;
        const buildingSpacing = 120;
        const buildingCount = this.qualityPreset.buildingCount;
        const buildingsPerSide = Math.floor(buildingCount / 2);

        // Create buildings on both sides of the street
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100;

            // Left side
            const xLeft = -(streetWidth / 2 + 50 + Math.random() * 30);
            this.createBuilding(xLeft, zPos, 70 + Math.random() * 80, 500 + Math.random() * 1000, 70 + Math.random() * 80);

            // Right side (offset by half spacing for variety)
            const xRight = streetWidth / 2 + 50 + Math.random() * 30;
            this.createBuilding(xRight, zPos - buildingSpacing / 2, 70 + Math.random() * 80, 500 + Math.random() * 1000, 70 + Math.random() * 80);
        }

        // Background buildings (distant, larger)
        const alleyLength = buildingsPerSide * buildingSpacing;
        for (let i = 0; i < 6; i++) {
            const zPos = -alleyLength - 200 - Math.random() * 500;
            const xPos = (Math.random() - 0.5) * 800;
            this.createBuilding(xPos, zPos, 100 + Math.random() * 150, 800 + Math.random() * 1500, 100 + Math.random() * 150);
        }

        console.log(`[NeonDistrict] Created ${this.buildings.length} buildings`);
    }

    /**
     * Creates a neon banner that ALWAYS uses Kanji characters
     * Positioned to face the STREET (toward x=0)
     */
    createNeonBannerKanji(building) {
        const w = 25 + Math.random() * 15;  // Wider
        const h = 60 + Math.random() * 40;  // Taller
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
            side: THREE.DoubleSide
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

        const colorStr = '#' + baseColor.getHexString();
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

        // Neon signs for all buildings
        workQueue.push(() => {
            if (!this.isActive) return;
            this.createNeonSignsForBuildings(0, this.buildings.length);
        });

        // Wires and billboards
        workQueue.push(() => {
            if (!this.isActive) return;
            this.createOverheadWires();
            this.createHolographicBillboards();
        });

        // Rain and vehicles
        workQueue.push(() => {
            if (!this.isActive) return;
            this.createRain();
            this.createFlyingVehicles();
        });

        // Final touches
        workQueue.push(() => {
            if (!this.isActive) return;
            this.updateGroundReflections();
            console.log('[NeonDistrict] Background loading complete!');
        });

        // Process queue using requestIdleCallback
        this.processBackgroundQueue(workQueue, 0);
    }

    /**
     * Process work items using requestIdleCallback for better performance.
     * Processes multiple items per callback when time permits.
     */
    processBackgroundQueue(queue, index) {
        if (index >= queue.length || !this.isActive) return;

        const processItems = (deadline) => {
            if (!this.isActive) return;

            // Process items while we have time (aim for 10ms chunks max)
            while (index < queue.length && (deadline ? deadline.timeRemaining() > 5 : true)) {
                queue[index]();
                index++;

                // If no deadline API, only process one item per frame
                if (!deadline) break;
            }

            // Schedule next batch
            if (index < queue.length && this.isActive) {
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(processItems, { timeout: 100 });
                } else {
                    // Fallback: use requestAnimationFrame for smoother loading
                    requestAnimationFrame(() => processItems(null));
                }
            }
        };

        // Start processing
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(processItems, { timeout: 100 });
        } else {
            requestAnimationFrame(() => processItems(null));
        }
    }

    /**
     * Creates neon signs for a range of buildings.
     */
    createNeonSignsForBuildings(startIdx, endIdx) {
        const buildings = this.buildings.slice(startIdx, Math.min(endIdx, this.buildings.length));
        buildings.forEach((building) => {
            // 50% skip rate for faster loading (was 20%)
            if (Math.random() > 0.5) return;

            // Max 1 sign per building for performance (was 1-3)
            const type = Math.random();
            if (type < 0.4) {
                this.createNeonShape(building);
            } else if (type < 0.7) {
                this.createNeonBanner(building);
            } else {
                this.createNeonStrip(building);
            }
        });
    }

    /**
     * Creates holographic billboards - reduced count for performance.
     */
    createHolographicBillboards() {
        // Reduced from 10 to 4 for performance
        this.createHolographicBillboard(-300, 400, -600);
        this.createHolographicBillboard(350, 350, -400);
        this.createHolographicBillboard(0, 500, -800);
        this.createHolographicBillboard(-200, 300, -200);
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

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        this.renderer.setClearColor(0x150820, 1); // Deep Cyberpunk Purple-Black
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(width, height);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // SYNTHCITY FOG - Pushed further away for clearer center view
        this.scene.fog = new THREE.Fog(0x1a0a2e, 600, 4500);

        // Street-level camera IN THE ALLEY - more horizontal view
        this.camera = new THREE.PerspectiveCamera(70, width / height, 1, 3000);
        this.camera.position.set(0, 50, 40);  // Forward, slightly higher
        this.camera.lookAt(0, 80, -400);  // Looking more horizontal, at buildings

        console.log('[NeonDistrict] Camera positioned in alley');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Skybox - Dark stormy cyberpunk sky
    // ─────────────────────────────────────────────────────────────────────────

    createSkybox() {
        // Create gradient sky dome
        const skyGeometry = new THREE.SphereGeometry(3000, 32, 32);
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
                    
                    // Deep purple cyberpunk gradient
                    vec3 bottomColor = vec3(0.12, 0.04, 0.20); // Rich purple
                    vec3 midColor = vec3(0.15, 0.06, 0.30);    // Bright purple
                    vec3 topColor = vec3(0.06, 0.02, 0.12);    // Dark violet
                    
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
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
        });

        this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(this.sky);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Procedural Cyberpunk Buildings
    // ─────────────────────────────────────────────────────────────────────────

    async createBuildings() {
        const buildingCount = this.qualityPreset.buildingCount;
        const streetWidth = 180;  // Width of the alley corridor
        const buildingSpacing = 120;  // Space between buildings along the street
        const CHUNK_SIZE = 2; // Small chunks to avoid ANY lag during gameplay

        // Calculate buildings per side
        const buildingsPerSide = Math.floor(buildingCount / 2);
        const alleyLength = buildingsPerSide * buildingSpacing;

        // Prepare all building configs first (fast)
        const buildingConfigs = [];

        // Left side buildings
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100;
            const xPos = -(streetWidth / 2 + 50 + Math.random() * 30);
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;
            buildingConfigs.push({ x: xPos, z: zPos, width, height, depth });
        }

        // Right side buildings
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100 - buildingSpacing / 2;
            const xPos = streetWidth / 2 + 50 + Math.random() * 30;
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;
            buildingConfigs.push({ x: xPos, z: zPos, width, height, depth });
        }

        // Background buildings
        for (let i = 0; i < 6; i++) {
            const zPos = -alleyLength - 200 - Math.random() * 500;
            const xPos = (Math.random() - 0.5) * 800;
            const width = 100 + Math.random() * 150;
            const depth = 100 + Math.random() * 150;
            const height = 800 + Math.random() * 1500;
            buildingConfigs.push({ x: xPos, z: zPos, width, height, depth });
        }

        // CREATE BUILDINGS IN SMALL CHUNKS (idle-time loading)
        for (let i = 0; i < buildingConfigs.length; i += CHUNK_SIZE) {
            if (!this.isActive) return; // Check if stopped

            const chunk = buildingConfigs.slice(i, i + CHUNK_SIZE);
            chunk.forEach(cfg => this.createBuilding(cfg.x, cfg.z, cfg.width, cfg.height, cfg.depth));

            // Wait for idle time before next chunk - doesn't compete with gameplay
            if (i + CHUNK_SIZE < buildingConfigs.length) {
                await this.deferToIdleTime();
            }
        }

        console.log(`[NeonDistrict] Created alley with ${buildingCount} buildings (idle-chunked)`);
    }

    createBuilding(x, z, width, height, depth) {
        const building = new THREE.Group();
        building.position.set(x, 0, z);

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

        // Add building-attached ads to most buildings further back (z < -150)
        const buildingZ = building.position.z;
        if (Math.random() > 0.3 && buildingZ < -50 && this.assets?.loaded) {
            this.attachAdsToBuilding(building, width, height, depth);
        }

        this.buildings.push(building);
        this.scene.add(building);
        return building; // Return for essential buildings Kanji signs
    }

    /**
     * Attach ads to building faces like SynthCity does
     */
    attachAdsToBuilding(building, width, height, depth) {
        const isLarge = height > 400;
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

        // Determine street side based on building position
        // If x < 0 (left side), face is +X (width/2)
        // If x > 0 (right side), face is -X (-width/2)
        const isLeftBuilding = building.position.x < 0;

        if (isLeftBuilding) {
            // Left building, ad faces RIGHT (towards street center)
            ad.position.set(width / 2 + 1, adY, (Math.random() - 0.5) * depth * 0.5);
            ad.rotation.y = Math.PI / 2;
        } else {
            // Right building, ad faces LEFT (towards street center)
            ad.position.set(-width / 2 - 1, adY, (Math.random() - 0.5) * depth * 0.5);
            ad.rotation.y = -Math.PI / 2;
        }

        // Store for animation (material switching like SynthCity)
        ad.userData.isAd = true;
        ad.userData.switchInterval = 200 + Math.random() * 800;
        ad.userData.switchCounter = Math.random() * ad.userData.switchInterval;
        ad.userData.switches = Math.random() < 0.7; // 70% of ads switch
        ad.userData.isLarge = isLarge;

        building.add(ad);
        this.neonSigns.push(ad); // Add to animation list

        // For large ads, also create a VHS version on a different face
        if (isLarge && Math.random() < 0.75) {
            this.createVHSBillboardOnBuilding(building, width, height, depth);
        }
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
            blending: THREE.NormalBlending,  // Normal blending to show texture content
        });

        const billboard = new THREE.Mesh(geometry, vhsMaterial);

        // Position on a different face than main ad (front/back Z faces)
        // Minimum Y = 150 to avoid overlapping storefronts (height 36)
        const adY = 150 + Math.random() * Math.min(buildingHeight * 0.4, 200);
        const faceFront = Math.random() < 0.5;

        if (faceFront) {
            billboard.position.set(0, adY, buildingDepth / 2 + 1);
            billboard.rotation.y = 0;
        } else {
            billboard.position.set(0, adY, -buildingDepth / 2 - 1);
            billboard.rotation.y = Math.PI;
        }

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
            emissive: 0x000000
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
                color: 0x222222 + Math.floor(Math.random() * 0x111111)
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
                side: THREE.DoubleSide
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

        // Base block
        const baseH = height * (0.3 + Math.random() * 0.2);
        const baseGeom = new THREE.BoxGeometry(width, baseH, depth);
        const baseMesh = new THREE.Mesh(baseGeom, buildingMat);
        baseMesh.position.y = baseH / 2;
        building.add(baseMesh);
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
            // Reuse the same material for consistency
            const mesh = new THREE.Mesh(geom, buildingMat);

            // Offset (Cantilever effect)
            const offsetX = (Math.random() - 0.5) * (width - currentW) * 0.8;
            const offsetZ = (Math.random() - 0.5) * (depth - currentD) * 0.8;

            mesh.position.set(offsetX, currentY + blockH / 2, offsetZ);
            building.add(mesh);

            currentY += blockH;
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

        for (let i = 0; i < levels; i++) {
            const scale = 1 - (i * 0.2);
            const h = levelHeight;
            const geometry = new THREE.BoxGeometry(width * scale, h, depth * scale);
            const level = new THREE.Mesh(geometry, buildingMat);
            level.position.y = (i * h) + h / 2;
            building.add(level);
        }
        this.createRooftopDetails(building, width * 0.6, height, depth * 0.6);
    }

    createSpireBuilding(building, width, height, depth) {
        // Building with antenna/spire on top
        const bodyMaterial = this.getBuildingMaterial(Math.random());
        const bodyGeometry = new THREE.BoxGeometry(width, height * 0.8, depth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height * 0.4;
        building.add(body);

        // Spire/antenna on top
        const spireGeometry = new THREE.CylinderGeometry(2, 5, height * 0.4, 8);
        const spireMaterial = new THREE.MeshPhongMaterial({
            color: 0x333344,
            shininess: 30,
            emissive: 0xff0033,
            emissiveIntensity: 0.5,
        });
        const spire = new THREE.Mesh(spireGeometry, spireMaterial);
        spire.position.y = height * 0.8 + height * 0.2;
        building.add(spire);

        // Blinking light on top
        const lightGeometry = new THREE.SphereGeometry(3, 8, 8);
        const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const light = new THREE.Mesh(lightGeometry, lightMaterial);
        light.position.y = height;
        building.add(light);
    }

    createWideBaseBuilding(building, width, height, depth) {
        // Building with wide base that narrows - ONE material for whole building
        const buildingMat = this.getBuildingMaterial(Math.random());

        const baseGeometry = new THREE.BoxGeometry(width * 1.3, height * 0.3, depth * 1.3);
        const base = new THREE.Mesh(baseGeometry, buildingMat);
        base.position.y = height * 0.15;
        building.add(base);

        // Upper tower
        const towerGeometry = new THREE.BoxGeometry(width * 0.7, height * 0.7, depth * 0.7);
        const tower = new THREE.Mesh(towerGeometry, buildingMat);
        tower.position.y = height * 0.3 + height * 0.35;
        building.add(tower);

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

    createRooftopDetails(building, width, height, depth) {
        // Antenna with blinking light
        if (Math.random() > 0.5) {
            const antennaGeometry = new THREE.CylinderGeometry(1, 2, 50 + Math.random() * 50, 8);
            const antennaMaterial = new THREE.MeshStandardMaterial({
                color: 0x333344,
                metalness: 0.8,
                roughness: 0.3,
            });
            const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
            antenna.position.set(
                (Math.random() - 0.5) * width * 0.6,
                height + 25,
                (Math.random() - 0.5) * depth * 0.6
            );
            building.add(antenna);

            // Blinking light on antenna
            const lightGeometry = new THREE.SphereGeometry(3, 8, 8);
            const lightMaterial = new THREE.MeshBasicMaterial({
                color: 0xff0000,
            });
            const light = new THREE.Mesh(lightGeometry, lightMaterial);
            light.position.y = 25 + antenna.geometry.parameters.height / 2;
            antenna.add(light);

            // Store for animation
            light.userData.blinkPhase = Math.random() * Math.PI * 2;
            this.streetLights.push(light);
        }

        // AC units / mechanical
        const acCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < acCount; i++) {
            const acGeometry = new THREE.BoxGeometry(15 + Math.random() * 10, 10, 15 + Math.random() * 10);
            const acMaterial = new THREE.MeshStandardMaterial({
                color: 0x444455,
                metalness: 0.6,
                roughness: 0.5,
            });
            const ac = new THREE.Mesh(acGeometry, acMaterial);
            ac.position.set(
                (Math.random() - 0.5) * width * 0.7,
                height + 5,
                (Math.random() - 0.5) * depth * 0.7
            );
            building.add(ac);
        }

        // Water tank (cylindrical)
        if (Math.random() > 0.6) {
            const tankRadius = 8 + Math.random() * 6;
            const tankHeight = 20 + Math.random() * 15;
            const tankGeometry = new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 12);
            const tankMaterial = new THREE.MeshStandardMaterial({
                color: 0x333333,
                metalness: 0.3,
                roughness: 0.8,
            });
            const tank = new THREE.Mesh(tankGeometry, tankMaterial);
            tank.position.set(
                (Math.random() - 0.5) * width * 0.5,
                height + tankHeight / 2,
                (Math.random() - 0.5) * depth * 0.5
            );
            building.add(tank);
        }

        // Satellite dish
        if (Math.random() > 0.7) {
            const dishSize = 6 + Math.random() * 4;
            const dishGeometry = new THREE.SphereGeometry(dishSize, 12, 8, 0, Math.PI);
            const dishMaterial = new THREE.MeshStandardMaterial({
                color: 0x555566,
                metalness: 0.7,
                roughness: 0.4,
            });
            const dish = new THREE.Mesh(dishGeometry, dishMaterial);
            dish.position.set(
                (Math.random() - 0.5) * width * 0.6,
                height + 3,
                (Math.random() - 0.5) * depth * 0.6
            );
            dish.rotation.x = -Math.PI / 4 + Math.random() * 0.3;
            dish.rotation.y = Math.random() * Math.PI * 2;
            building.add(dish);
        }

        // Pipes running along roof edge
        if (Math.random() > 0.5) {
            const pipeRadius = 1 + Math.random();
            const pipeLength = Math.min(width, depth) * 0.8;
            const pipeGeometry = new THREE.CylinderGeometry(pipeRadius, pipeRadius, pipeLength, 8);
            const pipeMaterial = new THREE.MeshStandardMaterial({
                color: 0x444444,
                metalness: 0.6,
                roughness: 0.5,
            });
            const pipe = new THREE.Mesh(pipeGeometry, pipeMaterial);
            pipe.rotation.z = Math.PI / 2;
            pipe.position.set(
                0,
                height + 2,
                (Math.random() > 0.5 ? 1 : -1) * depth * 0.4
            );
            building.add(pipe);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Street
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Street Lanterns
    // ─────────────────────────────────────────────────────────────────────────
    createStreetLanterns() {
        // Floating Cyberpunk Lanterns
        const lanternGeometry = new THREE.CylinderGeometry(1.5, 1.5, 4, 6);
        const lanternMaterial = new THREE.MeshStandardMaterial({
            color: 0xff4400,
            emissive: 0xff8800,
            emissiveIntensity: 2.0,
            roughness: 0.4,
            metalness: 0.8
        });

        // Place along the street
        for (let z = -300; z < 200; z += 40) {
            // Left Side
            if (Math.random() > 0.3) {
                const l1 = new THREE.Mesh(lanternGeometry, lanternMaterial);
                l1.position.set(-25, 20 + Math.random() * 5, z + (Math.random() - 0.5) * 10);

                // Add point light for actual illumination
                const p1 = new THREE.PointLight(0xff6600, 1.0, 40);
                p1.position.y = -2;
                l1.add(p1);

                // Small subtle float animation data
                l1.userData.floatOffset = Math.random() * 100;
                l1.userData.floatSpeed = 0.5 + Math.random() * 0.5;

                this.scene.add(l1);
                this.streetLights.push(l1);
            }

            // Right Side
            if (Math.random() > 0.3) {
                const l2 = new THREE.Mesh(lanternGeometry, lanternMaterial);
                l2.position.set(25, 20 + Math.random() * 5, z + (Math.random() - 0.5) * 10);

                const p2 = new THREE.PointLight(0xff6600, 1.0, 40);
                p2.position.y = -2;
                l2.add(p2);

                l2.userData.floatOffset = Math.random() * 100;
                l2.userData.floatSpeed = 0.5 + Math.random() * 0.5;

                this.scene.add(l2);
                this.streetLights.push(l2);
            }
        }
    }

    createStreet() {
        // ═══════════════════════════════════════════════════════════════════════
        // HIGH QUALITY WET ASPHALT - Start with placeholder, async load textures
        // ═══════════════════════════════════════════════════════════════════════
        const groundGeometry = new THREE.PlaneGeometry(2000, 2000, 1, 1);

        // Need UV2 for AO map
        groundGeometry.setAttribute('uv2', groundGeometry.attributes.uv);

        // Create PLACEHOLDER material first (instant display - purple asphalt color)
        const wetAsphaltMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x2a1a3a, // Purple-ish asphalt color
            roughness: 0.15,  // Low base roughness for wet look (was 0.6)
            metalness: 0.0,
            envMapIntensity: 2.0, // Strong env reflections
            clearcoat: 0.8,  // Strong wet clearcoat (was 0.3)
            clearcoatRoughness: 0.0,
        });

        // Store reference for later texture swap
        this.groundMaterial = wetAsphaltMaterial;

        // ASYNC load PBR textures in background (non-blocking)
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/neon-district/';

        // Use Promise.all to load all textures in parallel
        const texturePromises = [
            new Promise(resolve => textureLoader.load(texturePath + 'aerial_asphalt_01_diff_2k.jpg', resolve, undefined, () => resolve(null))),
            new Promise(resolve => textureLoader.load(texturePath + 'aerial_asphalt_01_nor_gl_2k.jpg', resolve, undefined, () => resolve(null))),
            new Promise(resolve => textureLoader.load(texturePath + 'aerial_asphalt_01_rough_2k.jpg', resolve, undefined, () => resolve(null))),
            new Promise(resolve => textureLoader.load(texturePath + 'aerial_asphalt_01_ao_2k.jpg', resolve, undefined, () => resolve(null))),
        ];

        Promise.all(texturePromises).then(([diffuseMap, normalMap, roughnessMap, aoMap]) => {
            if (!this.isActive) return;

            // Configure loaded textures
            [diffuseMap, normalMap, roughnessMap, aoMap].filter(t => t).forEach(tex => {
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(4, 4); // Lower tiling for visible texture detail (was 15)
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
            uLightColors: { value: new Array(8).fill(0).map(() => new THREE.Color(0x000000)) }
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
                varying vec2 vUvGround;`
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vUvGround = uv;`
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
                `
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
                `
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
                `
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
                `
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

        const lineGeometry = new THREE.PlaneGeometry(4, 3000);
        const lineMaterial = new THREE.MeshBasicMaterial({
            map: lineTexture,
            transparent: true,
            opacity: 0.55,  // Reduced from 0.85 for less glow
        });
        const centerLine = new THREE.Mesh(lineGeometry, lineMaterial);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.set(0, 2, -400);
        this.scene.add(centerLine);

        // REMOVED: Circular mesh puddles - now using SHADER-BASED FBM puddles only
        // This creates organic, natural shapes instead of obvious round circles

        console.log('[NeonDistrict] Road markings created (high-res texture)');
    }

    // Ground-level city glow lights - Coming from building sides
    createCityGlowLights() {
        // Lights positioned at building edges, shining down onto street
        const glowPositions = [
            // LEFT SIDE (buildings at x ~ -30 to -50)
            { x: -35, y: 20, z: 20, color: 0xff00ff, intensity: 60 },     // Magenta
            { x: -40, y: 15, z: -30, color: 0x00ffff, intensity: 55 },    // Cyan
            { x: -38, y: 25, z: -80, color: 0xaa00ff, intensity: 50 },    // Purple
            { x: -42, y: 18, z: -130, color: 0xff00aa, intensity: 45 },   // Pink
            { x: -36, y: 22, z: -180, color: 0x8800ff, intensity: 40 },   // Deep purple
            { x: -45, y: 20, z: -250, color: 0x00ff88, intensity: 35 },   // Cyan-green
            { x: -38, y: 16, z: -320, color: 0xff66ff, intensity: 30 },   // Light magenta

            // RIGHT SIDE (buildings at x ~ 30 to 50)
            { x: 38, y: 18, z: 10, color: 0x00ffff, intensity: 60 },      // Cyan
            { x: 42, y: 22, z: -50, color: 0xff00ff, intensity: 55 },     // Magenta
            { x: 36, y: 15, z: -100, color: 0x00ff88, intensity: 50 },    // Green-cyan
            { x: 45, y: 25, z: -160, color: 0xaa00ff, intensity: 45 },    // Purple
            { x: 40, y: 18, z: -220, color: 0xff00aa, intensity: 40 },    // Pink
            { x: 35, y: 20, z: -280, color: 0x8800ff, intensity: 35 },    // Deep purple
            { x: 48, y: 16, z: -350, color: 0x66ffff, intensity: 30 },    // Light cyan
        ];

        glowPositions.forEach(({ x, y, z, color, intensity }) => {
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
        this.createSynthCityBillboard(-250, 320, -250, true);  // Closer foreground
        this.createSynthCityBillboard(-350, 480, -750, true);  // Higher back
        this.createSynthCityBillboard(-150, 200, -200, false); // Low foreground
        this.createSynthCityBillboard(-420, 300, -400, false); // Mid-left

        // RIGHT side billboards (ensure both sides have ads)
        this.createSynthCityBillboard(300, 320, -400, true);
        this.createSynthCityBillboard(250, 380, -550, false);
        this.createSynthCityBillboard(350, 280, -300, true);
        this.createSynthCityBillboard(280, 450, -600, false);
        this.createSynthCityBillboard(220, 250, -200, true);   // Closer foreground
        this.createSynthCityBillboard(380, 420, -700, true);   // Higher back
        this.createSynthCityBillboard(150, 180, -150, false);  // Low foreground
        this.createSynthCityBillboard(420, 350, -450, false);  // Mid-right

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
        billboard.rotation.y = x > 0 ? -0.3 : 0.3;

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
                -200 - Math.random() * 600
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
                color: color,
                transparent: true,
                opacity: 0.08,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const beam = new THREE.Mesh(geometry, material);

            // Position beams at various heights pointing down
            beam.position.set(
                (Math.random() - 0.5) * 400,
                300 + Math.random() * 300,
                -300 - Math.random() * 600
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
            color: color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
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
                color: color,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending
            });

            const ring = new THREE.Mesh(geometry, material);
            ring.position.set(
                (Math.random() - 0.5) * 600,
                100 + Math.random() * 400,
                -200 - Math.random() * 800
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
                color: color,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending
            });

            const tube = new THREE.Mesh(geometry, material);
            tube.position.set(
                (Math.random() - 0.5) * 500,
                80 + Math.random() * 350,
                -100 - Math.random() * 700
            );
            tube.rotation.set(
                Math.random() * Math.PI * 0.3,
                Math.random() * Math.PI,
                Math.random() * Math.PI * 0.5
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
            color: color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
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
            color: color, // Tint the white texture with color

            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
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

        if (face === 0) { sign.position.set(bx, yPos, bz + offset); sign.rotation.y = 0; }
        else if (face === 1) { sign.position.set(bx, yPos, bz - offset); sign.rotation.y = Math.PI; }
        else if (face === 2) { sign.position.set(bx + offset, yPos, bz); sign.rotation.y = Math.PI / 2; }
        else { sign.position.set(bx - offset, yPos, bz); sign.rotation.y = -Math.PI / 2; }

        this.scene.add(sign);
        this.neonSigns.push(sign);

        // Light
        const signLight = new THREE.PointLight(colorHex, 2.0, 80);
        signLight.position.copy(sign.position);
        this.scene.add(signLight);
        sign.userData.light = signLight; // Store light reference
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


    createHolographicBillboard(x, y, z) {
        const width = 100 + Math.random() * 100;
        const height = 60 + Math.random() * 80;

        // Purple color pairs for holographic effect
        const colorPairs = [
            [0xff00ff, 0x8800ff], // Magenta to purple
            [0xaa00ff, 0xff00aa], // Purple to pink
            [0xcc00ff, 0x6600ff], // Bright purple to violet
            [0x9933ff, 0xff66ff], // Medium purple to light pink
            [0x8800ff, 0x00ffff], // Deep purple to cyan accent
        ];
        const pair = colorPairs[Math.floor(Math.random() * colorPairs.length)];

        // Create holographic panel with animated shader
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
                    // Animated gradient
                    float gradient = sin(vUv.y * 10.0 + uTime * 2.0) * 0.5 + 0.5;
                    vec3 color = mix(uColor1, uColor2, gradient);
                    
                    // Scanlines
                    float scanline = sin(vUv.y * 200.0) * 0.1 + 0.9;
                    color *= scanline;
                    
                    // Holographic flicker
                    float flicker = sin(uTime * 15.0) * 0.05 + 0.95;
                    color *= flicker;
                    
                    // Edge glow
                    float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
                    edge *= smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
                    
                    gl_FragColor = vec4(color, 0.8 * edge);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const billboard = new THREE.Mesh(geometry, material);
        billboard.position.set(x, y, z);
        billboard.rotation.y = x > 0 ? -0.3 : 0.3;

        this.neonSigns.push(billboard);
        this.scene.add(billboard);
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
            splashPositions[i * 3 + 1] = 0.5;  // Ground level
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

    createOverheadWires() {
        // Find left and right buildings
        const leftBuildings = this.buildings.filter(b => b.position.x < 0);
        const rightBuildings = this.buildings.filter(b => b.position.x > 0);

        const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });

        leftBuildings.forEach(leftB => {
            if (Math.random() > 0.4) return; // Not every building

            // Find partner
            const rightB = rightBuildings.find(b => Math.abs(b.position.z - leftB.position.z) < 100);

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

                // Tube for thickness
                const geometry = new THREE.TubeGeometry(curve, 10, 0.3, 4, false);
                const wire = new THREE.Mesh(geometry, wireMaterial);
                this.scene.add(wire);

                // Chance for a second parallel wire
                if (Math.random() > 0.5) {
                    const offset = new THREE.Vector3(0, -2, 0);
                    const p1b = p1.clone().add(offset);
                    const p2b = p2.clone().add(offset);
                    const midb = mid.clone().add(offset);
                    const curveB = new THREE.QuadraticBezierCurve3(p1b, midb, p2b);
                    const geomB = new THREE.TubeGeometry(curveB, 10, 0.3, 4, false);
                    const wireB = new THREE.Mesh(geomB, wireMaterial);
                    this.scene.add(wireB);
                }
            }
        });
    }

    createFlyingVehicles() {
        const count = this.qualityPreset.flyingVehicles;

        for (let i = 0; i < count; i++) {
            const vehicle = this.createSpinner();

            // DETERMINISTIC lane assignment for variety:
            // Distribute evenly across 3 lanes (low, mid, high altitude)
            const lane = i % 3;
            let x, y, z;

            if (lane === 0) {
                // Low Altitude - The "Trench" Run (center corridor)
                x = (Math.random() - 0.5) * 40;
                y = 80 + Math.random() * 100;   // 80 to 180 height
            } else if (lane === 1) {
                // Mid Altitude - Between buildings
                x = (Math.random() - 0.5) * 400;
                y = 200 + Math.random() * 150;  // 200 to 350 height
            } else {
                // High Altitude - Above buildings
                x = (Math.random() - 0.5) * 1000;
                y = 400 + Math.random() * 300;  // 400 to 700 height
            }
            z = (Math.random() - 0.5) * 2000;

            vehicle.position.set(x, y, z);

            // DETERMINISTIC direction: alternate between forward and backward
            // This ensures some cars always go each way from the start
            const dirZ = (i % 2 === 0) ? 1 : -1;
            vehicle.userData.speed = 100 + Math.random() * 100;
            vehicle.userData.direction = new THREE.Vector3(0, 0, dirZ);
            vehicle.userData.lane = lane;
            vehicle.userData.wobbleOffset = Math.random() * 100;

            this.flyingVehicles.push(vehicle);
            this.scene.add(vehicle);
        }

        console.log(`[NeonDistrict] Created ${count} flying vehicles`);
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
                opacity: 0.9,
            }),
            navMaterial: new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
        };
    }

    // Cyberpunk Spinner - detailed flying vehicle (uses shared resources)
    createSpinner() {
        // Initialize shared resources on first call
        this.initSpinnerResources();
        const r = this.spinnerResources;

        const spinner = new THREE.Group();

        // Main body
        const body = new THREE.Mesh(r.bodyGeometry, r.bodyMaterial);
        spinner.add(body);

        // Cockpit canopy
        const canopy = new THREE.Mesh(r.canopyGeometry, r.canopyMaterial);
        canopy.rotation.x = Math.PI;
        canopy.position.set(0, 2, 3);
        spinner.add(canopy);

        // Engine pods (left and right)
        const leftEngine = new THREE.Mesh(r.engineGeometry, r.engineMaterial);
        leftEngine.rotation.x = Math.PI / 2;
        leftEngine.position.set(-6, -1, -2);
        spinner.add(leftEngine);

        const rightEngine = new THREE.Mesh(r.engineGeometry, r.engineMaterial);
        rightEngine.rotation.x = Math.PI / 2;
        rightEngine.position.set(6, -1, -2);
        spinner.add(rightEngine);

        // Engine glow (exhaust) - alternate colors
        const exhaustMaterial = Math.random() > 0.5 ? r.exhaustCyanMaterial : r.exhaustOrangeMaterial;

        const leftExhaust = new THREE.Mesh(r.exhaustGeometry, exhaustMaterial);
        leftExhaust.position.set(-6, -1, -6);
        spinner.add(leftExhaust);

        const rightExhaust = new THREE.Mesh(r.exhaustGeometry, exhaustMaterial);
        rightExhaust.position.set(6, -1, -6);
        spinner.add(rightExhaust);

        // Headlights
        const leftHeadlight = new THREE.Mesh(r.headlightGeometry, r.headlightMaterial);
        leftHeadlight.position.set(-3, 0, 10);
        spinner.add(leftHeadlight);

        const rightHeadlight = new THREE.Mesh(r.headlightGeometry, r.headlightMaterial);
        rightHeadlight.position.set(3, 0, 10);
        spinner.add(rightHeadlight);

        // Tail lights
        const leftTail = new THREE.Mesh(r.headlightGeometry, r.tailMaterial);
        leftTail.position.set(-3, 0, -10);
        spinner.add(leftTail);

        const rightTail = new THREE.Mesh(r.headlightGeometry, r.tailMaterial);
        rightTail.position.set(3, 0, -10);
        spinner.add(rightTail);

        // Navigation light
        spinner.navLight = new THREE.Mesh(r.navGeometry, r.navMaterial);
        spinner.navLight.position.set(0, 3, 0);
        spinner.add(spinner.navLight);

        return spinner;
    }

    updateGroundReflections() {
        if (!this.groundUniforms) return;

        // Collect all neon signs with lights, sorted by Z (closer to camera first)
        const activeSigns = this.neonSigns
            .filter(s => s.userData.light && s.userData.baseColor)
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

    updateFlyingVehicles(delta) {
        this.flyingVehicles.forEach((vehicle) => {
            // Move along Z (Highway style)
            vehicle.position.z += vehicle.userData.direction.z * vehicle.userData.speed * delta;

            // Wobble/Drift
            const time = this.time + vehicle.userData.wobbleOffset;

            if (vehicle.userData.lane === 0) {
                // Low Altitude Center: Tight corridor
                vehicle.position.x = Math.sin(time * 0.5) * 30;
                vehicle.position.y += Math.sin(time * 1.0) * delta * 5;
            } else if (vehicle.userData.lane === 1) {
                // Mid Altitude: Moderate drift
                vehicle.position.x += Math.cos(time * 0.4) * delta * 10;
                vehicle.position.y += Math.sin(time * 0.6) * delta * 7;
            } else {
                // High Altitude: Free drift
                vehicle.position.x += Math.cos(time * 0.3) * delta * 15;
                vehicle.position.y += Math.sin(time * 0.5) * delta * 10;
            }

            // Loop / Warp (Infinite traffic) - RANDOMIZE on re-entry
            const didLoop = vehicle.position.z > 1500 || vehicle.position.z < -1500;

            if (didLoop) {
                // Warp to opposite side
                vehicle.position.z = vehicle.position.z > 0 ? -1500 : 1500;

                // RANDOMIZE lane, height, and position for variety
                const newLane = Math.floor(Math.random() * 3);
                vehicle.userData.lane = newLane;
                vehicle.userData.wobbleOffset = Math.random() * 100; // New wobble pattern

                if (newLane === 0) {
                    // Low Altitude - Trench
                    vehicle.position.x = (Math.random() - 0.5) * 40;
                    vehicle.position.y = 80 + Math.random() * 100;
                } else if (newLane === 1) {
                    // Mid Altitude
                    vehicle.position.x = (Math.random() - 0.5) * 400;
                    vehicle.position.y = 200 + Math.random() * 150;
                } else {
                    // High Altitude
                    vehicle.position.x = (Math.random() - 0.5) * 1000;
                    vehicle.position.y = 400 + Math.random() * 300;
                }

                // Optionally flip direction for more variety
                if (Math.random() > 0.7) {
                    vehicle.userData.direction.z *= -1;
                }
            }

            // Soft bound for X drift
            if (Math.abs(vehicle.position.x) > 1000) vehicle.position.x *= -0.9;

            // Banking and look ahead
            const driftX = (vehicle.userData.lane === 0) ? Math.cos(time * 0.5) * 30 : 0;

            vehicle.lookAt(
                vehicle.position.x + driftX * 0.1, // Look slightly into turn
                vehicle.position.y,
                vehicle.position.z + vehicle.userData.direction.z * 100
            );

            // Banking
            vehicle.rotation.z = -driftX * 0.01;
        });
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

        // Purple-heavy point lights for neon atmosphere
        const lightPositions = [
            { pos: [-200, 200, -300], color: 0x8800ff, intensity: 10 },
            { pos: [280, 250, -500], color: 0xaa00ff, intensity: 8 },
            { pos: [100, 80, 100], color: 0x6600ff, intensity: 8 },
            { pos: [-180, 150, 50], color: 0xff00ff, intensity: 10 },
            { pos: [200, 180, -150], color: 0xff00aa, intensity: 8 },
            { pos: [-100, 100, -400], color: 0xcc00ff, intensity: 8 },
            { pos: [0, 120, 200], color: 0x9933ff, intensity: 6 },
            { pos: [-250, 300, -200], color: 0x7700ff, intensity: 8 },
            { pos: [300, 280, -350], color: 0xbb00ff, intensity: 6 },
            { pos: [150, 150, -600], color: 0x00ffff, intensity: 5 },
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

        this.composer = new EffectComposer(this.renderer);

        // Render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom pass - using threshold from quality preset
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            this.qualityPreset.bloomThreshold || 0.4
        );
        this.composer.addPass(this.bloomPass);

        // Vignette pass
        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[NeonDistrict] Post-processing configured');
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
        const sparkCount = Math.min(combo * 6, 30);  // Increased from 4 to 6 per combo
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
        const actualCount = count * 3;  // Triple the spark count (was 2x)

        for (let i = 0; i < actualCount; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // BIAS toward left and right EDGES - avoid center where game board is
            let spawnX;
            if (Math.random() > 0.3) {
                // 70% chance: spawn on edges (left or right side)
                const side = Math.random() > 0.5 ? 1 : -1;
                spawnX = side * (200 + Math.random() * 400);  // 200-600 units from center
            } else {
                // 30% chance: full width (some will appear behind board)
                spawnX = (Math.random() - 0.5) * 1000;
            }
            const spawnY = Math.random() * 350;           // Full height from ground to sky
            const spawnZ = 100 - Math.random() * 500;     // Closer to camera for visibility

            // LARGER sparks for better visibility
            const sparkSize = 2 + Math.random() * 3;  // 2-5 units (was 0.6-1.2)
            const geometry = new THREE.SphereGeometry(sparkSize, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: color,
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
                decay: 0.008 + Math.random() * 0.01,  // Slower decay = longer visibility
                gravity: -40,  // Gentler gravity
                color: color,
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
        const count = 15 + combo * 8;  // Increased for more visible edge effects

        for (let i = 0; i < count; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // ONLY spawn on far LEFT or RIGHT edges
            const side = Math.random() > 0.5 ? 1 : -1;
            const spawnX = side * (350 + Math.random() * 300);  // 350-650 units from center (far edges)
            const spawnY = Math.random() * 400;  // Full height
            const spawnZ = 150 - Math.random() * 300;  // Closer to camera for maximum visibility

            // LARGER, brighter sparks for edges
            const sparkSize = 3 + Math.random() * 4;  // 3-7 units
            const geometry = new THREE.SphereGeometry(sparkSize, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: color,
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
                vx: Math.cos(angle) * speed * 0.5,  // Less horizontal movement to stay on edge
                vy: (Math.random() - 0.3) * speed + 10,  // Mostly upward
                vz: 0,  // No depth movement
                life: 1.0,
                decay: 0.006 + Math.random() * 0.008,  // Extra slow decay
                gravity: -30,  // Gentle gravity
                color: color,
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
            const leftBuildings = this.buildings.filter(b => b.position.x < 0);
            const rightBuildings = this.buildings.filter(b => b.position.x > 0);

            if (leftBuildings.length === 0 || rightBuildings.length === 0) return;

            const leftB = leftBuildings[Math.floor(Math.random() * leftBuildings.length)];

            // Find a right building at similar Z depth for more natural arc
            const sameDepthBuildings = rightBuildings.filter(b =>
                Math.abs(b.position.z - leftB.position.z) < 200
            );
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
                arcZ + (Math.random() - 0.5) * 50
            );
            const end = new THREE.Vector3(
                rightB.position.x - 20,
                endY,
                arcZ + (Math.random() - 0.5) * 50
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
            color: color,
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
                midPoint.z + (Math.random() - 0.5) * 50
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
            color: color,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const glitchWave = new THREE.Mesh(geometry, material);

        // Position on LEFT or RIGHT side - avoid center where game board is
        const side = Math.random() > 0.5 ? 1 : -1;
        const randomX = side * (150 + Math.random() * 200);  // 150-350 units from center
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

        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
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
        const spawnX = (Math.random() - 0.5) * 800;  // Full city width
        const spawnY = 10 + Math.random() * 300;    // Full height range
        const spawnZ = 50 - Math.random() * 600;    // From foreground to deep background

        // Create 8-15 sparks per piece lock
        const sparkCount = 8 + Math.floor(Math.random() * 8);

        for (let i = 0; i < sparkCount; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // Spark geometry - small glowing point
            const geometry = new THREE.SphereGeometry(0.8 + Math.random() * 0.8, 6, 6);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
            });

            const spark = new THREE.Mesh(geometry, material);

            // Initial position with slight spread
            spark.position.set(
                spawnX + (Math.random() - 0.5) * 10,
                spawnY + (Math.random() - 0.5) * 10,
                spawnZ + (Math.random() - 0.5) * 10
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
                color: color,
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
            color: color,
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
                    spark.userData.vx ** 2 +
                    spark.userData.vy ** 2 +
                    spark.userData.vz ** 2
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

            // Camera sway - gentle floating drift
            this.updateCameraSway();

            // Update sky shader
            if (this.sky?.material?.uniforms?.uTime) {
                this.sky.material.uniforms.uTime.value = this.time;
            }

            // Update ground uniforms (for ripples and reflections)
            if (this.groundUniforms) {
                this.groundUniforms.uTime.value = this.time;
                this.groundUniforms.uCameraPos.value.copy(this.camera.position);
            }

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
        const swayY = Math.sin(t * spd.y + 0.5) * amp.y + Math.sin(t * spd.y * 0.6 + 2.1) * amp.y * 0.3;
        const swayZ = Math.sin(t * spd.z + 1.0) * amp.z;

        this.camera.position.set(
            this.cameraBasePosition.x + swayX,
            this.cameraBasePosition.y + swayY,
            this.cameraBasePosition.z + swayZ
        );

        // LookAt sway - subtle rotation of view target
        const lookSwayX = Math.sin(t * 0.1 + 0.8) * this.cameraLookAtSway.x;
        const lookSwayY = Math.sin(t * 0.14 + 1.5) * this.cameraLookAtSway.y;

        this.camera.lookAt(
            this.cameraBaseLookAt.x + lookSwayX,
            this.cameraBaseLookAt.y + lookSwayY,
            this.cameraBaseLookAt.z
        );
    }

    /**
     * Updates VHS billboards - shader time, texture cycling, and glitch effects
     */
    updateVHSBillboards(delta) {
        this.vhsBillboards.forEach(billboard => {
            if (!billboard.material?.uniforms) return;

            const uniforms = billboard.material.uniforms;
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

        this.neonSigns.forEach((sign) => {
            if (sign.userData.flickerPhase !== undefined) {
                // Simple flicker effect
                const flicker = Math.sin(this.time * sign.userData.flickerSpeed + sign.userData.flickerPhase);
                const flickerAmount = sign.userData.flickerAmount;

                if (sign.material.opacity !== undefined) {
                    // Include combo surge intensity for dramatic flare during combos
                    const surgeBoost = this.neonSignSurgeIntensity * 0.4;
                    sign.material.opacity = Math.min(
                        0.7 + flicker * flickerAmount + this.lightPulseIntensity * 0.3 + surgeBoost,
                        1.0
                    );
                }
            }

            // Update holographic billboard shaders
            if (sign.material.uniforms?.uTime) {
                sign.material.uniforms.uTime.value = this.time;
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
        this.streetLights.forEach((light) => {
            // Type 1: Blinking Antenna Light
            if (light.userData.blinkPhase !== undefined) {
                const blink = Math.sin(this.time * 2 + light.userData.blinkPhase) > 0.7;
                light.visible = blink;
            }
            // Type 2: Floating Lantern
            else if (light.userData.floatSpeed !== undefined) {
                // Capture base Y if not set
                if (light.userData.initialY === undefined) {
                    light.userData.initialY = light.position.y;
                }

                // Gentle sine wave float
                const floatY = Math.sin(this.time * light.userData.floatSpeed + light.userData.floatOffset);
                light.position.y = light.userData.initialY + floatY * 0.5;

                // Subtle rotation
                light.rotation.y += 0.005;
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
            Object.values(this.spinnerResources).forEach(resource => {
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
